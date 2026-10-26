'use server'

import { randomBytes, randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { canSee, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { zakladniAdresaAplikace } from '@/lib/integrace-adresa'
import { podepsatText, rozsifrovat, sifrovaniJeNastavene, zasifrovat } from '@/lib/integrace-klice'
import { KLIC_CHOICE, nastaveniChoice, odkazPripojeni, otiskPokusu, PLATNOST_POKUSU_S, rozebratPodnik, slozitPokus } from '@/lib/rezervace-choice'
import { overitZnovu, synchronizovatChoice, zapsatVysledekTestu } from '@/lib/rezervace-choice-sync'
import { MAX_RADKU_IMPORTU, naparsovatCsvRezervaci } from '@/lib/rezervace-import'
import { POSKYTOVATEL_PRIJMU, slozitKlicRezervaci } from '@/lib/rezervace-prijem-api'
import { poskytovatelSouboru, systemyKPriprave } from '@/lib/rezervace-poskytovatele'
import { KBELIK_REZERVACI, MAX_BAJTU, MAX_PRILOH_REZERVACE, jeTypPriloh } from '@/lib/rezervace-prilohy'
import { STAVY, bezpecnaZpatky, hlaskaZDatabaze, jePlatneDatum, precistFormular, zkontrolovatPoznamku } from '@/lib/rezervace-typy'
import { getServerSupabase } from '@/lib/supabase/server'

import { pobockaKZapisu, zkusPristupRezervacim } from './pristup'

/**
 * Serverové akce Rezervací a akcí.
 *
 * Každá začíná tím, že si sama ověří přístup (layout ani stránka akci
 * nechrání) a pobočku z formuláře porovná s pobočkami, na které člověk
 * v tomhle rozsahu zapisuje. O zápisu pak rozhodují funkce
 * `rezervace_*` v databázi — znovu, na pobočce řádku.
 *
 * Do adresy po akci jde jen kód výsledku (`?stav=ulozeno`, `?chyba=pravo`),
 * nikdy text z formuláře ani jméno hosta.
 */

export type StavFormulare = { stav: 'klid' } | { stav: 'chyba'; chyby: string[] }

export type StavImportu =
  | { stav: 'klid' }
  | { stav: 'chyba'; chyby: string[] }
  | { stav: 'hotovo'; nove: number; zmenene: number; bezeZmeny: number; zastarale: number; bezCisla: boolean }

const text = (formData: FormData, klic: string) => String(formData.get(klic) ?? '').trim()

function sParametrem(adresa: string, klic: string, hodnota: string): string {
  return `${adresa}${adresa.includes('?') ? '&' : '?'}${klic}=${encodeURIComponent(hodnota)}`
}

async function vstup(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav !== 'ok') return null
  return { tenantId, pristup }
}

/* ---------------------------------------------------------------------
 * Rezervace a akce
 * ------------------------------------------------------------------ */

/** Založení nebo úprava. Volá ji formulář přes useActionState. */
export async function ulozitRezervaci(_predchozi: StavFormulare, formData: FormData): Promise<StavFormulare> {
  const rozsah = text(formData, 'rozsah')
  const id = text(formData, 'id') || null
  const v = await vstup(rozsah)
  if (!v) return { stav: 'chyba', chyby: ['Na tohle nemáte oprávnění.'] }
  const { tenantId, pristup } = v

  const supabase = await getServerSupabase()
  let jenFoodtab = false
  let pobocka: string

  if (id) {
    const { data } = await supabase
      .from('rezervace')
      .select('id, branch_id, zdroj')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!data || !pobockaKZapisu(pristup, String(data.branch_id))) {
      return { stav: 'chyba', chyby: ['Tuhle rezervaci upravit nemůžete.'] }
    }
    jenFoodtab = data.zdroj !== 'rucne'
    pobocka = String(data.branch_id)
  } else {
    const p = pobockaKZapisu(pristup, text(formData, 'pobocka'))
    if (!p) return { stav: 'chyba', chyby: ['Na téhle pobočce rezervace zapisovat nemůžete.'] }
    pobocka = p.id
  }

  const formular = precistFormular((k) => formData.get(k) as string | null, { jenFoodtab })
  if (formular.stav === 'chyba') return { stav: 'chyba', chyby: formular.chyby }

  // Dokumenty nahrané z formuláře nové rezervace (jen cesty — soubory už
  // jsou v úložišti). Nesmysl se zahodí tady; o pravdě rozhodne databáze.
  const prilohy = id ? [] : precistPrilohyFormulare(text(formData, 'prilohy'), `${tenantId}/${pobocka}/`)
  if (prilohy === null) return { stav: 'chyba', chyby: ['Seznam dokumentů nemá správný tvar — vyberte je znovu.'] }

  const klic = text(formData, 'klic')
  const { data: vysledneId, error } = await supabase.rpc('rezervace_ulozit', {
    p_tenant: tenantId,
    p_rezervace: id,
    // U úpravy pobočku neposílat: rezervace se nestěhuje a databáze
    // by jinou pobočku odmítla.
    p_branch: id ? null : pobocka,
    p_udaje: id ? formular.udaje : { ...formular.udaje, klic },
  })
  if (error || !vysledneId) return { stav: 'chyba', chyby: [hlaskaZDatabaze(error)] }

  let nepripojeno = 0
  for (const p of prilohy) {
    const { error: chybaPrilohy } = await supabase.rpc('rezervace_pripojit_prilohu', {
      p_tenant: tenantId,
      p_branch: null,
      p_rezervace: String(vysledneId),
      p_den: null,
      p_cesta: p.cesta,
      p_nazev: p.nazev,
      p_mime: p.mime,
      p_velikost: p.velikost,
    })
    // 23505 = ta cesta už připojená je (opakované odeslání téhož formuláře).
    if (chybaPrilohy && chybaPrilohy.code !== '23505') nepripojeno += 1
  }

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(`/${rozsah}/rezervace/${String(vysledneId)}?stav=${nepripojeno > 0 ? 'ulozeno-bez-priloh' : 'ulozeno'}`)
}

