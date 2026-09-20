/**
 * Rozdělení měsíce na stránky — JEDNO pro Excel i PDF.
 *
 * Kolik lidí je na kterém listu (stránce) se rozhoduje tady a nikde jinde.
 * PDF podle toho kreslí stránky, sešit podle toho dělá listy; kdyby si
 * každý počítal dělení sám, vyšly by z týchž dat jednou dvě strany a jednou
 * jedna (patnáct lidí: PDF jedna stránka, sešit dva listy).
 *
 * Jak se to počítá — geometrie A4 na výšku v bodech, viz `vyberRozlozeni`.
 * Excel má sloupce v jiných jednotkách a tiskne se zmenšený na stránku,
 * ale dělení lidí přebírá; jak velké písmo vyjde, si dopočítá sám.
 */

import { jmenaNalezato, radkyDoSirky, rozdelitLidi, type DilSmeny, type ExportMesice, type SloupecExportu } from './rozpis-export.ts'
import { sirkaTextu } from './pdf-zapis.ts'

/** A4 na výšku v bodech (1 bod = 1/72″). */
export const A4_SIRKA = 595
export const A4_VYSKA = 842
export const OKRAJ = 28

/** Kde končí záhlaví stránky (nadpis měsíce) a kde začíná tabulka. */
export const ZACATEK_OBSAHU = OKRAJ + 24
export const PATA_STRANKY = 18
/** Nejníž, kam smí sahat tabulka a poznámky; pod tím je zápatí. */
export const DOLNI_HRANICE = A4_VYSKA - OKRAJ - PATA_STRANKY

export const DEN_SIRKA = 34
/** Největší a nejmenší písmo času směny. Pod 6 bodů se lidé dělí na víc stránek. */
export const F_MAX = 9
export const F_MIN = 6
export const F_JMENO = 7
export const F_POZICE = 5.5
export const VYSKA_POZNAMEK_MAX = 34

export type Velikosti = { cas: number; pobocka: number; pauza: number; den: number }
export const velikosti = (f: number): Velikosti => ({
  cas: f,
  pobocka: Math.max(4.5, f * 0.85),
  pauza: Math.max(4.5, f * 0.8),
  den: Math.min(f, 8),
})
export const RADEK = 1.3 // mezera pod řádkem textu

export const vyskaSouctu = (f: number) => f + 6

export const RADEK_ZAHLAVI = 8
export const RADEK_POZICE = 6.5

/**
 * Vejdou se jména do sloupce naležato (po slovech na nejvýš tři řádky)?
 * Pak se nic neotáčí — vodorovné jméno se čte samo a záhlaví je nižší,
 * takže na stránku zbude víc místa (Šéfík 20. 9. 2026).
 */
export function nalezato(lide: SloupecExportu[], sirkaSloupce: number): boolean {
  return jmenaNalezato(lide, (t) => sirkaTextu(t, F_JMENO, 'tucne') <= sirkaSloupce - 5)
}

/** Řádky jména (a pozice) pod sebou; prázdné, když se to má otočit. */
export function radkyZahlavi(c: SloupecExportu, sirkaSloupce: number): { jmeno: string[]; pozice: string[] } {
  const vejde = (t: string) => sirkaTextu(t, F_JMENO, 'tucne') <= sirkaSloupce - 5
  return {
    jmeno: radkyDoSirky(c.jmeno, vejde) ?? [],
    pozice: c.pozice ? (radkyDoSirky(c.pozice, (t) => sirkaTextu(t, F_POZICE) <= sirkaSloupce - 5) ?? []) : [],
  }
}

/** Výška záhlaví: naležato podle počtu řádků, otočené podle nejdelšího jména. */
export function vyskaZahlavi(lide: SloupecExportu[], sirkaSloupce: number): number {
  if (nalezato(lide, sirkaSloupce)) {
    const radku = Math.max(
      1,
      ...lide.map((c) => {
        const r = radkyZahlavi(c, sirkaSloupce)
        return r.jmeno.length + r.pozice.length
      }),
    )
    return Math.max(22, radku * RADEK_ZAHLAVI + 8)
  }
  const nejdelsi = Math.max(0, ...lide.map((c) => Math.max(sirkaTextu(c.jmeno, F_JMENO, 'tucne'), sirkaTextu(c.pozice, F_POZICE))))
  return Math.min(96, Math.max(44, nejdelsi + 8))
}

/** Výška buňky = řádky času, pobočky a pauzy všech směn dne. */
export function vyskaBunky(dily: DilSmeny[], v: Velikosti, sPobockou: boolean): number {
  return dily.reduce((h, d) => h + v.cas + RADEK + (sPobockou && d.pobocka ? v.pobocka + RADEK : 0) + (d.pauza ? v.pauza + RADEK : 0), 0)
}

