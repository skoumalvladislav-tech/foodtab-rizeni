import { NextResponse, type NextRequest } from 'next/server'

import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Návrat z přihlašovacího odkazu.
 *
 * Odkaz z e-mailu skončí tady s jednorázovým kódem. Ten se vymění za
 * sezení, které se uloží do cookie — od té chvíle je uživatel přihlášený
 * a o zbytek se stará middleware.
 *
 * Kam pak člověk patří, tady neřešíme. Přesměrujeme na „/“ a rozhodnutí
 * nechá na sobě domovská stránka, která se ptá lib/authz.ts. Jinak by
 * pravidlo, do jaké firmy uživatel patří, žilo na dvou místech.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  // Supabase umí vrátit i rovnou chybu, typicky když odkaz vypršel
  // nebo už byl použitý.
  if (searchParams.get('error')) {
    return NextResponse.redirect(new URL('/prihlaseni?chyba=odkaz', request.url))
  }

  if (code) {
    const supabase = await getServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      /*
        Kdo přišel z naskenovaného QR, dostane vlastní obrazovku s tím,
        že má naskenovat znovu — kód, se kterým začínal, mezitím vypršel
        (docs/qr-na-kiosku-zadani.md, oddíl 4).

        Rozhoduje se podle vlastního parametru, ne podle cíle
        z prohlížeče: cíl přesměrování se z adresy nikdy nepřebírá, to
        by otevřelo přesměrování kamkoli.
      */
      const cil = searchParams.get('qr') === '1' ? '/prihlaseno-z-qr' : '/'

      // Adresa se staví z požadavku, ne z hlavičky x-forwarded-host.
      // Tu umí podvrhnout kdokoli a otevřelo by to přesměrování jinam.
      return NextResponse.redirect(new URL(cil, request.url))
    }
  }

  return NextResponse.redirect(new URL('/prihlaseni?chyba=odkaz', request.url))
}
