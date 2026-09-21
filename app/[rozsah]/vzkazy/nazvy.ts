import { getServerSupabase } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Názvy osobních rozhovorů bez názvu — jména ostatních účastníků, jak je
 * vidí přihlášený (`jmena_osobnich_rozhovoru`).
 *
 * Osobní rozhovor sdílí jeden řádek mezi všechny účastníky, ale každý z nich
 * má vidět toho DRUHÉHO, ne sám sebe. Proto se název neukládá, skládá se při
 * zobrazení.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: bez funkce se vrací prázdná mapa a seznam
 * ukáže „Osobní“ jako dřív, nespadne.
 */
export async function nactiNazvyOsobnich(
  supabase: Supabase,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('jmena_osobnich_rozhovoru', { p_tenant: tenantId })
  if (error) return new Map()
  return new Map(
    ((data ?? []) as { konverzace_id: string; nazev: string | null }[])
      .filter((r) => r.nazev && r.nazev.trim() !== '')
      .map((r) => [r.konverzace_id, String(r.nazev).trim()]),
  )
}

/**
 * Jména lidí v jednom rozhovoru (`lide_v_rozhovoru`): účastníci a autoři
 * zpráv. Kdo v rozhovoru není, dostane prázdno.
 *
 * Bez funkce (migrace ještě není) se vrací `null` a volající sáhne po
 * starém čtení z `employees` — to ukáže jen ty, které smí člověk číst.
 */
export async function nactiJmenaVRozhovoru(
  supabase: Supabase,
  konverzace: string,
): Promise<Map<string, string> | null> {
  const { data, error } = await supabase.rpc('lide_v_rozhovoru', { p_konverzace: konverzace })
  if (error) return null
  return new Map(
    ((data ?? []) as { employee_id: string; jmeno: string | null }[]).map((r) => [
      r.employee_id,
      String(r.jmeno ?? '').trim(),
    ]),
  )
}
