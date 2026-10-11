import { NextResponse, type NextRequest } from 'next/server'

import { getServerSupabase } from '@/lib/supabase/server'
import { rozsifrovat, zasifrovat } from '@/lib/integrace-klice'
import { konfiguraceKb, platnostSouhlasu, nactiUcty, vymenitKod, ziskatAccessToken, type ExterniUcetKb, type TajemstviKb } from '@/lib/kb-adaa'
import { precistStavKb } from '@/lib/kb-adaa-stav'
import { synchronizovatKbPripojeni } from '@/lib/kb-adaa-sync'
import { ucetKbJinde } from '@/lib/kb-adaa-ucty'

/**
 * Návrat ze souhlasu u Komerční banky (`redirect_uri`): `?code=…&state=…`.
 * Kód platí 2 minuty — appka ho hned vymění za refresh token (12 měsíců)
 * a načte účty, které klient v KB vybral. Teprve pak souhlas uloží:
 *   * nové připojení: jediný účet se vybere sám, víc účtů = „Vyžaduje
 *     pozornost" a výběr na stránce Banka;
 *   * obnova souhlasu: nový souhlas MUSÍ zahrnovat dosud připojený účet.
 *     Jinak se neuloží nic (starý souhlas zůstane) — obnova nesmí tiše
 *     přepojit platební účet na jiný bankovní účet, třeba jiné firmy,
 *     ke které má přihlašující uživatel KB přístup.
 *
 * Stejné pojistky jako `../registrace`: podepsaný a neprošlý `state`,
 * připojení pod přihlášeným uživatelem (RLS), tajemství přes RPC, které
 * samo ověří `integrace.manage`.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const stav = precistStavKb(searchParams.get('state'))
  if (!stav || stav.f !== 'souhlas') return NextResponse.redirect(new URL('/', request.url))

  const cil = (parametry: Record<string, string>) =>
    NextResponse.redirect(new URL(`/${stav.r}/finance/integrace/banka?${new URLSearchParams(parametry)}`, request.url))

  const konf = konfiguraceKb()
  if (!konf) return cil({ chyba: 'Napojení na Komerční banku není na serveru nastavené.' })

  const supabase = await getServerSupabase()
  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, tenant_id, stav, externi_ucet')
    .eq('id', stav.p)
    .eq('oblast', 'banka')
    .eq('poskytovatel', 'kb_adaa')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) return cil({ chyba: 'Připojení neexistuje, nebo nepatří vašemu účtu.' })

  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetKb
  if (stav.k && ucet.pokus && stav.k !== ucet.pokus) {
    return cil({ chyba: 'Tohle byl návrat ze staršího pokusu o připojení Komerční banky — dokončete ten poslední, nebo začněte znovu.' })
  }
  const obnova = Boolean(ucet.account_id)
  // Nový pokus padá na „chyba"; nepovedená obnova u fungujícího připojení
  // nic nezapisuje (připojení dál běží na starém souhlasu), jinak jen hlásí.
  const nahlasit = async (duvod: string) => {
    if (pripojeni.stav === 'pripojuje_se') {
      await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: duvod }).eq('id', pripojeni.id)
    } else if (pripojeni.stav !== 'pripojeno') {
      await supabase.from('integrace_pripojeni').update({ posledni_chyba: duvod }).eq('id', pripojeni.id)
    }
    return cil({ chyba: duvod })
  }

  const kod = searchParams.get('code') ?? ''
  if (!kod) return nahlasit(`Komerční banka souhlas nevydala${searchParams.get('error') ? ` (${searchParams.get('error')})` : ''}.`)

  const { data: sifra } = await supabase.rpc('integrace_precti_tajemstvi', { p_pripojeni: pripojeni.id })
  let udaje: TajemstviKb = {}
  try {
    udaje = typeof sifra === 'string' ? (rozsifrovat(sifra) as TajemstviKb) : {}
  } catch {
    udaje = {}
  }
  if (!udaje.client_id || !udaje.client_secret || !ucet.navrat_uri) return nahlasit('Registrace u KB chybí — začněte připojení znovu.')

  const vymena = await vymenitKod(konf, { kod, clientId: udaje.client_id, clientSecret: udaje.client_secret, navratUri: ucet.navrat_uri })
  if (vymena.stav === 'chyba') return nahlasit(vymena.duvod)

  const znovu = obnova ? ' Starý souhlas zůstává, obnovu zkuste znovu.' : ''
  let accessToken = vymena.accessToken
  if (!accessToken) {
    const token = await ziskatAccessToken(konf, { clientId: udaje.client_id, clientSecret: udaje.client_secret, refreshToken: vymena.refreshToken, navratUri: ucet.navrat_uri })
    if (token.stav === 'chyba') return nahlasit(token.duvod + znovu)
    accessToken = token.accessToken
  }
  const seznam = await nactiUcty(konf, accessToken)
  if (seznam.stav === 'chyba') return nahlasit(seznam.duvod + znovu)
  if (seznam.ucty.length === 0) return nahlasit(`V Komerční bance jste nevybrali žádný účet — ${obnova ? 'obnovte souhlas znovu' : 'připojte znovu'} a účet vyberte.`)

  const ucty = seznam.ucty.map((u) => ({ account_id: u.accountId, iban: u.iban, mena: u.mena, nazev: u.nazev }))
  const dosavadni = obnova ? ucty.find((u) => u.account_id === ucet.account_id) ?? null : null
  if (obnova && !dosavadni) {
    return nahlasit(`Nový souhlas v Komerční bance nezahrnuje připojený účet${ucet.iban ? ` ${ucet.iban}` : ''} — při obnově ho v KB vyberte. Starý souhlas zůstává.`)
  }
  const jediny = !obnova && ucty.length === 1 ? ucty[0] : null
  const obsazeny = jediny ? await ucetKbJinde(supabase, pripojeni.tenant_id as string, pripojeni.id as string, jediny) : null
  const vybrany = dosavadni ?? (obsazeny ? null : jediny)
  const souhlasDo = platnostSouhlasu(vymena.refreshToken)

  // Souhlas se ukládá až teď — po ověření účtu (viz hlavička).
  const nove: TajemstviKb = { client_id: udaje.client_id, client_secret: udaje.client_secret, refresh_token: vymena.refreshToken }
  const { sifra: novaSifra, otisk } = zasifrovat(nove)
  const { error: chybaUlozeni } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeni.id, p_sifra: novaSifra, p_otisk: otisk })
  if (chybaUlozeni) return nahlasit('Souhlas se nepodařilo uložit — zkuste to znovu.')

  const novyUcet: ExterniUcetKb = {
    ...ucet,
    client_id: udaje.client_id,
    ucty,
    souhlas_do: souhlasDo,
    ...(vybrany ? { account_id: vybrany.account_id, iban: vybrany.iban, mena: vybrany.mena, nazev_uctu: vybrany.nazev } : { account_id: undefined }),
    // Postup stahování patří k účtu — u obnovy (tentýž účet) zůstává, nové připojení začíná od `historie_od`.
    stazeno_do: dosavadni ? ucet.stazeno_do : undefined,
  }
  const ted = new Date().toISOString()
  await supabase.from('integrace_pripojeni').update({
    stav: vybrany ? 'pripojeno' : 'vyzaduje_pozornost',
    externi_ucet: novyUcet,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    posledni_chyba: vybrany ? null : obsazeny ?? 'Vyberte, který účet z Komerční banky patří k platebnímu účtu.',
  }).eq('id', pripojeni.id)

  if (obsazeny) return cil({ chyba: `${obsazeny} Obnovte souhlas a v KB vyberte účet, který patří k tomuto platebnímu účtu.` })
  if (!vybrany) return cil({ kb: `Komerční banka je připojená (${ucty.length} účtů). Vyberte, který účet appka má sledovat.` })

  const prvni = await synchronizovatKbPripojeni(pripojeni.id as string)
  return cil(prvni.stav === 'ok'
    ? { kb: `Komerční banka je připojená, souhlas platí do ${souhlasDo}. Staženo ${prvni.pocetNovychRadku} nových pohybů.` }
    : { kb: `Komerční banka je připojená, souhlas platí do ${souhlasDo}.`, chyba: `První stažení se nepovedlo: ${prvni.duvod}` })
}
