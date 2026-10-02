/**
 * Společné typy pro receptury — editor s živým foodcostem (zadání,
 * oddíl 2).
 */

/** Jeden řádek suroviny ve formuláři. */
export type RadekSuroviny = {
  /** null u nového řádku; u existujícího jde do skrytého pole polozka-N-id. */
  id: string | null
  /** Vybraná surovina z katalogu, nebo null u volného textu. */
  ingredientId: string | null
  name: string
  /** Textově — formulář posílá řetězec, přepočet dělá akce.ts. */
  amount: string
  unit: string
  note: string
}

/** Řádek `public.ingredients` pro rozbalovátko. */
export type KatalogSurovina = {
  id: string
  name: string
  base_unit: string
}

/** Výsledek `public.recipe_cost_per_portion` — kontrakt DB → aplikace. */
export type NakladPorce = {
  cost_haleru_per_portion: number | null
  neuplne: boolean
  chybejici_polozky: string[]
}

/**
 * Haléře na Kč. Stejná konvence jako `koruny` v lib/mzdy.ts, ale
 * samostatně: foodcost nejsou mzdová data (CLAUDE.md, pravidlo 8) a
 * receptury na mzdovém modulu nemají co záviset.
 */
export function kc(haleru: number): string {
  return `${Math.round(haleru / 100).toLocaleString('cs-CZ')} Kč`
}
