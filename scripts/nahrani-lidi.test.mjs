#!/usr/bin/env node
/**
 * Kontrola plánu nahrávání lidí — lib/nahrani-lidi.ts.
 *
 * Pusť `node --experimental-strip-types scripts/nahrani-lidi.test.mjs`.
 *
 * Kontroly jsou psané tak, aby ověřovaly, že něco NEJDE:
 *
 *   * druhé spuštění téhož souboru nezaloží ani jeden řádek navíc,
 *   * neznámá pobočka řádek nenahraje a je vypsaný,
 *   * neznámý typ poměru se nedomýšlí,
 *   * prázdná buňka nesmaže, co je v databázi,
 *   * „Novák“ a „Novak“ jsou dva lidé, přesně jako v databázi.
 *
 * Že šťastná cesta funguje, se pozná i bez testu — ale je tu taky,
 * protože náhled musí sedět na to, co se pak opravdu zapíše.
 */

import { datumZTextu, odhadnoutMapovani, sestavPlan, POLE } from '../lib/nahrani-lidi.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const ZDROJE = {
  lide: [
    {
      id: 'z1',
      full_name: 'Marek Číšník',
      branch_id: 'b1',
      position_id: 'p1',
      employment_type: 'hpp',
      started_on: '2026-01-15',
    },
    {
      id: 'z2',
      full_name: 'Andrea Nováková',
      branch_id: null,
      position_id: null,
      employment_type: 'dpp',
      started_on: null,
    },
  ],
  pobocky: [
    { id: 'b1', name: 'Restaurace Černá Perla', slug: 'cerna-perla' },
    { id: 'b2', name: 'Bernard Bar Tábor', slug: 'bernard-bar' },
  ],
  pozice: [
    { id: 'p1', label: 'Číšník', active: true },
    { id: 'p2', label: 'Kuchař', active: false },
  ],
}

console.log('== Odhad sloupců ==')
ma('běžné záhlaví', odhadnoutMapovani(['Jméno', 'Pobočka', 'Pozice', 'Úvazek', 'Nástup']), {
  jmeno: 0,
  pobocka: 1,
  pozice: 2,
  typ: 3,
  nastup: 4,
})
ma('datum nástupu i jinými slovy', odhadnoutMapovani(['Jméno', 'Datum nástupu']), {
  jmeno: 0,
  nastup: 1,
})
ma('jiné pořadí a jiná slova', odhadnoutMapovani(['Provozovna', 'Funkce', 'Zaměstnanec']), {
  jmeno: 2,
  pobocka: 0,
  pozice: 1,
})
ma('přesná shoda vyhrává nad částečnou', odhadnoutMapovani(['Jméno pobočky', 'Jméno']), {
  jmeno: 1,
  pobocka: 0,
})
ma('co se nepozná, zůstane nepřiřazené', odhadnoutMapovani(['Jméno', 'Rodné číslo']), {
  jmeno: 0,
})
ma('jeden sloupec se nepřiřadí dvakrát', odhadnoutMapovani(['Jméno']), { jmeno: 0 })
ma('všechna pole mají nápovědu', POLE.every((p) => p.napoveda.length > 10), true)

const M = { jmeno: 0, pobocka: 1, pozice: 2, typ: 3 }

console.log('\n== Založení a aktualizace ==')
{
  const p = sestavPlan(
    [
      ['Eva Dvořáková', 'Bernard Bar Tábor', 'Číšník', 'HPP'],
      ['Marek Číšník', 'Bernard Bar Tábor', 'Číšník', 'HPP'],
    ],
    M,
    ZDROJE,
  )
  ma('nový se založí', [p.zalozit, p.zaznamy[0].co], [1, 'zalozit'])
  ma('známý se aktualizuje', [p.aktualizovat, p.zaznamy[1].co], [1, 'aktualizovat'])
  ma('a je vidět co se mění', p.zaznamy[1].zmeny, [
    { pole: 'Pobočka', z: 'Restaurace Černá Perla', na: 'Bernard Bar Tábor' },
  ])
  ma('pobočka se pozná i podle názvu', p.zaznamy[0].zapis.branch_id, 'b2')
  ma('číslo řádku je to z Excelu', [p.zaznamy[0].cislo, p.zaznamy[1].cislo], [2, 3])
}

console.log('\n== Druhé spuštění téhož souboru ==')
{
  const soubor = [
    ['Marek Číšník', 'Restaurace Černá Perla', 'Číšník', 'HPP'],
    ['Andrea Nováková', '', '', 'DPP'],
  ]
  const p = sestavPlan(soubor, M, ZDROJE)
  ma('nic se nezaloží', p.zalozit, 0)
  ma('a nic se ani neaktualizuje', p.aktualizovat, 0)
  ma('všechno je beze změny', p.bezeZmeny, 2)
  ma('žádný zápis se nechystá', p.zaznamy[0].zmeny, [])
}

console.log('\n== Prázdná buňka nemaže ==')
{
  const p = sestavPlan([['Marek Číšník', '', '', '']], M, ZDROJE)
  ma('beze změny', p.zaznamy[0].co, 'beze_zmeny')
  ma('do zápisu nejde nic', p.zaznamy[0].zapis, {})
}
{
  // Tabulka, ve které sloupec Pozice vůbec není.
  const p = sestavPlan([['Marek Číšník', 'Bernard Bar Tábor']], { jmeno: 0, pobocka: 1 }, ZDROJE)
  ma('nepřiřazený sloupec se netýká zápisu', Object.keys(p.zaznamy[0].zapis), ['branch_id'])
}

