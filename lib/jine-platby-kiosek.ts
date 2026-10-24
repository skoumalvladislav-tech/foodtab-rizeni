/**
 * Kiosek Jiných plateb na telefonu pobočky — jádro bez sítě (zadání
 * Šéfíka 22. 10. 2026: „kiosek do telefonu jako je na docházku…
 * obsluha nemá přístup k modulu finance", upřesnění „nepotřebujeme se
 * přihlásit pinem").
 *
 * Telefon je ZAŘÍZENÍ POBOČKY jako tablet Docházky: spáruje se kódem
 * z Nastavení → Zařízení (`registrovat_zarizeni_doklady` — účel
 * „doklady“, kiosek Docházky na něm nefunguje) a klíč nosí v prohlížeči
 * pod VLASTNÍM jménem. Žádný přihlášený člověk, žádný PIN. Autorem
 * záznamu je zařízení (migrace 20261022100000_jine_platby_kiosek).
 *
 * Co telefon smí: založit záznam na SVÉ pobočce a nahrát k němu fotky.
 * Číst smí jen přehled dokladů odeslaných z TOHOTO telefonu za dnešní
 * provozní den — čas, počet fotek, poznámku a stav (rozhodnutí Šéfíka
 * 24. 10., otázka 69). Žádné částky ani nic dalšího z Financí.
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
 *   3. `dokoncitOdeslani` — NEJDŘÍV databáze ověří klíč a záznam
 *      (`jine_platby_kiosek_overit_zaznam`: záznam téhož zařízení,
 *      otevřený, nejvýš dvě hodiny starý) a vrátí firmu a pobočku; teprve
 *      pak server cestu přísně zkontroluje (`overitCestu`), soubor STÁHNE,
 *      typ pozná z obsahu (magic bytes), velikost ze stažených bajtů,
 *      otisk sha256 spočítá sám a databáze soubor připojí
 *      (`jine_platby_kiosek_pripojit_soubor`). Když něco selže, server
 *      smaže JEN soubor, o kterém databáze řekne, že je to nepřipojený
 *      soubor téhož zařízení (`jine_platby_kiosek_muze_uklidit`) — nikdy
 *      originál ve Financích ani cizí soubor (kontrola 24. 10.).
 */
import { HLASKA_NEZNAME_ZARIZENI, hlaskaKiosku } from './kiosek-spojeni.ts'
import { jeTypSouboru } from './jine-platby-soubory.ts'
import { MAX_BAJTU_OBRAZKU_PRO_AI, MAX_BAJTU_SOUBORU, MAX_SOUBORU_NA_ZAZNAM, type TypSouboru } from './jine-platby-typy.ts'

/**
 * Klíč telefonu na doklady v prohlížeči — JINÝ než u kiosku Docházky
 * (app/kiosek/kiosek.tsx, 'foodtab-kiosek-klic'). Telefon na doklady
 * Docházku neumí; kdyby sdílel klíč, kiosek Docházky by ho na „zařízení
 * neznám“ smazal a odpároval i doklady.
 */
export const KLIC_ZARIZENI_ULOZISTE = 'foodtab-kiosek-doklady-klic'

/** Stejné znění jako `jine_platby_kiosek_zalozit`: opakované odeslání k uzavřenému dokladu. */
export const HLASKA_ODESLANI_UZAVRENO = 'Tohle odeslání už je uzavřené — fotky pošlete jako nový doklad.'
/** Stejné znění jako `jine_platby_kiosek_overit_zaznam` a `_pripojit_soubor`. */
export const HLASKA_FOTKY_UZ_NE = 'K tomuhle dokladu už fotky přidat nejde — vyfoťte ho jako nový.'

/** Jak dlouho čekat na serverovou akci a na nahrání jedné fotky, než telefon řekne „pomalé spojení“. */
export const LIMIT_AKCE_MS = 45_000
export const LIMIT_NAHRANI_MS = 90_000
export const HLASKA_POMALE_SPOJENI = 'Spojení je pomalé — zkuste odeslat znovu.'
export const HLASKA_ZRUSENO = 'Odesílání jste zrušili. Fotky zůstaly — můžete je odeslat znovu.'

/**
 * Počká na `slib` nejvýš `ms`, nebo do zrušení (`signal`). Pak odmítne
 * s českou hláškou — telefon tak nikdy nevisí na „Nahrávám…“ bez konce.
 * (Serverová akce na serveru doběhne; opakování se stejným klíčem odeslání
 * vrátí týž záznam.)
 */
