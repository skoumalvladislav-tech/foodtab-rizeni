#!/usr/bin/env node
/**
 * Graf srovnání tržeb (Finance → Tržby, Šéfík 4. 11. 2026).
 *
 * Pusť `node scripts/trzby-srovnani.test.mjs`.
 *
 * Co se SPOUŠTÍ (ne čte jako text):
 *   * lib/trzby-srovnani.ts — srovnávací období, sloty, pokrytí daty,
 *     nestejné provozovny, rozběhnutý slot, dílky osy;
 *   * karta srovnani.tsx + kresba graf-srovnani.tsx, vykreslené do HTML
 *     (scripts/vykreslit.mjs) — co opravdu uvidí člověk: sloupce, čára,
 *     věty o chybějících datech, tabulka;
 *   * SKUTEČNÁ stránka page.tsx s podstrčenou databází a přístupem —
 *     že srovnání jde touž funkcí a týmž přihlášením jako přehled, na
 *     pobočce jen s jejími řádky a bez práva vůbec.
 *
 * Čísla jsou smyšlená (žádné ostré tržby z pokladny).
 *
 * Kontroly, které by mohly vyhodit výjimku, jsou obalené — výjimka
 * v jedné nesmí schovat ostatní (paměť „výjimka v testu schová další").
 */

import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { prevestPrehled } from '../lib/pokladna-trzby.ts'
import {
  celeObdobi,
  dilkyOsy,
  jeDruhSrovnani,
  nazevObdobi,
  popiskyOsy,
  popisRozdilu,
  popisRozsahu,
  popisUseku,
  sestavitGraf,
  srovnavaciObdobi,
} from '../lib/trzby-srovnani.ts'
import { nactiKomponentu, nactiModul } from './vykreslit.mjs'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zkus = async (nazev, fn) => {
  try {
    await fn()
  } catch (e) {
    chyb++
    console.log(`  CHYBA ${nazev} — výjimka: ${e?.stack ?? e}`)
  }
}
const hodi = (fn) => { try { fn(); return false } catch { return true } }
// base64: encodeURIComponent nechá apostrof, a ten by v importu s apostrofy rozbil řetězec.
const js = (kod) => 'data:text/javascript;base64,' + Buffer.from(kod, 'utf8').toString('base64')
const mezery = (t) => String(t ?? '').replace(/ /g, ' ')
const text = (html) => mezery(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const radek = (obdobi, branch, kc, dnu = 1) => ({ obdobi, branch_id: branch, trzba_haleru: kc * 100, polozek: 1, dnu, dnu_s_platbami: 0 })
const prehled = (trzby) => prevestPrehled({ trzby, platby: [], zpusoby: [], banka: [] })
const NAZVY = new Map([[A, 'Perla test'], [B, 'Bar test']])

// ---------------------------------------------------------------------
console.log('\n== Srovnávací období ==')
await zkus('období', () => {
  ok('rok → předchozí rok: 1. 1. – 31. 12. 2025', stejne(srovnavaciObdobi('mesic', '2026-01-01', 'obdobi'), { od: '2025-01-01', doData: '2025-12-31' }))
  ok('u roku je „stejné období loni" totéž co „předchozí období"', stejne(srovnavaciObdobi('mesic', '2026-01-01', 'rok'), srovnavaciObdobi('mesic', '2026-01-01', 'obdobi')))
  ok('říjen → předchozí měsíc září 1.–30. 9.', stejne(srovnavaciObdobi('den', '2026-10-01', 'obdobi'), { od: '2026-09-01', doData: '2026-09-30' }))
  ok('leden → prosinec předchozího roku', stejne(srovnavaciObdobi('den', '2026-01-01', 'obdobi'), { od: '2025-12-01', doData: '2025-12-31' }))
  ok('říjen → stejný měsíc loni (říjen 2025)', stejne(srovnavaciObdobi('den', '2026-10-01', 'rok'), { od: '2025-10-01', doData: '2025-10-31' }))
  ok('březen 2024 → únor 2024 do 29. (přestupný)', stejne(srovnavaciObdobi('den', '2024-03-01', 'obdobi'), { od: '2024-02-01', doData: '2024-02-29' }))
  ok('nezačátek měsíce / roku VYHODÍ (ne tichý posun)', hodi(() => srovnavaciObdobi('den', '2026-10-05', 'obdobi')) && hodi(() => srovnavaciObdobi('mesic', '2026-02-01', 'obdobi')))
  ok('celé období: únor 2026 do 28. 2., rok do 31. 12.', stejne(celeObdobi('den', '2026-02-01'), { od: '2026-02-01', doData: '2026-02-28' }) && celeObdobi('mesic', '2026-01-01').doData === '2026-12-31')
  ok('druh srovnání z adresy: jen „obdobi" a „rok"', jeDruhSrovnani('rok') && jeDruhSrovnani('obdobi') && !jeDruhSrovnani('loni') && !jeDruhSrovnani(undefined))
  ok('podnadpis: „1. 1. – 31. 12. 2025"', popisRozsahu({ od: '2025-01-01', doData: '2025-12-31' }) === '1. 1. – 31. 12. 2025')
  ok('podnadpis přes rok: „1. 12. 2025 – 31. 1. 2026"', popisRozsahu({ od: '2025-12-01', doData: '2026-01-31' }) === '1. 12. 2025 – 31. 1. 2026')
  ok('název: „září 2026" / „2025"', nazevObdobi('den', '2026-09-01') === 'září 2026' && nazevObdobi('mesic', '2025-01-01') === '2025')
})

// ---------------------------------------------------------------------
console.log('\n== Po měsících: rok proti předchozímu roku ==')
const AKT_ROK = prehled([
  radek('2026-01-01', A, 100_000, 31),
  radek('2026-02-01', A, 90_000, 28),
  radek('2026-10-01', A, 120_000, 31),
  radek('2026-11-01', A, 10_000, 3),
])
const SROV_ROK = prehled([
  radek('2025-03-01', A, 80_000, 31),
  radek('2025-10-01', A, 100_000, 31),
  radek('2025-12-01', A, 110_000, 31),
])
const grafRoku = (srovnavaci, zmena = {}) =>
  sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: AKT_ROK, srovnavaci, branchId: null, ...zmena })
