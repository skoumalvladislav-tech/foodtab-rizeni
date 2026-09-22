import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import PcZalozky from '../../../provozni-centrum/zalozky'
import { dokoncitUkolZDetailu } from './akce'
import DetailUkolu from './detail-ukolu'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ukol = {
  id: string
  branch_id: string | null
  title: string
  note: string | null
  due_at: string | null
  priority: 'normal' | 'high'
  status: 'open' | 'done' | 'cancelled'
  usek_id: string | null
  position_id: string | null
  employee_id: string | null
  role_id: string | null
  created_at: string
  done_at: string | null
  zprava_id?: string | null
  konverzace_id?: string | null
  checklist_run_id?: string | null
  checklist_item_id?: string | null
}

/**
 * Detail úkolu.
 *
 * Čtení řídí RLS na `tasks`: kdo úkol vidět nesmí (nemá tasks.read na pobočce
 * a není adresátem), dostane prázdno. Proto se tu neptáme na právo předem —
 * jinak by člověk, kterému úkol někdo zadal, neměl kam kliknout z upozornění.
 *
 * Diskuse k úkolu samostatně neexistuje. Když úkol vznikl ze zprávy, vede
 * odkaz zpátky do rozhovoru; tam se o něm mluví.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: vazba na zprávu (`zprava_id`,
 * `konverzace_id`) i na checklist (`checklist_run_id`, `checklist_item_id`)
 * se čte tolerantně, bez nich se detail ukáže bez zdroje.
 */
export default async function StrankaDetailuUkolu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; id: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah, id } = await params
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

  const supabase = await getServerSupabase()

  const dotaz = (sloupce: string) =>
    supabase.from('tasks').select(sloupce).eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  const zaklad = 'id, branch_id, title, note, due_at, priority, status, usek_id, position_id, employee_id, role_id, created_at, done_at'

  let ukol: Ukol | null = null
  if (UUID.test(id)) {
    let { data, error } = await dotaz(
      `${zaklad}, zprava_id, konverzace_id, checklist_run_id, checklist_item_id`,
    )
    if (error && sloupecNeexistuje(error)) ({ data, error } = await dotaz(`${zaklad}, zprava_id, konverzace_id`))
    if (error && sloupecNeexistuje(error)) ({ data, error } = await dotaz(zaklad))
    if (error) throw new DotazSelhal('úkol', error)
    ukol = (data as unknown as Ukol | null) ?? null
  }

  if (!ukol) {
    return (
      <Sdeleni nadpis="Tenhle úkol nenajdeme">
        Buď neexistuje, nebo k němu nemáte přístup. <Link href={`/${rozsah}/ukoly`}>Zpět na úkoly</Link>.
      </Sdeleni>
    )
  }

  // Komu: jen jedno z pole (tasks_jeden_cil). Názvy si čte RLS; kdo je číst
  // nesmí, dostane obecné slovo, ne chybu.
  let komu = 'Celá pobočka'
  if (ukol.employee_id) {
    const { data } = await supabase.from('employees').select('full_name').eq('id', ukol.employee_id).maybeSingle()
    komu = (data?.full_name as string | undefined)?.trim() || 'Konkrétní člověk'
  } else if (ukol.usek_id) {
    const { data } = await supabase.from('useky').select('nazev').eq('id', ukol.usek_id).maybeSingle()
    komu = `Úsek ${(data?.nazev as string | undefined) ?? ''}`.trim()
  } else if (ukol.position_id) {
    const { data } = await supabase.from('positions').select('label').eq('id', ukol.position_id).maybeSingle()
    komu = `Zařazení ${(data?.label as string | undefined) ?? ''}`.trim()
  } else if (ukol.role_id) {
    komu = 'Každý s příslušným oprávněním'
  } else if (!ukol.branch_id) {
    komu = 'Celá firma'
  }

  // Odkud úkol vzešel z checklistu — jen když vazba pořád existuje (run se
  // dá smazat, viz FK on delete set null). Šablona i položka se dohledávají
  // zvlášť, ať se jedna chybějící (smazaná položka) neztratí druhou.
  let checklistZdroj: { behNazev: string; polozkaLabel: string | null } | null = null
  if (ukol.checklist_run_id) {
    const { data: behData } = await supabase
      .from('checklist_runs')
      .select('template_id, business_date')
      .eq('id', ukol.checklist_run_id)
      .maybeSingle()
    if (behData) {
      const { data: sablonaData } = await supabase
        .from('checklist_templates')
        .select('name')
        .eq('id', behData.template_id as string)
        .maybeSingle()
      let polozkaLabel: string | null = null
      if (ukol.checklist_item_id) {
        const { data: polozkaData } = await supabase
          .from('checklist_items')
          .select('label')
          .eq('id', ukol.checklist_item_id)
          .maybeSingle()
        polozkaLabel = (polozkaData?.label as string | undefined) ?? null
      }
      checklistZdroj = {
        behNazev:
          ((sablonaData?.name as string | undefined) ?? 'Checklist') + ' · ' + String(behData.business_date),
        polozkaLabel,
      }
    }
  }

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))
  const smiVidetUkoly = await hasAccess(tenantId, 'tasks.read', scope.branchId)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Detail úkolu."
        vpravo={
          <Link href={`/${rozsah}/ukoly`} className="ft-tl">
            Zpět na úkoly
          </Link>
        }
      >
        Úkol
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        <PcZalozky
          rozsah={rozsah}
          aktivni="ukoly"
          skryte={smiVidetUkoly ? [] : ['ukoly', 'checklisty']}
        />

        <DetailUkolu
          rozsah={rozsah}
          ukol={ukol}
          komu={komu}
          pobocka={ukol.branch_id ? (nazvyPobocek.get(ukol.branch_id) ?? 'jiná pobočka') : 'Celá firma'}
          chyba={chyba ?? null}
          akceDokoncit={dokoncitUkolZDetailu}
          checklistZdroj={checklistZdroj}
        />
      </div>
    </>
  )
}
