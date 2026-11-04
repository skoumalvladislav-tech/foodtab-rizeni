/**
 * Náhled dokumentu Word (.docx) bez knihovny.
 *
 * Proč: prohlížeč .docx zobrazit neumí. Odkaz ho jen pošle ke stažení
 * a na počítači to vypadá, že se po kliknutí nic nestalo (Šéfík
 * 2. 11. 2026: „soubory teď nejdou otevřít“). Náhled ukáže text přímo
 * ve Foodtabu; originál se dál stahuje tlačítkem.
 *
 * Proč ne knihovna: stejný důvod jako u lib/xlsx.ts, odkud se bere čtení
 * ZIPu a XML. Čtečky souborů Office jsou místo, kde se historicky
 * opravovaly díry, a tady je to cizí soubor, který nahrál kdokoli, kdo
 * smí zapisovat rezervace.
 *
 * Co se čte: hlavní část dokumentu (text; tučně, kurzíva, podtržení;
 * odstavce, zalomení řádku, tabulátor; odrážky; tabulky, i vnořené,
 * se sloučenými buňkami; textová pole; iniciála; zaškrtávací políčka
 * a rozbalovací seznamy formulářů; znaky ze Symbolu/Wingdings) a styly
 * — který styl je nadpis. Id stylu závisí na jazyku Wordu („Nadpis1“,
 * „Heading1“), jméno stylu ne („heading 1“).
 * Co ne: obrázky, grafy a vzorce (v textu je po nich značka; obrázky se
 * spočítají), záhlaví a zápatí, poznámky pod čarou, komentáře,
 * číslování (číslovaný seznam se ukáže s odrážkou), barvy, písma.
 * Odkaz se ukáže jako text, ne jako odkaz — adresa z cizího souboru do
 * aplikace nepatří. Ukáže se dokument tak, jak ho Word ukáže na
 * obrazovce po přijetí změn: bez smazaného textu ze sledování změn, bez
 * skrytého textu (`w:vanish`) a bez příkazů polí (u pole jen výsledek).
 *
 * BEZPEČNOST: výsledek je strom obyčejných dat (text + příznaky), žádné
 * HTML. React ho vypíše jako text, takže nic ze souboru se nespustí.
 * Cizí soubor nesmí zahltit server ani prohlížeč toho, kdo ho otevře,
 * proto stropy na všechno, co roste se souborem: rozbalení (ZIP bomba),
 * počet značek, které se projdou (čas), dekódování entit (jen text,
 * který se ukáže), znaky, úseky textu, odstavce a buňky tabulek
 * (velikost stránky), sloupce v řádku (rozvržení tabulky v prohlížeči)
 * a hloubka vnořených tabulek (stránka se kreslí rekurzí). Delší
 * dokument se ukáže zkrácený; příliš široká tabulka oříznutá, ale
 * text za ní zůstane.
 *
 * Čistý modul (jen node:zlib) — testuje ho scripts/rezervace.test.mjs.
 */

import { inflateRawSync } from 'node:zlib'

import { pocet, prisudek } from './sklonovani.ts'
import { ctiZip, kousky, odkodovat, surovyAtribut, type Polozka } from './xlsx.ts'

/**
 * Atribut bez dekódování entit. Hodnoty, které náhled čte (`w:val="0"`,
 * id stylu, druh vazby), se jen porovnávají; dekódovat megabajty
 * `&amp;` v jedné hodnotě z cizího souboru by zabralo server na vteřiny.
 * Text, který se ukáže, se dekóduje v `pridatText` — s přídělem.
 */
const hodnota = surovyAtribut

/** Chyba, kterou má smysl ukázat člověku. */
export class DokumentNecitelny extends Error {}

/** Strop na rozbalenou hlavní část. Běžný dokument má desítky až stovky kB. */
export const MAX_XML_BAJTU = 20 * 1024 * 1024
/** Strop na rozbalené styly (skutečné mají do pár set kB). */
export const MAX_STYLU_BAJTU = 4 * 1024 * 1024
/** Strop na rozbalený seznam vazeb (skutečné mají do desítek kB). */
export const MAX_VAZEB_BAJTU = 1024 * 1024
/**
 * Kolik značek se v hlavní části projde. Bez toho by 20 MB značek bez
 * textu (`<a/>`) zabralo server na vteřiny při každém otevření — strop
 * na znaky ani odstavce se jich netkne. Skutečné dokumenty mají do
 * desítek tisíc; přes strop se náhled ukáže zkrácený.
 */
export const MAX_ZNACEK = 300_000
/** Totéž pro styly (skutečné do ~12 tisíc) — co je za stropem, se nečte. */
export const MAX_ZNACEK_STYLU = 100_000
/** Totéž pro seznam vazeb (skutečný jich má pár). */
export const MAX_ZNACEK_VAZEB = 10_000
/** Kolik znaků textu náhled ukáže; celé je to v originálu. */
export const MAX_ZNAKU = 300_000
/**
 * Nejdelší entita bez nul navíc (`&#x10FFFF;`) — kolik znaků v souboru
 * nanejvýš dá jeden znak textu. Strop na to, kolik ze souboru se
 * dekóduje; entity s nulami navíc (`&#x0041;`) jsou delší a za ním se
 * náhled zkrátí.
 */
export const DELKA_ENTITY = 10
/**
 * Kolik znaků ze souboru se dekóduje najednou. Jedním `replace` přes
 * megabajty `&amp;` by se naráz sebralo statisíce shod — 100 MB paměti
 * serveru při každém otevření.
 */
const KUS_ENTIT = 65_536
/**
 * Kolik úseků textu (kus se stejným formátem) náhled ukáže. Každý je na
 * stránce prvek; střídáním tučného písma po znaku by z pár kB souboru
 * bylo sto tisíc prvků a vteřiny vykreslování. Skutečné dokumenty jich
 * mají do tisíce.
 */
