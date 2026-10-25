/**
 * Zápis skladového výdeje do Dotykačky — KDE JE POVOLENÝ.
 *
 * Seznam je PRÁZDNÝ a tím je zápis odebraný: adaptér
 * (`vytvoritDotykacku().otevrit()`) připojí k relaci metodu zápisu jen
 * pro cloud, který tu má aspoň jednu provozovnu, a zápis sám odmítne
 * provozovnu mimo seznam bez jediného volání (`zapisVydejeDotykacka`).
 * Žádná proměnná prostředí ani nastavení v databázi ho zapnout neumí —
 * „bezpečné, protože to nikdo nenastavil" není pojistka (pravidlo
 * projektu). Zapnutí je změna kódu, která projde PR.
 *
 * KDY SE SMÍ PŘIDAT ŘÁDEK (docs/jine-platby-vydej-dotykacka.md, oddíl 6;
 * otázka 54 v docs/hlaseni/otazky.md):
 *   1. Postup z oddílu 6 prošel na TESTOVACÍM cloudu Dotykačky (ne na
 *      Černé Perle ani Bernardovi): odpis odečte suroviny podle receptury,
 *      neobjeví se v tržbách (`productSales`) a dohledání podle klíče
 *      vrátí právě ten účet s položkami výdeje.
 *   2. Šéfík VÝSLOVNĚ napsal, pro kterou provozovnu zápis zapnout.
 *      Jeho pokyn (datum a znění) patří do `pokyn` — bez něj řádek
 *      nepřidávat.
 * Dokud to neplatí, zůstává výdej ruční (Odpis v Dotykačce + „Ručně
 * doloženo") a appka do skladu Dotykačky nezapisuje nic.
 *
 * Kdo seznam naplní, musí vědomě změnit i kontrolu v
 * `scripts/pokladna-dotykacka-sklad.test.mjs` („seznam povolených
 * provozoven je prázdný“).
 *
 * Čistý modul bez importů za běhu (testuje ho Node přímo).
 */

export type PovolenyZapis = {
  /** Cloud ID Dotykačky (stejné jako `cloud_id` připojení). */
  cloudId: string
  /** `_branchId` provozovny v Dotykačce. */
  provozovna: string
  /** Výslovný pokyn Šéfíka: datum a znění. Bez pokynu se řádek nepřidává. */
  pokyn: string
}

export const ZAPIS_VYDEJE_DOTYKACKA: readonly PovolenyZapis[] = []

const TVAR_ID = /^\d{1,15}$/

/**
 * Povolené provozovny jednoho cloudu. Řádek bez pokynu nebo s id mimo tvar
 * se nepočítá — chybně vyplněný seznam nic neodemkne.
 */
export function povoleneProvozovny(cloudId: string, seznam: readonly PovolenyZapis[] = ZAPIS_VYDEJE_DOTYKACKA): ReadonlySet<string> {
  const vysledek = new Set<string>()
  for (const r of seznam) {
    if (r.cloudId !== cloudId || !TVAR_ID.test(r.cloudId) || !TVAR_ID.test(r.provozovna)) continue
    if (typeof r.pokyn !== 'string' || r.pokyn.trim().length < 10) continue
    vysledek.add(r.provozovna)
  }
  return vysledek
}
