#!/usr/bin/env node
/**
 * Předání příspěvku n8n — lib/marketing-n8n.ts a lib/marketing-odeslani.ts.
 *
 * Pusť:
 *   node --experimental-strip-types --conditions=react-server scripts/marketing-n8n.test.mjs
 *
 * ---------------------------------------------------------------------
 * NA CO SE TU MÍŘÍ
 *
 * Na jedinou chybu, kterou nejde vzít zpátky: DVA STEJNÉ PŘÍSPĚVKY
 * na Instagramu. Vznikne tak, že n8n zveřejní a odpověď se ztratí —
 * Foodtab to vezme jako neúspěch a za pět minut to zkusí znovu.
 *
 * Proti tomu chrání idempotenční klíč, který se MUSÍ poslat. Tenhle
 * test hlídá, že se posílá; že si ho n8n opravdu pamatuje, hlídá
 * workflow na druhé straně — a je to napsané i tam.
 *
 * Druhá věc je „asi to vyšlo". Odpověď, které nerozumíme, musí být
 * CHYBA. Zapsat zveřejnění, které se nestalo, znamená příspěvek, co
 * v přehledu svítí jako hotový a přitom nikdy nevyšel.
 */

process.env.N8N_MARKETING_URL = 'https://n8n.example.test/webhook/foodtab'
process.env.N8N_MARKETING_TAJEMSTVI = 'tajne-heslo'

