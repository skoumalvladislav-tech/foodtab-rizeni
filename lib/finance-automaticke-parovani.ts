import 'server-only'

/**
 * Automatické párování plateb s fakturami a „Uhrazeno" ve Fakturách.
 *
 * Šéfík 8. 10. 2026: „faktury se mají automaticky přesunout do uhrazených
 * ve chvíli spárování s platbou z výpisu z účtu, a nebo přesunout ručně."
 *
 * Volá se po synchronizaci banky, po importu výpisu a po příjmu faktur
 * (nová faktura může přijít až po platbě). Běží jako service_role —
 * firma se proto bere jen od volajícího, který ji zná z prostředí nebo
 * z ověřeného přihlášení, a do Faktur se sahá jen přes bránu
 * pristupKFakturamUlohy (databáze patří jedné firmě).
 *
 * Jeden běh:
 *   1. načte VŠECHNY faktury a pohyby za 180 dní (jednoznačnost jde
 *      posoudit jen nad celkem; při neúplných datech nedělá nic),
 *   2. spáruje nové jednoznačné shody (vybratAutomatickaParovani; databázová
 *      funkce automaticky_sparovat_platbu to ještě jednou ověří),
 *   3. přepne stav ve Fakturách — jen podle AUTOMATICKÝCH párování (ruční
 *      párování si stav nastavuje samo při potvrzení; dorovnávat je by
 *      otevřelo cestu, jak fakturu „zaplatit" bez práva na Faktury).
 *
 * Párování, jehož platbu banka vrátila až PO spárování, úloha sama
 * nezruší — Platby ho ukážou k ruční kontrole (viz jeVracena). Automatické
 * rušení by mohlo zasáhnout i nesouvisející párování a vrácení stavu ve
 * druhé databázi se nedá provést spolehlivě v jedné transakci.
 */

import { klientUlohy } from './supabase/uloha.ts'
import { pristupKFakturamUlohy } from './supabase/faktury.ts'
import {
  cilovyStavPodlePlateb,
  dorovnatStavy,
  vybratAutomatickaParovani,
  type AutoFaktura,
  type AutoTransakce,
} from './finance-parovani.ts'

export type VysledekParovani = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  /** Nově spárováno automaticky. */
  sparovano: number
  /** Faktury, kterým se ve Fakturách přepnul stav podle automatického párování. */
  dorovnano: number
  duvod: string | null
}

/** Jak daleko do minulosti brát pohyby (i kvůli posouzení, jestli se shoda neopakuje). */
const DNI_ZPET = 180
const STRANKA = 1000
const MAX_STRANEK = 20

type RadekTransakce = {
  id: string; vs: string | null; castka_haleru: number; protistrana: string | null; datum: string
  zdroj: string; mena: string | null; smer: string; import_davka_id: string | null
}
type RadekAlokace = { transakce_id: string; faktura_id: string; castka_haleru: number; stav: string; zpusob: string }
type RadekFaktury = {
  id: string | number
  variable_symbol: string | null
  amount: number | null
  issue_date: string | null
  duzp: string | null
  supplier: string | null
  status: string | null
  is_duplicate: boolean | null
  is_archived: boolean | null
  currency: string | null
}

function prazdny(stav: VysledekParovani['stav'], duvod: string | null): VysledekParovani {
  return { stav, sparovano: 0, dorovnano: 0, duvod }
}

/** Načte všechny stránky; null = dat je víc, než se vejde (nejednoznačnost pak nejde posoudit). */
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

