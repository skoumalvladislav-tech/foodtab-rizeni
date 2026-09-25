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
 * co se nevejde do spodní lišty. Hlídají se dvě věci:
 *
 *   1. `/<rozsah>` nic nekreslí a přesměruje na Dnes. Stránka se
 *      spustí se SKUTEČNÝM `lib/authz.ts`, `lib/firma.ts`
 *      a `nabidka.ts`; podstrčená je jen databáze pod nimi
 *      (`scripts/vykreslit.mjs`, `adresaModulu`).
 *   2. „Více" ve spodní liště je vždycky a vede ke všem modulům,
 *      Nastavení, vzhledu a odhlášení. Vykreslí se celý AppShell;
 *      podstrčený je jen `Drawer` — ten kreslí přes portál, který
 *      server neumí, takže se tu obsah kreslí rovnou na místě.
 *
 * Pusť `node scripts/nabidka.test.mjs` (Node 24 zvládne `.ts` sám).
 */

import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { vychoziObrazovka } from '../lib/vychozi-obrazovka.ts'
import { adresaModulu, nactiKomponentu, nactiModul } from './vykreslit.mjs'

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

console.log('\n== „Více" ve spodní liště vede ke všemu ==')

/*
  Drawer kreslí přes portál do document.body a na serveru nevykreslí
  nic. Tady kreslí obsah rovnou na místě mezi dvě značky, aby šel
  vyříznout; jeho vlastnosti se zapíšou do atributů.
*/
const DRAWER = js(`
import { createElement, Fragment } from ${JSON.stringify(import.meta.resolve('react'))}
export default function Drawer({ otevreno, nadpis, umisteni, children }) {
  return createElement(Fragment, null,
    '⟦VICE nadpis=' + nadpis + ' umisteni=' + umisteni + ' otevreno=' + otevreno + '⟧',
    children, '⟦/VICE⟧')
}`)
const ODKAZ = js(`
import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}
export default function Link({ href, children, ...z }) { return createElement('a', { href, ...z }, children) }`)
const NAVIGACE_RAMU = js('export function usePathname() { return globalThis.__cesta }')
const AKCE_PRIHLASENI = js('export async function odhlasit() {}')
const NAHRADY_RAMU = [
  ['next/navigation', NAVIGACE_RAMU],
  ['next/link', ODKAZ],
  ['react-dom', import.meta.resolve('react-dom')],
  ['@/app/prihlaseni/akce', AKCE_PRIHLASENI],
  ['@/components/ui/Drawer', DRAWER],
]
const AppShell = await nactiKomponentu('components/shell/AppShell.tsx', NAHRADY_RAMU)
const { Odhlaseni } = await nactiModul('components/shell/MobileVice.tsx', NAHRADY_RAMU)

