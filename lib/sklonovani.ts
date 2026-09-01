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
 * Sloveso nebo přídavné jméno v přísudku, které se řídí počtem.
 *
 * POZOR, TOHLE JSOU TŘI TVARY, NE DVA. Nejdřív tu byly dva a bylo to
 * špatně — čeština u čísla 5 a víc přechází do jednotného čísla:
 *
 *   1 záznam   NENÍ dokončený
 *   2 záznamy  NEJSOU dokončené
 *   5 záznamů  NENÍ dokončených
 *
 * „5 záznamů nejsou dokončené“ zní jako strojový překlad úplně stejně
 * jako „2 záznamů“. Skloňování v češtině není jen koncovka počítaného
 * slova — mění se i sloveso a přídavné jméno.
 */
export function prisudek(
  n: number,
  jedno: string,
  dve: string,
  pet: string = jedno,
): string {
  const k = Math.abs(n)
  if (k === 1) return jedno
  if (k >= 2 && k <= 4) return dve
  return pet
}

/**
 * Celá věta o počtu: „2 záznamy nejsou dokončené“.
 *
 * Bere tři hotové věty, ne kousky. Skládat je z podstatného jména
 * a přísudku zvlášť svádí k tomu, že se jeden z nich zapomene ohnout —
 * přesně tak vzniklo „2 záznamy docházky NENÍ dokončených“.
 */
export function veta(n: number, jedna: string, dve: string, pet: string): string {
  return `${n} ${sklonovat(n, jedna, dve, pet)}`
}
