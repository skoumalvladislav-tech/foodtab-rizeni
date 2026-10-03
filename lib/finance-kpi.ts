import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, type Context } from '@/lib/authz'
import { nactiCashflowPrehled, nactiVysledovkuCelofirmy } from '@/lib/finance-prehled'

/**
 * KPI karty a graf nákladů pro Finance → Přehled.
 *
 * Tržby/cashflow stojí na `app.cashflow_prehled` (stejný zdroj jako
 * dnešní tabulka) — foodcost % a rozpad nákladů potřebují navíc
 * `app.vysledovka` (ta jediná rozlišuje kategorii). Náklady práce %
 * jsou JEDINÁ karta, která může chybět úplně — `vydelky_prehled`
 * vyžaduje `payroll.read`, což `finance.read` nezaručuje (jsou to dvě
 * různá oprávnění). Bez něj appka kartu vynechá, ne dopočítá nulu —
 * nula by tu byla lež, ne změřená hodnota.
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
  trzbyHaleru: number
  trzbyHaleruPredchozi: number
  cashflowHaleru: number
  cashflowHaleruPredchozi: number
  /** `null` = nulové tržby v období, procento nemá smysl počítat. */
  foodcostProcento: number | null
  foodcostProcentoPredchozi: number | null
  /** `null` = chybí `payroll.read`, appka kartu nevynucuje. */
  nakladyPraceProcento: number | null
  nakladyPraceProcentoPredchozi: number | null
  nakladyPodleKategorie: RadekNakladu[]
}

function soucetPrijmyVydaje(cf: { pobocky: { skutecnostPrijmyHaleru: number; skutecnostVydajeHaleru: number }[]; firma: { skutecnostPrijmyHaleru: number; skutecnostVydajeHaleru: number } }) {
  const prijmy = cf.pobocky.reduce((s, p) => s + p.skutecnostPrijmyHaleru, 0) + cf.firma.skutecnostPrijmyHaleru
  const vydaje = cf.pobocky.reduce((s, p) => s + p.skutecnostVydajeHaleru, 0) + cf.firma.skutecnostVydajeHaleru
  return { prijmy, vydaje }
}

function soucetKategorie(radky: { kategorie: string; smer: 'prijem' | 'vydaj'; castkaHaleru: number }[], kategorie: string, smer: 'prijem' | 'vydaj') {
  return radky.filter((r) => r.kategorie === kategorie && r.smer === smer).reduce((s, r) => s + r.castkaHaleru, 0)
}

export async function nactiFinanceKpi(
  tenantId: string,
  ctx: Context,
  branches: readonly { id: string; name: string }[],
  obdobi: { od: string; doData: string },
  predchoziObdobi: { od: string; doData: string },
): Promise<FinanceKpi> {
  const smiVidetMzdy = canSee(ctx, 'payroll.read')

  const [cfAktualni, cfPredchozi, vysAktualni, vysPredchozi, mzdyAktualni, mzdyPredchozi] = await Promise.all([
    nactiCashflowPrehled(tenantId, obdobi.od, obdobi.doData),
    nactiCashflowPrehled(tenantId, predchoziObdobi.od, predchoziObdobi.doData),
    nactiVysledovkuCelofirmy(tenantId, branches, obdobi.od, obdobi.doData),
    nactiVysledovkuCelofirmy(tenantId, branches, predchoziObdobi.od, predchoziObdobi.doData),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, obdobi.od) : Promise.resolve(null),
    smiVidetMzdy ? nactiSoucetMzdyHaleru(tenantId, predchoziObdobi.od) : Promise.resolve(null),
  ])

  const { prijmy: trzbyHaleru, vydaje: vydajeHaleru } = soucetPrijmyVydaje(cfAktualni)
  const { prijmy: trzbyHaleruPredchozi, vydaje: vydajePredchozi } = soucetPrijmyVydaje(cfPredchozi)

  const surovinyHaleru = soucetKategorie(vysAktualni, 'suroviny', 'vydaj')
  const surovinyHaleruPredchozi = soucetKategorie(vysPredchozi, 'suroviny', 'vydaj')

  const nakladyPodleKategorieMapa = new Map<string, number>()
  for (const r of vysAktualni) {
    if (r.smer !== 'vydaj') continue
    nakladyPodleKategorieMapa.set(r.kategorie, (nakladyPodleKategorieMapa.get(r.kategorie) ?? 0) + r.castkaHaleru)
  }
  const nakladyPodleKategorie: RadekNakladu[] = [...nakladyPodleKategorieMapa.entries()]
    .map(([kategorie, castkaHaleru]) => ({ kategorie, nazev: NAZVY_KATEGORII[kategorie] ?? kategorie, castkaHaleru }))
    .filter((r) => r.castkaHaleru > 0)
    .sort((a, b) => b.castkaHaleru - a.castkaHaleru)

  return {
    trzbyHaleru,
    trzbyHaleruPredchozi,
    cashflowHaleru: trzbyHaleru - vydajeHaleru,
    cashflowHaleruPredchozi: trzbyHaleruPredchozi - vydajePredchozi,
    foodcostProcento: trzbyHaleru > 0 ? (surovinyHaleru / trzbyHaleru) * 100 : null,
    foodcostProcentoPredchozi: trzbyHaleruPredchozi > 0 ? (surovinyHaleruPredchozi / trzbyHaleruPredchozi) * 100 : null,
    nakladyPraceProcento: mzdyAktualni !== null && trzbyHaleru > 0 ? (mzdyAktualni / trzbyHaleru) * 100 : null,
    nakladyPraceProcentoPredchozi: mzdyPredchozi !== null && trzbyHaleruPredchozi > 0 ? (mzdyPredchozi / trzbyHaleruPredchozi) * 100 : null,
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
