/**
 * Komerční banka — „Přímý přístup k účtu" (ADAA, KB Business API v2).
 *
 * ROZHODNUTÍ ŠÉFÍKA (11. 10. 2026): Komerční banka napřímo přes ADAA,
 * bez agregátoru a bez licence (služba je pro podnikatele a jejich
 * vlastní/účetní systémy). Průzkum: docs/hlaseni/stav-2026-10-11-banka.md.
 *
 * VŠE NÍŽ JE PODLE OFICIÁLNÍ SPECIFIKACE, ne odhadem: OpenAPI 3.0
 * „Account Direct Access API" (developers.kb.cz/api/apis/AccountDirectAccessAPI-v2,
 * info.version 1.2) a její dokumentační stránky (Software Statements,
 * Application Registration – OAuth2, Tokens, Accounts, Balances,
 * Transactions), staženo 11. 10. 2026.
 *
 * Tok:
 *   0. JEDNOU ROČNĚ, mimo appku: majitel si stáhne „software statement"
 *      (JWT) — v sandboxu bez certifikátu, v produkci přes mTLS
 *      s kvalifikovanou pečetí (scripts/kb-software-statement.mjs).
 *      Appka ho má v `KB_ADAA_SOFTWARE_STATEMENT`.
 *   1. Registrace aplikace u klienta KB: prohlížeč jde na
 *      `client-registration-ui/v2/saml/register?registrationRequest=<base64 JSON>`,
 *      klient se přihlásí KB Klíčem a vybere účty. KB vrátí prohlížeč
 *      na `registrationBackUri` se `salt` a `encryptedData` — AES-256-GCM
 *      klíčem, který appka poslala v požadavku. Uvnitř `client_id`
 *      a `client_secret`.
 *   2. Autorizační kód (2 minuty) → `POST /oauth2/v3/access_token`
 *      (grant_type=authorization_code) → refresh token na 12 měsíců.
 *   3. Při každé synchronizaci refresh token → access token (3 minuty)
 *      → `/accounts`, `/accounts/{id}/transactions`, `/balances`.
 *
 * Hlavičky datových volání: `x-correlation-id` (UUID), `apiKey`,
 * `Authorization: Bearer`. API klíče jsou na portálu ZVLÁŠŤ pro každou
 * službu (OAuth2, ADAA) — proto dvě proměnné.
 *
 * Limit: stažení nezměněných transakcí nejvýš 1× za 61 minut —
 * HTTP 429 `REQUEST_IS_THROTTLED` s hlavičkou `Retry-After`. Poplatky
 * (MojeBanka Business): 50 využití měsíčně zdarma, počítá se po
 * „datových stránkách" (max 100 záznamů). Appka proto stahuje výchozí
 * 1× denně.
 *
 * Bez `server-only` schválně: síť jde podstrčit, takže
 * `scripts/kb-adaa.test.mjs` ověří tvar požadavků i výklad odpovědí bez
 * banky. Tajemství sem přicházejí parametrem, z prostředí se čte jen
 * v `konfiguraceKb()`.
 */

import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

import type { RadekImportu } from './finance-csv-import.ts'
import type { BodZustatku } from './bank-provider-contract.ts'

export type ProstrediKb = 'sandbox' | 'produkce'

/** Adresy podle dokumentace (sandbox / produkce). Žádná jiná se nevolá. */
export const ADRESY_KB: Readonly<Record<ProstrediKb, { registraceUi: string; autorizace: string; token: string; data: string }>> = {
  sandbox: {
    registraceUi: 'https://api-gateway.kb.cz/sandbox/client-registration-ui/v2/saml/register',
    autorizace: 'https://api-gateway.kb.cz/sandbox/oauth2-authorization-ui/v3/',
    token: 'https://api-gateway.kb.cz/sandbox/oauth2/v3/access_token',
    data: 'https://api-gateway.kb.cz/sandbox/adaa/v2',
  },
  produkce: {
    registraceUi: 'https://api-gateway.kb.cz/client-registration-ui/v2/saml/register',
    autorizace: 'https://login.kb.cz/autfe/ssologin',
    token: 'https://api-gateway.kb.cz/oauth2/v3/access_token',
    data: 'https://api-gateway.kb.cz/adaa/v2',
  },
}

/** Refresh token platí 12 měsíců; appka počítá s o den kratší dobou, ať varuje včas. */
export const PLATNOST_SOUHLASU_DNI = 364

/**
 * Do kdy platí souhlas: z `exp` v refresh tokenu (je to JWT, doporučení
 * KB „Frontend guide": platnost číst z tokenu). Když token `exp` nemá
 * nebo nejde přečíst, appka počítá 364 dní od teď.
 */
