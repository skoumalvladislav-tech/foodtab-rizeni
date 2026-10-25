import { after, NextResponse, type NextRequest } from 'next/server'

import { hasAccess } from '@/lib/authz'
import { podpisSedi, sifrovaniJeNastavene, zasifrovat } from '@/lib/integrace-klice'
import { KLIC_CHOICE, nastaveniChoice, otiskPokusu, overitPokus, rozebratPokus, vytvoritChoice } from '@/lib/rezervace-choice'
import { jinePripojeniTehozPodniku, otestovatToken, synchronizovatChoice, zapsatVysledekTestu } from '@/lib/rezervace-choice-sync'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Návrat z Choice po povolení aplikace Foodtab:
 * `?code=…&customAttribute=<pokus>` (adresu má aplikace v Choice
 * zapsanou jako „Authorization callback URL“).
 *
 * Adrese appka sama NEVĚŘÍ:
 *   1. pokus (customAttribute) musí mít přesný tvar a podpis appky, který
 *      sedí jen s firmou a pobočkou připojení A S PŘIHLÁŠENÝM UŽIVATELEM,
 *      a nesmí být prošlý (10 minut);
 *   2. přihlášený musí mít `integrace.manage` na pobočce připojení —
 *      ZNOVU, ne podle toho, co měl při vydání odkazu;
 *   3. pokus se spotřebuje podmíněným zápisem (připojení „připojuje se“
 *      s otiskem téhož jednorázového čísla) — druhý návrat s týmž
 *      odkazem nenajde nic;
 *   4. kód se vymění za token, token se uloží JEN ZAŠIFROVANÝ (RPC sama
 *      ověří `integrace.manage`) a „připojeno“ je až po živém testu
 *      (`zapsatVysledekTestu`).
 * Pak přesměrování na čistou adresu: kód, token ani text chyby v adrese
 * nezůstanou (jen kód hlášky; důvod je u napojení).
 *
 * První načtení rezervací běží AŽ PO odpovědi (`after`) — strop 60 s platí
 * pro požadavek i práci v after() dohromady, proto se počítá od začátku.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const zacatek = Date.now()
  const adresa = new URL(request.url)
  const pokus = rozebratPokus(adresa.searchParams.get('customAttribute') ?? adresa.searchParams.get('state'))
  // Bez platného tvaru nevíme ani, kam vrátit — na úvod, nic se nezpracuje.
  if (!pokus) return NextResponse.redirect(new URL('/', request.url))

  // Rozsah z pokusu má jen [a-z0-9-] (rozebratPokus) — cesta zůstane na téhle doméně.
  const zpet = (parametr: 'stav' | 'chyba', kod: string) =>
    NextResponse.redirect(new URL(`/${pokus.rozsah}/rezervace/napojeni?${parametr}=${kod}`, request.url))

  const nastaveni = nastaveniChoice(process.env)
  if (!nastaveni || !sifrovaniJeNastavene()) return zpet('chyba', 'choice-nenastaveno')

  const supabase = await getServerSupabase()
  const { data: prihlaseni } = await supabase.auth.getUser()
  if (!prihlaseni.user) return zpet('chyba', 'choice-prihlaseni')

  // Připojení pod přihlášeným (RLS) — cizí firmu ani pobočku bez práva nenajde.
  const { data: radek } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, branch_id, stav, externi_ucet')
    .eq('id', pokus.pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!radek || !radek.branch_id) return zpet('chyba', 'choice-pokus')
  const tenantId = String(radek.tenant_id)
  const branchId = String(radek.branch_id)

  const platnost = overitPokus(pokus, { tenantId, branchId, userId: prihlaseni.user.id }, podpisSedi, Date.now())
  if (platnost !== 'ok') return zpet('chyba', platnost === 'propadly' ? 'choice-propadly' : 'choice-pokus')

  if (!(await hasAccess(tenantId, 'integrace.manage', branchId))) return zpet('chyba', 'pravo')

  // Jednorázově: jen připojení, které na TENHLE pokus čeká. Otisk pokusu
  // zapisuje jen „Připojit podnik v Choice“ (spolu se stavem „připojuje
  // se“) a tenhle zápis ho maže — podmínka na otisk je jediná, která
  // tu drží, proto se nepíše „pro jistotu“ ještě podmínka na stav.
  const zadana = (radek.externi_ucet as Record<string, unknown> | null)?.domena_zadana
  const { data: spotrebovano } = await supabase
    .from('integrace_pripojeni')
    .update({ stav: 'nepripojeno', posledni_chyba: null, externi_ucet: { domena_zadana: typeof zadana === 'string' ? zadana : null } })
    .eq('id', String(radek.id))
    .eq('externi_ucet->>pokus', otiskPokusu(pokus.nonce))
    .is('odpojeno_kdy', null)
    .select('id')
  if (!spotrebovano || spotrebovano.length !== 1) return zpet('chyba', 'choice-pokus')
  const pripojeniId = String(radek.id)

  const selhalo = async (duvod: string, kod: string) => {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_test_ok: false, posledni_chyba: duvod }).eq('id', pripojeniId)
    return zpet('chyba', kod)
  }

  if (adresa.searchParams.get('error')) return selhalo('V Choice se připojení nepovolilo.', 'choice-zamitnuto')
  const code = (adresa.searchParams.get('code') ?? '').trim()
  if (!code || code.length > 2000) return selhalo('Choice nevrátil kód pro připojení.', 'choice-kod')

  const vymena = await vytvoritChoice((url, init) => fetch(url, init)).vymenitKod({ code, clientId: nastaveni.clientId, secret: nastaveni.secret })
  if (vymena.stav === 'chyba') return selhalo(vymena.duvod, 'choice-kod')

  // Tentýž podnik u jiné pobočky téže firmy by zapisoval rezervace dvakrát.
  if (await jinePripojeniTehozPodniku(tenantId, pripojeniId, vymena.varSymbol)) {
    return selhalo('Tenhle podnik Choice je už připojený u jiné pobočky — tam ho nejdřív odpojte.', 'choice-jinde')
  }

  const { sifra, otisk } = zasifrovat({ token: vymena.token })
  const { error: chybaTokenu } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeniId, p_sifra: sifra, p_otisk: otisk })
  if (chybaTokenu) return selhalo('Token od Choice se nepodařilo uložit.', 'nepovedlo')

  await supabase
    .from('integrace_pripojeni')
    .update({
      nazev: vymena.domena ? `Choice — ${vymena.domena}` : 'Choice',
      externi_ucet: { domena: vymena.domena, var_symbol: vymena.varSymbol },
    })
    .eq('id', pripojeniId)

  const test = await otestovatToken(vymena.token, zacatek + 57_000)
  await zapsatVysledekTestu(supabase, pripojeniId, test)
  if (test.stav !== 'ok') return zpet('chyba', test.druh === 'pristup' || test.druh === 'data' ? 'choice-test' : 'choice-test-pozdeji')

  after(async () => {
    await synchronizovatChoice(pripojeniId, { konecMs: zacatek + 57_000 })
  })
  return zpet('stav', 'choice-pripojeno')
}
