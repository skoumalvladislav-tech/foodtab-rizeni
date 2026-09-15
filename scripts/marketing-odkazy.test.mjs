#!/usr/bin/env node
/**
 * Měřitelné odkazy, UTM a měření.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-odkazy.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * Zadání, oddíl 18: „Zobraz pouze metriky, které daná síť a oprávnění
 * skutečně poskytují" a „Pokud není možné prokázat přímou atribuci,
 * označ výsledek jako odhad a nepředstírej přesnost."
 *
 * Nejdůležitější je proto rozdíl mezi NULOU a NEZMĚŘENO. Nula vypadá
 * jako propadák; prázdno se dá vysvětlit. Je to totéž rozhodnutí jako
 * u ceny v menu.
 */

import { readFileSync } from 'node:fs'

import {
  DELKA_KLICE,
  UKAZATELE,
  adresaOdkazu,
  bezDiakritiky,
  doporuceneUtm,
  hodnotaNaObrazovku,
  klicJePlatny,
  novyKlic,
  popisUkazatele,
  popisZdroje,
  zkontrolovatCil,
} from '../lib/marketing-odkazy.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, sk, ce) => ok(popis, sk === ce, `${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`)

console.log('\n== Klíč se dá opsat z plakátu ==')

const klic = novyKlic()
ma('klíč má osm znaků', klic.length, DELKA_KLICE)
ok('a projde omezením databáze', klicJePlatny(klic))

/*
  ZÁMĚNITELNÉ ZNAKY V KLÍČI NEJSOU. Nula od „o" a jednička od „l" se
  v běžném písmu nepozná — a klíč se opisuje z plakátu a z QR, které
  se nenačetlo.
*/
let zamenitelne = 0
for (let i = 0; i < 400; i++) {
  if (/[0o1li]/.test(novyKlic())) zamenitelne++
}
ma('ve čtyřech stech klíčích není jediný záměnitelný znak', zamenitelne, 0)

/*
  A ŽE SE KLÍČE NEOPAKUJÍ. Náhoda, která vrací totéž, by znamenala, že
  host jedné restaurace skončí na stránce druhé.
*/
const sada = new Set(Array.from({ length: 500 }, () => novyKlic()))
ok('pět set klíčů je pět set různých', sada.size === 500, `${sada.size}`)

/*
  NÁHODA JDE Z `crypto`, ne z `Math.random()`. Uhodnutelné klíče by
  dovolily zkoušet, co která restaurace chystá.
*/
const ZDROJ = readFileSync('lib/marketing-odkazy.ts', 'utf8')
const KOD = ZDROJ.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
ok('náhoda jde z crypto', /getRandomValues/.test(KOD))
ok('a ne z Math.random', !/Math\.random/.test(KOD))

ok('krátký klíč neprojde', !klicJePlatny('abc'))
ok('velká písmena neprojdou', !klicJePlatny('ABCDEF'))
ok('pomlčka neprojde', !klicJePlatny('abc-def'))

console.log('\n== Cíl se kontroluje dřív, než ho někdo otevře ==')

/*
  `javascript:` se do odkazu, který někdo otevře z telefonu, nedostane.
  Omezení sloupce ho zachytí taky, ale tohle je první linie a mluví
  česky.
*/
ok('javascript: neprojde', zkontrolovatCil('javascript:alert(1)').stav === 'chyba')
ok('data: neprojde', zkontrolovatCil('data:text/html,x').stav === 'chyba')
ok('file: neprojde', zkontrolovatCil('file:///etc/passwd').stav === 'chyba')

/*
  A TEĎ PŘÍPAD, KTERÝ MÍŘÍ PŘÍMO NA PROTOKOL.

  Tři kontroly výš procházely i po tom, co jsem kontrolu protokolu
  schválně vypnul — `javascript:` a `data:` nemají doménu, takže je
  zastavila až podmínka o tečce v hostname. Byly zelené ze správného
  důvodu jen náhodou.

  `ftp://` doménu MÁ. Projde tedy všude jinde a zastavit ho může
  jedině ta kontrola protokolu.
*/
ok('ftp: neprojde, i když má doménu',
  zkontrolovatCil('ftp://cernaperla.cz/menu.pdf').stav === 'chyba')
ok('a stejně tak neznámé schéma s doménou',
  zkontrolovatCil('mailto://info@cernaperla.cz').stav === 'chyba')
ok('nesmysl neprojde', zkontrolovatCil('tohle není adresa').stav === 'chyba')
ok('prázdno neprojde', zkontrolovatCil('   ').stav === 'chyba')
ok('adresa bez domény neprojde', zkontrolovatCil('https://localhost').stav === 'chyba')

