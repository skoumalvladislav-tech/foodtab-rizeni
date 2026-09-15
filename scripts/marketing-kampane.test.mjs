#!/usr/bin/env node
/**
 * Kampaně a automatizace — plán série a rozvrh běhů.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-kampane.test.mjs
 *
 * ---------------------------------------------------------------------
 * TOHLE JE CELÉ O KALENDÁŘI, TAKŽE POZOR
 *
 * CLAUDE.md, „Testy, které závisí na kalendáři": kontrola nesmí platit
 * jen část dne nebo jen některé dny. Proto tu nikde nefiguruje
 * `new Date()` — dnešek se do funkcí PŘEDÁVÁ. Kdyby si ho braly samy,
 * šel by z pásma serveru (v UTC) a kontroly by se po 22:00 rozpadly.
 *
 * A proto se tu nic neověřuje na jednom datu: posun přes přelom měsíce,
 * roku a přes oba přechody letního času se zkouší zvlášť.
 */

import { readFileSync } from 'node:fs'

import {
  DNY_ZKRATKY_ISO,
  DRUHY_AUTOMATIZACE,
  SERIE_AKCE,
  isoDenVTydnu,
  navrhnoutSerii,
  popisDnu,
  pristiBeh,
  terminKroku,
} from '../lib/marketing-kampane.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano),
     `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

console.log('\n== Série má čtyři kroky a dávají dohromady smysl ==')

ma('kroky jsou čtyři', SERIE_AKCE.length, 4)
ma('a jsou to ty ze zadání',
  SERIE_AKCE.map((k) => k.klic),
  ['pozvanka', 'pripominka', 'posledni_vyzva', 'podekovani'])

/*
  POSUNY MUSÍ JÍT OD NEJVZDÁLENĚJŠÍHO K NEJBLIŽŠÍMU. Kdyby se pořadí
  rozhodilo, vyšla by v kalendáři poslední výzva před pozvánkou —
  a nikdo by nepoznal proč, protože každý kus sám o sobě sedí.
*/
ok('posuny jdou sestupně, takže i termíny jdou po sobě',
  SERIE_AKCE.every((k, i) => i === 0 || SERIE_AKCE[i - 1].posunDnu > k.posunDnu))

ok('jen poděkování je po akci',
  SERIE_AKCE.filter((k) => k.posunDnu < 0).map((k) => k.klic).join() === 'podekovani')

/*
  Čas je ŘETĚZEC „HH:MM", ne okamžik ani číslo. Kdyby to byl `Date`,
  nesl by pásmo serveru (na Vercelu UTC) a pozvánka by odešla o dvě
  hodiny vedle (pravidlo 11).
*/
ok('časy jsou hodiny na zdi', SERIE_AKCE.every((k) => /^\d{2}:\d{2}$/.test(k.cas)))
ok('každý krok má pokyn pro AI, ne hotový text',
  SERIE_AKCE.every((k) => k.pokyn.length > 30))
ok('a pilíř ze šestice', SERIE_AKCE.every((k) => k.pilir.length > 2))

console.log('\n== Termín kroku vůči dni akce ==')

/*
  Zdroj bez komentářů. Zákazy níž se jinak trefí do vlastního
  vysvětlení — na to jsme narazili u fronty ke schválení.
*/
const ZDROJ_CAS = readFileSync('lib/marketing-kampane.ts', 'utf8')
const KOD_CAS = ZDROJ_CAS
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ma('týden před akcí', terminKroku('2026-09-19', 7), '2026-09-12')
ma('den před akcí', terminKroku('2026-09-19', 1), '2026-09-18')
ma('v den akce', terminKroku('2026-09-19', 0), '2026-09-19')
ma('den po akci (záporný posun)', terminKroku('2026-09-19', -1), '2026-09-20')

/*
  PŘES PŘELOMY. Odečíst sedm dnů od druhého v měsíci je snadné pokazit
  a vyjde to skoro vždycky — jen ne na začátku měsíce.
*/
ma('přes přelom měsíce zpátky', terminKroku('2026-09-02', 7), '2026-08-26')
ma('přes přelom roku zpátky', terminKroku('2027-01-03', 7), '2026-12-27')
ma('přes přelom měsíce dopředu', terminKroku('2026-09-30', -1), '2026-10-01')
ma('přes přelom roku dopředu', terminKroku('2026-12-31', -1), '2027-01-01')

/*
  DNY KOLEM PŘECHODU LETNÍHO ČASU.

  POZOR, TOHLE SAMO O SOBĚ NIC NEDOKAZUJE — a je to tu napsané proto,
  aby si to někdo nepletl s důkazem.

  Zkoušel jsem to rozbít dvakrát. Ani jednou tyhle dva řádky nespadly
  jako první: špatné počítání (milisekundy nad místní půlnocí) shodí
  rovnou VŠECHNY termíny výš, ne jenom ty dva kolem přechodu. A když
  se funkce přepíše celá do místního času, projde všechno — protože
  se v místním čase i zapisuje i čte a chyba se vyruší.

  Jsou to tedy obyčejné případy navíc. To, co o pásmu opravdu něco
  říká, je kontrola pod nimi.
*/
ma('30. 3. mínus den', terminKroku('2026-03-30', 1), '2026-03-29')
ma('26. 10. mínus den', terminKroku('2026-10-26', 1), '2026-10-25')

/*
  A TEĎ TO, CO SPADNOUT UMÍ: POČÍTÁ SE V UTC, NE V PÁSMU SERVERU.

  `new Date(r, m-1, d)` a `getFullYear()` se navzájem vyruší, takže
  se to na výsledku nepozná — dokud někdo nesmíchá jedno s druhým
  nebo nepřipočte milisekundy. Pak je to o den vedle, a na Vercelu
  jinak než na notebooku.
  
  Nedá se to změřit výsledkem, dá se to přečíst ze zdroje. Je to
  slabší kontrola než zavolat funkci — ale silnější než dva řádky,
  které projdou vždycky.
*/
ok('nepoužívají se místní getry data',
  !/\.get(FullYear|Month|Date|Hours|Day)\(\)/.test(KOD_CAS))
/*
  `Date.UTC(…)` se z textu nejdřív vyškrtne, jinak by se zákaz trefil
  do `new Date(Date.UTC(r, m - 1, d))` — tedy do té SPRÁVNÉ podoby.
  Chytlo mě to hned při prvním běhu.
*/
ok('ani `new Date(rok, mesic, den)` v místním pásmu',
  !/new Date\([^)'"`]*,[^)'"`]*,[^)'"`]*\)/.test(KOD_CAS.replaceAll(/Date\.UTC\([^)]*\)/g, 'X')))
