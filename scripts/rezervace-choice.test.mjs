#!/usr/bin/env node
/**
 * Choice (choiceqr.com) — napojení rezervací bez sítě a bez databáze.
 *
 * Pusť `node scripts/rezervace-choice.test.mjs`.
 *
 * Databázovou půlku (fronta dotazů, úloha v plánovači, zápis přes
 * `rezervace_importovat_zdroj`, „připojeno“ jen s testem) hlídá
 * supabase/tests/krok105_scenar.sql. Tady:
 *
 *   1. adresa podniku a odkaz na připojení (jen *.choiceqr.com),
 *   2. pokus o připojení (customAttribute): podpis svázaný s firmou,
 *      pobočkou a přihlášeným, platnost, přesný tvar,
 *   3. volání Choice podle dokumentace (podstrčený fetch): výměna kódu,
 *      seznam rezervací, 401/429/5xx, nečekaná odpověď,
 *   4. převod rezervace: stavy, čas JEN S PÁSMEM (bez pásma → nezapsat
 *      a ohlásit), prostor, poznámka, záloha bez částky,
 *   5. průchod: stránkování, kurzor, rozestup 5 s, 429 = konec,
 *   6. server (lib/rezervace-choice-sync.ts) se SKUTEČNÝM kódem
 *      a podstrčenou databází: fronta před každým dotazem i mezi
 *      pobočkami, „připojeno“ jen po úspěšném testu, token nikde v logu,
 *   7. callback (/api/rezervace/choice/callback) se skutečným kódem:
 *      cizí uživatel, prošlý a opakovaný odkaz, bez práva, chyba výměny,
 *      čistá adresa po návratu,
 *   8. do Choice se nezapisuje (žádné PUT, confirm, cancel).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  ADRESA_TESTU,
  API_CHOICE,
  NA_STRANKU,
  OKNO_DOPREDU_MS,
  OKNO_ZPET_MS,
  PLATNOST_POKUSU_S,
  ROZESTUP_DOTAZU_MS,
  STAVY_CHOICE,
  adresaSeznamu,
  casZChoice,
  chybaBehu,
  nastaveniChoice,
  odkazPripojeni,
  otiskPokusu,
  overitPokus,
  precistKurzor,
  probehnoutChoice,
  prostorZChoice,
  radekZChoice,
  rozebratPodnik,
  rozebratPokus,
  slozitPokus,
  stavZChoice,
  vytvoritChoice,
} from '../lib/rezervace-choice.ts'
import { adresaModulu, nactiModul } from './vykreslit.mjs'

const KOREN = path.join(import.meta.dirname, '..')
const cti = (p) => fs.readFileSync(path.join(KOREN, p), 'utf8')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')
const PRAZDNY = js('')

const TOKEN = 'tajny-token-CHOICE-0123456789abcdef'
const ID_PRIPOJENI = '11111111-2222-3333-4444-555555555555'
const FIRMA = 'aaaaaaaa-0000-0000-0000-000000000001'
const POBOCKA = 'bbbbbbbb-0000-0000-0000-000000000002'
const UZIVATEL = 'cccccccc-0000-0000-0000-000000000003'
const CALLBACK = 'https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback'

const KLIC_HMAC = 'zkusebni-klic'
const podepsat = (t) => createHmac('sha256', KLIC_HMAC).update(t).digest('base64url')
const podpisSedi = (t, p) => {
  const a = Buffer.from(podepsat(t))
  const b = Buffer.from(p)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Odpověď jako od fetch. */
const odpoved = (status, telo) =>
  new Response(telo === undefined ? '' : typeof telo === 'string' ? telo : JSON.stringify(telo), { status, headers: { 'content-type': 'application/json' } })

/** Rezervace z Choice podle dokumentace (booking/schema). */
const rezervace = (i, x = {}) => ({
  _id: `65f0a1b2c3d4e5f6${String(i).padStart(8, '0')}`,
  status: 'CONFIRMED',
  dateTime: '2026-11-20T18:00:00.000Z',
  num: i,
  personCount: 2,
  customer: { name: `Host ${i}`, phone: '+420 777 000 000', email: null },
  comment: '',
  note: '',
  ...x,
})

/* ===================================================================== */
console.log('\n== 1. Nastavení, adresa podniku a odkaz na připojení ==\n')
{
  ok('bez CHOICE_CLIENT_ID nebo SECRET → „čeká na nastavení“ (null)',
    nastaveniChoice({}) === null && nastaveniChoice({ CHOICE_CLIENT_ID: 'id' }) === null
    && nastaveniChoice({ CHOICE_CLIENT_ID: ' ', CHOICE_CLIENT_SECRET: 'x' }) === null)
  const n = nastaveniChoice({ CHOICE_CLIENT_ID: ' klient ', CHOICE_CLIENT_SECRET: ' tajne ' })
  ok('s oběma se vrátí oříznuté', n?.clientId === 'klient' && n?.secret === 'tajne')

  const dobre = (vstup, sub, digit = null) => {
    const r = rozebratPodnik(vstup, 'klient')
    return r.stav === 'ok' && r.podnik.subdomena === sub && r.podnik.digit === digit
  }
  ok('jméno podniku', dobre('MojeRestaurace', 'mojerestaurace'))
  ok('adresa bez https', dobre('mojerestaurace.choiceqr.com', 'mojerestaurace'))
  ok('adresa s cestou', dobre('https://mojerestaurace.choiceqr.com/menu', 'mojerestaurace'))
  ok('odkaz na připojení z Choice → vezme se digit',
    dobre('https://cerna-perla.choiceqr.com/admin/open-api/connect?clientId=klient&redirectUrl=x&customAttribute=1&scope=all&response_type=code&digit=9202', 'cerna-perla', '9202'))
  const spatne = (vstup) => rozebratPodnik(vstup, 'klient').stav === 'chyba'
  ok('cizí doména se odmítne', spatne('https://evil.example.com') && spatne('mojerestaurace.choiceqr.com.evil.com'))
  ok('vnořená subdoména, jméno a heslo v adrese, port se odmítnou',
    spatne('a.b.choiceqr.com') && spatne('https://jmeno:heslo@x.choiceqr.com') && spatne('https://x.choiceqr.com:8443'))
  ok('open-api a www nejsou podniky', spatne('open-api.choiceqr.com') && spatne('www.choiceqr.com'))
  ok('prázdné se odmítne', spatne('  '))
  const jinaAplikace = rozebratPodnik('https://x.choiceqr.com/admin/open-api/connect?clientId=jiny&digit=1', 'klient')
  ok('odkaz pro jinou aplikaci se odmítne s důvodem', jinaAplikace.stav === 'chyba' && /jinou aplikaci/.test(jinaAplikace.duvod))
  ok('digit, který není číslo, se odmítne', spatne('https://x.choiceqr.com/admin/open-api/connect?digit=1;drop'))

  const odkaz = new URL(odkazPripojeni({ podnik: { subdomena: 'cerna-perla', digit: '9202' }, clientId: 'klient', redirectUrl: CALLBACK, pokus: 'POKUS' }))
  ok('odkaz míří na stránku připojení podniku v Choice',
    odkaz.origin === 'https://cerna-perla.choiceqr.com' && odkaz.pathname === '/admin/open-api/connect')
  ok('… se všemi parametry z dokumentace (clientId, redirectUrl, customAttribute, scope=all, response_type=code, digit)',
    odkaz.searchParams.get('clientId') === 'klient' && odkaz.searchParams.get('redirectUrl') === CALLBACK
    && odkaz.searchParams.get('customAttribute') === 'POKUS' && odkaz.searchParams.get('scope') === 'all'
    && odkaz.searchParams.get('response_type') === 'code' && odkaz.searchParams.get('digit') === '9202')
  const bezDigit = new URL(odkazPripojeni({ podnik: { subdomena: 'x', digit: null }, clientId: 'k', redirectUrl: CALLBACK, pokus: 'P' }))
  ok('bez známého digit se digit nevymýšlí', !bezDigit.searchParams.has('digit'))
  ok('secret v odkazu není', !odkaz.href.includes('tajne'))
}

/* ===================================================================== */
console.log('\n== 2. Pokus o připojení (customAttribute) ==\n')
{
  const ted = Date.UTC(2026, 9, 25, 20, 0, 0)
  const nonce = 'Abcdefghij0123456789_-'
  const zaklad = { pripojeniId: ID_PRIPOJENI, platnostDo: Math.floor(ted / 1000) + PLATNOST_POKUSU_S, nonce, rozsah: 'cerna-perla' }
  const vazba = { tenantId: FIRMA, branchId: POBOCKA, userId: UZIVATEL }
  const text = slozitPokus(zaklad, vazba, podepsat)
  const r = rozebratPokus(text)
  ok('pokus jde rozebrat zpátky na tytéž části', r?.pripojeniId === ID_PRIPOJENI && r?.nonce === nonce && r?.rozsah === 'cerna-perla' && r?.platnostDo === zaklad.platnostDo)
  ok('… a v textu není firma, pobočka ani uživatel', !text.includes(FIRMA) && !text.includes(POBOCKA) && !text.includes(UZIVATEL))
  ok('pokus je krátký (Choice ho vrací v adrese)', text.length < 160)
  ok('správná vazba → ok', overitPokus(r, vazba, podpisSedi, ted) === 'ok')
  ok('JINÝ PŘIHLÁŠENÝ → odmítnuto', overitPokus(r, { ...vazba, userId: 'dddddddd-0000-0000-0000-000000000004' }, podpisSedi, ted) === 'podpis')
  ok('jiná pobočka → odmítnuto', overitPokus(r, { ...vazba, branchId: 'dddddddd-0000-0000-0000-000000000005' }, podpisSedi, ted) === 'podpis')
  ok('jiná firma → odmítnuto', overitPokus(r, { ...vazba, tenantId: 'dddddddd-0000-0000-0000-000000000006' }, podpisSedi, ted) === 'podpis')
  ok('po 10 minutách propadlý', overitPokus(r, vazba, podpisSedi, ted + (PLATNOST_POKUSU_S + 1) * 1000) === 'propadly')
  const podvrzeny = rozebratPokus(text.replace('.cerna-perla.', '.jina-pobocka.'))
  ok('přepsaný rozsah → odmítnuto', podvrzeny !== null && overitPokus(podvrzeny, vazba, podpisSedi, ted) === 'podpis')
  const dlouhy = slozitPokus({ ...zaklad, platnostDo: zaklad.platnostDo + 86400 }, vazba, podepsat)
  ok('platnost delší, než appka vydává → odmítnuto i s platným podpisem', overitPokus(rozebratPokus(dlouhy), vazba, podpisSedi, ted) === 'podpis')
  ok('cizí tvar → null', [null, '', 'abc', text + '.x', text.replace(ID_PRIPOJENI, 'neni-uuid'), 'x'.repeat(401)].every((t) => rozebratPokus(t) === null))
  ok('otisk pokusu: neobsahuje číslo a pro jiné číslo vyjde jinak',
    !otiskPokusu(nonce).includes(nonce) && otiskPokusu(nonce) !== otiskPokusu('Zbcdefghij0123456789_-') && otiskPokusu(nonce) === otiskPokusu(nonce))
}

