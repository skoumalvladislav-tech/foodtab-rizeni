/**
 * Tržby z pokladen pro přehledy (Finance → Tržby, Finance → Přehled) —
 * čistá logika, žádné IO.
 *
 * Zdroj je `public.pokladna_prehled_trzeb` (20261012200000): jeden JSON
 * s tržbami, platbami po druhu, rozpadem po způsobu a příjmy na bankovní
 * účty, po dnech / měsících / rocích a po pobočkách. Tady se z něj jen
 * skládá — řádky tabulky, součty, pobočky. Nic se nedopočítává:
 *   * období bez prodejů je „bez dat", ne „nula" (pokladna ho ještě
 *     nemusela stáhnout, nebo bylo zavřeno — appka neví, co z toho);
 *   * platby jsou jen za dny, kdy je pokladna poslala (`dnuSPlatbami`) —
 *     historie před 12. 10. 2026 je nemá, dokud ji synchronizace znovu
 *     nedožene; přehled to musí říct, ne tvářit se, že součet sedí;
 *   * banka `null` = volající transakce nevidí (nemá `finance.read` za
 *     celou firmu), ne „nic nepřišlo".
 *
 * Datum je PROVOZNÍ den pobočky (`lib/pokladna-cas.ts`), `obdobi` první
 * den dne/měsíce/roku.
 *
 * Testy: `scripts/pokladna-trzby.test.mjs`.
 */

import type { DruhPlatby } from './pos-provider-contract.ts'

export type Cleneni = 'den' | 'mesic' | 'rok'

export const CLENENI: readonly Cleneni[] = ['den', 'mesic', 'rok']

/** Pořadí sloupců v přehledu — nejčastější vlevo. */
export const DRUHY_PLATEB: readonly DruhPlatby[] = ['hotovost', 'karta', 'stravenky', 'poukaz', 'prevod', 'online', 'rozvoz', 'odpis', 'jine']

export const NAZVY_DRUHU_PLATEB: Readonly<Record<DruhPlatby, string>> = {
  hotovost: 'Hotovost',
  karta: 'Karta',
  stravenky: 'Stravenky a benefity',
  poukaz: 'Poukazy',
  prevod: 'Převod a QR',
  online: 'Online',
  rozvoz: 'Rozvoz',
  odpis: 'Odpisy',
  jine: 'Jiné',
}

export type TrzbaObdobi = { obdobi: string; branchId: string; trzbaHaleru: number; polozek: number; dnu: number; dnuSPlatbami: number }
export type PlatbaObdobi = { obdobi: string; branchId: string; druh: DruhPlatby; castkaHaleru: number; pocet: number }
export type ZpusobPlatby = { branchId: string; zpusob: string; nazev: string; druh: DruhPlatby; castkaHaleru: number; pocet: number }
/** `branchId` null = firemní účet bez pobočky. */
export type BankaObdobi = { obdobi: string; branchId: string | null; prijmyHaleru: number }

export type PrehledTrzeb = {
  trzby: TrzbaObdobi[]
  platby: PlatbaObdobi[]
  zpusoby: ZpusobPlatby[]
  banka: BankaObdobi[]
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/

function chyba(co: string): never {
  throw new Error(`Přehled tržeb: neplatná odpověď databáze (${co}).`)
}
function datum(v: unknown, co: string): string {
  return typeof v === 'string' && DATUM.test(v) ? v : chyba(co)
}
function id(v: unknown, co: string): string {
  return typeof v === 'string' && v.length > 0 ? v : chyba(co)
}
/** Celé číslo; bigint chodí z PostgRESTu jako číslo. Text nebo null NESMÍ projít jako nula. */
function cele(v: unknown, co: string, min = Number.MIN_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : chyba(co)
}
function druh(v: unknown, co: string): DruhPlatby {
  return typeof v === 'string' && (DRUHY_PLATEB as readonly string[]).includes(v) ? (v as DruhPlatby) : chyba(co)
}
function seznam(v: unknown, co: string): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : chyba(co)
}

