#!/usr/bin/env node
/**
 * Workflow v n8n/ sedí s tím, co Foodtab posílá — n8n/foodtab-zverejnit-prispevek.json
 * proti lib/marketing-n8n.ts.
 *
 * Pusť `node scripts/marketing-n8n-workflow.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ TO EXISTUJE
 *
 * Zadání (§25): „n8n workflow jsou validní JSON a mají dokumentovaný
 * import." Validní JSON je málo — workflow, které se dá naimportovat
 * a pak čeká jinou hlavičku nebo jiná pole, než Foodtab posílá, je
 * horší než žádné: naimportuje se, zapne, a první příspěvek skončí
 * s hláškou, ze které nikdo nepozná, že se rozešly dva soubory.
 *
 * Kontrakt se proto čte Z OBOU STRAN a porovnává:
 *   * co workflow VYŽADUJE (kód v uzlu „Přečíst požadavek“) musí být
 *     podmnožinou toho, co Foodtab POSÍLÁ (`body: JSON.stringify({…})`),
 *   * hlavička s tajemstvím se musí jmenovat stejně,
 *   * odpovědi workflow musí používat klíče, které `precistOdpoved`
 *     opravdu čte (`stav`, `externi_id`, `odkaz`, `duvod`).
 *
 * `lib/marketing-n8n.ts` se čte jako TEXT, ne importem: potřebné
 * hodnoty tam jsou jako literály uvnitř funkce, ne jako exporty —
 * a exportovat je jen kvůli kontrole by znamenalo měnit kód kvůli
 * testu.
 *
 * ---------------------------------------------------------------------
 * CO SE HLÍDÁ NAVÍC
 *
 * * Každé spojení míří na uzel, který existuje. JSON s visícím
 *   spojením n8n naimportuje a tiše ho zahodí.
 * * V souboru není nic, co vypadá jako token. Export z n8n nese jen
 *   ODKAZY na přihlašovací údaje (id a název), nikdy jejich obsah —
 *   a tak to má zůstat.
 * * Instagramové adresy jsou ty tři, které cesta potřebuje
 *   (kontejner, stav, zveřejnění). Překlep v jedné z nich by
 *   neshodil import, jen první ostrý příspěvek.
 */

import fs from 'node:fs'
import path from 'node:path'

const KOREN = path.join(import.meta.dirname, '..')
const SOUBOR = path.join(KOREN, 'n8n', 'foodtab-zverejnit-prispevek.json')
const LIB = fs.readFileSync(path.join(KOREN, 'lib', 'marketing-n8n.ts'), 'utf8')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== Soubor ==\n')

let wf = null
try {
  wf = JSON.parse(fs.readFileSync(SOUBOR, 'utf8'))
} catch (e) {
  ok(`JSON se dá přečíst (${e.message})`, false)
}
ok('JSON se dá přečíst', wf !== null)
if (!wf) {
  console.log(`\n${chyb} KONTROL SPADLO\n`)
  process.exit(1)
}

ok('má název', typeof wf.name === 'string' && wf.name.length > 0)
ok('má uzly', Array.isArray(wf.nodes) && wf.nodes.length > 0)
ok('má spojení', wf.connections && typeof wf.connections === 'object')

const jmena = new Set(wf.nodes.map((n) => n.name))
ok('názvy uzlů jsou jedinečné', jmena.size === wf.nodes.length)

console.log('\n== Spojení míří na existující uzly ==\n')

let visicich = 0
for (const [od, vystupy] of Object.entries(wf.connections)) {
  if (!jmena.has(od)) visicich++
  for (const vetev of vystupy.main ?? []) {
    for (const cil of vetev) if (!jmena.has(cil.node)) visicich++
  }
}
ok('žádné spojení nevisí do prázdna', visicich === 0)

/*
  Každý uzel kromě spouště a odpovědí má odněkud vést. Uzel, na který
  nic nemíří, n8n nespustí — a v přehledu vypadá, jako by byl součást
  cesty.
*/
const cile = new Set()
for (const vystupy of Object.values(wf.connections)) {
  for (const vetev of vystupy.main ?? []) for (const c of vetev) cile.add(c.node)
}
const bezVstupu = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.webhook' && !cile.has(n.name))
ok(`na každý uzel kromě spouště něco míří (${bezVstupu.map((n) => n.name).join(', ') || 'nic nechybí'})`,
  bezVstupu.length === 0)

console.log('\n== Spoušť ==\n')

const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
ok('spouští to webhook', Boolean(webhook))
ok('metoda POST', webhook?.parameters?.httpMethod === 'POST')
ok('cesta je foodtab-zverejnit', webhook?.parameters?.path === 'foodtab-zverejnit')
ok('ověřuje hlavičkou (headerAuth)', webhook?.parameters?.authentication === 'headerAuth')
ok('odpovídá uzlem, ne hned (responseNode)', webhook?.parameters?.responseMode === 'responseNode')

