import 'server-only'

/**
 * Hledání návrhů párování (Finance Fáze 0, krok 2: „částka + dodavatel +
 * datum v rozumném okně = návrh").
 *
 * Projde nespárované zbytky pohybů za 180 dní a otevřené faktury, vybere
 * návrhy (`navrhyParovani` v lib/finance-parovani.ts — čistá logika,
 * testovaná Nodem) a zapíše je funkcí `zapsat_navrhy_parovani`. Databáze
 * každý návrh ověří znovu (firma, stav faktury, směr, měna, dvojice už
 * nebyla zamítnutá) a částku omezí zbytkem platby i faktury — appka sem
 * posílá jen kandidáty. Návrh nic neplatí: „Uhrazeno" udělá až člověk,
 * který ho ve frontě potvrdí.
 *
 * Běží jako služba (po synchronizaci banky a po importu výpisu, stejně
 * jako automatické párování) — firma se bere jen od volajícího, který ji
 * zná z databáze nebo z ověřeného přihlášení, a do Faktur se sahá jen
 * přes bránu pristupKFakturamUlohy.
 */

import { klientUlohy } from './supabase/uloha.ts'
import { fakturyFirmy, pristupKFakturamUlohy } from './faktury-pristup.ts'
import {
  navrhyParovani,
  SLOUPCE_AUTOMATICKEHO_PAROVANI,
  STAVY_PRO_NAVRH,
  type NavrhovanaFaktura,
  type NavrhovanyPohyb,
  type RadekTransakceParovani,
} from './finance-parovani.ts'
import { protistranaNeboUcet } from './banka/ucet.ts'

export type VysledekNavrhu = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  /** Nově zapsané návrhy (databáze vrací jen opravdu nové). */
  navrzeno: number
  duvod: string | null
}

const DNI_ZPET = 180
const STRANKA = 1000
const MAX_STRANEK = 20
/** Kolik návrhů jedním voláním databáze. */
const NAVRHU_NAJEDNOU = 200

type RadekParovani = { transakce_id: string; faktura: string | null; faktura_id: string | null; castka_haleru: number; stav: string }
type RadekUhrady = { faktura: string; transakce_id: string | null; castka_haleru: number }
type RadekJinePlatby = { uhrada_transakce_id: string | null; uhrada_castka_haleru: number | null }
type RadekFaktury = {
  id: string
  variabilni_symbol: string | null
  castka_haleru: number | null
  datum_vystaveni: string | null
  splatnost: string | null
  dodavatel: string | null
  ucet_dodavatele: string | null
  mena: string | null
  stav: string | null
  duplicita: boolean | null
  archivovano: boolean | null
}

function prazdny(stav: VysledekNavrhu['stav'], duvod: string | null): VysledekNavrhu {
  return { stav, navrzeno: 0, duvod }
}

