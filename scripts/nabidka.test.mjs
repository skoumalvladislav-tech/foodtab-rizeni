#!/usr/bin/env node
/**
 * Nabídka obrazovek — vede každá položka opravdu někam?
 *
 * Pusť:
 *   node scripts/nabidka.test.mjs
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE EXISTUJE
 *
 * `hotovo: true` znamená „adresa vede na vykreslenou stránku". Je to
 * ruční příznak — nikdo ho nekontroluje proti souborům. Stačí položku
 * přidat dřív, než vznikne obrazovka, a v levém sloupci je odkaz na
 * 404. Vypadá to jako rozbitá aplikace, ne jako nedodělek.
 *
 * Opačný směr se nehlídá schválně: obrazovka bez položky v nabídce je
 * běžná (podstránky jako `marketing/novy` nebo `smeny/[den]` tam nemají
 * co dělat).
 *
 * ---------------------------------------------------------------------
 * ČTE SE JAKO TEXT, NE IMPORTEM
 *
 * `nabidka.ts` importuje přes alias `@/lib`, který Node bez sestavení
 * neumí. Čte se proto zdroj — stejně jako v `scripts/marketing.test.mjs`,
 * kde se ověřuje, že obrazovka opravdu volá funkci databáze.
 *
 * ---------------------------------------------------------------------
 * ROZCESTNÍK JE PRYČ, „VÍCE" MUSÍ VÉST VŠUDE (25. 9. 2026)
 *
 * Druhá půlka souboru už text nečte — spouští. Šéfík 24. 9. zrušil
 * rozcestník (`/<rozsah>`), a na telefonu to byla jediná cesta ke všemu,
 * co se nevejde do spodní lišty. Hlídají se tři věci:
 *
 *   1. `/<rozsah>` nic nekreslí a přesměruje na Dnes. Stránka se
 *      spustí se SKUTEČNÝM `lib/authz.ts`, `lib/firma.ts`
 *      a `nabidka.ts`; podstrčená je jen databáze pod nimi
 *      (`scripts/vykreslit.mjs`, `adresaModulu`).
 *   2. „Více" ve spodní liště je vždycky, ťuknutím se otevře, vede ke
 *      všem modulům, Nastavení, vzhledu a odhlášení s dotazem a zase
 *      se zavře. Celý AppShell se spustí a KLIKÁ se do něj
 *      (`scripts/klikat.mjs`); Drawer je skutečný.
 *   3. Na počítači a tabletu, kde spodní lišta není, je „Odhlásit se"
 *      vlevo dole na konci levého sloupce (Šéfík 8. 9.), ikona i slovo,
 *      a vede přes dotaz. V horní liště ne — nabídka pod iniciálami má
 *      jen Moje údaje a vzhled.
 *
 * Pusť `node scripts/nabidka.test.mjs` (Node 24 zvládne `.ts` sám).
 */

import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { jeOtevrena, poKliknuti, poZmeneAdresy, ZAVRENA } from '../lib/stav-nabidky.ts'
import { vychoziObrazovka } from '../lib/vychozi-obrazovka.ts'
import { NAHRADY as KLIKAT, spustit } from './klikat.mjs'
import { adresaModulu, nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const zdroj = readFileSync('app/[rozsah]/nabidka.ts', 'utf8')

/*
  Bere se jen pole NABIDKA, ne nastavení pod ním: nastavení má vlastní
  seznam a vlastní pravidla.
*/
const zacatek = zdroj.indexOf('export const NABIDKA')
const konec = zdroj.indexOf('\n]', zacatek)
const telo = zdroj.slice(zacatek, konec)

const polozky = [...telo.matchAll(/\{\s*segment:\s*'([^']+)'[^}]*\}/g)].map((m) => ({
  segment: m[1],
  radek: m[0],
  hotovo: /hotovo:\s*true/.test(m[0]),
  maAdresu: /adresa:/.test(m[0]),
}))

console.log('\n== Nabídka se vůbec přečetla ==')

ok('našly se položky', polozky.length > 10)
ok('a je mezi nimi Docházka', polozky.some((p) => p.segment === 'dochazka'))
ok('a marketingové obrazovky', polozky.some((p) => p.segment === 'marketing/media'))

console.log('\n== Každá hotová položka vede na stránku ==')

for (const p of polozky) {
  if (!p.hotovo || p.maAdresu) continue
  const cesta = `app/[rozsah]/${p.segment}/page.tsx`
  ok(`${p.segment} → ${cesta}`, existsSync(cesta))
}

console.log('\n== Chystané položky stránku mít nemusí ==')

const chystane = polozky.filter((p) => !p.hotovo)
ok('nějaké chystané v nabídce jsou', chystane.length > 0)
ok('a žádná z nich se netváří jako hotová',
  chystane.every((p) => !/hotovo:\s*true/.test(p.radek)))

console.log('\n== Marketing má v sloupci víc než jednu položku ==')

/*
  Do 14. 9. 2026 měl marketing jedinou položku a fotky, šablony ani menu
  se v levém sloupci neobjevily — daly se najít jen odkazem z přehledu.
  Tahle kontrola hlídá, aby se to nevrátilo.
*/
const marketingove = polozky.filter((p) => p.segment.startsWith('marketing'))
ok('marketing má aspoň jedenáct obrazovek', marketingove.length >= 11)
ok('a je mezi nimi fronta ke schválení',
  polozky.some((p) => p.segment === 'marketing/schvalovani'))
ok('a kalendář obsahu',
  polozky.some((p) => p.segment === 'marketing/kalendar'))
ok('a publikované příspěvky',
  polozky.some((p) => p.segment === 'marketing/publikovane'))
ok('a kampaně',
  polozky.some((p) => p.segment === 'marketing/kampane'))
ok('a analytika',
  polozky.some((p) => p.segment === 'marketing/analytika'))
ok('a průvodce prvním spuštěním',
  polozky.some((p) => p.segment === 'marketing/zacatek'))
ok('a všechny jsou hotové', marketingove.every((p) => p.hotovo))

console.log('\n== Pořadí: nejdřív podrobnější segment ==')

/*
  Rám hledá aktivní položku prvním shodným segmentem
  (`app/[rozsah]/ram.tsx`). Kdyby `marketing` stál před
  `marketing/media`, zvýraznil by se při otevřených Fotkách „Příspěvky".
  Drobnost — ale přesně ta, které si člověk všimne a nepozná proč.
*/
const iPrehled = polozky.findIndex((p) => p.segment === 'marketing')
const iPodstranky = polozky
  .map((p, i) => (p.segment.startsWith('marketing/') ? i : -1))
  .filter((i) => i >= 0)

