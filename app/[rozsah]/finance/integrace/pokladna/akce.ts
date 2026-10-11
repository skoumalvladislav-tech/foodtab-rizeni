'use server'

import { randomBytes } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { klientUlohy } from '@/lib/supabase/uloha'
import { sifrovaniJeNastavene, zasifrovat } from '@/lib/integrace-klice'
import { zakladniAdresaAplikace } from '@/lib/integrace-adresa'
import { najitPokladnu, prectiUdaje } from '@/lib/pokladna-poskytovatele'
import { najitStejnyUcet, obsazenePobocky, overitPokladnu, ulozitOverenePripojeni, verejnaPole } from '@/lib/pokladna-pripojeni'
import { prirazeneProvozovny, zkontrolovatPrirazeni, type ExterniUcetPokladny } from '@/lib/pokladna-prirazeni'
import { synchronizovatPokladnu, type VysledekSynchronizacePokladny } from '@/lib/pokladna-sync'
import { slozitKlicPrijmu } from '@/lib/pokladna-prijem-api'
import { posunoutDen, vychoziHistorieOd } from '@/lib/pokladna-cas'

/**
 * Integrace → Pokladní systémy. Všechno tady smí jen `integrace.manage`
 * (správa napojení, vidí/mění přístupy) — stejně jako banka.
 *
 * Tajemství jdou přes `integrace_uloz_tajemstvi` pod přihlášeným
 * uživatelem. Zápis/úklid prodejů a synchronizace jdou přes
 * `service_role` (`lib/pokladna-sync.ts`, `pokladna_odebrat_prodeje`) —
 * až PO kontrole práva tady a po ověření, že připojení patří firmě
 * (uživatelským klientem, přes RLS).
 */

const PRVNI_SYNCHRONIZACE_MS = 20_000

function cesta(rozsah: string): string {
  return `/${rozsah}/finance/integrace/pokladna`
}

function zpet(rozsah: string, parametry: Record<string, string>): never {
  redirect(`${cesta(rozsah)}?${new URLSearchParams(parametry)}`)
}

async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'integrace.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') zpet(rozsah, { chyba: 'Napojení pokladen spravuje ten, kdo má právo „Správa napojení na externí systémy".' })

  return { supabase: await getServerSupabase(), tenantId }
}

function dnesVPraze(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())
}

/** „Načíst historii od": platné datum, ne v budoucnu, nejvýš tři roky zpátky. Prázdné = 1. 1. letošního roku. */
function historieZFormulare(formData: FormData): string | null {
  const dnes = dnesVPraze()
  const text = String(formData.get('historie_od') ?? '').trim()
  if (!text) return vychoziHistorieOd(dnes)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return null
  if (text > dnes || text < posunoutDen(dnes, -3 * 366)) return null
  return text
}

function zpravaSynchronizace(v: VysledekSynchronizacePokladny): string {
  if (v.stav === 'ok') {
    const zbyva = v.zbyvaDohnatDnu > 0 ? ` Historii (${v.zbyvaDohnatDnu} dní) appka dotáhne v dalších bězích sama.` : ''
    return `Staženo ${v.dnu} dní, ${v.zapsanoRadku} řádků prodeje.${zbyva}`
  }
  return v.duvod
}

/**
 * „Okénko na token": vybraná pokladna a pole podle
 * `lib/pokladna-poskytovatele.ts`. Appka údaje NEJDŘÍV ověří u pokladny;
 * teprve pak založí připojení (nebo existujícímu připojení téhož účtu
 * vymění přístup — typicky po „Vyžaduje pozornost") a načte provozovny
 * k přiřazení.
 */
