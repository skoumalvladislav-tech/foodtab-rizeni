/**
 * Knihovna fotek — společné údaje pro obrazovku i akce.
 *
 * Je to vlastní soubor proto, že modul označený `'use server'` smí
 * vyvážet JEN funkce. Konstanta v něm překlad shodí, a hláška
 * („export nebyl nalezen") přitom míří na místo, kde se používá, ne
 * na příčinu.
 */

/** Jméno kbelíku. Musí sedět s 20260913170000_marketing_ulozne.sql. */
export const KBELIK = 'marketing'

/**
 * Jak dlouho platí podepsaný odkaz na náhled.
 *
 * Hodina. Kratší by rozbila stránku, kterou má někdo otevřenou přes
 * oběd; delší by znamenala odkaz, který po odebrání práv ještě dlouho
 * funguje.
 */
export const PLATNOST_ODKAZU_S = 3600

/** Sbírky, do kterých se fotky třídí. Musí sedět s `check` na sloupci. */
export const SBIRKY = [
  { klic: 'jidla', nazev: 'Jídla' },
  { klic: 'interier', nazev: 'Interiér' },
  { klic: 'lide', nazev: 'Lidé' },
  { klic: 'akce', nazev: 'Akce' },
  { klic: 'ostatni', nazev: 'Ostatní' },
] as const

/**
 * Cesta v úložišti: firma / pobočka / soubor.
 *
 * Firma je první složka schválně — politika podle ní pozná, komu
 * soubor patří, a musí to jít poznat z cesty samotné. Slovo `firma`
 * místo prázdné složky proto, že dvě lomítka za sebou se čtou různě.
 * Táž úvaha je v hlavičce migrace a v `app.marketing_cesta_rozsah`.
 */
export function cestaVUlozisti(
  tenantId: string,
  branchId: string | null,
  nazev: string,
  pripona: string,
): string {
  return `${tenantId}/${branchId ?? 'firma'}/${nazev}.${pripona}`
}
