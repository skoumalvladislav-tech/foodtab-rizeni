'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'purchasing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/nakup`)

  return { supabase: await getServerSupabase(), tenantId }
}

/** Až 10 řádků položek z formuláře — pole `nazev_1`..`nazev_10` atd., prázdné se přeskočí. */
function vytahniPolozky(formData: FormData) {
  const polozky: { nazev: string; jednotka: string; mnozstvi_objednano: number; cena_za_jednotku_haleru: number }[] = []
  for (let i = 1; i <= 10; i++) {
    const nazev = String(formData.get(`nazev_${i}`) ?? '').trim()
    if (!nazev) continue
    const mnozstvi = Number(String(formData.get(`mnozstvi_${i}`) ?? '').replace(',', '.'))
    const cena = naHalere(String(formData.get(`cena_${i}`) ?? '').trim())
    if (!mnozstvi || mnozstvi <= 0 || cena === null) continue
    polozky.push({
      nazev,
      jednotka: String(formData.get(`jednotka_${i}`) ?? '').trim(),
      mnozstvi_objednano: mnozstvi,
      cena_za_jednotku_haleru: cena,
    })
  }
  return polozky
}

export async function zalozitObjednavku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const kontaktId = String(formData.get('kontakt_id') ?? '')
  const branchId = String(formData.get('branch_id') ?? '') || null
  const pozadovaneDatum = String(formData.get('pozadovane_datum_dodani') ?? '') || null
  const poznamka = String(formData.get('poznamka') ?? '')
  const polozky = vytahniPolozky(formData)

  if (!kontaktId || polozky.length === 0) {
    redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent('Vyberte dodavatele a vyplňte alespoň jednu položku.')}`)
  }

  const { data: objednavkaId, error } = await supabase.rpc('zalozit_objednavku', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_kontakt: kontaktId,
    p_pozadovane_datum_dodani: pozadovaneDatum,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error || !objednavkaId) {
    redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent('Objednávku se nepodařilo založit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/nakup`)
  redirect(`/${rozsah}/finance/nakup/${objednavkaId}`)
}

export async function zapsatPrijem(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const objednavkaId = String(formData.get('objednavka_id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const branchId = String(formData.get('branch_id') ?? '') || null
  const fakturaId = String(formData.get('faktura_id') ?? '') || null
  const poznamka = String(formData.get('poznamka') ?? '')

  const polozkyRaw = String(formData.get('polozky') ?? '[]')
  let polozky: unknown
  try {
    polozky = JSON.parse(polozkyRaw)
  } catch {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Vyplňte alespoň jednu přijatou položku.')}`)
  }

  if (!Array.isArray(polozky) || polozky.length === 0) {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Vyplňte alespoň jednu přijatou položku.')}`)
  }

  const { data, error } = await supabase.rpc('zapsat_prijem_zbozi', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_objednavka: objednavkaId || null,
    p_faktura_id: fakturaId,
    p_prijal: null,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error) {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Příjem se nepodařilo zapsat.')}`)
  }

  const upozorneni = (data ?? []).some((r: { prekrocene_mnozstvi: boolean; jina_cena: boolean }) => r.prekrocene_mnozstvi || r.jina_cena)

  revalidatePath(`/${rozsah}/finance/nakup/${objednavkaId}`)
  redirect(`/${rozsah}/finance/nakup/${objednavkaId}${upozorneni ? '?upozorneni=1' : '?prijato=1'}`)
}
