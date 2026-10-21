/**
 * Dotykačka (Dotypos) API v2 — katalog produktů, dohledání účtů a
 * (VYPNUTÝ) skladový výdej pro Jiné platby (docs/jine-platby-navrh.md,
 * oddíl 7). Čtení se připojuje do relace v `lib/pokladna-dotykacka.ts`
 * (`cteniDotykacky`), zápis NE (viz `odeslatVydejDotykacka`).
 *
 * Všechno podle oficiální dokumentace docs.api.dotypos.com, čteno
 * 16. 10. 2026 (verze API 2026.38.2). ŽIVĚ NEOVĚŘENO — testy jedou
 * jen na podvržených odpovědích (`scripts/pokladna-dotykacka-sklad.test.mjs`).
 * Každé použité pole má u sebe stránku, ze které je:
 *
 *   * GET /v2/clouds/:cloudId/products (entity/product): `page`, `limit`,
 *     odpověď `data[]` s `id`, `name`, `unit` (výčet api-reference/enums/units,
 *     např. "Piece", "Liter"), `packaging` („Number of items in a package"),
 *     `stockDeduct` („Product is deducted from Warehouse"), `plu[]`, `ean[]`,
 *     `deleted`. Suroviny (receptura) jdou jen přes `include=ingredients`
 *     a „Including an entity requires read permission … otherwise 403" —
 *     appka je nečte, `maRecepturu` je proto vždy `null`. Pole `recipe`
 *     je jen text postupu přípravy, o surovinách nic neříká.
 *   * GET /v2/clouds/:cloudId/orders (entity/order): `filter`, `include`
 *     (`orderItems`, `moneyLogs`), `namedFilter` (`openOrders` = „returns
 *     open orders only"), `sort`, `page`, `limit`. Pole účtu: `id`,
 *     `_branchId`, `created`, `completed`, `canceledDate`, `status`
 *     (api-reference/enums/order-status: new, parked, …, canceled, closed),
 *     `flags` (bit 1 CANCELED_FULL, bit 11 WRITEOFF), `documentType`,
 *     `documentNumber`, `externalId`, `paid`, `totalValueRounded`,
 *     `currency`. Položky jsou v účtu jako `orderItems[]`.
 *   * Položka účtu (entity/order-item): `_productId`, `name`, `quantity`,
 *     `stockDeduct`, `canceledDate`.
 *   * Filtr (api-reference/general/filter): `attribute|operation|value;…`,
 *     operace `eq`, `gteq`, `lt`; okno „created date in interval (left
 *     boundary - inclusive, right - exclusive)". Čas jako epoch ms
 *     (api-reference/general/data-types: „Unix time … milliseconds since Epoch").
 *   * Okno podle UZAVŘENÍ účtu (`ucty(…, { podle: 'uzavreni' })`) — ověřeno
 *     18. 10. 2026 v https://docs.api.dotypos.com/entity/order/: atribut
 *     `completed` („timestamp? — Order is completed.") má stejné značky
 *     jako `created`: filtrovatelný skupinami `EQUALS`, `ENUM`, `NUMBER`
 *     a řaditelný (🔽 `BOTH`). Skupina `NUMBER` = operace `gt`, `gteq`,
 *     `lt`, `lteq` (https://docs.api.dotypos.com/api-reference/general/filter).
 *     Filtr je proto `completed|gteq|<od>;completed|lt|<do>` se `sort=completed`
 *     (nově uzavřené účty přibývají na konec, stránkování se nerozhodí).
 *     Živě neověřeno, stejně jako zbytek souboru.
 *   * Řazení (api-reference/general/sort): `sort=created` (`created` je řaditelné).
 *   * Stránkování (api-reference/general/paging): `limit` nejvýš 100,
 *     prázdná data = 404. U Order „totalItemsCount=null and lastPage=null"
 *     — konec je stránka kratší než `limit` nebo 404, `nextPage` se u účtů nebere.
 *   * „All numbers … in the response are represented as strings"
 *     (api-reference/general/data-types) — všechno se čte obranně.
 *
 * CO SE Z DOKUMENTACE NEDALO ZJISTIT, a proto se to NEDOMÝŠLÍ:
 *   * receptura produktu bez `include=ingredients` → `maRecepturu: null`;
 *   * jestli odpis = platba 900000012 („Write-off", api-reference/enums/payment-methods):
 *     platby účtu by byly jen v `include=moneyLogs` (403 bez práva).
 *     `odpis` se bere z příznaku účtu WRITEOFF (bit 11, entity/order),
 *     vazba na platbu Odpis se ověří živě;
 *   * kolik jednotky je v jednom prodaném kusu (pivo 0,5 l → 0,5 l).
 *     `packaging` to NENÍ — dokumentace ho popisuje jako „Number of items in
 *     a package" (počet kusů v balení). `mira` je proto vždy null a agenda
 *     převádí jen kusy na kusy: „2× pivo 0,5 l" = 2 prodané kusy, litry pak
 *     odečte pokladna podle SVÉHO nastavení položky. Doklad v litrech bez
 *     míry = nejasné, ke kontrole člověkem (lib/jine-platby-mapovani.ts).
 *
 * Bez `server-only` schválně, stejně jako `lib/pokladna-dotykacka.ts`:
 * síť přichází v `KontextDotykacky` (podstrčitelná), tajemství z prostředí
 * tu nejsou. Za běhu se z `pokladna-dotykacka.ts` nic neimportuje (jen
 * typy), aby mezi soubory nevznikl kruh.
 */

