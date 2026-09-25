#!/usr/bin/env node
/**
 * Docházka → Výdělky a Zálohy jako záložky (24. 9. 2026).
 *
 * Pusť `node scripts/vydelky.test.mjs` (Node 22.6+ s odstraňováním typů;
 * na starším `node --experimental-strip-types scripts/vydelky.test.mjs`).
 *
 * ---------------------------------------------------------------------
 * CO SE TU OVĚŘUJE — A PROČ VYKRESLENÍM, NE ČTENÍM ZDROJÁKU
 *
 * Kontrola, která hledá v souboru řetězec, projde i nad kódem, který ho
 * obsahuje v komentáři nebo ve větvi, kam se nikdy nedojde. Proto se tu
 * skoro všechno SPOUŠTÍ:
 *
 *   1. tabulka výdělků se vykreslí se stub daty (`nactiKomponentu`) —
 *      „bez sazby“ místo „0 Kč“, „přeplaceno“, jeden tvar hodin
 *   2. lišta záložek se vykreslí s různými seznamy viditelných záložek
 *   3. výpočet viditelných záložek (`zalozky-prava.ts`) se pustí proti
 *      podstrčenému `hasAccess` — bez payroll.read žádné Výdělky
 *   4. STRÁNKA Výdělky se vykreslí s podstrčenou databází: bez
 *      payroll.read se databáze vůbec nezeptá, rozsah z adresy dojde až
 *      do kontroly i do dotazu, výchozí měsíc je z provozního dne
 *   5. nabídka se načte a projde: položka Zálohy v ní není
 *   6. přesměrování /zalohy se vezme z next.config.ts a zkusí se
 *   7. serverové akce záloh se pustí a zapíše se, kam přesměrují
 *
 * ---------------------------------------------------------------------
 * ČEHO SE TÍM NEDOSÁHNE
 *
 * Že databáze bez payroll.read nevrátí ani řádek, tohle neověří — to je
 * druhá linie a hlídá ji scénář v supabase/tests (a workflow Databáze
 * na opravdovém PostgreSQL, PGlite běží jako superuživatel). Vzhled
 * (karty místo tabulky pod 820 px obsahu, tmavý režim) taky ne; na to
 * je snímek obrazovky.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { nactiKomponentu } from './vykreslit.mjs'

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
    .replace(/[  ]/g, ' ')
    .replace(/—nic/g, '—')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * „0 Kč“ jako samostatná částka — ne konec „10 Kč“ ani „1 000 Kč“.
 * Pevné mezery (NBSP) v `koruny()` jsou taky mezery.
 */
const nulaKorun = (html) => /(?<![\d\s ])0[\s ]Kč/.test(html)

/**
 * Buňky řádku tabulky člověka (bez jména), jako text. `<td` i se
 * třídou — sloupec Zbývá ji má (zvýraznění, 24. 9. večer).
 */
function radekTabulky(html, id) {
  const m = html.match(new RegExp(`<tr[^>]*data-clovek="${id}"[^>]*>([\\s\\S]*?)</tr>`))
  if (!m) return null
  return [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]))
}

