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
 *
 * ---------------------------------------------------------------------
 * A FUNKCE: `grant execute` NIC NEBERE
 *
 * Postgres dá EXECUTE roli PUBLIC každé nové funkci, v jakémkoli schématu,
 * a Supabase navíc ve schématu public jmenovitě i roli anon (výchozí
 * práva). `grant execute … to authenticated` k tomu jen přidává — zúžit
 * to jde jedině `revoke all … from public, anon`. Na tohle se zapomnělo
 * u `app.faktury_priloha_firma(text)` (20261008100000) a ukázal to až
 * dotaz po db push 9. 10. 2026; opraveno v 20261009100000.
 *
 * Pravidlo: ke KAŽDÉMU `grant execute on function <podpis>` musí existovat
 * `revoke … on function <týž podpis>`, který odebírá `public` a `anon`.
 * Anon se nežádá jen tam, kde mu grant právo dává schválně (kiosek —
 * hlídá ho scripts/kiosek.test.mjs). Revoke smí být i v dřívější migraci
 * (dodatečný grant pro service_role nemusí revoke opakovat), ale jen
 * když mezi ním a grantem funkci nikdo nezahodil — `drop` + nové `create`
 * vrací výchozí práva. Grant na funkci, kterou pozdější migrace zahodí,
 * se nekontroluje — ta funkce už není.
 *
 * Plošně přes celou historii, ne jen od 20261008100000: starých grantů
 * bez revoke je 17 (z 265, všechny ve schématu app) a jsou JMENOVITĚ ve
 * VYJIMKY_FUNKCI. Jen datová hranice by je schovala; takhle je dluh vidět
 * a výjimka, kterou pozdější migrace opraví, kontrolu shodí, dokud ji
 * někdo nesmaže.
 *
 * Co se NEHLÍDÁ: funkce bez jakéhokoli `grant execute` (PUBLIC si EXECUTE
 * nechá) a `drop` + nové `create` téže funkce bez nového grantu.
 *
 * Proč text a ne databáze: čistá databáze z run.sh výchozí práva Supabase
 * pro anon ve schématu public nemá. Pro jednu funkci to v opravdové
 * databázi ověřuje supabase/tests/krok92_scenar.sql — tahle kontrola
 * pokrývá každou příští funkci bez psaní scénáře.
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

/*
  SELECT je jinak než u zbytku modulu: anon o něj přijde úplně
  (stejně jako o všechno ostatní na 51 zbylých tabulkách — nález
  20260917020000, na první průchod se na tuhle jednu ručně psanou
  tabulku zapomnělo). authenticated ho MUSÍ mít dál — obrazovka
  Nastavení → Audit ho čte, politika audit_select hlídá řádky. Obě
  strany se hlídají zvlášť, ať kontrola pozná i to, kdyby někdo omylem
  vzal select i authenticated a Audit tím rozbil.
*/
console.log('\n== audit_log — SELECT: pryč jen anon, authenticated ho potřebuje ==\n')

ok('audit_log odebírá select roli anon', odebranoPravo('audit_log', 'select', 'anon'))
ok('a authenticated si select NEODEBÍRÁ (obrazovka Audit ho čte)',
  !odebranoPravo('audit_log', 'select', 'authenticated'))

/* =====================================================================
   FUNKCE — ke grant execute patří revoke od public a anon
   (proč: hlavička, oddíl „A FUNKCE")
   ===================================================================== */

/** Typy, které jdou napsat víc způsoby — v grantu a revoke musí vyjít stejně. */
const ALIASY_TYPU = {
  int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean',
  timestamptz: 'timestamp with time zone', timetz: 'time with time zone',
  varchar: 'character varying', char: 'character', float8: 'double precision',
  float4: 'real', decimal: 'numeric',
}

/** `app.f(uuid,  INT[])` → `app.f(uuid, integer[])`; bez schématu je to public. */
function podpis(jmeno, argumenty) {
  const j = jmeno.toLowerCase()
  const typy = argumenty
    .split(',')
    .map((a) => a.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^public\./, ''))
    .filter(Boolean)
    .map((t) => {
      const [, zaklad, pole] = t.match(/^(.*?)((?:\[\])*)$/)
      return (ALIASY_TYPU[zaklad] ?? zaklad) + pole
    })
  return `${j.includes('.') ? j : `public.${j}`}(${typy.join(', ')})`
}

