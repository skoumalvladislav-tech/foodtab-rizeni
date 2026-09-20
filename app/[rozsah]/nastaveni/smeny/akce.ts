'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Nastavení → Směny — nastavení celého modulu.
 *
 * Zatím jediná volba: nabízet ve formuláři nové směny výběr zařazení
 * (pozice)? Šéfík 20. 9. 2026: zaměstnanci jsou zařazeni od začátku a
 * změna se dá napsat do poznámky, takže je to zbytečné klikání navíc —
 * ale pole má zůstat k dispozici a firma si ho zapne nebo vypne.
 *
 * Zapisuje `nastavit_smeny_formular` (migrace 20260920130000): kontroluje
 * `settings.manage` a zapisuje do auditu. Kontrola práva tady je první
 * linie, databáze druhá.
 */
export async function ulozitNastaveniSmen(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpet = `/${rozsah}/nastaveni/smeny`
  // Zaškrtnuté pošle „on“, odškrtnuté nepošle nic — formulář se vždycky odesílá celý.
  const zarazeni = formData.get('zarazeni') === 'on'

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_smeny_formular', {
    p_tenant: tenantId,
    p_zarazeni: zarazeni,
  })

  if (error) {
    const text = funkceNeexistuje(error)
      ? 'Nastavení ještě není zapnuté — čeká na nasazení databáze.'
      : error.code === '42501'
        ? 'Nastavení směn mění jen ten, kdo na to má oprávnění.'
        : 'Nastavení se nepodařilo uložit.'
    redirect(`${zpet}?chyba=${encodeURIComponent(text)}`)
  }

  // Formulář nové směny čte nastavení při vykreslení Rozpisu.
  revalidatePath(zpet)
  revalidatePath(`/${rozsah}/smeny`)
  redirect(`${zpet}?ulozeno=1`)
}
