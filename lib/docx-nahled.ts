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
 * odstavce, zalomení řádku, tabulátor; odrážky; tabulky, i vnořené;
 * textová pole) a `word/styles.xml` — který styl je nadpis. Id stylu
 * závisí na jazyku Wordu („Nadpis1“, „Heading1“), jméno stylu ne
 * („heading 1“).
 * Co ne: obrázky (jen se spočítají a v textu je po nich značka),
 * záhlaví a zápatí, poznámky pod čarou, komentáře, číslování
 * (číslovaný seznam se ukáže s odrážkou), barvy, písma. Odkaz se ukáže
 * jako text, ne jako odkaz — adresa z cizího souboru do aplikace nepatří.
 * Smazaný text ze sledování změn se neukáže, ukáže se dokument tak, jak
 * by vypadal po přijetí změn.
 *
 * BEZPEČNOST: výsledek je strom obyčejných dat (text + příznaky), žádné
 * HTML. React ho vypíše jako text, takže nic ze souboru se nespustí.
 * Rozbalení má strop (ZIP bomba), text má strop a delší dokument se
 * ukáže zkrácený.
 *
 * Čistý modul (jen node:zlib) — testuje ho scripts/rezervace.test.mjs.
 */

import { inflateRawSync } from 'node:zlib'

import { atribut, ctiZip, kousky, odkodovat, type Polozka } from './xlsx.ts'

/** Chyba, kterou má smysl ukázat člověku. */
export class DokumentNecitelny extends Error {}

/** Strop na jednu rozbalenou část. Běžný dokument má desítky až stovky kB. */
export const MAX_XML_BAJTU = 20 * 1024 * 1024
/** Kolik znaků textu náhled ukáže; celé je to v originálu. */
export const MAX_ZNAKU = 300_000
/** Kolik odstavců a tabulek náhled ukáže. */
export const MAX_BLOKU = 10_000

export type Usek = {
  text: string
  tucne: boolean
  kurziva: boolean
  podtrzeno: boolean
  /** Značka místo obsahu, který náhled neukáže (obrázek). */
  zastupny: boolean
}
export type Odstavec = {
  druh: 'odstavec'
  /** 0 = běžný text, 1–3 = úroveň nadpisu. */
  nadpis: 0 | 1 | 2 | 3
  odrazka: boolean
  useky: Usek[]
}
/** Řádky → buňky → obsah buňky (odstavce, případně další tabulka). */
export type Tabulka = { druh: 'tabulka'; radky: Blok[][][] }
export type Blok = Odstavec | Tabulka
export type NahledDocx = { bloky: Blok[]; obrazku: number; zkraceno: boolean }

type Styl = { nadpis: 0 | 1 | 2 | 3; odrazka: boolean }

/* --- ZIP --------------------------------------------------------------- */

/**
 * Rozbalí jednu část. Na rozdíl od lib/xlsx.ts (běží v prohlížeči toho,
 * kdo soubor sám vybral) tohle běží na serveru nad cizím souborem —
 * proto strop na velikost po rozbalení.
 */
function rozbal(bajty: Uint8Array, pol: Polozka): string {
  const d = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength)
  if (pol.offset + 30 > bajty.length || d.getUint32(pol.offset, true) !== 0x04034b50) {
    throw new DokumentNecitelny('Dokument je poškozený.')
  }
  const zacatek = pol.offset + 30 + d.getUint16(pol.offset + 26, true) + d.getUint16(pol.offset + 28, true)
  const data = bajty.subarray(zacatek, zacatek + pol.zabaleno)

  let obsah: Uint8Array
  if (pol.metoda === 0) {
    obsah = data
  } else if (pol.metoda === 8) {
    try {
      obsah = inflateRawSync(data, { maxOutputLength: MAX_XML_BAJTU })
    } catch (e) {
      const prilisVelky = (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
      throw new DokumentNecitelny(prilisVelky ? 'Dokument je na náhled příliš velký.' : 'Dokument je poškozený.')
    }
  } else {
    throw new DokumentNecitelny('Dokument je zabalený způsobem, který náhled nezná.')
  }
  if (obsah.length > MAX_XML_BAJTU) throw new DokumentNecitelny('Dokument je na náhled příliš velký.')
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
  const v = atribut(znacka, 'w:val')
  return v === null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}

/** Číselná hodnota `w:val`; bez ní NaN (Number(null) by dalo 0 = nadpis). */
function cislo(znacka: string): number {
  const v = atribut(znacka, 'w:val')
  return v === null ? NaN : Number(v)
}