export const MAX_USEKU = 20_000
/** Kolik odstavců, tabulek, řádků a buněk náhled ukáže (dohromady). */
export const MAX_BLOKU = 10_000
/**
 * Kolik tabulek v sobě. Stránka se kreslí rekurzí a stovky pater
 * shodí vykreslení; skutečné dokumenty mají nanejvýš dvě. Hlubší
 * tabulka se nezahodí — její text se ukáže v buňce o patro výš.
 */
export const MAX_VNORENI_TABULEK = 8
/**
 * Kolik buněk má řádek tabulky nanejvýš — Word víc nedovolí. Tisíce
 * buněk v řádku z cizího souboru by prohlížeči toho, kdo dokument
 * otevře, zamrazily stránku na minuty (rozvržení tabulky roste
 * s druhou mocninou sloupců).
 */
export const MAX_BUNEK = 63
/**
 * Kolik sloupců mřížky (součet `w:gridSpan` a `w:gridBefore`) má řádek
 * nanejvýš. Mřížka je sjednocení hranic všech řádků: 33 buněk s hranicemi
 * posunutými proti sobě dá 65 sloupců, i když buněk je pod limitem Wordu.
 * Strop hlídá stejné zamrznutí jako MAX_BUNEK, jen pro pár buněk přes
 * tisíce sloupců.
 */
export const MAX_MRIZKY = 255

const NEZNAMY = 'Dokument je uložený způsobem, který náhled nezná.'

export type Usek = {
  text: string
  tucne: boolean
  kurziva: boolean
  podtrzeno: boolean
  /** Značka místo obsahu, který náhled neukáže (obrázek, vzorec, symbol). */
  zastupny: boolean
}
export type Odstavec = {
  druh: 'odstavec'
  /** 0 = běžný text, 1–3 = úroveň nadpisu. */
  nadpis: 0 | 1 | 2 | 3
  odrazka: boolean
  useky: Usek[]
}
export type Bunka = {
  /** Obsah buňky: odstavce, případně další tabulka. */
  bloky: Blok[]
  /** Přes kolik sloupců (`w:gridSpan`); 1 = obyčejná buňka. */
  sirka: number
  /** Přes kolik řádků (svisle sloučená, `w:vMerge`); 1 = obyčejná. */
  vyska: number
  /** Pokračování svisle sloučené buňky — nekreslí se, je v té nad ní. */
  sloucena: boolean
  /** Prázdné místo na začátku řádku (`w:gridBefore`), není to buňka. */
  odsazeni: boolean
}
export type Tabulka = { druh: 'tabulka'; radky: Bunka[][] }
export type Blok = Odstavec | Tabulka
export type NahledDocx = {
  bloky: Blok[]
  obrazku: number
  /** Za stropem se přestalo číst — náhled je jen začátek. */
  zkraceno: boolean
  /** Řádek tabulky přes MAX_BUNEK nebo MAX_MRIZKY se uřízl; čte se dál. */
  oriznutaTabulka: boolean
}

type Styl = { nadpis: 0 | 1 | 2 | 3; odrazka: boolean }
type Beh = { tucne: boolean; kurziva: boolean; podtrzeno: boolean; skryto: boolean }

/** Věta nad náhledem o tom, co v něm chybí; když nic, null. */
export function poznamkaNahledu(n: NahledDocx): string | null {
  const vety: string[] = []
  if (n.obrazku === 1) vety.push('V dokumentu je 1 obrázek — v náhledu je po něm jen značka.')
  else if (n.obrazku > 1) {
    vety.push(
      `V dokumentu ${prisudek(n.obrazku, 'je', 'jsou', 'je')} ${pocet(n.obrazku, 'obrázek', 'obrázky', 'obrázků')} — v náhledu jsou po nich jen značky.`,
    )
  }
  if (n.oriznutaTabulka) vety.push('Tabulka je moc široká — část vpravo v náhledu chybí.')
  if (n.zkraceno) vety.push('Dokument je dlouhý, náhled ukazuje jen začátek.')
  return vety.length ? vety.join(' ') : null
}

/**
 * Věta místo náhledu, ve kterém nic není; když v něm něco je, null.
 * U zkráceného dokumentu nic neříká o celém — začátek může být jen
 * grafika (velký tvar) a text až za stropem.
 */
export function prazdnyNahled(n: NahledDocx): string | null {
  if (n.bloky.some((b) => (b.druh === 'tabulka' ? b.radky.length > 0 : b.useky.length > 0))) return null
  return n.zkraceno
    ? 'V začátku dokumentu, který se do náhledu vešel, žádný text není. Celý dokument je v originálu.'
    : 'V dokumentu není žádný text.'
}

/* --- ZIP --------------------------------------------------------------- */

/**
 * Rozbalí jednu část. Na rozdíl od lib/xlsx.ts (běží v prohlížeči toho,
 * kdo soubor sám vybral) tohle běží na serveru nad cizím souborem —
 * proto strop na velikost po rozbalení. `maxOutputLength` zastaví
 * rozbalování na stropu; bez něj by 10 MB soubor nafoukl paměť na
 * gigabajty a teprve pak by kontrola délky řekla „příliš velký“.
 */
function rozbal(bajty: Uint8Array, pol: Polozka, strop: number): string {
  // Posunutí mimo soubor shodí DataView (RangeError) a precistDocx z toho
  // udělá „poškozený“; tady se hlídá, že na posunutí je místní hlavička.
  const d = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength)
  if (d.getUint32(pol.offset, true) !== 0x04034b50) throw new DokumentNecitelny('Dokument je poškozený.')
  // Velikost dat z ústředního adresáře (`pol.zabaleno`), ne z místní
  // hlavičky — s bitem 3 jsou v ní nuly. Extra pole místní hlavičky
  // bývá jiné délky než v adresáři (Word dává 520 bajtů výplně).
  const zacatek = pol.offset + 30 + d.getUint16(pol.offset + 26, true) + d.getUint16(pol.offset + 28, true)
  const data = bajty.subarray(zacatek, zacatek + pol.zabaleno)

  let obsah: Uint8Array
  if (pol.metoda === 0) {
    obsah = data
  } else if (pol.metoda === 8) {
    try {
      obsah = inflateRawSync(data, { maxOutputLength: strop })
    } catch (e) {
      const prilisVelky = (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
      throw new DokumentNecitelny(prilisVelky ? 'Dokument je na náhled příliš velký.' : 'Dokument je poškozený.')
    }
  } else {
    throw new DokumentNecitelny('Dokument je zabalený způsobem, který náhled nezná.')
  }
  if (obsah.length > strop) throw new DokumentNecitelny('Dokument je na náhled příliš velký.')
  // XML smí být i v UTF-16; pozná se podle BOM.
  if (obsah[0] === 0xff && obsah[1] === 0xfe) return new TextDecoder('utf-16le').decode(obsah)
  if (obsah[0] === 0xfe && obsah[1] === 0xff) return new TextDecoder('utf-16be').decode(obsah)
  return new TextDecoder().decode(obsah)
}

