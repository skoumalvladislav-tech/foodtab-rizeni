import 'server-only'

/**
 * Automatické párování plateb s fakturami a „Uhrazeno" ve Fakturách.
 *
 * Šéfík 8. 10. 2026: „faktury se mají automaticky přesunout do uhrazených
 * ve chvíli spárování s platbou z výpisu z účtu, a nebo přesunout ručně."
 *
 * Volá se po synchronizaci banky, po importu výpisu a po příjmu faktur
 * (nová faktura může přijít až po platbě). Běží jako service_role —
 * firma se proto bere jen od volajícího, který ji zná z databáze (firmy
 * s otevřenými Fakturami) nebo z ověřeného přihlášení, a do Faktur se
 * sahá jen přes bránu pristupKFakturamUlohy (Faktury firmy otevřené).
 *
 * Jeden běh:
 *   1. načte VŠECHNY faktury a pohyby za 180 dní (jednoznačnost jde
 *      posoudit jen nad celkem; při neúplných datech nedělá nic),
 *   2. spáruje nové jednoznačné shody (vybratAutomatickaParovani; databázová
 *      funkce automaticky_sparovat_fakturu celou jistou shodu — VS, částku,
 *      IBAN, měnu, soupeře — ověří znovu a stav faktury přepočítá sama),
 *   3. dorovná stav faktur s potvrzeným párováním, kde nesedí — jen přes
 *      databázi (`prepocitat_stav_faktury`, jediný výpočet stavu podle
 *      plateb). Přímý zápis „Uhrazeno" appka nedělá (Finance Fáze 0,
 *      krok 2: stav podle plateb počítá jen databáze).
 *
 * Párování, jehož platbu banka vrátila až PO spárování, úloha sama
 * nezruší — Platby ho ukážou k ruční kontrole (viz jeVracena). Automatické
 * rušení by mohlo zasáhnout i nesouvisející párování.
 *
 * Od 18. 10. 2026 jsou faktury v hlavní databázi (public.faktury) a párování
 * se zapisuje funkcí automaticky_sparovat_fakturu, která si částku faktury
 * čte sama a znovu ověří měnu, archiv a duplicitu (druhá linie za
 * vybratAutomatickaParovani).
 */

import { klientUlohy } from './supabase/uloha.ts'
import { fakturyFirmy, pristupKFakturamUlohy } from './faktury-pristup.ts'
import {
  autoTransakceZRadku,
  dorovnatStavy,
  SLOUPCE_AUTOMATICKEHO_PAROVANI,
  vybratAutomatickaParovani,
  type AutoFaktura,
  type AutoTransakce,
  type RadekTransakceParovani,
} from './finance-parovani.ts'

export type VysledekParovani = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  /** Nově spárováno automaticky. */
  sparovano: number
  /** Faktury, kterým databáze dorovnala stav podle potvrzených plateb. */
  dorovnano: number
  duvod: string | null
}

/** Jak daleko do minulosti brát pohyby (i kvůli posouzení, jestli se shoda neopakuje). */
const DNI_ZPET = 180
const STRANKA = 1000
const MAX_STRANEK = 20
/** Kolik id řádků výpisu se ptá na potvrzení banky v jednom dotazu (délka adresy). */
const POTVRZENI_NAJEDNOU = 100

