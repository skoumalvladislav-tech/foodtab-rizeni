import { oknoPotvrzeniSeVejde, potvrzeniZRadku, type PotvrzeniRozpisu, type RadekPotvrzeni } from '@/lib/rozpis-desktop'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import type { getServerSupabase } from '@/lib/supabase/server'

/**
 * Kdo z lidí už směnu potvrdil — pro puntík u času směny (žlutý × zelený).
 *
 * Načítá se JEDNOU v `page.tsx` za celé okno rozpisu a jen tomu, kdo na
 * nějaké pobočce plánuje: upozornění jsou soukromá a stav potvrzení je věc
 * vedoucího. Hodnotu čte databáze (`stav_potvrzeni_smen`, migrace
 * 20260920100000) a ona také ohlídá, za které pobočky ji dá; tenhle soubor
 * jen přenáší a pamatuje si, za které pobočky odpověď platí — u ostatních
 * by chybějící řádek vypadal jako „nepotvrzeno“.
 *
 * Doplněk, ne podmínka zobrazení: bez funkce v databázi (migrace ještě
 * neproběhla) nebo při chybě je výsledek `null` a vydané směny prostě
 * puntík nemají. Nevymýšlí se, že je nikdo nepotvrdil.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

export async function nactiPotvrzeniOkna(
  supabase: Supabase,
  tenantId: string,
  pobocky: string[],
  od: string,
  doKdy: string,
): Promise<PotvrzeniRozpisu | null> {
  if (pobocky.length === 0) return null
  if (!oknoPotvrzeniSeVejde(od, doKdy)) return null

  const { data, error } = await supabase.rpc('stav_potvrzeni_smen', {
    p_tenant: tenantId,
    p_od: od,
    p_do: doKdy,
  })

  if (error) {
    // Chybějící migrace se promíjí; jiná chyba také, ale v logu zůstane.
    if (!funkceNeexistuje(error)) console.error('stav_potvrzeni_smen selhal', error)
    return null
  }

  return potvrzeniZRadku((data ?? []) as RadekPotvrzeni[], pobocky)
}
