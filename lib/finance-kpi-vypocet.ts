/**
 * KPI karet Finance → Přehled — co se načte a jak se z toho počítá, bez
 * `server-only` a s podstrčeným načítáním, ať to jde ověřit bez databáze
 * (`scripts/finance-obdobi.test.mjs`). Dotazy do databáze a výklad, odkud
 * která karta bere čísla, jsou v `lib/finance-kpi.ts`.
 *
 * HODNOTA karty je vždy za CELÝ zobrazený měsíc. TREND srovnává okna ze
 * `srovnaniMesice` (lib/finance-obdobi.ts) — na všech pěti kartách stejná:
 *   * rozběhnutý měsíc: 1. až včerejšek proti týmž dnům minulého měsíce;
 *   * uzavřený měsíc: celý proti celému minulému;
 *   * první den měsíce a budoucí měsíc: žádný trend.
 * Výjimka jsou náklady práce: mzdy (`vydelky_prehled`) jsou jen po celých
 * měsících, takže jejich trend je jen u uzavřeného měsíce.
 */

import { jenPobocka, pokrytiRozsahu, type PrehledTrzeb } from './pokladna-trzby.ts'
import type { Rozsah, SrovnaniMesice } from './finance-obdobi.ts'
import type { CashflowPrehled, RadekVysledovkyStrediska } from './finance-prehled.ts'

const NAZVY_KATEGORII: Record<string, string> = {
  trzby: 'Tržby',
  suroviny: 'Suroviny',
  mzdy: 'Mzdy',
  najem: 'Nájem',
  energie: 'Energie',
  marketing: 'Marketing',
  ostatni: 'Ostatní',
  nezarazeno: 'Nezařazené',
}

export type RadekNakladu = { kategorie: string; nazev: string; castkaHaleru: number }

export type RadekFoodcostBeverage = { druh: string; trzby_haleru: number; naklady_haleru: number; trzby_bez_nakladu_haleru: number }

/** Hodnota aktuálního a předchozího okna trendu. */
export type DvojiceTrendu = { aktualni: number; predchozi: number }

export type FinanceKpi = {
  /**
   * Odkud jsou `trzbyHaleru` (a tím i jmenovatel nákladů práce).
   * `nenacteno` = tržby z pokladen se nepodařilo načíst — karta ukáže „–".
   * `bez_zdroje` = jen na pobočce: v obou měsících žádná data z pokladny
   * a pobočka nemá vlastní platební účet — karta ukáže „–" a proč.
   */
  zdrojTrzeb: 'pokladna' | 'platby' | 'nenacteno' | 'bez_zdroje'
  /** U tržeb z pokladen: kolik aktivních poboček (na pobočce: 0 nebo 1) má v měsíci data z pokladny. */
  pokrytiPokladnou: { maji: number; celkem: number } | null
  /**
   * Jen na pobočce: nemá žádný platební účet se svou `branch_id`. Čísla
   * z plateb (cashflow, náklady podle kategorie) pak NEJSOU nula — appka
   * je za pobočku nemá. Za celou firmu vždy `false`.
   */
  pobockaBezUctu: boolean
  trzbyHaleru: number
  /**
   * `false` = karta Tržby nemá číslo a ukáže „–", ne 0 Kč: nenačteno, bez
   * zdroje, nebo pokladna za měsíc zatím nic neposlala (data má jen ten
   * předchozí).
   */
  trzbyMajiData: boolean
  /** Trend tržeb — z pokladen jen mezi stejnými sadami poboček. `null` = nesrovnává se. */
  trendTrzby: DvojiceTrendu | null
  cashflowHaleru: number
  trendCashflow: DvojiceTrendu | null
  /**
   * Teoretický foodcost — prodané množství × platná receptura (zadání,
   * oddíl 7), ne peněžní výdej za nákup surovin. `null` = buď nulové
   * tržby z jídla v období, nebo appka ještě nemá jediný prodej
   * s napojenou a úplnou recepturou typu "jídlo" (viz foodcostPokryto).
   */
  foodcostProcento: number | null
  trendFoodcost: DvojiceTrendu | null
  /** Kolik z tržeb za jídlo appka reálně pokryla spočítaným nákladem — nízké číslo = foodcostProcento se opírá o málo dat. */
  foodcostPokrytoProcento: number | null
  /** Totéž jako foodcost výš, jen pro recepty typu "nápoj". */
  beverageCostProcento: number | null
  trendBeverageCost: DvojiceTrendu | null
  beverageCostPokrytoProcento: number | null
  /** `null` = chybí `payroll.read`, appka kartu nevynucuje. */
  nakladyPraceProcento: number | null
  /** Jen u uzavřeného měsíce (mzdy jsou po celých měsících). */
  trendNakladyPrace: DvojiceTrendu | null
  nakladyPodleKategorie: RadekNakladu[]
}