/** Hodnoty z karty člověka na telefonu (dd), jako text. */
function kartaTelefonu(html, id) {
  const m = html.match(new RegExp(`<li[^>]*data-clovek="${id}"[^>]*>([\\s\\S]*?)</li>`))
  if (!m) return null
  return [...m[1].matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((x) => text(x[1]))
}

/** Celé HTML řádku (pro hledání „0 Kč“ v něm). */
function htmlRadku(html, id) {
  return (html.match(new RegExp(`<tr[^>]*data-clovek="${id}"[^>]*>[\\s\\S]*?</tr>`)) ?? [''])[0]
}

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

/**
 * Načte jeden .ts modul s podstrčenými importy (pro soubory bez
 * výchozího exportu — nabídka, serverové akce). Co podstrčené není
 * a nevede na soubor, SHODÍ načtení: tichá záměna je přesně ta chyba,
 * kvůli které se tu vykresluje.
 */
async function nactiModul(soubor, nahrady) {
  let s = ts.transpileModule(fs.readFileSync(new URL(soubor, KOREN), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [co, cim] of nahrady) {
    for (const u of ['"', "'"]) s = s.split(u + co + u).join(u + cim + u)
  }
  const zbyle = [...s.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((x) => !/^(file|data|node):/.test(x))
  if (zbyle.length > 0) throw new Error(`Nepodstrčené importy v ${soubor}: ${zbyle.join(', ')}`)
  return import('data:text/javascript;base64,' + Buffer.from(s, 'utf8').toString('base64'))
}

/* ======================================================================
   1. TABULKA VÝDĚLKŮ
   ====================================================================== */

const TabulkaVydelku = await nactiKomponentu(
  'app/[rozsah]/dochazka/vydelky/tabulka-vydelku.tsx',
  [['next/link', ODKAZ]],
)

const radek = (r) => ({
  branch_id: 'b1',
  odpracovano_minut: 0,
  vydelano_haleru: 0,
  sazba_chybi: false,
  hodinova_haleru: 20000,
  plan_minut: 0,
  plan_haleru: 0,
  plan_sazba_chybi: false,
  plan_smen: 0,
  zalohy_haleru: 0,
  predbezne_haleru: 0,
  ...r,
})

const LIDE = [
  // Deset hodin odpracovaných, sazbu nikdo nezadal. Tohle je ten případ,
  // kvůli kterému se nesmí ukázat „0 Kč“.
  radek({
    employee_id: 'adam',
    full_name: 'Adam Bez Sazby',
    odpracovano_minut: 600,
    sazba_chybi: true,
    hodinova_haleru: null,
    zalohy_haleru: 50000,
  }),
  // Vybral si víc, než zatím vydělal.
  radek({
    employee_id: 'bara',
    full_name: 'Bára Zálohová',
    odpracovano_minut: 480,
    vydelano_haleru: 96000,
    zalohy_haleru: 150000,
    predbezne_haleru: 96000,
  }),
  // Běžný člověk: hodiny, sazba, záloha, plán do konce měsíce.
  radek({
    employee_id: 'cyril',
    full_name: 'Cyril Běžný',
    odpracovano_minut: 5070,
    vydelano_haleru: 1859000,
    hodinova_haleru: 22000,
    zalohy_haleru: 200000,
    plan_smen: 3,
    plan_minut: 1350,
    plan_haleru: 495000,
    predbezne_haleru: 2354000,
  }),
  // Zatím nic neodpracovala, v rozpisu má dvě směny — sazbu ne.
  radek({
    employee_id: 'dana',
    full_name: 'Dana Jen Plán',
    hodinova_haleru: null,
    plan_smen: 2,
    plan_minut: 900,
    plan_sazba_chybi: true,
  }),
]

const vykresli = (radky, obdobi = 'tento', naPobocce = true) =>
  renderToStaticMarkup(
    createElement(TabulkaVydelku, {
      radky,
      mesic: '2026-09-01',
      obdobi,
      naPobocce,
      pobocky: { b1: 'Černá Perla' },
      predchozi: { href: '/cerna-perla/dochazka/vydelky?mesic=2026-08', mesic: '2026-08-01' },
      nasledujici: { href: '/cerna-perla/dochazka/vydelky?mesic=2026-10', mesic: '2026-10-01' },
    }),
  )

const html = vykresli(LIDE)

// Pořadí sloupců: Odpracováno · Vyděláno · Zálohy · Zbývá · Plán · Předběžně
const ODP = 0, VYD = 1, ZAL = 2, ZBY = 3, PLAN = 4, PRED = 5

console.log('\n== Detektor „0 Kč“ sám umí spadnout ==')
ma('„0 Kč“ pozná', nulaKorun('0 Kč'), true)
ma('„10 Kč“ za nulu nepovažuje', nulaKorun('10 Kč'), false)
ma('„1 000 Kč“ za nulu nepovažuje', nulaKorun('1 000 Kč'), false)

console.log('\n== Chybějící sazba: „bez sazby“, nikdy „0 Kč“ ==')
const adam = radekTabulky(html, 'adam')
ma('řádek bez sazby je v tabulce', Array.isArray(adam), true)
ma('vyděláno = „bez sazby“', adam?.[VYD], 'bez sazby')
ma('zbývá = „bez sazby“ (bez sazby se odečíst nedá)', adam?.[ZBY], 'bez sazby')
ma('předběžně = „bez sazby“', adam?.[PRED], 'bez sazby')
ma('hodiny se ukážou', adam?.[ODP], '10 h 0 min')
ma('záloha se ukáže i bez sazby', adam?.[ZAL], '500 Kč')
ma('v celém řádku není „0 Kč“', nulaKorun(htmlRadku(html, 'adam')), false)
ma('pod jménem „bez sazby“ místo sazby', htmlRadku(html, 'adam').includes('bez sazby'), true)
const dana = radekTabulky(html, 'dana')
ma('plán bez sazby: předběžně „bez sazby“', dana?.[PRED], 'bez sazby')
ma('nic neodpracovala: vyděláno je pomlčka, ne nula', dana?.[VYD], '—')
ma('v řádku jen s plánem není „0 Kč“', nulaKorun(htmlRadku(html, 'dana')), false)

console.log('\n== Přeplaceno ==')
const bara = radekTabulky(html, 'bara')
ma('zálohy nad výdělek = „přeplaceno“ a rozdíl', bara?.[ZBY], 'přeplaceno 540 Kč')
ma('ne záporné číslo', htmlRadku(html, 'bara').includes('-540'), false)
const cyril = radekTabulky(html, 'cyril')
ma('běžný člověk: zbývá vyděláno minus zálohy', cyril?.[ZBY], '16 590 Kč')
ma('běžný člověk: předběžně', cyril?.[PRED], '23 540 Kč')
ma('plán: směny a hodiny', cyril?.[PLAN], '3 směny · 22 h 30 min')

console.log('\n== Zbývá je zvýrazněné (zůstatek, na který se majitel ptá) ==')
ma('parser buněk vidí i buňku se třídou: 6 buněk v řádku', radekTabulky(html, 'cyril')?.length, 6)
const tridyZahlavi = [...html.matchAll(/<th scope="col"( class="([^"]*)")?>([\s\S]*?)<\/th>/g)]
  .filter((m) => m[2]).map((m) => `${text(m[3])}:${m[2]}`)
ma('v záhlaví je zvýrazněný jen sloupec Zbývá', tridyZahlavi.join(' '), 'Zbývá:ds-vy-zbyva')
const tridyBunek = [...htmlRadku(html, 'cyril').matchAll(/<td( class="([^"]*)")?>([\s\S]*?)<\/td>/g)].map((m) => m[2] ?? '')
ma('v řádku člověka má třídu jen buňka Zbývá (5. sloupec)', tridyBunek.join('|'), '|||ds-vy-zbyva||')
const kartaCyril = html.match(/<li[^>]*data-clovek="cyril"[^>]*>([\s\S]*?)<\/li>/)?.[1] ?? ''
ma('na telefonu je zvýrazněný řádek Zbývá',
  [...kartaCyril.matchAll(/<div class="ds-vy-radek ds-vy-zbyva"><dt>([^<]*)<\/dt>/g)].map((m) => m[1]).join(','), 'Zbývá')

console.log('\n== Hodiny jedním tvarem ==')
const hodiny = [...text(html).matchAll(/\d+(?:,\d+)?\s?h\b(?:\s\d+\smin)?/g)].map((m) => m[0])
ma('nějaké hodiny se našly', hodiny.length >= 5, true)
ma('všechny jsou „X h Y min“', hodiny.every((h) => /^\d+ h \d+ min$/.test(h)), true)
ma('odpracováno u běžného', cyril?.[ODP], '84 h 30 min')

console.log('\n== Telefon: karty s týmiž buňkami ==')
ma('karta bez sazby říká totéž co tabulka', JSON.stringify(kartaTelefonu(html, 'adam')), JSON.stringify(adam))
ma('karta přeplacené taky', JSON.stringify(kartaTelefonu(html, 'bara')), JSON.stringify(bara))

console.log('\n== Přehledové karty ==')
const k = karty(html)
ma('čtyři karty', Object.keys(k).length, 4)
ma('vyděláno do dneška = součet', k['Vyděláno do dneška']?.hodnota, '19 550 Kč')
ma('a varování, že někdo je bez sazby',
  k['Vyděláno do dneška']?.popisy.some((p) => p.spatne && p.text.includes('bez sazby')), true)
ma('zálohy = součet', k['Zálohy']?.hodnota, '4 000 Kč')
ma('předběžně za měsíc', k['Předběžně za měsíc']?.hodnota, '24 500 Kč')

/*
  „Zbývá k výplatě“ se sčítá PO LIDECH: součet max(0, vyděláno − zálohy)
  jen za lidi se sazbou. Rozdíl součtů (19 550 − 4 000 = 15 550 Kč) by
  Bářin přeplatek 540 Kč odečetl Cyrilovi a Adamovu zálohu 500 Kč bez
  sazby taky; součet rozdílů bez max(0, …) by dal 16 050 Kč. Správně je
  jen Cyrilových 16 590 Kč — každé z těch tří čísel je jiné.
*/
const popisy = (karta) => (karta?.popisy ?? []).filter((p) => p.spatne).map((p) => p.text)
ma('zbývá k výplatě = po lidech, přeplatek jednoho nesnižuje výplatu ostatních',
  k['Zbývá k výplatě']?.hodnota, '16 590 Kč')
ma('přeplatek zvlášť: kolik a u kolika lidí',
  popisy(k['Zbývá k výplatě']).includes('přeplaceno 540 Kč u 1 člověka — od ostatních se neodečítá'), true)
ma('a lidé bez sazby s poznámkou, že v součtu chybí',
  popisy(k['Zbývá k výplatě']).includes('1 člověk bez sazby — v součtu chybí'), true)

const jenBezSazby = karty(vykresli([LIDE[0]]))
ma('jen lidé bez sazby: karta „bez sazby“, ne „0 Kč“', jenBezSazby['Vyděláno do dneška']?.hodnota, 'bez sazby')
ma('a „zbývá“ taky', jenBezSazby['Zbývá k výplatě']?.hodnota, 'bez sazby')
const jenBara = karty(vykresli([LIDE[1]]))
ma('jen přeplacený: zbývá 0 Kč, ne záporné číslo', jenBara['Zbývá k výplatě']?.hodnota, '0 Kč')
ma('a přeplatek slovem pod tím', popisy(jenBara['Zbývá k výplatě']).includes('přeplaceno 540 Kč u 1 člověka — od ostatních se neodečítá'), true)

console.log('\n== Přeplatek podle zaokrouhlených korun ==')
/*
  Přeplatek pod 50 haléřů se v korunách ukáže jako nula — „přeplaceno
  0 Kč“ by tvrdilo dluh, který na obrazovce není. Od 50 haléřů už je to
  1 Kč (koruny() zaokrouhluje Math.round). A kdo má část dnů bez sazby,
  ve „zbývá“ chybí úplně, i když nějaké vyděláno má.
*/
const HALERE = [
  LIDE[2],
  radek({ employee_id: 'olga', full_name: 'Olga Haléřová', odpracovano_minut: 300,
    vydelano_haleru: 100000, zalohy_haleru: 100030, predbezne_haleru: 100000 }),
  radek({ employee_id: 'petr', full_name: 'Petr Padesátník', odpracovano_minut: 300,
    vydelano_haleru: 100000, zalohy_haleru: 100050, predbezne_haleru: 100000 }),
  radek({ employee_id: 'eva', full_name: 'Eva Část Bez Sazby', odpracovano_minut: 300,
    vydelano_haleru: 50000, sazba_chybi: true, predbezne_haleru: 50000 }),
]
const htmlHalere = vykresli(HALERE)
const kHalere = karty(htmlHalere)
ma('30 haléřů přes: „0 Kč“, ne „přeplaceno 0 Kč“', radekTabulky(htmlHalere, 'olga')?.[ZBY], '0 Kč')
ma('50 haléřů přes: „přeplaceno 1 Kč“', radekTabulky(htmlHalere, 'petr')?.[ZBY], 'přeplaceno 1 Kč')
ma('nikde „přeplaceno 0 Kč“', text(htmlHalere).includes('přeplaceno 0 Kč'), false)
ma('souhrn: přeplacený je jen jeden (Petr), ne dva',
  popisy(kHalere['Zbývá k výplatě']).includes('přeplaceno 1 Kč u 1 člověka — od ostatních se neodečítá'), true)
ma('souhrn: zbývá jen Cyrilových 16 590 Kč — Eva s částí dnů bez sazby v něm není',
  kHalere['Zbývá k výplatě']?.hodnota, '16 590 Kč')
ma('Eva v řádku „bez sazby“', radekTabulky(htmlHalere, 'eva')?.[ZBY], 'bez sazby')

console.log('\n== Vysvětlivky a prázdný měsíc ==')
ma('hrubá mzda', html.includes('hrubá mzda'), true)
ma('běžící směna se přičte po odchodu', text(html).includes('přičte se po odchodu'), true)
ma('předběžně je orientační a počítá koncepty', text(html).includes('včetně nevydaných konceptů'), true)
const prazdne = vykresli([])
ma('prázdný měsíc: věta, ne tabulka', prazdne.includes('<table'), false)
ma('a žádné karty s nulou', prazdne.includes('ds-kpi'), false)

// Oddíl Po dnech (po-dnech.tsx) se kreslí POD lidmi a nad vysvětlivkami;
// sám se testuje ve scripts/ucet.test.mjs.
const sDny = renderToStaticMarkup(
  createElement(TabulkaVydelku, {
    radky: LIDE, mesic: '2026-09-01', obdobi: 'tento', naPobocce: true, pobocky: {},
    predchozi: { href: '#', mesic: '2026-08-01' }, nasledujici: null,
    poDnech: createElement('section', { id: 'po-dnech' }, 'DNY'),
  }),
)
const kde = (h, co) => h.indexOf(co)
ma('Po dnech je pod tabulkou lidí a nad vysvětlivkami',
  kde(sDny, 'ds-vy-karty') < kde(sDny, 'id="po-dnech"') && kde(sDny, 'id="po-dnech"') < kde(sDny, 'ds-vy-vysvetlivky'), true)
ma('vysvětlivka: součet dnů = sloupec Vyděláno', text(sDny).includes('Součet dnů je přesně součet sloupce Vyděláno'), true)

/* ======================================================================
   2. LIŠTA ZÁLOŽEK
   ====================================================================== */

const Zalozky = await nactiKomponentu('app/[rozsah]/dochazka/zalozky.tsx', [['next/link', ODKAZ]])
const lista = (viditelne, mesic = null) =>
  renderToStaticMarkup(createElement(Zalozky, { rozsah: 'cerna-perla', aktivni: 'dochazka', viditelne, mesic }))
const odkazy = (h) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1])

console.log('\n== Záložky ==')
ma('všechny tři', odkazy(lista(['dochazka', 'vydelky', 'zalohy'])).join(' '),
  '/cerna-perla/dochazka /cerna-perla/dochazka/vydelky /cerna-perla/dochazka/zalohy')
ma('bez práva na výdělky se záložka Výdělky NEKRESLÍ',
  lista(['dochazka', 'zalohy']).includes('/dochazka/vydelky'), false)
ma('a Zálohy zůstanou', lista(['dochazka', 'zalohy']).includes('/dochazka/zalohy'), true)
ma('jediná záložka: lišta se nekreslí vůbec', lista(['dochazka']), '')
ma('aktivní je označená', lista(['dochazka', 'zalohy']).includes('href="/cerna-perla/dochazka" aria-current="page"'), true)
ma('a jen ona', (lista(['dochazka', 'vydelky', 'zalohy']).match(/aria-current/g) ?? []).length, 1)
ma('měsíc jde do Docházky i Výdělků, ne do Záloh',
  odkazy(lista(['dochazka', 'vydelky', 'zalohy'], '2026-08')).join(' '),
  '/cerna-perla/dochazka?mesic=2026-08 /cerna-perla/dochazka/vydelky?mesic=2026-08 /cerna-perla/dochazka/zalohy')

/* ======================================================================
   3. KTERÉ ZÁLOŽKY SE KRESLÍ — PODLE PRÁV
   ====================================================================== */

/*
  `hasAccess` se podstrčí: odpovídá podle tabulky práv „kdo co má kde“
  a zapisuje si, na co se ho kdo ptal.
*/
globalThis.__prava = { mam: () => false, volani: [], zaznam: false }
const AUTHZ = js(
  'export async function hasAccess(t, pravo, pobocka) {\n' +
    '  globalThis.__prava.volani.push([pravo, pobocka]);\n' +
    '  return globalThis.__prava.mam(pravo, pobocka);\n' +
    '}\n' +
    'export async function getUser() { return { id: "u1" } }\n',
)
/*
  Záložka Můj účet se ptá na zaměstnanecký záznam (od 24. 9. večer).
  Tady jen ano/ne; na co přesně se ptá, hlídá scripts/ucet.test.mjs.
*/
const SUPABASE_ZALOZEK = js(
  'export async function getServerSupabase() {\n' +
    '  const o = { select: () => o, eq: () => o, is: () => o,\n' +
    '    limit: async () => ({ data: globalThis.__prava.zaznam ? [{ id: "e1" }] : [], error: null }) };\n' +
    '  return { from: () => o };\n' +
    '}\n',
)
const zalozkyDochazky = await nactiKomponentu('app/[rozsah]/dochazka/zalozky-prava.ts', [
  ['@/lib/authz', AUTHZ],
  ['@/lib/supabase/server', SUPABASE_ZALOZEK],
])

async function zalozkyPro(prava, pobocka, zaznam = false) {
  globalThis.__prava = {
    mam: (pravo, kde) => prava.some(([p, b]) => p === pravo && (b === '*' || b === kde)),
    volani: [],
    zaznam,
  }
  return (await zalozkyDochazky('t1', pobocka)).join(',')
}

console.log('\n== Práva → záložky ==')
ma('bez zaměstnaneckého záznamu: jen Docházka (lišta se pak nekreslí)', await zalozkyPro([], 'B1'), 'dochazka')
ma('číšník se záznamem: Docházka a Můj účet, výdělky ostatních ne', await zalozkyPro([], 'B1', true), 'dochazka,ucet')
ma('vedoucí s docházkou a zálohami, BEZ payroll.read: výdělky ne',
  await zalozkyPro([['attendance.read', 'B1'], ['advances.manage', 'B1']], 'B1'), 'dochazka,zalohy')
ma('majitel (všechno všude)', await zalozkyPro([['payroll.read', '*'], ['advances.manage', '*']], 'B1'), 'dochazka,vydelky,zalohy')
ma('payroll.read jen na jiné pobočce: tady výdělky ne', await zalozkyPro([['payroll.read', 'B2']], 'B1'), 'dochazka')
ma('payroll.read na téhle pobočce: výdělky ano', await zalozkyPro([['payroll.read', 'B1']], 'B1'), 'dochazka,vydelky')
ma('na výdělky se ptá s pobočkou z adresy',
  globalThis.__prava.volani.some(([p, b]) => p === 'payroll.read' && b === 'B1'), true)
ma('na /firma (NULL) jen s firemním payroll.read',
  await zalozkyPro([['payroll.read', 'B1']], null), 'dochazka')

/* ======================================================================
   4. STRÁNKA VÝDĚLKY
   ====================================================================== */

/*
  Podstrčí se všechno, co sahá na server: přístup, provozní den,
  databáze. Zbytek (záložky, tabulka, nadpis) je skutečný.
*/
globalThis.__stranka = null
const NAVIGACE = js(
  'export function redirect(adresa) { throw Object.assign(new Error("NEXT_REDIRECT"), { adresa }) }\n' +
    'export function notFound() { throw new Error("NEXT_NOT_FOUND") }\n',
)
const FIRMA = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export async function zkusPristup(t, pravo, rozsah) {\n' +
    '  globalThis.__stranka.volani.push(["zkusPristup", pravo, rozsah]);\n' +
    '  return globalThis.__stranka.pristup(pravo, rozsah);\n' +
    '}\n',
)
const PROVOZNI_DEN = js(
  'export async function provozniDen(pobocka) {\n' +
    '  globalThis.__stranka.volani.push(["provozniDen", pobocka]);\n' +
    '  return globalThis.__stranka.den;\n' +
    '}\n',
)
const DOTAZ = js(
  'export class DotazSelhal extends Error { constructor(p, c) { super("Dotaz " + p + " selhal: " + c.message) } }\n' +
    'export function funkceNeexistuje(c) { return c?.code === "PGRST202" || c?.code === "42883" }\n',
)
const SERVER = js(
  'export async function getServerSupabase() {\n' +
    '  return { rpc: async (jmeno, args) => {\n' +
    '    globalThis.__stranka.volani.push(["rpc", jmeno, args]);\n' +
    '    return jmeno === "vydelky_po_dnech" ? globalThis.__stranka.odpovedDny : globalThis.__stranka.odpoved;\n' +
    '  } };\n' +
    '}\n',
)
const PRAVA_ZALOZEK = js(
  'export default async function zalozkyDochazky(t, pobocka) {\n' +
    '  globalThis.__stranka.volani.push(["zalozky", pobocka]);\n' +
    '  return ["dochazka", "vydelky", "zalohy"];\n' +
    '}\n',
)

const Vydelky = await nactiKomponentu('app/[rozsah]/dochazka/vydelky/page.tsx', [
  ['next/navigation', NAVIGACE],
  ['next/link', ODKAZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SERVER],
  ['../zalozky-prava', PRAVA_ZALOZEK],
])

const POBOCKA = { level: 'branch', branchId: 'B1', branchName: 'Černá Perla', branchSlug: 'cerna-perla' }
const FIRMA_ROZSAH = { level: 'tenant', branchId: null, branchName: 'Foodtab', branchSlug: 'firma' }
const CTX = { branches: [{ id: 'B1', name: 'Černá Perla' }, { id: 'B2', name: 'Bernard' }] }

async function stranka({
  pristup,
  rozsah = 'cerna-perla',
  mesic,
  den = '2026-09-24',
  odpoved = { data: LIDE, error: null },
  odpovedDny = { data: [], error: null },
}) {
  globalThis.__stranka = { pristup, den, odpoved, odpovedDny, volani: [] }
  let vystup = ''
  let chyba = null
  try {
    const prvek = await Vydelky({
      params: Promise.resolve({ rozsah }),
      searchParams: Promise.resolve(mesic ? { mesic } : {}),
    })
    vystup = renderToStaticMarkup(prvek)
  } catch (e) {
    chyba = e
    console.log(`    (stránka vyhodila: ${e.message})`)
  }
  const volani = globalThis.__stranka.volani
  return { html: vystup, chyba, volani, rpc: volani.filter((v) => v[0] === 'rpc') }
}

const smi = (pravo) => (pravo === 'payroll.read' ? { stav: 'ok', ctx: CTX, scope: POBOCKA } : { stav: 'odepren' })
const nesmi = () => ({ stav: 'odepren' })

console.log('\n== Stránka ověřuje payroll.read s rozsahem z adresy ==')
const bez = await stranka({ pristup: nesmi })
ma('bez práva: věta o oprávnění', bez.html.includes('Na výdělky nemáte oprávnění'), true)
ma('a databáze se VŮBEC nezeptá', bez.rpc.length, 0)
ma('žádná tabulka', bez.html.includes('ds-vy-tabulka'), false)
ma('ptá se na payroll.read s rozsahem z adresy',
  JSON.stringify(bez.volani.find((v) => v[0] === 'zkusPristup')), JSON.stringify(['zkusPristup', 'payroll.read', 'cerna-perla']))

const sPravem = await stranka({ pristup: smi })
ma('s právem: tabulka je tam', sPravem.html.includes('ds-vy-tabulka'), true)
ma('volá vydelky_prehled', sPravem.rpc[0]?.[1], 'vydelky_prehled')
ma('s pobočkou z rozsahu', sPravem.rpc[0]?.[2]?.p_branch, 'B1')
ma('a s firmou', sPravem.rpc[0]?.[2]?.p_tenant, 't1')
ma('záložky dostaly pobočku z rozsahu', JSON.stringify(sPravem.volani.find((v) => v[0] === 'zalozky')), JSON.stringify(['zalozky', 'B1']))
ma('jeden nadpis „Docházka“', (sPravem.html.match(/<h1>/g) ?? []).length === 1 && sPravem.html.includes('<h1>Docházka</h1>'), true)
ma('záložka Výdělky je aktivní', /href="\/cerna-perla\/dochazka\/vydelky" aria-current="page"/.test(sPravem.html), true)

const naFirme = await stranka({
  pristup: (p, r) => (p === 'payroll.read' && r === 'firma' ? { stav: 'ok', ctx: CTX, scope: FIRMA_ROZSAH } : { stav: 'odepren' }),
  rozsah: 'firma',
})
ma('na /firma se ptá s NULL (celá firma)', naFirme.rpc[0]?.[2]?.p_branch, null)
ma('provozní den z první pobočky jako kotvy', JSON.stringify(naFirme.volani.find((v) => v[0] === 'provozniDen')), JSON.stringify(['provozniDen', 'B1']))

console.log('\n== Výchozí měsíc = měsíc provozního dne, ne hodiny serveru ==')
// Provozní den je schválně JINÝ měsíc, než jaký ukazují hodiny počítače.
const rijen = await stranka({ pristup: smi, den: '2026-10-01' })
ma('provozní den 1. 10. → říjen', rijen.rpc[0]?.[2]?.p_mesic, '2026-10-01')
const srpen = await stranka({ pristup: smi, mesic: '2026-08' })
ma('?mesic=2026-08 → srpen', srpen.rpc[0]?.[2]?.p_mesic, '2026-08-01')
ma('minulý měsíc: „Vyděláno za měsíc“', srpen.html.includes('Vyděláno za měsíc'), true)
const nesmysl = await stranka({ pristup: smi, mesic: '2026-13' })
ma('nesmysl v adrese → měsíc provozního dne', nesmysl.rpc[0]?.[2]?.p_mesic, '2026-09-01')
const nulovyRok = await stranka({ pristup: smi, mesic: '0000-01' })
ma('rok, který databáze nevezme → měsíc provozního dne', nulovyRok.rpc[0]?.[2]?.p_mesic, '2026-09-01')
ma('přes Silvestra dozadu', /mesic=2025-12/.test((await stranka({ pristup: smi, mesic: '2026-01' })).html), true)

console.log('\n== Nenasazená databáze ==')
const nenasazeno = await stranka({ pristup: smi, odpoved: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } })
ma('věta o nasazení', nenasazeno.html.includes('Výdělky budou dostupné po nasazení databáze.'), true)
ma('a nic nespadlo', nenasazeno.chyba, null)
const porucha = await stranka({ pristup: smi, odpoved: { data: null, error: { code: '42501', message: 'permission denied' } } })
ma('jiná chyba se NEZAMETE — spadne', porucha.chyba instanceof Error, true)

console.log('\n== Kontrakt s migrací: jména parametrů a sloupců ==')

/*
  Aplikace a databáze se domlouvají jen jmény. Překlep v `r.plan_minuty`
  by tsc nechytil (řádek z RPC je Record<string, unknown>) a stránka by
  tiše ukázala pomlčku; přejmenovaný parametr by skončil až na PGRST202
  — a ten stránka schválně prominí jako „nenasazeno“. Proto se jména
  vezmou přímo z migrace a řádek poskládaný z nich projde celou stránkou
  (naRadek) až do tabulky. Scénář krok55 hlídá tutéž hlavičku z druhé
  strany (pg_get_function_result).
*/
const migrace = fs.readFileSync(new URL('supabase/migrations/20260924140000_vydelky_prehled.sql', KOREN), 'utf8')
const hlavicka = migrace.match(
  /create or replace function public\.vydelky_prehled\(([^)]*)\)\s*returns table \(([^)]*)\)/,
)
const jmena = (seznam) => seznam.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
const PARAMETRY = hlavicka ? jmena(hlavicka[1]) : []
const SLOUPCE_DB = hlavicka ? jmena(hlavicka[2]) : []
const serazeno = (pole) => [...pole].sort().join(',')

