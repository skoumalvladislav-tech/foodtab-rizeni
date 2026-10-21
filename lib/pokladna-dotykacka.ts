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
 * Skladový výdej přes POS akci je napsaný, ale k relaci NEPŘIPOJENÝ
 * (`skladovyVydej: 'rucne'`, viz schopnosti níž).
 *
 * Bez `server-only` schválně: síťové volání jde podstrčit (`vytvoritDotykacku(fetchFn)`),
 * takže `scripts/pokladna-dotykacka.test.mjs` ověří tvar požadavků
 * i výklad odpovědí bez sítě. Žádné tajemství z prostředí tu není —
 * údaje přicházejí jako parametr, rozšifrované synchronizací.
 */

import { createHmac } from 'node:crypto'

import type { ChybaPos, DruhPlatby, PosProvider, ProvozovnaPos, RadekPlatby, RadekProdeje, RelacePos, UdajePos } from './pos-provider-contract.ts'
import { cteniDotykacky, type KontextDotykacky } from './pokladna-dotykacka-sklad.ts'

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

/** Jedno volání: buď stav a rozparsované tělo (null, když to není JSON), nebo chyba sítě. Text odpovědi do hlášek nejde. */
async function pozadavek(fetchFn: Fetch, url: string, init: RequestInit, casovyLimitMs: number = CASOVY_LIMIT_MS): Promise<{ status: number; telo: unknown } | ChybaPos> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(casovyLimitMs) })
  } catch (e) {
    const proc = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'vypršel čas' : 'spojení selhalo'
    return { stav: 'chyba', druh: 'docasna', duvod: `Dotykačka neodpověděla (${proc}) — appka to zkusí příště.` }
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
  return { status: odpoved.status, telo }
}

function jeChyba(x: { status: number; telo: unknown } | ChybaPos): x is ChybaPos {
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

export function vytvoritDotykacku(fetchFn: Fetch = (url, init) => fetch(url, init)): PosProvider {
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
      // Výdej přes POS akci (`odeslatVydejDotykacka`) je napsaný, ale NEPŘIPOJENÝ:
      // připojí se až po ověření na testovacím cloudu Dotykačky a výslovném
      // pokynu Šéfíka. Co přesně ověřit a jak ho připojit, je v komentáři
      // u `odeslatVydejDotykacka`. Do té doby výdej dělá člověk v pokladně.
      skladovyVydej: 'rucne',
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

        // Jiné platby: jen čtení (katalog, účty, účet podle klíče). Zápis do skladu tu schválně není.
        ...cteniDotykacky(kontextDotykacky(fetchFn, cloudId, accessToken)),
      }

      return { stav: 'ok', relace }
    },
  }
}
