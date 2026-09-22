import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'

/**
 * Společný začátek akcí Provozního centra.
 *
 * Firmu ani pobočku nebereme z formuláře. Rozsah se čte z adresy a ověřuje
 * proti členství (`bezpecnyRozsah`, pravidlo 4); kdyby si úroveň volil
 * prohlížeč, dal by se rozsah obejít přepsáním jednoho čísla.
 *
 * Záměrně NENÍ v souboru s `'use server'`: každá exportovaná funkce takového
 * souboru se stává volatelným koncovým bodem, a tohle je pomocník, ne akce.
 */
export type Zaklad = {
  tenantId: string
  rozsah: string
  branchId: string | null
}

/** Vrací null, když cokoli nesedí (nepřihlášen, žádná firma, cizí rozsah). */
export async function zakladZRozsahu(rozsah: string): Promise<Zaklad | null> {
  const user = await getUser()
  if (!user) return null
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null
  const ctx = await getContext(tenantId)
  if (!ctx) return null
  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return null

  return { tenantId, rozsah, branchId: scope.branchId }
}