/* --- značky ------------------------------------------------------------ */

type Znacka = { jmeno: string; konec: boolean; prazdna: boolean; text: string }

function rozebrat(text: string): Znacka | null {
  // Deklarace, komentáře a instrukce nic nenesou.
  if (text[1] === '?' || text[1] === '!') return null
  const konec = text[1] === '/'
  const m = text.slice(konec ? 2 : 1).match(/^[^\s/>]+/)
  if (!m) return null
  return { jmeno: m[0], konec, prazdna: !konec && text.endsWith('/>'), text }
}

/** `<w:b/>` je zapnuté, `<w:b w:val="0"/>` vypnuté. */
function zapnuto(znacka: string): boolean {
  const v = hodnota(znacka, 'w:val')
  return v === null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}

/** Číselná hodnota `w:val`; bez ní NaN (Number(null) by dalo 0 = nadpis). */
function cislo(znacka: string): number {
  const v = hodnota(znacka, 'w:val')
  return v === null ? NaN : Number(v)
}

/**
 * Úroveň osnovy (0 = nadpis 1 … 8 = nadpis 9) → nadpis v náhledu, hlubší
 * než 3 jsou 3. Cokoli jiného (9 = běžný text, „1.5“ z cizího souboru)
 * je null — stránka má jen tři úrovně a jiné číslo by ji shodilo.
 */
function nadpisOsnovy(n: number): 1 | 2 | 3 | null {
  if (!Number.isInteger(n) || n < 0 || n > 8) return null
  return n >= 2 ? 3 : ((n + 1) as 1 | 2)
}

/** Počet sloupců z `w:val` — z cizího souboru; strop řeší dokoncitTabulku. */
function sloupcu(znacka: string, nejmene: number): number {
  const n = Math.trunc(cislo(znacka))
  return Number.isFinite(n) ? Math.max(n, nejmene) : nejmene
}

/**
 * Znak z `w:sym`. Word tak vkládá políčka a fajfky z písma Wingdings,
 * kde kód není znak Unicode — bez převodu by zmizelo, co zákazník
 * zaškrtl. Známá políčka, fajfky a běžné znaky z písma Symbol se
 * převedou, jiný symbol z takového písma je značka. Z běžného písma je
 * kód rovnou znak.
 */
const WINGDINGS: Record<number, string> = {
  0x6f: '☐', 0xa8: '☐', 0x78: '☒', 0xfd: '☒', 0xfe: '☑', 0xfc: '✓', 0xfb: '✗',
  0x71: '❑', 0x72: '❒', 0x6e: '■', 0x6c: '●', 0xa1: '○',
  // Automatické opravy Wordu: --> <-- ==> <== <=> :) :| :(
  0xe0: '→', 0xdf: '←', 0xe1: '↑', 0xe2: '↓', 0xe8: '⇒', 0xe7: '⇐', 0xf3: '⇔', 0x4a: '☺', 0x4b: '😐', 0x4c: '☹',
}
// Jména glyfů z WINGDNG2.TTF: box1, boxxmark, boxcheck, boxx, boxxbld, check, xmark.
const WINGDINGS2: Record<number, string> = { 0xa3: '☐', 0x51: '☒', 0x52: '☑', 0x53: '☒', 0x54: '☒', 0x50: '✓', 0x4f: '✗' }
// Kódování písma Symbol (Adobe) — jen znaky, které se v textu opravdu píšou.
const SYMBOL: Record<number, string> = {
  0xb0: '°', 0xb1: '±', 0xb4: '×', 0xb8: '÷', 0xb7: '•', 0xae: '→', 0xac: '←', 0xa3: '≤', 0xb3: '≥',
  0xb9: '≠', 0xbb: '≈', 0xa5: '∞', 0xd6: '√', 0x61: 'α', 0x62: 'β', 0x6d: 'μ', 0x70: 'π', 0x44: 'Δ', 0x53: 'Σ', 0x57: 'Ω',
}
const PREVODY: Record<string, Record<number, string>> = { wingdings: WINGDINGS, 'wingdings 2': WINGDINGS2, symbol: SYMBOL }

function symbol(znacka: string): { text: string; zastupny: boolean } {
  const pismo = (hodnota(znacka, 'w:font') ?? '').trim().toLowerCase()
  const kod = parseInt(hodnota(znacka, 'w:char') ?? '', 16)
  const znak = kod >= 0xf000 && kod <= 0xf0ff ? kod - 0xf000 : kod
  const prevod = Object.hasOwn(PREVODY, pismo) ? PREVODY[pismo][znak] : undefined
  if (prevod) return { text: prevod, zastupny: false }
  // Písma, kde kód NENÍ znak Unicode. Jen přesná jména — „Segoe UI
  // Symbol“ nebo „MS Gothic“ (políčka z ovládacích prvků) jsou Unicode.
  const symbolove = /^(symbol|wingdings( [23])?|webdings|zapf ?dingbats|marlett|mt extra)$/.test(pismo)
  if (!symbolove && Number.isInteger(kod) && kod >= 0x20 && kod < 0xf000 && !(kod >= 0xd800 && kod <= 0xdfff)) {
    return { text: String.fromCodePoint(kod), zastupny: false }
  }
  return { text: 'symbol', zastupny: true }
}

