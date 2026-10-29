import { NextResponse } from 'next/server'

import { tajemstviSedi } from '@/lib/supabase/uloha'
import { provestKrok, REZIMY, ZAPISUJICI, type Rezim } from '@/lib/faktury-prevod-sync'

/**
 * Převod faktur ze staré databáze do hlavní — jeden krok na volání.
 *
 * Spouští JEN Šéfík: GitHub → Actions → „Faktury — převod do hlavní
 * databáze" (.github/workflows/faktury-prevod.yml, ruční spuštění).
 * Návrh a pořadí kroků: docs/faktury-slouceni-navrh.md.
 *
 * Schválně MIMO /api/uloha: není to naplánovaná úloha. Plánovač
 * (pg_cron, app.planovac_ulohy) ji nezná a volat ji nemá — každý krok
 * je rozhodnutí člověka.
 *
 *   * Bearer CRON_SECRET (stejné tajemství jako úlohy).
 *   * Krok musí být výslovně uvedený — bez něj 400, nic se nedomýšlí.
 *   * Kroky, které zapisují, chtějí `potvrzeni` = název kroku (workflow
 *     ho nechá napsat ručně) — překlik v rozbalovací nabídce nic nespustí.
 *   * O pořadí kroků rozhoduje databáze (stav převodu), ne tahle adresa.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROZPOCET_MS = 45_000

export async function POST(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null
  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  let telo: { rezim?: unknown; potvrzeni?: unknown; smazatVic?: unknown; znovuChyby?: unknown }
  try {
    telo = await request.json()
  } catch {
    return NextResponse.json({ chyba: 'Tělo požadavku musí být JSON s „rezim".' }, { status: 400 })
  }

  const rezim = typeof telo.rezim === 'string' ? telo.rezim.trim() : ''
  if (!(REZIMY as readonly string[]).includes(rezim)) {
    return NextResponse.json({ chyba: `Neznámý krok. Povolené: ${REZIMY.join(', ')}.` }, { status: 400 })
  }
  if (ZAPISUJICI.has(rezim as Rezim) && telo.potvrzeni !== rezim) {
    return NextResponse.json({ chyba: `Krok „${rezim}" zapisuje — do potvrzení napište přesně „${rezim}".` }, { status: 400 })
  }

  const vysledek = await provestKrok(rezim as Rezim, {
    konecMs: Date.now() + ROZPOCET_MS,
    smazatVic: telo.smazatVic === true,
    znovuChyby: telo.znovuChyby === true,
  })
  return NextResponse.json(vysledek, { status: 200 })
}
