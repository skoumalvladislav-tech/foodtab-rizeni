#!/usr/bin/env node
/**
 * Export měsíčního rozpisu do Excelu a PDF
 * (lib/rozpis-export.ts, lib/xlsx-zapis.ts, lib/pdf-zapis.ts).
 *
 * Pusť `node --experimental-strip-types scripts/rozpis-export.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 *   1. model: týdny přes hranici měsíce, směna přes půlnoc, trhaná
 *      směna, neobsazené směny mimo součty lidí, zrušené se nevyváží,
 *      nevydané mají hvězdičku,
 *   2. sešit se dá PŘEČÍST zpátky týmž čtecím kódem, který appka používá
 *      pro import (lib/xlsx.ts) — export, který si vlastní čtečka
 *      nepřečte, by se do Excelu nemusel dostat taky,
 *   3. XML uvnitř sešitu je správně uzavřené a ZIP má platné kontrolní
 *      součty,
 *   4. PDF má správnou stavbu (hlavička, xref ukazuje na objekty, počet
 *      stránek) a čeština se kóduje přes doplňkové kódy.
 *
 * Vzorová data jsou vymyšlená; nic z nich není zapsané v logice.
 */

import {
  dnyMesice,
  hodinyCislem,
  jeMesic,
  listyXlsx,
  nazevMesice,
  nazevSouboru,
  sestavitExportMesice,
  textSmeny,
} from '../lib/rozpis-export.ts'
import { pdfZExportu } from '../lib/rozpis-export-pdf.ts'
import { sirkaTextu, sirkaZnaku, StrankaPdf, zapsatPdf, zkratitText } from '../lib/pdf-zapis.ts'
import { crc32, sloupecNaPismeno, zapsatXlsx } from '../lib/xlsx-zapis.ts'
import { precistXlsx } from '../lib/xlsx.ts'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

let n = 0
const smena = (den, kdo, od, doKdy, prepis = {}) => {
  n += 1
  return {
    id: `s${n}`,
    branch_id: 'b1',
    employee_id: kdo,
    position_id: null,
    shift_date: den,
    starts_at: `${od}:00`,
    ends_at: `${doKdy}:00`,
    status: 'planned',
    note: '',
    published_at: '2026-09-17T18:00:00Z',
    published_employee_id: kdo,
    published_starts_at: `${od}:00`,
    published_ends_at: `${doKdy}:00`,
    published_status: 'planned',
    pauza_od: null,
    pauza_do: null,
    ...prepis,
  }
}
const koncept = (den, kdo, od, doKdy, prepis = {}) =>
  smena(den, kdo, od, doKdy, {
    published_at: null, published_employee_id: null, published_starts_at: null, published_ends_at: null, published_status: null,
    ...prepis,
  })

const osoby = new Map([
  ['a', { id: 'a', jmeno: 'Andrea Mikulová', usekId: 'u-k', poziceId: 'p-1', barva: null }],
  ['k', { id: 'k', jmeno: 'Kateřina Jirásková', usekId: 'u-p', poziceId: 'p-2', barva: null }],
  ['o', { id: 'o', jmeno: 'Oxy', usekId: null, poziceId: null, barva: null }],
])
const useky = new Map([['u-k', 'Kuchyně'], ['u-p', 'Plac']])
const pozice = new Map([['p-1', 'Kuchařka'], ['p-2', 'Servírka']])
const pobocky = new Map([['b1', 'Černá Perla'], ['b2', 'Bernard']])

const smeny = [
  smena('2026-09-01', 'a', '08:00', '16:00'),
  smena('2026-09-02', 'a', '22:00', '06:00'), // přes půlnoc = 8 h
  smena('2026-09-03', 'a', '10:00', '22:00', { pauza_od: '15:00:00', pauza_do: '17:00:00' }), // 12 h − 2 h = 10 h
  koncept('2026-09-04', 'a', '08:00', '16:00'),
  smena('2026-09-04', 'k', '12:00', '20:00'),
  smena('2026-09-04', 'k', '21:00', '23:00'), // druhá směna téhož dne
  smena('2026-09-30', 'a', '08:00', '16:00'), // poslední den měsíce
  smena('2026-10-01', 'a', '08:00', '16:00'), // už říjen — mimo
  smena('2026-08-31', 'a', '08:00', '16:00'), // ještě srpen — mimo
  smena('2026-09-05', 'a', '08:00', '16:00', { status: 'cancelled' }), // zrušená — mimo
  koncept('2026-09-09', null, '10:00', '18:00'), // neobsazená
  smena('2026-09-10', 'o', '08:00', '16:00'),
]