ok('a datum se skládá přes Date.UTC', /Date\.UTC\(/.test(KOD_CAS))

/*
  A ŽE TO SEDÍ PRO KAŽDÝ DEN ROKU, ne pro pár vybraných. Rozdíl mezi
  termínem a dnem akce musí být přesně ten posun — pokaždé.
*/
let vad = 0
for (let i = 0; i < 400; i++) {
  const den = terminKroku('2026-01-01', -i)
  for (const posun of [7, 1, 0, -1]) {
    const t = terminKroku(den, posun)
    const rozdil = Math.round(
      (new Date(`${den}T00:00:00Z`).getTime() - new Date(`${t}T00:00:00Z`).getTime()) / 86_400_000,
    )
    if (rozdil !== posun) vad++
  }
}
ma('400 dnů × 4 posuny vyjde pokaždé přesně', vad, 0)

console.log('\n== Návrh série ==')

const serie = navrhnoutSerii({ denAkce: '2026-09-19', dnes: '2026-09-14' })

ma('vrátí čtyři kroky', serie.length, 4)
ma('pozvánka je týden předem', serie[0].datum, '2026-09-12')
ma('poděkování den po', serie[3].datum, '2026-09-20')
ok('termíny jdou po sobě',
  serie.every((k, i) => i === 0 || serie[i - 1].datum <= k.datum))

/*
  CO UŽ BYLO, SE NEPLÁNUJE.

  Naplánovat příspěvek na včerejšek by vyrobilo úlohu, kterou fronta
  vezme HNED — a poslala by pozvánku na akci, která už byla. Koncept
  se založí, ale bez termínu.
*/
ok('pozvánka na minulý týden je označená jako pozdní', serie[0].jePozde === true)
ok('ale kroky v budoucnu ne',
  serie.slice(1).every((k) => k.jePozde === false))

const dnesJeAkce = navrhnoutSerii({ denAkce: '2026-09-19', dnes: '2026-09-19' })
ok('krok na DNEŠEK ještě pozdní není',
  dnesJeAkce.find((k) => k.klic === 'posledni_vyzva').jePozde === false)
ok('ale ten na minulý týden ano',
  dnesJeAkce.find((k) => k.klic === 'pozvanka').jePozde === true)

const vsechnoVcas = navrhnoutSerii({ denAkce: '2026-12-24', dnes: '2026-09-14' })
ok('u akce daleko v budoucnu není pozdní nic',
  vsechnoVcas.every((k) => k.jePozde === false))

/*
  DNEŠEK SE PŘEDÁVÁ, NESMÍ SE BRÁT ZE SERVERU. Kdyby si ho funkce
  brala sama, vyšel by z UTC a po 22:00 by tvrdila, že je zítra —
  takže by se krok na dnešek označil jako pozdní o dvě hodiny dřív,
  než měl.
*/
ok('knihovna si nikde nebere dnešek sama', !/new Date\(\)/.test(KOD_CAS))
ok('ani přes toISOString', !/toISOString\(/.test(KOD_CAS))

console.log('\n== Příští běh automatizace ==')

/*
  14. 9. 2026 je PONDĚLÍ. Všechny kontroly níž z toho vycházejí,
  a je to tu napsané schválně: kdyby se datum změnilo, rozsypalo by
  se to a nebylo by hned vidět proč.
*/
ma('14. 9. 2026 je pondělí', isoDenVTydnu('2026-09-14'), 1)
ma('20. 9. 2026 je neděle', isoDenVTydnu('2026-09-20'), 7)

ma('dnes ráno před časem → dnes',
  pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [] }), '2026-09-14')

