'use server'

import { randomUUID } from 'node:crypto'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { rozsifrovat, zasifrovat } from '@/lib/integrace-klice'
import { overitPripojeniFio } from '@/lib/integrace-fio'
import { synchronizovatFioPripojeni } from '@/lib/integrace-fio-sync'
import { synchronizovatSaltEdgePripojeni } from '@/lib/integrace-saltedge-sync'
import { synchronizovatPodlePoskytovatele } from '@/lib/banka-synchronizace'
import { enableBankingProvider } from '@/lib/integrace-enablebanking'
import { zahajitPripojeniSaltEdge, odvolatSouhlasSaltEdge } from '@/lib/integrace-saltedge'
import { adresaAutorizace, adresaRegistrace, konfiguraceKb, novyKlicSifrovani, type ExterniUcetKb, type TajemstviKb } from '@/lib/kb-adaa'
import { synchronizovatKbPripojeni } from '@/lib/kb-adaa-sync'
import { vytvoritStavKb } from '@/lib/kb-adaa-stav'
import { ucetKbJinde } from '@/lib/kb-adaa-ucty'

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

/**
 * Všechny akce banky jdou přes tohle — a právo se ptá VŽDY za celou
 * firmu, ne za rozsah z formuláře (Finance po pobočkách, 13. 10. 2026).
 *
 * Do té doby stačilo `integrace.manage` v jedné pobočce: správce
 * napojení Bernard Baru si poslal formulář s `rozsah=bernard-bar`
 * a mohl připojit, odpojit nebo „Synchronizovat teď" bankovní připojení
 * celé firmy — synchronizace přitom jede přes `service_role`
 * (lib/integrace-fio-sync.ts), takže ji RLS nezastaví. Bankovní účty
 * založené v appce jsou dnes všechny firemní (bez pobočky).
 * `rozsah` zůstává jen pro návratovou adresu.
 */
async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  // ROZHODNOUT: má správce napojení jedné pobočky smět připojit banku
  // k platebnímu účtu SVÉ pobočky? Zatím ne (opatrnější varianta) — šlo
  // by to až s kontrolou `platebni_ucty.branch_id` proti rozsahu.
  const pristup = await zkusPristup(tenantId, 'integrace.manage', TENANT_SCOPE_SEGMENT)
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
    .select('id, poskytovatel')
    .eq('id', pripojeniId)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'banka')
    .maybeSingle()
  if (!pripojeni) {
    redirect(`/${rozsah}/finance/integrace/banka?chyba=${encodeURIComponent('Připojení nepatří vaší firmě nebo neexistuje.')}`)
  }

  // Podle poskytovatele, ne vždy Fio — viz lib/banka-synchronizace.ts (nález 11. 10. 2026).
  const vysledek = await synchronizovatPodlePoskytovatele(
    { id: pripojeni.id as string, poskytovatel: pripojeni.poskytovatel as string },
    { fio: synchronizovatFioPripojeni, saltedge: synchronizovatSaltEdgePripojeni, kb_adaa: synchronizovatKbPripojeni },
  )

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

// ---------------------------------------------------------------------
// Komerční banka — přímé napojení (ADAA). Rozhodnutí Šéfíka 11. 10. 2026.
// Tok a adresy: lib/kb-adaa.ts. Návraty z KB: app/api/integrace/kb/*.
// ---------------------------------------------------------------------

function cestaBanky(rozsah: string, parametry?: Record<string, string>): string {
  return `/${rozsah}/finance/integrace/banka${parametry ? `?${new URLSearchParams(parametry)}` : ''}`
}

/** `historie_od` z formuláře: platné datum v posledních 2 letech, ne v budoucnu; prázdné = 1. 1. letošního roku. */
function historieOdZFormulare(formData: FormData): string | null {
  const dnes = new Date().toISOString().slice(0, 10)
  const text = String(formData.get('historie_od') ?? '').trim()
  if (!text) return `${dnes.slice(0, 4)}-01-01`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return null
  const nejstarsi = new Date(Date.now() - 728 * 86_400_000).toISOString().slice(0, 10)
  if (text > dnes) return null
  // Starší než 2 roky KB nevrátí — zkrátit, ne odmítnout (u „Dokončit
  // připojení v KB" se datum posílá skryté a stárne).
  return text < nejstarsi ? nejstarsi : text
}

