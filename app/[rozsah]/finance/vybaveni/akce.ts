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
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/vybaveni`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

export async function zalozitVybaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (!nazev) {
    redirect(`/${rozsah}/finance/vybaveni?chyba=${encodeURIComponent('Vyplňte název.')}`)
  }

  const cenaRaw = nepovinnePole(formData, 'cena')
  const cena = cenaRaw ? naHalere(cenaRaw) : null

  const { error } = await supabase.from('vybaveni').insert({
    tenant_id: tenantId,
    branch_id: nepovinnePole(formData, 'branch_id'),
    nazev,
    kategorie: nepovinnePole(formData, 'kategorie') ?? '',
    datum_porizeni: nepovinnePole(formData, 'datum_porizeni'),
    cena_haleru: cena,
    zaruka_do: nepovinnePole(formData, 'zaruka_do'),
    servis_dalsi_kdy: nepovinnePole(formData, 'servis_dalsi_kdy'),
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
  })

  if (error) {
    redirect(`/${rozsah}/finance/vybaveni?chyba=${encodeURIComponent('Vybavení se nepodařilo uložit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/vybaveni`)
  redirect(`/${rozsah}/finance/vybaveni`)
}

export async function smazatVybaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  await supabase.from('vybaveni').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/vybaveni`)
  redirect(`/${rozsah}/finance/vybaveni`)
}
