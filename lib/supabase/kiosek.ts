import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Připojení kiosku k Supabase — VŽDYCKY bez přihlášeného člověka.
 *
 * Kiosek se prokazuje klíčem zařízení, ne účtem (app/kiosek/page.tsx).
 * Běžný `getBrowserSupabase` ale čte přihlašovací cookie aplikace: když
 * se na tabletu někdo přihlásil (třeba majitel, aby vystavil registrační
 * kód), kiosek by volal databázi pod jeho účtem. A když tomu účtu mezitím
 * vypršel token (tablet ležel hodinu v pozadí), volání spadne na
 * „JWT expired" — a kiosek to dřív ukázal jako „Tablet není připojený"
 * s tlačítkem, které smaže registraci.
 *
 * Tenhle klient žádné sezení nečte ani neukládá: jen veřejný klíč,
 * a o všem rozhoduje klíč zařízení v databázi. Funkce kiosku jsou
 * povolené pro `anon` (kiosk_stav, kiosk_zalohy, pichnout_pinem,
 * potvrdit_zalohu_pinem, registrovat_zarizeni).
 */
let klient: SupabaseClient | null = null

export function getKioskSupabase(): SupabaseClient {
  if (klient) return klient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Chybí nastavení Supabase. Doplňte NEXT_PUBLIC_SUPABASE_URL ' +
        'a NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local.',
    )
  }

  klient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return klient
}