ma('z migrace jde přečíst 3 parametry a 13 sloupců', `${PARAMETRY.length}/${SLOUPCE_DB.length}`, '3/13')
ma('stránka posílá právě parametry funkce', serazeno(Object.keys(sPravem.rpc[0]?.[2] ?? {})), serazeno(PARAMETRY))
ma('podstrčené řádky mají právě sloupce funkce', serazeno(Object.keys(LIDE[0])), serazeno(SLOUPCE_DB))

// Každý sloupec jiná hodnota — záměna dvou sloupců by se tak prozradila.
const HODNOTY = {
  employee_id: 'kontrakt',
  full_name: 'Kamila Kontraktová',
  branch_id: 'B2',
  odpracovano_minut: 61,
  vydelano_haleru: 111100,
  sazba_chybi: false,
  hodinova_haleru: 12300,
  plan_minut: 184,
  plan_haleru: 44400,
  plan_sazba_chybi: true,
  plan_smen: 3,
  zalohy_haleru: 22200,
  predbezne_haleru: 155500,
}
const zDatabaze = (zmeny) => Object.fromEntries(SLOUPCE_DB.map((s) => [s, { ...HODNOTY, ...zmeny }[s]]))
const kontrakt = await stranka({
  pristup: (p, r) => (p === 'payroll.read' && r === 'firma' ? { stav: 'ok', ctx: CTX, scope: FIRMA_ROZSAH } : { stav: 'odepren' }),
  rozsah: 'firma',
  odpoved: {
    data: [
      zDatabaze({}),
      // Část dnů bez sazby: vyděláno se ukáže se štítkem, „zbývá“ ne.
      zDatabaze({
        employee_id: 'kontrakt2', full_name: 'Karel Kontraktový', branch_id: null,
        odpracovano_minut: 30, vydelano_haleru: 5000, sazba_chybi: true, hodinova_haleru: null,
        plan_minut: 0, plan_haleru: 0, plan_sazba_chybi: false, plan_smen: 0,
        zalohy_haleru: 0, predbezne_haleru: 5000,
      }),
    ],
    error: null,
  },
})
ma('řádek z databáze dojde do tabulky celý (odpracováno · vyděláno · zálohy · zbývá · plán · předběžně)',
  JSON.stringify(radekTabulky(kontrakt.html, 'kontrakt')),
  JSON.stringify(['1 h 1 min', '1 111 Kč', '222 Kč', '889 Kč', '3 směny · 3 h 4 min', '1 555 Kččást bez sazby']))
