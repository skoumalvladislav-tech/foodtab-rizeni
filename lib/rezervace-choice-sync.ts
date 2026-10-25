import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { rozsifrovat } from './integrace-klice.ts'
import {
  chybaBehu,
  KLIC_CHOICE,
  poradiSynchronizace,
  precistKurzor,
  probehnoutChoice,
  ROZESTUP_DOTAZU_MS,
  vytvoritChoice,
  type ChybaChoice,
  type FetchFn,
  type SouhrnZapisu,
  type ZapisChoice,
} from './rezervace-choice.ts'
import type { RadekImportu } from './rezervace-import.ts'
import { funkceNeexistuje } from './supabase/dotaz.ts'
import { klientUlohy } from './supabase/uloha.ts'

/**
 * Choice — načítání rezervací na serveru (síť, databáze, zámek, fronta).
 * Čistá logika je v lib/rezervace-choice.ts, tohle ji jen zapojuje.
 *
 * Kdo to volá (výjimky ze `service_role`, zapsané i v lib/supabase/uloha.ts):
 *   * naplánovaná úloha `app/api/uloha/rezervace-choice` (všechna
 *     ověřená připojení Choice, za CRON_SECRET),
 *   * „Načíst teď“ a „Ověřit znovu“ v Rezervace → Napojení — až po
 *     přihlášení, právu na pobočce připojení a dohledání připojení
 *     uživatelským klientem (RLS),
 *   * callback `/api/rezervace/choice/callback` — ověření tokenu přes
 *     frontu a první načtení po připojení.
 *
 * `service_role` je tu kvůli třem věcem, které přihlášený dělat nesmí:
 * frontě dotazů na Choice (kdokoli by si jinak zabíral čas dopředu),
 * tokenu (rozšifruje ho jen server) a zápisu rezervací ze zdroje
 * (`rezervace_importovat_zdroj` je jen pro service_role).
 *
 * „PŘIPOJENO“ zapisuje v celém modulu JEDINÁ funkce, `zapsatVysledekTestu`,
 * a jen po úspěšném živém testu (`GET /bookings/list?perPage=1`). Databáze
 * to hlídá podruhé (`integrace_pripojeni_rezervace_overeno`).
 */

/**
 * Rezerva před tvrdým koncem (`konecMs`): dotaz na Choice (časový limit
 * 15 s) a zápis jeho stránky. Nový dotaz se po `konecMs - REZERVA` nezačne.
 * Odečítá se JEDNOU za celý běh (úloha: jednou za celou úlohu), ne
 * z každého dílu času — jinak by díly připojení skoro celé snědla.
 */
export const REZERVA_DOTAZU_MS = 20_000

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

/** Síť a hodiny — v testu se podstrčí, jinak skutečné. */
export type ProstrediChoice = {
  fetch: FetchFn
  ted: () => number
  spat: (ms: number) => Promise<void>
}

const SKUTECNE: ProstrediChoice = {
  fetch: (url, init) => fetch(url, init),
  ted: () => Date.now(),
  spat: (ms) => new Promise((hotovo) => setTimeout(hotovo, ms)),
}

/** Fronta dotazů v databázi chybí (kód před migrací) nebo selhala — na Choice se pak nesahá vůbec. */
export class ChybaFronty extends Error {
  readonly bezMigrace: boolean
  constructor(bezMigrace: boolean) {
    super(bezMigrace ? 'Fronta dotazů na Choice čeká na migraci 20261031100000.' : 'Fronta dotazů na Choice selhala.')
    this.bezMigrace = bezMigrace
  }
}

/**
 * Zabere v databázi firmě čas na jeden dotaz a počká na něj.
 * `posledniDotazMs` = nejpozdější okamžik, kdy smí dotaz ODEJÍT (rezervu
 * na odpověď a zápis už odečetl volající — tady se neodečítá podruhé).
 * `false` = nevejde se, nebo firma už má zabraný jiný dotaz (souběžné
 * „Ověřit znovu“ / „Načíst teď“); nic se nezabralo. Bez fronty se
 * NEPOSÍLÁ nic — výjimka, ne „pošli to bez ní“.
 */
