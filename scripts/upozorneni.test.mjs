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
  popisSmenaOdmitnuta,
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
  popisSouhrnuDne,
  popisRezervace,
  jeUpozorneniKRezervaci,
  popisNapojeni,
  jeUpozorneniNapojeni,
} from '../lib/upozorneni-text.ts'
import { odkazUpozorneni } from '../lib/upozorneni-odkaz.ts'
import { slozitPush } from '../lib/komunikace/push-zprava.ts'
import { souhrnText } from '../lib/rezervace-pobocky.ts'
import { STAVY, pocitaSeDoHostu } from '../lib/rezervace-typy.ts'

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
ma('obrazovka volá popisSmenaOdmitnuta', /popisSmenaOdmitnuta\(z\.telo\)/.test(OBRAZOVKA_KOD), true)
ma('odmítnutá směna vede na přehled Potvrzení směn',
  /smeny\/potvrzeni/.test(OBRAZOVKA_KOD), true)

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
// odmítnutí (29. 9. 2026) potvrzení nevyžaduje — jde vedoucímu, ne
// tomu, kdo o směnu rozhodl; „potvrdit, že jsem si přečetl“ tu nemá smysl.
ma('odmítnutá směna potvrzení nevyžaduje', vyzadujePotvrzeni('smena.odmitnuta'), false)

/*
  ODMÍTNUTÁ SMĚNA (29. 9. 2026, migrace 20260929100000). Tělo NENESE
  jméno toho, kdo odmítl (app.notifikovat u odmitnout_smenu ho neposílá)
  — nadpis proto mluví o směně, ne o člověku.
*/
ma('nadpis odmítnuté směny mluví o směně, ne o člověku (jméno tělo nenese)',
  nadpisUpozorneni('smena.odmitnuta', { den: '2026-09-28' }, obdobi), 'Odmítnutá směna pondělí 28. 9.')
ma('popis nese čas a důvod', popisSmenaOdmitnuta({ od: '08:00', do: '16:00', duvod: 'nemoc' }), '08:00–16:00 · Důvod: nemoc')
ma('bez důvodu (nemělo by nastat, RPC ho vyžaduje) se to řekne nahlas, ne mlčí',
  popisSmenaOdmitnuta({ od: '08:00', do: '16:00' }), '08:00–16:00 · Bez uvedeného důvodu.')
ma('bez časů zůstane jen důvod', popisSmenaOdmitnuta({ duvod: 'nemoc' }), 'Důvod: nemoc')

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

console.log('\n== Klepnutí na upozornění vede na věc (T2, 27. 9.) ==')

/*
  Do 27. 9. vedla každá položka panelu zvonečku na obecnou /upozorneni.
  Cíl se počítá z ULOŽENÉHO řádku (serverová akce otevrit.ts), tady se
  ověřuje, kam který druh vede — a že nic z `telo` nevytáhne adresu ven.
*/
const U = '11111111-2222-4333-8444-555555555555'
const U2 = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const cil = (druh, telo = {}, dalsi = {}, konv) => odkazUpozorneni('perla', { druh, telo, ...dalsi }, konv)

ma('nová směna → rozpis na ten den, rovnou detail směny',
  cil('smena.nova', { den: '2026-09-28' }, { shift_id: U }), `/perla/smeny?pohled=moje&den=2026-09-28&smena=${U}`)
ma('změněná směna čeká na POTVRZENÍ → na stránku Upozornění (tam je „Potvrdit“)',
  cil('smena.zmenena', { den: '2026-09-28' }, { shift_id: U }), '/perla/upozorneni')
ma('zrušená směna taky', cil('smena.zrusena', { den: '2026-09-28' }), '/perla/upozorneni')
ma('odmítnutá směna → přehled Potvrzení směn (vedoucí, ne „moje směny“)',
  cil('smena.odmitnuta', { den: '2026-09-28' }, { shift_id: U }), '/perla/smeny/potvrzeni')
ma('směna bez dne → obecná stránka, nic se nevymýšlí', cil('smena.nova', {}), '/perla/upozorneni')
ma('úkol → detail úkolu', cil('ukol.pridelen', { ukol: U }), `/perla/ukoly/ukol/${U}`)
ma('úkol s nesmyslným id → seznam úkolů', cil('ukol.pridelen', { ukol: '../../x' }), '/perla/ukoly')
ma('checklist → běh na pobočce běhu, u problému položka',
  cil('checklist.problem', { beh: U, pobocka_slug: 'bernard-bar', polozka: U2 }), `/bernard-bar/ukoly/checklisty/${U}/polozka/${U2}`)