/**
 * Části, jejichž obsah se do náhledu nepočítá:
 *   - `mc:Fallback` — náhradní kopie pro starý Word (textové pole by
 *     bylo dvakrát),
 *   - `w:del`, `w:moveFrom` — smazaný a přesunutý text ze sledování změn,
 *   - `w:rPrChange`, `w:pPrChange`, `w:tcPrChange`, `w:trPrChange` —
 *     formát PŘED změnou (jinak by se text ukázal tučně, i když už tučný
 *     není, a buňka sloučená, i když už není). Ve `w:tblPrChange` nic,
 *     co náhled čte, není.
 */
const PRESKOCIT = new Set(['mc:Fallback', 'w:del', 'w:moveFrom', 'w:rPrChange', 'w:pPrChange', 'w:tcPrChange', 'w:trPrChange'])

/* --- styly ------------------------------------------------------------- */

/**
 * Styly odstavců: id → nadpis a odrážka. Styl bez vlastního údaje ho
 * dědí ze stylu, na kterém stojí (`w:basedOn`) — „Můj nadpis“
 * postavený na „heading 1“ je nadpis.
 */
export function ctiStyly(xml: string): Map<string, Styl> {
  type Surovy = { nadpis: 0 | 1 | 2 | 3 | null; odrazka: boolean | null; zaklad: string | null }
  const surove = new Map<string, Surovy>()
  let id: string | null = null
  let jmeno = ''
  let osnova: number | null = null
  let cislovani: boolean | null = null
  let zaklad: string | null = null
  let znacek = 0
  for (const k of kousky(xml)) {
    if (!k.znacka) continue
    if (++znacek > MAX_ZNACEK_STYLU) break
    const z = rozebrat(k.text)
    if (!z) continue
    if (z.jmeno === 'w:style') {
      if (!z.konec) {
        id = hodnota(z.text, 'w:styleId')
        jmeno = ''
        osnova = null
        cislovani = null
        zaklad = null
        if (!z.prazdna) continue
      }
      if (id !== null) {
        const n = jmeno.trim().toLowerCase()
        const nadpis = /^heading [1-9]$/.test(n)
          ? nadpisOsnovy(Number(n.slice(8)) - 1)
          : n === 'title'
            ? 1
            : n === 'subtitle'
              ? 2
              : osnova !== null
                ? nadpisOsnovy(osnova)
                : null
        surove.set(id, { nadpis, odrazka: cislovani, zaklad })
      }
      id = null
    } else if (id !== null && !z.konec) {
      if (z.jmeno === 'w:name') jmeno = hodnota(z.text, 'w:val') ?? ''
      else if (z.jmeno === 'w:outlineLvl') osnova = cislo(z.text)
      else if (z.jmeno === 'w:numId') cislovani = hodnota(z.text, 'w:val') !== '0'
      else if (z.jmeno === 'w:basedOn') zaklad = hodnota(z.text, 'w:val')
    }
  }

  const styly = new Map<string, Styl>()
  for (const [klic, s] of surove) {
    let { nadpis, odrazka } = s
    // Nanejvýš deset pater — zacyklené `basedOn` v cizím souboru nesmí viset.
    let dalsi = s.zaklad
    for (let i = 0; i < 10 && dalsi && (nadpis === null || odrazka === null); i++) {
      const z = surove.get(dalsi)
      if (!z) break
      nadpis ??= z.nadpis
      odrazka ??= z.odrazka
      dalsi = z.zaklad
    }
    styly.set(klic, { nadpis: nadpis ?? 0, odrazka: odrazka ?? false })
  }
  return styly
}

/* --- dokument ---------------------------------------------------------- */

/** Spojí úseky iniciály s odstavcem za ní („V“ + „ítáme vás“). */
function spojit(pred: Usek[], za: Usek[]): Usek[] {
  const a = pred[pred.length - 1]
  const b = za[0]
  if (
    a &&
    b &&
    !a.zastupny &&
    !b.zastupny &&
    a.tucne === b.tucne &&
    a.kurziva === b.kurziva &&
    a.podtrzeno === b.podtrzeno
  ) {
    return [...pred.slice(0, -1), { ...a, text: a.text + b.text }, ...za.slice(1)]
  }
  return [...pred, ...za]
}

/**
 * Dekóduje entity (`&amp;`) po kusech a skončí, jakmile má `nejvic`
 * znaků, nebo po `nejvic × DELKA_ENTITY` znacích ze souboru. Kus
 * nekončí uprostřed entity — useknutá by se ukázala jako `&quo`.
 * Vrátí nejvýš `nejvic` znaků a jestli něco zbylo.
 */
export function odkodovatDo(s: string, nejvic: number): { text: string; zbylo: boolean } {
  const strop = Math.min(s.length, nejvic * DELKA_ENTITY)
  let text = ''
  let i = 0
  while (i < strop && text.length < nejvic) {
    let konec = Math.min(strop, i + KUS_ENTIT)
    const amp = konec < s.length ? s.lastIndexOf('&', konec - 1) : -1
    if (amp >= i) {
      const strednik = s.indexOf(';', amp)
      if (strednik === -1 || strednik >= konec) {
        // Poslední `&` v kusu nemá v kusu konec.
        if (amp > i) konec = amp
        // Entita delší než kus: celá, když se vejde pod strop.
        else if (strednik !== -1 && strednik < strop) konec = strednik + 1
        // Konec entity je za stropem (nebo kus končí na stropu): pod strop
        // se nevejde a ukázal by se z ní jen začátek.
        else if (strednik !== -1 || konec === strop) break
      }
    }
    text += odkodovat(s.slice(i, konec))
    i = konec
  }
  return { text: zacatek(text, nejvic), zbylo: i < s.length || text.length > nejvic }
}

/**
 * Prvních `n` jednotek UTF-16 bez useknuté poloviny znaku na konci.
 * Emoji je v řetězci dvojice; samotná první půlka by se na stránce
 * ukázala jako „�“.
 */