/* ===================================================================== */
console.log('\n== 3. Volání Choice (podstrčená síť) ==\n')

/** Podstrčená síť: odpovědi podle pořadí nebo funkce, zapisuje požadavky. */
function sit(odpovedi) {
  const pozadavky = []
  const fetchFn = async (url, init = {}) => {
    pozadavky.push({ url: String(url), init })
    const dalsi = typeof odpovedi === 'function' ? odpovedi(String(url), init) : odpovedi.shift()
    if (dalsi instanceof Error) throw dalsi
    return dalsi
  }
  return { fetchFn, pozadavky }
}

{
  const s = sit([odpoved(200, { varSymbol: 12345, domain: 'Cerna-Perla.choiceqr.com', token: TOKEN })])
  const v = await vytvoritChoice(s.fetchFn).vymenitKod({ code: 'KOD-1', clientId: 'klient', secret: 'tajne' })
  const p = s.pozadavky[0]
  ok('výměna kódu: POST https://open-api.choiceqr.com/auth/connect/token', p.url === `${API_CHOICE}/auth/connect/token` && p.init.method === 'POST')
  ok('… tělo JSON {code, clientId, secret}', JSON.stringify(JSON.parse(p.init.body)) === JSON.stringify({ code: 'KOD-1', clientId: 'klient', secret: 'tajne' })
    && p.init.headers['content-type'] === 'application/json')
  ok('… vrátí token, varSymbol (i z čísla) a doménu malými', v.stav === 'ok' && v.token === TOKEN && v.varSymbol === '12345' && v.domena === 'cerna-perla.choiceqr.com')

  const echo = sit([odpoved(400, { error: true, name: 'ValidationError', message: 'code KOD-TAJNY is invalid', statusCode: 400 })])
  const e1 = await vytvoritChoice(echo.fetchFn).vymenitKod({ code: 'KOD-TAJNY', clientId: 'k', secret: 's' })
  ok('400 → chyba v datech a text od Choice (mohl by nést kód) se NEPŘEBÍRÁ', e1.stav === 'chyba' && e1.druh === 'data' && !e1.duvod.includes('KOD-TAJNY'))
  const e2 = await vytvoritChoice(sit([odpoved(401, {})]).fetchFn).vymenitKod({ code: 'k', clientId: 'k', secret: 's' })
  ok('401 → přístup (klíč aplikace)', e2.stav === 'chyba' && e2.druh === 'pristup' && /CHOICE_CLIENT_ID/.test(e2.duvod))
  const e3 = await vytvoritChoice(sit([odpoved(503, 'down')]).fetchFn).vymenitKod({ code: 'k', clientId: 'k', secret: 's' })
  const e4 = await vytvoritChoice(sit([new Error('ECONNRESET')]).fetchFn).vymenitKod({ code: 'k', clientId: 'k', secret: 's' })
  ok('5xx a výpadek sítě → dočasná chyba', e3.druh === 'docasna' && e4.druh === 'docasna')
  const e5 = await vytvoritChoice(sit([odpoved(200, { varSymbol: '1', domain: 'x' })]).fetchFn).vymenitKod({ code: 'k', clientId: 'k', secret: 's' })
  const e6 = await vytvoritChoice(sit([odpoved(200, { token: TOKEN, domain: 'x' })]).fetchFn).vymenitKod({ code: 'k', clientId: 'k', secret: 's' })
  ok('bez tokenu nebo bez varSymbol → chyba, nic se nedomýšlí', e5.stav === 'chyba' && e6.stav === 'chyba')

  const dotaz = { od: '2026-10-24T08:00:00.000Z', do: '2026-10-27T20:00:00.000Z', podle: 'bookingDt', stranka: 3, naStranku: 100 }
  const u = new URL(adresaSeznamu(dotaz))
  ok('seznam: GET /bookings/list s from, till, periodField, page, perPage',
    u.origin + u.pathname === `${API_CHOICE}/bookings/list` && u.searchParams.get('from') === dotaz.od && u.searchParams.get('till') === dotaz.do
    && u.searchParams.get('periodField') === 'bookingDt' && u.searchParams.get('page') === '3' && u.searchParams.get('perPage') === '100')
  const s2 = sit([odpoved(200, [rezervace(1)]), odpoved(200, { items: [rezervace(2)] }), odpoved(200, { total: 3 }), odpoved(429, {}), odpoved(403, {})])
  const api = vytvoritChoice(s2.fetchFn)
  const r1 = await api.nacistStranku(TOKEN, dotaz)
  ok('… s hlavičkou Authorization: Bearer <token>, metoda GET', s2.pozadavky[0].init.headers.authorization === `Bearer ${TOKEN}` && s2.pozadavky[0].init.method === 'GET')
  ok('… pole rezervací projde', r1.stav === 'ok' && r1.rezervace.length === 1)
  const r2 = await api.nacistStranku(TOKEN, dotaz)
  ok('… pole zabalené v { items } taky', r2.stav === 'ok' && r2.rezervace[0]._id === rezervace(2)._id)
  const r3 = await api.nacistStranku(TOKEN, dotaz)
  ok('… objekt bez pole → chyba, ne „žádné rezervace“', r3.stav === 'chyba' && r3.druh === 'data')
  const r4 = await api.nacistStranku(TOKEN, dotaz)
  const r5 = await api.nacistStranku(TOKEN, dotaz)
  ok('429 → limit, 403 → přístup', r4.druh === 'limit' && r5.druh === 'pristup')
  const s3 = sit([odpoved(200, [])])
  await vytvoritChoice(s3.fetchFn).nacistStranku(TOKEN, null)
  ok('živý test = GET /bookings/list?page=1&perPage=1', s3.pozadavky[0].url === ADRESA_TESTU && ADRESA_TESTU === `${API_CHOICE}/bookings/list?page=1&perPage=1`)
}