const vstup = (s = smeny) => ({
  mesic: '2026-09', smeny: s, osoby, useky, pozice, pobocky,
  rozsah: 'Restaurace Černá Perla', vytvoreno: '19. 9. 2026 15:30',
})

console.log('\n== Měsíc ==')
je('září má 30 dní', dnyMesice('2026-09').length, 30)
je('únor 2028 (přestupný) má 29 dní', dnyMesice('2028-02').length, 29)
je('první a poslední den', [dnyMesice('2026-09')[0], dnyMesice('2026-09')[29]], ['2026-09-01', '2026-09-30'])
je('název měsíce', nazevMesice('2026-09'), 'září 2026')
je('platný měsíc', [jeMesic('2026-09'), jeMesic('2026-13'), jeMesic('2026-9'), jeMesic(''), jeMesic(null), jeMesic('abc')], [true, false, false, false, false, false])
je('název souboru bez diakritiky', nazevSouboru('Restaurace Černá Perla', '2026-09', 'xlsx'), 'rozpis-smen-2026-09-restaurace-cerna-perla.xlsx')
je('název souboru bez rozsahu', nazevSouboru('', '2026-09', 'pdf'), 'rozpis-smen-2026-09.pdf')

console.log('\n== Model ==')
const m = sestavitExportMesice(vstup())
je('nadpis', m.nadpis, 'Rozpis směn — září 2026')
je('září 2026 pokrývá pět týdnů (31. 8. – 4. 10.)', [m.tydny.length, m.tydny[0][0], m.tydny[4][6]], [5, '2026-08-31', '2026-10-04'])
je('směny mimo měsíc a zrušená se nepočítají (9 z 12)', m.smen, 9)
je('úseky podle pořadí firmy, Bez úseku poslední', m.skupiny.map((g) => g.nazev), ['Kuchyně', 'Plac', 'Bez úseku'])
const andrea = m.skupiny[0].radky[0]
je('Andrea: 8 + 8 + 10 + 8 + 8 = 42 h', andrea.minut, 42 * 60)
je('trhaná směna: pauza v textu a odečtená z hodin', andrea.podleDne.get('2026-09-03'), ['10:00–22:00 (pauza 15:00–17:00)'])
je('směna přes půlnoc = 8 h', andrea.minutPodleDne.get('2026-09-02'), 480)
je('nevydaná směna má hvězdičku', andrea.podleDne.get('2026-09-04'), ['08:00–16:00*'])
const katerina = m.skupiny[1].radky[0]
je('dvě směny téhož dne: dva texty', katerina.podleDne.get('2026-09-04'), ['12:00–20:00', '21:00–23:00'])
je('Kateřina: 8 h + 2 h', katerina.minut, 600)
je('pozice se doplní ze číselníku', [andrea.pozice, katerina.pozice], ['Kuchařka', 'Servírka'])
je('člověk bez úseku a bez pozice', [m.skupiny[2].radky[0].usek, m.skupiny[2].radky[0].pozice], ['Bez úseku', ''])
je('neobsazený řádek existuje, má jednu směnu', [m.neobsazene?.smen, m.neobsazene?.minut], [1, 480])
je('součty dnů jsou jen lidé: 9. 9. (jen neobsazená) = 0', m.poDnech.get('2026-09-09'), 0)
je('součet dne 4. 9.: Andrea 8 + Kateřina 8 + 2 = 18 h', m.poDnech.get('2026-09-04'), 18 * 60)
je('celkem hodin lidí: Andrea 42 + Kateřina 10 + Oxy 8 = 60 h', m.celkemMinut, 60 * 60)
je('nevydaných: 4. 9. Andrea + neobsazená 9. 9.', m.nevydanych, 2)
je('jedna pobočka: bez sloupce Pobočka', m.vicePobocek, false)
je('text směny: obyčejná', textSmeny(smena('2026-09-01', 'a', '08:00', '16:00')), '08:00–16:00')
je('hodiny jako číslo: 510 min = 8,5', hodinyCislem(510), 8.5)
je('hodiny jako číslo: 100 min = 1,67', hodinyCislem(100), 1.67)

const dvePobocky = sestavitExportMesice(vstup([...smeny, smena('2026-09-06', 'a', '08:00', '12:00', { branch_id: 'b2' })]))
je('dvě pobočky: řádek na člověka a pobočku', dvePobocky.skupiny[0].radky.map((r) => r.pobocka), ['Bernard', 'Černá Perla'])
je('dvě pobočky: příznak', dvePobocky.vicePobocek, true)
je('dvě pobočky: souhrn je jeden řádek na člověka (Andrea 42 h + 4 h)',
  dvePobocky.souhrn.filter((r) => r.jmeno === 'Andrea Mikulová').map((r) => [r.minut, r.smen]), [[46 * 60, 6]])
