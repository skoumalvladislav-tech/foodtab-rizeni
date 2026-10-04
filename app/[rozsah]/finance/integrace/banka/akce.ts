'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { zasifrovat } from '@/lib/integrace-klice'
import { overitPripojeniFio } from '@/lib/integrace-fio'
import { synchronizovatFioPripojeni } from '@/lib/integrace-fio-sync'

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/integrace/banka`)

  return { supabase: await getServerSupabase(), tenantId }
}

/**
 * Připojení Fio účtu. Token se PŘED uložením ověří živým voláním Fio
 * API (zadání §2: appka nikdy nenahlásí „připojeno" bez ověřeného
 * přístupu) — teprve po úspěšném ověření appka připojení založí,
 * token zašifruje a uloží první zůstatkový snapshot. Neúspěšné
 * ověření nezaloží nic polorozbitého.
 */
export async function pripojitFioUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const platebniUcetId = String(formData.get('platebni_ucet_id') ?? '')
  const token = String(formData.get('token') ?? '').trim()
  const nazev = String(formData.get('nazev') ?? '').trim()

  const { supabase, tenantId } = await pripravit(rozsah)

  if (!platebniUcetId || !token) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Vyberte platební účet a vyplňte token.')}`)
  }

  const overeni = await overitPripojeniFio(token)
  if (overeni.stav === 'chyba') {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(`Token se nepodařilo ověřit: ${overeni.duvod}`)}`)
  }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .insert({
      tenant_id: tenantId,
      oblast: 'banka',
      poskytovatel: `fio-${crypto.randomUUID().slice(0, 8)}`,
      rezim: 'zakaznicky',
      nazev: nazev || `Fio — ${overeni.info.cisloUctu}`,
      platebni_ucet_id: platebniUcetId,
      stav: 'pripojeno',
      externi_ucet: { cislo_uctu: overeni.info.cisloUctu, kod_banky: overeni.info.kodBanky, mena: overeni.info.mena },
      capabilities: { cteni: true, zapis: false, inkrementalni_sync: true, firemni_ucty: true },
      posledni_test_kdy: new Date().toISOString(),
      posledni_test_ok: true,
    })
    .select('id')
    .single()

  if (chybaPripojeni || !pripojeni) {
    const zprava = chybaPripojeni?.code === '23505' ? 'Tahle oblast a poskytovatel už mají živé připojení.' : 'Připojení se nepodařilo založit.'
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(zprava)}`)
  }

  const { sifra, otisk } = zasifrovat({ token })
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeni.id, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Připojení se založilo, ale token se neuložil — zkuste to znovu.')}`)
  }

  await supabase.from('bankovni_zustatky').insert({
    tenant_id: tenantId,
    platebni_ucet_id: platebniUcetId,
    typ: 'knihovni',
    castka_haleru: overeni.info.zustatekHaleru,
    mena: overeni.info.mena,
    platny_k: new Date().toISOString(),
    zdroj: 'fio_api',
    integrace_pripojeni_id: pripojeni.id,
  })

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka`)
}

/** Manuální synchronizace — STEJNÁ cesta jako naplánovaná úloha (lib/integrace-fio-sync.ts), jen spuštěná z tlačítka po ověření finance.manage. */
export async function synchronizovatTeto(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pripojeniId = String(formData.get('pripojeni_id') ?? '')

  await pripravit(rozsah)

  const vysledek = await synchronizovatFioPripojeni(pripojeniId)

  const parametr = vysledek.stav === 'ok'
    ? `synchronizovano=${vysledek.pocetNovychRadku}`
    : `chyba=${encodeURIComponent(vysledek.duvod)}`

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka?${parametr}`)
}

export async function odpojitBankovniUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { error: chybaSmazani } = await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: id })
  if (chybaSmazani) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Odpojení se nepodařilo.')}`)
  }

  await supabase.from('integrace_pripojeni').update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka`)
}
