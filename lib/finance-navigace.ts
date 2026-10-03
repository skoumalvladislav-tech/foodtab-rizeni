/**
 * Levý sloupec a spodní lišta modulu Finance (gastro ERP, 3. 10. 2026).
 *
 * Stejný vzor jako `lib/faktury-navigace.ts`/`lib/marketing-navigace.ts`:
 * jedna rodina položek v `app/[rozsah]/nabidka.ts`, detailní navigace
 * žije tady a ve vnořeném layoutu. Faktury mají svůj VLASTNÍ vnořený
 * layout (lib/faktury-navigace.ts) uvnitř `/finance/faktury` — tahle
 * navigace proto na Faktury jen odkazuje jako na poslední položku,
 * nevykresluje jejich osm obrazovek znovu.
 */

export type FinanceIkona = 'prehled' | 'kontakty' | 'platby' | 'integrace' | 'faktury'

type Definice = {
  klic: string
  segment: string
  nazev: string
  kratky: string
  ikona: FinanceIkona
}

const POLOZKY: readonly Definice[] = [
  { klic: 'prehled', segment: '', nazev: 'Přehled', kratky: 'Přehled', ikona: 'prehled' },
  { klic: 'kontakty', segment: 'kontakty', nazev: 'Kontakty', kratky: 'Kontakty', ikona: 'kontakty' },
  { klic: 'platby', segment: 'platby', nazev: 'Platby', kratky: 'Platby', ikona: 'platby' },
  { klic: 'integrace', segment: 'integrace', nazev: 'Integrace', kratky: 'Integrace', ikona: 'integrace' },
  { klic: 'faktury', segment: 'faktury', nazev: 'Faktury', kratky: 'Faktury', ikona: 'faktury' },
]

export type PolozkaNavigace = {
  klic: string
  href: string
  nazev: string
  kratky: string
  ikona: FinanceIkona
}

export function sestavNavigaci(rozsah: string): { hlavni: PolozkaNavigace[]; mobil: PolozkaNavigace[] } {
  const zaklad = `/${rozsah}/finance`
  const hlavni = POLOZKY.map((d) => ({
    klic: d.klic,
    href: d.segment ? `${zaklad}/${d.segment}` : zaklad,
    nazev: d.nazev,
    kratky: d.kratky,
    ikona: d.ikona,
  }))

  return { hlavni, mobil: hlavni }
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
