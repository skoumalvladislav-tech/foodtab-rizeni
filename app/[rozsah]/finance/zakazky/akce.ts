'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/zakazky`)

  return { supabase: await getServerSupabase(), tenantId }
}

function vytahniPolozky(formData: FormData) {
  const polozky: { popis: string; mnozstvi: number; cena_za_jednotku_haleru: number }[] = []
  for (let i = 1; i <= 10; i++) {
    const popis = String(formData.get(`popis_${i}`) ?? '').trim()
    if (!popis) continue
    const mnozstvi = Number(String(formData.get(`mnozstvi_${i}`) ?? '1').replace(',', '.')) || 1
    const cena = naHalere(String(formData.get(`cena_${i}`) ?? '').trim())
    if (cena === null) continue
    polozky.push({ popis, mnozstvi, cena_za_jednotku_haleru: cena })
  }
  return polozky
}

export async function zalozitZakazku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const kontaktId = String(formData.get('kontakt_id') ?? '')
  const branchId = String(formData.get('branch_id') ?? '') || null
  const nazev = String(formData.get('nazev') ?? '').trim()
  const datumAkce = String(formData.get('datum_akce') ?? '') || null
  const pocetHostuRaw = String(formData.get('pocet_hostu') ?? '').trim()
  const pocetHostu = pocetHostuRaw ? Number(pocetHostuRaw) : null
  const zalohaRaw = String(formData.get('zaloha_pozadovana') ?? '').trim()
  const zaloha = zalohaRaw ? naHalere(zalohaRaw) : 0
  const poznamka = String(formData.get('poznamka') ?? '')
  const polozky = vytahniPolozky(formData)

  if (!kontaktId || !nazev) {
    redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent('Vyplňte odběratele a název zakázky.')}`)
  }

  const { data: zakazkaId, error } = await supabase.rpc('zalozit_zakazku', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_kontakt: kontaktId,
    p_nazev: nazev,
    p_datum_akce: datumAkce,
    p_pocet_hostu: pocetHostu,
    p_zaloha_pozadovana_haleru: zaloha ?? 0,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error || !zakazkaId) {
    redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent('Zakázku se nepodařilo založit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/zakazky`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}`)
}

export async function zmenitStavZakazky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zakazkaId = String(formData.get('zakazka_id') ?? '')
  const stav = String(formData.get('stav') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  await supabase.from('zakazky').update({ stav }).eq('id', zakazkaId).eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/zakazky/${zakazkaId}`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}`)
}

export async function zapsatPlatbuZakazky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zakazkaId = String(formData.get('zakazka_id') ?? '')
  const ucetId = String(formData.get('ucet_id') ?? '')
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const { supabase, tenantId } = await pripravit(rozsah)

  if (!ucetId || castka === null || castka <= 0) {
    redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?chyba=${encodeURIComponent('Vyberte účet a vyplňte částku.')}`)
  }

  const { error } = await supabase.from('transakce').insert({
    tenant_id: tenantId,
    ucet_id: ucetId,
    smer: 'prijem',
    castka_haleru: castka,
    datum: new Date().toISOString().slice(0, 10),
    zdroj: 'rucni',
    zakazka_id: zakazkaId,
    protistrana: 'Platba na zakázku',
  })

  if (error) {
    redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?chyba=${encodeURIComponent('Platbu se nepodařilo zapsat.')}`)
  }

  revalidatePath(`/${rozsah}/finance/zakazky/${zakazkaId}`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?zapsano=1`)
}
