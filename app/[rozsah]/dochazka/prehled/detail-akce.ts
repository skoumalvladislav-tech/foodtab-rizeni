'use server'

import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { prvniDenMesice } from '@/lib/mzdy'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Měsíc jednoho člověka — pro boční panel živého přehledu docházky.
 *
 * Bere se z `employee_earnings`, tedy z TÉŽE databázové funkce, ze které
 * jsou mzdy (`app.earnings` / `app.worked_minutes`: přestávky, paušál,
 * storno). Tady se nic nepočítá znovu.
 *
 * PRÁVA: funkce sama vrací jen lidi, na které má volající `payroll.read`
 * ve svém rozsahu — bez toho práva nevrátí ani řádek. Panel proto hodiny
 * ani částku ukáže jen tomu, kdo je smí vidět; vedoucí bez `payroll.read`
 * dostane `null` a kartu „Tento měsíc“ prostě nevidí. `attendance.read`
 * (kdo docházku vidí) na mzdy nestačí, a to je záměr.
 */

export type MesicCloveka = {
  odpracovanoMinut: number
  dnuBezDochazky: number
  /** Hrubá mzda v haléřích; `null`, když sazba chybí (nula by vypadala jako výsledek). */
  hrubaHaleru: number | null
}

const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function nactiMesicCloveka(rozsah: string, zamestnanec: string): Promise<MesicCloveka | null> {
  if (!JE_UUID.test(zamestnanec)) return null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  const pristup = await zkusPristup(tenantId, 'attendance.read', rozsah)
  if (pristup.stav !== 'ok') return null

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('employee_earnings', {
    p_tenant: tenantId,
    p_mesic: prvniDenMesice(new Date()),
    p_branch: pristup.scope.branchId ?? null,
  })
  if (error) {
    // Nenasazená migrace = pohled prostě není. Jiná chyba se nepřehlíží tiše,
    // ale panelu kvůli ní nemá spadnout obrazovka.
    if (!funkceNeexistuje(error)) console.error('employee_earnings selhal', error)
    return null
  }

  const radek = (data ?? []).find((r: { employee_id: string }) => r.employee_id === zamestnanec) as
    | {
        odpracovano_minut: number
        dnu_bez_dochazky: number
        vydelano_haleru: number
        sazba_chybi: boolean
      }
    | undefined
  if (!radek) return null

  return {
    odpracovanoMinut: radek.odpracovano_minut,
    dnuBezDochazky: radek.dnu_bez_dochazky,
    hrubaHaleru: radek.sazba_chybi ? null : radek.vydelano_haleru,
  }
}
