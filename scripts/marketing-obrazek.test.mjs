#!/usr/bin/env node
/**
 * Čtení nahraného obrázku — lib/marketing-obrazek.ts.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-obrazek.test.mjs
 *
 * ---------------------------------------------------------------------
 * SOUBORY SE TU DOOPRAVDY SKLÁDAJÍ, BAJT PO BAJTU
 *
 * Stejně jako u scripts/xlsx.test.mjs. Kontrola, která by čtení
 * podstrčila hotový objekt „takhle vypadá PNG", by ověřovala tvar
 * vlastní představy, ne to, co přijde z formuláře.
 *
 * Míří to na to, na čem cizí soubory selhávají:
 *   * přejmenovaný soubor, který fotka není,
 *   * JPEG s hromadou úseků před rozměry (fotka z telefonu jich má
 *     klidně deset) a mezi nimi DHT, který do řady SOF spadá číslem,
 *     ale rozměry v něm nejsou,
 *     WebP ve všech třech podobách, protože každá ukládá rozměry jinam,
 *   * useknutý soubor.
 */

import { precistObrazek, poznatTyp, otiskObsahu, STROP_BAJTU } from '../lib/marketing-obrazek.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const b = (...casti) => Buffer.concat(casti.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))))
const u16be = (n) => { const x = Buffer.alloc(2); x.writeUInt16BE(n); return x }
const u32be = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n); return x }
const u16le = (n) => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x }
const u32le = (n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x }

/** PNG: podpis, IHDR se šířkou a výškou, IEND. */
function png(sirka, vyska) {
  const podpis = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = b(u32be(13), 'IHDR', u32be(sirka), u32be(vyska),
                 Buffer.from([8, 6, 0, 0, 0]), u32be(0))
  const iend = b(u32be(0), 'IEND', u32be(0))
  return b(podpis, ihdr, iend)
}

/**
 * JPEG. `pred` jsou úseky, které stojí před rozměry — přesně to, co
 * musí čtení přeskočit, aby se dostalo k SOF0.
 */
function jpeg(sirka, vyska, pred = []) {
  const usek = (znacka, telo) =>
    b(Buffer.from([0xff, znacka]), u16be(telo.length + 2), telo)

  const sof0 = b(Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]),
                 u16be(vyska), u16be(sirka), Buffer.from([3]),
                 Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]))

  return b(Buffer.from([0xff, 0xd8]), ...pred.map(([z, t]) => usek(z, t)),
           sof0, Buffer.from([0xff, 0xd9]))
}

function webpVp8(sirka, vyska) {
  const telo = b('VP8 ', u32le(10), Buffer.from([0, 0, 0, 0, 0, 0]),
                 u16le(sirka), u16le(vyska))
  return b('RIFF', u32le(telo.length + 4), 'WEBP', telo)
}

function webpVp8l(sirka, vyska) {
  const bity = ((sirka - 1) & 0x3fff) | (((vyska - 1) & 0x3fff) << 14)
  const telo = b('VP8L', u32le(5), Buffer.from([0x2f]), u32le(bity))
  return b('RIFF', u32le(telo.length + 4), 'WEBP', telo)
}

function webpVp8x(sirka, vyska) {
  const troj = (n) => Buffer.from([(n - 1) & 0xff, ((n - 1) >> 8) & 0xff, ((n - 1) >> 16) & 0xff])
  const telo = b('VP8X', u32le(10), Buffer.from([0, 0, 0, 0]), troj(sirka), troj(vyska))
  return b('RIFF', u32le(telo.length + 4), 'WEBP', telo)
}

const precti = (buf) => precistObrazek(new Uint8Array(buf))

console.log('\n== PNG ==')

const p1 = precti(png(1080, 1350))
ok('PNG se pozná', p1.stav === 'ok' && p1.obrazek.typ === 'image/png')
ok('a přečte se šířka', p1.stav === 'ok' && p1.obrazek.sirka === 1080)
ok('i výška', p1.stav === 'ok' && p1.obrazek.vyska === 1350)
ok('přípona je png', p1.stav === 'ok' && p1.obrazek.pripona === 'png')

console.log('\n== JPEG bez úseků navíc ==')

