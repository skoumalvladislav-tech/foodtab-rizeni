import 'server-only'

/**
 * Počasí pro widget na Dnes — api.met.no (MET Norsko).
 *
 * ---------------------------------------------------------------------
 * PROČ ZROVNA TAHLE SLUŽBA
 *
 * Zdarma i pro komerční provoz (appka půjde k prodeji) — data jsou
 * CC BY 4.0, což dovoluje komerční použití s uvedením zdroje. Hodně
 * „zdarma" počasních API (Open-Meteo mezi nimi) mají zdarma tarif
 * vázaný na NEKOMERČNÍ použití — pro appku, která se prodává, by to
 * neplatilo. api.met.no žádnou takovou podmínku nemá, jen chce
 * identifikovat volajícího přes User-Agent (viz níž) a mírné omezení
 * rychlosti (20 req/s na appku, sem se ani nepřiblížíme).
 *
 * ---------------------------------------------------------------------
 * SELŽE POTICHU, NE HLUČNĚ
 *
 * Stejná úvaha jako u lib/marketing-n8n.ts a lib/marketing-spojeni.ts:
 * cizí služba, cizí výpadek. Widget počasí není nic, na čem by závisel
 * provoz restaurace — když MET Norsko neodpoví (výpadek, přetížení,
 * nebo třeba blokace datacentrové IP adresy, kterou se nedá ověřit
 * jinak než nasazením), Dnes se má vykreslit úplně stejně, jen bez
 * něj. Volající si podle `stav` sám rozhodne nekreslit nic.
 */

const CEKANI_MS = 5000

export type Pocasi = {
  teplotaC: number
  stavPocasi: string
}

export type VysledekPocasi = { stav: 'ok'; pocasi: Pocasi } | { stav: 'chyba'; duvod: string }

/**
 * Český popis z `symbol_code` MET Norska.
 *
 * Kód má tvar `zaklad_day`/`_night`/`_polartwilight` — přípona se
 * odsekne, protože appce jde jen o to, co se má napsat vedle teploty,
 * ne jestli je den nebo noc (to je vidět z hodin samotných).
 *
 * Neznámý kód nekazí widget — vrátí se holé „Počasí", teplota pořád
 * má cenu ukázat.
 */
function popisPodleKodu(kod: string | undefined): string {
  const zaklad = (kod ?? '').replace(/_(day|night|polartwilight)$/, '')
  const POPISY: Record<string, string> = {
    clearsky: 'Jasno',
    fair: 'Skoro jasno',
    partlycloudy: 'Polojasno',
    cloudy: 'Zataženo',
    fog: 'Mlha',
    lightrainshowers: 'Přeháňky',
    rainshowers: 'Přeháňky',
    heavyrainshowers: 'Silné přeháňky',
    lightrainshowersandthunder: 'Přeháňky s bouřkou',
    rainshowersandthunder: 'Přeháňky s bouřkou',
    heavyrainshowersandthunder: 'Silné přeháňky s bouřkou',
    lightsleetshowers: 'Přeháňky se sněhem s deštěm',
    sleetshowers: 'Přeháňky se sněhem s deštěm',
    heavysleetshowers: 'Silné přeháňky se sněhem s deštěm',
    lightsnowshowers: 'Sněhové přeháňky',
    snowshowers: 'Sněhové přeháňky',
    heavysnowshowers: 'Silné sněhové přeháňky',
    lightrain: 'Slabý déšť',
    rain: 'Déšť',
    heavyrain: 'Silný déšť',
    lightrainandthunder: 'Slabý déšť s bouřkou',
    rainandthunder: 'Déšť s bouřkou',
    heavyrainandthunder: 'Silný déšť s bouřkou',
    lightsleet: 'Slabý déšť se sněhem',
    sleet: 'Déšť se sněhem',
    heavysleet: 'Silný déšť se sněhem',
    lightsnow: 'Slabé sněžení',
    snow: 'Sněžení',
    heavysnow: 'Silné sněžení',
    lightsnowandthunder: 'Slabé sněžení s bouřkou',
    snowandthunder: 'Sněžení s bouřkou',
    heavysnowandthunder: 'Silné sněžení s bouřkou',
  }
  return POPISY[zaklad] ?? 'Počasí'
}

/** Krátí cizí text, než smí dál — stejné pravidlo jako u ostatních
 * volání ven (lib/marketing-spojeni.ts, funkce `zkratit`). */
function zkratit(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * Počasí pro jedny souřadnice.
 *
 * `lat`/`lon` přichází z branches.lat/lon (migrace
 * 20260916170000_pobocka_pocasi.sql) — volající si musí ověřit, že
 * existují, dřív než sem sáhne. Bez nich appka volání vůbec nezkouší,
 * stejně jako to dělá n8nJeNastaveny() u marketingu.
 */
export async function nactiPocasi(lat: number, lon: number): Promise<VysledekPocasi> {
  const latOk = Math.round(lat * 100) / 100
  const lonOk = Math.round(lon * 100) / 100

  try {
    const odpoved = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latOk}&lon=${lonOk}`,
      {
        headers: {
          // MET Norsko chce v User-Agentu umět appku identifikovat,
          // ne obecný fetch. Bez toho hrozí zablokování — viz
          // https://api.met.no/doc/TermsOfService.
          'User-Agent': 'FoodtabRizeni/1.0 (https://foodtab-rizeni.vercel.app)',
        },
        signal: AbortSignal.timeout(CEKANI_MS),
      },
    )

    if (!odpoved.ok) {
      const telo = await odpoved.text().catch(() => '')
      return { stav: 'chyba', duvod: `MET Norsko: ${odpoved.status} ${zkratit(telo, 200)}` }
    }

    const json = (await odpoved.json()) as {
      properties?: {
        timeseries?: {
          data?: {
            instant?: { details?: { air_temperature?: number } }
            next_1_hours?: { summary?: { symbol_code?: string } }
            next_6_hours?: { summary?: { symbol_code?: string } }
          }
        }[]
      }
    }

    const ted = json.properties?.timeseries?.[0]?.data
    const teplota = ted?.instant?.details?.air_temperature
    if (typeof teplota !== 'number') {
      return { stav: 'chyba', duvod: 'MET Norsko: odpověď bez teploty.' }
    }

    const kod = ted?.next_1_hours?.summary?.symbol_code ?? ted?.next_6_hours?.summary?.symbol_code

    return {
      stav: 'ok',
      pocasi: { teplotaC: Math.round(teplota), stavPocasi: popisPodleKodu(kod) },
    }
  } catch (e) {
    return { stav: 'chyba', duvod: zkratit(e instanceof Error ? e.message : String(e), 200) }
  }
}
