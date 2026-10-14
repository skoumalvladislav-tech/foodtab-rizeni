import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, type Context } from '@/lib/authz'
import { nactiCashflowPrehled, nactiVysledovkuCelofirmy, type CashflowPrehled } from '@/lib/finance-prehled'
import { nactiPrehledTrzeb } from '@/lib/pokladna-trzby-nacteni'
import { jenPobocka, pokrytiObdobi } from '@/lib/pokladna-trzby'

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
 *
 * ---------------------------------------------------------------------
 * POBOČKA (Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět
 * finance, které se týkají jen Bernard Baru")
 *
 * S `pobocka` je KAŽDÉ číslo jen za tu pobočku — nic se nerozpočítává
 * a firemní řádky (účty bez pobočky) v něm nejsou (lib/finance-rozsah.ts):
 *   * Tržby: přehled pokladen zúžený na pobočku (`jenPobocka`); zdroj
 *     pokladna/platby se rozhoduje podle dat TÉ pobočky. Bez pokladních
 *     dat i bez vlastního účtu `bez_zdroje` — karta řekne proč, ne 0 Kč;
 *   * Cashflow: jen řádek pobočky z `cashflow_prehled` (účty s její
 *     `branch_id`), bez `cashflow_prehled_firma`;
 *   * Foodcost/beverage: `foodcost_beverage_prehled` s `p_branch`;
 *   * Náklady práce: `vydelky_prehled` s `p_branch` — viz ROZHODNOUT
 *     u `nactiSoucetMzdyHaleru`;
 *   * Náklady podle kategorie: `vysledovka` jen pro pobočku, bez
 *     firemního střediska.
 * Dnes appka zakládá každý platební účet jako firemní, takže pobočka
 * vlastní účet většinou nemá (`pobockaBezUctu`) — karty z plateb pak
 * ukazují „–" s vysvětlením.
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

/**
 * Teoretický foodcost/beverage cost přehled. Celá firma: p_branch=null —
 * appka ho nemusí sčítat po pobočkách, RLS stejně omezí na viditelné.
 * Pobočka: p_branch = ta pobočka (prodeje jen z její pokladny).
 */
async function nactiFoodcostBeverage(tenantId: string, pobocka: string | null, od: string, doData: string): Promise<RadekFoodcostBeverage[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('foodcost_beverage_prehled', { p_tenant: tenantId, p_branch: pobocka, p_od: od, p_do: doData })
  if (error) throw error
  return (data ?? []) as RadekFoodcostBeverage[]
}

/** Má pobočka aspoň jeden platební účet se svou `branch_id` (i vypnutý — jeho transakce v měsíci pořád platí)? */
async function pobockaMaUcet(tenantId: string, pobocka: string): Promise<boolean> {
  const supabase = await getServerSupabase()
  const { count, error } = await supabase
    .from('platebni_ucty')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('branch_id', pobocka)
  if (error) throw error
  return (count ?? 0) > 0
}

export async function nactiFinanceKpi(
  tenantId: string,
  ctx: Context,
  branches: readonly { id: string; name: string }[],
  obdobi: { od: string; doData: string },
  predchoziObdobi: { od: string; doData: string },
  /** Pobočka rozsahu (`pobockaFinanci`), `null` = celá firma jako dřív. */
  pobocka: string | null = null,
): Promise<FinanceKpi> {
  const smiVidetMzdy = canSee(ctx, 'payroll.read')

  const [cfAktualni, cfPredchozi, vysAktualni, fbAktualni, fbPredchozi, mzdyAktualni, mzdyPredchozi, pokladny, maUcet] = await Promise.all([
    nactiCashflowPrehled(tenantId, obdobi.od, obdobi.doData),
    nactiCashflowPrehled(tenantId, predchoziObdobi.od, predchoziObdobi.doData),
    nactiVysledovkuCelofirmy(tenantId, branches, obdobi.od, obdobi.doData, pobocka),
    nactiFoodcostBeverage(tenantId, pobocka, obdobi.od, obdobi.doData),
    nactiFoodcostBeverage(tenantId, pobocka, predchoziObdobi.od, predchoziObdobi.doData),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, pobocka, obdobi.od) : Promise.resolve(null),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, pobocka, predchoziObdobi.od) : Promise.resolve(null),
    // Oba měsíce jedním dotazem, po měsících (obdobi = 1. den měsíce).
    // Chyba tržeb z pokladen nesmí shodit Cashflow ani náklady (dřív na
    // pokladně nezávisely) — karta Tržby pak řekne, že se nenačetly.
    nactiPrehledTrzeb(tenantId, predchoziObdobi.od, obdobi.doData, 'mesic').catch((): 'chyba' => 'chyba'),
    pobocka === null ? Promise.resolve(true) : pobockaMaUcet(tenantId, pobocka),
  ])

  const { prijmy: prijmyHaleru, vydaje: vydajeHaleru } = soucetPrijmyVydaje(cfAktualni, pobocka)
  const { prijmy: prijmyHaleruPredchozi, vydaje: vydajePredchozi } = soucetPrijmyVydaje(cfPredchozi, pobocka)

  // Na pobočce jen ona: přehled pokladen zúžený na ni a „aktivní" = jen ona
  // (pokrytí je pak 0, nebo 1 z 1).
  const aktivni = branches.map((b) => b.id).filter((id) => pobocka === null || id === pobocka)
  const prehledPokladen = pokladny === 'chyba' || pokladny === null ? null : jenPobocka(pokladny, pobocka)
  const posAktualni = prehledPokladen ? pokrytiObdobi(prehledPokladen, obdobi.od, aktivni) : null
  const posPredchozi = prehledPokladen ? pokrytiObdobi(prehledPokladen, predchoziObdobi.od, aktivni) : null
  // Nenačtené tržby z pokladen se NEnahrazují příjmy z plateb — karta by
  // nesla číslo z jiného zdroje pod stejným jménem. Pobočka bez pokladních
  // dat i bez vlastního účtu nemá tržby odkud vzít (`bez_zdroje`) — „0 Kč
  // z přijatých plateb" by tvrdilo, že nic nepřišlo.
  const zdrojTrzeb: FinanceKpi['zdrojTrzeb'] =
    pokladny === 'chyba' ? 'nenacteno'
      : posAktualni?.maData || posPredchozi?.maData ? 'pokladna'
        : pobocka !== null && !maUcet ? 'bez_zdroje'
          : 'platby'
  const zPokladen = zdrojTrzeb === 'pokladna'
  const stejnePobocky = posAktualni !== null && posPredchozi !== null && posAktualni.pobocky.join() === posPredchozi.pobocky.join()
  const trzbyHaleru = zdrojTrzeb === 'platby' ? prijmyHaleru : (posAktualni?.trzbaHaleru ?? 0)
  const trzbyHaleruPredchozi = zdrojTrzeb === 'platby' ? prijmyHaleruPredchozi : zPokladen && stejnePobocky ? (posPredchozi?.trzbaHaleru ?? 0) : null
  // Náklady práce: mzdy jsou za všechny pobočky rozsahu — z pokladen jen při
  // úplném pokrytí (na pobočce: když její pokladna v měsíci něco poslala).
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
    pobockaBezUctu: pobocka !== null && !maUcet,
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

