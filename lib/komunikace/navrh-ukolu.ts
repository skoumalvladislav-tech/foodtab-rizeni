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

/**
 * Měsíc podle názvu — jen SKUTEČNÉ tvary (leden, ledna, lednu…), ne předpony.
 * Předpona by z „5. Prosím zavolej“ udělala prosinec a z „3. Listy jsou“ listopad.
 */
const MESICE: [RegExp, number][] = [
  [/^(?:leden|ledna|lednu|ledne)$/, 1],
  [/^(?:unor|unora|unoru|unore)$/, 2],
  [/^(?:brezen|brezna|breznu|brezne)$/, 3],
  [/^(?:duben|dubna|dubnu|dubne)$/, 4],
  [/^(?:kveten|kvetna|kvetnu|kvetne)$/, 5],
  [/^(?:cerven|cervna|cervnu|cervne)$/, 6],
  [/^(?:cervenec|cervence|cervenci)$/, 7],
  [/^(?:srpen|srpna|srpnu|srpne)$/, 8],
  [/^zari$/, 9],
  [/^(?:rijen|rijna|rijnu|rijne)$/, 10],
  [/^(?:listopad|listopadu|listopadem)$/, 11],
  [/^(?:prosinec|prosince|prosinci)$/, 12],
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

/**
 * Čas ve zprávě: „do 15:00“, „v 15.30“, „ve 14 hodin“, „v 8h“.
 *
 * Co čas NENÍ a nesmí se za něj vzít:
 *   * „do 15.10.“ — datum (den. měsíc.), ne 15:10; s tečkou za tím a platným
 *     dnem a měsícem je to datum (15.30 nebo 8.15 datem být nemůže);
 *   * „na 5.50 Kč“, „do 1.20 m“ — cena a rozměr (číslo s jednotkou).
 * A z „od 8:00 do 16:00“ je termín KONEC intervalu, ne začátek: přednost má
 * čas s „do“.
 */
function najdiCas(t: string): string | null {
  const kandidati: { predlozka: string; cas: string }[] = []

  const dvojtecka =
    /\b(do|v|ve|na|kolem|od|pred)\s+(\d{1,2})([:.])(\d{2})\b(?!\s*\.\s*\d)(?!\s*(?:kc|czk|eur|kg|g|l|ml|m|cm|mm|km|%))/g
  for (const m of t.matchAll(dvojtecka)) {
    const h = Number(m[2])
    const min = Number(m[4])
    const dal = t.slice((m.index ?? 0) + m[0].length)
    if (m[3] === '.' && h >= 1 && h <= 31 && min >= 1 && min <= 12 && /^\s*\./.test(dal)) continue
    const cas = hodina(h, min)
    if (cas) kandidati.push({ predlozka: m[1], cas })
  }

  const hodiny = /\b(do|v|ve|na|kolem|od|pred)\s+(\d{1,2})\s*(?:hod\w*|h)\b/g
  for (const m of t.matchAll(hodiny)) {
    const cas = hodina(Number(m[2]), 0)
    if (cas) kandidati.push({ predlozka: m[1], cas })
  }

  const doCasu = kandidati.find((k) => k.predlozka === 'do')
  return (doCasu ?? kandidati[0])?.cas ?? null
}

/** Pondělí příštího týdne (YYYY-MM-DD) — pro „příští týden v pátek“. */
function pristiPondeli(dnes: string): string {
  const den = denVTydnu(dnes) // 0 = neděle … 6 = sobota
  const doPondeli = ((8 - den) % 7) || 7
  return pridejDny(dnes, doPondeli)
}

type DatumZTextu = {
  datum: string
  /** Jak se to ve zprávě psalo (původní text, s diakritikou). */
  jak: string
  /** Proč si návrh není jistý (věta pro člověka), nebo null. */
  nejiste: string | null
  /** Čím výš, tím méně se tomu věří: 0 = datum, 1 = den v týdnu, 2 = dnes/zítra/pozítří. */
  vaha: number
}

export function najdiTermin(textPuvodni: string, dnes: string): NalezTerminu {
  const t = bezDiakritiky(textPuvodni)
  // Rozdělení diakritiky nemění délku (é → e), takže se dá z původního textu
  // ocitovat přesný kus; kdyby se délky rozešly, cituje se hledaný tvar.
  const ocitovat = (m: RegExpMatchArray): string =>
    t.length === textPuvodni.length && m.index !== undefined
      ? textPuvodni.slice(m.index, m.index + m[0].length).trim()
      : m[0].trim()

  const nalezy: string[] = []
  const data: DatumZTextu[] = []

  if (/\bpozitri\b/.test(t)) data.push({ datum: pridejDny(dnes, 2), jak: 'pozítří', nejiste: null, vaha: 2 })
  if (/\bzitra\b|\bzejtra\b/.test(t)) data.push({ datum: pridejDny(dnes, 1), jak: 'zítra', nejiste: null, vaha: 2 })
  if (/\bdnes\b|\bdneska\b/.test(t)) data.push({ datum: dnes, jak: 'dnes', nejiste: null, vaha: 2 })

  const pristiTyden = /\b(?:pristi|dalsi)\s+tyden\b/.test(t)

  // Den v týdnu: „v pátek“, „do pátku“, „na sobotu“, „ve středu“. Jen skutečné tvary
  // dnů — kmen s libovolným koncem by chytal „do střediska“, „na utěrky“, „ve čtvrt na osm“.
  const dnyRe =
    /\b(?:v|ve|do|na|az do|nejpozdeji v|nejpozdeji do)\s+(pondeli|utery|stred(?:a|u|y|e|ou)|ctvrt(?:ek|ku|ka|kem)|pat(?:ek|ku|ka|kem)|sobot(?:a|u|y|e|ou)|nedel(?:e|i|y|ou))\b/g
  for (const m of t.matchAll(dnyRe)) {
    const kmen = DNY_TYDNE.find((d) => d.kmen.test(m[1]))
    if (!kmen) continue

    if (pristiTyden) {
      // „Příští týden v pátek“: pátek PŘÍŠTÍHO týdne, ne nejbližší.
      const datum = pridejDny(pristiPondeli(dnes), (kmen.den + 6) % 7)
      data.push({
        datum,
        jak: ocitovat(m),
        nejiste: 'Den je odvozený z „příští týden“ — ověřte.',
        vaha: 1,
      })
      continue
    }

    const dnesDen = denVTydnu(dnes)
    let rozdil = (kmen.den - dnesDen + 7) % 7
    let nejiste: string | null = null
    if (rozdil === 0) {
      // „V pátek“ napsané v pátek: dnes, nebo za týden? Neuhodne se.
      rozdil = 7
      nejiste = 'Den není z textu jednoznačný (týden dopředu, nebo dnes?) — ověřte.'
    }
    data.push({ datum: pridejDny(dnes, rozdil), jak: ocitovat(m), nejiste, vaha: 1 })
  }

  const rokDnes = Number(dnes.slice(0, 4))
  const sIsoDatem = (rok: number, mes: number, den: number) =>
    `${rok}-${String(mes).padStart(2, '0')}-${String(den).padStart(2, '0')}`

  /**
   * Zařadí datum z textu. Bez uvedeného roku a už uplynulé → příští rok, k ověření;
   * s uvedeným rokem a uplynulé → k ověření (nemění se, co člověk napsal).
   */
  const pridatDatum = (m: RegExpMatchArray, mes: number, den: number, rokUvedeny: number | null) => {
    let rok = rokUvedeny ?? rokDnes
    if (!platneDatum(rok, mes, den)) return
    let iso = sIsoDatem(rok, mes, den)
    let nejiste: string | null = null
    if (iso < dnes) {
      if (rokUvedeny === null) {
        rok += 1
        if (!platneDatum(rok, mes, den)) return
        iso = sIsoDatem(rok, mes, den)
        nejiste = 'Datum už letos uplynulo, navrhuje se příští rok — ověřte.'
      } else {
        nejiste = 'Datum už uplynulo — ověřte.'
      }
    }
    data.push({ datum: iso, jak: ocitovat(m), nejiste, vaha: 0 })
  }

  // Datum číslem: „22. 9.“, „22.9.“, „22. 9. 2026“.
  const ciselne = /\b(\d{1,2})\s*\.\s*(\d{1,2})\s*\.(?:\s*(\d{4}))?(?!\d)/g
  for (const m of t.matchAll(ciselne)) {
    pridatDatum(m, Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : null)
  }

  // Datum slovem: „22. září“, „3. března 2027“.
  const slovem = /\b(\d{1,2})\s*\.\s*([a-z]{3,})\b(?:\s+(\d{4})\b)?/g
  for (const m of t.matchAll(slovem)) {
    const mes = mesicZNazvu(m[2])
    if (!mes) continue
    pridatDatum(m, mes, Number(m[1]), m[3] ? Number(m[3]) : null)
  }

  // Přednost má výslovné datum, pak den v týdnu, nakonec „dnes/zítra“ (stabilní řazení).
  data.sort((a, b) => a.vaha - b.vaha)

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
  const kontrola = rozdilna.size > 1 || prvni.nejiste !== null
  const termin: Termin = { datum: prvni.datum, cas }

  nalezy.push(
    // popisData končí tečkou („pá 25. 9.“); za čas se tečka doplní.
    `Termín: „${prvni.jak}“ → ${popisData(prvni.datum)}${cas ? ` ${cas}.` : ''}`,
  )
  if (rozdilna.size > 1) nalezy.push('Ve zprávě je víc různých dnů — ověřte, který platí.')
  if (prvni.nejiste) nalezy.push(prvni.nejiste)
  if (!cas && !data.some((d) => d.vaha === 0) && /\b(?:do|v|ve)\s+\d{1,2}\b/.test(t)) {
    nalezy.push('Ve zprávě je „do“ nebo „v“ s číslem — pokud je to hodina, doplňte čas.')
  }

  return { termin, nalezy, kontrola }
}

/* ---------------------------------------------------------------------
   Naléhavost
   --------------------------------------------------------------------- */

export function jeNaleha(textPuvodni: string): boolean {
  const t = bezDiakritiky(textPuvodni)
    // Záporný a jiný význam: „není spěch“, „bez spěchu“, „nespěchej“, „není naléhavé“,
    // „hned vedle“ (místo, ne čas). Vyřadí se dřív, než se hledá naléhavost.
    .replace(/\b(?:neni|nebude|nemusi|bez)\s+(?:zadny\s+|moc\s+)?spech\w*/g, ' ')
    .replace(/\bnespech\w*/g, ' ')
    .replace(/\b(?:neni|nebude)\s+(?:moc\s+|zas\s+)?(?:nalehav|urgentn)\w*/g, ' ')
    .replace(/\bhned\s+(?:vedle|za|pod|nad|pred|u|naproti)\b/g, ' ')
  return /\bnalehav|\burgent|\bihned\b|\bhned\b|\bokamzit|\bco\s+nejdriv\b|\bcoby\s+nejdriv\b|\basap\b|\bspech|\bnutne\b/.test(t)
}

/* ---------------------------------------------------------------------
   Název
   --------------------------------------------------------------------- */

const POVELY =
  /^(?:prosim\s+)?(?:zajisti|zajistete|objednej|objednejte|zkontroluj|zkontrolujte|dej|dejte|udelej|udelejte|priprav|pripravte|zavolej|zavolejte|napis|napiste|vycisti|vycistete|umyj|umyjte|dones|doneste|prines|prinest|dokup|dokupte|nezapomen|nezapomente|over|overte|zaridit|zarid|zaridte|vyrid|vyridte|oprav|opravte|uklid|uklidte|doplnte|dopln|vezmi|vezmete|posli|poslete|domluv|domluvte|potvrd|potvrdte|nahlas|nahlaste)\b/
const POTREBA = /\b(?:je\s+treba|musime|musis|musite|potrebujeme|potrebuju|potrebuji|chybi|dosel[aoy]?|nezapomen|prosim)\b/

/** Pozdravy a zdvořilostní úvody, které v názvu úkolu nemají co dělat. Jen CELÁ slova („Ahojky“ zůstane). */
function oriznoutUvod(veta: string): string {
  return veta
    .replace(/^\s*(?:ahoj|dobr[ýé]\s+(?:den|r[áa]no|ve[čc]er)|čau|cau|nazdar|hej)(?![\p{L}])[\s,!.:–-]*/iu, '')
    .replace(/^\s*(?:pros[ií]m(?:\s+t[ěe])?|d[ěe]kuji|d[íi]ky)(?![\p{L}])[\s,!.:–-]*/iu, '')
    .trim()
}

function velkePismeno(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** Zkrátí na `max` znaků; počítá se po znacích (code points), takže nerozseká emoji na půl. */
function zkratit(s: string, max: number): string {
  const znaky = Array.from(s)
  if (znaky.length <= max) return s
  const rez = znaky.slice(0, max - 1).join('')
  const mezera = rez.lastIndexOf(' ')
  return `${(mezera > max * 0.5 ? rez.slice(0, mezera) : rez).replace(/[\s,;:–-]+$/u, '')}…`
}

/**
 * Věty zprávy. Tečka za číslem („do 22. 9.“, „č. 3“) nebo zkratkou („tj.“, „cca.“)
 * není konec věty — jinak by se název úkolu useknul uprostřed data. Nový řádek
 * je vždy nová věta.
 */
function vety(text: string): string[] {
  const vysledek: string[] = []
  for (const radek of text.replace(/\r\n/g, '\n').split('\n')) {
    let aktualni = ''
    for (const kus of radek.split(/(?<=[.!?…])\s+/u)) {
      aktualni = aktualni === '' ? kus : `${aktualni} ${kus}`
      if (!/(?:^|\s)(?:\d+|tj|tzn|např|cca|č|čís|str|ul|hod|min|resp|atd|apod)\.$/iu.test(aktualni)) {
        vysledek.push(aktualni)
        aktualni = ''
      }
    }
    if (aktualni !== '') vysledek.push(aktualni)
  }
  return vysledek.map((v) => v.replace(/\s+/g, ' ').trim()).filter((v) => v.length > 0)
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
    // Pravidlo 8 z CLAUDE.md, řečené lidsky — věta se ukazuje na obrazovce.
    duvod:
      'Obsah komunikace se jazykovému modelu neposílá. ' +
      'Zapnout to může jen rozhodnutí vlastníka firmy.',
  }),
  navrhnout: async () => null,
}

/** Který poskytovatel se použije. Dokud nepadne rozhodnutí, vždy pravidlový. */
export function vybratPoskytovateleNavrhu(): PoskytovatelNavrhuUkolu {
  return pravidlovyPoskytovatel
}
