import type { ReactNode } from 'react'

import { canSee, getContext, isModuleActive } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { sestavNavigaci, type MarketingPravo } from '@/lib/marketing-navigace'
import { getServerSupabase } from '@/lib/supabase/server'
import Navigace from './navigace'

/**
 * Rám marketingu: levý sloupec od 1024 px, pod tím spodní lišta.
 *
 * Jen kreslení. O přístupu rozhoduje každá obrazovka sama; kdo do
 * marketingu nesmí, dostane od ní vysvětlení a navigaci nevidí.
 */
export default async function MarketingLayout({
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
  if (!ctx || !isModuleActive(ctx, 'marketing') || !canSee(ctx, 'marketing.read')) {
    return <>{children}</>
  }

  // Chyba se nevyhazuje: dokud neproběhne migrace, tabulka tu není
  // a kvůli počítadlu nemá padat celý marketing.
  const supabase = await getServerSupabase()
  const { count, error } = await supabase
    .from('marketing_schvaleni')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('stav', 'ceka')

  const { hlavni, nastaveni, spodni } = sestavNavigaci(
    rozsah,
    (pravo: MarketingPravo) => canSee(ctx, pravo),
    error ? 0 : (count ?? 0),
  )

  return (
    <Navigace hlavni={hlavni} nastaveni={nastaveni} spodni={spodni}>
      {children}
    </Navigace>
  )
}
