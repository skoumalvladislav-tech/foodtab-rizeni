import 'server-only'

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { klientUlohy } from './supabase/uloha.ts'
import { adresaStareDatabaze, pristupKFakturamUlohy as pristupKeStareDatabazi } from './supabase/faktury.ts'
import {
  SLOUPCE_HLAVNI,
  SLOUPCE_STARE,
  MAPA_SLOUPCU,
  MAX_VELIKOST_PRILOHY,
  cestaPrilohy,
  halereNaCastku,
  idEvidenceZOdkazu,
  jeVerejnySouborStare,
  mereniZdroje,
  naRadekHlavni,
  naVzorHlavni,
  planNavratu,
  porovnat,
  stabilniJson,
  typPrilohy,
  type Mereni,
  type RadekHlavni,
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

export const REZIMY = ['nanecisto', 'zahajit', 'prevest', 'prilohy', 'dokoncit', 'vratit', 'zpet_nanecisto', 'zpet'] as const
export type Rezim = (typeof REZIMY)[number]
/** Kroky, které něco zapisují — chtějí potvrzení (napsaný název kroku). */
export const ZAPISUJICI: ReadonlySet<Rezim> = new Set(['zahajit', 'prevest', 'prilohy', 'dokoncit', 'vratit', 'zpet'])

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
export const MAX_SMAZAT_BEZ_POTVRZENI = 20
const STRANKA = 1000
const DAVKA = 200

class Zastavit extends Error {}
const zastavit = (duvod: string): never => {
  throw new Zastavit(duvod)
}

function hodit(error: { message: string; code?: string } | null, co: string): void {
  if (error) throw new Error(`${co}: ${error.message}`)
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
  return kopie
}

async function stavPrevodu(hlavni: SupabaseClient, tenantId: string): Promise<{ stav: string | null; prilohy: Record<string, unknown> }> {
  const { data, error } = await hlavni.from('faktury_prevod').select('stav, prilohy').eq('tenant_id', tenantId).maybeSingle()
  hodit(error, 'Stav převodu')
  return { stav: (data?.stav as string | undefined) ?? null, prilohy: (data?.prilohy as Record<string, unknown> | undefined) ?? {} }
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
async function visiciOdkazy(hlavni: SupabaseClient, tenantId: string, idStare: ReadonlySet<string>) {
  const { data: platby, error } = await hlavni.from('platby_faktury').select('faktura_id, stav').eq('tenant_id', tenantId)
  hodit(error, 'Párování plateb')
  const { data: prijem, error: chybaPrijmu } = await hlavni.from('faktury_prijem').select('faktura_id').eq('tenant_id', tenantId).not('faktura_id', 'is', null)
  hodit(chybaPrijmu, 'Evidence příjmu')
  const p = (platby ?? []) as { faktura_id: string; stav: string }[]
  const visi = (id: string) => !idStare.has(id.trim().toLowerCase())
  return {
    parovani: p.length,
    parovani_bez_faktury_platna: p.filter((x) => x.stav !== 'zamitnuto' && visi(x.faktura_id)).length,
    parovani_bez_faktury_zrusena: p.filter((x) => x.stav === 'zamitnuto' && visi(x.faktura_id)).length,
    evidence_s_fakturou: (prijem ?? []).length,
    evidence_bez_faktury: ((prijem ?? []) as { faktura_id: string }[]).filter((x) => visi(x.faktura_id)).length,
  }
}

const cislaMereni = (m: Mereni, predpona: string) => ({
  [`${predpona}faktur`]: m.pocet,
  [`${predpona}archivovanych`]: m.archivovanych,
  [`${predpona}duplicit`]: m.duplicit,
  [`${predpona}s_odkazem_pdf`]: m.s_odkazem_pdf,
  [`${predpona}castka_czk_haleru`]: m.castky_haleru.CZK ?? 0,
  [`${predpona}men`]: Object.keys(m.castky_haleru).length,
  [`${predpona}vzoru`]: m.vzoru,
})

// ---------------------------------------------------------------------
// Kroky
// ---------------------------------------------------------------------

async function nanecisto(k: Kontext): Promise<VysledekPrevodu> {
  const { stav } = await stavPrevodu(k.hlavni, k.tenantId)
  const stare = await nacistStare(k.stara)
  const { prevedene, anomalie, normalizaci } = prevestVse(stare.faktury, k.tenantId)
  const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
  const rozdil = porovnat(prevedene, hlavni)
  const idStare = new Set(stare.faktury.map((r) => String(r.id).trim().toLowerCase()))
  const odkazy = await visiciOdkazy(k.hlavni, k.tenantId, idStare)
  const m = mereniZdroje(stare.faktury as unknown as RadekStare[], stare.vzory.length)

  // Po dokončení: změnila se stará databáze od převodu? (Někdo do ní pořád
  // zapisuje — původní appka, n8n, náhled jiné větve.) Tohle se nesmí ztratit.
  let zmenenoVeStare: number | null = null
  if (stav === 'dokonceno' || stav === 'vraceno') {
    const kopie = await nacistKopii(k.hlavni, k.tenantId, 'invoices')
    zmenenoVeStare = stare.faktury.filter((r) => {
      const z = kopie.get(String(r.id))
      return !z || stabilniJson(z) !== stabilniJson(r)
    }).length + [...kopie.keys()].filter((id) => !idStare.has(id.toLowerCase())).length
  }

  const verejne = stare.faktury.filter((r) => jeVerejnySouborStare(r.pdf_url as string | null, k.adresaStare)).length
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
      anomalie: anomalie.slice(0, 50),
      lisi: rozdil.lisi.slice(0, 50),
      chybi: rozdil.chybi.slice(0, 50),
      navic: rozdil.navic.slice(0, 50),
    },
  }
}

