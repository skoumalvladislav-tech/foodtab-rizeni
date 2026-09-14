#!/usr/bin/env node
/**
 * Levý sloupec a spodní lišta marketingu.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-navigace.test.mjs
 *
 * Seznam, pořadí a schovávání podle práv jsou závazné ze zadání
 * docs/hlaseni/zadani-pro-ai-marketing-faktury.md, krok 1.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { aktivniKlic, sestavNavigaci } from '../lib/marketing-navigace.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, skutecnost === cekano, `${skutecnost} ≠ ${cekano}`)

const nazvy = (seznam) => seznam.map((p) => p.nazev).join(' · ')
const klice = (seznam) => seznam.map((p) => p.klic)
const vse = () => true
const bez = (...prava) => (pravo) => !prava.includes(pravo)
const bezDuplicit = (popis, seznam) =>
  ok(popis, new Set(klice(seznam)).size === seznam.length, klice(seznam).join(','))

const koren = fileURLToPath(new URL('..', import.meta.url))

console.log('\nPlná práva')
const plna = sestavNavigaci('cerna-perla', vse, 3)
ma(
  'hlavní položky v pořadí',
  nazvy(plna.hlavni),
  'Přehled · Vytvořit obsah · Mediální knihovna · Menu · Šablony · Kalendář · Ke schválení · Kampaně a automatizace · Publikované · Analytika',
)
ma('nastavení v pořadí', nazvy(plna.nastaveni), 'Brand kit provozovny · Integrace a nástroje · Tým, role a audit')
ma('spodní lišta', nazvy(plna.spodni), 'Přehled · Vytvořit obsah · Kalendář · Ke schválení · Mediální knihovna')
ma('přehled vede na rozcestník', plna.hlavni[0].href, '/cerna-perla/marketing')
ma('kalendář vede pod marketing', plna.hlavni.find((p) => p.klic === 'kalendar').href, '/cerna-perla/marketing/kalendar')
ma('počítadlo jen u Ke schválení', klice([...plna.hlavni, ...plna.nastaveni].filter((p) => p.cislo > 0)).join(), 'schvalovani')
ma('počítadlo nese počet čekajících', plna.hlavni.find((p) => p.klic === 'schvalovani').cislo, 3)

for (const p of [...plna.hlavni, ...plna.nastaveni]) {
  const segment = p.href.slice('/cerna-perla/marketing'.length).replace(/^\//, '')
  const soubor = join(koren, 'app', '[rozsah]', 'marketing', segment, 'page.tsx')
  ok(`${p.nazev} vede na existující obrazovku`, existsSync(soubor), soubor)
}

console.log('\nBez marketing.manage')
const bezManage = sestavNavigaci('firma', bez('marketing.manage'), 0)
ok('Vytvořit obsah zmizí', !klice(bezManage.hlavni).includes('novy'))
ok('Tým, role a audit zmizí', !klice(bezManage.nastaveni).includes('audit'))
ma('lišta se doplní další položkou v pořadí', nazvy(bezManage.spodni), 'Přehled · Kalendář · Ke schválení · Mediální knihovna · Menu')
bezDuplicit('lišta bez duplicit', bezManage.spodni)

console.log('\nBez marketing.publish')
const bezPublish = sestavNavigaci('firma', bez('marketing.publish'), 0)
ma('Integrace a nástroje zmizí, zbytek zůstane', nazvy(bezPublish.nastaveni), 'Brand kit provozovny · Tým, role a audit')
ma('hlavní položky se nezmění', nazvy(bezPublish.hlavni), nazvy(plna.hlavni))

console.log('\nBez marketing.read')
const bezRead = sestavNavigaci('firma', bez('marketing.read'), 0)
ma(
  'Mediální knihovna, Menu a Analytika zmizí',
  nazvy(bezRead.hlavni),
  'Přehled · Vytvořit obsah · Šablony · Kalendář · Ke schválení · Kampaně a automatizace · Publikované',
)
ma('lišta se doplní Šablonami', nazvy(bezRead.spodni), 'Přehled · Vytvořit obsah · Kalendář · Ke schválení · Šablony')
bezDuplicit('lišta bez duplicit', bezRead.spodni)

console.log('\nŽádné z hlídaných práv')
const nic = sestavNavigaci('firma', () => false, 0)
ma('zůstanou jen položky bez práva', nazvy(nic.hlavni), 'Přehled · Šablony · Kalendář · Ke schválení · Kampaně a automatizace · Publikované')
ma('nastavení jen značka', nazvy(nic.nastaveni), 'Brand kit provozovny')
ma('lišta má pořád pět položek', nic.spodni.length, 5)
bezDuplicit('lišta bez duplicit', nic.spodni)

console.log('\nNula čekajících')
ma('počítadlo je nula', sestavNavigaci('firma', vse, 0).hlavni.find((p) => p.klic === 'schvalovani').cislo, 0)

console.log('\nAktivní položka')
const polozky = [...plna.hlavni, ...plna.nastaveni]
ma('rozcestník', aktivniKlic('/cerna-perla/marketing', polozky), 'prehled')
ma('kalendář', aktivniKlic('/cerna-perla/marketing/kalendar', polozky), 'kalendar')
ma('hlubší adresa pod médii', aktivniKlic('/cerna-perla/marketing/media/abc', polozky), 'media')
ma('audit v nastavení', aktivniKlic('/cerna-perla/marketing/audit', polozky), 'audit')
ma('detail příspěvku patří k přehledu', aktivniKlic('/cerna-perla/marketing/7f1c2a90-0000-4000-8000-000000000000', polozky), 'prehled')
ma('Tvorba menu mimo marketing nesedí', aktivniKlic('/cerna-perla/menu', polozky), null)
ma('podobná předpona nesedí', aktivniKlic('/cerna-perla/marketingovy', polozky), null)
ma('jiný rozsah nesedí', aktivniKlic('/bernard/marketing/kalendar', polozky), null)

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
