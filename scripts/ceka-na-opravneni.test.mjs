#!/usr/bin/env node
/**
 * Kdo čeká na oprávnění — okno, Lidé, upozornění, pozvánka.
 *
 * Pusť `node scripts/ceka-na-opravneni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TO VZNIKLO
 *
 * Hlášení majitele 25. 9. 2026: „po kliknutí na nějaký profil se pouze
 * otevře nabídka Lidé (bez údajů člověka) … zobrazení Nový člověk je
 * také špatně, mělo by tam být jméno nebo e-mail."
 *
 * Okno „N lidí čeká na oprávnění" psalo jméno z profilu (skoro vždy
 * prázdné → „Nový člověk") a tlačítko vedlo na
 * `/nastaveni/lide?clovek=<id ÚČTU>`. Obrazovka Lidé parametr `clovek`
 * neznala nikdy — panel oprávnění rozbalí jen `?opravneni=<id
 * ZAMĚSTNANCE>#opravneni`. Stejná rozbitá adresa byla v upozornění
 * „přijal pozvánku".
 *
 * ---------------------------------------------------------------------
 * JAK TO KONTROLA DĚLÁ
 *
 * Sahá na výstup, ne na vlastní záměr:
 *
 *   skutečné okno (ceka-na-opravneni.tsx) → HTML → odkaz tak, jak ho
 *   vykreslilo → skutečná stránka Lidé s parametry z TOHO odkazu → je
 *   v ní panel oprávnění toho člověka?
 *
 * Okno si stav „zavřeno" čte ze `sessionStorage` přes
 * `useSyncExternalStore` a na serveru se nevykreslí vůbec. Podstrčí se
 * proto jen ten jeden háček (bere stav z prohlížeče, a prohlížeč tu
 * není → „nezavřeno"); všechno ostatní z Reactu je skutečné.
 *
 * Databáze je podstrčená (jako v prava-osob.test.mjs). CO TO NEOVĚŘÍ:
 * jestli `cekaji_na_opravneni` vrací správné důvody a jména — to hlídá
 * supabase/tests/krok61_scenar.sql proti skutečné funkci. Tady se ověřuje,
 * že aplikace to, co funkce vrátí, ukáže a správně odkáže.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { adresaModulu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(
    `  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`,
  )
}

/* =====================================================================
   PODSTRČENÁ DATABÁZE
   ================================================================== */

const T = '11111111-1111-4111-8111-111111111111'
const B_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P_CISNIK = 'c1c1c1c1-0000-4000-8000-000000000001'
const P_VEDOUCI = 'c2c2c2c2-0000-4000-8000-000000000002'
const P_OBSLUHA = 'c3c3c3c3-0000-4000-8000-000000000003'

const U_MAJITEL = 'd0000000-0000-4000-8000-000000000001'
const U_VEDOUCI = 'd0000000-0000-4000-8000-000000000002'
const U_PETR = 'd0000000-0000-4000-8000-000000000003'
const U_VENDY = 'd0000000-0000-4000-8000-000000000004'
const U_NOVA = 'd0000000-0000-4000-8000-000000000005'
const U_LADA = 'd0000000-0000-4000-8000-000000000006'
const U_KATA = 'd0000000-0000-4000-8000-000000000007'
const U_CISNIK = 'd0000000-0000-4000-8000-000000000008'

const E_MAJITEL = 'e0000000-0000-4000-8000-000000000001'
const E_VEDOUCI = 'e0000000-0000-4000-8000-000000000002'
const E_PETR = 'e0000000-0000-4000-8000-000000000003'
const E_VENDY = 'e0000000-0000-4000-8000-000000000004'
const E_NOVA = 'e0000000-0000-4000-8000-000000000005'
const E_LADA = 'e0000000-0000-4000-8000-000000000006'
const E_CISNIK = 'e0000000-0000-4000-8000-000000000008'

const I_NOVA = 'f0000000-0000-4000-8000-000000000001'
const I_PRESUN = 'f0000000-0000-4000-8000-000000000002'
const I_PRIJATA = 'f0000000-0000-4000-8000-000000000003'
const I_PROSLA = 'f0000000-0000-4000-8000-000000000004'
const I_LADA = 'f0000000-0000-4000-8000-000000000005'
const I_ZRUSENA = 'f0000000-0000-4000-8000-000000000006'
const ZITRA = new Date(Date.now() + 86400000).toISOString()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PRAVA = [
  ['shifts.read', 'Vidět rozpis směn'],
  ['people.manage', 'Spravovat lidi'],
  ['settings.manage', 'Spravovat nastavení firmy'],
]

/** Co vrací `public.cekaji_na_opravneni` — jeden řádek každého důvodu. */
const CEKAJICI = [
  { user_id: U_KATA, jmeno: 'katarinajiraskova4@gmail.com', od: '2026-09-25T08:02:48Z',
    employee_id: null, kontakt: 'katarinajiraskova4@gmail.com', duvod: 'bez_zaznamu',
    zarazeni: null, zarazeni_id: null },
  { user_id: U_LADA, jmeno: 'Láďa', od: '2026-09-04T08:35:38Z',
    employee_id: null, kontakt: 'lada@example.cz', duvod: 'zaznam_smazany',
    zarazeni: 'Kuchař/ka', zarazeni_id: null },
  { user_id: U_NOVA, jmeno: 'Nová Posila', od: '2026-09-24T10:00:00Z',
    employee_id: E_NOVA, kontakt: 'nova@example.cz', duvod: 'bez_zarazeni',
    zarazeni: null, zarazeni_id: null },
  { user_id: U_VENDY, jmeno: 'Vendy', od: '2026-09-15T19:10:02Z',
    employee_id: E_VENDY, kontakt: 'info@cerna-perla.cz', duvod: 'zarazeni_bez_prav',
    zarazeni: 'Obsluha brig.', zarazeni_id: P_OBSLUHA },
]

const EMAILY = {
  [U_MAJITEL]: 'majitel@example.cz',
  [U_VEDOUCI]: 'vedouci@example.cz',
  [U_PETR]: 'petr@example.cz',
  [U_VENDY]: 'info@cerna-perla.cz',
  [U_NOVA]: 'nova@example.cz',
  [U_CISNIK]: 'cisnik@example.cz',
}

function pozvanka(id, extra) {
  return {
    id, tenant_id: T, employee_id: null, channel: 'email', email: null, phone: null,
    expires_at: ZITRA, accepted_at: null, revoked_at: null, nahrazuje_ucet: null, ...extra,
  }
}

