/**
 * Čtení sešitu .xlsx bez knihovny.
 *
 * Proč vlastní čtečka a ne balíček: aplikace má dnes tři běhové
 * závislosti (Next, React, Supabase). Kvůli jedné obrazovce importu
 * přibrat další — a u tabulkových knihoven se historicky opravovaly
 * díry právě ve čtení cizích souborů — se nevyplatí. Formát potřebný
 * pro seznam lidí je malý kus specifikace: ZIP a dvě XML.
 *
 * Čte se jen to, co je k importu potřeba: první list a v něm text
 * buněk. Styly, vzorce a formáty se ignorují.
 *
 * POZOR: čísla se čtou tak, jak jsou uložená. Datum je v Excelu číslo
 * a bez čtení stylů se od běžného čísla nepozná — proto se odsud datumy
 * zatím netahají a import lidí je nepotřebuje. Až budou potřeba, patří
 * sem čtení `styles.xml`, ne hádání podle velikosti čísla.
 */

/** Jeden soubor uvnitř ZIP archivu, ještě zabalený. */
type Polozka = {
  nazev: string
  metoda: number
  offset: number
  zabaleno: number
}

/** Chyba, kterou má smysl ukázat člověku. */
export class SouborNecitelny extends Error {}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/**
 * Obsah ZIPu podle ústředního adresáře.
 *
 * Velikosti se berou odsud, ne z místní hlavičky: když má soubor
 * nastavený bit 3 (data descriptor), jsou v místní hlavičce nuly.
 * Z místní hlavičky se čte jen délka jména a extra pole, aby se našel
 * začátek dat.
 */
function ctiZip(bajty: Uint8Array): Map<string, Polozka> {
  const d = dv(bajty)

  // Konec ústředního adresáře. Hledá se od konce, protože za ním smí
  // být ještě komentář archivu (max 65535 bajtů).
  let konec = -1
  const dokud = Math.max(0, bajty.length - 65557)
  for (let i = bajty.length - 22; i >= dokud; i--) {
    if (d.getUint32(i, true) === 0x06054b50) {
      konec = i
      break
    }
  }
  if (konec === -1) throw new SouborNecitelny('Není to sešit ani ZIP.')

  const pocet = d.getUint16(konec + 10, true)
  let p = d.getUint32(konec + 16, true)
  if (pocet === 0xffff || p === 0xffffffff) {
    throw new SouborNecitelny('Sešit je uložený ve formátu ZIP64, ten čtečka nezná.')
  }

  const polozky = new Map<string, Polozka>()
  for (let i = 0; i < pocet; i++) {
    if (d.getUint32(p, true) !== 0x02014b50) break
    const metoda = d.getUint16(p + 10, true)
    const zabaleno = d.getUint32(p + 20, true)
    const dJmeno = d.getUint16(p + 28, true)
    const dExtra = d.getUint16(p + 30, true)
    const dKoment = d.getUint16(p + 32, true)
    const offset = d.getUint32(p + 42, true)
    const nazev = new TextDecoder().decode(bajty.subarray(p + 46, p + 46 + dJmeno))
    polozky.set(nazev, { nazev, metoda, offset, zabaleno })
    p += 46 + dJmeno + dExtra + dKoment
  }
  return polozky
}

/** Rozbalí jednu položku. Umí jen uložení bez komprese a deflate. */
async function rozbal(bajty: Uint8Array, pol: Polozka): Promise<string> {
  const d = dv(bajty)
  if (d.getUint32(pol.offset, true) !== 0x04034b50) {
    throw new SouborNecitelny('Sešit je poškozený.')
  }
  const dJmeno = d.getUint16(pol.offset + 26, true)
  const dExtra = d.getUint16(pol.offset + 28, true)
  const zacatek = pol.offset + 30 + dJmeno + dExtra
  const data = bajty.subarray(zacatek, zacatek + pol.zabaleno)

  if (pol.metoda === 0) return new TextDecoder().decode(data)
  if (pol.metoda !== 8) {
    throw new SouborNecitelny(`Sešit používá kompresi ${pol.metoda}, tu čtečka nezná.`)
  }

  const proud = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new TextDecoder().decode(await new Response(proud).arrayBuffer())
}

/* --- maličké čtení XML ---------------------------------------------
   Ne DOMParser: tenhle soubor musí jít pustit i mimo prohlížeč, aby se
   dal otestovat. Potřebujeme jen značky a text mezi nimi, ne strom. */

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function odkodovat(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (cele, telo: string) => {
    if (telo[0] === '#') {
      const kod = telo[1] === 'x' ? parseInt(telo.slice(2), 16) : parseInt(telo.slice(1), 10)
      return Number.isFinite(kod) ? String.fromCodePoint(kod) : cele
    }
    return ENTITY[telo] ?? cele
  })
}

/** Hodnota atributu ze značky. Respektuje uvozovky obojího druhu. */
function atribut(znacka: string, jmeno: string): string | null {
  const m = znacka.match(new RegExp(`\\b${jmeno}\\s*=\\s*("([^"]*)"|'([^']*)')`))
  return m ? odkodovat(m[2] ?? m[3] ?? '') : null
}

/** Postupně vrací značky a text mezi nimi. */
function* kousky(xml: string): Generator<{ znacka: boolean; text: string }> {
  let i = 0
  while (i < xml.length) {
    const zac = xml.indexOf('<', i)
    if (zac === -1) {
      if (i < xml.length) yield { znacka: false, text: xml.slice(i) }
      return
    }
    if (zac > i) yield { znacka: false, text: xml.slice(i, zac) }

    // Konec značky hledáme mimo uvozovky — atribut smí obsahovat '>'.
    let j = zac + 1
    let uv = ''
    while (j < xml.length) {
      const z = xml[j]
      if (uv) {
        if (z === uv) uv = ''
      } else if (z === '"' || z === "'") uv = z
      else if (z === '>') break
      j++
    }
    yield { znacka: true, text: xml.slice(zac, j + 1) }
    i = j + 1
  }
}