async function zahajit(k: Kontext): Promise<VysledekPrevodu> {
  const stare = await nacistStare(k.stara)
  if (stare.faktury.length === 0) {
    zastavit('Stará databáze vrátila 0 faktur — zkontrolujte nastavení FAKTURY_SUPABASE_URL a klíč. Převod se nezahájil.')
  }
  const { anomalie } = prevestVse(stare.faktury, k.tenantId)
  if (anomalie.length > 0) {
    zastavit(`${anomalie.length} faktur nejde převést beze ztráty — převod se nezahájil (Faktury zůstávají ve staré databázi). Podrobnosti v režimu nanecisto.`)
  }
  const m = mereniZdroje(stare.faktury as unknown as RadekStare[], stare.vzory.length)
  const { data, error } = await k.hlavni.rpc('faktury_prevod_zahajit', {
    p_tenant: k.tenantId, p_zdroj: new URL(k.adresaStare).host, p_mereni: m,
  })
  hodit(error, 'Zahájení převodu')
  return { rezim: k.rezim, ok: true, stav: String(data), duvod: 'Faktury firmy jsou teď zavřené. Další krok: prevest.', cisla: cislaMereni(m, 'stara_'), pokracovat: false }
}

async function prevest(k: Kontext): Promise<VysledekPrevodu> {
  const { stav } = await stavPrevodu(k.hlavni, k.tenantId)
  if (stav !== 'probiha') zastavit(`Převádět jde jen po zahájení (stav teď: ${stav ?? 'nezahájen'}).`)

  const stare = await nacistStare(k.stara)
  const { prevedene, anomalie } = prevestVse(stare.faktury, k.tenantId)
  if (anomalie.length > 0) zastavit(`${anomalie.length} faktur nejde převést beze ztráty — nic se nezapsalo.`)
  const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
  const rozdil = porovnat(prevedene, hlavni)
  if (rozdil.navic.length > MAX_SMAZAT_BEZ_POTVRZENI && !k.smazatVic) {
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
    const { error } = await k.hlavni.from('faktury').update({ ...pole, prevedeno_kdy: new Date().toISOString() })
      .eq('tenant_id', k.tenantId).eq('id', id)
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

/** Stáhne soubor ze starého veřejného úložiště — jen odtamtud, s limitem velikosti. */
async function stahnoutStarySoubor(odkaz: string): Promise<Uint8Array> {
  const odpoved = await fetch(odkaz, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
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
  const chyby: Record<string, string> = { ...((zaznam.chyby as Record<string, string> | undefined) ?? {}) }

  const { data, error } = await k.hlavni.from('faktury').select('id, odkaz_pdf')
    .eq('tenant_id', k.tenantId).is('priloha_cesta', null).not('odkaz_pdf', 'is', null).order('id', { ascending: true })
  hodit(error, 'Faktury bez kopie přílohy')
  const kandidati = ((data ?? []) as { id: string; odkaz_pdf: string }[])
    .filter((f) => idEvidenceZOdkazu(f.odkaz_pdf) || jeVerejnySouborStare(f.odkaz_pdf, k.adresaStare))
    .filter((f) => k.znovuChyby || !(f.id in chyby))
  if (k.znovuChyby) for (const f of kandidati) delete chyby[f.id]

  let zkopirovano = 0
  let zEvidence = 0
  let nepovedlo = 0
  for (const f of kandidati) {
    if (Date.now() >= k.konecMs) break
    try {
      let cesta: string
      const evidence = idEvidenceZOdkazu(f.odkaz_pdf)
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
      zkopirovano++
    } catch (e) {
      chyby[f.id] = (e instanceof Error ? e.message : String(e)).slice(0, 200)
      nepovedlo++
    }
  }

  const { error: chybaZaznamu } = await k.hlavni.from('faktury_prevod').update({ prilohy: { chyby } }).eq('tenant_id', k.tenantId)
  hodit(chybaZaznamu, 'Záznam nepovedených příloh')

  const zbyva = kandidati.length - zkopirovano - nepovedlo
  return {
    rezim: k.rezim, ok: true, stav,
    duvod: zbyva > 0 ? 'Došel čas běhu — pokračuje se dalším voláním.' : nepovedlo > 0 || Object.keys(chyby).length > 0
      ? `${Object.keys(chyby).length} příloh se nepodařilo zkopírovat (důvody v podrobnostech). Zkusit znovu: volba „znovu i chyby".`
      : null,
    cisla: { kandidatu: kandidati.length, zkopirovano, z_evidence: zEvidence, nepovedlo_v_behu: nepovedlo, nepovedlo_celkem: Object.keys(chyby).length, zbyva },
    pokracovat: zbyva > 0 && zkopirovano + nepovedlo > 0,
    podrobnosti: { chyby },
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
    },
    pokracovat: false,
    podrobnosti: r,
  }
}

async function vratit(k: Kontext): Promise<VysledekPrevodu> {
  const { data, error } = await k.hlavni.rpc('faktury_prevod_vratit', { p_tenant: k.tenantId })
  hodit(error, 'Vrácení převodu')
  return { rezim: k.rezim, ok: true, stav: String(data), duvod: 'Faktury v appce jsou zavřené. Další krok: zpet_nanecisto, zpet, pak vrátit předchozí verzi appky.', cisla: {}, pokracovat: false }
}

/** Řádek hlavní databáze → zápis do staré (staré názvy, částka jako text pro numeric). */
function doStare(r: RadekHlavni): Record<string, unknown> {
  const radek: Record<string, unknown> = { id: r.id }
  for (const [stary, novy, druh] of MAPA_SLOUPCU) {
    radek[stary] = druh === 'castka' ? halereNaCastku(r[novy] as number) : r[novy]
  }
  return radek
}

async function zpet(k: Kontext, zapsat: boolean): Promise<VysledekPrevodu> {
  const { stav } = await stavPrevodu(k.hlavni, k.tenantId)
  if (stav !== 'vraceno') zastavit(`Zpět se přenáší jen po vrácení (režim vratit; stav teď: ${stav ?? 'nezahájen'}).`)

  const kopie = await nacistKopii(k.hlavni, k.tenantId, 'invoices')
  const zaklad = prevestVse([...kopie.values()], k.tenantId)
  const stare = await nacistStare(k.stara)
  const stara = prevestVse(stare.faktury, k.tenantId)
  if (zaklad.anomalie.length > 0 || stara.anomalie.length > 0) zastavit('Kopii nebo starou databázi nejde porovnat beze ztráty — nic se nezapsalo.')
  const hlavni = await nacistHlavni(k.hlavni, k.tenantId)
  const plan = planNavratu(zaklad.prevedene, hlavni, stara.prevedene)
  const cisla = {
    vlozit: plan.vlozit.length, upravit: plan.upravit.length, smazat: plan.smazat.length,
    konfliktu: plan.konflikty.length, zmenena_jen_ve_stare: plan.zmenenaJenVeStare.length, jen_ve_stare: plan.jenVeStare.length,
    nove_s_prilohou_jen_v_appce: plan.vlozit.filter((r) => !!hlavni.find((h) => h.id === r.id)?.priloha_cesta).length,
    vlozeno: 0, upraveno: 0, smazano: 0,
  }

  if (zapsat) {
    for (const r of plan.vlozit) {
      if (Date.now() >= k.konecMs) return { rezim: k.rezim, ok: true, stav, duvod: 'Došel čas běhu — pokračuje se dalším voláním.', cisla, pokracovat: true }
      const radek: Record<string, unknown> = { ...doStare(r), created_at: r.vytvoreno_kdy }
      const { error } = await k.stara.from('invoices').insert(radek)
      hodit(error, 'Stará databáze (vložení)')
      // Spoušť staré databáze mohla stav přepsat na „Duplicitní…" — vrátit.
      const { id: _id, ...pole } = radek
      const { error: chybaOpravy } = await k.stara.from('invoices').update(pole).eq('id', r.id)
      hodit(chybaOpravy, 'Stará databáze (srovnání po vložení)')
      cisla.vlozeno++
    }
    for (const r of plan.upravit) {
      if (Date.now() >= k.konecMs) return { rezim: k.rezim, ok: true, stav, duvod: 'Došel čas běhu — pokračuje se dalším voláním.', cisla, pokracovat: true }
      const { id: _id, ...pole } = doStare(r)
      const { error } = await k.stara.from('invoices').update(pole).eq('id', r.id)
      hodit(error, 'Stará databáze (oprava)')
      cisla.upraveno++
    }
    for (const id of plan.smazat) {
      if (Date.now() >= k.konecMs) return { rezim: k.rezim, ok: true, stav, duvod: 'Došel čas běhu — pokračuje se dalším voláním.', cisla, pokracovat: true }
      const { error } = await k.stara.from('invoices').delete().eq('id', id)
      hodit(error, 'Stará databáze (smazání)')
      cisla.smazano++
    }
  }

  return {
    rezim: k.rezim, ok: plan.konflikty.length === 0, stav,
    duvod: plan.konflikty.length > 0
      ? `${plan.konflikty.length} faktur se změnilo v appce i ve staré databázi — ty se nepřenesly, rozhodne člověk (podrobnosti v odpovědi).`
      : zapsat ? 'Přeneseno. Spusťte zpet_nanecisto — má hlásit 0 k přenesení — a pak vraťte předchozí verzi appky.' : null,
    cisla,
    pokracovat: false,
    podrobnosti: { konflikty: plan.konflikty.slice(0, 100), zmenenaJenVeStare: plan.zmenenaJenVeStare.slice(0, 100), jenVeStare: plan.jenVeStare.slice(0, 100) },
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
  const zamykat = ZAPISUJICI.has(rezim) && rezim !== 'zahajit' && rezim !== 'vratit'
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
      case 'vratit': return await vratit(k)
      case 'zpet_nanecisto': return await zpet(k, false)
      case 'zpet': return await zpet(k, true)
    }
    return prazdny('Neznámý krok.')
  } catch (e) {
    if (e instanceof Zastavit) return prazdny(e.message)
    // Text chyby z databáze nese jen popis kroku a hlášku Postgresu, ne data faktur.
    return prazdny((e instanceof Error ? e.message : String(e)).slice(0, 300))
  } finally {
    if (zamykat) await hlavni.rpc('faktury_prevod_zamek', { p_tenant: tenantId, p_zabrat: false })
  }
}
