#!/usr/bin/env node
/**
 * Upozornění — texty na obrazovce.
 *
 * Pusť `node --experimental-strip-types scripts/upozorneni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO TO OVĚŘUJE A CO NE
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 2 je na tomhle
 * výslovné: „První je úkol, druhé je informace. NESMÍ VYPADAT STEJNĚ.“
 * Kdo čeká na oprávnění, a kdo ho už má, se musí poznat na první
 * pohled, ne až z odstavce pod nadpisem.
 *
 * Že se upozornění vůbec založí a komu, hlídá scénář
 * `supabase/tests/krok12_scenar.sql`. Tady jde jen o věty.
 *
 * Obrazovka `app/[rozsah]/upozorneni/page.tsx` je serverová komponenta
 * s dotazy do databáze a vykreslit se mimo aplikaci nedá. Proto je
 * poslední kontrola v souboru o tom, že ty funkce OPRAVDU VOLÁ —
 * jinak by se ověřovalo něco, co na obrazovku nevede.
 */

import fs from 'node:fs'

import {
  denCesky,
  denZkraceny,
  nadpisUpozorneni,
  obdobiRozpisu,
  popisMarketingu,
  popisOpravneni,
  popisZapomenuteho,
  vyzadujePotvrzeni,
  zmenaSmeny,
  odkazNaSmenu,
  kartaZmenySmeny,
  pocetUpozorneni,
  pocitaSeDoOdznaku,
  prioritaUpozorneni,
  slovoPodleCisla,
  souhrnCekajicich,
} from '../lib/upozorneni-text.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const obdobi = (od, doKdy) => `${od ?? ''} – ${doKdy ?? ''}`

console.log('\n== Úkol a informace nevypadají stejně ==')

const ceka = { jmeno: 'Láďa', kdo: 'u1', ceka: true, role: null, pobocky: [] }
const ma_ = {
  jmeno: 'Láďa',
  kdo: 'u1',
  ceka: false,
  role: 'Servis',
  pobocky: ['Restaurace Černá Perla'],
}

const nadpisCeka = nadpisUpozorneni('pozvanka.prijata', ceka, obdobi)
const nadpisMa = nadpisUpozorneni('pozvanka.prijata', ma_, obdobi)

ma('kdo čeká, to má v nadpisu', nadpisCeka, 'Láďa přijal pozvánku a čeká na oprávnění')
ma('kdo nečeká, má nadpis kratší', nadpisMa, 'Láďa přijal pozvánku')
ma('a nejsou to tytéž nadpisy', nadpisCeka === nadpisMa, false)

ma(
  'oprávnění je vypsané, ne jen „má“',
  popisOpravneni(ma_),
  'Má oprávnění Servis, Restaurace Černá Perla.',
)
ma('bez role a poboček se nic nevymýšlí', popisOpravneni(ceka), 'Oprávnění už má.')

console.log('\n== Ostatní druhy zůstávají ==')

ma(
  'rozpis',
  nadpisUpozorneni('rozpis.vydan', { od: 'po', do: 'ne' }, obdobi),
  'Rozpis po – ne',
)
ma(
  'přidělené oprávnění',
  nadpisUpozorneni('opravneni.prideleno', {}, obdobi),
  'Máte přidělené oprávnění',
)

/*
  Neznámý druh se nesmí zamlčet. Kdyby se vrátil prázdný řetězec,
  upozornění by na obrazovce vypadalo jako prázdný rámeček a nikdo by
  nevěděl, že něco přišlo.
*/
ma('neznámý druh se nezamlčí', nadpisUpozorneni('neco.noveho', {}, obdobi), 'Upozornění')

console.log('\n== Chybějící jméno nesmí dát „undefined“ ==')

ma(
  'bez jména se řekne „Někdo“',
  nadpisUpozorneni('pozvanka.prijata', { ceka: true }, obdobi),
  'Někdo přijal pozvánku a čeká na oprávnění',
)

console.log('\n== Zapomenutý odchod: svému a cizímu se říká jinak ==')

const mujOdchod = {
  moje: true,
  jmeno: 'Láďa',
  den: '2026-08-31',
  prichod: '11:27',
  pobocka: 'Restaurace Černá Perla',
}
const cizi = { ...mujOdchod, moje: false }

ma(
  'sobě „chybí vám“',
  nadpisUpozorneni('dochazka.zapomenuty_odchod', mujOdchod, obdobi),
  'Chybí vám odchod z pondělí 31. 8.',
)
ma(
  'cizímu „Láďa nemá“',
  nadpisUpozorneni('dochazka.zapomenuty_odchod', cizi, obdobi),
  'Láďa nemá odchod z pondělí 31. 8.',
)