export function platnostSouhlasu(refreshToken: string, ted: Date = new Date()): string {
  try {
    const obsah = JSON.parse(Buffer.from(refreshToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown }
    if (typeof obsah.exp === 'number' && Number.isFinite(obsah.exp) && obsah.exp * 1000 > ted.getTime()) {
      return new Date(obsah.exp * 1000).toISOString().slice(0, 10)
    }
  } catch {
    // padá na výchozí odhad níž
  }
  return new Date(ted.getTime() + PLATNOST_SOUHLASU_DNI * 86_400_000).toISOString().slice(0, 10)
}

export type KonfiguraceKb = {
  prostredi: ProstrediKb
  softwareStatement: string
  apiKeyOauth: string
  apiKeyData: string
}

/** Konfigurace z prostředí; `null` = napojení na KB není nastavené (appka ho pak nenabízí). */
export function konfiguraceKb(env: Record<string, string | undefined> = process.env): KonfiguraceKb | null {
  const prostredi = env.KB_ADAA_PROSTREDI?.trim()
  const softwareStatement = env.KB_ADAA_SOFTWARE_STATEMENT?.trim()
  const apiKeyOauth = env.KB_ADAA_API_KEY_OAUTH?.trim()
  const apiKeyData = env.KB_ADAA_API_KEY_DATA?.trim()
  if ((prostredi !== 'sandbox' && prostredi !== 'produkce') || !softwareStatement || !apiKeyOauth || !apiKeyData) return null
  return { prostredi, softwareStatement, apiKeyOauth, apiKeyData }
}

/** Klíč AES-256 pro šifru registrace: 32 náhodných bajtů v base64 (44 znaků, jak chce dokumentace). */
export function novyKlicSifrovani(): string {
  return randomBytes(32).toString('base64')
}

/**
 * Adresa, na kterou appka pošle prohlížeč k registraci aplikace u KB.
 * `navratUri` musí být mezi `redirectUris` v software statementu —
 * použije se později pro autorizační kód. `state` KB vrátí beze změny.
 */
export function adresaRegistrace(konf: KonfiguraceKb, v: { klicSifrovani: string; navratUri: string; state: string }): string {
  const pozadavek = {
    clientName: 'Foodtab',
    clientNameEn: 'Foodtab',
    applicationType: 'web',
    redirectUris: [v.navratUri],
    // Jen čtení účtu. Platby (bpisp) appka nikdy nežádá — banka je výhradně pro čtení.
    scope: ['adaa'],
    encryptionKey: v.klicSifrovani,
    encryptionAlg: 'AES-256',
    softwareStatement: konf.softwareStatement,
  }
  const parametry = new URLSearchParams({
    registrationRequest: Buffer.from(JSON.stringify(pozadavek), 'utf8').toString('base64'),
    state: v.state,
  })
  return `${ADRESY_KB[konf.prostredi].registraceUi}?${parametry}`
}

/** `state` z rozšifrovaného JSON — KB ho podle ukázky vrací i uvnitř šifry, nejen v adrese. */
export type RegistraceKlienta = { clientId: string; clientSecret: string; state: string | null }

function zUrlBase64(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Rozšifruje `encryptedData` z návratu registrace: AES-256-GCM,
 * IV = `salt`, autentizační značka = posledních 16 bajtů šifry (Java
 * `AES/GCM/NoPadding`). Obojí v URL-safe base64. Podvržená nebo
 * poškozená data neprojdou autentizační značkou → `null`.
 */
export function rozsifrovatRegistraci(encryptedData: string, salt: string, klicSifrovani: string): RegistraceKlienta | null {
  try {
    const klic = Buffer.from(klicSifrovani, 'base64')
    if (klic.length !== 32) return null
    const iv = zUrlBase64(salt)
    const data = zUrlBase64(encryptedData)
    if (data.length <= 16 || iv.length === 0) return null
    const desifrator = createDecipheriv('aes-256-gcm', klic, iv)
    desifrator.setAuthTag(data.subarray(data.length - 16))
    const otevreny = Buffer.concat([desifrator.update(data.subarray(0, data.length - 16)), desifrator.final()]).toString('utf8')
    const json = JSON.parse(otevreny) as { client_id?: unknown; client_secret?: unknown; state?: unknown }
    if (typeof json.client_id !== 'string' || !json.client_id || typeof json.client_secret !== 'string' || !json.client_secret) return null
    return { clientId: json.client_id, clientSecret: json.client_secret, state: typeof json.state === 'string' && json.state ? json.state : null }
  } catch {
    return null
  }
}

/** Adresa pro autorizační kód (souhlas klienta s přístupem appky k účtům). */
export function adresaAutorizace(konf: KonfiguraceKb, v: { clientId: string; navratUri: string; state: string }): string {
  const parametry = new URLSearchParams({
    response_type: 'code',
    client_id: v.clientId,
    redirect_uri: v.navratUri,
    scope: 'adaa',
    state: v.state,
  })
  return `${ADRESY_KB[konf.prostredi].autorizace}?${parametry}`
}

// ---------------------------------------------------------------------
// Volání API
// ---------------------------------------------------------------------

/**
 * `pristup` — souhlas vypršel/odvolán, neplatný klient: potřebuje člověka.
 * `docasna` — KB teď neodpovídá nebo omezuje (429): příště znovu.
 * `jina` — chyba v požadavku nebo odpověď, které appka nerozumí.
 */
/**
 * `pristup` = souhlas/účet v KB (opraví firma), `zasah` = jinak
 * neřešitelné bez člověka (úloha to nemá zkoušet dokola za placená
 * stažení), `docasna` = příště znovu, `jina` = ostatní (příště znovu).
 */
export type ChybaKb = { stav: 'chyba'; druh: 'pristup' | 'zasah' | 'docasna' | 'jina'; duvod: string; zkusitZaSekund?: number }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const CASOVY_LIMIT_MS = 20_000
/**
 * Dokumentace: další stránku transakcí stáhnout do 10 s. Víc stránek než
 * tohle appka na jeden běh nečte — KB účtuje každou stránku (50 zdarma měsíčně).
 */
const MAX_STRANEK = 50
const MAX_HALERU = 2_147_483_647

function jeChyba<T extends object>(x: T | ChybaKb): x is ChybaKb {
  return (x as ChybaKb).stav === 'chyba'
}

/** Text chyby od KB (`{errors:[{code,message}]}`, OAuth `{error, error_description}`, brána `{code, message}`) — do hlášky jen kód a krátká zpráva. */
function zpravaKb(telo: unknown): string {
  const t = telo as { errors?: { code?: string; message?: string }[]; error?: string; error_description?: string; code?: string; message?: string } | null
  const prvni = t?.errors?.[0]
  const casti = [prvni?.code ?? t?.error ?? t?.code, prvni?.message ?? t?.error_description ?? t?.message].filter((x): x is string => typeof x === 'string' && x.length > 0)
  return casti.join(': ').slice(0, 200)
}

/** Kód chyby od KB velkými písmeny (`errors[0].code`, OAuth `error`, brána `code`), nebo prázdně. */
function kodKb(telo: unknown): string {
  const t = telo as { errors?: { code?: unknown }[]; error?: unknown; code?: unknown } | null
  const kod = t?.errors?.[0]?.code ?? t?.error ?? t?.code
  return typeof kod === 'string' || typeof kod === 'number' ? String(kod).toUpperCase() : ''
}

/**
 * 401/403, které opraví jen firma (souhlas, přiřazení účtu v MojeBanka
 * Business, aktivace služby) → „Vyžaduje pozornost". Ostatní 401/403
 * (špatný API klíč appky 900900/900901/900908, firewall KB
 * REJECTED_BY_FW, neznámé) jsou nastavení serveru nebo přechodné —
 * připojení zůstává a appka to zkouší dál, jinak by jedna chyba
 * nastavení vyřadila všechna připojení natrvalo.
 */
const KODY_PRISTUPU = new Set(['ACCOUNT_ACCESS_DENIED', 'ACCOUNT_NOT_CONFIGURED', 'NO_ACCOUNTS_CONFIGURED', 'ACCOUNT_IN_BLACKLIST', 'SERVICE_NOT_SUBSCRIBED', 'SERVICE_PLAN_INSUFFICIENT'])

async function pozadavek(fetchFn: Fetch, url: string, init: RequestInit): Promise<{ status: number; telo: unknown; hlavicky: Headers } | ChybaKb> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(CASOVY_LIMIT_MS) })
  } catch (e) {
    const proc = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'vypršel čas' : 'spojení selhalo'
    return { stav: 'chyba', druh: 'docasna', duvod: `Komerční banka neodpověděla (${proc}) — appka to zkusí příště.` }
  }
  const text = await odpoved.text().catch(() => '')
  let telo: unknown = null
  if (text) {
    try {
      telo = JSON.parse(text)
    } catch {
      telo = null
    }
  }
  return { status: odpoved.status, telo, hlavicky: odpoved.headers }
}

