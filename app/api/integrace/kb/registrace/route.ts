import { NextResponse, type NextRequest } from 'next/server'

import { getServerSupabase } from '@/lib/supabase/server'
import { rozsifrovat, zasifrovat } from '@/lib/integrace-klice'
import { adresaAutorizace, konfiguraceKb, rozsifrovatRegistraci, type ExterniUcetKb, type RegistraceKlienta, type TajemstviKb } from '@/lib/kb-adaa'
import { precistStavKb, vytvoritStavKb, type StavKb } from '@/lib/kb-adaa-stav'

/**
 * Návrat z registrace aplikace u Komerční banky (`registrationBackUri`
 * ze software statementu): `?salt=…&encryptedData=…[&state=…]`.
 *
 * Kde KB vrací `state`, dokumentace neříká jednoznačně: text slibuje
 * parametr v adrese, ukázka ho má UVNITŘ rozšifrovaného JSON. Appka
 * proto umí obojí:
 *   1. `state` v adrese → připojení podle něj, rozšifrovat jeho klíčem;
 *   2. bez něj → zkusit klíče nezaregistrovaných pokusů, které
 *      přihlášený smí spravovat (nejvýš 10 nejnovějších podle
 *      `pokus_kdy`). Klíč je náhodný pro každý pokus, takže úspěšné
 *      rozšifrování (AES-GCM s ověřovací značkou) samo dokazuje, ke
 *      kterému pokusu odpověď patří — ukázky KB `state` někdy nevrací
 *      vůbec. Když ho šifra nese, musí sedět na totéž připojení a pokus.
 * Výsledek (`client_id`, `client_secret`) appka zašifruje a pošle
 * prohlížeč pro souhlas s přístupem k účtu (autorizační kód).
 *
 * `state` nese i id pokusu (`externi_ucet.pokus`). Návrat ze staršího
 * pokusu (druhá záložka, dvojklik) jen ohlásí, nic nemění — jinak by
 * jeho nerozšifrovatelná data shodila na „chyba" ten platný. Zopakovaný
 * návrat po úspěšné registraci (tlačítko Zpět) pošle znovu na souhlas.
 */

export const dynamic = 'force-dynamic'

const MAX_KANDIDATU = 10

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