/** JSON z `pokladna_prehled_trzeb` → typy appky. Cokoli nečekaného VYHODÍ — radši chyba než tichá nula. */
export function prevestPrehled(data: unknown): PrehledTrzeb {
  const o = (data && typeof data === 'object' ? data : chyba('není objekt')) as Record<string, unknown>
  return {
    trzby: seznam(o.trzby, 'trzby').map((r) => ({
      obdobi: datum(r.obdobi, 'trzby.obdobi'),
      branchId: id(r.branch_id, 'trzby.branch_id'),
      trzbaHaleru: cele(r.trzba_haleru, 'trzby.trzba_haleru', 0),
      polozek: cele(r.polozek, 'trzby.polozek', 0),
      dnu: cele(r.dnu, 'trzby.dnu', 0),
      dnuSPlatbami: cele(r.dnu_s_platbami, 'trzby.dnu_s_platbami', 0),
    })),
    platby: seznam(o.platby, 'platby').map((r) => ({
      obdobi: datum(r.obdobi, 'platby.obdobi'),
      branchId: id(r.branch_id, 'platby.branch_id'),
      druh: druh(r.druh, 'platby.druh'),
      castkaHaleru: cele(r.castka_haleru, 'platby.castka_haleru'),
      pocet: cele(r.pocet, 'platby.pocet', 0),
    })),
    zpusoby: seznam(o.zpusoby, 'zpusoby').map((r) => ({
      branchId: id(r.branch_id, 'zpusoby.branch_id'),
      zpusob: id(r.zpusob, 'zpusoby.zpusob'),
      nazev: typeof r.nazev === 'string' && r.nazev.trim() ? r.nazev : chyba('zpusoby.nazev'),
      druh: druh(r.druh, 'zpusoby.druh'),
      castkaHaleru: cele(r.castka_haleru, 'zpusoby.castka_haleru'),
      pocet: cele(r.pocet, 'zpusoby.pocet', 0),
    })),
    banka: seznam(o.banka, 'banka').map((r) => ({
      obdobi: datum(r.obdobi, 'banka.obdobi'),
      branchId: r.branch_id === null ? null : id(r.branch_id, 'banka.branch_id'),
      prijmyHaleru: cele(r.prijmy_haleru, 'banka.prijmy_haleru', 0),
    })),
  }
}

// ---------------------------------------------------------------------
// Období
// ---------------------------------------------------------------------

function iso(r: number, m: number, d: number): string {
  return new Date(Date.UTC(r, m - 1, d)).toISOString().slice(0, 10)
}
/** Rozebere ISO datum; 13. měsíc nebo 31. 2. VYHODÍ (Date.UTC by je potichu přelil dál). */
function rozebrat(d: string): [number, number, number] {
  const casti: [number, number, number] = [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))]
  if (!DATUM.test(d) || iso(...casti) !== d) throw new Error(`Neplatné datum „${d}".`)
  return casti
}

/** První den období, do kterého `d` patří. */
export function zacatekObdobi(d: string, cleneni: Cleneni): string {
  const [r, m, den] = rozebrat(d)
  if (cleneni === 'rok') return iso(r, 1, 1)
  if (cleneni === 'mesic') return iso(r, m, 1)
  return iso(r, m, den)
}

/** Začátek dalšího období. */
export function dalsiObdobi(obdobi: string, cleneni: Cleneni): string {
  const [r, m, d] = rozebrat(obdobi)
  if (cleneni === 'rok') return iso(r + 1, 1, 1)
  if (cleneni === 'mesic') return iso(r, m + 1, 1)
  return iso(r, m, d + 1)
}

/** Začátky všech období, která zasahují do `od`–`doData` (včetně), vzestupně. */
export function obdobiVRozsahu(od: string, doData: string, cleneni: Cleneni): string[] {
  const vysledek: string[] = []
  for (let o = zacatekObdobi(od, cleneni); o <= doData; o = dalsiObdobi(o, cleneni)) {
    vysledek.push(o)
    if (vysledek.length > 1000) throw new Error('Příliš mnoho období najednou.')
  }
  return vysledek
}

