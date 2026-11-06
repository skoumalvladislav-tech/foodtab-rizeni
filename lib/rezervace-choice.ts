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
 *   * Stoly (4. 11. 2026, Šéfík: „chybí například umístění a obsazení
 *     stolů“): rezervace nese `locationPoints` — id přidělených stolů.
 *     Jména dává seznam míst: `GET /location/:language/areas/list`
 *     (oblasti: Patro, Terasa…) a `GET /location/:language/points/list/:areaId`
 *     (stoly v oblasti). Načte se nejvýš jednou za běh (`nacistMapuMist`):
 *     u první stránky, kde nějaká rezervace stoly má, nebo — u napojení,
 *     kde běh stoly už jednou viděl (`externi_ucet.ma_stoly`, `mapaHned`)
 *     — hned na začátku běhu, souběžně s prvním dotazem. Do rezervace jde text
 *     „Patro: S1–S12“ (`mistoZChoice`). Limit 1 dotaz za 5 s je jen
 *     u `/bookings/list` (ostatní metody 60 za sekundu, api.md), proto
 *     seznam míst jde MIMO frontu dotazů. Místo ve frontě by vzalo čas
 *     dotazu na rezervace: úloha dává připojení tři (blízko, nové, okno)
 *     a druhé pobočce by se přestalo načítat okno (kontrola kódu 4. 11.).
 *     Hlídá se jen, aby se vešel do času běhu (`smiMimoFrontu`: odejít
 *     smí nejpozději se stejným koncem jako dotaz z fronty, a v úloze
 *     jen když nezdrží další připojení — `smiSeznamMist`
 *     v lib/rezervace-choice-sync.ts: celý, `NEJDELE_MAPA_MS`, se vejde
 *     do dílu, nebo u dílu, který dočítá úlohu, i se zápisem před
 *     hranici dalšího připojení; poslední připojení smí vždy). Načítá se SOUBĚŽNĚ
 *     s dalšími dotazy — na seznam čeká jen zápis stránky, ne další
 *     dotaz (jinak pomalý Choice vzal čas oknu, 2. kolo kontroly).
 *     Když se seznam nenačte, stoly u rezervací zůstanou z minula
 *     a rezervace se načítají dál.
 *   * Přání hosta (`preferArea`) jde zvlášť do `prani_zdroje` (pokaždé)
 *     a do prázdného „Stůl nebo prostor“ (jednou, databáze si poznamená
 *     `prostor_ze_zdroje` — vedle stolů ho kalendář neukáže).
 *   * `num` je číslo rezervace, jak ho ukazuje Choice („#105“).
 *   * `visitDuration` se nepřevádí (jednotka viz níž), ale běh si uloží
 *     pár ukázek s číslem rezervace (`ukazkaDelky` →
 *     `externi_ucet.ukazka_delky`). Choice u #105 ukazuje „2h“ — podle
 *     čísla u ní se jednotka pozná jistě, bez hádání.
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
 *   * Význam `digit` v odkazu na připojení. Víme jen to, že ho přiděluje
 *     Choice při vygenerování odkazu u aplikace (dashboard 25. 10. 2026)
 *     a bez něj odkaz nefunguje. Proto se připojuje JEN odkazem z Choice
 *     (`rozebratPodnik`) a `digit` z něj se pošle dál beze změny.
 *
 * Čistý modul: síť a čekání se podstrkují (`vytvoritChoice(fetchFn)`,
 * `probehnoutChoice({ … })`) — testuje ho scripts/rezervace-choice.test.mjs.
 */

import { createHash } from 'node:crypto'

import type { RadekRezervace, StavRezervace } from './reservation-provider-contract.ts'
import { zkratit, zRadkuZdroje, type RadekImportu } from './rezervace-import.ts'
import { pocet, sklonovat } from './sklonovani.ts'

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

export type Podnik = { subdomena: string; digit: string }

/** Proč odkaz neprošel — appka podle toho ukáže hlášku. */
export type ChybaOdkazu = 'bez-odkazu' | 'aplikace' | 'callback' | 'jine'

/**
 * Co majitel vloží: CELÝ ODKAZ NA PŘIPOJENÍ, který vygeneruje Choice
 * u aplikace Foodtab (vývojářský účet Choice → aplikace Foodtab →
 * „Connected company list“ → adresa podniku → Connect).
 *
 * Jen adresa podniku NESTAČÍ: odkaz nese parametr `digit` (4 číslice),
 * který přiděluje Choice při vygenerování odkazu. Foodtab ho nezná a
 * nevymyslí (zjištěno v dashboardu Choice 25. 10. 2026) — z pouhé
 * adresy by vznikl odkaz, se kterým se připojení nedokončí.
 *
 * Odkaz se ověří: podnik na choiceqr.com, stránka připojení, `digit`
 * číslicemi, `clientId` = aplikace Foodtab, `redirectUrl` (když je
 * v odkazu) = callback Foodtabu, `response_type` = code. Jinam se
 * nepřesměruje — appka na odkaz posílá prohlížeč.
 */
export function rozebratPodnik(
  vstup: string,
  clientId: string | null = null,
  callback: string | null = null,
): { stav: 'ok'; podnik: Podnik } | { stav: 'chyba'; duvod: string; kod: ChybaOdkazu } {
  const chyba = (duvod: string, kod: ChybaOdkazu = 'jine') => ({ stav: 'chyba' as const, duvod, kod })
  const BEZ_ODKAZU = 'Vložte celý odkaz na připojení z Choice (u aplikace Foodtab: Connected company list → adresa podniku → Connect). Jen adresa podniku nestačí — chybí v ní kód „digit“, který přiděluje Choice.'
  const JEN_CHOICE = 'Odkaz musí vést na podnik na choiceqr.com (např. https://mojerestaurace.choiceqr.com/admin/open-api/connect?…).'
  let t = vstup.trim()
  if (!t) return chyba(BEZ_ODKAZU, 'bez-odkazu')
  if (t.length > 2000) return chyba('Odkaz je moc dlouhý.')
  // Jen jméno podniku („mojerestaurace“).
  if (RE_SUBDOMENA.test(t.toLowerCase())) return chyba(BEZ_ODKAZU, 'bez-odkazu')

  if (!/^https?:\/\//i.test(t)) t = `https://${t}`
  let adresa: URL
  try {
    adresa = new URL(t)
  } catch {
    return chyba(BEZ_ODKAZU, 'bez-odkazu')
  }
  const host = adresa.hostname.toLowerCase()
  if (!host.endsWith(DOMENA_CHOICE) || adresa.username || adresa.password || adresa.port) return chyba(JEN_CHOICE)
  const subdomena = host.slice(0, -DOMENA_CHOICE.length)
  if (!RE_SUBDOMENA.test(subdomena) || subdomena === 'open-api' || subdomena === 'www') return chyba(JEN_CHOICE)
  if (adresa.pathname.replace(/\/+$/, '') !== '/admin/open-api/connect') return chyba(BEZ_ODKAZU, 'bez-odkazu')

  const digit = adresa.searchParams.get('digit') ?? ''
  if (!digit) return chyba(BEZ_ODKAZU, 'bez-odkazu')
  if (!/^\d{1,12}$/.test(digit)) return chyba('Odkaz z Choice má neobvyklý parametr „digit“ — zkopírujte ho z Choice znovu, celý.')

  const odkazovanyKlient = adresa.searchParams.get('clientId') ?? ''
  if (!odkazovanyKlient) return chyba('V odkazu chybí clientId aplikace — zkopírujte ho z Choice znovu, celý.')
  if (clientId && odkazovanyKlient !== clientId) {
    return chyba('Odkaz je vygenerovaný pro jinou aplikaci než Foodtab — v Choice ho vytvořte u aplikace „Foodtab“.', 'aplikace')
  }
  const odkazovanyNavrat = adresa.searchParams.get('redirectUrl')
  if (callback && odkazovanyNavrat && odkazovanyNavrat !== callback) {
    return chyba(`Odkaz z Choice vrací jinam než do Foodtabu. U aplikace Foodtab v Choice musí být Authorization callback URL ${callback}.`, 'callback')
  }
  const typ = adresa.searchParams.get('response_type')
  if (typ !== null && typ !== 'code') return chyba('Odkaz z Choice má neobvyklý response_type — zkopírujte ho z Choice znovu, celý.')

  return { stav: 'ok', podnik: { subdomena, digit } }
}

/**
 * Odkaz, na který se majitel přesměruje: odkaz z Choice s naším
 * podepsaným `customAttribute`. `redirectUrl` musí přesně sedět
 * s callbackem aplikace v Choice, `digit` je ten, který přidělil Choice.
 */
export function odkazPripojeni(v: { podnik: Podnik; clientId: string; redirectUrl: string; pokus: string }): string {
  const q = new URLSearchParams({
    clientId: v.clientId,
    redirectUrl: v.redirectUrl,
    customAttribute: v.pokus,
    scope: 'all',
    response_type: 'code',
    digit: v.podnik.digit,
  })
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
export type ChybaChoice = {
  stav: 'chyba'
  druh: 'pristup' | 'limit' | 'docasna' | 'data'
  duvod: string
  http: number | null
  /** Co Choice napsal do `message` (očištěné, nejvýš 200 znaků). Jen u odmítnutí 4xx s JSON tělem. */
  zprava?: string
}

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

async function zavolat(fetchFn: FetchFn, url: string, init: RequestInit, limitMs = CASOVY_LIMIT_MS): Promise<{ stav: 'ok'; data: unknown } | ChybaChoice> {
  let odpoved: Response
  try {
    odpoved = await fetchFn(url, { ...init, signal: AbortSignal.timeout(limitMs) })
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
    return { stav: 'chyba', druh: 'data', duvod: `Choice dotaz odmítl (${http})${zprava ? `: ${zprava}` : ''}.`, http, ...(zprava ? { zprava } : {}) }
  }
  return { stav: 'ok', data }
}

export type VymenaKodu = { stav: 'ok'; token: string; varSymbol: string; domena: string }

export type ApiChoice = {
  /** `POST /auth/connect/token` — kód z callbacku za token. Token se nikam nevypisuje. */
  vymenitKod(v: { code: string; clientId: string; secret: string }): Promise<VymenaKodu | ChybaChoice>
  /** `GET /bookings/list`. `null` = živý test (`page=1&perPage=1`). */
  nacistStranku(token: string, dotaz: DotazSeznamu | null): Promise<{ stav: 'ok'; rezervace: unknown[] } | ChybaChoice>
  /** `GET /location/cs/areas/list` — oblasti podniku (Patro, Terasa, Bar…). */
  nacistOblasti(token: string): Promise<{ stav: 'ok'; oblasti: unknown[] } | ChybaChoice>
  /** `GET /location/cs/points/list/:areaId` — stoly v jedné oblasti. */
  nacistMistaOblasti(token: string, oblastId: string): Promise<{ stav: 'ok'; mista: unknown[] } | ChybaChoice>
}

/* ---------------------------------------------------------------------
 * Seznam míst (stolů) v Choice
 * ------------------------------------------------------------------ */

/** Jazyk jmen v seznamu míst. */
export const JAZYK_MIST = 'cs'
/**
 * Časový limit jednoho dotazu na seznam míst. Kratší než u rezervací:
 * oblasti a pak stoly (souběžně) se musí vejít do rezervy, kterou běhu
 * nechá fronta dotazů (`REZERVA_DOTAZU_MS` v lib/rezervace-choice-sync.ts,
 * 20 s) — i se zápisem stránky.
 */
export const CASOVY_LIMIT_MIST_MS = 6_000
/**
 * Nejdéle, co trvá celý seznam míst: oblasti, pak stoly všech oblastí
 * souběžně — dva dotazy po sobě, každý se svým `CASOVY_LIMIT_MIST_MS`.
 * S touhle délkou počítá `smiMimoFrontu` (v úloze `smiSeznamMist`,
 * lib/rezervace-choice-sync.ts): na konec seznamu čeká zápis stránek,
 * a tím i konec běhu — pozdě začatý pomalý seznam ukousl čas dalšímu
 * připojení úlohy (kontrola kódu 4. 11., 3.–5. kolo).
 */
export const NEJDELE_MAPA_MS = 2 * CASOVY_LIMIT_MIST_MS
/** Nejvýš tolik oblastí se načte (každá = jeden dotaz). */
export const MAX_OBLASTI = 20
/** Text stolů u rezervace (`rezervace.misto_zdroje`). */
export const MAX_MISTO = 300

/** ObjectID z Choice (24 hex) — volněji, ale jen znaky, které do adresy patří. */
const RE_ID_CHOICE = /^[A-Za-z0-9_-]{1,64}$/

export function adresaOblasti(): string {
  return `${API_CHOICE}/location/${JAZYK_MIST}/areas/list`
}

export function adresaMistOblasti(oblastId: string): string {
  return `${API_CHOICE}/location/${JAZYK_MIST}/points/list/${encodeURIComponent(oblastId)}`
}

/** Id z Choice: řetězec, nebo objekt s `_id`. Cokoli jiného `null`. */
function idChoice(x: unknown): string | null {
  const v = typeof x === 'string'
    ? x.trim()
    : x && typeof x === 'object' && typeof (x as { _id?: unknown })._id === 'string' ? (x as { _id: string })._id.trim() : ''
  return RE_ID_CHOICE.test(v) ? v : null
}

const RAZENI_MIST = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' })

export type OblastChoice = { id: string; nazev: string }
/**
 * `oblast` = index do `MapaMist.oblasti`, `poradi` = pořadí stolu v oblasti
 * podle jména (S1, S2 … S12). Stůl, který v Choice jméno nemá, je v mapě
 * s `nazev` '' a `poradi` -1: Choice ho zná, jen se nedá napsat.
 */
export type MistoChoice = { oblast: number; poradi: number; nazev: string }
/**
 * `uplna` = načetly se VŠECHNY oblasti podniku. Když ne (víc než
 * `MAX_OBLASTI`), stůl, který v mapě není, může být v nenačtené oblasti —
 * pak se o něm neříká „bez názvu“ a stoly rezervace zůstanou z minula.
 */
export type MapaMist = { oblasti: string[]; mista: Map<string, MistoChoice>; uplna: boolean }

/**
 * Oblasti ze seznamu v pořadí Choice, bez id a opakované pryč. VŠECHNY,
 * i s `itemCount` 0: ten počet Choice počítá sám a může být starý —
 * přeskočená oblast by udělala ze skutečného stolu „bez názvu“. Kolik
 * se jich opravdu načte, řeší `nacistMapuMist` (`MAX_OBLASTI`).
 */
export function oblastiZOdpovedi(seznam: unknown[]): OblastChoice[] {
  const oblasti: OblastChoice[] = []
  const videne = new Set<string>()
  for (const x of seznam.slice(0, 1000)) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const o = x as Record<string, unknown>
    const id = idChoice(o._id)
    if (!id || videne.has(id)) continue
    videne.add(id)
    oblasti.push({ id, nazev: jmenoMista(o.name, MAX_JMENO_OBLASTI) })
  }
  return oblasti
}

/** Nejdelší jméno oblasti a stolu v textu stolů (delší se zkrátí a dostane „…“). */
export const MAX_JMENO_OBLASTI = 60
export const MAX_JMENO_STOLU = 40

/**
 * Jméno oblasti nebo stolu. Delší se zkrátí a dostane „…“: useknuté
 * „stolek 123“ → „stolek 12“ by byl JINÝ stůl (kontrola kódu 4. 11.,
 * 2. kolo). Tři tečky na konci zároveň jméno vyřadí z rozsahů
 * (`navazuje` chce číslo na konci).
 */
function jmenoMista(hodnota: unknown, max: number): string {
  const cele = cistyText(hodnota, 1000)
  return cele.length <= max ? cele : `${zkratit(cele, max - 1).trimEnd()}…`
}

/**
 * Mapa id stolu → oblast a jméno. `mistaPodleOblasti[i]` patří `oblasti[i]`.
 * Stůl bez jména v mapě JE (s `nazev` ''): Choice ho zná, takže to není
 * „stůl mimo seznam míst“.
 */
export function mapaMist(oblasti: OblastChoice[], mistaPodleOblasti: unknown[][], uplna = true): MapaMist {
  const mista = new Map<string, MistoChoice>()
  oblasti.forEach((_, i) => {
    const stoly: { id: string; nazev: string; pozice: number }[] = []
    for (const x of mistaPodleOblasti[i] ?? []) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) continue
      const m = x as Record<string, unknown>
      const id = idChoice(m._id)
      if (!id || mista.has(id) || stoly.some((s) => s.id === id)) continue
      stoly.push({ id, nazev: jmenoMista(m.name, MAX_JMENO_STOLU), pozice: typeof m.position === 'number' ? m.position : Infinity })
    }
    const sJmenem = stoly.filter((s) => s.nazev)
    sJmenem.sort((a, b) => RAZENI_MIST.compare(a.nazev, b.nazev) || a.pozice - b.pozice)
    sJmenem.forEach((s, poradi) => mista.set(s.id, { oblast: i, poradi, nazev: s.nazev }))
    for (const s of stoly) if (!s.nazev) mista.set(s.id, { oblast: i, poradi: -1, nazev: '' })
  })
  return { oblasti: oblasti.map((o) => o.nazev), mista, uplna }
}

