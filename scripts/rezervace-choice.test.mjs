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
 *   6a. souběh ve virtuálním čase (plánovač událostí, skutečný server):
 *      tlačítka vedle běžící úlohy téže i jiné firmy, callback během
 *      prvního načtení téže firmy, třetí tlačítko vedle dvou běhů,
 *      souběžné kliky jedné i mnoha firem (migrace 20261102100000),
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
  poradiSynchronizace,
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

  // Odkaz přesně v tvaru, jaký 25. 10. vygeneroval dashboard Choice
  // (choice-docs/ZJISTENO-pripojeni-podniku.md) — bez customAttribute.
  const Z_CHOICE = `https://cernaperlatabor.choiceqr.com/admin/open-api/connect?clientId=klient&redirectUrl=${encodeURIComponent(CALLBACK)}&scope=all&response_type=code&digit=8378`
  const rozebrat = (vstup) => rozebratPodnik(vstup, 'klient', CALLBACK)
  const dobre = (vstup, sub, digit) => {
    const r = rozebrat(vstup)
    return r.stav === 'ok' && r.podnik.subdomena === sub && r.podnik.digit === digit
  }
  ok('odkaz z dashboardu Choice → podnik a digit', dobre(Z_CHOICE, 'cernaperlatabor', '8378'))
  ok('… i bez https:// a s customAttribute z dokumentace',
    dobre(Z_CHOICE.replace('https://', ''), 'cernaperlatabor', '8378')
    && dobre('https://cerna-perla.choiceqr.com/admin/open-api/connect?clientId=klient&redirectUrl=x&customAttribute=1&scope=all&response_type=code&digit=9202'.replace('redirectUrl=x', `redirectUrl=${encodeURIComponent(CALLBACK)}`), 'cerna-perla', '9202'))
  const bezOdkazu = (vstup) => { const r = rozebrat(vstup); return r.stav === 'chyba' && r.kod === 'bez-odkazu' }
  ok('JEN ADRESA PODNIKU NESTAČÍ (digit přiděluje Choice) → „vložte celý odkaz“',
    bezOdkazu('cernaperlatabor') && bezOdkazu('cernaperlatabor.choiceqr.com') && bezOdkazu('https://cernaperlatabor.choiceqr.com')
    && bezOdkazu('https://mojerestaurace.choiceqr.com/menu') && bezOdkazu('  '))
  ok('… ani odkaz na připojení bez digit', bezOdkazu(Z_CHOICE.replace('&digit=8378', '')) && bezOdkazu(Z_CHOICE.replace('digit=8378', 'digit=')))
  ok('… a hláška říká proč a kde odkaz vzít', /celý odkaz/.test(rozebrat('cernaperlatabor').duvod) && /Connect/.test(rozebrat('cernaperlatabor').duvod))
  const spatne = (vstup) => rozebrat(vstup).stav === 'chyba'
  ok('cizí doména se odmítne', spatne(Z_CHOICE.replace('cernaperlatabor.choiceqr.com', 'evil.example.com'))
    && spatne(Z_CHOICE.replace('cernaperlatabor.choiceqr.com', 'cernaperlatabor.choiceqr.com.evil.com')))
  ok('vnořená subdoména, jméno a heslo v adrese, port se odmítnou',
    spatne(Z_CHOICE.replace('cernaperlatabor.', 'a.b.')) && spatne(Z_CHOICE.replace('https://', 'https://jmeno:heslo@'))
    && spatne(Z_CHOICE.replace('choiceqr.com/', 'choiceqr.com:8443/')))
  ok('open-api a www nejsou podniky', spatne(Z_CHOICE.replace('cernaperlatabor.', 'open-api.')) && spatne(Z_CHOICE.replace('cernaperlatabor.', 'www.')))
  const jinaAplikace = rozebrat(Z_CHOICE.replace('clientId=klient', 'clientId=jiny'))
  ok('odkaz pro jinou aplikaci se odmítne s důvodem', jinaAplikace.stav === 'chyba' && jinaAplikace.kod === 'aplikace' && /jinou aplikaci/.test(jinaAplikace.duvod))
  ok('odkaz bez clientId se odmítne', spatne(Z_CHOICE.replace('clientId=klient&', '')))
  const jinyNavrat = rozebrat(Z_CHOICE.replace(encodeURIComponent(CALLBACK), encodeURIComponent('https://evil.example.com/cb')))
  ok('odkaz, který vrací jinam než na callback Foodtabu, se odmítne', jinyNavrat.stav === 'chyba' && jinyNavrat.kod === 'callback')
  ok('digit, který není číslo, se odmítne', spatne(Z_CHOICE.replace('digit=8378', 'digit=1;drop')))
  ok('response_type jiný než code se odmítne', spatne(Z_CHOICE.replace('response_type=code', 'response_type=token')))

  const odkaz = new URL(odkazPripojeni({ podnik: { subdomena: 'cerna-perla', digit: '9202' }, clientId: 'klient', redirectUrl: CALLBACK, pokus: 'POKUS' }))
  ok('odkaz míří na stránku připojení podniku v Choice',
    odkaz.origin === 'https://cerna-perla.choiceqr.com' && odkaz.pathname === '/admin/open-api/connect')
  ok('… se všemi parametry z dokumentace (clientId, redirectUrl, customAttribute, scope=all, response_type=code, digit)',
    odkaz.searchParams.get('clientId') === 'klient' && odkaz.searchParams.get('redirectUrl') === CALLBACK
    && odkaz.searchParams.get('customAttribute') === 'POKUS' && odkaz.searchParams.get('scope') === 'all'
    && odkaz.searchParams.get('response_type') === 'code' && odkaz.searchParams.get('digit') === '9202')
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
  ok('400 → chyba v datech a kód z textu od Choice zmizí', e1.stav === 'chyba' && e1.druh === 'data' && !e1.duvod.includes('KOD-TAJNY') && !JSON.stringify(e1).includes('KOD-TAJNY'))
  ok('… ale co Choice napsal, se ukáže (kód nahrazený „…“)', e1.duvod.includes('code … is invalid'))
  // 26. 10. 2026 v produkci: Choice na výměnu odpověděl 400 „Invalid credentials“ a obecná hláška to schovala.
  const neplatne = await vytvoritChoice(sit([odpoved(400, { error: true, name: 'ApplicationError', message: 'Invalid credentials', statusCode: 400 })]).fetchFn).vymenitKod({ code: 'K-9', clientId: 'k', secret: 's' })
  ok('400 Invalid credentials → text od Choice a rada: CHOICE_CLIENT_SECRET, Redeploy, nový odkaz', neplatne.stav === 'chyba' && neplatne.druh === 'data' && neplatne.duvod.includes('Invalid credentials') && /CHOICE_CLIENT_SECRET/.test(neplatne.duvod) && /Redeploy/.test(neplatne.duvod) && /novým odkazem/.test(neplatne.duvod))
  const prazdny = await vytvoritChoice(sit([odpoved(400, { error: true, message: 'Invalid credentials' })]).fetchFn).vymenitKod({ code: '', clientId: 'k', secret: 's' })
  ok('prázdný kód text od Choice nerozseká', prazdny.stav === 'chyba' && prazdny.duvod.includes('(400: Invalid credentials)'))
  const propadly = await vytvoritChoice(sit([odpoved(400, { error: true, message: 'expired' })]).fetchFn).vymenitKod({ code: 'K-1', clientId: 'k', secret: 's' })
  ok('jiný důvod (expired) → rada „kód platí jen jednou“, ne secret', propadly.stav === 'chyba' && propadly.duvod.includes('expired') && /jen jednou/.test(propadly.duvod) && !/CHOICE_CLIENT_SECRET/.test(propadly.duvod))
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

/**
 * Virtuální hodiny + fronta se stejnou aritmetikou jako migrace
 * 20261102100000 (SKUTEČNÉ funkce zkouší krok105 nad databází):
 *   * `zabrat` = rezervace_choice_zabrat_dotaz (tlačítka): rozestup pro
 *     celou instalaci, firma nejvýš jeden zabraný dotaz, který ještě
 *     neodešel; když nic, ZÁPORNĚ za kolik ms to zkusit znovu (≤ -2),
 *   * `zabratUlohou` = rezervace_choice_zabrat_dotaz_ulohy: společná
 *     fronta bez pravidla firmy; když se nevejde, null.
 */
function hodinyAFronta(start) {
  // `overeni`: odstup „Ověřit znovu“ po připojeních (rezervace_choice_zabrat_overeni).
  const h = { ted: start, dalsi: -Infinity, firmy: new Map(), overeni: new Map() }
  h.zabrat = (rozestup, nejdele, firma) => {
    const zabrano = h.firmy.get(firma) ?? -Infinity
    const slot = Math.max(h.ted, h.dalsi)
    const firmaZabrana = zabrano > h.ted
    const daleko = slot > h.ted + nejdele
    if (firmaZabrana || daleko) {
      const znovu = Math.max(firmaZabrana ? zabrano : -Infinity, daleko ? h.dalsi - nejdele : -Infinity)
      return -Math.max(2, Math.ceil(znovu - h.ted))
    }
    h.dalsi = slot + rozestup
    h.firmy.set(firma, slot)
    return slot - h.ted
  }
  h.zabratUlohou = (rozestup, nejdele) => {
    const slot = Math.max(h.ted, h.dalsi)
    if (slot > h.ted + nejdele) return null
    h.dalsi = slot + rozestup
    return slot - h.ted
  }
  // Nejdál, kam kdy tlačítka posunula frontu před „teď“ (oddíl 6a).
  h.nejdalTlacitka = 0
  return h
}

/**
 * Funkce fronty v podstrčené databázi — stejné pro všechny světy testu.
 * `uloha: false` = databáze před migrací 20261102100000 (funkce úlohy
 * chybí, tlačítka dostávají NULL místo „zkusit znovu“).
 */
function funkceFronty(db, h, { uloha = true, overeni = 'ano' } = {}) {
  // Jako SQL: bez firmy 22023 (funkce dotaz bez firmy odmítne).
  const bezFirmy = { data: null, error: { code: '22023', message: 'Dotaz na Choice musí patřit firmě.' } }
  const tlacitko = (rozestup, nejdele, firma) => {
    const c = h.zabrat(rozestup, nejdele, firma)
    if (c >= 0) h.nejdalTlacitka = Math.max(h.nejdalTlacitka, h.dalsi - h.ted)
    return uloha || c >= 0 ? c : null
  }
  db.rpc.rezervace_choice_zabrat_dotaz = ({ p_tenant, p_rozestup_ms, p_nejdele_cekat_ms }) => (typeof p_tenant !== 'string' || !p_tenant
    ? bezFirmy
    : { data: tlacitko(p_rozestup_ms, p_nejdele_cekat_ms, p_tenant), error: null })
  if (uloha) {
    db.rpc.rezervace_choice_zabrat_dotaz_ulohy = ({ p_rozestup_ms, p_nejdele_cekat_ms, ...navic }) => (Object.keys(navic).length
      ? { data: null, error: { code: 'PGRST202', message: 'funkce s takovými parametry není' } }
      : { data: h.zabratUlohou(p_rozestup_ms, p_nejdele_cekat_ms), error: null })
  }
  if (overeni === 'ano') {
    // Jako SQL: odstup a dotaz ve frontě NARÁZ. -1 = v odstupu (fronty se
    // nedotkne), záporné ≤ -2 = do fronty se nevešel (odstup se
    // nespotřeboval, zkusit znovu za |n| ms), jinak ms do odchodu testu.
    db.rpc.rezervace_choice_zabrat_overeni = ({ p_pripojeni, p_tenant, p_odstup_ms, p_rozestup_ms, p_nejdele_cekat_ms }) => {
      if (typeof p_pripojeni !== 'string' || !p_pripojeni) return { data: null, error: { code: '22023', message: 'Ověření Choice musí patřit připojení.' } }
      if (typeof p_tenant !== 'string' || !p_tenant) return bezFirmy
      const naposledy = h.overeni.get(p_pripojeni)
      if (naposledy !== undefined && naposledy > h.ted - p_odstup_ms) return { data: -1, error: null }
      const cekat = tlacitko(p_rozestup_ms, p_nejdele_cekat_ms, p_tenant)
      if (cekat === null || cekat < 0) return { data: cekat, error: null }
      h.overeni.set(p_pripojeni, h.ted)
      return { data: cekat, error: null }
    }
  } else if (overeni === 'chyba') {
    db.rpc.rezervace_choice_zabrat_overeni = () => ({ data: null, error: { code: 'XX000', message: 'odstup spadl' } })
  }
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
    const c = h.zabratUlohou(ROZESTUP_DOTAZU_MS, 120_000)
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
    const c = h.zabratUlohou(ROZESTUP_DOTAZU_MS, nejdele)
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
    pockatNaDotaz: async () => { const c = h.zabratUlohou(ROZESTUP_DOTAZU_MS, 120_000); h.ted += c ?? 0; return c !== null }, zapsat: z.fn })
  const okno2 = ch.zaznam.slice(pocetPred).filter((d) => d.podle === 'bookingDt' && d.od === h.oknoOd)
  ok('příští běh pokračuje stejným oknem od stránky 3 až do konce', okno2.map((d) => d.stranka).join(',') === '3,4,5,6,7' && v2.konec === 'hotovo')
  ok('… a „nové“ hledá od minulého běhu (s 15min překryvem)',
    ch.zaznam.slice(pocetPred).find((d) => d.podle === 'createdDt')?.od === new Date(DALSI - 15 * 60_000 - 15 * 60_000).toISOString())

  const stary = precistKurzor({ okno: { od: h.oknoOd, do: '2027-04-23T18:00:00.000Z', stranka: 4, zahajeno: new Date(START - 13 * 3600_000).toISOString() } })
  const h3 = hodinyAFronta(START)
  h3.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch3 = choiceSRezervacemi({ okno: 50 }, h3)
  await probehnoutChoice({ api: ch3.api, token: TOKEN, varSymbol: '1', kurzor: stary, tedMs: START,
    pockatNaDotaz: async () => { const c = h3.zabratUlohou(ROZESTUP_DOTAZU_MS, 120_000); h3.ted += c ?? 0; return c !== null }, zapsat: zapisDoPameti().fn })
  ok('okno rozjeté před víc než 12 h se začne znovu od stránky 1', ch3.zaznam.at(-1).stranka === 1 && ch3.zaznam.at(-1).od === h3.oknoOd)
  ok('nečitelný kurzor se zahodí', JSON.stringify(precistKurzor({ okno: { stranka: 'x' }, nove_od: 'včera' })) === '{}')
}