/* ===================================================================== */
console.log('\n== 4. Převod rezervace z Choice ==\n')
{
  const ocekavane = { CREATED: 'ceka', CONFIRMED: 'potvrzeno', EXTERNAL_CANCELLING: 'ceka', CANCELLED: 'zrusena', IN_PROGRESS: 'potvrzeno', NOT_CAME: 'nedostavil_se', COMPLETED: 'dokonceno' }
  ok('všech 7 stavů z dokumentace má převod', Object.keys(STAVY_CHOICE).length === 7
    && Object.entries(ocekavane).every(([k, v]) => stavZChoice(k).stav === v && stavZChoice(k).stavZdroje === k))
  ok('malá písmena taky', stavZChoice('cancelled').stav === 'zrusena')
  const nezname = stavZChoice('EXPIRED')
  ok('neznámý stav → předběžná a původní slovo zůstane (nikdy „proběhla“)', nezname.stav === 'ceka' && nezname.stavZdroje === 'EXPIRED')

  const cas = (x) => casZChoice(x)
  ok('okamžik s Z', cas('2026-11-20T18:00:00.000Z').okamzik === '2026-11-20T18:00:00.000Z')
  ok('okamžik s +01:00 → týž okamžik v UTC', cas('2026-11-20T19:00:00+01:00').okamzik === '2026-11-20T18:00:00.000Z')
  ok('ČAS BEZ PÁSMA → bez-pasma (nic se nedomýšlí)', cas('2026-11-20T19:00:00').duvod === 'bez-pasma' && cas('2026-11-20 19:00').duvod === 'bez-pasma')
  ok('{ date, time } bez pásma → bez-pasma', cas({ date: '2026-11-20', time: '19:00' }).duvod === 'bez-pasma')
  ok('{ $date: "…Z" } a { $date: { $numberLong } } (MongoDB) → okamžik',
    cas({ $date: '2026-11-20T18:00:00Z' }).okamzik === '2026-11-20T18:00:00.000Z'
    && cas({ $date: { $numberLong: String(Date.UTC(2026, 10, 20, 18)) } }).okamzik === '2026-11-20T18:00:00.000Z')
  ok('{ utc: "…" } → okamžik', cas({ utc: '2026-11-20T18:00:00Z' }).stav === 'ok')
  ok('holé číslo (sekundy, nebo ms?) → neznámý tvar', cas(1763661600).duvod === 'neznamy-tvar' && cas(1763661600000).duvod === 'neznamy-tvar')
  ok('objekt s pásmem v jiném poli → neznámý tvar (nedomýšlí se ani to)', cas({ date: '2026-11-20', time: '19:00', timezone: 'Europe/Prague' }).duvod === 'neznamy-tvar')
  ok('nesmysl a chybějící čas', cas('2026-13-45T10:00:00Z').duvod === 'neplatny' && cas(null).duvod === 'chybi' && cas('zítra').duvod === 'neznamy-tvar')

  ok('prostor: česky, jinak anglicky, jinak cokoli',
    prostorZChoice({ _id: 'a', i18n: { en: { name: 'Terrace' }, cs: { name: 'Terasa' } } }) === 'Terasa'
    && prostorZChoice({ i18n: { en: { name: 'Terrace' } } }) === 'Terrace' && prostorZChoice({ i18n: { de: 'Garten' } }) === 'Garten'
    && prostorZChoice(null) === '')

  const plna = rezervace(7, {
    status: 'CONFIRMED',
    dateTime: '2026-11-20T19:00:00+01:00',
    personCount: 4,
    customer: { name: ' Jan\u0000 Novák ', phone: '+420 777 111 222', email: 'Jan@Example.cz' },
    comment: 'u okna, dort ve 20:00',
    note: 'stálý host',
    deposit: { amount: 50000, currency: 'CZK', paid: true, reverted: false },
    preferArea: { _id: 'x', i18n: { cs: { name: 'Salonek' } } },
    timestamps: { created: '2026-10-01T10:00:00Z' },
  })
  const r = radekZChoice(plna, '12345')
  const rr = r.stav === 'ok' ? r.radek : {}
  ok('rezervace → řádek: _id je číslo ze zdroje, okamžik v UTC', r.stav === 'ok' && rr.externi_id === plna._id && rr.zacatek === '2026-11-20T18:00:00.000Z')
  ok('… konec a „změněno“ prázdné (jednotka visitDuration neznámá, Choice změnu neposílá)', rr.konec === '' && rr.zmeneno_kdy === '')
  ok('… stav, počet osob, jméno (bez řídicích znaků), kontakt', rr.stav === 'potvrzeno' && rr.stav_zdroje === 'CONFIRMED' && rr.pocet_osob === '4'
    && rr.jmeno_hosta === 'Jan Novák' && rr.telefon === '+420 777 111 222' && rr.email === 'Jan@Example.cz')
  ok('… poznámka: host + poznámka restaurace + stav zálohy', rr.poznamka.startsWith('u okna, dort ve 20:00')
    && rr.poznamka.includes('Poznámka restaurace v Choice: stálý host') && rr.poznamka.includes('Záloha v Choice: zaplacená.'))
  ok('… částka zálohy se NEUKAZUJE (jednotka neznámá)', !rr.poznamka.includes('50000') && !rr.poznamka.includes('500'))
  ok('… prostor z preferArea', rr.prostor === 'Salonek')
  ok('počet osob 0 nebo nesmysl → neuvedeno, ne 0', radekZChoice(rezervace(8, { personCount: 0 }), '1').radek.pocet_osob === ''
    && radekZChoice(rezervace(9, { personCount: 'čtyři' }), '1').radek.pocet_osob === '')
  const bezPasma = radekZChoice(rezervace(10, { dateTime: '2026-11-20T19:00:00' }), '1')
  ok('BEZ PÁSMA → nezapíše se, ohlásí se s _id', bezPasma.stav === 'chyba' && bezPasma.duvod === 'bez-pasma' && bezPasma.id === rezervace(10)._id)
  ok('bez _id → nezapíše se', radekZChoice(rezervace(11, { _id: '' }), '1').duvod === 'bez-id' && radekZChoice({ status: 'CONFIRMED' }, '1').duvod === 'bez-id')
}

/* ===================================================================== */
console.log('\n== 5. Průchod: stránky, kurzor, rozestup, 429 ==\n')

const REZERVA_MS = 20_000

/** Virtuální hodiny + fronta se stejnou aritmetikou jako rezervace_choice_zabrat_dotaz. */
function hodinyAFronta(start) {
  const h = { ted: start, dalsi: -Infinity }
  h.zabrat = (rozestup, nejdele) => {
    const slot = Math.max(h.ted, h.dalsi)
    if (slot > h.ted + nejdele) return null
    h.dalsi = slot + rozestup
    return slot - h.ted
  }
  return h
}

/** Choice s N rezervacemi v okně, M v blízku a K nových — odpověď podle dotazu. */
function choiceSRezervacemi({ blizko = 1, nove = 1, okno = 250, chyby = {} } = {}, h) {
  const zaznam = []
  return {
    zaznam,
    api: {
      async nacistStranku(token, d) {
        zaznam.push({ cas: h.ted, token, ...d })
        h.ted += 300 // odpověď trvá
        const chyba = chyby[zaznam.length]
        if (chyba) return chyba
        const celkem = d.podle === 'createdDt' ? nove : d.od === h.oknoOd ? okno : blizko
        const od = (d.stranka - 1) * d.naStranku
        const pocet = Math.max(0, Math.min(d.naStranku, celkem - od))
        return { stav: 'ok', rezervace: Array.from({ length: pocet }, (_, i) => rezervace(od + i + 1)) }
      },
    },
  }
}

const zapisDoPameti = () => {
  const zapsane = []
  const fn = async (radky) => {
    zapsane.push(...radky)
    return { stav: 'ok', souhrn: { nove: radky.length, zmenene: 0, bezeZmeny: 0, zastarale: 0, odmitnute: [] } }
  }
  return { zapsane, fn }
}

{
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  h.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch = choiceSRezervacemi({ okno: 250 }, h)
  const z = zapisDoPameti()
  let cekani = 0
  const pockat = async () => {
    cekani += 1
    const c = h.zabrat(ROZESTUP_DOTAZU_MS, 120_000)
    if (c === null) return false
    h.ted += c
    return true
  }
  const v = await probehnoutChoice({ api: ch.api, token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START, pockatNaDotaz: pockat, zapsat: z.fn })
  const druhy = ch.zaznam.map((d) => `${d.podle}:${d.stranka}`)
  ok(`pořadí dotazů: blízko, nové, okno po stránkách (${druhy.join(' ')})`,
    druhy.join(' ') === 'bookingDt:1 createdDt:1 bookingDt:1 bookingDt:2 bookingDt:3')
  ok('blízko = −12 h až +48 h podle data rezervace',
    ch.zaznam[0].od === new Date(START - 12 * 3600_000).toISOString() && ch.zaznam[0].do === new Date(START + 48 * 3600_000).toISOString())
  ok('nové = podle vytvoření, poprvé za posledních 24 h', ch.zaznam[1].podle === 'createdDt' && ch.zaznam[1].od === new Date(START - 86400_000).toISOString())
  ok('okno = od včerejška do +180 dní, 100 na stránku',
    ch.zaznam[2].od === new Date(START - OKNO_ZPET_MS).toISOString() && ch.zaznam[2].do === new Date(START + OKNO_DOPREDU_MS).toISOString()
    && ch.zaznam.every((d) => d.naStranku === NA_STRANKU))
  ok('PŘED KAŽDÝM dotazem se čekalo ve frontě', cekani === ch.zaznam.length)
  const rozestupy = ch.zaznam.slice(1).map((d, i) => d.cas - ch.zaznam[i].cas)
  ok(`mezi dotazy nejméně 5 s (${rozestupy.join(', ')} ms)`, rozestupy.every((r) => r >= 5000))
  ok('neplná stránka okno uzavře: kurzor bez okna, s časem dokončení a „nové od“',
    v.konec === 'hotovo' && v.oknoDokonceno && !v.kurzor.okno && v.kurzor.okno_hotovo_kdy === new Date(START).toISOString()
    && v.kurzor.nove_od === new Date(START).toISOString())
  ok('zapsalo se, co přišlo (stejné _id ve stránce jen jednou)', z.zapsane.length === 1 + 1 + 250 && v.nacteno === 252 && v.uspesnych === 5)
  ok('token šel do každého dotazu', ch.zaznam.every((d) => d.token === TOKEN))
}

{
  // Do času běhu se vejdou jen 4 dotazy → kurzor si pamatuje stránku.
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  h.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch = choiceSRezervacemi({ okno: 650 }, h)
  const z = zapisDoPameti()
  const konec = START + REZERVA_MS + 3 * ROZESTUP_DOTAZU_MS + 1000
  const pockat = async () => {
    const nejdele = konec - REZERVA_MS - h.ted
    if (nejdele < 0) return false
    const c = h.zabrat(ROZESTUP_DOTAZU_MS, nejdele)
    if (c === null) return false
    h.ted += c
    return true
  }
  const v1 = await probehnoutChoice({ api: ch.api, token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START, pockatNaDotaz: pockat, zapsat: z.fn })
  ok('došel čas → konec „cas“ (není chyba) a kurzor ukazuje na další stránku okna',
    v1.konec === 'cas' && ch.zaznam.length === 4 && v1.kurzor.okno?.stranka === 3 && chybaBehu(v1) === null)

  // Příští běh o 15 minut později pokračuje TÍMŽ oknem od stránky 3.
  const DALSI = START + 15 * 60_000
  h.ted = DALSI
  const pocetPred = ch.zaznam.length
  const v2 = await probehnoutChoice({ api: ch.api, token: TOKEN, varSymbol: '1', kurzor: precistKurzor(JSON.parse(JSON.stringify(v1.kurzor))), tedMs: DALSI,
    pockatNaDotaz: async () => { const c = h.zabrat(ROZESTUP_DOTAZU_MS, 120_000); h.ted += c ?? 0; return c !== null }, zapsat: z.fn })
  const okno2 = ch.zaznam.slice(pocetPred).filter((d) => d.podle === 'bookingDt' && d.od === h.oknoOd)
  ok('příští běh pokračuje stejným oknem od stránky 3 až do konce', okno2.map((d) => d.stranka).join(',') === '3,4,5,6,7' && v2.konec === 'hotovo')
  ok('… a „nové“ hledá od minulého běhu (s 15min překryvem)',
    ch.zaznam.slice(pocetPred).find((d) => d.podle === 'createdDt')?.od === new Date(DALSI - 15 * 60_000 - 15 * 60_000).toISOString())

  const stary = precistKurzor({ okno: { od: h.oknoOd, do: '2027-04-23T18:00:00.000Z', stranka: 4, zahajeno: new Date(START - 13 * 3600_000).toISOString() } })
  const h3 = hodinyAFronta(START)
  h3.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch3 = choiceSRezervacemi({ okno: 50 }, h3)
  await probehnoutChoice({ api: ch3.api, token: TOKEN, varSymbol: '1', kurzor: stary, tedMs: START,
    pockatNaDotaz: async () => { const c = h3.zabrat(ROZESTUP_DOTAZU_MS, 120_000); h3.ted += c ?? 0; return c !== null }, zapsat: zapisDoPameti().fn })
  ok('okno rozjeté před víc než 12 h se začne znovu od stránky 1', ch3.zaznam.at(-1).stranka === 1 && ch3.zaznam.at(-1).od === h3.oknoOd)
  ok('nečitelný kurzor se zahodí', JSON.stringify(precistKurzor({ okno: { stranka: 'x' }, nove_od: 'včera' })) === '{}')
}

