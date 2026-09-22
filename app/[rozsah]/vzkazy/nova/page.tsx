import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import type { Prijemce } from '@/lib/komunikace/prijemci'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import PcZalozky from '../../provozni-centrum/zalozky'
import { zalozitOsobniRozhovor } from '../akce'
import VyberPrijemcu from './vyber-prijemcu'

export const dynamic = 'force-dynamic'

/**
 * Nová zpráva — výběr příjemců.
 *
 * Seznam kolegů dává `public.komu_muzu_psat`: lidé s účtem z téže firmy,
 * ne sám volající. Běžný zaměstnanec nesmí číst tabulku `employees`, proto
 * to jde průzorem, který vrací jen jméno a zařazení.
 *
 * Rozhovor se zakládá jako osobní (jeden příjemce, nebo skupina). Kanál
 * pobočky a úseku se nezakládá tady — ty se otevírají tlačítky na seznamu.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: bez `komu_muzu_psat` obrazovka řekne,
 * že čeká na databázi, a nespadne.
 */
export default async function NovaZprava({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return <Sdeleni nadpis="Firmu se nepodařilo načíst">Zkuste to prosím za chvíli znovu.</Sdeleni>
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) {
    return <Sdeleni nadpis="Sem nemáte přístup">Tahle část Foodtabu vám není otevřená.</Sdeleni>
  }

  // Záložky Úkoly a Checklisty jen tomu, kdo na ně má právo (jako na ostatních
  // stránkách Provozního centra).
  const smiVidetUkoly = await hasAccess(tenantId, 'tasks.read', scope.branchId)

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('komu_muzu_psat', { p_tenant: tenantId })

  let lide: Prijemce[] = []
  let ceka = false
  if (error) {
    if (funkceNeexistuje(error)) ceka = true
    else throw new DotazSelhal('seznam kolegů', error)
  } else {
    lide = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      employee_id: r.employee_id as string,
      jmeno: String(r.jmeno ?? '').trim() || 'Bez jména',
      branch_id: (r.branch_id as string | null) ?? null,
      usek_id: (r.usek_id as string | null) ?? null,
      position_id: (r.position_id as string | null) ?? null,
      na_me_pobocce: r.na_me_pobocce === true,
    }))
  }

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Vyberte, komu chcete napsat."
        vpravo={
          <Link href={`/${rozsah}/vzkazy`} className="ft-tl">
            Zpět na rozhovory
          </Link>
        }
      >
        Nová zpráva
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '720px' }}>
        <PcZalozky
          rozsah={rozsah}
          aktivni="komunikace"
          skryte={smiVidetUkoly ? [] : ['ukoly', 'checklisty']}
        />

        {ceka ? (
          <p className="pc-poznamka-navrhu">
            <strong>Výběr příjemců čeká na nasazení databáze.</strong> Přibude migrací{' '}
            <code>20260921110000_provozni_centrum</code>. Do té doby jde psát jen do
            kanálu pobočky nebo úseku a poslat vzkaz vedení (na seznamu rozhovorů).
          </p>
        ) : (
          <section className="ds-plocha">
            <VyberPrijemcu
              lide={lide}
              pobocky={ctx.branches.map((b) => [b.id, b.name] as [string, string])}
              akce={zalozitOsobniRozhovor}
              rozsah={rozsah}
              chyba={chyba ?? null}
            />
          </section>
        )}
      </div>
    </>
  )
}