/*
  NÁZEV HLAVIČKY je v n8n uložený v přihlašovacím údaji, ne v JSON —
  export ho nenese. Hlídá se aspoň to, že v kódu je pořád vlastní
  hlavička a ne `Authorization` (důvod je v lib/marketing-n8n.ts).
*/
const hlavicka = LIB.match(/'(x-foodtab-[a-z-]+)'\s*:\s*tajemstvi/)
ok('Foodtab posílá tajemství vlastní hlavičkou x-foodtab-…', Boolean(hlavicka))
ok('a ne hlavičkou Authorization', !/['"]authorization['"]\s*:\s*tajemstvi/i.test(LIB))

console.log('\n== Co workflow vyžaduje, Foodtab posílá ==\n')

const precist = wf.nodes.find((n) => n.name === 'Přečíst požadavek')
ok('uzel „Přečíst požadavek“ existuje', Boolean(precist))
const kod = precist?.parameters?.jsCode ?? ''

const vyzadovane = new Set()
const m = kod.match(/for \(const p of \[([^\]]*)\]\)/)
if (m) for (const s of m[1].matchAll(/'([a-z_]+)'/g)) vyzadovane.add(s[1])
if (/chybi\.push\('obrazky'\)/.test(kod)) vyzadovane.add('obrazky')
ok(`workflow vyžaduje ${vyzadovane.size} polí (${[...vyzadovane].join(', ')})`, vyzadovane.size >= 5)

const telo = LIB.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/)
const posilane = new Set()
if (telo) for (const s of telo[1].matchAll(/^\s*([a-z_]+)\s*:/gm)) posilane.add(s[1])
ok(`Foodtab posílá ${posilane.size} polí (${[...posilane].join(', ')})`, posilane.size >= 5)

for (const p of vyzadovane) {
  ok(`vyžadované „${p}“ Foodtab posílá`, posilane.has(p))
}
ok('idempotenční klíč je mezi vyžadovanými (bez něj hrozí dva příspěvky)', vyzadovane.has('idempotencni_klic'))
ok('firma i pobočka jsou mezi vyžadovanými (jinak odejde na cizí účet)',
  vyzadovane.has('tenant_id') && vyzadovane.has('branch_id'))

console.log('\n== Odpovědi používají klíče, které Foodtab čte ==\n')

const odpovedi = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
ok(`jsou aspoň dvě odpovědi — úspěch a chyba (${odpovedi.length})`, odpovedi.length >= 2)

const ctene = {
  stav: /o\.stav === 'zverejneno'/.test(LIB) && /o\.stav === 'chyba'/.test(LIB),
  externi_id: /o\.externi_id/.test(LIB),
  odkaz: /o\.odkaz/.test(LIB),
  duvod: /o\.duvod/.test(LIB),
}
for (const [k, v] of Object.entries(ctene)) ok(`precistOdpoved čte „${k}“`, v)

let uspechu = 0
let chybovych = 0
for (const n of odpovedi) {
  const b = n.parameters?.responseBody ?? ''
  const jeUspech = /stav:\s*'zverejneno'/.test(b)
  const jeChyba = /stav:\s*'chyba'/.test(b)
  ok(`„${n.name}“ hlásí stav zverejneno NEBO chyba`, jeUspech !== jeChyba)
  if (jeUspech) {
    uspechu++
    ok(`„${n.name}“ vrací externi_id`, /externi_id:/.test(b))
  }
  if (jeChyba) {
    chybovych++
    ok(`„${n.name}“ vrací duvod`, /duvod:/.test(b))
  }
}
ok('aspoň jedna úspěšná a jedna chybová odpověď', uspechu >= 1 && chybovych >= 1)

console.log('\n== Instagram: tři adresy, které cesta potřebuje ==\n')

const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')
const urls = http.map((n) => n.parameters?.url ?? '')
ok('všechny HTTP uzly míří na graph.instagram.com', http.length > 0 && urls.every((u) => u.includes('https://graph.instagram.com/')))
ok('kontejner (/media)', urls.some((u) => /\/media'/.test(u)))
ok('stav (?fields=status_code)', urls.some((u) => u.includes('?fields=status_code')))
ok('zveřejnění (/media_publish)', urls.some((u) => u.includes('/media_publish')))
ok('a všechny tři používají TENTÝŽ přihlašovací údaj',
  new Set(http.map((n) => n.credentials?.httpHeaderAuth?.name)).size === 1)
ok('HTTP uzly po chybě pokračují (aby se dala vrátit srozumitelná odpověď)',
  http.every((n) => n.onError === 'continueRegularOutput'))

console.log('\n== Nic, co vypadá jako token ==\n')

const text = fs.readFileSync(SOUBOR, 'utf8')
ok('žádný dlouhý řetězec písmen a číslic (40+)', !/[A-Za-z0-9_-]{40,}/.test(text))
ok('žádné „EAA“ (začátek tokenů Mety)', !/EAA[A-Za-z0-9]{10,}/.test(text))
ok('žádné „Bearer“', !/Bearer\s+\S+/.test(text))
ok('žádné pole „data“ v přihlašovacích údajích (jen id a název)',
  wf.nodes.every((n) => !n.credentials || Object.values(n.credentials).every((c) => !('data' in c))))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