import type { OperacePos, PosProOperaci } from './jine-platby-pos-operace.ts'
import type { ChybaPos, PolozkaUctuPos, ProduktPos, RelacePos, UcetPos } from './pos-provider-contract.ts'

/** Jedno volání API: stav a rozparsované tělo (null, když to není JSON), nebo chyba sítě. */
export type OdpovedDotykacky = { status: number; telo: unknown }

/**
 * Otevřená relace Dotykačky pro čtení a zápis mimo tržby. Staví ji
 * `kontextDotykacky()` v `lib/pokladna-dotykacka.ts` po přihlášení —
 * `pozadavek` a `chybaZeStavu` jsou tytéž funkce, které používá adaptér
 * pro tržby, takže výklad chyb (401/403 `reason`, 429, 5xx) je jeden.
 */
export type KontextDotykacky = {
  api: string
  cloudId: string
  hlavicky: Record<string, string>
  pozadavek(url: string, init: RequestInit, casovyLimitMs?: number): Promise<OdpovedDotykacky | ChybaPos>
  chybaZeStavu(status: number, coDelam: string, telo?: unknown): ChybaPos
}

/** „limit … Max items on a page … (1, 100)" (api-reference/general/paging). */
export const LIMIT_STRANKY = 100
/** 5 000 produktů. Víc = chyba, ne tichý ořez (chybějící produkt by vypadal, že v pokladně není). */
export const MAX_STRAN_KATALOGU = 50
/** 2 000 účtů v jednom okně. Víc = `uplne: false` („nenalezeno" pak nic nedokazuje). */
export const MAX_STRAN_UCTU = 20
/** Způsob platby „Write-off" (Odpis), api-reference/enums/payment-methods. */
export const PLATBA_ODPIS = 900000012
/**
 * POS akce bez vlastního webhooku čeká na pokladnu až 21 s („if the device
 * doesn't process the request within 21 seconds … 404", pos-actions/actions).
 * Limit adaptéru (20 s) by ji usekl dřív, než pokladna odpoví.
 */
export const CASOVY_LIMIT_POS_AKCE_MS = 35_000

/**
 * Externí klíč operace: jen znaky, které nerozbijí syntaxi filtru
 * (`|` a `;` jsou oddělovače, api-reference/general/filter). Klíč appka
 * generuje sama (uuid), cizí tvar se odmítne bez volání.
 */
const TVAR_KLICE = /^[A-Za-z0-9_.:-]{1,128}$/
/** Id v Dotykačce jako bezpečné celé číslo — do JSON těla jde jako číslo, větší by se zaokrouhlilo. */
const TVAR_ID = /^\d{1,15}$/
/** Množství výdeje: kladné desetinné číslo s tečkou, nejvýš 3 místa (numeric(12,3) v appce). */
const TVAR_MNOZSTVI = /^\d{1,9}(\.\d{1,3})?$/
/** `note` účtu je `string(1000)` (entity/order). */
const MAX_DELKA_POZNAMKY = 1000
const MAX_POLOZEK_VYDEJE = 200

/* ------------------------------------------------------------------ */
/* Obranné čtení hodnot („všechna čísla jsou řetězce")                 */
/* ------------------------------------------------------------------ */

function cislo(hodnota: unknown): number | null {
  if (typeof hodnota === 'number') return Number.isFinite(hodnota) ? hodnota : null
  if (typeof hodnota === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(hodnota.trim())) return Number(hodnota.trim())
  return null
}

/** Ano / ne / nevím — `null` není `false`. */
function ano(hodnota: unknown): boolean | null {
  if (hodnota === true || hodnota === 'true' || hodnota === 1 || hodnota === '1') return true
  if (hodnota === false || hodnota === 'false' || hodnota === 0 || hodnota === '0') return false
  return null
}

function text(hodnota: unknown, nejvys = 400): string | null {
  if (typeof hodnota !== 'string' && typeof hodnota !== 'number') return null
  const t = String(hodnota).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, nejvys)
  return t ? t : null
}

function seznamTextu(hodnota: unknown): string[] {
  // Schéma říká string[], vzor odpovědi u `plu` ukazuje <string> — berou se obě podoby.
  const pole = Array.isArray(hodnota) ? hodnota : hodnota === null || hodnota === undefined ? [] : [hodnota]
  return pole.map((x) => text(x, 64)).filter((x): x is string => x !== null)
}

function idText(hodnota: unknown): string | null {
  if (typeof hodnota === 'number') return Number.isSafeInteger(hodnota) && hodnota >= 0 ? String(hodnota) : null
  if (typeof hodnota === 'string' && /^\d{1,20}$/.test(hodnota.trim())) return hodnota.trim()
  return null
}

function vyplneno(hodnota: unknown): boolean {
  return hodnota !== undefined && hodnota !== null && hodnota !== ''
}

