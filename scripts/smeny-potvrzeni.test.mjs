#!/usr/bin/env node
/**
 * Potvrzení směn — obrazovka „Potvrzení směn“.
 *
 * Pusť `node scripts/smeny-potvrzeni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * ZADÁNÍ ŠÉFÍKA 29. 9. 2026
 *
 * „nastav aby při vydání směny se vyslala hromadná notifikace těm lidem
 * kterých se směna týká, zároveň možnost potvrzení všech směn a nebo
 * možnost nepotvrdit třeba jednu nebo více směn. chtělo by to potvrzovací
 * tabulku.“
 *
 * Databázovou půlku (migrace `20260929100000_smeny_potvrzeni_tabulka.sql`
 * — hromadné potvrzení, odmítnutí s povinným důvodem, hromadná notifikace
 * při vydání rozpisu centrální cestou) hlídá `supabase/tests/krok64_scenar.sql`.
 * Tenhle soubor je ta druhá půlka: obrazovka `app/[rozsah]/smeny/potvrzeni/`
 * a dva vstupní odkazy na ni (hlavička Rozpisu na počítači, karta na
 * telefonu).
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE SKUTEČNÁ STRÁNKA
 *
 * Kontrola, která si poskládá očekávaný výsledek sama, ověřuje vlastní
 * záměr, ne kód (`scenar`, bod 2 — přesně tak prošla rozbitá kontrola
 * QR na kiosku). Proto se tu vykresluje SKUTEČNÁ `page.tsx` s podstrčenou
 * databází/oprávněním a čte se z hotového HTML, ne z toho, co si funkce
 * PODLE MĚ vrátí.
 *
 * Serverové akce (`akce.ts`) se testují dvěma různými způsoby:
 *   1) při vykreslení stránky jsou PODSTRČENÉ (jinak by stránka tahala
 *      `@/lib/supabase/server`, což mimo Next spadne) — tady se jen
 *      ověřuje, že konkrétní tlačítko/formulář je svázané se SPRÁVNÝM
 *      jménem funkce ze zdrojáku (žádná záměna Potvrdit/Odmítnout),
 *   2) `akce.ts` se načte ZNOVU, samostatně, se svou vlastní podstrčenou
 *      databází — a spustí se doopravdy, aby šlo ověřit, jaké RPC
 *      a s jakými parametry volá, a kam přesměruje.
 *
 * Že databáze cizí/nevydanou/nesedící směnu odmítne, hlídá krok64, ne
 * tohle — tady jen to, co je VIDĚT a co se VOLÁ.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nactiKomponentu, nactiModul } from './vykreslit.mjs'
import { denZkraceny } from '../lib/upozorneni-text.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)
const REACT = JSON.stringify(import.meta.resolve('react'))
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)
const text = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Řádky z <tbody> — jen ty, co mají <td> (bez záhlaví). */
const radky = (html) => [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes('<td'))
/**
 * Řádek podle id směny. NEJDE hledat jen `value="id"` — u potvrzené
 * směny se formulář Potvrdit (jediné místo, kde by id bylo) vůbec
 * nekreslí (`s.stav !== "potvrzeno"`), takže by hledání tiše nenašlo
 * nic a další kontroly by běžely nad prázdným řetězcem. Proto se řádek
 * hledá i podle dne, který je v tabulce VŽDY.
 */
const radekS = (html, id, denText) =>
  radky(html).find((r) => r.includes(`value="${id}"`) || (denText && r.includes(denText))) ?? ''

/**
 * Karta na telefonu (`ds-pot-karty` → `<li data-smena>` / `<li
 * data-radek>`) — STEJNÝ vzor jako `radekS` pro tabulku, jen podle
 * `data-*` atributu místo `value="id"` (karta žádný formulář Potvrdit
 * nemusí mít, viz `radekS`). Obě varianty (tabulka i karty) se
 * vykreslí vždy zároveň — mezi nimi přepíná jen CSS (`@container` v
 * `ds-pot-tab`), takže obě jdou ověřit z JEDNOHO vykreslení stránky.
 */
const kartaS = (html, atribut, id) => {
  const m = html.match(new RegExp(`<li[^>]*data-${atribut}="${id}"[^>]*>([\\s\\S]*?)</li>`))
  return m ? m[1] : ''
}

/** Obsah <section aria-label="…"> až po další <section> (nebo konec). */
function sekce(html, label) {
  const i = html.indexOf(`aria-label="${label}"`)
  if (i < 0) return ''
  const start = html.lastIndexOf('<section', i)
  const dalsi = html.indexOf('<section', i + 1)
  return html.slice(start, dalsi > 0 ? dalsi : html.length)
}

const ODKAZ = js(
  `import { createElement } from ${REACT}\n` +
    'export default function Link({ href, children, ...z }) {\n' +
    '  return createElement("a", { href, ...z }, children)\n' +
    '}\n',
)
const NAVIGACE = js(
  'export function redirect(adresa) { throw Object.assign(new Error("NEXT_REDIRECT"), { adresa }) }\n' +
    'export function notFound() { throw new Error("NEXT_NOT_FOUND") }\n',
)
const DOTAZ = js('export function funkceNeexistuje(c) { return c?.code === "PGRST202" }\n')
/** Stejná (čistá) implementace jako `lib/provozni-den.ts#posunDatum` — ten
 * soubor nese `import 'server-only'`, což mimo Next spadne. */
