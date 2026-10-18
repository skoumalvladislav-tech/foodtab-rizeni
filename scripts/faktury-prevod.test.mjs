#!/usr/bin/env node
/**
 * Převod faktur ze staré databáze do hlavní — čistá logika
 * (lib/faktury-prevod.ts). Bez sítě a bez databáze.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/faktury-prevod.test.mjs
 *   node --experimental-strip-types scripts/faktury-prevod.test.mjs --vypsat   (blok pro krok99)
 *
 * Co hlídá:
 *   1. částka na haléře PŘESNĚ, nic se nezaokrouhlí potichu,
 *   2. čas na milisekundy stejně jako databáze (useknutí, pásmo),
 *   3. převod řádku tam a zpátky beze ztráty, anomálie místo tichého zápisu,
 *   4. tři nezávislé zápisy kanonického textu dávají totéž — a prohozený
 *      sloupec v převodu je spadne,
 *   5. porovnání po řádcích (chybí / liší se / navíc),
 *   6. přílohy: stahuje se JEN ze staré databáze, typ podle obsahu,
 *   7. otisk z JS = otisk, který v krok99_scenar.sql ověřuje databáze
 *      (blok „DATA PRO OTISK" se generuje odsud — jiný obsah = test spadne).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  MAPA_SLOUPCU,
  casNaMs,
  castkaNaHalere,
  cestaPrilohy,
  halereNaCastku,
  idEvidenceZOdkazu,
  jeVerejnySouborStare,
  kanonickyTextHlavniho,
  kanonickyTextStareho,
  mereniHlavni,
  mereniZdroje,
  naRadekHlavni,
  naRadekStare,
  naVzorHlavni,
  porovnat,
  rozdilyMereni,
  typPrilohy,
} from '../lib/faktury-prevod.ts'

let chyb = 0
let kontrol = 0
const ok = (popis, podminka) => {
  kontrol++
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const TENANT = '11111111-2222-3333-4444-555555555555'

/** Plný řádek staré databáze; přepsat jde cokoli. */
function stary(prepis = {}) {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    received_at: '2026-09-05T10:11:12.123456+00:00',
    email_sender: 'faktury@dodavatel.cz',
    email_subject: 'Faktura 2026/0815',
    supplier: 'Dodavatel s.r.o.',
    supplier_ico: '12345678',
    invoice_number: 'FV2026/0815',
    variable_symbol: '20260815',
    amount: 1210.5,
    currency: 'CZK',
    issue_date: '2026-09-01',
    duzp: '2026-09-01',
    due_date: '2026-09-15',
    supplier_account: '123456789/0100',
    status: 'Ke kontrole úhrady',
    needs_review: false,
    onedrive_url: null,
    pdf_url: 'https://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/2026/09/fv.pdf',
    reminder_sent_at: null,
    created_at: '2026-09-05T10:11:13.5+00:00',
    updated_at: '2026-10-01T08:00:00+00:00',
    is_duplicate: false,
    is_archived: false,
    review_note: null,
    document_text_excerpt: 'FAKTURA – daňový doklad\nDodavatel s.r.o.',
    ...prepis,
  }
}

console.log('\n1. Částka na celé haléře — přesně, nebo vůbec')
{
  ok('1210.5 → 121050', castkaNaHalere(1210.5) === 121050)
  ok('"1210.50" → 121050', castkaNaHalere('1210.50') === 121050)
  ok('0.07 → 7 (ne 7,000000000000001)', castkaNaHalere(0.07) === 7)
  ok('0.29 → 29', castkaNaHalere(0.29) === 29)
  ok('-12.3 → -1230 (dobropis)', castkaNaHalere(-12.3) === -1230)
  ok('0 → 0', castkaNaHalere(0) === 0)
  ok('"12.300" → 1230 (nuly navíc nevadí)', castkaNaHalere('12.300') === 1230)
  ok('"12.345" → nepřevoditelné (třetí místo by se ztratilo)', castkaNaHalere('12.345') === null)
  ok('12.345 jako číslo → nepřevoditelné', castkaNaHalere(12.345) === null)
  ok('21474836.47 → strop integer', castkaNaHalere(21474836.47) === 2147483647)
  ok('21474836.48 → nad strop, nepřevoditelné', castkaNaHalere(21474836.48) === null)
  ok('1e21 → nepřevoditelné', castkaNaHalere(1e21) === null)
  ok('NaN → nepřevoditelné', castkaNaHalere(Number.NaN) === null)
  ok('null → nepřevoditelné', castkaNaHalere(null) === null)
  ok('"abc" → nepřevoditelné', castkaNaHalere('abc') === null)
  ok('"1,5" (čárka) → nepřevoditelné, ne 15', castkaNaHalere('1,5') === null)

  let tamZpet = true
  for (const h of [0, 1, 7, 99, 100, 101, 121050, -1, -1230, 2147483647, 123456789]) {
    if (castkaNaHalere(halereNaCastku(h)) !== h) tamZpet = false
  }
  ok('haléře → text pro numeric → haléře beze změny (11 hodnot, i záporné)', tamZpet)
  ok('halereNaCastku(-5) = "-0.05"', halereNaCastku(-5) === '-0.05')
}

