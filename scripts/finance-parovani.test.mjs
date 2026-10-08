#!/usr/bin/env node
/**
 * Párování transakcí s fakturami — lib/finance-parovani.ts.
 *
 * Pusť `node --experimental-strip-types scripts/finance-parovani.test.mjs`.
 *
 * Nejcennější kontrola tady není „dokonalá shoda dá vysokou jistotu" —
 * to je samozřejmost. Je to že SLABÁ shoda (jen částka, jen podobné
 * jméno) jistotu přes práh NEDOSTANE — jinak by appka náhodnou shodu
 * nabídla jako jistou a někdo by klikl potvrdit bez přečtení.
 */

const { jistotaShody, navrhnoutParovani, PRAH_NAVRHU, vybratAutomatickaParovani, dorovnatStavy, smiOznacitUhrazenou, stavPoVraceni, protistranaSedi, normalizovatVs, jeVracena } = await import('../lib/finance-parovani.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const TRANSAKCE = {
  id: 't1',
  vs: '20260001',
  castkaHaleru: 500000,
  protistrana: 'ABC Velkoobchod s.r.o.',
  datum: '2026-10-05',
}

console.log('\n== Dokonalá shoda ==')

ok('VS + částka + jméno + datum: jistota je 1 (plný strop)',
  jistotaShody(TRANSAKCE, { id: 'f1', vs: '20260001', castkaHaleru: 500000, dodavatel: 'ABC Velkoobchod s.r.o.', datum: '2026-10-05' }) === 1)

console.log('\n== VS + částka bez shody jména/data NEDOSÁHNE prahu ==')

const jenVsACastka = jistotaShody(TRANSAKCE, { id: 'f2', vs: '20260001', castkaHaleru: 500000, dodavatel: 'Úplně jiná firma', datum: '2026-01-01' })
ok('VS+částka samy o sobě (0.8) jsou pod prahem 0.9', jenVsACastka < PRAH_NAVRHU)
ok('ale nejsou nulové — je to částečná shoda', jenVsACastka >= 0.8)

console.log('\n== Jen částka (náhodná shoda čísla) musí zůstat hluboko pod prahem ==')

const jenCastka = jistotaShody(TRANSAKCE, { id: 'f3', vs: '99999999', castkaHaleru: 500000, dodavatel: 'Úplně Jiná Entita', datum: '2020-01-01' })
ok('jen shodná částka: jistota je nízká (slabá shoda)', jenCastka <= 0.35)
ok('a rozhodně pod prahem návrhu', jenCastka < PRAH_NAVRHU)

console.log('\n== Jen podobné jméno (bez VS, bez částky) zůstává nízko ==')

const jenJmeno = jistotaShody(TRANSAKCE, { id: 'f4', vs: '11112222', castkaHaleru: 123456, dodavatel: 'ABC Velkoobchod s.r.o.', datum: '2020-05-05' })
ok('jen podobnost jména: jistota je nízká', jenJmeno <= 0.25)

console.log('\n== VS se nesmí shodovat na prefix/postfix, jen přesně ==')

ok('„20260001" vs „120260001" (navíc číslice) se NESHODUJE — jen částka (0.3), žádný bonus za VS',
  jistotaShody(TRANSAKCE, { id: 'f5', vs: '120260001', castkaHaleru: 500000, dodavatel: null, datum: null }) === 0.3)

console.log('\n== Blízkost data: klesá s odstupem, ne skokem ==')

const blizko = jistotaShody(TRANSAKCE, { id: 'f6', vs: null, castkaHaleru: 1, dodavatel: null, datum: '2026-10-06' })
const daleko = jistotaShody(TRANSAKCE, { id: 'f7', vs: null, castkaHaleru: 1, dodavatel: null, datum: '2026-12-06' })
ok('den po transakci je blíž než o dva měsíce později', blizko > daleko)
ok('víc než 30 dní odstupu dá nulový příspěvek data', daleko === 0)

console.log('\n== Chybějící údaje na straně faktury (null) nespadnou, jen nepřidají body ==')

ok('faktura bez VS, bez dodavatele, bez data: žádná chyba, nízká jistota',
  jistotaShody(TRANSAKCE, { id: 'f8', vs: null, castkaHaleru: 500000, dodavatel: null, datum: null }) === 0.3)

console.log('\n== navrhnoutParovani: vybere nejlepší kandidáta, nic pod prahem ==')