const PROVOZNI_DEN = js(
  'export function posunDatum(datum, dnu) {\n' +
    '  const [r, m, d] = datum.split("-").map(Number)\n' +
    '  const posunuty = new Date(Date.UTC(r, m - 1, d + dnu))\n' +
    '  return posunuty.toISOString().slice(0, 10)\n' +
    '}\n',
)

/* ======================================================================
   1. STRÁNKA /[rozsah]/smeny/potvrzeni
   ====================================================================== */

globalThis.__pot = null
const AUTHZ = js(
  'export async function getContext() { return globalThis.__pot.ctx }\n' +
    'export async function hasAccess(t, pravo, pobocka) {\n' +
    '  return globalThis.__pot.manageBranches.includes(pobocka)\n' +
    '}\n',
)
const FIRMA = js(
  'export async function getCurrentTenantId() { return globalThis.__pot.tenantId }\n' +
    'export async function zkusPristup() { return globalThis.__pot.pristup }\n',
)
const SERVER = js(
  'export async function getServerSupabase() {\n' +
    '  return {\n' +
    '    rpc: async (jmeno, args) => {\n' +
    '      globalThis.__pot.rpc.push([jmeno, args])\n' +
    '      const v = globalThis.__pot.odpoved[jmeno]\n' +
    '      if (typeof v === "function") return v(args)\n' +
    '      return v ?? { data: [], error: null }\n' +
    '    },\n' +
    '  }\n' +
    '}\n',
)
const STUB_AKCE = js(
  'export async function potvrditVsechnyMojeSmeny() {}\n' +
    'export async function potvrditRadekSmeny() {}\n' +
    'export async function odmitnoutSmenu() {}\n',
)

const Stranka = await nactiKomponentu('app/[rozsah]/smeny/potvrzeni/page.tsx', [
  ['next/link', ODKAZ],
  ['next/navigation', NAVIGACE],
  ['@/lib/authz', AUTHZ],
  ['@/lib/firma', FIRMA],
  ['@/lib/provozni-den', PROVOZNI_DEN],
  ['@/lib/supabase/dotaz', DOTAZ],
  ['@/lib/supabase/server', SERVER],
  ['./akce', STUB_AKCE],
])

async function stranka({ tenantId = 't1', pristup, ctx, manageBranches = [], rpc = {}, ulozeno = {} } = {}) {
  // `ctx` je NEZÁVISLÉ na `pristup`: skutečný `zkusPristup` v odepřeném
  // stavu žádné `ctx` nenese (vrací jen `{ stav: 'odepren' }`) — stránka
  // si ho pak žádá zvlášť přes `getContext`. Bez tohohle rozlišení by
  // mock nedokázal simulovat „člen firmy bez shifts.read, ale se
  // shifts.manage" (nález kontroly 29. 9. 2026). Když `ctx` není zadané
  // zvlášť, spadne se na `pristup.ctx` — ať staré volání `OK(ctx)` (stav
  // 'ok') funguje beze změny.
  globalThis.__pot = { tenantId, pristup, ctx: ctx ?? pristup?.ctx ?? null, manageBranches, rpc: [], odpoved: rpc }
  let adresa = null
  let html = ''
  try {
    const prvek = await Stranka({
      params: Promise.resolve({ rozsah: 'cerna-perla' }),
      searchParams: Promise.resolve(ulozeno),
    })
    html = renderToStaticMarkup(prvek)
  } catch (e) {
    adresa = e.adresa ?? String(e)
  }
  return { html, adresa, rpc: globalThis.__pot.rpc }
}

const OK = (ctx) => ({ stav: 'ok', ctx, scope: { level: 'branch', branchId: 'b1' } })
const CTX_2 = { branches: [{ id: 'b1', name: 'Černá Perla' }, { id: 'b2', name: 'Bernard Bar' }] }

console.log('\n== Přístup: bez firmy, nepřihlášený, bez práva ==')

ma('bez firmy: sdělení, ne pád', (await stranka({ tenantId: null })).html.includes('nepatří k žádné firmě'), true)

const neprihlasen = await stranka({ pristup: { stav: 'neprihlasen' } })
ma('nepřihlášený: přesměruje na /prihlaseni', neprihlasen.adresa, '/prihlaseni')

const odepren = await stranka({ pristup: { stav: 'odepren' }, ctx: CTX_2 })
ma('bez shifts.read a bez shifts.manage kdekoli: „Sem nemáte přístup“, ne pád',
  odepren.html.includes('Sem nemáte přístup'), true)

const odeprenBezClenstvi = await stranka({ pristup: { stav: 'odepren' } })
ma('bez shifts.read a getContext nevrátí nic (není člen firmy): přesměruje, ne pád',
  odeprenBezClenstvi.adresa, '/prihlaseni')

