'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { zasifrovat } from '@/lib/integrace-klice'
import { overitPripojeniFio } from '@/lib/integrace-fio'
import { synchronizovatFioPripojeni } from '@/lib/integrace-fio-sync'
import { enableBankingProvider } from '@/lib/integrace-enablebanking'
import { zahajitPripojeniSaltEdge, odvolatSouhlasSaltEdge } from '@/lib/integrace-saltedge'

/**
 * Stejný vzor jako `zakladniAdresa` v nastaveni/lide/akce.ts (pozvánky
 * e-mailem) — zdvojené schválně, ne přes import: jiný modul (pravidlo
 * „do cizího modulu nesahej"), tady navíc jde o absolutní adresu pro
 * CIZÍ server (Enable Banking musí znát přesný návrat), ne jen o
 * odkaz do e-mailu.
 */
async function zakladniAdresa(): Promise<string> {
  const nastavena = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (nastavena) return nastavena.replace(/\/+$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protokol = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protokol}://${host}`
}

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'integrace.manage', rozsah)
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
/** Prázdné/nulové/záporné → appka žádný vlastní odstup nevynucuje (NULL, ne 0 — 0 minut by znamenalo „pokaždé", což appka nikdy nedomýšlí sama). */
function intervalSynchronizaceZFormulare(formData: FormData): number | null {
  const text = String(formData.get('interval_synchronizace_minut') ?? '').trim()
  if (!text) return null
  const cislo = Number(text)
  return Number.isFinite(cislo) && cislo > 0 ? Math.round(cislo) : null
}

export async function pripojitFioUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const platebniUcetId = String(formData.get('platebni_ucet_id') ?? '')
  const token = String(formData.get('token') ?? '').trim()
  const nazev = String(formData.get('nazev') ?? '').trim()
  const intervalSynchronizaceMinut = intervalSynchronizaceZFormulare(formData)

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
      // Čistá hodnota — žádná náhodná přípona. Jedinečnost živého
      // bankovního připojení od 7.10.2026 hlídá `platebni_ucet_id`
      // (index integrace_pripojeni_banka_jeden_ucet), ne tenhle sloupec.
      poskytovatel: 'fio',
      rezim: 'zakaznicky',
      nazev: nazev || `Fio — ${overeni.info.cisloUctu}`,
      platebni_ucet_id: platebniUcetId,
      stav: 'pripojeno',
      externi_ucet: { cislo_uctu: overeni.info.cisloUctu, kod_banky: overeni.info.kodBanky, mena: overeni.info.mena },
      capabilities: { cteni: true, zapis: false, inkrementalni_sync: true, firemni_ucty: true },
      posledni_test_kdy: new Date().toISOString(),
      posledni_test_ok: true,
      interval_synchronizace_minut: intervalSynchronizaceMinut,
    })
    .select('id')
    .single()

  if (chybaPripojeni || !pripojeni) {
    const zprava = chybaPripojeni?.code === '23505' ? 'Tenhle platební účet už má živé bankovní připojení.' : 'Připojení se nepodařilo založit.'
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

/**
 * Zahájení souhlasu u Enable Banking (KB/ČSOB/ČS/Raiffeisenbank).
 *
 * Appka NEJDŘÍV založí `integrace_pripojeni` se stavem `pripojuje_se`
 * (appka tenhle stav má v CHECKu od P0, jen ho dřív nikdo nenastavoval)
 * — teprve JEHO id appka vloží do návratové adresy, aby po návratu
 * z banky poznala, který rozjetý pokus dokončuje. Nic se nehlásí jako
 * „připojeno", dokud se appka nevrátí z banky s potvrzeným souhlasem
 * (zadání §2).
 */
export async function zahajitPripojeniEnableBanking(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const platebniUcetId = String(formData.get('platebni_ucet_id') ?? '')
  const aspspNazev = String(formData.get('aspsp_nazev') ?? '').trim()

  const { supabase, tenantId } = await pripravit(rozsah)

  if (!platebniUcetId || !aspspNazev) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Vyberte platební účet a banku.')}`)
  }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .insert({
      tenant_id: tenantId,
      oblast: 'banka',
      poskytovatel: 'enablebanking',
      rezim: 'zakaznicky',
      nazev: `${aspspNazev} (Enable Banking)`,
      platebni_ucet_id: platebniUcetId,
      stav: 'pripojuje_se',
      externi_ucet: { aspsp: aspspNazev },
      capabilities: { cteni: true, zapis: false, inkrementalni_sync: false, firemni_ucty: true },
    })
    .select('id')
    .single()

  if (chybaPripojeni || !pripojeni) {
    const zprava = chybaPripojeni?.code === '23505' ? 'Tenhle platební účet už má živé bankovní připojení.' : 'Připojení se nepodařilo založit.'
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(zprava)}`)
  }

  const zaklad = await zakladniAdresa()
  const navratovaAdresa = `${zaklad}/api/integrace/enablebanking/vratit?pripojeni=${pripojeni.id}&rozsah=${encodeURIComponent(rozsah)}`

  const vysledek = await enableBankingProvider.zahajitPripojeni!(navratovaAdresa, aspspNazev)
  if (vysledek.stav === 'chyba') {
    // Rozjetý pokus se neschovává — zůstane vidět jako `chyba`, ne tiše zmizí.
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: vysledek.duvod }).eq('id', pripojeni.id)
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(vysledek.duvod)}`)
  }

  redirect(vysledek.presmerovatNa)
}

