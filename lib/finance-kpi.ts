import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, type Context } from '@/lib/authz'
import { nactiCashflowPrehled, nactiVysledovkuCelofirmy } from '@/lib/finance-prehled'
import { nactiPrehledTrzeb } from '@/lib/pokladna-trzby-nacteni'
import { sestavitFinanceKpi, type FinanceKpi, type RadekFoodcostBeverage } from '@/lib/finance-kpi-vypocet'
import type { Rozsah, SrovnaniMesice } from '@/lib/finance-obdobi'

export type { DvojiceTrendu, FinanceKpi, RadekNakladu } from '@/lib/finance-kpi-vypocet'

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
 * (`pokrytiPokladnou`), trend se počítá jen mezi obdobími se STEJNOU sadou
 * poboček a náklady práce v % jen při úplném pokrytí — mzdy jsou za
 * všechny pobočky a dělit je tržbami jen některých by % nafouklo.
 *
 * HODNOTY karet jsou za celý zobrazený měsíc, TRENDY srovnávají okna ze
 * `srovnaniMesice` (lib/finance-obdobi.ts) — u rozběhnutého měsíce
 * 1. až včerejšek proti týmž dnům minulého. Co se pro to načítá a jak se
 * to počítá, je v `lib/finance-kpi-vypocet.ts` (bez databáze, testované);
 * tady jsou jen dotazy.
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
  /** Celý zobrazený měsíc a celý měsíc před ním (`hraniceMesice`). */
  obdobi: Rozsah,
  predchoziObdobi: Rozsah,
  /** Okna trendu (`srovnaniMesice`, lib/finance-obdobi.ts). */
  srovnani: SrovnaniMesice,
  /** Pobočka rozsahu (`pobockaFinanci`), `null` = celá firma jako dřív. */
  pobocka: string | null = null,
): Promise<FinanceKpi> {
  return sestavitFinanceKpi(
    { obdobi, predchoziObdobi, srovnani, aktivniPobocky: branches.map((b) => b.id), pobocka, smiVidetMzdy: canSee(ctx, 'payroll.read') },
    {
      cashflow: (r) => nactiCashflowPrehled(tenantId, r.od, r.doData),
      vysledovka: (r) => nactiVysledovkuCelofirmy(tenantId, branches, r.od, r.doData, pobocka),
      foodcostBeverage: (r) => nactiFoodcostBeverage(tenantId, pobocka, r.od, r.doData),
      mzdy: (den) => nactiSoucetMzdyHaleru(tenantId, pobocka, den),
      pokladny: (od, doData) => nactiPrehledTrzeb(tenantId, od, doData, 'den'),
      pobockaMaUcet: (p) => pobockaMaUcet(tenantId, p),
    },
  )
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
