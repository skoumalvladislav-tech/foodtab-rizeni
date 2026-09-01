#!/usr/bin/env node
/**
 * Ranní přehled majiteli — lib/ranni-prehled.ts.
 *
 * Pusť `node --experimental-strip-types scripts/ranni-prehled.test.mjs`.
 *
 * Nejdůležitější kontrola je ta poslední: v e-mailu NESMÍ být jméno.
 * E-mail leží v cizí schránce, na telefonu i v záloze poštovní služby,
 * takže osobní údaj, který se do něj dostane, z aplikace odejde nadobro.
 * Kdyby někdo příště přidal do podkladu jméno, tahle kontrola spadne.
 */

import {
  htmlPrehledu,
  nazevDne,
  predmetPrehledu,
  textPrehledu,
  vetyPobocky,
} from '../lib/ranni-prehled.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}
const obsahuje = (popis, text, co) => {
  const ok = text.includes(co)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → chybí ${JSON.stringify(co)}`}`)
}
const neobsahuje = (popis, text, co) => {
  const ok = !text.includes(co)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → našlo se ${JSON.stringify(co)}`}`)
}

const perla = {
  pobocka: 'Restaurace Černá Perla',
  lidi: 6,
  odpracovano_minut: 2835,
  rucnich_zapisu: 3,
  nedokoncenych: 0,
  zaloh: 3,
  zaloh_haleru: 650000,
  zaloh_nepotvrzenych: 1,
}

console.log('\n== Datum ==')
ma('pondělí 1. 9. 2026', nazevDne('2026-09-01'), 'úterý 1. 9.')
ma('neděle', nazevDne('2026-08-30'), 'neděle 30. 8.')
// Půlnoc v našem pásmu spadne na předchozí den — proto se počítá poledne.
ma('první den měsíce se neposune na minulý', nazevDne('2026-03-01'), 'neděle 1. 3.')

console.log('\n== Věty ==')
/*
  Pozor na mezery: hodiny i částky se skládají PEVNOU mezerou (U+00A0),
  ať se „47 h“ a „6 500 Kč“ nezalomí uprostřed. V očekáváních se proto
  píše výslovně — na tomhle test napoprvé spadl a rozdíl nebyl vidět.
*/
const NBSP = '\u00a0'
const vety = vetyPobocky(perla)
ma('odpracováno se skloňuje správně', vety[0],
  `Odpracovalo 6 lidí, 47${NBSP}h 15${NBSP}min.`)
ma('ruční zápisy taky', vety[1], '3 ruční zápisy.')
ma('zálohy včetně nepotvrzené', vety[2],
  `Zálohy: 3 výplaty, 6${NBSP}500${NBSP}Kč. 1 nepotvrzená.`)

ma('prázdný den se řekne slovem', vetyPobocky({
  ...perla, lidi: 0, odpracovano_minut: 0, rucnich_zapisu: 0, zaloh: 0,
}), ['Nikdo si nepíchl. Buď se nepracovalo, nebo se nepíchalo.'])

ma('nedokončený příchod se hlásí', vetyPobocky({
  ...perla, rucnich_zapisu: 0, zaloh: 0, nedokoncenych: 1,
})[1], '1 příchod bez odchodu — do hodin se nezapočítal.')

ma('a ve množném čísle taky', vetyPobocky({
  ...perla, rucnich_zapisu: 0, zaloh: 0, nedokoncenych: 2,
})[1], '2 příchody bez odchodu — do hodin se nezapočítaly.')

ma('prázdný den má jednu větu, ne nulu', vetyPobocky({
  pobocka: 'P', lidi: 0, odpracovano_minut: 0, rucnich_zapisu: 0,
  nedokoncenych: 0, zaloh: 0, zaloh_haleru: 0, zaloh_nepotvrzenych: 0,
}).length, 1)

console.log('\n== Předmět ==')
ma('jedna pobočka jménem', predmetPrehledu('2026-09-01', [perla]),
  'Foodtab — Restaurace Černá Perla, úterý 1. 9.')
ma('víc poboček počtem', predmetPrehledu('2026-09-01', [perla, { ...perla, pobocka: 'Bernard' }]),
  'Foodtab — úterý 1. 9., 2 pobočky')

console.log('\n== Do e-mailu nesmí jméno ==')

/*
  Tohle je ta kontrola, kvůli které tenhle soubor existuje.

  Nezkouší se, jestli v hotovém textu náhodou není jméno — to by
  neodhalilo nic, protože v podkladu dnes žádné není. Zkouší se, KTERÁ
  POLE podkladu skládání textu vůbec přečte: podstrčí se sledovaný
  objekt a vypíše se, na co sáhlo.

  Až někdo příště přidá do public.ranni_prehled sloupec se jménem
  a použije ho tady, tahle kontrola spadne — a to je celý smysl.
  E-mail leží v cizí schránce; osobní údaj, který se do něj dostane,
  z aplikace odejde nadobro.
*/
const POVOLENA_POLE = [
  'lidi',
  'nedokoncenych',
  'odpracovano_minut',
  'pobocka',
  'rucnich_zapisu',
  'zaloh',
  'zaloh_haleru',
  'zaloh_nepotvrzenych',
]

const cteno = new Set()
const sledovany = new Proxy({ ...perla }, {
  get(cil, klic) {
    if (typeof klic === 'string') cteno.add(klic)
    return cil[klic]
  },
})
textPrehledu('2026-09-01', [sledovany])
htmlPrehledu('2026-09-01', [sledovany], 'https://foodtab.cz/')

ma('e-mail sahá jen na dohodnutá pole', [...cteno].sort(), POVOLENA_POLE)

const text = textPrehledu('2026-09-01', [perla])
obsahuje('v textu je věta o tom, kde jsou jména', text, 'do e-mailu nepatří')

const html = htmlPrehledu('2026-09-01', [perla], 'https://foodtab.cz/')
obsahuje('v HTML je odkaz do aplikace', html, 'Podrobnosti v aplikaci')
obsahuje('a věta o tom, kde jsou jména', html, 'do e-mailu nepatří')
neobsahuje('a žádné „kdo“ v něm není', html, 'Číšník')

console.log('\n== Název pobočky od zákazníka ==')
const zlomyslna = htmlPrehledu('2026-09-01', [
  { ...perla, pobocka: 'Bar <script>x</script>' },
], 'https://foodtab.cz/')
neobsahuje('značky z názvu pobočky se neprovedou', zlomyslna, '<script>')
obsahuje('a projdou jako text', zlomyslna, '&lt;script&gt;')

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
