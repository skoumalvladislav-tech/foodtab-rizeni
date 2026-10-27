#!/usr/bin/env node
/**
 * Dotykačka pro Jiné platby — katalog, účty, účet podle klíče a
 * NEPŘIPOJENÝ skladový výdej (lib/pokladna-dotykacka-sklad.ts), bez sítě.
 *
 * Síť je podstrčená (`vytvoritDotykacku(fetchFn)`, `kontextDotykacky(fetchFn, …)`),
 * takže test ověří PŘESNÉ požadavky podle docs.api.dotypos.com (16. 10. 2026,
 * API 2026.38.2):
 *   GET  …/v2/clouds/:cloudId/products?page=&limit=100&include=ingredients  (při 403 znovu bez include)
 *   GET  …/v2/clouds/:cloudId/manifest  (před každou POS akcí, 25. 10. 2026, API 2026.39.0)
 *   GET  …/v2/clouds/:cloudId/orders?filter=_branchId|eq|…;created|gteq|…;created|lt|…&include=orderItems&sort=created&page=&limit=100[&namedFilter=openOrders]
 *   GET  …/v2/clouds/:cloudId/orders?filter=_branchId|eq|…;completed|gteq|…;completed|lt|…&include=orderItems&sort=completed&page=&limit=100  (podle uzavření)
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

const { API_DOTYKACKA, vytvoritDotykacku, kontextDotykacky, naparsovatJson, chranitDlouhaCisla } = await import('../lib/pokladna-dotykacka.ts')
const { ZAPIS_VYDEJE_DOTYKACKA } = await import('../lib/pokladna-dotykacka-zapis.ts')
const {
  CASOVY_LIMIT_POS_AKCE_MS,
  LIMIT_STRANKY,
  MAX_STRAN_KATALOGU,
  MAX_STRAN_UCTU,
  PLATBA_ODPIS,
  naparsovatProdukt,
  naparsovatProdukty,
  naparsovatUcet,
  popisId,
  popisTvaru,
  odeslatVydejDotykacka,
  vydejZOperace,
  zapisVydejeDotykacka,
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
    // Tělo se přeruší až při čtení (hlavičky přišly, spojení spadlo uprostřed).
    if (dalsi === 'telo-prerusene' || dalsi.prerusene) {
      return new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { status: dalsi.status ?? 200 })
    }
    // `text` = syrové tělo přesně tak, jak by přišlo (neplatný JSON, dlouhá čísla…).
    if (dalsi.text !== undefined) return new Response(dalsi.text, { status: dalsi.status })
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
/** Manifest cloudu (entity/cloud-manifest), ve kterém provozovna 456 POS akce i odečet skladu umí. */
const manifest = (pobocka = {}) => ({
  status: 200,
  telo: {
    cloud: { name: 'Test', countryCode: 'CZ', currency: 'CZK' },
    branches: [
      { branchId: 999, name: 'Jiná', isLicensed: true, features: [], stockDeductionMode: 'disabled' },
      { branchId: 456, name: 'Perla', isLicensed: true, features: ['posAction'], stockDeductionMode: 'documentIssue', ...pobocka },
    ],
  },
})
const MANIFEST_OK = manifest()
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
  ok('GET /v2/clouds/123/products?page=1&limit=100&include=ingredients', pozadavky[0]?.url === `${API_DOTYKACKA}/clouds/123/products?page=1&limit=100&include=ingredients`)
  ok('druhá stránka page=2, s Bearer z přihlášení', pozadavky[1]?.url === `${API_DOTYKACKA}/clouds/123/products?page=2&limit=100&include=ingredients` && pozadavky[1].init.headers.Authorization === 'Bearer AT-S')
  ok('s recepturami bez příznaku bezReceptur', k.stav === 'ok' && k.bezReceptur === undefined)
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

  const sTvar = await relaceS([{ status: 200, telo: { nic: 1 } }, { status: 200, telo: { nic: 1 } }])
  const kTvar = await sTvar.relace.katalog()
  ok('odpověď bez data → chyba jina s popisem („nemá seznam „data““), zkoušeno s recepturami i bez (2 dotazy)',
    kTvar.stav === 'chyba' && kTvar.druh === 'jina' && kTvar.duvod.includes('odpověď nemá seznam „data“ (klíče: nic)') && sTvar.pozadavky.length === 2)
}

console.log('\n== Katalog: produkty bez čitelného id (entity/product: id je long?) ==')
{
  const sBezId = await relaceS([{ status: 200, telo: { nextPage: null, data: [produkt(1), { name: 'Bez id', id: null }, produkt(2)] } }])
  const kBezId = await sBezId.relace.katalog()
  ok('produkt s id: null mezi ostatními → katalog načten bez něj, vynechanoBezId 1 a popis první vynechané (druh id + klíče)',
    kBezId.stav === 'ok' && kBezId.produkty.length === 2 && kBezId.vynechanoBezId === 1 && kBezId.vynechanoPopis === 'id: null; klíče položky: name, id' && kBezId.bezReceptur === undefined)
  const sCely = await relaceS([{ status: 200, telo: { nextPage: null, data: [produkt(1)] } }])
  const kCely = await sCely.relace.katalog()
  ok('… bez vynechaných pole vynechanoBezId ani vynechanoPopis vůbec nejsou', kCely.stav === 'ok' && !('vynechanoBezId' in kCely) && !('vynechanoPopis' in kCely))

  // Plná stránka, na které jeden produkt id nemá, NENÍ poslední — počítají se položky stránky, ne přečtené produkty.
  const plnaSDirou = { nextPage: '2', data: plnaStrana(1).data.map((p, i) => (i === 50 ? { name: 'Bez id' } : p)) }
  const sDira = await relaceS([{ status: 200, telo: plnaSDirou }, { status: 200, telo: { nextPage: null, data: [produkt(101)] } }])
  const kDira = await sDira.relace.katalog()
  ok('plná stránka s produktem bez id → ptá se na další stránku (99 + 1 produktů, 1 vynechaný)',
    kDira.stav === 'ok' && sDira.pozadavky.length === 2 && kDira.produkty.length === 100 && kDira.vynechanoBezId === 1)

  // Produkt s null id SÁM na krátké poslední stránce nesmí shodit katalog, který by mezi ostatními jen přeskočil.
  const sPosledni = await relaceS([{ status: 200, telo: plnaStrana(1, '2') }, { status: 200, telo: { nextPage: null, data: [{ id: null, name: 'Produkt null' }] } }])
  const kPosledni = await sPosledni.relace.katalog()
  ok('poslední stránka jen s produktem bez id → katalog OK (100 produktů, 1 vynechaný), bez opakování bez receptur',
    kPosledni.stav === 'ok' && kPosledni.produkty.length === 100 && kPosledni.vynechanoBezId === 1 && sPosledni.pozadavky.length === 2 && kPosledni.bezReceptur === undefined)

  // Id nemá VŮBEC ŽÁDNÝ produkt katalogu → tvaru appka nerozumí. Zkusí se bez receptur; když ani tam, chyba s popisem.
  const bezIdStrana = { data: [{ name: 'A', productId: '5' }, { name: 'B', productId: '6' }] }
  const sZadne = await relaceS([{ status: 200, telo: bezIdStrana }, { status: 200, telo: bezIdStrana }])
  const kZadne = await sZadne.relace.katalog()
  ok('žádný produkt s id → chyba jina, zkoušeno s recepturami i bez (2 dotazy, druhý bez include)',
    kZadne.stav === 'chyba' && kZadne.druh === 'jina' && sZadne.pozadavky.length === 2 && !sZadne.pozadavky[1].url.includes('include'))
  ok('… hláška: kolik položek, druh id, názvy klíčů — bez hodnot',
    kZadne.duvod.includes('s recepturami: žádná z 2 položek katalogu nemá čitelné id — id: chybí; klíče položky: name, productId') &&
      kZadne.duvod.includes('znovu bez receptur — žádná z 2 položek') && !kZadne.duvod.includes('"A"') && !/\b5\b/.test(kZadne.duvod))
  const sJedna = await relaceS([{ status: 200, telo: { data: [{ id: 'x' }] } }, { status: 200, telo: { data: [{ id: 'x' }] } }])
  ok('… skloňování „žádná z 1 položky"', (await sJedna.relace.katalog()).duvod.includes('žádná z 1 položky katalogu'))
}

