#!/usr/bin/env node
/**
 * Párování transakcí s fakturami — lib/finance-parovani.ts.
 *
 * Pusť `node --experimental-strip-types scripts/finance-parovani.test.mjs`.
 *
 * Finance Fáze 0, krok 2: (1) VS + částka + IBAN dodavatele = jisté,
 * spáruje se samo; (2) částka + dodavatel + datum v okně = návrh;
 * (3) jinak nespárováno. Nejcennější kontroly tady nejsou „dokonalá
 * shoda se spáruje" — to je samozřejmost. Jsou to ty, že bez IBAN, s jinou
 * nebo prázdnou měnou, se soupeřem nebo se stornem se NIC samo nespáruje,
 * a že návrh nikdy nepřekročí zbytek platby ani faktury.
 */

const {
  vybratAutomatickaParovani, dorovnatStavy, smiOznacitUhrazenou, protistranaSedi, normalizovatVs, jeVracena, jeVKorunach,
  menaNeboCzk, autoTransakceZRadku, platbaZBanky, navrhyParovani, DUVODY_NAVRHU, OKNO_NAVRHU_PRED_VYSTAVENIM,
  OKNO_NAVRHU_PO_SPLATNOSTI, NEJVIC_NAVRHU_NA_POHYB, SLOUPCE_AUTOMATICKEHO_PAROVANI, SLOUPCE_POTVRZENEHO_PAROVANI,
  SLOUPCE_PRIJMU_PRO_VRACENI, SLOUPCE_NAVRHU_POZORNOSTI, sloupceSeznamuPlateb, zbyvaZaplatit, navrhPlati,
} = await import('../lib/finance-parovani.ts')
const { ibanZUctu } = await import('../lib/banka/ucet.ts')
const { readFileSync } = await import('node:fs')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const zkus = (popis, fn) => {
  try { ok(popis, fn()) } catch (e) { ok(`${popis} — výjimka: ${e instanceof Error ? e.message : e}`, false) }
}
const cist = (cesta) => readFileSync(cesta, 'utf8').split('\r\n').join('\n')
const bezKomentaru = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* --- IBAN: stejné příklady jako databáze ----------------------------------- */

console.log('\n== IBAN: TS (ibanZUctu) = databáze (app.normalizovat_ucet) na sdílených příkladech ==')
{
  // Příklady leží JEDNOU, ve scénáři krok112 mezi značkami — databáze je
  // ověří v PGlite, tady je ověří TS. Když se pravidla rozejdou, spadne jedno.
  const scenar = cist('supabase/tests/krok112_scenar.sql')
  const blok = scenar.slice(scenar.indexOf('-- PRIKLADY_UCTU_ZACATEK'), scenar.indexOf('-- PRIKLADY_UCTU_KONEC'))
  const priklady = [...blok.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*(?:'([^']*)'|null)\s*\)/g)]
    .map((m) => ({ vstup: m[1].replace(/''/g, "'"), iban: m[2] ?? null }))
  const sIban = priklady.filter((p) => p.iban !== null).length
  ok(`příklady účtů: aspoň 10, platné i neplatné — naměřeno: ${priklady.length} / s IBAN ${sIban}`,
    priklady.length >= 10 && sIban >= 3 && priklady.length - sIban >= 3)
  for (const p of priklady) zkus(`ibanZUctu(${JSON.stringify(p.vstup)}) → ${p.iban ?? 'null'}`, () => ibanZUctu(p.vstup) === p.iban)
  ok('ibanZUctu(null/undefined) → null', ibanZUctu(null) === null && ibanZUctu(undefined) === null)
}

/* --- Automatické párování --------------------------------------------------- */

