import { NextResponse, type NextRequest } from 'next/server'

/**
 * Návrat z banky po souhlasu u Salt Edge Connect Widgetu.
 *
 * NA ROZDÍL OD `enablebanking/vratit` appka tady NEZAPISUJE
 * `stav='pripojeno'` — parametry v téhle adrese (`connection_id`,
 * `shared`) appka od uživatele/banky NEMÁ jak ověřit (nejsou
 * podepsané), kdokoli by si mohl otevřít stejnou adresu s vymyšlenými
 * hodnotami. Jediný zdroj pravdy je PODEPSANÝ webhook
 * (`app/api/integrace/saltedge/webhook`), který dorazí nezávisle a
 * může appku předběhnout i zpozdit.
 *
 * Tahle adresa appce jen řekne, že se uživatel vrátil, a appka ho
 * pošle zpátky na stránku Integrace — ta sama (`revalidatePath`
 * po webhooku, nebo prosté opakované načtení) ukáže AKTUÁLNÍ stav
 * z databáze, ne z téhle adresy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rozsah = searchParams.get('rozsah') ?? ''
  const shared = searchParams.get('shared')

  const parametr = shared === 'false' ? 'chyba=Souhlas s bankou nebyl udělen.' : 'saltedge=zpracovava_se'
  return NextResponse.redirect(new URL(`/${rozsah}/finance/integrace/banka?${parametr}`, request.url))
}
