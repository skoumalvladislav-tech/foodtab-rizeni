#!/usr/bin/env node
/**
 * Živý přehled docházky (lib/dochazka-dnes.ts).
 *
 * Pusť `node --experimental-strip-types scripts/dochazka-dnes.test.mjs`.
 *
 * CO TO HLÍDÁ
 *
 *   1. „je v práci“ je totéž co `app.otevreny_prichod` — stornovaný
 *      příchod, systémem uzavřený příchod a stornovaný odchod se chovají
 *      stejně jako v databázi (přesně ta chyba, kvůli které vznikl
 *      lib/dochazka-stav.ts),
 *   2. stavy řádku odpovídají jen tomu, co se ví: směna ještě nezačala /
 *      už začala a příchod chybí / už skončila. Žádné „zpoždění“ s
 *      vymyšleným prahem,
 *   3. čas na místě je hrubý (příchod → odchod, otevřený do teď),
 *   4. směna se porovnává s příchodem v pásmu POBOČKY, ne serveru.
 *
 * Pouští se i pod TZ=UTC a TZ=America/New_York (viz konec): stejný
 * výsledek musí vyjít na stroji v Praze i na serveru ve Vercelu.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  otevrenyPrichod,
  pritomnostOsoby,
  sestavitPrehledDne,
} from '../lib/dochazka-dnes.ts'

if (!process.env.DOCHAZKA_DNES_V_PASMU) {
  // Znovu ve dvou cizích pásmech; vlastní kontroly se pustí níž.
  for (const tz of ['UTC', 'America/New_York']) {
    console.log(`\n>>> Pásmo procesu: ${tz}`)
    try {
      execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
        env: { ...process.env, TZ: tz, DOCHAZKA_DNES_V_PASMU: '1' },
        stdio: 'inherit',
      })
    } catch {
      process.exit(1)
    }
  }
}

let chyb = 0
const je = (nazev, skutecne, ocekavane) => {
  const ok = JSON.stringify(skutecne) === JSON.stringify(ocekavane)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${nazev}${ok ? '' : `\n         čekáno   ${JSON.stringify(ocekavane)}\n         skutečně ${JSON.stringify(skutecne)}`}`,
  )
}

const DEN = '2026-09-21' // pondělí, letní čas (UTC+2)
/** „13:00 pražského času“ jako ISO. Léto = UTC+2. */
const v = (hodiny, den = DEN) => `${den}T${String(Number(hodiny.split(':')[0]) - 2).padStart(2, '0')}:${hodiny.split(':')[1]}:00Z`

let n = 0
/** Událost docházky. `prepis.den` = jiný provozní den; ostatní klíče přepisují sloupce. */
const ud = (kdo, kind, kdy, prepis = {}) => {
  const { den = DEN, ...zbytek } = prepis
  return {
    employee_id: kdo,
    kind,
    occurred_at: v(kdy, den),
    business_date: den,
    branch_id: 'b1',
    stornovano_kdy: null,
    uzavreno_systemem: null,
    ...zbytek,
  }
}
const ted = (hodiny) => Date.parse(v(hodiny))

console.log('\n== Otevřený příchod = app.otevreny_prichod ==')
je('bez událostí není nic otevřeno', otevrenyPrichod([]), null)
je('příchod bez odchodu je otevřený', otevrenyPrichod([ud('a', 'in', '08:00')]).occurred_at, v('08:00'))
je('příchod a odchod: zavřeno', otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'out', '16:00')]), null)
je(
  'STORNOVANÝ příchod není otevřený (chyba, kvůli které vznikl dochazka-stav)',
  otevrenyPrichod([ud('a', 'in', '08:00', { stornovano_kdy: '2026-09-21T07:00:00Z' })]),
  null,
)
je(
  'systémem uzavřený příchod není otevřený',
  otevrenyPrichod([ud('a', 'in', '08:00', { uzavreno_systemem: '2026-09-21T10:00:00Z' })]),
  null,
)
je(
  'STORNOVANÝ odchod příchod nezavírá',
  otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'out', '16:00', { stornovano_kdy: '2026-09-21T15:00:00Z' })]).occurred_at,
  v('08:00'),
)
je(
  'odchod z JINÉHO provozního dne příchod nezavírá, ani když je časově pozdější (jako app.otevreny_prichod)',
  otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'out', '09:00', { den: '2026-09-22' })]).occurred_at,
  v('08:00'),
)
je(
  'odchod ze STARŠÍHO dne (časově dřív) příchod taky nezavírá',
  otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'out', '09:00', { den: '2026-09-20' })]).occurred_at,
  v('08:00'),
)
je(
  'odchod DŘÍVE než příchod ho nezavírá',
  otevrenyPrichod([ud('a', 'out', '07:00'), ud('a', 'in', '08:00')]).occurred_at,
  v('08:00'),
)
je(
  'dva příchody, první zavřený, druhý ne: otevřený je druhý',
  otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'out', '12:00'), ud('a', 'in', '13:00')]).occurred_at,
  v('13:00'),
)
je(
  'přestávka není odchod',
  otevrenyPrichod([ud('a', 'in', '08:00'), ud('a', 'break_start', '12:00'), ud('a', 'break_end', '12:30')]).occurred_at,
  v('08:00'),
)

