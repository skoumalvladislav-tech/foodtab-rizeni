'use server'

import { headers } from 'next/headers'

import { getUser } from '@/lib/authz'
import { getServerSupabase } from '@/lib/supabase/server'

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
 * Kam se člověk vrátí, se nikam nepředává. Po přihlášení správnou
 * adresou ho na rozcestí čeká „Máte čekající pozvánku“ (bod 7a)
 * a dokončí ji jedním kliknutím — druhá cesta zpátky by byla druhé
 * místo, kde se rozhoduje o přesměrování.
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

  // Odhlásit se musí dřív, než přijde odkaz — jinak by se člověk vrátil
  // pod původním účtem a byl by na tom stejně.
  await supabase.auth.signOut()

  const { error: chybaOdkazu } = await supabase.auth.signInWithOtp({
    email: info.kontakt,
    options: { emailRedirectTo: `${await zakladniAdresa()}/auth/callback` },
  })

  if (chybaOdkazu) return { chyba: chybaOdkazu.message }
  return { ok: true }
}

/** Adresa, na které aplikace běží. Bere se z hlaviček požadavku. */
async function zakladniAdresa(): Promise<string> {
  const nastavena = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (nastavena) return nastavena.replace(/\/+$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protokol =
    h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protokol}://${host}`
}
