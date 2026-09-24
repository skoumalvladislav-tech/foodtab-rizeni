'use server'

import { revalidatePath } from 'next/cache'

import {
  KBELIK_PRILOH,
  MAX_BAJTU,
  MAX_DELKA_NAZVU,
  MAX_PRILOH,
  TYPY_PRILOH,
  jeTypPriloh,
  ocistitNazev,
  textZpravyPrilohy,
} from '@/lib/komunikace/prilohy'
import { naplanovatPushKeZprave } from '@/lib/komunikace/push-hned'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { zakladZRozsahu } from '../zaklad'

/**
 * Odeslání zprávy s přílohami.
 *
 * SOUBORY UŽ JSOU V ÚLOŽIŠTI. Server Action má bez zvláštního nastavení
 * strop na tělo požadavku 1 MB (viz lib/hlasove-zpravy.ts, AUDIO_BITRATE_BPS),
 * fotka z telefonu je i desetkrát větší. Proto prohlížeč nahraje soubory
 * sám, pod přihlášeným člověkem (politiky úložiště z 20260921130000_prilohy.sql
 * pouští jen účastníky rozhovoru), a sem pošle jen jejich cesty.
 *
 * TO, CO PŘIJDE Z PROHLÍŽEČE, JE NÁVRH. Cesta se tu skládá znovu z firmy
 * (z členství, ne z formuláře) a rozhovoru; cokoli jiného se odmítne dřív,
 * než se zavolá databáze. Skutečnou kontrolu — autor zprávy, cesta patří
 * rozhovoru, soubor v úložišti je, nejvýš pět — dělá `pripojit_prilohu`.
 *
 * POŘADÍ: zpráva, pak přílohy. Zpráva nese text nebo popisek, přílohy se
 * připojí jednotlivě. Když připojení selže, zpráva už existuje (je to storno,
 * ne výmaz) a člověk se to dozví; nepřipojené soubory se uklidí.
 *
 * OPAKOVÁNÍ: klientské id zprávy (`p_klient_id`) zajistí, že opakované
 * odeslání po výpadku spojení nezaloží druhou zprávu; přílohy, které už
 * u zprávy jsou (unikátní cesta, 23505), se berou jako hotové.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PrilohaVstup = {
  cesta: string
  nazev: string
  mime: string
  velikost: number
}

export type VysledekSPrilohami =
  | { ok: true; id: string }
  | {
      ok: false
      chyba: string
      /** Zpráva už odešla (jen ne všechny přílohy) — nezkoušet odeslat znovu jako novou. */
      zpravaOdeslana: boolean
      /** Zopakovat nemá smysl (nemáte přístup, špatný vstup…). */
      trvale: boolean
    }

