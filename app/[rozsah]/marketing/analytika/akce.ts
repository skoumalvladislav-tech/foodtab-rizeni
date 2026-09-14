'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { doporuceneUtm, novyKlic, zkontrolovatCil } from '@/lib/marketing-odkazy'
import { jeden } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Měřitelné odkazy — zakládání a vypínání.
 *
 * Zadání: master prompt, oddíl 18.
 */

const chybne: (rozsah: string, text: string) => never = (rozsah, text) =>
  redirect(`/${rozsah}/marketing/analytika?chyba=${encodeURIComponent(text)}`)

export async function zalozitOdkaz(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const cil = String(formData.get('cil') ?? '')
  const popis = String(formData.get('popis') ?? '').trim()
  const kanal = String(formData.get('kanal') ?? 'foodtab')
  const kampan = String(formData.get('kampan') ?? '').trim()

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing/analytika`)

  const branchId = pristup.scope.branchId
  if (!branchId) chybne(rozsah, 'Odkaz se zakládá na provozovně, ne za celou firmu.')

  /*
    Cíl se kontroluje TADY, i když ho hlídá i omezení sloupce.
    Omezení pustí cokoli, co začíná `https://`, a chybu by člověk
    uviděl až jako hlášku z databáze.
  */
  const overeny = zkontrolovatCil(cil)
  if (overeny.stav === 'chyba') chybne(rozsah, overeny.duvod)

  const supabase = await getServerSupabase()
  const user = await getUser()

  const ja = user
    ? (await jeden<{ id: string }>(
      'můj záznam zaměstnance',
      supabase.from('employees').select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .maybeSingle(),
    ))?.id ?? null
    : null

  const utm = doporuceneUtm({ kanal, kampan })

  /*
    KLÍČ SE ZKOUŠÍ VÍCKRÁT.

    Je jedinečný v celé databázi, takže se dvě firmy můžou trefit do
    téhož — nepravděpodobné, ale ne nemožné. Tři pokusy stačí:
    pravděpodobnost tří srážek za sebou je mimo úvahu, a smyčka bez
    konce je horší než hláška „zkuste to znovu".
  */
  for (let pokus = 0; pokus < 3; pokus++) {
    const { error } = await supabase.from('marketing_odkazy').insert({
      tenant_id: tenantId,
      branch_id: branchId,
      klic: novyKlic(),
      cil: overeny.cil,
      popis,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      vytvoril: ja,
    })

    if (!error) {
      revalidatePath(`/${rozsah}/marketing`, 'layout')
      redirect(`/${rozsah}/marketing/analytika?zalozeno=1`)
    }

    // Srážka klíčů: zkusit jiný. Cokoli jiného je skutečná chyba.
    if (!error.message.includes('duplicate key')) chybne(rozsah, error.message)
  }

  chybne(rozsah, 'Nepodařilo se vyrobit jedinečný klíč. Zkuste to prosím znovu.')
}

/**
 * VYPNUTÍ, NE SMAZÁNÍ.
 *
 * Odkaz je vytištěný na plakátu a vyfocený v příspěvku. Smazat ho
 * znamená, že hostům přestane fungovat a nikdo nezjistí proč —
 * a s ním zmizí i počet prokliků, tedy jediné číslo, které o té
 * kampani máme.
 */
export async function vypnoutOdkaz(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('odkaz') ?? '')
  const zapnout = String(formData.get('zapnout') ?? '') === '1'

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing/analytika`)

  const supabase = await getServerSupabase()
  const { error } = await supabase.from('marketing_odkazy')
    .update({ aktivni: zapnout })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) chybne(rozsah, error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/analytika?${zapnout ? 'zapnuto' : 'vypnuto'}=1`)
}
