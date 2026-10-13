import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, type Context } from '@/lib/authz'
import { nactiCashflowPrehled, nactiVysledovkuCelofirmy } from '@/lib/finance-prehled'
import { nactiPrehledTrzeb } from '@/lib/pokladna-trzby-nacteni'
import { pokrytiObdobi } from '@/lib/pokladna-trzby'

/**
 * KPI karty a graf nákladů pro Finance → Přehled.
 *
 * Tržby jsou od 12. 10. 2026 TRŽBY Z POKLADEN (`pokladna_prehled_trzeb`),
 * pokud firma má z pokladny v jednom ze dvou srovnávaných měsíců aspoň
 * jeden den dat. Rozpad po dnech, provozovnách a platbách je na
 * Finance → Tržby. Dřív to byly příjmy z plateb (`transakce`) — u firmy
 * bez nahraných výpisů nula, i když z Dotykačky ležel v databázi celý
 * rok prodejů. Firma bez pokladny má dál příjmy z plateb; karta říká,
 * odkud číslo je (`zdrojTrzeb`). Oba srovnávané měsíce mají VŽDY stejný
 * zdroj — jinak by trend srovnával pokladnu s bankou.
 *
 * Pokladnu nemusí mít všechny pobočky (nebo ji některá připojila až
 * v průběhu). Karta pak říká, kolik poboček tržby pokrývají
 * (`pokrytiPokladnou`), trend se počítá jen mezi měsíci se STEJNOU sadou
 * poboček a náklady práce v % jen při úplném pokrytí — mzdy jsou za
 * všechny pobočky a dělit je tržbami jen některých by % nafouklo.
 *
 * Cashflow zůstává na `app.cashflow_prehled` (peníze, ne prodeje). Rozpad nákladů podle kategorie (suroviny/mzdy/
 * nájem/energie/...) stojí na `app.vysledovka` — to je PENĖŽNÍ pohled
 * (kdy se co zaplatilo).
 *
 * Foodcost/beverage cost % jsou od 4. 10. 2026 (zadání, oddíl 7) jiný,
 * TEORETICKÝ pohled — `app.foodcost_beverage_prehled` počítá náklad
 * z prodaného množství × platné receptury, ne z peněžního výdeje za
 * nákup (ten může spadnout do jiného měsíce, než kdy se surovina
 * skutečně prodala). Dřív appka měla jen jedno sloučené číslo
 * z kategorie `suroviny` (jídlo i nápoje spolu) — to se tomu, co
 * zadání žádá ("foodcost %, beverage cost %" jako dvě oddělená
 * čísla), jen podobalo.
 *
 * Náklady práce % jsou JEDINÁ karta, která může chybět úplně —
 * `vydelky_prehled` vyžaduje `payroll.read`, což `finance.read`
 * nezaručuje (jsou to dvě různá oprávnění). Bez něj appka kartu
 * vynechá, ne dopočítá nulu — nula by tu byla lež, ne změřená hodnota.
 */

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

export type FinanceKpi = {
  /**
   * Odkud jsou `trzbyHaleru` (a tím i jmenovatel nákladů práce).
   * `nenacteno` = tržby z pokladen se nepodařilo načíst — karta ukáže „–".
   */
  zdrojTrzeb: 'pokladna' | 'platby' | 'nenacteno'
  /** U tržeb z pokladen: kolik aktivních poboček má v měsíci data z pokladny. */
  pokrytiPokladnou: { maji: number; celkem: number } | null
  trzbyHaleru: number
  /** `null` = srovnání nemá smysl (jiná sada poboček s pokladnou než teď). */
  trzbyHaleruPredchozi: number | null
  cashflowHaleru: number
  cashflowHaleruPredchozi: number
  /**
   * Teoretický foodcost — prodané množství × platná receptura (zadání,
   * oddíl 7), ne peněžní výdej za nákup surovin. `null` = buď nulové
   * tržby z jídla v období, nebo appka ještě nemá jediný prodej
   * s napojenou a úplnou recepturou typu "jídlo" (viz foodcostPokryto).
   */
  foodcostProcento: number | null
  foodcostProcentoPredchozi: number | null
  /** Kolik z tržeb za jídlo appka reálně pokryla spočítaným nákladem — nízké číslo = foodcostProcento se opírá o málo dat. */
  foodcostPokrytoProcento: number | null
  /** Totéž jako foodcost výš, jen pro recepty typu "nápoj". */
  beverageCostProcento: number | null
  beverageCostProcentoPredchozi: number | null
  beverageCostPokrytoProcento: number | null
  /** `null` = chybí `payroll.read`, appka kartu nevynucuje. */
  nakladyPraceProcento: number | null
  nakladyPraceProcentoPredchozi: number | null
  nakladyPodleKategorie: RadekNakladu[]
}

