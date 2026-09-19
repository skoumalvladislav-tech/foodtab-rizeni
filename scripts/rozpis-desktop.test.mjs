#!/usr/bin/env node
/**
 * Čistá logika desktopového rozpisu směn (lib/rozpis-desktop.ts).
 *
 * Pusť `node --experimental-strip-types scripts/rozpis-desktop.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 *   1. stav směny (nevydaná / změněná po vydání / vydaná) a rozdíl proti
 *      vydanému rozpisu — zrcadlo `app.rozdil_rozpisu`,
 *   2. hledání a filtry: „Kateřina“ najde „katerina“, neobsazená směna
 *      se nikdy neztratí kvůli filtru úseku,
 *   3. mřížka týdne: pobočky → úseky → lidé, součty hodin, lidé bez
 *      směny, neobsazené směny nahoře.
 *
 * Vzorová data jsou vymyšlená; nic z nich není zapsané v logice.
 */

import { BEZ_USEKU } from '../lib/rozpis-mobil.ts'
import {
  FILTR_DESKTOP_PRAZDNY,
  cekaNaVydani,
  denKratce,
  jeFiltrPrazdny,
  jmenoVyhovuje,
  normalizuj,
  pocetFiltru,
  puvodniStav,
  sestavitMrizku,
  smenaVyhovuje,
  souhrnZmen,
  stavSmeny,
  textZmeny,
  zmenyPodleLidi,
  zmenyRozpisu,
} from '../lib/rozpis-desktop.ts'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

let n = 0
/** Vydaná směna beze změny; `prepis` mění, co je jinak. */
const smena = (den, kdo, od, doKdy, prepis = {}) => {
  n += 1
  return {
    id: `s${n}`,
    branch_id: 'b1',
    employee_id: kdo,
    position_id: null,
    shift_date: den,
    starts_at: `${od}:00`,
    ends_at: `${doKdy}:00`,
    status: 'planned',
    note: '',
    published_at: '2026-09-17T18:00:00Z',
    published_employee_id: kdo,
    published_starts_at: `${od}:00`,
    published_ends_at: `${doKdy}:00`,
    published_status: 'planned',
    pauza_od: null,
    pauza_do: null,
    ...prepis,
  }
}
const koncept = (den, kdo, od, doKdy, prepis = {}) =>
  smena(den, kdo, od, doKdy, {
    published_at: null,
    published_employee_id: null,
    published_starts_at: null,
    published_ends_at: null,
    published_status: null,
    ...prepis,
  })

console.log('\n== Stav směny vůči vydanému rozpisu ==')
je('vydaná beze změny', stavSmeny(smena('2026-09-22', 'a', '08:00', '16:00')), 'vydana')
je('nevydaná = koncept', stavSmeny(koncept('2026-09-22', 'a', '08:00', '16:00')), 'koncept')
je(
  'posunutý čas po vydání = změněná',
  stavSmeny(smena('2026-09-22', 'a', '10:00', '18:00', { published_starts_at: '08:00:00', published_ends_at: '16:00:00' })),
  'zmenena',
)
je(
  'změněný jen konec = změněná',
  stavSmeny(smena('2026-09-22', 'a', '08:00', '18:00', { published_ends_at: '16:00:00' })),
  'zmenena',
)
je(
  'jiný člověk po vydání = změněná',
  stavSmeny(smena('2026-09-22', 'b', '08:00', '16:00', { published_employee_id: 'a' })),
  'zmenena',
)
je(
  'časy se srovnají i s různým počtem nul (08:00 × 08:00:00)',
  stavSmeny(smena('2026-09-22', 'a', '08:00', '16:00', { starts_at: '08:00', published_starts_at: '08:00:00' })),
  'vydana',
)
je(
  'byla zrušená a je zpátky = pro lidi nová (koncept)',
  stavSmeny(smena('2026-09-22', 'a', '08:00', '16:00', { published_status: 'cancelled' })),
  'koncept',
)
je(
  'volná (neobsazená) vydaná směna beze změny',
  stavSmeny(smena('2026-09-22', null, '08:00', '16:00')),
  'vydana',
)
je(
  'volná směna, ke které se přidělil člověk = změněná',
  stavSmeny(smena('2026-09-22', 'a', '08:00', '16:00', { published_employee_id: null })),
  'zmenena',
)
const bezSloupcu = {
  id: 'x', branch_id: 'b1', employee_id: 'a', position_id: null, shift_date: '2026-09-22',
  starts_at: '08:00:00', ends_at: '16:00:00', status: 'planned', note: '',
  published_at: '2026-09-17T18:00:00Z', pauza_od: null, pauza_do: null,
}
je('starší dotaz bez published_* nevymýšlí změnu', stavSmeny(bezSloupcu), 'vydana')
je('starší dotaz bez published_*, ale nevydaná = koncept', stavSmeny({ ...bezSloupcu, published_at: null }), 'koncept')
je('čeká na vydání: koncept ano', cekaNaVydani(koncept('2026-09-22', 'a', '08:00', '16:00')), true)
je('čeká na vydání: vydaná ne', cekaNaVydani(smena('2026-09-22', 'a', '08:00', '16:00')), false)

