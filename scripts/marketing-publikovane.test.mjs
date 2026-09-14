#!/usr/bin/env node
/**
 * Publikované příspěvky a jejich stavy.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-publikovane.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * 1. ŽE SE SEZNAM STAVŮ KRYJE S DATABÁZÍ. Stav, pro který obrazovka
 *    nemá překlad, se v přehledu ukáže jako `publikace_selhala` místo
 *    věty. Nic nespadne — jen to vypadá jako chyba v datech.
 *
 * 2. ŽE SE NANEČISTO NEPOČÍTÁ MEZI SKUTEČNÉ. Tohle je v celém modulu
 *    to nejdůležitější číslo: zkouška nanečisto NIC neposílá ven.
 *    Kdyby se sečetla se zveřejněnými, ukazoval by přehled počet
 *    příspěvků, které nikdo nikdy neviděl.
 *
 * 3. ŽE SE RUČNÍ ZVEŘEJNĚNÍ NETVÁŘÍ JAKO PORUCHA. Je to normální stav
 *    — firma si vybrala ruční režim. Kdyby svítil mezi chybami, chodil
 *    by to někdo opravovat.
 */

import { readFileSync } from 'node:fs'

import {
  STAVY_ULOH,
  STAVY_ULOH_CEKAJICI,
  STAVY_ULOH_CHYBOVE,
  STAVY_ULOH_HOTOVE,
  popisStavuUlohy,
  radaKeStavu,
  spocitatUlohy,
} from '../lib/marketing-text.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano),
     `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

const VYSTUP = readFileSync('supabase/migrations/20260910000000_marketing_vystup.sql', 'utf8')

console.log('\n== Stavy úloh se kryjí s databází ==')

/*
  Vyříznutí ze zdrojáku migrace. Kdyby výraz nesedl, vyšel by prázdný
  seznam a všechny kontroly níž by byly zelené nad ničím — proto se
  nejdřív ověřuje, že se vůbec něco našlo.
*/
const blok = VYSTUP.match(
  /create table public\.marketing_publikace_ulohy[\s\S]*?stav\s+text not null default 'naplanovano' check \(stav in\s*\(([\s\S]*?)\)\)/,
)
ok('omezení sloupce `stav` se v migraci našlo', Boolean(blok))

const zDatabaze = (blok?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((x) => x.replaceAll("'", '')) ?? []
ok('a je v něm aspoň osm stavů', zDatabaze.length >= 8, `nalezeno ${zDatabaze.length}`)

ma('kód zná přesně tytéž stavy jako databáze',
  Object.keys(STAVY_ULOH).slice().sort(), zDatabaze.slice().sort())

ok('a každý má českou větu',
  Object.values(STAVY_ULOH).every((v) => typeof v === 'string' && v.length > 2))

/*
  Neznámý stav se nepřekládá na prázdno. Prázdno by ze sloupce zmizelo
  beze stopy a vypadalo by to, že úloha žádný stav nemá.
*/
ma('neznámý stav se nepřekládá na prázdno', popisStavuUlohy('vymysleny'), 'vymysleny')
ma('známý se přeloží', popisStavuUlohy('ve_fronte'), 've frontě')

console.log('\n== Skupiny stavů se nepřekrývají a nic nevynechávají ==')

const vSkupinach = [
  ...STAVY_ULOH_CHYBOVE,
  ...STAVY_ULOH_CEKAJICI,
  ...STAVY_ULOH_HOTOVE,
  'k_rucnimu_zverejneni',
  'zruseno',
]

ma('žádný stav není ve dvou skupinách', vSkupinach.length, new Set(vSkupinach).size)
ma('a všechny stavy z databáze jsou v nějaké skupině',
  zDatabaze.filter((s) => !vSkupinach.includes(s)), [])

console.log('\n== Nanečisto není zveřejněno ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  `zverejneno_nanecisto` znamená, že prošla celá cesta a na síť se
  NIC neposlalo. Kdyby se počítalo mezi skutečná zveřejnění, hlásil by
  přehled čísla, která nikdy nikdo neviděl — a přesně tomu má celý
  modul zabránit.
*/
ok('nanečisto má vlastní stav', 'zverejneno_nanecisto' in STAVY_ULOH)
ok('a v jeho větě je vidět, že je to demo',
  /nanečisto|demo/i.test(STAVY_ULOH.zverejneno_nanecisto))
ok('a rada u něj říká nahlas, že nic neodešlo',
  /NIC NEODEŠLO/.test(radaKeStavu('zverejneno_nanecisto', 'demo')))

/*
  A TEĎ SE TO DOOPRAVDY SPOČÍTÁ.

  Tahle kontrola tu původně byla jako grep do zdrojáku obrazovky:
  „stojí za `skutecne:` řetězec `'zverejneno'`?". Při zkoušce se
  ukázalo, že NEUMÍ SPADNOUT na tom, co má hlídat — přepsal jsem
  `u.stav === 'zverejneno'` na `u.stav.startsWith('zverejneno')`,
  čímž se nanečisto začalo počítat mezi skutečná, a kontrola zůstala
  zelená, protože ten řetězec tam pořád byl.
*/
const vzorek = [
  { stav: 'zverejneno' },
  { stav: 'zverejneno' },
  { stav: 'zverejneno_nanecisto' },
  { stav: 'selhalo' },
  { stav: 'vzdano' },
  { stav: 'k_rucnimu_zverejneni' },
  { stav: 've_fronte' },
  { stav: 'naplanovano' },
  { stav: 'zruseno' },
]
const p = spocitatUlohy(vzorek)

ma('skutečně zveřejněné se spočítají', p.skutecne, 2)
ma('nanečisto se spočítá zvlášť', p.nanecisto, 1)
ma('a NEPŘIČTE se ke skutečným', p.skutecne, 2)
ma('chyby se spočítají', p.chyby, 2)
ma('ruční zvlášť', p.rucne, 1)
ma('a čekající taky', p.ceka, 2)

/*
  Zvlášť ostrá podoba téže věci: v seznamu, kde JE JEN nanečisto,
  musí vyjít nula skutečných. Kdyby se porovnávalo předponou, vyšla
  by jednička.
*/
ma('samotné nanečisto dá nula skutečných',
  spocitatUlohy([{ stav: 'zverejneno_nanecisto' }]).skutecne, 0)

ma('a prázdný seznam dá samé nuly',
  spocitatUlohy([]), { skutecne: 0, nanecisto: 0, chyby: 0, rucne: 0, ceka: 0 })

console.log('\n== Ruční zveřejnění není porucha ==')

/*
  Firma si vybrala ruční režim, úloha čeká na člověka a nic se
  nepokazilo. Kdyby to spadlo mezi chyby, svítilo by to červeně
  a někdo by to šel opravovat.
*/
ok('ruční zveřejnění není mezi chybami',
  !STAVY_ULOH_CHYBOVE.includes('k_rucnimu_zverejneni'))
ok('ani zrušení', !STAVY_ULOH_CHYBOVE.includes('zruseno'))
ma('chybové stavy jsou právě dva', STAVY_ULOH_CHYBOVE.length, 2)
ok('a jsou to selhalo a vzdano',
  STAVY_ULOH_CHYBOVE.includes('selhalo') && STAVY_ULOH_CHYBOVE.includes('vzdano'))

console.log('\n== Rada se odvíjí od stavu A režimu ==')

/*
  U ručního zveřejnění se rada liší podle toho, PROČ tam úloha je:
  buď si to firma vybrala, nebo nemá připojený nástroj. Jedna věta pro
  obojí by v prvním případě strašila poruchou, která není, a ve druhém
  zamlčela, co je potřeba udělat.
*/
const vybrali = radaKeStavu('k_rucnimu_zverejneni', 'rucni')
const nepripojeno = radaKeStavu('k_rucnimu_zverejneni', 'zakaznicky')
ok('u vybraného ručního režimu rada uklidňuje', /v pořádku/i.test(vybrali))
ok('u nepřipojeného nástroje radí připojit', /Nástroje/.test(nepripojeno))
ok('a jsou to dvě různé věty', vybrali !== nepripojeno)

ok('u vzdáno se radí podívat se na chybu', radaKeStavu('vzdano', 'zakaznicky').length > 40)
ok('u selhalo se říká, že se to zkusí znovu',
  /znovu/i.test(radaKeStavu('selhalo', 'zakaznicky')))
ok('u zrušeno se vysvětlí proč',
  /nová verze|nové schválení/i.test(radaKeStavu('zruseno', 'zakaznicky')))

/*
  U stavů, kde se nic neděje, se NERADÍ. Věta „všechno je v pořádku"
  u každého řádku je šum, ve kterém zanikne ta jedna, na které záleží.
*/
ma('u naplánováno se neradí nic', radaKeStavu('naplanovano', 'zakaznicky'), '')
ma('u zveřejněno taky ne', radaKeStavu('zverejneno', 'zakaznicky'), '')

/*
  Rada se NEODVOZUJE Z TEXTU CHYBY. Hádat podle řetězce od
  poskytovatele znamená mít kód, který se rozbije, až Meta přeformuluje
  hlášku — a nepozná se to, protože se nic nezmění, jen se přestane
  radit.
*/
const ZDROJ_TEXTU = readFileSync('lib/marketing-text.ts', 'utf8')
const telo = ZDROJ_TEXTU.slice(ZDROJ_TEXTU.indexOf('export function radaKeStavu'))
ok('rada nešťourá v textu chyby',
  !/posledni_chyba|\.includes\(['"](token|expired|scope)/i.test(telo))

console.log('\n== Obrazovka to opravdu používá ==')

const STRANKA = readFileSync('app/[rozsah]/marketing/publikovane/page.tsx', 'utf8')
const KOD = STRANKA
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ok('obrazovka má tělo', STRANKA.length > 3000)

/*
  Stav se bere z ÚLOHY, ne z příspěvku. `marketing_prispevky.stav` je
  souhrn pro seznam; co doopravdy odešlo, ví jen úloha — tu mění fronta
  podle odpovědi poskytovatele.
*/
ok('čte se z publikačních úloh', /from\('marketing_publikace_ulohy'\)/.test(KOD))
ok('a stav se překládá sdílenou funkcí', /popisStavuUlohy\(/.test(KOD))
ok('a rada se bere taky z knihovny', /radaKeStavu\(/.test(KOD))

/*
  Obrazovka nic nepřepisuje. Stav publikace patří frontě — kdyby ho
  měnila obrazovka, vznikla by druhá cesta, jak prohlásit něco za
  zveřejněné.
*/
ok('obrazovka do databáze nepíše',
  !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(KOD))

ok('nanečisto má na obrazovce vlastní štítek', /NANEČISTO/.test(STRANKA))

/*
  Obrazovka si čísla NEPOČÍTÁ SAMA. Kdyby ano, byla by to druhá kopie
  pravidla o tom, co se počítá mezi zveřejněné — a kontrola výš by
  měřila knihovnu, zatímco na obrazovce by stálo něco jiného.
*/
ok('čísla se berou ze sdílené funkce', /spocitatUlohy\(/.test(KOD))
ok('a obrazovka si je nepočítá sama',
  !/ulohy\.filter\([\s\S]{0,60}zverejneno/.test(KOD))

/*
  U zkoušky nanečisto se NENABÍZÍ odkaz na síť. Žádný neexistuje —
  nabídnout ho znamená slíbit stránku, která tam není.
*/
ok('u nanečisto se nenabízí odkaz ven', /!nanecisto && pub\?\.trvaly_odkaz/.test(KOD))
ok('ani číslo u poskytovatele', /!nanecisto && u\.externi_id/.test(KOD))

/*
  HLEDÁ SE VYKRESLENÍ, NE ZMÍNKA. `posledni_chyba` stojí i ve výčtu
  sloupců dotazu, takže kontrola na pouhý výskyt projde i tehdy, když
  se ta hláška na obrazovku vůbec nedostane — vyzkoušeno rozbitím.
*/
ok('původní hlášení od poskytovatele se opravdu vykresluje',
  /\{u\.posledni_chyba \?/.test(KOD) && /Hlášení:/.test(STRANKA))
ok('a u opakování je vidět kolikátý pokus', /pokusy/.test(KOD) && /max_pokusu/.test(KOD))

console.log('\n== Čas jde přes pásmo (pravidlo 11) ==')

ok('formátuje se přes lib/cas.ts', /datumACasVPasmu\(/.test(KOD))
ok('nepoužívá se getHours a spol.', !/\.get(Hours|Date|Month|FullYear)\(\)/.test(KOD))
ok('ani toISOString', !/toISOString\(/.test(KOD))
ok('pásmo se bere z pobočky', /branches'\)[\s\S]{0,120}timezone/.test(KOD))
ok('s pojistkou přes firmu', /tenants'\)[\s\S]{0,80}timezone/.test(KOD))

console.log('\n== Přístup a filtry ==')

ok('ptá se na marketing.read', /'marketing\.read'/.test(KOD))
ok('nepřihlášeného posílá na přihlášení', /redirect\('\/prihlaseni'\)/.test(KOD))
ok('síť se ověřuje proti seznamu', /KANALY\.some\(/.test(KOD))
ok('stav proti seznamu stavů', /in STAVY_ULOH/.test(KOD))

console.log('\n== Detail příspěvku už nemá vlastní kopii seznamu ==')

/*
  Do 14. 9. stál seznam stavů uvnitř `[prispevek]/page.tsx`. Dvě kopie
  téhož seznamu se rozejdou — a pozná se to až tím, že jedna obrazovka
  ukazuje větu a druhá databázový výraz.
*/
const DETAIL = readFileSync('app/[rozsah]/marketing/[prispevek]/page.tsx', 'utf8')
ok('detail nemá vlastní STAVY_ULOH', !/const STAVY_ULOH/.test(DETAIL))
ok('a bere je z knihovny', /popisStavuUlohy/.test(DETAIL))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
