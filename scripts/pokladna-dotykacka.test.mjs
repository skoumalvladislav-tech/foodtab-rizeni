#!/usr/bin/env node
/**
 * Dotykačka API v2 — adaptér bez sítě (lib/pokladna-dotykacka.ts).
 *
 * Síť je podstrčená (`vytvoritDotykacku(fetchFn)`), takže test ověří
 * PŘESNÝ tvar požadavků podle docs.api.dotypos.com (ověřeno 11. 10. 2026):
 *   POST https://api.dotykacka.cz/v2/signin/token
 *        Authorization: User <refresh>, tělo {"_cloudId": <číslo>} → 201 {accessToken}
 *   GET  …/v2/clouds/:cloudId/branches?page=&limit=100, Bearer
 *   GET  …/v2/clouds/:cloudId/branches/:branchId/sales-report?dateFrom&dateTo&vatPayer&lang
 * a výklad odpovědí („všechna čísla jsou řetězce", productSales).
 *
 * Pusť `node scripts/pokladna-dotykacka.test.mjs`.
 */

import { createHmac } from 'node:crypto'

const {
  API_DOTYKACKA,
  naparsovatProvozovny,
  naparsovatReport,
  parametryConnectoru,
  podpisConnectoru,
  vytvoritDotykacku,
} = await import('../lib/pokladna-dotykacka.ts')

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
    return new Response(dalsi.telo === undefined ? '' : JSON.stringify(dalsi.telo), { status: dalsi.status })
  }
  return { fetchFn, pozadavky }
}

const UDAJE = { refresh_token: 'refresh-abc-123-xyz-0000000', cloud_id: '123' }

console.log('\n== Connector v2: podpis a pole formuláře ==')
{
  const ocekavany = createHmac('sha256', 'tajne-heslo').update('1700000000').digest('hex')
  ok('podpis = HMAC-SHA256 razítka (text), klíč = client_secret', podpisConnectoru(1700000000, 'tajne-heslo') === ocekavany)
  ok('podpis je 64 malých hex znaků', /^[0-9a-f]{64}$/.test(podpisConnectoru(1, 'x')))

  const pole = parametryConnectoru({ clientId: 'foodtab', clientSecret: 'tajne-heslo', redirectUri: 'https://app/navrat', state: 'st', tedMs: 1700000000999 })
  ok('razítko je v SEKUNDÁCH (zaokrouhlené dolů)', pole.timestamp === '1700000000')
  ok('podpis sedí k razítku z formuláře', pole.signature === ocekavany)
  ok('scope je * (jediná podporovaná hodnota)', pole.scope === '*')
  ok('client_secret se do formuláře NEPOSÍLÁ', !Object.values(pole).includes('tajne-heslo') && !('client_secret' in pole))
  ok('redirect_uri a state jdou beze změny', pole.redirect_uri === 'https://app/navrat' && pole.state === 'st' && pole.client_id === 'foodtab')
}

console.log('\n== Provozovny: výklad stránky ==')
{
  const p = naparsovatProvozovny({ data: [
    { id: '11', name: 'Černá Perla', deleted: 'false' },
    { id: 12, name: '  Bernard Bar  ', deleted: false },
    { id: '13', name: 'Smazaná', deleted: true },
    { id: '14', name: 'Taky smazaná', deleted: 'true' },
    { id: '15', name: '' },
    { name: 'Bez id' },
  ] })
  ok('smazané provozovny vynechá (true i "true")', p.length === 3 && !p.some((x) => x.externiId === '13' || x.externiId === '14'))
  ok('id je vždy text, název oříznutý', p[1].externiId === '12' && p[1].nazev === 'Bernard Bar')
  ok('bez názvu → „Provozovna <id>"', p[2].nazev === 'Provozovna 15')
  ok('tvar bez pole data → null (nerozumím)', naparsovatProvozovny({ nic: 1 }) === null)
}

