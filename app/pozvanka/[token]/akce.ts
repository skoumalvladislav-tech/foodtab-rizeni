'use server'

import { getUser } from '@/lib/authz'
import { ohlasPrijetiPozvanky } from '@/lib/ohlas-prijeti'
import {
  adresaProPrvniKod,
  HLASKA_STROP,
  hlaskaProChybu,
  jeStrop,
  normalizujKod,
  ucetUzExistuje,
} from '@/lib/prihlaseni'
import { getServerSupabase } from '@/lib/supabase/server'
import { klientUlohy } from '@/lib/supabase/uloha'

/**
 * Přijetí pozvánky odkazem.
 *
 * ---------------------------------------------------------------------
 * HLÁŠKU Z DATABÁZE PROPOUŠTĚJ, NEPŘEPISUJ JI
 *
 * Tady stálo `if (error.code === '42501') return 'Token není platný'`.
 * Jenže `app.accept_invitation` vrací 42501 ve třech různých případech
 * a ke každému vlastní srozumitelnou větu:
 *
 *   „Nejdřív se přihlaste.“
 *   „Účet nemá profil.“
 *   „Pozvánka byla vystavena na jinou e-mailovou adresu.“
 *
 * Šéfík byl přihlášený pod gmailem a pozvánka šla na seznam. Kontrola
 * udělala přesně to, co má — a obrazovka za ni zalhala. Hledal by chybu
 * v tokenu, který byl v pořádku.
 *
 * Chybové kódy jsou na VĚTVENÍ, ne na text. Text už je napsaný, česky,
 * na jednom místě a blíž příčině.
 */

export type VysledekPrijeti = {
  ok?: boolean
  chyba?: string
  /** Pozvánka je na jinou adresu — obrazovka nabídne přepnutí účtu. */
  jinaAdresa?: boolean
}

export async function prijmoutPozvankuAction(
  token: string,
): Promise<VysledekPrijeti> {
  const user = await getUser()
  if (!user) return { chyba: 'Nejdřív se přihlaste.' }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('accept_invitation', {
    p_token: token,
  })

  if (error) {
    return {
      chyba: error.message || 'Pozvánku se nepodařilo přijmout.',
      // Kód se používá k tomu, k čemu je: rozhodnout, co nabídnout dál.
      // Text zůstává ten z databáze.
      jinaAdresa: error.message?.includes('vystavena na jin') === true,
    }
  }

  if (!data) return { chyba: 'Pozvánka nebyla přijata.' }

  /*
    E-mail tomu, kdo ve firmě spravuje lidi. Zvoneček píše spoušť
    v databázi a na tomhle nezávisí — kdyby se pošta rozbila,
    upozornění v aplikaci zůstane a přijetí platí dál.

    Proto se výsledek NEKONTROLUJE a nic se z něj nevrací: pozvánka je
    přijatá a to je to jediné, co má tenhle krok ovlivnit.
  */
  await ohlasPrijetiPozvanky(String(data))

  return { ok: true }
}

/**
 * Přihlásit se adresou, na kterou pozvánka přišla.
 *
 * Zadání bod 6. Vazba pozvánky na adresu se NEROZVOLŇUJE — je to
 * jediné, čím se ověří, že odkaz použil ten, komu byl poslaný. Řeší se
 * cesta, ne pravidlo.
 *
 * Adresa se bere v databázi podle tokenu, ne z prohlížeče: do prohlížeče
 * jde jen zkrácená podoba, aby se z cizí obrazovky nedala přečíst celá.
 *
 * Od 24. 9.: jen odhlásí. Stránka se obnoví jako pro nepřihlášeného
 * a nabídne kód na adresu z pozvánky (viz „První přihlášení" níž).
 */
export async function prihlasitSeAdresouZPozvanky(
  token: string,
): Promise<{ ok?: boolean; chyba?: string }> {
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('pozvanka_info', { p_token: token })
  if (error) return { chyba: error.message }

  const info = (data as { kanal: string; kontakt: string }[])?.[0]
  if (!info?.kontakt) return { chyba: 'Pozvánka neplatí.' }

  if (info.kanal !== 'email') {
    return {
      chyba: 'Tahle pozvánka přišla na telefon. Přihlaste se prosím tím číslem.',
    }
  }

  // Jen odhlásit. Stránka pozvánky se pak obnoví jako pro nepřihlášeného
  // a nabídne kód na adresu z pozvánky (poslatPrvniKod) — i když ta adresa
  // ještě účet nemá. Dřív šel magický odkaz, který by nový účet nezaložil.
  await supabase.auth.signOut()
  return { ok: true }
}