type PrilohaFormulare = { cesta: string; nazev: string; mime: string; velikost: number }

/**
 * Seznam nahraných dokumentů z formuláře. Prázdné = žádné. `null` =
 * nesmysl (jiný tvar, jiná firma či pobočka v cestě, nepovolený typ).
 */
function precistPrilohyFormulare(json: string, predponaCesty: string): PrilohaFormulare[] | null {
  if (json === '') return []
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(data) || data.length > MAX_PRILOH_REZERVACE) return null
  const vysledek: PrilohaFormulare[] = []
  for (const x of data) {
    const p = x as Partial<PrilohaFormulare> | null
    if (!p || typeof p.cesta !== 'string' || typeof p.nazev !== 'string' || typeof p.mime !== 'string' || typeof p.velikost !== 'number') return null
    if (!p.cesta.startsWith(predponaCesty) || !jeTypPriloh(p.mime) || !(p.velikost > 0 && p.velikost <= MAX_BAJTU)) return null
    vysledek.push({ cesta: p.cesta, nazev: p.nazev.slice(0, 120), mime: p.mime, velikost: Math.trunc(p.velikost) })
  }
  return vysledek
}

/** Rychlá změna stavu z detailu (Proběhla, Nedorazili, Zrušit…). */
export async function zmenitStav(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const id = text(formData, 'id')
  const stav = text(formData, 'stav')
  const zpet = `/${rozsah}/rezervace/${id}`
  const v = await vstup(rozsah)
  if (!v || !/^[0-9a-f-]{36}$/i.test(id)) redirect(`/${rozsah}/rezervace`)
  if (!(STAVY as readonly string[]).includes(stav)) redirect(sParametrem(zpet, 'chyba', 'nepovedlo'))

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('rezervace_zmenit_stav', { p_rezervace: id, p_stav: stav })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : error.code === '23514' ? 'zdroj' : 'nepovedlo'))

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(sParametrem(zpet, 'stav', 'stav-zmenen'))
}

/* ---------------------------------------------------------------------
 * Poznámky a další informace
 * ------------------------------------------------------------------ */