console.log('\n2. Čas na milisekundy — useknutí jako floor() v databázi')
{
  const zaklad = Date.UTC(2026, 8, 5, 10, 11, 12)
  ok('mikrosekundy se useknou (.123999 → 123 ms, ne 124)', casNaMs('2026-09-05T10:11:12.123999+00:00') === zaklad + 123)
  ok('bez zlomku', casNaMs('2026-09-05T10:11:12+00:00') === zaklad)
  ok('Z', casNaMs('2026-09-05T10:11:12Z') === zaklad)
  ok('pásmo +02:00 se odečte', casNaMs('2026-09-05T12:11:12+02:00') === zaklad)
  ok('pásmo -0130 se přičte', casNaMs('2026-09-05T08:41:12-0130') === zaklad)
  ok('mezera místo T (výpis z psql)', casNaMs('2026-09-05 10:11:12.5+00') === zaklad + 500)
  ok('nesmysl → null', casNaMs('včera') === null)
  ok('null → null', casNaMs(null) === null)
  ok('shoda s Date.parse u milisekund', casNaMs('2026-01-02T03:04:05.678+00:00') === Date.parse('2026-01-02T03:04:05.678+00:00'))
}

console.log('\n3. Převod řádku tam a zpátky')
{
  const v = naRadekHlavni(stary(), TENANT)
  ok('platný řádek se převede', v.ok === true)
  if (v.ok) {
    ok('id zůstává', v.radek.id === 'a0000000-0000-4000-8000-000000000001')
    ok('tenant_id je firma vlastníka', v.radek.tenant_id === TENANT)
    ok('částka v haléřích', v.radek.castka_haleru === 121050)
    ok('due_date → splatnost (ne duzp)', v.radek.splatnost === '2026-09-15' && v.radek.duzp === '2026-09-01')
    ok('issue_date → datum_vystaveni', v.radek.datum_vystaveni === '2026-09-01')
    ok('pdf_url → odkaz_pdf beze změny', v.radek.odkaz_pdf === stary().pdf_url)
    ok('čas přijetí beze změny (i mikrosekundy)', v.radek.prijato_kdy === '2026-09-05T10:11:12.123456+00:00')
    ok('bez normalizace', v.normalizace.length === 0)
    const zpet = naRadekStare(v.radek)
    let stejne = true
    for (const [s] of MAPA_SLOUPCU) {
      const puvodni = stary()[s]
      const nove = zpet[s]
      const shoda = s === 'amount' ? castkaNaHalere(nove) === castkaNaHalere(puvodni) : nove === puvodni
      if (!shoda) { stejne = false; console.log(`     liší se ${s}: ${JSON.stringify(puvodni)} → ${JSON.stringify(nove)}`) }
    }
    ok('tam a zpátky: každý mapovaný sloupec stejný', stejne)
    ok('zpátky: částka jako text "1210.50"', zpet.amount === '1210.50')
  }

  const prazdne = naRadekHlavni(stary({ needs_review: null, is_duplicate: null, is_archived: null }), TENANT)
  ok('prázdné příznaky → false', prazdne.ok && !prazdne.radek.ke_kontrole && !prazdne.radek.duplicita && !prazdne.radek.archivovano)
  ok('… a vykáže se to (3 normalizace)', prazdne.ok && prazdne.normalizace.length === 3)

  const anomalie = [
    ['částka se třemi desetinnými místy', { amount: 10.005 }],
    ['částka chybí', { amount: null }],
    ['dodavatel chybí', { supplier: null }],
    ['měna chybí', { currency: null }],
    ['stav chybí', { status: null }],
    ['datum v nesmyslném tvaru', { duzp: '5.9.2026' }],
    ['čas přijetí chybí', { received_at: null }],
    ['čas založení chybí', { created_at: null }],
    ['id není uuid', { id: '4365' }],
    ['příznak není ano/ne', { is_archived: 'ano' }],
  ]
  for (const [popis, prepis] of anomalie) {
    const r = naRadekHlavni(stary(prepis), TENANT)
    ok(`anomálie: ${popis}`, r.ok === false && r.anomalie.length > 0)
  }
  const prazdnyText = naRadekHlavni(stary({ supplier: '', status: '', invoice_number: '' }), TENANT)
  ok('prázdné řetězce projdou beze změny (nejsou chybějící)', prazdnyText.ok && prazdnyText.radek.dodavatel === '' && prazdnyText.radek.stav === '' && prazdnyText.radek.cislo_faktury === '')
  const velkeId = naRadekHlavni(stary({ id: 'A0000000-0000-4000-8000-00000000000F' }), TENANT)
  ok('id velkými písmeny → malými (jak ho vrací databáze)', velkeId.ok && velkeId.radek.id === 'a0000000-0000-4000-8000-00000000000f')
}