{
  // 429 uprostřed: konec běhu, žádný další dotaz, stránka se neposune.
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  h.oknoOd = new Date(START - OKNO_ZPET_MS).toISOString()
  const ch = choiceSRezervacemi({ okno: 300, chyby: { 4: { stav: 'chyba', druh: 'limit', duvod: 'Choice omezil počet dotazů (429).', http: 429 } } }, h)
  const pockat = async () => { const c = h.zabratUlohou(ROZESTUP_DOTAZU_MS, 120_000); h.ted += c ?? 0; return c !== null }
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
  // Chybějící sloupec je v databázi NULL (`not … is null` ho nepustí).
  const sedi = (radek, filtry) => filtry.every(([op, s, v]) =>
    op === 'eq' ? hodnota(radek, s) === v : op === 'neq' ? hodnota(radek, s) !== v : op === 'is' ? hodnota(radek, s) === v
      : op === 'not-is' ? (hodnota(radek, s) ?? null) !== v : (() => { throw new Error(`podstrčená databáze neumí filtr ${op}`) })())
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
      not: (s, op, v) => (q.filtry.push([`not-${op}`, s, v]), b),
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

/**
 * Svět pro synchronizaci: databáze, fronta se stejnou aritmetikou jako SQL, Choice s rezervacemi, virtuální hodiny.
 * `fronta: false` = databáze bez front vůbec (před 20261031100000), `uloha: false` = před 20261102100000.
 */
function svetSynchronizace({ pripojeniRadky, sifry = { [ID_PRIPOJENI]: 'sifra-ok' }, choice = () => odpoved(200, []), fronta = true, uloha = true, overeni = fronta ? 'ano' : 'ne', zapis } = {}) {
  const START = Date.UTC(2026, 9, 25, 18, 0, 0)
  const h = hodinyAFronta(START)
  const db = databaze({
    integrace_pripojeni: pripojeniRadky ?? [pripojeni(ID_PRIPOJENI)],
    integrace_tajemstvi: Object.entries(sifry).map(([pripojeni_id, sifra]) => ({ pripojeni_id, sifra })),
    synchronizace_behy: [],
  }, () => h.ted)
  if (fronta) funkceFronty(db, h, { uloha, overeni })
  else if (overeni === 'chyba') db.rpc.rezervace_choice_zabrat_overeni = () => ({ data: null, error: { code: 'XX000', message: 'odstup spadl' } })
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
  ok('rozestup chce fronta 5,5 s (nikdy pod 5 s) a za firmu připojení', s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_dotaz')
    .every((r) => r.args.p_rozestup_ms === 5500 && r.args.p_tenant === FIRMA))
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
  const t = await SYNC.otestovatToken(TOKEN, FIRMA, s.START + 57_000, s.prostredi)
  ok('živý test: fronta, pak GET ?page=1&perPage=1', t.stav === 'ok' && s.dotazy.length === 1 && s.dotazy[0].frontaPred === 1 && s.dotazy[0].url === ADRESA_TESTU)
  const bez = svetSynchronizace({ fronta: false })
  const t2 = await SYNC.otestovatToken(TOKEN, FIRMA, bez.START + 57_000, bez.prostredi)
  ok('… bez fronty v databázi se netestuje vůbec (žádný dotaz)', t2.stav === 'chyba' && t2.druh === 'fronta' && bez.dotazy.length === 0)
  const s3 = svetSynchronizace({ choice: () => odpoved(401, {}) })
  const t3 = await SYNC.otestovatToken(TOKEN, FIRMA, s3.START + 57_000, s3.prostredi)
  ok('… 401 → přístup', t3.stav === 'chyba' && t3.druh === 'pristup')
}

const CIZI_FIRMA = 'eeeeeeee-0000-0000-0000-000000000009'

/* Souběžné kliky (osm „Ověřit znovu“ jedné firmy, šest firem naráz) se
   od migrace 20261102100000 zkoušejí v oddílu 6a v plánovači
   virtuálního času: tlačítko, které se nevejde, jednou počká a zkusí to
   znovu, a to sdílené hodiny bez plánovače neumí. */
const firmaKliku = (i) => `f${i}ffffff-0000-0000-0000-000000000000`
const zabraniFronty = (s) => s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_dotaz')
const zabraniUlohy = (s) => s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_dotaz_ulohy')
const zabraniOvereni = (s) => s.db.rpcVolani.filter((r) => r.jmeno === 'rezervace_choice_zabrat_overeni')
const TRI_ROZESTUPY = 3 * ROZESTUP_DOTAZU_MS
/** Tlačítko (callback, Ověřit znovu, Načíst teď) chce frontu za firmu, nejvýš dva rozestupy, a vstup úlohy nepoužije. */
const jakoTlacitko = (s, firma = FIRMA) => [...zabraniFronty(s), ...zabraniOvereni(s)].length > 0
  && [...zabraniFronty(s), ...zabraniOvereni(s)].every((r) => r.args.p_tenant === firma && r.args.p_nejdele_cekat_ms <= 2 * ROZESTUP_DOTAZU_MS)
  && zabraniUlohy(s).length === 0

{
  /* Nezávislé ověření 26. 10.: se stropem JEDEN rozestup se tlačítko
     nevešlo do fronty ani vedle JEDINÉHO běžícího načítání jiné firmy.
     Běh (úloha) si další dotaz zabírá hned po odpovědi na předchozí, tedy
     o rozestup dopředu — fronta je pak volná až za ~11 s minus doba
     odpovědi. Prošlo jen 9–36 % okamžiků: callback po připojení skončil
     „ověřit později“ (připojení zůstalo neověřené), „Ověřit znovu“ i
     „Načíst teď“ hlásily „zkuste za chvíli“. Tady se každé tlačítko
     pustí v KAŽDÉ fázi cyklu takového běhu (krok 100 ms přes celý
     rozestup, různé doby odpovědi) a musí projít vždy.

     Nezávislé ověření po sloučení #162: strop u callbacku
     (otestovatToken) nehlídalo nic — se „čekej jako úloha“ by test
     prošel taky. Proto u KAŽDÉHO tlačítka i to, s čím se do fronty
     ptá: za firmu, nejvýš dva rozestupy, nikdy vstupem úlohy. */
  const ROZ = ROZESTUP_DOTAZU_MS
  const neproslo = { 'callback (test tokenu)': [], 'Ověřit znovu': [], 'Načíst teď': [] }
  const necekaloJakoTlacitko = { 'callback (test tokenu)': [], 'Ověřit znovu': [], 'Načíst teď': [] }
  let pokusu = 0
  for (const odpovedMs of [250, 1_000, 2_500, 5_000]) {
    for (let faze = 0; faze < ROZ; faze += 100) {
      for (const druh of Object.keys(neproslo)) {
        const s = svetSynchronizace({ choice: () => odpoved(200, []) })
        // Běh cizí firmy: dotaz v START, odpověď a zápis za `odpovedMs`,
        // hned další zabrání (slot START + ROZ, fronta volná až START + 2·ROZ).
        // Fáze `faze` ms po jeho dotazu; další zabírá až v START + ROZ + odpovedMs.
        s.h.zabratUlohou(ROZ, 120_000)
        if (faze >= odpovedMs) {
          s.h.ted = s.START + odpovedMs
          s.h.zabratUlohou(ROZ, 120_000)
        }
        s.h.ted = s.START + faze
        let proslo
        if (druh === 'callback (test tokenu)') {
          const t = await SYNC.otestovatToken(TOKEN, FIRMA, s.h.ted + 57_000, s.prostredi)
          proslo = t.stav === 'ok'
        } else if (druh === 'Ověřit znovu') {
          const t = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.h.ted + 50_000, s.prostredi)
          proslo = t !== 'brzy' && t.stav === 'ok'
        } else {
          const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.h.ted + 50_000, nejmeneOdMinulehoMs: 60_000, prostredi: s.prostredi })
          proslo = v.dotazu > 0
        }
        pokusu++
        if (!proslo || s.dotazy.length === 0) neproslo[druh].push(`${odpovedMs}/${faze}`)
        if (!jakoTlacitko(s)) necekaloJakoTlacitko[druh].push(`${odpovedMs}/${faze}`)
      }
    }
  }
  for (const [druh, kde] of Object.entries(neproslo)) {
    ok(`vedle JEDNOHO běžícího načítání jiné firmy projde ${druh} ve VŠECH fázích jeho cyklu (${pokusu / 3} okamžiků; neprošlo ${kde.length}${kde.length ? ', např. odpověď/fáze ' + kde.slice(0, 3).join(', ') + ' ms' : ''})`,
      kde.length === 0)
    const jinak = necekaloJakoTlacitko[druh]
    ok(`… ${druh} se do fronty ptá jako tlačítko: za firmu, čekat nejvýš dva rozestupy, ne vstupem úlohy (jinak ${jinak.length}×)`,
      jinak.length === 0)
  }
}

{
  // Živý test tokenu: dotaz odejde nejpozději REZERVA (20 s) před tvrdým
  // koncem — Choice má na odpověď 15 s a po ní se ještě zapisuje výsledek
  // (callback: konec = začátek + 57 s, „Ověřit znovu“: + 50 s). Čísla
  // natvrdo, ne z konstanty: hlídá se i REZERVA_DOTAZU_MS = 0.
  const s = svetSynchronizace({ choice: () => odpoved(200, []) })
  s.h.dalsi = s.START + 4_000
  const t = await SYNC.otestovatToken(TOKEN, FIRMA, s.START + 22_000, s.prostredi)
  ok('živý test: fronta volná až 18 s před tvrdým koncem → na Choice NEJDE („zkuste za chvíli“), žádný dotaz bez rezervy',
    t.stav === 'chyba' && t.druh === 'cas' && s.dotazy.length === 0)
  const s2 = svetSynchronizace({ choice: () => odpoved(200, []) })
  s2.h.dalsi = s2.START + 1_000
  const t2 = await SYNC.otestovatToken(TOKEN, FIRMA, s2.START + 22_000, s2.prostredi)
  ok(`… volná 21 s před koncem → test proběhne (dotaz v ${s2.dotazy[0] ? (s2.dotazy[0].cas - s2.START) / 1000 : '—'} s, konec ve 22 s)`,
    t2.stav === 'ok' && s2.dotazy.length === 1 && s2.dotazy[0].cas <= s2.START + 22_000 - 20_000)

  /* Nezávislé ověření PR #163 (nález 5): totéž u „Ověřit znovu“, a to po
     OPAKOVÁNÍ. overitZnovu má vlastní smyčku opakování; kdyby strop
     čekání spočítala jen jednou před ní, druhé volání by databázi poslalo
     starý strop (2 s) a test by odešel až po čekání — za hranicí 20 s
     před koncem. Kontrola výš to u overitZnovu nevidí (jde přes
     otestovatToken). Tady: fronta volná až 18 s před koncem → databáze
     řekne „znovu za 2 s“, server počká a podruhé smí čekat už jen 0 ms →
     na Choice nejde. */
  const s3 = svetSynchronizace({ choice: () => odpoved(200, []) })
  s3.h.dalsi = s3.START + 4_000
  const t3 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s3.START + 22_000, s3.prostredi)
  const stropy = zabraniOvereni(s3).map((r) => r.args.p_nejdele_cekat_ms)
  ok(`„Ověřit znovu“ dostane „zkusit znovu“, počká a po čekání už na Choice NEJDE (strop při 1. a 2. volání: ${stropy.join(' a ')} ms; dotazů ${s3.dotazy.length})`,
    t3 !== 'brzy' && t3.stav === 'chyba' && t3.druh === 'cas' && s3.dotazy.length === 0
    && stropy.length === 2 && stropy[0] === 2_000 && stropy[1] === 0)
  const s4 = svetSynchronizace({ choice: () => odpoved(200, []) })
  s4.h.dalsi = s4.START + 1_000
  const t4 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s4.START + 22_000, s4.prostredi)
  ok(`… volná 21 s před koncem → „Ověřit znovu“ proběhne (dotaz v ${s4.dotazy[0] ? (s4.dotazy[0].cas - s4.START) / 1000 : '—'} s)`,
    t4 !== 'brzy' && t4.stav === 'ok' && s4.dotazy.length === 1 && s4.dotazy[0].cas <= s4.START + 22_000 - 20_000)
}

