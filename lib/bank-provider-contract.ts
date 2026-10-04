/**
 * BankDataProvider — úzký kontrakt pro bankovní adaptéry.
 *
 * Zadání (docs/bankovni-modul-zadani-2026-10-04.md, oddíl 1): „Vytvoř
 * úzký BankDataProvider kontrakt... Odděl normalizované finanční
 * procesy od provider-specific DTO, ID, endpointů a chyb... Přidání
 * nového adapteru nesmí vyžadovat změnu párování nebo cashflow."
 *
 * Tenhle soubor je JEDINÉ místo, které párování/cashflow/UI vidí.
 * Co dělá Fio/Enable Banking/CSV uvnitř (tvar jejich odpovědi, jejich
 * chybové kódy, jejich tokenový/OAuth postup) zůstává v
 * `lib/integrace-fio.ts`/`integrace-enablebanking.ts`/
 * `finance-csv-import.ts` — sem se promítá jen přes `RadekImportu`
 * (sdílený tvar, existuje od P0: `lib/finance-csv-import.ts`).
 *
 * NEPŘIDÁVÁ platby (zadání: „Nepřidávej payment initiation do tohoto
 * kontraktu") — appka je výhradně pro čtení (CLAUDE.md, pravidlo
 * „banka jen pro čtení").
 */

import type { RadekImportu } from './finance-csv-import.ts'

/** Jak appka k datům přijde. Fio má jiný tokenový postup než PSD2 agregátor — appka to nesmí předpokládat stejné. */
export type ZpusobPripojeni = 'souhlas_redirect' | 'rucni_token' | 'import'

/**
 * Co tenhle KONKRÉTNÍ adaptér umí — appka se řídí tímhle, ne tím, co
 * poskytovatel obecně nabízí (zadání: „Capability mapa musí odlišovat
 * souhlas/ruční token/import, firemní a soukromé účty, dostupné
 * zůstatky, historii, VS/reference, pending/booked a možnosti
 * synchronizace").
 */
export type SchopnostiProvidera = {
  zpusobPripojeni: ZpusobPripojeni
  firemniUcty: boolean
  soukromeUcty: boolean
  dostupneZustatky: ('knihovni' | 'disponibilni')[]
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  /** Poskytuje VS/KS/SS nebo jejich ekvivalent (ne vždy — PSD2 feed je často jen volný text). */
  vsReference: boolean
  /** Rozlišuje nevypořádané (pending) od zaúčtovaných (booked). */
  pendingTransakce: boolean
  inkrementalniSync: boolean
}

export type BodZustatku = {
  typ: 'knihovni' | 'disponibilni'
  castkaHaleru: number
  mena: string
  /** Kdy byl zůstatek platný PODLE POSKYTOVATELE — ne kdy ho appka stáhla. */
  platnyK: string
}

export type UcetProvidera = {
  /** Id u poskytovatele — appka si ho ukládá jako vazbu, nikdy jako vlastní identitu účtu. */
  providerAccountId: string
  cisloUctu: string | null
  iban: string | null
  mena: string
  firemniUcet: boolean | null
}

export type VysledekOvereni = { stav: 'ok'; ucty: UcetProvidera[] } | { stav: 'chyba'; duvod: string }
export type VysledekZustatku = { stav: 'ok'; zustatky: BodZustatku[] } | { stav: 'chyba'; duvod: string }
export type VysledekTransakci = { stav: 'ok'; radky: RadekImportu[] } | { stav: 'chyba'; duvod: string }

/**
 * Jeden adaptér = jeden objekt podle tohohle tvaru. Metody pro
 * `souhlas_redirect` (zahajitPripojeni/dokoncitCallback) a pro
 * `rucni_token` (overitToken) jsou od sebe oddělené — adaptér
 * implementuje jen tu dvojici/metodu, která odpovídá jeho
 * `schopnosti.zpusobPripojeni`.
 */
export type BankDataProvider = {
  klic: string
  nazev: string
  schopnosti: SchopnostiProvidera

  /** `zpusobPripojeni: 'rucni_token'` (Fio) — appka token jen ověří, nic nezahajuje. */
  overitToken?(token: string): Promise<VysledekOvereni>

  /** `zpusobPripojeni: 'souhlas_redirect'` (PSD2 agregátor) — appka přesměruje uživatele na vrácenou adresu. */
  zahajitPripojeni?(navratovaAdresa: string, odkaz: string): Promise<{ stav: 'ok'; presmerovatNa: string } | { stav: 'chyba'; duvod: string }>
  /** Po návratu z banky appka zjistí výsledek dotazem na STAV u poskytovatele, ne z parametrů v URL (ty některý poskytovatel nedává). */
  dokoncitCallback?(odkaz: string): Promise<VysledekOvereni>

  /** Společné pro všechny živé adaptéry (ne pro `zpusobPripojeni: 'import'`). */
  nactiZustatky?(ucet: string, token: string): Promise<VysledekZustatku>
  nactiTransakce?(ucet: string, token: string, od: string, doData: string): Promise<VysledekTransakci>
  zkontrolovatPripojeni?(token: string): Promise<boolean>
  /** Jen pokud poskytovatel odvolání podporuje (zadání: „pokud podporováno"). */
  odvolatPristup?(token: string): Promise<void>
}
