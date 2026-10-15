#!/usr/bin/env node
/**
 * Přehled tržeb z pokladen — čistá logika, bez sítě a databáze.
 *
 *   lib/pokladna-trzby.ts — výklad JSONu z `pokladna_prehled_trzeb`,
 *                           období (dny/měsíce/roky), řádky po obdobích
 *                           a pobočkách, způsoby platby, KPI měsíce.
 *
 * A jedna statická kontrola: druhy plateb v appce = CHECK v migraci
 * 20261012200000 (jinak by adaptér mohl poslat druh, který databáze
 * odmítne, nebo přehled neuměl sloupec, který databáze pustí).
 *
 * Pusť `node scripts/pokladna-trzby.test.mjs`.
 */

import { readFileSync } from 'node:fs'

const {
  DRUHY_PLATEB,
  NAZVY_DRUHU_PLATEB,
  jenPobocka,
  pokladnaPatriPobocce,
  obdobiVRozsahu,
  popisObdobi,
  pouziteDruhy,
  prevestPrehled,
  radkyPoObdobich,
  radkyPoPobockach,
  soucet,
  pokrytiObdobi,
  pokrytiRozsahu,
  trzbaObdobi,
  zacatekObdobi,
  zpusobyVRozsahu,
} = await import('../lib/pokladna-trzby.ts')
const { ZPUSOBY_PLATBY_DOTYKACKY } = await import('../lib/pokladna-dotykacka.ts')
const { popisRozsahu, srovnaniMesice } = await import('../lib/finance-obdobi.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const hodi = (fn) => { try { fn(); return false } catch { return true } }

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

const DATA = {
  trzby: [
    { obdobi: '2026-10-01', branch_id: A, trzba_haleru: 150000, polozek: 10, dnu: 1, dnu_s_platbami: 1 },
    { obdobi: '2026-10-02', branch_id: A, trzba_haleru: 70000, polozek: 5, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-01', branch_id: B, trzba_haleru: 30000, polozek: 2, dnu: 1, dnu_s_platbami: 1 },
  ],
  platby: [
    { obdobi: '2026-10-01', branch_id: A, druh: 'hotovost', castka_haleru: 50000, pocet: 3 },
    { obdobi: '2026-10-01', branch_id: A, druh: 'karta', castka_haleru: 100000, pocet: 4 },
    { obdobi: '2026-10-01', branch_id: B, druh: 'karta', castka_haleru: 30000, pocet: 1 },
  ],
  zpusoby: [
    { branch_id: A, zpusob: '900000002', nazev: 'Platební karta', druh: 'karta', castka_haleru: 100000, pocet: 4 },
    { branch_id: A, zpusob: '900000001', nazev: 'Hotovost', druh: 'hotovost', castka_haleru: 50000, pocet: 3 },
    { branch_id: B, zpusob: '900000002', nazev: 'Platební karta', druh: 'karta', castka_haleru: 30000, pocet: 1 },
  ],
  banka: [
    { obdobi: '2026-10-02', branch_id: A, prijmy_haleru: 120000 },
    { obdobi: '2026-10-02', branch_id: null, prijmy_haleru: 5000 },
  ],
}

console.log('\n== Výklad odpovědi databáze ==')
{
  const p = prevestPrehled(DATA)
  ok('převede všechny čtyři seznamy', p.trzby.length === 3 && p.platby.length === 3 && p.zpusoby.length === 3 && p.banka.length === 2)
  ok('banka bez pobočky = null (firemní účet)', p.banka[1].branchId === null)
  ok('tržba jako text NEprojde jako číslo (radši chyba než tichá nula)',
    hodi(() => prevestPrehled({ ...DATA, trzby: [{ ...DATA.trzby[0], trzba_haleru: '150000' }] })))
  ok('chybějící seznam → chyba', hodi(() => prevestPrehled({ trzby: [], platby: [], zpusoby: [] })))
  ok('neznámý druh platby → chyba', hodi(() => prevestPrehled({ ...DATA, platby: [{ ...DATA.platby[0], druh: 'bitcoin' }] })))
  ok('záporná tržba → chyba (tabulka ji nepustí, odpověď ji mít nesmí)',
    hodi(() => prevestPrehled({ ...DATA, trzby: [{ ...DATA.trzby[0], trzba_haleru: -1 }] })))
  ok('záporná platba projde (vratky převážily)',
    !hodi(() => prevestPrehled({ ...DATA, platby: [{ ...DATA.platby[0], castka_haleru: -500 }] })))
  ok('null místo odpovědi → chyba', hodi(() => prevestPrehled(null)))
  ok('neplatné datum období → chyba', hodi(() => prevestPrehled({ ...DATA, trzby: [{ ...DATA.trzby[0], obdobi: '2026-10' }] })))
}

console.log('\n== Období ==')
{
  ok('dny: 30. 9.–2. 10. = 3 dny přes konec měsíce', obdobiVRozsahu('2026-09-30', '2026-10-02', 'den').join() === '2026-09-30,2026-10-01,2026-10-02')
  ok('měsíce: od 15. 11. do 10. 2. = listopad–únor (začátky)', obdobiVRozsahu('2026-11-15', '2027-02-10', 'mesic').join() === '2026-11-01,2026-12-01,2027-01-01,2027-02-01')
  ok('roky: 2024–2026', obdobiVRozsahu('2024-03-01', '2026-10-12', 'rok').join() === '2024-01-01,2025-01-01,2026-01-01')
  ok('jeden den = jedno období', obdobiVRozsahu('2026-10-12', '2026-10-12', 'den').length === 1)
  ok('přestupný rok: 28. 2.–1. 3. 2028 = 3 dny', obdobiVRozsahu('2028-02-28', '2028-03-01', 'den').length === 3)
  ok('začátek období: měsíc i rok', zacatekObdobi('2026-10-12', 'mesic') === '2026-10-01' && zacatekObdobi('2026-10-12', 'rok') === '2026-01-01')
  ok('popis dne s dnem v týdnu (12. 10. 2026 je pondělí)', popisObdobi('2026-10-12', 'den') === 'po 12. 10.')
  ok('popis měsíce a roku', popisObdobi('2026-10-01', 'mesic') === 'Říjen 2026' && popisObdobi('2026-01-01', 'rok') === '2026')
  ok('nesmyslné datum → chyba', hodi(() => obdobiVRozsahu('2026-13-01', '2026-12-31', 'den')))
}

console.log('\n== Řádky po obdobích ==')
{
  const p = prevestPrehled(DATA)
  const obdobi = obdobiVRozsahu('2026-10-01', '2026-10-03', 'den')
  const firma = radkyPoObdobich(p, obdobi, { branchId: null, bankaVidi: true })
  ok('celá firma 1. 10.: 1500 + 300 Kč tržby, 2 dny poboček, oba s platbami',
    firma[0].trzbaHaleru === 180000 && firma[0].dnu === 2 && firma[0].dnuSPlatbami === 2)
  ok('… platby po druhu: hotovost 500, karta 1000 + 300', firma[0].platbyPoDruhu.hotovost === 50000 && firma[0].platbyPoDruhu.karta === 130000 && firma[0].platbyCelkemHaleru === 180000)
  ok('celá firma 2. 10.: banka i s firemním účtem (1200 + 50)', firma[1].bankaHaleru === 125000)
  ok('3. 10. bez dat: dnu 0 (stránka ukáže „–"), ne vymyšlená tržba', firma[2].dnu === 0 && firma[2].trzbaHaleru === 0)
  const jenA = radkyPoObdobich(p, obdobi, { branchId: A, bankaVidi: true })
  ok('jedna pobočka: jen její tržby (1. 10. = 1500)', jenA[0].trzbaHaleru === 150000)
  ok('jedna pobočka: banka jen z jejích účtů, firemní účet ne (2. 10. = 1200)', jenA[1].bankaHaleru === 120000)
  ok('2. 10. pobočky A: den s prodeji, ale bez plateb (dnuSPlatbami 0)', jenA[1].dnu === 1 && jenA[1].dnuSPlatbami === 0)
  const bezBanky = radkyPoObdobich(p, obdobi, { branchId: null, bankaVidi: false })
  ok('kdo banku nevidí, má null, ne 0', bezBanky.every((r) => r.bankaHaleru === null))
  const celkem = soucet(firma, true)
  ok('součet: tržby 2500, platby 1800, banka 1250, 3 dny / 2 s platbami',
    celkem.trzbaHaleru === 250000 && celkem.platbyCelkemHaleru === 180000 && celkem.bankaHaleru === 125000 && celkem.dnu === 3 && celkem.dnuSPlatbami === 2)
  ok('součet bez banky zůstane null', soucet(bezBanky, false).bankaHaleru === null)
  ok('sloupce jen použitých druhů, v pevném pořadí', pouziteDruhy([...firma, celkem]).join() === 'hotovost,karta')
  const posun = radkyPoObdobich(p, ['2026-10-02'], { branchId: null, bankaVidi: true })
  ok('období mimo seznam se nepřimíchá (jen 2. 10.: 700)', posun.length === 1 && posun[0].trzbaHaleru === 70000)
}

console.log('\n== Po pobočkách a způsobech ==')
{
  const p = prevestPrehled(DATA)
  const r = radkyPoPobockach(p, [B, A], true)
  ok('pořadí podle seznamu poboček, firemní účet na konci', r.map((x) => x.branchId).join() === `${B},${A},`)
  ok('A: tržby 2200, banka 1200', r[1].trzbaHaleru === 220000 && r[1].bankaHaleru === 120000)
  ok('firemní účty: jen banka 50', r[2].branchId === null && r[2].bankaHaleru === 5000 && r[2].dnu === 0)
  ok('bez banky: žádný řádek firemního účtu', radkyPoPobockach(p, [A, B], false).every((x) => x.branchId !== null))
  const C = 'cccccccc-0000-0000-0000-000000000003'
  ok('pobočka bez čehokoli se vynechá', !radkyPoPobockach(p, [A, B, C], true).some((x) => x.branchId === C))
  const sirotek = prevestPrehled({ ...DATA, trzby: [...DATA.trzby, { obdobi: '2026-10-01', branch_id: C, trzba_haleru: 1, polozek: 1, dnu: 1, dnu_s_platbami: 0 }] })
  ok('pobočka s daty, která v seznamu není (vypnutá), se neztratí', radkyPoPobockach(sirotek, [A, B], true).some((x) => x.branchId === C))
  const z = zpusobyVRozsahu(p, null)
  ok('způsoby přes pobočky: karta 1000 + 300 = 1300 (5 plateb), první', z[0].zpusob === '900000002' && z[0].castkaHaleru === 130000 && z[0].pocet === 5)
  ok('způsoby jedné pobočky: B jen karta 300', zpusobyVRozsahu(p, B).length === 1 && zpusobyVRozsahu(p, B)[0].castkaHaleru === 30000)
}

console.log('\n== KPI měsíce (Finance → Přehled) ==')
{
  const p = prevestPrehled({ trzby: [
    { obdobi: '2026-09-01', branch_id: A, trzba_haleru: 100, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-01', branch_id: A, trzba_haleru: 200, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-01', branch_id: B, trzba_haleru: 50, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
  ], platby: [], zpusoby: [], banka: [] })
  ok('říjen = 250 přes pobočky, má data', trzbaObdobi(p, '2026-10-01').trzbaHaleru === 250 && trzbaObdobi(p, '2026-10-01').maData)
  ok('srpen bez řádku: nemá data (karta pak nesrovnává pokladnu s bankou)', !trzbaObdobi(p, '2026-08-01').maData)

  const rijen = pokrytiObdobi(p, '2026-10-01', [A, B])
  const zari = pokrytiObdobi(p, '2026-09-01', [A, B])
  ok('říjen: obě aktivní pobočky s daty → úplné pokrytí, 250', rijen.uplne && rijen.pokrytych === 2 && rijen.trzbaHaleru === 250)
  ok('září: data jen z A → neúplné (1 ze 2) — náklady práce se z toho nepočítají', !zari.uplne && zari.pokrytych === 1 && zari.aktivnich === 2)
  ok('sady poboček září × říjen se liší → trend Přehled nesrovná', zari.pobocky.join() !== rijen.pobocky.join())
  ok('pobočka s daty, která už není aktivní, se do pokrytí nepočítá',
    pokrytiObdobi(p, '2026-10-01', [A]).pokrytych === 1 && pokrytiObdobi(p, '2026-10-01', [A]).uplne)
  ok('firma bez aktivních poboček nemá úplné pokrytí (žádné dělení nulou)', !pokrytiObdobi(p, '2026-10-01', []).uplne)
  ok('období bez dat: maData false, pobočky prázdné', !pokrytiObdobi(p, '2026-08-01', [A, B]).maData && pokrytiObdobi(p, '2026-08-01', [A, B]).pobocky.length === 0)
}

console.log('\n== Po pobočkách: banka vypnuté pobočky ==')
{
  const D = 'dddddddd-0000-0000-0000-000000000004'
  const p = prevestPrehled({ ...DATA, banka: [...DATA.banka, { obdobi: '2026-10-02', branch_id: D, prijmy_haleru: 7000 }] })
  const r = radkyPoPobockach(p, [A, B], true)
  ok('účet vypnuté pobočky bez prodejů má vlastní řádek (součet sloupce sedí na kartu)', r.some((x) => x.branchId === D && x.bankaHaleru === 7000))
  ok('… a bez práva na banku se neobjeví', !radkyPoPobockach(p, [A, B], false).some((x) => x.branchId === D))
}

console.log('\n== Finance po pobočkách: přehled zúžený na pobočku (Šéfík 13. 10. 2026) ==')
{
  const p = prevestPrehled(DATA)
  const jenA = jenPobocka(p, A)
  ok('tržby jen pobočky A (2 dny), B tam není', jenA.trzby.length === 2 && jenA.trzby.every((t) => t.branchId === A))
  ok('platby a způsoby jen A', jenA.platby.every((z) => z.branchId === A) && jenA.zpusoby.every((z) => z.branchId === A) && jenA.zpusoby.length === 2)
  ok('banka jen účty A — firemní účet (null) se na pobočku nerozpočítává', jenA.banka.length === 1 && jenA.banka[0].branchId === A)
  ok('celá firma (null): přehled beze změny, i s firemním účtem', jenPobocka(p, null) === p)
  const C = 'cccccccc-0000-0000-0000-000000000003'
  const prazdna = jenPobocka(p, C)
  ok('pobočka bez dat: všechny seznamy prázdné (žádná cizí čísla)',
    prazdna.trzby.length === 0 && prazdna.platby.length === 0 && prazdna.zpusoby.length === 0 && prazdna.banka.length === 0)

  // KPI Přehledu na pobočce: pokrytiObdobi nad zúženým přehledem.
  const mesice = prevestPrehled({ trzby: [
    { obdobi: '2026-09-01', branch_id: B, trzba_haleru: 100, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-01', branch_id: A, trzba_haleru: 200, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-01', branch_id: B, trzba_haleru: 50, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
  ], platby: [], zpusoby: [], banka: [] })
  const firma = pokrytiObdobi(mesice, '2026-10-01', [A, B])
  const rijenA = pokrytiObdobi(jenPobocka(mesice, A), '2026-10-01', [A])
  ok('kontrola: za celou firmu říjen = 250 (obě pobočky)', firma.trzbaHaleru === 250)
  ok('pobočka A říjen: jen 200, ne 250 celé firmy; úplné pokrytí 1 z 1', rijenA.trzbaHaleru === 200 && rijenA.uplne && rijenA.pokrytych === 1 && rijenA.aktivnich === 1)
  const zariA = pokrytiObdobi(jenPobocka(mesice, A), '2026-09-01', [A])
  ok('pobočka A září: bez dat (data B se nepřimíchají), 0 z 1', !zariA.maData && zariA.trzbaHaleru === 0 && zariA.pokrytych === 0 && !zariA.uplne)
  const zariB = pokrytiObdobi(jenPobocka(mesice, B), '2026-09-01', [B])
  ok('pobočka B září: 100, sada poboček [B] — trend září × říjen se srovná', zariB.trzbaHaleru === 100 && zariB.pobocky.join() === pokrytiObdobi(jenPobocka(mesice, B), '2026-10-01', [B]).pobocky.join())
}

console.log('\n== Pokladna pobočky: vlastní připojení, nebo přiřazená provozovna ==')
{
  ok('připojení pobočky (příjmové API) patří své pobočce', pokladnaPatriPobocce({ branch_id: A, externi_ucet: {} }, A))
  ok('… a cizí ne', !pokladnaPatriPobocce({ branch_id: B, externi_ucet: {} }, A))
  ok('připojení pobočky B s provozovnou přiřazenou A — rozhoduje branch_id připojení, ne JSON',
    !pokladnaPatriPobocce({ branch_id: B, externi_ucet: { provozovny: [{ id: '1', branch_id: A }] } }, A))
  const firemni = { branch_id: null, externi_ucet: { provozovny: [{ id: '1', nazev: 'Perla', branch_id: B }, { id: '2', nazev: 'Bar', branch_id: A }] } }
  ok('firemní pokladna s provozovnou přiřazenou A patří A', pokladnaPatriPobocce(firemni, A))
  const C = 'cccccccc-0000-0000-0000-000000000003'
  ok('… a pobočce bez přiřazené provozovny ne', !pokladnaPatriPobocce(firemni, C))
  ok('nepřiřazená provozovna (branch_id null) nepatří nikomu',
    !pokladnaPatriPobocce({ branch_id: null, externi_ucet: { provozovny: [{ id: '1', branch_id: null }] } }, A))
  ok('nečekaný tvar JSONu = nepatří (nic se nevymýšlí)',
    !pokladnaPatriPobocce({ branch_id: null, externi_ucet: null }, A)
    && !pokladnaPatriPobocce({ branch_id: null, externi_ucet: { provozovny: 'x' } }, A)
    && !pokladnaPatriPobocce({ branch_id: null, externi_ucet: { provozovny: [null, 5] } }, A))
}

console.log('\n== Trend na Přehledu: stejné dny rozběhnutého měsíce ==')
{
  const r = srovnaniMesice('2026-10', '2026-10-13')
  ok('rozběhnutý měsíc 13. 10.: srovnávají se 1.–12. 10. proti 1.–12. 9. (dnešek ještě běží)',
    r.druh === 'stejne_dny' && r.dnu === 12 && r.aktualni.od === '2026-10-01' && r.aktualni.doData === '2026-10-12'
    && r.predchozi.od === '2026-09-01' && r.predchozi.doData === '2026-09-12')
  ok('uzavřený měsíc: celý proti celému', srovnaniMesice('2026-09', '2026-10-13').druh === 'cele')
  ok('první den měsíce: žádný ukončený den → trend se nekreslí', srovnaniMesice('2026-10', '2026-10-01').druh === 'zadne')
  ok('budoucí měsíc: nic k srovnání', srovnaniMesice('2026-11', '2026-10-13').druh === 'zadne')
  const brezen = srovnaniMesice('2026-03', '2026-03-31')
  ok('31. 3.: 1.–30. 3. proti 1.–28. 2. (únor kratší — useknutý na poslední den)',
    brezen.druh === 'stejne_dny' && brezen.predchozi.doData === '2026-02-28' && brezen.aktualni.doData === '2026-03-30')
  const leden = srovnaniMesice('2027-01', '2027-01-10')
  ok('leden srovnává s prosincem předchozího roku', leden.druh === 'stejne_dny' && leden.predchozi.od === '2026-12-01' && leden.predchozi.doData === '2026-12-09')
  ok('popisek rozsahu „1.–12. 9."', r.druh === 'stejne_dny' && popisRozsahu(r.predchozi) === '1.–12. 9.')
  ok('popisek jednoho dne „1. 9."', popisRozsahu({ od: '2026-09-01', doData: '2026-09-01' }) === '1. 9.')
  ok('nesmyslný vstup → chyba', hodi(() => srovnaniMesice('2026-13', 'x')))

  const den = prevestPrehled({ trzby: [
    { obdobi: '2026-09-05', branch_id: A, trzba_haleru: 100, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-09-20', branch_id: A, trzba_haleru: 900, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-05', branch_id: A, trzba_haleru: 200, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
    { obdobi: '2026-10-05', branch_id: B, trzba_haleru: 50, polozek: 1, dnu: 1, dnu_s_platbami: 0 },
  ], platby: [], zpusoby: [], banka: [] })
  ok('součet stejných dnů září: jen do 12. 9. (100), ne celé září (1000)', pokrytiRozsahu(den, '2026-09-01', '2026-09-12', [A, B]).trzbaHaleru === 100)
  ok('celé září z dat po dnech: 1000', pokrytiRozsahu(den, '2026-09-01', '2026-09-30', [A, B]).trzbaHaleru === 1000)
  ok('pokrytí z rozsahu: říjen má obě pobočky, září jen A (trend se nesrovná)',
    pokrytiRozsahu(den, '2026-10-01', '2026-10-12', [A, B]).uplne && !pokrytiRozsahu(den, '2026-09-01', '2026-09-12', [A, B]).uplne)
  // Finance po pobočkách + stejné dny: Přehled skládá pokrytiRozsahu nad přehledem zúženým jenPobocka.
  const rijenA = pokrytiRozsahu(jenPobocka(den, A), '2026-10-01', '2026-10-12', [A])
  const zariA = pokrytiRozsahu(jenPobocka(den, A), '2026-09-01', '2026-09-12', [A])
  ok('pobočka A, stejné dny: 200 proti 100 bez tržby B a se sadou [A] v obou (trend se srovná)',
    rijenA.trzbaHaleru === 200 && zariA.trzbaHaleru === 100 && rijenA.pobocky.join() === A && zariA.pobocky.join() === A && rijenA.uplne)

  // Kraje rozsahu jsou VČETNĚ: 1. den, poslední den okna trendu a poslední
  // den měsíce. Částky jsou různé mocniny 10 — ze součtu je vidět, který den
  // chybí nebo přebývá. Hodnota karty Tržby se teď sčítá z těchhle dnů.
  const radekA = (obdobi, trzba_haleru) => ({ obdobi, branch_id: A, trzba_haleru, polozek: 1, dnu: 1, dnu_s_platbami: 0 })
  const kraje = prevestPrehled({ trzby: [
    radekA('2026-09-30', 1), radekA('2026-10-01', 10), radekA('2026-10-12', 100), radekA('2026-10-13', 1000), radekA('2026-10-31', 10000), radekA('2026-11-01', 100000),
  ], platby: [], zpusoby: [], banka: [] })
  ok('okno 1.–12. 10.: 1. i 12. den se počítají, 30. 9. a 13. 10. ne (110)', pokrytiRozsahu(kraje, '2026-10-01', '2026-10-12', [A]).trzbaHaleru === 110)
  ok('celý říjen: od 1. do 31. včetně, bez 30. 9. a 1. 11. (11110)', pokrytiRozsahu(kraje, '2026-10-01', '2026-10-31', [A]).trzbaHaleru === 11110)
  ok('jednodenní okno 1. 10.: jen ten den (10)', pokrytiRozsahu(kraje, '2026-10-01', '2026-10-01', [A]).trzbaHaleru === 10)
}

console.log('\n== Druhy plateb: appka = databáze ==')
{
  const migrace = readFileSync(new URL('../supabase/migrations/20261012200000_pokladna_trzby_obdobi.sql', import.meta.url), 'utf8')
  const m = /druh\s+text not null check \(druh in\s*\(([^)]*)\)\)/.exec(migrace)
  const vDb = m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : []
  ok('CHECK v migraci nalezený', vDb.length > 0)
  ok('stejné druhy ve stejném pořadí jako DRUHY_PLATEB', vDb.join() === DRUHY_PLATEB.join())
  ok('každý druh má český název', DRUHY_PLATEB.every((d) => typeof NAZVY_DRUHU_PLATEB[d] === 'string' && NAZVY_DRUHU_PLATEB[d].length > 0))
  ok('každý způsob Dotykačky má druh, který databáze přijme', Object.values(ZPUSOBY_PLATBY_DOTYKACKY).every((z) => vDb.includes(z.druh)))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
