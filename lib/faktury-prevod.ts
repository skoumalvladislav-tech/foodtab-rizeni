/**
 * Převod faktur ze staré databáze (Supabase projekt ctqtwahlzhyjerqulqyn,
 * tabulka `invoices`) do hlavní (`public.faktury`) — čistá logika, bez sítě.
 *
 * Návrh a pořadí kroků: docs/faktury-slouceni-navrh.md. Síť, databáze
 * a úložiště jsou v lib/faktury-prevod-sync.ts; tady je jen to, co se dá
 * ověřit Nodem bez čehokoli (scripts/faktury-prevod.test.mjs).
 *
 * ---------------------------------------------------------------------
 * PRAVIDLA PŘEVODU
 *
 * * `id` se ZACHOVÁVÁ — párování plateb a evidence příjmu na něj odkazují.
 * * Částka: `amount` (Kč s haléři, numeric) → `castka_haleru` (celé
 *   haléře). Musí vyjít PŘESNĚ — víc než dvě nenulová desetinná místa,
 *   nečíslo nebo částka mimo `integer` je ANOMÁLIE a převod se nedokončí.
 *   Nic se nezaokrouhluje potichu.
 * * Text, data a stav beze změny, i prázdné řetězce.
 * * Prázdné příznaky (`null` u needs_review/is_duplicate/is_archived) →
 *   `false`. Appka je i dnes čte jako `=== true`, takže se tím nic
 *   nemění; počet se ale vykáže (normalizace), ať je to vidět.
 * * `updated_at` se nepřenáší jako údaj, který se porovnává — v obou
 *   databázích ho přepisuje spoušť při každé změně.
 *
 * ---------------------------------------------------------------------
 * MĚŘENÍ A OTISK — dva nezávislé zápisy téhož pořadí polí
 *
 * `kanonickyTextStareho` čte STARÁ jména sloupců, `kanonickyTextHlavniho`
 * NOVÁ. Je to schválně — kdyby se otisk skládal z MAPA_SLOUPCU, prohozená
 * dvojice v mapě (duzp ↔ due_date) by se promítla do obou stran stejně
 * a otisk by prošel. Takhle spadne: hlavní databáze má v `duzp` hodnotu,
 * kterou stará měla v `due_date`. Hlídá to scripts/faktury-prevod.test.mjs.
 *
 * Databáze otisk nepočítá — porovnává pole po poli sama
 * (app.faktury_prevod_porovnat v 20261018100000_faktury_v_hlavni_databazi.sql,
 * kopie staré databáze proti hlavní). Časy obě strany porovnávají na
 * MIKROSEKUNDY (přesnost timestamptz): kdyby JS sekl na milisekundy,
 * převod by změnu pod milisekundu „neviděl" a dokončení by ji v SQL
 * pokaždé odmítlo — převod by uvízl.
 *
 * Bez `server-only` a s příponami `.ts` v importech — běží přímo Nodem.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------
// Tvar řádků
// ---------------------------------------------------------------------

/** Řádek `invoices` ve staré databázi, jak ho vrací PostgREST (`select=*`). */
export type RadekStare = {
  id: string
  received_at: string | null
  email_sender: string | null
  email_subject: string | null
  supplier: string | null
  supplier_ico: string | null
  invoice_number: string | null
  variable_symbol: string | null
  amount: number | string | null
  currency: string | null
  issue_date: string | null
  duzp: string | null
  due_date: string | null
  supplier_account: string | null
  status: string | null
  needs_review: boolean | null
  onedrive_url: string | null
  pdf_url: string | null
  reminder_sent_at: string | null
  created_at: string | null
  updated_at?: string | null
  is_duplicate: boolean | null
  is_archived: boolean | null
  review_note: string | null
  document_text_excerpt: string | null
}

