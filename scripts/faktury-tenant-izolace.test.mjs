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
 *   3. brána pustí jen firmu z nastavení FAKTURY_DB_TENANT_ID — bez něj
 *      nikoho; NIKDY podle IČO (to si správce firmy může přepsat sám),
 *   4. žádný dotaz na `invoices` nefiltruje neexistující `tenant_id`.
 *
 * Pusť:
 *   node scripts/faktury-tenant-izolace.test.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { jeVlastnikFakturyDb } from '../lib/faktury-vlastnik.ts'
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
  ok('brána se ptá na vlastníka přes jeVlastnikFakturyDb', /jeVlastnikFakturyDb\(/.test(brana))
  ok('klient vzniká jen v jednom místě rozhodnutí (rozhodnout)', (brana.match(/(?<!function )vytvoritKlienta\(\)/g) ?? []).length === 1)
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

console.log('\n4. Kdo je vlastník databáze Faktur — jen podle FAKTURY_DB_TENANT_ID, nikdy podle IČO')
{
  const vlastnik = '11111111-1111-1111-1111-111111111111'
  ok('firma z nastavení projde', jeVlastnikFakturyDb(vlastnik, vlastnik))
  ok('totéž id jinými velkými písmeny / s mezerami projde', jeVlastnikFakturyDb(vlastnik, `  ${vlastnik.toUpperCase()} `))
  ok('jiná firma neprojde', !jeVlastnikFakturyDb('22222222-2222-2222-2222-222222222222', vlastnik))
  ok('bez nastavení neprojde NIKDO (brána zavřená)', !jeVlastnikFakturyDb(vlastnik, undefined))
  ok('prázdné nastavení nepovolí nikoho', !jeVlastnikFakturyDb(vlastnik, '   '))
  ok('null nastavení nepovolí nikoho', !jeVlastnikFakturyDb(vlastnik, null))

  // IČO si správce firmy (settings.manage) může v tabulce tenants přepsat
  // sám a není unikátní — rozhodnutí o přístupu na něm stát nesmí.
  const rozhodnuti = [soubory.find((s) => s.cesta === 'lib/faktury-vlastnik.ts'), soubory.find((s) => s.cesta === BRANA)]
    .map((s) => (s?.zdroj ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
    .join('\n')
  ok('vlastnictví se nerozhoduje podle IČO ani tabulky tenants', !/\bico\b/i.test(rozhodnuti) && !/from\(\s*['"]tenants['"]\s*\)/.test(rozhodnuti))
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