{
  // 429 uprostřed: konec běhu, žádný další dotaz, stránka se neposune.
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  h.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch = choiceSRezervacemi({ okno: 300, chyby: { 4: { stav: 'chyba', druh: 'limit', duvod: 'Choice omezil počet dotazů (429).', http: 429 } } }, h)
  const pockat = async () => { const c = h.zabrat(ROZESTUP_DOTAZU_MS, 120_000); h.ted += c ?? 0; return c !== null }
  const v = await probehnoutChoice({ api: ch.api, token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START, pockatNaDotaz: pockat, zapsat: zapisDoPameti().fn })
  ok('429 → konec „limit“ hned, další dotaz už nešel', v.konec === 'limit' && ch.zaznam.length === 4)
  ok('… kurzor stojí na stránce, která neprošla', v.kurzor.okno?.stranka === 2)
  ok('… a u napojení je důvod (zkusí se příště)', /429/.test(chybaBehu(v) ?? '') && /dalším běhu/.test(chybaBehu(v)))

  const h2 = hodinyAFronta(START)
  const ch2 = choiceSRezervacemi({ chyby: { 1: { stav: 'chyba', druh: 'pristup', duvod: 'Choice odmítl přístup (401).', http: 401 } } }, h2)
  const v2 = await probehnoutChoice({ api: ch2.api, token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START,
    pockatNaDotaz: async () => true, zapsat: zapisDoPameti().fn })
  ok('401 → konec „pristup“ a výzva připojit znovu', v2.konec === 'pristup' && /Připojte podnik znovu/.test(chybaBehu(v2)))
}

{
  // Rezervace bez pásma se nezapíše a ohlásí; zbytek stránky se zapíše.
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const z = zapisDoPameti()
  const api = {
    async nacistStranku(_t, d) {
      if (d.podle !== 'createdDt') return { stav: 'ok', rezervace: [] }
      return { stav: 'ok', rezervace: [rezervace(1), rezervace(2, { dateTime: '2026-11-20T19:00:00' }), rezervace(1), rezervace(3, { dateTime: { date: '2026-11-20', time: '19:00' } })] }
    },
  }
  const v = await probehnoutChoice({ api, token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START, pockatNaDotaz: async () => true, zapsat: z.fn })
  ok('bez pásma: NEZAPSÁNO (2 ze 4), zapsaná jen platná a jednou', z.zapsane.length === 1 && z.zapsane[0].externi_id === rezervace(1)._id)
  const hlaska = chybaBehu(v) ?? ''
  ok(`… a OHLÁŠENO u napojení: „${hlaska}“`, v.preskocene.pocet === 2 && /čas bez časového pásma 2×/.test(hlaska) && hlaska.includes(rezervace(2)._id))
  ok('… bez osobních údajů hosta v hlášce', !hlaska.includes('Host 2') && !hlaska.includes('+420'))
  ok('… česky správně (2 rezervace, 1 rezervace, 5 rezervací)', hlaska.startsWith('Nezapsaly se 2 rezervace z Choice')
    && chybaBehu({ ...v, preskocene: { pocet: 1, priklad: null, duvody: { 'bez-id': 1 } } }).startsWith('Nezapsala se 1 rezervace')
    && chybaBehu({ ...v, preskocene: { pocet: 5, priklad: null, duvody: { 'bez-id': 5 } } }).startsWith('Nezapsalo se 5 rezervací'))
  const vsude = await probehnoutChoice({ api: { nacistStranku: async () => ({ stav: 'ok', rezervace: [rezervace(2, { dateTime: '2026-11-20T19:00:00' })] }) },
    token: TOKEN, varSymbol: '1', kurzor: {}, tedMs: START, pockatNaDotaz: async () => true, zapsat: zapisDoPameti().fn })
  ok('tatáž vadná rezervace v blízku, nových i okně se ohlásí jednou', vsude.dotazu === 3 && vsude.preskocene.pocet === 1)

  const spatnyZapis = async () => ({ stav: 'chyba', duvod: 'Zápis rezervací do Foodtabu selhal (XX000) — zkusí se příště.' })
  const v2 = await probehnoutChoice({ api: { nacistStranku: async () => ({ stav: 'ok', rezervace: [rezervace(1)] }) }, token: TOKEN, varSymbol: '1',
    kurzor: {}, tedMs: START, pockatNaDotaz: async () => true, zapsat: spatnyZapis })
  ok('nepovedený zápis → chyba a kurzor se neposune', v2.konec === 'chyba' && !v2.kurzor.nove_od && v2.uspesnych === 0)

  const plna = { nacistStranku: async (_t, d) => ({ stav: 'ok', rezervace: d.podle === 'bookingDt' && d.stranka >= 1000 ? Array.from({ length: 100 }, (_, i) => rezervace(i)) : [] }) }
  const v3 = await probehnoutChoice({ api: plna, token: TOKEN, varSymbol: '1',
    kurzor: precistKurzor({ okno: { od: '2026-10-24T06:00:00.000Z', do: '2027-04-23T18:00:00.000Z', stranka: 1000, zahajeno: new Date(START).toISOString() } }),
    tedMs: START, pockatNaDotaz: async () => true, zapsat: zapisDoPameti().fn })
  ok('za stránkou 1000 (strop Choice) se nepokračuje, ohlásí se', v3.konec === 'chyba' && /víc než 100000/.test(v3.duvod))
}

/* ===================================================================== */
console.log('\n== 6. Server: fronta, zápis, „připojeno“ jen po testu ==\n')

/**
 * Podstrčená databáze: tabulky v paměti a supabase-js řetězec nad nimi
 * (select/insert/update, eq/neq/is, `sloupec->>klíč`). Rpc podle `svet.rpc`.
 */
function databaze(tabulky = {}, ted = () => Date.now()) {
  const svet = { tabulky, rpcVolani: [], rpc: {}, zmeny: [] }
  const hodnota = (radek, sloupec) => {
    const [s, k] = sloupec.split('->>')
    const v = radek[s]
    return k === undefined ? v : v && typeof v === 'object' ? (v[k] === undefined || v[k] === null ? null : String(v[k])) : null
  }
  const sedi = (radek, filtry) => filtry.every(([op, s, v]) =>
    op === 'eq' ? hodnota(radek, s) === v : op === 'neq' ? hodnota(radek, s) !== v : op === 'is' ? hodnota(radek, s) === v : true)
  const zpracovat = (q) => {
    const t = (svet.tabulky[q.tabulka] ??= [])
    if (q.op === 'insert') {
      // Výchozí hodnoty jako v databázi (synchronizace_behy.zahajeno_kdy default now()).
      const radky = (Array.isArray(q.data) ? q.data : [q.data]).map((r) => ({ id: r.id ?? `beh-${t.length + 1}`, zahajeno_kdy: new Date(ted()).toISOString(), ...r }))
      if (q.tabulka === 'synchronizace_behy' && radky.some((r) => r.stav === 'bezi' && t.some((x) => x.stav === 'bezi' && x.integrace_pripojeni_id === r.integrace_pripojeni_id))) {
        return { data: null, error: { code: '23505', message: 'duplicate' } }
      }
      t.push(...radky)
      svet.zmeny.push({ tabulka: q.tabulka, op: 'insert', data: radky })
      return { data: q.jeden ? radky[0] : radky, error: null }
    }
    let radky = t.filter((r) => sedi(r, q.filtry))
    if (q.op === 'update') {
      for (const r of radky) Object.assign(r, structuredClone(q.data))
      svet.zmeny.push({ tabulka: q.tabulka, op: 'update', data: structuredClone(q.data), filtry: q.filtry, pocet: radky.length })
    }
    if (q.razeni) radky = [...radky].sort((a, b) => String(b[q.razeni]).localeCompare(String(a[q.razeni])))
    if (q.limit) radky = radky.slice(0, q.limit)
    if (q.jeden) return { data: radky[0] ?? null, error: null }
    return { data: radky, error: null }
  }
  const retez = (tabulka) => {
    const q = { tabulka, op: 'select', filtry: [], jeden: false, razeni: null, limit: null, data: null }
    const b = {
      select: () => b,
      insert: (d) => ((q.op = 'insert'), (q.data = d), b),
      update: (d) => ((q.op = 'update'), (q.data = d), b),
      eq: (s, v) => (q.filtry.push(['eq', s, v]), b),
      neq: (s, v) => (q.filtry.push(['neq', s, v]), b),
      is: (s, v) => (q.filtry.push(['is', s, v]), b),
      order: (s) => ((q.razeni = s), b),
      limit: (n) => ((q.limit = n), b),
      maybeSingle: () => ((q.jeden = true), b),
      single: () => ((q.jeden = true), b),
      then: (hotovo, chyba) => Promise.resolve().then(() => zpracovat(q)).then(hotovo, chyba),
    }
    return b
  }
  svet.klient = {
    from: retez,
    rpc: async (jmeno, args) => {
      svet.rpcVolani.push({ jmeno, args })
      const f = svet.rpc[jmeno]
      return f ? f(args) : { data: null, error: { code: 'PGRST202', message: 'neznámá funkce' } }
    },
  }
  return svet
}

