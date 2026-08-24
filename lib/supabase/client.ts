import { createBrowserClient } from '@supabase/ssr'

/**
 * Připojení k Supabase v prohlížeči.
 *
 * Používá stejný VEŘEJNÝ (anon) klíč jako server. O datech rozhoduje
 * přihlášení uživatele a Row Level Security, ne klíč sám. Servisní klíč
 * v prohlížeči nemá co dělat vůbec — obchází RLS a je vidět každému,
 * kdo si otevře zdroj stránky. (Pravidlo č. 6)
 *
 * Přihlášení drží cookie. createBrowserClient ji čte i zapisuje na
 * stejné místo, ze kterého ji čte server, takže se obě strany dívají
 * na totéž sezení.
 */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Chybí nastavení Supabase. Doplňte NEXT_PUBLIC_SUPABASE_URL ' +
        'a NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local.',
    )
  }

  return createBrowserClient(url, anonKey)
}