const MESICE = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec']
const DNY = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']

/** „po 12. 10." / „Říjen 2026" / „2026". */
export function popisObdobi(obdobi: string, cleneni: Cleneni): string {
  const [r, m, d] = rozebrat(obdobi)
  if (cleneni === 'rok') return String(r)
  if (cleneni === 'mesic') return `${MESICE[m - 1]} ${r}`
  return `${DNY[new Date(Date.UTC(r, m - 1, d)).getUTCDay()]} ${d}. ${m}.`
}

// ---------------------------------------------------------------------
// Skládání
// ---------------------------------------------------------------------

export type PlatbyPoDruhu = Partial<Record<DruhPlatby, number>>

export type SouhrnTrzeb = {
  trzbaHaleru: number
  polozek: number
  /** Dní s prodeji / z nich s platbami (platby pokrývají jen ty druhé). */
  dnu: number
  dnuSPlatbami: number
  platbyPoDruhu: PlatbyPoDruhu
  platbyCelkemHaleru: number
  /** `null` = banku volající nevidí. */
  bankaHaleru: number | null
}

export type RadekObdobi = SouhrnTrzeb & { obdobi: string }

function prazdnySouhrn(bankaVidi: boolean): SouhrnTrzeb {
  return { trzbaHaleru: 0, polozek: 0, dnu: 0, dnuSPlatbami: 0, platbyPoDruhu: {}, platbyCelkemHaleru: 0, bankaHaleru: bankaVidi ? 0 : null }
}

function pricistPlatbu(s: SouhrnTrzeb, d: DruhPlatby, castka: number) {
  s.platbyPoDruhu[d] = (s.platbyPoDruhu[d] ?? 0) + castka
  s.platbyCelkemHaleru += castka
}

export type Rozsah = {
  /** `null` = celá firma (všechny pobočky + firemní bankovní účty). */
  branchId: string | null
  /** Vidí volající transakce? Bez toho je banka `null`, ne 0. */
  bankaVidi: boolean
}

/**
 * Řádek za každé období (`obdobi` z `obdobiVRozsahu`), sečtený přes
 * pobočky rozsahu. U jedné pobočky se banka bere jen z jejích účtů —
 * firemní účet bez pobočky k žádné provozovně nepatří.
 */
export function radkyPoObdobich(p: PrehledTrzeb, obdobi: readonly string[], rozsah: Rozsah): RadekObdobi[] {
  const mapa = new Map<string, RadekObdobi>(obdobi.map((o) => [o, { obdobi: o, ...prazdnySouhrn(rozsah.bankaVidi) }]))
  const patri = (b: string | null) => rozsah.branchId === null || b === rozsah.branchId
  for (const t of p.trzby) {
    const r = mapa.get(t.obdobi)
    if (!r || !patri(t.branchId)) continue
    r.trzbaHaleru += t.trzbaHaleru
    r.polozek += t.polozek
    r.dnu += t.dnu
    r.dnuSPlatbami += t.dnuSPlatbami
  }
  for (const z of p.platby) {
    const r = mapa.get(z.obdobi)
    if (r && patri(z.branchId)) pricistPlatbu(r, z.druh, z.castkaHaleru)
  }
  if (rozsah.bankaVidi) {
    for (const b of p.banka) {
      const r = mapa.get(b.obdobi)
      if (r && patri(b.branchId)) r.bankaHaleru = (r.bankaHaleru ?? 0) + b.prijmyHaleru
    }
  }
  return obdobi.map((o) => mapa.get(o)!)
}

/** Součet řádků (řádek „Celkem"). */
export function soucet(radky: readonly SouhrnTrzeb[], bankaVidi: boolean): SouhrnTrzeb {
  const s = prazdnySouhrn(bankaVidi)
  for (const r of radky) {
    s.trzbaHaleru += r.trzbaHaleru
    s.polozek += r.polozek
    s.dnu += r.dnu
    s.dnuSPlatbami += r.dnuSPlatbami
    for (const d of DRUHY_PLATEB) if (r.platbyPoDruhu[d] !== undefined) pricistPlatbu(s, d, r.platbyPoDruhu[d]!)
    if (bankaVidi && r.bankaHaleru !== null) s.bankaHaleru = (s.bankaHaleru ?? 0) + r.bankaHaleru
  }
  return s
}