/** Načítání z databáze — `lib/finance-kpi.ts` ho podá skutečné, test podstrčené. */
export type NacitaniKpi = {
  cashflow: (r: Rozsah) => Promise<CashflowPrehled>
  vysledovka: (r: Rozsah) => Promise<RadekVysledovkyStrediska[]>
  foodcostBeverage: (r: Rozsah) => Promise<RadekFoodcostBeverage[]>
  /** Součet mezd za KALENDÁŘNÍ měsíc, do kterého patří `den`. */
  mzdy: (den: string) => Promise<number>
  /** Přehled tržeb z pokladen PO DNECH; `null` = funkce v databázi ještě není. */
  pokladny: (od: string, doData: string) => Promise<PrehledTrzeb | null>
  /** Má pobočka vlastní platební účet? Volá se jen na pobočce. */
  pobockaMaUcet: (pobocka: string) => Promise<boolean>
}

export type VstupKpi = {
  /** Zobrazený měsíc a měsíc před ním — CELÉ (hodnoty karet, zdroj tržeb). */
  obdobi: Rozsah
  predchoziObdobi: Rozsah
  /** Okna trendu (`srovnaniMesice`). */
  srovnani: SrovnaniMesice
  /** Id aktivních poboček firmy. */
  aktivniPobocky: readonly string[]
  /** Pobočka rozsahu (`pobockaFinanci`), `null` = celá firma. */
  pobocka: string | null
  smiVidetMzdy: boolean
}

/** `null` = nulové tržby daného druhu, procento nemá smysl počítat. */
function procentoNakladu(radky: readonly RadekFoodcostBeverage[], druh: 'jidlo' | 'napoj'): number | null {
  const r = radky.find((x) => x.druh === druh)
  if (!r || r.trzby_haleru <= 0) return null
  return (r.naklady_haleru / r.trzby_haleru) * 100
}

/** Kolik % tržeb daného druhu má vůbec spočítaný náklad (zbytek je bez napojené nebo neúplné receptury). */
function procentoPokryti(radky: readonly RadekFoodcostBeverage[], druh: 'jidlo' | 'napoj'): number | null {
  const r = radky.find((x) => x.druh === druh)
  if (!r || r.trzby_haleru <= 0) return null
  return ((r.trzby_haleru - r.trzby_bez_nakladu_haleru) / r.trzby_haleru) * 100
}

/**
 * Příjmy a výdaje rozsahu z `cashflow_prehled` (+ `_firma`). Celá firma =
 * všechny pobočky + firemní účty. Pobočka = JEN její řádek — firemní účty
 * a ostatní pobočky se do ní nepřičítají ani nerozpočítávají.
 */
function soucetPrijmyVydaje(cf: CashflowPrehled, pobocka: string | null) {
  const pobocky = pobocka === null ? cf.pobocky : cf.pobocky.filter((p) => p.branchId === pobocka)
  const firemniPrijmy = pobocka === null ? cf.firma.skutecnostPrijmyHaleru : 0
  const firemniVydaje = pobocka === null ? cf.firma.skutecnostVydajeHaleru : 0
  const prijmy = pobocky.reduce((s, p) => s + p.skutecnostPrijmyHaleru, 0) + firemniPrijmy
  const vydaje = pobocky.reduce((s, p) => s + p.skutecnostVydajeHaleru, 0) + firemniVydaje
  return { prijmy, vydaje }
}

