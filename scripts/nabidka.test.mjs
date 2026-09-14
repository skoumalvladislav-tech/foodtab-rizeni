#!/usr/bin/env node
/**
 * Nabídka obrazovek — vede každá položka opravdu někam?
 *
 * Pusť:
 *   node scripts/nabidka.test.mjs
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE EXISTUJE
 *
 * `hotovo: true` znamená „adresa vede na vykreslenou stránku". Je to
 * ruční příznak — nikdo ho nekontroluje proti souborům. Stačí položku
 * přidat dřív, než vznikne obrazovka, a v levém sloupci je odkaz na
 * 404. Vypadá to jako rozbitá aplikace, ne jako nedodělek.
 *
 * Opačný směr se nehlídá schválně: obrazovka bez položky v nabídce je
 * běžná (podstránky jako `marketing/novy` nebo `smeny/[den]` tam nemají
 * co dělat).
 *
 * ---------------------------------------------------------------------
 * ČTE SE JAKO TEXT, NE IMPORTEM
 *
 * `nabidka.ts` importuje přes alias `@/lib`, který Node bez sestavení
 * neumí. Čte se proto zdroj — stejně jako v `scripts/marketing.test.mjs`,
 * kde se ověřuje, že obrazovka opravdu volá funkci databáze.
 */

import { existsSync, readFileSync } from 'node:fs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const zdroj = readFileSync('app/[rozsah]/nabidka.ts', 'utf8')

/*
  Bere se jen pole NABIDKA, ne nastavení pod ním: nastavení má vlastní
  seznam a vlastní pravidla.
*/
const zacatek = zdroj.indexOf('export const NABIDKA')
const konec = zdroj.indexOf('\n]', zacatek)
const telo = zdroj.slice(zacatek, konec)

const polozky = [...telo.matchAll(/\{\s*segment:\s*'([^']+)'[^}]*\}/g)].map((m) => ({
  segment: m[1],
  radek: m[0],
  hotovo: /hotovo:\s*true/.test(m[0]),
  maAdresu: /adresa:/.test(m[0]),
}))

console.log('\n== Nabídka se vůbec přečetla ==')

ok('našly se položky', polozky.length > 10)
ok('a je mezi nimi Docházka', polozky.some((p) => p.segment === 'dochazka'))
ok('a marketingové obrazovky', polozky.some((p) => p.segment === 'marketing/media'))

console.log('\n== Každá hotová položka vede na stránku ==')

for (const p of polozky) {
  if (!p.hotovo || p.maAdresu) continue
  const cesta = `app/[rozsah]/${p.segment}/page.tsx`
  ok(`${p.segment} → ${cesta}`, existsSync(cesta))
}

console.log('\n== Chystané položky stránku mít nemusí ==')

const chystane = polozky.filter((p) => !p.hotovo)
ok('nějaké chystané v nabídce jsou', chystane.length > 0)
ok('a žádná z nich se netváří jako hotová',
  chystane.every((p) => !/hotovo:\s*true/.test(p.radek)))

console.log('\n== Marketing má v sloupci víc než jednu položku ==')

/*
  Do 14. 9. 2026 měl marketing jedinou položku a fotky, šablony ani menu
  se v levém sloupci neobjevily — daly se najít jen odkazem z přehledu.
  Tahle kontrola hlídá, aby se to nevrátilo.
*/
const marketingove = polozky.filter((p) => p.segment.startsWith('marketing'))
ok('marketing má aspoň sedm obrazovek', marketingove.length >= 7)
ok('a je mezi nimi fronta ke schválení',
  polozky.some((p) => p.segment === 'marketing/schvalovani'))
ok('a kalendář obsahu',
  polozky.some((p) => p.segment === 'marketing/kalendar'))
ok('a všechny jsou hotové', marketingove.every((p) => p.hotovo))

console.log('\n== Pořadí: nejdřív podrobnější segment ==')

/*
  Rám hledá aktivní položku prvním shodným segmentem
  (`app/[rozsah]/ram.tsx`). Kdyby `marketing` stál před
  `marketing/media`, zvýraznil by se při otevřených Fotkách „Příspěvky".
  Drobnost — ale přesně ta, které si člověk všimne a nepozná proč.
*/
const iPrehled = polozky.findIndex((p) => p.segment === 'marketing')
const iPodstranky = polozky
  .map((p, i) => (p.segment.startsWith('marketing/') ? i : -1))
  .filter((i) => i >= 0)

ok('podstránky marketingu stojí před přehledem',
  iPodstranky.length > 0 && iPodstranky.every((i) => i < iPrehled))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
