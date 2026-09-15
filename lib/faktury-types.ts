/**
 * Typy modulu Faktury — přeneseno ze samostatné appky faktury-app
 * (skoumalvladislav-tech/faktury-app, src/lib/types.ts), beze změny
 * tvaru řádku: data zůstávají v odděleném Supabase projektu
 * (`ctqtwahlzhyjerqulqyn`), tenhle typ jen popisuje, co odtamtud chodí.
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

export function dniPoSplatnosti(splatnost: string | null): number {
  if (!splatnost) return 0
  const d = new Date(splatnost + 'T00:00:00')
  const dnes = new Date()
  dnes.setHours(0, 0, 0, 0)
  const rozdil = Math.floor((dnes.getTime() - d.getTime()) / 86400000)
  return rozdil > 0 ? rozdil : 0
}
