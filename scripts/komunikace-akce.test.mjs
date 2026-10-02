#!/usr/bin/env node
/**
 * Komunikace 27. 9. 2026 — serverové akce a vykreslené komponenty.
 *
 * Pusť `node scripts/komunikace-akce.test.mjs` (Node 24 zvládne `.ts` sám).
 *
 * Plán docs/komunikace-stav-a-plan-2026-09-27.md, položky T1–T4, T6, T7.
 * Čistá logika (pořadí Nástěnky, věty, záložky) je v komunikace.test.mjs,
 * cíl klepnutí na upozornění v upozorneni.test.mjs, databázová půlka
 * (pojistka kanálů, upozornění na oznámení) ve scénáři krok62.
 *
 * ---------------------------------------------------------------------
 * SPOUŠTÍ SE SKUTEČNÝ KÓD, podstrčená je jen databáze pod ním
 * (`scripts/vykreslit.mjs`, stejný postup jako prava-osob.test.mjs).
 * Akce se volají s FormData, jaké by poslal prohlížeč, a kontroluje se,
 * co opravdu šlo do databáze a kam se přesměrovalo — ne co akce „měla“
 * udělat. Komponenty se vykreslí do HTML a čte se z něj.
 */

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { adresaModulu, nactiKomponentu, nactiModul } from './vykreslit.mjs'

/** Zdroj bez komentářů — zmínka v komentáři („do 27. 9. tu stálo…“) není kód. */
const bezKomentaru = (t) =>
  t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')
const REACT = import.meta.resolve('react')
const PRAZDNY = js('')

/* --- podstrčená databáze ---------------------------------------------- */

/*
  Klient, který zapisuje, co se po něm chtělo. Odpovědi dodává svět
  (`globalThis.__db.rpc` a `globalThis.__db.tabulka`), aby každá kontrola
  mohla říct, co databáze „vrátí“.
*/
const SERVER = js(`
export async function getServerSupabase() {
  const db = globalThis.__db
  return {
    rpc: async (jmeno, args) => { db.log.push({ rpc: jmeno, args }); return db.rpc(jmeno, args ?? {}) },
    from(tabulka) {
      const q = { tabulka, op: 'select', filtry: [], data: null }
      const b = {
        select(s) { if (q.op === 'select') q.sloupce = s; return b },
        insert(d) { q.op = 'insert'; q.data = d; return b },
        update(d) { q.op = 'update'; q.data = d; return b },
        upsert(d) { q.op = 'upsert'; q.data = d; return b },
        eq(k, v) { q.filtry.push(['eq', k, v]); return b },
        is(k, v) { q.filtry.push(['is', k, v]); return b },
        in(k, v) { q.filtry.push(['in', k, v]); return b },
        not(k, o, v) { q.filtry.push(['not', k, o, v]); return b },
        or(s) { q.filtry.push(['or', s]); return b },
        order() { return b },
        limit() { return b },
        maybeSingle() { q.jeden = true; return b },
        single() { q.jeden = true; return b },
        then(res, rej) { db.log.push({ from: q }); return Promise.resolve(db.tabulka(q)).then(res, rej) },
      }
      return b
    },
  }
}`)
const NAV = js('export function redirect(u) { const e = new Error("NEXT_REDIRECT " + u); e.presmerovani = u; throw e }')
const CACHE = js('export function revalidatePath(p, t) { globalThis.__db.log.push({ revalidate: p, typ: t ?? null }) }')
const AUTHZ = js('export async function getUser() { return globalThis.__db.uzivatel }')
const ZAKLAD_STUB = js(`export async function zakladZRozsahu(r) {
  return r === 'perla' ? { tenantId: 't1', rozsah: 'perla', branchId: 'b1' } : null
}`)
const PUSH = js('export function naplanovatPushKeZprave(id) { globalThis.__db.log.push({ push: id }) }')
const DOTAZ = adresaModulu('lib/supabase/dotaz.ts', [['server-only', PRAZDNY]])
// Skutečný dotaz Nástěnky (i `ctenariNastenky`) — sourozenecký `.ts` s `@/…`
// by Node sám nenačetl, podstrčená je jen databáze pod ním.
const NASTENKA_DOTAZ = adresaModulu('app/[rozsah]/vzkazy/nastenka-dotaz.ts', [['@/lib/supabase/dotaz', DOTAZ]])
const LINK = js(`import { createElement } from ${JSON.stringify(REACT)}
export default function Link({ href, children, prefetch, scroll, ...r }) { return createElement('a', { href, ...r }, children) }`)

const SPOLECNE = [
  ['server-only', PRAZDNY],
  ['next/navigation', NAV],
  ['next/cache', CACHE],
  ['next/link', LINK],
  ['@/lib/authz', AUTHZ],
  ['@/lib/supabase/server', SERVER],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/komunikace/push-hned', PUSH],
  ['./zaklad', ZAKLAD_STUB],
  ['../vzkazy/zaklad', ZAKLAD_STUB],
  ['./nastenka-dotaz', NASTENKA_DOTAZ],
]

const akce = await nactiModul('app/[rozsah]/vzkazy/akce.ts', SPOLECNE)
const akceNastenka = await nactiModul('app/[rozsah]/vzkazy/akce-nastenka.ts', SPOLECNE)
const otevrit = await nactiModul('app/[rozsah]/upozorneni/otevrit.ts', SPOLECNE)

const UZ = '11111111-1111-4111-8111-111111111111'
const KONV = '22222222-2222-4222-8222-222222222222'
const ZPRAVA = '33333333-3333-4333-8333-333333333333'
const KLIENT = '44444444-4444-4444-8444-444444444444'
const NOTIF = '55555555-5555-4555-8555-555555555555'
const UKOL = '66666666-6666-4666-8666-666666666666'

/** Nový svět. `rpc` a `tabulka` jde přepsat pro jednotlivou kontrolu. */
function svet(dalsi = {}) {
  const db = {
    log: [],
    uzivatel: { id: UZ },
    zbyva: 0,
    rpc(jmeno) {
      if (jmeno === 'poslat_zpravu') return { data: ZPRAVA, error: null }
      if (jmeno === 'precist_rozhovor') return { data: new Date().toISOString(), error: null }
      if (jmeno === 'moje_rozhovory') return { data: [{ neprectenych: db.zbyva }], error: null }
      if (jmeno === 'zalozit_rozhovor') return { data: KONV, error: null }
      return { data: null, error: { message: 'neznámá funkce ' + jmeno } }
    },
    tabulka() { return { data: null, error: null } },
    ...dalsi,
  }
  globalThis.__db = db
  return db
}

async function zavolat(fn, ...args) {
  try {
    return { vysledek: await fn(...args), kam: null }
  } catch (e) {
    if (e?.presmerovani) return { vysledek: null, kam: e.presmerovani }
    throw e
  }
}

const fd = (pole) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(pole)) f.append(k, v)
  return f
}

const rpcVolani = (db, jmeno) => db.log.filter((z) => z.rpc === jmeno)
const zapisy = (db, tabulka, op) => db.log.filter((z) => z.from?.tabulka === tabulka && z.from?.op === op).map((z) => z.from)

/* =====================================================================
   T1 — rozhovor se označí za přečtený
   ===================================================================== */

console.log('\n== T1: odpověď označí rozhovor za přečtený ==')

{
  const db = svet()
  const { vysledek } = await zavolat(akce.odeslatZpravuKlient, {
    rozsah: 'perla', konverzace: KONV, text: 'Ahoj', priorita: 'normal', klientId: KLIENT, potvrzeno: false,
  })
  ok('zpráva odešla', vysledek?.ok === true)
  const iPoslat = db.log.findIndex((z) => z.rpc === 'poslat_zpravu')
  const iPrecteno = db.log.findIndex((z) => z.rpc === 'precist_rozhovor')
  ok('a PO ní se rozhovor označil za přečtený', iPoslat >= 0 && iPrecteno > iPoslat)
  ok('  ten samý rozhovor', rpcVolani(db, 'precist_rozhovor')[0]?.args?.p_konverzace === KONV)
  ok('počty ve zvonečku se překreslí (layout)', db.log.some((z) => z.revalidate === '/perla' && z.typ === 'layout'))
}

