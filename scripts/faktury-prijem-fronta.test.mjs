#!/usr/bin/env node
/**
 * „Přečíst znovu" a pořadí fronty příjmu faktur — SKUTEČNÝ
 * lib/faktury-prijem-sync.ts nad podvrženou databází.
 *
 * Pusť: node scripts/faktury-prijem-fronta.test.mjs   (Node 24, běží i v CI)
 *
 * sync.ts začíná `import 'server-only'`; scripts/vykreslit.mjs ho přeloží
 * s prázdným server-only. Podstrčené je jen to POD ním: klient databáze
 * (zapisuje si každý dotaz a jeho filtry), brána Faktur a IMAP/AI (ty se
 * tu volat nesmí — kanárek). Rozhodování jádra (lzeZkusitZnovu, kontrola
 * firmy) a skutečné dotazy repozitáře (stránky po 1000, dávky po 100,
 * filtr schránky a stavu) běží, jak jsou.
 *
 * Proč: 10. 11. 2026 bylo v ruční kontrole 1 017 příloh, jedna schránka
 * přes 500 — PostgREST vrací nejvýš 1000 řádků na dotaz, bez stránek by
 * se zbytek tiše nevrátil.
 */

import { readFileSync } from 'node:fs'

import { adresaModulu } from './vykreslit.mjs'
import { DUVOD_VRACENI } from '../lib/faktury-prijem-jadro.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

// Apostrof se kóduje taky — stub se vkládá do importu v apostrofech.
const js = (kod) => 'data:text/javascript,' + encodeURIComponent(kod).replace(/'/g, '%27')
const FIRMA = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7'
const CIZI_FIRMA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

const KREDIT = 'AI soubor nepřijala (chyba 400): Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
const HESLO = 'AI soubor nepřijala (chyba 400): messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected.'

/* --- podvržená databáze ------------------------------------------------- */

// Každý dotaz = { tabulka, kroky: [[metoda, ...argumenty]] }. Odpověď
// rozhoduje svet.odpovez(dotaz) až při await — jako skutečný klient.
const svet = (globalThis.__svetFronty = { dotazy: [], odpovez: () => ({ data: null, error: null }), pristup: () => ({ stav: 'ok' }) })
globalThis.__klientFronty = {
  from(tabulka) {
    const dotaz = { tabulka, kroky: [] }
    svet.dotazy.push(dotaz)
    const retez = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (hotovo, chyba) => Promise.resolve().then(() => svet.odpovez(dotaz)).then(hotovo, chyba)
        return (...a) => { dotaz.kroky.push([String(k), ...a]); return retez }
      },
    })
    return retez
  },
  storage: { from() { throw new Error('kanárek: úložiště se tu volat nesmí') } },
}

const kanarek = (jmeno) => `export function ${jmeno}() { throw new Error('kanárek: ${jmeno} se tu volat nesmí') }`
const SYNC = await import(adresaModulu('lib/faktury-prijem-sync.ts', [
  ['server-only', js('')],
  ['./supabase/uloha.ts', js('export function klientUlohy() { return globalThis.__svetFronty.bezKlienta ? null : globalThis.__klientFronty }')],
  ['./faktury-pristup.ts', js(`export async function pristupKFakturamUlohy(t) { return globalThis.__svetFronty.pristup(t) }\n${kanarek('fakturyFirmy')}`)],
  ['./integrace-klice.ts', js(kanarek('rozsifrovat'))],
  ['./faktury-prijem-imap.ts', js(kanarek('nactiDavkuZprav'))],
  ['./faktury-prijem-ai.ts', js(`${kanarek('vytezitDokladAI')}\n${kanarek('cteniAiJeNastavene')}`)],
]))

const krok = (dotaz, metoda) => dotaz.kroky.filter((k) => k[0] === metoda)
const maEq = (dotaz, sloupec, hodnota) => krok(dotaz, 'eq').some((k) => k[1] === sloupec && k[2] === hodnota)