export async function poslatSPrilohami(vstup: {
  rozsah: string
  konverzace: string
  popisek: string
  klientId: string
  prilohy: PrilohaVstup[]
}): Promise<VysledekSPrilohami> {
  const z = await zakladZRozsahu(String(vstup.rozsah ?? ''))
  if (!z) {
    return { ok: false, chyba: 'Nejste přihlášen(a) nebo nemáte přístup.', zpravaOdeslana: false, trvale: true }
  }

  const konverzace = String(vstup.konverzace ?? '')
  if (!UUID.test(konverzace)) {
    return { ok: false, chyba: 'Neplatný rozhovor.', zpravaOdeslana: false, trvale: true }
  }

  const prilohy = Array.isArray(vstup.prilohy) ? vstup.prilohy : []
  if (prilohy.length === 0 || prilohy.length > MAX_PRILOH) {
    return {
      ok: false,
      chyba: `Vyberte 1 až ${MAX_PRILOH} příloh.`,
      zpravaOdeslana: false,
      trvale: true,
    }
  }

  const predpona = `${z.tenantId}/${konverzace}/`
  const overene: PrilohaVstup[] = []
  const videne = new Set<string>()
  for (const p of prilohy) {
    const cesta = String(p?.cesta ?? '')
    const mime = String(p?.mime ?? '')
    const velikost = Number(p?.velikost)
    const soubor = cesta.startsWith(predpona) ? cesta.slice(predpona.length) : ''
    const nalezeno = /^([0-9a-f-]{36})\.(jpg|png|webp|pdf)$/i.exec(soubor)

    if (
      !nalezeno ||
      !UUID.test(nalezeno[1]) ||
      !jeTypPriloh(mime) ||
      TYPY_PRILOH[mime] !== nalezeno[2].toLowerCase() ||
      !Number.isInteger(velikost) ||
      velikost <= 0 ||
      velikost > MAX_BAJTU ||
      videne.has(cesta)
    ) {
      return { ok: false, chyba: 'Některá příloha není v pořádku.', zpravaOdeslana: false, trvale: true }
    }
    videne.add(cesta)
    overene.push({
      cesta,
      nazev: ocistitNazev(String(p?.nazev ?? '')).slice(0, MAX_DELKA_NAZVU),
      mime,
      velikost,
    })
  }

  const text = textZpravyPrilohy(String(vstup.popisek ?? ''), overene.map((p) => p.nazev))
  const klientId = UUID.test(String(vstup.klientId ?? '')) ? vstup.klientId : null

  const supabase = await getServerSupabase()

  // Soubory, které se nepodařilo připojit, se uklidí (úklid siroty — politika
  // úložiště smí smazat jen soubor, na který nic neukazuje). Chyba úklidu se
  // nehlásí: soubor navíc nikomu neškodí, hlášení by jen zakrylo skutečnou chybu.
  const uklidit = async (cesty: string[]) => {
    if (cesty.length === 0) return
    try {
      await supabase.storage.from(KBELIK_PRILOH).remove(cesty)
    } catch {
      /* viz výš */
    }
  }
  const vsechnyCesty = overene.map((p) => p.cesta)

  let { data, error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: text,
    p_priorita: 'normal',
    ...(klientId ? { p_klient_id: klientId } : {}),
  })
  if (error && klientId && funkceNeexistuje(error)) {
    ;({ data, error } = await supabase.rpc('poslat_zpravu', {
      p_konverzace: konverzace,
      p_text: text,
      p_priorita: 'normal',
    }))
  }
  if (error) {
    await uklidit(vsechnyCesty)
    const trvale = /^(42501|23514|P0002|PT\d{3})$/.test(error.code ?? '')
    return { ok: false, chyba: error.message, zpravaOdeslana: false, trvale }
  }

  const zpravaId = String(data)
  // Zpráva je uložená (i kdyby se přílohy nepřipojily) — push příjemcům hned.
  naplanovatPushKeZprave(zpravaId, z.tenantId)
  const nepripojene: string[] = []
  let prvniChyba: string | null = null

  for (const p of overene) {
    if (prvniChyba) {
      nepripojene.push(p.cesta)
      continue
    }
    const { error: chybaPripojeni } = await supabase.rpc('pripojit_prilohu', {
      p_zprava: zpravaId,
      p_cesta: p.cesta,
      p_nazev: p.nazev,
      p_mime: p.mime,
      p_velikost: p.velikost,
    })
    // 23505: tatáž cesta už u zprávy je (opakované odeslání po výpadku) — hotovo.
    if (chybaPripojeni && chybaPripojeni.code !== '23505') {
      prvniChyba = funkceNeexistuje(chybaPripojeni)
        ? 'Přílohy zatím nejsou v databázi zapnuté (čeká se na nasazení migrace).'
        : chybaPripojeni.message
      nepripojene.push(p.cesta)
    }
  }

  revalidatePath(`/${z.rozsah}/vzkazy/${konverzace}`)

  if (prvniChyba) {
    await uklidit(nepripojene)
    return {
      ok: false,
      chyba: `Zpráva odešla, ale přílohy se nepodařilo připojit: ${prvniChyba}`,
      zpravaOdeslana: true,
      trvale: true,
    }
  }

  return { ok: true, id: zpravaId }
}