/** Props rámu tak, jak je skládá app/[rozsah]/layout.tsx, ze skutečné nabídky. */
async function ram(databaze, rozsah, cesta, rozsahy = []) {
  globalThis.__databaze = databaze
  globalThis.__cesta = cesta
  const ctx = await authz.getContext('t1')
  const polozky = ctx.modules.flatMap((m) => nabidka.polozkyModulu(ctx, m.key))
  const nastaveni = nabidka.polozkyNastaveni(ctx)
  const html = renderToStaticMarkup(
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
  const zacLista = html.indexOf('class="ft-mob-bottom"')
  const zacVice = html.indexOf('⟦VICE')
  const konVice = html.indexOf('⟦/VICE⟧')
  return {
    html,
    polozky,
    nastaveni,
    // Vyříznutí musí uspět — prázdný kus by prošel každou kontrolou „nic tam není".
    vyrizlo: zacLista >= 0 && zacVice > zacLista && konVice > zacVice,
    lista: html.slice(zacLista, zacVice),
    hlavickaVice: html.slice(zacVice, html.indexOf('⟧', zacVice) + 1),
    vice: html.slice(zacVice, konVice),
  }
}

const adresa = (rozsah, p) => p.adresa ?? `/${rozsah}/${p.segment}`
const odkazu = (kus) => (kus.match(/<a /g) ?? []).length
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Odkaz s přesně touhle adresou (ne jen začínající). */
const maOdkaz = (kus, href) => new RegExp(`<a [^>]*href="${escRe(href)}"`).test(kus)

const OBA_ROZSAHY = [
  { slug: 'firma', nazev: 'Celá firma', barva: 'firma' },
  { slug: 'cerna-perla', nazev: 'Černá perla', barva: 'amber' },
]

{
  const r = await ram(MAJITEL, 'cerna-perla', '/cerna-perla/dnes', OBA_ROZSAHY)
  ok('majitel: lištu i menu se podařilo vyříznout', r.vyrizlo)
  ok('majitel: v liště nejvýš čtyři obrazovky', odkazu(r.lista) === 4)
  ok('  a pátý je „Více"', /<button[^>]*aria-expanded="false"[^>]*>[\s\S]*Více/.test(r.lista))
  ok('  menu je list zdola s nadpisem „Více"', r.hlavickaVice.includes('nadpis=Více umisteni=bottom'))
  ok('  a samo od sebe zavřené', r.hlavickaVice.includes('otevreno=false'))

  const hotove = [...r.polozky, ...r.nastaveni].filter((p) => p.hotovo)
  const chybi = hotove.filter((p) => !maOdkaz(r.vice, adresa('cerna-perla', p)))
  ok(`v menu je odkaz na každou hotovou obrazovku (${hotove.length})` +
     (chybi.length ? ` — chybí ${chybi.map((p) => p.segment).join(', ')}` : ''),
     hotove.length > 20 && chybi.length === 0)
  ok('  mezi nimi každý zapnutý modul',
    ['dnes', 'menu', 'finance/faktury', 'marketing/media'].every((s) => maOdkaz(r.vice, `/cerna-perla/${s}`)))
  ok('  i Nastavení a Moje údaje',
    maOdkaz(r.vice, '/cerna-perla/nastaveni/lide') && maOdkaz(r.vice, '/moje-udaje'))
  ok('  a nadpis skupiny u každého modulu i Nastavení',
    ['Provoz', 'Tvorba menu', 'Finance', 'Marketing', 'Nastavení'].every((n) => r.vice.includes(`<h3>${n}</h3>`)))
  ok('vypnutý modul (Nákup) v menu není', !r.vice.includes('/cerna-perla/nakup') && !r.vice.includes('Nákup'))

  const chystane = r.polozky.filter((p) => !p.hotovo)
  ok('chystané obrazovky vedení vidí, ale bez odkazu',
    chystane.length > 0 &&
      chystane.every((p) => r.vice.includes(p.nazev) && !maOdkaz(r.vice, adresa('cerna-perla', p))) &&
      r.vice.includes('Připravujeme'))

  ok('obrazovka, kde člověk je, je v menu označená',
    /<a [^>]*href="\/cerna-perla\/dnes"[^>]*aria-current="page"/.test(r.vice))
  ok('Vzhled je v menu, i s přepínačem',
    r.vice.includes('Vzhled') && /aria-label="Přepnout na (tmavý|světlý) režim"/.test(r.vice))
  ok('Odhlásit se je v menu', r.vice.includes('Odhlásit se'))
  ok('  ale jedním ťuknutím neodhlásí (žádný formulář bez dotazu)', !r.vice.includes('<form'))

  ok('logo vede na Dnes', /<a [^>]*href="\/cerna-perla\/dnes"[^>]*class="ft-brand"/.test(r.html))
  ok('nikde v rámu odkaz na holou adresu rozsahu',
    !/href="\/(cerna-perla|firma)(\?[^"]*)?"/.test(r.html))
}

