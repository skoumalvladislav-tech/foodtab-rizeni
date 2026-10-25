import { NextResponse } from 'next/server'

import { tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'
import { choiceKSynchronizaci, REZERVA_DOTAZU_MS, synchronizovatChoice } from '@/lib/rezervace-choice-sync'

/**
 * Naplánovaná úloha: načtení rezervací z Choice (choiceqr.com) do
 * Provoz → Rezervace a akce. Každých 15 minut
 * (.github/workflows/rezervace-choice.yml, `app.planovac_ulohy`).
 *
 * Choice rezervace neposílá sám (webhooky pro rezervace nemá), proto se
 * Foodtab ptá. Do Choice nic nezapisuje.
 *
 * Stejný vzor jako `pokladna-synchronizace`: Bearer CRON_SECRET,
 * `service_role`, žádný přihlášený. Připojení jdou JEDNO PO DRUHÉM,
 * nejdéle nenačtené první, a každé zbývající dostane stejný díl času.
 * Mezi všemi dotazy na Choice drží rozestup 5,5 s databázová fronta
 * (`rezervace_choice_zabrat_dotaz`) — i mezi pobočkami a souběžnými
 * běhy. Když Choice vrátí 429, úloha skončí a zkusí to příště.
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

  const bezi = await uzBezi('rezervace-choice')
  if (bezi) return bezi

  const konecUlohy = Date.now() + KONEC_PO_MS
  // Méně času než na jeden dotaz a zápis nemá smysl dávat dalšímu připojení.
  // (Až tady, ne nahoře v modulu: import se nesmí číst při načtení adresy.)
  const nejmeneNaPripojeni = REZERVA_DOTAZU_MS + 6_000
  const pripojeni = await choiceKSynchronizaci()

  // Bez id připojení a bez textů chyb: odpověď končí ve veřejném logu
  // GitHub Actions. Důvod je u napojení v Rezervace → Napojení a import.
  const vysledky: { stav: string; dotazu: number; nacteno: number; pokracovani: boolean }[] = []
  let omezeno = false
  for (const [i, id] of pripojeni.entries()) {
    const zbyva = konecUlohy - Date.now()
    if (zbyva < nejmeneNaPripojeni) break
    // Stejný díl zbývajícího času každému zbývajícímu připojení.
    const dil = Math.max(nejmeneNaPripojeni, Math.floor(zbyva / (pripojeni.length - i)))
    const v = await synchronizovatChoice(id, { konecMs: Math.min(konecUlohy, Date.now() + dil) })
    vysledky.push({ stav: v.stav, dotazu: v.dotazu, nacteno: v.nacteno, pokracovani: v.pokracovani })
    if (v.omezeno) {
      omezeno = true
      break
    }
  }

  return NextResponse.json({
    pripojeni: pripojeni.length,
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    omezeno,
    vysledky,
  })
}
