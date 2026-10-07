'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { zasifrovat } from '@/lib/integrace-klice'
import { overitPripojeniImap, type ZabezpeceniImap } from '@/lib/integrace-mail-imap'

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'integrace.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/integrace/email`)

  return { supabase: await getServerSupabase(), tenantId }
}

/**
 * Připojení e-mailové schránky přes IMAP. Appka PŘED uložením živě
 * ověří přihlašovací údaje (`overitPripojeniImap` — přihlásí se, vybere
 * INBOX, nic nestáhne) — stejný vzor jako `pripojitFioUcet`. Appka
 * nikdy neuloží „připojeno" bez ověřeného přístupu.
 *
 * Host/port/zabezpečení/jméno appka ukládá do `externi_ucet` (nejsou
 * sama o sobě tajemství — e-mailová adresa je typicky veřejná),
 * HESLO appka zašifruje a uloží výhradně přes `integrace_uloz_tajemstvi`.
 */
export async function pripojitEmailSchranku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const host = String(formData.get('host') ?? '').trim()
  const portRaw = String(formData.get('port') ?? '').trim()
  const zabezpeceni = String(formData.get('zabezpeceni') ?? 'tls') as ZabezpeceniImap
  const uzivatel = String(formData.get('uzivatel') ?? '').trim()
  const heslo = String(formData.get('heslo') ?? '')

  const { supabase, tenantId } = await pripravit(rozsah)

  const port = Number(portRaw)
  if (!host || !Number.isFinite(port) || port <= 0 || !uzivatel || !heslo || !['tls', 'starttls'].includes(zabezpeceni)) {
    redirect(`/${rozsah}/finance/integrace/email?chyba=${encodeURIComponent('Vyplňte server, port, zabezpečení, jméno a heslo.')}`)
  }

  const overeni = await overitPripojeniImap({ host, port, zabezpeceni, uzivatel, heslo })
  if (overeni.stav === 'chyba') {
    redirect(`/${rozsah}/finance/integrace/email?chyba=${encodeURIComponent(`Připojení se nepodařilo ověřit: ${overeni.duvod}`)}`)
  }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .insert({
      tenant_id: tenantId,
      oblast: 'email_dokladu',
      poskytovatel: 'imap',
      rezim: 'zakaznicky',
      nazev: nazev || uzivatel,
      stav: 'pripojeno',
      externi_ucet: { host, port, zabezpeceni, uzivatel, pocet_slozek: overeni.slozky.length },
      capabilities: { cteni: true, zapis: false, inkrementalni_sync: false, stazeni_dokladu: false },
      posledni_test_kdy: new Date().toISOString(),
      posledni_test_ok: true,
    })
    .select('id')
    .single()

  if (chybaPripojeni || !pripojeni) {
    redirect(`/${rozsah}/finance/integrace/email?chyba=${encodeURIComponent('Připojení se nepodařilo založit.')}`)
  }

  const { sifra, otisk } = zasifrovat({ heslo })
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeni.id, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) {
    redirect(`/${rozsah}/finance/integrace/email?chyba=${encodeURIComponent('Připojení se založilo, ale heslo se neuložilo — zkuste to znovu.')}`)
  }

  revalidatePath(`/${rozsah}/finance/integrace/email`)
  redirect(`/${rozsah}/finance/integrace/email`)
}

export async function odpojitEmailSchranku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { error: chybaSmazani } = await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: id })
  if (chybaSmazani) {
    redirect(`/${rozsah}/finance/integrace/email?chyba=${encodeURIComponent('Odpojení se nepodařilo.')}`)
  }

  await supabase.from('integrace_pripojeni').update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/integrace/email`)
  redirect(`/${rozsah}/finance/integrace/email`)
}