{
  // „Ověřit znovu“ na připojení nejvýš jednou za minutu — odstup drží
  // databáze (rezervace_choice_zabrat_overeni), ne registr; odstup
  // a dotaz ve frontě rozhoduje JEDNÍM voláním.
  const s = svetSynchronizace({ choice: () => odpoved(200, []) })
  const t1 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.START + 50_000, s.prostredi)
  const frontaPo1 = { dalsi: s.h.dalsi, firmy: JSON.stringify([...s.h.firmy]) }
  const t2 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.h.ted + 50_000, s.prostredi)
  ok('„Ověřit znovu“: první test proběhne', t1 !== 'brzy' && t1.stav === 'ok' && s.dotazy.length === 1)
  ok('… druhé hned po něm → „brzy“: fronta ani Choice se nedotkly',
    t2 === 'brzy' && s.dotazy.length === 1 && s.h.dalsi === frontaPo1.dalsi && JSON.stringify([...s.h.firmy]) === frontaPo1.firmy)
  s.h.ted += 61_000
  const t3 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.h.ted + 50_000, s.prostredi)
  ok('… po minutě zase proběhne', t3 !== 'brzy' && t3.stav === 'ok' && s.dotazy.length === 2)
  ok('odstup i dotaz jedním voláním databáze: za připojení a jeho firmu, na minutu, tlačítko čeká nejvýš 11 s',
    zabraniOvereni(s).length === 3 && zabraniOvereni(s).every((r) => r.args.p_pripojeni === ID_PRIPOJENI && r.args.p_tenant === FIRMA
      && r.args.p_odstup_ms === 60_000 && r.args.p_rozestup_ms === ROZESTUP_DOTAZU_MS && r.args.p_nejdele_cekat_ms <= 2 * ROZESTUP_DOTAZU_MS))
  ok('… a fronta zvlášť se nezabírá (nic mimo odstup)', zabraniFronty(s).length === 0)
  const bez = svetSynchronizace({ fronta: false })
  const t4 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, bez.START + 50_000, bez.prostredi)
  ok('bez funkcí v databázi (před migrací) se netestuje: „čeká na migraci“, žádný dotaz',
    t4 !== 'brzy' && t4.stav === 'chyba' && t4.druh === 'fronta' && /20261031100000/.test(t4.duvod) && bez.dotazy.length === 0)
}

{
  /* Nezávislé ověření 26. 10.: dosavadní kontrola „bez funkce odstupu se
     netestuje“ brala svět BEZ fronty i bez odstupu — „při chybě odstupu
     otestuj stejně“ (fail-open) pak prošlo, protože selhala i fronta.
     Tady fronta JE, chybí (nebo padá) jen odstup: nesmí se zabrat nic
     ve frontě a na Choice nesmí odejít nic. */
  for (const [overeni, popis, hlaska] of [['ne', 'chybí (před migrací)', /20261031100000/], ['chyba', 'padá (500)', /selhala/]]) {
    const s = svetSynchronizace({ choice: () => odpoved(200, []), overeni })
    const t = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.START + 50_000, s.prostredi)
    ok(`fronta v databázi je, funkce odstupu ${popis} → chyba fronty, ŽÁDNÉ zabrání fronty ani dotaz na Choice`,
      t !== 'brzy' && t.stav === 'chyba' && t.druh === 'fronta' && hlaska.test(t.duvod)
      && zabraniOvereni(s).length === 1 && zabraniFronty(s).length === 0 && s.h.dalsi === -Infinity && s.dotazy.length === 0)
  }
}

{
  /* Nezávislé ověření 26. 10.: odstup se dřív zabíral PŘED frontou a zvlášť.
     Když se dotaz do fronty nevešel, minuta propadla bez jediného dotazu
     a další klik dostal „ověřovalo se před chvílí“. */
  const s = svetSynchronizace({ choice: () => odpoved(200, []) })
  s.h.dalsi = s.START + 30_000 // fronta zabraná na 30 s dopředu (víc běhů naráz)
  const t1 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.START + 50_000, s.prostredi)
  ok('„Ověřit znovu“ při plné frontě → „zkuste za chvíli“, žádný dotaz', t1 !== 'brzy' && t1.stav === 'chyba' && t1.druh === 'cas' && s.dotazy.length === 0)
  s.h.dalsi = -Infinity
  s.h.ted += 2_000
  const t2 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, s.h.ted + 50_000, s.prostredi)
  ok(`… o 2 s později s volnou frontou proběhne — odstup se nespotřeboval (${t2 === 'brzy' ? '„brzy“' : t2.stav})`,
    t2 !== 'brzy' && t2.stav === 'ok' && s.dotazy.length === 1)
  const pozde = svetSynchronizace({ choice: () => odpoved(200, []) })
  const t3 = await SYNC.overitZnovu(TOKEN, FIRMA, ID_PRIPOJENI, pozde.START + 19_000, pozde.prostredi)
  ok('… a když už dotaz odejít nesmí (méně než 20 s do konce), do databáze se vůbec nejde',
    t3 !== 'brzy' && t3.stav === 'chyba' && t3.druh === 'cas' && zabraniOvereni(pozde).length === 0 && pozde.dotazy.length === 0)
}

{
  /* Nezávislé ověření 26. 10.: „Načíst teď“, které se do fronty nevešlo
     (0 dotazů), zapsalo běh — a podle něj pořadí úlohy
     (`choiceKSynchronizaci`) připojení odsunulo na konec, jako by se
     právě načetlo. Běh bez dotazu teď pořadí nepočítá. */
  const DRUHE = '99999999-2222-3333-4444-555555555555'
  const s = svetSynchronizace({
    pripojeniRadky: [pripojeni(ID_PRIPOJENI), pripojeni(DRUHE, { tenant_id: CIZI_FIRMA, branch_id: 'bbbbbbbb-0000-0000-0000-000000000098', externi_ucet: { var_symbol: '777' } })],
    sifry: { [ID_PRIPOJENI]: 'sifra-ok', [DRUHE]: 'sifra-ok-2' },
  })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  s.h.ted += 120_000
  await SYNC.synchronizovatChoice(DRUHE, { konecMs: s.h.ted + 57_000, prostredi: s.prostredi })
  ok('výchozí pořadí: dřív načtené připojení první', JSON.stringify(await SYNC.choiceKSynchronizaci()) === JSON.stringify([ID_PRIPOJENI, DRUHE]))
  s.h.ted += 120_000
  s.h.dalsi = s.h.ted + 60_000 // fronta plná
  const dotazuPred = s.dotazy.length
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.h.ted + 50_000, nejmeneOdMinulehoMs: 60_000, prostredi: s.prostredi })
  ok('„Načíst teď“ při plné frontě: 0 dotazů, „pokračuje“', v.dotazu === 0 && v.pokracovani && s.dotazy.length === dotazuPred)
  const poradi = await SYNC.choiceKSynchronizaci()
  ok(`… a připojení v pořadí úlohy NEODSUNULO — pořád první (${poradi.map((id) => (id === ID_PRIPOJENI ? 'tohle' : 'druhé')).join(', ')})`,
    JSON.stringify(poradi) === JSON.stringify([ID_PRIPOJENI, DRUHE]))
  const behy = s.db.tabulky.synchronizace_behy.filter((b) => b.integrace_pripojeni_id === ID_PRIPOJENI)
  ok('… běh bez dotazu je dokončený (zámek uvolněný) s prázdným počtem nových řádků; běh s dotazy má počet',
    behy.length === 2 && behy[1].stav === 'hotovo' && behy[1].pocet_novych_radku === null && typeof behy[0].pocet_novych_radku === 'number')
  const hned = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.h.ted + 50_000, nejmeneOdMinulehoMs: 60_000, prostredi: s.prostredi })
  ok('… minutový odstup „Načíst teď“ ho počítá dál (hned znovu → přeskočeno)', hned.stav === 'preskoceno')
}

{
  // „Tentýž podnik jinde“ se ptá pod service_role (bez RLS) — firmu musí
  // odfiltrovat sám dotaz. Spuštěním, ne čtením textu.
  const DRUHE = '99999999-2222-3333-4444-555555555555'
  const TRETI = '88888888-2222-3333-4444-555555555555'
  const s = svetSynchronizace({ pripojeniRadky: [
    pripojeni(ID_PRIPOJENI),
    pripojeni(DRUHE, { tenant_id: CIZI_FIRMA, branch_id: 'bbbbbbbb-0000-0000-0000-000000000098', externi_ucet: { var_symbol: '777' } }),
  ] })
  ok('tentýž podnik Choice u JINÉ firmy → ne (o cizí firmě se nic nedozví a připojit jde)',
    (await SYNC.jinePripojeniTehozPodniku(FIRMA, ID_PRIPOJENI, '777')) === false)
  s.db.tabulky.integrace_pripojeni.push(pripojeni(TRETI, { branch_id: 'bbbbbbbb-0000-0000-0000-000000000097', externi_ucet: { var_symbol: '777' } }))
  ok('… u jiné pobočky TÉŽE firmy → ano', (await SYNC.jinePripojeniTehozPodniku(FIRMA, ID_PRIPOJENI, '777')) === true)
  s.db.tabulky.integrace_pripojeni.at(-1).odpojeno_kdy = '2026-10-25T10:00:00Z'
  ok('… odpojené se nepočítá', (await SYNC.jinePripojeniTehozPodniku(FIRMA, ID_PRIPOJENI, '777')) === false)
}

{
  // Zaseknutý běh (Vercel funkci ukončil uprostřed) nesmí připojení zamknout navždy.
  const s = svetSynchronizace({ choice: () => odpoved(200, []) })
  const stary = { id: 'stary', tenant_id: FIRMA, integrace_pripojeni_id: ID_PRIPOJENI, stav: 'bezi', zahajeno_kdy: new Date(s.START - 11 * 60_000).toISOString() }
  s.db.tabulky.synchronizace_behy.push(stary)
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  ok('běh „běží“ starší než 10 minut se uzavře jako chyba (timeout) a načítání proběhne',
    v.stav === 'ok' && s.dotazy.length > 0 && stary.stav === 'chyba' && /timeout/.test(stary.chyba ?? ''))
  const s2 = svetSynchronizace({ choice: () => odpoved(200, []) })
  s2.db.tabulky.synchronizace_behy.push({ id: 'cerstvy', tenant_id: FIRMA, integrace_pripojeni_id: ID_PRIPOJENI, stav: 'bezi', zahajeno_kdy: new Date(s2.START - 5 * 60_000).toISOString() })
  const v2 = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s2.START + 57_000, prostredi: s2.prostredi })
  ok('… běh starý 5 minut ještě běží → přeskočeno, žádný dotaz', v2.stav === 'preskoceno' && s2.dotazy.length === 0)
}

