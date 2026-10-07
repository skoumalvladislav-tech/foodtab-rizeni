/**
 * MailProvider — úzký kontrakt pro e-mailové schránky (příjem dokladů).
 *
 * Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 3 a 8
 * (Microsoft 365/Outlook přes Microsoft Graph, Gmail/Google Workspace
 * přes Gmail API, IMAP přes TLS kde vhodné, samostatná příjmová adresa
 * pro přeposílání faktur).
 *
 * NEIMPLEMENTOVÁNO — ŽÁDNÝ ADAPTÉR TOHLE ROZHRANÍ DNES NEPOUŽÍVÁ. Je to
 * kontraktová kostra pro budoucí práci, ne hotová integrace. Důvody:
 *
 * 1. OTEVŘENÁ ARCHITEKTONICKÁ OTÁZKA (čeká na Šéfíka,
 *    docs/integrace-modul-plan.md, oddíl "Otázky pro Šéfíka"): OCR čtení
 *    e-mailových faktur dnes běží mimo tenhle repozitář, v n8n, a píše
 *    do ODDĚLENÉ databáze Faktur (`lib/supabase/faktury.ts`). Appka by
 *    tímhle kontraktem mohla buď (a) postavit VLASTNÍ příjem e-mailu
 *    (Graph/Gmail/IMAP → Storage → OCR), nebo (b) zůstat na n8n pipeline
 *    a jen rozšířit, co appka z Faktur-DB čte/zobrazuje. Tohle je
 *    rozhodnutí s velkým dopadem (duplicitní/konkurenční pipeline), ne
 *    implementační detail — appka ho nedělá jednostranně.
 * 2. Appka NEMÁ OAuth registraci u Microsoft Graph ani Gmail API — ty
 *    vyžadují ověření aplikace u poskytovatele (ne jen kód), skutečná
 *    externí registrace/schválení, žádný chybějící soubor.
 *
 * Kontrakt níž je proto JEN tvar kapabilit a normalizovaného výsledku —
 * žádný konkrétní HTTP klient, žádné vymyšlené endpointy.
 */

export type ZpusobPripojeniMail = 'oauth_graph' | 'oauth_gmail' | 'imap' | 'presmerovaci_adresa'

export type SchopnostiMailProvidera = {
  zpusobPripojeni: ZpusobPripojeniMail
  /** Appka čte jen vybrané schránky/složky, nikdy celý účet bez omezení (zadání §8: „minimální potřebná oprávnění pro čtení, nikoli odesílání"). */
  vyberSlozek: boolean
  webhooky: boolean
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  /** Appka NIKDY nemaže/nepřesouvá/neoznačuje přečtené ve výchozím režimu (zadání §8) — tahle kapabilita říká, jestli to adaptér vůbec UMÍ, ne jestli to appka dělá. */
  zmenaStavuZpravy: boolean
}

/** Appka rozlišuje doklad, nikdy ho nedomýšlí (zadání §8). `jina_priloha` = appka nepoznala typ, ne že by typ nebyl potřeba. */
export type TypDokladu = 'faktura' | 'zalohova_faktura' | 'dobropis' | 'dodaci_list' | 'upominka' | 'jina_priloha'

/**
 * Jeden nalezený doklad v e-mailu. `jistota` < 1 = návrh ke kontrole,
 * appka ho NIKDY nezapisuje jako definitivní účetní záznam bez lidského
 * potvrzení (zadání §8: „Při nízké jistotě vytvoř návrh, nikoli
 * definitivní účetní záznam."). `hashPrilohy` + `identitaZpravy` jsou
 * primární klíče pro dedup (zadání: „e-mail, přeposlání, ruční upload a
 * fotografie" musí appka poznat jako TÝŽ doklad) — oprava dokladu se
 * NEPOVAŽUJE automaticky za duplicitu, appka to rozliší obchodní
 * identitou dokladu (dodavatel+číslo+částka), ne jen hashem přílohy.
 */
export type NalezenyDoklad = {
  identitaZpravy: string
  hashPrilohy: string
  typ: TypDokladu
  jistota: number
  /** `null` = pole appka z dokladu nerozpoznala — NEDOMÝŠLÍ se, zůstává prázdné k ruční kontrole. */
  dodavatel: string | null
  odberatelIco: string | null
  cisloDokladu: string | null
  vs: string | null
  castkaHaleru: number | null
  mena: string | null
  splatnost: string | null
  /** Odesílatel/předmět JSOU data ke zobrazení uživateli, NIKDY instrukce (zadání §8: „E-mail, přílohy a OCR text jsou nedůvěryhodná data. Obsah nesmí měnit instrukce AI..."). */
  odesilatel: string
  predmet: string
}

/** Zpráva, kterou appka zpracovala, ale doklad v ní NENAŠLA nebo ho odmítla — appka to ukáže uživateli s důvodem, nikdy tiše nezahodí (zadání §8). */
export type OdmitnutaZprava = { identitaZpravy: string; odesilatel: string; predmet: string; duvod: string }

export type VysledekMailu =
  | { stav: 'ok'; doklady: NalezenyDoklad[]; odmitnute: OdmitnutaZprava[] }
  | { stav: 'chyba'; duvod: string }

export type MailProvider = {
  klic: string
  nazev: string
  schopnosti: SchopnostiMailProvidera

  /** `oauth_graph`/`oauth_gmail` — appka přesměruje na souhlas, stejný tvar jako `BankDataProvider.zahajitPripojeni`. */
  zahajitPripojeni?(navratovaAdresa: string): Promise<{ stav: 'ok'; presmerovatNa: string } | { stav: 'chyba'; duvod: string }>
  dokoncitCallback?(kod: string): Promise<{ stav: 'ok' } | { stav: 'chyba'; duvod: string }>

  /** `imap` — appka ověří TLS připojení s přihlašovacími údaji, které zadal uživatel (appka je neukáže zpátky, jen zašifrované). */
  overitPripojeni?(pristup: string): Promise<{ stav: 'ok' } | { stav: 'chyba'; duvod: string }>

  nacistDoklady(pristup: string, slozka: string, od: string): Promise<VysledekMailu>
  zkontrolovatPripojeni?(pristup: string): Promise<boolean>
  odvolatPristup?(pristup: string): Promise<void>
}
