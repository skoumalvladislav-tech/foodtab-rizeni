'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { zasifrovat } from '@/lib/integrace-klice'

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'integrace.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/integrace`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

/**
 * Nové připojení k poskytovateli. Stav zůstává výchozí `nepripojeno` —
 * appka ho nikdy nenastaví na `pripojeno` sama, dokud nic neověřila
 * (zadání, oddíl 2). Klíč/token (jen u `rezim='zakaznicky'`) se
 * zašifruje a uloží přes RPC, nikdy přímo do `integrace_pripojeni`.
 */
export async function zalozitPripojeni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const oblast = String(formData.get('oblast') ?? '')
  const poskytovatel = String(formData.get('poskytovatel') ?? '').trim()
  const rezim = String(formData.get('rezim') ?? '')
  const nazev = nepovinnePole(formData, 'nazev') ?? poskytovatel

  // Banka má od bankovního modulu (20261004100000) VLASTNÍ obrazovku
  // s živým ověřením (Fio) — tenhle obecný formulář jen zaregistruje
  // záznam BEZ jakéhokoli připojení, což u banky působilo, jako by se
  // appka pokusila připojit a nic se nestalo (nález 4. 10. 2026).
  if (oblast === 'banka') {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Bankovní účet se připojuje na týhle stránce (Fio) nebo čeká na Enable Banking u ostatních bank — ne přes obecný formulář.')}`)
  }

  if (!['pokladna', 'ucetnictvi', 'email_dokladu'].includes(oblast) || !poskytovatel || !['zakaznicky', 'csv', 'demo'].includes(rezim)) {
    redirect(`/${rozsah}/finance/integrace?chyba=${encodeURIComponent('Vyplňte oblast, poskytovatele a režim.')}`)
  }

  const { data: pripojeni, error } = await supabase
    .from('integrace_pripojeni')
    .insert({ tenant_id: tenantId, oblast, poskytovatel, rezim, nazev })
    .select('id')
    .single()

  if (error || !pripojeni) {
    const zprava = error?.code === '23505' ? 'Tahle oblast a poskytovatel už mají živé připojení.' : 'Připojení se nepodařilo založit.'
    redirect(`/${rozsah}/finance/integrace?chyba=${encodeURIComponent(zprava)}`)
  }

  const klic = nepovinnePole(formData, 'klic')
  if (rezim === 'zakaznicky' && klic) {
    const { sifra, otisk } = zasifrovat({ klic })
    const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', {
      p_pripojeni: pripojeni.id,
      p_sifra: sifra,
      p_otisk: otisk,
    })
    if (chybaKlice) {
      redirect(`/${rozsah}/finance/integrace?chyba=${encodeURIComponent('Připojení se založilo, ale klíč se neuložil — zkuste ho vyplnit znovu.')}`)
    }
  }

  revalidatePath(`/${rozsah}/finance/integrace`)
  redirect(`/${rozsah}/finance/integrace`)
}

/** Odpojení — tajemství se doopravdy smaže (RPC), řádek připojení zůstává (historie, kdy a co skončilo). */
export async function odpojitPripojeni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { error: chybaSmazani } = await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: id })
  if (chybaSmazani) {
    redirect(`/${rozsah}/finance/integrace?chyba=${encodeURIComponent('Odpojení se nepodařilo.')}`)
  }

  await supabase
    .from('integrace_pripojeni')
    .update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/integrace`)
  redirect(`/${rozsah}/finance/integrace`)
}
