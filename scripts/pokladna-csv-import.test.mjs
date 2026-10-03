#!/usr/bin/env node
/**
 * CSV import denních pokladních prodejů — lib/pokladna-csv-import.ts.
 *
 * Pusť `node --experimental-strip-types scripts/pokladna-csv-import.test.mjs`.
 */

const { naparsovatCsvPokladny } = await import('../lib/pokladna-csv-import.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Šťastná cesta: středník, čeština ==')

const CSV_ZAKLAD = [
  'Datum;Produkt;Množství;Tržba',
  '15.3.2026;Guláš;12;1740',
  '15.3.2026;Svíčková;8,5;1912,50',
].join('\r\n')

const v1 = naparsovatCsvPokladny(CSV_ZAKLAD)
ok('žádné chyby', v1.chyby.length === 0)
ok('dva řádky dat', v1.radky.length === 2)
ok('datum se převedlo na ISO', v1.radky[0].datum === '2026-03-15')
ok('produkt se přečetl', v1.radky[0].produktNazev === 'Guláš')
ok('celočíselné množství', v1.radky[0].mnozstvi === 12)
ok('desetinné množství (čárka)', v1.radky[1].mnozstvi === 8.5)
ok('tržba 1740 → 174000 haléřů', v1.radky[0].trzbaHaleru === 174000)
ok('tržba s desetinnou čárkou 1912,50 → 191250 haléřů', v1.radky[1].trzbaHaleru === 191250)

console.log('\n== BOM na začátku souboru se odstraní ==')

const sBomem = '﻿' + CSV_ZAKLAD
ok('BOM nerozbije parsování hlavičky', naparsovatCsvPokladny(sBomem).chyby.length === 0)
ok('a data se přečtou stejně', naparsovatCsvPokladny(sBomem).radky.length === 2)

console.log('\n== Rozpoznávání sloupců bez diakritiky a velikosti písma ==')

const JINE_NAZVY = [
  'DATE;PRODUCT;QTY;AMOUNT',
  '1.1.2026;Pizza;3;450',
].join('\n')
const v2 = naparsovatCsvPokladny(JINE_NAZVY)
ok('anglické názvy sloupců se rozpoznají', v2.chyby.length === 0 && v2.radky.length === 1)

console.log('\n== Chybějící povinné sloupce ==')

ok('chybí Produkt → chyba, žádné řádky', naparsovatCsvPokladny('Datum;Množství;Tržba\n1.1.2026;1;100').radky.length === 0)
ok('prázdný soubor → chyba', naparsovatCsvPokladny('').chyby.length > 0)

console.log('\n== Jeden rozbitý řádek nezastaví zbytek ==')

const SMICHANE = [
  'Datum;Produkt;Množství;Tržba',
  '1.1.2026;Guláš;abc;100',
  '2.1.2026;Svíčková;5;200',
].join('\n')
const v3 = naparsovatCsvPokladny(SMICHANE)
ok('jeden platný řádek prošel', v3.radky.length === 1)
ok('jedna chyba se zaznamenala s číslem řádku', v3.chyby.length === 1 && v3.chyby[0].radek === 2)

console.log('\n== Záporné množství/tržba se odmítnou (prodej nikdy není záporný) ==')

ok('záporné množství je chyba, ne tichá hodnota', naparsovatCsvPokladny('Datum;Produkt;Množství;Tržba\n1.1.2026;X;-1;100').radky.length === 0)
ok('záporná tržba je chyba', naparsovatCsvPokladny('Datum;Produkt;Množství;Tržba\n1.1.2026;X;1;-100').radky.length === 0)

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `SELHALO: ${chyb} kontrol`}`)
if (chyb > 0) process.exit(1)
