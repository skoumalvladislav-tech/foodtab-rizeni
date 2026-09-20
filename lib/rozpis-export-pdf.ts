/**
 * Měsíční rozpis jako PDF — stránky z modelu `ExportMesice`.
 *
 * ---------------------------------------------------------------------
 * CELÝ MĚSÍC NA JEDNÉ STRÁNCE A4 NA VÝŠKU
 *
 * Dny jsou v řádcích, lidé ve sloupcích (záhlaví jmen je otočené o 90°,
 * aby sloupec mohl být úzký). Sloupec je široký asi jako čas směny
 * („8–16“, „16–23:30“), takže na šířku 539 bodů se vejde kolem dvaceti
 * lidí. Písmo se volí největší, při kterém se celý měsíc (28–31 řádků)
 * vejde na výšku i na šířku; klesne-li pod 6 bodů, lidé se rozdělí na
 * víc stránek (každá má celý měsíc, jen část lidí) a písmo se zvětší.
 *
 * Úseky ani pobočky se nekreslí jako záhlaví. Kdo pracuje na víc
 * pobočkách, má pobočku pod časem směny — celým názvem, když se vejde,
 * jinak zkratkou (vysvětlenou v poznámce pod tabulkou).
 *
 * Kdyby se ani při nejmenším písmu nevešel měsíc na výšku (hodně dvojitých
 * směn a poboček pod časy), řádky pokračují na další stránce se záhlavím
 * znovu — všichni lidé zůstanou pohromadě, jen měsíc se zlomí.
 */

import { jeVikend } from './rozpis-mobil.ts'
import {
  hodinyCislem,
  jmenaNalezato,
  pauzaKratce,
  popisDne,
  radkyDoSirky,
  rozdelitLidi,
  vetyPoznamky,
  zalomitVety,
  type DilSmeny,
  type ExportMesice,
  type PobockaExportu,
  type SloupecExportu,
} from './rozpis-export.ts'
import { sirkaTextu, StrankaPdf, zapsatPdf, zkratitText, type Barva } from './pdf-zapis.ts'

/** A4 na výšku v bodech (1 bod = 1/72″). */
export const A4_SIRKA = 595
export const A4_VYSKA = 842
export const OKRAJ = 28

const CERNA: Barva = [0.09, 0.1, 0.11]
const SEDA: Barva = [0.42, 0.44, 0.47]
const LINKA: Barva = [0.82, 0.8, 0.76]
const HLAVICKA: Barva = [0.93, 0.92, 0.9]
const SKUPINA: Barva = [0.96, 0.95, 0.94]
const VIKEND: Barva = [0.98, 0.94, 0.85]

/** Kde končí záhlaví stránky (nadpis měsíce) a kde začíná tabulka. */
const ZACATEK_OBSAHU = OKRAJ + 24
const PATA_STRANKY = 18
/** Nejníž, kam smí sahat tabulka a poznámky; pod tím je zápatí. */
export const DOLNI_HRANICE = A4_VYSKA - OKRAJ - PATA_STRANKY

const DEN_SIRKA = 34
/** Největší a nejmenší písmo času směny. Pod 6 bodů se lidé dělí na víc stránek. */
const F_MAX = 9
const F_MIN = 6
const F_JMENO = 7
const F_POZICE = 5.5
const F_POZNAMKY = 6.5
const RADEK_POZNAMKY = 8.2
const VYSKA_POZNAMEK_MAX = 34

/** Minuty jako české číslo hodin: 1890 → „31,5“, 480 → „8“. */
const hod = (minut: number) => String(hodinyCislem(minut)).replace('.', ',')

type Velikosti = { cas: number; pobocka: number; pauza: number; den: number }
const velikosti = (f: number): Velikosti => ({
  cas: f,
  pobocka: Math.max(4.5, f * 0.85),
  pauza: Math.max(4.5, f * 0.8),
  den: Math.min(f, 8),
})
const RADEK = 1.3 // mezera pod řádkem textu

const vyskaSouctu = (f: number) => f + 6

const RADEK_ZAHLAVI = 8
const RADEK_POZICE = 6.5

/**
 * Vejdou se jména do sloupce naležato (po slovech na nejvýš tři řádky)?
 * Pak se nic neotáčí — vodorovné jméno se čte samo a záhlaví je nižší,
 * takže na stránku zbude víc místa (Šéfík 20. 9. 2026).
 */
function nalezato(lide: SloupecExportu[], sirkaSloupce: number): boolean {
  return jmenaNalezato(lide, (t) => sirkaTextu(t, F_JMENO, 'tucne') <= sirkaSloupce - 5)
}

