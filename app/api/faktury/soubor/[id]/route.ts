import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import { podepsatPrilohu } from '@/lib/faktury-priloha-odkaz'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'

export const dynamic = 'force-dynamic'

/**
 * Otevře soubor faktury ze SOUKROMÉHO kbelíku faktury-prilohy
 * (`faktury.priloha_cesta`: kopie PDF ze starého veřejného úložiště, nebo
 * ruční nahrání). Id je id FAKTURY — na rozdíl od /api/faktury/priloha/<id>,
 * kde je to id záznamu evidence příjmu z e-mailu (ta adresa zůstává, vedou
 * na ni odkazy už poslané účetní).
 *
 * Stejný vzor jako /api/faktury/priloha: přihlášení, `faktury.read` za
 * celou firmu, Faktury otevřené, řádek faktury UŽIVATELSKÝM klientem (RLS)
 * a s firmou ze serveru, pak podepsaný odkaz na 2 minuty — přeposlaný
 * odkaz bez přihlášení nic neotevře.
 */

const PLATNOST_ODKAZU_S = 120
const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function odpoved(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!VZOR_ID.test(id)) return odpoved('Soubor neexistuje.', 404)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return odpoved('Účet zatím nepatří k žádné firmě.', 400)

  const pristup = await zkusPristup(tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return odpoved('Na tohle nemáte oprávnění.', 403)

  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') return odpoved('Faktury pro tuto firmu nejsou otevřené.', 404)

  const { data } = await fakturyFirmy(pristupFaktury, 'priloha_cesta').eq('id', id).maybeSingle()
  const cesta = (data as unknown as { priloha_cesta: string | null } | null)?.priloha_cesta
  if (!cesta) return odpoved('Soubor neexistuje.', 404)

  // PDF a obrázek se otevře, cokoli jiného (XML…) stáhne — lib/faktury-priloha-odkaz.ts.
  const odkaz = await podepsatPrilohu(pristupFaktury.supabase.storage.from('faktury-prilohy'), cesta, PLATNOST_ODKAZU_S)
  if (!odkaz) return odpoved('Soubor se nepodařilo otevřít.', 404)

  const presmerovani = NextResponse.redirect(odkaz, 302)
  presmerovani.headers.set('cache-control', 'no-store')
  presmerovani.headers.set('referrer-policy', 'no-referrer')
  return presmerovani
}
