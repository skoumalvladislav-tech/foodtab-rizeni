import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekPredpisu } from '@/lib/finance-plan.ts'
import {
  agregovatPoTydnech,
  pondelekTydne,
  pridatDny,
  sestavRollingVyhled,
  type RollingVyhled,
  type Scenar,
  type SurovaTransakce,
} from '@/lib/finance-rolling-vyhled.ts'

/**
 * Rolling cashflow výhled na 13 týdnů, po pobočkách a firmě — nahrazuje
 * datová vrstva pro lib/finance-rolling-vyhled.ts (čistá logika tam).
 */

export type VyhledPobocky = {
  branchId: string | null
  pobocka: string
  vyhled: RollingVyhled
}

export async function nactiRollingVyhledy(
  tenantId: string,
  scenar: Scenar,
): Promise<VyhledPobocky[]> {
  const supabase = await getServerSupabase()
  const dnes = new Date().toISOString().slice(0, 10)
  const zacatekAktualnihoTydne = pondelekTydne(dnes)

  const [branchesRes, zustatkyRes, transakceRes, predpisyRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
    supabase.rpc('aktualni_zustatky_uctu', { p_tenant: tenantId }),
    supabase
      .from('transakce')
      .select('datum, smer, castka_haleru, platebni_ucty(branch_id)')
      .eq('tenant_id', tenantId)
      .gte('datum', zacatekAktualnihoTydne),
    supabase
      .from('predpisy_plateb')
      .select('branch_id, smer, castka_haleru, perioda, dalsi_splatnost')
      .eq('tenant_id', tenantId)
      .eq('aktivni', true),
  ])

  if (branchesRes.error) throw branchesRes.error
  if (zustatkyRes.error) throw zustatkyRes.error
  if (transakceRes.error) throw transakceRes.error
  if (predpisyRes.error) throw predpisyRes.error

  const branches = (branchesRes.data ?? []) as { id: string; name: string }[]

  const zustatky = new Map<string | null, number>()
  for (const r of (zustatkyRes.data ?? []) as { branch_id: string | null; zustatek_haleru: number }[]) {
    zustatky.set(r.branch_id, Number(r.zustatek_haleru))
  }

  const transakcePoPobocce = new Map<string | null, SurovaTransakce[]>()
  for (const r of (transakceRes.data ?? []) as {
    datum: string
    smer: string
    castka_haleru: number
    platebni_ucty: { branch_id: string | null } | { branch_id: string | null }[] | null
  }[]) {
    const ucet = Array.isArray(r.platebni_ucty) ? r.platebni_ucty[0] : r.platebni_ucty
    const branchId = ucet?.branch_id ?? null
    const seznam = transakcePoPobocce.get(branchId) ?? []
    seznam.push({ datum: r.datum, smer: r.smer, castkaHaleru: r.castka_haleru })
    transakcePoPobocce.set(branchId, seznam)
  }

  const predpisy: RadekPredpisu[] = (predpisyRes.data ?? []).map((r) => ({
    branchId: r.branch_id,
    smer: r.smer as 'prijem' | 'vydaj',
    castkaHaleru: r.castka_haleru,
    perioda: r.perioda as RadekPredpisu['perioda'],
    dalsiSplatnost: r.dalsi_splatnost,
  }))

  const vysledky: VyhledPobocky[] = branches.map((b) => {
    const skutecnost = agregovatPoTydnech(transakcePoPobocce.get(b.id) ?? [])
    const vyhled = sestavRollingVyhled(predpisy, skutecnost, zustatky.get(b.id) ?? 0, dnes, scenar, b.id)
    return { branchId: b.id, pobocka: b.name, vyhled }
  })

  const skutecnostFirma = agregovatPoTydnech(transakcePoPobocce.get(null) ?? [])
  const vyhledFirma = sestavRollingVyhled(predpisy, skutecnostFirma, zustatky.get(null) ?? 0, dnes, scenar, null)
  vysledky.push({ branchId: null, pobocka: 'Celá firma (účty bez pobočky)', vyhled: vyhledFirma })

  return vysledky
}

/** Jeden bod kombinovaného grafu (Přehled) — zůstatek napříč VŠEMI účty, bez rozpadu po pobočkách. */
export type BodCashflowGrafu = { tydenOd: string; tydenDo: string; zustatekHaleru: number; budouci: boolean }

