import { NextResponse } from 'next/server'

import { tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'
import { REGISTR_BANK } from '@/lib/banka/konektory'
import { synchronizovatVsechnaPripojeni } from '@/lib/banka/konektor'
import { automatickyParovatPlatby } from '@/lib/finance-automaticke-parovani'
import { najitNavrhyParovani } from '@/lib/finance-navrhy-parovani'
import { firmySOtevrenymiFakturami } from '@/lib/faktury-pristup'

/**
 * Naplánovaná úloha: synchronizace bankovních připojení.
 *
 * Stejný vzor jako app/api/uloha/zapomenuty-odchod/route.ts — Bearer
 * CRON_SECRET, service_role, žádný přihlášený uživatel. Rozdíl: tahle
 * úloha NENÍ „jedna RPC dělá všechno" (appka volá bankovní API přes
 * HTTP, což Postgres sám neumí). Které banky a jak, ví jen registr
 * konektorů (`lib/banka/konektory.ts`); adresa ověří tajemství
 * a zavolá synchronizaci všech aktivních připojení
 * (`synchronizovatVsechnaPripojeni`, lib/banka/konektor.ts).
 *
 * Připojení se zpracovávají JEDNO PO DRUHÉM v pořadí registru (ne
 * `Promise.all` nad samotnou synchronizací — jen nad počátečním
 * seznamem, to je levné čtení z appčiny DB, ne volání banky). Appka je
 * výhradně pro čtení, ale banky i tak mají limit na souběžná/rychlá
 * volání a dva souběžné zápisy do STEJNÉHO `platebni_ucty` by si
 * zbytečně šlapaly na zámek `synchronizace_behy`. Konektor s dlouhým
 * stahováním si řekne, do kdy od začátku úlohy smí začít další
 * připojení (`zacitNejpozdejiMs`); ostatní vezme příští spuštění.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  // Druhý plánovač (pg_cron vedle GitHubu) nesmí tutéž úlohu pustit podruhé.
  const bezi = await uzBezi('banka-synchronizace')
  if (bezi) return bezi

  const zacatek = Date.now()

  // Bez id připojení a bez textů chyb: odpověď končí v logu GitHub Actions a
  // repozitář je veřejný. Důvod chyby je u připojení v Integracích → Banka
  // (`integrace_pripojeni.posledni_chyba`) a u běhu (`synchronizace_behy.chyba`).
  const vysledky = await synchronizovatVsechnaPripojeni(REGISTR_BANK, { zacatek, ted: () => Date.now() })

  // Nové pohyby z banky → jednoznačné shody s fakturami se spárují samy
  // a faktura přejde na „Uhrazeno" (Šéfík 8. 10. 2026). Firmy s otevřenými
  // Fakturami bere z databáze (dřív jediná z FAKTURY_DB_TENANT_ID) — brána
  // uvnitř párování to ověří znovu. Jen když po synchronizaci zbývá čas
  // (maxDuration 60 s); jinak příště.
  // Po jistých shodách hledá návrhy (Finance Fáze 0, krok 2) do fronty
  // Návrhy párování — potvrzuje je vždy člověk.
  let parovani = null as { stav: string; sparovano: number; dorovnano: number; navrzeno: number } | null
  if (Date.now() < zacatek + 40_000) {
    const firmy = await firmySOtevrenymiFakturami()
    if (firmy === null) parovani = { stav: 'chyba', sparovano: 0, dorovnano: 0, navrzeno: 0 }
    for (const tenantId of firmy ?? []) {
      if (Date.now() >= zacatek + 50_000) break
      const r = await automatickyParovatPlatby(tenantId, { konecMs: zacatek + 55_000 })
      const n = Date.now() < zacatek + 52_000
        ? await najitNavrhyParovani(tenantId, { konecMs: zacatek + 55_000 })
        : { stav: r.stav, navrzeno: 0 }
      const stav = r.stav === n.stav ? r.stav : 'smisene'
      parovani = {
        stav: parovani && parovani.stav !== stav ? 'smisene' : stav,
        sparovano: (parovani?.sparovano ?? 0) + r.sparovano,
        dorovnano: (parovani?.dorovnano ?? 0) + r.dorovnano,
        navrzeno: (parovani?.navrzeno ?? 0) + n.navrzeno,
      }
    }
  }

  return NextResponse.json({
    // Jen čísla a stav — odpověď končí ve veřejném logu GitHub Actions.
    parovani: parovani
      ? { stav: parovani.stav, sparovano: parovani.sparovano, dorovnano: parovani.dorovnano, navrzeno: parovani.navrzeno }
      : null,
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    vysledky,
  })
}
