import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { rozsifrovat } from './integrace-klice.ts'
import { nactiPosledniPohybyFio } from './integrace-fio.ts'

/**
 * Jedno provedení synchronizace JEDNOHO bankovního připojení (Fio).
 * Sdílené mezi naplánovanou úlohou (app/api/uloha/banka-synchronizace,
 * service_role, běží bez přihlášeného uživatele, loop přes VŠECHNA
 * připojení) a manuálním tlačítkem „Synchronizovat teď"
 * (app/[rozsah]/finance/integrace/banka/akce.ts, přihlášený uživatel
 * ověřený přes finance.manage, jen JEDNO připojení) — zadání:
 * „Manuální obnovení má respektovat stejný rate limit" jako ten
 * naplánovaný, takže appka nemá DRUHOU cestu k zápisu, jen druhé
 * tlačítko na STEJNOU cestu.
 *
 * Zámek souběhu (`synchronizace_behy`, partial unique index) hlídá,
 * aby dva souběžné běhy (dva cron workery, nebo cron + manuální
 * tlačítko zrovna ve stejné minutě) nezpracovaly stejné připojení
 * dvakrát zároveň.
 */

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

function klientSluzby(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const klic = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !klic) return null
  return createClient(url, klic, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type VysledekSynchronizace =
  | { stav: 'ok'; pocetNovychRadku: number }
  | { stav: 'preskoceno'; duvod: string }
  | { stav: 'chyba'; duvod: string }

export async function synchronizovatFioPripojeni(integracePripojeniId: string): Promise<VysledekSynchronizace> {
  const supabase = klientSluzby()
  if (!supabase) return { stav: 'chyba', duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, platebni_ucet_id')
    .eq('id', integracePripojeniId)
    .is('odpojeno_kdy', null)
    .maybeSingle()

  if (chybaPripojeni || !pripojeni) return { stav: 'chyba', duvod: 'Připojení neexistuje nebo je odpojené.' }
  if (!pripojeni.platebni_ucet_id) return { stav: 'chyba', duvod: 'Připojení ještě nemá vybraný platební účet.' }

  // Zámek: jeden "bezi" řádek na připojení. Zaseknutý (starý) běh appka
  // sama uzavře jako timeout a zkusí to znovu — restart workeru uprostřed
  // běhu nesmí připojení navždy zamknout.
  const { data: starsiBezici } = await supabase
    .from('synchronizace_behy')
    .select('id, zahajeno_kdy')
    .eq('integrace_pripojeni_id', integracePripojeniId)
    .eq('stav', 'bezi')
    .maybeSingle()

  if (starsiBezici) {
    const stariMinut = (Date.now() - new Date(starsiBezici.zahajeno_kdy).getTime()) / 60_000
    if (stariMinut < MINUT_NEZ_JE_BEH_ZASEKNUTY) {
      return { stav: 'preskoceno', duvod: 'Synchronizace tohoto připojení už běží.' }
    }
    await supabase.from('synchronizace_behy').update({ stav: 'chyba', dokonceno_kdy: new Date().toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', starsiBezici.id)
  }

  const { data: beh, error: chybaBehu } = await supabase
    .from('synchronizace_behy')
    .insert({ tenant_id: pripojeni.tenant_id, integrace_pripojeni_id: integracePripojeniId, stav: 'bezi' })
    .select('id')
    .single()

  if (chybaBehu || !beh) return { stav: 'preskoceno', duvod: 'Synchronizace tohoto připojení právě začala jinde.' }

  const dokoncit = async (vysledek: VysledekSynchronizace) => {
    await supabase.from('synchronizace_behy').update({
      stav: vysledek.stav === 'ok' ? 'hotovo' : 'chyba',
      dokonceno_kdy: new Date().toISOString(),
      pocet_novych_radku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : null,
      chyba: vysledek.stav !== 'ok' ? vysledek.duvod : null,
    }).eq('id', beh.id)
    return vysledek
  }

  const { data: tajemstvi } = await supabase
    .from('integrace_tajemstvi')
    .select('sifra')
    .eq('pripojeni_id', integracePripojeniId)
    .maybeSingle()

  if (!tajemstvi) {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: 'Chybí uložený token.' }).eq('id', integracePripojeniId)
    return dokoncit({ stav: 'chyba', duvod: 'Chybí uložený token.' })
  }

  let token: string
  try {
    token = rozsifrovat(tajemstvi.sifra).token
  } catch {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: 'Uložený token se nepodařilo rozšifrovat.' }).eq('id', integracePripojeniId)
    return dokoncit({ stav: 'chyba', duvod: 'Uložený token se nepodařilo rozšifrovat.' })
  }

  const vysledekFio = await nactiPosledniPohybyFio(token)

  if (vysledekFio.stav === 'chyba') {
    await supabase.from('integrace_pripojeni').update({ stav: 'vyzaduje_pozornost', posledni_chyba: vysledekFio.duvod }).eq('id', integracePripojeniId)
    return dokoncit({ stav: 'chyba', duvod: vysledekFio.duvod })
  }

  let pocetNovych = 0
  if (vysledekFio.radky.length > 0) {
    const { data: davka, error: chybaDavky } = await supabase
      .from('import_davky')
      .insert({
        tenant_id: pripojeni.tenant_id,
        typ: 'fio_api',
        soubor_nazev: `fio-sync-${new Date().toISOString().slice(0, 10)}`,
        soubor_hash: `fio-${integracePripojeniId}-${Date.now()}`,
        pocet_radku: vysledekFio.radky.length,
        stav: 'zpracovano',
      })
      .select('id')
      .single()

    if (chybaDavky || !davka) {
      return dokoncit({ stav: 'chyba', duvod: 'Dávku importu se nepodařilo založit.' })
    }

    const { data: pocet, error: chybaImportu } = await supabase.rpc('importovat_transakce', {
      p_tenant: pripojeni.tenant_id,
      p_ucet: pripojeni.platebni_ucet_id,
      p_davka: davka.id,
      p_zdroj: 'fio_api',
      p_radky: vysledekFio.radky.map((r) => ({
        datum: r.datum, smer: r.smer, castka_haleru: r.castkaHaleru, mena: r.mena,
        protistrana: r.protistrana, vs: r.vs, poznamka: r.poznamka, externi_id: r.externiId,
      })),
    })

    if (chybaImportu) return dokoncit({ stav: 'chyba', duvod: `Import pohybů se nepodařilo zapsat: ${chybaImportu.message}` })
    pocetNovych = pocet ?? 0
  }

  await supabase.from('bankovni_zustatky').insert({
    tenant_id: pripojeni.tenant_id,
    platebni_ucet_id: pripojeni.platebni_ucet_id,
    typ: 'knihovni',
    castka_haleru: vysledekFio.info.zustatekHaleru,
    mena: vysledekFio.info.mena,
    platny_k: new Date().toISOString(),
    zdroj: 'fio_api',
    integrace_pripojeni_id: integracePripojeniId,
  })

  await supabase.from('integrace_pripojeni').update({
    stav: 'pripojeno',
    posledni_sync_kdy: new Date().toISOString(),
    posledni_sync_pocet_radku: pocetNovych,
    posledni_chyba: null,
  }).eq('id', integracePripojeniId)

  return dokoncit({ stav: 'ok', pocetNovychRadku: pocetNovych })
}

/** Všechna aktivní Fio připojení napříč VŠEMI tenanty — appka je zpracuje jedno po druhém (appka je read-only, žádný paralelní zápis do stejné banky). */
export async function vsechnaAktivniFioPripojeni(): Promise<{ id: string }[]> {
  const supabase = klientSluzby()
  if (!supabase) return []

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id')
    .eq('oblast', 'banka')
    .eq('rezim', 'zakaznicky')
    .like('poskytovatel', 'fio%')
    .not('platebni_ucet_id', 'is', null)
    .is('odpojeno_kdy', null)

  return data ?? []
}
