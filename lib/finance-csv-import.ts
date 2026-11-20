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
 * znaménko částky), Protistrana, Protiúčet (volitelný, s kódem banky
 * buď v buňce, nebo ve sloupci Kód banky), VS, Poznámka, Externí ID
 * (volitelný — bez něj dvojí import téhož řádku pozná databáze podle
 * otisku pohybu, migrace 20261119100000).
 *
 * Částka snese mezeru nebo tečku jako oddělovač tisíců a čárku jako
 * desetinnou (`1 234,50`, `1.234,50`); tečka s jednou či dvěma
 * číslicemi za ní je desetinná (`-1234.5`). Co nejde přečíst jednoznačně
 * (`1,234.50`, tři desetinná místa), je chyba řádku — nic se nedomýšlí.
 *
 * Nativní exporty konkrétních bank appka nezná a nehádá: kdo má jiný
 * tvar, přejmenuje sloupce podle téhle šablony.
 */

import type { PohybBanky, SmerPohybu } from './banka/konektor.ts'
import { normalizovatUcet } from './banka/ucet.ts'

export type { SmerPohybu } from './banka/konektor.ts'

/** Řádek importu = společný pohyb banky (lib/banka/konektor.ts). */
export type RadekImportu = PohybBanky

/** Největší částka, kterou sloupec `castka_haleru` (integer) pojme. */
const MAX_HALERU = 2_147_483_647

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
  protistrana: ['protistrana', 'nazev', 'nazevprotiuctu', 'partner', 'popis', 'description'],
  // Číslo účtu patří do vlastního sloupce, ne do jména protistrany
  // (otisk pohybu i párování ho čtou zvlášť).
  protiucet: ['protiucet', 'cisloprotiuctu', 'ucetprotistrany', 'iban'],
  kod_banky: ['kodbanky', 'kodbankyprotiuctu', 'bankcode'],
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

/** Celá část s volitelným oddělovačem tisíců: `1234`, `1 234` (mezery už pryč), `1.234.567`. */
function celaCast(text: string, oddelovacTisicu: string | null): string | null {
  if (/^\d+$/.test(text)) return text
  if (!oddelovacTisicu) return null
  const skupiny = text.split(oddelovacTisicu)
  if (!/^\d{1,3}$/.test(skupiny[0]) || !skupiny.slice(1).every((s) => /^\d{3}$/.test(s))) return null
  return skupiny.join('')
}

/**
 * `'1 234,50'`, `'1.234,50'`, `'-1234.5'`, `'1.234'`, `'1234'` → haléře
 * (celé číslo), se znaménkem. Mezera (i pevná) a tečka oddělují tisíce,
 * čárka je desetinná; tečka je desetinná jen s jednou či dvěma číslicemi
 * za sebou a bez čárky. Null, když to není číslo nebo to jde přečíst
 * dvojím způsobem — nikdy netiše nezaokrouhlí na nejbližší smysl.
 */
export function naHalereSeZnamenkem(text: string): number | null {
  let t = text.replace(/[\s  ]/g, '')
  const zaporne = t.startsWith('-')
  if (zaporne || t.startsWith('+')) t = t.slice(1)
  if (!t) return null

  let cela: string | null
  let des = ''
  const carka = t.lastIndexOf(',')
  if (carka !== -1) {
    // Čárka je desetinná — jen jedna, za ní nejvýš dvě číslice, před ní
    // tisíce jen s tečkou (`1,234.50` je anglický zápis, ten se nehádá).
    if (t.indexOf(',') !== carka) return null
    des = t.slice(carka + 1)
    if (!/^\d{1,2}$/.test(des)) return null
    cela = celaCast(t.slice(0, carka), '.')
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    const [c, d] = t.split('.')
    cela = c
    des = d
  } else {
    cela = celaCast(t, '.')
  }
  if (cela === null) return null

  const haleru = Number(cela) * 100 + Number(des.padEnd(2, '0'))
  if (!Number.isSafeInteger(haleru)) return null
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
    protiucet: indexSloupce('protiucet'),
    kodBanky: indexSloupce('kod_banky'),
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
  // Dvě stejná id v jednom souboru by shodila zápis celého souboru na
  // unikátním indexu — druhé se ohlásí jako chyba řádku.
  const videnaId = new Set<string>()

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
    if (Math.abs(castkaSeZnamenkem) > MAX_HALERU) { chyby.push({ radek: cislo, zprava: `Částka „${castkaText}" je větší, než appka umí uložit.` }); continue }

    const externiId = idx.externiId !== -1 && bunky[idx.externiId] ? bunky[idx.externiId] : null
    if (externiId !== null) {
      if (videnaId.has(externiId)) { chyby.push({ radek: cislo, zprava: `Externí ID „${externiId}" je v souboru podruhé.` }); continue }
      videnaId.add(externiId)
    }

    // Protiúčet: buď celý v jedné buňce (`19-2000145399/0800`, IBAN), nebo
    // číslo a kód banky ve dvou sloupcích.
    const ucetText = idx.protiucet !== -1 ? (bunky[idx.protiucet] ?? '') : ''
    const kodText = idx.kodBanky !== -1 ? (bunky[idx.kodBanky] ?? '').trim() : ''
    const protiucet = normalizovatUcet(ucetText && kodText && !ucetText.includes('/') ? `${ucetText}/${kodText}` : ucetText)

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
      protiucet,
      vs: idx.vs !== -1 ? (bunky[idx.vs] ?? '') : '',
      poznamka: idx.poznamka !== -1 ? (bunky[idx.poznamka] ?? '') : '',
      externiId,
    })
  }

  return { radky, chyby }
}