je('dvě pobočky: rozpis hodin po pobočkách v souhrnu',
  dvePobocky.souhrn.find((r) => r.jmeno === 'Andrea Mikulová').pobocky, 'Bernard 4 h · Černá Perla 42 h')
je('jedna pobočka: souhrn bez rozpisu po pobočkách', m.souhrn.every((r) => r.pobocky === ''), true)
je('souhrn: pořadí podle úseků a jmen', m.souhrn.map((r) => r.jmeno), ['Andrea Mikulová', 'Kateřina Jirásková', 'Oxy'])

console.log('\n== ZIP a XML ==')
je('CRC-32 známého vstupu', crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
je('písmena sloupců', [0, 25, 26, 27, 51, 52, 701, 702].map(sloupecNaPismeno), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])

const sesit = zapsatXlsx(listyXlsx(m))
je('začíná podpisem ZIPu', [sesit[0], sesit[1]], [0x50, 0x4b])

/** Rozbalí uložené (nekomprimované) položky ZIPu do Map<název, text>. */
function rozbalit(b) {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const dek = new TextDecoder()
  const vysledek = new Map()
  let konec = b.length - 22
  while (konec >= 0 && d.getUint32(konec, true) !== 0x06054b50) konec--
  const pocet = d.getUint16(konec + 10, true)
  let p = d.getUint32(konec + 16, true)
  for (let i = 0; i < pocet; i++) {
    const crc = d.getUint32(p + 16, true)
    const velikost = d.getUint32(p + 24, true)
    const dJmeno = d.getUint16(p + 28, true)
    const offset = d.getUint32(p + 42, true)
    const nazev = dek.decode(b.subarray(p + 46, p + 46 + dJmeno))
    const zacatek = offset + 30 + d.getUint16(offset + 26, true) + d.getUint16(offset + 28, true)
    const data = b.subarray(zacatek, zacatek + velikost)
    vysledek.set(nazev, { text: dek.decode(data), crcSedi: crc32(data) === crc })
    p += 46 + dJmeno + d.getUint16(p + 30, true) + d.getUint16(p + 32, true)
  }
  return vysledek
}
const soubory = rozbalit(sesit)
je('položky sešitu', [...soubory.keys()].sort(), [
  '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml',
  'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
])
je('každá položka má sedící CRC-32', [...soubory.values()].every((s) => s.crcSedi), true)

/** Jednoduchá kontrola uzavřenosti značek — Node nemá vlastní XML parser. */
function xmlJeUzavrene(text) {
  const zasobnik = []
  const znacka = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
  let m2
  while ((m2 = znacka.exec(text.replace(/<\?xml[^>]*\?>/, '')))) {
    const [, zaviraci, jmeno, , samo] = m2
    if (samo) continue
    if (zaviraci) { if (zasobnik.pop() !== jmeno) return false } else zasobnik.push(jmeno)
  }
  return zasobnik.length === 0
}
je('všechna XML jsou správně uzavřená', [...soubory.entries()].filter(([k]) => k.endsWith('.xml') || k.endsWith('.rels')).every(([, s]) => xmlJeUzavrene(s.text)), true)
je('sdílené řetězce nesou češtinu bez poškození', soubory.get('xl/sharedStrings.xml').text.includes('Kateřina Jirásková'), true)
je('XML se escapuje (znak & v textu)', zapsatXlsx([{ nazev: 'A&B', sloupce: [10], radky: [[{ t: 's', v: 'a < b & c' }]] }]).length > 0, true)
const zAmpersandem = rozbalit(zapsatXlsx([{ nazev: 'A&B', sloupce: [10], radky: [[{ t: 's', v: 'a < b & c' }]] }]))
je('… text v XML je escapovaný', zAmpersandem.get('xl/sharedStrings.xml').text.includes('a &lt; b &amp; c'), true)
je('… název listu je escapovaný', zAmpersandem.get('xl/workbook.xml').text.includes('name="A&amp;B"'), true)