function zacatek(s: string, n: number): string {
  if (s.length <= n) return s
  const c = s.charCodeAt(n - 1)
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n)
}

/**
 * Dokončí tabulku. Řádek má nanejvýš MAX_BUNEK buněk a MAX_MRIZKY
 * sloupců mřížky; co je za nimi, se uřízne. Svisle sloučené buňky
 * (`w:vMerge`): pokračování se schová a buňka, kde sloučení začíná, se
 * o řádek protáhne. Sloupec
 * se počítá podle mřížky (šířky buněk), ne podle pořadí buňky v řádku.
 * Vrátí, jestli se něco uřízlo.
 */
function dokoncitTabulku(t: Tabulka, pokracuji: Set<Bunka>): boolean {
  let orezano = false
  let nad = new Map<number, Bunka>()
  for (const radek of t.radky) {
    const tady = new Map<number, Bunka>()
    let sloupec = 0
    let bunek = 0
    for (let i = 0; i < radek.length; i++) {
      const b = radek[i]
      if (sloupec >= MAX_MRIZKY || (!b.odsazeni && bunek >= MAX_BUNEK)) {
        radek.length = i
        orezano = true
        break
      }
      if (!b.odsazeni) bunek++
      b.sirka = Math.min(b.sirka, MAX_MRIZKY - sloupec)
      const puvod = pokracuji.has(b) ? nad.get(sloupec) : undefined
      if (puvod && puvod.sirka === b.sirka) {
        puvod.vyska++
        b.sloucena = true
        // Pokračování bývá prázdné; kdyby v něm něco bylo, neztratí se.
        for (const x of b.bloky) if (x.druh === 'tabulka' || x.useky.length) puvod.bloky.push(x)
        b.bloky = []
        tady.set(sloupec, puvod)
      } else if (!b.odsazeni) {
        tady.set(sloupec, b)
      }
      sloupec += b.sirka
    }
    nad = tady
  }
  return orezano
}

