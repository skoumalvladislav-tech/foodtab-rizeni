/**
 * ReservationProvider — úzký kontrakt pro rezervační/objednávkové
 * adaptéry.
 *
 * Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 3 a 6
 * ("Choice / Choice QR" jako první kandidát, "V první verzi preferuj
 * čtení. Zápis do zdroje přidávej jen na základě konkrétního požadavku
 * a podporovaného API.").
 *
 * NA ROZDÍL OD `bank-provider-contract.ts`/`pos-provider-contract.ts`
 * TADY NEEXISTUJE ŽÁDNÝ STÁVAJÍCÍ CÍLOVÝ TVAR (appka dnes nemá žádnou
 * tabulku rezervací hostů) — `RadekRezervace` níž je proto NOVÝ
 * normalizovaný tvar, ne zrcadlo existujícího importu.
 *
 * ŽÁDNÝ KONKRÉTNÍ ENDPOINT/AUTH TVAR TADY NENÍ. Choice/Choice QR nemá
 * veřejně dostupnou API dokumentaci (ověřeno 7.10.2026 — stránka
 * choiceqr.com vrátila 403 na pokus o přečtení, žádný veřejný odkaz
 * "pro vývojáře"/partnerský program nebyl dohledatelný bez přihlášení).
 * Appka nesmí sama navazovat obchodní kontakt (zadání §1), takže
 * konkrétní HTTP klient pro Choice se NEPÍŠE, dokud nebudou reálné
 * dokumenty/přístup k dispozici — kontrakt níž je obecný model
 * rezervace (vznik/změna/zrušení/stav/počet hostů/provozovna), platný
 * pro libovolný rezervační systém, ne vymyšlený podle Choice.
 */

export type ZpusobPripojeniRezervace = 'api_klic' | 'oauth' | 'webhook'

export type StavRezervace = 'ceka' | 'potvrzeno' | 'zrusena' | 'nedostavil_se' | 'dokonceno'

export type SchopnostiRezervacniProvidera = {
  zpusobPripojeni: ZpusobPripojeniRezervace
  webhooky: boolean
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  inkrementalniSync: boolean
  /** Appka v první verzi jen čte (zadání §6) — zápis se zapíná jedině na konkrétní, podporovaný požadavek. */
  zapisRezervace: boolean
  objednavky: boolean
}

/**
 * Jeden normalizovaný řádek rezervace. `jmenoHosta`/`telefonHosta`/
 * `emailHosta` jsou KONTAKTNÍ údaje k rezervaci, NIKDY marketingový
 * souhlas (zadání §6: „Kontakt z rezervace nepovažuj za marketingový
 * souhlas. Marketingové oprávnění eviduj samostatně včetně původu.") —
 * cílová CRM vrstva je musí uložit s odkazem na ZDROJ (tahle rezervace),
 * ne jako obecný marketingový kontakt.
 */
export type RadekRezervace = {
  externiId: string
  stav: StavRezervace
  /** `null` = poskytovatel údaj neposkytuje — appka ho NEDOMÝŠLÍ jako 0 ani jako odhad. */
  pocetHostu: number | null
  /** ISO timestamp rezervovaného termínu, v pásmu, které appka dostala od poskytovatele — appka si pásmo nevymýšlí (CLAUDE.md, pravidlo 11). */
  cas: string
  /** Id provozovny U POSKYTOVATELE — appka ho mapuje na branch_id přes integrace_pripojeni, nehádá shodu sama. */
  externiProvozovna: string
  jmenoHosta: string | null
  telefonHosta: string | null
  emailHosta: string | null
  poznamka: string
  /** Čas poslední změny U POSKYTOVATELE — appka ho nezaměňuje za čas, kdy ona sama data stáhla. */
  zmenenoKdy: string
}

export type VysledekRezervaci = { stav: 'ok'; radky: RadekRezervace[] } | { stav: 'chyba'; duvod: string }
export type VysledekOvereniRezervace = { stav: 'ok'; provozovny: { externiId: string; nazev: string }[] } | { stav: 'chyba'; duvod: string }

export type ReservationProvider = {
  klic: string
  nazev: string
  schopnosti: SchopnostiRezervacniProvidera

  overitPripojeni(pristup: string): Promise<VysledekOvereniRezervace>
  nacistRezervace(pristup: string, externiProvozovna: string, od: string, doData: string): Promise<VysledekRezervaci>
  zkontrolovatPripojeni?(pristup: string): Promise<boolean>
  odvolatPristup?(pristup: string): Promise<void>

  /**
   * Zápis do zdroje (vytvoření/změna rezervace appkou) — NEIMPLEMENTOVAT
   * bez konkrétního, schváleného požadavku a potvrzené podpory API
   * (zadání §6). Typ tu stojí jako místo pro budoucí rozšíření, ne jako
   * návod, co se má postavit jako další.
   */
  zapsatRezervaci?(pristup: string, radek: Omit<RadekRezervace, 'externiId' | 'zmenenoKdy'>): Promise<{ stav: 'ok'; externiId: string } | { stav: 'chyba'; duvod: string }>
}
