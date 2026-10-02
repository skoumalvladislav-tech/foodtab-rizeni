/**
 * Jednotky suroviny a balení — sdílené mezi formulářem (nabídka v
 * rozbalovátku) a serverovou akcí (převod zadaného balení na
 * `base_unit`). Vlastní soubor, ne uvnitř `akce.ts`: 'use server' tam
 * smí exportovat jen async funkce.
 */

export const ZAKLADNI_JEDNOTKY = ['g', 'ml', 'ks'] as const
export type ZakladniJednotka = (typeof ZAKLADNI_JEDNOTKY)[number]

export function jeZakladniJednotka(v: string): v is ZakladniJednotka {
  return (ZAKLADNI_JEDNOTKY as readonly string[]).includes(v)
}

/**
 * V jaké jednotce smí dodavatel balit, aby šlo množství srozumitelně
 * zadat a pak přepočítat na `base_unit`. `ks` se jinak nebalí.
 */
export function jednotkyBaleni(zakladni: ZakladniJednotka): string[] {
  if (zakladni === 'g') return ['kg', 'g']
  if (zakladni === 'ml') return ['l', 'ml']
  return ['ks']
}

/** Převod zadaného balení na `base_unit` suroviny. */
export function naZakladniJednotku(mnozstvi: number, balenoV: string): number {
  if (balenoV === 'kg' || balenoV === 'l') return mnozstvi * 1000
  return mnozstvi
}
