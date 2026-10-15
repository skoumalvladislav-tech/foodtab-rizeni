import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { prevestPrehled, type Cleneni, type PrehledTrzeb } from '@/lib/pokladna-trzby'

/**
 * Přehled tržeb z pokladen (`pokladna_prehled_trzeb`).
 *
 * Funkce je od 13. 10. 2026 SECURITY DEFINER: práva ověří jednou na
 * začátku (`finance.read` + viditelné pobočky volajícího) — výsledek je
 * stejný jako přes RLS, jen bez kontroly po řádcích. Vrací VŠECHNY
 * pobočky, které volající vidí, a bankovní příjmy i firemních účtů;
 * zúžení na pobočku rozsahu dělá volající (`jenPobocka`,
 * lib/pokladna-trzby.ts) a o zobrazení banky rozhoduje stránka.
 *
 * `null` = funkce v databázi ještě není (kód nasazený dřív než
 * migrace 20261012200000) — stránka pak řekne „čeká na aktualizaci
 * databáze", nespadne. Jakákoli jiná chyba se vyhodí: prázdný přehled
 * by vypadal jako „žádné prodeje", a to je lež.
 */
export async function nactiPrehledTrzeb(tenantId: string, od: string, doData: string, cleneni: Cleneni): Promise<PrehledTrzeb | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('pokladna_prehled_trzeb', { p_tenant: tenantId, p_od: od, p_do: doData, p_cleneni: cleneni })
  if (funkceNeexistuje(error)) return null
  if (error) throw new DotazSelhal('přehled tržeb z pokladen', error)
  return prevestPrehled(data)
}
