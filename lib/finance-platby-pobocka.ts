/**
 * Platby po pobočkách — čisté rozhodování pro app/[rozsah]/finance/platby.
 *
 * Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru." Platba (`transakce`) pobočku sama
 * nemá — patří jí přes svůj platební účet (`platebni_ucty.branch_id`).
 * Na pobočce se proto ukazují a zapisují jen účty té pobočky; firemní
 * účet (`branch_id` null) a jeho platby patří pohledu Celá firma
 * (lib/finance-rozsah.ts, `POZNAMKA_FIREMNI`).
 *
 * Databáze sama NEHLÍDÁ, že `branch_id` účtu patří stejné firmě jako
 * účet (žádná spoušť jako `app.hlida_firmu_transakce`) a `has_access`
 * firemního správce pustí na jakékoli id pobočky. Proto se pobočka
 * z formuláře přijme jen ze seznamu poboček TÉHLE firmy, načteného
 * z databáze — nikdy jen proto, že ji formulář poslal.
 *
 * Čisté funkce bez importů za běhu — zkouší je
 * scripts/finance-platby-pobocka.test.mjs.
 */

export type VolbaPobocky = { stav: 'ok'; branchId: string | null } | { stav: 'chyba'; text: string }

/** Pobočka firmy, jak ji čte stránka Plateb (`branches`, bez smazaných). */
export type PobockaFirmy = { id: string; name: string; active: boolean }

/** Popisek pro účet bez pobočky (výběr i výpis účtů). */
export const CELA_FIRMA = 'Celá firma'

/**
 * Pobočka nového platebního účtu, nebo nová pobočka existujícího účtu.
 *
 *   * na pobočce (`pobockaRozsahu` vyplněná) VŽDY ta pobočka — pole
 *     z formuláře se nečte vůbec: skryté pole si kdokoli přepíše a účet
 *     by z Bernard Baru založil firmě nebo jiné pobočce;
 *   * za celou firmu podle formuláře: prázdné = celá firma (`null`),
 *     jinak jen pobočka ze `povolene` (aktivní pobočky téhle firmy).
 */
export function pobockaUctu(
  pobockaRozsahu: string | null,
  zFormulare: string | null | undefined,
  povolene: Iterable<string>,
): VolbaPobocky {
  if (pobockaRozsahu !== null) return { stav: 'ok', branchId: pobockaRozsahu }

  const hodnota = (zFormulare ?? '').trim()
  if (!hodnota) return { stav: 'ok', branchId: null }

  for (const id of povolene) {
    if (id === hodnota) return { stav: 'ok', branchId: hodnota }
  }
  return { stav: 'chyba', text: 'Vybraná pobočka nepatří mezi aktivní pobočky firmy.' }
}

/**
 * Smí se na tenhle účet zapsat platba (nebo ho ukázat) v daném rozsahu?
 *
 * Za celou firmu každý účet firmy; na pobočce jen účet TÉ pobočky —
 * firemní účet (`branch_id` null) ani účet jiné pobočky ne. Účet, který
 * se nenašel (cizí firma, překlep, RLS), nikdy.
 */
export function ucetPatriRozsahu(
  pobockaRozsahu: string | null,
  ucet: { branch_id: string | null } | null | undefined,
): boolean {
  if (!ucet) return false
  return pobockaRozsahu === null || ucet.branch_id === pobockaRozsahu
}

/** Kam účet patří — pro výpis účtů. Vypnutou pobočku řekne nahlas. */
export function nazevPobockyUctu(branchId: string | null, pobocky: readonly PobockaFirmy[]): string {
  if (branchId === null) return CELA_FIRMA
  const pobocka = pobocky.find((b) => b.id === branchId)
  if (!pobocka) return 'Pobočka mimo seznam'
  return pobocka.active ? pobocka.name : `${pobocka.name} (vypnutá)`
}

/**
 * Volby výběru „Pobočka" u existujícího účtu: Celá firma, aktivní
 * pobočky — a VŽDY i současná pobočka účtu, i když je vypnutá nebo
 * v seznamu chybí. Jinak by prohlížeč předvybral první volbu (Celá
 * firma) a pouhé „Uložit" bez změny by účet i se všemi jeho platbami
 * tiše přesunulo na celou firmu.
 */
export function volbyPobockyUctu(
  pobocky: readonly PobockaFirmy[],
  soucasna: string | null,
): { value: string; label: string }[] {
  const volby = [{ value: '', label: CELA_FIRMA }]
  for (const b of pobocky) {
    if (b.active || b.id === soucasna) volby.push({ value: b.id, label: nazevPobockyUctu(b.id, pobocky) })
  }
  if (soucasna !== null && !volby.some((v) => v.value === soucasna)) {
    volby.push({ value: soucasna, label: nazevPobockyUctu(soucasna, pobocky) })
  }
  return volby
}
