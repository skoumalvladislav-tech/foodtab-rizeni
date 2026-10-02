import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'

/**
 * Společný začátek akcí receptur — stejný tvar jako
 * app/[rozsah]/vzkazy/zaklad.ts.
 *
 * Firmu ani pobočku nebereme z formuláře, jen z adresy a ověřené proti
 * členství (bezpecnyRozsah, pravidlo 4) — jinak by šel rozsah přepsat
 * jedním číslem v URL.
 *
 * Záměrně NENÍ v souboru s 'use server': je to pomocník pro akce.ts,
 * ne akce samotná.
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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