await zkus('rok', () => {
  const g = grafRoku(SROV_ROK)
  ok('12 slotů, slot i ↔ týž měsíc loni', g.sloty.length === 12 && g.sloty.every((s, i) => s.obdobiSrovnani === `2025-${String(i + 1).padStart(2, '0')}-01`))
  const rijen = g.sloty[9]
  ok(`říjen: 120 000 Kč proti 100 000 Kč, rozdíl +20 % (${rijen.aktualni?.haleru}/${rijen.srovnani?.haleru}/${rijen.rozdilProcent})`,
    rijen.aktualni?.haleru === 12_000_000 && rijen.srovnani?.haleru === 10_000_000 && Math.abs(rijen.rozdilProcent - 20) < 1e-9)
  ok('leden: srovnání bez dat je null, NE nula', g.sloty[0].srovnani === null && g.sloty[0].rozdilProcent === null)
  ok('měsíc bez prodejů (červen) nemá sloupec: aktualni null', g.sloty[5].aktualni === null)
  ok('listopad (rozběhnutý) = „bezi", bez rozdílu v procentech', g.sloty[10].stav === 'bezi' && g.sloty[10].rozdilProcent === null && g.bezi?.obdobi === '2026-11-01')
  ok('prosinec = „budouci", sloupec žádný, srovnání loňského prosince ano', g.sloty[11].stav === 'budouci' && g.sloty[11].aktualni === null && g.sloty[11].srovnani?.haleru === 11_000_000)
  ok('září = „uzavrene"', g.sloty[8].stav === 'uzavrene')
  ok(`pokrytí: částečné březen–prosinec 2025 (${JSON.stringify(g.pokryti)})`, g.pokryti.druh === 'castecne' && g.pokryti.od === '2025-03-01' && g.pokryti.do === '2025-12-01')
  ok('úsek slovy: „březen – prosinec 2025"', popisUseku('mesic', '2025-03-01', '2025-12-01') === 'březen – prosinec 2025')
  ok('u roku se druh „rok" sloučí na „obdobi" (jedna adresa pro totéž)', grafRoku(SROV_ROK, { druh: 'rok' }).druh === 'obdobi')
  ok('podnadpis grafu: srovnání 2025', g.nazevSrovnani === '2025' && g.nazevAktualniho === '2026')

  const sMezerou = grafRoku(prehled([radek('2025-01-01', A, 1_000, 31), radek('2025-06-01', A, 1_000, 30), radek('2025-12-01', A, 1_000, 31)]))
  ok('mezera UPROSTŘED (zavřeno) neúplnost není: leden + červen + prosinec = úplné', sMezerou.pokryti.druh === 'uplne')
  const prazdne = grafRoku(prehled([]))
  ok('srovnání bez jediného řádku = „bez_dat" a žádný slot nemá srovnání', prazdne.pokryti.druh === 'bez_dat' && prazdne.sloty.every((s) => s.srovnani === null))
  ok('srovnání nenačtené (null) = „nenacteno", sloupce zůstanou', grafRoku(null).pokryti.druh === 'nenacteno' && grafRoku(null).sloty[9].aktualni?.haleru === 12_000_000)
  const nulaDnu = grafRoku(prehled([{ ...radek('2025-10-01', A, 5_000), dnu: 0 }]))
  ok('řádek s 0 dny prodejů se nepočítá jako data', nulaDnu.sloty[9].srovnani === null && nulaDnu.pokryti.druh === 'bez_dat')
})