{
  // Rezerva na poslední dotaz a zápis: velký podnik (okno pořád plné)
  // se v jednom běhu nenačte celý — běh musí skončit včas.
  const plneOkno = (url) => {
    const u = new URL(url)
    const okno = u.searchParams.get('periodField') === 'bookingDt' && u.searchParams.get('till') > '2027'
    return odpoved(200, okno ? Array.from({ length: 100 }, (_, i) => rezervace(Number(u.searchParams.get('page')) * 1000 + i)) : [])
  }
  const s = svetSynchronizace({ choice: plneOkno })
  const v = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s.START + 57_000, prostredi: s.prostredi })
  ok(`velké okno: běh skončí „pokračuje příště“ a poslední dotaz odešel nejpozději 20 s před koncem (${(s.dotazy.at(-1).cas - s.START) / 1000} s)`,
    v.stav === 'ok' && v.pokracovani && s.dotazy.length >= 6 && s.dotazy.at(-1).cas <= s.START + 37_000)
  const s2 = svetSynchronizace({ choice: plneOkno })
  await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: s2.START + 57_000, posledniDotazMs: s2.START + 12_000, prostredi: s2.prostredi })
  ok(`díl času od úlohy (poslední dotaz do 12 s): ${s2.dotazy.length} dotazy, žádný po něm`,
    s2.dotazy.length === 3 && s2.dotazy.every((d) => d.cas <= s2.START + 12_000))
}

/* ===================================================================== */
console.log('\n== 6a. Souběh ve virtuálním čase: tlačítka vedle běžícího načítání ==\n')

/**
 * SKUTEČNÝ lib/rezervace-choice-sync.ts, víc běhů a tlačítek NARÁZ.
 * Hodiny jsou plánovač událostí: každé čekání (na frontu, na odpověď
 * Choice, na opakování) je událost a `dobehnout` posune čas k nejbližší
 * z nich, až když všechno ostatní stojí. Fronta má aritmetiku migrace
 * 20261102100000 (`funkceFronty`; skutečné SQL zkouší krok105).
 *
 * Nezávislé ověření po sloučení #162 (stejný přístup) naměřilo před
 * opravou: tlačítko TÉŽE firmy vedle její úlohy prošlo ve 4–52 %
 * okamžiků, a když prošlo, úloha místo 15 dotazů udělala 5–6; callback
 * pobočky 2 během prvního načtení pobočky 1 téže firmy prošel jen
 * občas a první načtení pak udělalo 1 dotaz místo 5; třetí tlačítko
 * vedle dvou běhů jiných firem prošlo stejně špatně; „Načíst teď“ vedle
 * jediného běhu často skončilo jen částí.
 */
const tik = () => new Promise((hotovo) => setImmediate(hotovo))

function svetSoubehu(seznam, odpovedMs) {
  const START = Date.UTC(2026, 9, 26, 10, 0, 0)
  const h = hodinyAFronta(START)
  h.casovace = []
  h.poradi = 0
  const db = databaze({
    integrace_pripojeni: seznam.map((p) => pripojeni(p.id, { tenant_id: p.firma, branch_id: p.pobocka, externi_ucet: { var_symbol: p.vs } })),
    integrace_tajemstvi: seznam.map((p) => ({ pripojeni_id: p.id, sifra: p.token })),
    synchronizace_behy: [],
  }, () => h.ted)
  funkceFronty(db, h)
  db.rpc.rezervace_importovat_zdroj = ({ p_radky }) => ({ data: { nove: p_radky.length, zmenene: 0, beze_zmeny: 0, zastarale: 0 }, error: null })
  const spat = (ms) => new Promise((hotovo) => h.casovace.push({ kdy: h.ted + ms, hotovo, poradi: h.poradi++ }))
  const velikostOkna = Object.fromEntries(seznam.map((p) => [p.token, p.okno]))
  const dotazy = []
  const prostredi = {
    ted: () => h.ted,
    spat,
    fetch: async (url, init) => {
      const token = String(init.headers.authorization).slice('Bearer '.length)
      dotazy.push({ cas: h.ted, token })
      await spat(odpovedMs)
      const u = new URL(url)
      const okno = u.searchParams.get('periodField') === 'bookingDt' && u.searchParams.get('till') > '2027'
      if (!okno || u.searchParams.get('perPage') === '1') return odpoved(200, [rezervace(1)])
      const zbyva = velikostOkna[token] - (Number(u.searchParams.get('page')) - 1) * NA_STRANKU
      return odpoved(200, Array.from({ length: Math.max(0, Math.min(NA_STRANKU, zbyva)) }, (_, i) => rezervace(i + 1)))
    },
  }
  globalThis.__choiceTest.klient = db.klient
  return { h, db, dotazy, prostredi, START, spat, dotazuTokenem: (t) => dotazy.filter((d) => d.token === t).length }
}

/** Pouští plánovač, dokud se všechny sliby nevyřídí. */
async function dobehnout(s, sliby) {
  let hotovo = 0
  const sledovane = sliby.map((p) => p.then((v) => { hotovo++; return v }, (e) => { hotovo++; throw e }))
  for (const p of sledovane) p.catch(() => {})
  for (let i = 0; ; i++) {
    await tik()
    await tik()
    if (hotovo === sliby.length) break
    if (s.h.casovace.length === 0 || i > 100_000) throw new Error('souběh uvázl: nic nečeká a sliby nejsou vyřízené')
    s.h.casovace.sort((a, b) => a.kdy - b.kdy || a.poradi - b.poradi)
    const c = s.h.casovace.shift()
    s.h.ted = Math.max(s.h.ted, c.kdy)
    c.hotovo()
  }
  return Promise.all(sledovane)
}

const puvodniRozsifrovat = globalThis.__choiceTest.rozsifrovat
globalThis.__choiceTest.rozsifrovat = (sifra) => ({ token: sifra })

const FX = 'aaaaaaaa-0000-0000-0000-00000000000a' // firma, které běží úloha
const FF = 'ffffffff-0000-0000-0000-00000000000f' // jiná firma s tlačítkem
const FY = 'bbbbbbbb-0000-0000-0000-00000000000b' // třetí firma (druhý běh)
const pobocka = (n) => `bbbbbbbb-0000-0000-0000-0000000006${String(n).padStart(2, '0')}`
const SOUBEH = {
  ulohaX: { id: '10000000-0000-0000-0000-000000000001', firma: FX, pobocka: pobocka(1), token: 'tok-X', vs: '100', okno: 100_000 },
  x1: { id: '50000000-0000-0000-0000-000000000005', firma: FX, pobocka: pobocka(5), token: 'tok-X1', vs: '500', okno: 250 },
  x2: { id: '40000000-0000-0000-0000-000000000004', firma: FX, pobocka: pobocka(4), token: 'tok-X2', vs: '400', okno: 20 },
  f: { id: '20000000-0000-0000-0000-000000000002', firma: FF, pobocka: pobocka(2), token: 'tok-F', vs: '200', okno: 20 },
  y: { id: '30000000-0000-0000-0000-000000000003', firma: FY, pobocka: pobocka(3), token: 'tok-Y', vs: '300', okno: 250 },
}

// Úloha s dílem 80 s — ustálený běh, tlačítko padne doprostřed (skutečná
// úloha dává připojení nejvýš ~37 s, viz 6b).
const behUlohy = (s, p) => SYNC.synchronizovatChoice(p.id, { konecMs: s.START + 100_000, posledniDotazMs: s.START + 80_000, uloha: true, prostredi: s.prostredi })
// První načtení po připojení (callback, after()): jako tlačítko, konec + 57 s.
const prvniNacteni = (s, p) => SYNC.synchronizovatChoice(p.id, { konecMs: s.h.ted + 57_000, prostredi: s.prostredi })

/** Zmáčkne tlačítko přesně tak, jak ho volá server (konce jako callback a akce). */
async function zmacknout(s, druh, p) {
  if (druh === 'callback') {
    const t = await SYNC.otestovatToken(p.token, p.firma, s.h.ted + 57_000, s.prostredi)
    return { proslo: t.stav === 'ok' }
  }
  if (druh === 'overit') {
    const t = await SYNC.overitZnovu(p.token, p.firma, p.id, s.h.ted + 50_000, s.prostredi)
    return { proslo: t !== 'brzy' && t.stav === 'ok' }
  }
  const v = await SYNC.synchronizovatChoice(p.id, { konecMs: s.h.ted + SYNC.KONEC_NACIST_TED_MS, nejmeneOdMinulehoMs: 60_000, prostredi: s.prostredi })
  return { proslo: v.dotazu > 0, cele: v.dotazu > 0 && !v.pokracovani && v.stav === 'ok' }
}

const DRUHY_TLACITEK = { callback: 'callback (test tokenu)', overit: '„Ověřit znovu“', nacist: '„Načíst teď“' }
const ODPOVEDI = [100, 1_000, 2_500, 5_000]
const FAZE = Array.from({ length: (2 * ROZESTUP_DOTAZU_MS) / 250 }, (_, i) => i * 250)
const priklady = (x) => (x.length ? ', např. ' + x.slice(0, 3).join(', ') : '')

for (const [ciTlacitko, tlac] of [['TÉŽE firmy (jiná pobočka)', SOUBEH.x2], ['JINÉ firmy', SOUBEH.f]]) {
  /* Nález 1 (a nález A z #162): tlačítko vedle úlohy. Úloha má vlastní
     vstup do fronty — tlačítko její firmy ji nesmí zastavit a úloha ho
     nesmí zablokovat. Úloha smí přijít nejvýš o tolik dotazů, kolik jich
     tlačítko samo udělalo (jeho místa ve frontě). */
  const neproslo = { callback: [], overit: [], nacist: [] }
  const useklo = { callback: [], overit: [], nacist: [] }
  const cast = []
  let pokusu = 0
  for (const odpovedMs of ODPOVEDI) {
    const sama = svetSoubehu([SOUBEH.ulohaX, tlac], odpovedMs)
    const [bezTlacitka] = await dobehnout(sama, [behUlohy(sama, SOUBEH.ulohaX)])
    for (const faze of FAZE) {
      for (const druh of Object.keys(neproslo)) {
        const s = svetSoubehu([SOUBEH.ulohaX, tlac], odpovedMs)
        const [u, t] = await dobehnout(s, [behUlohy(s, SOUBEH.ulohaX), s.spat(20_000 + faze).then(() => zmacknout(s, druh, tlac))])
        pokusu++
        const kde = `${odpovedMs}/${faze}`
        if (!t.proslo) neproslo[druh].push(kde)
        if (u.dotazu < bezTlacitka.dotazu - s.dotazuTokenem(tlac.token)) useklo[druh].push(`${kde}: ${u.dotazu} z ${bezTlacitka.dotazu}`)
        if (druh === 'nacist' && !t.cele) cast.push(kde)
      }
    }
  }
  for (const [druh, kde] of Object.entries(neproslo)) {
    ok(`vedle úlohy projde ${DRUHY_TLACITEK[druh]} ${ciTlacitko} ve VŠECH fázích (${pokusu / 3} okamžiků; neprošlo ${kde.length}${priklady(kde)})`, kde.length === 0)
    ok(`… a úlohu neusekne: přijde nejvýš o dotazy, které tlačítko samo udělalo (jinak ${useklo[druh].length}×${priklady(useklo[druh])})`, useklo[druh].length === 0)
  }
  ok(`„Načíst teď“ ${ciTlacitko} vedle úlohy načte CELÉ (blízko, nové, okno) ve všech fázích — ne „část“ (část ${cast.length}×${priklady(cast)})`, cast.length === 0)
}

{
  /* Nález 1: majitel připojuje pobočky za sebou. Callback pobočky 2 přijde
     během PRVNÍHO NAČTENÍ pobočky 1 téže firmy (oba jako tlačítko, firma
     má jeden zabraný dotaz tlačítka). Test musí projít v každém okamžiku
     a první načtení pobočky 1 (5 dotazů) se nesmí useknout. */
  const neproslo = []
  const useknute = []
  let pokusu = 0
  for (const odpovedMs of [250, 1_000, 2_500]) {
    for (let T = 1_000; T <= 40_000; T += 500) {
      const s = svetSoubehu([SOUBEH.x1, SOUBEH.x2], odpovedMs)
      const [prvni, t] = await dobehnout(s, [prvniNacteni(s, SOUBEH.x1), s.spat(T).then(() => zmacknout(s, 'callback', SOUBEH.x2))])
      pokusu++
      if (!t.proslo) neproslo.push(`${odpovedMs}/${T / 1000} s`)
      if (prvni.dotazu !== 5 || prvni.pokracovani) useknute.push(`${odpovedMs}/${T / 1000} s: ${prvni.dotazu}`)
    }
  }
  ok(`callback pobočky 2 během prvního načtení pobočky 1 TÉŽE firmy projde v každém okamžiku (${pokusu} okamžiků 1–40 s; neprošlo ${neproslo.length}${priklady(neproslo)})`,
    neproslo.length === 0)
  ok(`… a první načtení pobočky 1 udělá všech 5 dotazů (useknuté ${useknute.length}×${priklady(useknute)})`, useknute.length === 0)
}

