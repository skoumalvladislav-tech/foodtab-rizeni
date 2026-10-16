#!/usr/bin/env node
/**
 * Dotykačka pro Jiné platby — katalog, účty, účet podle klíče a
 * NEPŘIPOJENÝ skladový výdej (lib/pokladna-dotykacka-sklad.ts), bez sítě.
 *
 * Síť je podstrčená (`vytvoritDotykacku(fetchFn)`, `kontextDotykacky(fetchFn, …)`),
 * takže test ověří PŘESNÉ požadavky podle docs.api.dotypos.com (16. 10. 2026,
 * API 2026.38.2):
 *   GET  …/v2/clouds/:cloudId/products?page=&limit=100
 *   GET  …/v2/clouds/:cloudId/orders?filter=_branchId|eq|…;created|gteq|…;created|lt|…&include=orderItems&sort=created&page=&limit=100[&namedFilter=openOrders]
 *   GET  …/v2/clouds/:cloudId/orders?filter=externalId|eq|<klíč>&include=orderItems&page=1&limit=100
 *   POST …/v2/clouds/:cloudId/branches/:branchId/pos-actions  {action: order/create-issue-pay, …}
 * a výklad odpovědí („všechna čísla jsou řetězce").
 *
 * Živě to ověřené NENÍ — co ověřit na testovacím cloudu, je u
 * `odeslatVydejDotykacka`.
 *
 * Pusť `node scripts/pokladna-dotykacka-sklad.test.mjs`.
 */

import { readFileSync } from 'node:fs'

