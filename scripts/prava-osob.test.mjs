#!/usr/bin/env node
/**
 * Přidělování práv lidem a zařazením — Nastavení → Lidé a → Zařazení.
 *
 * Pusť `node scripts/prava-osob.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TO VZNIKLO
 *
 * Hlášení majitele 24. 9. 2026: „nefunguje přiřazování práv k osobám".
 * V ostré databázi byla `employee_permissions` prázdná a v logu za den
 * ani jeden zápis do `employee_permissions` ani `position_permissions`.
 *
 * Příčina: obě obrazovky i akce u člověka se ptaly
 * `hasAccess(firma, 'settings.manage', rozsah)` — a `rozsah` je KUS
 * ADRESY („firma", „cerna-perla"), ne id pobočky. Databáze na `'firma'`
 * jako uuid odpoví chybou 22P02, `hasAccess` chybu podle pravidla
 * „při nejistotě ne" přečte jako NE, a tak od 9. 9. 2026 nesměl práva
 * měnit NIKDO, majitele nevyjímaje. Zaškrtávátka byla zamčená
 * a pod nimi věta „Tady je vidíte, jak jsou" — i majiteli.
 *
 * ---------------------------------------------------------------------
 * JAK TO KONTROLA DĚLÁ
 *
 * Regex nad zdrojákem by prošel i nad tou chybou — `hasAccess` se tam
 * volalo, jen se špatným třetím parametrem. Tahle kontrola proto jde
 * celou cestou, kterou jde majitel:
 *
 *   skutečná stránka (page.tsx) → HTML → formulář tak, jak ho odešle
 *   prohlížeč (pole v zamčeném <fieldset> se NEODESÍLAJÍ) → skutečná
 *   serverová akce → podstrčená databáze → co se do ní zapsalo.
 *
 * `lib/authz.ts` a `lib/firma.ts` jsou SKUTEČNÉ. Podstrčený je jen
 * klient Supabase, a ten se chová jako PostgREST: id, které není uuid,
 * odmítne chybou 22P02 (přesně to se dělo naostro) a `has_access`
 * počítá podle stejného skládacího pravidla jako `app.has_access`
 * (výjimka u člověka → zařazení → majitel; rozsah z členství).
 *
 * CO TO NEOVĚŘÍ: politiky v databázi. Podstrčená databáze zapíše, co
 * dostane — o druhé linii rozhodují scénáře v supabase/tests (krok33,
 * krok43) proti opravdovému PostgreSQL. Tady se ověřuje PRVNÍ linie:
 * že aplikace k zápisu vůbec dojde, a že nepustí toho, koho nemá.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'

import { adresaModulu, nactiModul } from './vykreslit.mjs'

const KOREN = new URL('..', import.meta.url)

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
const B_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P_CISNIK = 'c1c1c1c1-0000-4000-8000-000000000001'
const P_VEDOUCI = 'c2c2c2c2-0000-4000-8000-000000000002'
const P_PROVOZNI = 'c3c3c3c3-0000-4000-8000-000000000003'

const U_MAJITEL = 'd0000000-0000-4000-8000-000000000001'
const U_PETR = 'd0000000-0000-4000-8000-000000000002'
const U_VEDOUCI = 'd0000000-0000-4000-8000-000000000003'
const U_PROVOZNI = 'd0000000-0000-4000-8000-000000000004'

const E_MAJITEL = 'e0000000-0000-4000-8000-000000000001'
const E_JANA = 'e0000000-0000-4000-8000-000000000002'
const E_PETR = 'e0000000-0000-4000-8000-000000000003'
const E_VEDOUCI = 'e0000000-0000-4000-8000-000000000004'
const E_PROVOZNI = 'e0000000-0000-4000-8000-000000000005'

const M_MAJITEL = 'f0000000-0000-4000-8000-000000000001'
const M_PETR = 'f0000000-0000-4000-8000-000000000002'
const M_VEDOUCI = 'f0000000-0000-4000-8000-000000000003'
const M_PROVOZNI = 'f0000000-0000-4000-8000-000000000004'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PRAVA = [
  ['shifts.read', 'Vidět rozpis směn'],
  ['shifts.manage', 'Plánovat směny'],
  ['attendance.read', 'Vidět docházku'],
  ['attendance.manage', 'Spravovat docházku'],
  ['people.manage', 'Spravovat lidi'],
  ['payroll.read', 'Vidět mzdy'],
  ['payroll.manage', 'Zadávat sazby'],
  ['advances.manage', 'Vydávat zálohy'],
  ['settings.manage', 'Spravovat nastavení firmy'],
]

function novySvet() {
  const pp = (pozice, klice) =>
    klice.map((k) => ({ id: crypto.randomUUID(), tenant_id: T, position_id: pozice, permission_key: k }))
  const zam = (id, jmeno, extra) => ({
    id, tenant_id: T, full_name: jmeno, position_id: null, branch_id: null, usek_id: null,
    user_id: null, employment_type: 'hpp', started_on: null, active: true, deleted_at: null,
    color: null, je_majitel: false, created_at: '2026-09-01T00:00:00Z', ...extra,
  })
  return {
    permissions: PRAVA.map(([key, label], i) => ({
      key, module_key: 'provoz', label, sort_order: i, sensitive: key.startsWith('payroll'),
    })),
    positions: [
      { id: P_CISNIK, tenant_id: T, key: 'cisnik', label: 'Číšník', active: true },
      { id: P_VEDOUCI, tenant_id: T, key: 'vedouci', label: 'Vedoucí', active: true },
      { id: P_PROVOZNI, tenant_id: T, key: 'provozni', label: 'Provozní', active: true },
    ],
    position_permissions: [
      ...pp(P_CISNIK, ['shifts.read', 'attendance.read']),
      ...pp(P_VEDOUCI, ['shifts.read', 'shifts.manage', 'attendance.read', 'people.manage']),
      ...pp(P_PROVOZNI, PRAVA.map(([k]) => k)),
    ],
    employee_permissions: [],
    employees: [
      // Majitel: bez pobočky a bez zařazení, rozsah celá firma (zadání).
      zam(E_MAJITEL, 'Marek Majitel', { user_id: U_MAJITEL, je_majitel: true }),
      zam(E_JANA, 'Jana Brigádnice', { position_id: P_CISNIK, branch_id: B_A }),
      zam(E_PETR, 'Petr Číšník', { position_id: P_CISNIK, branch_id: B_A, user_id: U_PETR }),
      zam(E_VEDOUCI, 'Věra Vedoucí', { position_id: P_VEDOUCI, user_id: U_VEDOUCI }),
      zam(E_PROVOZNI, 'Pavel Provozní', { position_id: P_PROVOZNI, branch_id: B_A, user_id: U_PROVOZNI }),
    ],
    memberships: [
      { id: M_MAJITEL, tenant_id: T, user_id: U_MAJITEL, scope: 'tenant', status: 'active' },
      { id: M_PETR, tenant_id: T, user_id: U_PETR, scope: 'branch', status: 'active' },
      { id: M_VEDOUCI, tenant_id: T, user_id: U_VEDOUCI, scope: 'tenant', status: 'active' },
      // Provozní jedné pobočky: settings.manage MÁ, ale jen na Centru.
      { id: M_PROVOZNI, tenant_id: T, user_id: U_PROVOZNI, scope: 'branch', status: 'active' },
    ],
    membership_branches: [
      { membership_id: M_PETR, branch_id: B_A },
      { membership_id: M_PROVOZNI, branch_id: B_A },
    ],
    branches: [
      { id: B_A, tenant_id: T, name: 'Centrum', slug: 'centrum', color: 'amber' },
      { id: B_B, tenant_id: T, name: 'Nádraží', slug: 'nadrazi', color: 'teal' },
    ],
    useky: [],
    employee_pins: [],
    /** Každý pokus o zápis, i ten, který by politika odmítla. */
    zapisy: [],
    maily: [],
    prihlaseny: null,
  }
}

