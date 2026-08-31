import 'server-only'

import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Provozní den pobočky.
 *
 * Ptá se databáze přes public.business_date(). Hodina, kdy pobočce začíná
 * nový den, i její časové pásmo patří pobočce — v kódu se to nedopočítává,
 * jinak by pravidlo žilo na dvou místech a časem se rozešlo.
 *
 * Vrací null, když pobočka není dostupná (cizí firma, RLS ji nepustí).
 * Volající to musí ošetřit — tichý návrat dnešního data v zóně serveru by
 * byl přesně ta chyba, které se vyhýbáme.
 *
 * Chyba dotazu se ale od „není dostupná“ ODDĚLUJE a vyhazuje se. Dokud
 * se zahazovala, znamenal překlep v názvu funkce nebo výpadek databáze
 * to samé jako cizí pobočka: na Docházce prostě zmizela píchačka a
 * nikde nestálo proč. Zaměstnanec by si nezapsal příchod a dozvěděl by
 * se to až u výplaty.
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
  if (error) throw new DotazSelhal('provozní den pobočky', error)
  if (!data) return null
  return String(data)
}

/** Posun data ve tvaru YYYY-MM-DD o dny, bez ohledu na časové pásmo. */
export function posunDatum(datum: string, dnu: number): string {
  const [r, m, d] = datum.split('-').map(Number)
  const posunuty = new Date(Date.UTC(r, m - 1, d + dnu))
  return posunuty.toISOString().slice(0, 10)
}
