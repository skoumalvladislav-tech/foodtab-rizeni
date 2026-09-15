import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { type Faktura } from '@/lib/faktury-types'
import { pouzitFiltry, type FakturyFiltry } from '@/lib/faktury-filtry'

export const dynamic = 'force-dynamic'

/**
 * CSV export faktur (pro účetního) — přeneseno z faktury-app
 * (src/app/api/export/route.ts). Stejné filtry jako Seznam
 * (`lib/faktury-filtry.ts`, sdílené), aby export vrátil přesně to, co
 * uživatel zrovna vidí na obrazovce.
 *
 * Rozsah (firma) chodí jako `?rozsah=` — tahle cesta stojí mimo
 * `app/[rozsah]/...`, protože API route bez uživatelského rozhraní
 * podobnou strukturu nepotřebuje.
 */

function csvBunka(hodnota: string | number | null | undefined): string {
  const s = hodnota === null || hodnota === undefined ? '' : String(hodnota)
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const SLOUPCE: { hlavicka: string; z: (f: Faktura) => string | number | null }[] = [
  { hlavicka: 'Dodavatel', z: (f) => f.supplier },
  { hlavicka: 'IČO dodavatele', z: (f) => f.supplier_ico },
  { hlavicka: 'Číslo faktury', z: (f) => f.invoice_number },
  { hlavicka: 'Variabilní symbol', z: (f) => f.variable_symbol },
  { hlavicka: 'Částka', z: (f) => f.amount },
  { hlavicka: 'Měna', z: (f) => f.currency },
  { hlavicka: 'Datum vystavení', z: (f) => f.issue_date },
  { hlavicka: 'DUZP', z: (f) => f.duzp },
  { hlavicka: 'Splatnost', z: (f) => f.due_date },
  { hlavicka: 'Číslo účtu dodavatele', z: (f) => f.supplier_account },
  { hlavicka: 'Stav úhrady', z: (f) => f.status },
  { hlavicka: 'Nutná ruční kontrola', z: (f) => (f.needs_review ? 'ano' : 'ne') },
  { hlavicka: 'Možná duplicita', z: (f) => (f.is_duplicate ? 'ano' : 'ne') },
  { hlavicka: 'Datum přijetí', z: (f) => f.received_at },
  { hlavicka: 'E-mail odesílatel', z: (f) => f.email_sender },
  { hlavicka: 'Předmět e-mailu', z: (f) => f.email_subject },
  { hlavicka: 'Odkaz PDF', z: (f) => f.pdf_url },
  { hlavicka: 'Odkaz OneDrive', z: (f) => f.onedrive_url },
  { hlavicka: 'Archivováno', z: (f) => (f.is_archived ? 'ano' : 'ne') },
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rozsah = searchParams.get('rozsah') ?? ''

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return new Response('Účet zatím nepatří k žádné firmě.', { status: 400 })

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return new Response('Na tohle nemáte oprávnění.', { status: 403 })

  const filtry: FakturyFiltry = {
    archiv: searchParams.get('archiv') === '1',
    stav: searchParams.get('stav') ?? undefined,
    kontrola: searchParams.get('kontrola') === '1',
    mesic: searchParams.get('mesic') ?? undefined,
    dodavatel: searchParams.get('dodavatel') ?? undefined,
    hledat: (searchParams.get('hledat') ?? '').trim(),
    duplicity: searchParams.get('duplicity') === '1',
  }

  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    let dotaz = supabase.from('invoices').select('*')
      .order('duzp', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    dotaz = pouzitFiltry(dotaz, filtry)
    const { data, error } = await dotaz.range(od, od + velikostStranky - 1)
    if (error) return new Response('Nepodařilo se načíst faktury.', { status: 500 })
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }

  const radky = [
    SLOUPCE.map((s) => csvBunka(s.hlavicka)).join(';'),
    ...vse.map((f) => SLOUPCE.map((s) => csvBunka(s.z(f))).join(';')),
  ]
  // BOM na začátku, aby Excel správně rozpoznal UTF-8 a diakritiku.
  const csv = '﻿' + radky.join('\r\n') + '\r\n'

  const datum = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="faktury-${datum}.csv"`,
    },
  })
}