/** Svět se schránkou p1 firmy FIRMA a `radky` v ruční kontrole (pořadí = pořadí podle id). */
function pripravit(radky, { tenant = FIRMA, odpojeno = null, chybaVyberu = false, vratitMene = 0 } = {}) {
  svet.dotazy = []
  svet.bezKlienta = false
  svet.pristup = () => ({ stav: 'ok' })
  svet.odpovez = (dotaz) => {
    if (dotaz.tabulka === 'integrace_pripojeni') {
      return { data: maEq(dotaz, 'id', 'p1') && maEq(dotaz, 'oblast', 'email_dokladu') ? { id: 'p1', tenant_id: tenant, externi_ucet: {}, odpojeno_kdy: odpojeno } : null, error: null }
    }
    if (dotaz.tabulka !== 'faktury_prijem') return { data: null, error: { message: `nečekaná tabulka ${dotaz.tabulka}` } }
    if (krok(dotaz, 'update').length) {
      const ids = krok(dotaz, 'in').find((k) => k[1] === 'id')?.[2] ?? []
      const vracene = ids.slice(0, Math.max(0, ids.length - vratitMene))
      return { data: vracene.map((id) => ({ id })), error: null }
    }
    if (chybaVyberu) return { data: null, error: { message: 'výpadek čtení' } }
    // Výběr: filtr schránky a stavu musí být v dotazu, jinak by se četly cizí řádky.
    const vlastni = maEq(dotaz, 'pripojeni_id', 'p1') && maEq(dotaz, 'stav', 'vyzaduje_kontrolu') ? radky : []
    const range = krok(dotaz, 'range')[0]
    const [od, po] = range ? [range[1], range[2]] : [0, Infinity]
    // PostgREST max-rows: víc než 1000 řádků v jedné odpovědi nikdy.
    return { data: vlastni.slice(od, Math.min(po + 1, od + 1000)), error: null }
  }
}

const radek = (i, duvod, soubor = true) => ({ id: `r${String(i).padStart(5, '0')}`, duvod, soubor_cesta: soubor ? `t/${i}.pdf` : null })

/* ---------------------------------------------------------------------- */
console.log('\n== Přečíst znovu: přes 1000 řádků, po stránkách a dávkách ==')
{
  // 2 350 řádků: každý třetí kredit se souborem (vrátit), pak PDF s heslem, pak kredit bez souboru.
  const radky = Array.from({ length: 2350 }, (_, i) => (i % 3 === 0 ? radek(i, KREDIT) : i % 3 === 1 ? radek(i, HESLO) : radek(i, KREDIT, false)))
  const ocekavane = radky.filter((_, i) => i % 3 === 0).map((r) => r.id)
  pripravit(radky)
  const r = await SYNC.vratitDoFronty('p1', FIRMA)
  ok(`vrátí ${ocekavane.length} (kredit se souborem), žádný důvod`, r.vraceno === ocekavane.length && r.duvod === null)

  const vybery = svet.dotazy.filter((d) => d.tabulka === 'faktury_prijem' && !krok(d, 'update').length)
  ok('čte po stránkách 0–999, 1000–1999, 2000–2999 a po kratší stránce přestane',
    JSON.stringify(vybery.map((d) => krok(d, 'range')[0]?.slice(1))) === JSON.stringify([[0, 999], [1000, 1999], [2000, 2999]]))
  ok('každá stránka: jen schránka p1, jen ruční kontrola, pořadí podle id',
    vybery.every((d) => maEq(d, 'pripojeni_id', 'p1') && maEq(d, 'stav', 'vyzaduje_kontrolu') && krok(d, 'order')[0]?.[1] === 'id'))

  const zmeny = svet.dotazy.filter((d) => d.tabulka === 'faktury_prijem' && krok(d, 'update').length)
  const davky = zmeny.map((d) => krok(d, 'in').find((k) => k[1] === 'id')?.[2] ?? [])
  ok(`zápis v dávkách nejvýš po 100 (${davky.length} dávek)`, davky.length === Math.ceil(ocekavane.length / 100) && davky.every((d) => d.length > 0 && d.length <= 100))
  ok('vrácená id = přesně kredit se souborem (ne PDF s heslem, ne bez souboru)', JSON.stringify(davky.flat()) === JSON.stringify(ocekavane))
  ok('každá dávka: jen schránka p1 a jen pořád v ruční kontrole (souběh s člověkem)',
    zmeny.every((d) => maEq(d, 'pripojeni_id', 'p1') && maEq(d, 'stav', 'vyzaduje_kontrolu')))
  const zmena = krok(zmeny[0] ?? { kroky: [] }, 'update')[0]?.[1] ?? {}
  ok('zpátky do fronty: čeká, 0 pokusů, nový důvod, bez stopy po AI (nezapočítá se do stropu)',
    zmena.stav === 'ceka' && zmena.pokusu === 0 && zmena.duvod === DUVOD_VRACENI && zmena.zdroj_vytezeni === null && zmena.zpracovano_kdy === null && zmena.vysledek === null)
  ok('zápis vrátí řádky (select), ať je vidět, kolik opravdu prošlo', zmeny.every((d) => krok(d, 'select').length === 1))
}