/** `public, anon cascade` → ['public', 'anon'] */
const seznamRoli = (text) =>
  text.replace(/\s+(cascade|restrict)\s*$/i, '').split(',').map((r) => r.trim().toLowerCase())

const JEDNA_FUNKCE = String.raw`([\w.]+)\s*\(((?:[^()]|\([^()]*\))*)\)`
/** Celý příkaz; seznam funkcí (i víc najednou, viz 20260823120200_authz.sql) se rozebírá zvlášť. */
const RE_GRANT = /\bgrant\s+(?:execute|all(?:\s+privileges)?)\s+on\s+function\s+([^;]+?)\s+to\s+([^;]+);/gi
const RE_REVOKE = /\brevoke\s+(?:execute|all(?:\s+privileges)?)\s+on\s+function\s+([^;]+?)\s+from\s+([^;]+);/gi
const RE_DROP = /\bdrop\s+function\s+(?:if\s+exists\s+)?([^;]+?)(?:\s+(?:cascade|restrict))?\s*;/gi
/** Hrubé sčítání — každý grant na funkci, i takový, kterému RE_GRANT nerozumí. */
const RE_GRANT_HRUBE = /\bgrant\b[^;]*?\bon\s+function\b/gi

/**
 * `app.f(uuid), app.g(text)` → podpisy. Null, když v seznamu zbude něco,
 * co není funkce se závorkami (`drop function app.f;`) — takový příkaz by
 * se jinak tiše přeskočil.
 */
function funkceVSeznamu(seznam) {
  const re = new RegExp(JEDNA_FUNKCE, 'g')
  const podpisy = [...seznam.matchAll(re)].map((m) => podpis(m[1], m[2]))
  const zbytek = seznam.replace(re, '').replace(/[\s,]/g, '')
  return podpisy.length && !zbytek ? podpisy : null
}

/** Dřív v pořadí migrací (soubor, pak místo v souboru)? */
const drive = (a, b) => a.i < b.i || (a.i === b.i && a.pozice < b.pozice)

/**
 * Rozbor migrací (pole `{ jmeno, text }` v pořadí razítek). Vrací granty,
 * ty bez revoke (`nedostatky`, s tím, co chybí) a soubory, kde některý
 * grant nebo drop funkce nešel rozebrat — ten by se jinak tiše nekontroloval.
 */
function rozborFunkci(migrace) {
  const granty = []
  const revoky = []
  const dropy = []
  const nerozebrane = new Set()
  migrace.forEach(({ jmeno, text }, i) => {
    const kod = bezKomentaru(text)
    const prikazy = (re, co) => {
      for (const m of kod.matchAll(re)) {
        const podpisy = funkceVSeznamu(m[1])
        if (!podpisy) { nerozebrane.add(jmeno); continue }
        for (const p of podpisy) co(p, m)
      }
    }
    prikazy(RE_GRANT, (p, m) => granty.push({ jmeno, i, pozice: m.index, podpis: p, role: seznamRoli(m[2]) }))
    prikazy(RE_REVOKE, (p, m) => revoky.push({ i, pozice: m.index, podpis: p, role: seznamRoli(m[2]) }))
    prikazy(RE_DROP, (p, m) => dropy.push({ i, pozice: m.index, podpis: p }))
    if ([...kod.matchAll(RE_GRANT_HRUBE)].length !== [...kod.matchAll(RE_GRANT)].length) nerozebrane.add(jmeno)
  })

  const nedostatky = []
  for (const g of granty) {
    const dropySig = dropy.filter((d) => d.podpis === g.podpis)
    if (dropySig.some((d) => drive(g, d))) continue
    // Revoke platí, dokud mezi ním a grantem funkci nikdo nezahodil.
    const plati = revoky.filter((r) => r.podpis === g.podpis &&
      !dropySig.some((d) => drive(r, d) && drive(d, g)))
    const odebrano = new Set(plati.flatMap((r) => r.role))
    const chybi = []
    if (!odebrano.has('public')) chybi.push('public')
    if (!g.role.includes('anon') && !odebrano.has('anon')) chybi.push('anon')
    if (chybi.length) nedostatky.push({ ...g, chybi })
  }
  return { granty, nedostatky, nerozebrane: [...nerozebrane] }
}

