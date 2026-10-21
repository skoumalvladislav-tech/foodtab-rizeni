#!/usr/bin/env node
/**
 * Jiné platby — obrazovky: vstup do agendy, přehled, nový záznam,
 * nahrání dokladu, odkaz na originál a karta v Tržbách.
 *
 * Pusť:
 *   node scripts/jine-platby-obrazovka.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE SPOUŠTÍ A CO ČTE
 *
 *   1. Čistá logika lib/jine-platby-soubory.ts (kontrola výběru, cesta
 *      v úložišti, rozměry zmenšení, id z hlášky o duplicitě) se SPOUŠTÍ.
 *      Tvar cesty se navíc porovná s TEXTEM migrace — rozhoduje databáze.
 *   2. Kreslicí komponenty se VYKRESLÍ (scripts/vykreslit.mjs): stavová
 *      značka, obsah Tržeb s kartou Ostatní tržby a Jiné platby, nahrání
 *      dokladu a formulář nového záznamu. Podstrčené je jen to, co mimo
 *      Next nejde (next/link, next/navigation, serverové akce, prohlížečový
 *      klient Supabase) — součty a texty jdou ze skutečného kódu.
 *   3. Stránky, serverové akce a route se ČTOU jako text bez komentářů.
 *      Serverovou komponentu s přihlášením a databází v Node spustit nejde;
 *      kontroly proto míří na přesné řádky (pořadí, seznam povolených
 *      hodnot, hlavičky odpovědi), ne na volné „obsahuje".
 *
 * Každá kontrola se zkoušela schválným rozbitím kódu (16. 10. 2026) —
 * seznam rozbití je v závěrečné zprávě implementace.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  KVALITY_JPEG_DOKLADU,
  NEJDELSI_STRANA_DOKLADU,
  NEJDELSI_STRANA_DOKLADU_NOUZOVE,
  POKUSY_ZMENSENI,
  PRIPONY_SOUBORU,
  cestaSouboru,
  overitCestu,
  rozmeryZmenseni,
  zaznamZDuplicity,
  zkontrolovatPoZmenseni,
  zkontrolovatVyber,
  zmensitPostupne,
} from '../lib/jine-platby-soubory.ts'
import { MAX_BAJTU_OBRAZKU_PRO_AI, MAX_BAJTU_PRO_AI, MAX_BAJTU_SOUBORU, MAX_SOUBORU_NA_ZAZNAM, TYPY_SOUBORU } from '../lib/jine-platby-typy.ts'
import { prevestPrehled } from '../lib/pokladna-trzby.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Zdroj bez komentářů (JSX, blokových i celořádkových) a s LF konci řádků. */
const bezKomentaru = (t) =>
  t
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
/** Chybějící soubor = prázdný text: kontroly nad ním spadnou jmenovitě, test nespadne výjimkou. */
const text = (soubor) => (existsSync(soubor) ? readFileSync(soubor, 'utf8') : '')
const zdroj = (soubor) => bezKomentaru(text(soubor))
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod)

const AGENDA = 'app/[rozsah]/finance/trzby/jine-platby'
const SOUBORY = {
  prehled: `${AGENDA}/page.tsx`,
  novy: `${AGENDA}/novy/page.tsx`,
  formular: `${AGENDA}/novy/formular.tsx`,
  akceZalozit: `${AGENDA}/akce-zalozit.ts`,
  nahrat: `${AGENDA}/nahrat-doklad.tsx`,
  akceSoubory: `${AGENDA}/akce-soubory.ts`,
  znacka: `${AGENDA}/znacka-stavu.tsx`,
  route: 'app/api/jine-platby/soubor/[id]/route.ts',
  pristup: 'lib/jine-platby-pristup.ts',
  soubory: 'lib/jine-platby-soubory.ts',
  trzbyObsah: 'app/[rozsah]/finance/trzby/obsah.tsx',
  trzbyStranka: 'app/[rozsah]/finance/trzby/page.tsx',
}

// S písmeny schválně — jinak by kontroly „malými písmeny" nic neměřily.
const T = 'a1111111-1111-4111-8111-11111111111a'
const B = 'b2222222-2222-4222-8222-22222222222b'
const Z = 'c3333333-3333-4333-8333-33333333333c'
const U = 'd4444444-4444-4444-8444-44444444444d'
const MB = 1024 * 1024

/* =====================================================================
 * 1. ČISTÁ LOGIKA — lib/jine-platby-soubory.ts
 * ===================================================================== */

console.log('\n== Kontrola výběru souborů ==')
{
  const v = zkontrolovatVyber(
    [
      { name: 'sjetina.jpg', type: 'image/jpeg', size: 2 * MB },
      { name: 'IMG_0001.HEIC', type: 'image/heic', size: 1 * MB },
      { name: 'velka.jpg', type: 'image/jpeg', size: MAX_BAJTU_PRO_AI + 1 },
      { name: 'ucet.pdf', type: 'application/pdf', size: 9 * MB },
      { name: 'obrovske.pdf', type: 'application/pdf', size: MAX_BAJTU_SOUBORU + 1 },
      { name: 'poznamka.txt', type: 'text/plain', size: 100 },
      { name: 'prazdna.png', type: 'image/png', size: 0 },
      { name: 'bez-typu.pdf', type: '', size: 1000 },
      { name: 'bez-typu.bin', type: '', size: 1000 },
    ],
    0,
  )
  const akce = Object.fromEntries(v.polozky.map((p) => [p.index, p.akce]))
  ok('JPEG do stropu pro AI jde tak, jak je', akce[0] === 'nahrat')
  ok('HEIC se zmenší (převede na JPEG)', akce[1] === 'zmensit')
  ok('JPEG nad strop pro AI se zmenší', akce[2] === 'zmensit')
  ok('PDF do 10 MB jde tak, jak je', akce[3] === 'nahrat')
  ok('PDF nad 10 MB se odmítne jmenovitě', !(4 in akce) && v.chyby.some((c) => c.includes('obrovske.pdf') && c.includes('10')))
  ok('textový soubor se odmítne (jen fotka nebo PDF)', !(5 in akce) && v.chyby.some((c) => c.includes('poznamka.txt')))
  ok('prázdný soubor se odmítne', !(6 in akce) && v.chyby.some((c) => c.includes('prazdna.png') && c.includes('prázdný')))
  ok('PDF bez typu od prohlížeče se pozná podle přípony', akce[7] === 'nahrat')
  ok('neznámý soubor bez typu se odmítne', !(8 in akce) && v.chyby.some((c) => c.includes('bez-typu.bin')))
  ok(`výsledek: 5 vzatých, 4 odmítnuté (vzato ${v.polozky.length}, chyb ${v.chyby.length})`, v.polozky.length === 5 && v.chyby.length === 4)
}
{
  const tri = [1, 2, 3].map((i) => ({ name: `f${i}.jpg`, type: 'image/jpeg', size: 1000 }))
  const v = zkontrolovatVyber(tri, MAX_SOUBORU_NA_ZAZNAM - 1)
  ok(`strop ${MAX_SOUBORU_NA_ZAZNAM} souborů na záznam: při ${MAX_SOUBORU_NA_ZAZNAM - 1} už vezme jen jeden`,
    v.polozky.length === 1 && v.polozky[0].index === 0 && v.chyby.length === 2 && v.chyby.every((c) => c.includes(`nejvýš ${MAX_SOUBORU_NA_ZAZNAM}`)))
  ok('plný záznam nevezme nic', zkontrolovatVyber(tri, MAX_SOUBORU_NA_ZAZNAM).polozky.length === 0)
}

console.log('\n== Strop fotky pro AI (5 MB): co se zmenší ==')
{
  // API bere obrázek nejvýš 10 MB až v base64 — fotka mezi 5 a 8 MB se dřív
  // nahrála beze změny a rozpoznání by ji odmítlo.
  const v = zkontrolovatVyber(
    [
      { name: 'presne.jpg', type: 'image/jpeg', size: MAX_BAJTU_OBRAZKU_PRO_AI },
      { name: 'nad.jpg', type: 'image/jpeg', size: MAX_BAJTU_OBRAZKU_PRO_AI + 1 },
      { name: 'sest.png', type: 'image/png', size: 6 * MB },
      { name: 'sest.webp', type: 'image/webp', size: 6 * MB },
      { name: 'sest.pdf', type: 'application/pdf', size: 6 * MB },
    ],
    0,
  )
  const akce = Object.fromEntries(v.polozky.map((p) => [p.index, p.akce]))
  ok('fotka přesně 5 MB jde tak, jak je', akce[0] === 'nahrat')
  ok('JPEG o bajt nad 5 MB se zmenší', akce[1] === 'zmensit')
  ok('PNG 6 MB se zmenší (dřív by šel beze změny — strop byl 8 MB)', akce[2] === 'zmensit')
  ok('WebP 6 MB se zmenší', akce[3] === 'zmensit')
  ok('PDF 6 MB jde tak, jak je (zmenšit nejde, strop PDF je jiný)', akce[4] === 'nahrat' && v.chyby.length === 0)
}

console.log('\n== Po zmenšení ==')
ok('HEIC, který se převést nepodařilo, se odmítne', zkontrolovatPoZmenseni('a.heic', 'image/heic', MB) !== null)
ok('JPEG nad 10 MB i po zmenšení se odmítne', zkontrolovatPoZmenseni('a.jpg', 'image/jpeg', MAX_BAJTU_SOUBORU + 1) !== null)
ok('JPEG 5 MB projde', zkontrolovatPoZmenseni('a.jpg', 'image/jpeg', 5 * MB) === null)
{
  const nad = zkontrolovatPoZmenseni('sjetina.jpg', 'image/jpeg', MAX_BAJTU_OBRAZKU_PRO_AI + 1)
  ok(`fotka i po zmenšení nad 5 MB se odmítne s vysvětlením (${nad})`,
    typeof nad === 'string' && nad.includes('sjetina.jpg') && nad.includes('nepodařilo zmenšit pod 5,0 MB') && nad.includes('PDF'))
  ok('PNG 6 MB (nezmenšené, prohlížeč to neuměl) se odmítne', zkontrolovatPoZmenseni('a.png', 'image/png', 6 * MB) !== null)
  ok('PDF 9 MB projde (pod stropem úložiště 10 MB)', zkontrolovatPoZmenseni('a.pdf', 'application/pdf', 9 * MB) === null)
  ok('PDF nad 10 MB se odmítne', zkontrolovatPoZmenseni('a.pdf', 'application/pdf', MAX_BAJTU_SOUBORU + 1) !== null)
}

console.log('\n== Zmenšení po pokusech: 4000 px 0,9 → 0,8 → 3000 px ==')
{
  ok('nouzová delší strana 3000 px', NEJDELSI_STRANA_DOKLADU_NOUZOVE === 3000)
  ok(`pořadí pokusů (${POKUSY_ZMENSENI.map((p) => `${p.strana}/${p.kvalita}`).join(', ')})`,
    POKUSY_ZMENSENI.map((p) => `${p.strana}/${p.kvalita}`).join() === '4000/0.9,4000/0.8,3000/0.9,3000/0.8')
  // Podstrčený kodér: velikost výsledku podle pokusu, zapisuje, co se zkoušelo.
  const koder = (velikosti) => {
    const volani = []
    const fn = async (pokus) => {
      volani.push(`${pokus.strana}/${pokus.kvalita}`)
      const v = velikosti[volani.length - 1]
      return v === null ? null : { size: v }
    }
    return { fn, volani }
  }
  const hned = koder([4 * MB, 1, 1, 1])
  const r1 = await zmensitPostupne(hned.fn)
  ok('první pokus se vejde → hned konec (jediné kódování, 4000 px / 0,9)', r1.vejdeSe && r1.blob.size === 4 * MB && hned.volani.join() === '4000/0.9')
  const treti = koder([6 * MB, 5.5 * MB, 4.5 * MB, 1])
  const r3 = await zmensitPostupne(treti.fn)
  ok(`vejde se až 3000 px → ten (${treti.volani.join(', ')})`, r3.vejdeSe && r3.blob.size === 4.5 * MB && r3.pokus.strana === 3000 && treti.volani.length === 3)
  const nic = koder([7 * MB, 5.2 * MB, 6 * MB, 5.6 * MB])
  const rNic = await zmensitPostupne(nic.fn)
  ok('nevejde se žádný → nejmenší výsledek s vejdeSe: false (zkouší všechny čtyři)',
    !rNic.vejdeSe && rNic.blob.size === 5.2 * MB && nic.volani.length === 4)
  ok('a ten se pak odmítne s vysvětlením', zkontrolovatPoZmenseni('a.jpg', 'image/jpeg', rNic.blob.size) !== null)
  const neumi = koder([null, 3 * MB, 1, 1])
  const rNeumi = await zmensitPostupne(neumi.fn)
  ok('pokus, který prohlížeč neumí (null), se přeskočí', rNeumi.vejdeSe && rNeumi.blob.size === 3 * MB && rNeumi.pokus.kvalita === 0.8)
  const nikdy = await zmensitPostupne(koder([null, null, null, null]).fn)
  ok('prohlížeč neumí nic → blob null (nahraje se originál a kontrola po zmenšení rozhodne)', nikdy.blob === null && !nikdy.vejdeSe)
}
ok('typy souborů = smlouva (jpeg, png, webp, pdf)', Object.keys(PRIPONY_SOUBORU).sort().join() === [...TYPY_SOUBORU].sort().join())

