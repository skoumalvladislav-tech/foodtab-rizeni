import 'server-only'

import { klientUlohy } from './supabase/uloha.ts'
import { jeNaCaseSynchronizovat } from './integrace-fio-sync.ts'
import { nactiTransakceSaltEdge, nactiZustatkySaltEdge } from './integrace-saltedge.ts'
import { ZDROJ_BANKY_API } from './banka/konektor.ts'
import { zapsatVypis } from './banka/zapis.ts'

/**
 * Jedno provedení synchronizace JEDNOHO Salt Edge připojení — stejný
 * vzor jako `lib/integrace-fio-sync.ts` (`synchronizovatFioPripojeni`):
 * sdílené mezi naplánovanou úlohou a manuálním tlačítkem, zámek
 * souběhu přes `synchronizace_behy`, appka nikdy neposune kurzor dřív,
 * než má data trvale uložená (zadání §10).
 *
 * NA ROZDÍL OD FIO appka tady STRÁNKUJE (`from_id`/`dalsiId`) — jedno
 * Salt Edge volání nemusí vrátit všechny transakce najednou, appka
 * pokračuje, dokud API vrací další stránku, a KAŽDOU stránku zapíše
 * zvlášť (bezpečné pokračování po chybě: když appka spadne na třetí
 * stránce, první dvě zůstávají uložené, příští běh navazuje odtud díky
 * id od banky (`externi_id`) — co už zapsané je, podruhé se nezapíše).
 */

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

export type VysledekSynchronizaceSaltEdge =
  | { stav: 'ok'; pocetNovychRadku: number }
  | { stav: 'preskoceno'; duvod: string }
  | { stav: 'chyba'; duvod: string }