export async function pridatPoznamku(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = bezpecnaZpatky(rozsah, text(formData, 'zpet'))
  const v = await vstup(rozsah)
  if (!v) redirect(`/${rozsah}/rezervace`)

  const nadpis = text(formData, 'nadpis')
  const obsah = text(formData, 'obsah')
  if (zkontrolovatPoznamku(nadpis, obsah)) redirect(sParametrem(zpet, 'chyba', 'poznamka'))

  const rezervace = text(formData, 'rezervace') || null
  const den = text(formData, 'den') || null
  let pobocka: string | null = null
  if (!rezervace) {
    const p = pobockaKZapisu(v.pristup, text(formData, 'pobocka'))
    if (!p || !den || !jePlatneDatum(den)) redirect(sParametrem(zpet, 'chyba', 'pravo'))
    pobocka = p.id
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('rezervace_pridat_poznamku', {
    p_tenant: v.tenantId,
    p_branch: pobocka,
    p_rezervace: rezervace,
    p_den: rezervace ? null : den,
    p_nadpis: nadpis,
    p_obsah: obsah,
  })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : 'nepovedlo'))

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(sParametrem(zpet, 'stav', 'poznamka'))
}

export async function upravitPoznamku(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = bezpecnaZpatky(rozsah, text(formData, 'zpet'))
  const v = await vstup(rozsah)
  if (!v) redirect(`/${rozsah}/rezervace`)

  const nadpis = text(formData, 'nadpis')
  const obsah = text(formData, 'obsah')
  if (zkontrolovatPoznamku(nadpis, obsah)) redirect(sParametrem(zpet, 'chyba', 'poznamka'))

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('rezervace_upravit_poznamku', {
    p_poznamka: text(formData, 'id'),
    p_nadpis: nadpis,
    p_obsah: obsah,
  })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : 'nepovedlo'))

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(sParametrem(zpet, 'stav', 'poznamka'))
}

export async function smazatPoznamku(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = bezpecnaZpatky(rozsah, text(formData, 'zpet'))
  const v = await vstup(rozsah)
  if (!v) redirect(`/${rozsah}/rezervace`)

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('rezervace_smazat_poznamku', { p_poznamka: text(formData, 'id') })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : 'nepovedlo'))

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(sParametrem(zpet, 'stav', 'poznamka-smazana'))
}

/* ---------------------------------------------------------------------
 * Přílohy
 *
 * Soubor nahrává prohlížeč rovnou do úložiště (serverová akce má strop
 * 1 MB, fotka z telefonu je větší). Sem chodí jen jeho cesta, a funkce
 * v databázi ověří, že soubor v úložišti je, patří téhle firmě
 * a pobočce a má ten typ a velikost, jaké tvrdí prohlížeč.
 * ------------------------------------------------------------------ */

export type VstupPrilohy = {
  rozsah: string
  rezervace: string | null
  den: string | null
  pobocka: string | null
  cesta: string
  nazev: string
  mime: string
  velikost: number
}

export async function pripojitPrilohu(vstupPrilohy: VstupPrilohy): Promise<{ ok: true } | { ok: false; chyba: string }> {
  const v = await vstup(vstupPrilohy.rozsah)
  if (!v) return { ok: false, chyba: 'Na tohle nemáte oprávnění.' }
  if (!jeTypPriloh(vstupPrilohy.mime)) return { ok: false, chyba: 'Tenhle typ souboru nejde připojit.' }
  if (!(vstupPrilohy.velikost > 0 && vstupPrilohy.velikost <= MAX_BAJTU)) return { ok: false, chyba: 'Soubor je prázdný nebo moc velký.' }
  if (!vstupPrilohy.rezervace) {
    const p = pobockaKZapisu(v.pristup, vstupPrilohy.pobocka ?? '')
    if (!p || !vstupPrilohy.den || !jePlatneDatum(vstupPrilohy.den)) return { ok: false, chyba: 'Sem přílohu přidat nemůžete.' }
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('rezervace_pripojit_prilohu', {
    p_tenant: v.tenantId,
    p_branch: vstupPrilohy.rezervace ? null : vstupPrilohy.pobocka,
    p_rezervace: vstupPrilohy.rezervace,
    p_den: vstupPrilohy.rezervace ? null : vstupPrilohy.den,
    p_cesta: vstupPrilohy.cesta,
    p_nazev: vstupPrilohy.nazev,
    p_mime: vstupPrilohy.mime,
    p_velikost: vstupPrilohy.velikost,
  })
  if (error) return { ok: false, chyba: hlaskaZDatabaze(error) }

  revalidatePath(`/${vstupPrilohy.rozsah}/rezervace`, 'layout')
  return { ok: true }
}

export async function odebratPrilohu(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = bezpecnaZpatky(rozsah, text(formData, 'zpet'))
  const v = await vstup(rozsah)
  if (!v) redirect(`/${rozsah}/rezervace`)

  const supabase = await getServerSupabase()
  const { data: cesta, error } = await supabase.rpc('rezervace_odebrat_prilohu', { p_priloha: text(formData, 'id') })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : 'nepovedlo'))

  // Soubor bez přílohy smí smazat jen ten, kdo na pobočce zapisuje
  // (politika rezervace_soubory_smazat). Nepovede-li se, zůstane sirotek.
  if (cesta) await supabase.storage.from(KBELIK_REZERVACI).remove([String(cesta)])

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  redirect(sParametrem(zpet, 'stav', 'priloha-odebrana'))
}