console.log('\n== Katalog: receptury — kdy znovu bez nich a kdy ne ==')
{
  // PRVNÍ stránce s recepturami appka nerozumí, bez nich ano → katalog BEZ receptur s popisem, čemu nerozuměla.
  const sRec = await relaceS([{ status: 200, telo: { vysledek: [] } }, { status: 200, telo: { nextPage: null, data: [produkt(1), produkt(2)] } }])
  const kRec = await sRec.relace.katalog()
  ok('1. stránka s recepturami bez „data", bez nich OK → produkty, bezRecepturProc „tvar" a bezRecepturPopis se strukturou',
    kRec.stav === 'ok' && kRec.produkty.length === 2 && kRec.bezReceptur === true && kRec.bezRecepturProc === 'tvar' &&
      kRec.bezRecepturPopis === 'stránka 1 s recepturami: odpověď nemá seznam „data“ (klíče: vysledek)' && kRec.produkty.every((p) => p.suroviny === null))
  const sRecHtml = await relaceS([{ status: 200, text: '<html>x</html>' }, { status: 200, telo: { nextPage: null, data: [produkt(1)] } }])
  const kRecHtml = await sRecHtml.relace.katalog()
  ok('1. stránka s recepturami není JSON, bez nich OK → katalog bez receptur, popis „odpověď není JSON"',
    kRecHtml.stav === 'ok' && kRecHtml.bezRecepturProc === 'tvar' && kRecHtml.bezRecepturPopis?.startsWith('stránka 1 s recepturami: odpověď není JSON: 14 znaků'))
  const s403 = await relaceS([{ status: 403, telo: { reason: 'ACCESS_DENIED' } }, { status: 200, telo: { nextPage: null, data: [produkt(1)] } }])
  const k403 = await s403.relace.katalog()
  ok('… u 403 je důvod „pravo" a popis tvaru žádný', k403.stav === 'ok' && k403.bezRecepturProc === 'pravo' && !('bezRecepturPopis' in k403))

  // DALŠÍ stránka s recepturami nečitelná: první stránce s recepturami appka rozuměla → nejde o receptury.
  // Znovu bez nich by jen vymazalo uložené receptury — nic se neuloží, chyba (u nečitelného těla dočasná).
  const necitelne = [
    ['HTML místo JSON', { status: 200, text: '<html>Bad gateway</html>' }],
    ['prázdné tělo', { status: 200 }],
    ['uříznutý JSON', { status: 200, text: '{"nextPage":null,"data":[{"id":"101","name":"Kof' }],
  ]
  for (const [popis, odpoved] of necitelne) {
    const s = await relaceS([{ status: 200, telo: plnaStrana(1, '2') }, odpoved])
    const k = await s.relace.katalog()
    ok(`2. stránka s recepturami: ${popis} → dočasná chyba „nepřišel celý", NIC se neopakuje bez receptur (2 dotazy)`,
      k.stav === 'chyba' && k.druh === 'docasna' && /Katalog z Dotykačky nepřišel celý \(stránka 2 s recepturami: /.test(k.duvod) && /Nic se neuložilo/.test(k.duvod) && s.pozadavky.length === 2)
  }
  const sStruktura = await relaceS([{ status: 200, telo: plnaStrana(1, '2') }, { status: 200, telo: { nextPage: null, data: [produkt(101), 'x'] } }])
  const kStruktura = await sStruktura.relace.katalog()
  ok('2. stránka s položkou, která není objekt → chyba jina s popisem, bez opakování (2 dotazy)',
    kStruktura.stav === 'chyba' && kStruktura.druh === 'jina' && kStruktura.duvod.includes('stránka 2 s recepturami: položka 2 z 2 je string, ne objekt') && sStruktura.pozadavky.length === 2)
}

console.log('\n== Katalog: popis tvaru — jen struktura, žádné hodnoty ==')
{
  const sHtml = await relaceS([{ status: 200, text: '  <html>chyba</html>' }, { status: 200, text: '  <html>chyba</html>' }])
  const kHtml = await sHtml.relace.katalog()
  ok('HTML místo JSON → „odpověď není JSON: 20 znaků, začíná „<““ (text odpovědi v hlášce není)',
    kHtml.stav === 'chyba' && kHtml.duvod.includes('odpověď není JSON: 20 znaků, začíná „<“') && !kHtml.duvod.includes('html>'))
  const sPrazdne = await relaceS([{ status: 200 }, { status: 200 }])
  ok('prázdné tělo se stavem 200 → „odpověď přišla prázdná"', /stránka 1 s recepturami: odpověď přišla prázdná/.test((await sPrazdne.relace.katalog()).duvod))
  const sNull = await relaceS([{ status: 200, text: 'null' }, { status: 200, text: 'null' }])
  ok('tělo JSON null → „odpověď je JSON null" (ne „prázdná")', /odpověď je JSON null/.test((await sNull.relace.katalog()).duvod))
  const sUriznute = await relaceS([{ status: 200, text: '{"nextPage":null,"data":[{"id":"1","name":"Kof' }, { status: 200, text: '{"data":[{"id":"1"},' }])
  const kUriznute = await sUriznute.relace.katalog()
  ok('uříznutý JSON (neuzavřený řetězec i konec vstupu) → „chyba až na konci — odpověď je nejspíš uříznutá"',
    (kUriznute.duvod.match(/chyba až na konci — odpověď je nejspíš uříznutá/g) ?? []).length === 2 && !kUriznute.duvod.includes('Kof'))
  const vadnyEscape = '{"data":[{"id":"1","name":"a\\x"}]}'
  const sEscape = await relaceS([{ status: 200, text: vadnyEscape }, { status: 200, text: vadnyEscape }])
  const kEscape = await sEscape.relace.katalog()
  ok('vadný escape uprostřed → pozice a druh znaku („chyba na znaku 30 (písmeno)"), ne znak sám',
    kEscape.duvod.includes('odpověď není JSON: 34 znaků, začíná „{“, chyba na znaku 30 (písmeno)') && !kEscape.duvod.includes('a\\x'))
  const sZnak = await relaceS([{ status: 200, text: '%%%' }, { status: 200, text: String.fromCharCode(1) + 'abc' }])
  const kZnak = await sZnak.relace.katalog()
  ok('první znak mimo bezpečnou sadu (%, řídicí) → „jiný znak"', (kZnak.duvod.match(/začíná „jiný znak“/g) ?? []).length === 2)

  ok('popisTvaru: data jako objekt → klíče UVNITŘ data i klíče odpovědi',
    popisTvaru({ status: 200, telo: { currentPage: '1', data: { items: [], total: '1' } } }) === '„data“ je object, ne seznam (klíče v „data“: items, total; klíče odpovědi: currentPage, data)')
  ok('popisTvaru: data jako text → typ a klíče odpovědi', popisTvaru({ status: 200, telo: { data: 'x' } }) === '„data“ je string, ne seznam (klíče odpovědi: data)')
  ok('popisTvaru: bez data → klíče odpovědi', popisTvaru({ status: 200, telo: { produkty: [] } }) === 'odpověď nemá seznam „data“ (klíče: produkty)')
  ok('popisTvaru: text místo objektu', popisTvaru({ status: 200, telo: 'ahoj' }) === 'odpověď je string, ne objekt')
  ok('popisTvaru: seznam se skloňováním', popisTvaru({ status: 200, telo: [1, 2] }) === 'odpověď je seznam s 2 položkami' && popisTvaru({ status: 200, telo: [1] }) === 'odpověď je seznam s 1 položkou')
  const mnohoKlicu = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]))
  ok('popisTvaru: nejvýš 12 klíčů, zbytek jako počet', popisTvaru({ status: 200, telo: mnohoKlicu }).endsWith('k11 … (+3))'))
  ok('popisTvaru: dlouhý název klíče zkrácený na 40 znaků', popisTvaru({ status: 200, telo: { ['k'.repeat(100)]: 1 } }) === `odpověď nemá seznam „data“ (klíče: ${'k'.repeat(40)})`)

  const nObj = naparsovatProdukty({ data: [produkt(1), 'x'] })
  ok('naparsovatProdukty: položka, která není objekt → „položka 2 z 2 je string, ne objekt"', nObj.chyba === 'položka 2 z 2 je string, ne objekt')
  const nSeznam = naparsovatProdukty({ data: [[1, 2]] })
  ok('naparsovatProdukty: položka, která je seznam → „položka 1 z 1 je seznam, ne objekt"', nSeznam.chyba === 'položka 1 z 1 je seznam, ne objekt')
  const nBez = naparsovatProdukty({ data: [{ id: 12.5 }, { id: -3 }] })
  ok('naparsovatProdukty: produkty bez čitelného id → 0 produktů, bezId 2, popis první (rozhoduje až volající po všech stránkách)',
    nBez.produkty?.length === 0 && nBez.bezId === 2 && nBez.bezIdPopis === 'id: desetinné číslo; klíče položky: id')

  // Každá větev popisId zvlášť: přesný popis a NIKDY hodnota.
  const pripady = [
    [undefined, 'chybí'],
    [null, 'null'],
    [12.5, 'desetinné číslo'],
    [-3, 'záporné číslo'],
    [1e20, 'číslo nad 2^53'],
    ['1'.repeat(21), 'číslo jako text, 21 číslic (víc než 20)'],
    ['-7136048451797860123', 'záporné číslo jako text (19 číslic)'],
    ['-5', 'záporné číslo jako text (1 číslice)'],
    ['ABC-1', 'text s 5 znaky, ne jen číslice'],
    ['A', 'text s 1 znakem, ne jen číslice'],
    ['  ', 'prázdný text'],
    [{ a: 1 }, 'object'],
    [true, 'boolean'],
  ]
  for (const [id, cekam] of pripady) {
    const p = popisId(id)
    // Hodnota v popisu nesmí být — kromě null/undefined, kde je „hodnota" zároveň druhem.
    const hodnota = typeof id === 'string' ? id.trim() : typeof id === 'number' ? String(id) : ''
    const nazev = typeof id === 'string' ? `text o ${id.length} znacích` : id === null ? 'null' : typeof id
    ok(`popisId(${nazev}) → „${cekam}"`, p === cekam && (hodnota.length < 2 || !p.includes(hodnota)))
  }
}