ma('checklist s podvrženým slugem → obecná stránka',
  cil('checklist.prideleno', { beh: U, pobocka_slug: '//zly.example' }), '/perla/upozorneni')
ma('záloha k potvrzení → Docházka', cil('zaloha.vyplacena'), '/perla/dochazka')
ma('potvrzená záloha vydávajícímu → Zálohy', cil('zaloha.potvrzena'), '/perla/dochazka/zalohy')
ma('zapomenutý odchod → předvyplněný formulář',
  cil('dochazka.zapomenuty_odchod', { pobocka_slug: 'perla', zamestnanec: U, den: '2026-09-26' }),
  `/perla/dochazka?doplnit=${U}&den=2026-09-26`)
ma('marketing žádost → fronta ke schválení', cil('marketing.zadost'), '/perla/marketing/schvalovani')
ma('marketing příspěvek → příspěvek', cil('marketing.vraceno', { prispevek: U }), `/perla/marketing/${U}`)
ma('oznámení → Nástěnka', cil('oznameni.nova'), '/perla/vzkazy?zalozka=nastenka')
ma('nový vzkaz s dohledaným rozhovorem → rozhovor', cil('vzkaz.novy', {}, { zdroj_typ: 'zprava', zdroj_id: U }, U2), `/perla/vzkazy/${U2}`)
ma('nový vzkaz bez rozhovoru (už nejsem účastník) → seznam', cil('vzkaz.novy', {}, { zdroj_id: U }, null), '/perla/vzkazy')
// 28. 9.: „3 nové zprávy“ se slučují za den a můžou být ze tří rozhovorů;
// zdroj_id nese jen ten poslední. Vést do něj by ostatní dva schovalo.
ma('sloučené „3 nové zprávy“ → seznam nepřečtených, ne rozhovor poslední zprávy',
  cil('vzkaz.novy', { pocet: 3 }, { zdroj_typ: 'zprava', zdroj_id: U }, U2), '/perla/vzkazy?filtr=neprectene')
ma('… s pocet 1 dál do rozhovoru', cil('vzkaz.novy', { pocet: 1 }, { zdroj_typ: 'zprava', zdroj_id: U }, U2), `/perla/vzkazy/${U2}`)
ma('pozvánka → obecná stránka (odkaz mění souběžná úloha)', cil('pozvanka.prijata', { ceka: true, kdo: U }), '/perla/upozorneni')
ma('neznámý druh → obecná stránka', cil('neco.noveho'), '/perla/upozorneni')
ma('podvržený rozsah → kořen, ne cizí adresa', odkazUpozorneni('//zly.example', { druh: 'oznameni.nova', telo: {} }), '/')
ma('žádný cíl nevede mimo aplikaci',
  [cil('ukol.pridelen', { ukol: 'https://x' }), cil('marketing.x', { prispevek: '//x' }), cil('checklist.x', { beh: 'x' })]
    .every((c) => c.startsWith('/') && !c.startsWith('//')), true)

/* =====================================================================
   RANNÍ SOUHRN REZERVACÍ (rezervace.souhrn_dne, 27. 10. 2026)

   Tělo skládá app.rezervace_souhrn_dne (migrace 20261103100000), tvar
   hlídá scénář krok106. Tady věta: nadpis jde i do PUSH (přes cizí
   službu na zamčenou obrazovku), proto v něm nesmí být název akce —
   ten je jen ve výpisu pod nadpisem v aplikaci.
   ===================================================================== */
console.log('\n== Ranní souhrn rezervací ==')

const PERLA = {
  pobocka: 'Restaurace Černá Perla', slug: 'cerna-perla', den: '2031-03-12',
  rezervaci: 4, hostu: 15, bez_poctu: 0, akci: 0, akce: [],
}
// Hosté jsou CELKEM (rezervace i akce), stejně jako okénko v Rozpisu:
// 12 rezervací se 46 hosty + akce 30 os. = 76.
const BAR = {
  pobocka: 'Bernard Bar Tábor', slug: 'bernard-bar', den: '2031-03-12',
  rezervaci: 12, hostu: 76, bez_poctu: 2, akci: 1,
  akce: [{ cas: '18:00', nazev: 'Svatba Novákových', osob: 30, prostor: 'Salonek' }],
}
const souhrn = (...p) => ({ den: '2031-03-12', souhrn: p })