/* ---------------------------------------------------------------------
 * Import ze souboru
 * ------------------------------------------------------------------ */

/** Strop souboru: serverová akce bere nejvýš 1 MB i s ostatními poli. */
const MAX_BAJTU_SOUBORU = 900 * 1024

/** UTF-8, a když to nejde, windows-1250 (české Excely ukládají CSV takhle). */
function precistText(bajty: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bajty)
  } catch {
    return new TextDecoder('windows-1250').decode(bajty)
  }
}

export async function importovatSoubor(_predchozi: StavImportu, formData: FormData): Promise<StavImportu> {
  const rozsah = text(formData, 'rozsah')
  const v = await vstup(rozsah)
  if (!v) return { stav: 'chyba', chyby: ['Na tohle nemáte oprávnění.'] }

  const p = pobockaKZapisu(v.pristup, text(formData, 'pobocka'))
  if (!p) return { stav: 'chyba', chyby: ['Na téhle pobočce rezervace importovat nemůžete.'] }

  const soubor = formData.get('soubor')
  if (!(soubor instanceof File) || soubor.size === 0) return { stav: 'chyba', chyby: ['Vyberte soubor CSV.'] }
  if (soubor.size > MAX_BAJTU_SOUBORU) {
    return { stav: 'chyba', chyby: [`Soubor je větší než 900 kB. Rozdělte ho (najednou jde nejvýš ${MAX_RADKU_IMPORTU} rezervací).`] }
  }

  const vysledek = naparsovatCsvRezervaci(precistText(await soubor.arrayBuffer()))
  if (vysledek.chyby.length > 0) {
    const ukazat = vysledek.chyby.slice(0, 12).map((c) => (c.radek > 0 ? `Řádek ${c.radek}: ${c.zprava}` : c.zprava))
    if (vysledek.chyby.length > 12) ukazat.push(`… a dalších ${vysledek.chyby.length - 12} chyb.`)
    ukazat.push('Nenačetlo se nic — opravte soubor a nahrajte ho znovu.')
    return { stav: 'chyba', chyby: ukazat }
  }
  if (vysledek.radky.length === 0) return { stav: 'chyba', chyby: ['V souboru není žádná rezervace.'] }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('rezervace_importovat_csv', {
    p_tenant: v.tenantId,
    p_branch: p.id,
    p_poskytovatel: poskytovatelSouboru(text(formData, 'system')),
    p_radky: vysledek.radky,
  })
  if (error || !data) return { stav: 'chyba', chyby: [hlaskaZDatabaze(error), 'Nenačetlo se nic.'] }

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  const souhrn = data as Record<string, number>
  return {
    stav: 'hotovo',
    nove: Number(souhrn.nove ?? 0),
    zmenene: Number(souhrn.zmenene ?? 0),
    bezeZmeny: Number(souhrn.beze_zmeny ?? 0),
    zastarale: Number(souhrn.zastarale ?? 0),
    bezCisla: vysledek.bezCisla,
  }
}

/* ---------------------------------------------------------------------
 * Napojení na rezervační systém (registr integrace_pripojeni)
 *
 * Jen `integrace.manage`. Připojení vznikne jako „čeká na připojení“ —
 * u systémů bez adaptéru nemá „připojeno“ kdo ověřit (a databáze ho bez
 * ověření nedovolí). Choice má adaptér a vlastní připojení (pripojitChoice).
 * ------------------------------------------------------------------ */

