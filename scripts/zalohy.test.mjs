#!/usr/bin/env node
/**
 * Zálohy — nabídka „Komu“ při pozastavení.
 *
 * Pusť `node --experimental-strip-types scripts/zalohy.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PROČ SE VYKRESLUJE FORMULÁŘ
 *
 * Zadání říká, že pozastavený člověk ZMIZÍ Z NABÍDKY. To se dá ověřit
 * dvěma způsoby: přečíst si funkci, která filtruje, nebo se podívat, co
 * je opravdu v rozbalovátku. To první ověřuje záměr — a přesně tak se
 * u QR na kiosku stalo, že kontrola prošla nad kódem, který nefungoval.
 *
 * Proto se tady VYKRESLÍ SKUTEČNÝ FORMULÁŘ (`app/[rozsah]/zalohy/
 * formular.tsx`) a přečtou se z hotového HTML všechny `<option>`.
 *
 * Serverová akce se při vykreslení nahrazuje prázdnou funkcí: modul
 * `./akce` má `'use server'` a tahá `@/lib/supabase/server`, což mimo
 * Next spadne. Nevykresluje se z ní nic — do HTML jde jen `<form>`.
 *
 * ---------------------------------------------------------------------
 * ČEHO SE TÍM NEDOSÁHNE
 *
 * Že odmítnutí drží, tohle neověří. To hlídá databáze
 * (`vyplatit_zalohu` → `app.zalohy_pozastavene`) a scénář
 * `supabase/tests/krok10_scenar.sql`. Tady jde jen o to, že obrazovka
 * nenabízí, co stejně neprojde.
 */

import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { nabidkaKVyplaceni } from '../lib/zalohy-nabidka.ts'
import { veta } from '../lib/sklonovani.ts'
import { nactiKomponentu } from './vykreslit.mjs'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const KOREN = new URL('..', import.meta.url)

/** Prázdná serverová akce — do vykresleného HTML z ní nejde nic. */
const STUB_AKCE =
  'data:text/javascript,' +
  encodeURIComponent('export async function vyplatitZaloh' + 'u() { return { stav: "nic" } }')

const FormularZalohy = await nactiKomponentu('app/[rozsah]/zalohy/formular.tsx', [
  ['./akce', STUB_AKCE],
])

/** Vykreslí formulář a vrátí jména v rozbalovátku „Komu“. */
function nabidkaNaObrazovce(lide) {
  const html = renderToStaticMarkup(
    createElement(FormularZalohy, { rozsah: 'cerna-perla', lide }),
  )
  return [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .filter((m) => m[1] !== '')
    .map((m) => m[2])
}

/* --- data ----------------------------------------------------------- */

const LIDE = [
  { id: 'e1', jmeno: 'Marek Dvořák' },
  { id: 'e2', jmeno: 'Jana Nováková' },
  { id: 'e3', jmeno: 'Petr Sedlák' },
]

const POZASTAVENI = [
  { employee_id: 'e1', pozastaveno: false },
  { employee_id: 'e2', pozastaveno: true },
  { employee_id: 'e3', pozastaveno: false },
]

console.log('\n== Pozastavený z nabídky zmizí ==')

const bezni = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: POZASTAVENI,
  firmaPozastavena: false,
})

const naObrazovce = nabidkaNaObrazovce(bezni.nabidka)

ma('v rozbalovátku jsou dva lidé', naObrazovce.length, 2)
ma('pozastavená v něm NENÍ', naObrazovce.includes('Jana Nováková'), false)
ma('ostatní ano', naObrazovce.join(' · '), 'Marek Dvořák · Petr Sedlák')
ma('a je vidět, že někdo chybí', bezni.skrytych, 1)

console.log('\n== A že to umí spadnout ==')
// Kdyby filtr nedělal nic, tenhle řádek by prošel taky — proto se
// vykreslí i nefiltrovaný seznam a ověří se, že v něm ta osoba JE.
ma('nefiltrovaný seznam ji obsahuje', nabidkaNaObrazovce(LIDE).includes('Jana Nováková'), true)

console.log('\n== Vypnuto za firmu: neprojde nikomu ==')

const zaFirmu = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: POZASTAVENI,
  firmaPozastavena: true,
})
ma('nabídka je prázdná, i když dva pozastavené nemají', zaFirmu.nabidka.length, 0)
ma('a schovaní jsou všichni', zaFirmu.skrytych, 3)
ma('v rozbalovátku nezůstal nikdo', nabidkaNaObrazovce(zaFirmu.nabidka).length, 0)

console.log('\n== Nikdo pozastavený: nabídka se nezmenší ==')

const nikdo = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: LIDE.map((l) => ({ employee_id: l.id, pozastaveno: false })),
  firmaPozastavena: false,
})
ma('všichni tři', nikdo.nabidka.length, 3)
ma('nikdo neschovaný', nikdo.skrytych, 0)

// Člověk, o kterém průzor mlčí (jiná pobočka, chybějící řádek), se
// nemá tiše ztratit — pozastavený je jen ten, o kom to víme.
const chybejici = nabidkaKVyplaceni({
  lide: LIDE,
  pozastaveni: [{ employee_id: 'e1', pozastaveno: true }],
  firmaPozastavena: false,
})
ma('o kom průzor mlčí, ten v nabídce zůstane', chybejici.nabidka.length, 2)

console.log('\n== Věta pod formulářem se ohýbá ==')

/*
  Tři tvary, ne dva. U pěti a víc se čeština vrací k jednotnému číslu
  přísudku — „5 zaměstnanců NENÍ v nabídce“.
*/
const vetaProPocet = (n) =>
  veta(
    n,
    'zaměstnanec není v nabídce, protože má pozastavené zálohy.',
    'zaměstnanci nejsou v nabídce, protože mají pozastavené zálohy.',
    'zaměstnanců není v nabídce, protože mají pozastavené zálohy.',
  )

ma('jeden', vetaProPocet(1), '1 zaměstnanec není v nabídce, protože má pozastavené zálohy.')
ma('tři', vetaProPocet(3), '3 zaměstnanci nejsou v nabídce, protože mají pozastavené zálohy.')
ma('pět', vetaProPocet(5), '5 zaměstnanců není v nabídce, protože mají pozastavené zálohy.')

console.log('\n== Stránka tu funkci opravdu volá ==')

/*
  Bez tohohle řádku by kontrola ověřovala funkci, kterou obrazovka
  nepoužívá — a to je přesně ta chyba, kvůli které se QR na kiosku
  vydalo rozbité.
*/
const stranka = fs.readFileSync(
  new URL('app/[rozsah]/zalohy/page.tsx', KOREN),
  'utf8',
)
ma('page.tsx volá nabidkaKVyplaceni', stranka.includes('nabidkaKVyplaceni({'), true)
ma('a formuláři předává filtrovaný seznam',
  stranka.includes('lide={lideKVyplaceni.map('), true)
ma('nefiltrovaný seznam už formuláři nedává',
  stranka.includes('lide={lide.map('), false)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
