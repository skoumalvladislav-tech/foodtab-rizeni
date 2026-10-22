/**
 * Typy modulu Faktury — přeneseno ze samostatné appky faktury-app
 * (skoumalvladislav-tech/faktury-app, src/lib/types.ts).
 *
 * Od sloučení (docs/faktury-slouceni-navrh.md) žijí faktury v hlavní
 * databázi, tabulka `public.faktury` s českými sloupci. Tenhle typ
 * zůstává se starými jmény polí, aby se obrazovky nemusely přepisovat:
 * dotazy je dostávají jako aliasy (lib/faktury-sloupce.ts, SLOUPCE_FAKTURY).
 */
export type Faktura = {
  id: string
  received_at: string
  email_sender: string | null
  email_subject: string | null
  supplier: string
  supplier_ico: string | null
  invoice_number: string | null
  variable_symbol: string | null
  /** Celá částka v nejmenší jednotce měny (u CZK haléře) — tohle se počítá. */
  castka_haleru: number
  /** castka_haleru / 100 — jen pro zobrazení (naFakturu v lib/faktury-sloupce.ts). */
  amount: number
  currency: string
  issue_date: string | null
  duzp: string | null
  due_date: string | null
  supplier_account: string | null
  status: string
  needs_review: boolean
  onedrive_url: string | null
  pdf_url: string | null
  /** Soubor v soukromém kbelíku faktury-prilohy (kopie nebo ruční nahrání). */
  priloha_cesta: string | null
  is_archived: boolean
  is_duplicate: boolean
  review_note: string | null
  reminder_sent_at: string | null
  created_at: string
  updated_at: string
}

export const STAV_UHRAZENO = 'Uhrazeno'
export const STAV_NEUHRAZENO = 'Neuhrazeno'
export const STAV_CASTECNE = 'Částečně uhrazeno'
export const STAV_KE_KONTROLE = 'Ke kontrole úhrady'
export const STAV_KE_SCHVALENI = 'Ke schválení'

/**
 * Stavy a měny, které smí mít RUČNĚ zadaná faktura (Faktury → Nová).
 * Akce je ověřuje na serveru — formulář jde poslat i podvržený.
 */
export const STAVY_RUCNIHO_ZADANI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno', 'Uhrazeno']
export const MENY_RUCNIHO_ZADANI: readonly string[] = ['CZK', 'EUR', 'USD']
export const STAV_ODMITNUTO = 'Odmítnuto'

/**
 * Faktura se počítá jako nezaplacená pro účely kalendáře/upomínek.
 * Faktury čekající na schválení se do žádných součtů nepočítají, dokud
 * je člověk nepotvrdí. Odmítnuté (AI vyhodnotila, že nejde o fakturu)
 * taky ne.
 */
export function jeNezaplacena(faktura: Pick<Faktura, 'status'>): boolean {
  return (
    faktura.status !== STAV_UHRAZENO &&
    faktura.status !== STAV_KE_SCHVALENI &&
    faktura.status !== STAV_ODMITNUTO
  )
}

/**
 * „Nutná ruční kontrola (…)" je PŘEDPONA stavu, kterou píše n8n i nový
 * příjem z e-mailu. Sloupec `needs_review` měl být podle schema.sql
 * počítaný ze stavu, ale v živé databázi je to obyčejný sloupec a n8n ho
 * nikdy nenastavil (7.10.2026: false u všech řádků, i u stovek „Nutná
 * ruční kontrola"). Kontrola proto platí podle obou — co by se dívalo jen
 * na `needs_review`, ukazovalo by vždycky nulu.
 */
export const PREDPONA_RUCNI_KONTROLY = 'Nutná ruční kontrola'

/** Totéž jako `potrebujeKontrolu`, pro `.or(...)` v dotazu na `public.faktury` (česká jména sloupců). */
export const FILTR_KE_KONTROLE = `ke_kontrole.is.true,stav.like."${PREDPONA_RUCNI_KONTROLY}%"`

export function potrebujeKontrolu(faktura: Pick<Faktura, 'needs_review' | 'status'>): boolean {
  return faktura.needs_review === true || (faktura.status ?? '').startsWith(PREDPONA_RUCNI_KONTROLY)
}

export function dniPoSplatnosti(splatnost: string | null): number {
  if (!splatnost) return 0
  const d = new Date(splatnost + 'T00:00:00')
  const dnes = new Date()
  dnes.setHours(0, 0, 0, 0)
  const rozdil = Math.floor((dnes.getTime() - d.getTime()) / 86400000)
  return rozdil > 0 ? rozdil : 0
}