export async function pripravitNapojeni(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = `/${rozsah}/rezervace/napojeni`
  const v = await vstup(rozsah)
  if (!v || !canSee(v.pristup.ctx, 'integrace.manage')) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const pobocka = v.pristup.pobocky.find((b) => b.id === text(formData, 'pobocka'))
  // Jen systémy, ke kterým jednou může být adaptér (API veřejné nebo
  // partnerské) a ještě není. Tablein a „jiný“ jdou přes příjmové API
  // nebo CSV; Choice má adaptér a vlastní připojení (pripojitChoice).
  const system = systemyKPriprave().find((s) => s.klic === text(formData, 'system'))
  if (!pobocka || !system) {
    redirect(sParametrem(zpet, 'chyba', 'nepovedlo'))
  }

  const supabase = await getServerSupabase()
  const { data: stavajici } = await supabase.rpc('rezervace_napojeni', { p_tenant: v.tenantId })
  const uzJe = ((stavajici ?? []) as { branch_id: string; poskytovatel: string }[]).some(
    (s) => s.branch_id === pobocka.id && s.poskytovatel === system.klic,
  )
  if (uzJe) redirect(sParametrem(zpet, 'chyba', 'uz-je'))

  const { error } = await supabase.from('integrace_pripojeni').insert({
    tenant_id: v.tenantId,
    branch_id: pobocka.id,
    oblast: 'rezervace',
    poskytovatel: system.klic,
    rezim: 'zakaznicky',
    nazev: `${system.nazev} — ${pobocka.nazev}`,
  })
  if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : 'nepovedlo'))

  revalidatePath(zpet)
  redirect(sParametrem(zpet, 'stav', 'pripraveno'))
}

export async function odpojitNapojeni(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = `/${rozsah}/rezervace/napojeni`
  const v = await vstup(rozsah)
  if (!v || !canSee(v.pristup.ctx, 'integrace.manage')) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('integrace_pripojeni')
    .update({ odpojeno_kdy: new Date().toISOString(), stav: 'odpojeno' })
    .eq('id', text(formData, 'id'))
    .eq('tenant_id', v.tenantId)
    .eq('oblast', 'rezervace')
    .is('odpojeno_kdy', null)
    .select('id')
  // Politika řádek, na který člověk nemá právo, tiše přeskočí — proto
  // se počítá, jestli se něco změnilo.
  if (error || !data || data.length === 0) redirect(sParametrem(zpet, 'chyba', error?.code === '42501' || !error ? 'pravo' : 'nepovedlo'))

  // Klíč příjmového API smazat (adresa odpojené připojení stejně odmítne;
  // tohle je úklid, ať zašifrovaný klíč neleží zbytečně).
  await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: text(formData, 'id') })

  revalidatePath(zpet)
  redirect(sParametrem(zpet, 'stav', 'odpojeno'))
}

/* ---------------------------------------------------------------------
 * Univerzální příjmové API (Šéfík 25. 10. 2026: „mám Choice, ale
 * připravil bych univerzální možnost“)
 *
 * Klíč patří jedné pobočce. Appka ho ukáže jen jednou (proto
 * useActionState, ne adresa); v databázi je jen zašifrovaný. Vyměnit ho
 * jde kdykoli — starý tím přestane platit. „Připojeno“ se z tohohle
 * nestane: to nastaví databáze až po první úspěšně přijaté dávce.
 * ------------------------------------------------------------------ */

export type StavKliceRezervaci = null | { stav: 'chyba'; duvod: string } | { stav: 'ok'; klic: string; adresa: string }

