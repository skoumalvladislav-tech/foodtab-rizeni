import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Provozní den pobočky.
 *
 * Ptá se databáze přes public.business_date(). Hodina, kdy pobočce začíná
 * nový den, i její časové pásmo patří pobočce — v kódu se to nedopočítává,
 * jinak by pravidlo žilo na dvou místech a časem se rozešlo.
 *
 * Vrací null, když pobočka není dostupná (cizí firma, chybějící funkce).
 * Volající to musí ošetřit — tichý návrat dnešního data v zóně serveru by
 * byl přesně ta chyba, které se vyhýbáme.
 */
export async function provozniDen(
  branchId: string,
  kdy?: Date,
): Promise<string | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('business_date', {
    p_branch: branchId,
    ...(kdy ? { p_at: kdy.toISOString() } : {}),
  })
  if (error || !data) return null
  return String(data)
}

/** Posun data ve tvaru YYYY-MM-DD o dny, bez ohledu na časové pásmo. */
export function posunDatum(datum: string, dnu: number): string {
  const [r, m, d] = datum.split('-').map(Number)
  const posunuty = new Date(Date.UTC(r, m - 1, d + dnu))
  return posunuty.toISOString().slice(0, 10)
}
