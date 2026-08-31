#!/usr/bin/env node
/**
 * Kontrola čtení sešitu .xlsx — lib/xlsx.ts.
 *
 * Pusť `node --experimental-strip-types scripts/xlsx.test.mjs`.
 *
 * Sešit se tady doopravdy poskládá — ZIP i XML — a pak přečte. Testuje
 * se to, co se u cizích souborů rozbije:
 *
 *   * první záložka není sheet1.xml (pořadí souborů v archivu neplatí),
 *   * sdílený text složený z několika běhů a s entitami,
 *   * vynechané buňky uprostřed řádku (`r="C2"` po `r="A2"`),
 *   * buňka se vzorcem — bere se spočítaná hodnota, vzorec se nečte,
 *   * obě komprese, kterou tabulkové editory používají: 0 i deflate.
 */

import { deflateRawSync, crc32 } from 'node:zlib'
import {
  precistXlsx,
  ctiSdileneTexty,
  ctiStyly,
  datumZCisla,
  formatJeDatum,
  sloupecZAdresy,
} from '../lib/xlsx.ts'
import { zTabulky } from '../lib/tabulka.ts'

/* --- malý zapisovač ZIPu, jen pro tenhle test ---------------------- */

function zip(soubory) {
  const casti = []
  const adresar = []
  let offset = 0

  for (const { nazev, obsah, deflate } of soubory) {
    const data = Buffer.from(obsah, 'utf8')
    const telo = deflate ? deflateRawSync(data) : data
    const metoda = deflate ? 8 : 0
    const jmeno = Buffer.from(nazev, 'utf8')
    const kontrola = crc32(data)

    const hlavicka = Buffer.alloc(30)
    hlavicka.writeUInt32LE(0x04034b50, 0)
    hlavicka.writeUInt16LE(20, 4)
    hlavicka.writeUInt16LE(metoda, 8)
    hlavicka.writeUInt32LE(kontrola, 14)
    hlavicka.writeUInt32LE(telo.length, 18)
    hlavicka.writeUInt32LE(data.length, 22)
    hlavicka.writeUInt16LE(jmeno.length, 26)
    casti.push(hlavicka, jmeno, telo)

    const zaznam = Buffer.alloc(46)
    zaznam.writeUInt32LE(0x02014b50, 0)
    zaznam.writeUInt16LE(20, 4)
    zaznam.writeUInt16LE(20, 6)
    zaznam.writeUInt16LE(metoda, 10)
    zaznam.writeUInt32LE(kontrola, 16)
    zaznam.writeUInt32LE(telo.length, 20)
    zaznam.writeUInt32LE(data.length, 24)
    zaznam.writeUInt16LE(jmeno.length, 28)
    zaznam.writeUInt32LE(offset, 42)
    adresar.push(zaznam, jmeno)

    offset += hlavicka.length + jmeno.length + telo.length
  }

  const telo = Buffer.concat(casti)
  const rejstrik = Buffer.concat(adresar)
  const konec = Buffer.alloc(22)
  konec.writeUInt32LE(0x06054b50, 0)
  konec.writeUInt16LE(soubory.length, 8)
  konec.writeUInt16LE(soubory.length, 10)
  konec.writeUInt32LE(rejstrik.length, 12)
  konec.writeUInt32LE(telo.length, 16)
  return new Uint8Array(Buffer.concat([telo, rejstrik, konec]))
}

/* --- sešit --------------------------------------------------------- */

const SDILENE = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7">
  <si><t>Jméno</t></si>
  <si><t>Pobočka</t></si>
  <si><t>Pozice</t></si>
  <si><r><t>Novák</t></r><r><t xml:space="preserve"> &amp; syn</t></r></si>
  <si><t>Černá Perla</t><rPh sb="0" eb="1"><t>NEPATŘÍ SEM</t></rPh></si>
  <si><t>Číšník</t></si>
  <si><t>Kuchař &lt;vedoucí&gt;</t></si>
</sst>`

// Data jsou v sheet2.xml a v pořadí záložek jsou první. Kdo vezme
// sheet1.xml, přečte návnadu.
const LIST = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Nástup</t></is></c><c r="E1" t="inlineStr"><is><t>Odměna</t></is></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Eva Dvořáková</t></is></c><c r="C3" t="s"><v>6</v></c></row>
    <row r="4"><c r="A4" t="str"><f>CONCATENATE("Jan"," Rychlý")</f><v>Jan Rychlý</v></c><c r="B4" t="s"><v>4</v></c><c r="C4"><v>42</v></c><c r="D4" s="1"><v>46266</v></c><c r="E4" s="2"><v>46266</v></c></row>
  </sheetData>
</worksheet>`

