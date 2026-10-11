import { NextResponse } from 'next/server'

import { tajemstviSedi } from '@/lib/supabase/uloha'
import { pokladnyKSynchronizaci, synchronizovatPokladnu } from '@/lib/pokladna-sync'

/**
 * Naplánovaná úloha: stažení prodejů z napojených pokladen (Dotykačka
 * a další, které appka umí sama — `lib/pokladna-adaptery.ts`).
 *
 * Stejný vzor jako `app/api/uloha/banka-synchronizace` — Bearer
 * CRON_SECRET, `service_role`, žádný přihlášený uživatel. Pokladny jdou
 * JEDNA PO DRUHÉ: každá dostane svůj díl času (dohánění historie umí
 * skončit uprostřed a příště pokračovat), poslední zbytek dostane ta,
 * na kterou vyjde. Pokladna, která se dnes nestihne, přijde na řadu
 * příští hodinu — pořadí dává seznam, ne priorita.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rezerva na zápis výsledku a odpověď před limitem 60 s. */
const KONEC_PO_MS = 50_000
const NEJVYS_NA_POKLADNU_MS = 25_000

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const konecUlohy = Date.now() + KONEC_PO_MS
  const pokladny = await pokladnyKSynchronizaci()

  // Bez id připojení a bez textů chyb: odpověď končí ve veřejném logu
  // GitHub Actions. Důvod je u připojení v Integracích → Pokladní systémy.
  const vysledky: { stav: string; zapsanoRadku: number; zbyvaDohnatDnu: number }[] = []
  for (const p of pokladny) {
    if (Date.now() > konecUlohy - 5_000) break
    const vysledek = await synchronizovatPokladnu(p.id, { konecMs: Math.min(konecUlohy, Date.now() + NEJVYS_NA_POKLADNU_MS) })
    vysledky.push({
      stav: vysledek.stav,
      zapsanoRadku: vysledek.stav === 'ok' ? vysledek.zapsanoRadku : 0,
      zbyvaDohnatDnu: vysledek.stav === 'ok' ? vysledek.zbyvaDohnatDnu : 0,
    })
  }

  return NextResponse.json({
    pokladen: pokladny.length,
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    vysledky,
  })
}