/**
 * „Připojit Komerční banku": připojení ve stavu „Připojuje se…",
 * zašifrovaný klíč pro odpověď registrace a přesměrování do KB, kde se
 * klient přihlásí KB Klíčem a vybere účty. Návrat:
 * `/api/integrace/kb/registrace` → souhlas → `/api/integrace/kb/vratit`.
 */
export async function zahajitPripojeniKb(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const platebniUcetId = String(formData.get('platebni_ucet_id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const konf = konfiguraceKb()
  if (!konf) redirect(cestaBanky(rozsah, { chyba: 'Napojení na Komerční banku zatím není na serveru nastavené.' }))
  if (!platebniUcetId) redirect(cestaBanky(rozsah, { chyba: 'Vyberte platební účet.' }))

  const historieOd = historieOdZFormulare(formData)
  if (!historieOd) redirect(cestaBanky(rozsah, { chyba: '„Načíst pohyby od" musí být platné datum, ne v budoucnu.' }))

  const navratUri = `${await zakladniAdresa()}/api/integrace/kb/vratit`
  const pokus = randomUUID()
  const zacatek: ExterniUcetKb = { prostredi: konf.prostredi, historie_od: historieOd, navrat_uri: navratUri, pokus, pokus_kdy: new Date().toISOString(), rozsah }

  // Pokus o KB na tomtéž platebním účtu, kde registrace aplikace
  // nedoběhla (člověk se z KB nevrátil, nebo selhala), se použije
  // znovu — jinak by platební účet blokoval (jedno živé bankovní
  // připojení na účet). Zaregistrované připojení se NEpřepisuje: smazalo
  // by se uložené client_id/secret i souhlas; na to je „Obnovit souhlas".
  const { data: existujici } = await supabase
    .from('integrace_pripojeni')
    .select('id, poskytovatel, stav, externi_ucet')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'banka')
    .eq('platebni_ucet_id', platebniUcetId)
    .is('odpojeno_kdy', null)
    .maybeSingle()

  let pripojeniId: string
  if (existujici) {
    if (existujici.poskytovatel !== 'kb_adaa' || (existujici.stav !== 'pripojuje_se' && existujici.stav !== 'chyba')) {
      redirect(cestaBanky(rozsah, { chyba: 'Tenhle platební účet už má živé bankovní připojení.' }))
    }
    if ((existujici.externi_ucet as ExterniUcetKb | null)?.client_id) {
      redirect(cestaBanky(rozsah, { chyba: 'Komerční banka už aplikaci u tohoto účtu zaregistrovala — dokončete připojení přes „Obnovit souhlas v KB“, nebo ho odpojte.' }))
    }
    pripojeniId = existujici.id as string
    const { error } = await supabase
      .from('integrace_pripojeni')
      .update({ stav: 'pripojuje_se', posledni_chyba: null, externi_ucet: zacatek })
      .eq('id', pripojeniId)
    if (error) redirect(cestaBanky(rozsah, { chyba: 'Připojení se nepodařilo připravit.' }))
  } else {
    const { data: pripojeni, error } = await supabase
      .from('integrace_pripojeni')
      .insert({
        tenant_id: tenantId,
        oblast: 'banka',
        poskytovatel: 'kb_adaa',
        rezim: 'zakaznicky',
        nazev: 'Komerční banka',
        platebni_ucet_id: platebniUcetId,
        stav: 'pripojuje_se',
        externi_ucet: zacatek,
        capabilities: { cteni: true, zapis: false, inkrementalni_sync: true, firemni_ucty: true },
        // KB: 50 stažení měsíčně zdarma, častěji placené — výchozí 1× denně.
        interval_synchronizace_minut: 1440,
      })
      .select('id')
      .single()
    if (error || !pripojeni) {
      const zprava = error?.code === '23505' ? 'Tenhle platební účet už má živé bankovní připojení.' : 'Připojení se nepodařilo založit.'
      redirect(cestaBanky(rozsah, { chyba: zprava }))
    }
    pripojeniId = pripojeni.id as string
  }
  const pripojeni = { id: pripojeniId }

  const klicSifrovani = novyKlicSifrovani()
  const { sifra, otisk } = zasifrovat({ klic_sifrovani: klicSifrovani } satisfies TajemstviKb)
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeni.id, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: 'Nepodařilo se připravit šifrování registrace.' }).eq('id', pripojeni.id)
    redirect(cestaBanky(rozsah, { chyba: 'Připojení se nepodařilo připravit — zkuste to znovu.' }))
  }

  redirect(adresaRegistrace(konf, { klicSifrovani, navratUri, state: vytvoritStavKb(pripojeni.id as string, rozsah, 'registrace', pokus) }))
}

