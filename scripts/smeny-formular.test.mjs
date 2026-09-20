#!/usr/bin/env node
/**
 * Pravidla formuláře nové směny (lib/smeny-formular.ts): kdy se nabízí výběr
 * zařazení a které zařazení se se směnou uloží.
 *
 * Pusť `node --experimental-strip-types scripts/smeny-formular.test.mjs`.
 */

import { ukazatZarazeni, zarazeniProUlozeni } from '../lib/smeny-formular.ts'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

console.log('\n== Kdy se nabízí výběr zařazení ==')
je('zapnuto v nastavení: nabízí se, ať je člověk vybraný, nebo ne', [ukazatZarazeni(true, true), ukazatZarazeni(true, false)], [true, true])
je('vypnuto v nastavení a člověk vybraný: schované (zbytečné klikání)', ukazatZarazeni(false, true), false)
je('vypnuto v nastavení, ale neobsazená směna (nikdo vybraný): nabízí se — pozice říká, koho je třeba', ukazatZarazeni(false, false), true)

console.log('\n== Které zařazení se uloží ==')
const u = (prepis) => zarazeniProUlozeni({ ukazano: false, vybrana: 'p-vybrana', poziceZamestnance: 'p-zam', poziceSmeny: '', ...prepis })
je('pole je vidět: uloží se, co je vybráno', zarazeniProUlozeni({ ukazano: true, vybrana: 'p-vybrana', poziceZamestnance: 'p-zam', poziceSmeny: 'p-smena' }), 'p-vybrana')
je('pole je vidět a vybráno „bez zařazení“: uloží se prázdné, ne zařazení zaměstnance', zarazeniProUlozeni({ ukazano: true, vybrana: '', poziceZamestnance: 'p-zam', poziceSmeny: '' }), '')
je('pole je schované, nová směna: zařazení zaměstnance („zařazeni od začátku“)', u({}), 'p-zam')
je('pole je schované, upravovaná směna se stejným člověkem: zařazení směny se nepřepíše', u({ poziceSmeny: 'p-smena' }), 'p-smena')
je('pole je schované, člověk se vyměnil (poziceSmeny prázdné): zařazení nového člověka', u({ poziceSmeny: '' }), 'p-zam')
je('pole je schované a zaměstnanec žádné zařazení nemá: prázdné, ne vybrané z dřívějška', u({ poziceZamestnance: null }), '')
je('pole je schované, zaměstnanec bez zařazení, ale směna ho měla: zůstane', u({ poziceZamestnance: '', poziceSmeny: 'p-smena' }), 'p-smena')
je('schované pole nikdy nevezme staré „vybrana“ (to je viditelné jen když je vidět)', u({ vybrana: 'p-stara', poziceZamestnance: 'p-zam' }), 'p-zam')

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
