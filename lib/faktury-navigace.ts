/**
 * Levý sloupec a spodní lišta modulu Faktury.
 *
 * Stejný vzor jako `lib/marketing-navigace.ts` (Marketing krok 1,
 * 14.9.2026) — jedna položka v `app/[rozsah]/nabidka.ts`, detailní
 * navigace žije tady a ve vnořeném layoutu. Pořadí a pět zkratek na
 * mobilu přebírá `Shell.tsx` z původní samostatné appky
 * (skoumalvladislav-tech/faktury-app) — jen „Zadat fakturu ručně" tam
 * bylo tlačítko na Přehledu, ne položka menu, a tak zůstává i tady.
 */

export type FakturyIkona =
  | 'prehled'
  | 'seznam'
  | 'dodavatele'
  | 'schvaleni'
  | 'prehledy'
  | 'kalendar'
  | 'upominky'
  | 'nova'

type Definice = {
  klic: string
  segment: string
  nazev: string
  kratky: string
  ikona: FakturyIkona
  pocitadlo?: 'needsReview' | 'overdue' | 'pendingApproval'
  /**
   * Obrazovka existuje a dá se otevřít. `false` se kreslí jako
   * nekliknutelná položka se štítkem „brzy" — stejný vzor jako
   * `hotovo` v `app/[rozsah]/nabidka.ts`. Přebíráme sloučení faktur
   * po částech (viz zadání): dokud obrazovka není, nemá se tvářit,
   * že je.
   */
  hotovo: boolean
}

const POLOZKY: readonly Definice[] = [
  { klic: 'prehled', segment: '', nazev: 'Přehled', kratky: 'Přehled', ikona: 'prehled', hotovo: true },
  { klic: 'seznam', segment: 'seznam', nazev: 'Faktury', kratky: 'Faktury', ikona: 'seznam', pocitadlo: 'needsReview', hotovo: true },
  { klic: 'dodavatele', segment: 'dodavatele', nazev: 'Dodavatelé', kratky: 'Dodavatelé', ikona: 'dodavatele', hotovo: true },
  { klic: 'schvaleni', segment: 'schvaleni', nazev: 'Ke schválení', kratky: 'Schválení', ikona: 'schvaleni', pocitadlo: 'pendingApproval', hotovo: true },
  { klic: 'prehledy', segment: 'prehledy', nazev: 'Přehledy', kratky: 'Přehledy', ikona: 'prehledy', hotovo: true },
  { klic: 'kalendar', segment: 'kalendar', nazev: 'Kalendář splatností', kratky: 'Kalendář', ikona: 'kalendar', hotovo: true },
  { klic: 'upominky', segment: 'upominky', nazev: 'Upomínky', kratky: 'Upomínky', ikona: 'upominky', pocitadlo: 'overdue', hotovo: true },
]

/** Nezobrazují se na mobilu — přesně čtveřice z původního MOB_NAV. */
const MIMO_MOBIL = new Set(['schvaleni', 'prehledy', 'kalendar'])

export type PocetOdznaku = { needsReview: number; overdue: number; pendingApproval: number }

export type PolozkaNavigace = {
  klic: string
  href: string
  nazev: string
  kratky: string
  ikona: FakturyIkona
  cislo: number
  hotovo: boolean
}

export function sestavNavigaci(
  rozsah: string,
  pocty: PocetOdznaku,
): { hlavni: PolozkaNavigace[]; mobil: PolozkaNavigace[] } {
  const zaklad = `/${rozsah}/faktury`
  const prevod = (d: Definice): PolozkaNavigace => ({
    klic: d.klic,
    href: d.segment ? `${zaklad}/${d.segment}` : zaklad,
    nazev: d.nazev,
    kratky: d.kratky,
    ikona: d.ikona,
    cislo: d.pocitadlo ? pocty[d.pocitadlo] : 0,
    hotovo: d.hotovo,
  })

  const hlavni = POLOZKY.map(prevod)
  // Nehotové obrazovky nemají na mobilu smysl — na desktopu jsou aspoň
  // vidět jako „brzy", spodní lišta je jen pro pár nejdůležitějších.
  const mobil = hlavni.filter((p) => p.hotovo && !MIMO_MOBIL.has(p.klic))

  return { hlavni, mobil }
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
