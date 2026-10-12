import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { klientUlohy } from './supabase/uloha.ts'
import { rozsifrovat } from './integrace-klice.ts'
import { jeNaCaseSynchronizovat } from './integrace-fio-sync.ts'
import { ADAPTERY_POKLADEN } from './pokladna-adaptery.ts'
import { oknoProvoznihoDne, planDnu, provozniDen, vychoziHistorieOd } from './pokladna-cas.ts'
import { probehnoutBeh, type UkolBehu } from './pokladna-beh.ts'
import { prirazeneProvozovny, type ExterniUcetPokladny, type ProvozovnaUctu } from './pokladna-prirazeni.ts'
import type { ChybaPos, RelacePos } from './pos-provider-contract.ts'
import { funkceNeexistuje } from './supabase/dotaz.ts'

export type { ExterniUcetPokladny, ProvozovnaUctu }

/**
 * Synchronizace JEDNOHO připojení pokladny — stejná cesta pro
 * naplánovanou úlohu (`app/api/uloha/pokladna-synchronizace`, všechna
 * připojení) i tlačítko „Synchronizovat teď" (po `integrace.manage`).
 * Vzor `lib/integrace-fio-sync.ts`: zámek v `synchronizace_behy`,
 * zašifrovaný přístup z `integrace_tajemstvi`, `service_role`.
 *
 * Jedno připojení = jeden přístup do pokladny, pod kterým může být víc
 * provozoven (Dotykačka: jeden cloud, víc poboček). Každá provozovna
 * pokladny je v appce PŘIŘAZENÁ k pobočce, nebo se nestahuje
 * (Šéfík 11. 10.: „provozovna šla přiřadit ke konkrétnímu profilu zde
 * v appce"). Přiřazení drží `externi_ucet.provozovny[]`:
 *   `{ id, nazev, branch_id, dohnano_od }`.
 *
 * Co dělá jeden běh: ověří přístup u pokladny (`adapter.otevrit`)
 * a pustí `probehnoutBeh` (`lib/pokladna-beh.ts` — poslední dny,
 * mezera po výpadku, historie; chyby po provozovnách). Den se počítá
 * podle provozního dne a pásma pobočky, KAM provozovna patří.
 *
 * Každý den jde do databáze přes `public.pokladna_nahradit_prodeje`,
 * která sama odmítne pobočku, kam tahle provozovna přiřazená není.
 * Platby po způsobu (hotovost, karta…) jdou v témže volání (`p_platby`),
 * pokud je pokladna poslala — prodeje a platby dne se přepíšou spolu.
 * Kurzory se na konci zapíšou přes `public.pokladna_ulozit_postup` —
 * ta sloučí JEN kurzory provozoven, jejichž přiřazení se mezitím
 * nezměnilo. Dřív běh zapsal celé `externi_ucet` ze stavu na svém
 * začátku a přiřazení uložené mezitím tiše vrátil.
 */

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

/**
 * Rezerva před tvrdým koncem (`konecMs`): jeden rozběhnutý dotaz na
 * pokladnu (časový limit adaptéru 20 s) a závěrečné zápisy. Nový den se
 * po `konecMs - REZERVA_BEHU_MS` nezačne — jinak by funkci na serveru
 * ukončil časový strop dřív, než uloží postup a uvolní zámek.
 */
export const REZERVA_BEHU_MS = 25_000

export type VysledekSynchronizacePokladny =
  | { stav: 'ok'; zapsanoRadku: number; dnu: number; prazdnych: number; zbyvaDohnatDnu: number }
  | { stav: 'preskoceno'; duvod: string }
  | { stav: 'chyba'; duvod: string }

type Pripojeni = {
  id: string
  tenant_id: string
  poskytovatel: string
  stav: string
  externi_ucet: ExterniUcetPokladny | null
}