console.log('\n== Přehled tržeb: výklad productSales ==')
{
  const r = naparsovatReport({ productSales: [
    { id: '1', name: 'Pilsner 0,5 l', count: '120', value: '7800.00', valueWithoutVAT: '6446.28' },
    { id: '2', name: 'Pilsner 0,5 l', count: 10, value: 650 },
    { id: '3', name: 'Hovězí (kg)', count: '0.3', value: '120.10' },
    { id: '4', name: 'Hovězí (kg)', count: '0.6', value: '240.20' },
    { id: '5', name: '', count: '2', value: '100' },
    { id: '6', name: 'Vrácené', count: '-3', value: '-90' },
    { id: '7', name: 'Rozbité', count: 'x', value: '10' },
  ] })
  const podle = new Map(r.radky.map((x) => [x.produktNazev, x]))
  ok('dva produkty stejného jména se sečtou', podle.get('Pilsner 0,5 l')?.mnozstvi === 130 && podle.get('Pilsner 0,5 l')?.trzbaHaleru === 845000)
  const sDph = naparsovatReport({ productSales: [{ id: '9', name: 'Guláš', count: '1', value: '121.00', valueWithoutVAT: '100.00' }] })
  ok('tržba = value (s DPH), ne valueWithoutVAT', sDph?.radky[0].trzbaHaleru === 12100)
  ok('desetinná množství bez šumu (0,3 + 0,6 = 0,9)', podle.get('Hovězí (kg)')?.mnozstvi === 0.9 && podle.get('Hovězí (kg)')?.trzbaHaleru === 36030)
  ok('bez názvu → „Produkt <id>"', podle.has('Produkt 5'))
  ok('záporný součet (vratky) a nečitelné číslo se vynechají a započítají', !podle.has('Vrácené') && !podle.has('Rozbité') && r.vynechano === 2)
  ok('bez productSales → null (nerozumím)', naparsovatReport({ revenue: {} }) === null)
  ok('prázdný den → žádné řádky, žádná chyba', naparsovatReport({ productSales: [] })?.radky.length === 0)
}

console.log('\n== Přihlášení (signin/token) ==')
{
  const { fetchFn, pozadavky } = sit([{ status: 201, telo: { accessToken: 'AT-1' } }])
  const v = await vytvoritDotykacku(fetchFn).otevrit(UDAJE)
  const prvni = pozadavky[0]
  ok('platný token → relace', v.stav === 'ok')
  ok('POST na /v2/signin/token', prvni.url === `${API_DOTYKACKA}/signin/token` && prvni.init.method === 'POST')
  ok('hlavička Authorization: User <refresh token>', prvni.init.headers.Authorization === `User ${UDAJE.refresh_token}`)
  ok('tělo JSON {"_cloudId": 123} (číslo, ne text)', prvni.init.body === '{"_cloudId":123}' && prvni.init.headers['Content-Type'] === 'application/json')

  const s401 = sit([{ status: 401, telo: {} }])
  const n401 = await vytvoritDotykacku(s401.fetchFn).otevrit(UDAJE)
  ok('401 → chyba přístupu (vyžaduje člověka)', n401.stav === 'chyba' && n401.druh === 'pristup')

  const s500 = sit([{ status: 503 }])
  const n500 = await vytvoritDotykacku(s500.fetchFn).otevrit(UDAJE)
  ok('503 → dočasná chyba (zkusí příště)', n500.stav === 'chyba' && n500.druh === 'docasna')

  const sSit = sit(['sit-spadla'])
  const nSit = await vytvoritDotykacku(sSit.fetchFn).otevrit(UDAJE)
  ok('spadlá síť → dočasná chyba, ne výjimka', nSit.stav === 'chyba' && nSit.druh === 'docasna')

  const sBez = sit([{ status: 201, telo: {} }])
  const nBez = await vytvoritDotykacku(sBez.fetchFn).otevrit(UDAJE)
  ok('201 bez accessToken → chyba, ne „připojeno"', nBez.stav === 'chyba')

  const sNic = sit([])
  const nCloud = await vytvoritDotykacku(sNic.fetchFn).otevrit({ refresh_token: 'x'.repeat(30), cloud_id: '12; DROP' })
  ok('Cloud ID, které není číslo → chyba bez jediného volání', nCloud.stav === 'chyba' && sNic.pozadavky.length === 0)
}

