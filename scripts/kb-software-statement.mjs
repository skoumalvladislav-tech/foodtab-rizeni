#!/usr/bin/env node
/**
 * Software statement pro Komerční banku (ADAA) — jednou za 12 měsíců.
 *
 * Spouští MAJITEL na svém počítači, ne server: v produkci je potřeba
 * kvalifikovaný certifikát pro elektronickou pečeť (I.CA / PostSignum,
 * s názvem firmy a IČO), který na serveru nemá co dělat. Výsledný JWT
 * se pak vloží do Vercelu jako `KB_ADAA_SOFTWARE_STATEMENT`.
 *
 * Postup a adresy: docs/kb-adaa-navod.md (podle dokumentace KB,
 * stránka „Software Statements", developers.kb.cz).
 *
 * Použití:
 *   Sandbox (bez certifikátu):
 *     KB_API_KEY_CLIENT_REGISTRATION=… node scripts/kb-software-statement.mjs --prostredi sandbox --email vy@firma.cz
 *   Produkce (s certifikátem .p12/.pfx):
 *     KB_API_KEY_CLIENT_REGISTRATION=… KB_CERT_HESLO=… node scripts/kb-software-statement.mjs --prostredi produkce --email vy@firma.cz --cert pecet.p12
 *
 * Volitelně `--adresa https://…` (výchozí produkční adresa appky).
 * API klíč a heslo certifikátu se čtou jen z proměnných prostředí,
 * nikdy se nevypisují.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { request } from 'node:https'

const ADRESY = {
  sandbox: 'https://api-gateway.kb.cz/sandbox/client-registration/v3/software-statements',
  produkce: 'https://client-registration.api-gateway.kb.cz/v3/software-statements',
}

function argument(nazev) {
  const i = process.argv.indexOf(`--${nazev}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function konec(zprava) {
  console.error(`CHYBA: ${zprava}`)
  process.exit(1)
}

const prostredi = argument('prostredi')
const email = argument('email')
const adresa = (argument('adresa') ?? 'https://foodtab-rizeni.vercel.app').replace(/\/+$/, '')
const cert = argument('cert')
const apiKey = process.env.KB_API_KEY_CLIENT_REGISTRATION?.trim()

if (prostredi !== 'sandbox' && prostredi !== 'produkce') konec('--prostredi musí být sandbox nebo produkce.')
if (!email || !email.includes('@')) konec('--email je povinný (KB na něj posílá upozornění o platnosti).')
if (!apiKey) konec('Chybí proměnná KB_API_KEY_CLIENT_REGISTRATION (API klíč služby Client Registration z developers.kb.cz).')
if (prostredi === 'produkce' && !cert) konec('Produkce potřebuje --cert s kvalifikovaným certifikátem (.p12/.pfx).')

const telo = JSON.stringify({
  softwareName: 'Foodtab',
  softwareNameEn: 'Foodtab',
  // Stálé id odvozené z adresy appky — opakované spuštění za rok dá stejné.
  softwareId: createHash('sha256').update(adresa).digest('hex').slice(0, 32),
  softwareVersion: '1.0',
  softwareUri: adresa,
  redirectUris: [`${adresa}/api/integrace/kb/vratit`],
  tokenEndpointAuthMethod: 'client_secret_post',
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
  registrationBackUri: `${adresa}/api/integrace/kb/registrace`,
  contacts: [`email: ${email}`],
  logoUri: `${adresa}/icon-512.png`,
  tosUri: adresa,
  policyUri: adresa,
})

const url = new URL(ADRESY[prostredi])
const volby = {
  method: 'POST',
  hostname: url.hostname,
  path: url.pathname,
  headers: {
    'x-correlation-id': randomUUID(),
    apiKey,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(telo),
  },
  timeout: 30_000,
}
if (cert) {
  volby.pfx = readFileSync(cert)
  volby.passphrase = process.env.KB_CERT_HESLO ?? ''
}

const pozadavek = request(volby, (odpoved) => {
  let data = ''
  odpoved.setEncoding('utf8')
  odpoved.on('data', (kus) => { data += kus })
  odpoved.on('end', () => {
    if (odpoved.statusCode !== 200 && odpoved.statusCode !== 201) {
      konec(`KB odpověděla HTTP ${odpoved.statusCode}: ${data.slice(0, 300)}`)
    }
    const jwt = data.trim().replace(/^"|"$/g, '')
    const casti = jwt.split('.')
    if (casti.length !== 3) konec(`Odpověď nevypadá jako JWT: ${data.slice(0, 120)}`)
    try {
      const obsah = JSON.parse(Buffer.from(casti[1], 'base64url').toString('utf8'))
      const platnost = obsah.exp ? new Date(obsah.exp * 1000).toLocaleDateString('cs-CZ') : 'neuvedeno'
      console.error(`Software statement pro „${obsah.softwareName ?? '?'}" (${obsah.vendorName ?? '?'}), platí do ${platnost}.`)
      console.error('Vložte celý řádek níž do Vercelu jako KB_ADAA_SOFTWARE_STATEMENT:\n')
    } catch {
      console.error('Vložte celý řádek níž do Vercelu jako KB_ADAA_SOFTWARE_STATEMENT:\n')
    }
    console.log(jwt)
  })
})
pozadavek.on('timeout', () => pozadavek.destroy(new Error('vypršel čas')))
pozadavek.on('error', (e) => konec(`Spojení s KB selhalo: ${e.message}`))
pozadavek.end(telo)