console.log('\n== Původní stav („Změněno“) ==')
const zmenena = smena('2026-09-23', 'a', '10:00', '18:00', { published_starts_at: '08:00:00', published_ends_at: '16:00:00' })
je('změna času: původně 08:00–16:00', puvodniStav(zmenena), {
  od: '08:00', do: '16:00', osobaId: 'a', casSeZmenil: true, osobaSeZmenila: false,
})
je('vydaná: žádný původní stav', puvodniStav(smena('2026-09-23', 'a', '08:00', '16:00')), null)
je('koncept: žádný původní stav', puvodniStav(koncept('2026-09-23', 'a', '08:00', '16:00')), null)
const prevzata = smena('2026-09-23', 'b', '08:00', '16:00', { published_employee_id: 'a' })
je('převzatá: osoba se změnila, čas ne', puvodniStav(prevzata), {
  od: '08:00', do: '16:00', osobaId: 'a', casSeZmenil: false, osobaSeZmenila: true,
})

console.log('\n== Rozdíl proti vydanému rozpisu ==')
const zrusena = smena('2026-09-24', 'c', '08:00', '16:00', { status: 'cancelled' })
const zrusenaUzOhlasena = smena('2026-09-24', 'c', '08:00', '16:00', { status: 'cancelled', published_status: 'cancelled' })
const zrusenaNevydana = koncept('2026-09-24', 'c', '08:00', '16:00', { status: 'cancelled' })
const zm = zmenyRozpisu([
  koncept('2026-09-22', 'a', '08:00', '16:00'),
  zmenena,
  prevzata,
  zrusena,
  zrusenaUzOhlasena,
  zrusenaNevydana,
  smena('2026-09-25', 'a', '08:00', '16:00'),
])
je('vydaná beze změny, ohlášené zrušení a nevydané zrušení se nepočítají',
  zm.map((z) => [z.druh, z.osobaId, z.den]),
  [
    ['nova', 'a', '2026-09-22'],
    ['cas', 'a', '2026-09-23'],
    ['prevzata', 'b', '2026-09-23'],
    ['odebrana', 'a', '2026-09-23'],
    ['zrusena', 'c', '2026-09-24'],
  ])
je('převzatá směna je jedna směna, ale dva lidé', souhrnZmen(zm), { smen: 4, lidi: 3 })
je('nic nečeká: prázdný rozdíl', zmenyRozpisu([smena('2026-09-22', 'a', '08:00', '16:00')]), [])
je('neobsazená nová směna se počítá jako změna, ale ne jako člověk',
  souhrnZmen(zmenyRozpisu([koncept('2026-09-22', null, '08:00', '16:00')])), { smen: 1, lidi: 0 })
je('zrušení se neohlašuje podruhé', zmenyRozpisu([zrusenaUzOhlasena]), [])
je('text změny času: staré → nové', textZmeny(zm[1]), '08:00–16:00 → 10:00–18:00')
je('text nové směny', textZmeny(zm[0]), '08:00–16:00')
je('denKratce: středa', denKratce('2026-09-23'), 'ST 23. 9.')
je('denKratce: neděle', denKratce('2026-09-27'), 'NE 27. 9.')
const podleLidi = zmenyPodleLidi(
  [...zm, ...zmenyRozpisu([koncept('2026-09-22', null, '10:00', '18:00')])],
  (id) => ({ a: 'Andrea', b: 'Bára', c: 'Cyril' })[id],
)
je('po lidech abecedně, neobsazené na konec', podleLidi.map((p) => p.osobaId), ['a', 'b', 'c', null])
je('u Andrey nejdřív nová, pak změna času, pak odebraná', podleLidi[0].zmeny.map((z) => z.druh), ['nova', 'cas', 'odebrana'])

