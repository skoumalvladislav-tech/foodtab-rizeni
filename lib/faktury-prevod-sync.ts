import 'server-only'

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { klientUlohy } from './supabase/uloha.ts'
import { adresaStareDatabaze, pristupKFakturamUlohy as pristupKeStareDatabazi } from './supabase/faktury.ts'
import {
  SLOUPCE_HLAVNI,
  SLOUPCE_STARE,
  MAX_SMAZAT_BEZ_POTVRZENI,
  MAX_VELIKOST_PRILOHY,
  cestaPrilohy,
  cislaMereni,
  idEvidenceZOdkazu,
  jeVerejnySouborStare,
  mereniZdroje,
  naRadekHlavni,
  naRadekStare,
  naVzorHlavni,
  planNavratu,
  porovnat,
  procNeZpet,
  smazaniPovoleno,
  stabilniJson,
  typPrilohy,
  zakladNavratuPlati,
  zapomenoutChybuPrilohy,
  zapsatChybuPrilohy,
  zkusitPrilohu,
  type RadekHlavni,
  type ZaznamChybPriloh,
  type RadekStare,
  type VzorStary,
} from './faktury-prevod.ts'

/**
 * Převod faktur ze staré databáze (Supabase projekt ctqtwahlzhyjerqulqyn)
 * do hlavní — síť, databáze a úložiště. Čistá logika (převod řádku,
 * porovnání, plán návratu) je v lib/faktury-prevod.ts; návrh a pořadí
 * kroků v docs/faktury-slouceni-navrh.md.
 *
 * JEDINÉ místo v appce, které se ještě připojuje ke staré databázi
 * (hlídá scripts/faktury-tenant-izolace.test.mjs). Po úklidu zmizí celé.
 *
 * Spouští ho jen Šéfík (GitHub → Actions → „Faktury — převod do hlavní
 * databáze", adresa /api/prevod-faktur). Firma = vlastník staré databáze
 * z FAKTURY_DB_TENANT_ID — nikdy z požadavku.
 *
 * O tom, který krok kdy smí, rozhoduje DATABÁZE (stav faktury_prevod,
 * spouště app.faktury_brana a app.faktury_prevod_zdroj_brana, funkce
 * zahájení/dokončení/vrácení). Tady se stav kontroluje taky, ať krok
 * řekne proč, a ne až chybou z databáze uprostřed zápisu.
 */

export const REZIMY = ['nanecisto', 'zahajit', 'prevest', 'prilohy', 'dokoncit', 'zrusit', 'vratit', 'zpet_nanecisto', 'zpet'] as const
export type Rezim = (typeof REZIMY)[number]
/** Kroky, které něco zapisují — chtějí potvrzení (napsaný název kroku). */
export const ZAPISUJICI: ReadonlySet<Rezim> = new Set(['zahajit', 'prevest', 'prilohy', 'dokoncit', 'zrusit', 'vratit', 'zpet'])

export type VysledekPrevodu = {
  rezim: Rezim
  ok: boolean
  /** Věta pro člověka — proč krok nic neudělal / co dál. Bez dat faktur. */
  duvod: string | null
  /** Stav převodu PO kroku. */
  stav: string | null
  /** Jen čísla (odpověď končí ve veřejném logu GitHub Actions). */
  cisla: Record<string, number | string | boolean | null>
  /** Volat znovu (přílohy po dávkách, převod přes časový limit). */
  pokracovat: boolean
  /** Podrobnosti pro Šéfíka (id faktur, názvy polí) — workflow je do logu NEtiskne. */
  podrobnosti?: unknown
}

/** Kolik řádků smí převod smazat najednou bez výslovného potvrzení. */
const STRANKA = 1000
const DAVKA = 200

class Zastavit extends Error {}
const zastavit = (duvod: string): never => {
  throw new Zastavit(duvod)
}

/**
 * Chyba z databáze. Do věty (veřejný log GitHubu) jde jen krok a kód
 * chyby — text Postgresu umí obsahovat hodnoty z řádku (`invalid input
 * syntax … "<hodnota>"`), ten jde jen do podrobností odpovědi.
 */
class ChybaDatabaze extends Error {
  readonly detail: string
  readonly kod: string | null
  /** U kopírování příloh se chyba databáze bere jako přechodná (zkusit znovu). */
  readonly docasna = true
  constructor(co: string, error: { message: string; code?: string }) {
    super(`${co}: chyba databáze${error.code ? ` ${error.code}` : ''}`)
    this.detail = error.message
    this.kod = error.code ?? null
  }
}

/** Tabulka v hlavní databázi chybí — kód je venku dřív než db push. */
const TABULKA_CHYBI = new Set(['PGRST205', '42P01'])

function hodit(error: { message: string; code?: string } | null, co: string): void {
  if (error) throw new ChybaDatabaze(co, error)
}

type Kontext = {
  rezim: Rezim
  tenantId: string
  hlavni: SupabaseClient
  stara: SupabaseClient
  adresaStare: string
  konecMs: number
  /** Potvrzení smazání víc než MAX_SMAZAT_BEZ_POTVRZENI řádků. */
  smazatVic: boolean
  /** Přílohy: zkusit znovu i ty, které už jednou selhaly. */
  znovuChyby: boolean
}

// ---------------------------------------------------------------------
// Čtení
// ---------------------------------------------------------------------

/** Počet řádků samostatným dotazem (count=exact) — nezávisle na stránkování. */
async function pocetVeStare(stara: SupabaseClient, tabulka: 'invoices' | 'rejection_examples'): Promise<number> {
  const { count, error } = await stara.from(tabulka).select('id', { count: 'exact', head: true })
  hodit(error, `Stará databáze (${tabulka}, počet)`)
  if (typeof count !== 'number') zastavit(`Stará databáze nevrátila počet řádků (${tabulka}).`)
  return count as number
}

/**
 * Všechny řádky staré databáze, doslova (select=*), po stránkách podle id.
 * Jakákoli chyba stránky = konec (nikdy „co se načetlo, to platí"), a na
 * konci se počet porovná se samostatným count=exact — krátké čtení by
 * jinak převod vzal za to, že faktury ve staré databázi nejsou.
 */