/* ======================================================================
   PRVNÍ PŘIHLÁŠENÍ Z POZVÁNKY (člověk, který ještě nemá účet)
   ======================================================================

   PROČ TO EXISTUJE. Od 6. 9. přihlašovací stránka účty NEZAKLÁDÁ
   (`shouldCreateUser: false` — do Foodtabu se vstupuje jen na pozvánku).
   Stránka pozvánky ale nepřihlášeného člověka posílala právě tam — takže
   nově pozvaný se neměl kudy dostat dovnitř: e-mail zadal, kód nepřišel.
   Od 5. 9. do 24. 9. nevznikl ani jeden nový účet (Juli Yaniv).

   Teď: stránka pozvánky pošle kód sama. Účet (je-li potřeba) založí
   SERVER, a jen pro adresu, na kterou pozvánka v databázi zní — nikdy pro
   adresu z prohlížeče. Nezávisí to na nastavení „Allow new users to sign
   up" v Supabase; přihlašovací stránka dál nikomu účet nezaloží.

   Kdo odkaz získá (přeposlaný e-mail), nedostane nic: kód jde na adresu
   z pozvánky a bez něj se nepřihlásí. Založený účet bez přihlášení je
   prázdný (žádné členství).
*/

export type StavPrvnihoKodu = {
  ok?: boolean
  chyba?: string
  /** Čas odeslání ze SERVERU — „Poslat znovu" se odpočítává od něj. */
  odeslanoKdy?: number
  /** Přihlášení proběhlo, jen přijetí pozvánky ne — stránka se obnoví. */
  prihlasen?: boolean
}

const NEPLATI = 'Tahle pozvánka už neplatí. Požádejte o novou toho, kdo firmu spravuje.'

async function adresaZPozvanky(token: string): Promise<string | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('pozvanka_info', { p_token: token })
  if (error) return null
  return adresaProPrvniKod((data as { kanal: string; kontakt: string; stav: string }[] | null)?.[0])
}

export async function poslatPrvniKod(token: string): Promise<StavPrvnihoKodu> {
  const adresa = await adresaZPozvanky(String(token ?? ''))
  if (!adresa) return { chyba: NEPLATI }

  // Účet pro adresu z pozvánky. Servisní klíč jen na serveru (pravidlo 6)
  // a jen pro tuhle jednu adresu z databáze.
  const sluzba = klientUlohy()
  if (!sluzba) {
    console.error('Pozvánka: chybí SUPABASE_SERVICE_ROLE_KEY — účet nejde založit.')
    return { chyba: 'Přihlášení z pozvánky teď nejde. Dejte prosím vědět tomu, kdo firmu spravuje.' }
  }
  const { error: chybaUctu } = await sluzba.auth.admin.createUser({ email: adresa, email_confirm: true })
  if (chybaUctu && !ucetUzExistuje(chybaUctu)) {
    console.error('Pozvánka: účet se nepodařilo založit:', chybaUctu.code ?? chybaUctu.status ?? 'neznámá chyba')
    return { chyba: 'Účet se nepodařilo připravit. Zkuste to prosím za chvíli znovu.' }
  }

  const supabase = await getServerSupabase()
  const { error: chybaKodu } = await supabase.auth.signInWithOtp({
    email: adresa,
    // Účet už je (výš) — kód se jen pošle, nic dalšího se nezakládá.
    options: { shouldCreateUser: false },
  })
  if (chybaKodu) {
    return { chyba: jeStrop(chybaKodu) ? HLASKA_STROP : 'Kód se nepodařilo poslat. Zkuste to prosím znovu.' }
  }
  return { ok: true, odeslanoKdy: Date.now() }
}

export async function overitPrvniKod(token: string, kodVstup: string): Promise<StavPrvnihoKodu> {
  const kod = normalizujKod(kodVstup)
  if (kod === '') return { chyba: 'Opište prosím kód z e-mailu.' }

  const adresa = await adresaZPozvanky(String(token ?? ''))
  if (!adresa) return { chyba: NEPLATI }

  // Sezení vzniká na serveru (cookie hlavičkou), stejně jako na přihlašovací
  // stránce — viz app/prihlaseni/akce.ts.
  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.verifyOtp({ email: adresa, token: kod, type: 'email' })
  if (error) return { chyba: hlaskaProChybu(error) }

  // Týmž klientem, který teď drží nové sezení, se pozvánka rovnou přijme.
  const { data, error: chybaPrijeti } = await supabase.rpc('accept_invitation', { p_token: token })
  if (chybaPrijeti || !data) {
    return {
      prihlasen: true,
      chyba: chybaPrijeti?.message || 'Přihlášení proběhlo, pozvánku se ale nepodařilo přijmout. Zkuste to prosím tlačítkem níž.',
    }
  }

  // Stejně jako prijmoutPozvankuAction: e-mail správci, výsledek se nehlídá.
  await ohlasPrijetiPozvanky(String(data))
  return { ok: true }
}