/*
  Vedoucí by jinak hledal svůj chybějící odchod. Rozdíl musí být
  v NADPISU, ne až v odstavci pod ním.
*/
ma(
  'a nejsou to tytéž nadpisy',
  nadpisUpozorneni('dochazka.zapomenuty_odchod', mujOdchod, obdobi) ===
    nadpisUpozorneni('dochazka.zapomenuty_odchod', cizi, obdobi),
  false,
)

ma(
  'sobě se řekne, co se stane, když se nic neudělá',
  popisZapomenuteho(mujOdchod),
  'Příchod v 11:27. Restaurace Černá Perla. Dokud odchod nedoplníte, směna se nezapočítá do odpracovaných hodin.',
)
ma('cizímu stačí holý údaj', popisZapomenuteho(cizi), 'Příchod v 11:27. Restaurace Černá Perla.')

/*
  Chybějící odchod je PROVOZNÍ věc, ne mzdová. Kdyby se do textu dostala
  sazba nebo částka, platila by na upozornění jiná pravidla — a hlavně
  by se mzdový údaj dostal tam, kam nepatří.
*/
for (const t of [popisZapomenuteho(mujOdchod), popisZapomenuteho(cizi)]) {
  ma('v textu není částka', /Kč|halé|sazb|mzd/i.test(t), false)
}

ma('bez dne se nevymýšlí datum', denCesky(undefined), 'neznámého dne')
ma('nesmyslné datum se nepřebarví na dnešek', denCesky('nesmysl'), 'nesmysl')

/*
  denZkraceny/obdobiRozpisu se 17.9.2026 v noci přesunuly z
  app/[rozsah]/upozorneni/page.tsx do lib/upozorneni-text.ts (rozbalovací
  panel zvonečku je taky potřebuje) — přesně proto, aby na ně šla
  napsat kontrola, ne aby zůstaly zamčené v serverové komponentě.
*/
ma('denZkraceny dá den v týdnu zkráceně', denZkraceny('2026-09-10'), 'čt 10. 9.')
ma('nesmyslné datum se nepřebarví', denZkraceny('nesmysl'), 'nesmysl')
ma('bez obou dat je období prázdné', obdobiRozpisu(undefined, undefined), '')
ma('období spojí dva zkrácené dny', obdobiRozpisu('2026-09-10', '2026-09-12'), 'čt 10. 9. – so 12. 9.')

console.log('\n== Obrazovka ty funkce opravdu volá ==')

const stranka = fs.readFileSync(
  new URL('../app/[rozsah]/upozorneni/page.tsx', import.meta.url),
  'utf8',
)
ma('nadpis se bere z lib/upozorneni-text',
  stranka.includes('nadpisUpozorneni(z.druh, z.telo, obdobiRozpisu)'), true)
ma('a popis oprávnění taky', stranka.includes('popisOpravneni(z.telo)'), true)
ma('i popis zapomenutého odchodu',
  stranka.includes('popisZapomenuteho(z.telo)'), true)
ma('vlastní kopie na obrazovce nezůstala',
  stranka.includes('function nadpisZpravy'), false)

console.log('\n== A o pushi se nikde nepíše ==')

/*
  Zadání, oddíl 4: „Nepiš do rozhraní, že push chodí, dokud nechodí.“
  Prochází se obrazovky, kterých se to týká.
*/
const KOREN = new URL('..', import.meta.url)
const soubory = [
  'app/moje-udaje/page.tsx',
  'app/[rozsah]/upozorneni/page.tsx',
  'app/[rozsah]/ceka-na-opravneni.tsx',
]
for (const f of soubory) {
  const text = fs.readFileSync(new URL(f, KOREN), 'utf8')
  /*
    Kouká se jen na text, který se vykresluje: komentáře jdou pryč
    (zmínka o tom, že push NEchodí, je v pořádku) a s nimi i volání
    `.push(` — metoda pole není slib uživateli. Tohle si vysloužilo
    komentář tím, že to napoprvé shodilo kontrolu na
    `posluchaci.push(zmena)`.
  */
  const vykreslene = text
    .split('\n')
    .filter((r) => !r.trimStart().startsWith('*') && !r.trimStart().startsWith('//'))
    .join('\n')
    .split('.push(')
    .join('.pridat(')
  ma(`${f} neslibuje push`, /\bpush\b/i.test(vykreslene), false)
}

