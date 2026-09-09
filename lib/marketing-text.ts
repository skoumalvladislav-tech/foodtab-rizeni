/**
 * Marketing — texty a drobná logika obrazovek.
 *
 * Proč to není přímo v obrazovce: serverová komponenta se mimo aplikaci
 * nedá vykreslit, takže by na to nešlo sáhnout kontrolou. Přesně kvůli
 * tomu vznikl `lib/dochazka-stav.ts` i `lib/upozorneni-text.ts` — tohle
 * je totéž pro marketing (`scripts/marketing.test.mjs`).
 */

/**
 * Stav příspěvku → věta pro člověka.
 *
 * Klíče se MUSÍ krýt s omezením sloupce `stav` v migraci
 * 20260909200000_marketing_obsah.sql. Hlídá to kontrola v
 * `scripts/marketing.test.mjs` obousměrně: chybějící překlad by na
 * obrazovku pustil syrový databázový výraz, přebývající by znamenal,
 * že se stav někde přejmenoval a nikdo to nedotáhl.
 */
export const STAVY_PRISPEVKU: Record<string, string> = {
  koncept: 'koncept',
  navrh_hotovy: 'návrh hotový',
  ceka_na_schvaleni: 'čeká na schválení',
  schvaleno: 'schváleno',
  naplanovano: 'naplánováno',
  zverejnuje_se: 'zveřejňuje se',
  zverejneno: 'zveřejněno',
  zamitnuto: 'zamítnuto',
  navrh_selhal: 'návrh selhal',
  render_selhal: 'obrázek se nepovedl',
  publikace_selhala: 'zveřejnění selhalo',
  archivovano: 'archivováno',
}

/** Stavy, které znamenají „něco se pokazilo a čeká to na člověka". */
export const STAVY_CHYBOVE = ['navrh_selhal', 'render_selhal', 'publikace_selhala']

/**
 * Neznámý stav se NEPŘEKLÁDÁ na prázdno ani na „neznámý".
 *
 * Kdyby se vrátil prázdný řetězec, zmizel by ze sloupce beze stopy
 * a vypadalo by to, že příspěvek žádný stav nemá. Radši ať je vidět
 * syrový výraz — je to nápadné a dá se podle něj hledat.
 */
export function popisStavu(stav: string): string {
  return STAVY_PRISPEVKU[stav] ?? stav
}

/**
 * „hovězí, domácí , , poctivé" → ['hovězí','domácí','poctivé']
 *
 * Strop je tu proto, že tenhle seznam jde do zadání pro jazykový model
 * jako pravidlo. Dvě stě výrazů by z pravidla udělalo šum, ve kterém
 * se ztratí to podstatné.
 */
export const STROP_VYRAZU = 40

export function seznamVyrazu(hodnota: string | null | undefined): string[] {
  return String(hodnota ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, STROP_VYRAZU)
}

/**
 * Prázdné pole znamená „nezadáno", ne prázdnou hodnotu.
 *
 * Rozdíl není kosmetický: podle `null` pozná návrh, že tenhle údaj
 * nemá odkud vzít, a vynechá ho. Prázdný řetězec by se do obrázku
 * vysázel jako prázdné místo pod podpisem.
 */
export function neboNull(hodnota: string | null | undefined): string | null {
  const s = String(hodnota ?? '').trim()
  return s === '' ? null : s
}

/**
 * Délka videa: co projde databázi (3–90 s).
 *
 * Ořezává se tady, aby uživatel místo syrové hlášky z Postgresu dostal
 * rozumnou hodnotu. Omezení v databázi tím nemizí — je to druhá linie,
 * ne náhrada (pravidlo 3).
 */
export const VIDEO_MIN = 3
export const VIDEO_MAX = 90

export function delkaVidea(hodnota: unknown, vychozi = 20): number {
  const n = Number(hodnota)
  if (!Number.isFinite(n)) return vychozi
  return Math.min(VIDEO_MAX, Math.max(VIDEO_MIN, Math.round(n)))
}