{
  /* Nález 2: dva běhy jiných firem naráz (úloha X a první načtení Y od
     2,7 s) drží frontu dva rozestupy dopředu. Třetí tlačítko (firma F)
     se dřív vešlo jen v okně mezi odchodem dotazu běhu a jeho odpovědí;
     teď počká na tu chvíli a zkusí to znovu. První načtení Y (taky
     tlačítko) tím nesmí skončit dřív než o dotazy, které tlačítko samo
     udělalo. */
  const neproslo = { callback: [], overit: [], nacist: [] }
  const useklo = { callback: [], overit: [], nacist: [] }
  let cele = 0
  let pokusu = 0
  for (const odpovedMs of ODPOVEDI) {
    const sama = svetSoubehu([SOUBEH.ulohaX, SOUBEH.y, SOUBEH.f], odpovedMs)
    const [, yBez] = await dobehnout(sama, [behUlohy(sama, SOUBEH.ulohaX), sama.spat(2_700).then(() => prvniNacteni(sama, SOUBEH.y))])
    for (const faze of FAZE) {
      for (const druh of Object.keys(neproslo)) {
        const s = svetSoubehu([SOUBEH.ulohaX, SOUBEH.y, SOUBEH.f], odpovedMs)
        const [, y, t] = await dobehnout(s, [
          behUlohy(s, SOUBEH.ulohaX),
          s.spat(2_700).then(() => prvniNacteni(s, SOUBEH.y)),
          s.spat(20_000 + faze).then(() => zmacknout(s, druh, SOUBEH.f)),
        ])
        pokusu++
        const kde = `${odpovedMs}/${faze}`
        if (!t.proslo) neproslo[druh].push(kde)
        if (y.dotazu < yBez.dotazu - s.dotazuTokenem(SOUBEH.f.token)) useklo[druh].push(`${kde}: ${y.dotazu} z ${yBez.dotazu}`)
        if (druh === 'nacist' && t.cele) cele++
      }
    }
  }
  for (const [druh, kde] of Object.entries(neproslo)) {
    ok(`vedle DVOU běhů jiných firem projde ${DRUHY_TLACITEK[druh]} ve VŠECH fázích (${pokusu / 3} okamžiků; neprošlo ${kde.length}${priklady(kde)})`, kde.length === 0)
    ok(`… a první načtení druhé firmy kvůli němu neskončí dřív (jinak ${useklo[druh].length}×${priklady(useklo[druh])})`, useklo[druh].length === 0)
  }
  // Tři běhy se střídají po třech rozestupech — „Načíst teď“ (tři dotazy)
  // se do svých 35 s celé vejít nemusí; zbytek dočte úloha. Jen ohlásit.
  console.log(`  (vedle dvou běhů načetlo „Načíst teď“ celé v ${cele} z ${pokusu / 3} okamžiků, jinak „část“ — zbytek dočte úloha)`)
}

{
  /* Prověrka 25. 10.: osm souběžných testů tokenu jedné firmy zabralo
     frontu na 30 s dopředu. Firma má nejvýš jeden zabraný dotaz
     tlačítka; kdo se nevejde, jednou počká na jeho odchod a zkusí to
     znovu. Dojdou na Choice nejvýš tři (do dvou rozestupů), ostatní
     „zkuste za chvíli“, a fronta se nikdy neposune víc než o tři
     rozestupy před „teď“. */
  const s = svetSoubehu([SOUBEH.x2], 250)
  const testy = await dobehnout(s, Array.from({ length: 8 }, () => zmacknout(s, 'callback', SOUBEH.x2)))
  const prosly = testy.filter((t) => t.proslo).length
  const volani = zabraniFronty(s)
  ok(`8 souběžných testů tokenu jedné firmy: ${prosly} došly na Choice (do 11 s), ostatní „zkuste za chvíli“`,
    prosly === 3 && s.dotazy.length === 3 && s.dotazy.every((d) => d.cas - s.START <= 2 * ROZESTUP_DOTAZU_MS))
  ok(`… každý se do fronty zeptal nejvýš dvakrát (jedno opakování) a čekal jako tlačítko (${volani.length} volání)`,
    volani.length <= 16 && volani.every((r) => r.args.p_nejdele_cekat_ms <= 2 * ROZESTUP_DOTAZU_MS) && zabraniUlohy(s).length === 0)
  ok(`… fronta nikdy víc než tři rozestupy před „teď“ (nejdál ${s.h.nejdalTlacitka} ms)`, s.h.nejdalTlacitka <= TRI_ROZESTUPY)
}

{
  /* Prověrka 26. 10.: firmu si může založit kdokoli přihlášený, takže
     „firma nejvýš jeden zabraný dotaz“ samo nestačí. Šest firem naráz:
     tlačítko čeká nejvýš dva rozestupy, takže tlačítka dohromady
     posunou frontu nejvýš o tři rozestupy před „teď“ (úloha ostatních
     tak čeká nejvýš ~16,5 s) — i s opakováním, které nic nezabírá. */
  const firmy = Array.from({ length: 6 }, (_, i) => ({ id: `${i}1111111-2222-3333-4444-555555555555`, firma: firmaKliku(i), pobocka: pobocka(10 + i), token: `tok-${i}`, vs: String(600 + i), okno: 20 }))
  const s = svetSoubehu(firmy, 250)
  const testy = await dobehnout(s, firmy.map((p) => zmacknout(s, 'overit', p)))
  const prosly = testy.filter((t) => t.proslo).length
  ok(`6 FIREM naráz „Ověřit znovu“: ${prosly} došly na Choice, ostatní „zkuste za chvíli“; fronta nejdál ${s.h.nejdalTlacitka} ms před „teď“ (≤ 16,5 s)`,
    prosly === 4 && s.dotazy.length === 4 && s.h.nejdalTlacitka <= TRI_ROZESTUPY)
  ok('… každé čekalo ve frontě nejvýš dva rozestupy',
    zabraniOvereni(s).length >= 6 && zabraniOvereni(s).every((r) => r.args.p_nejdele_cekat_ms <= 2 * ROZESTUP_DOTAZU_MS))

  const s2 = svetSoubehu(firmy, 250)
  const behy = await dobehnout(s2, firmy.map((p) => zmacknout(s2, 'nacist', p)))
  ok(`6 FIREM naráz „Načíst teď“: ${behy.filter((t) => t.proslo).length} se zeptaly; fronta nejdál ${s2.h.nejdalTlacitka} ms před „teď“ (≤ 16,5 s)`,
    behy.some((t) => t.proslo) && s2.h.nejdalTlacitka <= TRI_ROZESTUPY)
  ok('… „Načíst teď“ chce ve frontě čekat nejvýš dva rozestupy, nikdy vstupem úlohy',
    zabraniFronty(s2).length > 0 && zabraniFronty(s2).every((r) => r.args.p_nejdele_cekat_ms <= 2 * ROZESTUP_DOTAZU_MS) && zabraniUlohy(s2).length === 0)
}

globalThis.__choiceTest.rozsifrovat = puvodniRozsifrovat

/* ===================================================================== */
console.log('\n== 6b. Naplánovaná úloha: dělení času mezi připojení ==\n')

/**
 * SKUTEČNÁ úloha (app/api/uloha/rezervace-choice/route.ts) nad SKUTEČNÝM
 * lib/rezervace-choice-sync.ts; podstrčená je jen databáze, síť a hodiny
 * (Date.now i prostředí sync). Choice má u každého podniku 3 rezervace
 * v blízku, 3 nové a 250 v okně (3 stránky). Běh každých 15 minut.
 */
globalThis.__uloha = { SYNC }
const ROUTE_ULOHY = await nactiModul('app/api/uloha/rezervace-choice/route.ts', [
  ['next/server', js('export class NextResponse { static json(telo, i) { return { telo, status: (i && i.status) || 200 } } }')],
  ['@/lib/supabase/uloha', js('export function tajemstviSedi() { return true }\nexport async function uzBezi() { return null }')],
  ['@/lib/rezervace-choice-sync', js(`
export const REZERVA_DOTAZU_MS = globalThis.__uloha.SYNC.REZERVA_DOTAZU_MS
export function choiceKSynchronizaci() { return globalThis.__uloha.SYNC.choiceKSynchronizaci() }
export function synchronizovatChoice(id, m) { return globalThis.__uloha.SYNC.synchronizovatChoice(id, { ...m, prostredi: globalThis.__uloha.prostredi }) }`)],
])

async function simulovatUlohu({ pripojeniRadky, behu, pred = () => {}, choice429 = null }) {
  const s = svetSynchronizace({
    pripojeniRadky,
    sifry: Object.fromEntries(pripojeniRadky.map((p) => [p.id, `tok-${p.id}`])),
  })
  const puvodniRozsifrovat = globalThis.__choiceTest.rozsifrovat
  globalThis.__choiceTest.rozsifrovat = (sifra) => ({ token: sifra })
  const zaznam = []
  s.prostredi.fetch = async (url, init) => {
    const u = new URL(url)
    const kdo = init.headers.authorization.slice('Bearer tok-'.length)
    const okno = u.searchParams.get('periodField') === 'bookingDt' && Date.parse(u.searchParams.get('till')) - s.h.ted > 100 * 86_400_000
    const druh = u.searchParams.get('periodField') === 'createdDt' ? 'nove' : okno ? 'okno' : 'blizko'
    const stranka = Number(u.searchParams.get('page'))
    zaznam.push({ cas: s.h.ted, kdo, druh, stranka })
    s.h.ted += 400
    if (choice429 && choice429(zaznam.length)) return odpoved(429, {})
    const celkem = druh === 'okno' ? 250 : 3
    const n = Math.max(0, Math.min(100, celkem - (stranka - 1) * 100))
    return odpoved(200, Array.from({ length: n }, (_, i) => rezervace(`${kdo.slice(0, 2)}${stranka}${i}`)))
  }
  globalThis.__uloha = { SYNC, prostredi: s.prostredi }
  const puvodniNow = Date.now
  Date.now = () => s.h.ted
  const behy = []
  try {
    for (let b = 0; b < behu; b++) {
      s.h.ted = s.START + b * 15 * 60_000
      pred(s, b)
      const zacatek = s.h.ted
      const odZaznamu = zaznam.length
      const r = await ROUTE_ULOHY.GET(new Request('https://x/api/uloha/rezervace-choice', { headers: { authorization: 'Bearer x' } }))
      const tento = zaznam.slice(odZaznamu)
      behy.push({
        zacatek, trval: s.h.ted - zacatek, telo: r.telo, dotazy: tento,
        po: Object.fromEntries(pripojeniRadky.map((p) => [p.id, tento.filter((d) => d.kdo === p.id).map((d) => d.druh)])),
      })
    }
  } finally {
    Date.now = puvodniNow
    globalThis.__choiceTest.rozsifrovat = puvodniRozsifrovat
  }
  const rozestupy = zaznam.slice(1).map((d, i) => d.cas - zaznam[i].cas).filter((x) => x < 60_000)
  return { s, behy, zaznam, nejmensiRozestup: Math.min(...rozestupy) }
}

const idPripojeni = (i) => `${String(i + 1).repeat(8)}-2222-3333-4444-555555555555`
const pripojeniUlohy = (n, x = () => ({})) => Array.from({ length: n }, (_, i) => pripojeni(idPripojeni(i), {
  branch_id: `bbbbbbbb-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`,
  externi_ucet: { var_symbol: String(500 + i) }, vytvoreno_kdy: `2026-10-0${1 + (i % 9)}T10:00:00Z`, ...x(i),
}))
const plnyPruchod = (druhy) => druhy.includes('blizko') && druhy.includes('nove') && druhy.includes('okno')
const oknoHotovo = (s, id) => Boolean(s.db.tabulky.integrace_pripojeni.find((p) => p.id === id)?.externi_ucet?.kurzor?.okno_hotovo_kdy)
const vCase = (b) => b.trval <= 57_000 && b.dotazy.every((d) => d.cas <= b.zacatek + 37_000)

{
  // Dvě pobočky: dřív první v každém běhu jen „blízko, nové“ a okno nikdy.
  const { s, behy, nejmensiRozestup } = await simulovatUlohu({ pripojeniRadky: pripojeniUlohy(2), behu: 4 })
  const popis = behy.map((b, i) => `běh ${i + 1}: ${Object.values(b.po).map((d) => d.join(',')).join(' | ')}`).join('; ')
  ok(`2 pobočky: v KAŽDÉM běhu obě blízko, nové i okno (${popis})`, behy.every((b) => Object.values(b.po).every(plnyPruchod)))
  ok('… obě prošly celé okno 180 dní do 3 běhů', [0, 1].every((i) => oknoHotovo(s, idPripojeni(i))))
  ok(`… každý běh do 57 s a žádný dotaz po 37. s (${behy.map((b) => (b.trval / 1000).toFixed(1)).join(', ')} s)`, behy.every(vCase))
  ok(`… rozestup mezi všemi dotazy ≥ 5 s (nejmenší ${nejmensiRozestup} ms)`, nejmensiRozestup >= 5000)
}

