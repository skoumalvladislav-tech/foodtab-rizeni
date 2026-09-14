#!/usr/bin/env node
/**
 * Granty nových tabulek marketingu — čte se supabase/migrations/*.sql.
 *
 * Pusť `node scripts/marketing-granty.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE NEJDE OVĚŘIT V DATABÁZI
 *
 * Protože to, co se má hlídat, v testovací databázi NENÍ. Supabase má
 * v projektu výchozí práva (`alter default privileges in schema public
 * grant all on tables to anon, authenticated, service_role`), takže
 * každý `create table` v `public` udělí plná práva oběma rolím —
 * ať si migrace přeje cokoli. Čistá databáze, kterou staví
 * `supabase/tests/run.sh`, ta výchozí práva nemá.
 *
 * Kontrola „na tu tabulku nemá anon grant" by tedy lokálně prošla
 * vždycky a v ostré databázi by spadla. Je to tatáž třída rozdílu jako
 * `\gset` nad NULL v PGlite: prostředí, ve kterém se testuje, není to,
 * ve kterém to běží. A kontrola, která nemůže spadnout, je horší než
 * žádná — žádná je vidět, tahle se tváří jako důkaz.
 *
 * Hlídá se proto TEXT MIGRACE, ne stav databáze: každá migrace, která
 * zakládá tabulku `marketing_*`, musí k ní mít `revoke` od `anon`.
 * Tohle spadnout umí a spadne HNED, ne až po nasazení.
 *
 * ---------------------------------------------------------------------
 * CO SE STALO
 *
 * Dvakrát. 13. 9. 2026 `marketing_tajemstvi` se zašifrovanými klíči
 * k Instagramu (opraveno v `20260913180000_marketing_granty_uklid.sql`)
 * a 14. 9. 2026 znovu, u čtyř tabulek najednou: `marketing_kampane`,
 * `marketing_automatizace`, `marketing_automatizace_behy`
 * a `marketing_metriky` (opraveno v `…190000_marketing_granty_uklid2`).
 *
 * Napodruhé to pravidlo bylo NAPSANÉ — stálo v hlavičce té první
 * úklidové migrace — a stejně se na ně u třech ze čtyř tabulek
 * zapomnělo. Proto je tady kontrola a proto hledá VŠECHNY tabulky
 * modulu najednou, ne jmenovitý seznam. Jmenovitý seznam by u příští
 * tabulky selhal přesně tak jako člověk.
 *
 * ---------------------------------------------------------------------
 * A JEŠTĚ TRUNCATE
 *
 * `truncate` se RLS NEŘÍDÍ. Přihlášený s tím grantem vysype celou
 * tabulku napříč firmami a žádná politika ho nezastaví — na rozdíl od
 * `delete`, které přes politiku projít musí. Výchozí práva ho udělují
 * taky, takže se taky musí odebrat.
 */

import fs from 'node:fs'
import path from 'node:path'

const SLOZKA = path.join(import.meta.dirname, '..', 'supabase', 'migrations')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Soubory migrací v pořadí razítek. */
const soubory = fs.readdirSync(SLOZKA).filter((s) => s.endsWith('.sql')).sort()

/** Celý modul jako jeden text — `revoke` smí přijít i pozdější migrací. */
const vse = soubory.map((s) => fs.readFileSync(path.join(SLOZKA, s), 'utf8')).join('\n')

/**
 * Komentáře pryč, jinak by se pravidlo trefilo do vlastního vysvětlení.
 * Přesně tahle chyba už jednou nechala projít zákaz, který hlídal sám
 * sebe (CLAUDE.md, „Každá nová kontrola musí umět spadnout").
 */
function bezKomentaru(text) {
  return text
    .split('\n')
    .map((r) => {
      const i = r.indexOf('--')
      return i === -1 ? r : r.slice(0, i)
    })
    .join('\n')
    .split(/\/\*[\s\S]*?\*\//)
    .join(' ')
}

const kod = bezKomentaru(vse)

/** Tabulky marketingu, které se v migracích zakládají. */
const zalozene = [...kod.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(marketing_\w+)/gi)]
  .map((m) => m[1])

/** A ty, které se zase zahazují — na ty se ptát nemá smysl. */
const zahozene = new Set(
  [...kod.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?public\.(marketing_\w+)/gi)].map((m) => m[1]),
)

const tabulky = [...new Set(zalozene)].filter((t) => !zahozene.has(t)).sort()

/** Má tabulka někde `revoke …` od té role? */
function odebrano(tabulka, role) {
  const re = new RegExp(
    `revoke\\s+[\\s\\S]*?\\son\\s+(?:table\\s+)?public\\.${tabulka}\\s+from\\s+([\\w\\s,]+)`,
    'gi',
  )
  for (const m of kod.matchAll(re)) {
    if (m[1].split(',').some((r) => r.trim().toLowerCase() === role)) return true
  }
  return false
}

/** Odebírá se právě tohle právo (nebo `all`)? */
function odebranoPravo(tabulka, pravo) {
  const re = new RegExp(
    `revoke\\s+([\\s\\S]*?)\\son\\s+(?:table\\s+)?public\\.${tabulka}\\s+from\\s+([\\w\\s,]+)`,
    'gi',
  )
  for (const m of kod.matchAll(re)) {
    const prava = m[1].toLowerCase()
    const role = m[2].split(',').map((r) => r.trim().toLowerCase())
    if (!role.includes('authenticated')) continue
    if (prava.includes('all') || prava.includes(pravo)) return true
  }
  return false
}

console.log(`\n== Tabulky modulu (${tabulky.length}) ==\n`)
console.log(`  ${tabulky.join(', ')}\n`)

ok('nějaké tabulky se vůbec našly', tabulky.length >= 10)

console.log('\n== Nepřihlášený (anon) na ně nesmí ==\n')

for (const t of tabulky) {
  ok(`${t} odebírá grant roli anon`, odebrano(t, 'anon'))
}

console.log('\n== TRUNCATE obchází RLS, a proto jde pryč ==\n')

for (const t of tabulky) {
  ok(`${t} odebírá truncate roli authenticated`, odebranoPravo(t, 'truncate'))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