async function vsechnyStranky<T>(
  dotaz: (od: number, do_: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  co: string,
): Promise<T[] | null> {
  const radky: T[] = []
  for (let s = 0; s < MAX_STRANEK; s++) {
    const { data, error } = await dotaz(s * STRANKA, s * STRANKA + STRANKA - 1)
    if (error) throw new Error(`${co}: ${error.message}`)
    radky.push(...((data ?? []) as T[]))
    if (!data || data.length < STRANKA) return radky
  }
  return null
}

export async function najitNavrhyParovani(tenantId: string, moznosti: { konecMs?: number } = {}): Promise<VysledekNavrhu> {
  const konecMs = moznosti.konecMs ?? Number.POSITIVE_INFINITY
  const supabase = klientUlohy()
  if (!supabase) return prazdny('preskoceno', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')
  const pristup = await pristupKFakturamUlohy(tenantId)
  if (pristup.stav !== 'ok') return prazdny('preskoceno', 'Faktury pro tuhle firmu nejsou otevřené.')

  try {
    const od = new Date(Date.now() - DNI_ZPET * 86_400_000).toISOString().slice(0, 10)
    const transakce = await vsechnyStranky<RadekTransakceParovani>((a, b) => supabase.from('transakce')
      .select(SLOUPCE_AUTOMATICKEHO_PAROVANI)
      .eq('tenant_id', tenantId).in('smer', ['vydaj', 'prijem']).gte('datum', od)
      .order('datum', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Platby')
    const parovani = await vsechnyStranky<RadekParovani>((a, b) => supabase.from('platby_faktury')
      .select('transakce_id, faktura, faktura_id, castka_haleru, stav')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Párování')
    const uhrady = await vsechnyStranky<RadekUhrady>((a, b) => supabase.from('faktury_rucni_uhrady')
      .select('faktura, transakce_id, castka_haleru')
      .eq('tenant_id', tenantId).is('zruseno_kdy', null)
      .order('id', { ascending: true }).range(a, b), 'Ruční úhrady')
    const jinePlatby = await vsechnyStranky<RadekJinePlatby>((a, b) => supabase.from('jine_platby')
      .select('uhrada_transakce_id, uhrada_castka_haleru')
      .eq('tenant_id', tenantId).not('uhrada_transakce_id', 'is', null)
      .order('id', { ascending: true }).range(a, b), 'Jiné platby')
    const fakturyRadky = await vsechnyStranky<RadekFaktury>((a, b) => fakturyFirmy(pristup,
      'id, variabilni_symbol, castka_haleru, datum_vystaveni, splatnost, dodavatel, ucet_dodavatele, mena, stav, duplicita, archivovano')
      .eq('archivovano', false).in('stav', [...STAVY_PRO_NAVRH])
      .order('id', { ascending: true }).range(a, b), 'Faktury')
    if (!transakce || !parovani || !uhrady || !jinePlatby || !fakturyRadky) {
      return prazdny('preskoceno', 'Dat je víc, než appka umí najednou projít — návrhy párování se v tomhle běhu vynechaly.')
    }

    // Zbytky: pohyb − potvrzená párování − úhrady Jiných plateb;
    // faktura − potvrzená párování − ruční úhrady (databáze to přepočítá
    // přesně, i s měnou faktury).
    const naPohyb = new Map<string, number>()
    const naFakturu = new Map<string, number>()
    const vyloucene = new Set<string>()
    for (const p of parovani) {
      const faktura = p.faktura ?? p.faktura_id
      if (faktura) vyloucene.add(`${p.transakce_id}|${faktura}`)
      if (p.stav !== 'potvrzeno') continue
      naPohyb.set(p.transakce_id, (naPohyb.get(p.transakce_id) ?? 0) + p.castka_haleru)
      if (faktura) naFakturu.set(faktura, (naFakturu.get(faktura) ?? 0) + p.castka_haleru)
    }
    const vyrizenePohyby = new Set<string>()
    for (const u of uhrady) {
      naFakturu.set(u.faktura, (naFakturu.get(u.faktura) ?? 0) + u.castka_haleru)
      if (u.transakce_id) vyrizenePohyby.add(u.transakce_id)
    }
    for (const j of jinePlatby) {
      if (j.uhrada_transakce_id) naPohyb.set(j.uhrada_transakce_id, (naPohyb.get(j.uhrada_transakce_id) ?? 0) + (j.uhrada_castka_haleru ?? 0))
    }
    const stornovane = new Set<string>()
    for (const t of transakce) if (t.storno_of) stornovane.add(t.storno_of)

    const pohyby: NavrhovanyPohyb[] = transakce
      .filter((t) => !vyrizenePohyby.has(t.id))
      .map((t) => ({
        id: t.id, vs: t.vs ?? '', zbyvaHaleru: t.castka_haleru - (naPohyb.get(t.id) ?? 0),
        protistrana: protistranaNeboUcet(t.protistrana, t.protiucet), protiucet: t.protiucet ?? '',
        datum: t.datum, mena: t.mena, smer: t.smer === 'prijem' ? 'prijem' : 'vydaj',
        stornovano: (t.storno_of ?? null) !== null || stornovane.has(t.id),
      }))
    const faktury: NavrhovanaFaktura[] = fakturyRadky.map((f) => {
      const castka = typeof f.castka_haleru === 'number' && Number.isFinite(f.castka_haleru) ? f.castka_haleru : 0
      return {
        id: String(f.id), vs: f.variabilni_symbol, castkaHaleru: castka,
        zbyvaHaleru: Math.abs(castka) - (naFakturu.get(String(f.id)) ?? 0),
        dodavatel: f.dodavatel, ucetDodavatele: f.ucet_dodavatele,
        datumVystaveni: f.datum_vystaveni, splatnost: f.splatnost, mena: f.mena, stav: f.stav,
        duplicita: f.duplicita === true, archivovana: f.archivovano === true,
      }
    })

    const navrhy = navrhyParovani(pohyby, faktury, { vyloucene })
    let navrzeno = 0
    for (let i = 0; i < navrhy.length; i += NAVRHU_NAJEDNOU) {
      if (Date.now() >= konecMs) break
      const davka = navrhy.slice(i, i + NAVRHU_NAJEDNOU).map((n) => ({
        transakce: n.transakceId, faktura: n.fakturaId, castka_haleru: n.castkaHaleru, duvod: n.duvod, jistota: n.jistota,
      }))
      const { data, error } = await supabase.rpc('zapsat_navrhy_parovani', { p_tenant: tenantId, p_navrhy: davka })
      if (error) throw new Error(`Návrhy: ${error.message}`)
      if (typeof data === 'number') navrzeno += data
    }
    return { stav: 'ok', navrzeno, duvod: null }
  } catch (e) {
    return prazdny('chyba', (e instanceof Error ? e.message : String(e)).slice(0, 300))
  }
}