globalThis.__choiceTest = { klient: null, rozsifrovat: (s) => (s === 'sifra-ok' ? { token: TOKEN } : s === 'sifra-ok-2' ? { token: TOKEN + '-2' } : (() => { throw new Error('šifra') })()) }
const SYNC = await nactiModul('lib/rezervace-choice-sync.ts', [
  ['server-only', PRAZDNY],
  ['./supabase/uloha.ts', js('export function klientUlohy() { return globalThis.__choiceTest.klient }')],
  ['./integrace-klice.ts', js('export function rozsifrovat(s) { return globalThis.__choiceTest.rozsifrovat(s) }')],
  ['./supabase/dotaz.ts', js("export function funkceNeexistuje(e) { return e?.code === 'PGRST202' || e?.code === '42883' }")],
])

function pripojeni(id, x = {}) {
  return { id, tenant_id: FIRMA, branch_id: POBOCKA, oblast: 'rezervace', poskytovatel: 'choice', stav: 'pripojeno', odpojeno_kdy: null,
    posledni_sync_kdy: null, externi_ucet: { domena: 'cerna-perla.choiceqr.com', var_symbol: '12345' }, ...x }
}

/** Svět pro synchronizaci: databáze, fronta se stejnou aritmetikou jako SQL, Choice s rezervacemi, virtuální hodiny. */
function svetSynchronizace({ pripojeniRadky, sifry = { [ID_PRIPOJENI]: 'sifra-ok' }, choice = () => odpoved(200, []), fronta = true, zapis } = {}) {
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  const db = databaze({
    integrace_pripojeni: pripojeniRadky ?? [pripojeni(ID_PRIPOJENI)],
    integrace_tajemstvi: Object.entries(sifry).map(([pripojeni_id, sifra]) => ({ pripojeni_id, sifra })),
    synchronizace_behy: [],
  }, () => h.ted)
  if (fronta) {
    db.rpc.rezervace_choice_zabrat_dotaz = ({ p_rozestup_ms, p_nejdele_cekat_ms }) => ({ data: h.zabrat(p_rozestup_ms, p_nejdele_cekat_ms), error: null })
  }
  db.rpc.rezervace_importovat_zdroj = zapis ?? (({ p_radky }) => ({ data: { nove: p_radky.length, zmenene: 0, beze_zmeny: 0, zastarale: 0 }, error: null }))
  const dotazy = []
  const prostredi = {
    ted: () => h.ted,
    spat: async (ms) => { h.ted += ms },
    fetch: async (url, init) => {
      const nejblizsiFronta = db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_dotaz').length
      dotazy.push({ cas: h.ted, url: String(url), init, frontaPred: nejblizsiFronta })
      h.ted += 250
      return choice(String(url), init)
    },
  }
  globalThis.__choiceTest.klient = db.klient
  return { db, h, dotazy, prostredi, START }
}

/** Zachytí výpisy do konzole (token v nich nesmí být). */
async function sVypisy(fn) {
  const vypisy = []
  const puvodni = { log: console.log, error: console.error, warn: console.warn }
  console.log = console.error = console.warn = (...a) => vypisy.push(a.map(String).join(' '))
  try {
    return { vysledek: await fn(), vypisy }
  } finally {
    Object.assign(console, puvodni)
  }
}

{
  const choice = (url) => {
    const u = new URL(url)
    const okno = u.searchParams.get('periodField') === 'bookingDt' && u.searchParams.get('till') > '2027'
    const stranka = Number(u.searchParams.get('page'))
    if (!okno) return odpoved(200, [rezervace(1)])
    return odpoved(200, Array.from({ length: stranka < 3 ? 100 : 20 }, (_, i) => rezervace(stranka * 1000 + i)))
  }
  const s = svetSynchronizace({ choice })
  const { vysledek: v, vypisy } = await sVypisy(() => SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi }))
  ok(`běh doběhl: ${v.stav}, ${v.dotazu} dotazů, ${v.nacteno} rezervací`, v.stav === 'ok' && v.dotazu === 5 && v.nacteno === 222)
  ok('každý dotaz na Choice měl PŘED SEBOU zabrání ve frontě (fronta v databázi, ne uspání v procesu)',
    s.dotazy.every((d, i) => d.frontaPred === i + 1))
  const rozestupy = s.dotazy.slice(1).map((d, i) => d.cas - s.dotazy[i].cas)
  ok(`rozestup mezi dotazy ≥ 5 s (${rozestupy.join(', ')} ms)`, rozestupy.every((r) => r >= 5000))
  ok('rozestup chce fronta 5,5 s (nikdy pod 5 s)', s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_dotaz').every((r) => r.args.p_rozestup_ms === 5500))
  ok('dotazy jen GET na /bookings/list s Bearer tokenem', s.dotazy.every((d) => d.init.method === 'GET' && d.url.startsWith(`${API_CHOICE}/bookings/list?`) && d.init.headers.authorization === `Bearer ${TOKEN}`))
  const zapisy = s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_importovat_zdroj')
  ok('zápis přes rezervace_importovat_zdroj s id připojení (stejná cesta jako příjmové API a CSV)',
    zapisy.length === 5 && zapisy.every((r) => r.args.p_pripojeni === ID_PRIPOJENI && r.args.p_radky.every((x) => x.zacatek.endsWith('Z'))))
  const p = s.db.tabulky.integrace_pripojeni[0]
  ok('u napojení: čas posledního načtení, počet, žádná chyba, kurzor po dokončení okna',
    p.posledni_sync_kdy === new Date(s.h.ted).toISOString() && p.posledni_sync_pocet_radku === 222 && p.posledni_chyba === null
    && p.externi_ucet.kurzor?.okno_hotovo_kdy && !p.externi_ucet.kurzor.okno && p.externi_ucet.var_symbol === '12345')
  ok('stav napojení běh nemění (zůstává ověřené)', p.stav === 'pripojeno')
  const behy = s.db.tabulky.synchronizace_behy
  ok('běh zapsaný v synchronizace_behy jako hotový (zámek proti souběhu)', behy.length === 1 && behy[0].stav === 'hotovo' && behy[0].dokonceno_kdy)
  ok('token není v žádném výpisu ani u napojení', !vypisy.some((x) => x.includes(TOKEN)) && !JSON.stringify(s.db.tabulky.integrace_pripojeni).includes(TOKEN))

  // Druhý běh hned po prvním: „Načíst teď“ s minutovým odstupem se nepustí.
  const hned = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.h.ted + 50_000, nejmeneOdMinulehoMs: 60_000, prostredi: s.prostredi })
  ok('„Načíst teď“ hned po předchozím běhu → přeskočeno, žádný dotaz', hned.stav === 'preskoceno' && s.dotazy.length === 5)
}

{
  // Dvě pobočky jedna po druhé (jako úloha) — fronta drží rozestup i mezi nimi.
  const DRUHE = '99999999-2222-3333-4444-555555555555'
  const s = svetSynchronizace({
    pripojeniRadky: [pripojeni(ID_PRIPOJENI), pripojeni(DRUHE, { branch_id: 'bbbbbbbb-0000-0000-0000-000000000099', externi_ucet: { var_symbol: '777' } })],
    sifry: { [ID_PRIPOJENI]: 'sifra-ok', [DRUHE]: 'sifra-ok-2' },
  })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  const prvni = s.dotazy.length
  await SYNC.synchronizovatChoice(DRUHE, { konecMs: s.h.ted + 57_000, prostredi: s.prostredi })
  const prechod = s.dotazy[prvni].cas - s.dotazy[prvni - 1].cas
  ok(`mezi poslední stránkou jedné pobočky a první druhé ≥ 5 s (${prechod} ms)`, prvni === 3 && s.dotazy.length === 6 && prechod >= 5000)
  ok('každá pobočka svým tokenem', s.dotazy.slice(0, 3).every((d) => d.init.headers.authorization === `Bearer ${TOKEN}`)
    && s.dotazy.slice(3).every((d) => d.init.headers.authorization === `Bearer ${TOKEN}-2`))
}

{
  // Fronta v databázi chybí (kód před migrací) → na Choice se NESAHÁ.
  const s = svetSynchronizace({ fronta: false })
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  ok('bez fronty v databázi: žádný dotaz na Choice', s.dotazy.length === 0 && v.stav === 'chyba')
  ok('… a u napojení: čeká na migraci 20261031100000', /20261031100000/.test(s.db.tabulky.integrace_pripojeni[0].posledni_chyba ?? ''))
  ok('… běh zapsaný jako chyba (zámek se uvolnil)', s.db.tabulky.synchronizace_behy[0]?.stav === 'chyba')
}