for (const [n, behu, nejdelePauza] of [[3, 6, 2], [5, 10, 3]]) {
  // Víc poboček, než se vejde do jednoho běhu: střídají se, nikdo natrvalo nehladoví.
  const { s, behy } = await simulovatUlohu({ pripojeniRadky: pripojeniUlohy(n), behu })
  const ids = Array.from({ length: n }, (_, i) => idPripojeni(i))
  const obslouzeno = (id) => behy.map((b) => b.po[id].length > 0)
  const pauza = (id) => Math.max(...obslouzeno(id).join('').split('true').map((x) => x.split('false').length - 1))
  ok(`${n} poboček: kdo v běhu přijde na řadu, dostane blízko, nové i okno`,
    behy.every((b) => Object.values(b.po).every((d) => d.length === 0 || plnyPruchod(d))))
  ok(`… každá přijde na řadu nejpozději po ${nejdelePauza} bězích (${ids.map((id) => obslouzeno(id).map((x) => (x ? '■' : '·')).join('')).join(' ')})`,
    ids.every((id) => pauza(id) < nejdelePauza))
  ok(`… každá do ${behu} běhů prošla celé okno 180 dní`, ids.every((id) => oknoHotovo(s, id)))
  ok('… každý běh do 57 s a žádný dotaz po 37. s', behy.every(vCase))
}

{
  // Firmy se střídají: firma se 4 pobočkami (a kopií téhož podniku
  // založenou přímým zápisem) nevezme čas firmě s jednou pobočkou — ani
  // když si v registru maže posledni_sync_kdy, aby šla první.
  const A = pripojeniUlohy(4, () => ({ tenant_id: CIZI_FIRMA }))
  const kopie = pripojeni('77777777-2222-3333-4444-555555555555', {
    tenant_id: CIZI_FIRMA, branch_id: A[0].branch_id, externi_ucet: { var_symbol: A[0].externi_ucet.var_symbol }, vytvoreno_kdy: '2026-10-20T10:00:00Z',
  })
  const B = pripojeni('66666666-2222-3333-4444-555555555555', { externi_ucet: { var_symbol: '900' }, vytvoreno_kdy: '2026-10-09T10:00:00Z' })
  const { behy } = await simulovatUlohu({
    pripojeniRadky: [...A, kopie, B], behu: 6,
    pred: (s) => { for (const p of s.db.tabulky.integrace_pripojeni) if (p.tenant_id === CIZI_FIRMA) p.posledni_sync_kdy = null },
  })
  ok(`firma s 1 pobočkou se načte v KAŽDÉM běhu, i když jiná firma má 4 (${behy.map((b) => (plnyPruchod(b.po[B.id]) ? '■' : '·')).join('')})`,
    behy.every((b) => plnyPruchod(b.po[B.id])))
  ok('… kopie téhož podniku u firmy se nenačítá nikdy (bere se nejstarší připojení)', behy.every((b) => b.po[kopie.id].length === 0))
  ok('… pobočky velké firmy se mezi sebou střídají', A.every((p) => behy.some((b) => b.po[p.id].length > 0)))
}

{
  // Úloha má přednost: kliky jiných firem posunuly frontu o tři rozestupy
  // (~16,5 s, víc tlačítka nesmí) těsně před během. Úloha (`uloha: true`)
  // na volný dotaz počká a načte celý průchod — tlačítko by v téže chvíli
  // dostalo „zkuste za chvíli“.
  const { s, behy } = await simulovatUlohu({
    pripojeniRadky: pripojeniUlohy(1), behu: 1,
    pred: (svet) => { svet.h.dalsi = svet.h.ted + TRI_ROZESTUPY },
  })
  const druhy = Object.values(behy[0].po)[0]
  ok(`úloha po klikách jiných firem (fronta o 16,5 s dál) načte blízko, nové i okno (${druhy.join(',')})`, plnyPruchod(druhy))
  ok('… jde do fronty vlastním vstupem úlohy a smí čekat déle než tlačítko (route předává uloha: true)',
    zabraniUlohy(s).some((r) => r.args.p_nejdele_cekat_ms > 2 * ROZESTUP_DOTAZU_MS))
  ok('… a frontu tlačítek za firmu nezabírá vůbec (tlačítku firmy dotaz nevezme ani ho nezastaví)',
    zabraniFronty(s).length === 0 && zabraniUlohy(s).length >= 3)
}

/**
 * SKUTEČNÁ úloha (route.ts) v plánovači virtuálního času z oddílu 6a,
 * vedle ní tlačítka (`{ p, druh, za }`: připojení, druh jako
 * `zmacknout`, kolik ms po začátku). Pořadí připojení úlohy je dané
 * (`choiceKSynchronizaci` vrací `ulohaP` popořadě) — o pořadí tu nejde
 * a „tlačítko téže firmy jako 1. připojení“ musí být opravdu první.
 * `obsazenoMs`: fronta je na začátku obsazená do tolika ms po začátku
 * (jiní si ji zabrali těsně předtím).
 */
async function ulohaSTlacitky(ulohaP, odpovedMs, tlacitka, ulohaZa = 0, obsazenoMs = 0) {
  const s = svetSoubehu([...ulohaP, ...tlacitka.map((t) => t.p)], odpovedMs)
  if (obsazenoMs > 0) s.h.dalsi = s.START + obsazenoMs
  const puvodniRozsifrovat = globalThis.__choiceTest.rozsifrovat
  globalThis.__choiceTest.rozsifrovat = (sifra) => ({ token: sifra })
  // Kdy route začala které připojení (ms po začátku světa).
  const zacatky = []
  globalThis.__uloha = {
    SYNC: {
      ...SYNC,
      choiceKSynchronizaci: async () => ulohaP.map((p) => p.id),
      synchronizovatChoice: (id, m) => { zacatky.push(s.h.ted - s.START); return SYNC.synchronizovatChoice(id, m) },
    },
    prostredi: s.prostredi,
  }
  const puvodniNow = Date.now
  Date.now = () => s.h.ted
  try {
    const [r, ...t] = await dobehnout(s, [
      s.spat(ulohaZa).then(() => ROUTE_ULOHY.GET(new Request('https://x/api/uloha/rezervace-choice', { headers: { authorization: 'Bearer x' } }))),
      ...tlacitka.map(({ p, druh, za }) => s.spat(za).then(() => zmacknout(s, druh, p))),
    ])
    const tokenyUlohy = new Set(ulohaP.map((p) => p.token))
    return {
      telo: r.telo,
      tlacitka: t,
      ulohaDotazu: s.dotazy.filter((d) => tokenyUlohy.has(d.token)).length,
      tlacitkaDotazu: s.dotazy.filter((d) => !tokenyUlohy.has(d.token)).length,
      rozpis: r.telo.vysledky.map((v) => v.dotazu).join('+'),
      nejmensiRozestup: Math.min(...s.dotazy.slice(1).map((d, i) => d.cas - s.dotazy[i].cas)),
      zacatky,
    }
  } finally {
    Date.now = puvodniNow
    globalThis.__choiceTest.rozsifrovat = puvodniRozsifrovat
  }
}

{
  /* Nezávislé ověření PR #163 (nález 1): oddíl 6a zkouší úlohu s JEDNÍM
     připojením a dílem 80 s. Skutečná úloha dělí 37 s mezi připojení
     (každému nejméně 16,5 s) a díl dalšího připojení se počítal od
     chvíle, kdy předchozí SKONČILO — ne od místa, které mu fronta dala.
     Tlačítko, které vzalo poslední místo dílu 1. připojení, tak nechalo
     2. připojení čekat na frontu ~11 s z jeho dílu: místo 3 dotazů 2,
     a na 3. připojení už díl nezbyl. Úloha přišla o dotaz VÍC, než
     kolik jich tlačítko samo udělalo (se 3 připojeními ~15 % okamžiků,
     u 1 a 2 připojení nikdy). Tady skutečná úloha se 2 až 4 připojeními
     a jedno tlačítko v každém okamžiku jejího běhu. */
  const firmaUlohy = (i) => `e${i}eeeeee-0000-0000-0000-000000000000`
  const ulohaN = (n) => Array.from({ length: n }, (_, i) => ({ id: idPripojeni(i), firma: firmaUlohy(i), pobocka: pobocka(30 + i), token: `tok-u${i}`, vs: String(700 + i), okno: 100_000 }))
  const jina = { id: 'f2000000-0000-0000-0000-0000000000f2', firma: FF, pobocka: pobocka(40), token: 'tok-tj', vs: '790', okno: 20 }
  const tataz = { id: 'f3000000-0000-0000-0000-0000000000f3', firma: firmaUlohy(0), pobocka: pobocka(41), token: 'tok-tt', vs: '791', okno: 20 }
  for (const n of [2, 3, 4]) {
    const neproslo = []
    const prisla = []
    let pokusu = 0
    let rozestup = Infinity
    let sama = ''
    for (const odpovedMs of [250, 2_500]) {
      const bez = await ulohaSTlacitky(ulohaN(n), odpovedMs, [])
      sama += `${sama ? ', ' : ''}${bez.rozpis}`
      for (const [ci, tl] of [['jiná', jina], ['tatáž', tataz]]) {
        for (const druh of ['callback', 'overit']) {
          for (let za = 0; za < 37_000; za += 500) {
            const r = await ulohaSTlacitky(ulohaN(n), odpovedMs, [{ p: tl, druh, za }])
            pokusu++
            rozestup = Math.min(rozestup, r.nejmensiRozestup)
            const kde = `${odpovedMs}/${ci}/${druh}/${za / 1000} s`
            if (!r.tlacitka[0].proslo) neproslo.push(kde)
            if (bez.ulohaDotazu - r.ulohaDotazu > r.tlacitkaDotazu) prisla.push(`${kde}: ${r.rozpis} (sama ${bez.rozpis})`)
          }
        }
      }
    }
    ok(`úloha s ${n} připojeními (sama ${sama} dotazů) a tlačítko jiné i téže firmy v kterémkoli okamžiku: úloha přijde nejvýš o dotazy, které tlačítko samo udělalo (${pokusu} okamžiků; víc ${prisla.length}×${priklady(prisla)})`,
      prisla.length === 0)
    ok(`… tlačítko vedle ní prošlo vždy (neprošlo ${neproslo.length}×${priklady(neproslo)}) a rozestup dotazů na Choice nikdy pod 5 s (nejmenší ${rozestup} ms)`,
      neproslo.length === 0 && rozestup >= 5_000)
  }

  /* Totéž bez tlačítka v simulaci: fronta je obsazená do X ms po začátku
     úlohy (jiné firmy si ji zabraly těsně před ní), X po 250 ms přes
     čtyři rozestupy. Jiní tak vzali nejvýš ⌈X / rozestup⌉ míst a úloha
     nesmí přijít o víc. Hlídá hlavně škvíru mezi koncem dílu a koncem
     připojení: kdyby route počítala zbývající čas od chvíle, kdy
     připojení doběhlo (o odpověď na poslední dotaz později), a ne od
     konce jeho dílu, propadne zbytek úlohy — se 3 připojeními a frontou
     do ~4 s 4 dotazy místo 7. Tlačítka výš (krok 500 ms) se do té
     škvíry netrefí. */
  for (const n of [1, 2, 3, 4]) {
    const vic = []
    let pokusu = 0
    let sama = ''
    for (const odpovedMs of [250, 2_500, 5_000]) {
      const bez = await ulohaSTlacitky(ulohaN(n), odpovedMs, [])
      sama += `${sama ? ', ' : ''}${bez.rozpis}`
      for (let X = 250; X <= 4 * ROZESTUP_DOTAZU_MS; X += 250) {
        const r = await ulohaSTlacitky(ulohaN(n), odpovedMs, [], 0, X)
        pokusu++
        if (bez.ulohaDotazu - r.ulohaDotazu > Math.ceil(X / ROZESTUP_DOTAZU_MS)) vic.push(`${odpovedMs}/${X / 1000} s: ${r.rozpis} (sama ${bez.rozpis})`)
      }
    }
    ok(`úloha s ${n} ${n === 1 ? 'připojením' : 'připojeními'} (sama ${sama}) a fronta obsazená do 0,25–22 s: přijde nejvýš o místa, která vzali jiní (${pokusu} okamžiků; víc ${vic.length}×${priklady(vic)})`,
      vic.length === 0)
  }

  /* Pomalé odpovědi Choice (8 s, víc než rozestup): připojení pak může
     doběhnout dlouho po konci svého dílu. Route počítá zbývající čas od
     konce dílu, takže by další připojení začala i ve chvíli, kdy se do
     konce úlohy nevejdou ani tři místa ve frontě — a běh bez okna by
     připojení odsunul v pořadí. Proto druhá podmínka v route: od teď
     aspoň dva rozestupy (první dotaz hned). U odpovědí do 5,5 s nezabere
     nikdy, tady ano (3 připojení, fronta do 2,5 s: 2. připojení by
     začalo 26,5 s po začátku, 10,5 s před posledním dotazem úlohy). */
  const pozde = []
  let zacatych = 0
  for (const n of [2, 3, 4]) {
    for (let X = 0; X <= 4 * ROZESTUP_DOTAZU_MS; X += 250) {
      const r = await ulohaSTlacitky(ulohaN(n), 8_000, [], 0, X)
      zacatych += r.zacatky.length
      for (const z of r.zacatky) if (z > 37_000 - 2 * ROZESTUP_DOTAZU_MS) pozde.push(`${n} připojení, fronta do ${X / 1000} s: začalo v ${z / 1000} s`)
    }
  }
  ok(`odpovědi Choice po 8 s: žádné připojení úlohy nezačne později než dva rozestupy před jejím posledním dotazem (${zacatych} začatých; pozdě ${pozde.length}×${priklady(pozde)})`,
    pozde.length === 0 && zacatych > 0)

  /* Dávka kliků: opakování z #163 vrací tlačítko přesně na konec dílu
     připojení, takže tenhle stav dřív vyvolalo pokaždé (8× „Ověřit
     znovu“ jedné firmy, úloha se 3 připojeními: úloha 1+2 místo 4+3,
     kliky přitom udělaly 3 dotazy). */
  const kliky = Array.from({ length: 8 }, (_, i) => ({ p: { id: `c${i}000000-0000-0000-0000-0000000000c${i}`, firma: FF, pobocka: pobocka(50 + i), token: `tok-k${i}`, vs: String(800 + i), okno: 20 }, druh: 'overit', za: 0 }))
  const davka = []
  let davek = 0
  for (const odpovedMs of [250, 2_500]) {
    const bez = await ulohaSTlacitky(ulohaN(3), odpovedMs, [])
    for (let ulohaZa = 0; ulohaZa <= 11_000; ulohaZa += 500) {
      const r = await ulohaSTlacitky(ulohaN(3), odpovedMs, kliky, ulohaZa)
      davek++
      if (bez.ulohaDotazu - r.ulohaDotazu > r.tlacitkaDotazu) davka.push(`${odpovedMs}/úloha za ${ulohaZa / 1000} s: ${r.rozpis} (sama ${bez.rozpis}), kliky ${r.tlacitkaDotazu}`)
    }
  }
  ok(`dávka 8 kliků jedné firmy a úloha se 3 připojeními (začne 0–11 s po nich): úloha přijde nejvýš o dotazy kliků (${davek} okamžiků; víc ${davka.length}×${priklady(davka)})`,
    davka.length === 0)
}