function dvojice(aktualni: number | null, predchozi: number | null): DvojiceTrendu | null {
  return aktualni !== null && predchozi !== null ? { aktualni, predchozi } : null
}

export async function sestavitFinanceKpi(v: VstupKpi, nacti: NacitaniKpi): Promise<FinanceKpi> {
  const { obdobi, predchoziObdobi, srovnani, pobocka } = v
  // Okna trendu: stejné dny (rozběhnutý měsíc), celé měsíce (uzavřený), nebo žádná.
  const trendOkna = srovnani.druh === 'stejne_dny'
    ? { aktualni: srovnani.aktualni, predchozi: srovnani.predchozi }
    : srovnani.druh === 'cele' ? { aktualni: obdobi, predchozi: predchoziObdobi } : null
  // U uzavřeného měsíce je aktuální okno trendu celý měsíc — znovu se nenačítá.
  const celyMesic = srovnani.druh === 'cele'
  // Mzdy jsou jen po celých měsících: předchozí měsíc (a tím trend nákladů
  // práce) jen u uzavřeného měsíce, jinak by se půlka měsíce dělila celým.
  const mzdyPredchozihoMesice = v.smiVidetMzdy && celyMesic

  const [cfMesic, cfTrendA, cfTrendP, vysledovka, fbMesic, fbTrendA, fbTrendP, mzdyMesic, mzdyPredchozi, pokladny, maUcet] = await Promise.all([
    nacti.cashflow(obdobi),
    trendOkna && !celyMesic ? nacti.cashflow(trendOkna.aktualni) : Promise.resolve(null),
    trendOkna ? nacti.cashflow(trendOkna.predchozi) : Promise.resolve(null),
    nacti.vysledovka(obdobi),
    nacti.foodcostBeverage(obdobi),
    trendOkna && !celyMesic ? nacti.foodcostBeverage(trendOkna.aktualni) : Promise.resolve(null),
    trendOkna ? nacti.foodcostBeverage(trendOkna.predchozi) : Promise.resolve(null),
    v.smiVidetMzdy ? nacti.mzdy(obdobi.od) : Promise.resolve(null),
    mzdyPredchozihoMesice ? nacti.mzdy(predchoziObdobi.od) : Promise.resolve(null),
    // Oba měsíce jedním dotazem PO DNECH (≤ 62 dní) — z něj se sečtou celé
    // měsíce i okna trendu. Chyba tržeb z pokladen nesmí shodit Cashflow ani
    // náklady (dřív na pokladně nezávisely) — karta Tržby pak řekne, že se
    // nenačetly.
    nacti.pokladny(predchoziObdobi.od, obdobi.doData).catch((): 'chyba' => 'chyba'),
    pobocka === null ? Promise.resolve(true) : nacti.pobockaMaUcet(pobocka),
  ])

  const mesic = soucetPrijmyVydaje(cfMesic, pobocka)
  const cfTrendAktualni = celyMesic ? cfMesic : cfTrendA
  const platbyTrendu = cfTrendAktualni && cfTrendP
    ? { aktualni: soucetPrijmyVydaje(cfTrendAktualni, pobocka), predchozi: soucetPrijmyVydaje(cfTrendP, pobocka) }
    : null
  const fbTrendAktualni = celyMesic ? fbMesic : fbTrendA

  // Na pobočce jen ona: přehled pokladen zúžený na ni a „aktivní" = jen ona
  // (pokrytí je pak 0, nebo 1 z 1).
  const aktivni = v.aktivniPobocky.filter((id) => pobocka === null || id === pobocka)
  const prehledPokladen = pokladny === 'chyba' || pokladny === null ? null : jenPobocka(pokladny, pobocka)
  const posMesic = prehledPokladen ? pokrytiRozsahu(prehledPokladen, obdobi.od, obdobi.doData, aktivni) : null
  const posPredchozi = prehledPokladen ? pokrytiRozsahu(prehledPokladen, predchoziObdobi.od, predchoziObdobi.doData, aktivni) : null
  // Nenačtené tržby z pokladen se NEnahrazují příjmy z plateb — karta by
  // nesla číslo z jiného zdroje pod stejným jménem. Pobočka bez pokladních
  // dat i bez vlastního účtu nemá tržby odkud vzít (`bez_zdroje`) — „0 Kč
  // z přijatých plateb" by tvrdilo, že nic nepřišlo.
  const zdrojTrzeb: FinanceKpi['zdrojTrzeb'] =
    pokladny === 'chyba' ? 'nenacteno'
      : posMesic?.maData || posPredchozi?.maData ? 'pokladna'
        : pobocka !== null && !maUcet ? 'bez_zdroje'
          : 'platby'
  const zPokladen = zdrojTrzeb === 'pokladna'
  const pobockaBezUctu = pobocka !== null && !maUcet
  const trzbyHaleru = zdrojTrzeb === 'platby' ? mesic.prijmy : (posMesic?.trzbaHaleru ?? 0)

  // Trend tržeb z pokladen jen mezi stejnými sadami poboček (jinak by
  // pobočka, která se připojila v půli, vypadala jako růst).
  let trendTrzby: DvojiceTrendu | null = null
  if (zdrojTrzeb === 'platby' && platbyTrendu) {
    trendTrzby = { aktualni: platbyTrendu.aktualni.prijmy, predchozi: platbyTrendu.predchozi.prijmy }
  } else if (zPokladen && prehledPokladen && trendOkna) {
    const a = pokrytiRozsahu(prehledPokladen, trendOkna.aktualni.od, trendOkna.aktualni.doData, aktivni)
    const p = pokrytiRozsahu(prehledPokladen, trendOkna.predchozi.od, trendOkna.predchozi.doData, aktivni)
    if (a.maData && p.maData && a.pobocky.join() === p.pobocky.join()) trendTrzby = { aktualni: a.trzbaHaleru, predchozi: p.trzbaHaleru }
  }
  // Pobočka bez vlastního účtu cashflow nemá — ani trend.
  const trendCashflow: DvojiceTrendu | null = platbyTrendu && !pobockaBezUctu
    ? { aktualni: platbyTrendu.aktualni.prijmy - platbyTrendu.aktualni.vydaje, predchozi: platbyTrendu.predchozi.prijmy - platbyTrendu.predchozi.vydaje }
    : null

  // Náklady práce: mzdy jsou za všechny pobočky rozsahu — z pokladen jen při
  // úplném pokrytí (na pobočce: když její pokladna v měsíci něco poslala).
  const praceMesic = zdrojTrzeb === 'platby' || (zPokladen && (posMesic?.uplne ?? false))
  const nakladyPraceProcento = mzdyMesic !== null && praceMesic && trzbyHaleru > 0 ? (mzdyMesic / trzbyHaleru) * 100 : null
  // Jmenovatel předchozího měsíce: jeho vlastní tržby (i když se kvůli jiné
  // sadě poboček nesrovnávají na kartě Tržby). Mzdy předchozího měsíce jsou
  // načtené jen u uzavřeného měsíce — tam je předchozí okno celý měsíc.
  const pracePredchozi = zdrojTrzeb === 'platby' || (zPokladen && (posPredchozi?.uplne ?? false))
  const trzbyPredchoziProPraci = zPokladen ? (posPredchozi?.trzbaHaleru ?? 0) : (platbyTrendu?.predchozi.prijmy ?? 0)
  const nakladyPracePredchozi = mzdyPredchozi !== null && pracePredchozi && trzbyPredchoziProPraci > 0
    ? (mzdyPredchozi / trzbyPredchoziProPraci) * 100
    : null

  const nakladyPodleKategorieMapa = new Map<string, number>()
  for (const r of vysledovka) {
    if (r.smer !== 'vydaj') continue
    nakladyPodleKategorieMapa.set(r.kategorie, (nakladyPodleKategorieMapa.get(r.kategorie) ?? 0) + r.castkaHaleru)
  }
  const nakladyPodleKategorie: RadekNakladu[] = [...nakladyPodleKategorieMapa.entries()]
    .map(([kategorie, castkaHaleru]) => ({ kategorie, nazev: NAZVY_KATEGORII[kategorie] ?? kategorie, castkaHaleru }))
    .filter((r) => r.castkaHaleru > 0)
    .sort((a, b) => b.castkaHaleru - a.castkaHaleru)

  return {
    zdrojTrzeb,
    pokrytiPokladnou: zPokladen && posMesic ? { maji: posMesic.pokrytych, celkem: posMesic.aktivnich } : null,
    pobockaBezUctu,
    trzbyHaleru,
    trzbyMajiData: zdrojTrzeb === 'platby' || (zPokladen && (posMesic?.maData ?? false)),
    trendTrzby,
    cashflowHaleru: mesic.prijmy - mesic.vydaje,
    trendCashflow,
    foodcostProcento: procentoNakladu(fbMesic, 'jidlo'),
    trendFoodcost: fbTrendAktualni && fbTrendP ? dvojice(procentoNakladu(fbTrendAktualni, 'jidlo'), procentoNakladu(fbTrendP, 'jidlo')) : null,
    foodcostPokrytoProcento: procentoPokryti(fbMesic, 'jidlo'),
    beverageCostProcento: procentoNakladu(fbMesic, 'napoj'),
    trendBeverageCost: fbTrendAktualni && fbTrendP ? dvojice(procentoNakladu(fbTrendAktualni, 'napoj'), procentoNakladu(fbTrendP, 'napoj')) : null,
    beverageCostPokrytoProcento: procentoPokryti(fbMesic, 'napoj'),
    nakladyPraceProcento,
    trendNakladyPrace: dvojice(nakladyPraceProcento, nakladyPracePredchozi),
    nakladyPodleKategorie,
  }
}

