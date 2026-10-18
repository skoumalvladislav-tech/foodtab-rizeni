#!/usr/bin/env node
/**
 * Faktury v hlavní databázi → tvar pro obrazovky (lib/faktury-sloupce.ts).
 *
 * Obrazovky Faktur pracují se starými jmény polí (typ Faktura) a dotazy je
 * dostávají jako aliasy (`supplier:dodavatel`). Kdyby alias ukazoval na
 * sloupec, který v public.faktury není, PostgREST vrátí chybu a stránka ji
 * zahodí do prázdného seznamu — přesně tak 3.–8. 10. 2026 ukazovaly
 * Faktury prázdno. Proto se aliasy kontrolují proti TEXTU migrace.
 *
 * Pusť: node scripts/faktury-sloupce.test.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'

import { halereZFormulare, naFakturu, odkazNaPrilohu, SLOUPCE_FAKTURY } from '../lib/faktury-sloupce.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n1. Aliasy ukazují na skutečné sloupce public.faktury')
const migrace = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const tabulka = /create table public\.faktury \(([\s\S]*?)\n\);/.exec(migrace)?.[1] ?? ''
const sloupce = new Set([...tabulka.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]))
ok(`definice tabulky nalezena (${sloupce.size} sloupců)`, sloupce.size >= 25)
const casti = SLOUPCE_FAKTURY.split(',').map((c) => c.trim())
const cil = casti.map((c) => (c.includes(':') ? c.split(':')[1] : c))
const chybi = cil.filter((c) => !sloupce.has(c))
ok(`všech ${cil.length} sloupců existuje${chybi.length ? ' — CHYBÍ: ' + chybi.join(', ') : ''}`, chybi.length === 0)

const typy = readFileSync('lib/faktury-types.ts', 'utf8')
const typFaktura = /export type Faktura = \{([\s\S]*?)\n\}/.exec(typy)?.[1] ?? ''
const pole = [...typFaktura.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
const vracene = new Set(casti.map((c) => c.split(':')[0]))
const nevraci = pole.filter((p) => p !== 'amount' && !vracene.has(p))
ok(`každé pole typu Faktura (kromě amount) dotaz vrací${nevraci.length ? ' — CHYBÍ: ' + nevraci.join(', ') : ''}`, pole.length >= 20 && nevraci.length === 0)
ok('úryvek textu dokladu se do seznamů netahá (jen u odmítnutí)', !cil.includes('vytah_textu'))

console.log('\n2. Částka: haléře se počítají, koruny jen ukazují')
{
  const f = naFakturu({ id: 'x', castka_haleru: 121050 })
  ok('121050 haléřů → amount 1210.5', f.amount === 1210.5 && f.castka_haleru === 121050)
  ok('chybějící částka → 0, ne NaN', naFakturu({ id: 'x', castka_haleru: null }).amount === 0)
  ok('„1 234,50" → 123450', halereZFormulare('1 234,50') === 123450)
  ok('„1234.5" → 123450', halereZFormulare('1234.5') === 123450)
  ok('„0,07" → 7 (ne 7,000…1)', halereZFormulare('0,07') === 7)
  ok('tři desetinná místa → odmítnuto (nezaokrouhlí se potichu)', halereZFormulare('1,234') === null)
  ok('text → odmítnuto', halereZFormulare('abc') === null && halereZFormulare('') === null)
  ok('nad strop integer → odmítnuto', halereZFormulare('21474836.48') === null)
}

console.log('\n3. Odkaz na soubor faktury')
{
  const id = '0a000000-0000-4000-8000-000000000001'
  ok('vlastní kopie → přes appku (ověří právo)', odkazNaPrilohu({ id, priloha_cesta: 't/x.pdf', pdf_url: 'https://stara/x.pdf' }) === `/api/faktury/soubor/${id}`)
  ok('…a v CSV absolutně', odkazNaPrilohu({ id, priloha_cesta: 't/x.pdf', pdf_url: null }, 'https://app.cz') === `https://app.cz/api/faktury/soubor/${id}`)
  ok('bez kopie → původní odkaz', odkazNaPrilohu({ id, priloha_cesta: null, pdf_url: 'https://stara/x.pdf' }) === 'https://stara/x.pdf')
  ok('relativní odkaz příjmu → v CSV absolutní', odkazNaPrilohu({ id, priloha_cesta: null, pdf_url: '/api/faktury/priloha/abc' }, 'https://app.cz') === 'https://app.cz/api/faktury/priloha/abc')
  ok('nic → null', odkazNaPrilohu({ id, priloha_cesta: null, pdf_url: null }) === null)
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
