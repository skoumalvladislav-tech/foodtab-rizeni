#!/usr/bin/env node
/**
 * Jádro bankovní vrstvy nezná banky jménem (Finance Fáze 0, krok 1,
 * rozhodnutí 4 a 5).
 *
 * Pusť `node scripts/banka-jadro-bez-jmen.test.mjs`.
 *
 * Jméno banky smí být jen v jejím konektoru (lib/banka/konektory.ts
 * a soubory, které obaluje). Párování, Jiné platby, import výpisu,
 * úloha synchronizace, dlaždice a hlášky Integrací berou banky
 * z registru. Kdyby se do jádra vrátilo jméno („jen tady jedna
 * výjimka pro Fio"), každá další banka by zase znamenala zásah do míst,
 * která s bankou nemají nic společného — a přesně tohle má tahle
 * kontrola shodit.
 *
 * Jména se berou dvojím způsobem, ať nová banka nevyklouzne:
 *   1. z registru: `poskytovatel` a `nazev` každého konektoru
 *      v lib/banka/konektory.ts (kromě importu výpisu);
 *   2. pevný seznam bank a agregátorů na českém trhu.
 * Hledá se v celém souboru, i v komentářích a cestách importů.
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Soubory jádra — neutrální vrstva a místa, která dřív znala banky jménem. */
const JADRO = [
  'lib/banka/konektor.ts',
  'lib/banka/ucet.ts',
  'lib/banka/zapis.ts',
  'lib/banka/import-vypisu.ts',
  'lib/banka/tajemstvi.ts',
  'lib/banka/tajemstvi-cteni.ts',
  'lib/banka-synchronizace.ts',
  'lib/finance-csv-import.ts',
  'lib/finance-parovani.ts',
  'lib/finance-automaticke-parovani.ts',
  'lib/jine-platby-typy.ts',
  'app/api/uloha/banka-synchronizace/route.ts',
  'app/[rozsah]/finance/integrace/page.tsx',
  'app/[rozsah]/finance/integrace/akce.ts',
  'app/[rozsah]/finance/platby/import/akce.ts',
  'app/[rozsah]/finance/platby/import/akce-nahled.ts',
]

const PEVNE = [
  'Fio', 'Komerční banka', 'KB', 'ADAA', 'Salt Edge', 'Enable Banking', 'Česká spořitelna', 'Spořitelna',
  'ČSOB', 'CSOB', 'Raiffeisen', 'Raiffeisenbank', 'Moneta', 'Air Bank', 'UniCredit', 'mBank', 'Creditas', 'Revolut',
  'Equa', 'Oberbank', 'GoCardless', 'Nordigen', 'Plaid', 'Tink', 'TrueLayer', 'Finbricks',
]

const konektory = readFileSync(path.join(ROOT, 'lib/banka/konektory.ts'), 'utf8')
const zRegistru = []
for (const m of konektory.matchAll(/(poskytovatel|nazev):\s*'([^']+)'/g)) zRegistru.push(m[2])
const zImportu = readFileSync(path.join(ROOT, 'lib/banka/import-vypisu.ts'), 'utf8')
const vlastniImport = [...zImportu.matchAll(/(poskytovatel|nazev):\s*'([^']+)'/g)].map((m) => m[2])
const jmena = [...new Set([...PEVNE, ...zRegistru.filter((j) => !vlastniImport.includes(j))])]

/** Bez diakritiky — „Komercni" i „Komerční" je totéž jméno. */
const bezDiakritiky = (text) => text.normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Slovo jména → kus regulárního výrazu. Krátká slova (Fio, KB, ADAA)
 * přesně; delší snesou českou koncovku („Komerční bankou", „Spořitelně"):
 * bez koncové samohlásky a s nejvýš dvěma písmeny navíc. Víc ne —
 * „Monetary" není Moneta.
 */
function slovo(s) {
  const t = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (s.length < 5) return t
  return `${/[aeiouy]$/i.test(s) ? t.slice(0, -1) : t}\\p{L}{0,2}`
}

/** `kb_adaa` → i kb, adaa zvlášť. Mezera/podtržítko/pomlčka jsou zaměnitelné. */
function vzory(jmeno) {
  const ciste = bezDiakritiky(jmeno)
  const casti = /[_-]/.test(ciste) && !/\s/.test(ciste) ? ciste.split(/[_-]/).filter((c) => c.length >= 2) : []
  return [ciste, ...casti].map((j) => {
    const telo = j.trim().split(/[\s_-]+/).map(slovo).join('[\\s_-]*')
    // Hranice slova i pro češtinu: před a za jménem není písmeno ani číslice
    // (podtržítko hranicí je — `fio_api` se najde).
    return new RegExp(`(?<![\\p{L}\\p{N}])${telo}(?![\\p{L}\\p{N}])`, 'iu')
  })
}
const VZORY = jmena.flatMap((j) => vzory(j).map((re) => ({ jmeno: j, re })))

function najdiJmena(text) {
  const nalezy = []
  const radky = bezDiakritiky(text).split(/\r?\n/)
  radky.forEach((radek, i) => {
    for (const { jmeno, re } of VZORY) if (re.test(radek)) nalezy.push(`${i + 1}: ${jmeno}`)
  })
  return nalezy
}

console.log('\n== Seznam jmen ==')
ok('registr dal jména konektorů (aspoň 4 banky, poskytovatel i název)', zRegistru.filter((j) => !vlastniImport.includes(j)).length >= 8)
ok('import výpisu se za jméno banky nepočítá', !jmena.includes('import_vypisu') && !jmena.includes('import výpisu (CSV)'))

console.log('\n== Kontrola sama pozná jméno (jinak by mlčela vždycky) ==')
const MUSI_NAJIT = [
  "if (p.poskytovatel === 'fio') return",
  "zdroj in ('fio_api')",
  'import { x } from "@/lib/kb-adaa-sync"',
  '// jen pro Komerční banku',
  'Komercni banka',
  'saltedge',
  'Salt-Edge',
  'enablebanking',
  'ČSOB',
  'kb_adaa',
  'u České spořitelně',
  'Raiffeisenbank',
]
for (const t of MUSI_NAJIT) ok(`najde: ${t}`, najdiJmena(t).length > 0)
// Slova, která jméno banky obsahují jen jako kus jiného slova.
const NESMI_NAJIT = ['portfolio', 'bankovní účet', 'import výpisu (CSV)', 'banka_api', 'kbelík', 'Monetary', 'kód banky', 'Tinkture']
for (const t of NESMI_NAJIT) ok(`nenajde: ${t}`, najdiJmena(t).length === 0)

console.log('\n== Soubory jádra bez jmen bank ==')
for (const soubor of JADRO) {
  const cesta = path.join(ROOT, soubor)
  if (!existsSync(cesta)) { ok(`${soubor} existuje (přejmenovaný soubor jádra nesmí z kontroly tiše vypadnout)`, false); continue }
  const nalezy = najdiJmena(readFileSync(cesta, 'utf8'))
  ok(`${soubor} — bez jména banky${nalezy.length ? ` (řádek ${nalezy.join('; ')})` : ''}`, nalezy.length === 0)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
