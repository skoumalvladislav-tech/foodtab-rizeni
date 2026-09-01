#!/usr/bin/env node
/**
 * Peníze na obrazovce a zpátky — lib/mzdy.ts.
 *
 * Pusť `node --experimental-strip-types scripts/penize.test.mjs`.
 *
 * V databázi jsou haléře jako integer. Formulář ale píše člověk a ten
 * napíše „2 000“, „2000,50“ nebo „2000.50“ — podle toho, co má na
 * klávesnici a co je zvyklý. Chyba v tomhle převodu je chyba
 * v částce, která se vyplatila, takže se hlídá zvlášť.
 */

import { koruny, naHalere } from '../lib/mzdy.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

console.log('\n== Co lidé píšou ==')
ma('celé koruny', naHalere('2000'), 200000)
ma('s mezerou po tisících', naHalere('2 000'), 200000)
ma('s pevnou mezerou (kopie z obrazovky)', naHalere('2 000'), 200000)
ma('s čárkou', naHalere('2000,50'), 200050)
ma('s tečkou', naHalere('2000.50'), 200050)
ma('jedno desetinné místo je půlka koruny', naHalere('10,5'), 1050)
ma('nula projde jako nula', naHalere('0'), 0)

console.log('\n== Co se nemá spolknout ==')
ma('prázdno', naHalere(''), null)
ma('slovo', naHalere('dva tisíce'), null)
ma('záporná částka', naHalere('-100'), null)
ma('tři desetinná místa jsou překlep, ne haléře', naHalere('10,555'), null)
ma('dvě čárky', naHalere('1,0,0'), null)
ma('samotná čárka', naHalere(','), null)
ma('koruny v textu', naHalere('2000 Kč'), null)

console.log('\n== Tam a zpátky ==')
/*
  Předvyplněná hodnota z obrazovky se musí dát odeslat beze změny.

  Pozor na mezery: `koruny()` vrací PEVNOU mezeru (U+00A0), a to i před
  „Kč“. Odstranit měnu obyčejným `replace(' Kč', '')` proto nestačí —
  právě na tom tenhle test napoprvé spadl. Ve formuláři na to nikdo
  nenarazí, protože `naHalere` pevnou mezeru zahazuje; spadl by až
  pokus složit hodnotu ručně.
*/
const bezMeny = (s) => s.replace(/\s*Kč$/u, '')
ma('koruny(200000) → naHalere', naHalere(bezMeny(koruny(200000))), 200000)
ma('a u miliónu taky', naHalere(bezMeny(koruny(100000000))), 100000000)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