{
  const db = svet()
  const { kam } = await zavolat(akce.poslatZpravu, fd({ rozsah: 'perla', konverzace: KONV, text: 'Bez JS', priorita: 'normal' }))
  ok('i odeslání bez JavaScriptu (poslatZpravu) označí přečtené', rpcVolani(db, 'precist_rozhovor').length === 1)
  ok('  a vrátí se do rozhovoru', kam === `/perla/vzkazy/${KONV}`)
}

console.log('\n== T1: „nový vzkaz“ ve zvonečku až když nic nezbývá ==')

{
  const db = svet()
  db.zbyva = 0
  const { vysledek } = await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'perla', konverzace: KONV })
  ok('po zobrazení se zapíše přečtení', vysledek?.ok === true && rpcVolani(db, 'precist_rozhovor').length === 1)
  const u = zapisy(db, 'notifications', 'update')
  ok('nic nepřečteného nezbylo → vlastní vzkaz.novy dostanou read_at', u.length === 1 && Boolean(u[0].data?.read_at))
  ok('  jen druh vzkaz.novy a jen vlastní řádky',
    u.length === 1 &&
      u[0].filtry.some((f) => f[0] === 'eq' && f[1] === 'druh' && f[2] === 'vzkaz.novy') &&
      u[0].filtry.some((f) => f[0] === 'eq' && f[1] === 'user_id' && f[2] === UZ))
  ok('  a nic nepřesměrovává (volá se z efektu, ne z formuláře)', !db.log.some((z) => z.presmerovani))
}

{
  const db = svet()
  db.zbyva = 2
  await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'perla', konverzace: KONV })
  ok('zbývá jiný nepřečtený rozhovor → zvoneček se NEOZNAČÍ', zapisy(db, 'notifications', 'update').length === 0)
}

{
  const db = svet()
  const r = await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'perla', konverzace: 'nesmysl' })
  ok('neplatné id rozhovoru: nic se nezapíše', r.vysledek?.ok === false && db.log.length === 0)
  const r2 = await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'cizi-rozsah', konverzace: KONV })
  ok('cizí rozsah: nic se nezapíše', r2.vysledek?.ok === false && rpcVolani(db, 'precist_rozhovor').length === 0)
}

{
  const db = svet({
    rpc(jmeno) {
      if (jmeno === 'precist_rozhovor') return { data: null, error: { message: 'K téhle konverzaci nemáte přístup.', code: '42501' } }
      return { data: [], error: null }
    },
  })
  const r = await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'perla', konverzace: KONV })
  ok('když databáze přečtení odmítne, zvoneček se nesahá a vrátí se ne-ok',
    r.vysledek?.ok === false && zapisy(db, 'notifications', 'update').length === 0)
}

console.log('\n== T1: aplikace nasazená dřív než migrace čtení nezapisuje ==')

{
  /*
    Kód se nasazuje sloučením PR, migrace ručně. Bez pojistky v databázi
    by zápis čtení do kanálu člověka zapsal natrvalo. Aplikace proto volá
    `precist_rozhovor`, která vzniká TOUŽ migrací: bez ní (PGRST202)
    nesmí jít ani starou cestou `oznacit_precteno`, ani sahat na zvoneček.
  */
  const db = svet({
    rpc(jmeno) {
      if (jmeno === 'precist_rozhovor') return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }
      if (jmeno === 'moje_rozhovory') return { data: [], error: null }
      if (jmeno === 'poslat_zpravu') return { data: ZPRAVA, error: null }
      return { data: null, error: null }
    },
  })
  const r = await zavolat(akce.oznacitPrectenoPoZobrazeni, { rozsah: 'perla', konverzace: KONV })
  ok('bez nové funkce: vrátí ne-ok', r.vysledek?.ok === false)
  ok('  a nesáhne na starou oznacit_precteno ani na zvoneček',
    rpcVolani(db, 'oznacit_precteno').length === 0 && zapisy(db, 'notifications', 'update').length === 0)
  const odeslano = await zavolat(akce.odeslatZpravuKlient, {
    rozsah: 'perla', konverzace: KONV, text: 'Ahoj', priorita: 'normal', klientId: KLIENT, potvrzeno: false,
  })
  ok('  zpráva přitom odejde normálně (čtení je jen doplněk)', odeslano.vysledek?.ok === true)
}

console.log('\n== T1: stránka NEZNAČÍ při vykreslení (prefetch) ==')

{
  const stranka = readFileSync('app/[rozsah]/vzkazy/[konverzace]/page.tsx', 'utf8')
  // Komentáře pryč — zmínka o funkci v komentáři není volání.
  const kod = stranka.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
  ok('server při vykreslení čtení nezapisuje (ani precist_rozhovor, ani oznacit_precteno)',
    !kod.includes("'precist_rozhovor'") && !kod.includes("'oznacit_precteno'"))
  ok('místo toho vykreslí klientskou součástku', /<OznacitPoZobrazeni[\s\S]*?konverzace=\{konverzace\}/.test(kod))
  const soucastka = readFileSync('app/[rozsah]/vzkazy/[konverzace]/oznacit-po-zobrazeni.tsx', 'utf8')
  ok('součástka volá akci jen z efektu a jen na viditelné stránce',
    soucastka.includes('useEffect(') && soucastka.includes("document.visibilityState !== 'visible'") &&
      soucastka.includes('oznacitPrectenoPoZobrazeni('))
  ok('z panelu zmizelo tlačítko „Označit za přečtené“',
    !bezKomentaru(readFileSync('app/[rozsah]/vzkazy/[konverzace]/panel-konverzace.tsx', 'utf8')).includes('Označit za přečtené'))
}

console.log('\n== T1/T5: vlákno — dělítko, „Zrušit zprávu“, bez věty o přepisu ==')

const VlaknoZprav = await nactiKomponentu('app/[rozsah]/vzkazy/[konverzace]/vlakno-zprav.tsx', [
  ...SPOLECNE,
  ['../akce', js('export async function stornovatZpravu() {}')],
])

{
  const Z = (id, autor, cas, dalsi = {}) => ({
    id, autor, vytvoreno: cas, typ: 'zprava', text: 'text ' + id, priorita: 'normal', stornovana: false,
    zvukOdkaz: null, zvukDelkaS: null, maZvuk: false, objektTyp: null, objektId: null, prilohy: [], ...dalsi,
  })
  const zpravy = [
    Z('a', 'kolega', '2026-09-27T08:00:00Z'),
    Z('b', 'ja', '2026-09-27T08:05:00Z'),
    Z('c', 'kolega', '2026-09-27T09:00:00Z', { maZvuk: true, zvukOdkaz: 'https://x/h.webm', zvukDelkaS: 12 }),
  ]
  const html = renderToStaticMarkup(createElement(VlaknoZprav, {
    rozsah: 'perla', konverzace: KONV, zpravy, ja: 'ja', dnes: '2026-09-27',
    precetoDo: '2026-09-27T08:30:00Z', jmena: { kolega: 'Kolega' }, zona: 'Europe/Prague', smiUkoly: false,
  }))
  ok('dělítko „1 nová zpráva“ se nakreslí z předané záložky', html.includes('id="nove"') && html.includes('1 nová zpráva'))
  ok('  a stojí PŘED novou zprávou, ne před starou',
    html.indexOf('id="nove"') > html.indexOf('text a') && html.indexOf('id="nove"') < html.indexOf('text c'))
  ok('u vlastní zprávy „Zrušit zprávu“, ne „Stáhnout“', html.includes('Zrušit zprávu') && !html.includes('>Stáhnout<'))
  ok('u hlasovky už není „Přepis na text není dostupný“', html.includes('Hlasová zpráva') && !html.includes('Přepis na text'))
  const zdroj = readFileSync('app/[rozsah]/vzkazy/[konverzace]/vlakno-zprav.tsx', 'utf8')
  ok('zrušení se ptá (window.confirm) a dělítko drží první hodnotu (useState)',
    zdroj.includes('window.confirm(') && /useState\(precetoDo\)/.test(zdroj))
}

