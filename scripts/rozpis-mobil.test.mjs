#!/usr/bin/env node
/**
 * Čistá logika mobilního rozpisu směn (lib/rozpis-mobil.ts).
 *
 * Pusť `node --experimental-strip-types scripts/rozpis-mobil.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 * Tři věci, které se na mobilu poznají hned:
 *   1. týden je od pondělí do neděle a přes hranici měsíce ani roku
 *      se nerozjede,
 *   2. směna přes půlnoc není záporná a hodiny sedí,
 *   3. filtry nikdy neschovají neobsazenou směnu, kterou je třeba vidět.
 *
 * Vzorová data jsou vymyšlená; nic z nich není zapsané v logice.
 */

import {
  BEZ_USEKU,
  FILTR_PRAZDNY,
  cisloDne,
  delkaPopis,
  denVTydnu,
  dnyTydne,
  hodinaKratce,
  hodinyKratce,
  inicialy,
  lidiPopis,
  mesicniMrizka,
  minutSmeny,
  neobsazenePopis,
  pondeliTydne,
  popisDne,
  popisDneKratce,
  popisMesice,
  popisTydne,
  posunDatum,
  rozsahCasu,
  rozsahKratce,
  sestavitDen,
  sestavitNadchazejici,
  sestavitTyden,
  smenaProOdecitac,
  smenyPodleDne,
  stitekDne,
} from '../lib/rozpis-mobil.ts'

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

console.log('\n== Týden je od pondělí do neděle ==')
je('22. 9. 2026 je úterý', denVTydnu('2026-09-22'), 1)
je('pondělí týdne úterý 22. 9.', pondeliTydne('2026-09-22'), '2026-09-21')
je('neděle 27. 9. patří do týdne, který začal 21. 9.', pondeliTydne('2026-09-27'), '2026-09-21')
je('pondělí 21. 9. je samo sobě pondělím', pondeliTydne('2026-09-21'), '2026-09-21')
je('týden má sedm dnů od po do ne', dnyTydne('2026-09-24'), [
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
])
je('přes hranici měsíce', dnyTydne('2026-09-30')[0], '2026-09-28')
je('přes hranici měsíce — neděle je v říjnu', dnyTydne('2026-09-30')[6], '2026-10-04')
je('přes hranici roku', dnyTydne('2026-12-31')[0], '2026-12-28')
je('přes hranici roku — neděle je v lednu', dnyTydne('2026-12-31')[6], '2027-01-03')
je('přechod na zimní čas (25. 10. 2026) neposune den', posunDatum('2026-10-24', 1), '2026-10-25')
je('přechod na zimní čas — další den', posunDatum('2026-10-25', 1), '2026-10-26')
je('přechod na letní čas (29. 3. 2026)', dnyTydne('2026-03-29')[6], '2026-03-29')

console.log('\n== Popisky ==')
je('Úterý 22. září', popisDne('2026-09-22'), 'Úterý 22. září')
je('Út 22. září', popisDneKratce('2026-09-22'), 'Út 22. září')
je('týden 21.–27. září', popisTydne('2026-09-22'), '21.–27. září')
je('týden přes měsíc', popisTydne('2026-09-30'), '28. září – 4. října')
je('Září 2026', popisMesice('2026-09-15'), 'Září 2026')
je('číslo dne', cisloDne('2026-09-05'), 5)
je('Dnes', stitekDne('2026-09-22', '2026-09-22'), 'Dnes')
je('Zítra', stitekDne('2026-09-23', '2026-09-22'), 'Zítra')
je('pozítří bez štítku', stitekDne('2026-09-24', '2026-09-22'), null)
je('iniciály dvou slov', inicialy('Andrea Mikulová'), 'AM')
je('iniciály víceslovného jména', inicialy('Jan Karel Novák'), 'JN')
je('iniciály jednoho slova', inicialy('Madonna'), 'MA')
je('iniciály prázdného jména', inicialy('  '), '?')

console.log('\n== Měsíční mřížka ==')
const zari = mesicniMrizka('2026-09-15')
je('září 2026 má pět týdnů', zari.length, 5)
je('první týden začíná pondělím 31. 8.', zari[0][0], '2026-08-31')
je('poslední týden končí nedělí 4. 10.', zari[4][6], '2026-10-04')
je('každý týden má sedm dnů', zari.every((t) => t.length === 7), true)
je('únor 2027 (28 dní od pondělí) má čtyři týdny', mesicniMrizka('2027-02-10').length, 4)

