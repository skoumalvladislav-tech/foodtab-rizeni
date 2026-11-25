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
 * Krok 3 (Finance Fáze 0): účet bez pobočky se zakládá jen VÝSLOVNOU
 * volbou „Firemní účet (bez pobočky)" (`FIREMNI_VOLBA`) — prázdný výběr
 * už neznamená „celá firma", je to chyba. A úpravu účtu (pobočka, číslo,
 * název, aktivní) skládá čistá `upravaUctu`.
 *
 * Čisté funkce — zkouší je scripts/finance-platby-pobocka.test.mjs
 * a scripts/finance-ucty-pobocek.test.mjs.
 */

import { overitCisloUctu } from './banka/ucet.ts'
import { FIREMNI_UCET, FIREMNI_VOLBA, KDO_SPRAVUJE_UCTY } from './finance-ucty-pobocek.ts'

export type VolbaPobocky = { stav: 'ok'; branchId: string | null } | { stav: 'chyba'; text: string }

/** Pobočka firmy, jak ji čte stránka Plateb (`branches`, bez smazaných). */
export type PobockaFirmy = { id: string; name: string; active: boolean }

/** Chyba výběru pobočky, když nepřišlo nic — ani pobočka, ani „Firemní účet". */
export const VYBERTE_POBOCKU_UCTU = 'Vyberte pobočku účtu, nebo „Firemní účet (bez pobočky)“.'

/**
 * Pobočka nového platebního účtu, nebo nová pobočka existujícího účtu.
 *
 *   * na pobočce (`pobockaRozsahu` vyplněná) VŽDY ta pobočka — pole
 *     z formuláře se nečte vůbec: skryté pole si kdokoli přepíše a účet
 *     by z Bernard Baru založil firmě nebo jiné pobočce;
 *   * za celou firmu podle formuláře: `FIREMNI_VOLBA` = účet bez pobočky
 *     (`null`), jinak jen pobočka ze `povolene` (aktivní pobočky téhle
 *     firmy). Prázdné pole je CHYBA — dřív znamenalo celou firmu, takže
 *     kdo pobočku nevybral, založil firemní účet a platby pobočky pak
 *     v jejích číslech chyběly (krok 3, bod 3).
 */
