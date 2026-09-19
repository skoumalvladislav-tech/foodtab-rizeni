import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import type { getServerSupabase } from '@/lib/supabase/server'

/**
 * Co říká databáze o vydání rozpisu za období.
 *
 * Načítá se JEDNOU v `page.tsx` a rozdává se oběma prezentacím —
 * mobilnímu panelu (`panel-vydani.tsx`) i kompaktnímu pruhu na
 * počítači (`desktop/vydani.tsx`). Dřív si panel volal RPC sám, takže by
 * se při druhé prezentaci volalo dvakrát totéž.
 *
 * Náhled i vydání počítá rozdíl táž funkce v databázi
 * (`app.rozdil_rozpisu`), aby náhled neslíbil něco jiného, než co se
 * stane. Tenhle soubor rozdíl NEPOČÍTÁ, jen ho přenáší.
 */

/** Jeden řádek náhledu: kdo, jaká změna, kolikrát. */
export type RadekNahledu = {
  user_id: string
  jmeno: string
  zmena: string
  pocet: number
}

export type StavVydani = {
  vydano_kdy: string | null
  smen: number
  zmen: number
}

export type DataVydani = {
  nahled: RadekNahledu[]
  /** `null`, když `rozpis_stav` v databázi ještě není. */
  stav: StavVydani | null
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * `null` = funkce v databázi není (migrace 20260901130000 ještě
 * neproběhla) nebo dotaz selhal. Obrazovky se pak vydání prostě
 * nekreslí — rozpis kvůli tomu padat nemá.
 */
export async function nactiDataVydani(
  supabase: Supabase,
  tenantId: string,
  branchId: string,
  od: string,
  doKdy: string,
): Promise<DataVydani | null> {
  const parametry = { p_tenant: tenantId, p_branch: branchId, p_od: od, p_do: doKdy }

  const [nahled, stav] = await Promise.all([
    supabase.rpc('rozpis_nahled', parametry),
    supabase.rpc('rozpis_stav', parametry),
  ])

  if (nahled.error) {
    // Chybějící migrace se promíjí; jiná chyba také — vydání je doplněk,
    // ne podmínka zobrazení rozpisu. Nepromíjí se ale potichu: v logu zůstane.
    if (!funkceNeexistuje(nahled.error)) console.error('rozpis_nahled selhal', nahled.error)
    return null
  }

  return {
    nahled: (nahled.data ?? []) as RadekNahledu[],
    stav: stav.error ? null : (((stav.data ?? [])[0] as StavVydani | undefined) ?? null),
  }
}