export async function pripojitPokladnu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const popis = najitPokladnu(String(formData.get('pokladna') ?? ''))

  const { supabase, tenantId } = await pripravit(rozsah)

  if (!popis || popis.zpusob !== 'token') zpet(rozsah, { chyba: 'Neznámá pokladna.' })
  if (!sifrovaniJeNastavene()) zpet(rozsah, { chyba: 'Na serveru chybí šifrovací klíč (INTEGRACE_KLIC_SIFRY) — token by nešel bezpečně uložit.' })

  const historieOd = historieZFormulare(formData)
  if (!historieOd) zpet(rozsah, { chyba: '„Načíst historii od" musí být datum v posledních třech letech, ne v budoucnu.' })

  const udaje = prectiUdaje(popis, (klic) => formData.get(`pole_${klic}`) as string | null)
  if (udaje.stav === 'chyba') zpet(rozsah, { chyba: udaje.duvod })

  const overeni = await overitPokladnu(popis.klic, udaje.udaje)
  if (overeni.stav === 'chyba') zpet(rozsah, { chyba: `${popis.nazev}: přístup se nepodařilo ověřit — ${overeni.duvod}` })

  const existujici = await najitStejnyUcet(supabase, tenantId, popis, verejnaPole(popis, udaje.udaje), null)

  let pripojeniId = existujici?.id ?? null
  if (!pripojeniId) {
    const { data: nove, error } = await supabase
      .from('integrace_pripojeni')
      .insert({
        tenant_id: tenantId,
        oblast: 'pokladna',
        poskytovatel: popis.klic,
        rezim: 'zakaznicky',
        stav: 'pripojuje_se',
        nazev: popis.nazev,
      })
      .select('id')
      .single()
    if (error || !nove) zpet(rozsah, { chyba: 'Připojení se nepodařilo založit (napojení pro celou firmu smí jen správce napojení celé firmy).' })
    pripojeniId = nove.id as string
  }

  const ulozeni = await ulozitOverenePripojeni(supabase, {
    pripojeniId,
    tenantId,
    popis,
    udaje: udaje.udaje,
    provozovny: overeni.provozovny,
    puvodniUcet: existujici?.externi_ucet ?? {},
    historieOd,
  })
  if (ulozeni.stav === 'chyba') {
    if (!existujici) await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: ulozeni.duvod }).eq('id', pripojeniId)
    zpet(rozsah, { chyba: ulozeni.duvod })
  }

  revalidatePath(cesta(rozsah))
  if (ulozeni.prirazeno === 0) {
    zpet(rozsah, { ok: `${popis.nazev} je ověřená (${ulozeni.celkem} provozoven). Teď u ní přiřaďte provozovny k pobočkám v appce.` })
  }

  const prvni = await synchronizovatPokladnu(pripojeniId, { konecMs: Date.now() + PRVNI_SYNCHRONIZACE_MS })
  zpet(rozsah, prvni.stav === 'chyba'
    ? { chyba: `${popis.nazev} je připojená, ale první stažení se nepovedlo: ${prvni.duvod}` }
    : { ok: `${popis.nazev} je připojená. ${zpravaSynchronizace(prvni)}` })
}

/**
 * Přiřazení provozoven pokladny k pobočkám (Šéfík 11. 10.: „provozovna
 * šla přiřadit ke konkrétnímu profilu zde v appce"). Provozovna, která
 * změní pobočku, začne historii znovu a z pobočky, kterou opustila,
 * appka smaže, co z ní dřív zapsala — jinak by tam zůstala cizí čísla.
 */
export async function ulozitPrirazeni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, poskytovatel, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .is('branch_id', null)
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) zpet(rozsah, { chyba: 'Připojení neexistuje.' })

  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetPokladny
  const volby: Record<string, string> = {}
  for (const p of ucet.provozovny ?? []) volby[p.id] = String(formData.get(`pobocka_${p.id}`) ?? '')

  const [{ data: pobocky }, obsazene] = await Promise.all([
    supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
    obsazenePobocky(supabase, tenantId, pripojeni.poskytovatel as string, pripojeni.id as string),
  ])
  const kontrola = zkontrolovatPrirazeni(ucet.provozovny ?? [], volby, new Set(((pobocky ?? []) as { id: string }[]).map((b) => b.id)), obsazene)
  if (kontrola.stav === 'chyba') zpet(rozsah, { chyba: kontrola.duvod })

  const prirazeno = kontrola.provozovny.filter((p) => p.branch_id).length
  const { error } = await supabase
    .from('integrace_pripojeni')
    .update({
      externi_ucet: { ...ucet, provozovny: kontrola.provozovny },
      stav: prirazeno > 0 ? 'pripojeno' : 'vyzaduje_pozornost',
      posledni_chyba: prirazeno > 0 ? null : 'Přiřaďte provozovny pokladny k pobočkám v appce — dokud nejsou přiřazené, nic se nestahuje.',
    })
    .eq('id', pripojeni.id)
  if (error) zpet(rozsah, { chyba: 'Přiřazení se nepodařilo uložit.' })

  // Úklid opuštěných poboček: jen řádky TOHOTO připojení (RPC maže podle
  // integrace_pripojeni_id). Připojení patří firmě — ověřeno výš uživatelským klientem.
  let smazano = 0
  if (kontrola.opustenePobocky.length > 0) {
    const sluzba = klientUlohy()
    if (!sluzba) zpet(rozsah, { chyba: 'Přiřazení je uložené, ale staré prodeje se nepodařilo uklidit (úloha není nastavená).' })
    for (const branchId of kontrola.opustenePobocky) {
      const { data: pocet, error: chybaUklidu } = await sluzba.rpc('pokladna_odebrat_prodeje', { p_pripojeni: pripojeni.id, p_branch: branchId })
      if (chybaUklidu) zpet(rozsah, { chyba: 'Přiřazení je uložené, ale staré prodeje v původní pobočce se nepodařilo smazat — zkuste uložit znovu.' })
      smazano += (pocet as number | null) ?? 0
    }
  }

  revalidatePath(cesta(rozsah))
  const uklid = smazano > 0 ? ` Z původních poboček appka odebrala ${smazano} řádků, nová pobočka je dostane znovu z pokladny.` : ''
  if (prirazeno === 0) zpet(rozsah, { ok: `Přiřazení uloženo — žádná provozovna se teď nestahuje.${uklid}` })

  const prvni = await synchronizovatPokladnu(pripojeni.id as string, { konecMs: Date.now() + PRVNI_SYNCHRONIZACE_MS })
  zpet(rozsah, prvni.stav === 'chyba'
    ? { chyba: `Přiřazení uloženo, ale stažení se nepovedlo: ${prvni.duvod}${uklid}` }
    : { ok: `Přiřazení uloženo. ${zpravaSynchronizace(prvni)}${uklid}` })
}

