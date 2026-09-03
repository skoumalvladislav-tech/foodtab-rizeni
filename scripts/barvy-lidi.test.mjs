#!/usr/bin/env node
/**
 * Barva u člověka — jak ji ukáže kalendář.
 *
 * Pusť `node --experimental-strip-types scripts/barvy-lidi.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE
 *
 * Barva, kterou jde nastavit, ale nikde ji není vidět, je k ničemu.
 * Kontrola, která by ověřila jen zápis do databáze, by projít mohla
 * i tehdy, kdyby kalendář o sloupci vůbec nevěděl.
 *
 * Proto se tu vykreslí skutečný `rozpis.tsx` — týdenní i denní pohled —
 * a hledá se v hotovém HTML.
 *
 * ---------------------------------------------------------------------
 * CO SE HLÍDÁ NAVÍC
 *
 * Že barva člověka NESPLYNE s barvou pobočky. Pruh směny má výplň
 * v barvě pobočky, a dnes mají obě pobočky tutéž Růžovou — kdyby měl
 * člověk taky plochu, nepomohl by ani jiný odstín. Pobočka je plocha,
 * člověk proužek a čtvereček.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BARVY_LIDI, NAZVY_BAREV_LIDI, barvaNeboNic } from '../lib/barvy-lidi.ts'
import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/* --- podstrčené moduly ------------------------------------------------ */

const navigace = (dotaz) =>
  'data:text/javascript,' +
  encodeURIComponent(
    'export function useRouter() { return { refresh() {}, push() {} } }\n' +
      `export function useSearchParams() { return new URLSearchParams(${JSON.stringify(dotaz)}) }\n`,
  )

const AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function ulozitSmenu() { return { stav: "nic" } }')

const SABLONY_AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function nabidnoutSablony() { return [] }')