ok('podstránky marketingu stojí před přehledem',
  iPodstranky.length > 0 && iPodstranky.every((i) => i < iPrehled))

/* =====================================================================
 * ROZCESTNÍK JE PRYČ (25. 9. 2026)
 * ===================================================================== */

console.log('\n== Výchozí obrazovka rozsahu (lib/vychozi-obrazovka.ts) ==')

const P = (segment, dalsi = {}) => ({ segment, hotovo: true, ...dalsi })

ok('Dnes vyhrává, i když není první',
  vychoziObrazovka([P('smeny'), P('dnes')], false) === 'dnes')
ok('bez Dnes první hotová obrazovka',
  vychoziObrazovka([P('receptury', { hotovo: false }), P('smeny')], false) === 'smeny')
ok('na firmě se přeskakuje obrazovka vázaná na pobočku',
  vychoziObrazovka([P('dochazka', { jenPobocka: true }), P('smeny')], true) === 'smeny')
ok('na pobočce ne',
  vychoziObrazovka([P('dochazka', { jenPobocka: true }), P('smeny')], false) === 'dochazka')
ok('osobní obrazovka mimo rozsah výchozí není',
  vychoziObrazovka([P('moje-udaje', { adresa: '/moje-udaje' }), P('smeny')], false) === 'smeny')
ok('nic hotového → null, ne vymyšlená adresa',
  vychoziObrazovka([P('receptury', { hotovo: false })], false) === null)

console.log('\n== Stav výsuvné nabídky (lib/stav-nabidky.ts) ==')

// Sdílí ho „Více" na telefonu a nabídka účtu v horní liště. Že ho
// komponenty opravdu používají, ověřuje klikání níž.
{
  const otevrena = poKliknuti(ZAVRENA, '/cp/dnes')
  ok('zavřená není otevřená nikde', !jeOtevrena(ZAVRENA, '/cp/dnes') && !jeOtevrena(ZAVRENA, ''))
  ok('ťuknutí zavřenou otevře, a to na téhle adrese', jeOtevrena(otevrena, '/cp/dnes'))
  ok('druhé ťuknutí ji zavře', !jeOtevrena(poKliknuti(otevrena, '/cp/dnes'), '/cp/dnes'))
  ok('po přechodu jinam (i tlačítkem Zpět) je zavřená', !jeOtevrena(otevrena, '/cp/smeny'))
  ok('  a ťuknutí tam ji otevře, ne zavře', jeOtevrena(poKliknuti(otevrena, '/cp/smeny'), '/cp/smeny'))
  // Do 25. 9. se otevření z jiné adresy nezapomínalo: Zpět menu zavřelo,
  // Vpřed ho na původní adrese zase otevřelo.
  const poZpet = poZmeneAdresy(otevrena, '/cp/smeny')
  ok('po přechodu se otevření zapomene', poZpet === ZAVRENA)
  ok('  takže po návratu na původní adresu nevyskočí', !jeOtevrena(poZpet, '/cp/dnes'))
  ok('na téže adrese otevřená zůstane', poZmeneAdresy(otevrena, '/cp/dnes') === otevrena)
}

/* --- podstrčená databáze pod skutečným authz ------------------------- */

const PRAZDNY = 'data:text/javascript,'
// Apostrof encodeURIComponent nechá být — a adresa se vkládá mezi
// apostrofy, pokud jimi byl psaný původní import (lib/*.ts).
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')

/*
  Jediné, co se podstrkuje: odpovědi Supabase. `getContext`,
  `resolveScope`, `canSee`, `jeVedeni` i `viditelnaNabidka` jsou
  skutečné — kdyby se do nich zanesla chyba, kterou by „Více" nebo
  přesměrování zdědilo, má ji tahle kontrola vidět taky.
*/
const SERVER = js(`
export async function getServerSupabase() {
  const d = globalThis.__databaze
  return {
    auth: { getUser: async () => ({ data: { user: d.uzivatel }, error: null }) },
    rpc: async (jmeno) => {
      if (jmeno === 'my_tenants') return { data: d.firmy, error: null }
      if (jmeno === 'my_context') return { data: d.kontext, error: null }
      return { data: null, error: { message: 'neznámá funkce ' + jmeno } }
    },
  }
}`)
const AUTHZ = adresaModulu('lib/authz.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/supabase/server', SERVER],
])
const FIRMA = adresaModulu('lib/firma.ts', [
  ['server-only', PRAZDNY],
  ['@/lib/authz', AUTHZ],
])
const NABIDKA = adresaModulu('app/[rozsah]/nabidka.ts', [['@/lib/authz', AUTHZ]])
const authz = await import(AUTHZ)
const nabidka = await import(NABIDKA)

const POBOCKA = { id: 'b1', name: 'Černá perla', slug: 'cerna-perla', color: 'amber' }
const MODULY = [
  { key: 'provoz', label: 'Provoz', isBase: true, active: true },
  { key: 'menu', label: 'Tvorba menu', isBase: false, active: true },
  { key: 'finance', label: 'Finance', isBase: false, active: true },
  { key: 'marketing', label: 'Marketing', isBase: false, active: true },
  // Vypnutý schválně: jeho Nákup se nesmí objevit nikde.
  { key: 'objednavky', label: 'Objednávky', isBase: false, active: false },
]

/*
  Majitel: employees.branch_id NULL, členství na celou firmu. Databáze
  mu dává všechna práva zapnutých modulů (obchází katalog).

  Tady dostane VŠECHNA práva, i Objednávek. Kdyby je neměl, Nákup by
  z menu zmizel už kvůli chybějícímu právu a kontrola „vypnutý modul
  v menu není" by nešla shodit (podmínka zapsaná dvakrát). Stejně to
  vypadá u zařazení, které právo nese, zatímco firma modul vypnula.
*/
const MAJITEL = {
  uzivatel: { id: 'u-majitel', email: 'majitel@example.cz', phone: null },
  firmy: [{ tenant_id: 't1', name: 'Bistro', role_key: '', role_label: '', is_owner: true, scope: 'tenant' }],
  kontext: {
    tenant: { id: 't1', name: 'Bistro', currency: 'CZK', timezone: 'Europe/Prague' },
    membership: { scope: 'tenant', status: 'active' },
    zarazeni: null,
    jeMajitel: true,
    modules: MODULY,
    branches: [POBOCKA],
    permissions: [...authz.PERMISSIONS],
  },
}

