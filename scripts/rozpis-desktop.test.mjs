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

import { BEZ_USEKU, mesicniMrizka } from '../lib/rozpis-mobil.ts'
import {
  MAX_LIDI_V_MESICI,
  VYCHOZI_POHLED,
  jeMesicniPohled,
  jePohled,
  zacatekOkna,
} from '../lib/rozpis-konstanty.ts'
import {
  FILTR_DESKTOP_PRAZDNY,
  POPIS_PUNTIKU,
  cekaNaVydani,
  dalsiVolnyDen,
  denKratce,
  hodinyStruc,
  jeFiltrPrazdny,
  potvrzeniPlatne,
  jmenoVyhovuje,
  kratkyCas,
  normalizuj,
  pocetFiltru,
  pocetFiltruVPanelu,
  potvrzeniZRadku,
  puntikSmeny,
  puvodniStav,
  sestavitMesicOsoby,
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

console.log('\n== Puntík: červený / žlutý / zelený ==')
/*
  Puntík u času směny (Šéfík 20. 9. 2026): červený = nevydáno, žlutý = vydáno
  a nepotvrzeno, zelený = vydáno a potvrzeno. „Potvrzeno“ je skutečné
  potvrzení zaměstnancem (`smeny_potvrzeni`) a platí, jen dokud se směna
  shoduje s tím, co člověk potvrdil.
*/
const DNES = '2026-09-22'
const potvrzeniK = (s, prepis = {}) => ({
  shift_id: s.id,
  employee_id: s.employee_id,
  shift_date: s.shift_date,
  starts_at: s.starts_at,
  ends_at: s.ends_at,
  pauza_od: s.pauza_od,
  pauza_do: s.pauza_do,
  confirmed_at: '2026-09-18T08:00:00Z',
  ...prepis,
})
const okno = (smeny, { pobocky = ['b1'], bezUctu = [] } = {}) => potvrzeniZRadku(smeny, pobocky, bezUctu)

const v1 = smena('2026-09-23', 'a', '08:00', '16:00')
const v2 = smena('2026-09-24', 'a', '08:00', '16:00')
const mAno = okno([potvrzeniK(v1)])

je('nevydaná (koncept) směna: červený, ať je potvrzení jakékoli',
  [puntikSmeny(koncept('2026-09-23', 'a', '08:00', '16:00'), mAno, DNES), puntikSmeny(koncept('2026-09-23', 'a', '08:00', '16:00'), null, DNES)], ['nevydano', 'nevydano'])
je('nevydaná neobsazená směna: taky červený (je to ještě koncept)', puntikSmeny(koncept('2026-09-23', null, '08:00', '16:00'), mAno, DNES), 'nevydano')
je('vydaná a po vydání změněná: červený (lidé mají starou verzi), i když starou potvrdili',
  puntikSmeny(smena('2026-09-23', 'a', '10:00', '18:00', { published_starts_at: '08:00:00', published_ends_at: '16:00:00' }), okno([potvrzeniK(v1)]), DNES), 'nevydano')
je('zrušená a vrácená (published_status cancelled): červený', puntikSmeny(smena('2026-09-23', 'a', '08:00', '16:00', { published_status: 'cancelled' }), mAno, DNES), 'nevydano')
je('vydaná a potvrzená: zelený', puntikSmeny(v1, mAno, DNES), 'potvrzeno')
je('vydaná, potvrzení k ní není: žlutý', puntikSmeny(v2, mAno, DNES), 'nepotvrzeno')
je('vydaná: potvrzení se nenačetlo (null / undefined) → žádný puntík, „nepotvrzeno“ se nevymýšlí',
  [puntikSmeny(v1, null, DNES), puntikSmeny(v1, undefined, DNES)], [null, null])
je('žádné potvrzení (nikdo nic nepotvrdil) není totéž co „nenačteno“: vydaná je žlutá, ne bez puntíku',
  [puntikSmeny(v1, okno([]), DNES), puntikSmeny(v1, null, DNES)], ['nepotvrzeno', null])
je('vydaná směna z pobočky, za kterou se potvrzení nečtou (vedoucí tam neplánuje) → žádný puntík',
  puntikSmeny(v1, okno([potvrzeniK(v1)], { pobocky: ['b2'] }), DNES), null)
je('… ale koncept z takové pobočky je pořád červený (to ví každý)', puntikSmeny(koncept('2026-09-23', 'a', '08:00', '16:00'), okno([], { pobocky: ['b2'] }), DNES), 'nevydano')
je('vydaná neobsazená směna: žádný puntík, není komu ji potvrdit', puntikSmeny(smena('2026-09-23', null, '08:00', '16:00'), okno([]), DNES), null)
je('vydaná směna zaměstnance bez účtu: žádný puntík (nemá jak potvrdit), ne věčně žlutý',
  [puntikSmeny(v2, okno([], { bezUctu: ['a'] }), DNES), puntikSmeny(v2, okno([], { bezUctu: ['jiny'] }), DNES)], [null, 'nepotvrzeno'])
je('žlutý se u směn v minulosti nekreslí, dnešek a budoucnost ano',
  [puntikSmeny(smena('2026-09-21', 'a', '08:00', '16:00'), okno([]), DNES), puntikSmeny(smena('2026-09-22', 'a', '08:00', '16:00'), okno([]), DNES)],
  [null, 'nepotvrzeno'])
je('… a potvrzená směna v minulosti je zelená',
  (() => { const m = smena('2026-09-21', 'a', '08:00', '16:00'); return puntikSmeny(m, okno([potvrzeniK(m)]), DNES) })(), 'potvrzeno')

// Platnost: potvrzení nese opis směny a platí, jen dokud se směna s ním shoduje.
const zmen = (prepis) => puntikSmeny({ ...v1, ...prepis }, mAno, DNES)
je('potvrzení přestane platit po změně času (i když ještě není znovu vydáno): začátek, konec, den, pauza, člověk',
  [zmen({ starts_at: '09:00:00', published_starts_at: '09:00:00' }), zmen({ ends_at: '17:00:00', published_ends_at: '17:00:00' }),
   zmen({ shift_date: '2026-09-25' }), zmen({ pauza_od: '12:00:00', pauza_do: '13:00:00' }),
   zmen({ employee_id: 'b', published_employee_id: 'b' })],
  ['nepotvrzeno', 'nepotvrzeno', 'nepotvrzeno', 'nepotvrzeno', 'nepotvrzeno'])
je('pauza: změna jen začátku, nebo jen konce pauzy potvrzení zneplatní (každá zvlášť)',
  [zmen({ pauza_od: '12:00:00' }), zmen({ pauza_do: '13:00:00' })], ['nepotvrzeno', 'nepotvrzeno'])
je('… a vrátí-li se změna zpátky, potvrzení platí zas (vydaná směna, opis sedí)', zmen({}), 'potvrzeno')
je('čas se porovnává jako čas, ne jako text: „08:00“ a „08:00:00“ je totéž',
  puntikSmeny({ ...v1, starts_at: '08:00' }, mAno, DNES), 'potvrzeno')
je('potvrzení jiného člověka (směna se po potvrzení přeřadila) neplatí ani při shodných časech',
  puntikSmeny({ ...v1, employee_id: 'b', published_employee_id: 'b' }, okno([potvrzeniK(v1)]), DNES), 'nepotvrzeno')
je('po přeřazení: platí potvrzení toho, kdo směnu má teď (řádky jsou dva, od dvou lidí)',
  puntikSmeny({ ...v1, employee_id: 'b', published_employee_id: 'b' }, okno([potvrzeniK(v1), potvrzeniK(v1, { employee_id: 'b' })]), DNES), 'potvrzeno')
je('potvrzeniPlatne: bez záznamu nebo bez člověka na směně neplatí', [potvrzeniPlatne(v1, null), potvrzeniPlatne(v1, undefined), potvrzeniPlatne({ ...v1, employee_id: null }, potvrzeniK(v1))], [false, false, false])
je('slova k puntíkům (legenda, title, odečítač) mají jediné místo',
  [POPIS_PUNTIKU.nevydano, POPIS_PUNTIKU.nepotvrzeno, POPIS_PUNTIKU.potvrzeno], ['Nevydáno', 'Vydáno, nepotvrzeno', 'Vydáno a potvrzeno'])
je('všechny tři barvy se opravdu dají dostat', [...new Set([v1, v2, koncept('2026-09-23', 'a', '08:00', '16:00')].map((s) => puntikSmeny(s, mAno, DNES)))].sort(), ['nepotvrzeno', 'nevydano', 'potvrzeno'])
je('řádky z databáze se seskupí podle id směny, včetně pobočky a lidí bez účtu',
  [Object.keys(okno([potvrzeniK(v1), potvrzeniK(v1, { employee_id: 'b' }), potvrzeniK(v2)]).podleSmeny).length, okno([potvrzeniK(v1), potvrzeniK(v1, { employee_id: 'b' })]).podleSmeny[v1.id].length, okno([], { bezUctu: ['x'] }).bezUctu],
  [2, 2, ['x']])

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
je('počet filtrů: úsek (2) + pozice (1) + zaměstnanci (2) + pobočka (1) + stav (1)', pocetFiltru({
  hledani: 'x', useky: ['u1', 'u2'], pozice: ['p1'], osoby: ['e1', 'e2'], pobocky: ['b1'], stav: 'nevydane',
}), 7)
je('hledání se do počtu filtrů nepočítá', pocetFiltru({ ...FILTR_DESKTOP_PRAZDNY, hledani: 'x' }), 0)
// Odznak u tlačítka Filtry počítá jen to, co je uvnitř té nabídky — pobočka se vybírá v Zobrazit.
je('odznak Filtry: pobočka se nepočítá', pocetFiltruVPanelu({
  hledani: '', useky: ['u1'], pozice: [], osoby: ['e1'], pobocky: ['b1', 'b2'], stav: 'nevydane',
}), 3)
je('odznak Filtry: samotná pobočka = žádný odznak (a přitom filtr prázdný není)',
  [pocetFiltruVPanelu({ ...FILTR_DESKTOP_PRAZDNY, pobocky: ['b1'] }), jeFiltrPrazdny({ ...FILTR_DESKTOP_PRAZDNY, pobocky: ['b1'] })], [0, false])
je('odznak Filtry bez pobočky sedí s celkovým počtem', [pocetFiltruVPanelu({ ...FILTR_DESKTOP_PRAZDNY, useky: ['u1'], stav: 'vydane' }), pocetFiltru({ ...FILTR_DESKTOP_PRAZDNY, useky: ['u1'], stav: 'vydane' })], [2, 2])

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
je('zaměstnanec: neobsazená směna se schová', vyhovuje(volna, { osoby: ['a'] }), false)
je('dva zaměstnanci najednou: Andrea a Tomáš ano, Oxy ne', [sa, sb, sc].map((s) => vyhovuje(s, { osoby: ['a', 'b'] })), [true, true, false])
je('dva zaměstnanci: neobsazená směna se schová i tady', vyhovuje(volna, { osoby: ['a', 'b'] }), false)
je('dva zaměstnanci + úsek Kuchyně (AND): jen Andrea', [sa, sb, sc].map((s) => vyhovuje(s, { osoby: ['a', 'b'], useky: ['u-k'] })), [true, false, false])
je('dva zaměstnanci + hledání „tom“ (AND): jen Tomáš', [sa, sb, sc].map((s) => vyhovuje(s, { osoby: ['a', 'b'], hledani: 'tom' })), [false, true, false])
je('člověk s jiným id, než je v seznamu, projde jen bez filtru zaměstnanců', [vyhovuje(sc, { osoby: ['a'] }), vyhovuje(sc, {})], [false, true])
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
/*
  V okně jsou dvě pobočky → mřížka se po pobočkách NEDĚLÍ: každý člověk má
  jeden řádek se všemi svými směnami (Šéfík 20. 9. 2026), takže se nezdvojí
  a jeho hodiny sedí s exportem. Pobočku nese karta směny.
*/
je('dvě pobočky v okně: jedna skupina všech lidí, bez pruhu pobočky', [mr.pobocky.length, mr.pobocky[0].jePobocka, mr.pobocky[0].nazev], [1, false, ''])
const vse = mr.pobocky[0]
je('úseky podle pořadí firmy, neobsazené první, Bez úseku poslední', vse.skupiny.map((s) => s.nazev), ['Neobsazené směny', 'Kuchyně', 'Plac', 'Bez úseku'])
je('každý člověk právě jednou (Tomáš dělal na obou pobočkách)', vse.skupiny.flatMap((s) => s.radky.map((r) => r.jmeno)).filter((j) => j === 'Tomáš Kovář').length, 1)
je('Tomášův řádek má obě směny: 23. 9. na Černé Perle i 25. 9. na Bernardu',
  [...vse.skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Tomáš Kovář').smenyPodleDne.keys()].sort(), ['2026-09-23', '2026-09-25'])
je('… a jeden součet přes obě pobočky: 8 h + 6 h = 14 h (jako v exportu)', vse.skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Tomáš Kovář').minut, 14 * 60)
je('součty skupiny: lidé i hodiny bez neobsazených směn (48 h = Celkem v patičce)', [vse.lidi, vse.minut, mr.celkemMinut], [4, 48 * 60, 48 * 60])
je('a pocetLidi počítá i Žanetu bez směny, Tomáše jednou', mr.pocetLidi, 5)

// Jedna pobočka v okně → pruh pobočky a pod ním úseky (Šéfík 19. 9. 2026).
const jednaPobocka = sestavitMrizku({
  smeny: smenyM.filter((s) => s.branch_id === 'b1'), dny, osoby: osobyM, useky, pobocky,
  lideBezSmeny: [osobyM.get('z')], filtr: FILTR_DESKTOP_PRAZDNY,
})
je('jedna pobočka: pruh pobočky s názvem', [jednaPobocka.pobocky.length, jednaPobocka.pobocky[0].jePobocka, jednaPobocka.pobocky[0].nazev], [1, true, 'Černá Perla'])
je('… a pod ním úseky', jednaPobocka.pobocky[0].skupiny.map((s) => s.nazev), ['Neobsazené směny', 'Kuchyně', 'Plac', 'Bez úseku'])
je('… součty pruhu: 4 lidé, 42 h (volná směna 8 h se nepřičítá)', [jednaPobocka.pobocky[0].lidi, jednaPobocka.pobocky[0].minut], [4, 42 * 60])
je('… a sedí s „Celkem“ v patičce', jednaPobocka.pobocky[0].minut, jednaPobocka.celkemMinut)
je('výběr jedné pobočky v Zobrazit vrátí pruh zpátky', [M(F({ pobocky: ['b1'] })).pobocky[0].jePobocka, M(F({ pobocky: ['b1'] })).pobocky[0].nazev], [true, 'Černá Perla'])

const kuchyne = vse.skupiny.find((s) => s.nazev === 'Kuchyně')
je('Kuchyně: dva lidé', kuchyne.lidi, 2)
je('Kuchyně: Andrea 16 h + Irina 14 h = 1800 min', kuchyne.minut, 16 * 60 + 14 * 60 - 0)
je('lidé v úseku abecedně', kuchyne.radky.map((r) => r.jmeno), ['Andrea Mikulová', 'Irina'])
je('zrušená směna se do mřížky nedostala', kuchyne.radky[0].smenyPodleDne.get('2026-09-22').length, 1)
je('směna mimo okno se do mřížky nedostala', kuchyne.radky[0].smenyPodleDne.has('2026-09-30'), false)
const neobs = vse.skupiny[0]
je('neobsazená skupina nemá lidi, jen hodiny (8 h)', [neobs.lidi, neobs.minut], [0, 480])
je('lidé bez směny mají vlastní skupinu pod pobočkami', M().bezSmeny.radky.map((r) => r.jmeno), ['Žaneta'])
je('bez lidí bez směny žádná skupina není', M(FILTR_DESKTOP_PRAZDNY, []).bezSmeny, null)
je('směna přes půlnoc 18–02 = 480 min, ne záporná', jednaPobocka.pobocky[0].skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Tomáš Kovář').minut, 480)
je('nevydaných směn v řádku Oxy', vse.skupiny.flatMap((s) => s.radky).find((r) => r.jmeno === 'Oxy').nevydanych, 1)
je('celkem hodin lidí (neobsazené se nepočítají): Andrea 16 + Irina 14 + Tomáš 8 + Oxy 4 + Tomáš/b2 6 = 48 h', mr.celkemMinut, 48 * 60)
je('po dnech: úterý = Andrea + Irina, 8 + 14 = 22 h', mr.poDnech.get('2026-09-22'), { lidi: 2, minut: 22 * 60 })
je('po dnech: čtvrtek jen neobsazená směna — nikdo, 0 h', mr.poDnech.get('2026-09-24'), { lidi: 0, minut: 0 })

console.log('\n== Mřížka: hledání a filtry ==')
const jmenaVsech = (m) => [
  ...m.pobocky.flatMap((p) => p.skupiny.flatMap((s) => s.radky.map((r) => r.jmeno))),
  ...(m.bezSmeny?.radky.map((r) => r.jmeno) ?? []),
]
je('hledání „irin“', jmenaVsech(M(F({ hledani: 'irin' }))), ['Irina'])
je('hledání bez diakritiky: „tomas“ — jeden řádek, i když dělá na dvou pobočkách', jmenaVsech(M(F({ hledani: 'tomas' }))), ['Tomáš Kovář'])
je('hledání najde i člověka bez směny („zan“)', jmenaVsech(M(F({ hledani: 'zan' }))), ['Žaneta'])
je('úsek Kuchyně: Andrea, Irina — a neobsazená směna, ta se filtrem úseku neschová',
  jmenaVsech(M(F({ useky: ['u-k'] }))), ['Neobsazeno', 'Andrea Mikulová', 'Irina'])
je('úsek Kuchyně: zůstanou jen kuchyňské skupiny (a neobsazené, ty se úsekem neschovají)',
  M(F({ useky: ['u-k'] })).pobocky[0].skupiny.map((s) => s.nazev), ['Neobsazené směny', 'Kuchyně'])
je('stav nevydané: Oxy a neobsazené (mají koncept)', jmenaVsech(M(F({ stav: 'nevydane' }))).sort(), ['Neobsazeno', 'Oxy'])
je('stav nevydané neukáže lidi bez směny', M(F({ stav: 'nevydane' })).bezSmeny, null)
je('stav neobsazené: jen neobsazená skupina', jmenaVsech(M(F({ stav: 'neobsazene' }))), ['Neobsazeno'])
je('zaměstnanec Andrea: jen její řádek', jmenaVsech(M(F({ osoby: ['a'] }))), ['Andrea Mikulová'])
je('dva zaměstnanci: Andrea a Irina', jmenaVsech(M(F({ osoby: ['a', 'i'] }))), ['Andrea Mikulová', 'Irina'])
je('dva zaměstnanci: Irina a Žaneta (Žaneta nemá směnu, ale je vybraná)', jmenaVsech(M(F({ osoby: ['i', 'z'] }))), ['Irina', 'Žaneta'])
je('dva zaměstnanci: součty jen jejich (Andrea 16 + Irina 14 = 30 h)', M(F({ osoby: ['a', 'i'] })).celkemMinut, 30 * 60)
je('dva zaměstnanci: neobsazená skupina se schová', M(F({ osoby: ['a', 'i'] })).pobocky[0].skupiny.some((s) => s.druh === 'neobsazene'), false)
je('Tomáš (dvě pobočky) vybraný: jeden řádek se součtem přes obě (8 + 6 = 14 h)',
  [jmenaVsech(M(F({ osoby: ['t'] }))), M(F({ osoby: ['t'] })).celkemMinut], [['Tomáš Kovář'], 14 * 60])
je('pozice Číšník: Tomáš (jednou, přes obě pobočky) i Žaneta bez směny', jmenaVsech(M(F({ pozice: ['p-cisnik'] }))), ['Tomáš Kovář', 'Žaneta'])
je('nic nevyhovuje: prázdná mřížka', [M(F({ hledani: 'qqq' })).pocetRadku, M(F({ hledani: 'qqq' })).pobocky.length], [0, 0])
je('součty se řídí filtrem: jen Irina = 14 h', M(F({ hledani: 'irin' })).celkemMinut, 14 * 60)
je('bez filtru vidím šest řádků (Andrea, Irina, Tomáš, Oxy, Neobsazeno, Žaneta) — Tomáš jen jednou', M().pocetRadku, 6)

console.log('\n== Pohledy a začátek okna ==')
je('výchozí pohled je „sedm“ (sedm následujících dní)', VYCHOZI_POHLED, 'sedm')
je('platné pohledy', ['den', 'sedm', 'tyden', 'mesic', 'osoby'].map(jePohled), [true, true, true, true, true])
je('neplatné pohledy (adrese se nevěří)', ['', null, undefined, 'týden', 'TYDEN', 'mesic ', '__proto__'].map(jePohled), [false, false, false, false, false, false, false])
je('sedm dní běží od zvoleného dne (čtvrtek 24. 9.)', zacatekOkna('sedm', '2026-09-24'), '2026-09-24')
je('týden je kalendářní: čtvrtek 24. 9. → pondělí 21. 9.', zacatekOkna('tyden', '2026-09-24'), '2026-09-21')
je('týden: pondělí zůstane pondělím', zacatekOkna('tyden', '2026-09-21'), '2026-09-21')
je('týden: neděle patří k týdnu, který začal o šest dní dřív', zacatekOkna('tyden', '2026-09-27'), '2026-09-21')
je('týden přes hranici měsíce: středa 2. 9. → pondělí 31. 8.', zacatekOkna('tyden', '2026-09-02'), '2026-08-31')
je('týden přes hranici roku: pátek 1. 1. 2027 → pondělí 28. 12. 2026', zacatekOkna('tyden', '2027-01-01'), '2026-12-28')
je('měsíc, den, osoby a neznámý pohled běží od zvoleného dne', ['mesic', 'den', 'osoby', 'nesmysl', undefined, null].map((p) => zacatekOkna(p, '2026-09-24')), Array(6).fill('2026-09-24'))
je('měsíční pohledy: měsíc a osoby (načítá se celý měsíc), ostatní ne', ['mesic', 'osoby', 'sedm', 'tyden', 'den', undefined].map(jeMesicniPohled), [true, true, false, false, false, false])
je('celý měsíc jde ukázat nejvýš dvěma lidem', MAX_LIDI_V_MESICI, 2)

console.log('\n== Zobrazit: pobočka a úsek ==')
const sPob1 = smena('2026-09-22', 'a', '08:00', '16:00')
const sPob2 = smena('2026-09-22', 'a', '08:00', '12:00', { branch_id: 'b2' })
const volnaPob2 = koncept('2026-09-22', null, '10:00', '18:00', { branch_id: 'b2' })
je('pobočka b2: jen směny b2, i neobsazená (pobočka patří směně, ne člověku)',
  [sPob1, sPob2, volnaPob2].map((s) => vyhovuje(s, { pobocky: ['b2'] })), [false, true, true])
je('pobočka b1: opak', [sPob1, sPob2, volnaPob2].map((s) => vyhovuje(s, { pobocky: ['b1'] })), [true, false, false])
je('bez výběru pobočky vyhoví všechny', [sPob1, sPob2, volnaPob2].map((s) => vyhovuje(s, {})), [true, true, true])
je('pobočka + úsek se sčítají (AND): b2 a Kuchyně = jen Andreina směna na b2 (neobsazená úsek nemá a filtrem úseku se neschová)',
  [sPob1, sPob2, volnaPob2, sb].map((s) => vyhovuje(s, { pobocky: ['b2'], useky: ['u-k'] })), [false, true, true, false])
je('víc poboček najednou (vlastní výběr)', [sPob1, sPob2].map((s) => vyhovuje(s, { pobocky: ['b1', 'b2'] })), [true, true])

const zPobocek = (filtr) => M(F(filtr))
const jmenaSkupin = (mr2) => mr2.pobocky.map((p) => [p.nazev, p.skupiny.map((sk) => sk.nazev)])
je('mřížka jen pro Bernard: jediná pobočka, jen Tomáš (jeho b2 směna 25. 9.), bez neobsazených a bez lidí bez směny',
  [jmenaSkupin(zPobocek({ pobocky: ['b2'] })), zPobocek({ pobocky: ['b2'] }).bezSmeny, zPobocek({ pobocky: ['b2'] }).celkemMinut], [[['Bernard', ['Plac']]], null, 6 * 60])
je('… a Tomášův řádek v ní má jen tu jednu směnu (6 h), ne obě', zPobocek({ pobocky: ['b2'] }).pobocky[0].skupiny[0].radky[0].minut, 6 * 60)
je('mřížka jen pro Černou Perlu: Tomášova b2 směna se nepočítá (48 h − 6 h = 42 h)', [zPobocek({ pobocky: ['b1'] }).pobocky.map((p) => p.nazev), zPobocek({ pobocky: ['b1'] }).celkemMinut], [['Černá Perla'], 42 * 60])
je('mřížka: pobočka + úsek Kuchyně na Bernardu = prázdná (na b2 nikdo z kuchyně není)', zPobocek({ pobocky: ['b2'], useky: ['u-k'] }).pocetRadku, 0)
je('mřížka: pobočka + úsek Kuchyně na Černé Perle = Andrea a Irina (a neobsazená směna, která se filtrem úseku neschová)', jmenaVsech(zPobocek({ pobocky: ['b1'], useky: ['u-k'] })), ['Neobsazeno', 'Andrea Mikulová', 'Irina'])
je('lidé bez směny se bez výběru pobočky ukazují dál (Žaneta)', jmenaVsech(M()).includes('Žaneta'), true)
je('mřížka pro obě vybrané pobočky najednou: bez pruhů a hodiny jako bez filtru (48 h)',
  [zPobocek({ pobocky: ['b1', 'b2'] }).pobocky.map((p) => p.jePobocka), zPobocek({ pobocky: ['b1', 'b2'] }).celkemMinut], [[false], 48 * 60])
je('… a Tomáš je i tam jen jednou, se součtem přes obě pobočky',
  [jmenaVsech(zPobocek({ pobocky: ['b1', 'b2'], osoby: ['t'] })), zPobocek({ pobocky: ['b1', 'b2'], osoby: ['t'] }).celkemMinut], [['Tomáš Kovář'], 14 * 60])

console.log('\n== Uložit a přidat další den ==')
je('bez obsazených dní: hned další den', dalsiVolnyDen([], '2026-09-03'), '2026-09-04')
je('přeskočí dny, které člověk už má (4. a 5. 9. → 6. 9.)', dalsiVolnyDen(['2026-09-04', '2026-09-05'], '2026-09-03'), '2026-09-06')
je('obsazený je jen jiný den, ne ten hned další', dalsiVolnyDen(['2026-09-10'], '2026-09-03'), '2026-09-04')
je('uložený den sám se nepočítá (hledá se až po něm)', dalsiVolnyDen(['2026-09-03'], '2026-09-03'), '2026-09-04')
je('přes konec měsíce: 30. 9. + obsazený 1. 10. → 2. 10.', dalsiVolnyDen(['2026-10-01'], '2026-09-30'), '2026-10-02')
je('přes konec roku: 31. 12. → 1. 1.', dalsiVolnyDen([], '2026-12-31'), '2027-01-01')
je('zpětné dny nevadí (jen ty po uloženém)', dalsiVolnyDen(['2026-09-01', '2026-09-02'], '2026-09-03'), '2026-09-04')
je('obsazeno všechno v dosahu: den hned po uložené směně', dalsiVolnyDen(['2026-09-04', '2026-09-05', '2026-09-06'], '2026-09-03', 3), '2026-09-04')
je('funguje i nad množinou', dalsiVolnyDen(new Set(['2026-09-04']), '2026-09-03'), '2026-09-05')

console.log('\n== Krátké zápisy ==')
je('celá hodina bez :00, bez nuly navíc', [kratkyCas('08:00'), kratkyCas('22:00'), kratkyCas('00:00')], ['8', '22', '0'])
je('půlhodina zůstane celá, jen bez nuly navíc', [kratkyCas('15:30'), kratkyCas('08:15'), kratkyCas('00:30')], ['15:30', '8:15', '0:30'])
je('hodiny jako české číslo', [hodinyStruc(480), hodinyStruc(1890), hodinyStruc(0), hodinyStruc(100)], ['8 h', '31,5 h', '0 h', '1,67 h'])

console.log('\n== Celý měsíc jednoho člověka ==')
const tydnyZari = mesicniMrizka('2026-09-15')
je('září 2026 má pět týdnů, od pondělí 31. 8. do neděle 4. 10.', [tydnyZari.length, tydnyZari[0][0], tydnyZari[4][6]], [5, '2026-08-31', '2026-10-04'])
n = 0
const mesicSmeny = [
  smena('2026-09-01', 'a', '08:00', '16:00'),
  smena('2026-09-02', 'a', '08:00', '16:00'),
  koncept('2026-09-02', 'a', '18:00', '20:00'), // druhá směna téhož dne, nevydaná
  smena('2026-09-30', 'a', '10:00', '18:00'),
  smena('2026-08-31', 'a', '08:00', '12:00'), // pondělí před měsícem — okolní týden
  smena('2026-10-01', 'a', '08:00', '12:00'), // čtvrtek po měsíci — okolní týden
  smena('2026-09-15', 'a', '08:00', '16:00', { status: 'cancelled' }), // zrušená se nekreslí
  smena('2026-09-01', 'b', '08:00', '16:00'), // jiný člověk
  koncept('2026-09-03', null, '08:00', '16:00'), // neobsazená
]
const mo = sestavitMesicOsoby({ smeny: mesicSmeny, osobaId: 'a', tydny: tydnyZari, mesic: '2026-09' })
je('pět týdnů po sedmi dnech', [mo.tydny.length, mo.tydny.every((t) => t.dny.length === 7)], [5, true])
je('den mimo měsíc je označený (31. 8. a 1. 10.)', [mo.tydny[0].dny[0].vMesici, mo.tydny[0].dny[1].vMesici, mo.tydny[4].dny[3].vMesici], [false, true, false])
je('jen směny tohoto člověka: 1. 9. má jednu', mo.tydny[0].dny[1].smeny.map((s) => s.starts_at), ['08:00:00'])
je('dvě směny téhož dne po začátku: 2. 9.', mo.tydny[0].dny[2].smeny.map((s) => s.starts_at), ['08:00:00', '18:00:00'])
je('zrušená směna se nedostala do kalendáře (15. 9.)', mo.tydny[2].dny[1].smeny.length, 0)
je('neobsazená a cizí směny se nedostaly do kalendáře (3. 9.)', mo.tydny[0].dny[3].smeny.length, 0)
je('hodiny týdne 1 zahrnují i 31. 8.: 4 + 8 + 8 + 2 = 22 h', mo.tydny[0].minut, 22 * 60)
je('hodiny měsíce jsou jen dny měsíce: 8 + 8 + 2 + 8 = 26 h (bez 31. 8. a 1. 10.)', mo.minut, 26 * 60)
je('směn v měsíci: 4 (bez okolních týdnů)', mo.smen, 4)
je('nevydané v měsíci: jen večerní z 2. 9.', mo.nevydanych, 1)
je('týden na konci měsíce: 30. 9. + 1. 10. = 8 + 4 = 12 h', mo.tydny[4].minut, 12 * 60)
const prazdny = sestavitMesicOsoby({ smeny: mesicSmeny, osobaId: 'neexistuje', tydny: tydnyZari, mesic: '2026-09' })
je('člověk bez směn: samé nuly, kalendář ale existuje', [prazdny.tydny.length, prazdny.minut, prazdny.smen, prazdny.nevydanych], [5, 0, 0, 0])
je('směna přes půlnoc se počítá kladně (22–06 = 8 h)', sestavitMesicOsoby({ smeny: [smena('2026-09-10', 'a', '22:00', '06:00')], osobaId: 'a', tydny: tydnyZari, mesic: '2026-09' }).minut, 480)
je('trhaná směna: pauza uvnitř se odečte (10–22 s pauzou 15–17 = 10 h)', sestavitMesicOsoby({ smeny: [smena('2026-09-10', 'a', '10:00', '22:00', { pauza_od: '15:00:00', pauza_do: '17:00:00' })], osobaId: 'a', tydny: tydnyZari, mesic: '2026-09' }).minut, 600)

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
