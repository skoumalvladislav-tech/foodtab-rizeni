#!/usr/bin/env node
/**
 * Kalendář obsahu — počítání dnů, mřížky a varování.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-kalendar.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * Kalendář je počítání s daty a ty se dají spočítat špatně tak, že to
 * skoro vždycky vyjde. Většina chyb v mřížce měsíce se ukáže jen
 * v některých měsících — proto se tu neověřuje jeden měsíc, ale
 * VŠECHNY měsíce několika let.
 *
 * Je to přesně ta třída chyby, před kterou varuje CLAUDE.md v oddílu
 * „Testy, které závisí na kalendáři": kontrola, která platí jen část
 * roku, se „opraví sama" a příště se na tu červenou nikdo nepodívá.
 */

import {
  DNY_ZKRATKY,
  MEZERA_DNU,
  MOC_ZA_DEN,
  PILIRE,
  barvaPilire,
  denVTydnu,
  dnyTydne,
  mezeObdobi,
  mrizkaMesice,
  nazevMesice,
  nazevTydne,
  pondeliTydne,
  popisPilire,
  posledniDenMesice,
  posunDen,
  posunMesic,
  prvniDenMesice,
  rozdilDnu,
  varovani,
  zaradDoDnu,
} from '../lib/marketing-kalendar.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, skutecnost === cekano, `${skutecnost} ≠ ${cekano}`)

console.log('\n== Týden začíná v pondělí ==')

/*
  `getUTCDay()` vrací 0 pro neděli. Kdyby se vzalo, jak to chodí,
  vyšel by americký týden a celá mřížka by byla o den posunutá.
*/
ma('pondělí je 0', denVTydnu('2026-09-14'), 0)
ma('neděle je 6', denVTydnu('2026-09-20'), 6)
ma('sobota je 5', denVTydnu('2026-09-19'), 5)
ma('zkratky začínají pondělím', DNY_ZKRATKY[0], 'po')
ma('a končí nedělí', DNY_ZKRATKY[6], 'ne')

console.log('\n== Posun o měsíc nepřeskočí měsíc ==')

/*
  TOHLE JE TA NEJTIŠŠÍ CHYBA V CELÉM SOUBORU.

  `new Date(2026, 0, 31)` posunutý o měsíc dá 3. BŘEZNA, protože únor
  tolik dnů nemá. V kalendáři by to znamenalo, že se z ledna klikne na
  březen a únor se přeskočí — a všimne si toho jen ten, kdo zrovna
  stojí na 29., 30. nebo 31.
*/
ma('z 31. ledna se jde na únor, ne na březen', posunMesic('2026-01-31', 1), '2026-02-28')
ma('z 31. března na duben', posunMesic('2026-03-31', 1), '2026-04-30')
ma('a zpátky z 31. března na únor', posunMesic('2026-03-31', -1), '2026-02-28')
ma('v přestupném roce má únor 29', posunMesic('2028-01-31', 1), '2028-02-29')
ma('přes konec roku dopředu', posunMesic('2026-12-15', 1), '2027-01-15')
ma('přes konec roku zpátky', posunMesic('2026-01-15', -1), '2025-12-15')