/** Řádek `public.faktury` — jen sloupce, které mají protějšek ve staré databázi. */
export type RadekHlavni = {
  id: string
  tenant_id: string
  prijato_kdy: string
  email_odesilatel: string | null
  email_predmet: string | null
  dodavatel: string
  dodavatel_ico: string | null
  cislo_faktury: string | null
  variabilni_symbol: string | null
  castka_haleru: number
  mena: string
  datum_vystaveni: string | null
  duzp: string | null
  splatnost: string | null
  ucet_dodavatele: string | null
  stav: string
  ke_kontrole: boolean
  duplicita: boolean
  archivovano: boolean
  poznamka_kontroly: string | null
  upominka_odeslana_kdy: string | null
  vytah_textu: string | null
  odkaz_pdf: string | null
  odkaz_onedrive: string | null
  vytvoreno_kdy: string
}

/** Sloupce RadekHlavni pro `select` z hlavní databáze. */
export const SLOUPCE_HLAVNI =
  'id, tenant_id, prijato_kdy, email_odesilatel, email_predmet, dodavatel, dodavatel_ico, cislo_faktury, ' +
  'variabilni_symbol, castka_haleru, mena, datum_vystaveni, duzp, splatnost, ucet_dodavatele, stav, ke_kontrole, ' +
  'duplicita, archivovano, poznamka_kontroly, upominka_odeslana_kdy, vytah_textu, odkaz_pdf, odkaz_onedrive, vytvoreno_kdy'

/** Sloupce RadekStare pro `select` ze staré databáze (bez updated_at — neporovnává se). */
export const SLOUPCE_STARE =
  'id, received_at, email_sender, email_subject, supplier, supplier_ico, invoice_number, variable_symbol, amount, ' +
  'currency, issue_date, duzp, due_date, supplier_account, status, needs_review, onedrive_url, pdf_url, ' +
  'reminder_sent_at, created_at, is_duplicate, is_archived, review_note, document_text_excerpt'

type Druh = 'text' | 'text_povinny' | 'datum' | 'cas' | 'cas_povinny' | 'priznak' | 'castka'

/**
 * Stará jména → nová, s druhem převodu. JEDINÉ místo, kde se mapuje —
 * převod tam i zpátky (návrat) jdou přes ni.
 */
export const MAPA_SLOUPCU: readonly (readonly [keyof RadekStare, keyof RadekHlavni, Druh])[] = [
  ['received_at', 'prijato_kdy', 'cas_povinny'],
  ['email_sender', 'email_odesilatel', 'text'],
  ['email_subject', 'email_predmet', 'text'],
  ['supplier', 'dodavatel', 'text_povinny'],
  ['supplier_ico', 'dodavatel_ico', 'text'],
  ['invoice_number', 'cislo_faktury', 'text'],
  ['variable_symbol', 'variabilni_symbol', 'text'],
  ['amount', 'castka_haleru', 'castka'],
  ['currency', 'mena', 'text_povinny'],
  ['issue_date', 'datum_vystaveni', 'datum'],
  ['duzp', 'duzp', 'datum'],
  ['due_date', 'splatnost', 'datum'],
  ['supplier_account', 'ucet_dodavatele', 'text'],
  ['status', 'stav', 'text_povinny'],
  ['needs_review', 'ke_kontrole', 'priznak'],
  ['is_duplicate', 'duplicita', 'priznak'],
  ['is_archived', 'archivovano', 'priznak'],
  ['review_note', 'poznamka_kontroly', 'text'],
  ['reminder_sent_at', 'upominka_odeslana_kdy', 'cas'],
  ['document_text_excerpt', 'vytah_textu', 'text'],
  ['pdf_url', 'odkaz_pdf', 'text'],
  ['onedrive_url', 'odkaz_onedrive', 'text'],
  ['created_at', 'vytvoreno_kdy', 'cas_povinny'],
]

const VZOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VZOR_DATUM = /^\d{4}-\d{2}-\d{2}$/
const MAX_INTEGER = 2147483647

