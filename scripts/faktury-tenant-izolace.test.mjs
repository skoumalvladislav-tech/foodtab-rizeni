#!/usr/bin/env node
/**
 * Strážní test nad ZDROJOVÝM TEXTEM modulu Faktury (ne nad běžící databází —
 * ta je v odděleném Supabase projektu bez CI přístupu, viz
 * `docs/hlaseni/faktury-tenant-izolace-2026-10-02.md`).
 *
 * Kontroluje, že každé volání `.from('invoices')` v modulu Faktury je
 * doprovázené buď `.eq('tenant_id', ...)` (čtení/update/delete), nebo
 * `tenant_id:` v objektu u `.insert(...)`. Bez databáze samotné je tohle
 * jediná automatizovaná kontrola, že se při příští úpravě nezapomene
 * izolace zákazníků — stejný vzor jako `marketing-ai.test.mjs` hlídá
 * pravidlo 8 regexem nad zdrojovým textem.
 *
 * Nehlídá RLS (fáze 2, dosud nenasazená) — jen aplikační filtr (fáze 1).
 *
 * Pusť:
 *   node --experimental-strip-types scripts/faktury-tenant-izolace.test.mjs
 */

import { readFileSync } from 'node:fs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const SOUBORY = [
  'app/[rozsah]/finance/faktury/page.tsx',
  'app/[rozsah]/finance/faktury/dodavatele/page.tsx',
  'app/[rozsah]/finance/faktury/kalendar/page.tsx',
  'app/[rozsah]/finance/faktury/prehledy/page.tsx',
  'app/[rozsah]/finance/faktury/upominky/page.tsx',
  'app/[rozsah]/finance/faktury/schvaleni/page.tsx',
  'app/[rozsah]/finance/faktury/seznam/page.tsx',
  'app/[rozsah]/finance/faktury/layout.tsx',
  'app/[rozsah]/finance/faktury/akce.ts',
  'app/api/faktury/export/route.ts',
  'app/[rozsah]/dnes/page.tsx',
]

console.log('\nKaždé .from(\'invoices\') má vedle sebe tenant_id (čtení/zápis přes .eq, insert přes pole objektu)')
for (const cesta of SOUBORY) {
  const zdroj = readFileSync(new URL(`../${cesta}`, import.meta.url), 'utf8')
  const pocetFrom = (zdroj.match(/\.from\(['"]invoices['"]\)/g) ?? []).length
  const pocetEq = (zdroj.match(/\.eq\(['"]tenant_id['"]/g) ?? []).length
  const pocetInsert = (zdroj.match(/tenant_id:\s*tenantId/g) ?? []).length
  ok(
    `${cesta} — ${pocetFrom} dotaz(ů) na invoices, ${pocetEq + pocetInsert} s tenant_id (${pocetEq} eq + ${pocetInsert} insert)`,
    pocetFrom > 0 && pocetEq + pocetInsert >= pocetFrom,
  )
}

console.log('\nFaktura.tenant_id existuje v typu (ne jen za běhu)')
{
  const zdroj = readFileSync(new URL('../lib/faktury-types.ts', import.meta.url), 'utf8')
  ok('typ Faktura má pole tenant_id: string', /tenant_id:\s*string/.test(zdroj))
}

console.log('\npripravit() v akce.ts vrací i tenantId, ne jen supabase klienta')
{
  const zdroj = readFileSync(new URL('../app/[rozsah]/finance/faktury/akce.ts', import.meta.url), 'utf8')
  ok('return { supabase, tenantId }', /return\s*\{\s*supabase:\s*getFakturySupabase\(\),\s*tenantId\s*\}/.test(zdroj))
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