type RadekFoodcostBeverage = { druh: string; trzby_haleru: number; naklady_haleru: number; trzby_bez_nakladu_haleru: number }

/** `null` = nulové tržby daného druhu, procento nemá smysl počítat. */
function procentoNakladu(radky: RadekFoodcostBeverage[], druh: 'jidlo' | 'napoj'): number | null {
  const r = radky.find((x) => x.druh === druh)
  if (!r || r.trzby_haleru <= 0) return null
  return (r.naklady_haleru / r.trzby_haleru) * 100
}

/** Kolik % tržeb daného druhu má vůbec spočítaný náklad (zbytek je bez napojené nebo neúplné receptury). */
function procentoPokryti(radky: RadekFoodcostBeverage[], druh: 'jidlo' | 'napoj'): number | null {
  const r = radky.find((x) => x.druh === druh)
  if (!r || r.trzby_haleru <= 0) return null
  return ((r.trzby_haleru - r.trzby_bez_nakladu_haleru) / r.trzby_haleru) * 100
}

function soucetPrijmyVydaje(cf: { pobocky: { skutecnostPrijmyHaleru: number; skutecnostVydajeHaleru: number }[]; firma: { skutecnostPrijmyHaleru: number; skutecnostVydajeHaleru: number } }) {
  const prijmy = cf.pobocky.reduce((s, p) => s + p.skutecnostPrijmyHaleru, 0) + cf.firma.skutecnostPrijmyHaleru
  const vydaje = cf.pobocky.reduce((s, p) => s + p.skutecnostVydajeHaleru, 0) + cf.firma.skutecnostVydajeHaleru
  return { prijmy, vydaje }
}

/** Teoretický foodcost/beverage cost přehled, napříč celou firmou (p_branch=null — appka ho nemusí sčítat po pobočkách, RLS stejně omezí na viditelné). */
async function nactiFoodcostBeverage(tenantId: string, od: string, doData: string): Promise<RadekFoodcostBeverage[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('foodcost_beverage_prehled', { p_tenant: tenantId, p_branch: null, p_od: od, p_do: doData })
  if (error) throw error
  return (data ?? []) as RadekFoodcostBeverage[]
}