export function ctiDokument(xml: string, styly: Map<string, Styl> = new Map()): NahledDocx {
  const koren: Blok[] = []
  // Kam patří další odstavec: tělo dokumentu, nebo buňka tabulky.
  const kontejnery: Blok[][] = [koren]
  // Otevřené tabulky a kolik buněk bylo otevřených, když začaly.
  const tabulky: { tabulka: Tabulka; bunek: number }[] = []
  // Otevřené buňky (víc = vnořená tabulka); jdou spolu s `kontejnery`.
  const bunky: Bunka[] = []
  const pokracuji = new Set<Bunka>()
  // Hlubší tabulky než MAX_VNORENI_TABULEK: jejich řádky a buňky se
  // přeskočí, text zůstane v buňce o patro výš.
  let prehlizenychTabulek = 0
  // Otevřené odstavce. Víc než jeden = textové pole uvnitř odstavce.
  const odstavce: Odstavec[] = []
  // Formát otevřených běhů textu (`w:r`). Odstavec i obsah textového
  // pole (`w:txbxContent`) začínají zarážkou `null`: pole leží uvnitř
  // běhu okolního odstavce a formát z něj (třeba z `w:rPr` ve `w:sdtPr`
  // bloku v poli) nesmí okolnímu běhu nic přepsat.
  const behy: (Beh | null)[] = []
  // Iniciála je ve Wordu samostatný odstavec s jedním písmenem; patří
  // na začátek odstavce za ní — ve stejném kontejneru a stejně hluboko
  // (`hloubka` = počet okolních odstavců; víc = textové pole).
  const inicialy = new Set<Odstavec>()
  let iniciala: { odstavec: Odstavec; kontejner: Blok[]; hloubka: number } | null = null
  // Pole (`w:fldChar`): mezi začátkem a oddělovačem je příkaz, za ním
  // výsledek. Text v příkazu (výsledek vnořeného pole) se neukáže.
  // Políčko a rozbalovací seznam formuláře mají hodnotu v `w:ffData`
  // na začátku pole; ukáže se na konci, když pole samo žádný výsledek
  // neukázalo (`znaku` = kolik textu bylo na začátku pole; příkaz se
  // neukazuje, takže je to i stav před výsledkem).
  const pole: { prikaz: boolean; hodnota: string | null; znaku: number }[] = []
  let vPrikazu = 0
  let policko: { zaskrtnuto: boolean | null; vychozi: boolean } | null = null
  let seznam: { vybrano: number | null; vychozi: number; polozky: string[] } | null = null
  // Grafika (`a:graphicData`), která se počítá jako obrázek — co je
  // uvnitř, se už nepočítá znovu.
  const grafiky: boolean[] = []
  let vGrafice = 0
  // Vzorec (`m:oMath`) má v náhledu jen značku. Text v něm — i `w:t`
  // v `m:r`, jak ho píšou převodníky — by za ní stál bez smyslu (½ jako „12“).
  let vMatematice = 0
  let vT = false
  let telo = false
  let preskocit = 0
  let obrazku = 0
  let znaku = 0
  let useku = 0
  let bloku = 0
  let znacek = 0
  let zkraceno = false
  let oriznutaTabulka = false

  const dalsiBlok = (): boolean => {
    if (bloku >= MAX_BLOKU) {
      zkraceno = true
      return false
    }
    bloku++
    return true
  }

  const pridatBlok = (b: Blok, kam: Blok[] = kontejnery[kontejnery.length - 1]) => {
    if (dalsiBlok()) kam.push(b)
  }

  const vypustitInicialu = () => {
    if (!iniciala) return
    const { odstavec, kontejner } = iniciala
    iniciala = null
    pridatBlok(odstavec, kontejner)
  }

  const uzavritOdstavec = (p: Odstavec) => {
    const kontejner = kontejnery[kontejnery.length - 1]
    const hloubka = odstavce.length
    // Odstavec textového pole leží uvnitř odstavce za iniciálou a zavře
    // se dřív než on — iniciála na něj počká.
    if (iniciala && hloubka > iniciala.hloubka) {
      pridatBlok(p)
      return
    }
    if (iniciala && iniciala.kontejner === kontejner && iniciala.hloubka === hloubka && !inicialy.has(p)) {
      p.useky = spojit(iniciala.odstavec.useky, p.useky)
      iniciala = null
    }
    vypustitInicialu()
    if (inicialy.has(p) && p.useky.length) iniciala = { odstavec: p, kontejner, hloubka }
    else pridatBlok(p)
  }

  // Zavře běhy až po nejbližší zarážku (konec odstavce nebo textového
  // pole) — i ty, které zůstaly otevřené (rozbitý soubor).
  const zavritBehy = () => {
    while (behy.length && behy.pop() !== null) {
      // nic
    }
  }

  const viditelny = () => !vPrikazu && !vMatematice && !behy[behy.length - 1]?.skryto

  /**
   * Přidá text do otevřeného odstavce. `surovy` = text ze souboru, ještě
   * s entitami (`&amp;`): dekóduje se až tady — jen to, co se ukáže,
   * a jen tolik, kolik se ho ještě vejde (odkodovatDo). Megabajty entit
   * ve skrytém textu by jinak zabraly server na vteřiny.
   */
  const pridatText = (text: string, zastupny = false, surovy = false) => {
    const p = odstavce[odstavce.length - 1]
    if (!p || !viditelny()) return
    if (surovy) {
      const d = odkodovatDo(text, MAX_ZNAKU - znaku)
      text = d.text
      if (d.zbylo) zkraceno = true
    }
    if (znaku + text.length > MAX_ZNAKU) {
      text = zacatek(text, MAX_ZNAKU - znaku)
      zkraceno = true
    }
    // Na stropu nezbude nic — prázdný úsek by z odstavce udělal neprázdný.
    if (!text) return
    const beh = (!zastupny && behy[behy.length - 1]) || { tucne: false, kurziva: false, podtrzeno: false }
    const posledni = p.useky[p.useky.length - 1]
    if (
      posledni &&
      !zastupny &&
      !posledni.zastupny &&
      posledni.tucne === beh.tucne &&
      posledni.kurziva === beh.kurziva &&
      posledni.podtrzeno === beh.podtrzeno
    ) {
      posledni.text += text
    } else if (useku < MAX_USEKU) {
      useku++
      p.useky.push({ text, tucne: beh.tucne, kurziva: beh.kurziva, podtrzeno: beh.podtrzeno, zastupny })
    } else {
      zkraceno = true
      return
    }
    znaku += text.length
  }

  const obrazek = () => {
    if (!odstavce.length || !viditelny()) return
    obrazku++
    pridatText('obrázek', true)
  }

  for (const k of kousky(xml)) {
    if (zkraceno) break
    if (!k.znacka) {
      if (vT && !preskocit) pridatText(k.text, false, !k.doslova)
      continue
    }
    if (++znacek > MAX_ZNACEK) {
      zkraceno = true
      break
    }
    const z = rozebrat(k.text)
    if (!z) continue

    if (PRESKOCIT.has(z.jmeno)) {
      if (z.konec) preskocit = Math.max(0, preskocit - 1)
      else if (!z.prazdna) preskocit++
      continue
    }
    if (preskocit) continue

    const odstavec = odstavce[odstavce.length - 1]
    const beh = behy[behy.length - 1]

    switch (z.jmeno) {
      case 'w:body':
        if (!z.konec) telo = true
        break
      // Vložený HTML nebo jiný dokument (html-docx-js, „export do Wordu“).
      // Word ho ukáže, náhled ne — radši to říct, než tvrdit „bez textu“.
      case 'w:altChunk':
        throw new DokumentNecitelny(NEZNAMY)

      case 'w:p': {
        if (z.konec) {
          zavritBehy()
          const p = odstavce.pop()
          if (p) uzavritOdstavec(p)
        } else {
          const p: Odstavec = { druh: 'odstavec', nadpis: 0, odrazka: false, useky: [] }
          if (z.prazdna) {
            uzavritOdstavec(p)
          } else {
            odstavce.push(p)
            behy.push(null)
          }
        }
        break
      }
      case 'w:txbxContent':
        if (z.konec) zavritBehy()
        else if (!z.prazdna) behy.push(null)
        break
      // Vlastnosti odstavce (jsou jen ve `w:pPr`; verze před změnou se
      // přeskočí celá).
      case 'w:pStyle': {
        const s = styly.get(hodnota(z.text, 'w:val') ?? '')
        if (odstavec && s) {
          odstavec.nadpis = s.nadpis
          odstavec.odrazka = s.odrazka
        }
        break
      }
      case 'w:outlineLvl': {
        const n = nadpisOsnovy(cislo(z.text))
        if (odstavec && n !== null) odstavec.nadpis = n
        break
      }
      case 'w:numId':
        if (odstavec && !z.konec) odstavec.odrazka = hodnota(z.text, 'w:val') !== '0'
        break
      case 'w:framePr': {
        const zpusob = hodnota(z.text, 'w:dropCap')
        if (odstavec && zpusob && zpusob !== 'none') inicialy.add(odstavec)
        break
      }

      case 'w:r':
        if (z.konec) {
          if (behy.length && behy[behy.length - 1] !== null) behy.pop()
        } else if (!z.prazdna) {
          behy.push({ tucne: false, kurziva: false, podtrzeno: false, skryto: false })
        }
        break
      // Formát patří běhu jen z jeho `w:rPr`. Formát značky konce
      // odstavce (`w:rPr` ve `w:pPr`) ani `w:rPr` ve `w:sdtPr` na text
      // nepatří — tam není otevřený běh, `beh` je zarážka `null`.
      case 'w:b':
        if (beh && !z.konec) beh.tucne = zapnuto(z.text)
        break
      case 'w:i':
        if (beh && !z.konec) beh.kurziva = zapnuto(z.text)
        break
      case 'w:u':
        if (beh && !z.konec) beh.podtrzeno = zapnuto(z.text)
        break
      case 'w:vanish':
        if (beh && !z.konec) beh.skryto = zapnuto(z.text)
        break

      case 'w:t':
        vT = !z.konec && !z.prazdna
        break
      // V `w:pPr` je `w:tab` zarážka tabulátoru, ne tabulátor v textu —
      // tam není otevřený běh (`beh` je zarážka `null`).
      // `w:ptab` je tabulátor zarovnaný k okraji (cena za tečkami).
      case 'w:tab':
      case 'w:ptab':
        if (beh && !z.konec) pridatText('\t')
        break
      case 'w:br':
      case 'w:cr':
        if (beh && !z.konec) pridatText('\n')
        break
      case 'w:noBreakHyphen':
        if (beh && !z.konec) pridatText('‑')
        break
      case 'w:sym':
        if (beh && !z.konec) {
          const s = symbol(z.text)
          pridatText(s.text, s.zastupny)
        }
        break

      case 'w:fldChar': {
        if (z.konec) break
        const typ = hodnota(z.text, 'w:fldCharType')
        if (typ === 'begin') {
          pole.push({ prikaz: true, hodnota: null, znaku })
          vPrikazu++
        } else if (typ === 'separate') {
          const p = pole[pole.length - 1]
          if (p?.prikaz) {
            p.prikaz = false
            vPrikazu--
          }
        } else if (typ === 'end') {
          const p = pole.pop()
          if (p?.prikaz) vPrikazu--
          if (p?.hodnota && znaku === p.znaku) pridatText(p.hodnota, false, true)
        }
        break
      }
      // Starší pole formuláře: zaškrtávací políčko (FORMCHECKBOX)
      // a rozbalovací seznam (FORMDROPDOWN, hodnota = pořadí položky).
      case 'w:checkBox':
        if (z.konec || z.prazdna) {
          const p = pole[pole.length - 1]
          const s = z.prazdna ? { zaskrtnuto: null, vychozi: false } : policko
          if (p && s) p.hodnota = (s.zaskrtnuto ?? s.vychozi) ? '☒' : '☐'
          policko = null
        } else {
          policko = { zaskrtnuto: null, vychozi: false }
        }
        break
      case 'w:ddList':
        if (z.konec) {
          const p = pole[pole.length - 1]
          if (p && seznam) p.hodnota = seznam.polozky[seznam.vybrano ?? seznam.vychozi] ?? null
          seznam = null
        } else {
          seznam = { vybrano: null, vychozi: 0, polozky: [] }
        }
        break
      case 'w:default':
        if (z.konec) break
        if (policko) policko.vychozi = zapnuto(z.text)
        else if (seznam) seznam.vychozi = cislo(z.text)
        break
      case 'w:checked':
        if (policko && !z.konec) policko.zaskrtnuto = zapnuto(z.text)
        break
      case 'w:result':
        if (seznam && !z.konec) seznam.vybrano = cislo(z.text)
        break
      case 'w:listEntry':
        if (seznam && !z.konec) seznam.polozky.push(hodnota(z.text, 'w:val') ?? '')
        break

      // Obrázek, graf, SmartArt i budoucí druhy grafiky podle obalu —
      // kromě tvaru, skupiny a plátna: v nich bývá textové pole a jeho
      // text se ukáže (obrázek v nich se spočítá zvlášť).
      case 'a:graphicData': {
        if (z.konec) {
          if (grafiky.pop()) vGrafice--
          break
        }
        const pocitat = !vGrafice && !/wordprocessing(Shape|Group|Canvas)$/.test(hodnota(z.text, 'uri') ?? '')
        if (pocitat) obrazek()
        if (!z.prazdna) {
          grafiky.push(pocitat)
          if (pocitat) vGrafice++
        }
        break
      }
      // Obrázek ve skupině, výplň tvaru obrázkem, starý obrázek (VML).
      case 'pic:pic':
      case 'a:blipFill':
      case 'v:imagedata':
        if (!z.konec && !vGrafice) obrazek()
        break
      case 'm:oMath':
        if (z.konec) {
          if (vMatematice) vMatematice--
        } else if (!z.prazdna) {
          pridatText('vzorec', true)
          vMatematice++
        }
        break

      case 'w:tbl':
        if (z.konec) {
          if (prehlizenychTabulek) {
            prehlizenychTabulek--
          } else {
            const o = tabulky.pop()
            if (o) {
              // Buňky, které tabulka nechala otevřené (rozbitý soubor),
              // se zavřou s ní — jinak by další tabulka vlezla do jedné
              // z nich, o patro hlouběji, a strop na vnoření by neplatil.
              // Jen zkrátit: když už je buňek míň (vnitřní tabulka bez
              // `</w:tbl>`, zbloudilé `</w:tc>`), prodloužení by do
              // zásobníku dalo díry a další odstavec by shodil čtení.
              if (bunky.length > o.bunek) {
                bunky.length = o.bunek
                kontejnery.length = o.bunek + 1
              }
              // Uříznutý řádek čtení nezastaví — text za tabulkou zůstane.
              if (dokoncitTabulku(o.tabulka, pokracuji)) oriznutaTabulka = true
            }
          }
        } else if (!z.prazdna) {
          if (tabulky.length >= MAX_VNORENI_TABULEK || prehlizenychTabulek) {
            prehlizenychTabulek++
          } else {
            vypustitInicialu()
            const t: Tabulka = { druh: 'tabulka', radky: [] }
            pridatBlok(t)
            if (!zkraceno) tabulky.push({ tabulka: t, bunek: bunky.length })
          }
        }
        break
      case 'w:tr': {
        const t = tabulky[tabulky.length - 1]?.tabulka
        if (!prehlizenychTabulek && !z.konec && !z.prazdna && t && dalsiBlok()) t.radky.push([])
        break
      }
      // Řádek začíná o sloupce dál — bez prázdného místa by se buňky
      // posunuly doleva pod cizí záhlaví. (`w:gridBefore` je jen ve
      // `w:trPr`, `w:gridSpan` a `w:vMerge` jen ve `w:tcPr`; verze před
      // změnou se přeskočí celá.) V přeskočené hluboké tabulce nepatří
      // řádku ani buňce o patro výš.
      case 'w:gridBefore': {
        const t = tabulky[tabulky.length - 1]?.tabulka
        const radek = t?.radky[t.radky.length - 1]
        const n = sloupcu(z.text, 0)
        if (!prehlizenychTabulek && radek && n > 0 && dalsiBlok()) {
          radek.push({ bloky: [], sirka: n, vyska: 1, sloucena: false, odsazeni: true })
        }
        break
      }
      case 'w:tc':
        if (prehlizenychTabulek) break
        if (z.konec) {
          // Zbloudilé `</w:tc>` mimo buňku nesmí zavřít tělo dokumentu.
          if (bunky.length) {
            bunky.pop()
            kontejnery.pop()
          }
        } else if (!z.prazdna && dalsiBlok()) {
          // Buňka se otevře i bez řádku (rozbitý soubor) — jinak by
          // zavírací značka zavřela cizí kontejner.
          const bunka: Bunka = { bloky: [], sirka: 1, vyska: 1, sloucena: false, odsazeni: false }
          const t = tabulky[tabulky.length - 1]?.tabulka
          t?.radky[t.radky.length - 1]?.push(bunka)
          bunky.push(bunka)
          kontejnery.push(bunka.bloky)
        }
        break
      case 'w:gridSpan':
      case 'w:vMerge': {
        const bunka = prehlizenychTabulek || z.konec ? undefined : bunky[bunky.length - 1]
        if (!bunka) break
        if (z.jmeno === 'w:gridSpan') bunka.sirka = sloupcu(z.text, 1)
        else if (hodnota(z.text, 'w:val') !== 'restart') pokracuji.add(bunka)
        break
      }
    }
  }

  // Zkrácený (nebo neuzavřený) dokument skončí uprostřed odstavce —
  // rozepsaný odstavec se ukáže, jinak by zmizel i text, který se do
  // stropu ještě vešel.
  for (let p = odstavce.pop(); p; p = odstavce.pop()) {
    if (p.useky.length) uzavritOdstavec(p)
  }
  vypustitInicialu()
  for (const o of tabulky) if (dokoncitTabulku(o.tabulka, pokracuji)) oriznutaTabulka = true

  // Bez `w:body` náhled v souboru nic nepoznal (jiná předpona než `w:`,
  // jiný zápis) — „v dokumentu není žádný text“ by byla nepravda.
  if (!telo && !zkraceno) throw new DokumentNecitelny(NEZNAMY)

  return { bloky: koren, obrazku, zkraceno, oriznutaTabulka }
}

