import { NextResponse } from 'next/server'

import { KBELIK_JINYCH_PLATEB } from '@/lib/jine-platby-typy'
import { klientUlohy, tajemstviSedi, uvolnitUlohu, uzBezi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: úklid nepřipojených souborů z kiosku Jiných plateb.
 *
 * Telefon na doklady nahrává fotky přes podepsané adresy a server je pak
 * připojí k záznamu. Když telefon vypadne dřív, než dojde na připojení,
 * soubor zůstane v kbelíku bez vlastníka a nic na něj neukazuje —
 * přihlášený ho smazat nemůže (politika chce vlastníka) a sám nezmizí.
 *
 * KTERÉ SOUBORY rozhoduje DATABÁZE (`public.jine_platby_kiosek_sirotci`,
 * migrace 20261024100000): bez vlastníka, pod záznamem z kiosku, starší
 * než 3 hodiny (připojit se dá jen do 2 hodin od založení) a bez řádku
 * v `jine_platby_soubory`. Tahle adresa jen ověří, kdo volá, vezme cesty
 * a smaže je přes Storage API. Žádnou cestu si nevymýšlí.
 *
 * Plánuje GitHub Actions (`.github/workflows/kiosek-uklid.yml`, denně)
 * a jde spustit i ručně (Run workflow). Na pg_cron nic nestojí; až ho
 * Šéfík zapne, plán je stejný (`app.planovac_ulohy`) a zámek proti
 * dvojímu spuštění drží `uzBezi`.
 *
 * Bez tajemství 401 a nic dalšího (viz zapomenuty-odchod).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Kolik souborů nejvýš za jeden běh (Storage `remove` bere celou dávku najednou). */
const NEJVIC_SOUBORU = 500

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const bezi = await uzBezi('kiosek-uklid')
  if (bezi) return bezi

  const supabase = klientUlohy()
  if (!supabase) {
    return NextResponse.json(
      { chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.rpc('jine_platby_kiosek_sirotci', { p_limit: NEJVIC_SOUBORU })
  if (error) {
    console.error('[kiosek-uklid] výběr sirotků selhal:', error.code, error.message)
    return NextResponse.json({ chyba: 'Výběr nepřipojených souborů selhal.' }, { status: 500 })
  }

  // Jen řetězce, jak je vrátila databáze — nic jiného se nemaže.
  const cesty = (Array.isArray(data) ? data : []).filter((c): c is string => typeof c === 'string' && c.length > 0)
  if (cesty.length === 0) {
    await uvolnitUlohu('kiosek-uklid')
    return NextResponse.json({ smazano: 0, pokracovat: false })
  }

  const { error: chybaMazani } = await supabase.storage.from(KBELIK_JINYCH_PLATEB).remove(cesty)
  if (chybaMazani) {
    console.error('[kiosek-uklid] mazání v úložišti selhalo:', chybaMazani.message)
    return NextResponse.json({ chyba: 'Mazání v úložišti selhalo.' }, { status: 500 })
  }

  // Workflow volá ve smyčce, dokud je co mazat — další kolo nesmí narazit na vlastní zámek.
  await uvolnitUlohu('kiosek-uklid')
  return NextResponse.json({ smazano: cesty.length, pokracovat: cesty.length === NEJVIC_SOUBORU })
}