/** Jméno a řádek pod ním (sazba · pobočka) z buňky člověka. */
const podJmenem = (id) => {
  const h = htmlRadku(kontrakt.html, id)
  const cast = (trida) => text((h.match(new RegExp(`<span class="${trida}">([\\s\\S]*?)</span>`)) ?? ['', ''])[1])
  return `${cast('ds-vy-jmeno')} | ${cast('ds-vy-sazba')}`
}
ma('jméno, sazba a pobočka pod jménem', podJmenem('kontrakt'), 'Kamila Kontraktová | 123 Kč/h · Bernard')
ma('sazba_chybi dojde až do buněk',
  JSON.stringify(radekTabulky(kontrakt.html, 'kontrakt2')),
  JSON.stringify(['0 h 30 min', '50 Kččást bez sazby', '—', 'bez sazby', '—', '50 Kččást bez sazby']))
ma('a sazba NULL je „bez sazby“, ne „0 Kč/h“', podJmenem('kontrakt2'), 'Karel Kontraktový | bez sazby')

console.log('\n== Po dnech na stránce (24. 9. večer) ==')
const dnyVolani = sPravem.rpc.find((r) => r[1] === 'vydelky_po_dnech')
ma('stránka volá i vydelky_po_dnech', Boolean(dnyVolani), true)
ma('s TÝMIŽ parametry jako po lidech (firma, pobočka z rozsahu, měsíc)',
  JSON.stringify(dnyVolani?.[2]), JSON.stringify(sPravem.rpc.find((r) => r[1] === 'vydelky_prehled')?.[2]))
