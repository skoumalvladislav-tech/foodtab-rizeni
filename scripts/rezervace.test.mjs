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
 *      odrážky, tabulky se sloučenými buňkami, sledování změn, textová
 *      pole, zaškrtávací políčka, pole, skrytý text, iniciála), hlavní
 *      část a styly podle vazeb; rozbitý soubor, ZIP bomba a soubor
 *      stavěný na zahlcení serveru dají větu pro člověka nebo zkrácený
 *      náhled — každé rozbalení má strop; odkaz u Wordu vede na náhled;
 *  12. dokumenty u rezervací v kalendáři: v týdnu a v dni odkaz vedle
 *      odkazu na rezervaci (ne v něm), v měsíci jen sponka; z náhledu
 *      Wordu „Zpět“ do kalendáře, jen uvnitř Rezervací.
 */

import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import zlib, { deflateRawSync } from 'node:zlib'

import {
  DELKA_ENTITY,
  DokumentNecitelny,
  MAX_BLOKU,
  MAX_BUNEK,
  MAX_MRIZKY,
  MAX_STYLU_BAJTU,
  MAX_USEKU,
  MAX_VAZEB_BAJTU,
  MAX_VNORENI_TABULEK,
  MAX_XML_BAJTU,
  MAX_ZNACEK,
  MAX_ZNACEK_STYLU,
  MAX_ZNACEK_VAZEB,
  MAX_ZNAKU,
  odkodovatDo,
  poznamkaNahledu,
  prazdnyNahled,
  precistDocx,
} from '../lib/docx-nahled.ts'
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
  zpatkyZKalendare,
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
  dokumentyRezervace,
  jeZip,
  nazevKeStazeni,
  otevritVProhlizeci,
  rozdelitNazev,
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
  const odkazPrilohy = prvkyPrilohy.slice(prvkyPrilohy.indexOf('function OdkazPrilohy('), prvkyPrilohy.indexOf('const DOKUMENTU_V_KARTE'))
  // 2. 11.: Word se po kliknutí tiše stáhl a vypadalo to, že se nic
  // nestalo. Teď vede na náhled ve stejném okně (má odkaz zpátky); nová
  // záložka jen u PDF a fotky — z aplikace na ploše iPhonu by otevřela
  // Safari bez přihlášení.
  // 3. 11.: odkaz je jedna komponenta (OdkazPrilohy) pro detail, týden
  // i den. `target` i `adresaPrilohy(` v CELÉ složce Rezervací právě
  // jednou — v ní. Jakýkoli další zápis (target={'_blank'}, {...{ target }},
  // rozprostřená konstanta z lib, vlastní <a href={adresaPrilohy(…)}>
  // v jiném souboru) by Word někde poslal do nové záložky.
  const souboryVe = (slozka) =>
    fs.readdirSync(path.join(KOREN, slozka), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? souboryVe(`${slozka}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${slozka}/${e.name}`] : []))
  const rezervacni = souboryVe('app/[rozsah]/rezervace').map((p) => [p, cti(p)])
  const kdeVsude = (vzor) => rezervacni.flatMap(([p, obsah]) => (obsah.match(vzor) ?? []).map(() => p))
  const jenVPrvcich = JSON.stringify(['app/[rozsah]/rezervace/prvky.tsx'])
  ok(`odkaz u přílohy z adresaPrilohy (Word → náhled), nová záložka jen pro PDF a fotku — jen v OdkazPrilohy, v celé složce Rezervací (${rezervacni.length} souborů)`,
    /<a\s+href=\{adresaPrilohy\(rozsah, p\.id, p\.mime, zpet\)\}\s+\{\.\.\.\(otevritVProhlizeci\(p\.mime\) \? \{ target: '_blank', rel: 'noopener noreferrer' \} : \{\}\)\}/.test(odkazPrilohy)
    && rezervacni.length > 10
    && JSON.stringify(kdeVsude(/\btarget\s*[:=]/g)) === jenVPrvcich
    && JSON.stringify(kdeVsude(/adresaPrilohy\(/g)) === jenVPrvcich
    && JSON.stringify(kdeVsude(/<a\b[^>]*\{\.\.\./g)) === jenVPrvcich
    && !prvkyPrilohy.includes('/api/rezervace/soubor/'))
  ok('detail: příloha přes OdkazPrilohy', /<OdkazPrilohy rozsah=\{rozsah\} p=\{p\}>\s*\{p\.nazev\}\s*<\/OdkazPrilohy>/.test(panel))
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

console.log('\n== 11. Náhled Wordu (2.–3. 11. 2026) ==\n')
{
  /*
    Prohlížeč .docx neotevře, jen stáhne — a na počítači to vypadalo, že
    se po kliknutí nic nestalo. Word se proto čte na serveru
    (lib/docx-nahled.ts) a ukáže jako stránka. Je to cizí soubor: musí
    vydržet rozbitý ZIP, ZIP bombu i soubor stavěný na zahlcení serveru
    a projde z něj jen text.
  */

  // Špeh na rozbalování: každé volání musí mít strop (`maxOutputLength`).
  // Výsledek sám to neprozradí — kontrola délky PO rozbalení dá stejnou
  // větu, jen až po nafouknutí paměti (3. 11.: test bomby prošel i bez
  // stropu). Pojmenovaný import v lib/docx-nahled.ts je živá vazba,
  // syncBuiltinESMExports ji přepojí na špeha.
  const rozbaleni = []
  const puvodniInflate = zlib.inflateRawSync
  zlib.inflateRawSync = (data, volby) => {
    rozbaleni.push(volby?.maxOutputLength)
    return puvodniInflate(data, volby)
  }
  syncBuiltinESMExports()

  const NEZNAMY = 'Dokument je uložený způsobem, který náhled nezná.'
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const telo = (xml) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${xml}</w:body></w:document>`
  // ZIP s ústředním adresářem; metoda 8 = deflate (tak ukládá Word), 0 = bez komprese.
  // `volby[nazev]`: `extra` = výplň v místní hlavičce (Word dává 520 B, v adresáři 0),
  // `popisovac` = bit 3: v místní hlavičce nuly, velikosti až v popisovači za daty.
  const zabal = (soubory, metoda = 8, volby = {}) => {
    const casti = []
    const adresar = []
    let offset = 0
    for (const [nazev, obsah] of Object.entries(soubory)) {
      const { extra = 0, popisovac = false } = volby[nazev] ?? {}
      const jmeno = Buffer.from(nazev)
      const data = typeof obsah === 'string' ? Buffer.from(obsah) : obsah
      const ulozeno = metoda === 8 ? deflateRawSync(data) : data
      const crc = crc32(data)
      const l = Buffer.alloc(30)
      l.writeUInt32LE(0x04034b50, 0)
      l.writeUInt16LE(20, 4)
      l.writeUInt16LE(popisovac ? 0x0008 : 0, 6)
      l.writeUInt16LE(metoda, 8)
      if (!popisovac) {
        l.writeUInt32LE(crc, 14)
        l.writeUInt32LE(ulozeno.length, 18)
        l.writeUInt32LE(data.length, 22)
      }
      l.writeUInt16LE(jmeno.length, 26)
      l.writeUInt16LE(extra, 28)
      const u = Buffer.alloc(46)
      u.writeUInt32LE(0x02014b50, 0)
      u.writeUInt16LE(20, 4)
      u.writeUInt16LE(20, 6)
      u.writeUInt16LE(popisovac ? 0x0008 : 0, 8)
      u.writeUInt16LE(metoda, 10)
      u.writeUInt32LE(crc, 16)
      u.writeUInt32LE(ulozeno.length, 20)
      u.writeUInt32LE(data.length, 24)
      u.writeUInt16LE(jmeno.length, 28)
      u.writeUInt32LE(offset, 42)
      const popis = Buffer.alloc(popisovac ? 16 : 0)
      if (popisovac) {
        popis.writeUInt32LE(0x08074b50, 0)
        popis.writeUInt32LE(crc, 4)
        popis.writeUInt32LE(ulozeno.length, 8)
        popis.writeUInt32LE(data.length, 12)
      }
      casti.push(l, jmeno, Buffer.alloc(extra), ulozeno, popis)
      adresar.push(u, jmeno)
      offset += 30 + jmeno.length + extra + ulozeno.length + popis.length
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
  // Všechny odstavce, i z buněk (do hloubky).
  const odstavceVsude = (bloky) =>
    bloky.flatMap((x) => (x.druh === 'tabulka' ? x.radky.flatMap((r) => r.flatMap((c) => odstavceVsude(c.bloky))) : [x]))
  // Výjimka z čtečky nesmí shodit celý test — další kontroly by se pak
  // vůbec neprovedly. Místo náhledu prázdný náhled s větou chyby.
  // Každý náhled se navíc prověří: stránka umí jen nadpisy 1–3, jiné
  // číslo by ji shodilo (3. 11.: „1.5“ z outlineLvl ve stylu).
  const spatneNadpisy = []
  const nahled = (bajty) => {
    let n
    try {
      n = precistDocx(bajty)
    } catch (e) {
      return { bloky: [], obrazku: -1, zkraceno: false, oriznutaTabulka: false, chyba: e?.message }
    }
    for (const x of odstavceVsude(n.bloky)) if (![0, 1, 2, 3].includes(x.nadpis)) spatneNadpisy.push(`${x.nadpis}: ${x.useky.map((u) => u.text).join('')}`)
    return n
  }
  const text = (x) => (x?.druh === 'odstavec' ? x.useky.map((u) => u.text).join('') : '')
  const precist = (xml, dalsi = {}) => nahled(zabal({ 'word/document.xml': telo(xml), ...dalsi }))
  const wt = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`
  const tc = (t, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}<w:p>${wt(t)}</w:p></w:tc>`
  const VAZBY = 'http://schemas.openxmlformats.org'
  // Seznam vazeb jako z Wordu: vlastnosti dokumentu PŘED hlavní částí.
  const relsWord = (cil) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${VAZBY}/package/2006/relationships">` +
    `<Relationship Id="rId3" Type="${VAZBY}/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `<Relationship Id="rId2" Type="${VAZBY}/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/officeDocument" Target="${cil}"/></Relationships>`
  const APP = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Pages>1</Pages></Properties>'
  const CORE = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Nabídka</dc:title></cp:coreProperties>'

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
  const ZMENA = 'w:author="A" w:date="2026-01-01T00:00:00Z"'
  const dokument = telo(`
    <w:p><w:pPr><w:pStyle w:val="Nadpis1"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Svatba Novákovi</w:t></w:r></w:p>
    <w:p><w:pPr><w:rPr><w:del w:id="9" ${ZMENA}/></w:rPr></w:pPr><w:r><w:t>Smazaná značka odstavce</w:t></w:r></w:p>
    <w:p><w:pPr><w:pPrChange w:id="10" ${ZMENA}><w:pPr><w:pStyle w:val="Nadpis1"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>Dřív nadpis</w:t></w:r></w:p>
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
    <w:p><w:r><w:t xml:space="preserve">Přesun: </w:t></w:r><w:moveFrom w:id="11" ${ZMENA}><w:r><w:t>odtud</w:t></w:r></w:moveFrom><w:moveTo w:id="12" ${ZMENA}><w:r><w:t>sem</w:t></w:r></w:moveTo></w:p>
    <w:p><w:pPr><w:pStyle w:val="Odstavecseseznamem"/></w:pPr><w:r><w:t>Předkrm</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>Hlavní chod</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Odstavecseseznamem"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Bez odrážky</w:t></w:r></w:p>
    <w:p/>
    <w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>Čas</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Co</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>vnořená</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>18:00</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Přípitek</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t xml:space="preserve">Plán sálu: </w:t></w:r><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:rPr><w:b/></w:rPr></w:pPr><w:sdt><w:sdtPr><w:rPr><w:b/><w:i/></w:rPr></w:sdtPr><w:sdtContent><w:r><w:t>V textovém poli</w:t></w:r></w:sdtContent></w:sdt></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:shape><v:imagedata r:id="x"/><v:textbox><w:txbxContent><w:p><w:r><w:t>V textovém poli</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent><w:t>Za polem</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Pole: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "javascript:alert(1)"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>odkaz</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`)
  // Hlavní část jinde než word/document.xml a návnada na tom obvyklém místě:
  // náhled ji musí najít podle druhu vazby, ne podle pořadí ani jména.
  const balik = {
    '[Content_Types].xml': '<Types/>',
    '_rels/.rels': relsWord('word/hlavni.xml'),
    'docProps/app.xml': APP,
    'docProps/core.xml': CORE,
    'word/document.xml': telo('<w:p><w:r><w:t>NÁVNADA</w:t></w:r></w:p>'),
    'word/hlavni.xml': dokument,
    'word/styles.xml': styly,
  }
  const n = nahled(zabal(balik))
  const b = n.bloky
  const odst = b.filter((x) => x.druh === 'odstavec')
  const najdi = (t) => odst.find((x) => text(x).startsWith(t))

  ok('hlavní část podle druhu vazby (officeDocument), ne první vazba ani word/document.xml',
    !!najdi('Svatba') && !JSON.stringify(n).includes('NÁVNADA'))
  // Vazba na adresu mimo balík PŘED skutečnou: v balíku nic nenajde,
  // a kdyby se nepřeskočila, náhled by vzal výchozí word/document.xml.
  const sExterni = nahled(zabal({
    '_rels/.rels': `<Relationships xmlns="${VAZBY}/package/2006/relationships">` +
      `<Relationship Id="rId9" Type="${VAZBY}/officeDocument/2006/relationships/officeDocument" Target="https://example.com/x.docx" TargetMode="External"/>` +
      `<Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/officeDocument" Target="word/hlavni.xml"/></Relationships>`,
    'word/hlavni.xml': telo(`<w:p>${wt('obsah')}</w:p>`),
    'word/document.xml': telo(`<w:p>${wt('výchozí')}</w:p>`),
  }))
  ok('vazba na adresu mimo balík (TargetMode="External") se přeskočí, hlavní část je ta za ní',
    !sExterni.chyba && sExterni.bloky.map(text).join('|') === 'obsah')
  const jakoWord = nahled(zabal(balik, 8, {
    '[Content_Types].xml': { extra: 520 }, '_rels/.rels': { extra: 520 }, 'docProps/app.xml': { extra: 264 },
    'word/hlavni.xml': { extra: 264 }, 'word/styles.xml': { extra: 264 },
  }))
  ok('ZIP jako z Wordu (extra pole v místní hlavičce): stejný náhled', JSON.stringify(jakoWord) === JSON.stringify(n))
  const sPopisovacem = nahled(zabal(balik, 8, { 'word/hlavni.xml': { popisovac: true }, 'word/styles.xml': { popisovac: true } }))
  ok('ZIP s popisovačem dat (bit 3, v místní hlavičce nuly): stejný náhled', JSON.stringify(sPopisovacem) === JSON.stringify(n))

  ok('nadpis podle JMÉNA stylu („heading 1“), ne podle českého id „Nadpis1“', najdi('Svatba')?.nadpis === 1)
  ok('formát značky konce odstavce (w:rPr ve w:pPr) text neztuční', najdi('Svatba')?.useky.every((u) => !u.tucne))
  ok('smazaná značka odstavce (<w:del/> v w:rPr) neschová zbytek dokumentu',
    text(najdi('Smazaná značka')) === 'Smazaná značka odstavce' && !!najdi('Za polem') && !!najdi('Pole'))
  ok('styl PŘED změnou (w:pPrChange) se nepoužije', najdi('Dřív nadpis')?.nadpis === 0)
  ok('vlastní styl postavený na nadpisu je nadpis (w:basedOn)', najdi('Zděděný')?.nadpis === 1)
  ok('zacyklené w:basedOn nezamrzne, je to běžný text', najdi('Zacyklený')?.nadpis === 0)
  ok('úroveň osnovy ze stylu (outlineLvl 1 → nadpis 2)', najdi('Osnova 2')?.nadpis === 2)
  ok('outlineLvl bez hodnoty není nadpis (Number(null) by dalo nadpis 1)', najdi('Bez úrovně')?.nadpis === 0)
  const formaty = najdi('Obyčejný')
  ok('úroveň osnovy přímo v odstavci (outlineLvl 2 → nadpis 3)', formaty?.nadpis === 3)
  const usek = (t) => formaty?.useky.find((u) => u.text === t)
  ok('tučně a kurzíva', usek('tučně')?.tucne === true && usek('tučně')?.kurziva === true && usek('Obyčejný ')?.tucne === false)
  ok('w:b w:val="0" vypne tučné, podtržení se čte', usek('podtrženo')?.tucne === false && usek('podtrženo')?.podtrzeno === true)
  ok('formát PŘED změnou (w:rPrChange) se nepoužije', usek('dřív tučné')?.tucne === false)
  ok('entity, tabulátor a zalomení řádku', text(najdi('A&B')) === 'A&B <c> čč\tza tabulátorem\nnový řádek')
  ok('sledování změn: smazané pryč, vložené zůstane', text(najdi('Zůstává')) === 'Zůstává vložené')
  ok('sledování změn: přesunuté odtud (w:moveFrom) pryč, sem zůstane', text(najdi('Přesun')) === 'Přesun: sem')
  ok('odrážka ze stylu i z w:numPr', najdi('Předkrm')?.odrazka === true && najdi('Hlavní chod')?.odrazka === true)
  ok('w:numId 0 odrážku vypne', najdi('Bez odrážky')?.odrazka === false)
  ok('prázdný odstavec <w:p/> zůstane jako mezera', odst.some((x) => x.useky.length === 0))
  const tab = b.find((x) => x.druh === 'tabulka')
  ok('tabulka: 2 řádky po 2 buňkách', tab?.radky.length === 2 && tab.radky.every((r) => r.length === 2))
  const vnorena = tab?.radky[0][1].bloky.find((x) => x.druh === 'tabulka')
  ok('vnořená tabulka zůstane v buňce, ne za tabulkou',
    vnorena?.radky[0][0].bloky.map(text).join('') === 'vnořená' && !b.some((x) => text(x) === 'vnořená') && b.filter((x) => x.druh === 'tabulka').length === 1)
  ok('text z buňky není v těle dokumentu', !odst.some((x) => ['Čas', 'Přípitek', '18:00'].includes(text(x))))
  const obrazek = najdi('Plán sálu')
  ok('obrázek: spočítaný a v textu značka', obrazek?.useky.some((u) => u.zastupny && u.text === 'obrázek') === true)
  ok('textové pole: text jednou (náhradní kopie mc:Fallback se přeskočí) a nepočítá se jako obrázek',
    odst.filter((x) => text(x) === 'V textovém poli').length === 1 && n.obrazku === 1)
  // Odstavec textového pole leží UVNITŘ běhu okolního odstavce. Jeho zarážka
  // tabulátoru, formát konce odstavce ani formát z w:sdtPr nesmí do toho běhu.
  ok('zarážka tabulátoru v textovém poli není tabulátor v textu', odst.some((x) => text(x) === 'V textovém poli'))
  ok('text za textovým polem zůstane ve svém odstavci, formát z pole (w:pPr, w:sdtPr) ho neztuční ani nenakloní',
    najdi('Za polem')?.useky.every((u) => !u.tucne && !u.kurziva) === true)
  ok('pole: ukáže se výsledek, ne příkaz (adresa z cizího souboru nikam nevede)',
    text(najdi('Pole')) === 'Pole: odkaz' && !JSON.stringify(n).includes('javascript'))
  ok('dokument není zkrácený', n.zkraceno === false)

  // Hlavní část podle _rels/.rels s cestou od kořene, ZIP bez komprese; bez vazeb word/document.xml.
  const rels = `<Relationships xmlns="${VAZBY}/package/2006/relationships"><Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/></Relationships>`
  const jinde = nahled(zabal({ '_rels/.rels': rels, 'word/document2.xml': telo('<w:p><w:r><w:t>Z document2</w:t></w:r></w:p>') }, 0))
  ok('hlavní část podle _rels/.rels (cesta od kořene), ZIP bez komprese', jinde.bloky.map(text).join('') === 'Z document2')
  const chybiCil = nahled(zabal({ '_rels/.rels': relsWord('word/neni.xml'), 'word/document.xml': telo(`<w:p>${wt('výchozí')}</w:p>`) }))
  ok('vazba na chybějící část → word/document.xml', text(chybiCil.bloky[0]) === 'výchozí')
  // Styly podle vazeb hlavní části, ne natvrdo word/styles.xml.
  const stylyJinde = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`
  const sJinde = (cil, cesta) => nahled(zabal({
    '_rels/.rels': relsWord('/word/document2.xml'),
    'word/document2.xml': telo(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wt('Nadpis')}</w:p>`),
    'word/_rels/document2.xml.rels': `<Relationships xmlns="${VAZBY}/package/2006/relationships"><Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/styles" Target="${cil}"/></Relationships>`,
    [cesta]: stylyJinde,
  })).bloky[0]?.nadpis
  ok('styly podle vazeb hlavní části: cesta vůči složce části (styles2.xml → word/styles2.xml)', sJinde('styles2.xml', 'word/styles2.xml') === 1)
  ok('styly podle vazeb hlavní části: cesta od kořene (/word/styles3.xml)', sJinde('/word/styles3.xml', 'word/styles3.xml') === 1)
  ok('styly: vazba na chybějící část → word/styles.xml', sJinde('neni.xml', 'word/styles.xml') === 1)
  const stylyNahoru = nahled(zabal({
    '_rels/.rels': relsWord('word/sub/hlavni.xml'),
    'word/sub/hlavni.xml': telo(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${wt('Nadpis')}</w:p>`),
    'word/sub/_rels/hlavni.xml.rels': `<Relationships xmlns="${VAZBY}/package/2006/relationships"><Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/styles" Target="../stylyX.xml"/></Relationships>`,
    'word/stylyX.xml': stylyJinde,
  })).bloky[0]?.nadpis
  ok('styly: „..“ v cestě vazby vede o složku výš (word/sub/../stylyX.xml)', stylyNahoru === 1)
  // Strict OOXML (Word: Uložit jako → Striktní Open XML) má jiný jmenný prostor.
  const striktni = nahled(zabal({ 'word/document.xml': `<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body><w:p>${wt('Striktní')}</w:p></w:body></w:document>` }))
  ok('Strict OOXML (purl.oclc.org) se přečte', text(striktni.bloky[0]) === 'Striktní')

  // Úrovně nadpisů: stránka má jen tři (h2–h4). Úroveň 4–9 je 3, jiné
  // číslo z cizího souboru (0.5, -1) a úroveň 9 (= běžný text) nadpis nejsou.
  const stylyUrovni = `<w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Nzev"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="Podtitul"><w:name w:val="Subtitle"/></w:style>
    <w:style w:type="paragraph" w:styleId="Nadpis4"><w:name w:val="heading 4"/></w:style>
    <w:style w:type="paragraph" w:styleId="Odrazky"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Menu"><w:name w:val="Menu"/><w:basedOn w:val="Odrazky"/></w:style>
    <w:style w:type="paragraph" w:styleId="Pulka"><w:name w:val="Půlka"/><w:pPr><w:outlineLvl w:val="0.5"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Patra"><w:name w:val="Pět"/><w:pPr><w:outlineLvl w:val="5"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Devet"><w:name w:val="Devět"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Zaporna"><w:name w:val="Záporná"/><w:basedOn w:val="Nadpis4"/><w:pPr><w:outlineLvl w:val="-1"/></w:pPr></w:style>
  </w:styles>`
  const sp = (styl, t) => `<w:p><w:pPr><w:pStyle w:val="${styl}"/></w:pPr>${wt(t)}</w:p>`
  const op = (uroven, t) => `<w:p><w:pPr><w:outlineLvl w:val="${uroven}"/></w:pPr>${wt(t)}</w:p>`
  const urovne = precist(
    sp('Nzev', 'Název') + sp('Podtitul', 'Podtitul') + sp('Nadpis4', 'Nadpis 4') + sp('Menu', 'Svíčková') +
      sp('Pulka', 'Půlka') + sp('Patra', 'Pět') + sp('Devet', 'Devět') + sp('Zaporna', 'Záporná') +
      op('0.5', 'p Půlka') + op('5', 'p Pět') + op('9', 'p Devět') + `<w:p><w:pPr><w:pStyle w:val="Nzev"/><w:outlineLvl w:val="-1"/></w:pPr>${wt('p Záporná')}</w:p>` +
      '<w:p><w:pPr><w:pStyle w:val="Odrazky"/><w:numPr><w:numId w:val="0"></w:numId></w:numPr></w:pPr><w:r><w:t>bez odrážky</w:t></w:r></w:p>',
    { 'word/styles.xml': stylyUrovni },
  )
  const ur = Object.fromEntries(urovne.bloky.map((x) => [text(x), x]))
  ok('styl Title (Název) = nadpis 1, Subtitle = nadpis 2', ur['Název']?.nadpis === 1 && ur['Podtitul']?.nadpis === 2)
  ok('„heading 4“ a úroveň osnovy 5 (ve stylu i v odstavci) = nadpis 3, ne 4 a víc',
    ur['Nadpis 4']?.nadpis === 3 && ur['Pět']?.nadpis === 3 && ur['p Pět']?.nadpis === 3)
  ok('úroveň osnovy 0.5 (ve stylu i v odstavci) není nadpis „1.5“', ur['Půlka']?.nadpis === 0 && ur['p Půlka']?.nadpis === 0)
  ok('úroveň osnovy 9 (= běžný text) nadpis není', ur['Devět']?.nadpis === 0 && ur['p Devět']?.nadpis === 0)
  ok('úroveň osnovy -1 se nepočítá: nadpis ze stylu zůstane (zděděný 4 → 3, Title → 1)',
    ur['Záporná']?.nadpis === 3 && ur['p Záporná']?.nadpis === 1)
  ok('odrážka zděděná přes w:basedOn (styl „Menu“ na „List Bullet“)', ur['Svíčková']?.odrazka === true)
  ok('<w:numId w:val="0"></w:numId> (se zavírací značkou) odrážku vypne', ur['bez odrážky']?.odrazka === false)

  // Sloučené buňky: bez nich je hodnota pod cizím sloupcem.
  const sloucena = precist(`<w:tbl>
    <w:tr>${tc('Čas')}${tc('Program')}${tc('Osob')}</w:tr>
    <w:tr>${tc('Příchod hostů', '<w:gridSpan w:val="2"/>')}${tc('40')}</w:tr>
    <w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>${tc('Večeře')}${tc('38')}</w:tr>
    <w:tr>${tc('Den 1', '<w:vMerge w:val="restart"/>')}${tc('Raut')}${tc('50')}</w:tr>
    <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>${tc('Tanec')}${tc('60')}</w:tr>
    <w:tr><w:tc><w:tcPr><w:vMerge w:val="continue"/></w:tcPr><w:p/></w:tc>${tc('Konec')}${tc('—')}</w:tr>
    <w:tr>${tc('Obří', '<w:gridSpan w:val="99999"/>')}</w:tr>
    <w:tr>${tc('Nesmysl', '<w:gridSpan w:val="abc"/>')}${tc('x')}</w:tr>
  </w:tbl>`)
  const st = sloucena.bloky[0]
  // Sloupec mřížky, kde buňka s daným textem začíná.
  const sloupecTextu = (radek, hledany) => {
    let s = 0
    for (const c of radek ?? []) {
      if (c.bloky.map(text).join('') === hledany) return s
      s += c.sirka
    }
    return -1
  }
  ok('sloučené buňky (w:gridSpan): „40“ je pod „Osob“, ne pod „Program“',
    st?.radky[1][0].sirka === 2 && sloupecTextu(st.radky[1], '40') === sloupecTextu(st.radky[0], 'Osob'))
  ok('odsazení řádku (w:gridBefore): „Večeře“ pod „Program“, „38“ pod „Osob“',
    st?.radky[2][0].odsazeni === true && sloupecTextu(st.radky[2], 'Večeře') === 1 && sloupecTextu(st.radky[2], '38') === 2)
  ok('svisle sloučené (w:vMerge): „Den 1“ přes 3 řádky, pokračování se nekreslí',
    st?.radky[3][0].vyska === 3 && st.radky[4][0].sloucena && st.radky[5][0].sloucena && !st.radky[3][0].sloucena
      && st.radky[3][0].bloky.map(text).join('') === 'Den 1')
  ok('šířka z cizího souboru v mezích: 99999 → 255 (strop mřížky), „abc“ → 1', st?.radky[6][0].sirka === MAX_MRIZKY && MAX_MRIZKY === 255 && st.radky[7][0].sirka === 1)
  const jinaSirka = precist(`<w:tbl><w:tr>${tc('Široká', '<w:gridSpan w:val="2"/>')}</w:tr><w:tr>${tc('Úzká', '<w:vMerge/>')}${tc('vedle')}</w:tr></w:tbl>`)
  const js = jinaSirka.bloky[0]?.radky
  ok('pokračování (w:vMerge) pod buňkou jiné šířky se nesloučí — tabulka by se rozsypala',
    js?.[0][0].vyska === 1 && js[1][0].sloucena === false && js[1][0].bloky.map(text).join('') === 'Úzká')
  const znovu = precist(`<w:tbl><w:tr>${tc('Nahoře')}</w:tr><w:tr>${tc('Začátek', '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${tc('', '<w:vMerge/>')}</w:tr></w:tbl>`)
  const zn = znovu.bloky[0]?.radky
  ok('w:vMerge="restart" pod buňkou stejné šířky začne nové sloučení, nepřilepí se k buňce nad ní',
    zn?.[0][0].vyska === 1 && zn[1][0].sloucena === false && zn[1][0].vyska === 2 && zn[2][0].sloucena === true)
  const vnorenaSloucena = precist(`<w:tbl><w:tr><w:tc><w:tbl><w:tr>${tc('uvnitř', '<w:gridSpan w:val="2"/>')}</w:tr></w:tbl><w:p/></w:tc>${tc('vedle')}</w:tr></w:tbl>`)
  const vnejsi = vnorenaSloucena.bloky[0]?.radky[0]
  ok('w:gridSpan ve vnořené tabulce patří vnitřní buňce', vnejsi?.[0].sirka === 1 && vnejsi[0].bloky[0]?.radky[0][0].sirka === 2)
  const predZmenou = precist(`<w:tbl><w:tr>${tc('a', `<w:tcPrChange w:id="5" ${ZMENA}><w:tcPr><w:gridSpan w:val="3"/></w:tcPr></w:tcPrChange>`)}${tc('b')}</w:tr></w:tbl>`)
  ok('sloučení PŘED změnou (w:tcPrChange) se nepoužije', predZmenou.bloky[0]?.radky[0][0].sirka === 1)
  const odsazeniPredZmenou = precist(`<w:tbl><w:tr><w:trPr><w:trPrChange w:id="6" ${ZMENA}><w:trPr><w:gridBefore w:val="1"/></w:trPr></w:trPrChange></w:trPr>${tc('a')}</w:tr></w:tbl>`)
  ok('odsazení řádku PŘED změnou (w:trPrChange) se nepoužije', odsazeniPredZmenou.bloky[0]?.radky[0].length === 1 && !odsazeniPredZmenou.bloky[0].radky[0][0].odsazeni)
  const textVPokracovani = precist(`<w:tbl><w:tr>${tc('Začátek', '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${tc('i pokračování', '<w:vMerge/>')}</w:tr></w:tbl>`)
  const tp = textVPokracovani.bloky[0]?.radky
  ok('text v pokračování svisle sloučené buňky se neztratí (je v buňce, kde sloučení začíná)',
    tp?.[0][0].bloky.map(text).join('|') === 'Začátek|i pokračování' && tp[1][0].sloucena)
  const nulova = precist(`<w:tbl><w:tr>${tc('nula', '<w:gridSpan w:val="0"/>')}${tc('záporná', '<w:gridSpan w:val="-3"/>')}</w:tr></w:tbl>`)
  ok('šířka 0 a záporná → 1', nulova.bloky[0]?.radky[0].every((c) => c.sirka === 1) === true)
  // Neuzavřená tabulka (zkrácený nebo useknutý soubor) se sloučí taky.
  const neuzavrena = precist(`<w:tbl><w:tr>${tc('Horní', '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${tc('', '<w:vMerge/>')}`)
  ok('neuzavřená tabulka: svislé sloučení platí', neuzavrena.bloky[0]?.radky[0][0].vyska === 2 && neuzavrena.bloky[0].radky[1][0].sloucena)

  // Řádek tabulky: nanejvýš 63 buněk (víc Word nedovolí) a 255 sloupců
  // mřížky. Tisíce buněk po 63 sloupcích (2 kB soubor) zamrazily prohlížeč
  // na minuty.
  const siroky = (n, span) => `<w:tbl><w:tr>${`<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr><w:p/></w:tc>`.repeat(n)}</w:tr></w:tbl><w:p>${wt('za tabulkou')}</w:p>`
  const sirka = (radek) => radek?.reduce((s, c) => s + c.sirka, 0)
  const priliSiroka = precist(siroky(500, 63))
  const ps = priliSiroka.bloky[0]?.radky[0]
  ok(`500 buněk po 63 sloupcích: řádek nejvýš ${MAX_MRIZKY} sloupců mřížky (4 × 63 + zbytek), oříznutá — ne zkrácený dokument, text za tabulkou zůstane`,
    priliSiroka.oriznutaTabulka && !priliSiroka.zkraceno && sirka(ps) === MAX_MRIZKY && ps.length === 5 && ps[4].sirka === MAX_MRIZKY - 4 * 63
      && text(priliSiroka.bloky[1]) === 'za tabulkou')
  const plna = precist(siroky(63, 1))
  ok('63 obyčejných buněk: celý řádek, nic zkráceného, text za tabulkou zůstane',
    !plna.zkraceno && !plna.oriznutaTabulka && plna.bloky[0]?.radky[0].length === 63 && text(plna.bloky[1]) === 'za tabulkou')
  const pres63 = precist(siroky(64, 1))
  ok(`64 obyčejných buněk: nejvýš ${MAX_BUNEK} buněk, oříznutá — ne zkrácený dokument, text za tabulkou zůstane`,
    pres63.oriznutaTabulka && !pres63.zkraceno && pres63.bloky[0]?.radky[0].length === MAX_BUNEK && text(pres63.bloky[1]) === 'za tabulkou')
  const siroka10 = precist(`<w:tbl><w:tr>${'<w:tc><w:p/></w:tc>'.repeat(60)}${tc('poslední', '<w:gridSpan w:val="10"/>')}</w:tr></w:tbl>`)
  const s10 = siroka10.bloky[0]?.radky[0]
  ok('buňka přes 10 sloupců za 60 dalšími zůstane přes 10 (mřížka 70), nic se neuřízne',
    !siroka10.zkraceno && !siroka10.oriznutaTabulka && sirka(s10) === 70 && s10[60].sirka === 10 && s10[60].bloky.map(text).join('') === 'poslední')
  const presah = precist(`<w:tbl><w:tr>${tc('x', '<w:gridSpan w:val="5"/>').repeat(50)}${tc('poslední', '<w:gridSpan w:val="10"/>')}</w:tr></w:tbl>`)
  const pr = presah.bloky[0]?.radky[0]
  ok('poslední buňka přes okraj mřížky se zúží na zbytek (250 + 5), text zůstane, nic se neuřízne',
    !presah.zkraceno && !presah.oriznutaTabulka && sirka(pr) === MAX_MRIZKY && pr[50].sirka === 5 && pr[50].bloky.map(text).join('') === 'poslední')
  const odsazenaSiroka = precist(`<w:tbl><w:tr><w:trPr><w:gridBefore w:val="300"/></w:trPr>${tc('za odsazením')}</w:tr></w:tbl><w:p>${wt('za tabulkou')}</w:p>`)
  ok('odsazení přes celou mřížku: buňka za ním se uřízne, oříznutá, text za tabulkou zůstane',
    odsazenaSiroka.oriznutaTabulka && !odsazenaSiroka.zkraceno && sirka(odsazenaSiroka.bloky[0]?.radky[0]) === MAX_MRIZKY
      && odsazenaSiroka.bloky[0].radky[0].length === 1 && text(odsazenaSiroka.bloky[1]) === 'za tabulkou')
  const odsazenaPlna = precist(`<w:tbl><w:tr><w:trPr><w:gridBefore w:val="2"/></w:trPr>${tc('x').repeat(63)}</w:tr></w:tbl>`)
  ok('odsazení a 63 buněk za ním: celý řádek, odsazení se do buněk nepočítá',
    !odsazenaPlna.oriznutaTabulka && odsazenaPlna.bloky[0]?.radky[0].length === 64 && odsazenaPlna.bloky[0].radky[0][0].odsazeni === true)
  // Mřížka je sjednocení hranic všech řádků: 33 buněk na řádek s hranicemi
  // posunutými proti sobě dá 65 sloupců, i když buněk je pod 63. Rozpis
  // směn (jméno, 31 dní, celkem) se ukáže celý, i se součtem vpravo.
  const bunka = (span, t) => tc(t, `<w:gridSpan w:val="${span}"/>`)
  const posunute = precist(`<w:p>${wt('Rozpis směn')}</w:p><w:tbl><w:tr>${bunka(2, 'a').repeat(32)}${bunka(1, 'Celkem')}</w:tr>` +
    `<w:tr>${bunka(1, 'z')}${bunka(2, 'b').repeat(31)}${bunka(2, '248 h')}</w:tr></w:tbl><w:p>${wt('Poznámka: sraz v 17:00')}</w:p>`)
  const posR = posunute.bloky[1]?.radky
  ok('posunuté hranice (65 sloupců mřížky, 33 buněk): oba řádky celé i se součtem vpravo, nic oříznutého',
    !posunute.oriznutaTabulka && !posunute.zkraceno && posR?.length === 2 && posR.every((r) => sirka(r) === 65 && r.length === 33)
      && posR[0][32].bloky.map(text).join('') === 'Celkem' && posR[1][32].bloky.map(text).join('') === '248 h'
      && posunute.bloky.map(text).join('|') === 'Rozpis směn||Poznámka: sraz v 17:00')
  const vnorenaSiroka = precist(`<w:tbl><w:tr><w:tc><w:tbl><w:tr>${tc('x').repeat(64)}</w:tr></w:tbl><w:p/></w:tc>${tc('vedle')}</w:tr>` +
    `<w:tr>${tc('druhý řádek')}</w:tr></w:tbl><w:p>${wt('Za tabulkou')}</w:p>`)
  const vs = vnorenaSiroka.bloky[0]
  ok('široká tabulka v buňce: oříznutá, zbytek vnější tabulky i text za ní zůstanou',
    vnorenaSiroka.oriznutaTabulka && !vnorenaSiroka.zkraceno && vs?.radky.length === 2 && vs.radky[0][0].bloky[0]?.radky[0].length === MAX_BUNEK
      && vs.radky[0][1]?.bloky.map(text).join('') === 'vedle' && vs.radky[1][0]?.bloky.map(text).join('') === 'druhý řádek'
      && text(vnorenaSiroka.bloky[1]) === 'Za tabulkou')
  const neuzavrenaSiroka = precist(`<w:tbl><w:tr>${tc('x').repeat(64)}`)
  ok('neuzavřená široká tabulka (useknutý soubor): oříznutá, ne zkrácená',
    neuzavrenaSiroka.oriznutaTabulka && !neuzavrenaSiroka.zkraceno && neuzavrenaSiroka.bloky[0]?.radky[0].length === MAX_BUNEK)

  // Zaškrtávací políčka a znaky: bez nich nejde poznat, co zákazník zaškrtl.
  const policko = (stav) =>
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Z"/><w:enabled/><w:checkBox><w:sizeAuto/>${stav}</w:checkBox></w:ffData></w:fldChar></w:r>` +
    '<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
  const sym = (pismo, kod) => `<w:r><w:sym w:font="${pismo}" w:char="${kod}"/></w:r>`
  const zaskrt = precist([
    `<w:p>${policko('<w:default w:val="1"/>')}${wt(' vegetariánské')}</w:p>`,
    `<w:p>${policko('<w:default w:val="0"/>')}${wt(' bezlepkové')}</w:p>`,
    `<w:p>${policko('<w:default w:val="1"/><w:checked w:val="0"/>')}${wt(' přepsané')}</w:p>`,
    `<w:p>${policko('<w:checked/>')}${wt(' zaškrtnuté')}</w:p>`,
    `<w:p>${sym('Wingdings', 'F0FE')}${sym('Wingdings', 'F0A8')}${sym('Wingdings 2', 'F052')}${sym('Wingdings 2', 'F0A3')}${sym('Symbol', 'F0B0')}${sym('Segoe UI Symbol', '2611')}</w:p>`,
    `<w:p>${sym('Wingdings', 'F04A')}${sym('Wingdings', '004A')}${wt('X')}</w:p>`,
  ].join(''))
  const zt = zaskrt.bloky.map(text)
  ok('políčko formuláře: výchozí zaškrtnuté → ☒', zt[0] === '☒ vegetariánské')
  ok('políčko formuláře: výchozí prázdné → ☐', zt[1] === '☐ bezlepkové')
  ok('políčko formuláře: w:checked w:val="0" přebije výchozí', zt[2] === '☐ přepsané')
  ok('políčko formuláře: <w:checked/> → ☒', zt[3] === '☒ zaškrtnuté')
  ok('znaky z Wingdings, Wingdings 2, Symbol a běžného písma (w:sym)', zt[4] === '☑☐☑☐°☑')
  ok('smajlík z Wingdings (F04A i 004A, automatická oprava „:)“) je ☺, ne písmeno „J“', zt[5] === '☺☺X')
  // Znaky, které Word vkládá sám (automatické opravy) nebo do formulářů.
  const WINGDINGS_ZNAKY = [
    ['F0E0', '→'], ['F0DF', '←'], ['F0E1', '↑'], ['F0E2', '↓'], ['F0E8', '⇒'], ['F0E7', '⇐'], ['F0F3', '⇔'],
    ['F04A', '☺'], ['F04B', '😐'], ['F04C', '☹'], ['F071', '❑'], ['F072', '❒'], ['F06E', '■'], ['F06C', '●'], ['F0A1', '○'],
  ]
  const wingdings = precist(WINGDINGS_ZNAKY.map(([kod]) => `<w:p>${sym('Wingdings', kod)}</w:p>`).join(''))
  const spatneZnaky = WINGDINGS_ZNAKY.filter(([, znak], i) => text(wingdings.bloky[i]) !== znak).map(([kod]) => kod)
  ok('šipky, smajlíky, čtverečky a kolečka z Wingdings se převedou', spatneZnaky.length === 0 ? true : (console.log('   ', spatneZnaky), false))
  // 0021 bez předpony F0: kód pod 0xF000, ale ve Wingdings to není „!“,
  // je to tužka — symbolové písmo se Unicodem číst nesmí.
  const neznamy = precist(`<w:p>${sym('Wingdings', 'F021')}${sym('Wingdings', '0021')}${sym('Arial', '110000')}${wt('X')}</w:p>`)
  ok('neznámý znak z Wingdings (F021 i 0021) a kód mimo Unicode (110000) jsou značka „symbol“, dokument se přečte',
    neznamy.bloky[0]?.useky.slice(0, 3).every((u) => u.zastupny) === true && text(neznamy.bloky[0]) === 'symbolsymbolsymbolX')

  // Pole: začátek, oddělovač výsledku, konec.
  const fc = (typ) => `<w:r><w:fldChar w:fldCharType="${typ}"/></w:r>`
  const it = (t) => `<w:r><w:instrText xml:space="preserve">${t}</w:instrText></w:r>`
  // Rozbalovací seznam formuláře (FORMDROPDOWN): vybraná položka je
  // v w:ffData (pořadí), Word ji do výsledku pole nepíše.
  const seznam = (ddList, vysledek = '') =>
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Menu"/><w:enabled/><w:ddList>${ddList}</w:ddList></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMDROPDOWN </w:instrText></w:r>${fc('separate')}${vysledek}${fc('end')}`
  const polozky = '<w:listEntry w:val="A – kuře"/><w:listEntry w:val="B – hovězí"/><w:listEntry w:val="C – ryba &amp; zelenina"/>'
  const seznamy = precist([
    `<w:p>${wt('Menu: ')}${seznam(`<w:result w:val="2"/>${polozky}`)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(`<w:default w:val="1"/>${polozky}`)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(polozky)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(`<w:result w:val="7"/>${polozky}`)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(`<w:result w:val="1"/>${polozky}`, wt('B – hovězí'))}</w:p>`,
    `<w:p>${policko('<w:default w:val="1"/>').replace(fc('end'), `${fc('separate')}${wt('ANO')}${fc('end')}`)}</w:p>`,
    `<w:p>${policko('').replace('<w:checkBox><w:sizeAuto/></w:checkBox>', '<w:checkBox/>')}${wt(' prázdné')}</w:p>`,
    // Totéž se samostatnou zavírací značkou (jiné programy než Word):
    // zavírací značka nemá w:val a nesmí nic přepsat.
    `<w:p>${policko('<w:default w:val="0"></w:default>')}${wt(' bezlep')}</w:p>`,
    `<w:p>${policko('<w:default w:val="1"/><w:checked w:val="0"></w:checked>')}${wt(' přepsané')}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(`<w:result w:val="1"></w:result>${polozky}`)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam(`<w:default w:val="2"></w:default>${polozky}`)}</w:p>`,
    `<w:p>${wt('Menu: ')}${seznam('<w:listEntry w:val="A"></w:listEntry><w:listEntry w:val="B"></w:listEntry><w:result w:val="1"/>')}</w:p>`,
  ].join(''))
  const sz = seznamy.bloky.map(text)
  ok('rozbalovací seznam: vybraná položka (w:result 2 → třetí), entita dekódovaná', sz[0] === 'Menu: C – ryba & zelenina')
  ok('rozbalovací seznam: bez výběru výchozí (w:default), bez obojího první', sz[1] === 'Menu: B – hovězí' && sz[2] === 'Menu: A – kuře')
  ok('rozbalovací seznam: pořadí mimo seznam nic nevymyslí', sz[3] === 'Menu: ')
  ok('pole, které výsledek ukázalo samo, ho nemá dvakrát (seznam i políčko)', sz[4] === 'Menu: B – hovězí' && sz[5] === 'ANO')
  ok('políčko bez vlastností (<w:checkBox/>) → ☐', sz[6] === '☐ prázdné')
  ok('pole formuláře se samostatnou zavírací značkou: w:default, w:checked, w:result i w:listEntry jako s prázdnou značkou',
    JSON.stringify(sz.slice(7)) === JSON.stringify(['☐ bezlep', '☐ přepsané', 'Menu: B – hovězí', 'Menu: C – ryba & zelenina', 'Menu: B']))

  // Pole v poli (hromadná korespondence): výsledek vnitřního pole je v příkazu vnějšího.
  const pole = precist([
    `<w:p>${wt('Vážen')}${fc('begin')}${it(' IF ')}${fc('begin')}${it(' MERGEFIELD Pohlavi ')}${fc('separate')}${wt('«Pohlavi»')}${fc('end')}`,
    `${it(' = "M" "ý pane" "á paní" ')}${fc('separate')}${wt('ý pane')}${fc('end')}${wt(',')}</w:p>`,
    `<w:p>${fc('end')}${wt('Zbloudilý konec pole nic neschová')}</w:p>`,
    `<w:p>${fc('begin')}${it(' FORMTEXT ')}${fc('end')}${wt('Za polem bez výsledku')}</w:p>`,
    `<w:p>${fc('begin')}${it(' TOC ')}${fc('separate')}${wt('Obsah 1')}</w:p><w:p>${wt('Obsah 2')}${fc('end')}</w:p>`,
  ].join(''))
  ok('vnořené pole: výsledek vnitřního pole v příkazu se neukáže („Vážený pane“)', text(pole.bloky[0]) === 'Vážený pane,')
  ok('zbloudilý konec pole nic neschová, pole bez oddělovače neschová text za sebou, výsledek přes víc odstavců zůstane',
    pole.bloky.slice(1).map(text).join('|') === 'Zbloudilý konec pole nic neschová|Za polem bez výsledku|Obsah 1|Obsah 2')

  // Skrytý text Word neukáže ani nevytiskne.
  const skryte = precist(
    `<w:p>${wt('Cena: ')}<w:r><w:rPr><w:vanish/></w:rPr><w:t>INTERNÍ marže 40 %</w:t></w:r>${wt('500 Kč')}</w:p>` +
      '<w:p><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>Viditelné</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
  )
  ok('skrytý text (w:vanish) se neukáže', text(skryte.bloky[0]) === 'Cena: 500 Kč')
  ok('w:vanish w:val="0" je vidět', text(skryte.bloky[1]) === 'Viditelné')
  ok('skrytý obrázek se nepočítá a nemá značku', skryte.obrazku === 0 && text(skryte.bloky[2]) === '')

  // Grafika podle obalu (a:graphicData), ne podle výčtu vnitřních jmen.
  const G = 'http://schemas.openxmlformats.org/drawingml/2006'
  const MS = 'http://schemas.microsoft.com/office'
  const kresba = (uri, vnitrek) => `<w:r><w:drawing><wp:anchor><a:graphic><a:graphicData uri="${uri}">${vnitrek}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  const grafika = precist([
    // Graf nového druhu (vodopád) — náhradní obrázek je v přeskočeném mc:Fallback.
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="cx1">${kresba(`${MS}/drawing/2014/chartex`, '<cx:chart r:id="rId9"/>').slice(5, -6)}</mc:Choice>`,
    `<mc:Fallback>${kresba(`${G}/picture`, '<pic:pic/>').slice(5, -6)}</mc:Fallback></mc:AlternateContent></w:r></w:p>`,
    `<w:p>${kresba(`${MS}/word/2010/wordprocessingShape`, '<wps:wsp><wps:spPr><a:blipFill><a:blip r:embed="rId3"/></a:blipFill></wps:spPr></wps:wsp>')}</w:p>`,
    `<w:p>${kresba(`${MS}/word/2010/wordprocessingGroup`, '<wpg:wgp><pic:pic><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></wpg:wgp>')}</w:p>`,
    `<w:p>${kresba(`${G}/picture`, '<pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>')}</w:p>`,
    `<w:p>${wt('Plocha: ')}<m:oMathPara><m:oMath><m:r><m:t>πr²</m:t></m:r></m:oMath></m:oMathPara></w:p>`,
    `<w:p>${kresba(`${MS}/word/2010/wordprocessingShape`, `<wps:wsp><wps:txbx><w:txbxContent><w:p>${wt('Text v tvaru')}</w:p></w:txbxContent></wps:txbx></wps:wsp>`)}</w:p>`,
  ].join(''))
  const znacky = grafika.bloky.map((x) => x.useky.filter((u) => u.zastupny).map((u) => u.text).join(','))
  ok('graf nového druhu (cx:chart) má značku', znacky[0] === 'obrázek')
  ok('obrázek jako výplň tvaru (a:blipFill) má značku', znacky[1] === 'obrázek')
  ok('obrázek ve skupině tvarů má značku', znacky[2] === 'obrázek')
  ok('obyčejný obrázek jen jednou (a:graphicData i pic:pic v něm)', znacky[3] === 'obrázek')
  ok('spočítané jsou všechny 4 (věta nad náhledem sedí)', grafika.obrazku === 4)
  ok('vzorec: značka místo zmizení', znacky[4] === 'vzorec' && text(grafika.bloky[4]) === 'Plocha: vzorec')
  // Převodníky píšou do vzorce `w:t` (smí to). Za značkou by pak stál
  // text vzorce bez smyslu — zlomek ½ jako „12“.
  const vzorce = precist([
    `<w:p>${wt('Plocha ')}<m:oMath><m:r><w:t>πr²</w:t></m:r></m:oMath>${wt(' m²')}</w:p>`,
    `<w:p><m:oMathPara><m:oMath><m:f><m:num><m:r><w:t>1</w:t></m:r></m:num><m:den><m:r><w:t>2</w:t></m:r></m:den></m:f></m:oMath></m:oMathPara>${wt(' litru')}</w:p>`,
    '<w:p><m:oMath><m:r><w:rPr><w:b/></w:rPr><w:t>a</w:t><w:br/><w:t>b</w:t></m:r></m:oMath></w:p>',
    `<w:p></m:oMath>${wt('zbloudilý konec vzorce nic neschová')}</w:p>`,
  ].join(''))
  ok('vzorec s w:t (převodníky): jen značka, text kolem zůstane',
    JSON.stringify(vzorce.bloky.map(text)) === JSON.stringify(['Plocha vzorec m²', 'vzorec litru', 'vzorec', 'zbloudilý konec vzorce nic neschová']))
  ok('tvar s textovým polem bez obrázku: text ano, značka obrázku ne',
    grafika.bloky.some((x) => text(x) === 'Text v tvaru') && grafika.bloky.slice(5).every((x) => !x.useky.some((u) => u.zastupny)))

  // Iniciála je ve Wordu samostatný odstavec s jedním písmenem.
  const iniciala = precist([
    `<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/></w:pPr>${wt('V')}</w:p>`,
    `<w:p>${wt('ítáme vás')}</w:p>`,
    `<w:p><w:pPr><w:framePr w:dropCap="margin"/></w:pPr>${wt('P')}</w:p>`,
    `<w:tbl><w:tr>${tc('buňka')}</w:tr></w:tbl>`,
    `<w:p><w:pPr><w:framePr w:w="2000" w:h="400" w:wrap="around"/></w:pPr>${wt('Rámeček')}</w:p>`,
    `<w:p>${wt('Za rámečkem')}</w:p>`,
    `<w:p><w:pPr><w:framePr w:dropCap="drop"/></w:pPr>${wt('K')}</w:p>`,
  ].join(''))
  const ini = iniciala.bloky.map((x) => (x.druh === 'tabulka' ? '[tabulka]' : text(x)))
  ok('iniciála patří do odstavce za ní („Vítáme vás“), ne jako samostatný řádek',
    ini[0] === 'Vítáme vás' && iniciala.bloky[0].useky.length === 1)
  ok('iniciála před tabulkou se neztratí a tabulka zůstane za ní', ini[1] === 'P' && ini[2] === '[tabulka]')
  ok('rámeček bez iniciály zůstane samostatný odstavec', ini[3] === 'Rámeček' && ini[4] === 'Za rámečkem')
  ok('iniciála na konci dokumentu se neztratí', ini[5] === 'K' && ini.length === 6)
  // Textové pole leží uvnitř odstavce a jeho odstavce se zavřou dřív —
  // iniciála patří k odstavci ve stejné hloubce, ne k textu v poli.
  const textovePole = (vnitrek) => kresba(`${MS}/word/2010/wordprocessingShape`, `<wps:wsp><wps:txbx><w:txbxContent>${vnitrek}</w:txbxContent></wps:txbx></wps:wsp>`)
  const DROP = '<w:pPr><w:framePr w:dropCap="drop"/></w:pPr>'
  const iniPole = precist(`<w:p>${DROP}${wt('V')}</w:p><w:p>${wt('ítáme vás')}${textovePole(`<w:p>${wt('RÁMEČEK')}</w:p>`)}${wt(' u nás')}</w:p>`)
  ok('iniciála před odstavcem s textovým polem: k odstavci, ne k textu v poli', iniPole.bloky.map(text).join('|') === 'RÁMEČEK|Vítáme vás u nás')
  const iniVPoli = precist(
    `<w:p>${wt('Venku ')}${textovePole(`<w:p>${DROP}${wt('X')}</w:p>`)}${wt('pokračuje')}</w:p>` +
      `<w:p>${textovePole(`<w:p>${DROP}${wt('U')}</w:p><w:p>${wt('vnitř')}</w:p>`)}</w:p>`,
  )
  ok('iniciála v textovém poli: s odstavcem venku se nespojí, s odstavcem v poli ano',
    iniVPoli.bloky.map(text).join('|') === 'X|Venku pokračuje|Uvnitř|')
  const iniJinak = precist([
    `<w:p><w:pPr><w:framePr w:dropCap="none" w:w="2000"/></w:pPr>${wt('A')}</w:p><w:p>${wt('B')}</w:p>`,
    `<w:tbl><w:tr><w:tc><w:p>${DROP}${wt('Q')}</w:p></w:tc>${tc('uark')}</w:tr></w:tbl>`,
    `<w:p>${DROP}<w:r><w:rPr><w:b/></w:rPr><w:t>V</w:t></w:r></w:p><w:p>${wt('ítáme')}</w:p>`,
  ].join(''))
  const [ijA, ijB, ijTab, ijTucne] = iniJinak.bloky
  ok('w:dropCap="none" není iniciála', text(ijA) === 'A' && text(ijB) === 'B')
  ok('iniciála v buňce se nespojí s textem v sousední buňce',
    ijTab?.radky[0].map((c) => c.bloky.map(text).join('|')).join('/') === 'Q/uark')
  ok('tučná iniciála: jeden odstavec, dva úseky (tučné V, obyčejné „ítáme“)',
    text(ijTucne) === 'Vítáme' && ijTucne.useky.length === 2 && ijTucne.useky[0].tucne && !ijTucne.useky[1].tucne && iniJinak.bloky.length === 4)

  const ptab = precist(`<w:p>${wt('Svíčková')}<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="dot"/></w:r>${wt('250 Kč')}</w:p>`)
  ok('tabulátor k okraji (w:ptab) oddělí jídlo a cenu', text(ptab.bloky[0]) === 'Svíčková\t250 Kč')
  const formatBehu = precist([
    '<w:p><w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>bez</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>s</w:t></w:r></w:p>',
    `<w:p>${wt('A')}<w:r><w:noBreakHyphen/></w:r>${wt('B')}<w:r><w:cr/></w:r>${wt('C')}</w:p>`,
    '<w:p><w:t>bez běhu</w:t></w:p>',
  ].join(''))
  ok('podtržení w:val="none" není podtržení', formatBehu.bloky[0]?.useky.map((u) => `${u.text}:${u.podtrzeno}`).join(',') === 'bez:false,s:true')
  ok('nedělitelný spojovník a w:cr', text(formatBehu.bloky[1]) === 'A‑B\nC')
  ok('text mimo běh (w:t přímo v odstavci) se ukáže', text(formatBehu.bloky[2]) === 'bez běhu')

  // Vložená tabulka Excelu (OLE) má náhledový obrázek ve VML; plátno
  // (wordprocessingCanvas) je obal jako tvar — text v něm se ukáže.
  const vlozene = precist([
    '<w:p><w:r><w:object><v:shape><v:imagedata r:id="rId7"/></v:shape><o:OLEObject ProgID="Excel.Sheet.12"/></w:object></w:r></w:p>',
    `<w:p>${kresba(`${MS}/word/2010/wordprocessingCanvas`, `<wpc:wpc><wps:wsp><wps:txbx><w:txbxContent><w:p>${wt('V plátně')}</w:p></w:txbxContent></wps:txbx></wps:wsp></wpc:wpc>`)}</w:p>`,
  ].join(''))
  ok('vložený objekt (OLE) má značku obrázku a počítá se jednou',
    vlozene.obrazku === 1 && vlozene.bloky[0]?.useky.map((u) => u.zastupny && u.text).join() === 'obrázek')
  ok('plátno není obrázek, text v něm se ukáže',
    vlozene.bloky.some((x) => text(x) === 'V plátně') && !vlozene.bloky.slice(1).some((x) => x.useky.some((u) => u.zastupny)))

  // Rozbité soubory: nic se neschová.
  const rozbite = precist([
    `<w:p>${wt('před')}</w:p></w:del><w:p>${wt('po')}</w:p>`,
    `<w:p>${fc('begin')}${it(' =1 ')}${fc('separate')}${wt('12')}${fc('separate')}${wt(' za')}${fc('end')}</w:p>`,
  ].join(''))
  ok('zbloudilé </w:del> nic neschová', rozbite.bloky.slice(0, 2).map(text).join('|') === 'před|po')
  ok('dvojitý oddělovač pole nic neschová', text(rozbite.bloky[2]) === '12 za')
  // Textové pole leží uvnitř běhu okolního odstavce (bez <w:r> a </w:r> z kresby).
  const poleVBehu = (vnitrek) => textovePole(vnitrek).slice(5, -6)
  const zbloudilyBeh = precist(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t>${poleVBehu(`<w:p>${wt('B')}</w:r></w:p>`)}<w:t>C</w:t></w:r></w:p>`)
  const ac = zbloudilyBeh.bloky.find((x) => text(x) === 'AC')
  ok('zbloudilé </w:r> v textovém poli nezavře běh venku: „AC“ tučně v jednom kuse',
    ac?.useky.length === 1 && ac.useky[0].tucne && zbloudilyBeh.bloky.some((x) => text(x) === 'B'))
  const neuzavrenyBeh = precist(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t>${poleVBehu('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>B</w:t></w:p>')}<w:t>C</w:t></w:r></w:p>`)
  const ac2 = neuzavrenyBeh.bloky.find((x) => text(x) === 'AC')
  ok('neuzavřený běh v textovém poli se zavře s polem: „AC“ venku tučně v jednom kuse, ne kurzívou',
    ac2?.useky.length === 1 && ac2.useky[0].tucne && !ac2.useky[0].kurziva)
  const prazdnePole = precist(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t>${poleVBehu('').replace('<w:txbxContent></w:txbxContent>', '<w:txbxContent/>')}<w:t>C</w:t></w:r></w:p>`)
  ok('prázdné textové pole (<w:txbxContent/>) nezmění formát běhu venku',
    prazdnePole.bloky.length === 1 && prazdnePole.bloky[0].useky.length === 1 && prazdnePole.bloky[0].useky[0].tucne && text(prazdnePole.bloky[0]) === 'AC')
  const sdtVPoli = precist(
    `<w:p><w:r><w:t xml:space="preserve">Před </w:t>${poleVBehu(`<w:sdt><w:sdtPr><w:rPr><w:b/><w:vanish/></w:rPr></w:sdtPr><w:sdtContent><w:p>${wt('V poli')}</w:p></w:sdtContent></w:sdt>`)}<w:t>Za polem</w:t></w:r></w:p>`,
  )
  const venku = sdtVPoli.bloky.find((x) => text(x).startsWith('Před'))
  ok('formát z w:sdtPr v textovém poli nepřepíše běh venku (text za polem vidět, ne tučně)',
    text(venku) === 'Před Za polem' && venku.useky.every((u) => !u.tucne) && sdtVPoli.bloky.some((x) => text(x) === 'V poli'))

  // Co náhled nepozná, nesmí vydávat za prázdný dokument.
  ok('vložený HTML (w:altChunk, „export do Wordu“) → věta, ne „žádný text“',
    chybaCteni(zabal({ 'word/document.xml': telo('<w:altChunk r:id="htmlChunk"/><w:sectPr/>') })) === NEZNAMY)
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  ok('jiná předpona než w: (ns0:) → věta, ne „žádný text“',
    chybaCteni(zabal({ 'word/document.xml': `<ns0:document xmlns:ns0="${NS}"><ns0:body><ns0:p><ns0:r><ns0:t>Ahoj</ns0:t></ns0:r></ns0:p></ns0:body></ns0:document>` })) === NEZNAMY)
  ok('výchozí jmenný prostor bez předpony → věta',
    chybaCteni(zabal({ 'word/document.xml': `<document xmlns="${NS}"><body><p><r><t>Ahoj</t></r></p></body></document>` })) === NEZNAMY)
  const utf16 = (xml, be) => {
    const bajty = Buffer.from(`﻿${xml}`, 'utf16le')
    return be ? bajty.swap16() : bajty
  }
  const zUtf16 = (be) => text(nahled(zabal({ 'word/document.xml': utf16(telo(`<w:p>${wt('Příliš žluťoučký')}</w:p>`), be) })).bloky?.[0])
  ok('dokument v UTF-16 (LE i BE) se přečte', zUtf16(false) === 'Příliš žluťoučký' && zUtf16(true) === 'Příliš žluťoučký')
  ok('sešit Excelu (vazba na xl/workbook.xml) → „není text dokumentu Word“',
    chybaCteni(zabal({ '_rels/.rels': relsWord('xl/workbook.xml'), 'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' })) === 'V souboru není text dokumentu Word.')

  // Rozbité a nebezpečné soubory: vždy věta pro člověka, nikdy jiná výjimka.
  ok('není ZIP → „není dokument Word“', chybaCteni(new TextEncoder().encode('{\\rtf1 tohle je RTF}')) === 'Soubor není dokument Word (.docx).')
  ok('ZIP bez dokumentu → „není text dokumentu“', chybaCteni(zabal({ 'xl/workbook.xml': '<workbook/>' })) === 'V souboru není text dokumentu Word.')
  const bomba = zabal({ 'word/document.xml': Buffer.alloc(MAX_XML_BAJTU + 1, 0x20) })
  ok(`ZIP bomba (${Math.round(bomba.length / 1024)} kB → přes ${MAX_XML_BAJTU / 1024 / 1024} MB) → „příliš velký“`,
    chybaCteni(bomba) === 'Dokument je na náhled příliš velký.')
  ok('velká část bez komprese → taky „příliš velký“',
    chybaCteni(zabal({ 'word/document.xml': Buffer.alloc(MAX_XML_BAJTU + 1, 0x20) }, 0)) === 'Dokument je na náhled příliš velký.')
  ok(`styly přes ${MAX_STYLU_BAJTU / 1024 / 1024} MB a vazby přes ${MAX_VAZEB_BAJTU / 1024 / 1024} MB → „příliš velký“`,
    chybaCteni(zabal({ 'word/document.xml': telo(''), 'word/styles.xml': Buffer.alloc(MAX_STYLU_BAJTU + 1, 0x20) })) === 'Dokument je na náhled příliš velký.' &&
      chybaCteni(zabal({ '_rels/.rels': Buffer.alloc(MAX_VAZEB_BAJTU + 1, 0x20), 'word/document.xml': telo('') })) === 'Dokument je na náhled příliš velký.')
  // Velká bomba: bez stropu na rozbalení by paměť narostla o celých 200 MB.
  // Zdroj bomby se drží do konce měření — kdyby ho úklid paměti uvolnil
  // uprostřed, nárůst by vyšel malý i bez stropu.
  const zdrojBomby = Buffer.alloc(200 * 1024 * 1024, 0x20)
  const velkaBomba = zabal({ 'word/document.xml': zdrojBomby })
  const predBombou = process.memoryUsage().arrayBuffers
  const chybaVelke = chybaCteni(velkaBomba)
  const narust = process.memoryUsage().arrayBuffers - predBombou
  ok(`ZIP bomba ${Math.round(velkaBomba.length / 1024)} kB → 200 MB: „příliš velký“ a paměť naroste nejvýš o 64 MB (naměřeno ${Math.round(narust / 1048576)} MB)`,
    chybaVelke === 'Dokument je na náhled příliš velký.' && narust < 64 * 1048576 && zdrojBomby.length > 0)
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
  // Entity se dekódují jen v textu, který se ukáže, a jen do stropu —
  // megabajty entit jinde by zabraly server na vteřiny. Nesmyslná entita
  // to prozradí: dekódovaná shodí čtení („poškozený“).
  const SPATNA = '&#99999999;'
  const entityJinde = precist([
    `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>${'&amp;'.repeat(1000)}${SPATNA}</w:t></w:r>${wt('viditelné')}</w:p>`,
    `<w:r><w:t>${SPATNA}</w:t></w:r>`,
    // Výsledek vnořeného pole je v příkazu vnějšího jako opravdové w:t.
    `<w:p><w:pPr><w:pStyle w:val="${SPATNA}"/></w:pPr>${fc('begin')}${it(' IF ')}${fc('begin')}${it(` MERGEFIELD ${SPATNA} `)}${fc('separate')}${wt(SPATNA)}${fc('end')}` +
      `${it(' = "a" "výsledek" ')}${fc('separate')}${wt('výsledek')}${fc('end')}</w:p>`,
    `<w:p>${sym(SPATNA, 'F0FE')}<w:r><w:fldChar w:fldCharType="${SPATNA}"/></w:r>${wt('dál')}</w:p>`,
  ].join(''))
  ok('entity ve skrytém textu, mimo odstavec, v příkazu pole a v atributech se nedekódují',
    !entityJinde.chyba && !entityJinde.zkraceno && entityJinde.bloky.map(text).join('|') === 'viditelné|výsledek|symboldál')
  const mnohoEntit = precist(`<w:p><w:r><w:t>${'&amp;'.repeat(MAX_ZNAKU * 3)}${SPATNA}</w:t></w:r></w:p>`)
  ok(`viditelné entity: dekóduje se, co se vejde (přesně ${MAX_ZNAKU} znaků), nesmyslná za stropem nic neshodí`,
    !mnohoEntit.chyba && mnohoEntit.zkraceno && text(mnohoEntit.bloky[0]) === '&'.repeat(MAX_ZNAKU))
  // Nejdelší entita bez nul navíc má DELKA_ENTITY znaků — i z nich se
  // musí vejít celý strop. S nulami navíc (11 znaků) dojde dřív strop na
  // znaky ze souboru: náhled se zkrátí, ale useknutá entita (`&#x`) se
  // neukáže.
  const DESET = '&#x0000E9;'
  const desetZnaku = precist(`<w:p><w:r><w:t>${DESET.repeat(MAX_ZNAKU + 1)}</w:t></w:r></w:p>`)
  const jedenactZnaku = precist(`<w:p><w:r><w:t>${'&#x00000E9;'.repeat(MAX_ZNAKU)}</w:t></w:r></w:p>`)
  ok(`entity po ${DELKA_ENTITY} znacích: celý strop (${MAX_ZNAKU} znaků); s nulami navíc zkrácený bez useknuté entity`,
    DESET.length === DELKA_ENTITY && !desetZnaku.chyba && desetZnaku.zkraceno && text(desetZnaku.bloky[0]) === 'é'.repeat(MAX_ZNAKU)
      && !jedenactZnaku.chyba && jedenactZnaku.zkraceno && text(jedenactZnaku.bloky[0]) === 'é'.repeat(Math.floor((MAX_ZNAKU * DELKA_ENTITY) / 11)))
  // Dekóduje se po kusech; kus nesmí useknout entitu (6 znaků na hranici
  // kusu nesedí), dlouhou entitu ani osamělé `&` v rozbitém souboru.
  const odk = (s, n) => {
    try {
      return odkodovatDo(s, n)
    } catch (e) {
      return { text: `výjimka: ${e.message}`, zbylo: null }
    }
  }
  const pres = odk('&quot;'.repeat(100_000), 1_000_000)
  const osamele = odk(`x&${'y'.repeat(200_000)}&amp;`, 1_000_000)
  const dlouha = odk(`&#${'0'.repeat(70_000)}65;b`, 1_000_000)
  ok('odkodovatDo: entity přes hranici kusu celé, osamělé & zůstane, entita delší než kus se dekóduje',
    pres.text === '"'.repeat(100_000) && pres.zbylo === false
      && osamele.text === `x&${'y'.repeat(200_000)}&` && osamele.zbylo === false && dlouha.text === 'Ab' && dlouha.zbylo === false)
  ok('odkodovatDo: nejvýš daný počet znaků a „zbylo“ přesně, když něco zbylo',
    JSON.stringify(odk('&amp;'.repeat(10), 10)) === JSON.stringify({ text: '&'.repeat(10), zbylo: false })
      && JSON.stringify(odk('&amp;'.repeat(11), 10)) === JSON.stringify({ text: '&'.repeat(10), zbylo: true })
      && JSON.stringify(odk(`&#${'0'.repeat(70_000)}65;`, 10)) === JSON.stringify({ text: '', zbylo: true }))
  // Dekódování skončí mezi půlkami emoji, i když textu je pod strop:
  // strop na znaky ze souboru (100 × DELKA_ENTITY) padne za první půlku
  // (83 entit po 12 znacích dá jen 83 znaků), nebo hranice kusu (65 536)
  // padne na ni přesně tehdy, když text právě dosáhl stropu.
  const DVANACT = '&#x000000E9;'
  const naStropuZeSouboru = odk(`${DVANACT.repeat(83)}aaa😀z`, 100)
  ok('odkodovatDo: strop na znaky ze souboru nerozpůlí emoji (text kratší než strop, bez půlky na konci)',
    DVANACT.length === 12 && JSON.stringify(naStropuZeSouboru) === JSON.stringify({ text: `${'é'.repeat(83)}aaa`, zbylo: true }))
  const naHraniciKusu = odk(`${'a'.repeat(65_535)}😀b`, 65_536)
  ok('odkodovatDo: hranice kusu nerozpůlí emoji, ani když text skončí přesně na stropu',
    naHraniciKusu.text === 'a'.repeat(65_535) && naHraniciKusu.zbylo === true)
  // Entita delší než kus, jejíž konec je až za stropem: nic z ní — ne
  // statisíce znaků „&#x000…“ jako text (kus tu nekončí na stropu).
  const zaStropem = `&#x${'0'.repeat(MAX_ZNAKU * DELKA_ENTITY + 100_000)}41;`
  const zaStropemVDokumentu = precist(`<w:p><w:r><w:t>Ahoj ${zaStropem}</w:t></w:r></w:p>`)
  ok('entita delší než kus s koncem za stropem: neukáže se ani kousek, zkrácený (funkce i náhled)',
    JSON.stringify(odk(zaStropem, MAX_ZNAKU)) === JSON.stringify({ text: '', zbylo: true })
      && JSON.stringify(odk(`Ahoj ${zaStropem}`, MAX_ZNAKU)) === JSON.stringify({ text: 'Ahoj ', zbylo: true })
      && !zaStropemVDokumentu.chyba && zaStropemVDokumentu.zkraceno && text(zaStropemVDokumentu.bloky[0]) === 'Ahoj ')
  // Posunutí části z ústředního adresáře musí ukazovat na místní hlavičku.
  const dveCasti = () => zabal({ '[Content_Types].xml': '<Types/>', 'word/document.xml': telo(`<w:p>${wt('x')}</w:p>`) }, 0)
  const bezPodpisu = dveCasti()
  bezPodpisu[Buffer.from(bezPodpisu).indexOf(Buffer.from([0x50, 0x4b, 3, 4]), 1)] = 0
  ok('místní hlavička bez podpisu → „poškozený“', chybaCteni(bezPodpisu) === 'Dokument je poškozený.')
  const mimoSoubor = dveCasti()
  new DataView(mimoSoubor.buffer).setUint32(Buffer.from(mimoSoubor).lastIndexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 42, 0x7fffffff, true)
  ok('posunutí části mimo soubor → „poškozený“', chybaCteni(mimoSoubor) === 'Dokument je poškozený.')

  // Stropy na velikost náhledu a čas serveru.
  const dlouhy = precist(`<w:p><w:r><w:t>${'a'.repeat(MAX_ZNAKU - 5)}</w:t></w:r></w:p><w:p><w:r><w:t>bbbbbbbbbb</w:t></w:r></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p>`)
  ok(`dlouhý text: zkrácený přesně na ${MAX_ZNAKU} znaků, další odstavce nepřibudou`,
    dlouhy.zkraceno && dlouhy.bloky.map(text).join('').length === MAX_ZNAKU && dlouhy.bloky.length === 2)
  // Strop nesmí rozpůlit emoji (v UTF-16 dvojice): půlka je na stránce „�“.
  const emojiPrimo = precist(`<w:p>${wt('a'.repeat(MAX_ZNAKU - 1) + '😀 dál')}</w:p>`)
  const emojiEntitou = precist(`<w:p>${wt('a'.repeat(MAX_ZNAKU - 1) + '&#x1F600; dál')}</w:p>`)
  const emojiSymbolem = precist(`<w:p>${wt('a'.repeat(MAX_ZNAKU - 1))}${sym('Wingdings', 'F04B')}</w:p>`)
  const bezPulky = (n) => !n.chyba && n.zkraceno && n.bloky.map(text).join('') === 'a'.repeat(MAX_ZNAKU - 1)
  ok('strop na znaky nerozpůlí emoji: přímo i entitou (dekódování) bez půlky znaku na konci', bezPulky(emojiPrimo) && bezPulky(emojiEntitou))
  ok('strop na znaky nerozpůlí emoji: symbol z Wingdings (už dekódovaný text) bez půlky znaku na konci', bezPulky(emojiSymbolem))
  const presneNaStrop = precist(`<w:p>${wt('a'.repeat(MAX_ZNAKU))}</w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>`)
  ok('text přesně na strop: další odstavec nepřibude ani prázdný', presneNaStrop.zkraceno && presneNaStrop.bloky.length === 1)
  const mnoho = precist('<w:p/>'.repeat(MAX_BLOKU + 5))
  ok(`moc odstavců: nejvýš ${MAX_BLOKU}, zkrácený`, mnoho.zkraceno && mnoho.bloky.length === MAX_BLOKU)
  // 40 kB soubor s milionem prázdných buněk kreslil server desítky vteřin.
  // Řádky po 50 buňkách — širší by se uřízl na 63 buněk (oříznutá tabulka)
  // a test by nic neřekl o stropu na bloky.
  const zaplavaBunek = precist(`<w:tbl>${`<w:tr>${'<w:tc></w:tc>'.repeat(50)}</w:tr>`.repeat(250)}</w:tbl>`)
  const zb = zaplavaBunek.bloky[0]
  const bunekCelkem = zb ? 1 + zb.radky.length + zb.radky.reduce((n, r) => n + r.length, 0) : 0
  ok(`záplava prázdných buněk: zkrácená, tabulka + řádky + buňky nejvýš ${MAX_BLOKU} (je ${bunekCelkem})`,
    zaplavaBunek.zkraceno && bunekCelkem <= MAX_BLOKU && bunekCelkem > MAX_BLOKU - 300)
  const zaplavaRadku = precist(`<w:tbl>${'<w:tr></w:tr>'.repeat(MAX_BLOKU + 5)}</w:tbl>`)
  ok(`záplava prázdných řádků: zkrácená, nejvýš ${MAX_BLOKU}`,
    zaplavaRadku.zkraceno && 1 + zaplavaRadku.bloky[0].radky.length <= MAX_BLOKU)
  const zaplavaZnacek = precist(`${'<a/>'.repeat(MAX_ZNACEK)}<w:p>${wt('za stropem')}</w:p>`)
  ok(`záplava značek bez textu: po ${MAX_ZNACEK} značkách konec (zkrácený), ne vteřiny práce`,
    zaplavaZnacek.zkraceno && !JSON.stringify(zaplavaZnacek).includes('za stropem'))
  // Úseky textu (kus se stejným formátem): značky „symbol“ se nespojují,
  // každá je úsek. Strop platí pro celý dokument, ne pro odstavec.
  const znakSymbolu = sym('Wingdings', 'F021').slice(5, -6)
  const mnohoUseku = precist(`<w:p><w:r>${znakSymbolu.repeat(Math.ceil(MAX_USEKU * 0.75))}</w:r></w:p>`.repeat(2))
  const usekuCelkem = mnohoUseku.bloky.reduce((n, x) => n + (x.useky?.length ?? 0), 0)
  ok(`moc úseků textu: nejvýš ${MAX_USEKU} v celém dokumentu, zkrácený (je ${usekuCelkem})`, mnohoUseku.zkraceno && usekuCelkem === MAX_USEKU)
  // Stropy samy: kdyby je někdo zvedl, kontroly výš projdou dál, jen
  // server bude nad cizím souborem pracovat déle.
  ok('stropy nejsou vyšší než dnes (značky 300 000, bloky 10 000, úseky 20 000, znaky 300 000, buňky v řádku 63, mřížka 255, patra 8)',
    MAX_ZNACEK <= 300_000 && MAX_BLOKU <= 10_000 && MAX_USEKU <= 20_000 && MAX_ZNAKU <= 300_000 && MAX_BUNEK <= 63 && MAX_MRIZKY <= 255
      && MAX_VNORENI_TABULEK <= 8)
  // Strop značek dřív, než začne tělo (obří pozadí dokumentu).
  const ZACATEK = 'V začátku dokumentu, který se do náhledu vešel, žádný text není. Celý dokument je v originálu.'
  const pozadi = nahled(zabal({ 'word/document.xml': `<w:document ${W}><w:background>${'<a/>'.repeat(MAX_ZNACEK)}</w:background><w:body><w:p>${wt('text')}</w:p></w:body></w:document>` }))
  ok('strop značek před tělem: zkrácený s větou o začátku, ne „náhled nezná“', !pozadi.chyba && pozadi.zkraceno && prazdnyNahled(pozadi) === ZACATEK)
  // Komentář a instrukce s apostrofem a CDATA jsou platné XML (píšou je
  // generátory, ne Word). Apostrof nesmí spolknout zbytek dokumentu a text
  // z CDATA se ukáže doslova (`&amp;` v něm je pět znaků).
  const sKomentarem = precist(`<!-- generated by the guest's app --><w:p>${wt('Raut pro 40 osob')}</w:p><?pi it's?><w:p>${wt('Cena 250 Kč')}</w:p>`)
  ok('komentář a instrukce s apostrofem v těle nespolknou dokument',
    !sKomentarem.chyba && sKomentarem.bloky.map(text).join('|') === 'Raut pro 40 osob|Cena 250 Kč')
  const sCdata = precist(`<w:p><w:r><w:t><![CDATA[Objednávka <rautu> & &amp; 'víno']]></w:t></w:r></w:p><w:p>${wt('Konec')}</w:p>`)
  ok('text v CDATA se ukáže doslova a dokument pokračuje',
    !sCdata.chyba && sCdata.bloky.map(text).join('|') === "Objednávka <rautu> & &amp; 'víno'|Konec")
  // Neuzavřený komentář: konec se hledá jednou, ne u každého znovu
  // (50 000 × celý zbytek souboru by byly vteřiny práce serveru).
  const predKomentari = performance.now()
  const neuzavreneKomentare = precist(`<w:p>${wt('před')}</w:p>${'<!--x>'.repeat(50_000)}`)
  const msKomentaru = Math.round(performance.now() - predKomentari)
  ok(`neuzavřené komentáře (50 000): přečte se do 1 s (trvalo ${msKomentaru} ms)`,
    !neuzavreneKomentare.chyba && text(neuzavreneKomentare.bloky[0]) === 'před' && msKomentaru < 1000)
  // Věta místo prázdné plochy.
  const PRAZDNY = 'V dokumentu není žádný text.'
  ok('prázdný dokument, prázdné odstavce, tabulka bez řádků → „není žádný text“',
    prazdnyNahled(precist('')) === PRAZDNY && prazdnyNahled(precist('<w:p/><w:p></w:p>')) === PRAZDNY && prazdnyNahled(precist('<w:tbl></w:tbl>')) === PRAZDNY)
  ok('zkrácený bez textu → věta o začátku; s textem nebo tabulkou s řádkem žádná věta',
    prazdnyNahled(zaplavaZnacek) === ZACATEK && prazdnyNahled(precist(`<w:p>${wt('a')}</w:p>`)) === null &&
      prazdnyNahled(precist(`<w:tbl><w:tr>${tc('')}</w:tr></w:tbl>`)) === null)
  const pozdniStyl = nahled(zabal({
    'word/document.xml': telo(`<w:p><w:pPr><w:pStyle w:val="Pozde"/></w:pPr>${wt('Pozdní styl')}</w:p>`),
    'word/styles.xml': `<w:styles ${W}>${'<a/>'.repeat(MAX_ZNACEK_STYLU)}<w:style w:type="paragraph" w:styleId="Pozde"><w:name w:val="heading 1"/></w:style></w:styles>`,
  }))
  ok(`styly: za ${MAX_ZNACEK_STYLU} značkami se nečtou`, pozdniStyl.bloky[0]?.nadpis === 0)
  const pozdniVazba = nahled(zabal({
    '_rels/.rels': `<Relationships xmlns="${VAZBY}/package/2006/relationships">${'<a/>'.repeat(MAX_ZNACEK_VAZEB)}<Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/officeDocument" Target="word/jinde.xml"/></Relationships>`,
    'word/jinde.xml': telo(`<w:p>${wt('jinde')}</w:p>`),
    'word/document.xml': telo(`<w:p>${wt('výchozí')}</w:p>`),
  }))
  ok(`vazby: za ${MAX_ZNACEK_VAZEB} značkami se nečtou, vezme se word/document.xml`, text(pozdniVazba.bloky[0]) === 'výchozí')
  // Tabulky v sobě: stránka se kreslí rekurzí, stovky pater ji shodily.
  const hloubka = (bloky) =>
    bloky.reduce((h, x) => (x.druh === 'tabulka' ? Math.max(h, 1 + x.radky.flat().reduce((v, c) => Math.max(v, hloubka(c.bloky)), 0)) : h), 0)
  // Patro i: odsazení o 1 a buňka široká i (1, 2, 3 …).
  const patro = (i) => `<w:tbl><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="${i}"/></w:tcPr>`
  // Bez stropu tisíc pater neunese ani rekurze tady v testu (odstavceVsude
  // přeteče zásobník) — to je CHYBA téhle kontroly, ne pád celého běhu.
  let hloubkaSedi = false
  let patraSedi = false
  try {
    const hluboka = precist(`${Array.from({ length: 1000 }, (_, i) => patro(i + 1)).join('')}<w:p>${wt('na dně')}</w:p>`)
    let nejhlubsi = hluboka.bloky[0]
    while (nejhlubsi?.radky[0]?.[1]?.bloky[0]?.druh === 'tabulka') nejhlubsi = nejhlubsi.radky[0][1].bloky[0]
    hloubkaSedi = hloubka(hluboka.bloky) === MAX_VNORENI_TABULEK && odstavceVsude(hluboka.bloky).some((x) => text(x) === 'na dně')
    patraSedi = nejhlubsi?.radky.length === 1 && nejhlubsi.radky[0].length === 2 && nejhlubsi.radky[0][0].odsazeni && nejhlubsi.radky[0][1].sirka === MAX_VNORENI_TABULEK
  } catch (e) {
    console.log('    výjimka:', e.message)
  }
  ok(`1000 tabulek v sobě: nejvýš ${MAX_VNORENI_TABULEK} pater, text se neztratí`, hloubkaSedi)
  ok('přeskočená patra nepřidají řádky, buňky, odsazení ani šířku do tabulky o patro výš', patraSedi)
  const uzavrena = precist(`${'<w:tbl><w:tr><w:tc>'.repeat(20)}<w:p>${wt('hluboko')}</w:p>${'</w:tc></w:tr></w:tbl>'.repeat(20)}<w:p>${wt('za tabulkou')}</w:p>`)
  ok('přeskočené hluboké tabulky nezavřou cizí buňku: text za tabulkou je v těle dokumentu',
    uzavrena.bloky.length === 2 && text(uzavrena.bloky[1]) === 'za tabulkou' && odstavceVsude(uzavrena.bloky).some((x) => text(x) === 'hluboko'))

  // Devět pater: deváté se přeskočí. Po jeho zavření dostane osmé patro
  // druhý řádek — musí přibýt v osmém, ne o patro výš.
  const pater = MAX_VNORENI_TABULEK + 1
  const poPreskocene = precist(
    `${'<w:tbl><w:tr><w:tc>'.repeat(pater)}<w:p>${wt('dno')}</w:p></w:tc></w:tr></w:tbl>` +
      `</w:tc></w:tr><w:tr>${tc('druhý řádek')}</w:tr></w:tbl>${'</w:tc></w:tr></w:tbl>'.repeat(pater - 2)}<w:p>${wt('konec')}</w:p>`,
  )
  let osme = poPreskocene.bloky[0]
  for (let i = 1; i < MAX_VNORENI_TABULEK; i++) osme = osme?.radky[0]?.[0]?.bloky.find((x) => x.druh === 'tabulka')
  ok('zavření přeskočené tabulky nezavře tu o patro výš: další řádek patří do ní',
    osme?.radky.length === 2 && osme.radky[1][0]?.bloky.map(text).join('') === 'druhý řádek' && osme.radky[0][0].bloky.map(text).join('') === 'dno'
      && text(poPreskocene.bloky[poPreskocene.bloky.length - 1]) === 'konec')
  // Buňka, kterou tabulka nechala otevřenou, se zavře s ní — jinak by
  // další tabulka vlezla do ní a strop pater by neplatil.
  const neuzavreneBunky = precist(`${'<w:tbl><w:tr><w:tc></w:tbl>'.repeat(300)}<w:p>${wt('dno')}</w:p>`)
  const neuzavreneRadky = precist(`${'<w:tbl><w:tr><w:tc><w:p/></w:tr></w:tbl>'.repeat(300)}<w:p>${wt('dno')}</w:p>`)
  // Zbloudilé </w:tc> za takovou tabulkou nesmí zavřít tělo dokumentu.
  const zbloudileZa = precist(`${'<w:tbl><w:tr><w:tc></w:tbl></w:tc>'.repeat(300)}<w:p>${wt('dno')}</w:p>`)
  ok(`300 tabulek s neuzavřenou buňkou: nejvýš ${MAX_VNORENI_TABULEK} pater, text za nimi v těle dokumentu`,
    [neuzavreneBunky, neuzavreneRadky, zbloudileZa].every((n) => !n.chyba && hloubka(n.bloky) <= MAX_VNORENI_TABULEK && n.bloky.some((x) => text(x) === 'dno')))
  // Opačně: buněk je při zavření tabulky MÍŇ, než když začala (vnitřní
  // tabulka bez </w:tbl>, zbloudilé </w:tc> ve vnořené). Zásobník se
  // nesmí prodloužit — díra v něm shodila čtení („poškozený“).
  const vnitrniBezKonce = precist(`<w:tbl><w:tr><w:tc><w:tbl><w:tr>${tc('vnitřní')}</w:tr><w:p/></w:tc></w:tr></w:tbl><w:p>${wt('Text za tabulkou')}</w:p>`)
  const zbloudileVeVnorene = precist(`<w:tbl><w:tr><w:tc><w:tbl><w:tr>${tc('vnitřní')}</w:tc></w:tr></w:tbl><w:p>${wt('vedle')}</w:p></w:tc></w:tr></w:tbl><w:p>${wt('Za')}</w:p>`)
  ok('vnitřní tabulka bez </w:tbl> a zbloudilé </w:tc> ve vnořené: dokument se přečte, text za tabulkou zůstane',
    !vnitrniBezKonce.chyba && odstavceVsude(vnitrniBezKonce.bloky).some((x) => text(x) === 'vnitřní') && text(vnitrniBezKonce.bloky.at(-1)) === 'Text za tabulkou'
      && !zbloudileVeVnorene.chyba && zbloudileVeVnorene.bloky.slice(-2).map(text).join('|') === 'vedle|Za')

  // Věta nad náhledem: sloveso před číslem, „po něm“ u jednoho.
  const vetaNad = (obrazku, zkraceno = false, oriznutaTabulka = false) => poznamkaNahledu({ bloky: [], obrazku, zkraceno, oriznutaTabulka })
  ok('věta: 1 obrázek', vetaNad(1) === 'V dokumentu je 1 obrázek — v náhledu je po něm jen značka.')
  ok('věta: 2 obrázky', vetaNad(2) === 'V dokumentu jsou 2 obrázky — v náhledu jsou po nich jen značky.')
  ok('věta: 5 obrázků', vetaNad(5) === 'V dokumentu je 5 obrázků — v náhledu jsou po nich jen značky.')
  ok('věta: zkrácený; bez ničeho žádná věta', vetaNad(0, true) === 'Dokument je dlouhý, náhled ukazuje jen začátek.' && vetaNad(0) === null)
  ok('věta: oříznutá tabulka je jiná věta než zkrácený dokument (a obojí najednou)',
    vetaNad(0, false, true) === 'Tabulka je moc široká — část vpravo v náhledu chybí.'
      && vetaNad(0, true, true) === 'Tabulka je moc široká — část vpravo v náhledu chybí. Dokument je dlouhý, náhled ukazuje jen začátek.')

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
  // Klíč služby obchází politiky kbelíku. V tomhle repozitáři je to
  // klientUlohy() z lib/supabase/uloha — hledá se i ten, ne jen „service_role“.
  const bezKomentaru = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const klicSluzby = /klientUlohy|supabase\/uloha|SERVICE_ROLE|service_role|createClient\(/
  const data = cti('app/[rozsah]/rezervace/data.ts')
  const odStahnout = data.indexOf('export async function stahnoutPrilohu')
  const zaStahnout = data.indexOf('\nexport ', odStahnout + 1)
  const stahnout = data.slice(odStahnout, zaStahnout === -1 ? data.length : zaStahnout)
  ok('soubor se čte uživatelským klientem (politika kbelíku je druhá linie), ne klíčem služby',
    /const supabase = await getServerSupabase\(\)\s+const \{ data, error \} = await supabase\.storage\.from\(KBELIK_REZERVACI\)\.download\(cesta\)/.test(stahnout) &&
      !klicSluzby.test(bezKomentaru(data)) && !klicSluzby.test(bezKomentaru(stranka)))
  // Jen tělo nacistPrilohu — stejná podmínka je i v nacistRezervaci.
  const nacist = data.slice(data.indexOf('export async function nacistPrilohu'), data.indexOf('export async function stahnoutPrilohu'))
  ok('příloha jen z poboček rozsahu (nacistPrilohu)', nacist.includes('!pobocky.some((p) => p.id === data.branch_id)) return null'))
  ok('stránka: pobočka přílohy musí být v rozsahu i podle stránky',
    stranka.includes('pristup.pobocky.find((p) => p.id === priloha.branch_id)') && stranka.includes('if (!priloha || !pobocka) {'))
  const kresleni = cti('app/[rozsah]/rezervace/dokument/obsah.tsx')
  ok('náhled nevkládá HTML ze souboru', !kresleni.includes('dangerouslySetInnerHTML'))
  ok('originál jde stáhnout tlačítkem', /href=\{`\/api\/rezervace\/soubor\/\$\{priloha\.id\}`\}[^>]*>\s*Stáhnout originál/.test(kresleni))
  ok('věta nad náhledem z poznamkaNahledu', kresleni.includes('poznamkaNahledu(nahled)'))
  // Záhlaví, zápatí, poznámky pod čarou a komentáře leží v jiných částech
  // balíčku a čtečka je nečte vůbec — po poznámce ani komentáři nezůstane
  // v textu značka. Bez věty by náhled vypadal jako celý dokument.
  const coChybi = kresleni.match(/Náhled ukazuje text a tabulky\.([^—]*)má jen\s+originál/)?.[1].replace(/\s+/g, ' ').trim() ?? ''
  ok(`věta nad náhledem jmenuje, co v něm není: obrázky, záhlaví a zápatí, poznámky pod čarou, komentáře (je „${coChybi}“)`,
    ['Obrázky', 'záhlaví', 'zápatí', 'poznámky pod čarou', 'komentáře'].every((s) => coChybi.includes(s)))
  ok('tabulka: sloučené buňky přes colSpan/rowSpan, pokračování se nekreslí',
    kresleni.includes('bunka.sloucena ? null') && kresleni.includes('colSpan={bunka.sirka > 1 ? bunka.sirka : undefined}') &&
      kresleni.includes('rowSpan={bunka.vyska > 1 ? bunka.vyska : undefined}'))
  ok('prázdný nadpis je mezera, ne prázdné <h2>', /b\.useky\.length \? \(\s*<H key=\{i\}>/.test(kresleni))
  ok('název souboru se v nadpisu smí zalomit kdekoli (telefon nejede do šířky)',
    kresleni.includes('<span className="ds-dokument-nazev">{priloha.nazev}</span>') && cti('app/_rezervace.css').includes('.ds-dokument-nazev { overflow-wrap: anywhere; }'))
  const zachrana = cti('app/[rozsah]/rezervace/dokument/[id]/error.tsx')
  ok('spadlý náhled: záchranná obrazovka s tlačítkem na originál',
    zachrana.startsWith("'use client'") && /href=\{`\/api\/rezervace\/soubor\/\$\{encodeURIComponent\(id \?\? ''\)\}`\}[^>]*>\s*Stáhnout originál/.test(zachrana))
  // Samotné reset() by ukázalo tutéž uloženou chybu znovu.
  ok('„Zkusit znovu“ si stránku vyžádá ze serveru (router.refresh a reset v jednom přechodu)',
    /startTransition\(\(\) => \{\s*router\.refresh\(\)\s*reset\(\)\s*\}\)/.test(zachrana) && zachrana.includes('onClick={znovu}'))
  ok('prázdný náhled je věta z prazdnyNahled, ne prázdná plocha',
    kresleni.includes('prazdnyNahled(nahled)') && kresleni.includes('{prazdny ? <p className="ds-dokument-nic">{prazdny}</p> : <ObsahDokumentu'))

  // Každá část se rozbaluje se svým stropem: seznam vazeb, dokument,
  // seznam vazeb dokumentu, styly (v tomhle pořadí).
  const predCastmi = rozbaleni.length
  nahled(zabal({
    '_rels/.rels': relsWord('word/document.xml'),
    'word/document.xml': telo(`<w:p>${wt('x')}</w:p>`),
    'word/_rels/document.xml.rels': `<Relationships xmlns="${VAZBY}/package/2006/relationships"><Relationship Id="rId1" Type="${VAZBY}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/styles.xml': styly,
  }))
  ok('strop podle části: vazby 1 MB, dokument 20 MB, vazby dokumentu 1 MB, styly 4 MB',
    rozbaleni.slice(predCastmi).join() === [MAX_VAZEB_BAJTU, MAX_XML_BAJTU, MAX_VAZEB_BAJTU, MAX_STYLU_BAJTU].join())
  ok('žádný náhled v tomhle oddílu neměl nadpis jiný než 0–3',
    spatneNadpisy.length === 0 ? true : (console.log('   ', spatneNadpisy.slice(0, 5)), false))

  // Až na konci: všechna rozbalení v tomhle oddílu měla strop.
  ok(`každé rozbalení mělo strop nejvýš ${MAX_XML_BAJTU / 1024 / 1024} MB (${rozbaleni.length} rozbalení)`,
    rozbaleni.length > 20 && rozbaleni.every((m) => typeof m === 'number' && m > 0 && m <= MAX_XML_BAJTU))
  zlib.inflateRawSync = puvodniInflate
  syncBuiltinESMExports()
}

console.log('\n== 12. Dokumenty u rezervací v kalendáři (3. 11. 2026) ==\n')
{
  // Zadání Šéfíka: „aby v kalendáři akcí bylo vidět, že je u jednotlivé
  // rezervace dokument, a možnost ho otevřít“. Co se z toho opravdu
  // vykreslí (týden, měsíc, den), ověřuje scripts/rezervace-pobocky.test.mjs,
  // oddíl 6 — tady čisté funkce a to, co se vykreslením ověřit nedá.
  const PDF = 'application/pdf'
  // Výjimka v testované funkci by shodila celý běh i se zbylými
  // kontrolami — tady je to jen CHYBA u té, které se týká.
  const zkus = (f) => {
    try {
      return f()
    } catch {
      return undefined
    }
  }
  const dok = zkus(() =>
    dokumentyRezervace([
      { id: 'b', nazev: 'Menu.docx', mime: MIME_DOCX, nahrano: '2026-11-03T10:00:00.5+00:00' },
      { id: 'c', nazev: 'Plán sálu.pdf', mime: PDF, nahrano: '2026-11-03T09:00:00+00:00' },
      { id: 'a', nazev: 'Dort.jpg', mime: 'image/jpeg', nahrano: '2026-11-03T10:00:00.5+00:00' },
      // 09:30 v +01:00 = 08:30 UTC — první, i když jako text vypadá později.
      { id: 'd', nazev: 'Objednávka.pdf', mime: PDF, nahrano: '2026-11-03T09:30:00+01:00' },
    ]),
  )
  ok('dokumenty v pořadí nahrání jako v detailu (okamžik, ne text), stejný okamžik podle id',
    Array.isArray(dok) && dok.map((x) => x.id).join('') === 'dcab')
  ok('do kalendáře jen id, název a typ', Array.isArray(dok) && JSON.stringify(dok[0]) === JSON.stringify({ id: 'd', nazev: 'Objednávka.pdf', mime: PDF }))
  ok('bez dokumentů prázdný seznam',
    zkus(() => [null, undefined, []].every((x) => Array.isArray(dokumentyRezervace(x)) && dokumentyRezervace(x).length === 0)) === true)

  const tyden = '/perla/rezervace?pohled=tyden&datum=2026-11-03'
  const mesic = '/perla/rezervace?pohled=mesic&datum=2026-11-03'
  const den = '/perla/rezervace/den/2026-11-03'
  ok('Word z kalendáře: náhled s adresou zpátky, zakódovanou (& v ní nerozdělí adresu náhledu)',
    adresaPrilohy('perla', 'abc', MIME_DOCX, tyden) === '/perla/rezervace/dokument/abc?zpet=%2Fperla%2Frezervace%3Fpohled%3Dtyden%26datum%3D2026-11-03')
  ok('adresa zpátky dorazí do náhledu celá a bezpecnaZpatky ji pustí (týden, měsíc, den)',
    [tyden, mesic, den].every((z) => {
      const zDotazu = new URL(adresaPrilohy('perla', 'abc', MIME_DOCX, z), 'https://foodtab.test').searchParams.get('zpet')
      return zDotazu === z && bezpecnaZpatky('perla', zDotazu) === z
    }))
  ok('PDF a fotka z kalendáře rovnou ze souboru (nová záložka, zpátky nepotřebují)',
    adresaPrilohy('perla', 'abc', PDF, tyden) === '/api/rezervace/soubor/abc' && adresaPrilohy('perla', 'abc', 'image/png', tyden) === '/api/rezervace/soubor/abc')
  ok('bez adresy zpátky (detail, příloha ke dni) beze změny',
    adresaPrilohy('perla', 'abc', MIME_DOCX) === '/perla/rezervace/dokument/abc' && adresaPrilohy('perla', 'abc', MIME_DOCX, '') === '/perla/rezervace/dokument/abc')

  // Adresa zpátky přijde z odkazu, který může poslat kdokoli. Rozhoduje,
  // kam ji pak POŠLE PROHLÍŽEČ — proto se kontroluje vyřešená adresa,
  // ne text (3. 11.: `..` i jako %2e%2e vede o složku výš, tabulátor
  // prohlížeč vypustí; `/perla/rezervace/../../k/…` by skončila na
  // veřejném přesměrování ven).
  const kamVede = (z) => new URL(bezpecnaZpatky('perla', z), 'https://foodtab.test')
  const zle = [
    'https://zly.example', '//zly.example', '/jina/rezervace?pohled=tyden', '/perla/rezervace//zly.example', '/perla/rezervacex',
    '/perla/rezervace/../../k/abc', '/perla/rezervace/..', '/perla/rezervace/%2e%2e/%2e%2e/k/abc', '/perla/rezervace/%2E%2E/x',
    '/perla/rezervace/.%2e/x', '/perla/rezervace/.\t./.\t./k/abc', '/perla/rezervace/\n/../../x', '/perla/rezervace/./../x',
    '/perla/rezervace\\..\\k', '/perla/rezervace/den/2026-11-03#../../x', '/perla/rezervace/den/2026-11-03/..',
  ]
  const spatne = zle.filter((z) => {
    const u = kamVede(z)
    return u.origin !== 'https://foodtab.test' || u.pathname !== '/perla/rezervace' || u.search !== ''
  })
  ok(`bezpecnaZpatky: cizí adresa, jiný rozsah i \`..\` (i zakódované, s tabulátorem) skončí v kalendáři rozsahu — prohlížeč nikam jinam nevede (${spatne.length ? spatne.map((z) => JSON.stringify(z)).join(', ') : 'vše OK'})`,
    spatne.length === 0)
  const dobre = [
    '/perla/rezervace', den, tyden, mesic, '/perla/rezervace/11111111-2222-4333-8444-555555555555',
    '/perla/rezervace/nova?datum=2026-11-03', '/perla/rezervace/upozorneni',
  ]
  ok('bezpecnaZpatky: adresy, které posílá kalendář a formuláře, projdou beze změny',
    dobre.every((z) => bezpecnaZpatky('perla', z) === z && kamVede(z).pathname + kamVede(z).search === z))

  const zp = (z) => zkus(() => zpatkyZKalendare('perla', z))
  ok('„Zpět“ z náhledu: z dne na den, z týdne a měsíce na kalendář (tam, odkud se otevíral)',
    JSON.stringify(zp(den)) === JSON.stringify({ href: den, text: 'Zpět na den' })
    && JSON.stringify(zp(tyden)) === JSON.stringify({ href: tyden, text: 'Zpět na kalendář' })
    && JSON.stringify(zp(mesic)) === JSON.stringify({ href: mesic, text: 'Zpět na kalendář' }))
  ok('„Zpět“ z náhledu: podvržená adresa vede do kalendáře rozsahu, ne na „den“ ani ven',
    JSON.stringify(zp('/perla/rezervace/den/../../k/abc')) === JSON.stringify({ href: '/perla/rezervace', text: 'Zpět na kalendář' })
    && JSON.stringify(zp('https://zly.example/perla/rezervace/den/x')) === JSON.stringify({ href: '/perla/rezervace', text: 'Zpět na kalendář' }))
  ok('„Zpět“ z náhledu: bez parametru, prázdný nebo dvakrát v adrese = neotevíral se z kalendáře (k rezervaci nebo ke dni)',
    [undefined, '', [den, tyden]].every((z) => zp(z) === null))
  const stranka = cti('app/[rozsah]/rezervace/dokument/[id]/page.tsx')
  ok('náhled: „Zpět“ z kalendáře jen přes zpatkyZKalendare, jinak k rezervaci nebo ke dni',
    /const zpet =\s+zpatkyZKalendare\(rozsah, zpetText\) \?\?/.test(stranka)
    && stranka.includes("{ href: `/${rozsah}/rezervace/${r.id}`, text: 'Zpět na rezervaci' }")
    && !stranka.includes('bezpecnaZpatky('))

  const rn = (n) => JSON.stringify(zkus(() => rozdelitNazev(n)))
  ok('název štítku: přípona zvlášť, ať zůstane vidět (.pdf / .docx, i velkými, i s tečkou v názvu)',
    rn('Menu svatba.pdf') === '["Menu svatba",".pdf"]'
    && rn('Smlouva o akci – Novákovi.docx') === '["Smlouva o akci – Novákovi",".docx"]'
    && rn('a.b.PDF') === '["a.b",".PDF"]' && rn('archiv.tar.gz') === '["archiv.tar",".gz"]')
  ok('název štítku: bez přípony celý (verze 2.0, .htaccess, dlouhá koncovka, žádná tečka)',
    rn('verze 2.0') === '["verze 2.0",""]' && rn('.htaccess') === '[".htaccess",""]'
    && rn('soubor.dlouhakoncovka') === '["soubor.dlouhakoncovka",""]' && rn('bez tečky') === '["bez tečky",""]')

  const data = cti('app/[rozsah]/rezervace/data.ts')
  const nacist = data.slice(data.indexOf('export async function nacistRezervace('), data.indexOf('export async function nacistRezervaci('))
  // Vnořeně = stejný dotaz uživatelským klientem, takže dokumenty hlídá
  // i RLS `rezervace_prilohy_cist`; přílohy ke dni mají rezervace_id null
  // a do vnoření se nedostanou.
  ok('kalendář: dokumenty vnořeně v dotazu na rezervace, uživatelským klientem',
    nacist.includes('const supabase = await getServerSupabase()')
    && nacist.includes('.select(`${SLOUPCE_REZERVACE}, rezervace_prilohy(id, nazev, mime, nahrano)`)')
    && nacist.includes('dokumenty: dokumentyRezervace(rezervace_prilohy)'))
  // Vnoření bez jména vazby funguje, jen dokud mezi tabulkami vede
  // jediný cizí klíč. Druhý (třeba „přesunuto z rezervace“) a PostgREST
  // vnoření odmítne (PGRST201) — spadne celý kalendář, ne jen dokumenty,
  // a PGlite v CI PostgREST nespouští, tak by to nikdo neviděl.
  const prikazy = fs.readdirSync(path.join(KOREN, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) => cti(`supabase/migrations/${f}`).replace(/--[^\n]*/g, '').split(';'))
  const vazeb = prikazy
    .filter((p) => /\b(create|alter)\s+table\s+(if\s+not\s+exists\s+)?(only\s+)?(public\.)?rezervace_prilohy\b/i.test(p))
    .reduce((n, p) => n + (p.match(/references\s+(public\.)?rezervace\s*\(/gi) ?? []).length, 0)
  const opacnych = prikazy.filter((p) => /references\s+(public\.)?rezervace_prilohy\b/i.test(p)).length
  ok(`kalendář: mezi rezervace a rezervace_prilohy vede jediný cizí klíč (${vazeb} tam, ${opacnych} zpátky) — jinak vnoření potřebuje jméno vazby`,
    vazeb === 1 && opacnych === 0)

  const css = cti('app/_rezervace.css')
  ok('vzhled: karta týdne celá klikací (odkaz roztažený přes kartu), štítky nad ním',
    /\.ds-rez-polozka \{[^}]*position: relative/.test(css)
    && /\.ds-rez-polozka-odkaz::after \{[^}]*position: absolute; inset: 0/.test(css)
    && /\.ds-rez-polozka \.ds-rez-dokumenty \{[^}]*z-index: 1; pointer-events: none/.test(css)
    && css.includes('.ds-rez-polozka .ds-rez-dokumenty a { pointer-events: auto; }'))
  ok('vzhled: seznam dokumentů bez odrážek, zrušená bledne bez svých dokumentů',
    /\.ds-rez-dokumenty \{ list-style: none;/.test(css)
    && css.includes('.ds-rez-polozka[data-neplati] > .ds-rez-polozka-odkaz { opacity: .65; }')
    && !/\.ds-rez-polozka\[data-neplati\] \{[^}]*opacity/.test(css))
  // „+ N dalších dokumentů“ v týdnu vede na #dokumenty v detailu. Detail
  // se tu nevykresluje (potřebuje přihlášení a data), proto zdroj.
  const detail = cti('app/[rozsah]/rezervace/obsah.tsx')
  const prvky12 = cti('app/[rozsah]/rezervace/prvky.tsx')
  ok('detail: panel dokumentů má kotvu #dokumenty (vede na ni „+ další“ z týdne) a horní lišta ji nepřekryje',
    (detail.match(/kotva="dokumenty"/g) ?? []).length === 1
    && prvky12.includes("<section className={kotva ? 'ds-plocha ds-rez-kotva' : 'ds-plocha'} id={kotva}>")
    && /\.ds-rez-kotva \{ scroll-margin-top: [1-9]\d*px; \}/.test(css))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
