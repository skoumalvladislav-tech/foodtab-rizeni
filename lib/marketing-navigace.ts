/**
 * Levý sloupec a spodní lišta marketingu.
 *
 * Seznam a pořadí jsou závazné z původní samostatné aplikace
 * (marketing-ai/app/[provozovna]/navigace.tsx, commit 6cb7d72),
 * viz docs/hlaseni/zadani-pro-ai-marketing-faktury.md, krok 1.
 *
 * Je to jen kreslení. Schovaná položka není zámek — každá obrazovka si
 * přístup ověřuje sama přes zkusPristup (app.has_access).
 */

export type MarketingPravo = 'marketing.read' | 'marketing.manage' | 'marketing.publish'

export type MarketingIkona =
  | 'prehled'
  | 'tvorba'
  | 'media'
  | 'menu'
  | 'sablony'
  | 'kalendar'
  | 'schvaleni'
  | 'kampane'
  | 'publikace'
  | 'analytika'
  | 'brand'
  | 'integrace'
  | 'tym'

type Definice = {
  klic: string
  /** Za /<rozsah>/marketing. Prázdný je přehled. */
  segment: string
  nazev: string
  kratky: string
  ikona: MarketingIkona
  pravo: MarketingPravo | null
  pocitadlo?: boolean
}

export type PolozkaNavigace = {
  klic: string
  href: string
  nazev: string
  kratky: string
  ikona: MarketingIkona
  cislo: number
}

const HLAVNI: readonly Definice[] = [
  { klic: 'prehled', segment: '', nazev: 'Přehled', kratky: 'Přehled', ikona: 'prehled', pravo: null },
  { klic: 'novy', segment: 'novy', nazev: 'Vytvořit obsah', kratky: 'Vytvořit', ikona: 'tvorba', pravo: 'marketing.manage' },
  { klic: 'media', segment: 'media', nazev: 'Mediální knihovna', kratky: 'Média', ikona: 'media', pravo: 'marketing.read' },
  { klic: 'menu', segment: 'menu', nazev: 'Menu', kratky: 'Menu', ikona: 'menu', pravo: 'marketing.read' },
  { klic: 'sablony', segment: 'sablony', nazev: 'Šablony', kratky: 'Šablony', ikona: 'sablony', pravo: null },
  { klic: 'kalendar', segment: 'kalendar', nazev: 'Kalendář', kratky: 'Kalendář', ikona: 'kalendar', pravo: null },
  { klic: 'schvalovani', segment: 'schvalovani', nazev: 'Ke schválení', kratky: 'Schválení', ikona: 'schvaleni', pravo: null, pocitadlo: true },
  { klic: 'kampane', segment: 'kampane', nazev: 'Kampaně a automatizace', kratky: 'Kampaně', ikona: 'kampane', pravo: null },
  { klic: 'publikovane', segment: 'publikovane', nazev: 'Publikované', kratky: 'Publikované', ikona: 'publikace', pravo: null },
  { klic: 'analytika', segment: 'analytika', nazev: 'Analytika', kratky: 'Analytika', ikona: 'analytika', pravo: 'marketing.read' },
]

const NASTAVENI: readonly Definice[] = [
  { klic: 'znacka', segment: 'znacka', nazev: 'Brand kit provozovny', kratky: 'Značka', ikona: 'brand', pravo: null },
  { klic: 'nastroje', segment: 'nastroje', nazev: 'Integrace a nástroje', kratky: 'Nástroje', ikona: 'integrace', pravo: 'marketing.publish' },
  // Originál tu právo neměl, ale obrazovka auditu pouští jen marketing.manage.
  { klic: 'audit', segment: 'audit', nazev: 'Tým, role a audit', kratky: 'Tým', ikona: 'tym', pravo: 'marketing.manage' },
]

const ZKRATKY = ['prehled', 'novy', 'kalendar', 'schvalovani', 'media'] as const
const V_LISTE = 5

export function sestavNavigaci(
  rozsah: string,
  smi: (pravo: MarketingPravo) => boolean,
  cekajici: number,
): { hlavni: PolozkaNavigace[]; nastaveni: PolozkaNavigace[]; spodni: PolozkaNavigace[] } {
  const zaklad = `/${rozsah}/marketing`
  const vidi = (d: Definice) => d.pravo === null || smi(d.pravo)
  const prevod = (d: Definice): PolozkaNavigace => ({
    klic: d.klic,
    href: d.segment ? `${zaklad}/${d.segment}` : zaklad,
    nazev: d.nazev,
    kratky: d.kratky,
    ikona: d.ikona,
    cislo: d.pocitadlo ? cekajici : 0,
  })

  const hlavni = HLAVNI.filter(vidi).map(prevod)
  const nastaveni = NASTAVENI.filter(vidi).map(prevod)

  // Chybějící zkratku doplní další položka v pořadí, nikdy ta, která už
  // v liště je — jinak by se tam jedna obrazovka ukázala dvakrát.
  const spodni = [...ZKRATKY.map((k) => hlavni.find((p) => p.klic === k)), ...hlavni]
    .filter((p): p is PolozkaNavigace => p !== undefined)
    .filter((p, i, vse) => vse.findIndex((q) => q.klic === p.klic) === i)
    .slice(0, V_LISTE)

  return { hlavni, nastaveni, spodni }
}

/** Nejdelší shoda vyhrává — přehled je předponou všech ostatních adres. */
export function aktivniKlic(cesta: string, polozky: readonly PolozkaNavigace[]): string | null {
  let nejlepsi: PolozkaNavigace | null = null
  for (const p of polozky) {
    if (cesta !== p.href && !cesta.startsWith(p.href + '/')) continue
    if (!nejlepsi || p.href.length > nejlepsi.href.length) nejlepsi = p
  }
  return nejlepsi?.klic ?? null
}