/* Číšník: jedna pobočka, pár práv, žádné vedení. */
const CISNIK = {
  uzivatel: { id: 'u-cisnik', email: 'cisnik@example.cz', phone: null },
  firmy: [{ tenant_id: 't1', name: 'Bistro', role_key: 'cisnik', role_label: 'Číšník', is_owner: false, scope: 'branch' }],
  kontext: {
    tenant: { id: 't1', name: 'Bistro', currency: 'CZK', timezone: 'Europe/Prague' },
    membership: { scope: 'branch', status: 'active' },
    zarazeni: { id: 'z1', key: 'cisnik', label: 'Číšník' },
    jeMajitel: false,
    modules: MODULY,
    branches: [POBOCKA],
    permissions: ['shifts.read', 'communication.read'],
  },
}

console.log('\n== /<rozsah> nekreslí rozcestník, přesměruje ==')

const NAVIGACE_STRANKY = js(`
export function redirect(kam) {
  const e = new Error('NEXT_REDIRECT ' + kam)
  e.presmerovani = kam
  throw e
}`)
const Stranka = await nactiKomponentu('app/[rozsah]/page.tsx', [
  ['next/navigation', NAVIGACE_STRANKY],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['./nabidka', NABIDKA],
])

/** Spustí stránku a vrátí { kam, html } — kam = cíl přesměrování, html = co nakreslila. */
async function otevrit(databaze, rozsah) {
  globalThis.__databaze = databaze
  try {
    const vysledek = await Stranka({ params: Promise.resolve({ rozsah }) })
    return { kam: null, html: vysledek ? renderToStaticMarkup(vysledek) : '' }
  } catch (e) {
    if (e?.presmerovani) return { kam: e.presmerovani, html: '' }
    throw e
  }
}

/* Co by na obrazovce prozradilo, že rozcestník přežil. */
const ZNAKY_ROZCESTNIKU = /Rozcestník|Kam dál|Odhlásit se/

for (const [popis, db, rozsah, cil] of [
  ['majitel na /firma → /firma/dnes', MAJITEL, 'firma', '/firma/dnes'],
  ['majitel na pobočce → její Dnes', MAJITEL, 'cerna-perla', '/cerna-perla/dnes'],
  ['číšník na své pobočce → její Dnes', CISNIK, 'cerna-perla', '/cerna-perla/dnes'],
]) {
  const { kam, html } = await otevrit(db, rozsah)
  ok(popis, kam === cil)
  ok('  a nic nenakreslila', html === '')
}

{
  // Číšník na firemní úrovni nemá co dělat — odmítne ho layout, ne stránka.
  const { kam, html } = await otevrit(CISNIK, 'firma')
  ok('číšník na /firma: stránka nepřesměruje (mluví layout)', kam === null)
  ok('  a nekreslí rozcestník', !ZNAKY_ROZCESTNIKU.test(html))
}
{
  // Nepřihlášeného posílá na přihlášení layout, i s adresou; kdyby
  // přesměrovala stránka dřív, cíl by se ztratil.
  const { kam, html } = await otevrit({ ...MAJITEL, uzivatel: null }, 'firma')
  ok('nepřihlášený: stránka nepřesměruje', kam === null)
  ok('  a nic nekreslí', html === '')
}
{
  // Firma bez jediného zapnutého modulu: není kam — věta, ne dlaždice.
  const bezModulu = {
    ...MAJITEL,
    kontext: { ...MAJITEL.kontext, modules: MODULY.map((m) => ({ ...m, active: false })) },
  }
  const { kam, html } = await otevrit(bezModulu, 'firma')
  ok('bez obrazovek: žádné přesměrování do prázdna', kam === null)
  ok('  ale věta, co dělat', html.includes('Zatím tu pro vás nic není'))
  ok('  a žádný rozcestník', !ZNAKY_ROZCESTNIKU.test(html))
}

/* =====================================================================
 * RÁM SE SPOUŠTÍ A KLIKÁ SE DO NĚJ (25. 9. 2026)
 * ===================================================================== */

/*
  Do 25. 9. se rám jen vykreslil do HTML a náhradní Drawer kreslil
  obsah menu i zavřený. Nezávislá kontrola pak v MobileVice rozbila
  otevírání, dotaz na odhlášení i zavírání po změně adresy — a tenhle
  soubor zůstal zelený, protože nikdy neťukl.

  Teď se rám SPOUŠTÍ (scripts/klikat.mjs): najde se tlačítko, zavolá
  se jeho skutečná obsluha a strom se vykreslí znovu. Drawer je
  skutečný, jen jeho portál kreslí na místě. Podstrčené jsou next/link,
  next/navigation (adresa je `globalThis.__cesta`), serverová akce
  odhlášení (počítá, kolikrát se zavolala) a React (klikat.mjs).
*/
const ODKAZ = js(`
import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}
export default function Link({ href, children, ...z }) { return createElement('a', { href, ...z }, children) }`)
const NAVIGACE_RAMU = js('export function usePathname() { return globalThis.__cesta }')
const AKCE_PRIHLASENI = js('export async function odhlasit() { globalThis.__odhlaseni += 1 }')
const NAHRADY_RAMU = [
  ['next/navigation', NAVIGACE_RAMU],
  ['next/link', ODKAZ],
  ['@/app/prihlaseni/akce', AKCE_PRIHLASENI],
  ...KLIKAT,
]
const AppShell = await nactiKomponentu('components/shell/AppShell.tsx', NAHRADY_RAMU)

/**
 * Jedna scéna: spustí rám tak, jak ho skládá app/[rozsah]/layout.tsx,
 * ze skutečné nabídky, pustí kontroly a rám zase ukončí.
 *
 * Výjimka uvnitř (třeba tlačítko, které se po rozbití nevykreslilo,
 * takže není na co kliknout) je spadlá kontrola, ne pád celého
 * souboru — ať jsou vidět i kontroly v ostatních scénách.
 */
async function scena(popis, [databaze, rozsah, cesta, rozsahy = []], kontroly) {
  globalThis.__databaze = databaze
  globalThis.__cesta = cesta
  globalThis.__odhlaseni = 0
  const ctx = await authz.getContext('t1')
  const polozky = ctx.modules.flatMap((m) => nabidka.polozkyModulu(ctx, m.key))
  const nastaveni = nabidka.polozkyNastaveni(ctx)
  const h = spustit(() =>
    createElement(AppShell, {
      rozsah,
      barva: 'amber',
      druh: 'Pobočka',
      nazevRozsahu: 'Černá perla',
      rozsahy,
      aktivniRozsah: rozsah,
      segmentFirmy: 'firma',
      nazevFirmy: 'Bistro',
      iniciraly: 'BI',
      neprectenych: 0,
      posledniUpozorneni: [],
      odznaky: {},
      moduly: [],
      polozky,
      nastaveni,
      cilNastaveni: null,
      nazvyModulu: nabidka.NAZVY_MODULU,
    }, null),
  )
  try {
    await kontroly({ h, polozky, nastaveni })
  } catch (e) {
    ok(`${popis}: scéna doběhla bez výjimky — ${e.message}`, false)
  } finally {
    h.ukoncit()
  }
}

