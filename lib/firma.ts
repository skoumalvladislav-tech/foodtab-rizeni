import 'server-only'

import { cache } from 'react'

import { getMyTenants, resolveScope, type Context, type Scope } from '@/lib/authz'

/**
 * Která firma se právě zobrazuje.
 *
 * Rozhraní je zatím jednofiremní — bere se první firma, kterou uživateli
 * vrátila databáze. Až přibude přepínač firem, přepíše se to tady a ne
 * na každé stránce zvlášť.
 *
 * Vrací null, když uživatel nepatří k žádné firmě. Tenhle stav není
 * chyba: čerstvě přihlášený člověk bez pozvánky je přesně tenhle případ.
 */
export const getCurrentTenantId = cache(async (): Promise<string | null> => {
  const tenants = await getMyTenants()
  return tenants[0]?.tenantId ?? null
})

/**
 * Rozsah z adresy, nebo null.
 *
 * resolveScope() odmítne rozsah, na který uživatel nemá — vedoucí jedné
 * pobočky na firemní úroveň, kdokoli na cizí pobočku. Odmítnutí sem
 * chodí výjimkou, ale stránky z něj potřebují obyčejnou hodnotu: uvnitř
 * odchytávání totiž nesmí padnout redirect(), který sám funguje tak, že
 * výjimku vyhodí.
 *
 * Vlastní rozhodnutí zůstává v lib/authz.ts. Tohle je jen převod tvaru.
 */
export function bezpecnyRozsah(ctx: Context, rozsah?: string | null): Scope | null {
  try {
    return resolveScope(ctx, rozsah)
  } catch {
    return null
  }
}
