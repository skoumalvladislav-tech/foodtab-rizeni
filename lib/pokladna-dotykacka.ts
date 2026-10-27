/**
 * Dotykačka (Dotypos) API v2 — adaptér podle `lib/pos-provider-contract.ts`.
 *
 * Ověřeno v oficiální dokumentaci docs.api.dotypos.com (11. 10. 2026,
 * verze API 2026.37.0):
 *   * Přístup = refresh token + Cloud ID. Refresh token appka dostane
 *     z připojovací stránky (Connector v2, `POST admin.dotykacka.cz/client/connect/v2`
 *     — formulář v prohlížeči, ne REST; podpis = HMAC-SHA256 časového
 *     razítka klíčem `client_secret`, hex). Dotykačka po přihlášení
 *     vrátí na `redirect_uri` parametry `token`, `cloudid`, `state`.
 *   * `POST /v2/signin/token`, hlavička `Authorization: User <refresh>`,
 *     tělo JSON `{"_cloudId": <cloud>}` → 201 `{"accessToken": "…"}`,
 *     401 `{}`. Access token platí zhruba hodinu („není zaručeno") —
 *     appka si ho bere na každý běh znovu, nic necachuje.
 *   * `GET /v2/clouds/:cloudId/branches` — provozovny (stránkované,
 *     `limit` nejvýš 100, prázdný výsledek vrací 404).
 *   * `GET /v2/clouds/:cloudId/branches/:branchId/sales-report`
 *     (`dateFrom`/`dateTo` jako ISO s pásmem nebo epoch ms, `vatPayer`,
 *     `lang`) — „Base Sales Report", v něm `productSales[]` s `name`,
 *     `count`, `value`, `valueWithoutVAT`. Přesně denní souhrn po
 *     produktu, který `pokladna_prodeje_denni` drží. Ve stejné odpovědi
 *     je `revenue.paymentTypeInfo[]` (`typeId`, `count`, `total`) —
 *     platby po způsobu za totéž okno (`pokladna_platby_denni`, od 12. 10.).
 *     Čísla způsobů: api-reference/enums/payment-methods.
 *   * „Všechna čísla v odpovědi jsou řetězce" — appka bere číslo
 *     i číselný text.
 *   * 401/403 nesou pole `reason` (api-reference/general/common-error-responses).
 *     Neplatný token je jen část z nich — licence, zakázaná cesta nebo
 *     cloud se opravují jinak, viz `chybaZeStavu`.
 *   * GET bez shody vrací 404 („did not find any entity matching the
 *     filter") — u přehledu tržeb = den bez prodejů (`prazdne`).
 *
 * CO APPKA ODVODILA, NE OVĚŘILA (dokumentace to výslovně neříká):
 *   * `value` je tržba S DPH — vedle je `valueWithoutVAT`. Ověří se
 *     prvním živým porovnáním s denní uzávěrkou v Dotykačce.
 *   * `vatPayer=true` — obě provozovny jsou plátci DPH. Neplátce by
 *     potřeboval přepínač u připojení; zatím není.
 *   * `dateTo` se bere jako konec okna (začátek dalšího provozního dne).
 *     Kdyby Dotykačka brala konec včetně, započítala by se navíc jen
 *     účtenka přesně v 05:00:00.000.
 *   * `paymentTypeInfo[].typeId` jsou id z výčtu platebních metod
 *     a `total` je částka v hlavní měně (vedle je `rawTotal`). Ověří se
 *     prvním živým porovnáním s uzávěrkou (hotovost/karta).
 *
 * JINÉ PLATBY (16. 10. 2026, dokumentace verze API 2026.38.2): relace
 * navíc umí katalog produktů, účty provozovny a účet podle externího klíče
 * — `lib/pokladna-dotykacka-sklad.ts` (`cteniDotykacky`), tam jsou i odkazy
 * na stránky dokumentace. Napsané podle dokumentace, ŽIVĚ NEOVĚŘENÉ.
 * Skladový výdej přes POS akci je napsaný a k relaci se připojí jen pro
 * provozovny z `ZAPIS_VYDEJE_DOTYKACKA` (lib/pokladna-dotykacka-zapis.ts).
 * Ten seznam je prázdný, takže `skladovyVydej: 'rucne'` a relace žádnou
 * metodu zápisu nemá (viz schopnosti níž).
 *
 * Bez `server-only` schválně: síťové volání jde podstrčit (`vytvoritDotykacku(fetchFn)`),
 * takže `scripts/pokladna-dotykacka.test.mjs` ověří tvar požadavků
 * i výklad odpovědí bez sítě. Žádné tajemství z prostředí tu není —
 * údaje přicházejí jako parametr, rozšifrované synchronizací.
 */