/**
 * Část, na kterou ukazuje vazba daného druhu (`Type` končí na `druh`).
 * Cesta v `Target` je vůči složce části, které seznam vazeb patří
 * (`zaklad`), nebo od kořene balíku, když začíná lomítkem. Vazba na
 * adresu mimo balík (`TargetMode="External"`) se přeskočí — jinak by
 * schovala skutečnou část za ní.
 */
function cilVazby(rels: string, druh: string, zaklad: string): string | null {
  let znacek = 0
  for (const k of kousky(rels)) {
    if (!k.znacka) continue
    if (++znacek > MAX_ZNACEK_VAZEB) return null
    if (!/^<Relationship[\s/]/.test(k.text)) continue
    if (!(hodnota(k.text, 'Type') ?? '').endsWith(`/${druh}`)) continue
    if (hodnota(k.text, 'TargetMode') === 'External') continue
    const cil = hodnota(k.text, 'Target')
    if (!cil) continue
    if (cil.startsWith('/')) return cil.slice(1)
    const casti = zaklad.split('/').slice(0, -1)
    for (const c of cil.split('/')) {
      if (c === '..') casti.pop()
      else if (c && c !== '.') casti.push(c)
    }
    return casti.join('/')
  }
  return null
}

/** Seznam vazeb části: `word/document.xml` → `word/_rels/document.xml.rels`. */
function vazbyCasti(cesta: string): string {
  const i = cesta.lastIndexOf('/')
  return `${cesta.slice(0, i + 1)}_rels/${cesta.slice(i + 1)}.rels`
}

