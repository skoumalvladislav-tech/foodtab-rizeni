import 'server-only'

/**
 * Hledání návrhů párování (Finance Fáze 0, krok 2: „částka + dodavatel +
 * datum v rozumném okně = návrh").
 *
 * Projde VŠECHNY pohyby firmy od nejnovějších (bez okna — i stará platba
 * může patřit k faktuře, která přišla pozdě) po stránkách a otevřené
 * faktury, vybere návrhy (`navrhyParovani` v lib/finance-parovani.ts —
 * čistá logika, testovaná Nodem) a zapíše je funkcí
 * `zapsat_navrhy_parovani`. Databáze každý návrh ověří znovu (firma, stav
 * faktury, směr, měna, dvojice už nebyla zamítnutá) a částku omezí
 * zbytkem platby i faktury — appka sem posílá jen kandidáty. Návrh nic
 * neplatí: „Uhrazeno" udělá až člověk, který ho ve frontě potvrdí.
 *
 * Párování, ruční úhrady, Jiné platby a storna se dohledávají JEN ke
 * stránce pohybů (a k otevřeným fakturám), ne celé tabulky — počet
 * zamítnutých návrhů ani staré historie běh nezastaví. Když dojde čas
 * (\`konecMs\`), skončí po hotové stránce a řekne \`nedokonceno\`; nejnovější
 * platby jsou vždy první.
 * ROZHODNOUT (otázka 146): kurzor se nikam neukládá, každý běh začne od
 * nejnovějších. Firma s tolika pohyby, že je jeden běh nestihne, se
 * k nejstarším nedostane — appka to aspoň řekne (`nedokonceno`). Uložený
 * kurzor by potřeboval nové místo v databázi.
 *
 * Běží jako služba (po synchronizaci banky, po importu výpisu a z tlačítka
 * „Najít návrhy" po kontrole práva v databázi) — firma se bere jen od
 * volajícího, který ji zná z databáze nebo z ověřeného přihlášení, a do
 * Faktur se sahá jen přes bránu pristupKFakturamUlohy.
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
  /** Došel čas dřív, než appka prošla všechny pohyby (nejnovější jsou hotové). */
  nedokonceno: boolean
  duvod: string | null
}

/** Pohybů na jednu stránku. */
const STRANKA = 1000
/** Kolik id v jednom dotazu `.in()` (délka adresy PostgRESTu). */
const NAJEDNOU = 200
/** Otevřených faktur nejvýš STRANKA × tolik — víc by se nevešlo do paměti úlohy. */
const MAX_STRANEK_FAKTUR = 50
/** Kolik návrhů jedním voláním databáze. */
const NAVRHU_NAJEDNOU = 200

const DATUM = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RadekParovani = { transakce_id: string; faktura: string | null; faktura_id: string | null; castka_haleru: number; stav: string }
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
  return { stav, navrzeno: 0, nedokonceno: false, duvod }
}

function poKouscich<T>(pole: readonly T[]): T[][] {
  const kusy: T[][] = []
  for (let i = 0; i < pole.length; i += NAJEDNOU) kusy.push(pole.slice(i, i + NAJEDNOU))
  return kusy
}