const ODKAZ =
  'data:text/javascript,' +
  encodeURIComponent(
    `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
      'export default function Link({ href, children, ...z }) {\n' +
      '  return createElement("a", { href, ...z }, children)\n' +
      '}\n',
  )

const nactiRozpis = (dotaz) =>
  nactiKomponentu('app/[rozsah]/smeny/rozpis.tsx', [
    ['next/navigation', navigace(dotaz)],
    ['next/link', ODKAZ],
    ['./smena', AKCE],
    ['./sablony', SABLONY_AKCE],
  ])

const RozpisTyden = await nactiRozpis('')
const RozpisDen = await nactiRozpis('pohled=den&den=2026-10-05')

/* --- data ------------------------------------------------------------- */

const SMENY = [
  {
    id: 's1',
    branch_id: 'b1',
    employee_id: 'e1',
    position_id: null,
    shift_date: '2026-10-05',
    starts_at: '08:00:00',
    ends_at: '16:00:00',
    status: 'planned',
    note: '',
  },
  {
    id: 's2',
    branch_id: 'b1',
    employee_id: 'e2',
    position_id: null,
    shift_date: '2026-10-05',
    starts_at: '16:00:00',
    ends_at: '22:00:00',
    status: 'planned',
    note: '',
  },
  {
    id: 's3',
    branch_id: 'b1',
    employee_id: null,
    position_id: null,
    shift_date: '2026-10-05',
    starts_at: '22:00:00',
    ends_at: '06:00:00',
    status: 'planned',
    note: '',
  },
]

const JMENA = new Map([
  ['e1', 'Anička Barevná'],
  ['e2', 'Bára Bezbarvá'],
])

/** e1 barvu má, e2 ne — obojí musí být v rozpisu čitelné. */
const BARVY = new Map([
  ['e1', 'indigo'],
  ['e2', null],
])

function vykresli(Komponenta, barvy = BARVY) {
  return renderToStaticMarkup(
    createElement(Komponenta, {
      smeny: SMENY,
      dnesni: '2026-10-05',
      dayStartsAt: '05:00',
      jmena: JMENA,
      barvy,
      pozice: new Map(),
      nazvyPobocek: new Map([['b1', 'Restaurace Černá Perla']]),
      rozsah: { level: 'branch', branchId: 'b1', branchName: 'Restaurace Černá Perla' },
      planovani: null,
    }),
  )
}

/** HTML bez značek — co člověk na obrazovce doopravdy přečte. */
function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const tyden = vykresli(RozpisTyden)
const den = vykresli(RozpisDen)

/* --- 1. kalendář barvu ukáže ------------------------------------------ */

console.log('\n== 1. Kalendář barvu ukáže ================================')

ma('týdenní pohled nese barvu člověka', tyden.includes('data-osoba="indigo"'), true)
ma('denní pohled taky', den.includes('data-osoba="indigo"'), true)
ma('a jméno je v obou napsané', text(tyden).includes('Anička Barevná'), true)

/*
  Značka se počítá. V týdnu je řádek na osobu — jedna značka na osobu,
  ne na směnu; kdyby se kreslila u každé směny, byl by z rozpisu koberec.
*/
const kolikVTydnu = [...tyden.matchAll(/data-osoba="indigo"/g)].length
ma('v týdnu jedna značka na osobu', kolikVTydnu, 1)

/*
  V dni jsou dvě: čtvereček u jména a proužek na pruhu směny. Proužek je
  ten, kvůli kterému se dá po pruzích přejet očima.
*/
const kolikVDni = [...den.matchAll(/data-osoba="indigo"/g)].length
ma('ve dni čtvereček u jména i proužek na směně', kolikVDni, 2)

/* --- 2. barva nikdy nestojí sama -------------------------------------- */

console.log('\n== 2. Barva sama nic nenese ===============================')

ma('u barevného člověka je název barvy v textu', text(tyden).includes('Indigová'), true)
ma('u toho bez barvy stojí „bez barvy“', text(tyden).includes('bez barvy'), true)
ma(
  'jméno stojí v rozpisu tak jako tak',
  text(tyden).includes('Bára Bezbarvá'),
  true,
)

/* --- 3. člověk bez barvy se vykreslí čitelně -------------------------- */

console.log('\n== 3. Bez barvy se vykreslí čitelně =======================')

/*
  Prázdný čtvereček s obrysem, ne mezera. Chybějící značka by posunula
  jméno o kus vedle a vypadala by jako chyba vykreslení.
*/
ma(
  'značka bez barvy má obrys, ne výplň',
  /border:1px solid var\(--line-2\)/.test(tyden),
  true,
)
ma('a nemá žádný klíč palety', /data-osoba="null"|data-osoba=""/.test(tyden), false)

const vsichniBezBarvy = vykresli(RozpisTyden, new Map())
ma(
  'i když barvu nemá nikdo, rozpis se vykreslí',
  text(vsichniBezBarvy).includes('Anička Barevná') &&
    text(vsichniBezBarvy).includes('Bára Bezbarvá'),
  true,
)
ma(
  'a žádná barevná značka v něm není',
  /data-osoba="/.test(vsichniBezBarvy),
  false,
)

/* --- 4. neobsazená směna značku nemá ---------------------------------- */

console.log('\n== 4. Neobsazená směna není ničí ==========================')

ma('„Neobsazeno“ v rozpisu stojí', text(tyden).includes('Neobsazeno'), true)
// Dvě osoby mají značku, třetí řádek (neobsazený) ne.
const znacekVTydnu = [...tyden.matchAll(/aria-hidden="true"[^>]*border-radius:3px/g)].length
ma('značky jsou jen u lidí, ne u neobsazené', znacekVTydnu, 2)

/* --- 5. pobočka je plocha, člověk proužek ----------------------------- */

console.log('\n== 5. S barvou pobočky to nesplyne ========================')

/*
  Nejdůležitější kontrola v tomhle souboru. Dnes mají obě pobočky
  Růžovou — kdyby barva člověka přebila výplň pruhu, nikdo by nepoznal,
  co je co.
*/
ma(
  'pruh směny drží výplň v barvě POBOČKY',
  den.includes('background:var(--branch-soft)'),
  true,
)
ma('a rámeček taky', den.includes('1px solid var(--branch)'), true)
ma(
  'barva člověka je proužek, ne plocha',
  /data-osoba="indigo"[^>]*width:4px|width:4px[^>]*data-osoba="indigo"/.test(den),
  true,
)
ma(
  'a nikde nepřepisuje --branch',
  /data-branch="indigo"/.test(den),
  false,
)

/* --- 6. paleta a její klíče ------------------------------------------- */

console.log('\n== 6. Paleta drží pohromadě ===============================')

const tokeny = fs.readFileSync(new URL('../app/_tokeny.css', import.meta.url), 'utf8')

/*
  Klíč bez pravidla v CSS by se vykreslil průhledný — značka by zmizela
  a vypadalo by to jako chyba vykreslení, ne jako chybějící odstín.
*/
for (const klic of BARVY_LIDI) {
  ma(`klíč ${klic} má pravidlo v _tokeny.css`, tokeny.includes(`[data-osoba="${klic}"]`), true)
  ma(`a český název`, typeof NAZVY_BAREV_LIDI[klic] === 'string', true)
}

ma('paleta má devět odstínů', BARVY_LIDI.length, 9)
ma('nové odstíny nepřibyly', /--b-[a-z]+:/.test(tokeny), true)

/* --- 7. cizí klíč se chová jako prázdno ------------------------------- */

console.log('\n== 7. Cizí klíč se chová jako prázdno =====================')

ma('hex místo klíče je prázdno', barvaNeboNic('#ff0000'), null)
ma('neznámý klíč taky', barvaNeboNic('duhova'), null)
ma('prázdný řetězec taky', barvaNeboNic(''), null)
ma('a klíč z palety projde', barvaNeboNic('rose'), 'rose')

const sNesmyslem = vykresli(RozpisTyden, new Map([['e1', 'duhova']]))
ma(
  'ručně upravený řádek nerozbije vykreslení',
  text(sNesmyslem).includes('Anička Barevná'),
  true,
)
ma('a značka se chová jako bez barvy', sNesmyslem.includes('data-osoba="duhova"'), false)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
