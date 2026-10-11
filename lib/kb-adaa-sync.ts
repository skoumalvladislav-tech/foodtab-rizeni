import 'server-only'

import { klientUlohy } from './supabase/uloha.ts'
import { rozsifrovat } from './integrace-klice.ts'
import { kbJeNaCase, konfiguraceKb, nactiZustatky, stahnoutPohyby, ziskatAccessToken, type ChybaKb, type ExterniUcetKb, type TajemstviKb } from './kb-adaa.ts'
import type { VysledekSynchronizaceBanky } from './banka-synchronizace.ts'
import type { RadekImportu } from './finance-csv-import.ts'

/**
 * Synchronizace JEDNOHO připojení Komerční banky (ADAA) — stejná cesta
 * pro naplánovanou úlohu `banka-synchronizace` i tlačítko „Synchronizovat
 * teď" (přes `lib/banka-synchronizace.ts`). Vzor `lib/integrace-fio-sync.ts`.
 *
 * Zápis jde stávajícími cestami bez migrace:
 *   * pohyby `importovat_transakce` se zdrojem `bankovni_agregator` —
 *     ten v databázi znamená „platby z bankovního API mimo Fio" (smí ho
 *     zapsat jen service_role, automatické párování mu věří); dedup
 *     `(ucet_id, externi_id)` s `externi_id = references.accountServicer`;
 *   * zůstatky `bankovni_zustatky` se stejným zdrojem.
 *
 * Okno stahování: od uloženého postupu (`externi_ucet.stazeno_do`)
 * minus 7 dní (dodatečně zaúčtované pohyby), při první synchronizaci od
 * `historie_od` (výchozí 1. 1. letošního roku), po měsících až do teď —
 * viz `stahnoutPohyby`. KB vrací nejvýš 2 roky zpátky.
 */

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10
const ZUSTATEK_STACI_HODIN = 40
export async function synchronizovatKbPripojeni(pripojeniId: string): Promise<VysledekSynchronizaceBanky> {
  const supabase = klientUlohy()
  if (!supabase) return { stav: 'chyba', duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }

  const konf = konfiguraceKb()
  if (!konf) return { stav: 'chyba', duvod: 'Napojení na Komerční banku není na serveru nastavené (KB_ADAA_*).' }

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, stav, platebni_ucet_id, externi_ucet, posledni_sync_kdy')
    .eq('id', pripojeniId)
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .is('odpojeno_kdy', null)
    .maybeSingle()

  if (!pripojeni) return { stav: 'chyba', duvod: 'Připojení ke Komerční bance neexistuje nebo je odpojené.' }
  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetKb
  if (!pripojeni.platebni_ucet_id) return { stav: 'chyba', duvod: 'Připojení ještě nemá vybraný platební účet.' }
  if (!ucet.account_id || !ucet.navrat_uri) return { stav: 'preskoceno', duvod: 'Čeká na výběr účtu v Komerční bance.' }
  if (ucet.prostredi && ucet.prostredi !== konf.prostredi) {
    // Opraví jen člověk (odpojit a připojit znovu) — „Vyžaduje pozornost", ať to úloha nezkouší potichu dokola.
    const duvod = `Připojení vzniklo v prostředí KB „${ucet.prostredi}", server je nastavený na „${konf.prostredi}" — odpojte ho a připojte znovu.`
    await supabase.from('integrace_pripojeni').update({ stav: 'vyzaduje_pozornost', posledni_chyba: duvod, posledni_test_kdy: new Date().toISOString(), posledni_test_ok: false }).eq('id', pripojeniId)
    return { stav: 'chyba', duvod }
  }

  // Zámek: jeden běh na připojení (vzor integrace-fio-sync.ts).
  const { data: bezici } = await supabase
    .from('synchronizace_behy')
    .select('id, zahajeno_kdy')
    .eq('integrace_pripojeni_id', pripojeniId)
    .eq('stav', 'bezi')
    .maybeSingle()
  if (bezici) {
    const stariMinut = (Date.now() - new Date(bezici.zahajeno_kdy).getTime()) / 60_000
    if (stariMinut < MINUT_NEZ_JE_BEH_ZASEKNUTY) return { stav: 'preskoceno', duvod: 'Synchronizace tohoto připojení už běží.' }
    await supabase.from('synchronizace_behy').update({ stav: 'chyba', dokonceno_kdy: new Date().toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', bezici.id)
  }
  const { data: beh, error: chybaBehu } = await supabase
    .from('synchronizace_behy')
    .insert({ tenant_id: pripojeni.tenant_id, integrace_pripojeni_id: pripojeniId, stav: 'bezi' })
    .select('id')
    .single()
  if (chybaBehu || !beh) return { stav: 'preskoceno', duvod: 'Synchronizace tohoto připojení právě začala jinde.' }

  const dokoncit = async (vysledek: VysledekSynchronizaceBanky) => {
    await supabase.from('synchronizace_behy').update({
      stav: vysledek.stav === 'ok' ? 'hotovo' : 'chyba',
      dokonceno_kdy: new Date().toISOString(),
      pocet_novych_radku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : null,
      chyba: vysledek.stav !== 'ok' ? vysledek.duvod : null,
    }).eq('id', beh.id)
    return vysledek
  }

  /**
   * Chyba KB: přístup → „vyžaduje pozornost" (úloha ho nebere, opraví
   * člověk obnovou souhlasu); ostatní → jen důvod, příště znovu. Čas
   * pokusu se zapíše vždy — úloha pak další pokus počítá od něj
   * (`kbJeNaCase`), ne každé 4 h znovu za placená stažení.
   */
  const nahlasit = async (chyba: ChybaKb) => {
    const pokus = { posledni_chyba: chyba.duvod, posledni_test_kdy: new Date().toISOString(), posledni_test_ok: false }
    await supabase.from('integrace_pripojeni').update(chyba.druh === 'pristup' ? { stav: 'vyzaduje_pozornost', ...pokus } : pokus).eq('id', pripojeniId)
    return dokoncit({ stav: 'chyba', duvod: chyba.duvod })
  }

  const { data: tajemstvi } = await supabase.from('integrace_tajemstvi').select('sifra').eq('pripojeni_id', pripojeniId).maybeSingle()
  let udaje: TajemstviKb
  try {
    if (!tajemstvi) throw new Error('chybí')
    udaje = rozsifrovat(tajemstvi.sifra) as TajemstviKb
  } catch {
    return nahlasit({ stav: 'chyba', druh: 'pristup', duvod: 'Uložený přístup ke Komerční bance chybí nebo nejde přečíst — připojte účet znovu.' })
  }
  if (!udaje.client_id || !udaje.client_secret || !udaje.refresh_token) {
    return nahlasit({ stav: 'chyba', druh: 'pristup', duvod: 'Připojení ke Komerční bance není dokončené — připojte účet znovu.' })
  }

  const token = await ziskatAccessToken(konf, { clientId: udaje.client_id, clientSecret: udaje.client_secret, refreshToken: udaje.refresh_token, navratUri: ucet.navrat_uri })
  if (token.stav === 'chyba') return nahlasit(token)

  const menaUctu = ucet.mena ?? 'CZK'
  let pocetNovych = 0

  /** Zapíše pohyby jednoho okna a posune `stazeno_do` — přerušený běh příště pokračuje odtud. */
  const ulozitOkno = async (radky: RadekImportu[], stazenoDo: Date): Promise<ChybaKb | null> => {
    if (radky.length > 0) {
      const { data: davka, error: chybaDavky } = await supabase
        .from('import_davky')
        .insert({
          tenant_id: pripojeni.tenant_id,
          typ: 'bankovni_agregator',
          soubor_nazev: `kb-adaa-sync-${new Date().toISOString().slice(0, 10)}`,
          soubor_hash: `kb-adaa-${pripojeniId}-${stazenoDo.getTime()}-${Date.now()}`,
          pocet_radku: radky.length,
          stav: 'zpracovano',
        })
        .select('id')
        .single()
      if (chybaDavky || !davka) return { stav: 'chyba', druh: 'jina', duvod: 'Dávku importu se nepodařilo založit.' }

      const { data: pocet, error: chybaImportu } = await supabase.rpc('importovat_transakce', {
        p_tenant: pripojeni.tenant_id,
        p_ucet: pripojeni.platebni_ucet_id,
        p_davka: davka.id,
        p_zdroj: 'bankovni_agregator',
        p_radky: radky.map((r) => ({
          datum: r.datum, smer: r.smer, castka_haleru: r.castkaHaleru, mena: r.mena,
          protistrana: r.protistrana, vs: r.vs, poznamka: r.poznamka, externi_id: r.externiId,
        })),
      })
      if (chybaImportu) return { stav: 'chyba', druh: 'jina', duvod: `Pohyby se nepodařilo zapsat: ${chybaImportu.message}` }
      pocetNovych += (pocet as number | null) ?? 0
    }

    // Postup se zapisuje do čerstvě přečteného `externi_ucet` (obnova
    // souhlasu nebo výběr účtu mohly mezitím změnit jiná pole). Když se
    // mezitím změnil vybraný účet, postup starého účtu se nezapíše.
    const { data: cerstve } = await supabase.from('integrace_pripojeni').select('externi_ucet').eq('id', pripojeniId).maybeSingle()
    const aktualni = (cerstve?.externi_ucet ?? {}) as ExterniUcetKb
    if (aktualni.account_id !== ucet.account_id) return { stav: 'chyba', druh: 'jina', duvod: 'Účet v Komerční bance se během stahování změnil — stáhne se při další synchronizaci.' }
    const { error: chybaPostupu } = await supabase
      .from('integrace_pripojeni')
      .update({ externi_ucet: { ...aktualni, stazeno_do: stazenoDo.toISOString() } satisfies ExterniUcetKb })
      .eq('id', pripojeniId)
    if (chybaPostupu) return { stav: 'chyba', druh: 'jina', duvod: 'Postup stahování se nepodařilo uložit.' }
    return null
  }

  const pohyby = await stahnoutPohyby(
    konf,
    {
      accessToken: token.accessToken,
      accountId: ucet.account_id,
      menaUctu,
      // Bez postupu (nový nebo jiný vybraný účet) od `historie_od` — ne od
      // `posledni_sync_kdy`, to by u nově vybraného účtu přeskočilo historii.
      stazenoDo: ucet.stazeno_do ?? null,
      historieOd: ucet.historie_od,
      ted: new Date(),
    },
    ulozitOkno,
  )
  if (pohyby.stav === 'chyba') return nahlasit(pohyby)

  // Zůstatek je doplněk — pohyby jsou uložené; chyba se zapíše jako poznámka, nespolkne se.
  const poznamky: string[] = []
  if (!pohyby.dohnano) poznamky.push('Starší pohyby se ještě stahují — appka pokračuje při další synchronizaci.')
  if (pohyby.vynechano > 0) poznamky.push(`${pohyby.vynechano} zaúčtovaných pohybů appka vynechala (chyběl identifikátor platby od banky, nebo částka přes 21 milionů Kč, kterou appka neuloží).`)
  // KB účtuje /transactions i /balances (50 využití měsíčně zdarma). Zůstatek
  // stačí jednou za ~2 dny: když je poslední z tohoto připojení mladší
  // než 40 h, appka ho nestahuje — při denní synchronizaci tak vyjde
  // zhruba 31 + 15 využití měsíčně.
  const { data: posledniZustatek } = await supabase
    .from('bankovni_zustatky')
    .select('platny_k')
    .eq('integrace_pripojeni_id', pripojeniId)
    .order('platny_k', { ascending: false })
    .limit(1)
    .maybeSingle()
  const zustatekCerstvy = posledniZustatek?.platny_k && Date.now() - new Date(posledniZustatek.platny_k as string).getTime() < ZUSTATEK_STACI_HODIN * 3_600_000
  const zustatky = zustatekCerstvy
    ? ({ stav: 'ok', zustatky: [] } as const)
    : await nactiZustatky(konf, { accessToken: token.accessToken, accountId: ucet.account_id, menaUctu })
  if (zustatky.stav === 'ok') {
    for (const z of zustatky.zustatky) {
      const { error } = await supabase.from('bankovni_zustatky').insert({
        tenant_id: pripojeni.tenant_id,
        platebni_ucet_id: pripojeni.platebni_ucet_id,
        typ: z.typ,
        castka_haleru: z.castkaHaleru,
        mena: z.mena,
        platny_k: z.platnyK,
        zdroj: 'bankovni_agregator',
        integrace_pripojeni_id: pripojeniId,
      })
      if (error) {
        poznamky.push('Zůstatek se nepodařilo zapsat.')
        break
      }
    }
  } else {
    poznamky.push(`Pohyby jsou uložené, zůstatek se nepodařilo načíst: ${zustatky.duvod}`)
  }

  const ted = new Date().toISOString()
  await supabase.from('integrace_pripojeni').update({
    stav: 'pripojeno',
    posledni_sync_kdy: ted,
    posledni_sync_pocet_radku: pocetNovych,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    posledni_chyba: poznamky.length > 0 ? poznamky.join(' ') : null,
  }).eq('id', pripojeniId)

  return dokoncit({ stav: 'ok', pocetNovychRadku: pocetNovych })
}

/**
 * Připojení KB k naplánované synchronizaci — napříč firmami. Jen
 * „Připojeno" s vybraným účtem; „Vyžaduje pozornost" (vypršelý souhlas)
 * čeká na člověka. Odstup řídí `interval_synchronizace_minut`
 * (u KB výchozí 1440 = 1× denně, kvůli poplatkům KB).
 */
export async function vsechnaAktivniKbPripojeni(): Promise<{ id: string }[]> {
  const supabase = klientUlohy()
  if (!supabase || !konfiguraceKb()) return []

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, stav, externi_ucet, platebni_ucet_id, posledni_sync_kdy, posledni_test_kdy, interval_synchronizace_minut')
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .eq('stav', 'pripojeno')
    .not('platebni_ucet_id', 'is', null)
    .is('odpojeno_kdy', null)

  type Radek = { id: string; externi_ucet: ExterniUcetKb | null; posledni_sync_kdy: string | null; posledni_test_kdy: string | null; interval_synchronizace_minut: number | null }
  const ted = new Date()
  return ((data ?? []) as Radek[])
    .filter((p) => Boolean(p.externi_ucet?.account_id))
    .filter((p) => kbJeNaCase(p.posledni_sync_kdy, p.posledni_test_kdy, p.interval_synchronizace_minut, ted))
    .map((p) => ({ id: p.id }))
}
