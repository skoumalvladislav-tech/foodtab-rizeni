import { NextResponse } from 'next/server'

import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: založit dnešní checklisty podle rozvrhu šablon.
 *
 * Zadání Checklisty 2.0, bod 15: „Nevytvářej ručně stejný checklist každý
 * den." VŠECHNU PRÁCI DĚLÁ DATABÁZE (`public.vytvorit_naplanovane_checklisty`):
 * pro každou pobočku podle jejího provozního dne a pásma, idempotentně.
 * Tahle adresa jen ověří, kdo volá, a zavolá ji — stejný vzor jako
 * /api/uloha/zapomenuty-odchod. O hodině rozhoduje databáze, ne plánovač.
 *
 * „Každá směna" a „Ručně" se schválně nezakládají (rozhodnutí 23. 9. —
 * směny nemají vazbu na úsek, přiřazení by bylo hádání).
 *
 * Dokud migrace 20260923170000 není nasazená, funkce v databázi není:
 * odpoví se 200 s poznámkou, ne chybou — plánovač by jinak do nasazení
 * každou hodinu hlásil poruchu, která žádnou poruchou není.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const supabase = klientUlohy()
  if (!supabase) {
    return NextResponse.json(
      { chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.rpc('vytvorit_naplanovane_checklisty')

  if (error) {
    if (funkceNeexistuje(error)) {
      return NextResponse.json({ zalozeno: 0, poznamka: 'čeká na nasazení databáze' })
    }
    return NextResponse.json({ chyba: error.message }, { status: 500 })
  }

  return NextResponse.json({ zalozeno: data ?? 0 })
}
