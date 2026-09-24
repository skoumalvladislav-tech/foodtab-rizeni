#!/usr/bin/env node
/**
 * Kiosek: výpadek spojení nesmí smazat registraci tabletu.
 *
 * Pusť `node --experimental-strip-types scripts/kiosek.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE STALO (24. 9. 2026)
 *
 * „Pokud na tabletu zavřu nebo přepnu na jinou aplikaci, tak při
 * přihlášení ke kiosku to chce znovu přihlašovací údaje." Tablet po
 * návratu chvíli nemá síť, první dotaz spadne a kiosek ukázal „Tablet
 * není připojený" s tlačítkem „Zaregistrovat znovu" — které smazalo
 * klíč zařízení. Pak chtěl nový registrační kód.
 *
 * Teď se klíč maže JEN na výslovné „tohle zařízení neznám" z databáze.
 * Tahle kontrola hlídá obojí konce: rozpoznání chyby (lib/kiosek-spojeni.ts)
 * proti SKUTEČNÝM hláškám v migracích a to, že obrazovka klíč jinde
 * nemaže.
 *
 * Co tímhle ověřené NENÍ: chování na skutečném tabletu po uspání —
 * to ukáže až provoz (a prohlížeč v náhledu, viz hlášení).
 */

import fs from 'node:fs'

import {
  dalsiPokusZa,
  hlaskaKiosku,
  HLASKA_NEZNAME_ZARIZENI,
  jeOdpojeneZarizeni,
} from '../lib/kiosek-spojeni.ts'

const KOREN = new URL('..', import.meta.url)
const nacti = (cesta) => fs.readFileSync(new URL(cesta, KOREN), 'utf8')

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = sk === ce
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

