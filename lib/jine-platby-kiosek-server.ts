/**
 * Kiosek Jiných plateb — serverová část (jen ze serverových akcí
 * app/kiosek/doklady/akce.ts). Popis postupu je v lib/jine-platby-kiosek.ts.
 * Závislosti (databáze, úložiště) se předávají, ať jde postup otestovat
 * bez sítě (scripts/jine-platby-kiosek.test.mjs).
 */
import { createHash } from 'node:crypto'

import { poznatTypSouboru } from './jine-platby-ai-jadro.ts'
import { HLASKA_NEZNAME_ZARIZENI } from './kiosek-spojeni.ts'
import {
  hlaskaOdeslani,
  jeKlicZarizeni,
  MAX_ZNAKU_OZNACENI,
  overitVyber,
  prevzitDnesniDoklady,
  stavPodleChyby,
  stropSouboru,
  type DokladDnes,
} from './jine-platby-kiosek.ts'
import { cestaSouboru, overitCestu, PRIPONY_SOUBORU } from './jine-platby-soubory.ts'
import { MAX_SOUBORU_NA_ZAZNAM, type TypSouboru } from './jine-platby-typy.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ------------------------------------------------------------------ */
/* Serverová část (závislosti se předávají — testuje se bez sítě)       */
/* ------------------------------------------------------------------ */

type ChybaDb = { code?: string | null; message?: string | null } | null

export type ZavislostiKiosku = {
  /** Volání databáze KLIENTEM SLUŽBY (funkce kiosku mají grant jen pro service_role). */
  rpc(nazev: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ChybaDb }>
  /** Podepsaná adresa pro nahrání jednoho souboru do kbelíku Jiných plateb. */
  podepsatNahrani(cesta: string): Promise<{ token: string | null; error: ChybaDb }>
  stahnout(cesta: string): Promise<{ bajty: Uint8Array | null; error: ChybaDb }>
  smazat(cesty: string[]): Promise<void>
  noveId(): string
}

export type StavKiosku =
  | { ok: true; pobocka: string; zarizeni: string }
  | { ok: false; stav: 'odpojeno' | 'vypnuto' | 'chyba'; chyba: string }

export async function stavKiosku(z: ZavislostiKiosku, klic: unknown): Promise<StavKiosku> {
  if (!jeKlicZarizeni(klic)) return { ok: false, stav: 'odpojeno', chyba: HLASKA_NEZNAME_ZARIZENI }
  const { data, error } = await z.rpc('jine_platby_kiosek_stav', { p_klic: klic })
  if (error) return { ok: false, stav: stavPodleChyby(error), chyba: hlaskaOdeslani(error, 'Nepodařilo se spojit se serverem.') }
  const d = (data ?? {}) as { pobocka?: unknown; zarizeni?: unknown }
  return { ok: true, pobocka: String(d.pobocka ?? ''), zarizeni: String(d.zarizeni ?? '') }
}

export type DnesniDoklady = { ok: true; doklady: DokladDnes[] } | { ok: false; stav: 'odpojeno' | 'vypnuto' | 'chyba'; chyba: string }

/** Přehled dokladů z TOHOTO zařízení za dnešní provozní den (otázka 69). Databáze ověří klíč jako u ostatních funkcí. */
export async function dnesniDoklady(z: ZavislostiKiosku, klic: unknown): Promise<DnesniDoklady> {
  if (!jeKlicZarizeni(klic)) return { ok: false, stav: 'odpojeno', chyba: HLASKA_NEZNAME_ZARIZENI }
  const { data, error } = await z.rpc('jine_platby_kiosek_dnes', { p_klic: klic })
  if (error) return { ok: false, stav: stavPodleChyby(error), chyba: hlaskaOdeslani(error, 'Přehled se nepodařilo načíst.') }
  return { ok: true, doklady: prevzitDnesniDoklady(data) }
}

export type Pripraveno =
  | { ok: true; zaznam: string; nahrani: { cesta: string; token: string; typ: TypSouboru }[] }
  | { ok: false; stav: 'odpojeno' | 'vypnuto' | 'chyba'; chyba: string }

