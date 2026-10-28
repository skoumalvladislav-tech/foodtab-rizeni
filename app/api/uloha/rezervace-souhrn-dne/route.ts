import { NextResponse } from 'next/server'

import { klientUlohy, tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: ranní souhrn rezervací a akcí do upozornění.
 *
 * Zadání Šéfíka 27. 10. 2026 („každý den posílat notifikace o tom, co
 * čeká, kolik rezervací a jaká akce bude ten den v plánu“), migrace
 * 20261103100000_rezervace_souhrn_dne.sql.
 *
 * VŠECHNU PRÁCI DĚLÁ DATABÁZE (`public.rezervace_souhrn_dne_poslat`):
 * pro koho už je ráno (pásmo pobočky, provozní den), komu co patří
 * a že se každá pobočka vyhodnotí za den jen jednou. Tahle adresa jen
 * ověří, kdo volá, a zavolá ji — stejně jako zapomenutý odchod.
 *
 * Volá ji každou hodinu pg_cron (app.planovac_ulohy) a jako záloha
 * GitHub (rezervace-souhrn-dne.yml). Dvojí volání drží zámek úlohy
 * a primární klíč v `rezervace_souhrn_dne`.
 *
 * Bez tajemství 401 a nic dalšího. Když selže některá firma, vrací 500
 * s počty — workflow zčervená a pošle e-mail; ostatní firmy doběhly.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const bezi = await uzBezi('rezervace-souhrn-dne')
  if (bezi) return bezi

  const supabase = klientUlohy()
  if (!supabase) {
    return NextResponse.json(
      { chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.rpc('rezervace_souhrn_dne_poslat')

  if (error) {
    // Podrobnosti do logu Vercelu; odpověď končí ve veřejném logu GitHubu.
    console.error('[rezervace-souhrn-dne] souhrn selhal:', error.code, error.message)
    return NextResponse.json({ chyba: 'Souhrn rezervací selhal.' }, { status: 500 })
  }

  const vysledek = (data ?? {}) as { pobocek?: number; upozorneni?: number; chyb?: number }
  const telo = {
    pobocek: vysledek.pobocek ?? 0,
    upozorneni: vysledek.upozorneni ?? 0,
    chyb: vysledek.chyb ?? 0,
  }

  return NextResponse.json(telo, { status: telo.chyb > 0 ? 500 : 200 })
}