import { createHmac } from 'node:crypto'

import type { ChybaPos, DruhPlatby, PosProvider, ProvozovnaPos, RadekPlatby, RadekProdeje, RelacePos, UdajePos } from './pos-provider-contract.ts'
import { cteniDotykacky, zapisVydejeDotykacka, type KontextDotykacky, type OdpovedDotykacky } from './pokladna-dotykacka-sklad.ts'
import { povoleneProvozovny, ZAPIS_VYDEJE_DOTYKACKA, type PovolenyZapis } from './pokladna-dotykacka-zapis.ts'

export const API_DOTYKACKA = 'https://api.dotykacka.cz/v2'
export const CONNECTOR_DOTYKACKA = 'https://admin.dotykacka.cz/client/connect/v2'

const CASOVY_LIMIT_MS = 20_000
const MAX_STRAN_PROVOZOVEN = 10

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Podpis pro Connector v2: HMAC-SHA256 časového razítka (sekundy, jako text), klíč `client_secret`, 64 hex znaků. */
export function podpisConnectoru(casoveRazitkoS: number, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(String(casoveRazitkoS)).digest('hex')
}

/**
 * Pole formuláře, který prohlížeč odešle na `CONNECTOR_DOTYKACKA`.
 * Razítko musí sedět na ±1 minutu — stránka ho proto počítá při
 * vykreslení a formulář se odešle hned.
 */
export function parametryConnectoru(v: { clientId: string; clientSecret: string; redirectUri: string; state: string; tedMs: number }): Record<string, string> {
  const razitko = Math.floor(v.tedMs / 1000)
  return {
    client_id: v.clientId,
    timestamp: String(razitko),
    signature: podpisConnectoru(razitko, v.clientSecret),
    // „must be `*`, the only supported value"
    scope: '*',
    redirect_uri: v.redirectUri,
    state: v.state,
  }
}

function cislo(hodnota: unknown): number | null {
  if (typeof hodnota === 'number') return Number.isFinite(hodnota) ? hodnota : null
  if (typeof hodnota === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(hodnota.trim())) return Number(hodnota.trim())
  return null
}

function pravda(hodnota: unknown): boolean {
  return hodnota === true || hodnota === 'true' || hodnota === 1 || hodnota === '1'
}

/**
 * Způsoby platby Dotykačky (api-reference/enums/payment-methods, 12. 10.
 * 2026: 31 hodnot). Název česky, `druh` = skupina v přehledu tržeb.
 * Dokumentace výslovně říká, že výčet není úplný — neznámé id dostane
 * „Jiný způsob (č. …)" a druh `jine`, nezahodí se.
 */