// ---------------------------------------------------------------------
console.log('\n== Po dnech: měsíc proti předchozímu měsíci / loni ==')
await zkus('dny', () => {
  const akt = prehled([radek('2026-10-14', A, 9_000), radek('2026-10-15', A, 2_000), radek('2026-10-31', A, 9_500)])
  const srov = prehled([radek('2026-09-14', A, 8_000), radek('2026-09-30', A, 7_000)])
  const g = sestavitGraf({ cleneni: 'den', druh: 'obdobi', od: '2026-10-01', dnes: '2026-10-15', aktualni: akt, srovnavaci: srov, branchId: null })
  ok('31 slotů říjnu', g.sloty.length === 31)
  ok('31. 10. proti září srovnávací den NEMÁ (žádná nula)', g.sloty[30].obdobiSrovnani === null && g.sloty[30].popisSrovnani === null && g.sloty[30].srovnani === null)
  ok('30. 10. ↔ 30. 9.', g.sloty[29].obdobiSrovnani === '2026-09-30' && g.sloty[29].srovnani?.haleru === 700_000)
  ok('14. 10. uzavřený, rozdíl +12,5 %', g.sloty[13].stav === 'uzavrene' && Math.abs(g.sloty[13].rozdilProcent - 12.5) < 1e-9)
  ok('15. 10. (dnes) běží, 16. 10. budoucí', g.sloty[14].stav === 'bezi' && g.sloty[15].stav === 'budouci')
  ok('popis slotu: „st 14. 10." proti „po 14. 9."', g.sloty[13].popis === 'st 14. 10.' && g.sloty[13].popisSrovnani === 'po 14. 9.')
  ok('srovnání jen 14.–30. 9. = částečné', g.pokryti.druh === 'castecne' && popisUseku('den', g.pokryti.od, g.pokryti.do) === '14. 9. – 30. 9. 2026')
  const loni = sestavitGraf({ cleneni: 'den', druh: 'rok', od: '2026-10-01', dnes: '2026-11-04', aktualni: akt, srovnavaci: prehled([]), branchId: null })
  ok('„stejný měsíc loni": 1. 10. ↔ 1. 10. 2025, 31. 10. ↔ 31. 10. 2025', loni.sloty[0].obdobiSrovnani === '2025-10-01' && loni.sloty[30].obdobiSrovnani === '2025-10-31')
})

// ---------------------------------------------------------------------
console.log('\n== Provozovny: rozsah a stejná sada ==')
await zkus('provozovny', () => {
  const akt = prehled([radek('2026-01-01', A, 100_000, 31), radek('2026-01-01', B, 50_000, 31), radek('2026-02-01', A, 80_000), radek('2026-02-01', B, 40_000)])
  const srov = prehled([radek('2025-01-01', A, 90_000, 31), radek('2025-02-01', A, 60_000), radek('2025-02-01', B, 40_000)])
  const g = sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: akt, srovnavaci: srov, branchId: null })
  ok('leden: teď Perla + Bar, srovnání jen Perla → jinePobocky, bez rozdílu', g.sloty[0].jinePobocky && g.sloty[0].rozdilProcent === null)
  ok('… a věta to vyjmenuje', stejne(g.slotySJinymiPobockami, ['Leden 2026']))
  ok('únor: obě provozovny v obou → součty a rozdíl +20 %', !g.sloty[1].jinePobocky && g.sloty[1].aktualni?.haleru === 12_000_000 && Math.abs(g.sloty[1].rozdilProcent - 20) < 1e-9)
  ok(`dny dvou provozoven se nesčítají: leden 31 dní, ne 62 (${g.sloty[0].aktualni?.dnu})`, g.sloty[0].aktualni?.dnu === 31 && g.sloty[0].aktualni?.dnuNejmene === 31)
  const ruzne = sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: prehled([radek('2026-03-01', A, 1_000, 31), radek('2026-03-01', B, 1_000, 4)]), srovnavaci: prehled([]), branchId: null })
  ok('různé dny provozoven: rozpětí 4–31', ruzne.sloty[2].aktualni?.dnu === 31 && ruzne.sloty[2].aktualni?.dnuNejmene === 4)
  const jenB = sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: akt, srovnavaci: srov, branchId: B })
  ok('vybraná provozovna (Bar): leden jen 50 000 Kč, srovnání bez dat', jenB.sloty[0].aktualni?.haleru === 5_000_000 && jenB.sloty[0].srovnani === null)
  ok('… únor Bar 40 000 proti 40 000, rozdíl 0 %', jenB.sloty[1].aktualni?.haleru === 4_000_000 && jenB.sloty[1].srovnani?.haleru === 4_000_000 && jenB.sloty[1].rozdilProcent === 0)
  ok('… nestejná sada u jedné provozovny nikdy', jenB.slotySJinymiPobockami.length === 0)
})

