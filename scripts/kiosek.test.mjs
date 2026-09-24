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
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  dalsiPokusZa,
  hlaskaKiosku,
  HLASKA_NEZNAME_ZARIZENI,
  jeOdpojeneZarizeni,
  jeSitovaChyba,
  stavPoChybe,
} from '../lib/kiosek-spojeni.ts'
import { nactiKomponentu } from './vykreslit.mjs'

const KOREN = new URL('..', import.meta.url)
// Konce řádků sjednotit: na Windows je pracovní kopie v CRLF a regexy
// s `\n` by tam tiše nenašly nic (a kontrola by prošla vždycky).
const nacti = (cesta) => fs.readFileSync(new URL(cesta, KOREN), 'utf8').replace(/\r\n/g, '\n')

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

// Rozhodnutí obrazovky jde přes jednu funkci — tady se testuje výstup.
ma('stav po chybě: neznámý klíč → odpojeno',
  stavPoChybe({ code: '42501', message: HLASKA_NEZNAME_ZARIZENI }), 'odpojeno')
ma('stav po chybě: síť → výpadek', stavPoChybe({ message: 'TypeError: Failed to fetch' }), 'vypadek')
ma('stav po chybě: časový limit (AbortError) → výpadek',
  stavPoChybe({ code: '', message: 'AbortError: signal timed out' }), 'vypadek')
ma('stav po chybě: chybějící grant → výpadek, klíč zůstává',
  stavPoChybe({ code: '42501', message: 'permission denied for function kiosk_stav' }), 'vypadek')
ma('síťová chyba se pozná (i časový limit)', jeSitovaChyba('TimeoutError: signal timed out'), true)
ma('chyba serveru NENÍ síťová (věta o wifi by lhala)', jeSitovaChyba('Internal Server Error'), false)

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

/*
  Kiosek volá databázi VÝHRADNĚ jako anon (lib/supabase/kiosek.ts).
  Kdyby budoucí úklid grantů anon právo sebral, každý tablet by trvale
  čekal na spojení. Hlídá se poslední grant i pozdější revoke.
*/
for (const funkce of ['kiosk_stav', 'kiosk_zalohy', 'pichnout_pinem', 'potvrdit_zalohu_pinem', 'registrovat_zarizeni']) {
  let posledniGrant = null
  let revokePo = false
  for (const f of migrace) {
    const s = nacti(`supabase/migrations/${f}`)
    for (const radek of s.split('\n')) {
      if (new RegExp(`grant execute on function public\\.${funkce}\\(`).test(radek)) {
        posledniGrant = radek
        revokePo = false
      }
      if (new RegExp(`revoke .*on function public\\.${funkce}\\(.*from .*anon`).test(radek) ||
          /revoke .*on all functions in schema public .*from .*anon/.test(radek)) {
        revokePo = true
      }
    }
  }
  ma(`${funkce}: smí ji volat anon (a nikdo mu to potom nesebral)`,
    Boolean(posledniGrant && /\banon\b/.test(posledniGrant)) && !revokePo, true)
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
ma('odpojení se pozná jen přes stavPoChybe', /stavPoChybe\(error\) === 'odpojeno'/.test(kiosek), true)
ma("'odpojeno' se nastavuje jen v odpojit()",
  [...kiosek.matchAll(/setSpojeni\('odpojeno'\)/g)].length === 1 &&
    kiosek.indexOf("setSpojeni('odpojeno')") > kiosek.indexOf('const odpojit = useCallback'), true)
ma('výpadek „odpojeno" nepřepíše', /s === 'odpojeno' \? s : 'vypadek'/.test(kiosek), true)
ma('bez zámku, který by uvízl na visícím dotazu (počítadlo kol)',
  /bezi\.current/.test(kiosek) === false && /\+\+kolo\.current/.test(kiosek), true)
ma('odpověď platí jen pro klíč, který v úložišti pořád je', /klicKlient\(\) === k/.test(kiosek), true)
ma('PIN se maže po každém pokusu (finally)', [...kiosek.matchAll(/finally \{\n\s+setPin\(''\)/g)].length, 2)
ma('PIN je na displeji maskovaný', /WebkitTextSecurity: 'disc'/.test(kiosek), true)
ma('výpadek uprostřed nesmaže seznam záloh', /if \(!chybaZaloh\) setZalohy/.test(kiosek), true)
ma('po návratu do popředí se ptá hned (visibilitychange)', /addEventListener\('visibilitychange'/.test(kiosek), true)
ma('… a po naskočení sítě (online)', /addEventListener\('online'/.test(kiosek), true)
ma('časovač po neúspěchu jen čeká — neptá se hned znovu (žádná smyčka)',
  /queueMicrotask/.test(kiosek.slice(kiosek.lastIndexOf('useEffect(', kiosek.indexOf('const t = setInterval')), kiosek.indexOf('const t = setInterval'))), false)
ma('časovač se zastaví, když je zařízení odpojené', /if \(!klic \|\| spojeni === 'odpojeno'\) return/.test(kiosek), true)
ma('o úložiště se žádá, ať ho prohlížeč nemaže', /navigator\.storage\?\.persist\?\.\(\)/.test(kiosek), true)

const klient = bezKomentaru(nacti('lib/supabase/kiosek.ts'))
ma('klient kiosku sezení neukládá ani neobnovuje',
  /persistSession: false/.test(klient) && /autoRefreshToken: false/.test(klient), true)
ma('… a dotaz má časový limit', /db: \{ timeout: 10_000 \}/.test(klient), true)

/*
  HTML ZE SERVERU. Server klíč nezná; do 24. 9. poslal registrační
  formulář, který na zaregistrovaném tabletu probleskl při každém
  spuštění — přesně „chce to znovu přihlašovací údaje". Vykresluje se
  skutečná komponenta.
*/
const STUB_KLIENT = 'data:text/javascript,' + encodeURIComponent(
  'export function getKioskSupabase() { throw new Error("na serveru se nevolá") }\n')
const Kiosek = await nactiKomponentu('app/kiosek/kiosek.tsx', [['@/lib/supabase/kiosek', STUB_KLIENT]])
const zeServeru = renderToStaticMarkup(createElement(Kiosek))
ma('ze serveru přijde „Připojuji…"', zeServeru.includes('Připojuji'), true)
ma('… a NE registrační formulář', /Zaregistrovat/.test(zeServeru), false)

console.log('\n== 4. Docházka po naskenování QR ===========================')

/*
  Vedoucí a majitel měli nahoře přehled pobočky a ruční zápis, vlastní
  Příchod/Odchod až pod nimi — obrazovka z QR vypadala jako „úvodní
  stránka". Když se píchá, je píchačka nahoře sama.
*/
const dochazka = bezKomentaru(nacti('app/[rozsah]/dochazka/page.tsx'))
ma('kód z QR / výsledek píchnutí = režim „píchá se"',
  /const pichaSe = Boolean\(\s*platnyKod \|\|\s*pichnuto \|\|/.test(dochazka), true)
ma('… přehled pobočky se tehdy nekreslí', /\{prehled && !pichaSe \? \(\s*<PrehledDochazky/.test(dochazka), true)
ma('… ani ruční zápis za druhé', /\{!pichaSe && smiZapsatRucne/.test(dochazka), true)
ma('… ani panel nedokončených', /\{pichaSe \? null : \(\s*<PanelNedokoncene/.test(dochazka), true)
ma('… a k přehledu vede odkaz', /prehled && pichaSe \?[\s\S]{0,200}Zobrazit přehled pobočky/.test(dochazka), true)

console.log(`\n${chyb === 0 ? 'VŠECHNO PROŠLO' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
