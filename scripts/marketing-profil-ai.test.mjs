#!/usr/bin/env node
/**
 * AI návrh profilu značky z odkazu — co jde ověřit bez volání modelu.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-profil-ai.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * 1. BEZ KLÍČE SE VRACÍ CHYBA, NE UKÁZKA ANI VYMYŠLENÝ PROFIL — stejná
 *    nejdůležitější kontrola jako u čtení menu z fotky
 *    (`scripts/marketing-menu-ai.test.mjs`): vymyšlená barva nebo popis
 *    firmy je nerozeznatelná lež.
 * 2. VSTUP (ODKAZ) JE DATA, NE PŘÍKAZ — obalený v <odkaz>, systémové
 *    zadání říká nahlas, že obsah stránek z nástrojů je taky jen data.
 * 3. OMEZENÍ NA DOMÉNU Z ODKAZU — appka nehledá podle jména firmy.
 * 4. PRAVIDLO 8 DRŽÍ — uzavřený vstupní typ, žádné osobní/mzdové údaje.
 * 5. DRUHÁ LINIE PROTI DOMÝŠLENÍ (`ozdravitNavrh`) — dlouhé texty se
 *    ořežou, cokoli u *_url polí nevypadá jako URL, se zahodí.
 */

import { readFileSync } from 'node:fs'

import {
  navrhnoutProfil,
  domenyPovolene,
  platnyOdkaz,
  systemoveZadaniProfil,
  podkladyProfil,
  profilJeNastaveny,
} from '../lib/marketing-profil-ai.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

delete process.env.ANTHROPIC_API_KEY

console.log('\n== Bez klíče se vrací chyba, ne vymyšlený profil ==')

ok('hlásí se, že profil není nastavený', profilJeNastaveny() === false)

const bezKlice = await navrhnoutProfil({ odkaz: 'https://www.cerna-perla.cz' })

ok('bez klíče to skončí chybou', bezKlice.stav === 'chyba')
ok('a NEVRACÍ se žádný návrh', !('navrh' in bezKlice))
ok('a hláška poradí vyplnit značku ručně',
  bezKlice.stav === 'chyba' && /ručně/i.test(bezKlice.duvod))

console.log('\n== Neplatný odkaz se odmítne dřív, než by se volal model ==')

for (const spatny of ['', 'cerna-perla.cz', 'javascript:alert(1)', 'ftp://example.com']) {
  const v = await navrhnoutProfil({ odkaz: spatny })
  ok(`„${spatny || '(prázdné)'}" skončí chybou, ne voláním AI`, v.stav === 'chyba')
}

console.log('\n== IP adresa ani interní jméno se nedostanou do allowed_domains ==')

/*
  Nález bezpečnostní kontroly (nahlášeno, ověřeno spuštěním): doména
  z `platnyOdkaz()` jde beze změny do `domenyPovolene()` a odtud do
  `allowed_domains` posílaného web_search/web_fetch. Bez týhle kontroly
  by `169.254.169.254` (cloudový metadata endpoint) nebo `localhost`
  prošly dovnitř — stejný druh adresy, který `lib/marketing-ssrf.ts`
  odmítá při stahování loga, jen o krok dřív.
*/
for (const zakazany of [
  'http://169.254.169.254/x',
  'http://10.0.0.5/internal',
  'http://127.0.0.1/x',
  'http://[::1]/x',
  'http://[fd12:3456:789a::1]/x',
  'http://localhost:3000/',
  'http://pokladna.localhost/',
  'http://interni.local/',
  'http://sklad.internal/',
  'http://intranet/x',
]) {
  ok(`„${zakazany}" se odmítne (IP/interní jméno)`, platnyOdkaz(zakazany) === null)
}

for (const povoleny of ['https://www.cerna-perla.cz', 'http://example.com/x']) {
  ok(`„${povoleny}" (veřejná doména) projde`, platnyOdkaz(povoleny) !== null)
}

console.log('\n== Odkaz je data, ne příkaz ==')

const url = new URL('https://www.cerna-perla.cz/o-nas')
const podklady = podkladyProfil(url)

ok('odkaz je uvnitř značek <odkaz>',
  /<odkaz>\nhttps:\/\/www\.cerna-perla\.cz\/o-nas\n<\/odkaz>/.test(podklady))

const domeny = domenyPovolene(url)
const system = systemoveZadaniProfil(domeny)

