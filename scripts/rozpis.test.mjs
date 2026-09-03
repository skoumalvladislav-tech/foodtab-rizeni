#!/usr/bin/env node
/**
 * Zadávání směn z kalendáře — co je na obrazovce.
 *
 * Pusť `node --experimental-strip-types scripts/rozpis.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE TU OVĚŘUJE
 *
 * Že se do kalendáře DÁ KLIKNOUT a že se formulář otevře s tím, co má.
 * Pravidla o pobočce, překryvu a půlnoci hlídá
 * `supabase/tests/krok17_scenar.sql`; tady jde o to, co uvidí člověk.
 *
 * Vykresluje se skutečná komponenta z aplikace, ne její kopie. Bez toho
 * by kontrola tvrdila „tlačítko tam je“ nad obrazovkou, na které není —
 * a to je chyba, kterou tenhle projekt už zná.
 *
 * `next/navigation` a serverová akce se podstrkují: mimo Next se
 * nenačtou a do vykresleného HTML z nich stejně nic nejde.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/* --- podstrčené moduly ---------------------------------------------- */

const NAVIGACE =
  'data:text/javascript,' +
  encodeURIComponent(
    'export function useRouter() { return { push() {}, replace() {}, refresh() {} } }\n' +
      'export function useSearchParams() { return new URLSearchParams() }\n',
  )

const AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function ulozitSmenu() { return { stav: "nic" } }\n')

