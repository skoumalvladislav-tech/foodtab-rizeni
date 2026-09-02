#!/usr/bin/env node
/**
 * QR kód — lib/qr.ts.
 *
 * Pusť `node --experimental-strip-types scripts/qr.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TO DEKÓDUJE, A NE JEN POROVNÁVÁ
 *
 * QR kód nemá smysl kontrolovat tím, že „nějaké SVG vzniklo“. Jediné,
 * na čem záleží, je jestli ho čtečka přečte a jestli v něm je to, co
 * tam být má — a to se ověří jedině přečtením.
 *
 * Čte se NEZÁVISLOU knihovnou (jsqr), ne tou, která kód vyrobila.
 * Kdyby se použila táž, ověřilo by se jen to, že si sama rozumí.
 *
 * jsqr chce pole obrazových bodů, ne SVG. SVG se proto rozebere zpátky
 * na mřížku modulů — a právě proto se v lib/qr.ts kreslí každý modul
 * jako samostatný čtverec, ne jako slepená cesta.
 */

import jsQR from 'jsqr'

import { qrSvg } from '../lib/qr.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/** Z našeho SVG udělá obrazové body, které umí přečíst jsqr. */
function naBody(svg, zvetseni = 4) {
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  if (!viewBox) throw new Error('SVG nemá viewBox')
  const celkem = Number(viewBox[1])

  const tmave = new Set()
  for (const m of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    tmave.add(`${m[1]},${m[2]}`)
  }

  const sirka = celkem * zvetseni
  const data = new Uint8ClampedArray(sirka * sirka * 4)

  for (let y = 0; y < sirka; y++) {
    for (let x = 0; x < sirka; x++) {
      const bunkaX = Math.floor(x / zvetseni)
      const bunkaY = Math.floor(y / zvetseni)
      const cerna = tmave.has(`${bunkaX},${bunkaY}`)
      const i = (y * sirka + x) * 4
      const v = cerna ? 0 : 255
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }

  return { data, sirka }
}

function precti(text, volby) {
  const svg = qrSvg(text, volby)
  const { data, sirka } = naBody(svg)
  const v = jsQR(data, sirka, sirka)
  return v?.data ?? null
}

console.log('\n== Co se do QR dá, to se z něj přečte ==')

ma('krátká adresa', precti('https://foodtab.cz/kiosek'), 'https://foodtab.cz/kiosek')

ma(
  'adresa s měnícím se kódem pobočky',
  precti('https://foodtab.cz/pichnout?kod=A1B2C3D4'),
  'https://foodtab.cz/pichnout?kod=A1B2C3D4',
)

ma(
  'dlouhá adresa s doménou i cestou',
  precti('https://rizeni.foodtab.cz/cerna-perla/dochazka?kod=DEADBEEF&druh=in'),
  'https://rizeni.foodtab.cz/cerna-perla/dochazka?kod=DEADBEEF&druh=in',
)

ma('diakritika projde', precti('https://foodtab.cz/černá-perla'), 'https://foodtab.cz/černá-perla')

console.log('\n== Vyšší oprava chyb čitelnost nezhorší ==')
for (const oprava of ['L', 'M', 'Q', 'H']) {
  ma(`úroveň ${oprava}`, precti('https://foodtab.cz/kiosek', { oprava }), 'https://foodtab.cz/kiosek')
}

console.log('\n== Obrázek sám ==')
const svg = qrSvg('https://foodtab.cz/kiosek', { velikost: 240, popis: 'Kiosek' })
ma('má zadanou velikost', /width="240" height="240"/.test(svg), true)
ma('má bílý podklad — na tmavém motivu by čtečka nic nenašla',
  svg.includes('fill="#ffffff"'), true)
ma('a černé moduly', svg.includes('fill="#000000"'), true)
ma('popis pro odečítač', svg.includes('aria-label="Kiosek"'), true)

// Tichá zóna: čtyři moduly kolem dokola. Bez ní čtečka nepozná, kde kód
// začíná. Pozná se podle toho, že žádný modul nesahá k okraji viewBoxu.
const celkem = Number(svg.match(/viewBox="0 0 (\d+)/)[1])
const souradnice = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
])
const nejmensi = Math.min(...souradnice.flat())
const nejvetsi = Math.max(...souradnice.flat())
ma('tichá zóna nahoře a vlevo', nejmensi >= 4, true)
ma('tichá zóna dole a vpravo', nejvetsi <= celkem - 5, true)

console.log('\n== A že to umí spadnout ==')
// Kdyby se do QR dostalo něco jiného, než co jsme tam dali, tenhle
// řádek by prošel taky — proto se zkouší i nesouhlas.
ma('přečtený text se porovnává, ne jen že něco vzniklo',
  precti('https://foodtab.cz/kiosek') === 'https://foodtab.cz/jine', false)

console.log('\n== Odkaz z kiosku: pobočka a nic navíc ==')

/*
  Zadání docs/qr-na-kiosku-zadani.md, oddíl 5: kromě dekódování ověřit
  i to, že se v adrese objevila SPRÁVNÁ POBOČKA a ŽÁDNÝ DALŠÍ PARAMETR.

  Ten druhý požadavek není formalita. Kdyby se do adresy dostal druh
  píchnutí, stačilo by podstrčit odkaz a píchnout někomu opačný směr —
  o tom rozhoduje stav člověka, ne adresa.
*/
function odkazKiosku(slug, kod) {
  return `https://rizeni.foodtab.cz/${encodeURIComponent(slug)}/dochazka?kod=${encodeURIComponent(kod)}`
}

const ocekavany = odkazKiosku('cerna-perla', 'CE8CA63E')
const prectene = precti(ocekavany)

ma('přečtený odkaz sedí znak po znaku', prectene, ocekavany)

const u = new URL(prectene)
ma('cesta nese pobočku ze zařízení', u.pathname, '/cerna-perla/dochazka')
ma('a míří na Docházku', u.pathname.endsWith('/dochazka'), true)
// `ma` porovnává ===, takže se pole srovná jako text.
ma('v adrese je jediný parametr', [...u.searchParams.keys()].join(','), 'kod')
ma('a je to ten kód, co svítí', u.searchParams.get('kod'), 'CE8CA63E')

// Druhá pobočka: ať je vidět, že se pobočka opravdu bere z parametru
// a není nikde zadrátovaná.
const bernard = odkazKiosku('bernard-bar', 'DEADBEEF')
ma('jiná pobočka dá jinou adresu', precti(bernard), bernard)
ma('a v ní je ta druhá pobočka',
  new URL(precti(bernard)).pathname, '/bernard-bar/dochazka')

console.log('\n== Klidová zóna a korekce podle zadání ==')
// Úroveň M a klidová zóna 4 moduly — bez ní se QR nechytne, i když
// vypadá dobře.
const kiosk = qrSvg(ocekavany, { velikost: 320, oprava: 'M' })
const celkemK = Number(kiosk.match(/viewBox="0 0 (\d+)/)[1])
const bodyK = [...kiosk.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
])
ma('klidová zóna má čtyři moduly', Math.min(...bodyK.flat()) >= 4, true)
ma('i na druhé straně', Math.max(...bodyK.flat()) <= celkemK - 5, true)
ma('a QR je velký, ať se čte z půl metru',
  /width="320" height="320"/.test(kiosk), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