ma('víc poboček: zkratky BBT/RČP (zkratkyPobocek), akce časem a osobami, hosté celkem',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn(BAR, PERLA), obdobi),
  'Dnes BBT: 12 rezervací + akce 18:00 (30 os.), celkem 76 hostů · RČP: 4 rezervace, 15 hostů')
ma('jedna pobočka: bez zkratky',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn(PERLA), obdobi), 'Dnes: 4 rezervace, 15 hostů')
ma('prázdná pobočka vedle plné: „nic v plánu“',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn(BAR, { ...PERLA, rezervaci: 0, hostu: 0 }), obdobi),
  'Dnes BBT: 12 rezervací + akce 18:00 (30 os.), celkem 76 hostů · RČP: nic v plánu')
ma('skloňování: 1 rezervace, 1 host',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn({ ...PERLA, rezervaci: 1, hostu: 1 }), obdobi), 'Dnes: 1 rezervace, 1 host')
ma('dvě akce s časy (u jedné počet chybí), 2 hosté',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn({
    ...PERLA, rezervaci: 2, hostu: 24, akci: 2,
    akce: [{ cas: '12:00', nazev: 'Oběd', osob: 20 }, { cas: '18:00', nazev: 'Večírek' }],
  }), obdobi),
  'Dnes: 2 rezervace + 2 akce 12:00 (20 os.), 18:00, celkem 24 hostů')
ma('jen akce, žádná rezervace',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn({ ...PERLA, rezervaci: 0, hostu: 8, akci: 1, akce: [{ cas: '19:30', nazev: 'X', osob: 8 }] }), obdobi),
  'Dnes: akce 19:30 (8 os.)')
ma('víc než tři akce se jen spočítají (nadpis se vejde na displej)',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn({
    ...PERLA, akci: 5, akce: ['10:00', '12:00', '14:00', '16:00', '18:00'].map((cas) => ({ cas, nazev: 'A' })),
  }), obdobi),
  'Dnes: 4 rezervace + 5 akcí, celkem 15 hostů')
ma('rezervace bez počtu hostů: hosté se nevymýšlejí',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn({ ...PERLA, rezervaci: 2, hostu: 0, bez_poctu: 2 }), obdobi), 'Dnes: 2 rezervace')
ma('NÁZEV AKCE v nadpisu (a tedy v push) není',
  nadpisUpozorneni('rezervace.souhrn_dne', souhrn(BAR, PERLA), obdobi).includes('Novák'), false)
ma('poškozené tělo nespadne a nic nevymyslí',
  nadpisUpozorneni('rezervace.souhrn_dne', { souhrn: 'x' }, obdobi), 'Dnešní rezervace')

const popisBar = popisSouhrnuDne(souhrn(BAR, PERLA))
ma('výpis v aplikaci: celý název pobočky a TÁŽ věta jako kalendář (souhrnText)',
  `${popisBar[0].pobocka} — ${popisBar[0].pocty}`,
  `Bernard Bar Tábor — ${souhrnText({ rezervaci: 12, akci: 1, hostu: 76, bezPoctu: 2, zrusenych: 0 })}`)
ma('… což je „12 rezervací · 1 akce · 76 hostů + 2 bez počtu“',
  popisBar[0].pocty, '12 rezervací · 1 akce · 76 hostů + 2 bez počtu')
ma('výpis v aplikaci: akce i s názvem a prostorem', popisBar[0].akce.join(' | '), '18:00 Svatba Novákových · 30 os. · Salonek')
ma('výpis: pobočka bez akcí nemá seznam', popisBar[1].akce.length, 0)
ma('výpis: prázdná pobočka jako v kalendáři („Nic zapsaného“)',
  popisSouhrnuDne(souhrn({ ...PERLA, rezervaci: 0, hostu: 0 }))[0].pocty, 'Nic zapsaného')
