'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getMyTenants } from '@/lib/authz'
import { COOKIE_FIRMA } from '@/lib/firma'

/**
 * Přepnutí aktivní firmy u člena víc firem zároveň (nabídka účtu,
 * `components/shell/MenuUctu.tsx`).
 *
 * Firmě z formuláře se NEVĚŘÍ naslepo — znovu se ověří proti
 * `getMyTenants()`, stejně jako `resolveScope()` ověřuje pobočku v adrese.
 * Bez téhle kontroly by šlo cookií podstrčit libovolné cizí `tenant_id`;
 * `getCurrentTenantId()` by ho sice nikdy nepoužil (taky ověřuje proti
 * `getMyTenants()`), ale chyba patří sem, ne tam — ať neplatná hodnota
 * vůbec nevznikne.
 *
 * Po přepnutí jde člověk na `/`, která podle nové firmy sama pozná, kam
 * patří (firemní úroveň, nebo první pobočka) — stejná cesta jako po
 * přihlášení (`app/page.tsx`).
 */
export async function prepnoutFirmu(formData: FormData): Promise<void> {
  const tenantId = String(formData.get('tenantId') ?? '')

  const tenants = await getMyTenants()
  if (tenants.some((t) => t.tenantId === tenantId)) {
    const cookieStore = await cookies()
    cookieStore.set(COOKIE_FIRMA, tenantId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  redirect('/')
}
