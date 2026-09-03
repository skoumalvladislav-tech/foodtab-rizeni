#!/usr/bin/env node
/**
 * Manifesty — společný a kioskový.
 *
 * Pusť `node --experimental-strip-types scripts/manifest.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEJDE OVĚŘIT JEN PŘEČTENÍM
 *
 * Chyba, kterou to má hlídat, byla v jednom poli: společný manifest má
 * `start_url: "/"`, takže ikona z plochy otevřela přihlášení, ať se
 * instalovalo odkudkoli. Na obrazovce se to nepozná — pozná se to až
 * na ploše tabletu.
 *
 * Tady se proto ověřuje HOTOVÁ ODPOVĚĎ: zavolá se `GET` té adresy
 * a čte se JSON, který Android doopravdy dostane. A u ikon se čte
 * PNG, ne jen jeho jméno v manifestu — deklarovaná velikost musí
 * odpovídat skutečné.
 *
 * Co tímhle ověřené NENÍ: jak se zachová WebAPK po instalaci. To se dá
 * zjistit jedině přidáním na plochu na skutečném Androidu.
 */

import fs from 'node:fs'
import { inflateSync } from 'node:zlib'

import spolecny from '../app/manifest.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)

/* --- kioskový manifest: to, co odejde po drátě ----------------------- */

console.log('\n== Kioskový manifest ==')

// `route.ts` exportuje GET; čte se odpověď, ne vnitřní konstanta.
const { GET } = await import('../app/kiosek.webmanifest/route.ts')
const odpoved = GET()
ma('servíruje se jako manifest', odpoved.headers.get('content-type'), 'application/manifest+json')

const kiosek = JSON.parse(await odpoved.text())

/*
  Tohle jsou ta dvě pole, kvůli kterým to celé je. Kdyby se kterékoli
  vrátilo na „/“, ikona z plochy otevře přihlášení.
*/
ma('start_url míří na kiosek', kiosek.start_url, '/kiosek')
ma('scope taky', kiosek.scope, '/kiosek')
ma('a rozhodně ne na kořen', kiosek.start_url === '/', false)

// Bez fullscreenu zůstane na baru adresní řádek a jde se z kiosku pryč.
ma('celá obrazovka, ne standalone', kiosek.display, 'fullscreen')

// Společný manifest vynucuje portrét; tablet stojí na šířku.
ma('na šířku', kiosek.orientation, 'landscape')
ma('ne portrét', kiosek.orientation === 'portrait-primary', false)

ma('vlastní jméno', kiosek.name, 'Foodtab kiosek')
ma('kiosek nemá zkratky — umí jednu věc', kiosek.shortcuts === undefined, true)

/* --- ikony se nesmí splést ------------------------------------------ */

console.log('\n== Dvě ikony na téže ploše ==')

const spolecnyM = spolecny()

const jmenaKiosku = kiosek.icons.map((i) => i.src)
const jmenaSpolecna = spolecnyM.icons.map((i) => i.src)

ma(
  'kiosek nepoužívá ani jednu ikonu společné aplikace',
  jmenaKiosku.some((s) => jmenaSpolecna.includes(s)),
  false,
)
ma('jméno je jiné', kiosek.name === spolecnyM.name, false)
ma('krátké jméno taky', kiosek.short_name === spolecnyM.short_name, false)

/*
  A že to nejsou tytéž obrázky pod jiným jménem. Kopie hlavní ikony by
  prošla všemi kontrolami výš a na ploše by se nepoznala.
*/
const bajty = (src) => fs.readFileSync(new URL('public' + src, KOREN))
ma(
  'a nejsou to tytéž obrázky pod jiným jménem',
  bajty('/kiosek-icon-512.png').equals(bajty('/icon-512.png')),
  false,
)

/* --- PNG se čte, ne jen jeho jméno v manifestu ---------------------- */

console.log('\n== Ikony jsou opravdu to, co manifest slibuje ==')

/** Rozměry a průhlednost rohu z hotového PNG. */
function precti(src) {
  const buf = bajty(src)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${src} není PNG`)

  const sirka = buf.readUInt32BE(16)
  const vyska = buf.readUInt32BE(20)
  const barevnost = buf[25]

  // IDAT může být rozsekaný na víc kusů; slepí se.
  const kusy = []
  let i = 8
  while (i < buf.length) {
    const delka = buf.readUInt32BE(i)
    const typ = buf.toString('ascii', i + 4, i + 8)
    if (typ === 'IDAT') kusy.push(buf.subarray(i + 8, i + 8 + delka))
    i += 12 + delka
  }
  const radky = inflateSync(Buffer.concat(kusy))

  // Skript píše filtr 0 na každý řádek, takže první bod je hned za ním.
  const alfaRohu = barevnost === 6 ? radky[4] : 255

  return { sirka, vyska, alfaRohu }
}

for (const ikona of kiosek.icons) {
  const { sirka, vyska, alfaRohu } = precti(ikona.src)
  const [dSirka, dVyska] = ikona.sizes.split('x').map(Number)
  ma(`${ikona.src} má slíbených ${ikona.sizes}`, `${sirka}x${vyska}`, `${dSirka}x${dVyska}`)

  if (ikona.purpose === 'maskable') {
    /*
      Maskovatelná se Androidu obřízne do jeho tvaru. Kdyby měla
      průhledné rohy, zbyla by dlaždice s uhryzanými kraji — proto je
      varianta na celou plochu zvlášť.
    */
    ma(`${ikona.src} — maskovatelná nemá průhledný roh`, alfaRohu, 255)
  } else {
    ma(`${ikona.src} — zakulacená průhledný roh má`, alfaRohu, 0)
  }
}

/* --- stránka odkazuje ten správný ----------------------------------- */

console.log('\n== Kiosková stránka odkazuje svůj manifest ==')

/*
  Bez tohohle by se ověřoval manifest, na který se z kiosku nikdo
  neodkáže — a Android by dál bral ten společný.
*/
const stranka = fs.readFileSync(new URL('app/kiosek/page.tsx', KOREN), 'utf8')
ma('page.tsx odkazuje /kiosek.webmanifest',
  stranka.includes("manifest: '/kiosek.webmanifest'"), true)

/* --- společný manifest: mrtvé zkratky --------------------------------- */

console.log('\n== Ve společném manifestu nejsou mrtvé zkratky ==')

/*
  Mířily na `?modul=…`, což dnes nikdo nečte — ověřeno naostro, všechny
  tři adresy skončily tam, kam vede samotné `/`.
*/
const zdrojSpolecny = fs.readFileSync(new URL('app/manifest.ts', KOREN), 'utf8')
ma('žádné ?modul= v odkazech', /url:\s*["'][^"']*modul=/.test(zdrojSpolecny), false)
ma('a žádné zkratky vůbec', spolecnyM.shortcuts === undefined, true)

// Společný zůstává, jaký byl — kiosek mu nesmí nic přepsat.
ma('společný pořád startuje na kořeni', spolecnyM.start_url, '/')
ma('a zůstal standalone', spolecnyM.display, 'standalone')

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