console.log('\n== Přesně 1000 řádků: druhá (prázdná) stránka se přečte ==')
{
  const radky = Array.from({ length: 1000 }, (_, i) => radek(i, KREDIT))
  pripravit(radky)
  const r = await SYNC.vratitDoFronty('p1', FIRMA)
  const vybery = svet.dotazy.filter((d) => d.tabulka === 'faktury_prijem' && !krok(d, 'update').length)
  ok('vrátí všech 1000', r.vraceno === 1000)
  ok('čte dvě stránky (plná stránka neznamená konec)', vybery.length === 2)
}

console.log('\n== Souběh: mezitím někdo řádek vyřídil ==')
{
  pripravit([radek(1, KREDIT), radek(2, KREDIT), radek(3, KREDIT)], { vratitMene: 1 })
  const r = await SYNC.vratitDoFronty('p1', FIRMA)
  ok('hlásí jen řádky, které update opravdu změnil', r.vraceno === 2)
}

console.log('\n== Brány: cizí firma, odpojená schránka, zavřené Faktury, bez klienta ==')
{
  pripravit([radek(1, KREDIT)], { tenant: CIZI_FIRMA })
  const cizi = await SYNC.vratitDoFronty('p1', FIRMA)
  ok('schránka jiné firmy → nic, ruční kontrola se ani nečte', cizi.vraceno === 0 && cizi.duvod !== null && !svet.dotazy.some((d) => d.tabulka === 'faktury_prijem'))

  pripravit([radek(1, KREDIT)], { odpojeno: '2026-11-01T00:00:00Z' })
  const odpojena = await SYNC.vratitDoFronty('p1', FIRMA)
  ok('odpojená schránka → nic', odpojena.vraceno === 0 && !svet.dotazy.some((d) => d.tabulka === 'faktury_prijem'))

  pripravit([radek(1, KREDIT)])
  svet.pristup = () => ({ stav: 'zavreno' })
  const zavrene = await SYNC.vratitDoFronty('p1', FIRMA)
  ok('Faktury firmy zavřené → nic', zavrene.vraceno === 0 && /zavřené/.test(zavrene.duvod ?? '') && !svet.dotazy.some((d) => d.tabulka === 'faktury_prijem'))

  pripravit([radek(1, KREDIT)])
  svet.bezKlienta = true
  const bez = await SYNC.vratitDoFronty('p1', FIRMA)
  ok('bez klíče služby → důvod, žádný dotaz', bez.vraceno === 0 && /SUPABASE_SERVICE_ROLE_KEY/.test(bez.duvod ?? '') && svet.dotazy.length === 0)

  pripravit([radek(1, KREDIT)], { chybaVyberu: true })
  let vyjimka = null
  let vysledek = null
  try { vysledek = await SYNC.vratitDoFronty('p1', FIRMA) } catch (e) { vyjimka = e }
  ok('výpadek čtení → důvod pro člověka, ne výjimka (akce nespadne)', vyjimka === null && vysledek?.vraceno === 0 && /zkuste to znovu/.test(vysledek?.duvod ?? ''))
}

console.log('\n== Pořadí fronty: nejnovější e-mail první (ze zdroje) ==')
{
  // Vrácených příloh je přes tisíc a jsou z 9. 10. — se starým pořadím
  // (vytvoreno_kdy vzestupně) by nové faktury čekaly dny za nimi.
  const zdroj = readFileSync(new URL('../lib/faktury-prijem-sync.ts', import.meta.url), 'utf8')
  const telo = /async nactiKeZpracovani\([^)]*\) \{([\s\S]*?)\n {4}\},/.exec(zdroj)?.[1] ?? ''
  const razeni = [...telo.matchAll(/\.order\('([a-z_]+)',\s*\{([^}]*)\}\)/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()])
  ok('fronta se našla a řadí se', telo.length > 0 && razeni.length > 0)
  ok('první řazení: prijato_kdy sestupně, prázdné na konec',
    razeni[0]?.[0] === 'prijato_kdy' && /ascending: false/.test(razeni[0]?.[1] ?? '') && /nullsFirst: false/.test(razeni[0]?.[1] ?? ''))
  ok('a teprve pak limit', telo.indexOf(".order('prijato_kdy'") >= 0 && telo.indexOf(".order('prijato_kdy'") < telo.indexOf('.limit(limit)'))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