export async function najitNavrhyParovani(tenantId: string, moznosti: { konecMs?: number } = {}): Promise<VysledekNavrhu> {
  const konecMs = moznosti.konecMs ?? Number.POSITIVE_INFINITY
  const supabase = klientUlohy()
  if (!supabase) return prazdny('preskoceno', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')
  const pristup = await pristupKFakturamUlohy(tenantId)
  if (pristup.stav !== 'ok') return prazdny('preskoceno', 'Faktury pro tuhle firmu nejsou otevřené.')

  try {
    // --- 1. otevřené faktury (všechny, po stránkách podle id) ---------------
    const fakturyRadky: RadekFaktury[] = []
    let posledniFaktura: string | null = null
    for (let s = 0; ; s++) {
      if (s >= MAX_STRANEK_FAKTUR) {
        return prazdny('preskoceno', 'Otevřených faktur je víc, než appka umí najednou projít — návrhy párování se v tomhle běhu vynechaly.')
      }
      let dotaz = fakturyFirmy(pristup,
        'id, variabilni_symbol, castka_haleru, datum_vystaveni, splatnost, dodavatel, ucet_dodavatele, mena, stav, duplicita, archivovano')
        .eq('archivovano', false).in('stav', [...STAVY_PRO_NAVRH])
      if (posledniFaktura) dotaz = dotaz.gt('id', posledniFaktura)
      const { data, error } = await dotaz.order('id', { ascending: true }).limit(STRANKA)
      if (error) throw new Error(`Faktury: ${error.message}`)
      const radky = (data ?? []) as unknown as RadekFaktury[]
      fakturyRadky.push(...radky)
      if (radky.length < STRANKA) break
      posledniFaktura = String(radky[radky.length - 1].id)
    }

    // Zbytek faktury: |částka| − potvrzená párování − nezrušené ruční
    // úhrady (databáze to při zápisu přepočítá přesně, i s měnou).
    const naFakturu = new Map<string, number>()
    for (const kus of poKouscich(fakturyRadky.map((f) => String(f.id)))) {
      const [parovani, uhrady] = await Promise.all([
        supabase.from('platby_faktury').select('faktura, castka_haleru')
          .eq('tenant_id', tenantId).eq('stav', 'potvrzeno').in('faktura', kus),
        supabase.from('faktury_rucni_uhrady').select('faktura, castka_haleru')
          .eq('tenant_id', tenantId).is('zruseno_kdy', null).in('faktura', kus),
      ])
      if (parovani.error) throw new Error(`Párování faktur: ${parovani.error.message}`)
      if (uhrady.error) throw new Error(`Ruční úhrady: ${uhrady.error.message}`)
      for (const r of [...(parovani.data ?? []), ...(uhrady.data ?? [])] as { faktura: string; castka_haleru: number }[]) {
        naFakturu.set(r.faktura, (naFakturu.get(r.faktura) ?? 0) + r.castka_haleru)
      }
    }
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
    if (faktury.length === 0) return { stav: 'ok', navrzeno: 0, nedokonceno: false, duvod: null }

    // --- 2. pohyby od nejnovějších, stránka po stránce -----------------------
    let navrzeno = 0
    let kurzor: { datum: string; id: string } | null = null
    for (;;) {
      if (Date.now() >= konecMs) return { stav: 'ok', navrzeno, nedokonceno: true, duvod: null }
      let dotaz = supabase.from('transakce').select(SLOUPCE_AUTOMATICKEHO_PAROVANI)
        .eq('tenant_id', tenantId).in('smer', ['vydaj', 'prijem']).is('storno_of', null)
      if (kurzor) dotaz = dotaz.or(`datum.lt.${kurzor.datum},and(datum.eq.${kurzor.datum},id.lt.${kurzor.id})`)
      const { data, error } = await dotaz
        .order('datum', { ascending: false }).order('id', { ascending: false }).limit(STRANKA)
      if (error) throw new Error(`Platby: ${error.message}`)
      const stranka = (data ?? []) as unknown as RadekTransakceParovani[]
      if (stranka.length === 0) break

      // Souvislosti jen k pohybům téhle stránky.
      const naPohyb = new Map<string, number>()
      const vyloucene = new Set<string>()
      const vyrizenePohyby = new Set<string>()
      const stornovane = new Set<string>()
      for (const kus of poKouscich(stranka.map((t) => t.id))) {
        const [parovani, uhrady, jinePlatby, storna] = await Promise.all([
          supabase.from('platby_faktury').select('transakce_id, faktura, faktura_id, castka_haleru, stav')
            .eq('tenant_id', tenantId).in('transakce_id', kus),
          supabase.from('faktury_rucni_uhrady').select('transakce_id')
            .eq('tenant_id', tenantId).is('zruseno_kdy', null).in('transakce_id', kus),
          supabase.from('jine_platby').select('uhrada_transakce_id, uhrada_castka_haleru')
            .eq('tenant_id', tenantId).in('uhrada_transakce_id', kus),
          supabase.from('transakce').select('storno_of').eq('tenant_id', tenantId).in('storno_of', kus),
        ])
        if (parovani.error) throw new Error(`Párování: ${parovani.error.message}`)
        if (uhrady.error) throw new Error(`Ruční úhrady: ${uhrady.error.message}`)
        if (jinePlatby.error) throw new Error(`Jiné platby: ${jinePlatby.error.message}`)
        if (storna.error) throw new Error(`Storna: ${storna.error.message}`)
        for (const p of (parovani.data ?? []) as RadekParovani[]) {
          const faktura = p.faktura ?? p.faktura_id
          if (faktura) vyloucene.add(`${p.transakce_id}|${faktura}`)
          if (p.stav === 'potvrzeno') naPohyb.set(p.transakce_id, (naPohyb.get(p.transakce_id) ?? 0) + p.castka_haleru)
        }
        for (const u of (uhrady.data ?? []) as { transakce_id: string }[]) vyrizenePohyby.add(u.transakce_id)
        for (const j of (jinePlatby.data ?? []) as { uhrada_transakce_id: string; uhrada_castka_haleru: number | null }[]) {
          naPohyb.set(j.uhrada_transakce_id, (naPohyb.get(j.uhrada_transakce_id) ?? 0) + (j.uhrada_castka_haleru ?? 0))
        }
        for (const s of (storna.data ?? []) as { storno_of: string }[]) stornovane.add(s.storno_of)
      }

      const pohyby: NavrhovanyPohyb[] = stranka
        .filter((t) => !vyrizenePohyby.has(t.id))
        .map((t) => ({
          id: t.id, vs: t.vs ?? '', zbyvaHaleru: t.castka_haleru - (naPohyb.get(t.id) ?? 0),
          protistrana: protistranaNeboUcet(t.protistrana, t.protiucet), protiucet: t.protiucet ?? '',
          datum: t.datum, mena: t.mena, smer: t.smer === 'prijem' ? 'prijem' : 'vydaj',
          stornovano: (t.storno_of ?? null) !== null || stornovane.has(t.id),
        }))

      const navrhy = navrhyParovani(pohyby, faktury, { vyloucene })
      for (let i = 0; i < navrhy.length; i += NAVRHU_NAJEDNOU) {
        const davka = navrhy.slice(i, i + NAVRHU_NAJEDNOU).map((n) => ({
          transakce: n.transakceId, faktura: n.fakturaId, castka_haleru: n.castkaHaleru, duvod: n.duvod, jistota: n.jistota,
        }))
        const { data: zapsano, error: chybaZapisu } = await supabase.rpc('zapsat_navrhy_parovani', { p_tenant: tenantId, p_navrhy: davka })
        if (chybaZapisu) throw new Error(`Návrhy: ${chybaZapisu.message}`)
        if (typeof zapsano === 'number') navrzeno += zapsano
      }

      if (stranka.length < STRANKA) break
      const posledni = stranka[stranka.length - 1]
      // Kurzor jde do filtru PostgRESTu — jen tvar, který databáze vrací.
      if (!DATUM.test(posledni.datum) || !UUID.test(posledni.id)) throw new Error('Platby: nečekaný tvar data nebo id.')
      kurzor = { datum: posledni.datum, id: posledni.id }
    }
    return { stav: 'ok', navrzeno, nedokonceno: false, duvod: null }
  } catch (e) {
    return prazdny('chyba', (e instanceof Error ? e.message : String(e)).slice(0, 300))
  }
}
