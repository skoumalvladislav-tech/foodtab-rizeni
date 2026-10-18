'use server'

import { rozpoznatDoklad, rozpoznavaniJeNastavene, type VysledekRozpoznani } from '@/lib/jine-platby-ai'
import { poznatTypSouboru, VERZE_ZADANI, zkontrolovatPodklad } from '@/lib/jine-platby-ai-jadro'
import { doDbHlavicka, doDbPolozky } from '@/lib/jine-platby-db'
import { zkontrolovatDoklad } from '@/lib/jine-platby-kontrola'
import { navrhnoutMapovani, type AliasMapovani, type ProduktKatalogu } from '@/lib/jine-platby-mapovani'
import {
  KBELIK_JINYCH_PLATEB,
  MAX_BAJTU_CELKEM_PRO_AI,
  MAX_BAJTU_OBRAZKU_PRO_AI,
  MAX_BAJTU_PRO_AI,
  MAX_SOUBORU_PRO_AI,
  type HlavickaNavrhu,
  type TypSouboru,
} from '@/lib/jine-platby-typy'
import { provozniDen } from '@/lib/pokladna-cas'
import { klientUlohy } from '@/lib/supabase/uloha'

import { aliasyPripojeni, chyba, hotovo, kalendarPobocky, katalogPripojeni, obnovit, pripravit, vysledekChyby } from './[zaznam]/akce-zaklad'
import {
  doplnitNecitelneNazvy,
  HLASKA_BEZ_AI,
  HLASKA_OBECNA,
  jeNahradniNazev,
  MAX_POLOZEK_NAVRHU,
  popisPreskocenych,
  verzeZFormulare,
  vybratSouboryProAi,
  type StavAkce,
} from './[zaznam]/logika'

/**
 * Jiné platby — rozpoznání dokladu přes AI (skill foodtab-ai).
 *
 * Do modelu jdou JEN soubory dokladu tohoto záznamu (fotky, PDF) —
 * žádné jméno obsluhy, zákazník ani ceník (`PodkladRozpoznani` je uzavřený
 * typ, lib/jine-platby-ai-jadro.ts). Výsledek je NÁVRH: uloží se do
 * položek přes `jine_platby_ulozit_navrh` (uživatelským klientem, s kontrolou
 * verze) a člověk ho zkontroluje. AI nikdy nezapisuje tržbu ani výdej.
 *
 * Bez klíče srozumitelná chyba, NIKDY ukázkový doklad (vypadal by jako
 * přečtený). Pokus se do denního stropu (200 za firmu) započítá PŘED
 * voláním AI (`jine_platby_zahajit_rozpoznani`) — ale až PO kontrole
 * podkladu (`zkontrolovatPodklad`): vadný soubor se do stropu nepočítá.
 *
 * Soubory jdou PO POŘADÍ, dokud se vejdou do stropů (`vybratSouboryProAi`):
 * fotka nad 5 MB a PDF nad 8 MB se přeskočí, výběr končí, než by součet
 * překročil 20 MB. Co se nevešlo, řekne výsledek.
 *
 * Délka: stránka detailu má `maxDuration = 120` — model dostane nejvýš
 * 100 s, zbytek je stažení souborů a zápis.
 */

const CEKANI_NA_AI_MS = 100_000

