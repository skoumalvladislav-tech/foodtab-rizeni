#!/usr/bin/env node
/**
 * QR kód — lib/qr.ts a obrazovka kiosku.
 *
 * Pusť `node --experimental-strip-types scripts/qr.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE KOMPONENTA, A NE JEN VOLÁ FUNKCE
 *
 * Předchozí podoba téhle kontroly si očekávanou adresu POSKLÁDALA
 * SAMA a pak ověřila, že se z QR přečte zpátky. To vždycky vyjde —
 * ověřuje se tím jen to, že kodér umí, co má. O tom, co je na tabletu,
 * to neříká nic.
 *
 * A na tabletu bylo něco jiného: `adresaPichnuti` měla větev
 * `if (!slug) return kod`, pobočka se z databáze ještě nevracela,
 * a QR tak osm dní nesl osmiznakový kód místo šedesátiznakové adresy.
 * Kontrola na tu větev nesáhla, protože tu funkci vůbec nevolala.
 * Hlásilo se „29 kontrol prošlo“ nad kódem, který nefungoval.
 *
 * Proto se tady VYKRESLÍ SKUTEČNÁ KOMPONENTA `app/kiosek/qr-kod.tsx`
 * — táž, kterou kreslí kiosek —, z jejího výstupu se vytáhne hotové
 * SVG a to se dekóduje. Kontrola tedy sahá na obrázek, který uvidí
 * člověk u baru.
 *
 * Čte se NEZÁVISLOU knihovnou (jsqr), ne tou, která kód vyrobila.
 * Kdyby se použila táž, ověřilo by se jen to, že si sama rozumí.
 *
 * jsqr chce pole obrazových bodů, ne SVG. SVG se proto rozebere zpátky
 * na mřížku modulů — a právě proto se v lib/qr.ts kreslí každý modul
 * jako samostatný čtverec, ne jako slepená cesta.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import jsQR from 'jsqr'

import { qrSvg } from '../lib/qr.ts'
import { odkazPichnuti } from '../lib/qr-kiosek.ts'
import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/**
 * Porovnání znak po znaku.
 *
 * `ma` by řeklo jen „nerovná se“. U šedesátiznakové adresy je rozdíl
 * mezi „chybí pomlčka“ a „je tam osm znaků místo adresy“ podstatný,
 * takže se ukáže, na kterém znaku se to rozešlo.
 */
function maZnakPoZnaku(popis, sk, ce) {
  if (sk === ce) {
    console.log(`  OK    ${popis} (${ce.length} znaků)`)
    return
  }
  chyb++
  if (sk === null || sk === undefined) {
    console.log(`  CHYBA ${popis} → nepřečteno (čekalo se ${JSON.stringify(ce)})`)
    return
  }
  let i = 0
  while (i < sk.length && i < ce.length && sk[i] === ce[i]) i++
  console.log(`  CHYBA ${popis} → rozchází se na znaku ${i}`)
  console.log(`        na obrazovce: ${JSON.stringify(sk)} (${sk.length} znaků)`)
  console.log(`        mělo být:     ${JSON.stringify(ce)} (${ce.length} znaků)`)
}

/* =====================================================================
   Vykreslení skutečné komponenty kiosku

   Zavaděč je ve scripts/vykreslit.mjs — používá ho i kontrola záloh.
   Kdyby si ho každá kontrola psala po svém, jedna z nich by dřív nebo
   později načítala něco jiného, než co běží.
   ================================================================== */

const KOREN = new URL('..', import.meta.url)

const QrKod = await nactiKomponentu('app/kiosek/qr-kod.tsx')

/** Vykreslí kiosek přesně tak, jak ho vykreslí prohlížeč. */
function obrazovka(vlastnosti) {
  return renderToStaticMarkup(createElement(QrKod, vlastnosti))
}

/** Vytáhne z hotové obrazovky SVG. `null`, když tam žádné není. */
function svgZObrazovky(html) {
  const m = html.match(/<svg\b[\s\S]*?<\/svg>/)
  return m ? m[0] : null
}

/** Z SVG udělá obrazové body, které umí přečíst jsqr. */
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