// ---------------------------------------------------------------------
console.log('\n== Osa ==')
await zkus('osa', () => {
  ok('812 000 Kč → 0, 200 tis., … 1 mil. (v haléřích)', stejne(dilkyOsy(81_200_000), [0, 20_000_000, 40_000_000, 60_000_000, 80_000_000, 100_000_000]))
  ok('popisky jedním stylem: 0 / 200 tis. / … / 1 mil.', stejne(popiskyOsy(dilkyOsy(81_200_000)).map(mezery), ['0', '200 tis.', '400 tis.', '600 tis.', '800 tis.', '1 mil.']))
  ok('malá osa celými čísly: 0 / 500 / 1 000 / 1 500 / 2 000', stejne(popiskyOsy([0, 50_000, 100_000, 150_000, 200_000]).map(mezery), ['0', '500', '1 000', '1 500', '2 000']))
  ok('osa přes 10 000 Kč zkrátí všechny: 0 / 5 tis. / 10 tis. / 15 tis.', stejne(popiskyOsy([0, 500_000, 1_000_000, 1_500_000]).map(mezery), ['0', '5 tis.', '10 tis.', '15 tis.']))
  let dobre = true
  for (let i = 1; i < 4000; i++) {
    const max = Math.round(Math.exp(i / 230) * 137)
    const d = dilkyOsy(max)
    const kroky = d.slice(1).map((x, j) => x - d[j])
    if (d[0] !== 0 || d.at(-1) < max || kroky.some((k) => k !== kroky[0] || k <= 0) || d.length - 1 < 3 || d.length - 1 > 5) { dobre = false; console.log('    osa nesedí pro', max, d); break }
  }
  ok('pro 4 000 maxim: od nuly, vrch ≥ maximum, stejné kroky, 3–5 dílků', dobre)
  ok('žádná data → osa se nezhroutí (0 … 1 000 Kč)', dilkyOsy(0)[0] === 0 && dilkyOsy(0).at(-1) === 100_000)
  ok('rozdíl: „+12,4 %", „−3,0 %", „0,0 %"', popisRozdilu(12.44) === '+12,4 %' && popisRozdilu(-3) === '−3,0 %' && popisRozdilu(0.04) === '0,0 %')
})

