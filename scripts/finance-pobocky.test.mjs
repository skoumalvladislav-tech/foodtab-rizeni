#!/usr/bin/env node
/**
 * Finance po pobočkách — navigace, rozsah a pojistky obrazovek jen pro
 * celou firmu.
 *
 * Pusť:
 *   node scripts/finance-pobocky.test.mjs
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE EXISTUJE
 *
 * Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět finance,
 * které se týkají jen Bernard Baru." Do té doby se Finance na pobočce
 * nekreslily vůbec. Teď se kreslí — a každá obrazovka je buď
 *
 *   * pobočková: bere si pobočku z rozsahu (`pobockaFinanci`,
 *     lib/finance-rozsah.ts) a ukazuje jen její řádky, nebo
 *   * jen pro celou firmu (Kontakty, Integrace, AI analytik, import
 *     výpisu, Faktury): na pobočce místo dat věta a odkaz na firmu.
 *
 * Třetí možnost („zapomněl jsem") je přesně ta, která by vedoucímu
 * pobočky ukázala čísla celé firmy. Proto tu stojí kontrola nad VŠEMI
 * stránkami pod app/[rozsah]/finance — nová obrazovka bez jednoho
 * z těch dvou tvarů ji shodí.
 *
 * ---------------------------------------------------------------------
 * PROČ STRÁNKA I LAYOUT
 *
 * Next (16.x, server/app-render/create-component-tree.js) skládá stránku
 * jako samostatný kus dat VEDLE layoutu: layout dostane jen
 * `<LayoutRouter>`, stránka se vyrenderuje a pošle klientovi, i když ji
 * layout nepoužije. Layout s `JenProFirmu` proto hlídá jen KRESLENÍ —
 * stránka pod ním musí pobočku odmítnout sama, prvním řádkem, dřív než
 * cokoli načte. A serverové akce těch obrazovek chtějí právo za celou
 * firmu (`TENANT_SCOPE_SEGMENT`), ne za rozsah z formuláře.
 *
 * ---------------------------------------------------------------------
 * CO SE SPOUŠTÍ A CO ČTE
 *
 * Čisté funkce (lib/finance-navigace.ts, lib/finance-rozsah.ts,
 * lib/vychozi-obrazovka.ts) a skutečná nabídka (app/[rozsah]/nabidka.ts,
 * přeložená přes scripts/vykreslit.mjs) se SPOUŠTĚJÍ. Stránky, layouty
 * a serverové akce se čtou jako text bez komentářů — každá kontrola míří
 * na přesný řádek (regex), ne na volné „obsahuje", ať spadne, když ten
 * řádek zmizí. Že to tak je, se zkoušelo rozbitím (13. 10. 2026).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { SEGMENT_FIRMY, aktivniKlic, sestavNavigaci } from '../lib/finance-navigace.ts'
import { POZNAMKA_FIREMNI, pobockaFinanci } from '../lib/finance-rozsah.ts'
import { cilPrepnutiRozsahu, polozkaNaCeste, vychoziObrazovka } from '../lib/vychozi-obrazovka.ts'
import { nactiModul } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Zdroj bez komentářů (JSX, blokových i celořádkových) a s LF konci řádků. */
const bezKomentaru = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const zdroj = (soubor) => bezKomentaru(readFileSync(soubor, 'utf8'))

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')

/* =====================================================================
 * 1. NAVIGACE FINANCÍ (lib/finance-navigace.ts)
 * ===================================================================== */

console.log('\n== Navigace Financí: celá firma vs. pobočka ==')