async function nacistStare(stara: SupabaseClient): Promise<{ faktury: Record<string, unknown>[]; vzory: Record<string, unknown>[] }> {
  const pocet = await pocetVeStare(stara, 'invoices')
  const faktury: Record<string, unknown>[] = []
  let posledni: string | null = null
  for (;;) {
    let dotaz = stara.from('invoices').select('*').order('id', { ascending: true }).limit(STRANKA)
    if (posledni !== null) dotaz = dotaz.gt('id', posledni)
    const { data, error } = await dotaz
    hodit(error, 'Stará databáze (faktury)')
    const radky = (data ?? []) as Record<string, unknown>[]
    faktury.push(...radky)
    if (radky.length < STRANKA) break
    posledni = String(radky[radky.length - 1].id)
  }
  if (faktury.length !== pocet) {
    zastavit(`Stará databáze vrátila ${faktury.length} faktur, ale podle počtu jich má ${pocet} — převod se v tomhle běhu nedělá.`)
  }
  const sloupce = SLOUPCE_STARE.split(',').map((s) => s.trim())
  const chybiSloupec = sloupce.find((s) => faktury.length > 0 && !(s in faktury[0]))
  if (chybiSloupec) zastavit(`Ve staré databázi chybí sloupec ${chybiSloupec} — převod by ho ztratil.`)

  const pocetVzoru = await pocetVeStare(stara, 'rejection_examples')
  const { data: vzoryData, error: chybaVzoru } = await stara.from('rejection_examples').select('*').order('id', { ascending: true }).limit(STRANKA)
  hodit(chybaVzoru, 'Stará databáze (vzory odmítnutí)')
  const vzory = (vzoryData ?? []) as Record<string, unknown>[]
  if (vzory.length !== pocetVzoru) zastavit(`Stará databáze vrátila ${vzory.length} vzorů odmítnutí, podle počtu ${pocetVzoru}.`)
  return { faktury, vzory }
}

/** Faktury firmy v hlavní databázi (sloupce s protějškem ve staré). */
async function nacistHlavni(hlavni: SupabaseClient, tenantId: string): Promise<(RadekHlavni & { priloha_cesta: string | null; prevedeno_kdy: string | null })[]> {
  const { count, error: chybaPoctu } = await hlavni.from('faktury').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  hodit(chybaPoctu, 'Hlavní databáze (počet faktur)')
  const vse: (RadekHlavni & { priloha_cesta: string | null; prevedeno_kdy: string | null })[] = []
  let posledni: string | null = null
  for (;;) {
    let dotaz = hlavni.from('faktury').select(`${SLOUPCE_HLAVNI}, priloha_cesta, prevedeno_kdy`)
      .eq('tenant_id', tenantId).order('id', { ascending: true }).limit(STRANKA)
    if (posledni !== null) dotaz = dotaz.gt('id', posledni)
    const { data, error } = await dotaz
    hodit(error, 'Hlavní databáze (faktury)')
    const radky = (data ?? []) as unknown as (RadekHlavni & { priloha_cesta: string | null; prevedeno_kdy: string | null })[]
    vse.push(...radky)
    if (radky.length < STRANKA) break
    posledni = radky[radky.length - 1].id
  }
  if (vse.length !== (count ?? -1)) zastavit(`Hlavní databáze vrátila ${vse.length} faktur, podle počtu ${count}.`)
  return vse
}

