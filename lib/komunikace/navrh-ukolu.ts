/**
 * Návrh úkolu ze zprávy.
 *
 * ---------------------------------------------------------------------
 * CO TO JE — A CO NENÍ
 *
 * Je to PRAVIDLOVÝ návrh: čistá funkce nad textem jedné zprávy, která
 * hledá povel, termín (dnes, zítra, „v pátek“, „22. 9.“, „do 15:00“) a
 * naléhavost. Žádný jazykový model se nevolá a text zprávy server
 * neopouští.
 *
 * PROČ NE MODEL. CLAUDE.md, pravidlo 8, a docs/komunikace-zadani.md,
 * oddíl 3: z komunikace se nic neposílá jazykovému modelu — chat je po
 * mzdách nejcitlivější tabulka (lidé si píšou o nemoci, o výplatě, o
 * kolezích). Zapnout model může jen rozhodnutí vlastníka a uzavřený
 * vstupní typ (skill foodtab-ai). Až to nastane, přibude druhý
 * poskytovatel se stejným rozhraním; formulář a návrh se nezmění.
 * `modelovyPoskytovatel` je tu proto jako nedostupný a říká proč.
 *
 * ---------------------------------------------------------------------
 * NIC SE NEDOMÝŠLÍ
 *
 * Zadání marketingové AI to říká výslovně a platí to tady stejně:
 * „Nejasný údaj označí jako vyžaduje kontrolu.“ Termín, který ve zprávě
 * není, se nevymýšlí (zůstane prázdný). Termín, který je nejasný
 * („příští týden“, dva různé dny), se buď nenavrhne, nebo se navrhne a
 * označí k ověření. Návrh je vždy jen předvyplnění formuláře — úkol
 * vznikne až potvrzením člověka.
 *
 * Vstup je záměrně UZAVŘENÝ TYP (`VstupNavrhu`): text zprávy a den, kdy
 * byla napsaná. Jména, mzdy ani docházka se do něj vložit nedají.
 */

export type VstupNavrhu = {
  /** Text jedné zprávy. */
  text: string
  /** Den, kdy byla zpráva napsaná (YYYY-MM-DD, v pásmu pobočky). Od něj se počítá „zítra“. */
  dnes: string
}

export type PoleNavrhu = 'nazev' | 'termin' | 'priorita'

export type NavrhUkolu = {
  nazev: string
  /** Zbytek zprávy za názvem; ke kontrole a zkrácení, ať ho vidí jen ti, kdo mají. */
  poznamka: string
  termin: { datum: string; cas: string | null } | null
  priorita: 'normal' | 'high'
  /** Pole, u kterých si návrh není jistý — formulář je zvýrazní. */
  vyzadujeKontrolu: PoleNavrhu[]
  /** Co se ve zprávě poznalo, lidsky (ukazuje se pod formulářem). */
  nalezy: string[]
  zdroj: 'pravidla'
}

export type StavPoskytovatele =
  | { dostupny: true }
  | { dostupny: false; duvod: string }

export interface PoskytovatelNavrhuUkolu {
  readonly id: 'pravidla' | 'model'
  readonly popis: string
  stav(): StavPoskytovatele
  navrhnout(vstup: VstupNavrhu): Promise<NavrhUkolu | null>
}

const MAX_NAZEV = 80
const MAX_POZNAMKA = 300

/* ---------------------------------------------------------------------
   Pomocné funkce nad daty (YYYY-MM-DD). Počítá se v UTC nad čistým
   datem bez hodin, takže letní čas nic neposune.
   --------------------------------------------------------------------- */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

