/**
 * Kalendář obsahu — počítání dnů, týdnů a varování.
 *
 * Zadání: master prompt, oddíl 15 a obrazovka 9 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ JE TO SAMOSTATNÝ SOUBOR
 *
 * Obrazovka je serverová komponenta a nedá se vykreslit mimo aplikaci.
 * Všechno, co se dá spočítat bez databáze, je proto tady — a dá se to
 * ověřit Nodem (`scripts/marketing-kalendar.test.mjs`). V obrazovce
 * zůstane jen kreslení.
 *
 * ---------------------------------------------------------------------
 * TÝDEN ZAČÍNÁ V PONDĚLÍ
 *
 * `Date.getUTCDay()` vrací 0 pro neděli. Kdyby se to vzalo, jak to
 * chodí, vyšel by americký týden — neděle vlevo. V českém kalendáři je
 * neděle poslední. Převádí to `denVTydnu()` a používá se VŠUDE, i tam,
 * kde by přímé `getUTCDay()` vypadalo nevinně.
 *
 * ---------------------------------------------------------------------
 * DATUM JE ŘETĚZEC, NE `Date`
 *
 * Uvnitř se pracuje s `2026-09-14`, ne s objektem `Date`. Objekt by
 * nesl čas i pásmo a při každém průchodu by hrozilo, že se někde
 * přečte v pásmu serveru — a ten je v UTC (CLAUDE.md, pravidlo 11).
 * Řetězec žádné pásmo nemá, takže se nemá co pokazit.
 *
 * Kde se opravdu potřebuje počítat (posun o měsíc), jde se přes
 * `Date.UTC`, kde je pásmo pevně dané a letní čas do toho nemluví.
 */

/**
 * Obsahové pilíře.
 *
 * Zadání, oddíl 17: „obsahové pilíře, například menu, lidé, atmosféra,
 * akce, zákulisí a prodej". Táž šestice je v `lib/marketing-sablony.ts`
 * jako typ `Pilir` a ukládá se do sloupce `marketing_prispevky.pilir`.
 *
 * BARVA JE TU SCHVÁLNĚ, I KDYŽ JE TO VZHLED. Zadání chce „barevné
 * rozlišení v kalendáři" a kdyby se barvy psaly až v obrazovce, byly
 * by u pilířů na dvou místech.
 *
 * NEJSOU TO NOVÉ ODSTÍNY, JSOU TO ŠEST Z DEVÍTI BAREV POBOČEK.
 *
 * Vymyslet šest vlastních by znamenalo šest barev, o kterých nikdo
 * neměří, jestli se dají od sebe rozeznat a jestli na nich jde
 * přečíst text. Paleta poboček tím měřením prošla
 * (`node scripts/barvy.js`, ΔE2000 nejméně 15 na světlém a 14 na
 * tmavém) a má hotový tmavý režim.
 *
 * Cena za to je, že táž barva znamená na jedné obrazovce pobočku a na
 * druhé pilíř. Je to přijatelné: v kalendáři je pobočka daná rozsahem
 * nahoře, ne barvou, a pilíř je tenký proužek u příspěvku. Kdyby se to
 * někdy potkalo na jedné obrazovce, je tohle místo, kde se to rozdělí.
 */
export const PILIRE = [
  { klic: 'menu', nazev: 'Menu', barva: 'var(--b-emerald)' },
  { klic: 'lide', nazev: 'Lidé', barva: 'var(--b-sky)' },
  { klic: 'atmosfera', nazev: 'Atmosféra', barva: 'var(--b-violet)' },
  { klic: 'akce', nazev: 'Akce', barva: 'var(--b-amber)' },
  { klic: 'zakulisi', nazev: 'Zákulisí', barva: 'var(--b-slate)' },
  { klic: 'prodej', nazev: 'Prodej', barva: 'var(--b-rose)' },
] as const

/**
 * Pilíř, který v seznamu není, se NEPŘEKLÁDÁ na prázdno.
 *
 * Stejný důvod jako u `popisStavu` v `lib/marketing-text.ts`: prázdno
 * by ze sloupce zmizelo beze stopy a vypadalo by to, že příspěvek
 * pilíř nemá. Radši ať je vidět syrový výraz.
 */
export function popisPilire(pilir: string): string {
  return PILIRE.find((p) => p.klic === pilir)?.nazev ?? pilir
}

export function barvaPilire(pilir: string): string {
  return PILIRE.find((p) => p.klic === pilir)?.barva ?? 'var(--line)'
}

const MESICE_1 = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
]

const MESICE_2 = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
]

export const DNY_ZKRATKY = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']