export async function nactiFinanceKpi(
  tenantId: string,
  ctx: Context,
  branches: readonly { id: string; name: string }[],
  obdobi: { od: string; doData: string },
  predchoziObdobi: { od: string; doData: string },
): Promise<FinanceKpi> {
  const smiVidetMzdy = canSee(ctx, 'payroll.read')

  const [cfAktualni, cfPredchozi, vysAktualni, fbAktualni, fbPredchozi, mzdyAktualni, mzdyPredchozi, pokladny] = await Promise.all([
    nactiCashflowPrehled(tenantId, obdobi.od, obdobi.doData),
    nactiCashflowPrehled(tenantId, predchoziObdobi.od, predchoziObdobi.doData),
    nactiVysledovkuCelofirmy(tenantId, branches, obdobi.od, obdobi.doData),
    nactiFoodcostBeverage(tenantId, obdobi.od, obdobi.doData),
    nactiFoodcostBeverage(tenantId, predchoziObdobi.od, predchoziObdobi.doData),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, obdobi.od) : Promise.resolve(null),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, predchoziObdobi.od) : Promise.resolve(null),
    // Oba měsíce jedním dotazem, po měsících (obdobi = 1. den měsíce).
    // Chyba tržeb z pokladen nesmí shodit Cashflow ani náklady (dřív na
    // pokladně nezávisely) — karta Tržby pak řekne, že se nenačetly.
    nactiPrehledTrzeb(tenantId, predchoziObdobi.od, obdobi.doData, 'mesic').catch((): 'chyba' => 'chyba'),
  ])

  const { prijmy: prijmyHaleru, vydaje: vydajeHaleru } = soucetPrijmyVydaje(cfAktualni)
  const { prijmy: prijmyHaleruPredchozi, vydaje: vydajePredchozi } = soucetPrijmyVydaje(cfPredchozi)

  const aktivni = branches.map((b) => b.id)
  const prehledPokladen = pokladny === 'chyba' ? null : pokladny
  const posAktualni = prehledPokladen ? pokrytiObdobi(prehledPokladen, obdobi.od, aktivni) : null
  const posPredchozi = prehledPokladen ? pokrytiObdobi(prehledPokladen, predchoziObdobi.od, aktivni) : null
  // Nenačtené tržby z pokladen se NEnahrazují příjmy z plateb — karta by
  // nesla číslo z jiného zdroje pod stejným jménem.
  const zdrojTrzeb: FinanceKpi['zdrojTrzeb'] = pokladny === 'chyba' ? 'nenacteno' : posAktualni?.maData || posPredchozi?.maData ? 'pokladna' : 'platby'
  const zPokladen = zdrojTrzeb === 'pokladna'
  const stejnePobocky = posAktualni !== null && posPredchozi !== null && posAktualni.pobocky.join() === posPredchozi.pobocky.join()
  const trzbyHaleru = zdrojTrzeb === 'platby' ? prijmyHaleru : (posAktualni?.trzbaHaleru ?? 0)
  const trzbyHaleruPredchozi = zdrojTrzeb === 'platby' ? prijmyHaleruPredchozi : zPokladen && stejnePobocky ? (posPredchozi?.trzbaHaleru ?? 0) : null
  // Náklady práce: mzdy jsou za všechny pobočky — z pokladen jen při úplném pokrytí.
  const praceAktualni = zdrojTrzeb === 'platby' || (zPokladen && (posAktualni?.uplne ?? false))
  const pracePredchozi = zdrojTrzeb === 'platby' || (zPokladen && (posPredchozi?.uplne ?? false))

  const nakladyPodleKategorieMapa = new Map<string, number>()
  for (const r of vysAktualni) {
    if (r.smer !== 'vydaj') continue
    nakladyPodleKategorieMapa.set(r.kategorie, (nakladyPodleKategorieMapa.get(r.kategorie) ?? 0) + r.castkaHaleru)
  }
  const nakladyPodleKategorie: RadekNakladu[] = [...nakladyPodleKategorieMapa.entries()]
    .map(([kategorie, castkaHaleru]) => ({ kategorie, nazev: NAZVY_KATEGORII[kategorie] ?? kategorie, castkaHaleru }))
    .filter((r) => r.castkaHaleru > 0)
    .sort((a, b) => b.castkaHaleru - a.castkaHaleru)

  // Jmenovatel nákladů práce předchozího měsíce: jeho vlastní tržby (i když
  // se kvůli jiné sadě poboček nesrovnávají na kartě Tržby).
  const trzbyPredchoziProPraci = zPokladen ? (posPredchozi?.trzbaHaleru ?? 0) : prijmyHaleruPredchozi

  return {
    zdrojTrzeb,
    pokrytiPokladnou: zPokladen && posAktualni ? { maji: posAktualni.pokrytych, celkem: posAktualni.aktivnich } : null,
    trzbyHaleru,
    trzbyHaleruPredchozi,
    cashflowHaleru: prijmyHaleru - vydajeHaleru,
    cashflowHaleruPredchozi: prijmyHaleruPredchozi - vydajePredchozi,
    foodcostProcento: procentoNakladu(fbAktualni, 'jidlo'),
    foodcostProcentoPredchozi: procentoNakladu(fbPredchozi, 'jidlo'),
    foodcostPokrytoProcento: procentoPokryti(fbAktualni, 'jidlo'),
    beverageCostProcento: procentoNakladu(fbAktualni, 'napoj'),
    beverageCostProcentoPredchozi: procentoNakladu(fbPredchozi, 'napoj'),
    beverageCostPokrytoProcento: procentoPokryti(fbAktualni, 'napoj'),
    nakladyPraceProcento: mzdyAktualni !== null && praceAktualni && trzbyHaleru > 0 ? (mzdyAktualni / trzbyHaleru) * 100 : null,
    nakladyPraceProcentoPredchozi: mzdyPredchozi !== null && pracePredchozi && trzbyPredchoziProPraci > 0 ? (mzdyPredchozi / trzbyPredchoziProPraci) * 100 : null,
    nakladyPodleKategorie,
  }
}

/** Součet skutečně vyplacené mzdy za KALENDÁŘNÍ měsíc, napříč všemi pobočkami. */
async function nactiSoucetMzdyHaleru(tenantId: string, libovolnyDenVMesici: string): Promise<number> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('vydelky_prehled', { p_tenant: tenantId, p_branch: null, p_mesic: libovolnyDenVMesici })
  if (error) throw error
  return ((data ?? []) as { vydelano_haleru: number }[]).reduce((s, r) => s + Number(r.vydelano_haleru), 0)
}
