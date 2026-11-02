#!/usr/bin/env node
/**
 * Rezervace a kalendář akcí — to, co se nedá ověřit v databázi, protože
 * se děje dřív nebo v aplikaci.
 *
 * Pusť `node scripts/rezervace.test.mjs`.
 *
 * Databázovou půlku (práva, RLS, import podle externího ID, „čí je
 * pravda“) hlídá supabase/tests/krok103_scenar.sql. Tady:
 *
 *   1. čtení CSV exportu (česky i anglicky, středník, BOM, uvozovky,
 *      čas v buňce data, neznámý stav, dvojí číslo, bez čísla);
 *   2. řádek z adaptéru: okamžik bez pásma se odmítne;
 *   3. převod stavů: neznámý stav se NEHÁDÁ;
 *   4. formulář: u rezervace ze systému odejdou jen údaje Foodtabu —
 *      a seznam údajů zdroje je TÝŽ jako v migraci (`c_zdrojove`);
 *   5. kalendář: týdny od pondělí, měsíc po celých týdnech, přechod času;
 *   6. napojení: „připojeno“ jen ze stavu `pripojeno`, a nikde v kódu
 *      modulu se `pripojeno` nenastavuje natvrdo;
 *   7. přílohy: cesta sedí s parserem v databázi, strop 20 souborů;
 *      Word .docx ano (i s prázdným typem z telefonu), .doc, .docm
 *      a Excel ne; Word se stahuje pod názvem bez diakritiky;
 *   8. každá stránka i akce modulu se nejdřív ptá na přístup, teprve pak
 *      sahá na data (layout stránku nechrání);
 *   9. univerzální příjmové API;
 *  10. komu chodí upozornění;
 *  11. náhled Wordu: čtení .docx (formát, nadpisy podle jména stylu,
 *      odrážky, tabulky, sledování změn, textová pole), rozbitý soubor
 *      a ZIP bomba dají větu pro člověka, odkaz u Wordu vede na náhled.
 */

import fs from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { DokumentNecitelny, MAX_BLOKU, MAX_XML_BAJTU, MAX_ZNAKU, precistDocx } from '../lib/docx-nahled.ts'
import { crc32 } from '../lib/xlsx-zapis.ts'

import { DRUHY_UPOZORNENI_REZERVACI, souhrnVyberu } from '../lib/rezervace-upozorneni.ts'

import { mapovatStav, naHodinu, naparsovatCsvRezervaci, rozdelitDatumACas, zRadkuZdroje, MAX_RADKU_IMPORTU } from '../lib/rezervace-import.ts'
import {
  UDAJE_FOODTABU,
  UDAJE_ZDROJE,
  bezpecnaZpatky,
  hlaskaZDatabaze,
  jePlatneDatum,
  korunyNaHalere,
  precistFormular,
  halereNaKoruny,
} from '../lib/rezervace-typy.ts'
import {
  dnyTydne,
  hosteText,
  mrizkaMesice,
  pondeli,
  posunPohledu,
  pridatDny,
  rozsahPohledu,
  souhrnDne,
  denDlouze,
} from '../lib/rezervace-kalendar.ts'
import { SYSTEMY, popisStavuPripojeni, poskytovatelSouboru } from '../lib/rezervace-poskytovatele.ts'
import {
  MAX_PRILOH_REZERVACE,
  MIME_DOCX,
  PRIJIMANE_SOUBORY,
  adresaPrilohy,
  cestaPrilohy,
  chybaNahrani,
  jeZip,
  nazevKeStazeni,
  otevritVProhlizeci,
  zkontrolovatVyber,
} from '../lib/rezervace-prilohy.ts'
import { MAX_REZERVACI_V_DAVCE, overitDavkuRezervaci, rozebratKlicRezervaci, slozitKlicRezervaci } from '../lib/rezervace-prijem-api.ts'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

console.log('\n== 1. CSV export ==\n')
{
  const cesky =
    '﻿Číslo rezervace;Datum;Čas;Jméno;Počet osob;Telefon;Stav;Poznámka;Stůl\r\n' +
    'R-1;30.10.2026;19:00;Jan Novák;4;+420 777 111 222;Potvrzená;"u okna; dort ve 20:00";12\r\n' +
    'R-2;31. 10. 2026;7.30;Eva Malá;2;;Zrušeno;;\r\n'
  const v = naparsovatCsvRezervaci(cesky)
  ok('český export se středníkem a BOM: 2 řádky, žádná chyba', v.radky.length === 2 && v.chyby.length === 0)
  const [r1, r2] = v.radky
  ok('datum d.m.rrrr → rrrr-mm-dd, čas HH:MM', r1.datum === '2026-10-30' && r1.od === '19:00')
  ok('„31. 10. 2026“ s mezerami a čas „7.30“', r2.datum === '2026-10-31' && r2.od === '07:30')
  ok('stav převedený, původní zůstal', r1.stav === 'potvrzeno' && r1.stav_zdroje === 'Potvrzená' && r2.stav === 'zrusena')
  ok('středník v uvozovkách patří do poznámky', r1.poznamka === 'u okna; dort ve 20:00')
  ok('stůl → prostor, počet, telefon', r1.prostor === '12' && r1.pocet_osob === '4' && r1.telefon === '+420 777 111 222')
  ok('číslo rezervace ze souboru, bez odvozování', r1.externi_id === 'R-1' && v.bezCisla === false)

  const anglicky =
    'Reservation ID,Date,Guest name,Party size,Status,Notes\n' +
    'TF-9,2026-11-02T20:15:00+01:00,Anna Svobodová,3,SEATED,"Řádek\njedna"\n' +
    'TF-10,2026-11-02 21:00,Petr Kos,,NO_SHOW,\n'
  const e = naparsovatCsvRezervaci(anglicky)
  ok('anglický export s čárkou: 2 řádky', e.radky.length === 2 && e.chyby.length === 0)
  ok('čas schovaný v buňce data (ISO i s mezerou)', e.radky[0].od === '20:15' && e.radky[1].od === '21:00' && e.radky[0].datum === '2026-11-02')
  ok('SEATED = potvrzená (Foodtab neřídí stoly), NO_SHOW = nedorazili', e.radky[0].stav === 'potvrzeno' && e.radky[1].stav === 'nedostavil_se')
  ok('odřádkování uvnitř uvozovek zůstane v poznámce', e.radky[0].poznamka === 'Řádek\njedna')
  ok('prázdný počet osob = neuvedeno, ne 0', e.radky[1].pocet_osob === '')

  const neznamy = naparsovatCsvRezervaci('id;datum;čas;jméno;stav\n1;30.10.2026;19:00;A;usazeno u baru\n2;30.10.2026;20:00;B;potvrzeno\n')
  ok('neznámý stav = chyba s hodnotou a číslem řádku (nehádá se)',
    neznamy.chyby.length === 1 && neznamy.chyby[0].radek === 2 && neznamy.chyby[0].zprava.includes('usazeno u baru'))

  const dvakrat = naparsovatCsvRezervaci('id;datum;čas;jméno\n7;30.10.2026;19:00;A\n7;30.10.2026;19:00;A\n')
  ok('totéž číslo dvakrát = chyba na druhém řádku', dvakrat.chyby.length === 1 && dvakrat.chyby[0].zprava.includes('poprvé na řádku 2'))

  const bezCisla = naparsovatCsvRezervaci('Datum;Čas;Jméno\n30.10.2026;19:00;Jan  Novák\n')
  const bezCisla2 = naparsovatCsvRezervaci('Datum;Čas;Jméno\n30.10.2026;19:00;jan novák\n')
  ok('bez čísla: odvodí se z data, času a jména a obrazovka se to dozví',
    bezCisla.bezCisla && bezCisla.radky[0].externi_id === 'odvozene:2026-10-30T19:00|jan novak')
  ok('… a tentýž host jinak napsaný dá tentýž klíč (nic se nezdvojí)', bezCisla.radky[0].externi_id === bezCisla2.radky[0].externi_id)

  const bezJmena = naparsovatCsvRezervaci('Datum;Čas;Jméno\n30.10.2026;19:00;\n')
  ok('bez čísla a bez jména nejde spárovat', bezJmena.chyby.length === 1 && bezJmena.radky.length === 0)

  ok('chybí sloupec data = chyba záhlaví', naparsovatCsvRezervaci('id;čas;jméno\n1;19:00;A\n').chyby[0]?.radek === 1)
  ok('prázdný soubor', naparsovatCsvRezervaci('').chyby[0]?.zprava === 'Soubor je prázdný.')
  ok('čas 25:00 neprojde', naparsovatCsvRezervaci('id;datum;čas;jméno\n1;30.10.2026;25:00;A\n').chyby.length === 1)
  ok('31. 2. neprojde', naparsovatCsvRezervaci('id;datum;čas;jméno\n1;31.2.2026;19:00;A\n').chyby.length === 1)
  ok('konec dřív než začátek = přes půlnoc (projde)', naparsovatCsvRezervaci('id;datum;od;do;jméno\n1;30.10.2026;20:00;01:00;A\n').radky[0]?.do === '01:00')
  ok('konec ve stejný čas jako začátek neprojde', naparsovatCsvRezervaci('id;datum;od;do;jméno\n1;30.10.2026;20:00;20:00;A\n').chyby.length === 1)
  ok('počet „čtyři“ neprojde', naparsovatCsvRezervaci('id;datum;čas;jméno;počet\n1;30.10.2026;19:00;A;čtyři\n').chyby.length === 1)

  const moc = 'id;datum;čas;jméno\n' + Array.from({ length: MAX_RADKU_IMPORTU + 1 }, (_, i) => `${i};30.10.2026;19:00;A`).join('\n')
  ok(`víc než ${MAX_RADKU_IMPORTU} řádků = jedna chyba, žádné řádky`, (() => { const r = naparsovatCsvRezervaci(moc); return r.radky.length === 0 && r.chyby.length === 1 })())

  ok('naHodinu: 7:05 → 07:05, 24:00 ne', naHodinu('7:05') === '07:05' && naHodinu('24:00') === null)
  ok('rozdelitDatumACas bez času', rozdelitDatumACas('30.10.2026').hodina === null && rozdelitDatumACas('30.10.2026').datum === '2026-10-30')
}