/**
 * Součet skutečně vyplacené mzdy za KALENDÁŘNÍ měsíc — za celou firmu
 * (`pobocka` null, napříč všemi pobočkami), nebo za jednu pobočku.
 *
 * ROZHODNOUT: `vydelky_prehled` s `p_branch` počítá lidi podle DOMOVSKÉ
 * pobočky (`employees.branch_id`, jako employee_earnings), ne podle
 * pobočky, kde směnu skutečně odpracovali. Číšník z Černé Perly, který
 * vypomohl v Bernard Baru, jde celý do Černé Perly; majitel a lidé bez
 * domovské pobočky nejdou do žádné. Rozpad po pobočce směny by chtěl
 * novou funkci v databázi (migrace) — do té doby karta na pobočce říká
 * „mzdy lidí s domovskou pobočkou" (app/[rozsah]/finance/page.tsx).
 */
async function nactiSoucetMzdyHaleru(tenantId: string, pobocka: string | null, libovolnyDenVMesici: string): Promise<number> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('vydelky_prehled', { p_tenant: tenantId, p_branch: pobocka, p_mesic: libovolnyDenVMesici })
  if (error) throw error
  return ((data ?? []) as { vydelano_haleru: number }[]).reduce((s, r) => s + Number(r.vydelano_haleru), 0)
}
