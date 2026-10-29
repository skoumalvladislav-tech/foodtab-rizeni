import { NextResponse } from 'next/server'

import { problemyPlanovace, type StavUlohy } from '@/lib/planovac-hlidac'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Hlídač plánovače úloh: volá databáze úlohy, jak má?
 *
 * Rozhodnutí je v `lib/planovac-hlidac.ts`, data z
 * `public.planovac_zdravi()` (migrace 20261104100000_planovac_hlidac).
 * Volá to `.github/workflows/planovac-hlidac.yml` a při 503 zčervená —
 * GitHub pak pošle e-mail, což pg_cron sám neumí.
 *
 * Schválně NENÍ pod `/api/uloha`: tam jsou úlohy, které plánuje pg_cron,
 * a hlídač nesmí záviset na tom, co hlídá.
 *
 * Stejně jako úlohy: Bearer CRON_SECRET, bez tajemství 401 a nic víc.
 * Odpověď končí ve veřejném logu GitHubu — jen jména úloh, kódy a minuty.
 *
 *   200 — všechny úlohy v pořádku
 *   503 — aspoň jeden problém, nebo migrace ještě není nasazená
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
    return NextResponse.json({ chyba: 'Hlídač není nastavený — chybí SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })
  }

  const { data, error } = await supabase.rpc('planovac_zdravi')
  if (error) {
    // Nenasazená migrace je taky „plánovač nehlídaný" — nahlas, ne zeleně.
    if (funkceNeexistuje(error)) return NextResponse.json({ stav: 'ceka_na_migraci' }, { status: 503 })
    console.error('[planovac-hlidac]', error.code, error.message)
    return NextResponse.json({ chyba: 'Stav plánovače se nepodařilo přečíst.' }, { status: 500 })
  }

  const stav = (data ?? []) as StavUlohy[]
  const problemy = problemyPlanovace(stav, new Date())
  const sProblemem = new Set(problemy.map((p) => p.uloha))

  return NextResponse.json(
    {
      ulohy: stav.length,
      v_poradku: stav.filter((u) => !sProblemem.has(u.uloha)).length,
      chyb_6h: stav.reduce((s, u) => s + (u.chyb_6h ?? 0), 0),
      problemy,
    },
    { status: problemy.length > 0 ? 503 : 200 },
  )
}