/*
  Spodní lišta: místa pro obrazovky a „Více". Počítají se VŠECHNA
  místa — odkazy i prázdné `<span>` za chystanou obrazovku —, ne jen
  odkazy: kdyby se do lišty vešla pátá obrazovka a byla chystaná,
  odkazů by bylo pořád čtyři.
*/
function lista(h) {
  const nav = h.podleTridy('ft-mob-bottom')
  const vice = nav ? h.tlacitko('Více', nav) : null
  const mista = nav ? h.deti(nav).filter((u) => u !== vice) : []
  return { nav, vice, mista, posledni: nav ? h.deti(nav).at(-1) : null }
}

const dialogy = (h) => h.vsechny((u) => u.props.role === 'dialog')
/** Otevře „Více" a vrátí panel (null, když se neotevřel). */
function otevritVice(h) {
  h.klik(lista(h).vice)
  return h.najdi((u) => u.props.role === 'dialog' && String(u.props.className).includes('ds-drawer'))
}

const adresa = (rozsah, p) => p.adresa ?? `/${rozsah}/${p.segment}`
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Odkaz s přesně touhle adresou (ne jen začínající). */
const maOdkaz = (kus, href) => new RegExp(`<a [^>]*href="${escRe(href)}"`).test(kus)

const OBA_ROZSAHY = [
  { slug: 'firma', nazev: 'Celá firma', barva: 'firma' },
  { slug: 'cerna-perla', nazev: 'Černá perla', barva: 'amber' },
]

console.log('\n== „Více" ve spodní liště: otevře se a vede ke všemu ==')

await scena('majitel, Více', [MAJITEL, 'cerna-perla', '/cerna-perla/dnes', OBA_ROZSAHY], ({ h, polozky, nastaveni }) => {
  const l = lista(h)
  ok('majitel: spodní lišta i „Více" se vykreslily', l.nav !== null && l.vice !== null)
  ok('majitel: v liště čtyři místa pro obrazovky', l.mista.length === 4)
  ok('  a páté je „Více"', l.posledni === l.vice)
  ok('  hlásí, že otevírá panel, a je zavřené',
    l.vice?.props['aria-haspopup'] === 'dialog' && l.vice?.props['aria-expanded'] === false)
  // Jen spodní lišta: „Odhlásit se" je od 25. 9. i vlevo dole ve sloupci.
  ok('  zavřené menu nic nekreslí', dialogy(h).length === 0 && !h.text(l.nav).includes('Odhlásit se'))

  const panel = otevritVice(h)
  ok('ťuknutí na „Více" menu otevře', panel !== null)
  ok('  tlačítko to hlásí (aria-expanded)', lista(h).vice.props['aria-expanded'] === true)
  ok('  je to list zdola s nadpisem „Více"',
    h.najdi((u) => u.props['data-placement'] === 'drawer-bottom') !== null &&
      panel !== null && h.najdi((u) => u.typ === 'h2' && h.text(u) === 'Více', panel) !== null)
  ok('  a fokus je v něm', panel !== null && panel.contains(h.fokus))

  const vice = panel ? h.html(panel) : ''
  const hotove = [...polozky, ...nastaveni].filter((p) => p.hotovo)
  const chybi = hotove.filter((p) => !maOdkaz(vice, adresa('cerna-perla', p)))
  ok(`v menu je odkaz na každou hotovou obrazovku (${hotove.length})` +
     (chybi.length ? ` — chybí ${chybi.map((p) => p.segment).join(', ')}` : ''),
     hotove.length > 20 && chybi.length === 0)
  ok('  mezi nimi každý zapnutý modul',
    ['dnes', 'menu', 'finance/faktury', 'marketing/media'].every((s) => maOdkaz(vice, `/cerna-perla/${s}`)))
  ok('  i Nastavení a Moje údaje',
    maOdkaz(vice, '/cerna-perla/nastaveni/lide') && maOdkaz(vice, '/moje-udaje'))
  ok('  a nadpis skupiny u každého modulu i Nastavení',
    ['Provoz', 'Tvorba menu', 'Finance', 'Marketing', 'Nastavení'].every((n) => vice.includes(`<h3>${n}</h3>`)))
  ok('vypnutý modul (Nákup) v menu není',
    panel !== null && !vice.includes('/cerna-perla/nakup') && !vice.includes('Nákup'))

  const chystane = polozky.filter((p) => !p.hotovo)
  ok('chystané obrazovky vedení vidí, ale bez odkazu',
    chystane.length > 0 &&
      chystane.every((p) => vice.includes(p.nazev) && !maOdkaz(vice, adresa('cerna-perla', p))) &&
      vice.includes('Připravujeme'))

  ok('obrazovka, kde člověk je, je v menu označená',
    /<a [^>]*href="\/cerna-perla\/dnes"[^>]*aria-current="page"/.test(vice))
  ok('Vzhled je v menu, i s přepínačem',
    vice.includes('Vzhled') && /aria-label="Přepnout na (tmavý|světlý) režim"/.test(vice))
  ok('Odhlásit se je v menu', vice.includes('Odhlásit se'))
  ok('  ale jedním ťuknutím neodhlásí (žádný formulář bez dotazu)', panel !== null && !vice.includes('<form'))

  const html = h.html()
  ok('logo vede na Dnes', /<a [^>]*href="\/cerna-perla\/dnes"[^>]*class="ft-brand"/.test(html))
  ok('nikde v rámu odkaz na holou adresu rozsahu',
    !/href="\/(cerna-perla|firma)(\?[^"]*)?"/.test(html))
})

// Přepnutí rozsahu z obrazovky, která v nabídce nemá položku: dřív
// vedlo na rozcestník, teď rovnou na Dnes druhého rozsahu.
await scena('přepnutí z upozornění', [MAJITEL, 'cerna-perla', '/cerna-perla/upozorneni', OBA_ROZSAHY], ({ h }) => {
  ok('přepnutí na firmu z upozornění vede na /firma/dnes',
    maOdkaz(h.html(), '/firma/dnes') && !/href="\/firma"/.test(h.html()))
})
// Docházka se od #78 (záložky Výdělky, Zálohy) na pobočku neváže —
// majitel na firmě zůstane v Docházce.
await scena('přepnutí z Docházky', [MAJITEL, 'cerna-perla', '/cerna-perla/dochazka', OBA_ROZSAHY], ({ h }) => {
  ok('přepnutí na firmu z Docházky vede na /firma/dochazka',
    /<a [^>]*href="\/firma\/dochazka"[^>]*data-branch="firma"/.test(h.html()))
})

