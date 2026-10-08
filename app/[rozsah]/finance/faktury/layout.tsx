import type { ReactNode } from 'react'

import { canSee, getContext, isModuleActive } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { pristupKFakturam, type FakturyKlient } from '@/lib/supabase/faktury'
import { sestavNavigaci } from '@/lib/faktury-navigace'
import { FILTR_KE_KONTROLE, STAV_KE_SCHVALENI, STAV_UHRAZENO } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Navigace from './navigace'

/**
 * Rám modulu Faktury.
 *
 * Zadání: docs/hlaseni/zadani-pro-ai-marketing-faktury.md, „PROJEKT 2:
 * Faktury — sloučení s Foodtabem". Stejný vzor jako marketing/layout.tsx
 * (Krok 1, 14.9.2026) — vlastní levý sloupec a mobilní lišta uvnitř
 * Foodtabova rámu.
 *
 * ---------------------------------------------------------------------
 * ÚROVEŇ FIRMY, NE POBOČKY
 *
 * Zadání: „Faktury pravděpodobně patří na úroveň firmy (ne pobočky)".
 * Doklad chodí na jednu ze tří firemních e-mailových schránek, ne na
 * konkrétní provozovnu — proto se modul na pobočce vůbec nekreslí,
 * místo toho jasná zpráva, kam přepnout.
 */
export default async function FakturyLayout({
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
  if (!ctx || !isModuleActive(ctx, 'finance') || !canSee(ctx, 'faktury.read')) {
    return <>{children}</>
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return <>{children}</>

  if (scope.level !== 'tenant') {
    return (
      <Sdeleni nadpis="Faktury patří celé firmě">
        Modul se neváže na jednu provozovnu — přepněte se nahoře na „Celá firma“.
      </Sdeleni>
    )
  }

  const pristup = await pristupKFakturam(tenantId)
  if (pristup.stav === 'nenastaveno') {
    return (
      <Sdeleni nadpis="Faktury zatím nejsou připojené">
        Chybí FAKTURY_SUPABASE_URL a FAKTURY_SUPABASE_ANON_KEY v nastavení
        prostředí. Doplní je Šéfík.
      </Sdeleni>
    )
  }
  if (pristup.stav === 'bez_vlastnika') {
    return (
      <Sdeleni nadpis="Databáze faktur zatím není přiřazená žádné firmě">
        Faktury se ukážou, až bude v nastavení prostředí (Vercel) proměnná
        FAKTURY_DB_TENANT_ID s id firmy, které databáze faktur patří.
        {canSee(ctx, 'settings.manage') ? ` Id téhle firmy: ${tenantId}` : ' Nastaví ji Šéfík.'}
      </Sdeleni>
    )
  }
  if (pristup.stav === 'jina_firma') {
    return (
      <Sdeleni nadpis="Faktury pro tuto firmu nejsou napojené">
        Napojená databáze faktur patří jiné firmě.
      </Sdeleni>
    )
  }

  const pocty = await nactiPocty(pristup.faktury)
  const { hlavni, mobil } = sestavNavigaci(rozsah, pocty)

  return (
    <Navigace hlavni={hlavni} mobil={mobil}>
      {children}
    </Navigace>
  )
}

/**
 * Počty do odznaků — stejné tři dotazy jako `getNavCounts` v
 * faktury-app (src/lib/navCounts.ts): jen `count: "exact", head: true`,
 * žádná data řádků se nepřenáší.
 *
 * Chyba se nevyhazuje: dokud appka běží nad prázdnou/nedostupnou
 * databází, počítadla mají ukázat nulu, ne položit celý modul.
 */
async function nactiPocty(supabase: FakturyKlient): Promise<{ needsReview: number; overdue: number; pendingApproval: number }> {
  try {
    const dnes = new Date().toISOString().slice(0, 10)

    const [needsReview, overdue, pendingApproval] = await Promise.all([
      supabase.from('invoices').select('*', { count: 'exact', head: true })
        .eq('is_archived', false).or(FILTR_KE_KONTROLE),
      supabase.from('invoices').select('*', { count: 'exact', head: true })
        .eq('is_archived', false).neq('status', STAV_UHRAZENO).neq('status', STAV_KE_SCHVALENI)
        .not('due_date', 'is', null).lt('due_date', dnes),
      supabase.from('invoices').select('*', { count: 'exact', head: true })
        .eq('is_archived', false).eq('status', STAV_KE_SCHVALENI),
    ])

    return {
      needsReview: needsReview.count ?? 0,
      overdue: overdue.count ?? 0,
      pendingApproval: pendingApproval.count ?? 0,
    }
  } catch {
    return { needsReview: 0, overdue: 0, pendingApproval: 0 }
  }
}