/* =====================================================================
   T3 — vzkaz vedení a nový rozhovor rovnou se zprávou
   ===================================================================== */

console.log('\n== T3: vzkaz vedení bez zprávy se nezaloží ==')

{
  const db = svet()
  const { kam } = await zavolat(akce.zalozitVzkazVedeni, fd({ rozsah: 'perla', adresat: 'majitel', nazev: 'Směny', zprava: '   ' }))
  ok('bez zprávy se rozhovor NEZALOŽÍ', rpcVolani(db, 'zalozit_rozhovor').length === 0)
  ok('  a vrátí se k rozbalenému formuláři s hláškou', Boolean(kam) && kam.startsWith('/perla/vzkazy?vedeni=1&chyba='))
}

{
  const db = svet()
  const { kam } = await zavolat(akce.zalozitVzkazVedeni, fd({
    rozsah: 'perla', adresat: 'vedouci', pobocka: 'b1', nazev: 'Směny', zprava: 'Potřebuju volno v pátek.', klient_id: KLIENT,
  }))
  const zalozit = rpcVolani(db, 'zalozit_rozhovor')
  const poslat = rpcVolani(db, 'poslat_zpravu')
  ok('se zprávou: rozhovor se založí', zalozit.length === 1 && zalozit[0].args.p_druh === 'vedeni')
  ok('  a HNED odejde zpráva do téhož rozhovoru', poslat.length === 1 && poslat[0].args.p_konverzace === KONV)
  ok('  s textem a klientským id z formuláře (dvojí odeslání nezdvojí)',
    poslat[0]?.args.p_text === 'Potřebuju volno v pátek.' && poslat[0]?.args.p_klient_id === KLIENT)
  ok('  vedení dostane push hned', db.log.some((z) => z.push === ZPRAVA))
  ok('  a přesměruje se do rozhovoru', kam === `/perla/vzkazy/${KONV}`)
}

{
  const db = svet({
    rpc(jmeno) {
      if (jmeno === 'zalozit_rozhovor') return { data: KONV, error: null }
      if (jmeno === 'poslat_zpravu') return { data: null, error: { message: 'Výpadek.' } }
      return { data: [], error: null }
    },
  })
  const TAJNE = 'Vedoucí na mě křičí'
  const { kam } = await zavolat(akce.zalozitVzkazVedeni, fd({ rozsah: 'perla', adresat: 'majitel', nazev: 'X', zprava: TAJNE }))
  ok('zpráva neodešla → do rozhovoru s hláškou', Boolean(kam) && kam.startsWith(`/perla/vzkazy/${KONV}?chyba=`))
  ok('  TEXT ZPRÁVY V ADRESE NENÍ', Boolean(kam) && !decodeURIComponent(kam).includes(TAJNE))
  ok('  bez klientského id z formuláře si ho akce vyrobí', rpcVolani(db, 'poslat_zpravu')[0]?.args.p_klient_id?.length === 36)
}

console.log('\n== T3: nový rozhovor s nepovinnou první zprávou ==')

{
  const db = svet()
  const { kam } = await zavolat(akce.zalozitOsobniRozhovor, fd({ rozsah: 'perla', ucastnik: UKOL, zprava: '' }))
  ok('bez první zprávy: rozhovor ano, zpráva ne', rpcVolani(db, 'zalozit_rozhovor').length === 1 && rpcVolani(db, 'poslat_zpravu').length === 0)
  ok('  přesměruje do rozhovoru', kam === `/perla/vzkazy/${KONV}`)
}
{
  const db = svet()
  await zavolat(akce.zalozitOsobniRozhovor, fd({ rozsah: 'perla', ucastnik: UKOL, zprava: 'Ahoj, máš chvilku?', klient_id: KLIENT }))
  const poslat = rpcVolani(db, 'poslat_zpravu')
  ok('s první zprávou: odejde hned s klientským id', poslat.length === 1 && poslat[0].args.p_klient_id === KLIENT && poslat[0].args.p_text === 'Ahoj, máš chvilku?')
}
{
  /*
    28. 9.: délka se ověří DŘÍV, než rozhovor vznikne. Do té doby založil
    dlouhý text (formulář odeslaný mimo prohlížeč) vzkaz vedení BEZ zprávy
    — přesně to, co T3 odstraňuje.
  */
  const dlouhy = 'x'.repeat(4001)
  const db = svet()
  const { kam } = await zavolat(akce.zalozitVzkazVedeni, fd({ rozsah: 'perla', nazev: 'Stížnost', zprava: dlouhy, adresat: 'majitel', klient_id: KLIENT }))
  ok('vzkaz vedení s textem nad 4000 znaků: rozhovor se NEZALOŽÍ', rpcVolani(db, 'zalozit_rozhovor').length === 0)
  ok('  a vrátí se do formuláře s hláškou (text v adrese není)', String(kam).startsWith('/perla/vzkazy?vedeni=1&chyba=') && !String(kam).includes('xxxx'))
  const db2 = svet()
  await zavolat(akce.zalozitOsobniRozhovor, fd({ rozsah: 'perla', ucastnik: UKOL, zprava: dlouhy, klient_id: KLIENT }))
  ok('nový rozhovor s první zprávou nad 4000 znaků: nezaloží se', rpcVolani(db2, 'zalozit_rozhovor').length === 0)
  const db3 = svet()
  await zavolat(akce.zalozitVzkazVedeni, fd({ rozsah: 'perla', nazev: 'Stížnost', zprava: 'x'.repeat(4000), adresat: 'majitel', klient_id: KLIENT }))
  ok('  KLADNĚ: přesně 4000 znaků projde', rpcVolani(db3, 'zalozit_rozhovor').length === 1 && rpcVolani(db3, 'poslat_zpravu').length === 1)
}

const FormularVedeni = await nactiKomponentu('app/[rozsah]/vzkazy/formular-vedeni.tsx', [
  ...SPOLECNE,
  ['./akce', js('export async function zalozitVzkazVedeni() {}')],
  ['react-dom', import.meta.resolve('react-dom')],
])
{
  const vykresli = (otevreno) => renderToStaticMarkup(createElement(FormularVedeni, {
    rozsah: 'perla', otevreno, chyba: otevreno ? 'Napište zprávu, kterou má vedení dostat.' : null,
    vedouciJmena: ['Jana'], majitelJmena: ['Šéf'], pobocky: [{ id: 'b1', name: 'Perla' }], vychoziPobocka: 'b1', klientId: KLIENT,
  }))
  const html = vykresli(false)
  const formular = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
  ok('formulář „Napsat vedení“ se vykreslil', formular.length > 100)
  ok('  má povinné pole Zpráva', /<textarea[^>]*name="zprava"[^>]*required/.test(formular))
  ok('  klientské id z props', formular.includes(`name="klient_id" value="${KLIENT}"`))
  ok('  tlačítko chráněné proti dvojkliku (aria-busy z TlacitkoOdeslat)', /<button[^>]*type="submit"[^>]*aria-busy/.test(formular))
  ok('  sbalený pod tlačítkem (details bez open)', /<details class="pc-vedeni">/.test(html))
  ok('  po chybě rozbalený a s hláškou', /<details class="pc-vedeni" open="">/.test(vykresli(true)) && vykresli(true).includes('role="alert"'))
  const stranka = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/page.tsx', 'utf8'))
  ok('stránka formulář opravdu kreslí', stranka.includes('<FormularVedeni'))
  ok('„+ Nový rozhovor“, ne „+ Nová zpráva“', stranka.includes('Nový rozhovor') && !stranka.includes('Nová zpráva'))
}