console.log('\n== 2. Řádek z adaptéru ==\n')
{
  const zaklad = {
    externiId: 'X1', stav: 'potvrzeno', stavZdroje: 'RECORDED', pocetHostu: 2, cas: '2026-11-02T19:00:00+01:00', konec: null,
    externiProvozovna: 'p1', jmenoHosta: 'A', telefonHosta: null, emailHosta: null, poznamka: '', prostor: null, zmenenoKdy: '2026-11-01T10:00:00Z',
  }
  const v = zRadkuZdroje(zaklad)
  ok('okamžik s pásmem projde a jde jako `zacatek`', v.stav === 'ok' && v.radek.zacatek === '2026-11-02T19:00:00+01:00' && !('datum' in v.radek))
  ok('chybějící konec a kontakt = prázdné, ne „null“', v.stav === 'ok' && v.radek.konec === '' && v.radek.telefon === '')
  ok('začátek bez pásma se odmítne', zRadkuZdroje({ ...zaklad, cas: '2026-11-02T19:00:00' }).stav === 'chyba')
  ok('změněno bez pásma se odmítne', zRadkuZdroje({ ...zaklad, zmenenoKdy: '2026-11-01 10:00' }).stav === 'chyba')
  ok('počet hostů 0 se odmítne (neuvedený je null)', zRadkuZdroje({ ...zaklad, pocetHostu: 0 }).stav === 'chyba')
  ok('neuvedený počet = prázdný údaj', (() => { const r = zRadkuZdroje({ ...zaklad, pocetHostu: null }); return r.stav === 'ok' && r.radek.pocet_osob === '' })())
}

console.log('\n== 3. Stavy ze zdroje ==\n')
{
  ok('prázdný stav = potvrzená', mapovatStav('') === 'potvrzeno')
  ok('neznámý stav = null (nehádá se)', mapovatStav('Blocked') === null && mapovatStav('usazeno u baru') === null)
  ok('CANCELED i Cancelled i Storno = zrušená', ['CANCELED', 'Cancelled', 'Storno'].every((s) => mapovatStav(s) === 'zrusena'))
  ok('Pending / Waiting List = předběžná', mapovatStav('Pending') === 'ceka' && mapovatStav('Waiting List') === 'ceka')
}

console.log('\n== 4. Formulář a údaje zdroje ==\n')
{
  const migrace = cti('supabase/migrations/20261027100000_rezervace_akce.sql')
  const m = /c_zdrojove constant text\[\] := array\[([^\]]+)\]/.exec(migrace)
  const vSql = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : []
  ok('seznam údajů zdroje se z migrace vůbec přečetl', vSql.length > 0)
  ok('údaje zdroje v aplikaci = údaje zdroje v databázi (rezervace_ulozit)', JSON.stringify([...UDAJE_ZDROJE].sort()) === JSON.stringify(vSql))

  const pole = { druh: 'rezervace', jmeno_hosta: 'Jan', datum: '2026-10-30', od: '19:00', do: '', pocet_osob: '4', stav: 'potvrzeno', prostor: 'Stůl 1', zaloha: '1 500', telefon: '', email: '' }
  const ziskej = (o) => (k) => o[k] ?? ''
  const rucni = precistFormular(ziskej(pole), { jenFoodtab: false })
  ok('ruční rezervace projde a pošle čas i jméno', rucni.stav === 'ok' && rucni.udaje.datum === '2026-10-30' && rucni.udaje.jmeno_hosta === 'Jan')
  ok('záloha „1 500“ Kč = 150000 haléřů a stav „požadovaná“', rucni.stav === 'ok' && rucni.udaje.zaloha_hosta_haleru === '150000' && rucni.udaje.zaloha_hosta_stav === 'pozadovana')
  const importovana = precistFormular(ziskej(pole), { jenFoodtab: true })
  ok('u rezervace ze systému odejdou JEN údaje Foodtabu',
    importovana.stav === 'ok' && Object.keys(importovana.udaje).every((k) => UDAJE_FOODTABU.includes(k))
    && !Object.keys(importovana.udaje).some((k) => UDAJE_ZDROJE.includes(k)))
  ok('rezervace bez jména a počtu neprojde',
    precistFormular(ziskej({ ...pole, jmeno_hosta: '', pocet_osob: '' }), { jenFoodtab: false }).stav === 'chyba')
  ok('akce stačí s názvem (bez počtu)',
    precistFormular(ziskej({ ...pole, druh: 'akce', jmeno_hosta: '', nazev: 'Svatba', pocet_osob: '' }), { jenFoodtab: false }).stav === 'ok')
  ok('špatný e-mail a telefon s písmeny neprojdou',
    (() => { const r = precistFormular(ziskej({ ...pole, email: 'x@', telefon: 'volat' }), { jenFoodtab: false }); return r.stav === 'chyba' && r.chyby.length === 2 })())
  ok('31. 2. neprojde', precistFormular(ziskej({ ...pole, datum: '2026-02-31' }), { jenFoodtab: false }).stav === 'chyba')
  ok('koruny: 1500,5 → 150050, prázdné → null, nesmysl → NaN',
    korunyNaHalere('1500,5') === 150050 && korunyNaHalere('') === null && Number.isNaN(korunyNaHalere('pět')))
  ok('haléře → „1 500,50 Kč“', halereNaKoruny(150050).replace(/\s/g, ' ') === '1 500,50 Kč')
  ok('jePlatneDatum', jePlatneDatum('2028-02-29') && !jePlatneDatum('2026-02-29'))

  ok('zpět jen dovnitř Rezervací téhož rozsahu',
    bezpecnaZpatky('firma', '/firma/rezervace/den/2026-10-30') === '/firma/rezervace/den/2026-10-30'
    && bezpecnaZpatky('firma', 'https://zly.example') === '/firma/rezervace'
    && bezpecnaZpatky('firma', '/firma/rezervace//zly.example') === '/firma/rezervace'
    && bezpecnaZpatky('firma', '/firma/rezervacex') === '/firma/rezervace'
    && bezpecnaZpatky('firma', '/jina/rezervace') === '/firma/rezervace')
  ok('hláška databáze: naše česká ano, anglický check ne',
    hlaskaZDatabaze({ code: '23514', message: 'Vyplňte datum a čas začátku.' }) === 'Vyplňte datum a čas začátku.'
    && !hlaskaZDatabaze({ code: '23514', message: 'new row violates check constraint "x"' }).includes('violates')
    && !hlaskaZDatabaze({ code: '42501', message: 'permission denied for table rezervace' }).includes('permission'))
}

