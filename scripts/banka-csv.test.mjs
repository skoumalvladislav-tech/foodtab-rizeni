#!/usr/bin/env node
/**
 * Import výpisu jako konektor — lib/banka/import-vypisu.ts
 * + lib/finance-csv-import.ts (Finance Fáze 0, krok 1).
 *
 * Pusť `node scripts/banka-csv.test.mjs`.
 *
 * Pokrývá to, co starý test parseru neviděl:
 *   * soubor v kódování windows-1250 (tabulkový procesor na Windows) se
 *     přečte stejně jako UTF-8 — jinak by se otisk pohybu lišil a tentýž
 *     výpis by šel importovat dvakrát;
 *   * oddělovače tisíců a desetinná čárka/tečka; co jde přečíst dvojím
 *     způsobem, je chyba řádku;
 *   * sloupec protiúčtu (i s kódem banky zvlášť) skončí v `protiucet`
 *     v jednom tvaru, ne v protistraně;
 *   * dvě stejná id v jednom souboru = chyba řádku (jinak by zápis
 *     celého souboru spadl na unikátním indexu).
 */

const { dekodovatVypis, naparsovatVypis, KONEKTOR_IMPORT_VYPISU } = await import('../lib/banka/import-vypisu.ts')
const { naHalereSeZnamenkem, naparsovatCsv } = await import('../lib/finance-csv-import.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zkus = (popis, fn) => {
  try { ok(popis, fn()) } catch (e) { ok(`${popis} (výjimka: ${e?.message ?? e})`, false) }
}

// windows-1250 ručně — Node (ani prohlížeč) do něj kódovat neumí, jen číst.
const CP1250 = { 'Č': 0xc8, 'č': 0xe8, 'á': 0xe1, 'í': 0xed, 'é': 0xe9, 'ě': 0xec, 'ř': 0xf8, 'ž': 0x9e, 'š': 0x9a, 'ů': 0xf9, 'ú': 0xfa, 'ý': 0xfd, 'Ú': 0xda, 'Ž': 0x8e, 'Ř': 0xd8, 'Š': 0x8a }
function doCp1250(text) {
  const bajty = []
  for (const c of text) {
    if (c.charCodeAt(0) < 0x80) bajty.push(c.charCodeAt(0))
    else if (CP1250[c] !== undefined) bajty.push(CP1250[c])
    else throw new Error(`znak ${c} v tabulce testu chybí`)
  }
  return new Uint8Array(bajty)
}

const VYPIS = [
  'Datum;Částka;Protistrana;Protiúčet;VS;Poznámka',
  '1.2.2026;1 234,50;Káva s.r.o.;19-2000145399/0800;2026001;Úhrada faktury',
  '2.2.2026;-99,9;Pekařství Žižkov;;;Nákup',
].join('\r\n')

console.log('\n== Kódování: UTF-8 i windows-1250 dají totéž ==')
const zUtf8 = naparsovatVypis(new TextEncoder().encode(VYPIS))
const zCp1250 = naparsovatVypis(doCp1250(VYPIS))
zkus('UTF-8 se pozná jako UTF-8', () => zUtf8.kodovani === 'utf-8')
zkus('windows-1250 se pozná (není platné UTF-8)', () => zCp1250.kodovani === 'windows-1250')
zkus('windows-1250: hlavička s diakritikou se přečte (žádná chyba „Chybí sloupec")', () => zCp1250.chyby.length === 0 && zCp1250.radky.length === 2)
zkus('windows-1250: „Káva s.r.o." bez otazníků', () => zCp1250.radky[0]?.protistrana === 'Káva s.r.o.')
zkus('windows-1250: „Pekařství Žižkov" bez otazníků', () => zCp1250.radky[1]?.protistrana === 'Pekařství Žižkov')
zkus('obě kódování dají přesně stejné řádky (stejný otisk pohybu)', () => JSON.stringify(zUtf8.radky) === JSON.stringify(zCp1250.radky))
zkus('obě kódování dají stejný text souboru (stejný otisk dávky)', () => zUtf8.text === zCp1250.text)
zkus('UTF-8 s BOM: BOM pryč, hlavička se pozná', () => {
  const sBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(VYPIS)])
  const v = naparsovatVypis(sBom)
  return v.kodovani === 'utf-8' && v.chyby.length === 0 && v.radky.length === 2 && v.text.charCodeAt(0) !== 0xfeff
})
zkus('dekodovatVypis: neplatné UTF-8 nespadne a nevrátí „�"', () => {
  const v = dekodovatVypis(new Uint8Array([0x4b, 0xe1, 0x76, 0x61])) // „Káva" v cp1250
  return v.text === 'Káva' && !v.text.includes('�')
})