{
  // 429 → omezeno (úloha nezkouší další pobočky), běh chyba, důvod u napojení.
  let n = 0
  const s = svetSynchronizace({ choice: () => (++n === 2 ? odpoved(429, {}) : odpoved(200, [rezervace(n)])) })
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  ok('429 → omezeno, žádný další dotaz', v.omezeno && s.dotazy.length === 2)
  ok('… důvod u napojení a stav zůstal ověřený', /429/.test(s.db.tabulky.integrace_pripojeni[0].posledni_chyba) && s.db.tabulky.integrace_pripojeni[0].stav === 'pripojeno')
  ok('… první stránka se zapsala a čas načtení se posunul', s.db.tabulky.integrace_pripojeni[0].posledni_sync_kdy !== null)
}

{
  // 401 → vyžaduje pozornost, „připojeno“ pryč (databáze by ho bez testu nepustila).
  const s = svetSynchronizace({ choice: () => odpoved(401, {}) })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  const p = s.db.tabulky.integrace_pripojeni[0]
  ok('401 → „vyžaduje pozornost“, test neplatí, výzva připojit znovu', p.stav === 'vyzaduje_pozornost' && p.posledni_test_ok === false && /Připojte podnik znovu/.test(p.posledni_chyba))

  const bezTokenu = svetSynchronizace({ sifry: {} })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: bezTokenu.START + 57_000, prostredi: bezTokenu.prostredi })
  ok('chybí token → žádný dotaz, „vyžaduje pozornost“', bezTokenu.dotazy.length === 0 && bezTokenu.db.tabulky.integrace_pripojeni[0].stav === 'vyzaduje_pozornost')

  const neovereny = svetSynchronizace({ pripojeniRadky: [pripojeni(ID_PRIPOJENI, { stav: 'nepripojeno' })] })
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: neovereny.START + 57_000, prostredi: neovereny.prostredi })
  ok('neověřené připojení → přeskočeno, žádný dotaz ani zámek', v.stav === 'preskoceno' && neovereny.dotazy.length === 0 && neovereny.db.tabulky.synchronizace_behy.length === 0)
}

{
  // Jedna vadná rezervace (databáze 23514) nesmí shodit celou stránku.
  const s = svetSynchronizace({
    choice: (url) => (new URL(url).searchParams.get('periodField') === 'createdDt' ? odpoved(200, [rezervace(1), rezervace(2), rezervace(3)]) : odpoved(200, [])),
    zapis: ({ p_radky }) => (p_radky.some((r) => r.externi_id === rezervace(2)._id)
      ? { data: null, error: { code: '23514', message: 'check' } }
      : { data: { nove: p_radky.length, zmenene: 0, beze_zmeny: 0, zastarale: 0 }, error: null }),
  })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  const jednotlive = s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_importovat_zdroj' && r.args.p_radky.length === 1)
  ok('vadná dávka → zápis po jedné, ostatní se zapsaly', jednotlive.length === 3)
  ok('… a odmítnutá je u napojení s _id', (s.db.tabulky.integrace_pripojeni[0].posledni_chyba ?? '').includes(rezervace(2)._id))
}

{
  // „Připojeno“ jen po úspěšném testu — spuštěním, ne čtením textu.
  const zkus = async (test) => {
    const db = databaze({ integrace_pripojeni: [pripojeni(ID_PRIPOJENI, { stav: 'nepripojeno', posledni_test_ok: null })] })
    await SYNC.zapsatVysledekTestu(db.klient, ID_PRIPOJENI, test)
    return { radek: db.tabulky.integrace_pripojeni[0], zmeny: db.zmeny }
  }
  const dobre = await zkus({ stav: 'ok' })
  ok('úspěšný test → „pripojeno“ spolu s posledni_test_ok = true', dobre.radek.stav === 'pripojeno' && dobre.radek.posledni_test_ok === true && dobre.radek.posledni_chyba === null)
  const neuspechy = [
    { stav: 'chyba', druh: 'pristup', duvod: 'Choice odmítl přístup (401).' },
    { stav: 'chyba', druh: 'data', duvod: 'nečekaný tvar' },
    { stav: 'chyba', druh: 'docasna', duvod: 'Choice neodpověděl' },
    { stav: 'chyba', druh: 'limit', duvod: '429' },
    { stav: 'chyba', druh: 'fronta', duvod: 'fronta' },
    { stav: 'chyba', druh: 'cas', duvod: 'čas' },
  ]
  const vysledky = await Promise.all(neuspechy.map(zkus))
  ok('ŽÁDNÝ neúspěšný test „pripojeno“ nezapíše', vysledky.every((x) => x.radek.stav !== 'pripojeno' && !JSON.stringify(x.zmeny).includes('"pripojeno"')))
  ok('odmítnutý přístup / nesmysl → „chyba“ s testem false', vysledky[0].radek.stav === 'chyba' && vysledky[0].radek.posledni_test_ok === false && vysledky[1].radek.stav === 'chyba')
  ok('dočasný výpadek, 429, fronta → stav se nemění, jen důvod', vysledky.slice(2).every((x) => x.radek.stav === 'nepripojeno' && x.radek.posledni_chyba))
  const pripojene = databaze({ integrace_pripojeni: [pripojeni(ID_PRIPOJENI)] })
  await SYNC.zapsatVysledekTestu(pripojene.klient, ID_PRIPOJENI, neuspechy[2])
  ok('připojené připojení kvůli výpadku Choice nespadne', pripojene.tabulky.integrace_pripojeni[0].stav === 'pripojeno')
}

{
  // Živý test jde frontou a jen na GET /bookings/list?page=1&perPage=1.
  const s = svetSynchronizace({ choice: () => odpoved(200, []) })
  const t = await SYNC.otestovatToken(TOKEN, s.START + 57_000, s.prostredi)
  ok('živý test: fronta, pak GET ?page=1&perPage=1', t.stav === 'ok' && s.dotazy.length === 1 && s.dotazy[0].frontaPred === 1 && s.dotazy[0].url === ADRESA_TESTU)
  const bez = svetSynchronizace({ fronta: false })
  const t2 = await SYNC.otestovatToken(TOKEN, bez.START + 57_000, bez.prostredi)
  ok('… bez fronty v databázi se netestuje vůbec (žádný dotaz)', t2.stav === 'chyba' && t2.druh === 'fronta' && bez.dotazy.length === 0)
  const s3 = svetSynchronizace({ choice: () => odpoved(401, {}) })
  const t3 = await SYNC.otestovatToken(TOKEN, s3.START + 57_000, s3.prostredi)
  ok('… 401 → přístup', t3.stav === 'chyba' && t3.druh === 'pristup')
}

/* ===================================================================== */
console.log('\n== 7. Callback /api/rezervace/choice/callback ==\n')

process.env.INTEGRACE_KLIC_SIFRY = 'ab'.repeat(32)
process.env.CHOICE_CLIENT_ID = 'klient-foodtab'
process.env.CHOICE_CLIENT_SECRET = 'tajne-foodtab'

const KLICE = adresaModulu('lib/integrace-klice.ts', [['server-only', PRAZDNY]])
const { podepsatText, rozsifrovat } = await import(KLICE)

globalThis.__callback = {}
const NEXT = js(`
export function after(fn) { globalThis.__callback.after.push(fn) }
export class NextResponse extends Response {
  static redirect(url) { return new Response(null, { status: 307, headers: { location: String(url) } }) }
}`)
const CALLBACK_ROUTE = await nactiModul('app/api/rezervace/choice/callback/route.ts', [
  ['next/server', NEXT],
  ['@/lib/integrace-klice', KLICE],
  ['@/lib/authz', js('export async function hasAccess(t, p, b) { globalThis.__callback.pravo.push([t, p, b]); return globalThis.__callback.smi }')],
  ['@/lib/supabase/server', js('export async function getServerSupabase() { return globalThis.__callback.klient }')],
  ['@/lib/rezervace-choice-sync', js(`
export async function otestovatToken(token) { globalThis.__callback.testy.push(token); return globalThis.__callback.test }
export async function zapsatVysledekTestu(_k, id, test) { globalThis.__callback.zapsaneTesty.push([id, test]); return true }
export async function jinePripojeniTehozPodniku(t, id, vs) { return globalThis.__callback.jinde }
export async function synchronizovatChoice(id) { globalThis.__callback.synchronizace.push(id) }`)],
])

const NONCE = 'Pokus012345678901234_-'
function svetCallbacku({ uzivatel = UZIVATEL, smi = true, test = { stav: 'ok' }, jinde = false, choice, stav = 'pripojuje_se', nonce = NONCE } = {}) {
  const db = databaze({
    integrace_pripojeni: [pripojeni(ID_PRIPOJENI, { stav, externi_ucet: { domena_zadana: 'cerna-perla.choiceqr.com', pokus: otiskPokusu(nonce) } })],
  })
  db.rpc.integrace_uloz_tajemstvi = (args) => ({ data: null, error: null, args })
  db.klient.auth = { getUser: async () => ({ data: { user: uzivatel ? { id: uzivatel } : null }, error: null }) }
  const sit = []
  globalThis.fetch = async (url, init) => {
    sit.push({ url: String(url), init })
    return choice ? choice(String(url), init) : odpoved(200, { varSymbol: '12345', domain: 'cerna-perla.choiceqr.com', token: TOKEN })
  }
  Object.assign(globalThis.__callback, { klient: db.klient, smi, test, jinde, pravo: [], testy: [], zapsaneTesty: [], synchronizace: [], after: [] })
  return { db, sit }
}

function adresaNavratu({ platnostDo = Math.floor(Date.now() / 1000) + 300, rozsah = 'cerna-perla', vazba = {}, code = 'KOD-Z-CHOICE', nonce = NONCE, navic = '' } = {}) {
  const pokus = slozitPokus({ pripojeniId: ID_PRIPOJENI, platnostDo, nonce, rozsah },
    { tenantId: FIRMA, branchId: POBOCKA, userId: UZIVATEL, ...vazba }, podepsatText)
  return `https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback?code=${code}&customAttribute=${pokus}${navic}`
}

