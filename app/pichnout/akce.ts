'use server'

import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Píchnutí kódem z QR.
 *
 * Kód se z prohlížeče posílá, pobočka NE. Kterou pobočku ten kód
 * otevírá, ví jedině `public.pichnout_kodem` — a ta si ji dopočítá
 * z tajemství pobočky, které server nikdy neopouští.
 */
export async function pichnoutKodem(formData: FormData): Promise<void> {
  const kod = String(formData.get('kod') ?? '').trim()
  const druh = String(formData.get('druh') ?? 'in') === 'out' ? 'out' : 'in'

  const zpet = `/pichnout?kod=${encodeURIComponent(kod)}`
  if (!kod) redirect('/pichnout')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('pichnout_kodem', {
    p_tenant: tenantId,
    p_kod: kod,
    p_druh: druh,
  })

  // Hlášku píše databáze a je pro člověka: „Kód neplatí. Načtěte prosím
  // ten, který je zrovna na tabletu.“ Přepisovat ji nemá smysl.
  if (error) {
    redirect(`${zpet}&chyba=${encodeURIComponent(error.message)}`)
  }

  const r = (data as { pobocka: string; mimo_rozpis: boolean }[])?.[0]
  const hotovo = [
    druh === 'in' ? 'prichod' : 'odchod',
    r?.pobocka ?? '',
    r?.mimo_rozpis ? 'mimo' : '',
  ].join('|')

  redirect(`${zpet}&hotovo=${encodeURIComponent(hotovo)}`)
}
