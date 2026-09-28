#!/usr/bin/env node
/**
 * Docházka člověka po dnech — úseky, úprava a storno (27. 9. 2026).
 *
 * Pusť `node scripts/dochazka-cloveka.test.mjs` (Node 22.6+ s odstraňováním
 * typů).
 *
 * ---------------------------------------------------------------------
 * CO SE TU OVĚŘUJE — VYKRESLENÍM A SPUŠTĚNÍM, NE ČTENÍM ZDROJÁKU
 *
 *   1. lib/useky-dochazky.ts — čistá logika: převod řádku z databáze,
 *      dny, součty, časy v pásmu pobočky, adresy
 *   2. obrazovka (smeny-cloveka.tsx) se vykreslí s podstrčenými řádky:
 *      součet dne z databáze (ne sečtený), stornované přeškrtnuté a
 *      nesčítané, zdroj slovy, otevřený úsek „do mzdy se nepočítá",
 *      „bez sazby" místo 0 Kč, časy v pásmu pobočky, tlačítka jen se
 *      správou, formulář předvyplněný na zdi pobočky, čas odchodu se
 *      nedomýšlí
 *   3. STRÁNKA /clovek/[id] s podstrčenou databází: bez attendance.read
 *      se na úseky vůbec nezeptá, vlastní id → Můj účet, měsíc z
 *      provozního dne, peníze jen s payroll.read na pobočce člověka,
 *      kontrakt jmen parametrů a sloupců s migrací
 *   4. serverové akce: volají RPC s hodinou na zdi BEZ převodu, první
 *      linie attendance.manage, hláška z databáze beze změny, návrat
 *      výčtem, ne adresou
 *   5. boční panel živého přehledu: storno příchodu jen se správou té
 *      pobočky a u sebe jen majitel; odkaz na měsíc člověka
 *
 * ---------------------------------------------------------------------
 * ČEHO SE TÍM NEDOSÁHNE
 *
 * Že databáze odmítne cizí pobočku, překryv, jiný provozní den nebo
 * přepárování, tady neuvidíš — to je druhá linie a hlídá ji
 * supabase/tests/krok63_scenar.sql (a workflow Databáze na PostgreSQL 16).
 * Vzhled (telefon 375 px, tmavý režim) ověřují snímky obrazovky.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
/*
  Hodiny a koruny mají mezi číslem a jednotkou PEVNOU mezeru (lib/mzdy),
  ať se nezalomí. Porovnává se po převodu na obyčejnou.
*/
const nb = (s) => (typeof s === 'string' ? s.replace(/\u00a0/g, ' ') : s)
const ma = (popis, sk, ce) => {
  sk = nb(sk)
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)
const REACT = JSON.stringify(import.meta.resolve('react'))
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

/** Text z HTML: bez značek, pevné mezery na obyčejné. */
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** „0 Kč" jako samostatná částka — ne konec „10 Kč" ani „1 000 Kč". */
const nulaKorun = (html) => /(?<![\d\s ])0[\s ]Kč/.test(text(html))

/** HTML jedné karty dne (section id="den-…"). */
function kartaDne(html, den) {
  const m = html.match(new RegExp(`<section[^>]*id="den-${den}"[^>]*>([\\s\\S]*?)</section>`))
  return m ? m[1] : null
}

/** Atributy <input name="…"> v kusu HTML. */
function pole(html, name) {
  const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))
  if (!m) return null
  const hodnota = m[0].match(/value="([^"]*)"/)
  return { value: hodnota ? hodnota[1] : null, required: /\srequired=""/.test(m[0]), typ: (m[0].match(/type="([^"]*)"/) ?? [])[1] }
}

/** Formuláře (form … /form) v kusu HTML. */
const formulare = (html) => [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0])

/* ======================================================================
   PODSTRČENÉ IMPORTY
   ====================================================================== */

const ODKAZ = js(
  `import { createElement } from ${REACT}\n` +
    'export default function Link({ href, children, prefetch, scroll, ...z }) {\n' +
    '  return createElement("a", { href, ...z }, children)\n' +
    '}\n',
)
/*
  Drawer kreslí přes portál do document.body a na serveru nevykreslí
  nic. Tady kreslí obsah VŽDYCKY, na místě mezi dvě značky — aby šel
  formulář uvnitř přečíst, i když ho otevírá až klik.
*/
const DRAWER = js(
  `import { createElement, Fragment } from ${REACT}\n` +
    'export default function Drawer({ nadpis, children }) {\n' +
    '  return createElement(Fragment, null, "⟦PANEL " + nadpis + "⟧", children, "⟦/PANEL⟧")\n' +
    '}\n',
)
const AKCE = js('export async function upravitUsek() {}\nexport async function stornovatUsek() {}\n')
const ZAKLAD = [
  ['next/link', ODKAZ],
  ['react-dom', import.meta.resolve('react-dom')],
  ['@/components/ui/Drawer', DRAWER],
  ['./akce', AKCE],
]

/* ======================================================================
   1. ČISTÁ LOGIKA
   ====================================================================== */

const lib = await import(new URL('lib/useky-dochazky.ts', KOREN))

const Z_PRAHA = 'Europe/Prague'
const Z_NY = 'America/New_York'

/** Řádek z public.useky_cloveka — všechny sloupce, rozumné výchozí hodnoty. */
const radek = (o) => ({
  druh: 'usek',
  den: '2026-09-24',
  poradi: 1,
  udalost_druh: null,
  prichod_id: null,
  prichod: null,
  prichod_pobocka: 'B1',
  prichod_zona: Z_PRAHA,
  prichod_zdroj: 'kod',
  prichod_poznamka: null,
  prichod_zadal: null,
  prichod_nahrazuje: null,
  prichod_mimo_rozpis: false,
  prichod_uzavreno: null,
  odchod_id: null,
  odchod: null,
  odchod_pobocka: 'B1',
  odchod_zona: Z_PRAHA,
  odchod_zdroj: 'kod',
  odchod_poznamka: null,
  odchod_zadal: null,
  odchod_nahrazuje: null,
  odchod_mimo_rozpis: false,
  odchod_uzavreno: null,
  prestavky_sekund: 0,
  pausal_minut: 0,
  hrubych_sekund: null,
  cistych_sekund: 0,
  stornovano_kdy: null,
  stornoval_jmeno: null,
  duvod_storna: null,
  nahrazeno: false,
  den_minut: 0,
  smi_spravovat: true,
  // Měsíc níž má den 22. 9. zčásti jinde → celý měsíc volající nevidí.
  mesic_cely: false,
  ...o,
})

/*
  ZÁŘÍ 2026 jednoho člověka — jeden den na jeden případ obrazovky.

  23. 9. pobočka Z v New Yorku: 13:00–21:00 UTC = 9:00–17:00 na tamní zdi
  24. 9. 8:00 kód → 21:10 PIN, paušál 10 min, den 780 min
  25. 9. 22:00 → 4:30 (26. 9.) přes půlnoc; odchod ručně, nahradil
         odchod 23:40 (kód); DB říká den 381 min, úseky 380 (sekundy)
  26. 9. otevřený příchod 8:39 (dnešek) + stornovaný příchod 7:00
  27. 9. odchod bez příchodu 16:00 a přestávka mimo úsek
  22. 9. část dne na pobočce, kam volající nevidí (den_minut NULL)
*/
const RADKY = [
  radek({
    den: '2026-09-23', prichod_id: 'z-in', prichod: '2026-09-23T13:00:00Z', prichod_pobocka: 'BZ', prichod_zona: Z_NY,
    odchod_id: 'z-out', odchod: '2026-09-23T21:00:00Z', odchod_pobocka: 'BZ', odchod_zona: Z_NY,
    hrubych_sekund: 28800, pausal_minut: 10, cistych_sekund: 28200, den_minut: 470,
  }),
  radek({
    den: '2026-09-24', prichod_id: 'a-in', prichod: '2026-09-24T06:00:00Z',
    odchod_id: 'a-out', odchod: '2026-09-24T19:10:00Z', odchod_zdroj: 'pin',
    hrubych_sekund: 47400, pausal_minut: 10, cistych_sekund: 46800, den_minut: 780,
  }),
  radek({
    den: '2026-09-25', prichod_id: 'b-in', prichod: '2026-09-25T20:00:00Z',
    odchod_id: 'b-out', odchod: '2026-09-26T02:30:00Z', odchod_zdroj: 'rucne',
    odchod_zadal: 'Petr Novák', odchod_poznamka: 'zapomněl telefon', odchod_nahrazuje: 'b-out-stary',
    hrubych_sekund: 23400, pausal_minut: 10, cistych_sekund: 22800, den_minut: 381,
  }),
  radek({
    druh: 'stornovano', den: '2026-09-25', poradi: null, udalost_druh: 'out',
    prichod_pobocka: null, prichod_zdroj: null,
    odchod_id: 'b-out-stary', odchod: '2026-09-25T21:40:00Z',
    stornovano_kdy: '2026-09-27T12:02:00Z', stornoval_jmeno: 'Jana Vedoucí',
    duvod_storna: 'Oprava úseku: zapomněl telefon', nahrazeno: true, den_minut: 381, smi_spravovat: false,
  }),
  radek({
    druh: 'otevreny', den: '2026-09-26', prichod_id: 'c-in', prichod: '2026-09-26T06:39:00Z',
    odchod_pobocka: null, odchod_zdroj: null, den_minut: 0,
  }),
  radek({
    druh: 'stornovano', den: '2026-09-26', poradi: null, udalost_druh: 'in',
    prichod_id: 'c-in-omyl', prichod: '2026-09-26T05:00:00Z',
    odchod_pobocka: null, odchod_zdroj: null,
    stornovano_kdy: '2026-09-26T05:03:00Z', stornoval_jmeno: 'Jana Vedoucí',
    duvod_storna: 'Storno úseku: píchnutí omylem', den_minut: 0, smi_spravovat: false,
  }),
  radek({
    druh: 'odchod_bez_prichodu', den: '2026-09-27', poradi: 1, udalost_druh: 'out',
    prichod_pobocka: null, prichod_zdroj: null,
    odchod_id: 'd-out', odchod: '2026-09-27T14:00:00Z', den_minut: 0,
  }),
  radek({
    druh: 'prestavka_mimo', den: '2026-09-27', poradi: 2, udalost_druh: 'break_end',
    prichod_pobocka: null, prichod_zdroj: null,
    odchod_id: 'd-be', odchod: '2026-09-27T15:00:00Z', den_minut: 0,
  }),
  radek({
    den: '2026-09-22', prichod_id: 'e-in', prichod: '2026-09-22T06:00:00Z',
    odchod_id: 'e-out', odchod: '2026-09-22T10:00:00Z', odchod_pobocka: 'B2',
    hrubych_sekund: 14400, cistych_sekund: 14400, den_minut: null, smi_spravovat: false,
  }),
]