function uroven(n: number): 0 | 1 | 2 | 3 {
  return n <= 0 ? 0 : n >= 3 ? 3 : (n as 1 | 2)
}

/**
 * Části, jejichž obsah se do náhledu nepočítá:
 *   - `mc:Fallback` — náhradní kopie pro starý Word (textové pole by
 *     bylo dvakrát),
 *   - `w:del`, `w:moveFrom` — smazaný a přesunutý text ze sledování změn,
 *   - `w:rPrChange`, `w:pPrChange` — formát PŘED změnou (jinak by se
 *     text ukázal tučně, i když už tučný není).
 */
const PRESKOCIT = new Set(['mc:Fallback', 'w:del', 'w:moveFrom', 'w:rPrChange', 'w:pPrChange'])

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
  for (const k of kousky(xml)) {
    if (!k.znacka) continue
    const z = rozebrat(k.text)
    if (!z) continue
    if (z.jmeno === 'w:style') {
      if (!z.konec) {
        id = atribut(z.text, 'w:styleId')
        jmeno = ''
        osnova = null
        cislovani = null
        zaklad = null
        if (!z.prazdna) continue
      }
      if (id !== null) {
        const n = jmeno.trim().toLowerCase()
        const nadpis = /^heading [1-9]$/.test(n)
          ? uroven(Number(n.slice(8)))
          : n === 'title'
            ? 1
            : n === 'subtitle'
              ? 2
              : osnova !== null && osnova >= 0 && osnova < 9
                ? uroven(osnova + 1)
                : null
        surove.set(id, { nadpis, odrazka: cislovani, zaklad })
      }
      id = null
    } else if (id !== null && !z.konec) {
      if (z.jmeno === 'w:name') jmeno = atribut(z.text, 'w:val') ?? ''
      else if (z.jmeno === 'w:outlineLvl') osnova = cislo(z.text)
      else if (z.jmeno === 'w:numId') cislovani = atribut(z.text, 'w:val') !== '0'
      else if (z.jmeno === 'w:basedOn') zaklad = atribut(z.text, 'w:val')
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

export function ctiDokument(xml: string, styly: Map<string, Styl> = new Map()): NahledDocx {
  const koren: Blok[] = []
  // Kam patří další odstavec: tělo dokumentu, nebo buňka tabulky.
  const kontejnery: Blok[][] = [koren]
  const tabulky: Tabulka[] = []
  // Otevřené odstavce. Víc než jeden = textové pole uvnitř odstavce.
  const odstavce: Odstavec[] = []
  // Formát otevřených běhů textu (`w:r`); vnořené jsou v textovém poli.
  const behy: { tucne: boolean; kurziva: boolean; podtrzeno: boolean }[] = []
  let vPPr = false
  let vRPr = false
  let vT = false
  let preskocit = 0
  let obrazku = 0
  let znaku = 0
  let bloku = 0
  let zkraceno = false

  const pridatBlok = (b: Blok) => {
    if (bloku >= MAX_BLOKU) {
      zkraceno = true
      return
    }
    bloku++
    kontejnery[kontejnery.length - 1].push(b)
  }

  const pridatText = (text: string, zastupny = false) => {
    const p = odstavce[odstavce.length - 1]
    if (!p || text === '') return
    if (znaku + text.length > MAX_ZNAKU) {
      text = text.slice(0, MAX_ZNAKU - znaku)
      zkraceno = true
    }
    znaku += text.length
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
    } else {
      p.useky.push({ text, ...beh, zastupny })
    }
  }

  for (const k of kousky(xml)) {
    if (zkraceno) break
    if (!k.znacka) {
      if (vT && !preskocit) pridatText(odkodovat(k.text))
      continue
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
      case 'w:p': {
        if (z.konec) {
          const p = odstavce.pop()
          if (p) pridatBlok(p)
        } else {
          const p: Odstavec = { druh: 'odstavec', nadpis: 0, odrazka: false, useky: [] }
          if (z.prazdna) pridatBlok(p)
          else odstavce.push(p)
        }
        break
      }
      case 'w:pPr':
        if (!z.prazdna) vPPr = !z.konec
        break
      case 'w:pStyle': {
        const s = styly.get(atribut(z.text, 'w:val') ?? '')
        if (vPPr && odstavec && s) {
          odstavec.nadpis = s.nadpis
          odstavec.odrazka = s.odrazka
        }
        break
      }
      case 'w:outlineLvl': {
        const n = cislo(z.text)
        if (vPPr && odstavec && Number.isInteger(n) && n >= 0 && n < 9) odstavec.nadpis = uroven(n + 1)
        break
      }
      case 'w:numId':
        if (vPPr && odstavec) odstavec.odrazka = atribut(z.text, 'w:val') !== '0'
        break

      case 'w:r':
        if (z.konec) behy.pop()
        else if (!z.prazdna) behy.push({ tucne: false, kurziva: false, podtrzeno: false })
        break
      case 'w:rPr':
        // Formát značky konce odstavce (v `w:pPr`) na text nepatří.
        if (!vPPr && beh && !z.prazdna) vRPr = !z.konec
        break
      case 'w:b':
        if (vRPr && beh && !z.konec) beh.tucne = zapnuto(z.text)
        break
      case 'w:i':
        if (vRPr && beh && !z.konec) beh.kurziva = zapnuto(z.text)
        break
      case 'w:u':
        if (vRPr && beh && !z.konec) beh.podtrzeno = zapnuto(z.text)
        break

      case 'w:t':
        vT = !z.konec && !z.prazdna && !!beh
        break
      // V `w:pPr` je `w:tab` zarážka tabulátoru, ne tabulátor v textu.
      case 'w:tab':
        if (beh && !vPPr && !z.konec) pridatText('\t')
        break
      case 'w:br':
      case 'w:cr':
        if (beh && !z.konec) pridatText('\n')
        break
      case 'w:noBreakHyphen':
        if (beh && !z.konec) pridatText('‑')
        break
      // Obrázek, graf a SmartArt — ne `w:drawing` celý: v něm bývá
      // i textové pole, a jeho text se ukáže.
      case 'pic:pic':
      case 'v:imagedata':
      case 'c:chart':
      case 'dgm:relIds':
        if (!z.konec) {
          obrazku++
          pridatText('obrázek', true)
        }
        break

      case 'w:tbl':
        if (z.konec) {
          tabulky.pop()
        } else if (!z.prazdna) {
          const t: Tabulka = { druh: 'tabulka', radky: [] }
          pridatBlok(t)
          tabulky.push(t)
        }
        break
      case 'w:tr':
        if (!z.konec && !z.prazdna) tabulky[tabulky.length - 1]?.radky.push([])
        break
      case 'w:tc':
        if (z.konec) {
          if (kontejnery.length > 1) kontejnery.pop()
        } else if (!z.prazdna) {
          // Buňka se otevře i bez řádku (rozbitý soubor) — jinak by
          // zavírací značka zavřela cizí kontejner.
          const bunka: Blok[] = []
          const t = tabulky[tabulky.length - 1]
          t?.radky[t.radky.length - 1]?.push(bunka)
          kontejnery.push(bunka)
        }
        break
    }
  }

  // Zkrácený (nebo neuzavřený) dokument skončí uprostřed odstavce —
  // rozepsaný odstavec se ukáže, jinak by zmizel i text, který se do
  // stropu ještě vešel.
  for (let p = odstavce.pop(); p; p = odstavce.pop()) {
    if (p.useky.length) pridatBlok(p)
  }

  return { bloky: koren, obrazku, zkraceno }
}

/** Hlavní část dokumentu podle `_rels/.rels`; obvykle `word/document.xml`. */
function hlavniCast(rels: string): string | null {
  for (const k of kousky(rels)) {
    if (!k.znacka || !/^<Relationship[\s/]/.test(k.text)) continue
    if (!/\/officeDocument$/.test(atribut(k.text, 'Type') ?? '')) continue
    const cil = atribut(k.text, 'Target')
    if (cil) return cil.replace(/^\//, '')
  }
  return null
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
    const vezmi = (nazev: string): string => {
      const pol = zip.get(nazev)
      return pol ? rozbal(bajty, pol) : ''
    }
    const cesta = hlavniCast(vezmi('_rels/.rels')) ?? 'word/document.xml'
    const dokument = vezmi(cesta) || vezmi('word/document.xml')
    if (!dokument) throw new DokumentNecitelny('V souboru není text dokumentu Word.')
    return ctiDokument(dokument, ctiStyly(vezmi('word/styles.xml')))
  } catch (e) {
    if (e instanceof DokumentNecitelny) throw e
    throw new DokumentNecitelny('Dokument je poškozený.')
  }
}
