'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/** Stejný tvar jako app/[rozsah]/finance/faktury/akce.ts — jen hlavní DB, ne Faktury. */
async function pripravit(rozsah: string, pravo: 'finance.read' | 'finance.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/kontakty`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

export async function zalozitKontakt(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (!nazev) {
    redirect(`/${rozsah}/finance/kontakty?chyba=${encodeURIComponent('Vyplňte název.')}`)
  }

  const platebniPodminkyRaw = nepovinnePole(formData, 'platebni_podminky_dni')
  const platebniPodminky = platebniPodminkyRaw ? Number(platebniPodminkyRaw) : null

  const { error } = await supabase.from('kontakty').insert({
    tenant_id: tenantId,
    nazev,
    ico: nepovinnePole(formData, 'ico'),
    dic: nepovinnePole(formData, 'dic'),
    je_dodavatel: formData.get('je_dodavatel') === 'on',
    je_odberatel: formData.get('je_odberatel') === 'on',
    je_partner: formData.get('je_partner') === 'on',
    platebni_podminky_dni: platebniPodminky !== null && !Number.isNaN(platebniPodminky) ? platebniPodminky : null,
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
  })

  if (error) {
    const zprava = error.code === '23505' ? 'Kontakt se stejným názvem už existuje.' : 'Uložení se nepodařilo.'
    redirect(`/${rozsah}/finance/kontakty?chyba=${encodeURIComponent(zprava)}`)
  }

  revalidatePath(`/${rozsah}/finance/kontakty`)
  redirect(`/${rozsah}/finance/kontakty`)
}

export async function smazatKontakt(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  await supabase
    .from('kontakty')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/kontakty`)
  redirect(`/${rozsah}/finance/kontakty`)
}