// 4. kolo kontroly kódu (4. 11.): u akce z Choice ukazoval souhrn holý
// prostor — přání hosta, které se do něj doplnilo kdysi —, i když kalendář
// ukazuje stoly. Místo teď skládá totéž mistoKratce jako kalendář.
// Výjimka (třeba `.trim` nad číslem z poškozeného těla) je CHYBA té jedné
// kontroly, ne pád celého souboru — jinak by schovala všechny za ní.
const akceSouhrnu = (a) => {
  try {
    return popisSouhrnuDne(souhrn({ ...PERLA, akci: 1, akce: [{ cas: '18:00', nazev: 'Raut', ...a }] }))[0].akce[0]
  } catch (e) {
    return `VÝJIMKA: ${e instanceof Error ? e.message : String(e)}`
  }
}
ma('výpis: akce z Choice — stoly, ne přání hosta doplněné do prostoru (příznak „ze zdroje“)',
  akceSouhrnu({ prostor: 'Patro', stoly: 'Terasa: L7', prani: 'Zahrada', prostor_ze_zdroje: true }), '18:00 Raut · Terasa: L7')
ma('výpis: přání se v Choice změnilo a stoly nejsou — aktuální přání, ne staré',
  akceSouhrnu({ prostor: 'Patro', prani: 'Zahrada', prostor_ze_zdroje: true }), '18:00 Raut · Zahrada')
// 5. kolo: host přání smazal, akce bez stolů — prostor z formuláře akce
// (na main ho souhrn ukazoval; kuchyně by o místo akce přišla).
ma('výpis: akce, host přání v Choice smazal a stoly nejsou — prostor z formuláře akce',
  akceSouhrnu({ prostor: 'Salonek', prani: '', prostor_ze_zdroje: true }), '18:00 Raut · Salonek')
ma('výpis: prostor od obsluhy se ukáže vedle stolů',
  akceSouhrnu({ prostor: 'u okna', stoly: 'Terasa: L7', prani: 'Patro', prostor_ze_zdroje: false }), '18:00 Raut · u okna · Terasa: L7')
ma('výpis: bez příznaku (null se z těla vypustí) rozhodne shoda s přáním jako v kalendáři',
  akceSouhrnu({ prostor: 'Patro', stoly: 'Terasa: L7', prani: 'Patro' }), '18:00 Raut · Terasa: L7')
ma('výpis: souhrn ze staré databáze (bez nových klíčů) — prostor jako dřív',
  akceSouhrnu({ prostor: 'Salonek' }), '18:00 Raut · Salonek')
ma('výpis: poškozené klíče místa nespadnou a nic nevymyslí',
  akceSouhrnu({ prostor: 7, stoly: ['x'], prani: {}, prostor_ze_zdroje: 'ano' }), '18:00 Raut')
ma('výpis: akce nad 20 v těle nejsou — řekne se, kolik jich zbývá',
  popisSouhrnuDne(souhrn({ ...PERLA, akci: 23, akce: Array.from({ length: 20 }, () => ({ cas: '18:00' })) }))[0].akce.at(-1),
  '… a 3 další v kalendáři')

ma('push nese nadpis, ne název akce',
  slozitPush({ typ: 'jedna', pocet: 1, druh: 'rezervace.souhrn_dne', telo: souhrn(BAR, PERLA), priorita: 'normal' }).body,
  'Dnes BBT: 12 rezervací + akce 18:00 (30 os.), celkem 76 hostů · RČP: 4 rezervace, 15 hostů')

/*
  KDO SE DO HOSTŮ POČÍTÁ — jedno pravidlo na dvou místech: v databázi
  (`stav not in (…)` v migraci, souhrn počítá SQL) a v appce
  (pocitaSeDoHostu, kalendář a okénko v Rozpisu). Kdyby se rozešly,
  ranní souhrn by ukazoval jiný počet hostů než Rozpis.
*/
{
  // Každá migrace, která souhrn (pře)definuje — i ta poslední, která poběží.
  const definice = fs.readdirSync('supabase/migrations').filter((m) => m.endsWith('.sql')).sort()
    .filter((m) => /function app\.rezervace_souhrn_dne\(/.test(fs.readFileSync(`supabase/migrations/${m}`, 'utf8')))
  ma('souhrn definují tři migrace (20261103100000, přepis příjemců 20261106100000 a stoly u akcí 20261107100000)', definice.length, 3)
  const podleAppky = STAVY.filter((s) => !pocitaSeDoHostu(s)).sort().join(',')
  for (const m of definice) {
    const migrace = fs.readFileSync(`supabase/migrations/${m}`, 'utf8')
    const seznamy = [...migrace.matchAll(/\b[rx]\.stav not in \(([^)]*)\)/g)].map((x) =>
      [...x[1].matchAll(/'([a-z_]+)'/g)].map((y) => y[1]).sort().join(','))
    ma(`${m}: vylučuje stavy na dvou místech (počty a seznam akcí)`, seznamy.length, 2)
    ma(`… a obojí jsou přesně stavy, které appka do hostů nepočítá (${podleAppky})`,
      seznamy.every((x) => x === podleAppky) && podleAppky !== '', true)
  }
}

