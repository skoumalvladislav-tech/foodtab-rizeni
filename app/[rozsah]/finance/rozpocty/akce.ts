'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'

export async function zalozitRozpocet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/rozpocty`)

  const supabase = await getServerSupabase()

  const branchId = String(formData.get('branch_id') ?? '') || null
  const kategorie = String(formData.get('kategorie') ?? '')
  const smer = String(formData.get('smer') ?? '')
  const rok = Number(formData.get('rok'))
  const mesic = Number(formData.get('mesic'))
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const jeFixni = formData.get('je_fixni') === 'on'

  if (!kategorie || !smer || !rok || !mesic || castka === null || castka <= 0) {
    redirect(`/${rozsah}/finance/rozpocty?chyba=${encodeURIComponent('Vyplňte kategorii, směr, období a částku.')}`)
  }

  const { error } = await supabase
    .from('rozpocty')
    .upsert(
      { tenant_id: tenantId, branch_id: branchId, kategorie, smer, rok, mesic, castka_haleru: castka, je_fixni: jeFixni },
      { onConflict: 'tenant_id,branch_id,kategorie,smer,rok,mesic' },
    )

  if (error) {
    redirect(`/${rozsah}/finance/rozpocty?chyba=${encodeURIComponent('Rozpočet se nepodařilo uložit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/rozpocty`)
  redirect(`/${rozsah}/finance/rozpocty?rok=${rok}&mesic=${mesic}`)
}