/** Kopie staré databáze z hlavní (faktury_prevod_zdroj). */
async function nacistKopii(hlavni: SupabaseClient, tenantId: string, tabulka: 'invoices' | 'rejection_examples'): Promise<Map<string, Record<string, unknown>>> {
  const { count, error: chybaPoctu } = await hlavni.from('faktury_prevod_zdroj').select('klic', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('tabulka', tabulka)
  hodit(chybaPoctu, 'Kopie staré databáze (počet)')
  const kopie = new Map<string, Record<string, unknown>>()
  let posledni: string | null = null
  for (;;) {
    let dotaz = hlavni.from('faktury_prevod_zdroj').select('klic, radek')
      .eq('tenant_id', tenantId).eq('tabulka', tabulka).order('klic', { ascending: true }).limit(STRANKA)
    if (posledni !== null) dotaz = dotaz.gt('klic', posledni)
    const { data, error } = await dotaz
    hodit(error, 'Kopie staré databáze')
    const radky = (data ?? []) as { klic: string; radek: Record<string, unknown> }[]
    for (const r of radky) kopie.set(r.klic, r.radek)
    if (radky.length < STRANKA) break
    posledni = radky[radky.length - 1].klic
  }
  if (kopie.size !== (count ?? -1)) zastavit(`Kopie staré databáze vrátila ${kopie.size} řádků, podle počtu ${count}.`)
  return kopie
}

/** Záznam nepovedených příloh z faktury_prevod.prilohy (kopie — mění se a ukládá celý). */
function nactiZaznamPriloh(zaznam: Record<string, unknown>): ZaznamChybPriloh {
  return {
    chyby: { ...((zaznam.chyby as ZaznamChybPriloh['chyby'] | undefined) ?? {}) },
    docasne: { ...((zaznam.docasne as ZaznamChybPriloh['docasne'] | undefined) ?? {}) },
  }
}

async function stavPrevodu(hlavni: SupabaseClient, tenantId: string): Promise<{
  stav: string | null; prilohy: Record<string, unknown>; dokoncenoKdy: string | null; zpetHotovoKdy: string | null
}> {
  const { data, error } = await hlavni.from('faktury_prevod').select('stav, prilohy, dokonceno_kdy, zpet_hotovo_kdy')
    .eq('tenant_id', tenantId).maybeSingle()
  hodit(error, 'Stav převodu')
  return {
    stav: (data?.stav as string | undefined) ?? null,
    prilohy: (data?.prilohy as Record<string, unknown> | undefined) ?? {},
    dokoncenoKdy: (data?.dokonceno_kdy as string | null | undefined) ?? null,
    zpetHotovoKdy: (data?.zpet_hotovo_kdy as string | null | undefined) ?? null,
  }
}

// ---------------------------------------------------------------------
// Převod řádků (čistá funkce nad načtenými daty)
// ---------------------------------------------------------------------

function prevestVse(stare: Record<string, unknown>[], tenantId: string) {
  const prevedene: RadekHlavni[] = []
  const anomalie: { id: string; duvody: string[] }[] = []
  let normalizaci = 0
  for (const r of stare) {
    const v = naRadekHlavni(r as unknown as RadekStare, tenantId)
    if (v.ok) {
      prevedene.push(v.radek)
      normalizaci += v.normalizace.length
    } else {
      anomalie.push({ id: v.id, duvody: v.anomalie })
    }
  }
  return { prevedene, anomalie, normalizaci }
}

/** Párování a evidence, které ukazují na fakturu, jež ve staré databázi není. */
async function vsechnyPodleId<T extends { id: string }>(
  dotaz: (posledni: string | null) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>,
  co: string,
): Promise<T[]> {
  const vse: T[] = []
  let posledni: string | null = null
  for (;;) {
    const { data, error } = await dotaz(posledni)
    hodit(error, co)
    const radky = (data ?? []) as T[]
    vse.push(...radky)
    if (radky.length < STRANKA) return vse
    posledni = radky[radky.length - 1].id
  }
}

async function visiciOdkazy(hlavni: SupabaseClient, tenantId: string, idStare: ReadonlySet<string>) {
  const p = await vsechnyPodleId<{ id: string; faktura_id: string; stav: string }>((posledni) => {
    const d = hlavni.from('platby_faktury').select('id, faktura_id, stav').eq('tenant_id', tenantId).order('id').limit(STRANKA)
    return posledni ? d.gt('id', posledni) : d
  }, 'Párování plateb')
  const prijem = await vsechnyPodleId<{ id: string; faktura_id: string }>((posledni) => {
    const d = hlavni.from('faktury_prijem').select('id, faktura_id').eq('tenant_id', tenantId).not('faktura_id', 'is', null).order('id').limit(STRANKA)
    return posledni ? d.gt('id', posledni) : d
  }, 'Evidence příjmu')
  const visi = (id: string) => !idStare.has(id.trim().toLowerCase())
  return {
    parovani: p.length,
    parovani_bez_faktury_platna: p.filter((x) => x.stav !== 'zamitnuto' && visi(x.faktura_id)).length,
    parovani_bez_faktury_zrusena: p.filter((x) => x.stav === 'zamitnuto' && visi(x.faktura_id)).length,
    evidence_s_fakturou: prijem.length,
    evidence_bez_faktury: prijem.filter((x) => visi(x.faktura_id)).length,
  }
}

// ---------------------------------------------------------------------
// Kroky
// ---------------------------------------------------------------------

async function nanecisto(k: Kontext): Promise<VysledekPrevodu> {
  // Stará databáze PRVNÍ: krok musí jít i před db push (hlavní databáze
  // ještě nemá tabulky Faktur) — anomálie jsou tak vidět dřív, než se
  // cokoli nasadí, a plánované spouštění drží starou databázi vzhůru
  // (Free projekt po 7 dnech bez provozu usne; kontrola 19. 10., nález 10).
  const stare = await nacistStare(k.stara)
  const { prevedene, anomalie, normalizaci } = prevestVse(stare.faktury, k.tenantId)
  const m = mereniZdroje(stare.faktury as unknown as RadekStare[], stare.vzory.length)
  const verejne = stare.faktury.filter((r) => jeVerejnySouborStare(r.pdf_url as string | null, k.adresaStare)).length
  let stav: string | null
  try {
    ({ stav } = await stavPrevodu(k.hlavni, k.tenantId))
  } catch (e) {
    if (!(e instanceof ChybaDatabaze && TABULKA_CHYBI.has(e.kod ?? ''))) throw e
    return {
      rezim: k.rezim, ok: anomalie.length === 0, stav: null,
      duvod: anomalie.length > 0
        ? `${anomalie.length} faktur nejde převést beze ztráty — převod je nezahájí (podrobnosti v odpovědi). Hlavní databáze ještě nemá tabulky Faktur.`
        : 'Hlavní databáze ještě nemá tabulky Faktur (db push neproběhl) — čísla jen ze staré databáze, anomálie 0.',
      cisla: { ...cislaMereni(m, 'stara_'), anomalii: anomalie.length, normalizaci, stare_verejne_pdf: verejne },
      pokracovat: false,
      podrobnosti: { mereni: m, anomalie: anomalie.slice(0, 50) },
    }
  }
  const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
  const rozdil = porovnat(prevedene, hlavni)
  const idStare = new Set(stare.faktury.map((r) => String(r.id).trim().toLowerCase()))
  const odkazy = await visiciOdkazy(k.hlavni, k.tenantId, idStare)

  // Po dokončení: změnila se stará databáze od převodu? (Někdo do ní pořád
  // zapisuje — původní appka, n8n, náhled jiné větve.) Tohle se nesmí ztratit.
  // Ve stavu „vraceno" ne: tam do ní zapisuje sám návrat zpět.
  let zmenenoVeStare: number | null = null
  if (stav === 'dokonceno') {
    const kopie = await nacistKopii(k.hlavni, k.tenantId, 'invoices')
    zmenenoVeStare = stare.faktury.filter((r) => {
      const z = kopie.get(String(r.id))
      return !z || stabilniJson(z) !== stabilniJson(r)
    }).length + [...kopie.keys()].filter((id) => !idStare.has(id.toLowerCase())).length
  }

  return {
    rezim: k.rezim, ok: anomalie.length === 0, stav,
    duvod: anomalie.length > 0
      ? `${anomalie.length} faktur nejde převést beze ztráty (podrobnosti v odpovědi) — převod je nezahájí.`
      : zmenenoVeStare
        ? `Ve staré databázi se od převodu změnilo ${zmenenoVeStare} faktur — někdo do ní pořád zapisuje. Zjistit kdo a zastavit ho.`
        : null,
    cisla: {
      ...cislaMereni(m, 'stara_'),
      hlavni_faktur: hlavni.length,
      anomalii: anomalie.length,
      normalizaci,
      chybi_v_hlavni: rozdil.chybi.length,
      lisi_se: rozdil.lisi.length,
      navic_v_hlavni: rozdil.navic.length,
      stare_verejne_pdf: verejne,
      hlavni_s_kopii_pdf: hlavni.filter((r) => !!r.priloha_cesta).length,
      zmeneno_ve_stare_od_prevodu: zmenenoVeStare,
      ...odkazy,
    },
    pokracovat: false,
    podrobnosti: {
      mereni: m,
      anomalie: anomalie.slice(0, 50),
      lisi: rozdil.lisi.slice(0, 50),
      chybi: rozdil.chybi.slice(0, 50),
      navic: rozdil.navic.slice(0, 50),
    },
  }
}

async function zahajit(k: Kontext): Promise<VysledekPrevodu> {
  const s = await stavPrevodu(k.hlavni, k.tenantId)
  const stare = await nacistStare(k.stara)
  if (stare.faktury.length === 0) {
    zastavit('Stará databáze vrátila 0 faktur — zkontrolujte nastavení FAKTURY_SUPABASE_URL a klíč. Převod se nezahájil.')
  }
  const { prevedene, anomalie } = prevestVse(stare.faktury, k.tenantId)
  if (anomalie.length > 0) {
    zastavit(`${anomalie.length} faktur nejde převést beze ztráty — převod se nezahájil (Faktury zůstávají ve staré databázi). Podrobnosti v režimu nanecisto.`)
  }
  // Jen po vrácení DOKONČENÉHO převodu, dokud návrat není hotový: po
  // zrušení je stará databáze jediná pravda (kopie není stav z dokončení)
  // a po hotovém návratu jsou rozdíly změny staré appky — obojí převod
  // převezme (lib/faktury-prevod.ts, zakladNavratuPlati).
  if (zakladNavratuPlati(s)) {
    const zaklad = prevestVse([...(await nacistKopii(k.hlavni, k.tenantId, 'invoices')).values()], k.tenantId)
    const plan = planNavratu(zaklad.prevedene, await nacistHlavni(k.hlavni, k.tenantId), prevedene)
    const neprenesene = plan.vlozit.length + plan.upravit.length + plan.smazat.length + plan.konflikty.length
    if (neprenesene > 0) {
      zastavit(`Po vrácení zbývá ${neprenesene} změn z appky, které ve staré databázi nejsou (vložit ${plan.vlozit.length}, upravit ${plan.upravit.length}, smazat ${plan.smazat.length}, konflikty ${plan.konflikty.length}). Nový převod by je přepsal — nejdřív zpet (i při nulách označí návrat jako hotový), konflikty rozhodne člověk.`)
    }
  }
  const m = mereniZdroje(stare.faktury as unknown as RadekStare[], stare.vzory.length)
  const { data, error } = await k.hlavni.rpc('faktury_prevod_zahajit', {
    p_tenant: k.tenantId, p_zdroj: new URL(k.adresaStare).host, p_mereni: m,
  })
  hodit(error, 'Zahájení převodu')
  return { rezim: k.rezim, ok: true, stav: String(data), duvod: 'Faktury firmy jsou teď zavřené. Další krok: prevest.', cisla: cislaMereni(m, 'stara_'), pokracovat: false, podrobnosti: { mereni: m } }
}

async function prevest(k: Kontext): Promise<VysledekPrevodu> {
  const { stav, prilohy: zaznamPriloh, zpetHotovoKdy } = await stavPrevodu(k.hlavni, k.tenantId)
  const zaznamChyb = nactiZaznamPriloh(zaznamPriloh)
  if (stav !== 'probiha') zastavit(`Převádět jde jen po zahájení (stav teď: ${stav ?? 'nezahájen'}).`)

  const stare = await nacistStare(k.stara)
  const { prevedene, anomalie } = prevestVse(stare.faktury, k.tenantId)
  if (anomalie.length > 0) zastavit(`${anomalie.length} faktur nejde převést beze ztráty — nic se nezapsalo.`)
  const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
  const rozdil = porovnat(prevedene, hlavni)
  const podleIdHlavni = new Map(hlavni.map((r) => [r.id, r]))
  // Faktura vzniklá v appce, která ve staré databázi není: smazat ji smí
  // převod jen po hotovém návratu (zpet ji do staré databáze přenesl a stará
  // appka ji pak smazala). Jinak by převod smazal nepřenesenou práci z appky.
  const vznikleVAppce = rozdil.navic.filter((id) => podleIdHlavni.get(id)?.prevedeno_kdy === null)
  if (vznikleVAppce.length > 0 && zpetHotovoKdy === null) {
    zastavit(`${vznikleVAppce.length} faktur vzniklo v appce a ve staré databázi nejsou — převod by je smazal. Nic se nezapsalo (po vrácení nejdřív zpet).`)
  }
  if (!smazaniPovoleno(rozdil.navic.length, k.smazatVic)) {
    zastavit(`Převod by v hlavní databázi smazal ${rozdil.navic.length} faktur, které ve staré nejsou. To je víc než ${MAX_SMAZAT_BEZ_POTVRZENI} — nic se nezapsalo. Když je to v pořádku, spusťte převod s volbou „smazat víc".`)
  }

  const cisla = { kopie_zmenena: 0, kopie_smazana: 0, vlozeno: 0, upraveno: 0, smazano: 0, vzoru_vlozeno: 0 }
  const casDosel = () => Date.now() >= k.konecMs

  // 1. Doslovná kopie staré databáze (jen změněné řádky).
  for (const [tabulka, radky] of [['invoices', stare.faktury], ['rejection_examples', stare.vzory]] as const) {
    const kopie = await nacistKopii(k.hlavni, k.tenantId, tabulka)
    const zmenene = radky.filter((r) => {
      const z = kopie.get(String(r.id))
      return !z || stabilniJson(z) !== stabilniJson(r)
    })
    for (let i = 0; i < zmenene.length; i += DAVKA) {
      if (casDosel()) return pokracovatPozdeji(k, cisla)
      const { error } = await k.hlavni.from('faktury_prevod_zdroj').upsert(
        zmenene.slice(i, i + DAVKA).map((r) => ({ tenant_id: k.tenantId, tabulka, klic: String(r.id), radek: r, nacteno_kdy: new Date().toISOString() })),
        { onConflict: 'tenant_id,tabulka,klic' })
      hodit(error, 'Kopie staré databáze (zápis)')
      cisla.kopie_zmenena += Math.min(DAVKA, zmenene.length - i)
    }
    const idZdroje = new Set(radky.map((r) => String(r.id)))
    const navic = [...kopie.keys()].filter((id) => !idZdroje.has(id))
    for (let i = 0; i < navic.length; i += DAVKA) {
      const { error } = await k.hlavni.from('faktury_prevod_zdroj').delete()
        .eq('tenant_id', k.tenantId).eq('tabulka', tabulka).in('klic', navic.slice(i, i + DAVKA))
      hodit(error, 'Kopie staré databáze (mazání)')
      cisla.kopie_smazana += Math.min(DAVKA, navic.length - i)
    }
  }

  // 2. Chybějící faktury. Id nesmí patřit jiné firmě (id je globální klíč).
  const chybi = new Set(rozdil.chybi)
  const kVlozeni = prevedene.filter((r) => chybi.has(r.id))
  for (let i = 0; i < kVlozeni.length; i += DAVKA) {
    if (casDosel()) return pokracovatPozdeji(k, cisla)
    const davka = kVlozeni.slice(i, i + DAVKA)
    const { data: obsazene, error: chybaObsazenych } = await k.hlavni.from('faktury').select('id')
      .in('id', davka.map((r) => r.id)).neq('tenant_id', k.tenantId)
    hodit(chybaObsazenych, 'Kontrola id')
    if ((obsazene ?? []).length > 0) zastavit(`${(obsazene ?? []).length} faktur má id, které v hlavní databázi patří jiné firmě — převod se zastavil.`)
    const ted = new Date().toISOString()
    const { error } = await k.hlavni.from('faktury').insert(davka.map((r) => ({ ...r, prevedeno_kdy: ted })))
    hodit(error, 'Vložení faktur')
    cisla.vlozeno += davka.length
  }

  // 3. Odlišné faktury (stará databáze se mezi běhy změnila).
  const podleId = new Map(prevedene.map((r) => [r.id, r]))
  for (const { id } of rozdil.lisi) {
    if (casDosel()) return pokracovatPozdeji(k, cisla)
    const { id: _id, tenant_id: _t, ...pole } = podleId.get(id) as RadekHlavni
    const puvodni = podleIdHlavni.get(id)
    const odkazZmenen = puvodni !== undefined && puvodni.odkaz_pdf !== pole.odkaz_pdf
    const prilohaNeplati = odkazZmenen && !!puvodni?.priloha_cesta && !puvodni.priloha_cesta.includes('/rucne/')
    // Změněný odkaz = nová příloha: dřívější nepovedený pokus o kopii neplatí.
    if (odkazZmenen && zapomenoutChybuPrilohy(zaznamChyb, id)) {
      const { error: chybaPriloh } = await k.hlavni.from('faktury_prevod')
        .update({ prilohy: zaznamChyb }).eq('tenant_id', k.tenantId)
      hodit(chybaPriloh, 'Záznam nepovedených příloh')
    }
    const { error } = await k.hlavni.from('faktury').update({
      ...pole, prevedeno_kdy: new Date().toISOString(), ...(prilohaNeplati ? { priloha_cesta: null } : {}),
    }).eq('tenant_id', k.tenantId).eq('id', id)
    hodit(error, 'Oprava faktury')
    cisla.upraveno++
  }

  // 4. Faktury, které ve staré databázi už nejsou.
  for (const id of rozdil.navic) {
    if (casDosel()) return pokracovatPozdeji(k, cisla)
    const { error } = await k.hlavni.from('faktury').delete().eq('tenant_id', k.tenantId).eq('id', id)
    hodit(error, 'Smazání faktury, která ve staré databázi není')
    cisla.smazano++
  }

  // 5. Vzory odmítnutí (jen chybějící; puvodni_id je klíč).
  const { data: maVzory, error: chybaVzoru } = await k.hlavni.from('faktury_vzory_odmitnuti').select('puvodni_id')
    .eq('tenant_id', k.tenantId).not('puvodni_id', 'is', null)
  hodit(chybaVzoru, 'Vzory odmítnutí')
  const uzJsou = new Set(((maVzory ?? []) as { puvodni_id: number }[]).map((v) => Number(v.puvodni_id)))
  const noveVzory = []
  for (const v of stare.vzory) {
    const r = naVzorHlavni(v as unknown as VzorStary, k.tenantId)
    if (!r.ok) zastavit('Vzor odmítnutí nejde převést beze ztráty.')
    if (r.ok && !uzJsou.has(r.vzor.puvodni_id)) noveVzory.push(r.vzor)
  }
  if (noveVzory.length > 0) {
    const { error } = await k.hlavni.from('faktury_vzory_odmitnuti').insert(noveVzory)
    hodit(error, 'Vzory odmítnutí (zápis)')
    cisla.vzoru_vlozeno = noveVzory.length
  }

  return { rezim: k.rezim, ok: true, stav, duvod: 'Hotovo. Další krok: prilohy (opakovat, dokud „pokracovat"), pak nanecisto (rozdíly 0) a dokoncit.', cisla, pokracovat: false }
}

function pokracovatPozdeji(k: Kontext, cisla: Record<string, number>): VysledekPrevodu {
  return { rezim: k.rezim, ok: true, stav: 'probiha', duvod: 'Došel čas běhu — pokračuje se dalším voláním (nic se nezdvojí).', cisla, pokracovat: true }
}

// Funkce má 60 s (maxDuration v app/api/prevod-faktur), rozpočet kroku
// 45 s. Jedno stažení smí trvat až LIMIT_STAZENI_MS; další příloha se proto
// začne, jen když do konce rozpočtu zbývá aspoň REZERVA_POLOZKY_MS — i ta
// nejpomalejší skončí do 45 − 15 + 20 = 50 s a zbude čas na zápis.
// Hlídá scripts/faktury-prevod.test.mjs (rozpočet − rezerva + limit + 5 s ≤ 60 s).
const LIMIT_STAZENI_MS = 20_000
const REZERVA_POLOZKY_MS = 15_000
// Přechodnou chybu zkusit znovu nejdřív po 10 minutách — jinak by kola
// workflow zkoušela dokola tytéž soubory a na další by nedošlo.
const ZNOVU_DOCASNE_PO_MS = 10 * 60_000


/** Stáhne soubor ze starého veřejného úložiště — jen odtamtud, s limitem velikosti. */
async function stahnoutStarySoubor(odkaz: string): Promise<Uint8Array> {
  const odpoved = await fetch(odkaz, { redirect: 'error', signal: AbortSignal.timeout(LIMIT_STAZENI_MS) })
  if (!odpoved.ok || !odpoved.body) throw new Error(`HTTP ${odpoved.status}`)
  const delka = Number(odpoved.headers.get('content-length') ?? '0')
  if (delka > MAX_VELIKOST_PRILOHY) throw new Error('nad 10 MB')
  const casti: Uint8Array[] = []
  let celkem = 0
  const ctenar = odpoved.body.getReader()
  for (;;) {
    const { done, value } = await ctenar.read()
    if (done) break
    celkem += value.byteLength
    if (celkem > MAX_VELIKOST_PRILOHY) {
      await ctenar.cancel()
      throw new Error('nad 10 MB')
    }
    casti.push(value)
  }
  const data = new Uint8Array(celkem)
  let pozice = 0
  for (const c of casti) {
    data.set(c, pozice)
    pozice += c.byteLength
  }
  return data
}

async function prilohy(k: Kontext): Promise<VysledekPrevodu> {
  const { stav, prilohy: zaznam } = await stavPrevodu(k.hlavni, k.tenantId)
  if (stav !== 'probiha' && stav !== 'dokonceno') zastavit(`Přílohy se kopírují jen během převodu nebo po něm (stav teď: ${stav ?? 'nezahájen'}).`)
  // Trvalé chyby (404, nad 10 MB, typ) se počítají za „vykázané" a dokončení
  // je pustí; dočasné (503, vypršený čas) ne — ty se zkusí znovu.
  const z = nactiZaznamPriloh(zaznam)
  const { chyby, docasne } = z
  // Zápis hned po každé nepovedené příloze: když funkci zastaví limit
  // platformy, záznam se neztratí a příští běh tytéž soubory nezkouší hned.
  const ulozit = async () => {
    const { error } = await k.hlavni.from('faktury_prevod').update({ prilohy: z }).eq('tenant_id', k.tenantId)
    hodit(error, 'Záznam nepovedených příloh')
  }

  let zkopirovano = 0
  let zEvidence = 0
  let nepovedlo = 0
  let dosel = false
  let posledni: string | null = null
  stranky: for (;;) {
    // Jen odkazy do starého veřejného úložiště a na přílohy příjmu —
    // OneDrive a jiné odkazy se nekopírují (nejsou to soubory staré databáze).
    let dotaz = k.hlavni.from('faktury').select('id, odkaz_pdf')
      .eq('tenant_id', k.tenantId).is('priloha_cesta', null)
      .or('odkaz_pdf.like.*/storage/v1/object/public/*,odkaz_pdf.like.*/api/faktury/priloha/*')
      .order('id', { ascending: true }).limit(STRANKA)
    if (posledni !== null) dotaz = dotaz.gt('id', posledni)
    const { data, error } = await dotaz
    hodit(error, 'Faktury bez kopie přílohy')
    const strana = (data ?? []) as { id: string; odkaz_pdf: string }[]
    for (const f of strana) {
      if (!zkusitPrilohu(z, f.id, k.znovuChyby, Date.now(), ZNOVU_DOCASNE_PO_MS)) continue
      // Další přílohu začít, jen když stihne doběhnout i ta nejpomalejší.
      if (Date.now() + REZERVA_POLOZKY_MS >= k.konecMs) {
        dosel = true
        break stranky
      }
      try {
        let cesta: string
        const evidence = idEvidenceZOdkazu(f.odkaz_pdf)
        if (!evidence && !jeVerejnySouborStare(f.odkaz_pdf, k.adresaStare)) {
          // Vypadá jako starý veřejný soubor, ale nevede bezpečně do staré
          // databáze (jiný server, http, parametry) — nestahuje se nikdy.
          throw new Error('odkaz nevede bezpečně do staré databáze (jiný server, http nebo parametry)')
        }
        if (evidence) {
          // Faktura z vlastního příjmu: soubor už v soukromém úložišti je.
          // Odkaz na appku se NIKDY nestahuje (bez přihlášení vrátí stránku
          // s přihlášením a ta by se uložila jako „PDF").
          const { data: e, error: chybaE } = await k.hlavni.from('faktury_prijem').select('soubor_cesta')
            .eq('tenant_id', k.tenantId).eq('id', evidence).maybeSingle()
          hodit(chybaE, 'Evidence příjmu')
          if (!e?.soubor_cesta) throw new Error('evidence příjmu bez souboru')
          cesta = String(e.soubor_cesta)
          zEvidence++
        } else {
          const obsah = await stahnoutStarySoubor(f.odkaz_pdf)
          const typ = typPrilohy(obsah)
          if (!typ) throw new Error('nepodporovaný typ souboru (není PDF, JPEG, PNG, WebP ani XML)')
          cesta = cestaPrilohy(k.tenantId, obsah, typ.pripona)
          const nahrano = await k.hlavni.storage.from('faktury-prilohy').upload(cesta, obsah, { contentType: typ.mime, upsert: false })
          if (nahrano.error) {
            if (!/exist|duplicate/i.test(nahrano.error.message)) throw new Error(`úložiště: ${nahrano.error.message}`)
            // Cesta je otisk obsahu — „už existuje" smí být jen TENTÝŽ soubor.
            // Ověřit, ne věřit: kdyby tam ležel jiný, faktura by ukazovala na cizí.
            const { data: ulozeny } = await k.hlavni.storage.from('faktury-prilohy').download(cesta)
            const otisk = ulozeny ? createHash('sha256').update(new Uint8Array(await ulozeny.arrayBuffer())).digest('hex') : null
            if (!otisk || !cesta.includes(otisk)) throw new Error('pod stejnou cestou leží jiný soubor')
          }
        }
        const { error: chybaZapisu } = await k.hlavni.from('faktury').update({ priloha_cesta: cesta })
          .eq('tenant_id', k.tenantId).eq('id', f.id).is('priloha_cesta', null)
        hodit(chybaZapisu, 'Zápis cesty přílohy')
        if (zapomenoutChybuPrilohy(z, f.id)) await ulozit()
        zkopirovano++
      } catch (e) {
        zapsatChybuPrilohy(z, f.id, e, new Date().toISOString())
        nepovedlo++
        await ulozit()
      }
    }
    if (strana.length < STRANKA) break
    posledni = strana[strana.length - 1].id
  }

  // Kolik zbývá, počítá databáze (stejné pravidlo jako dokončení převodu:
  // dočasné chyby se do „vykázaných" nepočítají).
  const { data: mereni, error: chybaMereni } = await k.hlavni.rpc('faktury_prevod_mereni', { p_tenant: k.tenantId })
  hodit(chybaMereni, 'Měření příloh')
  const zbyva = Number((mereni as { prilohy?: { stare_bez_kopie_nevykazane?: number } } | null)?.prilohy?.stare_bez_kopie_nevykazane ?? 0)
  const trvale = Object.keys(chyby).length
  const docasnych = Object.keys(docasne).length
  return {
    rezim: k.rezim, ok: true, stav,
    duvod: dosel
      ? 'Došel čas běhu — pokračuje se dalším voláním.'
      : docasnych > 0
        ? `${docasnych} příloh se teď nepodařilo stáhnout (stará databáze neodpověděla nebo vypršel čas) — spusťte prilohy znovu za 10 minut; dokončení je do té doby nepustí.${trvale > 0 ? ` Trvale nepovedených: ${trvale} (důvody v podrobnostech).` : ''}`
        : trvale > 0
          ? `${trvale} příloh se nepodařilo zkopírovat (důvody v podrobnostech). Zkusit znovu: volba „znovu i chyby".`
          : null,
    cisla: { zkopirovano, z_evidence: zEvidence, nepovedlo_v_behu: nepovedlo, nepovedlo_trvale: trvale, nepovedlo_docasne: docasnych, zbyva },
    pokracovat: dosel && zkopirovano + nepovedlo > 0,
    podrobnosti: { chyby, docasne },
  }
}

async function dokoncit(k: Kontext): Promise<VysledekPrevodu> {
  const { stav } = await stavPrevodu(k.hlavni, k.tenantId)
  if (stav !== 'probiha') zastavit(`Dokončit jde jen probíhající převod (stav teď: ${stav ?? 'nezahájen'}).`)

  // Stará databáze se od posledního převodu nesmí změnit — jinak by se
  // otevřely Faktury s daty, která už neplatí (a změna by se ztratila).
  const stare = await nacistStare(k.stara)
  const kopie = await nacistKopii(k.hlavni, k.tenantId, 'invoices')
  const idStare = new Set(stare.faktury.map((r) => String(r.id)))
  const zmeneno = stare.faktury.filter((r) => {
    const z = kopie.get(String(r.id))
    return !z || stabilniJson(z) !== stabilniJson(r)
  }).length + [...kopie.keys()].filter((id) => !idStare.has(id)).length
  if (zmeneno > 0) {
    zastavit(`Stará databáze se od posledního převodu změnila (${zmeneno} faktur) — spusťte prevest a pak znovu dokoncit. Když se mění pořád, někdo do ní zapisuje (původní appka, n8n, náhled jiné větve) — nejdřív ho zastavit.`)
  }

  const { data, error } = await k.hlavni.rpc('faktury_prevod_dokoncit', {
    p_tenant: k.tenantId, p_pocet_zdroje: stare.faktury.length, p_pocet_vzoru: stare.vzory.length,
  })
  hodit(error, 'Dokončení převodu')
  const r = data as { ok: boolean; duvody?: string[]; mereni?: Record<string, Record<string, unknown>>; porovnani?: Record<string, unknown>; doplneno_platby?: number; doplneno_prijem?: number }
  const m = r.mereni ?? {}
  return {
    rezim: k.rezim, ok: r.ok, stav: r.ok ? 'dokonceno' : 'probiha',
    duvod: r.ok ? 'Faktury jsou otevřené. Zkontrolujte obrazovky (Přehled, Seznam, Platby).' : (r.duvody ?? []).join(' '),
    cisla: {
      stara_faktur: Number(m.stara?.pocet ?? 0), hlavni_faktur: Number(m.hlavni?.pocet ?? 0),
      lisi_se: Number(r.porovnani?.lisi ?? 0), chybi: Number(r.porovnani?.chybi ?? 0), navic: Number(r.porovnani?.navic ?? 0),
      doplneno_parovani: r.doplneno_platby ?? 0, doplneno_evidence: r.doplneno_prijem ?? 0,
      parovani_bez_faktury_platna: Number(m.parovani?.bez_faktury_platnych ?? 0),
      // Trvale nepovedené přílohy dokončení pustí (vykázané) — ať je jejich
      // počet vidět i v logu dokončení, ne jen u kroku prilohy.
      nepodarene_prilohy: Number(m.prilohy?.nepodarene ?? 0),
    },
    pokracovat: false,
    podrobnosti: r,
  }
}

async function zrusit(k: Kontext): Promise<VysledekPrevodu> {
  const { data, error } = await k.hlavni.rpc('faktury_prevod_zrusit', { p_tenant: k.tenantId })
  hodit(error, 'Zrušení převodu')
  return { rezim: k.rezim, ok: true, stav: String(data), duvod: 'Převod zrušený, stará databáze zůstává platná. Další krok: vrátit kód appky BEZ souboru migrace (návod, oddíl Návrat zpět). Nový pokus: zahajit.', cisla: {}, pokracovat: false }
}

async function vratit(k: Kontext): Promise<VysledekPrevodu> {
  const { data, error } = await k.hlavni.rpc('faktury_prevod_vratit', { p_tenant: k.tenantId })
  hodit(error, 'Vrácení převodu')
  return { rezim: k.rezim, ok: true, stav: String(data), duvod: 'Faktury v appce jsou zavřené. Další krok: zpet_nanecisto, zpet (i při nulách — označí návrat jako hotový), pak vrátit kód appky BEZ souboru migrace.', cisla: {}, pokracovat: false }
}

async function zpet(k: Kontext, zapsat: boolean): Promise<VysledekPrevodu> {
  const s = await stavPrevodu(k.hlavni, k.tenantId)
  if (s.stav !== 'vraceno') zastavit(`Zpět se přenáší jen po vrácení (režim vratit; stav teď: ${s.stav ?? 'nezahájen'}).`)
  // Po zrušení (převod nedoběhl) nebo po hotovém návratu se do staré
  // databáze nepíše NIC — ani nanečisto se neukazuje plán, který by
  // k zápisu sváděl (lib/faktury-prevod.ts, procNeZpet).
  const proc = procNeZpet(s)
  if (proc) return { rezim: k.rezim, ok: true, stav: s.stav, duvod: proc, cisla: {}, pokracovat: false }

  const kopie = await nacistKopii(k.hlavni, k.tenantId, 'invoices')
  const zaklad = prevestVse([...kopie.values()], k.tenantId)
  const naplanovat = async () => {
    const stare = await nacistStare(k.stara)
    const stara = prevestVse(stare.faktury, k.tenantId)
    if (zaklad.anomalie.length > 0 || stara.anomalie.length > 0) zastavit('Kopii nebo starou databázi nejde porovnat beze ztráty — nic se nezapsalo.')
    const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
    return { hlavni, plan: planNavratu(zaklad.prevedene, hlavni, stara.prevedene) }
  }
  const { hlavni, plan } = await naplanovat()
  // Co návrat zpět NEPŘENESE (stará databáze na to nemá místo) — vykázat.
  const { count: vzoryJenVAppce, error: chybaVzoru } = await k.hlavni.from('faktury_vzory_odmitnuti')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', k.tenantId).is('puvodni_id', null)
  hodit(chybaVzoru, 'Vzory odmítnutí')
  const cisla = {
    vlozit: plan.vlozit.length, upravit: plan.upravit.length, smazat: plan.smazat.length,
    konfliktu: plan.konflikty.length, zmenena_jen_ve_stare: plan.zmenenaJenVeStare.length, jen_ve_stare: plan.jenVeStare.length,
    rucni_prilohy_jen_v_appce: hlavni.filter((h) => h.priloha_cesta?.includes('/rucne/')).length,
    vzory_odmitnuti_jen_v_appce: vzoryJenVAppce ?? 0,
    vlozeno: 0, upraveno: 0, smazano: 0,
  }
  const podrobnosti = { konflikty: plan.konflikty.slice(0, 100), zmenenaJenVeStare: plan.zmenenaJenVeStare.slice(0, 100), jenVeStare: plan.jenVeStare.slice(0, 100) }

  if (!zapsat) {
    return {
      rezim: k.rezim, ok: plan.konflikty.length === 0, stav: s.stav,
      duvod: plan.konflikty.length > 0
        ? `${plan.konflikty.length} faktur se změnilo v appce i ve staré databázi — ty se nepřenesou, rozhodne člověk (podrobnosti v odpovědi).`
        : 'Nanečisto. Krok zpet přenese čísla vlozit/upravit/smazat a návrat označí jako hotový — pusťte ho i při samých nulách.',
      cisla, pokracovat: false, podrobnosti,
    }
  }

  // Druhá linie proti mazání ve staré databázi (jediné platné po návratu).
  if (!smazaniPovoleno(plan.smazat.length, k.smazatVic)) {
    zastavit(`Návrat by ve staré databázi smazal ${plan.smazat.length} faktur — víc než ${MAX_SMAZAT_BEZ_POTVRZENI}. Nic se nezapsalo. Když je to v pořádku (faktury smazané v appce), spusťte zpet s volbou „smazat víc".`)
  }
  const dosel = () => Date.now() >= k.konecMs
  const pokracovat = (): VysledekPrevodu => ({ rezim: k.rezim, ok: true, stav: s.stav, duvod: 'Došel čas běhu — pokračuje se dalším voláním.', cisla, pokracovat: true })
  for (const r of plan.vlozit) {
    if (dosel()) return pokracovat()
    const radek: Record<string, unknown> = { ...naRadekStare(r) }
    const { error } = await k.stara.from('invoices').insert(radek)
    hodit(error, 'Stará databáze (vložení)')
    // Spoušť staré databáze mohla stav přepsat na „Duplicitní…" — vrátit.
    const { id: _id, ...pole } = radek
    const { error: chybaOpravy } = await k.stara.from('invoices').update(pole).eq('id', r.id)
    hodit(chybaOpravy, 'Stará databáze (srovnání po vložení)')
    cisla.vlozeno++
  }
  for (const r of plan.upravit) {
    if (dosel()) return pokracovat()
    const { id: _id, ...pole } = naRadekStare(r)
    const { error } = await k.stara.from('invoices').update(pole).eq('id', r.id)
    hodit(error, 'Stará databáze (oprava)')
    cisla.upraveno++
  }
  for (const id of plan.smazat) {
    if (dosel()) return pokracovat()
    const { error } = await k.stara.from('invoices').delete().eq('id', id)
    hodit(error, 'Stará databáze (smazání)')
    cisla.smazano++
  }

  // Ověřit novým plánem a teprve s nulou návrat označit jako hotový — od
  // té chvíle jsou rozdíly staré databáze změny staré appky.
  const po = (await naplanovat()).plan
  const zbyva = po.vlozit.length + po.upravit.length + po.smazat.length + po.konflikty.length
  if (zbyva === 0) {
    const { error } = await k.hlavni.rpc('faktury_prevod_zpet_hotovo', { p_tenant: k.tenantId })
    hodit(error, 'Označení návratu')
  }
  return {
    rezim: k.rezim, ok: zbyva === 0, stav: s.stav,
    duvod: zbyva === 0
      ? 'Přeneseno a ověřeno — návrat zpět je hotový. Další krok: vrátit kód appky BEZ souboru migrace (návod, oddíl Návrat zpět).'
      : po.konflikty.length > 0
        ? `Přeneseno, ale ${po.konflikty.length} faktur se změnilo v appce i ve staré databázi — rozhodne člověk (podrobnosti v odpovědi). Návrat není hotový.`
        : `Přeneseno, ale nový plán ještě ukazuje ${zbyva} změn — spusťte zpet znovu.`,
    cisla: { ...cisla, zbyva_po_prenosu: zbyva },
    pokracovat: false,
    podrobnosti: { ...podrobnosti, konflikty: po.konflikty.slice(0, 100) },
  }
}

// ---------------------------------------------------------------------
// Vstup
// ---------------------------------------------------------------------

export async function provestKrok(
  rezim: Rezim,
  moznosti: { konecMs: number; smazatVic?: boolean; znovuChyby?: boolean },
): Promise<VysledekPrevodu> {
  const prazdny = (duvod: string): VysledekPrevodu => ({ rezim, ok: false, duvod, stav: null, cisla: {}, pokracovat: false })
  const hlavni = klientUlohy()
  if (!hlavni) return prazdny('Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')
  const tenantId = (process.env.FAKTURY_DB_TENANT_ID ?? '').trim().toLowerCase()
  if (!tenantId) return prazdny('Chybí FAKTURY_DB_TENANT_ID — není jasné, které firmě stará databáze patří.')
  const stara = pristupKeStareDatabazi(tenantId)
  if (stara.stav !== 'ok') return prazdny('Stará databáze Faktur není nastavená (FAKTURY_SUPABASE_URL / FAKTURY_SUPABASE_ANON_KEY).')

  const k: Kontext = {
    rezim, tenantId, hlavni, stara: stara.faktury, adresaStare: adresaStareDatabaze(),
    konecMs: moznosti.konecMs, smazatVic: moznosti.smazatVic === true, znovuChyby: moznosti.znovuChyby === true,
  }

  // Zámek: dva zapisující běhy najednou by si přepisovaly kopii a přílohy.
  // Zahájení a vrácení zamyká řádek stavu databáze sama.
  const zamykat = ZAPISUJICI.has(rezim) && rezim !== 'zahajit' && rezim !== 'vratit' && rezim !== 'zrusit'
  if (zamykat) {
    const { data, error } = await hlavni.rpc('faktury_prevod_zamek', { p_tenant: tenantId, p_zabrat: true })
    if (error) return prazdny('Zámek převodu se nepodařilo zabrat.')
    if (data !== true) return prazdny('Převod už běží jinde (nebo není zahájený) — zkuste to za dvě minuty.')
  }
  try {
    switch (rezim) {
      case 'nanecisto': return await nanecisto(k)
      case 'zahajit': return await zahajit(k)
      case 'prevest': return await prevest(k)
      case 'prilohy': return await prilohy(k)
      case 'dokoncit': return await dokoncit(k)
      case 'zrusit': return await zrusit(k)
      case 'vratit': return await vratit(k)
      case 'zpet_nanecisto': return await zpet(k, false)
      case 'zpet': return await zpet(k, true)
    }
    return prazdny('Neznámý krok.')
  } catch (e) {
    if (e instanceof Zastavit) return prazdny(e.message)
    // Do věty (veřejný log) jen krok a kód; text chyby jen do podrobností.
    if (e instanceof ChybaDatabaze) return { ...prazdny(e.message), podrobnosti: { chyba: e.detail } }
    return { ...prazdny('Neočekávaná chyba úlohy převodu.'), podrobnosti: { chyba: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }
  } finally {
    if (zamykat) await hlavni.rpc('faktury_prevod_zamek', { p_tenant: tenantId, p_zabrat: false })
  }
}
