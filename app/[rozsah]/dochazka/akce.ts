'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zápis příchodu nebo odchodu KÓDEM Z KIOSKU.
 *
 * Do 1. 9. 2026 tahle akce zapisovala do docházky přímo. Znamenalo to,
 * že si zaměstnanec mohl přímým voláním rozhraní založit příchod
 * k 1. červenci ve 3:00 — a nebyl nijak označený, protože formálně šlo
 * o řádné píchnutí. Dokud byla docházka evidence, byla to drobnost;
 * teď se z ní počítá mzda a zálohy.
 *
 * Od téhle chvíle smí píchnutí vzniknout jen třemi cestami (zadání
 * docs/kiosek-pin-zalohy-zadani.md, oddíl 5):
 *
 *   měnící se kód  — tahle akce
 *   PIN na kiosku  — public.pichnout_pinem
 *   ruční zadání   — attendance.manage, s důvodem a auditem
 *
 * Čas si tedy nikdo nevybírá: zapisuje se „teď“ a rozhoduje o tom
 * databáze, ne prohlížeč.
 */
export async function zapsatDochazku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const druh = String(formData.get('druh') ?? '')
  const kod = String(formData.get('kod') ?? '').trim()

  if (druh !== 'in' && druh !== 'out') return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!kod) {
    redirect(`/${rozsah}/dochazka?chyba=kod`)
  }

  const supabase = await getServerSupabase()

  // Pobočka se NEPOSÍLÁ. Vyplyne z kódu — ten patří jedné konkrétní
  // pobočce a jinde neplatí. Kdyby šla poslat z prohlížeče, dal by se
  // kód z jedné provozovny použít na druhé.
  const { error } = await supabase.rpc('pichnout_kodem', {
    p_tenant: tenantId,
    p_kod: kod,
    p_druh: druh,
  })

  if (error) {
    redirect(
      `/${rozsah}/dochazka?chyba=pichnuti&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/dochazka`)
  redirect(`/${rozsah}/dochazka?pichnuto=${druh}`)
}