const JEN_FIRMA_KLICE = ['faktury', 'integrace', 'kontakty']
{
  const firma = sestavNavigaci('firma')
  const pobocka = sestavNavigaci('bernard-bar')
  const klice = (n) => n.hlavni.map((p) => p.klic)
  const chybiNaPobocce = klice(firma).filter((k) => !klice(pobocka).includes(k)).sort()

  ok('na firmě všech jedenáct položek, i Kontakty, Integrace a Faktury',
    firma.hlavni.length === 11 && JEN_FIRMA_KLICE.every((k) => klice(firma).includes(k)))
  ok(`na pobočce chybí PŘESNĚ Kontakty, Integrace a Faktury (chybí: ${chybiNaPobocce.join(', ') || 'nic'})`,
    JSON.stringify(chybiNaPobocce) === JSON.stringify(JEN_FIRMA_KLICE))
  ok('na pobočce zůstává Přehled, Tržby, Cashflow, Platby, Nákup, Zakázky, Rozpočty i Vybavení',
    ['prehled', 'trzby', 'cashflow', 'platby', 'nakup', 'zakazky', 'rozpocty', 'vybaveni'].every((k) => klice(pobocka).includes(k)))
  ok('odkazy pobočky vedou do jejího rozsahu',
    pobocka.hlavni.every((p) => p.href === '/bernard-bar/finance' || p.href.startsWith('/bernard-bar/finance/')))
  ok('mobilní lišta = táž sada (na pobočce bez Faktur)',
    pobocka.mobil.length === pobocka.hlavni.length && !pobocka.mobil.some((p) => p.klic === 'faktury'))
  ok('rozsah, který jen začíná na „firma", je pobočka (ne celá firma)',
    !klice(sestavNavigaci('firma-2')).includes('faktury'))
  ok('aktivní položka na pobočce: nejdelší shoda (Cashflow, ne Přehled)',
    aktivniKlic('/bernard-bar/finance/cashflow', pobocka.hlavni) === 'cashflow')
}

console.log('\n== Segment firmy: navigace a authz říkají totéž ==')

{
  const m = readFileSync('lib/authz.ts', 'utf8').match(/^export const TENANT_SCOPE_SEGMENT = '([^']+)'$/m)
  ok('TENANT_SCOPE_SEGMENT se v lib/authz.ts našel', Boolean(m))
  ok(`SEGMENT_FIRMY (${SEGMENT_FIRMY}) === TENANT_SCOPE_SEGMENT (${m?.[1]})`, m !== null && SEGMENT_FIRMY === m[1])
  ok('jeRozsahFirmy porovnává s TENANT_SCOPE_SEGMENT',
    /export function jeRozsahFirmy\(rozsah: string\): boolean \{\s*return rozsah === TENANT_SCOPE_SEGMENT\s*\}/.test(
      zdroj('app/[rozsah]/finance/jen-pro-firmu.tsx')))
}

/* =====================================================================
 * 2. ROZSAH (lib/finance-rozsah.ts)
 * ===================================================================== */

console.log('\n== pobockaFinanci: pobočka z rozsahu, null = celá firma ==')

ok('pobočka → její id', pobockaFinanci({ level: 'branch', branchId: 'b-bernard' }) === 'b-bernard')
ok('celá firma → null', pobockaFinanci({ level: 'tenant', branchId: null }) === null)
// Rozsah firmy s (omylem) vyplněnou pobočkou je pořád celá firma —
// rozhoduje úroveň, ne to, jestli je id vyplněné.
ok('úroveň firmy vyhrává nad vyplněným id', pobockaFinanci({ level: 'tenant', branchId: 'b-bernard' }) === null)
ok('poznámka pod pobočkou říká, kde firemní položky najít',
  typeof POZNAMKA_FIREMNI === 'string' && POZNAMKA_FIREMNI.includes('Celá firma'))

/* =====================================================================
 * 3. NABÍDKA (app/[rozsah]/nabidka.ts) — spouští se
 * ===================================================================== */

console.log('\n== Nabídka: jenFirma přesně u Kontaktů, Integrací a Faktur ==')