function novySvet() {
  const pp = (pozice, klice) =>
    klice.map((k) => ({ id: crypto.randomUUID(), tenant_id: T, position_id: pozice, permission_key: k }))
  const zam = (id, jmeno, extra) => ({
    id, tenant_id: T, full_name: jmeno, position_id: null, branch_id: null, usek_id: null,
    user_id: null, employment_type: 'hpp', started_on: null, active: true, deleted_at: null,
    color: null, je_majitel: false, created_at: '2026-09-01T00:00:00Z', ...extra,
  })
  const clen = (uid, scope = 'tenant') => ({ id: crypto.randomUUID(), tenant_id: T, user_id: uid, scope, status: 'active' })
  return {
    permissions: PRAVA.map(([key, label], i) => ({ key, module_key: 'provoz', label, sort_order: i, sensitive: false })),
    positions: [
      { id: P_CISNIK, tenant_id: T, key: 'cisnik', label: 'Číšník', active: true },
      { id: P_VEDOUCI, tenant_id: T, key: 'vedouci', label: 'Vedoucí', active: true },
      { id: P_OBSLUHA, tenant_id: T, key: 'obsluha', label: 'Obsluha brig.', active: true },
    ],
    position_permissions: [
      ...pp(P_CISNIK, ['shifts.read']),
      ...pp(P_VEDOUCI, ['shifts.read', 'people.manage']),
    ],
    employee_permissions: [],
    employees: [
      zam(E_MAJITEL, 'Marek Majitel', { user_id: U_MAJITEL, je_majitel: true }),
      zam(E_VEDOUCI, 'Věra Vedoucí', { user_id: U_VEDOUCI, position_id: P_VEDOUCI }),
      zam(E_PETR, 'Petr Číšník', { user_id: U_PETR, position_id: P_CISNIK, branch_id: B_A }),
      zam(E_VENDY, 'Vendy', { user_id: U_VENDY, position_id: P_OBSLUHA, branch_id: B_A }),
      zam(E_NOVA, 'Nová Posila', { user_id: U_NOVA, branch_id: B_A }),
      zam(E_LADA, 'Láďa', { user_id: U_LADA, position_id: P_CISNIK, deleted_at: '2026-09-19T19:32:55Z' }),
      zam(E_CISNIK, 'Čeněk Číšník', { user_id: U_CISNIK, position_id: P_CISNIK, branch_id: B_A }),
    ],
    memberships: [
      clen(U_MAJITEL), clen(U_VEDOUCI), clen(U_PETR, 'branch'), clen(U_VENDY, 'branch'),
      clen(U_NOVA, 'branch'), clen(U_LADA, 'branch'), clen(U_KATA, 'branch'), clen(U_CISNIK),
    ],
    membership_branches: [],
    /*
      Pozvánky firmy: dvě čekající (obyčejná a PŘESUN), jedna pro
      smazaného člověka, jedna přijatá, jedna zrušená a jedna prošlá —
      ty tři poslední se ukázat nesmějí.
    */
    invitations: [
      pozvanka(I_NOVA, { employee_id: E_NOVA, email: 'nova@example.cz' }),
      pozvanka(I_PRESUN, { employee_id: E_PETR, email: 'petr.novy@example.cz', nahrazuje_ucet: U_PETR }),
      pozvanka(I_LADA, { employee_id: E_LADA, email: 'lada@example.cz' }),
      pozvanka(I_PRIJATA, { employee_id: E_VENDY, email: 'vendy@example.cz', accepted_at: '2026-09-20T00:00:00Z' }),
      pozvanka(I_PROSLA, { employee_id: E_VENDY, email: 'vendy2@example.cz', expires_at: '2026-09-01T00:00:00Z' }),
      pozvanka(I_ZRUSENA, { employee_id: E_VENDY, email: 'vendy3@example.cz', revoked_at: '2026-09-21T00:00:00Z' }),
    ],
    branches: [{ id: B_A, tenant_id: T, name: 'Centrum', slug: 'centrum', color: 'amber' }],
    useky: [],
    employee_pins: [],
    notifications: [],
    rpcVolani: [],
    prihlaseny: null,
  }
}

function maPravo(db, e, klic) {
  if (e.je_majitel) return true
  const v = db.employee_permissions.find((r) => r.employee_id === e.id && r.permission_key === klic)
  if (v) return v.granted
  return db.position_permissions.some((r) => r.position_id === e.position_id && r.permission_key === klic)
}

function kdoJsem(db) {
  const uid = db.prihlaseny
  const m = db.memberships.find((x) => x.user_id === uid && x.tenant_id === T && x.status === 'active')
  const e = db.employees.find((x) => x.user_id === uid && x.tenant_id === T && !x.deleted_at)
  return { uid, m, e }
}

/** `has_access(firma, právo, null)` — za celou firmu. */
const zaFirmu = (db, klic) => {
  const { m, e } = kdoJsem(db)
  return Boolean(m && e && m.scope === 'tenant' && maPravo(db, e, klic))
}

const maska = (email) => (email ? `${email[0]}***${email.slice(email.indexOf('@'))}` : null)

function rpc(db, jmeno, a) {
  db.rpcVolani.push({ jmeno, a })
  const { m, e } = kdoJsem(db)
  if (jmeno === 'has_access') {
    if (!UUID.test(String(a.p_tenant))) return { data: null, error: { code: '22P02', message: 'uuid' } }
    if (a.p_branch != null && !UUID.test(String(a.p_branch))) return { data: null, error: { code: '22P02', message: 'uuid' } }
    if (!m || !e || a.p_tenant !== T) return { data: false, error: null }
    if (!maPravo(db, e, a.p_permission)) return { data: false, error: null }
    if (m.scope === 'tenant') return { data: true, error: null }
    return { data: a.p_branch != null && db.membership_branches.some((x) => x.membership_id === m.id && x.branch_id === a.p_branch), error: null }
  }
  if (jmeno === 'my_tenants') {
    if (!m) return { data: [], error: null }
    return { data: [{ tenant_id: T, name: 'Černá Perla', role_key: '', role_label: '', is_owner: !!e?.je_majitel, scope: m.scope }], error: null }
  }
  if (jmeno === 'my_context') {
    if (!m || !e) return { data: null, error: null }
    return {
      data: {
        tenant: { id: T, name: 'Černá Perla', currency: 'CZK', timezone: 'Europe/Prague' },
        membership: { scope: m.scope, status: m.status },
        zarazeni: null,
        jeMajitel: e.je_majitel,
        modules: [{ key: 'provoz', label: 'Provoz', isBase: true, active: true }],
        branches: db.branches.map(({ id, name, slug, color }) => ({ id, name, slug, color })),
        permissions: db.permissions.filter((p) => maPravo(db, e, p.key)).map((p) => p.key),
      },
      error: null,
    }
  }
  if (jmeno === 'pocet_majitelu') return { data: 1, error: null }
  if (jmeno === 'employee_earnings') return { data: [], error: null }
  if (jmeno === 'cekaji_na_opravneni') {
    return { data: zaFirmu(db, 'people.manage') ? CEKAJICI.map((c) => ({ ...c })) : [], error: null }
  }
  if (jmeno === 'ucty_lidi') {
    if (!zaFirmu(db, 'people.manage')) return { data: [], error: null }
    return {
      data: db.employees
        .filter((z) => !z.deleted_at && z.user_id)
        .map((z) => ({ employee_id: z.id, ucet: maska(EMAILY[z.user_id]) })),
      error: null,
    }
  }
  if (jmeno === 'accept_invitation') {
    return db.chybaPrijeti
      ? { data: null, error: { code: '23514', message: db.chybaPrijeti } }
      : { data: T, error: null }
  }
  if (jmeno === 'moje_cekajici_pozvanky') return { data: db.mojePozvanky ?? [], error: null }
  if (jmeno === 'zrusit_pozvanku') {
    if (!zaFirmu(db, 'people.manage')) {
      return { data: null, error: { code: '42501', message: 'Rušit pozvánky může jen ten, kdo spravuje lidi za celou firmu.' } }
    }
    const p = db.invitations.find((x) => x.id === a.p_pozvanka && x.tenant_id === a.p_tenant)
    if (p) p.revoked_at = '2026-09-28T10:00:00Z'
    return { data: null, error: null }
  }
  if (jmeno === 'odebrat_z_firmy') {
    if (!zaFirmu(db, 'people.manage')) {
      return { data: null, error: { code: '42501', message: 'Odebírat lidi z firmy může jen ten, kdo spravuje lidi za celou firmu.' } }
    }
    const c = db.memberships.find((x) => x.user_id === a.p_user && x.tenant_id === a.p_tenant)
    if (c) c.status = 'suspended'
    return { data: null, error: null }
  }
  return { data: null, error: { code: 'PGRST202', message: `neznámá funkce ${jmeno}` } }
}

function dotaz(db, tabulka) {
  const s = { op: 'select', filtry: [], poradi: [], limit: null, jeden: false, data: null }
  const b = {
    select() { return b },
    eq(k, v) { s.filtry.push((r) => String(r[k]) === String(v)); return b },
    in(k, arr) { const m = arr.map(String); s.filtry.push((r) => m.includes(String(r[k]))); return b },
    is(k, v) { s.filtry.push((r) => (r[k] ?? null) === v); return b },
    gt(k, v) { s.filtry.push((r) => String(r[k]) > String(v)); return b },
    order(k, o = {}) { s.poradi.push([k, o.ascending !== false]); return b },
    limit(n) { s.limit = n; return b },
    maybeSingle() { s.jeden = true; return b },
    update(data) { s.op = 'update'; s.data = data; return b },
    delete() { s.op = 'delete'; return b },
    insert(rows) { s.op = 'insert'; s.data = [].concat(rows); return b },
    then(ok, ko) { return Promise.resolve().then(proved).then(ok, ko) },
  }
  const radky = () => (db[tabulka] ??= [])
  const vyhovuje = (r) => s.filtry.every((f) => f(r))
  function proved() {
    if (s.op === 'select') {
      let out = radky().filter(vyhovuje)
      for (const [k, vzestupne] of [...s.poradi].reverse()) {
        out = [...out].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (vzestupne ? 1 : -1))
      }
      if (s.limit != null) out = out.slice(0, s.limit)
      out = out.map((r) => ({ ...r }))
      return { data: s.jeden ? out[0] ?? null : out, error: null }
    }
    return { data: null, error: null }
  }
  return b
}

