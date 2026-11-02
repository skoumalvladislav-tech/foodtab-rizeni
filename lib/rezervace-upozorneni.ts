/**
 * Komu chodí upozornění k rezervacím a akcím — popisky a věty obrazovky
 * Rezervace → Upozornění (zadání Šéfíka 2. 11. 2026).
 *
 * Pravidla posílání jsou v databázi (migrace 20261106100000,
 * app.rezervace_prijemci); tady jsou jen jejich slova. Čisté funkce,
 * test: scripts/rezervace-upozorneni.test.mjs.
 *
 * Jediné pravidlo, které obrazovka musí vědět dopředu: RANNÍ SOUHRN
 * bez jediného vybraného chodí všem, kdo rezervace pobočky vidí (jako
 * dřív), kdežto u akcí a rezervací nikdo vybraný = nikomu nic. Věta pod
 * tabulkou to musí říct, jinak by prázdný sloupec souhrnu vypadal jako
 * „nikomu“.
 */

import { slovoPodleCisla } from './upozorneni-text.ts'

export type DruhUpozorneniRezervaci = 'akce' | 'rezervace' | 'souhrn'

export type ClovekUpozorneni = {
  employee_id: string
  jmeno: string
  zarazeni: string
  akce: boolean
  rezervace: boolean
  souhrn: boolean
}

export const DRUHY_UPOZORNENI_REZERVACI: { klic: DruhUpozorneniRezervaci; nazev: string; popis: string }[] = [
  { klic: 'akce', nazev: 'Akce', popis: 'nová, změněná a zrušená akce' },
  { klic: 'rezervace', nazev: 'Rezervace', popis: 'nová a zrušená rezervace' },
  { klic: 'souhrn', nazev: 'Ranní souhrn', popis: 'ráno přehled dne' },
]

/**
 * Komu to u pobočky chodí, po druzích — věta nad tabulkou:
 *
 *   „Akce: 2 lidé · Rezervace: nikdo · Ranní souhrn: všichni v seznamu“
 */
export function souhrnVyberu(lide: ClovekUpozorneni[]): string {
  return DRUHY_UPOZORNENI_REZERVACI.map(({ klic, nazev }) => {
    const n = lide.filter((c) => c[klic]).length
    if (n === 0) return `${nazev}: ${klic === 'souhrn' ? 'všichni v seznamu' : 'nikdo'}`
    return `${nazev}: ${n} ${slovoPodleCisla(n, 'člověk', 'lidé', 'lidí')}`
  }).join(' · ')
}
