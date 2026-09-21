import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from '@/lib/supabase/dotaz'
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
 * ukáže „Osobní“ jako dřív, nespadne. TOLERUJE SE JEN CHYBĚJÍCÍ FUNKCE — jiná
 * chyba (chybějící EXECUTE, chyba v těle funkce, přetížení) by se jinak tiše
 * ukázala jako „Osobní“ a nikdo by se o poruše nedozvěděl (viz
 * lib/supabase/dotaz.ts).
 */
export async function nactiNazvyOsobnich(
  supabase: Supabase,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('jmena_osobnich_rozhovoru', { p_tenant: tenantId })
  if (error) {
    if (funkceNeexistuje(error)) return new Map()
    throw new DotazSelhal('názvy osobních rozhovorů', error)
  }
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
 * Jiná chyba se vyhazuje (viz nactiNazvyOsobnich).
 */
export async function nactiJmenaVRozhovoru(
  supabase: Supabase,
  konverzace: string,
): Promise<Map<string, string> | null> {
  const { data, error } = await supabase.rpc('lide_v_rozhovoru', { p_konverzace: konverzace })
  if (error) {
    if (funkceNeexistuje(error)) return null
    throw new DotazSelhal('jména v rozhovoru', error)
  }
  return new Map(
    ((data ?? []) as { employee_id: string; jmeno: string | null }[]).map((r) => [
      r.employee_id,
      String(r.jmeno ?? '').trim(),
    ]),
  )
}

/**
 * Náhled poslední zprávy do seznamu rozhovorů: pro každý rozhovor text
 * nejnovější NEstornované zprávy (zkrácený), u hlasovky „Hlasová zpráva“.
 *
 * SYSTÉMOVÉ UDÁLOSTI SE NEPOČÍTAJÍ („Vytvořen úkol: …“, migrace
 * 20260921110000, sloupec `typ`) — nejsou to zprávy a `moje_rozhovory` je
 * nepočítá jako nepřečtené; jako „poslední zpráva“ rozhovoru by ale mátly.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: dotaz se zkouší od nejúplnějšího výběru
 * (typ + zvuk) k nejskromnějšímu a bere první, který databáze zná.
 */
export async function nactiPosledniTexty(
  supabase: Supabase,
  konverzace: string[],
): Promise<Map<string, string>> {
  const vysledek = new Map<string, string>()
  if (konverzace.length === 0) return vysledek

  const VARIANTY = [
    { sloupce: 'konverzace_id, text, zvuk_cesta, vytvoreno_kdy', bezSystemovych: true },
    { sloupce: 'konverzace_id, text, zvuk_cesta, vytvoreno_kdy', bezSystemovych: false },
    { sloupce: 'konverzace_id, text, vytvoreno_kdy', bezSystemovych: false },
  ] as const

  let radky: { konverzace_id: string; text: string; zvuk_cesta?: string | null }[] = []
  for (const v of VARIANTY) {
    let dotaz = supabase
      .from('konverzace_zpravy')
      .select(v.sloupce)
      .in('konverzace_id', konverzace)
      .is('stornovano_kdy', null)
    if (v.bezSystemovych) dotaz = dotaz.eq('typ', 'zprava')
    const { data, error } = await dotaz.order('vytvoreno_kdy', { ascending: false }).limit(300)
    if (error) {
      if (sloupecNeexistuje(error)) continue
      throw new DotazSelhal('náhledy rozhovorů', error)
    }
    radky = (data ?? []) as unknown as typeof radky
    break
  }

  for (const z of radky) {
    if (vysledek.has(z.konverzace_id)) continue
    const t = String(z.text ?? '').trim()
    vysledek.set(
      z.konverzace_id,
      t.length > 72 ? `${t.slice(0, 72)}…` : t || (z.zvuk_cesta ? 'Hlasová zpráva' : ''),
    )
  }
  return vysledek
}