/* =====================================================================
   T2 — klepnutí na upozornění
   ===================================================================== */

console.log('\n== T2: klepnutí na upozornění označí a otevře věc ==')

{
  const db = svet({
    tabulka(q) {
      if (q.tabulka === 'notifications' && q.op === 'select') {
        return { data: { id: NOTIF, druh: 'ukol.pridelen', telo: { ukol: UKOL }, shift_id: null, zdroj_typ: null, zdroj_id: null, read_at: null }, error: null }
      }
      return { data: null, error: null }
    },
  })
  const { kam } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF, cil: 'https://zly.example' }))
  ok('přesměruje na úkol z ULOŽENÉHO řádku (pole „cil“ z formuláře se ignoruje)', kam === `/perla/ukoly/ukol/${UKOL}`)
  const u = zapisy(db, 'notifications', 'update')
  ok('a upozornění se označí za přečtené', u.length === 1 && Boolean(u[0].data.read_at) && u[0].filtry.some((f) => f[1] === 'id' && f[2] === NOTIF))
  const s = zapisy(db, 'notifications', 'select')[0]
  ok('řádek se čte jen vlastní (user_id) a ve firmě rozsahu', Boolean(s) && s.filtry.some((f) => f[1] === 'user_id' && f[2] === UZ) && s.filtry.some((f) => f[1] === 'tenant_id' && f[2] === 't1'))
}

{
  svet({
    tabulka(q) {
      if (q.tabulka === 'notifications' && q.op === 'select') {
        return { data: { id: NOTIF, druh: 'vzkaz.novy', telo: { pocet: 1 }, shift_id: null, zdroj_typ: 'zprava', zdroj_id: ZPRAVA, read_at: '2026-09-27T08:00:00Z' }, error: null }
      }
      if (q.tabulka === 'konverzace_zpravy') return { data: { konverzace_id: KONV }, error: null }
      return { data: null, error: null }
    },
  })
  const { kam } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF }))
  ok('„nový vzkaz“ vede do rozhovoru, ke kterému zpráva patří', kam === `/perla/vzkazy/${KONV}`)
  ok('  už přečtené se znovu nepřepisuje', zapisy(globalThis.__db, 'notifications', 'update').length === 0)
}

{
  svet({ tabulka: () => ({ data: null, error: null }) })
  const { kam } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF }))
  ok('cizí nebo neexistující upozornění → obecná stránka Upozornění', kam === '/perla/upozorneni')
  const { kam: kam2 } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: 'nesmysl' }))
  ok('neplatné id → obecná stránka, bez dotazu', kam2 === '/perla/upozorneni')
}

/*
  28. 9.: nepotvrzená změna směny se klepnutím NEOZNAČÍ za přečtenou —
  přečte se až „Potvrdit“. Do té doby zmizela ze zvonečku a kdo stránku
  zavřel, neměl nic, co by mu ji připomnělo.
*/
{
  const radek = (dalsi) => svet({
    tabulka(q) {
      if (q.tabulka === 'notifications' && q.op === 'select') {
        return { data: { id: NOTIF, druh: 'smena.zmenena', telo: { den: '2026-09-29' }, shift_id: null, zdroj_typ: null, zdroj_id: null, read_at: null, ...dalsi }, error: null }
      }
      return { data: null, error: null }
    },
  })
  const db = radek({ acknowledged_at: null })
  const { kam } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF }))
  ok('nepotvrzená změna směny → stránka Upozornění (tam je „Potvrdit“)', kam === '/perla/upozorneni')
  ok('  a za přečtenou se NEOZNAČÍ (zůstane ve zvonečku)', zapisy(db, 'notifications', 'update').length === 0)
  ok('  (akce si o acknowledged_at opravdu řekla)', String(zapisy(db, 'notifications', 'select')[0]?.sloupce ?? '').includes('acknowledged_at'))
  const db2 = radek({ acknowledged_at: '2026-09-28T08:00:00Z' })
  await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF }))
  ok('potvrzená, ale nepřečtená → označí se', zapisy(db2, 'notifications', 'update').length === 1)
}

{
  // Sloučené „3 nové zprávy“ můžou být ze tří rozhovorů.
  const db = svet({
    tabulka(q) {
      if (q.tabulka === 'notifications' && q.op === 'select') {
        return { data: { id: NOTIF, druh: 'vzkaz.novy', telo: { pocet: 3 }, shift_id: null, zdroj_typ: 'zprava', zdroj_id: ZPRAVA, read_at: null }, error: null }
      }
      if (q.tabulka === 'konverzace_zpravy') return { data: { konverzace_id: KONV }, error: null }
      return { data: null, error: null }
    },
  })
  const { kam } = await zavolat(otevrit.otevritUpozorneni, fd({ rozsah: 'perla', id: NOTIF }))
  ok('„3 nové zprávy“ → seznam nepřečtených, ne rozhovor poslední zprávy', kam === '/perla/vzkazy?filtr=neprectene')
  ok('  a rozhovor se kvůli tomu ani nedohledává', !db.log.some((z) => z.from?.tabulka === 'konverzace_zpravy'))
}

console.log('\n== T2: panel u zvonečku ukazuje, co číslo počítá ==')

const { PanelUpozorneni } = await nactiModul('components/shell/GlobalTopbar.tsx', [
  ['next/link', LINK],
  ['next/navigation', js('export function usePathname() { return "/perla/dnes" }\nexport function useRouter() { return { push() {}, refresh() {} } }')],
  ['@/app/[rozsah]/upozorneni/otevrit', js('export async function otevritUpozorneni() {}\nexport async function oznacitVsePrectene() {}')],
  // Přepínač firmy (2. 10. 2026) — MenuUctu volá serverovou akci přímo;
  // tenhle soubor testuje jen panel zvonečku, ne nabídku účtu.
  ['@/app/firma-prepnuti', js('export async function prepnoutFirmu() {}')],
])

{
  const html = renderToStaticMarkup(createElement(PanelUpozorneni, {
    rozsah: 'perla',
    upozorneni: [
      { id: NOTIF, druh: 'ukol.pridelen', telo: { ukol: UKOL }, created_at: '2026-09-27T08:00:00Z', read_at: null },
    ],
    rozpad: { upozorneni: 1, rozhovory: 3, nastenka: 2 },
    onZavrit: () => {},
  }))
  // Číslo je součet nepřečtených ZPRÁV (moje_rozhovory.neprectenych), ne
  // rozhovorů — do 28. 9. stálo „Nepřečtené rozhovory: 6“ u jednoho kanálu.
  ok('řádek „Nepřečtené zprávy: 3“ (ne „rozhovory“) s odkazem na nepřečtené',
    html.includes('Nepřečtené zprávy: 3') && !html.includes('Nepřečtené rozhovory') && html.includes('href="/perla/vzkazy?filtr=neprectene"'))
  ok('řádek „Nová oznámení: 2“ s odkazem na Nástěnku', html.includes('Nová oznámení: 2') && html.includes('href="/perla/vzkazy?zalozka=nastenka"'))
  ok('položka je formulář s id upozornění (ne odkaz na obecnou stránku)',
    /<form[^>]*>[\s\S]*?name="id" value="55555555-5555-4555-8555-555555555555"/.test(html))
  ok('„Označit vše za přečtené“ a odkaz na Nastavení upozornění',
    html.includes('Označit vše za přečtené') && html.includes('href="/perla/upozorneni/nastaveni"'))
  const bez = renderToStaticMarkup(createElement(PanelUpozorneni, {
    rozsah: 'perla', upozorneni: [], rozpad: { upozorneni: 0, rozhovory: 0, nastenka: 0 }, onZavrit: () => {},
  }))
  ok('při nulách se řádky souhrnu nekreslí', !bez.includes('Nepřečtené zprávy') && !bez.includes('Nová oznámení'))
}