console.log('\n== „Více" se zase zavře ==')

await scena('zavírání Více', [MAJITEL, 'cerna-perla', '/cerna-perla/dnes'], ({ h }) => {
  const zavrene = () => dialogy(h).length === 0 && lista(h).vice.props['aria-expanded'] === false

  otevritVice(h)
  h.klavesa('Escape')
  ok('Escape menu zavře', zavrene())
  ok('  a fokus se vrátí na „Více"', h.fokus === lista(h).vice)

  otevritVice(h)
  h.klik(h.tlacitko('Zavřít'))
  ok('křížek menu zavře', zavrene())

  otevritVice(h)
  h.klik(h.podleTridy('ds-overlay'))
  ok('ťuknutí vedle menu zavře', zavrene())

  // Odkaz na obrazovku, kde člověk už je: adresa se nezmění, menu se
  // stejně musí zavřít — jinak by ťuknutí vypadalo, že nic neudělalo.
  let panel = otevritVice(h)
  h.klik(h.najdi((u) => u.typ === 'a' && u.props.href === '/cerna-perla/dnes', panel))
  ok('odkaz v menu ho zavře, i na obrazovku, kde člověk je', zavrene())

  otevritVice(h)
  globalThis.__cesta = '/cerna-perla/smeny'
  h.prekreslit()
  ok('změna adresy (i tlačítkem Zpět) menu zavře', zavrene())
  globalThis.__cesta = '/cerna-perla/dnes'
  h.prekreslit()
  ok('  a po návratu na původní adresu se samo neotevře', zavrene())

  panel = otevritVice(h)
  ok('po tom všem jde zase otevřít', panel !== null)
  h.klavesa('Escape')
  ok('zavřené menu po sobě nenechá posluchače na document', zavrene() && h.dokument.pocetPosluchacu() === 0)
})

console.log('\n== Odhlášení ve „Více" se ptá ==')

await scena('odhlášení ve Více', [MAJITEL, 'cerna-perla', '/cerna-perla/dnes'], ({ h }) => {
  let panel = otevritVice(h)
  const tlOdhlasit = () => h.tlacitko('Odhlásit se', panel)

  ok('nejdřív jen tlačítko „Odhlásit se", bez formuláře',
    panel !== null && tlOdhlasit() !== null && !h.html(panel).includes('<form'))

  h.klik(tlOdhlasit())
  ok('ťuknutí ukáže dotaz s formulářem a „Zpět"',
    h.text(panel).includes('Odhlásit se?') && h.html(panel).includes('<form') && h.tlacitko('Zpět', panel) !== null)
  ok('  a ještě neodhlásí', globalThis.__odhlaseni === 0)
  ok('  fokus přistane na „Zpět"', h.fokus !== null && h.fokus === h.tlacitko('Zpět', panel))

  h.klik(h.tlacitko('Zpět', panel))
  ok('„Zpět" vrátí tlačítko a fokus na něj', tlOdhlasit() !== null && h.fokus === tlOdhlasit())
  ok('  a pořád nikdo odhlášený není', globalThis.__odhlaseni === 0)

  h.klik(tlOdhlasit())
  h.klik(h.tlacitko('Odhlásit', panel))
  ok('„Odhlásit" v dotazu zavolá serverovou akci — jednou', globalThis.__odhlaseni === 1)

  // Zavřené a znovu otevřené menu začíná od začátku, ne dotazem.
  h.klavesa('Escape')
  panel = otevritVice(h)
  ok('po zavření a otevření zase jen „Odhlásit se"',
    tlOdhlasit() !== null && !h.text(panel).includes('Odhlásit se?'))
})

console.log('\n== Odhlásit se vlevo dole (počítač a tablet) ==')

/*
  Šéfík 8. 9.: „ikonu odhlásit dát na základní obrazovku třeba vlevo
  dolů, teď je schovaná" — ikona a slovo, oddělené čarou, s dotazem
  (docs/zarazeni-misto-roli.md, 6.6). A 7. 9.: „Do horní lišty ne."

  Rozcestník, kde to bylo, je od 25. 9. pryč a „Více" je jen na
  telefonu. Nad 640 px je to proto konec levého sloupce (ModuleSidebar).
  Klikalo se tu chvíli do nabídky pod iniciálami vpravo nahoře — to
  bylo proti oběma větám, a proto se hlídá i to, že v horní liště není.
*/

/** Konec levého sloupce: pata a v ní „Odhlásit se" (null, když tam nejsou). */
function vlevoDole(h) {
  const sloupec = h.podleTridy('ft-side')
  const posledni = sloupec ? h.deti(sloupec).at(-1) : null
  const pata = posledni && String(posledni.props.className).split(/\s+/).includes('ft-side-pata') ? posledni : null
  return { pata, tl: pata ? h.tlacitko('Odhlásit se', pata) : null }
}
const ptaSeVlevo = (h) => {
  const { pata } = vlevoDole(h)
  return pata !== null && h.text(pata).includes('Odhlásit se?')
}

