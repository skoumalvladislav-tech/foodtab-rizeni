import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekPredpisu } from '@/lib/finance-plan.ts'
import {
  agregovatPoTydnech,
  historieZustatku,
  pondelekTydne,
  pridatDny,
  sestavRollingVyhled,
  ucetVRozsahu,
  zustatekRozsahu,
  type RollingVyhled,
  type Scenar,
  type SurovaTransakce,
} from '@/lib/finance-rolling-vyhled.ts'

/**
 * Rolling cashflow výhled na 13 týdnů, po pobočkách a firmě — nahrazuje
 * datová vrstva pro lib/finance-rolling-vyhled.ts (čistá logika tam).
 *
 * Finance po pobočkách (Šéfík 13. 10. 2026): s `pobocka` jen řádky té
 * pobočky — její účty, její předpisy, žádný řádek „Celá firma". Dotazy
 * se zužují už v databázi (méně řádků pod stropem PostgRESTu) a znovu
 * tady (`ucetVRozsahu`) — kdyby filtr na vnořeném účtu někdy nezabral,
 * cizí řádek se do čísel pobočky stejně nepřimíchá.
 */

export type VyhledPobocky = {
  branchId: string | null
  pobocka: string
  /**
   * Má rozsah aspoň jeden AKTIVNÍ platební účet (`aktualni_zustatky_uctu`
   * pro něj vrátil řádek)? Bez něj výhled startuje z nuly, kterou appka
   * nezná — stránka pobočky to řekne slovy, ne „0 Kč".
   */
  maUcet: boolean
  vyhled: RollingVyhled
}

type RadekTransakceSUctem = {
  datum: string
  smer: string
  castka_haleru: number
  platebni_ucty: { branch_id: string | null } | { branch_id: string | null }[] | null
}

function pobockaUctu(r: RadekTransakceSUctem): string | null {
  const ucet = Array.isArray(r.platebni_ucty) ? r.platebni_ucty[0] : r.platebni_ucty
  return ucet?.branch_id ?? null
}

async function nactiZustatky(tenantId: string): Promise<{ branchId: string | null; zustatekHaleru: number }[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('aktualni_zustatky_uctu', { p_tenant: tenantId })
  if (error) throw error
  return ((data ?? []) as { branch_id: string | null; zustatek_haleru: number }[]).map((r) => ({
    branchId: r.branch_id,
    zustatekHaleru: Number(r.zustatek_haleru),
  }))
}

/**
 * Transakce od `od` (a před `pred`, je-li), s pobočkou účtu. Na pobočce
 * `!inner` + filtr na účet: transakce firemních účtů a účtů jiných
 * poboček nepřijdou (stejný vzor jako app/api/ucetni/export).
 */
async function nactiTransakceRozsahu(tenantId: string, pobocka: string | null, od: string, pred?: string): Promise<RadekTransakceSUctem[]> {
  const supabase = await getServerSupabase()
  let dotaz = supabase
    .from('transakce')
    .select(`datum, smer, castka_haleru, platebni_ucty${pobocka ? '!inner' : ''}(branch_id)`)
    .eq('tenant_id', tenantId)
    .gte('datum', od)
  if (pred) dotaz = dotaz.lt('datum', pred)
  if (pobocka) dotaz = dotaz.eq('platebni_ucty.branch_id', pobocka)
  const { data, error } = await dotaz
  if (error) throw error
  return ((data ?? []) as RadekTransakceSUctem[]).filter((r) => ucetVRozsahu(pobockaUctu(r), pobocka))
}