function chybaZeStavu(status: number, telo: unknown, hlavicky: Headers, coDelam: string): ChybaKb {
  const zprava = zpravaKb(telo)
  if (status === 429) {
    const za = Number(hlavicky.get('retry-after'))
    return {
      stav: 'chyba',
      druh: 'docasna',
      duvod: 'Komerční banka dovoluje stáhnout nezměněná data nejvýš jednou za 61 minut — appka to zkusí příště.',
      zkusitZaSekund: Number.isFinite(za) && za > 0 ? za : undefined,
    }
  }
  if ((status === 401 || status === 403) && KODY_PRISTUPU.has(kodKb(telo))) {
    return { stav: 'chyba', druh: 'pristup', duvod: `Komerční banka odmítla přístup k účtu při ${coDelam} (${zprava}). Zkontrolujte v MojeBanka Business přístup k účtu přes API, případně obnovte souhlas.` }
  }
  if (status === 401 || status === 403) {
    return { stav: 'chyba', druh: 'jina', duvod: `Komerční banka odmítla požadavek při ${coDelam}${zprava ? ` (${zprava})` : ` (HTTP ${status})`} — appka to zkusí příště; když to trvá, je potřeba zkontrolovat nastavení napojení (API klíče KB).` }
  }
  if (status >= 500) {
    return { stav: 'chyba', druh: 'docasna', duvod: `Komerční banka hlásí chybu na své straně (HTTP ${status}) — appka to zkusí příště.` }
  }
  return { stav: 'chyba', druh: 'jina', duvod: `Komerční banka odpověděla HTTP ${status} při ${coDelam}${zprava ? ` (${zprava})` : ''}.` }
}