function klient(db) {
  return {
    from: (t) => dotaz(db, t),
    rpc: async (jmeno, args) => rpc(db, jmeno, args ?? {}),
    auth: {
      getUser: async () => ({
        data: { user: db.prihlaseny ? { id: db.prihlaseny, email: EMAILY[db.prihlaseny] ?? 'x@example.cz', phone: null } : null },
        error: null,
      }),
    },
  }
}

/* =====================================================================
   NAČTENÍ SKUTEČNÉHO KÓDU
   ================================================================== */

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const REACT = import.meta.resolve('react')

const PRAZDNY = js('')
const STUB_SERVER = js('export async function getServerSupabase() { return globalThis.__ceka.klient }')
const STUB_NAV = js(
  'export function redirect(u) { const e = new Error("NEXT_REDIRECT " + u); e.presmerovani = u; throw e }\n' +
  'export function notFound() { throw new Error("NOT_FOUND") }\n' +
  'export function useRouter() { return { push() {}, refresh() {} } }',
)
const STUB_CACHE = js('export function revalidatePath(...a) { globalThis.__ceka.revalidace.push(a) }')
const STUB_HEADERS = js('export async function headers() { return new Map([["host", "localhost:3000"]]) }')
const STUB_EMAIL = js('export async function odeslatEmail() { return { stav: "odeslano" } }')
const STUB_LINK = js(
  `import { createElement } from ${JSON.stringify(REACT)}\n` +
  'export default function Link({ href, children, prefetch, scroll, ...r }) { return createElement("a", { href, ...r }, children) }',
)
/*
  React beze změny, jen `useSyncExternalStore` vrací stav z prohlížeče
  (`getSnapshot`) místo serverového. Prohlížeč tu není, `sessionStorage`
  hodí výjimku a okno ji čte jako „nezavřeno" — přesně jako prohlížeč
  s vypnutým úložištěm.
*/
const REACT_KLIENT = js(
  `export * from ${JSON.stringify(REACT)}\n` +
  `import * as R from ${JSON.stringify(REACT)}\n` +
  'export default R.default ?? R\n' +
  'export function useSyncExternalStore(odebirat, klient) { return klient() }',
)
const STUB_POZICE = js(
  'export async function najdiNeboZaloz() { throw new Error("nezakládá se") }\n' +
  'export async function zalozitPozici() {}\nexport async function prejmenovatPozici() {}\nexport async function prepnoutPozici() {}',
)
// Formulář pozvánky se podstrčí, aby šlo číst, co mu stránka POSLALA
// (na serveru je sbalený a nic z toho nevykreslí).
const STUB_VYSTAVENI = js(
  'export default function Vystaveni(p) { globalThis.__ceka.vystaveni = p; return null }',
)

const ZAKLAD = [
  ['server-only', PRAZDNY],
  ['next/cache', STUB_CACHE],
  ['next/headers', STUB_HEADERS],
  ['next/navigation', STUB_NAV],
  ['next/link', STUB_LINK],
  ['@/lib/supabase/server', STUB_SERVER],
  ['@/lib/email', STUB_EMAIL],
]
const AUTHZ = adresaModulu('lib/authz.ts', ZAKLAD)
const DOTAZ = adresaModulu('lib/supabase/dotaz.ts', ZAKLAD)
const FIRMA = adresaModulu('lib/firma.ts', [...ZAKLAD, ['@/lib/authz', AUTHZ]])
const SPOLECNE = [
  ...ZAKLAD,
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['../pozice/akce', STUB_POZICE],
]

const CEKA_AKCE = adresaModulu('app/[rozsah]/ceka-akce.ts', SPOLECNE)
const akceCekani = await import(CEKA_AKCE)

const modulOkna = await nactiModul('app/[rozsah]/ceka-na-opravneni.tsx', [
  ...SPOLECNE, ['./ceka-akce', CEKA_AKCE], ['react', REACT_KLIENT],
])
const Okno = modulOkna.default
const { OdebratZFirmy } = modulOkna

const POZVANKY_AKCE = adresaModulu('app/[rozsah]/nastaveni/lide/pozvanky-akce.ts', SPOLECNE)
const akcePozvanek = await import(POZVANKY_AKCE)
const { ZrusitPozvanku } = await nactiModul('app/[rozsah]/nastaveni/lide/cekajici-pozvanky.tsx', [
  ...SPOLECNE, ['./pozvanky-akce', POZVANKY_AKCE],
])

const AKCE_LIDE = adresaModulu('app/[rozsah]/nastaveni/lide/akce.ts', SPOLECNE)
const StrankaLide = (await nactiModul('app/[rozsah]/nastaveni/lide/page.tsx', [
  ...SPOLECNE, ['./akce', AKCE_LIDE], ['./ceka-akce', CEKA_AKCE], ['./pozvanky-akce', POZVANKY_AKCE],
])).default
const StrankaLideZachyt = (await nactiModul('app/[rozsah]/nastaveni/lide/page.tsx', [
  ...SPOLECNE, ['./akce', AKCE_LIDE], ['./ceka-akce', CEKA_AKCE], ['./pozvanky-akce', POZVANKY_AKCE],
  ['./vystaveni', STUB_VYSTAVENI],
])).default
const AKCE_ROLE = adresaModulu('app/[rozsah]/nastaveni/role/akce.ts', SPOLECNE)
const NABIDKA = adresaModulu('app/[rozsah]/nabidka.ts', SPOLECNE)
const StrankaRole = (await nactiModul('app/[rozsah]/nastaveni/role/page.tsx', [
  ...SPOLECNE, ['./akce', AKCE_ROLE], ['../../nabidka', NABIDKA],
])).default
const { PoznamkaKUctu } = await nactiModul('app/[rozsah]/nastaveni/lide/vystaveni.tsx', [
  ...SPOLECNE, ['./akce', AKCE_LIDE],
])

const STUB_AKCE_UPOZORNENI = js('export async function oznacitPrectene() {}\nexport async function potvrditZmenu() {}')
const StrankaUpozorneni = (await nactiModul('app/[rozsah]/upozorneni/page.tsx', [
  ...SPOLECNE, ['./akce', STUB_AKCE_UPOZORNENI],
])).default

const lib = await import('../lib/ceka-na-opravneni.ts')

// Cesta ven ze sdělení mimo rám (kontrola #85). Akce odhlášení se
// podstrčí: tady se jen kreslí, neodhlašuje.
const STUB_ODHLASIT = js('export async function odhlasit() {}')
const STUB_PRIJMOUT = js('export async function prijmoutMojiPozvanku() { return { stav: "nic" } }')
const CESTA = [...SPOLECNE, ['@/app/prihlaseni/akce', STUB_ODHLASIT], ['./prijmout-akce', STUB_PRIJMOUT]]
const CestaVen = (await nactiModul('app/cesta-ven.tsx', CESTA)).default
const Sdeleni = (await nactiModul('app/sdeleni.tsx', CESTA)).default
const StrankaUvod = (await nactiModul('app/page.tsx', CESTA)).default
const StrankaBezOpravneni = (await nactiModul('app/zatim-bez-opravneni/page.tsx', CESTA)).default

