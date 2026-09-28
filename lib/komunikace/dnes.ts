/**
 * Věta pod kartou „Vzkazy“ na obrazovce Dnes.
 *
 * Do 27. 9. se u každého nepřečteného vzkazu vedení psalo „Nová zpráva
 * z vedení“ — i majiteli a vedoucímu, kterým vzkaz PŘIŠEL. Pro ně je to
 * obráceně: zaměstnanec píše vedení. „Z vedení“ platí jen pro autora
 * vzkazu, kterému vedení odpovědělo.
 *
 * Kdo vzkaz založil, říká `konverzace.zalozil` (employees.id).
 * Čistá funkce, test: scripts/komunikace.test.mjs.
 */

export type VzkazVedeniNaDnes = {
  /** employees.id autora vzkazu vedení. */
  zalozil: string | null
}

export function popisVzkazuNaDnes(
  /** Vzkazy vedení, ve kterých mám něco nepřečteného. */
  neprecteneVedeni: VzkazVedeniNaDnes[],
  /** Moje employees.id. */
  ja: string | null,
  /** Všech nepřečtených zpráv. */
  neprecteneCelkem: number,
): { text: string | null; dulezite: boolean } {
  const proMe = neprecteneVedeni.some((v) => ja === null || v.zalozil !== ja)
  if (proMe) return { text: 'Nový vzkaz pro vedení', dulezite: true }
  if (neprecteneVedeni.length > 0) return { text: 'Nová zpráva z vedení', dulezite: true }
  if (neprecteneCelkem > 0) return { text: 'Čeká na přečtení', dulezite: false }
  return { text: null, dulezite: false }
}