console.log('\n== Přítomnost jednoho člověka ==')
const p1 = pritomnostOsoby([ud('a', 'in', '07:57')], DEN, ted('15:09'))
je('v práci od 07:57, 7 h 12 min', [p1.stav, p1.prichod, p1.odchod, p1.minutNaMiste], ['v_praci', v('07:57'), null, 432])
const p2 = pritomnostOsoby([ud('a', 'in', '08:00'), ud('a', 'out', '16:05')], DEN, ted('18:00'))
je('odešel: příchod, odchod, 8 h 5 min', [p2.stav, p2.prichod, p2.odchod, p2.minutNaMiste], ['odesel', v('08:00'), v('16:05'), 485])
const p3 = pritomnostOsoby([ud('a', 'in', '08:00'), ud('a', 'out', '12:00'), ud('a', 'in', '13:00')], DEN, ted('15:00'))
je('dvě dvojice: 4 h + 2 h (do teď) = 360', [p3.stav, p3.minutNaMiste, p3.prichod], ['v_praci', 360, v('08:00')])
const p4 = pritomnostOsoby([], DEN, ted('10:00'))
je('žádné události: nebyl', [p4.stav, p4.prichod, p4.minutNaMiste], ['nebyl', null, 0])
const p5 = pritomnostOsoby([ud('a', 'in', '08:00'), ud('a', 'break_start', '12:00')], DEN, ted('12:10'))
je('na přestávce', [p5.stav, p5.naPrestavce], ['v_praci', true])
const p6 = pritomnostOsoby([ud('a', 'in', '08:00'), ud('a', 'break_start', '12:00'), ud('a', 'break_end', '12:30')], DEN, ted('13:00'))
je('po přestávce už ne', p6.naPrestavce, false)
const p7 = pritomnostOsoby([ud('a', 'in', '08:00'), ud('a', 'in', '08:05')], DEN, ted('09:00'))
je('druhý příchod při otevřeném prvním se nepočítá dvakrát (60 min)', p7.minutNaMiste, 60)
const p8 = pritomnostOsoby([ud('a', 'in', '22:00', { den: '2026-09-20' })], DEN, ted('05:30'))
je(
  'noční směna: otevřený příchod z včerejška se ukáže s poznámkou a nezapočítá se do dneška',
  [p8.stav, p8.otevrenyZeDne, p8.minutNaMiste, p8.prichod],
  ['v_praci', '2026-09-20', 0, v('22:00', '2026-09-20')],
)
const p9 = pritomnostOsoby([ud('a', 'in', '08:00', { stornovano_kdy: '2026-09-21T07:00:00Z' })], DEN, ted('10:00'))
je('stornovaný příchod = nebyl', [p9.stav, p9.minutNaMiste], ['nebyl', 0])
const p10 = pritomnostOsoby([ud('a', 'in', '08:00', { uzavreno_systemem: '2026-09-21T10:00:00Z' })], DEN, ted('12:00'))
je('systémem uzavřený příchod: přišel, ale bez známého konce → odešel, 0 min', [p10.stav, p10.minutNaMiste, p10.odchod], ['odesel', 0, null])

console.log('\n== Přehled dne ==')
const smena = (kdo, od, doKdy, prepis = {}) => {
  n += 1
  return { id: `s${n}`, branch_id: 'b1', employee_id: kdo, shift_date: DEN, starts_at: `${od}:00`, ends_at: `${doKdy}:00`, ...prepis }
}
const jmena = { a: 'Andrea', b: 'Bára', c: 'Cyril', d: 'Dana', e: 'Eva', f: 'Filip' }
const prehled = (smeny, udalosti, kdy) =>
  sestavitPrehledDne({
    den: DEN,
    ted: ted(kdy),
    smeny,
    udalosti,
    zona: () => 'Europe/Prague',
    jmeno: (id) => jmena[id] ?? id,
  })

