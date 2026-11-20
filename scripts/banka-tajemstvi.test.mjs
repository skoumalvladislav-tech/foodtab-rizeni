#!/usr/bin/env node
/**
 * Přístupové údaje k bance jen na serveru — lib/banka/tajemstvi-cteni.ts
 * (Finance Fáze 0, krok 1; migrace 20261119100000, oddíl 5).
 *
 * Pusť `node scripts/banka-tajemstvi.test.mjs`.
 *
 * Databázovou půlku (RPC šifru u banky nevydá, ověření bez šifry)
 * hlídá scénář krok111. Tady je serverová půlka:
 *   * bez ověření práva v databázi se šifra NEČTE vůbec (klient služby
 *     se ani nezavolá);
 *   * šifra se hledá podle firmy, kterou vrátila databáze, ne podle
 *     ničeho z prohlížeče;
 *   * appka u banky RPC se šifrou nevolá nikde (jediné povolené místo
 *     je mimo Finance — rezervace).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { precistSifruPoOvereni } = await import('../lib/banka/tajemstvi-cteni.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zkus = async (popis, fn) => {
  try { ok(popis, await fn()) } catch (e) { ok(`${popis} (výjimka: ${e?.message ?? e})`, false) }
}

const PRIPOJENI = '11111111-2222-4333-8444-555555555555'
const FIRMA_Z_DB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function prihlaseny(odpoved) {
  const volani = []
  return { volani, rpc: async (funkce, parametry) => { volani.push({ funkce, parametry }); return odpoved } }
}
function sluzba(odpoved) {
  const volani = []
  const dotaz = {
    select(sloupce) { volani.push(['select', sloupce]); return dotaz },
    eq(sloupec, hodnota) { volani.push(['eq', sloupec, hodnota]); return dotaz },
    async maybeSingle() { volani.push(['maybeSingle']); return odpoved },
  }
  return { volani, from(tabulka) { volani.push(['from', tabulka]); return dotaz } }
}

console.log('\n== Bez ověření v databázi se šifra nečte ==')
await zkus('databáze odmítne (42501) → null a klient služby se nezavolá', async () => {
  const p = prihlaseny({ data: null, error: { message: 'Nemáte oprávnění spravovat tohle připojení.' } })
  const s = sluzba({ data: { sifra: 'TAJNE' }, error: null })
  const v = await precistSifruPoOvereni(p, s, PRIPOJENI)
  return v === null && s.volani.length === 0 && p.volani[0]?.funkce === 'integrace_overit_spravu'
})
await zkus('databáze vrátí místo firmy nesmysl → null, služba se nezavolá', async () => {
  const s = sluzba({ data: { sifra: 'TAJNE' }, error: null })
  const v = await precistSifruPoOvereni(prihlaseny({ data: 'ne-uuid', error: null }), s, PRIPOJENI)
  return v === null && s.volani.length === 0
})
await zkus('databáze nevrátí nic → null, služba se nezavolá', async () => {
  const s = sluzba({ data: { sifra: 'TAJNE' }, error: null })
  const v = await precistSifruPoOvereni(prihlaseny({ data: null, error: null }), s, PRIPOJENI)
  return v === null && s.volani.length === 0
})
await zkus('id připojení není uuid → nic se nevolá vůbec', async () => {
  const p = prihlaseny({ data: FIRMA_Z_DB, error: null })
  const s = sluzba({ data: { sifra: 'TAJNE' }, error: null })
  const v = await precistSifruPoOvereni(p, s, "x' or 1=1 --")
  return v === null && p.volani.length === 0 && s.volani.length === 0
})

console.log('\n== Po ověření: jen řádek toho připojení a té firmy ==')
await zkus('ověření projde → šifra z integrace_tajemstvi', async () => {
  const s = sluzba({ data: { sifra: 'SIFRA-1' }, error: null })
  const v = await precistSifruPoOvereni(prihlaseny({ data: FIRMA_Z_DB, error: null }), s, PRIPOJENI)
  return v === 'SIFRA-1'
})
await zkus('dotaz filtruje připojení I firmu vrácenou databází', async () => {
  const s = sluzba({ data: { sifra: 'SIFRA-1' }, error: null })
  await precistSifruPoOvereni(prihlaseny({ data: FIRMA_Z_DB, error: null }), s, PRIPOJENI)
  const eq = s.volani.filter((x) => x[0] === 'eq').map((x) => `${x[1]}=${x[2]}`).sort().join(',')
  return s.volani[0]?.[1] === 'integrace_tajemstvi'
    && eq === `pripojeni_id=${PRIPOJENI},tenant_id=${FIRMA_Z_DB}`
})
await zkus('ověření dostane id připojení jako p_pripojeni', async () => {
  const p = prihlaseny({ data: FIRMA_Z_DB, error: null })
  await precistSifruPoOvereni(p, sluzba({ data: { sifra: 'x' }, error: null }), PRIPOJENI)
  return p.volani.length === 1 && p.volani[0].parametry.p_pripojeni === PRIPOJENI
})
await zkus('na serveru chybí klient služby → null', async () =>
  (await precistSifruPoOvereni(prihlaseny({ data: FIRMA_Z_DB, error: null }), null, PRIPOJENI)) === null)
await zkus('šifra chybí → null', async () =>
  (await precistSifruPoOvereni(prihlaseny({ data: FIRMA_Z_DB, error: null }), sluzba({ data: null, error: null }), PRIPOJENI)) === null)
await zkus('chyba čtení → null (text chyby se nevrací)', async () =>
  (await precistSifruPoOvereni(prihlaseny({ data: FIRMA_Z_DB, error: null }), sluzba({ data: null, error: { message: 'x' } }), PRIPOJENI)) === null)

console.log('\n== Appka u banky RPC se šifrou nevolá ==')
function souboryKodu(adresar) {
  const vysledek = []
  for (const jmeno of readdirSync(adresar)) {
    const cesta = path.join(adresar, jmeno)
    if (statSync(cesta).isDirectory()) vysledek.push(...souboryKodu(cesta))
    else if (/\.(ts|tsx|js|mjs)$/.test(jmeno)) vysledek.push(cesta)
  }
  return vysledek
}
const volajiRpc = [...souboryKodu(path.join(ROOT, 'app')), ...souboryKodu(path.join(ROOT, 'lib'))]
  .filter((f) => /\.rpc\(\s*['"]integrace_precti_tajemstvi['"]/.test(readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
await zkus(`RPC integrace_precti_tajemstvi jen v rezervacích (našlo se: ${volajiRpc.join(', ') || 'nic'})`, () =>
  volajiRpc.length === 1 && volajiRpc[0] === 'app/[rozsah]/rezervace/akce.ts')
const BANKOVNI_VOLAJICI = [
  'app/[rozsah]/finance/integrace/banka/akce.ts',
  'app/api/integrace/kb/registrace/route.ts',
  'app/api/integrace/kb/vratit/route.ts',
]
for (const f of BANKOVNI_VOLAJICI) {
  await zkus(`${f}: přístup k bance čte přes precistTajemstviBanky`, () => readFileSync(path.join(ROOT, f), 'utf8').includes('precistTajemstviBanky<'))
}
await zkus('lib/banka/tajemstvi.ts je jen pro server (server-only)', () =>
  /^import 'server-only'/m.test(readFileSync(path.join(ROOT, 'lib/banka/tajemstvi.ts'), 'utf8')))
await zkus('výjimka pro klienta služby je zapsaná v lib/supabase/uloha.ts', () =>
  readFileSync(path.join(ROOT, 'lib/supabase/uloha.ts'), 'utf8').includes('lib/banka/tajemstvi.ts'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
