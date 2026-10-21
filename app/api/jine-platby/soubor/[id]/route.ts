import { NextResponse } from 'next/server'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { vidiPobocku } from '@/lib/jine-platby-pristup'
import { KBELIK_JINYCH_PLATEB } from '@/lib/jine-platby-typy'
import { getServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Originál dokladu Jiných plateb: `/api/jine-platby/soubor/<id řádku
 * jine_platby_soubory>`.
 *
 * Kbelík `jine-platby` je soukromý. Odkaz na kartě záznamu proto není
 * adresa souboru, ale tahle cesta:
 *   1. přihlášení a firma z členství (`getCurrentTenantId`);
 *   2. řádek souboru UŽIVATELSKÝM klientem (RLS `app.jine_platby_vidi`)
 *      a `.eq('tenant_id')`;
 *   3. právo v aplikaci — vidí člověk záznamy pobočky souboru
 *      (`vidiPobocku`, stejná otázka jako RLS, první linie);
 *   4. podepsaný odkaz platný 120 s a přesměrování.
 *
 * Přeposlaný odkaz bez přihlášení nic neotevře a podepsaný odkaz za dvě
 * minuty vyprší. Cokoli, co neprojde, je 404 BEZ DETAILU — z odpovědi
 * se nesmí dát poznat, jestli soubor existuje u jiné firmy nebo pobočky.
 * `no-store` (odkaz se nesmí uložit v mezipaměti) a `no-referrer`
 * (podepsaná adresa nesmí odejít v hlavičce Referer dál).
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
    .from('jine_platby_soubory')
    .select('cesta, branch_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !radek?.cesta || !radek.branch_id) return nenalezeno()
  if (!(await vidiPobocku(tenantId, String(radek.branch_id)))) return nenalezeno()

  const { data: podepsano } = await supabase.storage.from(KBELIK_JINYCH_PLATEB).createSignedUrl(String(radek.cesta), PLATNOST_ODKAZU_S)
  if (!podepsano?.signedUrl) return nenalezeno()

  const presmerovani = NextResponse.redirect(podepsano.signedUrl, 302)
  presmerovani.headers.set('cache-control', 'no-store')
  presmerovani.headers.set('referrer-policy', 'no-referrer')
  return presmerovani
}