export const ZPUSOBY_PLATBY_DOTYKACKY: Readonly<Record<string, { nazev: string; druh: DruhPlatby }>> = {
  '900000001': { nazev: 'Hotovost', druh: 'hotovost' },
  '900000002': { nazev: 'Platební karta', druh: 'karta' },
  '900000003': { nazev: 'Šek', druh: 'jine' },
  '900000004': { nazev: 'Stravenky', druh: 'stravenky' },
  '900000009': { nazev: 'Bankovní převod', druh: 'prevod' },
  '900000010': { nazev: 'Elektronické stravenky', druh: 'stravenky' },
  '900000011': { nazev: 'Dárkový poukaz', druh: 'poukaz' },
  '900000012': { nazev: 'Odpis', druh: 'odpis' },
  '900000014': { nazev: 'SumUp', druh: 'karta' },
  '900000016': { nazev: 'Uber Eats', druh: 'rozvoz' },
  '900000017': { nazev: 'Vyzvednisi Online', druh: 'online' },
  '900000018': { nazev: 'QR platba', druh: 'prevod' },
  '900000019': { nazev: 'Online platba', druh: 'online' },
  '900000020': { nazev: 'Na pokoj', druh: 'jine' },
  '900000021': { nazev: 'Platební automat', druh: 'hotovost' },
  '900000022': { nazev: 'MultiSport', druh: 'stravenky' },
  '901000001': { nazev: 'Qerko', druh: 'online' },
  '901000002': { nazev: 'Corrency', druh: 'jine' },
  '901000003': { nazev: 'Bolt Food', druh: 'rozvoz' },
  '901000004': { nazev: 'Wolt', druh: 'rozvoz' },
  '901000005': { nazev: 'Speedlo', druh: 'rozvoz' },
  '901000006': { nazev: 'Choice QR', druh: 'online' },
  '901000007': { nazev: 'Previo', druh: 'jine' },
  '901000008': { nazev: 'Foodora', druh: 'rozvoz' },
  '901000009': { nazev: 'Foodora (hotově)', druh: 'rozvoz' },
  '901000010': { nazev: 'Slevomat', druh: 'poukaz' },
  '901000011': { nazev: 'Zľavomat', druh: 'poukaz' },
  '901000012': { nazev: 'Pyszne', druh: 'rozvoz' },
  '901000013': { nazev: 'Glovo', druh: 'rozvoz' },
  '901000014': { nazev: 'Apetigo', druh: 'rozvoz' },
  '901000015': { nazev: 'Bistro.sk', druh: 'rozvoz' },
}

/**
 * „Base Sales Report" → platby po způsobu (`revenue.paymentTypeInfo[]`
 * s `typeId`, `count`, `total`). Stejný způsob dvakrát se sečte.
 *
 * Dotykačka platby posílá vždycky, takže chybějící rozpad (bez `revenue`
 * nebo `paymentTypeInfo`) i jediná nečitelná položka znamenají „nerozumím"
 * (`necitelne`) a výsledek je PRÁZDNÝ seznam — synchronizace platby dne
 * smaže a ohlásí to. Kdyby je nechala, dnešek by zůstal zamrzlý na
 * snímku z dřívějšího běhu a v přehledu by vypadal jako celý.
 *
 * Vratka může u jednoho způsobu převážit: záporná částka i záporný počet
 * projdou, počet plateb se na konci ořízne na nulu (je jen informativní,
 * databáze záporný nepřijme).
 */
export function naparsovatPlatby(telo: unknown): { platby: RadekPlatby[]; necitelne: boolean } {
  const info = (telo as { revenue?: { paymentTypeInfo?: unknown } | null } | null)?.revenue?.paymentTypeInfo
  if (!Array.isArray(info)) return { platby: [], necitelne: true }

  const podleZpusobu = new Map<string, RadekPlatby>()
  for (const p of info as Record<string, unknown>[]) {
    const id = cislo(p?.typeId)
    const castka = cislo(p?.total)
    const pocet = p?.count === undefined || p?.count === null ? 0 : cislo(p.count)
    if (id === null || !Number.isSafeInteger(id) || id < 0 || castka === null || pocet === null) return { platby: [], necitelne: true }
    const zpusob = String(id)
    const znamy = ZPUSOBY_PLATBY_DOTYKACKY[zpusob]
    const radek = podleZpusobu.get(zpusob) ?? {
      zpusob,
      nazev: znamy?.nazev ?? `Jiný způsob (č. ${zpusob})`,
      druh: znamy?.druh ?? 'jine',
      pocet: 0,
      castkaHaleru: 0,
    }
    radek.pocet += Math.round(pocet)
    radek.castkaHaleru += Math.round(castka * 100)
    podleZpusobu.set(zpusob, radek)
  }
  return { platby: [...podleZpusobu.values()].map((r) => ({ ...r, pocet: Math.max(0, r.pocet) })), necitelne: false }
}

