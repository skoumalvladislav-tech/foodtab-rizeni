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
let klientBezLimitu: SupabaseClient | null = null

/**
 * `bezLimitu` jen pro REGISTRACI: jednorázový kód se na serveru
 * spotřebuje, i když klient dotaz přeruší — tablet by pak klíč nedostal
 * a kód už by nešel použít znovu. Ostatní volání kiosku jsou bezpečná
 * zopakovat (píchnutí stejného druhu do 2 minut vrátí původní záznam,
 * druhé potvrzení zálohy nic nemění), ta časový limit mají.
 */
export function getKioskSupabase(moznosti: { bezLimitu?: boolean } = {}): SupabaseClient {
  if (moznosti.bezLimitu && klientBezLimitu) return klientBezLimitu
  if (!moznosti.bezLimitu && klient) return klient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Chybí nastavení Supabase. Doplňte NEXT_PUBLIC_SUPABASE_URL ' +
        'a NEXT_PUBLIC_SUPABASE_ANON_KEY do .env.local.',
    )
  }

  if (moznosti.bezLimitu) {
    klientBezLimitu = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return klientBezLimitu
  }

  klient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    /*
      Časový limit dotazu. Fetch v prohlížeči sám žádný nemá a rpc je
      POST, který postgrest-js neopakuje: po probuzení tabletu může
      dotaz viset na mrtvém spojení minuty a kiosek by celou dobu ukazoval
      propadlý kód bez varování. Po 10 s se dotaz přeruší, vrátí se jako
      chyba a kiosek to vezme jako výpadek (lib/kiosek-spojeni.ts).
    */
    db: { timeout: 10_000 },
  })
  return klient
}
