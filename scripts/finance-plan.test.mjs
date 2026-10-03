#!/usr/bin/env node
/**
 * Rozpočet opakovaných položek — lib/finance-plan.ts.
 *
 * Pusť `node --experimental-strip-types scripts/finance-plan.test.mjs`.
 *
 * Čistá logika (žádné IO), ale přesně ten druh kódu, kde se chyba
 * neprojeví pohledem: posun o kalendářní měsíc místo o 30 dní, hraniční
 * den na okraji rozsahu, předpis zadaný dávno v minulosti. Kdyby se
 * ověřilo jen „pár typických měsíců", prošla by i chyba na okraji.
 */

const { pocetVyskytu, secistPlan } = await import('../lib/finance-plan.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Jednorázová položka ==')

ok('spadá do rozsahu, který ji obsahuje', pocetVyskytu('jednorazove', '2026-10-15', '2026-10-01', '2026-10-31') === 1)
ok('den PŘESNĚ na začátku rozsahu se počítá', pocetVyskytu('jednorazove', '2026-10-01', '2026-10-01', '2026-10-31') === 1)
ok('den PŘESNĚ na konci rozsahu se počítá', pocetVyskytu('jednorazove', '2026-10-31', '2026-10-01', '2026-10-31') === 1)
ok('den den před rozsahem se nepočítá', pocetVyskytu('jednorazove', '2026-09-30', '2026-10-01', '2026-10-31') === 0)
ok('den den po rozsahu se nepočítá', pocetVyskytu('jednorazove', '2026-11-01', '2026-10-01', '2026-10-31') === 0)

console.log('\n== Týdenní perioda ==')

// Říjen 2026 má 31 dní; od 1.10. (čtvrtek) každý čtvrtek do 31.10.: 1,8,15,22,29 = 5×.
ok('pět čtvrtků v říjnu 2026', pocetVyskytu('tydne', '2026-10-01', '2026-10-01', '2026-10-31') === 5)
ok('o jeden den kratší rozsah (do 28.10.) dá jen čtyři', pocetVyskytu('tydne', '2026-10-01', '2026-10-01', '2026-10-28') === 4)
ok('splatnost v minulosti se projektuje dopředu (ne jen jednou)',
  pocetVyskytu('tydne', '2026-01-01', '2026-10-01', '2026-10-31') === 5)

console.log('\n== Měsíční perioda — KALENDÁŘNÍ měsíc, ne 30 dní ==')

// Splatnost 31.1. — v únoru (28 dní v 2026, není přestupný) se 31. nekoná,
// JS Date.UTC(y, 1, 31) přetéká do 3. 3. To je žádoucí chování (datum
// „ujede" dopředu, nezmizí) — kontrola ověřuje, že se NEPOČÍTÁ dvakrát
// a že se rozpočet na leden–březen neliší nepředvídatelně.
ok('31. 1. → měsíčně do konce března dá 3 výskyty (leden, přetečený únor→březen dopadne na 3.3., březen)',
  pocetVyskytu('mesicne', '2026-01-31', '2026-01-01', '2026-03-31') === 3)

// Běžný případ beze zvláštností u konce měsíce.
ok('15. každého měsíce, leden–prosinec 2026 = 12×', pocetVyskytu('mesicne', '2026-01-15', '2026-01-01', '2026-12-31') === 12)
ok('15. každého měsíce, jen jeden měsíc = 1×', pocetVyskytu('mesicne', '2026-01-15', '2026-01-01', '2026-01-31') === 1)
ok('přechod roku (prosinec→leden) se počítá správně',
  pocetVyskytu('mesicne', '2026-11-15', '2026-12-01', '2027-01-31') === 2)

console.log('\n== Rozsah mimo rozumné pořadí / prázdný rozsah ==')

ok('do < od vrátí nulu, ne zápornou ani spadne', pocetVyskytu('mesicne', '2026-01-15', '2026-10-31', '2026-10-01') === 0)
ok('rozsah jednoho dne, který sedí, dá 1', pocetVyskytu('jednorazove', '2026-10-15', '2026-10-15', '2026-10-15') === 1)

console.log('\n== Strop proti nesmyslnému vstupu (dávná minulost, krátká perioda) ==')

ok('nespadne na splatnosti z minulého tisíciletí', (() => {
  try {
    const n = pocetVyskytu('tydne', '1026-01-01', '2026-10-01', '2026-10-31')
    return typeof n === 'number'
  } catch {
    return false
  }
})())

console.log('\n== secistPlan: filtruje podle pobočky a sčítá směr zvlášť ==')

const PREDPISY = [
  { branchId: 'perla', smer: 'vydaj', castkaHaleru: 100000, perioda: 'mesicne', dalsiSplatnost: '2026-10-01' },
  { branchId: 'perla', smer: 'prijem', castkaHaleru: 50000, perioda: 'jednorazove', dalsiSplatnost: '2026-10-15' },
  { branchId: null, smer: 'vydaj', castkaHaleru: 200000, perioda: 'mesicne', dalsiSplatnost: '2026-10-01' },
  { branchId: 'jina-pobocka', smer: 'vydaj', castkaHaleru: 999999, perioda: 'mesicne', dalsiSplatnost: '2026-10-01' },
]

const perla = secistPlan(PREDPISY, 'perla', '2026-10-01', '2026-10-31')
ok('perla: výdaje jen z vlastních předpisů (100000)', perla.vydajeHaleru === 100000)
ok('perla: příjmy z jednorázové položky (50000)', perla.prijmyHaleru === 50000)
ok('perla: cizí pobočka se do toho nepromítla', perla.vydajeHaleru !== 999999 + 100000)

const firma = secistPlan(PREDPISY, null, '2026-10-01', '2026-10-31')
ok('firma (branchId null): jen firemní položka (200000)', firma.vydajeHaleru === 200000)
ok('firma: pobočkové položky se do firemního součtu NEpromítly', firma.prijmyHaleru === 0)

const prazdny = secistPlan([], 'perla', '2026-10-01', '2026-10-31')
ok('prázdný seznam předpisů dá nuly, ne spadne', prazdny.prijmyHaleru === 0 && prazdny.vydajeHaleru === 0)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
