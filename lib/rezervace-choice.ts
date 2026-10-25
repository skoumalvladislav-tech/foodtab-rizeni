/**
 * Choice (choiceqr.com) — rezervace přes Choice Open API.
 *
 * Šéfík 25. 10. 2026: „v chromu jsem přihlášený na nastavení api od
 * choice, projdi dokumentaci a vše připrav automaticky“. Vývojářská
 * aplikace „Foodtab“ (typ Plugin) je v Choice založená, callback
 * `https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback`.
 * Návod pro majitele: docs/rezervace-choice.md.
 *
 * ---------------------------------------------------------------------
 * CO Z DOKUMENTACE CHOICE PLYNE (open-api.choiceqr.com/docs, 25. 10. 2026)
 *
 *   * Přístup je OAuth. Majitel podniku otevře odkaz
 *     `https://<podnik>.choiceqr.com/admin/open-api/connect?…`, v Choice
 *     povolí aplikaci (Choice k tomu chce „ChoiceQR token“ od
 *     api@choiceqr.com) a Choice vrátí prohlížeč na callback s `code`
 *     a s naším `customAttribute`. Kód se vymění za token
 *     (`POST /auth/connect/token`), token platí 5 let.
 *   * Rezervace: `GET /bookings/list` (from/till v UTC, periodField
 *     createdDt | bookingDt, page 1–1000, perPage 1–100) — LIMIT 1 DOTAZ
 *     ZA 5 SEKUND. Proto `ROZESTUP_DOTAZU_MS` a databázová fronta dotazů
 *     (`public.rezervace_choice_zabrat_dotaz`), která rozestup drží i mezi
 *     stránkami, pobočkami a souběžnými běhy.
 *   * Webhooky pro rezervace Choice NEMÁ (jen menu, objednávky, místo) —
 *     rezervace se tahají: úloha každých 15 minut a tlačítko „Načíst teď“.
 *   * Do Choice Foodtab NIC nezapisuje. `PUT /bookings/:id/confirm`
 *     a `…/cancel` existují, ale tenhle modul je nevolá a nemá na ně ani
 *     funkci (kontrakt: nejdřív jen čtení).
 *
 * CO DOKUMENTACE NEŘÍKÁ — A TADY SE TO NEDOMÝŠLÍ
 *
 *   * Tvar `dateTime` („nested schema object“). Bere se jen OKAMŽIK
 *     S ČASOVÝM PÁSMEM. Hodina bez pásma se nezapíše a ohlásí se
 *     u napojení (CLAUDE.md, pravidlo 11) — přečetla by se v pásmu
 *     serveru a rezervace by se posunula, aniž by to kdo poznal.
 *   * Jednotka `visitDuration` (minuty? milisekundy?) — konec rezervace
 *     se proto nevyplňuje.
 *   * Jednotka `deposit.amount` (koruny? haléře?) — do poznámky jde jen
 *     stav zálohy, ne částka. Záloha OD HOSTA ve Foodtabu patří Foodtabu
 *     a Choice ji nepřepisuje.
 *   * Význam `digit` v odkazu na připojení. Když majitel vloží celý odkaz
 *     vygenerovaný v Choice, `digit` z něj se pošle dál beze změny.
 *
 * Čistý modul: síť a čekání se podstrkují (`vytvoritChoice(fetchFn)`,
 * `probehnoutChoice({ … })`) — testuje ho scripts/rezervace-choice.test.mjs.
 */

import { createHash } from 'node:crypto'

import type { RadekRezervace, StavRezervace } from './reservation-provider-contract.ts'
import { zRadkuZdroje, type RadekImportu } from './rezervace-import.ts'

export const API_CHOICE = 'https://open-api.choiceqr.com'
/** `integrace_pripojeni.poskytovatel` i `rezervace.poskytovatel`. */
export const KLIC_CHOICE = 'choice'
/** Choice: `GET /bookings/list` nejvýš 1 dotaz za 5 s. Půl sekundy navíc na nerovnoměrnost sítě. */
export const ROZESTUP_DOTAZU_MS = 5_500
export const NA_STRANKU = 100
/** Choice bere `page` 1–1000. */
export const MAX_STRANKA = 1000
/** Nejdéle, jak dlouho se čeká na jednu odpověď Choice (s tím počítá rezerva běhu v lib/rezervace-choice-sync.ts). */
export const CASOVY_LIMIT_MS = 15_000
/** Jak dlouho platí odkaz na připojení podniku (customAttribute). */
export const PLATNOST_POKUSU_S = 10 * 60

const HODINA_MS = 3_600_000
const DEN_MS = 24 * HODINA_MS
/** Pravidelné procházení: od včerejška (36 h — „včera“ v jakémkoli pásmu) do +180 dní podle data rezervace. */
export const OKNO_ZPET_MS = 36 * HODINA_MS
export const OKNO_DOPREDU_MS = 180 * DEN_MS
/** Rozjeté procházení okna starší než tohle se začne znovu (okno by se posunulo moc daleko). */
export const OKNO_ZASTARA_MS = 12 * HODINA_MS
/** Při každém běhu znovu: co začalo před 12 h až za 48 h — dnešní storna a změny do čtvrt hodiny. */
export const BLIZKO_ZPET_MS = 12 * HODINA_MS
export const BLIZKO_DOPREDU_MS = 48 * HODINA_MS
/** Nově vytvořené (createdDt): překryv za posledním během a strop, jak nejdál zpátky. */
export const NOVE_PREKRYV_MS = 15 * 60_000
export const NOVE_NEJDAL_MS = 7 * DEN_MS