/** Časové razítko: epoch ms (číslo i text) nebo ISO 8601 (api-reference/general/data-types). */
function cas(hodnota: unknown): number | null {
  if (typeof hodnota === 'number') return Number.isSafeInteger(hodnota) ? hodnota : null
  if (typeof hodnota !== 'string') return null
  const t = hodnota.trim()
  if (/^\d{1,15}$/.test(t)) return Number(t)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    const ms = Date.parse(t)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/** Množství jako text s tečkou bez koncových nul ("2.000" → "2") — bez plovoucí chyby. */
function mnozstviNaText(hodnota: unknown): string | null {
  if (typeof hodnota === 'number') {
    if (!Number.isFinite(hodnota)) return null
    return hodnota.toFixed(3).replace(/\.?0+$/, '') || '0'
  }
  if (typeof hodnota !== 'string') return null
  const t = hodnota.trim()
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t
}

/** Částka v hlavní měně → haléře. Text se převádí po číslicích (bez float), číslo zaokrouhlením. */
function naHalere(hodnota: unknown): number | null {
  if (typeof hodnota === 'number') return Number.isFinite(hodnota) ? Math.round(hodnota * 100) : null
  if (typeof hodnota !== 'string') return null
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(hodnota.trim())
  if (!m) return null
  const desetiny = (m[3] ?? '').padEnd(3, '0')
  let halere = Number(m[2]) * 100 + Number(desetiny.slice(0, 2))
  if (Number(desetiny[2]) >= 5) halere += 1
  if (!Number.isSafeInteger(halere)) return null
  return m[1] === '-' ? -halere : halere
}

function bit(priznaky: number | null, poradi: number): boolean | null {
  if (priznaky === null || !Number.isSafeInteger(priznaky) || priznaky < 0) return null
  return Math.floor(priznaky / 2 ** poradi) % 2 === 1
}

/** Stránka: buď `{ data: [...] }`, nebo holé pole (entity/order ukazuje u 200 obojí). */
function polozkyStranky(telo: unknown): unknown[] | null {
  if (Array.isArray(telo)) return telo
  const data = (telo as { data?: unknown } | null)?.data
  return Array.isArray(data) ? data : null
}

function jeChyba(x: OdpovedDotykacky | ChybaPos): x is ChybaPos {
  return 'stav' in x
}

function chybaTvaru(co: string): ChybaPos {
  return { stav: 'chyba', druh: 'jina', duvod: `${co} z Dotykačky má neočekávaný tvar.` }
}

/* ------------------------------------------------------------------ */
/* Výklad odpovědí                                                     */
/* ------------------------------------------------------------------ */

/** Jeden produkt (entity/product). `null` = bez id, appka mu nerozumí. */
export function naparsovatProdukt(p: unknown): ProduktPos | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  const id = idText(r.id)
  if (!id) return null
  return {
    externiId: id,
    nazev: text(r.name) ?? `Produkt ${id}`,
    jednotka: text(r.unit, 40),
    // Viz hlavička: `packaging` je počet kusů v balení, ne objem kusu.
    mira: null,
    odecitaSklad: ano(r.stockDeduct),
    maRecepturu: null,
    plu: seznamTextu(r.plu),
    ean: seznamTextu(r.ean),
    smazano: ano(r.deleted) === true,
  }
}

/**
 * Stránka katalogu → produkty. Jediný produkt bez id = `null` (celá
 * stránka „nerozumím"): id je primární klíč, jeho chybění znamená, že
 * appka tvar odpovědi nezná — a neúplný katalog by vypadal jako celý.
 */
export function naparsovatProdukty(telo: unknown): ProduktPos[] | null {
  const data = polozkyStranky(telo)
  if (!data) return null
  const produkty: ProduktPos[] = []
  for (const p of data) {
    const produkt = naparsovatProdukt(p)
    if (!produkt) return null
    produkty.push(produkt)
  }
  return produkty
}

function naparsovatPolozku(i: unknown): PolozkaUctuPos | null {
  if (!i || typeof i !== 'object') return null
  const r = i as Record<string, unknown>
  const mnozstvi = mnozstviNaText(r.quantity)
  if (mnozstvi === null) return null
  const produktId = idText(r._productId)
  const nazev = text(r.name) ?? (produktId ? `Produkt ${produktId}` : null)
  if (!nazev) return null
  return { produktId, nazev, mnozstvi, odecitaSklad: ano(r.stockDeduct), zrusena: vyplneno(r.canceledDate) }
}

/**
 * Stav účtu. Zrušený má přednost (status `canceled`, vyplněné
 * `canceledDate` nebo příznak CANCELED_FULL) — stornovaný uzavřený doklad
 * není prodej. `new`/`parked` = otevřený, `closed` = uzavřený
 * („closed and issued"). Rozvozové stavy (ready_*, on_delivery, delivered,
 * delivery_failed) appka nevykládá → `neznamy`.
 */
function stavUctu(r: Record<string, unknown>, priznaky: number | null): UcetPos['stav'] {
  const status = typeof r.status === 'string' ? r.status.trim().toLowerCase() : null
  if (status === 'canceled' || vyplneno(r.canceledDate) || bit(priznaky, 1) === true) return 'zruseny'
  if (status === 'closed') return 'uzavreny'
  if (status === 'new' || status === 'parked') return 'otevreny'
  if (status === null && vyplneno(r.completed)) return 'uzavreny'
  return 'neznamy'
}

