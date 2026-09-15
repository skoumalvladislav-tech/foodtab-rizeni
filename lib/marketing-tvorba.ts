import type { SablonaDef } from './marketing-sablony'

/**
 * Sestavení vstupů z formuláře „Tvorba" (krok 3 zadání).
 *
 * Čistá funkce, žádné IO — bere jen to, co formulář poslal, podle
 * definice `SablonaDef.inputs` z `lib/marketing-sablony.ts`. Server
 * akce (`vytvoritZTvorby` v `akce.ts`) z FormData postaví `PoleZFormulare`
 * a zbytek nechá na týhle funkci; test tu samou funkci volá s ručně
 * sestaveným objektem, bez FormData a bez databáze.
 *
 * `media` a `items` typ vstupu se tu přeskakují schválně: fotky má
 * vlastní výběr na stránce a položky menu smí přijít jen z POTVRZENÉHO
 * menu (`vytvoritZTvorby`), nikdy z ručně psaného pole.
 */

export type PoleZFormulare = {
  hodnota(klic: string): string
  zaskrtnuto(klic: string): boolean
  hodnotaOd(klic: string): string
  hodnotaDo(klic: string): string
}

export type VysledekVstupu = {
  vstupy: Record<string, unknown>
  popisPole: string[]
  /** Popisek prvního nevyplněného povinného pole, nebo null. */
  chybiPovinne: string | null
}

export function sestavVstupy(def: SablonaDef, pole: PoleZFormulare): VysledekVstupu {
  const vstupy: Record<string, unknown> = {}
  const popisPole: string[] = []

  for (const vstup of def.inputs) {
    if (vstup.type === 'media' || vstup.type === 'items') continue

    if (vstup.type === 'date_range') {
      const od = pole.hodnotaOd(vstup.key)
      const doKdy = pole.hodnotaDo(vstup.key)
      if (vstup.required && !od) return { vstupy, popisPole, chybiPovinne: vstup.label }
      if (od) {
        vstupy[vstup.key] = { od, do: doKdy || null }
        popisPole.push(`${vstup.label}: ${od}${doKdy && doKdy !== od ? ` – ${doKdy}` : ''}`)
      }
      continue
    }

    const hodnota = vstup.type === 'boolean' ? pole.zaskrtnuto(vstup.key) : pole.hodnota(vstup.key)
    if (vstup.required && (hodnota === '' || hodnota === false)) {
      return { vstupy, popisPole, chybiPovinne: vstup.label }
    }
    if (hodnota !== '' && hodnota !== false) {
      vstupy[vstup.key] = hodnota
      popisPole.push(`${vstup.label}: ${hodnota === true ? 'ano' : hodnota}`)
    }
  }

  return { vstupy, popisPole, chybiPovinne: null }
}

/**
 * Potřebuje šablona vybrat potvrzené menu?
 *
 * NE `category === 'menu'` — ta kategorie má i šablony s vlastním
 * názvem/cenou/datem a žádnými položkami (např. `jidlo_dne`). Vazbu na
 * menu potřebuje, jen když má vstup typu `items`: teprve ten fakta
 * z menu skutečně čte.
 */
export function vyzadujeMenu(def: SablonaDef): boolean {
  return def.inputs.some((v) => v.type === 'items')
}

/** Popis položek potvrzeného menu pro AI pokyn — jen fakta z databáze, nic navíc. */
export function popisPolozekMenu(polozky: readonly { nazev: string; cena_haleru: number | null }[]): string {
  return polozky
    .map((p) => (p.cena_haleru !== null ? `${p.nazev} ${(p.cena_haleru / 100).toFixed(0)} Kč` : p.nazev))
    .join(', ')
}

/** Prázdný pokyn se poskládá ze šablony — AI dostane instrukci vždycky, i když ji člověk nenapsal. */
export function sestavPokyn(def: SablonaDef, popisPole: readonly string[], popisPolozek: string): string {
  return [def.description, ...popisPole, popisPolozek ? `Položky: ${popisPolozek}` : null]
    .filter((x): x is string => Boolean(x))
    .join(' ')
}
