import 'server-only'

import { souhrnyPoDnech, type HosteDnu } from '@/lib/rezervace-pobocky'
import { getServerSupabase } from '@/lib/supabase/server'

import { zkusPristupRezervacim } from './pristup'

/**
 * Hosté z rezervací pro Rozpis směn — okénko u dne (app/[rozsah]/smeny/hoste-dne.tsx).
 *
 * KDO TO VIDÍ: rozhoduje TÁŽ funkce jako stránka Rezervací
 * (`zkusPristupRezervacim`: `rezervace.read` nebo `rezervace.manage`,
 * rozsah z adresy, pak pobočka po pobočce). Rozpis směn smí vidět i ten,
 * kdo na rezervace právo nemá — tomu se vrátí `null` a okénko se nekreslí.
 * Druhá linie je RLS na `rezervace` (dotaz jde uživatelským klientem).
 *
 * CO SE ČTE: jen pobočka, provozní den, druh, stav a počet osob — žádná
 * jména hostů ani kontakty; okénko ukazuje jen počty.
 *
 * CHYBA DOTAZU nesmí shodit rozpis (rezervace jsou v něm jen pomůcka),
 * ale nesmí se ani tvářit jako „nikdo nepřijde“: vrátí se `chyba: true`
 * a okénko to napíše. Totéž, když by se narazilo na strop řádků — součet
 * by byl tiše menší, než je.
 */

const STROP_RADKU = 10000

export async function hosteProRozpis(tenantId: string, rozsah: string, od: string, doDne: string): Promise<HosteDnu | null> {
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav !== 'ok') return null

  const pobocky = pristup.pobocky.map(({ id, nazev, zkratka, barva }) => ({ id, nazev, zkratka, barva }))
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('rezervace')
    .select('branch_id, den, druh, stav, pocet_osob')
    .eq('tenant_id', tenantId)
    .in(
      'branch_id',
      pobocky.map((p) => p.id),
    )
    .gte('den', od)
    .lte('den', doDne)
    .limit(STROP_RADKU)

  if (error || (data?.length ?? 0) >= STROP_RADKU) {
    console.error('[rezervace] hosté pro rozpis směn se nenačetli', error?.code ?? 'strop řádků', error?.message ?? '')
    return { pobocky, dny: {}, chyba: true }
  }
  return { pobocky, dny: souhrnyPoDnech(data ?? []), chyba: false }
}
