/**
 * PosProvider — úzký kontrakt pro pokladní (POS) adaptéry.
 *
 * Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 3
 * ("Vytvoř výměnné adaptéry PosProvider... Každý deklaruje schopnosti:
 * autentizaci, datové oblasti, webhooky, historii, stránkování,
 * inkrementální načítání, limity a obnovu přístupu.") a oddíl 5
 * (Dotykačka jako první kandidát).
 *
 * STEJNÝ VZOR JAKO `lib/bank-provider-contract.ts`: appka/foodcost vidí
 * jen `RadekPokladny` (existuje od P0, `lib/pokladna-csv-import.ts`,
 * krmí `public.importovat_pokladna_prodeje` → `pokladna_prodeje_denni`
 * → `foodcost_beverage_prehled`) — živý adaptér má psát do STEJNÉHO
 * tvaru, co dnes píše CSV import, aby přidání živého API nevyžadovalo
 * změnu foodcost/beverage logiky ani směrování dat.
 *
 * ŽÁDNÝ KONKRÉTNÍ HTTP KLIENT TADY NENÍ. Dotykačka má zdokumentované
 * API (docs.api.dotypos.com, API v2 — ověřeno WebFetch 7.10.2026:
 * entity Order/OrderItem/DeliveryNote pro prodeje, Product/Category/
 * DailyMenu, Branch/Warehouse, Customer, Webhook, Paging/Filtering/
 * Sorting), ale appka nemá partnerskou/test licenci (žádá se formulářem
 * u Dotykačky — appka ho sama nevyplňuje, zadání §1: „neposílej
 * obchodní poptávky"). Přesný autentizační model (API klíč vs. OAuth) a
 * konkrétní pole se ověří AŽ s licencí v ruce — kontrakt níž je proto
 * kapacitní (co adaptér UMÍ), ne vymyšlený HTTP tvar.
 *
 * Mantinel (rozhodnutí Šéfíka 2.10.2026, platí dál): appka NEBUDUJE
 * fyzický sklad/inventury. `PosProvider.nacistProdeje` dodává TRŽBY
 * a prodané položky, ne skladové pohyby — ty zůstávají doménou POS
 * systému samotného.
 */

import type { RadekPokladny } from './pokladna-csv-import.ts'

/** Dotykačka má partnerskou API licenci; appka se k ní nikdy nepřihlašuje jménem/heslem uživatele. */
export type ZpusobPripojeniPos = 'api_klic' | 'oauth' | 'import'

export type SchopnostiPosProvidera = {
  zpusobPripojeni: ZpusobPripojeniPos
  /** Appka dostane souhrn prodeje po produktu (pokladna_prodeje_denni), nebo i jednotlivé účtenky/platby? */
  urovenDat: 'denni_souhrn' | 'jednotlive_uctenky'
  webhooky: boolean
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  stránkování: boolean
  inkrementalniSync: boolean
  /** Rozpad plateb hotovost/karta — potřebné pro kontrolu vypořádání (zadání oddíl 4). */
  platebniMetody: boolean
  /** Appka nikdy nepočítá fyzickou skladovou spotřebu — ale poskytovatel ji může posílat, appka to musí umět poznat a NEzapsat jako vlastní sklad. */
  poskytujeSkladovePohyby: boolean
}

export type ProdejProvidera = {
  /** Id provozovny U POSKYTOVATELE — appka ho mapuje na branch_id přes integrace_pripojeni, ne naopak (zadání oddíl 5). */
  externiProvozovna: string
  radky: RadekPokladny[]
}

export type VysledekProdeju = { stav: 'ok'; prodeje: ProdejProvidera[] } | { stav: 'chyba'; duvod: string }
export type VysledekOvereniPos = { stav: 'ok'; provozovny: { externiId: string; nazev: string }[] } | { stav: 'chyba'; duvod: string }

export type PosProvider = {
  klic: string
  nazev: string
  schopnosti: SchopnostiPosProvidera

  /** Ověří přístup a vrátí seznam provozoven U POSKYTOVATELE — appka je nabídne k přiřazení na vlastní pobočky, nehádá shodu sama. */
  overitPripojeni(pristup: string): Promise<VysledekOvereniPos>
  nacistProdeje(pristup: string, externiProvozovna: string, od: string, doData: string): Promise<VysledekProdeju>
  zkontrolovatPripojeni?(pristup: string): Promise<boolean>
  odvolatPristup?(pristup: string): Promise<void>
}
