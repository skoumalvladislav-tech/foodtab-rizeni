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
 *     produktu, který `pokladna_prodeje_denni` drží.
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
 *
 * Bez `server-only` schválně: síťové volání jde podstrčit (`vytvoritDotykacku(fetchFn)`),
 * takže `scripts/pokladna-dotykacka.test.mjs` ověří tvar požadavků
 * i výklad odpovědí bez sítě. Žádné tajemství z prostředí tu není —
 * údaje přicházejí jako parametr, rozšifrované synchronizací.
 */

import { createHmac } from 'node:crypto'

import type { ChybaPos, PosProvider, ProvozovnaPos, RadekProdeje, RelacePos, UdajePos } from './pos-provider-contract.ts'

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
async function pozadavek(fetchFn: Fetch, url: string, init: RequestInit): Promise<{ status: number; telo: unknown } | ChybaPos> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(CASOVY_LIMIT_MS) })
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

export function vytvoritDotykacku(fetchFn: Fetch = (url, init) => fetch(url, init)): PosProvider {
  return {
    klic: 'dotykacka',
    schopnosti: {
      urovenDat: 'denni_souhrn',
      // Dotykačka webhooky má (others/webhook), appka je zatím nepoužívá — stahuje každou hodinu.
      webhooky: false,
      historieDnu: null,
      platebniMetody: false,
      poskytujeSkladovePohyby: false,
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
          if (odpoved.status === 404) return { stav: 'ok', radky: [], vynechano: 0, prazdne: true }
          if (odpoved.status !== 200) return chybaZeStavu(odpoved.status, 'čtení tržeb', odpoved.telo)

          const report = naparsovatReport(odpoved.telo)
          if (!report) return { stav: 'chyba', druh: 'jina', duvod: 'Přehled tržeb z Dotykačky má neočekávaný tvar (chybí productSales).' } satisfies ChybaPos
          return { stav: 'ok', ...report }
        },
      }

      return { stav: 'ok', relace }
    },
  }
}