ma('dnes po čase → zítra',
  pristiBeh({ dnes: '2026-09-14', ted: '09:00', cas: '08:00', dnyVTydnu: [] }), '2026-09-15')

/*
  PŘESNĚ V TU MINUTU se bere jako „už bylo". Jinak by se běh pustil
  dvakrát: jednou v 08:00:00 a podruhé v 08:00:30.
*/
ma('přesně v tu minutu už se počítá jako proběhlé',
  pristiBeh({ dnes: '2026-09-14', ted: '08:00', cas: '08:00', dnyVTydnu: [] }), '2026-09-15')

ma('jen pátky, dnes je pondělí → pátek',
  pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [5] }), '2026-09-18')

ma('jen pondělky, dnes pondělí ráno → dnes',
  pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [1] }), '2026-09-14')

ma('jen pondělky, dnes pondělí odpoledne → za týden',
  pristiBeh({ dnes: '2026-09-14', ted: '18:00', cas: '08:00', dnyVTydnu: [1] }), '2026-09-21')

ma('neděle z pondělí', pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [7] }), '2026-09-20')

/*
  PRÁZDNÉ DNY ZNAMENAJÍ KAŽDÝ DEN, NE NIKDY. Zapnutá automatizace,
  která nic nedělá, vypadá jako porucha — a hledalo by se to v kódu,
  ne v nastavení.
*/
ok('prázdný výběr dnů neznamená „nikdy"',
  pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [] }) !== null)

ok('nesmyslný den nevrátí termín, ale null',
  pristiBeh({ dnes: '2026-09-14', ted: '06:00', cas: '08:00', dnyVTydnu: [9] }) === null)

/*
  A ŽE TO PLATÍ VE VŠECH 24 HODINÁCH. Kontrola, která vyjde v poledne
  a spadne o půlnoci, je horší než rovnou rozbitá — `krok23_scenar`
  na tom 6. 9. spadl ve 20:23.
*/
let vadyHodin = 0
for (let h = 0; h < 24; h++) {
  const ted = `${String(h).padStart(2, '0')}:30`
  const kdy = pristiBeh({ dnes: '2026-09-14', ted, cas: '08:00', dnyVTydnu: [] })
  const cekano = ted < '08:00' ? '2026-09-14' : '2026-09-15'
  if (kdy !== cekano) vadyHodin++
}
ma('ve všech 24 hodinách vyjde totéž, co se čeká', vadyHodin, 0)

/*
  A přes přelom měsíce: 30. 9. odpoledne musí dát 1. 10., ne 31. 9.
*/
ma('přes přelom měsíce',
  pristiBeh({ dnes: '2026-09-30', ted: '18:00', cas: '08:00', dnyVTydnu: [] }), '2026-10-01')