const PENIZE = new Map([
  ['2026-09-23', { haleru: 117500 }],
  ['2026-09-24', { haleru: 260000 }],
  // 25. 9. bez sazby: NULL, nikdy 0 Kč.
  ['2026-09-25', { haleru: null }],
])

console.log('\n== Převod řádku z databáze ==')
const prevedene = RADKY.map(lib.naRadekUseku)
ma('všech 9 řádků se převede', prevedene.filter(Boolean).length, 9)
ma('neznámý druh se nekreslí jako něco, čím není', lib.naRadekUseku({ ...radek({}), druh: 'hadej' }), null)
ma('řádek bez dne taky ne', lib.naRadekUseku({ ...radek({}), den: null }), null)
ma('pásmo pobočky se nese', prevedene[0].prichod.zona, Z_NY)
ma('bez pásma výchozí Praha, ne pásmo serveru', lib.naRadekUseku(radek({ prichod_id: 'x', prichod: '2026-09-24T06:00:00Z', prichod_zona: null })).prichod.zona, 'Europe/Prague')
ma('konec bez id není konec (otevřený úsek nemá odchod)', prevedene[4].odchod, null)
ma('den_minut NULL zůstane NULL', prevedene[8].denMinut, null)

console.log('\n== Časy v pásmu pobočky (pravidlo 11) ==')
ma('UTC 20:00 → 22:00 v Praze (letní čas)', lib.casZaznamu(prevedene[2].prichod), '22:00')
ma('UTC 13:00 → 9:00 v New Yorku', lib.casZaznamu(prevedene[0].prichod), '09:00')
ma('odchod po půlnoci i s datem', lib.casSDnem(prevedene[2].odchod, '2026-09-25'), '26. 9. 04:30')
ma('odchod téhož dne jen časem', lib.casSDnem(prevedene[1].odchod, '2026-09-24'), '21:10')
ma('předvyplnění formuláře: datum a čas na zdi pobočky', JSON.stringify(lib.naZdi(prevedene[0].prichod)), JSON.stringify({ datum: '2026-09-23', cas: '09:00' }))
ma('zimní čas: UTC 7:00 v lednu → 8:00 v Praze', lib.casZaznamu({ ...prevedene[1].prichod, cas: '2026-01-15T07:00:00Z' }), '08:00')

console.log('\n== Věty ==')
ma('den nadpisem', lib.denNadpis('2026-09-25'), 'Pá 25. 9.')
ma('neděle', lib.denNadpis('2026-09-27'), 'Ne 27. 9.')
ma('výpočet s paušálem', lib.vypocetUseku(prevedene[1]), '13 h 10 min − paušál 10 min = 13 h 0 min')
ma('výpočet s přestávkou', lib.vypocetUseku({ ...prevedene[1], prestavkySekund: 1200 }), '13 h 10 min − přestávka 20 min = 13 h 0 min')
ma('bez odpočtu jen čisté', lib.vypocetUseku({ ...prevedene[1], pausalMinut: 0, cistychSekund: 47400 }), '13 h 10 min')
ma('ruční zápis: kdo a proč', lib.rucneSlovy(prevedene[2].odchod), 'ručně · Petr Novák: zapomněl telefon')
ma('píchnutí nemá „ručně"', lib.rucneSlovy(prevedene[1].prichod), null)
ma('PIN slovem', lib.zdrojSlovy(prevedene[1].odchod), 'PIN na tabletu')
const den25 = lib.seskupitPoDnech(prevedene).find((d) => d.den === '2026-09-25')
ma('opraveno z (čas a zdroj starého záznamu)', lib.opravenoZ(prevedene[2].odchod, den25.stornovane), 'opraveno z 23:40 (kód)')
ma('starý záznam volající nevidí: jen „opraveno"', lib.opravenoZ(prevedene[2].odchod, []), 'opraveno')
ma('otevřený úsek: proč se nepočítá', lib.procSeNepocita(prevedene[4]), 'Chybí odchod — do mzdy se nepočítá.')

console.log('\n== Dny a součty ==')
const dny = lib.seskupitPoDnech(prevedene, PENIZE)
ma('dny od prvního k poslednímu', dny.map((d) => d.den.slice(8)).join(','), '22,23,24,25,26,27')
ma('stornované stranou, ne mezi úseky', `${den25.useky.length}/${den25.stornovane.length}`, '1/1')
ma('nezapočítané stranou', dny.find((d) => d.den === '2026-09-27').nezapocitane.length, 2)
const s = lib.souhrnMesice(dny, PENIZE)
ma('měsíc = Σ den_minut viditelných dnů (470+780+381)', s.minut, 1631)
ma('den bez celého pohledu → „částečně"', s.castecne, true)
ma('dny s uzavřeným úsekem', s.dni, 4)
ma('nedokončené: otevřený + osamělý odchod + přestávka mimo', s.nedokoncene, 3)
ma('opravy = stornované', s.opravy, 2)
ma('peníze: jen dny se sazbou', s.haleru, 377500)
ma('a příznak „bez sazby"', s.bezSazby, true)
ma('bez práva na peníze: null, ne nula', lib.souhrnMesice(dny, null).haleru, null)
ma('den bez řádku peněz nemá „0 Kč"', dny.find((d) => d.den === '2026-09-26').penize, undefined)

console.log('\n== Celý měsíc, nebo jen část (mesic_cely) ==')
/*
  Den odpracovaný CELÝ na pobočce, kam volající nevidí, v řádcích není
  vůbec — žádný den s NULL součtem ho neprozradí. Rozhoduje příznak
  z databáze; a peníze se sčítají ze VŠECH dnů (= Výdělky), ne jen
  z viditelných.
*/
const celeDny = (cely) =>
  lib.seskupitPoDnech(
    prevedene.filter((r) => r.denMinut !== null).map((r) => ({ ...r, mesicCely: cely })),
    PENIZE,
  )
ma('všechny dny vidět a měsíc celý → není „částečně"', lib.souhrnMesice(celeDny(true), PENIZE).castecne, false)
ma('všechny viditelné dny celé, ale měsíc ne (den celý jinde) → „částečně"', lib.souhrnMesice(celeDny(false), PENIZE).castecne, true)
ma('neznámý příznak (starý tvar řádku) → opatrně „není celý"', lib.naRadekUseku({ ...radek({}), mesic_cely: undefined }).mesicCely, false)
const PENIZE_S_JINDE = new Map([...PENIZE, ['2026-09-21', { haleru: 50000 }]])
const sJinde = lib.souhrnMesice(celeDny(true), PENIZE_S_JINDE)
ma('peníze: i den, jehož úseky nevidím (= Výdělky)', sJinde.haleru, 427500)
ma('… a kolik takových dnů', sJinde.dnuPenezJinde, 1)
ma('… peníze ze dne jinde = měsíc není celý', sJinde.castecne, true)

