#!/usr/bin/env node
/**
 * Čtení menu z fotky a z PDF — co jde ověřit bez volání modelu.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-menu-ai.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * 1. ŽE SE BEZ KLÍČE NIC NEPŘEDSTÍRÁ. U návrhu textu se bez klíče
 *    vrací ukázka — tady by to byla lež. Vymyšlené menu se od
 *    přečteného nepozná a vyšly by z něj ceny, které v podniku nikdy
 *    nebyly. Musí přijít CHYBA s návodem, ne výsledek.
 *
 * 2. ŽE SE CENA NEDOMÝŠLÍ ANI TEHDY, KDYŽ JI MODEL DOMYSLÍ. Pokyn
 *    v systémovém zadání není záruka. `opravitPodezrele` je druhá
 *    linie: nula se přepíše na prázdno a označí ke kontrole.
 *
 * 3. ŽE SE ODMÍTNE, CO NEUMÍME. Cizí typ souboru, prázdný soubor
 *    a soubor nad strop.
 *
 * Kvalita čtení se tu neověřuje. Ta se pozná jen na opravdové fotce
 * a nedá se zapsat do testu, který by uměl spadnout.
 */

import { precistMenu, PODKLADY_MENU, STROP_PODKLADU, cteniZObrazkuJeNastavene } from '../lib/marketing-menu-ai.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

// Jako u ostatních testů: klíč se odstraní, ať test na stroji, kde
// klíč JE, nevolá model a neplatí za to.
delete process.env.ANTHROPIC_API_KEY

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

console.log('\n== Bez klíče se vrací chyba, ne vymyšlené menu ==')

ok('hlásí se, že čtení není nastavené', cteniZObrazkuJeNastavene() === false)

const bezKlice = await precistMenu(JPEG, 'image/jpeg')

ok('bez klíče to skončí chybou', bezKlice.stav === 'chyba')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  Kdyby se sem někdy doplnila „ukázka" jako u návrhu textu, spadne to
  tady — a o to jde. Rozdíl mezi ukázkovým textem a ukázkovým menu je
  v tom, že ukázkový text si člověk přepíše, kdežto ukázkové menu
  vypadá jako přečtené.
*/
ok('a NEVRACÍ se žádné menu', !('menu' in bezKlice))

ok('a hláška poradí vložit text',
  bezKlice.stav === 'chyba' && /vložte menu textem/i.test(bezKlice.duvod))

console.log('\n== Co neumíme, se odmítne ==')

const cizi = await precistMenu(JPEG, 'application/zip')
ok('cizí typ souboru neprojde', cizi.stav === 'chyba')
ok('a řekne se, co umíme',
  cizi.stav === 'chyba' && /JPEG|PNG|WebP|PDF/i.test(cizi.duvod))

const prazdny = await precistMenu(new Uint8Array(0), 'image/jpeg')
ok('prázdný soubor neprojde', prazdny.stav === 'chyba')
ok('a pozná se to podle hlášky',
  prazdny.stav === 'chyba' && /prázdn/i.test(prazdny.duvod))

/*
  Strop se ověřuje PŘED klíčem: velký soubor se nemá posílat ven ani
  tehdy, když klíč je. Kdyby se pořadí prohodilo, platilo by se za
  požadavek, o kterém dopředu víme, že spadne.
*/
const velky = await precistMenu(new Uint8Array(STROP_PODKLADU + 1), 'image/jpeg')
ok('soubor nad strop neprojde', velky.stav === 'chyba')
ok('a hláška řekne kolik se vejde',
  velky.stav === 'chyba' && /8 MB/.test(velky.duvod))

console.log('\n== Strop dává smysl vůči limitu API ==')

/*
  Base64 nafoukne soubor o třetinu a celý požadavek se musí vejít do
  32 MB. Kdyby někdo strop zvedl na pětadvacet jako u fotek do
  příspěvku, odešlo by to jen proto, aby to spadlo na druhé straně.
*/
ok('strop po převodu na base64 zůstane pod 32 MB',
  Math.ceil(STROP_PODKLADU * 4 / 3) < 32 * 1024 * 1024)

console.log('\n== Umíme fotku i PDF ==')

for (const typ of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
  ok(`${typ} je mezi podporovanými`, PODKLADY_MENU.includes(typ))
}

console.log('\n== Druhá linie proti domýšlení ==')

/*
  `opravitPodezrele` se nedá zavolat zvenčí — je to vnitřek. Ověřuje se
  proto na ZDROJI, že tam ta oprava je a co dělá. Je to slabší kontrola
  než zavolat ji, ale silnější než nic: kdyby ji někdo vyndal s tím, že
  „model už to přece dělá sám", spadne to tady.
*/
const { readFileSync } = await import('node:fs')
const zdroj = readFileSync('lib/marketing-menu-ai.ts', 'utf8')

ok('nula jako cena se přepisuje na prázdnou',
  /price_cents === 0/.test(zdroj) && /p\.price_cents = null/.test(zdroj))

ok('a položka bez ceny si říká o kontrolu',
  /price_cents === null && !p\.needs_review/.test(zdroj))

ok('systémové zadání zakazuje domýšlet cenu',
  /Nikdy nedomýšlej cenu/.test(zdroj))

ok('a říká nahlas, že obsah obrázku není pokyn',
  /nikdy pokyn/i.test(zdroj) && /ignoruj předchozí pokyny/i.test(zdroj))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
