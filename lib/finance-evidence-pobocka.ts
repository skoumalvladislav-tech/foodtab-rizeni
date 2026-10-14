/**
 * Evidence po pobočkách — Nákup, Zakázky, Vybavení, Rozpočty.
 *
 * Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru." Tyhle čtyři obrazovky mají
 * `branch_id` přímo na svém řádku (objednávka, zakázka, vybavení,
 * rozpočet), takže pobočka je jednoduchá: na pobočce se ukazují
 * a mění JEN řádky s touto pobočkou. Řádky celé firmy (`branch_id`
 * null) patří pohledu Celá firma (lib/finance-rozsah.ts).
 *
 * Databáze sama NEHLÍDÁ, že `branch_id` řádku patří stejné firmě
 * (žádná spoušť jako `app.hlida_firmu_zakazky` pro pobočku) a
 * `has_access` firemního správce pustí na jakékoli id pobočky. Proto
 * se pobočka z formuláře přijme jen ze seznamu poboček TÉHLE firmy,
 * načteného z databáze — nikdy jen proto, že ji formulář poslal.
 *
 * Čisté funkce bez importů za běhu — zkouší je
 * scripts/finance-evidence-pobocka.test.mjs.
 */

export type VolbaPobocky = { stav: 'ok'; branchId: string | null } | { stav: 'chyba'; text: string }

/**
 * Pobočka nového záznamu (objednávka, zakázka, vybavení, rozpočet).
 *
 *   * na pobočce (`pobockaRozsahu` vyplněná) VŽDY ta pobočka — pole
 *     z formuláře se nečte vůbec: skryté pole si kdokoli přepíše
 *     a záznam by z Bernard Baru založil celé firmě nebo jiné pobočce;
 *   * za celou firmu podle formuláře jako dosud: prázdné = celá firma
 *     (`null`), jinak jen pobočka ze `povolene` (aktivní pobočky téhle
 *     firmy).
 */
export function pobockaZaznamu(
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
 * Smí se záznam ukázat nebo změnit v daném rozsahu?
 *
 * Za celou firmu každý záznam firmy; na pobočce jen záznam TÉ pobočky —
 * záznam celé firmy (`branch_id` null) ani záznam jiné pobočky ne
 * (`null` není „patří všem"). Záznam, který se nenašel (cizí firma,
 * překlep v adrese, RLS), nikdy.
 */
export function zaznamPatriRozsahu(
  pobockaRozsahu: string | null,
  zaznam: { branch_id: string | null } | null | undefined,
): boolean {
  if (!zaznam) return false
  return pobockaRozsahu === null || zaznam.branch_id === pobockaRozsahu
}

/**
 * Hodnota `?pobocka=` pro FIREMNÍ rozpočty (`branch_id` null).
 *
 * Do 13. 10. 2026 se firemní rozpočet dal uložit („Celá firma"
 * ve formuláři), ale nikde ukázat — výběr nahoře nabízel jen pobočky.
 * `rozpocet_prehled` s `p_branch` null vrací právě je (plán bez pobočky
 * a skutečnost z účtů bez pobočky). Pobočky mají v adrese uuid, takže
 * se slovo „firma" s žádnou nepotká.
 */
export const ROZPOCTY_FIRMY = 'firma'

/**
 * Čí rozpočty obrazovka ukazuje: id pobočky, nebo `null` = firemní
 * rozpočty (bez pobočky — NE součet všech poboček).
 *
 *   * na pobočce VŽDY pobočka rozsahu — `?pobocka=` z adresy se nečte
 *     (výběr tam ani není);
 *   * za celou firmu `?pobocka=firma` → firemní rozpočty; id aktivní
 *     pobočky → ta pobočka; cokoli jiného (nic, vypnutá nebo cizí
 *     pobočka, překlep) → první pobočka jako dosud, a bez poboček
 *     firemní rozpočty.
 *
 * Neznámé id se nepouští dál schválně: výběr by ho nenabízel, prohlížeč
 * by ve formuláři předvybral první volbu („Celá firma") a pouhé
 * „Uložit" by z rozpočtu té pobočky udělalo firemní.
 */
export function pohledRozpoctu(
  pobockaRozsahu: string | null,
  zAdresy: string | null | undefined,
  pobocky: readonly { id: string }[],
): string | null {
  if (pobockaRozsahu !== null) return pobockaRozsahu
  if (zAdresy === ROZPOCTY_FIRMY) return null
  if (zAdresy && pobocky.some((b) => b.id === zAdresy)) return zAdresy
  return pobocky[0]?.id ?? null
}

/** Hodnota výběru / `?pobocka=` pro daný pohled (opak `pohledRozpoctu`). */
export function hodnotaPohleduRozpoctu(branchId: string | null): string {
  return branchId ?? ROZPOCTY_FIRMY
}

/** Věta pod seznamem objednávek na pobočce. */
export const POZNAMKA_OBJEDNAVKY_FIRMY =
  'Objednávky celé firmy bez pobočky tu nejsou — jsou vidět v pohledu Celá firma.'

/** Věta pod seznamem zakázek na pobočce. */
export const POZNAMKA_ZAKAZKY_FIRMY =
  'Zakázky celé firmy bez pobočky tu nejsou — jsou vidět v pohledu Celá firma.'

/**
 * Pobočka bez platebního účtu — skutečnost (tržby, výdaje) se z čeho
 * spočítat nemá. Dnes je každý účet založený v appce firemní, takže je
 * to zatím běžný stav; „0 Kč" by tvrdilo, že pobočka nic neutržila.
 */
export const BEZ_UCTU_POBOCKY =
  'Pobočka zatím nemá přiřazený žádný platební účet, takže skutečné příjmy a výdaje se pro ni nedají spočítat. Účet pobočce přiřadíte v pohledu Celá firma → Platby.'
