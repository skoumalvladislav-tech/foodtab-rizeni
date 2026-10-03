import type { ReactNode } from 'react'

import { canSee, getContext, isModuleActive } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'

/**
 * Rám modulu Finance (gastro ERP, 3. 10. 2026).
 *
 * ---------------------------------------------------------------------
 * JEN BRÁNA, ŽÁDNÉ KRESLENÍ
 *
 * Faktury uvnitř (`/finance/faktury`) mají VLASTNÍ vnořený layout
 * s vlastním levým sloupcem a spodní lištou (lib/faktury-navigace.ts,
 * nikdy neopouštěly svůj vzor ze samostatné appky). Kdyby tenhle layout
 * kreslil svůj vlastní `modul-ram` kolem něj, vnořily by se dvě úplné
 * sady postranních sloupců do sebe. Proto tady žádný `<Navigace>` není —
 * ten si každá z nových finančních obrazovek (Přehled/Kontakty/Platby/
 * Integrace) vykresluje sama (app/[rozsah]/finance/navigace.tsx), stejným
 * dílem jako to dřív dělal celý modul najednou (marketing/layout.tsx).
 *
 * Kontrola tu zůstává jako DRUHÁ LINIE (stejná jako u Faktur) — spadlá
 * nebo chybějící kontrola na obrazovce samotné by jinak byla jediná.
 *
 * ---------------------------------------------------------------------
 * ÚROVEŇ FIRMY, NE POBOČKY
 *
 * Kopie vzoru `finance/faktury/layout.tsx`. Přehled je cross-branch
 * (app.cashflow_prehled počítá VŠECHNY pobočky najednou, ne jednu) a
 * Kontakty žijí jen na úrovni firmy (bez branch_id) — modul se proto na
 * jedné pobočce nevykresluje, jen řekne, kam přepnout.
 */
export default async function FinanceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <>{children}</>

  const ctx = await getContext(tenantId)
  if (!ctx || !isModuleActive(ctx, 'finance') || !canSee(ctx, 'finance.read')) {
    return <>{children}</>
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return <>{children}</>

  if (scope.level !== 'tenant') {
    return (
      <Sdeleni nadpis="Finance patří celé firmě">
        Modul se neváže na jednu provozovnu — přepněte se nahoře na „Celá firma“.
      </Sdeleni>
    )
  }

  return <>{children}</>
}