export async function synchronizovatSaltEdgePripojeni(integracePripojeniId: string): Promise<VysledekSynchronizaceSaltEdge> {
  const supabase = klientUlohy()
  if (!supabase) return { stav: 'chyba', duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }

  const { data: pripojeni, error: chybaPripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, platebni_ucet_id, externi_ucet')
    .eq('id', integracePripojeniId)
    .eq('poskytovatel', 'saltedge')
    .is('odpojeno_kdy', null)
    .maybeSingle()

  if (chybaPripojeni || !pripojeni) return { stav: 'chyba', duvod: 'Připojení neexistuje nebo je odpojené.' }
  if (!pripojeni.platebni_ucet_id) return { stav: 'chyba', duvod: 'Připojení ještě nemá vybraný platební účet.' }

  const externiUcet = (pripojeni.externi_ucet ?? {}) as { connection_id?: string; account_id?: string }
  if (!externiUcet.connection_id || !externiUcet.account_id) {
    return { stav: 'chyba', duvod: 'Připojení ještě nemá vybraný bankovní účet od Salt Edge.' }
  }

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

  const dokoncit = async (vysledek: VysledekSynchronizaceSaltEdge) => {
    await supabase.from('synchronizace_behy').update({
      stav: vysledek.stav === 'ok' ? 'hotovo' : 'chyba',
      dokonceno_kdy: new Date().toISOString(),
      pocet_novych_radku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : null,
      chyba: vysledek.stav !== 'ok' ? vysledek.duvod : null,
    }).eq('id', beh.id)
    return vysledek
  }

  let pocetCelkem = 0
  let odId: string | null | undefined = null
  do {
    const vysledekStranky = await nactiTransakceSaltEdge(externiUcet.connection_id, externiUcet.account_id, odId)
    if (vysledekStranky.stav === 'chyba') {
      // Stav se NEMĚNÍ, jen se zapíše důvod. Dřív se připojení přepnulo na
      // „vyzaduje_pozornost" — a protože výběr pro úlohu bere jen
      // „pripojeno", po jediné přechodné chybě API se už nikdy znovu
      // nesynchronizovalo (nález 11. 10. 2026). Další běh to zkusí sám.
      await supabase.from('integrace_pripojeni').update({ posledni_chyba: vysledekStranky.duvod }).eq('id', integracePripojeniId)
      return dokoncit({ stav: 'chyba', duvod: vysledekStranky.duvod })
    }

    // Každá stránka zvlášť, dávka i pohyby v jedné transakci (lib/banka/zapis.ts).
    const zapis = await zapsatVypis(supabase, {
      tenantId: pripojeni.tenant_id,
      ucetId: pripojeni.platebni_ucet_id,
      zdroj: ZDROJ_BANKY_API,
      souborNazev: `saltedge-sync-${new Date().toISOString().slice(0, 10)}`,
      souborHash: `saltedge-${integracePripojeniId}-${Date.now()}-${odId ?? 'p1'}`,
      pohyby: vysledekStranky.radky,
    })
    if (zapis.stav === 'chyba') return dokoncit({ stav: 'chyba', duvod: `Import pohybů se nepodařilo zapsat: ${zapis.duvod}` })
    pocetCelkem += zapis.pocetNovych

    odId = vysledekStranky.dalsiId
  } while (odId)

  // Zůstatek je doplněk — transakce jsou uložené beze změny a další běh
  // ho dokreslí. Chyba se ale nespolkne potichu: supabase-js ji nevyhazuje,
  // vrací ji v `error`, takže try/catch sám nic nezachytil.
  let poznamkaZustatku: string | null = null
  try {
    const zustatky = await nactiZustatkySaltEdge(externiUcet.connection_id, externiUcet.account_id)
    if (zustatky.stav === 'ok') {
      for (const z of zustatky.zustatky) {
        const { error: chybaZustatku } = await supabase.from('bankovni_zustatky').insert({
          tenant_id: pripojeni.tenant_id,
          platebni_ucet_id: pripojeni.platebni_ucet_id,
          typ: z.typ,
          castka_haleru: z.castkaHaleru,
          mena: z.mena,
          platny_k: z.platnyK,
          zdroj: ZDROJ_BANKY_API,
          integrace_pripojeni_id: integracePripojeniId,
        })
        if (chybaZustatku) poznamkaZustatku = 'Pohyby jsou uložené, zůstatek se nepodařilo zapsat.'
      }
    } else {
      poznamkaZustatku = `Pohyby jsou uložené, zůstatek se nepodařilo načíst: ${zustatky.duvod}`
    }
  } catch {
    poznamkaZustatku = 'Pohyby jsou uložené, zůstatek se nepodařilo načíst.'
  }

  await supabase.from('integrace_pripojeni').update({
    stav: 'pripojeno',
    posledni_sync_kdy: new Date().toISOString(),
    posledni_sync_pocet_radku: pocetCelkem,
    posledni_chyba: poznamkaZustatku,
  }).eq('id', integracePripojeniId)

  return dokoncit({ stav: 'ok', pocetNovychRadku: pocetCelkem })
}

/** Všechna aktivní Salt Edge připojení S VYBRANÝM ÚČTEM, u kterých už má smysl zkusit sync. */
export async function vsechnaAktivniSaltEdgePripojeni(): Promise<{ id: string }[]> {
  const supabase = klientUlohy()
  if (!supabase) return []

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, posledni_sync_kdy, interval_synchronizace_minut, externi_ucet')
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'saltedge')
    .eq('stav', 'pripojeno')
    .not('platebni_ucet_id', 'is', null)
    .is('odpojeno_kdy', null)

  const vsechna = (data ?? []) as {
    id: string
    posledni_sync_kdy: string | null
    interval_synchronizace_minut: number | null
    externi_ucet: { connection_id?: string; account_id?: string } | null
  }[]

  return vsechna
    .filter((p) => p.externi_ucet?.connection_id && p.externi_ucet?.account_id)
    .filter((p) => jeNaCaseSynchronizovat(p.posledni_sync_kdy, p.interval_synchronizace_minut))
    .map((p) => ({ id: p.id }))
}
