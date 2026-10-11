#!/usr/bin/env node
/**
 * Komerční banka — ADAA (lib/kb-adaa.ts), bez sítě.
 *
 * Síť je podstrčená, takže test ověří PŘESNÝ tvar požadavků podle
 * oficiální specifikace KB (developers.kb.cz, Account Direct Access API
 * v2, OAuth2 v3, Application Registration) a výklad odpovědí.
 *
 * Pusť `node scripts/kb-adaa.test.mjs`.
 */

import { createCipheriv, randomBytes } from 'node:crypto'

const kb = await import('../lib/kb-adaa.ts')
const {
  ADRESY_KB, adresaAutorizace, adresaRegistrace, konfiguraceKb, nactiTransakce, nactiUcty, nactiZustatky,
  kbJeNaCase, novyKlicSifrovani, oknoStahovani, platnostSouhlasu, prevestTransakci, prevestZustatky, rozsifrovatRegistraci, stahnoutPohyby, vymenitKod, ziskatAccessToken,
} = kb

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const KONF = { prostredi: 'sandbox', softwareStatement: 'eyJhbGciOiJSUzI1NiJ9.TEST.podpis', apiKeyOauth: 'klic-oauth', apiKeyData: 'klic-data' }
const KONF_PROD = { ...KONF, prostredi: 'produkce' }

function sit(odpovedi) {
  const pozadavky = []
  const fetchFn = async (url, init = {}) => {
    pozadavky.push({ url, init })
    const dalsi = odpovedi.shift()
    if (!dalsi) throw new Error(`nečekaný požadavek ${url}`)
    if (dalsi === 'sit-spadla') throw new TypeError('fetch failed')
    return new Response(dalsi.telo === undefined ? '' : JSON.stringify(dalsi.telo), { status: dalsi.status, headers: dalsi.hlavicky ?? {} })
  }
  return { fetchFn, pozadavky }
}

console.log('\n== Konfigurace ==')
{
  ok('bez proměnných → napojení vypnuté (null)', konfiguraceKb({}) === null)
  ok('neznámé prostředí → null', konfiguraceKb({ KB_ADAA_PROSTREDI: 'test', KB_ADAA_SOFTWARE_STATEMENT: 'x', KB_ADAA_API_KEY_OAUTH: 'a', KB_ADAA_API_KEY_DATA: 'b' }) === null)
  const k = konfiguraceKb({ KB_ADAA_PROSTREDI: 'produkce', KB_ADAA_SOFTWARE_STATEMENT: ' ss ', KB_ADAA_API_KEY_OAUTH: 'a', KB_ADAA_API_KEY_DATA: 'b' })
  ok('úplná konfigurace se načte a ořízne', k?.prostredi === 'produkce' && k.softwareStatement === 'ss')
  ok('adresy produkce podle dokumentace', ADRESY_KB.produkce.data === 'https://api-gateway.kb.cz/adaa/v2' && ADRESY_KB.produkce.token === 'https://api-gateway.kb.cz/oauth2/v3/access_token' && ADRESY_KB.produkce.autorizace === 'https://login.kb.cz/autfe/ssologin')
  ok('adresy sandboxu podle dokumentace', ADRESY_KB.sandbox.data === 'https://api-gateway.kb.cz/sandbox/adaa/v2' && ADRESY_KB.sandbox.registraceUi === 'https://api-gateway.kb.cz/sandbox/client-registration-ui/v2/saml/register')
}