console.log('\n== Sešit přečtený vlastní čtečkou (lib/xlsx.ts) ==')
const radky = await precistXlsx(sesit)
je('titul a podtitul', [radky[0][0], radky[1][0]], ['Rozpis směn — září 2026', 'Restaurace Černá Perla · vytvořeno 19. 9. 2026 15:30'])
const hlavicka = radky[3]
je('hlavička: jména sloupců a dny', hlavicka.slice(0, 5), ['Zaměstnanec', 'Úsek', 'Pozice', 'Út 1', 'St 2'])
je('hlavička: 30 dnů + hodiny na konci', [hlavicka.length, hlavicka[hlavicka.length - 1]], [3 + 30 + 1, 'Hodin'])
const radekAndrea = radky[4]
je('řádek Andrey: jméno, úsek, pozice', radekAndrea.slice(0, 3), ['Andrea Mikulová', 'Kuchyně', 'Kuchařka'])
je('řádek Andrey: 1. 9. = 08:00–16:00', radekAndrea[3], '08:00–16:00')
je('řádek Andrey: trhaná směna 3. 9.', radekAndrea[5], '10:00–22:00 (pauza 15:00–17:00)')
je('řádek Andrey: nevydaná s hvězdičkou 4. 9.', radekAndrea[6], '08:00–16:00*')
je('řádek Andrey: hodiny celkem jako číslo', radekAndrea[radekAndrea.length - 1], '42')
const radekKaterina = radky[5]
je('Kateřina: dvě směny v jedné buňce oddělené zalomením', radekKaterina[6], '12:00–20:00\n21:00–23:00')
const celkem = radky.find((r) => r[0] === 'Celkem hodin (lidé)')
je('řádek „Celkem hodin“: 4. 9. = 18, celkem = 60', [celkem[6], celkem[celkem.length - 1]], ['18', '60'])
je('poznámka o hvězdičce', radky.some((r) => (r[0] ?? '').startsWith('* nevydaná směna')), true)

console.log('\n== PDF ==')
je('šířka: A = 667, a = 556, ě (jako e) = 556, W tučně = 944', [sirkaZnaku('A'), sirkaZnaku('a'), sirkaZnaku('ě'), sirkaZnaku('W', 'tucne')], [667, 556, 556, 944])
je('šířka textu: „Ahoj“ při 10 pt', sirkaTextu('Ahoj', 10), (667 + 556 + 556 + 222) / 100)
je('krátký text se neořezává', zkratitText('Ahoj', 100, 10), 'Ahoj')
const orez = zkratitText('Kateřina Jirásková-Novotná', 60, 10)
je('dlouhý text končí výpustkou a vejde se', [orez.endsWith('…'), sirkaTextu(orez, 10) <= 60], [true, true])

const pdf = pdfZExportu(m)
const text = new TextDecoder('latin1').decode(pdf)
je('hlavička PDF', text.startsWith('%PDF-1.4'), true)
je('konec PDF', text.trimEnd().endsWith('%%EOF'), true)
const stran = (text.match(/\/Type \/Page /g) ?? []).length
je('počet stránek v /Count sedí s počtem objektů Page', Number(/\/Count (\d+)/.exec(text)[1]), stran)
je('týdny + souhrn: aspoň šest stránek', stran >= 6, true)

// xref: každý záznam ukazuje na začátek „N 0 obj“.
const xrefStart = Number(/startxref\n(\d+)/.exec(text)[1])
const tabulka = text.slice(xrefStart).split('\n')
const pocetObjektu = Number(tabulka[1].split(' ')[1])
let xrefOk = true
for (let i = 1; i < pocetObjektu; i++) {
  const offset = Number(tabulka[2 + i].slice(0, 10))
  if (!text.slice(offset).startsWith(`${i} 0 obj`)) xrefOk = false
}
je('xref ukazuje na všechny objekty', xrefOk, true)
je('encoding s doplňky pro češtinu', text.includes('/Differences [1 /ecaron 2 /Ecaron'), true)
je('ř se kóduje osmičkově jako \\013 („Kateřina“)', text.includes('Kate\\013ina'), true)
je('ě jako \\001 („Zaměstnanec“ v záhlaví tabulky)', text.includes('Zam\\001stnanec'), true)
je('Ě velké jako \\002 (skupina „NEOBSAZENÉ SMĚNY“ je verzálkami)', text.includes('SM\\002NY'), true)
je('WinAnsi znaky jdou osmičkově (á = 0xE1 = \\341: „Jirásková“)', text.includes('Jir\\341skov\\341'), true)
const zkouska = new StrankaPdf(200, 200)
zkouska.text('a(b)\\c "x" 100 %', 10, 20)
const textZkousky = new TextDecoder('latin1').decode(zapsatPdf([zkouska], { nazev: 'Zkouška' }))
je('závorky a zpětné lomítko se escapují', textZkousky.includes('(a\\(b\\)\\\\c "x" 100 %)'), true)
je('název dokumentu je UTF-16 (Zkouška)', textZkousky.includes('<FEFF005A006B006F00750161006B0061>'), true)
je('neznámý znak se nahradí otazníkem, ne pádem', new TextDecoder('latin1').decode(zapsatPdf((() => { const p = new StrankaPdf(100, 100); p.text('a😀b', 5, 5); return [p] })(), { nazev: 'x' })).includes('(a?b)'), true)

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
