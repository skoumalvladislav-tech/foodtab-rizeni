#!/usr/bin/env node
/**
 * Trendy na Finance → Přehled: srovnatelná období (lib/finance-obdobi.ts)
 * a co z nich KPI karty opravdu počítají (lib/finance-kpi-vypocet.ts,
 * s podstrčeným načítáním místo databáze).
 *
 * Do 14. 10. 2026 se rozběhnutý měsíc srovnával s celým minulým a tržby
 * v polovině měsíce vždycky „padaly" (produkce: −47 % Bernard Bar,
 * −56,5 % firma). Tady se hlídá:
 *   * trend rozběhnutého měsíce = 1. až VČEREJŠEK proti týmž dnům
 *     minulého měsíce, první den měsíce a budoucí měsíc bez trendu;
 *   * hodnoty karet dál za celý měsíc, trendy všech pěti karet z oken
 *     trendu, náklady práce s trendem jen u uzavřeného měsíce;
 *   * Tržby bez dat „–" s důvodem, ne 0 Kč;
 *   * že to stránka a lib/finance-kpi.ts opravdu používají.
 *
 * Pusť `node scripts/finance-obdobi.test.mjs`.
 */

import { readFileSync } from 'node:fs'

const { hraniceMesice, popisRozsahu, predchoziMesic, srovnaniMesice } = await import('../lib/finance-obdobi.ts')
const { popisZdrojeTrzeb, sestavitFinanceKpi } = await import('../lib/finance-kpi-vypocet.ts')
const { prevestPrehled } = await import('../lib/pokladna-trzby.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const hodi = (fn) => { try { fn(); return false } catch { return true } }
const stejne = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** Procenta z dělení (0,3 × 100 = 30,000000000000004) — srovnání na 6 míst. */
const zaokr = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)
const dvojice = (t) => (t ? { aktualni: zaokr(t.aktualni), predchozi: zaokr(t.predchozi) } : t)
/** Zdroj bez komentářů (JSX, blokových i celořádkových) a s LF konci řádků. */
const zdroj = (cesta) =>
  readFileSync(new URL(cesta, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

console.log('\n== Měsíce ==')
ok('hranice října', stejne(hraniceMesice('2026-10'), { od: '2026-10-01', doData: '2026-10-31' }))
ok('hranice února 2028 (přestupný)', stejne(hraniceMesice('2028-02'), { od: '2028-02-01', doData: '2028-02-29' }))
ok('před lednem je prosinec předchozího roku', predchoziMesic('2027-01') === '2026-12')
ok('nesmyslný měsíc → chyba', hodi(() => hraniceMesice('2026-13')) && hodi(() => predchoziMesic('2026-1')))

console.log('\n== Rozběhnutý měsíc: 1. až včerejšek proti týmž dnům ==')
{
  const s = srovnaniMesice('2026-10', '2026-10-14')
  ok('14. 10.: 1.–13. 10. proti 1.–13. 9. (dnešek ještě běží — pokladna ho dosílá)',
    s.druh === 'stejne_dny' && s.dnu === 13 && stejne(s.aktualni, { od: '2026-10-01', doData: '2026-10-13' }) && stejne(s.predchozi, { od: '2026-09-01', doData: '2026-09-13' }))
  ok('popisek „1.–13. 9."', s.druh === 'stejne_dny' && popisRozsahu(s.predchozi) === '1.–13. 9.')
}
{
  const s = srovnaniMesice('2026-10', '2026-10-02')
  ok('2. 10.: jediný ukončený den 1. 10. proti 1. 9., popisek „1. 9."',
    s.druh === 'stejne_dny' && stejne(s.aktualni, { od: '2026-10-01', doData: '2026-10-01' }) && popisRozsahu(s.predchozi) === '1. 9.')
}
{
  const s30 = srovnaniMesice('2026-03', '2026-03-30')
  const s31 = srovnaniMesice('2026-03', '2026-03-31')
  ok('30. 3.: 1.–29. 3. proti únoru oříznutému na jeho konec (1.–28. 2.)',
    s30.druh === 'stejne_dny' && s30.aktualni.doData === '2026-03-29' && stejne(s30.predchozi, { od: '2026-02-01', doData: '2026-02-28' }))
  ok('31. 3.: 1.–30. 3. proti 1.–28. 2.',
    s31.druh === 'stejne_dny' && s31.aktualni.doData === '2026-03-30' && s31.predchozi.doData === '2026-02-28')
  const prestupny = srovnaniMesice('2028-03', '2028-03-31')
  ok('přestupný rok: 31. 3. 2028 proti 1.–29. 2. 2028', prestupny.druh === 'stejne_dny' && prestupny.predchozi.doData === '2028-02-29')
}
{
  const s = srovnaniMesice('2027-01', '2027-01-05')
  ok('leden proti prosinci předchozího roku (1.–4. 1. proti 1.–4. 12. 2026)',
    s.druh === 'stejne_dny' && stejne(s.aktualni, { od: '2027-01-01', doData: '2027-01-04' }) && stejne(s.predchozi, { od: '2026-12-01', doData: '2026-12-04' }))
}
{
  const s = srovnaniMesice('2026-10', '2026-10-31')
  ok('poslední den měsíce: pořád 1. až včerejšek (1.–30. 10. proti 1.–30. 9.), ne celý měsíc',
    s.druh === 'stejne_dny' && s.aktualni.doData === '2026-10-30' && s.predchozi.doData === '2026-09-30')
}
ok('první den měsíce: žádný ukončený den → bez trendu', srovnaniMesice('2026-10', '2026-10-01').druh === 'zadne')

console.log('\n== Uzavřený a budoucí měsíc ==')
ok('uzavřený měsíc: celý proti celému', srovnaniMesice('2026-09', '2026-10-14').druh === 'cele')
ok('uzavřený prosinec v lednu: celý', srovnaniMesice('2026-12', '2027-01-01').druh === 'cele')
ok('budoucí měsíc: bez trendu', srovnaniMesice('2026-11', '2026-10-14').druh === 'zadne')
ok('nesmyslné datum nebo měsíc → chyba', hodi(() => srovnaniMesice('2026-10', '2026-10-32')) && hodi(() => srovnaniMesice('2026-13', '2026-10-01')))

/* ---------------------------------------------------------------------
 * KPI karty s podstrčeným načítáním: každé okno vrací jiná čísla, takže
 * z výsledku je vidět, které okno karta použila. Okno, o které by se
 * výpočet neměl ptát, podvrh odmítne (scénář pak spadne).
 * --------------------------------------------------------------------- */

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const okno = (r) => `${r.od}…${r.doData}`
const NENACTENO = Symbol('pokladna selže')

/** Cashflow přehled: řádek pobočky A + firemní účty. */
const cf = (prijmyA, vydajeA, prijmyFirma = 0) => ({
  pobocky: [{ branchId: A, pobocka: 'A', skutecnostPrijmyHaleru: prijmyA, skutecnostVydajeHaleru: vydajeA, planPrijmyHaleru: 0, planVydajeHaleru: 0 }],
  firma: { skutecnostPrijmyHaleru: prijmyFirma, skutecnostVydajeHaleru: 0, planPrijmyHaleru: 0, planVydajeHaleru: 0 },
})
/** Foodcost/beverage: tržby 1000 každého druhu → procento = náklady / 10. */
const fb = (jidlo, napoj) => [
  { druh: 'jidlo', trzby_haleru: 1000, naklady_haleru: jidlo, trzby_bez_nakladu_haleru: 0 },
  { druh: 'napoj', trzby_haleru: 1000, naklady_haleru: napoj, trzby_bez_nakladu_haleru: 0 },
]
const dny = (radky) => prevestPrehled({
  trzby: radky.map(([obdobi, branch_id, trzba_haleru]) => ({ obdobi, branch_id, trzba_haleru, polozek: 1, dnu: 1, dnu_s_platbami: 0 })),
  platby: [], zpusoby: [], banka: [],
})

function podvrh({ cashflow, foodcost, mzdy, pokladny = null, maUcet = true }) {
  const volani = { cashflow: [], foodcost: [], vysledovka: [], mzdy: [], pokladny: [] }
  const z = (mapa, klic, co) => {
    if (!(klic in mapa)) throw new Error(`${co}: nečekané okno ${klic}`)
    return mapa[klic]
  }
  return {
    volani,
    nacti: {
      cashflow: async (r) => { volani.cashflow.push(okno(r)); return z(cashflow, okno(r), 'cashflow') },
      vysledovka: async (r) => { volani.vysledovka.push(okno(r)); return [] },
      foodcostBeverage: async (r) => { volani.foodcost.push(okno(r)); return z(foodcost, okno(r), 'foodcost') },
      mzdy: async (den) => { volani.mzdy.push(den); return z(mzdy, den, 'mzdy') },
      pokladny: async (od, doData) => {
        volani.pokladny.push(`${od}…${doData}`)
        if (pokladny === NENACTENO) throw new Error('pokladna_prehled_trzeb selhala')
        return pokladny
      },
      pobockaMaUcet: async () => maUcet,
    },
  }
}

/** Spustí výpočet pro zobrazený měsíc a dnešek; chyba = spadlý scénář, ne pád celé sady. */
async function kpiPro(mesic, dnes, data, { pobocka = null, smiVidetMzdy = true } = {}) {
  const p = podvrh(data)
  const vstup = {
    obdobi: hraniceMesice(mesic),
    predchoziObdobi: hraniceMesice(predchoziMesic(mesic)),
    srovnani: srovnaniMesice(mesic, dnes),
    aktivniPobocky: [A, B],
    pobocka,
    smiVidetMzdy,
  }
  try {
    return { kpi: await sestavitFinanceKpi(vstup, p.nacti), volani: p.volani }
  } catch (e) {
    ok(`výpočet ${mesic} k ${dnes} proběhl (${e.message})`, false)
    return { kpi: null, volani: p.volani }
  }
}

const CELY_RIJEN = '2026-10-01…2026-10-31'
const CELE_ZARI = '2026-09-01…2026-09-30'
const CELY_SRPEN = '2026-08-01…2026-08-31'
const RIJEN_1_12 = '2026-10-01…2026-10-12'
const ZARI_1_12 = '2026-09-01…2026-09-12'

// Po dnech: září A i B; říjen A 5. 10. a dnešních (rozběhnutých) 13. 10., B 6. 10.
const POKLADNA = dny([
  ['2026-09-05', A, 100], ['2026-09-20', A, 900], ['2026-09-06', B, 40],
  ['2026-10-05', A, 200], ['2026-10-13', A, 50], ['2026-10-06', B, 60],
])
const ROZBEHNUTY = {
  cashflow: { [CELY_RIJEN]: cf(10000, 4000, 1000), [RIJEN_1_12]: cf(3000, 1000), [ZARI_1_12]: cf(2000, 1000, 500) },
  foodcost: { [CELY_RIJEN]: fb(300, 200), [RIJEN_1_12]: fb(250, 150), [ZARI_1_12]: fb(200, 100) },
  // Mzdy září podvrh má — kdyby se na ně výpočet zeptal, ukáže se to jako trend, ne pád.
  mzdy: { '2026-10-01': 62, '2026-09-01': 52 },
  pokladny: POKLADNA,
}

console.log('\n== KPI rozběhnutého měsíce (13. 10.): hodnoty za celý měsíc, trend 1.–12. ==')
{
  const { kpi, volani } = await kpiPro('2026-10', '2026-10-13', ROZBEHNUTY)
  ok('hodnoty karet za celý říjen: tržby 310 (i dnešních 50), cashflow 7000, foodcost 30 %, beverage 20 %',
    kpi?.trzbyHaleru === 310 && kpi.cashflowHaleru === 7000 && zaokr(kpi.foodcostProcento) === 30 && zaokr(kpi.beverageCostProcento) === 20)
  ok('náklady podle kategorie i náklady práce za celý říjen (62 / 310 = 20 %)',
    stejne(volani.vysledovka, [CELY_RIJEN]) && zaokr(kpi?.nakladyPraceProcento) === 20)
  ok('trend Tržeb: 1.–12. 10. (260) proti 1.–12. 9. (140), bez dnešního dne', stejne(kpi?.trendTrzby, { aktualni: 260, predchozi: 140 }))
  ok('trend Cashflow ze stejných dnů: 2000 proti 1500', stejne(kpi?.trendCashflow, { aktualni: 2000, predchozi: 1500 }))
  ok('trend Foodcost z oken trendu: 25 % proti 20 % (ne 30 % celého měsíce)', stejne(dvojice(kpi?.trendFoodcost), { aktualni: 25, predchozi: 20 }))
  ok('trend Beverage cost z oken trendu: 15 % proti 10 %', stejne(dvojice(kpi?.trendBeverageCost), { aktualni: 15, predchozi: 10 }))
  ok('Náklady práce: rozběhnutý měsíc bez trendu a mzdy září se ani nenačtou', kpi?.trendNakladyPrace === null && stejne(volani.mzdy, ['2026-10-01']))
  ok('načtená okna cashflow/foodcost: celý říjen + 1.–12. 10. + 1.–12. 9., nikdy celé září',
    stejne([...volani.cashflow].sort(), [CELY_RIJEN, RIJEN_1_12, ZARI_1_12].sort()) && stejne([...volani.foodcost].sort(), [CELY_RIJEN, RIJEN_1_12, ZARI_1_12].sort()))
  ok('pokladna jedním dotazem po dnech přes oba měsíce (1. 9.–31. 10.)', stejne(volani.pokladny, ['2026-09-01…2026-10-31']))
  ok('Tržby mají číslo „z pokladen"', kpi?.trzbyMajiData === true && popisZdrojeTrzeb(kpi, false) === 'z pokladen')
}

console.log('\n== KPI uzavřeného měsíce: celý proti celému, náklady práce s trendem ==')
{
  const { kpi, volani } = await kpiPro('2026-09', '2026-10-13', {
    cashflow: { [CELE_ZARI]: cf(9000, 3000), [CELY_SRPEN]: cf(8000, 3000) },
    foodcost: { [CELE_ZARI]: fb(400, 300), [CELY_SRPEN]: fb(350, 250) },
    mzdy: { '2026-09-01': 2700, '2026-08-01': 2000 },
    pokladny: null, // funkce v databázi ještě není → tržby z plateb
  })
  ok('tržby z plateb: září 9000 proti srpnu 8000', kpi?.zdrojTrzeb === 'platby' && kpi.trzbyHaleru === 9000 && stejne(kpi.trendTrzby, { aktualni: 9000, predchozi: 8000 }))
  ok('cashflow, foodcost a beverage: celé září proti celému srpnu',
    stejne(kpi?.trendCashflow, { aktualni: 6000, predchozi: 5000 }) && stejne(dvojice(kpi?.trendFoodcost), { aktualni: 40, predchozi: 35 })
    && stejne(dvojice(kpi?.trendBeverageCost), { aktualni: 30, predchozi: 25 }))
  ok('Náklady práce: 30 % proti 25 % (mzdy obou celých měsíců)',
    stejne(dvojice(kpi?.trendNakladyPrace), { aktualni: 30, predchozi: 25 }) && stejne([...volani.mzdy].sort(), ['2026-08-01', '2026-09-01']))
  ok('celé září se nenačítá dvakrát (hodnota = aktuální okno trendu)',
    volani.cashflow.filter((o) => o === CELE_ZARI).length === 1 && volani.foodcost.filter((o) => o === CELE_ZARI).length === 1)
}

console.log('\n== První den a budoucí měsíc: žádný trend na žádné kartě ==')
{
  const zadnyTrend = (kpi) => kpi !== null && [kpi.trendTrzby, kpi.trendCashflow, kpi.trendFoodcost, kpi.trendBeverageCost, kpi.trendNakladyPrace].every((t) => t === null)
  const prvni = await kpiPro('2026-10', '2026-10-01', {
    cashflow: { [CELY_RIJEN]: cf(10000, 4000) }, foodcost: { [CELY_RIJEN]: fb(300, 200) }, mzdy: { '2026-10-01': 62 }, pokladny: POKLADNA,
  })
  ok('1. 10.: všech pět karet bez trendu', zadnyTrend(prvni.kpi))
  ok('… hodnoty karet pořád za celý říjen a z minulého měsíce se nic nenačítá',
    prvni.kpi?.trzbyHaleru === 310 && stejne(prvni.volani.cashflow, [CELY_RIJEN]) && stejne(prvni.volani.foodcost, [CELY_RIJEN]) && stejne(prvni.volani.mzdy, ['2026-10-01']))
  const budouci = await kpiPro('2026-11', '2026-10-13', {
    cashflow: { '2026-11-01…2026-11-30': cf(0, 0) }, foodcost: { '2026-11-01…2026-11-30': [] }, mzdy: { '2026-11-01': 0 }, pokladny: POKLADNA,
  })
  ok('budoucí listopad: všech pět karet bez trendu', zadnyTrend(budouci.kpi))
}

console.log('\n== Tržby bez dat za měsíc: „–" s důvodem, ne 0 Kč ==')
{
  const jenZari = { ...ROZBEHNUTY, pokladny: dny([['2026-09-05', A, 100]]) }
  const firma = (await kpiPro('2026-10', '2026-10-13', jenZari)).kpi
  ok('celá firma: zdroj pokladna, ale trzbyMajiData false (karta ukáže „–")', firma?.zdrojTrzeb === 'pokladna' && firma.trzbyMajiData === false)
  ok('… popisek „pokladna za tento měsíc zatím nic neposlala" a žádný trend',
    firma !== null && popisZdrojeTrzeb(firma, false) === 'pokladna za tento měsíc zatím nic neposlala' && firma.trendTrzby === null)
  const pobocka = (await kpiPro('2026-10', '2026-10-13', jenZari, { pobocka: A })).kpi
  ok('pobočka: totéž s „pokladna pobočky…"', pobocka?.trzbyMajiData === false && popisZdrojeTrzeb(pobocka, true) === 'pokladna pobočky za tento měsíc zatím nic neposlala')
  const nenacteno = (await kpiPro('2026-10', '2026-10-13', { ...ROZBEHNUTY, pokladny: NENACTENO })).kpi
  ok('nenačtené tržby z pokladen: „–" (nenahrazují se platbami) a Cashflow přesto spočítané',
    nenacteno?.zdrojTrzeb === 'nenacteno' && nenacteno.trzbyMajiData === false && nenacteno.trendTrzby === null && nenacteno.cashflowHaleru === 7000)
}

console.log('\n== Na pobočce (Finance po pobočkách): jen její čísla i trendy ==')
{
  const { kpi } = await kpiPro('2026-10', '2026-10-13', ROZBEHNUTY, { pobocka: A })
  ok('tržby jen A za celý říjen (250), pokrytí 1 z 1', kpi?.trzbyHaleru === 250 && stejne(kpi.pokrytiPokladnou, { maji: 1, celkem: 1 }))
  ok('trend tržeb jen A: 200 proti 100 (B se nepřimíchá)', stejne(kpi?.trendTrzby, { aktualni: 200, predchozi: 100 }))
  ok('cashflow jen řádek A, bez firemních účtů: 6000, trend 2000 proti 1000',
    kpi?.cashflowHaleru === 6000 && stejne(kpi.trendCashflow, { aktualni: 2000, predchozi: 1000 }))
  const bezUctu = (await kpiPro('2026-10', '2026-10-13', { ...ROZBEHNUTY, maUcet: false }, { pobocka: A })).kpi
  ok('pobočka bez vlastního účtu: cashflow bez trendu', bezUctu?.pobockaBezUctu === true && bezUctu.trendCashflow === null)
}

console.log('\n== Jiná sada poboček s pokladnou: trend tržeb se nesrovná ==')
{
  const pripojenaVPulce = { ...ROZBEHNUTY, pokladny: dny([['2026-09-05', A, 100], ['2026-10-05', A, 200], ['2026-10-06', B, 60]]) }
  const { kpi } = await kpiPro('2026-10', '2026-10-13', pripojenaVPulce)
  ok('B poslala až v říjnu → trend tržeb null (ne „růst")', kpi !== null && kpi.trendTrzby === null && kpi.trzbyHaleru === 260)
}

console.log('\n== Stránka a lib/finance-kpi.ts to opravdu používají ==')
{
  const stranka = zdroj('../app/[rozsah]/finance/page.tsx')
  ok('„dnes" je provozní den (05:00, pásmo appky), ne kalendářní ani UTC',
    /return provozniDen\(Date\.now\(\), '05:00', ZONA_VYCHOZI\)/.test(stranka) && /const dnes = provozniDnes\(\)/.test(stranka)
    && !/denVPasmu\(/.test(stranka) && !/toISOString\(\)\.slice\(0, 7\)/.test(stranka))
  ok('výchozí měsíc z provozního dne', /\? mesicParam : dnes\.slice\(0, 7\)/.test(stranka))
  ok('trend ze srovnaniMesice(mesic, dnes)', /const srovnani = srovnaniMesice\(mesic, dnes\)/.test(stranka))
  ok('KPI dostanou CELÉ měsíce pro hodnoty a srovnani pro trend (i s pobočkou)',
    /nactiFinanceKpi\(tenantId, pristup\.ctx, branches, hraniceMesice\(mesic\), hraniceMesice\(mesicPredchozi\), srovnani, pobocka\)/.test(stranka))
  ok('popisek „vs.": stejné dny popisRozsahu, jinak jméno měsíce',
    /const srovnaniS = srovnani\.druh === 'stejne_dny' \? popisRozsahu\(srovnani\.predchozi\) : nazevMesice\(mesicPredchozi\)/.test(stranka))
  ok('všech pět karet má popisek srovnání ze srovnaniS', (stranka.match(/srovnaniS=\{srovnaniS\}/g) ?? []).length === 5)
  const trendy = [...stranka.matchAll(/ trend=\{([^\n]*)\}\n/g)].map((m) => m[1])
  ok('všech pět karet bere trend jen z kpi.trend… (žádný vlastní výpočet z hodnot měsíce)',
    stejne(trendy, [
      "trend(kpi.trendTrzby, '%', true)",
      "trend(kpi.trendCashflow, '%', true)",
      "trend(kpi.trendFoodcost, 'p. b.', false)",
      "trend(kpi.trendBeverageCost, 'p. b.', false)",
      "trend(kpi.trendNakladyPrace, 'p. b.', false)",
    ]))
  ok('karta Tržby: bez dat „–", ne koruny(…), a popisek zdroje z popisZdrojeTrzeb',
    /titulek="Tržby" hodnota=\{kpi\.trzbyMajiData \? koruny\(kpi\.trzbyHaleru\) : '–'\}/.test(stranka)
    && /zdroj=\{popisZdrojeTrzeb\(kpi, naPobocce\)\}/.test(stranka))
  ok('mřížka grafů se na telefonu nevynucuje 360 px', /minmax\(min\(360px, 100%\), 1fr\)/.test(stranka) && !/minmax\(360px, 1fr\)/.test(stranka))

  const kpi = zdroj('../lib/finance-kpi.ts')
  ok('nactiFinanceKpi počítá přes sestavitFinanceKpi se srovnani a pobočkou',
    /return sestavitFinanceKpi\(\s*\{ obdobi, predchoziObdobi, srovnani, aktivniPobocky: branches\.map\(\(b\) => b\.id\), pobocka, smiVidetMzdy: canSee\(ctx, 'payroll\.read'\) \}/.test(kpi))
  ok('… pokladna po dnech, foodcost, mzdy a výsledovka s pobočkou rozsahu',
    /pokladny: \(od, doData\) => nactiPrehledTrzeb\(tenantId, od, doData, 'den'\)/.test(kpi)
    && /foodcostBeverage: \(r\) => nactiFoodcostBeverage\(tenantId, pobocka, r\.od, r\.doData\)/.test(kpi)
    && /mzdy: \(den\) => nactiSoucetMzdyHaleru\(tenantId, pobocka, den\)/.test(kpi)
    && /vysledovka: \(r\) => nactiVysledovkuCelofirmy\(tenantId, branches, r\.od, r\.doData, pobocka\)/.test(kpi))
  ok('staré API (srovnatelnaObdobi, popisCastecnehoObdobi, srovnaniCastecne) zmizelo',
    !/srovnatelnaObdobi|popisCastecnehoObdobi|srovnaniCastecne/.test(stranka + kpi + zdroj('../lib/finance-obdobi.ts')))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