ma('na /firma taky s NULL', naFirme.rpc.find((r) => r[1] === 'vydelky_po_dnech')?.[2]?.p_branch, null)
ma('bez payroll.read se na dny taky nezeptá', bez.rpc.length, 0)

const dnyNenasazene = await stranka({
  pristup: smi,
  odpovedDny: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
})
ma('po dnech nenasazeno: tabulka lidí zůstane', dnyNenasazene.html.includes('ds-vy-tabulka'), true)
ma('… místo dnů věta', text(dnyNenasazene.html).includes('Přehled po dnech bude dostupný po nasazení databáze.'), true)
ma('… a nic nespadlo', dnyNenasazene.chyba, null)
const dnyPorucha = await stranka({
  pristup: smi,
  odpovedDny: { data: null, error: { code: '42501', message: 'permission denied' } },
})
ma('jiná chyba po dnech se NEZAMETE — spadne', dnyPorucha.chyba instanceof Error, true)

// Kontrakt i pro dny: jména z migrace 20260925130000, řádek z nich až do buněk.
const migraceDny = fs.readFileSync(new URL('supabase/migrations/20260925130000_ucet_a_naklady.sql', KOREN), 'utf8')
const hlavickaDny = migraceDny.match(
  /create or replace function public\.vydelky_po_dnech\(([^)]*)\)\s*returns table \(([^)]*)\)/,
)
const SLOUPCE_DNY = hlavickaDny ? jmena(hlavickaDny[2]) : []
ma('z migrace jde přečíst 8 sloupců dnů', SLOUPCE_DNY.length, 8)
ma('stránka posílá po dnech právě parametry funkce',
  serazeno(Object.keys(dnyVolani?.[2] ?? {})), serazeno(hlavickaDny ? jmena(hlavickaDny[1]) : []))