/** Dekóduje hotové SVG cizí knihovnou. */
function dekoduj(svg) {
  const { data, sirka } = naBody(svg)
  return jsQR(data, sirka, sirka)?.data ?? null
}

function precti(text, volby) {
  return dekoduj(qrSvg(text, volby))
}

/* =====================================================================
   1. Kodér sám
   ================================================================== */

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
ma('tichá zóna nahoře a vlevo', Math.min(...souradnice.flat()) >= 4, true)
ma('tichá zóna dole a vpravo', Math.max(...souradnice.flat()) <= celkem - 5, true)

console.log('\n== A že to umí spadnout ==')
// Kdyby se do QR dostalo něco jiného, než co jsme tam dali, tenhle
// řádek by prošel taky — proto se zkouší i nesouhlas.
ma('přečtený text se porovnává, ne jen že něco vzniklo',
  precti('https://foodtab.cz/kiosek') === 'https://foodtab.cz/jine', false)

/* =====================================================================
   2. Obrazovka kiosku — dekóduje se to, co se vykreslí

   Tohle je jádro. Všechno výš mluví o kodéru; tady se mluví o tabletu.
   ================================================================== */

console.log('\n== QR z obrazovky kiosku ==')

const PUVOD = 'https://rizeni.foodtab.cz'

// Přesně to, co vrací `kiosk_stav` (migrace 20260902050000).
const stav = {
  puvod: PUVOD,
  slug: 'cerna-perla',
  kod: 'CE8CA63E',
  platnost: 45,
}

const html = obrazovka(stav)
const svgKiosku = svgZObrazovky(html)

ma('na obrazovce je QR', svgKiosku !== null, true)

const zObrazovky = svgKiosku ? dekoduj(svgKiosku) : null
const ocekavany = `${PUVOD}/cerna-perla/dochazka?kod=CE8CA63E`

maZnakPoZnaku('přečtené z vykresleného QR sedí znak po znaku', zObrazovky, ocekavany)

/*
  Právě tenhle řádek by chytil chybu, kterou Šéfík našel na tabletu:
  v QR byl `DAAA25EA`, tedy osm znaků a žádná adresa.
*/
ma('v QR není samotný kód', zObrazovky === 'CE8CA63E', false)
ma('QR nese celou adresu, ne jen kus', (zObrazovky ?? '').startsWith('https://'), true)

const u = new URL(zObrazovky ?? 'https://x.invalid')
ma('cesta nese pobočku ze zařízení', u.pathname, '/cerna-perla/dochazka')
ma('a míří na Docházku', u.pathname.endsWith('/dochazka'), true)
/*
  Jediný parametr. Není to formalita: kdyby se do adresy dostal druh
  píchnutí, stačilo by podstrčit odkaz a píchnout někomu opačný směr —
  o tom rozhoduje stav člověka, ne adresa.
*/
ma('v adrese je jediný parametr', [...u.searchParams.keys()].join(','), 'kod')
ma('a je to ten kód, co svítí', u.searchParams.get('kod'), 'CE8CA63E')

