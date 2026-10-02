#!/usr/bin/env node
/**
 * `lib/marketing-spojeni.ts` — zkouška spojení, než se připojení nástroje
 * zapne. Dosud bez vlastního testu (zjištěno při psaní
 * `docs/provider-development.md`, 2. 10. 2026) — appka se spoléhala jen
 * na ruční ověření přes obrazovku Nástroje.
 *
 * Pravidlo, které se tu hlídá nejpřísněji: zkouška smí tvrdit JEN to, co
 * opravdu ověřila. U n8n se nesmí nikdy tvářit jako "ověřeno", protože
 * jediná cesta, jak to opravdu zkusit, je publikační webhook — a to by
 * riskovalo skutečný příspěvek na Instagramu firmy.
 *
 * Importuje SKUTEČNÝ `lib/marketing-spojeni.ts` (a pod ním skutečný
 * katalog) — podstrčené je jen `fetch` (síť) a proměnné prostředí.
 *
 * Pusť (server-only vyžaduje react-server, stejně jako ostatní testy nad
 * marketingovými AI/odesílacími soubory — viz VYNECHANE v
 * .github/workflows/aplikace.yml):
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-spojeni.test.mjs
 */

import { otestovatSpojeni } from '../lib/marketing-spojeni.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}

const PUVODNI_FETCH = globalThis.fetch
const PUVODNI_ENV = { ...process.env }

function obnovit() {
  globalThis.fetch = PUVODNI_FETCH
  for (const k of ['ANTHROPIC_API_KEY', 'N8N_MARKETING_URL', 'N8N_MARKETING_TAJEMSTVI']) {
    if (k in PUVODNI_ENV) process.env[k] = PUVODNI_ENV[k]
    else delete process.env[k]
  }
}

console.log('\nNástroj, který se v daném režimu vůbec nedá připojit (lzePripojit odmítne)')
{
  // anthropic nemá 'rucni' mezi svými rezimy.
  const v = await otestovatSpojeni('anthropic', 'rucni', {})
  ok('ok:false', v.ok === false)
  ok('hláška o nepřipojitelnosti, ne o chybějícím klíči', /nedá/.test(v.zprava), v.zprava)
}

console.log('\nRežim "rucni" — nikam nevolá, nezávisí na konkrétním nástroji')
{
  const v = await otestovatSpojeni('rucni_export', 'rucni', {})
  ok('ok:true', v.ok === true)
  ok('řekne, že nikam nevolá', /nikam nevolá|člověk/.test(v.zprava), v.zprava)
}

console.log('\nRežim "demo" — projde celou cestou, ven nic nejde (jen n8n ho dnes v katalogu má)')
{
  const v = await otestovatSpojeni('n8n', 'demo', {})
  ok('ok:true', v.ok === true)
}

console.log('\nAnthropic — zákaznický režim bez vyplněného klíče')
{
  const v = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: '  ' })
  ok('ok:false', v.ok === false)
  ok('"Chybí API klíč."', v.zprava === 'Chybí API klíč.', v.zprava)
}

console.log('\nAnthropic — režim foodtab bez ANTHROPIC_API_KEY na serveru')
{
  delete process.env.ANTHROPIC_API_KEY
  const v = await otestovatSpojeni('anthropic', 'foodtab', {})
  ok('ok:false', v.ok === false)
  ok('hláška mluví o účtu Foodtabu, ne o zákazníkovi', /Foodtabu/.test(v.zprava), v.zprava)
}

console.log('\nAnthropic — poskytovatel klíč přijal (200)')
{
  globalThis.fetch = async (url, init) => {
    ok('volá se správná adresa', String(url) === 'https://api.anthropic.com/v1/models?limit=1')
    ok('klíč jde v hlavičce x-api-key, ne v URL', init.headers['x-api-key'] === 'sk-ant-test')
    return { ok: true, status: 200 }
  }
  const v = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: 'sk-ant-test' })
  ok('ok:true', v.ok === true)
  globalThis.fetch = PUVODNI_FETCH
}

console.log('\nAnthropic — poskytovatel klíč odmítl (401)')
{
  globalThis.fetch = async () => ({ ok: false, status: 401 })
  const v = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: 'spatny' })
  ok('ok:false', v.ok === false)
  ok('srozumitelná hláška, ne jen kód', /odmítl/.test(v.zprava), v.zprava)
  globalThis.fetch = PUVODNI_FETCH
}

console.log('\nAnthropic — neočekávaná chyba poskytovatele (500) se zkrátí, ne spadne')
{
  globalThis.fetch = async () => ({ ok: false, status: 500 })
  const v = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: 'x' })
  ok('ok:false', v.ok === false)
  ok('obsahuje kód chyby', v.zprava.includes('500'), v.zprava)
  globalThis.fetch = PUVODNI_FETCH
}

console.log('\nAnthropic — výpadek sítě nespadne, vrátí se srozumitelně a BEZ KLÍČE v hlášce')
{
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED 1.2.3.4:443 klic=sk-ant-tajny') }
  const v = await otestovatSpojeni('anthropic', 'zakaznicky', { klic: 'sk-ant-tajny' })
  ok('ok:false', v.ok === false)
  // Hlášky z téhle funkce končí ve sloupci, který čte každý s marketing.read
  // (lib/marketing-spojeni.ts, hlavička) — klíč se do nich nesmí dostat, i
  // kdyby ho omylem nesla chybová zpráva síťové knihovny.
  ok('KLÍČ SE NEDOSTANE DO HLÁŠKY, i když ho nesla chyba sítě', !v.zprava.includes('sk-ant-tajny'), v.zprava)
  globalThis.fetch = PUVODNI_FETCH
}

console.log('\nn8n — adresa i tajemství nastavené: zkouška řekne NAHLAS, že neověřila odeslání')
{
  process.env.N8N_MARKETING_URL = 'https://n8n.example/webhook/x'
  process.env.N8N_MARKETING_TAJEMSTVI = 'tajne'
  const v = await otestovatSpojeni('n8n', 'foodtab', {})
  ok('ok:true (konfigurace je kompletní)', v.ok === true)
  ok('hláška řekne, že skutečné odeslání se NEOVĚŘILO naslepo', /nanečisto|neposílá/.test(v.zprava), v.zprava)
  ok('hláška netvrdí "připojeno" bez výhrady', !/^připojeno$/i.test(v.zprava.trim()))
}

console.log('\nn8n — chybí konfigurace na serveru')
{
  delete process.env.N8N_MARKETING_URL
  delete process.env.N8N_MARKETING_TAJEMSTVI
  const v = await otestovatSpojeni('n8n', 'foodtab', {})
  ok('ok:false', v.ok === false)
  ok('jmenuje obě chybějící proměnné', v.zprava.includes('N8N_MARKETING_URL') && v.zprava.includes('N8N_MARKETING_TAJEMSTVI'), v.zprava)
}

obnovit()

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