console.log('\n== Automatické párování: jen jistá shoda (VS + částka + IBAN) ==')
const UCET = 'CZ6508000000192000145399'
{
  const t = (id, vs, castka, datum = '2026-10-05', jine = {}) => ({ id, vs, castkaHaleru: castka, protistrana: 'ABC Velkoobchod', protiucet: UCET, datum, alokovanoHaleru: 0, zdroj: 'banka_api', mena: 'CZK', smer: 'vydaj', davkaId: null, ...jine })
  // Účet dodavatele na faktuře v českém zápisu — po normalizaci tentýž IBAN.
  const f = (id, vs, castka, stav = 'Ke kontrole úhrady', datum = '2026-09-20', jine = {}) => ({ id, vs, castkaHaleru: castka, dodavatel: 'ABC Velkoobchod s.r.o.', datum, stav, alokovanoHaleru: 0, duplicita: false, archivovana: false, mena: 'CZK', ucetDodavatele: '19-2000145399/0800', ...jine })
  const auto = (tt, ff, moznosti) => vybratAutomatickaParovani(tt, ff, moznosti)

  const jasne = auto([t('t1', '2026001', 500000)], [f('f1', '2026001', 500000), f('f2', '2026002', 500000)])
  ok('stejný VS + přesná částka + stejný účet (IBAN ↔ český zápis), jediný kandidát → spáruje se sám', jasne.length === 1 && jasne[0].transakceId === 't1' && jasne[0].fakturaId === 'f1' && jasne[0].castkaHaleru === 500000 && jasne[0].castkaFakturyHaleru === 500000)

  ok('IBAN: platba bez účtu protistrany → nic', auto([t('t1', '1', 100, '2026-10-05', { protiucet: '' })], [f('f1', '1', 100)]).length === 0)
  ok('IBAN: platba z jiného účtu → nic', auto([t('t1', '1', 100, '2026-10-05', { protiucet: 'DE89370400440532013000' })], [f('f1', '1', 100)]).length === 0)
  ok('IBAN: faktura bez účtu dodavatele → nic', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { ucetDodavatele: null })]).length === 0)
  ok('IBAN: stejný NEPLATNÝ účet na obou stranách se neshoduje → nic',
    auto([t('t1', '1', 100, '2026-10-05', { protiucet: '123456789/0100' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { ucetDodavatele: '123456789/0100' })]).length === 0)
  ok('IBAN: text „účet u dodavatele" na obou stranách → nic',
    auto([t('t1', '1', 100, '2026-10-05', { protiucet: 'účet u dodavatele' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { ucetDodavatele: 'účet u dodavatele' })]).length === 0)

  ok('jiná částka (i o haléř) → nic', auto([t('t1', '2026001', 499999)], [f('f1', '2026001', 500000)]).length === 0)
  ok('jen částka bez VS → nic (to je jen návrh)', auto([t('t1', '', 500000)], [f('f1', '', 500000)]).length === 0)
  ok('jiný VS → nic', auto([t('t1', '2026009', 500000)], [f('f1', '2026001', 500000)]).length === 0)
  ok('VS s nulami navíc („12345" = „0012345") je stejný VS — jako v databázi (app.normalizovat_vs)', auto([t('t1', '12345', 100)], [f('f1', '0012345', 100)]).length === 1)

  ok('dvě faktury se stejným VS a částkou → nic (rozhodne člověk)',
    auto([t('t1', '777', 1500000)], [f('leden', '777', 1500000), f('unor', '777', 1500000)]).length === 0)
  ok('dvě platby na jednu fakturu → nic',
    auto([t('t1', '777', 1500000), t('t2', '777', 1500000)], [f('f1', '777', 1500000)]).length === 0)

  // Nález kontroly kódu (8. 10.): minulá platba nájmu „zaplatila" ten příští.
  ok('nájem: září ručně „Uhrazeno" (bez párování), přijde říjen se stejným VS a částkou → nic',
    auto([t('zari10', '2024', 2500000, '2026-09-10')], [f('zari', '2024', 2500000, 'Uhrazeno', '2026-09-01'), f('rijen', '2024', 2500000, 'Ke kontrole úhrady', '2026-10-01')]).length === 0)
  ok('… totéž, když je zářijová faktura archivovaná',
    auto([t('zari10', '2024', 2500000, '2026-09-10')], [f('zari', '2024', 2500000, 'Ke kontrole úhrady', '2026-09-01', { archivovana: true }), f('rijen', '2024', 2500000, 'Ke kontrole úhrady', '2026-10-01')]).length === 0)
  ok('… a když je stará platba už spárovaná, nová stejná platba taky nic (opakuje se)',
    auto([t('zari10', '2024', 2500000, '2026-09-10', { alokovanoHaleru: 2500000 }), t('rijen10', '2024', 2500000, '2026-10-10')], [f('rijen', '2024', 2500000, 'Ke kontrole úhrady', '2026-10-01')]).length === 0)
  ok('… a když je stará faktura „Ke schválení", taky nic',
    auto([t('rijen10', '2024', 2500000, '2026-10-10')], [f('brezen', '2024', 2500000, 'Ke schválení', '2026-03-01'), f('rijen', '2024', 2500000, 'Ke kontrole úhrady', '2026-10-01')]).length === 0)
  ok('… a když má druhá faktura VS s pomlčkou („2026-001" = „2026001", kolo 3)',
    auto([t('t1', '2026001', 121000, '2026-10-05', { protistrana: 'GASTRO PLUS AS' })], [f('a', '2026001', 121000, 'Ke kontrole úhrady', '2026-09-25', { dodavatel: 'Gastro Plus a.s.' }), f('b', '2026-001', 121000, 'Ke kontrole úhrady', '2026-09-26', { dodavatel: 'Gastro Plus a.s.' })]).length === 0)
  ok('… a když má jiná faktura ze stejného období stejnou částku a žádný VS (kolo 3)',
    auto([t('t1', '2026001', 121000, '2026-10-05')], [f('a', '2026001', 121000), f('b', null, 121000, 'Ke kontrole úhrady', '2026-09-28')]).length === 0)
  ok('… ale faktura bez VS se stejnou částkou o rok dřív nevadí',
    auto([t('t1', '2026001', 121000, '2026-10-05')], [f('a', '2026001', 121000), f('b', null, 121000, 'Uhrazeno', '2025-09-28')]).length === 1)
  ok('… a když má lednová faktura VS s nulami na začátku (kolo 2)',
    auto([t('leden20', '12345', 1000000, '2026-01-20')], [f('leden', '0012345', 1000000, 'Neuhrazeno', '2026-01-01'), f('unor', '12345', 1000000, 'Ke kontrole úhrady', '2026-02-01')]).length === 0)
  ok('… a když příjem u staré faktury nepřečetl částku (0)',
    auto([t('leden20', '2024', 1000000, '2026-01-20')], [f('leden', '2024', 0, 'Nutná ruční kontrola (chybí částka)', '2026-01-01'), f('unor', '2024', 1000000, 'Ke kontrole úhrady', '2026-02-01')]).length === 0)

  for (const stav of ['Ke schválení', 'Upomínka - zkontrolovat', 'Nutná ruční kontrola (chybí částka)', 'Odmítnuto', 'Uhrazeno', 'Částečně uhrazeno', null]) {
    ok(`faktura ve stavu „${stav}" se sama nezaplatí`, auto([t('t1', '1', 100)], [f('f1', '1', 100, stav)]).length === 0)
  }
  ok('stav „Neuhrazeno" se zaplatit smí', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Neuhrazeno')]).length === 1)
  ok('možná duplicita se sama nezaplatí', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { duplicita: true })]).length === 0)
  ok('archivovaná se sama nezaplatí', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { archivovana: true })]).length === 0)
  ok('faktura už s částečnou platbou → nic', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { alokovanoHaleru: 50 })]).length === 0)
  ok('platba už (částečně) použitá jinde → nic', auto([t('t1', '1', 100, '2026-10-05', { alokovanoHaleru: 30 })], [f('f1', '1', 100)]).length === 0)

  for (const zdroj of ['rucni', 'csv_pokladna', 'pos_adapter']) {
    ok(`platba „${zdroj}" (ne z banky) → nic`, auto([t('t1', '1', 100, '2026-10-05', { zdroj })], [f('f1', '1', 100)]).length === 0)
  }
  ok('platba z banky přes API (banka_api) → smí', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'banka_api' })], [f('f1', '1', 100)]).length === 1)
  ok('staré jméno zdroje (fio_api, bankovni_agregator) už jako platba z banky neprojde', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'fio_api' })], [f('f1', '1', 100)]).length === 0
    && auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'bankovni_agregator' })], [f('f1', '1', 100)]).length === 0)
  // Dávku výpisu, kterou právě nahrál člověk, posuzuje jen databáze pod jeho
  // přihlášením (sparovat_jiste_z_davky) — úloha bez přihlášeného jí nevěří,
  // ani když jí někdo dávku podstrčí (stará volba duveryhodneDavky).
  ok('výpis CSV bez potvrzení banky → nic, ani s podstrčenou „důvěryhodnou" dávkou',
    auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd1' })], [f('f1', '1', 100)]).length === 0
      && auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd1' })], [f('f1', '1', 100)], { duveryhodneDavky: new Set(['d1']) }).length === 0)
  // Výpis nahraný dřív, potom stažení z banky: stažení se podruhé nezapíše
  // a jen potvrdí řádek výpisu (transakce_potvrzeni_banky). Ten řádek je
  // pak ta platba z banky — i v dalších bězích, ne jen při nahrání výpisu.
  ok('výpis CSV potvrzený stažením z banky → smí',
    auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd-stara', potvrzenoBankou: true })], [f('f1', '1', 100)]).length === 1)
  ok('potvrzení banky u ručního zápisu nebo pokladny nic nemění → nic',
    ['rucni', 'csv_pokladna', 'pos_adapter'].every((zdroj) =>
      auto([t('t1', '1', 100, '2026-10-05', { zdroj, potvrzenoBankou: true })], [f('f1', '1', 100)]).length === 0))
  {
    const radekVypisu = { id: 'v1', vs: '1', castka_haleru: 100, protistrana: 'Dodavatel s.r.o.', protiucet: '', datum: '2026-10-05', zdroj: 'csv_banka', mena: 'CZK', smer: 'vydaj', import_davka_id: 'd-stara' }
    ok('autoTransakceZRadku: řádek výpisu s potvrzením banky je potvrzený, bez něj ne, ruční nikdy',
      autoTransakceZRadku(radekVypisu, new Set(['v1'])).potvrzenoBankou === true
        && autoTransakceZRadku(radekVypisu, new Set(['jiny'])).potvrzenoBankou === false
        && autoTransakceZRadku(radekVypisu).potvrzenoBankou === false
        && autoTransakceZRadku({ ...radekVypisu, zdroj: 'rucni' }, new Set(['v1'])).potvrzenoBankou === false)
    ok('platbaZBanky: potvrzený řádek výpisu ano, nepotvrzený ne, banka_api ano, ruční ne',
      platbaZBanky({ zdroj: 'csv_banka', potvrzenoBankou: true })
        && !platbaZBanky({ zdroj: 'csv_banka', potvrzenoBankou: false })
        && platbaZBanky({ zdroj: 'banka_api' })
        && !platbaZBanky({ zdroj: 'rucni', potvrzenoBankou: true }))
    ok('autoTransakceZRadku: prázdná měna zůstane prázdná (ne „CZK")', autoTransakceZRadku({ ...radekVypisu, mena: null }).mena === '')
    ok('autoTransakceZRadku: storno i stornovaný pohyb jsou „stornovano"',
      autoTransakceZRadku({ ...radekVypisu, storno_of: 'x' }).stornovano === true
        && autoTransakceZRadku(radekVypisu, undefined, new Set(['v1'])).stornovano === true
        && autoTransakceZRadku(radekVypisu).stornovano === false)
  }

  // Měna: obě vyplněné a stejné. Prázdná nikdy jistě (otázka 111).
  ok('faktura v EUR, platba v CZK (stejné číslo) → nic', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: 'EUR' })]).length === 0)
  ok('platba i faktura v EUR → smí (stejná vyplněná měna, jako databáze)', auto([t('t1', '1', 100, '2026-10-05', { mena: 'EUR' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: 'EUR' })]).length === 1)
  ok('měna faktury neuvedená → nic (prázdná měna nikdy jistě)', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: null })]).length === 0)
  ok('měna platby prázdná → nic', auto([t('t1', '1', 100, '2026-10-05', { mena: '' })], [f('f1', '1', 100)]).length === 0)
  ok('„ czk " = „CZK" (mezery, malá písmena)', auto([t('t1', '1', 100, '2026-10-05', { mena: ' czk ' })], [f('f1', '1', 100)]).length === 1)

  ok('úplně jiná protistrana než dodavatel → nic', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'Kovošrot Zlín' })], [f('f1', '1', 100)]).length === 0)
  ok('jiná firma se stejnou právní formou („s.r.o.") → nic (kolo 2)', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'Novák Stavby s.r.o.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'Alza.cz s.r.o.' })]).length === 0)
  ok('stejná firma jinak zapsaná (MAKRO … CR s.r.o. / Makro … ČR) → smí', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'MAKRO Cash & Carry CR s.r.o.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'Makro Cash & Carry ČR' })]).length === 1)
  ok('protistrana z banky prázdná → rozhoduje zbytek', auto([t('t1', '1', 100, '2026-10-05', { protistrana: '' })], [f('f1', '1', 100)]).length === 1)

  ok('banka platbu vrátila (příjem, stejný VS a částka, za 2 dny) → nic (kolo 2)',
    auto([t('t1', '1', 100, '2026-10-05'), t('vraceni', '1', 100, '2026-10-07', { smer: 'prijem' })], [f('f1', '1', 100)]).length === 0)
  ok('… i bez VS, když příjem přišel od stejné protistrany',
    auto([t('t1', '1', 100, '2026-10-05'), t('vraceni', '', 100, '2026-10-07', { smer: 'prijem', protistrana: 'ABC VELKOOBCHOD' })], [f('f1', '1', 100)]).length === 0)
  ok('jiný příjem (jiná částka) platbu neblokuje',
    auto([t('t1', '1', 100, '2026-10-05'), t('trzba', '1', 999, '2026-10-07', { smer: 'prijem' })], [f('f1', '1', 100)]).length === 1)

  ok('stornovaná platba → nic', auto([t('t1', '1', 100, '2026-10-05', { stornovano: true })], [f('f1', '1', 100)]).length === 0)
  ok('stornovaný dvojník soupeřem není → druhá platba se spáruje',
    auto([t('t1', '1', 100, '2026-10-05', { stornovano: true }), t('t2', '1', 100, '2026-10-06')], [f('f1', '1', 100)]).map((p) => p.transakceId).join() === 't2')

  ok('platba 31 dní PŘED fakturou → nic', auto([t('t1', '1', 100, '2026-08-20')], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20')]).length === 0)
  ok('platba 10 dní před fakturou (záloha) → spáruje se', auto([t('t1', '1', 100, '2026-09-10')], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20')]).length === 1)
  ok('platba 91 dní PO faktuře → nic', auto([t('t1', '1', 100, '2026-12-20')], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20')]).length === 0)
  ok('faktura bez data → nic', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', null)]).length === 0)

  ok('dvojici, kterou člověk zrušil, nevybere', auto([t('t1', '1', 100)], [f('f1', '1', 100)], { zamitnute: new Set(['t1|f1']) }).length === 0)
  ok('VS s mezerami okolo se bere jako stejný', auto([t('t1', ' 42 ', 100)], [f('f1', '42', 100)]).length === 1)
}

console.log('\n== Jméno protistrany a vrácené platby (kolo 3) ==')
{
  ok('jedno společné slovo nestačí: „GASTRO PLUS" ≠ „Gastro Servis"', !protistranaSedi('GASTRO PLUS AS', 'Gastro Servis s.r.o.'))
  ok('… ani křestní jméno: „NOVAK JAN" ≠ „Jan Dvořák"', !protistranaSedi('NOVAK JAN', 'Jan Dvořák'))
  ok('… ani „Město": „MESTO KOLIN" ≠ „Město Brandýs"', !protistranaSedi('MESTO KOLIN', 'Město Brandýs'))
  ok('zkrácené jméno z banky projde: „MAKRO CASH" = „Makro Cash & Carry ČR s.r.o."', protistranaSedi('MAKRO CASH', 'Makro Cash & Carry ČR s.r.o.'))
  ok('stejná osoba v jiném pořadí: „NOVAK JAN" = „Jan Novák"', protistranaSedi('NOVAK JAN', 'Jan Novák'))
  ok('normalizace VS: pomlčky, lomítka, mezery a nuly pryč', normalizovatVs('2026-001') === '2026001' && normalizovatVs(' 0002026/001 ') === '2026001' && normalizovatVs('FV') === null && normalizovatVs('000') === null)

  const platba = { vs: '2026001', castkaHaleru: 500000, datum: '2026-10-05', protistrana: 'ABC Velkoobchod' }
  const prijem = (castka, datum, vs = '2026001', protistrana = '') => ({ vs, castkaHaleru: castka, datum, protistrana })
  ok('vrácená celá částka za 2 dny → vrácená', jeVracena(platba, [prijem(500000, '2026-10-07')]))
  ok('vrácená se strženým poplatkem 2 % → vrácená', jeVracena(platba, [prijem(490000, '2026-10-07')]))
  ok('příjem o 4 % menší → ne (to je jiný pohyb)', !jeVracena(platba, [prijem(480000, '2026-10-07')]))
  ok('příjem 31 dní po → ne', !jeVracena(platba, [prijem(500000, '2026-11-05')]))
  ok('příjem PŘED platbou → ne', !jeVracena(platba, [prijem(500000, '2026-10-04')]))
  ok('bez VS od stejné protistrany → vrácená', jeVracena(platba, [prijem(500000, '2026-10-08', '', 'ABC VELKOOBCHOD')]))
  ok('příjem s JINÝM VS od stejné protistrany → ne (vrácení jiné platby, kolo 4)', !jeVracena(platba, [prijem(500000, '2026-10-08', '2026002', 'ABC VELKOOBCHOD')]))
}

console.log('\n== Protiúčet ve vlastním sloupci (Finance Fáze 0, krok 1): pravidla platí jako dřív ==')
{
  const radek = (id, smer, castka, datum, jine = {}) => ({ id, vs: '', castka_haleru: castka, protistrana: '', protiucet: '', datum, zdroj: 'banka_api', mena: 'CZK', smer, import_davka_id: null, ...jine })
  const makro = { id: 'fm', vs: '2026001', castkaHaleru: 500000, dodavatel: 'Makro Cash & Carry ČR s.r.o.', datum: '2026-09-20', stav: 'Ke kontrole úhrady', alokovanoHaleru: 0, duplicita: false, archivovana: false, mena: 'CZK', ucetDodavatele: UCET }

  const bezJmena = autoTransakceZRadku(radek('t1', 'vydaj', 500000, '2026-10-05', { vs: '2026001', protiucet: UCET }))
  ok('pohyb bez jména: protistrana pro párování = číslo účtu (jak dřív)', bezJmena.protistrana === UCET && bezJmena.protiucet === UCET)
  ok('výdaj bez jména se dodavateli sám nespáruje (pravidlo protistrany platí dál)',
    vybratAutomatickaParovani([bezJmena], [makro]).length === 0)

  const platbaMakro = autoTransakceZRadku(radek('t2', 'vydaj', 500000, '2026-10-05', { vs: '2026001', protistrana: 'MAKRO CASH', protiucet: UCET }))
  const vraceniBezJmena = autoTransakceZRadku(radek('t3', 'prijem', 500000, '2026-10-07', { protiucet: UCET }))
  ok('kontrolní: platba se jménem dodavatele a jeho účtem, bez vrácení, se spáruje', vybratAutomatickaParovani([platbaMakro], [makro]).length === 1)
  ok('vrácení bez VS a bez jména z téhož účtu se pozná → platba se sama nespáruje',
    vybratAutomatickaParovani([platbaMakro, vraceniBezJmena], [makro]).length === 0)
  ok('… i když jméno nemá ani platba (oba pohyby jen s číslem účtu)', jeVracena(bezJmena, [vraceniBezJmena]))
  ok('příjem bez VS a bez jména z JINÉHO účtu vrácením není',
    !jeVracena(platbaMakro, [autoTransakceZRadku(radek('t4', 'prijem', 500000, '2026-10-07', { protiucet: 'DE89370400440532013000' }))]))

  // Úloha párování je `server-only` a Node ji nespustí — hlídá se, že
  // pohyby čte i s protiúčtem a stornem a převádí je touhle funkcí.
  const uloha = cist('lib/finance-automaticke-parovani.ts')
  ok('úloha párování: dotaz na pohyby čte výčet SLOUPCE_AUTOMATICKEHO_PAROVANI',
    /from\('transakce'\)\s*\.select\(SLOUPCE_AUTOMATICKEHO_PAROVANI\)/.test(uloha))
  ok('úloha párování: pohyby převádí autoTransakceZRadku i s potvrzeními banky a storny',
    /transakce\.map\(\(t\) => autoTransakceZRadku\(t, potvrzeneBankou, stornovane\)\)/.test(uloha))
  ok('úloha párování: potvrzení čte z transakce_potvrzeni_banky (transakce_id) své firmy',
    /from\('transakce_potvrzeni_banky'\)\.select\('transakce_id'\)\s*\.eq\('tenant_id', tenantId\)/.test(uloha)
      && /potvrzeneBankou\.add\(r\.transakce_id\)/.test(uloha))
  ok('SLOUPCE_AUTOMATICKEHO_PAROVANI čte storno_of', SLOUPCE_AUTOMATICKEHO_PAROVANI.split(',').map((s) => s.trim()).includes('storno_of'))
  const strankaPlateb = cist('app/[rozsah]/finance/platby/page.tsx')
  ok('Platby: vrácení a seznam protistranu doplní číslem účtu',
    (strankaPlateb.match(/protistranaNeboUcet\(/g) ?? []).length >= 3 && /protiucet: t\.protiucet/.test(strankaPlateb))
  ok('Platby: potvrzená párování čtou výčet SLOUPCE_POTVRZENEHO_PAROVANI',
    /from\('transakce'\)\s*\.select\(SLOUPCE_POTVRZENEHO_PAROVANI\)/.test(strankaPlateb))
  ok('Platby: příjmy pro vrácení čtou výčet SLOUPCE_PRIJMU_PRO_VRACENI',
    /from\('transakce'\)\.select\(SLOUPCE_PRIJMU_PRO_VRACENI\)/.test(strankaPlateb))
  ok('Platby: seznam plateb čte výčet sloupceSeznamuPlateb (firma i pobočka)',
    /const sloupceTransakci: string = sloupceSeznamuPlateb\(Boolean\(pobocka\)\)/.test(strankaPlateb)
      && /from\('transakce'\)\.select\(sloupceTransakci\)/.test(strankaPlateb))
  const exportUcetni = cist('app/api/ucetni/export/route.ts')
  ok('účetní export: protistrana = jméno, jinak číslo účtu', /protistrana: protistranaNeboUcet\(t\.protistrana, t\.protiucet\)/.test(exportUcetni))
  ok('účetní export: čte výčet sloupceTransakciExportu', /from\('transakce'\)\s*\.select\(sloupceTransakciExportu\(Boolean\(pobocka\)\)\)/.test(exportUcetni))
  const pozornost = cist('lib/finance-pozornost.ts')
  ok('Přehled (pozornost): návrhy čtou výčet SLOUPCE_NAVRHU_POZORNOSTI',
    /from\('transakce'\)\s*\.select\(SLOUPCE_NAVRHU_POZORNOSTI\)/.test(pozornost))
  ok('Přehled (pozornost): protistrana pro návrh = jméno, jinak číslo účtu',
    /const protistrana = protistranaNeboUcet\(t\.protistrana, t\.protiucet\)/.test(pozornost) && !/protistrana: t\.protistrana/.test(pozornost))
}

console.log('\n== Výčty sloupců s protistranou nesou i protiúčet ==')
{
  // Každý výčet, který čte protistranu, musí číst i protiúčet — jinak
  // platba bez jména ukáže prázdno (nález N11/N12 druhé revize kroku 1).
  const { sloupceTransakciExportu } = await import('../lib/ucetni-export.ts')
  const vycty = {
    SLOUPCE_AUTOMATICKEHO_PAROVANI, SLOUPCE_POTVRZENEHO_PAROVANI, SLOUPCE_PRIJMU_PRO_VRACENI, SLOUPCE_NAVRHU_POZORNOSTI,
    'sloupceSeznamuPlateb(firma)': sloupceSeznamuPlateb(false), 'sloupceSeznamuPlateb(pobočka)': sloupceSeznamuPlateb(true),
    'sloupceTransakciExportu(firma)': sloupceTransakciExportu(false), 'sloupceTransakciExportu(pobočka)': sloupceTransakciExportu(true),
  }
  for (const [jmeno, vycet] of Object.entries(vycty)) {
    const sloupce = String(vycet).split(',').map((s) => s.trim())
    ok(`${jmeno}: čte protistranu i protiúčet`, sloupce.includes('protistrana') && sloupce.includes('protiucet'))
  }
  ok('sloupceSeznamuPlateb: na pobočce jen platby účtů pobočky (!inner), za firmu bez', /platebni_ucty!inner\(branch_id\)/.test(sloupceSeznamuPlateb(true)) && !/platebni_ucty/.test(sloupceSeznamuPlateb(false)))
  ok('sloupceTransakciExportu: na pobočce !inner, za firmu jen účet', /platebni_ucty!inner\(branch_id\)/.test(sloupceTransakciExportu(true)) && /platebni_ucty\(branch_id\)/.test(sloupceTransakciExportu(false)))

  // Nikde v appce dotaz, který si protistranu vypisuje sám a protiúčet
  // vynechá (nový dotaz má sáhnout po výčtu výš).
  const { readdirSync, statSync } = await import('node:fs')
  const soubory = []
  const projit = (adresar) => {
    for (const jmeno of readdirSync(adresar)) {
      const cesta = `${adresar}/${jmeno}`
      if (statSync(cesta).isDirectory()) { if (jmeno !== 'node_modules') projit(cesta) } else if (/\.(ts|tsx)$/.test(jmeno)) soubory.push(cesta)
    }
  }
  projit('app'); projit('lib')
  const bezProtiuctu = []
  for (const soubor of soubory) {
    const text = readFileSync(soubor, 'utf8')
    for (const m of text.matchAll(/\.select\(\s*(['"`])([^'"`]*)\1/g)) {
      if (/\bprotistrana\b/.test(m[2]) && !/\bprotiucet\b/.test(m[2])) bezProtiuctu.push(`${soubor}: ${m[2]}`)
    }
  }
  ok(`žádný dotaz v app/ a lib/ nečte protistranu bez protiúčtu${bezProtiuctu.length ? ' — ' + bezProtiuctu.join(' | ') : ''}`, soubory.length > 100 && bezProtiuctu.length === 0)
}

console.log('\n== Dorovnání stavu (jen kandidáti — stav zapíše databáze) ==')
{
  const faktury = [
    { id: 'cela', castkaHaleru: 1000, stav: 'Ke kontrole úhrady' },
    { id: 'cast', castkaHaleru: 1000, stav: 'Ke kontrole úhrady' },
    { id: 'uz', castkaHaleru: 1000, stav: 'Uhrazeno' },
    { id: 'nic', castkaHaleru: 1000, stav: 'Neuhrazeno' },
    { id: 'odmitnuta', castkaHaleru: 1000, stav: 'Odmítnuto' },
    { id: 'neschvalena', castkaHaleru: 1000, stav: 'Ke schválení' },
    { id: 'upominka', castkaHaleru: 1000, stav: 'Upomínka - zkontrolovat' },
    { id: 'preplacena', castkaHaleru: 1000, stav: 'Částečně uhrazeno' },
    { id: 'eur', castkaHaleru: 1000, stav: 'Ke kontrole úhrady', mena: 'EUR' },
    { id: 'eur_cast', castkaHaleru: 1000, stav: 'Neuhrazeno', mena: 'eur' },
  ]
  const alokace = new Map([['cela', 1000], ['cast', 400], ['uz', 1000], ['odmitnuta', 1000], ['neschvalena', 1000], ['upominka', 1000], ['preplacena', 1200], ['eur', 1000], ['eur_cast', 300]])
  const zmeny = dorovnatStavy(faktury, alokace)
  const z = Object.fromEntries(zmeny.map((x) => [x.fakturaId, x.stav]))
  ok('celá částka spárovaná → Uhrazeno', z.cela === 'Uhrazeno')
  ok('část → Částečně uhrazeno', z.cast === 'Částečně uhrazeno')
  ok('přeplacená → Uhrazeno', z.preplacena === 'Uhrazeno')
  ok('už uhrazená, bez párování, odmítnutá, neschválená → beze změny', !('uz' in z) && !('nic' in z) && !('odmitnuta' in z) && !('neschvalena' in z))
  ok('upomínka se nedorovnává (jako app.faktura_stav_podle_plateb)', !('upominka' in z))
  // Párování je vždy v měně faktury (jinou měnu databáze spárovat nepustí) —
  // dorovnání v EUR počítá ve stejných jednotkách jako prepocitat_stav_faktury.
  ok(`faktura v EUR se dorovná v měně faktury (celá → Uhrazeno, část → Částečně) — naměřeno: ${z.eur} / ${z.eur_cast}`,
    z.eur === 'Uhrazeno' && z.eur_cast === 'Částečně uhrazeno')
  ok('změna nese původní stav', zmeny.find((x) => x.fakturaId === 'cela')?.puvodni === 'Ke kontrole úhrady')
}

console.log('\n== Ruční „Uhrazeno": kdy appka tlačítko nabídne ==')
{
  for (const stav of ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']) ok(`ze stavu „${stav}" ručně Uhrazeno smí`, smiOznacitUhrazenou(stav))
  for (const stav of ['Ke schválení', 'Upomínka - zkontrolovat', 'Nutná ruční kontrola (x)', 'Odmítnuto', 'Uhrazeno', null]) ok(`ze stavu „${stav}" ručně Uhrazeno NEsmí`, !smiOznacitUhrazenou(stav))
  ok('menaNeboCzk / jeVKorunach: prázdná = CZK pro součty a návrhy', menaNeboCzk(null) === 'CZK' && menaNeboCzk(' eur ') === 'EUR' && jeVKorunach('') && !jeVKorunach('EUR'))

  // Předvyplněná částka ruční úhrady = zbytek (ne celá částka), u dobropisu kladně.
  ok(`zbývá zaplatit: částečně uhrazená 1000 − 400 → 600 — naměřeno: ${zbyvaZaplatit(1000, 400)}`, zbyvaZaplatit(1000, 400) === 600)
  ok(`zbývá zaplatit: dobropis −500 → kladně 500 — naměřeno: ${zbyvaZaplatit(-500, 0)}`, zbyvaZaplatit(-500, 0) === 500)
  ok(`zbývá zaplatit: přeplacená nikdy záporně — naměřeno: ${zbyvaZaplatit(1000, 1200)}`, zbyvaZaplatit(1000, 1200) === 0)
}

console.log('\n== Fronta návrhů: návrh, který přestal platit, se neukazuje (navrhPlati) ==')
{
  const f = (jine = {}) => ({ stav: 'Ke kontrole úhrady', archivovano: false, duplicita: false, ...jine })
  const t = (jine = {}) => ({ castkaHaleru: 1000, pouzitoHaleru: 0, rucneUhrazen: false, ...jine })
  ok('otevřená faktura, volná platba → platí', navrhPlati(f(), t()))
  ok('faktura zaplacená jinak (Uhrazeno) → neplatí', !navrhPlati(f({ stav: 'Uhrazeno' }), t()))
  ok('faktura odmítnutá → neplatí', !navrhPlati(f({ stav: 'Odmítnuto' }), t()))
  ok('faktura archivovaná → neplatí', !navrhPlati(f({ archivovano: true }), t()))
  ok('faktura označená jako duplicita → neplatí', !navrhPlati(f({ duplicita: true }), t()))
  ok('platbu celou pokrylo jiné párování → neplatí', !navrhPlati(f(), t({ pouzitoHaleru: 1000 })))
  ok('platba z části pokrytá → pořád platí', navrhPlati(f({ stav: 'Částečně uhrazeno' }), t({ pouzitoHaleru: 400 })))
  ok('platba zapsaná u ruční úhrady → neplatí', !navrhPlati(f(), t({ rucneUhrazen: true })))
  ok('faktura nebo platba se nenačetla → neplatí', !navrhPlati(undefined, t()) && !navrhPlati(f(), undefined))
}

/* --- Návrhy párování -------------------------------------------------------- */

console.log('\n== Návrhy párování (navrhyParovani) ==')
{
  const p = (id, castka, jine = {}) => ({ id, vs: '', zbyvaHaleru: castka, protistrana: 'Pekárna Novák s.r.o.', protiucet: '', datum: '2026-10-10', mena: 'CZK', smer: 'vydaj', ...jine })
  const fa = (id, castka, jine = {}) => ({ id, vs: null, castkaHaleru: castka, zbyvaHaleru: Math.abs(castka), dodavatel: 'Pekárna Novák s.r.o.', ucetDodavatele: null, datumVystaveni: '2026-10-01', splatnost: '2026-10-15', mena: 'CZK', stav: 'Ke kontrole úhrady', duplicita: false, archivovana: false, ...jine })
  const jeden = (pp, ff, moznosti) => navrhyParovani(pp, ff, moznosti)

  // Stupně
  {
    const n = jeden([p('t', 1000, { vs: '77', protiucet: UCET })], [fa('f', 1000, { vs: '0077', ucetDodavatele: '19-2000145399/0800' })])
    ok('VS + částka + IBAN → „vs+castka+ucet" 0.95', n.length === 1 && n[0].duvod === 'vs+castka+ucet' && n[0].jistota === 0.95 && n[0].castkaHaleru === 1000)
  }
  {
    const n = jeden([p('t', 1000, { vs: '77', protistrana: 'Někdo úplně jiný' })], [fa('f', 1000, { vs: '77' })])
    ok('VS + částka (bez účtu, jiné jméno) → „vs+castka" 0.9', n.length === 1 && n[0].duvod === 'vs+castka' && n[0].jistota === 0.9)
  }
  {
    const n = jeden([p('t', 1000)], [fa('f', 1000)])
    ok('částka + dodavatel (jméno) + datum v okně → „castka+dodavatel+okno" 0.7', n.length === 1 && n[0].duvod === 'castka+dodavatel+okno' && n[0].jistota === 0.7)
  }
  {
    const n = jeden([p('t', 1000, { protistrana: '', protiucet: UCET })], [fa('f', 1000, { ucetDodavatele: UCET, dodavatel: 'Úplně jiné jméno' })])
    ok('… dodavatel poznaný jen podle IBAN (jméno chybí) → návrh', n.length === 1 && n[0].duvod === 'castka+dodavatel+okno')
  }
  ok('částka + jiný dodavatel → nic', jeden([p('t', 1000, { protistrana: 'Kovošrot Zlín' })], [fa('f', 1000)]).length === 0)
  ok('dodavatel bez stejné částky (a bez VS) → nic', jeden([p('t', 999)], [fa('f', 1000)]).length === 0)

  // Okno: OKNO_NAVRHU_PRED_VYSTAVENIM dní před vystavením až OKNO_NAVRHU_PO_SPLATNOSTI po splatnosti
  const vOkne = (datum) => jeden([p('t', 1000, { datum })], [fa('f', 1000)]).length === 1
  ok(`okno: ${OKNO_NAVRHU_PRED_VYSTAVENIM} dny před vystavením ano, o den dřív ne`, OKNO_NAVRHU_PRED_VYSTAVENIM === 3 && vOkne('2026-09-28') && !vOkne('2026-09-27'))
  ok(`okno: ${OKNO_NAVRHU_PO_SPLATNOSTI} dní po splatnosti ano, o den později ne`, OKNO_NAVRHU_PO_SPLATNOSTI === 30 && vOkne('2026-11-14') && !vOkne('2026-11-15'))
  ok('okno: faktura bez data → jen podle VS, „částka + dodavatel" ne',
    jeden([p('t', 1000)], [fa('f', 1000, { datumVystaveni: null, splatnost: null })]).length === 0)
  ok('okno: bez splatnosti 30 dní po vystavení',
    jeden([p('t', 1000, { datum: '2026-10-31' })], [fa('f', 1000, { splatnost: null })]).length === 1
      && jeden([p('t', 1000, { datum: '2026-11-01' })], [fa('f', 1000, { splatnost: null })]).length === 0)

  // Částka nikdy přes zbytek
  {
    const n = jeden([p('t', 3000, { vs: '5' })], [fa('f', 3000, { vs: '5', zbyvaHaleru: 3000 })])
    ok('částka návrhu = zbytek platby, když sedí se zbytkem faktury', n.length === 1 && n[0].castkaHaleru === 3000)
  }
  ok('zbytek faktury ≠ zbytek platby → VS sám nestačí na „vs+castka"',
    jeden([p('t', 3000, { vs: '5', protistrana: 'X' })], [fa('f', 5000, { vs: '5', zbyvaHaleru: 2000 })]).length === 0)
  ok('platba už celá spárovaná (zbytek 0) → nic', jeden([p('t', 0, { vs: '5' })], [fa('f', 1000, { vs: '5' })]).length === 0)
  ok('faktura už celá zaplacená (zbytek 0) → nic', jeden([p('t', 1000, { vs: '5' })], [fa('f', 1000, { vs: '5', zbyvaHaleru: 0 })]).length === 0)

  // Nejlepší stupeň, stejné nejvýš 3
  {
    const n = jeden([p('t', 1000, { vs: '9' })], [fa('slabsi', 1000), fa('lepsi', 1000, { vs: '9' })])
    ok('víc kandidátů různých stupňů → jen nejlepší stupeň', n.length === 1 && n[0].fakturaId === 'lepsi')
  }
  {
    const ff = ['a', 'b', 'c', 'd', 'e'].map((id, i) => fa(id, 1000, { splatnost: `2026-10-${String(10 + i).padStart(2, '0')}` }))
    const n = jeden([p('t', 1000, { datum: '2026-10-12' })], ff)
    ok(`stejně dobrých víc → nejvýš ${NEJVIC_NAVRHU_NA_POHYB}, nejbližší datem`, NEJVIC_NAVRHU_NA_POHYB === 3 && n.length === 3
      && n.map((x) => x.fakturaId).sort().join() === 'b,c,d')
  }

  // Co se nenavrhuje
  ok('dvojice už v platby_faktury (zamítnutá, navržená, potvrzená) → znovu ne',
    jeden([p('t', 1000)], [fa('f', 1000)], { vyloucene: new Set(['t|f']) }).length === 0)
  ok('stornovaný pohyb → nic', jeden([p('t', 1000, { stornovano: true })], [fa('f', 1000)]).length === 0)
  for (const [popis, jine] of [['archivovaná', { archivovana: true }], ['duplicita', { duplicita: true }], ['Ke schválení', { stav: 'Ke schválení' }],
    ['Uhrazeno', { stav: 'Uhrazeno' }], ['Upomínka', { stav: 'Upomínka - zkontrolovat' }], ['bez částky', { castkaHaleru: 0, zbyvaHaleru: 0 }]]) {
    ok(`faktura ${popis} → nic`, jeden([p('t', 1000, { vs: '1' })], [fa('f', 1000, { vs: '1', ...jine })]).length === 0)
  }
  ok('„Částečně uhrazeno" se zbytkem → návrh na zbytek',
    jeden([p('t', 400, { vs: '1' })], [fa('f', 1000, { vs: '1', stav: 'Částečně uhrazeno', zbyvaHaleru: 400 })]).map((x) => x.castkaHaleru).join() === '400')

  // Směr a dobropis
  ok('příjem k (kladné) faktuře → nic', jeden([p('t', 1000, { vs: '1', smer: 'prijem' })], [fa('f', 1000, { vs: '1' })]).length === 0)
  {
    const n = jeden([p('t', 500, { smer: 'prijem', vs: '42' })], [fa('d', -500, { vs: '42' })])
    ok('vratka k dobropisu (příjem = |dobropis|, stejný VS) → „dobropis+vratka" 0.8', n.length === 1 && n[0].duvod === 'dobropis+vratka' && n[0].jistota === 0.8 && n[0].castkaHaleru === 500)
  }
  ok('výdaj k dobropisu → nic', jeden([p('t', 500, { vs: '42' })], [fa('d', -500, { vs: '42' })]).length === 0)
  ok('vratka jiné částky → nic', jeden([p('t', 400, { smer: 'prijem', vs: '42' })], [fa('d', -500, { vs: '42' })]).length === 0)

  // Jiná měna
  {
    const n = jeden([p('t', 250000, { vs: '31', mena: 'CZK' })], [fa('f', 10000, { vs: '31', mena: 'EUR' })])
    ok('platba v Kč, faktura v EUR, stejný VS a dodavatel → „jina_mena" 0.5 s částkou PLATBY', n.length === 1 && n[0].duvod === 'jina_mena' && n[0].jistota === 0.5 && n[0].castkaHaleru === 250000)
  }
  ok('jiná měna bez VS → nic (částky porovnat nejde)', jeden([p('t', 10000, { mena: 'CZK' })], [fa('f', 10000, { mena: 'EUR' })]).length === 0)
  ok('jiná měna, stejný VS, jiný dodavatel → nic', jeden([p('t', 10000, { vs: '31', protistrana: 'Kovošrot' })], [fa('f', 10000, { vs: '31', mena: 'EUR' })]).length === 0)
  ok('prázdná měna = CZK pro návrh (ne „jiná měna")', jeden([p('t', 1000, { vs: '1', mena: '' })], [fa('f', 1000, { vs: '1', mena: null })]).map((x) => x.duvod).join() === 'vs+castka')
  ok('EUR platba na EUR fakturu → normální stupeň', jeden([p('t', 1000, { vs: '1', mena: 'EUR' })], [fa('f', 1000, { vs: '1', mena: 'eur' })]).map((x) => x.duvod).join() === 'vs+castka')
  // Dobropis v jiné měně se nenavrhuje (potvrdit by šlo jen ruční úhradou
  // s ODCHOZÍ platbou k faktuře) — stejně jako zapsat_navrhy_parovani, otázka 142.
  ok('dobropis v EUR, vratka v Kč se stejným VS a dodavatelem → nic (otázka 142)',
    jeden([p('t', 250000, { vs: '31', smer: 'prijem' })], [fa('d', -10000, { vs: '31', mena: 'EUR' })]).length === 0
      && jeden([p('t', 250000, { vs: '31' })], [fa('d', -10000, { vs: '31', mena: 'EUR' })]).length === 0)

  // Důvody: stejné kódy jako databáze (CHECK platby_faktury_duvod_kod a zapsat_navrhy_parovani)
  const migrace = cist('supabase/migrations/20261120100000_parovani_pravidla.sql')
  const kodyTs = Object.keys(DUVODY_NAVRHU).sort().join()
  const vZapisu = /v_duvod not in \(([^)]*)\)/.exec(migrace)?.[1] ?? ''
  const kodyDb = [...vZapisu.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort().join()
  ok(`kódy důvodů TS = databáze (zapsat_navrhy_parovani) — TS: ${kodyTs} / DB: ${kodyDb}`, kodyTs.length > 0 && kodyTs === kodyDb)
  ok('každý důvod má větu pro lidi', Object.values(DUVODY_NAVRHU).every((v) => typeof v === 'string' && v.length > 15))
}

/* --- Kód volá databázi, ne vlastní zápis stavu ------------------------------ */

console.log('\n== Stav faktury, jisté shody a návrhy jdou přes databázi ==')
{
  const uloha = bezKomentaru(cist('lib/finance-automaticke-parovani.ts'))
  ok('úloha: dorovnání stavu přes rpc prepocitat_stav_faktury, žádný přímý update faktury',
    /rpc\('prepocitat_stav_faktury'/.test(uloha) && !/from\('faktury'\)\s*\.update/.test(uloha))
  ok('úloha: žádné duveryhodneDavky (dávku posuzuje databáze)', !/duveryhodneDavky/.test(uloha))
  ok('úloha: faktury čte i s účtem dodavatele (IBAN)', /ucet_dodavatele/.test(uloha) && /ucetDodavatele: f\.ucet_dodavatele/.test(uloha))

  const importAkce = bezKomentaru(cist('app/[rozsah]/finance/platby/import/akce.ts'))
  ok('import výpisu: jisté shody přes rpc sparovat_jiste_z_davky pod přihlášeným (supabase z akce)',
    /supabase\.rpc\('sparovat_jiste_z_davky', \{ p_tenant: tenantId, p_davka: davkaId \}\)/.test(importAkce))
  ok('import výpisu: bez automatickyParovatPlatby a bez vlastní kontroly faktury.manage',
    !/automatickyParovatPlatby/.test(importAkce) && !/faktury\.manage/.test(importAkce))
  ok('import výpisu: potom hledá návrhy', /najitNavrhyParovani\(tenantId/.test(importAkce))

  const banka = bezKomentaru(cist('app/api/uloha/banka-synchronizace/route.ts'))
  ok('synchronizace banky: po automatice hledá návrhy (najitNavrhyParovani)',
    banka.indexOf('automatickyParovatPlatby(tenantId') > 0 && banka.indexOf('najitNavrhyParovani(tenantId') > banka.indexOf('automatickyParovatPlatby(tenantId'))

  const navrhy = bezKomentaru(cist('lib/finance-navrhy-parovani.ts'))
  ok('hledání návrhů: zápis jen rpc zapsat_navrhy_parovani, žádný přímý insert',
    /rpc\('zapsat_navrhy_parovani'/.test(navrhy) && !/\.insert\(/.test(navrhy))
  ok('hledání návrhů: vynechá dvojice z platby_faktury, ruční úhrady a Jiné platby',
    /navrhyParovani\(pohyby, faktury, \{ vyloucene \}\)/.test(navrhy) && /from\('faktury_rucni_uhrady'\)/.test(navrhy) && /from\('jine_platby'\)/.test(navrhy))
  ok('hledání návrhů: do Faktur přes bránu úlohy', /pristupKFakturamUlohy\(tenantId\)/.test(navrhy) && /fakturyFirmy\(pristup,/.test(navrhy))
  ok('hledání návrhů: všechny pohyby (bez okna dní) po stránkách od nejnovějších, ne „přeskočit celý běh"',
    !/DNI_ZPET|gte\('datum'/.test(navrhy)
      && /\.or\(`datum\.lt\.\$\{kurzor\.datum\},and\(datum\.eq\.\$\{kurzor\.datum\},id\.lt\.\$\{kurzor\.id\}\)`\)/.test(navrhy)
      && /\.order\('datum', \{ ascending: false \}\)\.order\('id', \{ ascending: false \}\)/.test(navrhy))
  ok('hledání návrhů: souvislosti (párování, ruční úhrady, Jiné platby, storna) jen ke stránce pohybů',
    /from\('platby_faktury'\)[^;]*\.in\('transakce_id', kus\)/.test(navrhy)
      && /from\('faktury_rucni_uhrady'\)\.select\('transakce_id'\)[^;]*\.in\('transakce_id', kus\)/.test(navrhy)
      && /from\('jine_platby'\)[^;]*\.in\('uhrada_transakce_id', kus\)/.test(navrhy))
  ok('hledání návrhů: když dojde čas, vrátí nedokončeno (ne tiché „hotovo")',
    /if \(Date\.now\(\) >= konecMs\) return \{ stav: 'ok', navrzeno, nedokonceno: true, duvod: null \}/.test(navrhy))
  ok('hledání návrhů: kurzor do filtru jen ve tvaru data a uuid',
    /if \(!DATUM\.test\(posledni\.datum\) \|\| !UUID\.test\(posledni\.id\)\) throw/.test(navrhy))

  const fakturyAkce = bezKomentaru(cist('app/[rozsah]/finance/faktury/akce.ts'))
  ok('Faktury: ručně „Uhrazeno" = rpc rucne_uhradit_fakturu s částkou a důvodem',
    /rpc\('rucne_uhradit_fakturu', \{[^}]*p_castka_haleru: castkaHaleru, p_duvod: duvod/.test(fakturyAkce))
  ok('Faktury: zrušení ruční úhrady = rpc zrusit_rucni_uhradu s id úhrady a důvodem, za celou firmu',
    /export async function zrusitRucniUhradu[\s\S]*?pripravit\(TENANT_SCOPE_SEGMENT, 'faktury\.manage'\)[\s\S]*?if \(duvod\.length < 5\) chyba\([\s\S]*?rpc\('zrusit_rucni_uhradu', \{\s*p_tenant: p\.tenantId, p_uhrada: uhradaId, p_duvod: duvod,/.test(fakturyAkce))
  ok('Faktury: započtení dobropisu = rpc zapocitat_dobropis s částkou a důvodem, za celou firmu',
    /export async function zapocitatDobropis[\s\S]*?pripravit\(TENANT_SCOPE_SEGMENT, 'faktury\.manage'\)[\s\S]*?rpc\('zapocitat_dobropis', \{\s*p_tenant: p\.tenantId, p_dobropis: dobropisId, p_faktura: fakturaId, p_castka_haleru: castkaHaleru, p_duvod: duvod,/.test(fakturyAkce))
  {
    const seznam = cist('app/[rozsah]/finance/faktury/seznam/page.tsx')
    ok('Faktury → seznam: ruční úhrada předvyplní zbytek (zbyvaZaplatit), ne celou částku',
      /defaultValue=\{doPole\(zbyvaZaplatit\(f\.castka_haleru, uhrazeno\.get\(f\.id\) \?\? 0\)\)\}/.test(seznam) && !/f\.castka_haleru \/ 100\)\.toFixed/.test(seznam))
    ok('Faktury → seznam: zrušení ruční úhrady a započtení dobropisu jsou v nabídce řádku',
      /<form key=\{u\.id\} action=\{zrusitRucniUhradu\}/.test(seznam) && /<form action=\{zapocitatDobropis\}/.test(seznam))
  }
  ok('Faktury: „Vrátit mezi neuhrazené" = rpc vratit_fakturu_mezi_neuhrazene, bez služby',
    /rpc\('vratit_fakturu_mezi_neuhrazene'/.test(fakturyAkce) && !/klientUlohy/.test(fakturyAkce))
  ok('Faktury: nikde přímý zápis stavu „Uhrazeno"', !/update\(\{\s*stav:\s*STAV_UHRAZENO/.test(fakturyAkce) && !/update\(\{\s*stav:\s*'Uhrazeno'/.test(fakturyAkce))
  ok('Faktury: vyřazení souvisejících faktur nesahá na zaplacené',
    /\.not\('stav', 'in', `\("\$\{STAV_UHRAZENO\}","\$\{STAV_CASTECNE\}"\)`\)/.test(fakturyAkce))
  ok('Faktury: upomínka jen z fronty ke schválení',
    /update\(\{ stav: 'Upomínka - zkontrolovat', poznamka_kontroly: null, archivovano: false \}\)\s*\.eq\('tenant_id', p\.tenantId\)\.eq\('id', id\)\.eq\('stav', STAV_KE_SCHVALENI\)/.test(fakturyAkce))
  const { STAVY_RUCNIHO_ZADANI } = await import('../lib/faktury-types.ts')
  ok('Faktury → Nová: ručně zadat nejde „Uhrazeno" ani „Částečně uhrazeno"',
    !STAVY_RUCNIHO_ZADANI.includes('Uhrazeno') && !STAVY_RUCNIHO_ZADANI.includes('Částečně uhrazeno') && STAVY_RUCNIHO_ZADANI.length >= 1)

  const platbyAkce = bezKomentaru(cist('app/[rozsah]/finance/platby/akce.ts'))
  {
    // Databáze důvod zrušení párování nevyžaduje (zrusit_parovani_faktury
    // ho jen zapíše) — hlídá ho jen tahle akce.
    const zacatek = platbyAkce.indexOf('export async function zrusitAlokaci(')
    const zruseni = zacatek < 0 ? '' : platbyAkce.slice(zacatek, platbyAkce.indexOf('\nexport ', zacatek + 10) >>> 0)
    const kontrola = zruseni.indexOf('if (!duvod) {\n    redirect(')
    ok('Platby: zrušení párování bez důvodu odmítne dřív, než zavolá databázi, a důvod jí pošle',
      /const duvod = duvodZFormulare\(formData\)/.test(zruseni) && kontrola > 0
        && kontrola < zruseni.indexOf("rpc('zrusit_parovani_faktury'") && /p_duvod: duvod,/.test(zruseni))
    ok('Platby: důvod z formuláře aspoň 5 znaků (po oříznutí mezer)',
      /function duvodZFormulare\(formData: FormData\): string \| null \{\s*const duvod = String\(formData\.get\('duvod'\) \?\? ''\)\.trim\(\)\.slice\(0, 300\)\s*return duvod\.length >= 5 \? duvod : null/.test(platbyAkce))
  }
  ok('Platby: potvrzení a odmítnutí návrhu jen podle id návrhu',
    /rpc\('potvrdit_navrh_parovani', \{ p_tenant: tenantId, p_navrh: navrhId \}\)/.test(platbyAkce)
      && /rpc\('odmitnout_navrh_parovani', \{ p_tenant: tenantId, p_navrh: navrhId \}\)/.test(platbyAkce))
  {
    // „Najít návrhy" spouští hledání službou — až když databáze pod
    // přihlášeným řekne, že smí potvrzovat párování.
    const zacatek = platbyAkce.indexOf('export async function najitNavrhyTed(')
    const telo = zacatek < 0 ? '' : platbyAkce.slice(zacatek, platbyAkce.indexOf('\nexport ', zacatek + 10) >>> 0)
    const smi = telo.indexOf("supabase.rpc('smi_potvrdit_parovani', { p_tenant: tenantId })")
    const odmitnuti = telo.indexOf('if (error || smi !== true) {\n    redirect(')
    const hledani = telo.indexOf('najitNavrhyParovani(tenantId')
    ok('Platby: „Najít návrhy" — firemní finance.manage, pak smi_potvrdit_parovani pod přihlášeným, odmítnutí, a teprve pak hledání',
      /pripravitFiremni\(rozsah, 'finance\.manage', PAROVANI_JEN_FIRMA\)/.test(telo) && smi > 0 && odmitnuti > smi && hledani > odmitnuti)
  }
  ok('Platby: návrh v jiné měně → ruční úhrada s platbou a fakturou Z NÁVRHU',
    /p_faktura: n\.faktura, p_castka_haleru: castkaHaleru, p_duvod: duvod, p_transakce: n\.transakce_id/.test(platbyAkce))

  const strankaPlateb = cist('app/[rozsah]/finance/platby/page.tsx')
  ok('Platby: návrhy se nepočítají při načtení — odkaz na frontu', /finance\/platby\/navrhy`/.test(strankaPlateb) && !/navrhnoutParovani|kandidatiProNavrhy/.test(strankaPlateb))
  const pozornost = cist('lib/finance-pozornost.ts')
  ok('Přehled: návrhy z uložené fronty (platby_faktury navrzeno), odkaz na frontu',
    /from\('platby_faktury'\)\s*\.select\('transakce_id, faktura'\)\s*\.eq\('tenant_id', tenantId\)\.eq\('stav', 'navrzeno'\)/.test(pozornost)
      && /finance\/platby\/navrhy`/.test(pozornost) && !/navrhnoutParovani/.test(pozornost))
}

console.log('\n== Zkouška 11: migrace kroku 2 nesahá omezeními na existující sloupce ==')
{
  // Scénář krok112 v databázi pozná jen omezení nad NOVÝMI sloupci
  // (stav_pred_uhradou, duvod) — kdo existující sloupec zúží, ví o něm
  // jen text migrace. Povolené: CHECK nad novým sloupcem duvod a částečný
  // unikátní index návrhů (výslovně v zadání, ROZHODNOUT v migraci);
  // cokoli dalšího jen NOT VALID.
  const sql = cist('supabase/migrations/20261120100000_parovani_pravidla.sql').replace(/--.*$/gm, '')
  const TABULKY = '(faktury|transakce|platby_faktury|kontakty)'
  const prikazy = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim())
  const omezeni = prikazy.filter((p) => new RegExp(`^alter table (only )?(if exists )?public\\.${TABULKY} `, 'i').test(p)
    && /(add constraint|set not null|add (unique|primary key|check)|add column \S+ [^,]*\b(not null|unique)\b)/i.test(p))
  const indexy = prikazy.filter((p) => new RegExp(`^create unique index .* on (only )?public\\.${TABULKY} `, 'i').test(p))
  const navic = [
    ...omezeni.filter((p) => !/add constraint platby_faktury_duvod_kod check \(duvod is null or duvod in /i.test(p) && !/ not valid$/i.test(p)),
    ...indexy.filter((p) => p !== "create unique index platby_faktury_navrh_jednou on public.platby_faktury (transakce_id, faktura) where stav = 'navrzeno'"),
  ]
  ok(`zkouška 11: migrace nepřidává CHECK, NOT NULL ani unikátní index nad existujícími sloupci — navíc: ${navic.length ? navic.join(' | ') : 'nic'}`,
    omezeni.length >= 1 && indexy.length >= 1 && navic.length === 0)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