/**
 * Historických N týdnů PŘED tímto týdnem, zůstatek napříč všemi účty.
 *
 * Jediný skutečný bod je DNEŠNÍ celkový zůstatek (`aktualni_zustatky_uctu`)
 * — zbytek se dopočítá chůzí NAZPÁTEK podle skutečných zapsaných transakcí
 * (ne podle plánu, na rozdíl od `sestavRollingVyhled`, který jde dopředu).
 * Poslední vrácený bod je zůstatek na KONCI minulého týdne, tj. přesně
 * tam, kde navazuje `pocatecniZustatekHaleru` dopředného výhledu.
 */
export async function nactiHistorickyCashflow(
  tenantId: string,
  pocetTydnu: number,
): Promise<BodCashflowGrafu[]> {
  const supabase = await getServerSupabase()
  const dnes = new Date().toISOString().slice(0, 10)
  const zacatekAktualnihoTydne = pondelekTydne(dnes)
  const zacatekHistorie = pridatDny(zacatekAktualnihoTydne, -pocetTydnu * 7)

  const [zustatkyRes, transakceRes] = await Promise.all([
    supabase.rpc('aktualni_zustatky_uctu', { p_tenant: tenantId }),
    supabase
      .from('transakce')
      .select('datum, smer, castka_haleru')
      .eq('tenant_id', tenantId)
      .gte('datum', zacatekHistorie)
      .lt('datum', zacatekAktualnihoTydne),
  ])
  if (zustatkyRes.error) throw zustatkyRes.error
  if (transakceRes.error) throw transakceRes.error

  const aktualniCelkem = ((zustatkyRes.data ?? []) as { zustatek_haleru: number }[])
    .reduce((s, r) => s + Number(r.zustatek_haleru), 0)

  const poTydnech = agregovatPoTydnech(
    ((transakceRes.data ?? []) as { datum: string; smer: string; castka_haleru: number }[]).map(
      (r): SurovaTransakce => ({ datum: r.datum, smer: r.smer, castkaHaleru: r.castka_haleru }),
    ),
  )

  // Kolik se za celou historii pohnulo, abychom se od dnešního (reálného)
  // zůstatku dostali k zůstatku PŘED první historickou týdnem.
  let celkovyPohybHistorie = 0
  for (const v of poTydnech.values()) celkovyPohybHistorie += v.prijmyHaleru - v.vydajeHaleru

  let zustatek = aktualniCelkem - celkovyPohybHistorie
  const body: BodCashflowGrafu[] = []
  for (let i = 0; i < pocetTydnu; i++) {
    const tydenOd = pridatDny(zacatekHistorie, i * 7)
    const tydenDo = pridatDny(tydenOd, 6)
    const tyden = poTydnech.get(tydenOd) ?? { prijmyHaleru: 0, vydajeHaleru: 0 }
    zustatek += tyden.prijmyHaleru - tyden.vydajeHaleru
    body.push({ tydenOd, tydenDo, zustatekHaleru: zustatek, budouci: false })
  }
  return body
}

/**
 * Kombinovaný graf pro Přehled: historie (skutečnost, `budouci: false`)
 * navazující na dopředný výhled (`budouci: true`), napříč VŠEMI účty
 * (žádný rozpad po pobočkách — ten má svůj vlastní detail na
 * `/finance/cashflow`). Zůstatky jsou aditivní, takže součet přes
 * pobočky+firmu v KAŽDÉM týdnu je platný celkový zůstatek.
 */
export async function nactiKombinovanyCashflowGraf(
  tenantId: string,
  scenar: Scenar,
  pocetHistorickychTydnu = 6,
): Promise<BodCashflowGrafu[]> {
  const [historie, vyhledy] = await Promise.all([
    nactiHistorickyCashflow(tenantId, pocetHistorickychTydnu),
    nactiRollingVyhledy(tenantId, scenar),
  ])

  const pocetBudoucichTydnu = vyhledy[0]?.vyhled.tydny.length ?? 0
  const budouci: BodCashflowGrafu[] = []
  for (let i = 0; i < pocetBudoucichTydnu; i++) {
    const radek = vyhledy[0]?.vyhled.tydny[i]
    if (!radek) continue
    const zustatekCelkem = vyhledy.reduce((s, v) => s + (v.vyhled.tydny[i]?.zustatekNaKonciHaleru ?? 0), 0)
    budouci.push({ tydenOd: radek.tydenOd, tydenDo: radek.tydenDo, zustatekHaleru: zustatekCelkem, budouci: true })
  }

  return [...historie, ...budouci]
}
