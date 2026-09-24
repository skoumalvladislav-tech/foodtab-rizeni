import { NextResponse } from 'next/server'

import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: hlídač termínů checklistů (blíží se / po termínu).
 *
 * Zadání Checklisty 2.0, body 21 a 32. VŠECHNU PRÁCI DĚLÁ DATABÁZE
 * (`public.ohlasit_checklisty_terminy`) — každý termín ohlásí jednou
 * (tabulka checklist_terminy_ohlaseno), upozornění jdou přes
 * app.notifikovat (pracovní doba, fronta doručení, majitel — všechno
 * platí samo). Urgentní push se neposílá: „po termínu" je důležité,
 * ne naléhavé (bod 21: „Neposílej automaticky urgentní push").
 *
 * Každá chyba databáze = 500 a červený běh workflow (viz
 * checklisty-naplanovat).
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

  const { data, error } = await supabase.rpc('ohlasit_checklisty_terminy')

  if (error) {
    return NextResponse.json({ chyba: error.message }, { status: 500 })
  }

  return NextResponse.json({ ohlaseno: data ?? 0 })
}
