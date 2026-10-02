import 'server-only'

import { cookies } from 'next/headers'
import { cache } from 'react'

import {
  getMyTenants,
  NeprihlasenError,
  PristupOdepren,
  requireScopedAccess,
  resolveScope,
  type Context,
  type Permission,
  type Scope,
} from '@/lib/authz'

/**
 * Cookie s ručně vybranou firmou u člena víc firem zároveň — zapisuje ji
 * jen `prepnoutFirmu` (app/firma-prepnuti.ts). Vlastní export, ne řetězec
 * na dvou místech: kdyby se název někdy změnil, obě místa to musí vidět
 * stejně.
 */
export const COOKIE_FIRMA = 'ft_firma_id'

/**
 * Která firma se právě zobrazuje.
 *
 * Výchozí je první firma, kterou uživateli vrátila databáze — ale kdo
 * patří do víc firem a přepnul si to (`prepnoutFirmu`), vyhraje cookie.
 * Hodnotě z cookie se NEVĚŘÍ naslepo: musí být mezi firmami, které
 * `getMyTenants()` doopravdy vrátil, jinak se použije stejný výchozí
 * postup jako dřív. Stejný vzor jako `resolveScope()` u pobočky — cizí
 * nebo smazané členství cookie potichu ignoruje, nespadne na něm.
 *
 * Vrací null, když uživatel nepatří k žádné firmě. Tenhle stav není
 * chyba: čerstvě přihlášený člověk bez pozvánky je přesně tenhle případ.
 */
export const getCurrentTenantId = cache(async (): Promise<string | null> => {
  const tenants = await getMyTenants()
  if (tenants.length === 0) return null

  const vybrana = (await cookies()).get(COOKIE_FIRMA)?.value
  if (vybrana && tenants.some((t) => t.tenantId === vybrana)) return vybrana

  return tenants[0].tenantId
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

/**
 * Výsledek vstupní kontroly stránky.
 *
 * Odmítnutí chodí z authz výjimkou, ale stránka z něj potřebuje hodnotu:
 * na nepřihlášeného se odpovídá přesměrováním, a redirect() nesmí padnout
 * uvnitř odchytávání, protože sám funguje tak, že výjimku vyhodí.
 */
export type Pristup =
  | { stav: 'ok'; ctx: Context; scope: Scope }
  | { stav: 'neprihlasen' }
  | { stav: 'odepren' }

/**
 * Vstupní kontrola obrazovky uvnitř rozsahu.
 *
 * Tímhle začíná každá obrazovka. Vlastní rozhodnutí zůstává v authz
 * a pod ním v databázi — tady se jen převádí tvar, aby si stránka mohla
 * vybrat mezi přesměrováním a vysvětlením.
 */
export async function zkusPristup(
  tenantId: string,
  pravo: Permission,
  rozsah?: string | null,
): Promise<Pristup> {
  try {
    const { ctx, scope } = await requireScopedAccess(tenantId, pravo, rozsah)
    return { stav: 'ok', ctx, scope }
  } catch (duvod) {
    if (duvod instanceof NeprihlasenError) return { stav: 'neprihlasen' }
    if (duvod instanceof PristupOdepren) return { stav: 'odepren' }
    throw duvod
  }
}