type RadekTransakce = RadekTransakceParovani
type RadekAlokace = { transakce_id: string; faktura: string | null; faktura_id: string; castka_haleru: number; stav: string; zpusob: string }
type RadekFaktury = {
  id: string
  variabilni_symbol: string | null
  castka_haleru: number | null
  datum_vystaveni: string | null
  duzp: string | null
  dodavatel: string | null
  stav: string | null
  duplicita: boolean | null
  archivovano: boolean | null
  mena: string | null
  ucet_dodavatele: string | null
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
   * Dávku výpisu, kterou právě nahrál člověk, sem appka NEPOSÍLÁ (dřív
   * `duveryhodneDavky`): tu posoudí databáze pod jeho přihlášením
   * (`sparovat_jiste_z_davky`) — úloha bez přihlášeného výpisu nevěří.
   */
  moznosti: { konecMs?: number } = {},
): Promise<VysledekParovani> {
  const konecMs = moznosti.konecMs ?? Number.POSITIVE_INFINITY
  const supabase = klientUlohy()
  if (!supabase) return prazdny('preskoceno', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')
  const pristup = await pristupKFakturamUlohy(tenantId)
  if (pristup.stav !== 'ok') return prazdny('preskoceno', 'Faktury pro tuhle firmu nejsou otevřené.')

  try {
    // --- 1. data ------------------------------------------------------------
    const od = new Date(Date.now() - DNI_ZPET * 86_400_000).toISOString().slice(0, 10)
    const transakce = await vsechnyStranky<RadekTransakce>((a, b) => supabase.from('transakce')
      .select(SLOUPCE_AUTOMATICKEHO_PAROVANI)
      .eq('tenant_id', tenantId).in('smer', ['vydaj', 'prijem']).gte('datum', od)
      .order('datum', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Platby')
    const alokace = await vsechnyStranky<RadekAlokace>((a, b) => supabase.from('platby_faktury')
      .select('transakce_id, faktura, faktura_id, castka_haleru, stav, zpusob')
      .eq('tenant_id', tenantId).in('stav', ['potvrzeno', 'zamitnuto'])
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b), 'Párování')
    const fakturyRadky = await vsechnyStranky<RadekFaktury>((a, b) => fakturyFirmy(pristup,
      'id, variabilni_symbol, castka_haleru, datum_vystaveni, duzp, dodavatel, stav, duplicita, archivovano, mena, ucet_dodavatele')
      .order('id', { ascending: true }).range(a, b), 'Faktury')
    if (!transakce || !alokace || !fakturyRadky) {
      return prazdny('preskoceno', 'Dat je víc, než appka umí najednou posoudit — automatické párování se v tomhle běhu vynechalo.')
    }

    // Stornované pohyby: storno ukazuje na původní (storno_of). Storno
    // starší než 180 dní by tu chybělo — databáze to posoudí znovu.
    const stornovane = new Set<string>()
    for (const t of transakce) if (t.storno_of) stornovane.add(t.storno_of)

    // Řádky výpisu, které potvrdilo stažení z banky (transakce_potvrzeni_banky):
    // stažení je podruhé nezapsalo, platba z banky je tedy ten řádek výpisu.
    // Ptá se jen na řádky výpisu načtené výš, po kouscích.
    const potvrzeneBankou = new Set<string>()
    const radkyVypisu = transakce.filter((t) => t.zdroj === 'csv_banka').map((t) => t.id)
    for (let i = 0; i < radkyVypisu.length; i += POTVRZENI_NAJEDNOU) {
      const { data, error } = await supabase.from('transakce_potvrzeni_banky').select('transakce_id')
        .eq('tenant_id', tenantId).in('transakce_id', radkyVypisu.slice(i, i + POTVRZENI_NAJEDNOU))
      if (error) throw new Error(`Potvrzení z banky: ${error.message}`)
      for (const r of (data ?? []) as { transakce_id: string }[]) potvrzeneBankou.add(r.transakce_id)
    }

    // Protistrana = jméno, jinak číslo účtu (autoTransakceZRadku) — pravidla
    // párování stojí na neprázdné protistraně.
    const autoTransakce: AutoTransakce[] = transakce.map((t) => autoTransakceZRadku(t, potvrzeneBankou, stornovane))
    // I faktury bez přečtené částky (castkaHaleru 0) — pravidlo je počítá jako soupeře.
    const autoFaktury: AutoFaktura[] = fakturyRadky.map((f) => ({
      id: String(f.id), vs: f.variabilni_symbol,
      castkaHaleru: typeof f.castka_haleru === 'number' && Number.isFinite(f.castka_haleru) ? f.castka_haleru : 0,
      dodavatel: f.dodavatel, datum: f.datum_vystaveni ?? f.duzp, stav: f.stav,
      alokovanoHaleru: 0, duplicita: f.duplicita === true,
      archivovana: f.archivovano === true, mena: f.mena, ucetDodavatele: f.ucet_dodavatele,
    }))

    // Součty párování.
    const naTransakci = new Map<string, number>()
    const naFakturu = new Map<string, number>()
    const zamitnute = new Set<string>()
    for (const a of alokace) {
      const faktura = a.faktura ?? a.faktura_id
      if (a.stav === 'zamitnuto') {
        zamitnute.add(`${a.transakce_id}|${faktura}`)
        continue
      }
      naTransakci.set(a.transakce_id, (naTransakci.get(a.transakce_id) ?? 0) + a.castka_haleru)
      naFakturu.set(faktura, (naFakturu.get(faktura) ?? 0) + a.castka_haleru)
    }
    for (const t of autoTransakce) t.alokovanoHaleru = naTransakci.get(t.id) ?? 0
    for (const f of autoFaktury) f.alokovanoHaleru = naFakturu.get(f.id) ?? 0

    // --- 2. nové jednoznačné shody -------------------------------------------
    // Databáze stav faktury přepočítá sama (sparovat_jiste_interne).
    let sparovano = 0
    for (const p of vybratAutomatickaParovani(autoTransakce, autoFaktury, { zamitnute })) {
      if (Date.now() >= konecMs) break
      const { data: zapsano, error } = await supabase.rpc('automaticky_sparovat_fakturu', {
        p_tenant: tenantId, p_transakce: p.transakceId, p_faktura: p.fakturaId, p_castka_haleru: p.castkaHaleru,
      })
      if (error) throw new Error(`Párování: ${error.message}`)
      if (zapsano === true) sparovano++
    }

    // --- 3. dorovnání stavu podle potvrzených plateb -------------------------
    // Kandidáti: faktury s potvrzeným párováním, jejichž stav podle součtu
    // nesedí (dřív se přepnutí ve Fakturách mohlo nepovést). Co je správně,
    // rozhodne databáze (prepocitat_stav_faktury → faktura_stav_podle_plateb,
    // i ruční úhrady a měnu faktury) — appka stav sama nezapisuje.
    let dorovnano = 0
    for (const z of dorovnatStavy(autoFaktury.filter((f) => !f.archivovana), naFakturu)) {
      if (Date.now() >= konecMs) break
      const { data, error } = await supabase.rpc('prepocitat_stav_faktury', { p_tenant: tenantId, p_faktura: z.fakturaId })
      if (!error && typeof data === 'string' && data !== z.puvodni) dorovnano++
    }

    return { stav: 'ok', sparovano, dorovnano, duvod: null }
  } catch (e) {
    return prazdny('chyba', (e instanceof Error ? e.message : String(e)).slice(0, 300))
  }
}
