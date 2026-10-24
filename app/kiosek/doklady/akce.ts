'use server'

import { randomUUID } from 'node:crypto'

import { KBELIK_JINYCH_PLATEB } from '@/lib/jine-platby-typy'
import {
  dnesniDoklady,
  dokoncitOdeslani,
  pripravitOdeslani,
  stavKiosku,
  type DnesniDoklady,
  type Dokonceno,
  type Pripraveno,
  type StavKiosku,
  type ZavislostiKiosku,
} from '@/lib/jine-platby-kiosek-server'
import { klientUlohy } from '@/lib/supabase/uloha'

/**
 * Serverové akce kiosku Jiných plateb (telefon pobočky, BEZ přihlášení).
 *
 * Serverovou akci zavolá kdokoli — proto tu není nic, co by věřilo
 * prohlížeči: o všem rozhoduje KLÍČ ZAŘÍZENÍ, který ověřuje databáze
 * při každém volání (`app.jp_kiosek_zarizeni`: spárované a neodvolané
 * zařízení, zapnutý kiosek Jiných plateb, aktivní pobočka, firma
 * s Financemi). Odvolání zařízení nebo vypnutí kiosku tak platí hned.
 *
 * SERVICE_ROLE: funkce kiosku (`jine_platby_kiosek_*`) mají grant jen
 * pro service_role — anon ani přihlášený je přes PostgREST nezavolají.
 * Telefon dostane jen název pobočky a zařízení, id nového záznamu, cesty
 * a jednorázové tokeny pro nahrání a přehled svých dnešních dokladů
 * (čas, počet fotek, poznámka, stav — otázka 69).
 *
 * Akce Financí (app/[rozsah]/finance/...) chtějí přihlášeného člověka
 * s právy Jiných plateb; kiosek žádného nemá, takže na ně nedosáhne.
 *
 * MAZÁNÍ: klient služby obchází RLS úložiště. Proto se nic nestahuje,
 * dokud databáze neověří klíč a záznam, a smaže se jen soubor, o kterém
 * databáze řekne, že je to nepřipojený soubor téhož zařízení
 * (lib/jine-platby-kiosek-server.ts, `uklidit`; kontrola 24. 10.).
 */

const BEZ_SLUZBY = 'Kiosek teď nejde použít — na serveru chybí nastavení. Dejte vědět vedoucímu.'

function zavislosti(): ZavislostiKiosku | null {
  const sluzba = klientUlohy()
  if (!sluzba) return null
  const kbelik = () => sluzba.storage.from(KBELIK_JINYCH_PLATEB)
  return {
    rpc: async (nazev, args) => {
      const { data, error } = await sluzba.rpc(nazev, args)
      return { data, error: error ? { code: error.code, message: error.message } : null }
    },
    podepsatNahrani: async (cesta) => {
      const { data, error } = await kbelik().createSignedUploadUrl(cesta)
      return { token: data?.token ?? null, error: error ? { message: error.message } : null }
    },
    stahnout: async (cesta) => {
      const { data, error } = await kbelik().download(cesta)
      if (error || !data) return { bajty: null, error: { message: error?.message ?? 'Soubor není.' } }
      return { bajty: new Uint8Array(await data.arrayBuffer()), error: null }
    },
    smazat: async (cesty) => {
      await kbelik().remove(cesty)
    },
    noveId: () => randomUUID(),
  }
}

/** Pobočka a název zařízení — nic víc telefon nedostane. */
export async function nacistStavKiosku(klic: string): Promise<StavKiosku> {
  const z = zavislosti()
  if (!z) return { ok: false, stav: 'chyba', chyba: BEZ_SLUZBY }
  return stavKiosku(z, klic)
}

/** Doklady odeslané z TOHOTO telefonu za dnešní provozní den — čas, počet fotek, poznámka, stav (otázka 69). */
export async function nacistDnesniDoklady(klic: string): Promise<DnesniDoklady> {
  const z = zavislosti()
  if (!z) return { ok: false, stav: 'chyba', chyba: BEZ_SLUZBY }
  return dnesniDoklady(z, klic)
}

/** Krok 1: založit záznam na pobočce zařízení a vydat podepsané adresy pro nahrání fotek. */
export async function pripravitDoklad(vstup: { klic: string; oznaceni: string; klientId: string; soubory: { typ: string; velikost: number }[] }): Promise<Pripraveno> {
  const z = zavislosti()
  if (!z) return { ok: false, stav: 'chyba', chyba: BEZ_SLUZBY }
  return pripravitOdeslani(z, vstup)
}

/** Krok 3: nahrané fotky ověřit (typ z obsahu, velikost, otisk) a připojit k záznamu. */
export async function dokoncitDoklad(vstup: { klic: string; zaznam: string; cesty: string[] }): Promise<Dokonceno> {
  const z = zavislosti()
  if (!z) return { ok: false, stav: 'chyba', chyba: BEZ_SLUZBY, pripojeno: 0 }
  return dokoncitOdeslani(z, vstup)
}
