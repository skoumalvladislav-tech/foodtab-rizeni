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
 *   8. každá stránka i akce modulu se nejdřív ptá na přístup, teprve pak
 *      sahá na data (layout stránku nechrání).
 */

import fs from 'node:fs'
import path from 'node:path'

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
import { MAX_PRILOH_REZERVACE, cestaPrilohy, zkontrolovatVyber } from '../lib/rezervace-prilohy.ts'

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

  // Strukturální pojistka: kód modulu stav `pripojeno` nikde nenastavuje.
  // Smí ho nastavit jen budoucí adaptér po ověření — a databáze ho bez
  // posledni_test_ok = true nepustí (integrace_pripojeni_rezervace_overeno).
  const soubory = [
    ...fs.readdirSync(path.join(KOREN, 'lib')).filter((f) => f.startsWith('rezervace-')).map((f) => `lib/${f}`),
    ...(fs.readdirSync(path.join(KOREN, 'app/[rozsah]/rezervace'), { recursive: true }))
      .filter((f) => /\.(ts|tsx)$/.test(String(f)))
      .map((f) => `app/[rozsah]/rezervace/${String(f).replace(/\\/g, '/')}`),
  ]
  ok(`prošlo se dost souborů modulu (${soubory.length})`, soubory.length >= 12)
  const natvrdo = soubory.filter((f) => /stav\s*[:=]\s*['"]pripojeno['"]/.test(cti(f)))
  ok(`nikde v modulu se stav 'pripojeno' nezapisuje natvrdo${natvrdo.length ? ' — ' + natvrdo.join(', ') : ''}`, natvrdo.length === 0)
}

console.log('\n== 7. Přílohy ==\n')
{
  const cesta = cestaPrilohy('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'application/pdf')
  const casti = cesta.split('/')
  ok('cesta má dvě složky a jméno souboru ve tvaru, který čte app.rezervace_cesta',
    casti.length === 3 && /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(casti[2]))
  const migrace = cti('supabase/migrations/20261027100000_rezervace_akce.sql')
  ok('… a databáze opravdu chce dvě složky', /array_length\(v_slozky, 1\) is distinct from 2/.test(migrace))
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
  ok(`strop ${MAX_PRILOH_REZERVACE} souborů`, zkontrolovatVyber([{ name: 'a.pdf', type: 'application/pdf', size: 1 }], MAX_PRILOH_REZERVACE).platne.length === 0)
  ok('strop v aplikaci = strop v databázi', new RegExp(`>= ${MAX_PRILOH_REZERVACE} then`).test(migrace))
}

console.log('\n== 8. Přístup napřed, data potom ==\n')
{
  const stranky = ['page.tsx', 'den/[datum]/page.tsx', '[id]/page.tsx', 'nova/page.tsx', 'napojeni/page.tsx'].map((s) => `app/[rozsah]/rezervace/${s}`)
  for (const s of stranky) {
    // Jen tělo stránky — importy nahoře by „data“ našly vždycky první.
    const t = cti(s)
    const telo = t.slice(t.indexOf('export default'))
    const pristup = telo.indexOf('zkusPristupRezervacim(')
    const data = Math.min(
      ...['nacistRezervace(', 'nacistRezervaci(', 'nacistPoznamky(', 'nacistPrilohy(', 'getServerSupabase(', 'dnesPobocky(']
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
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