console.log('\n== Rozměry zmenšení dokladu (delší strana nejvýš 4000 px) ==')
{
  ok('nejdelší strana dokladu je 4000 px (ne 2000 jako fotky ze zpráv)', NEJDELSI_STRANA_DOKLADU === 4000)
  ok('kvalita JPEG nejdřív 0,9', KVALITY_JPEG_DOKLADU[0] === 0.9)
  const naSirku = rozmeryZmenseni(6000, 4000)
  ok(`6000×4000 → 4000×2667 (${naSirku.sirka}×${naSirku.vyska})`, naSirku.sirka === 4000 && naSirku.vyska === 2667)
  const proužek = rozmeryZmenseni(1000, 8000)
  ok(`účtenka 1000×8000 → 500×4000 (${proužek.sirka}×${proužek.vyska})`, proužek.sirka === 500 && proužek.vyska === 4000)
  const mala = rozmeryZmenseni(1200, 900)
  ok('malá fotka se nezvětšuje', mala.sirka === 1200 && mala.vyska === 900)
  const presne = rozmeryZmenseni(4000, 3000)
  ok('přesně 4000 zůstává', presne.sirka === 4000 && presne.vyska === 3000)
  const tenka = rozmeryZmenseni(1, 50000)
  ok('nikdy pod 1 px', tenka.sirka === 1 && tenka.vyska === 4000)
}

console.log('\n== Cesta v úložišti ==')
{
  const cesta = cestaSouboru(T.toUpperCase(), B, Z, U.toUpperCase(), 'image/jpeg')
  ok(`tvar <firma>/<pobočka>/<záznam>/<uuid>.<přípona>, malými písmeny (${cesta})`, cesta === `${T}/${B}/${Z}/${U}.jpg`)
  ok('PDF dostane příponu pdf', cestaSouboru(T, B, Z, U, 'application/pdf').endsWith('.pdf'))

  // Zdroj pravdy je migrace: app.jine_platby_cesta pustí jen tenhle tvar jména souboru.
  const migrace = readFileSync('supabase/migrations/20261016100000_jine_platby.sql', 'utf8')
  const vzor = migrace.match(/storage\.filename\(p_name\) !~ '(\^\[0-9a-f-\]\{36\}\\\.\(([a-z|]+)\)\$)'/)
  ok('tvar jména souboru se v migraci našel', vzor !== null)
  if (vzor) {
    ok('přípony = to, co pustí migrace', vzor[2].split('|').sort().join() === Object.values(PRIPONY_SOUBORU).sort().join())
    const jmeno = cesta.split('/').pop()
    ok('jméno souboru projde vzorem z migrace', new RegExp(vzor[1]).test(jmeno))
    ok('složky jsou přesně tři (firma, pobočka, záznam)', cesta.split('/').length === 4)
  }

  const overena = overitCestu(cesta, T, B, Z)
  ok('platná cesta projde a vrátí očekávaný typ podle přípony', overena !== null && overena.cesta === cesta && overena.mime === 'image/jpeg')
  ok('cizí firma neprojde', overitCestu(cesta, '99999999-9999-4999-8999-999999999999', B, Z) === null)
  ok('jiná pobočka neprojde', overitCestu(cesta, T, '99999999-9999-4999-8999-999999999999', Z) === null)
  ok('jiný záznam neprojde', overitCestu(cesta, T, B, '99999999-9999-4999-8999-999999999999') === null)
  ok('složka navíc neprojde', overitCestu(`${T}/${B}/${Z}/x/${U}.jpg`, T, B, Z) === null)
  ok('„..“ v cestě neprojde', overitCestu(`${T}/${B}/${Z}/../${U}.jpg`, T, B, Z) === null)
  ok('cizí přípona neprojde', overitCestu(`${T}/${B}/${Z}/${U}.exe`, T, B, Z) === null)
  ok('velká písmena v jméně souboru neprojdou (politika úložiště by je nepustila)', overitCestu(`${T}/${B}/${Z}/${U.toUpperCase()}.jpg`, T, B, Z) === null)
  ok('ne-uuid jméno neprojde', overitCestu(`${T}/${B}/${Z}/fotka.jpg`, T, B, Z) === null)
  ok('PNG podle přípony očekává image/png', overitCestu(cestaSouboru(T, B, Z, U, 'image/png'), T, B, Z)?.mime === 'image/png')
}

console.log('\n== Duplicita: id záznamu z hlášky databáze ==')
{
  // Přesný text z jine_platby_pripojit_soubor (migrace): 'Tento soubor už je připojený k záznamu %.'
  const migrace = readFileSync('supabase/migrations/20261016100000_jine_platby.sql', 'utf8')
  const hlaska = migrace.match(/raise exception '(Tento soubor už je připojený k záznamu %\.)', v_jiny using errcode = 'unique_violation'/)
  ok('hláška o duplicitě se v migraci našla', hlaska !== null)
  const zprava = (hlaska?.[1] ?? '').replace('%', Z.toUpperCase())
  ok('id záznamu se z hlášky vytáhne (malými písmeny)', zaznamZDuplicity(zprava) === Z)
  ok('hláška bez id → null (jen věta, bez odkazu)', zaznamZDuplicity('Tento soubor už je připojený.') === null)
}

/* =====================================================================
 * 1b. VSTUPNÍ KONTROLA — lib/jine-platby-pristup.ts se SPOUŠTÍ
 *
 * Skutečný kód funkce, podstrčené je jen to pod ní: `has_access`
 * (odpovídá podle tabulky práv níž a zapisuje, na co se kdo ptal),
 * `requireContext` a převod rozsahu (`bezpecnyRozsah`: „firma" = celá
 * firma, „bernard-bar" = pobočka B, cokoli jiného = cizí rozsah).
 * ===================================================================== */

console.log('\n== Vstupní kontrola agendy (zkusPristupJinymPlatbam, pobockySPravem) ==')
{
  const AUTHZ = js(
    'export class NeprihlasenError extends Error {}\n' +
      'export class PristupOdepren extends Error {}\n' +
      'export async function requireContext() {\n' +
      '  if (globalThis.__jpStav === "neprihlasen") throw new NeprihlasenError()\n' +
      '  if (globalThis.__jpStav === "clen-jinde") throw new PristupOdepren()\n' +
      '  return { ctx: "ctx" }\n' +
      '}\n' +
      'export async function hasAccess(tenantId, pravo, branchId) {\n' +
      '  globalThis.__jpVolani.push([tenantId, pravo, branchId])\n' +
      '  return globalThis.__jpPrava.some(([p, b]) => p === pravo && b === branchId)\n' +
      '}\n' +
      'export function canSee(ctx, p) { return ctx.permissions.includes(p) }\n' +
      'export function isModuleActive(ctx, m) { return ctx.modules.some((x) => x.key === m && x.active) }\n',
  )
  const FIRMA = js(
    'export function bezpecnyRozsah(ctx, rozsah) {\n' +
      '  if (rozsah === "firma") return { level: "tenant", branchId: null, branchName: "Firma", branchSlug: "firma" }\n' +
      `  if (rozsah === "bernard-bar") return { level: "branch", branchId: "${B}", branchName: "Bernard Bar", branchSlug: "bernard-bar" }\n` +
      '  return null\n' +
      '}\n',
  )
  const pristupModul = await nactiModul(SOUBORY.pristup, [
    ['server-only', js('')],
    ['@/lib/authz', AUTHZ],
    ['@/lib/firma', FIRMA],
  ])
  const zkus = async ({ stav = 'ok', prava = [], rozsah = 'bernard-bar' } = {}) => {
    globalThis.__jpStav = stav
    globalThis.__jpPrava = prava
    globalThis.__jpVolani = []
    const vysledek = await pristupModul.zkusPristupJinymPlatbam(T, rozsah)
    return { vysledek, volani: globalThis.__jpVolani }
  }

  const obsluha = await zkus({ prava: [['jine_platby.zadat', B]] })
  ok('obsluha jen s jine_platby.zadat na pobočce (bez finance.read) projde', obsluha.vysledek.stav === 'ok' && obsluha.vysledek.vidi === true)
  ok('  a v prava má právě zadat', obsluha.vysledek.stav === 'ok' && [...obsluha.vysledek.prava].join() === 'jine_platby.zadat')
  ok(`na pobočce se ptá na všech 8 práv (7 agendy + finance.read) s ID POBOČKY (${obsluha.volani.length}×)`,
    obsluha.volani.length === 8 && obsluha.volani.every(([t, , b]) => t === T && b === B) &&
      new Set(obsluha.volani.map(([, p]) => p)).size === 8 && obsluha.volani.some(([, p]) => p === 'finance.read'))
  const jenPrehled = await zkus({ prava: [['finance.read', B]] })
  ok('finanční přehled na pobočce stačí (vidí záznamy, nic nezakládá)',
    jenPrehled.vysledek.stav === 'ok' && [...jenPrehled.vysledek.prava].join() === 'finance.read')
  ok('bez práva v rozsahu → odepřeno', (await zkus({ prava: [] })).vysledek.stav === 'odepren')
  ok('právo jen na JINÉ pobočce nestačí', (await zkus({ prava: [['jine_platby.zadat', '99999999-9999-4999-8999-999999999999']] })).vysledek.stav === 'odepren')
  const naFirme = await zkus({ rozsah: 'firma', prava: [['jine_platby.vydej_pos', null]] })
  ok('na firmě se ptá za celou firmu (null)', naFirme.vysledek.stav === 'ok' && naFirme.volani.every(([, , b]) => b === null))
  ok('cizí rozsah → odepřeno, na práva se ani neptá', (await zkus({ rozsah: 'cerna-perla', prava: [['jine_platby.zadat', B]] })).volani.length === 0 &&
    (await zkus({ rozsah: 'cerna-perla', prava: [['jine_platby.zadat', B]] })).vysledek.stav === 'odepren')
  ok('nepřihlášený → neprihlasen', (await zkus({ stav: 'neprihlasen' })).vysledek.stav === 'neprihlasen')
  ok('člen jiné firmy → odepren', (await zkus({ stav: 'clen-jinde' })).vysledek.stav === 'odepren')

  globalThis.__jpPrava = [['jine_platby.vydej_pos', B], ['finance.read', 'x-druha']]
  globalThis.__jpVolani = []
  const sVydejem = await pristupModul.pobockySPravem(T, [B, 'x-druha', 'x-treti'], ['jine_platby.vydej_pos'])
  ok(`pobockySPravem: jen pobočky, kde to právo opravdu je (${[...sVydejem].join(', ')})`, [...sVydejem].join() === B)
  ok('  a ptá se s id každé pobočky', globalThis.__jpVolani.map(([, , b]) => b).sort().join() === [B, 'x-druha', 'x-treti'].sort().join())
  const sKterymkoli = await pristupModul.pobockySPravem(T, [B, 'x-druha', 'x-treti'], ['jine_platby.vydej_pos', 'finance.read'])
  ok('pobockySPravem s víc právy: stačí kterékoli z nich', [...sKterymkoli].sort().join() === [B, 'x-druha'].sort().join())
  ok('pobockySPravem bez práv nebo poboček = prázdno', (await pristupModul.pobockySPravem(T, [B], [])).size === 0 && (await pristupModul.pobockySPravem(T, [], ['finance.read'])).size === 0)
  globalThis.__jpPrava = [['finance.read', B]]
  ok('vidiPobocku: finance.read na pobočce stačí, na jiné ne',
    (await pristupModul.vidiPobocku(T, B)) === true && (await pristupModul.vidiPobocku(T, 'x-druha')) === false)

  // N24: práva pro navigaci Financí na stránkách agendy.
  const nav = (prava, permissions, moduly = [{ key: 'finance', active: true }, { key: 'objednavky', active: true }]) =>
    pristupModul.pravaNavigaceFinanci({ stav: 'ok', ctx: { permissions, modules: moduly }, scope: {}, prava: new Set(prava), vidi: true }).sort().join()
  ok('pravaNavigaceFinanci: obsluha jen se zadat → jen jine_platby.zadat (žádné finance.read, Nákup ani Faktury)', nav(['jine_platby.zadat'], ['jine_platby.zadat']) === 'jine_platby.zadat')
  ok('pravaNavigaceFinanci: Nákup jen s purchasing.read a zapnutými Objednávkami',
    nav(['finance.read'], ['finance.read', 'purchasing.read']) === 'finance.read,purchasing.read' &&
      nav(['finance.read'], ['finance.read', 'purchasing.read'], [{ key: 'objednavky', active: false }]) === 'finance.read')
  ok('pravaNavigaceFinanci: Faktury s faktury.read', nav(['jine_platby.faktura'], ['jine_platby.faktura', 'faktury.read']) === 'faktury.read,jine_platby.faktura')
}