// Pozvánka: přijetí odkazem a okénko „máte jiný účet".
const POZVANKA = [
  ['server-only', PRAZDNY],
  ['next/navigation', STUB_NAV],
  ['next/link', STUB_LINK],
  ['@/lib/authz', js('export async function getUser() { return { id: "u", email: "kata@example.cz" } }')],
  ['@/lib/ohlas-prijeti', js('export async function ohlasPrijetiPozvanky() { return { odeslano: 0, selhalo: 0 } }')],
  ['@/lib/supabase/server', STUB_SERVER],
  ['@/lib/supabase/uloha', js('export function klientUlohy() { return null }')],
]
const AKCE_POZVANKY = adresaModulu('app/pozvanka/[token]/akce.ts', POZVANKA)
const akcePozvanky = await import(AKCE_POZVANKY)
const jinyUcet = await nactiModul('app/pozvanka/[token]/jiny-ucet.tsx', [...POZVANKA, ['./akce', AKCE_POZVANKY]])
const prihlaseni = await import('../lib/prihlaseni.ts')

function svet(uid) {
  const db = novySvet()
  db.prihlaseny = uid
  globalThis.__ceka = { db, klient: klient(db), revalidace: [], vystaveni: null }
  return db
}

async function vykreslitStranku(Stranka, rozsah, hledani = {}) {
  const prvek = await Stranka({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(hledani) })
  return renderToStaticMarkup(prvek)
}

const dekodovat = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Řádek okna podle účtu (`data-ucet`). */
function radek(html, ucet) {
  const m = html.match(new RegExp(`<li[^>]*data-ucet="${ucet}"[^>]*>([\\s\\S]*?)</li>`))
  return m ? m[1] : ''
}

/** Tlačítka v kusu HTML: [{ typ, text }]. */
function tlacitkaV(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    typ: m[1].match(/type="([^"]*)"/)?.[1] ?? '(žádný)',
    text: dekodovat(m[2].replace(/<[^>]+>/g, '')).trim(),
  }))
}

/** Odkazy v kusu HTML: [{ href, text }]. */
function odkazy(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: dekodovat(m[1]), text: dekodovat(m[2].replace(/<[^>]+>/g, '')) }))
}

/** Parametry z odkazu tak, jak je dostane stránka. */
function parametry(href) {
  return Object.fromEntries(new URL(href, 'http://x').searchParams)
}

/* =====================================================================
   1. VĚTY A ODKAZY (lib/ceka-na-opravneni.ts)
   ================================================================== */

console.log('== 1. Věty a odkazy ==')
{
  const [kata, lada, nova, vendy] = CEKAJICI
  ma('bez záznamu: věta', lib.popisDuvodu(kata), 'Účet není propojený s nikým v Lidech.')
  ma('smazaný záznam: věta', lib.popisDuvodu(lada), 'Záznam v Lidech je smazaný.')
  ma('bez zařazení: věta', lib.popisDuvodu(nova), 'V Lidech nemá zařazení ani žádné oprávnění.')
  ma('zařazení bez práv: věta s názvem zařazení', lib.popisDuvodu(vendy),
    'Zařazení Obsluha brig. zatím nemá žádná oprávnění.')
  ma('starší databáze bez důvodu: žádná věta', lib.popisDuvodu({ user_id: 'u', jmeno: 'x' }), null)

  ma('odkaz na oprávnění člověka: id ZAMĚSTNANCE a kotva',
    lib.odkazNaOpravneni('firma', E_NOVA), `/firma/nastaveni/lide?opravneni=${E_NOVA}#opravneni`)
  ma('upozornění se záznamem → oprávnění člověka',
    lib.odkazNaPrijatouPozvanku('firma', E_VENDY), `/firma/nastaveni/lide?opravneni=${E_VENDY}#opravneni`)
  ma('upozornění bez záznamu → karta čekajících v Lidech',
    lib.odkazNaPrijatouPozvanku('firma', null), '/firma/nastaveni/lide#cekaji')
  ma('odkaz na pozvánku: formulář rozbalený a kotva',
    lib.odkazNaPozvanku('firma'), '/firma/nastaveni/lide?pozvat=1#pozvanka')

  const a = lib.akceCekajiciho('firma', kata)
  ma('bez záznamu: oprávnění ne, ale „Pozvat z Lidí" a odebrání',
    [a.hlavni, a.vedlejsi, a.odebrat],
    [null, { href: '/firma/nastaveni/lide?pozvat=1#pozvanka', popisek: 'Pozvat z Lidí' }, true])
  /*
    Kontrola 28. 9. 2026: věta radila „pozvánku z jeho řádku v Lidech" —
    v řádku žádná není. A zamlčela, že u člověka, který účet už má
    (Kateřina), jde o PŘESUN, který vystaví jen majitel.
  */
  ma('… věta vede na Pozvat z Lidí a řekne, že přesun vystaví jen majitel',
    [/Pozvat z Lidí/.test(a.napoveda ?? ''), /přesune a vystaví ji jen majitel/.test(a.napoveda ?? ''),
      /z jeho řádku/.test(a.napoveda ?? '')],
    [true, true, false])
  ma('starší databáze bez důvodu: aspoň seznam lidí, nic neodebírá',
    lib.akceCekajiciho('firma', { user_id: 'u', jmeno: 'x' }),
    { hlavni: { href: '/firma/nastaveni/lide', popisek: 'Otevřít Lidi' }, vedlejsi: null, odebrat: false, napoveda: null })
}

/* =====================================================================
   2. OKNO — skutečná komponenta
   ================================================================== */

console.log('\n== 2. Okno „čeká na oprávnění" ==')
const htmlOkna = renderToStaticMarkup(createElement(Okno, { rozsah: 'firma', lide: CEKAJICI }))
{
  ma('okno se vykreslilo (jinak by zbytek nic neměřil)', htmlOkna.includes('role="dialog"'), true)
  ma('nadpis počítá čtyři lidi', htmlOkna.includes('4 lidé čekají na oprávnění'), true)
  ma('nikde „Nový člověk"', htmlOkna.includes('Nový člověk'), false)
  ma('nikde stará adresa ?clovek=', htmlOkna.includes('clovek='), false)
  /*
    Na telefonu okno přeteklo (kontrola 28. 9. 2026): položka mřížky se
    bez `minmax(0, …)` a `min-width:0` nezúží pod šířku obsahu a dlouhý
    e-mail ji roztáhne. Rozměry ověřuje snímek na 375 px; tohle hlídá,
    aby oprava potichu nezmizela.
  */
  ma('okno se na úzké obrazovce smí zúžit (minmax(0, …), min-width:0)',
    [/grid-template-columns:minmax\(0, 560px\)/.test(htmlOkna),
      /role="dialog"[^>]*><div style="[^"]*min-width:0/.test(htmlOkna)],
    [true, true])

  const kata = radek(htmlOkna, U_KATA)
  ma('Kateřina (bez záznamu): jméno je e-mail účtu, dvakrát se nepíše',
    (kata.match(/katarinajiraskova4@gmail\.com/g) ?? []).length, 1)
  ma('… důvod česky', kata.includes('Účet není propojený s nikým v Lidech.'), true)
  ma('… nabídne Odebrat z firmy — jen tlačítko, které se ZEPTÁ (žádný formulář, nic k odeslání)',
    [tlacitkaV(kata), /<form\b/.test(kata)],
    [[{ typ: 'button', text: 'Odebrat z firmy' }], false])
  ma('… a jediný odkaz: formulář pozvánky v Lidech',
    odkazy(kata), [{ href: '/firma/nastaveni/lide?pozvat=1#pozvanka', text: 'Pozvat z Lidí' }])
  ma('v celém okně žádné odesílací tlačítko (odebrat jedním ťuknutím nejde)',
    /type="submit"/.test(htmlOkna), false)

  /*
    Druhý krok. Bez prohlížeče se na tlačítko ťuknout nedá — komponenta
    se proto vykreslí rovnou s otázkou (`ptaSeNaZacatku`, jako CestaVen).
  */
  const dotaz = renderToStaticMarkup(createElement(OdebratZFirmy, {
    ucet: U_KATA, jmeno: 'katarinajiraskova4@gmail.com', ptaSeNaZacatku: true,
  }))
  ma('otázka: odešle až „Opravdu odebrat" ve formuláři s id účtu, vedle „Zpět"',
    [/<form\b[\s\S]*<button type="submit"[^>]*>Opravdu odebrat<\/button>/.test(dotaz),
      dotaz.includes(`name="ucet" value="${U_KATA}"`),
      tlacitkaV(dotaz).find((t) => t.text === 'Zpět')?.typ],
    [true, true, 'button'])
  /*
    Kontrola 28. 9. 2026: na tlačítku stálo „Opravdu odebrat <celý
    e-mail>" a na telefonu přeteklo z okna i ze stránky. Jméno patří do
    věty, která se zalomí.
  */
  ma('… jméno ve větě pod tlačítkem, na tlačítku ne',
    [tlacitkaV(dotaz).find((t) => t.typ === 'submit')?.text,
      /<p[^>]*>katarinajiraskova4@gmail\.com přestane do firmy vidět/.test(dotaz)],
    ['Opravdu odebrat', true])

  const lada = radek(htmlOkna, U_LADA)
  ma('Láďa (smazaný): jméno, kontakt, důvod a Odebrat z firmy',
    [lada.includes('Láďa'), lada.includes('lada@example.cz'),
      lada.includes('Záznam v Lidech je smazaný.'), lada.includes('Odebrat z firmy')],
    [true, true, true, true])

  const nova = radek(htmlOkna, U_NOVA)
  ma('Nová (bez zařazení): tlačítko vede na JEJÍ oprávnění v Lidech',
    odkazy(nova), [{ href: `/firma/nastaveni/lide?opravneni=${E_NOVA}#opravneni`, text: 'Přidělit oprávnění' }])
  ma('… a pod jménem e-mail', nova.includes('nova@example.cz'), true)

  const vendy = radek(htmlOkna, U_VENDY)
  ma('Vendy (zařazení bez práv): nejdřív zařazení, vedle oprávnění člověka',
    odkazy(vendy), [
      { href: `/firma/nastaveni/role#zarazeni-${P_OBSLUHA}`, text: 'Nastavit zařazení Obsluha brig.' },
      { href: `/firma/nastaveni/lide?opravneni=${E_VENDY}#opravneni`, text: 'Oprávnění člověka' },
    ])
  ma('… důvod s názvem zařazení', vendy.includes('Zařazení Obsluha brig. zatím nemá žádná oprávnění.'), true)
  ma('… Vendy odebrat z firmy nejde (má živý záznam)', vendy.includes('Odebrat z firmy'), false)
}

