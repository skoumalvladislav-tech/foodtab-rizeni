/**
 * Stav přihlašovacího formuláře.
 *
 * Je to VLASTNÍ SOUBOR, a ne součást `akce.ts`, protože soubor
 * s `'use server'` smí vyvážet jen asynchronní funkce — konstanta
 * v něm shodí sestavení hláškou „A 'use server' file can only export
 * async functions, found object". Typ by prošel (mizí při překladu),
 * konstanta ne.
 *
 * Rozhodování o hláškách a odpočtu je v `lib/prihlaseni.ts`, aby se
 * dalo vyzkoušet bez prohlížeče.
 */

export type StavPrihlaseni = {
  krok: 'email' | 'kod'
  email: string
  chyba: string
  /**
   * Kdy se kód odeslal. Z toho si prohlížeč počítá těch šedesát vteřin,
   * po které je „Poslat znovu" zašedlé. Číslo dodává SERVER, aby se
   * nedalo zkrátit přetočením hodin v telefonu.
   */
  odeslanoKdy: number
}

export const PRAZDNY_STAV: StavPrihlaseni = {
  krok: 'email',
  email: '',
  chyba: '',
  odeslanoKdy: 0,
}
