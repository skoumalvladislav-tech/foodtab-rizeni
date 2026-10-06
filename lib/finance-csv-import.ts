/**
 * CSV import bankovního/pokladního pohybu — sdílený parser pro oba zdroje
 * (`transakce.zdroj = 'csv_banka'|'csv_pokladna'`).
 *
 * Čistá logika, žádné IO — testovatelná přímo Nodem
 * (scripts/finance-csv-import.test.mjs). Server akce
 * (app/[rozsah]/finance/platby/import/) čte soubor, zavolá tohle a
 * ukáže NÁHLED před uložením — appka žádnou konkrétní banku nepřipojuje
 * (zadání, oddíl 2: „čeká na připojení", nikdy „připojeno" bez reálných
 * přístupů), takže vstup je VLASTNÍ jednoduchá šablona, ne nativní
 * export konkrétní banky, kterou jsme nikdy neviděli.
 *
 * Očekávané sloupce (hlavička, názvy se poznají bez diakritiky/velikosti
 * písma — tolerantní k tomu, jak si je kdo pojmenuje v tabulkovém
 * procesoru): Datum, Částka, Směr (volitelný — bez něj rozhoduje
 * znaménko částky), Protistrana, VS, Poznámka, Externí ID (volitelný —
 * bez něj se řádek nikdy nepozná jako duplicitní re-import).
 */

export type SmerPohybu = 'prijem' | 'vydaj'

export type RadekImportu = {
  datum: string
  smer: SmerPohybu
  castkaHaleru: number
  mena: string
  protistrana: string
  vs: string
  poznamka: string
  externiId: string | null
}

export type ChybaImportu = {
  radek: number
  zprava: string
}

export type VysledekImportu = {
  radky: RadekImportu[]
  chyby: ChybaImportu[]
}

/** Bez diakritiky, malá písmena, bez mezer navíc — na porovnání názvu sloupce, ne na zobrazení. */
export function normalizovatNazev(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
}

const ALIASY: Record<string, string[]> = {
  datum: ['datum', 'date'],
  castka: ['castka', 'amount', 'suma'],
  smer: ['smer', 'typ', 'direction'],
  protistrana: ['protistrana', 'nazev', 'partner', 'protiucet', 'popis', 'description'],
  vs: ['vs', 'variabilnisymbol', 'variablesymbol'],
  poznamka: ['poznamka', 'note', 'zprava', 'memo'],
  externi_id: ['externiid', 'id', 'cislopohybu', 'transactionid', 'referencnicislo'],
  mena: ['mena', 'currency', 'kodmeny'],
}

/** Jeden řádek CSV na pole buněk — respektuje uvozovky (`"a;b"` je jedna buňka), stejná konvence jako export. */
export function rozdelitRadek(radek: string, oddelovac: string): string[] {
  const bunky: string[] = []
  let aktualni = ''
  let vUvozovkach = false

  for (let i = 0; i < radek.length; i++) {
    const c = radek[i]
    if (vUvozovkach) {
      if (c === '"') {
        if (radek[i + 1] === '"') { aktualni += '"'; i++ } else { vUvozovkach = false }
      } else {
        aktualni += c
      }
      continue
    }
    if (c === '"') { vUvozovkach = true; continue }
    if (c === oddelovac) { bunky.push(aktualni); aktualni = ''; continue }
    aktualni += c
  }
  bunky.push(aktualni)
  return bunky.map((b) => b.trim())
}

/** `;` i v hlavičce, i v datovém řádku — jinak rozhoduje, co se v souboru vyskytuje víc. */
export function odhadnoutOddelovac(prvniRadek: string): string {
  const stredniky = prvniRadek.split(';').length
  const carky = prvniRadek.split(',').length
  return stredniky >= carky ? ';' : ','
}

