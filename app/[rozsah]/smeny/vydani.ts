'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Vydání rozpisu.
 *
 * Zadání docs/upozorneni-smeny-zadani.md: upozornění odchází až při
 * vydání, ne při každé úpravě. Tohle je to tlačítko.
 *
 * Rozeslané zprávy se nedají vzít zpět, takže obrazovka napřed ukáže
 * náhled („odejde 6 zpráv 4 lidem“) — stejně jako u nahrávání z tabulky.
 * Náhled i vydání počítá rozdíl táž funkce v databázi, aby náhled
 * neslíbil něco jiného, než co se stane.
 */
export async function vydatRozpis(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const branchId = String(formData.get('pobocka') ?? '')
  const od = String(formData.get('od') ?? '')
  const doKdy = String(formData.get('do') ?? '')

  if (!branchId || !od || !doKdy) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  // První obranná linie. Druhá je uvnitř public.vydat_rozpis, která si
  // shifts.manage na té pobočce ověří sama.
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('vydat_rozpis', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_od: od,
    p_do: doKdy,
  })

  if (error) {
    redirect(
      `/${rozsah}/smeny?chyba=vydani&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/smeny`)
  redirect(`/${rozsah}/smeny?vydano=${Number(data ?? 0)}`)
}