export async function pripravitOdeslani(
  z: ZavislostiKiosku,
  vstup: { klic: unknown; oznaceni: unknown; klientId: unknown; soubory: unknown },
): Promise<Pripraveno> {
  if (!jeKlicZarizeni(vstup.klic)) return { ok: false, stav: 'odpojeno', chyba: HLASKA_NEZNAME_ZARIZENI }
  if (typeof vstup.klientId !== 'string' || !UUID.test(vstup.klientId)) return { ok: false, stav: 'chyba', chyba: 'Odeslání nemá platný klíč — obnovte stránku.' }
  const vyber = overitVyber(vstup.soubory)
  if (!vyber.ok) return { ok: false, stav: 'chyba', chyba: vyber.chyba }
  const oznaceni = typeof vstup.oznaceni === 'string' ? vstup.oznaceni.trim().slice(0, MAX_ZNAKU_OZNACENI) : ''

  const { data, error } = await z.rpc('jine_platby_kiosek_zalozit', { p_klic: vstup.klic, p_oznaceni: oznaceni, p_klient_id: vstup.klientId })
  if (error) return { ok: false, stav: stavPodleChyby(error), chyba: hlaskaOdeslani(error) }
  const d = (data ?? {}) as { zaznam?: unknown; tenant?: unknown; branch?: unknown }
  const zaznam = String(d.zaznam ?? '')
  const tenant = String(d.tenant ?? '')
  const branch = String(d.branch ?? '')
  if (!UUID.test(zaznam) || !UUID.test(tenant) || !UUID.test(branch)) return { ok: false, stav: 'chyba', chyba: 'Server nevrátil založený doklad.' }

  const nahrani: { cesta: string; token: string; typ: TypSouboru }[] = []
  for (const s of vyber.soubory) {
    // Cestu skládá server z firmy a pobočky, které vrátila databáze — prohlížeč ji jen dostane.
    const cesta = cestaSouboru(tenant, branch, zaznam, z.noveId(), s.typ)
    const podpis = await z.podepsatNahrani(cesta)
    if (podpis.error || !podpis.token) return { ok: false, stav: 'chyba', chyba: 'Nahrání fotek se nepodařilo připravit. Zkuste to znovu.' }
    nahrani.push({ cesta, token: podpis.token, typ: s.typ })
  }
  return { ok: true, zaznam, nahrani }
}

export type Dokonceno = { ok: true; pripojeno: number } | { ok: false; stav: 'odpojeno' | 'vypnuto' | 'chyba'; chyba: string; pripojeno: number }

export async function dokoncitOdeslani(z: ZavislostiKiosku, vstup: { klic: unknown; zaznam: unknown; cesty: unknown }): Promise<Dokonceno> {
  if (!jeKlicZarizeni(vstup.klic)) return { ok: false, stav: 'odpojeno', chyba: HLASKA_NEZNAME_ZARIZENI, pripojeno: 0 }
  if (typeof vstup.zaznam !== 'string' || !UUID.test(vstup.zaznam)) return { ok: false, stav: 'chyba', chyba: 'Chybí doklad.', pripojeno: 0 }
  const cesty = Array.isArray(vstup.cesty) ? vstup.cesty : []
  if (cesty.length === 0 || cesty.length > MAX_SOUBORU_NA_ZAZNAM) return { ok: false, stav: 'chyba', chyba: 'Chybí fotky dokladu.', pripojeno: 0 }

  let pripojeno = 0
  for (const surova of cesty) {
    // Přísná cesta TOHOTO záznamu (firma/pobočka z cesty ověří databáze proti zařízení).
    const casti = typeof surova === 'string' ? surova.split('/') : []
    const overena = casti.length === 4 ? overitCestu(String(surova), casti[0], casti[1], vstup.zaznam) : null
    if (!overena) return { ok: false, stav: 'chyba', chyba: 'Fotka má neplatnou cestu.', pripojeno }

    const { bajty, error: chybaStazeni } = await z.stahnout(overena.cesta)
    if (chybaStazeni || !bajty) return { ok: false, stav: 'chyba', chyba: 'Fotka se nenahrála — zkuste odeslat znovu.', pripojeno }
    const zahodit = async (chyba: string): Promise<Dokonceno> => {
      await z.smazat([overena.cesta]).catch(() => undefined)
      return { ok: false, stav: 'chyba', chyba, pripojeno }
    }
    if (bajty.length === 0 || bajty.length > stropSouboru(overena.mime)) return zahodit('Fotka je prázdná nebo moc velká.')
    const typ = poznatTypSouboru(bajty)
    if (!typ || PRIPONY_SOUBORU[typ] !== PRIPONY_SOUBORU[overena.mime]) return zahodit('Soubor není fotka ani PDF, za které se vydává.')
    const otisk = createHash('sha256').update(bajty).digest('hex')

    const { error } = await z.rpc('jine_platby_kiosek_pripojit_soubor', { p_klic: vstup.klic, p_zaznam: vstup.zaznam, p_cesta: overena.cesta, p_otisk: otisk })
    if (error) {
      await z.smazat([overena.cesta]).catch(() => undefined)
      return { ok: false, stav: stavPodleChyby(error), chyba: hlaskaOdeslani(error), pripojeno }
    }
    pripojeno++
  }
  return { ok: true, pripojeno }
}