// ---------------------------------------------------------------------
// Částka a čas
// ---------------------------------------------------------------------

/**
 * Kč s haléři → celé haléře, PŘESNĚ. Přes text, ne násobením (0,07 × 100
 * je v JS 7,000000000000001). `null` = částka nejde převést beze ztráty.
 */
export function castkaNaHalere(castka: number | string | null | undefined): number | null {
  if (castka === null || castka === undefined) return null
  if (typeof castka === 'number' && !Number.isFinite(castka)) return null
  const text = (typeof castka === 'number' ? String(castka) : castka).trim()
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!m) return null
  const [, znamenko, cele, desetinne = ''] = m
  if (/[1-9]/.test(desetinne.slice(2))) return null
  const halere = Number(cele) * 100 + Number((desetinne + '00').slice(0, 2))
  if (!Number.isSafeInteger(halere) || halere > MAX_INTEGER) return null
  return znamenko === '-' ? -halere : halere
}

/** Celé haléře → text částky pro `numeric(12,2)` ve staré databázi (návrat). */
export function halereNaCastku(halere: number): string {
  const abs = Math.abs(halere)
  return `${halere < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// BigInt bez literálů `1000n` — tsconfig míří na ES2017.
const TISIC = BigInt(1000)
const NULA = BigInt(0)
const JEDNA = BigInt(1)

/**
 * Okamžik → mikrosekundy od 1970 (přesnost timestamptz). Vlastní rozbor,
 * ne Date.parse: šest desetinných míst z PostgRESTu musí dopadnout stejně
 * na každém Nodu a Date má jen milisekundy. Víc než šest míst Postgres
 * nevydá; kdyby přišla, sedmé a další se useknou. `null` = není to
 * rozpoznatelný okamžik.
 */
export function casNaMikro(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(text.trim())
  if (!m) return null
  const [, r, mes, d, h, min, s, zlomek = '', pasmo = 'Z'] = m
  let ms = Date.UTC(Number(r), Number(mes) - 1, Number(d), Number(h), Number(min), Number(s))
  if (!Number.isFinite(ms)) return null
  if (pasmo !== 'Z') {
    const pm = /^([+-])(\d{2}):?(\d{2})?$/.exec(pasmo)
    if (!pm) return null
    const posun = (Number(pm[2]) * 60 + Number(pm[3] ?? '0')) * 60_000
    ms -= pm[1] === '+' ? posun : -posun
  }
  return BigInt(ms) * TISIC + BigInt((zlomek + '000000').slice(0, 6))
}

/** Okamžik → milisekundy od 1970 (zbytek pod milisekundu useknutý). */
export function casNaMs(text: string | null | undefined): number | null {
  const mikro = casNaMikro(text)
  if (mikro === null) return null
  // Useknout k menší hodnotě i před rokem 1970 (dělení BigInt jde k nule).
  const ms = mikro / TISIC - (mikro % TISIC < NULA ? JEDNA : NULA)
  return Number(ms)
}

// ---------------------------------------------------------------------
// Převod řádku tam a zpátky
// ---------------------------------------------------------------------

export type VysledekPrevoduRadku =
  | { ok: true; radek: RadekHlavni; normalizace: string[] }
  | { ok: false; id: string; anomalie: string[] }

/**
 * Řádek staré databáze → řádek hlavní. Anomálie = něco, co by se převedlo
 * se ztrátou nebo by to databáze odmítla; takový řádek se nepřevede
 * a převod se nedá dokončit, dokud ho člověk ve staré databázi neopraví.
 */
export function naRadekHlavni(r: RadekStare, tenantId: string): VysledekPrevoduRadku {
  const anomalie: string[] = []
  const normalizace: string[] = []
  const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : ''
  if (!VZOR_UUID.test(id)) anomalie.push('id není uuid')

  const radek: Record<string, unknown> = { id, tenant_id: tenantId }
  for (const [stary, novy, druh] of MAPA_SLOUPCU) {
    const h = r[stary]
    switch (druh) {
      case 'text':
        radek[novy] = h === undefined ? null : h
        break
      case 'text_povinny':
        if (typeof h !== 'string') anomalie.push(`${stary} chybí`)
        radek[novy] = h
        break
      case 'datum':
        if (h !== null && h !== undefined && !(typeof h === 'string' && VZOR_DATUM.test(h))) anomalie.push(`${stary} není datum`)
        radek[novy] = h ?? null
        break
      case 'cas':
      case 'cas_povinny':
        if (h === null || h === undefined) {
          if (druh === 'cas_povinny') anomalie.push(`${stary} chybí`)
          radek[novy] = null
        } else {
          if (typeof h !== 'string' || casNaMs(h) === null) anomalie.push(`${stary} není čas`)
          radek[novy] = h
        }
        break
      case 'priznak':
        if (h === null || h === undefined) normalizace.push(`${stary}: prázdné → false`)
        else if (typeof h !== 'boolean') anomalie.push(`${stary} není ano/ne`)
        radek[novy] = h === true
        break
      case 'castka': {
        const halere = castkaNaHalere(h as number | string | null)
        if (halere === null) anomalie.push(`${stary} nejde převést na celé haléře`)
        radek[novy] = halere
        break
      }
    }
  }

  if (anomalie.length > 0) return { ok: false, id: id || String(r.id), anomalie }
  return { ok: true, radek: radek as RadekHlavni, normalizace }
}

/** Řádek hlavní databáze → řádek staré (návrat zpět, režim „zpet"). */
export function naRadekStare(h: RadekHlavni): Omit<RadekStare, 'amount'> & { amount: string } {
  const radek: Record<string, unknown> = { id: h.id }
  for (const [stary, novy, druh] of MAPA_SLOUPCU) {
    radek[stary] = druh === 'castka' ? halereNaCastku(h[novy] as number) : h[novy]
  }
  return radek as Omit<RadekStare, 'amount'> & { amount: string }
}

// ---------------------------------------------------------------------
// Kanonický text řádku (porovnání a otisk)
// ---------------------------------------------------------------------

const NIC = '\u0001'
const POLE = '\u001f'
const RADEK = '\u001e'

const t = (x: string | null | undefined) => (x === null || x === undefined ? NIC : x)
const b = (x: boolean | null | undefined) => (x === true ? '1' : '0')
const cas = (x: string | null | undefined) => {
  const v = casNaMikro(x)
  return v === null ? NIC : String(v)
}

/** Kanonický text řádku HLAVNÍ databáze. Pořadí = app.faktury_prevod_mereni. */
export function kanonickyTextHlavniho(r: RadekHlavni): string {
  return [
    r.id,
    String(r.castka_haleru),
    t(r.mena),
    t(r.stav),
    b(r.archivovano),
    b(r.duplicita),
    b(r.ke_kontrole),
    t(r.dodavatel),
    t(r.dodavatel_ico),
    t(r.cislo_faktury),
    t(r.variabilni_symbol),
    t(r.datum_vystaveni),
    t(r.duzp),
    t(r.splatnost),
    t(r.ucet_dodavatele),
    t(r.email_odesilatel),
    t(r.email_predmet),
    t(r.poznamka_kontroly),
    t(r.vytah_textu),
    t(r.odkaz_onedrive),
    t(r.odkaz_pdf),
    cas(r.prijato_kdy),
    cas(r.upominka_odeslana_kdy),
    cas(r.vytvoreno_kdy),
  ].join(POLE)
}

/**
 * Kanonický text řádku STARÉ databáze — stejné pořadí jako
 * kanonickyTextHlavniho, ale čte stará jména přímo (ne přes MAPA_SLOUPCU).
 * Částka nepřevoditelná na haléře dá NIC — taková faktura je anomálie
 * a dokončení ji stejně nepustí.
 */
export function kanonickyTextStareho(r: RadekStare): string {
  const halere = castkaNaHalere(r.amount)
  return [
    r.id.trim().toLowerCase(),
    halere === null ? NIC : String(halere),
    t(r.currency),
    t(r.status),
    b(r.is_archived),
    b(r.is_duplicate),
    b(r.needs_review),
    t(r.supplier),
    t(r.supplier_ico),
    t(r.invoice_number),
    t(r.variable_symbol),
    t(r.issue_date),
    t(r.duzp),
    t(r.due_date),
    t(r.supplier_account),
    t(r.email_sender),
    t(r.email_subject),
    t(r.review_note),
    t(r.document_text_excerpt),
    t(r.onedrive_url),
    t(r.pdf_url),
    cas(r.received_at),
    cas(r.reminder_sent_at),
    cas(r.created_at),
  ].join(POLE)
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex')

// ---------------------------------------------------------------------
// Měření
// ---------------------------------------------------------------------

export type Mereni = {
  pocet: number
  archivovanych: number
  duplicit: number
  ke_kontrole: number
  s_odkazem_pdf: number
  s_onedrive: number
  /** Součet částek v haléřích podle měny (klíč = měna, jak je zapsaná). */
  castky_haleru: Record<string, number>
  otisk_id: string
  otisk_obsahu: string
  /** Převedených vzorů odmítnutí. */
  vzoru: number
}

const neprazdny = (x: string | null | undefined) => x !== null && x !== undefined && x !== ''

/**
 * Měření STARÉ databáze — počítá ze starých jmen sloupců, nezávisle na
 * převodu. Protějšek v databázi: app.faktury_prevod_mereni (nad hlavní).
 */
export function mereniZdroje(radky: readonly RadekStare[], pocetVzoru: number): Mereni {
  const castky: Record<string, number> = {}
  for (const r of radky) {
    const mena = r.currency ?? ''
    castky[mena] = (castky[mena] ?? 0) + (castkaNaHalere(r.amount) ?? 0)
  }
  const serazene = [...radky].sort((a, c) => (a.id.toLowerCase() < c.id.toLowerCase() ? -1 : a.id.toLowerCase() > c.id.toLowerCase() ? 1 : 0))
  return {
    pocet: radky.length,
    archivovanych: radky.filter((r) => r.is_archived === true).length,
    duplicit: radky.filter((r) => r.is_duplicate === true).length,
    ke_kontrole: radky.filter((r) => r.needs_review === true).length,
    s_odkazem_pdf: radky.filter((r) => neprazdny(r.pdf_url)).length,
    s_onedrive: radky.filter((r) => neprazdny(r.onedrive_url)).length,
    castky_haleru: castky,
    otisk_id: md5(serazene.map((r) => r.id.trim().toLowerCase()).join(',')),
    otisk_obsahu: md5(serazene.map(kanonickyTextStareho).join(RADEK)),
    vzoru: pocetVzoru,
  }
}

/** Totéž nad řádky HLAVNÍ databáze v JS — pro náhled před dokončením a pro testy. */
export function mereniHlavni(radky: readonly RadekHlavni[], pocetVzoru: number): Mereni {
  const castky: Record<string, number> = {}
  for (const r of radky) castky[r.mena] = (castky[r.mena] ?? 0) + r.castka_haleru
  const serazene = [...radky].sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0))
  return {
    pocet: radky.length,
    archivovanych: radky.filter((r) => r.archivovano).length,
    duplicit: radky.filter((r) => r.duplicita).length,
    ke_kontrole: radky.filter((r) => r.ke_kontrole).length,
    s_odkazem_pdf: radky.filter((r) => neprazdny(r.odkaz_pdf)).length,
    s_onedrive: radky.filter((r) => neprazdny(r.odkaz_onedrive)).length,
    castky_haleru: castky,
    otisk_id: md5(serazene.map((r) => r.id).join(',')),
    otisk_obsahu: md5(serazene.map(kanonickyTextHlavniho).join(RADEK)),
    vzoru: pocetVzoru,
  }
}

/** Která měření se liší (klíče). Prázdné pole = shoda. */
export function rozdilyMereni(a: Mereni, b: Mereni): string[] {
  const klice = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Mereni>
  const rozdily: string[] = []
  for (const k of klice) {
    if (k === 'castky_haleru') {
      const meny = new Set([...Object.keys(a.castky_haleru ?? {}), ...Object.keys(b.castky_haleru ?? {})])
      for (const m of meny) if ((a.castky_haleru?.[m] ?? null) !== (b.castky_haleru?.[m] ?? null)) rozdily.push(`castky_haleru.${m}`)
    } else if (a[k] !== b[k]) {
      rozdily.push(k)
    }
  }
  return rozdily
}

// ---------------------------------------------------------------------
// Porovnání po řádcích
// ---------------------------------------------------------------------

export type Rozdil = {
  /** Ve zdroji jsou, v cíli ne → vložit. */
  chybi: string[]
  /** V obou, ale liší se → opravit (s názvy polí, bez hodnot). */
  lisi: { id: string; pole: string[] }[]
  /** V cíli jsou, ve zdroji ne → smazat. */
  navic: string[]
}

/**
 * Porovná dvě sady řádků ve tvaru hlavní databáze podle id. Pro převod
 * tam: zdroj = převedená stará, cíl = hlavní. Pro návrat: zdroj = hlavní,
 * cíl = převedená stará.
 */
export function porovnat(zdroj: readonly RadekHlavni[], cil: readonly RadekHlavni[]): Rozdil {
  const podleId = new Map(cil.map((r) => [r.id, r]))
  const zdrojIds = new Set(zdroj.map((r) => r.id))
  const chybi: string[] = []
  const lisi: { id: string; pole: string[] }[] = []
  for (const z of zdroj) {
    const c = podleId.get(z.id)
    if (!c) {
      chybi.push(z.id)
      continue
    }
    if (kanonickyTextHlavniho(z) === kanonickyTextHlavniho(c)) continue
    const pole = MAPA_SLOUPCU.map(([, novy]) => novy).filter((p) => {
      const kz = kanonickyTextHlavniho({ ...c, [p]: z[p] } as RadekHlavni)
      return kz !== kanonickyTextHlavniho(c)
    })
    lisi.push({ id: z.id, pole: pole.length > 0 ? pole : ['?'] })
  }
  const navic = cil.filter((r) => !zdrojIds.has(r.id)).map((r) => r.id)
  return { chybi, lisi, navic }
}

// ---------------------------------------------------------------------
// Vzory odmítnutí (rejection_examples)
// ---------------------------------------------------------------------

export type VzorStary = {
  id: number | string
  kind: string | null
  excerpt: string | null
  supplier_guess: string | null
  email_subject: string | null
  created_at: string | null
}

export type VzorHlavni = {
  tenant_id: string
  druh: string
  vytah: string
  dodavatel_odhad: string | null
  email_predmet: string | null
  puvodni_id: number
  vytvoreno_kdy: string
}

export function naVzorHlavni(v: VzorStary, tenantId: string): { ok: true; vzor: VzorHlavni } | { ok: false; anomalie: string[] } {
  const anomalie: string[] = []
  const id = typeof v.id === 'number' ? v.id : Number(v.id)
  if (!Number.isSafeInteger(id)) anomalie.push('id není celé číslo')
  if (typeof v.kind !== 'string' || v.kind.length < 1 || v.kind.length > 50) anomalie.push('kind chybí nebo je moc dlouhý')
  if (typeof v.excerpt !== 'string') anomalie.push('excerpt chybí')
  if (v.created_at === null || casNaMs(v.created_at) === null) anomalie.push('created_at není čas')
  if (anomalie.length > 0) return { ok: false, anomalie }
  return {
    ok: true,
    vzor: {
      tenant_id: tenantId,
      druh: v.kind as string,
      vytah: v.excerpt as string,
      dodavatel_odhad: v.supplier_guess,
      email_predmet: v.email_subject,
      puvodni_id: id,
      vytvoreno_kdy: v.created_at as string,
    },
  }
}

// ---------------------------------------------------------------------
// Přílohy
// ---------------------------------------------------------------------

/**
 * Je odkaz soubor ve VEŘEJNÉM úložišti staré databáze? Jen takové se
 * stahují — úloha nikdy nestáhne adresu, která vede jinam (odkaz je data
 * z databáze, ne pokyn, kam sahat).
 */
export function jeVerejnySouborStare(odkaz: string | null | undefined, adresaStare: string | null | undefined): boolean {
  if (!odkaz || !adresaStare) return false
  let zaklad: URL
  let cil: URL
  try {
    zaklad = new URL(adresaStare)
    cil = new URL(odkaz)
  } catch {
    return false
  }
  // `new URL` cestu normalizuje (`/a/../b` → `/b`), takže prefix se
  // kontroluje až na výsledné cestě — `..` z něj nevyleze.
  return cil.protocol === 'https:' && cil.origin === zaklad.origin && cil.pathname.startsWith('/storage/v1/object/public/')
    && cil.search === ''
}

/** Id evidence příjmu z odkazu `…/api/faktury/priloha/<id>` (faktury z vlastního příjmu), jinak null. */
export function idEvidenceZOdkazu(odkaz: string | null | undefined): string | null {
  if (!odkaz) return null
  const m = /\/api\/faktury\/priloha\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(odkaz.trim())
  return m ? m[1].toLowerCase() : null
}

/** Typ souboru podle obsahu (ne podle přípony v adrese). Jen typy, které soukromý kbelík přijme. */
export function typPrilohy(data: Uint8Array): { pripona: 'pdf' | 'jpg' | 'png' | 'webp' | 'xml'; mime: string } | null {
  const zacina = (...bajty: number[]) => bajty.every((x, i) => data[i] === x)
  if (zacina(0x25, 0x50, 0x44, 0x46)) return { pripona: 'pdf', mime: 'application/pdf' }
  if (zacina(0xff, 0xd8, 0xff)) return { pripona: 'jpg', mime: 'image/jpeg' }
  if (zacina(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { pripona: 'png', mime: 'image/png' }
  if (zacina(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return { pripona: 'webp', mime: 'image/webp' }
  const zacatek = new TextDecoder('utf-8', { fatal: false }).decode(data.slice(0, 64)).replace(/^﻿/, '').trimStart()
  if (zacatek.startsWith('<?xml')) return { pripona: 'xml', mime: 'application/xml' }
  return null
}

/** Cesta v kbelíku faktury-prilohy: <tenant>/<sha256>.<přípona> — obsah adresuje sám sebe. */
export function cestaPrilohy(tenantId: string, data: Uint8Array, pripona: string): string {
  return `${tenantId}/${createHash('sha256').update(data).digest('hex')}.${pripona}`
}

/** Soukromý kbelík bere nejvýš 10 MB (20261008100000_faktury_prijem_z_emailu.sql). */
export const MAX_VELIKOST_PRILOHY = 10 * 1024 * 1024

// ---------------------------------------------------------------------
// Kopie staré databáze: stejný řádek? (pro „změnilo se od převodu")
// ---------------------------------------------------------------------

/** JSON se seřazenými klíči — pořadí klíčů z PostgRESTu nesmí rozhodovat. */
export function stabilniJson(hodnota: unknown): string {
  if (hodnota === null || typeof hodnota !== 'object') return JSON.stringify(hodnota ?? null)
  if (Array.isArray(hodnota)) return `[${hodnota.map(stabilniJson).join(',')}]`
  const o = hodnota as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stabilniJson(o[k])}`).join(',')}}`
}

// ---------------------------------------------------------------------
// Návrat zpět (režim „zpet"): tři strany
// ---------------------------------------------------------------------

export type PlanNavratu = {
  /** Vznikly v appce po převodu → vložit do staré databáze. */
  vlozit: RadekHlavni[]
  /** Změněné v appce (a ve staré ne) → přepsat ve staré. */
  upravit: RadekHlavni[]
  /** Smazané v appce, ve staré beze změny → smazat ve staré. */
  smazat: string[]
  /** Změněné na obou stranách (nebo ve staré smazané) → NIC se nedělá, rozhodne člověk. */
  konflikty: { id: string; duvod: string }[]
  /** Změněné jen ve staré databázi (někdo do ní po převodu zapisoval) → nechá se, vykáže se. */
  zmenenaJenVeStare: string[]
  /** Ve staré databázi vznikly po převodu (cizí zápis) → nechá se, vykáže se. */
  jenVeStare: string[]
}

/**
 * Co přenést zpátky do staré databáze. Tři strany:
 *   zaklad — kopie staré databáze z okamžiku dokončení (faktury_prevod_zdroj),
 *   hlavni — public.faktury teď,
 *   stara  — stará databáze teď.
 * Pravidlo: staré databázi se přepíše jen to, co se od převodu změnilo
 * v appce a ve staré NE. Co se mezitím změnilo ve staré (do ní neměl
 * nikdo zapisovat — vykáže se), se nepřepisuje ani nemaže. Opakovaný
 * běh nic nezdvojí: co už ve staré odpovídá appce, se přeskočí.
 * Porovnává se kanonický text (bez času změny — ten přepisují spouště).
 */
export function planNavratu(
  zaklad: readonly RadekHlavni[],
  hlavni: readonly RadekHlavni[],
  stara: readonly RadekHlavni[],
): PlanNavratu {
  const z = new Map(zaklad.map((r) => [r.id, r]))
  const h = new Map(hlavni.map((r) => [r.id, r]))
  const s = new Map(stara.map((r) => [r.id, r]))
  const k = kanonickyTextHlavniho
  const plan: PlanNavratu = { vlozit: [], upravit: [], smazat: [], konflikty: [], zmenenaJenVeStare: [], jenVeStare: [] }

  for (const [id, rh] of h) {
    const rz = z.get(id)
    const rs = s.get(id)
    if (!rz) {
      // Vznikla v appce po převodu. Ve staré je jen, když ji tam vložil
      // dřívější běh návratu (spoušť staré databáze jí mohla přepsat stav).
      if (!rs) plan.vlozit.push(rh)
      else if (k(rs) !== k(rh)) plan.upravit.push(rh)
      continue
    }
    if (!rs) {
      plan.konflikty.push({ id, duvod: 've staré databázi po převodu smazaná' })
      continue
    }
    const zmenaH = k(rh) !== k(rz)
    const zmenaS = k(rs) !== k(rz)
    if (!zmenaH) {
      if (zmenaS) plan.zmenenaJenVeStare.push(id)
    } else if (!zmenaS) {
      plan.upravit.push(rh)
    } else if (k(rs) !== k(rh)) {
      plan.konflikty.push({ id, duvod: 'změněná v appce i ve staré databázi' })
    }
  }

  for (const [id, rz] of z) {
    if (h.has(id)) continue
    const rs = s.get(id)
    if (!rs) continue
    if (k(rs) === k(rz)) plan.smazat.push(id)
    else plan.konflikty.push({ id, duvod: 'v appce smazaná, ve staré databázi se mezitím změnila' })
  }

  for (const id of s.keys()) {
    if (!z.has(id) && !h.has(id)) plan.jenVeStare.push(id)
  }
  return plan
}