/** Jeden účet (entity/order) i s `orderItems`. `null` = bez id nebo s nečitelnou položkou. */
export function naparsovatUcet(o: unknown): UcetPos | null {
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  const id = idText(r.id)
  if (!id) return null

  const surovePolozky = r.orderItems === undefined || r.orderItems === null ? [] : r.orderItems
  if (!Array.isArray(surovePolozky)) return null
  const polozky: PolozkaUctuPos[] = []
  for (const i of surovePolozky) {
    const polozka = naparsovatPolozku(i)
    // Účet bez jedné položky by při kontrole skladu vypadal jako celý.
    if (!polozka) return null
    polozky.push(polozka)
  }

  const priznaky = cislo(r.flags)
  const mena = text(r.currency, 3)?.toUpperCase() ?? null
  return {
    externiId: id,
    cisloDokladu: text(r.documentNumber, 100),
    stav: stavUctu(r, priznaky),
    zaplaceno: ano(r.paid),
    celkemHaleru: naHalere(r.totalValueRounded),
    mena: mena && /^[A-Z]{3}$/.test(mena) ? mena : null,
    vytvorenoMs: cas(r.created),
    uzavrenoMs: cas(r.completed),
    typDokladu: text(r.documentType, 60),
    externiKlic: text(r.externalId, 256),
    // WRITEOFF (bit 11, entity/order) — vazba na platbu Odpis 900000012 je neověřená.
    odpis: bit(priznaky, 11),
    polozky,
  }
}

/** Stránka účtů → účty. Nečitelný účet se nevrátí, ale započítá (`necitelnych`), aby volající věděl, že seznam není celý. */
export function naparsovatUcty(telo: unknown): { ucty: UcetPos[]; necitelnych: number } | null {
  const data = polozkyStranky(telo)
  if (!data) return null
  const ucty: UcetPos[] = []
  let necitelnych = 0
  for (const o of data) {
    const ucet = naparsovatUcet(o)
    if (ucet) ucty.push(ucet)
    else necitelnych++
  }
  return { ucty, necitelnych }
}

/** Provozovna účtu, když ji odpověď nese (`_branchId`). */
function provozovnaUctu(o: unknown): string | null {
  return o && typeof o === 'object' ? idText((o as Record<string, unknown>)._branchId) : null
}

/* ------------------------------------------------------------------ */
/* Čtení — připojuje se do relace                                      */
/* ------------------------------------------------------------------ */

/**
 * Katalog, účty a dohledání podle klíče pro `RelacePos`. Jen čtení —
 * metoda pro zápis do skladu tu schválně NENÍ (viz `odeslatVydejDotykacka`).
 */