const dobra = zkontrolovatCil('  https://cernaperla.cz/rezervace  ')
ok('normální adresa projde', dobra.stav === 'ok')
ma('a ořeže se', dobra.stav === 'ok' ? dobra.cil : '', 'https://cernaperla.cz/rezervace')

/*
  Hláška musí říct, co s tím. „Neplatná adresa" je pravda a k ničemu.
*/
const spatna = zkontrolovatCil('cernaperla.cz')
ok('hláška u špatné adresy ukazuje příklad',
  spatna.stav === 'chyba' && /https:\/\//.test(spatna.duvod))

console.log('\n== UTM podle zvyklostí ==')

const utm = doporuceneUtm({ kanal: 'instagram', kampan: 'Zabijačka u Perly!' })
ma('source je síť', utm.utm_source, 'instagram')
ma('medium je social', utm.utm_medium, 'social')

/*
  MALÁ PÍSMENA A BEZ DIAKRITIKY. Nástroje rozlišují velikost, takže
  „Zabijačka" a „zabijacka" by se počítaly zvlášť — a v adrese vypadá
  „%C5%BE" jako chyba.
*/
ma('campaign je bez diakritiky a malými', utm.utm_campaign, 'zabijacka-u-perly')

ma('háčky a čárky se rozloží', bezDiakritiky('Příliš žluťoučký kůň'), 'prilis-zlutoucky-kun')
ma('velká písmena jdou dolů', bezDiakritiky('ČERNÁ PERLA'), 'cerna-perla')
ma('interpunkce se nahradí pomlčkou', bezDiakritiky('menu: pá + so'), 'menu-pa-so')
ma('pomlčky na krajích se ořežou', bezDiakritiky('!!akce!!'), 'akce')
ma('prázdno zůstane prázdné', bezDiakritiky(''), '')

/*
  Diakritika se rozkládá přes normalize, ne tabulkou náhrad — ta by
  chyběla u prvního písmene, na které se zapomene. Ověřuje se to na
  písmenech, která v žádné ručně psané tabulce většinou nejsou.
*/
ma('i na méně obvyklých písmenech', bezDiakritiky('ďábelské ťukání ňa'), 'dabelske-tukani-na')

ma('bez kampaně zůstane campaign prázdná', doporuceneUtm({ kanal: 'facebook' }).utm_campaign, '')

console.log('\n== Adresa odkazu ==')

ma('složí se z domény a klíče', adresaOdkazu('https://foodtab.cz', 'abc23def'), 'https://foodtab.cz/k/abc23def')
ma('lomítko navíc nevadí', adresaOdkazu('https://foodtab.cz/', 'abc23def'), 'https://foodtab.cz/k/abc23def')
ma('ani víc lomítek', adresaOdkazu('https://foodtab.cz///', 'abc23def'), 'https://foodtab.cz/k/abc23def')

console.log('\n== NULA NENÍ TOTÉŽ CO NEZMĚŘENO ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  Kdyby se prázdno kreslilo jako nula, vypadal by příspěvek, u kterého
  se nepodařilo nic stáhnout, jako propadák. Je to totéž rozhodnutí
  jako u ceny v menu — a stejně jako tam se dá rozbít tiše.
*/
ma('neměřeno je pomlčka, ne nula', hodnotaNaObrazovku(null), '—')
ma('a chybějící taky', hodnotaNaObrazovku(undefined), '—')
ma('ale skutečná nula je nula', hodnotaNaObrazovku(0), '0')
ma('a čísla se oddělují po tisících', hodnotaNaObrazovku(12345), '12 345'.replace(' ', ' '))

console.log('\n== Odhad se říká nahlas ==')

/*
  Zadání, oddíl 18: „Pokud není možné prokázat přímou atribuci, označ
  výsledek jako odhad a nepředstírej přesnost."
*/
ok('u odhadu je to vidět velkými', /ODHAD/.test(popisZdroje('odhad')))
ok('a řekne se, že je to nepřesné', /nepřesné/.test(popisZdroje('odhad')))
ma('číslo ze sítě se označí', popisZdroje('sit'), 'ze sítě')
ma('vlastní měření taky', popisZdroje('vlastni'), 'změřeno u nás')

console.log('\n== Ukazatele se kryjí s databází ==')

/*
  Ukazatel, který databáze nezná, by se nedal uložit — a zjistilo by se
  to až tím, že úloha spadne na omezení sloupce.
*/
const MIGRACE = readFileSync('supabase/migrations/20260914180000_marketing_metriky.sql', 'utf8')
const blok = MIGRACE.match(/ukazatel\s+text not null check \(ukazatel in\s*\(([\s\S]*?)\)\)/)
ok('omezení `ukazatel` se v migraci našlo', Boolean(blok))

const zDb = (blok?.[1] ?? '').match(/'([a-zá-ž_]+)'/gu)?.map((x) => x.replaceAll("'", '')) ?? []
ok('a je v něm aspoň osm ukazatelů', zDb.length >= 8, `${zDb.length}`)
ma('kód zná přesně tytéž',
  UKAZATELE.map((u) => u.klic).slice().sort().join(),
  zDb.slice().sort().join())

ok('a každý má český název', UKAZATELE.every((u) => u.nazev.length > 2))
ma('neznámý ukazatel se nepřeloží na prázdno', popisUkazatele('vymysleny'), 'vymysleny')

console.log('\n== Co migrace slibuje ==')

/*
  Hodnota smí být prázdná — to je celý smysl. Kdyby byla `not null`,
  musela by se neznámá čísla ukládat jako nula.
*/
ok('hodnota metriky smí být prázdná',
  /hodnota\s+bigint check \(hodnota is null or hodnota >= 0\)/.test(MIGRACE))
ok('a nemá default 0', !/hodnota\s+bigint[^\n]*default 0/.test(MIGRACE))

ok('u každého čísla je vidět, odkud je',
  /zdroj\s+text not null check \(zdroj in \('sit', 'vlastni', 'odhad'\)\)/.test(MIGRACE))

/*
  Měření nesmí dopsat přihlášený uživatel. Výkon příspěvku, do kterého
  může kdokoli psát, není doklad o ničem.
*/
ok('metriky uživatel nedopíše',
  /grant select on public\.marketing_metriky to authenticated;/.test(MIGRACE)
  && !/grant select, insert[^\n]*marketing_metriky/.test(MIGRACE))

/*
  Klíč je jedinečný v CELÉ databázi, ne jen ve firmě: adresa /k/abc
  firmu nenese, takže dva stejné klíče znamenají hosta na cizí stránce.
*/
ok('klíč odkazu je jedinečný globálně',
  /create unique index marketing_odkazy_klic\s+on public\.marketing_odkazy \(klic\);/.test(MIGRACE))

/*
  Proklik se počítá V TÉŽE funkci, která přesměrovává. Dvě místa by se
  rozešla, kdyby jedno selhalo.
*/
ok('proklik se počítá při přesměrování',
  /update public\.marketing_odkazy[\s\S]{0,120}prokliku = prokliku \+ 1/.test(MIGRACE))

/*
  Neznámý klíč vrací prázdno, ne vysvětlení. Rozdíl mezi „neexistuje"
  a „je vypnutý" by dovolil zkoušet klíče.
*/
ok('neznámý klíč nevrací vysvětlení',
  /if v_id is null then\s*\n\s*return null;/.test(MIGRACE))

/*
  A žádná IP ani user-agent. Měří se POČET, ne lidé.
*/
ok('u prokliku se nesbírá IP ani prohlížeč',
  !/ip_adresa|user_agent|useragent/i.test(MIGRACE))

console.log('\n== Veřejná adresa /k/<klíč> ==')

const ROUTE = readFileSync('app/k/[klic]/route.ts', 'utf8')
const ROUTE_KOD = ROUTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

ok('adresa existuje', ROUTE.length > 800)
ok('a volá funkci databáze', /rpc\('marketing_prejit'/.test(ROUTE_KOD))

/*
  NEZNÁMÝ, VYPNUTÝ I ROZBITÝ KLÍČ DOPADNOU STEJNĚ — 404 a nic dalšího.
  Kdyby se lišily, dalo by se zkoušením klíčů zjistit, co která
  restaurace chystala a co zrušila.
*/
const odpovedi = [...ROUTE_KOD.matchAll(/status: (\d{3})/g)].map((m) => m[1])
ok('všechny neúspěchy končí 404', odpovedi.filter((s) => s !== '302').every((s) => s === '404'))
ok('a žádná z nich nic nevysvětluje',
  !/status: 404[\s\S]{0,80}(chyba|duvod|message)/.test(ROUTE_KOD))

/*
  302, NE 301. Trvalé přesměrování si prohlížeč zapamatuje a příště na
  naši adresu nesáhne — takže by se přestaly počítat prokliky.
*/
ok('přesměrování je dočasné (302)', /status: 302/.test(ROUTE_KOD))
ok('a ne trvalé (301)', !/status: 301/.test(ROUTE_KOD))
ok('a nesmí se ukládat do mezipaměti', /no-store/.test(ROUTE_KOD))

/*
  Adresa se nepočítá sama — proklik připočítá táž funkce, která vrací
  cíl. Dvě místa by se rozešla, kdyby jedno selhalo.
*/
ok('adresa si prokliky nepočítá sama',
  !/prokliku/.test(ROUTE_KOD) && !/\.update\(/.test(ROUTE_KOD))

console.log('\n== Obrazovka Analytika ==')

const STRANKA = readFileSync('app/[rozsah]/marketing/analytika/page.tsx', 'utf8')
const STRANKA_KOD = STRANKA.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

ok('obrazovka má tělo', STRANKA.length > 4000)
ok('kreslí hodnoty přes sdílenou funkci', /hodnotaNaObrazovku\(/.test(STRANKA_KOD))
ok('a u čísel je vidět, odkud jsou', /popisZdroje\(/.test(STRANKA_KOD))

/*
  NEJDŮLEŽITĚJŠÍ NA TÉHLE OBRAZOVCE: prázdno se nekreslí jako nula.
  Součet, ve kterém nic není, vrací `null`, ne 0.
*/
ok('chybějící ukazatel vrací prázdno, ne nulu',
  /if \(vybrane\.length === 0\) return \{ hodnota: null/.test(STRANKA_KOD))

ok('a obrazovka to říká i slovy',
  /Pomlčka znamená/.test(STRANKA) && /neměřeno/.test(STRANKA))

/*
  Odhad nakazí celý součet. Sečíst změřené s odhadnutým a tvářit se, že
  je to změřené, je přesně to, co zadání zakazuje.
*/
ok('jeden odhad udělá odhad z celého součtu',
  /some\(\(m\) => m\.zdroj === 'odhad'\) \? 'odhad'/.test(STRANKA_KOD))

ok('QR se kreslí', /qrSvg\(/.test(STRANKA_KOD))

/*
  QR JEN U ZAPNUTÉHO ODKAZU. Vytisknout QR, který nikam nevede, je
  horší než ho nenabídnout — plakát zůstane viset měsíce.
*/
ok('QR jen u zapnutého odkazu', /o\.aktivni && zaklad \?[\s\S]{0,200}qrSvg/.test(STRANKA_KOD))

/*
  Bez adresy aplikace se nedá složit celý odkaz. Hádat ji z hlaviček by
  znamenalo, že se QR na jiné doméně vytiskne se špatnou adresou —
  a pozná se to až z vytištěného plakátu.
*/
ok('chybějící adresa aplikace se řekne', /NEXT_PUBLIC_APP_URL/.test(STRANKA))

ok('obrazovka do databáze nepíše',
  !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(STRANKA_KOD))

ok('ptá se na marketing.read', /'marketing\.read'/.test(STRANKA_KOD))
ok('a měnit smí jen marketing.manage', /'marketing\.manage'/.test(STRANKA_KOD))

/*
  tenant_id v každém dotazu (pravidlo 3). Krájí se po `from(`, ne po
  N znacích — okno pevné délky přeteče do dotazu vedle a kontrola pak
  neumí spadnout.
*/
const useky = STRANKA_KOD.split(/(?=from\(')/).filter((u) => u.startsWith("from('"))
const bezFirmy = useky.filter((u) =>
  !/\.eq\('tenant_id', tenantId\)/.test(u) && !/\.eq\('id', tenantId\)/.test(u))
ok(`každý dotaz má filtr na firmu (bez něj: ${bezFirmy.length})`, bezFirmy.length === 0)

console.log('\n== Vypnutí odkazu nemaže ==')

const AKCE = readFileSync('app/[rozsah]/marketing/analytika/akce.ts', 'utf8')
const AKCE_KOD = AKCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

/*
  Odkaz je vytištěný na plakátu a vyfocený v příspěvku. Smazat ho
  znamená, že hostům přestane fungovat a nikdo nezjistí proč — a s ním
  zmizí i počet prokliků, tedy jediné číslo, které o té kampani máme.
*/
ok('akce odkaz nemaže, jen přepíná', !/\.delete\(/.test(AKCE_KOD))
ok('a přepíná příznak aktivni', /aktivni: zapnout/.test(AKCE_KOD))

ok('cíl se kontroluje před uložením', /zkontrolovatCil\(/.test(AKCE_KOD))
ok('klíč se vyrábí knihovnou', /novyKlic\(\)/.test(AKCE_KOD))

/*
  Srážka klíčů se zkouší víckrát, ale KONEČNĚKRÁT. Smyčka bez konce je
  horší než hláška „zkuste to znovu".
*/
ok('srážka klíčů se zkusí znovu, ale konečněkrát',
  /for \(let pokus = 0; pokus < 3/.test(AKCE_KOD))
ok('a jiná chyba než srážka se neschová',
  /duplicate key/.test(AKCE_KOD) && /chybne\(rozsah, error\.message\)/.test(AKCE_KOD))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