// Verze QR se pozná z počtu modulů: 21 = verze 1, 25 = 2, 29 = 3, 33 = 4.
// Do verze 1 se šedesátiznaková adresa vejít nemůže, takže tenhle řádek
// sám o sobě odhalí návrat k holému kódu.
const moduluKiosku = Number(svgKiosku.match(/viewBox="0 0 (\d+)/)[1]) - 8
const verze = (moduluKiosku - 17) / 4
console.log(`  info  QR má ${moduluKiosku} modulů (verze ${verze}), při 320 px vychází modul na ${(320 / (moduluKiosku + 8)).toFixed(1)} px`)
ma('QR je větší než verze 1 — do té by se adresa nevešla', moduluKiosku > 21, true)

console.log('\n== Druhá pobočka a diakritika ==')

const bernard = obrazovka({ ...stav, slug: 'bernard-bar', kod: 'DEADBEEF' })
maZnakPoZnaku(
  'jiná pobočka dá jinou adresu',
  dekoduj(svgZObrazovky(bernard)),
  `${PUVOD}/bernard-bar/dochazka?kod=DEADBEEF`,
)

const sHackem = obrazovka({ ...stav, slug: 'černá-perla' })
maZnakPoZnaku(
  'pobočka s háčkem projde jako v adrese',
  dekoduj(svgZObrazovky(sHackem)),
  `${PUVOD}/${encodeURIComponent('černá-perla')}/dochazka?kod=CE8CA63E`,
)

console.log('\n== Když pobočku neznáme, QR se nekreslí vůbec ==')

/*
  Tohle je ta zabezpečená mez. Dřív se místo adresy do QR dal samotný
  kód — fotoaparát ho přečetl, ukázal osm znaků a člověk je stejně
  přepsal. Vypadalo to, že to funguje, a to je nejhorší možný stav.
*/
const bezPobocky = obrazovka({ ...stav, slug: null })
ma('žádné QR', svgZObrazovky(bezPobocky), null)
ma('nadpis neslibuje fotoaparát', bezPobocky.includes('Namiřte fotoaparát'), false)
ma('místo toho říká, co se dá udělat', bezPobocky.includes('Opište kód'), true)
ma('a kód je pořád vidět', bezPobocky.includes('CE8CA63E'), true)

ma('s pobočkou nadpis fotoaparát slibuje', html.includes('Namiřte fotoaparát'), true)
ma(
  'a popisek pro odečítač říká, co se stane',
  html.includes('aria-label="QR kód: otevře Docházku s předvyplněným kódem"'),
  true,
)

console.log('\n== Adresa vzniká na jednom místě ==')

/*
  Kontrola sahá na `qr-kod.tsx`. Kdyby si kiosek adresu skládal jinudy,
  ověřovalo by se zas něco jiného, než co běží — proto se hlídá, že
  v kiosku žádný druhý zdroj QR není.
*/
const zdrojKiosku = fs.readFileSync(new URL('app/kiosek/kiosek.tsx', KOREN), 'utf8')
ma('kiosek kreslí QR jen přes QrKod', zdrojKiosku.includes('qrSvg('), false)
ma('a nemá vlastní skládání adresy', zdrojKiosku.includes('/dochazka?kod='), false)
ma('QrKod bere adresu z lib/qr-kiosek',
  fs.readFileSync(new URL('app/kiosek/qr-kod.tsx', KOREN), 'utf8').includes("from '@/lib/qr-kiosek'"),
  true)

// Bez pobočky žádná adresa — ať se ta větev nedá obejít ani přímo.
ma('bez pobočky se adresa nesestaví', odkazPichnuti(PUVOD, null, 'CE8CA63E'), null)
ma('bez původu taky ne', odkazPichnuti('', 'cerna-perla', 'CE8CA63E'), null)
ma('bez kódu taky ne', odkazPichnuti(PUVOD, 'cerna-perla', ''), null)

console.log('\n== A databáze tu pobočku opravdu posílá ==')

/*
  Poslední díl řetězu. Komponenta dostane slug z `kiosk_stav`; kdyby ho
  ta funkce přestala vracet, obrazovka spadne do podoby bez QR a nikdo
  by se to nedozvěděl dřív než z tabletu. Tady se to pozná hned.
*/
const migrace = fs.readFileSync(
  new URL('supabase/migrations/20260902050000_kiosek_slug.sql', KOREN),
  'utf8',
)
ma("kiosk_stav vrací 'slug'", /'slug',\s+\(select b\.slug/.test(migrace), true)

console.log('\n== Klidová zóna a korekce podle zadání ==')
const bodyK = [...svgKiosku.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [
  Number(m[1]),
  Number(m[2]),
])
const celkemK = Number(svgKiosku.match(/viewBox="0 0 (\d+)/)[1])
ma('klidová zóna má čtyři moduly', Math.min(...bodyK.flat()) >= 4, true)
ma('i na druhé straně', Math.max(...bodyK.flat()) <= celkemK - 5, true)
ma('a QR je velký, ať se čte z půl metru',
  /width="320" height="320"/.test(svgKiosku), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
