#!/usr/bin/env node
/**
 * Docházka → Můj účet a Výdělky → Po dnech (24. 9. 2026 večer).
 *
 * Pusť `node scripts/ucet.test.mjs` (Node 22.6+ s odstraňováním typů;
 * na starším `node --experimental-strip-types scripts/ucet.test.mjs`).
 *
 * ---------------------------------------------------------------------
 * CO SE TU OVĚŘUJE — VYKRESLENÍM, NE ČTENÍM ZDROJÁKU
 *
 *   1. Můj účet (ucet.tsx) se vykreslí se stub daty: „bez sazby“ místo
 *      „0 Kč“, průběžný zůstatek, záporný zůstatek slovy, stav záloh,
 *      přehledové karty, a co zmizí při „jen_ukazat“ a „neukazovat“
 *   2. Po dnech (po-dnech.tsx): buňky dnů, „bez sazby“, štítky, Celkem,
 *      nenasazená databáze
 *   3. Které záložky se kreslí (zalozky-prava.ts) s podstrčenou
 *      databází: Můj účet jen se zaměstnaneckým záznamem, a dotaz se
 *      ptá na SVŮJ záznam v TÉHLE firmě
 *   4. STRÁNKA Můj účet s podstrčeným serverem: ptá se na SVŮJ záznam,
 *      bez záznamu se databáze na účet nezeptá, funkce nedostane žádný
 *      parametr zaměstnance, měsíc z provozního dne (ne z hodin
 *      serveru), běžící × uzavřený měsíc, do budoucna se nechodí,
 *      volba firmy u prázdného měsíce z nastavení, nenasazeno se
 *      promine, jiná chyba ne
 *   Ve štítcích ani vysvětlivkách není, ČÍM se záloha potvrdila (PIN,
 *   telefon, majitel — od migrace zalohy_potvrzeni): řádek to nenese.
 *   5. Kontrakt s migrací: jména parametrů a sloupců obou funkcí se
 *      vezmou z 20260925130000 a řádek z nich projde až do buněk
 *
 * ---------------------------------------------------------------------
 * ČEHO SE TÍM NEDOSÁHNE
 *
 * Že databáze vrátí jen MŮJ účet a že součty sedí se mzdou, tohle
 * neověří — to hlídá supabase/tests/krok59_scenar.sql (a workflow
 * Databáze na opravdovém PostgreSQL). Vzhled (karty místo tabulky pod
 * 560 px obsahu, tmavý režim) taky ne; na to je snímek obrazovky.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)
const REACT = JSON.stringify(import.meta.resolve('react'))
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

/** Odkaz mimo Next: obyčejné <a>. */
const ODKAZ = js(
  `import { createElement } from ${REACT}\n` +
    'export default function Link({ href, children, ...z }) {\n' +
    '  return createElement("a", { href, ...z }, children)\n' +
    '}\n',
)

/** Text z HTML: bez značek, pevné mezery na obyčejné. */
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/—nic/g, '—')
    .replace(/\s+/g, ' ')
    .trim()

/** „0 Kč“ jako samostatná částka — ne konec „10 Kč“ ani „1 000 Kč“. */
const nulaKorun = (html) => /(?<![\d\s ])0[\s ]Kč/.test(html)

/** Buňky řádku dne (bez sloupce Den), jako text. */
function radek(html, den) {
  const m = html.match(new RegExp(`<tr[^>]*data-den="${den}"[^>]*>([\\s\\S]*?)</tr>`))
  if (!m) return null
  return [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]))
}