const HODNOTY_DNY = {
  den: '2026-09-07', lidi: 2, odpracovano_minut: 61, mzdy_haleru: 111100, bez_sazby_lidi: 1,
  zalohy_haleru: 22200, zaloh: 3, zaloh_nepotvrzenych: 2,
}
const kontraktDny = await stranka({
  pristup: smi,
  odpovedDny: { data: [Object.fromEntries(SLOUPCE_DNY.map((s) => [s, HODNOTY_DNY[s]]))], error: null },
})
const radekDne = (h, d) =>
  [...((h.match(new RegExp(`<tr[^>]*data-den="${d}"[^>]*>([\\s\\S]*?)</tr>`)) ?? ['', ''])[1]).matchAll(
    /<td[^>]*>([\s\S]*?)<\/td>/g,
  )].map((x) => text(x[1]))
ma('den z databáze dojde do buněk celý (lidé · hodiny · mzdy + bez sazby · zálohy + čekající)',
  JSON.stringify(radekDne(kontraktDny.html, '2026-09-07')),
  JSON.stringify(['2 lidé', '1 h 1 min', '1 111 Kč+ 1 člověk bez sazby', '222 Kč2 nepotvrzené']))
ma('… a mzdy NULL zůstanou „bez sazby“, ne „0 Kč“',
  radekDne((await stranka({
    pristup: smi,
    odpovedDny: { data: [{ ...HODNOTY_DNY, mzdy_haleru: null }], error: null },
  })).html, '2026-09-07')[2], 'bez sazby')