/*
  A že se posunem NIKDY nepřeskočí měsíc — ověřeno pro každý den
  každého měsíce dvou let, ne pro pár vybraných.
*/
let preskoceno = 0
for (let rok = 2026; rok <= 2027; rok++) {
  for (let m = 1; m <= 12; m++) {
    const dnu = new Date(Date.UTC(rok, m, 0)).getUTCDate()
    for (let d = 1; d <= dnu; d++) {
      const datum = `${rok}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dopredu = posunMesic(datum, 1)
      const ocekavany = m === 12 ? `${rok + 1}-01` : `${rok}-${String(m + 1).padStart(2, '0')}`
      if (dopredu.slice(0, 7) !== ocekavany) preskoceno++
    }
  }
}
ma('žádný den ze dvou let neposkočí o dva měsíce', preskoceno, 0)

console.log('\n== Posun o dny přes přelomy ==')

ma('přes konec měsíce', posunDen('2026-09-30', 1), '2026-10-01')
ma('přes konec roku', posunDen('2026-12-31', 1), '2027-01-01')
ma('zpátky přes začátek roku', posunDen('2027-01-01', -1), '2026-12-31')
ma('o týden', posunDen('2026-09-14', 7), '2026-09-21')

/*
  PŘES PŘECHOD NA LETNÍ ČAS. 29. 3. 2026 má v Praze 23 hodin. Kdyby se
  posouvalo přičtením 86 400 000 milisekund k místnímu času, vyšel by
  tentýž den znovu. Proto se počítá v UTC.
*/
ma('přes přechod na letní čas', posunDen('2026-03-29', 1), '2026-03-30')
ma('přes přechod na zimní čas', posunDen('2026-10-25', 1), '2026-10-26')

console.log('\n== Mřížka měsíce ==')

const zari = mrizkaMesice('2026-09-14')
ma('září 2026 má pět týdnů', zari.length, 5)
ma('a začíná pondělím 31. srpna', zari[0][0].datum, '2026-08-31')
ok('31. srpna je označené jako cizí měsíc', zari[0][0].vMesici === false)
ma('první zářijový den je úterý', zari[0][1].datum, '2026-09-01')
ok('a je označený jako náš', zari[0][1].vMesici === true)

/*
  MŘÍŽKA SE OVĚŘUJE PRO VŠECHNY MĚSÍCE ŠESTI LET, ne pro jeden.

  Měsíc, který začíná v pondělí, a měsíc, který má 31 dnů a začíná
  v neděli, se chovají úplně jinak — první má čtyři až pět týdnů,
  druhý šest. Jeden zelený běh nad zářím o těch ostatních neříká nic.
*/
let vad = 0
for (let rok = 2024; rok <= 2029; rok++) {
  for (let m = 1; m <= 12; m++) {
    const prvni = `${rok}-${String(m).padStart(2, '0')}-01`
    const mrizka = mrizkaMesice(prvni)
    const vsechny = mrizka.flat()

    // Každý týden má sedm dnů.
    if (mrizka.some((t) => t.length !== 7)) vad++
    // Začíná pondělím a končí nedělí.
    if (denVTydnu(vsechny[0].datum) !== 0) vad++
    if (denVTydnu(vsechny[vsechny.length - 1].datum) !== 6) vad++
    // Dny jdou po sobě bez díry a bez opakování.
    for (let i = 1; i < vsechny.length; i++) {
      if (posunDen(vsechny[i - 1].datum, 1) !== vsechny[i].datum) vad++
    }
    // Všechny dny měsíce jsou uvnitř, a právě jednou.
    const nase = vsechny.filter((d) => d.vMesici).map((d) => d.datum)
    const dnuVMesici = Number(posledniDenMesice(prvni).slice(-2))
    if (nase.length !== dnuVMesici) vad++
    if (new Set(nase).size !== nase.length) vad++
  }
}
ma('72 měsíců šesti let dá pokaždé celou a neděravou mřížku', vad, 0)

console.log('\n== Týden a názvy období ==')

const tyden = dnyTydne('2026-09-17')
ma('týden má sedm dnů', tyden.length, 7)
ma('a začíná pondělím', tyden[0], '2026-09-14')
ma('pondělí týdne z neděle je ta předchozí', pondeliTydne('2026-09-20'), '2026-09-14')
ma('a z pondělí je to ono samo', pondeliTydne('2026-09-14'), '2026-09-14')

ma('název měsíce', nazevMesice('2026-09-14'), 'září 2026')
ma('název týdne uvnitř měsíce', nazevTydne('2026-09-14'), '14.–20. září 2026')
ma('název týdne přes přelom měsíce', nazevTydne('2026-09-28'), '28. září – 4. října 2026')
ma('název týdne přes přelom roku', nazevTydne('2026-12-30'), '28. prosince 2026 – 3. ledna 2027')

ma('první den měsíce', prvniDenMesice('2026-09-14'), '2026-09-01')
ma('poslední den měsíce', posledniDenMesice('2026-09-14'), '2026-09-30')
ma('poslední den února v přestupném roce', posledniDenMesice('2028-02-01'), '2028-02-29')

console.log('\n== Meze dotazu berou den navíc ==')

/*
  Rozšíření o den na každou stranu není nedbalost — je to jediné, co
  jde udělat bez znalosti pásma každé pobočky. Kdyby se to někdy
  „uklidilo" na přesné meze, zmizel by v kalendáři příspěvek na
  1. 10. ve 23:30 pokaždé, když se mění čas.
*/
const meze = mezeObdobi('2026-09-01', '2026-09-30')
ok('začátek je o den dřív', meze.od.startsWith('2026-08-31'))
ok('konec je o den později', meze.do.startsWith('2026-10-01'))

console.log('\n== Řazení do dnů se ptá na pásmo ==')

/*
  `zaradDoDnu` si den NEPOČÍTÁ SAMO. Dostane funkci, protože převod
  okamžiku na kalendářní den patří do lib/cas.ts, kde je pásmo povinný
  údaj (CLAUDE.md, pravidlo 11). Tady se ověřuje, že se ta funkce
  opravdu volá a že se jí předá pobočka.
*/
const prispevky = [
  { id: '1', nazev: 'A', stav: 'naplanovano', pilir: 'menu', kanaly: ['instagram'], planovano_na: '2026-09-14T10:00:00Z', branch_id: 'b1' },
  { id: '2', nazev: 'B', stav: 'naplanovano', pilir: 'akce', kanaly: ['facebook'], planovano_na: '2026-09-14T18:00:00Z', branch_id: 'b2' },
  { id: '3', nazev: 'Bez data', stav: 'koncept', pilir: 'menu', kanaly: [], planovano_na: null, branch_id: 'b1' },
]

const pobockyVolane = []
const naDen = (okamzik, branchId) => {
  pobockyVolane.push(branchId)
  return okamzik.slice(0, 10)
}

const podleDne = zaradDoDnu(prispevky, naDen)
ma('dva příspěvky padly do téhož dne', podleDne.get('2026-09-14')?.length, 2)
ok('příspěvek bez data se nikam nezařadil', !podleDne.has('') && podleDne.size === 1)
ok('a pobočka se do převodu opravdu předala',
  pobockyVolane.includes('b1') && pobockyVolane.includes('b2'))

/*
  A ŽE SE PÁSMO NEIGNORUJE. Kdyby si `zaradDoDnu` den ukrojilo samo
  z řetězce, tahle kontrola by prošla i s funkcí, která vrací nesmysl
  — takže se ověřuje, že se používá NÁVRATOVÁ HODNOTA té funkce.
*/
const jinak = zaradDoDnu(prispevky, () => '1999-01-01')
ok('den se bere z předané funkce, ne z řetězce', jinak.has('1999-01-01'))

console.log('\n== Varování ==')

const dny = dnyTydne('2026-09-14')
const prazdno = new Map()
ma('v prázdném týdnu se nevaruje na mezeru', varovani(dny, prazdno).length, 0)

/*
  MEZERA SE POČÍTÁ Z PRÁZDNÝCH DNŮ, NE Z ROZDÍLU DAT.

  Mezi 1. a 8. je sedm dnů rozdílu, ale šest dnů bez obsahu. Kdyby se
  hlásilo „sedm dnů se nic nedělo", nesedělo by to s tím, co je vidět
  v kalendáři — a to je ten druh drobnosti, kvůli které lidé přestanou
  varování věřit.
*/
const mesic = mrizkaMesice('2026-09-01').flat().map((d) => d.datum)
const sMezerou = new Map([
  ['2026-09-01', [prispevky[0]]],
  ['2026-09-12', [prispevky[0]]],
])
const nalezyMezera = varovani(mesic, sMezerou).filter((v) => v.druh === 'mezera')
ma('dlouhá mezera se ohlásí', nalezyMezera.length, 1)
ma('a řekne se, kolik dnů bylo prázdných', nalezyMezera[0].dnu, 10)

const tesne = new Map([
  ['2026-09-01', [prispevky[0]]],
  [`2026-09-0${1 + MEZERA_DNU}`, [prispevky[0]]],
])
ma('mezera přesně na hranici se nehlásí',
  varovani(mesic, tesne).filter((v) => v.druh === 'mezera').length, 0)

const nacpano = new Map([['2026-09-10', Array(MOC_ZA_DEN + 1).fill(prispevky[0])]])
const nalezyMoc = varovani(mesic, nacpano).filter((v) => v.druh === 'moc')
ma('příliš mnoho za den se ohlásí', nalezyMoc.length, 1)
ma('a řekne se kolik', nalezyMoc[0].kolik, MOC_ZA_DEN + 1)

const akorat = new Map([['2026-09-10', Array(MOC_ZA_DEN).fill(prispevky[0])]])
ma('přesně na hranici se nehlásí',
  varovani(mesic, akorat).filter((v) => v.druh === 'moc').length, 0)

ma('rozdíl dnů přes přelom měsíce', rozdilDnu('2026-08-30', '2026-09-02'), 3)
ma('rozdíl dnů přes přechod na letní čas', rozdilDnu('2026-03-28', '2026-03-30'), 2)

console.log('\n== Pilíře ==')

ma('pilířů je šest', PILIRE.length, 6)
ok('a jsou to ty ze zadání',
  ['menu', 'lide', 'atmosfera', 'akce', 'zakulisi', 'prodej']
    .every((k) => PILIRE.some((p) => p.klic === k)))

/*
  Pilíře musí sedět s typem `Pilir` v lib/marketing-sablony.ts —
  šablona zakládá příspěvek a zapisuje do něj svůj pilíř. Kdyby se
  seznamy rozešly, měl by příspěvek pilíř, který kalendář neumí
  obarvit ani pojmenovat.
*/
const { readFileSync } = await import('node:fs')
const sablony = readFileSync('lib/marketing-sablony.ts', 'utf8')
const typPilir = sablony.match(/export type Pilir = ([^;]+);/)
ok('typ Pilir se v šablonách našel', Boolean(typPilir))
const zeSablon = (typPilir?.[1] ?? '').match(/"([a-z_]+)"/g)?.map((x) => x.replaceAll('"', '')) ?? []
ma('a má stejný počet jako kalendář', zeSablon.length, PILIRE.length)
ok('a stejné klíče', zeSablon.every((k) => PILIRE.some((p) => p.klic === k)))

ma('název pilíře', popisPilire('zakulisi'), 'Zákulisí')
ma('neznámý pilíř se nepřeloží na prázdno', popisPilire('vymysleny'), 'vymysleny')

/*
  Barvy jsou odkazy na proměnné palety, ne napevno psané odstíny.
  Natvrdo napsaný `#2d7b4f` by v tmavém režimu zůstal světlý.
*/
ok('barvy jdou z palety, ne z kódu',
  PILIRE.every((p) => /^var\(--b-[a-z]+\)$/.test(p.barva)))
ok('a každý pilíř má jinou', new Set(PILIRE.map((p) => p.barva)).size === PILIRE.length)
ma('neznámý pilíř dostane neutrální barvu', barvaPilire('vymysleny'), 'var(--line)')

const tokeny = readFileSync('app/_tokeny.css', 'utf8')
ok('a všechny ty proměnné v paletě opravdu jsou',
  PILIRE.every((p) => tokeny.includes(`${p.barva.slice(4, -1)}:`)))

console.log('\n== Obrazovka to opravdu používá ==')

/*
  Knihovna může být sebelíp spočítaná — když ji obrazovka nevolá,
  neověřuje se nic. Tyhle kontroly míří na to, co by se z obrazovky
  dalo nenápadně vypustit a nikdo by si toho měsíce nevšiml.

  Zdroj se čte jako text: serverová komponenta se mimo aplikaci
  vykreslit nedá. Komentáře se vyškrtávají, jinak by se zákaz trefil
  do vlastního vysvětlení — to nás chytlo u fronty ke schválení.
*/
const STRANKA = readFileSync('app/[rozsah]/marketing/kalendar/page.tsx', 'utf8')
const KOD = STRANKA
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

ok('obrazovka má tělo', STRANKA.length > 3000)
ok('kreslí mřížku z knihovny', /mrizkaMesice\(/.test(KOD))
ok('a týden taky', /dnyTydne\(/.test(KOD))
ok('posouvá se přes posunMesic, ne přes setMonth', /posunMesic\(/.test(KOD))
ok('varování se počítají z knihovny', /varovani\(/.test(KOD))
ok('meze dotazu berou den navíc', /mezeObdobi\(/.test(KOD))

console.log('\n== Čas jde přes pásmo, ne přes server (pravidlo 11) ==')

/*
  TOHLE JE V KALENDÁŘI NEJDRAŽŠÍ CHYBA.

  `planovano_na` je okamžik. Do kterého dne spadne, rozhoduje pásmo
  pobočky. `toISOString().slice(0,10)` by dal den v UTC — a příspěvek
  naplánovaný na 1. října ve 23:30 by v kalendáři skočil na 1. října
  jen v zimě. V létě by seděl, takže by se na to přišlo v listopadu.
*/
ok('den se počítá přes denVPasmu', /denVPasmu\(/.test(KOD))
ok('hodina taky přes pásmo', /hodinaVPasmu\(/.test(KOD))
ok('nepoužívá se toISOString', !/toISOString\(/.test(KOD))
ok('ani getHours, getDate a spol.', !/\.get(Hours|Date|Month|FullYear)\(\)/.test(KOD))
ok('ani toLocaleDateString bez pásma', !/toLocale[A-Za-z]*String\(\)/.test(KOD))

/*
  A že se pásmo bere z POBOČKY, ne z jedné konstanty pro celou firmu.
  Pravidlo 11: pobočka, jinak firma, jinak Praha.
*/
ok('pásmo se čte z poboček', /branches'\)[\s\S]{0,120}timezone/.test(KOD))
ok('s pojistkou přes firmu', /tenants'\)[\s\S]{0,80}timezone/.test(KOD))
ok('a pojistkou přes Prahu', /ZONA_VYCHOZI/.test(KOD))

/*
  Dnešek se taky bere z pásma. Kdyby se bral ze serveru, kalendář by
  se na Vercelu po 22:00 sám přepnul na zítřek.
*/
ok('dnešek se počítá v pásmu firmy',
  /const dnes = denVPasmu\(new Date\(\), zonaFirmy\)/.test(KOD))

console.log('\n== Přístup a rozsah ==')

ok('ptá se na marketing.read', /'marketing\.read'/.test(KOD))
ok('a nepřihlášeného posílá na přihlášení', KOD.includes('odkazNaPrihlaseni'))

/*
  Filtry přicházejí z adresy, tedy od uživatele. Kdyby se strkaly do
  dotazu, jak přijdou, byla by to cesta, jak si vyrobit vlastní dotaz.
  Ověřuje se, že se každý porovná proti seznamu, který zná aplikace.
*/
ok('kanál se ověřuje proti seznamu', /KANALY\.some\(/.test(KOD))
ok('pilíř taky', /PILIRE\.some\(/.test(KOD))
ok('stav proti seznamu stavů', /in STAVY_PRISPEVKU/.test(KOD))
ok('a datum proti tvaru', /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(KOD))

/*
  Kanály jsou v databázi POLE. `eq` by hledalo příspěvek, který má
  právě jeden kanál a zrovna tenhle — takže by se u příspěvku na IG
  i FB nenašel ani jeden filtr. `contains` je správně.
*/
ok('kanál se filtruje přes contains, ne eq',
  /contains\('kanaly'/.test(KOD) && !/\.eq\('kanaly'/.test(KOD))

console.log('\n== Co se nemá ztratit ==')

ok('koncepty bez termínu se zobrazují', /is\('planovano_na', null\)/.test(KOD))
ok('archiv a zamítnuté se nekreslí', /SCHOVANE/.test(KOD))
ok('pilíř je vidět barvou', /barvaPilire\(/.test(KOD))
ok('a je k němu legenda', /PILIRE\.map\(/.test(KOD))

/*
  Přesun termínu se tu nedělá schválně — naplánovat smí jen schválenou
  verzi a to ověřuje `naplanovat`. Kdyby obrazovka začala psát do
  tabulky sama, obešla by to. Tahle kontrola to hlídá.
*/
ok('kalendář sám nepíše do příspěvků',
  !/\.update\(|\.insert\(|\.upsert\(/.test(KOD))

console.log('\n== Přesun termínu ==')

const AKCE = readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')
const AKCE_KOD = AKCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
const PRESUN = AKCE_KOD.slice(AKCE_KOD.indexOf('export async function presunoutTermin'))

ok('akce na přesun existuje', PRESUN.length > 500)
ok('a obrazovka ji volá', /presunoutTermin/.test(KOD))
ok('a nepíše do tabulky sama', !/\.update\(|\.insert\(|\.upsert\(/.test(KOD))

/*
  NEJDŮLEŽITĚJŠÍ KONTROLA V CELÉM SOUBORU.

  `planovano_na` je na DVOU místech: na příspěvku (co ukazuje kalendář)
  a na publikační úloze (podle čeho si ji vyzvedne fronta). Kdyby se
  posunul jen příspěvek, seděl by v kalendáři nový termín a ven by to
  odešlo v ten starý. Nic by nespadlo a přišlo by se na to z Instagramu.
*/
ok('posouvá se i publikační úloha, ne jen příspěvek',
  /marketing_publikace_ulohy'\)[\s\S]{0,200}planovano_na/.test(PRESUN))
ok('a příspěvek taky',
  /marketing_prispevky'\)[\s\S]{0,200}planovano_na/.test(PRESUN))

/*
  Co už odešlo nebo se odesílá, se nepřesouvá. Bez téhle podmínky by
  `update` sáhl i na `zverejneno` a přepsal termín u něčeho, co je
  dávno venku — tedy zfalšoval historii.
*/
ok('přesouvají se jen čekající a neúspěšné úlohy',
  /\.in\('stav', \['naplanovano', 'selhalo'\]\)/.test(PRESUN))
ok('a zveřejněný příspěvek se přesunout nedá',
  /stav === 'zverejneno'/.test(PRESUN))

/*
  Když se neposunula ani jedna úloha, termín příspěvku se NEMĚNÍ.
  Kalendář, který ukazuje jiný den než fronta, je horší než přesun,
  který se nepovedl.
*/
ok('bez posunuté úlohy se termín nemění',
  /posunute\?\.length \?\? 0\) === 0/.test(PRESUN))

ok('přesouvat smí jen marketing.publish',
  /pripravit\(rozsah, 'marketing\.publish'\)/.test(PRESUN))
ok('a obrazovka na to právo taky kouká', /smiPresouvat/.test(KOD))

/*
  Hodina na zdi se převádí V DATABÁZI (pravidlo 11). `new Date` nad
  řetězcem bez pásma by se přečetlo v pásmu serveru — na Vercelu v UTC.
*/
ok('čas se převádí přes marketing_okamzik', /marketing_okamzik/.test(PRESUN))
ok('a ne přes new Date nad řetězcem s časem',
  !/new Date\(`\$\{datum\}/.test(PRESUN))

/*
  Přesun NESMÍ zakládat publikační úlohy. `naplanovat` je od toho, aby
  ověřil schválenou verzi a platné schválení; kdyby je zakládal i
  přesun, vznikla by druhá cesta ven a ta by ty kontroly obešla.
*/
ok('přesun nezakládá nové publikace',
  !/from\('marketing_publikace_ulohy'\)[\s\S]{0,120}\.insert\(/.test(PRESUN))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