console.log('\n4. Tři zápisy kanonického textu — a prohozený sloupec spadne')
const DATA = [
  stary(),
  stary({ id: 'a0000000-0000-4000-8000-000000000002', amount: -350, currency: 'EUR', status: 'Nutná ruční kontrola (chybí IČO)', needs_review: null, is_duplicate: true, supplier_ico: null, pdf_url: null, onedrive_url: 'https://onedrive.live.com/x', due_date: null, reminder_sent_at: '2026-10-01T07:00:00.999999+00:00' }),
  stary({ id: 'a0000000-0000-4000-8000-000000000003', amount: 0, supplier: '', status: 'Odmítnuto', is_archived: true, document_text_excerpt: null, email_subject: 'Řeřicha „uvozovky" \t tab', issue_date: null, duzp: null }),
  stary({ id: 'a0000000-0000-4000-8000-000000000004', amount: '99999.99', received_at: '2026-01-01T00:00:00+00:00', created_at: '2026-01-01T00:00:00.000001+00:00', review_note: 'Automaticky vyřazeno – „Dodavatel"', email_sender: null }),
]
{
  let shoda = true
  for (const r of DATA) {
    const v = naRadekHlavni(r, TENANT)
    if (!v.ok || kanonickyTextHlavniho(v.radek) !== kanonickyTextStareho(r)) shoda = false
  }
  ok('kanonický text hlavního (převedeného) = kanonický text starého, u všech 4 řádků', shoda)

  const prevedene = DATA.map((r) => naRadekHlavni(r, TENANT)).filter((v) => v.ok).map((v) => v.radek)
  const mz = mereniZdroje(DATA, 1)
  const mh = mereniHlavni(prevedene, 1)
  ok('měření staré = měření převedené (všechna pole)', rozdilyMereni(mz, mh).length === 0)
  ok('součty po měnách: CZK 121050 + 0 + 9999999, EUR -35000', mz.castky_haleru.CZK === 121050 + 0 + 9999999 && mz.castky_haleru.EUR === -35000)
  ok('ke_kontrole počítá jen true (null se nepočítá)', mz.ke_kontrole === 0)

  // Rozbití: převod by prohodil duzp a splatnost.
  const prohozene = prevedene.map((r) => ({ ...r, duzp: r.splatnost, splatnost: r.duzp }))
  const rozdil = rozdilyMereni(mz, mereniHlavni(prohozene, 1))
  ok('prohozené duzp ↔ splatnost: otisk obsahu nesedí', rozdil.includes('otisk_obsahu'))
  ok('… a počty i součty přitom sedí (proto otisk)', !rozdil.includes('pocet') && !rozdil.some((k) => k.startsWith('castky')))

  // Rozbití: převod by ztratil haléř.
  const bezHalere = prevedene.map((r, i) => (i === 0 ? { ...r, castka_haleru: r.castka_haleru - 1 } : r))
  ok('o haléř méně: spadne součet i otisk', rozdilyMereni(mz, mereniHlavni(bezHalere, 1)).includes('castky_haleru.CZK'))

  // Rozbití: jedna faktura navíc / chybí.
  ok('faktura chybí: spadne počet i otisk id', (() => { const r = rozdilyMereni(mz, mereniHlavni(prevedene.slice(1), 1)); return r.includes('pocet') && r.includes('otisk_id') })())
  ok('vzorů odmítnutí méně: spadne', rozdilyMereni(mz, mereniHlavni(prevedene, 0)).includes('vzoru'))
}