/* =====================================================================
   T4 — záložky
   ===================================================================== */

console.log('\n== T4: záložky se kreslí podle práv, čísla čte čtečka správně ==')

const PcZalozky = await nactiKomponentu('app/[rozsah]/provozni-centrum/zalozky.tsx', [['next/link', LINK]])
{
  const vse = renderToStaticMarkup(createElement(PcZalozky, {
    rozsah: 'perla', aktivni: 'komunikace', pocty: { komunikace: 2, ukoly: 3, nastenka: 1 }, skryte: [],
  }))
  ok('Úkoly: čtečka „3 otevřené“', vse.includes('3 otevřené') && !vse.includes('3 nepřečtené'))
  ok('Komunikace: „2 nepřečtené“', vse.includes('2 nepřečtené'))
  ok('Nástěnka má odkaz', vse.includes('href="/perla/vzkazy?zalozka=nastenka"'))
  const bezPrav = renderToStaticMarkup(createElement(PcZalozky, {
    rozsah: 'perla', aktivni: 'komunikace', pocty: {}, skryte: ['ukoly', 'checklisty', 'nastenka'],
  }))
  ok('bez práv jen Komunikace (Nástěnka se nekreslí)',
    bezPrav.includes('href="/perla/vzkazy"') && !bezPrav.includes('zalozka=nastenka') && !bezPrav.includes('/perla/ukoly'))
}
{
  const pocty = readFileSync('app/[rozsah]/provozni-centrum/pocty.ts', 'utf8')
  ok('počty záložek berou Nástěnku z TÉHOŽ dotazu jako seznam', pocty.includes('neprectenaNastenka('))
  const nastenka = readFileSync('app/[rozsah]/vzkazy/nastenka.tsx', 'utf8')
  ok('  a seznam Nástěnky taky (dotazNastenky)', nastenka.includes('dotazNastenky('))
  const layout = readFileSync('app/[rozsah]/layout.tsx', 'utf8')
  ok('  a zvoneček v rámu taky', layout.includes('neprectenaNastenka('))
  // Každá stránka pod „Vzkazy a úkoly“ posílá čísla ze společné funkce.
  const stranky = [
    'app/[rozsah]/vzkazy/page.tsx',
    'app/[rozsah]/vzkazy/[konverzace]/page.tsx',
    'app/[rozsah]/vzkazy/nova/page.tsx',
    'app/[rozsah]/vzkazy/[konverzace]/ukol/page.tsx',
    'app/[rozsah]/ukoly/page.tsx',
    'app/[rozsah]/ukoly/ukol/[id]/page.tsx',
    'app/[rozsah]/ukoly/checklisty/stranka.tsx',
  ]
  const bez = stranky.filter((s) => {
    const t = readFileSync(s, 'utf8')
    return !(t.includes('nactiZalozky(') && /<PcZalozky[^>]*\{\.\.\.zalozky\}/.test(t))
  })
  ok(`všech ${stranky.length} stránek posílá čísla ze společné funkce${bez.length ? ' — chybí: ' + bez.join(', ') : ''}`, bez.length === 0)
}

/* =====================================================================
   T6 — Nástěnka
   ===================================================================== */

console.log('\n== T6: oznámení nikdy tiše nespadne ==')

{
  svet()
  const r = await zavolat(akceNastenka.napsatOznameni, null, fd({ rozsah: 'perla', text: 'Porada', komu_typ: 'usek' }))
  ok('chybí úsek → česká hláška', r.vysledek?.ok === false && /úsek/i.test(r.vysledek.chyba))
  const r2 = await zavolat(akceNastenka.napsatOznameni, null, fd({ rozsah: 'perla', text: '  ', komu_typ: 'firma' }))
  ok('prázdný text → hláška', r2.vysledek?.ok === false && r2.vysledek.chyba.length > 5)
}
{
  svet({
    tabulka(q) {
      if (q.tabulka === 'employees') return { data: { id: UKOL, user_id: null }, error: null }
      return { data: null, error: null }
    },
  })
  const r = await zavolat(akceNastenka.napsatOznameni, null, fd({ rozsah: 'perla', text: 'Ahoj', komu_typ: 'clovek', komu_id_clovek: UKOL }))
  ok('člověk bez účtu → hláška, že by oznámení neuviděl', r.vysledek?.ok === false && r.vysledek.chyba.includes('účet'))
  ok('  a nic se nevložilo', zapisy(globalThis.__db, 'announcements', 'insert').length === 0)
}

/*
  28. 9.: ROZPOR mezi „Komu“ a vybraným adresátem. React po chybě vrátil
  „Komu“ na „Celá firma“, druhý výběr zůstal — a osobní oznámení odešlo
  celé firmě. Formulář už pole nevrací; tohle je pojistka na serveru.
*/
{
  const db = svet()
  const r = await zavolat(akceNastenka.napsatOznameni, null,
    fd({ rozsah: 'perla', text: 'Petro, přijď si pro smlouvu', komu_typ: 'firma', komu_id_clovek: UKOL }))
  ok('„Celá firma“ + vybraný člověk → hláška „Vyberte znovu…“', r.vysledek?.ok === false && r.vysledek.chyba.includes('Vyberte znovu'))
  ok('  a celé firmě se nic neposlalo', zapisy(db, 'announcements', 'insert').length === 0)
  const db2 = svet()
  const r2 = await zavolat(akceNastenka.napsatOznameni, null,
    fd({ rozsah: 'perla', text: 'Porada', komu_typ: 'usek', komu_id_usek: 'u1', komu_id_clovek: UKOL }))
  ok('úsek + zbylý člověk → taky hláška, nic se nevloží', r2.vysledek?.ok === false && zapisy(db2, 'announcements', 'insert').length === 0)
}

/*
  28. 9.: „Konkrétní člověk“ jen s právem číst Nástěnku. Bez něj by
  oznámení nikdy neviděl (RLS) a nedostal by ani upozornění (T9).
*/
{
  const s = (ctenari) => svet({
    rpc(jmeno, args) {
      if (jmeno === 'ctenari_nastenky') return ctenari(args)
      return { data: null, error: { message: 'neznámá funkce ' + jmeno } }
    },
    tabulka(q) {
      if (q.tabulka === 'employees') return { data: { id: UKOL, user_id: UZ }, error: null }
      return { data: null, error: null }
    },
  })
  const pole = { rozsah: 'perla', text: 'Petro, přijď si pro smlouvu', komu_typ: 'clovek', komu_id_clovek: UKOL }

  const db = s(() => ({ data: [], error: null }))
  const r = await zavolat(akceNastenka.napsatOznameni, null, fd(pole))
  ok('člověk bez communication.read → hláška, že Nástěnku číst nemůže', r.vysledek?.ok === false && r.vysledek.chyba.includes('Nástěnku číst nemůže'))
  ok('  a nic se nevložilo', zapisy(db, 'announcements', 'insert').length === 0)
  ok('  databáze se ptala na TOHO člověka ve firmě rozsahu',
    rpcVolani(db, 'ctenari_nastenky')[0]?.args?.p_tenant === 't1' && rpcVolani(db, 'ctenari_nastenky')[0]?.args?.p_lide?.[0] === UKOL)

  const db2 = s((a) => ({ data: a.p_lide.map((id) => ({ employee_id: id })), error: null }))
  const r2 = await zavolat(akceNastenka.napsatOznameni, null, fd(pole))
  ok('KLADNĚ: s právem se vloží osobní oznámení', r2.vysledek?.ok === true && zapisy(db2, 'announcements', 'insert')[0]?.data?.employee_id === UKOL)

  const db3 = s(() => ({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }))
  const r3 = await zavolat(akceNastenka.napsatOznameni, null, fd(pole))
  ok('bez migrace (funkce není) se chová jako dosud: vloží se', r3.vysledek?.ok === true && zapisy(db3, 'announcements', 'insert').length === 1)

  const db4 = s(() => ({ data: null, error: { message: 'výpadek', code: '57014' } }))
  const r4 = await zavolat(akceNastenka.napsatOznameni, null, fd(pole))
  ok('jiná chyba ověření → hláška, nic se nevloží', r4.vysledek?.ok === false && zapisy(db4, 'announcements', 'insert').length === 0)
}
{
  svet({
    tabulka(q) {
      if (q.tabulka === 'announcements' && q.op === 'insert') return { data: null, error: { message: 'x', code: '42501' } }
      return { data: null, error: null }
    },
  })
  const r = await zavolat(akceNastenka.napsatOznameni, null, fd({ rozsah: 'perla', text: 'Porada', komu_typ: 'firma' }))
  ok('databáze odmítne → česká hláška místo ticha', r.vysledek?.ok === false && r.vysledek.chyba.includes('nemůžete'))
}
{
  const db = svet()
  const r = await zavolat(akceNastenka.napsatOznameni, null, fd({ rozsah: 'perla', text: 'Porada v 14:00', komu_typ: 'firma', vyzadat_potvrzeni: 'ano' }))
  const vlozeno = zapisy(db, 'announcements', 'insert')[0]
  ok('úspěch: vloží se jedno oznámení pro celou firmu s potvrzením',
    r.vysledek?.ok === true && vlozeno?.data.branch_id === null && vlozeno?.data.requires_acknowledgment === true && vlozeno?.data.author_id === UZ)
  ok('  a obnoví se rám (ne stará /zpravy)', db.log.some((z) => z.revalidate === '/perla' && z.typ === 'layout') && !db.log.some((z) => String(z.revalidate).includes('/zpravy')))
}