console.log('\n== Registrace aplikace ==')
{
  const klic = novyKlicSifrovani()
  ok('klíč AES-256: 44 znaků base64 = 32 bajtů', klic.length === 44 && Buffer.from(klic, 'base64').length === 32)
  const adresa = new URL(adresaRegistrace(KONF, { klicSifrovani: klic, navratUri: 'https://app.cz/api/integrace/kb/vratit', state: 'ST' }))
  ok('jde na registrační UI sandboxu', adresa.origin + adresa.pathname === ADRESY_KB.sandbox.registraceUi)
  ok('state se předá beze změny', adresa.searchParams.get('state') === 'ST')
  const pozadavek = JSON.parse(Buffer.from(adresa.searchParams.get('registrationRequest'), 'base64').toString('utf8'))
  ok('registrationRequest = base64 JSON s klíčem a algoritmem', pozadavek.encryptionKey === klic && pozadavek.encryptionAlg === 'AES-256')
  ok('… se software statementem a návratovou adresou', pozadavek.softwareStatement === KONF.softwareStatement && pozadavek.redirectUris[0] === 'https://app.cz/api/integrace/kb/vratit')
  ok('appka žádá JEN čtení účtu (scope adaa, žádné platby)', JSON.stringify(pozadavek.scope) === '["adaa"]' && pozadavek.applicationType === 'web')

  // Odpověď KB: AES/GCM/NoPadding, IV = salt, značka připojená na konec, URL-safe base64.
  const iv = randomBytes(12)
  const sifrator = createCipheriv('aes-256-gcm', Buffer.from(klic, 'base64'), iv)
  const data = Buffer.concat([sifrator.update(JSON.stringify({ client_id: 'Foodtab-6073', client_secret: 'tajne-123', scope: 'adaa', state: 'stav-uvnitr' }), 'utf8'), sifrator.final(), sifrator.getAuthTag()])
  const urlSafe = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  const r = rozsifrovatRegistraci(urlSafe(data), urlSafe(iv), klic)
  ok('rozšifruje client_id a client_secret', r?.clientId === 'Foodtab-6073' && r?.clientSecret === 'tajne-123')
  ok('vrátí i state z rozšifrovaného JSON (KB ho tam podle ukázky dává)', r?.state === 'stav-uvnitr')
  const pozmenena = Buffer.from(data); pozmenena[3] ^= 0xff
  ok('pozměněná data neprojdou autentizační značkou → null', rozsifrovatRegistraci(urlSafe(pozmenena), urlSafe(iv), klic) === null)
  ok('cizí klíč → null', rozsifrovatRegistraci(urlSafe(data), urlSafe(iv), novyKlicSifrovani()) === null)
  ok('nesmysl → null, ne výjimka', rozsifrovatRegistraci('xx', 'yy', klic) === null)
}

console.log('\n== Souhlas (autorizační kód) ==')
{
  const a = new URL(adresaAutorizace(KONF_PROD, { clientId: 'Foodtab-6073', navratUri: 'https://app.cz/api/integrace/kb/vratit', state: 'S2' }))
  ok('produkce: login.kb.cz/autfe/ssologin', a.origin + a.pathname === 'https://login.kb.cz/autfe/ssologin')
  ok('response_type=code, scope=adaa, client_id, redirect_uri, state',
    a.searchParams.get('response_type') === 'code' && a.searchParams.get('scope') === 'adaa' && a.searchParams.get('client_id') === 'Foodtab-6073'
    && a.searchParams.get('redirect_uri') === 'https://app.cz/api/integrace/kb/vratit' && a.searchParams.get('state') === 'S2')
}