console.log('\n== Hledání ==')
je('bez diakritiky', normalizuj('Kateřina Jirásková'), 'katerina jiraskova')
je('Ř, Ž, Č se srovnají', normalizuj('Řehoř Žák Čech'), 'rehor zak cech')
je('hledání bez diakritiky najde jméno s ní', jmenoVyhovuje('Kateřina Jirásková', 'katerina'), true)
je('hledání s diakritikou najde jméno bez ní', jmenoVyhovuje('Katerina', 'Kateřina'), true)
je('část jména', jmenoVyhovuje('Andrea Mikulová', 'mik'), true)
je('víc slov v libovolném pořadí', jmenoVyhovuje('Andrea Mikulová', 'mikulova andr'), true)
je('slovo, které tam není', jmenoVyhovuje('Andrea Mikulová', 'andrea nova'), false)
je('prázdné hledání vyhovuje všem', jmenoVyhovuje('Kdokoli', '   '), true)
je('velká písmena nevadí', jmenoVyhovuje('lucie skoumalová', 'LUCIE'), true)

console.log('\n== Filtry ==')
je('prázdný filtr je prázdný', jeFiltrPrazdny(FILTR_DESKTOP_PRAZDNY), true)
je('hledání není filtr, ale prázdný už není', jeFiltrPrazdny({ ...FILTR_DESKTOP_PRAZDNY, hledani: 'a' }), false)
je('počet filtrů: úsek + pozice + osoba + stav', pocetFiltru({
  hledani: 'x', useky: ['u1', 'u2'], pozice: ['p1'], osoba: 'e1', stav: 'nevydane',
}), 5)
je('hledání se do počtu filtrů nepočítá', pocetFiltru({ ...FILTR_DESKTOP_PRAZDNY, hledani: 'x' }), 0)

const osoby = new Map([
  ['a', { id: 'a', jmeno: 'Andrea Mikulová', usekId: 'u-k', poziceId: 'p-kuchar', barva: null }],
  ['b', { id: 'b', jmeno: 'Tomáš Kovář', usekId: 'u-p', poziceId: 'p-cisnik', barva: null }],
  ['c', { id: 'c', jmeno: 'Oxy', usekId: null, poziceId: null, barva: null }],
])
const useky = new Map([['u-k', 'Kuchyně'], ['u-p', 'Plac']])
const F = (o) => ({ ...FILTR_DESKTOP_PRAZDNY, ...o })
const vyhovuje = (s, f) => smenaVyhovuje(s, osoby, F(f), useky)
const sa = smena('2026-09-22', 'a', '08:00', '16:00')
const sb = smena('2026-09-22', 'b', '14:00', '22:00')
const sc = smena('2026-09-22', 'c', '08:00', '16:00')
const volna = koncept('2026-09-22', null, '10:00', '18:00', { position_id: 'p-cisnik' })
je('úsek Kuchyně: jen Andrea', [sa, sb, sc].map((s) => vyhovuje(s, { useky: ['u-k'] })), [true, false, false])
je('Bez úseku: jen Oxy', [sa, sb, sc].map((s) => vyhovuje(s, { useky: [BEZ_USEKU] })), [false, false, true])
je('neobsazená směna se filtrem úseku neschová', vyhovuje(volna, { useky: ['u-k'] }), true)
je('pozice Číšník: Tomáš i neobsazená číšnická směna', [sa, sb, volna].map((s) => vyhovuje(s, { pozice: ['p-cisnik'] })), [false, true, true])
je('pozice se bere i ze směny, ne jen z člověka',
  vyhovuje(smena('2026-09-22', 'c', '08:00', '16:00', { position_id: 'p-cisnik' }), { pozice: ['p-cisnik'] }), true)
