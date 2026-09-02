import { NextResponse } from 'next/server'

import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: upozornění na zapomenutý odchod.
 *
 * Zadání docs/zapomenuty-odchod-zadani.md, oddíl 4.
 *
 * ---------------------------------------------------------------------
 * ROZDĚLENÍ PRÁCE
 *
 * VŠECHNU PRÁCI DĚLÁ DATABÁZE (`public.ohlasit_zapomenute_odchody`).
 * Tahle adresa jen ověří, kdo volá, a zavolá ji. Až se přestěhujeme
 * z Vercelu jinam, mění se jen to, kdo tu adresu volá — ne co dělá.
 *
 * ---------------------------------------------------------------------
 * ČTYŘI VĚCI, KTERÉ SE U NAPLÁNOVANÝCH ÚLOH POKAZÍ VŽDYCKY
 *
 * 1. NECHRÁNĚNÁ ADRESA. Tajemství je v prostředí (`CRON_SECRET`),
 *    porovnává se v konstantním čase a do prohlížeče se nedostane —
 *    tenhle soubor běží jen na serveru a klíč `service_role` je
 *    v modulu s `server-only`.
 *
 * 2. ZIMNÍ A LETNÍ ČAS. Vercel umí plánovat jen v UTC, takže by se
 *    v zimě ozvalo v 10:00 a v létě v 9:00. Řeší se to tím, že
 *    PLÁNOVAČ BĚŽÍ KAŽDOU HODINU a o hodině rozhoduje databáze podle
 *    místního času a nastavení firmy. Tady se žádný čas neřeší.
 *
 * 3. ZMEŠKANÉ SPUŠTĚNÍ. Když v 9:00 nic neběželo, běh v 11:00 doběhne
 *    normálně: hledá se podle stáří příchodu, ne podle hodiny.
 *
 * 4. DVOJÍ SPUŠTĚNÍ. Každý záznam se ohlásí jednou — je na to primární
 *    klíč v `zapomenute_odchody`, ne příznak, na který se dá zapomenout.
 *
 * ---------------------------------------------------------------------
 * ODPOVĚDI
 *
 * Bez tajemství se vrací 401 a nic dalšího. Kdo netrefí, nesmí se
 * z odpovědi dozvědět, jestli adresa vůbec něco dělá.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  /*
    Vercel Cron posílá `Authorization: Bearer <CRON_SECRET>`. Jiný
    plánovač může poslat totéž ručně — tvar je běžný a nikam nás
    nezavazuje.
  */
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const supabase = klientUlohy()
  if (!supabase) {
    // Až za ověřením tajemství: kdo netrefí, se nedozví ani tohle.
    return NextResponse.json(
      { chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.rpc('ohlasit_zapomenute_odchody')

  if (error) {
    // Hláška z databáze jde do odpovědi, kterou čte plánovač, ne člověk.
    return NextResponse.json({ chyba: error.message }, { status: 500 })
  }

  return NextResponse.json({ ohlaseno: data ?? 0 })
}