function hlavickyKb(apiKey: string, dalsi: Record<string, string> = {}): Record<string, string> {
  return { 'x-correlation-id': randomUUID(), apiKey, Accept: 'application/json', ...dalsi }
}

async function tokenovyPozadavek(konf: KonfiguraceKb, fetchFn: Fetch, formular: Record<string, string>, coDelam: string): Promise<{ telo: Record<string, unknown> } | ChybaKb> {
  const odpoved = await pozadavek(fetchFn, ADRESY_KB[konf.prostredi].token, {
    method: 'POST',
    headers: hlavickyKb(konf.apiKeyOauth, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(formular).toString(),
  })
  if (jeChyba(odpoved)) return odpoved
  if (odpoved.status === 400 || odpoved.status === 401) {
    // OAuth 2 (RFC 6749 §5.2) — KB píše kód malými (`error`) i velkými
    // (`errors[0].code`: INVALID_GRANT). Obojí opraví jen člověk:
    // invalid_grant = kód/refresh token neplatí → obnovit souhlas;
    // invalid_client = KB registraci aplikace nezná → obnova souhlasu
    // nepomůže (běží na stejné registraci), jen nové připojení.
    const kod = kodKb(odpoved.telo)
    if (kod === 'INVALID_GRANT') {
      return { stav: 'chyba', druh: 'pristup', duvod: 'Souhlas v Komerční bance vypršel nebo byl odvolán (invalid_grant) — obnovte ho.' }
    }
    if (kod === 'INVALID_CLIENT') {
      return { stav: 'chyba', druh: 'pristup', duvod: 'Komerční banka už nezná registraci aplikace Foodtab u tohoto připojení (invalid_client) — připojení odpojte a připojte znovu.' }
    }
  }
  if (odpoved.status !== 200 && odpoved.status !== 201) return chybaZeStavu(odpoved.status, odpoved.telo, odpoved.hlavicky, coDelam)
  return { telo: (odpoved.telo ?? {}) as Record<string, unknown> }
}

/** Autorizační kód → refresh token (12 měsíců). `redirect_uri` musí být tatáž jako u žádosti o kód. */
export async function vymenitKod(
  konf: KonfiguraceKb,
  v: { kod: string; clientId: string; clientSecret: string; navratUri: string },
  fetchFn: Fetch = (u, i) => fetch(u, i),
): Promise<{ stav: 'ok'; refreshToken: string; accessToken: string | null } | ChybaKb> {
  const vysledek = await tokenovyPozadavek(konf, fetchFn, {
    redirect_uri: v.navratUri,
    code: v.kod,
    client_id: v.clientId,
    client_secret: v.clientSecret,
    grant_type: 'authorization_code',
  }, 'výměně autorizačního kódu')
  if (jeChyba(vysledek)) return vysledek
  const refreshToken = vysledek.telo.refresh_token
  if (typeof refreshToken !== 'string' || !refreshToken) return { stav: 'chyba', druh: 'jina', duvod: 'Komerční banka nevrátila refresh token.' }
  // Odpověď nese i access token (Tokens, „Response Refresh Token“) — ušetří další volání, KB časté žádosti trestá 429.
  const accessToken = typeof vysledek.telo.access_token === 'string' && vysledek.telo.access_token ? vysledek.telo.access_token : null
  return { stav: 'ok', refreshToken, accessToken }
}

/** Refresh token → access token (3 minuty). */
export async function ziskatAccessToken(
  konf: KonfiguraceKb,
  v: { clientId: string; clientSecret: string; refreshToken: string; navratUri: string },
  fetchFn: Fetch = (u, i) => fetch(u, i),
): Promise<{ stav: 'ok'; accessToken: string } | ChybaKb> {
  const vysledek = await tokenovyPozadavek(konf, fetchFn, {
    redirect_uri: v.navratUri,
    client_id: v.clientId,
    client_secret: v.clientSecret,
    refresh_token: v.refreshToken,
    grant_type: 'refresh_token',
  }, 'obnově přístupu')
  if (jeChyba(vysledek)) return vysledek
  const accessToken = vysledek.telo.access_token
  if (typeof accessToken !== 'string' || !accessToken) return { stav: 'chyba', druh: 'jina', duvod: 'Komerční banka nevrátila přístupový token.' }
  return { stav: 'ok', accessToken }
}

export type UcetKb = { accountId: string; iban: string; mena: string; nazev: string }

export function naparsovatUcty(telo: unknown): UcetKb[] | null {
  if (!Array.isArray(telo)) return null
  const ucty: UcetKb[] = []
  for (const u of telo as Record<string, unknown>[]) {
    if (!u || typeof u.accountId !== 'string' || !u.accountId) continue
    const iban = typeof u.iban === 'string' ? u.iban : ''
    const mena = typeof u.currency === 'string' ? u.currency.toUpperCase() : 'CZK'
    const nazev = [u.nameI18N, u.productI18N].find((x): x is string => typeof x === 'string' && x.trim().length > 0) ?? iban
    ucty.push({ accountId: u.accountId, iban, mena, nazev: nazev.trim() })
  }
  return ucty
}

export async function nactiUcty(konf: KonfiguraceKb, accessToken: string, fetchFn: Fetch = (u, i) => fetch(u, i)): Promise<{ stav: 'ok'; ucty: UcetKb[] } | ChybaKb> {
  const odpoved = await pozadavek(fetchFn, `${ADRESY_KB[konf.prostredi].data}/accounts`, {
    headers: hlavickyKb(konf.apiKeyData, { Authorization: `Bearer ${accessToken}` }),
  })
  if (jeChyba(odpoved)) return odpoved
  if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, odpoved.telo, odpoved.hlavicky, 'čtení účtů')
  const ucty = naparsovatUcty(odpoved.telo)
  if (!ucty) return { stav: 'chyba', druh: 'jina', duvod: 'Seznam účtů z Komerční banky má neočekávaný tvar.' }
  return { stav: 'ok', ucty }
}

