#!/usr/bin/env node
/**
 * Upozornění — texty na obrazovce.
 *
 * Pusť `node --experimental-strip-types scripts/upozorneni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO TO OVĚŘUJE A CO NE
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 2 je na tomhle
 * výslovné: „První je úkol, druhé je informace. NESMÍ VYPADAT STEJNĚ.“
 * Kdo čeká na oprávnění, a kdo ho už má, se musí poznat na první
 * pohled, ne až z odstavce pod nadpisem.
 *
 * Že se upozornění vůbec založí a komu, hlídá scénář
 * `supabase/tests/krok12_scenar.sql`. Tady jde jen o věty.
 *
 * Obrazovka `app/[rozsah]/upozorneni/page.tsx` je serverová komponenta
 * s dotazy do databáze a vykreslit se mimo aplikaci nedá. Proto je
 * poslední kontrola v souboru o tom, že ty funkce OPRAVDU VOLÁ —
 * jinak by se ověřovalo něco, co na obrazovku nevede.
 */

import fs from 'node:fs'

import { nadpisUpozorneni, popisOpravneni } from '../lib/upozorneni-text.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const obdobi = (od, doKdy) => `${od ?? ''} – ${doKdy ?? ''}`

console.log('\n== Úkol a informace nevypadají stejně ==')

const ceka = { jmeno: 'Láďa', kdo: 'u1', ceka: true, role: null, pobocky: [] }
const ma_ = {
  jmeno: 'Láďa',
  kdo: 'u1',
  ceka: false,
  role: 'Servis',
  pobocky: ['Restaurace Černá Perla'],
}

const nadpisCeka = nadpisUpozorneni('pozvanka.prijata', ceka, obdobi)
const nadpisMa = nadpisUpozorneni('pozvanka.prijata', ma_, obdobi)

ma('kdo čeká, to má v nadpisu', nadpisCeka, 'Láďa přijal pozvánku a čeká na oprávnění')
ma('kdo nečeká, má nadpis kratší', nadpisMa, 'Láďa přijal pozvánku')
ma('a nejsou to tytéž nadpisy', nadpisCeka === nadpisMa, false)

ma(
  'oprávnění je vypsané, ne jen „má“',
  popisOpravneni(ma_),
  'Má oprávnění Servis, Restaurace Černá Perla.',
)
ma('bez role a poboček se nic nevymýšlí', popisOpravneni(ceka), 'Oprávnění už má.')

console.log('\n== Ostatní druhy zůstávají ==')

ma(
  'rozpis',
  nadpisUpozorneni('rozpis.vydan', { od: 'po', do: 'ne' }, obdobi),
  'Rozpis po – ne',
)
ma(
  'přidělené oprávnění',
  nadpisUpozorneni('opravneni.prideleno', {}, obdobi),
  'Máte přidělené oprávnění',
)

/*
  Neznámý druh se nesmí zamlčet. Kdyby se vrátil prázdný řetězec,
  upozornění by na obrazovce vypadalo jako prázdný rámeček a nikdo by
  nevěděl, že něco přišlo.
*/
ma('neznámý druh se nezamlčí', nadpisUpozorneni('neco.noveho', {}, obdobi), 'Upozornění')

console.log('\n== Chybějící jméno nesmí dát „undefined“ ==')

ma(
  'bez jména se řekne „Někdo“',
  nadpisUpozorneni('pozvanka.prijata', { ceka: true }, obdobi),
  'Někdo přijal pozvánku a čeká na oprávnění',
)

console.log('\n== Obrazovka ty funkce opravdu volá ==')

const stranka = fs.readFileSync(
  new URL('../app/[rozsah]/upozorneni/page.tsx', import.meta.url),
  'utf8',
)
ma('nadpis se bere z lib/upozorneni-text',
  stranka.includes('nadpisUpozorneni(z.druh, z.telo, obdobi)'), true)
ma('a popis oprávnění taky', stranka.includes('popisOpravneni(z.telo)'), true)
ma('vlastní kopie na obrazovce nezůstala',
  stranka.includes('function nadpisZpravy'), false)

console.log('\n== A o pushi se nikde nepíše ==')

/*
  Zadání, oddíl 4: „Nepiš do rozhraní, že push chodí, dokud nechodí.“
  Prochází se obrazovky, kterých se to týká.
*/
const KOREN = new URL('..', import.meta.url)
const soubory = [
  'app/moje-udaje/page.tsx',
  'app/[rozsah]/upozorneni/page.tsx',
  'app/[rozsah]/ceka-na-opravneni.tsx',
]
for (const f of soubory) {
  const text = fs.readFileSync(new URL(f, KOREN), 'utf8')
  /*
    Kouká se jen na text, který se vykresluje: komentáře jdou pryč
    (zmínka o tom, že push NEchodí, je v pořádku) a s nimi i volání
    `.push(` — metoda pole není slib uživateli. Tohle si vysloužilo
    komentář tím, že to napoprvé shodilo kontrolu na
    `posluchaci.push(zmena)`.
  */
  const vykreslene = text
    .split('\n')
    .filter((r) => !r.trimStart().startsWith('*') && !r.trimStart().startsWith('//'))
    .join('\n')
    .split('.push(')
    .join('.pridat(')
  ma(`${f} neslibuje push`, /\bpush\b/i.test(vykreslene), false)
}

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
