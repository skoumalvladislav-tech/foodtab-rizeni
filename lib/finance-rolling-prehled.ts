import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekPredpisu } from '@/lib/finance-plan.ts'
import {
  agregovatPoTydnech,
  pondelekTydne,
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
