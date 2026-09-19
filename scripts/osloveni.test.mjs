#!/usr/bin/env node
/**
 * Oslovení v 5. pádu (lib/osloveni.ts).
 *
 * Pusť `node --experimental-strip-types scripts/osloveni.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 * Dvě věci a obě jsou stejně důležité: že běžná česká jména dostanou
 * správný tvar, A ŽE JMÉNO, NA KTERÉ PRAVIDLO NESEDÍ, ZŮSTANE BEZE ZMĚNY.
 * Druhá polovina je ta, která chrání před trapasem — špatně skloněné
 * jméno je horší než neskloněné.
 */

import { osloveni } from '../lib/osloveni.ts'

let chyb = 0
const ma = (vstup, ocekavane) => {
  const skutecne = osloveni(vstup)
  const ok = skutecne === ocekavane
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${JSON.stringify(vstup)} → ${JSON.stringify(skutecne)}${ok ? '' : ` (čekáno ${JSON.stringify(ocekavane)})`}`)
}

console.log('\n== Mužská jména ==')
ma('Vladislav', 'Vladislave')
ma('Jan', 'Jane')
ma('Martin', 'Martine')
ma('Jakub', 'Jakube')
ma('Michal', 'Michale')
ma('Petr', 'Petře')
ma('Viktor', 'Viktore')
ma('Marek', 'Marku')
ma('Zdeněk', 'Zdeňku')
ma('Luděk', 'Luďku')
ma('Erik', 'Eriku')
ma('Tomáš', 'Tomáši')
ma('Ondřej', 'Ondřeji')
ma('Karel', 'Karle')
ma('Pavel', 'Pavle')

console.log('\n== Ženská jména ==')
ma('Hana', 'Hano')
ma('Jana', 'Jano')
ma('Lucie', 'Lucie')
ma('Marie', 'Marie')

console.log('\n== Co se NESKLOŇUJE ==')
ma('Jiří', 'Jiří')
ma('Daniel', 'Daniel')
ma('Anna-Marie', 'Anna-Marie')
ma('Jan Novák', 'Jan Novák')
ma('J.', 'J.')

console.log('\n== Prázdné vstupy ==')
ma('', '')
ma('   ', '')
ma(null, '')
ma(undefined, '')

console.log(chyb === 0 ? '\nVšechno sedí.' : `\n${chyb} chyb.`)
process.exit(chyb === 0 ? 0 : 1)
