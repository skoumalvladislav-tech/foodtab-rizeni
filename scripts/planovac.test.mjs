#!/usr/bin/env node
/**
 * Plánovač úloh — tajemství, zámek proti dvojímu spuštění a shoda
 * jmen a plánů mezi migrací, adresami a GitHub workflow.
 *
 * Pusť `node scripts/planovac.test.mjs`.
 *
 * Migrace 20261014120000_planovac_pg_cron.sql, návod
 * docs/planovac-pg-cron.md. Databázovou půlku (Vault, pg_net, pg_cron,
 * `uloha_zabrat`) hlídá scénář krok96.
 *
 * ---------------------------------------------------------------------
 * SPOUŠTÍ SE SKUTEČNÝ `route.ts` KAŽDÉ ÚLOHY
 *
 * Adresy se najdou v `app/api/uloha/*` samy — nová úloha je v kontrole
 * bez úprav tohohle souboru. Skutečný je i `lib/supabase/uloha.ts`
 * (`tajemstviSedi`, `uzBezi`). Podstrčené je jen to POD nimi:
 *   * `@supabase/supabase-js` — klient, který zapisuje, co se po něm
 *     chtělo, a na `uloha_zabrat` odpoví, co kontrola řekne;
 *   * všechno ostatní z `@/…` — „kanárek": jakékoli sáhnutí na něj se
 *     zapíše a vyhodí výjimku.
 *
 * Neplatné tajemství tedy projde jen tehdy, když adresa vrátí 401
 * a NIC se nezapsalo — ani klient, ani zámek, ani kanárek. Kontrolní
 * běh se správným tajemstvím ukazuje, že by se zapsalo: bez něj by
 * 401 mohla být jen rozbitá podstrčená databáze.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'

import { adresaModulu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')
const PRAZDNY = js('')

/* --- svět, do kterého se zapisuje -------------------------------------- */

const svet = (globalThis.__svet = { log: [], zamek: { data: true, error: null } })

globalThis.__kanarek = (jmeno) =>
  new Proxy(function () {}, {
    get(_, k) {
      svet.log.push(`kanarek:${jmeno}.${String(k)}`)
      throw new Error(`kanárek ${jmeno}`)
    },
    apply() {
      svet.log.push(`kanarek:${jmeno}()`)
      throw new Error(`kanárek ${jmeno}`)
    },
    construct() {
      svet.log.push(`kanarek:new ${jmeno}`)
      throw new Error(`kanárek ${jmeno}`)
    },
  })

const NEXT = js(`
export class NextResponse extends Response {
  static json(telo, init) {
    return new Response(JSON.stringify(telo), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
}`)

const SUPABASE = js(`
const chyba = { code: 'TEST', message: 'podstrčená databáze' }
function retez(svet, popis) {
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return (hotovo) => hotovo({ data: null, error: chyba })
      return (...a) => { svet.log.push(popis + '.' + String(k)); return retez(svet, popis + '.' + String(k)) }
    },
  })
}
export function createClient() {
  const svet = globalThis.__svet
  svet.log.push('createClient')
  return {
    rpc: async (jmeno, args) => {
      svet.log.push('rpc:' + jmeno + ':' + JSON.stringify(args ?? {}))
      if (jmeno === 'uloha_zabrat') return svet.zamek
      return { data: null, error: chyba }
    },
    from: (t) => { svet.log.push('from:' + t); return retez(svet, 'from:' + t) },
    storage: retez(svet, 'storage'),
  }
}`)

const DOTAZ = adresaModulu('lib/supabase/dotaz.ts', [['server-only', PRAZDNY]])
const ULOHA = adresaModulu('lib/supabase/uloha.ts', [
  ['server-only', PRAZDNY],
  ['@supabase/supabase-js', SUPABASE],
  ['next/server', NEXT],
  ['@/lib/supabase/dotaz', DOTAZ],
])

/** Hodnotové importy z `@/…` (kromě uloha.ts) → kanárci se stejnými jmény. */
function kanarci(zdroj) {
  const nahrady = []
  for (const m of zdroj.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(@\/[^']+)'/gm)) {
    if (m[1] || m[3] === '@/lib/supabase/uloha') continue
    const jmena = m[2]
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith('type '))
      .map((x) => x.split(/\s+as\s+/).pop())
    nahrady.push([m[3], js(jmena.map((j) => `export const ${j} = globalThis.__kanarek(${JSON.stringify(m[3] + '#' + j)})`).join('\n'))])
  }
  return nahrady
}

/* --- adresy ------------------------------------------------------------ */

const ULOHY = readdirSync('app/api/uloha')
  .filter((d) => existsSync(`app/api/uloha/${d}/route.ts`))
  .sort()

const SPRAVNE = 'spravne-tajemstvi-0123456789abcdef'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'klic-sluzby-test'