{
  // Databáze PŘED migrací 20261102100000 (kód se nasazuje dřív než db
  // push): funkce úlohy chybí (PGRST202) → úloha čeká jako dřív, frontou
  // za firmu, a načte. Bez toho by úloha do db push nenačetla nic.
  const radky = pripojeniUlohy(1)
  const s = svetSynchronizace({ pripojeniRadky: radky, sifry: { [radky[0].id]: 'sifra-ok' }, uloha: false, choice: () => odpoved(200, [rezervace(1)]) })
  const v = await SYNC.synchronizovatChoice(radky[0].id, { konecMs: s.START + 57_000, posledniDotazMs: s.START + 30_000, uloha: true, prostredi: s.prostredi })
  ok(`databáze před 20261102100000: úloha bez své funkce čeká frontou za firmu a načte (${v.stav}, ${v.dotazu} dotazy)`,
    v.stav === 'ok' && v.dotazu === 3 && s.dotazy.length === 3
    && zabraniUlohy(s).length === 3 && zabraniFronty(s).length === 3
    && zabraniFronty(s).every((r) => r.args.p_tenant === FIRMA && r.args.p_nejdele_cekat_ms > 2 * ROZESTUP_DOTAZU_MS))
  const bez = svetSynchronizace({ fronta: false })
  const v2 = await SYNC.synchronizovatChoice(ID_PRIPOJENI, { konecMs: bez.START + 57_000, uloha: true, prostredi: bez.prostredi })
  ok('… a bez front vůbec (před 20261031100000) úloha na Choice nesáhne a čeká na migraci',
    bez.dotazy.length === 0 && v2.stav === 'chyba' && /20261031100000/.test(bez.db.tabulky.integrace_pripojeni[0].posledni_chyba ?? ''))
}

{
  // 429 → úloha skončí a další připojení v tomhle běhu nezkouší.
  const { behy } = await simulovatUlohu({ pripojeniRadky: pripojeniUlohy(2), behu: 1, choice429: (n) => n === 1 })
  const [b] = behy
  ok('429 u prvního připojení → úloha skončí („omezeno“), druhé se v tomhle běhu nezkouší',
    b.telo.omezeno === true && b.dotazy.length === 1 && b.telo.zpracovano === 1)
  ok('… v odpovědi úlohy (veřejný log GitHubu) nejsou id připojení', !JSON.stringify(b.telo).includes(idPripojeni(0)))
}