console.log('\n== Pořadí řádků dne podle času ==')
/*
  Automat vydá druhý příchod v 18:15 (pořadí 1) dřív než úsek 7:30 →
  18:15:37 (pořadí 2). Čte se podle času.
*/
const DEN_PORADI = [
  radek({ druh: 'navic_prichod', den: '2026-09-24', poradi: 1, udalost_druh: 'in', prichod_id: 'n-in', prichod: '2026-09-24T16:15:00Z', prichod_zdroj: 'rucne', odchod_pobocka: null, odchod_zdroj: null }),
  radek({ den: '2026-09-24', poradi: 2, prichod_id: 'u-in', prichod: '2026-09-24T05:30:00Z', odchod_id: 'u-out', odchod: '2026-09-24T16:15:37Z', hrubych_sekund: 38737, cistych_sekund: 36937, pausal_minut: 30 }),
  radek({ den: '2026-09-24', poradi: 3, prichod_id: 'v-in', prichod: '2026-09-24T19:10:57Z', odchod_id: 'v-out', odchod: '2026-09-24T19:11:07Z', hrubych_sekund: 10, cistych_sekund: 10 }),
].map(lib.naRadekUseku)
ma('podleCasu: úsek 7:30, druhý příchod 18:15, úsek 21:10', lib.podleCasu(DEN_PORADI).map((r) => r.prichod.id).join(','), 'u-in,n-in,v-in')
ma('… a shodný čas rozhodne pořadí automatu', lib.podleCasu([{ ...DEN_PORADI[1], poradi: 5 }, { ...DEN_PORADI[1], poradi: 4, druh: 'otevreny' }]).map((r) => r.poradi).join(','), '4,5')

console.log('\n== Úsek 0 min (příchod a odchod ve stejnou chvíli) ==')
const NULOVY = lib.naRadekUseku(radek({ den: '2026-09-27', prichod_id: 'z0-in', prichod: '2026-09-27T07:00:00Z', prichod_zdroj: 'rucne', odchod_id: 'z0-out', odchod: '2026-09-27T07:00:00Z', odchod_zdroj: 'rucne', hrubych_sekund: 0, cistych_sekund: 0 }))
ma('nulový úsek slovy', lib.nulovyUsekSlovy(NULOVY)?.startsWith('Příchod a odchod ve stejnou chvíli'), true)
ma('úsek o 10 s nulový není', lib.nulovyUsekSlovy(DEN_PORADI[2]), null)

console.log('\n== Adresa ==')
ma('měsíc z adresy', lib.platnyMesic('2026-08'), '2026-08')
ma('nesmysl v adrese → nic', lib.platnyMesic('2026-13'), null)
ma('přes Silvestra', lib.posunMesic('2026-01-01', -1), '2025-12-01')
ma('odchod po půlnoci přes konec roku', lib.dalsiDen('2026-12-31'), '2027-01-01')
ma('odkud: výčet, ne adresa', lib.naOdkud('https://zlo.example'), null)
ma('zpět do Výdělků i s měsícem', lib.odkazZpet('cerna-perla', 'vydelky', 'e1', '2026-09').href, '/cerna-perla/dochazka/vydelky?mesic=2026-09')
ma('zpět do přehledu s otevřeným člověkem', lib.odkazZpet('cerna-perla', 'prehled', 'e1', '2026-09').href, '/cerna-perla/dochazka?osoba=e1')
ma('neznámo odkud → Docházka', lib.odkazZpet('cerna-perla', null, 'e1', '2026-09').href, '/cerna-perla/dochazka')
ma('adresa člověka', lib.adresaCloveka('firma', 'e1', { mesic: '2026-09', odkud: 'lide' }), '/firma/dochazka/clovek/e1?mesic=2026-09&z=lide')

/* ======================================================================
   2. OBRAZOVKA
   ====================================================================== */

const SmenyCloveka = await nactiKomponentu('app/[rozsah]/dochazka/clovek/smeny-cloveka.tsx', ZAKLAD)

const vykresli = (n = {}) =>
  nb(renderToStaticMarkup(
    createElement(SmenyCloveka, {
      rozsah: 'cerna-perla',
      osoba: { id: 'e1', jmeno: 'Karel Novák' },
      mesic: '2026-09-01',
      obdobi: 'tento',
      dnes: '2026-09-26',
      dny: lib.seskupitPoDnech(prevedene, PENIZE),
      penize: PENIZE,
      pobocky: { B1: 'Černá Perla', B2: 'Bernard', BZ: 'Z' },
      spravovane: [{ id: 'B1', nazev: 'Černá Perla' }, { id: 'BZ', nazev: 'Z' }],
      smiZapsat: true,
      odkud: 'vydelky',
      predchozi: { href: '/p', mesic: '2026-08-01' },
      nasledujici: null,
      vysledek: null,
      ...n,
    }),
  ))

const html = vykresli()

