#!/usr/bin/env node
/**
 * Skloňování po číslovce — lib/sklonovani.ts.
 *
 * Pusť `node --experimental-strip-types scripts/sklonovani.test.mjs`.
 *
 * Aplikace psala „2 záznamů“ a „2 příchodů“. Vypadá to jako strojový
 * překlad a všimne si toho každý, kdo umí česky — tedy každý zákazník.
 * Tvary pro 2 až 4 se proto hlídají zvlášť: právě ty se zapomínají.
 */

import { pocet, prisudek, sklonovat } from '../lib/sklonovani.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const Z = ['záznam', 'záznamy', 'záznamů']

console.log('\n== Tři tvary ==')
ma('1 → jednotné číslo', pocet(1, ...Z), '1 záznam')
ma('2 → množné, 1. pád', pocet(2, ...Z), '2 záznamy')
ma('3 → množné, 1. pád', pocet(3, ...Z), '3 záznamy')
ma('4 → množné, 1. pád', pocet(4, ...Z), '4 záznamy')
ma('5 → množné, 2. pád', pocet(5, ...Z), '5 záznamů')
ma('0 → množné, 2. pád', pocet(0, ...Z), '0 záznamů')
ma('11 → množné, 2. pád', pocet(11, ...Z), '11 záznamů')

console.log('\n== Složená čísla ==')
ma('21 je spisovně „záznamů“, ne „záznam“', pocet(21, ...Z), '21 záznamů')
ma('22 taky', pocet(22, ...Z), '22 záznamů')
ma('101 taky', pocet(101, ...Z), '101 záznamů')

console.log('\n== Záporná ==')
ma('−1 se řídí absolutní hodnotou', pocet(-1, 'hodina', 'hodiny', 'hodin'), '-1 hodina')
ma('−2 taky', pocet(-2, 'hodina', 'hodiny', 'hodin'), '-2 hodiny')

console.log('\n== Samotný tvar a přísudek ==')
ma('sklonovat vrací jen slovo', sklonovat(3, 'příchod', 'příchody', 'příchodů'), 'příchody')
/*
  Přísudek má TŘI tvary, ne dva. U pěti a víc přechází čeština zpátky
  do jednotného čísla — „5 záznamů nejsou dokončené“ zní jako strojový
  překlad úplně stejně jako „2 záznamů“. Nejdřív to tady bylo na dva
  tvary a přesně tahle chyba z toho vypadla na obrazovku.
*/
const P = ['není dokončený', 'nejsou dokončené', 'není dokončených']
ma('přísudek u jednoho', prisudek(1, ...P), 'není dokončený')
ma('přísudek u dvou', prisudek(2, ...P), 'nejsou dokončené')
ma('přísudek u čtyř', prisudek(4, ...P), 'nejsou dokončené')
ma('přísudek u pěti se vrací k jednotnému', prisudek(5, ...P), 'není dokončených')
ma('a u nuly taky', prisudek(0, ...P), 'není dokončených')
ma('bez třetího tvaru se použije první', prisudek(5, 'čeká', 'čekají'), 'čeká')

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