console.log('\n== Čemu aplikace nerozumí ==')
{
  const p = sestavPlan(
    [
      ['Petr Nový', 'Náměstí', 'Číšník', 'HPP'],
      ['', 'Bernard Bar Tábor', 'Číšník', 'HPP'],
      ['Marek Číšník', '', '', ''],
      ['marek číšník', '', '', ''],
    ],
    M,
    ZDROJE,
  )
  ma('neznámá pobočka řádek zastaví', [p.zaznamy[0].co, p.zaznamy[0].duvod], [
    'preskocit',
    'pobočku „Náměstí“ neznám',
  ])
  ma('prázdné jméno taky', [p.zaznamy[1].co, p.zaznamy[1].duvod], ['preskocit', 'prázdné jméno'])
  ma('stejné jméno podruhé v souboru', [p.zaznamy[3].co, p.zaznamy[3].duvod], [
    'preskocit',
    'stejné jméno je už na řádku 4',
  ])
  ma('přeskočené se počítají', p.preskocit, 3)
}

console.log('\n== Typ poměru se nedomýšlí ==')
{
  const p = sestavPlan(
    [
      ['Petr Nový', '', '', 'brigáda'],
      ['Pavel Nový', '', '', 'dohoda o provedení práce'],
      ['Jana Nová', '', '', ''],
    ],
    M,
    ZDROJE,
  )
  ma('neznámý poměr skončí jako Jiné', p.zaznamy[0].zapis.employment_type, 'jine')
  ma('a je to vypsané', p.zaznamy[0].poznamky, ['typ „brigáda“ neznám, uloží se jako Jiné'])
  ma('celý název se pozná', p.zaznamy[1].zapis.employment_type, 'dpp')
  ma('bez sloupce se nezakládá HPP', p.zaznamy[2].zapis.employment_type, 'jine')
  ma('a i to je vypsané', p.zaznamy[2].poznamky, [
    'typ poměru v tabulce není, uloží se jako Jiné',
  ])
}

console.log('\n== Pozice ==')
{
  const p = sestavPlan(
    [
      ['Petr Nový', '', 'Barman', ''],
      ['Pavel Nový', '', 'barman', ''],
      ['Jana Nová', '', 'Kuchař', ''],
      ['Iva Nová', '', 'číšník', ''],
    ],
    M,
    ZDROJE,
  )
  ma('nová pozice se založí jednou, i když ji mají dva', p.novePozice, ['Barman'])
  ma('vyřazená pozice se přiřadí a řekne se to', p.zaznamy[2].poznamky[0],
    'pozice Kuchař je vyřazená z nabídky, přiřadí se i tak')
  ma('malá písmena se u pozice srovnají jako v databázi', p.zaznamy[3].zapis.position_id, 'p1')
  ma('„barman“ a „Barman“ je jedna nová pozice', p.zaznamy[1].zapis.novaPozice, 'barman')
}

console.log('\n== Nástup ==')
ma('české datum', datumZTextu('1.9.2026'), '2026-09-01')
ma('české datum s mezerami', datumZTextu('1. 9. 2026'), '2026-09-01')
ma('datum ze sešitu už přišlo jako RRRR-MM-DD', datumZTextu('2026-09-01'), '2026-09-01')
// 3/4/2026 je v české tabulce 3. dubna a v anglické 4. března. Uhodnout
// se to nedá a špatný nástup posune odpracované měsíce.
ma('lomítka se nehádají', datumZTextu('3/4/2026'), null)
ma('dvouciferný rok se nedohaduje', datumZTextu('1.9.26'), null)
ma('neexistující den neprojde', datumZTextu('31.2.2026'), null)
ma('text neprojde', datumZTextu('nástup na jaře'), null)
{
  const MN = { jmeno: 0, nastup: 1 }
  const p = sestavPlan(
    [
      ['Petr Nový', '1. 9. 2026'],
      ['Marek Číšník', '2026-03-01'],
      ['Andrea Nováková', 'někdy na jaře'],
      ['Eva Nová', ''],
    ],
    MN,
    ZDROJE,
  )
  ma('u nového se datum zapíše', p.zaznamy[0].zapis.started_on, '2026-09-01')
  ma('u známého je vidět změna', p.zaznamy[1].zmeny, [
    { pole: 'Nástup', z: '2026-01-15', na: '2026-03-01' },
  ])
  ma('nesrozumitelné datum člověka neztratí', p.zaznamy[2].co, 'beze_zmeny')
  ma('a je vypsané', p.zaznamy[2].poznamky[0], 'datum „někdy na jaře“ neznám, nástup nechám prázdný')
  ma('prázdná buňka datum nemaže', p.zaznamy[3].zapis.started_on, undefined)
}

console.log('\n== Klíč sedí na databázi ==')
{
  // Rozpoznávací klíč z oddílu A je lower(btrim(...)), s diakritikou.
  // „Novak“ je proto jiný člověk než „Nováková“ i než „Novák“.
  const p = sestavPlan(
    [
      ['  marek číšník  ', '', '', ''],
      ['Andrea Novakova', '', '', ''],
    ],
    M,
    ZDROJE,
  )
  ma('mezery a velikost písmen se srovnají', p.zaznamy[0].co, 'beze_zmeny')
  ma('bez diakritiky je to jiný člověk', p.zaznamy[1].co, 'zalozit')
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