je('zaměstnanec: neobsazená směna se schová', vyhovuje(volna, { osoba: 'a' }), false)
je('hledání „oxy“', [sa, sb, sc].map((s) => vyhovuje(s, { hledani: 'oxy' })), [false, false, true])
je('hledání „neobsazeno“ najde volnou směnu', vyhovuje(volna, { hledani: 'neobs' }), true)
je('hledání jména schová neobsazenou směnu', vyhovuje(volna, { hledani: 'andrea' }), false)
je('stav nevydané: jen koncept a změněné', [sa, koncept('2026-09-22', 'a', '10:00', '12:00'), zmenena].map((s) => vyhovuje(s, { stav: 'nevydane' })), [false, true, true])
je('stav vydané: opak', [sa, koncept('2026-09-22', 'a', '10:00', '12:00'), zmenena].map((s) => vyhovuje(s, { stav: 'vydane' })), [true, false, false])
je('stav neobsazené: jen směna bez člověka', [sa, volna].map((s) => vyhovuje(s, { stav: 'neobsazene' })), [false, true])
je('filtry se sčítají (AND): Kuchyně + nevydané', [sa, koncept('2026-09-22', 'a', '10:00', '12:00'), sb].map((s) => vyhovuje(s, { useky: ['u-k'], stav: 'nevydane' })), [false, true, false])

console.log('\n== Mřížka týdne ==')
const dny = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']
const pobocky = new Map([['b1', 'Černá Perla'], ['b2', 'Bernard']])
const osobyM = new Map([
  ['a', { id: 'a', jmeno: 'Andrea Mikulová', usekId: 'u-k', poziceId: 'p-kuchar', barva: null }],
  ['i', { id: 'i', jmeno: 'Irina', usekId: 'u-k', poziceId: 'p-kuchar', barva: null }],
  ['t', { id: 't', jmeno: 'Tomáš Kovář', usekId: 'u-p', poziceId: 'p-cisnik', barva: null }],
  ['o', { id: 'o', jmeno: 'Oxy', usekId: null, poziceId: null, barva: null }],
  ['z', { id: 'z', jmeno: 'Žaneta', usekId: 'u-p', poziceId: 'p-cisnik', barva: null }],
])
n = 0
const smenyM = [
  smena('2026-09-21', 'a', '08:00', '16:00'),
  smena('2026-09-22', 'a', '08:00', '16:00'),
  smena('2026-09-22', 'i', '08:00', '22:00'),
  smena('2026-09-23', 't', '18:00', '02:00'), // přes půlnoc = 8 h
  koncept('2026-09-23', 'o', '10:00', '14:00'),
  koncept('2026-09-24', null, '10:00', '18:00'),
  smena('2026-09-25', 't', '10:00', '16:00', { branch_id: 'b2' }),
  smena('2026-09-30', 'a', '08:00', '16:00'), // mimo okno
  smena('2026-09-22', 'a', '08:00', '16:00', { status: 'cancelled' }), // zrušená se nekreslí
]
const M = (filtr = FILTR_DESKTOP_PRAZDNY, bez = [osobyM.get('z')]) =>
  sestavitMrizku({ smeny: smenyM, dny, osoby: osobyM, useky, pobocky, lideBezSmeny: bez, filtr })