// Podstrčené authz: všechno smí, všechny moduly zapnuté — rozhoduje jen rozsah.
const AUTHZ = js(
  'export const canSee = () => true\n' +
    'export const isModuleActive = () => true\n' +
    'export const jeVedeni = () => true\n',
)
const nabidka = await nactiModul('app/[rozsah]/nabidka.ts', [['@/lib/authz', AUTHZ]])
{
  const jenFirma = nabidka.NABIDKA.filter((p) => p.jenFirma).map((p) => p.segment).sort()
  ok(`jenFirma: ${jenFirma.join(', ')}`,
    JSON.stringify(jenFirma) === JSON.stringify(['finance/faktury', 'finance/integrace', 'finance/kontakty']))
  ok('žádná položka nemá jenFirma i jenPobocka zároveň', !nabidka.NABIDKA.some((p) => p.jenFirma && p.jenPobocka))
  // Obě nabídky (levý sloupec appky a navigace Financí) schovávají totéž.
  ok('navigace Financí schovává na pobočce tytéž obrazovky',
    JSON.stringify(jenFirma.map((s) => s.replace('finance/', ''))) === JSON.stringify(JEN_FIRMA_KLICE))

  const ctx = {}
  const naFirme = nabidka.polozkyModulu(ctx, 'finance', true).map((p) => p.segment)
  const naPobocce = nabidka.polozkyModulu(ctx, 'finance', false).map((p) => p.segment)
  ok('polozkyModulu na firmě: i obrazovky jen pro firmu', jenFirma.every((s) => naFirme.includes(s)))
  ok('polozkyModulu na pobočce: bez nich', !jenFirma.some((s) => naPobocce.includes(s)))
  ok('  a jen bez nich (zbytek Financí zůstává)',
    naPobocce.length === naFirme.length - jenFirma.length && naPobocce.includes('finance/cashflow'))
  ok('viditelnaNabidka na pobočce bez nich, na firmě s nimi',
    !nabidka.viditelnaNabidka(ctx, false).some((p) => p.jenFirma) &&
      nabidka.viditelnaNabidka(ctx, true).filter((p) => p.jenFirma).length === 3)
  // Volání bez rozsahu (soubor .mjs mimo kontrolu typů) dostane
  // opatrnější variantu — nabídku pobočky.
  ok('bez rozsahu opatrně: jako na pobočce',
    !nabidka.polozkyModulu(ctx, 'finance').some((p) => p.jenFirma) &&
      !nabidka.viditelnaNabidka(ctx).some((p) => p.jenFirma))
}

/* =====================================================================
 * 4. VÝCHOZÍ OBRAZOVKA A PŘEPNUTÍ ROZSAHU (lib/vychozi-obrazovka.ts)
 * ===================================================================== */

console.log('\n== Výchozí obrazovka: na pobočce nikdy obrazovka jen pro firmu ==')

const P = (segment, dalsi = {}) => ({ segment, hotovo: true, ...dalsi })
ok('pobočka: Faktury (jenFirma) se přeskočí',
  vychoziObrazovka([P('finance/faktury', { jenFirma: true }), P('finance')], false) === 'finance')
ok('firma: Faktury výchozí být smí',
  vychoziObrazovka([P('finance/faktury', { jenFirma: true }), P('finance')], true) === 'finance/faktury')
ok('pobočka, jen obrazovky pro firmu → null, ne hláška',
  vychoziObrazovka([P('finance/kontakty', { jenFirma: true })], false) === null)
ok('Dnes vyhrává na pobočce i na firmě',
  vychoziObrazovka([P('finance/faktury', { jenFirma: true }), P('dnes')], false) === 'dnes' &&
    vychoziObrazovka([P('finance/faktury', { jenFirma: true }), P('dnes')], true) === 'dnes')

console.log('\n== polozkaNaCeste: nejdelší shoda ==')

