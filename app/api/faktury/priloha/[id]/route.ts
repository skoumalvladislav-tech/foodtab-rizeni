import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { podepsatPrilohu } from '@/lib/faktury-priloha-odkaz'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'

export const dynamic = 'force-dynamic'

/**
 * Otevře přílohu faktury přijaté z e-mailu (`faktury.odkaz_pdf`, dřív
 * `invoices.pdf_url` ve staré databázi, míří sem:
 * `/api/faktury/priloha/<id řádku faktury_prijem>`). Adresa zůstává
 * i po sloučení — vedou na ni odkazy z CSV, které už dostala účetní.
 * Soubor podle id FAKTURY: /api/faktury/soubor/<id>.
 *
 * Kbelík `faktury-prilohy` je soukromý — na rozdíl od starého veřejného
 * `faktury-pdf` (otázka 46). Odkaz ve Fakturách proto není adresa souboru,
 * ale tahle cesta: ověří přihlášení a právo `faktury.read` za celou firmu,
 * přečte řádek evidence UŽIVATELSKÝM klientem (RLS) a přesměruje na
 * podepsaný odkaz platný 2 minuty — přeposlaný odkaz z Faktur bez
 * přihlášení nic neotevře.
 */

const PLATNOST_ODKAZU_S = 120
const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function odpoved(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!VZOR_ID.test(id)) return odpoved('Příloha neexistuje.', 404)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return odpoved('Účet zatím nepatří k žádné firmě.', 400)

  const pristup = await zkusPristup(tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return odpoved('Na tohle nemáte oprávnění.', 403)

  const supabase = await getServerSupabase()
  const { data: radek } = await supabase
    .from('faktury_prijem')
    .select('tenant_id, soubor_cesta')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!radek?.soubor_cesta) return odpoved('Příloha neexistuje.', 404)

  // PDF a obrázek se otevře, cokoli jiného (ISDOC/XML…) stáhne — lib/faktury-priloha-odkaz.ts.
  const odkaz = await podepsatPrilohu(supabase.storage.from('faktury-prilohy'), radek.soubor_cesta, PLATNOST_ODKAZU_S)
  if (!odkaz) return odpoved('Soubor přílohy se nepodařilo otevřít.', 404)

  const presmerovani = NextResponse.redirect(odkaz, 302)
  presmerovani.headers.set('cache-control', 'no-store')
  presmerovani.headers.set('referrer-policy', 'no-referrer')
  return presmerovani
}
