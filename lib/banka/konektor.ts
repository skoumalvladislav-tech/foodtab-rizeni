/**
 * Neutrální bankovní vrstva — společný tvar pohybu, rozhraní konektoru
 * a registr konektorů (Finance Fáze 0, krok 1; docs/finance-faze0-zadani.md).
 *
 * ---------------------------------------------------------------------
 * PROČ
 *
 * Párování, Jiné platby, přehled tržeb i úloha synchronizace dřív znaly
 * jednotlivé banky jménem (zdroj pohybu, seznam v úloze, mapa
 * u tlačítka „Synchronizovat teď"). Každá další banka tak znamenala
 * zásah do míst, která s bankou nemají nic společného. Teď:
 *
 *   * pohyb z jakékoli banky má jeden tvar (`PohybBanky`) a jeden zdroj
 *     v databázi (`banka_api`, migrace 20261119100000);
 *   * co umí konkrétní banka, ví jen její konektor;
 *   * úloha i tlačítko berou konektory z registru — nová banka = nový
 *     konektor v `lib/banka/konektory.ts`, nic jiného.
 *
 * Jména bank sem nepatří (hlídá scripts/banka-jadro-bez-jmen.test.mjs).
 * Banka je jen pro čtení: rozhraní nemá nic, co by platbu zadalo.
 *
 * Čistá logika bez IO a bez `server-only` — testuje ji Node přímo
 * (scripts/banka-konektor.test.mjs).
 */

import { normalizovatUcet } from './ucet.ts'

/** Zdroj pohybu i zůstatku staženého z banky — jeden pro všechny banky. */
export const ZDROJ_BANKY_API = 'banka_api'

export type SmerPohybu = 'prijem' | 'vydaj'

/** Jeden pohyb na účtu — stejný tvar z API banky i z importovaného výpisu. */
export type PohybBanky = {
  /** `YYYY-MM-DD` */
  datum: string
  smer: SmerPohybu
  /** Kladné haléře — směr nese `smer`. */
  castkaHaleru: number
  mena: string
  /** Jméno protistrany. Číslo účtu sem nepatří — to je `protiucet`. */
  protistrana: string
  /** Číslo účtu protistrany (normalizovatUcet), prázdné, když ho banka nedala. */
  protiucet: string
  vs: string
  poznamka: string
  /** Id pohybu od banky. Null = bez id; dvojí import pak hlídá otisk. */
  externiId: string | null
}

export type ZustatekBanky = {
  typ: 'knihovni' | 'disponibilni'
  castkaHaleru: number
  mena: string
  /** Kdy zůstatek platil podle banky — ne kdy ho appka stáhla. */
  platnyK: string
}

export type VysledekStazeni = { stav: 'ok'; pohyby: PohybBanky[] } | { stav: 'chyba'; duvod: string }
export type VysledekZustatku = { stav: 'ok'; zustatky: ZustatekBanky[] } | { stav: 'chyba'; duvod: string }

export type VysledekSynchronizaceBanky =
  | { stav: 'ok'; pocetNovychRadku: number }
  | { stav: 'preskoceno'; duvod: string }
  | { stav: 'chyba'; duvod: string }

/**
 * Přístup k jednomu účtu u banky (token, id účtu, …). Co přesně v něm
 * je, ví jen konektor; jádro ho jen předává a nikam nezapisuje.
 */
export type PristupKUctu = Readonly<Record<string, string>>

export type DruhKonektoru = 'api' | 'vypis'

export type KonektorBanky = {
  /** Hodnota `integrace_pripojeni.poskytovatel` — jediné místo, kde se banka pozná. */
  poskytovatel: string
  /** Jméno pro lidi (dlaždice, hlášky). */
  nazev: string
  /** `api` = stahuje appka sama, `vypis` = člověk nahraje soubor. */
  druh: DruhKonektoru
  /** Smí appka teď nabídnout NOVÉ připojení? (Nastavení serveru, ukončené API.) */
  nabizetPripojeni(): boolean
  /** Pohyby od data `od` (`YYYY-MM-DD`) do dneška. Jen čtení. */
  stahnoutPohyby?(pristup: PristupKUctu, od: string): Promise<VysledekStazeni>
  /** Aktuální zůstatky účtu. Jen čtení. */
  nactiZustatky?(pristup: PristupKUctu): Promise<VysledekZustatku>
  /**
   * Celá synchronizace jednoho připojení (zámek běhu, přístup, stažení,
   * zápis, stav připojení) — volá ji úloha i „Synchronizovat teď".
   */
  synchronizovat?(pripojeniId: string): Promise<VysledekSynchronizaceBanky>
  /** Připojení tohohle konektoru, která je čas synchronizovat (napříč firmami — jen pro úlohu). */
  aktivniPripojeni?(): Promise<{ id: string }[]>
  /**
   * Další připojení začít jen do tolika ms od začátku úlohy — dlouhé
   * stahování by jinak přetáhlo strop úlohy. Ostatní vezme příští běh.
   */
  zacitNejpozdejiMs?: number
}