/** Skládací pravidlo z `app.ma_pravo_clovek`: výjimka → zařazení; majitel vše. */
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

const neniUuid = (hodnota) => ({
  data: null,
  error: { code: '22P02', message: `invalid input syntax for type uuid: "${hodnota}"`, details: null, hint: null },
})

function rpc(db, jmeno, a) {
  const { m, e } = kdoJsem(db)
  if (jmeno === 'has_access') {
    // Jako PostgREST: parametr typu uuid, který uuid není, spadne dřív,
    // než se funkce vůbec spustí.
    if (!UUID.test(String(a.p_tenant))) return neniUuid(a.p_tenant)
    if (a.p_branch != null && !UUID.test(String(a.p_branch))) return neniUuid(a.p_branch)
    if (!m || !e || a.p_tenant !== T) return { data: false, error: null }
    if (!db.permissions.some((p) => p.key === a.p_permission)) return { data: false, error: null }
    if (!maPravo(db, e, a.p_permission)) return { data: false, error: null }
    if (m.scope === 'tenant') return { data: true, error: null }
    const naPobocce = a.p_branch != null &&
      db.membership_branches.some((x) => x.membership_id === m.id && x.branch_id === a.p_branch)
    return { data: naPobocce, error: null }
  }
  if (jmeno === 'my_tenants') {
    if (!m) return { data: [], error: null }
    return {
      data: [{ tenant_id: T, name: 'Černá Perla', role_key: '', role_label: '', is_owner: !!e?.je_majitel, scope: m.scope }],
      error: null,
    }
  }
  if (jmeno === 'my_context') {
    if (!m || !e) return { data: null, error: null }
    const vidi = m.scope === 'tenant'
      ? db.branches
      : db.branches.filter((b) => db.membership_branches.some((x) => x.membership_id === m.id && x.branch_id === b.id))
    return {
      data: {
        tenant: { id: T, name: 'Černá Perla', currency: 'CZK', timezone: 'Europe/Prague' },
        membership: { scope: m.scope, status: m.status },
        zarazeni: null,
        jeMajitel: e.je_majitel,
        modules: [{ key: 'provoz', label: 'Provoz', isBase: true, active: true }],
        branches: vidi.map(({ id, name, slug, color }) => ({ id, name, slug, color })),
        permissions: db.permissions.filter((p) => maPravo(db, e, p.key)).map((p) => p.key),
      },
      error: null,
    }
  }
  if (jmeno === 'pocet_majitelu') {
    const n = db.employees.filter((x) => x.je_majitel && !x.deleted_at &&
      db.memberships.some((y) => y.user_id === x.user_id && y.status === 'active')).length
    return { data: n, error: null }
  }
  if (jmeno === 'employee_earnings') return { data: [], error: null }
  if (jmeno === 'adresa_pro_upozorneni') {
    const clovek = db.employees.find((x) => x.user_id === a.p_user)
    // `bezAdresy`: účet založený na telefon, e-mail u něj není.
    if (db.adresaSpadne) return { data: null, error: { code: '57014', message: 'canceling statement' } }
    const adresa = db.bezAdresy ? '' : 'clovek@example.cz'
    return { data: [{ adresa, jmeno: clovek?.full_name ?? '', firma: 'Černá Perla' }], error: null }
  }
  return { data: null, error: { code: 'PGRST202', message: `neznámá funkce ${jmeno}` } }
}