const smeny = [
  smena('a', '08:00', '16:00'), // přišla, v práci
  smena('b', '08:00', '16:00'), // odešla
  smena('c', '12:00', '20:00'), // ještě nezačala
  smena('d', '08:00', '16:00'), // směna běží, nepřišla
  smena('e', '06:00', '08:00'), // směna skončila, nepřišla
]
const udalosti = [ud('a', 'in', '07:57'), ud('b', 'in', '08:00'), ud('b', 'out', '13:00'), ud('f', 'in', '09:00')]
const P = prehled(smeny, udalosti, '10:00')
je('stavy: a v práci, d po začátku, e nepřišla, c nadchází, b odešla, f mimo rozpis v práci',
  Object.fromEntries(P.radky.map((r) => [r.osobaId, r.stav])),
  { a: 'v_praci', f: 'v_praci', d: 'po_zacatku', e: 'nepresel', c: 'nadchazi', b: 'odesel' })
je('pořadí: v práci, po začátku, nepřišli, nadchází, odešli',
  P.radky.map((r) => r.osobaId), ['a', 'f', 'd', 'e', 'c', 'b'])
je('Filip nemá směnu → mimo rozpis', P.radky.find((r) => r.osobaId === 'f').bezSmeny, true)
je('Andrea nemá bezSmeny', P.radky.find((r) => r.osobaId === 'a').bezSmeny, false)
je('souhrn', P.souhrn, {
  vPraci: 2,
  cekame: 1,
  poZacatku: 2,
  odesli: 1,
  minutNaMiste: 123 + 300 + 60,
})
je('plán řádku: 08:00–16:00', [P.radky[0].planOd, P.radky[0].planDo], ['08:00', '16:00'])
je('Andrea 07:57 → 10:00 = 123 min', P.radky[0].pritomnost.minutNaMiste, 123)

const P2 = prehled(smeny, [], '07:59')
je('těsně před 08:00 nikdo nepřišel: a, b, d, c čekají (nezačaly); e (06–08) už běží',
  Object.fromEntries(P2.radky.map((r) => [r.osobaId, r.stav])),
  { e: 'po_zacatku', a: 'nadchazi', b: 'nadchazi', d: 'nadchazi', c: 'nadchazi' })
const P3 = prehled(smeny, [], '08:00')
je('přesně v 08:00 směna „už začala“ (začátek = teď se nepočítá jako budoucnost)',
  P3.radky.find((r) => r.osobaId === 'a').stav, 'po_zacatku')

console.log('\n== Směna porovnaná v pásmu pobočky ==')
// 22:00–06:00: začne 21. 9. v 22:00 Praha (= 20:00Z) a skončí 22. 9. v 06:00 Praha.
const nocni = [smena('a', '22:00', '06:00')]
const N1 = prehled(nocni, [], '21:30')
const N2 = prehled(nocni, [], '22:30')
const N3 = sestavitPrehledDne({
  den: DEN, ted: Date.parse('2026-09-22T04:30:00Z'), smeny: nocni, udalosti: [],
  zona: () => 'Europe/Prague', jmeno: (id) => id,
})
je('noční 22–06: v 21:30 ještě nadchází', N1.radky[0].stav, 'nadchazi')
je('noční 22–06: ve 22:30 už začala', N2.radky[0].stav, 'po_zacatku')
je('noční 22–06: v 06:30 (04:30Z) už skončila → nepřišla', N3.radky[0].stav, 'nepresel')

const jinePasmo = sestavitPrehledDne({
  den: DEN, ted: Date.parse('2026-09-21T06:30:00Z'), smeny: [smena('a', '08:00', '16:00')], udalosti: [],
  zona: () => 'UTC', jmeno: (id) => id,
})
je('stejná směna v pásmu UTC začíná o dvě hodiny později než v Praze (06:30Z je v UTC před 08:00)',
  jinePasmo.radky[0].stav, 'nadchazi')
const praha = sestavitPrehledDne({
  den: DEN, ted: Date.parse('2026-09-21T06:30:00Z'), smeny: [smena('a', '08:00', '16:00')], udalosti: [],
  zona: () => 'Europe/Prague', jmeno: (id) => id,
})
je('… a v Praze (08:30 místního času) už začala', praha.radky[0].stav, 'po_zacatku')

console.log('\n== Nic k hlášení ==')
const jenVcera = prehled([], [ud('a', 'in', '08:00', { den: '2026-09-20' }), ud('a', 'out', '16:00', { den: '2026-09-20' })], '10:00')
je('kdo včera pracoval a odešel a dnes nemá nic, v přehledu není', jenVcera.radky, [])
je('prázdný den: samé nuly', prehled([], [], '10:00').souhrn, { vPraci: 0, cekame: 0, poZacatku: 0, odesli: 0, minutNaMiste: 0 })

console.log(chyb === 0 ? '\n  VŠECHNY KONTROLY PROŠLY\n' : `\n  CHYB: ${chyb}\n`)
process.exit(chyb === 0 ? 0 : 1)