/* ---------------------------------------------------------------------
 * Nastavení aplikace (proměnné prostředí)
 * ------------------------------------------------------------------ */

export type NastaveniChoice = { clientId: string; secret: string }

/** Client ID a secret aplikace „Foodtab“ z dashboardu Choice. Bez obou `null` = „čeká na nastavení“. */
export function nastaveniChoice(env: Record<string, string | undefined>): NastaveniChoice | null {
  const clientId = (env.CHOICE_CLIENT_ID ?? '').trim()
  const secret = (env.CHOICE_CLIENT_SECRET ?? '').trim()
  if (!clientId || !secret) return null
  return { clientId, secret }
}

/* ---------------------------------------------------------------------
 * Podnik a odkaz na připojení
 * ------------------------------------------------------------------ */

const RE_SUBDOMENA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const DOMENA_CHOICE = '.choiceqr.com'

export type Podnik = { subdomena: string; digit: string | null }

/**
 * Co majitel vloží: jméno podniku („mojerestaurace“), adresu
 * („mojerestaurace.choiceqr.com“, i s https://) nebo celý odkaz na
 * připojení vygenerovaný v Choice. Odkaz jinam než na podnik na
 * choiceqr.com se odmítne — appka na něj pak přesměrovává.
 */
export function rozebratPodnik(vstup: string, clientId: string | null = null): { stav: 'ok'; podnik: Podnik } | { stav: 'chyba'; duvod: string } {
  const chyba = (duvod: string) => ({ stav: 'chyba' as const, duvod })
  let t = vstup.trim()
  if (!t) return chyba('Vyplňte adresu podniku v Choice, např. mojerestaurace.choiceqr.com.')
  if (t.length > 2000) return chyba('Adresa podniku je moc dlouhá.')

  if (RE_SUBDOMENA.test(t.toLowerCase())) return { stav: 'ok', podnik: { subdomena: t.toLowerCase(), digit: null } }

  if (!/^https?:\/\//i.test(t)) t = `https://${t}`
  let adresa: URL
  try {
    adresa = new URL(t)
  } catch {
    return chyba('Tohle není adresa podniku v Choice (např. mojerestaurace.choiceqr.com).')
  }
  const host = adresa.hostname.toLowerCase()
  if (!host.endsWith(DOMENA_CHOICE) || adresa.username || adresa.password || adresa.port) {
    return chyba('Adresa musí být podnik na choiceqr.com, např. mojerestaurace.choiceqr.com.')
  }
  const subdomena = host.slice(0, -DOMENA_CHOICE.length)
  if (!RE_SUBDOMENA.test(subdomena) || subdomena === 'open-api' || subdomena === 'www') {
    return chyba('Adresa musí být podnik na choiceqr.com, např. mojerestaurace.choiceqr.com.')
  }

  let digit: string | null = null
  if (adresa.pathname.replace(/\/+$/, '') === '/admin/open-api/connect') {
    const d = adresa.searchParams.get('digit')
    if (d !== null && d !== '') {
      if (!/^\d{1,12}$/.test(d)) return chyba('Odkaz z Choice má neobvyklý parametr „digit“ — vložte ho znovu, nebo jen adresu podniku.')
      digit = d
    }
    const odkazovanyKlient = adresa.searchParams.get('clientId')
    if (clientId && odkazovanyKlient && odkazovanyKlient !== clientId) {
      return chyba('Odkaz je vygenerovaný pro jinou aplikaci než Foodtab — v Choice ho vytvořte u aplikace „Foodtab“.')
    }
  }
  return { stav: 'ok', podnik: { subdomena, digit } }
}

/** Odkaz, na který se majitel přesměruje. `redirectUrl` musí přesně sedět s callbackem aplikace v Choice. */
export function odkazPripojeni(v: { podnik: Podnik; clientId: string; redirectUrl: string; pokus: string }): string {
  const q = new URLSearchParams({
    clientId: v.clientId,
    redirectUrl: v.redirectUrl,
    customAttribute: v.pokus,
    scope: 'all',
    response_type: 'code',
  })
  if (v.podnik.digit) q.set('digit', v.podnik.digit)
  return `https://${v.podnik.subdomena}${DOMENA_CHOICE}/admin/open-api/connect?${q.toString()}`
}

/* ---------------------------------------------------------------------
 * Pokus o připojení — `customAttribute`
 *
 * Choice ho pošle zpátky na callback. Nese id rozjetého připojení,
 * platnost, jednorázové číslo (`nonce`) a rozsah adresy. Podpis HMAC
 * pokrývá navíc firmu, pobočku a PŘIHLÁŠENÉHO UŽIVATELE, které v textu
 * nejsou: callback je doplní z databáze a ze sezení a podpis sedí jen
 * tomu, kdo odkaz vydal. Jednorázovost drží databáze — u připojení je
 * otisk `nonce` a callback ho spotřebuje podmíněným zápisem.
 * ------------------------------------------------------------------ */

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RE_ROZSAH = /^[a-z0-9-]{1,80}$/
const RE_NONCE = /^[A-Za-z0-9_-]{22}$/
const RE_PODPIS = /^[A-Za-z0-9_-]{20,100}$/

export type Pokus = { pripojeniId: string; platnostDo: number; nonce: string; rozsah: string }
export type VazbaPokusu = { tenantId: string; branchId: string; userId: string }

function textKPodpisu(p: Pokus, v: VazbaPokusu): string {
  return ['choice-rezervace-v1', p.pripojeniId, v.tenantId, v.branchId, v.userId, String(p.platnostDo), p.nonce, p.rozsah].join('|')
}

/** `podepsat` = `podepsatText` z lib/integrace-klice.ts (HMAC klíčem appky). */
export function slozitPokus(p: Pokus, v: VazbaPokusu, podepsat: (text: string) => string): string {
  if (!RE_UUID.test(p.pripojeniId) || !RE_NONCE.test(p.nonce) || !RE_ROZSAH.test(p.rozsah)) {
    throw new Error('Pokus o připojení Choice má neplatné části.')
  }
  return [p.pripojeniId, String(p.platnostDo), p.nonce, p.rozsah, podepsat(textKPodpisu(p, v))].join('.')
}

/** Rozebere text z callbacku. Cokoli jiného než přesný tvar = `null` (nic se nezkouší „opravit“). */
export function rozebratPokus(text: string | null | undefined): (Pokus & { podpis: string }) | null {
  if (!text || text.length > 400) return null
  const casti = text.split('.')
  if (casti.length !== 5) return null
  const [pripojeniId, platnost, nonce, rozsah, podpis] = casti
  if (!RE_UUID.test(pripojeniId) || !/^\d{9,11}$/.test(platnost) || !RE_NONCE.test(nonce) || !RE_ROZSAH.test(rozsah) || !RE_PODPIS.test(podpis)) {
    return null
  }
  return { pripojeniId, platnostDo: Number(platnost), nonce, rozsah, podpis }
}

/** Podpis napřed (kdo podpis nemá, nedozví se ani to, že pokus propadl), pak platnost. */
export function overitPokus(
  p: Pokus & { podpis: string },
  v: VazbaPokusu,
  podpisSedi: (text: string, podpis: string) => boolean,
  tedMs: number,
): 'ok' | 'podpis' | 'propadly' {
  if (!podpisSedi(textKPodpisu(p, v), p.podpis)) return 'podpis'
  if (p.platnostDo * 1000 < tedMs) return 'propadly'
  // Platnost dál, než kolik appka kdy vydá = nevydala ho appka.
  if (p.platnostDo * 1000 > tedMs + (PLATNOST_POKUSU_S + 60) * 1000) return 'podpis'
  return 'ok'
}

/** Otisk jednorázového čísla, který se uloží u připojení (`externi_ucet.pokus`). Číslo samo se neukládá. */
export function otiskPokusu(nonce: string): string {
  return createHash('sha256').update(`choice-pokus:${nonce}`, 'utf8').digest('hex').slice(0, 32)
}

/* ---------------------------------------------------------------------
 * Volání Choice
 * ------------------------------------------------------------------ */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** `pristup` = token/klíč neplatí; `limit` = 429; `docasna` = síť, 5xx; `data` = 4xx a nečekaná odpověď. */
export type ChybaChoice = { stav: 'chyba'; druh: 'pristup' | 'limit' | 'docasna' | 'data'; duvod: string; http: number | null }

export type DotazSeznamu = {
  od: string
  do: string
  podle: 'createdDt' | 'bookingDt'
  stranka: number
  naStranku: number
}

export function adresaSeznamu(d: DotazSeznamu): string {
  const q = new URLSearchParams({
    from: d.od,
    till: d.do,
    periodField: d.podle,
    page: String(d.stranka),
    perPage: String(d.naStranku),
  })
  return `${API_CHOICE}/bookings/list?${q.toString()}`
}

/** Adresa živého testu: první rezervace, nic víc. */
export const ADRESA_TESTU = `${API_CHOICE}/bookings/list?page=1&perPage=1`

/**
 * Seznam z odpovědi. Dokumentace slibuje pole; kdyby přišlo zabalené
 * (`{ items: [...] }` a podobně), vezme se pole z obalu. Cokoli jiného je
 * chyba — nic se nezkouší vyčíst z neznámého tvaru.
 */
export function seznamZOdpovedi(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const k of ['items', 'data', 'bookings', 'docs']) {
      const v = (data as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v
    }
  }
  return null
}