/* =====================================================================
   3. ODKAZ Z OKNA OPRAVDU ROZBALÍ PANEL V LIDECH
   ================================================================== */

console.log('\n== 3. Odkaz z okna → Lidé ==')
{
  for (const [ucet, zamestnanec, jmeno, text] of [
    [U_NOVA, E_NOVA, 'Nová Posila', 'Přidělit oprávnění'],
    [U_VENDY, E_VENDY, 'Vendy', 'Oprávnění člověka'],
  ]) {
    svet(U_MAJITEL)
    const odkaz = odkazy(radek(htmlOkna, ucet)).find((o) => o.text === text)
    ma(`${jmeno}: odkaz se v okně našel`, Boolean(odkaz), true)
    const html = await vykreslitStranku(StrankaLide, 'firma', parametry(odkaz?.href ?? '/'))
    const panel = html.match(/<section id="opravneni"[\s\S]*?<\/section>/)?.[0] ?? ''
    ma(`${jmeno}: Lidé rozbalí panel oprávnění`, panel.length > 0, true)
    ma(`${jmeno}: … právě toho člověka (jméno i id ve formuláři)`,
      panel.includes(jmeno) && panel.includes(`name="zamestnanec" value="${zamestnanec}"`), true)
    ma(`${jmeno}: odkaz nese kotvu panelu`, odkaz?.href.endsWith('#opravneni'), true)
  }

  // „Nastavit zařazení": kotva, na kterou odkaz míří, na obrazovce
  // Zařazení opravdu je.
  svet(U_MAJITEL)
  const odkazZarazeni = odkazy(radek(htmlOkna, U_VENDY)).find((o) => o.text.startsWith('Nastavit zařazení'))
  const kotva = odkazZarazeni?.href.split('#')[1] ?? '(žádná)'
  const role = await vykreslitStranku(StrankaRole, 'firma')
  ma('Vendy: kotva zařazení z okna na obrazovce Zařazení je (a u Obsluhy)',
    new RegExp(`<li[^>]*id="${kotva}"[\\s\\S]*?Obsluha brig\\.`).test(role), true)

  /*
    „Pozvat z Lidí" u účtu bez záznamu: odkaz z okna → skutečná stránka
    Lidé → formulář pozvánky (skutečná komponenta) je ROZBALENÝ a má
    kotvu, na kterou odkaz míří. Sbalený by pod tabulkou nikdo nenašel.
  */
  svet(U_MAJITEL)
  const pozvat = odkazy(radek(htmlOkna, U_KATA)).find((o) => o.text === 'Pozvat z Lidí')
  const sPozvankou = await vykreslitStranku(StrankaLide, 'firma', parametry(pozvat?.href ?? '/'))
  const panelPozvanky = (h) => h.match(/<div[^>]*id="pozvanka"[\s\S]*$/)?.[0] ?? ''
  ma('Kateřina: z okna na formulář pozvánky — kotva na stránce je a formulář je rozbalený',
    [pozvat?.href.split('#')[1], panelPozvanky(sPozvankou).length > 0,
      /<select name="zamestnanec"/.test(panelPozvanky(sPozvankou))],
    ['pozvanka', true, true])
  svet(U_MAJITEL)
  const bezPozvat = await vykreslitStranku(StrankaLide, 'firma')
  ma('… bez ?pozvat=1 zůstane formulář sbalený (jinak by kontrola výš nic neměřila)',
    [panelPozvanky(bezPozvat).length > 0, /<select name="zamestnanec"/.test(panelPozvanky(bezPozvat))],
    [true, false])

  // Tak to bylo do 25. 9.: adresa podle ÚČTU panel neotevře. Kdyby
  // tohle začalo procházet, kontrola výš by ztratila smysl.
  svet(U_MAJITEL)
  const stara = await vykreslitStranku(StrankaLide, 'firma', { clovek: U_VENDY })
  ma('stará adresa ?clovek=<účet> panel neotevře (proto se nesmí vrátit)',
    stara.includes('<section id="opravneni"'), false)
}

/* =====================================================================
   4. LIDÉ — karta čekajících a podklad pro pozvánku
   ================================================================== */

console.log('\n== 4. Lidé: karta čekajících, účty pro pozvánku ==')
{
  svet(U_MAJITEL)
  const html = await vykreslitStranku(StrankaLide, 'firma')
  const karta = html.match(/<section id="cekaji"[\s\S]*?<\/section>/)?.[0] ?? ''
  ma('karta čekajících má kotvu #cekaji (vede na ni upozornění)', karta.length > 0, true)
  ma('… a jsou v ní všichni čtyři', [U_KATA, U_LADA, U_NOVA, U_VENDY].every((u) => karta.includes(`data-ucet="${u}"`)), true)

  svet(U_CISNIK)
  const bez = await vykreslitStranku(StrankaLide, 'firma').catch(() => '')
  ma('bez správy lidí se Lidé ani karta neukážou', bez.includes('id="cekaji"'), false)

  svet(U_MAJITEL)
  await vykreslitStranku(StrankaLideZachyt, 'firma')
  const v = globalThis.__ceka.vystaveni
  const petr = v?.zamestnanci?.find((z) => z.id === E_PETR)
  ma('pozvánka dostane u Petra: má účet a jaký (zamaskovaně)', [petr?.maUcet, petr?.ucet], [true, 'p***@example.cz'])
  ma('… u majitele, že je majitel', v?.zamestnanci?.find((z) => z.id === E_MAJITEL)?.jeMajitel, true)
  ma('… majiteli, že přesun smí', v?.jsemMajitel, true)
  ma('… smazaný člověk mezi zvanými není', v?.zamestnanci?.some((z) => z.id === E_LADA), false)

  svet(U_VEDOUCI)
  await vykreslitStranku(StrankaLideZachyt, 'firma')
  ma('vedoucímu, že přesun nesmí', globalThis.__ceka.vystaveni?.jsemMajitel, false)
}

