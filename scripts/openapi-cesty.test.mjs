#!/usr/bin/env node
/**
 * Krok 6 zadání: OpenAPI musí sedět se skutečnými cestami.
 *
 * Pusť:
 *   node scripts/openapi-cesty.test.mjs
 *
 * Nečte se přes YAML knihovnu — `js-yaml` je jen tranzitivní závislost
 * (žádný balíček v `package.json` na ni nespoléhá přímo) a test na
 * bezpečnou stringovou shodu klíčů `paths:` nepotřebuje nic víc.
 *
 * Dva směry kontroly:
 *  1. Co je v `openapi.yaml`, musí mít odpovídající `route.ts` a v něm
 *     export té metody, kterou spis slibuje.
 *  2. Co má `route.ts` pod `app/api/` nebo `app/k/`, musí být v `openapi.yaml`
 *     — jinak nová veřejná cesta zůstane zdokumentovaná jen náhodou.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}

const koren = fileURLToPath(new URL('..', import.meta.url))
const specCesta = join(koren, 'docs', 'api', 'openapi.yaml')
const spec = readFileSync(specCesta, 'utf8')

/** Cesty z `paths:` — řádky s dvouznakovým odsazením `  /…:`. */
function cestyZeSpecu(text) {
  const radky = text.split(/\r?\n/)
  const start = radky.findIndex((r) => r.trim() === 'paths:')
  if (start === -1) throw new Error('Ve specu chybí sekce paths:')

  const vysledek = []
  for (let i = start + 1; i < radky.length; i++) {
    const r = radky[i]
    if (/^\S/.test(r)) break // konec sekce paths — další top-level klíč
    const shoda = r.match(/^  (\/\S+):\s*$/)
    if (shoda) vysledek.push(shoda[1])
  }
  return vysledek
}

/** Metody (get/post/…) zapsané pod jednou cestou, do další cesty nebo konce sekce. */
function metodyProCestu(text, cesta) {
  const radky = text.split(/\r?\n/)
  const zacatek = radky.findIndex((r) => r.trim() === `${cesta}:`)
  if (zacatek === -1) return []
  const metody = []
  for (let i = zacatek + 1; i < radky.length; i++) {
    const r = radky[i]
    if (/^  \S/.test(r)) break // další cesta na stejné úrovni
    const shoda = r.match(/^ {4}(get|post|put|patch|delete):\s*$/)
    if (shoda) metody.push(shoda[1].toUpperCase())
  }
  return metody
}

/** `/k/{klic}` → `k/[klic]` — Next.js App Router konvence. */
function jakoSlozka(cesta) {
  return cesta
    .replace(/^\//, '')
    .split('/')
    .map((seg) => seg.replace(/^\{(.+)\}$/, '[$1]'))
    .join('/')
}

const cesty = cestyZeSpecu(spec)
console.log(`\nCesty ve specu: ${cesty.length}`)
ok('spec obsahuje aspoň jednu cestu', cesty.length > 0)

console.log('\nSměr 1 — každá cesta ve specu má route.ts s odpovídajícím exportem')
for (const cesta of cesty) {
  const soubor = join(koren, 'app', jakoSlozka(cesta), 'route.ts')
  const relCesta = relative(koren, soubor)
  ok(`${cesta} → ${relCesta} existuje`, existsSync(soubor))
  if (!existsSync(soubor)) continue

  const obsah = readFileSync(soubor, 'utf8')
  const metody = metodyProCestu(spec, cesta)
  ok(`${cesta} má ve specu aspoň jednu metodu`, metody.length > 0)
  for (const m of metody) {
    ok(`${cesta}: route.ts exportuje ${m}`, new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(obsah))
  }
}

console.log('\nSměr 2 — každá route.ts pod app/api/ nebo app/k/ je ve specu')
function najitRouty(zaklad) {
  const vysledek = []
  const projit = (slozka) => {
    if (!existsSync(slozka)) return
    for (const polozka of readdirSync(slozka, { withFileTypes: true })) {
      const cesta = join(slozka, polozka.name)
      if (polozka.isDirectory()) projit(cesta)
      else if (polozka.name === 'route.ts') vysledek.push(cesta)
    }
  }
  projit(zaklad)
  return vysledek
}

const skutecneRouty = [
  ...najitRouty(join(koren, 'app', 'api')),
  ...najitRouty(join(koren, 'app', 'k')),
]

/** Obrácený převod: souborová cesta → cesta ve specu s `{param}`. */
function jakoSpecCestu(souborCesta) {
  const rel = relative(join(koren, 'app'), souborCesta).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
  return '/' + rel.split('/').map((seg) => seg.replace(/^\[(.+)\]$/, '{$1}')).join('/')
}

ok('v app/api a app/k existuje aspoň jedna route.ts', skutecneRouty.length > 0)
for (const souborCesta of skutecneRouty) {
  const specCestaOcek = jakoSpecCestu(souborCesta)
  ok(`${relative(koren, souborCesta)} je zdokumentovaná jako ${specCestaOcek}`, cesty.includes(specCestaOcek))
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
