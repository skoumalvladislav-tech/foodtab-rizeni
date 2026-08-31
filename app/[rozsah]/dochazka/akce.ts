'use server'

import { revalidatePath } from 'next/cache'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zápis příchodu nebo odchodu.
 *
 * Z formuláře se bere jen rozsah a druh události. Firma, pobočka
 * i zaměstnanec se dohledávají znovu na serveru — kdyby přišly
 * z prohlížeče, dal by se podvrhnout cizí zaměstnanec nebo pobočka,
 * na které člověk nepracuje. Politika attendance_insert hlídá
 * zaměstnance, pobočku už ne.
 *
 * `business_date` se nedoplňuje: má ho na starost trigger
 * trg_attendance_business_date podle otevírací doby pobočky.
 */
export async function zapsatDochazku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const druh = String(formData.get('druh') ?? '')

  if (druh !== 'in' && druh !== 'out') return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const supabase = await getServerSupabase()

  const { data: zaznamy, error: chybaZaznamy } = await supabase
    .from('employees')
    .select('id, branch_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1)
  if (chybaZaznamy) throw new DotazSelhal('můj zaměstnanecký záznam', chybaZaznamy)

  const ja = zaznamy?.[0]
  if (!ja) return

  // Pobočka: na pobočkové adrese ta z adresy, jinak domovská pobočka
  // zaměstnance. Sloupec je NOT NULL, takže bez ní zápis nedává smysl.
  const branchId = (scope.branchId ?? ja.branch_id) as string | null
  if (!branchId) return

  await supabase.from('attendance_events').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    employee_id: ja.id,
    kind: druh,
    source: 'app',
  })

  revalidatePath(`/${rozsah}/dochazka`)
}