console.log('\n== Marketing: žádost, rozhodnutí, selhání ==')

/*
  Zadání, oddíl 14: „pošli notifikaci při žádosti o schválení, vrácení,
  schválení a selhání publikace".

  NADPIS ŘÍKÁ, CO SE STALO, NE CO JE TO ZA DRUH ZPRÁVY. „Čeká na vaše
  odklepnutí" je výzva; „Marketing — žádost" by byl štítek, ze kterého
  člověk nepozná, jestli má něco udělat.
*/
const zadost = { prispevek: 'p1', nazev: 'Zabijačka', pobocka: 'Černá Perla', kdo: 'Danuše' }

ma('žádost vyzývá k odklepnutí',
  nadpisUpozorneni('marketing.zadost', zadost, obdobi),
  'Zabijačka čeká na vaše odklepnutí')

ma('a v textu je vidět kdo a kde',
  popisMarketingu('marketing.zadost', zadost),
  'Danuše žádá o schválení. Černá Perla.')

/*
  Bezejmenný příspěvek se nesmí přeložit na prázdno — nadpis „ čeká na
  vaše odklepnutí" vypadá jako chyba vykreslování.
*/
ma('bez názvu se řekne aspoň „Příspěvek"',
  nadpisUpozorneni('marketing.zadost', {}, obdobi),
  'Příspěvek čeká na vaše odklepnutí')

ma('a bez jména žadatele se to nezamlčí',
  popisMarketingu('marketing.zadost', { nazev: 'X' }),
  'Někdo žádá o schválení.')

console.log('')

const schvaleno = { prispevek: 'p1', nazev: 'Zabijačka', schvaleno: true, kdo: 'Provozní' }
const vraceno = { prispevek: 'p1', nazev: 'Zabijačka', schvaleno: false, kdo: 'Provozní', pripominka: 'Chybí cena.' }

ma('schválení a vrácení mají JINÝ nadpis',
  [nadpisUpozorneni('marketing.rozhodnuto', schvaleno, obdobi),
   nadpisUpozorneni('marketing.rozhodnuto', vraceno, obdobi)].join(' | '),
  'Zabijačka je schválený | Zabijačka vám vrátili')

/*
  U VRÁCENÍ JE PŘIPOMÍNKA POVINNÁ ČÁST VĚTY, ne doplněk. Bez ní je
  zpráva k ničemu: člověk ví, že to neprošlo, a netuší proč.
*/
ma('u vrácení je vidět připomínka',
  popisMarketingu('marketing.rozhodnuto', vraceno),
  'Provozní ho vrátil: Chybí cena.')

ma('a chybějící připomínka se řekne nahlas, ne zamlčí',
  popisMarketingu('marketing.rozhodnuto', { schvaleno: false, kdo: 'Provozní' }),
  'Provozní ho vrátil, ale nenapsal proč.')

ma('u schválení se řekne, co dál',
  popisMarketingu('marketing.rozhodnuto', schvaleno),
  'Provozní ho schválil. Teď se dá naplánovat ke zveřejnění.')

console.log('')

const selhani = {
  prispevek: 'p1', nazev: 'Zabijačka', kanal: 'instagram',
  pokusy: 5, duvod: 'The access token has expired.',
}

/*
  SELHÁNÍ SE ŘÍKÁ NAHLAS. „Nevyšlo" by znělo jako drobnost — přitom
  to znamená, že příspěvek na síti NENÍ a bez člověka tam nebude.
*/
ma('selhání nezlehčuje',
  nadpisUpozorneni('marketing.publikace_selhala', selhani, obdobi),
  'Zabijačka se nepodařilo zveřejnit')

const textSelhani = popisMarketingu('marketing.publikace_selhala', selhani)
ma('v textu je síť', /Instagram/.test(textSelhani), true)
ma('a počet pokusů', /5 pokusech/.test(textSelhani), true)
ma('a že se to samo už nezkusí', /nezkusí/.test(textSelhani), true)

/*
  PŮVODNÍ HLÁŠKA OD POSKYTOVATELE ZŮSTÁVÁ, i když je anglicky a mluví
  o tokenech. Radu česky má obrazovka Publikované; tady jde o to, aby
  šlo dohledat, co se doopravdy stalo.
*/
ma('a původní hláška od poskytovatele', /access token has expired/.test(textSelhani), true)

ma('jeden pokus se nepočítá do věty',
  /pokusech/.test(popisMarketingu('marketing.publikace_selhala', { kanal: 'facebook', pokusy: 1 })),
  false)

