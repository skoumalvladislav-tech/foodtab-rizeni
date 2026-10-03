'use server'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { nactiRollingVyhledy } from '@/lib/finance-rolling-prehled'
import { nactiVysledovkuCelofirmy } from '@/lib/finance-prehled'
import {
  vysvetlitCisla,
  type Vysledek,
  type Podklady,
  type RadekVysledovky,
  type RadekRozpoctu,
  type RadekCashflow,
} from '@/lib/finance-ai-analytik'

export type StavAnalytika =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; vysledek: Extract<Vysledek, { stav: 'hotovo' }> }

/**
 * Sestaví podklady z HOTOVÝCH agregátů (vysledovka/rozpocet_prehled/
 * rolling cashflow — žádné nové počítání tady) a zeptá se analytika.
 * Období je vždy aktuální kalendářní měsíc — appka si ho vybírá sama,
 * ať otázka nemusí nosit datum.
 */
export async function zeptatSeAnalytika(_predchozi: StavAnalytika, formData: FormData): Promise<StavAnalytika> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const otazka = String(formData.get('otazka') ?? '').trim()
  if (!otazka) return { stav: 'chyba', text: 'Napište otázku.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav !== 'ok') return { stav: 'chyba', text: 'Na tohle nemáte oprávnění.' }

  const dnes = new Date()
  const rok = dnes.getFullYear()
  const mesic = dnes.getMonth() + 1
  const obdobiOd = `${rok}-${String(mesic).padStart(2, '0')}-01`
  const obdobiDo = new Date(rok, mesic, 0).toISOString().slice(0, 10)

  const supabase = await getServerSupabase()
  const { data: branchesData } = await supabase
    .from('branches')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('deleted_at', null)
  const branches = (branchesData ?? []) as { id: string; name: string }[]

  const radkyVysledovky = await nactiVysledovkuCelofirmy(tenantId, branches, obdobiOd, obdobiDo)
  const podleStrediska = new Map<string, { trzby: number; naklady: number }>()
  for (const r of radkyVysledovky) {
    const aktualni = podleStrediska.get(r.stredisko) ?? { trzby: 0, naklady: 0 }
    if (r.smer === 'prijem') aktualni.trzby += r.castkaHaleru
    else aktualni.naklady += r.castkaHaleru
    podleStrediska.set(r.stredisko, aktualni)
  }
  const vysledovka: RadekVysledovky[] = [...podleStrediska.entries()]
    .filter(([, v]) => v.trzby !== 0 || v.naklady !== 0)
    .map(([stredisko, v]) => ({ stredisko, trzbyHaleru: v.trzby, nakladyHaleru: v.naklady, prispevekHaleru: v.trzby - v.naklady }))

  const { data: rozpocetData } = await supabase.rpc('rozpocet_prehled', { p_tenant: tenantId, p_branch: null, p_rok: rok, p_mesic: mesic })
  const rozpocet: RadekRozpoctu[] = ((rozpocetData ?? []) as { kategorie: string; smer: 'prijem' | 'vydaj'; plan_haleru: number; skutecnost_haleru: number; odchylka_haleru: number }[]).map((r) => ({
    kategorie: r.kategorie,
    smer: r.smer,
    planHaleru: Number(r.plan_haleru),
    skutecnostHaleru: Number(r.skutecnost_haleru),
    odchylkaHaleru: Number(r.odchylka_haleru),
  }))

  let cashflow: RadekCashflow[] = []
  try {
    const vyhledy = await nactiRollingVyhledy(tenantId, 'zakladni')
    const firma = vyhledy.find((v) => v.branchId === null)
    cashflow = (firma?.vyhled.tydny ?? []).slice(0, 4).map((t) => ({
      tydenOd: t.tydenOd,
      planPrijmyHaleru: t.planPrijmyHaleru,
      planVydajeHaleru: t.planVydajeHaleru,
      zustatekNaKonciHaleru: t.zustatekNaKonciHaleru,
    }))
  } catch {
    cashflow = []
  }

  const podklady: Podklady = { otazka, obdobiOd, obdobiDo, vysledovka, cashflow, rozpocet }

  const vysledek = await vysvetlitCisla(podklady)
  if (vysledek.stav === 'chyba') return { stav: 'chyba', text: vysledek.duvod }
  return { stav: 'hotovo', vysledek }
}
