/**
 * Dotykačka (Dotypos) API v2 — katalog produktů (i s recepturami),
 * dohledání účtů a skladový výdej pro Jiné platby (docs/jine-platby-navrh.md,
 * oddíl 7; docs/jine-platby-vydej-dotykacka.md). Čtení se připojuje do
 * relace v `lib/pokladna-dotykacka.ts` (`cteniDotykacky`), zápis jen pro
 * provozovny z `ZAPIS_VYDEJE_DOTYKACKA` — a ten seznam je prázdný (viz
 * `odeslatVydejDotykacka`).
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
 *     `deleted`. Suroviny (receptura) jdou přes `include=ingredients`
 *     (každý produkt pak nese `ingredients[]`, entity/product-ingredient:
 *     `_productId` suroviny, `quantity`, `unit`, `deleted`) a „the client
 *     must have the proper permissions to read the included entity … 403
 *     Forbidden otherwise" — při 403 se katalog načte znovu BEZ receptur
 *     (`maRecepturu` pak null, `bezReceptur: true`). Čteno 25. 10. 2026
 *     (verze API 2026.39.0). Pole `recipe` je jen text postupu přípravy,
 *     o surovinách nic neříká.
 *   * GET /v2/clouds/:cloudId/manifest (entity/cloud-manifest), čteno
 *     25. 10. 2026: `branches[]` s `branchId`, `isLicensed`, `features`
 *     („Contains posAction when the branch has an active premium (or
 *     higher) license") a `stockDeductionMode` („One of disabled,
 *     orderPark, documentIssue"). Čte se těsně před POS akcí
 *     (`odeslatVydejDotykacka`): s `disabled` by účet vznikl, ale sklad
 *     by se neodečetl.
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
 *   * receptura produktu bez `include=ingredients` (nebo bez klíče
 *     `ingredients` v odpovědi, nebo s nečitelnou surovinou) → `maRecepturu:
 *     null`. Jen pole `ingredients` dá „bez receptury" (`[]`) — chybějící
 *     klíč by jinak vyřadil pokrm z výdeje (app.jp_sestavit_vydej);
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

import type { ChybaPos, PolozkaUctuPos, ProduktPos, RelacePos, SurovinaPos, UcetPos, VydejPos } from './pos-provider-contract.ts'

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

/** Nejvýš tolik surovin jedné receptury appka uloží (`pos_katalog.suroviny`). */
const MAX_SUROVIN = 200

/**
 * Důvody 403 (api-reference/general/common-error-responses), které se
 * netýkají jen čtení receptur: s nimi by katalog bez receptur spadl stejně,
 * takže se neopakuje a hlásí se rovnou.
 */
const NE_KVULI_RECEPTURAM: ReadonlySet<string> = new Set(['INVALID_ACCESS_TOKEN', 'ACCESS_TOKEN_EXPIRED', 'CLOUD_FORBIDDEN', 'LICENSE_UPGRADE_REQUIRED'])

function duvod403(telo: unknown): string {
  const r = telo && typeof telo === 'object' && !Array.isArray(telo) ? (telo as Record<string, unknown>).reason : null
  return typeof r === 'string' ? r.trim().toUpperCase() : ''
}

/**
 * Receptura produktu z `ingredients[]` (include=ingredients,
 * entity/product-ingredient). `null` = neví se: klíč chybí (bez include),
 * není to pole, nebo je některá surovina nečitelná — neúplná receptura by
 * vypadala jako celá a varování o dvojím odečtu by mlčelo. Smazané
 * suroviny (`deleted`) se vynechají.
 */
export function naparsovatSuroviny(hodnota: unknown): SurovinaPos[] | null {
  if (!Array.isArray(hodnota) || hodnota.length > MAX_SUROVIN) return null
  const suroviny: SurovinaPos[] = []
  for (const s of hodnota) {
    if (!s || typeof s !== 'object') return null
    const r = s as Record<string, unknown>
    if (ano(r.deleted) === true) continue
    const produkt = idText(r._productId)
    if (!produkt) return null
    const mnozstvi = mnozstviNaText(r.quantity)
    suroviny.push({ produkt, mnozstvi: mnozstvi !== null && Number(mnozstvi) > 0 ? mnozstvi : null, jednotka: text(r.unit, 40) })
  }
  return suroviny
}