const ODKAZ =
  'data:text/javascript,' +
  encodeURIComponent(
    `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
      'export default function Link({ href, children, ...z }) {\n' +
      '  return createElement("a", { href, ...z }, children)\n' +
      '}\n',
  )

/*
  Nabídka šablon se sem podstrkuje prázdná. Tenhle soubor je o rozpisu
  a o formuláři směny; co která šablona nabídne, ověřuje sablony.test.mjs.

  Musí to stát u OBOU načtení, i u rozpisu. Rozpis si formulář natáhne
  rekurzivně a náhrady se předávají dál — kdyby je tady rozpis neměl,
  natáhl by se přes formulář skutečný modul se serverovou akcí a s ním
  půl aplikace.
*/
const SABLONY_AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function nabidnoutSablony() { return [] }')

const RozpisView = await nactiKomponentu('app/[rozsah]/smeny/rozpis.tsx', [
  ['next/navigation', NAVIGACE],
  ['next/link', ODKAZ],
  ['./smena', AKCE],
  ['./sablony', SABLONY_AKCE],
])

const FormularSmeny = await nactiKomponentu('app/[rozsah]/smeny/formular-smeny.tsx', [
  ['next/navigation', NAVIGACE],
  ['./smena', AKCE],
  ['./sablony', SABLONY_AKCE],
])

/* --- data ------------------------------------------------------------ */

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
    employee_id: null,
    position_id: null,
    shift_date: '2026-10-05',
    starts_at: '22:00:00',
    ends_at: '06:00:00',
    status: 'planned',
    note: '',
  },
]

const PLANOVANI = {
  rozsah: 'cerna-perla',
  pobocky: [{ id: 'b1', nazev: 'Restaurace Černá Perla' }],
  vychoziPobocka: 'b1',
  lide: [{ id: 'e1', jmeno: 'Láďa' }],
  pozice: [{ id: 'p1', label: 'Kuchař' }],
  sablony: [],
}

function rozpis(planovani) {
  return renderToStaticMarkup(
    createElement(RozpisView, {
      smeny: SMENY,
      dnesni: '2026-10-05',
      dayStartsAt: '05:00',
      jmena: new Map([['e1', 'Láďa']]),
      pozice: new Map(),
      nazvyPobocek: new Map([['b1', 'Restaurace Černá Perla']]),
      rozsah: { level: 'branch', branchId: 'b1', branchName: 'Restaurace Černá Perla' },
      planovani,
    }),
  )
}

/* =====================================================================
   Kalendář
   ================================================================== */

console.log('\n== Kdo smí plánovat, ten se doklikne ==')

const sPlanovanim = rozpis(PLANOVANI)
const bezPlanovani = rozpis(null)

// Výchozí pohled je týdenní; směna v něm musí být tlačítko, ne text.
ma('směna je klikací', /<button[^>]*>08:00–16:00<\/button>/.test(sPlanovanim), true)
ma('a je i křížek na prázdné políčko', sPlanovanim.includes('Přidat směnu '), true)

/*
  A ta mez: kdo plánovat nesmí, nesmí ani vidět tlačítka. Zámek to není
  — rozhoduje `shifts.manage` v databázi —, ale nabízet, co stejně
  neprojde, je horší než nenabízet nic.
*/
ma('bez oprávnění žádné klikací směny', /<button[^>]*>08:00–16:00<\/button>/.test(bezPlanovani), false)
ma('a žádné křížky', bezPlanovani.includes('Přidat směnu '), false)
ma('ale rozpis je vidět pořád', bezPlanovani.includes('08:00–16:00'), true)

console.log('\n== Neobsazená směna je vidět jako neobsazená ==')

ma('v rozpisu stojí „Neobsazeno“', sPlanovanim.includes('Neobsazeno'), true)
ma('a noční 22:00–06:00 taky', sPlanovanim.includes('22:00–06:00'), true)

/* =====================================================================
   Formulář
   ================================================================== */

console.log('\n== Formulář na novou směnu ==')

function formular(smena) {
  return renderToStaticMarkup(
    createElement(FormularSmeny, {
      rozsah: 'cerna-perla',
      den: '2026-10-07',
      smena,
      pobocky: PLANOVANI.pobocky,
      vychoziPobocka: 'b1',
      lide: PLANOVANI.lide,
      pozice: PLANOVANI.pozice,
      sablony: PLANOVANI.sablony,
      onZavrit: () => {},
    }),
  )
}

const novy = formular(null)

ma('nadpis je o nové směně', novy.includes('Nová směna'), true)
ma('datum je předvyplněné z kalendáře', novy.includes('value="2026-10-07"'), true)

/*
  Prázdný člověk je platná volba, ne chybějící údaj: `shifts.employee_id`
  je nullable s komentářem „sem někoho potřebujeme“.
*/
ma('jde nechat bez člověka', novy.includes('zatím nikdo (volná směna)'), true)
ma('lidé jsou v nabídce', novy.includes('Láďa'), true)
ma('pozice taky', novy.includes('Kuchař'), true)

// Zadání: v případě jediné pozice bude výběr u ostatních prázdný —
// formulář musí jít odeslat i bez ní.
ma('bez pozice to jde taky', novy.includes('— bez pozice —'), true)

ma('a je vidět, co znamená konec dřív než začátek',
  novy.includes('22:00–06:00 je osm hodin'), true)

console.log('\n== Formulář na úpravu je předvyplněný ==')

const uprava = formular({
  id: 's1',
  branch_id: 'b1',
  employee_id: 'e1',
  position_id: 'p1',
  shift_date: '2026-10-05',
  starts_at: '22:00:00',
  ends_at: '06:00:00',
  note: 'noční',
})

ma('nadpis je o úpravě', uprava.includes('Upravit směnu'), true)
ma('nese id upravované směny', uprava.includes('value="s1"'), true)
ma('datum té směny', uprava.includes('value="2026-10-05"'), true)

/*
  Časy se ořezávají na HH:MM — `type="time"` s „22:00:00“ políčko
  nepředvyplní a člověk by uviděl prázdno.
*/
ma('začátek 22:00, ne 22:00:00', uprava.includes('value="22:00"'), true)
ma('konec 06:00', uprava.includes('value="06:00"'), true)
ma('a poznámka', uprava.includes('value="noční"'), true)

/*
  A že se nepředvyplní výchozími hodnotami nové směny — to by u úpravy
  přepsalo noční na ranní, aniž by si toho někdo všiml.
*/
ma('rozhodně ne výchozích 08:00', uprava.includes('value="08:00"'), false)

console.log('\n== Okno se překreslí, když se otevře jiná směna ==')

/*
  `defaultValue` se uplatní jen při prvním připojení. Kdyby okno
  zůstalo tímtéž prvkem, ukázalo by u druhé směny časy té první —
  přesně tak se 2. 9. předvyplňoval odchod jako příchod. Proto `key`.
*/
const zdroj = (await import('node:fs')).readFileSync(
  new URL('../app/[rozsah]/smeny/rozpis.tsx', import.meta.url),
  'utf8',
)
ma('formulář má key podle otevřené směny',
  zdroj.includes('key={otevrene.smena?.id ||'), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
