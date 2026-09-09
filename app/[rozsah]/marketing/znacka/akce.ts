'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { delkaVidea, neboNull, seznamVyrazu } from '@/lib/marketing-text'
import { jeden } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Uložení značky provozovny (nebo firmy).
 *
 * Rozsah se NEBERE z formuláře, ale z adresy a ověřuje se proti
 * členství (`zkusPristup`) — pravidlo 4. Kdyby se bral ze skrytého
 * pole, stačilo by přepsat jedno id a vedoucí jedné pobočky by
 * přemaloval značku celé firmy.
 *
 * Druhá obranná linie je RLS: politika `marketing_nastaveni_write` se
 * ptá `app.has_access(tenant, 'marketing.manage', branch)`. Ani jedna
 * se nevynechává s tím, že to hlídá ta druhá (pravidlo 3).
 */

export async function ulozitZnacku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing`)

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  const radek = {
    tenant_id: tenantId,
    branch_id: branchId,
    ton_hlasu: String(formData.get('ton_hlasu') ?? 'neformalni'),
    pouzivat_emoji: formData.get('pouzivat_emoji') === 'ano',
    barva_hlavni: neboNull(String(formData.get('barva_hlavni') ?? '')),
    barva_doplnkova: neboNull(String(formData.get('barva_doplnkova') ?? '')),
    pismo_nadpisy: neboNull(String(formData.get('pismo_nadpisy') ?? '')),
    pismo_text: neboNull(String(formData.get('pismo_text') ?? '')),
    podpis: String(formData.get('podpis') ?? '').trim(),
    kontakt: String(formData.get('kontakt') ?? '').trim(),
    vyrazy_ano: seznamVyrazu(String(formData.get('vyrazy_ano') ?? '')),
    vyrazy_ne: seznamVyrazu(String(formData.get('vyrazy_ne') ?? '')),
    video_sekundy: delkaVidea(formData.get('video_sekundy')),
    zmeneno_kdy: new Date().toISOString(),
  }

  /*
    Nejdřív se hledá stávající řádek a teprve pak se rozhoduje mezi
    insertem a updatem. `upsert` by tu byl kratší, jenže jedinečnost
    stojí na indexu s `nulls not distinct` — a u firemního rozsahu je
    `branch_id` NULL, tedy přesně ten případ, na kterém by se rozešlo,
    co si o konfliktu myslí PostgREST a co index.
  */
  const stavajici = await jeden<{ id: string }>(
    'stávající značka',
    branchId === null
      ? supabase.from('marketing_nastaveni').select('id')
          .eq('tenant_id', tenantId).is('branch_id', null).maybeSingle()
      : supabase.from('marketing_nastaveni').select('id')
          .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle(),
  )

  const { error } = stavajici
    ? await supabase.from('marketing_nastaveni').update(radek).eq('id', stavajici.id)
    : await supabase.from('marketing_nastaveni').insert(radek)

  if (error) {
    redirect(`/${rozsah}/marketing/znacka?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/znacka?ulozeno=1`)
}