export async function vydatKlicPrijmuRezervaci(_predchozi: StavKliceRezervaci, formData: FormData): Promise<StavKliceRezervaci> {
  const rozsah = text(formData, 'rozsah')
  const v = await vstup(rozsah)
  if (!v || !canSee(v.pristup.ctx, 'integrace.manage')) {
    return { stav: 'chyba', duvod: 'Klíč vydává ten, kdo má právo „Správa napojení na externí systémy“.' }
  }
  if (!sifrovaniJeNastavene()) {
    return { stav: 'chyba', duvod: 'Na serveru není nastavené šifrování přístupových údajů — klíč by nešlo bezpečně uložit.' }
  }

  const supabase = await getServerSupabase()
  const { data: stavajici } = await supabase.rpc('rezervace_napojeni', { p_tenant: v.tenantId })
  const prijmy = ((stavajici ?? []) as { id: string; branch_id: string; poskytovatel: string }[]).filter(
    (s) => s.poskytovatel === POSKYTOVATEL_PRIJMU,
  )

  let pripojeniId: string
  const id = text(formData, 'id')
  if (id) {
    // Výměna: jen připojení příjmového API, které člověk v tomhle rozsahu vidí.
    const najite = prijmy.find((s) => s.id === id && v.pristup.pobocky.some((p) => p.id === s.branch_id))
    if (!najite) return { stav: 'chyba', duvod: 'Tohle napojení tu není.' }
    pripojeniId = najite.id
  } else {
    const pobocka = v.pristup.pobocky.find((p) => p.id === text(formData, 'pobocka'))
    if (!pobocka) return { stav: 'chyba', duvod: 'Vyberte pobočku.' }
    if (prijmy.some((s) => s.branch_id === pobocka.id)) {
      return { stav: 'chyba', duvod: `Pobočka ${pobocka.nazev} už klíč má — u napojení výš ho můžete vyměnit.` }
    }
    // Id se vylosuje tady: zápis pak nepotřebuje číst řádek zpátky (to by
    // chtělo právo na Finance, které správce napojení mít nemusí).
    pripojeniId = randomUUID()
    const { error } = await supabase.from('integrace_pripojeni').insert({
      id: pripojeniId,
      tenant_id: v.tenantId,
      branch_id: pobocka.id,
      oblast: 'rezervace',
      poskytovatel: POSKYTOVATEL_PRIJMU,
      rezim: 'zakaznicky',
      // „Čeká na první data“, dokud nepřijde první úspěšně zapsaná dávka.
      stav: 'nepripojeno',
      nazev: `Příjmové API — ${pobocka.nazev}`,
      capabilities: { prijem: true },
    })
    if (error) return { stav: 'chyba', duvod: error.code === '42501' ? 'Na téhle pobočce napojení zakládat nemůžete.' : 'Napojení se nepodařilo založit.' }
  }

  const klic = slozitKlicRezervaci(pripojeniId, randomBytes(32).toString('base64url'))
  const { sifra, otisk } = zasifrovat({ klic })
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeniId, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) return { stav: 'chyba', duvod: 'Klíč se nepodařilo uložit — zkuste to znovu.' }

  revalidatePath(`/${rozsah}/rezervace/napojeni`)
  return { stav: 'ok', klic, adresa: `${await zakladniAdresaAplikace()}/api/rezervace/prijem` }
}

/* ---------------------------------------------------------------------
 * Choice (choiceqr.com) — připojení podniku, ověření, načtení teď
 *
 * Adaptér: lib/rezervace-choice.ts a lib/rezervace-choice-sync.ts, návod
 * docs/rezervace-choice.md. Do Choice se nic nezapisuje.
 * ------------------------------------------------------------------ */

const RE_ROZSAH = /^[a-z0-9-]{1,80}$/

/**
 * „Připojit podnik v Choice“: založí (nebo znovu použije) připojení ve
 * stavu „připojuje se“ a přesměruje majitele na stránku Choice, kde
 * aplikaci Foodtab povolí. Choice ho pak vrátí na
 * /api/rezervace/choice/callback.
 *
 * Majitel vloží odkaz na připojení, který vygeneroval Choice (s `digit`
 * od Choice); Foodtab k němu přidá podepsaný jednorázový pokus
 * (customAttribute) svázaný s firmou, pobočkou a PŘIHLÁŠENÝM uživatelem,
 * platí 10 minut. U připojení se uloží jen otisk jednorázového čísla —
 * nové kliknutí starý odkaz zneplatní.
 */
