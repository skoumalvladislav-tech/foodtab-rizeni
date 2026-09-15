#!/usr/bin/env node
/**
 * `lib/faktury-filtry.ts` — sdílené filtry nad `invoices`, používá je
 * Seznam i CSV export (`/api/faktury/export`). Regrese tady by potichu
 * rozbila oboje najednou, proto vlastní test na čistou logiku, ne jen
 * end-to-end kontrolu jedné obrazovky.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/faktury-filtry.test.mjs
 */

import { escapovatHledani, pouzitFiltry } from '../lib/faktury-filtry.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano), `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

function faloveVolani() {
  const volani = []
  const proxy = {
    eq: (pole, hodnota) => { volani.push(['eq', pole, hodnota]); return proxy },
    neq: (pole, hodnota) => { volani.push(['neq', pole, hodnota]); return proxy },
    gte: (pole, hodnota) => { volani.push(['gte', pole, hodnota]); return proxy },
    lt: (pole, hodnota) => { volani.push(['lt', pole, hodnota]); return proxy },
    or: (vyraz) => { volani.push(['or', vyraz]); return proxy },
  }
  return { proxy, volani }
}

const zakladniFiltry = { archiv: false, kontrola: false, hledat: '', duplicity: false }

console.log('\nescapovatHledani')
ma('escapuje zpětné lomítko, %, _ a uvozovky (v tomhle pořadí)', escapovatHledani('50%_off"'), '50\\%\\_off\\"')
ma('prázdný řetězec beze změny', escapovatHledani(''), '')
ma('obyčejný text beze změny', escapovatHledani('Bidfood'), 'Bidfood')

console.log('\npouzitFiltry — výchozí (bez archivu)')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry })
  ma('nastaví is_archived na false', volani[0], ['eq', 'is_archived', false])
  ma('vyloučí odmítnuté, dokud nejsou explicitně vybrané', volani[1], ['neq', 'status', 'Odmítnuto'])
  ma('žádné další volání', volani.length, 2)
}

console.log('\npouzitFiltry — archiv')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, archiv: true })
  ma('nastaví is_archived na true', volani[0], ['eq', 'is_archived', true])
  ok('v archivu se odmítnuté NEVYLUČUJÍ', !volani.some((v) => v[0] === 'neq'))
}

console.log('\npouzitFiltry — stav "Odmítnuto" sám o sobě odmítnuté nevylučuje, ale filtruje na ně')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, stav: 'Odmítnuto' })
  ok('žádné neq(status, Odmítnuto)', !volani.some((v) => v[0] === 'neq' && v[1] === 'status'))
  ma('eq(status, Odmítnuto) místo toho', volani.find((v) => v[0] === 'eq' && v[1] === 'status'), ['eq', 'status', 'Odmítnuto'])
}

console.log('\npouzitFiltry — kontrola vyhrává nad stav (vzájemně se vylučují)')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, kontrola: true, stav: 'Uhrazeno' })
  ma('eq(needs_review, true)', volani.find((v) => v[0] === 'eq' && v[1] === 'needs_review'), ['eq', 'needs_review', true])
  ok('stav se ignoruje', !volani.some((v) => v[1] === 'status' && v[0] === 'eq'))
}

console.log('\npouzitFiltry — měsíc (rozsah DUZP)')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, mesic: '2026-03' })
  ma('od 1. dne měsíce', volani.find((v) => v[0] === 'gte'), ['gte', 'duzp', '2026-03-01'])
  ma('do 1. dne dalšího měsíce', volani.find((v) => v[0] === 'lt'), ['lt', 'duzp', '2026-04-01'])
}
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, mesic: '2026-12' })
  ma('prosinec přetéká do ledna dalšího roku', volani.find((v) => v[0] === 'lt'), ['lt', 'duzp', '2027-01-01'])
}

console.log('\npouzitFiltry — dodavatel, hledat, duplicity')
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, dodavatel: 'Bidfood Czech Republic' })
  ma('eq(supplier, ...)', volani.find((v) => v[0] === 'eq' && v[1] === 'supplier'), ['eq', 'supplier', 'Bidfood Czech Republic'])
}
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, hledat: 'a%b' })
  const orVolani = volani.find((v) => v[0] === 'or')
  ok('or() obsahuje escapované % v každém ze 4 sloupců', orVolani && orVolani[1].split(',').every((cast) => cast.includes('a\\%b')))
  ma('přesně 4 ilike podmínky', orVolani[1].split(',').length, 4)
}
{
  const { proxy, volani } = faloveVolani()
  pouzitFiltry(proxy, { ...zakladniFiltry, duplicity: true })
  ma('eq(is_duplicate, true)', volani.find((v) => v[0] === 'eq' && v[1] === 'is_duplicate'), ['eq', 'is_duplicate', true])
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