/** `'15.3.2026'`, `'15/3/2026'` i `'2026-03-15'` → `'2026-03-15'`. Null, když to nejde rozpoznat. */
export function naDatum(text: string): string | null {
  const t = text.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`

  const cesky = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t)
  if (cesky) return `${cesky[3]}-${cesky[2].padStart(2, '0')}-${cesky[1].padStart(2, '0')}`

  return null
}

/**
 * `'1 234,50'`, `'-1234.5'`, `'1234'` → haléře (celé číslo), se znaménkem.
 * Null, když to není číslo — nikdy netiše nezaokrouhlí na nejbližší smysl.
 */
export function naHalereSeZnamenkem(text: string): number | null {
  const t = text.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null
  const zaporne = t.startsWith('-')
  const bez = zaporne ? t.slice(1) : t
  const [cela, des = ''] = bez.split('.')
  const haleru = Number(cela) * 100 + Number(des.padEnd(2, '0'))
  return zaporne ? -haleru : haleru
}

export function naparsovatCsv(obsah: string): VysledekImportu {
  // BOM na začátku (Excel, stejná konvence jako export) se před parsováním odstraní.
  const bezBom = obsah.charCodeAt(0) === 0xfeff ? obsah.slice(1) : obsah
  const radkySouboru = bezBom.split(/\r\n|\n|\r/).filter((r) => r.length > 0)

  if (radkySouboru.length === 0) return { radky: [], chyby: [{ radek: 0, zprava: 'Soubor je prázdný.' }] }

  const oddelovac = odhadnoutOddelovac(radkySouboru[0])
  const hlavicka = rozdelitRadek(radkySouboru[0], oddelovac).map(normalizovatNazev)

  const indexSloupce = (klic: string): number => {
    const aliasy = ALIASY[klic]
    for (let i = 0; i < hlavicka.length; i++) {
      if (aliasy.includes(hlavicka[i])) return i
    }
    return -1
  }

  const idx = {
    datum: indexSloupce('datum'),
    castka: indexSloupce('castka'),
    smer: indexSloupce('smer'),
    protistrana: indexSloupce('protistrana'),
    vs: indexSloupce('vs'),
    poznamka: indexSloupce('poznamka'),
    externiId: indexSloupce('externi_id'),
    mena: indexSloupce('mena'),
  }

  const chyby: ChybaImportu[] = []
  if (idx.datum === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Datum".' })
  if (idx.castka === -1) chyby.push({ radek: 1, zprava: 'Chybí sloupec „Částka".' })
  if (chyby.length > 0) return { radky: [], chyby }

  const radky: RadekImportu[] = []

  for (let i = 1; i < radkySouboru.length; i++) {
    const cislo = i + 1
    const bunky = rozdelitRadek(radkySouboru[i], oddelovac)
    if (bunky.every((b) => b === '')) continue

    const datumText = bunky[idx.datum] ?? ''
    const castkaText = bunky[idx.castka] ?? ''

    const datum = naDatum(datumText)
    if (!datum) { chyby.push({ radek: cislo, zprava: `Nerozpoznané datum „${datumText}".` }); continue }

    const castkaSeZnamenkem = naHalereSeZnamenkem(castkaText)
    if (castkaSeZnamenkem === null) { chyby.push({ radek: cislo, zprava: `Nerozpoznaná částka „${castkaText}".` }); continue }
    if (castkaSeZnamenkem === 0) { chyby.push({ radek: cislo, zprava: 'Nulová částka.' }); continue }

    const smerText = idx.smer !== -1 ? normalizovatNazev(bunky[idx.smer] ?? '') : ''
    let smer: SmerPohybu
    if (smerText === 'prijem' || smerText === 'credit' || smerText === 'in') smer = 'prijem'
    else if (smerText === 'vydaj' || smerText === 'debit' || smerText === 'out') smer = 'vydaj'
    else smer = castkaSeZnamenkem < 0 ? 'vydaj' : 'prijem'

    // Appka vlastní šablonu nemá povinný sloupec Měna — domácí CZK
    // export ho nepotřebuje. Bez sloupce appka CZK NEDOMÝŠLÍ naslepo
    // pro každý možný účet, ale je to jediný rozumný výchozí stav pro
    // appčinu VLASTNÍ šablonu (ne nativní export konkrétní banky).
    const menaText = idx.mena !== -1 ? (bunky[idx.mena] ?? '').trim().toUpperCase() : ''

    radky.push({
      datum,
      smer,
      castkaHaleru: Math.abs(castkaSeZnamenkem),
      mena: menaText || 'CZK',
      protistrana: idx.protistrana !== -1 ? (bunky[idx.protistrana] ?? '') : '',
      vs: idx.vs !== -1 ? (bunky[idx.vs] ?? '') : '',
      poznamka: idx.poznamka !== -1 ? (bunky[idx.poznamka] ?? '') : '',
      externiId: idx.externiId !== -1 && bunky[idx.externiId] ? bunky[idx.externiId] : null,
    })
  }

  return { radky, chyby }
}