/* ======================================================================
   5. NABÍDKA
   ====================================================================== */

const AUTHZ_NABIDKA = js(
  'export const canSee = () => true\n' +
    'export const isModuleActive = () => true\n' +
    'export const jeVedeni = () => true\n',
)
const nabidka = await nactiModul('app/[rozsah]/nabidka.ts', [['@/lib/authz', AUTHZ_NABIDKA]])

console.log('\n== Nabídka ==')
ma('položka zalohy v nabídce NENÍ', nabidka.NABIDKA.some((p) => p.segment === 'zalohy' || p.segment.startsWith('zalohy/')), false)
ma('ani mezi dalšími segmenty', nabidka.NABIDKA.some((p) => (p.dalsiSegmenty ?? []).includes('zalohy')), false)
const dochazka = nabidka.NABIDKA.find((p) => p.segment === 'dochazka')
ma('Docházka v nabídce je', Boolean(dochazka), true)
ma('a nemá jenPobocka (majitel na /firma)', dochazka?.jenPobocka, undefined)
ma('spodní lišta vedení: Dnes · Směny · Docházka · Vzkazy',
  nabidka.polozkyModulu({}, 'provoz').slice(0, 4).map((p) => p.segment).join(' · '),
  'dnes · smeny · dochazka · vzkazy-a-ukoly')

