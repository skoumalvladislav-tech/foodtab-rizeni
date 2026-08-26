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
 * Úroveň se bere z rozsahu v adrese, ne z formuláře: na firemní adrese
 * vzniká zpráva celé firmě (`branch_id` prázdné), na pobočkové zpráva
 * té pobočce. Kdyby si úroveň volil prohlížeč, dal by se rozsah obejít.
 */
export async function napsatZpravu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const text = String(formData.get('text') ?? '').trim()
  const pripnout = String(formData.get('pripnout') ?? '') === 'ano'
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
  await supabase.from('announcements').insert({
    tenant_id: tenantId,
    branch_id: scope.branchId,
    body: text,
    pinned: pripnout,
    author_id: user.id,
  })

  revalidatePath(`/${rozsah}/zpravy`)
}
