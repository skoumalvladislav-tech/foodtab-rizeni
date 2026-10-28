import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { ZEME_VYCHOZI, zemeSvatku, type ZemeSvatku } from '@/lib/svatky'

/**
 * Ze které země se kalendářům berou svátky — z `tenants.country` firmy.
 *
 * Pobočka vlastní zemi v databázi nemá, takže platí země firmy pro
 * všechny její pobočky. Čte se uživatelským klientem: řádek své firmy
 * člen vidí (`tenants_select`), stejně jako jinde `tenants.timezone`.
 *
 * Neznámá země → `null` (svátky se nekreslí, lib/svatky.ts). Prázdná
 * nebo nečitelná → CZ. Tady se chyba dotazu záměrně NEVYHAZUJE: svátek
 * je značka v kalendáři, ne údaj, podle kterého se počítá, a spadlý
 * Rozpis směn kvůli ní by byl horší než české svátky u firmy, která je
 * dnes stejně česká.
 */
export async function zemeSvatkuFirmy(tenantId: string): Promise<ZemeSvatku | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.from('tenants').select('country').eq('id', tenantId).maybeSingle()
  if (error || !data) return ZEME_VYCHOZI
  return zemeSvatku((data as { country: string | null }).country)
}
