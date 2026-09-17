'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { vyzadujePotvrzeni } from '@/lib/upozorneni-text'

/**
 * Označení upozornění za přečtená.
 *
 * Politika na `notifications` pustí úpravu jen u vlastních řádků, takže
 * se tu nic dalšího neověřuje — a hlavně se odsud nepředává, čí
 * upozornění to jsou. Kdyby šlo poslat cizí id, dal by se cizímu
 * člověku označit rozpis za přečtený a on by o změně nevěděl.
 */
export async function oznacitPrectene(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const supabase = await getServerSupabase()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('read_at', null)

  revalidatePath(`/${rozsah}`, 'layout')
  redirect(`/${rozsah}/upozorneni`)
}

/**
 * Potvrzení změny/zrušení směny.
 *
 * Stejná úvaha jako u oznacitPrectene: politika pustí úpravu jen
 * u vlastních řádků, takže se odsud nepředává, čí upozornění to je.
 * Navíc `.in('druh', …)` — potvrdit jde jen to, co potvrzení podle
 * vyzadujePotvrzeni() vyžaduje (lib/upozorneni-text.ts, jediné místo
 * s tímhle pravidlem). Potvrzení znamená i přečtení, proto se nastaví
 * obojí najednou.
 */
export async function potvrditZmenu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  if (!id) redirect(`/${rozsah}/upozorneni`)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const supabase = await getServerSupabase()
  await supabase
    .from('notifications')
    .update({ acknowledged_at: new Date().toISOString(), read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('druh', DRUHY_S_POTVRZENIM)
    .is('acknowledged_at', null)

  revalidatePath(`/${rozsah}`, 'layout')
  redirect(`/${rozsah}/upozorneni`)
}

/** `.in()` chce pole, ne funkci — a musí sedět s vyzadujePotvrzeni(). */
const DRUHY_S_POTVRZENIM = ['smena.zmenena', 'smena.zrusena'].filter(vyzadujePotvrzeni)