export async function rozpoznat(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba('Formulář je zastaralý — načtěte stránku znovu.')
  // Bez klíče nic nestahujeme ani nezapočítáváme do stropu.
  if (!rozpoznavaniJeNastavene()) return chyba(HLASKA_BEZ_AI)
  if (!p.uzivatelId) return chyba('Nejste přihlášen(a).')

  // Soubory záznamu — uživatelským klientem (RLS + politika kbelíku).
  const { data: radky, error: chybaSouboru } = await p.supabase
    .from('jine_platby_soubory')
    .select('id, poradi, cesta, mime, velikost')
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .order('poradi')
  if (chybaSouboru) return chyba(HLASKA_OBECNA)
  const soubory = (radky ?? []) as { id: string; poradi: number; cesta: string; mime: string; velikost: number }[]
  if (soubory.length === 0) return chyba('K záznamu není nahraný žádný doklad — nahrajte fotku, nebo zadejte položky ručně.')

  // Výběr podle velikosti uložené u souboru (po pořadí, dokud se vejde) — stahuje se jen to, co půjde ven.
  const { vybrane, preskocene } = vybratSouboryProAi(soubory, {
    maxSouboru: MAX_SOUBORU_PRO_AI,
    maxObrazek: MAX_BAJTU_OBRAZKU_PRO_AI,
    maxPdf: MAX_BAJTU_PRO_AI,
    maxCelkem: MAX_BAJTU_CELKEM_PRO_AI,
  })
  const vynechano = popisPreskocenych(preskocene)
  if (vybrane.length === 0) {
    return chyba(`Žádný soubor se na rozpoznání nevejde. ${vynechano} Nahrajte menší fotku nebo PDF, nebo zadejte položky ručně.`)
  }

  const podklad: { data: Uint8Array; mime: TypSouboru }[] = []
  for (const s of vybrane) {
    const { data: obsah, error } = await p.supabase.storage.from(KBELIK_JINYCH_PLATEB).download(s.cesta)
    if (error || !obsah) return chyba(`Soubor č. ${s.poradi} se nepodařilo stáhnout z úložiště. Zkuste to znovu.`)
    const data = new Uint8Array(await obsah.arrayBuffer())
    // Typ podle OBSAHU, ne podle přípony: o souboru, který není fotka ani PDF, se ven nic nepošle.
    const typ = poznatTypSouboru(data)
    const strop = typ === 'application/pdf' ? MAX_BAJTU_PRO_AI : MAX_BAJTU_OBRAZKU_PRO_AI
    if (typ === null || typ !== s.mime || data.length > strop) {
      return chyba(`Soubor č. ${s.poradi} podle obsahu není fotka ani PDF, nebo je moc velký — nic se neposlalo ani nezapočítalo.`)
    }
    podklad.push({ data, mime: typ })
  }

  // Celý podklad (skutečné bajty: typy, velikosti, součet, počet) PŘED započítáním do denního stropu —
  // podklad, který by model stejně odmítl, se nezapočítá.
  const vada = zkontrolovatPodklad({ soubory: podklad })
  if (vada) return chyba(`${vada} Nic se neposlalo ani nezapočítalo do denního stropu.`)

  // SERVICE_ROLE: `jine_platby_zahajit_rozpoznani` / `_dokoncit_rozpoznani` smí jen server
  // („rozpoznala AI“ nesmí jít zapsat z prohlížeče). Až po pripravit() (právo upravit na pobočce
  // záznamu ověřené uživatelským klientem), jen s id ověřeného záznamu a id přihlášeného.
  const uloha = klientUlohy()
  if (!uloha) return chyba('Rozpoznání není na serveru nastavené (chybí SUPABASE_SERVICE_ROLE_KEY) — zadejte položky ručně.')

  const { data: rozpoznaniId, error: chybaZahajeni } = await uloha.rpc('jine_platby_zahajit_rozpoznani', {
    p_zaznam: p.z.id,
    p_spustil: p.uzivatelId,
  })
  if (chybaZahajeni) return vysledekChyby(chybaZahajeni, 'zahájení rozpoznání')

  let vysledek: VysledekRozpoznani
  try {
    vysledek = await rozpoznatDoklad({ soubory: podklad }, { casovyLimitMs: CEKANI_NA_AI_MS })
  } catch (e) {
    console.error('Jiné platby: rozpoznání spadlo:', e instanceof Error ? e.message : e)
    vysledek = { stav: 'chyba', duvod: 'Rozpoznání skončilo neočekávanou chybou — zkuste to znovu, nebo zadejte položky ručně.', docasna: true }
  }

  // Výsledek se zapíše VŽDY (i chyba) — jinak by pokus zůstal „běží“ a blokoval další.
  const { error: chybaDokonceni } = await uloha.rpc('jine_platby_dokoncit_rozpoznani', {
    p_rozpoznani: rozpoznaniId,
    p_stav: vysledek.stav,
    p_model: vysledek.stav === 'ok' ? vysledek.model : null,
    p_verze_zadani: vysledek.stav === 'ok' ? vysledek.verze : VERZE_ZADANI,
    p_vysledek: vysledek.stav === 'ok' ? vysledek.doklad : null,
    p_text: vysledek.stav === 'ok' ? vysledek.doklad.textDokladu : null,
    p_duvod: vysledek.stav === 'chyba' ? vysledek.duvod : vysledek.stav === 'bez_klice' ? 'Chybí klíč k AI.' : null,
  })
  if (chybaDokonceni) {
    console.error('Jiné platby: zápis výsledku rozpoznání selhal:', chybaDokonceni.code, chybaDokonceni.message)
    obnovit(p)
    // Bez záznamu „co přečetla AI“ se návrh neuloží — původ by se ztratil.
    return chyba('Výsledek rozpoznání se nepodařilo uložit — nic se nezměnilo. Zkuste to znovu.')
  }

  if (vysledek.stav === 'bez_klice') {
    obnovit(p)
    return chyba(HLASKA_BEZ_AI)
  }
  if (vysledek.stav === 'chyba') {
    obnovit(p)
    return chyba(vysledek.duvod)
  }

  // Kontrola částek a součtů + návrh přiřazení ke katalogu (jen NÁVRH, nikdy „ověřeno“ z podobnosti).
  const kal = await kalendarPobocky(p.supabase, p.tenantId, p.z.branchId)
  const kontrola = zkontrolovatDoklad(vysledek.doklad, { dnes: provozniDen(Date.now(), kal.denZacina, kal.pasmo) })
  let katalog: ProduktKatalogu[] = []
  let aliasy: AliasMapovani[] = []
  let bezKatalogu = false
  try {
    ;[katalog, aliasy] = await Promise.all([
      katalogPripojeni(p.supabase, p.tenantId, p.z.pripojeniId),
      aliasyPripojeni(p.supabase, p.tenantId, p.z.pripojeniId),
    ])
  } catch {
    bezKatalogu = true
  }
  // Návrh má nejvýš 200 položek (víc databáze nepřijme) — uloží se prvních 200 a výsledek to řekne.
  // Řádek bez přečteného názvu dostane náhradní název a jde ke kontrole (mapuje se dřív, podle prázdného názvu nic).
  const vsechny = kontrola.polozky.map((pol) => navrhnoutMapovani(pol, katalog, aliasy).polozka)
  const polozky = doplnitNecitelneNazvy(vsechny.slice(0, MAX_POLOZEK_NAVRHU))

  // Co AI přečetla, nahradí; co nepřečetla (null), zůstane, jak to člověk měl. Označení a odběratel jsou člověka.
  const h = kontrola.hlavicka
  const hlavicka: HlavickaNavrhu = {
    datumProdeje: h.datumProdeje ?? p.z.datumProdeje,
    oznaceni: p.z.oznaceni,
    mena: h.mena ?? p.z.mena,
    castkaHaleru: h.castkaHaleru ?? p.z.castkaHaleru,
    castkaPuvod: h.castkaHaleru !== null ? h.castkaPuvod : p.z.castkaHaleru !== null ? p.z.castkaPuvod : null,
    typDokladu: h.typDokladu !== 'nezjisteno' ? h.typDokladu : p.z.typDokladu,
    externiUcet: h.externiUcet ?? p.z.externiUcet,
    kontaktId: p.z.kontaktId,
  }

  // Uložení návrhu UŽIVATELSKÝM klientem — právo upravit a verzi ověří databáze.
  const { error } = await p.supabase.rpc('jine_platby_ulozit_navrh', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_hlavicka: doDbHlavicka(hlavicka),
    p_polozky: doDbPolozky(polozky),
  })
  if (error) {
    obnovit(p)
    const stav = vysledekChyby(error, 'uložení rozpoznaného návrhu')
    return { ...stav, text: `Doklad je přečtený (je v historii), ale návrh se neuložil: ${stav.text}` }
  }

  const casti = [`Rozpoznáno položek: ${polozky.length}. Zkontrolujte je — nic se nezapsalo do tržeb ani skladu.`]
  if (vsechny.length > MAX_POLOZEK_NAVRHU) {
    casti.push(
      `Pozor: doklad má ${vsechny.length} položek, uloženo je jen prvních ${MAX_POLOZEK_NAVRHU}. Zbytek doplňte ručně nebo doklad rozdělte — jinak součet nebude sedět s celkovou cenou.`,
    )
  }
  const necitelne = polozky.filter((x) => jeNahradniNazev(x.nazev)).length
  if (necitelne > 0) casti.push(`U ${necitelne} položek AI nepřečetla název — jsou označené „(název nečitelný)“ a čekají na kontrolu.`)
  if (vynechano) casti.push(vynechano)
  const keKontrole = polozky.filter((x) => x.vyzadujeKontrolu).length
  if (keKontrole > 0 || kontrola.duvody.length > 0) {
    casti.push(`Ke kontrole: ${keKontrole} položek, ${kontrola.duvody.length} upozornění k celému dokladu.`)
  }
  if (bezKatalogu) casti.push('Katalog pokladny se nepodařilo načíst — položky zůstaly bez přiřazení.')
  return hotovo(p, casti.join(' '))
}