const { API_DOTYKACKA, vytvoritDotykacku, kontextDotykacky } = await import('../lib/pokladna-dotykacka.ts')
const {
  CASOVY_LIMIT_POS_AKCE_MS,
  LIMIT_STRANKY,
  MAX_STRAN_KATALOGU,
  MAX_STRAN_UCTU,
  PLATBA_ODPIS,
  naparsovatProdukt,
  naparsovatUcet,
  odeslatVydejDotykacka,
} = await import('../lib/pokladna-dotykacka-sklad.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Podstrčená síť: odpovědi podle pořadí, zapisuje požadavky. */
function sit(odpovedi) {
  const pozadavky = []
  const fetchFn = async (url, init = {}) => {
    pozadavky.push({ url, init })
    const dalsi = odpovedi.shift()
    if (!dalsi) throw new Error(`nečekaný požadavek ${url}`)
    if (dalsi === 'sit-spadla') throw new TypeError('fetch failed')
    if (dalsi === 'cas-vyprsel') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    return new Response(dalsi.telo === undefined ? '' : JSON.stringify(dalsi.telo), { status: dalsi.status })
  }
  return { fetchFn, pozadavky }
}

const UDAJE = { refresh_token: 'refresh-abc-123-xyz-0000000', cloud_id: '123' }
const PRIHLASENI = { status: 201, telo: { accessToken: 'AT-S' } }

/** Otevře relaci přes skutečný adaptér (přihlášení + další odpovědi). */
async function relaceS(odpovedi) {
  const s = sit([PRIHLASENI, ...odpovedi])
  const o = await vytvoritDotykacku(s.fetchFn).otevrit(UDAJE)
  if (o.stav !== 'ok') throw new Error('přihlášení v testu selhalo')
  // Bez přihlášení — testy počítají jen požadavky relace.
  s.pozadavky.length = 0
  return { relace: o.relace, pozadavky: s.pozadavky }
}

const produkt = (id, jine = {}) => ({ id: String(id), name: `Produkt ${id}`, unit: 'Piece', stockDeduct: 'true', deleted: 'false', ...jine })
const plnaStrana = (od, dalsi = 'x') => ({ currentPage: '1', nextPage: dalsi, data: Array.from({ length: LIMIT_STRANKY }, (_, i) => produkt(od + i)) })

console.log('\n== Katalog: výklad produktu ==')
{
  const p = naparsovatProdukt({
    id: '501', name: '  Pilsner 0,5 l  ', unit: 'Liter', packaging: '0.5', stockDeduct: 'true', deleted: 'false',
    plu: ['12', '  ', 34], ean: '8594001234567', recipe: 'Natočit, nechat usadit.', priceWithVat: '59.00',
  })
  ok('id jako text, název oříznutý', p.externiId === '501' && p.nazev === 'Pilsner 0,5 l')
  ok('unit → jednotka beze změny (hodnota výčtu units)', p.jednotka === 'Liter')
  ok('packaging (počet kusů v balení) se do míry NEbere → mira null', p.mira === null)
  ok('stockDeduct "true" → odecitaSklad true', p.odecitaSklad === true)
  ok('plu: prázdné vyhozené, číslo jako text; ean jako jediný text → pole', JSON.stringify(p.plu) === '["12","34"]' && JSON.stringify(p.ean) === '["8594001234567"]')
  ok('maRecepturu null i s polem recipe (je to postup, ne suroviny)', p.maRecepturu === null)
  ok('smazano false', p.smazano === false)

  const q = naparsovatProdukt({ id: 7, packaging: '0', deleted: 'true', stockDeduct: false })
  ok('bez názvu → „Produkt <id>"', q.nazev === 'Produkt 7')
  ok('ani packaging 0 míru nedá', q.mira === null)
  ok('stockDeduct false → false (ne null)', q.odecitaSklad === false)
  ok('deleted "true" → smazano', q.smazano === true)
  const r = naparsovatProdukt({ id: '8' })
  ok('chybějící stockDeduct → null (neví se), chybějící unit → null, plu/ean → []', r.odecitaSklad === null && r.jednotka === null && r.plu.length === 0 && r.ean.length === 0)
  ok('produkt bez id → null', naparsovatProdukt({ name: 'Bez id' }) === null)
}

console.log('\n== Katalog: stránkování a konec ==')
{
  const { relace, pozadavky } = await relaceS([
    { status: 200, telo: plnaStrana(1, '2') },
    { status: 200, telo: { currentPage: '2', nextPage: null, data: [produkt(101), produkt(102), produkt(103)] } },
  ])
  const k = await relace.katalog()
  ok('dvě stránky (100 + 3) → 103 produktů', k.stav === 'ok' && k.produkty.length === 103 && k.produkty.at(-1).externiId === '103')
  ok('GET /v2/clouds/123/products?page=1&limit=100', pozadavky[0]?.url === `${API_DOTYKACKA}/clouds/123/products?page=1&limit=100`)
  ok('druhá stránka page=2, s Bearer z přihlášení', pozadavky[1]?.url === `${API_DOTYKACKA}/clouds/123/products?page=2&limit=100` && pozadavky[1].init.headers.Authorization === 'Bearer AT-S')
  ok('bez include (suroviny by mohly vrátit 403)', !pozadavky[0]?.url.includes('include'))
  ok('po kratší stránce se dál neptá', pozadavky.length === 2)

  const s404 = await relaceS([{ status: 200, telo: plnaStrana(1, '2') }, { status: 404 }])
  const k404 = await s404.relace.katalog()
  ok('404 na další stránce = konec, ne chyba', k404.stav === 'ok' && k404.produkty.length === 100)

  const sPrazdna = await relaceS([{ status: 200, telo: plnaStrana(1, '2') }, { status: 200, telo: { nextPage: '3', data: [] } }])
  const kPrazdna = await sPrazdna.relace.katalog()
  ok('prázdná stránka = konec (i když nextPage ještě něco tvrdí)', kPrazdna.stav === 'ok' && kPrazdna.produkty.length === 100 && sPrazdna.pozadavky.length === 2)

  const sNull = await relaceS([{ status: 200, telo: plnaStrana(1, null) }])
  const kNull = await sNull.relace.katalog()
  ok('plná stránka s výslovným nextPage: null = konec (produkty počty znají)', kNull.stav === 'ok' && kNull.produkty.length === 100 && sNull.pozadavky.length === 1)

  const sHole = await relaceS([{ status: 200, telo: plnaStrana(1).data }, { status: 404 }])
  const kHole = await sHole.relace.katalog()
  ok('holé pole bez obálky: plná stránka → ptá se dál', kHole.stav === 'ok' && kHole.produkty.length === 100 && sHole.pozadavky.length === 2)

  const sNic = await relaceS([{ status: 404 }])
  const kNic = await sNic.relace.katalog()
  ok('404 hned na první stránce = prázdný katalog', kNic.stav === 'ok' && kNic.produkty.length === 0)

  const strop = Array.from({ length: MAX_STRAN_KATALOGU }, (_, i) => ({ status: 200, telo: plnaStrana(i * LIMIT_STRANKY + 1, String(i + 2)) }))
  const sStrop = await relaceS(strop)
  const kStrop = await sStrop.relace.katalog()
  ok(`strop ${MAX_STRAN_KATALOGU} plných stránek → CHYBA jina, ne tichý ořez`, kStrop.stav === 'chyba' && kStrop.druh === 'jina' && /větší, než appka zatím načte/.test(kStrop.duvod))
  ok(`a ${MAX_STRAN_KATALOGU + 1}. stránku už nečte`, sStrop.pozadavky.length === MAX_STRAN_KATALOGU)

  const sBezId = await relaceS([{ status: 200, telo: { data: [produkt(1), { name: 'Bez id' }] } }])
  const kBezId = await sBezId.relace.katalog()
  ok('produkt bez id → chyba jina (tvaru appka nerozumí, neúplný katalog nevrací)', kBezId.stav === 'chyba' && kBezId.druh === 'jina')
  const sTvar = await relaceS([{ status: 200, telo: { nic: 1 } }])
  ok('odpověď bez data → chyba jina', (await sTvar.relace.katalog()).stav === 'chyba')
}

console.log('\n== Katalog: chyby jako u tržeb ==')
{
  const pripady = [
    [{ status: 401 }, (v) => v.druh === 'pristup', '401 → pristup'],
    [{ status: 403, telo: { reason: 'LICENSE_UPGRADE_REQUIRED' } }, (v) => v.druh === 'jina' && v.duvod.includes('LICENSE_UPGRADE_REQUIRED'), '403 LICENSE_UPGRADE_REQUIRED → jina'],
    [{ status: 403, telo: { reason: 'ACCESS_TOKEN_EXPIRED' } }, (v) => v.druh === 'docasna' && v.celoplosna === true, '403 ACCESS_TOKEN_EXPIRED → docasna celoplošná'],
    [{ status: 429 }, (v) => v.druh === 'docasna' && v.celoplosna === true, '429 → docasna celoplošná'],
    [{ status: 503 }, (v) => v.druh === 'docasna' && !v.celoplosna, '503 → docasna'],
    ['cas-vyprsel', (v) => v.druh === 'docasna' && /vypršel čas/.test(v.duvod), 'timeout → docasna'],
    ['sit-spadla', (v) => v.druh === 'docasna' && /spojení selhalo/.test(v.duvod), 'spadlá síť → docasna'],
  ]
  for (const [odpoved, podminka, popis] of pripady) {
    const { relace } = await relaceS([odpoved])
    const v = await relace.katalog()
    ok(`katalog: ${popis}`, v.stav === 'chyba' && podminka(v))
  }
}

const OD = Date.UTC(2026, 9, 15, 3, 0)
const DO = Date.UTC(2026, 9, 16, 3, 0)
const ucet = (id, jine = {}) => ({
  id: String(id), _branchId: '456', _cloudId: '123', created: String(OD + 1000), status: 'closed', paid: 'true',
  flags: '0', documentType: 'RECEIPT', documentNumber: `D-${id}`, totalValueRounded: '100.00', currency: 'CZK', orderItems: [], ...jine,
})

console.log('\n== Účty: přesný dotaz ==')
{
  const { relace, pozadavky } = await relaceS([{ status: 200, telo: { data: [ucet(1)] } }])
  const v = await relace.ucty('456', OD, DO)
  const ocekavana = `${API_DOTYKACKA}/clouds/123/orders?filter=_branchId%7Ceq%7C456%3Bcreated%7Cgteq%7C${OD}%3Bcreated%7Clt%7C${DO}&include=orderItems&sort=created&page=1&limit=100`
  ok('přesná URL: filtr na provozovnu a okno created [od, do), include=orderItems, sort=created, page, limit', pozadavky[0]?.url === ocekavana)
  const url = new URL(pozadavky[0]?.url ?? 'http://x')
  ok('filtr po dekódování: _branchId|eq|456;created|gteq|<od>;created|lt|<do>', url.searchParams.get('filter') === `_branchId|eq|456;created|gteq|${OD};created|lt|${DO}`)
  ok('bez namedFilter, když se nechtějí jen otevřené', !url.searchParams.has('namedFilter'))
  ok('s Bearer z přihlášení', pozadavky[0]?.init.headers.Authorization === 'Bearer AT-S')
  ok('jeden účet, úplný seznam', v.stav === 'ok' && v.ucty.length === 1 && v.uplne === true)

  const otevrene = await relaceS([{ status: 200, telo: { data: [] } }])
  await otevrene.relace.ucty('456', OD, DO, { jenOtevrene: true })
  const urlOtevrene = new URL(otevrene.pozadavky[0]?.url ?? 'http://x')
  ok('jenOtevrene → namedFilter=openOrders (a filtr okna zůstává)', urlOtevrene.searchParams.get('namedFilter') === 'openOrders' && urlOtevrene.searchParams.get('filter')?.startsWith('_branchId|eq|456;'))

  const spatna = await relaceS([])
  const vSpatna = await spatna.relace.ucty('456;deleted|eq|1', OD, DO)
  ok('id provozovny s cizími znaky → chyba bez volání (filtr nejde podstrčit)', vSpatna.stav === 'chyba' && spatna.pozadavky.length === 0)
  const okno = await spatna.relace.ucty('456', DO, OD)
  ok('obrácené okno → chyba bez volání', okno.stav === 'chyba' && spatna.pozadavky.length === 0)
  const desetinne = await spatna.relace.ucty('456', OD + 0.5, DO)
  ok('okno, které není celé ms → chyba bez volání', desetinne.stav === 'chyba' && spatna.pozadavky.length === 0)
}

console.log('\n== Účty: výklad otevřeného, uzavřeného a zrušeného účtu ==')
{
  const otevreny = naparsovatUcet(ucet(10, {
    status: 'parked', paid: 'false', completed: null, documentNumber: '', totalValueRounded: '245.50', currency: 'czk',
    orderItems: [
      { id: '1', _orderId: '10', _productId: '501', name: 'Pilsner 0,5 l', quantity: '2.000', stockDeduct: 'true', canceledDate: null },
      { id: '2', _orderId: '10', _productId: 502, name: ' Guláš ', quantity: 0.5, stockDeduct: false },
      { id: '3', _orderId: '10', _productId: '503', name: 'Kofola', quantity: '1', canceledDate: '2026-10-15T18:00:00.000Z' },
      { id: '4', _orderId: '10', name: 'Ruční položka', quantity: '1.250' },
    ],
  }))
  ok('status parked → otevreny, paid "false" → zaplaceno false', otevreny.stav === 'otevreny' && otevreny.zaplaceno === false)
  ok('totalValueRounded "245.50" → 24550 haléřů (bez float)', otevreny.celkemHaleru === 24550)
  ok('měna velkými, prázdné číslo dokladu → null', otevreny.mena === 'CZK' && otevreny.cisloDokladu === null)
  const [a, b, c, d] = otevreny.polozky
  ok('položka: _productId jako text, "2.000" → "2", stockDeduct true', a.produktId === '501' && a.mnozstvi === '2' && a.odecitaSklad === true && a.zrusena === false)
  ok('položka: číslo 0.5 → "0.5", název oříznutý, stockDeduct false', b.produktId === '502' && b.mnozstvi === '0.5' && b.nazev === 'Guláš' && b.odecitaSklad === false)
  ok('položka s canceledDate → zrusena', c.zrusena === true)
  ok('položka bez produktu: produktId null, "1.250" → "1.25", stockDeduct null', d.produktId === null && d.mnozstvi === '1.25' && d.odecitaSklad === null)

  const uzavreny = naparsovatUcet(ucet(11, { created: '2026-10-15T17:30:00.000+02:00', completed: String(OD + 5000), flags: '2048', totalValueRounded: '12.345', externalId: 'klic-11' }))
  ok('status closed → uzavreny, zaplaceno true, číslo dokladu', uzavreny.stav === 'uzavreny' && uzavreny.zaplaceno === true && uzavreny.cisloDokladu === 'D-11')
  ok('created jako ISO s pásmem → epoch ms', uzavreny.vytvorenoMs === Date.parse('2026-10-15T17:30:00.000+02:00'))
  ok('completed jako epoch ms v textu → uzavrenoMs', uzavreny.uzavrenoMs === OD + 5000)
  ok('příznak WRITEOFF (bit 11 = 2048) → odpis true', uzavreny.odpis === true)
  ok('documentType a externalId přenesené', uzavreny.typDokladu === 'RECEIPT' && uzavreny.externiKlic === 'klic-11')
  ok('"12.345" → 1235 haléřů (zaokrouhlení po číslicích)', uzavreny.celkemHaleru === 1235)
  ok('flags "0" → odpis false; bez flags → odpis null', naparsovatUcet(ucet(12)).odpis === false && naparsovatUcet(ucet(13, { flags: undefined })).odpis === null)

  ok('status canceled → zruseny', naparsovatUcet(ucet(20, { status: 'canceled' })).stav === 'zruseny')
  ok('uzavřený s canceledDate (storno) → zruseny', naparsovatUcet(ucet(21, { canceledDate: String(OD + 9000) })).stav === 'zruseny')
  ok('příznak CANCELED_FULL (bit 1 = 2) → zruseny i se statusem closed', naparsovatUcet(ucet(22, { flags: '2' })).stav === 'zruseny')
  ok('rozvozový stav on_delivery → neznamy (appka ho nevykládá)', naparsovatUcet(ucet(23, { status: 'on_delivery' })).stav === 'neznamy')
  ok('bez statusu, s completed → uzavreny; bez obojího → neznamy',
    naparsovatUcet(ucet(24, { status: undefined, completed: String(OD) })).stav === 'uzavreny' && naparsovatUcet(ucet(25, { status: undefined })).stav === 'neznamy')
  ok('paid chybí → zaplaceno null (ne false)', naparsovatUcet(ucet(26, { paid: undefined })).zaplaceno === null)
  ok('nečitelná měna → null', naparsovatUcet(ucet(27, { currency: 'Kč' })).mena === null)
  ok('položka bez množství → celý účet nečitelný (null)', naparsovatUcet(ucet(28, { orderItems: [{ _productId: '1', name: 'X' }] })) === null)
  ok('položka s množstvím "2,5" (čárka) → nečitelný', naparsovatUcet(ucet(29, { orderItems: [{ _productId: '1', name: 'X', quantity: '2,5' }] })) === null)
  ok('účet bez id → null', naparsovatUcet({ status: 'closed' }) === null)
}

console.log('\n== Účty: stránkování, pojistky, úplnost ==')
{
  const strana1 = { data: Array.from({ length: LIMIT_STRANKY }, (_, i) => ucet(1000 + i)) }
  const { relace, pozadavky } = await relaceS([{ status: 200, telo: strana1 }, { status: 200, telo: { nextPage: null, data: [ucet(2000), ucet(2001)] } }])
  const v = await relace.ucty('456', OD, DO)
  ok('100 + 2 účty, úplné', v.stav === 'ok' && v.ucty.length === 102 && v.uplne === true)
  ok('druhá stránka page=2', new URL(pozadavky[1]?.url ?? 'http://x').searchParams.get('page') === '2' && pozadavky.length === 2)

  const s404 = await relaceS([{ status: 200, telo: strana1 }, { status: 404 }])
  const v404 = await s404.relace.ucty('456', OD, DO)
  ok('404 na další stránce = konec, úplné', v404.stav === 'ok' && v404.ucty.length === 100 && v404.uplne === true)

  // U účtů API počty nevede — nextPage: null na plné stránce se NEbere jako konec.
  const sNull = await relaceS([{ status: 200, telo: { nextPage: null, data: strana1.data } }, { status: 404 }])
  const vNull = await sNull.relace.ucty('456', OD, DO)
  ok('plná stránka s nextPage null → ptá se dál (u Order lastPage/počty null)', vNull.stav === 'ok' && sNull.pozadavky.length === 2)

  const sNec = await relaceS([{ status: 200, telo: { data: [ucet(1), ucet(2, { orderItems: [{ name: 'bez množství' }] })] } }])
  const vNec = await sNec.relace.ucty('456', OD, DO)
  ok('nečitelný účet se nevrátí a seznam NENÍ úplný (uplne false)', vNec.stav === 'ok' && vNec.ucty.length === 1 && vNec.uplne === false)

  const sCizi = await relaceS([{ status: 200, telo: { data: [ucet(1), ucet(2, { _branchId: '999' })] } }])
  const vCizi = await sCizi.relace.ucty('456', OD, DO)
  ok('účet jiné provozovny (kdyby filtr nezabral) se vynechá', vCizi.stav === 'ok' && vCizi.ucty.length === 1 && vCizi.ucty[0].externiId === '1' && vCizi.uplne === true)

  const strop = Array.from({ length: MAX_STRAN_UCTU }, () => ({ status: 200, telo: strana1 }))
  const sStrop = await relaceS(strop)
  const vStrop = await sStrop.relace.ucty('456', OD, DO)
  ok(`strop ${MAX_STRAN_UCTU} plných stránek → uplne false (nenalezeno pak nic nedokazuje)`, vStrop.stav === 'ok' && vStrop.uplne === false && sStrop.pozadavky.length === MAX_STRAN_UCTU)

  const sNic = await relaceS([{ status: 404 }])
  const vNic = await sNic.relace.ucty('456', OD, DO)
  ok('404 hned = žádné účty v okně, úplné', vNic.stav === 'ok' && vNic.ucty.length === 0 && vNic.uplne === true)

  for (const [odpoved, podminka, popis] of [
    [{ status: 403 }, (x) => x.druh === 'pristup', '403 → pristup'],
    [{ status: 429 }, (x) => x.druh === 'docasna' && x.celoplosna === true, '429 → docasna celoplošná'],
    [{ status: 500 }, (x) => x.druh === 'docasna', '500 → docasna'],
    ['cas-vyprsel', (x) => x.druh === 'docasna', 'timeout → docasna'],
    [{ status: 400 }, (x) => x.druh === 'jina', '400 → jina'],
  ]) {
    const s = await relaceS([odpoved])
    const x = await s.relace.ucty('456', OD, DO)
    ok(`účty: ${popis}`, x.stav === 'chyba' && podminka(x))
  }
}

console.log('\n== Účet podle klíče ==')
{
  const KLIC = '3f2a1b4c-0000-4000-8000-000000000001'
  const { relace, pozadavky } = await relaceS([{ status: 200, telo: { data: [ucet(77, { externalId: KLIC, flags: '2048', orderItems: [{ _productId: '501', name: 'Pilsner', quantity: '2' }] })] } }])
  const v = await relace.ucetPodleKlice(KLIC)
  ok('přesná URL: filter=externalId|eq|<klíč>, include=orderItems', pozadavky[0]?.url === `${API_DOTYKACKA}/clouds/123/orders?filter=externalId%7Ceq%7C${KLIC}&include=orderItems&page=1&limit=100`)
  ok('nalezen → účet s klíčem, položkami a odpisem', v.stav === 'ok' && v.ucet?.externiId === '77' && v.ucet.externiKlic === KLIC && v.ucet.polozky.length === 1 && v.ucet.odpis === true)

  const s404 = await relaceS([{ status: 404 }])
  const v404 = await s404.relace.ucetPodleKlice(KLIC)
  ok('404 → nenalezen (ucet null), ne chyba', v404.stav === 'ok' && v404.ucet === null)
  const sPrazdno = await relaceS([{ status: 200, telo: { data: [] } }])
  const vPrazdno = await sPrazdno.relace.ucetPodleKlice(KLIC)
  ok('prázdná data → nenalezen', vPrazdno.stav === 'ok' && vPrazdno.ucet === null)

  const sDva = await relaceS([{ status: 200, telo: { data: [ucet(1, { externalId: KLIC }), ucet(2, { externalId: KLIC })] } }])
  const vDva = await sDva.relace.ucetPodleKlice(KLIC)
  ok('dva účty se stejným klíčem → chyba (zkontrolovat ručně), ne první z nich', vDva.stav === 'chyba' && vDva.druh === 'jina' && /víc účtů/.test(vDva.duvod))
  const sJiny = await relaceS([{ status: 200, telo: { data: [ucet(1, { externalId: 'jiny-klic' })] } }])
  const vJiny = await sJiny.relace.ucetPodleKlice(KLIC)
  ok('účet s JINÝM klíčem (filtr nezabral) → chyba, ne „nenalezeno"', vJiny.stav === 'chyba' && vJiny.druh === 'jina')
  const sNec = await relaceS([{ status: 200, telo: { data: [ucet(1, { externalId: KLIC, orderItems: [{ name: 'X' }] })] } }])
  const vNec = await sNec.relace.ucetPodleKlice(KLIC)
  ok('nalezený, ale nečitelný účet → chyba, NIKDY null (null by pustil druhý výdej)', vNec.stav === 'chyba' && vNec.druh === 'jina')

  const sZly = await relaceS([])
  for (const zly of ['a|eq|b', 'a;deleted|eq|1', '', 'x'.repeat(129), 'mezera v klíči']) {
    const r = await sZly.relace.ucetPodleKlice(zly)
    ok(`klíč ${JSON.stringify(zly.length > 20 ? `${zly.slice(0, 10)}…` : zly)} → chyba bez volání`, r.stav === 'chyba' && sZly.pozadavky.length === 0)
  }

  for (const [odpoved, podminka, popis] of [
    [{ status: 401 }, (x) => x.druh === 'pristup', '401 → pristup'],
    [{ status: 429 }, (x) => x.druh === 'docasna' && x.celoplosna === true, '429 → docasna celoplošná'],
    [{ status: 502 }, (x) => x.druh === 'docasna', '502 → docasna'],
    ['cas-vyprsel', (x) => x.druh === 'docasna', 'timeout → docasna'],
  ]) {
    const s = await relaceS([odpoved])
    const x = await s.relace.ucetPodleKlice(KLIC)
    ok(`klíč: ${popis} (nikdy „nenalezeno")`, x.stav === 'chyba' && podminka(x))
  }
}

console.log('\n== Skladový výdej (POS akce) — tvar a výsledek odeslání ==')
{
  const TED = Date.UTC(2026, 9, 16, 10, 0)
  const PLATNOST = TED + 10 * 60_000
  const vydej = (jine = {}) => ({
    provozovna: '456',
    klic: 'op-3f2a1b4c-0001',
    polozky: [{ produktId: '501', mnozstvi: '2' }, { produktId: '502', mnozstvi: '0.5' }],
    poznamka: 'Jiné platby: akce Novák\u0000 (doklad 42)',
    platnostDoMs: PLATNOST,
    ...jine,
  })
  const poslat = async (odpoved, v = vydej()) => {
    const s = sit(odpoved === null ? [] : [odpoved])
    const vysledek = await odeslatVydejDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT-V'), v, TED)
    return { vysledek, pozadavky: s.pozadavky }
  }

  const { vysledek, pozadavky } = await poslat({ status: 200 })
  const p = pozadavky[0]
  ok('POST na /v2/clouds/123/branches/456/pos-actions', p?.url === `${API_DOTYKACKA}/clouds/123/branches/456/pos-actions` && p.init.method === 'POST')
  ok('Bearer a Content-Type JSON', p?.init.headers.Authorization === 'Bearer AT-V' && p.init.headers['Content-Type'] === 'application/json')
  const telo = JSON.parse(p?.init.body ?? '{}')
  ok('action order/create-issue-pay', telo.action === 'order/create-issue-pay')
  ok('external-id = klíč operace', telo['external-id'] === 'op-3f2a1b4c-0001')
  ok(`payment-method-id = ${PLATBA_ODPIS} (Odpis), jako číslo`, telo['payment-method-id'] === 900000012 && PLATBA_ODPIS === 900000012)
  ok('validity = platnost v ms', telo.validity === PLATNOST)
  ok('položky: id = _productId jako číslo, qty jako číslo, v pořadí', JSON.stringify(telo.items) === '[{"id":501,"qty":2},{"id":502,"qty":0.5}]')
  ok('note: řídicí znak (\\u0000) nahrazený mezerou, jinak beze změny', telo.note === 'Jiné platby: akce Novák  (doklad 42)')
  ok('print-type none (odpis netiskne)', telo['print-type'] === 'none')
  ok('v těle nic navíc', JSON.stringify(Object.keys(telo).sort()) === JSON.stringify(['action', 'external-id', 'items', 'note', 'payment-method-id', 'print-type', 'validity']))
  ok('200 s prázdným tělem → odeslano (NE úspěch — ten až po dohledání)', vysledek.stav === 'odeslano' && vysledek.kod === null && vysledek.externiId === null)
  ok(`časový limit POS akce delší než 21 s čekání pokladny (${CASOVY_LIMIT_POS_AKCE_MS} ms)`, CASOVY_LIMIT_POS_AKCE_MS > 21_000 && p?.init.signal instanceof AbortSignal)

  const sUctem = await poslat({ status: 200, telo: { order: { id: '777', externalId: 'op-3f2a1b4c-0001' }, items: [], deviceTimestamp: '1' } })
  ok('200 s účtem → odeslano a id účtu jako nápověda', sUctem.vysledek.stav === 'odeslano' && sUctem.vysledek.externiId === '777')
  const kod0 = await poslat({ status: 200, telo: { code: '0' } })
  ok('200 s kódem 0 → odeslano', kod0.vysledek.stav === 'odeslano' && kod0.vysledek.kod === 0)

  const prosle = await poslat({ status: 200, telo: { code: 1007, message: 'Expired' } })
  ok('200 + kód 1007 EXPIRED_REQUEST → odmitnuto, dočasně (s novou platností)', prosle.vysledek.stav === 'odmitnuto' && prosle.vysledek.kod === '1007' && prosle.vysledek.docasna === true)
  const zavreno = await poslat({ status: 200, telo: { code: '3001' } })
  ok('200 + kód 3001 REGISTER_CLOSED → odmitnuto dočasně', zavreno.vysledek.stav === 'odmitnuto' && zavreno.vysledek.docasna === true)
  const neznamaAkce = await poslat({ status: 200, telo: { code: 1004 } })
  ok('200 + kód 1004 UNKNOWN_ACTION → odmitnuto trvale', neznamaAkce.vysledek.stav === 'odmitnuto' && neznamaAkce.vysledek.docasna === false)
  const platba = await poslat({ status: 200, telo: { code: 2003, message: 'Payment method not found' } })
  ok('200 + kód 2003 (účet vznikl, platba ne) → NEJASNE, ne odmítnuto', platba.vysledek.stav === 'nejasne' && /2003/.test(platba.vysledek.duvod))
  const produktChybi = await poslat({ status: 200, telo: { code: 4001 } })
  ok('200 + kód 4001 (nevíme, jestli účet vznikl napůl) → nejasne', produktChybi.vysledek.stav === 'nejasne')
  ok('text odpovědi pokladny se do důvodu nekopíruje', !platba.vysledek.duvod.includes('Payment method not found'))

  const s400 = await poslat({ status: 400, telo: { code: 1001, message: 'bad' } })
  ok('HTTP 400 s kódem → odmitnuto s tím kódem', s400.vysledek.stav === 'odmitnuto' && s400.vysledek.kod === '1001' && s400.vysledek.docasna === false)
  const s401 = await poslat({ status: 401, telo: { reason: 'INVALID_ACCESS_TOKEN' } })
  ok('HTTP 401 → odmitnuto s důvodem z reason', s401.vysledek.stav === 'odmitnuto' && s401.vysledek.kod === 'INVALID_ACCESS_TOKEN')
  const s403 = await poslat({ status: 403, telo: { reason: 'LICENSE_UPGRADE_REQUIRED' } })
  ok('HTTP 403 licence → odmitnuto, hláška jako u adaptéru', s403.vysledek.stav === 'odmitnuto' && /LICENSE_UPGRADE_REQUIRED/.test(s403.vysledek.duvod))
  const s429 = await poslat({ status: 429 })
  ok('HTTP 429 (souběžný limit) → odmitnuto dočasně', s429.vysledek.stav === 'odmitnuto' && s429.vysledek.docasna === true)
  const s404 = await poslat({ status: 404 })
  ok('HTTP 404 (pokladna nepotvrdila do 21 s) → NEJASNE (může to ještě provést)', s404.vysledek.stav === 'nejasne')
  const s500 = await poslat({ status: 500 })
  ok('HTTP 500 → nejasne', s500.vysledek.stav === 'nejasne')
  const s503 = await poslat({ status: 503 })
  ok('HTTP 503 → nejasne', s503.vysledek.stav === 'nejasne')
  const cas = await poslat('cas-vyprsel')
  ok('timeout → nejasne (neposílá se znovu naslepo)', cas.vysledek.stav === 'nejasne' && /naslepo/.test(cas.vysledek.duvod))
  const spadla = await poslat('sit-spadla')
  ok('spadlé spojení → nejasne', spadla.vysledek.stav === 'nejasne')
}

console.log('\n== Skladový výdej — co se vůbec neodešle ==')
{
  const TED = Date.UTC(2026, 9, 16, 10, 0)
  const zaklad = { provozovna: '456', klic: 'op-1', polozky: [{ produktId: '501', mnozstvi: '1' }], poznamka: '', platnostDoMs: TED + 60_000 }
  const pripady = [
    [{ platnostDoMs: TED - 1 }, 'prošlá platnost'],
    [{ platnostDoMs: TED }, 'platnost přesně teď'],
    [{ platnostDoMs: Math.floor((TED + 60_000) / 1000) }, 'platnost v sekundách (vypadá jako minulost)'],
    [{ polozky: [] }, 'bez položek'],
    [{ polozky: [{ produktId: '1234567890123456', mnozstvi: '1' }] }, 'id produktu delší než 15 číslic (JSON by ho zaokrouhlil)'],
    [{ polozky: [{ produktId: '501', mnozstvi: '0' }] }, 'množství 0'],
    [{ polozky: [{ produktId: '501', mnozstvi: '-1' }] }, 'záporné množství'],
    [{ polozky: [{ produktId: '501', mnozstvi: '1,5' }] }, 'množství s čárkou'],
    [{ polozky: [{ produktId: '501', mnozstvi: '0.0005' }] }, 'množství s víc než 3 desetinnými místy'],
    [{ klic: 'op|1' }, 'klíč s oddělovačem filtru'],
    [{ provozovna: '456/../../x' }, 'provozovna, která není číslo'],
  ]
  for (const [zmena, popis] of pripady) {
    const s = sit([])
    const v = await odeslatVydejDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT'), { ...zaklad, ...zmena }, TED)
    ok(`${popis} → odmitnuto bez jediného volání`, v.stav === 'odmitnuto' && v.kod === null && s.pozadavky.length === 0)
  }
}

console.log('\n== Schopnosti a relace: výdej NENÍ připojený ==')
{
  const adapter = vytvoritDotykacku(sit([]).fetchFn)
  ok("schopnosti: skladovyVydej 'rucne'", adapter.schopnosti.skladovyVydej === 'rucne')
  ok('schopnosti: katalog a dohledání účtů ano, čtení skladových pohybů ne',
    adapter.schopnosti.katalog === true && adapter.schopnosti.dohledaniUctu === true && adapter.schopnosti.poskytujeSkladovePohyby === false)

  const { relace } = await relaceS([])
  ok('relace má PŘESNĚ provozovny, prodeje, katalog, ucty, ucetPodleKlice — žádnou metodu zápisu',
    JSON.stringify(Object.keys(relace).sort()) === JSON.stringify(['katalog', 'prodeje', 'provozovny', 'ucetPodleKlice', 'ucty']))
  ok('a nic, co by znělo jako zápis skladu', !Object.keys(relace).some((k) => /sklad|vydej|zapis|odeslat/i.test(k)))

  const zdroj = readFileSync(new URL('../lib/pokladna-dotykacka.ts', import.meta.url), 'utf8')
  const importy = zdroj.split('\n').filter((r) => r.includes("from './pokladna-dotykacka-sklad.ts'"))
  ok('adaptér ze skladového modulu importuje jen čtení (cteniDotykacky) a typ kontextu',
    importy.length === 1 && /^import \{ cteniDotykacky, type KontextDotykacky \} from/.test(importy[0]))
  ok('odeslatVydejDotykacka se v adaptéru nevolá', !/odeslatVydejDotykacka\(/.test(zdroj))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
