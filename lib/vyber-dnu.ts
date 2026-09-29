/**
 * Výběr víc dnů při zadávání NOVÉ směny.
 *
 * Zadání Šéfíka 29. 9. 2026: „při zadávání směn umožni označit více dní
 * na přidání směny“ — vybere se víc dnů najednou a založí se stejná
 * směna (stejný člověk/pozice/pobočka/čas/pauza/poznámka) pro každý z nich.
 *
 * Čistá logika bez Reactu, ať jde zkoušet Nodem
 * (scripts/smeny-formular.test.mjs). Kreslí to
 * app/[rozsah]/smeny/vyber-dnu.tsx, ukládá app/[rozsah]/smeny/smena.ts —
 * jedno volání RPC `ulozit_smenu` za den, viz jeho hlavičku.
 *
 * ---------------------------------------------------------------------
 * OKNO, NE NEKONEČNÝ VÝBĚR
 *
 * RPC `ulozit_smenu` žádný limit počtu dnů nemá (je to čisté, bezstavové
 * volání), ale nabízet týdny donekonečna by byl needitelný kalendář.
 * Napoprvé se ukáže `TYDNU_VYCHOZI` týdnů od pondělí toho týdne, kam
 * patří den předvyplněný ve formuláři; tlačítko „Zobrazit další týdny“
 * přidává `TYDNU_KROK` až do stropu `TYDNU_MAX` — stejná úvaha jako
 * u měsíčního pohledu Rozpisu (`mesicniMrizka`), jen bez nutnosti listovat
 * po jednom měsíci zvlášť.
 */

import { pondeliTydne, posunDatum } from './rozpis-mobil.ts'

/** Kolik týdnů okno nabízí napoprvé. */
export const TYDNU_VYCHOZI = 4
/** O kolik týdnů se okno rozšíří tlačítkem „Zobrazit další týdny“. */
export const TYDNU_KROK = 4
/** Strop okna — kalendář na pár týdnů dopředu, ne nekonečný posuv. */
export const TYDNU_MAX = 12

/**
 * Týdny (Po–Ne) okna pro výběr, od pondělí týdne, do kterého patří
 * `zacatek`. `pocetTydnu` se ořízne na rozsah 1–`TYDNU_MAX`.
 */
export function tydnyOkna(zacatek: string, pocetTydnu: number): string[][] {
  const n = Math.max(1, Math.min(pocetTydnu, TYDNU_MAX))
  const pondeli = pondeliTydne(zacatek)
  return Array.from({ length: n }, (_, t) =>
    Array.from({ length: 7 }, (_, d) => posunDatum(pondeli, t * 7 + d)),
  )
}

/**
 * Přidá/odebere den z výběru. Výsledek je vzestupně seřazený —
 * `RRRR-MM-DD` se jako text řadí správně, takže se dny v hlášce
 * a v seznamu skrytých polí ukazují v pořadí kalendáře, ne v pořadí kliků.
 */
export function prepnoutDen(vybrane: string[], den: string): string[] {
  const dalsi = vybrane.includes(den) ? vybrane.filter((d) => d !== den) : [...vybrane, den]
  return dalsi.sort()
}

/**
 * Co se stane s výběrem dnů při ZAPNUTÍ přepínače „Víc dní“. Když ve
 * výběru už něco je — člověk přepínač omylem vypnul a hned zase zapnul,
 * třeba aby se mrknul na obyčejné pole data — výběr ZŮSTÁVÁ, jinak by se
 * tiše zahodil bez upozornění. Teprve prázdný výběr (první zapnutí) se
 * předvyplní dosavadním jedním dnem z pole „den“.
 */
export function zapnoutVicDni(vybrane: string[], datum: string): string[] {
  if (vybrane.length > 0) return vybrane
  return datum ? [datum] : []
}

/**
 * Výsledek uložení JEDNOHO dne z výběru víc dnů. `chyba` je tvrdé
 * zamítnutí z databáze (chybějící pole, cizí zaměstnanec…), `varovani`
 * jsou věty, které směnu nezamítají (překryv, mimo provozní dobu) —
 * stejné rozlišení jako u jedné směny, viz smena.ts.
 */
export type VysledekDne = {
  den: string
  /** `null` = směna se založila. */
  chyba: string | null
  varovani: string[]
}

/** Genitiv čísla „směn“ po předložce „z“: „z 1 směny“, „z 3 směn“, „z 5 směn“. */
function zSmen(n: number): string {
  return n === 1 ? '1 směny' : `${n} směn`
}

/**
 * Nadpis výsledku víc dnů najednou: „Založeno 5 z 5 směn“, při dílčím
 * neúspěchu „Založeno 3 z 5 směn“. Kolik dnů má varování nebo chybu
 * ukazuje formulář dál v seznamu po dnech — tahle věta jen shrnuje počet.
 */
export function souhrnZalozeni(vysledky: VysledekDne[]): string {
  const zalozeno = vysledky.filter((v) => v.chyba === null).length
  return `Založeno ${zalozeno} z ${zSmen(vysledky.length)}`
}

/**
 * Barva nadpisu výsledku podle toho, kolik dnů se OPRAVDU založilo —
 * ne natvrdo zelená bez ohledu na výsledek (bod B zadání: neúspěch musí
 * být vidět, ne jen v textu pod ním). Zelená jen když vyšly všechny dny,
 * červená když nevyšel ani jeden, jinak (částečný úspěch) barva varování.
 */
export function barvaSouhrnu(vysledky: VysledekDne[]): string {
  const zalozeno = vysledky.filter((v) => v.chyba === null).length
  if (zalozeno === 0) return 'var(--bad)'
  if (zalozeno === vysledky.length) return 'var(--dobre)'
  return 'var(--pozor)'
}