async function zavolat(fetchFn: FetchFn, url: string, init: RequestInit): Promise<{ stav: 'ok'; data: unknown } | ChybaChoice> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(CASOVY_LIMIT_MS) })
  } catch {
    return { stav: 'chyba', druh: 'docasna', duvod: 'Choice neodpověděl (síť nebo časový limit).', http: null }
  }
  const http = odpoved.status
  if (http === 429) return { stav: 'chyba', druh: 'limit', duvod: 'Choice omezil počet dotazů (429).', http }
  if (http === 401 || http === 403) return { stav: 'chyba', druh: 'pristup', duvod: `Choice odmítl přístup (${http}).`, http }
  if (http >= 500) return { stav: 'chyba', druh: 'docasna', duvod: `Choice hlásí chybu na své straně (${http}).`, http }

  const text = await odpoved.text().catch(() => '')
  let data: unknown
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    return { stav: 'chyba', druh: 'data', duvod: `Choice neposlal platný JSON (${http}).`, http }
  }
  if (!odpoved.ok) {
    const zprava = data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
      ? cistyText((data as { message: string }).message, 200)
      : ''
    return { stav: 'chyba', druh: 'data', duvod: `Choice dotaz odmítl (${http})${zprava ? `: ${zprava}` : ''}.`, http }
  }
  return { stav: 'ok', data }
}

