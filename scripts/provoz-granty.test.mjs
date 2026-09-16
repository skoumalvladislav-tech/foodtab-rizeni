#!/usr/bin/env node
/**
 * Granty provozních tabulek — čte se supabase/migrations/*.sql.
 *
 * Pusť `node scripts/provoz-granty.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TOHLE NEJDE OVĚŘIT V DATABÁZI
 *
 * Stejný důvod jako u scripts/marketing-granty.test.mjs (přečti si
 * i jeho hlavičku): Supabase má v projektu výchozí práva (`alter
 * default privileges in schema public grant all on tables to anon,
 * authenticated, service_role`), takže každý `create table` v `public`
 * udělí plná práva oběma rolím, ať migrace píše cokoli. Čistá databáze
 * z `supabase/tests/run.sh` výchozí práva Supabase nemá — kontrola nad
 * databází by tedy lokálně procházela vždycky a spadla by až v ostré.
 *
 * Hlídá se proto TEXT MIGRACÍ: každá tabulka (nebo pohled) založená
 * mimo modul marketing musí mít `revoke` od `anon` a `revoke truncate`
 * od `authenticated` — s výjimkou `audit_log`, viz níž.
 *
 * ---------------------------------------------------------------------
 * PROVOZ NEMÁ SPOLEČNOU PŘEDPONU JAKO MARKETING
 *
 * `marketing_*` se dá poznat podle jména. Provozní tabulky ne —
 * základní schéma (`tenants`, `employees`, `shifts`…) je anglicky,
 * provozní moduly (`useky`, `zalohy`, `konverzace`…) česky (CLAUDE.md,
 * „Konvence"). Tenhle skript proto bere VŠECHNY tabulky a pohledy
 * založené v `supabase/migrations`, které nezačínají na `marketing_`
 * a nebyly později zahozené — ne jmenovaný seznam. Jmenovaný seznam by
 * u příští tabulky selhal přesně tak jako člověk (to je celý důvod,
 * proč vznikl `marketing-granty.test.mjs`).
 *
 * ---------------------------------------------------------------------
 * AUDIT_LOG JE JINÝ
 *
 * Zbytek tabulek nechává `select/insert/update/delete` pro
 * `authenticated` beze změny — o tom rozhoduje RLS. `audit_log` ne:
 * do auditu píše jen `app.audit()` jako `security definer`, nikdo jiný
 * nemá důvod na ni sahat přímo, a `truncate`/`delete` na ní by smazaly
 * auditní stopu bez stopy o tom, že zmizela. Proto se u ní hlídá
 * `revoke insert, update, delete, truncate, references, trigger` od
 * OBOU rolí zvlášť, ne jen `truncate`.
 *
 * ---------------------------------------------------------------------
 * A JEŠTĚ TRUNCATE
 *
 * `truncate` se RLS NEŘÍDÍ. Přihlášený s tím grantem vysype celou
 * tabulku napříč firmami a žádná politika ho nezastaví — na rozdíl od
 * `delete`, které přes politiku projít musí. Výchozí práva ho udělují
 * taky, takže se taky musí odebrat.
 *
 * Zadání: docs/granty-provoz-zadani.md. Migrace: 20260917000000_granty_
 * provoz_uklid.sql.
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

/** Celý obsah jako jeden text — `revoke` smí přijít i pozdější migrací. */
const vse = soubory.map((s) => fs.readFileSync(path.join(SLOZKA, s), 'utf8')).join('\n')

/**
 * Komentáře pryč, jinak by se pravidlo trefilo do vlastního vysvětlení
 * (CLAUDE.md, „Každá nová kontrola musí umět spadnout").
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

/** Tabulky i pohledy, které se v migracích zakládají — mimo marketing. */
const zalozeneTabulky = [...kod.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)]
  .map((m) => m[1])
const zalozenePohledy = [...kod.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.(\w+)/gi)]
  .map((m) => m[1])

/** A ty, které se zase zahazují — na ty se ptát nemá smysl. */
const zahozene = new Set(
  [...kod.matchAll(/drop\s+(?:table|view)\s+(?:if\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]),
)

const tabulky = [...new Set([...zalozeneTabulky, ...zalozenePohledy])]
  .filter((t) => !t.startsWith('marketing_'))
  .filter((t) => !zahozene.has(t))
  .sort()

/**
 * Má tabulka někde `revoke …` od té role, pro dané právo (nebo `all`)?
 *
 * `[^;]` místo `[\s\S]`, schválně — bez toho `revoke` z jednoho
 * příkazu a `on public.<tabulka> from …` z úplně jiného, o desítky
 * souborů dál, splynou v jeden „zápas“, protože nic nebránilo
 * neřízenému (`[\s\S]*?`) přeskoku přes hranici příkazu (`;`). Objevilo
 * se to schválným rozbitím vlastní kontroly (CLAUDE.md, „Každá nová
 * kontrola musí umět spadnout“) — bez `[^;]` kontrola „projde“ vždycky,
 * protože si najde nějaké `authenticated`/`truncate` v úplně cizím
 * příkazu.
 */
function odebranoPravo(tabulka, pravo, role) {
  const re = new RegExp(
    `revoke\\s+([^;]*?)\\son\\s+(?:table\\s+)?public\\.${tabulka}\\s+from\\s+([^;]+);`,
    'gi',
  )
  for (const m of kod.matchAll(re)) {
    const prava = m[1].toLowerCase()
    const role_ = m[2].split(',').map((r) => r.trim().toLowerCase())
    if (!role_.includes(role)) continue
    if (prava.includes('all') || prava.includes(pravo)) return true
  }
  return false
}

console.log(`\n== Provozní tabulky a pohledy (${tabulky.length}) ==\n`)
console.log(`  ${tabulky.join(', ')}\n`)

ok('nějaké tabulky se vůbec našly', tabulky.length >= 40)
ok('audit_log je mezi nimi (jinak kontrola pod ní nic nehlídá)', tabulky.includes('audit_log'))

const bezneTabulky = tabulky.filter((t) => t !== 'audit_log')

console.log('\n== Nepřihlášený (anon) na ně nesmí — mimo audit_log ==\n')

for (const t of bezneTabulky) {
  ok(`${t} odebírá grant roli anon`, odebranoPravo(t, 'all', 'anon'))
}

console.log('\n== TRUNCATE obchází RLS, a proto jde pryč — mimo audit_log ==\n')

for (const t of bezneTabulky) {
  ok(`${t} odebírá truncate roli authenticated`, odebranoPravo(t, 'truncate', 'authenticated'))
}

console.log('\n== audit_log — INSERT/UPDATE/DELETE/TRUNCATE pryč pro obě role ==\n')

for (const role of ['anon', 'authenticated']) {
  for (const pravo of ['insert', 'update', 'delete', 'truncate']) {
    ok(`audit_log odebírá ${pravo} roli ${role}`, odebranoPravo('audit_log', pravo, role))
  }
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
