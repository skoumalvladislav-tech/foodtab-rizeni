import type { ReactNode } from 'react'

import { canSee, getContext, hasAccess, isModuleActive } from '@/lib/authz'
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
 * POBOČKA — JEN PRO TOHO, KDO VIDÍ FINANCE CELÉ FIRMY
 *
 * Do 13. 10. 2026 se modul na pobočce nevykresloval vůbec („Finance
 * patří celé firmě“). Šéfík 13. 10.: „mám otevřený Bernard Bar, budou
 * vidět finance, které se týkají jen Bernard Baru.“ Každá obrazovka si
 * teď bere pobočku z rozsahu (`pobockaFinanci`, lib/finance-rozsah.ts)
 * a filtruje podle ní; obrazovky jen pro firmu (Kontakty, Integrace,
 * Faktury, AI analytik) mají vlastní vnořenou bránu (`JenProFirmu`).
 *
 * Na pobočku ale smí jen ten, kdo má `finance.read` ZA CELOU FIRMU
 * (`hasAccess(…, null)`): RLS části finančních tabulek (transakce,
 * kontakty, párování, bankovní zůstatky — `can_read_scoped(…, null)`)
 * rozsah členství nehlídá, takže člověk s finance.read jen v jedné
 * pobočce by přes ně dosáhl na data celé firmy. Pustit ho sem jde až po
 * zúžení těch politik (migrace) — ROZHODNOUT, docs/hlaseni/otazky.md.
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

  if (scope.level !== 'tenant' && !(await hasAccess(tenantId, 'finance.read', null))) {
    return (
      <Sdeleni nadpis="Finance pobočky zatím jen s přehledem celé firmy">
        Finance jednotlivé pobočky zatím vidí jen ten, kdo má finanční přehled za celou firmu.
        Část údajů (banka, kontakty, párování plateb) se po pobočkách zatím oddělit nedá.
      </Sdeleni>
    )
  }

  return <>{children}</>
}