function castka(hodnota: unknown): number | null {
  const n = typeof hodnota === 'number' ? hodnota : typeof hodnota === 'string' ? Number(hodnota) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Jedna transakce ADAA → řádek importu. `null` = nezapisovat:
 *   * jen zaúčtované (`status` BOOK). Blokace PDNG později zmizí a místo
 *     ní přijde BOOK se stejným `references.accountServicer`;
 *   * bez `references.accountServicer` — jediný identifikátor, který
 *     KB označuje za unikátní a stálý (entryReference podle KB unikátní
 *     NENÍ); bez něj by opakované stažení pohyb zdvojilo;
 *   * nulová částka (tabulka `transakce` ji nepřijme).
 * Částka je v dokumentaci kladná, směr nese `creditDebitIndicator`
 * (CREDIT/DEBIT) — appka bere absolutní hodnotu, ať ji případné
 * znaménko nepřeklopí dvakrát.
 */
export function prevestTransakci(t: Record<string, unknown>, menaUctu: string): RadekImportu | null {
  if (t.status !== 'BOOK') return null
  const reference = (t.references ?? {}) as Record<string, unknown>
  const identifikator = typeof reference.accountServicer === 'string' ? reference.accountServicer.trim() : ''
  if (!identifikator) return null
  // `accountServicer` spojuje životní cyklus platby; kdyby storno
  // (`reversalIndicator`) neslo týž identifikátor jako původní platba,
  // bez přípony by ho dedup zahodil a platba by zůstala „zaplacená".
  const externiId = t.reversalIndicator === true ? `${identifikator}:storno` : identifikator

  const smer = t.creditDebitIndicator === 'CREDIT' ? 'prijem' : t.creditDebitIndicator === 'DEBIT' ? 'vydaj' : null
  if (!smer) return null

  const amount = (t.amount ?? {}) as Record<string, unknown>
  const hodnota = castka(amount.value)
  if (hodnota === null) return null
  const castkaHaleru = Math.round(Math.abs(hodnota) * 100)
  // Sloupec `castka_haleru` je integer (do 21 474 836,47 Kč). Větší pohyb by
  // shodil zápis celého okna a stahování by se na něm zaseklo — vynechá se
  // (a započte do vynechaných, appka to u připojení ohlásí).
  if (castkaHaleru === 0 || castkaHaleru > MAX_HALERU) return null

  const datum = [t.bookingDate, t.valueDate].find((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d))
  if (!datum) return null

  const protistrana = (t.counterParty ?? {}) as Record<string, unknown>
  const ucetProtistrany = typeof protistrana.accountNo === 'string' && protistrana.accountNo
    ? `${protistrana.accountNo}${typeof protistrana.bankCode === 'string' && protistrana.bankCode ? `/${protistrana.bankCode}` : ''}`
    : typeof protistrana.iban === 'string' ? protistrana.iban : ''
  const jmeno = typeof protistrana.name === 'string' ? protistrana.name.trim() : ''

  const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const poznamka = [text(reference.receiver), text(reference.myDescription), text(t.additionalTransactionInformation)].filter(Boolean).join(' · ')

  return {
    datum: datum.slice(0, 10),
    smer,
    castkaHaleru,
    mena: (text(amount.currency) || menaUctu || 'CZK').toUpperCase(),
    protistrana: jmeno || ucetProtistrany,
    vs: text(reference.variable),
    poznamka: poznamka.slice(0, 500),
    externiId,
  }
}

/**
 * Pohyby za období `[od, do]` po stránkách (page od 0, size 100, dokud
 * `last` není true). Skončí dřív po `maxStranek` stránkách, nebo když
 * `stihnout()` vrátí false — pak `uplne: false`.
 *
 * Hlídá i pořadí: dokumentace KB píše „od starších k novějším" a na tom
 * stojí postup po částech (`stahnoutPohyby`) — proto se ověřuje na
 * datech (`vzestupne`), ne jen věří. Týž identifikátor dvakrát v jednom
 * stažení se zapíše jednou: dvojice by shodila zápis celé dávky na
 * unikátním indexu a stahování by se na ní zaseklo.
 */
export async function nactiTransakce(
  konf: KonfiguraceKb,
  v: { accessToken: string; accountId: string; menaUctu: string; od: Date; do: Date; maxStranek?: number; stihnout?: () => boolean },
  fetchFn: Fetch = (u, i) => fetch(u, i),
): Promise<{ stav: 'ok'; radky: RadekImportu[]; vynechano: number; stranek: number; uplne: boolean; vzestupne: boolean; posledniDatum: string | null } | ChybaKb> {
  const radky: RadekImportu[] = []
  const videne = new Set<string>()
  let vynechano = 0
  let stranek = 0
  let vzestupne = true
  let posledniDatum: string | null = null
  const hotovo = (uplne: boolean) => ({ stav: 'ok' as const, radky, vynechano, stranek, uplne, vzestupne, posledniDatum })
  for (let page = 0; page < (v.maxStranek ?? MAX_STRANEK); page++) {
    if (page > 0 && v.stihnout && !v.stihnout()) return hotovo(false)
    const parametry = new URLSearchParams({
      fromDateTime: v.od.toISOString(),
      toDateTime: v.do.toISOString(),
      page: String(page),
      size: '100',
    })
    const odpoved = await pozadavek(fetchFn, `${ADRESY_KB[konf.prostredi].data}/accounts/${encodeURIComponent(v.accountId)}/transactions?${parametry}`, {
      headers: hlavickyKb(konf.apiKeyData, { Authorization: `Bearer ${v.accessToken}` }),
    })
    if (jeChyba(odpoved)) return odpoved
    if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, odpoved.telo, odpoved.hlavicky, 'čtení pohybů')

    const stranka = odpoved.telo as { content?: unknown; last?: unknown } | null
    if (!stranka || !Array.isArray(stranka.content)) return { stav: 'chyba', druh: 'jina', duvod: 'Pohyby z Komerční banky mají neočekávaný tvar.' }
    stranek++
    for (const t of stranka.content as Record<string, unknown>[]) {
      if (!t || typeof t !== 'object') continue
      const radek = prevestTransakci(t, v.menaUctu)
      const klic = radek?.externiId ?? ''
      if (radek && !videne.has(klic)) {
        videne.add(klic)
        radky.push(radek)
      } else if (t.status === 'BOOK') {
        vynechano++
      }
      if (t.status === 'BOOK' && typeof t.bookingDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.bookingDate)) {
        const den = t.bookingDate.slice(0, 10)
        if (posledniDatum && den < posledniDatum) vzestupne = false
        posledniDatum = den
      }
    }
    if (stranka.last !== false) return hotovo(true)
  }
  return hotovo(false)
}