const NAVNADA = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>NÁVNADA</t></is></c></row></sheetData>
</worksheet>`

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Lidé" sheetId="2" r:id="rId7"/>
    <sheet name="Poznámky" sheetId="1" r:id="rId8"/>
  </sheets>
</workbook>`

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId8" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId7" Type="http://x/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`

const STYLY = `<?xml version="1.0"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="166" formatCode="d/m/yyyy;@"/></numFmts>
  <cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" xfId="0"/>
    <xf numFmtId="166" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="4" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`

const sesit = (deflate) =>
  zip([
    { nazev: 'xl/workbook.xml', obsah: WORKBOOK, deflate },
    { nazev: 'xl/_rels/workbook.xml.rels', obsah: RELS, deflate },
    { nazev: 'xl/sharedStrings.xml', obsah: SDILENE, deflate },
    { nazev: 'xl/styles.xml', obsah: STYLY, deflate },
    { nazev: 'xl/worksheets/sheet1.xml', obsah: NAVNADA, deflate },
    { nazev: 'xl/worksheets/sheet2.xml', obsah: LIST, deflate },
  ])

/* --- kontroly ------------------------------------------------------ */

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

console.log('== Adresa sloupce ==')
ma('A', sloupecZAdresy('A1'), 0)
ma('Z', sloupecZAdresy('Z9'), 25)
ma('AA', sloupecZAdresy('AA1'), 26)
ma('BC', sloupecZAdresy('BC12'), 54)

console.log('\n== Sdílené texty ==')
const sd = ctiSdileneTexty(SDILENE)
ma('počet', sd.length, 7)
ma('text složený z běhů', sd[3], 'Novák & syn')
ma('fonetický přepis se nepřilepí', sd[4], 'Černá Perla')
ma('entity', sd[6], 'Kuchař <vedoucí>')

for (const deflate of [false, true]) {
  console.log(`\n== Sešit (${deflate ? 'deflate' : 'bez komprese'}) ==`)
  const t = zTabulky(await precistXlsx(sesit(deflate)))
  ma('hlavička', t.hlavicka, ['Jméno', 'Pobočka', 'Pozice', 'Nástup', 'Odměna'])
  ma('čte se první záložka, ne sheet1.xml', t.radky[0].slice(0, 3), ['Novák & syn', 'Černá Perla', 'Číšník'])
  ma('vynechaná buňka zůstane prázdná', t.radky[1].slice(0, 3), ['Eva Dvořáková', '', 'Kuchař <vedoucí>'])
  ma('vzorec: bere se spočítaná hodnota', t.radky[2].slice(0, 3), ['Jan Rychlý', 'Černá Perla', '42'])
  ma('datum se převede podle formátu buňky', t.radky[2][3], '2026-09-01')
  ma('stejné číslo bez datového formátu zůstane číslem', t.radky[2][4], '46266')
  ma('řádků je tolik, kolik jich v listu je', t.radky.length, 3)
}

console.log('\n== Formáty a pořadová čísla ==')
// Datum je v Excelu číslo. Od částky se pozná jedině podle formátu —
// 46266 je platné datum i platná odměna.
ma('vlastní formát d/m/yyyy je datum', ctiStyly(STYLY)[1], true)
ma('formát 4 (číslo se setinami) datum není', ctiStyly(STYLY)[2], false)
ma('obyčejná buňka datum není', ctiStyly(STYLY)[0], false)
ma('d/m/yyyy', formatJeDatum('d/m/yyyy;@'), true)
ma('0.00 "Kč" datum není', formatJeDatum('0.00 "Kč"'), false)
ma('„dnů“ v uvozovkách datum nedělá', formatJeDatum('0 "dnů"'), false)
ma('místní nastavení v závorce nevadí', formatJeDatum('[$-405]d\\.m\\.yyyy'), true)
ma('1 = 1. 1. 1900', datumZCisla(1), '1900-01-01')
ma('59 = 28. 2. 1900 (před neexistujícím 29. únorem)', datumZCisla(59), '1900-02-28')
ma('61 = 1. 3. 1900', datumZCisla(61), '1900-03-01')
ma('46266 = 1. 9. 2026', datumZCisla(46266), '2026-09-01')
ma('sešit z Macu počítá od roku 1904', datumZCisla(44804, true), '2026-09-01')
ma('nesmysl není datum', datumZCisla(Number('x')), null)

console.log('\n== Co není sešit ==')
try {
  await precistXlsx(new Uint8Array([1, 2, 3, 4, 5]))
  chyb++
  console.log('  CHYBA nesmysl prošel jako sešit')
} catch (e) {
  ma('nesmysl se pozná', e.message, 'Není to sešit ani ZIP.')
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