const j1 = precti(jpeg(1920, 1080))
ok('JPEG se pozná', j1.stav === 'ok' && j1.obrazek.typ === 'image/jpeg')
ok('rozměry sedí', j1.stav === 'ok' && j1.obrazek.sirka === 1920 && j1.obrazek.vyska === 1080)
ok('přípona je jpg', j1.stav === 'ok' && j1.obrazek.pripona === 'jpg')

console.log('\n== JPEG jako z telefonu: hromada úseků před rozměry ==')

/*
  Fotka z telefonu má před rozměry EXIF, náhled a barevný profil.
  Čtení se přes ně musí prokousat podle délek — kdyby sahalo na pevné
  místo, vyšla by z toho náhodná čísla.
*/
const jTelefon = precti(jpeg(4032, 3024, [
  [0xe0, b('JFIF\0', Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]))],
  [0xe1, b('Exif\0\0', Buffer.alloc(200, 7))],
  [0xe2, b('ICC_PROFILE\0', Buffer.alloc(3000, 3))],
  [0xdb, Buffer.alloc(65, 5)],
]))

ok('rozměry se najdou i za dlouhými úseky',
  jTelefon.stav === 'ok' && jTelefon.obrazek.sirka === 4032 && jTelefon.obrazek.vyska === 3024)

console.log('\n== JPEG s DHT: značka ze řady SOF, ale rozměry v ní nejsou ==')

/*
  Tohle je ta zákeřná. DHT má značku 0xC4, tedy uvnitř rozsahu
  0xC0–0xCF, ve kterém rozměry bývají. Kdyby se DHT ze řady nevyjmul,
  přečetla by se jako rozměry jeho tabulka — a vyšlo by číslo, které
  vypadá jako rozměr a není.
*/
const jDht = precti(jpeg(1080, 1080, [
  [0xc4, b(Buffer.from([0x00]), Buffer.alloc(28, 0x41))],
  [0xdb, Buffer.alloc(65, 5)],
]))

ok('DHT se přeskočí a rozměry jsou ty pravé',
  jDht.stav === 'ok' && jDht.obrazek.sirka === 1080 && jDht.obrazek.vyska === 1080)

console.log('\n== WebP ve všech třech podobách ==')

const w1 = precti(webpVp8(1200, 628))
ok('prostý WebP (VP8)', w1.stav === 'ok' && w1.obrazek.sirka === 1200 && w1.obrazek.vyska === 628)

const w2 = precti(webpVp8l(800, 600))
ok('bezeztrátový WebP (VP8L)', w2.stav === 'ok' && w2.obrazek.sirka === 800 && w2.obrazek.vyska === 600)

const w3 = precti(webpVp8x(1440, 1800))
ok('rozšířený WebP (VP8X)', w3.stav === 'ok' && w3.obrazek.sirka === 1440 && w3.obrazek.vyska === 1800)

ok('a všechny tři se hlásí jako webp',
  [w1, w2, w3].every((v) => v.stav === 'ok' && v.obrazek.typ === 'image/webp'))

console.log('\n== Co fotka není ==')

/*
  Přípona ani hlášení prohlížeče nerozhodují. Přejmenovat cokoli na
  .jpg umí každý a poslat image/jpeg u čehokoli umí i skript.
*/
const pdf = precti(b('%PDF-1.7\n', Buffer.alloc(500, 0x20)))
ok('PDF se za fotku nevydává', pdf.stav === 'chyba')
ok('a hláška říká, že rozhoduje obsah', pdf.stav === 'chyba' && /obsah/i.test(pdf.duvod))

ok('text není fotka', precti(Buffer.from('ahoj, tohle je poznámka')).stav === 'chyba')

/*
  Prázdný soubor se pozná i bez vlastní větve — nemá úvodní značku,
  takže propadne rozpoznání typu. Ta větev je tu kvůli HLÁŠCE:
  „Soubor je prázdný" člověku řekne, co se stalo, kdežto „tohle není
  fotka" ho pošle hledat chybu ve formátu.

  Kontroluje se proto ta hláška, ne jen odmítnutí. Jinak by ta větev
  šla smazat a nic by to neohlásilo — zkoušel jsem to.
*/
const prazdny = precti(Buffer.alloc(0))
ok('prázdný soubor neprojde', prazdny.stav === 'chyba')
ok('a řekne se mu prázdný, ne "není fotka"',
  prazdny.stav === 'chyba' && /prázdn/i.test(prazdny.duvod))