/*
  Starší historie: granty bez revoke, které žádná pozdější migrace
  neopravila. Všechny jsou ve schématu app, na které anon nemá USAGE —
  přes API je nepřihlášený nezavolá, ale has_function_privilege('anon', …)
  u nich vrací true. Uklidit je má samostatná migrace (`revoke all …
  from public, anon` u každé); jakmile vznikne, kontrola „výjimka je
  pořád potřeba" spadne a řádky odsud se smažou.

  Šest funkcí z authz.sql je jádro oprávnění, které volají politiky RLS —
  u nich se při úklidu musí ověřit, že žádná politika `to public`
  nespoléhá na EXECUTE pro anon. Proto úklid samostatně, ne tady.

  Nová výjimka sem nepatří: smí být jen ze souborů před HRANICE_VYJIMEK.
*/
const HRANICE_VYJIMEK = '20261009100000'
const VYJIMKY_FUNKCI = [
  ['20260823120200_authz.sql', 'app.is_member(uuid)'],
  ['20260823120200_authz.sql', 'app.is_owner(uuid)'],
  ['20260823120200_authz.sql', 'app.visible_branch_ids(uuid)'],
  ['20260823120200_authz.sql', 'app.has_permission(uuid, text)'],
  ['20260823120200_authz.sql', 'app.has_access(uuid, text, uuid)'],
  ['20260823120200_authz.sql', 'app.can_read_scoped(uuid, text, uuid)'],
  ['20260823120300_tenant_setup.sql', 'app.create_invitation(uuid, uuid, text, text, text, uuid[], uuid, integer)'],
  ['20260823120300_tenant_setup.sql', 'app.accept_invitation(text)'],
  ['20260823130000_provoz.sql', 'app.business_date(uuid, timestamp with time zone)'],
  ['20260901160000_jmeno_ne_z_emailu.sql', 'app.create_tenant(text, text, text, text, character, text)'],
  ['20260902020000_cekajici_pozvanka.sql', 'app.accept_invitation(text)'],
  ['20260903030000_zadavani_smen.sql', 'app.delka_smeny_minut(time, time)'],
  ['20260903060000_sablony_smen.sql', 'app.sablona_poradi(uuid, uuid, uuid, uuid)'],
  ['20260906010000_doruceni_po_pichnuti.sql', 'app.doruci_se(uuid, uuid, boolean)'],
  ['20260909100000_zarazeni_jadro.sql', 'app.create_tenant(text, text, text, text, character, text)'],
  ['20261002100000_sklad_suroviny_zaklad.sql', 'app.ingredient_price_at(uuid, date)'],
  ['20261002100000_sklad_suroviny_zaklad.sql', 'app.recipe_cost_per_portion(uuid, date)'],
]
const jeVyjimka = (g) => VYJIMKY_FUNKCI.some(([s, p]) => s === g.jmeno && p === g.podpis)

console.log('\n== Funkce: kontrola kontroly (vymyšlené migrace) ==\n')

/*
  Každý řádek je jedno schválné rozbití, které tu zůstává natrvalo — kdyby
  někdo pravidlo změkčil, spadne to tady, ne až v ostré databázi.
*/
const zkus = (...texty) => rozborFunkci(texty.map((text, i) => ({ jmeno: `m${i}.sql`, text })))
const chybi = (r) => r.nedostatky.map((n) => n.chybi.join('+')).join(' | ')

