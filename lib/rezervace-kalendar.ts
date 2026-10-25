/**
 * Kalendář rezervací a akcí — počty dnů, týdnů a měsíců.
 *
 * Všechno pracuje s PROVOZNÍM DNEM jako textem „RRRR-MM-DD“ (sloupec
 * `rezervace.den`, který počítá databáze z pásma a začátku dne pobočky).
 * Den sám o sobě pásmo nemá, takže se tu počítá v UTC jen jako s čísly
 * — nikdy se z toho nedělá okamžik a nic se tu nečte z hodin serveru
 * (dnešek dodá stránka z `app.business_date`).
 *
 * Čistý modul — testuje ho scripts/rezervace.test.mjs.
 */

import { jePlatneDatum, pocitaSeDoHostu, type DruhRezervace, type StavRezervace } from './rezervace-typy.ts'

export type Pohled = 'den' | 'tyden' | 'mesic'

export const POHLEDY: readonly Pohled[] = ['den', 'tyden', 'mesic']

export const NAZVY_POHLEDU: Record<Pohled, string> = {
  den: 'Den',
  tyden: 'Týden',
  mesic: 'Měsíc',
}

function naDatum(iso: string): Date {
  const [r, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(r, m - 1, d))
}

function zDatumu(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function pridatDny(iso: string, dny: number): string {
  const d = naDatum(iso)
  d.setUTCDate(d.getUTCDate() + dny)
  return zDatumu(d)
}

/** Pondělí týdne, do kterého den patří (český týden začíná pondělím). */
export function pondeli(iso: string): string {
  const d = naDatum(iso)
  const posun = (d.getUTCDay() + 6) % 7
  return pridatDny(iso, -posun)
}

export function prvniDenMesice(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** Tentýž měsíc o `kolik` dál; den se přitom nastaví na první. */
export function posunoutMesic(iso: string, kolik: number): string {
  const [r, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(r, m - 1 + kolik, 1))
  return zDatumu(d)
}

/** Den z adresy, nebo dnešek, když v adrese nesmysl. */
export function denZAdresy(text: string | undefined | null, dnes: string): string {
  return text && jePlatneDatum(text) ? text : dnes
}

export function pohledZAdresy(text: string | undefined | null): Pohled {
  return (POHLEDY as readonly string[]).includes(text ?? '') ? (text as Pohled) : 'tyden'
}

/** Sedm dnů týdne od pondělí. */
export function dnyTydne(iso: string): string[] {
  const zacatek = pondeli(iso)
  return Array.from({ length: 7 }, (_, i) => pridatDny(zacatek, i))
}

export type DenMrizky = { den: string; vMesici: boolean }

/**
 * Mřížka měsíce po celých týdnech (pondělí–neděle). Dny sousedních
 * měsíců jsou v ní taky (`vMesici: false`), ať týden nezačíná uprostřed.
 */
export function mrizkaMesice(iso: string): DenMrizky[][] {
  const prvni = prvniDenMesice(iso)
  const mesic = prvni.slice(0, 7)
  let den = pondeli(prvni)
  const tydny: DenMrizky[][] = []
  do {
    const tyden: DenMrizky[] = []
    for (let i = 0; i < 7; i++) {
      tyden.push({ den, vMesici: den.slice(0, 7) === mesic })
      den = pridatDny(den, 1)
    }
    tydny.push(tyden)
  } while (den.slice(0, 7) === mesic)
  return tydny
}

/** Od–do (obojí včetně), které musí stránka načíst pro daný pohled. */
export function rozsahPohledu(pohled: Pohled, iso: string): { od: string; do: string } {
  if (pohled === 'den') return { od: iso, do: iso }
  if (pohled === 'tyden') {
    const dny = dnyTydne(iso)
    return { od: dny[0], do: dny[6] }
  }
  const tydny = mrizkaMesice(iso)
  return { od: tydny[0][0].den, do: tydny[tydny.length - 1][6].den }
}

/** Kam vedou šipky ‹ › pohledu. */
export function posunPohledu(pohled: Pohled, iso: string, smer: 1 | -1): string {
  if (pohled === 'den') return pridatDny(iso, smer)
  if (pohled === 'tyden') return pridatDny(pondeli(iso), 7 * smer)
  return posunoutMesic(iso, smer)
}

const DNY_KRATKE = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']
const DNY_DLOUHE = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle']
const MESICE_2P = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']
const MESICE_1P = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']

function poradiDne(iso: string): number {
  return (naDatum(iso).getUTCDay() + 6) % 7
}

export function jeVikend(iso: string): boolean {
  return poradiDne(iso) >= 5
}

/** „pá 30. 10.“ */
export function denKratce(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${DNY_KRATKE[poradiDne(iso)]} ${d}. ${m}.`
}

/** „Pátek 30. října 2026“ */
export function denDlouze(iso: string): string {
  const [r, m, d] = iso.split('-').map(Number)
  const nazev = DNY_DLOUHE[poradiDne(iso)]
  return `${nazev[0].toUpperCase()}${nazev.slice(1)} ${d}. ${MESICE_2P[m - 1]} ${r}`
}

export function nazevDneKratce(iso: string): string {
  return DNY_KRATKE[poradiDne(iso)]
}

/** „Říjen 2026“ */
export function nazevMesice(iso: string): string {
  const [r, m] = iso.split('-').map(Number)
  const n = MESICE_1P[m - 1]
  return `${n[0].toUpperCase()}${n.slice(1)} ${r}`
}

/** „26. 10. – 1. 11. 2026“ */
export function nazevTydne(iso: string): string {
  const dny = dnyTydne(iso)
  const [, m1, d1] = dny[0].split('-').map(Number)
  const [r2, m2, d2] = dny[6].split('-').map(Number)
  return `${d1}. ${m1}. – ${d2}. ${m2}. ${r2}`
}

export function nazevPohledu(pohled: Pohled, iso: string): string {
  if (pohled === 'den') return denDlouze(iso)
  if (pohled === 'tyden') return nazevTydne(iso)
  return nazevMesice(iso)
}

/** Co kalendář o rezervaci potřebuje vědět. */
export type RezervaceVKalendari = {
  id: string
  den: string
  druh: DruhRezervace
  stav: StavRezervace
  pocet_osob: number | null
}

export type SouhrnDne = {
  /** Rezervace (bez akcí), které se počítají — bez zrušených a nedorazivších. */
  rezervaci: number
  /** Akce, které se počítají. */
  akci: number
  /** Hosté rezervací i akcí, které se počítají; neznámý počet se nepočítá. */
  hostu: number
  /** Kolik počítaných záznamů nemá počet osob — aby „12 hostů“ nevypadalo jako celé číslo. */
  bezPoctu: number
  /** Zrušené a nedorazivší — jen pro informaci. */
  zrusenych: number
}

export function souhrnDne(rezervace: readonly RezervaceVKalendari[]): SouhrnDne {
  const s: SouhrnDne = { rezervaci: 0, akci: 0, hostu: 0, bezPoctu: 0, zrusenych: 0 }
  for (const r of rezervace) {
    if (!pocitaSeDoHostu(r.stav)) {
      s.zrusenych += 1
      continue
    }
    if (r.druh === 'akce') s.akci += 1
    else s.rezervaci += 1
    if (r.pocet_osob === null) s.bezPoctu += 1
    else s.hostu += r.pocet_osob
  }
  return s
}

/** Rozdělí rezervace podle provozního dne. */
export function podleDne<T extends { den: string }>(rezervace: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const r of rezervace) {
    const seznam = mapa.get(r.den)
    if (seznam) seznam.push(r)
    else mapa.set(r.den, [r])
  }
  return mapa
}

/** „12 hostů“, „1 host“, „3 hosté“ — a „+ 2 bez počtu“, když nějaký chybí. */
export function hosteText(s: Pick<SouhrnDne, 'hostu' | 'bezPoctu'>): string {
  const n = s.hostu
  const slovo = n === 1 ? 'host' : n >= 2 && n <= 4 ? 'hosté' : 'hostů'
  return s.bezPoctu > 0 ? `${n} ${slovo} + ${s.bezPoctu} bez počtu` : `${n} ${slovo}`
}