export function pobockaUctu(
  pobockaRozsahu: string | null,
  zFormulare: string | null | undefined,
  povolene: Iterable<string>,
): VolbaPobocky {
  if (pobockaRozsahu !== null) return { stav: 'ok', branchId: pobockaRozsahu }

  const hodnota = (zFormulare ?? '').trim()
  if (!hodnota) return { stav: 'chyba', text: VYBERTE_POBOCKU_UCTU }
  if (hodnota === FIREMNI_VOLBA) return { stav: 'ok', branchId: null }

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

/**
 * Proč platbu na tenhle účet zapsat nejde (zapsatTransakci), nebo `null`.
 *   * Účet musí patřit rozsahu (`ucetPatriRozsahu`).
 *   * Vypnutý účet ne — vypnutý účet je totéž co žádný (krok 3): součty
 *     ho nepočítají, platba by z čísel tiše zmizela. Stránka vypnuté účty
 *     k zápisu nenabízí; tohle chytí starý formulář nebo ručně poslaný
 *     požadavek.
 */
export function problemUctuProZapis(
  pobockaRozsahu: string | null,
  ucet: { branch_id: string | null; aktivni: boolean } | null | undefined,
): string | null {
  if (!ucet || !ucetPatriRozsahu(pobockaRozsahu, ucet)) {
    return pobockaRozsahu
      ? 'Na pobočce jde platbu zapsat jen na platební účet této pobočky.'
      : 'Platební účet se nenašel.'
  }
  if (!ucet.aktivni) {
    return 'Na vypnutý platební účet platbu zapsat nejde — vyberte aktivní účet, nebo tenhle nejdřív zapněte v Platebních účtech.'
  }
  return null
}

/** Kam účet patří — pro výpis účtů. Vypnutou pobočku řekne nahlas. */
export function nazevPobockyUctu(branchId: string | null, pobocky: readonly PobockaFirmy[]): string {
  if (branchId === null) return FIREMNI_UCET
  const pobocka = pobocky.find((b) => b.id === branchId)
  if (!pobocka) return 'Pobočka mimo seznam'
  return pobocka.active ? pobocka.name : `${pobocka.name} (vypnutá)`
}

/**
 * Volby výběru „Pobočka" u existujícího účtu: Firemní účet, aktivní
 * pobočky — a VŽDY i současná pobočka účtu, i když je vypnutá nebo
 * v seznamu chybí (smazaná, cizí). Jinak by prohlížeč předvybral první
 * volbu (Firemní účet) a pouhé „Uložit" bez změny by účet i se všemi jeho
 * platbami tiše přesunulo mezi firemní.
 */
export function volbyPobockyUctu(
  pobocky: readonly PobockaFirmy[],
  soucasna: string | null,
): { value: string; label: string }[] {
  const volby = [{ value: FIREMNI_VOLBA, label: FIREMNI_UCET }]
  for (const b of pobocky) {
    if (b.active || b.id === soucasna) volby.push({ value: b.id, label: nazevPobockyUctu(b.id, pobocky) })
  }
  if (soucasna !== null && !volby.some((v) => v.value === soucasna)) {
    volby.push({ value: soucasna, label: nazevPobockyUctu(soucasna, pobocky) })
  }
  return volby
}

/** Hodnota výběru pobočky, kterou má účet teď (`FIREMNI_VOLBA` u účtu bez pobočky). */
export function hodnotaPobockyUctu(branchId: string | null): string {
  return branchId ?? FIREMNI_VOLBA
}

export const NEPODARILO_ULOZIT_UCET = 'Účet se nepodařilo uložit.'

/**
 * Hláška, když databáze úpravu účtu odmítla.
 *   * Na účet může mířit připojení banky POBOČKY (synchronizace zapisuje
 *     do účtu té pobočky) — takový účet databáze nepřestěhuje, dokud se
 *     připojení neodpojí (spoušť app.hlida_firmu_platebniho_uctu,
 *     20261119100000).
 *   * Účet, na který míří živé připojení banky, nejde vypnout — pohyby
 *     by do něj dál chodily, ale v součtech by nebyly (spoušť
 *     app.hlida_vypnuti_platebniho_uctu, 20261121100000).
 *   * 42501 = politika nebo sloupcový grant: upravuje jen finance.manage
 *     za celou firmu.
 * Jinak obecná věta.
 */
export function hlaskaUpravyUctu(chyba: { code?: string | null; message?: string | null } | null | undefined): string {
  const zprava = chyba?.message ?? ''
  if (chyba?.code === '23514' && /vypn/i.test(zprava)) {
    return 'Na účet míří živé připojení banky. Nejdřív ho v Integracích odpojte, pak účet vypněte.'
  }
  if (chyba?.code === '23514' && /připojení/i.test(zprava)) {
    return 'Na účet míří připojení banky jiné pobočky. Nejdřív ho v Integracích odpojte, pak účet přesuňte.'
  }
  if (chyba?.code === '23514' && /Pobočka nepatří/i.test(zprava)) {
    return 'Vybraná pobočka nepatří této firmě.'
  }
  if (chyba?.code === '42501') {
    return `Účet upravuje jen ${KDO_SPRAVUJE_UCTY}.`
  }
  return NEPODARILO_ULOZIT_UCET
}

/** Účet, jak ho upravuje stránka Plateb. */
export type UpravovanyUcet = { nazev: string; branch_id: string | null; cislo_uctu: string; aktivni: boolean }

/** Co přišlo z formuláře úpravy účtu (syrově, jak to poslal prohlížeč). */
export type FormularUctu = { nazev: string | null; cislo: string | null; aktivni: boolean; pobocka: string | null }

export type ZmenyUctu = Partial<Pick<UpravovanyUcet, 'nazev' | 'branch_id' | 'cislo_uctu' | 'aktivni'>>

export type UpravaUctu =
  | { stav: 'beze_zmeny' }
  | { stav: 'chyba'; text: string }
  /** Jen ZMĚNĚNÉ sloupce — nezměněná pobočka se do UPDATE neposílá (spoušť by ji kontrolovala znovu). */
  | { stav: 'ok'; zmeny: ZmenyUctu }

/**
 * Úprava existujícího účtu (krok 3, bod 4): pobočka, číslo účtu / IBAN,
 * název, aktivní. Vrací jen to, co se opravdu mění.
 *
 *   * Pobočka: současná hodnota (i vypnutá, smazaná, cizí — výběr ji
 *     nabízí, ať „Uložit" nic nepřesune) = beze změny. Jiná jen
 *     `FIREMNI_VOLBA` nebo pobočka z `povolene` (AKTIVNÍ pobočky téhle
 *     firmy, načtené z databáze). Prázdná = chyba.
 *   * Číslo účtu: pole beze změny (stejný text jako uložený) = beze změny,
 *     bez ověřování — starší zápis čísla se tichým přepisem nemění a ani
 *     neblokuje uložení jiného údaje. Změněné ověří `overitCisloUctu`
 *     (stejný tvar jako protiúčet pohybu — překlep v IBANu se odmítne, ne
 *     uloží); jiný zápis TÉHOŽ čísla (české číslo × IBAN) změna není.
 *   * Název povinný.
 */
export function upravaUctu(ucet: UpravovanyUcet, formular: FormularUctu, povolene: Iterable<string>): UpravaUctu {
  const nazev = (formular.nazev ?? '').trim()
  if (!nazev) return { stav: 'chyba', text: 'Vyplňte název účtu.' }

  const zmeny: ZmenyUctu = {}
  const cisloZFormulare = (formular.cislo ?? '').trim()
  if (cisloZFormulare !== ucet.cislo_uctu.trim()) {
    const cislo = overitCisloUctu(cisloZFormulare)
    if (cislo.stav === 'chyba') return { stav: 'chyba', text: cislo.text }
    const ulozene = overitCisloUctu(ucet.cislo_uctu)
    if (!(ulozene.stav === 'ok' && ulozene.ucet === cislo.ucet)) zmeny.cislo_uctu = cislo.ucet
  }

  const vybrana = (formular.pobocka ?? '').trim()
  if (vybrana !== hodnotaPobockyUctu(ucet.branch_id)) {
    const volba = pobockaUctu(null, vybrana, povolene)
    if (volba.stav === 'chyba') return volba
    if (volba.branchId !== ucet.branch_id) zmeny.branch_id = volba.branchId
  }
  if (nazev !== ucet.nazev) zmeny.nazev = nazev
  if (formular.aktivni !== ucet.aktivni) zmeny.aktivni = formular.aktivni

  return Object.keys(zmeny).length === 0 ? { stav: 'beze_zmeny' } : { stav: 'ok', zmeny }
}