/** Kousek PostgRESTu: from().select().eq()… a await. */
function dotaz(db, tabulka) {
  const s = { op: 'select', filtry: [], poradi: [], limit: null, jeden: false, data: null, konflikt: null }
  const b = {
    select() { return b },
    eq(k, v) { s.filtry.push((r) => String(r[k]) === String(v)); return b },
    in(k, arr) { const m = arr.map(String); s.filtry.push((r) => m.includes(String(r[k]))); return b },
    is(k, v) { s.filtry.push((r) => (r[k] ?? null) === v); return b },
    order(k, o = {}) { s.poradi.push([k, o.ascending !== false]); return b },
    limit(n) { s.limit = n; return b },
    maybeSingle() { s.jeden = true; return b },
    update(data) { s.op = 'update'; s.data = data; return b },
    delete() { s.op = 'delete'; return b },
    insert(rows) { s.op = 'insert'; s.data = [].concat(rows); return b },
    upsert(rows, o = {}) { s.op = 'upsert'; s.data = [].concat(rows); s.konflikt = o.onConflict; return b },
    then(ok, ko) { return Promise.resolve().then(proved).then(ok, ko) },
  }
  const radky = () => (db[tabulka] ??= [])
  const vyhovuje = (r) => s.filtry.every((f) => f(r))
  function proved() {
    if (s.op !== 'select') db.zapisy.push({ op: s.op, tabulka, data: s.data })
    if (s.op === 'select') {
      let out = radky().filter(vyhovuje)
      for (const [k, vzestupne] of [...s.poradi].reverse()) {
        out = [...out].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (vzestupne ? 1 : -1))
      }
      if (s.limit != null) out = out.slice(0, s.limit)
      out = out.map((r) => ({ ...r }))
      return { data: s.jeden ? out[0] ?? null : out, error: null }
    }
    if (s.op === 'update') {
      for (const r of radky().filter(vyhovuje)) Object.assign(r, s.data)
      return { data: null, error: null }
    }
    if (s.op === 'delete') {
      db[tabulka] = radky().filter((r) => !vyhovuje(r))
      return { data: null, error: null }
    }
    for (const novy of s.data) {
      const klice = s.op === 'upsert' && s.konflikt ? s.konflikt.split(',') : null
      const stary = klice && radky().find((r) => klice.every((k) => String(r[k]) === String(novy[k])))
      if (stary) Object.assign(stary, novy)
      else radky().push({ id: crypto.randomUUID(), ...novy })
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
        data: { user: db.prihlaseny ? { id: db.prihlaseny, email: 'x@example.cz', phone: null } : null },
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
const STUB_SERVER = js('export async function getServerSupabase() { return globalThis.__prava.klient }')
const STUB_NAV = js(
  'export function redirect(u) { const e = new Error("NEXT_REDIRECT " + u); e.presmerovani = u; throw e }\n' +
  'export function notFound() { throw new Error("NOT_FOUND") }',
)
const STUB_CACHE = js('export function revalidatePath() {}')
const STUB_HEADERS = js('export async function headers() { return new Map([["host", "localhost:3000"]]) }')
const STUB_EMAIL = js(
  'export async function odeslatEmail(z) { globalThis.__prava.db.maily.push(z); return { stav: "odeslano" } }',
)
const STUB_LINK = js(
  `import { createElement } from ${JSON.stringify(REACT)}\n` +
  'export default function Link({ href, children, prefetch, scroll, ...r }) { return createElement("a", { href, ...r }, children) }',
)
const STUB_POZICE = js(
  'export async function najdiNeboZaloz() { throw new Error("v téhle kontrole se pozice nezakládá") }\n' +
  'export async function zalozitPozici() {}\nexport async function prejmenovatPozici() {}\nexport async function prepnoutPozici() {}',
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

const AKCE_LIDE = adresaModulu('app/[rozsah]/nastaveni/lide/akce.ts', SPOLECNE)
const AKCE_ROLE = adresaModulu('app/[rozsah]/nastaveni/role/akce.ts', SPOLECNE)
const NABIDKA = adresaModulu('app/[rozsah]/nabidka.ts', SPOLECNE)

const akceLide = await import(AKCE_LIDE)
const akceRole = await import(AKCE_ROLE)
const StrankaLide = (await nactiModul('app/[rozsah]/nastaveni/lide/page.tsx', [
  ...SPOLECNE, ['./akce', AKCE_LIDE],
])).default
const StrankaRole = (await nactiModul('app/[rozsah]/nastaveni/role/page.tsx', [
  ...SPOLECNE, ['./akce', AKCE_ROLE], ['../../nabidka', NABIDKA],
])).default

/** Nový svět s přihlášeným člověkem. */
function svet(uid) {
  const db = novySvet()
  db.prihlaseny = uid
  globalThis.__prava = { db, klient: klient(db) }
  return db
}

async function vykreslit(Stranka, rozsah, hledani = {}) {
  const prvek = await Stranka({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(hledani) })
  return renderToStaticMarkup(prvek)
}

async function odeslat(akce, fd) {
  try {
    await akce(fd)
    return null
  } catch (e) {
    if (e?.presmerovani) return e.presmerovani
    throw e
  }
}

/* =====================================================================
   FORMULÁŘ JAKO PROHLÍŽEČ

   Pole uvnitř `<fieldset disabled>` prohlížeč NEODEŠLE a nedá se na
   ně kliknout. Přesně tohle majitel viděl — proto se to tu nesmí
   obejít ručně sestaveným FormData.
   ================================================================== */

const dekodovat = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function atributy(s) {
  const a = {}
  for (const m of s.matchAll(/([a-zA-Z_:][-\w:.]*)(?:="([^"]*)")?/g)) a[m[1]] = m[2] === undefined ? '' : dekodovat(m[2])
  return a
}

/** Najde formulář, ve kterém je `poznavka`, a vrátí jeho prvky. */
function formular(html, poznavka) {
  const f = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]).find((x) => x.includes(poznavka))
  if (!f) return null
  const prvky = []
  const zamky = []
  let select = null
  for (const m of f.matchAll(/<(\/?)(fieldset|input|select|option|button)\b([^>]*)>/g)) {
    const [, konec, tag, zbytek] = m
    const a = atributy(zbytek)
    const zamceno = zamky.some(Boolean)
    if (tag === 'fieldset') { if (konec) zamky.pop(); else zamky.push('disabled' in a); continue }
    if (tag === 'select') {
      if (konec) { prvky.push(select); select = null } else select = { typ: 'select', name: a.name, disabled: zamceno || 'disabled' in a, volby: [] }
      continue
    }
    if (tag === 'option' && !konec && select) { select.volby.push({ value: a.value ?? '', selected: 'selected' in a }); continue }
    if (tag === 'button' && !konec) { prvky.push({ typ: 'button', submit: (a.type ?? 'submit') === 'submit', disabled: zamceno || 'disabled' in a }); continue }
    if (tag === 'input') {
      prvky.push({ typ: a.type ?? 'text', name: a.name, value: a.value ?? '', checked: 'checked' in a, disabled: zamceno || 'disabled' in a })
    }
  }
  return prvky
}

/**
 * Klikne na zaškrtávátka a odešle. Vrací FormData a seznam kliknutí,
 * která NEŠLA — pole zamčené nebo neexistující. Zamčené se nepřepne,
 * stejně jako v prohlížeči.
 */
function kliknoutAOdeslat(prvky, { zaskrtnout = [], odskrtnout = [], vybrat = {} } = {}) {
  const nejde = []
  const najdi = (name, value) => prvky.find((p) => p.typ === 'checkbox' && p.name === name && p.value === value)
  for (const [name, value, stav] of [
    ...zaskrtnout.map(([n, v]) => [n, v, true]),
    ...odskrtnout.map(([n, v]) => [n, v, false]),
  ]) {
    const p = najdi(name, value)
    if (!p || p.disabled) nejde.push(`${name}=${value}`)
    else p.checked = stav
  }
  const tlacitko = prvky.find((p) => p.typ === 'button' && p.submit)
  const fd = new FormData()
  for (const p of prvky) {
    if (p.disabled || !p.name) continue
    if (p.typ === 'select') {
      const v = vybrat[p.name] ?? (p.volby.find((o) => o.selected) ?? p.volby[0])?.value ?? ''
      fd.append(p.name, v)
    } else if (p.typ === 'checkbox' || p.typ === 'radio') {
      if (p.checked) fd.append(p.name, p.value)
    } else if (p.typ !== 'button') {
      fd.append(p.name, p.value)
    }
  }
  return { fd, nejde, odeslatJde: Boolean(tlacitko && !tlacitko.disabled) }
}

const vyjimky = (db, zamestnanec) =>
  db.employee_permissions
    .filter((r) => r.employee_id === zamestnanec)
    .map((r) => `${r.permission_key}=${r.granted}`)
    .sort()

const zapisyDo = (db, tabulka) => db.zapisy.filter((z) => z.tabulka === tabulka).length

/* =====================================================================
   1. MAJITEL DÁ VÝJIMKU BRIGÁDNICI BEZ ÚČTU (hlášení 24. 9.)
   ================================================================== */

console.log('== 1. Majitel přiděluje práva člověku bez účtu (/firma) ==')
{
  const db = svet(U_MAJITEL)
  const html = await vykreslit(StrankaLide, 'firma', { opravneni: E_JANA })
  const prvky = formular(html, 'Uložit oprávnění')
  ma('panel s formulářem se vykreslil', prvky !== null, true)
  const zaskrtavatka = (prvky ?? []).filter((p) => p.typ === 'checkbox' && p.name === 'pravo')
  ma('nabízí se zaškrtávátka práv', zaskrtavatka.length > 0, true)
  ma('majiteli NEJSOU zamčená', zaskrtavatka.filter((p) => p.disabled).length, 0)
  ma('věta „Tady je vidíte, jak jsou" se majiteli neukazuje',
    html.includes('Měnit oprávnění může jen ten'), false)

  const { fd, nejde, odeslatJde } = kliknoutAOdeslat(prvky ?? [], {
    zaskrtnout: [['pravo', 'payroll.read']],
    odskrtnout: [['pravo', 'attendance.read']],
  })
  ma('majitel na obě políčka dokáže kliknout', nejde, [])
  ma('tlačítko Uložit jde stisknout', odeslatJde, true)

  const kam = await odeslat(akceLide.prideleniOpravneni, fd)
  ma('výjimky se zapsaly: přidané mzdy, odebraná docházka',
    vyjimky(db, E_JANA), ['attendance.read=false', 'payroll.read=true'])
  ma('zařazení zůstalo Číšník',
    db.employees.find((e) => e.id === E_JANA).position_id, P_CISNIK)
  ma('člověk bez účtu dostane ZPRÁVU O ÚSPĚCHU, ne chybu',
    /ulozeno=opravneni/.test(kam ?? '') && !/chyba=/.test(kam ?? ''), true)

  // Stránka po uložení to musí ukázat — výjimky jsou vidět u zaškrtávátek.
  const znovu = await vykreslit(StrankaLide, 'firma', { opravneni: E_JANA })
  const po = formular(znovu, 'Uložit oprávnění') ?? []
  const je = (k) => po.find((p) => p.typ === 'checkbox' && p.value === k)?.checked
  ma('po uložení je mzda zaškrtnutá', je('payroll.read'), true)
  ma('… docházka odškrtnutá', je('attendance.read'), false)
  ma('… a obě jsou označené jako výjimka',
    (znovu.match(/výjimka — /g) ?? []).length, 2)

  // Vrátit na zařazení = stejné jako zařazení → výjimka se smaže.
  const zpet = kliknoutAOdeslat(po, { zaskrtnout: [['pravo', 'attendance.read']] })
  await odeslat(akceLide.prideleniOpravneni, zpet.fd)
  ma('vrácení docházky na zařazení výjimku smaže', vyjimky(db, E_JANA), ['payroll.read=true'])

  // Hláška po uložení: člověk bez účtu nic nedostal, tak se to netvrdí.
  const hlaska = await vykreslit(StrankaLide, 'firma', {
    ulozeno: 'opravneni', kdo: 'Jana Brigádnice', bezuctu: '1',
  })
  ma('hláška: uloženo, začne platit po přihlášení',
    /Oprávnění uloženo — Jana Brigádnice/.test(hlaska) && /až se přihlásí/.test(hlaska), true)
  ma('hláška netvrdí, že odešel e-mail', /e-mailem/.test(hlaska), false)
  ma('… a nestojí pod ní ještě holé „Uloženo."', />Uloženo\.</.test(hlaska), false)
}

console.log('\n== 2. Majitel na adrese pobočky (/centrum) ==')
{
  const db = svet(U_MAJITEL)
  const html = await vykreslit(StrankaLide, 'centrum', { opravneni: E_JANA })
  const prvky = formular(html, 'Uložit oprávnění') ?? []
  ma('ani na pobočce nejsou zaškrtávátka zamčená',
    prvky.filter((p) => p.typ === 'checkbox' && p.name === 'pravo' && p.disabled).length, 0)
  const { fd, nejde } = kliknoutAOdeslat(prvky, { zaskrtnout: [['pravo', 'advances.manage']] })
  ma('na zálohy jde kliknout', nejde, [])
  await odeslat(akceLide.prideleniOpravneni, fd)
  ma('výjimka se zapsala', vyjimky(db, E_JANA), ['advances.manage=true'])
}

console.log('\n== 3. Člověk s účtem: výjimka, rozsah a pobočky ==')
{
  const db = svet(U_MAJITEL)
  const html = await vykreslit(StrankaLide, 'firma', { opravneni: E_PETR })
  const prvky = formular(html, 'Uložit oprávnění') ?? []
  const pobocky = prvky.filter((p) => p.typ === 'checkbox' && p.name === 'pobocka')
  ma('rozsah se nabízí a pobočky nejsou zamčené',
    pobocky.length === 2 && pobocky.every((p) => !p.disabled), true)
  ma('Centrum je předvyplněné z členství',
    pobocky.find((p) => p.value === B_A)?.checked, true)
  const { fd, nejde } = kliknoutAOdeslat(prvky, {
    zaskrtnout: [['pravo', 'shifts.manage'], ['pobocka', B_B]],
  })
  ma('kliknout jde na právo i na pobočku', nejde, [])
  const kam = await odeslat(akceLide.prideleniOpravneni, fd)
  ma('výjimka plánování se zapsala', vyjimky(db, E_PETR), ['shifts.manage=true'])
  ma('pobočky členství jsou Centrum i Nádraží',
    db.membership_branches.filter((r) => r.membership_id === M_PETR).map((r) => r.branch_id).sort(),
    [B_A, B_B].sort())
  ma('rozsah zůstal „vybrané pobočky"', db.memberships.find((m) => m.id === M_PETR).scope, 'branch')
  ma('uloženo s upozorněním e-mailem', /ulozeno=opravneni/.test(kam ?? '') && db.maily.length === 1, true)
  ma('… a hláška nehlásí problém s e-mailem', /mail=/.test(kam ?? ''), false)

  // Účet bez e-mailu: nic neodešlo, a obrazovka to nesmí zamlčet.
  const bez = svet(U_MAJITEL)
  bez.bezAdresy = true
  const prvky2 = formular(await vykreslit(StrankaLide, 'firma', { opravneni: E_PETR }), 'Uložit oprávnění') ?? []
  const kam2 = await odeslat(akceLide.prideleniOpravneni, kliknoutAOdeslat(prvky2).fd)
  ma('bez e-mailové adresy se nic neposílá', bez.maily.length, 0)
  /*
    Proč adresa chybí, akce NEVÍ: `adresa_pro_upozorneni` vrací prázdno
    i vedoucímu pobočky bez `people.manage` za celou firmu. Hláška proto
    nesmí tvrdit, že adresa u účtu není. Čte se z vykreslené obrazovky,
    na kterou akce přesměruje, ne z adresy.
  */
  const html2 = await vykreslit(StrankaLide, 'firma',
    Object.fromEntries(new URL(kam2 ?? '/', 'http://x').searchParams))
  ma('… a obrazovka řekne, že e-mail neodešel, netvrdí „i e-mailem"',
    html2.includes('e-mail neodešel: adresu se nepodařilo zjistit.'), true)
  ma('… ani že u účtu adresa není (důvod nezná)', /není e-mailová adresa/.test(html2), false)

  const spadla = svet(U_MAJITEL)
  spadla.adresaSpadne = true
  const prvky3 = formular(await vykreslit(StrankaLide, 'firma', { opravneni: E_PETR }), 'Uložit oprávnění') ?? []
  const kam3 = await odeslat(akceLide.prideleniOpravneni, kliknoutAOdeslat(prvky3).fd)
  ma('spadlé zjištění adresy: uloženo, ale hláška řekne, že e-mail neodešel',
    decodeURIComponent(kam3 ?? '').includes('ulozeno=opravneni')
    && decodeURIComponent(kam3 ?? '').includes('mail=adresu se nepodařilo zjistit'), true)
}

/* =====================================================================
   4. KDO PRÁVA MĚNIT NESMÍ, NEZMĚNÍ JE ANI RUČNĚ SESTAVENÝM FORMULÁŘEM

   Tohle hlídá, že oprava neudělala z první linie „vždycky ano".
   Obrazovka není zámek: zamčené zaškrtávátko obejde každý, kdo pošle
   formulář sám. Akce se proto ptá znovu.
   ================================================================== */

console.log('\n== 4. Vedoucí se správou lidí, bez settings.manage ==')
{
  const db = svet(U_VEDOUCI)
  const html = await vykreslit(StrankaLide, 'firma', { opravneni: E_JANA })
  const prvky = formular(html, 'Uložit oprávnění') ?? []
  ma('zaškrtávátka má zamčená',
    prvky.filter((p) => p.typ === 'checkbox' && p.name === 'pravo').every((p) => p.disabled), true)
  ma('a u nich vysvětlení', html.includes('Měnit oprávnění může jen ten'), true)

  const fd = new FormData()
  fd.append('rozsah', 'firma')
  fd.append('zamestnanec', E_JANA)
  fd.append('zarazeni', P_CISNIK)
  for (const [k] of PRAVA) fd.append('nabizeno', k)
  fd.append('pravo', 'payroll.read')
  await odeslat(akceLide.prideleniOpravneni, fd)
  ma('ručně poslaný formulář do výjimek NEZAPÍŠE nic', zapisyDo(db, 'employee_permissions'), 0)
}

console.log('\n== 5. Provozní se settings.manage jen na jedné pobočce ==')
{
  /*
    Politiky `employee_permissions_*` a `position_permissions_*` chtějí
    `settings.manage` na FIREMNÍ úrovni (`has_access(…, null)`). Kdyby se
    aplikace ptala na pobočku z adresy, pustila by ho k zaškrtávátkům
    a databáze by pak přidání odmítla chybou a odebrání tiše zahodila.
  */
  const db = svet(U_PROVOZNI)
  const html = await vykreslit(StrankaLide, 'centrum', { opravneni: E_JANA })
  const prvky = formular(html, 'Uložit oprávnění') ?? []
  ma('u člověka má zaškrtávátka zamčená (jako databáze)',
    prvky.filter((p) => p.typ === 'checkbox' && p.name === 'pravo').every((p) => p.disabled), true)

  const fd = new FormData()
  fd.append('rozsah', 'centrum')
  fd.append('zamestnanec', E_JANA)
  fd.append('zarazeni', P_CISNIK)
  for (const [k] of PRAVA) fd.append('nabizeno', k)
  fd.append('pravo', 'shifts.read')
  await odeslat(akceLide.prideleniOpravneni, fd)
  ma('ručně poslaný formulář do výjimek NEZAPÍŠE nic', zapisyDo(db, 'employee_permissions'), 0)

  const role = await vykreslit(StrankaRole, 'centrum')
  const cisnik = formular(role, 'Uložit Číšník') ?? []
  ma('na Zařazení má zaškrtávátka zamčená',
    cisnik.filter((p) => p.typ === 'checkbox').every((p) => p.disabled), true)
  const rucne = new FormData()
  rucne.append('rozsah', 'centrum')
  rucne.append('zarazeni', P_CISNIK)
  for (const [k] of PRAVA) rucne.append('nabizeno', k)
  rucne.append('pravo', 'shifts.read')
  const kam = await odeslat(akceRole.ulozitOpravneni, rucne)
  ma('ručně poslaný formulář na Zařazení nezapíše nic', zapisyDo(db, 'position_permissions'), 0)
  ma('… a řekne, že na to nemá právo', /chyba=pravo/.test(kam ?? ''), true)
}

/* =====================================================================
   6. ZAŘAZENÍ — táž chyba na druhé obrazovce
   ================================================================== */

console.log('\n== 6. Majitel mění práva zařazení ==')
for (const rozsah of ['firma', 'centrum']) {
  const db = svet(U_MAJITEL)
  const html = await vykreslit(StrankaRole, rozsah)
  const prvky = formular(html, 'Uložit Číšník') ?? []
  ma(`/${rozsah}: formulář Číšníka se vykreslil`, prvky.length > 0, true)
  ma(`/${rozsah}: zaškrtávátka nejsou zamčená`,
    prvky.filter((p) => p.typ === 'checkbox' && p.disabled).length, 0)
  const { fd, nejde, odeslatJde } = kliknoutAOdeslat(prvky, { zaskrtnout: [['pravo', 'payroll.read']] })
  ma(`/${rozsah}: na mzdy jde kliknout a uložit`, nejde.length === 0 && odeslatJde, true)
  const kam = await odeslat(akceRole.ulozitOpravneni, fd)
  ma(`/${rozsah}: Číšník má nově mzdy`,
    db.position_permissions.some((r) => r.position_id === P_CISNIK && r.permission_key === 'payroll.read'), true)
  ma(`/${rozsah}: hlášeno „přidáno 1"`, /pridano=1&odebrano=0/.test(kam ?? ''), true)
}

/* =====================================================================
   7. SEZNAM LIDÍ — cesta k panelu a poslední majitel
   ================================================================== */

console.log('\n== 7. Seznam lidí ==')
{
  svet(U_MAJITEL)
  const html = await vykreslit(StrankaLide, 'firma', { opravneni: E_JANA })
  ma('panel má kotvu, na kterou odkaz skočí', /<section[^>]*id="opravneni"/.test(html), true)

  const radek = (jmeno) => {
    const r = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((x) => x.includes(`Akce pro ${jmeno}`))
    return r ?? ''
  }
  const jana = radek('Jana Brigádnice')
  ma('řádek Jany se našel', jana.length > 0, true)
  ma('v nabídce „•••" je položka Oprávnění, která skočí na panel',
    jana.includes(`<a href="/firma/nastaveni/lide?opravneni=${E_JANA}#opravneni" class="ft-kebab-polozka">Oprávnění</a>`), true)
  ma('odkaz ve sloupci Oprávnění skočí na panel',
    jana.includes(`href="/firma/nastaveni/lide?opravneni=${E_JANA}#opravneni"`), true)

  const majitel = radek('Marek Majitel')
  ma('řádek majitele se našel', majitel.length > 0, true)
  ma('jediný majitel nemá v nabídce Smazat',
    majitel.includes(`name="id" value="${E_MAJITEL}"`), false)
  ma('… ale vysvětlení „Jediný majitel"', majitel.includes('Jediný majitel'), true)
  ma('Jana Smazat má (kontrola, že hledání Smazat funguje)',
    jana.includes(`name="id" value="${E_JANA}"`), true)
}

/* =====================================================================
   8. NIKDE SE NEPTAT S KUSEM ADRESY MÍSTO POBOČKY

   Doplněk k 1–6, ne náhrada: chytí tutéž chybu na obrazovce, kterou
   tahle kontrola nevykresluje.
   ================================================================== */

console.log('\n== 8. hasAccess nikde s rozsahem z adresy ==')
{
  const soubory = []
  const projdi = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) projdi(p)
      else if (/\.(ts|tsx)$/.test(d.name)) soubory.push(p)
    }
  }
  projdi(fileURLToPath(new URL('app', KOREN)))
  ma('prošlo se víc než sto souborů aplikace', soubory.length > 100, true)
  const volani = soubory.flatMap((s) =>
    [...fs.readFileSync(s, 'utf8').matchAll(/hasAccess\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)]
      .map((m) => ({ s: path.relative(fileURLToPath(KOREN), s), args: m[1] })))
  ma('volání hasAccess se našla (kontrola by jinak byla prázdná)', volani.length > 10, true)
  const spatne = volani.filter((v) => /,\s*rozsah\s*,?\s*$/.test(v.args))
  ma('žádné nepředává rozsah z adresy jako pobočku', spatne.map((v) => v.s), [])
}

/* =====================================================================
   9. CHYBA Z DATABÁZE JE „NE", ALE NE POTICHU

   Přesně tahle chyba se schovávala šestnáct dní: `hasAccess` dostal
   slug, databáze odpověděla chybou a v logu nebylo nic.
   ================================================================== */

console.log('\n== 9. hasAccess při chybě odmítne a řekne proč ==')
{
  svet(U_MAJITEL)
  const authz = await import(AUTHZ)
  const zapsano = []
  const puvodni = console.error
  console.error = (...x) => zapsano.push(x.join(' '))
  let slugem, spravne
  try {
    slugem = await authz.hasAccess(T, 'settings.manage', 'firma')
    spravne = await authz.hasAccess(T, 'settings.manage', null)
  } finally {
    console.error = puvodni
  }
  ma('slug místo id pobočky → ne', slugem, false)
  ma('… a do logu jde, proč (kód 22P02)',
    zapsano.some((z) => z.includes('has_access selhalo') && z.includes('22P02')), true)
  ma('správné volání majitele pustí a nic nehlásí', spravne === true && zapsano.length === 1, true)
  ma('smiSpravovatPrava: majitel ano', await authz.smiSpravovatPrava(T), true)
}

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