/** Výška dne = nejvyšší buňka toho dne (+ vzduch); nejméně jeden řádek. */
export function vyskaDne(den: string, lide: SloupecExportu[], v: Velikosti, sPobockou: boolean): number {
  const nej = Math.max(0, ...lide.map((c) => vyskaBunky(c.podleDne.get(den) ?? [], v, sPobockou)))
  return Math.max(v.cas + 4.5, nej + 3)
}

export type Rozlozeni = {
  /** Lidé po stránkách; každá část má celý měsíc. */
  casti: SloupecExportu[][]
  /** Písmo času směny v bodech. */
  f: number
  sirkaSloupce: number
  /**
   * Měsíc se nevešel na výšku ani při nejmenším písmu, tak se láme na další
   * stránku (lidé zůstávají pohromadě). Jinak má každá část celý měsíc na jedné.
   */
  lomiMesic: boolean
}

/**
 * Vybere počet stránek a písmo. Možnosti jsou dvě a vyhrává ta, která dá
 * míň papíru:
 *
 *   A) lidé se rozdělí na části a každá se svým celým měsícem vyjde na
 *      jednu stránku (s co největším písmem); zkouší se 1, 2, 3… části,
 *   B) lidé zůstanou pohromadě (nejméně částí, na které se při nejmenším
 *      písmu vejde šířka) a měsíc se lámá na další stránku.
 *
 * Výška se měří pro každou část zvlášť — s méně lidmi bývá řádek nižší.
 */
export function vyberRozlozeni(m: ExportMesice): Rozlozeni {
  const lide = m.sloupce
  const sirkaObsahu = A4_SIRKA - 2 * OKRAJ
  let nejsirsiCas = 0 // šířka nejdelšího času při písmu 1 bod
  for (const c of lide) {
    for (const dily of c.podleDne.values()) {
      for (const d of dily) nejsirsiCas = Math.max(nejsirsiCas, sirkaTextu(`${d.kratce}${d.nevydana ? '*' : ''}`, 1))
    }
  }
  const dostupna = DOLNI_HRANICE - ZACATEK_OBSAHU
  const pocetLidi = Math.max(1, lide.length)
  const sirkaPro = (naStranu: number) => (sirkaObsahu - DEN_SIRKA) / naStranu
  const vyskaCasti = (cast: SloupecExportu[], f: number, sirkaSloupce: number) => {
    const v = velikosti(f)
    return (
      vyskaZahlavi(cast, sirkaSloupce) +
      m.dny.reduce((k, den) => k + vyskaDne(den, cast, v, m.vicePobocek), 0) +
      vyskaSouctu(f) +
      VYSKA_POZNAMEK_MAX
    )
  }
  const rozdel = (pocetCasti: number) => rozdelitLidi(lide, Math.ceil(lide.length / pocetCasti))
  const nejvicVCasti = (casti: SloupecExportu[][]) => Math.max(...casti.map((c) => c.length), 1)

  // A) každá část s celým měsícem na jedné stránce.
  let a: (Rozlozeni & { stranek: number }) | null = null
  for (let pocetCasti = 1; pocetCasti <= pocetLidi && !a; pocetCasti++) {
    const casti = rozdel(pocetCasti)
    const sirkaSloupce = sirkaPro(nejvicVCasti(casti))
    for (let f = F_MAX; f >= F_MIN - 1e-9; f -= 0.5) {
      if (nejsirsiCas * f + 3 > sirkaSloupce) continue
      if (casti.every((cast) => vyskaCasti(cast, f, sirkaSloupce) <= dostupna)) {
        a = { casti, f, sirkaSloupce, lomiMesic: false, stranek: casti.length }
        break
      }
    }
  }

  // B) lidé pohromadě, měsíc se láme na další stránku.
  let pocetCastiB = 1
  while (pocetCastiB < pocetLidi && nejsirsiCas * F_MIN + 3 > sirkaPro(nejvicVCasti(rozdel(pocetCastiB)))) pocetCastiB++
  const castiB = rozdel(pocetCastiB)
  const sirkaB = sirkaPro(nejvicVCasti(castiB))
  const stranekB = castiB.reduce((k, cast) => k + Math.max(1, Math.ceil(vyskaCasti(cast, F_MIN, sirkaB) / dostupna)), 0)

  if (a && a.stranek <= stranekB) return a
  return { casti: castiB, f: F_MIN, sirkaSloupce: sirkaPro(nejvicVCasti(castiB)), lomiMesic: stranekB > castiB.length }
}
