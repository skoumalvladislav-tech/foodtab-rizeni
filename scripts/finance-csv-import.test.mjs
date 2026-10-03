#!/usr/bin/env node
/**
 * CSV import bankovního/pokladního pohybu — lib/finance-csv-import.ts.
 *
 * Pusť `node --experimental-strip-types scripts/finance-csv-import.test.mjs`.
 *
 * Nejdůležitější tu není šťastná cesta — je to, že špatný řádek NEZASTAVÍ
 * celý import (jeden rozbitý řádek z tisíce by jinak zahodil celý
 * soubor) a že se chyba hlásí s číslem řádku, ne tiše nevynechá.
 */

const { naparsovatCsv } = await import('../lib/finance-csv-import.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Šťastná cesta: středník, čeština, znaménko částky ==')

const CSV_ZAKLAD = [
  'Datum;Částka;Protistrana;VS;Poznámka;Externí ID',
  '15.3.2026;1234,50;ABC s.r.o.;20260001;Platba za zboží;tx-001',
  '16.3.2026;-500;Nájem s.r.o.;;Nájem;tx-002',
].join('\r\n')

const vysledek1 = naparsovatCsv(CSV_ZAKLAD)
ok('žádné chyby', vysledek1.chyby.length === 0)
ok('dva řádky dat', vysledek1.radky.length === 2)
ok('datum se převedlo na ISO', vysledek1.radky[0].datum === '2026-03-15')
ok('částka 1234,50 → 123450 haléřů', vysledek1.radky[0].castkaHaleru === 123450)
ok('kladná částka bez sloupce Směr je příjem', vysledek1.radky[0].smer === 'prijem')
ok('záporná částka bez sloupce Směr je výdaj', vysledek1.radky[1].smer === 'vydaj')
ok('záporná částka se uloží jako KLADNÉ haléře (znaménko jen určuje směr)', vysledek1.radky[1].castkaHaleru === 50000)
ok('protistrana se přečetla', vysledek1.radky[0].protistrana === 'ABC s.r.o.')
ok('VS se přečetl', vysledek1.radky[0].vs === '20260001')
ok('externí id se přečetlo', vysledek1.radky[0].externiId === 'tx-001')
ok('chybějící VS je prázdný řetězec, ne null', vysledek1.radky[1].vs === '')

console.log('\n== BOM na začátku souboru se odstraní ==')

const sBomem = '﻿' + CSV_ZAKLAD
ok('BOM nerozbije parsování hlavičky', naparsovatCsv(sBomem).chyby.length === 0)
ok('a data se přečtou stejně', naparsovatCsv(sBomem).radky.length === 2)

console.log('\n== Sloupec Směr, když je přítomný, vyhrává nad znaménkem ==')

const vysledekSmer = naparsovatCsv([
  'Datum;Částka;Směr',
  '1.1.2026;100;prijem',
  '2.1.2026;-100;vydaj',
].join('\n'))
ok('explicitní "prijem" i s kladnou částkou', vysledekSmer.radky[0].smer === 'prijem')
ok('explicitní "vydaj" i se zápornou částkou', vysledekSmer.radky[1].smer === 'vydaj')

console.log('\n== Rozpoznávání sloupců bez diakritiky a velikosti písma ==')

const JINE_NAZVY = [
  'DATE;AMOUNT;DESCRIPTION',
  '2026-01-15;99.99;Test dodavatel',
].join('\n')
const vysledekAnglicky = naparsovatCsv(JINE_NAZVY)
ok('anglické názvy sloupců se rozpoznají', vysledekAnglicky.chyby.length === 0)
ok('a protistrana (description) se přečetla', vysledekAnglicky.radky[0]?.protistrana === 'Test dodavatel')

console.log('\n== Oddělovač čárkou, když v souboru nejsou středníky ==')

const CSV_CARKOU = [
  'Datum,Částka,Protistrana',
  '2026-02-01,500,Test',
].join('\n')
const vysledekCarkou = naparsovatCsv(CSV_CARKOU)
ok('čárka se rozpozná jako oddělovač', vysledekCarkou.chyby.length === 0)
ok('a hodnota se přečte celá, ne rozdělená na dvě buňky', vysledekCarkou.radky[0]?.castkaHaleru === 50000)

console.log('\n== Chybějící povinné sloupce ==')

const BEZ_DATA = ['Protistrana;VS', 'ABC;123'].join('\n')
const vysledekBezData = naparsovatCsv(BEZ_DATA)
ok('chybějící Datum i Částka se ohlásí obě', vysledekBezData.chyby.length === 2)
ok('a nevrátí se žádný řádek', vysledekBezData.radky.length === 0)

console.log('\n== Jeden špatný řádek nezastaví zbytek importu ==')

const S_CHYBOU_UPROSTRED = [
  'Datum;Částka',
  '1.1.2026;100',
  'tohle-neni-datum;100',
  '3.1.2026;neni-cislo',
  '4.1.2026;200',
].join('\n')
const vysledekSChybou = naparsovatCsv(S_CHYBOU_UPROSTRED)
ok('dva platné řádky se zpracovaly i přes dva vadné mezi nimi', vysledekSChybou.radky.length === 2)
ok('obě chyby se ohlásily', vysledekSChybou.chyby.length === 2)
ok('chyba nese správné číslo řádku (3. řádek souboru)', vysledekSChybou.chyby[0].radek === 3)
ok('druhá chyba taky (4. řádek souboru)', vysledekSChybou.chyby[1].radek === 4)
ok('platné řádky navazují bez mezery (1.1. a 4.1., ne duplicitně)',
  vysledekSChybou.radky[0].datum === '2026-01-01' && vysledekSChybou.radky[1].datum === '2026-01-04')

console.log('\n== Nulová částka se odmítne, ne tiše proklouzne jako pohyb ==')

const NULOVA = ['Datum;Částka', '1.1.2026;0'].join('\n')
const vysledekNulova = naparsovatCsv(NULOVA)
ok('nulová částka je chyba, ne zapsaný řádek', vysledekNulova.radky.length === 0 && vysledekNulova.chyby.length === 1)

console.log('\n== Prázdné řádky v souboru se přeskočí beze stopy ==')

const S_PRAZDNYMI = ['Datum;Částka', '1.1.2026;100', '', '2.1.2026;200', ''].join('\n')
const vysledekPrazdne = naparsovatCsv(S_PRAZDNYMI)
ok('prázdné řádky se nepočítají jako chyba ani jako data', vysledekPrazdne.radky.length === 2 && vysledekPrazdne.chyby.length === 0)

console.log('\n== Uvozovky s oddělovačem uvnitř buňky (citlivé na banky s čárkou v názvu) ==')

const S_UVOZOVKAMI = [
  'Datum;Částka;Protistrana',
  '1.1.2026;100;"Firma, s.r.o.; pobočka Praha"',
].join('\n')
const vysledekUvozovky = naparsovatCsv(S_UVOZOVKAMI)
ok('středník uvnitř uvozovek nerozdělí buňku', vysledekUvozovky.radky[0]?.protistrana === 'Firma, s.r.o.; pobočka Praha')

console.log('\n== Prázdný soubor ==')

ok('prázdný soubor dá jasnou chybu, ne pád', naparsovatCsv('').chyby.length === 1)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
