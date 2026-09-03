/**
 * Paleta pro odlišení lidí v rozpisu.
 *
 * Zadání docs/barva-u-cloveka-zadani.md.
 *
 * ---------------------------------------------------------------------
 * TÁŽ PALETA JAKO U POBOČEK, JINÉ POUŽITÍ
 *
 * Odstíny jsou tytéž `--b-*` z app/_tokeny.css — nové nepřibyly ani
 * jeden, takže `node scripts/barvy.js` platí beze změny. Liší se to
 * proměnnou (`--osoba`, ne `--branch`) a hlavně TVAREM: pobočka je
 * plocha, člověk čtvereček a proužek. Dnes mají obě pobočky Růžovou,
 * takže na pouhý odstín se spolehnout nedá.
 *
 * ---------------------------------------------------------------------
 * DEVĚT, ALE `firma` AŽ POSLEDNÍ
 *
 * `firma` je přízvuk firemní úrovně rozhraní. U poboček se schválně
 * neukládá (viz komentář v _tokeny.css), u člověka se ukládat smí —
 * jinak by paleta měla osm odstínů a Černá Perla s osmi lidmi by
 * neunesla devátého. Přiděluje se ale jako poslední.
 *
 * ---------------------------------------------------------------------
 * PRÁZDNO JE PLATNÝ STAV
 *
 * `null` znamená „bez barvy“ — buď ji někdo smazal, nebo při založení
 * žádná volná nezbyla. Nepřidělovat podruhé je schválně: dva lidé téže
 * barvy v jednom kalendáři vypadají jako jeden člověk, a to je horší
 * než chybějící pomůcka. Jméno je v rozpisu napsané tak jako tak.
 */

export const BARVY_LIDI = [
  'indigo',
  'amber',
  'emerald',
  'rose',
  'sky',
  'violet',
  'teal',
  'slate',
  'firma',
] as const

export type BarvaCloveka = (typeof BARVY_LIDI)[number]

/**
 * Názvy k barvám.
 *
 * Barva nikdy nestojí sama: u výběru je název, u značky v rozpisu
 * `title` a text pro odečítač. Kdo odstíny nerozliší, musí se všechno
 * dočíst — a jméno je vedle tak jako tak.
 */
export const NAZVY_BAREV_LIDI: Record<BarvaCloveka, string> = {
  indigo: 'Indigová',
  amber: 'Jantarová',
  emerald: 'Smaragdová',
  rose: 'Růžová',
  sky: 'Blankytná',
  violet: 'Fialová',
  teal: 'Modrozelená',
  slate: 'Břidlicová',
  firma: 'Firemní zelená',
}

/**
 * Je to klíč z palety?
 *
 * Databáze to hlídá `check`em, ale z prohlížeče přijde cokoli — a ručně
 * upravený řádek taky. Neznámý klíč se má chovat jako prázdno, ne jako
 * barva, kterou žádné pravidlo v CSS nedefinuje: taková značka by se
 * vykreslila průhledná a vypadala by jako chyba vykreslení.
 */
export function jeBarvaCloveka(x: unknown): x is BarvaCloveka {
  return typeof x === 'string' && (BARVY_LIDI as readonly string[]).includes(x)
}

/** Klíč, nebo `null` když je prázdný nebo neznámý. */
export function barvaNeboNic(x: unknown): BarvaCloveka | null {
  return jeBarvaCloveka(x) ? x : null
}
