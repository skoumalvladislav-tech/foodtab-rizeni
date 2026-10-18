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
      if (svet.odpovedi && jmeno in svet.odpovedi) return svet.odpovedi[jmeno]
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
const vlozeni = migrace.match(/insert into app\.planovac_ulohy \(uloha, plan_utc, limit_sekund\) values([\s\S]*?);/)
ok('migrace vkládá seznam úloh', !!vlozeni)
const plan = new Map(
  [...(vlozeni?.[1] ?? '').matchAll(/\('([^']+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m) => [m[1], { cron: m[2], limit: Number(m[3]) }]),
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

/* --- hlídač plánovače ---------------------------------------------------- */

// Migrace 20261017100000_planovac_hlidac, adresa app/api/planovac/hlidac,
// workflow planovac-hlidac.yml. pg_cron sám nikomu nenapíše, když
// přestane volat — tohle je jediné místo, které to pozná.
console.log('\nHlídač plánovače')

const { nejdelsiMezeraMinut, problemyPlanovace, REZERVA_MINUT, NEJDELSI_LIMIT_VOLANI_MINUT, CHYB_6H_PRAH } =
  await import('../lib/planovac-hlidac.ts')

// Nejdelší limit volání musí sedět s checkem v migraci — pg_net musí do něj odpovědět.
ok(`NEJDELSI_LIMIT_VOLANI_MINUT (${NEJDELSI_LIMIT_VOLANI_MINUT}) = horní mez limit_sekund v migraci`,
  /limit_sekund\s+integer not null check \(limit_sekund between 30 and (\d+)\)/.exec(migrace)?.[1] === String(NEJDELSI_LIMIT_VOLANI_MINUT * 60))

// Nejdelší mezera v plánu: ručně spočítané hodnoty, ne druhá implementace.
const OCEKAVANA_MEZERA = {
  'banka-synchronizace': 240,
  'checklisty-naplanovat': 60,
  'checklisty-terminy': 15,
  'faktury-z-emailu': 30,
  'marketing-automatizace': 60,
  'marketing-fronta': 15,
  'notifikace-push': 15,
  'pokladna-synchronizace': 60,
  'zapomenuty-odchod': 60,
}
for (const [uloha, p] of plan) {
  ok(`${uloha}: nejdelší mezera '${p.cron}' = ${OCEKAVANA_MEZERA[uloha]} min`, nejdelsiMezeraMinut(p.cron) === OCEKAVANA_MEZERA[uloha])
}
ok('nerovnoměrný plán: nejdelší, ne nejkratší mezera (0,50 → 50 min)', nejdelsiMezeraMinut('0,50 * * * *') === 50)
ok('nerovnoměrné hodiny (1,23 → 22 h)', nejdelsiMezeraMinut('0 1,23 * * *') === 22 * 60)
ok('plán, kterému hlídač nerozumí → null (den, minuta 60, nesmysl, prázdný)',
  [ '0 0 1 * *', '60 * * * *', 'nesmysl', '', '*/0 * * * *' ].every((c) => nejdelsiMezeraMinut(c) === null))

const TED = new Date('2026-10-17T12:00:00Z')
const pred = (minut) => new Date(TED.getTime() - minut * 60_000).toISOString()
const radek = (zmena = {}) => ({
  uloha: 'pokladna-synchronizace', plan_utc: '40 * * * *', v_cronu: true,
  posledni_zacatek: pred(20), posledni_volani: pred(20), posledni_kod: 200, posledni_chyba: null,
  volani_6h: 6, chyb_6h: 0, ...zmena,
})
const duvody = (zmena) => problemyPlanovace([radek(zmena)], TED).map((p) => p.duvod)

ok('zdravá úloha → žádný problém', duvody({}).length === 0)
ok(`volání před 60 + ${REZERVA_MINUT} min → ještě v pořádku`,
  duvody({ posledni_volani: pred(60 + REZERVA_MINUT), posledni_zacatek: pred(60 + REZERVA_MINUT) }).length === 0)
ok('volání o minutu později → problém s minutami', duvody({ posledni_volani: pred(61 + REZERVA_MINUT) })[0]?.includes(`před ${61 + REZERVA_MINUT} min`))
ok('není v pg_cronu → problém s návodem', duvody({ v_cronu: false })[0]?.includes('naplanovat_ulohy'))
const nezavolana = duvody({ posledni_volani: null })
ok('databáze ji nezavolala → problém, který řekne, že hned po zapnutí je to normální a do kdy',
  nezavolana.length === 1 && nezavolana[0].includes('hned po zapnutí') && nezavolana[0].includes('60 min'))
ok('HTTP 401 → problém, který jmenuje tajemství', duvody({ posledni_kod: 401 })[0]?.includes('tajemství'))
ok('HTTP 500 → problém', duvody({ posledni_kod: 500 })[0] === 'poslední odpověď HTTP 500')
ok('vypršelo → problém', duvody({ posledni_kod: null, posledni_chyba: 'vypršel čas' })[0] === 'poslední volání vypršelo')

// Bez odpovědi: pg_net musí odpovědět nebo vypršet do limitu (nejvýš 5 min).
// Starší volání bez odpovědi = pg_net neodesílá. Hranice na minutu přesně.
const hraniceOdpovedi = NEJDELSI_LIMIT_VOLANI_MINUT + REZERVA_MINUT
const bezOdpovedi = (minut) => duvody({ posledni_kod: null, posledni_chyba: 'zatím bez odpovědi', posledni_volani: pred(minut) })
ok('volání před 2 min ještě bez odpovědi → v pořádku (běží)', bezOdpovedi(2).length === 0)
ok(`bez odpovědi ${hraniceOdpovedi} min → ještě v pořádku`, bezOdpovedi(hraniceOdpovedi).length === 0)
ok(`bez odpovědi ${hraniceOdpovedi + 1} min → problém „pg_net neodesílá" s návodem`,
  bezOdpovedi(hraniceOdpovedi + 1)[0]?.includes('pg_net') && bezOdpovedi(hraniceOdpovedi + 1)[0]?.includes('worker_restart'))
ok('bez odpovědi 20 min (zaseknutý pg_net u hodinové úlohy) → problém', bezOdpovedi(20).length === 1)

// Chyby za 6 h: poslední volání může vyjít a opakované pády zakrýt.
ok(`${CHYB_6H_PRAH - 1} chyba za 6 h (poslední 200) → v pořádku`, duvody({ chyb_6h: CHYB_6H_PRAH - 1 }).length === 0)
ok(`${CHYB_6H_PRAH} chyby za 6 h (poslední 200) → problém s počtem`,
  duvody({ chyb_6h: CHYB_6H_PRAH, volani_6h: 6 })[0]?.includes(`${CHYB_6H_PRAH}× chyba (z 6 volání)`))

// Začátek v aplikaci: volání chodí a vrací 200, ale úloha nezačíná.
ok(`úloha začala před 60 + ${REZERVA_MINUT} min → v pořádku`, duvody({ posledni_zacatek: pred(60 + REZERVA_MINUT) }).length === 0)
ok('úloha začala o minutu později → problém „nezačíná"',
  duvody({ posledni_zacatek: pred(61 + REZERVA_MINUT) })[0]?.includes(`naposledy začala před ${61 + REZERVA_MINUT} min`))
ok('úloha v aplikaci nikdy nezačala → problém', duvody({ posledni_zacatek: null })[0]?.includes('nikdy nezačala'))
const sit = duvody({ posledni_kod: null, posledni_chyba: 'Could not connect: Bearer tajne-ABC' })
ok('síťová chyba → problém BEZ textu z pg_net (log je veřejný)', sit.length === 1 && !sit[0].includes('tajne'))
ok('neznámý plán → problém', duvody({ plan_utc: '0 0 1 * *' })[0]?.includes('neznámý tvar'))
ok('prázdný seznam úloh → problém', problemyPlanovace([], TED).length === 1)

// Adresa: skutečný route.ts, podstrčená databáze.
{
  const soubor = 'app/api/planovac/hlidac/route.ts'
  svet.log = []
  const { GET } = await nactiModul(soubor, [
    ['next/server', NEXT],
    ['@/lib/supabase/uloha', ULOHA],
    ['@/lib/supabase/dotaz', DOTAZ],
  ])
  ok('hlídač: adresa se dá načíst a nic při tom nesáhla na databázi', typeof GET === 'function' && svet.log.length === 0)

  process.env.CRON_SECRET = SPRAVNE
  for (const [popis, hlavicka] of SPATNE) {
    svet.odpovedi = { planovac_zdravi: { data: [], error: null } }
    const r = await zavolat(GET, hlavicka)
    ok(`hlídač: ${popis} → 401, na nic nesáhl`, r.stav === 401 && r.log.length === 0)
  }

  const predMin = (minut) => new Date(Date.now() - minut * 60_000).toISOString()
  const zdrave = [...plan].map(([uloha, p]) => ({
    uloha, plan_utc: p.cron, v_cronu: true, posledni_zacatek: predMin(1),
    posledni_volani: predMin(1), posledni_kod: 200,
    posledni_chyba: null, volani_6h: 6, chyb_6h: 0,
  }))
  const dotaz = async (odpoved) => {
    svet.odpovedi = { planovac_zdravi: odpoved }
    const r = await zavolat(GET, 'Bearer ' + SPRAVNE)
    let telo = null
    try { telo = JSON.parse(r.telo) } catch { /* zůstane null */ }
    return { ...r, telo, surove: r.telo }
  }

  const v = await dotaz({ data: zdrave, error: null })
  ok('hlídač: 9 zdravých úloh → 200, v pořádku 9, bez problémů',
    v.stav === 200 && v.telo?.v_poradku === 9 && v.telo?.problemy.length === 0
    && v.log.includes('rpc:planovac_zdravi:{}'))

  const stara = zdrave.map((u) => (u.uloha === 'zapomenuty-odchod' ? { ...u, posledni_volani: new Date(Date.now() - 3 * 3600_000).toISOString() } : u))
  const s = await dotaz({ data: stara, error: null })
  ok('hlídač: jedna úloha nevolaná 3 h → 503 a jmenuje ji',
    s.stav === 503 && s.telo?.v_poradku === 8 && s.telo?.problemy.length === 1 && s.telo.problemy[0].uloha === 'zapomenuty-odchod')

  // Zaseknutý pg_net: pg_cron dál zapisuje volání (čerstvá), odpověď nepřijde
  // a úloha v aplikaci naposledy začala před 3 h (z GitHubu). Dřív 200.
  const zaseknuty = zdrave.map((u) => ({
    ...u,
    posledni_volani: predMin(nejdelsiMezeraMinut(u.plan_utc) >= 30 ? 20 : 3),
    posledni_kod: null, posledni_chyba: 'zatím bez odpovědi', posledni_zacatek: predMin(180),
  }))
  const z = await dotaz({ data: zaseknuty, error: null })
  ok('hlídač: zaseknutý pg_net (volání chodí, odpovědi ne) → 503 u všech 9 úloh',
    z.stav === 503 && z.telo?.v_poradku === 0 && z.telo?.problemy.length === 9)

  const chybujici = zdrave.map((u) => (u.uloha === 'notifikace-push' ? { ...u, chyb_6h: 23, volani_6h: 24 } : u))
  const c = await dotaz({ data: chybujici, error: null })
  ok('hlídač: úloha s 23 chybami za 6 h a poslední 200 → 503 a jmenuje ji',
    c.stav === 503 && c.telo?.problemy.length === 1 && c.telo.problemy[0].uloha === 'notifikace-push')

  const m = await dotaz({ data: null, error: { code: 'PGRST202', message: 'nenalezeno' } })
  ok('hlídač: migrace nenasazená → 503 ceka_na_migraci (ne zeleně)', m.stav === 503 && m.telo?.stav === 'ceka_na_migraci')

  const p = await dotaz({ data: null, error: { code: 'XX000', message: 'tajny-detail-db' } })
  ok('hlídač: porucha čtení → 500 bez detailu', p.stav === 500 && !p.surove.includes('tajny-detail-db'))

  const n = await dotaz({ data: [], error: null })
  ok('hlídač: žádné úlohy → 503', n.stav === 503)
}

// Workflow: existuje, ptá se hlídače, při ne-200 skončí červeně.
{
  const f = '.github/workflows/planovac-hlidac.yml'
  const t = existsSync(f) ? readFileSync(f, 'utf8') : ''
  ok('workflow hlídače se ptá /api/planovac/hlidac s tajemstvím',
    t.includes('/api/planovac/hlidac') && t.includes('Authorization: Bearer ${TAJEMSTVI}'))
  ok('… má plán i ruční spuštění', /^\s*-\s*cron:\s*'[^']+'/m.test(t) && /^\s*workflow_dispatch:/m.test(t))
  // Jen větev `503)` až po její `;;` — `exit 1` z jiné větve se nepočítá.
  const vetev503 = t.match(/^\s*503\)([\s\S]*?);;/m)?.[1] ?? ''
  ok('… a 503 končí exit 1', /\bexit 1\b/.test(vetev503))
  ok('hlídač není úloha pg_cronu (nehlídá sám sebe)',
    !existsSync('app/api/uloha/planovac-hlidac') && !plan.has('planovac-hlidac'))

  /*
    Blok `run:` se opravdu SPUSTÍ — bash, skutečný jq, podstrčený jen
    `curl` (funkce se stejným jménem, vrátí zadaný kód a tělo). Čtení
    textu workflow by nepoznalo, že jq vybírá špatné pole nebo že větev
    `case` nikdy nenastane.

    Potřebuje bash a jq. V CI (ubuntu) jsou vždycky — tam jejich
    chybění je CHYBA. Lokálně (Windows bez jq) se kontrola viditelně
    přeskočí; jq jde podstrčit přes PATH.
  */
  const radky = t.replace(/\r\n/g, '\n').split('\n')
  const iRun = radky.findIndex((r) => /^\s*run:\s*\|\s*$/.test(r))
  const odsazeniKlice = iRun >= 0 ? radky[iRun].match(/^\s*/)[0].length : 0
  const blok = []
  for (const r of iRun >= 0 ? radky.slice(iRun + 1) : []) {
    if (r.trim() === '') { blok.push(''); continue }
    if (r.match(/^\s*/)[0].length <= odsazeniKlice) break
    blok.push(r)
  }
  const spolecne = Math.min(...blok.filter((r) => r.trim()).map((r) => r.match(/^\s*/)[0].length))
  const skript = blok.map((r) => r.slice(spolecne)).join('\n')
  ok('blok run: hlídače se našel a volá curl', skript.includes('curl ') && skript.includes('case "$KOD"'))

  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const maJq = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0

  if (!maJq && !process.env.CI) {
    console.log('  PŘESKOČENO spuštění bloku run: (lokálně chybí bash nebo jq — v CI běží vždy)')
  } else {
    ok('bash a jq jsou k dispozici', maJq)
    const FALESNY_CURL = String.raw`curl() {
  printf '%s\n' "$@" > curl-argumenty.txt
  local ven=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "-o" ]; then ven="$2"; shift; fi
    shift
  done
  printf '%s' "$FALESNE_TELO" > "$ven"
  printf '%s' "$FALESNY_KOD"
}
`
    const spustit = (kod, telo, env = {}) => {
      const slozka = mkdtempSync(join(tmpdir(), 'hlidac-'))
      const souhrn = join(slozka, 'souhrn.md')
      const r = spawnSync('bash', ['-c', FALESNY_CURL + skript], {
        cwd: slozka, encoding: 'utf8',
        env: {
          ...process.env, ADRESA: 'https://foodtab.test', TAJEMSTVI: SPRAVNE, GITHUB_STEP_SUMMARY: souhrn,
          FALESNY_KOD: String(kod), FALESNE_TELO: typeof telo === 'string' ? telo : JSON.stringify(telo), ...env,
        },
      })
      const argumenty = existsSync(join(slozka, 'curl-argumenty.txt')) ? readFileSync(join(slozka, 'curl-argumenty.txt'), 'utf8') : ''
      rmSync(slozka, { recursive: true, force: true })
      return { status: r.status, vystup: r.stdout + r.stderr, argumenty }
    }

    const a = spustit(200, { ulohy: 9, v_poradku: 9, chyb_6h: 0, problemy: [] })
    ok('workflow: 200 → zelený, souhrn vypsaný', a.status === 0 && a.vystup.includes('HTTP 200 {"ulohy":9'))
    ok('… volá /api/planovac/hlidac s Bearer tajemstvím',
      a.argumenty.includes('https://foodtab.test/api/planovac/hlidac') && a.argumenty.includes(`Authorization: Bearer ${SPRAVNE}`))
    ok('… a tajemství nevypíše', !a.vystup.includes(SPRAVNE))

    const b = spustit(503, { ulohy: 9, v_poradku: 8, chyb_6h: 0, problemy: [{ uloha: 'pokladna-synchronizace', duvod: 'poslední odpověď HTTP 500' }] })
    ok('workflow: 503 s problémem → červený a ::error:: s úlohou a důvodem',
      b.status === 1 && b.vystup.includes('::error::pokladna-synchronizace: poslední odpověď HTTP 500'))

    const c = spustit(503, { stav: 'ceka_na_migraci' })
    ok('workflow: 503 čeká na migraci → červený a řekne to', c.status === 1 && c.vystup.includes('::error::Migrace 20261017100000'))

    const d = spustit(503, { chyba: 'Hlídač není nastavený — chybí SUPABASE_SERVICE_ROLE_KEY.' })
    ok('workflow: 503 s polem chyba → červený a důvod jako ::error::',
      d.status === 1 && d.vystup.includes('::error::Hlídač není nastavený — chybí SUPABASE_SERVICE_ROLE_KEY.'))

    const e = spustit(500, { chyba: 'Stav plánovače se nepodařilo přečíst.' })
    ok('workflow: 500 → červený a důvod jako ::error::',
      e.status === 1 && e.vystup.includes('::error::Stav plánovače se nepodařilo přečíst.'))

    const f401 = spustit(401, { chyba: 'Nepovoleno.' })
    ok('workflow: 401 → červený a řekne, že tajemství nesedí', f401.status === 1 && f401.vystup.includes('401 — tajemství nesedí'))

    const g = spustit(502, '<html>Bad gateway</html>')
    ok('workflow: odpověď, která není JSON → červený', g.status === 1 && g.vystup.includes('(odpověď není JSON)'))

    const h = spustit(200, {}, { ADRESA: '' })
    ok('workflow: chybí APP_URL → červený, curl se nevolá', h.status === 1 && h.argumenty === '')
  }
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
