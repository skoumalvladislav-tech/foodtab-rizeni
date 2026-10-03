'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { naHalere } from '@/lib/mzdy'

async function pripravit(rozsah: string, pravo: 'finance.read' | 'finance.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/platby`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

export async function zalozitPlatebniUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const nazev = String(formData.get('nazev') ?? '').trim()
  const typ = String(formData.get('typ') ?? '')
  if (!nazev || !['banka', 'pokladna', 'karta'].includes(typ)) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte název a typ účtu.')}`)
  }

  const branchId = nepovinnePole(formData, 'branch_id')

  const { error } = await supabase.from('platebni_ucty').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    nazev,
    typ,
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Účet se nepodařilo uložit.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

export async function zapsatTransakci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const ucetId = String(formData.get('ucet_id') ?? '')
  const smer = String(formData.get('smer') ?? '')
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const datum = String(formData.get('datum') ?? '')

  if (!ucetId || !['prijem', 'vydaj'].includes(smer) || castka === null || castka <= 0 || !datum) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte účet, směr, částku a datum.')}`)
  }

  const { error } = await supabase.from('transakce').insert({
    tenant_id: tenantId,
    ucet_id: ucetId,
    smer,
    castka_haleru: castka,
    datum,
    protistrana: nepovinnePole(formData, 'protistrana') ?? '',
    vs: nepovinnePole(formData, 'vs') ?? '',
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
    zdroj: 'rucni',
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Platbu se nepodařilo zapsat.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

/**
 * Potvrzení návrhu párování — vždy lidský klik, nikdy automaticky
 * (zadání, oddíl 5). Zapíše se tady (platby_faktury.stav='potvrzeno')
 * a best-effort se přepíše `invoices.status` v DB Faktur; když druhý
 * zápis selže, zůstává to vidět jako nesoulad k dohledání, ne tiše
 * ztracené — proto se chyba druhého zápisu nehlásí jako pád akce.
 */
export async function potvrditParovani(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const transakceId = String(formData.get('transakce_id') ?? '')
  const fakturaId = String(formData.get('faktura_id') ?? '')
  const castkaHaleru = Number(formData.get('castka_haleru') ?? 0)
  const jistota = Number(formData.get('jistota') ?? 0)

  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const { error } = await supabase.from('platby_faktury').insert({
    tenant_id: tenantId,
    transakce_id: transakceId,
    faktura_id: fakturaId,
    castka_haleru: castkaHaleru,
    jistota,
    stav: 'potvrzeno',
    potvrzeno_kdy: new Date().toISOString(),
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Párování se nepodařilo uložit.')}`)

  try {
    const faktury = getFakturySupabase()
    await faktury.from('invoices').update({ status: 'Uhrazeno' }).eq('id', fakturaId).eq('tenant_id', tenantId)
  } catch {
    // Best-effort — viz komentář funkce. Nesoulad zůstává dohledatelný
    // přímo ve Fakturách (stav tam neodpovídá platby_faktury tady).
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}
