#!/usr/bin/env node
/**
 * Rolling cashflow výhled na 13 týdnů — lib/finance-rolling-vyhled.ts.
 *
 * Pusť `node --experimental-strip-types scripts/finance-rolling-vyhled.test.mjs`.
 *
 * Nejcitlivější místo je týdenní hranice (pondělí jako začátek) a to,
 * že kumulativní zůstatek se počítá z PŘEDCHOZÍHO zůstatku, ne znovu
 * od nuly — chyba tady by se neprojevila na jednom týdnu, jen na
 * součtu přes všech 13.
 */

const { pondelekTydne, agregovatPoTydnech, sestavRollingVyhled, KOEFICIENTY_SCENARU, POCET_TYDNU } =
  await import('../lib/finance-rolling-vyhled.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== pondelekTydne: hranice týdne ==')

// 2026-10-01 je čtvrtek (ověřeno už u finance-plan.test.mjs).
ok('čtvrtek 1.10.2026 patří do týdne začínajícího 28.9.', pondelekTydne('2026-10-01') === '2026-09-28')
ok('sobota 3.10.2026 patří do TÉHOŽ týdne', pondelekTydne('2026-10-03') === '2026-09-28')
ok('pondělí 5.10.2026 už je NOVÝ týden', pondelekTydne('2026-10-05') === '2026-10-05')
ok('neděle 4.10.2026 patří do STARÉHO týdne (poslední den týdne)', pondelekTydne('2026-10-04') === '2026-09-28')

console.log('\n== agregovatPoTydnech: součet, ignoruje převody ==')

const transakce = [
  { datum: '2026-09-28', smer: 'prijem', castkaHaleru: 10000 },
  { datum: '2026-10-01', smer: 'prijem', castkaHaleru: 5000 },
  { datum: '2026-10-01', smer: 'vydaj', castkaHaleru: 3000 },
  { datum: '2026-10-05', smer: 'prijem', castkaHaleru: 99999 }, // jiný týden
  { datum: '2026-09-29', smer: 'prevod_dovnitr', castkaHaleru: 50000 }, // nesmí se započítat
]
const agregace = agregovatPoTydnech(transakce)

ok('týden 28.9. má příjmy 15000 (10000+5000)', agregace.get('2026-09-28')?.prijmyHaleru === 15000)
ok('týden 28.9. má výdaje 3000', agregace.get('2026-09-28')?.vydajeHaleru === 3000)
ok('převod se nezapočítal do ani jednoho směru', agregace.get('2026-09-28')?.prijmyHaleru === 15000)
ok('jiný týden (5.10.) je oddělený', agregace.get('2026-10-05')?.prijmyHaleru === 99999)

console.log('\n== sestavRollingVyhled: 13 týdnů, kumulativní zůstatek ==')

const PREDPISY = [
  { branchId: 'perla', smer: 'vydaj', castkaHaleru: 700000, perioda: 'tydne', dalsiSplatnost: '2026-01-01' }, // nájem týdně 7000 Kč
]

const vyhled = sestavRollingVyhled(PREDPISY, new Map(), 1000000, '2026-10-03', 'zakladni', 'perla')

ok('vrátí přesně 13 týdnů', vyhled.tydny.length === POCET_TYDNU)
ok('první týden začíná pondělím 28.9.', vyhled.tydny[0].tydenOd === '2026-09-28')
ok('druhý týden navazuje bez mezery (5.10.)', vyhled.tydny[1].tydenOd === '2026-10-05')
ok('poslední týden je 12 týdnů od prvního', vyhled.tydny[12].tydenOd === '2026-12-21')

// Nájem 7000/týden, počáteční zůstatek 10000 Kč → po 1. týdnu 3000, po 2. záporný.
ok('po prvním týdnu zůstatek klesl o 7000 (10000→3000 Kč = 300000 haléřů)', vyhled.tydny[0].zustatekNaKonciHaleru === 300000)
ok('po druhém týdnu je zůstatek záporný (300000-700000)', vyhled.tydny[1].zustatekNaKonciHaleru === -400000)
ok('nekdyPodNulou je true', vyhled.nekdyPodNulou === true)

console.log('\n== Scénáře: koeficienty se viditelně liší ==')

const PREDPISY_PRIJEM = [
  { branchId: null, smer: 'prijem', castkaHaleru: 10000000, perioda: 'tydne', dalsiSplatnost: '2026-01-01' },
]

const zakladni = sestavRollingVyhled(PREDPISY_PRIJEM, new Map(), 0, '2026-10-03', 'zakladni', null)
const konzervativni = sestavRollingVyhled(PREDPISY_PRIJEM, new Map(), 0, '2026-10-03', 'konzervativni', null)
const optimisticky = sestavRollingVyhled(PREDPISY_PRIJEM, new Map(), 0, '2026-10-03', 'optimisticky', null)

ok('konzervativní scénář má nižší příjmy než základní', konzervativni.tydny[0].planPrijmyHaleru < zakladni.tydny[0].planPrijmyHaleru)
ok('optimistický scénář má vyšší příjmy než základní', optimisticky.tydny[0].planPrijmyHaleru > zakladni.tydny[0].planPrijmyHaleru)
ok('koeficienty základního scénáře jsou 1:1 (žádná úprava)', KOEFICIENTY_SCENARU.zakladni.prijmy === 1 && KOEFICIENTY_SCENARU.zakladni.vydaje === 1)

console.log('\n== Skutečnost aktuálního týdne je informativní, NEMĖNÍ zůstatek ==')

// Rolling výhled jde od aktuálního týdne jen DOPŘEDU — žádný vrácený
// týden není uzavřená minulost. Skutečnost (je-li pro týden k dispozici)
// se proto vrací jen k zobrazení, zůstatek se počítá z plánu i tak.
const skutecnostMapa = new Map([['2026-09-28', { prijmyHaleru: 999999, vydajeHaleru: 0 }]])
const sPlanemISkutecnosti = sestavRollingVyhled(PREDPISY, skutecnostMapa, 0, '2026-10-03', 'zakladni', 'perla')
ok('první týden je oznacen jako aktuální', sPlanemISkutecnosti.tydny[0].jeAktualni === true)
ok('druhý týden už aktuální není', sPlanemISkutecnosti.tydny[1].jeAktualni === false)
ok('zůstatek se počítá z PLÁNU (0 - 700000), ne ze skutečnosti', sPlanemISkutecnosti.tydny[0].zustatekNaKonciHaleru === -700000)
ok('skutecnostPrijmyHaleru se i tak vrátí pro informativní zobrazení', sPlanemISkutecnosti.tydny[0].skutecnostPrijmyHaleru === 999999)
ok('budoucí týden bez skutečnosti má null', sPlanemISkutecnosti.tydny[1].skutecnostPrijmyHaleru === null)

console.log('\n== Filtrace podle pobočky — cizí pobočka se nepromítne ==')

const vicPobocek = [
  { branchId: 'perla', smer: 'vydaj', castkaHaleru: 100000, perioda: 'tydne', dalsiSplatnost: '2026-01-01' },
  { branchId: 'bernard', smer: 'vydaj', castkaHaleru: 999999999, perioda: 'tydne', dalsiSplatnost: '2026-01-01' },
]
const jenPerla = sestavRollingVyhled(vicPobocek, new Map(), 0, '2026-10-03', 'zakladni', 'perla')
ok('jen perla se promítla do výdajů, ne bernard', jenPerla.tydny[1].planVydajeHaleru === 100000)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
