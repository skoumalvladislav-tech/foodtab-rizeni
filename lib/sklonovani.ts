/**
 * Skloňování podstatných jmen po číslovce.
 *
 * Čeština má tři tvary, ne dva. „2 záznamů“ je špatně stejně jako
 * „1 záznamy“ — a aplikace, která píše „2 příchodů“, vypadá jako
 * strojový překlad. Platí to VŠUDE, kde se něco počítá.
 *
 * Pravidlo:
 *   1              → jednotné číslo        (1 záznam)
 *   2, 3, 4        → množné, 1. pád        (3 záznamy)
 *   0, 5 a víc     → množné, 2. pád        (0 záznamů, 7 záznamů)
 *
 * Na složená čísla se nepamatuje záměrně: spisovně je „21 záznamů“,
 * ne „21 záznam“, takže obyčejné `n === 1` je správně a výjimka na
 * poslední číslici by udělala chybu tam, kde dnes žádná není.
 *
 * Záporná čísla se počítají podle absolutní hodnoty (−2 hodiny).
 */
export function sklonovat(n: number, jedna: string, dve: string, pet: string): string {
  const k = Math.abs(n)
  if (k === 1) return jedna
  if (k >= 2 && k <= 4) return dve
  return pet
}

/**
 * Číslo i s podstatným jménem: `pocet(2, 'záznam', 'záznamy', 'záznamů')`
 * dá „2 záznamy“.
 *
 * Většina míst chce právě tohle. Kdo potřebuje číslo zvlášť (třeba
 * tučně), použije `sklonovat` a složí si to sám.
 */
export function pocet(n: number, jedna: string, dve: string, pet: string): string {
  return `${n} ${sklonovat(n, jedna, dve, pet)}`
}

/**
 * Sloveso nebo přídavné jméno v přísudku, které se řídí počtem:
 * „1 záznam NENÍ dokončený“ × „2 záznamy NEJSOU dokončené“.
 *
 * Tvary pro 2–4 a pro 5+ jsou v češtině tytéž („nejsou dokončené“),
 * na rozdíl od podstatného jména. Proto dva parametry, ne tři —
 * třetí by svádělo vymýšlet rozdíl, který v jazyce není.
 */
export function prisudek(n: number, jedno: string, vice: string): string {
  return Math.abs(n) === 1 ? jedno : vice
}