export type VysledekMapy = { stav: 'ok'; mapa: MapaMist; dotazu: number } | { stav: 'chyba'; duvod: string; dotazu: number }

/**
 * Seznam míst celého podniku: oblasti, pak stoly oblastí souběžně
 * (Choice u téhle metody limit 1 za 5 s nemá), nejvýš `MAX_OBLASTI`
 * oblastí. Selže-li kterákoli část, selže celá mapa — s půlkou mapy by
 * se stoly z nenačtené oblasti ukázaly jako „bez názvu“ a přepsaly by
 * správné jméno z minula. Ze stejného důvodu mapa nad `MAX_OBLASTI`
 * oblastí není `uplna` (`mistoZChoice`).
 */
export async function nacistMapuMist(api: ApiChoice, token: string): Promise<VysledekMapy> {
  const o = await api.nacistOblasti(token)
  if (o.stav === 'chyba') return { stav: 'chyba', duvod: o.duvod, dotazu: 1 }
  const vsechny = oblastiZOdpovedi(o.oblasti)
  const oblasti = vsechny.slice(0, MAX_OBLASTI)
  const mista = await Promise.all(oblasti.map((x) => api.nacistMistaOblasti(token, x.id)))
  const dotazu = 1 + oblasti.length
  const chyba = mista.find((m) => m.stav === 'chyba')
  if (chyba && chyba.stav === 'chyba') return { stav: 'chyba', duvod: chyba.duvod, dotazu }
  return { stav: 'ok', mapa: mapaMist(oblasti, mista.map((m) => (m.stav === 'ok' ? m.mista : [])), vsechny.length <= MAX_OBLASTI), dotazu }
}