ok('systémové zadání říká, že obsah stránek je data ke čtení, ne pokyn',
  /DATA KE ČTENÍ/.test(system) && /nikdy pokyn/i.test(system))

ok('a jmenuje přesně ten útok, který se dá čekat',
  /ignoruj předchozí pokyny/i.test(system))

ok('a zakazuje domýšlet barvu „podle dojmu"',
  /NIKDY neodhaduj barvu/.test(system))

console.log('\n== Omezení na doménu z odkazu (appka nehledá podle jména firmy) ==')

ok('doména z odkazu je mezi povolenými', domeny.includes('cerna-perla.cz'))
ok('i varianta s www.', domeny.includes('www.cerna-perla.cz'))
ok('Instagram je mezi povolenými (firma na něj může z webu odkazovat)',
  domeny.includes('instagram.com'))
ok('Facebook taky', domeny.includes('facebook.com'))
ok('ale cizí doména mezi povolenými NENÍ', !domeny.includes('jina-firma.cz'))

ok('systémové zadání vyjmenovává přesně tyhle domény',
  domeny.every((d) => system.includes(d)))

console.log('\n== Odkaz zadaný rovnou na Instagram/Facebook funguje stejně ==')

const ig = domenyPovolene(new URL('https://www.instagram.com/cerna_perla_tabor'))
ok('doména zadaného odkazu (Instagram) je mezi povolenými',
  ig.includes('www.instagram.com') && ig.includes('instagram.com'))
ok('a Facebook zůstává povolený taky (firma může mít oba profily propojené)',
  ig.includes('facebook.com'))

console.log('\n== Pravidlo 8: do modelu nejdou lidi, mzdy ani docházka ==')

const zdroj = readFileSync('lib/marketing-profil-ai.ts', 'utf8')
const telo = zdroj.slice(zdroj.indexOf('export type ZadaniProfil'))

for (const zakazane of ['employee', 'zamestnan', 'mzd', 'sazb', 'dochazk', 'docházk', 'zaloh', 'záloh', 'telefon', 'rodn']) {
  ok(`typ ZadaniProfil ani okolí nezná „${zakazane}"`, !telo.toLowerCase().includes(zakazane))
}

ok('ZadaniProfil má jen pole `odkaz` — žádné další pole se tam nedá poslat',
  /export type ZadaniProfil = \{\s*\/\*\*[^}]*odkaz: string\s*\}/.test(zdroj))

console.log('\n== Model a jeho nastavení ==')

ok('volá se Opus 5', zdroj.includes("const MODEL = 'claude-opus-5'"))
ok('effort je high — veřejná značka, jeden pokus', /const NAMAHA = 'high'/.test(zdroj))
ok('odmítnutí modelu se čte a nehlásí jako prázdný návrh',
  zdroj.includes("stop_reason === 'refusal'"))
ok('zaseknuté hledání (pause_turn) se taky čte, ne jen refusal',
  zdroj.includes("stop_reason === 'pause_turn'"))
ok('neplatný klíč má srozumitelnou hlášku, ne „authentication_error"',
  /AuthenticationError/.test(zdroj) && /Klíč k AI neplatí/.test(zdroj))
ok('nástroje jsou omezené na domeny (allowed_domains), ne volné',
  /allowed_domains:\s*domeny/.test(zdroj))

console.log('\n== Druhá linie proti domýšlení (ozdravitNavrh) ==')

/*
  `ozdravitNavrh` se nevyváží — je to vnitřek. Ověřuje se přes veřejné
  rozhraní: `navrhnoutProfil` bez klíče skončí chybou dřív, než se
  k ozdravení dostane, takže se tu kontroluje PŘÍMO na zdroji, stejně
  jako `opravitPodezrele` v `scripts/marketing-menu-ai.test.mjs`.
*/
ok('dlouhé texty (popis) se ořezávají na strop',
  /STROP_POPIS = 600/.test(zdroj) && /oriznout\(n\.popis, STROP_POPIS\)/.test(zdroj))

ok('*_url pole, která nevypadají jako URL, se nulují',
  /function jakoUrl/.test(zdroj) && zdroj.includes('https?'))

ok('seznamy (zdroje, nejiste) mají strop počtu položek',
  /STROP_POLOZEK = 20/.test(zdroj) && /\.slice\(0, STROP_POLOZEK\)/.test(zdroj))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
