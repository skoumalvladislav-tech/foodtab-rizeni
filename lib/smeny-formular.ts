/**
 * Pravidla formuláře nové směny — výběr zařazení (pozice).
 *
 * Šéfík 20. 9. 2026: zaměstnanci jsou zařazeni od začátku a změna se dá
 * napsat do poznámky, takže výběr zařazení při přidávání směny je zbytečné
 * klikání navíc. Přesto zůstává k dispozici a firma si v Nastavení → Směny
 * určí, jestli se nabízí (`tenant_settings.smeny_zarazeni_ve_formulari`).
 *
 * Čistá logika bez Reactu, ať jde zkoušet Nodem
 * (scripts/smeny-formular.test.mjs).
 */

/**
 * Nabízet pole zařazení?
 *
 * Zapnuté v nastavení = ano. Vypnuté = ne, ALE u neobsazené směny (nikdo
 * není vybraný) se nabízí vždycky: pozice tam neříká, kdo směnu má, ale
 * KOHO je třeba — bez ní by neobsazená směna byla jen čas bez významu.
 */
export function ukazatZarazeni(zapnutoVNastaveni: boolean, mamZamestnance: boolean): boolean {
  return zapnutoVNastaveni || !mamZamestnance
}

/**
 * Které zařazení se uloží se směnou.
 *
 *   pole je vidět        to, co je v něm vybráno (i „bez zařazení“)
 *   pole je schované     zařazení zaměstnance („zaměstnanci jsou zařazeni od
 *                        začátku“); u směny, která zařazení už měla a člověk
 *                        se nezměnil, ji nepřepisujeme — vedoucí ji mohl
 *                        nastavit dřív, než se pole schovalo, a upravit
 *                        směnu nemá znamenat přepsat zařazení
 *
 * `poziceSmeny` je zařazení, které směna měla, ale JEN když se zaměstnanec
 * od uložené směny nezměnil; po výměně člověka to platí o novém člověku.
 */
export function zarazeniProUlozeni(vstup: {
  ukazano: boolean
  vybrana: string
  poziceZamestnance: string | null | undefined
  poziceSmeny: string | null | undefined
}): string {
  if (vstup.ukazano) return vstup.vybrana
  return vstup.poziceSmeny || vstup.poziceZamestnance || ''
}