console.log('\n== Přerušené tělo odpovědi (pozadavek) ==')
{
  const sPreruseno = await relaceS(['telo-prerusene'])
  const kPreruseno = await sPreruseno.relace.katalog()
  ok('katalog: tělo 200 přerušené při čtení → docasna „neposlala celou odpověď", jediný dotaz',
    kPreruseno.stav === 'chyba' && kPreruseno.druh === 'docasna' && /neposlala celou odpověď/.test(kPreruseno.duvod) && sPreruseno.pozadavky.length === 1)

  // POS akce: u 401/403 rozhoduje stav jako dřív (k pokladně nedošlo = odmítnuto), přerušené tělo to nesmí změnit na „nejasné".
  const TED = Date.UTC(2026, 9, 16, 10, 0)
  const v = { provozovna: '456', klic: 'op-3f2a1b4c-0001', polozky: [{ produktId: '501', mnozstvi: '2' }], poznamka: 'x', platnostDoMs: TED + 10 * 60_000 }
  for (const status of [401, 403]) {
    const s = sit([MANIFEST_OK, { prerusene: true, status }])
    const r = await odeslatVydejDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT'), v, TED)
    ok(`POS akce ${status} s přerušeným tělem → odmítnuto (k pokladně nedošlo), ne „nejasné"`, r.stav === 'odmitnuto' && s.pozadavky.length === 2)
  }
  const s200 = sit([MANIFEST_OK, { prerusene: true, status: 200 }])
  const r200 = await odeslatVydejDotykacka(kontextDotykacky(s200.fetchFn, '123', 'AT'), v, TED)
  ok('POS akce 200 s přerušeným tělem → nejasné (dohledá se podle klíče), ne „odesláno"', r200.stav === 'nejasne')
}