export type RadekPobocky = SouhrnTrzeb & { branchId: string | null }

/**
 * Součet za celé období po pobočkách (pořadí podle `pobocky`). Pobočka
 * bez tržeb i plateb i banky se vynechá. Firemní bankovní účty (bez
 * pobočky) dostanou vlastní řádek `branchId: null` — jen když něco mají.
 */
export function radkyPoPobockach(p: PrehledTrzeb, pobocky: readonly string[], bankaVidi: boolean): RadekPobocky[] {
  const vsechny = [...pobocky]
  for (const t of p.trzby) if (!vsechny.includes(t.branchId)) vsechny.push(t.branchId)
  for (const z of p.platby) if (!vsechny.includes(z.branchId)) vsechny.push(z.branchId)
  const radky: RadekPobocky[] = []
  for (const b of vsechny) {
    const r: RadekPobocky = { branchId: b, ...prazdnySouhrn(bankaVidi) }
    for (const t of p.trzby) if (t.branchId === b) {
      r.trzbaHaleru += t.trzbaHaleru; r.polozek += t.polozek; r.dnu += t.dnu; r.dnuSPlatbami += t.dnuSPlatbami
    }
    for (const z of p.platby) if (z.branchId === b) pricistPlatbu(r, z.druh, z.castkaHaleru)
    if (bankaVidi) for (const x of p.banka) if (x.branchId === b) r.bankaHaleru = (r.bankaHaleru ?? 0) + x.prijmyHaleru
    if (r.dnu > 0 || r.platbyCelkemHaleru !== 0 || (r.bankaHaleru ?? 0) !== 0) radky.push(r)
  }
  if (bankaVidi) {
    const firemni = p.banka.filter((x) => x.branchId === null).reduce((s, x) => s + x.prijmyHaleru, 0)
    if (firemni !== 0) radky.push({ branchId: null, ...prazdnySouhrn(true), bankaHaleru: firemni })
  }
  return radky
}

/** Způsoby platby za celé období, sečtené přes pobočky rozsahu, od největší částky. */
export function zpusobyVRozsahu(p: PrehledTrzeb, branchId: string | null): Omit<ZpusobPlatby, 'branchId'>[] {
  const mapa = new Map<string, Omit<ZpusobPlatby, 'branchId'>>()
  for (const z of p.zpusoby) {
    if (branchId !== null && z.branchId !== branchId) continue
    const r = mapa.get(z.zpusob) ?? { zpusob: z.zpusob, nazev: z.nazev, druh: z.druh, castkaHaleru: 0, pocet: 0 }
    r.castkaHaleru += z.castkaHaleru
    r.pocet += z.pocet
    mapa.set(z.zpusob, r)
  }
  return [...mapa.values()].sort((a, b) => b.castkaHaleru - a.castkaHaleru || a.zpusob.localeCompare(b.zpusob))
}

/** Druhy plateb, které se v řádcích vyskytují, v pevném pořadí (sloupce tabulky). */
export function pouziteDruhy(radky: readonly SouhrnTrzeb[]): DruhPlatby[] {
  return DRUHY_PLATEB.filter((d) => radky.some((r) => r.platbyPoDruhu[d] !== undefined))
}

/** Tržba jednoho období (KPI na Přehledu) — přes všechny pobočky, které volající vidí. */
export function trzbaObdobi(p: PrehledTrzeb, obdobi: string): { trzbaHaleru: number; maData: boolean } {
  let trzbaHaleru = 0
  let maData = false
  for (const t of p.trzby) if (t.obdobi === obdobi) { trzbaHaleru += t.trzbaHaleru; maData = true }
  return { trzbaHaleru, maData }
}