export function cteniDotykacky(k: KontextDotykacky): Required<Pick<RelacePos, 'katalog' | 'ucty' | 'ucetPodleKlice'>> {
  const zakladUctu = `${k.api}/clouds/${k.cloudId}/orders`

  return {
    async katalog() {
      const produkty: ProduktPos[] = []
      for (let strana = 1; strana <= MAX_STRAN_KATALOGU; strana++) {
        const parametry = new URLSearchParams({ page: String(strana), limit: String(LIMIT_STRANKY) })
        const odpoved = await k.pozadavek(`${k.api}/clouds/${k.cloudId}/products?${parametry}`, { headers: k.hlavicky })
        if (jeChyba(odpoved)) return odpoved
        // „lastPage … pro prázdná data API zatím vrací 404" (api-reference/general/paging)
        if (odpoved.status === 404) return { stav: 'ok', produkty }
        if (odpoved.status !== 200) return k.chybaZeStavu(odpoved.status, 'čtení katalogu produktů', odpoved.telo)

        const cast = naparsovatProdukty(odpoved.telo)
        if (!cast) return chybaTvaru('Katalog produktů')
        produkty.push(...cast)

        // Kratší stránka je poslední. U produktů API počty zná, takže výslovné `nextPage: null` je taky konec.
        const telo = odpoved.telo as { nextPage?: unknown } | null
        const bezDalsi = telo !== null && typeof telo === 'object' && !Array.isArray(telo) && 'nextPage' in telo && telo.nextPage === null
        if (cast.length < LIMIT_STRANKY || bezDalsi) return { stav: 'ok', produkty }
      }
      return {
        stav: 'chyba',
        druh: 'jina',
        duvod: `Katalog v Dotykačce je větší, než appka zatím načte (víc než ${MAX_STRAN_KATALOGU * LIMIT_STRANKY} produktů). Nic se neuložilo — strop je potřeba zvednout v appce.`,
      }
    },

    async ucty(
      externiProvozovna: string,
      odMs: number,
      doMs: number,
      moznosti: { jenOtevrene?: boolean; podle?: 'vytvoreni' | 'uzavreni' } = {},
    ) {
      if (!TVAR_ID.test(externiProvozovna)) return { stav: 'chyba', druh: 'jina', duvod: 'Neplatné id provozovny v Dotykačce.' } satisfies ChybaPos
      if (!Number.isSafeInteger(odMs) || !Number.isSafeInteger(doMs) || odMs < 0 || odMs >= doMs) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Neplatné časové okno pro dohledání účtů.' } satisfies ChybaPos
      }
      const podle = moznosti.podle ?? 'vytvoreni'
      if (podle !== 'vytvoreni' && podle !== 'uzavreni') {
        return { stav: 'chyba', druh: 'jina', duvod: 'Neznámý způsob hledání účtů v Dotykačce.' } satisfies ChybaPos
      }
      // Otevřený účet datum uzavření nemá — dotaz by vrátil vždycky nic a „nenalezeno" by lhalo.
      if (podle === 'uzavreni' && moznosti.jenOtevrene) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Otevřené účty nemají datum uzavření — hledejte je podle vytvoření.' } satisfies ChybaPos
      }
      // entity/order: `created` i `completed` jsou filtrovatelné operacemi NUMBER (gteq, lt) a řaditelné (viz hlavička).
      const pole = podle === 'uzavreni' ? 'completed' : 'created'

      const ucty: UcetPos[] = []
      let necitelnych = 0
      for (let strana = 1; strana <= MAX_STRAN_UCTU; strana++) {
        const parametry = new URLSearchParams({
          // „created date in interval (left boundary - inclusive, right - exclusive)" (api-reference/general/filter);
          // podle uzavření totéž nad `completed`.
          filter: `_branchId|eq|${externiProvozovna};${pole}|gteq|${odMs};${pole}|lt|${doMs}`,
          include: 'orderItems',
          sort: pole,
          page: String(strana),
          limit: String(LIMIT_STRANKY),
        })
        if (moznosti.jenOtevrene) parametry.set('namedFilter', 'openOrders')

        const odpoved = await k.pozadavek(`${zakladUctu}?${parametry}`, { headers: k.hlavicky })
        if (jeChyba(odpoved)) return odpoved
        if (odpoved.status === 404) return { stav: 'ok', ucty, uplne: necitelnych === 0 }
        if (odpoved.status !== 200) return k.chybaZeStavu(odpoved.status, 'čtení účtů', odpoved.telo)

        const data = polozkyStranky(odpoved.telo)
        if (!data) return chybaTvaru('Seznam účtů')
        for (const o of data) {
          // Pojistka, kdyby filtr nezabral: účet cizí provozovny sem nepatří.
          const provozovna = provozovnaUctu(o)
          if (provozovna !== null && provozovna !== externiProvozovna) continue
          const ucet = naparsovatUcet(o)
          if (ucet) ucty.push(ucet)
          else necitelnych++
        }

        // U účtů API počty nevede (lastPage null) — konec je jen kratší stránka nebo 404.
        if (data.length < LIMIT_STRANKY) return { stav: 'ok', ucty, uplne: necitelnych === 0 }
      }
      return { stav: 'ok', ucty, uplne: false }
    },

    async ucetPodleKlice(klic: string) {
      if (!TVAR_KLICE.test(klic)) return { stav: 'chyba', druh: 'jina', duvod: 'Klíč operace má nepovolený tvar — v Dotykačce se podle něj hledat nedá.' } satisfies ChybaPos

      const parametry = new URLSearchParams({ filter: `externalId|eq|${klic}`, include: 'orderItems', page: '1', limit: String(LIMIT_STRANKY) })
      const odpoved = await k.pozadavek(`${zakladUctu}?${parametry}`, { headers: k.hlavicky })
      if (jeChyba(odpoved)) return odpoved
      // „did not find any entity matching the filter" — účet s tímhle klíčem v pokladně není.
      if (odpoved.status === 404) return { stav: 'ok', ucet: null }
      if (odpoved.status !== 200) return k.chybaZeStavu(odpoved.status, 'dohledání účtu podle klíče', odpoved.telo)

      const cast = naparsovatUcty(odpoved.telo)
      if (!cast) return chybaTvaru('Účet')
      // Nalezený, ale nečitelný účet NENÍ „nenalezeno" — to by pustilo druhý výdej.
      if (cast.necitelnych > 0) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Účet s tímto klíčem v Dotykačce je, ale appka mu nerozumí — zkontrolujte ho v Dotykačce ručně.' } satisfies ChybaPos
      }
      // Účet s jiným klíčem = filtr nezabral; z takové odpovědi nejde říct ani „je", ani „není".
      if (cast.ucty.some((u) => u.externiKlic !== klic)) {
        return { stav: 'chyba', druh: 'jina', duvod: 'Dotykačka vrátila účty s jiným externím ID — dohledání podle klíče se nedá vyhodnotit.' } satisfies ChybaPos
      }
      if (cast.ucty.length > 1) {
        return { stav: 'chyba', druh: 'jina', duvod: `V Dotykačce je víc účtů se stejným externím ID (${cast.ucty.length}) — zkontrolujte je ručně.` } satisfies ChybaPos
      }
      return { stav: 'ok', ucet: cast.ucty[0] ?? null }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Skladový výdej přes POS akci — NEPŘIPOJENO K ADAPTÉRU                */
/* ------------------------------------------------------------------ */

export type PolozkaVydeje = {
  /** `_productId` produktu v Dotykačce (z `pos_katalog.externi_id`). */
  produktId: string
  /** Množství v jednotkách prodeje pokladny, text s tečkou ("2", "0.5"). */
  mnozstvi: string
}

export type VydejDotykacka = {
  /** `_branchId` provozovny, jejíž pokladna akci provede. */
  provozovna: string
  /** `pos_operace.idempotencni_klic` — jde jako `external-id` účtu, podle něj se výsledek dohledá. */
  klic: string
  polozky: PolozkaVydeje[]
  poznamka: string
  /** `pos_operace.platnost_do` v epoch ms — po ní pokladna požadavek odmítne (kód 1007). */
  platnostDoMs: number
}