const { predatN8n, precistOdpoved, n8nJeNastaveny } = await import('../lib/marketing-n8n.ts')
const { odeslat } = await import('../lib/marketing-odeslani.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

/** Podstrčí odpověď místo skutečného volání n8n a zapamatuje si požadavek. */
function misto(odpoved) {
  const puvodni = globalThis.fetch
  const volani = []
  globalThis.fetch = async (url, opts) => {
    volani.push({ url, opts })
    if (typeof odpoved === 'function') return odpoved()
    return odpoved
  }
  return { volani, vratit: () => { globalThis.fetch = puvodni } }
}

const jakoJson = (telo, status = 200) =>
  new Response(JSON.stringify(telo), { status, headers: { 'content-type': 'application/json' } })

const POZADAVEK = {
  tenantId: 'FIRMA-1',
  branchId: 'POBOCKA-1',
  ulohaId: 'ULOHA-1',
  idempotencniKlic: 'klic-abc',
  kanal: 'instagram',
  format: 'prispevek',
  popisek: 'Dnes vaříme svíčkovou.',
  obrazky: [{ url: 'https://uloziste.test/podepsana/1.jpg', alt: 'Talíř svíčkové' }],
}

console.log('\n== Co se posílá ==')

{
  const m = misto(jakoJson({ stav: 'zverejneno', externi_id: 'ig-1', odkaz: 'https://instagram.com/p/1' }))
  await predatN8n(POZADAVEK)
  m.vratit()

  const telo = JSON.parse(m.volani[0].opts.body)

  ok('volá se nastavená adresa', m.volani[0].url === process.env.N8N_MARKETING_URL)
  ok('metodou POST', m.volani[0].opts.method === 'POST')

  /*
    Bez klíče nemá n8n podle čeho poznat opakování — a opakování
    nastane při každé ztracené odpovědi.
  */
  ok('posílá se idempotenční klíč', telo.idempotencni_klic === 'klic-abc')

  /*
    Jeden webhook pro všechny firmy znamená, že příspěvek druhé
    restaurace odejde na Instagram té první. n8n podle těchhle dvou
    údajů vybírá účet.
  */
  ok('posílá se firma', telo.tenant_id === 'FIRMA-1')
  ok('a pobočka', telo.branch_id === 'POBOCKA-1')

  ok('posílá se text', telo.popisek === 'Dnes vaříme svíčkovou.')
  ok('a odkaz na fotku', telo.obrazky[0].url.startsWith('https://'))
  ok('včetně popisu pro nevidomé', telo.obrazky[0].alt === 'Talíř svíčkové')
}

console.log('\n== Tajemství ==')

{
  const m = misto(jakoJson({ stav: 'zverejneno' }))
  await predatN8n(POZADAVEK)
  m.vratit()

  const hlavicky = m.volani[0].opts.headers

  ok('tajemství jde v hlavičce', hlavicky['x-foodtab-tajemstvi'] === 'tajne-heslo')

  /*
    Ne v adrese: adresy končí v logu serveru, v historii prohlížeče
    i v hlášení o chybě. A ne jako `Authorization` — v n8n se týž
    přihlašovací údaj dá omylem připnout k jinému uzlu mířícímu jinam.
  */
  ok('a ne v adrese', !String(m.volani[0].url).includes('tajne-heslo'))
  ok('a nejmenuje se Authorization', hlavicky.Authorization === undefined && hlavicky.authorization === undefined)
}

console.log('\n== Bez nastavení se nikam nevolá ==')

{
  const url = process.env.N8N_MARKETING_URL
  delete process.env.N8N_MARKETING_URL

  const m = misto(jakoJson({ stav: 'zverejneno' }))
  const v = await predatN8n(POZADAVEK)
  m.vratit()
  process.env.N8N_MARKETING_URL = url

  ok('bez adresy se to nepokusí odeslat', m.volani.length === 0)
  ok('a vrátí chybu', v.stav === 'chyba')
  ok('která řekne, co chybí', v.duvod.includes('N8N_MARKETING_URL'))
  ok('nastavené to není', (() => {
    const u = process.env.N8N_MARKETING_URL
    delete process.env.N8N_MARKETING_URL
    const r = n8nJeNastaveny()
    process.env.N8N_MARKETING_URL = u
    return r === false
  })())
}

console.log('\n== Odpovědi, kterým se nesmí věřit ==')

ok('prázdná odpověď je chyba', precistOdpoved(null).stav === 'chyba')
ok('text místo JSONu je chyba', precistOdpoved('hotovo').stav === 'chyba')
ok('neznámý stav je chyba', precistOdpoved({ stav: 'mozna' }).stav === 'chyba')
ok('a hláška ten stav ukáže', precistOdpoved({ stav: 'mozna' }).duvod.includes('mozna'))
ok('chybějící stav je chyba', precistOdpoved({ externi_id: 'ig-1' }).stav === 'chyba')

/*
  Tohle je ta zákeřná: n8n odpoví „ok", což vypadá jako úspěch, ale
  není to dohodnuté slovo. Kdyby se bralo cokoli nenulového jako
  úspěch, zapsalo by se zveřejnění, které se nestalo.
*/
ok('„ok" není zveřejněno', precistOdpoved({ stav: 'ok' }).stav === 'chyba')
ok('ani true', precistOdpoved({ stav: true }).stav === 'chyba')

const uspech = precistOdpoved({ stav: 'zverejneno', externi_id: 'ig-9', odkaz: 'https://instagram.com/p/9' })
ok('dohodnutý tvar projde', uspech.stav === 'zverejneno')
ok('a nese vnější id', uspech.stav === 'zverejneno' && uspech.externiId === 'ig-9')
ok('i trvalý odkaz', uspech.stav === 'zverejneno' && uspech.odkaz === 'https://instagram.com/p/9')

// Chybějící id není důvod k pádu — příspěvek vyšel, jen o něm víme míň.
const bezId = precistOdpoved({ stav: 'zverejneno' })
ok('zveřejnění bez id projde s prázdným id', bezId.stav === 'zverejneno' && bezId.externiId === null)

console.log('\n== Když se n8n neozve ==')

{
  const m = misto(() => { throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }) })
  const v = await predatN8n(POZADAVEK)
  m.vratit()

  ok('vypršení času je chyba, ne úspěch', v.stav === 'chyba')
  ok('a hláška to říká srozumitelně', /neozvalo/i.test(v.duvod))
}

{
  const m = misto(new Response('Workflow not found', { status: 404 }))
  const v = await predatN8n(POZADAVEK)
  m.vratit()
  ok('nenalezený webhook je chyba', v.stav === 'chyba')
  ok('a hláška nese kód i tělo', v.duvod.includes('404') && v.duvod.includes('Workflow not found'))
}