console.log('\n== 5. Kalendář ==\n')
{
  ok('neděle 1. 11. 2026 patří do týdne od pondělí 26. 10.', pondeli('2026-11-01') === '2026-10-26')
  ok('týden má 7 dnů od pondělí', (() => { const d = dnyTydne('2026-10-28'); return d.length === 7 && d[0] === '2026-10-26' && d[6] === '2026-11-01' })())
  ok('přes změnu času (25. 10.) se den nepřeskočí', pridatDny('2026-10-24', 1) === '2026-10-25' && pridatDny('2026-10-25', 1) === '2026-10-26')
  ok('přes březnovou změnu času taky', pridatDny('2026-03-28', 2) === '2026-03-30')
  const unor = mrizkaMesice('2026-02-14')
  ok('únor 2026 (začíná nedělí): 5 týdnů od pondělí 26. 1. do 1. 3.',
    unor.length === 5 && unor[0][0].den === '2026-01-26' && unor[4][6].den === '2026-03-01')
  ok('každý týden mřížky má 7 dnů a sousední měsíc je označený',
    unor.every((t) => t.length === 7) && !unor[0][0].vMesici && unor[0][6].vMesici)
  const rijen = mrizkaMesice('2026-10-01')
  ok('říjen 2026: poslední týden končí 1. 11.', rijen[rijen.length - 1][6].den === '2026-11-01')
  ok('rozsah týdne pro dotaz = pondělí–neděle', JSON.stringify(rozsahPohledu('tyden', '2026-10-28')) === JSON.stringify({ od: '2026-10-26', do: '2026-11-01' }))
  ok('šipka měsíce z 31. 1. vede na 1. 2. (ne na 3. 3.)', posunPohledu('mesic', '2026-01-31', 1) === '2026-02-01')
  ok('šipka týdne vede na pondělí dalšího týdne', posunPohledu('tyden', '2026-10-28', 1) === '2026-11-02')
  ok('„Pátek 30. října 2026“', denDlouze('2026-10-30') === 'Pátek 30. října 2026')

  const s = souhrnDne([
    { id: '1', den: 'x', druh: 'rezervace', stav: 'potvrzeno', pocet_osob: 4 },
    { id: '2', den: 'x', druh: 'rezervace', stav: 'zrusena', pocet_osob: 6 },
    { id: '3', den: 'x', druh: 'akce', stav: 'ceka', pocet_osob: null },
    { id: '4', den: 'x', druh: 'rezervace', stav: 'nedostavil_se', pocet_osob: 2 },
  ])
  ok('souhrn dne: zrušené a nedorazivší se do hostů nepočítají', s.rezervaci === 1 && s.akci === 1 && s.hostu === 4 && s.zrusenych === 2)
  ok('… a akce bez počtu se přizná', s.bezPoctu === 1 && hosteText(s) === '4 hosté + 1 bez počtu')
  ok('1 host, 5 hostů', hosteText({ hostu: 1, bezPoctu: 0 }) === '1 host' && hosteText({ hostu: 5, bezPoctu: 0 }) === '5 hostů')
}