/* ======================================================================
   6. PŘESMĚROVÁNÍ /zalohy
   ====================================================================== */

console.log('\n== /zalohy přesměrovává ==')
const konfigurace = (await import(new URL('next.config.ts', KOREN).href)).default
const presmerovani = await konfigurace.redirects()
const naZalohy = presmerovani.find((p) => p.source === '/:rozsah/zalohy')
ma('pravidlo pro /:rozsah/zalohy existuje', Boolean(naZalohy), true)
ma('vede na /:rozsah/dochazka/zalohy', naZalohy?.destination, '/:rozsah/dochazka/zalohy')
ma('trvale (308)', naZalohy?.permanent, true)

/** Tentýž tvar vzoru jako u Next: `:rozsah` je jeden segment. */
const kam = (adresa) => {
  for (const p of presmerovani) {
    const re = new RegExp('^' + p.source.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$')
    const m = adresa.match(re)
    if (m) return p.destination.replace(/:(\w+)/g, (_, j) => m.groups[j])
  }
  return null
}
ma('/cerna-perla/zalohy → /cerna-perla/dochazka/zalohy', kam('/cerna-perla/zalohy'), '/cerna-perla/dochazka/zalohy')
ma('/firma/zalohy → /firma/dochazka/zalohy', kam('/firma/zalohy'), '/firma/dochazka/zalohy')
ma('nová adresa se nepřesměrovává dál (žádná smyčka)', kam('/cerna-perla/dochazka/zalohy'), null)
ma('nová stránka existuje', fs.existsSync(new URL('app/[rozsah]/dochazka/zalohy/page.tsx', KOREN)), true)
ma('stará složka je pryč (žádný mrtvý soubor)', fs.existsSync(new URL('app/[rozsah]/zalohy', KOREN)), false)
ma('stránka Výdělky existuje', fs.existsSync(new URL('app/[rozsah]/dochazka/vydelky/page.tsx', KOREN)), true)

/* ======================================================================
   7. SERVEROVÉ AKCE ZÁLOH SE VRACEJÍ NA NOVOU ADRESU
   ====================================================================== */

globalThis.__akce = { cesty: [] }
const CACHE = js('export function revalidatePath(c, t) { globalThis.__akce.cesty.push(c) }')
const FIRMA_AKCE = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    // Pobočka v rozsahu: výplata zálohy ji od #77 vyžaduje (pobočka výdeje).
    'export async function zkusPristup() { return { stav: "ok", ctx: {}, scope: { branchId: "b1" } } }\n' +
    // Potvrzovací akce (25. 9.) rozsah ověřují; tady jen náhrada.
    'export function bezpecnyRozsah(ctx, r) { return { level: "branch", branchId: "b1", branchName: "", branchSlug: r } }\n',
)
const DOTAZ_AKCE = js(
  'export function funkceNeexistuje(e) { return e?.code === "PGRST202" || e?.code === "42883" }\n',
)
const SERVER_AKCE = js(
  'export async function getServerSupabase() {\n' +
    '  return {\n' +
    '    rpc: async () => ({ data: [{ zaloha: "z1", varovani: null }], error: null }),\n' +
    '    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Bára" } }) }) }) }),\n' +
    '  };\n' +
    '}\n',
)
// Od 25. 9. 2026 akce záloh potvrzují (majitel → getContext) a posílají
// push hned. Tady jde jen o adresy, takže obojí je prázdná náhrada;
// potvrzení a push ověřuje scripts/zalohy.test.mjs.
const AUTHZ_AKCE = js('export async function getContext() { return null }\n')
const PUSH_AKCE = js('export function naplanovatPushKeZdroji() {}\n')
const akce = await nactiModul('app/[rozsah]/dochazka/zalohy/akce.ts', [
  ['next/cache', CACHE],
  ['next/navigation', NAVIGACE],
  ['@/lib/authz', AUTHZ_AKCE],
  ['@/lib/firma', FIRMA_AKCE],
  ['@/lib/komunikace/push-hned', PUSH_AKCE],
  ['@/lib/mzdy', new URL('lib/mzdy.ts', KOREN).href],
  ['@/lib/supabase/dotaz', DOTAZ_AKCE],
  ['@/lib/supabase/server', SERVER_AKCE],
])

async function kamPresmeruje(fn, pole) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', ...pole })) fd.set(k, v)
  globalThis.__akce.cesty = []
  try {
    await fn(fd)
    return null
  } catch (e) {
    return e.adresa ?? String(e)
  }
}

console.log('\n== Akce záloh ==')
ma('storno → zpět na záložku Zálohy',
  await kamPresmeruje(akce.stornovatZalohu, { zaloha: 'z1', duvod: 'překlep' }), '/cerna-perla/dochazka/zalohy?ulozeno=storno')
ma('a obnoví novou adresu', globalThis.__akce.cesty.includes('/cerna-perla/dochazka/zalohy'), true)
ma('pozastavení → zpět na záložku Zálohy',
  await kamPresmeruje(akce.prepnoutPozastaveni, { pozastavit: '1' }), '/cerna-perla/dochazka/zalohy?ulozeno=pozastaveno')
ma('nastavení → zpět na záložku Zálohy',
  await kamPresmeruje(akce.ulozitNastaveniZaloh, { zobrazeni: 'odecitat', mez: '' }), '/cerna-perla/dochazka/zalohy?ulozeno=nastaveni')
{
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', zamestnanec: 'e1', castka: '500' })) fd.set(k, v)
  globalThis.__akce.cesty = []
  const vysledek = await akce.vyplatitZalohu({ stav: 'nic' }, fd)
  ma('výplata projde', vysledek.stav, 'hotovo')
  ma('a obnoví novou adresu, ne starou', globalThis.__akce.cesty.join(' '), '/cerna-perla/dochazka/zalohy')
}

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