console.log('\n== Časy a hodiny ==')
je('08:00–16:00', rozsahCasu('08:00:00', '16:00:00'), '08:00–16:00')
je('8–16', rozsahKratce('08:00:00', '16:00:00'), '8–16')
je('8:30–16', rozsahKratce('08:30:00', '16:00:00'), '8:30–16')
je('půlnoc je 0', hodinaKratce('00:00:00'), '0')
je('16–0 přes půlnoc', rozsahKratce('16:00:00', '00:00:00'), '16–0')

const s = (o) => ({ pauza_od: null, pauza_do: null, ...o })
je('směna 08–16 = 480 min', minutSmeny(s({ starts_at: '08:00:00', ends_at: '16:00:00' })), 480)
je('směna přes půlnoc 18–02 = 480 min, ne záporná', minutSmeny(s({ starts_at: '18:00:00', ends_at: '02:00:00' })), 480)
je('22–06 = 480 min (stejný případ jako app.delka_smeny_minut)', minutSmeny(s({ starts_at: '22:00:00', ends_at: '06:00:00' })), 480)
je('trhaná směna odečte pauzu', minutSmeny(s({ starts_at: '10:00:00', ends_at: '22:00:00', pauza_od: '15:00:00', pauza_do: '17:00:00' })), 600)
je('pauza delší než směna nedá mínus', minutSmeny(s({ starts_at: '10:00:00', ends_at: '11:00:00', pauza_od: '10:00:00', pauza_do: '14:00:00' })), 0)
je('38 h', hodinyKratce(38 * 60), '38 h')
je('38 h 30 min', hodinyKratce(38 * 60 + 30), '38 h 30 min')
je('45 min', hodinyKratce(45), '45 min')
je('pro odečítač: 8 až 16 hodin', smenaProOdecitac({ starts_at: '08:00:00', ends_at: '16:00:00' }), 'směna 8 až 16 hodin')
je('pro odečítač: půlhodiny se nezaokrouhlují', smenaProOdecitac({ starts_at: '08:30:00', ends_at: '16:15:00' }), 'směna 8:30 až 16:15 hodin')
je('14 hodin', delkaPopis(14 * 60), '14 hodin')
je('1 hodina', delkaPopis(60), '1 hodina')
je('3 hodiny', delkaPopis(180), '3 hodiny')
je('8 hodin 30 min', delkaPopis(8 * 60 + 30), '8 hodin 30 min')

console.log('\n== Vzorová data ==')

const useky = new Map([
  ['u-kuchyn', 'Kuchyně'],
  ['u-obsluha', 'Obsluha'],
  ['u-bar', 'Bar'],
])
const osoba = (id, jmeno, usekId) => ({ id, jmeno, usekId, barva: null })
const osoby = new Map(
  [
    osoba('e-an', 'Andrea Mikulová', 'u-kuchyn'),
    osoba('e-pn', 'Petr Novák', 'u-kuchyn'),
    osoba('e-js', 'Jana Svobodová', 'u-kuchyn'),
    osoba('e-ls', 'Lucie Skoumalová', 'u-obsluha'),
    osoba('e-ve', 'Veronika Kovářová', 'u-bar'),
    osoba('e-bu', 'Brigádník Bez Úseku', null),
  ].map((o) => [o.id, o]),
)

let n = 0
const smena = (den, kdo, od, doKdy, extra = {}) => ({
  id: `s${++n}`,
  branch_id: 'b1',
  employee_id: kdo,
  position_id: null,
  shift_date: den,
  starts_at: od,
  ends_at: doKdy,
  status: 'planned',
  note: '',
  published_at: '2026-09-12T10:24:00Z',
  pauza_od: null,
  pauza_do: null,
  ...extra,
})

const UT = '2026-09-22'
const smeny = [
  smena(UT, 'e-an', '08:00:00', '16:00:00'),
  smena(UT, 'e-pn', '10:00:00', '18:00:00'),
  smena(UT, 'e-ls', '12:00:00', '20:00:00'),
  smena(UT, 'e-ve', '08:00:00', '22:00:00'),
  smena(UT, null, '16:00:00', '22:00:00', { position_id: 'p1' }),
  // Jana Svobodová v úterý nepracuje, ale ve středu ano → v úterý „Volno“.
  smena('2026-09-23', 'e-js', '08:00:00', '16:00:00'),
  // Zrušená směna se nepočítá nikam.
  smena(UT, 'e-js', '08:00:00', '16:00:00', { status: 'cancelled' }),
  // Jiný týden — do úterního přehledu nepatří.
  smena('2026-09-29', 'e-an', '08:00:00', '16:00:00'),
]

