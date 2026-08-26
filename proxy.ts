import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Obnova přihlašovací cookie při každém požadavku.
 *
 * Soubor se jmenuje proxy.ts, ne middleware.ts: Next 16 starý název
 * označil za zastaralý a vyžaduje vyvezenou funkci `proxy`.
 *
 * Přístupový token od Supabase má krátkou platnost. Obnovuje se
 * obnovovacím tokenem v cookie — a protože Server Component cookie
 * zapisovat nesmí, musí to udělat proxy, která běží dřív.
 * Bez něj by uživatele po vypršení tokenu vyhodilo z přihlášení.
 *
 * Proxy o přístupu NErozhoduje. Cookie umí kdokoli podvrhnout,
 * takže jediné, co tady děláme, je obnova sezení. Kdo kam smí, řeší
 * lib/authz.ts proti databázi a Row Level Security nad ní.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Bez nastavení nemá co obnovovat. Radši projít dál než shodit každý
  // požadavek — chybu ohlásí server.ts nebo client.ts se srozumitelnou
  // hláškou v místě, kde se Supabase opravdu volá.
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Tenhle dotaz je celý smysl proxy: ověří token u Supabase
  // a když je po platnosti, obnoví ho a novou cookie přibalí k odpovědi.
  await supabase.auth.getUser()

  return response
}

export const config = {
  // Statické soubory a obrázky sezení nepotřebují — obnovovat cookie
  // u každé ikony by znamenalo dotaz na Supabase navíc při každém
  // načtení stránky.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