/** Zdroják bez komentářů — hlídá se kód, ne to, co se o něm píše. */
function bezKomentaru(zdroj) {
  return zdroj
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

console.log('\n== 1. Odpojené zařízení × výpadek spojení ==================')

ma('neznámý klíč z databáze → odpojeno',
  jeOdpojeneZarizeni({ code: '42501', message: HLASKA_NEZNAME_ZARIZENI }), true)
ma('výpadek sítě → NE odpojeno',
  jeOdpojeneZarizeni({ message: 'TypeError: Failed to fetch' }), false)
ma('iPad bez sítě → NE odpojeno',
  jeOdpojeneZarizeni({ message: 'TypeError: Load failed' }), false)
ma('vypršené přihlášení na tabletu → NE odpojeno',
  jeOdpojeneZarizeni({ code: 'PGRST301', message: 'JWT expired' }), false)
ma('funkci chybí právo (chyba serveru) → NE odpojeno, i když je to 42501',
  jeOdpojeneZarizeni({ code: '42501', message: 'permission denied for function kiosk_stav' }), false)
ma('hláška bez kódu → NE odpojeno (musí sedět obojí)',
  jeOdpojeneZarizeni({ message: HLASKA_NEZNAME_ZARIZENI }), false)
ma('pomalý server (5xx) → NE odpojeno',
  jeOdpojeneZarizeni({ code: '57014', message: 'canceling statement due to statement timeout' }), false)
ma('žádná chyba → NE odpojeno', jeOdpojeneZarizeni(null), false)

/*
  Hláška musí sedět s tím, co databáze OPRAVDU vrací. Bere se poslední
  definice každé funkce kiosku z migrací (platí ta s nejvyšším razítkem).
*/
const migrace = fs.readdirSync(new URL('supabase/migrations/', KOREN)).filter((f) => f.endsWith('.sql')).sort()
function posledniDefinice(funkce) {
  let posledni = null
  for (const f of migrace) {
    const s = nacti(`supabase/migrations/${f}`)
    const i = s.indexOf(`create or replace function public.${funkce}(`)
    if (i < 0) continue
    const konec = s.indexOf('\n$$;', i)
    posledni = s.slice(i, konec < 0 ? undefined : konec)
  }
  return posledni
}
for (const funkce of ['kiosk_stav', 'kiosk_zalohy', 'pichnout_pinem', 'potvrdit_zalohu_pinem']) {
  const telo = posledniDefinice(funkce) ?? ''
  ma(`${funkce}: na neznámý klíč vrací právě tuhle hlášku s 42501`,
    telo.includes(`'${HLASKA_NEZNAME_ZARIZENI}'`) && /using errcode = 'insufficient_privilege'/.test(telo), true)
}

console.log('\n== 2. Opakování a hlášky ===================================')

ma('první opakování za 3 s', dalsiPokusZa(1), 3000)
ma('druhé za 5 s', dalsiPokusZa(2), 5000)
ma('po čtyřech pokusech už jen po 30 s', dalsiPokusZa(5), 30000)
ma('nesmysl → 3 s, ne nula (žádná smyčka)', dalsiPokusZa(0), 3000)
ma('„Failed to fetch" se přeloží',
  hlaskaKiosku('TypeError: Failed to fetch', 'x'), 'Spojení se serverem vypadlo. Zkuste to prosím za chvíli znovu.')
ma('„Load failed" (iPad) se přeloží',
  hlaskaKiosku('Load failed', 'x').startsWith('Spojení se serverem vypadlo'), true)
ma('česká hláška z databáze projde beze změny',
  hlaskaKiosku('PIN je na chvíli zamčený.', 'x'), 'PIN je na chvíli zamčený.')
ma('prázdná → výchozí', hlaskaKiosku('', 'Nepodařilo se zapsat.'), 'Nepodařilo se zapsat.')

console.log('\n== 3. Obrazovka kiosku =====================================')

const kiosek = bezKomentaru(nacti('app/kiosek/kiosek.tsx'))

const mazani = [...kiosek.matchAll(/localStorage\.removeItem\(ULOZISTE\)/g)]
ma('klíč se maže na jediném místě', mazani.length, 1)
const predMazanim = kiosek.slice(0, mazani[0]?.index ?? 0)
ma('… a to na obrazovce „odpojeno" (po výslovné odpovědi databáze)',
  predMazanim.lastIndexOf("if (spojeni === 'odpojeno')") > predMazanim.lastIndexOf('if (!stav)'), true)
ma('obrazovka bez stavu (načítání/výpadek) nemaže nic',
  /if \(!stav\) \{[\s\S]*?removeItem[\s\S]*?\n  \}\n/.test(kiosek.slice(kiosek.indexOf('if (!stav) {'))), false)
ma('kiosek nepoužívá klienta s přihlášením aplikace', /getBrowserSupabase/.test(kiosek), false)
ma('… ale vlastního bez sezení', /getKioskSupabase\(\)/.test(kiosek), true)
ma('odpojení se pozná přes jeOdpojeneZarizeni', /jeOdpojeneZarizeni\(error\)/.test(kiosek), true)
ma('po návratu do popředí se ptá hned (visibilitychange)', /addEventListener\('visibilitychange'/.test(kiosek), true)
ma('… a po naskočení sítě (online)', /addEventListener\('online'/.test(kiosek), true)
ma('časovač po neúspěchu jen čeká — neptá se hned znovu (žádná smyčka)',
  /queueMicrotask/.test(kiosek.slice(kiosek.lastIndexOf('useEffect(', kiosek.indexOf('const t = setInterval')), kiosek.indexOf('const t = setInterval'))), false)
ma('časovač se zastaví, když je zařízení odpojené', /if \(!klic \|\| spojeni === 'odpojeno'\) return/.test(kiosek), true)
ma('o úložiště se žádá, ať ho prohlížeč nemaže', /navigator\.storage\?\.persist\?\.\(\)/.test(kiosek), true)

const klient = bezKomentaru(nacti('lib/supabase/kiosek.ts'))
ma('klient kiosku sezení neukládá ani neobnovuje',
  /persistSession: false/.test(klient) && /autoRefreshToken: false/.test(klient), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