/** Id stolů rezervace bez opakování; `null` = rezervace stoly neuvádí (pole chybí nebo je nečitelné). */
function idStolu(locationPoints: unknown): string[] | null {
  if (!Array.isArray(locationPoints)) return null
  if (locationPoints.length === 0) return []
  const id = [...new Set(locationPoints.map(idChoice).filter((x): x is string => x !== null))]
  return id.length > 0 ? id : null
}

/** Má rezervace přidělené stoly (a je tedy potřeba seznam míst)? */
export function maStoly(rezervace: unknown): boolean {
  if (!rezervace || typeof rezervace !== 'object') return false
  const id = idStolu((rezervace as { locationPoints?: unknown }).locationPoints)
  return id !== null && id.length > 0
}

/** Kolik stolů rezervace v mapě není. */
export function neznameStoly(locationPoints: unknown, mapa: MapaMist): number {
  return (idStolu(locationPoints) ?? []).filter((id) => !mapa.mista.has(id)).length
}

const RE_CISLO_NA_KONCI = /^(.*?)(\d+)$/

/** Navazuje `b` na `a` jménem: stejná písmena před číslem a číslo o jedna vyšší (S9 → S10, „Stůl 2“ → „Stůl 3“). */
function navazuje(a: string, b: string): boolean {
  const x = RE_CISLO_NA_KONCI.exec(a)
  const y = RE_CISLO_NA_KONCI.exec(b)
  return x !== null && y !== null && x[1] === y[1] && Number(y[2]) === Number(x[2]) + 1
}

/** „S1–S12“, „Stůl 1–12“, „1–7“ — jen pro stoly, které `navazuje`. */
function rozsah(prvni: string, posledni: string): string {
  const b = RE_CISLO_NA_KONCI.exec(posledni)
  // Společné slovo („Stůl “) se podruhé nepíše; krátké označení („S“) ano.
  const predCislem = RE_CISLO_NA_KONCI.exec(prvni)?.[1] ?? ''
  return b && /\s$/.test(predCislem) ? `${prvni}–${b[2]}` : `${prvni}–${posledni}`
}

/**
 * Stoly jedné oblasti seřazené podle pořadí. Rozsahem („S1–S12“) se
 * píšou jen tři a víc stolů, které jdou po sobě V OBLASTI a zároveň
 * jménem (stejná písmena, čísla o jedna). Jinak by „L10, P1, P2“ vyšlo
 * jako „L10–P2“ a „S3, S10, Salonek“ jako „S3–Salonek“ — z toho obsluha
 * nepozná, které stoly to jsou (kontrola kódu 4. 11.).
 */