export async function pripojitChoice(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = `/${rozsah}/rezervace/napojeni`
  const v = await vstup(rozsah)
  if (!v || !RE_ROZSAH.test(rozsah)) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const pobocka = v.pristup.pobocky.find((b) => b.id === text(formData, 'pobocka'))
  if (!pobocka || !(await hasAccess(v.tenantId, 'integrace.manage', pobocka.id))) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const nastaveni = nastaveniChoice(process.env)
  if (!nastaveni || !sifrovaniJeNastavene()) redirect(sParametrem(zpet, 'chyba', 'choice-nenastaveno'))

  // Jen celý odkaz z Choice (nese `digit`, který přiděluje Choice) — z
  // adresy podniku by vznikl odkaz, se kterým se připojení nedokončí.
  const callback = `${await zakladniAdresaAplikace()}/api/rezervace/choice/callback`
  const podnik = rozebratPodnik(text(formData, 'podnik'), nastaveni.clientId, callback)
  if (podnik.stav === 'chyba') {
    const kod = { 'bez-odkazu': 'choice-odkaz-chybi', aplikace: 'choice-odkaz-aplikace', callback: 'choice-odkaz-callback', jine: 'choice-podnik' }[podnik.kod]
    redirect(sParametrem(zpet, 'chyba', kod))
  }

  const supabase = await getServerSupabase()
  const { data: prihlaseni } = await supabase.auth.getUser()
  if (!prihlaseni.user) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const { data: stavajici } = await supabase.rpc('rezervace_napojeni', { p_tenant: v.tenantId })
  const choice = ((stavajici ?? []) as { id: string; branch_id: string; poskytovatel: string; stav: string }[]).find(
    (s) => s.branch_id === pobocka.id && s.poskytovatel === KLIC_CHOICE,
  )
  if (choice?.stav === 'pripojeno') redirect(sParametrem(zpet, 'chyba', 'choice-uz-pripojeno'))

  const nonce = randomBytes(16).toString('base64url')
  const ucet = { domena_zadana: `${podnik.podnik.subdomena}.choiceqr.com`, pokus: otiskPokusu(nonce) }

  let pripojeniId: string
  if (choice) {
    // Nedokončený nebo neplatný pokus téže pobočky se použije znovu —
    // opakované klikání nemá plodit další karty.
    const { data } = await supabase
      .from('integrace_pripojeni')
      .update({ stav: 'pripojuje_se', posledni_chyba: null, externi_ucet: ucet })
      .eq('id', choice.id)
      .eq('tenant_id', v.tenantId)
      .neq('stav', 'pripojeno')
      .is('odpojeno_kdy', null)
      .select('id')
    if (!data || data.length !== 1) redirect(sParametrem(zpet, 'chyba', 'nepovedlo'))
    pripojeniId = choice.id
  } else {
    // Id se vylosuje tady — zápis pak nemusí číst řádek zpátky.
    pripojeniId = randomUUID()
    const { error } = await supabase.from('integrace_pripojeni').insert({
      id: pripojeniId,
      tenant_id: v.tenantId,
      branch_id: pobocka.id,
      oblast: 'rezervace',
      poskytovatel: KLIC_CHOICE,
      rezim: 'zakaznicky',
      stav: 'pripojuje_se',
      nazev: 'Choice',
      externi_ucet: ucet,
      capabilities: { cteni: true, zapis: false, webhooky: false, stahovani: true, limit_dotazu: '1 za 5 s' },
    })
    if (error) redirect(sParametrem(zpet, 'chyba', error.code === '42501' ? 'pravo' : error.code === '23505' ? 'uz-je' : 'nepovedlo'))
  }

  const pokus = slozitPokus(
    { pripojeniId, platnostDo: Math.floor(Date.now() / 1000) + PLATNOST_POKUSU_S, nonce, rozsah },
    { tenantId: v.tenantId, branchId: pobocka.id, userId: prihlaseni.user.id },
    podepsatText,
  )
  redirect(odkazPripojeni({ podnik: podnik.podnik, clientId: nastaveni.clientId, redirectUrl: callback, pokus }))
}

/** Připojení Choice z formuláře — jen takové, které člověk v tomhle rozsahu vidí, i s jeho pobočkou. */
async function pripojeniChoice(v: { tenantId: string; pristup: Extract<Awaited<ReturnType<typeof zkusPristupRezervacim>>, { stav: 'ok' }> }, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const supabase = await getServerSupabase()
  const { data } = await supabase.rpc('rezervace_napojeni', { p_tenant: v.tenantId })
  const najite = ((data ?? []) as { id: string; branch_id: string; poskytovatel: string; stav: string }[]).find(
    (s) => s.id === id && s.poskytovatel === KLIC_CHOICE,
  )
  const pobocka = najite ? v.pristup.pobocky.find((p) => p.id === najite.branch_id) : undefined
  return najite && pobocka ? { ...najite, pobocka } : null
}

/**
 * „Ověřit znovu“: živý test uloženého tokenu (GET /bookings/list?perPage=1).
 * „Připojeno“ jen po úspěchu (zapsatVysledekTestu). Jen správce napojení.
 */
