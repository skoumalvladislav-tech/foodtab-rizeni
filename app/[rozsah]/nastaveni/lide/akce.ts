'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Přidání nebo úprava zaměstnance.
 *
 * Zaměstnanec může být:
 * - s účtem (user_id vyplněné) — přihlášeného člena firmy
 * - bez účtu — brigádník nebo občasná výpomoc
 *
 * Mazání je soft — deleted_at se nastaví, řádek zůstane v DB kvůli
 * návaznosti na docházku.
 */
export async function upravitZamestnance(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = formData.get('id') ? String(formData.get('id')) : null
  const jmeno = String(formData.get('jmeno') ?? '').trim()
  const pozice = formData.get('pozice') ? String(formData.get('pozice')) : null
  const pobocka = formData.get('pobocka') ? String(formData.get('pobocka')) : null
  const typ = String(formData.get('typ') ?? 'hpp')

  if (!jmeno) {
    redirect(`/${rozsah}/nastaveni/lide?chyba=jmeno`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  if (id) {
    // Úprava
    const { error } = await supabase
      .from('employees')
      .update({
        full_name: jmeno,
        position_id: pozice,
        branch_id: pobocka,
        employment_type: typ,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  } else {
    // Přidání
    const { error } = await supabase
      .from('employees')
      .insert({
        tenant_id: tenantId,
        full_name: jmeno,
        position_id: pozice,
        branch_id: pobocka,
        employment_type: typ,
      })

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  }

  revalidatePath(`/${rozsah}/nastaveni/lide`)
  redirect(`/${rozsah}/nastaveni/lide?ulozeno=1`)
}

/**
 * Soft-delete zaměstnance.
 */
export async function smazatZamestnance(
  id: string,
  rozsah: string
): Promise<void> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') return

  const supabase = await getServerSupabase()
  await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/nastaveni/lide`)
}
