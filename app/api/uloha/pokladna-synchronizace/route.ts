import { NextResponse } from 'next/server'

import { tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'
import { konecProPokladnu } from '@/lib/pokladna-beh'
import { pokladnyKSynchronizaci, REZERVA_BEHU_MS, synchronizovatPokladnu } from '@/lib/pokladna-sync'

/**
 * Naplánovaná úloha: stažení prodejů z napojených pokladen (Dotykačka
 * a další, které appka umí sama — `lib/pokladna-adaptery.ts`).
 *
 * Stejný vzor jako `app/api/uloha/banka-synchronizace` — Bearer
 * CRON_SECRET, `service_role`, žádný přihlášený uživatel. Pokladny jdou
 * JEDNA PO DRUHÉ, nejdéle nesynchronizovaná první, a každá zbývající
 * dostane stejný díl času (`konecProPokladnu`). Dřív dostala první až
 * 25 s; když doháněla historii, na druhou často nezbylo nic a ta neměla
 * aktuální ani dnešek. Dohánění historie umí skončit uprostřed
 * a příště pokračovat.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Tvrdý konec úlohy (limit 60 s). */
const KONEC_PO_MS = 57_000

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  // Druhý plánovač (pg_cron vedle GitHubu) nesmí tutéž úlohu pustit podruhé.
  const bezi = await uzBezi('pokladna-synchronizace')
  if (bezi) return bezi

  const konecUlohy = Date.now() + KONEC_PO_MS
  const pokladny = await pokladnyKSynchronizaci()

  // Bez id připojení a bez textů chyb: odpověď končí ve veřejném logu
  // GitHub Actions. Důvod je u připojení v Integracích → Pokladní systémy.
  const vysledky: { stav: string; zapsanoRadku: number; zbyvaDohnatDnu: number }[] = []
  for (const [i, p] of pokladny.entries()) {
    // Synchronizace bere `konecMs` jako tvrdý konec a sama si nechá rezervu
    // na rozběhnutý dotaz a zápis — další pokladna má smysl, jen když po ní něco zbývá.
    const konecMs = konecProPokladnu(Date.now(), konecUlohy, pokladny.length - i, REZERVA_BEHU_MS)
    if (konecMs === null) break
    const vysledek = await synchronizovatPokladnu(p.id, { konecMs })
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