/** Stránka `GET …/branches` → provozovny; smazané vynechá. `null` = tvar, kterému appka nerozumí. */
export function naparsovatProvozovny(telo: unknown): ProvozovnaPos[] | null {
  const data = Array.isArray(telo) ? telo : (telo as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return null

  const provozovny: ProvozovnaPos[] = []
  for (const b of data as Record<string, unknown>[]) {
    if (!b || typeof b !== 'object') continue
    if (b.id === undefined || b.id === null || b.id === '') continue
    if (pravda(b.deleted)) continue
    const nazev = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `Provozovna ${String(b.id)}`
    provozovny.push({ externiId: String(b.id), nazev })
  }
  return provozovny
}

/**
 * „Base Sales Report" → prodej po produktech. Stejný název dvakrát
 * (dva produkty, jedno jméno) se sečte — v `pokladna_prodeje_denni`
 * je produkt v jednom dni jen jednou. Haléře se sčítají celé, ne
 * koruny jako desetinná čísla. Položka bez názvu/čísel nebo se záporným
 * součtem (vratky převážily prodej) se nezapíše, ale započítá do
 * `vynechano` — tabulka záporné množství ani tržbu nepřijme.
 */
export function naparsovatReport(telo: unknown): { radky: RadekProdeje[]; vynechano: number } | null {
  const polozky = (telo as { productSales?: unknown } | null)?.productSales
  if (!Array.isArray(polozky)) return null

  const podleNazvu = new Map<string, { mnozstvi: number; trzbaHaleru: number }>()
  let vynechano = 0

  for (const p of polozky as Record<string, unknown>[]) {
    const jmeno = typeof p?.name === 'string' ? p.name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : ''
    const nazev = jmeno || (p?.id !== undefined && p?.id !== null ? `Produkt ${String(p.id)}` : '')
    const mnozstvi = cislo(p?.count)
    const hodnota = cislo(p?.value)
    if (!nazev || mnozstvi === null || hodnota === null) {
      vynechano++
      continue
    }
    const soucet = podleNazvu.get(nazev) ?? { mnozstvi: 0, trzbaHaleru: 0 }
    soucet.mnozstvi += mnozstvi
    soucet.trzbaHaleru += Math.round(hodnota * 100)
    podleNazvu.set(nazev, soucet)
  }

  const radky: RadekProdeje[] = []
  for (const [produktNazev, s] of podleNazvu) {
    // Součet desetinných množství (0,3 kg + 0,6 kg) zaokrouhlený na tisíciny — bez šumu 0.8999999.
    const mnozstvi = Math.round(s.mnozstvi * 1000) / 1000
    if (mnozstvi < 0 || s.trzbaHaleru < 0) {
      vynechano++
      continue
    }
    radky.push({ produktNazev, mnozstvi, trzbaHaleru: s.trzbaHaleru })
  }
  return { radky, vynechano }
}

/** `reason` z 401/403 (velká písmena a podtržítka) — do hlášky jen tohle, text odpovědi ne. */
export function duvodOdmitnuti(telo: unknown): string {
  const r = (telo as { reason?: unknown } | null)?.reason
  return typeof r === 'string' && /^[A-Z_]{1,40}$/.test(r.trim().toUpperCase()) ? r.trim().toUpperCase() : ''
}

/** Neplatný nebo odebraný refresh token — opraví jen nové přihlášení. */
const DUVODY_TOKENU = new Set(['INVALID_AUTH_HEADER', 'INVALID_REFRESH_TOKEN', 'UNAUTHORIZED'])
/** Krátký přístupový token — appka si příště vezme nový sama. */
const DUVODY_DOCASNE = new Set(['INVALID_ACCESS_TOKEN', 'ACCESS_TOKEN_EXPIRED'])

/**
 * 401/403 podle `reason`: jen neplatný token (nebo chybějící důvod)
 * je `pristup` — připojení pak čeká na nové přihlášení. Licence,
 * zakázaná cesta nebo interní chyba Dotykačky token neopraví; kdyby se
 * hlásily jako „vložte nový token", člověk by se přihlašoval dokola.
 */
function chybaZeStavu(status: number, coDelam: string, telo: unknown = null): ChybaPos {
  if (status === 401 || status === 403) {
    const duvod = duvodOdmitnuti(telo)
    if (DUVODY_DOCASNE.has(duvod)) {
      return { stav: 'chyba', druh: 'docasna', celoplosna: true, duvod: `Dotykačka odmítla krátkodobý přístupový token (${duvod}) — appka se příště přihlásí znovu.` }
    }
    if (duvod === 'CLOUD_FORBIDDEN') {
      return { stav: 'chyba', druh: 'pristup', duvod: 'Dotykačka už appce nepovoluje přístup k tomuto cloudu (CLOUD_FORBIDDEN) — přihlaste se přes Dotykačku znovu.' }
    }
    if (duvod === 'LICENSE_UPGRADE_REQUIRED') {
      return { stav: 'chyba', druh: 'jina', duvod: `Dotykačka odmítla ${coDelam}: vyžaduje vyšší licenci (LICENSE_UPGRADE_REQUIRED). Token je v pořádku — obraťte se na podporu Dotykačky.` }
    }
    if (duvod && !DUVODY_TOKENU.has(duvod)) {
      return { stav: 'chyba', druh: 'jina', duvod: `Dotykačka odmítla ${coDelam} (${duvod}). Nejde o neplatný token — obraťte se na podporu Dotykačky.` }
    }
    return { stav: 'chyba', druh: 'pristup', duvod: 'Dotykačka odmítla přístup — token je neplatný, vypršel, nebo byl v Dotykačce odebrán. Přihlaste se znovu.' }
  }
  if (status === 429) {
    return { stav: 'chyba', druh: 'docasna', celoplosna: true, duvod: 'Dotykačka teď odmítá další dotazy (příliš mnoho najednou) — appka to zkusí při příští synchronizaci.' }
  }
  if (status >= 500) {
    return { stav: 'chyba', druh: 'docasna', duvod: `Dotykačka hlásí chybu na své straně (HTTP ${status}) — appka to zkusí příště.` }
  }
  return { stav: 'chyba', druh: 'jina', duvod: `Dotykačka odpověděla HTTP ${status} při ${coDelam}.` }
}

const jeCislice = (c: number) => c >= 0x30 && c <= 0x39

/**
 * Celá čísla o 16 a víc číslicích MIMO řetězce → text v uvozovkách.
 * Jeden průchod znak po znaku (bez regulárního výrazu — ten u obřích
 * řetězců přetekl zásobník a u neuzavřených se zpomaloval kvadraticky):
 * řetězce se přeskočí celé i s escapy, číslo se přečte celé jako token
 * (`-?číslice[.číslice][e±číslice]`), takže kus desetinného čísla ani
 * exponent se nikdy nebere zvlášť. Desetinná čísla a exponenty zůstávají.
 */
export function chranitDlouhaCisla(text: string): string {
  const n = text.length
  let vysledek = ''
  let od = 0
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 0x22) {
      // Řetězec až po neescapovanou uvozovku (neuzavřený do konce textu).
      i++
      while (i < n) {
        const d = text.charCodeAt(i)
        if (d === 0x5c) i += 2
        else if (d === 0x22) {
          i++
          break
        } else i++
      }
      continue
    }
    if (c === 0x2d || jeCislice(c)) {
      const zacatek = i
      if (c === 0x2d) i++
      const prvniCislice = i
      while (i < n && jeCislice(text.charCodeAt(i))) i++
      const cislic = i - prvniCislice
      let cele = true
      if (i < n && text.charCodeAt(i) === 0x2e) {
        cele = false
        i++
        while (i < n && jeCislice(text.charCodeAt(i))) i++
      }
      if (i < n && (text.charCodeAt(i) | 0x20) === 0x65) {
        cele = false
        i++
        if (i < n && (text.charCodeAt(i) === 0x2b || text.charCodeAt(i) === 0x2d)) i++
        while (i < n && jeCislice(text.charCodeAt(i))) i++
      }
      if (cele && cislic >= 16) {
        vysledek += `${text.slice(od, zacatek)}"${text.slice(zacatek, i)}"`
        od = i
      }
      continue
    }
    i++
  }
  return od === 0 ? text : vysledek + text.slice(od)
}

