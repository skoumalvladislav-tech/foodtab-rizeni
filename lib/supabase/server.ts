import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Připojení k Supabase na straně serveru.
 *
 * Používá se VEŘEJNÝ (anon) klíč — ne servisní. To je záměr: veřejný
 * klíč sám o sobě nic neotevírá, o datech rozhoduje přihlášení uživatele
 * a Row Level Security. Servisní klíč obchází RLS a do téhle cesty
 * nepatří nikdy. (Pravidlo č. 6)
 *
 * Přihlášení drží cookie, kterou Supabase průběžně obnovuje. Proto se
 * klient staví pro každý požadavek znovu a nedrží se v proměnné.
 */
export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Chybí nastavení Supabase. Doplňte NEXT_PUBLIC_SUPABASE_URL ' +
        'a NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local.',
    )
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component nesmí zapisovat cookie. Obnovu přihlášení
          // v takovém případě zařídí middleware při dalším požadavku —
          // tady je to očekávaný stav, ne chyba.
        }
      },
    },
  })
}