console.log('\n== Protiúčet do vlastního sloupce, v jednom tvaru ==')
zkus('protiúčet z výpisu → IBAN (stejný tvar jako z API)', () => zUtf8.radky[0]?.protiucet === 'CZ6508000000192000145399')
zkus('číslo účtu se NEpřilepí k protistraně', () => !zUtf8.radky[0]?.protistrana.includes('0800'))
zkus('bez protiúčtu → prázdný text, ne null', () => zUtf8.radky[1]?.protiucet === '')
zkus('kód banky ve zvláštním sloupci se připojí k číslu', () => {
  const v = naparsovatCsv('Datum;Částka;Číslo protiúčtu;Kód banky\n1.1.2026;10;19-2000145399;0800')
  return v.chyby.length === 0 && v.radky[0]?.protiucet === 'CZ6508000000192000145399'
})
zkus('kód banky bez úvodní nuly (výpis uložený v Excelu: 0800 → 800) → týž IBAN', () => {
  const v = naparsovatCsv('Datum;Částka;Číslo protiúčtu;Kód banky\n1.1.2026;10;19-2000145399;800')
  return v.chyby.length === 0 && v.radky[0]?.protiucet === 'CZ6508000000192000145399'
})
zkus('sloupec IBAN se pozná jako protiúčet', () => {
  const v = naparsovatCsv('Datum;Částka;IBAN\n1.1.2026;10;CZ65 0800 0000 1920 0014 5399')
  return v.radky[0]?.protiucet === 'CZ6508000000192000145399'
})

console.log('\n== Částky: oddělovače ==')
const CASTKY = [
  ['1234', 123400], ['1 234', 123400], ['1 234,50', 123450], ['1 234,50', 123450],
  ['1.234,50', 123450], ['1.234.567,89', 123456789], ['-1234.5', -123450], ['1234.56', 123456],
  ['+12,5', 1250], ['1.234', 123400], ['-0,01', -1],
]
for (const [text, haleru] of CASTKY) zkus(`„${text}" → ${haleru}`, () => naHalereSeZnamenkem(text) === haleru)
const NEJEDNOZNACNE = ['1,234.50', '12,345', '1.23.4', '1,2,3', 'abc', '', '-', '1.2345']
for (const text of NEJEDNOZNACNE) zkus(`„${text}" → null (nehádá se)`, () => naHalereSeZnamenkem(text) === null)
zkus('nejednoznačná částka = chyba řádku s číslem řádku, ostatní řádky projdou', () => {
  const v = naparsovatCsv('Datum;Částka\n1.1.2026;1,234.50\n2.1.2026;100')
  return v.chyby.length === 1 && v.chyby[0].radek === 2 && v.radky.length === 1
})

console.log('\n== Oddělovač sloupců ==')
zkus('čárka jako oddělovač, částka v uvozovkách s desetinnou čárkou', () => {
  const v = naparsovatCsv('Datum,Částka,Protistrana\n1.1.2026,"1 234,50","Firma, s.r.o."')
  return v.chyby.length === 0 && v.radky[0]?.castkaHaleru === 123450 && v.radky[0]?.protistrana === 'Firma, s.r.o.'
})
zkus('středník jako oddělovač', () => naparsovatCsv('Datum;Částka\n1.1.2026;5').radky[0]?.castkaHaleru === 500)

console.log('\n== Dvě stejná id v jednom souboru ==')
zkus('druhé stejné id = chyba řádku, první projde', () => {
  const v = naparsovatCsv('Datum;Částka;Externí ID\n1.1.2026;10;a-1\n2.1.2026;20;a-1\n3.1.2026;30;a-2')
  return v.radky.length === 2 && v.chyby.length === 1 && v.chyby[0].radek === 3
})
zkus('dva stejné řádky BEZ id zůstanou oba (rozliší je pořadí v otisku)', () => {
  const v = naparsovatCsv('Datum;Částka;Protistrana\n1.1.2026;10;Káva\n1.1.2026;10;Káva')
  return v.chyby.length === 0 && v.radky.length === 2
})

console.log('\n== Konektor importu výpisu ==')
zkus('je v nabídce vždy (funguje u každé banky)', () => KONEKTOR_IMPORT_VYPISU.nabizetPripojeni() === true)
zkus('druh „vypis", nic nestahuje ani nesynchronizuje', () =>
  KONEKTOR_IMPORT_VYPISU.druh === 'vypis' && !KONEKTOR_IMPORT_VYPISU.stahnoutPohyby && !KONEKTOR_IMPORT_VYPISU.synchronizovat)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
