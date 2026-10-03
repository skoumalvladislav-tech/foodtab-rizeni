import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { secistPlan, type RadekPredpisu } from '@/lib/finance-plan'

/**
 * Cashflow přehled: skutečnost (z `transakce`, přes `app.cashflow_prehled`)
 * a plán (z `predpisy_plateb`, rozpočet v lib/finance-plan.ts) — VŽDY
 * oddělené, nikdy sloučené do jednoho čísla (zadání, oddíl 4).
 */

export type CashflowRadekPobocky = {
  branchId: string
  pobocka: string
  skutecnostPrijmyHaleru: number
  skutecnostVydajeHaleru: number
  planPrijmyHaleru: number
  planVydajeHaleru: number
}

export type CashflowFirma = {
  skutecnostPrijmyHaleru: number
  skutecnostVydajeHaleru: number
  planPrijmyHaleru: number
  planVydajeHaleru: number
}

export type CashflowPrehled = {
  pobocky: CashflowRadekPobocky[]
  firma: CashflowFirma
}

export async function nactiCashflowPrehled(
  tenantId: string,
  od: string,
  doData: string,
): Promise<CashflowPrehled> {
  const supabase = await getServerSupabase()

  const [pobockyRes, firmaRes, predpisyRes] = await Promise.all([
    supabase.rpc('cashflow_prehled', { p_tenant: tenantId, p_od: od, p_do: doData }),
    supabase.rpc('cashflow_prehled_firma', { p_tenant: tenantId, p_od: od, p_do: doData }),
    supabase
      .from('predpisy_plateb')
      .select('branch_id, smer, castka_haleru, perioda, dalsi_splatnost')
      .eq('tenant_id', tenantId)
      .eq('aktivni', true),
  ])

  if (pobockyRes.error) throw pobockyRes.error
  if (firmaRes.error) throw firmaRes.error
  if (predpisyRes.error) throw predpisyRes.error

  const predpisy: RadekPredpisu[] = (predpisyRes.data ?? []).map((r) => ({
    branchId: r.branch_id,
    smer: r.smer as 'prijem' | 'vydaj',
    castkaHaleru: r.castka_haleru,
    perioda: r.perioda as RadekPredpisu['perioda'],
    dalsiSplatnost: r.dalsi_splatnost,
  }))

  const radkyPobocek = (pobockyRes.data ?? []) as {
    branch_id: string
    pobocka: string
    prijmy_haleru: number
    vydaje_haleru: number
  }[]

  const pobocky: CashflowRadekPobocky[] = radkyPobocek.map((r) => {
    const plan = secistPlan(predpisy, r.branch_id, od, doData)
    return {
      branchId: r.branch_id,
      pobocka: r.pobocka,
      skutecnostPrijmyHaleru: r.prijmy_haleru,
      skutecnostVydajeHaleru: r.vydaje_haleru,
      planPrijmyHaleru: plan.prijmyHaleru,
      planVydajeHaleru: plan.vydajeHaleru,
    }
  })

  const radekFirmy = (firmaRes.data ?? []) as { prijmy_haleru: number; vydaje_haleru: number }[]
  const planFirma = secistPlan(predpisy, null, od, doData)
  const firma: CashflowFirma = {
    skutecnostPrijmyHaleru: radekFirmy[0]?.prijmy_haleru ?? 0,
    skutecnostVydajeHaleru: radekFirmy[0]?.vydaje_haleru ?? 0,
    planPrijmyHaleru: planFirma.prijmyHaleru,
    planVydajeHaleru: planFirma.vydajeHaleru,
  }

  return { pobocky, firma }
}

/** Jeden řádek `app.vysledovka` pro jedno středisko (pobočka, nebo firma). */
export type RadekVysledovkyStrediska = {
  branchId: string | null
  stredisko: string
  kategorie: string
  smer: 'prijem' | 'vydaj'
  castkaHaleru: number
}

/**
 * `app.vysledovka` běží na JEDNU pobočku (nebo `null` = firemní účty)
 * za volání — tahle funkce ji zavolá pro každé středisko a vrátí
 * plochý seznam napříč celou firmou. Sdílené mezi Přehledem (KPI karty,
 * graf nákladů) a AI analytikem (app/[rozsah]/finance/analytik/akce.ts) —
 * dřív dvě kopie téhož cyklu, teď jedna.
 */
export async function nactiVysledovkuCelofirmy(
  tenantId: string,
  branches: readonly { id: string; name: string }[],
  od: string,
  doData: string,
): Promise<RadekVysledovkyStrediska[]> {
  const supabase = await getServerSupabase()

  const strediska: { id: string | null; nazev: string }[] = [
    ...branches.map((b) => ({ id: b.id as string | null, nazev: b.name })),
    { id: null, nazev: 'Celá firma (účty bez pobočky)' },
  ]

  const vysledky = await Promise.all(
    strediska.map(async (s) => {
      const { data, error } = await supabase.rpc('vysledovka', { p_tenant: tenantId, p_branch: s.id, p_od: od, p_do: doData })
      if (error) throw error
      return ((data ?? []) as { kategorie: string; smer: 'prijem' | 'vydaj'; castka_haleru: number }[]).map(
        (r): RadekVysledovkyStrediska => ({
          branchId: s.id,
          stredisko: s.nazev,
          kategorie: r.kategorie,
          smer: r.smer,
          castkaHaleru: Number(r.castka_haleru),
        }),
      )
    }),
  )

  return vysledky.flat()
}