{
  const N = nabidka.NABIDKA
  ok('skutečná nabídka: Přehled (finance) stojí před Cashflow — jinak by kontrola nic neměřila',
    N.findIndex((p) => p.segment === 'finance') >= 0 &&
      N.findIndex((p) => p.segment === 'finance') < N.findIndex((p) => p.segment === 'finance/cashflow'))
  ok('finance/cashflow → Cashflow, ne Přehled', polozkaNaCeste('finance/cashflow', N)?.segment === 'finance/cashflow')
  ok('finance/faktury/seznam → Faktury', polozkaNaCeste('finance/faktury/seznam', N)?.segment === 'finance/faktury')
  ok('finance → Přehled', polozkaNaCeste('finance', N)?.segment === 'finance')
  ok('finance/analytik (bez vlastní položky) → Přehled', polozkaNaCeste('finance/analytik', N)?.segment === 'finance')
  ok('ukoly/123 → Vzkazy a úkoly (dalsiSegmenty)', polozkaNaCeste('ukoly/123', N)?.segment === 'vzkazy-a-ukoly')
  ok('„financni" není „finance" (shoda jen po lomítko)', polozkaNaCeste('financni', [P('finance')]) === undefined)
  ok('bez cesty → nic', polozkaNaCeste(null, N) === undefined)
  ok('delší z dalsiSegmenty vyhraje nad kratším segmentem',
    polozkaNaCeste('a/b/c', [P('a'), P('x', { dalsiSegmenty: ['a/b'] })])?.segment === 'x')
}

console.log('\n== cilPrepnutiRozsahu: kam vede přepnutí rozsahu ==')

{
  const N = nabidka.NABIDKA
  const najdi = (s) => N.find((p) => p.segment === s)
  ok('jenFirma (Kontakty) → pobočka: první obrazovka Financí, ne hláška',
    cilPrepnutiRozsahu(najdi('finance/kontakty'), 'bernard-bar', 'firma', N) === '/bernard-bar/finance')
  ok('jenFirma (Faktury) → pobočka: totéž',
    cilPrepnutiRozsahu(najdi('finance/faktury'), 'bernard-bar', 'firma', N) === '/bernard-bar/finance')
  ok('jenFirma → firma: zůstává',
    cilPrepnutiRozsahu(najdi('finance/kontakty'), 'firma', 'firma', N) === '/firma/finance/kontakty')
  ok('běžná obrazovka drží segment oběma směry',
    cilPrepnutiRozsahu(najdi('finance/cashflow'), 'bernard-bar', 'firma', N) === '/bernard-bar/finance/cashflow' &&
      cilPrepnutiRozsahu(najdi('finance/cashflow'), 'firma', 'firma', N) === '/firma/finance/cashflow')
  const smeny = [P('dochazka', { jenPobocka: true, modul: 'provoz' }), P('smeny', { modul: 'provoz' })]
  ok('jenPobocka → firma: první obrazovka téhož modulu bez jenPobocka',
    cilPrepnutiRozsahu(smeny[0], 'firma', 'firma', smeny) === '/firma/smeny')
  ok('jenPobocka → jiná pobočka: zůstává',
    cilPrepnutiRozsahu(smeny[0], 'bernard-bar', 'firma', smeny) === '/bernard-bar/dochazka')
  ok('neznámá obrazovka → výchozí obrazovka nového rozsahu (Dnes)',
    cilPrepnutiRozsahu(undefined, 'bernard-bar', 'firma', N) === '/bernard-bar/dnes' &&
      cilPrepnutiRozsahu(undefined, 'firma', 'firma', N) === '/firma/dnes')
  const jenFaktury = [P('finance/faktury', { jenFirma: true, modul: 'finance' })]
  ok('neznámá obrazovka, na pobočce jen obrazovky pro firmu → holý rozsah',
    cilPrepnutiRozsahu(undefined, 'bernard-bar', 'firma', jenFaktury) === '/bernard-bar')
  ok('jenFirma bez náhrady v modulu → holý rozsah, ne cizí modul',
    cilPrepnutiRozsahu(jenFaktury[0], 'bernard-bar', 'firma', [...jenFaktury, P('dnes', { modul: 'provoz' })]) === '/bernard-bar')
  ok('náhrada nesmí být chystaná ani osobní obrazovka',
    cilPrepnutiRozsahu(jenFaktury[0], 'bernard-bar', 'firma', [
      ...jenFaktury,
      P('finance/x', { modul: 'finance', hotovo: false }),
      P('finance/y', { modul: 'finance', adresa: '/y' }),
      P('finance/z', { modul: 'finance' }),
    ]) === '/bernard-bar/finance/z')
}