/* =====================================================================
   4b. LIDÉ — čekající pozvánky a jejich zrušení
   ================================================================== */

console.log('\n== 4b. Lidé: čekající pozvánky ==')
{
  const kartaPozvanek = (html) => html.match(/<section id="pozvanky"[\s\S]*?<\/section>/)?.[0] ?? ''
  const radekPozvanky = (html, id) =>
    html.match(new RegExp(`<li[^>]*data-pozvanka="${id}"[^>]*>([\\s\\S]*?)</li>`))?.[1] ?? ''

  svet(U_MAJITEL)
  const karta = kartaPozvanek(await vykreslitStranku(StrankaLide, 'firma'))
  ma('karta čekajících pozvánek je (jinak by zbytek nic neměřil)', karta.length > 0, true)
  ma('… jen čekající: obyčejná, přesun a pro smazaného — přijatá, zrušená ani prošlá ne',
    [...karta.matchAll(/data-pozvanka="([^"]+)"/g)].map((m) => m[1]).sort(),
    [I_NOVA, I_PRESUN, I_LADA].sort())
  ma('… u přesunu, že je to přesun, a celá adresa (kvůli překlepu)',
    [/Přesun účtu/.test(radekPozvanky(karta, I_PRESUN)), radekPozvanky(karta, I_PRESUN).includes('petr.novy@example.cz'),
      /Přesun účtu/.test(radekPozvanky(karta, I_NOVA))],
    [true, true, false])
  ma('… u pozvánky pro smazaného člověka, že je smazaný',
    radekPozvanky(karta, I_LADA).includes('Láďa (v Lidech smazaný)'), true)
  ma('majitel: u každé „Zrušit", které se jen ZEPTÁ (nic k odeslání)',
    [tlacitkaV(karta).map((t) => `${t.typ}:${t.text}`), /<form\b/.test(karta)],
    [['button:Zrušit', 'button:Zrušit', 'button:Zrušit'], false])

  svet(U_VEDOUCI)
  const kartaVed = kartaPozvanek(await vykreslitStranku(StrankaLide, 'firma'))
  ma('vedoucí: přesun bez tlačítka a s větou, že ho zruší jen majitel; obyčejnou zrušit smí',
    [tlacitkaV(radekPozvanky(kartaVed, I_PRESUN)).length, /zruší jen majitel/.test(radekPozvanky(kartaVed, I_PRESUN)),
      tlacitkaV(radekPozvanky(kartaVed, I_NOVA)).map((t) => t.text)],
    [0, true, ['Zrušit']])

  svet(U_MAJITEL)
  globalThis.__ceka.db.invitations = []
  const bez = await vykreslitStranku(StrankaLide, 'firma')
  ma('bez čekajících pozvánek se karta neukáže', kartaPozvanek(bez).length, 0)

  const dotaz = renderToStaticMarkup(createElement(ZrusitPozvanku, {
    id: I_NOVA, kontakt: 'nova@example.cz', ptaSeNaZacatku: true,
  }))
  ma('otázka: odešle až „Opravdu zrušit" s id pozvánky, vedle „Zpět", věta s adresou',
    [/<form\b[\s\S]*<button type="submit"[^>]*>Opravdu zrušit<\/button>/.test(dotaz),
      dotaz.includes(`name="pozvanka" value="${I_NOVA}"`),
      tlacitkaV(dotaz).find((t) => t.text === 'Zpět')?.typ,
      dotaz.includes('Odkaz v pozvánce na nova@example.cz přestane platit')],
    [true, true, 'button', true])

  const db = svet(U_VEDOUCI)
  const fd = new FormData()
  fd.append('pozvanka', I_NOVA)
  const v = await akcePozvanek.zrusitPozvanku({ stav: 'nic' }, fd)
  ma('akce Zrušit (vedoucí): hotovo, zavolá zrusit_pozvanku s naší firmou a tou pozvánkou',
    [v, db.rpcVolani.filter((x) => x.jmeno === 'zrusit_pozvanku').map((x) => x.a)],
    [{ stav: 'hotovo' }, [{ p_tenant: T, p_pozvanka: I_NOVA }]])
  ma('… pozvánka je zrušená a rám se obnoví',
    [Boolean(db.invitations.find((p) => p.id === I_NOVA)?.revoked_at),
      globalThis.__ceka.revalidace.some((a) => a[0] === '/' && a[1] === 'layout')],
    [true, true])

  const cisnik = svet(U_CISNIK)
  const v2 = await akcePozvanek.zrusitPozvanku({ stav: 'nic' }, fd)
  ma('bez správy lidí: věta, ne volání databáze',
    [v2.stav, cisnik.rpcVolani.some((x) => x.jmeno === 'zrusit_pozvanku')], ['chyba', false])
}

/* =====================================================================
   5. VĚTA U POZVÁNKY PRO ČLOVĚKA S ÚČTEM
   ================================================================== */

console.log('\n== 5. Pozvánka pro člověka, který už účet má ==')
{
  const v = (clovek, jsemMajitel) => renderToStaticMarkup(createElement(PoznamkaKUctu, { clovek, jsemMajitel }))
  const petr = { id: E_PETR, full_name: 'Petr Číšník', branch_id: null, maUcet: true, ucet: 'p***@example.cz', jeMajitel: false }
  ma('bez účtu se nic neříká', v({ ...petr, maUcet: false, ucet: null }, true), '')
  ma('nikdo nevybraný: nic', v(null, true), '')
  const majitel = v(petr, true)
  ma('majitel: přesune přístup, starý účet se odpojí, účet zamaskovaně',
    /přesune/.test(majitel) && /starý účet\s+se od firmy odpojí/.test(majitel) && majitel.includes('(p***@example.cz)'), true)
  const vedouci = v(petr, false)
  ma('vedoucí: přesun může jen majitel, tutéž adresu smí',
    /může jen\s+majitel/.test(vedouci) && /tutéž adresu/.test(vedouci), true)
  const naMajitele = v({ ...petr, jeMajitel: true }, true)
  /*
    Moje údaje mění kontakt v Lidech, ne přihlašovací adresu účtu —
    posílat tam majitele by byla nepravda (kontrola 28. 9. 2026).
  */
  ma('u majitele: pozvánkou ne, adresu změní správce — do Mých údajů neposílá',
    [/nepřesouvá/.test(naMajitele), /správce Foodtabu/.test(naMajitele), /Mých údajích/.test(naMajitele),
      /přesune/.test(naMajitele)],
    [true, true, false, false])
}

/* =====================================================================
   6. UPOZORNĚNÍ „PŘIJAL POZVÁNKU A ČEKÁ"
   ================================================================== */

console.log('\n== 6. Upozornění ==')
{
  const db = svet(U_MAJITEL)
  const zprava = (id, kdo, jmeno) => ({
    id, tenant_id: T, user_id: U_MAJITEL, druh: 'pozvanka.prijata', read_at: null,
    acknowledged_at: null, shift_id: null, priorita: 'normal', created_at: `2026-09-25T0${id}:00:00Z`,
    telo: { jmeno, kdo, ceka: true, role: null, pobocky: [] },
  })
  db.notifications.push(zprava('1', U_VENDY, 'info@cerna-perla.cz'), zprava('2', U_KATA, 'katarinajiraskova4@gmail.com'),
    zprava('3', U_LADA, 'Láďa'))
  const html = await vykreslitStranku(StrankaUpozorneni, 'firma')
  const tlacitka = odkazy(html).filter((o) => ['Přidělit oprávnění', 'Otevřít v Lidech'].includes(o.text))
  ma('tři tlačítka u tří zpráv (jinak by zbytek nic neměřil)', tlacitka.length, 3)
  ma('Vendy: „Přidělit oprávnění" rovnou na její oprávnění v Lidech',
    tlacitka.filter((o) => o.text === 'Přidělit oprávnění').map((o) => o.href),
    [`/firma/nastaveni/lide?opravneni=${E_VENDY}#opravneni`])
  /*
    Bez živého záznamu vede odkaz na kartu čekajících, kde oprávnění
    přidělit nejde — popisek to nesmí slibovat (kontrola 28. 9. 2026).
  */
  ma('Kateřina bez záznamu a Láďa se smazaným: „Otevřít v Lidech" na kartu čekajících',
    tlacitka.filter((o) => o.text === 'Otevřít v Lidech').map((o) => o.href),
    ['/firma/nastaveni/lide#cekaji', '/firma/nastaveni/lide#cekaji'])
  ma('… plná výška dotykového cíle (ne ft-tl-male)',
    [...html.matchAll(/<a\b([^>]*)>(Přidělit oprávnění|Otevřít v Lidech)<\/a>/g)]
      .map((m) => /ft-tl-male/.test(m[1])), [false, false, false])
  ma('nikde stará adresa ?clovek=', html.includes('clovek='), false)
}