/**
 * Změna aktuálního okna trendu vůči předchozímu: `%` vůči předchozímu,
 * `p. b.` jako rozdíl. `null` = nesrovnává se, nebo je u procent nulový
 * základ. Kladná = vzrostlo (u záporného základu, třeba cashflow −100 → −50,
 * taky kladná: zlepšení).
 */
export function zmenaTrendu(dvojice: DvojiceTrendu | null, jednotka: '%' | 'p. b.'): number | null {
  if (dvojice === null) return null
  const { aktualni, predchozi } = dvojice
  if (jednotka === 'p. b.') return aktualni - predchozi
  if (predchozi === 0) return null
  return ((aktualni - predchozi) / Math.abs(predchozi)) * 100
}

/** Odkud je číslo na kartě Tržby — „–" na kartě musí říct proč. */
export function popisZdrojeTrzeb(kpi: FinanceKpi, naPobocce: boolean): string {
  if (kpi.zdrojTrzeb === 'nenacteno') return 'tržby z pokladen se nepodařilo načíst'
  if (kpi.zdrojTrzeb === 'bez_zdroje') return 'pobočka nemá data z pokladny ani vlastní platební účet'
  if (kpi.zdrojTrzeb === 'platby') return naPobocce ? 'z přijatých plateb na účty pobočky' : 'z přijatých plateb'
  if (!kpi.trzbyMajiData) return naPobocce ? 'pokladna pobočky za tento měsíc zatím nic neposlala' : 'pokladna za tento měsíc zatím nic neposlala'
  if (naPobocce) return 'z pokladny pobočky'
  return kpi.pokrytiPokladnou && kpi.pokrytiPokladnou.maji < kpi.pokrytiPokladnou.celkem
    ? `z pokladen · ${kpi.pokrytiPokladnou.maji} z ${kpi.pokrytiPokladnou.celkem} provozoven`
    : 'z pokladen'
}