export async function automatickyParovatPlatby(
  tenantId: string,
  /**
   * konecMs: nejpozději do kdy (časový rozpočet volající adresy).
   * duveryhodneDavky: dávky CSV výpisu, které právě nahrál člověk s právem
   * spravovat Faktury, s počtem řádků, které import vložil — když jich
   * v dávce mezitím přibylo (někdo do ní zapsal další), dávce se nevěří.
   */
  moznosti: { konecMs?: number; duveryhodneDavky?: readonly { id: string; pocet: number }[] } = {},
): Promise<VysledekParovani> {
  const konecMs = moznosti.konecMs ?? Number.POSITIVE_INFINITY
  const supabase = klientUlohy()
  if (!supabase) return prazdny('preskoceno', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')
  const pristup = pristupKFakturamUlohy(tenantId)
  if (pristup.stav !== 'ok') return prazdny('preskoceno', 'Databáze faktur pro tuhle firmu není napojená.')
  const faktury = pristup.faktury

  const soucetAutomatickych = async (fakturaId: string): Promise<number | null> => {
    const { data, error } = await supabase.from('platby_faktury').select('castka_haleru')
      .eq('tenant_id', tenantId).eq('faktura_id', fakturaId).eq('stav', 'potvrzeno').eq('zpusob', 'automaticky')
    if (error) return null
    return ((data ?? []) as { castka_haleru: number }[]).reduce((s, r) => s + r.castka_haleru, 0)
  }

  try {
    // --- 1. data ------------------------------------------------------------
    const od = new Date(Date.now() - DNI_ZPET * 86_400_000).toISOString().slice(0, 10)
    const transakce = await vsechnyStranky<RadekTransakce>((a, b) => supabase.from('transakce')
      .select('id, vs, castka_haleru, protistrana, datum, zdroj, mena, smer, import_davka_id')
      .eq('tenant_id', tenantId).in('smer', ['vydaj', 'prijem']).gte('datum', od)
      .order('datum', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Platby')
    const alokace = await vsechnyStranky<RadekAlokace>((a, b) => supabase.from('platby_faktury')
      .select('transakce_id, faktura_id, castka_haleru, stav, zpusob')
      .eq('tenant_id', tenantId).in('stav', ['potvrzeno', 'zamitnuto'])
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Párování')
    const fakturyRadky = await vsechnyStranky<RadekFaktury>((a, b) => faktury.from('invoices')
      .select('id, variable_symbol, amount, issue_date, duzp, supplier, status, is_duplicate, is_archived, currency')
      .order('id', { ascending: true }).range(a, b), 'Faktury')
    if (!transakce || !alokace || !fakturyRadky) {
      return prazdny('preskoceno', 'Dat je víc, než appka umí najednou posoudit — automatické párování se v tomhle běhu vynechalo.')
    }

    const duveryhodneDavky = new Set<string>()
    for (const d of moznosti.duveryhodneDavky ?? []) {
      const { count, error } = await supabase.from('transakce').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('import_davka_id', d.id)
      if (!error && count === d.pocet) duveryhodneDavky.add(d.id)
    }

    const autoTransakce: AutoTransakce[] = transakce.map((t) => ({
      id: t.id, vs: t.vs ?? '', castkaHaleru: t.castka_haleru, protistrana: t.protistrana ?? '', datum: t.datum,
      alokovanoHaleru: 0, zdroj: t.zdroj, mena: t.mena ?? 'CZK',
      smer: t.smer === 'prijem' ? 'prijem' : 'vydaj', davkaId: t.import_davka_id,
    }))
    // I faktury bez přečtené částky (castkaHaleru 0) — pravidlo je počítá jako soupeře.
    const autoFaktury: AutoFaktura[] = fakturyRadky.map((f) => ({
      id: String(f.id), vs: f.variable_symbol,
      castkaHaleru: typeof f.amount === 'number' && Number.isFinite(f.amount) ? Math.round(f.amount * 100) : 0,
      dodavatel: f.supplier, datum: f.issue_date ?? f.duzp, stav: f.status,
      alokovanoHaleru: 0, duplicita: f.is_duplicate === true,
      archivovana: f.is_archived === true, mena: f.currency,
    }))
    const fakturaPodleId = new Map(autoFaktury.map((f) => [f.id, f]))

    // Součty párování.
    const naTransakci = new Map<string, number>()
    const naFakturu = new Map<string, number>()
    const naFakturuAutomaticky = new Map<string, number>()
    const zamitnute = new Set<string>()
    for (const a of alokace) {
      if (a.stav === 'zamitnuto') {
        zamitnute.add(`${a.transakce_id}|${a.faktura_id}`)
        continue
      }
      naTransakci.set(a.transakce_id, (naTransakci.get(a.transakce_id) ?? 0) + a.castka_haleru)
      naFakturu.set(a.faktura_id, (naFakturu.get(a.faktura_id) ?? 0) + a.castka_haleru)
      if (a.zpusob === 'automaticky') naFakturuAutomaticky.set(a.faktura_id, (naFakturuAutomaticky.get(a.faktura_id) ?? 0) + a.castka_haleru)
    }
    for (const t of autoTransakce) t.alokovanoHaleru = naTransakci.get(t.id) ?? 0
    for (const f of autoFaktury) f.alokovanoHaleru = naFakturu.get(f.id) ?? 0

    // --- 2. nové jednoznačné shody -------------------------------------------
    let sparovano = 0
    for (const p of vybratAutomatickaParovani(autoTransakce, autoFaktury, { zamitnute, duveryhodneDavky })) {
      if (Date.now() >= konecMs) break
      const { data: zapsano, error } = await supabase.rpc('automaticky_sparovat_platbu', {
        p_tenant: tenantId, p_transakce: p.transakceId, p_faktura: p.fakturaId,
        p_castka_haleru: p.castkaHaleru, p_castka_faktury_celkem: p.castkaFakturyHaleru,
      })
      if (error) throw new Error(`Párování: ${error.message}`)
      if (zapsano === true) {
        sparovano++
        naFakturuAutomaticky.set(p.fakturaId, (naFakturuAutomaticky.get(p.fakturaId) ?? 0) + p.castkaHaleru)
      }
    }

    // --- 3. stav ve Fakturách podle automatických párování -------------------
    // Těsně před zápisem se párování faktury načtou znovu (mezitím ho mohl
    // někdo zrušit) a zápis je podmíněný stavem, který appka viděla —
    // souběžnou změnu (třeba odmítnutí) nepřepíše; zkusí se to příště.
    let dorovnano = 0
    for (const z of dorovnatStavy(autoFaktury.filter((f) => !f.archivovana), naFakturuAutomaticky)) {
      if (Date.now() >= konecMs) break
      const soucet = await soucetAutomatickych(z.fakturaId)
      if (soucet === null || cilovyStavPodlePlateb(soucet, fakturaPodleId.get(z.fakturaId)?.castkaHaleru ?? 0) !== z.stav) continue
      const { data, error } = await faktury.from('invoices').update({ status: z.stav })
        .eq('id', z.fakturaId).eq('status', z.puvodni).select('id')
      if (!error && (data ?? []).length > 0) dorovnano++
    }

    return { stav: 'ok', sparovano, dorovnano, duvod: null }
  } catch (e) {
    return prazdny('chyba', (e instanceof Error ? e.message : String(e)).slice(0, 300))
  }
}