console.log('\n== T6: výběr adresáta bez vloženého skriptu ==')

const FormularOznameni = await nactiKomponentu('app/[rozsah]/vzkazy/formular-oznameni.tsx', [
  ...SPOLECNE,
  ['./akce-nastenka', js('export async function napsatOznameni() { return null }')],
  ['react-dom', import.meta.resolve('react-dom')],
])
{
  const html = renderToStaticMarkup(createElement(FormularOznameni, {
    rozsah: 'perla',
    pobocky: [{ id: 'b1', nazev: 'Perla' }, { id: 'b2', nazev: 'Bar' }],
    useky: [{ id: 'u1', nazev: 'Kuchyně' }],
    pozice: [],
    lide: [{ id: UKOL, nazev: 'Anna' }],
  }))
  ok('nadpis „Nové oznámení“ (ne „Nová zpráva“)', html.includes('Nové oznámení') && !html.includes('Nová zpráva'))
  // Vlastní vložený skript (do 27. 9. getElementById přes dangerouslySetInnerHTML).
  // <script>, který React sám přidá k formuláři s akcí, se nepočítá.
  ok('žádný vlastní vložený skript v HTML', !html.includes('getElementById') && !html.includes('ft-nastenka-sel-'))
  ok('na začátku jen jeden výběr (Komu), ne čtyři naráz', (html.match(/<select/g) ?? []).length === 1)
  ok('volba „Konkrétní člověk“ je (lidé s účtem předaní stránkou)', html.includes('Konkrétní člověk'))
  const nastenka = readFileSync('app/[rozsah]/vzkazy/nastenka.tsx', 'utf8')
  ok('Nástěnka nabízí jen lidi s účtem (filtr user_id)', nastenka.includes(".not('user_id', 'is', null)"))
  ok('  a z nich jen ty, kdo Nástěnku smí číst (ctenariNastenky)',
    /ctenariNastenky\(\s*supabase,\s*tenantId,\s*lideList\.map/.test(bezKomentaru(nastenka)) &&
      bezKomentaru(nastenka).includes('lideList = lideList.filter((e) => ctenari.ids.has(e.id))'))
  ok('a nemá dangerouslySetInnerHTML ani ✓', !nastenka.includes('dangerouslySetInnerHTML') && !nastenka.includes('✓'))
}

/*
  28. 9.: React 19 po KAŽDÉ akci `<form action>` vrátí pole do výchozího
  stavu, i po chybě — „Komu“ ukázalo „Celá firma“, druhý výběr zůstal,
  zaškrtávátka zmizela. Ověřeno v prohlížeči (snímky v plánu). Tady se
  hlídá, že formulář odesílá přes onSubmit s preventDefault (React pak
  pole nevrací) a že zaškrtávátka i druhý výběr jsou řízené, ať je jde
  po úspěchu vyprázdnit ručně.
*/
{
  const kod = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/formular-oznameni.tsx', 'utf8'))
  ok('odeslání přes onSubmit: preventDefault a startTransition(odeslat)',
    /onSubmit=\{\(e\) => \{[\s\S]*?e\.preventDefault\(\)[\s\S]*?startTransition\(\(\) => odeslat\(data\)\)/.test(kod))
  ok('  zaškrtávátka jsou řízená (checked ze stavu)', kod.includes('checked={pripnout}') && kod.includes('checked={vyzadat}'))
  ok('  druhý výběr je řízený a změna „Komu“ ho vyprázdní', kod.includes('value={komuId}') && /setKomu\(e\.target\.value\)\s*[\s\S]{0,120}setKomuId\(''\)/.test(kod))
  const html = renderToStaticMarkup(createElement(FormularOznameni, {
    rozsah: 'perla', pobocky: [], useky: [], pozice: [], lide: [],
  }))
  ok('  a vykreslí obě zaškrtávátka nezaškrtnutá', /name="pripnout"/.test(html) && /name="vyzadat_potvrzeni"/.test(html) && !html.includes('checked'))
}

/* =====================================================================
   T7 — psaní na telefonu
   ===================================================================== */

console.log('\n== T7: hlasovka a příloha jako dvě ikony ==')

const Psani = await nactiKomponentu('app/[rozsah]/vzkazy/[konverzace]/psani.tsx', [
  // Náhrada téhož importu vyhrává ta první — proto se `next/navigation`
  // ze SPOLECNE vynechá, jinak by zůstal `redirect` bez `useRouter`.
  ...SPOLECNE.filter(([co]) => co !== 'next/navigation'),
  ['next/navigation', js('export function useRouter() { return { refresh() {} } }')],
  ['../akce', js('export async function poslatZpravu() {}\nexport async function odeslatZpravuKlient() {}')],
])
{
  const html = renderToStaticMarkup(createElement(Psani, {
    rozsah: 'perla', konverzace: KONV, uzivatel: UZ, smiNalehavou: false, vetaODoruceni: 'Věta.',
    hlasovka: createElement('div', { id: 'obsah-hlasovky' }, 'HLASOVKA'),
    priloha: createElement('div', { id: 'obsah-prilohy' }, 'PRILOHA'),
  }))
  const formular = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
  ok('ikony mikrofonu a sponky jsou v řádku psaní (uvnitř formuláře)',
    formular.includes('aria-controls="pc-doplnek-hlasovka"') && formular.includes('aria-controls="pc-doplnek-priloha"'))
  ok('  a nejsou to odesílací tlačítka', (formular.match(/aria-controls="pc-doplnek-[a-z]+"/g) ?? []).length === 2 &&
    !/type="submit"[^>]*aria-controls/.test(formular))
  ok('hlasovka i příloha jsou MIMO formulář psaní (vnořený formulář HTML nedovolí)',
    !formular.includes('HLASOVKA') && !formular.includes('PRILOHA') && html.includes('HLASOVKA'))
  ok('  a na začátku sbalené (hidden), ne odmontované', /id="pc-doplnek-hlasovka"[^>]*hidden/.test(html))
  ok('žádné emoji 🎤 ani ⏹ (ani v nahrávači)', !html.includes('🎤') &&
    !/[🎤⏹]/u.test(bezKomentaru(readFileSync('app/[rozsah]/vzkazy/[konverzace]/hlasovka-nahravac.tsx', 'utf8'))))
  ok('pod psaním pravdivá věta o doručení', html.includes('Věta.'))
}
{
  const stranka = readFileSync('app/[rozsah]/vzkazy/[konverzace]/page.tsx', 'utf8')
  const css = readFileSync('app/_komponenty.css', 'utf8')
  ok('na telefonu se nad vláknem schová nadpis a záložky',
    stranka.includes('className="pc-rozhovor-stranka"') && /\.pc-rozhovor-stranka > \.ft-hlava,\s*\.pc-rozhovor-stranka \.pc-zalozky \{ display: none; \}/.test(css))
  ok('panely jsou na telefonu sbalené pod „Podrobnosti“',
    stranka.includes('id="pc-podrobnosti"') && css.includes('.pc-podrobnosti-prepinac:not(:checked) ~ .ds-vzkazy-panel { display: none; }'))
  // Snímek 27. 9. ukázal tlačítko i na počítači: `.ft-tl` z globals.css
  // (načte se PO tomhle souboru) přebilo `display: none` se stejnou
  // specifičností. Proto pravidlo se dvěma třídami.
  ok('  a na počítači tlačítko „Podrobnosti“ není (specifičtěji než .ft-tl)',
    css.includes('.ds-vzkazy-split .pc-podrobnosti-tlacitko { display: none; }'))
  ok('hlavička vlákna: „← Komunikace“', /<Ikona klic="sipkaVlevo" \/> Komunikace/.test(stranka))
}

/* =====================================================================
   T5, T8, T10 — texty, které říkají pravdu (ze zdroje, bez komentářů)

   Tyhle obrazovky jsou serverové komponenty s mnoha dotazy; vykreslit je
   by znamenalo podstrčit půl databáze. Čte se proto jejich zdroj BEZ
   komentářů (zmínka „do 27. 9. tu stálo…“ v komentáři není text na
   obrazovce) a hledá se to, co se opravdu vykreslí.
   ===================================================================== */

console.log('\n== T5: pravdivé texty ==')

{
  const firma = bezKomentaru(readFileSync('app/[rozsah]/nastaveni/firma/page.tsx', 'utf8'))
  ok('Nastavení → Firma neslibuje důležitou změnu „i mimo pracovní dobu“',
    !firma.includes('dostane se k člověku i mimo') && firma.includes('Na telefon') && firma.includes('mimo směnu zatím nepřijde'))
  const dnes = bezKomentaru(readFileSync('app/[rozsah]/dnes/page.tsx', 'utf8'))
  ok('Dnes: „Přidat úkol“ jen s tasks.manage', /canSee\(ctx, "tasks\.manage"\)\)\s*\{\s*rychleAkce\.push\(\{ popisek: "Přidat úkol"/.test(dnes))
  ok('Dnes: věta u Vzkazů z popisVzkazuNaDnes, ne natvrdo „Nová zpráva z vedení“',
    dnes.includes('popisVzkazuNaDnes(') && !dnes.includes('"Nová zpráva z vedení"'))
  ok('Dnes: věta o telefonu podle čtenáře', dnes.includes('<VetaOPushi rozsah={rozsah} jeMajitel={ctx.jeMajitel} />'))
  const ukolZeZpravy = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/[konverzace]/ukol/page.tsx', 'utf8'))
  ok('úkol ze zprávy: bez vývojářské věty o jazykovém modelu', ukolZeZpravy.includes('duvodBezModelu={null}'))
  const mrtve = [
    'app/[rozsah]/vzkazy/page.tsx',
    'app/[rozsah]/vzkazy/[konverzace]/page.tsx',
    'app/[rozsah]/vzkazy/[konverzace]/ukol/page.tsx',
    'app/[rozsah]/upozorneni/nastaveni/page.tsx',
  ].filter((s) => bezKomentaru(readFileSync(s, 'utf8')).includes('čeká na nasazení'))
  ok(`žádné mrtvé rámečky „čeká na nasazení“${mrtve.length ? ' — zůstaly v ' + mrtve.join(', ') : ''}`, mrtve.length === 0)
}

console.log('\n== T5 (28. 9.): prázdný seznam, slovník, věta pod psaním ==')

const SeznamRozhovoru = await nactiKomponentu('app/[rozsah]/vzkazy/seznam-rozhovoru.tsx', [...SPOLECNE])
{
  const prazdny = (dalsi) => renderToStaticMarkup(createElement(SeznamRozhovoru, {
    rozsah: 'perla', rozhovory: [], nazvyPobocek: new Map(), ...dalsi,
  }))
  const firma = prazdny({})
  ok('firemní úroveň bez úseku: o tlačítku kanálu nic (žádné tam není)', !firma.includes('tlačítkem nahoře') && firma.includes('Napsat vedení'))
  ok('na pobočce bez úseku: jen kanál pobočky', prazdny({ tlacitkoKanaluPobocky: true }).includes('kanál své pobočky otevřete tlačítkem nahoře'))
  ok('s úsekem bez pobočky: jen kanál úseku', prazdny({ tlacitkoKanaluUseku: true }).includes('kanál svého úseku otevřete tlačítkem nahoře'))
  ok('obojí: pobočky nebo úseku', prazdny({ tlacitkoKanaluPobocky: true, tlacitkoKanaluUseku: true }).includes('kanál své pobočky nebo úseku'))
  const vzkazy = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/page.tsx', 'utf8'))
  ok('stránka předává, která tlačítka opravdu kreslí',
    vzkazy.includes("tlacitkoKanaluPobocky={scope.level === 'branch' && Boolean(scope.branchId)}") && vzkazy.includes('tlacitkoKanaluUseku={Boolean(mujUsekId)}'))
  ok('„Všechno přečtené“ se bez jediného rozhovoru nekreslí', /\{rozhovory\.length === 0 \|\| doruceno > 0 \|\| cekaCelkem > 0 \? null : \(/.test(vzkazy))
}

const PanelUkolyUdalosti = await nactiKomponentu('app/[rozsah]/vzkazy/[konverzace]/panel-ukoly-udalosti.tsx', [...SPOLECNE])
{
  const html = renderToStaticMarkup(createElement(PanelUkolyUdalosti, { rozsah: 'perla', ukoly: [], udalosti: [], zona: 'Europe/Prague' }))
  ok('panel úkolů mluví o rozhovoru, ne o „konverzaci“', html.includes('Z tohoto rozhovoru') && !/konverzac/i.test(html))
}
{
  const detail = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/[konverzace]/page.tsx', 'utf8'))
  ok('detail čte konverzace_ucastnici jen u osobního, mezi pobočkami a vedení (ne u kanálu)',
    /DRUHY_S_UCASTNIKY = \['osobni', 'mezi_pobockami', 'vedeni'\][\s\S]*?if \(DRUHY_S_UCASTNIKY\.includes\(String\(hlavicka\.druh\)\)\) \{\s*const \{ data: ucastniciData \} = await supabase\s*\.from\('konverzace_ucastnici'\)/.test(detail) &&
      (detail.match(/from\('konverzace_ucastnici'\)/g) ?? []).length === 1)
  ok('věta pod psaním ví, jestli upozornění do telefonu vůbec chodí (VAPID)',
    detail.includes('vetaODoruceni({ smiNalehavou, pushNastaveny: nactiKliceVapid(process.env) !== null })'))
}

console.log('\n== T6: karta oznámení (vzhled Dnes) ==')

const SeznamOznameni = await nactiKomponentu('app/[rozsah]/vzkazy/seznam-oznameni.tsx', [
  ...SPOLECNE,
  ['./akce-nastenka', js('export async function oznacitPrectene() {}')],
])
{
  const O = (id, dalsi = {}) => ({
    id, branch_id: null, employee_id: null, usek_id: null, position_id: null, body: 'Text ' + id,
    pinned: false, author_id: null, created_at: '2026-09-27T08:00:00Z', requires_acknowledgment: false, ...dalsi,
  })
  const html = renderToStaticMarkup(createElement(SeznamOznameni, {
    rozsah: 'perla',
    zpravy: [O('k-potvrzeni', { requires_acknowledgment: true }), O('prectene')],
    prectene: ['prectene'],
    proMe: ['k-potvrzeni', 'prectene'],
    autori: {}, useky: {}, pozice: {}, pobocky: {}, naFiremniUrovni: false, muzePsat: false, nepotvrdili: {},
  }))
  ok('každé oznámení je karta .ds-plocha', (html.match(/class="ds-plocha pc-oznameni"/g) ?? []).length === 2)
  ok('nepotvrzené nese slovo „Čeká na vaše potvrzení“ a „Beru na vědomí“',
    html.includes('Čeká na vaše potvrzení') && html.includes('Beru na vědomí'))
  ok('přečtené: ikona a slovo, žádné „✓“', html.includes('Přečteno') && !html.includes('✓'))
  /*
    28. 9.: vlastní oznámení a oznámení pro cizí úsek (vedoucímu ho pustí
    RLS) na MĚ nečekají — bez štítku, bez tlačítka; „Nepotvrdili“ vedoucí
    vidí dál.
  */
  const ciziHtml = renderToStaticMarkup(createElement(SeznamOznameni, {
    rozsah: 'perla',
    zpravy: [O('moje-vlastni', { requires_acknowledgment: true, author_id: UZ }), O('pro-bar', { requires_acknowledgment: true, usek_id: 'bar' })],
    prectene: [],
    proMe: [],
    autori: {}, useky: { bar: 'Bar' }, pozice: {}, pobocky: {}, naFiremniUrovni: false, muzePsat: true,
    nepotvrdili: { 'moje-vlastni': ['Petra'] },
  }))
  ok('oznámení, které není pro mě: žádné „Čeká na vaše potvrzení“ ani „Beru na vědomí“',
    !ciziHtml.includes('Čeká na vaše potvrzení') && !ciziHtml.includes('Beru na vědomí') && !ciziHtml.includes('Potvrzeno'))
  ok('  vedoucí u vlastního dál vidí „Nepotvrdili: Petra“', ciziHtml.includes('Nepotvrdili: Petra'))
  const stranka = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/nastenka.tsx', 'utf8'))
  ok('  Nástěnka řadí a předává „pro mě“ podle čtenáře (seraditOznameni s ja, proMe)',
    stranka.includes('seraditOznameni(nactene, prectene, ja)') && stranka.includes('proMe={proMe}'))
  // Číslo u záložky a ve zvonečku: skutečná `neprectenaNastenka` nad
  // podstrčenou databází (vlastní, cizí úsek, pro mě, pro mě přečtené).
  {
    const { neprectenaNastenka } = await import(NASTENKA_DOTAZ)
    const { getServerSupabase } = await import(SERVER)
    svet({
      tabulka(q) {
        if (q.tabulka === 'announcements') {
          return { data: [
            O('vlastni', { author_id: UZ, requires_acknowledgment: true }),
            O('pro-bar', { usek_id: 'bar' }),
            O('pro-me', { requires_acknowledgment: true }),
            O('pro-me-prectene'),
            O('pro-kuchyni', { usek_id: 'kuchyne', branch_id: 'b1' }),
          ], error: null }
        }
        if (q.tabulka === 'employees') return { data: { id: 'e-ja', branch_id: 'b1', usek_id: 'kuchyne', position_id: null }, error: null }
        if (q.tabulka === 'announcement_reads') return { data: [{ announcement_id: 'pro-me-prectene' }], error: null }
        return { data: null, error: null }
      },
    })
    const n = await neprectenaNastenka(await getServerSupabase(), 't1', UZ, 'b1')
    ok(`  číslo Nástěnky počítá jen nová PRO MĚ (čekáno 2: pro-me, pro-kuchyni; je ${n})`, n === 2)
  }

  const prazdne = renderToStaticMarkup(createElement(SeznamOznameni, {
    rozsah: 'perla', zpravy: [], prectene: [], proMe: [], autori: {}, useky: {}, pozice: {}, pobocky: {},
    naFiremniUrovni: false, muzePsat: true, nepotvrdili: {},
  }))
  ok('prázdná Nástěnka vedení: „Napište první oznámení“', prazdne.includes('Napište první oznámení'))
  ok('Nástěnka kreslí seznam touto komponentou',
    bezKomentaru(readFileSync('app/[rozsah]/vzkazy/nastenka.tsx', 'utf8')).includes('<SeznamOznameni'))
}

console.log('\n== T8: Nastavení upozornění ==')

const ObsahNU = await nactKomponentuNU()
async function nactKomponentuNU() {
  return nactiKomponentu('app/[rozsah]/upozorneni/nastaveni/obsah.tsx', [
    ...SPOLECNE,
    ['./akce', js('export async function ulozitNastaveni() {}\nexport async function ulozitZarizeniPush() {}\nexport async function zrusitZarizeniPush() {}')],
    ['react-dom', import.meta.resolve('react-dom')],
  ])
}
{
  const html = renderToStaticMarkup(createElement(ObsahNU, {
    rozsah: 'perla', povoleno: { vzkazy: true, nastenka: false }, chyba: null, ulozeno: false, jeMajitel: false, verejnyKlic: null,
  }))
  ok('bez emoji 🔒 (zámek je ikona ze sdílené sady)', !html.includes('🔒') && html.includes('data-zamceno="1"'))
  ok('u zamčeného řádku pravdivá věta', html.includes('Změny vašich směn chodí vždy, nejdou vypnout'))
  ok('karta .ds-plocha s nadpisem', html.includes('class="ds-plocha"') && html.includes('Co chci dostávat'))
  // Pořadí atributů si volí React (CLAUDE.md: `readonly` se kvůli tomu
  // jednou netrefilo nikdy) — hledá se celý <input> a v něm `checked`.
  const policko = (jmeno) => html.match(new RegExp(`<input[^>]*name="${jmeno}"[^>]*>`))?.[0] ?? ''
  ok('stav přepínačů odpovídá databázi (nástěnka vypnutá)',
    policko('vzkazy').includes('checked=""') && policko('nastenka') !== '' && !policko('nastenka').includes('checked'))
  ok('stránka kreslí tuto komponentu',
    bezKomentaru(readFileSync('app/[rozsah]/upozorneni/nastaveni/page.tsx', 'utf8')).includes('<ObsahNastaveniUpozorneni'))
}

console.log('\n== T10: Úkoly a drobnosti ==')

{
  const ukoly = bezKomentaru(readFileSync('app/[rozsah]/ukoly/page.tsx', 'utf8'))
  ok('prázdný stav: úkoly POBOČKY, ne „nemáte“',
    ukoly.includes('Na této pobočce nejsou otevřené úkoly.') && !ukoly.includes('Nemáte žádné otevřené úkoly'))
  ok('ve formuláři už ne zastaralé „smí splnit jen on sám nebo vedoucí“',
    !ukoly.includes('smí splnit jen on sám') && ukoly.includes('Jméno u úkolu je štítek'))
  ok('„Zadat úkol“ i „Hotovo“ chráněné proti dvojkliku',
    /<TlacitkoOdeslat[^>]*>\s*Zadat úkol\s*<\/TlacitkoOdeslat>/.test(ukoly) && /<TlacitkoOdeslat[^>]*>\s*Hotovo\s*<\/TlacitkoOdeslat>/.test(ukoly))
  const vzkazy = bezKomentaru(readFileSync('app/[rozsah]/vzkazy/page.tsx', 'utf8'))
  ok('hledání rozhovorů má popisek pro čtečku', /<label htmlFor="pc-hledat-rozhovor"/.test(vzkazy) && vzkazy.includes('id="pc-hledat-rozhovor"'))
  ok('filtry nesou aria-current, ne aria-pressed', vzkazy.includes("aria-current={filtrAktivni === f.klic ? 'true' : undefined}") && !vzkazy.includes('aria-pressed'))
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO\n' : `\nCHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