/**
 * Zůstatky: PREVIOUSLY_CLOSED_BOOK = účetní (knihovní), CLOSING_AVAILABLE
 * = disponibilní (dokumentace KB, stránka Balances — v GitHub wiki jsou
 * komentáře prohozené, portál je správně). CLOSING_BOOKED se použije
 * jako knihovní jen tehdy, když PREVIOUSLY_CLOSED_BOOK chybí. Znaménko
 * nese `creditDebitIndicator` (DEBIT = záporný zůstatek).
 */
export function prevestZustatky(telo: unknown, menaUctu: string): BodZustatku[] {
  if (!Array.isArray(telo)) return []
  const podleTypu = new Map<string, Record<string, unknown>>()
  for (const z of telo as Record<string, unknown>[]) if (z && typeof z.type === 'string') podleTypu.set(z.type, z)

  const bod = (z: Record<string, unknown> | undefined, typ: BodZustatku['typ']): BodZustatku | null => {
    if (!z) return null
    const amount = (z.amount ?? {}) as Record<string, unknown>
    const hodnota = castka(amount.value)
    if (hodnota === null || typeof z.validAt !== 'string') return null
    const znamenko = z.creditDebitIndicator === 'DEBIT' ? -1 : 1
    return {
      typ,
      castkaHaleru: znamenko * Math.round(Math.abs(hodnota) * 100),
      mena: (typeof amount.currency === 'string' && amount.currency ? amount.currency : menaUctu || 'CZK').toUpperCase(),
      platnyK: z.validAt,
    }
  }

  return [
    bod(podleTypu.get('PREVIOUSLY_CLOSED_BOOK') ?? podleTypu.get('CLOSING_BOOKED'), 'knihovni'),
    bod(podleTypu.get('CLOSING_AVAILABLE'), 'disponibilni'),
  ].filter((b): b is BodZustatku => b !== null)
}