export function cekatNaFrontu(sluzba: SupabaseClient, tenantId: string, posledniDotazMs: number, p: ProstrediChoice = SKUTECNE): () => Promise<boolean> {
  return async () => {
    const nejdele = Math.floor(posledniDotazMs - p.ted())
    if (nejdele < 0) return false
    const { data, error } = await sluzba.rpc('rezervace_choice_zabrat_dotaz', {
      p_tenant: tenantId,
      p_rozestup_ms: ROZESTUP_DOTAZU_MS,
      p_nejdele_cekat_ms: Math.min(nejdele, 120_000),
    })
    if (error) throw new ChybaFronty(funkceNeexistuje(error))
    if (data === null || data === undefined) return false
    const cekat = Number(data)
    if (!Number.isFinite(cekat) || cekat < 0) throw new ChybaFronty(false)
    if (cekat > 0) await p.spat(cekat)
    return true
  }
}

/** Chyby v datech: opakování nepomůže, dávka se zkusí po jedné a vadné rezervace se ohlásí. */
const CHYBY_DAT = new Set(['22001', '22003', '22007', '22008', '22P02', '22P05', '23514'])

function souhrnZDatabaze(data: unknown): Omit<SouhrnZapisu, 'odmitnute'> {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { nove: Number(d.nove ?? 0), zmenene: Number(d.zmenene ?? 0), bezeZmeny: Number(d.beze_zmeny ?? 0), zastarale: Number(d.zastarale ?? 0) }
}

/** Zápis stránky přes `public.rezervace_importovat_zdroj` — stejná pravidla jako CSV a příjmové API. */
export function zapisDoFoodtabu(sluzba: SupabaseClient, pripojeniId: string): ZapisChoice {
  const zavolat = (radky: RadekImportu[]) => sluzba.rpc('rezervace_importovat_zdroj', { p_pripojeni: pripojeniId, p_radky: radky })
  // Připojení mezitím odpojené nebo neověřené: to není vada rezervace.
  const pripojeniNeplati = (e: { code?: string; message?: string }) => e.code === 'P0002' || /ověřené/.test(e.message ?? '')

  return async (radky) => {
    const { data, error } = await zavolat(radky)
    if (!error) return { stav: 'ok', souhrn: { ...souhrnZDatabaze(data), odmitnute: [] } }
    if (pripojeniNeplati(error)) return { stav: 'chyba', duvod: 'Připojení Choice mezitím přestalo platit (odpojené nebo neověřené).' }
    if (!CHYBY_DAT.has(error.code ?? '')) return { stav: 'chyba', duvod: `Zápis rezervací do Foodtabu selhal (${error.code ?? 'neznámá chyba'}) — zkusí se příště.` }

    // Dávka je celá nebo nic — kvůli jedné vadné by se nezapsala žádná.
    const celkem: SouhrnZapisu = { nove: 0, zmenene: 0, bezeZmeny: 0, zastarale: 0, odmitnute: [] }
    for (const radek of radky) {
      const jedna = await zavolat([radek])
      if (jedna.error) {
        if (pripojeniNeplati(jedna.error)) return { stav: 'chyba', duvod: 'Připojení Choice mezitím přestalo platit (odpojené nebo neověřené).' }
        if (!CHYBY_DAT.has(jedna.error.code ?? '')) return { stav: 'chyba', duvod: `Zápis rezervací do Foodtabu selhal (${jedna.error.code ?? 'neznámá chyba'}) — zkusí se příště.` }
        celkem.odmitnute.push({ id: radek.externi_id, duvod: jedna.error.code ?? '' })
        continue
      }
      const s = souhrnZDatabaze(jedna.data)
      celkem.nove += s.nove
      celkem.zmenene += s.zmenene
      celkem.bezeZmeny += s.bezeZmeny
      celkem.zastarale += s.zastarale
    }
    return { stav: 'ok', souhrn: celkem }
  }
}

/* ---------------------------------------------------------------------
 * Živý test a „připojeno“
 * ------------------------------------------------------------------ */

export type VysledekTestu =
  | { stav: 'ok' }
  | { stav: 'chyba'; druh: ChybaChoice['druh'] | 'fronta' | 'cas'; duvod: string }

/**
 * Živý test tokenu: `GET /bookings/list?page=1&perPage=1` — přes frontu,
 * jako každý jiný dotaz, za firmu připojení (`tenantId` z připojení
 * ověřeného volajícím). Volá ho callback po výměně kódu a „Ověřit
 * znovu“; oba až po přihlášení a právu `integrace.manage` na pobočce.
 * Souběžné testy jedné firmy si frontu nezaberou: firma má nejvýš
 * jeden zabraný dotaz, další dostanou „klikněte za minutu“.
 */
