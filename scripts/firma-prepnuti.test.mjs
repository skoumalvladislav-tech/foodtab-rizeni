#!/usr/bin/env node
/**
 * Přepínač firmy (2. 10. 2026) — `app/firma-prepnuti.ts` a cookie
 * v `lib/firma.ts` (`getCurrentTenantId`).
 *
 * Firmě z formuláře se nesmí věřit naslepo: tahle kontrola ověřuje, že
 * `prepnoutFirmu` zapíše cookie JEN pro firmu, kterou `getMyTenants()`
 * doopravdy vrátil, a že `getCurrentTenantId` cizí/neplatnou hodnotu
 * v cookie ignoruje a spadne zpátky na první firmu — stejná obrana jako
 * `resolveScope()` u pobočky.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/firma-prepnuti.test.mjs
 */

import { adresaModulu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const PRAZDNY = js('')

const FIRMY = [
  { tenant_id: 't1', name: 'Bistro', role_key: 'majitel', role_label: 'Majitel', is_owner: true, scope: 'tenant' },
  { tenant_id: 't2', name: 'Kavárna', role_key: 'majitel', role_label: 'Majitel', is_owner: true, scope: 'tenant' },
]

// lib/firma.ts importuje z @/lib/authz i jména, která tahle kontrola
// nepoužívá (requireScopedAccess, resolveScope, obě chybové třídy) — ESM
// odmítne modul, který je vůbec neexportuje, i když se nikdy nezavolají.
const STUB_AUTHZ = js(`
export async function getMyTenants() {
  return ${JSON.stringify(FIRMY)}.map((r) => ({
    tenantId: r.tenant_id, name: r.name, roleKey: r.role_key, roleLabel: r.role_label,
    isOwner: r.is_owner, scope: r.scope,
  }))
}
export class NeprihlasenError extends Error {}
export class PristupOdepren extends Error {}
export async function requireScopedAccess() { throw new Error("nepoužito v tomhle testu") }
export function resolveScope() { throw new Error("nepoužito v tomhle testu") }
`)

/** Falešná cookie úložiště — zapamatuje si, co kdo zapsal, a dá to přečíst. */
function falesneCookies() {
  const ulozeno = new Map()
  const stub = js(`
export async function cookies() {
  return {
    get: (jmeno) => globalThis.__cookieSklad.get(jmeno),
    set: (jmeno, hodnota, volby) => { globalThis.__cookieSklad.set(jmeno, { value: hodnota, volby }) },
  }
}`)
  return { ulozeno, stub }
}

const STUB_NAV = js(`
export function redirect(kam) {
  const e = new Error("NEXT_REDIRECT " + kam)
  e.presmerovani = kam
  throw e
}`)

async function zavolatPrepnuti(tenantId) {
  const { ulozeno, stub } = falesneCookies()
  globalThis.__cookieSklad = ulozeno

  const FIRMA = adresaModulu('lib/firma.ts', [
    ['server-only', PRAZDNY],
    ['next/headers', stub],
    ['@/lib/authz', STUB_AUTHZ],
  ])
  const PREPNUTI = await nactiModul('app/firma-prepnuti.ts', [
    ['next/headers', stub],
    ['next/navigation', STUB_NAV],
    ['@/lib/authz', STUB_AUTHZ],
    ['@/lib/firma', FIRMA],
  ])

  const fd = new FormData()
  fd.set('tenantId', tenantId)

  let presmerovani = null
  try {
    await PREPNUTI.prepnoutFirmu(fd)
  } catch (e) {
    presmerovani = e.presmerovani ?? null
  }

  return { presmerovani, cookie: ulozeno.get('ft_firma_id')?.value ?? null }
}

console.log('\nprepnoutFirmu — platná firma člena')
{
  const { presmerovani, cookie } = await zavolatPrepnuti('t2')
  ok('přesměruje na / (appka sama pozná, kam patří)', presmerovani === '/')
  ok('cookie nese zvolenou firmu', cookie === 't2')
}

console.log('\nprepnoutFirmu — cizí/neplatná firma (nepatří mezi getMyTenants())')
{
  const { presmerovani, cookie } = await zavolatPrepnuti('cizi-tenant-id')
  ok('přesměruje na / i tak (žádná chybová stránka navíc)', presmerovani === '/')
  ok('cookie se NEZAPÍŠE — neplatná hodnota nikdy nevznikne', cookie === null)
}

console.log('\ngetCurrentTenantId — čte cookie, ale neváří jí naslepo')
{
  const { stub } = falesneCookies()
  globalThis.__cookieSklad = new Map([['ft_firma_id', { value: 't2' }]])
  const FIRMA = await nactiModul('lib/firma.ts', [
    ['server-only', PRAZDNY],
    ['next/headers', stub],
    ['@/lib/authz', STUB_AUTHZ],
  ])
  ok('platná cookie vyhraje nad "první firmou"', await FIRMA.getCurrentTenantId() === 't2')
}
{
  const { stub } = falesneCookies()
  globalThis.__cookieSklad = new Map([['ft_firma_id', { value: 'cizi-tenant-id' }]])
  const FIRMA = await nactiModul('lib/firma.ts', [
    ['server-only', PRAZDNY],
    ['next/headers', stub],
    ['@/lib/authz', STUB_AUTHZ],
  ])
  ok('cizí hodnota v cookie se ignoruje, spadne na první firmu (t1)', await FIRMA.getCurrentTenantId() === 't1')
}
{
  const { stub } = falesneCookies()
  globalThis.__cookieSklad = new Map()
  const FIRMA = await nactiModul('lib/firma.ts', [
    ['server-only', PRAZDNY],
    ['next/headers', stub],
    ['@/lib/authz', STUB_AUTHZ],
  ])
  ok('bez cookie beze změny — první firma jako dřív', await FIRMA.getCurrentTenantId() === 't1')
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