console.log('\n== Denní přehled ==')
const den = sestavitDen({ smeny, den: UT, osoby, useky, filtr: FILTR_PRAZDNY })
je('čtyři lidé pracují (zrušená směna se nepočítá)', den.lidiPracuje, 4)
je('jedna neobsazená směna', den.neobsazenychCelkem, 1)
je('pořadí skupin podle úseků: Kuchyně, Obsluha, Bar', den.skupiny.map((x) => x.nazev), ['Kuchyně', 'Obsluha', 'Bar'])
je('čipy: kolik lidí pracuje v úseku', den.poUsecich.map((x) => [x.nazev, x.pocet]), [['Kuchyně', 2], ['Obsluha', 1], ['Bar', 1]])
je('Kuchyně: nejdřív pracující podle času, Volno až na konci',
  den.skupiny[0].radky.map((r) => [r.osoba.jmeno, r.smeny.length]),
  [['Andrea Mikulová', 1], ['Petr Novák', 1], ['Jana Svobodová', 0]])
je('Kuchyně (2 pracují) — Volno se do počtu nepočítá', den.skupiny[0].pracuje, 2)
je('počet řádků = 4 lidé + Jana Volno + 1 neobsazená', den.pocetRadku, 6)

console.log('\n== Filtry ==')
const fUsek = sestavitDen({ smeny, den: UT, osoby, useky, filtr: { pobocky: [], useky: ['u-kuchyn'], stav: 'vse' } })
je('filtr úseku: jen Kuchyně', fUsek.skupiny.map((x) => x.nazev), ['Kuchyně'])
je('filtr úseku NESCHOVÁ neobsazenou směnu', fUsek.neobsazene.length, 1)
je('filtr úseku nemění hlavičku dne (8 lidí = celý den)', fUsek.lidiPracuje, 4)

const fObs = sestavitDen({ smeny, den: UT, osoby, useky, filtr: { pobocky: [], useky: [], stav: 'obsazene' } })
je('stav Obsazené: bez Jany (Volno)', fObs.skupiny[0].radky.map((r) => r.osoba.jmeno), ['Andrea Mikulová', 'Petr Novák'])
je('stav Obsazené: neobsazená směna se neukazuje', fObs.neobsazene.length, 0)

const fVolno = sestavitDen({ smeny, den: UT, osoby, useky, filtr: { pobocky: [], useky: [], stav: 'volno' } })
je('stav Volno: jen Jana', fVolno.skupiny.flatMap((x) => x.radky.map((r) => r.osoba.jmeno)), ['Jana Svobodová'])

const fNeob = sestavitDen({ smeny, den: UT, osoby, useky, filtr: { pobocky: [], useky: [], stav: 'neobsazene' } })
je('stav Neobsazené: žádní lidé, jen neobsazená směna', [fNeob.skupiny.length, fNeob.neobsazene.length], [0, 1])

const fJinaPobocka = sestavitDen({ smeny, den: UT, osoby, useky, filtr: { pobocky: ['b2'], useky: [], stav: 'vse' } })
je('filtr pobočky, která nemá nic: prázdný den', [fJinaPobocka.lidiPracuje, fJinaPobocka.pocetRadku], [0, 0])

const bezUseku = sestavitDen({
  smeny: [...smeny, smena(UT, 'e-bu', '09:00:00', '15:00:00')],
  den: UT, osoby, useky, filtr: FILTR_PRAZDNY,
})
je('člověk bez úseku padne do „Bez úseku“ na konec', bezUseku.skupiny.at(-1).nazev, 'Bez úseku')
const fBezUseku = sestavitDen({
  smeny: [...smeny, smena(UT, 'e-bu', '09:00:00', '15:00:00')],
  den: UT, osoby, useky, filtr: { pobocky: [], useky: [BEZ_USEKU], stav: 'vse' },
})
je('filtr „Bez úseku“', fBezUseku.skupiny.map((x) => x.nazev), ['Bez úseku'])