console.log('\n== Tokeny ==')
{
  const s = sit([{ status: 200, telo: { access_token: 'AT1', refresh_token: 'RT1' } }])
  const v = await vymenitKod(KONF, { kod: 'KOD', clientId: 'C', clientSecret: 'S', navratUri: 'https://app.cz/vratit' }, s.fetchFn)
  const req = s.pozadavky[0]
  const formular = new URLSearchParams(req.init.body)
  ok('kód → refresh token (a access token z téže odpovědi)', v.stav === 'ok' && v.refreshToken === 'RT1' && v.accessToken === 'AT1')
  ok('POST na token endpoint sandboxu', req.url === ADRESY_KB.sandbox.token && req.init.method === 'POST')
  ok('formulář: grant_type=authorization_code, code, client_id, client_secret, redirect_uri',
    formular.get('grant_type') === 'authorization_code' && formular.get('code') === 'KOD' && formular.get('client_id') === 'C' && formular.get('client_secret') === 'S' && formular.get('redirect_uri') === 'https://app.cz/vratit')
  ok('hlavičky: apiKey pro OAuth2 a x-correlation-id (UUID)', req.init.headers.apiKey === 'klic-oauth' && /^[0-9a-f-]{36}$/.test(req.init.headers['x-correlation-id']) && req.init.headers['Content-Type'] === 'application/x-www-form-urlencoded')

  const s2 = sit([{ status: 200, telo: { access_token: 'AT2', expires_in: 179 } }])
  const t = await ziskatAccessToken(KONF, { clientId: 'C', clientSecret: 'S', refreshToken: 'RT1', navratUri: 'https://app.cz/vratit' }, s2.fetchFn)
  ok('refresh token → access token (grant_type=refresh_token)', t.stav === 'ok' && t.accessToken === 'AT2' && new URLSearchParams(s2.pozadavky[0].init.body).get('grant_type') === 'refresh_token')

  const s3 = sit([{ status: 400, telo: { error: 'invalid_grant', error_description: 'expired' } }])
  const n = await ziskatAccessToken(KONF, { clientId: 'C', clientSecret: 'S', refreshToken: 'stary', navratUri: 'x' }, s3.fetchFn)
  ok('invalid_grant (vypršelý souhlas) → chyba přístupu, ne dočasná', n.stav === 'chyba' && n.druh === 'pristup')
  const s3b = sit([{ status: 400, telo: { errors: [{ code: 'INVALID_GRANT', message: 'Code expired' }] } }])
  const nb = await ziskatAccessToken(KONF, { clientId: 'C', clientSecret: 'S', refreshToken: 'stary', navratUri: 'x' }, s3b.fetchFn)
  ok('INVALID_GRANT ve tvaru chyb KB (errors[0].code) se pozná taky', nb.stav === 'chyba' && nb.druh === 'pristup' && nb.duvod.includes('obnovte'))
  const s3c = sit([{ status: 401, telo: { error: 'invalid_client' } }])
  const nc = await ziskatAccessToken(KONF, { clientId: 'C', clientSecret: 'S', refreshToken: 'R', navratUri: 'x' }, s3c.fetchFn)
  ok('invalid_client → nová registrace (odpojit a připojit), ne „obnovte souhlas“', nc.stav === 'chyba' && nc.druh === 'pristup' && nc.duvod.includes('odpojte') && !nc.duvod.includes('obnovte'))

  const s4 = sit(['sit-spadla'])
  const n2 = await ziskatAccessToken(KONF, { clientId: 'C', clientSecret: 'S', refreshToken: 'R', navratUri: 'x' }, s4.fetchFn)
  ok('spadlá síť → dočasná chyba, ne výjimka', n2.stav === 'chyba' && n2.druh === 'docasna')
}

console.log('\n== Účty ==')
{
  const s = sit([{ status: 200, telo: [
    { accountId: 'Q1ox', iban: 'CZ6501000000001234567890', currency: 'CZK', nameI18N: 'Provozní účet', productI18N: 'Profi účet' },
    { accountId: 'Q2ox', iban: 'CZ6501000000001234567890', currency: 'eur' },
    { iban: 'bez-id' },
  ] }])
  const u = await nactiUcty(KONF, 'AT', s.fetchFn)
  ok('GET /accounts na datové API s Bearer a apiKey pro ADAA', s.pozadavky[0].url === `${ADRESY_KB.sandbox.data}/accounts` && s.pozadavky[0].init.headers.Authorization === 'Bearer AT' && s.pozadavky[0].init.headers.apiKey === 'klic-data')
  ok('dva účty (vícoměnový = dvě accountId), bez accountId se vynechá', u.stav === 'ok' && u.ucty.length === 2)
  ok('název z nameI18N, měna velkými písmeny', u.stav === 'ok' && u.ucty[0].nazev === 'Provozní účet' && u.ucty[1].mena === 'EUR')
}

