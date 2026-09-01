#!/usr/bin/env node
/**
 * Zkrácení adresy — lib/adresa.ts.
 *
 * Pusť `node --experimental-strip-types scripts/adresa.test.mjs`.
 *
 * Zkrácená adresa jde na obrazovku, kterou může někdo číst přes rameno.
 * Kdyby se z ní dalo přečíst celé jméno, je zkracování k ničemu — a to
 * je jediné, k čemu je.
 */

import { zkratitAdresu } from '../lib/adresa.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

console.log('\n== Běžné adresy ==')
ma('dlouhé jméno', zkratitAdresu('ladislav@seznam.cz'), 'l…v@seznam.cz')
ma('krátké jméno', zkratitAdresu('ab@seznam.cz'), 'a…@seznam.cz')
ma('tři znaky', zkratitAdresu('abc@seznam.cz'), 'a…@seznam.cz')
ma('čtyři znaky se už zkracují s koncem', zkratitAdresu('abcd@x.cz'), 'a…d@x.cz')
ma('doména zůstává celá', zkratitAdresu('skoumalvladislav@gmail.com'), 's…v@gmail.com')
ma('tečka ve jménu se schová taky', zkratitAdresu('jan.novak@firma.cz'), 'j…k@firma.cz')

console.log('\n== Co se nesmí pokazit ==')
ma('prázdno', zkratitAdresu(''), null)
ma('null', zkratitAdresu(null), null)
ma('undefined', zkratitAdresu(undefined), null)
ma('bez zavináče', zkratitAdresu('nesmysl'), null)
ma('zavináč na začátku', zkratitAdresu('@seznam.cz'), null)
// Jméno je tu 'a@b', tedy tři znaky — zkracuje se jako každé krátké.
ma('víc zavináčů — dělí se u posledního',
  zkratitAdresu('a@b@seznam.cz'), 'a…@seznam.cz')

console.log('\n== Celé jméno se z toho nesmí dát přečíst ==')
// Tohle je celý smysl. Kdyby zkracování vracelo víc než první
// a poslední písmeno, přestává dávat smysl.
const dlouha = 'ladislavnovakskoumal@seznam.cz'
const zkracena = zkratitAdresu(dlouha)
ma('ze zkrácené se nedá složit původní', zkracena.includes('ladislav'), false)
ma('a je opravdu kratší', zkracena.length < dlouha.length, true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