console.log('\n== 6. Napojení: „připojeno“ jen po ověření ==\n')
{
  ok('„Připojeno“ jen ze stavu pripojeno',
    ['nepripojeno', 'pripojuje_se', 'vyzaduje_pozornost', 'chyba', 'odpojeno', 'cokoli'].every((s) => popisStavuPripojeni(s).text !== 'Připojeno')
    && popisStavuPripojeni('pripojeno').text === 'Připojeno')
  ok('nové napojení = „Čeká na připojení“', popisStavuPripojeni('nepripojeno').text === 'Čeká na připojení')
  ok('klíče systémů projdou kontrolou v databázi', SYSTEMY.every((s) => /^[a-z0-9_-]{1,40}$/.test(s.klic)))
  ok('Restu (skončilo 2021) v seznamu není', !SYSTEMY.some((s) => s.klic === 'restu'))
  ok('soubor z „jiného“ systému má zdroj csv, ze známého jeho klíč',
    poskytovatelSouboru('jiny') === 'csv' && poskytovatelSouboru('neznamy') === 'csv' && poskytovatelSouboru('tablein') === 'tablein')

  // Strukturální pojistka: kód modulu stav `pripojeno` nastavuje na
  // JEDINÉM místě — adaptér Choice po úspěšném živém testu
  // (`zapsatVysledekTestu` v lib/rezervace-choice-sync.ts; že tam opravdu
  // neprojde nic jiného než úspěšný test, ověřuje spuštěním
  // scripts/rezervace-choice.test.mjs). Databáze ho bez posledni_test_ok =
  // true nepustí (integrace_pripojeni_rezervace_overeno).
  // U příjmového API ho nastavuje databáze (`rezervace_prijmout`) až po
  // úspěšně zapsané dávce — adresa /api/rezervace/prijem ne.
  const vSlozce = (slozka) =>
    fs.readdirSync(path.join(KOREN, slozka), { recursive: true })
      .filter((f) => /\.(ts|tsx)$/.test(String(f)))
      .map((f) => `${slozka}/${String(f).replace(/\\/g, '/')}`)
  const soubory = [
    ...fs.readdirSync(path.join(KOREN, 'lib')).filter((f) => f.startsWith('rezervace-')).map((f) => `lib/${f}`),
    ...vSlozce('app/[rozsah]/rezervace'),
    ...vSlozce('app/api/rezervace'),
  ]
  ok(`prošlo se dost souborů modulu (${soubory.length})`, soubory.length >= 15 && soubory.includes('app/api/rezervace/prijem/route.ts'))
  const RE_PRIPOJENO = /stav\s*[:=]\s*['"]pripojeno['"]/g
  const natvrdo = soubory.filter((f) => cti(f).match(RE_PRIPOJENO))
  ok(`stav 'pripojeno' se v modulu zapisuje jen v lib/rezervace-choice-sync.ts${natvrdo.length ? ' — ' + natvrdo.join(', ') : ''}`,
    natvrdo.length === 1 && natvrdo[0] === 'lib/rezervace-choice-sync.ts')
  const sync = cti('lib/rezervace-choice-sync.ts')
  const telo = sync.slice(sync.indexOf('export async function zapsatVysledekTestu'), sync.indexOf('export async function jinePripojeniTehozPodniku'))
  ok('… jednou, uvnitř zapsatVysledekTestu, jen ve větvi úspěšného testu a spolu s posledni_test_ok: true',
    (sync.match(RE_PRIPOJENO) ?? []).length === 1
    && telo.length > 0
    && /if \(test\.stav === 'ok'\) \{\s*zmena = \{ stav: 'pripojeno', posledni_test_ok: true,/.test(telo))
}

console.log('\n== 7. Přílohy ==\n')
{
  const cesta = cestaPrilohy('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'application/pdf')
  const casti = cesta.split('/')
  ok('cesta má dvě složky a jméno souboru ve tvaru, který čte app.rezervace_cesta',
    casti.length === 3 && /^[0-9a-f-]{36}\.(jpg|png|webp|pdf|docx)$/.test(casti[2]))
  const migrace = cti('supabase/migrations/20261027100000_rezervace_akce.sql')
  // Word: 20261106110000. Komentáře pryč — v hlavičce se .doc a .docm
  // jmenují právě proto, že povolené NEJSOU.
  const word = cti('supabase/migrations/20261106110000_rezervace_prilohy_word.sql')
  const wordBezKomentaru = word.split('\n').filter((r) => !r.trimStart().startsWith('--')).join('\n')
  const TYPY = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', MIME_DOCX]
  const priponyAplikace = TYPY.map((m) => cestaPrilohy('a', 'b', 'c', m).split('.').pop()).sort()
  const priponyDatabaze = (wordBezKomentaru.match(/\\\.\(([a-z|]+)\)\$/)?.[1] ?? '').split('|').sort()
  ok('Word dostane v cestě příponu .docx', cestaPrilohy('a', 'b', 'c', MIME_DOCX) === 'a/b/c.docx')
  ok('přípony v aplikaci = přípony v app.rezervace_cesta (20261106110000)',
    JSON.stringify(priponyAplikace) === JSON.stringify(priponyDatabaze))
  ok('kbelík i CHECK v migraci nesou .docx, ne .doc ani .docm',
    wordBezKomentaru.split("'" + MIME_DOCX + "'").length - 1 === 2
    && !/msword|macroEnabled/i.test(wordBezKomentaru))
  ok('Komunikace (zprávy) Word dál nepřijímá — platí jen pro rezervace',
    !cti('lib/komunikace/prilohy.ts').includes('wordprocessingml'))
  ok('databáze opravdu chce dvě složky (původní i přepsaná app.rezervace_cesta)',
    /array_length\(v_slozky, 1\) is distinct from 2/.test(migrace) && /array_length\(v_slozky, 1\) is distinct from 2/.test(wordBezKomentaru))
  const vyber = zkontrolovatVyber(
    [
      { name: 'smlouva.pdf', type: 'application/pdf', size: 1000 },
      { name: 'virus.exe', type: 'application/octet-stream', size: 1000 },
      { name: 'prazdny.pdf', type: 'application/pdf', size: 0 },
      { name: 'velky.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 },
      { name: 'fotka.jpg', type: 'image/jpeg', size: 9 * 1024 * 1024 },
    ],
    0,
  )
  ok('PDF a fotka projdou; exe, prázdný a velký PDF ne', JSON.stringify(vyber.platne) === JSON.stringify([0, 4]) && vyber.chyby.length === 3)
  const vyberWord = zkontrolovatVyber(
    [
      { name: 'Smlouva.docx', type: MIME_DOCX, size: 1000 },
      { name: 'Menu.DOCX', type: '', size: 1000 },
      { name: 'plan.docx', type: 'application/octet-stream', size: 1000 },
      { name: 'stary.doc', type: 'application/msword', size: 1000 },
      { name: 'stary.doc', type: '', size: 1000 },
      { name: 'makra.docm', type: 'application/vnd.ms-word.document.macroEnabled.12', size: 1000 },
      { name: 'makra.docm', type: 'application/octet-stream', size: 1000 },
      { name: 'tabulka.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 1000 },
      { name: 'velky.docx', type: MIME_DOCX, size: 11 * 1024 * 1024 },
      { name: 'virus.docx.exe', type: 'application/octet-stream', size: 1000 },
    ],
    0,
  )
  ok('Word .docx projde i s prázdným typem nebo octet-stream (telefon, Windows bez Office)',
    [0, 1, 2].every((i) => vyberWord.platne.includes(i)))
  ok('… starý .doc, .docm s makry, Excel, velký .docx ani .docx.exe ne',
    vyberWord.platne.length === 3 && vyberWord.chyby.length === 7)
  ok('.docx je zip (PK\\x03\\x04); starý .doc (OLE) ani dva bajty ne',
    jeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])) && !jeZip(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])) && !jeZip(new Uint8Array([0x50, 0x4b])))
  ok('v prohlížeči se otevře PDF a fotka, Word ne', otevritVProhlizeci('application/pdf') && otevritVProhlizeci('image/jpeg')
    && !otevritVProhlizeci(MIME_DOCX) && !otevritVProhlizeci(''))
  ok('název ke stažení bez diakritiky a mezer, s jednou příponou',
    nazevKeStazeni('Smlouva – Novák.docx', MIME_DOCX) === 'Smlouva_Novak.docx'
    && nazevKeStazeni('plan.DOCX', MIME_DOCX) === 'plan.docx'
    && nazevKeStazeni('menu', MIME_DOCX) === 'menu.docx')
  ok('… bez lomítek a teček na začátku; prázdný název = priloha.docx',
    nazevKeStazeni('../../etc.docx', MIME_DOCX) === 'etc.docx' && nazevKeStazeni('', MIME_DOCX) === 'priloha.docx'
    && nazevKeStazeni('„uvozovky“; a/b.docx', MIME_DOCX) === 'uvozovky_a_b.docx')
  {
    const dlouhy = nazevKeStazeni('ř'.repeat(300) + '.docx', MIME_DOCX)
    ok('… dlouhý název zkrácený, jen bezpečné znaky', dlouhy.length <= 105 && /^[A-Za-z0-9._-]+$/.test(dlouhy) && dlouhy.endsWith('.docx'))
  }
  ok('výběr souboru nabízí .docx, ne .doc ani .docm',
    PRIJIMANE_SOUBORY.split(',').includes('.docx') && PRIJIMANE_SOUBORY.split(',').includes(MIME_DOCX)
    && !/msword|macroEnabled|\.doc(,|$)|\.docm/.test(PRIJIMANE_SOUBORY))
  for (const s of ['app/[rozsah]/rezervace/prilohy-nahrat.tsx', 'app/[rozsah]/rezervace/formular.tsx']) {
    const k = cti(s)
    ok(`${s}: výběr souboru bere seznam z jednoho místa`, k.includes('accept={PRIJIMANE_SOUBORY}') && !/accept="/.test(k))
    ok(`${s}: odmítnuté nahrání hlásí přes chybaNahrani (Word před db push česky)`,
      /chybaNahrani\([^)]*error\.message\)/.test(k) && !/se nepodařilo nahrát: \$\{error\.message\}/.test(k))
  }
  {
    const PRED_PUSH = 'Word půjde přiložit až po aktualizaci databáze'
    ok('Word odmítnutý kbelíkem (typ) → česká věta',
      chybaNahrani('Smlouva.docx', MIME_DOCX, 'mime type application/vnd.openxmlformats-officedocument.wordprocessingml.document is not supported').includes(PRED_PUSH))
    // Politika odmítne i po db push (jiná příčina) — věta příčinu jen nabízí.
    const politika = chybaNahrani('Smlouva.docx', MIME_DOCX, 'new row violates row-level security policy')
    ok('Word odmítnutý politikou úložiště → česká věta, příčinu jen nabízí („Jestli…“)',
      politika.includes('Jestli databáze ještě nebyla aktualizovaná') && !politika.includes(PRED_PUSH)
      && !politika.includes('row-level'))
    ok('Word a výpadek sítě → původní hláška, ne „po aktualizaci“',
      chybaNahrani('Smlouva.docx', MIME_DOCX, 'Failed to fetch') === '„Smlouva.docx“ se nepodařilo nahrát: Failed to fetch')
    ok('PDF odmítnuté kvůli typu → původní hláška (věta je jen pro Word)',
      chybaNahrani('Menu.pdf', 'application/pdf', 'mime type application/pdf is not supported') === '„Menu.pdf“ se nepodařilo nahrát: mime type application/pdf is not supported')
  }
  const priprava = cti('app/[rozsah]/rezervace/priprava-souboru.ts')
  ok('příprava: .docx bez zip podpisu se nenahraje; typ se vtiskne do souboru (úložiště čte typ ze souboru)',
    /mime === MIME_DOCX && !jeZip\(/.test(priprava) && /if \(blob\.type !== mime\) blob = new Blob\(\[blob\], \{ type: mime \}\)/.test(priprava))
  ok(`strop ${MAX_PRILOH_REZERVACE} souborů`, zkontrolovatVyber([{ name: 'a.pdf', type: 'application/pdf', size: 1 }], MAX_PRILOH_REZERVACE).platne.length === 0)
  ok('strop v aplikaci = strop v databázi', new RegExp(`>= ${MAX_PRILOH_REZERVACE} then`).test(migrace))
}

console.log('\n== 8. Přístup napřed, data potom ==\n')
{
  const stranky = ['page.tsx', 'den/[datum]/page.tsx', '[id]/page.tsx', 'nova/page.tsx', 'napojeni/page.tsx', 'upozorneni/page.tsx', 'dokument/[id]/page.tsx'].map((s) => `app/[rozsah]/rezervace/${s}`)
  for (const s of stranky) {
    // Jen tělo stránky — importy nahoře by „data“ našly vždycky první.
    const t = cti(s)
    const telo = t.slice(t.indexOf('export default'))
    const pristup = telo.indexOf('zkusPristupRezervacim(')
    const data = Math.min(
      ...['nacistRezervace(', 'nacistRezervaci(', 'nacistPoznamky(', 'nacistPrilohy(', 'nacistPrilohu(', 'stahnoutPrilohu(', 'getServerSupabase(', 'dnesPobocky(']
        .map((x) => (telo.indexOf(x) === -1 ? Infinity : telo.indexOf(x))),
    )
    ok(`${s}: nejdřív přístup, pak data`, t.includes('export default') && pristup !== -1 && data !== Infinity && pristup < data)
  }

  const akce = cti('app/[rozsah]/rezervace/akce.ts')
  const funkce = [...akce.matchAll(/export async function (\w+)\(/g)].map((m) => ({ jmeno: m[1], od: m.index }))
  ok(`akce se našly (${funkce.length})`, funkce.length >= 10)
  for (let i = 0; i < funkce.length; i++) {
    const telo = akce.slice(funkce[i].od, funkce[i + 1]?.od ?? akce.length)
    const v = telo.indexOf('await vstup(')
    const db = telo.indexOf('getServerSupabase(')
    ok(`akce ${funkce[i].jmeno}: přístup dřív než databáze`, v !== -1 && (db === -1 || v < db))
  }

  const detail = cti('app/[rozsah]/rezervace/[id]/page.tsx')
  ok('kontakt hosta se načítá jen tomu, kdo zapisuje', /smiZapisovat \? nacistKontakt\(/.test(detail))

  const soubor = cti('app/api/rezervace/soubor/[id]/route.ts')
  ok('soubor: právo na pobočku se ověří dřív, než vznikne podepsaný odkaz',
    soubor.indexOf("hasAccess(tenantId, 'rezervace.read'") !== -1 && soubor.indexOf("hasAccess(tenantId, 'rezervace.read'") < soubor.indexOf('createSignedUrl('))
  ok('soubor: Word se podepíše ke stažení pod bezpečným názvem, PDF a fotka ne',
    /\.select\('cesta, branch_id, mime, nazev'\)/.test(soubor)
    && /otevritVProhlizeci\(mime\) \? undefined : \{ download: nazevKeStazeni\(/.test(soubor))
  const prvkyPrilohy = cti('app/[rozsah]/rezervace/prvky.tsx')
  const panel = prvkyPrilohy.slice(prvkyPrilohy.indexOf('export function PanelPriloh'), prvkyPrilohy.indexOf('export function HlaskaAkce'))
  // 2. 11.: Word se po kliknutí tiše stáhl a vypadalo to, že se nic
  // nestalo. Teď vede na náhled — a každá příloha do nové záložky.
  ok('detail: odkaz u přílohy z adresaPrilohy (Word → náhled), vždy nová záložka',
    /<a href=\{adresaPrilohy\(rozsah, p\.id, p\.mime\)\} target="_blank" rel="noopener noreferrer"/.test(panel)
    && !panel.includes('/api/rezervace/soubor/'))
}

console.log('\n== 9. Univerzální příjmové API ==\n')
{
  const ID = '11111111-2222-3333-4444-555555555555'
  const NAHODNE = 'A'.repeat(43)
  const klic = slozitKlicRezervaci(ID, NAHODNE)
  ok('klíč nese id připojení a dá se rozebrat zpátky', klic.startsWith('ftrez_') && rozebratKlicRezervaci(klic)?.pripojeniId === ID)
  ok('klíč pokladny (ftpos_) ani zkrácený klíč neprojdou',
    rozebratKlicRezervaci(`ftpos_${ID}_${NAHODNE}`) === null && rozebratKlicRezervaci(`ftrez_${ID}_${'A'.repeat(42)}`) === null)

  const zaklad = { id: 'R-1', zacatek: '2026-11-20T19:00:00+01:00', osob: 4, stav: 'confirmed', jmeno: 'Jan\u0000 Novák', stul: '12' }
  const v = overitDavkuRezervaci({ system: 'choice', rezervace: [zaklad] })
  ok('platná dávka: systém, číslo, okamžik s pásmem, počet', v.stav === 'ok' && v.system === 'choice'
    && v.radky[0].externi_id === 'R-1' && v.radky[0].zacatek === '2026-11-20T19:00:00+01:00' && v.radky[0].pocet_osob === '4')
  ok('stav ze zdroje převedený, původní slovo zůstalo, řídicí znak ze jména pryč',
    v.stav === 'ok' && v.radky[0].stav === 'potvrzeno' && v.radky[0].stav_zdroje === 'confirmed' && v.radky[0].jmeno_hosta === 'Jan Novák')
  ok('stůl → prostor', v.stav === 'ok' && v.radky[0].prostor === '12')
  ok('jedna rezervace místo pole (webhook) projde', (() => { const r = overitDavkuRezervaci({ rezervace: zaklad }); return r.stav === 'ok' && r.radky.length === 1 })())
  ok('bez „system“ = obecne', (() => { const r = overitDavkuRezervaci({ rezervace: [zaklad] }); return r.stav === 'ok' && r.system === 'obecne' })())
  ok('neznámý stav = předběžná (nezahodí se) a slovo zůstane',
    (() => { const r = overitDavkuRezervaci({ rezervace: [{ ...zaklad, stav: 'usazeno u baru' }] }); return r.stav === 'ok' && r.radky[0].stav === 'ceka' && r.radky[0].stav_zdroje === 'usazeno u baru' })())
  ok('stav Foodtabu („zrusena“) projde rovnou', (() => { const r = overitDavkuRezervaci({ rezervace: [{ ...zaklad, stav: 'zrusena' }] }); return r.stav === 'ok' && r.radky[0].stav === 'zrusena' })())
  ok('datum + od = čas na pobočce (bez okamžiku)',
    (() => { const r = overitDavkuRezervaci({ rezervace: [{ id: 'R-2', datum: '2026-11-20', od: '7:30', do: '01:00' }] }); return r.stav === 'ok' && r.radky[0].datum === '2026-11-20' && r.radky[0].od === '07:30' && !('zacatek' in r.radky[0]) })())
  const chybna = (popis, telo, kus) => ok(popis, (() => { const r = overitDavkuRezervaci(telo); return r.stav === 'chyba' && r.duvod.includes(kus) })())
  chybna('začátek bez pásma se odmítne', { rezervace: [{ ...zaklad, zacatek: '2026-11-20T19:00:00' }] }, 'pásmem')
  chybna('konec před začátkem se odmítne', { rezervace: [{ ...zaklad, konec: '2026-11-20T18:00:00+01:00' }] }, 'po začátku')
  chybna('bez id se odmítne', { rezervace: [{ ...zaklad, id: '' }] }, '„id“')
  chybna('totéž id dvakrát v dávce se odmítne', { rezervace: [zaklad, zaklad] }, 'dvakrát')
  chybna('osob 0 se odmítne', { rezervace: [{ ...zaklad, osob: 0 }] }, 'osob')
  chybna('bez času se odmítne', { rezervace: [{ id: 'R-3' }] }, 'chybí čas')
  chybna('změněno bez pásma se odmítne', { rezervace: [{ ...zaklad, zmeneno: '2026-11-01 10:00' }] }, 'zmeneno')
  chybna('dlouhé nebo divné jméno systému se odmítne', { system: 'Choice!', rezervace: [zaklad] }, 'system')
  chybna('pole místo objektu se odmítne', [zaklad], 'objekt')
  chybna('prázdné pole se odmítne', { rezervace: [] }, 'prázdné')
  chybna(`víc než ${MAX_REZERVACI_V_DAVCE} rezervací se odmítne`, { rezervace: Array.from({ length: MAX_REZERVACI_V_DAVCE + 1 }, (_, i) => ({ ...zaklad, id: `R-${i}` })) }, 'po částech')

  const adresa = cti('app/api/rezervace/prijem/route.ts')
  const overeniKlice = adresa.indexOf('tajemstviSedi(klic, ulozenyKlic)')
  ok('adresa: klíč se porovná dřív, než se cokoli zapíše',
    overeniKlice !== -1 && overeniKlice < adresa.indexOf("rpc('rezervace_prijmout'") && overeniKlice < adresa.indexOf('posledni_chyba:'))
  ok('adresa bere jen připojení příjmového API (oblast rezervace, obecne, nepojené)',
    /\.eq\('oblast', 'rezervace'\)\s*\.eq\('poskytovatel', POSKYTOVATEL_PRIJMU\)\s*\.is\('odpojeno_kdy', null\)/.test(adresa))
  // Že spadlá dávka „připojeno“ nenastaví, hlídá krok104 spuštěním, ne
  // textem (pořadí řádků uvnitř jedné transakce nic neznamená).

  const formular = cti('app/[rozsah]/rezervace/formular.tsx')
  ok('formulář: výběr souborů nemá name (soubor nejde přes serverovou akci, ale do úložiště)',
    /<input ref=\{vstupRef\} type="file"(?![^>]*\sname=)[^>]*>/.test(formular))
  const akce = cti('app/[rozsah]/rezervace/akce.ts')
  ok('akce: dokumenty z formuláře jen s cestou téže firmy a pobočky', /precistPrilohyFormulare\(text\(formData, 'prilohy'\), `\$\{tenantId\}\/\$\{pobocka\}\/`\)/.test(akce) && /!p\.cesta\.startsWith\(predponaCesty\)/.test(akce))
  ok('akce: klíč vydá jen správce napojení', (() => {
    const telo = akce.slice(akce.indexOf('export async function vydatKlicPrijmuRezervaci'))
    return telo.indexOf("canSee(v.pristup.ctx, 'integrace.manage')") !== -1 && telo.indexOf("canSee(v.pristup.ctx, 'integrace.manage')") < telo.indexOf('randomBytes(32)')
  })())
}

console.log('\n== 10. Komu chodí upozornění (2. 11. 2026) ==\n')
{
  /*
    Pravidla posílání jsou v databázi (krok107). Tady: obrazovka nabídne
    jen pobočky, kde člověk zapisuje, uloží je akce, která si přístup
    ověří sama, a věta nad tabulkou řekne pravdu o ranním souhrnu
    (nikdo vybraný = všichni, u akcí a rezervací = nikdo).
  */
  const clovek = (akce, rezervace, souhrn) => ({ employee_id: 'x', jmeno: 'X', zarazeni: '', akce, rezervace, souhrn })
  ok('nikdo nevybraný: akce a rezervace „nikdo“, souhrn „všichni v seznamu“',
    souhrnVyberu([clovek(false, false, false)]) === 'Akce: nikdo · Rezervace: nikdo · Ranní souhrn: všichni v seznamu')
  ok('počty se skloňují (1 člověk, 2 lidé, 5 lidí)',
    souhrnVyberu([clovek(true, true, true), clovek(true, true, false), ...Array.from({ length: 3 }, () => clovek(false, true, false))]) ===
      'Akce: 2 lidé · Rezervace: 5 lidí · Ranní souhrn: 1 člověk')
  ok('tři druhy a jména polí sedí s databází (akce, rezervace, souhrn)',
    DRUHY_UPOZORNENI_REZERVACI.map((d) => d.klic).join(',') === 'akce,rezervace,souhrn')

  const stranka = cti('app/[rozsah]/rezervace/upozorneni/page.tsx')
  ok('stránka: lidi jen u poboček, kde člověk zapisuje', /pristup\.pobocky\.filter\(\(p\) => p\.zapis\)/.test(stranka) &&
    stranka.indexOf('.filter((p) => p.zapis)') < stranka.indexOf("rpc('rezervace_upozorneni_lide'"))
  const obsah = cti('app/[rozsah]/rezervace/upozorneni/obsah.tsx')
  ok('obsah: formulář posílá rozsah, pobočku a tři skupiny zaškrtávátek s id zaměstnance',
    obsah.includes('action={ulozitUpozorneni}') && obsah.includes('name="pobocka" value={pobocka.id}') &&
    obsah.includes('name={d.klic}') && obsah.includes('value={c.employee_id}'))
  ok('obsah: u souhrnu řekne, že po zaškrtnutí chodí jen zaškrtnutým', obsah.includes('chodí jen zaškrtnutým'))

  const akce = cti('app/[rozsah]/rezervace/akce.ts')
  const ulozit = akce.slice(akce.indexOf('export async function ulozitUpozorneni'))
  ok('akce: pobočka jen ta, kde člověk zapisuje (pobockaKZapisu), dřív než databáze',
    ulozit.indexOf('pobockaKZapisu(v.pristup') !== -1 && ulozit.indexOf('pobockaKZapisu(v.pristup') < ulozit.indexOf('getServerSupabase('))
  ok('akce: id z formuláře jen ve tvaru uuid', /hodnoty\.some\(\(x\) => !RE_ID\.test\(x\)\)/.test(akce))
  ok('akce: do adresy jen kód výsledku', /redirect\(sParametrem\(zpet, 'stav', 'upozorneni-ulozeno'\)\)/.test(ulozit))

  const prvky = cti('app/[rozsah]/rezervace/prvky.tsx')
  const nastroje = prvky.slice(prvky.indexOf('export function NastrojePohledu'), prvky.indexOf('/* ---------- týden'))
  ok('kalendář: tlačítko Upozornění se zvonečkem jen pro toho, kdo zapisuje',
    nastroje.indexOf('{smiZapisovat ? (') !== -1 && nastroje.indexOf('<Ikona klic="zvonek" /> Upozornění') > nastroje.indexOf('{smiZapisovat ? ('))
  ok('hlášky: uloženo i chyba výběru mají větu', prvky.includes("'upozorneni-ulozeno':") && prvky.includes("'upozorneni-vyber':"))

  ok('ruční zápis a změna stavu pošlou push hned (ne až s plánovačem)',
    (akce.match(/naplanovatPushKeZdroji\(\{ typ: 'rezervace', id/g) ?? []).length === 2)
}

console.log('\n== 11. Náhled Wordu (2. 11. 2026) ==\n')
{
  /*
    Prohlížeč .docx neotevře, jen stáhne — a na počítači to vypadalo, že
    se po kliknutí nic nestalo. Word se proto čte na serveru
    (lib/docx-nahled.ts) a ukáže jako stránka. Je to cizí soubor: musí
    vydržet rozbitý ZIP i ZIP bombu a projde z něj jen text.
  */
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const telo = (xml) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${xml}</w:body></w:document>`
  // ZIP s ústředním adresářem; metoda 8 = deflate (tak ukládá Word), 0 = bez komprese.
  const zabal = (soubory, metoda = 8) => {
    const casti = []
    const adresar = []
    let offset = 0
    for (const [nazev, obsah] of Object.entries(soubory)) {
      const jmeno = Buffer.from(nazev)
      const data = typeof obsah === 'string' ? Buffer.from(obsah) : obsah
      const ulozeno = metoda === 8 ? deflateRawSync(data) : data
      const l = Buffer.alloc(30)
      l.writeUInt32LE(0x04034b50, 0)
      l.writeUInt16LE(20, 4)
      l.writeUInt16LE(metoda, 8)
      l.writeUInt32LE(crc32(data), 14)
      l.writeUInt32LE(ulozeno.length, 18)
      l.writeUInt32LE(data.length, 22)
      l.writeUInt16LE(jmeno.length, 26)
      const u = Buffer.alloc(46)
      u.writeUInt32LE(0x02014b50, 0)
      u.writeUInt16LE(20, 4)
      u.writeUInt16LE(20, 6)
      u.writeUInt16LE(metoda, 10)
      u.writeUInt32LE(crc32(data), 16)
      u.writeUInt32LE(ulozeno.length, 20)
      u.writeUInt32LE(data.length, 24)
      u.writeUInt16LE(jmeno.length, 28)
      u.writeUInt32LE(offset, 42)
      casti.push(l, jmeno, ulozeno)
      adresar.push(u, jmeno)
      offset += 30 + jmeno.length + ulozeno.length
    }
    const velikost = adresar.reduce((n, x) => n + x.length, 0)
    const k = Buffer.alloc(22)
    k.writeUInt32LE(0x06054b50, 0)
    k.writeUInt16LE(adresar.length / 2, 8)
    k.writeUInt16LE(adresar.length / 2, 10)
    k.writeUInt32LE(velikost, 12)
    k.writeUInt32LE(offset, 16)
    return new Uint8Array(Buffer.concat([...casti, ...adresar, k]))
  }
  const chybaCteni = (bajty) => {
    try {
      precistDocx(bajty)
      return null
    } catch (e) {
      return e instanceof DokumentNecitelny ? e.message : `JINÁ VÝJIMKA: ${e?.constructor?.name} ${e?.message}`
    }
  }
  const text = (x) => (x?.druh === 'odstavec' ? x.useky.map((u) => u.text).join('') : '')

  // Česky pojmenované styly: id „Nadpis1“, jméno „heading 1“ (to je v každém jazyku stejné).
  // Nadpis1 schválně BEZ úrovně osnovy — rozhodnout musí jméno, ne outlineLvl.
  const styly = `<w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Normln"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Nadpis1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="MujNadpis"><w:name w:val="Můj nadpis"/><w:basedOn w:val="Nadpis1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Odstavecseseznamem"><w:name w:val="List Paragraph"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Smycka1"><w:name w:val="Smyčka"/><w:basedOn w:val="Smycka2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Smycka2"><w:name w:val="Smyčka 2"/><w:basedOn w:val="Smycka1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Osnova"><w:name w:val="Osnova"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="BezUrovne"><w:name w:val="Bez úrovně"/><w:pPr><w:outlineLvl/></w:pPr></w:style>
  </w:styles>`
  const dokument = telo(`
    <w:p><w:pPr><w:pStyle w:val="Nadpis1"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Svatba Novákovi</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="MujNadpis"/></w:pPr><w:r><w:t>Zděděný nadpis</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Smycka1"/></w:pPr><w:r><w:t>Zacyklený styl</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Osnova"/></w:pPr><w:r><w:t>Osnova 2</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="BezUrovne"/></w:pPr><w:r><w:t>Bez úrovně</w:t></w:r></w:p>
    <w:p><w:pPr><w:outlineLvl w:val="2"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:rPr><w:b/></w:rPr></w:pPr>
      <w:r><w:t xml:space="preserve">Obyčejný </w:t></w:r>
      <w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>tučně</w:t></w:r>
      <w:r><w:rPr><w:b w:val="0"/><w:u w:val="single"/></w:rPr><w:t>podtrženo</w:t></w:r>
      <w:r><w:rPr><w:b w:val="false"/><w:rPrChange w:id="1"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>dřív tučné</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>A&amp;B &lt;c&gt; &#x10D;&#269;</w:t><w:tab/><w:t>za tabulátorem</w:t><w:br/><w:t>nový řádek</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Zůstává </w:t></w:r><w:del w:id="2"><w:r><w:delText>smazané</w:delText><w:t>staré</w:t></w:r></w:del><w:ins w:id="3"><w:r><w:t>vložené</w:t></w:r></w:ins></w:p>
    <w:p><w:pPr><w:pStyle w:val="Odstavecseseznamem"/></w:pPr><w:r><w:t>Předkrm</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Hlavní chod</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Odstavecseseznamem"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Bez odrážky</w:t></w:r></w:p>
    <w:p/>
    <w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>Čas</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Co</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>vnořená</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>18:00</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Přípitek</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t xml:space="preserve">Plán sálu: </w:t></w:r><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>V textovém poli</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:shape><v:imagedata r:id="x"/><v:textbox><w:txbxContent><w:p><w:r><w:t>V textovém poli</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent><w:t>Za polem</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Pole: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "javascript:alert(1)"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>odkaz</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`)
  const n = precistDocx(zabal({ '[Content_Types].xml': '<Types/>', 'word/document.xml': dokument, 'word/styles.xml': styly }))
  const b = n.bloky
  const odst = b.filter((x) => x.druh === 'odstavec')
  const najdi = (t) => odst.find((x) => text(x).startsWith(t))

  ok('nadpis podle JMÉNA stylu („heading 1“), ne podle českého id „Nadpis1“', najdi('Svatba')?.nadpis === 1)
  ok('formát značky konce odstavce (w:rPr ve w:pPr) text neztuční', najdi('Svatba')?.useky.every((u) => !u.tucne))
  ok('vlastní styl postavený na nadpisu je nadpis (w:basedOn)', najdi('Zděděný')?.nadpis === 1)
  ok('zacyklené w:basedOn nezamrzne, je to běžný text', najdi('Zacyklený')?.nadpis === 0)
  ok('úroveň osnovy ze stylu (outlineLvl 1 → nadpis 2)', najdi('Osnova 2')?.nadpis === 2)
  ok('outlineLvl bez hodnoty není nadpis (Number(null) by dalo nadpis 1)', najdi('Bez úrovně')?.nadpis === 0)
  const formaty = najdi('Obyčejný')
  ok('úroveň osnovy přímo v odstavci (outlineLvl 2 → nadpis 3)', formaty?.nadpis === 3)
  ok('zarážka tabulátoru ve w:pPr není tabulátor v textu', !!formaty && !text(formaty).includes('\t'))
  const usek = (t) => formaty?.useky.find((u) => u.text === t)
  ok('tučně a kurzíva', usek('tučně')?.tucne === true && usek('tučně')?.kurziva === true && usek('Obyčejný ')?.tucne === false)
  ok('w:b w:val="0" vypne tučné, podtržení se čte', usek('podtrženo')?.tucne === false && usek('podtrženo')?.podtrzeno === true)
  ok('formát PŘED změnou (w:rPrChange) se nepoužije', usek('dřív tučné')?.tucne === false)
  ok('entity, tabulátor a zalomení řádku', text(najdi('A&B')) === 'A&B <c> čč\tza tabulátorem\nnový řádek')
  ok('sledování změn: smazané pryč, vložené zůstane', text(najdi('Zůstává')) === 'Zůstává vložené')
  ok('odrážka ze stylu i z w:numPr', najdi('Předkrm')?.odrazka === true && najdi('Hlavní chod')?.odrazka === true)
  ok('w:numId 0 odrážku vypne', najdi('Bez odrážky')?.odrazka === false)
  ok('prázdný odstavec <w:p/> zůstane jako mezera', odst.some((x) => x.useky.length === 0))
  const tab = b.find((x) => x.druh === 'tabulka')
  ok('tabulka: 2 řádky po 2 buňkách', tab?.radky.length === 2 && tab.radky.every((r) => r.length === 2))
  const vnorena = tab?.radky[0][1].find((x) => x.druh === 'tabulka')
  ok('vnořená tabulka zůstane v buňce, ne za tabulkou',
    vnorena?.radky[0][0].map(text).join('') === 'vnořená' && !b.some((x) => text(x) === 'vnořená') && b.filter((x) => x.druh === 'tabulka').length === 1)
  ok('text z buňky není v těle dokumentu', !odst.some((x) => ['Čas', 'Přípitek', '18:00'].includes(text(x))))
  const obrazek = najdi('Plán sálu')
  ok('obrázek: spočítaný a v textu značka', obrazek?.useky.some((u) => u.zastupny && u.text === 'obrázek') === true)
  ok('textové pole: text jednou (náhradní kopie mc:Fallback se přeskočí) a nepočítá se jako obrázek',
    odst.filter((x) => text(x) === 'V textovém poli').length === 1 && n.obrazku === 1)
  ok('text za textovým polem zůstane ve svém odstavci a formát konce odstavce z pole ho neztuční',
    najdi('Za polem')?.useky.every((u) => !u.tucne) === true)
  ok('pole: ukáže se výsledek, ne příkaz (adresa z cizího souboru nikam nevede)',
    text(najdi('Pole')) === 'Pole: odkaz' && !JSON.stringify(n).includes('javascript'))
  ok('dokument není zkrácený', n.zkraceno === false)

  // Hlavní část podle _rels/.rels, a ZIP bez komprese.
  const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/></Relationships>'
  const jinde = precistDocx(zabal({ '_rels/.rels': rels, 'word/document2.xml': telo('<w:p><w:r><w:t>Z document2</w:t></w:r></w:p>') }, 0))
  ok('hlavní část podle _rels/.rels, ZIP bez komprese', jinde.bloky.map(text).join('') === 'Z document2')

  // Rozbité a nebezpečné soubory: vždy věta pro člověka, nikdy jiná výjimka.
  ok('není ZIP → „není dokument Word“', chybaCteni(new TextEncoder().encode('{\\rtf1 tohle je RTF}')) === 'Soubor není dokument Word (.docx).')
  ok('ZIP bez dokumentu → „není text dokumentu“', chybaCteni(zabal({ 'xl/workbook.xml': '<workbook/>' })) === 'V souboru není text dokumentu Word.')
  const bomba = zabal({ 'word/document.xml': Buffer.alloc(MAX_XML_BAJTU + 1, 0x20) })
  ok(`ZIP bomba (${Math.round(bomba.length / 1024)} kB → přes ${MAX_XML_BAJTU / 1024 / 1024} MB) → „příliš velký“`,
    chybaCteni(bomba) === 'Dokument je na náhled příliš velký.')
  ok('velká část bez komprese → taky „příliš velký“',
    chybaCteni(zabal({ 'word/document.xml': Buffer.alloc(MAX_XML_BAJTU + 1, 0x20) }, 0)) === 'Dokument je na náhled příliš velký.')
  const rozbity = zabal({ 'word/document.xml': telo('<w:p><w:r><w:t>x</w:t></w:r></w:p>') })
  rozbity.fill(0xff, 47, 70)
  ok('rozbitá komprese → „poškozený“', chybaCteni(rozbity) === 'Dokument je poškozený.')
  const bzip = zabal({ 'word/document.xml': telo('') }, 0)
  new DataView(bzip.buffer).setUint16(bzip.length - 22 - (46 + 'word/document.xml'.length) + 10, 12, true)
  ok('neznámá komprese (bzip2) → srozumitelná věta', chybaCteni(bzip) === 'Dokument je zabalený způsobem, který náhled nezná.')
  let zbloudila = null
  try {
    zbloudila = precistDocx(zabal({ 'word/document.xml': telo('<w:p><w:r><w:t>před</w:t></w:r></w:p></w:tc></w:tr><w:p><w:r><w:t>po</w:t></w:r></w:p>') }))
  } catch {
    // spadne na kontrole níž
  }
  ok('zbloudilé </w:tc> mimo tabulku nic neztratí', zbloudila?.bloky.map(text).join('|') === 'před|po')
  ok('nesmyslná entita (&#99999999;) → „poškozený“, ne pád stránky',
    chybaCteni(zabal({ 'word/document.xml': telo('<w:p><w:r><w:t>&#99999999;</w:t></w:r></w:p>') })) === 'Dokument je poškozený.')

  const dlouhy = precistDocx(zabal({ 'word/document.xml': telo(`<w:p><w:r><w:t>${'a'.repeat(MAX_ZNAKU - 5)}</w:t></w:r></w:p><w:p><w:r><w:t>bbbbbbbbbb</w:t></w:r></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p>`) }))
  ok(`dlouhý text: zkrácený přesně na ${MAX_ZNAKU} znaků, další odstavce nepřibudou`,
    dlouhy.zkraceno && dlouhy.bloky.map(text).join('').length === MAX_ZNAKU && dlouhy.bloky.length === 2)
  const mnoho = precistDocx(zabal({ 'word/document.xml': telo('<w:p/>'.repeat(MAX_BLOKU + 5)) }))
  ok(`moc odstavců: nejvýš ${MAX_BLOKU}, zkrácený`, mnoho.zkraceno && mnoho.bloky.length === MAX_BLOKU)

  // Kam vede odkaz u přílohy.
  ok('odkaz: PDF a fotka rovnou ze souboru, Word na náhled ve Foodtabu',
    adresaPrilohy('perla', 'abc', 'application/pdf') === '/api/rezervace/soubor/abc' &&
      adresaPrilohy('perla', 'abc', 'image/jpeg') === '/api/rezervace/soubor/abc' &&
      adresaPrilohy('perla', 'abc', MIME_DOCX) === '/perla/rezervace/dokument/abc')

  // Stránka a kreslení.
  const stranka = cti('app/[rozsah]/rezervace/dokument/[id]/page.tsx')
  ok('stránka: PDF a fotka se přesměrují na soubor, náhled je jen pro Word',
    stranka.includes('if (otevritVProhlizeci(priloha.mime)) redirect(`/api/rezervace/soubor/${priloha.id}`)') &&
      stranka.indexOf('otevritVProhlizeci(priloha.mime)') < stranka.indexOf('stahnoutPrilohu('))
  ok('stránka: jen nečitelný dokument je věta, jiná chyba se nespolkne', stranka.includes('if (!(e instanceof DokumentNecitelny)) throw e'))
  ok('stránka: id jen ve tvaru uuid', stranka.includes('VZOR_ID.test(id) ? await nacistPrilohu('))
  const data = cti('app/[rozsah]/rezervace/data.ts')
  const stahnout = data.slice(data.indexOf('export async function stahnoutPrilohu'))
  ok('soubor se čte uživatelským klientem (politika kbelíku je druhá linie), ne klíčem služby',
    stahnout.includes('await getServerSupabase()') && !/service_role|SERVICE_ROLE|getAdmin|supabaseAdmin/i.test(data))
  // Jen tělo nacistPrilohu — stejná podmínka je i v nacistRezervaci.
  const nacist = data.slice(data.indexOf('export async function nacistPrilohu'), data.indexOf('export async function stahnoutPrilohu'))
  ok('příloha jen z poboček rozsahu (nacistPrilohu)', nacist.includes('!pobocky.some((p) => p.id === data.branch_id)) return null'))
  ok('stránka: pobočka přílohy musí být v rozsahu i podle stránky',
    stranka.includes('pristup.pobocky.find((p) => p.id === priloha.branch_id)') && stranka.includes('if (!priloha || !pobocka) {'))
  const kresleni = cti('app/[rozsah]/rezervace/dokument/obsah.tsx')
  ok('náhled nevkládá HTML ze souboru', !kresleni.includes('dangerouslySetInnerHTML'))
  ok('originál jde stáhnout tlačítkem', /href=\{`\/api\/rezervace\/soubor\/\$\{priloha\.id\}`\}[^>]*>\s*Stáhnout originál/.test(kresleni))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