console.log('\n== Převod pohybu ==')
{
  const zakl = {
    lastUpdated: '2026-10-10T08:00:00Z', accountType: 'KB', iban: 'CZ65', transactionType: 'DOMESTIC', status: 'BOOK',
    bookingDate: '2026-10-09', valueDate: '2026-10-10', creditDebitIndicator: 'DEBIT', amount: { value: 1234.56, currency: 'CZK' },
    counterParty: { name: 'Makro Cash & Carry', accountNo: '123456789', bankCode: '0300' },
    references: { accountServicer: 'SGWD000000653288', variable: '2026001', receiver: 'Faktura 2026001', myDescription: 'zelenina' },
    entryReference: 'NENI-UNIKATNI',
  }
  const r = prevestTransakci(zakl, 'CZK')
  ok('DEBIT → výdaj, částka v haléřích', r?.smer === 'vydaj' && r.castkaHaleru === 123456)
  ok('datum zaúčtování (bookingDate)', r?.datum === '2026-10-09')
  ok('VS z references.variable', r?.vs === '2026001')
  ok('externí id = references.accountServicer (ne entryReference)', r?.externiId === 'SGWD000000653288')
  ok('protistrana = jméno; poznámka = zpráva pro příjemce + popis pro mě', r?.protistrana === 'Makro Cash & Carry' && r.poznamka === 'Faktura 2026001 · zelenina')
  ok('CREDIT → příjem', prevestTransakci({ ...zakl, creditDebitIndicator: 'CREDIT' }, 'CZK')?.smer === 'prijem')
  ok('záporná hodnota u DEBIT nepřeklopí směr (absolutní hodnota)', prevestTransakci({ ...zakl, amount: { value: -10, currency: 'CZK' } }, 'CZK')?.castkaHaleru === 1000)
  ok('blokace PDNG se nezapisuje (přijde později jako BOOK)', prevestTransakci({ ...zakl, status: 'PDNG' }, 'CZK') === null)
  ok('bez accountServicer se nezapisuje (zdvojilo by se)', prevestTransakci({ ...zakl, references: { variable: '1' } }, 'CZK') === null)
  ok('nulová částka se nezapisuje', prevestTransakci({ ...zakl, amount: { value: 0, currency: 'CZK' } }, 'CZK') === null)
  ok('bez jména protistrany → číslo účtu/kód banky', prevestTransakci({ ...zakl, counterParty: { accountNo: '19-2000145399', bankCode: '0800' } }, 'CZK')?.protistrana === '19-2000145399/0800')
  ok('neznámý směr → nezapisovat', prevestTransakci({ ...zakl, creditDebitIndicator: 'X' }, 'CZK') === null)
  ok('částka přes 21 mil. Kč (mimo sloupec integer) se vynechá, nezasekne zápis okna', prevestTransakci({ ...zakl, amount: { value: 25_000_000, currency: 'CZK' } }, 'CZK') === null
    && prevestTransakci({ ...zakl, amount: { value: 21_474_836.47, currency: 'CZK' } }, 'CZK')?.castkaHaleru === 2_147_483_647)
}

console.log('\n== Plánování úlohy ==')
{
  const ted = new Date('2026-10-11T04:15:00Z')
  const pred = (h) => new Date(ted.getTime() - h * 3_600_000).toISOString()
  ok('nikdy nesynchronizováno → na řadě', kbJeNaCase(null, null, 1440, ted) === true)
  ok('1× denně: po 23,5 h už na řadě (úloha běží à 4 h, jinak by den vypadl)', kbJeNaCase(pred(23.5), pred(23.5), 1440, ted) === true)
  ok('1× denně: po 22 h ještě ne', kbJeNaCase(pred(22), pred(22), 1440, ted) === false)
  ok('neúspěšný pokus před 2 h → ne znovu hned (počítá se od pokusu, ne od úspěchu)', kbJeNaCase(pred(72), pred(2), 1440, ted) === false)
  ok('krátký odstup (60 min) bez tolerance', kbJeNaCase(pred(59 / 60), null, 60, ted) === false && kbJeNaCase(pred(1), null, 60, ted) === true)
}

