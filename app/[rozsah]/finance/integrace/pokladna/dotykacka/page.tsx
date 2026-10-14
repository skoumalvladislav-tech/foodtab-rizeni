import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { podepsatText, sifrovaniJeNastavene } from '@/lib/integrace-klice'
import { zakladniAdresaAplikace } from '@/lib/integrace-adresa'
import { CONNECTOR_DOTYKACKA, parametryConnectoru } from '@/lib/pokladna-dotykacka'
import { klientDotykacky } from '@/lib/pokladna-pripojeni'
import Sdeleni from '@/app/sdeleni'
import OdeslatHned from './odeslat-hned'
import { jeRozsahFirmy } from '../../../jen-pro-firmu'

export const dynamic = 'force-dynamic'

/** Jak dlouho platí `state` — Dotykačka dává na přihlášení a výběr cloudu asi 15 minut. */
const PLATNOST_STAVU_S = 30 * 60

/**
 * Pole formuláře pro Connector v2 s razítkem TEĎ — každé vykreslení
 * stránky vyrobí nové (stará stránka z historie by měla prošlý podpis).
 */
function podepsanyFormular(v: { pripojeniId: string; rozsah: string; clientId: string; clientSecret: string; redirectUri: string }): Record<string, string> {
  const ted = Date.now()
  const obsah = Buffer.from(JSON.stringify({ p: v.pripojeniId, r: v.rozsah, e: Math.floor(ted / 1000) + PLATNOST_STAVU_S })).toString('base64url')
  return parametryConnectoru({
    clientId: v.clientId,
    clientSecret: v.clientSecret,
    redirectUri: v.redirectUri,
    state: `${obsah}.${podepsatText(obsah)}`,
    tedMs: ted,
  })
}

/**
 * Přihlášení přes Dotykačku (Connector v2, docs.api.dotypos.com/authorization).
 *
 * Connector není REST — je to stránka Dotykačky, na kterou PROHLÍŽEČ
 * odešle formulář (`client_id`, `timestamp`, `signature`, `scope`,
 * `redirect_uri`, `state`). Podpis = HMAC razítka klíčem `client_secret`;
 * secret sám nikdy neopustí server. Po přihlášení Dotykačka vrátí
 * prohlížeč na `/api/integrace/dotykacka/vratit` s tokenem a Cloud ID.
 *
 * `state` nese id rozjetého připojení a rozsah, podepsané klíčem
 * appky — návratová adresa podle něj pozná, že pokus vydala appka,
 * a ke kterému připojení patří.
 */
export default async function PrihlaseniDotykacka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ pripojeni?: string }>
}) {
  const { rozsah } = await params
  // Na pobočce kreslí obrazovku layout (JenProFirmu) — stránka nic
  // nenačítá ani nevrací, ani když ji Next vyrenderuje souběžně s ním.
  if (!jeRozsahFirmy(rozsah)) return null
  const { pripojeni: pripojeniId } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'integrace.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Pokladny připojuje ten, kdo má právo „Správa napojení na externí systémy“.</Sdeleni>
  }

  const klient = klientDotykacky()
  if (!klient || !sifrovaniJeNastavene()) {
    return <Sdeleni nadpis="Přihlášení přes Dotykačku není nastavené">Vložte token a Cloud ID ručně na stránce Pokladní systémy.</Sdeleni>
  }

  const supabase = await getServerSupabase()
  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id')
    .eq('id', pripojeniId ?? '')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .eq('poskytovatel', 'dotykacka')
    .eq('stav', 'pripojuje_se')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) {
    return <Sdeleni nadpis="Tenhle pokus o připojení už neplatí">Začněte znovu na stránce Pokladní systémy.</Sdeleni>
  }

  const pole = podepsanyFormular({
    pripojeniId: pripojeni.id as string,
    rozsah,
    clientId: klient.clientId,
    clientSecret: klient.clientSecret,
    redirectUri: `${await zakladniAdresaAplikace()}/api/integrace/dotykacka/vratit`,
  })

  return (
    <main style={{ padding: '32px 16px', maxWidth: '520px', margin: '0 auto', display: 'grid', gap: '14px' }}>
      <h1 style={{ margin: 0, fontSize: '20px' }}>Přesměrování do Dotykačky…</h1>
      <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
        Přihlaste se do Dotykačky a vyberte cloud. Appka se pak vrátí sama a ukáže provozovny k přiřazení.
      </p>
      <form id="dotykacka-connector" method="post" action={CONNECTOR_DOTYKACKA}>
        {Object.entries(pole).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button type="submit" className="ft-tl ft-tl-hlavni">Pokračovat do Dotykačky</button>
      </form>
      <Link href={`/${rozsah}/finance/integrace/pokladna`} className="ft-tl" style={{ justifySelf: 'start' }}>Zrušit</Link>
      <OdeslatHned formular="dotykacka-connector" zpet={`/${rozsah}/finance/integrace/pokladna`} />
    </main>
  )
}
