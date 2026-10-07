#!/usr/bin/env node
/**
 * Izolace firem u databáze Faktur (`ctqtwahlzhyjerqulqyn`).
 *
 * Do 7.10.2026 tenhle test hlídal, že každý dotaz filtruje `tenant_id`.
 * Jenže ten sloupec v živé databázi NEEXISTUJE (SQL z
 * docs/hlaseni/faktury-tenant-izolace-2026-10-02.md nikdy neproběhlo) —
 * test tak hlídal přesně tu věc, kvůli které modul ukazoval prázdno.
 *
 * Nová záruka (lib/supabase/faktury.ts, lib/faktury-vlastnik.ts):
 *   1. klient k databázi Faktur vzniká JEN v lib/supabase/faktury.ts,
 *   2. každý soubor, který sahá na `invoices`, jde přes `pristupKFakturam`
 *      (nebo dostane hotového klienta jako `FakturyKlient` od toho, kdo
 *      bránou prošel),
 *   3. brána pustí jen firmu, které databáze patří (IČO 21249946, nebo
 *      výslovné FAKTURY_DB_TENANT_ID),
 *   4. žádný dotaz na `invoices` nefiltruje neexistující `tenant_id`.
 *
 * Pusť:
 *   node scripts/faktury-tenant-izolace.test.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FAKTURY_DB_ICO_VLASTNIKA, jeVlastnikFakturyDb, normalizovatIco } from '../lib/faktury-vlastnik.ts'
import { FILTR_KE_KONTROLE, potrebujeKontrolu } from '../lib/faktury-types.ts'

const KOREN = fileURLToPath(new URL('..', import.meta.url))

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function zdrojoveSoubory(adresar) {
  const vysledek = []
  for (const jmeno of readdirSync(adresar)) {
    const cesta = join(adresar, jmeno)
    if (statSync(cesta).isDirectory()) {
      if (jmeno === 'node_modules' || jmeno.startsWith('.')) continue
      vysledek.push(...zdrojoveSoubory(cesta))
    } else if (/\.(ts|tsx)$/.test(jmeno)) {
      vysledek.push(cesta)
    }
  }
  return vysledek
}

const soubory = [...zdrojoveSoubory(join(KOREN, 'app')), ...zdrojoveSoubory(join(KOREN, 'lib'))]
  .map((cesta) => ({ cesta: relative(KOREN, cesta).split(sep).join('/'), zdroj: readFileSync(cesta, 'utf8') }))

const BRANA = 'lib/supabase/faktury.ts'

console.log('\n1. Klient k databázi Faktur vzniká jen v ' + BRANA)
{
  const mimoBranu = soubory.filter((s) => s.cesta !== BRANA && /process\.env\.FAKTURY_SUPABASE_(URL|ANON_KEY)|process\.env\[['"]FAKTURY_SUPABASE_/.test(s.zdroj))
  ok(`nikdo jiný nečte FAKTURY_SUPABASE_* (${mimoBranu.map((s) => s.cesta).join(', ') || 'nikdo'})`, mimoBranu.length === 0)
  const stary = soubory.filter((s) => /getFakturySupabase/.test(s.zdroj))
  ok(`nechráněný getFakturySupabase() neexistuje (${stary.map((s) => s.cesta).join(', ') || 'nikde'})`, stary.length === 0)
  const brana = soubory.find((s) => s.cesta === BRANA)?.zdroj ?? ''
  ok('vytvoritKlienta() není exportovaná', /\nfunction vytvoritKlienta\(/.test(brana) && !/export\s+function\s+vytvoritKlienta/.test(brana))
  ok('brána se ptá na vlastníka přes jeVlastnikFakturyDb', (brana.match(/jeVlastnikFakturyDb\(/g) ?? []).length >= 2)
}

console.log('\n2. Každý, kdo sahá na invoices, jde přes bránu')
const naFaktury = soubory.filter((s) => /\.from\(\s*['"]invoices['"]\s*\)/.test(s.zdroj))
ok(`dotazy na invoices jsou aspoň v 10 souborech (našel jsem ${naFaktury.length})`, naFaktury.length >= 10)
for (const s of naFaktury) {
  ok(`${s.cesta}`, /pristupKFakturam(Ulohy)?\(/.test(s.zdroj) || /FakturyKlient/.test(s.zdroj))
}

console.log('\n3. Žádný dotaz na invoices nefiltruje neexistující tenant_id')
for (const s of naFaktury) {
  const retezy = s.zdroj.match(/\.from\(\s*['"]invoices['"]\s*\)[\s\S]*?(?=;|\n\s*\n|\.from\()/g) ?? []
  const spatne = retezy.filter((r) => /tenant_id/.test(r))
  ok(`${s.cesta} (${retezy.length} dotazů)`, spatne.length === 0)
}

console.log('\n4. Kdo je vlastník databáze Faktur')
{
  const foodtab = { id: 'aaaa', ico: FAKTURY_DB_ICO_VLASTNIKA }
  ok('firma s IČO vlastníka projde', jeVlastnikFakturyDb(foodtab))
  ok('IČO s mezerami projde', jeVlastnikFakturyDb({ id: 'aaaa', ico: '212 49 946' }))
  ok('DIČ s předponou CZ projde', jeVlastnikFakturyDb({ id: 'aaaa', ico: 'CZ21249946' }))
  ok('jiná firma neprojde', !jeVlastnikFakturyDb({ id: 'bbbb', ico: '12345678' }))
  ok('firma bez IČO neprojde', !jeVlastnikFakturyDb({ id: 'bbbb', ico: null }))
  ok('prázdné IČO neprojde', !jeVlastnikFakturyDb({ id: 'bbbb', ico: '' }))
  ok('výslovné FAKTURY_DB_TENANT_ID pustí firmu bez IČO', jeVlastnikFakturyDb({ id: 'cccc', ico: null }, 'cccc'))
  ok('výslovné FAKTURY_DB_TENANT_ID má přednost i před správným IČO', !jeVlastnikFakturyDb(foodtab, 'cccc'))
  ok('prázdné FAKTURY_DB_TENANT_ID nic nepovolí navíc', !jeVlastnikFakturyDb({ id: 'bbbb', ico: null }, '   '))
  ok('normalizace IČO', normalizovatIco(' cz 2124 9946 ') === '21249946')
}

console.log('\n5. Co potřebuje ruční kontrolu (needs_review je v živé DB vždy false)')
{
  ok('stav „Nutná ruční kontrola (…)" se počítá', potrebujeKontrolu({ needs_review: false, status: 'Nutná ruční kontrola (faktura jako obrázek – vyplňte údaje ručně)' }))
  ok('needs_review = true se počítá', potrebujeKontrolu({ needs_review: true, status: 'Ke kontrole úhrady' }))
  ok('běžná faktura se nepočítá', !potrebujeKontrolu({ needs_review: false, status: 'Ke kontrole úhrady' }))
  ok('filtr do databáze hlídá oba příznaky', /needs_review\.is\.true/.test(FILTR_KE_KONTROLE) && /status\.like\."Nutná ruční kontrola%"/.test(FILTR_KE_KONTROLE))
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