/* =====================================================================
   7. ODEBRAT Z FIRMY — serverová akce
   ================================================================== */

console.log('\n== 7. Odebrat z firmy ==')
{
  const db = svet(U_MAJITEL)
  const fd = new FormData()
  fd.append('ucet', U_KATA)
  const v = await akceCekani.odebratZFirmy({ stav: 'nic' }, fd)
  ma('majitel: hotovo', v, { stav: 'hotovo' })
  ma('… zavolalo odebrat_z_firmy s naší firmou a tím účtem',
    db.rpcVolani.filter((x) => x.jmeno === 'odebrat_z_firmy').map((x) => x.a), [{ p_tenant: T, p_user: U_KATA }])
  ma('… a rám se obnoví (seznam čekajících z dat)',
    globalThis.__ceka.revalidace.some((a) => a[0] === '/' && a[1] === 'layout'), true)

  const cisnik = svet(U_CISNIK)
  const v2 = await akceCekani.odebratZFirmy({ stav: 'nic' }, fd)
  ma('bez správy lidí: věta, ne volání databáze',
    [v2.stav, cisnik.rpcVolani.some((x) => x.jmeno === 'odebrat_z_firmy')], ['chyba', false])
}

/* =====================================================================
   8. POZVÁNKA PRO ČLOVĚKA S JINÝM ÚČTEM

   Hlášku píše databáze (20260925150000, přijetí) a obrazovka ji pozná
   podle věty. Věta se proto bere PŘÍMO Z MIGRACE — kdyby ji někdo
   v SQL přepsal, obrazovka by tiše přestala nabízet cestu ven.
   ================================================================== */

console.log('\n== 8. Pozvánka: člověk už má jiný účet ==')
{
  const fs = await import('node:fs')
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260925150000_pozvanka_druhy_ucet.sql', import.meta.url), 'utf8')
  // Oslovuje pozvaného (je to on sám), ne „tenhle člověk" (kontrola 28. 9. 2026).
  const sablona = sql.match(/'(V téhle firmě už máte jiný účet \(%\)[^']*)'/)?.[1] ?? ''
  ma('věta se v migraci našla (jinak by kontrola nic neměřila)', sablona.length > 0, true)
  const hlaska = sablona.replace('%', 'k***@email.cz')
  ma('obrazovka větu z databáze pozná', prihlaseni.jeJinyUcet(hlaska), true)
  ma('… a jinou chybu za ni nevydává', prihlaseni.jeJinyUcet('Pozvánka byla vystavena na jinou e-mailovou adresu.'), false)

  const db = svet(U_KATA)
  db.chybaPrijeti = hlaska
  const v = await akcePozvanky.prijmoutPozvankuAction('token')
  ma('přijetí odkazem vrátí větu z databáze a příznak „jiný účet"',
    [v.chyba, v.jinyUcet, v.jinaAdresa], [hlaska, true, false])

  db.chybaPrijeti = 'Pozvánka byla vystavena na jinou e-mailovou adresu.'
  const v2 = await akcePozvanky.prijmoutPozvankuAction('token')
  ma('jiná adresa zůstává „jiná adresa", ne „jiný účet"', [v2.jinyUcet, v2.jinaAdresa], [false, true])

  /*
    Druhá cesta: člověk, který na adrese z pozvánky účet ještě NEMÁ,
    se přihlásí kódem a pozvánka se přijme rovnou (overitPrvniKod).
    Přesně tudy půjde stará čekající pozvánka na druhou adresu — po
    nasazení skončí „má jiný účet" a obrazovka musí nabídnout cestu ven.
  */
  const puvodniRpc = globalThis.__ceka.klient.rpc
  globalThis.__ceka.klient.rpc = async (jmeno, args) =>
    jmeno === 'pozvanka_info'
      ? { data: [{ kanal: 'email', kontakt: 'kata.nova@example.cz', stav: 'ok' }], error: null }
      : puvodniRpc(jmeno, args)
  globalThis.__ceka.klient.auth.verifyOtp = async () => ({ data: {}, error: null })
  db.chybaPrijeti = hlaska
  const v3 = await akcePozvanky.overitPrvniKod('token', '123456')
  ma('první přihlášení kódem: přihlášen, věta z databáze a příznak „jiný účet"',
    [v3.prihlasen, v3.chyba, v3.jinyUcet], [true, hlaska, true])
  db.chybaPrijeti = 'Pozvánce vypršela platnost. Požádejte o novou.'
  const v4 = await akcePozvanky.overitPrvniKod('token', '123456')
  ma('… jiná chyba přijetí příznak nenese', v4.jinyUcet, false)
  globalThis.__ceka.klient.rpc = puvodniRpc

  const html = renderToStaticMarkup(createElement(jinyUcet.default, { hlaska }))
  ma('okénko ukáže větu i s maskou účtu a nabídne odhlášení',
    html.includes('k***@email.cz') && /<button[^>]*>Odhlásit se a přihlásit tím účtem<\/button>/.test(html), true)

  // Tlačítko volá tuhle akci: odhlásí jen tenhle prohlížeč.
  const odhlaseni = []
  globalThis.__ceka.klient.auth.signOut = async (o) => { odhlaseni.push(o) }
  ma('přepnutí na jiný účet odhlásí (jen tenhle prohlížeč)',
    [await akcePozvanky.prepnoutNaJinyUcet(), odhlaseni], [{ ok: true }, [{ scope: 'local' }]])

  /*
    Kdy se okénko ukáže, rozhoduje stav po kliknutí — ten se mimo
    prohlížeč nevykreslí. Hlídá se aspoň, že obě cesty přijetí (odkaz
    i první přihlášení kódem) příznak čtou a okénko kreslí.
  */
  for (const soubor of ['prijeti.tsx', 'prvni-prihlaseni.tsx']) {
    const zdroj = fs.readFileSync(new URL(`../app/pozvanka/[token]/${soubor}`, import.meta.url), 'utf8')
    ma(`${soubor}: čte příznak jinyUcet a kreslí <JinyUcet>`,
      /v\.jinyUcet === true/.test(zdroj) && /<JinyUcet hlaska=\{chyba\} \/>/.test(zdroj), true)
  }
}

/* =====================================================================
   9. CESTA VEN ZE SDĚLENÍ MIMO RÁM (kontrola #85)

   Kdo se přihlásí špatným účtem — Kateřina přes druhou adresu —,
   skončí na sdělení, které se kreslí MIMO rám aplikace, a tedy bez
   menu s odhlášením. Každé takové sdělení musí mít cestu ven.
   ================================================================== */