export function sLimitem<T>(slib: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((hotovo, chyba) => {
    if (signal?.aborted) {
      chyba(new Error(HLASKA_ZRUSENO))
      return
    }
    const casovac = setTimeout(() => chyba(new Error(HLASKA_POMALE_SPOJENI)), ms)
    const zrusit = () => {
      clearTimeout(casovac)
      chyba(new Error(HLASKA_ZRUSENO))
    }
    signal?.addEventListener('abort', zrusit, { once: true })
    slib.then(
      (v) => {
        clearTimeout(casovac)
        signal?.removeEventListener('abort', zrusit)
        hotovo(v)
      },
      (e: unknown) => {
        clearTimeout(casovac)
        signal?.removeEventListener('abort', zrusit)
        chyba(e)
      },
    )
  })
}

/**
 * Po chybě odeslání: začít nový doklad (nový klíč odeslání)? Jen když
 * databáze řekla, že tenhle doklad je uzavřený — po výpadku sítě ne,
 * opakování se stejným klíčem pak vrátí týž záznam.
 */
export function novyKlicPoChybe(stav: string): boolean {
  return stav === 'uzavreno'
}

/** Stejné znění jako `app.jp_kiosek_zarizeni` (migrace 20261022100000). */
export const HLASKA_KIOSEK_VYPNUTY = 'Na tomhle zařízení není zapnutý kiosek Jiných plateb.'

/** Stav dokladu v přehledu telefonu — kód z `jine_platby_kiosek_dnes`. */
export type StavDokladuKiosku = 'prijato' | 'bez_fotky' | 'zkontrolovano' | 'zpracovano' | 'zruseno'

/** Srozumitelně pro obsluhu; bez důvodů a čísel z Financí. */
export const POPIS_STAVU_KIOSKU: Record<StavDokladuKiosku, string> = {
  prijato: 'Přijato, čeká na kontrolu',
  bez_fotky: 'Bez fotky — pošlete znovu',
  zkontrolovano: 'Zkontrolováno',
  zpracovano: 'Zpracováno',
  zruseno: 'Zrušeno ve Financích',
}

/** Jeden řádek přehledu: nic víc, než co tu je. */
export type DokladDnes = { cas: string; fotek: number; oznaceni: string; stav: StavDokladuKiosku }

/**
 * Odpověď databáze → řádky přehledu. Vezme JEN čtyři známé údaje (cokoli
 * dalšího, co by databáze omylem poslala, se na telefon nedostane);
 * neznámý stav se ukáže jako „přijato“, nejvýš 50 řádků.
 */
export function prevzitDnesniDoklady(data: unknown): DokladDnes[] {
  if (!Array.isArray(data)) return []
  return data.slice(0, 50).flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const cas = typeof o.cas === 'string' && !Number.isNaN(Date.parse(o.cas)) ? o.cas : null
    if (!cas) return []
    const fotek = Number.isFinite(Number(o.fotek)) ? Math.max(0, Math.trunc(Number(o.fotek))) : 0
    const oznaceni = typeof o.oznaceni === 'string' ? o.oznaceni.slice(0, MAX_ZNAKU_OZNACENI) : ''
    const stav = (typeof o.stav === 'string' && o.stav in POPIS_STAVU_KIOSKU ? o.stav : 'prijato') as StavDokladuKiosku
    return [{ cas, fotek, oznaceni, stav }]
  })
}

/** Čas odeslání HH:MM (pásmo pobočky není u telefonu známé — výchozí české jako jinde v appce). */
export function casOdeslani(iso: string, zona = 'Europe/Prague'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: zona }).format(d)
}

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

export type StavChybyKiosku = 'odpojeno' | 'vypnuto' | 'uzavreno' | 'chyba'

/** Stav telefonu podle chyby databáze: odvolané/neznámé zařízení, vypnutý kiosek, uzavřený doklad, nebo jiná chyba. */
export function stavPodleChyby(chyba: { code?: string | null; message?: string | null } | null | undefined): StavChybyKiosku {
  const zprava = chyba?.message ?? ''
  if (chyba?.code === '42501' && zprava.includes(HLASKA_NEZNAME_ZARIZENI)) return 'odpojeno'
  if (chyba?.code === '42501' && zprava.includes(HLASKA_KIOSEK_VYPNUTY)) return 'vypnuto'
  if (chyba?.code === '23514' && (zprava.includes(HLASKA_ODESLANI_UZAVRENO) || zprava.includes(HLASKA_FOTKY_UZ_NE))) return 'uzavreno'
  return 'chyba'
}