export async function overitChoice(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = `/${rozsah}/rezervace/napojeni`
  const zacatek = Date.now()
  const v = await vstup(rozsah)
  if (!v) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const pripojeni = await pripojeniChoice(v, text(formData, 'id'))
  if (!pripojeni || !(await hasAccess(v.tenantId, 'integrace.manage', pripojeni.branch_id))) redirect(sParametrem(zpet, 'chyba', 'pravo'))
  if (pripojeni.stav === 'pripojuje_se') redirect(sParametrem(zpet, 'chyba', 'choice-pokus'))

  // Šifru vydá databáze jen správci napojení té pobočky (integrace_precti_tajemstvi).
  const supabase = await getServerSupabase()
  const { data: sifra, error } = await supabase.rpc('integrace_precti_tajemstvi', { p_pripojeni: pripojeni.id })
  let token = ''
  try {
    token = !error && typeof sifra === 'string' ? (rozsifrovat(sifra).token ?? '') : ''
  } catch {
    token = ''
  }
  if (!token) redirect(sParametrem(zpet, 'chyba', 'choice-bez-tokenu'))

  // Nejvýš jednou za minutu na připojení, pak test za firmu připojení
  // a ve frontě jako tlačítko (nejvýš jeden rozestup): souběžné kliky
  // téže firmy ani kliky mnoha firem nezaberou frontu ostatním
  // (migrace 20261031100000, lib/rezervace-choice-sync.ts).
  const test = await overitZnovu(token, v.tenantId, pripojeni.id, zacatek + 50_000)
  if (test === 'brzy') redirect(sParametrem(zpet, 'chyba', 'choice-overeno-chvili'))
  await zapsatVysledekTestu(supabase, pripojeni.id, test)

  revalidatePath(zpet)
  if (test.stav === 'ok') redirect(sParametrem(zpet, 'stav', 'choice-overeno'))
  redirect(sParametrem(zpet, 'chyba', test.druh === 'pristup' || test.druh === 'data' ? 'choice-test' : 'choice-test-pozdeji'))
}

/**
 * „Načíst teď“: jeden běh načítání hned (stejný jako naplánovaná úloha).
 * Smí správce napojení i ten, kdo na pobočce zapisuje rezervace. Hned po
 * předchozím běhu se nepustí (minuta) — limit Choice je společný.
 */
export async function nacistChoiceTed(formData: FormData): Promise<void> {
  const rozsah = text(formData, 'rozsah')
  const zpet = `/${rozsah}/rezervace/napojeni`
  const zacatek = Date.now()
  const v = await vstup(rozsah)
  if (!v) redirect(sParametrem(zpet, 'chyba', 'pravo'))

  const pripojeni = await pripojeniChoice(v, text(formData, 'id'))
  if (!pripojeni) redirect(sParametrem(zpet, 'chyba', 'pravo'))
  const smi = pripojeni.pobocka.zapis || (await hasAccess(v.tenantId, 'integrace.manage', pripojeni.branch_id))
  if (!smi) redirect(sParametrem(zpet, 'chyba', 'pravo'))
  if (pripojeni.stav !== 'pripojeno') redirect(sParametrem(zpet, 'chyba', 'choice-neovereno'))

  // Bez `uloha: true`: ve frontě se čeká jako tlačítko (nejvýš jeden
  // rozestup), naplánovaná úloha má přednost.
  const vysledek = await synchronizovatChoice(pripojeni.id, { konecMs: zacatek + 50_000, nejmeneOdMinulehoMs: 60_000 })

  revalidatePath(`/${rozsah}/rezervace`, 'layout')
  // Bez jediného dotazu (fronta firmy byla zabraná jiným během, třeba
  // naplánovanou úlohou) se nic nenačetlo — ne „část je načtená“.
  if (vysledek.stav === 'preskoceno' || (vysledek.pokracovani && vysledek.dotazu === 0)) redirect(sParametrem(zpet, 'chyba', 'choice-chvili'))
  if (vysledek.stav === 'chyba') redirect(sParametrem(zpet, 'chyba', 'choice-nacteni'))
  redirect(sParametrem(zpet, 'stav', vysledek.pokracovani ? 'choice-nacteno-cast' : 'choice-nacteno'))
}
