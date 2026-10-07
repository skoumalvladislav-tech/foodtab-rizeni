import { NextResponse } from 'next/server'

import { tajemstviSedi } from '@/lib/supabase/uloha'
import { synchronizovatFioPripojeni, vsechnaAktivniFioPripojeni } from '@/lib/integrace-fio-sync'
import { synchronizovatSaltEdgePripojeni, vsechnaAktivniSaltEdgePripojeni } from '@/lib/integrace-saltedge-sync'

/**
 * Naplánovaná úloha: synchronizace bankovních připojení (Fio, Salt Edge).
 *
 * Stejný vzor jako app/api/uloha/zapomenuty-odchod/route.ts — Bearer
 * CRON_SECRET, service_role, žádný přihlášený uživatel. Rozdíl: tahle
 * úloha NENÍ „jedna RPC dělá všechno" (appka volá bankovní API přes
 * HTTP, což Postgres sám neumí) — orchestraci dělá `lib/integrace-fio-sync.ts`/
 * `lib/integrace-saltedge-sync.ts`, adresa jen ověří tajemství a zavolá
 * ji pro každé aktivní připojení. Enable Banking se 7.10.2026
 * přehodnocuje (Salt Edge je nový hlavní agregátor) — do téhle úlohy
 * se proto nedoplňuje.
 *
 * Připojení se zpracovávají JEDNO PO DRUHÉM, Fio i Salt Edge (ne
 * `Promise.all` nad samotnou synchronizací — jen nad počátečním
 * seznamem, to je levné čtení z appčiny DB, ne volání banky). Appka je
 * výhradně pro čtení, ale banky i tak mají limit na souběžná/rychlá
 * volání (Fio: 30 s na token) a dva souběžné zápisy do STEJNÉHO
 * `platebni_ucty` by si zbytečně šlapaly na zámek `synchronizace_behy`.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const [fioPripojeni, saltEdgePripojeni] = await Promise.all([vsechnaAktivniFioPripojeni(), vsechnaAktivniSaltEdgePripojeni()])

  const vysledky: { id: string; stav: string; detail: string }[] = []
  for (const p of fioPripojeni) {
    const vysledek = await synchronizovatFioPripojeni(p.id)
    vysledky.push({
      id: p.id,
      stav: vysledek.stav,
      detail: vysledek.stav === 'ok' ? `${vysledek.pocetNovychRadku} nových řádků` : vysledek.duvod,
    })
  }
  for (const p of saltEdgePripojeni) {
    const vysledek = await synchronizovatSaltEdgePripojeni(p.id)
    vysledky.push({
      id: p.id,
      stav: vysledek.stav,
      detail: vysledek.stav === 'ok' ? `${vysledek.pocetNovychRadku} nových řádků` : vysledek.duvod,
    })
  }

  return NextResponse.json({
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    vysledky,
  })
}
