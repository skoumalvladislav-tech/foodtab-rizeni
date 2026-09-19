'use server'

import { getContext, hasAccess } from '@/lib/authz'
import { hodinaVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { pritomnostOsoby, type UdalostDochazky } from '@/lib/dochazka-dnes'
import { getCurrentTenantId } from '@/lib/firma'
import { posunDatum } from '@/lib/provozni-den'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Docházka k jedné směně — pro panel „Upravit směnu“.
 *
 * Plán (směna) a skutečnost (docházka) jsou dvě různé věci a zůstávají
 * odděleně: tahle akce docházku jen ČTE a nic nezapisuje zpátky do
 * rozpisu. Kdo je v práci, se počítá týmž pravidlem jako v databázi
 * (`lib/dochazka-dnes`, zrcadlo `app.otevreny_prichod`).
 *
 * OBĚ OBRANNÉ LINIE: `attendance.read` se ověřuje tady (na pobočce té
 * SMĚNY, ne podle adresy) a řádky, které člověk číst nesmí, mu stejně
 * nevydá RLS. Bez práva se vrací `null` a panel kartu nekreslí — o
 * cizí docházce se nemá dozvědět ani to, že nějaká je.
 */

export type DochazkaKeSmene = {
  stav: 'v_praci' | 'odesel' | 'nebyl'
  /** „07:57“ v pásmu pobočky. */
  prichod: string | null
  odchod: string | null
  /** Hrubé minuty na místě (příchod → odchod / teď), bez odečtu přestávek. */
  minut: number
  naPrestavce: boolean
  /** Otevřený příchod z dřívějška („od včerejška“): datum, jinak `null`. */
  otevrenyZeDne: string | null
}

const JE_DATUM = /^\d{4}-\d{2}-\d{2}$/
const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function nactiDochazkuKeSmene(
  branchId: string,
  zamestnanec: string,
  den: string,
): Promise<DochazkaKeSmene | null> {
  if (!JE_UUID.test(branchId) || !JE_UUID.test(zamestnanec) || !JE_DATUM.test(den)) return null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  // První linie: právo na pobočce té směny. Druhá je RLS na attendance_events.
  if (!(await hasAccess(tenantId, 'attendance.read', branchId))) return null

  const ctx = await getContext(tenantId)
  const zona = ctx?.branches.find((b) => b.id === branchId)?.timezone ?? ZONA_VYCHOZI

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('attendance_events')
    .select('employee_id, kind, occurred_at, business_date, branch_id, stornovano_kdy, uzavreno_systemem')
    .eq('tenant_id', tenantId)
    .eq('employee_id', zamestnanec)
    .gte('business_date', posunDatum(den, -1))
    .lte('business_date', den)
    .order('occurred_at', { ascending: true })
  if (error) return null

  const p = pritomnostOsoby((data ?? []) as UdalostDochazky[], den, Date.now())
  return {
    stav: p.stav,
    prichod: p.prichod ? hodinaVPasmu(p.prichod, zona) : null,
    odchod: p.odchod ? hodinaVPasmu(p.odchod, zona) : null,
    minut: p.minutNaMiste,
    naPrestavce: p.naPrestavce,
    otevrenyZeDne: p.otevrenyZeDne,
  }
}