/**
 * Tělo odpovědi → JSON. `undefined` = JSON to není ani po opravách.
 *
 * Dokumentace slibuje čísla jako řetězce (api-reference/general/data-types),
 * ale id jsou typu `long` (entity/product). Kdyby přišlo jako číslo nad
 * 2^53, `JSON.parse` by ho tiše zaokrouhlil a produkt by dostal cizí id —
 * proto se dlouhá celá čísla před čtením převedou na text. Druhý pokus
 * (jen když první selže) nahradí řídicí znaky mezerou: v textu produktu
 * (popis, `recipe` až 8 192 znaků) by syrový tabulátor nebo konec řádku
 * shodil celou stránku katalogu. Mimo řetězce je mezera jen jiná mezera.
 * Úvodní BOM se zahodí. Výjimku nevyhodí nikdy.
 */
export function naparsovatJson(text: string): unknown {
  const bezBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let chranene = bezBom
  try {
    chranene = chranitDlouhaCisla(bezBom)
  } catch {
    // (jen pro jistotu — průchod sám nevyhazuje) čte se bez ochrany
  }
  try {
    return JSON.parse(chranene)
  } catch {
    // zkusí se ještě s opravou řídicích znaků
  }
  try {
    return JSON.parse(chranene.replace(/[\u0000-\u001f]/g, ' '))
  } catch {
    return undefined
  }
}