export async function otestovatToken(token: string, tenantId: string, konecMs: number, p: ProstrediChoice = SKUTECNE): Promise<VysledekTestu> {
  const sluzba = klientUlohy()
  if (!sluzba) return { stav: 'chyba', druh: 'fronta', duvod: 'Server nemá nastavený přístup k databázi pro úlohy (SUPABASE_SERVICE_ROLE_KEY).' }
  try {
    if (!(await cekatNaFrontu(sluzba, tenantId, konecMs - REZERVA_DOTAZU_MS, p)())) {
      return { stav: 'chyba', druh: 'cas', duvod: 'Na volný dotaz na Choice se teď čeká déle — klikněte za minutu na „Ověřit znovu“.' }
    }
  } catch (e) {
    return { stav: 'chyba', druh: 'fronta', duvod: e instanceof ChybaFronty && e.bezMigrace ? 'Napojení Choice čeká na aktualizaci databáze (migrace 20261031100000).' : 'Fronta dotazů na Choice selhala — zkuste to znovu.' }
  }
  const r = await vytvoritChoice(p.fetch).nacistStranku(token, null)
  return r.stav === 'ok' ? { stav: 'ok' } : { stav: 'chyba', druh: r.druh, duvod: r.duvod }
}

/**
 * Výsledek živého testu do registru — pod PŘIHLÁŠENÝM (RLS: integrace.manage).
 *
 * JEDINÉ místo v modulu, které zapisuje „připojeno“, a jen v téže změně
 * s `posledni_test_ok: true`. Odmítnutý přístup nebo nesmyslná odpověď =
 * „chyba“; dočasná nedostupnost, 429 a fronta stav nemění (připojené
 * připojení kvůli výpadku Choice nespadne), jen zapíšou důvod.
 */
export async function zapsatVysledekTestu(supabase: SupabaseClient, pripojeniId: string, test: VysledekTestu): Promise<boolean> {
  const ted = new Date().toISOString()
  let zmena: Record<string, unknown>
  if (test.stav === 'ok') {
    zmena = { stav: 'pripojeno', posledni_test_ok: true, posledni_test_kdy: ted, posledni_chyba: null }
  } else if (test.druh === 'pristup' || test.druh === 'data') {
    zmena = { stav: 'chyba', posledni_test_ok: false, posledni_test_kdy: ted, posledni_chyba: test.duvod }
  } else {
    zmena = { posledni_chyba: test.duvod }
  }
  const { data, error } = await supabase
    .from('integrace_pripojeni')
    .update(zmena)
    .eq('id', pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .select('id')
  return !error && (data ?? []).length === 1
}

/**
 * Je tentýž podnik Choice (varSymbol) připojený u jiné pobočky téže
 * firmy? Rezervace by se pak zapisovaly dvakrát. `service_role`, protože
 * přihlášený nemusí jiné pobočky vidět — vrací se jen ano/ne, firma je
 * z připojení ověřeného volajícím.
 */
export async function jinePripojeniTehozPodniku(tenantId: string, pripojeniId: string, varSymbol: string): Promise<boolean> {
  const sluzba = klientUlohy()
  if (!sluzba) return false
  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .neq('id', pripojeniId)
    .eq('externi_ucet->>var_symbol', varSymbol)
    .limit(1)
  return (data ?? []).length > 0
}

/* ---------------------------------------------------------------------
 * Načtení jednoho připojení
 * ------------------------------------------------------------------ */

export type VysledekSynchronizaceChoice = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  /** Choice vrátil 429 — v tomhle běhu už další připojení nezkoušet. */
  omezeno: boolean
  /** Došel čas a zbytek se načte příště (není to chyba). */
  pokracovani: boolean
  dotazu: number
  nacteno: number
  duvod: string | null
}

type Pripojeni = { id: string; tenant_id: string; stav: string; externi_ucet: Record<string, unknown> | null }