// Nález kontroly 29. 9. 2026: notifikace „smena.odmitnuta" vede vedoucího
// rovnou sem, a takový vedoucí může mít jen shifts.manage, ne shifts.read
// (přesně kombinace, kterou má Bedřich v krok64_scenar). Dřív by narazil
// na plnou stěnu „Sem nemáte přístup" — teď smí dovnitř a vidí aspoň
// sekci „Kdo potvrdil".
const jenManage = await stranka({
  pristup: { stav: 'odepren' },
  ctx: CTX_2,
  manageBranches: ['b1'],
  rpc: { smeny_potvrzeni_pobocky: { data: [], error: null } },
})
ma('bez shifts.read, ale se shifts.manage na jedné pobočce: NEUKÁŽE stěnu',
  jenManage.html.includes('Sem nemáte přístup'), false)
ma('… a ukáže sekci „Kdo potvrdil"', jenManage.html.includes('Kdo potvrdil'), true)
// „Moje" se přesto volá — self-service potvrzení nestojí na shifts.read,
// jen na vlastnictví směny (design bod 6 migrace); kdyby byl volající
// zároveň zaměstnanec s vlastní směnou, uvidí i ji. Tady je bez dat
// (RPC nestubováno → prázdné pole), takže se sekce „Moje" nekreslí.
ma('… „Moje" volá i tak (self-service nepotřebuje shifts.read)',
  jenManage.rpc.some(([jmeno]) => jmeno === 'moje_smeny_k_potvrzeni'), true)
ma('… ale bez dat se nekreslí', jenManage.html.includes('aria-label="Moje směny k potvrzení"'), false)

console.log('\n== Nenasazená migrace a prázdný stav ==')

const nenasazeno = await stranka({
  pristup: OK({ branches: [] }),
  rpc: { moje_smeny_k_potvrzeni: { data: null, error: { code: 'PGRST202', message: 'x' } } },
})
ma('nenasazená migrace: srozumitelná hláška, ne pád', nenasazeno.html.includes('čeká na nasazení databáze'), true)

const jinaChybaMoje = await stranka({
  pristup: OK({ branches: [] }),
  rpc: { moje_smeny_k_potvrzeni: { data: null, error: { code: 'PT403', message: 'Nemáte v téhle firmě zaměstnanecký záznam.' } } },
})
ma('jiná chyba u Mých (bez zaměstnaneckého záznamu): tiše nic, ne pád stránky',
  jinaChybaMoje.html.includes('Není co potvrzovat'), true)

const prazdno = await stranka({ pristup: OK({ branches: [] }), rpc: { moje_smeny_k_potvrzeni: { data: [], error: null } } })
ma('žádné moje a žádná pobočka k vedení: „Není co potvrzovat“', prazdno.html.includes('Není co potvrzovat'), true)

console.log('\n== Moje směny: řádky, hlášky a tlačítka podle stavu ==')

const MOJE = [
  {
    shift_id: 's-ceka', branch_id: 'b1', pobocka: 'Černá Perla', shift_date: '2026-11-03',
    starts_at: '08:00:00', ends_at: '16:00:00', pauza_od: null, pauza_do: null,
    stav: 'ceka', confirmed_at: null, rejected_at: null, rejected_reason: null,
  },
  {
    shift_id: 's-potvrzeno', branch_id: 'b1', pobocka: 'Černá Perla', shift_date: '2026-11-04',
    starts_at: '08:00:00', ends_at: '16:00:00', pauza_od: '12:00:00', pauza_do: '12:30:00',
    stav: 'potvrzeno', confirmed_at: '2026-11-04T09:00:00Z', rejected_at: null, rejected_reason: null,
  },
  {
    shift_id: 's-odmitnuto', branch_id: 'b1', pobocka: 'Černá Perla', shift_date: '2026-11-05',
    starts_at: '08:00:00', ends_at: '16:00:00', pauza_od: null, pauza_do: null,
    stav: 'odmitnuto', confirmed_at: null, rejected_at: '2026-11-05T09:00:00Z', rejected_reason: 'nemoc',
  },
  {
    shift_id: 's-ceka-pauza', branch_id: 'b1', pobocka: 'Černá Perla', shift_date: '2026-11-06',
    starts_at: '08:00:00', ends_at: '16:00:00', pauza_od: '12:00:00', pauza_do: '12:30:00',
    stav: 'ceka', confirmed_at: null, rejected_at: null, rejected_reason: null,
  },
]

const moje = await stranka({ pristup: OK({ branches: [] }), rpc: { moje_smeny_k_potvrzeni: { data: MOJE, error: null } } })
const radkyMoje = radky(moje.html)
ma('čtyři řádky v tabulce Mých směn', radkyMoje.length, 4)
ma('„Potvrdit vše (2)“ — dvě čekající ze čtyř', moje.html.includes('Potvrdit vše (2)'), true)
const strankaZdroj = fs.readFileSync(new URL('app/[rozsah]/smeny/potvrzeni/page.tsx', KOREN), 'utf8')
ma('formulář „Potvrdit vše“ volá potvrditVsechnyMojeSmeny (žádná záměna s jinou akcí)',
  /<form action=\{potvrditVsechnyMojeSmeny\}/.test(strankaZdroj), true)