export async function nactiZustatky(
  konf: KonfiguraceKb,
  v: { accessToken: string; accountId: string; menaUctu: string },
  fetchFn: Fetch = (u, i) => fetch(u, i),
): Promise<{ stav: 'ok'; zustatky: BodZustatku[] } | ChybaKb> {
  const odpoved = await pozadavek(fetchFn, `${ADRESY_KB[konf.prostredi].data}/accounts/${encodeURIComponent(v.accountId)}/balances`, {
    headers: hlavickyKb(konf.apiKeyData, { Authorization: `Bearer ${v.accessToken}` }),
  })
  if (jeChyba(odpoved)) return odpoved
  if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, odpoved.telo, odpoved.hlavicky, 'čtení zůstatku')
  return { stav: 'ok', zustatky: prevestZustatky(odpoved.telo, v.menaUctu) }
}

// ---------------------------------------------------------------------
// Uložení připojení a okno stahování (čisté, pro test)
// ---------------------------------------------------------------------

const PREKRYV_DNU = 7
const NEJSTARSI_DNU = 2 * 365 - 2
/**
 * Časový strop jednoho běhu: synchronizace běží i v akci stránky a v návratu
 * z KB (`maxDuration` 60 s) — po 25 s se další stránka nezačne, zbytek příště.
 */
const CAS_NA_BEH_MS = 25_000

export type ExterniUcetKb = {
  prostredi?: string
  client_id?: string
  navrat_uri?: string
  account_id?: string
  iban?: string
  mena?: string
  nazev_uctu?: string
  ucty?: { account_id: string; iban: string; mena: string; nazev: string }[]
  souhlas_do?: string
  historie_od?: string
  /** Náhodné id rozjetého pokusu o připojení — kontroluje se proti `state` z návratu z KB. */
  pokus?: string
  /** Kdy pokus začal (ISO) a z jaké stránky — pro návrat z registrace, když KB nevrátí `state`. */
  pokus_kdy?: string
  rozsah?: string
  /** Pohyby vybraného účtu jsou stažené kompletně až do tohoto okamžiku (ISO). */
  stazeno_do?: string
}

export type TajemstviKb = { client_id?: string; client_secret?: string; refresh_token?: string; klic_sifrovani?: string }

/**
 * Odkud stahovat — čistá funkce pro test. Od `stazenoDo` minus 7 dní
 * (dodatečně zaúčtované pohyby), napoprvé od `historie_od` (výchozí
 * 1. 1. letošního roku); nejvýš 2 roky zpátky, do teď.
 */
export function oknoStahovani(stazenoDo: string | null, historieOd: string | undefined, ted: Date): { od: Date; do: Date } {
  const nejstarsi = new Date(ted.getTime() - NEJSTARSI_DNU * 86_400_000)
  let od: Date
  if (stazenoDo) od = new Date(new Date(stazenoDo).getTime() - PREKRYV_DNU * 86_400_000)
  else od = historieOd ? new Date(`${historieOd}T00:00:00Z`) : new Date(Date.UTC(ted.getUTCFullYear(), 0, 1))
  if (Number.isNaN(od.getTime()) || od < nejstarsi) od = nejstarsi
  if (od > ted) od = new Date(ted.getTime() - PREKRYV_DNU * 86_400_000)
  return { od, do: ted }
}