await scena('odhlášení vlevo dole', [MAJITEL, 'cerna-perla', '/cerna-perla/dnes'], ({ h }) => {
  const { pata, tl } = vlevoDole(h)
  ok('poslední věc v levém sloupci je pata s „Odhlásit se"', pata !== null && tl !== null)
  const stitek = tl ? h.podleTridy('stitek', tl) : null
  ok('  ikona i slovo',
    tl !== null && h.najdi((u) => u.typ === 'svg', tl) !== null && stitek !== null && h.text(stitek) === 'Odhlásit se')
  ok('  a jméno i v ikonovém sloupci na tabletu (aria-label a title)',
    tl?.props['aria-label'] === 'Odhlásit se' && tl?.props.title === 'Odhlásit se')
  ok('  jedním ťuknutím neodhlásí (bez dotazu žádný formulář)', pata !== null && !h.html(pata).includes('<form'))

  const lista = h.najdi((u) => u.typ === 'header')
  ok('v horní liště odhlášení není (ani slovo, ani tlačítko)',
    lista !== null && !/odhl[aá]s/i.test(h.text(lista)) &&
      h.vsechny((u) => u.typ === 'button' && /odhl[aá]s/i.test(`${u.props['aria-label']} ${u.props.title}`), lista).length === 0)

  h.klik(tl)
  let p = vlevoDole(h).pata
  const zpet = () => h.tlacitko('Zpět', vlevoDole(h).pata)
  ok('ťuknutí ukáže dotaz „Odhlásit se?" s formulářem, „Odhlásit" a „Zpět"',
    ptaSeVlevo(h) && h.html(p).includes('<form') && h.tlacitko('Odhlásit', p) !== null && zpet() !== null)
  ok('  a ještě neodhlásí', globalThis.__odhlaseni === 0)
  ok('  fokus přistane na „Zpět"', h.fokus !== null && h.fokus === zpet())
  const skupina = h.najdi((u) => u.props.role === 'group', p)
  const otazka = skupina ? h.najdi((u) => u.props.id === skupina.props['aria-labelledby']) : null
  ok('  otázka je jménem skupiny s tlačítky (odečítač ji přečte se „Zpět")',
    otazka !== null && h.text(otazka) === 'Odhlásit se?' && skupina.contains(zpet()) &&
      skupina.contains(h.tlacitko('Odhlásit', p)))

  h.klik(zpet())
  ok('„Zpět" vrátí tlačítko a fokus na něj', !ptaSeVlevo(h) && h.fokus === vlevoDole(h).tl)

  h.klik(vlevoDole(h).tl)
  h.klavesa('Escape')
  ok('Escape dotaz zavře a fokus vrátí na „Odhlásit se"', !ptaSeVlevo(h) && h.fokus === vlevoDole(h).tl)

  h.klik(vlevoDole(h).tl)
  h.klik(h.najdi((u) => u.typ === 'main'))
  ok('klik mimo dotaz zavře', !ptaSeVlevo(h))
  ok('  a fokus na „Odhlásit se" nevrací', h.fokus !== vlevoDole(h).tl)

  // Tab ven: fokus odejde na odkaz mimo sloupec — tady na logo.
  h.klik(vlevoDole(h).tl)
  h.zamerit(h.podleTridy('ft-brand'))
  ok('Tab ven z dotazu ho zavře', !ptaSeVlevo(h))
  ok('  a fokus nechá, kam šel', h.fokus === h.podleTridy('ft-brand'))

  // Fokus odejde „nikam" (jiné okno, adresní řádek) a dotaz zůstane;
  // Escape pak fokus do sloupce vracet nemá — člověk je jinde.
  h.klik(vlevoDole(h).tl)
  h.fokus.blur()
  h.prekreslit()
  h.klavesa('Escape')
  ok('Escape, když fokus v dotazu není, ho na „Odhlásit se" nepřehodí', h.fokus === null)
  h.klik(h.najdi((u) => u.typ === 'main'))

  h.klik(vlevoDole(h).tl)
  p = vlevoDole(h).pata
  h.klik(h.tlacitko('Odhlásit', p))
  ok('„Odhlásit" v dotazu zavolá serverovou akci — jednou', globalThis.__odhlaseni === 1)

  h.klik(zpet())
  ok('bez dotazu po sobě nenechá posluchače na document', !ptaSeVlevo(h) && h.dokument.pocetPosluchacu() === 0)
})

// Každý, na každé obrazovce: číšník, obrazovka bez položky v nabídce
// (upozornění), firemní úroveň majitele (branch_id NULL, scope tenant),
// Nastavení i firma, která nemá zapnutý žádný modul (holá /firma s větou
// „Zatím tu pro vás nic není" — rám se kreslí i tam).
const BEZ_MODULU = {
  ...MAJITEL,
  kontext: { ...MAJITEL.kontext, modules: MODULY.map((m) => ({ ...m, active: false })) },
}
for (const [popis, db, rozsah, cesta] of [
  ['číšník na Docházce', CISNIK, 'cerna-perla', '/cerna-perla/dochazka'],
  ['majitel na upozorněních', MAJITEL, 'cerna-perla', '/cerna-perla/upozorneni'],
  ['majitel na /firma', MAJITEL, 'firma', '/firma/dnes'],
  ['majitel v Nastavení', MAJITEL, 'firma', '/firma/nastaveni/lide'],
  ['firma bez zapnutých modulů', BEZ_MODULU, 'firma', '/firma'],
]) {
  await scena(popis, [db, rozsah, cesta], ({ h }) => {
    const { tl } = vlevoDole(h)
    h.klik(tl)
    ok(`${popis}: vlevo dole „Odhlásit se" a vede přes dotaz`,
      tl !== null && ptaSeVlevo(h) && globalThis.__odhlaseni === 0)
  })
}

console.log('\n== Sloupce Marketingu a Faktur (počítač) ==')

/*
  Marketing a Faktury mají na počítači vlastní levý sloupec místo
  sloupce aplikace (globals.css: `.ft-shell:has(.modul-ram) … .ft-side`
  schová). Vlevo dole tam musí být totéž — kreslí se jejich skutečná
  navigace.
*/
for (const [popis, soubor, vlastnosti] of [
  ['Marketing', 'app/[rozsah]/marketing/navigace.tsx', { hlavni: [], nastaveni: [], spodni: [] }],
  ['Faktury', 'app/[rozsah]/finance/faktury/navigace.tsx', { hlavni: [], mobil: [] }],
]) {
  const Navigace = await nactiKomponentu(soubor, NAHRADY_RAMU)
  globalThis.__cesta = '/cerna-perla/marketing'
  globalThis.__odhlaseni = 0
  const h = spustit(() => createElement(Navigace, vlastnosti, 'obsah'))
  try {
    const sloupec = h.podleTridy('modul-sloupec')
    const pata = sloupec ? h.deti(sloupec).at(-1) : null
    const tl = pata ? h.tlacitko('Odhlásit se', pata) : null
    ok(`${popis}: na konci sloupce pata s „Odhlásit se"`,
      tl !== null && String(pata.props.className).includes('ft-side-pata'))
    ok('  mimo navigační oblast (nav je jen pro odkazy)',
      tl !== null && h.vsechny((u) => u.typ === 'nav' && u.contains(tl)).length === 0)
    h.klik(tl)
    ok('  a vede přes dotaz', h.text(pata).includes('Odhlásit se?') && globalThis.__odhlaseni === 0)
  } catch (e) {
    ok(`${popis}: sloupec se vykreslil bez výjimky — ${e.message}`, false)
  } finally {
    h.ukoncit()
  }
}