ma('řádkové tlačítko Potvrdit volá potvrditRadekSmeny (ne potvrditVsechnyMojeSmeny ani odmitnoutSmenu)',
  /<form action=\{potvrditRadekSmeny\}>/.test(strankaZdroj), true)
ma('tlačítko Odmítnout volá odmitnoutSmenu (ne potvrditRadekSmeny)',
  /<OdmitnoutSmenu akce=\{odmitnoutSmenu\}/.test(strankaZdroj), true)

const rCeka = radekS(moje.html, 's-ceka', denZkraceny('2026-11-03'))
ma('čekající: Potvrdit i Odmítnout… oboje nabídnuté', />Potvrdit</.test(rCeka) && rCeka.includes('Odmítnout…'), true)
ma('… a ukazuje „čeká na potvrzení“', /čeká na potvrzení/.test(rCeka), true)
ma('… formulář Potvrdit nese PŘESNÉ znění směny, které potvrdit_smenu porovná (den, čas, prázdná pauza)',
  rCeka.includes('name="smena" value="s-ceka"') &&
    rCeka.includes('name="den" value="2026-11-03"') &&
    rCeka.includes('name="od" value="08:00:00"') &&
    rCeka.includes('name="do" value="16:00:00"') &&
    rCeka.includes('name="pauza_od" value=""') &&
    rCeka.includes('name="pauza_do" value=""'), true)
// Vlastní řádek s pauzou: čekající směna formulář Potvrdit vždycky kreslí (na rozdíl
// od potvrzené směny níž), tak se na něm dá ověřit, že se pauza posílá
// v ODESLANÉM znění, ne prázdná.
const sPauzou = radekS(moje.html, 's-ceka-pauza', denZkraceny('2026-11-06'))
ma('… a u směny s pauzou se pošle taky (ne prázdná)',
  sPauzou.includes('name="pauza_od" value="12:00:00"') && sPauzou.includes('name="pauza_do" value="12:30:00"'), true)

const rPotvrzeno = radekS(moje.html, 's-potvrzeno', denZkraceny('2026-11-04'))
ma('potvrzená: tlačítko Potvrdit zmizí (nemá se čím potvrzovat znovu)', />Potvrdit</.test(rPotvrzeno), false)
ma('… ale Odmítnout… zůstává (potvrzení jde vzít zpět)', rPotvrzeno.includes('Odmítnout…'), true)
ma('… a ukazuje „potvrzeno“ s časem potvrzení', /potvrzeno/.test(rPotvrzeno) && /10:00/.test(rPotvrzeno), true)

const rOdmitnuto = radekS(moje.html, 's-odmitnuto', denZkraceny('2026-11-05'))
ma('odmítnutá: Odmítnout… zmizí (už je odmítnutá)', rOdmitnuto.includes('Odmítnout…'), false)
ma('… ale Potvrdit zůstává (odmítnutí jde vzít zpět)', />Potvrdit</.test(rOdmitnuto), true)
ma('… a ukazuje „odmítnuto“ i důvod', /odmítnuto/.test(rOdmitnuto) && rOdmitnuto.includes('nemoc'), true)

console.log('\n== Moje směny: KARTY na telefonu (ds-pot-karty) — stejná data, jen jiný tvar ==')

/*
 * Nezávislé vizuální ověření (390 px, 29. 9. 2026) našlo tabulku BEZ
 * mobilní varianty: sloupce Stav a Akce byly mimo viditelnou oblast a
 * nic neřeklo, že jde scrollovat doprava. Kontrola, co se nikdy
 * nespustí, tohle projde i nad rozbitým vzhledem (memory „kontrola
 * musí sáhnout na výstup“) — proto se tu čte SKUTEČNÉ HTML karet, ne
 * jen zdroj komponenty.
 */
ma('karty na telefonu se vykreslily (ds-pot-karty), čtyři jako v tabulce',
  (moje.html.match(/class="ds-pot-karta"/g) ?? []).length, 4)

const kCeka = kartaS(moje.html, 'smena', 's-ceka')
ma('karta čekající směny: den i čas jsou vidět', kCeka.includes(denZkraceny('2026-11-03')) && kCeka.includes('08:00') && kCeka.includes('16:00'), true)
ma('… Potvrdit i Odmítnout… oboje nabídnuté (stejně jako v tabulce)',
  />Potvrdit</.test(kCeka) && kCeka.includes('Odmítnout…'), true)
ma('… a ukazuje „čeká na potvrzení“', /čeká na potvrzení/.test(kCeka), true)

const kPotvrzeno = kartaS(moje.html, 'smena', 's-potvrzeno')
ma('karta potvrzené směny: tlačítko Potvrdit zmizí', />Potvrdit</.test(kPotvrzeno), false)
ma('… ale Odmítnout… zůstává', kPotvrzeno.includes('Odmítnout…'), true)

