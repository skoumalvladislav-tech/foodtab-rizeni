import { NextResponse } from 'next/server'

import { tajemstviSedi } from '@/lib/supabase/uloha'
import { synchronizovatFioPripojeni, vsechnaAktivniFioPripojeni } from '@/lib/integrace-fio-sync'

/**
 * Naplánovaná úloha: synchronizace bankovních připojení (Fio).
 *
 * Stejný vzor jako app/api/uloha/zapomenuty-odchod/route.ts — Bearer
 * CRON_SECRET, service_role, žádný přihlášený uživatel. Rozdíl: tahle
 * úloha NENÍ „jedna RPC dělá všechno" (ta volá Fio API přes HTTP,
 * což Postgres sám neumí) — orchestraci dělá `lib/integrace-fio-sync.ts`,
 * adresa jen ověří tajemství a zavolá ji pro každé aktivní připojení.
 *
 * Zpracovává se JEDNO PO DRUHÉM (ne Promise.all) — appka je výhradně
 * pro čtení, ale banky i tak mají limit na souběžná/rychlá volání
 * (Fio: 30 s na token, jiné tokeny nejsou omezené navzájem, ale appka
 * se chová obezřetně) a dva souběžné zápisy do STEJNÉHO
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

  const pripojeni = await vsechnaAktivniFioPripojeni()

  const vysledky: { id: string; stav: string; detail: string }[] = []
  for (const p of pripojeni) {
    const vysledek = await synchronizovatFioPripojeni(p.id)
    vysledky.push({
      id: p.id,
      stav: vysledek.stav,
      detail: vysledek.stav === 'ok' ? `${vysledek.pocetNovychRadku} nových řádků` : vysledek.duvod,
    })
  }

  return NextResponse.json({
    zpracovano: pripojeni.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    vysledky,
  })
}