async function zamknout(sluzba: SupabaseClient, p: Pripojeni, nejmeneOdMinulehoMs: number, ted: number): Promise<{ stav: 'ok'; behId: string } | { stav: 'preskoceno'; duvod: string }> {
  const { data: posledni } = await sluzba
    .from('synchronizace_behy')
    .select('id, stav, zahajeno_kdy')
    .eq('integrace_pripojeni_id', p.id)
    .order('zahajeno_kdy', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (posledni) {
    const stariMs = ted - new Date(posledni.zahajeno_kdy as string).getTime()
    if (posledni.stav === 'bezi') {
      if (stariMs < MINUT_NEZ_JE_BEH_ZASEKNUTY * 60_000) return { stav: 'preskoceno', duvod: 'Načítání z Choice už běží.' }
      // Zaseknutý běh (restart uprostřed) nesmí připojení zamknout navždy.
      await sluzba.from('synchronizace_behy').update({ stav: 'chyba', dokonceno_kdy: new Date(ted).toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', posledni.id)
    } else if (stariMs < nejmeneOdMinulehoMs) {
      return { stav: 'preskoceno', duvod: 'Z Choice se načítalo před chvílí.' }
    }
  }

  const { data: beh, error } = await sluzba
    .from('synchronizace_behy')
    .insert({ tenant_id: p.tenant_id, integrace_pripojeni_id: p.id, stav: 'bezi' })
    .select('id')
    .single()
  if (error || !beh) return { stav: 'preskoceno', duvod: 'Načítání z Choice právě začalo jinde.' }
  return { stav: 'ok', behId: beh.id as string }
}

async function nacistToken(sluzba: SupabaseClient, pripojeniId: string): Promise<string | null> {
  const { data } = await sluzba.from('integrace_tajemstvi').select('sifra').eq('pripojeni_id', pripojeniId).maybeSingle()
  if (!data) return null
  try {
    const token = rozsifrovat(data.sifra as string).token
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

/**
 * Jeden běh načítání jednoho připojení Choice. `konecMs` = TVRDÝ konec
 * (kdy musí být všechno uložené); poslední dotaz smí odejít nejpozději
 * `konecMs - REZERVA_DOTAZU_MS`. Úloha s víc připojeními dá každému díl
 * času přes `posledniDotazMs` (rezervu odečetla jednou za celou úlohu).
 * `nejmeneOdMinulehoMs`: „Načíst teď“ nepustí nový běh hned po předchozím.
 */
export async function synchronizovatChoice(
  pripojeniId: string,
  moznosti: { konecMs: number; posledniDotazMs?: number; nejmeneOdMinulehoMs?: number; prostredi?: ProstrediChoice },
): Promise<VysledekSynchronizaceChoice> {
  const p = moznosti.prostredi ?? SKUTECNE
  const vysledek = (stav: VysledekSynchronizaceChoice['stav'], duvod: string | null, x: Partial<VysledekSynchronizaceChoice> = {}): VysledekSynchronizaceChoice =>
    ({ stav, duvod, omezeno: false, pokracovani: false, dotazu: 0, nacteno: 0, ...x })

  const sluzba = klientUlohy()
  if (!sluzba) return vysledek('chyba', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')

  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id, tenant_id, stav, externi_ucet')
    .eq('id', pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .maybeSingle()
  const pripojeni = data as Pripojeni | null
  if (!pripojeni) return vysledek('chyba', 'Připojení Choice neexistuje nebo je odpojené.')
  if (pripojeni.stav !== 'pripojeno') return vysledek('preskoceno', 'Připojení Choice není ověřené.')

  const zamek = await zamknout(sluzba, pripojeni, moznosti.nejmeneOdMinulehoMs ?? 0, p.ted())
  if (zamek.stav === 'preskoceno') return vysledek('preskoceno', zamek.duvod)

  const ucet = pripojeni.externi_ucet ?? {}
  const varSymbol = typeof ucet.var_symbol === 'string' ? ucet.var_symbol : ''
  const dokoncit = async (stav: 'hotovo' | 'chyba', chyba: string | null, novych: number) => {
    await sluzba.from('synchronizace_behy').update({
      stav,
      dokonceno_kdy: new Date(p.ted()).toISOString(),
      pocet_novych_radku: novych,
      chyba,
    }).eq('id', zamek.behId)
  }

  const token = await nacistToken(sluzba, pripojeni.id)
  if (!token || !varSymbol) {
    const duvod = 'Token k Choice chybí nebo nejde rozšifrovat — připojte podnik znovu.'
    await sluzba.from('integrace_pripojeni').update({ stav: 'vyzaduje_pozornost', posledni_test_ok: false, posledni_chyba: duvod }).eq('id', pripojeni.id).is('odpojeno_kdy', null)
    await dokoncit('chyba', duvod, 0)
    return vysledek('chyba', duvod)
  }

  let beh
  try {
    beh = await probehnoutChoice({
      api: vytvoritChoice(p.fetch),
      token,
      varSymbol,
      kurzor: precistKurzor(ucet.kurzor),
      tedMs: p.ted(),
      pockatNaDotaz: cekatNaFrontu(
        sluzba,
        pripojeni.tenant_id,
        Math.min(moznosti.konecMs - REZERVA_DOTAZU_MS, moznosti.posledniDotazMs ?? Infinity),
        p,
      ),
      zapsat: zapisDoFoodtabu(sluzba, pripojeni.id),
    })
  } catch (e) {
    const duvod = e instanceof ChybaFronty && e.bezMigrace
      ? 'Napojení Choice čeká na aktualizaci databáze (migrace 20261031100000) — nic se nenačetlo.'
      : 'Načítání z Choice spadlo — zkusí se příště.'
    if (!(e instanceof ChybaFronty)) console.error('[rezervace-choice] běh spadl:', e instanceof Error ? e.name : typeof e)
    await sluzba.from('integrace_pripojeni').update({ posledni_chyba: duvod }).eq('id', pripojeni.id).is('odpojeno_kdy', null)
    await dokoncit('chyba', duvod, 0)
    return vysledek('chyba', duvod)
  }

  const chyba = chybaBehu(beh)
  const zmena: Record<string, unknown> = {
    externi_ucet: { ...ucet, kurzor: beh.kurzor },
    posledni_chyba: chyba,
  }
  if (beh.uspesnych > 0) {
    zmena.posledni_sync_kdy = new Date(p.ted()).toISOString()
    zmena.posledni_sync_pocet_radku = beh.nacteno
  }
  if (beh.konec === 'pristup') {
    zmena.stav = 'vyzaduje_pozornost'
    zmena.posledni_test_ok = false
  }
  // Jen dokud jde o tentýž podnik — připojení mezitím připojené znovu
  // (jiný varSymbol) nebo odpojené se nepřepíše starým kurzorem.
  await sluzba
    .from('integrace_pripojeni')
    .update(zmena)
    .eq('id', pripojeni.id)
    .is('odpojeno_kdy', null)
    .eq('externi_ucet->>var_symbol', varSymbol)

  const selhalo = beh.konec === 'limit' || beh.konec === 'pristup' || beh.konec === 'chyba'
  await dokoncit(selhalo ? 'chyba' : 'hotovo', chyba, beh.nove)
  return vysledek(selhalo ? 'chyba' : 'ok', chyba, {
    omezeno: beh.konec === 'limit',
    pokracovani: beh.konec === 'cas',
    dotazu: beh.dotazu,
    nacteno: beh.nacteno,
  })
}

/**
 * Ověřená připojení Choice k načtení v pořadí pro úlohu
 * (`poradiSynchronizace`: firmy se střídají, nejdéle nenačtené první,
 * tentýž podnik u firmy jen jednou). Poslední běh se bere ze
 * `synchronizace_behy` (píše jen server), ne z `posledni_sync_kdy`
 * v registru, který může přepsat i správce napojení.
 */
export async function choiceKSynchronizaci(): Promise<string[]> {
  const sluzba = klientUlohy()
  if (!sluzba) return []
  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id, tenant_id, externi_ucet, vytvoreno_kdy')
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .eq('stav', 'pripojeno')
    .is('odpojeno_kdy', null)
  const radky = (data ?? []) as { id: string; tenant_id: string; externi_ucet: Record<string, unknown> | null; vytvoreno_kdy: string | null }[]

  // Po jednom dotazu na připojení (index synchronizace_behy_pripojeni);
  // připojení Choice je v instalaci pár.
  const kandidati = await Promise.all(radky.map(async (r) => {
    const { data: beh } = await sluzba
      .from('synchronizace_behy')
      .select('zahajeno_kdy')
      .eq('integrace_pripojeni_id', r.id)
      .order('zahajeno_kdy', { ascending: false })
      .limit(1)
      .maybeSingle()
    const vs = r.externi_ucet?.var_symbol
    return {
      id: r.id,
      tenantId: r.tenant_id,
      varSymbol: typeof vs === 'string' ? vs : '',
      zalozeno: r.vytvoreno_kdy,
      posledniBeh: (beh?.zahajeno_kdy as string | undefined) ?? null,
    }
  }))
  return poradiSynchronizace(kandidati)
}
