/**
 * Příjem faktur z e-mailu — sdílené typy a pravidla (bez IO, bez
 * `server-only`, ať se dají testovat v CI).
 *
 * Rozhodnutí Šéfíka 7.10.2026 (otázka 42 v docs/hlaseni/otazky.md):
 * appka čte připojené schránky SAMA a postupně nahradí n8n; faktury
 * zapisuje do STÁVAJÍCÍ databáze Faktur (`invoices`), stejně jako n8n.
 * n8n tam naposledy zapsal 5.9.2026 (pád na nedostatek paměti).
 *
 * Tok jedné přílohy:
 *   schránka → [fáze 1: najít přílohy, otisk, duplicity, uložit soubor]
 *            → faktury_prijem.stav 'ceka'
 *            → [fáze 2: ISDOC bez AI, PDF/fotka přes AI jen se souhlasem]
 *            → 'navrh' (režim náhled) / zápis do invoices (automaticky)
 *
 * Nic se nezahazuje potichu: každá kandidátní příloha má řádek v
 * `faktury_prijem` se stavem a důvodem.
 */

/** Od kdy se smí faktury přijímat — starší DUZP jde ke schválení (pravidlo z faktury-app). */
export const NEJSTARSI_DUZP = '2026-01-01'

/** Výchozí začátek čtení schránky — Šéfík 7.10.2026: „od 1.1.2026". */
export const VYCHOZI_OD = '2026-01-01'

/** Větší přílohu appka nestahuje (paměť, AI limit) — skončí „vyžaduje kontrolu". */
export const MAX_VELIKOST_PRILOHY = 10 * 1024 * 1024

/** Kolikrát se zkusí přechodná chyba, než řádek přejde na ruční kontrolu. */
export const MAX_POKUSU = 3

/** Strop AI čtení na firmu a den — pojistka proti nečekané útratě (zadání: kvóty AI na firmu). */
export const AI_LIMIT_ZA_DEN = 300

export type StavPrijmu =
  | 'ceka' // uloženo, čeká na vytěžení
  | 'navrh' // vytěženo, čeká na člověka (režim náhled)
  | 'zapsano' // zapsáno do Faktur
  | 'existuje' // už ve Fakturách (n8n nebo stejný doklad) — nezapisuje se znovu
  | 'duplicita' // stejná příloha už prošla touhle cestou
  | 'neni_doklad' // podle obsahu nejde o fakturu/upomínku
  | 'vyzaduje_kontrolu' // appka to sama nepřečte — člověk
  | 'chyba' // přechodná chyba, zkusí se znovu

export const STAVY_PRIJMU: readonly StavPrijmu[] = [
  'ceka', 'navrh', 'zapsano', 'existuje', 'duplicita', 'neni_doklad', 'vyzaduje_kontrolu', 'chyba',
]

export type DruhPrilohy = 'pdf' | 'obrazek' | 'isdoc' | 'nepodporovano'

export type TypDokladu =
  | 'faktura'
  | 'zalohova_faktura'
  | 'dobropis'
  | 'dodaci_list'
  | 'upominka'
  | 'jiny_doklad'
  | 'neni_doklad'

/** Uzel `bodyStructure` z imapflow — jen pole, která čteme. */
export type UzelStruktury = {
  part?: string
  type: string
  parameters?: Record<string, string>
  disposition?: string
  dispositionParameters?: Record<string, string>
  size?: number
  childNodes?: UzelStruktury[]
}

/** Kandidátní příloha nalezená ve struktuře zprávy (před stažením). */
export type KandidatPrilohy = {
  cast: string
  nazev: string
  mime: string
  velikost: number
  druh: DruhPrilohy
  /** Neprázdné = příloha se nestahuje a rovnou jde na ruční kontrolu s tímhle důvodem. */
  duvodBezStazeni: string | null
}

/** Vytěžené údaje — jednotný tvar pro ISDOC i AI. `null` = nepřečteno, NIKDY ne 0 nebo prázdný text. */
export type VytezenyDoklad = {
  typ: TypDokladu
  jistotaTypu: 'vysoka' | 'stredni' | 'nizka'
  dodavatelNazev: string | null
  dodavatelIco: string | null
  odberatelNazev: string | null
  odberatelIco: string | null
  cisloDokladu: string | null
  variabilniSymbol: string | null
  /** Částka k úhradě včetně DPH, v jednotkách měny (koruny, ne haléře). */
  castkaCelkem: number | null
  mena: string | null
  datumVystaveni: string | null
  duzp: string | null
  datumSplatnosti: string | null
  ucetDodavatele: string | null
  vyzadujeKontrolu: boolean
  duvodyKontroly: string[]
  /** Úryvek textu dokladu (pro `document_text_excerpt` a učení z odmítnutí). */
  ukazkaTextu: string | null
}