console.log('\n== 9. Cesta ven ze sdělení mimo rám ==')
{
  const U_NIKDO = 'd0000000-0000-4000-8000-000000000099'
  const tlacitka = (html) =>
    [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
      typ: m[1].match(/type="([^"]*)"/)?.[1] ?? '(žádný)',
      text: dekodovat(m[2].replace(/<[^>]+>/g, '')).trim(),
    }))

  const klid = renderToStaticMarkup(createElement(CestaVen, {}))
  ma('cesta ven: tlačítko „Odhlásit se", které jen ZEPTÁ (type=button, žádný formulář)',
    [tlacitka(klid), /<form\b/.test(klid)], [[{ typ: 'button', text: 'Odhlásit se' }], false])
  ma('… bez firmy žádný odkaz na Moje údaje (vedly by zase sem)', odkazy(klid).length, 0)

  const sUdaji = renderToStaticMarkup(createElement(CestaVen, { mojeUdaje: true }))
  ma('… s firmou i Moje údaje', odkazy(sUdaji), [{ href: '/moje-udaje', text: 'Moje údaje' }])

  /*
    Rada „přihlásili jste se jinou adresou, než na kterou přišla
    pozvánka?" jen tam, kde to může být příčina (kontrola 28. 9. 2026).
  */
  const sRadou = renderToStaticMarkup(createElement(CestaVen, { jinaAdresa: true }))
  ma('rada o jiné adrese jen na požádání, bez věty o kódu z e-mailu',
    [/jinou adresou/.test(klid), /jinou adresou/.test(sRadou), /Příště/.test(sRadou)],
    [false, true, false])

  const dotaz = renderToStaticMarkup(createElement(CestaVen, { ptaSeNaZacatku: true }))
  ma('dotaz: „Odhlásit se?", odhlásí až formulář, vedle „Zpět"',
    [dotaz.includes('Odhlásit se?'), /<form\b[\s\S]*?<button type="submit"[^>]*>Odhlásit<\/button>[\s\S]*?<\/form>/.test(dotaz),
      tlacitka(dotaz).find((t) => t.text === 'Zpět')?.typ],
    [true, true, 'button'])

  const zdrojCesty = (await import('node:fs')).readFileSync(new URL('../app/cesta-ven.tsx', import.meta.url), 'utf8')
  ma('formulář odhlašuje akcí z přihlášení (ne vlastní kopií)',
    /import \{ odhlasit \} from '@\/app\/prihlaseni\/akce'/.test(zdrojCesty) && /<form action=\{odhlasit\}/.test(zdrojCesty), true)

  // Sdělení: cesta ven POD větou, ne v ní (věta je <p>).
  const sdeleni = renderToStaticMarkup(createElement(Sdeleni, {
    samostatne: true, nadpis: 'Účet zatím nepatří k žádné firmě', pata: createElement(CestaVen, {}),
  }, 'Věta.'))
  ma('Sdělení vykreslí cestu ven pod větou (ne uvnitř <p>)',
    /<p[^>]*>Věta\.<\/p><div data-cesta-ven=""/.test(sdeleni), true)

  // Skutečné stránky mimo rám.
  svet(U_NIKDO)
  const uvod = renderToStaticMarkup(await StrankaUvod())
  ma('úvod (/) bez firmy: sdělení s cestou ven i radou o jiné adrese',
    [uvod.includes('Účet zatím nepatří k žádné firmě'), uvod.includes('data-cesta-ven'), odkazy(uvod).length,
      /jinou adresou/.test(uvod)], [true, true, 0, true])

  svet(U_NIKDO)
  const bezFirmy = renderToStaticMarkup(await StrankaBezOpravneni())
  ma('/zatim-bez-opravneni bez firmy: sdělení s cestou ven',
    [bezFirmy.includes('Účet zatím nepatří k žádné firmě'), bezFirmy.includes('data-cesta-ven')], [true, true])

  // Druhý Kateřinin účet: člen firmy bez záznamu v Lidech.
  svet(U_KATA)
  const hotovy = renderToStaticMarkup(await StrankaBezOpravneni())
  ma('/zatim-bez-opravneni pro člena bez práv (druhý účet): Moje údaje I odhlášení',
    [hotovy.includes('Účet je hotový'), odkazy(hotovy).some((o) => o.href === '/moje-udaje'),
      tlacitka(hotovy).some((t) => t.text === 'Odhlásit se')], [true, true, true])
  ma('… bez čekající pozvánky žádná karta pozvánky', hotovy.includes('data-cekajici-pozvanka'), false)

  /*
    Druhý účet s čekající pozvánkou (přesun od majitele). Dřív se
    pozvánky hledaly jen u účtu BEZ firmy — člen firmy bez práv o ní
    nevěděl a přijmout šla jen z e-mailu (kontrola 28. 9. 2026).
  */
  const dbKata = svet(U_KATA)
  dbKata.mojePozvanky = [{ invitation_id: 'i-presun', tenant_id: T, firma: 'Černá Perla', kanal: 'email', expires_at: ZITRA }]
  const sPozvankou = renderToStaticMarkup(await StrankaBezOpravneni())
  ma('/zatim-bez-opravneni pro člena bez práv s čekající pozvánkou: nabídne ji přijmout',
    [sPozvankou.includes('Čeká na vás pozvánka do firmy Černá Perla'),
      tlacitka(sPozvankou).find((t) => t.text === 'Přijmout pozvánku')?.typ,
      sPozvankou.includes('name="pozvanka" value="i-presun"')],
    [true, 'submit', true])
  // vzhled-zadani.md, oddíl 11: hlavní (zlaté) tlačítko jen jedno na kartu.
  ma('… zlaté tlačítko jen jedno — Přijmout; Moje údaje ustoupí',
    [(sPozvankou.match(/ft-tl-hlavni/g) ?? []).length, (hotovy.match(/ft-tl-hlavni/g) ?? []).length], [1, 1])
  ma('… a „Účet je hotový", Moje údaje i odhlášení zůstanou',
    [sPozvankou.includes('Účet je hotový'), odkazy(sPozvankou).some((o) => o.href === '/moje-udaje'),
      tlacitka(sPozvankou).some((t) => t.text === 'Odhlásit se')], [true, true, true])

  const db = svet(U_NIKDO)
  db.mojePozvanky = [{ invitation_id: 'i1', tenant_id: T, firma: 'Černá Perla', kanal: 'email', expires_at: '2026-10-02T00:00:00Z' }]
  const pozvanka = renderToStaticMarkup(await StrankaUvod())
  ma('čekající pozvánka: přijmout, a vedle cesta ven (přijetí může skončit „už máte jiný účet")',
    [pozvanka.includes('Máte čekající pozvánku do firmy Černá Perla'),
      tlacitka(pozvanka).map((t) => t.text), /jinou adresou/.test(pozvanka)],
    [true, ['Přijmout pozvánku', 'Odhlásit se'], true])
  ma('… bez odkazu na Moje údaje (bez firmy vedou sem)', odkazy(pozvanka).length, 0)

  /*
    Rám rozsahu (app/[rozsah]/layout.tsx) se mimo Next nevykreslí —
    táhne celý AppShell. Hlídá se aspoň text: KAŽDÉ samostatné sdělení
    ve třech souborech má cestu ven, Moje údaje jen tam, kde firma je.
    Počty jsou pevné — kdyby se vyříznutí nepovedlo, nesmí to projít
    jako „nic nechybí".
  */
  const fs = await import('node:fs')
  for (const [soubor, cekam] of [
    // [nadpis, Moje údaje, rada o jiné adrese]
    ['app/[rozsah]/layout.tsx', [['Účet zatím nepatří k žádné firmě', false, true], ['Firmu se nepodařilo načíst', false, false], ['Sem nemáte přístup', true, false]]],
    ['app/page.tsx', [['Účet zatím nepatří k žádné firmě', false, true], ['Firmu se nepodařilo načíst', false, false], ['Není kam vás pustit', true, false]]],
    ['app/zatim-bez-opravneni/page.tsx', [['Účet zatím nepatří k žádné firmě', false, true]]],
  ]) {
    const zdroj = fs.readFileSync(new URL(`../${soubor}`, import.meta.url), 'utf8')
    // Celá značka na jednom řádku; `pata={<CestaVen />}` má vlastní `>`.
    const znacky = [...zdroj.matchAll(/<Sdeleni samostatne(.*)>\s*$/gm)].map((m) => ({
      nadpis: m[1].match(/nadpis="([^"]*)"/)?.[1],
      udaje: /pata=\{<CestaVen[^}]* mojeUdaje[ /]/.test(m[1]),
      rada: /pata=\{<CestaVen[^}]* jinaAdresa[ /]/.test(m[1]),
      cesta: /pata=\{<CestaVen( mojeUdaje| jinaAdresa)* \/>\}/.test(m[1]),
    }))
    ma(`${soubor}: každé samostatné sdělení má cestu ven, Moje údaje jen s firmou, radu jen bez firmy`,
      znacky, cekam.map(([nadpis, udaje, rada]) => ({ nadpis, udaje, rada, cesta: true })))
  }
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