ok('grant bez revoke → chybí public i anon',
  chybi(zkus('grant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('revoke jen od public → chybí anon',
  chybi(zkus('revoke all on function app.f(text) from public;\ngrant execute on function app.f(text) to authenticated;')) === 'anon')
ok('revoke jen od anon → chybí public',
  chybi(zkus('revoke all on function app.f(text) from anon;\ngrant execute on function app.f(text) to authenticated;')) === 'public')
ok('revoke od public, anon ve stejné migraci → v pořádku',
  chybi(zkus('revoke all on function app.f(text) from public, anon;\ngrant execute on function app.f(text) to authenticated;')) === '')
ok('revoke až v pozdější migraci → v pořádku (tak se opravuje 20261008100000)',
  chybi(zkus('grant execute on function app.f(text) to authenticated;', 'revoke all on function app.f(text) from public, anon;')) === '')
ok('revoke z dřívější migrace platí i pro pozdější grant (tak 20261004100000 přidává service_role)',
  chybi(zkus('revoke all on function app.f(text) from public, anon;', 'grant execute on function app.f(text) to service_role;')) === '')
ok('… ale ne, když funkci mezitím někdo zahodil a založil znovu',
  chybi(zkus('revoke all on function app.f(text) from public, anon;',
    'drop function app.f(text);\ncreate function app.f(text) returns int language sql as $$ select 1 $$;\ngrant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('… a to ani ve stejné migraci',
  chybi(zkus('revoke all on function app.f(text) from public, anon;\ndrop function if exists app.f(text) cascade;\ngrant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('revoke na jiný podpis se nepočítá',
  chybi(zkus('revoke all on function app.f(uuid) from public, anon;\ngrant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('revoke v komentáři se nepočítá',
  chybi(zkus('-- revoke all on function app.f(text) from public, anon;\ngrant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('int a integer je týž podpis',
  chybi(zkus('revoke all on function app.f(int, uuid[]) from public, anon;\ngrant execute on function app.f(integer, uuid[]) to authenticated;')) === '')
ok('grant pro anon (kiosek) žádá jen revoke od public',
  chybi(zkus('revoke all on function public.k(text) from public;\ngrant execute on function public.k(text) to anon, authenticated;')) === '')
ok('funkce zahozená pozdější migrací se nekontroluje',
  chybi(zkus('grant execute on function app.f(text) to authenticated;', 'drop function if exists app.f(text);')) === '')
ok('drop PŘED grantem ve stejné migraci nic neomlouvá',
  chybi(zkus('drop function if exists app.f(text);\ncreate function app.f(text) returns int language sql as $$ select 1 $$;\ngrant execute on function app.f(text) to authenticated;')) === 'public+anon')
ok('grant na dvě funkce v jednom příkazu kontroluje obě (vzor 20260823120200_authz.sql)',
  zkus('revoke all on function app.f(text) from public, anon;\ngrant execute on function app.f(text), app.g(text) to authenticated;')
    .nedostatky.map((n) => n.podpis).join() === 'app.g(text)')
ok('grant, kterému rozbor nerozumí, se nahlásí (nepřeskočí se tiše)',
  zkus('grant execute on function app.f to authenticated;').nerozebrane.length === 1)
ok('drop bez podpisu se nahlásí (jinak by starý revoke dál tiše platil)',
  zkus('drop function app.f;').nerozebrane.length === 1)

console.log('\n== Funkce: grant execute má revoke od public a anon ==\n')

const funkce = rozborFunkci(soubory.map((jmeno) => ({ jmeno, text: fs.readFileSync(path.join(SLOZKA, jmeno), 'utf8') })))

ok(`granty na funkce se vůbec našly (${funkce.granty.length})`, funkce.granty.length >= 200)
ok(`každý grant na funkci šel rozebrat${funkce.nerozebrane.length ? ` — ne v: ${funkce.nerozebrane.join(', ')}` : ''}`,
  funkce.nerozebrane.length === 0)
ok('kontrola míří i na app.faktury_priloha_firma(text) z 20261008100000',
  funkce.granty.some((g) => g.jmeno === '20261008100000_faktury_prijem_z_emailu.sql' &&
    g.podpis === 'app.faktury_priloha_firma(text)'))

const poruseni = funkce.nedostatky.filter((n) => !jeVyjimka(n))
for (const n of poruseni) {
  ok(`${n.jmeno}: ${n.podpis} — chybí revoke od ${n.chybi.join(', ')}`, false)
}
ok(`každý grant execute (mimo ${VYJIMKY_FUNKCI.length} výjimek) má revoke od public i anon`, poruseni.length === 0)

console.log('\n== Funkce: výjimky jsou jen stará historie a pořád potřeba ==\n')

for (const [s, p] of VYJIMKY_FUNKCI) {
  ok(`${s}: ${p} je starší než ${HRANICE_VYJIMEK}`, s < HRANICE_VYJIMEK)
  ok(`${s}: ${p} pořád revoke nemá (jinak výjimku smaž)`,
    funkce.nedostatky.some((n) => n.jmeno === s && n.podpis === p))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