/**
 * Výsledek ODESLÁNÍ (ne provedení!). Tvar je lokální kopie typu
 * z `lib/jine-platby-pos-operace.ts` (píše ho souběžně jiný implementátor;
 * integrátor tvary sjednotí):
 *   'odeslano'  — Dotykačka požadavek přijala (HTTP 200). NENÍ to úspěch:
 *                 výsledek chodí webhookem, `uspech` smí zapsat až dohledání
 *                 účtu podle klíče (`ucetPodleKlice`).
 *   'odmitnuto' — požadavek prokazatelně neprošel (nic se neprovedlo); smí se zkusit znovu.
 *   'nejasne'   — nevíme (timeout, 5xx, 404 bez odpovědi pokladny, neznámý kód).
 *                 NIKDY se neposílá znovu naslepo, jen se dohledává podle klíče.
 */
export type VysledekOdeslani =
  | { stav: 'odeslano'; kod: number | null; externiId: string | null }
  | { stav: 'odmitnuto'; duvod: string; kod: string | null; docasna: boolean }
  | { stav: 'nejasne'; duvod: string }

/**
 * Kódy výsledku POS akce (pos-actions/actions, „Result codes"), u kterých
 * je jisté, že se NIC neprovedlo — chyba celého požadavku, ne jeho části.
 * `docasna` = po opravě času/otevření pokladny pomůže nový pokus.
 *
 * Schválně tu NEJSOU 2003 (neplatná platba — „the freshly created order is
 * not removed": účet vznikl!), 4001/4002 (produkt — dokumentace neříká, jestli
 * účet nevznikl napůl) ani 1010/1011: ty jsou `nejasne` a dohledají se.
 */
const KODY_NEPROVEDENO: ReadonlyMap<number, { nazev: string; docasna: boolean }> = new Map([
  [1001, { nazev: 'REQUEST_ERROR', docasna: false }],
  [1003, { nazev: 'MISSING_ACTION', docasna: false }],
  [1004, { nazev: 'UNKNOWN_ACTION', docasna: false }],
  [1007, { nazev: 'EXPIRED_REQUEST', docasna: true }],
  [1008, { nazev: 'USER_NOT_FOUND', docasna: false }],
  [3001, { nazev: 'REGISTER_CLOSED', docasna: true }],
])

/** Tělo POS akce, nebo důvod, proč se nesmí odeslat (pak se nic neposílá). */
export function sestavitTeloVydeje(v: VydejDotykacka, tedMs: number): { telo: Record<string, unknown> } | { chyba: string } {
  if (!TVAR_ID.test(v.provozovna)) return { chyba: 'Neplatné id provozovny v Dotykačce.' }
  if (!TVAR_KLICE.test(v.klic)) return { chyba: 'Klíč operace má nepovolený tvar.' }
  if (!Array.isArray(v.polozky) || v.polozky.length === 0) return { chyba: 'Výdej nemá žádnou položku.' }
  if (v.polozky.length > MAX_POLOZEK_VYDEJE) return { chyba: `Výdej má víc než ${MAX_POLOZEK_VYDEJE} položek.` }
  for (const [i, p] of v.polozky.entries()) {
    if (!TVAR_ID.test(p.produktId)) return { chyba: `Položka č. ${i + 1}: neplatné id produktu v Dotykačce.` }
    if (!TVAR_MNOZSTVI.test(p.mnozstvi) || Number(p.mnozstvi) <= 0) return { chyba: `Položka č. ${i + 1}: množství musí být kladné číslo s tečkou.` }
  }
  // Platnost v ms (api-reference/general/data-types: „Unix time … milliseconds"). Minulá = pokladna by stejně odmítla.
  if (!Number.isSafeInteger(v.platnostDoMs) || v.platnostDoMs <= tedMs) return { chyba: 'Platnost požadavku už vypršela (nebo není v milisekundách).' }

  const poznamka = (v.poznamka ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_DELKA_POZNAMKY)
  return {
    telo: {
      // pos-actions/actions: „order/create-issue-pay" — účet se vytvoří, vydá a zaplatí najednou.
      action: 'order/create-issue-pay',
      validity: v.platnostDoMs,
      'external-id': v.klic,
      // Odpis: účet zaplacený způsobem „Write-off", ne hotovostí ani kartou (docs/jine-platby-navrh.md, oddíl 8).
      'payment-method-id': PLATBA_ODPIS,
      note: poznamka,
      // „none — Don't print": odpis netiskne účtenku obsluze.
      'print-type': 'none',
      // Položka: `id` „Corresponds to _productId", `qty` double. Id ≤ 15 číslic = bezpečné celé číslo.
      items: v.polozky.map((p) => ({ id: Number(p.produktId), qty: Number(p.mnozstvi) })),
    },
  }
}