{
  // Pořadí čistě: firmy se střídají, nejdéle nenačtené první, kopie podniku pryč.
  const k = (id, tenantId, varSymbol, posledniBeh, zalozeno = '2026-10-01T00:00:00Z') => ({ id, tenantId, varSymbol, posledniBeh, zalozeno })
  const poradi = poradiSynchronizace([
    k('a1', 'A', '1', '2026-10-25T10:00:00Z'), k('a2', 'A', '2', null), k('a3', 'A', '3', '2026-10-25T09:00:00Z'),
    k('a1-kopie', 'A', '1', null, '2026-10-02T00:00:00Z'),
    k('b1', 'B', '9', '2026-10-25T09:30:00Z'),
  ])
  ok(`pořadí: firma B (naposledy dřív) první, pak střídavě; uvnitř firmy nenačtené první; kopie podniku vynechaná (${poradi.join(' ')})`,
    poradi.join(' ') === 'b1 a2 a3 a1')
  ok('prázdný seznam → prázdné pořadí', poradiSynchronizace([]).length === 0)
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
export async function otestovatToken(token, firma) { globalThis.__callback.testy.push(token); globalThis.__callback.firmyTestu.push(firma); return globalThis.__callback.test }
export async function zapsatVysledekTestu(_k, id, test) { globalThis.__callback.zapsaneTesty.push([id, test]); return true }
export async function jinePripojeniTehozPodniku(t, id, vs) { return globalThis.__callback.jinde }
export async function synchronizovatChoice(id, m) { globalThis.__callback.synchronizace.push({ id, m }) }`)],
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
  Object.assign(globalThis.__callback, { klient: db.klient, smi, test, jinde, pravo: [], testy: [], firmyTestu: [], zapsaneTesty: [], synchronizace: [], after: [] })
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
  ok('„připojeno“ až z výsledku živého testu (fronta za firmu připojení)', globalThis.__callback.testy[0] === TOKEN && globalThis.__callback.firmyTestu[0] === FIRMA && globalThis.__callback.zapsaneTesty[0]?.[1]?.stav === 'ok'
    && !s.db.zmeny.some((z) => z.data?.stav === 'pripojeno'))
  ok('první načtení až po odpovědi (after)', globalThis.__callback.after.length === 1 && globalThis.__callback.synchronizace.length === 0)
  await globalThis.__callback.after[0]()
  ok('… a jako tlačítko: bez `uloha: true` (přednost ve frontě má jen naplánovaná úloha)',
    globalThis.__callback.synchronizace.length === 1 && globalThis.__callback.synchronizace[0].id === ID_PRIPOJENI
    && globalThis.__callback.synchronizace[0].m?.uloha !== true)

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
console.log('\n== 7b. Serverové akce Choice (app/[rozsah]/rezervace/akce.ts) ==\n')

/**
 * SKUTEČNÉ akce „Připojit podnik“, „Ověřit znovu“ a „Načíst teď“.
 * Podstrčené je jen to pod nimi: přístup (kdo co smí), databáze a server
 * (lib/rezervace-choice-sync — ten má vlastní testy výš). Kontrola práva
 * v akci je jediná linie před prací pod service_role, proto se zkouší
 * spuštěním.
 */
globalThis.__akce = {}
const AKCE = await nactiModul('app/[rozsah]/rezervace/akce.ts', [
  ['next/cache', js('export function revalidatePath() {}')],
  ['next/navigation', js('export function redirect(kam) { const e = new Error("NEXT_REDIRECT"); e.kam = kam; throw e }')],
  ['@/lib/authz', js(`export function canSee() { return globalThis.__akce.spravce }
export async function hasAccess(t, p, b) { globalThis.__akce.pravo.push([t, p, b]); return p === 'integrace.manage' ? globalThis.__akce.spravce : false }`)],
  ['@/lib/firma', js('export async function getCurrentTenantId() { return globalThis.__akce.firma }')],
  ['@/lib/integrace-adresa', js("export async function zakladniAdresaAplikace() { return 'https://foodtab-rizeni.vercel.app' }")],
  ['@/lib/integrace-klice', KLICE],
  ['@/lib/rezervace-choice-sync', js(`
export async function otestovatToken(token, firma, konecMs) { globalThis.__akce.testyBezOdstupu.push({ token, firma, konecMs }); return { stav: 'ok' } }
export async function overitZnovu(token, firma, pripojeniId, konecMs) { globalThis.__akce.testy.push({ token, firma, pripojeniId, konecMs }); return globalThis.__akce.overeni }
export async function zapsatVysledekTestu(_k, id, test) { globalThis.__akce.zapsane.push([id, test]); return true }
export async function synchronizovatChoice(id, m) { globalThis.__akce.synchronizace.push({ id, m }); return globalThis.__akce.vysledekSync }
export const KONEC_NACIST_TED_MS = globalThis.__uloha.SYNC.KONEC_NACIST_TED_MS`)],
  ['@/lib/rezervace-import', js('export const MAX_RADKU_IMPORTU = 1\nexport function naparsovatCsvRezervaci() {}')],
  ['@/lib/rezervace-prijem-api', js("export const POSKYTOVATEL_PRIJMU = 'prijem-api'\nexport function slozitKlicRezervaci() {}")],
  ['@/lib/rezervace-poskytovatele', js('export function poskytovatelSouboru() {}\nexport function systemyKPriprave() { return [] }')],
  ['@/lib/rezervace-prilohy', js("export const KBELIK_REZERVACI = 'x'\nexport const MAX_BAJTU = 1\nexport const MAX_PRILOH_REZERVACE = 1\nexport function jeTypPriloh() { return false }")],
  ['@/lib/rezervace-typy', js('export const STAVY = []\n' + ['bezpecnaZpatky', 'hlaskaZDatabaze', 'jePlatneDatum', 'precistFormular', 'zkontrolovatPoznamku'].map((f) => `export function ${f}() {}`).join('\n'))],
  ['@/lib/supabase/server', js('export async function getServerSupabase() { return globalThis.__akce.klient }')],
  ['./pristup', js('export function pobockaKZapisu() { return null }\nexport async function zkusPristupRezervacim() { return globalThis.__akce.pristup }')],
])

const { zasifrovat: zasifrovatKlicem } = await import(KLICE)

async function akce(fn, pole, { spravce = false, zapis = false, stav = 'pripojeno', napojeni = true, vysledekSync = { stav: 'ok', pokracovani: false, dotazu: 3 }, overeni = { stav: 'ok' } } = {}) {
  const db = databaze({ integrace_pripojeni: napojeni ? [pripojeni(ID_PRIPOJENI, { stav })] : [] })
  db.rpc.rezervace_napojeni = () => ({ data: db.tabulky.integrace_pripojeni.map((p) => ({ id: p.id, branch_id: p.branch_id, poskytovatel: p.poskytovatel, stav: p.stav })), error: null })
  db.rpc.integrace_precti_tajemstvi = () => ({ data: zasifrovatKlicem({ token: TOKEN }).sifra, error: null })
  db.klient.auth = { getUser: async () => ({ data: { user: { id: UZIVATEL } }, error: null }) }
  globalThis.__akce = {
    firma: FIRMA, spravce, klient: db.klient, pravo: [], testy: [], testyBezOdstupu: [], zapsane: [], synchronizace: [], vysledekSync, overeni,
    pristup: { stav: 'ok', ctx: {}, scope: {}, pobocky: [{ id: POBOCKA, nazev: 'Černá Perla', slug: 'cerna-perla', zona: 'Europe/Prague', zapis }] },
  }
  const fd = new FormData()
  for (const [k, v] of Object.entries({ rozsah: 'cerna-perla', ...pole })) fd.append(k, v)
  let kam = null
  try {
    await fn(fd)
  } catch (e) {
    if (!e.kam) throw e
    kam = e.kam
  }
  return { kam, db, a: globalThis.__akce }
}

{
  const ctenar = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI })
  ok('„Načíst teď“ od toho, kdo jen čte → pravo a ŽÁDNÉ načítání pod service_role',
    ctenar.kam?.endsWith('chyba=pravo') && ctenar.a.synchronizace.length === 0)
  const obsluha = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI }, { zapis: true })
  ok('… kdo na pobočce zapisuje rezervace → načte (s minutovým odstupem od minulého běhu, ve frontě jako tlačítko)',
    obsluha.kam?.endsWith('stav=choice-nacteno') && obsluha.a.synchronizace.length === 1
    && obsluha.a.synchronizace[0].id === ID_PRIPOJENI && obsluha.a.synchronizace[0].m.nejmeneOdMinulehoMs === 60_000
    && obsluha.a.synchronizace[0].m.uloha !== true)
  // Kolik času na tři dotazy vedle běžícího načítání stačí, zkouší 6a
  // (s tímhle KONEC_NACIST_TED_MS); tady, že ho akce opravdu předává
  // a že po něm zbude 5 s do stropu stránky (maxDuration 60).
  const konec = obsluha.a.synchronizace[0]?.m.konecMs - Date.now()
  ok(`… s koncem KONEC_NACIST_TED_MS po kliku (${Math.round(konec / 1000)} s; strop stránky 60 s, 5 s na vykreslení)`,
    konec <= SYNC.KONEC_NACIST_TED_MS && konec > SYNC.KONEC_NACIST_TED_MS - 5_000 && SYNC.KONEC_NACIST_TED_MS <= 55_000)
  const spravce = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI }, { spravce: true })
  ok('… správce napojení taky', spravce.a.synchronizace.length === 1)
  const obsazeno = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI }, { zapis: true, vysledekSync: { stav: 'ok', pokracovani: true, dotazu: 0 } })
  ok('… fronta firmy zabraná jiným během (0 dotazů) → „zkuste za minutu“, ne „část načtená“', obsazeno.kam?.endsWith('chyba=choice-chvili'))
  const cast = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI }, { zapis: true, vysledekSync: { stav: 'ok', pokracovani: true, dotazu: 4 } })
  ok('… načtená část (došel čas) → „část načtená“', cast.kam?.endsWith('stav=choice-nacteno-cast'))
  const neovereny = await akce(AKCE.nacistChoiceTed, { id: ID_PRIPOJENI }, { zapis: true, stav: 'chyba' })
  ok('… neověřené připojení se nenačítá', neovereny.kam?.endsWith('chyba=choice-neovereno') && neovereny.a.synchronizace.length === 0)
}

{
  const bez = await akce(AKCE.overitChoice, { id: ID_PRIPOJENI }, { zapis: true })
  ok('„Ověřit znovu“ bez správy napojení → pravo, žádný test', bez.kam?.endsWith('chyba=pravo') && bez.a.testy.length === 0)
  const s = await akce(AKCE.overitChoice, { id: ID_PRIPOJENI }, { spravce: true })
  ok('… správce: test uloženým tokenem, ve frontě ZA FIRMU (souběžné kliky si frontu nezaberou)',
    s.kam?.endsWith('stav=choice-overeno') && s.a.testy.length === 1 && s.a.testy[0].token === TOKEN && s.a.testy[0].firma === FIRMA)
  ok('… přes odstup na připojení (overitZnovu s id připojení, ne test napřímo) a s koncem do 50 s',
    s.a.testy[0]?.pripojeniId === ID_PRIPOJENI && s.a.testyBezOdstupu.length === 0
    && s.a.testy[0].konecMs <= Date.now() + 50_000 && s.a.testy[0].konecMs > Date.now() + 40_000
    && s.a.zapsane.length === 1 && s.a.zapsane[0][1]?.stav === 'ok')
  const brzy = await akce(AKCE.overitChoice, { id: ID_PRIPOJENI }, { spravce: true, overeni: 'brzy' })
  ok('„Ověřit znovu“ před uplynutím minuty → „znovu za minutu“, u napojení se nic nezapíše',
    brzy.kam?.endsWith('chyba=choice-overeno-chvili') && brzy.a.zapsane.length === 0)
}

{
  const ODKAZ = `https://cernaperlatabor.choiceqr.com/admin/open-api/connect?clientId=klient-foodtab&redirectUrl=${encodeURIComponent(CALLBACK)}&scope=all&response_type=code&digit=8378`
  const adresa = await akce(AKCE.pripojitChoice, { pobocka: POBOCKA, podnik: 'cernaperlatabor.choiceqr.com' }, { spravce: true, napojeni: false })
  ok('„Připojit podnik“ jen s adresou podniku → „vložte celý odkaz“, na Choice se NEPŘESMĚRUJE a nic se nezaloží',
    adresa.kam?.endsWith('chyba=choice-odkaz-chybi') && adresa.db.zmeny.length === 0)
  const s = await akce(AKCE.pripojitChoice, { pobocka: POBOCKA, podnik: ODKAZ }, { spravce: true, napojeni: false })
  const kam = s.kam ? new URL(s.kam) : null
  ok('s odkazem z Choice → na stránku připojení podniku s digit od Choice, naším callbackem a podepsaným pokusem',
    kam?.origin === 'https://cernaperlatabor.choiceqr.com' && kam.pathname === '/admin/open-api/connect'
    && kam.searchParams.get('digit') === '8378' && kam.searchParams.get('redirectUrl') === CALLBACK
    && kam.searchParams.get('clientId') === 'klient-foodtab' && rozebratPokus(kam.searchParams.get('customAttribute')) !== null)
  ok('… připojení založené jako „připojuje se“ (ne připojeno)',
    s.db.tabulky.integrace_pripojeni.length === 1 && s.db.tabulky.integrace_pripojeni[0].stav === 'pripojuje_se')
  const jinam = await akce(AKCE.pripojitChoice, { pobocka: POBOCKA, podnik: ODKAZ.replace(encodeURIComponent(CALLBACK), encodeURIComponent('https://jinde.example.com/cb')) }, { spravce: true, napojeni: false })
  ok('odkaz z Choice s jiným callbackem → choice-odkaz-callback', jinam.kam?.endsWith('chyba=choice-odkaz-callback') && jinam.db.zmeny.length === 0)
  const cizi = await akce(AKCE.pripojitChoice, { pobocka: POBOCKA, podnik: ODKAZ.replace('clientId=klient-foodtab', 'clientId=jina') }, { spravce: true, napojeni: false })
  ok('odkaz jiné aplikace → choice-odkaz-aplikace', cizi.kam?.endsWith('chyba=choice-odkaz-aplikace'))
  const bezPrava = await akce(AKCE.pripojitChoice, { pobocka: POBOCKA, podnik: ODKAZ }, { zapis: true, napojeni: false })
  ok('bez správy napojení → pravo, nic se nezaloží', bezPrava.kam?.endsWith('chyba=pravo') && bezPrava.db.zmeny.length === 0)
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
console.log('\n== 8b. Fronta v migraci: zámky řádků firmy a fronty ==\n')
{
  // Souběh dvou spojení zkouší krok105 (oddíl 2b, dblink) — jen proti
  // PostgreSQL v CI, PGlite má jediné spojení. Tady aspoň text funkce:
  // `zabrano_do` se čte JEDNÍM příkazem, který zamyká řádek firmy, a to
  // dřív, než se zamkne fronta a změří čas. Bez zámku by dvě souběžná
  // volání téže firmy přečetla starý `zabrano_do` a dotaz dostala obě.
  // Platná definice je ta POSLEDNÍ (20261102100000 ji nahradila).
  const sql = cti('supabase/migrations/20261102100000_rezervace_choice_fronta_tlacitka.sql').replace(/--[^\n]*/g, '')
  const zacatek = sql.indexOf('create or replace function public.rezervace_choice_zabrat_dotaz(')
  const telo = zacatek < 0 ? '' : sql.slice(zacatek, sql.indexOf('end $$;', zacatek))
  const pozdejsi = fs.readdirSync(path.join(KOREN, 'supabase/migrations'))
    .filter((f) => f.slice(0, 14) > '20261102100000' && /function public\.rezervace_choice_zabrat_dotaz(_ulohy)?\(/.test(cti(`supabase/migrations/${f}`)))
  ok(`žádná pozdější migrace funkci fronty znovu nedefinuje (jinak čte tahle kontrola starou verzi)${pozdejsi.length ? ': ' + pozdejsi.join(', ') : ''}`,
    pozdejsi.length === 0)
  ok('vyříznutí funkce fronty z migrace něco našlo (kontrola nečte prázdno)',
    telo.length > 500 && telo.includes('zabrano_do') && telo.includes('v_ted := clock_timestamp()'))
  const cteni = telo.split(';').map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /^select\b/i.test(p) && /\bzabrano_do\b/.test(p))
  ok(`zabrano_do se čte jediným příkazem a ten zamyká řádek firmy: „${cteni[0] ?? '—'}“`,
    cteni.length === 1 && /^select f\.zabrano_do into v_firma from app\.rezervace_choice_fronta_firmy f where f\.tenant_id = p_tenant for update$/i.test(cteni[0]))
  const iFirma = telo.indexOf('from app.rezervace_choice_fronta_firmy f')
  const iFronta = telo.indexOf('from app.rezervace_choice_fronta q')
  const iTed = telo.indexOf('v_ted := clock_timestamp()')
  const iPorovnani = telo.indexOf('if v_firma > v_ted')
  ok('pořadí: zámek firmy, zámek fronty, teprve pak čas a porovnání (zámky vždy ve stejném pořadí)',
    iFirma > 0 && iFirma < iFronta && iFronta < iTed && iTed < iPorovnani)

  // Vstup úlohy (nezávislé ověření PR #163, nález 3): firmu nebere, takže
  // zámek řádku fronty je JEDINÉ, co ji řadí za souběžné tlačítko — bez
  // něj by obě dostaly tentýž čas. Souběh zkouší krok105 (2b, jen CI),
  // tady text, který jde pustit všude.
  const zUlohy = sql.indexOf('create function public.rezervace_choice_zabrat_dotaz_ulohy(')
  const teloUlohy = zUlohy < 0 ? '' : sql.slice(zUlohy, sql.indexOf('end $$;', zUlohy))
  ok('vyříznutí vstupu úlohy z migrace něco našlo (kontrola nečte prázdno)',
    teloUlohy.length > 300 && teloUlohy.includes('dalsi_volny') && teloUlohy.includes('v_ted := clock_timestamp()'))
  const cteniFronty = teloUlohy.split(';').map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /^select\b/i.test(p) && /\bdalsi_volny\b/.test(p))
  ok(`vstup úlohy čte dalsi_volny jediným příkazem a ten zamyká řádek fronty: „${cteniFronty[0] ?? '—'}“`,
    cteniFronty.length === 1 && /^select q\.dalsi_volny into v_volny from app\.rezervace_choice_fronta q where q\.jediny for update$/i.test(cteniFronty[0]))
  ok('… a čas měří až po tom zámku',
    teloUlohy.indexOf('from app.rezervace_choice_fronta q') > 0
    && teloUlohy.indexOf('from app.rezervace_choice_fronta q') < teloUlohy.indexOf('v_ted := clock_timestamp()'))
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
  // „choice-test-pozdeji“ dostane test, který nedoběhl z KTERÉHOKOLI
  // dočasného důvodu — i plná fronta (Foodtab zrovna načítá jinde).
  // Nezávislé ověření 26. 10.: text uváděl jen „Choice neodpovídá nebo
  // omezuje dotazy“, takže člověk hledal chybu u Choice.
  const pozdeji = /'choice-test-pozdeji':\s*'([^']+)'/.exec(hlasky)?.[1] ?? ''
  ok(`„choice-test-pozdeji“ uvádí i plnou frontu, nejen výpadek Choice: „${pozdeji.slice(0, 90)}…“`,
    /neodpovídá/.test(pozdeji) && /omezuje/.test(pozdeji) && /Foodtab z Choice zrovna načítá/.test(pozdeji) && /Ověřit znovu/.test(pozdeji))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
