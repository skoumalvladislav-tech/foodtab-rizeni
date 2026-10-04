#!/usr/bin/env node
/**
 * Enable Banking kostra — bez reálných klíčů appka nikdy nezkusí
 * zavolat ven. lib/integrace-enablebanking.ts.
 *
 * Pusť `node --experimental-strip-types scripts/integrace-enablebanking.test.mjs`.
 *
 * Volba poskytovatele a proč je tohle kostra (ne plně funkční
 * adaptér): docs/hlaseni/banka-poskytovatele-2026-10-04.md.
 */

delete process.env.ENABLEBANKING_APPLICATION_ID
delete process.env.ENABLEBANKING_PRIVATE_KEY

const { jeNakonfigurovano, enableBankingProvider, podepsatJwt } = await import('../lib/integrace-enablebanking.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Bez klíčů appka hlásí nenakonfigurováno, nic nevolá ==')

ok('jeNakonfigurovano() je false', jeNakonfigurovano() === false)

const vysledekZustatky = await enableBankingProvider.nactiZustatky('acc-1', 'nejaky-token')
ok('nactiZustatky() vrátí chybu bez klíčů, ne pokus o síť', vysledekZustatky.stav === 'chyba')
ok('hláška zmiňuje chybějící proměnné prostředí', vysledekZustatky.stav === 'chyba' && /ENABLEBANKING_/.test(vysledekZustatky.duvod))

const vysledekTransakce = await enableBankingProvider.nactiTransakce('acc-1', 'token', '2026-09-01', '2026-09-30')
ok('nactiTransakce() vrátí chybu bez klíčů', vysledekTransakce.stav === 'chyba')

console.log('\n== Podpis JWT nedokončen — appka to řekne nahlas, nepředstírá hotovo ==')

let spadloOcekavane = false
try {
  await podepsatJwt()
} catch (e) {
  spadloOcekavane = e instanceof Error && /nedokončila/.test(e.message)
}
ok('podepsatJwt() spadne se srozumitelnou hláškou, ne tichým "undefined"', spadloOcekavane)

console.log('\n== Capability mapa odpovídá tomu, co appka o Enable Banking doložila ==')

ok('způsob připojení je souhlas_redirect (PSD2), ne ruční token', enableBankingProvider.schopnosti.zpusobPripojeni === 'souhlas_redirect')
ok('firemní účty ano (zadání: appka to potřebuje pro restaurace)', enableBankingProvider.schopnosti.firemniUcty === true)
ok('VS/reference ne (appka nedoložila, že by je PSD2 feed dával jako pole)', enableBankingProvider.schopnosti.vsReference === false)
ok('historie dní je null (appka si nevymýšlí číslo, závisí na bance)', enableBankingProvider.schopnosti.historieDnu === null)
ok('pendingTransakce ano (appka dostane i nevypořádané, byť je filtruje)', enableBankingProvider.schopnosti.pendingTransakce === true)
ok('klíč providera je "enablebanking"', enableBankingProvider.klic === 'enablebanking')

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `SELHALO: ${chyb} kontrol`}`)
if (chyb > 0) process.exit(1)
