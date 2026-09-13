'use server'

import { revalidatePath } from 'next/cache'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Akce nástěnky.
 *
 * Přečtení si eviduje každý sám za sebe — politika announcement_reads_own
 * pustí jen řádek s vlastním `user_id`. Psát zprávy smí jen
 * communication.manage, což hlídá announcements_write; tady se o to
 * nepokoušíme podruhé, jen neposíláme nesmysl.
 */

/** Označení zprávy za přečtenou. Druhé kliknutí nic nerozbije. */
export async function oznacitPrectene(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpravaId = String(formData.get('zprava') ?? '')
  if (!zpravaId) return

  const user = await getUser()
  if (!user) return

  const supabase = await getServerSupabase()
  await supabase.from('announcement_reads').upsert(
    { announcement_id: zpravaId, user_id: user.id },
    { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
  )

  revalidatePath(`/${rozsah}/zpravy`)
}

/**
 * Nová zpráva.
 *
 * Adresát se bere z komu_typ + komu_id_* polí, ne ze scope v adrese:
 * vedoucí celé firmy může z firemní adresy napsat jen jednomu člověku
 * nebo jednomu úseku, ne nutně všem. Scope v adrese se ověřuje jen
 * kvůli autorizaci (bezpecnyRozsah); cíl zprávy volí formulář.
 *
 * Cross-tenant validace: před zápisem ověříme, že cílové ID patří
 * témuž tenantovi. RLS to sice taky zajistí, ale chyba z INSERT
 * je méně srozumitelná než tiché selhání tady.
 */
export async function napsatZpravu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const text = String(formData.get('text') ?? '').trim()
  const pripnout = String(formData.get('pripnout') ?? '') === 'ano'
  const vyzadatPotvrzeni = String(formData.get('vyzadat_potvrzeni') ?? '') === 'ano'
  const komuTyp = String(formData.get('komu_typ') ?? 'firma')
  if (text === '') return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const supabase = await getServerSupabase()

  // Přeložit komu_typ na DB sloupce; každý typ čte jiný komu_id_* klíč,
  // takže submit ostatních (skrytých) polí adresáta nepokazí volbu.
  let branchId: string | null = null
  let usekId: string | null = null
  let positionId: string | null = null
  let employeeId: string | null = null

  if (komuTyp === 'firma') {
    // branchId zůstane null → celá firma
  } else if (komuTyp === 'pobocka') {
    const komuId = String(formData.get('komu_id_pobocka') ?? '').trim()
    if (!komuId) return
    const { data } = await supabase
      .from('branches')
      .select('id')
      .eq('id', komuId)
      .eq('tenant_id', tenantId)
      .single()
    if (!data) return
    branchId = komuId
  } else if (komuTyp === 'usek') {
    const komuId = String(formData.get('komu_id_usek') ?? '').trim()
    if (!komuId) return
    const { data } = await supabase
      .from('useky')
      .select('id, branch_id')
      .eq('id', komuId)
      .eq('tenant_id', tenantId)
      .single()
    if (!data) return
    // Úsekové oznámení zdědí branch_id úseku, aby can_read_scoped správně
    // ověřilo přístup k pobočce. Pokud úsek patří celé firmě, branch_id = null.
    branchId = (data as { id: string; branch_id: string | null }).branch_id
    usekId = komuId
  } else if (komuTyp === 'pozice') {
    const komuId = String(formData.get('komu_id_pozice') ?? '').trim()
    if (!komuId) return
    const { data } = await supabase
      .from('positions')
      .select('id')
      .eq('id', komuId)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single()
    if (!data) return
    positionId = komuId
  } else if (komuTyp === 'clovek') {
    const komuId = String(formData.get('komu_id_clovek') ?? '').trim()
    if (!komuId) return
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('id', komuId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single()
    if (!data) return
    employeeId = komuId
  } else {
    return
  }

  await supabase.from('announcements').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    usek_id: usekId,
    position_id: positionId,
    employee_id: employeeId,
    body: text,
    pinned: pripnout,
    author_id: user.id,
    requires_acknowledgment: vyzadatPotvrzeni,
  })

  revalidatePath(`/${rozsah}/zpravy`)
}
