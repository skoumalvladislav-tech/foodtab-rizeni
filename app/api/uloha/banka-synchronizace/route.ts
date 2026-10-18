import { NextResponse } from 'next/server'

import { tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'
import { synchronizovatFioPripojeni, vsechnaAktivniFioPripojeni } from '@/lib/integrace-fio-sync'
import { synchronizovatSaltEdgePripojeni, vsechnaAktivniSaltEdgePripojeni } from '@/lib/integrace-saltedge-sync'
import { automatickyParovatPlatby } from '@/lib/finance-automaticke-parovani'
import { firmySOtevrenymiFakturami } from '@/lib/faktury-pristup'
import { synchronizovatKbPripojeni, vsechnaAktivniKbPripojeni } from '@/lib/kb-adaa-sync'

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

  // Druhý plánovač (pg_cron vedle GitHubu) nesmí tutéž úlohu pustit podruhé.
  const bezi = await uzBezi('banka-synchronizace')
  if (bezi) return bezi

  const zacatek = Date.now()
  const [fioPripojeni, saltEdgePripojeni, kbPripojeni] = await Promise.all([vsechnaAktivniFioPripojeni(), vsechnaAktivniSaltEdgePripojeni(), vsechnaAktivniKbPripojeni()])

  // Bez id připojení a bez textů chyb: odpověď končí v logu GitHub Actions a
  // repozitář je veřejný. Důvod chyby je u připojení v Integracích → Banka
  // (`integrace_pripojeni.posledni_chyba`) a u běhu (`synchronizace_behy.chyba`).
  const vysledky: { stav: string; novychRadku: number }[] = []
  for (const p of fioPripojeni) {
    const vysledek = await synchronizovatFioPripojeni(p.id)
    vysledky.push({ stav: vysledek.stav, novychRadku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : 0 })
  }
  for (const p of saltEdgePripojeni) {
    const vysledek = await synchronizovatSaltEdgePripojeni(p.id)
    vysledky.push({ stav: vysledek.stav, novychRadku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : 0 })
  }
  // Komerční banka (ADAA): odstup řídí interval připojení — výchozí 1× denně kvůli poplatkům KB.
  // Jeden běh KB trvá až ~30 s (stahování má strop 25 s) — další připojení
  // se začne jen do 25 s od začátku úlohy (strop 60 s), ostatní zůstanou
  // na řadě a vezme je příští spuštění.
  for (const p of kbPripojeni) {
    if (Date.now() - zacatek > 25_000) {
      vysledky.push({ stav: 'preskoceno', novychRadku: 0 })
      continue
    }
    const vysledek = await synchronizovatKbPripojeni(p.id)
    vysledky.push({ stav: vysledek.stav, novychRadku: vysledek.stav === 'ok' ? vysledek.pocetNovychRadku : 0 })
  }

  // Nové pohyby z banky → jednoznačné shody s fakturami se spárují samy
  // a faktura přejde na „Uhrazeno" (Šéfík 8. 10. 2026). Firmy s otevřenými
  // Fakturami bere z databáze (dřív jediná z FAKTURY_DB_TENANT_ID) — brána
  // uvnitř párování to ověří znovu. Jen když po synchronizaci zbývá čas
  // (maxDuration 60 s); jinak příště.
  let parovani = null as { stav: string; sparovano: number; dorovnano: number } | null
  if (Date.now() < zacatek + 40_000) {
    for (const tenantId of await firmySOtevrenymiFakturami()) {
      if (Date.now() >= zacatek + 50_000) break
      const r = await automatickyParovatPlatby(tenantId, { konecMs: zacatek + 55_000 })
      parovani = {
        stav: parovani && parovani.stav !== r.stav ? 'smisene' : r.stav,
        sparovano: (parovani?.sparovano ?? 0) + r.sparovano,
        dorovnano: (parovani?.dorovnano ?? 0) + r.dorovnano,
      }
    }
  }

  return NextResponse.json({
    // Jen čísla a stav — odpověď končí ve veřejném logu GitHub Actions.
    parovani: parovani ? { stav: parovani.stav, sparovano: parovani.sparovano, dorovnano: parovani.dorovnano } : null,
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    vysledky,
  })
}