// ---------------------------------------------------------------------
console.log('\n== Karta: co opravdu uvidí člověk (vykreslené HTML) ==')
const ODKAZ = js(
  `import { createElement } from ${JSON.stringify(import.meta.resolve('react'))}\n` +
    'export default function Link({ href, children, scroll, prefetch, ...z }) { return createElement("a", { href, ...z }, children) }\n',
)
await zkus('karta', async () => {
  const Karta = await nactiKomponentu('app/[rozsah]/finance/trzby/srovnani.tsx', [['next/link', ODKAZ]])
  const vykreslit = (graf) => renderToStaticMarkup(createElement(Karta, { graf, nazvyPobocek: NAZVY, odkazNaDruh: (d) => `/firma/finance/trzby?srovnani=${d}` }))

  const g = grafRoku(SROV_ROK)
  const html = vykreslit(g)
  const sloupcu = (html.match(/class="ds-graf-sloupec[ "]/g) ?? []).length
  ok(`sloupce jen u měsíců s prodeji: 4 (leden, únor, říjen, listopad) — je ${sloupcu}`, sloupcu === 4)
  ok('rozběhnutý listopad má vlastní vzhled (právě 1 sloupec „bezi")', (html.match(/ds-graf-sloupec-bezi/g) ?? []).length === 1)
  const cara = /<path d="([^"]+)" class="ds-graf-cara"/.exec(html)?.[1] ?? ''
  const useku = (cara.match(/M/g) ?? []).length
  ok(`čára srovnání se v mezerách přerušuje: 3 úseky (březen | říjen | prosinec) — je ${useku}`, useku === 3)
  ok('věta nahlas: srovnání má data jen za březen – prosinec 2025', text(html).includes('Srovnávací období má v appce tržby jen za březen – prosinec 2025'))
  ok('věta o rozběhnutém listopadu (rozdíl se neukazuje)', text(html).includes('Listopad 2026 ještě běží'))
  ok('tabulka srovnání: 120 000 Kč (31 dní) a +20,0 %', text(html).includes('120 000 Kč (31 dní)') && text(html).includes('+20,0 %'))
  ok('podnadpis: „2026 proti 2025 · porovnání vůči 1. 1. – 31. 12. 2025"', text(html).includes('2026 proti 2025 · porovnání vůči 1. 1. – 31. 12. 2025'))
  ok('po měsících se přepínač srovnání nekreslí', !html.includes('Předchozí měsíc') && !html.includes('Stejný měsíc loni'))
  ok('SVG není roztažené (preserveAspectRatio="none" by smrsklo písmo)', !html.includes('preserveAspectRatio'))
  ok('graf jde z klávesnice (tabindex) a má přístupný název', /class="ds-graf-plocha" tabindex="0" role="group" aria-label="Graf srovnání tržeb/.test(html))

  const bez = vykreslit(grafRoku(prehled([])))
  ok('bez dat ve srovnání: věta nahlas „nemá appka z pokladny žádné tržby"', text(bez).includes('Za 2025 nemá appka z pokladny žádné tržby'))
  ok('… legenda u čáry „bez dat — čára chybí"', text(bez).includes('bez dat — čára chybí'))
  ok('… a žádná čára ani body (žádné vymyšlené nuly)', !bez.includes('class="ds-graf-cara"') && !bez.includes('class="ds-graf-bod"'))
  ok('… v tabulce „–", ne „0 Kč"', !/>\s*0 Kč/.test(bez) && text(bez).includes('bez dat'))

  const nenacteno = vykreslit(grafRoku(null))
  ok('srovnání nenačtené: věta „se nepodařilo načíst"', text(nenacteno).includes('Srovnávací období (2025) se nepodařilo načíst'))

  const akt = prehled([radek('2026-01-01', A, 100_000, 31), radek('2026-01-01', B, 50_000, 31)])
  const jine = vykreslit(sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: akt, srovnavaci: prehled([radek('2025-01-01', A, 90_000, 31)]), branchId: null }))
  ok('různé dny provozoven v textu: „(4–31 dní podle provozovny)", nikdy součet „35 dní"', (() => {
    const t = text(vykreslit(sestavitGraf({ cleneni: 'mesic', druh: 'obdobi', od: '2026-01-01', dnes: '2026-11-04', aktualni: prehled([radek('2026-03-01', A, 1_000, 31), radek('2026-03-01', B, 1_000, 4)]), srovnavaci: prehled([]), branchId: null })))
    return t.includes('2 000 Kč (4–31 dní podle provozovny)') && !t.includes('35 dní')
  })())
  ok('nestejné provozovny: věta + jména v tabulce',text(jine).includes('Leden 2026: srovnání v něm zahrnuje jiné provozovny') && text(jine).includes('nesrovnává stejné provozovny: Perla test, Bar test proti Perla test'))

  const dny = vykreslit(sestavitGraf({ cleneni: 'den', druh: 'rok', od: '2026-10-01', dnes: '2026-11-04', aktualni: prehled([radek('2026-10-02', A, 9_000)]), srovnavaci: prehled([radek('2025-10-02', A, 8_000)]), branchId: null }))
  ok('po dnech přepínač: Předchozí měsíc / Stejný měsíc loni, vybraný má aria-current',
    /href="\/firma\/finance\/trzby\?srovnani=obdobi"[^>]*>Předchozí měsíc</.test(dny) && /href="\/firma\/finance\/trzby\?srovnani=rok"[^>]*aria-current="true"[^>]*>Stejný měsíc loni</.test(dny))
  ok('po dnech: podnadpis „Říjen 2026 proti říjen 2025"', text(dny).includes('Říjen 2026 proti říjen 2025 · porovnání vůči 1. 10. – 31. 10. 2025'))
})

