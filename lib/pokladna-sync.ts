import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { klientUlohy } from './supabase/uloha.ts'
import { rozsifrovat } from './integrace-klice.ts'
import { jeNaCaseSynchronizovat } from './integrace-fio-sync.ts'
import { ADAPTERY_POKLADEN } from './pokladna-adaptery.ts'
import { oknoProvoznihoDne, planDnu, provozniDen, vychoziHistorieOd } from './pokladna-cas.ts'
import { prirazeneProvozovny, type ExterniUcetPokladny, type ProvozovnaUctu } from './pokladna-prirazeni.ts'
import type { ChybaPos, RelacePos } from './pos-provider-contract.ts'

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
 * Co dělá jeden běh:
 *   1. ověří přístup u pokladny (`adapter.otevrit`),
 *   2. u KAŽDÉ přiřazené provozovny přepíše posledních pár provozních
 *      dní (dnešek ještě běží, storna přicházejí dodatečně) — podle
 *      provozního dne a pásma JEJÍ pobočky,
 *   3. zbytek času dohání historii od `historie_od`, provozovnu po
 *      provozovně; kurzor `dohnano_od` se posune až za hotovým dnem,
 *      takže přerušený běh příště pokračuje, kde skončil.
 * Každý den jde do databáze přes `public.pokladna_nahradit_prodeje`,
 * která sama odmítne pobočku bez přiřazení.
 */

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

export type VysledekSynchronizacePokladny =
  | { stav: 'ok'; zapsanoRadku: number; dnu: number; zbyvaDohnatDnu: number }
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

  // Pracovní kopie přiřazení — kurzory se v ní posouvají a na konci se uloží celé.
  const provozovny: ProvozovnaUctu[] = (ucet.provozovny ?? []).map((o) => ({ ...o }))

  let zapsanoRadku = 0
  let dnu = 0
  let vynechano = 0
  let chyba: ChybaPos | null = null

  const zpracovatDen = async (o: ProvozovnaUctu & { branch_id: string }, den: string, kal: { pasmo: string; denZacina: string }): Promise<ChybaPos | null> => {
    const { odMs, doMs } = oknoProvoznihoDne(den, kal.denZacina, kal.pasmo)
    const prodeje = await relace.prodeje(o.id, odMs, doMs)
    if (prodeje.stav === 'chyba') return prodeje

    const { data: pocet, error } = await supabase.rpc('pokladna_nahradit_prodeje', {
      p_pripojeni: p.id,
      p_branch: o.branch_id,
      p_dny: [den],
      p_radky: prodeje.radky.map((r) => ({ datum: den, produkt_nazev: r.produktNazev, mnozstvi: r.mnozstvi, trzba_haleru: r.trzbaHaleru })),
    })
    if (error) return { stav: 'chyba', druh: 'jina', duvod: `Prodeje provozovny ${o.nazev} za ${den} se nepodařilo zapsat.` }

    zapsanoRadku += (pocet as number | null) ?? 0
    vynechano += prodeje.vynechano
    dnu++
    return null
  }

  type Ukol = { o: ProvozovnaUctu & { branch_id: string }; kal: { pasmo: string; denZacina: string }; plan: ReturnType<typeof planDnu> }
  const ukoly: Ukol[] = []
  for (const o of provozovny) {
    if (!o.branch_id) continue
    const kal = kalendar.get(o.branch_id)
    if (!kal) continue // pobočka mezitím zmizela — RPC by zápis stejně odmítla
    const dnes = provozniDen(Date.now(), kal.denZacina, kal.pasmo)
    ukoly.push({ o: o as ProvozovnaUctu & { branch_id: string }, kal, plan: planDnu({ dnes, historieOd, dohnanoOd: o.dohnano_od }) })
  }

  // 1) Poslední dny všech provozoven — to, co lidé uvidí jako první.
  for (const u of ukoly) {
    let hotovo = 0
    for (const den of u.plan.posledni) {
      if (chyba || Date.now() > moznosti.konecMs) break
      chyba = await zpracovatDen(u.o, den, u.kal)
      if (!chyba) hotovo++
    }
    // Kurzor dohánění začíná za posledními dny, až když je appka má všechny.
    if (!chyba && u.o.dohnano_od === null && hotovo === u.plan.posledni.length && hotovo > 0) {
      u.o.dohnano_od = u.plan.posledni[u.plan.posledni.length - 1]
    }
  }

  // 2) Historie — provozovnu po provozovně, dokud je čas.
  for (const u of ukoly) {
    if (chyba || u.o.dohnano_od === null) continue
    for (const den of u.plan.dohnat) {
      if (den >= u.o.dohnano_od) continue
      if (chyba || Date.now() > moznosti.konecMs) break
      chyba = await zpracovatDen(u.o, den, u.kal)
      if (chyba) break
      u.o.dohnano_od = den
    }
  }

  const zbyvaDohnatDnu = ukoly.reduce((soucet, u) => soucet + u.plan.dohnat.filter((den) => u.o.dohnano_od === null || den < u.o.dohnano_od).length, 0)
  const novyUcet: ExterniUcetPokladny = { ...ucet, historie_od: historieOd, provozovny }
  const ted = new Date().toISOString()

  if (chyba) {
    await supabase.from('integrace_pripojeni').update({
      externi_ucet: novyUcet,
      stav: chyba.druh === 'pristup' ? 'vyzaduje_pozornost' : p.stav,
      posledni_chyba: chyba.duvod,
    }).eq('id', p.id)
    return dokoncit({ stav: 'chyba', duvod: chyba.duvod })
  }

  await supabase.from('integrace_pripojeni').update({
    externi_ucet: novyUcet,
    stav: 'pripojeno',
    posledni_sync_kdy: ted,
    posledni_sync_pocet_radku: zapsanoRadku,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    // Vynechané položky nejsou chyba spojení, ale člověk o nich má vědět.
    posledni_chyba: vynechano > 0 ? `Uloženo; ${vynechano} položek appka vynechala (záporný součet po vratkách nebo chybějící údaje).` : null,
  }).eq('id', p.id)

  return dokoncit({ stav: 'ok', zapsanoRadku, dnu, zbyvaDohnatDnu })
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
