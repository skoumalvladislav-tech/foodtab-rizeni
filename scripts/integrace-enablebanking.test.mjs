#!/usr/bin/env node
/**
 * Enable Banking — podpis JWT (čistá kryptografie, bez sítě) a bez
 * klíčů appka nikdy nezkusí zavolat ven. lib/integrace-enablebanking.ts.
 *
 * Síťové volání (nactiBanky/zahajitPripojeni/dokoncitCallback s
 * NAKONFIGUROVANÝMI klíči) appka tady schválně NETESTUJE — reálné
 * enablebanking.com by tím dostalo testovací provoz zbytečně (a
 * appka nemá sandbox token, kterým by se to dalo bezpečně vyzkoušet).
 * Guard bez klíčů (žádná síť) je testovaný pro všechny tři.
 *
 * Pusť `node --experimental-strip-types scripts/integrace-enablebanking.test.mjs`.
 *
 * Volba poskytovatele a proč je tohle „jen" podpis + kontrakt (ne
 * celý flow proti produkci): docs/hlaseni/banka-poskytovatele-2026-10-04.md.
 */

import { generateKeyPairSync, createVerify } from 'node:crypto'

delete process.env.ENABLEBANKING_APPLICATION_ID
delete process.env.ENABLEBANKING_PRIVATE_KEY

const { jeNakonfigurovano, enableBankingProvider, podepsatJwt, nactiBanky } = await import('../lib/integrace-enablebanking.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function base64urlDecode(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
}

console.log('\n== Bez klíčů appka hlásí nenakonfigurováno, nic nevolá ==')

ok('jeNakonfigurovano() je false', jeNakonfigurovano() === false)

const vysledekZustatky = await enableBankingProvider.nactiZustatky('acc-1', 'nejaky-token')
ok('nactiZustatky() vrátí chybu bez klíčů, ne pokus o síť', vysledekZustatky.stav === 'chyba')
ok('hláška zmiňuje chybějící proměnné prostředí', vysledekZustatky.stav === 'chyba' && /ENABLEBANKING_/.test(vysledekZustatky.duvod))

const vysledekTransakce = await enableBankingProvider.nactiTransakce('acc-1', 'token', '2026-09-01', '2026-09-30')
ok('nactiTransakce() vrátí chybu bez klíčů', vysledekTransakce.stav === 'chyba')

const vysledekBanky = await nactiBanky()
ok('nactiBanky() vrátí chybu bez klíčů, ne pokus o síť', vysledekBanky.stav === 'chyba')

const vysledekZahajeni = await enableBankingProvider.zahajitPripojeni('https://example.test/vratit', 'Testovací banka')
ok('zahajitPripojeni() vrátí chybu bez klíčů', vysledekZahajeni.stav === 'chyba')

const vysledekCallback = await enableBankingProvider.dokoncitCallback('https://example.test/vratit?code=x')
ok('dokoncitCallback() vrátí chybu bez klíčů', vysledekCallback.stav === 'chyba')

let spadloBezKlicu = false
try {
  await podepsatJwt()
} catch {
  spadloBezKlicu = true
}
ok('podepsatJwt() bez klíčů spadne, ne tichý podpis prázdnotou', spadloBezKlicu)

console.log('\n== Podpis JWT s klíči — tvar a platnost podpisu (bez sítě) ==')

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

process.env.ENABLEBANKING_APPLICATION_ID = 'test-application-id'
process.env.ENABLEBANKING_PRIVATE_KEY = privateKey

ok('jeNakonfigurovano() je true s oběma proměnnými', jeNakonfigurovano() === true)

const jwt = await podepsatJwt()
const casti = jwt.split('.')
ok('JWT má tři části (header.payload.signature)', casti.length === 3)

const hlavicka = base64urlDecode(casti[0])
ok('header.typ je JWT', hlavicka.typ === 'JWT')
ok('header.alg je RS256', hlavicka.alg === 'RS256')
ok('header.kid je application id', hlavicka.kid === 'test-application-id')

const telo = base64urlDecode(casti[1])
ok('payload.iss je enablebanking.com', telo.iss === 'enablebanking.com')
ok('payload.aud je api.enablebanking.com', telo.aud === 'api.enablebanking.com')
ok('exp je přesně iat + 3600 (appka nenechává token naležavo déle, než potřebuje)', telo.exp - telo.iat === 3600)
ok('iat je blízko teď (appka ho nepodepisuje dopředu ani zpětně)', Math.abs(telo.iat - Math.floor(Date.now() / 1000)) < 5)

const overovac = createVerify('RSA-SHA256')
overovac.update(`${casti[0]}.${casti[1]}`)
ok(
  'podpis sedí na soukromý klíč, se kterým appka token vytvořila',
  overovac.verify(publicKey, Buffer.from(casti[2], 'base64url')),
)

const cizíKlic = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' } }).publicKey
const overovacCizi = createVerify('RSA-SHA256')
overovacCizi.update(`${casti[0]}.${casti[1]}`)
ok(
  'podpis NEsedí na cizí veřejný klíč (schválné rozbití)',
  !overovacCizi.verify(cizíKlic, Buffer.from(casti[2], 'base64url')),
)

delete process.env.ENABLEBANKING_APPLICATION_ID
delete process.env.ENABLEBANKING_PRIVATE_KEY

console.log('\n== Capability mapa odpovídá tomu, co appka o Enable Banking doložila ==')

ok('způsob připojení je souhlas_redirect (PSD2), ne ruční token', enableBankingProvider.schopnosti.zpusobPripojeni === 'souhlas_redirect')
ok('firemní účty ano (zadání: appka to potřebuje pro restaurace)', enableBankingProvider.schopnosti.firemniUcty === true)
ok('VS/reference ne (appka nedoložila, že by je PSD2 feed dával jako pole)', enableBankingProvider.schopnosti.vsReference === false)
ok('historie dní je null (appka si nevymýšlí číslo, závisí na bance)', enableBankingProvider.schopnosti.historieDnu === null)
ok('pendingTransakce ano (appka dostane i nevypořádané, byť je filtruje)', enableBankingProvider.schopnosti.pendingTransakce === true)
ok('klíč providera je "enablebanking"', enableBankingProvider.klic === 'enablebanking')

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `SELHALO: ${chyb} kontrol`}`)
if (chyb > 0) process.exit(1)