/** Řádky jména (a pozice) pod sebou; prázdné, když se to má otočit. */
function radkyZahlavi(c: SloupecExportu, sirkaSloupce: number): { jmeno: string[]; pozice: string[] } {
  const vejde = (t: string) => sirkaTextu(t, F_JMENO, 'tucne') <= sirkaSloupce - 5
  return {
    jmeno: radkyDoSirky(c.jmeno, vejde) ?? [],
    pozice: c.pozice ? (radkyDoSirky(c.pozice, (t) => sirkaTextu(t, F_POZICE) <= sirkaSloupce - 5) ?? []) : [],
  }
}

/** Výška záhlaví: naležato podle počtu řádků, otočené podle nejdelšího jména. */
function vyskaZahlavi(lide: SloupecExportu[], sirkaSloupce: number): number {
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
function vyskaBunky(dily: DilSmeny[], v: Velikosti, sPobockou: boolean): number {
  return dily.reduce((h, d) => h + v.cas + RADEK + (sPobockou && d.pobocka ? v.pobocka + RADEK : 0) + (d.pauza ? v.pauza + RADEK : 0), 0)
}

/** Výška dne = nejvyšší buňka toho dne (+ vzduch); nejméně jeden řádek. */
function vyskaDne(den: string, lide: SloupecExportu[], v: Velikosti, sPobockou: boolean): number {
  const nej = Math.max(0, ...lide.map((c) => vyskaBunky(c.podleDne.get(den) ?? [], v, sPobockou)))
  return Math.max(v.cas + 4.5, nej + 3)
}

export type Rozlozeni = {
  /** Lidé po stránkách; každá část má celý měsíc. */
  casti: SloupecExportu[][]
  /** Písmo času směny v bodech. */
  f: number
  sirkaSloupce: number
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
        a = { casti, f, sirkaSloupce, stranek: casti.length }
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
  return { casti: castiB, f: F_MIN, sirkaSloupce: sirkaPro(nejvicVCasti(castiB)) }
}

export function pdfZExportu(m: ExportMesice): Uint8Array {
  const stranky: StrankaPdf[] = []
  const sirkaObsahu = A4_SIRKA - 2 * OKRAJ
  const rozlozeni = vyberRozlozeni(m)
  const { f, sirkaSloupce } = rozlozeni
  const v = velikosti(f)
  const zkratkaPobocky = new Map(m.pobocky.map((p) => [p.nazev, p.zkratka]))

  // Pobočka pod časem: celý název, když se vejde do sloupce, jinak zkratka.
  const textPobocky = (nazev: string) =>
    sirkaTextu(nazev, v.pobocka) <= sirkaSloupce - 3 ? nazev : (zkratkaPobocky.get(nazev) ?? nazev)
  // Pauza: „pauza 15–17“; nevejde-li se, jen „(15–17)“; nevejde-li se ani to, zmenšené písmo (ne ořez — čas s výpustkou nic neříká).
  const pauzaNaKarte = (pauza: string): { text: string; velikost: number } => {
    const kratce = pauzaKratce(pauza)
    const dovnitr = sirkaSloupce - 3
    for (const text of [`pauza ${kratce}`, `(${kratce})`]) {
      if (sirkaTextu(text, v.pauza) <= dovnitr) return { text, velikost: v.pauza }
    }
    const text = `(${kratce})`
    return { text, velikost: Math.max(3.5, Math.min(v.pauza, dovnitr / sirkaTextu(text, 1))) }
  }

  let s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
  const novaStranka = (cast: SloupecExportu[], pocetCasti: number) => {
    s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
    stranky.push(s)
    const vpravo =
      pocetCasti > 1
        ? `${m.rozsah} · zaměstnanci ${m.sloupce.indexOf(cast[0]) + 1}–${m.sloupce.indexOf(cast[cast.length - 1]) + 1} z ${m.sloupce.length}`
        : m.rozsah
    s.text(m.nadpis, OKRAJ, OKRAJ + 11, { velikost: 13, pismo: 'tucne', barva: CERNA })
    s.text(zkratitText(vpravo, sirkaObsahu * 0.6, 9), A4_SIRKA - OKRAJ, OKRAJ + 11, { velikost: 9, barva: SEDA, zarovnani: 'r' })
    s.cara(OKRAJ, OKRAJ + 16, A4_SIRKA - OKRAJ, OKRAJ + 16, LINKA)
    return ZACATEK_OBSAHU
  }

  /* --- záhlaví tabulky: „Den“ a jména (naležato, nebo otočená) ----------- */

  const jmenaVodorovne = nalezato(m.sloupce, sirkaSloupce)

  const kresliZahlavi = (cast: SloupecExportu[], y: number, vyska: number): number => {
    s.obdelnik(OKRAJ, y, DEN_SIRKA, vyska, { vypln: HLAVICKA, ramecek: LINKA })
    s.text('Den', OKRAJ + DEN_SIRKA / 2, jmenaVodorovne ? y + vyska / 2 + 2.5 : y + vyska - 4, {
      velikost: 7,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    cast.forEach((c, i) => {
      const x = OKRAJ + DEN_SIRKA + i * sirkaSloupce
      s.obdelnik(x, y, sirkaSloupce, vyska, { vypln: HLAVICKA, ramecek: LINKA })

      if (jmenaVodorovne) {
        const { jmeno, pozice } = radkyZahlavi(c, sirkaSloupce)
        const vysokyBlok = jmeno.length * RADEK_ZAHLAVI + pozice.length * RADEK_POZICE
        let radek = y + (vyska - vysokyBlok) / 2
        for (const r of jmeno) {
          s.text(r, x + sirkaSloupce / 2, radek + RADEK_ZAHLAVI - 2, {
            velikost: F_JMENO,
            pismo: 'tucne',
            barva: CERNA,
            zarovnani: 'c',
          })
          radek += RADEK_ZAHLAVI
        }
        for (const r of pozice) {
          s.text(r, x + sirkaSloupce / 2, radek + RADEK_POZICE - 1.5, { velikost: F_POZICE, barva: SEDA, zarovnani: 'c' })
          radek += RADEK_POZICE
        }
        return
      }

      // Otočený text: účaří je svislá čára, písmena jsou nalevo od ní. Jméno a pod ním (vpravo) pozice.
      const sirkaBloku = F_JMENO * 0.93 + (c.pozice ? F_POZICE * 0.93 + 1.7 : 0)
      const x1 = x + (sirkaSloupce - sirkaBloku) / 2 + F_JMENO * 0.72
      s.text(zkratitText(c.jmeno, vyska - 7, F_JMENO, 'tucne'), x1, y + vyska - 3, {
        velikost: F_JMENO,
        pismo: 'tucne',
        barva: CERNA,
        otoceny: true,
      })
      if (c.pozice) {
        s.text(zkratitText(c.pozice, vyska - 7, F_POZICE), x1 + F_JMENO * 0.21 + 0.5 + F_POZICE * 0.72, y + vyska - 3, {
          velikost: F_POZICE,
          barva: SEDA,
          otoceny: true,
        })
      }
    })
    return y + vyska
  }

  /* --- řádek dne --------------------------------------------------------- */

  const kresliDen = (den: string, cast: SloupecExportu[], y: number, vyska: number) => {
    const vikend = jeVikend(den)
    s.obdelnik(OKRAJ, y, DEN_SIRKA, vyska, { vypln: vikend ? VIKEND : undefined, ramecek: LINKA })
    s.text(popisDne(den), OKRAJ + DEN_SIRKA / 2, y + vyska / 2 + v.den * 0.35, {
      velikost: v.den,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    cast.forEach((c, i) => {
      const x = OKRAJ + DEN_SIRKA + i * sirkaSloupce
      s.obdelnik(x, y, sirkaSloupce, vyska, { vypln: vikend ? VIKEND : undefined, ramecek: LINKA })
      const dily = c.podleDne.get(den) ?? []
      let radek = y + (vyska - vyskaBunky(dily, v, m.vicePobocek)) / 2
      const stred = x + sirkaSloupce / 2
      for (const d of dily) {
        s.text(`${d.kratce}${d.nevydana ? '*' : ''}`, stred, radek + v.cas * 0.8 + 0.4, {
          velikost: v.cas,
          barva: CERNA,
          zarovnani: 'c',
        })
        radek += v.cas + RADEK
        if (m.vicePobocek && d.pobocka) {
          s.text(zkratitText(textPobocky(d.pobocka), sirkaSloupce - 2, v.pobocka), stred, radek + v.pobocka * 0.8 + 0.4, {
            velikost: v.pobocka,
            barva: SEDA,
            zarovnani: 'c',
          })
          radek += v.pobocka + RADEK
        }
        if (d.pauza) {
          const p = pauzaNaKarte(d.pauza)
          s.text(p.text, stred, radek + v.pauza * 0.8 + 0.4, { velikost: p.velikost, barva: SEDA, zarovnani: 'c' })
          radek += v.pauza + RADEK
        }
      }
    })
  }

  /* --- součty a poznámky ------------------------------------------------- */

  const kresliSoucty = (cast: SloupecExportu[], y: number) => {
    const vyska = vyskaSouctu(f)
    s.obdelnik(OKRAJ, y, DEN_SIRKA, vyska, { vypln: SKUPINA, ramecek: LINKA })
    s.text('Hodin', OKRAJ + DEN_SIRKA / 2, y + vyska / 2 + 2.4, { velikost: 6.5, pismo: 'tucne', barva: CERNA, zarovnani: 'c' })
    cast.forEach((c, i) => {
      const x = OKRAJ + DEN_SIRKA + i * sirkaSloupce
      s.obdelnik(x, y, sirkaSloupce, vyska, { vypln: SKUPINA, ramecek: LINKA })
      s.text(c.minut > 0 ? hod(c.minut) : '—', x + sirkaSloupce / 2, y + vyska / 2 + f * 0.35, {
        velikost: f,
        pismo: 'tucne',
        barva: c.osobaId === null ? SEDA : CERNA,
        zarovnani: 'c',
      })
    })
    return y + vyska
  }

  const kresliPoznamky = (cast: SloupecExportu[], y: number): void => {
    const pouzite = new Set<string>()
    if (m.vicePobocek) {
      for (const c of cast) for (const dily of c.podleDne.values()) for (const d of dily) if (d.pobocka) pouzite.add(d.pobocka)
    }
    const zkratky: PobockaExportu[] = m.pobocky.filter((p) => pouzite.has(p.nazev) && textPobocky(p.nazev) !== p.nazev)
    const radky = zalomitVety(
      vetyPoznamky(m, zkratky, cast.some((c) => c.osobaId === null)),
      (t) => sirkaTextu(t, F_POZNAMKY) <= sirkaObsahu,
    )
    radky.forEach((r, i) => s.text(r, OKRAJ, y + 8 + i * RADEK_POZNAMKY, { velikost: F_POZNAMKY, barva: SEDA }))
  }

  /* --- stránky ----------------------------------------------------------- */

  if (m.sloupce.length === 0) {
    const y = novaStranka([], 1)
    s.text('V tomto měsíci nejsou žádné směny.', OKRAJ, y + 14, { velikost: 10, barva: SEDA })
  } else {
    rozlozeni.casti.forEach((cast) => {
      let y = novaStranka(cast, rozlozeni.casti.length)
      const zahlavi = vyskaZahlavi(cast, sirkaSloupce)
      y = kresliZahlavi(cast, y, zahlavi)
      for (const den of m.dny) {
        const vyska = vyskaDne(den, cast, v, m.vicePobocek)
        // Poslední den táhne s sebou součty a poznámky — ať nezůstanou osamoceně na další stránce.
        const potreba = vyska + (den === m.dny[m.dny.length - 1] ? vyskaSouctu(f) + VYSKA_POZNAMEK_MAX : 0)
        if (y + potreba > DOLNI_HRANICE) {
          // Jen když se ani při nejmenším písmu měsíc nevešel: pokračování se záhlavím znovu.
          y = novaStranka(cast, rozlozeni.casti.length)
          y = kresliZahlavi(cast, y, zahlavi)
        }
        kresliDen(den, cast, y, vyska)
        y += vyska
      }
      if (y + vyskaSouctu(f) > DOLNI_HRANICE) {
        y = novaStranka(cast, rozlozeni.casti.length)
        y = kresliZahlavi(cast, y, zahlavi)
      }
      y = kresliSoucty(cast, y)
      if (y + VYSKA_POZNAMEK_MAX > DOLNI_HRANICE + PATA_STRANKY - 6) y = novaStranka(cast, rozlozeni.casti.length)
      kresliPoznamky(cast, y + 3)
    })
  }

  /* --- zápatí na každé stránce ---------------------------------------- */

  stranky.forEach((st, i) => {
    const caraY = A4_VYSKA - OKRAJ - PATA_STRANKY + 4
    st.cara(OKRAJ, caraY, A4_SIRKA - OKRAJ, caraY, LINKA)
    const yPaty = A4_VYSKA - OKRAJ - 1
    st.text(`Vytvořeno ${m.vytvoreno}`, OKRAJ, yPaty, { velikost: 7, barva: SEDA })
    st.text(`Strana ${i + 1} z ${stranky.length}`, A4_SIRKA - OKRAJ, yPaty, { velikost: 7, barva: SEDA, zarovnani: 'r' })
  })

  return zapsatPdf(stranky, { nazev: m.nadpis })
}