async function zamknout(supabase: SupabaseClient, p: Pripojeni): Promise<{ stav: 'ok'; behId: string } | { stav: 'preskoceno'; duvod: string }> {
  const { data: bezici } = await supabase
    .from('synchronizace_behy')
    .select('id, zahajeno_kdy')
    .eq('integrace_pripojeni_id', p.id)
    .eq('stav', 'bezi')
    .maybeSingle()

  if (bezici) {
    const stariMinut = (Date.now() - new Date(bezici.zahajeno_kdy).getTime()) / 60_000
    if (stariMinut < MINUT_NEZ_JE_BEH_ZASEKNUTY) return { stav: 'preskoceno', duvod: 'Synchronizace téhle pokladny už běží.' }
    // Zaseknutý běh (restart uprostřed) nesmí připojení zamknout navždy.
    await supabase.from('synchronizace_behy').update({ stav: 'chyba', dokonceno_kdy: new Date().toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', bezici.id)
  }

  const { data: beh, error } = await supabase
    .from('synchronizace_behy')
    .insert({ tenant_id: p.tenant_id, integrace_pripojeni_id: p.id, stav: 'bezi' })
    .select('id')
    .single()

  if (error || !beh) return { stav: 'preskoceno', duvod: 'Synchronizace téhle pokladny právě začala jinde.' }
  return { stav: 'ok', behId: beh.id }
}

/** Pásmo a začátek provozního dne každé pobočky firmy (jedním dotazem). */
async function kalendarPobocek(supabase: SupabaseClient, tenantId: string): Promise<Map<string, { pasmo: string; denZacina: string }>> {
  const [{ data: pobocky }, { data: firma }] = await Promise.all([
    supabase.from('branches').select('id, timezone, day_starts_at').eq('tenant_id', tenantId),
    supabase.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
  ])
  const pasmoFirmy = (firma?.timezone as string | null) || 'Europe/Prague'
  const mapa = new Map<string, { pasmo: string; denZacina: string }>()
  for (const b of (pobocky ?? []) as { id: string; timezone: string | null; day_starts_at: string | null }[]) {
    mapa.set(b.id, { pasmo: b.timezone || pasmoFirmy, denZacina: b.day_starts_at || '05:00' })
  }
  return mapa
}

/** `konecMs` = TVRDÝ konec (kdy musí být všechno uložené), ne konec stahování — rezervu odečte synchronizace sama. */
export async function synchronizovatPokladnu(pripojeniId: string, moznosti: { konecMs: number }): Promise<VysledekSynchronizacePokladny> {
  const supabase = klientUlohy()
  if (!supabase) return { stav: 'chyba', duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, poskytovatel, stav, externi_ucet')
    .eq('id', pripojeniId)
    .eq('oblast', 'pokladna')
    .is('odpojeno_kdy', null)
    .maybeSingle()

  const p = data as Pripojeni | null
  if (!p) return { stav: 'chyba', duvod: 'Připojení neexistuje nebo je odpojené.' }

  const adapter = ADAPTERY_POKLADEN[p.poskytovatel]
  if (!adapter) return { stav: 'preskoceno', duvod: 'Tahle pokladna posílá data sama přes příjmové API.' }

  const ucet: ExterniUcetPokladny = p.externi_ucet ?? {}
  if (prirazeneProvozovny(ucet).length === 0) return { stav: 'preskoceno', duvod: 'Žádná provozovna pokladny zatím není přiřazená k pobočce.' }

  const zamek = await zamknout(supabase, p)
  if (zamek.stav !== 'ok') return zamek

  const dokoncit = async (vysledek: VysledekSynchronizacePokladny): Promise<VysledekSynchronizacePokladny> => {
    await supabase.from('synchronizace_behy').update({
      stav: vysledek.stav === 'ok' ? 'hotovo' : 'chyba',
      dokonceno_kdy: new Date().toISOString(),
      pocet_novych_radku: vysledek.stav === 'ok' ? vysledek.zapsanoRadku : null,
      chyba: vysledek.stav !== 'ok' ? vysledek.duvod : null,
    }).eq('id', zamek.behId)
    return vysledek
  }

  const { data: tajemstvi } = await supabase
    .from('integrace_tajemstvi')
    .select('sifra')
    .eq('pripojeni_id', p.id)
    .maybeSingle()

  let udaje: Record<string, string>
  try {
    if (!tajemstvi) throw new Error('chybí')
    udaje = rozsifrovat(tajemstvi.sifra)
  } catch {
    const duvod = tajemstvi ? 'Uložený přístup se nepodařilo rozšifrovat — vložte token znovu.' : 'Chybí uložený přístup — vložte token znovu.'
    await supabase.from('integrace_pripojeni').update({ stav: 'vyzaduje_pozornost', posledni_chyba: duvod }).eq('id', p.id)
    return dokoncit({ stav: 'chyba', duvod })
  }

  const otevreni = await adapter.otevrit(udaje)
  if (otevreni.stav === 'chyba') {
    // Dočasná chyba (pokladna neodpovídá) o platnosti tokenu nic neříká — výsledek posledního ověření zůstává.
    const zmena = otevreni.druh === 'pristup'
      ? { stav: 'vyzaduje_pozornost', posledni_chyba: otevreni.duvod, posledni_test_kdy: new Date().toISOString(), posledni_test_ok: false }
      : { posledni_chyba: otevreni.duvod }
    await supabase.from('integrace_pripojeni').update(zmena).eq('id', p.id)
    return dokoncit({ stav: 'chyba', duvod: otevreni.duvod })
  }
  const relace: RelacePos = otevreni.relace

  const kalendar = await kalendarPobocek(supabase, p.tenant_id)
  const historieOd = ucet.historie_od ?? vychoziHistorieOd(provozniDen(Date.now(), '05:00', 'Europe/Prague'))

  type Ukol = UkolBehu & { o: ProvozovnaUctu & { branch_id: string }; kal: { pasmo: string; denZacina: string } }
  const ukoly: Ukol[] = []
  for (const o of prirazeneProvozovny(ucet)) {
    const kal = kalendar.get(o.branch_id)
    if (!kal) continue // pobočka mezitím zmizela — RPC by zápis stejně odmítla
    const dnes = provozniDen(Date.now(), kal.denZacina, kal.pasmo)
    ukoly.push({
      id: o.id,
      nazev: o.nazev,
      dnes,
      dohnanoOd: o.dohnano_od,
      souvisleDo: o.souvisle_do ?? null,
      uvazl: o.uvazl ?? null,
      plan: planDnu({ dnes, historieOd, dohnanoOd: o.dohnano_od, souvisleDo: o.souvisle_do ?? null }),
      o,
      kal,
    })
  }

  let zapsanoRadku = 0
  let vynechano = 0
  let prazdnych = 0
  let databazeUmiPlatby = true

  // Provozovny, které pokladna teď zná — jen když nějaký den přijde prázdný
  // („nic nemám" smí znamenat zavřeno, ne „takovou provozovnu neznám").
  let znameProvozovny: Set<string> | ChybaPos | null = null
  const provozovnaExistuje = async (id: string): Promise<boolean | ChybaPos> => {
    if (znameProvozovny === null) {
      const seznam = await relace.provozovny()
      znameProvozovny = seznam.stav === 'ok' ? new Set(seznam.provozovny.map((x) => x.externiId)) : seznam
    }
    return znameProvozovny instanceof Set ? znameProvozovny.has(id) : znameProvozovny
  }

  const zpracovatDen = async (u: UkolBehu, den: string): Promise<ChybaPos | null> => {
    const { o, kal } = u as Ukol
    const okno = oknoProvoznihoDne(den, kal.denZacina, kal.pasmo)
    // Konec dneška je v budoucnu — pokladna se ptá jen do teď.
    const prodeje = await relace.prodeje(o.id, okno.odMs, Math.min(okno.doMs, Date.now()))
    if (prodeje.stav === 'chyba') return prodeje

    if (prodeje.prazdne) {
      // „Nic nemám" smí znamenat jen zavřeno — ne „takovou provozovnu neznám"
      // (ta by den smazala). Ověří se seznamem provozoven pokladny.
      const existuje = await provozovnaExistuje(o.id)
      if (typeof existuje !== 'boolean') return existuje
      if (!existuje) return { stav: 'chyba', druh: 'jina', duvod: `Provozovna ${o.nazev} v pokladně už není — přiřaďte ji znovu, nebo ji v přiřazení odeberte.` }
      prazdnych++
      // Zapíše se prázdný den — co bylo dřív stažené a pak celé stornované, zmizí.
    }

    const parametry = {
      p_pripojeni: p.id,
      p_branch: o.branch_id,
      p_dny: [den],
      p_radky: prodeje.radky.map((r) => ({ datum: den, produkt_nazev: r.produktNazev, mnozstvi: r.mnozstvi, trzba_haleru: r.trzbaHaleru })),
      p_provozovna: o.id,
    }
    // Platby jen když je pokladna poslala a databáze je umí uložit.
    const platby = databazeUmiPlatby && prodeje.platby
      ? prodeje.platby.map((z) => ({ datum: den, zpusob: z.zpusob, nazev: z.nazev, druh: z.druh, pocet: z.pocet, castka_haleru: z.castkaHaleru }))
      : null
    let { data: pocet, error } = await supabase.rpc('pokladna_nahradit_prodeje', platby ? { ...parametry, p_platby: platby } : parametry)
    if (platby && funkceNeexistuje(error)) {
      // Kód nasazený dřív než migrace 20261012200000: funkce ještě nezná
      // `p_platby`. Den se zapíše bez plateb, zbytek běhu se už neptá.
      databazeUmiPlatby = false
      ;({ data: pocet, error } = await supabase.rpc('pokladna_nahradit_prodeje', parametry))
    }
    if (error) return { stav: 'chyba', druh: 'jina', duvod: `Prodeje provozovny ${o.nazev} za ${den} se nepodařilo zapsat.` }

    zapsanoRadku += (pocet as number | null) ?? 0
    vynechano += prodeje.vynechano
    return null
  }

  const beh = await probehnoutBeh(ukoly, zpracovatDen, () => Date.now() > moznosti.konecMs - REZERVA_BEHU_MS)

  // Kurzory: jen provozovny, jejichž přiřazení je pořád stejné (sloučí databáze, atomicky).
  const { error: chybaPostupu } = await supabase.rpc('pokladna_ulozit_postup', {
    p_pripojeni: p.id,
    p_historie_od: historieOd,
    p_postup: beh.postup.map((x) => {
      const u = ukoly.find((k) => k.id === x.id)!
      return { id: x.id, branch_id: u.o.branch_id, dohnano_od: x.dohnanoOd, souvisle_do: x.souvisleDo, uvazl: x.uvazl }
    }),
  })

  const chybyProvozoven = beh.postup.filter((x) => x.chyba).map((x) => x.chyba!.duvod)
  const preskocene = beh.postup.flatMap((x) => {
    const nazev = ukoly.find((k) => k.id === x.id)!.nazev
    return x.preskocene.map((d) => `Provozovna ${nazev}: den ${d.den} appka po opakovaném selhání přeskočila (${d.duvod}).`)
  })
  const ted = new Date().toISOString()

  if (beh.globalni) {
    const chyba = beh.globalni as ChybaPos
    await supabase.from('integrace_pripojeni').update({
      stav: chyba.druh === 'pristup' ? 'vyzaduje_pozornost' : p.stav,
      posledni_chyba: chyba.duvod,
      ...(chyba.druh === 'pristup' ? { posledni_test_kdy: ted, posledni_test_ok: false } : {}),
    }).eq('id', p.id)
    return dokoncit({ stav: 'chyba', duvod: chyba.duvod })
  }

  const poznamky = [...chybyProvozoven, ...preskocene]
  if (chybaPostupu) poznamky.push('Postup stahování se nepodařilo uložit — další běh stáhne pár dní znovu.')
  if (vynechano > 0) poznamky.push(`${vynechano} položek appka vynechala (záporný součet po vratkách nebo chybějící údaje).`)

  // Žádný den se nepovedl a provozovny hlásí chyby (např. 403 u všech) —
  // „ověřeno a synchronizováno" by lhalo; jen důvod, stav beze změny.
  if (beh.dnu === 0 && chybyProvozoven.length > 0) {
    await supabase.from('integrace_pripojeni').update({ posledni_chyba: poznamky.join(' ') }).eq('id', p.id)
    return dokoncit({ stav: 'chyba', duvod: chybyProvozoven.join(' ') })
  }

  await supabase.from('integrace_pripojeni').update({
    stav: 'pripojeno',
    posledni_sync_kdy: ted,
    posledni_sync_pocet_radku: zapsanoRadku,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    posledni_chyba: poznamky.length > 0 ? poznamky.join(' ') : null,
  }).eq('id', p.id)

  if (chybyProvozoven.length > 0) return dokoncit({ stav: 'chyba', duvod: chybyProvozoven.join(' ') })
  return dokoncit({ stav: 'ok', zapsanoRadku, dnu: beh.dnu, prazdnych, zbyvaDohnatDnu: beh.zbyvaDnu })
}

/**
 * Připojení pokladen, která se mají synchronizovat teď — napříč všemi
 * firmami. Jen pokladny, kterých se appka ptá sama (má na ně adaptér),
 * s aspoň jednou přiřazenou provozovnou. „Vyžaduje pozornost" se
 * vynechává: neplatný token by appka zkoušela každou hodinu marně,
 * opraví ho člověk (vložením nového tokenu nebo „Synchronizovat teď").
 */
export async function pokladnyKSynchronizaci(): Promise<{ id: string }[]> {
  const supabase = klientUlohy()
  if (!supabase) return []

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, stav, externi_ucet, posledni_sync_kdy, interval_synchronizace_minut')
    .eq('oblast', 'pokladna')
    .eq('rezim', 'zakaznicky')
    .in('poskytovatel', Object.keys(ADAPTERY_POKLADEN))
    .is('odpojeno_kdy', null)

  type Radek = { id: string; stav: string; externi_ucet: ExterniUcetPokladny | null; posledni_sync_kdy: string | null; interval_synchronizace_minut: number | null }
  return ((data ?? []) as Radek[])
    .filter((p) => p.stav !== 'vyzaduje_pozornost' && p.stav !== 'pripojuje_se' && prirazeneProvozovny(p.externi_ucet).length > 0)
    .filter((p) => jeNaCaseSynchronizovat(p.posledni_sync_kdy, p.interval_synchronizace_minut))
    .map((p) => ({ id: p.id }))
}