console.log('\n5. Porovnání po řádcích')
{
  const prevedene = DATA.map((r) => naRadekHlavni(r, TENANT)).filter((v) => v.ok).map((v) => v.radek)
  const cil = [
    prevedene[0],
    { ...prevedene[1], stav: 'Uhrazeno', splatnost: '2026-12-31' },
    { ...prevedene[2], prijato_kdy: '2026-09-05T10:11:12.124+00:00' },
    { ...prevedene[3], id: 'b0000000-0000-4000-8000-000000000009' },
  ]
  const r = porovnat(prevedene, cil)
  ok('chybí: řádek 4', r.chybi.length === 1 && r.chybi[0] === prevedene[3].id)
  ok('navíc: cizí id', r.navic.length === 1 && r.navic[0] === 'b0000000-0000-4000-8000-000000000009')
  const lisi2 = r.lisi.find((x) => x.id === prevedene[1].id)
  ok('liší se řádek 2, pole stav a splatnost', lisi2 && lisi2.pole.includes('stav') && lisi2.pole.includes('splatnost') && lisi2.pole.length === 2)
  ok('liší se řádek 3 v čase přijetí (jiná milisekunda)', r.lisi.some((x) => x.id === prevedene[2].id && x.pole.includes('prijato_kdy')))
  ok('řádek 1 se neliší', !r.lisi.some((x) => x.id === prevedene[0].id))
  ok('stejné sady: žádný rozdíl', (() => { const x = porovnat(prevedene, prevedene); return x.chybi.length + x.lisi.length + x.navic.length === 0 })())
  ok('mikrosekundy pod milisekundu se nepočítají jako rozdíl', porovnat([prevedene[0]], [{ ...prevedene[0], prijato_kdy: '2026-09-05T10:11:12.123999+00:00' }]).lisi.length === 0)
}