/* =====================================================================
 * 2. VYKRESLENÍ
 * ===================================================================== */

const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
const NAVIGACE = js('export function useRouter() { return { refresh() {}, push() {} } }\n')

console.log('\n== Stavová značka: text vždy, ikona u varování ==')
{
  const ZnackaStavu = await nactiKomponentu(SOUBORY.znacka)
  const varovani = renderToStaticMarkup(createElement(ZnackaStavu, { popis: { text: 'Úhrada neověřena', ton: 'warning', varovani: true } }))
  const klid = renderToStaticMarkup(createElement(ZnackaStavu, { popis: { text: 'Zkontrolováno', ton: 'success', varovani: false } }))
  ok('varování: text i ikona ze sdílené sady (ft-i)', varovani.includes('Úhrada neověřena') && varovani.includes('class="ft-i"'))
  ok('varování: tón štítku z popisu (barvy varování)', varovani.includes('var(--pozor)'))
  ok('bez varování: text bez ikony', klid.includes('Zkontrolováno') && !klid.includes('<svg'))
}

console.log('\n== Tržby: Ostatní tržby a karta Jiné platby (vykreslený obsah) ==')
{
  const modul = await nactiModul(SOUBORY.trzbyObsah, [['next/link', ODKAZ]])
  const Obsah = modul.default
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const prehled = prevestPrehled({
    trzby: [{ obdobi: '2026-10-01', branch_id: A, trzba_haleru: 150000, polozek: 10, dnu: 1, dnu_s_platbami: 0 }],
    platby: [],
    zpusoby: [],
    banka: [],
  })
  const prazdny = prevestPrehled({ trzby: [], platby: [], zpusoby: [], banka: [] })
  const radky = [
    { branch_id: A, datum: '2026-10-01', castka_haleru: 123400, mena: 'CZK', zapocitat: true, stav: 'platna' },
    // Prodej, který už je v pokladně — jen propojený, NESMÍ se přičíst.
    { branch_id: A, datum: '2026-10-01', castka_haleru: 50000, mena: 'CZK', zapocitat: false, stav: 'platna' },
    { branch_id: A, datum: '2026-10-02', castka_haleru: 30000, mena: 'CZK', zapocitat: true, stav: 'stornovana' },
    { branch_id: A, datum: '2026-10-02', castka_haleru: 1200, mena: 'EUR', zapocitat: true, stav: 'platna' },
  ]
  const props = (zmena) => ({
    prehled,
    cleneni: 'den',
    od: '2026-10-01',
    doData: '2026-10-31',
    vybranaPobocka: null,
    nazevRozsahu: 'Celá firma',
    nazvyPobocek: new Map([[A, 'Bernard Bar']]),
    poradiPobocek: [A],
    bankaVidi: true,
    maBankovniUcet: false,
    maPokladnu: true,
    zakladIntegraci: '/firma/finance/integrace',
    odkazNaObdobi: () => null,
    odkazNaPobocku: (id) => `/firma/finance/trzby?pobocka=${id}`,
    ostatniTrzby: radky,
    zakladJinychPlateb: '/firma/finance/trzby/jine-platby',
    ...zmena,
  })
  const kartaKpi = (html, titulek) => {
    const i = html.indexOf(`>${titulek}</h2>`)
    if (i < 0) return null
    const konec = html.indexOf('</article>', i)
    return html.slice(i, konec)
  }
  const cislo = (t) => (t ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  const html = renderToStaticMarkup(createElement(Obsah, props({})))
  const ostatni = kartaKpi(html, 'Ostatní tržby')
  const pokladna = kartaKpi(html, 'Tržby z pokladen')
  ok('karta „Ostatní tržby" je, „Ostatní platby" už ne', ostatni !== null && kartaKpi(html, 'Ostatní platby') === null)
  ok(`Ostatní tržby = jen platné započítané v CZK: 1 234 Kč (${cislo(ostatni)})`, /1\s?234 Kč/.test(cislo(ostatni)) && cislo(ostatni).includes('z Jiných plateb'))
  ok('propojený prodej z pokladny (zapocitat=false) se nepřičetl (1 734 Kč by bylo špatně)', !/1\s?734/.test(cislo(ostatni)))
  ok('stornovaná tržba se nepřičetla (1 534 Kč by bylo špatně)', !/1\s?534/.test(cislo(ostatni)))
  ok(`Tržby z pokladen zůstaly jen z pokladny: 1 500 Kč (${cislo(pokladna)})`, /1\s?500 Kč/.test(cislo(pokladna)) && !/2\s?734/.test(cislo(pokladna)))
  ok('EUR se nesčítá s korunami — stojí zvlášť větou', html.includes('nepřepočítávají ani nesčítají') && /12,00\s?EUR/.test(html))
  ok('karta Jiné platby odkazuje na agendu', html.includes('href="/firma/finance/trzby/jine-platby"') && html.includes('>Jiné platby</h2>'))
  ok('karta Jiné platby vysvětluje oddělené části a nezapočtení prodejů z pokladny',
    html.includes('Tržba, faktura, úhrada a sklad') && html.includes('nepřičte podruhé'))
  const bezTabulky = renderToStaticMarkup(createElement(Obsah, props({ ostatniTrzby: null })))
  ok('„modul se připravuje" nikde — ani s daty, ani bez tabulky', !html.includes('připravuje') && !bezTabulky.includes('připravuje'))
  const ostatniBez = cislo(kartaKpi(bezTabulky, 'Ostatní tržby'))
  ok(`tabulka zatím není: „–" a čeká na aktualizaci databáze (${ostatniBez})`, ostatniBez.includes('–') && ostatniBez.includes('čeká na aktualizaci databáze'))
  const nic = cislo(kartaKpi(renderToStaticMarkup(createElement(Obsah, props({ ostatniTrzby: [] }))), 'Ostatní tržby'))
  ok(`za období nic: „–", ne „0 Kč" (${nic})`, nic.includes('–') && !nic.includes('0 Kč'))

  const prazdnaPokladna = renderToStaticMarkup(createElement(Obsah, props({ prehled: prazdny })))
  ok('pokladna za období nic: karta Jiné platby i Ostatní tržby se ukážou i tak',
    prazdnaPokladna.includes('Za tohle období tu nic není') && prazdnaPokladna.includes('href="/firma/finance/trzby/jine-platby"') &&
      /1\s?234 Kč/.test(cislo(kartaKpi(prazdnaPokladna, 'Ostatní tržby'))))

  const s = modul.souhrnOstatnichTrzeb(radky)
  ok(`souhrn: CZK 123400 z 1 řádku, EUR 1200 zvlášť (${JSON.stringify(s)})`,
    s.czkHaleru === 123400 && s.czkPocet === 1 && s.jineMeny.length === 1 && s.jineMeny[0].mena === 'EUR' && s.jineMeny[0].haleru === 1200)
}

console.log('\n== Nahrání dokladu (vykreslená komponenta) ==')
{
  const NahratDoklad = await nactiKomponentu(SOUBORY.nahrat, [
    ['next/link', ODKAZ],
    ['next/navigation', NAVIGACE],
    ['@/lib/supabase/client', js('export function getBrowserSupabase() { return {} }\n')],
    ['./akce-soubory', js('export async function pripojitSoubor() { return { ok: true, id: "x" } }\n')],
  ])
  const props = { rozsah: 'bernard-bar', tenantId: T, branchId: B, zaznamId: Z, uzMa: 0, smi: true }
  const html = renderToStaticMarkup(createElement(NahratDoklad, props))
  const vstupy = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0])
  ok(`dva skryté výběry souborů (${vstupy.length})`, vstupy.length === 2 && vstupy.every((v) => v.includes('type="file"') && v.includes('hidden')))
  ok('„Vyfotit": jen fotky a zadní fotoaparát', vstupy.some((v) => v.includes('accept="image/*"') && v.includes('capture="environment"') && !v.includes('multiple')))
  ok('„Vybrat": fotky i PDF, víc najednou', vstupy.some((v) => v.includes('accept="image/*,application/pdf"') && v.includes('multiple') && !v.includes('capture')))
  ok('tlačítka Vyfotit a Vybrat fotku nebo PDF (třída ft-tl = 44 px)',
    /<button[^>]*class="ft-tl[^"]*"[^>]*>.*?Vyfotit<\/button>/.test(html) && /<button[^>]*class="ft-tl[^"]*"[^>]*>.*?Vybrat fotku nebo PDF<\/button>/.test(html))
  ok('stav nahrávání je čitelný odečítačem (role="status")', html.includes('role="status"'))
  const plno = renderToStaticMarkup(createElement(NahratDoklad, { ...props, uzMa: MAX_SOUBORU_NA_ZAZNAM }))
  ok('plný záznam: tlačítka vypnutá a řečeno proč', (plno.match(/disabled=""/g) ?? []).length === 2 && plno.includes(`${MAX_SOUBORU_NA_ZAZNAM} souborů`))
  ok('bez práva se nekreslí nic', renderToStaticMarkup(createElement(NahratDoklad, { ...props, smi: false })) === '')
}

console.log('\n== Formulář nového záznamu (vykreslený) ==')
{
  const Formular = await nactiKomponentu(SOUBORY.formular, [
    ['../akce-zalozit', js('export async function zalozitZaznam(s) { return s }\n')],
  ])
  const P1 = { id: B, nazev: 'Bernard Bar', pokladny: [{ id: U, nazev: 'Dotykačka bar' }] }
  const P2 = { id: '55555555-5555-4555-8555-555555555555', nazev: 'Černá Perla', pokladny: [] }
  const klientId = '66666666-6666-4666-8666-666666666666'
  const naPobocce = renderToStaticMarkup(createElement(Formular, { rozsah: 'bernard-bar', pobocky: [P1], pevnaPobocka: B, klientId, vidiPokladny: true }))
  ok('na pobočce se provozovna nevybírá (žádné pole branch_id)', !naPobocce.includes('name="branch_id"') && naPobocce.includes('Bernard Bar'))
  ok('skryté klient_id = id vygenerované stránkou (dvojklik)', naPobocce.includes(`name="klient_id" value="${klientId}"`))
  // React řadí atributy po svém — hledá se celá značka s hodnotou pokladny, ne pořadí.
  const radia = [...naPobocce.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0])
  const radioPokladny = radia.find((r) => r.includes(`value="${U}"`))
  const radioBez = radia.find((r) => r.includes('value=""'))
  ok(`jediná pokladna je předvybraná, „Bez pokladny" je vždy na výběr (${radia.length} volby)`,
    radia.length === 2 && radioPokladny?.includes('checked=""') === true && radioBez !== undefined && !radioBez.includes('checked=""') &&
      naPobocce.includes('Bez pokladny'))
  const bezPokladen = renderToStaticMarkup(createElement(Formular, { rozsah: 'firma', pobocky: [P2], pevnaPobocka: P2.id, klientId, vidiPokladny: false }))
  ok('bez viditelné pokladny: předvybráno „Bez pokladny" a řečeno proč (chybí právo na finanční přehled)',
    /<input[^>]*value=""[^>]*>/.test(bezPokladen) && [...bezPokladen.matchAll(/<input[^>]*type="radio"[^>]*>/g)].length === 1 &&
      /<input[^>]*type="radio"[^>]*>/.exec(bezPokladen)[0].includes('checked=""') && bezPokladen.includes('Vidět finanční přehled'))
  ok('pole pro firmu ve formuláři není', !/name="tenant/.test(naPobocce))
  const naFirme = renderToStaticMarkup(createElement(Formular, { rozsah: 'firma', pobocky: [P1, P2], pevnaPobocka: null, klientId, vidiPokladny: false }))
  const volby = [...naFirme.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])
  ok(`na firmě výběr jen z poboček od stránky (${volby.join(', ')})`, naFirme.includes('name="branch_id"') && volby.join() === ['', B, P2.id].join())
}