console.log('\n== JSON odpovědi: dlouhá čísla, řídicí znaky, BOM (naparsovatJson) ==')
{
  const id = '7136048451797860123'
  const v = naparsovatJson(`{"data":[{"id":${id},"_categoryId":-1234567890123456789,"name":"Pivo 12345678901234567","cena":1234567890123456.5,"x":1.12345678901234567,"e":1e1234567890123456,"f":-1.5e-1234567890123456,"m":-12}]}`)
  ok('id jako číslo s 19 číslicemi → přesně jako text (JSON.parse by ho zaokrouhlil)', v?.data?.[0]?.id === id)
  ok('záporné dlouhé číslo → text i se znaménkem', v?.data?.[0]?._categoryId === '-1234567890123456789')
  ok('číslice uvnitř řetězce se nemění', v?.data?.[0]?.name === 'Pivo 12345678901234567')
  ok('desetinné číslo (i s 16 číslicemi před tečkou, i za ní) a exponent (i se znaménkem) zůstávají čísly',
    typeof v?.data?.[0]?.cena === 'number' && typeof v?.data?.[0]?.x === 'number' && v?.data?.[0]?.e === Infinity && Object.is(v?.data?.[0]?.f, -0) && v?.data?.[0]?.m === -12)
  // Práh 16 číslic: 9007199254740993 (= 2^53 + 1) má 16 číslic a JSON.parse by ho zaokrouhlil.
  for (const cislo of ['9007199254740993', '12345678901234567', '123456789012345678']) {
    ok(`${cislo.length} číslic (${cislo.length === 16 ? '2^53 + 1' : 'nad 2^53'}) → přesně jako text`, naparsovatJson(`{"id":${cislo}}`)?.id === cislo)
  }
  ok('15 číslic zůstává číslem (bezpečné celé číslo)', naparsovatJson('{"id":123456789012345}')?.id === 123456789012345)
  ok('escapovaná uvozovka a zpětné lomítko v řetězci nerozhodí hledání čísel',
    naparsovatJson('{"a":"x\\"1234567890123456789\\\\","b":1234567890123456789}')?.b === '1234567890123456789' &&
      naparsovatJson('{"a":"x\\"1234567890123456789\\\\"}')?.a === 'x"1234567890123456789\\')
  ok('syrový tabulátor a konec řádku uvnitř řetězce → přečteno (nahrazeno mezerou)', naparsovatJson('{"data":[{"id":"1","recipe":"a\tb\nc"}]}')?.data?.[0]?.recipe === 'a b c')
  ok('BOM na začátku → přečteno', naparsovatJson(String.fromCharCode(0xfeff) + '{"a":1}')?.a === 1)
  ok('ani po opravách to JSON není → undefined', naparsovatJson('<html>') === undefined && naparsovatJson('{"a":') === undefined)
  ok('chranitDlouhaCisla: bez dlouhého celého čísla vrací tentýž text', chranitDlouhaCisla('{"a":[1,-2,3.5e10,"12345678901234567"]}') === '{"a":[1,-2,3.5e10,"12345678901234567"]}')

  // Obří řetězec (regex s backtrackingem tady přetekl zásobník) a neuzavřený řetězec plný escapů (kvadratický regex).
  const obri = `{"id":1234567890123456789,"recipe":"${'a'.repeat(9_000_000)}"}`
  let vyjimka = null
  let obriV
  try {
    obriV = naparsovatJson(obri)
  } catch (e) {
    vyjimka = e
  }
  ok('řetězec s 9 mil. znaků a dlouhým číslem → bez výjimky, id přesně', vyjimka === null && obriV?.id === '1234567890123456789' && obriV?.recipe?.length === 9_000_000)
  const escapy = '{"id":1234567890123456789,"recipe":"' + '\\"'.repeat(50_000)
  const t0 = performance.now()
  const escapyV = naparsovatJson(escapy)
  const ms = performance.now() - t0
  ok(`neuzavřený řetězec s 50 000 escapy → undefined rychle (${Math.round(ms)} ms < 1000)`, escapyV === undefined && ms < 1000)

  // Porovnání s JSON.parse: bez dlouhých celých čísel musí vyjít totéž.
  let rozdilu = 0
  for (let k = 0; k < 300; k++) {
    const x = { a: k, b: -k * 1.5, c: `t${k}"\\${'9'.repeat(k % 20)}`, d: [k * 1e-7, -k, null, true, { e: String(k).repeat(k % 7) }], f: k % 3 === 0 ? 1e300 : 0.5 }
    const text = JSON.stringify(x)
    if (JSON.stringify(naparsovatJson(text)) !== JSON.stringify(JSON.parse(text))) rozdilu++
  }
  ok('300 JSON bez dlouhých celých čísel → stejné jako JSON.parse', rozdilu === 0)

  const sDlouhe = await relaceS([{ status: 200, text: `{"nextPage":null,"data":[{"id":${id},"name":"Kofola"}]}` }])
  const kDlouhe = await sDlouhe.relace.katalog()
  ok('katalog s id jako dlouhým číslem → produkt s přesným id', kDlouhe.stav === 'ok' && kDlouhe.produkty[0]?.externiId === id)
}