/** HTTP odpověď POS akce → výsledek odeslání. Text odpovědi do hlášky nejde, jen číselný kód. */
export function vysledekPosAkce(status: number, telo: unknown, k: Pick<KontextDotykacky, 'chybaZeStavu'>): VysledekOdeslani {
  const t = telo && typeof telo === 'object' && !Array.isArray(telo) ? (telo as Record<string, unknown>) : null
  const kod = cislo(t?.code)

  if (status === 200) {
    // Bez vlastního webhooku nese tělo odpověď výchozího webhooku: obálku chyby `{code, message, …}` nebo účet.
    if (kod !== null && kod !== 0) {
      const znamy = KODY_NEPROVEDENO.get(kod)
      if (znamy) return { stav: 'odmitnuto', duvod: `Pokladna požadavek odmítla (kód ${kod} ${znamy.nazev}) — nic se neprovedlo.`, kod: String(kod), docasna: znamy.docasna }
      return { stav: 'nejasne', duvod: `Pokladna vrátila kód ${kod}, ze kterého nejde poznat, jestli účet vznikl — appka ho dohledá podle klíče.` }
    }
    const ucet = t?.order && typeof t.order === 'object' ? (t.order as Record<string, unknown>) : null
    return { stav: 'odeslano', kod, externiId: idText(ucet?.id) }
  }
  if (status === 404) {
    // „if the device doesn't process the request within 21 seconds … 404" — pokladna ho může provést později, dokud platí.
    return { stav: 'nejasne', duvod: 'Pokladna požadavek nepotvrdila včas (HTTP 404). Může ho ještě provést, dokud platí — appka ho dohledá podle klíče.' }
  }
  if (status === 408 || status === 429) {
    // 408 (vypršel čas) i 429 (limit souběžných požadavků) přijdou od brány —
    // dokumentace neslibuje, že požadavek do pokladny vůbec nedošel. „Nic se
    // neprovedlo" by otevřelo nový pokus a zrušení záznamu (N19), proto nejasné
    // a dohledá se podle klíče.
    return { stav: 'nejasne', duvod: `Dotykačka požadavek nepotvrdila (HTTP ${status}). Mohl dojít do pokladny — appka ho dohledá podle klíče, znovu ho naslepo neposílá.` }
  }
  if (status === 401 || status === 403) {
    // Přihlášení neprošlo — k pokladně se požadavek nedostal.
    const reason = typeof t?.reason === 'string' && /^[A-Z_]{1,40}$/.test(t.reason.trim().toUpperCase()) ? t.reason.trim().toUpperCase() : null
    return { stav: 'odmitnuto', duvod: k.chybaZeStavu(status, 'skladový výdej', telo).duvod, kod: reason ?? String(status), docasna: false }
  }
  if (status >= 400 && status < 500) {
    // Stejné pravidlo jako u HTTP 200 (N19): „nic se neprovedlo" JEN u kódů,
    // u kterých je to jisté (KODY_NEPROVEDENO). Jiný kód (2003 — účet vznikl,
    // platba ne; 4001/4002; neznámý) nebo 4xx bez kódu v těle = nejasné.
    const znamy = kod !== null ? KODY_NEPROVEDENO.get(kod) : undefined
    if (kod !== null && znamy) {
      return { stav: 'odmitnuto', duvod: `Dotykačka požadavek odmítla (HTTP ${status}, kód ${kod} ${znamy.nazev}) — nic se neprovedlo.`, kod: String(kod), docasna: znamy.docasna }
    }
    return {
      stav: 'nejasne',
      duvod: `Dotykačka vrátila HTTP ${status}${kod !== null ? ` s kódem ${kod}` : ' bez kódu výsledku'}, ze kterého nejde poznat, jestli účet vznikl — appka ho dohledá podle klíče.`,
    }
  }
  // 5xx: chyba mohla vzniknout až po předání pokladně.
  return { stav: 'nejasne', duvod: `Dotykačka hlásí chybu (HTTP ${status}) — nejde poznat, jestli požadavek došel do pokladny. Appka ho dohledá podle klíče.` }
}

/**
 * Skladový výdej přes POS akci `order/create-issue-pay` zaplacenou
 * způsobem Odpis (900000012), `external-id` = idempotenční klíč operace.
 *
 * NENÍ PŘIPOJENO K ADAPTÉRU. Schopnosti Dotykačky hlásí
 * `skladovyVydej: 'rucne'` a relace žádnou metodu zápisu nemá (hlídá
 * `scripts/pokladna-dotykacka-sklad.test.mjs`). Pravidlo projektu:
 * „bezpečné, protože to nikdo nezapnul" není pojistka — proto je schopnost
 * odebraná v kódu.
 *
 * PŘED PŘIPOJENÍM (na testovacím cloudu Dotykačky, ne na Černé Perle):
 *   1. `GET /v2/clouds/:cloudId/manifest` (entity/cloud-manifest): provozovna
 *      má ve `features` `posAction` a `stockDeductionMode` je `documentIssue`.
 *   2. Odeslat výdej jednoho kusového zboží a jednoho pokrmu s recepturou.
 *      Ověřit: účet vznikl s `externalId` = klíč, je zaplacený, má příznak
 *      WRITEOFF a `ucetPodleKlice` ho najde.
 *   3. Sklad: kusové zboží ubylo, u pokrmu ubyly SUROVINY podle receptury.
 *   4. Tržby: odpis se NEOBJEVÍ v `sales-report` v `productSales` (jinak by ho
 *      synchronizace zapsala do `pokladna_prodeje_denni` jako tržbu) a v
 *      `revenue.paymentTypeInfo` jen jako 900000012 (druh `odpis`) — pak ho
 *      přehled tržeb nesmí sčítat do tržby (otázka 53).
 *   5. `validity` v ms: platnost za 10 min projde, minulá vrátí kód 1007.
 *   6. Tvar těla HTTP 200 bez webhooku (obálka `code` / účet) a co přijde,
 *      když pokladna neodpoví do 21 s (404?); `print-type: none` projde;
 *      bez `user-id` nevrátí 1008.
 *   7. Opakované odeslání téhož klíče: vytvoří druhý účet? (Dokumentace
 *      unikátnost `external-id` neslibuje — appka proto nikdy neposílá
 *      znovu naslepo, jen po prokázané chybě.)
 *
 * KDO DÁ POKYN: Šéfík, výslovně (docs/jine-platby-pos-operace.md). Do té
 * doby výdej dělá člověk v pokladně a appka eviduje „ručně doloženo".
 *
 * JAK PŘIPOJIT: v `vytvoritDotykacku().otevrit()` přidat do relace
 * `skladovyVydej: zapisVydejeDotykacka(kontext)` (bere `OperacePos`
 * orchestrátoru a převede ji přes `vydejZOperace`, N20 — NE přímo
 * `odeslatVydejDotykacka`, ta čeká jiný tvar), schopnost přepnout na
 * `skladovyVydej: 'api'` a vědomě upravit kontrolu „relace NEMÁ metodu
 * pro zápis skladu" v testu. Co ještě chybí: viz `vydejZOperace`.
 */