async function zavolat(GET, hlavicka, zamek = { data: true, error: null }) {
  svet.log = []
  svet.zamek = zamek
  const pozadavek = new Request('https://foodtab.test/api/uloha/x', {
    headers: hlavicka === undefined ? {} : { authorization: hlavicka },
  })
  const puvodniChyba = console.error
  const puvodniVarovani = console.warn
  console.error = console.warn = () => {}
  try {
    const odpoved = await GET(pozadavek)
    return { stav: odpoved.status, telo: await odpoved.text(), log: svet.log }
  } catch (e) {
    return { stav: 'výjimka', telo: String(e?.message ?? e), log: svet.log }
  } finally {
    console.error = puvodniChyba
    console.warn = puvodniVarovani
  }
}

const SPATNE = [
  ['bez hlavičky', undefined],
  ['špatné tajemství stejné délky', 'Bearer ' + SPRAVNE.replace(/.$/, 'X')],
  ['začátek správného tajemství', 'Bearer ' + SPRAVNE.slice(0, -1)],
  ['správné tajemství + znak navíc', 'Bearer ' + SPRAVNE + 'x'],
  ['prázdné Bearer', 'Bearer '],
  ['správné tajemství bez „Bearer "', SPRAVNE],
  ['správné tajemství jako Basic', 'Basic ' + SPRAVNE],
]

console.log(`\nAdresy úloh (${ULOHY.length}): ${ULOHY.join(', ')}`)
ok('našly se úlohy k ověření', ULOHY.length >= 9)

