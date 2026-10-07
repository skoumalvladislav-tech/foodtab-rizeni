#!/usr/bin/env node
/**
 * `overitPodpisWebhookuSaltEdge` — čistá RSA-SHA256 ověřovací logika
 * z lib/integrace-saltedge.ts, žádné IO. Appka nemá partnerský účet
 * (žádný živý webhook), test proto ověřuje ALGORITMUS vlastním
 * vygenerovaným klíčovým párem, ne proti skutečnému Salt Edge klíči.
 *
 * Pusť `node --experimental-strip-types --conditions=react-server
 * scripts/integrace-saltedge.test.mjs`.
 */

import { generateKeyPairSync, createSign } from 'node:crypto'

const { overitPodpisWebhookuSaltEdge } = await import('../lib/integrace-saltedge.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const verejnyKlicPem = publicKey.export({ type: 'spki', format: 'pem' })
const soukromyKlicPem = privateKey.export({ type: 'pkcs8', format: 'pem' })

function podepsat(callbackUrl, telo) {
  const podepisovac = createSign('RSA-SHA256')
  podepisovac.update(`${callbackUrl}|${telo}`, 'utf8')
  return podepisovac.sign(soukromyKlicPem, 'base64')
}

const CALLBACK_URL = 'https://foodtab.cz/api/integrace/saltedge/webhook'
const TELO = JSON.stringify({ data: { connection_id: '111', customer_id: 'tenant-abc', stage: 'finish' } })

console.log('\n== Platný podpis prochází ==')
ok('správný podpis nad správnou url+tělem se ověří', overitPodpisWebhookuSaltEdge(CALLBACK_URL, TELO, podepsat(CALLBACK_URL, TELO), verejnyKlicPem))

console.log('\n== Schválné rozbití — appka musí odmítnout, ne přehlédnout ==')
ok(
  'pozměněné tělo (jiná connection_id) podpis NEPROJDE',
  !overitPodpisWebhookuSaltEdge(CALLBACK_URL, JSON.stringify({ data: { connection_id: '999' } }), podepsat(CALLBACK_URL, TELO), verejnyKlicPem),
)
ok(
  'pozměněná callback_url podpis NEPROJDE (chrání i proti přesměrování na jinou appku)',
  !overitPodpisWebhookuSaltEdge('https://utocnik.cz/webhook', TELO, podepsat(CALLBACK_URL, TELO), verejnyKlicPem),
)
ok(
  'podpis cizím (neodpovídajícím) klíčem NEPROJDE',
  !overitPodpisWebhookuSaltEdge(CALLBACK_URL, TELO, podepsat(CALLBACK_URL, TELO), generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' })),
)
ok(
  'poškozený base64 podpis appku nerozbije (vrátí false, ne pád)',
  !overitPodpisWebhookuSaltEdge(CALLBACK_URL, TELO, 'neplatny-base64-!!!', verejnyKlicPem),
)
ok(
  'prázdný veřejný klíč appku nerozbije (vrátí false, ne pád)',
  !overitPodpisWebhookuSaltEdge(CALLBACK_URL, TELO, podepsat(CALLBACK_URL, TELO), 'neni to PEM klic'),
)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