const kOdmitnuto = kartaS(moje.html, 'smena', 's-odmitnuto')
ma('karta odmítnuté směny: Odmítnout… zmizí', kOdmitnuto.includes('Odmítnout…'), false)
ma('… ale Potvrdit zůstává a je vidět důvod', />Potvrdit</.test(kOdmitnuto) && kOdmitnuto.includes('nemoc'), true)

const cssKaretMoje = fs.readFileSync(new URL('app/_komponenty.css', KOREN), 'utf8')
ma('CSS přepíná tabulku/karty podle ŠÍŘKY OBSAHU (@container), ne okna (@media) — stejný důvod jako Výdělky',
  /@container[^{]*\{\s*\.ds-pot-tabulka-obal\s*\{\s*display:\s*none/.test(cssKaretMoje), true)
ma('… a karty se v tom samém zlomu ukážou', /\.ds-pot-karty\s*\{\s*display:\s*block/.test(cssKaretMoje), true)

console.log('\n== Hlášky po akci (query parametry z akce.ts) ==')

const hlaska = async (ulozeno) =>
  text((await stranka({ pristup: OK({ branches: [] }), rpc: { moje_smeny_k_potvrzeni: { data: [], error: null } }, ulozeno })).html)

ma('ulozeno=vse&pocet=3 → „Potvrzeno 3 směny.“ (skloňování z lib/sklonovani)',
  (await hlaska({ ulozeno: 'vse', pocet: '3' })).includes('Potvrzeno 3 směny.'), true)
ma('ulozeno=vse&pocet=0 → nic nebylo co potvrdit',
  (await hlaska({ ulozeno: 'vse', pocet: '0' })).includes('Nebylo co potvrdit'), true)
ma('ulozeno=jedna → „Směna potvrzená.“', (await hlaska({ ulozeno: 'jedna' })).includes('Směna potvrzená.'), true)
ma('ulozeno=odmitnuto → hláška zmiňuje upozornění vedoucímu',
  (await hlaska({ ulozeno: 'odmitnuto' })).includes('Vedoucí pobočky o tom dostal upozornění'), true)
ma('chyba=… → dekódovaná hláška databáze je vidět',
  (await hlaska({ chyba: encodeURIComponent('Směny v téhle firmě nemůžete potvrzovat.') }))
    .includes('Směny v téhle firmě nemůžete potvrzovat.'), true)

console.log('\n== Kdo potvrdil (přehled vedoucího) ==')

const RADKY_B1 = [
  { shift_id: 'p1', employee_id: 'e1', jmeno: 'Radek Nový', shift_date: '2026-11-03', starts_at: '08:00:00', ends_at: '16:00:00', stav: 'potvrzeno', rozhodnuto_kdy: '2026-11-03T09:00:00Z', rejected_reason: null },
]
const RADKY_B2 = [
  { shift_id: 'p2', employee_id: 'e2', jmeno: 'Jana Malá', shift_date: '2026-11-04', starts_at: '08:00:00', ends_at: '16:00:00', stav: 'odmitnuto', rozhodnuto_kdy: '2026-11-04T09:00:00Z', rejected_reason: 'nemoc' },
]

const jednaPobocka = await stranka({
  pristup: OK(CTX_2), manageBranches: ['b1'],
  rpc: {
    moje_smeny_k_potvrzeni: { data: [], error: null },
    smeny_potvrzeni_pobocky: (a) => ({ data: a.p_branch === 'b1' ? RADKY_B1 : [], error: null }),
  },
})
const kdoJedna = sekce(jednaPobocka.html, 'Kdo potvrdil')
ma('sekce „Kdo potvrdil“ se vykreslila (výřez není prázdný)', kdoJedna.length > 0, true)
ma('vedoucí JEDNÉ pobočky: bez sloupce Pobočka (jinak zbytečný)', (kdoJedna.match(/>Pobočka</g) ?? []).length, 0)
ma('… vidí Radka a že je potvrzeno', text(kdoJedna).includes('Radek Nový') && /potvrzeno/.test(kdoJedna), true)
ma('… a odsud žádná akce nejde (jen čtení — self-service, ne „za zaměstnance“)',
  /<form|<button/.test(kdoJedna), false)

const dvePobocky = await stranka({
  pristup: OK(CTX_2), manageBranches: ['b1', 'b2'],
  rpc: {
    moje_smeny_k_potvrzeni: { data: [], error: null },
    smeny_potvrzeni_pobocky: (a) => ({ data: a.p_branch === 'b1' ? RADKY_B1 : RADKY_B2, error: null }),
  },
})
const kdoDve = sekce(dvePobocky.html, 'Kdo potvrdil')
ma('vedoucí DVOU poboček: sloupec Pobočka JE (jinak nepozná, kde je řádek)', (kdoDve.match(/>Pobočka</g) ?? []).length, 1)
ma('… vidí oba: Radka (potvrzeno) i Janu (odmítnuto s důvodem)',
  text(kdoDve).includes('Radek Nový') && text(kdoDve).includes('Jana Malá') && kdoDve.includes('nemoc'), true)

console.log('\n== Kdo potvrdil: KARTY na telefonu (ds-pot-karty) — stejná pravidla ==')

ma('jedna pobočka: karta se vykreslila a nese jméno i „potvrzeno“, bez akce (jen čtení)',
  (() => {
    const k = kartaS(jednaPobocka.html, 'radek', 'p1-e1')
    return k.includes('Radek Nový') && /potvrzeno/.test(k) && !/<form|<button/.test(k)
  })(), true)
ma('… na JEDNÉ pobočce karta nepíše název pobočky (stejně jako tabulka bez sloupce)',
  !kartaS(jednaPobocka.html, 'radek', 'p1-e1').includes('Černá Perla'), true)

const kartaDvePob = kartaS(dvePobocky.html, 'radek', 'p2-e2')
ma('DVĚ pobočky: karta Jany nese jméno I pobočku (jinak nepozná, kde je řádek)',
  kartaDvePob.includes('Jana Malá') && kartaDvePob.includes('Bernard Bar'), true)
ma('… a důvod odmítnutí', kartaDvePob.includes('nemoc'), true)

const bezPrava = await stranka({
  pristup: OK(CTX_2), manageBranches: [],
  rpc: { moje_smeny_k_potvrzeni: { data: MOJE, error: null } },
})
ma('bez shifts.manage na žádné pobočce: sekce „Kdo potvrdil“ se vůbec nekreslí',
  bezPrava.html.includes('Kdo potvrdil'), false)

/* ======================================================================
   2. SEROVÉROVÉ AKCE (akce.ts) — spuštěné doopravdy
   ====================================================================== */

console.log('\n== Serverové akce: správné RPC, správné parametry, přesměrování ==')

globalThis.__akce = null
const CACHE_A = js('export function revalidatePath(c) { globalThis.__akce.cesty.push(c) }\n')
const FIRMA_A = js('export async function getCurrentTenantId() { return globalThis.__akce.tenantId }\n')
const DOTAZ_A = js('export function funkceNeexistuje(c) { return c?.code === "PGRST202" }\n')
const SERVER_A = js(
  'export async function getServerSupabase() {\n' +
    '  return { rpc: async (jmeno, args) => { globalThis.__akce.rpc.push([jmeno, args]); return globalThis.__akce.odpoved(jmeno, args) } }\n' +
    '}\n',
)

const akce = await nactiModul('app/[rozsah]/smeny/potvrzeni/akce.ts', [
  ['next/cache', CACHE_A],
  ['next/navigation', NAVIGACE],
  ['@/lib/firma', FIRMA_A],
  ['@/lib/supabase/dotaz', DOTAZ_A],
  ['@/lib/supabase/server', SERVER_A],
])

async function spustit(fn, pole, { tenantId = 't1', odpoved = () => ({ data: null, error: null }) } = {}) {
  globalThis.__akce = { tenantId, rpc: [], cesty: [], odpoved }
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', ...pole })) fd.set(k, v)
  let adresa = null
  try {
    await fn(fd)
  } catch (e) {
    adresa = e.adresa ?? String(e)
  }
  return { adresa, ...globalThis.__akce }
}

const vse = await spustit(akce.potvrditVsechnyMojeSmeny, {}, { odpoved: () => ({ data: 3, error: null }) })
ma('potvrdit vše: volá potvrdit_vsechny_moje_smeny jen s firmou', JSON.stringify(vse.rpc),
  JSON.stringify([['potvrdit_vsechny_moje_smeny', { p_tenant: 't1' }]]))
ma('… přesměruje s počtem v adrese', vse.adresa, '/cerna-perla/smeny/potvrzeni?ulozeno=vse&pocet=3')
ma('… a obnoví obrazovku (revalidatePath)', vse.cesty.includes('/cerna-perla/smeny/potvrzeni'), true)

const vseChyba = await spustit(akce.potvrditVsechnyMojeSmeny, {}, {
  odpoved: () => ({ data: null, error: { message: 'Směny v téhle firmě nemůžete potvrzovat.' } }),
})
ma('potvrdit vše, chyba databáze: hláška databáze jde do adresy beze změny',
  vseChyba.adresa, '/cerna-perla/smeny/potvrzeni?chyba=' + encodeURIComponent('Směny v téhle firmě nemůžete potvrzovat.'))

const vseNenasazeno = await spustit(akce.potvrditVsechnyMojeSmeny, {}, {
  odpoved: () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }),
})
ma('potvrdit vše, nenasazená migrace: srozumitelná věta, ne technická hláška',
  vseNenasazeno.adresa, '/cerna-perla/smeny/potvrzeni?chyba=' + encodeURIComponent('Potvrzování směn čeká na nasazení databáze.'))

const radekOK = await spustit(akce.potvrditRadekSmeny, {
  smena: 's1', den: '2026-11-03', od: '08:00', do: '16:00', pauza_od: '12:00', pauza_do: '12:30',
})
ma('potvrdit řádek: volá potvrdit_smenu se všemi poli znění', JSON.stringify(radekOK.rpc), JSON.stringify([
  ['potvrdit_smenu', { p_tenant: 't1', p_smena: 's1', p_den: '2026-11-03', p_od: '08:00', p_do: '16:00', p_pauza_od: '12:00', p_pauza_do: '12:30' }],
]))
ma('… přesměruje ulozeno=jedna', radekOK.adresa, '/cerna-perla/smeny/potvrzeni?ulozeno=jedna')

const radekBezPauzy = await spustit(akce.potvrditRadekSmeny, {
  smena: 's2', den: '2026-11-04', od: '08:00', do: '16:00', pauza_od: '', pauza_do: '',
})
ma('prázdný řetězec pauzy jde jako null (ne prázdný text, aby sedělo s DB)',
  radekBezPauzy.rpc[0][1].p_pauza_od === null && radekBezPauzy.rpc[0][1].p_pauza_do === null, true)

const radekBezSmeny = await spustit(akce.potvrditRadekSmeny, { den: '2026-11-03', od: '08:00', do: '16:00' })
ma('potvrdit řádek bez id směny: databáze se vůbec nezeptá', radekBezSmeny.rpc.length, 0)
ma('… a vrátí se zpátky na obrazovku', radekBezSmeny.adresa, '/cerna-perla/smeny/potvrzeni')

const odmitnutiOK = await spustit(akce.odmitnoutSmenu, { smena: 's3', duvod: '  nemoc  ' }, {
  odpoved: () => ({ data: 'zaznam-x', error: null }),
})
ma('odmítnutí: volá odmitnout_smenu s OŘEZANÝM důvodem (žádné okolní mezery v databázi)',
  JSON.stringify(odmitnutiOK.rpc), JSON.stringify([['odmitnout_smenu', { p_tenant: 't1', p_smena: 's3', p_duvod: 'nemoc' }]]))
ma('… přesměruje ulozeno=odmitnuto', odmitnutiOK.adresa, '/cerna-perla/smeny/potvrzeni?ulozeno=odmitnuto')

const odmitnutiBezSmeny = await spustit(akce.odmitnoutSmenu, { duvod: 'nemoc' })
ma('odmítnutí bez id směny: databáze se vůbec nezeptá', odmitnutiBezSmeny.rpc.length, 0)

const odmitnutiChyba = await spustit(akce.odmitnoutSmenu, { smena: 's4', duvod: 'x' }, {
  odpoved: () => ({ data: null, error: { message: 'Napište důvod odmítnutí — bez něj vedoucí neví, co se stalo.' } }),
})
ma('odmítnutí, databáze odmítla (prázdný důvod po ořezání): hláška jde beze změny',
  odmitnutiChyba.adresa, '/cerna-perla/smeny/potvrzeni?chyba=' + encodeURIComponent('Napište důvod odmítnutí — bez něj vedoucí neví, co se stalo.'))

/* ======================================================================
   3. DVOUKROKOVÉ ODMÍTNUTÍ (odmitnout.tsx)
   ====================================================================== */

console.log('\n== Formulář odmítnutí: zavřený stav a povinný důvod ==')

const OdmitnoutSmenu = await nactiKomponentu('app/[rozsah]/smeny/potvrzeni/odmitnout.tsx')
const zavreno = renderToStaticMarkup(createElement(OdmitnoutSmenu, { akce: async () => {}, smena: 's1', rozsah: 'cerna-perla' }))
ma('zavřený stav: jen tlačítko „Odmítnout…“, žádný formulář ani vstup', text(zavreno), 'Odmítnout…')
ma('… je to <button>, ne rovnou formulář (dvoukrokové, jako storno u Docházky/Záloh)',
  /^<button[^>]*>Odmítnout…<\/button>$/.test(zavreno), true)

// Otevřený stav se bez prohlížeče kliknutím nedá vyvolat (useState) —
// stejná mez jako u potvrzeni-za-zamestnance.tsx v zalohy.test.mjs.
// Ověřuje se proto ZDROJÁK: přesně to, co druhý krok pošle a vyžaduje.
const zdrojOdmitnout = fs.readFileSync(new URL('app/[rozsah]/smeny/potvrzeni/odmitnout.tsx', KOREN), 'utf8')
ma('otevřený formulář nese id směny a rozsah (skryté vstupy)',
  zdrojOdmitnout.includes('name="smena" value={smena}') && zdrojOdmitnout.includes('name="rozsah" value={rozsah}'), true)
ma('důvod je POVINNÝ (required) — konzistentně se stornem úseku docházky',
  /name="duvod"\s+required/.test(zdrojOdmitnout), true)
ma('formulář volá podstrčenou akci (action={akce}), ne vlastní kopii',
  /<form action=\{akce\}/.test(zdrojOdmitnout), true)
ma('nic se netiše nemaže — druhé tlačítko je jen „Zpět“ (zavře formulář)',
  /onClick=\{\(\) => setOtevreno\(false\)\}/.test(zdrojOdmitnout) && zdrojOdmitnout.includes('Zpět'), true)

/* ======================================================================
   4. DVA VSTUPNÍ ODKAZY (Rozpis na počítači, karta na telefonu)
   ====================================================================== */

console.log('\n== Odkaz na Potvrzení směn z Rozpisu (počítač i telefon) ==')

const rozpisZdroj = fs.readFileSync(new URL('app/[rozsah]/smeny/rozpis.tsx', KOREN), 'utf8')
const iLinkDesktop = rozpisZdroj.indexOf('smeny/potvrzeni')
const iPlanovaniTernar = rozpisZdroj.indexOf('{planovani ? (')
ma('odkaz na počítači existuje a stojí PŘED podmínkou „jen kdo plánuje“ (vidí ho každý)',
  iLinkDesktop > 0 && iPlanovaniTernar > iLinkDesktop, true)
ma('… vede na správnou trasu (rozsah z Rozpisu)',
  rozpisZdroj.includes('href={`/${mobil.rozsah}/smeny/potvrzeni`}'), true)

const pohledyZdroj = fs.readFileSync(new URL('app/[rozsah]/smeny/mobil/pohledy.tsx', KOREN), 'utf8')
const iKartaPotvrzeni = pohledyZdroj.indexOf('smeny/potvrzeni')
const iTymTernar = pohledyZdroj.indexOf('p.smiVidetTym ? (')
ma('karta na telefonu vede na stejnou trasu a stojí PŘED „Tým dnes“ (vidí ji každý)',
  pohledyZdroj.includes('href={`/${p.rozsah}/smeny/potvrzeni`}') && iKartaPotvrzeni > 0 && iTymTernar > iKartaPotvrzeni, true)
ma('… je to stejná karta jako „Tým dnes“ (ds-sm-karta-tym), žádný nový styl',
  /href=\{`\/\$\{p\.rozsah\}\/smeny\/potvrzeni`\}\s+className="ds-sm-karta-tym"/.test(pohledyZdroj), true)

const cssZdroj = fs.readFileSync(new URL('app/_komponenty.css', KOREN), 'utf8')
ma('.ds-sm-karta-tym funguje i jako odkaz (text-decoration: none, jinak podtržený text)',
  /\.ds-sm-karta-tym\s*\{[^}]*text-decoration:\s*none/.test(cssZdroj), true)

console.log('\n== Trasa existuje (nevede na 404) ==')

ma('page.tsx existuje', fs.existsSync(new URL('app/[rozsah]/smeny/potvrzeni/page.tsx', KOREN)), true)
ma('akce.ts existuje', fs.existsSync(new URL('app/[rozsah]/smeny/potvrzeni/akce.ts', KOREN)), true)
ma('odmitnout.tsx existuje', fs.existsSync(new URL('app/[rozsah]/smeny/potvrzeni/odmitnout.tsx', KOREN)), true)
ma('stránka se dá vykreslit (žádná nepřepsaná/chybějící závislost)', typeof Stranka, 'function')

/* ======================================================================
   5. KONTRAKT S MIGRACÍ 20260929100000
   ====================================================================== */

console.log('\n== Shoda jmen se signaturami v migraci ==')

const migrace = fs.readFileSync(new URL('supabase/migrations/20260929100000_smeny_potvrzeni_tabulka.sql', KOREN), 'utf8')
const jmena = (seznam) => seznam.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
const hlavicka = (fn) => migrace.match(new RegExp(`create (?:or replace )?function public\\.${fn}\\(([^)]*)\\)`))

ma('potvrdit_vsechny_moje_smeny(p_tenant)', JSON.stringify(jmena(hlavicka('potvrdit_vsechny_moje_smeny')?.[1] ?? '')),
  JSON.stringify(Object.keys(vse.rpc[0]?.[1] ?? {})))
ma('odmitnout_smenu(p_tenant, p_smena, p_duvod)', JSON.stringify(jmena(hlavicka('odmitnout_smenu')?.[1] ?? '')),
  JSON.stringify(Object.keys(odmitnutiOK.rpc[0]?.[1] ?? {})))
ma('potvrdit_smenu beze změny parametrů (p_tenant, p_smena, p_den, p_od, p_do, p_pauza_od, p_pauza_do)',
  JSON.stringify(jmena(hlavicka('potvrdit_smenu')?.[1] ?? '')), JSON.stringify(Object.keys(radekOK.rpc[0]?.[1] ?? {})))

const vystupMoje = migrace.match(/create function public\.moje_smeny_k_potvrzeni\(p_tenant uuid\)\s*returns table \(([\s\S]*?)\)\s*language/)
ma('moje_smeny_k_potvrzeni vrací přesně sloupce, které stránka čte',
  jmena(vystupMoje?.[1] ?? '').sort().join(','), Object.keys(MOJE[0]).sort().join(','))

const vystupPobocky = migrace.match(/create function public\.smeny_potvrzeni_pobocky\([\s\S]*?\)\s*returns table \(([\s\S]*?)\)\s*language/)
ma('smeny_potvrzeni_pobocky vrací přesně sloupce, které stránka čte (+ pobočka se dolepí klientsky)',
  jmena(vystupPobocky?.[1] ?? '').sort().join(','), Object.keys(RADKY_B1[0]).sort().join(','))

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