function stolyOblasti(stoly: MistoChoice[]): string[] {
  const casti: string[] = []
  for (let i = 0; i < stoly.length;) {
    let j = i
    while (j + 1 < stoly.length && stoly[j + 1].poradi === stoly[j].poradi + 1 && navazuje(stoly[j].nazev, stoly[j + 1].nazev)) j++
    if (j - i >= 2) casti.push(rozsah(stoly[i].nazev, stoly[j].nazev))
    else for (let k = i; k <= j; k++) casti.push(stoly[k].nazev)
    i = j + 1
  }
  return casti
}

/**
 * Text stolů z kousků (`[oblast, stoly][]`, pak „N stolů bez názvu“),
 * nejvýš `MAX_MISTO` znaků. Když se nevejde, končí „ …“ ZA celým stolem
 * nebo rozsahem — skládá se po kouscích, ne hledáním čárky v hotovém
 * textu: čárka nebo „ · “ může být i ve jménu stolu („Stůl 1, u okna“)
 * a řez by pak vzal půl jména (kontrola kódu 4. 11., 2. kolo). Z „Stůl
 * 117“ by zbylo „Stůl 11“, a to je jiný stůl.
 */
function slozitStoly(oblasti: [string, string[]][], navic: string[]): string {
  const cast = (oblast: string, stoly: string[]) => (oblast ? `${oblast}: ${stoly.join(', ')}` : stoly.join(', '))
  const cele = [...oblasti.map(([o, s]) => cast(o, s)), ...navic].join(' · ')
  if (cele.length <= MAX_MISTO) return cele
  const mez = MAX_MISTO - 2
  let text = ''
  for (const [oblast, stoly] of oblasti) {
    for (let i = 0; i < stoly.length; i++) {
      const kus = i === 0 ? `${text ? ' · ' : ''}${oblast ? `${oblast}: ` : ''}${stoly[0]}` : `, ${stoly[i]}`
      if (text.length + kus.length > mez) return `${text} …`
      text += kus
    }
  }
  for (const n of navic) {
    const kus = `${text ? ' · ' : ''}${n}`
    if (text.length + kus.length > mez) return `${text} …`
    text += kus
  }
  return text
}

/**
 * `locationPoints` rezervace → text stolů („Patro: S1–S12 · Terasa: L7“).
 *   * `undefined` = NEVÍ SE (pole chybí, seznam míst není, nebo stůl
 *     není v seznamu, který se nenačetl celý) — řádek klíč nedostane
 *     a ve Foodtabu zůstane uložené,
 *   * `''` = rezervace žádné stoly nemá (prázdné pole),
 *   * stůl, který v (celém) seznamu míst není, nebo v něm nemá jméno, se
 *     započítá („2 stoly bez názvu“) — jméno se nevymýšlí. Stůl bez jména
 *     ze známé oblasti se počítá U NÍ („Patro: 2 stoly bez názvu“), ať
 *     se neztratí aspoň oblast (kontrola kódu 4. 11., 3. kolo); jen stůl,
 *     který v seznamu není vůbec, je na konci bez oblasti
 *     (`RE_JEN_BEZ_NAZVU` v kalendáři).
 */
export function mistoZChoice(locationPoints: unknown, mapa: MapaMist | null): string | undefined {
  const id = idStolu(locationPoints)
  if (id === null) return undefined
  if (id.length === 0) return ''
  if (!mapa) return undefined
  const podleOblasti = new Map<number, { stoly: MistoChoice[]; bezNazvu: number }>()
  let nezname = 0
  for (const x of id) {
    const m = mapa.mista.get(x)
    if (!m) {
      if (!mapa.uplna) return undefined
      nezname += 1
      continue
    }
    const o = podleOblasti.get(m.oblast) ?? { stoly: [], bezNazvu: 0 }
    if (m.nazev) o.stoly.push(m)
    else o.bezNazvu += 1
    podleOblasti.set(m.oblast, o)
  }
  const bezNazvu = (n: number) => `${pocet(n, 'stůl', 'stoly', 'stolů')} bez názvu`
  const oblasti = [...podleOblasti.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([oblast, o]): [string, string[]] => [
      mapa.oblasti[oblast] ?? '',
      [...stolyOblasti(o.stoly.sort((a, b) => a.poradi - b.poradi)), ...(o.bezNazvu > 0 ? [bezNazvu(o.bezNazvu)] : [])],
    ])
  return slozitStoly(oblasti, nezname > 0 ? [bezNazvu(nezname)] : [])
}

/** `num` → číslo rezervace v Choice („105“). Cokoli jiného než kladné celé číslo `undefined`. */
export function cisloZChoice(num: unknown): string | undefined {
  const n = typeof num === 'number' ? num : typeof num === 'string' && /^\d{1,12}$/.test(num.trim()) ? Number(num) : NaN
  return Number.isSafeInteger(n) && n >= 1 ? String(n) : undefined
}