console.log('\n== Provozovny (stránkování) ==')
{
  const { fetchFn, pozadavky } = sit([
    { status: 201, telo: { accessToken: 'AT-2' } },
    { status: 200, telo: { currentPage: '1', nextPage: '2', data: [{ id: '11', name: 'Perla' }] } },
    { status: 200, telo: { currentPage: '2', nextPage: null, data: [{ id: '12', name: 'Bernard' }] } },
  ])
  const o = await vytvoritDotykacku(fetchFn).otevrit(UDAJE)
  const p = await o.relace.provozovny()
  ok('dvě stránky → obě provozovny', p.stav === 'ok' && p.provozovny.map((x) => x.externiId).join(',') === '11,12')
  ok('GET /v2/clouds/123/branches?page=1&limit=100', pozadavky[1].url === `${API_DOTYKACKA}/clouds/123/branches?page=1&limit=100`)
  ok('s hlavičkou Bearer z přihlášení', pozadavky[1].init.headers.Authorization === 'Bearer AT-2' && pozadavky[2].url.includes('page=2'))

  const prazdne = sit([{ status: 201, telo: { accessToken: 'AT' } }, { status: 404 }])
  const o2 = await vytvoritDotykacku(prazdne.fetchFn).otevrit(UDAJE)
  const p2 = await o2.relace.provozovny()
  ok('404 (Dotykačka tak hlásí prázdná data) → prázdný seznam, ne chyba', p2.stav === 'ok' && p2.provozovny.length === 0)
}

console.log('\n== Tržby za okno (sales-report) ==')
{
  const od = Date.UTC(2026, 9, 10, 3, 0)
  const doMs = Date.UTC(2026, 9, 11, 3, 0)
  const { fetchFn, pozadavky } = sit([
    { status: 201, telo: { accessToken: 'AT-3' } },
    { status: 200, telo: { productSales: [{ id: '1', name: 'Kofola', count: '4', value: '196' }] } },
    { status: 429 },
    { status: 403 },
  ])
  const o = await vytvoritDotykacku(fetchFn).otevrit(UDAJE)
  const t = await o.relace.prodeje('456', od, doMs)
  const url = new URL(pozadavky[1].url)
  ok('cesta /v2/clouds/123/branches/456/sales-report', url.origin + url.pathname === `${API_DOTYKACKA}/clouds/123/branches/456/sales-report`)
  ok('dateFrom/dateTo jako epoch ms okna', url.searchParams.get('dateFrom') === String(od) && url.searchParams.get('dateTo') === String(doMs))
  ok('vatPayer=true, lang=cs', url.searchParams.get('vatPayer') === 'true' && url.searchParams.get('lang') === 'cs')
  ok('řádek prodeje přečtený', t.stav === 'ok' && t.radky[0].produktNazev === 'Kofola' && t.radky[0].trzbaHaleru === 19600)

  const zahlceno = await o.relace.prodeje('456', od, doMs)
  ok('429 → dočasná chyba', zahlceno.stav === 'chyba' && zahlceno.druh === 'docasna')
  const odebrano = await o.relace.prodeje('456', od, doMs)
  ok('403 (přístup odebrán) → chyba přístupu', odebrano.stav === 'chyba' && odebrano.druh === 'pristup')

  const pred = pozadavky.length
  const spatne = await o.relace.prodeje('456/../../jinam', od, doMs)
  ok('id provozovny, které není číslo → chyba bez volání', spatne.stav === 'chyba' && pozadavky.length === pred)
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