const kandidati = [
  { id: 'slaba', vs: '00000000', castkaHaleru: 1, dodavatel: null, datum: null },
  { id: 'silna', vs: '20260001', castkaHaleru: 500000, dodavatel: 'ABC Velkoobchod s.r.o.', datum: '2026-10-05' },
  { id: 'stredni', vs: '20260001', castkaHaleru: 500000, dodavatel: 'Jiná firma', datum: '2020-01-01' },
]

const navrh = navrhnoutParovani(TRANSAKCE, kandidati)
ok('vybere tu nejsilnější fakturu, ne první v pořadí', navrh?.fakturaId === 'silna')
ok('jistota návrhu je nad prahem', (navrh?.jistota ?? 0) >= PRAH_NAVRHU)

const samaSlaba = navrhnoutParovani(TRANSAKCE, [kandidati[0]])
ok('když je k dispozici jen slabý kandidát, vrátí se null (žádný návrh), ne vynucená shoda', samaSlaba === null)

const prazdnySeznam = navrhnoutParovani(TRANSAKCE, [])
ok('prázdný seznam faktur dá null, ne spadne', prazdnySeznam === null)

console.log('\n== Automatické párování: jen jednoznačná shoda ==')
{
  const t = (id, vs, castka, datum = '2026-10-05', jine = {}) => ({ id, vs, castkaHaleru: castka, protistrana: 'ABC Velkoobchod', datum, alokovanoHaleru: 0, zdroj: 'fio_api', mena: 'CZK', smer: 'vydaj', davkaId: null, ...jine })
  const f = (id, vs, castka, stav = 'Ke kontrole úhrady', datum = '2026-09-20', jine = {}) => ({ id, vs, castkaHaleru: castka, dodavatel: 'ABC Velkoobchod s.r.o.', datum, stav, alokovanoHaleru: 0, duplicita: false, archivovana: false, mena: 'CZK', ...jine })
  const auto = (tt, ff, moznosti) => vybratAutomatickaParovani(tt, ff, moznosti)

  const jasne = auto([t('t1', '2026001', 500000)], [f('f1', '2026001', 500000), f('f2', '2026002', 500000)])
  ok('stejný VS + přesná částka, jediný kandidát → spáruje se sám', jasne.length === 1 && jasne[0].transakceId === 't1' && jasne[0].fakturaId === 'f1' && jasne[0].castkaHaleru === 500000 && jasne[0].castkaFakturyHaleru === 500000)

  ok('jiná částka (i o haléř) → nic', auto([t('t1', '2026001', 499999)], [f('f1', '2026001', 500000)]).length === 0)
  ok('jen částka bez VS → nic (to je jen návrh)', auto([t('t1', '', 500000)], [f('f1', '', 500000)]).length === 0)
  ok('jiný VS → nic', auto([t('t1', '2026009', 500000)], [f('f1', '2026001', 500000)]).length === 0)
  ok('VS s nulami navíc („0012345" proti „12345") se sám nespáruje', auto([t('t1', '12345', 100)], [f('f1', '0012345', 100)]).length === 0)

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
  ok('platba z agregátoru → smí', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'bankovni_agregator' })], [f('f1', '1', 100)]).length === 1)
  ok('výpis CSV bez důvěryhodné dávky → nic (CSV si může napsat kdokoli)', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd1' })], [f('f1', '1', 100)]).length === 0)
  ok('výpis CSV z dávky, kterou nahrál správce Faktur → smí', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd1' })], [f('f1', '1', 100)], { duveryhodneDavky: new Set(['d1']) }).length === 1)
  ok('… ale jen ta dávka', auto([t('t1', '1', 100, '2026-10-05', { zdroj: 'csv_banka', davkaId: 'd2' })], [f('f1', '1', 100)], { duveryhodneDavky: new Set(['d1']) }).length === 0)

  ok('faktura v EUR, platba v CZK (stejné číslo) → nic', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: 'EUR' })]).length === 0)
  ok('platba i faktura v EUR → nic (automaticky jen Kč)', auto([t('t1', '1', 100, '2026-10-05', { mena: 'EUR' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: 'EUR' })]).length === 0)
  ok('měna faktury neuvedená = CZK', auto([t('t1', '1', 100)], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { mena: null })]).length === 1)
  ok('úplně jiná protistrana než dodavatel → nic', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'Kovošrot Zlín' })], [f('f1', '1', 100)]).length === 0)
  ok('jiná firma se stejnou právní formou („s.r.o.") → nic (kolo 2)', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'Novák Stavby s.r.o.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'Alza.cz s.r.o.' })]).length === 0)
  ok('… ani „a.s." / „spol. s r.o."', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'ALZA.CZ A.S.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'ČEZ Prodej, a.s.' })]).length === 0 &&
    auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'Kovo Brno spol. s r.o.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'Pekárna Praha spol. s r.o.' })]).length === 0)
  ok('stejná firma jinak zapsaná (MAKRO … CR s.r.o. / Makro … ČR) → smí', auto([t('t1', '1', 100, '2026-10-05', { protistrana: 'MAKRO Cash & Carry CR s.r.o.' })], [f('f1', '1', 100, 'Ke kontrole úhrady', '2026-09-20', { dodavatel: 'Makro Cash & Carry ČR' })]).length === 1)
  ok('protistrana z banky prázdná → rozhoduje zbytek', auto([t('t1', '1', 100, '2026-10-05', { protistrana: '' })], [f('f1', '1', 100)]).length === 1)

  ok('banka platbu vrátila (příjem, stejný VS a částka, za 2 dny) → nic (kolo 2)',
    auto([t('t1', '1', 100, '2026-10-05'), t('vraceni', '1', 100, '2026-10-07', { smer: 'prijem' })], [f('f1', '1', 100)]).length === 0)
  ok('… i bez VS, když příjem přišel od stejné protistrany',
    auto([t('t1', '1', 100, '2026-10-05'), t('vraceni', '', 100, '2026-10-07', { smer: 'prijem', protistrana: 'ABC VELKOOBCHOD' })], [f('f1', '1', 100)]).length === 0)
  ok('jiný příjem (jiná částka) platbu neblokuje',
    auto([t('t1', '1', 100, '2026-10-05'), t('trzba', '1', 999, '2026-10-07', { smer: 'prijem' })], [f('f1', '1', 100)]).length === 1)

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

console.log('\n== Dorovnání stavu ve Fakturách podle párování ==')
{
  const faktury = [
    { id: 'cela', castkaHaleru: 1000, stav: 'Ke kontrole úhrady' },
    { id: 'cast', castkaHaleru: 1000, stav: 'Ke kontrole úhrady' },
    { id: 'uz', castkaHaleru: 1000, stav: 'Uhrazeno' },
    { id: 'nic', castkaHaleru: 1000, stav: 'Neuhrazeno' },
    { id: 'odmitnuta', castkaHaleru: 1000, stav: 'Odmítnuto' },
    { id: 'neschvalena', castkaHaleru: 1000, stav: 'Ke schválení' },
    { id: 'preplacena', castkaHaleru: 1000, stav: 'Částečně uhrazeno' },
    { id: 'eur', castkaHaleru: 1000, stav: 'Ke kontrole úhrady', mena: 'EUR' },
  ]
  const alokace = new Map([['cela', 1000], ['cast', 400], ['uz', 1000], ['odmitnuta', 1000], ['neschvalena', 1000], ['preplacena', 1200], ['eur', 1000]])
  const zmeny = dorovnatStavy(faktury, alokace)
  const z = Object.fromEntries(zmeny.map((x) => [x.fakturaId, x.stav]))
  ok('celá částka spárovaná → Uhrazeno', z.cela === 'Uhrazeno')
  ok('část → Částečně uhrazeno', z.cast === 'Částečně uhrazeno')
  ok('přeplacená → Uhrazeno', z.preplacena === 'Uhrazeno')
  ok('už uhrazená, bez párování, odmítnutá, neschválená → beze změny', !('uz' in z) && !('nic' in z) && !('odmitnuta' in z) && !('neschvalena' in z))
  ok('faktura v cizí měně se nedorovnává (párování je v haléřích)', !('eur' in z))
  ok('změna nese původní stav (zápis jen podmíněně)', zmeny.find((x) => x.fakturaId === 'cela')?.puvodni === 'Ke kontrole úhrady')
}

console.log('\n== Ruční „Uhrazeno" a zpět ==')
{
  for (const stav of ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']) ok(`ze stavu „${stav}" ručně Uhrazeno smí`, smiOznacitUhrazenou(stav))
  for (const stav of ['Ke schválení', 'Upomínka - zkontrolovat', 'Nutná ruční kontrola (x)', 'Odmítnuto', 'Uhrazeno', null]) ok(`ze stavu „${stav}" ručně Uhrazeno NEsmí`, !smiOznacitUhrazenou(stav))
  ok('vrátit bez plateb → Ke kontrole úhrady', stavPoVraceni(0, 1000) === 'Ke kontrole úhrady')
  ok('vrátit, když je část zaplacená z výpisu → Částečně uhrazeno', stavPoVraceni(400, 1000) === 'Částečně uhrazeno')
  ok('vrátit, když je podle plateb zaplacená celá → nejde (null)', stavPoVraceni(1000, 1000) === null && stavPoVraceni(1500, 1000) === null)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
