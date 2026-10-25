import { NextResponse } from 'next/server'

import { getUser, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { KBELIK_REZERVACI } from '@/lib/rezervace-prilohy'
import { getServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Dokument k rezervaci nebo ke dni: `/api/rezervace/soubor/<id řádku
 * rezervace_prilohy>`. Stejný postup jako originály Jiných plateb
 * (app/api/jine-platby/soubor/[id]/route.ts):
 *   1. přihlášení a firma z členství;
 *   2. řádek přílohy UŽIVATELSKÝM klientem (RLS `rezervace_prilohy_cist`)
 *      a `.eq('tenant_id')`;
 *   3. právo v aplikaci — vidí člověk rezervace pobočky souboru (první
 *      linie, stejná otázka jako RLS);
 *   4. podepsaný odkaz platný 120 s a přesměrování.
 *
 * Cokoli, co neprojde, je 404 BEZ DETAILU — z odpovědi se nesmí dát
 * poznat, jestli soubor existuje u jiné firmy nebo pobočky. `no-store`
 * a `no-referrer`, ať podepsaná adresa nezůstane v mezipaměti ani
 * neodejde dál v hlavičce Referer.
 */

const PLATNOST_ODKAZU_S = 120
const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function nenalezeno(): Response {
  return new Response('Soubor neexistuje.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!VZOR_ID.test(id)) return nenalezeno()

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return nenalezeno()
  if (!(await getUser())) return nenalezeno()

  const supabase = await getServerSupabase()
  const { data: radek, error } = await supabase
    .from('rezervace_prilohy')
    .select('cesta, branch_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !radek?.cesta || !radek.branch_id) return nenalezeno()

  const pobocka = String(radek.branch_id)
  const [cte, pise] = await Promise.all([
    hasAccess(tenantId, 'rezervace.read', pobocka),
    hasAccess(tenantId, 'rezervace.manage', pobocka),
  ])
  if (!cte && !pise) return nenalezeno()

  const { data: podepsano } = await supabase.storage.from(KBELIK_REZERVACI).createSignedUrl(String(radek.cesta), PLATNOST_ODKAZU_S)
  if (!podepsano?.signedUrl) return nenalezeno()

  const presmerovani = NextResponse.redirect(podepsano.signedUrl, 302)
  presmerovani.headers.set('cache-control', 'no-store')
  presmerovani.headers.set('referrer-policy', 'no-referrer')
  return presmerovani
}
