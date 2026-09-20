#!/usr/bin/env node
/**
 * Export měsíčního rozpisu do Excelu a PDF
 * (lib/rozpis-export.ts, lib/xlsx-zapis.ts, lib/pdf-zapis.ts).
 *
 * Pusť `node --experimental-strip-types scripts/rozpis-export.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 *   1. model: sloupec na člověka (přes pobočky), pořadí podle úseků, úsek
 *      ani pobočka se do tabulky nedostane, pobočka jen pod časem a jen při
 *      víc pobočkách, zkratky poboček jsou jednoznačné,
 *   2. sešit se dá PŘEČÍST zpátky týmž čtecím kódem, který appka používá
 *      pro import (lib/xlsx.ts) — export, který si vlastní čtečka
 *      nepřečte, by se do Excelu nemusel dostat taky,
 *   3. XML uvnitř sešitu je správně uzavřené a ZIP má platné kontrolní
 *      součty,
 *   4. celý měsíc na JEDNU stránku A4 na výšku (Excel: přizpůsobit 1 × 1;
 *      PDF: měsíc v jedné tabulce, nic nepřeteče přes okraje), a když se
 *      nevejde, rozdělí se lidé na víc stran místo nečitelného písma.
 *
 * Vzorová data jsou vymyšlená; nic z nich není zapsané v logice.
 */

import {
  dilSmeny,
  dnyMesice,
  hodinyCislem,
  jeMesic,
  jmenaNalezato,
  listyXlsx,
  nazevMesice,
  nazevSouboru,
  pauzaKratce,
  popisDne,
  radkyDoSirky,
  radkySmeny,
  rozdelitLidi,
  sestavitExportMesice,
  sirkaSloupceXlsx,
  vetyPoznamky,
  zalomitVety,
} from '../lib/rozpis-export.ts'
import { zkratkyPobocek } from '../lib/rozpis-desktop.ts'
import { A4_SIRKA, A4_VYSKA, DOLNI_HRANICE, OKRAJ, pdfZExportu, vyberRozlozeni } from '../lib/rozpis-export-pdf.ts'
import { sirkaTextu, sirkaZnaku, StrankaPdf, zapsatPdf, zkratitText } from '../lib/pdf-zapis.ts'
import { crc32, sloupecNaPismeno, textTisku, zapsatXlsx } from '../lib/xlsx-zapis.ts'
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