/** 0 = pondělí … 6 = neděle. Viz hlavička souboru. */
export function denVTydnu(datum: string): number {
  const d = new Date(`${datum}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

/** Posun o dny. Přes `Date.UTC`, takže letní čas nic neposune. */
export function posunDen(datum: string, o: number): string {
  const [r, m, d] = datum.split('-').map(Number)
  return naDatum(new Date(Date.UTC(r, m - 1, d + o)))
}

/**
 * Posun o měsíce.
 *
 * PŘETEČENÍ DNE JE OŠETŘENÉ. `Date.UTC(2026, 0, 31)` posunutý o měsíc
 * dá 3. března, protože únor tolik dnů nemá — a v kalendáři by se tím
 * jeden měsíc přeskočil. Proto se posouvá PRVNÍ den měsíce a den se
 * dosadí zpátky, nejvýš ale poslední den cílového měsíce.
 */
export function posunMesic(datum: string, o: number): string {
  const [r, m, d] = datum.split('-').map(Number)
  const cil = new Date(Date.UTC(r, m - 1 + o, 1))
  const dnuVCili = new Date(Date.UTC(cil.getUTCFullYear(), cil.getUTCMonth() + 1, 0)).getUTCDate()
  return naDatum(new Date(Date.UTC(cil.getUTCFullYear(), cil.getUTCMonth(), Math.min(d, dnuVCili))))
}

function naDatum(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Pondělí týdne, ve kterém datum leží. */
export function pondeliTydne(datum: string): string {
  return posunDen(datum, -denVTydnu(datum))
}

/** Prvni den měsíce, ve kterém datum leží. */
export function prvniDenMesice(datum: string): string {
  const [r, m] = datum.split('-')
  return `${r}-${m}-01`
}

export function posledniDenMesice(datum: string): string {
  const [r, m] = datum.split('-').map(Number)
  return naDatum(new Date(Date.UTC(r, m, 0)))
}

/**
 * Mřížka měsíce: seznam týdnů po sedmi dnech, pondělím počínaje.
 *
 * DNY OKOLNÍCH MĚSÍCŮ SE VRACEJÍ TAKY, ne jako `null`. Prázdné buňky
 * na začátku a na konci vypadají jako díra v kalendáři a člověk neví,
 * jestli tam nic není, nebo se tam nedá kliknout. Vrací se proto
 * skutečné datum a příznak `vMesici`.
 */
export function mrizkaMesice(datum: string): { datum: string; vMesici: boolean }[][] {
  const prvni = prvniDenMesice(datum)
  const mesic = prvni.slice(0, 7)
  const zacatek = pondeliTydne(prvni)

  const tydny: { datum: string; vMesici: boolean }[][] = []
  let den = zacatek

  do {
    const tyden = []
    for (let i = 0; i < 7; i++) {
      tyden.push({ datum: den, vMesici: den.slice(0, 7) === mesic })
      den = posunDen(den, 1)
    }
    tydny.push(tyden)
  } while (den.slice(0, 7) === mesic)

  return tydny
}

/** Sedm dnů týdne, ve kterém datum leží. */
export function dnyTydne(datum: string): string[] {
  const po = pondeliTydne(datum)
  return Array.from({ length: 7 }, (_, i) => posunDen(po, i))
}

/** „září 2026" */
export function nazevMesice(datum: string): string {
  const [r, m] = datum.split('-').map(Number)
  return `${MESICE_1[m - 1]} ${r}`
}

/** „14.–20. září 2026", přes přelom měsíce „28. září – 4. října 2026" */
export function nazevTydne(datum: string): string {
  const dny = dnyTydne(datum)
  const [r1, m1, d1] = dny[0].split('-').map(Number)
  const [r2, m2, d2] = dny[6].split('-').map(Number)

  if (m1 === m2 && r1 === r2) return `${d1}.–${d2}. ${MESICE_2[m2 - 1]} ${r2}`
  if (r1 === r2) return `${d1}. ${MESICE_2[m1 - 1]} – ${d2}. ${MESICE_2[m2 - 1]} ${r2}`
  return `${d1}. ${MESICE_2[m1 - 1]} ${r1} – ${d2}. ${MESICE_2[m2 - 1]} ${r2}`
}

/**
 * Meze dotazu do databáze pro zobrazené období.
 *
 * ROZŠIŘUJE SE O DEN NA KAŽDOU STRANU, A NENÍ TO NEDBALOST.
 *
 * `planovano_na` je okamžik (`timestamptz`). Do kterého kalendářního
 * dne spadne, rozhoduje PÁSMO POBOČKY — a to se u každé pobočky může
 * lišit. Spočítat přesné meze v UTC by znamenalo znát posun pásma pro
 * to konkrétní datum, tedy i pravidla letního času; a když se v období
 * čas mění, není ten posun ani jeden.
 *
 * Bere se proto o den víc na obou stranách a do dnů se řadí až
 * `zaradDoDnu` přes `denVPasmu`, které pravidla letního času zná.
 * Pár řádků navíc z databáze je levnější než příspěvek, který
 * v kalendáři zmizí jednou za rok při přechodu na letní čas.
 */
export function mezeObdobi(od: string, doKdy: string): { od: string; do: string } {
  return {
    od: `${posunDen(od, -1)}T00:00:00Z`,
    do: `${posunDen(doKdy, 1)}T23:59:59Z`,
  }
}

export type PrispevekVKalendari = {
  id: string
  nazev: string
  stav: string
  pilir: string
  kanaly: string[]
  planovano_na: string | null
  branch_id: string
}

/**
 * Rozřazení příspěvků do dnů.
 *
 * `naDen` je funkce schválně: převod okamžiku na kalendářní den patří
 * do `lib/cas.ts`, kde je pásmo povinný údaj. Kdyby se sem dal `Date`
 * a `toISOString()`, vyšel by den v UTC — a příspěvek naplánovaný na
 * 1. října ve 23:30 by se objevil v kalendáři 1. října jen v zimě.
 */
export function zaradDoDnu(
  prispevky: PrispevekVKalendari[],
  naDen: (okamzik: string, branchId: string) => string,
): Map<string, PrispevekVKalendari[]> {
  const podleDne = new Map<string, PrispevekVKalendari[]>()

  for (const p of prispevky) {
    if (!p.planovano_na) continue
    const den = naDen(p.planovano_na, p.branch_id)
    if (!den) continue
    const seznam = podleDne.get(den) ?? []
    seznam.push(p)
    podleDne.set(den, seznam)
  }

  return podleDne
}

/**
 * Kolik dnů se smí mlčet a kolik příspěvků za den je moc.
 *
 * Zadání, oddíl 15: „varování před dlouhou mezerou nebo příliš častým
 * publikováním". Čísla nejsou z ničeho odvozená — jsou to VÝCHOZÍ
 * PRAVIDLA, dokud nebude dost vlastních dat. Zadání to samo takhle
 * chce: „doporučený čas publikace až po získání dostatku vlastních
 * dat; do té doby transparentní výchozí pravidla".
 *
 * Proto jsou tady, pojmenované a vysvětlené, a ne zapsané uvnitř
 * podmínky jako `> 7`.
 */
export const MEZERA_DNU = 7
export const MOC_ZA_DEN = 3

export type Varovani = {
  druh: 'mezera' | 'moc'
  od: string
  do: string
  dnu?: number
  kolik?: number
}

/**
 * Varování nad zobrazeným obdobím.
 *
 * POČÍTÁ SE JEN Z TOHO, CO JE VIDĚT, a je to vědomé omezení. Mezera
 * mezi posledním příspěvkem minulého měsíce a prvním tohoto se
 * neohlásí. Ohlásit ji by znamenalo tahat data mimo zobrazené období
 * a stejně by to bylo neúplné — hranice by se jen posunula.
 *
 * Zobrazují se proto jen mezery UVNITŘ období, kde jsou oba konce
 * vidět a člověk si to může ověřit očima. Varování, které se nedá
 * zkontrolovat pohledem na obrazovku, je horší než žádné.
 */
export function varovani(
  dny: string[],
  podleDne: Map<string, PrispevekVKalendari[]>,
): Varovani[] {
  const nalezy: Varovani[] = []

  for (const den of dny) {
    const kolik = (podleDne.get(den) ?? []).length
    if (kolik > MOC_ZA_DEN) {
      nalezy.push({ druh: 'moc', od: den, do: den, kolik })
    }
  }

  const obsazene = dny.filter((d) => (podleDne.get(d) ?? []).length > 0)

  for (let i = 1; i < obsazene.length; i++) {
    const dnu = rozdilDnu(obsazene[i - 1], obsazene[i])
    if (dnu > MEZERA_DNU) {
      nalezy.push({
        druh: 'mezera',
        od: obsazene[i - 1],
        do: obsazene[i],
        // Mezera je počet dnů BEZ obsahu, ne rozdíl dat. Mezi 1. a 8.
        // je šest prázdných dnů, ne sedm — a takhle to sedí s větou
        // „šest dnů se nic nedělo".
        dnu: dnu - 1,
      })
    }
  }

  return nalezy
}

export function rozdilDnu(od: string, doKdy: string): number {
  const a = new Date(`${od}T00:00:00Z`).getTime()
  const b = new Date(`${doKdy}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}
