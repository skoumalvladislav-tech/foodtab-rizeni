import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { zalozitUkolZChecklistu } from '../../akce'
import FormularProblem from './formular-problem'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Nahlásit problém z checklistu — formulář úkolu z běhu (nebo z jedné
 * jeho položky).
 *
 * ŽÁDNÝ NÁVRH: checklist nemá text zprávy, ze kterého by šlo něco poznat
 * (na rozdíl od úkolu ze zprávy) — jen název položky, kterým se předvyplní
 * název úkolu.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: dokud databáze funkci
 * zalozit_ukol_z_checklistu nezná, řekne se to a formulář se nenabízí.
 */
export default async function NahlasitProblem({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string }>
  searchParams: Promise<{ polozka?: string; chyba?: string }>
}) {
  const { rozsah, beh } = await params
  const { polozka: polozkaId, chyba } = await searchParams

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

  const zpet = `/${rozsah}/ukoly/${beh}`

  const supabase = await getServerSupabase()

  const { data: behyData, error: chybaBehy } = await supabase
    .from('checklist_runs')
    .select('id, template_id, branch_id')
    .eq('id', beh)
    .limit(1)
  if (chybaBehy) throw new DotazSelhal('běh checklistu', chybaBehy)
  const run = behyData?.[0] as { id: string; template_id: string; branch_id: string } | undefined

  // RLS vrátí prázdno i tehdy, když běh existuje, ale nepatří nám — stejný
  // postup jako na obrazovce samotného checklistu.
  if (!run) {
    return (
      <Sdeleni nadpis="Checklist nenalezen">
        Buď neexistuje, nebo není váš. <Link href={`/${rozsah}/ukoly`}>Zpět na úkoly</Link>.
      </Sdeleni>
    )
  }

  if (!(await hasAccess(tenantId, 'tasks.manage', run.branch_id))) {
    return (
      <Sdeleni nadpis="Úkol zadat nemůžete">
        Zadávat úkoly smí jen ten, kdo má na to oprávnění. <Link href={zpet}>Zpět na checklist</Link>.
      </Sdeleni>
    )
  }

  const { data: sablonyData, error: chybaSablony } = await supabase
    .from('checklist_templates')
    .select('name')
    .eq('id', run.template_id)
    .limit(1)
  if (chybaSablony) throw new DotazSelhal('šablona checklistu', chybaSablony)
  const checklistNazev = (sablonyData?.[0]?.name as string | undefined) ?? 'Checklist'

  // Položka je nepovinná (?polozka=…): neplatná nebo cizí se tiše ignoruje —
  // formulář pak jen mluví o celém checklistu, ne o jedné řádce. Databáze
  // ověří vazbu na šablonu znovu, kdyby se sem přesto něco podvrhlo.
  let polozka: { id: string; label: string } | null = null
  if (polozkaId && UUID.test(polozkaId)) {
    const { data: polozkyData, error: chybaPolozky } = await supabase
      .from('checklist_items')
      .select('id, label')
      .eq('id', polozkaId)
      .eq('template_id', run.template_id)
      .limit(1)
    if (chybaPolozky) throw new DotazSelhal('položka checklistu', chybaPolozky)
    const p = polozkyData?.[0] as { id: string; label: string } | undefined
    if (p) polozka = { id: p.id, label: p.label }
  }

  /*
    Úseky a pozice čte každý člen firmy; lidi ne (employees_select pustí jen
    vlastní řádek, shifts.read na pobočce nebo people.manage) — stejná
    poznámka jako u ručního „Zadat úkol“ na /ukoly.
  */
  const { data: usekyData, error: chybaUseky } = await supabase
    .from('useky')
    .select('id, nazev')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('poradi', { ascending: true })
  if (chybaUseky) throw new DotazSelhal('úseky', chybaUseky)

  const { data: poziceData, error: chybaPozice } = await supabase
    .from('positions')
    .select('id, label')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('label', { ascending: true })
  if (chybaPozice) throw new DotazSelhal('pozice', chybaPozice)

  const { data: lideData, error: chybaLide } = await supabase
    .from('employees')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('active', true)
    .order('full_name', { ascending: true })
  if (chybaLide) throw new DotazSelhal('lidé pro nahlášení problému', chybaLide)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Vznikne úkol; checklist samotný se tím nemění."
        vpravo={
          <Link href={zpet} className="ft-tl">
            Zpět na checklist
          </Link>
        }
      >
        Nahlásit problém
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        <FormularProblem
          akce={zalozitUkolZChecklistu}
          rozsah={rozsah}
          beh={run.id}
          checklistNazev={checklistNazev}
          polozka={polozka}
          chyba={chyba ?? null}
          lide={((lideData ?? []) as { id: string; full_name: string }[]).map((l) => ({
            employee_id: l.id,
            jmeno: l.full_name,
          }))}
          useky={((usekyData ?? []) as { id: string; nazev: string }[]).map((u) => [u.id, u.nazev] as [string, string])}
          pozice={((poziceData ?? []) as { id: string; label: string }[]).map((p) => [p.id, p.label] as [string, string])}
          zpet={zpet}
        />
      </div>
    </>
  )
}