/**
 * Přečte .docx a vrátí obsah pro náhled. Cokoli, co nejde přečíst, je
 * `DokumentNecitelny` se srozumitelnou větou — nikdy jiná výjimka.
 */
export function precistDocx(bajty: Uint8Array): NahledDocx {
  try {
    let zip: Map<string, Polozka>
    try {
      zip = ctiZip(bajty)
    } catch {
      throw new DokumentNecitelny('Soubor není dokument Word (.docx).')
    }
    const vezmi = (nazev: string, strop: number): string => {
      const pol = zip.get(nazev)
      return pol ? rozbal(bajty, pol, strop) : ''
    }
    let hlavni = cilVazby(vezmi('_rels/.rels', MAX_VAZEB_BAJTU), 'officeDocument', '') ?? 'word/document.xml'
    let dokument = vezmi(hlavni, MAX_XML_BAJTU)
    if (!dokument && hlavni !== 'word/document.xml') {
      hlavni = 'word/document.xml'
      dokument = vezmi(hlavni, MAX_XML_BAJTU)
    }
    // Sešit nebo prezentace mají hlavní část taky, ale ne Wordovou.
    if (!dokument || !/wordprocessingml\/2006\/main|ooxml\/wordprocessingml\/main/.test(dokument)) {
      throw new DokumentNecitelny('V souboru není text dokumentu Word.')
    }
    // Styly podle vazeb hlavní části; obvykle `word/styles.xml`.
    const cestaStylu = cilVazby(vezmi(vazbyCasti(hlavni), MAX_VAZEB_BAJTU), 'styles', hlavni) ?? 'word/styles.xml'
    const styly = vezmi(cestaStylu, MAX_STYLU_BAJTU) || (cestaStylu === 'word/styles.xml' ? '' : vezmi('word/styles.xml', MAX_STYLU_BAJTU))
    return ctiDokument(dokument, ctiStyly(styly))
  } catch (e) {
    if (e instanceof DokumentNecitelny) throw e
    throw new DokumentNecitelny('Dokument je poškozený.')
  }
}