for (const uloha of ULOHY) {
  const soubor = `app/api/uloha/${uloha}/route.ts`
  const zdroj = readFileSync(soubor, 'utf8')
  console.log(`\n${uloha}`)

  let GET
  svet.log = []
  try {
    GET = (await nactiModul(soubor, [['next/server', NEXT], ['@/lib/supabase/uloha', ULOHA], ...kanarci(zdroj)])).GET
  } catch (e) {
    ok(`adresa se dá načíst (${e.message})`, false)
    continue
  }
  ok('adresa se dá načíst a nic při tom nesáhla na databázi', typeof GET === 'function' && svet.log.length === 0)

  // 1. Neplatné tajemství: 401 a ŽÁDNÝ zápis — ani zámek.
  process.env.CRON_SECRET = SPRAVNE
  for (const [popis, hlavicka] of SPATNE) {
    const r = await zavolat(GET, hlavicka)
    ok(`${popis} → 401, na nic nesáhla`, r.stav === 401 && r.log.length === 0)
  }

  // CRON_SECRET na serveru chybí / je prázdné: neprojde nikdo, ani prázdný Bearer.
  for (const [popis, hodnota] of [['chybí', undefined], ['prázdné', '']]) {
    if (hodnota === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = hodnota
    const a = await zavolat(GET, 'Bearer ')
    const b = await zavolat(GET, 'Bearer undefined')
    ok(`CRON_SECRET na serveru ${popis} → 401 i pro „Bearer " a „Bearer undefined"`,
      a.stav === 401 && a.log.length === 0 && b.stav === 401 && b.log.length === 0)
  }
  process.env.CRON_SECRET = SPRAVNE

  // 2. Kontrolní běh: se správným tajemstvím adresa zabere zámek SVÝM jménem a jde dál.
  const zabrat = `rpc:uloha_zabrat:${JSON.stringify({ p_uloha: uloha })}`
  const spravne = await zavolat(GET, 'Bearer ' + SPRAVNE)
  ok('správné tajemství → zámek pod jménem složky, pak práce',
    spravne.log.includes(zabrat) && spravne.log.length > spravne.log.indexOf(zabrat) + 1)

  // 3. Zámek drží jiný plánovač: 200 { bezi_jinde }, dál nic.
  const bezi = await zavolat(GET, 'Bearer ' + SPRAVNE, { data: false, error: null })
  ok('úloha už běží → 200 { bezi_jinde: true } a dál nic',
    bezi.stav === 200 && JSON.parse(bezi.telo).bezi_jinde === true && bezi.log.at(-1) === zabrat)

  // 4. Funkce zámku ještě není (kód nasazený před db push): běží jako dřív.
  const bezMigrace = await zavolat(GET, 'Bearer ' + SPRAVNE, { data: null, error: { code: 'PGRST202', message: 'nenalezeno' } })
  ok('zámek čeká na migraci → úloha běží bez něj',
    bezMigrace.log.includes(zabrat) && bezMigrace.log.length > bezMigrace.log.indexOf(zabrat) + 1)

  // 5. Jiná chyba zámku: 500 bez textu chyby (log GitHubu je veřejný), dál nic.
  const porucha = await zavolat(GET, 'Bearer ' + SPRAVNE, { data: null, error: { code: 'XX000', message: 'tajny-detail-db' } })
  ok('porucha zámku → 500 bez detailu chyby a dál nic',
    porucha.stav === 500 && !porucha.telo.includes('tajny-detail-db') && porucha.log.at(-1) === zabrat)
}

/* --- úloha volaná ve smyčce zámek uvolní -------------------------------- */

// faktury-z-emailu.yml volá znovu hned, dokud odpověď nese
// `pokracovat: true`. Kdyby si adresa zámek nechala, druhé kolo by
// dostalo „běží jinde" a dohánění schránek by se zastavilo po prvním.
console.log('\nÚloha volaná ve smyčce')

for (const f of readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'))) {
  const t = readFileSync(`.github/workflows/${f}`, 'utf8')
  const adresa = t.match(/\/api\/uloha\/([a-z0-9-]+)/)?.[1]
  if (!adresa || !/for \w+ in \$\(seq/.test(t)) continue
  const zdroj = readFileSync(`app/api/uloha/${adresa}/route.ts`, 'utf8')
  ok(`${f} volá ${adresa} ve smyčce → adresa volá uvolnitUlohu('${adresa}')`,
    zdroj.includes(`uvolnitUlohu('${adresa}')`))
}

{
  // Skutečný průchod: schránek žádná, adresa doběhne celá.
  const soubor = 'app/api/uloha/faktury-z-emailu/route.ts'
  svet.log = []
  const { GET } = await nactiModul(soubor, [
    ['next/server', NEXT],
    ['@/lib/supabase/uloha', ULOHA],
    ['@/lib/faktury-prijem-sync', js(`export async function vsechnaPripojeniSPrijmem() { return [] }
export const zpracovatPrijem = globalThis.__kanarek('zpracovatPrijem')`)],
    ['@/lib/finance-automaticke-parovani', js(`export const automatickyParovatPlatby = globalThis.__kanarek('automatickyParovatPlatby')`)],
  ])
  process.env.CRON_SECRET = SPRAVNE
  const r = await zavolat(GET, 'Bearer ' + SPRAVNE)
  const zabrat = r.log.indexOf(`rpc:uloha_zabrat:${JSON.stringify({ p_uloha: 'faktury-z-emailu' })}`)
  const uvolnit = r.log.indexOf(`rpc:uloha_uvolnit:${JSON.stringify({ p_uloha: 'faktury-z-emailu' })}`)
  ok('faktury: doběhne 200 a zámek uvolní až po zabrání', r.stav === 200 && zabrat >= 0 && uvolnit > zabrat)
}

/* --- jména a plány: migrace × adresy × workflow ------------------------ */

console.log('\nJména a plány')

const migrace = readFileSync('supabase/migrations/20261014120000_planovac_pg_cron.sql', 'utf8')
// Úlohy přibývají i pozdějšími migracemi (20261031100000: rezervace-choice) —
// plán je sjednocení všech `insert into app.planovac_ulohy` v pořadí migrací.
const VLOZENI = /insert into app\.planovac_ulohy \(uloha, plan_utc, limit_sekund\) values([\s\S]*?);/g
const vlozeni = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .flatMap((f) => [...readFileSync(`supabase/migrations/${f}`, 'utf8').matchAll(VLOZENI)].map((m) => m[1]))
ok('migrace vkládá seznam úloh', vlozeni.length > 0 && VLOZENI.test(migrace))
const plan = new Map(
  vlozeni.flatMap((v) => [...v.matchAll(/\('([^']+)',\s*'([^']+)',\s*(\d+)\)/g)]).map((m) => [m[1], { cron: m[2], limit: Number(m[3]) }]),
)

ok(`úlohy v migraci = složky app/api/uloha (${plan.size} × ${ULOHY.length})`,
  plan.size === ULOHY.length && ULOHY.every((u) => plan.has(u)))

// Dokud GitHub běží jako záloha, plánuje totéž. Až se z workflow
// `schedule` odstraní, tahle kontrola se obrátí: workflow `schedule` nemá.
const workflow = new Map()
for (const f of readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'))) {
  const t = readFileSync(`.github/workflows/${f}`, 'utf8')
  const adresa = t.match(/\/api\/uloha\/([a-z0-9-]+)/)
  const cron = t.match(/^\s*-\s*cron:\s*'([^']+)'/m)
  if (adresa && cron) workflow.set(adresa[1], cron[1])
}
for (const [uloha, p] of plan) {
  ok(`${uloha}: plán '${p.cron}' = GitHub '${workflow.get(uloha)}'`, workflow.get(uloha) === p.cron)
}

// Limit pokryje celý běh (maxDuration + 30 s) a zámek nikdy nezablokuje
// příští PLÁNOVANÝ běh — jen duplicitní volání.
const rozestupMinut = (cron) => {
  const [min, hod] = cron.split(/\s+/)
  const minuty = min.split(',').map(Number).sort((a, b) => a - b)
  const krokHodin = hod === '*' ? 1 : Number(hod.replace('*/', ''))
  if (minuty.length === 1) return 60 * krokHodin
  return Math.min(...minuty.map((m, i) => (i + 1 < minuty.length ? minuty[i + 1] - m : 60 - m + minuty[0])))
}
for (const [uloha, p] of plan) {
  const zdroj = readFileSync(`app/api/uloha/${uloha}/route.ts`, 'utf8')
  const max = Number(zdroj.match(/export const maxDuration = (\d+)/)?.[1] ?? 270)
  ok(`${uloha}: limit ${p.limit} s ≥ běh ${max} s + 30 s a < rozestup ${rozestupMinut(p.cron)} min`,
    p.limit >= max + 30 && p.limit <= 300 && p.limit < rozestupMinut(p.cron) * 60)
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
