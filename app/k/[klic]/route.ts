import { NextResponse } from 'next/server'

import { klicJePlatny } from '@/lib/marketing-odkazy'
import { klientUlohy } from '@/lib/supabase/uloha'

/**
 * Měřitelný odkaz: `/k/<klíč>` → přesměrování na cíl.
 *
 * Zadání: master prompt, oddíl 18 („Generuj UTM parametry a volitelný
 * QR kód pro objednávku, rezervaci nebo konkrétní akci").
 *
 * ---------------------------------------------------------------------
 * BEZ PŘIHLÁŠENÍ
 *
 * Tuhle adresu otevírá HOST z Instagramu nebo z plakátu. Nemá u nás
 * účet a mít ho nebude. Proto `security definer` funkce v databázi
 * (`public.marketing_prejit`) a proto se sem chodí servisním klíčem.
 *
 * ---------------------------------------------------------------------
 * CO SE Z ODPOVĚDI NESMÍ POZNAT
 *
 * Neznámý i vypnutý klíč dopadnou STEJNĚ — 404 a nic dalšího. Kdyby
 * se lišily, dalo by se zkoušením klíčů zjistit, co která restaurace
 * chystala a co zrušila.
 *
 * ---------------------------------------------------------------------
 * POČÍTÁ TO DATABÁZE, NE TAHLE ADRESA
 *
 * Proklik se připočítá uvnitř téže funkce, která vrací cíl. Kdyby se
 * počítalo tady zvlášť, rozešlo by se to pokaždé, když jedno z toho
 * selže — a číslo by se dalo nafouknout voláním, které nikam nevede.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ klic: string }> },
): Promise<NextResponse> {
  const { klic } = await params

  /*
    Tvar se ověřuje dřív, než se sáhne do databáze. Není to o
    bezpečnosti — dotaz je parametrizovaný —, ale o tom, že nesmyslné
    adresy nemají budit databázi.
  */
  if (!klicJePlatny(klic.toLowerCase())) {
    return new NextResponse(null, { status: 404 })
  }

  const supabase = klientUlohy()
  if (!supabase) {
    /*
      Chybějící servisní klíč je chyba nastavení. Hostovi se ale neříká
      nic — 404 jako u neznámého klíče. Rozdíl mezi „to neexistuje"
      a „tady něco nefunguje" je informace, kterou nepotřebuje.
    */
    return new NextResponse(null, { status: 404 })
  }

  const { data, error } = await supabase.rpc('marketing_prejit', { p_klic: klic.toLowerCase() })

  if (error || typeof data !== 'string' || data === '') {
    return new NextResponse(null, { status: 404 })
  }

  /*
    302, ne 301. Trvalé přesměrování si prohlížeč zapamatuje a příště
    na naši adresu vůbec nesáhne — takže by se přestaly počítat
    prokliky. A cíl se dá změnit, kdežto 301 v prohlížeči hosta ne.
  */
  return NextResponse.redirect(data, {
    status: 302,
    headers: {
      // Ať se to neukládá ani do mezipaměti proxy — ze stejného důvodu.
      'cache-control': 'no-store, max-age=0',
    },
  })
}
