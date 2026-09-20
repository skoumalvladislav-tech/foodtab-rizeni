/**
 * Zápis sešitu .xlsx — bez knihoven.
 *
 * Protějšek `lib/xlsx.ts` (čtení). Sešit je ZIP s několika XML soubory;
 * píše se nejjednodušší podoba, kterou Excel, LibreOffice i Numbers
 * otevřou bez varování:
 *
 *   * ZIP bez komprese (metoda 0) — soubory jsou malé a čtečka v
 *     lib/xlsx.ts i každý jiný program uložení bez komprese umí,
 *   * texty ve sdílené tabulce řetězců (`sharedStrings.xml`), ne inline,
 *   * jedna sada stylů zapsaná napevno (níž `STYL`),
 *   * čísla jako čísla (hodiny se dají sčítat), texty jako texty.
 *
 * Čistá funkce: stejný vstup dá stejné bajty (čas v ZIPu je pevný), takže
 * jde zkoušet Nodem a poznat, když se výstup nechtěně změní.
 */

/* --- veřejné typy ---------------------------------------------------- */

/** Čísla stylů — musí sedět s pořadím v `cellXfs` níž. */
export const STYL = {
  obycejny: 0,
  titul: 1,
  hlavicka: 2,
  /** Směny dne v úzké buňce (9 pt). */
  bunka: 3,
  bunkaVikend: 4,
  /** Text v tabulce Souhrn. */
  jmeno: 5,
  cislo: 6,
  cisloTucne: 7,
  poznamka: 8,
  souctovyText: 9,
  /** Záhlaví sloupce člověka: text otočený o 90°, aby sloupec mohl být úzký. */
  hlavickaOtocena: 10,
  /** Totéž naležato — když se jméno do sloupce vejde, otáčet ho nemá smysl. */
  hlavickaJmeno: 13,
  /** Den v levém sloupci („Po 1.“). */
  denRadek: 11,
  denRadekVikend: 12,
} as const

export type BunkaXlsx =
  /**
   * `drobne[i]` označí i-tý řádek textu (dělený `\n`) drobným šedým písmem
   * — vedlejší údaj pod hlavním, např. „pauza 15–17“ pod časem směny.
   */
  | { t: 's'; v: string; s?: number; drobne?: boolean[] }
  | { t: 'n'; v: number; s?: number }

export type ListXlsx = {
  nazev: string
  /** Šířky sloupců ve znacích. */
  sloupce: number[]
  /** Řádky; `null` = prázdná buňka. */
  radky: (BunkaXlsx | null)[][]
  /** Zmrazit prvních N řádků a M sloupců (hlavičku a jména). */
  zmrazit?: { radky: number; sloupce: number }
  /** Výška řádku v bodech podle čísla řádku od 1. */
  vyskyRadku?: Record<number, number>
  /** `false` = A4 na výšku; jinak na šířku. */
  naSirku?: boolean
  /** Při tisku zmenšit celý list na jednu stránku (na šířku i na výšku). */
  naJednuStranku?: boolean
  /**
   * Pevné měřítko tisku v procentech. Bez něj se list při tisku zmenší na
   * jednu stránku na šířku; s ním Excel ctí i ruční zalomení stránek
   * (`zalomeniPred`), které se s „přizpůsobit na šířku“ neslučuje.
   */
  meritko?: number
  /** Čísla řádků (od 1), PŘED kterými začíná nová stránka. */
  zalomeniPred?: number[]
  /**
   * Záhlaví a zápatí tisku v zápisu Excelu (`&L` vlevo, `&R` vpravo,
   * `&P` číslo strany, `&N` počet stran), na každé straně. Znak `&`
   * v textu zdvoj přes `textTisku`.
   */
  tisk?: { zahlavi?: string; zapati?: string }
  /**
   * Tiskne se jen od tohoto řádku (od 1) dolů. Nadpis listu nad ním je na
   * obrazovce, na papíře ho nahrazuje záhlaví — nezabírá tedy místo na
   * první straně a týdny se dělí stejně na každé.
   */
  tiskOdRadku?: number
}

/** Text do záhlaví/zápatí tisku: `&` je tam řídicí znak, zdvojí se. */
export const textTisku = (t: string) => t.replace(/&/g, '&&')