console.log('\n== Pohyby: stránkování a limit ==')
{
  const t = (id, stav = 'BOOK') => ({ status: stav, bookingDate: '2026-10-01', creditDebitIndicator: 'CREDIT', amount: { value: 100, currency: 'CZK' }, references: { accountServicer: id } })
  const s = sit([
    { status: 200, telo: { content: [t('A'), t('B', 'PDNG')], last: false, first: true, empty: false, pageNumber: 0, pageSize: 100, totalPages: 2, numberOfElements: 2 } },
    { status: 200, telo: { content: [t('C'), { status: 'BOOK', creditDebitIndicator: 'CREDIT', amount: { value: 1 }, bookingDate: '2026-10-02', references: {} }], last: true, first: false, empty: false, pageNumber: 1, pageSize: 100, totalPages: 2, numberOfElements: 2 } },
  ])
  const od = new Date('2026-01-01T00:00:00Z'), doDatum = new Date('2026-10-11T10:00:00Z')
  const v = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1/ox', menaUctu: 'CZK', od, do: doDatum }, s.fetchFn)
  const u0 = new URL(s.pozadavky[0].url)
  const u1 = s.pozadavky[1] ? new URL(s.pozadavky[1].url) : null
  ok('dvě stránky: page=0, pak page=1, dokud last není true', s.pozadavky.length === 2 && u0.searchParams.get('page') === '0' && u1?.searchParams.get('page') === '1')
  ok('size=100 a fromDateTime/toDateTime v UTC (ISO)', u0.searchParams.get('size') === '100' && u0.searchParams.get('fromDateTime') === '2026-01-01T00:00:00.000Z' && u0.searchParams.get('toDateTime') === '2026-10-11T10:00:00.000Z')
  ok('accountId se v cestě zakóduje', u0.pathname.endsWith('/accounts/Q1%2Fox/transactions'))
  ok('zapíšou se jen BOOK s identifikátorem (A, C)', v.stav === 'ok' && v.radky.map((r) => r.externiId).join() === 'A,C')
  ok('BOOK bez identifikátoru se započte do vynechaných', v.stav === 'ok' && v.vynechano === 1 && v.stranek === 2)

  const s2 = sit([{ status: 429, telo: { errors: [{ code: 'REQUEST_IS_THROTTLED', message: 'Unchanged data download limit reached.' }] }, hlavicky: { 'Retry-After': '1800' } }])
  const n = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', od, do: doDatum }, s2.fetchFn)
  ok('429 (limit 61 minut) → dočasná chyba s Retry-After', n.stav === 'chyba' && n.druh === 'docasna' && n.zkusitZaSekund === 1800)

  const s3 = sit([{ status: 403, telo: { errors: [{ code: 'ACCOUNT_ACCESS_DENIED', message: 'denied' }] } }])
  const n3 = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', od, do: doDatum }, s3.fetchFn)
  ok('403 ACCOUNT_ACCESS_DENIED → chyba přístupu s kódem v hlášce', n3.stav === 'chyba' && n3.druh === 'pristup' && n3.duvod.includes('ACCOUNT_ACCESS_DENIED'))
  const s3b = sit([{ status: 401, telo: { code: '900901', message: 'Invalid Credentials' } }])
  const n3b = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', od, do: doDatum }, s3b.fetchFn)
  ok('401 od brány (špatný API klíč appky) → NE chyba přístupu firmy, připojení zůstane v úloze', n3b.stav === 'chyba' && n3b.druh === 'jina' && n3b.duvod.includes('900901'))
  const s3c = sit([{ status: 403, telo: { errors: [{ code: 'REJECTED_BY_FW', message: 'Rejected by firewall rules' }] } }])
  const n3c = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', od, do: doDatum }, s3c.fetchFn)
  ok('403 REJECTED_BY_FW → NE chyba přístupu firmy', n3c.stav === 'chyba' && n3c.druh === 'jina')

  const s4 = sit([{ status: 200, telo: { neco: 1 } }])
  const n4 = await nactiTransakce(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', od, do: doDatum }, s4.fetchFn)
  ok('neočekávaný tvar → chyba, ne prázdný úspěch', n4.stav === 'chyba' && n4.druh === 'jina')
}

console.log('\n== Zůstatky ==')
{
  const z = prevestZustatky([
    { type: 'PREVIOUSLY_CLOSED_BOOK', creditDebitIndicator: 'CREDIT', amount: { value: 15000.5, currency: 'CZK' }, validAt: '2026-10-10T22:00:00Z' },
    { type: 'CLOSING_AVAILABLE', creditDebitIndicator: 'DEBIT', amount: { value: 200, currency: 'CZK' }, validAt: '2026-10-11T09:00:00Z' },
  ], 'CZK')
  const knihovni = z.find((b) => b.typ === 'knihovni'), disponibilni = z.find((b) => b.typ === 'disponibilni')
  ok('PREVIOUSLY_CLOSED_BOOK → knihovní (účetní) zůstatek', knihovni?.castkaHaleru === 1500050 && knihovni.platnyK === '2026-10-10T22:00:00Z')
  ok('CLOSING_AVAILABLE → disponibilní; DEBIT = záporný', disponibilni?.castkaHaleru === -20000)
  ok('bez PREVIOUSLY_CLOSED_BOOK se vezme CLOSING_BOOKED', prevestZustatky([{ type: 'CLOSING_BOOKED', creditDebitIndicator: 'CREDIT', amount: { value: 1, currency: 'CZK' }, validAt: '2026-10-10T00:00:00Z' }], 'CZK')[0]?.typ === 'knihovni')
  ok('neplatná odpověď → prázdně, ne výjimka', prevestZustatky({ x: 1 }, 'CZK').length === 0)

  const s = sit([{ status: 200, telo: [] }])
  await nactiZustatky(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK' }, s.fetchFn)
  ok('GET /accounts/{id}/balances', s.pozadavky[0].url === `${ADRESY_KB.sandbox.data}/accounts/Q1/balances`)
}

console.log('\n== Platnost souhlasu ==')
{
  const ted = new Date('2026-10-11T10:00:00Z')
  const jwt = (obsah) => `hlavicka.${Buffer.from(JSON.stringify(obsah)).toString('base64url')}.podpis`
  ok('platnost z exp v refresh tokenu', platnostSouhlasu(jwt({ exp: Date.UTC(2027, 9, 9) / 1000 }), ted) === '2027-10-09')
  ok('token bez exp → 364 dní od teď', platnostSouhlasu(jwt({ sub: 'x' }), ted) === '2027-10-10')
  ok('nečitelný token → 364 dní od teď, ne výjimka', platnostSouhlasu('nesmysl', ted) === '2027-10-10')
  ok('exp v minulosti se nebere (odhad od teď)', platnostSouhlasu(jwt({ exp: Date.UTC(2020, 0, 1) / 1000 }), ted) === '2027-10-10')
}

console.log('\n== Okno stahování ==')
{
  const ted = new Date('2026-10-11T10:00:00Z')
  const prvni = oknoStahovani(null, '2026-03-01', ted)
  ok('první stažení od historie_od, okno nejvýš 31 dní', prvni.od.toISOString() === '2026-03-01T00:00:00.000Z' && prvni.do.toISOString() === '2026-04-01T00:00:00.000Z' && prvni.posledni === false)
  ok('bez historie_od od 1. 1. letošního roku', oknoStahovani(null, undefined, ted).od.toISOString() === '2026-01-01T00:00:00.000Z')
  const dalsi = oknoStahovani('2026-10-10T06:00:00Z', '2026-01-01', ted)
  ok('další stažení od uloženého postupu minus 7 dní až do teď', dalsi.od.toISOString() === '2026-10-03T06:00:00.000Z' && dalsi.do === ted && dalsi.posledni === true)
  const stara = oknoStahovani(null, '2023-01-01', ted)
  ok('nikdy víc než 2 roky zpátky (KB starší vrací chybou)', ted.getTime() - stara.od.getTime() < 2 * 365 * 86_400_000)
}

console.log('\n== Stahování po měsících ==')
{
  const ted = new Date('2026-10-11T10:00:00Z')
  const t = (id) => ({ status: 'BOOK', bookingDate: '2026-09-01', creditDebitIndicator: 'CREDIT', amount: { value: 1, currency: 'CZK' }, references: { accountServicer: id } })
  const stranka = (obsah, last = true) => ({ status: 200, telo: { content: obsah, last } })

  // Historie od 1. 8.: tři okna (1. 8.–1. 9., 25. 8.–25. 9., 18. 9.–teď), každé se hned uloží.
  const s = sit([stranka([t('A')]), stranka([t('B')]), stranka([t('C')])])
  const ulozeno = []
  const v = await stahnoutPohyby(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', stazenoDo: null, historieOd: '2026-08-01', ted },
    async (radky, doKdy) => { ulozeno.push([radky.map((r) => r.externiId).join(), doKdy.toISOString()]); return null }, s.fetchFn)
  const oknaOd = s.pozadavky.map((p) => new URL(p.url).searchParams.get('fromDateTime'))
  ok('dlouhá historie se stahuje po měsících, každé okno navazuje s překryvem 7 dní',
    oknaOd.join() === '2026-08-01T00:00:00.000Z,2026-08-25T00:00:00.000Z,2026-09-18T00:00:00.000Z')
  ok('každé okno se uloží hned i s postupem (stazeno_do)',
    JSON.stringify(ulozeno) === JSON.stringify([['A', '2026-09-01T00:00:00.000Z'], ['B', '2026-09-25T00:00:00.000Z'], ['C', '2026-10-11T10:00:00.000Z']]))
  ok('po dohnání do teď: ok, dohnano', v.stav === 'ok' && v.dohnano === true && v.stranek === 3)

  // Strop stránek na běh: první okno má 50 stránek → konec, zbytek příště.
  const plne = Array.from({ length: 50 }, (_, i) => stranka([t(`P${i}`)], i === 49))
  const s2 = sit(plne)
  let ulozeni2 = 0
  const v2 = await stahnoutPohyby(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', stazenoDo: null, historieOd: '2026-01-01', ted },
    async () => { ulozeni2++; return null }, s2.fetchFn)
  ok('po 50 stránkách běh skončí a nechá zbytek na příště (dohnano: false)', v2.stav === 'ok' && v2.dohnano === false && ulozeni2 === 1 && s2.pozadavky.length === 50)

  // Chyba zápisu okna zastaví stahování — postup se neposune.
  const s3 = sit([stranka([t('X')]), stranka([t('Y')])])
  const v3 = await stahnoutPohyby(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', stazenoDo: null, historieOd: '2026-08-01', ted },
    async () => ({ stav: 'chyba', druh: 'jina', duvod: 'zápis selhal' }), s3.fetchFn)
  ok('chyba zápisu okna → chyba, další okno se nestahuje', v3.stav === 'chyba' && v3.duvod === 'zápis selhal' && s3.pozadavky.length === 1)

  // Časový strop: každé okno „trvá" 20 s → po druhém (40 s) se další nezačne.
  const s4 = sit([stranka([t('A')]), stranka([t('B')]), stranka([t('C')])])
  let cas = 0
  const v4 = await stahnoutPohyby(KONF, { accessToken: 'AT', accountId: 'Q1', menaUctu: 'CZK', stazenoDo: null, historieOd: '2026-08-01', ted },
    async () => { cas += 20_000; return null }, s4.fetchFn, () => cas)
  ok('po 25 s běh další okno nezačne (dohnano: false) — akce i návrat z KB mají strop 60 s', v4.stav === 'ok' && v4.dohnano === false && s4.pozadavky.length === 2)
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