export type VymenaKodu = { stav: 'ok'; token: string; varSymbol: string; domena: string }

export type ApiChoice = {
  /** `POST /auth/connect/token` — kód z callbacku za token. Token se nikam nevypisuje. */
  vymenitKod(v: { code: string; clientId: string; secret: string }): Promise<VymenaKodu | ChybaChoice>
  /** `GET /bookings/list`. `null` = živý test (`page=1&perPage=1`). */
  nacistStranku(token: string, dotaz: DotazSeznamu | null): Promise<{ stav: 'ok'; rezervace: unknown[] } | ChybaChoice>
}

export function vytvoritChoice(fetchFn: FetchFn): ApiChoice {
  return {
    async vymenitKod({ code, clientId, secret }) {
      const r = await zavolat(fetchFn, `${API_CHOICE}/auth/connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ code, clientId, secret }),
      })
      // Text chyby od Choice se u výměny NEPŘEBÍRÁ — mohl by v něm být kód.
      if (r.stav === 'chyba') {
        if (r.druh === 'data') return { ...r, duvod: `Choice kód nepřijal (${r.http ?? '?'}). Kód platí krátce a jen jednou — připojte podnik znovu.` }
        if (r.druh === 'pristup') return { ...r, duvod: `Choice nepřijal klíč aplikace (${r.http}) — zkontrolujte CHOICE_CLIENT_ID a CHOICE_CLIENT_SECRET.` }
        return r
      }
      const d = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>
      const token = typeof d.token === 'string' ? d.token.trim() : ''
      const varSymbol = typeof d.varSymbol === 'string' || typeof d.varSymbol === 'number' ? String(d.varSymbol).trim() : ''
      const domena = typeof d.domain === 'string' ? d.domain.trim().toLowerCase() : ''
      if (!token || token.length > 4000 || !/^[\x21-\x7e]+$/.test(token)) {
        return { stav: 'chyba', druh: 'data', duvod: 'Choice místo tokenu poslal něco jiného — připojte podnik znovu.', http: 200 }
      }
      if (!varSymbol || varSymbol.length > 60 || !/^[\x21-\x7e]+$/.test(varSymbol)) {
        return { stav: 'chyba', druh: 'data', duvod: 'Choice neposlal označení podniku (varSymbol).', http: 200 }
      }
      return { stav: 'ok', token, varSymbol, domena: /^[a-z0-9.-]{1,200}$/.test(domena) ? domena : '' }
    },

    async nacistStranku(token, dotaz) {
      const r = await zavolat(fetchFn, dotaz ? adresaSeznamu(dotaz) : ADRESA_TESTU, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      })
      if (r.stav === 'chyba') return r
      const rezervace = seznamZOdpovedi(r.data)
      if (!rezervace) return { stav: 'chyba', druh: 'data', duvod: 'Choice poslal seznam rezervací v nečekaném tvaru.', http: 200 }
      return { stav: 'ok', rezervace }
    },
  }
}

/* ---------------------------------------------------------------------
 * Rezervace z Choice → řádek pro databázi
 * ------------------------------------------------------------------ */

/** Řídicí znaky pryč (i \u0000, který databáze v JSONu odmítne celou dávkou); konce řádků zůstávají. */
function cistyText(hodnota: unknown, max: number): string {
  if (typeof hodnota !== 'string' && typeof hodnota !== 'number') return ''
  return String(hodnota)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Stavy podle dokumentace Choice (booking/statuses). Co tu není, je
 * „předběžná“ a původní slovo zůstane ve stavu ze zdroje — nikdy se
 * nevymyslí „proběhla“.
 */
export const STAVY_CHOICE: Readonly<Record<string, StavRezervace>> = {
  CREATED: 'ceka',
  CONFIRMED: 'potvrzeno',
  // Ruší se přes jiný systém (partner): už ne jistá, ještě ne zrušená.
  EXTERNAL_CANCELLING: 'ceka',
  CANCELLED: 'zrusena',
  // Host sedí. Foodtab stoly v reálném čase neřídí — pro něj potvrzená.
  IN_PROGRESS: 'potvrzeno',
  NOT_CAME: 'nedostavil_se',
  COMPLETED: 'dokonceno',
}

export function stavZChoice(status: unknown): { stav: StavRezervace; stavZdroje: string } {
  const puvodni = cistyText(status, 60)
  return { stav: STAVY_CHOICE[puvodni.toUpperCase()] ?? 'ceka', stavZdroje: puvodni }
}

export type DuvodCasu = 'chybi' | 'bez-pasma' | 'neznamy-tvar' | 'neplatny'
export type CasChoice = { stav: 'ok'; okamzik: string } | { stav: 'chyba'; duvod: DuvodCasu }

/** Okamžik ISO 8601 — pásmo (Z nebo ±HH:MM) je povinná část vzoru. */
const RE_OKAMZIK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|z|[+-]\d{2}(:?\d{2})?)$/
/** Datum nebo datum s hodinou BEZ pásma — „hodina na zdi“. */
const RE_BEZ_PASMA = /^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?$/

/**
 * `dateTime` z Choice → okamžik (ISO, UTC). Bere se:
 *   * řetězec ISO 8601 s pásmem („2026-11-20T18:00:00.000Z“, „…+01:00“),
 *   * MongoDB Extended JSON `{ "$date": "…Z" }` nebo
 *     `{ "$date": { "$numberLong": "<ms od 1970 v UTC>" } }`,
 *   * obal `{ utc: "…" }` / `{ iso: "…" }` s řetězcem výš.
 * NEBERE se: hodina bez pásma (ani `{ date, time }`) — `bez-pasma`;
 * holé číslo (sekundy, nebo milisekundy? dokumentace neříká) —
 * `neznamy-tvar`. Nic z toho se nedomýšlí.
 */
export function casZChoice(hodnota: unknown, hloubka = 0): CasChoice {
  const chyba = (duvod: DuvodCasu): CasChoice => ({ stav: 'chyba', duvod })
  if (hodnota === undefined || hodnota === null || hodnota === '') return chyba('chybi')

  if (typeof hodnota === 'string') {
    const t = hodnota.trim()
    if (RE_OKAMZIK.test(t)) {
      const ms = Date.parse(t)
      return Number.isNaN(ms) ? chyba('neplatny') : { stav: 'ok', okamzik: new Date(ms).toISOString() }
    }
    return chyba(RE_BEZ_PASMA.test(t) ? 'bez-pasma' : 'neznamy-tvar')
  }

  if (typeof hodnota === 'object' && !Array.isArray(hodnota) && hloubka < 2) {
    const o = hodnota as Record<string, unknown>
    if ('$date' in o) {
      const d = o.$date
      if (d && typeof d === 'object' && typeof (d as { $numberLong?: unknown }).$numberLong === 'string') {
        const ms = (d as { $numberLong: string }).$numberLong
        if (!/^-?\d{1,15}$/.test(ms)) return chyba('neplatny')
        const datum = new Date(Number(ms))
        return Number.isNaN(datum.getTime()) ? chyba('neplatny') : { stav: 'ok', okamzik: datum.toISOString() }
      }
      return typeof d === 'string' ? casZChoice(d, hloubka + 1) : chyba('neznamy-tvar')
    }
    for (const k of ['utc', 'iso']) {
      if (typeof o[k] === 'string') return casZChoice(o[k], hloubka + 1)
    }
    const klice = Object.keys(o)
    const maPasmo = klice.some((k) => /zone|tz|offset/i.test(k))
    if (!maPasmo && klice.some((k) => /date|time|hour|day/i.test(k))) return chyba('bez-pasma')
  }
  return chyba('neznamy-tvar')
}

/** Jméno prostoru z `preferArea.i18n` (česky, pak anglicky, pak cokoli). */
export function prostorZChoice(oblast: unknown): string {
  if (!oblast || typeof oblast !== 'object') return ''
  const jmeno = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') return (v as { name: string }).name
    return ''
  }
  const i18n = (oblast as { i18n?: unknown }).i18n
  if (i18n && typeof i18n === 'object') {
    const preklady = i18n as Record<string, unknown>
    for (const jazyk of ['cs', 'cz', 'en']) {
      const j = cistyText(jmeno(preklady[jazyk]), 120)
      if (j) return j
    }
    for (const v of Object.values(preklady)) {
      const j = cistyText(jmeno(v), 120)
      if (j) return j
    }
  }
  return cistyText(jmeno(oblast), 120)
}

function popisZalohy(zaloha: unknown): string {
  if (!zaloha || typeof zaloha !== 'object') return ''
  const z = zaloha as { amount?: unknown; paid?: unknown; reverted?: unknown }
  if (z.reverted === true) return 'Záloha v Choice: vrácená.'
  if (z.paid === true) return 'Záloha v Choice: zaplacená.'
  if (typeof z.amount === 'number' && z.amount > 0) return 'Záloha v Choice: požadovaná, zatím nezaplacená.'
  return ''
}

/**
 * Text, který se ukáže jako „poznámka hosta“: co napsal host (`comment`),
 * poznámka restaurace v Choice (`note`) a stav zálohy. Patří Choice —
 * každé načtení ho přepíše. Poznámky obsluhy ve Foodtabu jsou zvlášť.
 */
export function poznamkaZChoice(b: Record<string, unknown>): string {
  const casti: string[] = []
  const host = cistyText(b.comment, 2000)
  if (host) casti.push(host)
  const restaurace = cistyText(b.note, 3000)
  if (restaurace) casti.push(`Poznámka restaurace v Choice: ${restaurace}`)
  const zaloha = popisZalohy(b.deposit)
  if (zaloha) casti.push(zaloha)
  return casti.join('\n\n').slice(0, 4000)
}

export type DuvodPreskoceni = 'bez-id' | 'bez-casu' | 'bez-pasma' | 'neznamy-cas' | 'neplatny-cas' | 'jine'

export type VysledekRadku =
  | { stav: 'ok'; radek: RadekImportu }
  | { stav: 'chyba'; id: string; duvod: DuvodPreskoceni }

const DUVOD_CASU: Record<DuvodCasu, DuvodPreskoceni> = {
  chybi: 'bez-casu',
  'bez-pasma': 'bez-pasma',
  'neznamy-tvar': 'neznamy-cas',
  neplatny: 'neplatny-cas',
}

function pocetOsob(hodnota: unknown): number | null {
  const n = typeof hodnota === 'number' ? hodnota : typeof hodnota === 'string' && /^\d{1,5}$/.test(hodnota.trim()) ? Number(hodnota) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : null
}

/**
 * Jedna rezervace z Choice → řádek pro `public.rezervace_importovat_zdroj`.
 * Jde přes kontrakt (`RadekRezervace`) a týž převod jako každý adaptér
 * (`zRadkuZdroje`), takže platí stejná pravidla. `_id` je číslo
 * rezervace ze zdroje: totéž `_id` podruhé rezervaci upraví, nezdvojí.
 */
export function radekZChoice(rezervace: unknown, varSymbol: string): VysledekRadku {
  if (!rezervace || typeof rezervace !== 'object' || Array.isArray(rezervace)) return { stav: 'chyba', id: '', duvod: 'jine' }
  const b = rezervace as Record<string, unknown>
  const id = typeof b._id === 'string' ? b._id.trim() : ''
  if (!id || id.length > 200 || !/^[\x21-\x7e]+$/.test(id)) return { stav: 'chyba', id: '', duvod: 'bez-id' }

  const cas = casZChoice(b.dateTime)
  if (cas.stav === 'chyba') return { stav: 'chyba', id, duvod: DUVOD_CASU[cas.duvod] }

  const { stav, stavZdroje } = stavZChoice(b.status)
  const host = (b.customer && typeof b.customer === 'object' ? b.customer : {}) as Record<string, unknown>
  const radek: RadekRezervace = {
    externiId: id,
    stav,
    stavZdroje,
    pocetHostu: pocetOsob(b.personCount),
    cas: cas.okamzik,
    // Jednotka visitDuration není v dokumentaci — konec se nedomýšlí.
    konec: null,
    externiProvozovna: varSymbol,
    jmenoHosta: cistyText(host.name, 120) || null,
    telefonHosta: cistyText(host.phone, 40) || null,
    emailHosta: cistyText(host.email, 254) || null,
    poznamka: poznamkaZChoice(b),
    prostor: prostorZChoice(b.preferArea) || null,
    // Choice neposílá „změněno“. Tahá se vždy aktuální stav, takže pořadí
    // doručení tu nehraje roli (na rozdíl od webhooků).
    zmenenoKdy: null,
  }
  const prevod = zRadkuZdroje(radek)
  if (prevod.stav === 'chyba') return { stav: 'chyba', id, duvod: 'jine' }
  return { stav: 'ok', radek: prevod.radek }
}

/* ---------------------------------------------------------------------
 * Jeden běh načítání jednoho připojení
 * ------------------------------------------------------------------ */

/**
 * Kde načítání skončilo — `integrace_pripojeni.externi_ucet.kurzor`.
 *   * `nove_od`: odkud příště hledat nově vytvořené (createdDt),
 *   * `okno`: rozjeté procházení okna podle data rezervace — hranice
 *     okna se drží napevno, dokud se celé neprojde (jinak by se stránky
 *     mezi běhy posouvaly), `stranka` = další stránka,
 *   * `okno_hotovo_kdy`: kdy se okno naposled prošlo celé.
 */
export type KurzorChoice = {
  nove_od?: string
  okno?: { od: string; do: string; stranka: number; zahajeno: string }
  okno_hotovo_kdy?: string
}

const jeIso = (x: unknown): x is string => typeof x === 'string' && RE_OKAMZIK.test(x) && !Number.isNaN(Date.parse(x))

/** Kurzor z databáze; cokoli nečitelného se zahodí (začne se znovu — nic se tím nezdvojí). */
export function precistKurzor(x: unknown): KurzorChoice {
  const k: KurzorChoice = {}
  if (!x || typeof x !== 'object') return k
  const o = x as Record<string, unknown>
  if (jeIso(o.nove_od)) k.nove_od = o.nove_od
  if (jeIso(o.okno_hotovo_kdy)) k.okno_hotovo_kdy = o.okno_hotovo_kdy
  const okno = o.okno as Record<string, unknown> | undefined
  if (okno && jeIso(okno.od) && jeIso(okno.do) && jeIso(okno.zahajeno) && Number.isInteger(okno.stranka)
      && (okno.stranka as number) >= 1 && (okno.stranka as number) <= MAX_STRANKA) {
    k.okno = { od: okno.od, do: okno.do, stranka: okno.stranka as number, zahajeno: okno.zahajeno }
  }
  return k
}

export type SouhrnZapisu = { nove: number; zmenene: number; bezeZmeny: number; zastarale: number; odmitnute: { id: string; duvod: string }[] }
export type ZapisChoice = (radky: RadekImportu[]) => Promise<{ stav: 'ok'; souhrn: SouhrnZapisu } | { stav: 'chyba'; duvod: string }>

/** `cas` = došel čas běhu (pokračuje se příště, není to chyba). */
export type KonecBehu = 'hotovo' | 'cas' | 'limit' | 'pristup' | 'chyba'

export type VysledekBehuChoice = {
  konec: KonecBehu
  duvod: string | null
  kurzor: KurzorChoice
  dotazu: number
  /** Kolik stránek Choice opravdu vrátil (a zapsalo se). */
  uspesnych: number
  /** Kolik rezervací Choice poslal. */
  nacteno: number
  nove: number
  zmenene: number
  bezeZmeny: number
  /** Rezervace, které appka nezapsala (bez pásma, bez id…) — počet, důvody, jedno `_id` na ukázku. */
  preskocene: { pocet: number; priklad: string | null; duvody: Partial<Record<DuvodPreskoceni, number>> }
  /** Rezervace, které odmítla databáze (po jedné, zbytek dávky se zapsal). */
  odmitnute: { pocet: number; priklad: string | null }
  oknoDokonceno: boolean
}

/**
 * Jeden běh: tři průchody, každý po stránkách, dokud nepřijde neplná
 * stránka.
 *   1. „blízko“ (podle data rezervace, −12 h až +48 h) — dnešní storna
 *      a změny při každém běhu,
 *   2. „nové“ (podle vytvoření, od minulého běhu) — nové rezervace na
 *      jakýkoli den,
 *   3. „okno“ (podle data rezervace, od včerejška do +180 dní) — po
 *      kouscích přes víc běhů, pokračuje tam, kde minule skončil.
 *
 * PŘED KAŽDÝM DOTAZEM `pockatNaDotaz` (fronta v databázi, rozestup
 * `ROZESTUP_DOTAZU_MS`). Vrátí-li `false`, do času běhu se další dotaz
 * nevejde a běh končí (`cas`) — kurzor řekne příštímu, kde pokračovat.
 * 429 = konec běhu (`limit`), zkusí se příště. Stránka, kterou se
 * nepodařilo zapsat, kurzor neposune.
 */
export async function probehnoutChoice(v: {
  api: ApiChoice
  token: string
  varSymbol: string
  kurzor: KurzorChoice
  tedMs: number
  pockatNaDotaz: () => Promise<boolean>
  zapsat: ZapisChoice
}): Promise<VysledekBehuChoice> {
  const iso = (ms: number) => new Date(ms).toISOString()
  const kurzor: KurzorChoice = { ...v.kurzor }
  const vysledek: VysledekBehuChoice = {
    konec: 'hotovo',
    duvod: null,
    kurzor,
    dotazu: 0,
    uspesnych: 0,
    nacteno: 0,
    nove: 0,
    zmenene: 0,
    bezeZmeny: 0,
    preskocene: { pocet: 0, priklad: null, duvody: {} },
    odmitnute: { pocet: 0, priklad: null },
    oknoDokonceno: false,
  }

  type Pruchod = { podle: DotazSeznamu['podle']; od: string; do: string }

  const projit = async (p: Pruchod, odStranky: number, poStrance?: (dalsi: number) => void): Promise<KonecBehu> => {
    for (let stranka = odStranky; ; stranka++) {
      if (stranka > MAX_STRANKA) {
        vysledek.duvod = `V Choice je v jednom okně víc než ${MAX_STRANKA * NA_STRANKU} rezervací — načítání se zastavilo.`
        return 'chyba'
      }
      if (!(await v.pockatNaDotaz())) return 'cas'
      const r = await v.api.nacistStranku(v.token, { od: p.od, do: p.do, podle: p.podle, stranka, naStranku: NA_STRANKU })
      vysledek.dotazu += 1
      if (r.stav === 'chyba') {
        vysledek.duvod = r.duvod
        return r.druh === 'limit' ? 'limit' : r.druh === 'pristup' ? 'pristup' : 'chyba'
      }
      vysledek.nacteno += r.rezervace.length

      const radky: RadekImportu[] = []
      const videna = new Set<string>()
      for (const b of r.rezervace) {
        const x = radekZChoice(b, v.varSymbol)
        if (x.stav === 'ok') {
          if (!videna.has(x.radek.externi_id)) {
            videna.add(x.radek.externi_id)
            radky.push(x.radek)
          }
          continue
        }
        vysledek.preskocene.pocet += 1
        vysledek.preskocene.duvody[x.duvod] = (vysledek.preskocene.duvody[x.duvod] ?? 0) + 1
        if (!vysledek.preskocene.priklad && x.id) vysledek.preskocene.priklad = x.id
      }

      if (radky.length > 0) {
        const z = await v.zapsat(radky)
        if (z.stav === 'chyba') {
          vysledek.duvod = z.duvod
          return 'chyba'
        }
        vysledek.nove += z.souhrn.nove
        vysledek.zmenene += z.souhrn.zmenene
        vysledek.bezeZmeny += z.souhrn.bezeZmeny
        vysledek.odmitnute.pocet += z.souhrn.odmitnute.length
        if (!vysledek.odmitnute.priklad && z.souhrn.odmitnute[0]) vysledek.odmitnute.priklad = z.souhrn.odmitnute[0].id
      }

      vysledek.uspesnych += 1
      poStrance?.(stranka + 1)
      if (r.rezervace.length < NA_STRANKU) return 'hotovo'
    }
  }

  const konec = (k: KonecBehu): VysledekBehuChoice => {
    vysledek.konec = k
    vysledek.kurzor = kurzor
    return vysledek
  }

  // 1. Blízko
  let k = await projit({ podle: 'bookingDt', od: iso(v.tedMs - BLIZKO_ZPET_MS), do: iso(v.tedMs + BLIZKO_DOPREDU_MS) }, 1)
  if (k !== 'hotovo') return konec(k)

  // 2. Nové
  const noveOd = Math.max(kurzor.nove_od ? Date.parse(kurzor.nove_od) - NOVE_PREKRYV_MS : v.tedMs - DEN_MS, v.tedMs - NOVE_NEJDAL_MS)
  k = await projit({ podle: 'createdDt', od: iso(noveOd), do: iso(v.tedMs) }, 1)
  if (k !== 'hotovo') return konec(k)
  kurzor.nove_od = iso(v.tedMs)

  // 3. Okno
  if (!kurzor.okno || v.tedMs - Date.parse(kurzor.okno.zahajeno) > OKNO_ZASTARA_MS) {
    kurzor.okno = { od: iso(v.tedMs - OKNO_ZPET_MS), do: iso(v.tedMs + OKNO_DOPREDU_MS), stranka: 1, zahajeno: iso(v.tedMs) }
  }
  const okno = kurzor.okno
  k = await projit({ podle: 'bookingDt', od: okno.od, do: okno.do }, okno.stranka, (dalsi) => {
    kurzor.okno = { ...okno, stranka: dalsi }
  })
  if (k === 'hotovo') {
    delete kurzor.okno
    kurzor.okno_hotovo_kdy = iso(v.tedMs)
    vysledek.oknoDokonceno = true
  }
  return konec(k)
}

/* ---------------------------------------------------------------------
 * Co se ukáže u napojení
 * ------------------------------------------------------------------ */

const POPIS_PRESKOCENI: Record<DuvodPreskoceni, string> = {
  'bez-id': 'bez čísla rezervace',
  'bez-casu': 'bez času',
  'bez-pasma': 'čas bez časového pásma',
  'neznamy-cas': 'čas v neznámém tvaru',
  'neplatny-cas': 'neplatný čas',
  jine: 'nečitelná rezervace',
}

/**
 * Poslední chyba u napojení (vidí ji správce napojení). `null` = běh
 * proběhl bez výhrad. Došlý čas (`cas`) chyba není — příště se pokračuje.
 * Žádný token ani osobní údaj hosta, nanejvýš `_id` rezervace z Choice.
 */
export function chybaBehu(v: VysledekBehuChoice): string | null {
  const casti: string[] = []
  if (v.konec === 'limit') casti.push('Choice omezil počet dotazů (429) — načítání pokračuje při dalším běhu.')
  else if (v.konec === 'pristup') casti.push(`${v.duvod ?? 'Choice odmítl přístup.'} Připojte podnik znovu (Odpojit → Připojit podnik v Choice).`)
  else if (v.konec === 'chyba') casti.push(v.duvod ?? 'Načítání z Choice selhalo.')

  if (v.preskocene.pocet > 0) {
    const duvody = (Object.entries(v.preskocene.duvody) as [DuvodPreskoceni, number][])
      .map(([d, n]) => `${POPIS_PRESKOCENI[d]} ${n}×`)
      .join(', ')
    casti.push(`Nezapsalo se ${v.preskocene.pocet} rezervací z Choice (${duvody})${v.preskocene.priklad ? `, např. id ${v.preskocene.priklad}` : ''}.`)
  }
  if (v.odmitnute.pocet > 0) {
    casti.push(`Databáze odmítla ${v.odmitnute.pocet} rezervací z Choice${v.odmitnute.priklad ? `, např. id ${v.odmitnute.priklad}` : ''}.`)
  }
  return casti.length > 0 ? casti.join(' ').slice(0, 1000) : null
}