export async function nactiRollingVyhledy(
  tenantId: string,
  scenar: Scenar,
  /** Pobočka rozsahu (`pobockaFinanci`), `null` = celá firma jako dřív. */
  pobocka: string | null = null,
): Promise<VyhledPobocky[]> {
  const supabase = await getServerSupabase()
  const dnes = new Date().toISOString().slice(0, 10)
  const zacatekAktualnihoTydne = pondelekTydne(dnes)

  let dotazPobocek = supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
  if (pobocka) dotazPobocek = dotazPobocek.eq('id', pobocka)
  let dotazPredpisu = supabase
    .from('predpisy_plateb')
    .select('branch_id, smer, castka_haleru, perioda, dalsi_splatnost')
    .eq('tenant_id', tenantId)
    .eq('aktivni', true)
  if (pobocka) dotazPredpisu = dotazPredpisu.eq('branch_id', pobocka)

  const [branchesRes, zustatkyRadky, transakce, predpisyRes] = await Promise.all([
    dotazPobocek,
    nactiZustatky(tenantId),
    nactiTransakceRozsahu(tenantId, pobocka, zacatekAktualnihoTydne),
    dotazPredpisu,
  ])

  if (branchesRes.error) throw branchesRes.error
  if (predpisyRes.error) throw predpisyRes.error

  const branches = ((branchesRes.data ?? []) as { id: string; name: string }[]).filter((b) => pobocka === null || b.id === pobocka)

  const zustatky = new Map<string | null, number>()
  for (const r of zustatkyRadky) {
    if (ucetVRozsahu(r.branchId, pobocka)) zustatky.set(r.branchId, r.zustatekHaleru)
  }

  const transakcePoPobocce = new Map<string | null, SurovaTransakce[]>()
  for (const r of transakce) {
    const branchId = pobockaUctu(r)
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
    return { branchId: b.id, pobocka: b.name, maUcet: zustatky.has(b.id), vyhled }
  })

  // Řádek firemních účtů jen za celou firmu — na pobočce se neukazuje
  // ani nerozpočítává (lib/finance-rozsah.ts).
  if (pobocka === null) {
    const skutecnostFirma = agregovatPoTydnech(transakcePoPobocce.get(null) ?? [])
    const vyhledFirma = sestavRollingVyhled(predpisy, skutecnostFirma, zustatky.get(null) ?? 0, dnes, scenar, null)
    vysledky.push({ branchId: null, pobocka: 'Celá firma (účty bez pobočky)', maUcet: zustatky.has(null), vyhled: vyhledFirma })
  }

  return vysledky
}

/** Jeden bod kombinovaného grafu (Přehled) — zůstatek rozsahu (celá firma = všechny účty), bez rozpadu po pobočkách. */
export type BodCashflowGrafu = { tydenOd: string; tydenDo: string; zustatekHaleru: number; budouci: boolean }

/**
 * Historických N týdnů PŘED tímto týdnem — zůstatek rozsahu dopočítaný
 * nazpátek od dnešního (`historieZustatku`, lib/finance-rolling-vyhled.ts).
 *
 * Na pobočce bez aktivního účtu prázdno: dnešní zůstatek appka nezná
 * a čára od nuly by byla vymyšlená.
 */
export async function nactiHistorickyCashflow(
  tenantId: string,
  pocetTydnu: number,
  pobocka: string | null = null,
): Promise<BodCashflowGrafu[]> {
  const dnes = new Date().toISOString().slice(0, 10)
  const zacatekAktualnihoTydne = pondelekTydne(dnes)
  const zacatekHistorie = pridatDny(zacatekAktualnihoTydne, -pocetTydnu * 7)

  const [zustatky, transakce] = await Promise.all([
    nactiZustatky(tenantId),
    nactiTransakceRozsahu(tenantId, pobocka, zacatekHistorie, zacatekAktualnihoTydne),
  ])

  const aktualni = zustatekRozsahu(zustatky, pobocka)
  if (aktualni === null) return []

  return historieZustatku(
    aktualni,
    transakce.map((r): SurovaTransakce => ({ datum: r.datum, smer: r.smer, castkaHaleru: r.castka_haleru })),
    dnes,
    pocetTydnu,
  ).map((b) => ({ ...b, budouci: false }))
}

/**
 * Kombinovaný graf pro Přehled: historie (skutečnost, `budouci: false`)
 * navazující na dopředný výhled (`budouci: true`), napříč VŠEMI účty
 * rozsahu (žádný rozpad po pobočkách — ten má svůj vlastní detail na
 * `/finance/cashflow`). Zůstatky jsou aditivní, takže součet přes
 * pobočky+firmu v KAŽDÉM týdnu je platný celkový zůstatek.
 *
 * Na pobočce jen její účty a její výhled; bez aktivního účtu prázdno
 * (stránka řekne proč), ne nulová čára.
 */
export async function nactiKombinovanyCashflowGraf(
  tenantId: string,
  scenar: Scenar,
  pobocka: string | null = null,
  pocetHistorickychTydnu = 6,
): Promise<BodCashflowGrafu[]> {
  const [historie, vyhledy] = await Promise.all([
    nactiHistorickyCashflow(tenantId, pocetHistorickychTydnu, pobocka),
    nactiRollingVyhledy(tenantId, scenar, pobocka),
  ])

  if (pobocka !== null && !vyhledy.some((v) => v.maUcet)) return []

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