async function zavolat(adresa) {
  const r = await CALLBACK_ROUTE.GET(new Request(adresa))
  const kam = new URL(r.headers.get('location'))
  return { status: r.status, kam, cesta: kam.pathname + kam.search }
}

{
  const s = svetCallbacku()
  const r = await zavolat(adresaNavratu())
  const p = s.db.tabulky.integrace_pripojeni[0]
  ok(`šťastná cesta → ${r.cesta}`, r.cesta === '/cerna-perla/rezervace/napojeni?stav=choice-pripojeno')
  ok('ČISTÁ ADRESA: v přesměrování není kód, token ani pokus', !r.kam.href.includes('KOD-Z-CHOICE') && !r.kam.href.includes(TOKEN) && !r.kam.href.includes(NONCE))
  ok('kód se vyměnil u Choice s clientId a secret z prostředí', s.sit.length === 1 && s.sit[0].url === `${API_CHOICE}/auth/connect/token`
    && JSON.parse(s.sit[0].init.body).secret === 'tajne-foodtab' && JSON.parse(s.sit[0].init.body).code === 'KOD-Z-CHOICE')
  const ulozeni = s.db.rpcVolani.find((x) => x.jmeno === 'integrace_uloz_tajemstvi')
  ok('token uložen JEN ZAŠIFROVANÝ (přes RPC, která sama ověří právo)', ulozeni && !ulozeni.args.p_sifra.includes(TOKEN) && rozsifrovat(ulozeni.args.p_sifra).token === TOKEN)
  ok('u připojení: varSymbol a doména, pokus spotřebovaný, token v registru není',
    p.externi_ucet.var_symbol === '12345' && p.externi_ucet.domena === 'cerna-perla.choiceqr.com' && !p.externi_ucet.pokus && !JSON.stringify(p).includes(TOKEN))
  const pravo = globalThis.__callback.pravo
  ok('právo integrace.manage se ověřilo ZNOVU na pobočce připojení', pravo.length === 1 && pravo[0][1] === 'integrace.manage' && pravo[0][2] === POBOCKA)
  ok('„připojeno“ až z výsledku živého testu', globalThis.__callback.testy[0] === TOKEN && globalThis.__callback.zapsaneTesty[0]?.[1]?.stav === 'ok'
    && !s.db.zmeny.some((z) => z.data?.stav === 'pripojeno'))
  ok('první načtení až po odpovědi (after)', globalThis.__callback.after.length === 1 && globalThis.__callback.synchronizace.length === 0)

  const znovu = await zavolat(adresaNavratu())
  ok('TENTÝŽ ODKAZ PODRUHÉ → odmítnut, Choice se znovu neptá', znovu.cesta.endsWith('chyba=choice-pokus') && s.sit.length === 1)
}

{
  const s = svetCallbacku({ uzivatel: 'dddddddd-0000-0000-0000-000000000004' })
  const r = await zavolat(adresaNavratu())
  ok('JINÝ PŘIHLÁŠENÝ s cizím odkazem → odmítnut, nic se nevyměnilo ani nespotřebovalo',
    r.cesta.endsWith('chyba=choice-pokus') && s.sit.length === 0 && s.db.tabulky.integrace_pripojeni[0].stav === 'pripojuje_se')
}

{
  const s = svetCallbacku()
  const r = await zavolat(adresaNavratu({ platnostDo: Math.floor(Date.now() / 1000) - 5 }))
  ok('prošlý odkaz → choice-propadly, nic se nevyměnilo', r.cesta.endsWith('chyba=choice-propadly') && s.sit.length === 0)
}

{
  const s = svetCallbacku({ smi: false })
  const r = await zavolat(adresaNavratu())
  ok('bez práva integrace.manage (mezitím odebráno) → pravo, nic se nevyměnilo ani nespotřebovalo',
    r.cesta.endsWith('chyba=pravo') && s.sit.length === 0 && s.db.tabulky.integrace_pripojeni[0].stav === 'pripojuje_se')
}

{
  const s = svetCallbacku({ uzivatel: null })
  const r = await zavolat(adresaNavratu())
  ok('nepřihlášený → choice-prihlaseni, nic se nevyměnilo', r.cesta.endsWith('chyba=choice-prihlaseni') && s.sit.length === 0)
}

{
  const s = svetCallbacku({ nonce: 'JinyPokus2345678901234' })
  const r = await zavolat(adresaNavratu())
  ok('starší odkaz (u připojení už je novější pokus) → odmítnut', r.cesta.endsWith('chyba=choice-pokus') && s.sit.length === 0)
}

{
  const s = svetCallbacku()
  const pokazeny = adresaNavratu().replace('.cerna-perla.', '.cizi-pobocka.')
  const r = await zavolat(pokazeny)
  ok('přepsaný rozsah v odkazu → odmítnut', r.cesta === '/cizi-pobocka/rezervace/napojeni?chyba=choice-pokus' && s.sit.length === 0)
  const nesmysl = await zavolat('https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback?code=x&customAttribute=../../evil')
  ok('nesmyslný pokus → na úvod (/) a nic se nezpracuje', nesmysl.cesta === '/' && s.sit.length === 0 && s.db.zmeny.length === 0)
}

{
  const ulozeneId = process.env.CHOICE_CLIENT_ID
  delete process.env.CHOICE_CLIENT_ID
  const s = svetCallbacku()
  const r = await zavolat(adresaNavratu())
  process.env.CHOICE_CLIENT_ID = ulozeneId
  ok('bez CHOICE_CLIENT_ID na serveru → choice-nenastaveno, nic se nevyměnilo', r.cesta.endsWith('chyba=choice-nenastaveno') && s.sit.length === 0)
}

{
  const s = svetCallbacku({ choice: () => odpoved(400, { error: true, message: 'code KOD-Z-CHOICE invalid' }) })
  const r = await zavolat(adresaNavratu())
  const p = s.db.tabulky.integrace_pripojeni[0]
  ok('Choice kód nepřijal → chyba u připojení (bez kódu v textu) a choice-kod',
    r.cesta.endsWith('chyba=choice-kod') && p.stav === 'chyba' && !p.posledni_chyba.includes('KOD-Z-CHOICE'))
  ok('… token se neukládal', !s.db.rpcVolani.some((x) => x.jmeno === 'integrace_uloz_tajemstvi'))
}

{
  const s = svetCallbacku({ jinde: true })
  const r = await zavolat(adresaNavratu())
  ok('tentýž podnik u jiné pobočky → choice-jinde, token se neuložil',
    r.cesta.endsWith('chyba=choice-jinde') && !s.db.rpcVolani.some((x) => x.jmeno === 'integrace_uloz_tajemstvi'))
}

{
  const s = svetCallbacku({ test: { stav: 'chyba', druh: 'pristup', duvod: 'Choice odmítl přístup (403).' } })
  const r = await zavolat(adresaNavratu())
  ok('živý test neprošel → choice-test, žádné první načtení', r.cesta.endsWith('chyba=choice-test') && globalThis.__callback.after.length === 0)
  const s2 = svetCallbacku({ test: { stav: 'chyba', druh: 'limit', duvod: '429' } })
  const r2 = await zavolat(adresaNavratu())
  ok('test narazil na 429 → token uložený, „Ověřit znovu“ později', r2.cesta.endsWith('chyba=choice-test-pozdeji')
    && s2.db.rpcVolani.some((x) => x.jmeno === 'integrace_uloz_tajemstvi'))
  void s
}

{
  const s = svetCallbacku()
  const r = await zavolat(adresaNavratu({ navic: '&error=access_denied' }))
  ok('majitel v Choice nepovolil → choice-zamitnuto, Choice se neptá', r.cesta.endsWith('chyba=choice-zamitnuto') && s.sit.length === 0
    && s.db.tabulky.integrace_pripojeni[0].stav === 'chyba')
}