console.log('\n== Součet dne z databáze, ne sečtený ==')
const k25 = kartaDne(html, '2026-09-25') ?? ''
ma('karta 25. 9. je na stránce', k25.length > 0, true)
ma('součet 25. 9. = den_minut z DB (381), ne úseky (380)', /ds-cislo">6 h 21 min</.test(k25), true)
ma('… a ne „6 h 20 min" v hlavičce dne', /ds-uc-den-soucet[^]*?6 h 20 min/.test(k25.split('ds-uc-useky')[0]), false)
ma('měsíc v kartě Odpracováno = Σ dnů', /Odpracováno<\/h2><\/div><p class="ds-kpi-hodnota ds-cislo">27 h 11 min</.test(html), true)
ma('karta upozorní, že vidím jen část', text(html).includes('jen pobočky, kam vidíte — není to celá mzda'), true)
ma('den, který nevidím celý: bez součtu, s větou', text(kartaDne(html, '2026-09-22') ?? '').includes('součet jen s celým dnem'), true)

console.log('\n== Stornované a nahrazené: přeškrtnuté, nesčítané ==')
const k26 = kartaDne(html, '2026-09-26') ?? ''
ma('stornovaný příchod přeškrtnutý', /<s>07:00 příchod · kód<\/s>/.test(k26), true)
ma('… s „Stornováno", kdo a proč', text(k26).includes('Stornováno 26. 9. 07:03 · Jana Vedoucí · Storno úseku: píchnutí omylem'), true)
ma('nahrazený odchod: „Nahrazeno opravou"', text(k25).includes('Nahrazeno opravou'), true)
ma('storna jsou v rozbalovátku s počtem', /<summary>Stornované a nahrazené \(1\)<\/summary>/.test(k26), true)
ma('stornovaný příchod se do dne nesčítá (26. 9. = 0 min)', /ds-cislo">0 h 0 min</.test(k26), true)
ma('karta Opravy = 2', /Opravy<\/h2><\/div><p class="ds-kpi-hodnota ds-cislo">2</.test(html), true)

console.log('\n== Zdroj slovy, ruční zápis nevypadá jako píchnutí ==')
const k24 = kartaDne(html, '2026-09-24') ?? ''
ma('PIN na tabletu', text(k24).includes('PIN na tabletu'), true)
ma('kód', text(k24).includes('kód'), true)
ma('ručně · kdo: proč', text(k25).includes('Odchod ručně · Petr Novák: zapomněl telefon'), true)
ma('ruční čip má tužku a je odlišený', /data-zdroj="rucne"><svg/.test(k25), true)
ma('opraveno z 23:40 (kód)', text(k25).includes('Odchod opraveno z 23:40 (kód)'), true)
ma('výpočet u úseku', text(k24).includes('13 h 10 min − paušál 10 min = 13 h 0 min'), true)

console.log('\n== Otevřený a nezapočítané ==')
ma('otevřený: „do mzdy se nepočítá"', text(k26).includes('Chybí odchod — do mzdy se nepočítá.'), true)
ma('dnešní otevřený: „V práci od 8:39"', text(k26).includes('V práci od 08:39.'), true)
ma('otevřený má „Doplnit odchod" jako hlavní tlačítko', /class="ft-tl ft-tl-hlavni ds-uc-tlacitko"[^>]*>Doplnit odchod/.test(k26), true)
ma('a jen jedno zlaté tlačítko na kartě', (k26.match(/ft-tl-hlavni ds-uc-tlacitko/g) ?? []).length, 1)
const k27 = kartaDne(html, '2026-09-27') ?? ''
ma('odchod bez příchodu slovy', text(k27).includes('Odchod bez příchodu — do mzdy se nepočítá.'), true)
ma('přestávka mimo úsek slovy', text(k27).includes('Přestávka mimo úsek — nepočítá se.'), true)
ma('odchod bez příchodu: „Doplnit příchod"', text(k27).includes('Doplnit příchod'), true)
ma('nezapočítané: „Stornovat záznam" u obou', (k27.match(/ds-uc-tlacitko">Stornovat záznam</g) ?? []).length, 2)
ma('karta Nedokončené = 3 s kotvami na dny',
  /Nedokončené<\/h2><\/div><p class="ds-kpi-hodnota ds-cislo">3</.test(html) && html.includes('href="#den-2026-09-26"') && html.includes('href="#den-2026-09-27"'), true)

console.log('\n== Peníze: „bez sazby", nikdy 0 Kč ==')
ma('den bez sazby: „bez sazby"', /ds-uc-den-penize">bez sazby</.test(k25), true)
ma('den se sazbou: částka', /ds-uc-den-penize">2 600 Kč</.test(k24), true)
ma('karta Vyděláno: součet dnů se sazbou', /Vyděláno<\/h2><\/div><p class="ds-kpi-hodnota ds-cislo">3 775 Kč</.test(html), true)
ma('… a „část dnů bez sazby"', text(html).includes('část dnů bez sazby — v součtu chybí'), true)
ma('nikde „0 Kč"', nulaKorun(html), false)
const bezPenez = vykresli({ penize: null, dny: lib.seskupitPoDnech(prevedene, null) })
ma('bez payroll.read: žádné Kč, žádná karta Vyděláno', `${bezPenez.includes('Kč')}/${bezPenez.includes('Vyděláno')}`, 'false/false')
ma('detektor „0 Kč" umí spadnout', nulaKorun('<p>0 Kč</p>'), true)

console.log('\n== Karta Odpracováno a Vyděláno: celý měsíc, nebo část ==')
const celyMesic = vykresli({ dny: celeDny(true), penize: PENIZE })
ma('celý měsíc: „uzavřené úseky, jako mzda"', text(celyMesic).includes('uzavřené úseky, jako mzda'), true)
const denJinde = vykresli({ dny: celeDny(false), penize: PENIZE_S_JINDE })
ma('den celý jinde (žádný NULL den): „jen pobočky, kam vidíte"', `${text(denJinde).includes('jen pobočky, kam vidíte — není to celá mzda')}/${text(denJinde).includes('jako mzda')}`, 'true/false')
ma('Vyděláno = všechny dny peněz (= Výdělky): 4 275 Kč', /Vyděláno<\/h2><\/div><p class="ds-kpi-hodnota ds-cislo">4 275 Kč</.test(denJinde), true)
ma('… „včetně 1 dne na pobočkách, kam docházku nevidíte"', text(denJinde).includes('včetně 1 dne na pobočkách, kam docházku nevidíte'), true)
const nicVidet = vykresli({ dny: [], penize: new Map([['2026-09-21', { haleru: 50000 }]]) })
ma('nic vidět, ale peníze jinde: mzda podle Výdělků v prázdném stavu', text(nicVidet).includes('Mzda za měsíc podle Výdělků: 500 Kč — ze dnů na pobočkách, kam docházku nevidíte.'), true)

console.log('\n== Pořadí a nulový úsek na obrazovce ==')
const htmlPoradi = vykresli({ dny: lib.seskupitPoDnech([...DEN_PORADI, NULOVY]), penize: null })
const kPoradi = kartaDne(htmlPoradi, '2026-09-24') ?? ''
ma('karta dne: úsek 07:30 nad druhým příchodem 18:15', kPoradi.indexOf('07:30') >= 0 && kPoradi.indexOf('07:30') < kPoradi.indexOf('18:15 <span class="ds-uc-druh">'), true)
ma('… a druhý příchod nad večerním úsekem 21:10', kPoradi.indexOf('18:15 <span class="ds-uc-druh">') < kPoradi.indexOf('21:10'), true)
ma('nulový úsek: věta místo výpočtu', text(kartaDne(htmlPoradi, '2026-09-27') ?? '').includes('Příchod a odchod ve stejnou chvíli — úsek má 0 min'), true)

console.log('\n== Časy v pásmu pobočky na obrazovce ==')
ma('úsek 25. 9.: 22:00 → 26. 9. 04:30', /22:00<span aria-hidden="true"> → <\/span><span class="sr-only"> až <\/span>26\. 9\. 04:30/.test(k25), true)
const k23 = kartaDne(html, '2026-09-23') ?? ''
ma('pobočka v New Yorku: 09:00 → 17:00, ne pražských 15:00', /09:00<span aria-hidden="true"> → <\/span><span class="sr-only"> až <\/span>17:00/.test(k23) && !k23.includes('15:00'), true)
ma('víc poboček v měsíci: pobočka u zdroje', text(k23).includes('kód · Z'), true)

console.log('\n== Formulář úpravy (panel) ==')
const f24 = formulare(k24)[0] ?? ''
ma('úprava úseku: id obou konců a kdo', `${pole(f24, 'prichod_id')?.value}/${pole(f24, 'odchod_id')?.value}/${pole(f24, 'zamestnanec')?.value}`, 'a-in/a-out/e1')
ma('… návrat: měsíc RRRR-MM, odkud, den', `${pole(f24, 'mesic')?.value}/${pole(f24, 'z')?.value}/${pole(f24, 'den')?.value}`, '2026-09/vydelky/2026-09-24')
ma('… předvyplněno na zdi pobočky: 2026-09-24 08:00 → 21:10',
  `${pole(f24, 'prichod_datum')?.value} ${pole(f24, 'prichod_cas')?.value} → ${pole(f24, 'odchod_cas')?.value}`, '2026-09-24 08:00 → 21:10')
ma('… datum a čas povinné', pole(f24, 'prichod_cas')?.required && pole(f24, 'odchod_datum')?.required, true)
ma('… důvod povinný (aspoň 3 znaky)', /<textarea name="duvod" required="" minLength="3"/i.test(f24), true)
ma('… výběr pobočky při dvou spravovaných', /<select name="prichod_pobocka"/.test(f24), true)
ma('… uvnitř i „Stornovat úsek…", červeně (ft-tl-nebezpecne)', /class="ft-tl ft-tl-nebezpecne">Stornovat úsek…<\/button>/.test(f24), true)
ma('„Stornovat úsek" i přímo na kartě vedle „Upravit"', /ds-uc-tlacitko">Stornovat úsek<\/button>/.test(k24) && /ds-uc-tlacitko"><svg[^]*?<\/svg>Upravit<\/button>/.test(k24), true)
const stornoUseku = formulare(k24).find((f) => f.includes('data-krok="storno"')) ?? ''
ma('… jeho storno posílá příchod i odchod úseku', `${pole(stornoUseku, 'prichod_id')?.value}/${pole(stornoUseku, 'odchod_id')?.value}`, 'a-in/a-out')
const f23 = formulare(k23)[0] ?? ''
ma('New York: formulář 09:00, ne 15:00', pole(f23, 'prichod_cas')?.value, '09:00')
const f26 = formulare(k26)
const doplnit = f26.find((f) => f.includes('name="bez_odchodu"')) ?? ''
ma('doplnit odchod: čas odchodu se NEdomýšlí (prázdný)', pole(doplnit, 'odchod_cas')?.value, '')
ma('… datum odchodu = den příchodu', pole(doplnit, 'odchod_datum')?.value, '2026-09-26')
ma('… příchod zůstane, jak byl (8:39)', pole(doplnit, 'prichod_cas')?.value, '08:39')
ma('… nabízí „Bez odchodu (ještě v práci)"', text(doplnit).includes('Bez odchodu (ještě v práci)'), true)
ma('… a „po půlnoci" jako tlačítko, ne domyšlení', text(doplnit).includes('Odchod až po půlnoci (datum o den dál)'), true)
const storno26 = f26.find((f) => f.includes('ft-tl-nebezpecne')) ?? ''
ma('storno příchodu: potvrzení s důvodem a červeným tlačítkem', /<textarea name="duvod" required=""/.test(storno26) && />Stornovat příchod<\/button>/.test(storno26), true)
ma('… nesmaže se: věta', text(storno26).includes('Nic se nesmaže.'), true)
ma('… posílá jen příchod', `${pole(storno26, 'prichod_id')?.value}/${pole(storno26, 'odchod_id')}`, 'c-in/null')
const doplnitP = formulare(k27).find((f) => f.includes('name="prichod_cas"')) ?? ''
ma('doplnit příchod: čas prázdný, datum = provozní den, id odchodu', `${pole(doplnitP, 'prichod_cas')?.value}/${pole(doplnitP, 'prichod_datum')?.value}/${pole(doplnitP, 'odchod_id')?.value}/${pole(doplnitP, 'prichod_id')}`, '/2026-09-27/d-out/null')

console.log('\n== Odeslání: po dobu ukládání tlačítko vypnuté (dvojklik) ==')
/*
  Stav „ukládám" dává useFormStatus z react-dom. Tady se podstrčí
  „odesílá se" a vykreslí se skutečný formulář úpravy i storna.
*/
const ODESILA = js('export function useFormStatus() { return { pending: true } }\n')
const UpravaOdesila = await nactiKomponentu('app/[rozsah]/dochazka/clovek/uprava-useku.tsx', [
  ...ZAKLAD.filter(([k]) => k !== 'react-dom'),
  ['react-dom', ODESILA],
])
const zakladUpravy = {
  rozsah: 'cerna-perla', zamestnanec: 'e1', mesic: '2026-09', odkud: null, den: '2026-09-24',
  prichodId: 'a-in', odchodId: 'a-out', popisTed: null, pobocky: [{ id: 'B1', nazev: 'Černá Perla' }],
  prichod: { datum: '2026-09-24', cas: '08:00', pobocka: 'B1' }, odchod: { datum: '2026-09-24', cas: '21:10', pobocka: 'B1' },
}
const odesilaUprava = nb(renderToStaticMarkup(createElement(UpravaOdesila, { ...zakladUpravy, rezim: 'upravit', nadpis: 'U', popisek: 'Upravit' })))
ma('úprava při odesílání: „Ukládám…" a vypnuté', /<button type="submit" class="ft-tl ft-tl-hlavni" disabled="" aria-busy="true">Ukládám…<\/button>/.test(odesilaUprava), true)
const odesilaStorno = nb(renderToStaticMarkup(createElement(UpravaOdesila, { ...zakladUpravy, rezim: 'storno', nadpis: 'S', popisek: 'Stornovat úsek', stornoPopisek: 'Stornovat úsek' })))
ma('storno při odesílání: „Stornuji…" a vypnuté', /<button type="submit" class="ft-tl ft-tl-nebezpecne" disabled="" aria-busy="true">Stornuji…<\/button>/.test(odesilaStorno), true)
ma('v klidu (skutečný react-dom): tlačítko zapnuté s textem', /<button type="submit" class="ft-tl ft-tl-hlavni">Uložit opravu<\/button>/.test(f24), true)

console.log('\n== Bez správy žádná tlačítka ==')
const cteni = vykresli({ dny: lib.seskupitPoDnech(prevedene.map((r) => ({ ...r, smiSpravovat: false })), PENIZE), smiZapsat: false })
ma('žádné „Upravit", „Doplnit", „Stornovat", „Zapsat úsek"',
  ['Upravit', 'Doplnit odchod', 'Doplnit příchod', 'Stornovat', 'Zapsat úsek'].filter((t) => text(cteni).includes(t)).join(','), '')
ma('… a žádný formulář', formulare(cteni).length, 0)
ma('úseky přitom vidí', text(cteni).includes('22:00'), true)
ma('den 22. 9. (nevidí celý): tlačítka ani u úseku, kde smi=false', (kartaDne(html, '2026-09-22') ?? '').includes('>Upravit<'), false)

console.log('\n== Hlášky, uzavřený měsíc, prázdno ==')
const ulozeno = vykresli({ vysledek: { druh: 'ulozeno', den: '2026-09-24' } })
ma('„Uloženo" v kartě toho dne', text(kartaDne(ulozeno, '2026-09-24') ?? '').includes('Uloženo.'), true)
ma('… a jinde ne', text(kartaDne(ulozeno, '2026-09-25') ?? '').includes('Uloženo.'), false)
const jinde = vykresli({ vysledek: { druh: 'ulozeno', den: '2026-08-31' } })
ma('„Uloženo" ke dni, který tu kartu nemá (jiný měsíc): nahoře, ne nikde', text(jinde).includes('Uloženo.'), true)
ma('… a jen jednou', (text(jinde).match(/Uloženo\./g) ?? []).length, 1)
const chyba = vykresli({ vysledek: { druh: 'chyba', den: '2026-09-25', text: 'Úsek by se překrýval s jiným záznamem (příchod v 25. 9. 13:00).' } })
ma('hláška z databáze beze změny, v kartě dne', text(kartaDne(chyba, '2026-09-25') ?? '').includes('Úsek by se překrýval s jiným záznamem (příchod v 25. 9. 13:00).'), true)
ma('uzavřený měsíc se správou: pruh', text(vykresli({ obdobi: 'minuly' })).includes('Uzavřený měsíc.'), true)
ma('běžící měsíc: pruh ne', text(html).includes('Uzavřený měsíc.'), false)
const prazdno = vykresli({ dny: [] })
ma('prázdný měsíc: věta a „Zapsat úsek"', `${text(prazdno).includes('nemá žádnou docházku')}/${text(prazdno).includes('Zapsat úsek')}`, 'true/true')
ma('… bez karet s nulou', prazdno.includes('ds-kpi'), false)
ma('„Zapsat úsek" nemá id ani den (nový úsek)', pole(formulare(prazdno)[0] ?? '', 'prichod_id') === null && pole(formulare(prazdno)[0] ?? '', 'den') === null, true)

/* ======================================================================
   3. STRÁNKA
   ====================================================================== */

globalThis.__s = null
const NAVIGACE = js(
  'export function redirect(adresa) { throw Object.assign(new Error("NEXT_REDIRECT"), { adresa }) }\n' +
    'export function notFound() { throw new Error("NEXT_NOT_FOUND") }\n' +
    'export function useRouter() { return { refresh() {} } }\n',
)
const FIRMA = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export async function zkusPristup(t, pravo, rozsah) {\n' +
    '  globalThis.__s.volani.push(["zkusPristup", pravo, rozsah]);\n' +
    '  return globalThis.__s.pristup(pravo, rozsah);\n' +
    '}\n',
)
const AUTHZ = js(
  'export async function hasAccess(t, pravo, pobocka) {\n' +
    '  globalThis.__s.volani.push(["hasAccess", pravo, pobocka]);\n' +
    '  return globalThis.__s.pravo(pravo, pobocka);\n' +
    '}\n',
)
const PROVOZNI_DEN = js(
  'export async function provozniDen(pobocka) {\n' +
    '  globalThis.__s.volani.push(["provozniDen", pobocka]);\n' +
    '  return globalThis.__s.den;\n' +
    '}\n',
)
const DOTAZ = js(
  'export class DotazSelhal extends Error { constructor(p, c) { super("Dotaz " + p + " selhal: " + c.message) } }\n' +
    'export function funkceNeexistuje(c) { return c?.code === "PGRST202" || c?.code === "42883" }\n',
)
const SERVER = js(
  'export async function getServerSupabase() {\n' +
    '  return { rpc: async (jmeno, args) => {\n' +
    '    globalThis.__s.volani.push(["rpc", jmeno, args]);\n' +
    '    return globalThis.__s.odpoved(jmeno, args);\n' +
    '  } };\n' +
    '}\n',
)
const PRAVA_ZALOZEK = js(
  'export default async function zalozkyDochazky(t, pobocka) {\n' +
    '  globalThis.__s.volani.push(["zalozky", pobocka]);\n' +
    '  return ["dochazka", "ucet", "vydelky"];\n' +
    '}\n',
)

const Stranka = await nactiKomponentu('app/[rozsah]/dochazka/clovek/[id]/page.tsx', [
  ...ZAKLAD,
  ['next/navigation', NAVIGACE],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SERVER],
  ['../../zalozky-prava', PRAVA_ZALOZEK],
])

const ID = '11111111-2222-4333-8444-555555555555'
const POBOCKA = { level: 'branch', branchId: 'B1', branchName: 'Černá Perla', branchSlug: 'cerna-perla' }
const CTX = {
  jeMajitel: false,
  branches: [{ id: 'B1', name: 'Černá Perla' }, { id: 'B2', name: 'Bernard' }],
}
const smiCist = (pravo) => (pravo === 'attendance.read' ? { stav: 'ok', ctx: CTX, scope: POBOCKA } : { stav: 'odepren' })

async function stranka({
  pristup = smiCist,
  pravo = () => false,
  rozsah = 'cerna-perla',
  id = ID,
  hledani = {},
  den = '2026-09-26',
  clovek = [{ full_name: 'Karel Novák', branch_id: 'B1', je_sam: false }],
  odpoved = null,
} = {}) {
  globalThis.__s = {
    pristup,
    pravo,
    den,
    volani: [],
    odpoved:
      odpoved ??
      ((jmeno) =>
        jmeno === 'dochazka_clovek'
          ? { data: clovek, error: null }
          : jmeno === 'useky_cloveka'
            ? { data: RADKY, error: null }
            : jmeno === 'vydelek_cloveka_po_dnech'
              ? {
                  data: [
                    { den: '2026-09-24', minut: 780, sazba: 20000, haleru: 260000 },
                    // Den bez sazby: rozklad earnings vrací haléře NULL.
                    { den: '2026-09-25', minut: 381, sazba: null, haleru: null },
                  ],
                  error: null,
                }
              : { data: null, error: { code: 'X', message: 'neznámá funkce ' + jmeno } }),
  }
  let vystup = ''
  let chyba = null
  try {
    vystup = nb(renderToStaticMarkup(
      await Stranka({ params: Promise.resolve({ rozsah, id }), searchParams: Promise.resolve(hledani) }),
    ))
  } catch (e) {
    chyba = e
  }
  const volani = globalThis.__s.volani
  return { html: vystup, chyba, volani, rpc: volani.filter((v) => v[0] === 'rpc'), prava: volani.filter((v) => v[0] === 'hasAccess') }
}

console.log('\n== Stránka: kdo sem smí ==')
const bez = await stranka({ pristup: () => ({ stav: 'odepren' }) })
ma('bez attendance.read: věta o oprávnění', text(bez.html).includes('Na docházku ostatních nemáte oprávnění'), true)
ma('… na úseky se databáze VŮBEC nezeptá', bez.rpc.some((r) => r[1] === 'useky_cloveka'), false)
ma('ptá se na attendance.read s rozsahem z adresy', JSON.stringify(bez.volani.find((v) => v[0] === 'zkusPristup')), JSON.stringify(['zkusPristup', 'attendance.read', 'cerna-perla']))
const sam = await stranka({ pristup: () => ({ stav: 'odepren' }), clovek: [{ full_name: 'Já', branch_id: 'B1', je_sam: true }] })
ma('bez práva, ale vlastní id → Můj účet', sam.chyba?.adresa, '/cerna-perla/dochazka/ucet')
const nepr = await stranka({ pristup: () => ({ stav: 'neprihlasen' }) })
ma('nepřihlášený → přihlášení', nepr.chyba?.adresa, '/prihlaseni')
const spatneId = await stranka({ id: '../../vydelky' })
ma('id, které není uuid: „Takový člověk tu není" a žádný dotaz', `${text(spatneId.html).includes('Takový člověk tu není')}/${spatneId.rpc.length}`, 'true/0')
const nikdo = await stranka({ clovek: [] })
ma('databáze člověka nevydá: „Takový člověk tu není", na úseky se neptá',
  `${text(nikdo.html).includes('Takový člověk tu není')}/${nikdo.rpc.some((r) => r[1] === 'useky_cloveka')}`, 'true/false')

console.log('\n== Stránka: na co se ptá databáze ==')
const ok = await stranka()
const useky = ok.rpc.find((r) => r[1] === 'useky_cloveka')
ma('volá useky_cloveka s firmou, člověkem a měsícem provozního dne', JSON.stringify(useky?.[2]), JSON.stringify({ p_tenant: 't1', p_employee: ID, p_mesic: '2026-09-01' }))
ma('kdo to je: dochazka_clovek s firmou a id', JSON.stringify(ok.rpc.find((r) => r[1] === 'dochazka_clovek')?.[2]), JSON.stringify({ p_tenant: 't1', p_employee: ID }))
ma('jeden h1 = jméno člověka', (ok.html.match(/<h1>/g) ?? []).length === 1 && ok.html.includes('<h1>Karel Novák</h1>'), true)
ma('provozní den z pobočky z adresy', JSON.stringify(ok.volani.find((v) => v[0] === 'provozniDen')), '["provozniDen","B1"]')
ma('peníze: payroll.read na DOMOVSKÉ pobočce člověka', JSON.stringify(ok.prava.find((p) => p[1] === 'payroll.read')), '["hasAccess","payroll.read","B1"]')
ma('bez payroll.read se na peníze neptá', ok.rpc.some((r) => r[1] === 'vydelek_cloveka_po_dnech'), false)
ma('… a Kč na stránce nejsou', ok.html.includes('Kč'), false)
ma('správa se zjišťuje po pobočkách', ok.prava.filter((p) => p[1] === 'attendance.manage').map((p) => p[2]).join(','), 'B1,B2')
ma('bez správy nic k úpravě ani „Zapsat úsek"', /Zapsat úsek/.test(ok.html), false)

const majitel = await stranka({
  clovek: [{ full_name: 'Majitel', branch_id: null, je_sam: false }],
  pravo: () => true,
})
ma('člověk bez pobočky (majitel): payroll.read na firmě (null)', JSON.stringify(majitel.prava.find((p) => p[1] === 'payroll.read')), '["hasAccess","payroll.read",null]')
ma('s payroll.read: peníze po dnech se stejnými parametry', JSON.stringify(majitel.rpc.find((r) => r[1] === 'vydelek_cloveka_po_dnech')?.[2]), JSON.stringify({ p_tenant: 't1', p_employee: ID, p_mesic: '2026-09-01' }))
ma('… a „Vyděláno" se ukáže', text(majitel.html).includes('Vyděláno'), true)
ma('den bez sazby z databáze: „bez sazby", ne 0 Kč', text(kartaDne(majitel.html, '2026-09-25') ?? '').includes('bez sazby'), true)
ma('… a na celé stránce žádné „0 Kč"', nulaKorun(majitel.html), false)
ma('se správou: „Zapsat úsek"', text(majitel.html).includes('Zapsat úsek'), true)

const vedouciSam = await stranka({ clovek: [{ full_name: 'Vedoucí', branch_id: 'B1', je_sam: true }], pravo: (p) => p === 'attendance.manage' })
ma('vedoucí u sebe „Zapsat úsek" nemá (vlastní jen majitel)', text(vedouciSam.html).includes('Zapsat úsek'), false)
const majitelSam = await stranka({
  pristup: (p) => (p === 'attendance.read' ? { stav: 'ok', ctx: { ...CTX, jeMajitel: true }, scope: POBOCKA } : { stav: 'odepren' }),
  clovek: [{ full_name: 'Majitel', branch_id: null, je_sam: true }],
  pravo: (p) => p === 'attendance.manage',
})
ma('majitel u sebe „Zapsat úsek" má', text(majitelSam.html).includes('Zapsat úsek'), true)

console.log('\n== Stránka: měsíc a návrat ==')
ma('provozní den 1. 10. → říjen, ne hodiny serveru', (await stranka({ den: '2026-10-01' })).rpc.find((r) => r[1] === 'useky_cloveka')?.[2]?.p_mesic, '2026-10-01')
ma('?mesic=2026-08 → srpen', (await stranka({ hledani: { mesic: '2026-08' } })).rpc.find((r) => r[1] === 'useky_cloveka')?.[2]?.p_mesic, '2026-08-01')
ma('budoucí měsíc → běžící', (await stranka({ hledani: { mesic: '2026-12' } })).rpc.find((r) => r[1] === 'useky_cloveka')?.[2]?.p_mesic, '2026-09-01')
const zVydelku = await stranka({ hledani: { z: 'vydelky', mesic: '2026-08' } })
ma('z Výdělků: odkaz zpět do Výdělků téhož měsíce', /class="ds-uc-zpet"/.test(zVydelku.html) && zVydelku.html.includes('href="/cerna-perla/dochazka/vydelky?mesic=2026-08"'), true)
ma('z Výdělků: aktivní záložka Výdělky', /href="\/cerna-perla\/dochazka\/vydelky\?mesic=2026-08" aria-current="page"/.test(zVydelku.html), true)
ma('šipka měsíce nese „odkud"', zVydelku.html.includes(`href="/cerna-perla/dochazka/clovek/${ID}?mesic=2026-07&amp;z=vydelky"`), true)
const zlo = await stranka({ hledani: { z: 'https://zlo.example' } })
ma('neznámé „odkud": zpět na Docházku, žádná cizí adresa', `${zlo.html.includes('href="/cerna-perla/dochazka"')}/${zlo.html.includes('zlo.example')}`, 'true/false')
const hlaska = await stranka({ hledani: { chyba: 'uprava', den: '2026-09-25', text: 'Mezitím to někdo změnil — obnovte stránku.' } })
ma('hláška z adresy v kartě dne', text(kartaDne(hlaska.html, '2026-09-25') ?? '').includes('Mezitím to někdo změnil — obnovte stránku.'), true)

console.log('\n== Stránka: nenasazená databáze ==')
const nenasazeno = await stranka({ odpoved: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) })
ma('věta o nasazení, nic nespadlo', `${text(nenasazeno.html).includes('po nasazení databáze')}/${nenasazeno.chyba}`, 'true/null')
const porucha = await stranka({ odpoved: (j) => (j === 'dochazka_clovek' ? { data: [{ full_name: 'K', branch_id: 'B1', je_sam: false }], error: null } : { data: null, error: { code: '42501', message: 'permission denied' } }) })
ma('jiná chyba se nezamete — spadne', porucha.chyba instanceof Error && !porucha.chyba.adresa, true)

console.log('\n== Kontrakt s migrací: jména parametrů a sloupců ==')
/*
  Aplikace a databáze se domlouvají jen jmény. Přejmenovaný parametr by
  skončil na PGRST202, a ten stránka schválně promíjí jako „nenasazeno".
  Proto se jména vezmou přímo z migrace.
*/
const migrace = fs.readFileSync(new URL('supabase/migrations/20260927110000_dochazka_smeny_cloveka.sql', KOREN), 'utf8')
const jmena = (seznam) => seznam.split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)
function hlavicka(fce) {
  const m = migrace.match(new RegExp(`create function public\\.${fce}\\(([^)]*)\\)\\s*returns table \\(([^)]*)\\)`))
  return m ? { parametry: jmena(m[1]), sloupce: jmena(m[2]) } : { parametry: [], sloupce: [] }
}
const serazeno = (p) => [...p].sort().join(',')
const hUseky = hlavicka('useky_cloveka')
ma('z migrace: useky_cloveka 3 parametry, 35 sloupců', `${hUseky.parametry.length}/${hUseky.sloupce.length}`, '3/35')
ma('stránka posílá právě parametry useky_cloveka', serazeno(Object.keys(useky?.[2] ?? {})), serazeno(hUseky.parametry))
ma('podstrčené řádky mají právě sloupce useky_cloveka (a převod je čte)', serazeno(Object.keys(RADKY[0])), serazeno(hUseky.sloupce))
const hClovek = hlavicka('dochazka_clovek')
ma('dochazka_clovek: parametry i sloupce', `${serazeno(Object.keys(ok.rpc.find((r) => r[1] === 'dochazka_clovek')?.[2] ?? {}))}|full_name,branch_id,je_sam`,
  `${serazeno(hClovek.parametry)}|${hClovek.sloupce.join(',')}`)
const hPenize = hlavicka('vydelek_cloveka_po_dnech')
ma('vydelek_cloveka_po_dnech: parametry', serazeno(Object.keys(majitel.rpc.find((r) => r[1] === 'vydelek_cloveka_po_dnech')?.[2] ?? {})), serazeno(hPenize.parametry))
ma('vydelek_cloveka_po_dnech: sloupce, které stránka čte', hPenize.sloupce.join(','), 'den,minut,sazba,haleru')

/* ======================================================================
   4. SERVEROVÉ AKCE
   ====================================================================== */

globalThis.__a = null
const CACHE = js('export function revalidatePath(c) { globalThis.__a.volani.push(["revalidate", c]) }\n')
const FIRMA_AKCE = js(
  'export async function getCurrentTenantId() { return "t1" }\n' +
    'export async function zkusPristup(t, pravo, rozsah) {\n' +
    '  globalThis.__a.volani.push(["zkusPristup", pravo, rozsah]);\n' +
    '  return globalThis.__a.pristup(pravo);\n' +
    '}\n',
)
const SERVER_AKCE = js(
  'export async function getServerSupabase() {\n' +
    '  return { rpc: async (jmeno, args) => {\n' +
    '    globalThis.__a.volani.push(["rpc", jmeno, args]);\n' +
    '    return globalThis.__a.odpoved(jmeno);\n' +
    '  } };\n' +
    '}\n',
)
const akce = await nactiModul('app/[rozsah]/dochazka/clovek/akce.ts', [
  ['next/cache', CACHE],
  ['next/navigation', NAVIGACE],
  ['@/lib/firma', FIRMA_AKCE],
  ['@/lib/supabase/server', SERVER_AKCE],
])

const PRICHOD = 'aaaaaaaa-0000-4000-8000-000000000001'
const ODCHOD = 'aaaaaaaa-0000-4000-8000-000000000002'
const POB = 'bbbbbbbb-0000-4000-8000-000000000001'

async function odeslat(fce, pole, { pristup = () => ({ stav: 'ok' }), odpoved = () => ({ data: [{ den: '2026-09-24' }], error: null }) } = {}) {
  globalThis.__a = { pristup, odpoved, volani: [] }
  const fd = new FormData()
  for (const [k, v] of Object.entries(pole)) fd.append(k, v)
  let kam = null
  try {
    await fce(fd)
  } catch (e) {
    if (!e.adresa) throw e
    kam = e.adresa
  }
  const v = globalThis.__a.volani
  return { kam, rpc: v.filter((x) => x[0] === 'rpc'), volani: v }
}

const UPRAVA = {
  rozsah: 'cerna-perla',
  zamestnanec: ID,
  mesic: '2026-09',
  z: 'vydelky',
  den: '2026-09-24',
  prichod_id: PRICHOD,
  odchod_id: ODCHOD,
  prichod_datum: '2026-09-24',
  prichod_cas: '08:00',
  prichod_pobocka: POB,
  odchod_datum: '2026-09-25',
  odchod_cas: '02:30',
  odchod_pobocka: POB,
  duvod: '  zapomněl se odpíchnout ',
}

console.log('\n== Akce: úprava úseku ==')
const u = await odeslat(akce.upravitUsek, UPRAVA)
ma('volá upravit_usek_dochazky', u.rpc[0]?.[1], 'upravit_usek_dochazky')
ma('hodina na zdi BEZ převodu (pásmo dodá pobočka v databázi)', `${u.rpc[0]?.[2]?.p_prichod_kdy} → ${u.rpc[0]?.[2]?.p_odchod_kdy}`, '2026-09-24T08:00 → 2026-09-25T02:30')
ma('ids a pobočky tak, jak přišly', `${u.rpc[0]?.[2]?.p_prichod === PRICHOD}/${u.rpc[0]?.[2]?.p_odchod === ODCHOD}/${u.rpc[0]?.[2]?.p_odchod_pobocka === POB}`, 'true/true/true')
ma('důvod bez okrajových mezer, firma z přihlášení', `${u.rpc[0]?.[2]?.p_duvod}|${u.rpc[0]?.[2]?.p_tenant}`, 'zapomněl se odpíchnout|t1')
ma('kontrakt: právě parametry upravit_usek_dochazky', serazeno(Object.keys(u.rpc[0]?.[2] ?? {})), serazeno(hlavicka('upravit_usek_dochazky').parametry))
ma('první linie: attendance.manage s rozsahem z adresy', JSON.stringify(u.volani.find((v) => v[0] === 'zkusPristup')), JSON.stringify(['zkusPristup', 'attendance.manage', 'cerna-perla']))
ma('po uložení zpět na člověka s dnem a kotvou', u.kam, `/cerna-perla/dochazka/clovek/${ID}?mesic=2026-09&z=vydelky&ulozeno=2026-09-24#den-2026-09-24`)
ma('… a obnoví se Docházka', JSON.stringify(u.volani.find((v) => v[0] === 'revalidate')), '["revalidate","/cerna-perla/dochazka"]')

const bezSpravy = await odeslat(akce.upravitUsek, UPRAVA, { pristup: () => ({ stav: 'odepren' }) })
ma('bez attendance.manage se databáze nezeptá', bezSpravy.rpc.length, 0)
ma('… a vrátí se s větou u dne', bezSpravy.kam?.includes('chyba=uprava') && new URL('http://x' + bezSpravy.kam).searchParams.get('text'), 'Upravovat docházku smí jen ten, kdo ji spravuje.')

const dbChyba = await odeslat(akce.upravitUsek, UPRAVA, {
  odpoved: () => ({ data: null, error: { message: 'Úsek by trval déle než 24 hodin & víc?' } }),
})
ma('hláška z databáze beze změny (i s & a ?)', new URL('http://x' + dbChyba.kam).searchParams.get('text'), 'Úsek by trval déle než 24 hodin & víc?')
ma('… s dnem pro kartu a kotvou', dbChyba.kam?.endsWith('&den=2026-09-24#den-2026-09-24'), true)

const bezOdchodu = await odeslat(akce.upravitUsek, { ...UPRAVA, odchod_id: '', bez_odchodu: '1' })
ma('„Bez odchodu": odchod se neposílá vůbec', `${bezOdchodu.rpc[0]?.[2]?.p_odchod_kdy}/${bezOdchodu.rpc[0]?.[2]?.p_odchod_pobocka}/${bezOdchodu.rpc[0]?.[2]?.p_odchod}`, 'null/null/null')
const novy = await odeslat(akce.upravitUsek, { ...UPRAVA, prichod_id: '', odchod_id: '', den: '' })
ma('nový úsek: bez id', `${novy.rpc[0]?.[2]?.p_prichod}/${novy.rpc[0]?.[2]?.p_odchod}`, 'null/null')
ma('… den výsledku z databáze', novy.kam?.includes('ulozeno=2026-09-24#den-2026-09-24'), true)
const spatnyCas = await odeslat(akce.upravitUsek, { ...UPRAVA, odchod_cas: '25:99:00' })
ma('čas v nesmyslném tvaru: databáze se nezeptá, věta', `${spatnyCas.rpc.length}/${new URL('http://x' + spatnyCas.kam).searchParams.get('text')?.startsWith('Datum nebo čas nejde přečíst')}`, '0/true')
const podvrzenyNavrat = await odeslat(akce.upravitUsek, { ...UPRAVA, z: 'https://zlo.example', mesic: '../../x' })
ma('návrat je výčet: cizí „odkud" ani měsíc do adresy nepronikne (měsíc z dne od databáze)', podvrzenyNavrat.kam, `/cerna-perla/dochazka/clovek/${ID}?mesic=2026-09&ulozeno=2026-09-24#den-2026-09-24`)
const jinyMesic = await odeslat(akce.upravitUsek, { ...UPRAVA, prichod_id: '', odchod_id: '', den: '', mesic: '2026-10' }, {
  odpoved: () => ({ data: [{ den: '2026-09-30' }], error: null }),
})
ma('úsek zapsaný do jiného měsíce: zpět na TEN měsíc, ne na zobrazený', jinyMesic.kam, `/cerna-perla/dochazka/clovek/${ID}?mesic=2026-09&z=vydelky&ulozeno=2026-09-30#den-2026-09-30`)
const cizi = await odeslat(akce.upravitUsek, { ...UPRAVA, zamestnanec: 'x' })
ma('zaměstnanec, který není uuid: zpět na Docházku, žádný dotaz', `${cizi.kam}/${cizi.rpc.length}`, '/cerna-perla/dochazka/0')

console.log('\n== Akce: storno ==')
const st = await odeslat(akce.stornovatUsek, { rozsah: 'cerna-perla', zamestnanec: ID, mesic: '2026-09', den: '2026-09-26', prichod_id: PRICHOD, duvod: 'píchnutí omylem' }, { odpoved: () => ({ data: [{ den: '2026-09-26', stornovano: 1 }], error: null }) })
ma('volá stornovat_usek_dochazky jen s příchodem', `${st.rpc[0]?.[1]}/${st.rpc[0]?.[2]?.p_prichod === PRICHOD}/${st.rpc[0]?.[2]?.p_odchod}`, 'stornovat_usek_dochazky/true/null')
ma('kontrakt: právě parametry stornovat_usek_dochazky', serazeno(Object.keys(st.rpc[0]?.[2] ?? {})), serazeno(hlavicka('stornovat_usek_dochazky').parametry))
ma('zpět na člověka se „stornovano" u dne', st.kam, `/cerna-perla/dochazka/clovek/${ID}?mesic=2026-09&stornovano=2026-09-26#den-2026-09-26`)
const zPrehledu = await odeslat(akce.stornovatUsek, { rozsah: 'cerna-perla', zamestnanec: ID, prichod_id: PRICHOD, duvod: 'omyl', zpet: 'prehled' })
ma('z bočního panelu: zpět do přehledu s otevřeným člověkem', zPrehledu.kam, `/cerna-perla/dochazka?osoba=${ID}&storno=ok`)
const zPrehleduChyba = await odeslat(akce.stornovatUsek, { rozsah: 'cerna-perla', zamestnanec: ID, prichod_id: PRICHOD, duvod: 'omyl', zpet: 'prehled' }, {
  odpoved: () => ({ data: null, error: { message: 'Vlastní docházku si stornovat nemůžete — udělá to majitel nebo jiný vedoucí.' } }),
})
ma('… chyba z databáze beze změny', new URL('http://x' + zPrehleduChyba.kam).searchParams.get('text'), 'Vlastní docházku si stornovat nemůžete — udělá to majitel nebo jiný vedoucí.')
const nicKeStornu = await odeslat(akce.stornovatUsek, { rozsah: 'cerna-perla', zamestnanec: ID, duvod: 'omyl' })
ma('bez id se nic nestornuje ani nevolá', nicKeStornu.rpc.length, 0)

/* ======================================================================
   5. BOČNÍ PANEL ŽIVÉHO PŘEHLEDU
   ====================================================================== */

const PrehledDochazky = await nactiKomponentu('app/[rozsah]/dochazka/prehled/prehled.tsx', [
  ...ZAKLAD,
  ['next/navigation', NAVIGACE],
  ['./detail-akce', js('export async function nactiMesicCloveka() { return null }\n')],
])

const RADEK_PREHLEDU = {
  osobaId: ID,
  jmeno: 'Karel Novák',
  usek: null,
  pozice: null,
  plan: null,
  smenaId: null,
  stav: 'v_praci',
  bezSmeny: true,
  naPrestavce: false,
  prichod: '08:39',
  odchod: null,
  minut: 12,
  otevrenyZeDne: null,
  otevrenyPrichodId: PRICHOD,
  otevrenyPrichodPobocka: 'B1',
  otevrenyPrichodCas: '08:39',
  nulovyUsek: false,
  dalsiOtevreny: null,
  pobockaPrichodu: null,
  zacatekPlanu: null,
  konecPlanu: null,
  udalosti: [{ druh: 'Příchod', cas: '08:39' }],
}

const prehled = (sprava, radek = RADEK_PREHLEDU, vybranaZUrl = ID) =>
  nb(renderToStaticMarkup(
    createElement(PrehledDochazky, {
      data: { radky: radek ? [radek] : [], souhrn: { vPraci: 1, cekame: 0, poZacatku: 0, odesli: 0, minutNaMiste: 12 }, aktualizovano: '08:51' },
      denPopis: 'sobota 26. 9.',
      den: '2026-09-26',
      rozsah: 'cerna-perla',
      kiosek: { aktivni: true, odkaz: null },
      vybranaZUrl,
      sprava,
    }),
  ))

/** Obsah bočního panelu (podstrčený Drawer ho kreslí mezi značky). */
const panel = (html) => (html.match(/⟦PANEL Docházka⟧([\s\S]*?)⟦\/PANEL⟧/) ?? [])[1] ?? ''
/** Co je nad kartami přehledu (mimo panel). */
const nadKartami = (html) => html.split('class="ds-dh-karty"')[0]

console.log('\n== Boční panel: storno příchodu píchnutého omylem ==')
const VEDOUCI = { spravovane: ['B1'], jeMajitel: false, vlastniId: 'jiny', hlaskaStorna: null }
const sVedoucim = prehled(VEDOUCI)
ma('vedoucí pobočky: „Stornovat příchod…"', sVedoucim.includes('>Stornovat příchod…</button>'), true)
ma('odkaz „Docházka za měsíc" na člověka', sVedoucim.includes(`href="/cerna-perla/dochazka/clovek/${ID}?z=prehled"`), true)
ma('bez správy té pobočky: storno ne', prehled({ ...VEDOUCI, spravovane: ['B2'] }).includes('Stornovat příchod'), false)
ma('bez práv vůbec (null): storno ne, odkaz ano',
  `${prehled(null).includes('Stornovat příchod')}/${prehled(null).includes('Docházka za měsíc')}`, 'false/true')
ma('vedoucí u sebe: storno ne', prehled({ ...VEDOUCI, vlastniId: ID }).includes('Stornovat příchod'), false)
ma('majitel u sebe: storno ano', prehled({ ...VEDOUCI, vlastniId: ID, jeMajitel: true }).includes('Stornovat příchod…'), true)
ma('příchod na jiné pobočce: tady storno ne', prehled(VEDOUCI, { ...RADEK_PREHLEDU, otevrenyPrichodPobocka: 'B2' }).includes('Stornovat příchod'), false)
ma('kdo odešel (není v práci): storno ne', prehled(VEDOUCI, { ...RADEK_PREHLEDU, stav: 'odesel', otevrenyPrichodId: null }).includes('Stornovat příchod'), false)
console.log('\n== Boční panel: výsledek storna je vidět v panelu, ne pod ním ==')
/*
  ?osoba= panel toho člověka po návratu znovu otevře — na telefonu přes
  celou šířku. Hláška nahoře nad kartami by pod ním zmizela.
*/
const MEZITIM = 'Mezitím to někdo změnil — obnovte stránku.'
const sChybou = prehled({ ...VEDOUCI, hlaskaStorna: { druh: 'chyba', text: MEZITIM } })
ma('chyba storna z databáze beze změny, V PANELU (role=alert)', /role="alert">Mezitím to někdo změnil — obnovte stránku\.<\/p>/.test(panel(sChybou)), true)
ma('… a nahoře nad kartami ne (tam by ji panel zakryl)', text(nadKartami(sChybou)).includes(MEZITIM), false)
const okOdesel = prehled({ ...VEDOUCI, hlaskaStorna: { druh: 'ok' } }, { ...RADEK_PREHLEDU, stav: 'odesel', otevrenyPrichodId: null, otevrenyPrichodCas: null })
ma('storno prošlo a člověk už v práci není: „Smí se píchnout znovu" v panelu', text(panel(okOdesel)).includes('Příchod stornovaný — nesmazal se, zůstal přeškrtnutý v docházce za měsíc. Smí se píchnout znovu.'), true)
const okPorad = prehled({ ...VEDOUCI, hlaskaStorna: { druh: 'ok' } }, { ...RADEK_PREHLEDU, otevrenyPrichodCas: '07:30' })
ma('storno prošlo, ale v práci je dál podle jiného příchodu: řekne to, „znovu píchnout" ne',
  `${text(panel(okPorad)).includes('V práci je ale dál podle příchodu v 07:30')}/${text(panel(okPorad)).includes('Smí se píchnout znovu')}`, 'true/false')
const bezPanelu = prehled({ ...VEDOUCI, hlaskaStorna: { druh: 'ok' } }, null)
ma('člověk po stornu v přehledu není (panel zavřený): hláška nahoře', text(nadKartami(bezPanelu)).includes('Příchod stornovaný. Nesmazal se'), true)

console.log('\n== Boční panel: úsek 0 min a dva otevřené příchody ==')
const nulovyPanel = prehled(VEDOUCI, { ...RADEK_PREHLEDU, nulovyUsek: true, otevrenyPrichodCas: '09:00' })
ma('příchod a odchod ve stejné chvíli: storno se nenabízí (databáze by ho odmítla)', nulovyPanel.includes('Stornovat příchod'), false)
ma('… místo něj věta a odkaz na měsíc člověka', `${text(panel(nulovyPanel)).includes('Příchod a odchod mají stejný čas (09:00)')}/${panel(nulovyPanel).includes(`href="/cerna-perla/dochazka/clovek/${ID}?z=prehled"`)}`, 'true/true')
const dvaPanel = prehled(VEDOUCI, { ...RADEK_PREHLEDU, otevrenyPrichodCas: '08:05', dalsiOtevreny: '07:30' })
ma('dva otevřené příchody: „Stornovat pozdější příchod…" a kdy zůstane v práci',
  `${dvaPanel.includes('>Stornovat pozdější příchod…</button>')}/${text(panel(dvaPanel)).includes('v práci pak zůstane podle příchodu v 07:30')}`, 'true/true')
const prvniJinde = prehled(VEDOUCI, { ...RADEK_PREHLEDU, prichod: '07:00', otevrenyPrichodCas: '13:00' })
ma('věta u storna = čas stornovaného příchodu (13:00), ne první příchod dne (07:00)',
  `${text(panel(prvniJinde)).includes('Příchod v 13:00 jde stornovat')}/${text(panel(prvniJinde)).includes('Příchod v 07:00')}`, 'true/false')

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