ma('neznámý druh nevrací větu', popisMarketingu('neco.jineho', {}), '')

console.log('\n== Obrazovka to opravdu volá ==')

/*
  Texty můžou být sebelíp napsané — když je obrazovka nevolá, neověřuje
  se nic. Komentáře se vyškrtávají, jinak by se kontrola trefila do
  vlastního vysvětlení.
*/
const OBRAZOVKA = fs.readFileSync('app/[rozsah]/upozorneni/page.tsx', 'utf8')
const OBRAZOVKA_KOD = OBRAZOVKA
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ma('obrazovka volá popisMarketingu', /popisMarketingu\(/.test(OBRAZOVKA_KOD), true)
ma('a kreslí všechny marketingové druhy', /marketing\./.test(OBRAZOVKA_KOD), true)

/*
  ŽÁDOST VEDE DO FRONTY, OSTATNÍ DO PŘÍSPĚVKU. Cesta ke splnění úkolu
  má být jedno kliknutí, stejně jako u zapomenutého odchodu.
*/
ma('žádost vede do fronty ke schválení',
  /marketing\/schvalovani/.test(OBRAZOVKA_KOD), true)
ma('ostatní do příspěvku',
  /marketing\/\$\{z\.telo\.prispevek/.test(OBRAZOVKA_KOD), true)

console.log('\n== Upozornění píše databáze, ne aplikace ==')

/*
  `notifications` nemá pro `authenticated` grant na `insert`. Kdyby
  marketingová upozornění posílala serverová akce, nepřišla by
  u ničeho, co jde mimo obrazovku — třeba u úlohy, která zruší
  publikaci kvůli nové verzi.
*/
const MIGRACE_UP = fs.readFileSync('supabase/migrations/20260914160000_marketing_upozorneni.sql', 'utf8')

for (const t of ['marketing_upozorni_na_zadost', 'marketing_upozorni_na_rozhodnuti', 'marketing_upozorni_na_selhani']) {
  ma(`spoušť ${t} existuje`, new RegExp(`create trigger trg_${t}`).test(MIGRACE_UP), true)
}

ma('žádné upozornění se neposílá z akcí marketingu',
  /from\('notifications'\)/.test(fs.readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')),
  false)

/*
  SÁM SOBĚ SE NEPÍŠE. Kdo o schválení požádal, nedostane zprávu, že
  o něj někdo požádal. Zní to samozřejmě, ale je to nejčastější chyba
  v upozorněních vůbec — a lidé si pak odvyknou je číst.
*/
ma('žadatel nedostane zprávu o vlastní žádosti',
  /k\.user_id is distinct from v_zadal/.test(MIGRACE_UP), true)
ma('a kdo rozhodl o své vlastní, taky ne',
  /new\.rozhodl = new\.zadal/.test(MIGRACE_UP), true)

/*
  JEN `vzdano`, NE KAŽDÉ `selhalo`. Fronta má pět pokusů; zpráva
  u každého by znamenala pět zpráv o jednom příspěvku, který nakonec
  vyjde.
*/
ma('u publikace se hlásí až vzdání, ne každý pokus',
  /new\.stav <> 'vzdano' or old\.stav = 'vzdano'/.test(MIGRACE_UP), true)

console.log('\n== Potvrzení změny směny (acknowledgement) ==')

/*
  Zadání (noční prompt Komunikace, oddíl 10 a 12): "změnili vám
  směnu" a "zrušili vám směnu" jsou věci, které si člověk už naplánoval
  a teď mu je někdo sebral/posunul — proto vyžadují výslovné potvrzení.
  Nová/odebraná směna ne (odebraná znamená, že na ni už nemá počítat —
  potvrzovat něco, co se ho víc netýká, nemá smysl).
*/
ma('změna směny vyžaduje potvrzení', vyzadujePotvrzeni('smena.zmenena'), true)
ma('zrušení směny vyžaduje potvrzení', vyzadujePotvrzeni('smena.zrusena'), true)
ma('nová směna potvrzení nevyžaduje', vyzadujePotvrzeni('smena.nova'), false)
ma('odebraná směna potvrzení nevyžaduje', vyzadujePotvrzeni('smena.odebrana'), false)
ma('ostatní druhy potvrzení nevyžadují', vyzadujePotvrzeni('vzkaz.novy'), false)
ma('ani neznámý druh', vyzadujePotvrzeni('neco.noveho'), false)

ma('obrazovka volá vyzadujePotvrzeni',
  /vyzadujePotvrzeni\(z\.druh\)/.test(OBRAZOVKA_KOD), true)
ma('obrazovka umí zavolat potvrditZmenu',
  /potvrditZmenu/.test(OBRAZOVKA_KOD), true)
ma('tlačítko potvrzení posílá id té konkrétní zprávy',
  /name="id" value=\{z\.id\}/.test(OBRAZOVKA_KOD), true)

/*
  Akce musí filtrovat na stejné dva druhy jako vyzadujePotvrzeni —
  jinak by šlo potvrdit i to, co se potvrzovat nemá, přímým odesláním
  formuláře mimo obrazovku (id v skrytém poli, druh se tam nekontroluje).
*/
const AKCE = fs.readFileSync('app/[rozsah]/upozorneni/akce.ts', 'utf8')
ma('akce filtruje na druhy z vyzadujePotvrzeni, ne na vlastní kopii',
  /DRUHY_S_POTVRZENIM = \[.*\]\.filter\(vyzadujePotvrzeni\)/.test(AKCE), true)
ma('potvrzení nastaví i read_at',
  /acknowledged_at.*read_at|read_at.*acknowledged_at/s.test(AKCE), true)

console.log('\n== Změna směny: původně → nově ==')

ma('stejný den: jen časy',
  JSON.stringify(zmenaSmeny({ den: '2026-09-22', od: '10:00', do: '18:00', puvodni_den: '2026-09-22', puvodni_od: '08:00', puvodni_do: '16:00' })),
  JSON.stringify({ puvodne: '08:00–16:00', nove: '10:00–18:00' }))
ma('jiný den: den se připíše k oběma stranám',
  JSON.stringify(zmenaSmeny({ den: '2026-09-23', od: '10:00', do: '18:00', puvodni_den: '2026-09-22', puvodni_od: '08:00', puvodni_do: '16:00' })),
  JSON.stringify({ puvodne: 'út 22. 9. 08:00–16:00', nove: 'st 23. 9. 10:00–18:00' }))
ma('starší upozornění bez původního stavu nic nevymýšlí',
  zmenaSmeny({ den: '2026-09-22', od: '10:00', do: '18:00' }), null)
ma('bez nového času taky ne',
  zmenaSmeny({ puvodni_od: '08:00', puvodni_do: '16:00' }), null)
ma('směna přes půlnoc se zapíše, jak je (nepočítá se z ní nic)',
  JSON.stringify(zmenaSmeny({ den: '2026-09-22', od: '18:00', do: '02:00', puvodni_den: '2026-09-22', puvodni_od: '16:00', puvodni_do: '00:00' })),
  JSON.stringify({ puvodne: '16:00–00:00', nove: '18:00–02:00' }))

console.log('\n== Zobrazit: odkaz na směnu ==')

ma('odkaz vede na moje směny, den a detail',
  odkazNaSmenu('cerna-perla', { den: '2026-09-22' }, 'abc-123'),
  '/cerna-perla/smeny?pohled=moje&den=2026-09-22&smena=abc-123')
ma('bez id směny vede aspoň na den',
  odkazNaSmenu('cerna-perla', { den: '2026-09-22' }, null),
  '/cerna-perla/smeny?pohled=moje&den=2026-09-22')
ma('id se do adresy bezpečně zakóduje',
  odkazNaSmenu('firma', { den: '2026-09-22' }, 'a&b=c'),
  '/firma/smeny?pohled=moje&den=2026-09-22&smena=a%26b%3Dc')

/*
  Obrazovka musí ty funkce opravdu volat a musí si o `shift_id` říct
  tolerantně — sloupec přidává migrace, která se nasazuje ručně, a
  kód se nasazuje sám. Bez tolerance by upozornění po sloučení kódu
  a před `db push` spadla na 500.
*/
ma('obrazovka používá zmenaSmeny z lib', /zmenaSmeny\(/.test(OBRAZOVKA_KOD), true)
ma('obrazovka používá odkazNaSmenu z lib', /odkazNaSmenu\(/.test(OBRAZOVKA_KOD), true)
ma('shift_id se čte tolerantně (sloupec chybí do nasazení migrace)',
  /shift_id/.test(OBRAZOVKA_KOD) && /sloupecNeexistuje/.test(OBRAZOVKA_KOD), true)

console.log('\n== Skloňování a počty (Provozní centrum) ==')

ma('1 zpráva', slovoPodleCisla(1, 'zpráva', 'zprávy', 'zpráv'), 'zpráva')
ma('2–4 zprávy', [2, 3, 4].map((n) => slovoPodleCisla(n, 'zpráva', 'zprávy', 'zpráv')).join('|'), 'zprávy|zprávy|zprávy')
ma('5 a víc, i 0, zpráv', [5, 11, 0, 100].map((n) => slovoPodleCisla(n, 'zpráva', 'zprávy', 'zpráv')).join('|'), 'zpráv|zpráv|zpráv|zpráv')
ma('souhrn po příchodu: 3 zprávy', souhrnCekajicich(3), 'Čekají na vás 3 zprávy')
ma('souhrn: 1 zpráva', souhrnCekajicich(1), 'Čeká na vás 1 zpráva')
ma('souhrn: 7 zpráv', souhrnCekajicich(7), 'Čekají na vás 7 zpráv')
ma('souhrn nikdy neřekne 0 ani zápornou hodnotu', souhrnCekajicich(0), 'Čeká na vás 1 zpráva')
ma('počet upozornění bez údaje = 1', pocetUpozorneni({}), 1)
ma('počet upozornění z těla', pocetUpozorneni({ pocet: 3 }), 3)
ma('nesmyslný počet se bere jako 1', [pocetUpozorneni({ pocet: 0 }), pocetUpozorneni({ pocet: -2 }), pocetUpozorneni({ pocet: NaN })].join('|'), '1|1|1')
ma('nadpis vzkazu s počtem 1 je jednotné číslo', nadpisUpozorneni('vzkaz.novy', {}, obdobi), 'Nová zpráva v rozhovoru')
ma('nadpis vzkazu s počtem 3', nadpisUpozorneni('vzkaz.novy', { pocet: 3 }, obdobi), '3 nové zprávy v rozhovorech')
ma('nadpis vzkazu s počtem 5', nadpisUpozorneni('vzkaz.novy', { pocet: 5 }, obdobi), '5 nových zpráv v rozhovorech')
ma('nadpis oznámení s počtem 2', nadpisUpozorneni('oznameni.nova', { pocet: 2 }, obdobi), '2 nová oznámení na nástěnce')
ma('nadpis oznámení bez počtu', nadpisUpozorneni('oznameni.nova', {}, obdobi), 'Nové oznámení na nástěnce')

console.log('\n== Priorita ==')

ma('low, normal, important, urgent projdou beze změny', ['low', 'normal', 'important', 'urgent'].map(prioritaUpozorneni).join('|'), 'low|normal|important|urgent')
ma('neznámá hodnota = normal (upozornění nezmizí kvůli překlepu)', [prioritaUpozorneni('kritická'), prioritaUpozorneni(null), prioritaUpozorneni(undefined)].join('|'), 'normal|normal|normal')
ma('low se nepočítá do odznaku', pocitaSeDoOdznaku('low'), false)
ma('ostatní i neznámá se počítají', ['normal', 'important', 'urgent', 'nic'].every(pocitaSeDoOdznaku), true)

console.log('\n== Karta „ZMĚNA SMĚNY“ ==')

const karta = kartaZmenySmeny({ den: '2026-09-22', od: '16:00', do: '22:00', puvodni_den: '2026-09-22', puvodni_od: '18:00', puvodni_do: '22:00', zmenil: 'Jana Vedoucí' })
ma('nadpis', karta?.nadpis, 'ZMĚNA SMĚNY')
ma('den s velkým písmenem (jako ve vzoru „Úterý 22. 9.“)', karta?.den, 'Úterý 22. 9.')
ma('původně', karta?.puvodne, '18:00–22:00')
ma('nově', karta?.nove, '16:00–22:00')
ma('změnil', karta?.zmenil, 'Jana Vedoucí')
ma('bez jména změnitele je null, nevymýšlí se', kartaZmenySmeny({ den: '2026-09-22', od: '16:00', do: '22:00', puvodni_od: '18:00', puvodni_do: '22:00' })?.zmenil, null)
ma('prázdné jméno = null', kartaZmenySmeny({ den: '2026-09-22', od: '16:00', do: '22:00', puvodni_od: '18:00', puvodni_do: '22:00', zmenil: '   ' })?.zmenil, null)
ma('starší upozornění bez původního stavu kartu nemá', kartaZmenySmeny({ den: '2026-09-22', od: '16:00', do: '22:00' }), null)
ma('bez dne kartu nemá', kartaZmenySmeny({ od: '16:00', do: '22:00', puvodni_od: '18:00', puvodni_do: '22:00' }), null)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
