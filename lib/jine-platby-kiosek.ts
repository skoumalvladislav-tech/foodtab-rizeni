/**
 * Kiosek Jiných plateb na telefonu pobočky — jádro bez sítě (zadání
 * Šéfíka 22. 10. 2026: „kiosek do telefonu jako je na docházku…
 * obsluha nemá přístup k modulu finance", upřesnění „nepotřebujeme se
 * přihlásit pinem").
 *
 * Telefon je ZAŘÍZENÍ POBOČKY jako tablet Docházky: spáruje se kódem
 * z Nastavení → Zařízení a klíč nosí v prohlížeči (stejné místo jako
 * kiosek Docházky). Žádný přihlášený člověk, žádný PIN. Autorem záznamu
 * je zařízení (migrace 20261022100000_jine_platby_kiosek).
 *
 * Co telefon smí: založit záznam na SVÉ pobočce a nahrát k němu fotky.
 * Nic nečte — po odeslání ukáže jen potvrzení (otázka 69).
 *
 * Tenhle soubor je sdílený s prohlížečem (konstanty, kontrola výběru,
 * hlášky). Serverová část je v lib/jine-platby-kiosek-server.ts.
 *
 * Postup odeslání (server, app/kiosek/doklady/akce.ts → serverová část):
 *   1. `pripravitOdeslani` — klíč a výběr souborů zkontroluje server,
 *      záznam založí databáze (`jine_platby_kiosek_zalozit`: klíč,
 *      zapnutý kiosek, strop odeslání). Firmu a pobočku vrátí DATABÁZE,
 *      ne prohlížeč; cesty server poskládá sám a ke každé vydá
 *      podepsanou adresu pro nahrání (fotka z telefonu je větší než
 *      strop těla serverové akce).
 *   2. Prohlížeč nahraje soubory na podepsané adresy (anon klient bez
 *      sezení, lib/supabase/kiosek.ts).
 *   3. `dokoncitOdeslani` — server cestu přísně zkontroluje
 *      (`overitCestu`), soubor STÁHNE, typ pozná z obsahu (magic bytes),
 *      velikost ze stažených bajtů, otisk sha256 spočítá sám a teprve pak
 *      databáze soubor připojí (`jine_platby_kiosek_pripojit_soubor`:
 *      záznam téhož zařízení, nejvýš dvě hodiny starý, soubor bez
 *      vlastníka). Cokoli selže → soubor se z úložiště smaže.
 */
import { HLASKA_NEZNAME_ZARIZENI, hlaskaKiosku } from './kiosek-spojeni.ts'
import { jeTypSouboru } from './jine-platby-soubory.ts'
import { MAX_BAJTU_OBRAZKU_PRO_AI, MAX_BAJTU_SOUBORU, MAX_SOUBORU_NA_ZAZNAM, type TypSouboru } from './jine-platby-typy.ts'

/** Klíč zařízení v prohlížeči — STEJNÝ jako u kiosku Docházky (app/kiosek/kiosek.tsx), jedno spárování platí pro obojí. */
export const KLIC_ZARIZENI_ULOZISTE = 'foodtab-kiosek-klic'

/** Stejné znění jako `app.jp_kiosek_zarizeni` (migrace 20261022100000). */
export const HLASKA_KIOSEK_VYPNUTY = 'Na tomhle zařízení není zapnutý kiosek Jiných plateb.'

/** Delší poznámka (označení účtu, jméno hosta) — databáze ořízne na 200 znaků. */
export const MAX_ZNAKU_OZNACENI = 200

/** Klíč zařízení z `registrovat_zarizeni`: 64 hex znaků. */
const KLIC = /^[0-9a-f]{64}$/

export function jeKlicZarizeni(klic: unknown): klic is string {
  return typeof klic === 'string' && KLIC.test(klic)
}

/** Strop velikosti podle typu: fotka jako pro AI (5 MB, telefon ji zmenší), PDF jako jinde (10 MB). */
export function stropSouboru(typ: TypSouboru): number {
  return typ === 'application/pdf' ? MAX_BAJTU_SOUBORU : MAX_BAJTU_OBRAZKU_PRO_AI
}

export type SouborOdeslani = { typ: string; velikost: number }

/** Kontrola výběru na serveru (prohlížeči se nevěří): 1–10 souborů, povolený typ, velikost do stropu. */
export function overitVyber(soubory: unknown): { ok: true; soubory: { typ: TypSouboru; velikost: number }[] } | { ok: false; chyba: string } {
  if (!Array.isArray(soubory) || soubory.length === 0) return { ok: false, chyba: 'Vyfoťte aspoň jednu fotku dokladu.' }
  if (soubory.length > MAX_SOUBORU_NA_ZAZNAM) return { ok: false, chyba: `Na jeden doklad jde poslat nejvýš ${MAX_SOUBORU_NA_ZAZNAM} fotek.` }
  const vysledek: { typ: TypSouboru; velikost: number }[] = []
  for (const s of soubory) {
    const typ = (s as { typ?: unknown } | null)?.typ
    const velikost = Number((s as { velikost?: unknown } | null)?.velikost)
    if (typeof typ !== 'string' || !jeTypSouboru(typ)) return { ok: false, chyba: 'Poslat jde jen fotku (JPEG, PNG, WebP) nebo PDF.' }
    if (!Number.isFinite(velikost) || velikost <= 0 || velikost > stropSouboru(typ)) {
      return { ok: false, chyba: 'Fotka je prázdná nebo moc velká — vyfoťte ji znovu.' }
    }
    vysledek.push({ typ, velikost: Math.trunc(velikost) })
  }
  return { ok: true, soubory: vysledek }
}

/** Co z odpovědi databáze nebo sítě ukázat u telefonu (česká hláška databáze projde, technika ne). */
export function hlaskaOdeslani(chyba: { message?: string | null } | null | undefined, vychozi = 'Doklad se nepodařilo odeslat. Zkuste to znovu.'): string {
  return hlaskaKiosku(chyba?.message ?? '', vychozi)
}

/** Stav telefonu podle chyby databáze: odvolané/neznámé zařízení, vypnutý kiosek, nebo jiná chyba. */
export function stavPodleChyby(chyba: { code?: string | null; message?: string | null } | null | undefined): 'odpojeno' | 'vypnuto' | 'chyba' {
  const zprava = chyba?.message ?? ''
  if (chyba?.code === '42501' && zprava.includes(HLASKA_NEZNAME_ZARIZENI)) return 'odpojeno'
  if (chyba?.code === '42501' && zprava.includes(HLASKA_KIOSEK_VYPNUTY)) return 'vypnuto'
  return 'chyba'
}