/** Hodnoty z karty dne na telefonu (dd), jako text. */
function karta(html, den) {
  const m = html.match(new RegExp(`<li[^>]*data-den="${den}"[^>]*>([\\s\\S]*?)</li>`))
  if (!m) return null
  return [...m[1].matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((x) => text(x[1]))
}

/** Záhlaví sloupců tabulky. */
const zahlavi = (html) =>
  [...(html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    text(m[1]),
  )

/** Přehledové karty: titulek → hodnota a popisy. */
function karty(html) {
  const ven = {}
  for (const a of html.matchAll(/<article class="ds-kpi">([\s\S]*?)<\/article>/g)) {
    const titulek = text((a[1].match(/<h2 class="ds-kpi-titulek">([\s\S]*?)<\/h2>/) ?? ['', ''])[1])
    const hodnota = text((a[1].match(/<p class="ds-kpi-hodnota[^"]*">([\s\S]*?)<\/p>/) ?? ['', ''])[1])
    const popisy = [...a[1].matchAll(/<p class="ds-kpi-popis"([^>]*)>([\s\S]*?)<\/p>/g)].map((p) => ({
      text: text(p[2]),
      spatne: p[1].includes('data-tone="bad"'),
    }))
    ven[titulek] = { hodnota, popisy }
  }
  return ven
}
const varovani = (k) => (k?.popisy ?? []).filter((p) => p.spatne).map((p) => p.text)

console.log('\n== Detektory samy umějí spadnout ==')
ma('„0 Kč“ pozná', nulaKorun('0 Kč'), true)
ma('„10 Kč“ za nulu nepovažuje', nulaKorun('10 Kč'), false)
ma('radek() najde řádek i s buňkou, která má třídu',
  JSON.stringify(radek('<tr data-den="x"><th>a</th><td>1</td><td class="c">2</td></tr>', 'x')), '["1","2"]')

/* ======================================================================
   1. MŮJ ÚČET — kreslicí část
   ====================================================================== */

const Ucet = await nactiKomponentu('app/[rozsah]/dochazka/ucet/ucet.tsx', [['next/link', ODKAZ]])

const den = (r) => ({
  odpracovano_minut: 0,
  hodinova_haleru: null,
  vydelano_haleru: null,
  sazba_chybi: false,
  zalohy_haleru: 0,
  zaloh: 0,
  zaloh_nepotvrzenych: 0,
  zustatek_haleru: 0,
  zustatek_neuplny: false,
  zobrazeni: 'odecitat',
  ...r,
})

// Tatáž čísla jako Zuzana v krok59 (bez dne 7. 5.): dvě zálohy v jeden
// den, den jen se zálohou, změna sazby.
const ZUZANA = [
  den({ den: '2026-05-04', odpracovano_minut: 480, hodinova_haleru: 20000, vydelano_haleru: 160000,
    zalohy_haleru: 70000, zaloh: 2, zaloh_nepotvrzenych: 1, zustatek_haleru: 90000 }),
  den({ den: '2026-05-05', odpracovano_minut: 270, hodinova_haleru: 20000, vydelano_haleru: 90000,
    zustatek_haleru: 180000 }),
  den({ den: '2026-05-10', zalohy_haleru: 30000, zaloh: 1, zaloh_nepotvrzenych: 1, zustatek_haleru: 150000 }),
  den({ den: '2026-05-20', odpracovano_minut: 360, hodinova_haleru: 26000, vydelano_haleru: 156000,
    zustatek_haleru: 306000 }),
]

// Tomáš: první den bez sazby, záloha ten den → zůstatek záporný.
const TOMAS = [
  den({ den: '2026-05-04', odpracovano_minut: 240, sazba_chybi: true, zalohy_haleru: 10000, zaloh: 1,
    zaloh_nepotvrzenych: 1, zustatek_haleru: -10000, zustatek_neuplny: true }),
  den({ den: '2026-05-21', odpracovano_minut: 120, hodinova_haleru: 15000, vydelano_haleru: 30000,
    zustatek_haleru: 20000, zustatek_neuplny: true }),
]

// Volbu firmy posílá stránka; s řádky je to jejich `zobrazeni`.
const ucet = (radky, obdobi = 'tento', zobrazeni = radky[0]?.zobrazeni ?? 'odecitat') =>
  renderToStaticMarkup(
    createElement(Ucet, {
      radky,
      zobrazeni,
      mesic: '2026-05-01',
      obdobi,
      predchozi: { href: '/cerna-perla/dochazka/ucet?mesic=2026-04', mesic: '2026-04-01' },
      nasledujici: obdobi === 'tento' ? null : { href: '/cerna-perla/dochazka/ucet?mesic=2026-06', mesic: '2026-06-01' },
    }),
  )

console.log('\n== Můj účet: dny ==')
const hZ = ucet(ZUZANA)
ma('sloupce: Den · Odpracováno · Výdělek · Zálohy · Zůstatek', zahlavi(hZ).join(' · '),
  'Den · Odpracováno · Výdělek · Zálohy · Zůstatek')
ma('4. 5.: hodiny, výdělek se sazbou, dvě zálohy (jedna čeká), zůstatek',
  JSON.stringify(radek(hZ, '2026-05-04')), JSON.stringify(['8 h 0 min', '1 600 Kč200 Kč/h', '700 Kč1 nepotvrzená', '900 Kč']))
ma('den jen se zálohou: hodiny a výdělek pomlčka, ne nula',
  JSON.stringify(radek(hZ, '2026-05-10')), JSON.stringify(['—', '—', '300 Kčnepotvrzená', '1 500 Kč']))
ma('20. 5.: nová sazba ke dni', JSON.stringify(radek(hZ, '2026-05-20')),
  JSON.stringify(['6 h 0 min', '1 560 Kč260 Kč/h', '—', '3 060 Kč']))
ma('den je popsaný zkratkou dne v týdnu', /<th scope="row">po 4\. 5\.<\/th>/.test(hZ), true)
ma('telefon: karta dne říká totéž co tabulka', JSON.stringify(karta(hZ, '2026-05-04')), JSON.stringify(radek(hZ, '2026-05-04')))
ma('potvrzená záloha má slovo „potvrzená“ — ne čím (PIN, telefon, majitel)',
  radek(ucet([den({ den: '2026-05-02', zalohy_haleru: 5000, zaloh: 1, zustatek_haleru: -5000 })]), '2026-05-02')?.[2],
  '50 Kčpotvrzená')
/*
  Od 25. 9. 2026 se záloha potvrzuje PINem na tabletu, v telefonu, nebo
  za zaměstnance majitelem (migrace zalohy_potvrzeni). Řádek účtu způsob nenese,
  takže účet nesmí tvrdit žádný — ani ve štítcích, ani ve vysvětlivkách.
*/
ma('účet o způsobu potvrzení nic netvrdí (nikde „PIN“)', /PIN/.test(text(hZ)), false)

console.log('\n== Můj účet: přehledové karty ==')
const kZ = karty(hZ)
ma('tři karty (odecitat)', Object.keys(kZ).join(' | '), 'Vyděláno do dneška | Zálohy | Zbývá k výplatě')
ma('vyděláno = součet dnů', kZ['Vyděláno do dneška']?.hodnota, '4 060 Kč')
ma('… z hodin', kZ['Vyděláno do dneška']?.popisy[0]?.text, '18 h 30 min uzavřené docházky')
ma('… hrubá mzda, orientačně', kZ['Vyděláno do dneška']?.popisy[1]?.text, 'hrubá mzda, orientačně')
ma('zálohy = součet', kZ['Zálohy']?.hodnota, '1 000 Kč')
ma('… a kolik čeká na potvrzení', kZ['Zálohy']?.popisy.map((p) => p.text).join(' / '), '3 zálohy / 2 čekají na potvrzení')
ma('zbývá = zůstatek posledního dne', kZ['Zbývá k výplatě']?.hodnota, '3 060 Kč')
ma('minulý měsíc: „Vyděláno za měsíc“', 'Vyděláno za měsíc' in karty(ucet(ZUZANA, 'minuly')), true)

console.log('\n== Bez sazby: „bez sazby“, nikdy „0 Kč“ ==')
const hT = ucet(TOMAS)
ma('den bez sazby: výdělek „bez sazby“',
  JSON.stringify(radek(hT, '2026-05-04')), JSON.stringify(['4 h 0 min', 'bez sazby', '100 Kčnepotvrzená', 'zálohy napřed 100 Kččást bez sazby']))
ma('v řádku bez sazby není „0 Kč“', nulaKorun(hT.match(/<tr[^>]*data-den="2026-05-04"[\s\S]*?<\/tr>/)?.[0] ?? '0 Kč'), false)
ma('záporný zůstatek slovy, ne „-100 Kč“', /-100|−100/.test(text(hT)), false)
ma('další den: zůstatek se štítkem „část bez sazby“',
  JSON.stringify(radek(hT, '2026-05-21')), JSON.stringify(['2 h 0 min', '300 Kč150 Kč/h', '—', '200 Kččást bez sazby']))
const kT = karty(hT)
ma('karta vyděláno: částka se sazbou a varování', `${kT['Vyděláno do dneška']?.hodnota} | ${varovani(kT['Vyděláno do dneška'])}`,
  '300 Kč | 1 den bez sazby — v součtu chybí')
ma('karta zbývá: varování, že skutečně zbývá víc', varovani(kT['Zbývá k výplatě']).join(' / '), 'část dnů bez sazby — skutečně zbývá víc')
const kJenBez = karty(ucet([TOMAS[0]]))
ma('jen dny bez sazby: vyděláno „bez sazby“', kJenBez['Vyděláno do dneška']?.hodnota, 'bez sazby')
ma('… i zbývá „bez sazby“', kJenBez['Zbývá k výplatě']?.hodnota, 'bez sazby')
ma('… a v celém účtu není „0 Kč“', nulaKorun(ucet([TOMAS[0]])), false)

console.log('\n== Zálohy předběhly výdělek ==')
const PREDBEHL = [
  den({ den: '2026-05-02', odpracovano_minut: 60, hodinova_haleru: 20000, vydelano_haleru: 20000, zustatek_haleru: 20000 }),
  den({ den: '2026-05-03', zalohy_haleru: 70000, zaloh: 1, zustatek_haleru: -50000 }),
]
const kP = karty(ucet(PREDBEHL))
ma('zbývá 0 Kč, ne záporné číslo', kP['Zbývá k výplatě']?.hodnota, '0 Kč')
ma('… a varování, o kolik', varovani(kP['Zbývá k výplatě']).join(' / '), 'zálohy předběhly výdělek o 500 Kč')
ma('den: „zálohy napřed 500 Kč“', radek(ucet(PREDBEHL), '2026-05-03')?.[3], 'zálohy napřed 500 Kč')
const kHaler = karty(ucet([den({ den: '2026-05-03', zalohy_haleru: 40, zaloh: 1, zustatek_haleru: -40 })]))
ma('přesah pod 50 haléřů: žádné „předběhly o 0 Kč“', varovani(kHaler['Zbývá k výplatě']).length, 0)

console.log('\n== Volba firmy: jen_ukazat a neukazovat ==')
const JEN = ZUZANA.map((r) => ({ ...r, zobrazeni: 'jen_ukazat', zustatek_haleru: null }))
const hJen = ucet(JEN)
ma('jen_ukazat: bez sloupce Zůstatek', zahlavi(hJen).join(' · '), 'Den · Odpracováno · Výdělek · Zálohy')
ma('… bez karty Zbývá', Object.keys(karty(hJen)).join(' | '), 'Vyděláno do dneška | Zálohy')
ma('… a řekne proč', text(hJen).includes('Zálohy se tu od výdělku neodečítají — tak to firma nastavila.'), true)
ma('… a „zbývá“ nikde', /zbývá/i.test(text(hJen).replace('Zálohy se tu od výdělku neodečítají', '')), false)
const NIC = ZUZANA.filter((r) => r.hodinova_haleru !== null).map((r) => ({
  ...r, zobrazeni: 'neukazovat', zalohy_haleru: null, zaloh: null, zaloh_nepotvrzenych: null, zustatek_haleru: null,
}))
const hNic = ucet(NIC)
ma('neukazovat: jen Den · Odpracováno · Výdělek', zahlavi(hNic).join(' · '), 'Den · Odpracováno · Výdělek')
ma('… jen karta Vyděláno', Object.keys(karty(hNic)).join(' | '), 'Vyděláno do dneška')
ma('… o zálohách jen věta, že je firma neukazuje', text(hNic).includes('Zálohy tu firma neukazuje'), true)
ma('… žádná částka zálohy v řádcích', JSON.stringify(radek(hNic, '2026-05-04')), JSON.stringify(['8 h 0 min', '1 600 Kč200 Kč/h']))

console.log('\n== Prázdný měsíc ==')
const prazdny = ucet([])
ma('věta, ne tabulka', prazdny.includes('<table'), false)
ma('žádné karty s nulou', prazdny.includes('ds-kpi'), false)
ma('běžící měsíc: kdo je v práci, přičte se po odchodu', text(prazdny).includes('přičte se po odchodu'), true)
ma('odecitat: „ani záloha“ a vysvětlivka o zůstatku',
  `${text(prazdny).includes('žádná uzavřená docházka ani záloha')} / ${text(prazdny).includes('Zůstatek je výdělek')}`, 'true / true')
// Při „neukazovat“ databáze vynechá dny jen se zálohou — prázdný měsíc
// může mít zálohu, jen schovanou. Volba přijde od stránky, ne z řádků.
const prazdnyNic = text(ucet([], 'tento', 'neukazovat'))
ma('neukazovat, prázdný měsíc: o zálohách nic netvrdí („ani záloha“ ne)', prazdnyNic.includes('ani záloha'), false)
ma('… jen věta, že je firma neukazuje', prazdnyNic.includes('Zálohy tu firma neukazuje'), true)
ma('… a nic o zůstatku ani o tom, co zálohy jsou',
  /Zůstatek je výdělek|nestornované zálohy/.test(prazdnyNic), false)

console.log('\n== Vysvětlivky ==')
ma('hrubá mzda', hZ.includes('<strong>hrubá mzda</strong>'), true)
ma('provozní den: noc patří ke dni, kdy směna začala', text(hZ).includes('Noc po půlnoci patří do provozního dne'), true)
ma('šipka dopředu v běžícím měsíci není', /Následující měsíc/.test(hZ), false)
ma('v minulém je', /Následující měsíc: červen 2026/.test(ucet(ZUZANA, 'minuly')), true)

/* ======================================================================
   2. VÝDĚLKY → PO DNECH
   ====================================================================== */

const PoDnech = await nactiKomponentu('app/[rozsah]/dochazka/vydelky/po-dnech.tsx', [['next/link', ODKAZ]])
const DNY = [
  { den: '2026-05-04', lidi: 3, odpracovano_minut: 1020, mzdy_haleru: 250000, bez_sazby_lidi: 1,
    zalohy_haleru: 100000, zaloh: 4, zaloh_nepotvrzenych: 3 },
  { den: '2026-05-10', lidi: 0, odpracovano_minut: 0, mzdy_haleru: null, bez_sazby_lidi: 0,
    zalohy_haleru: 30000, zaloh: 1, zaloh_nepotvrzenych: 1 },
  { den: '2026-05-12', lidi: 1, odpracovano_minut: 1, mzdy_haleru: 167, bez_sazby_lidi: 0,
    zalohy_haleru: 0, zaloh: 0, zaloh_nepotvrzenych: 0 },
  { den: '2026-05-30', lidi: 1, odpracovano_minut: 240, mzdy_haleru: null, bez_sazby_lidi: 1,
    zalohy_haleru: 0, zaloh: 0, zaloh_nepotvrzenych: 0 },
]
const poDnech = (radky) => renderToStaticMarkup(createElement(PoDnech, { radky, mesic: '2026-05-01' }))
const hD = poDnech(DNY)

console.log('\n== Po dnech ==')
ma('sloupce', zahlavi(hD).join(' · '), 'Den · Lidé · Odpracováno · Mzdy (hrubě) · Zálohy')
ma('4. 5.: lidé, hodiny, mzdy se štítkem bez sazby, zálohy s čekajícími',
  JSON.stringify(radek(hD, '2026-05-04')), JSON.stringify(['3 lidé', '17 h 0 min', '2 500 Kč+ 1 člověk bez sazby', '1 000 Kč3 nepotvrzené']))
ma('den jen se zálohou: pomlčky, ne nuly',
  JSON.stringify(radek(hD, '2026-05-10')), JSON.stringify(['—', '—', '—', '300 Kč1 nepotvrzená']))
ma('den jen s lidmi bez sazby: „bez sazby“, ne „0 Kč“',
  JSON.stringify(radek(hD, '2026-05-30')), JSON.stringify(['1 člověk', '4 h 0 min', 'bez sazby', '—']))
ma('haléře: 167 haléřů jsou 2 Kč', radek(hD, '2026-05-12')?.[2], '2 Kč')
ma('Celkem: lidé se nesčítají, minuty, mzdy dnů se sazbou, zálohy',
  JSON.stringify(radek(hD, 'celkem')), JSON.stringify(['—', '21 h 1 min', '2 502 Kččást bez sazby', '1 300 Kč4 nepotvrzené']))
ma('Celkem je v patičce tabulky', /<tfoot>\s*<tr data-den="celkem">/.test(hD), true)
ma('telefon: karta dne = řádek tabulky', JSON.stringify(karta(hD, '2026-05-04')), JSON.stringify(radek(hD, '2026-05-04')))
ma('telefon: i Celkem', JSON.stringify(karta(hD, 'celkem')), JSON.stringify(radek(hD, 'celkem')))
ma('nikde „0 Kč“', nulaKorun(hD), false)
ma('o způsobu potvrzení nic netvrdí (nikde „PIN“)', /PIN/.test(text(hD)), false)
ma('pět a víc: „5 nepotvrzených“',
  radek(poDnech([{ ...DNY[1], zalohy_haleru: 60000, zaloh: 6, zaloh_nepotvrzenych: 5 }]), '2026-05-10')?.[3],
  '600 Kč5 nepotvrzených')
ma('jen dny bez sazby: Celkem „bez sazby“', radek(poDnech([DNY[3]]), 'celkem')?.[2], 'bez sazby')
ma('nenasazeno: věta, ne tabulka', text(poDnech(null)).includes('Přehled po dnech bude dostupný po nasazení databáze.'), true)
ma('prázdný měsíc: věta', text(poDnech([])).includes('Za květen zatím žádná uzavřená docházka ani záloha.'), true)
ma('prázdný měsíc: žádná tabulka', poDnech([]).includes('<table'), false)

/* ======================================================================
   3. ZÁLOŽKY — Můj účet jen se zaměstnaneckým záznamem
   ====================================================================== */

/** Dotaz na tabulku: zapíše si řetěz a na konci vrátí výsledek. */
const DOTAZ_TABULKY = js(
  'export function dotaz(tabulka) {\n' +
    '  const zapis = [["from", tabulka]]; globalThis.__db.dotazy.push(zapis);\n' +
    '  const o = {\n' +
    '    select: (s) => (zapis.push(["select", s]), o),\n' +
    '    eq: (k, v) => (zapis.push(["eq", k, v]), o),\n' +
    '    is: (k, v) => (zapis.push(["is", k, v]), o),\n' +
    '    limit: async (n) => (zapis.push(["limit", n]), globalThis.__db.tabulka(tabulka, zapis)),\n' +
    '    maybeSingle: async () => (zapis.push(["maybeSingle"]), globalThis.__db.tabulka(tabulka, zapis)),\n' +
    '  };\n' +
    '  return o;\n' +
    '}\n',
)
const SERVER = js(
  `import { dotaz } from ${JSON.stringify(DOTAZ_TABULKY)};\n` +
    'export async function getServerSupabase() {\n' +
    '  return {\n' +
    '    from: dotaz,\n' +
    '    rpc: async (jmeno, args) => (globalThis.__db.rpc.push([jmeno, args]), globalThis.__db.odpoved(jmeno)),\n' +
    '  };\n' +
    '}\n',
)
const AUTHZ = js(
  'export async function getUser() { return globalThis.__db.user }\n' +
    'export async function getContext() { return globalThis.__db.ctx }\n' +
    'export async function hasAccess(t, pravo, pobocka) { return globalThis.__db.pravo(pravo, pobocka) }\n',
)

function db(n = {}) {
  globalThis.__db = {
    user: { id: 'u1' },
    ctx: { branches: [{ id: 'B1', name: 'Černá Perla' }, { id: 'B2', name: 'Bernard' }] },
    pravo: () => false,
    zaznam: [{ id: 'e1', branch_id: 'B1' }],
    chybaZaznamu: null,
    // Řádek tenant_settings; null = firma nastavení nemá (výchozí).
    nastaveni: null,
    chybaNastaveni: null,
    odpoved: () => ({ data: ZUZANA, error: null }),
    dotazy: [],
    rpc: [],
    volani: [],
    ...n,
  }
  const d = globalThis.__db
  globalThis.__db.tabulka = (t) =>
    t === 'employees'
      ? { data: d.chybaZaznamu ? null : d.zaznam, error: d.chybaZaznamu }
      : t === 'tenant_settings'
        ? { data: d.chybaNastaveni ? null : d.nastaveni, error: d.chybaNastaveni }
        : { data: null, error: { message: 'neznámá tabulka ' + t } }
}
/** Zapsané dotazy na tabulku (řetěz from/select/eq/…), jako JSON. */
const dotazyNa = (tabulka, dotazy = globalThis.__db.dotazy) =>
  dotazy.filter((z) => z[0]?.[1] === tabulka).map((z) => JSON.stringify(z))
db()

const pravaZalozek = await nactiModul('app/[rozsah]/dochazka/zalozky-prava.ts', [
  ['@/lib/authz', AUTHZ],
  ['@/lib/supabase/server', SERVER],
])

console.log('\n== Záložky: Můj účet ==')
ma('číšník se záznamem: Docházka a Můj účet', (await pravaZalozek.default('t1', 'B1')).join(','), 'dochazka,ucet')
const dotazZaznamu = JSON.stringify(globalThis.__db.dotazy[0])
ma('ptá se na SVŮJ záznam v TÉHLE firmě, nesmazaný',
  ['["from","employees"]', '["eq","tenant_id","t1"]', '["eq","user_id","u1"]', '["is","deleted_at",null]'].every((k) =>
    dotazZaznamu.includes(k)), true)
db({ zaznam: [] })
ma('bez záznamu: jen Docházka (lišta se pak nekreslí)', (await pravaZalozek.default('t1', 'B1')).join(','), 'dochazka')
db({ chybaZaznamu: { message: 'spojení spadlo' } })
ma('chyba dotazu: Můj účet se nekreslí (při nejistotě ne)', (await pravaZalozek.default('t1', 'B1')).join(','), 'dochazka')
db({ user: null })
ma('nepřihlášený: bez účtu a databáze se ani nezeptá',
  `${(await pravaZalozek.default('t1', 'B1')).join(',')} / ${globalThis.__db.dotazy.length}`, 'dochazka / 0')
db({ pravo: () => true })
ma('majitel se záznamem: všechny čtyři v pořadí', (await pravaZalozek.default('t1', null)).join(','), 'dochazka,ucet,vydelky,zalohy')

const Zalozky = await nactiKomponentu('app/[rozsah]/dochazka/zalozky.tsx', [['next/link', ODKAZ]])
const lista = (viditelne, aktivni = 'ucet', mesic = null) =>
  renderToStaticMarkup(createElement(Zalozky, { rozsah: 'cerna-perla', aktivni, viditelne, mesic }))
const odkazy = (h) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
ma('pořadí Docházka · Můj účet · Výdělky · Zálohy a měsíc i do Můj účet',
  odkazy(lista(['dochazka', 'ucet', 'vydelky', 'zalohy'], 'ucet', '2026-05')).join(' '),
  '/cerna-perla/dochazka?mesic=2026-05 /cerna-perla/dochazka/ucet?mesic=2026-05 /cerna-perla/dochazka/vydelky?mesic=2026-05 /cerna-perla/dochazka/zalohy')
ma('Můj účet je aktivní', /href="\/cerna-perla\/dochazka\/ucet" aria-current="page"/.test(lista(['dochazka', 'ucet'])), true)
ma('popisek „Můj účet“', text(lista(['dochazka', 'ucet'])).includes('Můj účet'), true)

/* ======================================================================
   4. STRÁNKA MŮJ ÚČET
   ====================================================================== */

const NAVIGACE = js(
  'export function redirect(adresa) { throw Object.assign(new Error("NEXT_REDIRECT"), { adresa }) }\n' +
    'export function notFound() { throw new Error("NEXT_NOT_FOUND") }\n',
)
const FIRMA = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export function bezpecnyRozsah(ctx, rozsah) {\n' +
    '  globalThis.__db.volani.push(["rozsah", rozsah]);\n' +
    '  if (rozsah === "firma") return { level: "tenant", branchId: null, branchName: "Foodtab", branchSlug: "firma" };\n' +
    '  if (rozsah === "cerna-perla") return { level: "branch", branchId: "B1", branchName: "Černá Perla", branchSlug: "cerna-perla" };\n' +
    '  return null;\n' +
    '}\n',
)
const PROVOZNI_DEN = js(
  'export async function provozniDen(pobocka) {\n' +
    '  globalThis.__db.volani.push(["provozniDen", pobocka]);\n' +
    '  return "den" in globalThis.__db ? globalThis.__db.den : "2026-05-24";\n' +
    '}\n',
)
const DOTAZ = js(
  'export class DotazSelhal extends Error { constructor(p, c) { super("Dotaz " + p + " selhal: " + c.message) } }\n' +
    'export function funkceNeexistuje(c) { return c?.code === "PGRST202" || c?.code === "42883" }\n',
)
const PRAVA_ZALOZEK = js(
  'export default async function zalozkyDochazky(t, pobocka) {\n' +
    '  globalThis.__db.volani.push(["zalozky", pobocka]);\n' +
    '  return ["dochazka", "ucet"];\n' +
    '}\n',
)

const Stranka = await nactiKomponentu('app/[rozsah]/dochazka/ucet/page.tsx', [
  ['next/navigation', NAVIGACE],
  ['next/link', ODKAZ],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SERVER],
  ['../zalozky-prava', PRAVA_ZALOZEK],
])

async function stranka({ rozsah = 'cerna-perla', mesic, ...n } = {}) {
  db(n)
  let html = ''
  let chyba = null
  try {
    html = renderToStaticMarkup(
      await Stranka({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(mesic ? { mesic } : {}) }),
    )
  } catch (e) {
    chyba = e
  }
  return { html, chyba, rpc: globalThis.__db.rpc, volani: globalThis.__db.volani, dotazy: globalThis.__db.dotazy }
}

console.log('\n== Stránka Můj účet: kdo ==')
const nepr = await stranka({ user: null })
ma('nepřihlášený → přihlášení', nepr.chyba?.adresa, '/prihlaseni')
const bezZ = await stranka({ zaznam: [] })
ma('bez zaměstnaneckého záznamu: vysvětlení', text(bezZ.html).includes('Zatím nemáte zaměstnanecký záznam.'), true)
ma('… a na účet se databáze VŮBEC nezeptá', bezZ.rpc.length, 0)
const cizi = await stranka({ rozsah: 'cizi-pobocka' })
ma('cizí rozsah z adresy: „Sem nemáte přístup“ a žádný dotaz',
  `${text(cizi.html).includes('Sem nemáte přístup')} / ${cizi.rpc.length}`, 'true / 0')

console.log('\n== Stránka Můj účet: co se ptá databáze ==')
const s = await stranka()
ma('volá muj_pracovni_ucet', s.rpc[0]?.[0], 'muj_pracovni_ucet')
ma('jen firma a měsíc — ŽÁDNÝ parametr zaměstnance', JSON.stringify(s.rpc[0]?.[1]), JSON.stringify({ p_tenant: 't1', p_mesic: '2026-05-01' }))
ma('tabulka dnů je na stránce', JSON.stringify(radek(s.html, '2026-05-04')),
  JSON.stringify(['8 h 0 min', '1 600 Kč200 Kč/h', '700 Kč1 nepotvrzená', '900 Kč']))
ma('jeden nadpis „Docházka“', (s.html.match(/<h1>/g) ?? []).length === 1 && s.html.includes('<h1>Docházka</h1>'), true)
ma('záložky dostaly pobočku z rozsahu', JSON.stringify(s.volani.find((v) => v[0] === 'zalozky')), '["zalozky","B1"]')
/*
  Stránka se na záznam ptá SAMA (záložky jsou tu podstrčené). Podstrčená
  databáze vrací záznam bez ohledu na filtry, takže bez téhle kontroly by
  prošla i stránka, která se ptá na kohokoli: vedoucí bez vlastního
  záznamu by pak místo vysvětlení dostal prázdný účet a kotvu provozního
  dne z cizí pobočky. Nejdřív se ověří, že dotaz na employees je právě
  jeden — prázdný výběr by jinak prošel „všemi“ podmínkami.
*/
const zaznamStranky = dotazyNa('employees', s.dotazy)
ma('stránka se ptá na SVŮJ záznam v TÉHLE firmě, nesmazaný (jeden dotaz)',
  `${zaznamStranky.length} / ${['["eq","tenant_id","t1"]', '["eq","user_id","u1"]', '["is","deleted_at",null]']
    .every((k) => zaznamStranky[0]?.includes(k))}`, '1 / true')

console.log('\n== Stránka Můj účet: měsíc z provozního dne, ne z hodin serveru ==')
// Provozní den je schválně jiný měsíc, než jaký ukazují hodiny počítače.
const rijen = await stranka({ den: '2026-10-01' })
ma('provozní den 1. 10. → říjen', rijen.rpc[0]?.[1]?.p_mesic, '2026-10-01')
ma('provozní den pobočky z adresy', JSON.stringify(rijen.volani.find((v) => v[0] === 'provozniDen')), '["provozniDen","B1"]')
const firmaSPob = await stranka({ rozsah: 'firma', zaznam: [{ id: 'e1', branch_id: 'B2' }] })
ma('/firma: kotva je domovská pobočka člověka', JSON.stringify(firmaSPob.volani.find((v) => v[0] === 'provozniDen')), '["provozniDen","B2"]')
const majitel = await stranka({ rozsah: 'firma', zaznam: [{ id: 'e0', branch_id: null }] })
ma('majitel bez pobočky na /firma: první pobočka firmy', JSON.stringify(majitel.volani.find((v) => v[0] === 'provozniDen')), '["provozniDen","B1"]')
ma('… a účet dostane', majitel.rpc[0]?.[0], 'muj_pracovni_ucet')
const srpen = await stranka({ mesic: '2026-04' })
ma('?mesic=2026-04 → duben', srpen.rpc[0]?.[1]?.p_mesic, '2026-04-01')
ma('… a šipka dopředu vede na květen', /href="\/cerna-perla\/dochazka\/ucet\?mesic=2026-05"/.test(srpen.html), true)
ma('… uzavřený měsíc: „uzavřený měsíc“ a karta „Vyděláno za měsíc“',
  `${text(srpen.html).includes('uzavřený měsíc')} / ${Object.keys(karty(srpen.html))[0]}`, 'true / Vyděláno za měsíc')
ma('běžící měsíc: „běžící měsíc — do dneška“ a karta „Vyděláno do dneška“',
  `${text(s.html).includes('běžící měsíc — do dneška')} / ${Object.keys(karty(s.html))[0]}`, 'true / Vyděláno do dneška')
ma('v běžícím měsíci šipka dopředu není', /Následující měsíc/.test(s.html), false)
ma('budoucí měsíc z adresy → běžící', (await stranka({ mesic: '2026-12' })).rpc[0]?.[1]?.p_mesic, '2026-05-01')
ma('nesmysl z adresy → běžící', (await stranka({ mesic: '2026-13' })).rpc[0]?.[1]?.p_mesic, '2026-05-01')
ma('přes Silvestra dozadu', /mesic=2025-12/.test((await stranka({ mesic: '2026-01' })).html), true)
// provozniDen vrátí null → věta, ne měsíc z hodin serveru.
const bezDne = await stranka({ den: null })
ma('bez provozního dne: věta a žádný dotaz na účet',
  `${text(bezDne.html).includes('Nepodařilo se zjistit provozní den.')} / ${bezDne.rpc.length}`, 'true / 0')

console.log('\n== Stránka Můj účet: nenasazená databáze ==')
const nenasazeno = await stranka({ odpoved: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) })
ma('věta o nasazení', text(nenasazeno.html).includes('Pracovní účet bude dostupný po nasazení databáze.'), true)
ma('a nic nespadlo', nenasazeno.chyba, null)
const porucha = await stranka({ odpoved: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) })
ma('jiná chyba se NEZAMETE — spadne', porucha.chyba instanceof Error && !porucha.chyba.adresa, true)
const zaznamSpadl = await stranka({ chybaZaznamu: { message: 'spojení spadlo' } })
ma('chyba dotazu na záznam se NEZAMETE — spadne', zaznamSpadl.chyba instanceof Error, true)

console.log('\n== Stránka Můj účet: volba firmy, když řádky nejsou ==')
/*
  Při „neukazovat“ databáze vynechá dny jen se zálohou. Kdo měl v měsíci
  jen zálohu, dostane nula řádků — a z nich se volba firmy nepozná.
*/
const prazdne = () => ({ data: [], error: null })
const bezRadkuNic = await stranka({ odpoved: prazdne, nastaveni: { zalohy_zobrazeni: 'neukazovat' } })
const dotazNastaveni = dotazyNa('tenant_settings', bezRadkuNic.dotazy)
ma('prázdný měsíc: volbu si stránka přečte z nastavení TÉHLE firmy (jeden dotaz)',
  `${dotazNastaveni.length} / ${['["select","zalohy_zobrazeni"]', '["eq","tenant_id","t1"]'].every((k) => dotazNastaveni[0]?.includes(k))}`,
  '1 / true')
ma('… a při „neukazovat“ o zálohách nic netvrdí',
  `${text(bezRadkuNic.html).includes('ani záloha')} / ${text(bezRadkuNic.html).includes('Zálohy tu firma neukazuje')}`,
  'false / true')
const bezRadkuVychozi = await stranka({ odpoved: prazdne, nastaveni: null })
ma('firma bez řádku nastavení: výchozí „odecitat“ („ani záloha“)',
  text(bezRadkuVychozi.html).includes('žádná uzavřená docházka ani záloha'), true)
const nastaveniSpadlo = await stranka({ odpoved: prazdne, chybaNastaveni: { message: 'spojení spadlo' } })
ma('chyba dotazu na nastavení se NEZAMETE — spadne', nastaveniSpadlo.chyba instanceof Error, true)
const sRadkyNic = await stranka({ odpoved: () => ({ data: NIC, error: null }), nastaveni: { zalohy_zobrazeni: 'odecitat' } })
ma('s řádky platí volba, kterou databáze uplatnila (z řádků)', zahlavi(sRadkyNic.html).join(' · '), 'Den · Odpracováno · Výdělek')

/* ======================================================================
   5. KONTRAKT S MIGRACÍ
   ====================================================================== */

console.log('\n== Kontrakt s migrací ==')
/*
  Aplikace a databáze se domlouvají jen jmény. Překlep ve jméně sloupce
  by tsc nechytil (řádek z RPC je Record<string, unknown>) a stránka by
  tiše ukázala pomlčku. Jména se proto vezmou přímo z migrace; scénář
  krok59 hlídá tutéž hlavičku z druhé strany (pg_get_function_result).
*/
const migrace = fs.readFileSync(new URL('supabase/migrations/20260925130000_ucet_a_naklady.sql', KOREN), 'utf8')
const hlavicka = (fn) =>
  migrace.match(new RegExp(`create or replace function public\\.${fn}\\(([^)]*)\\)\\s*returns table \\(([^)]*)\\)`))
const jmena = (seznam) => (seznam ?? '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)
const serazeno = (pole) => [...pole].sort().join(',')

const hU = hlavicka('muj_pracovni_ucet')
const PAR_U = jmena(hU?.[1])
const SL_U = jmena(hU?.[2])
ma('muj_pracovni_ucet: z migrace 2 parametry a 11 sloupců', `${PAR_U.length}/${SL_U.length}`, '2/11')
ma('stránka posílá právě parametry funkce', serazeno(Object.keys(s.rpc[0]?.[1] ?? {})), serazeno(PAR_U))
ma('podstrčené řádky účtu mají právě sloupce funkce', serazeno(Object.keys(ZUZANA[0])), serazeno(SL_U))

// Každý sloupec jiná hodnota — záměna dvou sloupců by se prozradila.
const HODNOTY_U = {
  den: '2026-05-07', odpracovano_minut: 61, hodinova_haleru: 12300, vydelano_haleru: 12500, sazba_chybi: false,
  zalohy_haleru: 22200, zaloh: 3, zaloh_nepotvrzenych: 2, zustatek_haleru: 44400, zustatek_neuplny: true,
  zobrazeni: 'odecitat',
}
const zDb = Object.fromEntries(SL_U.map((x) => [x, HODNOTY_U[x]]))
const kontrakt = await stranka({ odpoved: () => ({ data: [zDb], error: null }) })
ma('řádek z databáze dojde do buněk celý (odpracováno · výdělek + sazba · zálohy + stav · zůstatek + štítek)',
  JSON.stringify(radek(kontrakt.html, '2026-05-07')),
  JSON.stringify(['1 h 1 min', '125 Kč123 Kč/h', '222 Kč2 nepotvrzené', '444 Kččást bez sazby']))

const hD2 = hlavicka('vydelky_po_dnech')
const PAR_D = jmena(hD2?.[1])
const SL_D = jmena(hD2?.[2])
ma('vydelky_po_dnech: 3 parametry (jako vydelky_prehled) a 8 sloupců', `${PAR_D.join(',')}/${SL_D.length}`, 'p_tenant,p_branch,p_mesic/8')
ma('podstrčené dny mají právě sloupce funkce', serazeno(Object.keys(DNY[0])), serazeno(SL_D))

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