/**
 * Je připojení na řadě v naplánované úloze? Počítá se od posledního
 * POKUSU (úspěšného i neúspěšného — `posledni_test_kdy`), ne jen od
 * úspěchu: jinak by trvalá chyba (třeba okno, které KB vrací pořád
 * stejně špatně) stahovala a platila totéž při každém spuštění úlohy
 * (à 4 h). U odstupu od 2 h tolerance 60 min — úloha běží à 4 h a čas
 * zápisu se posouvá o délku běhu; bez ní by „1× denně" často vyšlo na
 * 28 h a některý den by vypadl.
 */
export function kbJeNaCase(posledniSyncKdy: string | null, posledniTestKdy: string | null, intervalMinut: number | null, ted: Date): boolean {
  const casy = [posledniSyncKdy, posledniTestKdy].map((t) => (t ? new Date(t).getTime() : NaN)).filter((t) => Number.isFinite(t))
  if (casy.length === 0 || intervalMinut === null) return true
  const uplynuloMinut = (ted.getTime() - Math.max(...casy)) / 60_000
  const tolerance = intervalMinut >= 120 ? 60 : 0
  return uplynuloMinut >= intervalMinut - tolerance
}

/**
 * Stáhne pohyby od uloženého postupu do teď JEDNÍM stažením po stránkách.
 * Ne po kusech: KB dovoluje stáhnout nezměněná data jen jednou za 61
 * minut (429 REQUEST_IS_THROTTLED), takže druhý dotaz hned po prvním by
 * narazil a nejnovější platby by přišly poslední.
 *
 * Když stažení nedoběhne (strop `MAX_STRANEK` stránek nebo
 * `CAS_NA_BEH_MS`), uloží se, co přišlo, a postup se posune na začátek
 * dne posledního staženého pohybu — jen když KB opravdu vrací od
 * nejstarších (ověřeno na datech), jinak by se tiše přeskočilo, co ještě
 * nepřišlo. Příště se pokračuje odtud s překryvem 7 dní (duplicity hlídá
 * identifikátor). Když se postup posunout nedá, je to `zasah` — úloha
 * to nemá zkoušet dokola za placená stažení.
 * `ulozit(radky, null)` = zapsat bez posunu postupu.
 */
export async function stahnoutPohyby(
  konf: KonfiguraceKb,
  v: { accessToken: string; accountId: string; menaUctu: string; stazenoDo: string | null; historieOd?: string; ted: Date },
  ulozit: (radky: RadekImportu[], stazenoDo: Date | null) => Promise<ChybaKb | null>,
  fetchFn: Fetch = (u, i) => fetch(u, i),
  hodiny: () => number = () => Date.now(),
): Promise<{ stav: 'ok'; vynechano: number; stranek: number; dohnano: boolean } | ChybaKb> {
  const zacatek = hodiny()
  const okno = oknoStahovani(v.stazenoDo, v.historieOd, v.ted)
  const pohyby = await nactiTransakce(konf, {
    accessToken: v.accessToken,
    accountId: v.accountId,
    menaUctu: v.menaUctu,
    od: okno.od,
    do: okno.do,
    stihnout: () => hodiny() - zacatek < CAS_NA_BEH_MS,
  }, fetchFn)
  if (pohyby.stav === 'chyba') return pohyby
  const souhrn = { vynechano: pohyby.vynechano, stranek: pohyby.stranek }

  if (pohyby.uplne) {
    const chyba = await ulozit(pohyby.radky, okno.do)
    return chyba ?? { stav: 'ok', ...souhrn, dohnano: true }
  }

  const hranice = pohyby.vzestupne && pohyby.posledniDatum ? new Date(`${pohyby.posledniDatum}T00:00:00Z`) : null
  const posun = hranice !== null && hranice.getTime() - PREKRYV_DNU * 86_400_000 > okno.od.getTime()
  const chyba = await ulozit(pohyby.radky, posun ? hranice : null)
  if (chyba) return chyba
  if (posun) return { stav: 'ok', ...souhrn, dohnano: false }
  return {
    stav: 'chyba',
    druh: 'zasah',
    duvod: hranice
      ? `Za týden je v Komerční bance víc pohybů, než appka stáhne najednou (${MAX_STRANEK * 100}) — ozvěte se podpoře Foodtabu.`
      : 'Pohybů je na jedno stažení moc a Komerční banka je nevrátila seřazené — odpojte připojení a připojte ho znovu s kratším „Načíst pohyby od“.',
  }
}