console.log('\n6. Přílohy — stahuje se jen ze staré databáze')
{
  const stara = 'https://ctqtwahlzhyjerqulqyn.supabase.co'
  ok('veřejný soubor staré databáze: ano', jeVerejnySouborStare(`${stara}/storage/v1/object/public/faktury-pdf/a.pdf`, stara))
  ok('jiný server: ne', !jeVerejnySouborStare('https://zly.example/storage/v1/object/public/faktury-pdf/a.pdf', stara))
  ok('podobné jméno serveru: ne', !jeVerejnySouborStare('https://ctqtwahlzhyjerqulqyn.supabase.co.zly.example/storage/v1/object/public/a.pdf', stara))
  ok('http: ne', !jeVerejnySouborStare(`http://ctqtwahlzhyjerqulqyn.supabase.co/storage/v1/object/public/faktury-pdf/a.pdf`, stara))
  ok('neveřejná cesta: ne', !jeVerejnySouborStare(`${stara}/rest/v1/invoices`, stara))
  ok('s dotazem: ne', !jeVerejnySouborStare(`${stara}/storage/v1/object/public/faktury-pdf/a.pdf?x=1`, stara))
  ok('bez nastavené staré adresy: ne', !jeVerejnySouborStare(`${stara}/storage/v1/object/public/faktury-pdf/a.pdf`, null))
  ok('nesmysl: ne', !jeVerejnySouborStare('faktura.pdf', stara))
  ok('odkaz na OneDrive: ne', !jeVerejnySouborStare('https://onedrive.live.com/redir?x', stara))

  ok('id evidence z odkazu příjmu', idEvidenceZOdkazu('https://foodtab-rizeni.vercel.app/api/faktury/priloha/0A000000-0000-4000-8000-000000000001') === '0a000000-0000-4000-8000-000000000001')
  ok('relativní odkaz příjmu', idEvidenceZOdkazu('/api/faktury/priloha/0a000000-0000-4000-8000-000000000001') === '0a000000-0000-4000-8000-000000000001')
  ok('jiný odkaz: null', idEvidenceZOdkazu('https://x/api/faktury/priloha/0a000000-0000-4000-8000-000000000001/x') === null)

  const bajty = (...b) => new Uint8Array([...b, ...new Array(16).fill(0)])
  ok('PDF podle obsahu', typPrilohy(bajty(0x25, 0x50, 0x44, 0x46, 0x2d))?.pripona === 'pdf')
  ok('JPEG podle obsahu', typPrilohy(bajty(0xff, 0xd8, 0xff, 0xe0))?.mime === 'image/jpeg')
  ok('PNG podle obsahu', typPrilohy(bajty(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.pripona === 'png')
  ok('WebP podle obsahu', typPrilohy(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.pripona === 'webp')
  ok('XML (ISDOC) podle obsahu, i s BOM', typPrilohy(new TextEncoder().encode('﻿<?xml version="1.0"?><Invoice/>'))?.pripona === 'xml')
  ok('HTML stránka (chybová) není příloha', typPrilohy(new TextEncoder().encode('<!DOCTYPE html><html>')) === null)
  ok('HEIC není příloha (kbelík ho nepřijme)', typPrilohy(bajty(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63)) === null)
  const cesta = cestaPrilohy(TENANT, new TextEncoder().encode('%PDF-1.4'), 'pdf')
  ok('cesta <firma>/<sha256>.pdf (tvar, který přijme app.faktury_priloha_firma)', /^[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf$/.test(cesta) && cesta.startsWith(TENANT))
}

console.log('\n7. Vzory odmítnutí')
{
  const v = naVzorHlavni({ id: 7, kind: 'not_invoice', excerpt: 'Reklama', supplier_guess: null, email_subject: 'Akce', created_at: '2026-09-15T08:00:00+00:00' }, TENANT)
  ok('vzor se převede s puvodni_id', v.ok && v.vzor.puvodni_id === 7 && v.vzor.druh === 'not_invoice' && v.vzor.vytah === 'Reklama')
  ok('vzor bez úryvku: anomálie', !naVzorHlavni({ id: 8, kind: 'not_invoice', excerpt: null, supplier_guess: null, email_subject: null, created_at: '2026-09-15T08:00:00+00:00' }, TENANT).ok)
  ok('id jako text "9" se přečte', (() => { const x = naVzorHlavni({ id: '9', kind: 'not_supplier', excerpt: 'x', supplier_guess: null, email_subject: null, created_at: '2026-09-15T08:00:00+00:00' }, TENANT); return x.ok && x.vzor.puvodni_id === 9 })())
}

// ---------------------------------------------------------------------
// 8. Převod v JS = porovnání v databázi (krok99_scenar.sql)
// ---------------------------------------------------------------------
// Blok do scénáře: doslovná kopie starých řádků (jak je uloží úloha do
// faktury_prevod_zdroj) a TÝŽ řádek převedený naRadekHlavni (jak ho
// úloha vloží do faktury). Scénář pak chce od app.faktury_prevod_porovnat
// nula rozdílů — porovnání v SQL je nezávislý zápis převodu, takže se
// tím ověří, že oba zápisy říkají totéž. Data jdou přes JSON, ať se
// znaky jako nový řádek nebo tabulátor nemusí přepisovat do SQL.
const sqlJson = (objekt) => `'${JSON.stringify(objekt).replace(/'/g, "''")}'::jsonb`
function blokProKrok99() {
  const prevedene = DATA.map((r) => naRadekHlavni(r, TENANT)).filter((v) => v.ok).map((v) => v.radek)
  const sloupce = ['id', ...MAPA_SLOUPCU.map(([, n]) => n)]
  const zdroj = DATA.map((r) => `  (:'tenant', 'invoices', '${r.id}', ${sqlJson(r)})`)
  const faktury = prevedene.map((r) => {
    const { tenant_id: _, ...bezFirmy } = r
    return `  (${sqlJson(bezFirmy)})`
  })
  return [
    '-- DATA PRO POROVNÁNÍ (začátek) — generuje scripts/faktury-prevod.test.mjs --vypsat, ručně neupravovat',
    'insert into public.faktury_prevod_zdroj (tenant_id, tabulka, klic, radek) values',
    zdroj.join(',\n') + ';',
    `insert into public.faktury (tenant_id, prevedeno_kdy, ${sloupce.join(', ')})`,
    `select :'tenant', now(), ${sloupce.map((s) => `r.${s}`).join(', ')}`,
    '  from (values',
    faktury.join(',\n'),
    `  ) as v(j), jsonb_populate_record(null::public.faktury, v.j) as r;`,
    '-- DATA PRO POROVNÁNÍ (konec)',
  ].join('\n')
}

if (process.argv.includes('--vypsat')) {
  console.log('\n' + blokProKrok99())
  process.exit(0)
}

console.log('\n8. Převod v JS = porovnání v databázi (krok99_scenar.sql)')
{
  const soubor = fileURLToPath(new URL('../supabase/tests/krok99_scenar.sql', import.meta.url))
  const scenar = existsSync(soubor) ? readFileSync(soubor, 'utf8').replace(/\r\n/g, '\n') : ''
  ok('krok99_scenar.sql existuje', scenar !== '')
  ok('krok99_scenar.sql obsahuje přesně blok vygenerovaný z dnešní logiky (jinak: --vypsat a vložit)', scenar.includes(blokProKrok99()))
}

console.log(`\n${chyb === 0 ? 'Vše prošlo' : `SELHALO ${chyb}`} — ${kontrol} kontrol (scripts/faktury-prevod.test.mjs).`)
process.exit(chyb === 0 ? 0 : 1)