/**
 * Zahájení souhlasu u Salt Edge (rozhodnutí Šéfíka 7.10.2026, hlavní
 * bankovní agregátor). Appka založí `integrace_pripojeni` se stavem
 * `pripojuje_se`, STEJNĖ jako u Enable Banking — ale AUTORITATIVNÍ
 * potvrzení `stav='pripojeno'` tady nezapisuje návrat z banky
 * (`/api/integrace/saltedge/vratit`, nepodepsaný), zapisuje ho
 * výhradně podepsaný webhook (`/api/integrace/saltedge/webhook`,
 * dokumentace: „správa připojení je asynchronní"). Appka páruje
 * webhook s tímhle připojením přes `tenant_id` (Salt Edge `customer_id`)
 * + `stav='pripojuje_se'`, ne přes id v URL — Salt Edge žádné appčino
 * id v redirectu nezaručuje.
 */
export async function zahajitPripojeniSaltEdgeAkce(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const platebniUcetId = String(formData.get('platebni_ucet_id') ?? '')
  // Appka kóduje banku jako "kod::nazev" v jedné hodnotě <select> — appka
  // je čistý server komponent (žádný klientský JS), tohle je nejlevnější
  // způsob, jak formulář bez JS pošle appce oboje najednou.
  const [providerCode, nazevBanky] = String(formData.get('provider') ?? '').split('::')

  const { supabase, tenantId } = await pripravit(rozsah)

  if (!platebniUcetId || !providerCode) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Vyberte platební účet a banku.')}`)
  }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .insert({
      tenant_id: tenantId,
      oblast: 'banka',
      poskytovatel: 'saltedge',
      rezim: 'zakaznicky',
      nazev: nazevBanky ? `${nazevBanky} (Salt Edge)` : 'Salt Edge',
      platebni_ucet_id: platebniUcetId,
      stav: 'pripojuje_se',
      externi_ucet: { provider_code: providerCode, nazev_banky: nazevBanky },
      capabilities: { cteni: true, zapis: false, inkrementalni_sync: true, firemni_ucty: true },
    })
    .select('id')
    .single()

  if (chybaPripojeni || !pripojeni) {
    const zprava = chybaPripojeni?.code === '23505' ? 'Tenhle platební účet už má živé bankovní připojení.' : 'Připojení se nepodařilo založit.'
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(zprava)}`)
  }

  const zaklad = await zakladniAdresa()
  const navratovaAdresa = `${zaklad}/api/integrace/saltedge/vratit?rozsah=${encodeURIComponent(rozsah)}`

  const vysledek = await zahajitPripojeniSaltEdge(navratovaAdresa, tenantId, providerCode)
  if (vysledek.stav === 'chyba') {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: vysledek.duvod }).eq('id', pripojeni.id)
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(vysledek.duvod)}`)
  }

  redirect(vysledek.presmerovatNa)
}