/** Druh znaku do hlášky — jen druh, ne znak sám. */
function druhZnaku(z: string): string {
  if (z === '') return 'konec'
  const c = z.charCodeAt(0)
  if (c < 0x20 || c === 0x7f) return 'řídicí znak'
  if (z === '\\') return 'zpětné lomítko'
  if (z === '"') return 'uvozovka'
  if (/\p{L}/u.test(z)) return 'písmeno'
  if (/\d/.test(z)) return 'číslice'
  return 'jiný znak'
}

/**
 * Vlastní text V8 s pozicí — „… in JSON at position N (line L column C)",
 * u nadbytečného znaku za koncem „… after JSON at position N (…)" —
 * ukotvený na konec hlášky.
 */
const POZICE_V8 = / (?:in|after) JSON at position (\d+)(?: \(line \d+ column \d+\))?$/
const KONEC_V8 = /^Unexpected end of JSON input$/

/**
 * Kde `JSON.parse` nad tělem skončil: pozice z hlášky V8 (jen číslo)
 * a druh znaku na ní, v souřadnicích PŮVODNÍHO textu (i s BOM).
 * `uriznuto` = čtení skončilo až za posledním znakem (uříznuté tělo) —
 * ne „na posledním znaku", tam je nadbytečný znak za koncem JSON.
 *
 * Hlášky V8 bez pozice („Unexpected token …, "<úryvek těla>" is not valid
 * JSON") nesou úryvek TĚLA — z nich se nebere nic: číslo nebo „end of JSON
 * input" uvnitř úryvku by byla hodnota z odpovědi vydávaná za pozici.
 */
export function chybaJson(text: string): { pozice: number | null; znakNaPozici: string | null; uriznuto: boolean } {
  const posun = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const bezBom = text.slice(posun)
  try {
    JSON.parse(bezBom.replace(/[\u0000-\u001f]/g, ' '))
    return { pozice: null, znakNaPozici: null, uriznuto: false }
  } catch (e) {
    const zprava = e instanceof Error ? e.message : ''
    if (KONEC_V8.test(zprava)) return { pozice: text.length, znakNaPozici: 'konec', uriznuto: true }
    const m = POZICE_V8.exec(zprava)
    if (!m) return { pozice: null, znakNaPozici: null, uriznuto: false }
    const pozice = Number(m[1])
    if (pozice >= bezBom.length) return { pozice: text.length, znakNaPozici: 'konec', uriznuto: true }
    return { pozice: pozice + posun, znakNaPozici: druhZnaku(bezBom.charAt(pozice)), uriznuto: false }
  }
}

