/**
 * Zápis PDF — bez knihoven.
 *
 * Potřeba je jedno: tabulka s textem, rámečky a výplněmi na stránkách A4.
 * Proto je tu jen to — jednoduchá stránka s textem, obdélníky a čarami,
 * dvě písma (Helvetica a Helvetica-Bold, „základní čtrnáctka“ PDF, která
 * má každá čtečka) a xref tabulka.
 *
 * ---------------------------------------------------------------------
 * ČEŠTINA BEZ VLOŽENÉHO PÍSMA
 *
 * Kódování WinAnsi (cp1252) umí á é í ó ú ý š ž, ale ne ě č ď ň ř ť ů.
 * Ty se dopisují přes `/Differences` na nepoužité kódy 1–23 pod svými
 * standardními jmény glyfů (`/ecaron`, `/rcaron`, `/uring` …), která
 * Helvetica v každé čtečce má — stejný postup, jakým se středoevropské
 * znaky do základních písem dostávaly vždycky. Nic se nevkládá, takže je
 * soubor malý a nezávislý na fontech ve stroji.
 *
 * Šířky znaků pro zalamování a ořez jsou z metrik Helvetiky (AFM).
 * Znaky s háčkem a čárkou mají stejnou šířku jako holé písmeno.
 *
 * Souřadnice se zadávají od LEVÉHO HORNÍHO rohu (jako na obrazovce),
 * převod na PDF (počátek vlevo dole) je tady.
 */

export type Barva = [number, number, number]
export type Pismo = 'normal' | 'tucne'

/* --- šířky znaků ----------------------------------------------------- */

// Kód 32…126, tisíciny čtverčíku.
const SIRKY_NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const SIRKY_TUCNE = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/** Znaky bez rozkladu na písmeno a diakritiku. */
const OSOBITNE: Record<string, number> = {
  '–': 556, '—': 1000, '•': 350, '…': 1000, '„': 333, '“': 333, '”': 333, '‘': 222, '’': 222,
  '×': 584, '·': 278, '€': 556, '°': 400, '§': 556, ' ': 278, '→': 584, '✓': 556,
}

export function sirkaZnaku(znak: string, pismo: Pismo = 'normal'): number {
  const tab = pismo === 'tucne' ? SIRKY_TUCNE : SIRKY_NORMAL
  const o = OSOBITNE[znak]
  if (o !== undefined) return o
  const kod = znak.codePointAt(0) ?? 63
  if (kod >= 32 && kod <= 126) return tab[kod - 32]
  // á → a, Č → C, ů → u: šířku má holé písmeno.
  const zaklad = znak.normalize('NFD').codePointAt(0) ?? 63
  if (zaklad >= 32 && zaklad <= 126) return tab[zaklad - 32]
  return tab['?'.charCodeAt(0) - 32]
}

/** Šířka textu v bodech. */
export function sirkaTextu(text: string, velikost: number, pismo: Pismo = 'normal'): number {
  let soucet = 0
  for (const z of text) soucet += sirkaZnaku(z, pismo)
  return (soucet * velikost) / 1000
}

/** Ořízne text s výpustkou tak, aby se vešel do `maxSirka`. */
export function zkratitText(text: string, maxSirka: number, velikost: number, pismo: Pismo = 'normal'): string {
  if (sirkaTextu(text, velikost, pismo) <= maxSirka) return text
  const vypustka = '…'
  let vysledek = ''
  for (const z of text) {
    if (sirkaTextu(vysledek + z + vypustka, velikost, pismo) > maxSirka) break
    vysledek += z
  }
  return vysledek.trimEnd() + vypustka
}

/* --- kódování textu -------------------------------------------------- */

const CP1252_NAD_LATIN1: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/** Středoevropské znaky mimo WinAnsi: [znak, kód, jméno glyfu]. Kódy 9, 10, 13 se vynechávají. */
const DOPLNKY: [string, number, string][] = [
  ['ě', 1, 'ecaron'], ['Ě', 2, 'Ecaron'], ['č', 3, 'ccaron'], ['Č', 4, 'Ccaron'],
  ['ď', 5, 'dcaron'], ['Ď', 6, 'Dcaron'], ['ň', 7, 'ncaron'], ['Ň', 8, 'Ncaron'],
  ['ř', 11, 'rcaron'], ['Ř', 12, 'Rcaron'], ['ť', 14, 'tcaron'], ['Ť', 15, 'Tcaron'],
  ['ů', 16, 'uring'], ['Ů', 17, 'Uring'], ['ľ', 18, 'lcaron'], ['Ľ', 19, 'Lcaron'],
  ['ĺ', 20, 'lacute'], ['Ĺ', 21, 'Lacute'], ['ŕ', 22, 'racute'], ['Ŕ', 23, 'Racute'],
]
const KOD_DOPLNKU = new Map(DOPLNKY.map(([z, k]) => [z, k]))

function kodZnaku(z: string): number {
  const d = KOD_DOPLNKU.get(z)
  if (d !== undefined) return d
  const c = z.codePointAt(0) ?? 63
  if (c >= 32 && c <= 126) return c
  if (c >= 0xa0 && c <= 0xff) return c
  return CP1252_NAD_LATIN1[z] ?? 63
}