/* =====================================================================
 * 2b. PŘEHLED SE SPUSTÍ s podstrčenou databází
 *
 * Skutečná stránka (page.tsx) i všechno, co kreslí; podstrčené je jen
 * přihlášení (`getCurrentTenantId`), vstupní kontrola (vrací zadaný
 * výsledek) a klient Supabase, který si zapisuje, na co se stránka ptá,
 * a vrací připravené řádky. Kontroly čtou ZAPSANÉ DOTAZY a VYKRESLENÉ
 * HTML — ne zdroj.
 * ===================================================================== */

console.log('\n== Přehled: spuštěná stránka (dotazy a HTML) ==')
{
  const C = '77777777-7777-4777-8777-777777777777'
  const CIZI = '88888888-8888-4888-8888-888888888888'
  const ID = 'e9999999-9999-4999-8999-99999999999e'
  const AUTOR = 'f0000000-0000-4000-8000-00000000000f'
  const PRESMEROVANI = 'PRESMEROVANI'
  const stub = {
    firma: js('export async function getCurrentTenantId() { return globalThis.__pgTenant }\n'),
    pristup: js(
      'export async function zkusPristupJinymPlatbam(tenantId, rozsah) { globalThis.__pgPoradi.push("pristup"); return globalThis.__pgPristup }\n' +
        'export function pravaNavigaceFinanci(p) { return [...p.prava] }\n' +
        'export async function pobockySPravem(tenantId, kandidati, prava) {\n' +
        '  return new Set(kandidati.filter((b) => prava.some((p) => (globalThis.__pgPravaPobocek[b] ?? []).includes(p))))\n' +
        '}\n',
    ),
    supabase: js(
      'export async function getServerSupabase() {\n' +
        '  globalThis.__pgPoradi.push("supabase")\n' +
        '  return { from(tabulka) {\n' +
        '    const volani = []\n' +
        '    globalThis.__pgDotazy.push({ tabulka, volani })\n' +
        '    const b = new Proxy({}, { get(_, k) {\n' +
        '      if (k === "then") return (ok, ko) => Promise.resolve(globalThis.__pgOdpoved(tabulka, volani)).then(ok, ko)\n' +
        '      return (...a) => { volani.push([k, ...a]); return b }\n' +
        '    } })\n' +
        '    return b\n' +
        '  } }\n' +
        '}\n',
    ),
    dotaz: js(
      'export class DotazSelhal extends Error {}\n' +
        'export function tabulkaNeexistuje(c) { return c?.code === "PGRST205" || c?.code === "42P01" }\n',
    ),
    prihlaseni: js('export async function odkazNaPrihlaseni() { return "/prihlaseni" }\n'),
    navigace: js(`export function redirect() { throw new Error(${JSON.stringify(PRESMEROVANI)}) }\nexport function useRouter() { return {} }\n`),
    obal: js(
      `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
        'export default function Navigace({ rozsah, prava, children }) { return createElement("div", { "data-navigace": rozsah, "data-prava": prava === undefined ? "(bez)" : prava.join(" ") }, children) }\n',
    ),
  }
  const Stranka = await nactiKomponentu(SOUBORY.prehled, [
    ['next/link', ODKAZ],
    ['next/navigation', stub.navigace],
    ['@/lib/firma', stub.firma],
    ['@/lib/jine-platby-pristup', stub.pristup],
    ['@/lib/supabase/server', stub.supabase],
    ['@/lib/supabase/dotaz', stub.dotaz],
    ['@/lib/prihlaseni-adresa', stub.prihlaseni],
    ['../../navigace', stub.obal],
  ])

  const radekZaznamu = {
    id: ID, tenant_id: T, branch_id: B, pripojeni_id: null, pos_provozovna: null, datum_prodeje: '2026-10-14',
    oznaceni: 'Svatba Novákovi', kontakt_id: null, mena: 'CZK', castka_haleru: 123450, castka_puvod: 'doklad',
    typ_dokladu: 'uzavreny_prodej', externi_ucet: null, pos_prodej_id: null, stav_kontroly: 'ke_kontrole',
    stav_trzby: 'nezapsano', stav_skladu: 'ceka_na_schvaleni', stav_faktury: 'bez_faktury', faktura_cislo: null,
    faktura_zdroj: null, faktura_castka_haleru: null, stav_uhrady: 'neovereno', uhrada_transakce_id: null,
    uhrada_castka_haleru: null, kontrola_trzby: null, kontrola_skladu: null, verze: 3, vytvoril: AUTOR,
    vytvoreno: '2026-10-14T10:00:00Z', zmeneno: '2026-10-14T10:00:00Z', jine_platby_soubory: [{ count: 2 }],
  }
  const scopePobocky = { level: 'branch', branchId: B, branchName: 'Bernard Bar', branchSlug: 'bernard-bar' }
  const scopeFirmy = { level: 'tenant', branchId: null, branchName: 'Firma', branchSlug: 'firma' }

  const spustit = async ({ rozsah = 'bernard-bar', scope = scopePobocky, prava = ['jine_platby.zadat'], stav = 'ok', hledani = {}, pravaPobocek, chybaZaznamu = null, radky = [radekZaznamu] } = {}) => {
    globalThis.__pgTenant = T
    globalThis.__pgPoradi = []
    globalThis.__pgDotazy = []
    globalThis.__pgPristup = stav === 'ok' ? { stav, ctx: {}, scope, prava: new Set(prava), vidi: true } : { stav }
    globalThis.__pgPravaPobocek = pravaPobocek ?? { [B]: prava, [C]: prava }
    globalThis.__pgOdpoved = (tabulka) => {
      if (tabulka === 'branches') return { data: [{ id: B, name: 'Bernard Bar', active: true }, { id: C, name: 'Černá Perla', active: true }], error: null }
      if (tabulka === 'jine_platby') return chybaZaznamu ? { data: null, error: chybaZaznamu } : { data: radky, error: null }
      if (tabulka === 'profiles') return { data: [{ user_id: AUTOR, full_name: 'Jana Obsluha' }], error: null }
      return { data: [], error: null }
    }
    let html = null
    let vyjimka = null
    try {
      const prvek = await Stranka({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(hledani) })
      html = renderToStaticMarkup(prvek)
    } catch (e) {
      vyjimka = e
    }
    const zaznamy = globalThis.__pgDotazy.find((d) => d.tabulka === 'jine_platby')?.volani ?? null
    return { html, vyjimka, zaznamy, dotazy: globalThis.__pgDotazy, poradi: globalThis.__pgPoradi }
  }
  const ma = (volani, ...hledane) => (volani ?? []).some((v) => JSON.stringify(v) === JSON.stringify(hledane))
  const filtrObdobi = (volani) => (volani ?? []).find((v) => v[0] === 'or')?.[1] ?? null

  const odepreno = await spustit({ stav: 'odepren' })
  ok('odepřeno: věta „Na tohle nemáte oprávnění" a ŽÁDNÝ dotaz do databáze',
    odepreno.html?.includes('Na tohle nemáte oprávnění') === true && odepreno.dotazy.length === 0 && !odepreno.poradi.includes('supabase'))
  const neprihlasen = await spustit({ stav: 'neprihlasen' })
  ok('nepřihlášený: přesměrování na přihlášení a žádný dotaz', neprihlasen.vyjimka?.message === PRESMEROVANI && neprihlasen.dotazy.length === 0)

  const zakladni = await spustit()
  ok('kontrola přístupu proběhne dřív, než se otevře databáze', zakladni.poradi.join() === 'pristup,supabase')
  ok('záznamy jen této firmy (.eq tenant_id)', ma(zakladni.zaznamy, 'eq', 'tenant_id', T))
  ok('na pobočce jen její záznamy (.eq branch_id = pobočka rozsahu)', ma(zakladni.zaznamy, 'eq', 'branch_id', B))
  ok('výchozí stav „vše" = bez zrušených', ma(zakladni.zaznamy, 'neq', 'stav_kontroly', 'zruseno'))
  ok(`období: záznamy bez data + aktuální měsíc (${filtrObdobi(zakladni.zaznamy)})`,
    /^datum_prodeje\.is\.null,and\(datum_prodeje\.gte\.\d{4}-\d{2}-01,datum_prodeje\.lte\.\d{4}-\d{2}-\d{2}\)$/.test(filtrObdobi(zakladni.zaznamy) ?? ''))
  ok('řádek: odkaz na detail, částka, autor, počet dokladů',
    zakladni.html.includes(`href="/bernard-bar/finance/trzby/jine-platby/${ID}"`) && /1\s234,50\sKč/.test(zakladni.html) &&
      zakladni.html.includes('Jana Obsluha') && zakladni.html.includes('2 doklady') && zakladni.html.includes('Svatba Novákovi') &&
      zakladni.html.includes('14. 10. 2026') && zakladni.html.includes('Bernard Bar'))
  ok('řádek: stavové značky všech částí (úhrada u prodeje bez faktury schválně ne)',
    ['Ke kontrole', 'Tržba nezapsána', 'Čeká na potvrzení výdeje do POS', 'Bez faktury'].every((t) => zakladni.html.includes(t)) &&
      !zakladni.html.includes('Úhrada neověřena'))
  ok('s právem zadat: „Přidat záznam" vede na nový záznam', zakladni.html.includes('href="/bernard-bar/finance/trzby/jine-platby/novy"'))
  ok('bez vydej_pos: záložka „Čeká na schválení výdeje" není', !zakladni.html.includes('aria-label="Pohled"'))
  ok('obal Navigace s rozsahem', zakladni.html.includes('data-navigace="bernard-bar"'))
  ok('navigace Financí dostane práva přihlášeného (obsluha jen se zadat → jen Jiné platby, N24)', zakladni.html.includes('data-prava="jine_platby.zadat"'))

  const jenPrehled = await spustit({ prava: ['finance.read'] })
  ok('jen s finance.read: bez tlačítka „Přidat záznam"', !jenPrehled.html.includes('/jine-platby/novy'))

  const zly = await spustit({ hledani: { stav: 'cokoli', pohled: 'schvaleni', obdobi: '2099-01' } })
  ok('neznámý stav → „vše"', ma(zly.zaznamy, 'neq', 'stav_kontroly', 'zruseno') && !ma(zly.zaznamy, 'eq', 'stav_kontroly', 'cokoli'))
  ok('pohled=schvaleni bez práva vydej_pos se nepoužije', !ma(zly.zaznamy, 'eq', 'stav_skladu', 'ceka_na_schvaleni') && filtrObdobi(zly.zaznamy) !== null)
  ok('budoucí období → aktuální měsíc', filtrObdobi(zly.zaznamy) === filtrObdobi(zakladni.zaznamy))
  const zari = await spustit({ hledani: { obdobi: '2026-09' } })
  ok(`období 2026-09 → 1.–30. 9. (${filtrObdobi(zari.zaznamy)})`, filtrObdobi(zari.zaznamy) === 'datum_prodeje.is.null,and(datum_prodeje.gte.2026-09-01,datum_prodeje.lte.2026-09-30)')
  const zrusene = await spustit({ hledani: { stav: 'zrusene' } })
  ok('filtr Zrušené → jen zrušené', ma(zrusene.zaznamy, 'eq', 'stav_kontroly', 'zruseno') && !ma(zrusene.zaznamy, 'neq', 'stav_kontroly', 'zruseno'))
  const neuzavreny = await spustit({ hledani: { stav: 'sklad_neuzavreny' } })
  const stavySkladu = (neuzavreny.zaznamy ?? []).find((v) => v[0] === 'in' && v[1] === 'stav_skladu')?.[2] ?? []
  ok(`Sklad neuzavřený: hotové výdeje a „netýká se" venku (${stavySkladu.length} stavů)`,
    stavySkladu.length === 9 && ['ceka_na_schvaleni', 'nejasny_vysledek', 'chyba', 'nutna_kontrola', 'nepodporovano', 'zamitnuto'].every((x) => stavySkladu.includes(x)) &&
      !['odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'nevyzaduje', 'opraveno'].some((x) => stavySkladu.includes(x)))

  const schvalovatel = await spustit({ prava: ['jine_platby.vydej_pos'], hledani: { pohled: 'schvaleni' } })
  ok('s vydej_pos: záložka je a fronta = čeká na schválení z poboček s právem, bez období',
    schvalovatel.html.includes('Čeká na schválení výdeje') && ma(schvalovatel.zaznamy, 'eq', 'stav_skladu', 'ceka_na_schvaleni') &&
      ma(schvalovatel.zaznamy, 'in', 'branch_id', [B]) && filtrObdobi(schvalovatel.zaznamy) === null)
  ok('fronta „Čeká na schválení výdeje" bez zrušených záznamů (.neq stav_kontroly zruseno)', ma(schvalovatel.zaznamy, 'neq', 'stav_kontroly', 'zruseno'))
  const cekaFiltr = await spustit({ hledani: { stav: 'ceka_na_schvaleni' } })
  ok('filtr „Čeká na schválení výdeje" taky bez zrušených',
    ma(cekaFiltr.zaznamy, 'eq', 'stav_skladu', 'ceka_na_schvaleni') && ma(cekaFiltr.zaznamy, 'neq', 'stav_kontroly', 'zruseno'))

  // Možná zapsáno dvakrát: tržba zapsaná a dodatečná kontrola prodej v pokladně našla.
  const dvakratRadek = {
    ...radekZaznamu, id: 'e8888888-8888-4888-8888-88888888888e', stav_trzby: 'zapsano', stav_kontroly: 'zkontrolovano',
    kontrola_trzby: { vysledek: 'pravdepodobne', zdroj: 'pos_api', verze: 3, kdy: '2026-10-14T11:00:00Z', kdo: null, detail: {} },
  }
  const dvakrat = await spustit({ hledani: { stav: 'mozna_dvakrat' }, radky: [dvakratRadek] })
  ok('filtr „Možná zapsáno dvakrát": stav_trzby = zapsano a kontrola_trzby->>vysledek ∈ {nalezeno, pravdepodobne} v dotazu',
    ma(dvakrat.zaznamy, 'eq', 'stav_trzby', 'zapsano') && ma(dvakrat.zaznamy, 'in', 'kontrola_trzby->>vysledek', ['nalezeno', 'pravdepodobne']))
  ok('filtr „Možná zapsáno dvakrát" je v nabídce filtrů', dvakrat.html?.includes('Možná zapsáno dvakrát') === true && zakladni.html.includes('stav=mozna_dvakrat'))
  const znacka = (html, id) => {
    const i = html.indexOf(`/jine-platby/${id}"`)
    const j = html.indexOf('</tr>', i)
    return i < 0 ? '' : html.slice(i, j)
  }
  const radekDvakrat = znacka(dvakrat.html ?? '', dvakratRadek.id)
  ok('řádek s možnou dvojí tržbou: značka „Možná zapsáno dvakrát" s ikonou varování (ft-i)',
    /<span class="ds-badge"[^>]*><svg class="ft-i"[^>]*>(?:<path[^>]*><\/path>)*<\/svg>Možná zapsáno dvakrát<\/span>/.test(radekDvakrat))
  const bezDvakrat = znacka(zakladni.html ?? '', ID)
  ok('řádek bez zapsané tržby tu značku nemá', bezDvakrat !== '' && !bezDvakrat.includes('Možná zapsáno dvakrát'))
  const nenalezeno = await spustit({ radky: [{ ...dvakratRadek, kontrola_trzby: { ...dvakratRadek.kontrola_trzby, vysledek: 'nenalezeno' } }] })
  ok('zapsaná tržba s kontrolou „nenalezeno" značku nemá', !znacka(nenalezeno.html ?? '', dvakratRadek.id).includes('Možná zapsáno dvakrát') && znacka(nenalezeno.html ?? '', dvakratRadek.id) !== '')

  // Možná nezapočítáno (moznaNikde, R1 z 20. 10.): propojeno s KONKRÉTNÍM prodejem (pos_prodej_id), který
  // pokladna nenašla. Propojení bez konkrétního prodeje dodatečná kontrola ověřit neumí — značku nemá.
  // Verze se neporovnává (hledá se tentýž prodej, uložení návrhu verzi zvedne i bez změny).
  const nikdeRadek = {
    ...radekZaznamu, id: 'e7777777-7777-4777-8777-77777777777e', stav_trzby: 'propojeno', stav_kontroly: 'zkontrolovano', verze: 5, pos_prodej_id: 'ORDER-555',
    kontrola_trzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 5, kdy: '2026-10-14T11:00:00Z', kdo: null, detail: {} },
  }
  const staraVerze = { ...nikdeRadek, id: 'e6666666-6666-4666-8666-66666666666e', verze: 6 }
  const bezProdeje = { ...nikdeRadek, id: 'e5555555-5555-4555-8555-55555555555e', pos_prodej_id: null }
  const nikde = await spustit({ hledani: { stav: 'mozna_nikde' }, radky: [nikdeRadek, staraVerze] })
  ok('filtr „Možná nezapočítáno": v DOTAZU stav_trzby = propojeno, pos_prodej_id není null, kontrola_trzby->>zdroj = pos_api a ->>vysledek = nenalezeno',
    ma(nikde.zaznamy, 'eq', 'stav_trzby', 'propojeno') && ma(nikde.zaznamy, 'not', 'pos_prodej_id', 'is', null) &&
      ma(nikde.zaznamy, 'eq', 'kontrola_trzby->>zdroj', 'pos_api') && ma(nikde.zaznamy, 'eq', 'kontrola_trzby->>vysledek', 'nenalezeno'))
  ok('… bez zrušených? (propojená tržba zrušená být nemůže — databáze zrušení s tržbou odmítne)', !ma(nikde.zaznamy, 'eq', 'stav_kontroly', 'zruseno'))
  ok('… celé pravidlo je v dotazu: řádky, které databáze vrátí, aplikace už nepřebírá (i kontrola ke starší verzi se ukáže)',
    znacka(nikde.html ?? '', nikdeRadek.id).includes('Možná nezapočítáno') && znacka(nikde.html ?? '', staraVerze.id).includes('Možná nezapočítáno'))
  ok('filtr „Možná nezapočítáno" je v nabídce filtrů', zakladni.html.includes('stav=mozna_nikde') && zakladni.html.includes('Možná nezapočítáno'))
  const radekNikde = znacka(nikde.html ?? '', nikdeRadek.id)
  ok('řádek s propojenou tržbou, kterou pokladna nenašla: značka „Možná nezapočítáno" s ikonou varování (ft-i)',
    /<span class="ds-badge"[^>]*><svg class="ft-i"[^>]*>(?:<path[^>]*><\/path>)*<\/svg>Možná nezapočítáno<\/span>/.test(radekNikde))
  const vse = await spustit({ radky: [nikdeRadek, staraVerze, bezProdeje, dvakratRadek] })
  ok('ve výchozím pohledu značku má propojení s konkrétním prodejem (i s kontrolou ke starší verzi), ne zapsaná tržba',
    znacka(vse.html ?? '', nikdeRadek.id).includes('Možná nezapočítáno') && znacka(vse.html ?? '', staraVerze.id).includes('Možná nezapočítáno') &&
      !znacka(vse.html ?? '', dvakratRadek.id).includes('Možná nezapočítáno'))
  ok('propojení BEZ konkrétního prodeje (pos_prodej_id null) značku nemá — falešný poplach po shodě částky (R1)',
    znacka(vse.html ?? '', bezProdeje.id) !== '' && !znacka(vse.html ?? '', bezProdeje.id).includes('Možná nezapočítáno'))
  {
    // Filtr v databázi = moznaNikde: dotaz pustí řádek právě tehdy, když moznaNikde řekne ano (žádná dořešení v aplikaci).
    const { moznaNikde } = await import('../lib/jine-platby-stav.ts')
    const { zDbZaznam } = await import('../lib/jine-platby-db.ts')
    const podminky = (nikde.zaznamy ?? []).filter((v) => ['eq', 'not', 'in', 'neq', 'is'].includes(v[0]) && v[1] !== 'tenant_id' && v[1] !== 'branch_id')
    const projde = (r) => podminky.every(([op, sloupec, ...hodnoty]) => {
      const cesta = sloupec.split('->>')
      const h = cesta.length === 2 ? ((r[cesta[0]] ?? {})[cesta[1]] ?? null) : (r[sloupec] ?? null)
      if (op === 'eq') return h !== null && String(h) === String(hodnoty[0])
      if (op === 'neq') return h !== null && String(h) !== String(hodnoty[0])
      if (op === 'in') return h !== null && hodnoty[0].map(String).includes(String(h))
      if (op === 'not' && hodnoty[0] === 'is' && hodnoty[1] === null) return h !== null
      return false
    })
    let shoda = true
    let kombinaci = 0
    for (const stav_trzby of ['nezapsano', 'zapsano', 'propojeno', 'stornovano'])
      for (const pos_prodej_id of [null, 'ORDER-1'])
        for (const zdroj of ['pos_api', 'rucni_prohlaseni'])
          for (const vysledek of ['nalezeno', 'nenalezeno', 'pravdepodobne', 'nelze_overit', null])
            for (const verze of [5, 6]) {
              kombinaci++
              const r = { ...radekZaznamu, stav_trzby, pos_prodej_id, verze: 5, kontrola_trzby: vysledek === null ? null : { vysledek, zdroj, verze, kdy: '2026-10-14T11:00:00Z', kdo: null, detail: {} } }
              if (projde(r) !== moznaNikde(zDbZaznam(r))) shoda = false
            }
    ok('filtr v dotazu = moznaNikde na všech ' + kombinaci + ' kombinacích (stav tržby × prodej × zdroj × výsledek × verze; podmínek ' + podminky.length + ')', shoda && podminky.length === 4)
  }
  const rucne = await spustit({ radky: [{ ...nikdeRadek, kontrola_trzby: { ...nikdeRadek.kontrola_trzby, zdroj: 'rucni_prohlaseni' } }] })
  ok('ruční prohlášení „nenalezeno" u propojené tržby značku nemá (propojení bez nálezu chtělo důvod)', znacka(rucne.html ?? '', nikdeRadek.id) !== '' && !znacka(rucne.html ?? '', nikdeRadek.id).includes('Možná nezapočítáno'))

  const firmaCizi = await spustit({ rozsah: 'firma', scope: scopeFirmy, prava: ['finance.read'], pravaPobocek: { [B]: ['finance.read'] }, hledani: { pobocka: CIZI } })
  ok('na firmě cizí ?pobocka= se ignoruje — jen pobočky, kde člověk vidí',
    !(firmaCizi.zaznamy ?? []).some((v) => v[0] === 'eq' && v[1] === 'branch_id') && ma(firmaCizi.zaznamy, 'in', 'branch_id', [B]))
  ok('na firmě výběr provozovny jen z viditelných (na Černou Perlu bez práva odkaz není)', firmaCizi.html !== null && !firmaCizi.html.includes(`pobocka=${C}`))
  const firmaC = await spustit({ rozsah: 'firma', scope: scopeFirmy, prava: ['finance.read'], pravaPobocek: { [B]: ['finance.read'], [C]: ['finance.read'] }, hledani: { pobocka: C } })
  ok('na firmě viditelná ?pobocka= se použije', ma(firmaC.zaznamy, 'eq', 'branch_id', C) && firmaC.html.includes(`pobocka=${C}`))
  const pobockaZAdresy = await spustit({ hledani: { pobocka: C } })
  ok('na pobočce se ?pobocka= nečte (adresa jiné pobočky nic neotevře)', ma(pobockaZAdresy.zaznamy, 'eq', 'branch_id', B) && !ma(pobockaZAdresy.zaznamy, 'eq', 'branch_id', C))

  const bezTabulky = await spustit({ chybaZaznamu: { code: 'PGRST205', message: 'nenalezeno' } })
  ok('nenasazená migrace → karta „Jiné platby čekají na aktualizaci databáze"', bezTabulky.html?.includes('Jiné platby čekají na aktualizaci databáze') === true)
  const porucha = await spustit({ chybaZaznamu: { code: '42501', message: 'permission denied' } })
  ok('jiná chyba dotazu → výjimka (nahlas), ne prázdný seznam', porucha.vyjimka !== null && porucha.html === null)
}

/* =====================================================================
 * 3. ZDROJ STRÁNEK, AKCÍ A ROUTE
 * ===================================================================== */

console.log('\n== Stránky: první je kontrola přístupu, žádná data před ní ==')

/** Tělo od `export default async function` po volání vstupní kontroly. */
function predKontrolou(s) {
  return s.match(/export default async function \w+\([\s\S]*?\n {2}const pristup = await zkusPristupJinymPlatbam\(tenantId, rozsah\)\n/)?.[0] ?? null
}
for (const soubor of [SOUBORY.prehled, SOUBORY.novy]) {
  const s = zdroj(soubor)
  const telo = predKontrolou(s)
  const kratce = soubor.slice(AGENDA.length + 1)
  ok(`${kratce}: zkusPristupJinymPlatbam(tenantId, rozsah) se našel`, telo !== null)
  const awaity = [...(telo ?? '').matchAll(/await ([\w.]+)/g)].map((m) => m[1])
  ok(`${kratce}: před ní jen params a firma (${awaity.join(', ')})`,
    telo !== null && awaity.join() === 'params,getCurrentTenantId,zkusPristupJinymPlatbam')
  ok(`${kratce}: před ní žádná databáze`, telo !== null && !/getServerSupabase\(|\.from\(|\.rpc\(/.test(telo))
  const zbytek = telo ? s.slice(s.indexOf(telo) + telo.length) : ''
  ok(`${kratce}: hned za ní nepřihlášený → přihlášení, odmítnutý → věta`,
    /^\s*if \(pristup\.stav === 'neprihlasen'\) redirect\(await odkazNaPrihlaseni\(\)\)\n\s*if \(pristup\.stav === 'odepren'\) \{\n\s*return <Sdeleni /.test(zbytek))
  ok(`${kratce}: pobočka z rozsahu (pobockaFinanci) dřív, než se načte cokoli`,
    zbytek.indexOf('pobockaFinanci(pristup.scope)') > 0 && zbytek.indexOf('pobockaFinanci(pristup.scope)') < zbytek.indexOf('getServerSupabase('))
  ok(`${kratce}: obal Navigace rozsah={rozsah} s právy přihlášeného (N24)`, s.includes('<Navigace rozsah={rozsah} prava={pravaNavigaceFinanci(pristup)}>'))
}

console.log('\n== Přehled: každý parametr adresy přes seznam povolených hodnot ==')
{
  const s = zdroj(SOUBORY.prehled)
  const vyskyty = (jmeno) => (s.match(new RegExp(`\\b${jmeno}\\b`, 'g')) ?? []).length
  ok('stav: jen z FILTRY_STAVU, jinak „vse"', /const stav: FiltrStavu = jeFiltrStavu\(stavParam\) \? stavParam : 'vse'/.test(s) && vyskyty('stavParam') === 3)
  ok('filtry stavu = zadání (vse, ke_kontrole, trzba_nezapsana, mozna_dvakrat, mozna_nikde, ceka_na_schvaleni, sklad_neuzavreny, bez_faktury, zrusene)',
    s.includes("const FILTRY_STAVU = ['vse', 'ke_kontrole', 'trzba_nezapsana', 'mozna_dvakrat', 'mozna_nikde', 'ceka_na_schvaleni', 'sklad_neuzavreny', 'bez_faktury', 'zrusene'] as const"))
  ok('pohled=schvaleni jen s jine_platby.vydej_pos',
    /const smiSchvalovat = pristup\.prava\.has\('jine_platby\.vydej_pos'\)/.test(s) &&
      /const pohledSchvaleni = pohledParam === 'schvaleni' && smiSchvalovat/.test(s) && vyskyty('pohledParam') === 2)
  ok('záložka „Čeká na schválení" se kreslí jen se smiSchvalovat', /\{smiSchvalovat \? \(\s*<nav className="ds-zalozky"/.test(s))
  ok('fronta schválení jen z poboček s vydej_pos', /pobockySPravem\(tenantId, \[\.\.\.viditelne\], \['jine_platby\.vydej_pos'\]\)/.test(s) &&
    /dotaz = dotaz\.eq\('stav_skladu', 'ceka_na_schvaleni'\)\.neq\('stav_kontroly', 'zruseno'\)\.in\('branch_id', \[\.\.\.pobockySchvaleni\]\)/.test(s))
  ok('značka „Možná zapsáno dvakrát" podle moznaDvakrat z lib/jine-platby-stav (jedno pravidlo)', s.includes('{moznaDvakrat(r) ? <ZnackaStavu popis={ZNACKA_DVAKRAT} /> : null}'))
  ok('značka „Možná nezapočítáno" podle moznaNikde z lib/jine-platby-stav (jedno pravidlo)', s.includes('{moznaNikde(r) ? <ZnackaStavu popis={ZNACKA_NIKDE} /> : null}'))
  ok('pobocka: jen na firmě a jen z nabídky viditelných poboček',
    /const vybranaPobocka = pobockaRozsahu \?\? \(pobockaParam && nabidkaPobocek\.some\(\(b\) => b\.id === pobockaParam\) \? pobockaParam : null\)/.test(s) &&
      vyskyty('pobockaParam') === 4)
  ok('obdobi: RRRR-MM, ne v budoucnosti, jinak aktuální provozní měsíc',
    /parametr && \/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(parametr\) && parametr >= '2000-01' && parametr <= aktualni \? parametr : aktualni/.test(s) &&
      /urcitMesic\(obdobiParam, provozniMesic\(\)\)/.test(s) && vyskyty('obdobiParam') === 2)
  ok('provozní měsíc z provozniDen (05:00), ne z kalendáře serveru', /provozniDen\(Date\.now\(\), '05:00', ZONA_VYCHOZI\)\.slice\(0, 7\)/.test(s))
  ok('data uživatelským klientem a .eq(tenant_id)', /\.from\('jine_platby'\)\s*\.select\(`\$\{SLOUPCE_ZAZNAMU\}, jine_platby_soubory\(count\)`\)\s*\.eq\('tenant_id', tenantId\)/.test(s))
  ok('nenasazená migrace → karta „čekají na aktualizaci databáze", jiná chyba nahlas',
    /const cekaNaDatabazi = chybaZaznamu !== null && tabulkaNeexistuje\(chybaZaznamu\)/.test(s) &&
      /if \(chybaZaznamu && !cekaNaDatabazi\) throw new DotazSelhal/.test(s) && s.includes('Jiné platby čekají na aktualizaci databáze'))
  ok('„Přidat záznam" jen s jine_platby.zadat', /const smiZadat = pristup\.prava\.has\('jine_platby\.zadat'\)/.test(s) && /vpravo=\{\s*smiZadat \? \(/.test(s))
  ok('řádek vede na detail záznamu', s.includes('href={`${zaklad}/${r.id}`}') && s.includes('const zaklad = `/${rozsah}/finance/trzby/jine-platby`'))
  ok('stavové značky přes popisStavu* a ZnackaStavu (všech pět částí)',
    ['popisStavuKontroly', 'popisStavuTrzby', 'popisStavuSkladu', 'popisStavuFaktury', 'popisStavuUhrady'].every((f) => s.includes(`<ZnackaStavu popis={${f}(`)))
  ok('částka přes formatHaleru (měna se nedomýšlí)', s.includes('formatHaleru(r.castkaHaleru, r.mena)'))
  ok('prázdný stav přes EmptyState', s.includes('<EmptyState'))
}

console.log('\n== Nový záznam: firma nikdy z formuláře, pobočka z rozsahu, právo na pobočce ==')
{
  const s = zdroj(SOUBORY.akceZalozit)
  ok('firma z getCurrentTenantId', /const tenantId = await getCurrentTenantId\(\)/.test(s))
  ok('z formuláře se firma nečte', !/formData\.get\(['"]tenant/.test(s) && !/formData\.get\(['"]p_tenant/.test(s))
  ok('do databáze jde firma z členství', /p_tenant: tenantId,/.test(s))
  ok('pobočka přes pobockaZaznamu s pobočkou rozsahu', /const volba = pobockaZaznamu\(\s*pobockaRozsahu,/.test(s) && /const pobockaRozsahu = pobockaFinanci\(pristup\.scope\)/.test(s))
  ok('bez pobočky se nezakládá (jiná platba vždy patří provozovně)', /if \(volba\.branchId === null\) return chyba\(/.test(s))
  ok('právo jine_platby.zadat na vybrané pobočce PŘED voláním databáze',
    s.indexOf("hasAccess(tenantId, 'jine_platby.zadat', branchId)") > 0 &&
      s.indexOf("hasAccess(tenantId, 'jine_platby.zadat', branchId)") < s.indexOf("rpc('jine_platby_zalozit'"))
  ok('klient_id musí být uuid', /const klientId = String\(formData\.get\('klient_id'\) \?\? ''\)\.trim\(\)\s*if \(!UUID\.test\(klientId\)\)/.test(s))
  const hlasky = s.split('\n').filter((r) => r.includes('error.message') && !r.includes('console.error'))
  ok(`hlášku databáze ukáže jen u 23514 (${hlasky.length}×)`, hlasky.length === 1 && hlasky[0].includes("error.code === '23514'"))
  ok('po založení přesměrování na detail z ověřeného rozsahu',
    /redirect\(`\/\$\{pristup\.scope\.branchSlug \?\? TENANT_SCOPE_SEGMENT\}\/finance\/trzby\/jine-platby\/\$\{id\}`\)/.test(s))
  const stranka = zdroj(SOUBORY.novy)
  ok('stránka: klient_id = randomUUID() při vykreslení', /klientId=\{randomUUID\(\)\}/.test(stranka))
  ok('stránka: pobočky jen s jine_platby.zadat (has_access na každou)', /pobockySPravem\(tenantId, kandidati\.map\(\(b\) => b\.id\), \['jine_platby\.zadat'\]\)/.test(stranka))
  // Pokladny provozovny přes `jine_platby_pokladny` (SECURITY DEFINER, právo agendy
  // NA pobočce, jen netajné sloupce) — ne přímý dotaz na integrace_pripojeni, ten
  // by obsluze bez finance.read vrátil prázdno (RLS) a záznam by šel jen bez pokladny.
  ok('stránka: pokladny provozovny přes jine_platby_pokladny pro každou povolenou pobočku, ne přímý dotaz',
    /supabase\.rpc\('jine_platby_pokladny', \{ p_tenant: tenantId, p_branch: b\.id \}\)/.test(stranka) &&
      !/from\('integrace_pripojeni'\)/.test(stranka))
  // Přesný tvar: cokoli navíc by odešlo do prohlížeče.
  ok('stránka: do prohlížeče jen id a název pokladny',
    /\.map\(\(p\) => \(\{ id: p\.id, nazev: \(p\.nazev \?\? ''\)\.trim\(\) \|\| p\.poskytovatel \}\)\)/.test(stranka) &&
      !/externi_ucet/.test(stranka))
}

console.log('\n== Připojení dokladu: obsah, otisk, teprve pak databáze ==')
{
  const s = zdroj(SOUBORY.akceSoubory)
  const i = (co) => s.indexOf(co)
  ok('firma z getCurrentTenantId, ne z formuláře', /const tenantId = await getCurrentTenantId\(\)/.test(s) && !/formData/.test(s))
  ok('záznam uživatelským klientem s .eq(tenant_id)', /\.from\('jine_platby'\)[\s\S]{0,120}\.eq\('id', zaznamId\)\s*\.eq\('tenant_id', tenantId\)/.test(s))
  ok('právo zadat nebo upravit NA POBOČCE ZÁZNAMU', /hasAccess\(tenantId, 'jine_platby\.zadat', z\.branch_id\)/.test(s) && /hasAccess\(tenantId, 'jine_platby\.upravit', z\.branch_id\)/.test(s))
  ok('cesta se ověří a přeskládá dřív, než se stáhne', i('overitCestu(') > 0 && i('overitCestu(') < i('.download('))
  ok('stahuje se a připojuje PŘESKLÁDANÁ cesta', /\.download\(overena\.cesta\)/.test(s) && /p_cesta: overena\.cesta,/.test(s))
  ok('pořadí: stažení → typ z obsahu → sha256 → rpc',
    i('.download(') < i('poznatTypSouboru(bajty)') && i('poznatTypSouboru(bajty)') < i("createHash('sha256')") &&
      i("createHash('sha256')") < i("rpc('jine_platby_pripojit_soubor'"))
  ok('typ z obsahu musí sedět s příponou', /if \(typ === null \|\| typ !== overena\.mime\) \{\s*await uklidit\(\)/.test(s))
  ok('velikost ze stažených bajtů', /if \(bajty\.length === 0 \|\| bajty\.length > MAX_BAJTU_SOUBORU\) \{\s*await uklidit\(\)/.test(s))
  ok('chyba databáze → soubor se uklidí', /if \(error\) \{\s*await uklidit\(\)/.test(s))
  ok('23505 → „už je připojený k jinému záznamu" s id z hlášky', /if \(error\.code === '23505'\) \{\s*const jiny = zaznamZDuplicity\(error\.message\)/.test(s) &&
    s.includes("'Tento soubor už je připojený k jinému záznamu.', jiny"))
  const hlasky = s.split('\n').filter((r) => /ne\(error\.message\)/.test(r))
  ok(`hlášku databáze ukáže jen u 23514 (${hlasky.length}×)`, hlasky.length === 1 && hlasky[0].includes("error.code === '23514'"))
}

console.log('\n== Nahrání: vlastní zmenšení, ne lib/obrazky ==')
{
  const s = zdroj(SOUBORY.nahrat)
  ok('nahrat-doklad nepoužívá lib/obrazky ani zmensitObrazek', !s.includes('lib/obrazky') && !s.includes('zmensitObrazek'))
  ok('zmenšuje zmensitDoklad, jen když kontrola výběru řekne „zmensit"', /if \(polozka\.akce === 'zmensit'\) \{\s*setPrubeh\([^\n]*\)\s*const zmenseny = await zmensitDoklad\(s\)/.test(s))
  ok('po zmenšení kontrola zkontrolovatPoZmenseni(…, blob.size) a teprve pak nahrání',
    s.indexOf('zkontrolovatPoZmenseni(s.name, mime, blob.size)') > s.indexOf('await zmensitDoklad(s)') &&
      s.indexOf('zkontrolovatPoZmenseni(s.name, mime, blob.size)') < s.indexOf('.upload(cesta, blob'))
  ok('nahrává do kbelíku jine-platby bez přepisu (upsert: false)', /storage\.from\(KBELIK_JINYCH_PLATEB\)\.upload\(cesta, blob, \{\s*contentType: mime,\s*upsert: false,/.test(s))
  ok('cesta přes cestaSouboru (firma/pobočka/záznam/uuid)', /cestaSouboru\(tenantId, branchId, zaznamId, noveId\(\), mime\)/.test(s))
  ok('po dokončení router.refresh()', /if \(pripojeno > 0\) router\.refresh\(\)/.test(s))
  ok('chyby čitelně (role="alert")', s.includes('role="alert"'))
  const lib = zdroj(SOUBORY.soubory)
  const zmensitDokladTelo = lib.slice(lib.indexOf('export async function zmensitDoklad'))
  ok('lib: zmensitDoklad kreslí přes rozmeryZmenseni(…, strana) a pokusy jdou přes zmensitPostupne',
    /rozmeryZmenseni\(zdroj\.width, zdroj\.height, strana\)/.test(zmensitDokladTelo) && /await zmensitPostupne\(/.test(zmensitDokladTelo))
  ok('lib: výběr zmenšuje fotku nad stropem fotky pro AI (MAX_BAJTU_OBRAZKU_PRO_AI), ne nad 8 MB',
    /s\.size > MAX_BAJTU_OBRAZKU_PRO_AI/.test(lib) && !/MAX_BAJTU_PRO_AI\b/.test(lib))
  ok('lib: bez server-only a bez importů přes @/ (jde spustit Nodem i v prohlížeči)', !lib.includes('server-only') && !/from '@\//.test(lib))
}

console.log('\n== Odkaz na originál: právo, RLS, 120 s, no-store ==')
{
  const s = zdroj(SOUBORY.route)
  ok('firma z členství a přihlášení', /const tenantId = await getCurrentTenantId\(\)/.test(s) && /await getUser\(\)/.test(s))
  ok('řádek souboru uživatelským klientem s .eq(tenant_id)', /\.from\('jine_platby_soubory'\)[\s\S]{0,80}\.eq\('id', id\)\s*\.eq\('tenant_id', tenantId\)/.test(s))
  ok('právo v aplikaci (vidiPobocku) před podpisem', s.indexOf('vidiPobocku(') > 0 && s.indexOf('vidiPobocku(') < s.indexOf('createSignedUrl('))
  ok('podepsaný odkaz na 120 s', /const PLATNOST_ODKAZU_S = 120\b/.test(s) && /createSignedUrl\(String\(radek\.cesta\), PLATNOST_ODKAZU_S\)/.test(s))
  ok('302 s no-store a no-referrer', /NextResponse\.redirect\(podepsano\.signedUrl, 302\)/.test(s) &&
    /headers\.set\('cache-control', 'no-store'\)/.test(s) && /headers\.set\('referrer-policy', 'no-referrer'\)/.test(s))
  ok('jinak jen 404 bez detailu (žádné 400/401/403)', !/status: (400|401|403)/.test(s) && /status: 404/.test(s))
}

console.log('\n== Tržby: zdroj ==')
{
  const o = zdroj(SOUBORY.trzbyObsah)
  const p = zdroj(SOUBORY.trzbyStranka)
  ok('nikde „modul se připravuje"', !o.includes('připravuje') && !p.includes('připravuje'))
  ok('ostatní tržby přes RLS: .eq(tenant_id), období a pobočka v dotazu',
    /\.from\('ostatni_trzby'\)\s*\.select\('branch_id, datum, castka_haleru, mena, zapocitat, stav'\)\s*\.eq\('tenant_id', tenantId\)\s*\.gte\('datum', rozsahObdobi\.od\)\s*\.lte\('datum', rozsahObdobi\.doData\)/.test(p) &&
      /if \(vybranaPobocka\) dotazOstatnich = dotazOstatnich\.eq\('branch_id', vybranaPobocka\)/.test(p))
  // Podmínka napsaná dvakrát nejde shodit: zapocitat/platna jen v souhrnOstatnichTrzeb.
  ok('zapocitat/stav jen na jednom místě (souhrnOstatnichTrzeb), ne v dotazu', !/\.eq\('zapocitat'/.test(p) && !/\.eq\('stav'/.test(p))
  ok('po stránkách: .order(\'id\').range(odRadku, odRadku + STRANKA_OSTATNICH - 1), stránka 1000, strop 50',
    /await dotazOstatnich\.order\('id'\)\.range\(odRadku, odRadku \+ STRANKA_OSTATNICH - 1\)/.test(p) &&
      /const STRANKA_OSTATNICH = 1000\b/.test(p) && /const MAX_STRAN_OSTATNICH = 50\b/.test(p))
  ok('obsah dostává i chybu karty (ostatniTrzbyChyba)', /ostatniTrzbyChyba=\{ostatniTrzbyChyba\}/.test(p))
  ok('obsah dostává ostatní tržby a adresu agendy propem', /ostatniTrzby=\{ostatniTrzby\}/.test(p) && /zakladJinychPlateb=\{`\/\$\{rozsah\}\/finance\/trzby\/jine-platby`\}/.test(p))
  ok('obsah.tsx nic nenačítá (čistě kreslicí)', !/getServerSupabase|\.from\(|\.rpc\(/.test(o))
}

/* =====================================================================
 * Tržby se SPUSTÍ s podstrčenou databází: Ostatní tržby po stránkách.
 * Kontroly čtou zapsané dotazy (range, order) a vykreslenou kartu.
 * ===================================================================== */

console.log('\n== Tržby: Ostatní tržby po stránkách (spuštěná stránka) ==')
{
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const stubT = {
    firma: js(`export async function getCurrentTenantId() { return ${JSON.stringify(T)} }\n`),
    pristup: js('export async function zkusPristupFinanci() { return globalThis.__trPristup }\n'),
    authz: js('export const TENANT_SCOPE_SEGMENT = "firma"\n'),
    prihlaseni: js('export async function odkazNaPrihlaseni() { return "/prihlaseni" }\n'),
    navigace: js('export function redirect() { throw new Error("PRESMEROVANI") }\n'),
    dotaz: js('export class DotazSelhal extends Error {}\nexport function tabulkaNeexistuje(c) { return c?.code === "PGRST205" || c?.code === "42P01" }\n'),
    nacteni: js(
      `import { prevestPrehled } from ${JSON.stringify(new URL('../lib/pokladna-trzby.ts', import.meta.url).href)}\n` +
        'export async function nactiPrehledTrzeb() { return prevestPrehled(globalThis.__trPrehled) }\n',
    ),
    supabase: js(
      'export async function getServerSupabase() {\n' +
        '  return { from(tabulka) {\n' +
        '    const volani = []\n' +
        '    globalThis.__trDotazy.push({ tabulka, volani })\n' +
        '    const b = new Proxy({}, { get(_, k) {\n' +
        '      if (k === "then") return (ok, ko) => Promise.resolve(globalThis.__trOdpoved(tabulka, volani)).then(ok, ko)\n' +
        '      return (...a) => { volani.push([k, ...a]); return b }\n' +
        '    } })\n' +
        '    return b\n' +
        '  } }\n' +
        '}\n',
    ),
    obal: js(
      `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
        'export default function Navigace({ rozsah, children }) { return createElement("div", { "data-navigace": rozsah }, children) }\n',
    ),
  }
  const Trzby = await nactiKomponentu(SOUBORY.trzbyStranka, [
    ['next/link', ODKAZ],
    ['next/navigation', stubT.navigace],
    ['@/lib/firma', stubT.firma],
    ['@/lib/finance-pristup', stubT.pristup],
    ['@/lib/authz', stubT.authz],
    ['@/lib/prihlaseni-adresa', stubT.prihlaseni],
    ['@/lib/supabase/server', stubT.supabase],
    ['@/lib/supabase/dotaz', stubT.dotaz],
    ['@/lib/pokladna-trzby-nacteni', stubT.nacteni],
    ['../navigace', stubT.obal],
  ])
  const SPROPOKLADNOU = { trzby: [{ obdobi: '2026-09-15', branch_id: A, trzba_haleru: 150000, polozek: 10, dnu: 1, dnu_s_platbami: 0 }], platby: [], zpusoby: [], banka: [] }
  const BEZ_POKLADNY = { trzby: [], platby: [], zpusoby: [], banka: [] }
  /** `radku` řádků ostatni_trzby po 1 Kč (CZK, započítané, platné); `chyba` = chyba prvního dotazu. */
  const tr = async ({ radku = 0, chyba = null, prehled = SPROPOKLADNOU, hledani = { obdobi: '2026-09' } } = {}) => {
    globalThis.__trDotazy = []
    globalThis.__trPrehled = prehled
    globalThis.__trPristup = { stav: 'ok', ctx: {}, scope: { level: 'tenant', branchId: null, branchName: 'Firma', branchSlug: 'firma' } }
    globalThis.__trOdpoved = (tabulka, volani) => {
      if (tabulka === 'branches') return { data: [{ id: A, name: 'Bernard Bar', active: true }], error: null }
      if (tabulka !== 'ostatni_trzby') return { data: [], error: null }
      if (chyba) return { data: null, error: chyba }
      const r = volani.find((v) => v[0] === 'range')
      if (!r) return { data: Array.from({ length: radku }, () => ({ branch_id: A, datum: '2026-09-10', castka_haleru: 100, mena: 'CZK', zapocitat: true, stav: 'platna' })), error: null }
      const [, od, doRadku] = r
      const pocet = Math.max(0, Math.min(doRadku - od + 1, radku - od))
      return { data: Array.from({ length: pocet }, () => ({ branch_id: A, datum: '2026-09-10', castka_haleru: 100, mena: 'CZK', zapocitat: true, stav: 'platna' })), error: null }
    }
    let html = null
    let vyjimka = null
    try {
      html = renderToStaticMarkup(await Trzby({ params: Promise.resolve({ rozsah: 'firma' }), searchParams: Promise.resolve(hledani) }))
    } catch (e) {
      vyjimka = e
    }
    const stranky = globalThis.__trDotazy.filter((d) => d.tabulka === 'ostatni_trzby').map((d) => d.volani)
    const karta = (() => {
      const h = html ?? ''
      const i = h.indexOf('>Ostatní tržby</h2>')
      return i < 0 ? null : h.slice(i, h.indexOf('</article>', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    })()
    return { html, vyjimka, stranky, karta }
  }
  const rozsahy = (stranky) => stranky.map((v) => v.find((x) => x[0] === 'range')?.slice(1).join('–') ?? 'bez range')

  const tri = await tr({ radku: 2500 })
  ok(`2 500 řádků → tři stránky 0–999, 1000–1999, 2000–2999 (${rozsahy(tri.stranky).join(', ')})`, rozsahy(tri.stranky).join() === '0–999,1000–1999,2000–2999')
  ok('každá stránka řazená .order(\'id\') a se stejnými filtry (firma, období)',
    tri.stranky.length === 3 && tri.stranky.every((v) => v.some((x) => x[0] === 'order' && x[1] === 'id') &&
      v.some((x) => x[0] === 'eq' && x[1] === 'tenant_id' && x[2] === T) && v.some((x) => x[0] === 'gte' && x[1] === 'datum' && x[2] === '2026-09-01') &&
      v.some((x) => x[0] === 'lte' && x[1] === 'datum' && x[2] === '2026-09-30')))
  ok(`karta sečte VŠECH 2 500 řádků: 2 500 Kč, ne 1 000 Kč z první stránky (${tri.karta})`, /2\s?500 Kč/.test(tri.karta ?? '') && !/1\s?000 Kč/.test(tri.karta ?? ''))
  const presne = await tr({ radku: 1000 })
  ok(`přesně 1 000 řádků → druhá (prázdná) stránka to potvrdí (${rozsahy(presne.stranky).join(', ')}) a součet 1 000 Kč`,
    rozsahy(presne.stranky).join() === '0–999,1000–1999' && /1\s?000 Kč/.test(presne.karta ?? ''))
  const nic = await tr({ radku: 0 })
  ok(`žádný řádek → jediný dotaz a karta „–" (${nic.karta})`, nic.stranky.length === 1 && (nic.karta ?? '').includes('–') && !(nic.karta ?? '').includes('0 Kč'))
  const moc = await tr({ radku: 60_000 })
  ok(`víc než 50 plných stránek → přesně 50 dotazů (${moc.stranky.length}), 51. už ne`, moc.stranky.length === 50 && rozsahy(moc.stranky).at(-1) === '49000–49999')
  ok(`… a karta ukáže chybu, ne useknutý součet 50 000 Kč (${moc.karta})`,
    (moc.karta ?? '').includes('Nejde sečíst') && (moc.karta ?? '').includes('–') && !/50\s?000 Kč/.test(moc.karta ?? ''))
  const mocBezPokladny = await tr({ radku: 60_000, prehled: BEZ_POKLADNY })
  ok('chyba karty i když pokladna za období nic neposlala', (mocBezPokladny.karta ?? '').includes('Nejde sečíst'))
  const bezTabulky = await tr({ chyba: { code: 'PGRST205', message: 'nenalezeno' } })
  ok(`nenasazená tabulka → karta „čeká na aktualizaci databáze" (${bezTabulky.karta})`, bezTabulky.vyjimka === null && (bezTabulky.karta ?? '').includes('čeká na aktualizaci databáze'))
  const porucha = await tr({ chyba: { code: '42501', message: 'permission denied' } })
  ok('jiná chyba dotazu → výjimka (nahlas), ne prázdná karta', porucha.vyjimka !== null && porucha.html === null)
  const naPobocce = await tr({ radku: 3, hledani: { obdobi: '2026-09', pobocka: A } })
  ok('vybraná provozovna: každá stránka i s .eq(branch_id)', naPobocce.stranky.length === 1 && naPobocce.stranky[0].some((x) => x[0] === 'eq' && x[1] === 'branch_id' && x[2] === A))
}

console.log('\n== Rám Financí nerozhoduje; Jiné platby i pro vedoucího s finance.read jen na pobočce (N23) ==')
{
  // Do 19. 10. dělal rám výjimku pro Jiné platby podle adresy (x-foodtab-adresa) — při
  // přechodu přes menu se sdílený layout znovu nevykreslil a výjimka nezabrala. Teď
  // rám nerozhoduje vůbec a hlášku „jen s přehledem celé firmy" si dává každá ostatní
  // stránka sama (scripts/finance-pobocky.test.mjs); agenda ji dostat nesmí.
  const l = zdroj('app/[rozsah]/finance/layout.tsx')
  ok('layout: žádná výjimka ani brána podle adresy (headers, x-foodtab-adresa, jine-platby)', !/headers\(|x-foodtab-adresa|jine-platby|hasAccess/.test(l))
  ok('layout: vrací vždy {children} (jediný return)', /return <>\{children\}<\/>/.test(l) && (l.match(/return /g) ?? []).length === 1)
  for (const soubor of [SOUBORY.prehled, SOUBORY.novy, `${AGENDA}/[zaznam]/page.tsx`]) {
    ok(`${soubor.slice(AGENDA.length + 1)}: hlášku „jen s přehledem celé firmy" nekreslí`, !/SdeleniPobockyBezFirmy|pobocka_bez_firmy|jen s přehledem celé firmy/.test(zdroj(soubor)))
  }

  // Komentáře u vstupu agendy nesmí tvrdit, že v agendě firemní data nejsou: detail
  // čte bankovní platby a Kontakty — jen s finance.read ZA CELOU FIRMU.
  const pSKomentari = text(SOUBORY.pristup).replace(/\r\n/g, '\n')
  ok('jine-platby-pristup: už netvrdí „žádná díra tu není" a říká, že firemní data detail čte jen ZA CELOU FIRMU',
    !pSKomentari.includes('žádná díra tu není') && /detail záznamu sahá i na data\s+\*\s+celé firmy/.test(pSKomentari) && pSKomentari.includes('ZA CELOU FIRMU'))
  ok('jine-platby-pristup: netvrdí, že rám Financí dělá výjimku podle adresy', !/udělá výjimku/.test(pSKomentari))
  // Tvrzení komentářů musí mít oporu v kódu detailu (kdyby kontrola zmizela, komentář by lhal).
  const detail = zdroj(`${AGENDA}/[zaznam]/page.tsx`)
  ok('… a detail se opravdu ptá hasAccess(tenantId, \'finance.read\', null)', detail.includes("hasAccess(tenantId, 'finance.read', null)"))
}

console.log('\n== Tržby (spuštěná stránka): finance.read jen na pobočce → hláška stránky, ne layoutu (N23) ==')
{
  const T2 = 'a1111111-1111-4111-8111-11111111111a'
  const stubB = {
    firma: js(`export async function getCurrentTenantId() { return ${JSON.stringify(T2)} }\n`),
    pristup: js('export async function zkusPristupFinanci() { globalThis.__bfPoradi.push("pristup"); return globalThis.__bfPristup }\n'),
    authz: js('export const TENANT_SCOPE_SEGMENT = "firma"\n'),
    prihlaseni: js('export async function odkazNaPrihlaseni() { return "/prihlaseni" }\n'),
    navigace: js('export function redirect() { throw new Error("PRESMEROVANI") }\n'),
    dotaz: js('export class DotazSelhal extends Error {}\nexport function tabulkaNeexistuje() { return false }\n'),
    nacteni: js('export async function nactiPrehledTrzeb() { globalThis.__bfPoradi.push("data"); throw new Error("data se nesměla číst") }\n'),
    supabase: js('export async function getServerSupabase() { globalThis.__bfPoradi.push("supabase"); throw new Error("databáze se nesměla otevřít") }\n'),
    obal: js(
      `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
        'export default function Navigace({ children }) { return createElement("div", null, children) }\n',
    ),
  }
  const TrzbyB = await nactiKomponentu(SOUBORY.trzbyStranka, [
    ['next/link', ODKAZ],
    ['next/navigation', stubB.navigace],
    ['@/lib/firma', stubB.firma],
    ['@/lib/finance-pristup', stubB.pristup],
    ['@/lib/authz', stubB.authz],
    ['@/lib/prihlaseni-adresa', stubB.prihlaseni],
    ['@/lib/supabase/server', stubB.supabase],
    ['@/lib/supabase/dotaz', stubB.dotaz],
    ['@/lib/pokladna-trzby-nacteni', stubB.nacteni],
    ['../navigace', stubB.obal],
  ])
  globalThis.__bfPoradi = []
  globalThis.__bfPristup = { stav: 'pobocka_bez_firmy' }
  let html = null
  let vyjimka = null
  try {
    html = renderToStaticMarkup(await TrzbyB({ params: Promise.resolve({ rozsah: 'bernard-bar' }), searchParams: Promise.resolve({}) }))
  } catch (e) {
    vyjimka = e
  }
  ok(`pobocka_bez_firmy → hláška „Finance pobočky zatím jen s přehledem celé firmy" (${vyjimka ? vyjimka.message : 'bez výjimky'})`,
    vyjimka === null && (html ?? '').includes('Finance pobočky zatím jen s přehledem celé firmy'))
  ok('… s odkazem na Jiné platby té pobočky (tam smí)', (html ?? '').includes('href="/bernard-bar/finance/trzby/jine-platby"'))
  ok('… a před hláškou se nic nenačetlo (jen vstupní kontrola)', globalThis.__bfPoradi.join() === 'pristup')
}

console.log('\n== Vzhled: žádné svg, emoji ani nové const karta; telefon 375 px ==')
{
  const NOVE = [SOUBORY.prehled, SOUBORY.novy, SOUBORY.formular, SOUBORY.akceZalozit, SOUBORY.nahrat, SOUBORY.akceSoubory, SOUBORY.znacka, SOUBORY.route, SOUBORY.pristup, SOUBORY.soubory]
  ok('všechny soubory agendy existují', NOVE.every((f) => existsSync(f)))
  const sSvg = NOVE.concat([SOUBORY.trzbyObsah]).filter((f) => /<svg/i.test(text(f)))
  ok(`žádné <svg> na místě (ikony jen z ikona.tsx)${sSvg.length ? ' — ' + sSvg.join(', ') : ''}`, sSvg.length === 0)
  const sEmoji = NOVE.concat([SOUBORY.trzbyObsah, SOUBORY.trzbyStranka]).filter((f) => /\p{Extended_Pictographic}/u.test(text(f)))
  ok(`žádné emoji${sEmoji.length ? ' — ' + sEmoji.join(', ') : ''}`, sEmoji.length === 0)
  const sKartou = NOVE.filter((f) => /const karta\s*=/.test(text(f)))
  ok(`žádná nová const karta = {…}${sKartou.length ? ' — ' + sKartou.join(', ') : ''}`, sKartou.length === 0)
  ok('obsah.tsx: jen ta jedna původní karta, nová karta Jiné platby je .ds-plocha',
    (text(SOUBORY.trzbyObsah).match(/const karta\s*=/g) ?? []).length === 1 &&
      /<section className="ds-plocha" aria-label="Jiné platby">/.test(zdroj(SOUBORY.trzbyObsah)))
  // Pevné minimum sloupce bez min(…, 100%) by na telefonu stránku roztáhlo.
  const agenda = []
  const projit = (a) => {
    for (const j of readdirSync(a)) {
      const c = path.posix.join(a, j)
      if (statSync(c).isDirectory()) projit(c)
      else agenda.push(c)
    }
  }
  projit(AGENDA)
  const pevne = agenda.filter((f) => /minmax\(\d+px/.test(text(f)))
  ok(`žádné minmax(Npx, …) bez min(…, 100%) v agendě (${agenda.length} souborů)${pevne.length ? ' — ' + pevne.join(', ') : ''}`, agenda.length >= 7 && pevne.length === 0)
  ok('filtry a tlačítka se zalamují (flexWrap)', (zdroj(SOUBORY.prehled).match(/flexWrap: 'wrap'/g) ?? []).length >= 3 && zdroj(SOUBORY.nahrat).includes("flexWrap: 'wrap'"))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