/* ===================================================================== */
console.log('\n== 8. Do Choice se nezapisuje; nastavení ==\n')
{
  const soubory = ['lib/rezervace-choice.ts', 'lib/rezervace-choice-sync.ts', 'app/api/rezervace/choice/callback/route.ts', 'app/api/uloha/rezervace-choice/route.ts', 'app/[rozsah]/rezervace/akce.ts']
  // Bez komentářů — hlavička modulu o confirm/cancel schválně mluví.
  const bezKomentaru = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const kod = soubory.map((f) => bezKomentaru(cti(f))).join('\n')
  ok('vyříznutí komentářů něco nechalo (kontrola nečte prázdno)', kod.length > 20000 && kod.includes('bookings/list'))
  ok('žádné PUT ani confirm/cancel na Choice', !/method:\s*['"](PUT|PATCH|DELETE)['"]/.test(kod) && !/\/bookings\/[^'"`]*\/(confirm|cancel)/.test(kod))
  ok('jediný POST na Choice je výměna kódu', (cti('lib/rezervace-choice.ts').match(/method:\s*'POST'/g) ?? []).length === 1
    && /auth\/connect\/token`,\s*\{\s*method: 'POST'/.test(cti('lib/rezervace-choice.ts')))
  const env = cti('.env.example')
  ok('.env.example má CHOICE_CLIENT_ID a CHOICE_CLIENT_SECRET (bez NEXT_PUBLIC_)', /^CHOICE_CLIENT_ID=$/m.test(env) && /^CHOICE_CLIENT_SECRET=$/m.test(env) && !/NEXT_PUBLIC_CHOICE/.test(env))
  ok('karta prostředí nečte (klíče a secret zná jen server)', !/process\.env|nastaveniChoice/.test(cti('app/[rozsah]/rezervace/napojeni/choice-karta.tsx')))
  ok('karta bez nastavení řekne „čeká na nastavení“ a připojit nenabídne',
    /!nastaveno \?[\s\S]*Čeká na nastavení/.test(cti('app/[rozsah]/rezervace/napojeni/choice-karta.tsx'))
    && /\{nastaveno && kPripojeni\.length > 0 \?/.test(cti('app/[rozsah]/rezervace/napojeni/choice-karta.tsx')))
  ok('stránka Napojení si přístup ověřuje sama a má čas na frontu (maxDuration 60)',
    /zkusPristupRezervacim\(/.test(cti('app/[rozsah]/rezervace/napojeni/page.tsx')) && /export const maxDuration = 60/.test(cti('app/[rozsah]/rezervace/napojeni/page.tsx')))
}

/* ===================================================================== */
console.log('\n== 9. Karta Choice (vykreslená komponenta) ==\n')
{
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const REACT = JSON.stringify(import.meta.resolve('react'))
  const Karta = (await nactiModul('app/[rozsah]/rezervace/napojeni/choice-karta.tsx', [
    ['next/link', js(`import { createElement } from ${REACT}\nexport default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }`)],
    ['../akce', js('export async function nacistChoiceTed() {}\nexport async function odpojitNapojeni() {}\nexport async function overitChoice() {}\nexport async function pripojitChoice() {}')],
    ['../../vzkazy/tlacitko-odeslat', js(`import { createElement } from ${REACT}\nexport default function T({ children, className }) { return createElement("button", { type: "submit", className }, children) }`)],
  ])).ChoiceKarta

  const P1 = { id: POBOCKA, nazev: 'Černá Perla', slug: 'cerna-perla', zona: 'Europe/Prague', zapis: true }
  const P2 = { id: 'bbbbbbbb-0000-0000-0000-000000000077', nazev: 'Bernard', slug: 'bernard', zona: 'Europe/Prague', zapis: false }
  const napojeni = (x) => ({ id: ID_PRIPOJENI, branch_id: POBOCKA, poskytovatel: 'choice', stav: 'pripojeno', nazev: 'Choice — cerna-perla.choiceqr.com',
    posledni_test_kdy: '2026-10-25T19:00:00Z', posledni_sync_kdy: '2026-10-25T19:30:00Z', posledni_sync_pocet_radku: 37, posledni_chyba: null, ...x })
  const vykreslit = (props) => renderToStaticMarkup(createElement(Karta, { rozsah: 'cerna-perla', pobocky: [P1, P2], napojeni: [], nastaveno: true, spravaPobocek: [POBOCKA, P2.id], ...props }))
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  const nenastaveno = vykreslit({ nastaveno: false })
  ok('bez klíčů na serveru: „Čeká na nastavení“ s názvy proměnných, žádné připojení',
    text(nenastaveno).includes('Čeká na nastavení') && nenastaveno.includes('CHOICE_CLIENT_ID') && !nenastaveno.includes('name="podnik"') && !text(nenastaveno).includes('Připojit podnik'))
  ok('… a nikde „Připojeno“', !text(nenastaveno).includes('Připojeno'))

  const formular = vykreslit({})
  ok('správce: formulář s adresou podniku, výběrem pobočky a tlačítkem „Připojit podnik v Choice“',
    formular.includes('name="podnik"') && formular.includes('name="pobocka"') && formular.includes('name="rozsah" value="cerna-perla"')
    && text(formular).includes('Připojit podnik v Choice') && text(formular).includes('api@choiceqr.com'))

  const pripojeno = vykreslit({ napojeni: [napojeni({})] })
  ok('připojený Choice: „Připojeno“, čas a počet posledního načtení, Načíst teď, Ověřit znovu, Odpojit',
    text(pripojeno).includes('Připojeno') && text(pripojeno).includes('naposledy načteno') && text(pripojeno).includes('37 rezervací')
    && text(pripojeno).includes('Načíst teď') && text(pripojeno).includes('Ověřit znovu') && text(pripojeno).includes('Odpojit'))
  ok('… pobočku s připojeným Choice formulář znovu nenabízí (zbyde Bernard)',
    (pripojeno.match(/<option /g) ?? []).length === 0 && pripojeno.includes(`name="pobocka" value="${P2.id}"`))

  const chyba = vykreslit({ napojeni: [napojeni({ stav: 'vyzaduje_pozornost', posledni_chyba: 'Choice odmítl přístup (401). Připojte podnik znovu.' })] })
  ok('chyba u napojení se ukáže a „Načíst teď“ ne (neověřené)', text(chyba).includes('Choice odmítl přístup (401)') && !text(chyba).includes('Načíst teď')
    && !text(chyba).includes('Připojeno') && text(chyba).includes('Vyžaduje pozornost'))

  const ceka = vykreslit({ napojeni: [napojeni({ stav: 'pripojuje_se', posledni_sync_kdy: null, posledni_test_kdy: null })] })
  ok('rozjeté připojení: „Čeká na povolení v Choice“, bez Ověřit znovu', text(ceka).includes('Čeká na povolení v Choice') && !text(ceka).includes('Ověřit znovu'))

  const obsluha = vykreslit({ napojeni: [napojeni({})], spravaPobocek: [] })
  ok('kdo jen zapisuje rezervace: Načíst teď ano, Ověřit/Odpojit/připojit ne',
    text(obsluha).includes('Načíst teď') && !text(obsluha).includes('Ověřit znovu') && !text(obsluha).includes('Odpojit') && !obsluha.includes('name="podnik"'))
  const ctenar = vykreslit({ napojeni: [napojeni({})], spravaPobocek: [], pobocky: [{ ...P1, zapis: false }] })
  ok('kdo jen čte: žádné tlačítko', !text(ctenar).includes('Načíst teď') && !ctenar.includes('<form'))

  // Celá obrazovka Napojení: karta Choice je v ní a obecné „Připravit
  // napojení“ Choice nenabízí (vlastní karta, jinak by vznikla druhá,
  // nikdy neověřitelná karta téhož systému).
  const AKCE_NAPOJENI = js([
    'nacistChoiceTed', 'odpojitNapojeni', 'overitChoice', 'pripojitChoice', 'pripravitNapojeni', 'vydatKlicPrijmuRezervaci', 'importovatSoubor',
  ].map((f) => `export async function ${f}() {}`).join('\n'))
  const NapojeniObsah = (await nactiModul('app/[rozsah]/rezervace/napojeni/obsah.tsx', [
    ['next/link', js(`import { createElement } from ${REACT}\nexport default function Link({ href, children, ...z }) { return createElement("a", { href, ...z }, children) }`)],
    ['../akce', AKCE_NAPOJENI],
    ['../prvky', js('export function HlaskaAkce() { return null }\nexport function ZalozkyRezervaci() { return null }')],
    ['../../vzkazy/tlacitko-odeslat', js(`import { createElement } from ${REACT}\nexport default function T({ children, className }) { return createElement("button", { type: "submit", className }, children) }`)],
  ])).NapojeniObsah
  const obrazovka = renderToStaticMarkup(createElement(NapojeniObsah, {
    rozsah: 'cerna-perla', pobocky: [P1], napojeni: [napojeni({})], smiSpravovat: true, spravaPobocek: [POBOCKA], choiceNastaveno: true,
    adresaPrijmu: 'https://foodtab-rizeni.vercel.app/api/rezervace/prijem',
  }))
  const vyber = obrazovka.slice(obrazovka.indexOf('name="system"'), obrazovka.indexOf('</select>', obrazovka.indexOf('name="system"')))
  ok('obrazovka Napojení má kartu Choice s připojeným podnikem', text(obrazovka).includes('Choice — rezervace načítané přímo') && text(obrazovka).includes('Choice — cerna-perla.choiceqr.com'))
  ok('„Připravit napojení“ Choice nenabízí (jiné systémy ano)', vyber.length > 0 && !vyber.includes('value="choice"') && vyber.includes('value="thefork"'))
  ok('v přehledu systémů má Choice „napojení hotové“', /Choice<\/h3>[\s\S]{0,400}napojení hotové/.test(obrazovka))
  const prime = obrazovka.slice(obrazovka.indexOf('Přímé napojení na rezervační systém'), obrazovka.indexOf('Které systémy jde napojit'))
  ok('připojený Choice se v „Přímém napojení“ neukazuje podruhé',
    prime.includes('Zatím žádné napojení') && !prime.includes('<strong>Choice</strong>') && (text(obrazovka).match(/Choice — cerna-perla\.choiceqr\.com/g) ?? []).length === 1)
}

/* ===================================================================== */
console.log('\n== 10. Každý kód hlášky má text ==\n')
{
  const prvky = cti('app/[rozsah]/rezervace/prvky.tsx')
  const hlasky = prvky.slice(prvky.indexOf('export function HlaskaAkce'))
  const kody = new Set()
  for (const f of ['app/[rozsah]/rezervace/akce.ts', 'app/api/rezervace/choice/callback/route.ts']) {
    for (const m of cti(f).matchAll(/'(choice-[a-z-]+)'/g)) kody.add(m[1])
    for (const m of cti(f).matchAll(/\?\s*'(choice-[a-z-]+)'\s*:\s*'(choice-[a-z-]+)'/g)) { kody.add(m[1]); kody.add(m[2]) }
  }
  ok(`našly se kódy hlášek Choice (${kody.size})`, kody.size >= 15)
  const bezTextu = [...kody].filter((k) => !hlasky.includes(`'${k}':`))
  ok(`každý kód z akcí a callbacku má v HlaskaAkce text${bezTextu.length ? ' — chybí: ' + bezTextu.join(', ') : ''}`, bezTextu.length === 0)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