const vstup = (s = smeny, prepis = {}) => ({
  mesic: '2026-09', smeny: s, osoby, useky, pozice, pobocky,
  rozsah: 'Restaurace Černá Perla', vytvoreno: '19. 9. 2026 15:30',
  ...prepis,
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
je('směny mimo měsíc a zrušená se nepočítají (9 z 12)', m.smen, 9)
je('sloupec na člověka: úseky podle pořadí firmy, bez úseku poslední, Neobsazeno úplně na konci', m.sloupce.map((c) => c.jmeno), ['Andrea Mikulová', 'Kateřina Jirásková', 'Oxy', 'Neobsazeno'])
const [andrea, katerina, oxy, volne] = m.sloupce
je('Andrea: 8 + 8 + 10 + 8 + 8 = 42 h', andrea.minut, 42 * 60)
je('trhaná směna: pauza zvlášť, hodiny bez ní', [andrea.podleDne.get('2026-09-03')[0].pauza, andrea.podleDne.get('2026-09-03')[0].kratce], ['15:00–17:00', '10–22'])
je('celý zápis času se drží', andrea.podleDne.get('2026-09-01')[0].cas, '08:00–16:00')
je('směna přes půlnoc: 22–6 a 8 h', [andrea.podleDne.get('2026-09-02')[0].kratce, andrea.minut > 0], ['22–6', true])
je('nevydaná směna je označená', [andrea.podleDne.get('2026-09-04')[0].nevydana, andrea.podleDne.get('2026-09-01')[0].nevydana], [true, false])
je('dvě směny téhož dne: dvě části po začátku', katerina.podleDne.get('2026-09-04').map((d) => d.kratce), ['12–20', '21–23'])
je('Kateřina: 8 h + 2 h', katerina.minut, 600)
je('pozice se doplní z číselníku, člověk bez pozice ji nemá', [andrea.pozice, katerina.pozice, oxy.pozice], ['Kuchařka', 'Servírka', ''])
je('neobsazený sloupec: bez člověka, jedna směna, 8 h', [volne.osobaId, volne.smen, volne.minut, volne.pozice], [null, 1, 480, 'volné směny'])
je('celkem hodin lidí: Andrea 42 + Kateřina 10 + Oxy 8 = 60 h (bez neobsazených)', m.celkemMinut, 60 * 60)
je('nevydaných: 4. 9. Andrea + neobsazená 9. 9.', m.nevydanych, 2)
je('jedna pobočka: pobočka se nepíše, seznam poboček je prázdný', [m.vicePobocek, m.pobocky], [false, []])
je('souhrn: pořadí sloupců, bez Neobsazeno', m.souhrn.map((r) => [r.jmeno, r.smen, r.minut / 60]), [['Andrea Mikulová', 5, 42], ['Kateřina Jirásková', 2, 10], ['Oxy', 1, 8]])
je('souhrn nemá úsek ani pobočky', Object.keys(m.souhrn[0]).sort(), ['jmeno', 'minut', 'pozice', 'smen'])
je('do modelu se nedostal ani název úseku, ani pobočky', JSON.stringify(m.sloupce.map((c) => [c.jmeno, c.pozice, [...c.podleDne.values()].flat().map((d) => [d.cas, d.kratce, d.pauza, d.nevydana])])).includes('Kuchyně'), false)
je('hodiny jako číslo: 510 min = 8,5', hodinyCislem(510), 8.5)
je('hodiny jako číslo: 100 min = 1,67', hodinyCislem(100), 1.67)
je('čas do úzké buňky: celé hodiny bez :00, půlhodiny celé',
  [dilSmeny(smena('2026-09-01', 'a', '08:30', '16:30')).kratce, dilSmeny(smena('2026-09-01', 'a', '16:00', '23:30')).kratce, dilSmeny(smena('2026-09-01', 'a', '09:00', '17:00')).kratce], ['8:30–16:30', '16–23:30', '9–17'])
je('směna nese pobočku, když ji zná', dilSmeny(smena('2026-09-01', 'a', '08:00', '16:00'), 'Bernard').pobocka, 'Bernard')

const dvePobocky = sestavitExportMesice(vstup([...smeny, smena('2026-09-06', 'a', '08:00', '12:00', { branch_id: 'b2' })]))
je('dvě pobočky: příznak a pobočky se zkratkami (abecedně)', [dvePobocky.vicePobocek, dvePobocky.pobocky], [true, [{ nazev: 'Bernard', zkratka: 'B' }, { nazev: 'Černá Perla', zkratka: 'ČP' }]])
const andreaDve = dvePobocky.sloupce.filter((c) => c.jmeno === 'Andrea Mikulová')
je('dvě pobočky: člověk je pořád JEDEN sloupec (pobočky se nemíchají do sloupců)', andreaDve.length, 1)
je('… pobočka je na směně: 6. 9. Bernard, 1. 9. Černá Perla', [andreaDve[0].podleDne.get('2026-09-06')[0].pobocka, andreaDve[0].podleDne.get('2026-09-01')[0].pobocka], ['Bernard', 'Černá Perla'])
je('… hodiny za člověka přes obě pobočky: 42 h + 4 h', andreaDve[0].minut, 46 * 60)
je('… souhrn: jeden řádek na člověka', dvePobocky.souhrn.filter((r) => r.jmeno === 'Andrea Mikulová').map((r) => [r.smen, r.minut / 60]), [[6, 46]])

console.log('\n== Zkratky poboček ==')
const zk = (...nazvy) => Object.fromEntries(zkratkyPobocek(nazvy))
// Zkratka = první písmena slov (Šéfík 20. 9. 2026).
je('víceslovný název: písmeno z každého slova', [zk('Černá Perla', 'Bernard')['Černá Perla'], zk('Restaurace U Lva')['Restaurace U Lva']], ['ČP', 'RUL'])
je('jednoslovný název: jedno písmeno', zk('Černá Perla', 'Bernard')['Bernard'], 'B')
je('shodné iniciály: každému slovu se přidá písmeno, dokud se nerozliší', zk('Černá Perla', 'Červená Pergola'), { 'Černá Perla': 'ČernPerl', 'Červená Pergola': 'ČervPerg' })
je('… prodlužují se VŠECHNA slova, ne jen první (liší se až poslední)', zk('Restaurace U Lva', 'Restaurace U Lípy'), { 'Restaurace U Lva': 'ReULv', 'Restaurace U Lípy': 'ReULí' })
je('zkratka není delší než název (jednopísmenný název zůstane celý)', [zk('Bar')['Bar'], zk('U')['U']], ['B', 'U'])
je('dvě jednoslovné pobočky na stejné písmeno se rozliší', zk('Bernard', 'Bistro'), { Bernard: 'Be', Bistro: 'Bi' })
const mnoho = zkratkyPobocek(['Restaurace U Lva', 'Restaurace U Lípy', 'Rybí Ulice', 'Bar Bernard', 'Bernard', 'Bistro Baltazar'])
je('každá zkratka je jiná i u podobných názvů', new Set(mnoho.values()).size, 6)
je('stejný název dvakrát = jedna zkratka', zkratkyPobocek(['Bernard', 'Bernard']).size, 1)
/*
  Zkratka se počítá ze VŠECH poboček firmy, ne jen z těch, které mají v měsíci
  směnu — jinak by „Černá Perla“ byla v lednu „ČP“ a v únoru (když přibude
  „Červená Pergola“) „Čern“, a dva papíry by se nedaly srovnat. Obrazovka má
  tentýž zdroj, takže karta směny a export říkají totéž.
*/
const vsechnyPobocky = new Map([['b1', 'Černá Perla'], ['b2', 'Červená Pergola']])
const jenJedna = sestavitExportMesice(vstup([smena('2026-09-02', 'a', '08:00', '16:00'), smena('2026-09-03', 'a', '08:00', '12:00', { branch_id: 'b2' })], { pobocky: vsechnyPobocky }))
je('obě pobočky v měsíci: zkratky se rozliší', jenJedna.pobocky.map((p) => p.zkratka), ['ČernPerl', 'ČervPerg'])
const bezDruhe = sestavitExportMesice(vstup([smena('2026-09-02', 'a', '08:00', '16:00'), smena('2026-09-03', 'a', '08:00', '12:00', { branch_id: 'b3' })], { pobocky: new Map([...vsechnyPobocky, ['b3', 'Bernard']]) }))
je('druhá pobočka v měsíci chybí, a „Černá Perla“ má přesto TUTÉŽ zkratku (ne „ČP“)',
  bezDruhe.pobocky.find((p) => p.nazev === 'Černá Perla').zkratka, 'ČernPerl')
je('… a v seznamu jsou jen pobočky, které v měsíci opravdu jsou', bezDruhe.pobocky.map((p) => p.nazev), ['Bernard', 'Černá Perla'])

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
je('položky sešitu: dva listy (Rozpis a Souhrn)', [...soubory.keys()].sort(), [
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
const zAmpersandem = rozbalit(zapsatXlsx([{ nazev: 'A&B', sloupce: [10], radky: [[{ t: 's', v: 'a < b & c' }]] }]))
je('XML se escapuje: text v XML je escapovaný', zAmpersandem.get('xl/sharedStrings.xml').text.includes('a &lt; b &amp; c'), true)
je('… název listu je escapovaný', zAmpersandem.get('xl/workbook.xml').text.includes('name="A&amp;B"'), true)

console.log('\n== Excel: list Rozpis (dny v řádcích, lidé ve sloupcích, jedna stránka) ==')
const listy = listyXlsx(m)
je('dva listy: Rozpis a Souhrn', listy.map((l) => l.nazev), ['Rozpis', 'Souhrn'])
const radky = await precistXlsx(sesit) // první list
je('nadpis a podnadpis', [radky[0][0], radky[1][0]], ['Rozpis směn — září 2026', 'Restaurace Černá Perla · vytvořeno 19. 9. 2026 15:30'])
je('záhlaví: Den a člověk s pozicí pod jménem; bez pozice jen jméno; neobsazené na konci',
  radky[2], ['Den', 'Andrea Mikulová\nKuchařka', 'Kateřina Jirásková\nServírka', 'Oxy', 'Neobsazeno\nvolné směny'])
je('řádek na každý den měsíce (30) a pod nimi Hodin', [radky[3][0], radky[32][0], radky[33][0]], ['Út 1.', 'St 30.', 'Hodin'])
je('1. 9.: Andrea 8–16, ostatní prázdno', radky[3], ['Út 1.', '8–16', '', '', ''])
je('2. 9. přes půlnoc: 22–6', radky[4][1], '22–6')
je('3. 9. trhaná směna: čas a pod ním pauza zkráceně', radky[5][1], '10–22\npauza 15–17')
je('4. 9.: nevydaná s hvězdičkou; Kateřina dvě směny pod sebou', [radky[6][1], radky[6][2]], ['8–16*', '12–20\n21–23'])
je('9. 9.: neobsazená směna ve sloupci Neobsazeno', radky[11][4], '10–18*')
je('součty hodin: 42, 10, 8 a neobsazené 8', radky[33].slice(1), ['42', '10', '8', '8'])
je('žádný úsek v tabulce (ani „Kuchyně“, ani „Plac“)', JSON.stringify(radky).includes('Kuchyn') || JSON.stringify(radky).includes('Plac'), false)
je('jedna pobočka: pobočka není v žádné buňce dne', radky.slice(3, 33).flat().some((c) => String(c).includes('Perla')), false)
je('poznámky pod tabulkou: nevydané, hodiny, Neobsazeno, celkem lidé', [
  radky.some((r) => (r[0] ?? '').startsWith('* nevydaná směna')),
  radky.some((r) => (r[0] ?? '').includes('Hodiny = plánované délky')),
  radky.some((r) => (r[0] ?? '').includes('Neobsazeno = volné směny')),
  radky.some((r) => (r[0] ?? '').includes('Celkem lidé: 60 h')),
], [true, true, true, true])

const sheetRozpis = soubory.get('xl/worksheets/sheet1.xml').text
const sheetSouhrn = soubory.get('xl/worksheets/sheet2.xml').text
je('A4 na výšku, přizpůsobit na 1 × 1 stránku', [/orientation="(\w+)"/.exec(sheetRozpis)[1], /paperSize="(\d+)"/.exec(sheetRozpis)[1], sheetRozpis.includes('fitToWidth="1" fitToHeight="1"'), sheetRozpis.includes('<pageSetUpPr fitToPage="1"/>')], ['portrait', '9', true, true])
je('bez pevného měřítka (s ním by se „na jednu stránku“ ignorovalo)', sheetRozpis.includes(' scale='), false)
je('Souhrn: A4 na výšku, na šířku jedné stránky (výška se dopočítá)', [/orientation="(\w+)"/.exec(sheetSouhrn)[1], sheetSouhrn.includes('fitToHeight="0"')], ['portrait', true])
je('zápatí s časem a stranou (& v kódech Excelu escapované pro XML)', sheetRozpis.includes('<oddFooter>&amp;LVytvořeno 19. 9. 2026 15:30&amp;RStrana &amp;P z &amp;N</oddFooter>'), true)
je('zmrazené záhlaví a levý sloupec (na obrazovce)', sheetRozpis.includes('xSplit="1" ySplit="3"'), true)
je('styl pro otočené záhlaví v sešitu existuje', soubory.get('xl/styles.xml').text.includes('textRotation="90"'), true)
/*
  Jména v záhlaví sešitu: naležato, vejdou-li se do sloupce (Šéfík 20. 9. 2026),
  jinak otočená o 90°. Styl 13 = naležato, styl 10 = otočené.
*/
const stylyZahlavi = (list) => {
  const x = rozbalit(zapsatXlsx([list])).get('xl/worksheets/sheet1.xml').text
  const r3 = /<row r="3"[^>]*>(.*?)<\/row>/s.exec(x)
  return [...new Set([...(r3?.[1] ?? '').matchAll(/ s="(\d+)"/g)].map((z) => z[1]))]
}
je('čtyři lidé v širokém sloupci: záhlaví naležato (styl 13, ne 10)', stylyZahlavi(listy[0]).includes('13'), true)
je('… a nic se neotáčí', stylyZahlavi(listy[0]).includes('10'), false)
je('víkend má vlastní styl levého sloupce: So 5. (řádek 8) jiný než Út 1. (řádek 4)', [/<c r="A4" t="s" s="(\d+)"/.exec(sheetRozpis)[1], /<c r="A8" t="s" s="(\d+)"/.exec(sheetRozpis)[1]], ['11', '12'])
const sirkyCol = [...sheetRozpis.matchAll(/<col [^>]*width="([\d.]+)"/g)].map((x) => Number(x[1]))
/*
  Sloupce lidí: nejmíň tak široké, aby se vešel čas a pauza (`sirkaSloupceXlsx`),
  a pak se roztáhnou do zbytku stránky — úzký proužek na levé třetině A4
  nikomu neposlouží a v širším sloupci se jméno vejde naležato.
*/
je('sloupce: Den + čtyři lidé, všichni stejně širocí', [sirkyCol.length, sirkyCol[0], new Set(sirkyCol.slice(1)).size], [5, 6.5, 1])
je('… čtyři lidé se roztáhnou na strop (16 znaků), protože na stránce je místa dost', sirkyCol[1], 16)
je('… ale nikdy pod nutné minimum podle času a pauzy (8 znaků)', sirkyCol[1] >= sirkaSloupceXlsx(m.sloupce), true)
const bezPauz = sestavitExportMesice(vstup(smeny.filter((s2) => !s2.pauza_od)))
je('bez pauz řídí šířku nejdelší čas „10–18*“ (6 znaků → sloupec 7)', sirkaSloupceXlsx(bezPauz.sloupce), 7)
je('a jen z krátkých časů („8–16“) sloupec neklesne pod 6', sirkaSloupceXlsx(sestavitExportMesice(vstup([smena('2026-09-02', 'a', '08:00', '16:00')])).sloupce), 6)
const dlouhe = sestavitExportMesice(vstup([smena('2026-09-02', 'a', '16:00', '23:30'), smena('2026-09-03', 'a', '10:30', '23:30')]))
je('dlouhý čas „10:30–23:30“ (11 znaků) → sloupec 11 (strop)', sirkaSloupceXlsx(dlouhe.sloupce), 11)
je('dlouhý čas „16–23:30“ (8 znaků) → 8', sirkaSloupceXlsx(sestavitExportMesice(vstup([smena('2026-09-02', 'a', '16:00', '23:30')])).sloupce), 8)
je('minimum počítá funkce z týchž dat („pauza 15–17“ → 8 znaků)', sirkaSloupceXlsx(m.sloupce), 8)
const souhrnRadky = await precistXlsx(zapsatXlsx([listy[1]]))
je('Souhrn: jen jméno, pozice, směny, hodiny (bez úseku a poboček)', souhrnRadky[3], ['Zaměstnanec', 'Pozice', 'Směn', 'Hodin'])
je('Souhrn: Andrea 5 směn a 42 h; řádek Celkem', [souhrnRadky[4], souhrnRadky[souhrnRadky.length - 1]], [['Andrea Mikulová', 'Kuchařka', '5', '42'], ['Celkem', '', '8', '60']])

// Pořadí lidí: podle úseků firmy, ne abecedně (Zuzana v Kuchyni je před Adamem na Placu).
const poradiOsoby = new Map([
  ['ad', { id: 'ad', jmeno: 'Adam Nový', usekId: 'u-p', poziceId: null, barva: null }],
  ['zu', { id: 'zu', jmeno: 'Zuzana Stará', usekId: 'u-k', poziceId: null, barva: null }],
])
je('pořadí sloupců: nejdřív úsek Kuchyně (Zuzana), pak Plac (Adam) — i když abecedně je Adam první',
  sestavitExportMesice(vstup([smena('2026-09-02', 'ad', '08:00', '16:00'), smena('2026-09-02', 'zu', '08:00', '16:00')], { osoby: poradiOsoby })).sloupce.map((c) => c.jmeno), ['Zuzana Stará', 'Adam Nový'])

const dveRadky = await precistXlsx(zapsatXlsx(listyXlsx(dvePobocky)))
// Bez pauz je sloupec úzký (6 znaků): „Černá Perla“ se nevejde → zkratka „ČP“, „Bernard“ se ještě vejde celý.
const dveUzke = sestavitExportMesice(vstup([...smeny.filter((s2) => !s2.pauza_od), smena('2026-09-06', 'a', '08:00', '12:00', { branch_id: 'b2' })]))
const dveUzkeRadky = await precistXlsx(zapsatXlsx(listyXlsx(dveUzke)))
je('úzký sloupec: dlouhý název pobočky se zkrátí („ČP“), krátký „Bernard“ zůstane celý', [dveUzkeRadky[3][1], dveUzkeRadky[8][1]], ['8–16\nČP', '8–12\nBernard'])
je('… zkratka je vysvětlená v poznámce, „Bernard“ vysvětlení nepotřebuje', [dveUzkeRadky.some((r) => (r[0] ?? '').includes('ČP = Černá Perla')), dveUzkeRadky.some((r) => (r[0] ?? '').includes('Ber = Bernard'))], [true, false])
const sirkaDve = sirkaSloupceXlsx(dvePobocky.sloupce)
je('dvě pobočky: pobočka je pod časem (celý název, když se vejde do sloupce; jinak zkratka)',
  [dveRadky[8][1], dveRadky[3][1]],
  [`8–12\n${'Bernard'.length * 0.65 <= sirkaDve - 1 ? 'Bernard' : 'Ber'}`, `8–16\n${'Černá Perla'.length * 0.65 <= sirkaDve - 1 ? 'Černá Perla' : 'ČP'}`])
je('dvě pobočky: použitá zkratka je vysvětlená v poznámce', dveRadky.some((r) => (r[0] ?? '').includes('ČP = Černá Perla')), 'Černá Perla'.length * 0.65 > sirkaDve - 1)
const zaHlavou = (radky2) => radky2.slice(3, 33).flat().join(' ')
je('dvě pobočky: v tabulce dnů není žádný úsek', zaHlavou(dveRadky).includes('Kuchyn'), false)

console.log('\n== Excel: hodně lidí se dělí na listy ==')
const lide40 = new Map(Array.from({ length: 40 }, (_, i) => [`v${i}`, { id: `v${i}`, jmeno: `Osoba ${String(i + 1).padStart(2, '0')}`, usekId: i % 2 ? 'u-k' : 'u-p', poziceId: 'p-1', barva: null }]))
const smeny40 = [...lide40.keys()].flatMap((id, i) => ['2026-09-07', '2026-09-08', '2026-09-09'].map((den) => smena(den, id, i % 2 ? '08:00' : '16:00', i % 2 ? '16:00' : '23:30')))
const m40 = sestavitExportMesice(vstup(smeny40, { osoby: lide40 }))
const listy40 = listyXlsx(m40)
// Hodně lidí = na roztažení není místo, sloupec zůstane na nutném minimu.
je('40 lidí rozdělených na listy: sloupec zůstane na minimu, neroztahuje se', listy40[0].sloupce[1], sirkaSloupceXlsx(m40.sloupce))
const dlouzi40 = new Map(Array.from({ length: 40 }, (_, i) => [`d${i}`, { id: `d${i}`, jmeno: `Bartoloměj${i} Nepomucký`, usekId: 'u-k', poziceId: 'p-1', barva: null }]))
const listyDlouhe = listyXlsx(sestavitExportMesice(vstup([...dlouzi40.keys()].flatMap((id) => ['2026-09-07', '2026-09-08'].map((den) => smena(den, id, '08:00', '16:00'))), { osoby: dlouzi40 })))
je('40 lidí s dlouhými jmény v úzkém sloupci: záhlaví se otočí (styl 10)', stylyZahlavi(listyDlouhe[0]).includes('10'), true)
je('… a nic naležato', stylyZahlavi(listyDlouhe[0]).includes('13'), false)
je('40 lidí: víc listů „Rozpis 1“, „Rozpis 2“… a Souhrn na konci', [listy40.length > 2, listy40[0].nazev, listy40[listy40.length - 1].nazev], [true, 'Rozpis 1', 'Souhrn'])
je('… každý list má aspoň jednoho člověka a všichni lidé jsou právě na jednom', [listy40.slice(0, -1).every((l) => l.sloupce.length > 1), listy40.slice(0, -1).reduce((k, l) => k + l.sloupce.length - 1, 0)], [true, 40])
/** Šířka listu v bodech: sloupec zabere `w * 7 + 5` pixelů, bod je 0,75 pixelu. */
const sirkaListuPt = (list) => list.sloupce.reduce((k, w) => k + (w * 7 + 5) * 0.75, 0)
const SIRKA_A4_PT = (8.27 - 0.8) * 72 // A4 na výšku s okraji 0,4″
je('… a šířka každého listu se vejde do A4 při měřítku aspoň 62 %', listy40.slice(0, -1).every((l) => sirkaListuPt(l) * 0.62 <= SIRKA_A4_PT + 1), true)
// A ta kontrola umí spadnout — bez tohohle by byla zelená nad čímkoli.
je('… a chytne list, který je na A4 moc široký (60 sloupců po 11 znacích)', sirkaListuPt({ sloupce: Array.from({ length: 60 }, () => 11) }) * 0.62 <= SIRKA_A4_PT + 1, false)
je('rozdělení lidí: 7 po 3 → 3 + 2 + 2', rozdelitLidi([1, 2, 3, 4, 5, 6, 7], 3).map((c) => c.length), [3, 2, 2])
je('rozdělení lidí: vejdou se → jedna část', rozdelitLidi([1, 2, 3, 4, 5, 6], 6).map((c) => c.length), [6])
je('rozdělení lidí: 10 po 4 → 4 + 3 + 3', rozdelitLidi(Array.from({ length: 10 }, (_, i) => i), 4).map((c) => c.length), [4, 3, 3])
je('rozdělení lidí: nikdo → jedna prázdná část (list se přesto vytvoří)', rozdelitLidi([], 5), [[]])
const bezSmen = listyXlsx(sestavitExportMesice(vstup([])))
je('měsíc bez směn: Rozpis (jen záhlaví a dny) i Souhrn se vytvoří', [bezSmen.map((l) => l.nazev), bezSmen[0].radky.length > 30], [['Rozpis', 'Souhrn'], true])

console.log('\n== Excel: zalomení, záhlaví a drobný text ==')
const zkouskaListu = (prepis) => rozbalit(zapsatXlsx([{ nazev: 'X', sloupce: [10], radky: [[{ t: 's', v: 'a' }], [{ t: 's', v: 'b' }], [{ t: 's', v: 'c' }], [{ t: 's', v: 'd' }]], ...prepis }]))
je('zalomení před řádkem 3 a 4 = <brk id="2"> a <brk id="3">',
  [...zkouskaListu({ zalomeniPred: [3, 4] }).get('xl/worksheets/sheet1.xml').text.matchAll(/<brk id="(\d+)"/g)].map((x) => x[1]), ['2', '3'])
je('zalomení před řádkem 1 se nezapisuje (první stránka už začíná)',
  zkouskaListu({ zalomeniPred: [1] }).get('xl/worksheets/sheet1.xml').text.includes('rowBreaks'), false)
je('bez zalomení žádné <rowBreaks>', zkouskaListu({}).get('xl/worksheets/sheet1.xml').text.includes('rowBreaks'), false)
je('naJednuStranku: fitToHeight="1"; jinak výška podle obsahu (0)',
  [zkouskaListu({ naJednuStranku: true }).get('xl/worksheets/sheet1.xml').text.includes('fitToHeight="1"'), zkouskaListu({}).get('xl/worksheets/sheet1.xml').text.includes('fitToHeight="0"')], [true, true])
je('znak & v záhlaví se zdvojí (řídicí znak Excelu) a pak escapuje pro XML',
  zkouskaListu({ tisk: { zapati: '&L' + textTisku('A&B') } }).get('xl/worksheets/sheet1.xml').text.includes('<oddFooter>&amp;LA&amp;&amp;B</oddFooter>'), true)
je('oblast tisku se jménem listu s apostrofem: apostrof zdvojený',
  rozbalit(zapsatXlsx([{ nazev: "Bob's", sloupce: [10], radky: [[{ t: 's', v: 'a' }], [{ t: 's', v: 'b' }]], tiskOdRadku: 2 }])).get('xl/workbook.xml').text.includes("'Bob''s'!$A$2:$A$2"), true)

const sDrobnym = rozbalit(zapsatXlsx([{ nazev: 'X', sloupce: [10], radky: [[{ t: 's', v: 'hlavní\nvedlejší', drobne: [false, true] }, { t: 's', v: 'hlavní\nvedlejší' }]] }]))
const sstDrobny = sDrobnym.get('xl/sharedStrings.xml').text
je('drobný řádek je formátovaný text: běh 9 pt a běh 7 pt šedě', [sstDrobny.includes('<sz val="9"/>'), sstDrobny.includes('<sz val="7"/><color rgb="FF6C7177"/>')], [true, true])
je('stejný text bez drobného řádku je samostatná položka (dvě různé)', [(sstDrobny.match(/<si>/g) ?? []).length, /uniqueCount="(\d+)"/.exec(sstDrobny)[1]], [2, '2'])
const precteneDrobne = await precistXlsx(zapsatXlsx([{ nazev: 'X', sloupce: [10], radky: [[{ t: 's', v: 'hlavní\nvedlejší', drobne: [false, true] }]] }]))
je('vlastní čtečka dá z formátovaného textu obyčejný text se zalomením', precteneDrobne[0][0], 'hlavní\nvedlejší')
je('XML sešitu s formátovaným textem je správně uzavřené', xmlJeUzavrene(sstDrobny), true)

console.log('\n== Pomocné funkce exportu ==')
je('pauza zkráceně: celé hodiny bez :00', pauzaKratce('15:00–17:00'), '15–17')
je('pauza zkráceně: půlhodiny se nechají', pauzaKratce('14:30–16:30'), '14:30–16:30')
je('pauza zkráceně: smíšené', pauzaKratce('15:30–17:00'), '15:30–17')
je('den do levého sloupce', [popisDne('2026-09-21'), popisDne('2026-09-01'), popisDne('2026-09-27')], ['Po 21.', 'Út 1.', 'Ne 27.'])
const dilTrhane = dilSmeny(smena('2026-09-03', 'a', '10:00', '22:00', { pauza_od: '15:00:00', pauza_do: '17:00:00' }), 'Bernard')
je('řádky buňky: čas s hvězdičkou, pod ním pobočka a pauza drobně',
  radkySmeny([{ ...dilTrhane, nevydana: true }, dilSmeny(smena('2026-09-03', 'a', '23:00', '23:30'))], (p) => p),
  [{ text: '10–22*', drobne: false }, { text: 'Bernard', drobne: true }, { text: 'pauza 15–17', drobne: true }, { text: '23–23:30', drobne: false }])
je('bez funkce na pobočku se pobočka nepíše', radkySmeny([dilTrhane]).map((r) => r.text), ['10–22', 'pauza 15–17'])
je('věty se spojují do řádků a věta se nikdy nerozdělí', zalomitVety(['aaaa', 'bbbb', 'cccc'], (t) => t.length <= 11), ['aaaa · bbbb', 'cccc'])
console.log('\n== Jména naležato ==')
const doSirky = (t, n) => radkyDoSirky(t, (x) => [...x].length <= n)
je('krátké jméno na jeden řádek', doSirky('Jan Novák', 12), ['Jan Novák'])
je('delší jméno se zalomí mezi slovy', doSirky('Andrea Mikulová', 9), ['Andrea', 'Mikulová'])
je('spojovník je místo, kde se smí zalomit — a zůstane na konci řádku', doSirky('Jirásková-Novotná', 10), ['Jirásková-', 'Novotná'])
je('… bez spojovníku by se to nevešlo vůbec', doSirky('JiráskováNovotná', 10), null)
je('jedno slovo širší než sloupec = nevejde se (otočí se)', doSirky('Nepomucký', 5), null)
je('víc než tři řádky se nepovolí — záhlaví by přerostlo tabulku', [doSirky('a b c', 1), doSirky('a b c d', 1)], [['a', 'b', 'c'], null])
je('prázdný text: žádné řádky, ale ne „nevejde se“', doSirky('', 5), [])
je('naležato jen když se vejdou VŠICHNI (jeden dlouhý rozhodne za všechny)',
  [jmenaNalezato([{ jmeno: 'Jan Novák', pozice: '' }], (t) => [...t].length <= 6),
   jmenaNalezato([{ jmeno: 'Jan', pozice: '' }, { jmeno: 'Bartoloměj', pozice: '' }], (t) => [...t].length <= 6)], [true, false])
je('nevejde-li se pozice, otočí se taky', jmenaNalezato([{ jmeno: 'Jan', pozice: 'Pomocná síla' }], (t) => [...t].length <= 5), false)
je('jediná dlouhá věta zůstane celá', zalomitVety(['aaaaaaaaaaaaaaaa'], (t) => t.length <= 5), ['aaaaaaaaaaaaaaaa'])
je('poznámky: bez nevydaných a zkratek jen hodiny a celkem', vetyPoznamky({ ...m, nevydanych: 0 }, [], false), ['Hodiny = plánované délky směn bez automatické přestávky', 'Celkem lidé: 60 h'])
je('poznámky: zkratky poboček a Neobsazeno se přidají', vetyPoznamky(m, [{ nazev: 'Černá Perla', zkratka: 'ČP' }], true).slice(1, 3), ['Hodiny = plánované délky směn bez automatické přestávky', 'ČP = Černá Perla'])

console.log('\n== PDF ==')
je('šířka: A = 667, a = 556, ě (jako e) = 556, W tučně = 944', [sirkaZnaku('A'), sirkaZnaku('a'), sirkaZnaku('ě'), sirkaZnaku('W', 'tucne')], [667, 556, 556, 944])
je('šířka textu: „Ahoj“ při 10 pt', sirkaTextu('Ahoj', 10), (667 + 556 + 556 + 222) / 100)
je('krátký text se neořezává', zkratitText('Ahoj', 100, 10), 'Ahoj')
const orez = zkratitText('Kateřina Jirásková-Novotná', 60, 10)
je('dlouhý text končí výpustkou a vejde se', [orez.endsWith('…'), sirkaTextu(orez, 10) <= 60], [true, true])

const cti = (bajty) => new TextDecoder('latin1').decode(bajty)
const pdf = pdfZExportu(m)
const text = cti(pdf)
je('hlavička PDF', text.startsWith('%PDF-1.4'), true)
je('konec PDF', text.trimEnd().endsWith('%%EOF'), true)
const stran = (text.match(/\/Type \/Page /g) ?? []).length
je('počet stránek v /Count sedí s počtem objektů Page', Number(/\/Count (\d+)/.exec(text)[1]), stran)
je('celý měsíc na JEDNÉ stránce', stran, 1)
je('A4 na výšku: MediaBox 595 × 842', [...text.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((x) => x[1]), ['0 0 595 842'])
je('číslování: „Strana 1 z 1“', text.includes('(Strana 1 z 1)'), true)

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
je('ř se kóduje osmičkově jako \\013 („Kateřina“ v otočeném záhlaví)', text.includes('Kate\\013ina'), true)
je('ě jako \\001 („směn“ v nadpisu)', text.includes('sm\\001n'), true)
je('WinAnsi znaky jdou osmičkově (á = 0xE1 = \\341: „Jirásková“)', text.includes('Jir\\341skov\\341'), true)
/*
  Jména v záhlaví: naležato, kdykoli se do sloupce vejdou (Šéfík 20. 9. 2026) —
  vodorovné jméno se čte samo a záhlaví je nižší. Otáčí se, až když se
  nevejdou; buď otočené celé záhlaví, nebo nic.
*/
je('čtyři lidé v širokém sloupci: jména naležato, nic se neotáčí', (text.match(/ 0 1 -1 0 /g) ?? []).length, 0)
const sJmeny = (jmena) => {
  const os = new Map(jmena.map((j, i) => [`z${i}`, { id: `z${i}`, jmeno: j, usekId: 'u-k', poziceId: null, barva: null }]))
  const sm = [...os.keys()].flatMap((id) => dnyMesice('2026-09').map((den) => smena(den, id, '08:00', '16:00')))
  return cti(pdfZExportu(sestavitExportMesice(vstup(sm, { osoby: os }))))
}
// „Ota 3“ se do sloupce širokého 25 bodů vejde; „Nov19“ o zlomek bodu ne — proto krátká jména.
const kratkaJmena = sJmeny(Array.from({ length: 20 }, (_, i) => `Ota ${i}`))
je('20 lidí s krátkými jmény: pořád naležato (do úzkého sloupce se vejdou)', (kratkaJmena.match(/ 0 1 -1 0 /g) ?? []).length, 0)
const dlouhaJmena = sJmeny(Array.from({ length: 20 }, (_, i) => `Bartoloměj${i} Nepomucký`))
je('20 lidí s dlouhými jmény: záhlaví se otočí (naležato by se nevešla)', (dlouhaJmena.match(/ 0 1 -1 0 /g) ?? []).length >= 20, true)
je('… a otočí se všechna, ne jen některá (půlka tak a půlka onak by vypadala rozbitě)',
  (dlouhaJmena.match(/ 0 1 -1 0 /g) ?? []).length % 20, 0)
je('trhaná směna: pauza zkráceně (en pomlčka = \\226)', text.includes('pauza 15\\22617'), true)
je('žádný úsek v PDF (ani „Kuchyně“, ani „PLAC“)', text.includes('Kuchyn') || text.includes('Plac') || text.includes('PLAC') || text.includes('KUCHYN'), false)
je('jedna pobočka: název pobočky není u směn (jen v nadpisu jako „Restaurace Černá Perla“ v rozsahu)', (text.match(/\\(Perla\\)/g) ?? []).length, 0)
je('nevydaná směna má hvězdičku a v poznámce je vysvětlená', [text.includes('(8\\2261') || text.includes('8\\22616*'), text.includes('nevydan')], [true, true])
const zkouska = new StrankaPdf(200, 200)
zkouska.text('a(b)\\c "x" 100 %', 10, 20)
const textZkousky = cti(zapsatPdf([zkouska], { nazev: 'Zkouška' }))
je('závorky a zpětné lomítko se escapují', textZkousky.includes('(a\\(b\\)\\\\c "x" 100 %)'), true)
je('název dokumentu je UTF-16 (Zkouška)', textZkousky.includes('<FEFF005A006B006F00750161006B0061>'), true)
je('neznámý znak se nahradí otazníkem, ne pádem', cti(zapsatPdf((() => { const p = new StrankaPdf(100, 100); p.text('a😀b', 5, 5); return [p] })(), { nazev: 'x' })).includes('(a?b)'), true)

console.log('\n== PDF: otočený text ==')
const otoc = (o) => { const p = new StrankaPdf(842, 842); p.text('Ahoj', 100, 200, { velikost: 10, otoceny: true, ...o }); return p.operace[0] }
je('otočený text začíná v bodě a jde nahoru (0 1 −1 0, y od dola)', otoc({}).includes(' 0 1 -1 0 100 642 Tm '), true)
je('vpravo (r): text v tom bodě končí, začíná o svou šířku níž', otoc({ zarovnani: 'r' }).includes(' 0 1 -1 0 100 621.99 Tm '), true)
je('normální text se neotáčí', (() => { const p = new StrankaPdf(842, 842); p.text('Ahoj', 100, 200); return p.operace[0].includes(' Tm ') })(), false)

console.log('\n== PDF: rozložení na stránky ==')
/** Obdélníky (tabulky) ze všech stránek: [x, y zdola, w, h]. */
const obdelniky = (t) => [...t.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].map((x) => x.slice(1, 5).map(Number))
const vTiskovePlose = (o) => o.every((r) => r[0] >= OKRAJ - 0.01 && r[0] + r[2] <= A4_SIRKA - OKRAJ + 0.01 && r[1] >= A4_VYSKA - DOLNI_HRANICE - 0.01 && r[1] + r[3] <= A4_VYSKA - OKRAJ + 0.01)
je('tabulka nepřetéká okraje ani zápatí (' + obdelniky(text).length + ' obdélníků)', [obdelniky(text).length > 30, vTiskovePlose(obdelniky(text))], [true, true])

/** Vzorek: `lidi` lidí, každý den jedna směna (výchozí 8–16); `dvojite` = ještě večerní 18–22. */
function vzorek(lidi, prepis = () => ({}), dvojite = false, casy = ['08:00', '16:00']) {
  const os = new Map(Array.from({ length: lidi }, (_, i) => [`x${i}`, { id: `x${i}`, jmeno: `Jméno${i} Příjmení${i}`, usekId: i % 2 ? 'u-k' : 'u-p', poziceId: 'p-1', barva: null }]))
  const sm = []
  for (const [id, i] of [...os.keys()].map((k, i) => [k, i])) {
    for (const den of dnyMesice('2026-09')) {
      sm.push(smena(den, id, casy[0], dvojite ? '12:00' : casy[1], prepis(den, i)))
      if (dvojite) sm.push(smena(den, id, '18:00', '22:00', prepis(den, i)))
    }
  }
  return sestavitExportMesice(vstup(sm, { osoby: os }))
}
const stranPdf = (mm) => (cti(pdfZExportu(mm)).match(/\/Type \/Page /g) ?? []).length
je('12 lidí, každý den jedna směna: celý měsíc na jedné stránce', stranPdf(vzorek(12)), 1)
je('… s největším písmem (čas 9 bodů — na stránce je místa dost)', vyberRozlozeni(vzorek(12)).f, 9)
je('20 lidí s krátkými časy: stále jedna stránka a pořád 9 bodů (sloupec je asi tak široký jako „8–16“)', [stranPdf(vzorek(20)), vyberRozlozeni(vzorek(20)).f], [1, 9])
const dlouheCasy = ['16:00', '23:30']
const rozl16 = vyberRozlozeni(vzorek(16, () => ({}), false, dlouheCasy))
je('16 lidí s dlouhými časy („16–23:30“): jedna stránka, ale menší písmo (6,5 bodu)', [rozl16.casti.length, rozl16.f], [1, 6.5])
const rozl20 = vyberRozlozeni(vzorek(20, () => ({}), false, dlouheCasy))
je('20 lidí s dlouhými časy: na jednu stránku se nevejdou ani při 6 bodech → dvě stránky s velkým písmem (ne jedna nečitelná)', [rozl20.casti.map((c) => c.length), rozl20.f, stranPdf(vzorek(20, () => ({}), false, dlouheCasy))], [[10, 10], 9, 2])
const p60 = cti(pdfZExportu(vzorek(60)))
je('60 lidí: nejméně stránek, na které se vejde šířka při 6 bodech = 2 × 30 lidí (každá s celým měsícem)', [(p60.match(/\/Type \/Page /g) ?? []).length, vyberRozlozeni(vzorek(60)).casti.map((c) => c.length), vyberRozlozeni(vzorek(60)).f], [2, [30, 30], 6])
je('… na stránce je vidět, kteří zaměstnanci', p60.includes('zam\\001stnanci 1'), true)
je('… jedna stránka to takto neříká', text.includes('zam\\001stnanci'), false)
je('… každá stránka má záhlaví „Den“ a nic nepřetéká', [(p60.match(/\(Den\)/g) ?? []).length, vTiskovePlose(obdelniky(p60))], [(p60.match(/\/Type \/Page /g) ?? []).length, true])
je('… a lidé jsou právě na jedné stránce (60 otočených jmen)', (p60.match(/Jm\\351no\d+ P/g) ?? []).length, 60)

const husty = cti(pdfZExportu(vzorek(14, (den, i) => ({ branch_id: (Number(den.slice(8)) + i) % 2 ? 'b2' : 'b1', pauza_od: '10:00:00', pauza_do: '11:00:00' }), true)))
const stranHusty = (husty.match(/\/Type \/Page /g) ?? []).length
je('14 lidí, dvě směny denně na dvou pobočkách a s pauzami: měsíc se nevejde na výšku → pokračuje na další stránce, ne 14 stránek', [stranHusty >= 2, stranHusty <= 3], [true, true])
je('… záhlaví „Den“ je na každé stránce a nic nepřetéká', [(husty.match(/\(Den\)/g) ?? []).length, vTiskovePlose(obdelniky(husty))], [stranHusty, true])
je('… hodiny za měsíc jsou jen jednou (na poslední stránce)', (husty.match(/\(Hodin\)/g) ?? []).length, 1)

// Dvě pobočky: pobočka pod časem, zkratka u dlouhého názvu, vysvětlená v poznámce.
const dlouhePobocky = new Map([['b1', 'Restaurace U Zlatého lva'], ['b2', 'Bar']])
const osDve = new Map(Array.from({ length: 12 }, (_, i) => [`y${i}`, { id: `y${i}`, jmeno: `Jméno${i} Příjmení${i}`, usekId: 'u-k', poziceId: null, barva: null }]))
const smDve = [...osDve.keys()].flatMap((id, i) => dnyMesice('2026-09').map((den, d) => smena(den, id, '08:00', '16:00', { branch_id: (d + i) % 2 ? 'b2' : 'b1' })))
const mDve = sestavitExportMesice(vstup(smDve, { osoby: osDve, pobocky: dlouhePobocky }))
const pDve = cti(pdfZExportu(mDve))
const zkratkaLva = mDve.pobocky.find((p) => p.nazev === 'Restaurace U Zlatého lva').zkratka
je('12 lidí na dvou pobočkách: dlouhý název se zkrátí (iniciály)', zkratkaLva, 'RUZL')
je('… krátký název „Bar“ se vejde celý', pDve.includes('(Bar)'), true)
je('… zkratka je pod časem a vysvětlená v poznámce', [pDve.includes('(RUZL)'), pDve.includes('RUZL = Restaurace U Zlat\\351ho lva')], [true, true])
je('… celý dlouhý název pod časem není (jen v poznámce)', (pDve.match(/\(Restaurace U Zlat/g) ?? []).length, 0)
je('… stále na jedné stránce a nic nepřetéká', [(pDve.match(/\/Type \/Page /g) ?? []).length, vTiskovePlose(obdelniky(pDve))], [1, true])

// Pauza s půlhodinami se v úzkém sloupci nezkracuje výpustkou (čas s „…“ nic neříká), ale zmenšeným písmem.
const pPauza = cti(pdfZExportu(vzorek(16, () => ({ pauza_od: '14:30:00', pauza_do: '16:30:00' }))))
je('16 lidí s pauzou 14:30–16:30: čas pauzy je celý (žádná výpustka)', [pPauza.includes('14:30'), pPauza.includes('\\205')], [true, false])

// Těžká buňka (dvě směny, pobočky, pauza) jen jednou za měsíc na člověka, ale každý den u někoho: všech 15 lidí
// pohromadě má těžké řádky každý den (2 stránky), dělení po třech by dalo pět stránek — vyhrává méně papíru.
const osTezke = new Map(Array.from({ length: 15 }, (_, i) => [`t${i}`, { id: `t${i}`, jmeno: `Jméno${i} Příjmení${i}`, usekId: 'u-k', poziceId: null, barva: null }]))
const smTezke = []
;[...osTezke.keys()].forEach((id, i) => {
  dnyMesice('2026-09').forEach((den, d) => {
    const vetev = { branch_id: (d + i) % 2 ? 'b2' : 'b1' }
    if (d % 15 === i) {
      smTezke.push(smena(den, id, '08:00', '12:00', { ...vetev, pauza_od: '09:00:00', pauza_do: '10:00:00' }), smena(den, id, '18:00', '22:00', vetev))
    } else {
      smTezke.push(smena(den, id, '08:00', '16:00', vetev))
    }
  })
})
const mTezke = sestavitExportMesice(vstup(smTezke, { osoby: osTezke }))
je('15 lidí, těžká buňka každý den u někoho: lidé zůstanou pohromadě a měsíc se zlomí (2 stránky), ne 4–5 stránek po pár lidech',
  [stranPdf(mTezke), vyberRozlozeni(mTezke).casti.length], [2, 1])

const prazdne = cti(pdfZExportu(sestavitExportMesice(vstup([]))))
je('měsíc bez směn: jedna stránka s větou, ne pád', [(prazdne.match(/\/Type \/Page /g) ?? []).length, prazdne.includes('nejsou')], [1, true])

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
