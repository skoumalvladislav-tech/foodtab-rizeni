/**
 * Záložky „Vzkazy a úkoly“ — co se ukáže a jak se čte číslo u záložky.
 *
 * Čistá logika bez Reactu a bez databáze, ať se dá ověřit testem
 * (`scripts/komunikace.test.mjs`). Data dodává
 * `app/[rozsah]/provozni-centrum/pocty.ts`, kreslí `zalozky.tsx`.
 *
 * Do 27. 9. si každá stránka pod „Vzkazy a úkoly“ počítala čísla sama
 * a každá jinak: na Komunikaci bylo číslo u Nástěnky a u Úkolů ne, na
 * Úkolech naopak, v detailu rozhovoru jen u Komunikace. Při přepínání
 * záložek se čísla objevovala a mizela. Teď je počítá jedna funkce
 * a posílá je každá stránka.
 */

export type KlicZalozky = 'komunikace' | 'ukoly' | 'checklisty' | 'nastenka'

/** Jednotný nadpisek („oči“) nad všemi stránkami pod „Vzkazy a úkoly“. */
export const OCI_VZKAZU = 'Vzkazy a úkoly'

/**
 * Které záložky se nekreslí.
 *
 * Úkoly a Checklisty visí na `tasks.read`, Nástěnka na
 * `communication.read`. Komunikace se neskrývá nikdy — rozhovory
 * jsou autorizované účastnictvím, ne právem (20260903100000,
 * „MODUL ANO, PRÁVO NE“).
 *
 * Nástěnka se do 27. 9. kreslila každému a kdo právo neměl, dostal po
 * kliknutí odmítnutí (v ostré databázi 2 lidé).
 */
export function skryteZalozky(prava: { ukoly: boolean; nastenka: boolean }): KlicZalozky[] {
  return [
    ...(prava.ukoly ? [] : (['ukoly', 'checklisty'] as KlicZalozky[])),
    ...(prava.nastenka ? [] : (['nastenka'] as KlicZalozky[])),
  ]
}

/**
 * Co přečte odečítač obrazovky u čísla záložky.
 *
 * U Úkolů to NEJSOU nepřečtené věci, ale otevřené úkoly — do 27. 9. se
 * četlo „3 nepřečtených“ i tam.
 */
export function popisPoctu(klic: KlicZalozky, pocet: number): string {
  if (klic === 'ukoly') return `${pocet} ${pocet === 1 ? 'otevřený' : pocet >= 2 && pocet <= 4 ? 'otevřené' : 'otevřených'}`
  return `${pocet} ${pocet === 1 ? 'nepřečtená' : pocet >= 2 && pocet <= 4 ? 'nepřečtené' : 'nepřečtených'}`
}

/** Číslo, jak se ukáže v odznaku. Nula se nekreslí vůbec (vrací null). */
export function odznakPoctu(pocet: number | undefined): string | null {
  if (!pocet || pocet <= 0) return null
  return pocet > 99 ? '99+' : String(pocet)
}
