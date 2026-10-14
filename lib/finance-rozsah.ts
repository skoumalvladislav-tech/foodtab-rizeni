/**
 * Finance po pobočkách — jedno místo, které říká, na co se obrazovka
 * Financí dívá.
 *
 * Šéfík 13. 10. 2026: „upravil bych modul finance tak, aby bylo vidět
 * i jednotlivé pobočky — mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru."
 *
 *   * rozsah celé firmy (`/firma/…`) → `null` = všechno, co je vidět
 *     dnes (všechny pobočky i firemní řádky bez pobočky);
 *   * rozsah pobočky (`/bernard-bar/…`) → id pobočky. Obrazovka ukazuje
 *     JEN řádky s touto pobočkou.
 *
 * Firemní řádky (`branch_id` null — společný bankovní účet a jeho
 * platby, firemní rozpočet, předpis nebo vybavení bez pobočky) se na
 * pobočce NEUKAZUJÍ a ani se nerozpočítávají. Je to nejopatrnější
 * varianta (stejný vzor jako Rozpis směn): pobočka nedostane cizí ani
 * odhadnuté číslo. Obrazovka to řekne větou `POZNAMKA_FIREMNI`.
 * ROZHODNOUT (docs/hlaseni/otazky.md): ukázat je zvlášť, nebo
 * rozpočítat klíčem.
 *
 * Kdo smí na pobočku, hlídá app/[rozsah]/finance/layout.tsx (jen
 * finance.read za celou firmu) — tahle funkce o přístupu nerozhoduje.
 *
 * Čistá funkce bez importů za běhu — zkouší ji scripts/finance-pobocky.test.mjs.
 */

import type { Scope } from './authz.ts'

/** Pobočka z rozsahu adresy, nebo `null` = celá firma. */
export function pobockaFinanci(scope: Pick<Scope, 'level' | 'branchId'>): string | null {
  return scope.level === 'branch' ? scope.branchId : null
}

/** Věta pod obrazovkou na pobočce — co v jejích číslech chybí a proč. */
export const POZNAMKA_FIREMNI =
  'Položky celé firmy bez pobočky (společný bankovní účet, firemní rozpočty a vybavení) tu nejsou — jsou vidět v pohledu Celá firma.'