async function klicSifrovani(supabase: Supabase, pripojeniId: string): Promise<string | null> {
  const { data: sifra } = await supabase.rpc('integrace_precti_tajemstvi', { p_pripojeni: pripojeniId })
  try {
    return typeof sifra === 'string' ? ((rozsifrovat(sifra) as TajemstviKb).klic_sifrovani ?? null) : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const salt = searchParams.get('salt') ?? ''
  const encryptedData = searchParams.get('encryptedData') ?? ''
  const supabase = await getServerSupabase()

  type Radek = { id: string; stav: string; externi_ucet: unknown }
  const pokusSedi = (s: StavKb, radek: Radek) => {
    const pokus = (radek.externi_ucet as ExterniUcetKb | null)?.pokus
    return !s.k || !pokus || s.k === pokus
  }

  const nalezt = async (): Promise<{ stav: StavKb; pripojeni: Radek; registrace: RegistraceKlienta | null } | null> => {
    const zAdresy = precistStavKb(searchParams.get('state'))
    if (zAdresy) {
      if (zAdresy.f !== 'registrace') return null
      const { data } = await supabase
        .from('integrace_pripojeni')
        .select('id, stav, externi_ucet')
        .eq('id', zAdresy.p)
        .eq('oblast', 'banka')
        .eq('poskytovatel', 'kb_adaa')
        .is('odpojeno_kdy', null)
        .maybeSingle()
      if (!data) return null
      const radek = data as Radek
      // Klíč patří jen poslednímu pokusu — u staršího ho nezkoušet (nic se nezmění, viz níž).
      const klic = salt && encryptedData && radek.stav === 'pripojuje_se' && pokusSedi(zAdresy, radek) ? await klicSifrovani(supabase, radek.id) : null
      return { stav: zAdresy, pripojeni: radek, registrace: klic ? rozsifrovatRegistraci(encryptedData, salt, klic) : null }
    }

    if (!salt || !encryptedData) return null
    const { data: kandidati } = await supabase
      .from('integrace_pripojeni')
      .select('id, stav, externi_ucet')
      .eq('oblast', 'banka')
      .eq('poskytovatel', 'kb_adaa')
      .eq('stav', 'pripojuje_se')
      .is('odpojeno_kdy', null)
      .order('vytvoreno_kdy', { ascending: false })
      .limit(50)
    // Jen pokusy, kde registrace ještě neproběhla (opuštěné zaregistrované
    // klíč nemají), nejnovější napřed. Do limitu se počítají jen ty, jejichž
    // klíč přihlášený smí číst (cizí firma nebo jen právo číst místo nezabere).
    const pokusKdy = (k: Radek) => (k.externi_ucet as ExterniUcetKb | null)?.pokus_kdy ?? ''
    const nezaregistrovane = ((kandidati ?? []) as Radek[])
      .filter((k) => !(k.externi_ucet as ExterniUcetKb | null)?.client_id)
      .sort((a, b) => pokusKdy(b).localeCompare(pokusKdy(a)))
    let zkouseno = 0
    for (const k of nezaregistrovane) {
      if (zkouseno >= MAX_KANDIDATU) break
      const klic = await klicSifrovani(supabase, k.id)
      if (!klic) continue
      zkouseno++
      const registrace = rozsifrovatRegistraci(encryptedData, salt, klic)
      if (!registrace) continue
      const ucetK = (k.externi_ucet ?? {}) as ExterniUcetKb
      const zeSifry = precistStavKb(registrace.state)
      if (zeSifry && (zeSifry.f !== 'registrace' || zeSifry.p !== k.id || !pokusSedi(zeSifry, k))) continue
      return { stav: zeSifry ?? { p: k.id, r: ucetK.rozsah ?? '', f: 'registrace', e: 0, k: ucetK.pokus }, pripojeni: k, registrace }
    }
    return null
  }

  const nalez = await nalezt()
  if (!nalez) return NextResponse.redirect(new URL('/', request.url))
  const { stav, pripojeni, registrace } = nalez
  const ucet = (pripojeni.externi_ucet ?? {}) as ExterniUcetKb

  const rozsah = stav.r || ucet.rozsah || ''
  const cil = (parametry: Record<string, string>) =>
    NextResponse.redirect(new URL(rozsah ? `/${rozsah}/finance/integrace/banka?${new URLSearchParams(parametry)}` : '/', request.url))
  const oznacitChybu = async (duvod: string) => {
    await supabase.from('integrace_pripojeni').update({ stav: 'chyba', posledni_chyba: duvod }).eq('id', pripojeni.id)
    return cil({ chyba: duvod })
  }

  const konf = konfiguraceKb()
  if (!konf) return cil({ chyba: 'Napojení na Komerční banku není na serveru nastavené.' })
  if (!pokusSedi(stav, pripojeni)) {
    return cil({ chyba: 'Tohle byl návrat ze staršího pokusu o připojení Komerční banky — dokončete ten poslední, nebo začněte znovu.' })
  }
  if (pripojeni.stav !== 'pripojuje_se') return cil({ chyba: 'Tohle připojení ke Komerční bance už na registraci nečeká.' })
  if (ucet.client_id) {
    // Registrace tohoto pokusu už proběhla (návrat zopakovaný tlačítkem Zpět) — jen znovu na souhlas.
    const navratUri = ucet.navrat_uri ?? `${new URL(request.url).origin}/api/integrace/kb/vratit`
    return NextResponse.redirect(adresaAutorizace(konf, { clientId: ucet.client_id, navratUri, state: vytvoritStavKb(pripojeni.id, rozsah, 'souhlas', ucet.pokus) }))
  }
  if (!salt || !encryptedData) return oznacitChybu('Komerční banka registraci nedokončila (přihlášení zrušeno?).')
  if (!registrace) return oznacitChybu('Odpověď Komerční banky se nepodařilo rozšifrovat — začněte připojení znovu.')
  // `state` uvnitř šifry (když ho KB vrací tam) musí patřit témuž připojení.
  const zeSifry = precistStavKb(registrace.state)
  if (zeSifry && zeSifry.p !== pripojeni.id) return cil({ chyba: 'Odpověď Komerční banky patří jinému připojení — začněte připojení znovu.' })

  const nove: TajemstviKb = { client_id: registrace.clientId, client_secret: registrace.clientSecret }
  const { sifra, otisk } = zasifrovat(nove)
  const { error } = await supabase.rpc('integrace_uloz_tajemstvi', { p_pripojeni: pripojeni.id, p_sifra: sifra, p_otisk: otisk })
  if (error) return oznacitChybu('Registraci u KB se nepodařilo uložit — začněte připojení znovu.')

  const navratUri = ucet.navrat_uri ?? `${new URL(request.url).origin}/api/integrace/kb/vratit`
  await supabase.from('integrace_pripojeni').update({ externi_ucet: { ...ucet, client_id: registrace.clientId, navrat_uri: navratUri } satisfies ExterniUcetKb }).eq('id', pripojeni.id)

  return NextResponse.redirect(adresaAutorizace(konf, { clientId: registrace.clientId, navratUri, state: vytvoritStavKb(pripojeni.id, rozsah, 'souhlas', ucet.pokus) }))
}