/*
  A tohle izoluje samotné rozpoznávání typu.

  Je to PDF, uvnitř kterého leží celý poctivý JPEG i s rozměry — tedy
  přesně to, co vznikne, když někdo vyexportuje fotku do dokumentu.
  Kdyby se typ neověřoval z úvodních bajtů, čtení by ten JPEG uvnitř
  našlo, rozměry přečetlo a soubor by prošel jako fotka.

  První pokus o tuhle kontrolu byl k ničemu: ubral jsem z JPEGu jen
  úvodní bajt a čtení pak rozměry nenašlo tak jako tak, takže
  vypnutí kontroly typu nic neohlásilo.
*/
const pdfSFotkou = precti(b('%PDF-1.7\n', jpeg(800, 600)))
ok('dokument s fotkou uvnitř neprojde, i když se z něj rozměry přečíst dají',
  pdfSFotkou.stav === 'chyba')

// ZIP začíná PK — sem patří i .docx a .xlsx, které někdo vybere omylem.
ok('sešit ani dokument neprojdou',
  precti(b(Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(300))).stav === 'chyba')

console.log('\n== Poškozený soubor ==')

// Podpis sedí, zbytek chybí. Nesmí to spadnout výjimkou a nesmí to
// projít — má z toho být srozumitelná hláška.
const uskrtnutyPng = precti(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]))
ok('useknutý PNG neprojde', uskrtnutyPng.stav === 'chyba')
ok('a řekne, že je nejspíš poškozený',
  uskrtnutyPng.stav === 'chyba' && /poškozen/i.test(uskrtnutyPng.duvod))

const jpegBezSof = precti(b(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)))
ok('JPEG bez rozměrů neprojde', jpegBezSof.stav === 'chyba')

console.log('\n== Strop na velikost ==')

const velky = precti(Buffer.concat([png(10, 10), Buffer.alloc(STROP_BAJTU)]))
ok('příliš velká fotka neprojde', velky.stav === 'chyba')
ok('a hláška řekne kolik', velky.stav === 'chyba' && /MB/.test(velky.duvod))

console.log('\n== Otisk ==')

const a = png(100, 100)
const c = png(100, 200)

ok('týž obsah dá týž otisk', otiskObsahu(new Uint8Array(a)) === otiskObsahu(new Uint8Array(a)))
ok('jiný obsah dá jiný otisk', otiskObsahu(new Uint8Array(a)) !== otiskObsahu(new Uint8Array(c)))
ok('otisk je sha-256', otiskObsahu(new Uint8Array(a)).length === 64)

/*
  Otisk se počítá z BAJTŮ. Táž fotka nahraná jako IMG_2831.jpg
  a jako svickova.jpg je jedna fotka — jinak knihovna během měsíce
  zaroste kopiemi.
*/
ok('a čtení ho vrací spolu s obrázkem',
  precti(a).stav === 'ok' && precti(a).obrazek.otisk === otiskObsahu(new Uint8Array(a)))

console.log('\n== Poznávání typu zvlášť ==')

ok('poznatTyp u PNG', poznatTyp(new Uint8Array(png(1, 1))) === 'image/png')
ok('poznatTyp u JPEG', poznatTyp(new Uint8Array(jpeg(1, 1))) === 'image/jpeg')
ok('poznatTyp u WebP', poznatTyp(new Uint8Array(webpVp8(1, 1))) === 'image/webp')
ok('poznatTyp u cizího souboru', poznatTyp(new Uint8Array(Buffer.from('GIF89a'))) === null)

// RIFF bez WEBP je třeba zvukový soubor .wav. Nesmí projít jen proto,
// že první čtyři bajty sedí.
ok('RIFF, ale ne WebP, neprojde',
  poznatTyp(new Uint8Array(b('RIFF', u32le(100), 'WAVE', Buffer.alloc(100)))) === null)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
