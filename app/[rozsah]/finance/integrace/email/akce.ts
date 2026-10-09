'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { zasifrovat } from '@/lib/integrace-klice'
import { overitPripojeniImap } from '@/lib/integrace-mail-imap'
import type { ZabezpeceniImap } from '@/lib/integrace-mail-imap-moznosti'
import { upravitNastaveni, type ZmenaPrijmu } from '@/lib/faktury-prijem-typy'
import { zapsatNavrhy, zpracovatPrijem } from '@/lib/faktury-prijem-sync'

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

/* ---------------------------------------------------------------------
 * Příjem faktur ze schránky (lib/faktury-prijem-*.ts).
 *
 * Zapisuje do Faktur, takže kromě `integrace.manage` chce i
 * `faktury.manage` za celou firmu. Schránka se vždy dohledá uživatelským
 * klientem s `tenant_id` — cizí id z formuláře nic nenajde. Samotný běh
 * (`zpracovatPrijem`) jde přes službu; sem se pustí až po té kontrole.
 * ------------------------------------------------------------------ */

function zpet(rozsah: string, parametr: 'chyba' | 'zprava', text: string): never {
  redirect(`/${rozsah}/finance/integrace/email?${parametr}=${encodeURIComponent(text)}`)
}

async function pripravitPrijem(rozsah: string, id: string) {
  const { supabase, tenantId } = await pripravit(rozsah)
  const faktury = await zkusPristup(tenantId, 'faktury.manage', TENANT_SCOPE_SEGMENT)
  if (faktury.stav !== 'ok') zpet(rozsah, 'chyba', 'Příjem faktur nastavuje ten, kdo smí spravovat Faktury za celou firmu.')

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'email_dokladu')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) zpet(rozsah, 'chyba', 'Schránka neexistuje nebo je odpojená.')

  return { supabase, tenantId, pripojeni }
}

const ZMENY: Record<string, (od: string) => ZmenaPrijmu> = {
  zapnout_ai: (od) => ({ akce: 'zapnout', ai: true, od }),
  zapnout_bez_ai: (od) => ({ akce: 'zapnout', ai: false, od }),
  vypnout: () => ({ akce: 'vypnout' }),
  ai_zapnout: () => ({ akce: 'ai', povoleno: true }),
  ai_vypnout: () => ({ akce: 'ai', povoleno: false }),
  rezim_nahled: () => ({ akce: 'rezim', rezim: 'nahled' }),
  rezim_automaticky: () => ({ akce: 'rezim', rezim: 'automaticky' }),
  od: (od) => ({ akce: 'od', od }),
}

export async function nastavitPrijemFaktur(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const akce = String(formData.get('akce') ?? '')
  const od = String(formData.get('od') ?? '').trim()

  const { supabase, pripojeni } = await pripravitPrijem(rozsah, id)
  const vyrobit = Object.hasOwn(ZMENY, akce) ? ZMENY[akce] : null
  if (!vyrobit) zpet(rozsah, 'chyba', 'Neznámá změna nastavení.')

  const ucet = (pripojeni.externi_ucet ?? {}) as Record<string, unknown>
  const nove = upravitNastaveni(ucet.prijem_dokladu, vyrobit(od), {
    // Kdo a kdy souhlasil s AI zapíše databázová funkce sama podle přihlášení.
    kdo: '',
    kdy: '',
    dnes: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date()),
  })
  if (!nove) zpet(rozsah, 'chyba', '„Číst od" musí být skutečné datum, nejpozději dnes.')

  // Přímý zápis do `externi_ucet.prijem_dokladu` databáze odmítne (pojistka
  // v migraci 20261008100000) — jen tahle funkce, která ověří integrace.manage
  // i faktury.manage (schránku jsme výš dohledali s tenant_id firmy).
  const { error } = await supabase.rpc('faktury_prijem_nastavit', { p_pripojeni: pripojeni.id, p_nastaveni: nove })
  if (error) zpet(rozsah, 'chyba', 'Nastavení příjmu se nepodařilo uložit.')

  revalidatePath(`/${rozsah}/finance/integrace/email`)
  zpet(rozsah, 'zprava', nove.zapnuto
    ? 'Uloženo. Appka schránku projde při nejbližším běhu (každých 30 minut) — nebo klikněte na „Zpracovat teď".'
    : 'Příjem faktur z téhle schránky je vypnutý.')
}

/** Jeden běh hned teď (jinak běží úloha každých 30 minut). Stránka má maxDuration 60 s. */
export async function spustitPrijemTed(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { pripojeni } = await pripravitPrijem(rozsah, id)

  const v = await zpracovatPrijem(pripojeni.id, { konecMs: Date.now() + 45_000 })
  revalidatePath(`/${rozsah}/finance/integrace/email`)
  if (v.stav !== 'ok') zpet(rozsah, 'chyba', v.duvod ?? 'Příjem faktur se nepodařilo spustit.')

  const casti = [`Hotovo: ${v.nalezeno} nových příloh, zapsáno ${v.zapsano}, už ve Fakturách ${v.existuje}, ke kontrole ${v.kontrola}.`]
  if (v.zbyva > 0 || !v.schrankaDoctena) casti.push('Další část se zpracuje v příštím běhu automaticky.')
  if (v.duvod) casti.push(`Pozor: ${v.duvod}`)
  zpet(rozsah, 'zprava', casti.join(' '))
}

/** Režim náhled: člověk potvrdil návrhy — zapsat je do Faktur. */
export async function zapsatNavrhyAkce(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { tenantId, pripojeni } = await pripravitPrijem(rozsah, id)

  const r = await zapsatNavrhy(pripojeni.id, tenantId, Date.now() + 45_000)
  revalidatePath(`/${rozsah}/finance/integrace/email`)
  if (r.duvod) zpet(rozsah, 'chyba', r.duvod)
  const casti = [`Zapsáno do Faktur: ${r.zapsano}.`]
  if (r.chyby > 0) casti.push(`Nepodařilo se: ${r.chyby} — zkuste to znovu.`)
  if (r.zbyva > 0) casti.push(`Zbývá ${r.zbyva} — klikněte znovu.`)
  zpet(rozsah, r.chyby > 0 ? 'chyba' : 'zprava', casti.join(' '))
}