ma('klepnutí, jedna pobočka → den v kalendáři TÉ pobočky',
  cil('rezervace.souhrn_dne', souhrn(BAR)), '/bernard-bar/rezervace/den/2031-03-12')
ma('klepnutí, víc poboček → den v rozsahu, kde člověk je',
  cil('rezervace.souhrn_dne', souhrn(BAR, PERLA)), '/perla/rezervace/den/2031-03-12')
ma('podvržený slug a den → kalendář v rozsahu, nikam ven',
  cil('rezervace.souhrn_dne', { den: '../x', souhrn: [{ ...BAR, slug: '//zly.example' }] }), '/perla/rezervace')

ma('stránka Upozornění kreslí výpis souhrnu a odkaz z odkazUpozorneni',
  stranka.includes('popisSouhrnuDne(z.telo)') && stranka.includes('odkazUpozorneni(rozsah, { druh: z.druh, telo: z.telo })'), true)

/* =====================================================================
   AKCE A REZERVACE (2. 11. 2026, migrace 20261106100000)

   Komu to chodí, hlídá scénář krok107. Tady věta a odkaz: nadpis jde do
   PUSH, takže nese den, čas, počet osob a pobočku — NIKDY název akce ani
   jméno hosta. Název je až ve větě pod nadpisem (jen v aplikaci).
   ===================================================================== */