ma('přes přelom roku',
  pristiBeh({ dnes: '2026-12-31', ted: '18:00', cas: '08:00', dnyVTydnu: [] }), '2027-01-01')

console.log('\n== Popis dnů pro člověka ==')

ma('prázdné se přeloží jako každý den', popisDnu([]), 'každý den')
ma('jeden den', popisDnu([5]), 'pá')
ma('víc dnů se seřadí', popisDnu([5, 1, 3]), 'po, st, pá')
ma('neděle je poslední', popisDnu([7, 1]), 'po, ne')
ma('zkratky začínají pondělím', DNY_ZKRATKY_ISO[0], 'po')

console.log('\n== Druhy automatizace ==')

ma('druhy jsou tři', DRUHY_AUTOMATIZACE.length, 3)
ok('a každý má vysvětlení, ne jen název',
  DRUHY_AUTOMATIZACE.every((d) => d.popis.length > 40))

/*
  KLÍČE SE MUSÍ KRÝT S OMEZENÍM V MIGRACI. Druh, který databáze nezná,
  by se nedal uložit — a zjistilo by se to až tím, že uživateli spadne
  formulář s hláškou o `check` omezení.
*/
const MIGRACE = readFileSync('supabase/migrations/20260914140000_marketing_kampane.sql', 'utf8')
const vDb = MIGRACE.match(/druh\s+text not null check \(druh in\s*\(([^)]*)\)\)/)
ok('omezení `druh` se v migraci našlo', Boolean(vDb))
const druhyZDb = (vDb?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((x) => x.replaceAll("'", '')) ?? []
ma('a kód zná přesně tytéž druhy',
  DRUHY_AUTOMATIZACE.map((d) => d.klic).slice().sort(), druhyZDb.slice().sort())

console.log('\n== Automatizace nic nezveřejní ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V TOMHLE SOUBORU.

  Automatizace smí vyrobit KONCEPTY. Kdyby uměla naplánovat publikaci,
  byla by to druhá cesta ven a obešla by čtyři spouště, na kterých
  stojí celé schvalování. Stačilo by jednou špatně nastavit opakování
  a restaurace by měsíc zveřejňovala nesmysly.
*/
ok('tabulka automatizací nemá sloupec na automatické zveřejnění',
  !/zverejnit_sam|auto_publikovat|rovnou_ven/.test(MIGRACE))

ok('a v migraci je nahlas napsané proč',
  /VYROBÍ KONCEPTY/.test(MIGRACE) && /strez_publikaci/.test(MIGRACE))

console.log('\n== Historie běhů a jeden běh na den ==')

ok('běhy mají vlastní tabulku, ne jen poslední výsledek',
  /create table public\.marketing_automatizace_behy/.test(MIGRACE))

ok('a rozlišují hotovo, přeskočeno a chybu',
  /vysledek\s+text not null check \(vysledek in \('hotovo', 'preskoceno', 'chyba'\)\)/.test(MIGRACE))

/*
  Jedinečnost drží jen ÚSPĚŠNÉ běhy. Po chybě se to má dát zkusit
  znovu; kdyby index bral i chybové, jedna neúspěšná noc by
  automatizaci umlčela na celý den.
*/
ok('jeden úspěšný běh na provozní den',
  /create unique index marketing_automatizace_jeden_denne[\s\S]{0,200}where vysledek = 'hotovo'/.test(MIGRACE))

ok('provozní den doplňuje spoušť, ne aplikace',
  /marketing_beh_provozni_den/.test(MIGRACE) && /before insert or update of/.test(MIGRACE))

/*
  A že se uvnitř `security definer` ověřuje firma. RLS se tam
  neuplatní (skill `migrace`, oddíl 5) — bez toho filtru by šlo
  podstrčit cizího rodiče.
*/
ok('a uvnitř té spouště se porovnává firma',
  /a\.tenant_id = new\.tenant_id/.test(MIGRACE))

console.log('\n== Vypínač, vlastník a příští běh ==')

for (const sloupec of ['zapnuta', 'vlastnik', 'posledni_beh_kdy', 'pristi_beh_kdy']) {
  ok(`automatizace má \`${sloupec}\``, new RegExp(`\\s${sloupec}\\s`).test(MIGRACE))
}
ok('a ve výchozím stavu je VYPNUTÁ',
  /zapnuta\s+boolean not null default false/.test(MIGRACE))

/*
  Zapnout automatizaci je rozhodnutí toho druhu jako poslat příspěvek
  ven — proto totéž právo, ne `manage`.
*/
ok('zapínat smí jen marketing.publish',
  /marketing_automatizace_write[\s\S]{0,240}'marketing\.publish'/.test(MIGRACE))

ok('ale kampaň smí založit i marketing.manage',
  /marketing_kampane_write[\s\S]{0,240}'marketing\.manage'/.test(MIGRACE))

/*
  Historii nesmí psát přihlášený uživatel. Historie, do které může
  kdokoli psát, není doklad o ničem.
*/
ok('do historie běhů uživatel nezapisuje',
  /grant select on public\.marketing_automatizace_behy to authenticated;/.test(MIGRACE)
  && !/grant select, insert[^\n]*marketing_automatizace_behy/.test(MIGRACE))

console.log('\n== Smazání kampaně nesmí smazat zveřejněné ==')

ok('vazba příspěvku je set null, ne cascade',
  /kampan_id uuid references public\.marketing_kampane\(id\) on delete set null/.test(MIGRACE))

console.log('\n== Akce a obrazovka to opravdu dělají ==')

const AKCE = readFileSync('app/[rozsah]/marketing/kampane/akce.ts', 'utf8')
const AKCE_KOD = AKCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const STRANKA = readFileSync('app/[rozsah]/marketing/kampane/page.tsx', 'utf8')
const STRANKA_KOD = STRANKA.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

ok('akce mají tělo', AKCE.length > 3000)
ok('obrazovka taky', STRANKA.length > 3000)
ok('série se počítá z knihovny', /navrhnoutSerii\(/.test(AKCE_KOD))
ok('příští běh taky', /pristiBeh\(/.test(AKCE_KOD))

console.log('\n== SÉRIE NIC NENAPLÁNUJE KE ZVEŘEJNĚNÍ ==')

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V CELÉM SOUBORU.

  Série smí založit KONCEPTY. Kdyby zakládala publikační úlohy, byla by
  to druhá cesta ven a obešla by čtyři spouště, na kterých stojí celé
  schvalování — stačilo by jednou špatně zadat akci a odešly by čtyři
  příspěvky, které nikdo neviděl.
*/
const SERIE = AKCE_KOD.slice(AKCE_KOD.indexOf('export async function vyrobitSerii'))

ok('série nezakládá publikační úlohy',
  !/marketing_publikace_ulohy/.test(SERIE))
ok('ani nenastavuje stav „naplánováno"',
  !/stav: 'naplanovano'/.test(SERIE))
ok('ani schválení', !/marketing_schvaleni/.test(SERIE))
ok('zakládá příspěvky a verze', /marketing_prispevky/.test(SERIE) && /marketing_verze/.test(SERIE))

/*
  A že se to říká i uživateli. Kdo klikne na „Vyrobit sérii", musí
  vědět, že se nic nezveřejnilo — jinak bude čekat příspěvky na síti.
*/
ok('obrazovka říká nahlas, že se nic nezveřejní',
  /Nic se nezveřejní/.test(STRANKA) && /nezveřejnilo/.test(STRANKA))

console.log('\n== Dvojí klik nevyrobí sérii dvakrát ==')

/*
  HLEDÁ SE POJISTKA, NE ZMÍNKA.

  Napsal jsem to nejdřív jako „někde je `marketing_prispevky` a do 160
  znaků `kampan_id`" — jenže to sedí i na INSERT, kterým se příspěvek
  zakládá. Kontrola tedy prošla i potom, co jsem pojistku schválně
  smazal. Hledá se proto dotaz, který se PTÁ, a hláška, kterou to
  odmítne.
*/
ok('série se nevyrobí, když ke kampani už příspěvky jsou',
  /\.select\('id'\)\.eq\('kampan_id'/.test(SERIE)
  && /Sérii vyrábíme jen jednou/.test(AKCE))

console.log('\n== Čas jde přes pásmo pobočky (pravidlo 11) ==')

/*
  Den akce, dnešek i termín kroku se počítají V DATABÁZI. Server běží
  v UTC, takže `new Date(...).toISOString().slice(0,10)` by po 22:00
  tvrdilo, že je zítra — a pozvánka by se označila jako pozdní o den
  dřív, než měla.
*/
ok('den akce se ptá databáze', /rpc\('business_date'/.test(SERIE))
ok('termín kroku se převádí přes marketing_okamzik',
  /rpc\('marketing_okamzik'/.test(SERIE))
ok('a dnešek se nepočítá ze serveru',
  !/toISOString\(\)\.slice/.test(AKCE_KOD))

/*
  Hodina pro příští běh se taky ptá pobočky, ne serveru.
*/
ok('kolik je hodin se ptá pobočky', /marketing_ted_v_pasmu/.test(AKCE_KOD))

ok('obrazovka formátuje čas přes lib/cas.ts',
  /datumACasVPasmu\(/.test(STRANKA_KOD) || /denVPasmu\(/.test(STRANKA_KOD))
ok('a nepoužívá místní getry', !/\.get(Hours|Date|Month|FullYear)\(\)/.test(STRANKA_KOD))

console.log('\n== Práva ==')

/*
  PRÁVO SE HLEDÁ V TĚLE FUNKCE, NE V OKNĚ N ZNAKŮ ZA JMÉNEM.

  Napsal jsem to nejdřív jako „do 400 znaků od názvu funkce" a dvě
  kontroly spadly nad SPRÁVNÝM kódem: funkce si nejdřív načtou šest
  polí z formuláře a `pripravit` je až za nimi. Okno pevné délky je
  křehké z obou stran — protáhne se tělo a kontrola spadne bez chyby;
  zkrátí se sousední funkce a chytne se cizí právo.
*/
const telo = (jmeno) => {
  const od = AKCE_KOD.indexOf(`export async function ${jmeno}`)
  if (od < 0) return ''
  const dalsi = AKCE_KOD.indexOf('export async function ', od + 10)
  return AKCE_KOD.slice(od, dalsi < 0 ? undefined : dalsi)
}

const pravoVe = (jmeno) => {
  const nalez = telo(jmeno).match(/pripravit\(rozsah, '([a-z.]+)'\)/)
  return nalez?.[1] ?? null
}

ok('všechny čtyři akce se v souboru našly',
  ['zalozitKampan', 'vyrobitSerii', 'zalozitAutomatizaci', 'prepnoutAutomatizaci']
    .every((j) => telo(j).length > 200))

ma('kampaň zakládá marketing.manage', pravoVe('zalozitKampan'), 'marketing.manage')
ma('sérii vyrábí taky manage', pravoVe('vyrobitSerii'), 'marketing.manage')

/*
  Zapnout automatizaci je rozhodnutí toho druhu jako poslat příspěvek
  ven, proto `publish`. Kdyby stačilo `manage`, mohl by ji zapnout
  i ten, kdo nesmí nic zveřejnit — a ona by mu vyráběla obsah.
*/
ma('automatizaci zakládá jen marketing.publish',
  pravoVe('zalozitAutomatizaci'), 'marketing.publish')
ma('a přepíná ji taky jen publish',
  pravoVe('prepnoutAutomatizaci'), 'marketing.publish')

/*
  ROZSAH Z FORMULÁŘE JE NÁVRH, NE OPRÁVNĚNÍ (pravidlo 4). Když se
  pobočka posílá formulářem, musí se ověřit proti členství — jinak
  stačí přepsat jedno číslo a vedoucí baru založí kampaň na cizí
  provozovně.
*/
ok('pobočka z formuláře se ověřuje proti oprávnění',
  /if \(pobocka && pobocka !== branchId\)[\s\S]{0,200}zkusPristup\(/.test(AKCE_KOD))

console.log('\n== Automatizace se zakládá vypnutá ==')

ok('akce zapisuje zapnuta: false', /zapnuta: false/.test(AKCE_KOD))
ok('a nebere to z formuláře', !/zapnuta: .*formData/.test(AKCE_KOD))
ok('obrazovka to říká dopředu', /vypnutá/.test(STRANKA))

console.log('\n== Vypnutí nemaže, jen přepíná ==')

const PREPNOUT = telo('prepnoutAutomatizaci')
ok('vypínač nic nemaže', !/\.delete\(/.test(PREPNOUT))
ok('jen přepíná příznak', /zapnuta: zapnout/.test(PREPNOUT))
ok('a obrazovka slibuje, že historie zůstane', /Historie zůstala/.test(STRANKA))

console.log('\n== Vidět je poslední i příští běh ==')

ok('obrazovka ukazuje poslední běh', /posledni_beh_kdy/.test(STRANKA_KOD))
ok('a příští', /pristi_beh_kdy/.test(STRANKA_KOD))
ok('a historii výsledků', /marketing_automatizace_behy/.test(STRANKA_KOD))

/*
  Příští běh se spočítá už při ZAPNUTÍ. Kdyby se dopočítával až při
  prvním běhu úlohy, stálo by tam do té doby prázdno — a zapnutá
  automatizace bez termínu vypadá jako porucha.
*/
ok('příští běh se počítá při zapnutí', /pristi_beh_kdy: zapnout \? pristi : null/.test(PREPNOUT))

console.log('\n== Úloha, která automatizace pustí ==')

const ULOHA = readFileSync('app/api/uloha/marketing-automatizace/route.ts', 'utf8')
const ULOHA_KOD = ULOHA.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

ok('úloha existuje a má tělo', ULOHA.length > 3000)

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA U TÉHLE ÚLOHY.

  Zakládá koncepty a verze. NIKDY publikační úlohy ani schválení —
  to by byla druhá cesta ven, která obejde čtyři spouště, na kterých
  stojí celé schvalování.
*/
ok('úloha nezakládá publikační úlohy', !/marketing_publikace_ulohy/.test(ULOHA_KOD))
ok('ani schválení', !/marketing_schvaleni/.test(ULOHA_KOD))
ok('ani nenastavuje stav „naplánováno"', !/stav: 'naplanovano'/.test(ULOHA_KOD))
ok('zakládá příspěvky a verze',
  /from\('marketing_prispevky'\)/.test(ULOHA_KOD) && /from\('marketing_verze'\)/.test(ULOHA_KOD))

console.log('\n== Chráněná adresa ==')

/*
  Nechráněná adresa je první věc, která se u naplánovaných úloh pokazí.
  Tajemství se porovnává v konstantním čase (`tajemstviSedi`), stejně
  jako u fronty publikací.
*/
ok('adresa se chrání tajemstvím', /tajemstviSedi\(/.test(ULOHA_KOD))
ok('bez něj vrací 401', /status: 401/.test(ULOHA_KOD))

/*
  A 503 („chybí servisní klíč") AŽ ZA OVĚŘENÍM. Kdo netrefí tajemství,
  se z odpovědi nesmí dozvědět ani to, jestli tahle adresa něco dělá.
*/
ok('503 je až za ověřením tajemství',
  ULOHA_KOD.indexOf('status: 401') < ULOHA_KOD.indexOf('status: 503'))

console.log('\n== Nic z toho nepadá na jedné automatizaci ==')

ok('každá automatizace má vlastní try', /for \(const a of automatizace\)[\s\S]{0,200}try \{/.test(ULOHA_KOD))
ok('a chyba se zapíše k ní, ne k běhu',
  /catch \(e\)[\s\S]{0,300}zapsatBeh/.test(ULOHA_KOD))
ok('bere se po dávkách', /limit\(DAVKA\)/.test(ULOHA_KOD))

console.log('\n== „Není z čeho" není chyba ==')

/*
  Když na ten den není potvrzené menu, je to normální stav — kuchař ho
  ještě nepotvrdil. Kdyby to spadlo pod chybu, svítilo by to červeně
  a někdo by šel opravovat něco, co není rozbité.
*/
/*
  VĚTEV MUSÍ VRACET „PŘESKOČENO", NE JEN OBSAHOVAT TO SLOVO.

  Napsal jsem to nejdřív jako „někde v souboru je `preskoceno` a někde
  je věta o menu". Prošlo to i po tom, co jsem tu větev přepsal na
  `chyba` — protože `preskoceno` se v souboru vyskytuje i jinde
  (evergreen, „dneska už to běželo"). Hledá se proto výsledek a důvod
  POHROMADĚ, v jednom objektu.
*/
ok('chybějící menu se zapíše jako přeskočené',
  /vysledek: 'preskoceno',\s*\n\s*duvod: `Na \$\{cilovyDen\} není potvrzené menu\.`/.test(ULOHA))

ok('a bere se jen POTVRZENÉ menu', /\.eq\('stav', 'potvrzeno'\)/.test(ULOHA_KOD))

console.log('\n== Dvakrát za den ne ==')

/*
  Jedinečný index to odmítne, ale to je POJISTKA, ne řízení toku.
  Kdyby se úloha spoléhala na výjimku, spadla by uprostřed a stav by
  zůstal rozpůlený: koncepty založené, běh nezapsaný.
*/
ok('úloha se ptá předem, jestli dneska už neběžela',
  /from\('marketing_automatizace_behy'\)[\s\S]{0,300}\.eq\('provozni_den', dnes\)/.test(ULOHA_KOD))

ok('a ptá se jen na úspěšné běhy',
  /\.eq\('provozni_den', dnes\)[\s\S]{0,120}\.eq\('vysledek', 'hotovo'\)/.test(ULOHA_KOD))

/*
  Druhá ochrana, jiná než ta první: na totéž menu nesmí vzniknout dva
  příspěvky, i kdyby si jeden udělal člověk ručně.
*/
ok('a na totéž menu se koncept nevyrobí dvakrát',
  /vstupy->>menu_id/.test(ULOHA_KOD))

/*
  A že se chyba toho hledání NESPOLKNE. První verze měla
  `.then(r => r, () => ({ data: null }))` nad dotazem na sloupec,
  který neexistuje — kontrola by se tvářila, že proběhla, a nehlídala
  by nic.
*/
ok('a chyba toho hledání se nespolkne',
  /if \(chybaHledani\)/.test(ULOHA_KOD) && !/\.then\(\(r\) => r, \(\) =>/.test(ULOHA_KOD))

console.log('\n== Provozní den a pásmo (pravidla 10 a 11) ==')

ok('den se ptá databáze', /rpc\('business_date'/.test(ULOHA_KOD))
ok('hodina taky', /marketing_ted_v_pasmu/.test(ULOHA_KOD))
ok('termín se převádí přes marketing_okamzik', /rpc\('marketing_okamzik'/.test(ULOHA_KOD))
ok('den se nepočítá ze serveru', !/toISOString\(\)\.slice/.test(ULOHA_KOD))
ok('a posun dnů jde přes Date.UTC', /Date\.UTC\(/.test(ULOHA_KOD))

console.log('\n== Příští běh se posune i po chybě ==')

/*
  Kdyby se posouval jen po úspěchu, zůstala by automatizace s prošlým
  termínem navždy „na řadě": každý běh úlohy by ji zkusil znovu,
  pokaždé by spadla a historie by se zaplnila stejnou chybou stokrát
  za den.
*/
const ZAPIS = ULOHA_KOD.slice(ULOHA_KOD.indexOf('async function zapsatBeh'))
ok('běh se zapisuje vždycky', /from\('marketing_automatizace_behy'\)[\s\S]{0,200}\.insert\(/.test(ZAPIS))
ok('a příští běh se posouvá ve stejné funkci', /pristi_beh_kdy: pristi/.test(ZAPIS))
/*
  A ŽE SE ZE `zapsatBeh` NEVYSKOČÍ DŘÍV.

  Původně jsem hlídal jen podobu `if (v.vysledek === 'hotovo')`.
  Sabotáž použila opačnou (`if (v.vysledek !== 'hotovo') return`)
  a kontrola zůstala zelená. Hledá se proto JAKÝKOLI předčasný návrat
  podmíněný výsledkem — ať je napsaný jakkoli.
*/
ok('takže i po chybě — nikde se dřív nevyskočí',
  !/if \([^)]*v\.vysledek[^)]*\)\s*return/.test(ZAPIS)
  && !/if \([^)]*v\.vysledek[^)]*\)\s*\{[\s\S]{0,80}return/.test(ZAPIS))

console.log('\n== Plánovač ==')

const PLAN = readFileSync('.github/workflows/marketing-automatizace.yml', 'utf8')
ok('workflow existuje', PLAN.length > 500)
ok('volá tu správnou adresu', /api\/uloha\/marketing-automatizace/.test(PLAN))
ok('posílá tajemství v hlavičce, ne v adrese',
  /Authorization: Bearer/.test(PLAN) && !/\?.*TAJEMSTVI/.test(PLAN))
ok('a nenulově končí na čemkoli jiném než 200', /exit 1/.test(PLAN) && /200\) ;;/.test(PLAN))

/*
  Hodina stačí — nic se neposílá ven. Kdyby tu byl čtvrthodinový
  interval jako u fronty, běželo by to zbytečně čtyřikrát tolik.
*/
ok('jede jednou za hodinu, ne po čtvrthodinách',
  /cron: '\d+ \* \* \* \*'/.test(PLAN))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