/**
 * Obnova souhlasu (po 12 měsících, nebo když KB přístup odmítne): nový
 * autorizační kód pro tutéž registraci — nová registrace aplikace není
 * potřeba, pokud souhlas dává tentýž klient KB.
 */
export async function obnovitSouhlasKb(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const konf = konfiguraceKb()
  if (!konf) redirect(cestaBanky(rozsah, { chyba: 'Napojení na Komerční banku zatím není na serveru nastavené.' }))

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) redirect(cestaBanky(rozsah, { chyba: 'Připojení neexistuje.' }))

  const { data: sifra } = await supabase.rpc('integrace_precti_tajemstvi', { p_pripojeni: pripojeni.id })
  let udaje: TajemstviKb = {}
  try {
    udaje = typeof sifra === 'string' ? (rozsifrovat(sifra) as TajemstviKb) : {}
  } catch {
    udaje = {}
  }
  if (!udaje.client_id) redirect(cestaBanky(rozsah, { chyba: 'Registrace u KB chybí — odpojte účet a připojte ho znovu.' }))

  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetKb
  if (ucet.prostredi && ucet.prostredi !== konf.prostredi) {
    redirect(cestaBanky(rozsah, { chyba: 'Připojení vzniklo v jiném prostředí Komerční banky, než na jaké je server nastavený — odpojte ho a připojte znovu.' }))
  }
  const navratUri = ucet.navrat_uri ?? `${await zakladniAdresa()}/api/integrace/kb/vratit`
  redirect(adresaAutorizace(konf, { clientId: udaje.client_id, navratUri, state: vytvoritStavKb(pripojeni.id as string, rozsah, 'souhlas') }))
}

/** Klient v KB vybral víc účtů — člověk určí, který patří k platebnímu účtu připojení. */
export async function vybratUcetKb(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const accountId = String(formData.get('account_id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) redirect(cestaBanky(rozsah, { chyba: 'Připojení neexistuje.' }))

  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetKb
  if (ucet.account_id) redirect(cestaBanky(rozsah, { chyba: 'Účet z Komerční banky už je u tohoto připojení vybraný.' }))
  const vybrany = (ucet.ucty ?? []).find((u) => u.account_id === accountId)
  if (!vybrany) redirect(cestaBanky(rozsah, { chyba: 'Vyberte účet ze seznamu, který vrátila Komerční banka.' }))
  const obsazeny = await ucetKbJinde(supabase, tenantId, pripojeni.id as string, vybrany)
  if (obsazeny) redirect(cestaBanky(rozsah, { chyba: obsazeny }))

  const { error } = await supabase
    .from('integrace_pripojeni')
    .update({
      stav: 'pripojeno',
      posledni_chyba: null,
      externi_ucet: { ...ucet, account_id: vybrany.account_id, iban: vybrany.iban, mena: vybrany.mena, nazev_uctu: vybrany.nazev, stazeno_do: undefined } satisfies ExterniUcetKb,
    })
    .eq('id', pripojeni.id)
  if (error) redirect(cestaBanky(rozsah, { chyba: 'Výběr účtu se nepodařilo uložit.' }))

  const vysledek = await synchronizovatKbPripojeni(pripojeni.id as string)
  revalidatePath(cestaBanky(rozsah))
  redirect(cestaBanky(rozsah, vysledek.stav === 'ok' ? { synchronizovano: String(vysledek.pocetNovychRadku) } : { chyba: vysledek.duvod }))
}