/* --- XML ------------------------------------------------------------- */

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Řídicí znaky (kromě tabulátoru a zalomení) nejsou v XML 1.0 povolené.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** 0 → A, 25 → Z, 26 → AA. */
export function sloupecNaPismeno(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const HLAVICKA_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const STYLY_XML = `${HLAVICKA_XML}<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6C7177"/><name val="Calibri"/></font>
<font><sz val="9"/><name val="Calibri"/></font>
<font><b/><sz val="9"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDEBE6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBEFD2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF6F5F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD6D1C7"/></left><right style="thin"><color rgb="FFD6D1C7"/></right><top style="thin"><color rgb="FFD6D1C7"/></top><bottom style="thin"><color rgb="FFD6D1C7"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" textRotation="90" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/* --- ZIP bez komprese ------------------------------------------------ */

const TABULKA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABULKA_CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Pevný čas v hlavičkách (1. 1. 2026 00:00), ať je výstup opakovatelný. */
const DOS_CAS = 0
const DOS_DATUM = ((2026 - 1980) << 9) | (1 << 5) | 1

export function zipBezKomprese(soubory: { nazev: string; data: string | Uint8Array }[]): Uint8Array {
  const kodovac = new TextEncoder()
  const casti: Uint8Array[] = []
  const adresar: Uint8Array[] = []
  let offset = 0

  for (const s of soubory) {
    const jmeno = kodovac.encode(s.nazev)
    const data = typeof s.data === 'string' ? kodovac.encode(s.data) : s.data
    const crc = crc32(data)

    const lokalni = new Uint8Array(30 + jmeno.length)
    const l = new DataView(lokalni.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true) // verze potřebná k rozbalení
    l.setUint16(6, 0x0800, true) // jména v UTF-8
    l.setUint16(8, 0, true) // metoda: uloženo
    l.setUint16(10, DOS_CAS, true)
    l.setUint16(12, DOS_DATUM, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, jmeno.length, true)
    l.setUint16(28, 0, true)
    lokalni.set(jmeno, 30)

    const ustredni = new Uint8Array(46 + jmeno.length)
    const u = new DataView(ustredni.buffer)
    u.setUint32(0, 0x02014b50, true)
    u.setUint16(4, 20, true)
    u.setUint16(6, 20, true)
    u.setUint16(8, 0x0800, true)
    u.setUint16(10, 0, true)
    u.setUint16(12, DOS_CAS, true)
    u.setUint16(14, DOS_DATUM, true)
    u.setUint32(16, crc, true)
    u.setUint32(20, data.length, true)
    u.setUint32(24, data.length, true)
    u.setUint16(28, jmeno.length, true)
    u.setUint32(42, offset, true)
    ustredni.set(jmeno, 46)

    casti.push(lokalni, data)
    adresar.push(ustredni)
    offset += lokalni.length + data.length
  }

  const velikostAdresare = adresar.reduce((n, a) => n + a.length, 0)
  const konec = new Uint8Array(22)
  const k = new DataView(konec.buffer)
  k.setUint32(0, 0x06054b50, true)
  k.setUint16(8, soubory.length, true)
  k.setUint16(10, soubory.length, true)
  k.setUint32(12, velikostAdresare, true)
  k.setUint32(16, offset, true)

  const vse = [...casti, ...adresar, konec]
  const vysledek = new Uint8Array(vse.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of vse) {
    vysledek.set(c, p)
    p += c.length
  }
  return vysledek
}

/* --- sešit ----------------------------------------------------------- */

/**
 * Jedna položka sdílených textů (`<si>`). Obyčejný text je jeden `<t>`;
 * s drobnými řádky je to formátovaný text po řádcích — každý běh dostane
 * písmo výslovně, ať se nezdědí jiná velikost než ta, kterou má buňka.
 */
function polozkaTextu(text: string, drobne?: boolean[]): string {
  if (!drobne) return `<si><t xml:space="preserve">${xml(text)}</t></si>`
  const radky = text.split('\n')
  const behy = radky.map((r, i) => {
    const pismo = drobne[i]
      ? '<rPr><sz val="7"/><color rgb="FF6C7177"/><rFont val="Calibri"/></rPr>'
      : '<rPr><sz val="9"/><rFont val="Calibri"/></rPr>'
    return `<r>${pismo}<t xml:space="preserve">${xml(r)}${i < radky.length - 1 ? '\n' : ''}</t></r>`
  })
  return `<si>${behy.join('')}</si>`
}

export function zapsatXlsx(listy: ListXlsx[]): Uint8Array {
  const sdilene: string[] = []
  const indexTextu = new Map<string, number>()
  let pocetTextu = 0
  const textId = (b: { v: string; drobne?: boolean[] }): number => {
    pocetTextu++
    // Stejný text s jiným rozložením drobného písma je jiná položka.
    const drobne = b.drobne?.some(Boolean) ? b.drobne : undefined
    const klic = drobne ? `${b.v}\u0001${drobne.map((d) => (d ? 1 : 0)).join('')}` : b.v
    let i = indexTextu.get(klic)
    if (i === undefined) {
      i = sdilene.length
      sdilene.push(polozkaTextu(b.v, drobne))
      indexTextu.set(klic, i)
    }
    return i
  }

  const listyXml = listy.map((list, li) => {
    const radky = list.radky
      .map((r, ri) => {
        const bunky = r
          .map((b, ci) => {
            if (!b) return ''
            const adresa = `${sloupecNaPismeno(ci)}${ri + 1}`
            const styl = b.s ? ` s="${b.s}"` : ''
            return b.t === 's'
              ? `<c r="${adresa}" t="s"${styl}><v>${textId(b)}</v></c>`
              : `<c r="${adresa}"${styl}><v>${Number.isFinite(b.v) ? b.v : 0}</v></c>`
          })
          .join('')
        const vyska = list.vyskyRadku?.[ri + 1]
        const atr = vyska ? ` ht="${vyska}" customHeight="1"` : ''
        return `<row r="${ri + 1}"${atr}>${bunky}</row>`
      })
      .join('')

    const nejdelsi = Math.max(1, ...list.radky.map((r) => r.length))
    const sloupce = list.sloupce
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join('')

    const z = list.zmrazit
    const pane = z
      ? `<pane${z.sloupce ? ` xSplit="${z.sloupce}"` : ''}${z.radky ? ` ySplit="${z.radky}"` : ''} topLeftCell="${sloupecNaPismeno(z.sloupce)}${z.radky + 1}" activePane="${z.radky && z.sloupce ? 'bottomRight' : z.radky ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : ''

    // Pevné měřítko, nebo „na jednu stránku na šířku“ (výška se dopočítá).
    const tisk = list.meritko
      ? `scale="${Math.round(list.meritko)}"`
      : `fitToWidth="1" fitToHeight="${list.naJednuStranku ? 1 : 0}"`
    const zalomeni = (list.zalomeniPred ?? []).filter((r) => r > 1)
    const zapatiXml = list.tisk
      ? `<headerFooter>${list.tisk.zahlavi ? `<oddHeader>${xml(list.tisk.zahlavi)}</oddHeader>` : ''}${list.tisk.zapati ? `<oddFooter>${xml(list.tisk.zapati)}</oddFooter>` : ''}</headerFooter>`
      : ''
    const zalomeniXml = zalomeni.length
      ? `<rowBreaks count="${zalomeni.length}" manualBreakCount="${zalomeni.length}">${zalomeni.map((r) => `<brk id="${r - 1}" max="16383" man="1"/>`).join('')}</rowBreaks>`
      : ''

    return `${HLAVICKA_XML}<worksheet xmlns="${NS}" xmlns:r="${NS_R}">${list.meritko ? '' : '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'}<dimension ref="A1:${sloupecNaPismeno(nejdelsi - 1)}${list.radky.length}"/><sheetViews><sheetView workbookViewId="0"${li === 0 ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${sloupce ? `<cols>${sloupce}</cols>` : ''}<sheetData>${radky}</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${list.naSirku === false ? 'portrait' : 'landscape'}" ${tisk}/>${zapatiXml}${zalomeniXml}</worksheet>`
  })

  const sharedXml = `${HLAVICKA_XML}<sst xmlns="${NS}" count="${pocetTextu}" uniqueCount="${sdilene.length}">${sdilene.join('')}</sst>`

  // Oblast tisku listů, které mají `tiskOdRadku` (jméno listu v apostrofech, `'` zdvojený).
  const oblasti = listy.flatMap((l, i) => {
    if (!l.tiskOdRadku) return []
    const sloupcu = Math.max(1, ...l.radky.map((r) => r.length))
    const list = `'${l.nazev.slice(0, 31).replace(/'/g, "''")}'`
    return [`<definedName name="_xlnm.Print_Area" localSheetId="${i}">${xml(list)}!$A$${l.tiskOdRadku}:$${sloupecNaPismeno(sloupcu - 1)}$${l.radky.length}</definedName>`]
  })
  const oblastiTisku = oblasti.length ? `<definedNames>${oblasti.join('')}</definedNames>` : ''

  const workbook = `${HLAVICKA_XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${listy
    .map((l, i) => `<sheet name="${xml(l.nazev.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets>${oblastiTisku}</workbook>`

  const workbookRels = `${HLAVICKA_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${listy
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}<Relationship Id="rId${listy.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${listy.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

  const typy = `${HLAVICKA_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${listy
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`

  const koren = `${HLAVICKA_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  return zipBezKomprese([
    { nazev: '[Content_Types].xml', data: typy },
    { nazev: '_rels/.rels', data: koren },
    { nazev: 'xl/workbook.xml', data: workbook },
    { nazev: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { nazev: 'xl/styles.xml', data: STYLY_XML },
    { nazev: 'xl/sharedStrings.xml', data: sharedXml },
    ...listyXml.map((data, i) => ({ nazev: `xl/worksheets/sheet${i + 1}.xml`, data })),
  ])
}
