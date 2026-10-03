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

const { sestavitRadkyExportu, vygenerovatCsvExportu } = await import('../lib/ucetni-export.ts')

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