/**
 * Výběr konkrétního účtu u Salt Edge PO dokončeném souhlasu — appka
 * jedno `connection_id` (od banky) může vracet víc účtů, appka si
 * nevybírá sama, nechá to na klientovi (zadání §2: „průvodce...
 * výběr zdrojů"). `account_id` appka doplní do `externi_ucet`, teprve
 * od té chvíle ví synchronizační job, který konkrétní účet stahovat.
 */
export async function vybratUcetSaltEdge(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const accountId = String(formData.get('account_id') ?? '').trim()

  const { supabase, tenantId } = await pripravit(rozsah)

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('stav', 'pripojeno')
    .maybeSingle()

  if (!pripojeni || !accountId) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Připojení nepatří vaší firmě, nebo účet nebyl vybrán.')}`)
  }

  await supabase
    .from('integrace_pripojeni')
    .update({ externi_ucet: { ...(pripojeni.externi_ucet as Record<string, unknown>), account_id: accountId } })
    .eq('id', id)

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka`)
}

/**
 * Manuální synchronizace — STEJNÁ cesta jako naplánovaná úloha
 * (lib/integrace-fio-sync.ts), jen spuštěná z tlačítka po ověření
 * integrace.manage. `synchronizovatFioPripojeni` běží přes
 * `service_role` (sdílí kód s cron úlohou, která nemá session) a
 * dohledá připojení jen podle `id` — BEZ týhle kontroly by
 * `integrace.manage` ve VLASTNÍ firmě stačilo k vyvolání synchronizace
 * CIZÍHO připojení, kdyby volající znal nebo uhodl jeho UUID.
 */
export async function synchronizovatTeto(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pripojeniId = String(formData.get('pripojeni_id') ?? '')

  const { supabase, tenantId } = await pripravit(rozsah)

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id')
    .eq('id', pripojeniId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!pripojeni) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Připojení nepatří vaší firmě nebo neexistuje.')}`)
  }

  const vysledek = await synchronizovatFioPripojeni(pripojeniId)

  const parametr = vysledek.stav === 'ok'
    ? `synchronizovano=${vysledek.pocetNovychRadku}`
    : `chyba=${encodeURIComponent(vysledek.duvod)}`

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka?${parametr}`)
}

/**
 * Změna vlastního odstupu synchronizace existujícího připojení (zadání
 * §2) — appka ho nenastavuje jen jednou při vzniku, klient si ho může
 * kdykoli rozmyslet. Prázdné pole = appka se vrátí k tomu, že si žádný
 * vlastní odstup nevynucuje (řídí se jen frekvencí naplánované úlohy).
 */
export async function upravitIntervalSynchronizace(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const intervalSynchronizaceMinut = intervalSynchronizaceZFormulare(formData)

  const { supabase, tenantId } = await pripravit(rozsah)

  const { error } = await supabase
    .from('integrace_pripojeni')
    .update({ interval_synchronizace_minut: intervalSynchronizaceMinut })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Interval se nepodařilo uložit.')}`)

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka`)
}

/**
 * Odpojení — u Salt Edge appka NEJDŘÍV odvolá souhlas u poskytovatele
 * (`odvolatSouhlasSaltEdge`, zadání §6: „bezpečně zpracuj... odvolání
 * souhlasu") a TEPRVE PAK smaže lokální tajemství. Chybu při odvolání
 * appka appka nahlásí, ne tiše pokračuje — odpojení v appce bez
 * odvolání u banky by nechalo souhlas živý na druhé straně.
 */
export async function odpojitBankovniUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('poskytovatel, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (pripojeni?.poskytovatel === 'saltedge') {
    const consentId = (pripojeni.externi_ucet as Record<string, unknown> | null)?.consent_id as string | undefined
    if (consentId) {
      const vysledek = await odvolatSouhlasSaltEdge(consentId)
      if (vysledek.stav === 'chyba') {
        redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent(`Odvolání souhlasu u Salt Edge se nepodařilo: ${vysledek.duvod}`)}`)
      }
    }
  }

  const { error: chybaSmazani } = await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: id })
  if (chybaSmazani) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Odpojení se nepodařilo.')}`)
  }

  await supabase.from('integrace_pripojeni').update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/finance/integrace/banka`)
  redirect(`/${rozsah}/finance/integrace/banka`)
}