export function vytvoritChoice(fetchFn: FetchFn): ApiChoice {
  return {
    async vymenitKod({ code, clientId, secret }) {
      const r = await zavolat(fetchFn, `${API_CHOICE}/auth/connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ code, clientId, secret }),
      })
      // Text chyby od Choice se ukáže, ale kód z něj zmizí („…“) — jinak by
      // skončil v posledni_chyba u napojení. 26. 10. 2026 Choice odpověděl
      // `400 Invalid credentials` a obecná věta „kód nepřijal“ schovala
      // příčinu: při povolení byl zadán ChoiceQR token jiného podniku (token
      // Bernard Baru u odkazu Černé Perly). Se správným tokenem prošlo.
      if (r.stav === 'chyba') {
        if (r.druh === 'data') {
          const odChoice = r.zprava ? (code ? r.zprava.split(code).join('…') : r.zprava) : ''
          const rada = /invalid credentials/i.test(odChoice)
            ? 'Choice nepřijal povolení — nejčastěji byl při povolení zadán ChoiceQR token JINÉHO podniku (token od api@choiceqr.com platí pro jeden podnik), méně často nesedí CHOICE_CLIENT_SECRET ve Vercelu (po změně Redeploy). Připojte podnik znovu novým odkazem.'
            : 'Kód platí krátce a jen jednou — připojte podnik znovu.'
          const { zprava: _zprava, ...bezZpravy } = r
          void _zprava
          return { ...bezZpravy, duvod: `Choice výměnu kódu odmítl (${r.http ?? '?'}${odChoice ? `: ${odChoice}` : ''}). ${rada}` }
        }
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

    async nacistOblasti(token) {
      const r = await zavolat(fetchFn, adresaOblasti(), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }, CASOVY_LIMIT_MIST_MS)
      if (r.stav === 'chyba') return r
      const oblasti = seznamZOdpovedi(r.data)
      if (!oblasti) return { stav: 'chyba', druh: 'data', duvod: 'Choice poslal seznam oblastí v nečekaném tvaru.', http: 200 }
      return { stav: 'ok', oblasti }
    },

    async nacistMistaOblasti(token, oblastId) {
      if (!RE_ID_CHOICE.test(oblastId)) return { stav: 'chyba', druh: 'data', duvod: 'Oblast z Choice má neplatné id.', http: null }
      const r = await zavolat(fetchFn, adresaMistOblasti(oblastId), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }, CASOVY_LIMIT_MIST_MS)
      if (r.stav === 'chyba') return r
      const mista = seznamZOdpovedi(r.data)
      if (!mista) return { stav: 'chyba', druh: 'data', duvod: 'Choice poslal seznam stolů v nečekaném tvaru.', http: 200 }
      return { stav: 'ok', mista }
    },
  }
}

/* ---------------------------------------------------------------------
 * Rezervace z Choice → řádek pro databázi
 * ------------------------------------------------------------------ */

/**
 * Řídicí znaky pryč (i \u0000, který databáze v JSONu odmítne celou
 * dávkou); konce řádků zůstávají. Zkrácení přes `zkratit`: obyčejné
 * `.slice` umí rozříznout emoji a takový JSON odmítne PostgREST CELÝ
 * (PGRST102) — stránka by se nezapsala a načítání by na ní uvázlo.
 */
function cistyText(hodnota: unknown, max: number): string {
  if (typeof hodnota !== 'string' && typeof hodnota !== 'number') return ''
  return zkratit(
    String(hodnota)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim(),
    max,
  )
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
 * poznámka restaurace v Choice (`note`), důvod zrušení (`cancelReason`),
 * stav zálohy, rezervace přes Google (`source.type`) a jazyk rezervace,
 * když není čeština (`langCode`). Patří Choice — každé načtení ho
 * přepíše. Poznámky obsluhy ve Foodtabu jsou zvlášť.
 *
 * Ze `source.type` se píše jen PARTNER_GOOGLE: INTERNAL a OPEN_API
 * dokumentace nevysvětluje a domýšlet se nemají.
 */
export function poznamkaZChoice(b: Record<string, unknown>): string {
  const casti: string[] = []
  const host = cistyText(b.comment, 2000)
  if (host) casti.push(host)
  const restaurace = cistyText(b.note, 3000)
  if (restaurace) casti.push(`Poznámka restaurace v Choice: ${restaurace}`)
  const zruseni = cistyText(b.cancelReason, 500)
  if (zruseni) casti.push(`Důvod zrušení v Choice: ${zruseni}`)
  const zaloha = popisZalohy(b.deposit)
  if (zaloha) casti.push(zaloha)
  const zdroj = b.source && typeof b.source === 'object' ? (b.source as { type?: unknown }).type : null
  if (zdroj === 'PARTNER_GOOGLE') casti.push('Rezervace přišla přes Google.')
  const jazyk = jazykRezervace(b.langCode)
  if (jazyk) casti.push(`Jazyk rezervace: ${jazyk}.`)
  return zkratit(casti.join('\n\n'), 4000)
}

const NAZVY_JAZYKU = new Intl.DisplayNames(['cs'], { type: 'language', fallback: 'none' })

/**
 * `langCode` → jméno jazyka česky („angličtina“), když to není čeština.
 * Kód samotný byl matoucí: „UK“ je ukrajinština, ne Británie (kontrola
 * kódu 4. 11., 2. kolo). Bere jazykovou značku i s dalšími částmi
 * (BCP 47: „en-GB“, „zh-Hant-TW“, „es-419“ → podle prvního kousku)
 * a třípísmenné kódy („ukr“). Neznámý kód zůstane kódem („kód XX“);
 * co jazykovou značkou není vůbec, `''`.
 */
export function jazykRezervace(langCode: unknown): string {
  const kod = typeof langCode === 'string' ? langCode.trim().toLowerCase() : ''
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/.exec(kod)
  if (!m || ['cs', 'cz', 'ces', 'cze'].includes(m[1])) return ''
  let nazev: string | undefined
  try {
    nazev = NAZVY_JAZYKU.of(m[1])
  } catch {
    nazev = undefined
  }
  return nazev && nazev.toLowerCase() !== m[1] ? nazev : `kód ${m[1].toUpperCase()}`
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
 * `mapa` = seznam míst podniku (`nacistMapuMist`); bez něj se stoly
 * rezervace, která nějaké má, nezapíšou (zůstanou z minula).
 */
export function radekZChoice(rezervace: unknown, varSymbol: string, mapa: MapaMist | null = null): VysledekRadku {
  if (!rezervace || typeof rezervace !== 'object' || Array.isArray(rezervace)) return { stav: 'chyba', id: '', duvod: 'jine' }
  const b = rezervace as Record<string, unknown>
  const id = typeof b._id === 'string' ? b._id.trim() : ''
  if (!id || id.length > 200 || !/^[\x21-\x7e]+$/.test(id)) return { stav: 'chyba', id: '', duvod: 'bez-id' }

  const cas = casZChoice(b.dateTime)
  if (cas.stav === 'chyba') return { stav: 'chyba', id, duvod: DUVOD_CASU[cas.duvod] }

  const { stav, stavZdroje } = stavZChoice(b.status)
  const host = (b.customer && typeof b.customer === 'object' ? b.customer : {}) as Record<string, unknown>
  const misto = mistoZChoice(b.locationPoints, mapa)
  const cislo = cisloZChoice(b.num)
  const prani = prostorZChoice(b.preferArea)
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
    // Oblast, kterou si host přál — databáze ji jen doplní do prázdného
    // „Stůl nebo prostor“ a poznamená si, že ji tam dal zdroj
    // (`prostor_ze_zdroje`, 20261107100000). Přidělené stoly jsou zvlášť
    // (`misto`). Doplní se, i když rezervace stoly má: vedle stolů ji
    // kalendář podle příznaku neukáže, ale kde se stoly nenačetly nebo
    // je databáze ještě stará (kód jde do provozu před db push), je to
    // jediné místo, kde host sedí. A prázdný prostor by se doplnil až ve
    // chvíli, kdy Choice stoly odebere — u akce to poslalo upozornění
    // „změněn prostor“ (kontrola kódu 4. 11., 3. kolo).
    prostor: prani || null,
    // Choice neposílá „změněno“. Tahá se vždy aktuální stav, takže pořadí
    // doručení tu nehraje roli (na rozdíl od webhooků).
    zmenenoKdy: null,
    ...(misto !== undefined ? { misto } : {}),
    ...(cislo !== undefined ? { cisloZdroje: cislo } : {}),
    // Přání zvlášť a pokaždé: „Stůl nebo prostor“ se doplní jen jednou,
    // tady je vždy to aktuální (kalendář a detail ukazují tohle).
    praniZdroje: prani,
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
  /**
   * Seznam míst (stolů) pro tenhle běh.
   *   * `stav`: `nezkouseno` = žádná rezervace stoly neměla, `ok`,
   *     `chyba` (Choice ho nedal, `duvod`), `cas` (nevešel se do běhu),
   *   * `neuplny`: seznam se načetl, ale ne celý (víc než `MAX_OBLASTI`
   *     oblastí),
   *   * `bezStolu`: rezervace se stoly, u kterých se stoly nezapsaly
   *     (zůstaly z minula), protože seznam míst není (nebo není celý
   *     a stůl v něm chybí),
   *   * `nezname`: rezervace se stolem, který v (celém) seznamu míst není,
   *   * `dotazu`: dotazů na seznam míst (mimo `dotazu` rezervací),
   *   * `videnyStoly`: aspoň jedna načtená rezervace měla stoly — ať se
   *     seznam načetl, nebo ne. Server si to u napojení zapamatuje
   *     (`externi_ucet.ma_stoly`) a příští běh pak seznam načte hned na
   *     začátku (`mapaHned`).
   */
  mista: { stav: 'nezkouseno' | 'ok' | 'chyba' | 'cas'; duvod: string | null; neuplny: boolean; bezStolu: number; nezname: number; dotazu: number; videnyStoly: boolean }
  /**
   * Pár rezervací s číslem a `visitDuration`, jak ho Choice poslal (nejvýš
   * `UKAZEK_DELKY`). Jednotka délky v dokumentaci není — podle rezervace,
   * u které je v Choice vidět „2h“, se pozná. Nic se z toho nepočítá.
   */
  ukazkaDelky: { cislo: string; hodnota: number }[]
  /**
   * Chyba zápisu stránky do Foodtabu. U `konec: 'chyba'` je i v `duvod`;
   * u `limit` a `pristup` (ty mají přednost) jen tady, ať se neztratí
   * z hlášky (`chybaBehu`).
   */
  chybaZapisu?: string
}

/** Kolik ukázek `visitDuration` si běh uloží (`externi_ucet.ukazka_delky`). */
export const UKAZEK_DELKY = 5

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
 *
 * `smiMimoFrontu(trvaniMs)`: smí ještě začít práce mimo frontu (seznam
 * míst), která potrvá nejvýš `trvaniMs`? Volající ji pustí nejpozději
 * se stejným koncem jako frontu (po něm zbývá rezerva na odpověď
 * a zápis) a v úloze jen tehdy, když nezdrží další připojení
 * (`smiSeznamMist` v lib/rezervace-choice-sync.ts).
 *
 * `mapaHned`: napojení stoly používá (minulý běh je viděl) — seznam míst
 * se začne načítat hned na začátku běhu, souběžně s prvním dotazem, ne
 * až u první stránky se stoly. Kontrola kódu 4. 11. (4. kolo): v úloze
 * se dvěma pobočkami jde první pořád první, a seznam, který se smí
 * načíst jen do konce jejího dílu, by se jí u stránek „nové“ a „okno“
 * nevešel nikdy — stoly rezervací dál než 48 h by nedostala.
 */
export async function probehnoutChoice(v: {
  api: ApiChoice
  token: string
  varSymbol: string
  kurzor: KurzorChoice
  tedMs: number
  pockatNaDotaz: () => Promise<boolean>
  smiMimoFrontu: (trvaniMs: number) => boolean
  zapsat: ZapisChoice
  mapaHned?: boolean
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
    mista: { stav: 'nezkouseno', duvod: null, neuplny: false, bezStolu: 0, nezname: 0, dotazu: 0, videnyStoly: false },
    ukazkaDelky: [],
  }

  type Pruchod = { podle: DotazSeznamu['podle']; od: string; do: string }
  const preskoceneId = new Set<string>()
  // Blízko a okno se překrývají — tatáž rezervace se ve stolech počítá jednou.
  const bezStoluId = new Set<string>()
  const neznameId = new Set<string>()

  /**
   * Seznam míst nejvýš jednou za běh: u první stránky, kde ho nějaká
   * rezervace potřebuje a kde se smí, nebo hned na začátku (`'hned'`,
   * `mapaHned`). Odmítnutí nic nezamyká — ani na začátku, ani u stránky:
   * zkusí to každá další stránka se stoly. Pravidlo `smiSeznamMist` totiž
   * s časem nejen ubírá: díl, který dočítá úlohu, smí zase, když je za
   * hranicí dalšího připojení. Kontrola kódu 4. 11. (6. kolo): zámek po
   * prvním odmítnutí nechal prostřední připojení úlohy bez stolů celý
   * běh, i když by je pozdější stránka smět načíst. Rezervace stránek,
   * které se zapsaly bez seznamu, mají stoly z minula (`bezStolu`).
   * MIMO frontu (hlavička modulu: místo ve frontě by vzalo
   * dotaz průchodu „okno“), ale jen dokud `smiMimoFrontu` — se stejným
   * koncem jako fronta, takže se oblasti i stoly (`CASOVY_LIMIT_MIST_MS`)
   * vejdou do rezervy běhu. Selhání nic dalšího nezastaví.
   *
   * Načítá se SOUBĚŽNĚ s dalšími dotazy na rezervace: na seznam čeká
   * zápis stránky (`zaradit`), ne další dotaz. Kontrola kódu 4. 11.
   * (2. kolo): dokud na něj čekal další dotaz, pomalý Choice (od ~3,7 s
   * na dotaz, nebo seznam, který visí do `CASOVY_LIMIT_MIST_MS`) vzal
   * dotazům místo ve frontě a druhé pobočce úlohy se nenačetlo okno.
   */
  let mapa: Promise<MapaMist | null> | undefined
  let mapaSeNacita = false
  const mapaPro = (rezervace: unknown[] | 'hned'): Promise<MapaMist | null> => {
    if (mapa) return mapa
    const hned = rezervace === 'hned'
    if (!hned && !rezervace.some(maStoly)) return Promise.resolve(null)
    if (!v.smiMimoFrontu(NEJDELE_MAPA_MS)) {
      // Teď se nevejde — tahle stránka se zapíše bez stolů (na začátku
      // běhu žádná) a zkusí to další stránka se stoly. Když se seznam
      // načte později, stav přepíše na „ok“.
      vysledek.mista.stav = 'cas'
      return Promise.resolve(null)
    }
    mapaSeNacita = true
    mapa = (async () => {
      let m: VysledekMapy
      try {
        m = await nacistMapuMist(v.api, v.token)
      } catch {
        m = { stav: 'chyba', duvod: 'Seznam stolů z Choice se nepodařilo přečíst.', dotazu: 1 }
      } finally {
        mapaSeNacita = false
      }
      vysledek.mista.dotazu += m.dotazu
      if (m.stav === 'ok') {
        vysledek.mista.stav = 'ok'
        vysledek.mista.neuplny = !m.mapa.uplna
        return m.mapa
      }
      vysledek.mista.stav = 'chyba'
      vysledek.mista.duvod = m.duvod
      return null
    })()
    return mapa
  }

  /**
   * Zápisy stránek (a posun kurzoru po nich) jdou popořadě v řadě
   * `zapisy`. Stránka, jejíž zápis selže, i všechno za ní se nezapíše
   * a kurzor dál neposune — jako dřív, kdy se zapisovalo hned. Další
   * dotaz na zápis čeká, jen dokud se načítá seznam míst
   * (`mapaSeNacita`); jinak se nejdřív dopíše, takže chyba zápisu
   * zastaví běh před dalším dotazem.
   */
  let zapisy: Promise<void> = Promise.resolve()
  let chybaZapisu: string | null = null
  let vyjimka: { e: unknown } | null = null
  const zaradit = (prace: () => Promise<void>) => {
    zapisy = zapisy.then(async () => {
      if (chybaZapisu !== null || vyjimka) return
      try {
        await prace()
      } catch (e) {
        vyjimka = { e }
      }
    })
  }

  /** `visitDuration` tak, jak přišel, s číslem rezervace — jen na ukázku (`ukazkaDelky`). */
  const zapamatovatDelku = (b: unknown, cislo: string | undefined) => {
    const hodnota = (b as { visitDuration?: unknown }).visitDuration
    if (!cislo || typeof hodnota !== 'number' || !Number.isFinite(hodnota)) return
    if (vysledek.ukazkaDelky.length >= UKAZEK_DELKY || vysledek.ukazkaDelky.some((u) => u.cislo === cislo)) return
    vysledek.ukazkaDelky.push({ cislo, hodnota })
  }

  const projit = async (p: Pruchod, odStranky: number, poStrance?: (dalsi: number) => void): Promise<KonecBehu> => {
    for (let stranka = odStranky; ; stranka++) {
      if (stranka > MAX_STRANKA) {
        vysledek.duvod = `V Choice je v jednom okně víc než ${MAX_STRANKA * NA_STRANKU} rezervací — načítání se zastavilo.`
        return 'chyba'
      }
      // Dopsat, co je v řadě — kromě chvíle, kdy zápis čeká na seznam míst.
      if (!mapaSeNacita) await zapisy
      if (chybaZapisu !== null || vyjimka) return 'chyba'
      if (!(await v.pockatNaDotaz())) return 'cas'
      // Zápis mohl selhat, zatímco se čekalo na frontu (seznam míst se
      // mezitím dočetl a zápis po něm doběhl) — dotaz pak už neodejde
      // (kontrola kódu 4. 11., 4. kolo).
      if (chybaZapisu !== null || vyjimka) return 'chyba'
      const r = await v.api.nacistStranku(v.token, { od: p.od, do: p.do, podle: p.podle, stranka, naStranku: NA_STRANKU })
      vysledek.dotazu += 1
      if (r.stav === 'chyba') {
        vysledek.duvod = r.duvod
        return r.druh === 'limit' ? 'limit' : r.druh === 'pristup' ? 'pristup' : 'chyba'
      }
      vysledek.nacteno += r.rezervace.length
      if (r.rezervace.some(maStoly)) vysledek.mista.videnyStoly = true

      const mapaStranky = mapaPro(r.rezervace)
      const dalsi = stranka + 1
      zaradit(async () => {
        const m = await mapaStranky
        // Běh mezitím spadl (výjimka mimo zápis) — nic dalšího nezapisovat.
        if (vyjimka) return
        const radky: RadekImportu[] = []
        const videna = new Set<string>()
        for (const b of r.rezervace) {
          const x = radekZChoice(b, v.varSymbol, m)
          if (x.stav === 'ok') {
            const id = x.radek.externi_id
            if (!videna.has(id)) {
              videna.add(id)
              radky.push(x.radek)
            }
            if (maStoly(b)) {
              if (x.radek.misto_zdroje === undefined) bezStoluId.add(id)
              else if (m && neznameStoly((b as { locationPoints?: unknown }).locationPoints, m) > 0) neznameId.add(id)
            }
            zapamatovatDelku(b, x.radek.cislo_zdroje)
            continue
          }
          // Blízko a okno se překrývají — tatáž vadná rezervace se počítá jednou.
          if (x.id && preskoceneId.has(x.id)) continue
          if (x.id) preskoceneId.add(x.id)
          vysledek.preskocene.pocet += 1
          vysledek.preskocene.duvody[x.duvod] = (vysledek.preskocene.duvody[x.duvod] ?? 0) + 1
          if (!vysledek.preskocene.priklad && x.id) vysledek.preskocene.priklad = x.id
        }

        if (radky.length > 0) {
          const z = await v.zapsat(radky)
          if (z.stav === 'chyba') {
            chybaZapisu = z.duvod
            return
          }
          vysledek.nove += z.souhrn.nove
          vysledek.zmenene += z.souhrn.zmenene
          vysledek.bezeZmeny += z.souhrn.bezeZmeny
          vysledek.odmitnute.pocet += z.souhrn.odmitnute.length
          if (!vysledek.odmitnute.priklad && z.souhrn.odmitnute[0]) vysledek.odmitnute.priklad = z.souhrn.odmitnute[0].id
        }

        vysledek.uspesnych += 1
        poStrance?.(dalsi)
      })
      if (r.rezervace.length < NA_STRANKU) return 'hotovo'
    }
  }

  /**
   * Konec běhu: nejdřív se dopíšou všechny stránky v řadě. Chyba zápisu
   * má přednost před tím, jak skončily dotazy — stránka, která se
   * nezapsala, byla dřív než dotazy po ní (dřív by se k nim běh ani
   * nedostal). Kromě 429 (`limit`) a odmítnutého přístupu (`pristup`):
   * ty se opravdu staly a podle nich úloha přestane Choice zatěžovat
   * a napojení se označí k opravě — chyba zápisu jde pak jen do hlášky
   * (`chybaZapisu`, kontrola kódu 4. 11., 3. kolo). Výjimka ze zápisu
   * letí ven jako dřív.
   */
  const konec = async (k: KonecBehu): Promise<VysledekBehuChoice> => {
    await zapisy
    if (vyjimka) throw (vyjimka as { e: unknown }).e
    if (chybaZapisu !== null) {
      vysledek.chybaZapisu = chybaZapisu
      if (k !== 'limit' && k !== 'pristup') {
        k = 'chyba'
        vysledek.duvod = chybaZapisu
      }
    }
    vysledek.konec = k
    vysledek.kurzor = kurzor
    vysledek.mista.bezStolu = bezStoluId.size
    vysledek.mista.nezname = neznameId.size
    return vysledek
  }

  /**
   * Výjimka mimo zápis (fronta dotazů, `pockatNaDotaz`) ukončí běh — ale
   * až když doběhne zápis, který právě běží (stránky v řadě za ním se už
   * nezapíšou). Volající podle výjimky zapíše běh jako spadlý a pustí
   * zámek; zápis, který by doběhl až po tom, by v databázi nechal něco,
   * o čem záznam běhu neví (kontrola kódu 4. 11., 3. kolo).
   */
  const projitVse = async (): Promise<VysledekBehuChoice> => {
    // Napojení stoly používá: seznam míst hned, souběžně s prvním dotazem.
    if (v.mapaHned) void mapaPro('hned')

    // 1. Blízko
    let k = await projit({ podle: 'bookingDt', od: iso(v.tedMs - BLIZKO_ZPET_MS), do: iso(v.tedMs + BLIZKO_DOPREDU_MS) }, 1)
    if (k !== 'hotovo') return konec(k)

    // 2. Nové
    const noveOd = Math.max(kurzor.nove_od ? Date.parse(kurzor.nove_od) - NOVE_PREKRYV_MS : v.tedMs - DEN_MS, v.tedMs - NOVE_NEJDAL_MS)
    k = await projit({ podle: 'createdDt', od: iso(noveOd), do: iso(v.tedMs) }, 1)
    if (k !== 'hotovo') return konec(k)
    // Až po zápisu všech stránek blízka a nových (řada `zapisy`).
    zaradit(async () => {
      kurzor.nove_od = iso(v.tedMs)
    })

    // 3. Okno
    if (!kurzor.okno || v.tedMs - Date.parse(kurzor.okno.zahajeno) > OKNO_ZASTARA_MS) {
      kurzor.okno = { od: iso(v.tedMs - OKNO_ZPET_MS), do: iso(v.tedMs + OKNO_DOPREDU_MS), stranka: 1, zahajeno: iso(v.tedMs) }
    }
    const okno = kurzor.okno
    k = await projit({ podle: 'bookingDt', od: okno.od, do: okno.do }, okno.stranka, (dalsi) => {
      kurzor.okno = { ...okno, stranka: dalsi }
    })
    if (k === 'hotovo') {
      zaradit(async () => {
        delete kurzor.okno
        kurzor.okno_hotovo_kdy = iso(v.tedMs)
        vysledek.oknoDokonceno = true
      })
    }
    return konec(k)
  }

  try {
    return await projitVse()
  } catch (e) {
    vyjimka ??= { e }
    await zapisy
    throw e
  }
}

/* ---------------------------------------------------------------------
 * Naplánovaná úloha: komu dát čas
 * ------------------------------------------------------------------ */

/**
 * Nejmenší díl času, který úloha připojení dá: tři dotazy (blízko, nové
 * a aspoň jedna stránka okna). Míň by znamenalo, že se připojení
 * „obslouží“, ale okno ani nové rezervace nikdy nedostane — a protože
 * obsloužené jde příště na konec, nedostalo by je ani pak.
 */
export const NEJMENE_NA_PRIPOJENI_MS = 3 * ROZESTUP_DOTAZU_MS

export type KandidatChoice = {
  id: string
  tenantId: string
  /** Podnik v Choice (`externi_ucet.var_symbol`); prázdný = token chybí, běh to ohlásí. */
  varSymbol: string
  zalozeno: string | null
  /** Začátek posledního běhu (`synchronizace_behy.zahajeno_kdy`) — píše jen server. */
  posledniBeh: string | null
}

const casNebo = (x: string | null, jinak: number) => {
  const ms = x ? Date.parse(x) : NaN
  return Number.isNaN(ms) ? jinak : ms
}

/**
 * Pořadí připojení pro naplánovanou úlohu. Úloha jich za běh stihne
 * jen pár (Choice: 1 dotaz za 5 s pro celou instalaci), takže pořadí
 * rozhoduje, kdo se kdy načte:
 *
 *   1. Tentýž podnik (`varSymbol`) u jedné firmy jen jednou — nejstarší
 *      připojení. Callback druhé nepustí, ale přímým zápisem do registru
 *      by šlo založit kolik chce kopií a každá by brala čas.
 *   2. Firmy se střídají: napřed firma, která se načítala nejdávněji
 *      (podle NEJNOVĚJŠÍHO běhu kteréhokoli jejího připojení), pak další;
 *      druhé připojení firmy přijde na řadu až po prvních připojeních
 *      všech firem. Víc připojení jedné firmy tak ostatním čas nevezme.
 *   3. Uvnitř firmy nejdéle nenačtené první.
 *
 * Všechno podle `synchronizace_behy` — ten píše jen server, takže si
 * nikdo pořadí nepřepíše (`posledni_sync_kdy` v registru může upravit
 * i správce napojení). Kdo se v běhu nedostal na řadu, nemá nový běh,
 * a příště jde první — připojení se tak střídají, i když se všechna do
 * jednoho běhu nevejdou.
 */
export function poradiSynchronizace(kandidati: KandidatChoice[]): string[] {
  const podleStari = (a: KandidatChoice, b: KandidatChoice) =>
    casNebo(a.posledniBeh, -Infinity) - casNebo(b.posledniBeh, -Infinity) || a.id.localeCompare(b.id)

  const firmy = new Map<string, KandidatChoice[]>()
  const videnePodniky = new Set<string>()
  const podleZalozeni = [...kandidati].sort((a, b) => casNebo(a.zalozeno, Infinity) - casNebo(b.zalozeno, Infinity) || a.id.localeCompare(b.id))
  for (const k of podleZalozeni) {
    if (k.varSymbol) {
      const klic = `${k.tenantId}|${k.varSymbol}`
      if (videnePodniky.has(klic)) continue
      videnePodniky.add(klic)
    }
    const seznam = firmy.get(k.tenantId) ?? []
    seznam.push(k)
    firmy.set(k.tenantId, seznam)
  }

  const poradiFirem = [...firmy.entries()]
    .map(([tenantId, seznam]) => ({
      tenantId,
      seznam: seznam.sort(podleStari),
      naposledy: Math.max(...seznam.map((k) => casNebo(k.posledniBeh, -Infinity))),
    }))
    .sort((a, b) => a.naposledy - b.naposledy || a.tenantId.localeCompare(b.tenantId))

  const vysledek: string[] = []
  const nejvic = Math.max(0, ...poradiFirem.map((f) => f.seznam.length))
  for (let kolo = 0; kolo < nejvic; kolo++) {
    for (const f of poradiFirem) {
      if (f.seznam[kolo]) vysledek.push(f.seznam[kolo].id)
    }
  }
  return vysledek
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
  if (v.chybaZapisu && (v.konec === 'limit' || v.konec === 'pristup')) casti.push(v.chybaZapisu)

  if (v.preskocene.pocet > 0) {
    const duvody = (Object.entries(v.preskocene.duvody) as [DuvodPreskoceni, number][])
      .map(([d, n]) => `${POPIS_PRESKOCENI[d]} ${n}×`)
      .join(', ')
    const n = v.preskocene.pocet
    casti.push(`${sklonovat(n, 'Nezapsala se', 'Nezapsaly se', 'Nezapsalo se')} ${pocet(n, 'rezervace', 'rezervace', 'rezervací')} z Choice (${duvody})${v.preskocene.priklad ? `, např. id ${v.preskocene.priklad}` : ''}.`)
  }
  if (v.odmitnute.pocet > 0) {
    casti.push(`Databáze odmítla ${pocet(v.odmitnute.pocet, 'rezervaci', 'rezervace', 'rezervací')} z Choice${v.odmitnute.priklad ? `, např. id ${v.odmitnute.priklad}` : ''}.`)
  }
  // Stoly: jen když se to opravdu dotklo nějaké rezervace. Došlý čas
  // (`cas`) chyba není — příští běh seznam míst načte.
  if (v.mista.stav === 'chyba' && v.mista.bezStolu > 0) {
    casti.push(`Stoly z Choice se nenačetly (${v.mista.duvod ?? 'neznámý důvod'}) — u ${pocet(v.mista.bezStolu, 'rezervace', 'rezervací', 'rezervací')} zůstávají naposledy načtené, rezervace se načítají dál.`)
  }
  if (v.mista.stav === 'ok' && v.mista.neuplny && v.mista.bezStolu > 0) {
    casti.push(`Stoly z Choice se nenačetly celé (podnik má v Choice víc než ${MAX_OBLASTI} částí, Foodtab jich načítá ${MAX_OBLASTI}) — u ${pocet(v.mista.bezStolu, 'rezervace', 'rezervací', 'rezervací')} zůstávají naposledy načtené. Pošlete prosím tu hlášku vývojáři.`)
  }
  if (v.mista.nezname > 0) {
    casti.push(`U ${pocet(v.mista.nezname, 'rezervace', 'rezervací', 'rezervací')} poslal Choice stůl, který v seznamu míst v Choice není — ve Foodtabu je „bez názvu“.`)
  }
  return casti.length > 0 ? zkratit(casti.join(' '), 1000) : null
}