{
  /*
    CSS: „Odhlásit se" vlevo dole nesmí nad 640 px zmizet — je to tam
    jediná cesta ven kromě konce Mých údajů. Každé pravidlo, které
    schová (display: none i visibility: hidden) sloupec, jeho patu nebo
    tlačítko, musí stát v @media (max-width: 640px), kde je totéž ve
    „Více". Výjimka je sloupec schovaný v Marketingu a Fakturách: tam
    ho nahrazuje jejich vlastní, s patou taky (kontrola výš).

    Slovo „Odhlásit se" smí CSS schovat jen v ikonovém sloupci
    na tabletu (do 1023 px); na počítači musí být vidět.
  */
  const pravidla = [
    ...pravidlaSchovani(readFileSync('app/globals.css', 'utf8')),
    ...pravidlaSchovani(readFileSync('app/_komponenty.css', 'utf8')),
  ]
  const CIL = /\.(ft-side|ft-side-pata|ds-odhlaseni|ds-odhlaseni-sloupec|ds-odhlaseni-tl)(?![\w-])/
  const schovaTlacitko = pravidla.filter((r) => r.casti.some((c) => CIL.test(posledniCast(c)) && !c.includes(':has(.modul-ram)')))
  ok('CSS: sloupec ani odhlášení vlevo dole neschovává nic kromě telefonu',
    schovaTlacitko.length > 0 && schovaTlacitko.every((r) => /max-width:\s*640px/.test(r.media)))
  const schovaSlovo = pravidla.filter((r) =>
    r.casti.some((c) => /\.(ft-side-pata|ds-odhlaseni[\w-]*)\b/.test(c) && /\.stitek$/.test(posledniCast(c))))
  ok('CSS: slovo „Odhlásit se" schovává jen tablet (ikonový sloupec)',
    schovaSlovo.length > 0 && schovaSlovo.every((r) => /max-width:\s*1023px/.test(r.media)))

  const pata = readFileSync('app/globals.css', 'utf8').match(/\.ft-side-pata\s*\{([^}]*)\}/)?.[1] ?? ''
  ok('CSS: pata je připnutá dole (sticky, bottom: 0, margin-top: auto)',
    /position:\s*sticky/.test(pata) && /bottom:\s*0/.test(pata) && /margin-top:\s*auto/.test(pata))

  // Pod řádkou modulů (vedení, do 1360 px) se sloupec lepí až pod ni
  // a je o ni nižší. Dřív o ni přečníval spodní hranu okna: na 1280 × 800
  // byla z „Odhlásit se" vidět jen čára. Vidět je to na snímku; tady se
  // hlídá, že pravidlo nezmizí.
  const g = readFileSync('app/globals.css', 'utf8')
  ok('CSS: pod řádkou modulů je sloupec o její výšku nižší (i sloupec Marketingu)',
    /\.ft-mob-mods\s*\{[^}]*height:\s*var\(--radka-modulu\)/.test(g) &&
      /\.ft-shell:has\(> \.ft-mob-mods\) \.ft-side,\s*\.ft-shell:has\(> \.ft-mob-mods\) \.modul-sloupec\s*\{[^}]*height:\s*calc\(100dvh - var\(--vysoka-lista\) - var\(--radka-modulu\)\)/.test(g))
}

console.log('\n== Nabídka pod iniciálami: Moje údaje a vzhled, odhlášení ne ==')

/*
  Iniciály vpravo nahoře jsou tlačítko „Můj účet" s Mými údaji
  (na tabletu je ve sloupci jen ikona, stejná jako u Lidí a Zařazení)
  a vzhledem. Odhlášení tu 25. 9. chvíli bylo — proti rozhodnutí
  Šéfíka, viz výš.
*/
await scena('nabídka účtu', [MAJITEL, 'cerna-perla', '/cerna-perla/dnes'], ({ h }) => {
  const tl = () => h.tlacitko('Můj účet')
  const panelUctu = () => h.podleTridy('ft-ucet-panel')
  const zavrena = () => panelUctu() === null && tl().props['aria-expanded'] === false

  ok('iniciály jsou tlačítko „Můj účet"', tl() !== null && h.text(tl()) === 'BI')
  ok('  hlásí, že otevírá panel, a je zavřené', tl()?.props['aria-haspopup'] === 'dialog' && zavrena())

  h.klik(tl())
  const p = panelUctu()
  ok('klik na iniciály nabídku otevře', p !== null && tl().props['aria-expanded'] === true)
  ok('  panel je dialog s nadpisem a tlačítko na něj ukazuje',
    p?.props.role === 'dialog' && tl().props['aria-controls'] === p?.props.id &&
      h.najdi((u) => u.props.id === p?.props['aria-labelledby'] && h.text(u) === 'Můj účet') !== null)
  ok('  fokus je v něm', p !== null && p.contains(h.fokus))
  ok('  Moje údaje a Vzhled s přepínačem',
    p !== null && maOdkaz(h.html(p), '/moje-udaje') && h.text(p).includes('Vzhled') &&
      /aria-label="Přepnout na (tmavý|světlý) režim"/.test(h.html(p)))
  ok('  a odhlášení v ní NENÍ', p !== null && !/odhl[aá]s/i.test(h.html(p)) && !h.html(p).includes('<form'))

  h.klavesa('Escape')
  ok('Escape nabídku zavře', zavrena())
  ok('  a vrátí fokus na iniciály', h.fokus === tl())

  h.klik(tl())
  h.klik(tl())
  ok('druhý klik na iniciály ji zavře', zavrena())

  h.klik(tl())
  h.klik(h.najdi((u) => u.typ === 'main'))
  ok('klik mimo ji zavře', zavrena())
  ok('  a fokus nechá, kam člověk klikl (ne na iniciálách)', h.fokus !== tl())

  // Tab ven z panelu: fokus na odkaz mimo nabídku (tady logo).
  h.klik(tl())
  h.zamerit(h.podleTridy('ft-brand'))
  ok('Tab ven ji zavře', zavrena())
  ok('  a fokus zůstane, kam šel', h.fokus === h.podleTridy('ft-brand'))

  // Fokus odejde „nikam" (jiné okno) a nabídka zůstane otevřená; Escape
  // zmáčknutý pak jinde fokus na iniciály přehazovat nemá.
  h.klik(tl())
  h.fokus.blur()
  h.prekreslit()
  h.klavesa('Escape')
  ok('Escape, když fokus v nabídce není, ho na iniciály nepřehodí', h.fokus === null)
  h.klik(h.najdi((u) => u.typ === 'main'))
  ok('  (klik mimo ji pak zavře)', zavrena())

  // Tab uvnitř nabídku nechá otevřenou.
  h.klik(tl())
  h.zamerit(h.najdi((u) => u.typ === 'a' && u.props.href === '/moje-udaje', panelUctu()))
  ok('Tab na Moje údaje ji nechá otevřenou', panelUctu() !== null)
  h.klik(h.najdi((u) => u.typ === 'a' && u.props.href === '/moje-udaje', panelUctu()))
  ok('klik na Moje údaje ji zavře', zavrena())

  h.klik(tl())
  globalThis.__cesta = '/cerna-perla/smeny'
  h.prekreslit()
  ok('změna adresy ji zavře', zavrena())
  globalThis.__cesta = '/cerna-perla/dnes'
  h.prekreslit()
  ok('  a po návratu na původní adresu se sama neotevře', zavrena())

  ok('zavřená po sobě nenechá posluchače na document', h.dokument.pocetPosluchacu() === 0)
})