console.log('\n== Akce a rezervace ==')
{
  const ID = '11111111-2222-4333-8444-555555555555'
  const AKCE = {
    rezervace_id: ID, den: '2031-03-14', cas: '18:00', osob: 30,
    nazev: 'Svatba Novákových', pobocka: 'Bernard Bar Tábor', pobocka_slug: 'bernard-bar',
  }
  const REZ = { rezervace_id: ID, den: '2031-03-14', cas: '19:30', osob: 4, pobocka: 'Restaurace Černá Perla', pobocka_slug: 'cerna-perla' }
  const kdy = (t) => `${denZkraceny('2031-03-14')} ${t}`

  ma('nová akce: den, čas, osoby a pobočka',
    nadpisUpozorneni('akce.nova', AKCE, obdobi), `Nová akce ${kdy('18:00')} (30 os.) — Bernard Bar Tábor`)
  ma('změna akce', nadpisUpozorneni('akce.zmenena', AKCE, obdobi), `Změna akce ${kdy('18:00')} (30 os.) — Bernard Bar Tábor`)
  ma('zrušená akce', nadpisUpozorneni('akce.zrusena', AKCE, obdobi), `Zrušená akce ${kdy('18:00')} (30 os.) — Bernard Bar Tábor`)
  ma('nová rezervace', nadpisUpozorneni('rezervace.nova', REZ, obdobi), `Nová rezervace ${kdy('19:30')} (4 os.) — Restaurace Černá Perla`)
  ma('změna rezervace (z rezervace je akce)', nadpisUpozorneni('rezervace.zmenena', REZ, obdobi), `Změna rezervace ${kdy('19:30')} (4 os.) — Restaurace Černá Perla`)
  ma('zrušená rezervace', nadpisUpozorneni('rezervace.zrusena', REZ, obdobi), `Zrušená rezervace ${kdy('19:30')} (4 os.) — Restaurace Černá Perla`)
  ma('sloučené z rezervačního systému: 3 → „nové“', nadpisUpozorneni('rezervace.nova', { ...REZ, pocet: 3 }, obdobi), '3 nové rezervace — Restaurace Černá Perla')
  ma('sloučené: 5 → „nových“', nadpisUpozorneni('rezervace.nova', { ...REZ, pocet: 5 }, obdobi), '5 nových rezervací — Restaurace Černá Perla')
  ma('prázdné tělo: jen druh, nic vymyšleného', nadpisUpozorneni('akce.nova', {}, obdobi), 'Nová akce')
  ma('nesmyslný den a čas se vynechají', nadpisUpozorneni('akce.nova', { den: '../x', cas: 'x', osob: -3 }, obdobi), 'Nová akce')

  const nadpisy = ['akce.nova', 'akce.zmenena', 'akce.zrusena'].map((d) => nadpisUpozorneni(d, AKCE, obdobi))
  ma('nadpis akce NENESE název akce (jde do push)', nadpisy.some((n) => n.includes('Novák')), false)
  ma('push nese nadpis, ne název akce',
    slozitPush({ typ: 'jedna', pocet: 1, druh: 'akce.nova', telo: AKCE, priorita: 'normal' }).body,
    nadpisUpozorneni('akce.nova', AKCE, obdobi))

  ma('pod nadpisem: název akce', popisRezervace('akce.nova', AKCE), 'Svatba Novákových')
  ma('pod nadpisem u změny: co se změnilo',
    popisRezervace('akce.zmenena', { ...AKCE, co_se_zmenilo: ['den', 'osob'] }), 'Svatba Novákových. Změna: den a počet osob.')
  ma('… tři změny čárkou a „a“',
    popisRezervace('akce.zmenena', { ...AKCE, co_se_zmenilo: ['cas', 'prostor', 'menu'] }), 'Svatba Novákových. Změna: čas, prostor a menu.')
  ma('… jedna změna (i „menu“ bez chyby v rodě)',
    popisRezervace('akce.zmenena', { ...AKCE, co_se_zmenilo: ['menu'] }), 'Svatba Novákových. Změna: menu.')
  ma('… z akce se stala rezervace',
    popisRezervace('akce.zmenena', { ...AKCE, co_se_zmenilo: ['druh'] }), 'Svatba Novákových. Změna: z akce je rezervace.')
  ma('… neznámá změna se nevymýšlí', popisRezervace('akce.zmenena', { ...AKCE, co_se_zmenilo: ['xyz'] }), 'Svatba Novákových.')
  ma('vybraným na rezervace: z rezervace se stala akce',
    popisRezervace('rezervace.zmenena', { ...REZ, co_se_zmenilo: ['druh'] }), 'Změna: z rezervace je akce.')
  ma('… název akce ani tam, kdyby ho tělo neslo (tělo rezervace ho nemá)',
    popisRezervace('rezervace.zmenena', { ...REZ, nazev: 'Svatba Novákových', co_se_zmenilo: ['druh'] }), 'Změna: z rezervace je akce.')
  ma('pod sloučenými: poslední rezervace', popisRezervace('rezervace.nova', { ...REZ, pocet: 3 }),
    `Z rezervačního systému. Poslední: ${kdy('19:30')} (4 os.)`)
  ma('u jedné rezervace nic pod nadpisem', popisRezervace('rezervace.nova', REZ), '')

  ma('klepnutí na akci → detail v rozsahu POBOČKY akce', cil('akce.nova', AKCE), `/bernard-bar/rezervace/${ID}`)
  ma('klepnutí na zrušenou rezervaci → detail', cil('rezervace.zrusena', REZ), `/cerna-perla/rezervace/${ID}`)
  ma('klepnutí na změnu rezervace → detail', cil('rezervace.zmenena', REZ), `/cerna-perla/rezervace/${ID}`)
  ma('sloučené nové → kalendář pobočky (id nese jen poslední)', cil('rezervace.nova', { ...REZ, pocet: 3 }), '/cerna-perla/rezervace')
  ma('podvržený slug → rozsah, kde člověk je', cil('akce.nova', { ...AKCE, pobocka_slug: '//zly.example' }), `/perla/rezervace/${ID}`)
  ma('podvržené id → kalendář, ne cizí adresa', cil('akce.zmenena', { ...AKCE, rezervace_id: 'https://x' }), '/bernard-bar/rezervace')

  const migrace = fs.readFileSync('supabase/migrations/20261106100000_rezervace_upozorneni.sql', 'utf8')
  const spoust = migrace.slice(migrace.indexOf('create function app.rezervace_upozornit()'), migrace.indexOf('revoke all on function app.rezervace_upozornit()'))
  const druhy = [...new Set([...spoust.matchAll(/'((?:akce|rezervace)\.[a-z_]+)'/g)].map((m) => m[1]))].sort()
  ma(`spoušť posílá šest druhů (${druhy.join(', ')})`, druhy.length, 6)
  ma('… a každý má vlastní nadpis (ne obecné „Upozornění“)',
    druhy.every((d) => nadpisUpozorneni(d, AKCE, obdobi) !== 'Upozornění'), true)
  ma('… a každý vede na rezervace, ne na obecnou stránku',
    druhy.every((d) => cil(d, AKCE).startsWith('/bernard-bar/rezervace')), true)
  ma('… a u každého stránka Upozornění kreslí větu a odkaz na detail',
    druhy.every((d) => jeUpozorneniKRezervaci(d)) && !jeUpozorneniKRezervaci('rezervace.souhrn_dne'), true)
  ma('sám sobě se nepíše: příjemci bez auth.uid() (v obou smyčkách)',
    /v_ja\s+uuid := auth\.uid\(\)/.test(spoust) && (spoust.match(/where p\.user_id is distinct from v_ja/g) ?? []).length === 2, true)
  // Tělo skládá jediná funkce app.rezervace_upozorneni_telo (pro obě
  // spouště) — kontrola čte jen ji, od hlavičky po revoke.
  const telo = migrace.slice(migrace.indexOf('create function app.rezervace_upozorneni_telo('),
    migrace.indexOf('revoke all on function app.rezervace_upozorneni_telo('))
  ma('tělo skládá app.rezervace_upozorneni_telo (jsonb_build_object)', telo.includes('jsonb_build_object('), true)
  ma('… a nenese jméno hosta ani kontakt', /jmeno_hosta|telefon|email/.test(telo), false)

  ma('stránka Upozornění kreslí větu pod nadpisem z popisRezervace (podle jeUpozorneniKRezervaci)',
    stranka.includes('popisRezervace(z.druh, z.telo)') && stranka.includes('jeUpozorneniKRezervaci(z.druh)'), true)
}

