/**
 * Hlasové zprávy — společné údaje pro obrazovku i akce.
 *
 * Je to vlastní soubor proto, že modul označený `'use server'` smí
 * vyvážet JEN funkce. Konstanta v něm překlad shodí, a hláška
 * („export nebyl nalezen") přitom míří na místo, kde se používá, ne
 * na příčinu. Stejná úvaha jako u lib/marketing-media.ts.
 */

/** Jméno kbelíku. Musí sedět s 20260917060000_hlasove_zpravy.sql. */
export const KBELIK = 'hlasovky'

/**
 * Jak dlouho platí podepsaný odkaz na přehrání.
 *
 * Hodina — stejná úvaha jako u fotek marketingu: kratší by rozbila
 * vlákno, které má někdo otevřené přes oběd; delší by znamenala
 * odkaz, který po odebrání účastnictví ještě dlouho funguje.
 */
export const PLATNOST_ODKAZU_S = 3600

/**
 * Nejdelší nahrávka, kterou composer dovolí. Sama o sobě nic
 * nevynucuje — limit na velikost souboru drží Storage
 * (`file_size_limit` v migraci), tohle je jen UX: ať se nahrávání
 * samo zastaví dřív, než narazí na ten limit a vrátí chybu.
 */
export const MAX_DELKA_S = 180

/**
 * Cesta v úložišti: firma / konverzace / soubor.
 *
 * Stejná úvaha jako u cestaVUlozisti pro marketing, jen s konverzací
 * místo pobočky — o přístupu k hlasovce rozhoduje účastnictví
 * v rozhovoru (app.je_ucastnik), ne dosah na pobočku. Táž úvaha je
 * v hlavičce migrace a v app.hlasovka_cesta_rozsah.
 */
export function cestaVUlozisti(tenantId: string, konverzaceId: string, nazev: string, pripona: string): string {
  return `${tenantId}/${konverzaceId}/${nazev}.${pripona}`
}

/** Z MIME typu nahrávky udělá příponu pro cestu v úložišti. */
export function priponaZMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mpeg')) return 'mp3'
  return 'webm'
}
