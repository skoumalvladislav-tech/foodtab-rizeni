import 'server-only'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Společný základ akcí úkolů a checklistů.
 *
 * Z formuláře se berou jen identifikátory a hodnoty, nikdy ne firma,
 * pobočka ani zaměstnanec — ty se dohledávají tady ze session, aby se
 * nedaly podvrhnout. Vlastní rozhodnutí o právu zůstává na databázi.
 */
export type Zaklad = {
  tenantId: string
  employeeId: string | null
  branchId: string | null
  rozsah: string
}

export async function zaklad(rozsah: string): Promise<Zaklad | null> {
  const user = await getUser()
  if (!user) return null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  const ctx = await getContext(tenantId)
  if (!ctx) return null

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return null

  const supabase = await getServerSupabase()
  const { data, error: chybaJa } = await supabase
    .from('employees')
    .select('id, branch_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1)
  if (chybaJa) throw new DotazSelhal('můj zaměstnanecký záznam', chybaJa)

  const ja = data?.[0] as { id: string; branch_id: string | null } | undefined

  return {
    tenantId,
    employeeId: ja?.id ?? null,
    branchId: scope.branchId ?? ja?.branch_id ?? null,
    rozsah,
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Kam se po akci vrátit. Adresa z formuláře je jen návrh: smí to být
 * JEN cesta uvnitř checklistů téhož rozsahu (žádná cizí doména, žádné
 * `//`), jinak se jde na výchozí. Otevřené přesměrování z formuláře by
 * šlo zneužít v odkazu poslaném kolegovi.
 */
export function bezpecnyNavrat(
  zpet: FormDataEntryValue | null,
  rozsah: string,
  vychozi: string,
  pridat?: Record<string, string>,
): string {
  const kandidat = typeof zpet === 'string' ? zpet : ''
  const predpona = `/${rozsah}/ukoly/`
  const cesta =
    kandidat.startsWith(predpona) && !kandidat.includes('//') && !kandidat.includes('\\')
      ? kandidat
      : vychozi
  if (!pridat) return cesta
  const url = new URL(cesta, 'http://x')
  // Staré hlášky pryč, ať se po úspěchu neukazuje předchozí chyba.
  url.searchParams.delete('chyba')
  url.searchParams.delete('polozka')
  url.searchParams.delete('ulozeno')
  for (const [k, v] of Object.entries(pridat)) url.searchParams.set(k, v)
  return `${url.pathname}${url.search}${url.hash}`
}