const mr = M()
je('pobočky abecedně', mr.pobocky.map((p) => p.nazev), ['Bernard', 'Černá Perla'])
je('Černá Perla: neobsazené první, pak úseky podle pořadí firmy, Bez úseku poslední', mr.pobocky[1].skupiny.map((s) => s.nazev), ['Neobsazené směny', 'Kuchyně', 'Plac', 'Bez úseku'])
const kuchyne = mr.pobocky[1].skupiny.find((s) => s.nazev === 'Kuchyně')
je('Kuchyně: dva lidé', kuchyne.lidi, 2)
je('Kuchyně: Andrea 16 h + Irina 14 h = 1800 min', kuchyne.minut, 16 * 60 + 14 * 60 - 0)
je('lidé v úseku abecedně', kuchyne.radky.map((r) => r.jmeno), ['Andrea Mikulová', 'Irina'])
je('zrušená směna se do mřížky nedostala', kuchyne.radky[0].smenyPodleDne.get('2026-09-22').length, 1)
je('směna mimo okno se do mřížky nedostala', kuchyne.radky[0].smenyPodleDne.has('2026-09-30'), false)
const neobs = mr.pobocky[1].skupiny[0]
je('neobsazená skupina nemá lidi, jen hodiny (8 h)', [neobs.lidi, neobs.minut], [0, 480])
je('lidé bez směny mají vlastní skupinu pod pobočkami', M().bezSmeny.radky.map((r) => r.jmeno), ['Žaneta'])
je('bez lidí bez směny žádná skupina není', M(FILTR_DESKTOP_PRAZDNY, []).bezSmeny, null)
const tomas = mr.pobocky[0].skupiny[0].radky[0]
je('Tomáš na druhé pobočce: řádek se objeví i tam', tomas.jmeno, 'Tomáš Kovář')
je('směna přes půlnoc 18–02 = 480 min, ne záporná', mr.pobocky[1].skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Tomáš Kovář').minut, 480)
je('nevydaných směn v řádku Oxy', mr.pobocky[1].skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Oxy').nevydanych, 1)
je('celkem hodin lidí (neobsazené se nepočítají): Andrea 16 + Irina 14 + Tomáš 8 + Oxy 4 + Tomáš/b2 6 = 48 h', mr.celkemMinut, 48 * 60)
je('po dnech: úterý = Andrea + Irina, 8 + 14 = 22 h', mr.poDnech.get('2026-09-22'), { lidi: 2, minut: 22 * 60 })
je('po dnech: čtvrtek jen neobsazená směna — nikdo, 0 h', mr.poDnech.get('2026-09-24'), { lidi: 0, minut: 0 })

console.log('\n== Mřížka: hledání a filtry ==')
const jmenaVsech = (m) => [
  ...m.pobocky.flatMap((p) => p.skupiny.flatMap((s) => s.radky.map((r) => r.jmeno))),
  ...(m.bezSmeny?.radky.map((r) => r.jmeno) ?? []),
]
je('hledání „irin“', jmenaVsech(M(F({ hledani: 'irin' }))), ['Irina'])
je('hledání bez diakritiky: „tomas“', jmenaVsech(M(F({ hledani: 'tomas' }))), ['Tomáš Kovář', 'Tomáš Kovář'])
je('hledání najde i člověka bez směny („zan“)', jmenaVsech(M(F({ hledani: 'zan' }))), ['Žaneta'])
je('úsek Kuchyně: Andrea, Irina — a neobsazená směna, ta se filtrem úseku neschová',
  jmenaVsech(M(F({ useky: ['u-k'] }))), ['Neobsazeno', 'Andrea Mikulová', 'Irina'])
je('úsek Kuchyně: druhá pobočka (jen Plac) zmizí celá',
  M(F({ useky: ['u-k'] })).pobocky.map((p) => p.nazev), ['Černá Perla'])
je('stav nevydané: Oxy a neobsazené (mají koncept)', jmenaVsech(M(F({ stav: 'nevydane' }))).sort(), ['Neobsazeno', 'Oxy'])
je('stav nevydané neukáže lidi bez směny', M(F({ stav: 'nevydane' })).bezSmeny, null)
je('stav neobsazené: jen neobsazená skupina', jmenaVsech(M(F({ stav: 'neobsazene' }))), ['Neobsazeno'])
je('zaměstnanec Andrea: jen její řádek', jmenaVsech(M(F({ osoba: 'a' }))), ['Andrea Mikulová'])
je('pozice Číšník: Tomáš (obě pobočky) i Žaneta bez směny', jmenaVsech(M(F({ pozice: ['p-cisnik'] }))), ['Tomáš Kovář', 'Tomáš Kovář', 'Žaneta'])
je('nic nevyhovuje: prázdná mřížka', [M(F({ hledani: 'qqq' })).pocetRadku, M(F({ hledani: 'qqq' })).pobocky.length], [0, 0])
je('součty se řídí filtrem: jen Irina = 14 h', M(F({ hledani: 'irin' })).celkemMinut, 14 * 60)
je('bez filtru vidím všech osm řádků (Andrea, Irina, Tomáš×2, Oxy, Neobsazeno, Žaneta)', M().pocetRadku, 7)

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