/* =====================================================================
   VÝPADEK NAPOJENÍ (7. 11. 2026, migrace 20261108100000)

   3. 11. Choice jedinkrát odmítl přístup a čtyři dny se nenačetla žádná
   rezervace, aniž by o tom kdo věděl. Komu upozornění chodí a že jen
   jednou na výpadek, hlídá scénář krok110. Tady text, push a odkaz:
   nadpis jde do PUSH — jen kdo a kde, důvod až ve větě v aplikaci.
   ===================================================================== */
console.log('\n== Výpadek napojení ==')
{
  const ID = '11111111-2222-4333-8444-555555555555'
  const DUVOD = 'Choice odmítl přístup (403). Načítání stojí, dokud přístup neprojde testem.'
  const VYPADEK = { pripojeni: ID, oblast: 'rezervace', poskytovatel: 'choice', pobocka: 'Bernard Bar Tábor', pobocka_slug: 'bernard-bar', duvod: DUVOD }
  const OBNOVENO = { pripojeni: ID, oblast: 'rezervace', poskytovatel: 'choice', pobocka: 'Bernard Bar Tábor', pobocka_slug: 'bernard-bar' }

  ma('výpadek: kdo, co a kde', nadpisUpozorneni('integrace.vypadek', VYPADEK, obdobi), 'Choice nenačítá rezervace — Bernard Bar Tábor')
  ma('obnovení', nadpisUpozorneni('integrace.obnoveno', OBNOVENO, obdobi), 'Choice zase načítá rezervace — Bernard Bar Tábor')
  ma('nadpis (a push) NENESE důvod', nadpisUpozorneni('integrace.vypadek', VYPADEK, obdobi).includes('403'), false)
  ma('push nese nadpis',
    slozitPush({ typ: 'jedna', pocet: 1, druh: 'integrace.vypadek', telo: VYPADEK, priorita: 'important' }).body,
    'Choice nenačítá rezervace — Bernard Bar Tábor')
  ma('neznámý poskytovatel a oblast z těla se nevypíšou',
    nadpisUpozorneni('integrace.vypadek', { poskytovatel: '<b>zly</b>', oblast: 'cokoli' }, obdobi), 'Napojení nenačítá data')
  ma('bez pobočky bez pomlčky', nadpisUpozorneni('integrace.vypadek', { poskytovatel: 'choice', oblast: 'rezervace' }, obdobi), 'Choice nenačítá rezervace')

  ma('pod nadpisem výpadku: co to znamená a důvod z napojení', popisNapojeni('integrace.vypadek', VYPADEK),
    `Nové a změněné rezervace teď do Foodtabu nechodí. ${DUVOD}`)
  ma('… bez důvodu jen první věta', popisNapojeni('integrace.vypadek', { ...VYPADEK, duvod: '  ' }), 'Nové a změněné rezervace teď do Foodtabu nechodí.')
  ma('pod nadpisem obnovení', popisNapojeni('integrace.obnoveno', OBNOVENO), 'Rezervace se zase načítají.')
  ma('jiný druh nic', popisNapojeni('rezervace.nova', VYPADEK), '')

  ma('klepnutí → Napojení v rozsahu POBOČKY napojení (tam je „Ověřit znovu“)', cil('integrace.vypadek', VYPADEK), '/bernard-bar/rezervace/napojeni')
  ma('… i u obnovení', cil('integrace.obnoveno', OBNOVENO), '/bernard-bar/rezervace/napojeni')
  ma('podvržený slug → rozsah, kde člověk je', cil('integrace.vypadek', { ...VYPADEK, pobocka_slug: '//zly.example' }), '/perla/rezervace/napojeni')
  ma('jiná oblast než rezervace → obecná stránka Upozornění', cil('integrace.vypadek', { ...VYPADEK, oblast: 'pokladna' }), '/perla/upozorneni')
  ma('jeUpozorneniNapojeni: oba druhy a nic jiného',
    jeUpozorneniNapojeni('integrace.vypadek') && jeUpozorneniNapojeni('integrace.obnoveno') && !jeUpozorneniNapojeni('rezervace.nova') && !jeUpozorneniNapojeni('integrace')
    && !jeUpozorneniNapojeni('integrace.manage') && !jeUpozorneniNapojeni('integrace.vypadek_x'), true)

  const migrace = fs.readFileSync('supabase/migrations/20261108100000_rezervace_choice_vypadek.sql', 'utf8')
  const spoust = migrace.slice(migrace.indexOf('create function app.integrace_vypadek_upozornit()'),
    migrace.indexOf('revoke all on function app.integrace_vypadek_upozornit()'))
  ma('vyříznutí spouště z migrace něco našlo (kontrola nečte prázdno)', spoust.length > 1000 && spoust.includes('app.notifikovat('), true)
  // Druh je třetí argument app.notifikovat (za příjemcem) — 'integrace.manage' je právo, ne druh.
  const druhy = [...new Set([...spoust.matchAll(/v_u\.user_id,\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))].sort()
  ma(`spoušť posílá dva druhy (${druhy.join(', ')})`, druhy.join(','), 'integrace.obnoveno,integrace.vypadek')
  ma('… každý má vlastní nadpis a vede na Napojení',
    druhy.every((d) => nadpisUpozorneni(d, VYPADEK, obdobi) !== 'Upozornění' && cil(d, VYPADEK) === '/bernard-bar/rezervace/napojeni'), true)
  // Kdy je výpadek tichý (do 24 h od zvonění), hlídá scénář krok110 (4b).
  ma('výpadek je „important“ (push, odznak), opakovaný do 24 h a obnovení „low“ (tiše, bez odznaku)',
    /'integrace\.vypadek', v_telo,\s*case when v_tise then 'low' else 'important' end/.test(spoust)
    && /'integrace\.obnoveno', v_telo, 'low'/.test(spoust)
    && pocitaSeDoOdznaku('important') && !pocitaSeDoOdznaku('low'), true)
  ma('tělo nenese token, tajemství ani externí účet', /tajemstvi|token|externi_ucet|sifra/.test(spoust), false)
  ma('výpadek hlásí jen server (auth.uid() je NULL); kdo obnovil, tomu se jen stáhne',
    /v_ja\s+uuid := auth\.uid\(\)/.test(spoust) && /new\.stav = 'vyzaduje_pozornost' and v_ja is null then/.test(spoust)
    && /if v_u\.user_id = v_ja then\s+perform app\.zrusit_neprectene\(/.test(spoust), true)

  ma('stránka Upozornění kreslí větu z popisNapojeni a odkaz (podle jeUpozorneniNapojeni)',
    stranka.includes('popisNapojeni(z.druh, z.telo)') && stranka.includes('jeUpozorneniNapojeni(z.druh)') && stranka.includes('Otevřít napojení'), true)
}

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
