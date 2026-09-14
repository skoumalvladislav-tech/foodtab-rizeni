#!/usr/bin/env node
/**
 * Čtení menu z vloženého textu.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-menu.test.mjs
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEDĚLÁ AI
 *
 * Protože vložený text je strukturovaný a model by u něj hádal. Zadání,
 * oddíl 10: „AI nesmí domýšlet cenu, datum, alergen ani složení."
 * Deterministické čtení buď cenu najde, nebo přizná, že ne — a to je
 * přesně to chování, které se tu ověřuje.
 *
 * AI se použije až u fotky a PDF, kde jinak nejde nic.
 *
 * ---------------------------------------------------------------------
 * NA ČEM SE TO LÁME U OPRAVDOVÝCH MENU
 *
 * Vstupy níž nejsou vymyšlené hezky. Jsou to tvary, které psaly
 * restaurace na tabuli: cena jednou s „Kč", jednou s „,-", jednou holé
 * číslo; alergeny v závorce i za „A:"; datum v titulku, které se dá
 * splést s cenou.
 */

import { rozpoznatMenuZTextu, rozpoznatPolozku } from '../lib/marketing-menu-text.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Denní menu, jak ho psali na tabuli ==')

const denni = rozpoznatMenuZTextu(`Denní menu 12. 9. 2026
Polévka
Hovězí vývar s nudlemi 45 Kč
Hlavní jídla
Svíčková na smetaně s knedlíkem 189 Kč
Smažený sýr s hranolkami (1,3,7) 165,-
Kuřecí steak – grilovaná zelenina 175`)

ok('titulek se najde', denni.title.startsWith('Denní menu'))
ok('a datum z titulku taky', denni.valid_from === '2026-09-12')

const vsechny = denni.items
ok('načtou se čtyři položky', vsechny.length === 4)

const svickova = vsechny.find((i) => i.name.includes('Svíčková'))
ok('svíčková má cenu v haléřích', svickova?.price_cents === 18900)
ok('a je v kategorii hlavní', svickova?.category === 'hlavni')

const vyvar = vsechny.find((i) => i.name.includes('vývar'))
ok('polévka se pozná podle nadpisu', vyvar?.category === 'polevka')
ok('a má svou cenu', vyvar?.price_cents === 4500)

const syr = vsechny.find((i) => i.name.includes('sýr'))
ok('cena zapsaná jako „165,-" se přečte', syr?.price_cents === 16500)
ok('a alergeny ze závorky taky', syr?.allergens.join(',') === '1,3,7')
ok('a nezůstanou v názvu', syr?.name === 'Smažený sýr s hranolkami')

const steak = vsechny.find((i) => i.name.includes('Kuřecí'))
ok('holé číslo na konci je cena', steak?.price_cents === 17500)
ok('a pomlčka oddělí popis', steak?.description === 'grilovaná zelenina')

console.log('\n== Co se nepozná, se přizná ==')

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA.

  Položka bez ceny nesmí dostat nulu ani vymyšlenou částku. Musí projít
  s prázdnou cenou a s příznakem, že si ji má někdo ověřit — jinak by
  vyšel příspěvek se svíčkovou zdarma.
*/
const bezCeny = rozpoznatPolozku('Dezert dle denní nabídky', 'dezert')

ok('nerozpoznaná cena zůstane prázdná', bezCeny.price_cents === null)
ok('a NENÍ to nula', bezCeny.price_cents !== 0)
ok('a položka si říká o kontrolu', bezCeny.needs_review === true)
ok('a je řečeno proč', /cena/i.test(bezCeny.review_reason ?? ''))

const sOtaznikem = rozpoznatPolozku('Rybí polévka ? Kč', 'polevka')
ok('otazník v řádku si taky říká o kontrolu', sOtaznikem.needs_review === true)

/*
  Dvě pasti v jednom vstupu, na obě se přišlo psaním tohohle testu:

  1. Titulek musí být první, jinak se jako titulek vezme první položka.
  2. Řádek „Dezert dle nabídky" se NEPOČÍTÁ jako položka — krátký řádek
     začínající názvem kategorie je NADPIS. Je to správně (tak menu na
     tabuli vypadají), ale položka bez ceny se tím musí napsat jinak.
*/
const celeMenu = rozpoznatMenuZTextu('Nabídka dne\nSvíčková dle denní nabídky\nKáva 55 Kč')
ok('a menu to shrne do varování',
  celeMenu.warnings.some((v) => /bez rozpoznané ceny/i.test(v)))

console.log('\n== Datum v titulku není cena ==')

/*
  „Denní menu 9. 9. 2026" končí čtyřmístným číslem. Kdyby se bralo jako
  cena, vyšlo by menu za 2026 Kč a titulek by zmizel.
*/
const sDatem = rozpoznatMenuZTextu('Polední menu 9. 9. 2026\nGuláš 149 Kč')
ok('rok se nevezme jako cena', sDatem.title.includes('2026'))
ok('a položka je jen jedna', sDatem.items.length === 1)
ok('a má správnou cenu', sDatem.items[0].price_cents === 14900)

console.log('\n== Týdenní menu se rozpadne na dny ==')

const tydenni = rozpoznatMenuZTextu(`Týdenní menu
Pondělí 15. 9.
Čočka na kyselo 139 Kč
Úterý 16. 9.
Vepřo knedlo zelo 159 Kč`)

ok('pozná se, že je týdenní', tydenni.kind === 'weekly')
ok('a má dva dny', tydenni.days.length === 2)
ok('pondělí má datum', tydenni.days[0]?.day_date === '2026-09-15')
ok('a svoje jídlo', tydenni.days[0]?.items[0]?.name.includes('Čočka'))
ok('úterní jídlo nespadne do pondělí', tydenni.days[1]?.items[0]?.name.includes('Vepřo'))

console.log('\n== Prázdný vstup ==')

const prazdne = rozpoznatMenuZTextu('')
ok('prázdný text nespadne', Array.isArray(prazdne.items))
ok('a řekne, že nic nenašel',
  prazdne.warnings.some((v) => /nenašla žádná položka/i.test(v)))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