export type Synchronizatory = Readonly<Record<string, (pripojeniId: string) => Promise<VysledekSynchronizaceBanky>>>

export type RegistrBanky = {
  /** Konektory v pořadí, v jakém je úloha zpracuje. */
  readonly vsechny: readonly KonektorBanky[]
  najit(poskytovatel: string): KonektorBanky | undefined
  /** Poskytovatel → synchronizace (jen konektory, které ji mají). */
  synchronizatory(): Synchronizatory
  /** Konektory, jejichž nové připojení se teď smí nabídnout. */
  kNabidce(): KonektorBanky[]
  nazvyKNabidce(): string[]
}

export function vytvoritRegistr(konektory: readonly KonektorBanky[]): RegistrBanky {
  const podleJmena = new Map<string, KonektorBanky>()
  for (const k of konektory) {
    if (!k.poskytovatel.trim()) throw new Error('Konektor banky nemá poskytovatele.')
    if (podleJmena.has(k.poskytovatel)) throw new Error(`Konektor banky „${k.poskytovatel}" je v registru dvakrát.`)
    podleJmena.set(k.poskytovatel, k)
  }
  const vsechny = Object.freeze([...konektory])

  return {
    vsechny,
    najit: (poskytovatel) => podleJmena.get(poskytovatel),
    synchronizatory() {
      const mapa: Record<string, (pripojeniId: string) => Promise<VysledekSynchronizaceBanky>> = Object.create(null)
      for (const k of vsechny) {
        const synchronizovat = k.synchronizovat
        if (synchronizovat) mapa[k.poskytovatel] = (id) => synchronizovat(id)
      }
      return mapa
    },
    kNabidce: () => vsechny.filter((k) => k.nabizetPripojeni()),
    nazvyKNabidce: () => vsechny.filter((k) => k.nabizetPripojeni()).map((k) => k.nazev),
  }
}

/**
 * Nabídka pro lidi — dlaždice a hlášky v Integracích ji berou odsud,
 * ne vyjmenovanou napevno: „import výpisu (CSV), X a Y". Co se nabízet
 * nesmí (nenastavené na serveru, ukončené API), v ní není.
 */
export function popisNabidky(registr: Pick<RegistrBanky, 'nazvyKNabidce'>): string {
  const nazvy = registr.nazvyKNabidce()
  if (nazvy.length <= 1) return nazvy.join('')
  return `${nazvy.slice(0, -1).join(', ')} a ${nazvy[nazvy.length - 1]}`
}

/** Řádky pro `importovat_vypis` — klíče v snake_case, protiúčet v jednom tvaru, pořadí i stejné řádky beze změny. */
export function radkyProImport(pohyby: readonly PohybBanky[]) {
  return pohyby.map((p) => ({
    datum: p.datum,
    smer: p.smer,
    castka_haleru: p.castkaHaleru,
    mena: p.mena,
    protistrana: p.protistrana,
    protiucet: normalizovatUcet(p.protiucet),
    vs: p.vs,
    poznamka: p.poznamka,
    externi_id: p.externiId,
  }))
}

export type VysledekUlohy = { stav: VysledekSynchronizaceBanky['stav']; novychRadku: number }

/**
 * Úloha synchronizace: všechna aktivní připojení všech konektorů,
 * JEDNO PO DRUHÉM v pořadí registru (banky mají limity na souběžná
 * volání a dva zápisy do téhož účtu by si šlapaly na zámek běhu).
 * Souběžně se načtou jen seznamy připojení — to je čtení z appčiny
 * databáze, ne volání banky.
 */
export async function synchronizovatVsechnaPripojeni(
  registr: RegistrBanky,
  hodiny: { zacatek: number; ted: () => number } = { zacatek: Date.now(), ted: () => Date.now() },
): Promise<VysledekUlohy[]> {
  const konektory = registr.vsechny.filter((k) => k.synchronizovat && k.aktivniPripojeni)
  const seznamy = await Promise.all(konektory.map((k) => k.aktivniPripojeni!()))

  const vysledky: VysledekUlohy[] = []
  for (let i = 0; i < konektory.length; i++) {
    const k = konektory[i]
    for (const p of seznamy[i]) {
      if (k.zacitNejpozdejiMs !== undefined && hodiny.ted() - hodiny.zacatek > k.zacitNejpozdejiMs) {
        vysledky.push({ stav: 'preskoceno', novychRadku: 0 })
        continue
      }
      const v = await k.synchronizovat!(p.id)
      vysledky.push({ stav: v.stav, novychRadku: v.stav === 'ok' ? v.pocetNovychRadku : 0 })
    }
  }
  return vysledky
}
