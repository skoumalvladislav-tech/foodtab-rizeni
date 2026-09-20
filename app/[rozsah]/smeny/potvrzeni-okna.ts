import { potvrzeniZRadku, type PotvrzeniRozpisu, type PotvrzeniSmeny } from '@/lib/rozpis-desktop'
import { tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import type { getServerSupabase } from '@/lib/supabase/server'

/**
 * Kdo z lidí už směnu potvrdil — pro puntík u času směny (žlutý × zelený).
 *
 * Načítá se JEDNOU v `page.tsx` za celé okno rozpisu a jen tomu, kdo na
 * nějaké pobočce plánuje. Čte se přímo z `smeny_potvrzeni` (migrace
 * 20260920120000) — tabulka má RLS, takže vedoucí dostane jen pobočky, kde
 * plánuje; tenhle soubor si jen pamatuje, za které pobočky odpověď platí
 * (`pobocky`): u ostatních by chybějící záznam vypadal jako „nepotvrzeno“.
 *
 * Doplněk, ne podmínka zobrazení: bez tabulky (migrace ještě neproběhla)
 * nebo při chybě je výsledek `null` a vydané směny prostě puntík nemají.
 * Nevymýšlí se, že je nikdo nepotvrdil.
 *
 * PostgREST vrací nejvýš 1000 řádků na dotaz, proto se stránkuje; řádky
 * musí mít pevné pořadí, jinak by stránky mohly řádek vynechat nebo
 * zdvojit. Kdyby jich bylo nepředstavitelně mnoho, radši „nevíme“ než
 * ořezaný výsledek, který by chybějící potvrzení četl jako žluté.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

const STRANA = 1000
const NEJVIC_STRAN = 10

const SLOUPCE = 'shift_id, employee_id, shift_date, starts_at, ends_at, pauza_od, pauza_do, confirmed_at'

export async function nactiPotvrzeniOkna(
  supabase: Supabase,
  pobocky: string[],
  bezUctu: string[],
  od: string,
  doKdy: string,
): Promise<PotvrzeniRozpisu | null> {
  if (pobocky.length === 0) return null

  const radky: PotvrzeniSmeny[] = []
  for (let strana = 0; strana < NEJVIC_STRAN; strana++) {
    const { data, error } = await supabase
      .from('smeny_potvrzeni')
      .select(SLOUPCE)
      .in('branch_id', pobocky)
      .gte('shift_date', od)
      .lte('shift_date', doKdy)
      .order('shift_date', { ascending: true })
      .order('id', { ascending: true })
      .range(strana * STRANA, (strana + 1) * STRANA - 1)

    if (error) {
      // Chybějící migrace se promíjí; jiná chyba také, ale v logu zůstane.
      if (!tabulkaNeexistuje(error)) console.error('smeny_potvrzeni selhalo', error)
      return null
    }

    radky.push(...((data ?? []) as PotvrzeniSmeny[]))
    if ((data ?? []).length < STRANA) return potvrzeniZRadku(radky, pobocky, bezUctu)
  }
  console.error('smeny_potvrzeni: víc než', NEJVIC_STRAN * STRANA, 'řádků v okně, potvrzení se nezobrazí')
  return null
}
