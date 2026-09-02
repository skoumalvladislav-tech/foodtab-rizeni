/**
 * Kdo se smí objevit v nabídce „Komu“ při vyplácení zálohy.
 *
 * Zadání docs/pozastaveni-zaloh-zadani.md, oddíl 2 a
 * docs/ukoly-codea-2026-09-02-rano.md, bod 2: pozastavený člověk
 * z nabídky ZMIZÍ.
 *
 * ---------------------------------------------------------------------
 * TOHLE JE POHODLÍ, NE OBRANA
 *
 * Odmítnutí padá v databázi (`vyplatit_zalohu` → `app.zalohy_pozastavene`)
 * a padne i tomu, kdo si volání poskládá sám. Obrazovka jen nenabízí
 * něco, co stejně neprojde — aby se člověk u okénka nedozvěděl
 * odmítnutí až před tím, komu zálohu slíbil.
 *
 * Platí PŘÍSNĚJŠÍ ze dvou úrovní: když je vypnuto za firmu, nezbude
 * nikdo, i kdyby jednotlivec pozastavené neměl.
 *
 * Stojí to zvlášť, aby na to šlo sáhnout kontrolou. Uvnitř stránky by
 * se to dalo ověřit jedině přihlášením do ostré aplikace a pozastavením
 * někomu skutečnému — tedy zásahem do ostrých dat.
 */

export type ClovekVNabidce = { id: string; jmeno: string }

export function nabidkaKVyplaceni<T extends { id: string }>({
  lide,
  pozastaveni,
  firmaPozastavena,
}: {
  /** Lidé pobočky i ti, kdo tu jen zaskakují. */
  lide: T[]
  /** Z průzoru `stav_pozastaveni`: osobní přepínač, bez firemního. */
  pozastaveni: { employee_id: string; pozastaveno: boolean }[]
  /** Firemní vypínač z `tenant_settings`. */
  firmaPozastavena: boolean
}): { nabidka: T[]; skrytych: number } {
  if (firmaPozastavena) return { nabidka: [], skrytych: lide.length }

  const podleId = new Map(pozastaveni.map((p) => [p.employee_id, p.pozastaveno]))
  const nabidka = lide.filter((l) => podleId.get(l.id) !== true)

  return { nabidka, skrytych: lide.length - nabidka.length }
}
