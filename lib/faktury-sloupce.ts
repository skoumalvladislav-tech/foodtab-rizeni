/**
 * Faktury v hlavní databázi → tvar, se kterým pracují obrazovky.
 *
 * Tabulka `public.faktury` má česká jména a částku v haléřích. Obrazovky
 * Faktur (přenesené z faktury-app) pracují s typem `Faktura`
 * (lib/faktury-types.ts) se starými jmény polí. Místo přepisu stovek
 * míst v JSX se staré jméno dává jako ALIAS přímo v dotazu
 * (`supplier:dodavatel`) — filtry a řazení ale píšou česká jména
 * sloupců, protože PostgREST filtruje podle skutečného sloupce.
 *
 * Částka: v databázi `castka_haleru` (celé haléře, pravidlo „peníze
 * v haléřích"); obrazovky dostanou navíc `amount` v korunách jen pro
 * zobrazení. Součty, které jdou dál (párování, export), počítají
 * z `castka_haleru`.
 *
 * Bez `server-only` — testuje scripts/faktury-sloupce.test.mjs.
 */

import type { Faktura } from './faktury-types.ts'

/** Sloupce pro seznamy (bez úryvku textu dokladu — ten je jen u odmítnutí). */
export const SLOUPCE_FAKTURY = [
  'id',
  'received_at:prijato_kdy',
  'email_sender:email_odesilatel',
  'email_subject:email_predmet',
  'supplier:dodavatel',
  'supplier_ico:dodavatel_ico',
  'invoice_number:cislo_faktury',
  'variable_symbol:variabilni_symbol',
  'castka_haleru',
  'currency:mena',
  'issue_date:datum_vystaveni',
  'duzp',
  'due_date:splatnost',
  'supplier_account:ucet_dodavatele',
  'status:stav',
  'needs_review:ke_kontrole',
  'onedrive_url:odkaz_onedrive',
  'pdf_url:odkaz_pdf',
  'priloha_cesta',
  'reminder_sent_at:upominka_odeslana_kdy',
  'created_at:vytvoreno_kdy',
  'updated_at:zmeneno_kdy',
  'is_duplicate:duplicita',
  'is_archived:archivovano',
  'review_note:poznamka_kontroly',
].join(', ')

/** Řádek, jak ho vrátí `select(SLOUPCE_FAKTURY)`. */
export type RadekFaktury = Omit<Faktura, 'amount'>

/** Doplní `amount` (Kč, jen pro zobrazení) z `castka_haleru`. */
export function naFakturu(r: RadekFaktury): Faktura {
  const halere = typeof r.castka_haleru === 'number' && Number.isFinite(r.castka_haleru) ? r.castka_haleru : 0
  return { ...r, castka_haleru: halere, amount: halere / 100 }
}

export function naFaktury(radky: readonly RadekFaktury[] | null | undefined): Faktura[] {
  return (radky ?? []).map(naFakturu)
}

/**
 * Odkaz na PDF/fotku faktury pro obrazovku a export:
 *   1. vlastní kopie v soukromém kbelíku → přes appku (ověří právo),
 *   2. jinak původní odkaz (příjem z e-mailu vede na /api/faktury/priloha,
 *      staré n8n PDF na veřejný soubor ve staré databázi).
 * `zaklad` = adresa appky pro absolutní odkaz (CSV pro účetní), jinak relativní.
 */
export function odkazNaPrilohu(f: Pick<Faktura, 'id' | 'priloha_cesta' | 'pdf_url'>, zaklad: string | null = null): string | null {
  if (f.priloha_cesta) return `${zaklad ?? ''}/api/faktury/soubor/${f.id}`
  if (!f.pdf_url) return null
  // Příjem z e-mailu zapisuje relativní odkaz, když appka nezná svou adresu
  // (NEXT_PUBLIC_APP_URL) — v CSV by bez základu nikam nevedl.
  return f.pdf_url.startsWith('/') ? `${zaklad ?? ''}${f.pdf_url}` : f.pdf_url
}

/** Celé haléře z textu formuláře („1 234,50" i „1234.5"). Null = neplatné nebo nepřesné. */
export function halereZFormulare(text: string): number | null {
  const t = text.replace(/\s+/g, '').replace(',', '.')
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  const halere = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(halere) || halere > 2147483647) return null
  return m[1] === '-' ? -halere : halere
}