{
  /*
    Nabídka pod iniciálami se nad 640 px nesmí ztratit — na tabletu je
    to jediné místo, kde mají Moje údaje slovo. Schovat se smí jen na
    telefonu (tam je totéž ve „Více"): obal i tlačítko, display: none
    i visibility: hidden.
  */
  const schovani = [
    ...pravidlaSchovani(readFileSync('app/globals.css', 'utf8')),
    ...pravidlaSchovani(readFileSync('app/_komponenty.css', 'utf8')),
  ].filter((r) => r.casti.some((c) => /\.ft-ucet(?:-tl)?(?![\w-])/.test(posledniCast(c))))
  ok('CSS: nabídku účtu schovává jen telefon',
    schovani.length > 0 && schovani.every((r) => /max-width:\s*640px/.test(r.media)))
}

console.log('\n== Spodní lišta podle toho, kolik kdo má obrazovek ==')

await scena('majitel v Nastavení', [MAJITEL, 'firma', '/firma/nastaveni/lide'], ({ h }) => {
  const l = lista(h)
  ok('majitel na /firma v Nastavení: lišta nese Nastavení, čtyři místa + Více',
    l.mista.length === 4 && maOdkaz(h.html(l.nav), '/firma/nastaveni/firma') && l.posledni === l.vice)
  const panel = otevritVice(h)
  ok('  a z menu se dá odejít do modulů',
    panel !== null && maOdkaz(h.html(panel), '/firma/dnes') && maOdkaz(h.html(panel), '/firma/marketing/media'))
  ok('  logo vede na /firma/dnes', /<a [^>]*href="\/firma\/dnes"[^>]*class="ft-brand"/.test(h.html()))
})

await scena('číšník', [CISNIK, 'cerna-perla', '/cerna-perla/dochazka'], ({ h }) => {
  const l = lista(h)
  ok('číšník: v liště jeho čtyři obrazovky', l.mista.length === 4 && l.mista.every((u) => u.typ === 'a'))
  // Tohle je chyba, kterou by zrušení rozcestníku přineslo: do 25. 9.
  // se „Více" kreslilo jen při šesti a víc obrazovkách.
  ok('  a „Více" i tak', l.posledni === l.vice && l.vice !== null)
  const panel = otevritVice(h)
  const vice = panel ? h.html(panel) : ''
  ok('  v menu Moje údaje, Vzhled i Odhlásit se',
    maOdkaz(vice, '/moje-udaje') && vice.includes('Vzhled') && vice.includes('Odhlásit se'))
  // Číšník nemá marketing.read, faktury.read ani menu_ai.use, a moduly
  // přitom firma zapnuté má — menu je musí vynechat kvůli právu.
  ok('  ale nic z modulů, na které nemá právo (Marketing, Finance, Tvorba menu)',
    panel !== null &&
      !/href="\/cerna-perla\/(marketing|finance|menu)/.test(vice) &&
      !['Marketing', 'Finance', 'Tvorba menu'].some((n) => vice.includes(`<h3>${n}</h3>`)))
  ok('  ani nastavení firmy', panel !== null && !vice.includes('/cerna-perla/nastaveni/'))
  ok('  ani chystané obrazovky', panel !== null && !vice.includes('Připravujeme'))
})

// Méně obrazovek, než je míst: nic se neschová, „Více" zůstává.
await scena('tři obrazovky', [
  { ...CISNIK, kontext: { ...CISNIK.kontext, permissions: ['communication.read'] } },
  'cerna-perla',
  '/cerna-perla/dnes',
], ({ h }) => {
  const l = lista(h)
  ok('tři obrazovky: všechny tři v liště a „Více" vedle',
    l.mista.length === 3 && l.posledni === l.vice && l.vice !== null)
})

/*
  Víc obrazovek, než je míst: do 25. 9. se při pěti kreslily všechny
  a „Více" chybělo. Vedoucí s právem na lidi (je vedení, vidí proto
  i chystané) a na receptury a lístky má v Provozu šest obrazovek:
  Dnes, Směny, Docházka, Vzkazy a úkoly, Receptury, Jídelní lístky.
  Do lišty se vejdou první čtyři, zbytek je v menu.
*/
const VEDOUCI = {
  ...CISNIK,
  kontext: {
    ...CISNIK.kontext,
    permissions: ['shifts.read', 'communication.read', 'people.manage', 'recipes.read', 'menus.read'],
  },
}
await scena('vedoucí', [VEDOUCI, 'cerna-perla', '/cerna-perla/dnes'], ({ h, polozky }) => {
  const provoz = polozky.filter((p) => p.modul === 'provoz')
  ok('vedoucí má v Provozu opravdu víc než pět obrazovek', provoz.length >= 6)
  const l = lista(h)
  ok('víc obrazovek: v liště čtyři místa + „Více"', l.mista.length === 4 && l.posledni === l.vice)
  const panel = otevritVice(h)
  const vice = panel ? h.html(panel) : ''
  ok('  a ty navíc jsou v menu (Receptury, Jídelní lístky)',
    ['Receptury', 'Jídelní lístky'].every((n) => vice.includes(n)))
})

/**
 * Pravidla CSS, která prvek schovají (`display: none` nebo
 * `visibility: hidden`), s částmi selektoru a @media, ve kterých
 * stojí. Stačí na soubory appky: bez vnořování, složené závorky jen jako
 * bloky.
 */
function pravidlaSchovani(css) {
  const vysledek = []
  const otevrene = []
  let kus = ''
  for (const znak of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (znak === '{') {
      otevrene.push(kus.trim())
      kus = ''
    } else if (znak === '}') {
      const hlavicka = otevrene.pop() ?? ''
      if (!hlavicka.startsWith('@') && /display\s*:\s*none|visibility\s*:\s*hidden/.test(kus)) {
        vysledek.push({
          selektor: hlavicka,
          casti: hlavicka.split(',').map((c) => c.trim()),
          media: otevrene.filter((o) => o.startsWith('@')).join(' '),
        })
      }
      kus = ''
    } else {
      kus += znak
    }
  }
  return vysledek
}

/** Poslední složka selektoru — prvek, který pravidlo opravdu zasáhne. */
function posledniCast(selektor) {
  return selektor.replace(/\([^)]*\)/g, '()').trim().split(/\s*[\s>+~]\s*/).filter(Boolean).at(-1) ?? ''
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
