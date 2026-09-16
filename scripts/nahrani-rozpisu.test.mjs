#!/usr/bin/env node
/**
 * Kontrola plánu nahrávání rozpisu — lib/nahrani-rozpisu.ts.
 *
 * Pusť `node --experimental-strip-types scripts/nahrani-rozpisu.test.mjs`.
 *
 * Kontroly jsou psané tak, aby ověřovaly, že něco NEJDE (docs/
 * nahravani-dat-zadani.md, oddíl Testy, bod 1 a 4 aplikovaný na rozpis):
 *
 *   * druhé spuštění téhož souboru nezaloží ani jednu směnu navíc,
 *   * neznámé jméno se nenahraje a je vypsané — import lidi nezakládá,
 *   * neznámá pobočka / nerozpoznaný čas / datum se nenahraje,
 *   * dvě směny téhož člověka na týž den a pobočku v jednom souboru se
 *     nezdvojí ani nepřepíšou navzájem — druhá se přeskočí a je vidět proč,
 *   * chybějící sloupec Pobočka se doplní výchozí pobočkou obrazovky;
 *     bez ní (firemní rozsah) se řádek přeskočí.
 */

import { casZTextu, odhadnoutMapovani, sestavPlan, POLE } from '../lib/nahrani-rozpisu.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const ZDROJE = {
  lide: [
    { id: 'z1', full_name: 'Marek Číšník' },
    { id: 'z2', full_name: 'Andrea Nováková' },
  ],
  pobocky: [
    { id: 'b1', name: 'Restaurace Černá Perla', slug: 'cerna-perla' },
    { id: 'b2', name: 'Bernard Bar Tábor', slug: 'bernard-bar' },
  ],
  smeny: [
    {
      id: 's1',
      employee_id: 'z1',
      branch_id: 'b1',
      shift_date: '2026-09-20',
      starts_at: '10:00:00',
      ends_at: '18:00:00',
    },
  ],
}

console.log('== Čas z buňky ==')
ma('dvojtečka', casZTextu('10:00'), '10:00')
ma('tečka jako oddělovač', casZTextu('9.30'), '09:30')
ma('čtyři číslice beze značky', casZTextu('1730'), '17:30')
ma('jen hodina', casZTextu('9'), '09:00')
ma('desetinné číslo dne z Excelu (0,5 = poledne)', casZTextu('0,5'), '12:00')
ma('neplatná hodina se nedomýšlí', casZTextu('25:00'), null)
ma('prázdná buňka', casZTextu(''), null)

console.log('\n== Odhad sloupců ==')
ma('běžné záhlaví', odhadnoutMapovani(['Jméno', 'Pobočka', 'Datum', 'Začátek', 'Konec']), {
  jmeno: 0,
  pobocka: 1,
  datum: 2,
  zacatek: 3,
  konec: 4,
})
ma('jiná slova', odhadnoutMapovani(['Zaměstnanec', 'Den', 'Od', 'Do']), {
  jmeno: 0,
  datum: 1,
  zacatek: 2,
  konec: 3,
})

const M = { jmeno: 0, pobocka: 1, datum: 2, zacatek: 3, konec: 4 }

console.log('\n== Šťastná cesta ==')
{
  const p = sestavPlan(
    [['Andrea Nováková', 'Restaurace Černá Perla', '21.9.2026', '10:00', '18:00']],
    M,
    ZDROJE,
    null,
  )
  ma('nová směna se založí', p.zaznamy[0].co, 'zalozit')
  ma('zapíše se na správného člověka', p.zaznamy[0].zapis.employee_id, 'z2')
  ma('zapíše se na správnou pobočku', p.zaznamy[0].zapis.branch_id, 'b1')
  ma('datum v ISO tvaru', p.zaznamy[0].zapis.shift_date, '2026-09-21')
}

console.log('\n== Existující směna se pozná (klíč: člověk + datum + pobočka) ==')
{
  // Stejná směna, beze změny — druhé spuštění nesmí založit nic navíc.
  const bezeZmeny = sestavPlan(
    [['Marek Číšník', 'Restaurace Černá Perla', '20.9.2026', '10:00', '18:00']],
    M,
    ZDROJE,
    null,
  )
  ma('druhé spuštění téhož souboru nezaloží nic navíc', bezeZmeny.zaznamy[0].co, 'beze_zmeny')
  ma('nic se nezakládá', bezeZmeny.zalozit, 0)

  // Jiný čas u téhož klíče = aktualizace, ne nová směna.
  const zmena = sestavPlan(
    [['Marek Číšník', 'Restaurace Černá Perla', '20.9.2026', '11:00', '19:00']],
    M,
    ZDROJE,
    null,
  )
  ma('jiný čas u stejné směny je aktualizace', zmena.zaznamy[0].co, 'aktualizovat')
  ma('id existující směny se použije', zmena.zaznamy[0].id, 's1')
}

console.log('\n== Čemu aplikace nerozumí, to nenahraje (oddíl B) ==')
{
  const p = sestavPlan(
    [
      ['Karel Neznámý', 'Restaurace Černá Perla', '20.9.2026', '10:00', '18:00'],
      ['Marek Číšník', 'Pobočka, co neexistuje', '20.9.2026', '10:00', '18:00'],
      ['Marek Číšník', 'Restaurace Černá Perla', '32.9.2026', '10:00', '18:00'],
      ['Marek Číšník', 'Restaurace Černá Perla', '20.9.2026', '25:99', '18:00'],
    ],
    M,
    ZDROJE,
    null,
  )
  ma('neznámé jméno — import lidi nezakládá', p.zaznamy[0].co, 'preskocit')
  ma('neznámá pobočka', p.zaznamy[1].co, 'preskocit')
  ma('neplatné datum', p.zaznamy[2].co, 'preskocit')
  ma('neplatný čas', p.zaznamy[3].co, 'preskocit')
  ma('nic z toho se nenahraje', p.zalozit + p.aktualizovat, 0)
}

console.log('\n== Dělená směna v jednom souboru se nepřepíše sama sebou ==')
{
  const p = sestavPlan(
    [
      ['Andrea Nováková', 'Restaurace Černá Perla', '21.9.2026', '08:00', '12:00'],
      ['Andrea Nováková', 'Restaurace Černá Perla', '21.9.2026', '16:00', '20:00'],
    ],
    M,
    ZDROJE,
    null,
  )
  ma('první výskyt se založí', p.zaznamy[0].co, 'zalozit')
  ma('druhý výskyt se přeskočí, ne přepíše první', p.zaznamy[1].co, 'preskocit')
  ma('jen jedna směna se založí', p.zalozit, 1)
}

console.log('\n== Pobočka: sloupec, nebo výchozí z rozsahu obrazovky ==')
{
  const bezSloupce = { jmeno: 0, datum: 1, zacatek: 2, konec: 3 }

  const sVychozi = sestavPlan(
    [['Marek Číšník', '22.9.2026', '10:00', '18:00']],
    bezSloupce,
    ZDROJE,
    'b1',
  )
  ma('bez sloupce Pobočka se použije výchozí pobočka obrazovky', sVychozi.zaznamy[0].zapis.branch_id, 'b1')

  const bezVychozi = sestavPlan(
    [['Marek Číšník', '22.9.2026', '10:00', '18:00']],
    bezSloupce,
    ZDROJE,
    null,
  )
  ma('bez sloupce a bez výchozí pobočky (firemní rozsah) se řádek přeskočí', bezVychozi.zaznamy[0].co, 'preskocit')
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