{
  // Přepnutí rozsahu z obrazovky, která v nabídce nemá položku: dřív
  // vedlo na rozcestník, teď rovnou na Dnes druhého rozsahu.
  const r = await ram(MAJITEL, 'cerna-perla', '/cerna-perla/upozorneni', OBA_ROZSAHY)
  ok('přepnutí na firmu z upozornění vede na /firma/dnes',
    maOdkaz(r.html, '/firma/dnes') && !/href="\/firma"/.test(r.html))
  // Docházka se váže na pobočku; na firmě ji nahradí první obrazovka Provozu.
  const d = await ram(MAJITEL, 'cerna-perla', '/cerna-perla/dochazka', OBA_ROZSAHY)
  ok('přepnutí na firmu z Docházky vede na /firma/dnes', /<a [^>]*href="\/firma\/dnes"[^>]*data-branch="firma"/.test(d.html))
}

{
  const r = await ram(MAJITEL, 'firma', '/firma/nastaveni/lide')
  ok('majitel na /firma v Nastavení: vyříznuto', r.vyrizlo)
  ok('  lišta nese Nastavení, nejvýš čtyři + Více',
    odkazu(r.lista) === 4 && maOdkaz(r.lista, '/firma/nastaveni/firma') && r.lista.includes('Více'))
  ok('  a z menu se dá odejít do modulů',
    maOdkaz(r.vice, '/firma/dnes') && maOdkaz(r.vice, '/firma/marketing/media'))
  ok('  logo vede na /firma/dnes', /<a [^>]*href="\/firma\/dnes"[^>]*class="ft-brand"/.test(r.html))
}

{
  const r = await ram(CISNIK, 'cerna-perla', '/cerna-perla/dochazka')
  ok('číšník: vyříznuto', r.vyrizlo)
  ok('číšník: v liště jeho čtyři obrazovky', odkazu(r.lista) === 4)
  // Tohle je chyba, kterou by zrušení rozcestníku přineslo: do 25. 9.
  // se „Více" kreslilo jen při šesti a víc obrazovkách.
  ok('  a „Více" i tak', r.lista.includes('Více'))
  ok('  v menu Moje údaje, Vzhled i Odhlásit se',
    maOdkaz(r.vice, '/moje-udaje') && r.vice.includes('Vzhled') && r.vice.includes('Odhlásit se'))
  ok('  ale ne Zálohy ani nastavení firmy',
    !r.vice.includes('/cerna-perla/zalohy') && !r.vice.includes('/cerna-perla/nastaveni/'))
  ok('  ani chystané obrazovky', !r.vice.includes('Připravujeme'))
}

{
  // Méně obrazovek, než je míst: nic se neschová, „Více" zůstává.
  const r = await ram(
    { ...CISNIK, kontext: { ...CISNIK.kontext, permissions: ['communication.read'] } },
    'cerna-perla',
    '/cerna-perla/dnes',
  )
  ok('tři obrazovky: všechny tři v liště a „Více" vedle',
    r.vyrizlo && odkazu(r.lista) === 3 && r.lista.includes('Více'))
}

{
  // Pět obrazovek: do 25. 9. se kreslily všechny a „Více" chybělo.
  // Teď čtyři a pátá (Zálohy) v menu.
  const r = await ram(
    { ...CISNIK, kontext: { ...CISNIK.kontext, permissions: ['shifts.read', 'advances.manage'] } },
    'cerna-perla',
    '/cerna-perla/dnes',
  )
  ok('pět obrazovek: čtyři v liště + „Více"',
    r.vyrizlo && odkazu(r.lista) === 4 && r.lista.includes('Více'))
  ok('  a pátá je v menu', !maOdkaz(r.lista, '/cerna-perla/zalohy') && maOdkaz(r.vice, '/cerna-perla/zalohy'))
}

console.log('\n== Odhlášení v „Více" se ptá ==')

{
  const zavreny = renderToStaticMarkup(createElement(Odhlaseni))
  ok('nejdřív jen tlačítko „Odhlásit se"', zavreny.includes('Odhlásit se') && !zavreny.includes('<form'))
  const dotaz = renderToStaticMarkup(createElement(Odhlaseni, { ptaSeNaZacatku: true }))
  ok('po ťuknutí dotaz s formulářem a „Zpět"',
    dotaz.includes('Odhlásit se?') && dotaz.includes('<form') && dotaz.includes('Zpět'))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