export async function odeslatVydejDotykacka(k: KontextDotykacky, v: VydejDotykacka, tedMs: number = Date.now()): Promise<VysledekOdeslani> {
  const sestaveno = sestavitTeloVydeje(v, tedMs)
  if ('chyba' in sestaveno) return { stav: 'odmitnuto', duvod: sestaveno.chyba, kod: null, docasna: false }

  const odpoved = await k.pozadavek(
    `${k.api}/clouds/${k.cloudId}/branches/${v.provozovna}/pos-actions`,
    { method: 'POST', headers: { ...k.hlavicky, 'Content-Type': 'application/json' }, body: JSON.stringify(sestaveno.telo) },
    CASOVY_LIMIT_POS_AKCE_MS,
  )
  if (jeChyba(odpoved)) {
    // Požadavek mohl odejít a pokladna ho mohla provést — výpadek spojení po odeslání se od „neodešlo" nepozná.
    return { stav: 'nejasne', duvod: 'Dotykačka neodpověděla (vypršel čas nebo spadlo spojení). Výdej se mohl provést — appka ho dohledá podle klíče, znovu ho naslepo neposílá.' }
  }
  return vysledekPosAkce(odpoved.status, odpoved.telo, k)
}

/* ------------------------------------------------------------------ */
/* Napojení na orchestrátor operací (N20) — NEPŘIPOJENO K ADAPTÉRU      */
/* ------------------------------------------------------------------ */

/**
 * Operace orchestrátoru (`OperacePos` z lib/jine-platby-pos-operace.ts,
 * jak ji předá `provestOperaci` po zabrání) → tvar zápisu Dotykačky
 * (`VydejDotykacka`). Tvary se liší jménem i jednotkou:
 *   externiProvozovna  → provozovna
 *   platnostDo (ISO)   → platnostDoMs (epoch ms; Dotykačka bere ms)
 * Bez převodu by připojení `(v) => odeslatVydejDotykacka(k, v)` odmítlo
 * každý výdej bez volání („Neplatné id provozovny") a uživatel by
 * zkoušel znovu dokola (kontrola 19. 10.).
 *
 * `{ chyba }` = nic se neodešle (chybí platnost nebo provozovna).
 *
 * CO JEŠTĚ CHYBÍ PŘED ZAPNUTÍM: u pokladny připojené k POBOČCE (ne ke
 * konkrétní provozovně) má záznam `pos_provozovna` NULL
 * (`jine_platby_zalozit`) a `rozhodnout_vydej` z ní plní
 * `pos_operace.externi_provozovna` — operace pak provozovnu nemá a tady
 * skončí chybou. Databáze musí provozovnu doplnit z aktuálního přiřazení
 * provozoven k pobočce (a odmítnout, když jich je víc nebo žádná).
 */
export function vydejZOperace(op: OperacePos): VydejDotykacka | { chyba: string } {
  const platnostDoMs = op.platnostDo === null ? Number.NaN : Date.parse(op.platnostDo)
  if (!Number.isFinite(platnostDoMs)) return { chyba: 'Operace nemá platnost požadavku — výdej se do pokladny neodešle.' }
  if (typeof op.externiProvozovna !== 'string' || op.externiProvozovna.trim() === '') {
    return { chyba: 'Operace nemá provozovnu pokladny — výdej se do pokladny neodešle (pokladna připojená k pobočce provozovnu u záznamu nenese).' }
  }
  return {
    provozovna: op.externiProvozovna.trim(),
    klic: op.klic,
    polozky: op.polozky.map((p) => ({ produktId: p.produktId, mnozstvi: p.mnozstvi })),
    poznamka: op.poznamka,
    platnostDoMs,
  }
}

/**
 * Metoda zápisu pro relaci pokladny: přesně typ, který čeká orchestrátor
 * (`PosProOperaci['odeslat']` — v akce-pos.ts `relace.skladovyVydej`).
 * Zapnutí zápisu je pak opravdu jen připojení téhle funkce k relaci
 * (viz `odeslatVydejDotykacka`, oddíl JAK PŘIPOJIT). Typ hlídá `tsc`:
 * kdyby se tvar operace nebo výsledku rozešel, překlad spadne.
 */
export function zapisVydejeDotykacka(k: KontextDotykacky): NonNullable<PosProOperaci['odeslat']> {
  return async (op) => {
    const v = vydejZOperace(op)
    if ('chyba' in v) return { stav: 'odmitnuto', duvod: v.chyba, kod: null, docasna: false }
    return odeslatVydejDotykacka(k, v)
  }
}