/** První viditelný znak těla pro hlášku — jeden znak nic neprozradí, a „<" znamená HTML místo JSON. `null` = jiný znak. */
function prvniZnak(text: string): string | null {
  const z = text.trimStart().charAt(0)
  return /^[\p{L}\p{N}<>{}[\]"]$/u.test(z) ? z : null
}

/**
 * Jedno volání: buď stav a rozparsované tělo (null, když přišlo prázdné —
 * `prazdne` — nebo to není JSON — pak `nejson` řekne délku, první znak
 * a kde čtení skončilo), nebo chyba sítě. Text odpovědi do hlášek nejde.
 */
async function pozadavek(fetchFn: Fetch, url: string, init: RequestInit, casovyLimitMs: number = CASOVY_LIMIT_MS): Promise<OdpovedDotykacky | ChybaPos> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(casovyLimitMs) })
  } catch (e) {
    const proc = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'vypršel čas' : 'spojení selhalo'
    return { stav: 'chyba', druh: 'docasna', duvod: `Dotykačka neodpověděla (${proc}) — appka to zkusí příště.` }
  }

  // Přerušené čtení těla (spojení spadlo, vypršel čas) u ÚSPĚCHU (2xx) NENÍ prázdná
  // odpověď — dřív z něj byl „neočekávaný tvar" a dočasná chyba vypadala jako trvalá.
  // U jiného stavu rozhoduje stav sám jako dřív (POS akce: 401/403 = k pokladně
  // nedošlo; z „neodpověděla" by se stalo nejasné).
  let text: string
  try {
    text = await odpoved.text()
  } catch (e) {
    if (odpoved.status < 200 || odpoved.status > 299) return { status: odpoved.status, telo: null }
    const proc = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'vypršel čas' : 'spojení se přerušilo'
    return { stav: 'chyba', druh: 'docasna', duvod: `Dotykačka neposlala celou odpověď (${proc}) — appka to zkusí příště.` }
  }
  if (!text.trim()) return { status: odpoved.status, telo: null, prazdne: true }
  const telo = naparsovatJson(text)
  if (telo === undefined) return { status: odpoved.status, telo: null, nejson: { znaku: text.length, zacina: prvniZnak(text), ...chybaJson(text) } }
  return { status: odpoved.status, telo }
}

function jeChyba(x: OdpovedDotykacky | ChybaPos): x is ChybaPos {
  return 'stav' in x
}

/**
 * Přihlášená relace pro Jiné platby (`lib/pokladna-dotykacka-sklad.ts`) —
 * stejné volání i výklad chyb jako u tržeb. Staví ho `otevrit()` níž;
 * exportované jen kvůli testu nepřipojeného výdeje (`odeslatVydejDotykacka`).
 */
export function kontextDotykacky(fetchFn: Fetch, cloudId: string, accessToken: string): KontextDotykacky {
  return {
    api: API_DOTYKACKA,
    cloudId,
    hlavicky: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    pozadavek: (url, init, casovyLimitMs) => pozadavek(fetchFn, url, init, casovyLimitMs),
    chybaZeStavu,
  }
}

/**
 * `povoleno` jde podstrčit jen kvůli testu zapnutého zápisu
 * (`scripts/pokladna-dotykacka-sklad.test.mjs`); appka volá
 * `vytvoritDotykacku()` vždy s výchozím `ZAPIS_VYDEJE_DOTYKACKA`
 * (lib/pokladna-adaptery.ts).
 */