/** Řetězec PDF v závorkách; vše mimo tisknutelné ASCII jde osmičkově. */
function retezec(text: string): string {
  let s = '('
  for (const z of text) {
    const k = kodZnaku(z)
    if (k === 0x28 || k === 0x29 || k === 0x5c) s += `\\${String.fromCharCode(k)}`
    else if (k >= 32 && k <= 126) s += String.fromCharCode(k)
    else s += `\\${k.toString(8).padStart(3, '0')}`
  }
  return `${s})`
}

/** Text metadat jako UTF-16BE v hexadecimálním zápisu. */
function retezecUnicode(text: string): string {
  let h = 'FEFF'
  for (let i = 0; i < text.length; i++) h += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  return `<${h}>`
}

const cislo = (n: number) => (Math.round(n * 100) / 100).toString()
const barvaOp = (b: Barva, op: 'rg' | 'RG') => `${b.map((c) => cislo(c)).join(' ')} ${op}`

/* --- stránka --------------------------------------------------------- */

export class StrankaPdf {
  readonly operace: string[] = []
  // Bez zkratky „parameter properties“: soubor se zkouší Nodem, který
  // TypeScript jen odstraňuje a takovou syntaxi neumí.
  readonly sirka: number
  readonly vyska: number

  constructor(sirka: number, vyska: number) {
    this.sirka = sirka
    this.vyska = vyska
  }

  obdelnik(x: number, y: number, w: number, h: number, o: { vypln?: Barva; ramecek?: Barva; tloustka?: number }) {
    const dolu = this.vyska - y - h
    if (o.vypln) this.operace.push(`${barvaOp(o.vypln, 'rg')} ${cislo(x)} ${cislo(dolu)} ${cislo(w)} ${cislo(h)} re f`)
    if (o.ramecek) {
      this.operace.push(
        `${barvaOp(o.ramecek, 'RG')} ${cislo(o.tloustka ?? 0.5)} w ${cislo(x)} ${cislo(dolu)} ${cislo(w)} ${cislo(h)} re S`,
      )
    }
  }

  cara(x1: number, y1: number, x2: number, y2: number, barva: Barva, tloustka = 0.5) {
    this.operace.push(
      `${barvaOp(barva, 'RG')} ${cislo(tloustka)} w ${cislo(x1)} ${cislo(this.vyska - y1)} m ${cislo(x2)} ${cislo(this.vyska - y2)} l S`,
    )
  }

  /**
   * Text s levým okrajem (nebo středem / pravým okrajem) v `x`; `y` je
   * účaří (dolní hrana písmen bez oušek).
   */
  text(
    text: string,
    x: number,
    y: number,
    o: { velikost?: number; pismo?: Pismo; barva?: Barva; zarovnani?: 'l' | 'c' | 'r' } = {},
  ) {
    const velikost = o.velikost ?? 9
    const pismo = o.pismo ?? 'normal'
    const sirka = sirkaTextu(text, velikost, pismo)
    const zacatek = o.zarovnani === 'c' ? x - sirka / 2 : o.zarovnani === 'r' ? x - sirka : x
    this.operace.push(
      `BT ${barvaOp(o.barva ?? [0, 0, 0], 'rg')} /${pismo === 'tucne' ? 'F2' : 'F1'} ${cislo(velikost)} Tf ${cislo(zacatek)} ${cislo(this.vyska - y)} Td ${retezec(text)} Tj ET`,
    )
  }
}

/* --- soubor ---------------------------------------------------------- */

export function zapsatPdf(stranky: StrankaPdf[], info: { nazev: string }): Uint8Array {
  // Čísla objektů: 1 katalog, 2 seznam stránek, 3 písmo, 4 tučné, 5 kódování,
  // 6 informace, pak dvojice (stránka, obsah).
  const objekty: string[] = []
  const pridej = (obsah: string) => objekty.push(obsah)

  const diferences = DOPLNKY.map(([, k, jmeno]) => `${k} /${jmeno}`).join(' ')
  const idStranky = (i: number) => 7 + i * 2
  const idObsahu = (i: number) => 8 + i * 2

  pridej('<< /Type /Catalog /Pages 2 0 R >>')
  pridej(`<< /Type /Pages /Kids [${stranky.map((_, i) => `${idStranky(i)} 0 R`).join(' ')}] /Count ${stranky.length} >>`)
  pridej('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 5 0 R >>')
  pridej('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 5 0 R >>')
  pridej(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${diferences}] >>`)
  pridej(`<< /Title ${retezecUnicode(info.nazev)} /Producer ${retezec('Foodtab')} >>`)

  stranky.forEach((s, i) => {
    pridej(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${cislo(s.sirka)} ${cislo(s.vyska)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idObsahu(i)} 0 R >>`,
    )
    const proud = s.operace.join('\n')
    pridej(`<< /Length ${proud.length} >>\nstream\n${proud}\nendstream`)
  })

  let vystup = '%PDF-1.4\n%âãÏÓ\n'
  const offsety: number[] = []
  objekty.forEach((o, i) => {
    offsety.push(vystup.length)
    vystup += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = vystup.length
  vystup += `xref\n0 ${objekty.length + 1}\n0000000000 65535 f \n`
  for (const o of offsety) vystup += `${String(o).padStart(10, '0')} 00000 n \n`
  vystup += `trailer\n<< /Size ${objekty.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  // Všechno je ASCII kromě čtyř znaků komentáře za hlavičkou; kódují se po bajtech.
  const bajty = new Uint8Array(vystup.length)
  for (let i = 0; i < vystup.length; i++) bajty[i] = vystup.charCodeAt(i) & 0xff
  return bajty
}