/* =====================================================================
 * 5. RÁM A HOLÁ ADRESA ROZSAHU SE PTAJÍ NA ROZSAH
 * ===================================================================== */

console.log('\n== Rám (layout.tsx) a holá adresa (page.tsx) skládají nabídku pro rozsah ==')

{
  const layout = zdroj('app/[rozsah]/layout.tsx')
  ok('layout: naFirme podle úrovně rozsahu', /const naFirme = scope\.level === "tenant";/.test(layout))
  ok('layout: kreslená nabídka = polozkyModulu pro úroveň rozsahu',
    /polozkyModulu\(ctx, m\.key, naFirmeNabidka\)/.test(layout) && /const polozky = naProp\(naFirme\);/.test(layout))
  ok('layout: jiné volání polozkyModulu tam není', (layout.match(/polozkyModulu\(/g) ?? []).length === 1)
  // Na pobočce i obrazovky jen pro firmu — JEN k poznání, kde člověk je (nekreslí se).
  ok('layout: k poznání obrazovky na pobočce celá nabídka firmy, na firmě nic navíc',
    /const polozkyKPoznani = naFirme \? undefined : naProp\(true\);/.test(layout) && /polozkyKPoznani=\{polozkyKPoznani\}/.test(layout))
  const shell = zdroj('components/shell/AppShell.tsx')
  ok('AppShell: obrazovku pozná i podle položek jen pro firmu, kreslí jen `polozky`',
    /const vsechny = \[\.\.\.\(polozkyKPoznani \?\? polozky\), \.\.\.nastaveni\];/.test(shell) && /const zde = polozkaNaCeste\(segment, vsechny\);/.test(shell))
  const stranka = zdroj('app/[rozsah]/page.tsx')
  ok('page: naFirme podle úrovně rozsahu', /const naFirme = scope\.level === "tenant";/.test(stranka))
  ok('page: viditelnaNabidka i vychoziObrazovka dostávají naFirme',
    /vychoziObrazovka\(viditelnaNabidka\(ctx, naFirme\), naFirme\)/.test(stranka))
}

/* =====================================================================
 * 6. KAŽDÁ STRÁNKA FINANCÍ: POBOČKOVÁ, NEBO JEN PRO FIRMU
 * ===================================================================== */

console.log('\n== Každá stránka pod app/[rozsah]/finance má jeden ze dvou tvarů ==')

const KOREN_FINANCI = 'app/[rozsah]/finance'

function soubory(adresar, jmeno) {
  const vysledek = []
  for (const polozka of readdirSync(adresar)) {
    const cesta = path.posix.join(adresar, polozka)
    if (statSync(cesta).isDirectory()) vysledek.push(...soubory(cesta, jmeno))
    else if (jmeno.test(polozka)) vysledek.push(cesta)
  }
  return vysledek
}

/** Layout s `JenProFirmu`: na firmě pustí stránku, jinde kreslí jen větu. */
function jeLayoutJenProFirmu(soubor) {
  if (!existsSync(soubor)) return false
  const s = zdroj(soubor)
  return /if \(jeRozsahFirmy\(rozsah\)\) return <>\{children\}<\/>/.test(s) &&
    /<JenProFirmu rozsah=\{rozsah\} nazev="[^"]+" segment="finance\/[^"]+">/.test(s) &&
    (s.match(/\{children\}/g) ?? []).length === 1
}

/** Adresáře mezi stránkou a kořenem Financí (bez kořene — tam je brána modulu). */
function predci(soubor) {
  const vysledek = []
  for (let a = path.posix.dirname(soubor); a !== KOREN_FINANCI && a.startsWith(KOREN_FINANCI); a = path.posix.dirname(a)) {
    vysledek.push(a)
  }
  return vysledek
}

/**
 * Stránka pod layoutem `JenProFirmu` musí pobočku odmítnout PRVNÍM
 * řádkem — dřív než cokoli načte (Next ji vyrenderuje i vedle layoutu,
 * který ji nepoužije). Před tím řádkem nesmí být žádné `await` kromě
 * parametrů.
 */
function odmitaPobockuHned(s) {
  // Mezi parametry a odmítnutím smí stát jen řádkové komentáře (Faktury tam mají důvod).
  const m = s.match(/export default async function \w+\([\s\S]*?\n {2}const \{ rozsah \} = await params\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(!jeRozsahFirmy\(rozsah\)\) return null\n/)
  return Boolean(m) && (m[0].match(/await /g) ?? []).length === 1
}

const fakturyLayout = zdroj(`${KOREN_FINANCI}/faktury/layout.tsx`)
const fakturyBrana = /if \(scope\.level !== 'tenant'\) \{\s*return \(\s*<Sdeleni nadpis="Faktury patří celé firmě">/.test(fakturyLayout)
ok('Faktury: vlastní brána celé firmy ve faktury/layout.tsx', fakturyBrana)

const stranky = soubory(KOREN_FINANCI, /^page\.tsx$/)
ok(`stránek Financí se našlo dost (${stranky.length})`, stranky.length >= 25)

const tvary = { pobockova: 0, jenProFirmu: 0, faktury: 0 }
for (const soubor of stranky) {
  const s = zdroj(soubor)
  const kratce = soubor.slice(KOREN_FINANCI.length + 1)
  const brana = predci(soubor).find((a) => jeLayoutJenProFirmu(`${a}/layout.tsx`))
  if (brana) {
    tvary.jenProFirmu++
    ok(`${kratce}: pod ${brana.slice(KOREN_FINANCI.length + 1)}/layout.tsx (JenProFirmu) a pobočku odmítá prvním řádkem`,
      odmitaPobockuHned(s))
  } else if (soubor.startsWith(`${KOREN_FINANCI}/faktury/`)) {
    tvary.faktury++
    // Brána Faktur je layout — stránku nezastaví (viz výš), proto ještě vlastní odmítnutí.
    ok(`${kratce}: pod bránou Faktur a pobočku odmítá prvním řádkem`, fakturyBrana && odmitaPobockuHned(s))
  } else {
    tvary.pobockova++
    ok(`${kratce}: bere pobočku z rozsahu (pobockaFinanci)`, /pobockaFinanci\(/.test(s))
    // Druhá podmínka pobočky (finance.read za celou firmu) jen přes zkusPristupFinanci —
    // layout stránku nezastaví. Nákup má právo purchasing.* (modul Objednávky), ne finance.
    if (!soubor.startsWith(`${KOREN_FINANCI}/nakup/`)) {
      ok(`${kratce}: vstup přes zkusPristupFinanci, ne holý zkusPristup`,
        /zkusPristupFinanci\(tenantId, 'finance\.(read|manage)', rozsah\)/.test(s) && !/\bzkusPristup\(tenantId, 'finance\./.test(s))
    }
  }
}
ok(`všechny tři tvary se opravdu vyskytly (pobočkové ${tvary.pobockova}, jen pro firmu ${tvary.jenProFirmu}, Faktury ${tvary.faktury})`,
  tvary.pobockova >= 8 && tvary.jenProFirmu >= 9 && tvary.faktury >= 8)

console.log('\n== Layouty obrazovek jen pro firmu ==')

// Důvod se hlídá u tří obrazovek z tohohle zadání; import výpisu má
// vlastní znění (platby/import/layout.tsx) — tam stačí tvar a segment.
for (const [adresar, vec] of [
  ['kontakty', 'Dodavatelé a odběratelé jsou společní pro celou firmu'],
  ['integrace', 'Napojení banky, pokladny a e-mailu se zakládají za celou firmu'],
  ['analytik', 'AI analytik zatím pracuje jen s čísly celé firmy'],
  ['platby/import', null],
]) {
  const soubor = `${KOREN_FINANCI}/${adresar}/layout.tsx`
  ok(`${adresar}/layout.tsx: JenProFirmu se segmentem finance/${adresar}${vec ? ' a důvodem' : ''}`,
    jeLayoutJenProFirmu(soubor) &&
      zdroj(soubor).includes(`segment="finance/${adresar}"`) &&
      (vec === null || zdroj(soubor).replace(/\s+/g, ' ').includes(vec)))
}

/* =====================================================================
 * 7. SERVEROVÉ AKCE OBRAZOVEK JEN PRO FIRMU — PRÁVO ZA CELOU FIRMU
 * ===================================================================== */

console.log('\n== Akce obrazovek jen pro firmu chtějí právo za celou firmu ==')

/** Těla exportovaných funkcí (od `export async function` po další export nebo konec). */
function exportovaneFunkce(s) {
  const zacatky = [...s.matchAll(/export async function (\w+)/g)]
  return zacatky.map((m, i) => ({ jmeno: m[1], telo: s.slice(m.index, zacatky[i + 1]?.index ?? s.length) }))
}

/*
  Pokladna je výjimka s vlastní pojistkou (`overitFiremniPravo`):
  připojení POBOČKY (klíč příjmového API, synchronizace a odpojení
  pobočkového připojení) dál smí správce napojení té pobočky — zápis mu
  databáze pustí jen pro jeho pobočku (RLS integrace_pripojeni_write,
  has_access(…, branch_id)). Firemní připojení jen správce za celou firmu.
*/
const POKLADNA = `${KOREN_FINANCI}/integrace/pokladna/akce.ts`
const adresareJenProFirmu = [...new Set(
  stranky.flatMap((s) => predci(s)).filter((a) => jeLayoutJenProFirmu(`${a}/layout.tsx`)),
)]
const akce = [...new Set(adresareJenProFirmu.flatMap((a) => soubory(a, /^akce[\w-]*\.ts$/)))].sort()
ok(`akce pod obrazovkami jen pro firmu se našly (${akce.length})`, akce.length >= 9 && akce.includes(POKLADNA))

for (const soubor of akce.filter((s) => s !== POKLADNA)) {
  const s = zdroj(soubor)
  const kratce = soubor.slice(KOREN_FINANCI.length + 1)
  const volani = [...s.matchAll(/zkusPristup\(([^)]*)\)/g)].map((m) => m[1].trim())
  const mimo = volani.filter((a) => !/^tenantId, (?:pravo|'[a-z_]+\.[a-z_]+'), TENANT_SCOPE_SEGMENT$/.test(a))
  ok(`${kratce}: každé zkusPristup za celou firmu (${volani.length}×)` + (mimo.length ? ` — ne: ${mimo.join(' | ')}` : ''),
    volani.length > 0 && mimo.length === 0)
  const bezKontroly = exportovaneFunkce(s)
    .filter((f) => !/\b(?:pripravit|pripravitPrijem|zkusPristup)\(/.test(f.telo))
    .map((f) => f.jmeno)
  ok(`${kratce}: každá exportovaná akce prochází kontrolou` + (bezKontroly.length ? ` — bez ní: ${bezKontroly.join(', ')}` : ''),
    exportovaneFunkce(s).length > 0 && bezKontroly.length === 0)
}

{
  const s = zdroj(POKLADNA)
  ok('pokladna: overitFiremniPravo = integrace.manage za celou firmu',
    /async function overitFiremniPravo\(tenantId: string, rozsah: string\): Promise<void> \{\s*if \(!\(await hasAccess\(tenantId, 'integrace\.manage', null\)\)\)/.test(s))
  const funkce = Object.fromEntries(exportovaneFunkce(s).map((f) => [f.jmeno, f.telo]))
  for (const jmeno of ['pripojitPokladnu', 'ulozitPrirazeni', 'zahajitPrihlaseniDotykacka']) {
    ok(`pokladna: ${jmeno} vždy s firemním právem`, /\n {2}await overitFiremniPravo\(tenantId, rozsah\)/.test(funkce[jmeno] ?? ''))
  }
  for (const jmeno of ['synchronizovatPokladnuTed', 'odpojitPokladnu']) {
    ok(`pokladna: ${jmeno} u firemního připojení s firemním právem`,
      /if \(!pripojeni\.branch_id\) await overitFiremniPravo\(tenantId, rozsah\)/.test(funkce[jmeno] ?? ''))
  }
}

{
  const s = zdroj(`${KOREN_FINANCI}/integrace/banka/akce.ts`)
  ok('banka: „Synchronizovat teď" (service_role) jde přes firemní pripravit',
    /export async function synchronizovatTeto[\s\S]*?await pripravit\(rozsah\)[\s\S]*?synchronizovatPodlePoskytovatele\(/.test(s))
}

/* =====================================================================
 * 8. FAKTURY A EXPORTY (základ z c81a78a)
 * ===================================================================== */

console.log('\n== Faktury a exporty: firma, ne rozsah z adresy ==')

{
  const s = zdroj(`${KOREN_FINANCI}/faktury/akce.ts`)
  const telo = s.match(/async function pripravit\([^)]*\)[^{]*\{[\s\S]*?\n\}\n/)?.[0] ?? ''
  ok('faktury/akce.ts: pripravit se našel', telo.includes('getCurrentTenantId()'))
  ok('faktury/akce.ts: pripravit ověřuje právo za celou firmu',
    /const pristup = await zkusPristup\(tenantId, pravo, TENANT_SCOPE_SEGMENT\)/.test(telo))
  ok('  a jinak se v pripravit na právo neptá', (telo.match(/zkusPristup\(/g) ?? []).length === 1)
}
{
  const s = zdroj('app/api/faktury/export/route.ts')
  const volani = [...s.matchAll(/zkusPristup\(([^)]*)\)/g)].map((m) => m[1])
  ok('api/faktury/export: právo za celou firmu',
    volani.length === 1 && volani[0] === "tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT")
  ok('  a rozsah z adresy nečte vůbec', !/searchParams\.get\('rozsah'\)/.test(s))
}
{
  const s = zdroj('app/api/ucetni/export/route.ts')
  ok('api/ucetni/export: pobočka z rozsahu přes pobockaFinanci',
    /const pobocka = pobockaFinanci\(pristup\.scope\)/.test(s))
  ok('  pobočka jen s finance.read za celou firmu, jinak 403',
    /if \(pobocka && !\(await hasAccess\(tenantId, 'finance\.read', null\)\)\) \{\s*return new Response\([^)]*\{ status: 403 \}\)/.test(s))
  ok('  na pobočce jen platby z jejích účtů (!inner + filtr)',
    /platebni_ucty\$\{pobocka \? '!inner' : ''\}\(branch_id\)/.test(s) &&
      /if \(pobocka\) dotazTransakci = dotazTransakci\.eq\('platebni_ucty\.branch_id', pobocka\)/.test(s))
}

/* =====================================================================
 * 9. DNES: FAKTURY JEN NA CELÉ FIRMĚ
 * ===================================================================== */

console.log('\n== Dnes: počty faktur a „Nová faktura" jen na rozsahu celé firmy ==')

{
  const s = zdroj('app/[rozsah]/dnes/page.tsx')
  ok('Dnes: fakturyVRozsahu = rozsah celé firmy', /const fakturyVRozsahu = scope\.level === "tenant";/.test(s))
  ok('Dnes: počty (ke kontrole, po splatnosti) se na pobočce nenačítají',
    /fakturyVRozsahu && canSee\(ctx, "faktury\.read"\)\s*\?\s*\(async \(\) => \{\s*const pristupFaktury = await pristupKFakturam\(tenantId\);/.test(s))
  ok('Dnes: rychlá akce „Nová faktura" jen na firmě',
    /if \(fakturyVRozsahu && canSee\(ctx, "faktury\.manage"\) && \(await pristupKFakturam\(tenantId\)\)\.stav === "ok"\) \{\s*rychleAkce\.push\(\{ popisek: "Nová faktura"/.test(s))
  // Každé sáhnutí do Faktur na Dnes je jedno z těch dvou — třetí (nové)
  // by bez téhle kontroly prošlo i na pobočce.
  ok('Dnes: jinde se do Faktur nesahá', (s.match(/pristupKFakturam\(/g) ?? []).length === 2)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