export function vytvoritDotykacku(fetchFn: Fetch = (url, init) => fetch(url, init), povoleno: readonly PovolenyZapis[] = ZAPIS_VYDEJE_DOTYKACKA): PosProvider {
  return {
    klic: 'dotykacka',
    schopnosti: {
      urovenDat: 'denni_souhrn',
      // Dotykačka webhooky má (others/webhook), appka je zatím nepoužívá — stahuje každou hodinu.
      webhooky: false,
      historieDnu: null,
      platebniMetody: true,
      // ČTENÍ skladových pohybů appka z Dotykačky nebere.
      poskytujeSkladovePohyby: false,
      // Katalog a účty podle dokumentace (2026.38.2), ŽIVĚ NEOVĚŘENO — lib/pokladna-dotykacka-sklad.ts.
      katalog: true,
      dohledaniUctu: true,
      // Výdej přes POS akci (`odeslatVydejDotykacka`) se připojí jen pro
      // provozovny ze seznamu `povoleno` (ZAPIS_VYDEJE_DOTYKACKA — prázdný):
      // až po ověření na testovacím cloudu Dotykačky a výslovném pokynu
      // Šéfíka (lib/pokladna-dotykacka-zapis.ts). Do té doby výdej dělá
      // člověk v pokladně. 'api' tu znamená jen „některý cloud ho smí";
      // jestli smí TAHLE provozovna, říká relace (`zapisVydejePovolen`).
      skladovyVydej: povoleno.length > 0 ? 'api' : 'rucne',
    },

    async otevrit(udaje: UdajePos) {
      const refreshToken = udaje.refresh_token ?? ''
      const cloudId = udaje.cloud_id ?? ''
      if (!refreshToken || !/^\d{1,15}$/.test(cloudId)) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Chybí token nebo Cloud ID.' } satisfies ChybaPos
      }

      const prihlaseni = await pozadavek(fetchFn, `${API_DOTYKACKA}/signin/token`, {
        method: 'POST',
        headers: { Authorization: `User ${refreshToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _cloudId: Number(cloudId) }),
      })
      if (jeChyba(prihlaseni)) return prihlaseni
      if (prihlaseni.status === 401 || prihlaseni.status === 403) {
        const chyba = chybaZeStavu(prihlaseni.status, 'přihlášení', prihlaseni.telo)
        if (chyba.druh !== 'pristup') return chyba
        return { stav: 'chyba', druh: 'pristup', duvod: 'Dotykačka token nepřijala — zkontrolujte, že je celý a že Cloud ID patří k němu.' } satisfies ChybaPos
      }
      if (prihlaseni.status !== 200 && prihlaseni.status !== 201) return chybaZeStavu(prihlaseni.status, 'přihlášení', prihlaseni.telo)

      const accessToken = (prihlaseni.telo as { accessToken?: unknown } | null)?.accessToken
      if (typeof accessToken !== 'string' || !accessToken) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Dotykačka po přihlášení nevrátila přístupový token.' } satisfies ChybaPos
      }

      const hlavicky = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }

      const relace: RelacePos = {
        async provozovny() {
          const vsechny: ProvozovnaPos[] = []
          for (let strana = 1; strana <= MAX_STRAN_PROVOZOVEN; strana++) {
            const odpoved = await pozadavek(fetchFn, `${API_DOTYKACKA}/clouds/${cloudId}/branches?page=${strana}&limit=100`, { headers: hlavicky })
            if (jeChyba(odpoved)) return odpoved
            // „lastPage … pro prázdná data API zatím vrací 404" (api-reference/general/paging)
            if (odpoved.status === 404) break
            if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, 'čtení provozoven', odpoved.telo)

            const cast = naparsovatProvozovny(odpoved.telo)
            if (!cast) return { stav: 'chyba', druh: 'jina', duvod: 'Seznam provozoven z Dotykačky má neočekávaný tvar.' } satisfies ChybaPos
            vsechny.push(...cast)

            if (cislo((odpoved.telo as { nextPage?: unknown } | null)?.nextPage) === null) break
          }
          return { stav: 'ok', provozovny: vsechny }
        },

        async prodeje(externiProvozovna: string, odMs: number, doMs: number) {
          if (!/^\d{1,15}$/.test(externiProvozovna)) {
            return { stav: 'chyba', druh: 'jina', duvod: 'Neplatné id provozovny v Dotykačce.' } satisfies ChybaPos
          }
          const parametry = new URLSearchParams({ dateFrom: String(odMs), dateTo: String(doMs), vatPayer: 'true', lang: 'cs' })
          const odpoved = await pozadavek(
            fetchFn,
            `${API_DOTYKACKA}/clouds/${cloudId}/branches/${externiProvozovna}/sales-report?${parametry}`,
            { headers: hlavicky },
          )
          if (jeChyba(odpoved)) return odpoved
          // „GET … did not find any entity matching the filter" — za tohle okno nic (zavřeno).
          if (odpoved.status === 404) return { stav: 'ok', radky: [], vynechano: 0, prazdne: true, platby: [] }
          if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, 'čtení tržeb', odpoved.telo)

          const report = naparsovatReport(odpoved.telo)
          if (!report) return { stav: 'chyba', druh: 'jina', duvod: 'Přehled tržeb z Dotykačky má neočekávaný tvar (chybí productSales).' } satisfies ChybaPos
          const { platby, necitelne } = naparsovatPlatby(odpoved.telo)
          return { stav: 'ok', ...report, platby, ...(necitelne ? { platbyNecitelne: true } : {}) }
        },

        // Jiné platby: čtení (katalog, účty, účet podle klíče).
        ...cteniDotykacky(kontextDotykacky(fetchFn, cloudId, accessToken)),
      }

      // Zápis do skladu jen pro cloud s povolenou provozovnou (dnes žádný).
      const povolene = povoleneProvozovny(cloudId, povoleno)
      if (povolene.size > 0) {
        relace.skladovyVydej = zapisVydejeDotykacka(kontextDotykacky(fetchFn, cloudId, accessToken), povolene)
        relace.zapisVydejePovolen = (provozovna) => povolene.has(provozovna)
      }

      return { stav: 'ok', relace }
    },
  }
}