// ---------------------------------------------------------------------
console.log('\n== Barvy: tokeny v obou režimech, kontrast značek ≥ 3:1 ==')
await zkus('barvy', () => {
  const tokeny = readFileSync(new URL('../app/_tokeny.css', import.meta.url), 'utf8')
  const komponenty = readFileSync(new URL('../app/_komponenty.css', import.meta.url), 'utf8')
  // Začátky bloků na začátku řádku — v hlavičkovém komentáři se tytéž selektory zmiňují slovy.
  const zacatek = (re) => { const m = re.exec(tokeny); if (!m) throw new Error('blok nenalezen: ' + re); return m.index }
  const iSvetly = zacatek(/^:root \{/m)
  const iSystem = zacatek(/^@media \(prefers-color-scheme: dark\) \{/m)
  const iPrepinac = zacatek(/^:root\[data-theme="dark"\] \{/m)
  const iKonec = tokeny.indexOf('Klíč barvy z branches.color', iPrepinac)
  const bloky = [
    ['světlý', tokeny.slice(iSvetly, iSystem)],
    ['tmavý (systém)', tokeny.slice(iSystem, iPrepinac)],
    ['tmavý (přepínač)', tokeny.slice(iPrepinac, iKonec)],
  ]
  ok('bloky tokenů v pořadí světlý → systém → přepínač', iSvetly < iSystem && iSystem < iPrepinac && iPrepinac < iKonec)
  const hex = (blok, nazev) => new RegExp(`${nazev}:\\s*(#[0-9a-f]{6})`, 'i').exec(blok)?.[1] ?? null
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const jas = (h) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const kontrast = (a, b) => { const [x, y] = [jas(a), jas(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const [rezim, blok] of bloky) {
    const karta = hex(blok, '--card')
    const sl = hex(blok, '--graf-obdobi')
    const ca = hex(blok, '--graf-srovnani')
    ok(`${rezim}: --graf-obdobi i --graf-srovnani definované`, sl !== null && ca !== null && karta !== null)
    if (sl && ca && karta) {
      ok(`${rezim}: sloupce ≥ 3:1 na kartě (${kontrast(sl, karta).toFixed(2)})`, kontrast(sl, karta) >= 3)
      ok(`${rezim}: čára ≥ 3:1 na kartě (${kontrast(ca, karta).toFixed(2)})`, kontrast(ca, karta) >= 3)
      ok(`${rezim}: dvě řady nejsou tatáž barva`, sl.toLowerCase() !== ca.toLowerCase())
    }
  }
  ok('sloupec a čára berou barvu z tokenů', /\.ds-graf-sloupec \{ fill: var\(--graf-obdobi\)/.test(komponenty) && /\.ds-graf-cara \{[^}]*stroke: var\(--graf-srovnani\)/.test(komponenty))
  const bezKomentaru = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const soubor of ['app/[rozsah]/finance/trzby/graf-srovnani.tsx', 'app/[rozsah]/finance/trzby/srovnani.tsx']) {
    const zdroj = bezKomentaru(readFileSync(new URL(`../${soubor}`, import.meta.url), 'utf8'))
    ok(`${soubor}: žádná barva napevno (#hex, rgb)`, !/#[0-9a-f]{3,8}\b/i.test(zdroj) && !/rgba?\(/.test(zdroj))
  }
})

// ---------------------------------------------------------------------
console.log('\n== Stránka: srovnání týmž dotazem, na pobočce jen její řádky ==')
globalThis.__trzbyTest = null
const STUBY = [
  ['next/link', ODKAZ],
  ['next/navigation', js('export function redirect(u) { throw new Error("redirect " + u) }\nexport function usePathname() { return "/" }\n')],
  ['@/lib/firma', js('export async function getCurrentTenantId() { return globalThis.__trzbyTest.tenant }\n')],
  ['@/lib/finance-pristup', js('export async function zkusPristupFinanci(t, p, r) { globalThis.__trzbyTest.pristupy.push([t, p, r]); return globalThis.__trzbyTest.pristup }\n')],
  ['@/lib/authz', js('export const TENANT_SCOPE_SEGMENT = "firma"\n')],
  ['@/lib/prihlaseni-adresa', js('export async function odkazNaPrihlaseni() { return "/prihlaseni" }\n')],
  ['@/lib/supabase/dotaz', js('export class DotazSelhal extends Error {}\nexport function tabulkaNeexistuje() { return false }\nexport function funkceNeexistuje() { return false }\n')],
  ['@/lib/supabase/server', js(`export async function getServerSupabase() {
  const t = globalThis.__trzbyTest
  return { from(tabulka) {
    const vysledek = { data: t.tabulky[tabulka] ?? [], error: null }
    const q = new Proxy(function () {}, { get(_, k) { if (k === 'then') return (a, b) => Promise.resolve(vysledek).then(a, b); return () => q } })
    return q
  } }
}\n`)],
  ['@/lib/pokladna-trzby-nacteni', js(`export async function nactiPrehledTrzeb(tenantId, od, doData, cleneni) {
  const t = globalThis.__trzbyTest
  t.volani.push([tenantId, od, doData, cleneni])
  const v = t.odpoved(od, doData, cleneni)
  if (v instanceof Error) throw v
  return v
}\n`)],
  ['../navigace', js('export default function Navigace({ children }) { return children }\n')],
]
const najdiPrvek = (el, jmeno) => {
  if (el == null || typeof el !== 'object') return null
  if (Array.isArray(el)) { for (const x of el) { const r = najdiPrvek(x, jmeno); if (r) return r } return null }
  if (typeof el.type === 'function' && el.type.name === jmeno) return el
  return najdiPrvek(el.props?.children, jmeno)
}
const DATA_STRANKY = {
  '2025-01-01': prehled([radek('2025-10-01', A, 100_000, 31), radek('2025-10-01', B, 40_000, 31)]),
  '2024-01-01': prehled([radek('2024-10-01', A, 70_000, 31), radek('2024-10-01', B, 30_000, 31)]),
  '2025-10-01': prehled([radek('2025-10-07', A, 9_000), radek('2025-10-07', B, 3_000)]),
  '2024-10-01': prehled([radek('2024-10-07', A, 8_000), radek('2024-10-07', B, 2_000)]),
  '2025-09-01': prehled([radek('2025-09-07', A, 7_000), radek('2025-09-07', B, 1_000)]),
}
const SCOPE_POBOCKA = { level: 'branch', branchId: B, branchName: 'Bar test' }
const SCOPE_FIRMA = { level: 'tenant', branchId: null, branchName: null }
const nastavit = (pristup, odpoved = (od) => DATA_STRANKY[od] ?? prehled([])) => {
  globalThis.__trzbyTest = {
    tenant: 'tenant-test',
    pristup,
    pristupy: [],
    volani: [],
    odpoved,
    tabulky: {
      branches: [{ id: A, name: 'Perla test', active: true }, { id: B, name: 'Bar test', active: true }],
      platebni_ucty: [],
      integrace_pripojeni: [{ branch_id: null, externi_ucet: { provozovny: [{ id: '1', branch_id: A }, { id: '2', branch_id: B }] } }],
      ostatni_trzby: [],
    },
  }
  return globalThis.__trzbyTest
}
await zkus('stránka', async () => {
  const Stranka = (await nactiModul('app/[rozsah]/finance/trzby/page.tsx', STUBY)).default
  const otevrit = async (rozsah, hledani) => Stranka({ params: Promise.resolve({ rozsah }), searchParams: Promise.resolve(hledani) })

  // Pobočka (Bar) po měsících 2025.
  let t = nastavit({ stav: 'ok', scope: SCOPE_POBOCKA })
  let el = await otevrit('bernard-bar', { po: 'mesic', obdobi: '2025' })
  ok('přístup se ověřuje právem finance.read za rozsah adresy', stejne(t.pristupy, [['tenant-test', 'finance.read', 'bernard-bar']]))
  ok(`pobočka: dvě volání téže funkce, tatáž firma — rok 2025 a srovnání 2024 (${JSON.stringify(t.volani)})`,
    stejne(t.volani, [['tenant-test', '2025-01-01', '2025-12-31', 'mesic'], ['tenant-test', '2024-01-01', '2024-12-31', 'mesic']]))
  let obsah = najdiPrvek(el, 'Obsah')
  ok('pobočka: Obsah dostal srovnání', obsah?.props?.srovnani?.prehled != null)
  ok('pobočka: přehled i srovnání JEN s řádky Baru (jenPobocka)',
    obsah?.props?.prehled?.trzby?.every((r) => r.branchId === B) && obsah?.props?.srovnani?.prehled?.trzby?.length === 1 && obsah.props.srovnani.prehled.trzby[0].branchId === B)
  let html = text(renderToStaticMarkup(obsah))
  ok('pobočka: v grafu Bar 40 000 Kč proti 30 000 Kč, rozdíl +33,3 %', html.includes('40 000 Kč (31 dní)') && html.includes('30 000 Kč (31 dní)') && html.includes('+33,3 %'))
  ok('pobočka: čísla Perly ani součet firmy v grafu nejsou', !html.includes('70 000 Kč') && !html.includes('100 000 Kč (31 dní)') && !html.includes('140 000'))

  // Celá firma.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA })
  el = await otevrit('firma', { po: 'mesic', obdobi: '2025' })
  obsah = najdiPrvek(el, 'Obsah')
  html = text(renderToStaticMarkup(obsah))
  ok('firma: součet 140 000 Kč proti 100 000 Kč, +40,0 %', html.includes('140 000 Kč (31 dní)') && html.includes('100 000 Kč (31 dní)') && html.includes('+40,0 %'))

  // Celá firma s vybranou provozovnou.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA })
  el = await otevrit('firma', { po: 'mesic', obdobi: '2025', pobocka: B })
  html = text(renderToStaticMarkup(najdiPrvek(el, 'Obsah')))
  ok('firma + ?pobocka=Bar: graf jen Bar 40 000 proti 30 000', html.includes('40 000 Kč (31 dní)') && html.includes('30 000 Kč (31 dní)') && !html.includes('140 000'))

  // Po dnech, stejný měsíc loni; volba se drží v odkazech.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA })
  el = await otevrit('firma', { obdobi: '2025-10', srovnani: 'rok' })
  ok(`po dnech + srovnani=rok: srovnání = říjen 2024 (${JSON.stringify(t.volani[1])})`, stejne(t.volani[1], ['tenant-test', '2024-10-01', '2024-10-31', 'den']))
  obsah = najdiPrvek(el, 'Obsah')
  ok('… odkaz na „Předchozí měsíc" volbu zruší, na „loni" ji nese', obsah?.props?.srovnani?.odkazNaDruh('obdobi') === '/firma/finance/trzby?obdobi=2025-10' && obsah.props.srovnani.odkazNaDruh('rok') === '/firma/finance/trzby?obdobi=2025-10&srovnani=rok')
  const vnitrek = renderToStaticMarkup(el.props.children)
  ok('… šipka „← Dřívější" volbu srovnání drží', vnitrek.includes('href="/firma/finance/trzby?obdobi=2025-09&amp;srovnani=rok"'))

  // Po dnech výchozí = předchozí měsíc.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA })
  await otevrit('firma', { obdobi: '2025-10' })
  ok('po dnech výchozí: srovnání = září 2025', stejne(t.volani[1], ['tenant-test', '2025-09-01', '2025-09-30', 'den']))

  // Po rocích se nesrovnává — jediné volání, čárový graf zůstává.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA })
  el = await otevrit('firma', { po: 'rok' })
  ok('po rocích: jediné volání, srovnání žádné', t.volani.length === 1 && najdiPrvek(el, 'Obsah')?.props?.srovnani === null)

  // Bez práva: žádné čtení vůbec.
  t = nastavit({ stav: 'odepren' })
  el = await otevrit('firma', { po: 'mesic', obdobi: '2025' })
  ok('bez finance.read: ani jedno volání přehledu, věta o oprávnění', t.volani.length === 0 && renderToStaticMarkup(el).includes('Na tohle nemáte oprávnění'))

  // Pobočka bez přehledu celé firmy (zkusPristupFinanci) — nic se nečte.
  t = nastavit({ stav: 'pobocka_bez_firmy' })
  await otevrit('bernard-bar', { po: 'mesic', obdobi: '2025' })
  ok('pobočka bez práva za celou firmu: ani jedno volání', t.volani.length === 0)

  // Selhání srovnání stránku neshodí.
  t = nastavit({ stav: 'ok', scope: SCOPE_FIRMA }, (od) => (od === '2024-01-01' ? new Error('spadlo') : DATA_STRANKY[od] ?? prehled([])))
  el = await otevrit('firma', { po: 'mesic', obdobi: '2025' })
  html = text(renderToStaticMarkup(najdiPrvek(el, 'Obsah')))
  ok('srovnání spadlo: stránka stojí, graf řekne „se nepodařilo načíst", sloupce zůstanou', html.includes('se nepodařilo načíst') && html.includes('140 000 Kč (31 dní)'))
})

console.log(chyb === 0 ? '\nVšechno prošlo.' : `\nSpadlo: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