function zIso(iso: string): Date | null {
  const m = ISO.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

function doIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function pridejDny(iso: string, dny: number): string {
  const d = zIso(iso)
  if (!d) return iso
  d.setUTCDate(d.getUTCDate() + dny)
  return doIso(d)
}

/** 0 = neděle … 6 = sobota. */
function denVTydnu(iso: string): number {
  return (zIso(iso) ?? new Date(0)).getUTCDay()
}

/** Existuje takové datum (30. 2. neexistuje)? */
function platneDatum(rok: number, mesic: number, den: number): boolean {
  const d = new Date(Date.UTC(rok, mesic - 1, den))
  return d.getUTCFullYear() === rok && d.getUTCMonth() === mesic - 1 && d.getUTCDate() === den
}

const DNY_ZKRACENE = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']

function popisData(iso: string): string {
  const d = zIso(iso)
  if (!d) return iso
  return `${DNY_ZKRACENE[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`
}

/** Bez diakritiky a malými písmeny — jen pro HLEDÁNÍ, název se bere z původního textu. */
function bezDiakritiky(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/* ---------------------------------------------------------------------
   Termín
   --------------------------------------------------------------------- */

const DNY_TYDNE: { kmen: RegExp; den: number }[] = [
  { kmen: /pondel/, den: 1 },
  { kmen: /uter/, den: 2 },
  { kmen: /stred/, den: 3 },
  { kmen: /ctvrt/, den: 4 },
  { kmen: /pat(?:ek|ku|ka)\b/, den: 5 },
  { kmen: /sobot/, den: 6 },
  { kmen: /nedel/, den: 0 },
]

const MESICE: [RegExp, number][] = [
  [/^led/, 1],
  [/^uno/, 2],
  [/^bre/, 3],
  [/^dub/, 4],
  [/^kve/, 5],
  [/^cervn/, 6],
  [/^cervence|^cervenc/, 7],
  [/^srp/, 8],
  [/^zar/, 9],
  [/^rij/, 10],
  [/^list/, 11],
  [/^pros/, 12],
]

function mesicZNazvu(slovo: string): number | null {
  for (const [re, m] of MESICE) if (re.test(slovo)) return m
  return null
}

type Termin = { datum: string; cas: string | null }

type NalezTerminu = {
  termin: Termin | null
  nalezy: string[]
  kontrola: boolean
}

function hodina(h: number, min: number): string | null {
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Čas ve zprávě: „do 15:00“, „v 15.30“, „ve 14 hodin“, „v 8h“. */
function najdiCas(t: string): string | null {
  const dvojtecka = /\b(?:do|v|ve|na|kolem|od|pred)\s+(\d{1,2})[:.](\d{2})\b(?!\s*\.\s*\d)/.exec(t)
  if (dvojtecka) return hodina(Number(dvojtecka[1]), Number(dvojtecka[2]))
  const hodiny = /\b(?:do|v|ve|na|kolem|od|pred)\s+(\d{1,2})\s*(?:hod\w*|h)\b/.exec(t)
  if (hodiny) return hodina(Number(hodiny[1]), 0)
  return null
}

export function najdiTermin(textPuvodni: string, dnes: string): NalezTerminu {
  const t = bezDiakritiky(textPuvodni)
  const nalezy: string[] = []
  const data: { datum: string; jak: string; nejiste: boolean }[] = []

  if (/\bpozitri\b/.test(t)) data.push({ datum: pridejDny(dnes, 2), jak: 'pozítří', nejiste: false })
  if (/\bzitra\b|\bzejtra\b/.test(t)) data.push({ datum: pridejDny(dnes, 1), jak: 'zítra', nejiste: false })
  if (/\bdnes\b|\bdneska\b/.test(t)) data.push({ datum: dnes, jak: 'dnes', nejiste: false })

  // Den v týdnu: „v pátek“, „do pátku“, „na sobotu“, „ve středu“.
  const dnyRe = /\b(?:v|ve|do|na|az do|nejpozdeji v|nejpozdeji do)\s+(pondel\w*|uter\w*|stred\w*|ctvrt\w*|pat(?:ek|ku|ka)|sobot\w*|nedel\w*)\b/g
  for (const m of t.matchAll(dnyRe)) {
    const kmen = DNY_TYDNE.find((d) => d.kmen.test(m[1]))
    if (!kmen) continue
    const dnesDen = denVTydnu(dnes)
    let rozdil = (kmen.den - dnesDen + 7) % 7
    let nejiste = false
    if (rozdil === 0) {
      // „V pátek“ napsané v pátek: dnes, nebo za týden? Neuhodne se.
      rozdil = 7
      nejiste = true
    }
    data.push({ datum: pridejDny(dnes, rozdil), jak: m[0], nejiste })
  }

  // Datum číslem: „22. 9.“, „22.9.“, „22. 9. 2026“.
  const ciselne = /\b(\d{1,2})\s*\.\s*(\d{1,2})\s*\.(?:\s*(\d{4}))?(?!\d)/g
  for (const m of t.matchAll(ciselne)) {
    const d = Number(m[1])
    const mes = Number(m[2])
    const rokUvedeny = m[3] ? Number(m[3]) : null
    const rokDnes = Number(dnes.slice(0, 4))
    let rok = rokUvedeny ?? rokDnes
    if (!platneDatum(rok, mes, d)) continue
    let iso = `${rok}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    let nejiste = false
    // Bez roku a už uplynulo: příští rok, ale ať to člověk ověří.
    if (!rokUvedeny && iso < dnes) {
      rok += 1
      if (!platneDatum(rok, mes, d)) continue
      iso = `${rok}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      nejiste = true
    }
    data.push({ datum: iso, jak: m[0].trim(), nejiste })
  }

  // Datum slovem: „22. září“, „3. března“.
  const slovem = /\b(\d{1,2})\s*\.\s*([a-z]{3,})\b/g
  for (const m of t.matchAll(slovem)) {
    const mes = mesicZNazvu(m[2])
    if (!mes) continue
    const d = Number(m[1])
    const rokDnes = Number(dnes.slice(0, 4))
    let rok = rokDnes
    if (!platneDatum(rok, mes, d)) continue
    let iso = `${rok}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    let nejiste = false
    if (iso < dnes) {
      rok += 1
      if (!platneDatum(rok, mes, d)) continue
      iso = `${rok}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      nejiste = true
    }
    data.push({ datum: iso, jak: m[0].trim(), nejiste })
  }

  const cas = najdiCas(t)

  if (data.length === 0) {
    if (/\b(pristi|dalsi)\s+tyden\b|\bbrzy\b|\bcoby\s+nejdriv\b|\bco\s+nejdriv\b|\bnekdy\b/.test(t)) {
      nalezy.push('Termín je ve zprávě nepřesný („příští týden“, „co nejdřív“) — doplňte ho.')
      return { termin: null, nalezy, kontrola: true }
    }
    if (cas) {
      // Čas bez dne: není z čeho počítat. Neposune se na „dnes“ potichu.
      nalezy.push(`Ve zprávě je čas ${cas}, ale ne den — termín doplňte.`)
      return { termin: null, nalezy, kontrola: true }
    }
    return { termin: null, nalezy, kontrola: false }
  }

  // Různé dny ve zprávě: první se navrhne, ale je to k ověření.
  const rozdilna = new Set(data.map((d) => d.datum))
  const prvni = data[0]
  const kontrola = rozdilna.size > 1 || prvni.nejiste
  const termin: Termin = { datum: prvni.datum, cas }

  nalezy.push(
    `Termín: „${prvni.jak}“ → ${popisData(prvni.datum)}${cas ? ` ${cas}` : ''}.`,
  )
  if (rozdilna.size > 1) nalezy.push('Ve zprávě je víc různých dnů — ověřte, který platí.')
  if (prvni.nejiste) nalezy.push('Den není z textu jednoznačný (týden dopředu, nebo dnes?) — ověřte.')
  if (!cas && /\bdo\s+\d{1,2}\b/.test(t)) nalezy.push('Ve zprávě je „do“ s číslem — pokud je to hodina, doplňte čas.')

  return { termin, nalezy, kontrola }
}

/* ---------------------------------------------------------------------
   Naléhavost
   --------------------------------------------------------------------- */

export function jeNaleha(textPuvodni: string): boolean {
  const t = bezDiakritiky(textPuvodni)
  return /\bnalehav|\burgent|\bihned\b|\bhned\b|\bokamzit|\bco\s+nejdriv\b|\bcoby\s+nejdriv\b|\basap\b|\bspech|\bnutne\b/.test(t)
}

/* ---------------------------------------------------------------------
   Název
   --------------------------------------------------------------------- */

const POVELY =
  /^(?:prosim\s+)?(?:zajisti|zajistete|objednej|objednejte|zkontroluj|zkontrolujte|dej|dejte|udelej|udelejte|priprav|pripravte|zavolej|zavolejte|napis|napiste|vycisti|vycistete|umyj|umyjte|dones|doneste|prines|prinest|dokup|dokupte|nezapomen|nezapomente|over|overte|zaridit|zarid|zaridte|vyrid|vyridte|oprav|opravte|uklid|uklidte|doplnte|dopln|vezmi|vezmete|posli|poslete|domluv|domluvte|potvrd|potvrdte|nahlas|nahlaste)\b/
const POTREBA = /\b(?:je\s+treba|musime|musis|musite|potrebujeme|potrebuju|potrebuji|chybi|dosel[aoy]?|nezapomen|prosim)\b/

/** Pozdravy a zdvořilostní úvody, které v názvu úkolu nemají co dělat. */
function oriznoutUvod(veta: string): string {
  return veta
    .replace(/^\s*(?:ahoj|dobr[ýé]\s+(?:den|r[áa]no|ve[čc]er)|ƒ|čau|cau|nazdar|hej)[\s,!.:–-]*/iu, '')
    .replace(/^\s*(?:pros[ií]m(?:\s+t[ěe])?|d[ěe]kuji|d[íi]ky)[\s,!.:–-]*/iu, '')
    .trim()
}

function velkePismeno(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

function zkratit(s: string, max: number): string {
  if (s.length <= max) return s
  const rez = s.slice(0, max - 1)
  const mezera = rez.lastIndexOf(' ')
  return `${(mezera > max * 0.5 ? rez.slice(0, mezera) : rez).replace(/[\s,;:–-]+$/u, '')}…`
}

function vety(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length > 0)
}

/** Věta „Prosím zavolej dodavateli“ je povel; „Ahoj všichni“ ne. */
function pripominaUkol(veta: string): boolean {
  const t = bezDiakritiky(oriznoutUvod(veta))
  return POVELY.test(t) || POTREBA.test(t)
}

export function navrhniNazev(text: string): { nazev: string; poznamka: string } {
  const vsechny = vety(text)
  if (vsechny.length === 0) return { nazev: '', poznamka: '' }

  const idx = Math.max(0, vsechny.findIndex(pripominaUkol))
  const zvolena = oriznoutUvod(vsechny[idx]) || vsechny[idx]
  const nazev = zkratit(velkePismeno(zvolena.replace(/[.!?…]+$/u, '')), MAX_NAZEV)

  const zbytek = vsechny.filter((_, i) => i !== idx).join(' ')
  // Když se název musel zkrátit, celá věta patří do poznámky, ať se nic neztratí.
  const poznamka = zkratit(
    zvolena.length > MAX_NAZEV ? [zvolena, zbytek].filter(Boolean).join(' ') : zbytek,
    MAX_POZNAMKA,
  )
  return { nazev, poznamka }
}

/* ---------------------------------------------------------------------
   Návrh jako celek
   --------------------------------------------------------------------- */

export function navrhniUkol(vstup: VstupNavrhu): NavrhUkolu | null {
  const text = (vstup.text ?? '').trim()
  if (text.length === 0) return null

  const { nazev, poznamka } = navrhniNazev(text)
  if (nazev.length === 0) return null

  const termin = najdiTermin(text, vstup.dnes)
  const naleha = jeNaleha(text)

  const kontrola: PoleNavrhu[] = []
  if (termin.kontrola) kontrola.push('termin')

  const nalezy = [...termin.nalezy]
  if (naleha) nalezy.push('Zpráva zní naléhavě — úkol se navrhuje jako důležitý.')

  return {
    nazev,
    poznamka,
    termin: termin.termin,
    priorita: naleha ? 'high' : 'normal',
    vyzadujeKontrolu: kontrola,
    nalezy,
    zdroj: 'pravidla',
  }
}

/* ---------------------------------------------------------------------
   Poskytovatelé
   --------------------------------------------------------------------- */

export const pravidlovyPoskytovatel: PoskytovatelNavrhuUkolu = {
  id: 'pravidla',
  popis: 'Pravidlový návrh přímo v aplikaci. Text zprávy nikam neodchází.',
  stav: () => ({ dostupny: true }),
  navrhnout: async (vstup) => navrhniUkol(vstup),
}

/**
 * Návrh jazykovým modelem — ZÁMĚRNĚ NEDOSTUPNÝ.
 *
 * Existuje, aby bylo vidět, kam se model připojí a proč tam dnes není.
 * Napojení není otázka klíče, ale rozhodnutí: pravidlo 8 zakazuje posílat
 * obsah komunikace modelu. Než ho někdo zapne, musí vlastník rozhodnout
 * a musí vzniknout uzavřený vstupní typ (skill foodtab-ai).
 */
export const modelovyPoskytovatel: PoskytovatelNavrhuUkolu = {
  id: 'model',
  popis: 'Návrh jazykovým modelem.',
  stav: () => ({
    dostupny: false,
    duvod:
      'Obsah komunikace se jazykovému modelu neposílá (CLAUDE.md, pravidlo 8). ' +
      'Zapnout to může jen rozhodnutí vlastníka.',
  }),
  navrhnout: async () => null,
}

/** Který poskytovatel se použije. Dokud nepadne rozhodnutí, vždy pravidlový. */
export function vybratPoskytovateleNavrhu(): PoskytovatelNavrhuUkolu {
  return pravidlovyPoskytovatel
}