/** Jeden produkt (entity/product). `null` = bez id, appka mu nerozumí. */
export function naparsovatProdukt(p: unknown): ProduktPos | null {
  if (!p || typeof p !== 'object') return null
  const r = p as Record<string, unknown>
  const id = idText(r.id)
  if (!id) return null
  const suroviny = 'ingredients' in r ? naparsovatSuroviny(r.ingredients) : null
  return {
    externiId: id,
    nazev: text(r.name) ?? `Produkt ${id}`,
    jednotka: text(r.unit, 40),
    // Viz hlavička: `packaging` je počet kusů v balení, ne objem kusu.
    mira: null,
    odecitaSklad: ano(r.stockDeduct),
    maRecepturu: suroviny === null ? null : suroviny.length > 0,
    suroviny,
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

  /**
   * Celý katalog po stránkách. S `sRecepturami` se ptá i na receptury
   * (`include=ingredients`); 403 pak vrací jako `'bez_prava'`, aby
   * `katalog()` mohl začít znovu bez nich.
   */
  async function katalogPoStrankach(sRecepturami: boolean): Promise<{ stav: 'ok'; produkty: ProduktPos[] } | ChybaPos | 'bez_prava'> {
    const produkty: ProduktPos[] = []
    for (let strana = 1; strana <= MAX_STRAN_KATALOGU; strana++) {
      const parametry = new URLSearchParams({ page: String(strana), limit: String(LIMIT_STRANKY) })
      if (sRecepturami) parametry.set('include', 'ingredients')
      const odpoved = await k.pozadavek(`${k.api}/clouds/${k.cloudId}/products?${parametry}`, { headers: k.hlavicky })
      if (jeChyba(odpoved)) return odpoved
      // „Note that the client must have the proper permissions to read the included entity … 403" (entity/product).
      // 403 kvůli tokenu, cloudu nebo licenci (common-error-responses) neplatí jen pro receptury — ta je chyba hned.
      if (sRecepturami && odpoved.status === 403 && !NE_KVULI_RECEPTURAM.has(duvod403(odpoved.telo))) return 'bez_prava'
      // „lastPage … pro prázdná data API zatím vrací 404" (api-reference/general/paging)
      if (odpoved.status === 404) return { stav: 'ok', produkty }
      if (odpoved.status !== 200) return k.chybaZeStavu(odpoved.status, 'čtení katalogu produktů', odpoved.telo)

      const cast = naparsovatProdukty(odpoved.telo)
      if (!cast) return chybaTvaru('Katalog produktů')
      // Bez include receptura neznámá, i kdyby odpověď nějaké `ingredients` nesla.
      produkty.push(...(sRecepturami ? cast : cast.map((p) => ({ ...p, maRecepturu: null, suroviny: null }))))

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
  }

  return {
    async katalog() {
      // Nejdřív s recepturami. Bez práva je číst (403) celý katalog znovu bez nich
      // — ne napůl: stránky s recepturou a bez ní by se nedaly rozlišit.
      const s = await katalogPoStrankach(true)
      if (s !== 'bez_prava') return s
      const bez = await katalogPoStrankach(false)
      if (bez === 'bez_prava') return k.chybaZeStavu(403, 'čtení katalogu produktů')
      return bez.stav === 'ok' ? { ...bez, bezReceptur: true } : bez
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
/* Skladový výdej přes POS akci — připojí se jen pro provozovny         */
/* z ZAPIS_VYDEJE_DOTYKACKA (lib/pokladna-dotykacka-zapis.ts, prázdné)  */
/* ------------------------------------------------------------------ */

/**
 * Nastavení provozovny z manifestu cloudu (entity/cloud-manifest), které
 * rozhoduje, jestli má smysl POS akci posílat.
 */
export type ManifestProvozovny = {
  /** `isLicensed` — aktivní licence. */
  licence: boolean | null
  /** `features` obsahuje `posAction` (licence premium a vyšší). */
  posAkce: boolean
  /** `stockDeductionMode`: 'disabled' | 'orderPark' | 'documentIssue', jinak text, jak přišel; `null` = chybí. */
  rezimOdectu: string | null
}

/** Odpověď manifestu → nastavení jedné provozovny. `'nenalezeno'` = provozovna v manifestu není, `null` = tvar, kterému appka nerozumí. */
export function naparsovatManifest(telo: unknown, provozovna: string): ManifestProvozovny | 'nenalezeno' | null {
  const pobocky = telo && typeof telo === 'object' && !Array.isArray(telo) ? (telo as Record<string, unknown>).branches : undefined
  if (!Array.isArray(pobocky)) return null
  for (const b of pobocky) {
    if (!b || typeof b !== 'object') continue
    const r = b as Record<string, unknown>
    if (idText(r.branchId) !== provozovna) continue
    const funkce = Array.isArray(r.features) ? r.features : []
    return {
      licence: ano(r.isLicensed),
      posAkce: funkce.some((f) => f === 'posAction'),
      rezimOdectu: text(r.stockDeductionMode, 40),
    }
  }
  return 'nenalezeno'
}

/**
 * Režimy, ve kterých odpis přes POS akci opravdu odečte sklad
 * (entity/cloud-manifest). Jen `documentIssue` (odečet při vystavení
 * dokladu): `order/create-issue-pay` účet vystaví a zaplatí, ale nikdy
 * nezaparkuje, takže u `orderPark` (odečet při zaparkování) by účet
 * vypadal jako hotový odpis a sklad by mohl zůstat beze změny — a appka by
 * hlásila „Odečteno v POS“. Přidat `orderPark` jen po ověření na
 * testovacím cloudu (docs/jine-platby-vydej-dotykacka.md, oddíl 6).
 */
const REZIMY_S_ODECTEM = ['documentIssue']

/**
 * Smí se do provozovny POS akce vůbec poslat? `null` = ano, jinak důvod
 * (a jestli pomůže zkusit to později). Nic z toho se neposílá — odmítnutí
 * před odesláním je vždycky „nic se neprovedlo".
 */
export async function overitProvozovnuProVydej(
  k: KontextDotykacky,
  provozovna: string,
): Promise<null | { duvod: string; docasna: boolean }> {
  const odpoved = await k.pozadavek(`${k.api}/clouds/${k.cloudId}/manifest`, { headers: k.hlavicky })
  if (jeChyba(odpoved)) return { duvod: `Nastavení provozovny v Dotykačce se nepodařilo přečíst (${odpoved.duvod}) — nic se neodeslalo.`, docasna: true }
  if (odpoved.status !== 200) {
    const chyba = k.chybaZeStavu(odpoved.status, 'čtení nastavení provozovny', odpoved.telo)
    return { duvod: `${chyba.duvod} Nic se neodeslalo.`, docasna: chyba.druh === 'docasna' }
  }
  const m = naparsovatManifest(odpoved.telo, provozovna)
  if (m === null) return { duvod: 'Nastavení provozovny z Dotykačky má neočekávaný tvar — nic se neodeslalo.', docasna: false }
  if (m === 'nenalezeno') return { duvod: 'Provozovna v nastavení cloudu Dotykačky není — nic se neodeslalo.', docasna: false }
  if (m.licence !== true) return { duvod: 'Provozovna nemá v Dotykačce aktivní licenci — nic se neodeslalo.', docasna: false }
  if (!m.posAkce) return { duvod: 'Licence provozovny neumí POS akce (chybí posAction, potřeba premium) — výdej zpracujte ručně. Nic se neodeslalo.', docasna: false }
  if (m.rezimOdectu === 'disabled') return { duvod: 'Provozovna má v Dotykačce vypnutý odečet ze skladu — odpis by sklad neodečetl. Nic se neodeslalo.', docasna: false }
  if (m.rezimOdectu === null || !REZIMY_S_ODECTEM.includes(m.rezimOdectu)) {
    return { duvod: 'Režim odečtu skladu provozovny appka nezná — nejde ověřit, že odpis sklad odečte. Nic se neodeslalo.', docasna: false }
  }
  return null
}

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
 * K RELACI SE PŘIPOJÍ JEN PRO POVOLENÉ PROVOZOVNY. Adaptér
 * (`vytvoritDotykacku().otevrit()`) připojí `zapisVydejeDotykacka` jen
 * cloudu, který má provozovnu v `ZAPIS_VYDEJE_DOTYKACKA`
 * (lib/pokladna-dotykacka-zapis.ts) — a ten seznam je PRÁZDNÝ. Pravidlo
 * projektu: „bezpečné, protože to nikdo nezapnul" není pojistka — proto je
 * schopnost odebraná v kódu (hlídá `scripts/pokladna-dotykacka-sklad.test.mjs`).
 *
 * Pořadí: kontrola tvaru (nic neodejde) → manifest provozovny (licence
 * `posAction`, `stockDeductionMode` ≠ `disabled`; nic neodejde, když
 * nesedí) → POS akce. Co ověřit na testovacím cloudu, než se řádek do
 * seznamu přidá: docs/jine-platby-vydej-dotykacka.md, oddíl 6.
 *
 * KDO DÁ POKYN: Šéfík, výslovně (otázka 54). Do té doby výdej dělá člověk
 * v pokladně a appka eviduje „ručně doloženo".
 */
export async function odeslatVydejDotykacka(k: KontextDotykacky, v: VydejDotykacka, tedMs: number = Date.now()): Promise<VysledekOdeslani> {
  const sestaveno = sestavitTeloVydeje(v, tedMs)
  if ('chyba' in sestaveno) return { stav: 'odmitnuto', duvod: sestaveno.chyba, kod: null, docasna: false }

  // Manifest PŘED odesláním: s vypnutým odečtem nebo bez licence POS akcí by
  // účet vznikl (nebo požadavek padl), ale sklad by se neodečetl.
  const nelze = await overitProvozovnuProVydej(k, v.provozovna)
  if (nelze) return { stav: 'odmitnuto', duvod: nelze.duvod, kod: null, docasna: nelze.docasna }

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
/* Napojení na orchestrátor operací (N20)                               */
/* ------------------------------------------------------------------ */

/**
 * Výdej orchestrátoru (`VydejPos` z kontraktu, nadmnožina je `OperacePos`
 * z lib/jine-platby-pos-operace.ts, jak ji předá `provestOperaci` po
 * zabrání) → tvar zápisu Dotykačky (`VydejDotykacka`). Tvary se liší
 * jménem i jednotkou:
 *   externiProvozovna  → provozovna
 *   platnostDo (ISO)   → platnostDoMs (epoch ms; Dotykačka bere ms)
 * Bez převodu by připojení `(v) => odeslatVydejDotykacka(k, v)` odmítlo
 * každý výdej bez volání („Neplatné id provozovny") a uživatel by
 * zkoušel znovu dokola (kontrola 19. 10.).
 *
 * `{ chyba }` = nic se neodešle (chybí platnost nebo provozovna).
 * Provozovnu u pokladny připojené k pobočce doplní databáze při zabrání
 * (`pos_operace_zahajit` → `app.jp_provozovna_vydeje`, migrace
 * 20261101100000); bez ní zabrání neprojde a sem se nic nedostane.
 */
export function vydejZOperace(op: VydejPos): VydejDotykacka | { chyba: string } {
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
 * Metoda zápisu pro relaci pokladny (`RelacePos.skladovyVydej`, kterou
 * orchestrátor dostane v akce-pos.ts jako `odeslat`). `povolene` =
 * provozovny z `ZAPIS_VYDEJE_DOTYKACKA` pro tenhle cloud: provozovna mimo
 * ně se odmítne DŘÍV, než cokoli odejde — i kdyby se relace s metodou
 * zápisu dostala k operaci jiné provozovny. Typ hlídá `tsc`: kdyby se tvar
 * operace nebo výsledku rozešel s kontraktem, překlad spadne.
 */
export function zapisVydejeDotykacka(k: KontextDotykacky, povolene: ReadonlySet<string>): NonNullable<RelacePos['skladovyVydej']> {
  return async (op) => {
    const v = vydejZOperace(op)
    if ('chyba' in v) return { stav: 'odmitnuto', duvod: v.chyba, kod: null, docasna: false }
    if (!povolene.has(v.provozovna)) {
      return {
        stav: 'odmitnuto',
        duvod: 'Zápis do Dotykačky není pro tuhle provozovnu povolený — výdej zpracujte v pokladně ručně a doložte. Nic se neodeslalo.',
        kod: null,
        docasna: false,
      }
    }
    return odeslatVydejDotykacka(k, v)
  }
}