/** Nastavení příjmu jedné schránky — `integrace_pripojeni.externi_ucet.prijem_dokladu`. */
export type NastaveniPrijmu = {
  zapnuto: boolean
  od: string
  slozky: string[]
  rezim: 'nahled' | 'automaticky'
  ai: { povoleno: boolean; kdo: string | null; kdy: string | null }
}

/**
 * Šéfík 8.10.2026: „faktury ať se zpracovávají průběžně" — výchozí je
 * automatický zápis (jako n8n), nejisté doklady jdou do stávajících front
 * „Ke schválení" / „Nutná ruční kontrola". Zapnutí příjmu a souhlas s AI
 * jsou ale vždy vědomý klik (zadání: AI zpracování schvaluje vlastník).
 */
export const VYCHOZI_NASTAVENI: NastaveniPrijmu = {
  zapnuto: false,
  od: VYCHOZI_OD,
  slozky: ['INBOX'],
  rezim: 'automaticky',
  ai: { povoleno: false, kdo: null, kdy: null },
}

/** Tolerantní čtení nastavení z JSON — cokoli neznámého spadne na bezpečný výchozí stav. */
export function nacistNastaveni(surove: unknown): NastaveniPrijmu {
  const n = (surove && typeof surove === 'object' ? surove : {}) as Record<string, unknown>
  const ai = (n.ai && typeof n.ai === 'object' ? n.ai : {}) as Record<string, unknown>
  const od = typeof n.od === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.od) ? n.od : VYCHOZI_OD
  const slozky = Array.isArray(n.slozky)
    ? n.slozky.filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 200)
    : []
  return {
    zapnuto: n.zapnuto === true,
    od,
    slozky: slozky.length > 0 ? slozky.slice(0, 10) : ['INBOX'],
    rezim: n.rezim === 'nahled' ? 'nahled' : 'automaticky',
    ai: {
      povoleno: ai.povoleno === true,
      kdo: typeof ai.kdo === 'string' ? ai.kdo : null,
      kdy: typeof ai.kdy === 'string' ? ai.kdy : null,
    },
  }
}

/** Platné „Číst od": skutečné datum, ne v budoucnu, ne před rokem 2000. */
export function platneOd(od: unknown, dnes: string): od is string {
  if (typeof od !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(od)) return false
  const d = new Date(`${od}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === od && od >= '2000-01-01' && od <= dnes
}

export type ZmenaPrijmu =
  | { akce: 'zapnout'; ai: boolean; od: string }
  | { akce: 'vypnout' }
  | { akce: 'ai'; povoleno: boolean }
  | { akce: 'rezim'; rezim: 'nahled' | 'automaticky' }
  | { akce: 'od'; od: string }

/**
 * Nové nastavení příjmu po kliknutí v Integracích. Souhlas s AI se vždy
 * zapíše s tím, kdo a kdy ho dal (zadání: AI zpracování schvaluje
 * vlastník); vypnutím AI se souhlas maže. null = neplatný vstup.
 */
export function upravitNastaveni(
  surove: unknown,
  zmena: ZmenaPrijmu,
  kontext: { kdo: string; kdy: string; dnes: string },
): NastaveniPrijmu | null {
  const n = nacistNastaveni(surove)
  const souhlas = (povoleno: boolean) => (povoleno ? { povoleno: true, kdo: kontext.kdo, kdy: kontext.kdy } : { povoleno: false, kdo: null, kdy: null })
  switch (zmena.akce) {
    case 'zapnout':
      if (!platneOd(zmena.od, kontext.dnes)) return null
      return { ...n, zapnuto: true, od: zmena.od, ai: souhlas(zmena.ai) }
    case 'vypnout':
      return { ...n, zapnuto: false }
    case 'ai':
      return { ...n, ai: souhlas(zmena.povoleno) }
    case 'rezim':
      return zmena.rezim === 'nahled' || zmena.rezim === 'automaticky' ? { ...n, rezim: zmena.rezim } : null
    case 'od':
      return platneOd(zmena.od, kontext.dnes) ? { ...n, od: zmena.od } : null
    default:
      return null
  }
}

/** Řádek pro `invoices` v databázi Faktur — tvar, jaký zapisoval n8n (bez tenant_id: sloupec tam není). */
export type RadekFaktury = {
  received_at: string
  email_sender: string | null
  email_subject: string | null
  supplier: string
  supplier_ico: string | null
  invoice_number: string | null
  variable_symbol: string | null
  amount: number
  currency: string
  issue_date: string | null
  duzp: string | null
  due_date: string | null
  supplier_account: string | null
  status: string
  needs_review: boolean
  pdf_url: string | null
  review_note: string | null
  document_text_excerpt: string | null
  is_archived: boolean
}

/** Výsledek rozhodnutí, co s vytěženým dokladem udělat. */
export type Rozhodnuti =
  | { akce: 'zapsat'; radek: RadekFaktury }
  | { akce: 'nezapisovat'; stav: Extract<StavPrijmu, 'neni_doklad' | 'vyzaduje_kontrolu'>; duvod: string }