console.log('\n== Katalog: receptury (include=ingredients, 25. 10.) ==')
{
  const svickova = naparsovatProdukt(produkt(10, {
    stockDeduct: 'false',
    ingredients: [
      { id: '1', _parentProductId: '10', _productId: '501', quantity: '0.150', unit: 'Kilogram', deleted: 'false' },
      { id: '2', _parentProductId: '10', _productId: 502, quantity: 0.1, unit: 'Liter' },
      { id: '3', _parentProductId: '10', _productId: '503', quantity: '1', unit: 'Piece', deleted: 'true' },
    ],
  }))
  ok('pokrm s recepturou: maRecepturu true, suroviny podle id suroviny, smazaná vynechaná',
    svickova.maRecepturu === true && svickova.suroviny.length === 2 && svickova.suroviny[0].produkt === '501' && svickova.suroviny[1].produkt === '502')
  ok('… množství jako text s tečkou bez koncových nul, jednotka beze změny',
    svickova.suroviny[0].mnozstvi === '0.15' && svickova.suroviny[0].jednotka === 'Kilogram' && svickova.suroviny[1].mnozstvi === '0.1')
  const pivo = naparsovatProdukt(produkt(11, { ingredients: [] }))
  ok('prázdné ingredients → bez receptury (maRecepturu false, suroviny [])', pivo.maRecepturu === false && Array.isArray(pivo.suroviny) && pivo.suroviny.length === 0)
  const bezKlice = naparsovatProdukt(produkt(12))
  ok('bez klíče ingredients → neví se (null), NE „bez receptury" — pokrm by vypadl z výdeje', bezKlice.maRecepturu === null && bezKlice.suroviny === null)
  const necitelna = naparsovatProdukt(produkt(13, { ingredients: [{ _productId: '501', quantity: '1' }, { quantity: '2' }] }))
  ok('surovina bez id → celá receptura neznámá (null), ne neúplná', necitelna.maRecepturu === null && necitelna.suroviny === null)
  const neniPole = naparsovatProdukt(produkt(14, { ingredients: 'x' }))
  ok('ingredients, které nejsou pole → neví se', neniPole.maRecepturu === null)
  const nula = naparsovatProdukt(produkt(15, { ingredients: [{ _productId: '501', quantity: '0' }, { _productId: '502', quantity: 'hodně' }] }))
  ok('nulové nebo nečitelné množství suroviny → null (nic se nedomýšlí), surovina zůstává', nula.maRecepturu === true && nula.suroviny[0].mnozstvi === null && nula.suroviny[1].mnozstvi === null)

  // 403 jen kvůli receptuře → celý katalog znovu BEZ include, s příznakem.
  const s403 = await relaceS([
    { status: 403, telo: { reason: 'ACCESS_DENIED' } },
    { status: 200, telo: { nextPage: null, data: [produkt(1, { ingredients: [{ _productId: '9', quantity: '1' }] }), produkt(2)] } },
  ])
  const k403 = await s403.relace.katalog()
  ok('403 (bez práva na receptury) → katalog znovu bez include, bezReceptur: true', k403.stav === 'ok' && k403.bezReceptur === true && k403.produkty.length === 2)
  ok('… druhý dotaz už bez include=ingredients', s403.pozadavky.length === 2 && s403.pozadavky[0].url.includes('include=ingredients') && !s403.pozadavky[1].url.includes('include'))
  ok('… bez include je receptura neznámá u všech (i kdyby odpověď ingredients nesla)', k403.produkty.every((p) => p.maRecepturu === null && p.suroviny === null))

  const sDvakrat = await relaceS([{ status: 403, telo: {} }, { status: 403, telo: { reason: 'DOMAIN_FORBIDDEN' } }])
  const kDvakrat = await sDvakrat.relace.katalog()
  ok('403 i bez receptur → chyba (ne prázdný katalog)', kDvakrat.stav === 'chyba' && sDvakrat.pozadavky.length === 2)

  const sToken = await relaceS([{ status: 403, telo: { reason: 'ACCESS_TOKEN_EXPIRED' } }])
  const kToken = await sToken.relace.katalog()
  ok('403 kvůli tokenu se neopakuje bez receptur (týká se celého volání) → chyba po jednom dotazu', kToken.stav === 'chyba' && sToken.pozadavky.length === 1)

  const sDruha = await relaceS([
    { status: 200, telo: plnaStrana(1, '2') },
    { status: 403, telo: {} },
    { status: 200, telo: plnaStrana(1, '2') },
    { status: 200, telo: { nextPage: null, data: [produkt(101)] } },
  ])
  const kDruha = await sDruha.relace.katalog()
  ok('403 až na druhé stránce → celý katalog znovu od první stránky bez receptur (ne napůl)',
    kDruha.stav === 'ok' && kDruha.bezReceptur === true && kDruha.produkty.length === 101 && sDruha.pozadavky[2].url.includes('page=1') && !sDruha.pozadavky[2].url.includes('include'))
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

console.log('\n== Účty podle data UZAVŘENÍ (completed) ==')
{
  // docs.api.dotypos.com/entity/order/: `completed` je filtrovatelné skupinou NUMBER (gteq, lt) a řaditelné.
  const { relace, pozadavky } = await relaceS([{ status: 200, telo: { data: [ucet(1, { completed: String(OD + 5000) })] } }])
  const v = await relace.ucty('456', OD, DO, { podle: 'uzavreni' })
  const ocekavana = `${API_DOTYKACKA}/clouds/123/orders?filter=_branchId%7Ceq%7C456%3Bcompleted%7Cgteq%7C${OD}%3Bcompleted%7Clt%7C${DO}&include=orderItems&sort=completed&page=1&limit=100`
  ok('přesná URL: okno completed [od, do), sort=completed, include=orderItems, page, limit', pozadavky[0]?.url === ocekavana)
  const url = new URL(pozadavky[0]?.url ?? 'http://x')
  ok('filtr po dekódování: _branchId|eq|456;completed|gteq|<od>;completed|lt|<do> (žádné created)',
    url.searchParams.get('filter') === `_branchId|eq|456;completed|gteq|${OD};completed|lt|${DO}` && !url.searchParams.get('filter').includes('created'))
  ok('účet se vrátí s datem uzavření, seznam úplný', v.stav === 'ok' && v.ucty.length === 1 && v.ucty[0].uzavrenoMs === OD + 5000 && v.uplne === true)

  const vytvoreni = await relaceS([{ status: 200, telo: { data: [] } }])
  await vytvoreni.relace.ucty('456', OD, DO, { podle: 'vytvoreni' })
  ok('podle: vytvoreni = výchozí okno created a sort=created',
    vytvoreni.pozadavky[0]?.url === `${API_DOTYKACKA}/clouds/123/orders?filter=_branchId%7Ceq%7C456%3Bcreated%7Cgteq%7C${OD}%3Bcreated%7Clt%7C${DO}&include=orderItems&sort=created&page=1&limit=100`)

  const dve = await relaceS([
    { status: 200, telo: { data: Array.from({ length: LIMIT_STRANKY }, (_, i) => ucet(i + 1)) } },
    { status: 200, telo: { data: [ucet(500)] } },
  ])
  const vDve = await dve.relace.ucty('456', OD, DO, { podle: 'uzavreni' })
  const druha = new URL(dve.pozadavky[1]?.url ?? 'http://x')
  ok('stránkování podle uzavření: druhá stránka page=2 se stejným filtrem completed',
    vDve.stav === 'ok' && vDve.ucty.length === 101 && druha.searchParams.get('page') === '2' && druha.searchParams.get('filter')?.includes(';completed|gteq|') && druha.searchParams.get('sort') === 'completed')

  const spatne = await relaceS([])
  const otevreneUzavreni = await spatne.relace.ucty('456', OD, DO, { podle: 'uzavreni', jenOtevrene: true })
  ok('podle uzavření + jen otevřené → chyba bez volání (otevřený účet datum uzavření nemá)',
    otevreneUzavreni.stav === 'chyba' && otevreneUzavreni.druh === 'jina' && spatne.pozadavky.length === 0)
  const nesmysl = await spatne.relace.ucty('456', OD, DO, { podle: 'zruseni' })
  ok('neznámé „podle" → chyba bez volání (nehádá se okno)', nesmysl.stav === 'chyba' && spatne.pozadavky.length === 0)
  const zdrojSkladu = readFileSync(new URL('../lib/pokladna-dotykacka-sklad.ts', import.meta.url), 'utf8')
  ok('filtr podle completed je podložený odkazem na dokumentaci (entity/order a general/filter)',
    zdrojSkladu.includes('https://docs.api.dotypos.com/entity/order/') && zdrojSkladu.includes('https://docs.api.dotypos.com/api-reference/general/filter') &&
      /`completed`[^*]*NUMBER/.test(zdrojSkladu))
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
  // Před každou POS akcí se čte manifest (licence, režim odečtu) — tady vyhovující.
  const poslat = async (odpoved, v = vydej()) => {
    const s = sit(odpoved === null ? [MANIFEST_OK] : [MANIFEST_OK, odpoved])
    const vysledek = await odeslatVydejDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT-V'), v, TED)
    return { vysledek, pozadavky: s.pozadavky }
  }

  const { vysledek, pozadavky } = await poslat({ status: 200 })
  ok('nejdřív GET /v2/clouds/123/manifest, pak POS akce (dva požadavky)', pozadavky.length === 2 && pozadavky[0].url === `${API_DOTYKACKA}/clouds/123/manifest` && (pozadavky[0].init.method ?? 'GET') === 'GET')
  const p = pozadavky[1]
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
  // N19: „nic se neprovedlo" u 4xx JEN pro kódy z KODY_NEPROVEDENO — stejně jako u HTTP 200.
  const s400p = await poslat({ status: 400, telo: { code: 2003, message: 'Payment method not found' } })
  ok('HTTP 400 + kód 2003 (účet vznikl, platba ne) → NEJASNE, ne odmítnuto', s400p.vysledek.stav === 'nejasne' && /2003/.test(s400p.vysledek.duvod))
  const s422 = await poslat({ status: 422, telo: { code: 4001 } })
  ok('HTTP 422 + kód 4001 (produkt) → nejasne', s422.vysledek.stav === 'nejasne' && /4001/.test(s422.vysledek.duvod))
  const s400n = await poslat({ status: 400, telo: { code: 9999 } })
  ok('HTTP 400 + neznámý kód 9999 → nejasne', s400n.vysledek.stav === 'nejasne' && /9999/.test(s400n.vysledek.duvod))
  const s409 = await poslat({ status: 409, telo: { code: '4002' } })
  ok('HTTP 409 + kód 4002 (text) → nejasne', s409.vysledek.stav === 'nejasne')
  const s400b = await poslat({ status: 400 })
  ok('HTTP 400 bez těla (bez kódu) → nejasne', s400b.vysledek.stav === 'nejasne' && /bez kódu/.test(s400b.vysledek.duvod))
  const s408 = await poslat({ status: 408 })
  ok('HTTP 408 bez těla → nejasne (dohledá se podle klíče)', s408.vysledek.stav === 'nejasne' && /dohledá/.test(s408.vysledek.duvod))
  const s408k = await poslat({ status: 408, telo: { code: 1001 } })
  ok('HTTP 408 i s kódem 1001 → nejasne (čas vypršel, nevíme)', s408k.vysledek.stav === 'nejasne')
  const s400z = await poslat({ status: 400, telo: { code: 3001 } })
  ok('HTTP 400 + kód 3001 REGISTER_CLOSED (ve výčtu) → odmitnuto dočasně', s400z.vysledek.stav === 'odmitnuto' && s400z.vysledek.kod === '3001' && s400z.vysledek.docasna === true)
  const s400r = await poslat({ status: 400, telo: { code: 1001 } })
  ok('HTTP 400 + kód 1001 REQUEST_ERROR (ve výčtu) zůstává odmitnuto, trvale („nic se neprovedlo")',
    s400r.vysledek.stav === 'odmitnuto' && s400r.vysledek.kod === '1001' && s400r.vysledek.docasna === false && /nic se neprovedlo/.test(s400r.vysledek.duvod))
  ok('text odpovědi se ani u 4xx do důvodu nekopíruje', !s400p.vysledek.duvod.includes('Payment method not found'))
  const s429 = await poslat({ status: 429 })
  ok('HTTP 429 (souběžný limit) → nejasne (brána nic neslibuje — dohledá se)', s429.vysledek.stav === 'nejasne' && /429/.test(s429.vysledek.duvod))
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

console.log('\n== Skladový výdej — manifest provozovny před POS akcí (25. 10.) ==')
{
  const TED = Date.UTC(2026, 9, 16, 10, 0)
  const v = { provozovna: '456', klic: 'op-1', polozky: [{ produktId: '501', mnozstvi: '1' }], poznamka: '', platnostDoMs: TED + 60_000 }
  const pripady = [
    ['sit-spadla', (x) => x.docasna === true && /nepodařilo přečíst/.test(x.duvod), 'manifest nejde přečíst (síť) → odmítnuto dočasně'],
    [{ status: 403, telo: { reason: 'DOMAIN_FORBIDDEN' } }, (x) => x.docasna === false, 'manifest 403 (aplikace ho nesmí číst) → odmítnuto'],
    [{ status: 503 }, (x) => x.docasna === true, 'manifest 503 → odmítnuto dočasně'],
    [{ status: 200, telo: { nic: 1 } }, (x) => /neočekávaný tvar/.test(x.duvod), 'manifest bez branches → odmítnuto (tvar)'],
    [{ status: 200, telo: { branches: [{ branchId: 999, isLicensed: true, features: ['posAction'], stockDeductionMode: 'documentIssue' }] } }, (x) => /není/.test(x.duvod), 'provozovna v manifestu není → odmítnuto'],
    [manifest({ isLicensed: false }), (x) => /licenci/.test(x.duvod), 'bez aktivní licence → odmítnuto'],
    [manifest({ features: [] }), (x) => /posAction/.test(x.duvod), 'licence bez posAction → odmítnuto'],
    [manifest({ stockDeductionMode: 'disabled' }), (x) => /vypnutý odečet/.test(x.duvod), 'odečet skladu vypnutý → odmítnuto (sklad by se neodečetl)'],
    [manifest({ stockDeductionMode: 'neco' }), (x) => /nezná/.test(x.duvod), 'neznámý režim odečtu → odmítnuto'],
    [manifest({ stockDeductionMode: undefined }), (x) => /nezná/.test(x.duvod), 'režim odečtu chybí → odmítnuto (nejde ověřit)'],
    // create-issue-pay účet nezaparkuje — u odečtu při zaparkování by „hotový odpis“ nemusel nic odečíst (kontrola 25. 10.).
    [manifest({ stockDeductionMode: 'orderPark' }), (x) => /nezná/.test(x.duvod), 'režim orderPark (odečet při zaparkování, neověřený) → odmítnuto'],
  ]
  for (const [odpoved, podminka, popis] of pripady) {
    const s = sit([odpoved])
    const x = await odeslatVydejDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT'), v, TED)
    ok(`${popis}, POS akce se NEPOŠLE`, x.stav === 'odmitnuto' && podminka(x) && /Nic se neodeslalo|nic se neodeslalo/.test(x.duvod) && s.pozadavky.length === 1 && !s.pozadavky.some((p) => p.url.includes('pos-actions')))
  }
  const textem = sit([manifest({ stockDeductionMode: 'documentIssue', branchId: '456' }), { status: 200 }])
  const xt = await odeslatVydejDotykacka(kontextDotykacky(textem.fetchFn, '123', 'AT'), v, TED)
  ok('režim documentIssue a branchId jako text → POS akce odejde', xt.stav === 'odeslano' && textem.pozadavky.length === 2 && textem.pozadavky[1].url.endsWith('/branches/456/pos-actions'))
}

console.log('\n== Napojení na orchestrátor: OperacePos → VydejDotykacka (N20) ==')
{
  const TED = Date.UTC(2026, 9, 16, 10, 0)
  const platnostIso = new Date(TED + 5 * 60_000).toISOString()
  // Přesně tvar, který předá provestOperaci po zabrání (lib/jine-platby-pos-operace.ts, OperacePos).
  const op = (jine = {}) => ({
    id: 'op1', klic: 'op-3f2a1b4c-0001', stav: 'odesila_se', pokusu: 1, platnostDo: platnostIso,
    externiProvozovna: '456', polozky: [{ produktId: '501', mnozstvi: '2' }], poznamka: 'Jiné platby: Stůl 4', ...jine,
  })
  const v = vydejZOperace(op())
  ok('převod: externiProvozovna → provozovna, platnostDo (ISO) → platnostDoMs (ms)', v.provozovna === '456' && v.platnostDoMs === TED + 5 * 60_000)
  ok('převod: klíč, položky a poznámka beze změny, nic navíc',
    v.klic === 'op-3f2a1b4c-0001' && JSON.stringify(v.polozky) === '[{"produktId":"501","mnozstvi":"2"}]' && v.poznamka === 'Jiné platby: Stůl 4' &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify(['klic', 'platnostDoMs', 'polozky', 'poznamka', 'provozovna']))
  ok('bez platnosti → chyba (nic se neodešle)', 'chyba' in vydejZOperace(op({ platnostDo: null })) && 'chyba' in vydejZOperace(op({ platnostDo: 'zítra' })))
  ok('bez provozovny (pokladna připojená k pobočce) → chyba s vysvětlením', /provozovnu/.test(vydejZOperace(op({ externiProvozovna: '' })).chyba ?? '') && 'chyba' in vydejZOperace(op({ externiProvozovna: null })))

  // Celá cesta jako po zapnutí: metoda zápisu dostane OperacePos a do Dotykačky odejde správné tělo.
  // zapisVydejeDotykacka bere čas z hodin (jako po zapnutí) — platnost proto od teď.
  const platnostZiva = Date.now() + 5 * 60_000
  const POVOLENA = new Set(['456'])
  const s = sit([MANIFEST_OK, { status: 200 }])
  const zapis = zapisVydejeDotykacka(kontextDotykacky(s.fetchFn, '123', 'AT-Z'), POVOLENA)
  const vysledek = await zapis(op({ platnostDo: new Date(platnostZiva).toISOString() }))
  const telo = JSON.parse(s.pozadavky[1]?.init.body ?? '{}')
  ok('zápis s OperacePos: manifest, pak POST na provozovnu 456, external-id = klíč, validity v ms', s.pozadavky[1]?.url === `${API_DOTYKACKA}/clouds/123/branches/456/pos-actions` &&
    telo['external-id'] === 'op-3f2a1b4c-0001' && telo.validity === platnostZiva)
  ok('… a výsledek odeslání pro orchestrátor (odeslano, ne úspěch)', vysledek.stav === 'odeslano')
  const s2 = sit([])
  const bez = await zapisVydejeDotykacka(kontextDotykacky(s2.fetchFn, '123', 'AT-Z'), POVOLENA)(op({ externiProvozovna: '' }))
  ok('zápis bez provozovny → odmitnuto bez jediného volání', bez.stav === 'odmitnuto' && s2.pozadavky.length === 0)
  const sJina = sit([])
  const jina = await zapisVydejeDotykacka(kontextDotykacky(sJina.fetchFn, '123', 'AT-Z'), POVOLENA)(op({ externiProvozovna: '457', platnostDo: new Date(platnostZiva).toISOString() }))
  ok('zápis do provozovny mimo povolené → odmitnuto bez jediného volání (ani manifest)', jina.stav === 'odmitnuto' && /není pro tuhle provozovnu povolený/.test(jina.duvod) && sJina.pozadavky.length === 0)
  const sNic = sit([])
  const nic = await zapisVydejeDotykacka(kontextDotykacky(sNic.fetchFn, '123', 'AT-Z'), new Set())(op({ platnostDo: new Date(platnostZiva).toISOString() }))
  ok('prázdný seznam povolených → odmitnuto bez jediného volání', nic.stav === 'odmitnuto' && sNic.pozadavky.length === 0)
  const s3 = sit([])
  const surove = await odeslatVydejDotykacka(kontextDotykacky(s3.fetchFn, '123', 'AT-Z'), op(), TED)
  ok('(pro srovnání: OperacePos poslaná napřímo do odeslatVydejDotykacka se odmítne — proto převod)', surove.stav === 'odmitnuto' && s3.pozadavky.length === 0)
}

console.log('\n== Schopnosti a relace: výdej NENÍ připojený ==')
{
  // Zápis do Dotykačky smí zapnout jen Šéfík výslovným pokynem po ověření na testovacím
  // cloudu (lib/pokladna-dotykacka-zapis.ts). Kdo seznam naplní, mění vědomě i tuhle kontrolu.
  ok('seznam povolených provozoven (ZAPIS_VYDEJE_DOTYKACKA) je prázdný', Array.isArray(ZAPIS_VYDEJE_DOTYKACKA) && ZAPIS_VYDEJE_DOTYKACKA.length === 0)
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
  ok('adaptér ze skladového modulu importuje čtení, připojovací funkci zápisu a typ kontextu — nic jiného',
    importy.length === 1 && /^import \{ cteniDotykacky, zapisVydejeDotykacka, type KontextDotykacky, type OdpovedDotykacky \} from/.test(importy[0]))
  ok('odeslatVydejDotykacka se v adaptéru nevolá', !/odeslatVydejDotykacka\(/.test(zdroj))
  const pripojeni = [...zdroj.matchAll(/zapisVydejeDotykacka\(/g)].map((m) => m.index)
  const iPodminka = zdroj.indexOf('if (povolene.size > 0) {')
  ok('zapisVydejeDotykacka se v adaptéru volá jednou a jen uvnitř „if (povolene.size > 0)"',
    pripojeni.length === 1 && iPodminka > 0 && pripojeni[0] > iPodminka && pripojeni[0] < zdroj.indexOf('}', iPodminka))
  const adaptery = readFileSync(new URL('../lib/pokladna-adaptery.ts', import.meta.url), 'utf8')
  ok('appka vytváří Dotykačku bez podstrčeného seznamu povolených (jen výchozí ZAPIS_VYDEJE_DOTYKACKA)',
    /vytvoritDotykacku\(\)/.test(adaptery) && !/vytvoritDotykacku\([^)]/.test(adaptery))
}

console.log('\n== Zapnutý zápis — jen v testu podstrčeným seznamem (25. 10.) ==')
{
  const POKYN = 'Test 25. 10. 2026: „zapni zápis do Dotykačky pro provozovnu 456“ (jen v testu)'
  const TED = Date.now()
  const op = (jine = {}) => ({ klic: 'op-3f2a1b4c-0009', externiProvozovna: '456', polozky: [{ produktId: '501', mnozstvi: '1' }], poznamka: 'x', platnostDo: new Date(TED + 5 * 60_000).toISOString(), ...jine })
  const otevrit = async (seznam, odpovedi = []) => {
    const s = sit([PRIHLASENI, ...odpovedi])
    const a = vytvoritDotykacku(s.fetchFn, seznam)
    const o = await a.otevrit(UDAJE)
    s.pozadavky.length = 0
    return { a, relace: o.relace, pozadavky: s.pozadavky }
  }
  const z = await otevrit([{ cloudId: '123', provozovna: '456', pokyn: POKYN }], [MANIFEST_OK, { status: 200 }])
  ok("povolená provozovna: schopnosti 'api', relace má skladovyVydej a zapisVydejePovolen",
    z.a.schopnosti.skladovyVydej === 'api' && typeof z.relace.skladovyVydej === 'function' && z.relace.zapisVydejePovolen('456') === true && z.relace.zapisVydejePovolen('457') === false)
  const odmitnuto = await z.relace.skladovyVydej(op({ externiProvozovna: '457' }))
  ok('… jiná provozovna téhož cloudu → odmítnuto bez volání', odmitnuto.stav === 'odmitnuto' && z.pozadavky.length === 0)
  const odeslano = await z.relace.skladovyVydej(op())
  ok('… povolená provozovna → manifest + POS akce, odeslano', odeslano.stav === 'odeslano' && z.pozadavky.length === 2 && z.pozadavky[1].url.endsWith('/clouds/123/branches/456/pos-actions'))

  const cizi = await otevrit([{ cloudId: '999', provozovna: '456', pokyn: POKYN }])
  ok('povolená provozovna JINÉHO cloudu → relace tohohle cloudu zápis nemá', !('skladovyVydej' in cizi.relace) && !('zapisVydejePovolen' in cizi.relace))
  const bezPokynu = await otevrit([{ cloudId: '123', provozovna: '456', pokyn: '' }])
  ok('řádek bez pokynu Šéfíka se nepočítá → relace zápis nemá', !('skladovyVydej' in bezPokynu.relace))
  const spatneId = await otevrit([{ cloudId: '123', provozovna: '45a', pokyn: POKYN }])
  ok('řádek s provozovnou mimo tvar se nepočítá → relace zápis nemá', !('skladovyVydej' in spatneId.relace))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
