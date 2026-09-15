import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Připojení k databázi Faktur — SAMOSTATNÝ Supabase projekt.
 *
 * Zadání: docs/hlaseni/zadani-pro-ai-marketing-faktury.md, „PROJEKT 2:
 * Faktury — sloučení s Foodtabem", možnost A (zachovat oddělené DB).
 * Modul žije uvnitř Foodtabu, ale data faktur zůstávají v projektu
 * `ctqtwahlzhyjerqulqyn` — jiná databáze, jiný anon klíč, žádné
 * sdílené přihlášení.
 *
 * ---------------------------------------------------------------------
 * KDO SEM SMÍ, ROZHODUJE FOODTAB — NE TAHLE DATABÁZE
 *
 * Faktura-DB dnes nemá vlastní přihlašování (RLS „allow all" pro anon
 * roli — otevřený bod č. 3 ze zadání, bezpečnostní model se řeší
 * samostatně a jen se souhlasem Šéfíka). Než se to změní, jedinou
 * obrannou linií je `app.has_access(tenant, 'faktury.read'/'faktury.manage')`
 * na foodtabovské straně — KAŽDÁ obrazovka a server akce pod
 * `app/[rozsah]/faktury/` si ji musí ověřit sama, přesně jako u
 * marketingu (CLAUDE.md, pravidlo 2 a 3). Tenhle klient sám o sobě
 * žádnou autorizaci neprovádí.
 *
 * ---------------------------------------------------------------------
 * VEŘEJNÝ KLÍČ, NE SERVISNÍ
 *
 * Stejné pravidlo jako u `getServerSupabase()` (pravidlo č. 6) — i když
 * má tahle databáze dnes otevřenou RLS, servisní klíč by ji obcházel
 * natvrdo a do aplikační vrstvy nepatří nikdy.
 */
export function getFakturySupabase() {
  const url = process.env.FAKTURY_SUPABASE_URL
  const anonKey = process.env.FAKTURY_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Chybí nastavení databáze faktur. Doplňte FAKTURY_SUPABASE_URL ' +
        'a FAKTURY_SUPABASE_ANON_KEY do .env.local.',
    )
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  })
}

/** `true`, jen když jsou obě proměnné prostředí vyplněné. */
export function fakturyJsouNastavene(): boolean {
  return Boolean(process.env.FAKTURY_SUPABASE_URL && process.env.FAKTURY_SUPABASE_ANON_KEY)
}
