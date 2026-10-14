import 'server-only'

import { hasAccess, type Permission } from '@/lib/authz'
import { zkusPristup, type Pristup } from '@/lib/firma'

/**
 * Vstupní kontrola obrazovky Financí, která na pobočce ukazuje data.
 *
 * `zkusPristup` + druhá podmínka pro pobočku: na pobočce smí jen ten,
 * kdo má finance.read ZA CELOU FIRMU (důvod v app/[rozsah]/finance/layout.tsx
 * — RLS části finančních tabulek rozsah členství nehlídá).
 *
 * Layout tu podmínku má taky, ale stránku NEZASTAVÍ: Next vykreslí stránku
 * souběžně s layoutem a její data pošle do prohlížeče, i když ji layout
 * nevloží (kontrola 14. 10. 2026). Proto ji musí volat každá stránka sama
 * — jedna funkce, ať se na ni v další obrazovce nezapomene.
 * Hlídá scripts/finance-pobocky.test.mjs.
 */
export async function zkusPristupFinanci(tenantId: string, pravo: Permission, rozsah: string): Promise<Pristup> {
  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav !== 'ok' || pristup.scope.level !== 'branch') return pristup
  return (await hasAccess(tenantId, 'finance.read', null)) ? pristup : { stav: 'odepren' }
}
