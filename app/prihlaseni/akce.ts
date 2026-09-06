'use server'

import { redirect } from 'next/navigation'

import { getServerSupabase } from '@/lib/supabase/server'

import {
  bezpecnyCil,
  hlaskaProChybu,
  normalizujKod,
  HLASKA_STROP,
  jeStrop,
} from '@/lib/prihlaseni'

import { PRAZDNY_STAV, type StavPrihlaseni } from './stav'

/**
 * Přihlášení KÓDEM.
 *
 * ---------------------------------------------------------------------
 * PROČ KÓD A NE ODKAZ
 *
 * Odkaz z e-mailu nese `token=pkce_…` a dokončit ho jde JEN v tom
 * prohlížeči, který si o něj řekl — při odeslání se do jeho úložiště
 * uloží tajný protikus. Gmail a Seznam ale otevírají odkazy ve svém
 * vlastním prohlížeči, takže se protikus nenajde a přihlášení spadne.
 * Šéfíkovi takhle dorazily tři e-maily a nepřihlásil se ani jednou.
 *
 * Kód tuhle vazbu nemá: opíše se do toho okna, kde o něj člověk
 * požádal.
 *
 * ---------------------------------------------------------------------
 * PROČ TO BĚŽÍ NA SERVERU, A NE V PROHLÍŽEČI
 *
 * Tohle NENÍ jen přesun kódu. Dřív se `signInWithOtp` volalo
 * z `getBrowserSupabase()` přímo ve formuláři — a browser klient si
 * sezení ukládá do `document.cookie`, tedy JAVASCRIPTEM. Safari
 * takové cookie zkracuje na sedm dní, takže by lidem přihlášení
 * po týdnu mizelo a nikdo by nepoznal proč.
 *
 * Serverový klient zapisuje cookie hlavičkou `Set-Cookie` a na tu se
 * to omezení nevztahuje. Tím, že tady zmizel browser klient, zmizela
 * i jediná cesta, kterou se přihlašovací cookie na téhle obrazovce
 * mohla přepsat javascriptem.
 *
 * ---------------------------------------------------------------------
 * CO SE NESMÍ PROZRADIT
 *
 * Neznámý e-mail dostane STEJNOU odpověď jako známý. Jinak by se
 * zkoušením adres dalo zjistit, kdo ve firmě pracuje — a u restaurace
 * to není nevinný údaj.
 */

/**
 * Jedna akce pro celý formulář.
 *
 * Přepínač `akce` říká, co se má stát. Jedna akce proto, aby se stav
 * formuláře držel na jednom místě — se dvěma by se musel předávat mezi
 * nimi a rozpadl by se při první chybě.
 */
export async function prihlasit(
  _predchozi: StavPrihlaseni,
  formData: FormData,
): Promise<StavPrihlaseni> {
  const akce = String(formData.get('akce') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const kam = bezpecnyCil(String(formData.get('kam') ?? '/'))

  // Zpátky na zadání adresy. Nevolá se nic — jen se překreslí, takže
  // se stránka nenačítá znovu a člověk nepřijde o rozepsané.
  if (akce === 'zmenit') {
    return { ...PRAZDNY_STAV, email }
  }

  if (email === '') {
    return { ...PRAZDNY_STAV, chyba: 'Zadejte prosím e-mail.' }
  }

  const supabase = await getServerSupabase()

  if (akce === 'poslat') {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        /*
          DO FOODTABU SE VSTUPUJE JEN NA POZVÁNKU (rozhodnutí v CLAUDE.md).
          Bez tohohle by přihlášení neznámé adresy rovnou ZALOŽILO účet —
          kdokoli s e-mailem by si udělal vstup do aplikace.

          Supabase na to odpovídá chybou, která existenci účtu prozradí.
          Proto se dál nerozlišuje: neznámá adresa dostane touž větu jako
          známá, jen jí nic nepřijde.
        */
        shouldCreateUser: false,
      },
    })

    if (error && jeStrop(error)) {
      return { krok: 'email', email, chyba: HLASKA_STROP, odeslanoKdy: 0 }
    }

    /*
      Ostatní chyby se ZAMLČUJÍ SCHVÁLNĚ — patří sem i „takový účet
      neexistuje". Kdyby se ukázaly, dá se zkoušením adres zjistit, kdo
      ve firmě pracuje.

      Je to nepříjemné při hledání chyb, ale ta druhá strana je horší.
      Že se e-mail neodeslal, se pozná z toho, že nepřijde — a k tomu
      je „Poslat znovu".
    */
    return {
      krok: 'kod',
      email,
      chyba: '',
      odeslanoKdy: Date.now(),
    }
  }

  if (akce === 'overit') {
    /*
      Z e-mailu se veze i to, co je kolem kódu — mezery, nezlomitelné
      mezery, znaky nulové šířky ze sazby. Uklízí se to AŽ TADY.

      V prohlížeči se nefiltruje schválně: filtr při psaní je
      nejčastější důvod, proč se vložení celého kódu naráz rozbije.
    */
    const kod = normalizujKod(String(formData.get('kod') ?? ''))

    if (kod === '') {
      return {
        krok: 'kod',
        email,
        chyba: 'Opište prosím kód z e-mailu.',
        odeslanoKdy: Number(formData.get('odeslanoKdy') ?? 0),
      }
    }

    /*
      TADY VZNIKÁ SEZENÍ, A VZNIKÁ NA SERVERU.

      `verifyOtp` na serverovém klientu zapíše cookie přes adaptér
      v lib/supabase/server.ts, tedy hlavičkou Set-Cookie. To je celý
      rozdíl proti dřívějšku a je to důvod, proč tahle funkce není
      v prohlížeči.
    */
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: kod,
      type: 'email',
    })

    if (error) {
      return {
        krok: 'kod',
        email,
        chyba: hlaskaProChybu(error),
        odeslanoKdy: Number(formData.get('odeslanoKdy') ?? 0),
      }
    }

    // Ven z akce, ne návratem stavu: po přihlášení se má člověk vrátit
    // tam, odkud šel, ne na rozcestník.
    redirect(kam)
  }

  return { ...PRAZDNY_STAV, email }
}

/**
 * Odhlásit se.
 *
 * `signOut()` na serverovém klientu smaže přihlašovací cookie touž
 * cestou, jakou ji zapsal — hlavičkou. Kdyby se odhlašovalo
 * v prohlížeči, zůstala by serverová cookie ležet a člověk by byl po
 * načtení stránky zase přihlášený.
 */
export async function odhlasit(): Promise<void> {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()
  redirect('/prihlaseni?odhlaseno=1')
}