{
  const m = misto(new Response('<html>chyba</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  const v = await predatN8n(POZADAVEK)
  m.vratit()
  ok('odpověď, která není JSON, je chyba', v.stav === 'chyba')
}

console.log('\n== Fronta: kdy se to k n8n vůbec dostane ==')

const ULOHA = {
  id: 'ULOHA-1',
  tenant_id: 'FIRMA-1',
  branch_id: 'POBOCKA-1',
  prispevek_id: 'P',
  verze_id: 'V',
  kanal: 'instagram',
  format: 'prispevek',
  poskytovatel: 'n8n',
  rezim: 'zakaznicky',
  pripojeni_id: null,
  ucet_id: null,
  idempotencni_klic: 'klic-abc',
  pokusy: 1,
  max_pokusu: 5,
  texty: { instagram: { popisek: 'Dnes vaříme.' } },
  media_ids: ['M1'],
}

const FOTKY = [{ url: 'https://uloziste.test/1.jpg', alt: 'talíř' }]

{
  const m = misto(jakoJson({ stav: 'zverejneno', externi_id: 'ig-5' }))
  const v = await odeslat(ULOHA, FOTKY)
  m.vratit()
  ok('s fotkou se to pošle a zapíše jako zveřejněné', v.stav === 'hotovo')
  ok('a NENÍ to označené jako nanečisto', v.stav === 'hotovo' && v.nanecisto === false)
}

/*
  Instagram příspěvek bez obrázku odmítne. Posílat ho tam znamená pět
  marných pokusů a nakonec hlášku od Mety, ze které nikdo nepozná, že
  prostě chybí fotka.
*/
{
  const m = misto(jakoJson({ stav: 'zverejneno' }))
  const v = await odeslat(ULOHA, [])
  m.vratit()
  ok('bez fotky se to k n8n vůbec neposílá', m.volani.length === 0)
  ok('a řekne se to rovnou', v.stav === 'chyba' && /bez fotky/i.test(v.duvod))
}

{
  const m = misto(jakoJson({ stav: 'zverejneno' }))
  const v = await odeslat({ ...ULOHA, rezim: 'demo' }, FOTKY)
  m.vratit()
  ok('demo se k n8n neposílá vůbec', m.volani.length === 0)
  ok('a je označené jako nanečisto', v.stav === 'hotovo' && v.nanecisto === true)
}

{
  const m = misto(jakoJson({ stav: 'zverejneno' }))
  const v = await odeslat({ ...ULOHA, rezim: 'rucni' }, FOTKY)
  m.vratit()
  ok('ruční režim se k n8n neposílá', m.volani.length === 0)
  ok('a není to chyba', v.stav === 'rucne')
}

console.log('\n== Klíč se do n8n dostane z úlohy, ne odjinud ==')

{
  const m = misto(jakoJson({ stav: 'zverejneno' }))
  await odeslat({ ...ULOHA, idempotencni_klic: 'klic-z-ulohy' }, FOTKY)
  m.vratit()
  const telo = JSON.parse(m.volani[0].opts.body)
  ok('posílá se klíč té konkrétní úlohy', telo.idempotencni_klic === 'klic-z-ulohy')
  ok('a text kanálu příspěvku', telo.popisek === 'Dnes vaříme.')
}

console.log('\n== Způsob odeslání se volí, nedomýšlí ==')

/*
  Byla tu natvrdo ruční cesta: ať se nastavilo cokoli, každý
  naplánovaný příspěvek skončil „k ručnímu zveřejnění" a k n8n se
  nikdy nic nedostalo. Celý řetěz byl nedosažitelný a přitom vypadal
  hotově — proto tyhle kontroly.
*/
const { readFileSync } = await import('node:fs')
const akceText = readFileSync('app/[rozsah]/marketing/akce.ts', 'utf8')
const detailText = readFileSync('app/[rozsah]/marketing/[prispevek]/page.tsx', 'utf8')

ok('režim se nebere natvrdo', !/rezim: 'rucni',\n\s*planovano_na/.test(akceText))
ok('způsob se čte z formuláře', akceText.includes("formData.get('zpusob')"))
ok('„zveřejnit" vede na n8n', /zvoleno === 'zverejnit'[\s\S]{0,80}poskytovatel: 'n8n'/.test(akceText))
ok('„nanečisto" je demo', /zvoleno === 'nanecisto'[\s\S]{0,60}rezim: 'demo'/.test(akceText))

/*
  Neznámá hodnota z formuláře nesmí skončit zveřejněním. Kdyby se
  rozhodovalo obráceně (`zvoleno === 'rucne' ? rucni : zverejnit`),
  odeslal by příspěvek i prázdný nebo podvržený formulář.
*/
ok('cokoli neznámého padá do ruční cesty',
  /: \{ rezim: 'rucni', poskytovatel: 'rucni_export' \}/.test(akceText))

ok('obrazovka tu volbu nabízí', detailText.includes('name="zpusob"'))
ok('a „Zveřejnit" nenabízí, když to nejde',
  detailText.includes('disabled={!n8nHotovo}'))

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