/** „Synchronizovat teď" — stejná cesta jako hodinová úloha, jen hned a pro jedno připojení. */
export async function synchronizovatPokladnuTed(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  // Připojení musí patřit firmě přihlášeného — teprve pak service_role.
  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, externi_ucet')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) zpet(rozsah, { chyba: 'Připojení neexistuje.' })
  if (prirazeneProvozovny(pripojeni.externi_ucet as ExterniUcetPokladny | null).length === 0) {
    zpet(rozsah, { chyba: 'Nejdřív přiřaďte provozovny pokladny k pobočkám.' })
  }

  const vysledek = await synchronizovatPokladnu(pripojeni.id as string, { konecMs: Date.now() + 25_000 })
  revalidatePath(cesta(rozsah))
  zpet(rozsah, vysledek.stav === 'chyba' ? { chyba: vysledek.duvod } : { ok: zpravaSynchronizace(vysledek) })
}

/** Odpojení: přístup se doopravdy smaže, připojení i stažené prodeje zůstávají (historie). */
export async function odpojitPokladnu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  const { error } = await supabase.rpc('integrace_smaz_tajemstvi', { p_pripojeni: id })
  if (error) zpet(rozsah, { chyba: 'Odpojení se nepodařilo.' })

  await supabase
    .from('integrace_pripojeni')
    .update({ stav: 'odpojeno', odpojeno_kdy: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')

  revalidatePath(cesta(rozsah))
  zpet(rozsah, { ok: 'Pokladna je odpojená. Už stažené prodeje zůstávají.' })
}

/**
 * Přihlášení přes Dotykačku (Connector v2): připojení ve stavu
 * „Připojuje se…" a přesměrování na stránku, která formulář pro
 * Dotykačku podepíše a odešle (`./dotykacka/page.tsx`). Že jde o účet,
 * který už připojený je, appka pozná až po návratu (podle Cloud ID).
 */
export async function zahajitPrihlaseniDotykacka(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  if (!process.env.DOTYKACKA_CLIENT_ID || !process.env.DOTYKACKA_CLIENT_SECRET) {
    zpet(rozsah, { chyba: 'Přihlášení přes Dotykačku zatím není nastavené — vložte token ručně.' })
  }
  if (!sifrovaniJeNastavene()) zpet(rozsah, { chyba: 'Na serveru chybí šifrovací klíč (INTEGRACE_KLIC_SIFRY).' })

  const historieOd = historieZFormulare(formData)
  if (!historieOd) zpet(rozsah, { chyba: '„Načíst historii od" musí být datum v posledních třech letech, ne v budoucnu.' })

  // Nedokončený pokus (člověk se z Dotykačky nevrátil) se použije znovu —
  // opakované klikání nemá plodit „Připojuje se…" karty.
  const { data: rozjety } = await supabase
    .from('integrace_pripojeni')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .eq('poskytovatel', 'dotykacka')
    .eq('stav', 'pripojuje_se')
    .is('branch_id', null)
    .is('odpojeno_kdy', null)
    .limit(1)
    .maybeSingle()

  let pripojeniId: string
  if (rozjety) {
    pripojeniId = rozjety.id as string
    await supabase.from('integrace_pripojeni').update({ externi_ucet: { historie_od: historieOd } }).eq('id', pripojeniId)
  } else {
    const { data: nove, error } = await supabase
      .from('integrace_pripojeni')
      .insert({
        tenant_id: tenantId,
        oblast: 'pokladna',
        poskytovatel: 'dotykacka',
        rezim: 'zakaznicky',
        stav: 'pripojuje_se',
        nazev: 'Dotykačka',
        externi_ucet: { historie_od: historieOd },
      })
      .select('id')
      .single()
    if (error || !nove) zpet(rozsah, { chyba: 'Připojení se nepodařilo založit (napojení pro celou firmu smí jen správce napojení celé firmy).' })
    pripojeniId = nove.id as string
  }

  redirect(`${cesta(rozsah)}/dotykacka?pripojeni=${pripojeniId}`)
}

export type StavKlicePrijmu = { stav: 'ok'; klic: string; adresa: string } | { stav: 'chyba'; duvod: string } | null

/**
 * Klíč pro příjmové API („Jiná pokladna"). Jeden klíč = jedna pobočka
 * (přiřazení je dané rovnou klíčem). Bez `id` založí připojení pro
 * pobočku, s `id` klíč vymění (starý přestane platit hned). Klíč se
 * vrací JEN v odpovědi téhle akce — appka ho jinde nezobrazí a v adrese
 * stránky nikdy není.
 */
export async function vydatKlicPrijmu(_predchozi: StavKlicePrijmu, formData: FormData): Promise<StavKlicePrijmu> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const branchId = String(formData.get('branch_id') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah)

  if (!sifrovaniJeNastavene()) return { stav: 'chyba', duvod: 'Na serveru chybí šifrovací klíč (INTEGRACE_KLIC_SIFRY) — klíč by nešel uložit.' }

  let pripojeniId: string
  if (id) {
    const { data } = await supabase
      .from('integrace_pripojeni')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('oblast', 'pokladna')
      .eq('poskytovatel', 'obecne')
      .is('odpojeno_kdy', null)
      .maybeSingle()
    if (!data) return { stav: 'chyba', duvod: 'Připojení neexistuje.' }
    pripojeniId = data.id as string
  } else {
    const { data: pobocka } = await supabase.from('branches').select('id, name').eq('id', branchId).eq('tenant_id', tenantId).maybeSingle()
    if (!pobocka) return { stav: 'chyba', duvod: 'Vyberte pobočku.' }

    const { data: existujici } = await supabase
      .from('integrace_pripojeni')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', pobocka.id)
      .eq('oblast', 'pokladna')
      .eq('poskytovatel', 'obecne')
      .is('odpojeno_kdy', null)
      .maybeSingle()
    if (existujici) return { stav: 'chyba', duvod: `Pobočka ${pobocka.name as string} už klíč má — u připojení výš ho můžete vyměnit.` }

    const { data: nove, error } = await supabase
      .from('integrace_pripojeni')
      .insert({
        tenant_id: tenantId,
        branch_id: pobocka.id,
        oblast: 'pokladna',
        poskytovatel: 'obecne',
        rezim: 'zakaznicky',
        // „Čeká na první data", dokud nepřijde první platná dávka.
        stav: 'nepripojeno',
        nazev: `Příjmové API — ${pobocka.name as string}`,
        capabilities: { prijem: true },
      })
      .select('id')
      .single()
    if (error || !nove) return { stav: 'chyba', duvod: 'Připojení se nepodařilo založit.' }
    pripojeniId = nove.id as string
  }

  const klic = slozitKlicPrijmu(pripojeniId, randomBytes(32).toString('base64url'))
  const { sifra, otisk } = zasifrovat({ klic })
  const { error: chybaKlice } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeniId, p_sifra: sifra, p_otisk: otisk })
  if (chybaKlice) return { stav: 'chyba', duvod: 'Klíč se nepodařilo uložit — zkuste to znovu.' }

  revalidatePath(cesta(rozsah))
  return { stav: 'ok', klic, adresa: `${await zakladniAdresaAplikace()}/api/pokladna/prodeje` }
}