/** Sdílené texty (`sharedStrings.xml`) v pořadí, v jakém na ně list ukazuje. */
export function ctiSdileneTexty(xml: string): string[] {
  const texty: string[] = []
  let vSi = false
  let vT = false
  // Fonetický přepis japonštiny; do buňky nepatří, jinak by se text zdvojil.
  let vRph = false
  let sbirka = ''

  for (const k of kousky(xml)) {
    if (!k.znacka) {
      if (vSi && vT && !vRph) sbirka += odkodovat(k.text)
      continue
    }
    const z = k.text
    if (/^<si[\s/>]/.test(z)) {
      vSi = true
      sbirka = ''
      if (z.endsWith('/>')) {
        texty.push('')
        vSi = false
      }
    } else if (/^<\/si>/.test(z)) {
      texty.push(sbirka)
      vSi = false
    } else if (/^<rPh[\s/>]/.test(z)) vRph = true
    else if (/^<\/rPh>/.test(z)) vRph = false
    else if (/^<t[\s/>]/.test(z)) vT = !z.endsWith('/>')
    else if (/^<\/t>/.test(z)) vT = false
  }
  return texty
}

/** Z „BC12“ udělá index sloupce 0…n. */
export function sloupecZAdresy(adresa: string): number {
  let n = 0
  for (const z of adresa) {
    const k = z.charCodeAt(0)
    if (k < 65 || k > 90) break
    n = n * 26 + (k - 64)
  }
  return n - 1
}

/** Buňky prvního listu do mřížky. Chybějící buňky zůstanou prázdné. */
export function ctiList(xml: string, sdilene: string[]): string[][] {
  const mrizka: string[][] = []
  let radek: string[] = []
  let sloupec = -1
  let typ = ''
  let vHodnote = false
  let hodnota = ''

  const uloz = () => {
    if (sloupec < 0) return
    let text = hodnota
    if (typ === 's') {
      const i = Number(hodnota)
      text = Number.isInteger(i) && sdilene[i] !== undefined ? sdilene[i] : ''
    }
    while (radek.length < sloupec) radek.push('')
    radek[sloupec] = text
    sloupec = -1
    hodnota = ''
  }

  for (const k of kousky(xml)) {
    if (!k.znacka) {
      if (vHodnote) hodnota += odkodovat(k.text)
      continue
    }
    const z = k.text

    if (/^<row[\s/>]/.test(z)) {
      radek = []
      if (z.endsWith('/>')) mrizka.push([])
    } else if (/^<\/row>/.test(z)) {
      uloz()
      mrizka.push(radek)
    } else if (/^<c[\s/>]/.test(z)) {
      uloz()
      const r = atribut(z, 'r')
      sloupec = r ? sloupecZAdresy(r) : radek.length
      typ = atribut(z, 't') ?? ''
      hodnota = ''
      if (z.endsWith('/>')) uloz()
    } else if (/^<\/c>/.test(z)) {
      uloz()
    } else if (/^<(v|t)[\s/>]/.test(z)) {
      vHodnote = !z.endsWith('/>')
    } else if (/^<\/(v|t)>/.test(z)) {
      vHodnote = false
    } else if (/^<f[\s/>]/.test(z)) {
      // Vzorec se nečte ani nevyhodnocuje. Bere se jen spočítaná hodnota.
      vHodnote = false
    }
  }
  return mrizka
}

/**
 * Který list je první.
 *
 * Ne „vezmi sheet1.xml“: pořadí souborů v archivu nemusí odpovídat
 * pořadí záložek. Jde se přes workbook.xml a jeho vazby.
 */
function cestaPrvnihoListu(workbook: string, rels: string): string | null {
  let id: string | null = null
  for (const k of kousky(workbook)) {
    if (k.znacka && /^<sheet[\s/>]/.test(k.text)) {
      id = atribut(k.text, 'r:id') ?? atribut(k.text, 'id')
      break
    }
  }
  if (!id) return null
  for (const k of kousky(rels)) {
    if (k.znacka && /^<Relationship[\s/>]/.test(k.text) && atribut(k.text, 'Id') === id) {
      const cil = atribut(k.text, 'Target')
      if (!cil) return null
      return cil.startsWith('/') ? cil.slice(1) : `xl/${cil.replace(/^\.\//, '')}`
    }
  }
  return null
}

/**
 * Přečte sešit .xlsx a vrátí první list jako mřížku buněk.
 *
 * Záhlaví a doplnění řádků dělá až zTabulky v lib/tabulka.ts — je to
 * stejná práce pro CSV i pro sešit a nemá smysl ji mít dvakrát. Tenhle
 * soubor kvůli tomu na nic nezávisí a dá se pustit i mimo prohlížeč.
 */
export async function precistXlsx(bajty: Uint8Array): Promise<string[][]> {
  const zip = ctiZip(bajty)

  const vezmi = async (nazev: string): Promise<string> => {
    const pol = zip.get(nazev)
    return pol ? rozbal(bajty, pol) : ''
  }

  const workbook = await vezmi('xl/workbook.xml')
  const rels = await vezmi('xl/_rels/workbook.xml.rels')
  const cesta = cestaPrvnihoListu(workbook, rels) ?? 'xl/worksheets/sheet1.xml'

  const listXml = await vezmi(cesta)
  if (!listXml) throw new SouborNecitelny('V sešitu není žádný list.')

  const sdilene = ctiSdileneTexty(await vezmi('xl/sharedStrings.xml'))
  return ctiList(listXml, sdilene)
}