const prazdnyDen = sestavitDen({ smeny, den: '2026-09-26', osoby, useky, filtr: FILTR_PRAZDNY })
je('den bez směn: nikdo nepracuje a nic není neobsazené', [prazdnyDen.lidiPracuje, prazdnyDen.neobsazenychCelkem], [0, 0])

console.log('\n== Týdenní přehled ==')
const tyden = sestavitTyden({
  smeny: [
    ...smeny,
    // Andrea pracuje celý týden 8–16 → 5 × 480 = 2400 min = 40 h.
    ...['2026-09-21', '2026-09-23', '2026-09-24', '2026-09-25'].map((d) => smena(d, 'e-an', '08:00:00', '16:00:00')),
  ],
  den: '2026-09-24',
  osoby, useky, filtr: FILTR_PRAZDNY,
})
const andrea = tyden.radky.find((r) => r.osoba?.id === 'e-an')
je('Andrea: 40 h týdně (směna z jiného týdne se nepočítá)', andrea.minut, 2400)
je('Andrea: sedm dnů od pondělí', andrea.dny.map((d) => d.den[8] + d.den[9]), ['21', '22', '23', '24', '25', '26', '27'])
je('Andrea: sobota a neděle prázdné', andrea.dny.slice(5).every((d) => d.smeny.length === 0), true)
je('Andrea: úsek Kuchyně', andrea.usekNazev, 'Kuchyně')
je('poslední řádek je Neobsazeno', tyden.radky.at(-1).osoba, null)
je('lidé jsou seřazení podle úseku, pak podle jména',
  tyden.radky.filter((r) => r.osoba).map((r) => r.osoba.jmeno),
  ['Andrea Mikulová', 'Jana Svobodová', 'Petr Novák', 'Lucie Skoumalová', 'Veronika Kovářová'])
je('zrušená směna se v týdnu nepočítá',
  tyden.radky.find((r) => r.osoba?.id === 'e-js').minut, 480)

const tydenNocni = sestavitTyden({
  smeny: [smena(UT, 'e-ve', '18:00:00', '02:00:00')],
  den: UT, osoby, useky, filtr: FILTR_PRAZDNY,
})
je('noční směna 18–02 přičte 8 h, ne mínus 16', tydenNocni.radky[0].minut, 480)

const tydenNeobs = sestavitTyden({ smeny, den: UT, osoby, useky, filtr: { pobocky: [], useky: [], stav: 'neobsazene' } })
je('týden se stavem Neobsazené: jen řádek Neobsazeno', tydenNeobs.radky.map((r) => r.klic), ['neobsazeno'])

console.log('\n== Moje směny (zaměstnanec) ==')
const moje = [
  smena('2026-09-22', 'e-ve', '14:00:00', '22:00:00'),
  smena('2026-09-24', 'e-ve', '16:00:00', '00:00:00'),
  smena('2026-09-25', 'e-ve', '08:00:00', '16:00:00'),
  smena('2026-09-26', 'e-ve', '08:00:00', '16:00:00', { status: 'cancelled' }),
  smena('2026-10-20', 'e-ve', '08:00:00', '16:00:00'),
]
const nad = sestavitNadchazejici(moje, '2026-09-22')
je('Dnes, Zítra (volno) a dny se směnou; zrušená a vzdálená ne',
  nad.map((d) => [d.den, d.stitek, d.smeny.length]),
  [['2026-09-22', 'Dnes', 1], ['2026-09-23', 'Zítra', 0], ['2026-09-24', null, 1], ['2026-09-25', null, 1]])
const nadBezSmen = sestavitNadchazejici([], '2026-09-22')
je('bez směn zůstane Dnes a Zítra jako Volno', nadBezSmen.map((d) => d.stitek), ['Dnes', 'Zítra'])
je('podle dne pro kalendář: zrušená tam není', [...smenyPodleDne(moje).keys()], ['2026-09-22', '2026-09-24', '2026-09-25', '2026-10-20'])

console.log('\n== Skloňování ==')
je('1 neobsazená směna', neobsazenePopis(1), '1 neobsazená směna')
je('3 neobsazené směny', neobsazenePopis(3), '3 neobsazené směny')
je('5 neobsazených směn', neobsazenePopis(5), '5 neobsazených směn')
je('1 člověk naplánován', lidiPopis(1), '1 člověk naplánován')
je('3 lidé naplánováni', lidiPopis(3), '3 lidé naplánováni')
je('8 lidí naplánováno', lidiPopis(8), '8 lidí naplánováno')

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
