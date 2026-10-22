#!/usr/bin/env node
/**
 * Jiné platby — čisté knihovny agendy, bez sítě a databáze.
 *
 *   lib/jine-platby-castky.ts     text z dokladu → haléře a množství, přesné násobení
 *   lib/jine-platby-kontrola.ts   kontrola rozpoznaného dokladu a ručního návrhu
 *   lib/jine-platby-mapovani.ts   přiřazení ke katalogu pokladny, převod jednotek
 *   lib/jine-platby-stav.ts       popisky, kroky průvodce, dostupné akce
 *   lib/jine-platby-duplicity.ts  možné duplicity (otisk, účet, den + částka)
 *   lib/jine-platby-faktura.ts    podklady pro fakturu a co chybí
 *   lib/jine-platby-db.ts         převod do tvaru databáze a zpět
 *
 * A statická kontrola: výčty v lib/jine-platby-typy.ts = CHECK v migraci
 * 20261016100000_jine_platby.sql. Dokud migrace neexistuje, blok se
 * vypíše jako PŘESKOČENO a nepočítá se ani jako úspěch, ani jako chyba.
 *
 * Provoz pokladny (souběh, timeout, obnova) je zvlášť:
 * scripts/jine-platby-pos-operace.test.mjs.
 *
 * Pusť `node scripts/jine-platby.test.mjs`.
 */

import { existsSync, readFileSync } from 'node:fs'

const C = await import('../lib/jine-platby-castky.ts')
const K = await import('../lib/jine-platby-kontrola.ts')
const M = await import('../lib/jine-platby-mapovani.ts')
const S = await import('../lib/jine-platby-stav.ts')
const D = await import('../lib/jine-platby-duplicity.ts')
const F = await import('../lib/jine-platby-faktura.ts')
const T = await import('../lib/jine-platby-typy.ts')
// Dvě cesty jdou přepsat proměnnou prostředí — JEN kvůli schválnému rozbití
// cizích souborů v kopii (lib/jine-platby-db.ts a migrace nejsou naše, do
// originálu se nesahá). Bez proměnných se čtou skutečné soubory.
const DB = await import(process.env.JP_TEST_DB ? new URL(`file:///${process.env.JP_TEST_DB.replace(/\\/g, '/')}`).href : '../lib/jine-platby-db.ts')
const O = await import('../lib/jine-platby-pos-operace.ts')
/**
 * Text migrace pro zrcadlové kontroly (20. 10.). `JP_TEST_MIGRACE` = kopie
 * pro schválné rozbití — do originálu (patří integrátorovi) se nesahá.
 * Prázdný text, když migrace není (kontroly pak spadnou na „podařilo se najít").
 */
const MIGRACE_CESTA = process.env.JP_TEST_MIGRACE ?? new URL('../supabase/migrations/20261016100000_jine_platby.sql', import.meta.url)
// Opravná migrace 20261021100000 (ověření 21. 10.) předefinuje část funkcí — zrcadla čtou POSLEDNÍ definici.
const MIGRACE_OPRAVA_CESTA = process.env.JP_TEST_MIGRACE_OPRAVA ?? new URL('../supabase/migrations/20261021100000_jine_platby_pojistky_pokladny.sql', import.meta.url)
const cist = (c) => (existsSync(c) ? readFileSync(c, 'utf8').replace(/\r\n/g, '\n') : '')
const textOpravy = () => cist(MIGRACE_OPRAVA_CESTA)
const textMigrace = () => cist(MIGRACE_CESTA) + '\n' + textOpravy()
/** Tělo POSLEDNÍ definice funkce (create function / create or replace function). */
const teloFunkce = (sql, jmeno) => {
  const od = Math.max(sql.lastIndexOf(`create function ${jmeno}(`), sql.lastIndexOf(`create or replace function ${jmeno}(`))
  return od >= 0 ? sql.slice(od, sql.indexOf('end $$;', od)) : ''
}

let chyb = 0
let proslo = 0
let preskoceno = 0
const ok = (popis, podminka) => {
  if (podminka) proslo++
  else chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const hodi = (fn) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
const castka = (v) => C.prevestCastku(v)
const haleru = (v) => {
  const r = C.prevestCastku(v)
  return r.stav === 'ok' ? r.haleru : r.stav
}
const mnoz = (v) => {
  const r = C.prevestMnozstvi(v)
  return r.stav === 'ok' ? r.mnozstvi : r.stav
}
const NBSP = '\u00a0'

/* ================================================================== */
console.log('\n== Částky: text z dokladu → haléře ==')
{
  ok('„1 234,50" → 123450', haleru('1 234,50') === 123450)
  ok('„1234.50" → 123450', haleru('1234.50') === 123450)
  ok('„45,-" → 4500 (celé koruny)', haleru('45,-') === 4500)
  ok('„45,–" s pomlčkou → 4500', haleru('45,\u2013') === 4500)
  ok('„45 Kč" → 4500', haleru('45 Kč') === 4500)
  ok('„−12,00" s matematickým mínusem → −1200 (záporné povolené)', haleru('\u221212,00') === -1200)
  ok('„-12,00" → −1200', haleru('-12,00') === -1200)
  ok('„1.234,50" (tečka tisíce, čárka desetiny) → 123450', haleru('1.234,50') === 123450)
  ok('„1,234.50" (čárka tisíce, tečka desetiny) → 123450', haleru('1,234.50') === 123450)
  ok('nezlomitelné mezery „1 234,50 Kč" → 123450', haleru(`1${NBSP}234,50${NBSP}Kč`) === 123450)
  ok('„CZK 99" → 9900', haleru('CZK 99') === 9900)
  ok('„12,50 EUR" → 1250', haleru('12,50 EUR') === 1250)
  ok('„€3.20" → 320', haleru('€3.20') === 320)
  ok('„Kč -12,00" → −1200', haleru('Kč -12,00') === -1200)
  ok('„12,5" → 1250 (jedno desetinné místo)', haleru('12,5') === 1250)
  ok('„1.234.567" (oddělovač víckrát = tisíce) → 123456700', haleru('1.234.567') === 123456700)
  {
    const r = castka('1.234')
    ok('„1.234" → nejasne (tisíc i 1,234), s důvodem', r.stav === 'nejasne' && r.duvod.includes('1 234') && r.duvod.includes('1,234'))
  }
  // Důvod se kontroluje taky: „nejasne" by vyšlo i z pravidla „víc než dvě
  // desetinná místa" — člověk ale potřebuje slyšet, že jde o tisíce, ne o haléře.
  ok('„1,234" → nejasne s výkladem tisíce/desetiny', ((r) => r.stav === 'nejasne' && r.duvod.includes('(tisíce)'))(castka('1,234')))
  ok('„12,345" → nejasne s výkladem tisíce/desetiny', ((r) => r.stav === 'nejasne' && r.duvod.includes('12 345'))(castka('12,345')))
  ok('„0,123" → nejasne (tři desetinná místa)', castka('0,123').stav === 'nejasne')
  ok('„1 234,567" → nejasne', castka('1 234,567').stav === 'nejasne')
  ok('„12 34" (mezery ne po třech) → nejasne', castka('12 34').stav === 'nejasne')
  ok('„1.2.3,4" (tisíce ne po třech) → nejasne', castka('1.2.3,4').stav === 'nejasne')
  ok('„abc" → nejasne', castka('abc').stav === 'nejasne')
  ok('„Kč" bez čísla → nejasne', castka('Kč').stav === 'nejasne')
  ok('„" → prazdne', castka('').stav === 'prazdne')
  ok('mezery → prazdne', castka('   ').stav === 'prazdne')
  ok('null → prazdne', castka(null).stav === 'prazdne')
  ok('undefined → prazdne', castka(undefined).stav === 'prazdne')
  ok('strop „21 474 836,47" → 2147483647', haleru('21 474 836,47') === 2147483647)
  ok('nad strop „21 474 836,48" → nejasne', castka('21 474 836,48').stav === 'nejasne')
  ok('„-0,00" → 0, ne −0', Object.is(haleru('-0,00'), 0))
  ok('číslo 12.5 → 1250', haleru(12.5) === 1250)
  ok('číslo 1.1 → 110 (plovoucí chyba 110.00000000000001 spravená)', haleru(1.1) === 110)
  ok('číslo 0.29 → 29 (0.29*100 = 28.999999999999996)', haleru(0.29) === 29)
  ok('číslo 1.005 → nejasne (tři desetinná místa)', castka(1.005).stav === 'nejasne')
  ok('NaN → nejasne', castka(NaN).stav === 'nejasne')
  ok('Infinity → nejasne', castka(Infinity).stav === 'nejasne')
  ok('číslo nad strop → nejasne', castka(21474836.48).stav === 'nejasne')
  ok('číslo −0 → 0', Object.is(haleru(-0), 0))
  // Tečka za značkou měny jen na konci: „€.50" spolknutím tečky dávalo 50 €.
  {
    const r = castka('€.50')
    ok(`„€.50" → nejasne, ne 50 € ani 0,50 € (${JSON.stringify(r)})`, r.stav === 'nejasne' && r.duvod.includes('za značkou měny'))
  }
  ok('„EUR.50" → nejasne', castka('EUR.50').stav === 'nejasne')
  ok('„Kč,50" → nejasne', castka('Kč,50').stav === 'nejasne')
  ok('„12 Kč." (tečka na konci) → 1200', haleru('12 Kč.') === 1200)
  ok('„euro 12" → 1200 (dřív zbylo „o 12")', haleru('euro 12') === 1200)
  ok('„Kč 12 EUR" (dvě různé měny) → nejasne', ((r) => r.stav === 'nejasne' && r.duvod.includes('dvě různé měny'))(castka('Kč 12 EUR')))
  const mena = (v) => ((r) => (r.stav === 'ok' ? r.menaVTextu : r.stav))(castka(v))
  ok('měna z textu: „45 Kč" → CZK', mena('45 Kč') === 'CZK')
  ok('měna z textu: „CZK 99" → CZK, „99 kc" → CZK', mena('CZK 99') === 'CZK' && mena('99 kc') === 'CZK')
  ok('měna z textu: „€3.20" → EUR, „12,50 EUR" → EUR, „12 euro" → EUR', mena('€3.20') === 'EUR' && mena('12,50 EUR') === 'EUR' && mena('12 euro') === 'EUR')
  ok('měna z textu: bez značky → null', mena('1 234,50') === null && mena('45,-') === null)
  ok('měna z textu: číslo na vstupu → null', mena(12.5) === null)
  ok('měna z textu: „Kč -12,00" → CZK i se znaménkem', mena('Kč -12,00') === 'CZK' && haleru('Kč -12,00') === -1200)
  {
    const dlouhy = castka('x'.repeat(5000))
    ok('dlouhý cizí text se do důvodu dostane zkrácený (strop duvod_kontroly 1000)', dlouhy.stav === 'nejasne' && dlouhy.duvod.length < 120)
  }
}

console.log('\n== Množství ==')
{
  ok('„2" → "2"', mnoz('2') === '2')
  ok('„2x" → "2"', mnoz('2x') === '2')
  ok('„2 ×" → "2"', mnoz('2 ×') === '2')
  ok('„2 ks" → "2"', mnoz('2 ks') === '2')
  ok('„0,5" → "0.5"', mnoz('0,5') === '0.5')
  ok('„1.250" → "1.25" (u množství desetinné, ne tisíce)', mnoz('1.250') === '1.25')
  ok('„1,250" → "1.25"', mnoz('1,250') === '1.25')
  ok('„0,500" → "0.5" (bez koncových nul)', mnoz('0,500') === '0.5')
  ok('„½" → nejasne (zlomek)', mnoz('½') === 'nejasne')
  ok('„1/2" → nejasne (zlomek)', mnoz('1/2') === 'nejasne')
  ok('„1,2345" → nejasne (víc než 3 desetinná místa)', mnoz('1,2345') === 'nejasne')
  ok('„0" → nejasne (nula je podezřelá)', mnoz('0') === 'nejasne')
  ok('„-1" → nejasne (záporné)', mnoz('-1') === 'nejasne')
  ok('„999999999" → povolené maximum', mnoz('999999999') === '999999999')
  ok('„1000000000" → nejasne (numeric(12,3))', mnoz('1000000000') === 'nejasne')
  ok('„999999999,5" → nejasne (nad 999 999 999)', mnoz('999999999,5') === 'nejasne')
  ok('„0,5 l" → nejasne (jednotka patří do vlastního políčka)', mnoz('0,5 l') === 'nejasne')
  ok('číslo 0.5 → "0.5"', mnoz(0.5) === '0.5')
  ok('číslo 0 → nejasne', mnoz(0) === 'nejasne')
  ok('null → prazdne', mnoz(null) === 'prazdne')
  ok('„" → prazdne', mnoz('') === 'prazdne')
}

console.log('\n== Násobení, porovnání a zobrazení bez plovoucí čárky ==')
{
  ok('0,333 kg × 199,00 = 66,267 → 6627 (půlka nahoru)', C.vynasobit('0.333', 19900) === 6627)
  ok('2 × 45,00 = 9000', C.vynasobit('2', 4500) === 9000)
  ok('0,5 × 0,01 Kč = 0,5 hal → 1 (od nuly)', C.vynasobit('0.5', 1) === 1)
  ok('0,5 × −0,01 Kč → −1 (od nuly, ne k nule)', C.vynasobit('0.5', -1) === -1)
  ok('1,005 × 1,00 Kč = 100,5 hal → 101 (plovoucí čárka dá 100)', C.vynasobit('1.005', 100) === 101)
  ok('0,575 × 1,00 Kč = 57,5 hal → 58 (plovoucí čárka dá 57)', C.vynasobit('0.575', 100) === 58)
  {
    const presne = Number((BigInt(123456789) * BigInt(98765) + BigInt(500)) / BigInt(1000))
    ok('123 456,789 × 987,65 Kč přesně jako BigInt', C.vynasobit('123456.789', 98765) === presne)
  }
  ok('výsledek mimo přesná čísla → RangeError (ne tichá nepřesnost)', hodi(() => C.vynasobit('999999999', 2147483647)))
  ok('množství „1,5" (čárka) → RangeError', hodi(() => C.vynasobit('1,5', 100)))
  ok('necelá cena → RangeError', hodi(() => C.vynasobit('1', 1.5)))
  ok('porovnat „0.5" a „0.50" → 0', C.porovnatMnozstvi('0.5', '0.50') === 0)
  ok('porovnat „1" a „0.999" → 1', C.porovnatMnozstvi('1', '0.999') === 1)
  ok('porovnat „2" a „10" → −1 (číselně, ne jako text)', C.porovnatMnozstvi('2', '10') === -1)
  ok('porovnat neplatné → RangeError', hodi(() => C.porovnatMnozstvi('abc', '1')))

  const cs = (h) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(h / 100)
  ok('formatHaleru(123450, CZK) = „1 234,50 Kč" s nezlomitelnými mezerami', C.formatHaleru(123450, 'CZK') === `1${NBSP}234,50${NBSP}Kč`)
  ok('formatHaleru jako cs-CZ (0; 5; −123 450; 1 000 000 000)', [0, 5, -123450, 100000000000].every((h) => C.formatHaleru(h, 'CZK') === cs(h)))
  ok('formatHaleru(1200, EUR) = „12,00 EUR"', C.formatHaleru(1200, 'EUR') === `12,00${NBSP}EUR`)
  ok('formatHaleru bez měny → „(měna neuvedena)", žádné domýšlení Kč', C.formatHaleru(123450, null) === `1${NBSP}234,50${NBSP}(měna neuvedena)`)
  ok('haleruNaText(123450) = „1234,50"', C.haleruNaText(123450) === '1234,50')
  ok('haleruNaText(−5) = „-0,05"', C.haleruNaText(-5) === '-0,05')
  ok('haleruNaText(null) = ""', C.haleruNaText(null) === '')
  ok('políčko → text → haléře vrátí totéž (0, 5, 99, 123450, −1200, strop)', [0, 5, 99, 123450, -1200, 2147483647].every((h) => haleru(C.haleruNaText(h)) === h))
}

/* ================================================================== */
const DNES = { dnes: '2026-10-16' }
const radekAi = (o = {}) => ({
  nazev: 'Pivo 0,5 l',
  mnozstvi: '2',
  jednotka: null,
  cenaJednotkova: '45,00',
  cenaCelkem: '90,00',
  sazbaDph: '21 %',
  druhNavrh: 'rozlevany_napoj',
  jistota: 0.95,
  poznamka: null,
  ...o,
})
const SVICKOVA = { nazev: 'Svíčková na smetaně', mnozstvi: '1', cenaJednotkova: '189,00', cenaCelkem: '189,00', sazbaDph: '12', druhNavrh: 'pokrm' }
const doklad = (o = {}) => ({
  polozky: [radekAi(), radekAi(SVICKOVA)],
  celkem: '279,00 Kč',
  kUhrade: null,
  zaplaceno: null,
  prijatoHotove: null,
  vraceno: null,
  zbyva: null,
  sleva: null,
  spropitne: null,
  mena: 'Kč',
  datum: '2026-10-15',
  externiId: ' Účet 1234 ',
  typDokladu: 'uzavreny_prodej',
  textDokladu: '',
  jistota: 0.95,
  upozorneni: [],
  ...o,
})
const kontrola = (o) => K.zkontrolovatDoklad(doklad(o), DNES)
const maDuvod = (k, cast) => k.duvody.some((d) => d.includes(cast))

console.log('\n== Kontrola dokladu: celková částka z účtenky ==')
{
  const k = kontrola()
  ok('celkem z účtenky → castkaHaleru 27900, původ „doklad"', k.hlavicka.castkaHaleru === 27900 && k.hlavicka.castkaPuvod === 'doklad')
  ok('měna „Kč" → CZK', k.hlavicka.mena === 'CZK')
  ok('datum převzato, označení prázdné, kontakt null', k.hlavicka.datumProdeje === '2026-10-15' && k.hlavicka.oznaceni === '' && k.hlavicka.kontaktId === null)
  ok('externí účet ořezaný', k.hlavicka.externiUcet === 'Účet 1234')
  ok('typ dokladu z AI', k.hlavicka.typDokladu === 'uzavreny_prodej')
  ok('součet položek 27900, bez nesouladu a bez návrhu celku', k.soucetPolozekHaleru === 27900 && k.nesoulad === null && k.navrhCelkem === null)
  ok('čistý doklad: žádné důvody, nic ke kontrole', k.duvody.length === 0 && !k.vyzadujeKontrolu)
  const [pivo] = k.polozky
  ok('položka: zdroj ai, nenamapováno, bez produktu pokladny', pivo.zdroj === 'ai' && pivo.mapovani === 'nenamapovano' && pivo.posProduktId === null && pivo.posProduktNazev === null && pivo.posMnozstvi === null)
  ok('položka: množství "2", ceny v haléřích, DPH "21"', pivo.mnozstvi === '2' && pivo.cenaJednotkovaHaleru === 4500 && pivo.cenaCelkemHaleru === 9000 && pivo.sazbaDph === '21')
  ok('položka bez problému je bez příznaku', !pivo.vyzadujeKontrolu && pivo.duvodKontroly === '')
  ok('castky: celkem 27900, ostatní null', k.castky.celkem === 27900 && k.castky.kUhrade === null && k.castky.prijatoHotove === null)
}

console.log('\n== Kontrola dokladu: celkem / K úhradě / zaplaceno / zbývá / vráceno ==')
{
  const zaloha = kontrola({ polozky: [radekAi({ nazev: 'Raut', mnozstvi: '1', cenaJednotkova: '1 000,00', cenaCelkem: '1 000,00', druhNavrh: 'pokrm' })], celkem: '1 000,00', kUhrade: '1 000,00', zaplaceno: '300,00', zbyva: '700,00' })
  ok('zaplaceno 300 + zbývá 700 = K úhradě 1000 → bez důvodu „nedává"', !maDuvod(zaloha, 'nedává'))
  ok('zbývá doplatit → důvod (prodej není celý zaplacený)', maDuvod(zaloha, 'Zbývá doplatit'))
  ok('do tržby jde celková cena 100000, ne zaplaceno ani zbývá', zaloha.hlavicka.castkaHaleru === 100000)

  const spatne = kontrola({ polozky: [radekAi({ nazev: 'Raut', mnozstvi: '1', cenaJednotkova: '1 000,00', cenaCelkem: '1 000,00', druhNavrh: 'pokrm' })], celkem: '1 000,00', kUhrade: '1 000,00', zaplaceno: '300,00', zbyva: '600,00' })
  ok('zaplaceno 300 + zbývá 600 ≠ 1000 → důvod', maDuvod(spatne, 'nedává'))

  const castecne = kontrola({ celkem: '279,00', kUhrade: '279,00', zaplaceno: '100,00' })
  ok('zaplaceno méně než K úhradě bez „zbývá" → důvod částečná platba', maDuvod(castecne, 'částečná platba'))

  const jinaKUhrade = kontrola({ kUhrade: '379,00' })
  ok('K úhradě ≠ celkem (bez vysvětlení) → důvod', maDuvod(jinaKUhrade, 'se liší od celkové ceny'))
  ok('… a tržba zůstává celková cena 27900', jinaKUhrade.hlavicka.castkaHaleru === 27900)

  const tip = kontrola({ kUhrade: '329,00', spropitne: '50,00' })
  ok('K úhradě = celkem + spropitné z dokladu → bez důvodu „liší"', !maDuvod(tip, 'se liší'))
  ok('… a spropitné se do tržby nepřičte (27900)', tip.hlavicka.castkaHaleru === 27900)

  const zaokr = kontrola({ kUhrade: '279,40' })
  ok('K úhradě ± 40 hal (zaokrouhlení hotovosti) → bez důvodu', !maDuvod(zaokr, 'se liší'))

  const jenKUhrade = kontrola({ celkem: null, kUhrade: '329,00' })
  ok('celkem chybí, K úhradě je → castka null (K úhradě NENÍ cena prodeje)', jenKUhrade.hlavicka.castkaHaleru === null && jenKUhrade.hlavicka.castkaPuvod === null)
  ok('… návrh celku ze součtu položek 27900, ne z K úhradě', jenKUhrade.navrhCelkem?.haleru === 27900 && jenKUhrade.navrhCelkem?.puvod === 'vypocet')
  ok('… důvod „jen K úhradě" a „chybí celková cena"', maDuvod(jenKUhrade, 'jen „K úhradě"') && maDuvod(jenKUhrade, 'chybí'))

  const hotove = kontrola({ kUhrade: '279,00', prijatoHotove: '500,00', vraceno: '221,00' })
  ok('vráceno 221 = přijato 500 − K úhradě 279 → bez důvodu', !maDuvod(hotove, 'Vráceno'))
  ok('přijatá hotovost do tržby nejde (castka 27900, ne 50000)', hotove.hlavicka.castkaHaleru === 27900 && hotove.castky.prijatoHotove === 50000)
  const hotoveSpatne = kontrola({ kUhrade: '279,00', prijatoHotove: '500,00', vraceno: '200,00' })
  ok('vráceno 200 ≠ 221 → důvod', maDuvod(hotoveSpatne, 'Vráceno'))
  const hotoveZaokr = kontrola({ kUhrade: '279,40', prijatoHotove: '500,00', vraceno: '221,00' })
  ok('vráceno po zaokrouhlení hotovosti (220,60 → 221) → bez důvodu', !maDuvod(hotoveZaokr, 'Vráceno'))

  const jenHotovost = kontrola({ celkem: null, prijatoHotove: '500,00', polozky: [radekAi({ cenaJednotkova: null, cenaCelkem: null })] })
  ok('jen přijatá hotovost, položky bez cen → žádná částka ani návrh (hotovost není tržba)', jenHotovost.hlavicka.castkaHaleru === null && jenHotovost.navrhCelkem === null)
}

console.log('\n== Kontrola dokladu: součet položek proti celku (sleva, zaokrouhlení, spropitné) ==')
{
  const nes = kontrola({ celkem: '300,00' })
  ok('celkem 300 proti součtu 279 → nesoulad +2100', nes.nesoulad?.rozdilHaleru === 2100)
  ok('… popis nesouladu je v důvodech, doklad ke kontrole', nes.nesoulad !== null && nes.duvody.includes(nes.nesoulad.popis) && nes.vyzadujeKontrolu)

  const slevaSouhrn = kontrola({ celkem: '250,00', sleva: '29,00' })
  ok('sleva jen v souhrnu: 279 − 29 = 250 → bez nesouladu', slevaSouhrn.nesoulad === null)
  const slevaSouhrnMinus = kontrola({ celkem: '250,00', sleva: '-29,00' })
  ok('sleva v souhrnu se znaménkem mínus → totéž (castky.sleva kladně 2900)', slevaSouhrnMinus.nesoulad === null && slevaSouhrnMinus.castky.sleva === 2900)
  const slevaZapomenuta = kontrola({ celkem: '279,00', sleva: '29,00' })
  ok('sleva v souhrnu, celkem bez ní (279 proti 279 − 29) → nesoulad +2900', slevaZapomenuta.nesoulad?.rozdilHaleru === 2900)

  const slevaRadek = radekAi({ nazev: 'Sleva 10 %', mnozstvi: null, cenaJednotkova: null, cenaCelkem: '-29,00', sazbaDph: null, druhNavrh: 'sleva' })
  const sRadkem = kontrola({ polozky: [radekAi(), radekAi(SVICKOVA), slevaRadek], celkem: '250,00', sleva: '29,00' })
  ok('sleva jako řádek I v souhrnu → neodečte se dvakrát (bez nesouladu)', sRadkem.nesoulad === null && sRadkem.soucetPolozekHaleru === 25000)
  ok('slevový řádek bez množství není ke kontrole a je neskladový', !sRadkem.polozky[2].vyzadujeKontrolu && sRadkem.polozky[2].mapovani === 'neskladova')

  const kladnaSleva = kontrola({ polozky: [radekAi(), radekAi(SVICKOVA), { ...slevaRadek, cenaCelkem: '29,00' }], celkem: '250,00' })
  ok('sleva přečtená kladně → otočeno na −2900 s důvodem', kladnaSleva.polozky[2].cenaCelkemHaleru === -2900 && kladnaSleva.polozky[2].duvodKontroly.includes('znaménko otočeno'))
  ok('… a součet s otočenou slevou sedí (250)', kladnaSleva.nesoulad === null)

  const zaokr = (celkem, mena = 'Kč') => kontrola({ polozky: [radekAi(), radekAi({ ...SVICKOVA, cenaJednotkova: '188,60', cenaCelkem: '188,60' })], celkem, mena })
  ok('součet 278,60, celkem 279,00 (+40 hal) → zaokrouhlení, ne nesoulad', zaokr('279,00').nesoulad === null)
  ok('součet 278,60, celkem 278,10 (−50 hal, hranice) → ne nesoulad', zaokr('278,10').nesoulad === null)
  ok('součet 278,60, celkem 279,11 (+51 hal) → nesoulad', zaokr('279,11').nesoulad?.rozdilHaleru === 51)
  ok('v EUR se nezaokrouhluje: +40 centů → nesoulad', zaokr('279,00', 'EUR').nesoulad?.rozdilHaleru === 40)

  const tipRadek = radekAi({ nazev: 'Spropitné', mnozstvi: null, cenaJednotkova: null, cenaCelkem: '50,00', sazbaDph: null, druhNavrh: 'spropitne' })
  const sTipem = kontrola({ polozky: [radekAi(), radekAi(SVICKOVA), tipRadek], celkem: '279,00' })
  ok('spropitné jako řádek se do součtu prodeje nepočítá (27900, bez nesouladu)', sTipem.soucetPolozekHaleru === 27900 && sTipem.nesoulad === null)
  ok('spropitné je neskladové a bez množství v pořádku', sTipem.polozky[2].mapovani === 'neskladova' && !sTipem.polozky[2].vyzadujeKontrolu)
  const tipVCelku = kontrola({ polozky: [radekAi(), radekAi(SVICKOVA), tipRadek], celkem: '329,00' })
  ok('celkem omylem se spropitným → nesoulad s vysvětlením „odpovídá spropitnému"', tipVCelku.nesoulad?.rozdilHaleru === 5000 && tipVCelku.nesoulad.popis.includes('odpovídá spropitnému'))

  const bezCelku = kontrola({ celkem: null })
  ok('celkem chybí → návrh 27900 jako „vypocet", hlavička null', bezCelku.navrhCelkem?.haleru === 27900 && bezCelku.hlavicka.castkaHaleru === null)
  const bezCelkuSleva = kontrola({ celkem: null, sleva: '29,00' })
  ok('celkem chybí, sleva v souhrnu → návrh 25000', bezCelkuSleva.navrhCelkem?.haleru === 25000)
  const zapornyCelek = kontrola({ celkem: '-279,00' })
  ok('záporné celkem → null s důvodem', zapornyCelek.hlavicka.castkaHaleru === null && maDuvod(zapornyCelek, 'záporná'))
  const nulovyCelek = kontrola({ celkem: '0,00' })
  ok('celkem 0 → null s důvodem (nula je podezřelá)', nulovyCelek.hlavicka.castkaHaleru === null && maDuvod(nulovyCelek, 'jako 0'))
  const nejasnyCelek = kontrola({ celkem: '1.234' })
  ok('celkem „1.234" → null s důvodem nejednoznačnosti', nejasnyCelek.hlavicka.castkaHaleru === null && maDuvod(nejasnyCelek, 'jednoznačně'))
}

console.log('\n== Kontrola dokladu: řádky bez cen nebo množství, nuly, jistota ==')
{
  const k = kontrola({
    polozky: [
      radekAi({ nazev: 'Pivo', mnozstvi: null }),
      radekAi({ nazev: 'Kofola', mnozstvi: '3', cenaJednotkova: '39,00', cenaCelkem: null, druhNavrh: 'kusove_zbozi' }),
      radekAi({ nazev: 'Hranolky', cenaJednotkova: null, cenaCelkem: null, druhNavrh: 'pokrm' }),
    ],
    celkem: null,
  })
  const [bezMnozstvi, kofola, bezCeny] = k.polozky
  ok('řádek bez množství → null + „Chybí množství" (nedomýšlí se z ceny)', bezMnozstvi.mnozstvi === null && bezMnozstvi.vyzadujeKontrolu && bezMnozstvi.duvodKontroly.includes('Chybí množství'))
  ok('řádek s množstvím a jednotkovou cenou bez ceny celkem → bez příznaku, cena celkem nedopsaná', !kofola.vyzadujeKontrolu && kofola.cenaCelkemHaleru === null)
  ok('řádek bez cen → „Chybí cena"', bezCeny.vyzadujeKontrolu && bezCeny.duvodKontroly.includes('Chybí cena'))
  ok('součet s řádkem bez ceny → null, žádný návrh celku', k.soucetPolozekHaleru === null && k.navrhCelkem === null)
  ok('doklad ke kontrole', k.vyzadujeKontrolu)

  const dopocet = kontrola({ polozky: [radekAi({ nazev: 'Kofola', mnozstvi: '3', cenaJednotkova: '39,00', cenaCelkem: null, druhNavrh: 'kusove_zbozi' })], celkem: '117,00' })
  ok('součet dopočte 3 × 39 = 117 a sedí s celkem', dopocet.soucetPolozekHaleru === 11700 && dopocet.nesoulad === null)

  const nuly = kontrola({ polozky: [radekAi({ cenaCelkem: '0,00', cenaJednotkova: '0' }), radekAi({ mnozstvi: '0' })] })
  ok('cena 0 → null + důvod „přečtená jako 0"', nuly.polozky[0].cenaCelkemHaleru === null && nuly.polozky[0].cenaJednotkovaHaleru === null && nuly.polozky[0].duvodKontroly.includes('přečtená jako 0'))
  ok('množství 0 → null + důvod', nuly.polozky[1].mnozstvi === null && nuly.polozky[1].duvodKontroly.includes('jako 0'))

  const nesedi = kontrola({ polozky: [radekAi({ mnozstvi: '2', cenaJednotkova: '45,00', cenaCelkem: '95,00' })], celkem: '95,00' })
  ok('2 × 45 ≠ 95 → důvod „nesedí s cenou celkem"', nesedi.polozky[0].duvodKontroly.includes('nesedí s cenou celkem'))
  const zaokrJednotky = kontrola({ polozky: [radekAi({ mnozstvi: '3', cenaJednotkova: '33,33', cenaCelkem: '100,00' })], celkem: '100,00' })
  ok('3 × 33,33 = 99,99 proti 100,00 (zaokrouhlená jednotková cena) → v pořádku', !zaokrJednotky.polozky[0].vyzadujeKontrolu)

  const jistota = kontrola({ polozky: [radekAi({ jistota: 0.69 }), radekAi({ jistota: 0.7 }), radekAi({ jistota: NaN })], celkem: '270,00' })
  ok('jistota řádku 0,69 → ke kontrole', jistota.polozky[0].vyzadujeKontrolu && jistota.polozky[0].duvodKontroly.includes('Nejistě'))
  ok('jistota řádku 0,70 → v pořádku (hranice)', !jistota.polozky[1].vyzadujeKontrolu)
  ok('jistota řádku neplatná → ke kontrole', jistota.polozky[2].vyzadujeKontrolu)

  const dokladNejisty = kontrola({ jistota: 0.79 })
  ok('jistota dokladu 0,79 → ke kontrole s důvodem', dokladNejisty.vyzadujeKontrolu && maDuvod(dokladNejisty, 'nejistě'))
  ok('jistota dokladu 0,80 → v pořádku', !kontrola({ jistota: 0.8 }).vyzadujeKontrolu)

  const dph = kontrola({ polozky: [radekAi({ sazbaDph: 'A' }), radekAi({ sazbaDph: null }), radekAi({ sazbaDph: '12,0 %' })], celkem: '270,00' })
  ok('DPH „A" nečitelná → null + důvod (nedomýšlí se 21 %)', dph.polozky[0].sazbaDph === null && dph.polozky[0].duvodKontroly.includes('DPH'))
  ok('DPH chybí → null bez domýšlení', dph.polozky[1].sazbaDph === null)
  ok('DPH „12,0 %" → "12"', dph.polozky[2].sazbaDph === '12')

  const druh = kontrola({ polozky: [radekAi({ druhNavrh: 'cosi' })] })
  ok('neznámý druh z AI → nezarazeno + ke kontrole', druh.polozky[0].druh === 'nezarazeno' && druh.polozky[0].duvodKontroly.includes('Druh'))
  const zaporna = kontrola({ polozky: [radekAi({ cenaCelkem: '-90,00', cenaJednotkova: '-45,00' })] })
  ok('záporná cena u položky, která není sleva → ke kontrole', zaporna.polozky[0].duvodKontroly.includes('Záporná cena'))
  const prazdny = kontrola({ polozky: [] })
  ok('doklad bez položek → důvod', maDuvod(prazdny, 'žádné položky') && prazdny.soucetPolozekHaleru === null)
  const mimoRozsah = kontrola({ polozky: [radekAi({ mnozstvi: '999999', cenaJednotkova: '9 999 999,00', cenaCelkem: null })] })
  ok('množství × cena přes strop databáze → důvod, ne pád', mimoRozsah.polozky[0].duvodKontroly.includes('mimo rozsah'))
}

console.log('\n== Kontrola dokladu: měna, datum, typ, upozornění ==')
{
  ok('„€" → EUR', kontrola({ mena: '€' }).hlavicka.mena === 'EUR')
  ok('„eur" → EUR', kontrola({ mena: 'eur' }).hlavicka.mena === 'EUR')
  ok('„CZK" → CZK', kontrola({ mena: 'CZK' }).hlavicka.mena === 'CZK')
  ok('„usd" → USD', kontrola({ mena: 'usd' }).hlavicka.mena === 'USD')
  const bez = kontrola({ mena: null })
  ok('měna neuvedená → null (nikdy CZK) + „Chybí měna"', bez.hlavicka.mena === null && maDuvod(bez, 'Chybí měna') && bez.vyzadujeKontrolu)
  const dolar = kontrola({ mena: '$' })
  ok('„$" → null + důvod (dolar čí?)', dolar.hlavicka.mena === null && maDuvod(dolar, 'Chybí měna'))

  const budouci = kontrola({ datum: '2026-10-17' })
  ok('datum v budoucnosti → null + důvod', budouci.hlavicka.datumProdeje === null && maDuvod(budouci, 'budoucnosti'))
  ok('dnešní datum projde', kontrola({ datum: '2026-10-16' }).hlavicka.datumProdeje === '2026-10-16')
  const neplatne = kontrola({ datum: '2026-02-30' })
  ok('neexistující den 30. 2. → null + důvod', neplatne.hlavicka.datumProdeje === null && maDuvod(neplatne, 'není platné'))
  ok('přestupný 29. 2. 2024 projde', kontrola({ datum: '2024-02-29' }).hlavicka.datumProdeje === '2024-02-29')
  ok('29. 2. 2026 (nepřestupný) → null', kontrola({ datum: '2026-02-29' }).hlavicka.datumProdeje === null)
  ok('datum jiným formátem „15.10.2026" → null', kontrola({ datum: '15.10.2026' }).hlavicka.datumProdeje === null)
  const bezData = kontrola({ datum: null })
  ok('datum chybí → null + důvod', bezData.hlavicka.datumProdeje === null && maDuvod(bezData, 'Chybí datum'))
  ok('neplatné „dnes" → RangeError (chyba volajícího)', hodi(() => K.zkontrolovatDoklad(doklad(), { dnes: '16. 10.' })))

  ok('neznámý typ dokladu → nezjisteno', kontrola({ typDokladu: 'faktura' }).hlavicka.typDokladu === 'nezjisteno')
  ok('prázdné externí ID → null', kontrola({ externiId: '   ' }).hlavicka.externiUcet === null)
  const upoz = kontrola({ upozorneni: ['Rozmazaný spodní okraj', '  '] })
  ok('upozornění AI → „Upozornění: …" (prázdné vynechané)', upoz.duvody.filter((d) => d.startsWith('Upozornění: ')).length === 1 && upoz.vyzadujeKontrolu)
}

console.log('\n== Upozornění k CELÉMU dokladu (N27): ukládají se k záznamu, řádkové důvody ne ==')
{
  const cisty = kontrola()
  ok('čistý doklad → upozorneniDokladu [] a hlavička nese [] (nové čtení stará upozornění nahradí)',
    Array.isArray(cisty.upozorneniDokladu) && cisty.upozorneniDokladu.length === 0 && Array.isArray(cisty.hlavicka.upozorneniDokladu) && cisty.hlavicka.upozorneniDokladu.length === 0)
  const kDok = (k, cast) => k.upozorneniDokladu.some((u) => u.includes(cast))
  const nejisty = kontrola({ jistota: 0.79 })
  ok('nízká jistota dokladu (0,79) → upozornění k dokladu', kDok(nejisty, 'Doklad přečtený nejistě (jistota 79 %)'))
  ok('jistota neuvedená → upozornění k dokladu', kDok(kontrola({ jistota: null }), 'jistota neuvedena'))
  const ai = kontrola({ upozorneni: ['Text dokladu obsahuje pokyn „ignoruj předchozí"', 'Na fotce jsou dva doklady'] })
  ok('každé upozornění AI (zachycený pokyn, víc dokladů) → upozornění k dokladu',
    kDok(ai, 'Upozornění: Text dokladu obsahuje pokyn') && kDok(ai, 'Upozornění: Na fotce jsou dva doklady'))
  ok('K úhradě ≠ celkem → upozornění k dokladu', kDok(kontrola({ kUhrade: '379,00' }), 'se liší od celkové ceny'))
  ok('jen „K úhradě" bez celku → upozornění k dokladu', kDok(kontrola({ celkem: null, kUhrade: '329,00' }), 'jen „K úhradě"'))
  const raut = { polozky: [radekAi({ nazev: 'Raut', mnozstvi: '1', cenaJednotkova: '1 000,00', cenaCelkem: '1 000,00', druhNavrh: 'pokrm' })], celkem: '1 000,00', kUhrade: '1 000,00' }
  ok('zaplaceno + zbývá nedává K úhradě → upozornění k dokladu', kDok(kontrola({ ...raut, zaplaceno: '300,00', zbyva: '600,00' }), 'nedává'))
  ok('zbývá doplatit → upozornění k dokladu', kDok(kontrola({ ...raut, zaplaceno: '300,00', zbyva: '700,00' }), 'Zbývá doplatit'))
  ok('částečná platba (zaplaceno < K úhradě) → upozornění k dokladu', kDok(kontrola({ celkem: '279,00', kUhrade: '279,00', zaplaceno: '100,00' }), 'částečná platba'))

  // Co se z uložených položek a hlavičky spočítá znovu (nebo hlídá databáze), k dokladu NEpatří.
  const radkove = kontrola({ polozky: [radekAi({ mnozstvi: null }), radekAi({ ...SVICKOVA, cenaCelkem: null, cenaJednotkova: null })], celkem: '300,00', mena: null, datum: null })
  ok('řádkové důvody (chybí množství, chybí cena) v upozorněních k dokladu NEJSOU (zůstávají na řádcích)',
    radkove.polozky.some((p) => p.vyzadujeKontrolu) && !kDok(radkove, 'množství') && !kDok(radkove, 'Chybí cena'))
  ok('chybějící měna a datum taky ne (hlavička je ukáže sama)', maDuvod(radkove, 'Chybí měna') && maDuvod(radkove, 'Chybí datum') && !kDok(radkove, 'Chybí měna') && !kDok(radkove, 'Chybí datum'))
  const nesoulad = kontrola({ celkem: '300,00' })
  ok('nesoulad součtu položek s celkem taky ne (hlídá ho databáze při označení)', nesoulad.nesoulad !== null && nesoulad.upozorneniDokladu.length === 0)
  ok('upozornění k dokladu jsou i v duvody (jedna sada pro obrazovku)', ai.upozorneniDokladu.every((u) => ai.duvody.includes(u)))
  ok('hlavička nese přesně tatáž upozornění', JSON.stringify(ai.hlavicka.upozorneniDokladu) === JSON.stringify(ai.upozorneniDokladu))

  // Strop databáze (jine_platby_ulozit_navrh: limit 20, left(…, 300)) — appka ho drží sama, nic se tiše neztratí.
  ok('strop: 20 upozornění po 300 znacích', K.MAX_UPOZORNENI_DOKLADU === 20 && K.MAX_DELKA_UPOZORNENI_DOKLADU === 300)
  const zaplava = kontrola({ upozorneni: Array.from({ length: 25 }, (_, i) => `Upozornění modelu č. ${i + 1}`) })
  ok('25 upozornění AI → 20 položek, poslední je souhrn „A další upozornění (6)"',
    zaplava.upozorneniDokladu.length === 20 && zaplava.upozorneniDokladu[18].endsWith('č. 19') && /^A další upozornění \(6\)/.test(zaplava.upozorneniDokladu[19]))
  const dlouhe = kontrola({ upozorneni: ['x'.repeat(400)] })
  ok('upozornění delší než 300 znaků → zkrácené na 300 i s výpustkou', dlouhe.upozorneniDokladu[0].length === 300 && dlouhe.upozorneniDokladu[0].endsWith('…'))
  ok('stejné upozornění dvakrát → jednou', kontrola({ upozorneni: ['Rozmazané', 'Rozmazané'] }).upozorneniDokladu.length === 1)
  const migrace = existsSync(new URL('../supabase/migrations/20261016100000_jine_platby.sql', import.meta.url))
    ? readFileSync(new URL('../supabase/migrations/20261016100000_jine_platby.sql', import.meta.url), 'utf8')
    : ''
  ok('strop sedí s migrací (jine_platby_ulozit_navrh: left(btrim(…), 300) … limit 20)',
    new RegExp(`left\\(btrim\\(e #>> '\\{\\}'\\), ${K.MAX_DELKA_UPOZORNENI_DOKLADU}\\)`).test(migrace) && new RegExp(`btrim\\(e #>> '\\{\\}'\\) <> '' limit ${K.MAX_UPOZORNENI_DOKLADU}\\)`).test(migrace))
}

console.log('\n== Čas tisku → provozní den (N31) ==')
{
  ok('normalizovatCas: „1:30" → „01:30", „06:00:00" → „06:00", „23:59:59.5" → „23:59"',
    K.normalizovatCas('1:30') === '01:30' && K.normalizovatCas('06:00:00') === '06:00' && K.normalizovatCas(' 23:59:59.5 ') === '23:59')
  ok('normalizovatCas: „24:00", „12:60", „1230", „půl druhé", null → null',
    [K.normalizovatCas('24:00'), K.normalizovatCas('12:60'), K.normalizovatCas('1230'), K.normalizovatCas('půl druhé'), K.normalizovatCas(null)].every((v) => v === null))
  const kc = (o, denZacina = '06:00') => K.zkontrolovatDoklad(doklad(o), { ...DNES, denZacina })
  const noc = kc({ datum: '2026-10-16', cas: '01:30' })
  ok('účet z 1:30 (den začíná v 6:00) → datum o den zpět, 15. 10.', noc.hlavicka.datumProdeje === '2026-10-15')
  ok('… a upozornění k dokladu s časem a provozním dnem',
    noc.upozorneniDokladu.includes('Účet vytištěný v 01:30 patří do provozního dne 15. 10. 2026 — datum posunuto, zkontrolujte') && noc.vyzadujeKontrolu)
  ok('5:59 → posun, 6:00 (začátek dne) → bez posunu', kc({ datum: '2026-10-15', cas: '05:59' }).hlavicka.datumProdeje === '2026-10-14' && kc({ datum: '2026-10-15', cas: '06:00' }).hlavicka.datumProdeje === '2026-10-15')
  const vecer = kc({ datum: '2026-10-15', cas: '22:15' })
  ok('večerní účet (22:15) → beze změny, bez upozornění', vecer.hlavicka.datumProdeje === '2026-10-15' && vecer.upozorneniDokladu.length === 0)
  // C10 (kontrola 20. 10.): bez času tisku se datum nedomýšlí, ale neprojde potichu — upozornění k dokladu.
  const VETA_BEZ_CASU = 'Datum z dokladu je kalendářní den tisku — ověřte provozní den (provozní den pobočky začíná v 06:00).'
  const bezCasu = kc({ datum: '2026-10-15', cas: null })
  ok('bez času (den začíná v 6:00) → datum se neposouvá ani nedomýšlí', bezCasu.hlavicka.datumProdeje === '2026-10-15')
  ok(`… ale přibude upozornění k dokladu „${VETA_BEZ_CASU}" (i v duvody a v hlavičce) a záznam chce kontrolu`,
    JSON.stringify(bezCasu.upozorneniDokladu) === JSON.stringify([VETA_BEZ_CASU]) && bezCasu.duvody.includes(VETA_BEZ_CASU) &&
      JSON.stringify(bezCasu.hlavicka.upozorneniDokladu) === JSON.stringify([VETA_BEZ_CASU]) && bezCasu.vyzadujeKontrolu && K.upozorneniBezCasu('06:00') === VETA_BEZ_CASU)
  ok('… scénář z kontroly: cas null, den začíná v 04:00 → datum zůstane a upozornění jmenuje 04:00',
    ((r) => r.hlavicka.datumProdeje === '2026-10-15' && r.upozorneniDokladu.includes(K.upozorneniBezCasu('04:00')) && /začíná v 04:00\)\.$/.test(r.upozorneniDokladu[0] ?? ''))(kc({ datum: '2026-10-15', cas: null }, '04:00')))
  ok('den začíná o půlnoci („00:00", i „00:00:00" z databáze) → bez upozornění (kalendářní = provozní den)',
    kc({ datum: '2026-10-15', cas: null }, '00:00').upozorneniDokladu.length === 0 && kc({ datum: '2026-10-15', cas: null }, '00:00:00').upozorneniDokladu.length === 0)
  ok('bez denZacina (pobočka ho nezná) → bez upozornění i bez času', K.zkontrolovatDoklad(doklad({ datum: '2026-10-15', cas: null }), DNES).upozorneniDokladu.length === 0)
  ok('s časem po začátku dne (22:15) upozornění „bez času" není', !vecer.upozorneniDokladu.some((u) => u.startsWith('Datum z dokladu je kalendářní den tisku')))
  ok('posunuté datum (1:30) nese jen větu o posunu, ne i „bez času"', noc.upozorneniDokladu.length === 1 && !noc.upozorneniDokladu[0].startsWith('Datum z dokladu je kalendářní'))
  ok('bez data na dokladu → jen „Chybí datum", upozornění o čase ne (není o čem)',
    ((r) => maDuvod(r, 'Chybí datum') && r.upozorneniDokladu.length === 0)(kc({ datum: null, cas: null })))
  ok('starší rozpoznání bez klíče `cas` → datum beze změny, s upozorněním „bez času"',
    ((d) => { delete d.cas; const r = K.zkontrolovatDoklad(d, { ...DNES, denZacina: '06:00' }); return r.hlavicka.datumProdeje === '2026-10-15' && r.upozorneniDokladu.includes(VETA_BEZ_CASU) })(doklad({ datum: '2026-10-15' })))
  ok('bez denZacina (pobočka ho nezná) → beze změny i s časem 1:30', K.zkontrolovatDoklad(doklad({ datum: '2026-10-15', cas: '01:30' }), DNES).hlavicka.datumProdeje === '2026-10-15')
  ok('denZacina z databáze „06:00:00" funguje stejně', kc({ datum: '2026-10-15', cas: '01:30' }, '06:00:00').hlavicka.datumProdeje === '2026-10-14')
  ok('nečitelný čas „25:00" → datum beze změny, ale upozornění „bez času" (jako by čas nebyl)',
    ((r) => r.hlavicka.datumProdeje === '2026-10-15' && r.upozorneniDokladu.includes(VETA_BEZ_CASU))(kc({ datum: '2026-10-15', cas: '25:00' })))
  const zitra = kc({ datum: '2026-10-17', cas: '00:30' })
  ok('účet z 0:30 kalendářně „zítra" (17. 10.) je provozně dnes (16. 10.) → projde, ne „v budoucnosti"',
    zitra.hlavicka.datumProdeje === '2026-10-16' && !maDuvod(zitra, 'budoucnosti'))
  ok('posun přes konec měsíce i roku (1. 11. → 31. 10., 1. 1. → 31. 12.)',
    kc({ datum: '2026-11-01', cas: '01:00' }, '06:00').hlavicka.datumProdeje === null /* 31. 10. je po „dnes" */ &&
      K.zkontrolovatDoklad(doklad({ datum: '2026-01-01', cas: '01:00' }), { dnes: '2026-12-31', denZacina: '06:00' }).hlavicka.datumProdeje === '2025-12-31' &&
      K.zkontrolovatDoklad(doklad({ datum: '2026-11-01', cas: '01:00' }), { dnes: '2026-12-31', denZacina: '06:00' }).hlavicka.datumProdeje === '2026-10-31')
  ok('neplatné denZacina („ráno") → RangeError (chyba volajícího)', hodi(() => K.zkontrolovatDoklad(doklad(), { ...DNES, denZacina: 'ráno' })))
}

console.log('\n== Kontrola dokladu: měna v textu částky a poznámka AI k řádku ==')
{
  const eurRadek = kontrola({ polozky: [radekAi({ cenaJednotkova: '45,00 EUR', cenaCelkem: '90,00 EUR' }), radekAi(SVICKOVA)] })
  const p0 = eurRadek.polozky[0]
  ok(`cena v EUR na dokladu v Kč → důvod u řádku (${p0.duvodKontroly})`,
    p0.vyzadujeKontrolu && p0.duvodKontroly.includes('je v EUR, doklad je v CZK') && p0.duvodKontroly.includes('Cena celkem'))
  ok('… a částka se nepřevádí ani nezahazuje (9000)', p0.cenaCelkemHaleru === 9000 && p0.cenaJednotkovaHaleru === 4500)
  ok('řádek s „189,00" bez značky důvod měny nemá', !eurRadek.polozky[1].duvodKontroly.includes('ověřte měnu'))
  const kcRadek = kontrola({ polozky: [radekAi({ cenaCelkem: '90,00 Kč' }), radekAi(SVICKOVA)] })
  ok('cena „90,00 Kč" na dokladu v Kč → bez důvodu', !kcRadek.polozky[0].vyzadujeKontrolu)
  ok('potvrzením řádku důvod měny zmizí (je ze čtení dokladu)', !K.potvrditRadek(p0, 'CZK').duvodKontroly.includes('ověřte měnu'))
  ok('ruční úpravou (zkontrolovatNavrh) důvod měny nezmizí',
    K.zkontrolovatNavrh([p0], { datumProdeje: '2026-10-15', oznaceni: '', mena: 'CZK', castkaHaleru: 9000, castkaPuvod: 'rucne', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null }).polozky[0].duvodKontroly.includes('ověřte měnu'))
  const eurCelkem = kontrola({ celkem: '279,00 EUR' })
  ok('„Celkem" v EUR na dokladu v Kč → důvod v hlavičce', maDuvod(eurCelkem, '„Celkem" (279,00 EUR) je v EUR, ale měna dokladu je CZK'))
  const eurKUhrade = kontrola({ kUhrade: '279 €' })
  ok('„K úhradě" v € na dokladu v Kč → důvod', maDuvod(eurKUhrade, '„K úhradě"') && maDuvod(eurKUhrade, 'je v EUR'))
  ok('„Celkem" v Kč na dokladu v Kč → bez důvodu měny', !kontrola().duvody.some((d) => d.includes('měna dokladu')))
  const bezMeny = kontrola({ mena: null, celkem: '279,00 EUR', polozky: [radekAi({ cenaCelkem: '90,00 EUR' }), radekAi(SVICKOVA)] })
  ok('doklad bez měny: nic se nesrovnává (jen „Chybí měna")', maDuvod(bezMeny, 'Chybí měna') && !maDuvod(bezMeny, 'měna dokladu') && !bezMeny.polozky[0].duvodKontroly.includes('ověřte měnu'))
  const eurDoklad = kontrola({ mena: 'EUR', celkem: '279,00 EUR', polozky: [radekAi({ cenaCelkem: '90,00 Kč' }), radekAi(SVICKOVA)] })
  ok('doklad v EUR, řádek „90,00 Kč" → důvod (… je v CZK, doklad je v EUR)', eurDoklad.polozky[0].duvodKontroly.includes('je v CZK, doklad je v EUR'))

  const sPoznamkou = kontrola({ polozky: [radekAi({ poznamka: 'přeškrtnuto, dopsáno rukou' }), radekAi(SVICKOVA)] })
  const q0 = sPoznamkou.polozky[0]
  ok(`poznámka AI → důvod „Poznámka z dokladu: …" (${q0.duvodKontroly})`, q0.vyzadujeKontrolu && q0.duvodKontroly === 'Poznámka z dokladu: přeškrtnuto, dopsáno rukou')
  ok('bez poznámky (null) i s prázdnou poznámkou žádný důvod',
    !kontrola().polozky[0].vyzadujeKontrolu && !kontrola({ polozky: [radekAi({ poznamka: '   ' }), radekAi(SVICKOVA)] }).polozky[0].vyzadujeKontrolu)
  const HN = { datumProdeje: '2026-10-15', oznaceni: '', mena: 'CZK', castkaHaleru: 27900, castkaPuvod: 'doklad', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null }
  ok('ruční úpravou (zkontrolovatNavrh) poznámka nezmizí', K.zkontrolovatNavrh([q0, sPoznamkou.polozky[1]], HN).polozky[0].duvodKontroly.includes('Poznámka z dokladu'))
  const qPotvrzeno = K.potvrditRadek(q0, 'CZK')
  ok('potvrzením řádku poznámka zmizí a příznak spadne', !qPotvrzeno.vyzadujeKontrolu && qPotvrzeno.duvodKontroly === '')
  const dlouha = kontrola({ polozky: [radekAi({ poznamka: 'a'.repeat(600) }), radekAi(SVICKOVA)] }).polozky[0].duvodKontroly
  ok(`dlouhá poznámka se zkrátí (${dlouha.length} znaků)`, dlouha.startsWith('Poznámka z dokladu: ') && dlouha.endsWith('…') && dlouha.length <= 'Poznámka z dokladu: '.length + K.MAX_DELKA_POZNAMKY)
  const stredniky = kontrola({ polozky: [radekAi({ poznamka: 'dopsáno; přeškrtnuto' }), radekAi(SVICKOVA)] }).polozky[0]
  ok('poznámka se středníkem zůstane jedním důvodem (spojitDuvody dělí „; ")',
    K.rozdelitDuvody(stredniky.duvodKontroly).length === 1 && K.rozdelitDuvody(stredniky.duvodKontroly)[0].startsWith('Poznámka z dokladu: '))
  const sNejistotou = kontrola({ polozky: [radekAi({ poznamka: 'rozmazané', jistota: 0.5 }), radekAi(SVICKOVA)] }).polozky[0]
  ok('poznámka vedle jiného důvodu ze čtení (nejistota) — oba', sNejistotou.duvodKontroly.includes('Poznámka z dokladu: rozmazané') && sNejistotou.duvodKontroly.includes('Nejistě'))
}

console.log('\n== Kontrola návrhu po ruční úpravě ==')
{
  const H = { datumProdeje: '2026-10-15', oznaceni: 'Stůl 4', mena: 'CZK', castkaHaleru: 27900, castkaPuvod: 'rucne', typDokladu: 'uzavreny_prodej', externiUcet: null, kontaktId: null }
  const rucni = (o = {}) => ({
    nazevPuvodni: '', nazev: 'Pivo', mnozstvi: '2', jednotka: null, cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 9000, sazbaDph: '21', jistota: null,
    zdroj: 'rucne', druh: 'rozlevany_napoj', posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', vyzadujeKontrolu: false, duvodKontroly: '', ...o,
  })
  const svickova = rucni({ nazev: 'Svíčková', mnozstvi: '1', cenaJednotkovaHaleru: 18900, cenaCelkemHaleru: 18900, sazbaDph: '12', druh: 'pokrm' })

  const cisty = K.zkontrolovatNavrh([rucni(), svickova], H)
  ok('čistý ruční návrh: bez důvodů, řádky bez příznaku', cisty.duvody.length === 0 && cisty.polozky.every((p) => !p.vyzadujeKontrolu && p.duvodKontroly === ''))
  ok('součet 27900, bez nesouladu', cisty.soucetPolozekHaleru === 27900 && cisty.nesoulad === null)

  const bezMnozstvi = K.zkontrolovatNavrh([rucni({ mnozstvi: null }), rucni({ cenaJednotkovaHaleru: null, cenaCelkemHaleru: null })], H)
  ok('ruční řádek bez množství → příznak „Chybí množství"', bezMnozstvi.polozky[0].vyzadujeKontrolu && bezMnozstvi.polozky[0].duvodKontroly.includes('Chybí množství'))
  ok('ruční řádek bez ceny → příznak „Chybí cena", součet null', bezMnozstvi.polozky[1].duvodKontroly.includes('Chybí cena') && bezMnozstvi.soucetPolozekHaleru === null)

  const zastaraly = K.zkontrolovatNavrh([rucni({ vyzadujeKontrolu: true, duvodKontroly: 'Chybí cena; Chybí množství' })], { ...H, castkaHaleru: 9000 })
  ok('opravený řádek: staré věcné důvody zmizí a příznak spadne', !zastaraly.polozky[0].vyzadujeKontrolu && zastaraly.polozky[0].duvodKontroly === '')

  const ai = K.zkontrolovatDoklad(doklad({ polozky: [radekAi({ jistota: 0.5, mnozstvi: null })], celkem: '90,00' }), DNES).polozky[0]
  ok('(příprava) AI řádek má nejistotu i chybějící množství', ai.duvodKontroly.includes('Nejistě') && ai.duvodKontroly.includes('Chybí množství'))
  const doplneno = K.zkontrolovatNavrh([{ ...ai, mnozstvi: '2' }], { ...H, castkaHaleru: 9000 }).polozky[0]
  ok('po doplnění množství zmizí „Chybí množství", nejistota ze čtení zůstane', !doplneno.duvodKontroly.includes('Chybí množství') && doplneno.duvodKontroly.includes('Nejistě') && doplneno.vyzadujeKontrolu)
  const potvrzeno = K.potvrditRadek(doplneno, 'CZK')
  ok('potvrzením řádku člověkem zmizí i nejistota → bez příznaku', !potvrzeno.vyzadujeKontrolu && potvrzeno.duvodKontroly === '')
  const potvrzenoBezCeny = K.potvrditRadek({ ...doplneno, cenaJednotkovaHaleru: null, cenaCelkemHaleru: null }, 'CZK')
  ok('potvrzení neodstraní věcný problém (bez ceny zůstane příznak)', potvrzenoBezCeny.vyzadujeKontrolu && potvrzenoBezCeny.duvodKontroly.includes('Chybí cena'))

  const oznaceny = K.zkontrolovatNavrh([rucni({ vyzadujeKontrolu: true, duvodKontroly: '' })], { ...H, castkaHaleru: 9000 }).polozky[0]
  ok('příznak bez textu se neztratí (obecný důvod)', oznaceny.vyzadujeKontrolu && oznaceny.duvodKontroly === K.DUVOD_OZNACENO)

  const prevodDuvod = `${K.PREDPONA_PREVODU}Pokladna neuvádí, kolik jednoho kusu je v litrech`
  const sProduktem = rucni({ posProduktId: 'p1', posProduktNazev: 'Pivo', mapovani: 'navrh', vyzadujeKontrolu: true, duvodKontroly: prevodDuvod })
  ok('nevyřešený převod do jednotek pokladny zůstane', K.zkontrolovatNavrh([sProduktem], { ...H, castkaHaleru: 9000 }).polozky[0].duvodKontroly === prevodDuvod)
  ok('… zůstane i po potvrzení řádku', K.potvrditRadek(sProduktem, 'CZK').duvodKontroly === prevodDuvod)
  ok('… zmizí, když je množství pro pokladnu vyplněné', !K.zkontrolovatNavrh([{ ...sProduktem, posMnozstvi: '2' }], { ...H, castkaHaleru: 9000 }).polozky[0].vyzadujeKontrolu)
  ok('… zmizí, když řádek produkt nemá', !K.zkontrolovatNavrh([{ ...sProduktem, posProduktId: null }], { ...H, castkaHaleru: 9000 }).polozky[0].vyzadujeKontrolu)

  const slevaKladna = K.zkontrolovatNavrh([rucni({ nazev: 'Sleva', druh: 'sleva', mnozstvi: null, cenaJednotkovaHaleru: null, cenaCelkemHaleru: 2900 })], H).polozky[0]
  ok('ruční kladná sleva → otočená na −2900 (databáze kladnou slevu nepustí), bez příznaku', slevaKladna.cenaCelkemHaleru === -2900 && !slevaKladna.vyzadujeKontrolu)
  const kladnaSlevaVSouctu = K.zkontrolovatNavrh([rucni(), svickova, rucni({ nazev: 'Sleva', druh: 'sleva', mnozstvi: null, cenaJednotkovaHaleru: null, cenaCelkemHaleru: 2900 })], { ...H, castkaHaleru: 25000 })
  ok('… a součet počítá s otočenou slevou (279 − 29 = 250, bez nesouladu)', kladnaSlevaVSouctu.soucetPolozekHaleru === 25000 && kladnaSlevaVSouctu.nesoulad === null)
  const sluzbaBezMnozstvi = K.zkontrolovatNavrh([rucni({ nazev: 'Obsluha 10 %', druh: 'sluzba', mnozstvi: null, cenaJednotkovaHaleru: null, cenaCelkemHaleru: 2790 })], H).polozky[0]
  ok('služba bez množství není ke kontrole (množství zůstane prázdné, nedoplní se 1)', !sluzbaBezMnozstvi.vyzadujeKontrolu && sluzbaBezMnozstvi.mnozstvi === null)
  ok('pokrm bez množství ke kontrole je', K.zkontrolovatNavrh([rucni({ druh: 'pokrm', mnozstvi: null })], H).polozky[0].duvodKontroly.includes('Chybí množství'))
  const nesediRucne = K.zkontrolovatNavrh([rucni({ mnozstvi: '1', cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 4700 })], H).polozky[0]
  ok('ruční 1 × 45 ≠ 47 → příznak', nesediRucne.duvodKontroly.includes('nesedí'))
  const nula = K.zkontrolovatNavrh([rucni({ nazev: 'Voda pro personál', mnozstvi: '1', cenaJednotkovaHaleru: 0, cenaCelkemHaleru: 0 })], { ...H, castkaHaleru: 0 }).polozky[0]
  ok('ruční cena 0 (člověk ji zadal) → bez příznaku', !nula.vyzadujeKontrolu)

  const hl = K.zkontrolovatNavrh([rucni(), svickova], { ...H, mena: null, castkaHaleru: null, datumProdeje: '2026-13-01' })
  ok('hlavička: chybí měna, částka, neplatné datum → tři důvody', hl.duvody.includes('Chybí měna') && hl.duvody.includes('Chybí celková cena prodeje') && hl.duvody.includes('Datum prodeje není platné datum'))
  const nes = K.zkontrolovatNavrh([rucni(), svickova], { ...H, castkaHaleru: 30000 })
  ok('hlavička 300 proti součtu 279 → nesoulad 2100', nes.nesoulad?.rozdilHaleru === 2100 && nes.duvody.includes(nes.nesoulad.popis))
  ok('hlavička 279,40 proti 279 (CZK) → zaokrouhlení, ne nesoulad', K.zkontrolovatNavrh([rucni(), svickova], { ...H, castkaHaleru: 27940 }).nesoulad === null)
  ok('prázdný návrh → důvod', K.zkontrolovatNavrh([], H).duvody.includes('Záznam nemá žádné položky'))
  const vstup = rucni({ mnozstvi: null })
  const vystup = K.zkontrolovatNavrh([vstup], H).polozky[0]
  ok('vstupní řádek se nezmění (příznak dostane jen výstup)', vystup.vyzadujeKontrolu && !vstup.vyzadujeKontrolu && vstup.duvodKontroly === '')
}

/* ================================================================== */
const produkt = (o) => ({ externiId: 'x', nazev: 'X', jednotka: 'Piece', mira: null, odecitaSklad: true, maRecepturu: false, plu: [], ean: [], smazano: false, ...o })
const KAT = [
  produkt({ externiId: 'p-pivo05', nazev: 'Pilsner Urquell 0,5 l', jednotka: 'Liter', mira: 0.5, plu: ['12'] }),
  produkt({ externiId: 'p-pivo03', nazev: 'Pilsner Urquell 0,3 l', jednotka: 'Liter', mira: 0.3 }),
  produkt({ externiId: 'p-svickova', nazev: 'Svíčková na smetaně', jednotka: 'Piece', odecitaSklad: false, maRecepturu: true }),
  produkt({ externiId: 'p-svickova-stara', nazev: 'Svíčková na smetaně', smazano: true }),
  produkt({ externiId: 'p-kofola', nazev: 'Kofola 0,33 l láhev', jednotka: 'Piece', ean: ['8593868002157'] }),
  produkt({ externiId: 'p-vino', nazev: 'Víno bílé sudové', jednotka: 'Liter', mira: null }),
  produkt({ externiId: 'p-tocene', nazev: 'Pivo točené', jednotka: 'Piece', mira: null }),
  produkt({ externiId: 'p-sluzba', nazev: 'Pronájem salonku', jednotka: 'Piece', odecitaSklad: false, maRecepturu: false }),
]
const navrh = (o = {}) => ({
  nazevPuvodni: 'Pivo', nazev: 'Pivo', mnozstvi: '2', jednotka: null, cenaJednotkovaHaleru: 4500, cenaCelkemHaleru: 9000, sazbaDph: '21', jistota: 0.95,
  zdroj: 'ai', druh: 'rozlevany_napoj', posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano', vyzadujeKontrolu: false, duvodKontroly: '', ...o,
})

console.log('\n== Mapování na katalog pokladny ==')
{
  ok('normalizace „Pivo 0,50L" = „pivo 0.5 l"', M.normalizovatNazev('Pivo 0,50L') === 'pivo 0.5 l')
  ok('normalizace „PIVO  0.5 l" = totéž', M.normalizovatNazev('PIVO  0.5 l') === 'pivo 0.5 l')
  ok('normalizace bez diakritiky „Svíčková na smetaně"', M.normalizovatNazev('Svíčková  na smetaně!') === 'svickova na smetane')
  ok('normalizace „Kofola 330ml" = „kofola 330 ml"', M.normalizovatNazev('Kofola 330ml') === 'kofola 330 ml')

  const alias = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'PU 0,5l' }), KAT, [{ alias: 'pu 0.5 L', posProduktId: 'p-pivo05' }])
  ok('ověřený alias (normalizovaný) → overeno + produkt', alias.polozka.mapovani === 'overeno' && alias.polozka.posProduktId === 'p-pivo05' && alias.polozka.posProduktNazev === 'Pilsner Urquell 0,5 l')
  ok('… množství pro pokladnu dopočtené ("2")', alias.polozka.posMnozstvi === '2')
  const aliasSmazany = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Svíčková' }), KAT, [{ alias: 'svickova', posProduktId: 'p-svickova-stara' }])
  ok('alias na smazaný produkt neplatí (není overeno)', aliasSmazany.polozka.mapovani !== 'overeno' && aliasSmazany.polozka.posProduktId !== 'p-svickova-stara')

  const sv = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Svíčková na smetaně', nazev: 'Svíčková na smetaně', druh: 'pokrm', mnozstvi: '1' }), KAT, [])
  ok('pokrm podle shody názvu → navrh (NIKDY overeno)', sv.polozka.mapovani === 'navrh' && sv.polozka.posProduktId === 'p-svickova')
  ok('pokrm s recepturou se vydává jako pokrm (produkt = pokrm, množství 1)', sv.polozka.posProduktId === 'p-svickova' && sv.polozka.posMnozstvi === '1')
  ok('smazaný produkt mezi kandidáty není', sv.kandidati.every((k) => !k.produkt.smazano))
  ok('kandidáti nejvýš 3, skóre 0–1, seřazení sestupně', sv.kandidati.length <= 3 && sv.kandidati.every((k) => k.skore >= 0 && k.skore <= 1) && sv.kandidati.every((k, i, a) => i === 0 || a[i - 1].skore >= k.skore))

  const pu = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Pilsner Urquell 0,5l' }), KAT, [])
  ok('„Pilsner Urquell 0,5l" → navrh 0,5 l, ne 0,3 l (jiné číslo v názvu)', pu.polozka.mapovani === 'navrh' && pu.polozka.posProduktId === 'p-pivo05')
  const k03 = pu.kandidati.find((k) => k.produkt.externiId === 'p-pivo03')
  ok('… 0,3 l má výrazně nižší skóre s vysvětlením', k03 !== undefined && k03.skore < pu.kandidati[0].skore - 0.2 && k03.proc.includes('jiné číslo'))
  const remiza = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Pilsner Urquell' }), KAT, [])
  ok('„Pilsner Urquell" bez objemu: dva stejně podobní → žádný návrh, vybere člověk', remiza.polozka.mapovani === 'nenamapovano' && remiza.kandidati.length >= 2)
  const nic = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Hranolky', druh: 'pokrm' }), KAT, [])
  ok('nepodobný název → nenamapovano bez produktu', nic.polozka.mapovani === 'nenamapovano' && nic.polozka.posProduktId === null)
  const ean = M.navrhnoutMapovani(navrh({ nazevPuvodni: '8593868002157 Kofola', druh: 'kusove_zbozi', mnozstvi: '3' }), KAT, [])
  ok('kusový nápoj podle EAN → navrh Kofola, 3 kusy', ean.polozka.posProduktId === 'p-kofola' && ean.polozka.mapovani === 'navrh' && ean.polozka.posMnozstvi === '3')

  const overena = navrh({ mapovani: 'overeno', posProduktId: 'p-tocene', posProduktNazev: 'Pivo točené', posMnozstvi: '2' })
  const znovu = M.navrhnoutMapovani(overena, KAT, [{ alias: 'pivo', posProduktId: 'p-pivo05' }])
  ok('už ověřenou položku nepřepíše', znovu.polozka === overena && znovu.polozka.posProduktId === 'p-tocene')
  const tip = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Spropitné', druh: 'spropitne', posProduktId: 'p-pivo05' }), KAT, [{ alias: 'spropitne', posProduktId: 'p-pivo05' }])
  ok('spropitné → neskladova, bez produktu (i proti aliasu)', tip.polozka.mapovani === 'neskladova' && tip.polozka.posProduktId === null && tip.kandidati.length === 0)
  const sluzba = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Pronájem salonku', druh: 'sluzba' }), KAT, [])
  ok('služba → neskladova', sluzba.polozka.mapovani === 'neskladova' && sluzba.polozka.posProduktId === null)

  // Převod chybí → příznak; po opravě zmizí.
  const litr = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Pivo točené', mnozstvi: '1', jednotka: 'l' }), KAT, [])
  ok('1 l na produkt bez míry → produkt navržen, množství pro pokladnu null + příznak převodu', litr.polozka.posProduktId === 'p-tocene' && litr.polozka.posMnozstvi === null && litr.polozka.vyzadujeKontrolu && litr.polozka.duvodKontroly.startsWith(K.PREDPONA_PREVODU))
  const opraveno = M.navrhnoutMapovani({ ...litr.polozka, mnozstvi: '2', jednotka: 'ks' }, KAT, [])
  ok('po přepsání na 2 ks převod projde a příznak převodu zmizí', opraveno.polozka.posMnozstvi === '2' && !opraveno.polozka.vyzadujeKontrolu)
  const jinyDuvod = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Pivo točené', vyzadujeKontrolu: true, duvodKontroly: 'Nejistě přečtený řádek (jistota 50 %)' }), KAT, [])
  ok('mapování nesmaže cizí důvod ke kontrole', jinyDuvod.polozka.vyzadujeKontrolu && jinyDuvod.polozka.duvodKontroly.includes('Nejistě'))
  ok('potvrzení navrženého přiřazení člověkem → overeno', M.overitMapovani(sv.polozka).mapovani === 'overeno' && M.overitMapovani(sv.polozka).posProduktId === 'p-svickova')
  ok('bez produktu se nic neověří', M.overitMapovani(nic.polozka).mapovani === 'nenamapovano')
  const prepocet = M.prepocitatPosMnozstvi({ ...alias.polozka, mnozstvi: '3' }, KAT)
  ok('přepočet u ověřeného řádku po změně množství: 3, přiřazení zůstane', prepocet.posMnozstvi === '3' && prepocet.mapovani === 'overeno')
}

console.log('\n== Převod do jednotek pokladny (jen z dat pokladny) ==')
{
  const [pivo05, pivo03, , , kofola, vino, tocene] = KAT
  const pr = (m, j, p) => M.prevestNaJednotkyPos(m, j, p)
  const r1 = pr('2', null, pivo05)
  ok('2× pivo 0,5 l, jednotka prázdná → 2 kusy', r1.stav === 'ok' && r1.posMnozstvi === '2')
  ok('… popis „2 × 0,5 l = 1 l podle nastavení položky v pokladně"', r1.stav === 'ok' && r1.popis === '2 × 0,5 l = 1 l podle nastavení položky v pokladně')
  const r2 = pr('1', 'l', pivo05)
  ok('1 l piva, pokladna uvádí 0,5 l na kus → 2 kusy', r2.stav === 'ok' && r2.posMnozstvi === '2' && r2.popis === '2 × 0,5 l = 1 l podle nastavení položky v pokladně')
  const r3 = pr('1', 'l', tocene)
  ok('1 l piva, pokladna míru neuvádí → nejasne „Pokladna neuvádí, kolik jednoho kusu je v litrech"', r3.stav === 'nejasne' && r3.duvod === 'Pokladna neuvádí, kolik jednoho kusu je v litrech')
  const r4 = pr('2', 'ks', tocene)
  ok('2 ks na produkt bez míry → 2 (bez tvrzení o litrech)', r4.stav === 'ok' && r4.posMnozstvi === '2' && !r4.popis.includes(' l '))
  ok('500 ml na 0,5 l → 1', pr('500', 'ml', pivo05).posMnozstvi === '1')
  ok('1 l na 0,3 l → nevychází na tisíciny → nejasne (žádné zaokrouhlení)', pr('1', 'l', pivo03).stav === 'nejasne')
  ok('0,9 l na 0,3 l → 3', pr('0.9', 'l', pivo03).posMnozstvi === '3')
  ok('1 kg na litrový produkt → nejasne (jiná skupina)', pr('1', 'kg', pivo05).stav === 'nejasne')
  ok('0,75 l na víno v litrech bez míry → 0,75 (stejná jednotka)', pr('0.75', 'l', vino).posMnozstvi === '0.75')
  ok('750 ml na víno bez míry → nejasne (bez míry se nepřevádí)', pr('750', 'ml', vino).stav === 'nejasne')
  ok('„sklenice" → nejasne', pr('2', 'sklenice', vino).stav === 'nejasne')
  ok('3 ks Kofoly → 3', pr('3', 'ks', kofola).posMnozstvi === '3')
  ok('množství chybí → nejasne', pr(null, null, kofola).stav === 'nejasne')
  ok('produkt bez jednotky, doklad v l → nejasne', pr('1', 'l', { ...kofola, jednotka: null }).stav === 'nejasne')

  // Kusy z dokladu na položku v litrech/kilogramech BEZ míry: pokladna pak
  // prodej počítá v litrech a „2 ks" by odešlo jako 2 litry.
  const LITRY_BEZ_MIRY = 'Pokladna u položky vede litry, ale neuvádí, kolik je v jednom kusu — zapište množství v jednotkách pokladny'
  const k1 = pr('2', 'ks', vino)
  ok(`2 ks → položka v litrech bez míry → nejasne s důvodem (${k1.duvod ?? k1.posMnozstvi})`, k1.stav === 'nejasne' && k1.duvod === LITRY_BEZ_MIRY)
  ok('2 bez jednotky → litry bez míry → nejasne', pr('2', null, vino).stav === 'nejasne')
  ok('2 „x" → litry bez míry → nejasne', pr('2', 'x', vino).stav === 'nejasne')
  ok('2 ks → Milliliter bez míry → nejasne', pr('2', 'ks', produkt({ jednotka: 'Milliliter' })).stav === 'nejasne')
  const k2 = pr('2', 'ks', produkt({ jednotka: 'Kilogram' }))
  ok('2 ks → Kilogram bez míry → nejasne „… vede kilogramy …"', k2.stav === 'nejasne' && k2.duvod.includes('vede kilogramy'))
  ok('2 ks → Gram bez míry → nejasne', pr('2', 'ks', produkt({ jednotka: 'Gram' })).stav === 'nejasne')
  const k3 = pr('2', 'ks', kofola)
  ok('2 ks → položka v kusech (Piece) → 2', k3.stav === 'ok' && k3.posMnozstvi === '2')
  const k4 = pr('2', 'ks', produkt({ jednotka: null }))
  ok('2 ks → položka bez jednotky → 2', k4.stav === 'ok' && k4.posMnozstvi === '2')
  ok('2 ks → položka s prázdnou jednotkou → 2', pr('2', 'ks', produkt({ jednotka: '  ' })).posMnozstvi === '2')
  const k5 = pr('2', 'ks', produkt({ jednotka: 'Hour' }))
  ok(`2 ks → jednotka pokladny, které appka nerozumí (Hour) → nejasne (${k5.duvod ?? k5.posMnozstvi})`, k5.stav === 'nejasne' && k5.duvod.includes('Hour'))
  ok('2 ks → litry S mírou dál → 2 kusy', pr('2', 'ks', pivo05).posMnozstvi === '2')
  const sVinem = M.navrhnoutMapovani(navrh({ nazevPuvodni: 'Víno bílé', mnozstvi: '2', jednotka: 'ks' }), KAT, [{ alias: 'Víno bílé', posProduktId: 'p-vino' }])
  ok('mapování na litry bez míry: produkt přiřazený, množství pro pokladnu prázdné a důvod převodu u řádku',
    sVinem.polozka.posProduktId === 'p-vino' && sVinem.polozka.posMnozstvi === null && sVinem.polozka.vyzadujeKontrolu &&
      sVinem.polozka.duvodKontroly.includes(K.PREDPONA_PREVODU + LITRY_BEZ_MIRY))

  ok('tykaSeSkladu: spropitné → false', M.tykaSeSkladu(navrh({ druh: 'spropitne' }), pivo05) === false)
  ok('tykaSeSkladu: pokrm s recepturou → true', M.tykaSeSkladu(navrh({ druh: 'pokrm' }), KAT[2]) === true)
  ok('tykaSeSkladu: pivo odečítá sklad → true', M.tykaSeSkladu(navrh(), pivo05) === true)
  ok('tykaSeSkladu: produkt bez skladu i receptury → false', M.tykaSeSkladu(navrh({ druh: 'pokrm' }), KAT[7]) === false)
  ok('tykaSeSkladu: bez produktu → null', M.tykaSeSkladu(navrh(), null) === null)
  ok('tykaSeSkladu: pokladna nic neuvádí → null', M.tykaSeSkladu(navrh(), produkt({ odecitaSklad: null, maRecepturu: null })) === null)

  // N21: pokrm i jeho surovinu v jednom výdeji nic nevynucuje (receptury nečteme) — komentáře
  // to nesmí slibovat; schvalovatele varuje `varovani` ze sestavení výdeje (jine_platby_sestavit_vydej).
  const mapovaniZdroj = readFileSync(new URL('../lib/jine-platby-mapovani.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\n\s*\*\s*/g, ' ')
  ok('mapování neslibuje, že appka pokrm a jeho suroviny nikdy nevydá spolu (N21)',
    !/vydat pokrm i suroviny zároveň nesmí/.test(mapovaniZdroj) && !/suroviny pokrmu nikdy nevydává/.test(mapovaniZdroj))
  // P2 (20. 10.): schválení výdeje s varováním chce výslovné potvrzení (p_bez_surovin) — komentář už netvrdí „nevynucuje".
  ok('… a říká, že schvalovatel dostane varování (`varovani`) a schválení chce výslovné potvrzení (`p_bez_surovin`)',
    /`varovani` z\s+`jine_platby_sestavit_vydej`/.test(mapovaniZdroj) && /VÝSLOVNÉ potvrzení schvalovatele/.test(mapovaniZdroj) &&
      /`p_bez_surovin = true`/.test(mapovaniZdroj) && !/databáze to nevynucuje/.test(mapovaniZdroj) && !/databáze\s+nevynucují/.test(mapovaniZdroj))
  {
    const sqlS = textMigrace()
    const telo = teloFunkce(sqlS, 'public.jine_platby_rozhodnout_vydej')
    ok('… komentář sedí s migrací: rozhodnout_vydej má p_bez_surovin a bez něj varování schválení odmítne',
      /p_bez_surovin boolean default false/.test(telo) && /'varovani'[\s\S]{0,80}and not coalesce\(p_bez_surovin, false\)/.test(telo))
    ok('… a varování dává jen pokrm + KUSOVÉ zboží (rozlévaný nápoj ne), jak říká komentář',
      /elsif v_p\.druh = 'kusove_zbozi' then v_ma_zbozi := true/.test(sqlS) && /kusové zboží\. Zkontrolujte/.test(sqlS) && /pivo ani jiný rozlévaný nápoj varování nedává/.test(mapovaniZdroj))
  }
}

/* ================================================================== */
const zaznam = (o = {}) => ({
  id: 'z1', tenantId: 't1', branchId: 'b1', pripojeniId: 'pos1', posProvozovna: '77', datumProdeje: '2026-10-15', oznaceni: 'Stůl 4', kontaktId: null,
  mena: 'CZK', castkaHaleru: 27900, castkaPuvod: 'doklad', typDokladu: 'uzavreny_prodej', externiUcet: '1234', posProdejId: null,
  stavKontroly: 'zkontrolovano', stavTrzby: 'nezapsano', stavSkladu: 'bez_navrhu', stavFaktury: 'bez_faktury', fakturaCislo: null, fakturaZdroj: null,
  fakturaCastkaHaleru: null, stavUhrady: 'neovereno', uhradaTransakceId: null, uhradaCastkaHaleru: null, kontrolaTrzby: null, kontrolaSkladu: null,
  pokladnaTrzby: null, pokladnaSkladu: null, nedohledanaOperace: null, verze: 3, vytvoril: null, vytvoreno: '2026-10-15T10:00:00Z', zmeneno: '2026-10-15T10:00:00Z', ...o,
})
const TED = Date.parse('2026-10-16T12:00:00Z')
const pred = (min) => new Date(TED - min * 60_000).toISOString()

console.log('\n== Popisky stavů ==')
{
  const skupiny = [
    [T.STAVY_KONTROLY, S.popisStavuKontroly],
    [T.STAVY_TRZBY, S.popisStavuTrzby],
    [T.STAVY_SKLADU, S.popisStavuSkladu],
    [T.STAVY_FAKTURY, S.popisStavuFaktury],
    [T.STAVY_UHRADY, S.popisStavuUhrady],
  ]
  const vse = skupiny.flatMap(([stavy, f]) => stavy.map((s) => [s, f(s)]))
  ok('každý stav má český text (ne klíč) a platný tón', vse.every(([s, p]) => p.text.length > 0 && p.text !== s && ['neutral', 'accent', 'success', 'warning', 'danger'].includes(p.ton) && !p.text.startsWith('Neznámý')))
  ok('varování nese ikona: každý warning/danger má varovani = true', vse.every(([, p]) => (p.ton === 'warning' || p.ton === 'danger') === p.varovani))
  ok('„Odečteno v POS" jen u odecteno_v_pos', T.STAVY_SKLADU.filter((s) => S.popisStavuSkladu(s).text.includes('Odečteno v POS')).join() === 'odecteno_v_pos')
  ok('rucne_dolozeno = „Ručně doloženo (neověřeno pokladnou)" a není zelené', S.popisStavuSkladu('rucne_dolozeno').text === 'Ručně doloženo (neověřeno pokladnou)' && S.popisStavuSkladu('rucne_dolozeno').ton !== 'success')
  ok('nepodporovano = „Schváleno — výdej provést ručně v pokladně" (zahájený výdej, ne „neumí")', S.popisStavuSkladu('nepodporovano').text === 'Schváleno — výdej provést ručně v pokladně' && S.popisStavuSkladu('nepodporovano').varovani)
  ok('neovereno = „Úhrada neověřena" a není zelené', S.popisStavuUhrady('neovereno').text === 'Úhrada neověřena' && S.popisStavuUhrady('neovereno').ton !== 'success')
  ok('typy dokladu a druhy mají české popisky', T.TYPY_DOKLADU.every((t) => S.popisTypuDokladu(t) !== t && S.popisTypuDokladu(t).length > 0) && T.DRUHY_POLOZEK.every((d) => S.popisDruhu(d) !== d && S.popisDruhu(d).length > 0))
}

console.log('\n== Platnost kontroly proti pokladně ==')
{
  ok('stejná verze, 5 min stará → platí', S.kontrolaPlati({ verze: 3, kdy: pred(5) }, 3, 30, TED))
  ok('jiná verze → neplatí', !S.kontrolaPlati({ verze: 2, kdy: pred(5) }, 3, 30, TED))
  ok('29 min → platí', S.kontrolaPlati({ verze: 3, kdy: pred(29) }, 3, 30, TED))
  ok('přesně 30 min → už neplatí (jako app.jp_kontrola_plati: kdy > now() − 30 min)', !S.kontrolaPlati({ verze: 3, kdy: pred(30) }, 3, 30, TED))
  ok('z budoucnosti o 2 min → neplatí', !S.kontrolaPlati({ verze: 3, kdy: pred(-2) }, 3, 30, TED))
  ok('nečitelné datum → neplatí', !S.kontrolaPlati({ verze: 3, kdy: 'včera' }, 3, 30, TED))
  ok('žádná kontrola → neplatí', !S.kontrolaPlati(null, 3, 30, TED))
}

console.log('\n== Kroky průvodce ==')
{
  const M0 = { pocetSouboru: 1, pocetPolozek: 2, maPokladnu: true, maZiveNavrhSkladu: false }
  const stavy = (z, m = M0) => S.krokyPruvodce(z, m).map((k) => k.stav)
  const kroky = S.krokyPruvodce(zaznam(), M0)
  ok('přesně 9 kroků se jmény ze zadání a čísly 1–9', kroky.length === 9 && kroky.map((k) => k.nazev).join('|') === 'Provozovna a pokladna|Doklad nebo ruční zadání|Rozpoznání položek a částky|Kontrola a přiřazení ke katalogu|Kontrola tržby a výdeje v pokladně|Zápis tržby|Skladový návrh ke schválení|Potvrzení výdeje v pokladně|Faktura' && kroky.every((k, i) => k.cislo === i + 1))

  const trzbaHotova = stavy(zaznam({ stavTrzby: 'zapsano' }))
  ok('tržba zapsaná, sklad bez návrhu → krok 6 hotovo, 7 aktuální, 8 čeká (ne hotovo)', trzbaHotova[5] === 'hotovo' && trzbaHotova[6] === 'aktualni' && trzbaHotova[7] === 'ceka')
  const skladHotov = stavy(zaznam({ stavSkladu: 'odecteno_v_pos' }))
  ok('sklad odečtený, tržba nezapsaná → krok 8 hotovo, 6 ne', skladHotov[7] === 'hotovo' && skladHotov[5] !== 'hotovo')
  const fakturaHotova = stavy(zaznam({ stavFaktury: 'propojena', fakturaCislo: 'FV-1' }))
  ok('faktura propojená neoznačí tržbu ani sklad', fakturaHotova[8] === 'hotovo' && fakturaHotova[5] !== 'hotovo' && fakturaHotova[7] !== 'hotovo')
  const zrus = stavy(zaznam({ stavKontroly: 'zruseno' }), { ...M0, pocetPolozek: 0 })
  ok('zrušený záznam: hotové zůstanou (1, 2), zbytek nepotřebný', zrus[0] === 'hotovo' && zrus[1] === 'hotovo' && zrus.slice(2).every((s) => s === 'nepotrebny'))
  const bezPos = S.krokyPruvodce(zaznam({ pripojeniId: null }), { ...M0, maPokladnu: false })
  ok('bez pokladny: kroky 7–8 blokované s vysvětlením', bezPos[6].stav === 'blokovano' && bezPos[7].stav === 'blokovano' && bezPos[6].popis === 'Provozovna nemá připojenou pokladnu — výdej jen ručně' && bezPos[7].popis === bezPos[6].popis)
  const bezPosRucne = stavy(zaznam({ pripojeniId: null, stavSkladu: 'rucne_dolozeno' }), { ...M0, maPokladnu: false })
  ok('bez pokladny a ručně doloženo → krok 8 hotovo (neblokuje se)', bezPosRucne[7] === 'hotovo')
  const nevyz = stavy(zaznam({ stavSkladu: 'nevyzaduje' }))
  ok('sklad se netýká → 7 a 8 nepotřebné', nevyz[6] === 'nepotrebny' && nevyz[7] === 'nepotrebny')
  const novy = stavy(zaznam({ stavKontroly: 'rozpracovano', castkaHaleru: null }), { ...M0, pocetSouboru: 0, pocetPolozek: 0 })
  ok('nový záznam: krok 2 aktuální, 3 a 4 čekají', novy[1] === 'aktualni' && novy[2] === 'ceka' && novy[3] === 'ceka')
  const fotka = stavy(zaznam({ stavKontroly: 'rozpracovano' }), { ...M0, pocetPolozek: 0 })
  ok('fotka bez položek: 2 hotovo, 3 aktuální', fotka[1] === 'hotovo' && fotka[2] === 'aktualni')
  const ceka = stavy(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), { ...M0, maZiveNavrhSkladu: true })
  ok('návrh čeká na schválení → 7 hotovo, 8 aktuální', ceka[6] === 'hotovo' && ceka[7] === 'aktualni')
  const nahrazen = stavy(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), { ...M0, maZiveNavrhSkladu: false })
  ok('návrh nahrazený změnou → 7 aktuální, 8 čeká', nahrazen[6] === 'aktualni' && nahrazen[7] === 'ceka')
  const rucne = S.krokyPruvodce(zaznam({ stavSkladu: 'rucne_dolozeno' }), M0)[7]
  ok('ručně doloženo → krok 8 hotovo s textem „neověřeno pokladnou"', rucne.stav === 'hotovo' && rucne.popis.includes('neověřeno pokladnou'))
  const kontrolaT = stavy(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 3, kdy: pred(1), kdo: null, detail: {} }, kontrolaSkladu: { vysledek: 'neodecteno', zdroj: 'pos_api', verze: 3, kdy: pred(1), kdo: null, detail: {} } }))
  ok('kontrola tržby i skladu pro tuto verzi → krok 5 hotovo, krok 6 aktuální', kontrolaT[4] === 'hotovo' && kontrolaT[5] === 'aktualni')
  const staraVerze = stavy(zaznam({ kontrolaTrzby: { vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 2, kdy: pred(1), kdo: null, detail: {} } }))
  ok('kontrola tržby ke staré verzi → krok 5 aktuální, krok 6 čeká', staraVerze[4] === 'aktualni' && staraVerze[5] === 'ceka')
}

console.log('\n== Dostupné akce ==')
{
  const VSE = new Set(T.PRAVA_JINYCH_PLATEB)
  const m = (o = {}) => ({ maPokladnu: true, maZiveNavrhSkladu: false, stavOperace: null, tedMs: TED, ...o })
  const kT = (o = {}) => ({ vysledek: 'nenalezeno', zdroj: 'pos_api', verze: 3, kdy: pred(5), kdo: null, detail: {}, ...o })

  ok('čerstvá kontrola tržby, tatáž verze → potvrdit_trzbu', S.dostupneAkce(zaznam({ kontrolaTrzby: kT() }), VSE, m()).has('potvrdit_trzbu'))
  ok('kontrola 31 min stará → bez potvrdit_trzbu', !S.dostupneAkce(zaznam({ kontrolaTrzby: kT({ kdy: pred(31) }) }), VSE, m()).has('potvrdit_trzbu'))
  ok('kontrola ke staré verzi → bez potvrdit_trzbu', !S.dostupneAkce(zaznam({ kontrolaTrzby: kT({ verze: 2 }) }), VSE, m()).has('potvrdit_trzbu'))
  ok('nezkontrolovaný záznam → bez potvrdit_trzbu', !S.dostupneAkce(zaznam({ stavKontroly: 'ke_kontrole', kontrolaTrzby: kT() }), VSE, m()).has('potvrdit_trzbu'))
  ok('tržba už zapsaná → bez potvrdit_trzbu, s opravit_trzbu', ((a) => !a.has('potvrdit_trzbu') && a.has('opravit_trzbu'))(S.dostupneAkce(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kT() }), VSE, m())))
  ok('zrušený záznam → žádná akce', S.dostupneAkce(zaznam({ stavKontroly: 'zruseno' }), VSE, m()).size === 0)
  ok('bez pokladny, zkontrolováno → kontrola_trzby ne, prohlasit_trzbu ano, odeslat_sklad ne, rucne_dolozit ANO (databáze dovolí doložit bez návrhu)', ((a) => !a.has('kontrola_trzby') && a.has('prohlasit_trzbu') && !a.has('odeslat_sklad') && a.has('rucne_dolozit'))(S.dostupneAkce(zaznam({ pripojeniId: null }), VSE, m({ maPokladnu: false }))))
  ok('bez pokladny, ale nezkontrolováno → rucne_dolozit ne', !S.dostupneAkce(zaznam({ pripojeniId: null, stavKontroly: 'ke_kontrole' }), VSE, m({ maPokladnu: false })).has('rucne_dolozit'))
  ok('bez pokladny, sklad už doložen → rucne_dolozit ne', !S.dostupneAkce(zaznam({ pripojeniId: null, stavSkladu: 'rucne_dolozeno' }), VSE, m({ maPokladnu: false })).has('rucne_dolozit'))
  ok('bez pokladny bez práva vydej_pos → rucne_dolozit ne', !S.dostupneAkce(zaznam({ pripojeniId: null }), new Set([...VSE].filter((p) => p !== 'jine_platby.vydej_pos')), m({ maPokladnu: false })).has('rucne_dolozit'))
  ok('stornovaná tržba jde zapsat znovu (potvrdit_trzbu s čerstvou kontrolou)', S.dostupneAkce(zaznam({ stavTrzby: 'stornovano', kontrolaTrzby: kT() }), VSE, m()).has('potvrdit_trzbu'))
  ok('potvrdit_trzbu ne bez kladné částky', !S.dostupneAkce(zaznam({ castkaHaleru: 0, kontrolaTrzby: kT() }), VSE, m()).has('potvrdit_trzbu'))
  const kSk = (o = {}) => ({ vysledek: 'neodecteno', zdroj: 'pos_api', verze: 3, kdy: pred(5), kdo: null, detail: {}, ...o })
  const schv = (o = {}, mm = {}) => S.dostupneAkce(zaznam({ stavSkladu: 'schvaleno', kontrolaSkladu: kSk(), ...o }), VSE, m({ maZiveNavrhSkladu: true, stavOperace: 'pripraveno', ...mm }))
  ok('provest_vydej: schváleno, připravená operace, čerstvá kontrola „neodečteno" → ano', schv().has('provest_vydej'))
  ok('provest_vydej ne, když operace už odchází', !schv({}, { stavOperace: 'odesila_se' }).has('provest_vydej'))
  ok('provest_vydej ne s kontrolou skladu 15 min starou (pos_operace_zahajit by odmítl)', !schv({ kontrolaSkladu: kSk({ kdy: pred(15) }) }).has('provest_vydej'))
  ok('provest_vydej ne, když kontrola říká „už odečteno"', !schv({ kontrolaSkladu: kSk({ vysledek: 'jiz_odecteno' }) }).has('provest_vydej'))
  ok('rucne_dolozit u schváleného návrhu s připravenou operací', schv().has('rucne_dolozit'))
  ok('rucne_dolozit ne bez schváleného návrhu (bez_navrhu)', !S.dostupneAkce(zaznam({ stavSkladu: 'bez_navrhu' }), VSE, m()).has('rucne_dolozit'))
  ok('propojit_vydej s čerstvým „pokladna už odečetla"', S.dostupneAkce(zaznam({ stavSkladu: 'bez_navrhu', kontrolaSkladu: kSk({ vysledek: 'jiz_odecteno' }) }), VSE, m()).has('propojit_vydej'))
  ok('propojit_vydej ne bez takové kontroly', !S.dostupneAkce(zaznam({ stavSkladu: 'bez_navrhu', kontrolaSkladu: kSk() }), VSE, m()).has('propojit_vydej'))
  ok('propojit_vydej ne při rozjetém požadavku', !S.dostupneAkce(zaznam({ stavSkladu: 'zpracovava_se', kontrolaSkladu: kSk({ vysledek: 'jiz_odecteno' }) }), VSE, m({ stavOperace: 'odesila_se' })).has('propojit_vydej'))
  ok('korekce_vydeje u odečteného, ne u „pokladna odečetla sama"', S.dostupneAkce(zaznam({ stavSkladu: 'odecteno_v_pos' }), VSE, m()).has('korekce_vydeje') && !S.dostupneAkce(zaznam({ stavSkladu: 'jiz_odecteno' }), VSE, m()).has('korekce_vydeje'))
  ok('nejasný výsledek → jen obnovit_vydej (ne provést, znovu, ručně ani propojit)', ((a) => a.has('obnovit_vydej') && !a.has('provest_vydej') && !a.has('vydej_znovu') && !a.has('rucne_dolozit') && !a.has('propojit_vydej'))(S.dostupneAkce(zaznam({ stavSkladu: 'nejasny_vysledek', kontrolaSkladu: { vysledek: 'jiz_odecteno', zdroj: 'pos_api', verze: 3, kdy: pred(1), kdo: null, detail: {} } }), VSE, m({ stavOperace: 'nejasny_vysledek', maZiveNavrhSkladu: true }))))
  ok('prokázaná chyba + čerstvá kontrola → vydej_znovu', S.dostupneAkce(zaznam({ stavSkladu: 'chyba', kontrolaSkladu: kSk() }), VSE, m({ stavOperace: 'chyba', maZiveNavrhSkladu: true })).has('vydej_znovu'))
  ok('chyba bez čerstvé kontroly → bez vydej_znovu', !S.dostupneAkce(zaznam({ stavSkladu: 'chyba' }), VSE, m({ stavOperace: 'chyba', maZiveNavrhSkladu: true })).has('vydej_znovu'))
  ok('zrušit nejde po zápisu tržby ani po zahájení výdeje', !S.dostupneAkce(zaznam({ stavTrzby: 'zapsano' }), VSE, m()).has('zrusit') && !S.dostupneAkce(zaznam({ stavSkladu: 'zpracovava_se' }), VSE, m({ stavOperace: 'odesila_se' })).has('zrusit') && !S.dostupneAkce(zaznam({ stavSkladu: 'odecteno_v_pos' }), VSE, m()).has('zrusit'))
  ok('zrušit jde u čerstvého záznamu', S.dostupneAkce(zaznam({ stavKontroly: 'rozpracovano' }), VSE, m()).has('zrusit'))
  ok('zrušit ne s propojenou fakturou', !S.dostupneAkce(zaznam({ stavFaktury: 'propojena' }), VSE, m()).has('zrusit'))
  ok('zrušit ne při požadavku na cestě', S.dostupneAkce(zaznam({ stavSkladu: 'chyba' }), VSE, m({ stavOperace: 'chyba' })).has('zrusit') && !S.dostupneAkce(zaznam({ stavSkladu: 'chyba' }), VSE, m({ stavOperace: 'nejasny_vysledek' })).has('zrusit'))
  const jenZadat = new Set(['jine_platby.zadat'])
  ok('autor jen s právem zadat smí zrušit svůj rozpracovaný záznam', S.dostupneAkce(zaznam({ vytvoril: 'u1' }), jenZadat, m({ uzivatelId: 'u1' })).has('zrusit'))
  ok('… ale ne cizí', !S.dostupneAkce(zaznam({ vytvoril: 'u2' }), jenZadat, m({ uzivatelId: 'u1' })).has('zrusit'))
  ok('… ani svůj, když návrh čeká na schválení', !S.dostupneAkce(zaznam({ vytvoril: 'u1', stavSkladu: 'ceka_na_schvaleni' }), jenZadat, m({ uzivatelId: 'u1' })).has('zrusit'))
  ok('upravit zůstává i po výdeji (ulozit_navrh odmítne jen změnu pro sklad nebo tržbu)', S.dostupneAkce(zaznam({ stavSkladu: 'odecteno_v_pos', stavTrzby: 'zapsano' }), VSE, m()).has('upravit'))
  ok('oznacit_zkontrolovano jen s částkou, měnou a datem', S.dostupneAkce(zaznam({ stavKontroly: 'ke_kontrole' }), VSE, m()).has('oznacit_zkontrolovano') && !S.dostupneAkce(zaznam({ stavKontroly: 'ke_kontrole', mena: null }), VSE, m()).has('oznacit_zkontrolovano'))
  ok('úhrada se nenabízí bez měny a bez úhrady (spárovat nejde, odpojit není co)', !S.dostupneAkce(zaznam({ mena: null }), VSE, m()).has('uhrada'))
  ok('úhrada jde i u uhrazeného (odpojení)', S.dostupneAkce(zaznam({ stavUhrady: 'uhrazeno' }), VSE, m()).has('uhrada'))

  // Zrušení záznamu: ne se zahájeným ručním výdejem a ne s napárovanou úhradou (databáze odmítne).
  ok('zrušit ne u „nepodporovano" (schváleno k ručnímu odpisu = zahájený výdej)', !S.dostupneAkce(zaznam({ stavSkladu: 'nepodporovano' }), VSE, m({ maZiveNavrhSkladu: true })).has('zrusit'))
  ok('zrušit ne s napárovanou úhradou (nejdřív odpojit)', !S.dostupneAkce(zaznam({ uhradaTransakceId: 't1', stavUhrady: 'uhrazeno' }), VSE, m()).has('zrusit'))
  ok('… ani autor svůj rozpracovaný s úhradou', !S.dostupneAkce(zaznam({ vytvoril: 'u1', uhradaTransakceId: 't1' }), jenZadat, m({ uzivatelId: 'u1' })).has('zrusit'))
  // N14: schválený výdej je zahájený (možná se právě ručně odepisuje) — zrušit záznam nejde, jen Zrušit schválení.
  ok('zrušit ne u schváleného výdeje (ani s připravenou operací, ani bez ní) — databáze ho odmítne',
    !S.dostupneAkce(zaznam({ stavSkladu: 'schvaleno' }), VSE, m({ stavOperace: 'pripraveno' })).has('zrusit') &&
      !S.dostupneAkce(zaznam({ stavSkladu: 'schvaleno' }), VSE, m({ stavOperace: null })).has('zrusit'))
  ok('… místo toho u schváleného zrusit_schvaleni', S.dostupneAkce(zaznam({ stavSkladu: 'schvaleno' }), VSE, m({ stavOperace: 'pripraveno', maZiveNavrhSkladu: true })).has('zrusit_schvaleni'))
  ok('zrušit dál jde u chyby a u čekajícího na schválení', S.dostupneAkce(zaznam({ stavSkladu: 'chyba' }), VSE, m({ stavOperace: 'chyba' })).has('zrusit') && S.dostupneAkce(zaznam({ stavSkladu: 'ceka_na_schvaleni' }), VSE, m()).has('zrusit'))

  // Zrušit schválení: jen vydej_pos, jen schvaleno / nepodporovano / chyba, operace ne na cestě ani hotová.
  const zs = (stavSkladu, stavOperace, prava = VSE) => S.dostupneAkce(zaznam({ stavSkladu }), prava, m({ stavOperace, maZiveNavrhSkladu: true })).has('zrusit_schvaleni')
  ok('zrusit_schvaleni: schvaleno + připravená operace → ano', zs('schvaleno', 'pripraveno'))
  ok('zrusit_schvaleni: nepodporovano (operace nepodporovano) → ano — jediná cesta, jak ho uvolnit', zs('nepodporovano', 'nepodporovano'))
  ok('zrusit_schvaleni: chyba + operace chyba → ano', zs('chyba', 'chyba'))
  ok('zrusit_schvaleni: schvaleno bez operace → ano', zs('schvaleno', null))
  ok('zrusit_schvaleni: operace odesila_se / nejasny_vysledek / uspech / rucne_dolozeno → ne',
    ['odesila_se', 'nejasny_vysledek', 'uspech', 'rucne_dolozeno'].every((op) => !zs('schvaleno', op) && !zs('nepodporovano', op) && !zs('chyba', op)))
  ok('zrusit_schvaleni: jiné stavy skladu → ne (ceka_na_schvaleni, bez_navrhu, odecteno_v_pos, rucne_dolozeno, nejasny_vysledek, zpracovava_se)',
    ['ceka_na_schvaleni', 'bez_navrhu', 'odecteno_v_pos', 'rucne_dolozeno', 'nejasny_vysledek', 'zpracovava_se', 'zamitnuto', 'nutna_kontrola'].every((st) => !zs(st, 'pripraveno')))
  ok('zrusit_schvaleni: jen s jine_platby.vydej_pos (s ním samotným ano, se všemi ostatními ne)',
    zs('schvaleno', 'pripraveno', new Set(['jine_platby.vydej_pos'])) && !zs('schvaleno', 'pripraveno', new Set([...VSE].filter((p) => p !== 'jine_platby.vydej_pos'))))
  ok('zrusit_schvaleni: s jine_platby.trzba ani s opravou ne', !zs('nepodporovano', 'nepodporovano', new Set(['jine_platby.trzba', 'jine_platby.oprava'])))
  ok('zrusit_schvaleni: zrušený záznam → ne', !S.dostupneAkce(zaznam({ stavKontroly: 'zruseno', stavSkladu: 'schvaleno' }), VSE, m({ stavOperace: 'pripraveno' })).has('zrusit_schvaleni'))

  // Dodatečná kontrola tržby po zápisu (jde volat i po něm) — jen s dohledáním účtů.
  const poZapisu = (o = {}, mm = {}, prava = VSE) => S.dostupneAkce(zaznam({ stavTrzby: 'zapsano', ...o }), prava, m({ dohledaniUctu: true, ...mm })).has('kontrola_trzby')
  ok('kontrola_trzby i po zápisu tržby (pokladna umí dohledat účty)', poZapisu())
  ok('… ne bez dohledání účtů (ruční prohlášení po zápisu nic neověří)', !poZapisu({}, { dohledaniUctu: false }) && !poZapisu({}, { dohledaniUctu: undefined }))
  ok('… ne bez pokladny', !poZapisu({ pripojeniId: null }, { maPokladnu: false }))
  ok('… ne bez práva jine_platby.trzba', !poZapisu({}, {}, new Set([...VSE].filter((p) => p !== 'jine_platby.trzba'))) && poZapisu({}, {}, new Set(['jine_platby.trzba'])))
  // Propojená tržba: kontrola ověří, že propojený KONKRÉTNÍ prodej v pokladně opravdu je (jinak moznaNikde).
  // Propojení bez konkrétního prodeje (posProdejId null) dodatečná kontrola ověřit neumí (R1, 20. 10.).
  const sProdejem = { stavTrzby: 'propojeno', posProdejId: 'ORDER-555' }
  ok('kontrola_trzby u propojené tržby s konkrétním prodejem (posProdejId, pokladna umí dohledat účty)', poZapisu(sProdejem))
  ok('… u propojené BEZ konkrétního prodeje ne (R1: shoda jen částky / otevřený účet — „nenalezeno" by byl falešný poplach)',
    !poZapisu({ stavTrzby: 'propojeno', posProdejId: null }))
  ok('… zapsaná tržba konkrétní prodej nepotřebuje (hledá se, jestli ho pokladna nemá)', poZapisu({ stavTrzby: 'zapsano', posProdejId: null }))
  ok('… u propojené s prodejem ne bez dohledání účtů, bez pokladny ani bez práva trzba',
    !poZapisu(sProdejem, { dohledaniUctu: false }) && !poZapisu({ ...sProdejem, pripojeniId: null }, { maPokladnu: false }) &&
      !poZapisu(sProdejem, {}, new Set([...VSE].filter((p) => p !== 'jine_platby.trzba'))))
  ok('… u propojené se prohlášení ani potvrzení tržby nenabízí', ((a) => !a.has('prohlasit_trzbu') && !a.has('potvrdit_trzbu'))(S.dostupneAkce(zaznam({ stavTrzby: 'propojeno', kontrolaTrzby: kT() }), VSE, m({ dohledaniUctu: true }))))
  ok('po zápisu se prohlášení ani potvrzení tržby nenabízí', ((a) => !a.has('prohlasit_trzbu') && !a.has('potvrdit_trzbu'))(S.dostupneAkce(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kT() }), VSE, m({ dohledaniUctu: true }))))

  // Možná zapsáno dvakrát.
  const kTv = (vysledek) => kT({ vysledek })
  ok('moznaDvakrat: zapsáno + kontrola „nalezeno" → ano', S.moznaDvakrat(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kTv('nalezeno') })))
  ok('moznaDvakrat: zapsáno + „pravdepodobne" → ano', S.moznaDvakrat(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kTv('pravdepodobne') })))
  ok('moznaDvakrat: zapsáno + „nenalezeno" / „nelze_overit" / bez kontroly → ne',
    !S.moznaDvakrat(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kTv('nenalezeno') })) && !S.moznaDvakrat(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: kTv('nelze_overit') })) &&
      !S.moznaDvakrat(zaznam({ stavTrzby: 'zapsano', kontrolaTrzby: null })))
  ok('moznaDvakrat: „nalezeno" bez zapsané tržby (nezapsano, propojeno, stornovano) → ne',
    ['nezapsano', 'propojeno', 'stornovano'].every((st) => !S.moznaDvakrat(zaznam({ stavTrzby: st, kontrolaTrzby: kTv('nalezeno') }))))

  // Možná nezapočítáno nikde: propojeno s KONKRÉTNÍM prodejem (posProdejId), ale pokladna (dotaz, ne
  // ruční prohlášení) ho nenašla. Bez posProdejId nikdy (R1); verze se neporovnává (hledá se tentýž prodej).
  const nikde = (o = {}) => S.moznaNikde(zaznam({ stavTrzby: 'propojeno', posProdejId: 'ORDER-555', kontrolaTrzby: kTv('nenalezeno'), ...o }))
  ok('moznaNikde: propojeno s prodejem (posProdejId) + pos_api „nenalezeno" → ano', nikde())
  ok('moznaNikde: propojení BEZ konkrétního prodeje (posProdejId null) → ne (R1: falešný poplach po shodě částky / dorostlém účtu)', !nikde({ posProdejId: null }))
  ok('moznaNikde: kontrola ke starší verzi záznamu → pořád ano (prodej je tentýž, uložení návrhu verzi zvedne i bez změny)',
    nikde({ kontrolaTrzby: kT({ vysledek: 'nenalezeno', verze: 2 }) }) && nikde({ verze: 9, kontrolaTrzby: kT({ vysledek: 'nenalezeno', verze: 1 }) }))
  ok('moznaNikde: ruční prohlášení „nenalezeno" → ne (propojení bez nálezu chtělo důvod)', !nikde({ kontrolaTrzby: kT({ vysledek: 'nenalezeno', zdroj: 'rucni_prohlaseni' }) }))
  ok('moznaNikde: propojeno + „nalezeno" / „pravdepodobne" / „nelze_overit" / bez kontroly → ne',
    ['nalezeno', 'pravdepodobne', 'nelze_overit'].every((v) => !nikde({ kontrolaTrzby: kTv(v) })) && !nikde({ kontrolaTrzby: null }))
  ok('moznaNikde: „nenalezeno" u jiného stavu tržby (nezapsano, zapsano, stornovano) → ne',
    ['nezapsano', 'zapsano', 'stornovano'].every((st) => !nikde({ stavTrzby: st })))

  // Ruční prohlášení proti výsledku z pokladny (jine_platby_prohlasit, P1 z 20. 10.): poslední výsledek
  // DOTAZU DO POKLADNY (pokladnaTrzby / pokladnaSkladu — ruční prohlášení ho nepřepíše) brání BEZ OHLEDU
  // NA VERZI (C1/R2: uložení návrhu verzi zvedne i bez změny).
  const kSkl = (o = {}) => ({ vysledek: 'jiz_odecteno', zdroj: 'pos_api', verze: 3, kdy: pred(5), kdo: null, detail: {}, ...o })
  const kCastka = (o = {}) => kT({ vysledek: 'pravdepodobne', detail: { shoda: 'castka' }, ...o })
  const pp = (z, druh) => JSON.stringify(S.prohlaseniProtiPokladne(z, druh))
  ok('prohlaseniProtiPokladne trzba: pokladna „nalezeno" → { nalezeno, chceOpravu: true } (konkrétní prodej přepíše jen oprava)',
    pp(zaznam({ pokladnaTrzby: kTv('nalezeno') }), 'trzba') === JSON.stringify({ vysledek: 'nalezeno', chceOpravu: true }))
  ok('prohlaseniProtiPokladne trzba: pokladna „pravdepodobne" ze shody JEN ČÁSTKY → { pravdepodobne, chceOpravu: false } (stačí výslovné potvrzení)',
    pp(zaznam({ pokladnaTrzby: kCastka() }), 'trzba') === JSON.stringify({ vysledek: 'pravdepodobne', chceOpravu: false }))
  ok('prohlaseniProtiPokladne trzba: „pravdepodobne" ze shody ČÍSLA ÚČTU (cislo_vice) → chceOpravu: true (konkrétní stopa jako „nalezeno")',
    pp(zaznam({ pokladnaTrzby: kT({ vysledek: 'pravdepodobne', detail: { shoda: 'cislo_vice' } }) }), 'trzba') === JSON.stringify({ vysledek: 'pravdepodobne', chceOpravu: true }))
  ok('prohlaseniProtiPokladne trzba: „pravdepodobne" bez uvedené shody → chceOpravu: true (bez dokladu o shodě jen částky přísněji)',
    pp(zaznam({ pokladnaTrzby: kTv('pravdepodobne') }), 'trzba') === JSON.stringify({ vysledek: 'pravdepodobne', chceOpravu: true }))
  ok('prohlaseniProtiPokladne trzba: výsledek pokladny ke STARŠÍ verzi (návrh mezitím uložen) brání dál — obejití z C1 zavřené',
    pp(zaznam({ verze: 4, pokladnaTrzby: kT({ vysledek: 'nalezeno', verze: 3 }) }), 'trzba') === JSON.stringify({ vysledek: 'nalezeno', chceOpravu: true }) &&
      pp(zaznam({ verze: 9, pokladnaTrzby: kCastka({ verze: 1 }) }), 'trzba') === JSON.stringify({ vysledek: 'pravdepodobne', chceOpravu: false }))
  ok('prohlaseniProtiPokladne trzba: pokladna „nenalezeno" / „nelze_overit" / bez dotazu do pokladny → null',
    S.prohlaseniProtiPokladne(zaznam({ pokladnaTrzby: kTv('nenalezeno') }), 'trzba') === null && S.prohlaseniProtiPokladne(zaznam({ pokladnaTrzby: kTv('nelze_overit') }), 'trzba') === null &&
      S.prohlaseniProtiPokladne(zaznam({ pokladnaTrzby: null }), 'trzba') === null)
  ok('prohlaseniProtiPokladne trzba: jen ruční prohlášení „nalezeno", pokladna se neptala → null (to přepsat jde)',
    S.prohlaseniProtiPokladne(zaznam({ kontrolaTrzby: kT({ vysledek: 'nalezeno', zdroj: 'rucni_prohlaseni' }), pokladnaTrzby: null }), 'trzba') === null)
  ok('prohlaseniProtiPokladne trzba: pokladna „nalezeno" a POTOM ruční „je" (poslední kontrola je ruční) → brání dál (výsledek pokladny se nevypere)',
    pp(zaznam({ kontrolaTrzby: kT({ vysledek: 'nalezeno', zdroj: 'rucni_prohlaseni' }), pokladnaTrzby: kTv('nalezeno') }), 'trzba') === JSON.stringify({ vysledek: 'nalezeno', chceOpravu: true }))
  ok('prohlaseniProtiPokladne trzba: poslední kontrola z pokladny bez sloupce pokladny → null (pojistka čte jen pokladnaTrzby)',
    S.prohlaseniProtiPokladne(zaznam({ kontrolaTrzby: kTv('nalezeno'), pokladnaTrzby: null }), 'trzba') === null)
  ok('prohlaseniProtiPokladne sklad: pokladna „jiz_odecteno" (i ke starší verzi) → { jiz_odecteno, chceOpravu: true }',
    pp(zaznam({ pokladnaSkladu: kSkl() }), 'sklad') === JSON.stringify({ vysledek: 'jiz_odecteno', chceOpravu: true }) &&
      pp(zaznam({ verze: 5, pokladnaSkladu: kSkl({ verze: 2 }) }), 'sklad') === JSON.stringify({ vysledek: 'jiz_odecteno', chceOpravu: true }))
  ok('prohlaseniProtiPokladne sklad: pokladna „už odečteno" a POTOM ruční „už odečteno" → brání dál',
    pp(zaznam({ kontrolaSkladu: kSkl({ zdroj: 'rucni_prohlaseni' }), pokladnaSkladu: kSkl() }), 'sklad') === JSON.stringify({ vysledek: 'jiz_odecteno', chceOpravu: true }))
  ok('prohlaseniProtiPokladne sklad: „neodecteno", „nelze_zjistit", jen ruční, bez dotazu do pokladny → null',
    S.prohlaseniProtiPokladne(zaznam({ pokladnaSkladu: kSkl({ vysledek: 'neodecteno' }) }), 'sklad') === null &&
      S.prohlaseniProtiPokladne(zaznam({ pokladnaSkladu: kSkl({ vysledek: 'nelze_zjistit' }) }), 'sklad') === null &&
      S.prohlaseniProtiPokladne(zaznam({ kontrolaSkladu: kSkl({ zdroj: 'rucni_prohlaseni' }) }), 'sklad') === null &&
      S.prohlaseniProtiPokladne(zaznam({ pokladnaSkladu: null }), 'sklad') === null)
  ok('prohlaseniProtiPokladne: druhy se nepletou (výsledek skladu nebrání prohlášení tržby a naopak)',
    S.prohlaseniProtiPokladne(zaznam({ pokladnaSkladu: kSkl() }), 'trzba') === null && S.prohlaseniProtiPokladne(zaznam({ pokladnaTrzby: kTv('nalezeno') }), 'sklad') === null)

  // Konkrétní nález pokladny (migrace 20261021100000, ověření 21. 10.).
  const kPr = { kdo: 'U9', kdy: pred(1), vysledek: 'nenalezeno', duvod: 'Jiný host, ověřeno' }
  ok('nalezPokladny tržba: „nalezeno", „pravdepodobne" se shodou čísla účtu i bez uvedené shody → ano; shoda jen částky → ne',
    S.nalezPokladny(kTv('nalezeno'), 'trzba') && S.nalezPokladny(kT({ vysledek: 'pravdepodobne', detail: { shoda: 'cislo_vice' } }), 'trzba') &&
      S.nalezPokladny(kTv('pravdepodobne'), 'trzba') && !S.nalezPokladny(kCastka(), 'trzba'))
  ok('nalezPokladny: „nenalezeno", „nelze_overit", ruční prohlášení, se značkou přepisu, null → ne',
    !S.nalezPokladny(kTv('nenalezeno'), 'trzba') && !S.nalezPokladny(kTv('nelze_overit'), 'trzba') &&
      !S.nalezPokladny(kT({ vysledek: 'nalezeno', zdroj: 'rucni_prohlaseni' }), 'trzba') && !S.nalezPokladny(kT({ vysledek: 'nalezeno', prepsano: kPr }), 'trzba') &&
      !S.nalezPokladny(null, 'trzba'))
  ok('nalezPokladny sklad: jen „jiz_odecteno" z pokladny bez značky přepisu',
    S.nalezPokladny(kSkl(), 'sklad') && !S.nalezPokladny(kSkl({ vysledek: 'neodecteno' }), 'sklad') && !S.nalezPokladny(kSkl({ prepsano: kPr }), 'sklad') &&
      !S.nalezPokladny(kTv('nalezeno'), 'sklad'))
  ok('prohlaseniProtiPokladne: výsledek se značkou přepisu (rozhodl člověk) nebrání — tržba i sklad (falešná blokace, ověření 21. 10.)',
    S.prohlaseniProtiPokladne(zaznam({ pokladnaTrzby: kT({ vysledek: 'nalezeno', prepsano: kPr }) }), 'trzba') === null &&
      S.prohlaseniProtiPokladne(zaznam({ pokladnaSkladu: kSkl({ prepsano: kPr }) }), 'sklad') === null)
  const cestaB = zaznam({ kontrolaTrzby: kT({ vysledek: 'nenalezeno', kdy: pred(1) }), pokladnaTrzby: kT({ vysledek: 'nalezeno', detail: { pos_prodej_id: 'POS-B7' } }) })
  ok('cesta B: čerstvá kontrola „nenalezeno" proti nálezu pokladny → bez potvrdit_trzbu (nová tržba ne, propojit není s čím)', !S.dostupneAkce(cestaB, VSE, m()).has('potvrdit_trzbu'))
  ok('cesta B (protipříklad): nález se značkou přepisu, nebo žádný nález → potvrdit_trzbu je',
    S.dostupneAkce({ ...cestaB, pokladnaTrzby: { ...cestaB.pokladnaTrzby, prepsano: kPr } }, VSE, m()).has('potvrdit_trzbu') &&
      S.dostupneAkce({ ...cestaB, pokladnaTrzby: null }, VSE, m()).has('potvrdit_trzbu'))
  ok('cesta B (protipříklad): „pravděpodobně" (jen propojit) proti nálezu → potvrdit_trzbu je',
    S.dostupneAkce({ ...cestaB, kontrolaTrzby: kT({ vysledek: 'pravdepodobne', kdy: pred(1), detail: { shoda: 'castka' } }) }, VSE, m()).has('potvrdit_trzbu'))
  const odecteno = { pokladnaSkladu: kSkl({ detail: { zdroj_shody: 'prodej', externi_id: 'POS-S8' } }) }
  ok('cesta B sklad: „už odečteno" z pokladny + novější „neodečteno" → bez provest_vydej a vydej_znovu',
    !schv(odecteno).has('provest_vydej') &&
      !S.dostupneAkce(zaznam({ stavSkladu: 'chyba', kontrolaSkladu: kSk(), ...odecteno }), VSE, m({ stavOperace: 'chyba', maZiveNavrhSkladu: true })).has('vydej_znovu'))
  ok('cesta B sklad (protipříklad): se značkou přepisu provest_vydej i vydej_znovu jsou',
    schv({ pokladnaSkladu: kSkl({ prepsano: kPr }) }).has('provest_vydej') &&
      S.dostupneAkce(zaznam({ stavSkladu: 'chyba', kontrolaSkladu: kSk(), pokladnaSkladu: kSkl({ prepsano: kPr }) }), VSE, m({ stavOperace: 'chyba', maZiveNavrhSkladu: true })).has('vydej_znovu'))
  // Cesta C (čtvrté ověření 22. 10.): zrušení záznamu s nálezem nebo značkou jen s právem na opravy.
  const NEDOH = { operace: 'OP1', klic: 'ftjp-op1', stav: 'nejasny_vysledek', kdy: pred(30) }
  const bezOpravy = new Set([...VSE].filter((p) => p !== 'jine_platby.oprava'))
  const jakoAutor = (o) => S.dostupneAkce(zaznam({ vytvoril: 'U1', ...o }), bezOpravy, m({ uzivatelId: 'U1' }))
  ok('zruseniChceOpravu: nález tržby, nález skladu, nedohledaný požadavek → ano; slabý výsledek, se značkou přepisu, nic → ne',
    S.zruseniChceOpravu(zaznam({ pokladnaTrzby: kTv('nalezeno') })) && S.zruseniChceOpravu(zaznam({ pokladnaSkladu: kSkl() })) &&
      S.zruseniChceOpravu(zaznam({ nedohledanaOperace: NEDOH })) && !S.zruseniChceOpravu(zaznam({ pokladnaTrzby: kCastka() })) &&
      !S.zruseniChceOpravu(zaznam({ pokladnaTrzby: kT({ vysledek: 'nalezeno', prepsano: kPr }) })) && !S.zruseniChceOpravu(zaznam({})))
  ok('cesta C: autor bez práva na opravy — „Zrušit“ ne u nálezu tržby, nálezu skladu ani nedohledaného požadavku',
    !jakoAutor({ pokladnaTrzby: kTv('nalezeno') }).has('zrusit') && !jakoAutor({ pokladnaSkladu: kSkl() }).has('zrusit') &&
      !jakoAutor({ nedohledanaOperace: NEDOH }).has('zrusit'))
  ok('cesta C (protipříklad): autor bez nálezu „Zrušit“ má; s právem na opravy i s nálezem',
    jakoAutor({}).has('zrusit') && jakoAutor({ pokladnaTrzby: kCastka() }).has('zrusit') &&
      S.dostupneAkce(zaznam({ pokladnaTrzby: kTv('nalezeno'), nedohledanaOperace: NEDOH }), VSE, m()).has('zrusit'))
  const kSchvaleni = zaznam({ stavSkladu: 'ceka_na_schvaleni', kontrolaSkladu: kSk() })
  ok('muzeSchvalitVydej: „neodečteno" ano, ale ne proti nálezu „už odečteno"; se značkou přepisu zase ano',
    S.muzeSchvalitVydej(kSchvaleni, TED) && !S.muzeSchvalitVydej({ ...kSchvaleni, ...odecteno }, TED) &&
      S.muzeSchvalitVydej({ ...kSchvaleni, pokladnaSkladu: kSkl({ prepsano: kPr }) }, TED))
  {
    // Zrcadlo = databáze: pojistka v jine_platby_prohlasit nestojí na verzi a „pravděpodobně" nechce právo na opravy.
    const sqlP = textMigrace()
    const telo = teloFunkce(sqlP, 'public.jine_platby_prohlasit')
    const prepis = /v_prepis := ([\s\S]*?);\n/.exec(telo)?.[1] ?? ''
    ok('(migrace: podmínku v_prepis v jine_platby_prohlasit se podařilo najít)', prepis.length > 50)
    ok('… v_prepis nestojí na verzi a brání týmiž výsledky jako zrcadlo (trzba nalezeno/pravdepodobne, sklad jiz_odecteno)',
      !/verze/.test(prepis) && /'vysledek' in \('nalezeno', 'pravdepodobne'\)/.test(prepis) && /'vysledek' = 'jiz_odecteno'/.test(prepis) && /'zdroj' = 'pos_api'/.test(prepis))
    ok('… bez práva na opravy jen „pravdepodobne" ze shody samotné částky (chceOpravu = app.jp_nalez_pokladny, bez NULL)',
      /if app\.jp_nalez_pokladny\(v_stara, p_druh\)\s+and not app\.has_access\(v_z\.tenant_id, 'jine_platby\.oprava'/.test(telo))
    ok('… výsledek se značkou přepisu nebrání (zrcadlo: `prepsano` → null)', /v_prepis := v_stara ->> 'zdroj' = 'pos_api' and not \(v_stara \? 'prepsano'\)/.test(telo))
    const nalezSql = /create function app\.jp_nalez_pokladny\(p_k jsonb, p_druh text\)[\s\S]*?\$\$;/.exec(textOpravy())?.[0] ?? ''
    ok('nalezPokladny = app.jp_nalez_pokladny: pos_api bez prepsano; tržba nalezeno, nebo pravdepodobne se shodou jinou než castka (i bez shody); sklad jiz_odecteno',
      /p_k ->> 'zdroj' = 'pos_api' and not \(p_k \? 'prepsano'\)/.test(nalezSql) &&
        /when 'trzba' then p_k ->> 'vysledek' = 'nalezeno'\s+or \(p_k ->> 'vysledek' = 'pravdepodobne' and coalesce\(p_k -> 'detail' ->> 'shoda', ''\) <> 'castka'\)/.test(nalezSql) &&
        /when 'sklad' then p_k ->> 'vysledek' = 'jiz_odecteno'/.test(nalezSql) && /^\s*select coalesce\(/m.test(nalezSql))
    ok('… pojistka čte poslední výsledek POKLADNY (pokladna_trzby / pokladna_skladu), ne poslední kontrolu',
      /v_stara := case when p_druh = 'trzba' then v_z\.pokladna_trzby else v_z\.pokladna_skladu end;/.test(telo))
    const teloK = teloFunkce(sqlP, 'public.jine_platby_zapsat_kontrolu')
    const oprava = textOpravy()
    ok('… sloupce pokladna_* píše kontrola v pokladně; ruční prohlášení jen značku přepisu (nikdy výsledek), nikde nic jiného',
      /kontrola_trzby = v_k, pokladna_trzby = v_pokladna/.test(teloK) && /kontrola_skladu = v_k, pokladna_skladu = v_pokladna/.test(teloK) &&
        /pokladna_trzby = case when v_znacka is null then pokladna_trzby else pokladna_trzby \|\| jsonb_build_object\('prepsano', v_znacka\) end/.test(telo) &&
        /pokladna_skladu = case when v_znacka is null then pokladna_skladu else pokladna_skladu \|\| jsonb_build_object\('prepsano', v_znacka\) end/.test(telo) &&
        (oprava.match(/pokladna_(trzby|skladu) = /g) ?? []).length === 4)
    ok('… konkrétní nález slabší výsledek nepřepíše (zapsat_kontrolu: ponechat v_stara, když nový nález není)',
      /if app\.jp_nalez_pokladny\(v_stara, p_druh\) and not app\.jp_nalez_pokladny\(v_k, p_druh\) then\s+v_pokladna := v_stara;/.test(teloK))
    ok('… nová tržba, schválení, opakování i zahájení výdeje stojí na tomtéž nálezu (zrcadlo dostupneAkce / muzeSchvalitVydej)',
      /if app\.jp_nalez_pokladny\(v_z\.pokladna_trzby, 'trzba'\) then/.test(teloFunkce(sqlP, 'public.jine_platby_potvrdit_trzbu')) &&
        ['public.jine_platby_rozhodnout_vydej', 'public.jine_platby_vydej_znovu', 'public.pos_operace_zahajit'].every((f) =>
          /if app\.jp_nalez_pokladny\(v_z\.pokladna_skladu, 'sklad'\) then/.test(teloFunkce(sqlP, f))))
    const zdrojeSql = /v_t\.zdroj not in \(([^)]*)\)/.exec(teloFunkce(sqlP, 'public.jine_platby_evidovat_uhradu'))?.[1] ?? ''
    ok(`ZDROJE_UHRADY = zdroje v jine_platby_evidovat_uhradu (${zdrojeSql || '?'})`,
      JSON.stringify([...zdrojeSql.matchAll(/'(\w+)'/g)].map((x) => x[1])) === JSON.stringify([...T.ZDROJE_UHRADY]) && T.ZDROJE_UHRADY.length === 3)
    ok('cesta C: nová tržba a schválení výdeje hlídají i jiné záznamy téhož dokladu nebo prodeje (app.jp_souvisejici: fotka, nebo pobočka + den + částka + měna)',
      /if exists \(select 1 from app\.jp_souvisejici\(v_z\) s where app\.jp_nalez_pokladny\(s\.pokladna_trzby, 'trzba'\)\)/.test(teloFunkce(sqlP, 'public.jine_platby_potvrdit_trzbu')) &&
        /where s\.nedohledana_operace is not null or app\.jp_nalez_pokladny\(s\.pokladna_skladu, 'sklad'\)/.test(teloFunkce(sqlP, 'public.jine_platby_rozhodnout_vydej')) &&
        /s\.branch_id = p_z\.branch_id and s\.datum_prodeje = p_z\.datum_prodeje\s+and s\.castka_haleru = p_z\.castka_haleru and s\.mena = p_z\.mena/.test(textOpravy()) &&
        /b\.otisk = a\.otisk/.test(textOpravy()))
    ok('cesta C: zrušení = zruseniChceOpravu (nález tržby, nález skladu, nedohledaný požadavek) bez práva na opravy odmítne',
      /if \(app\.jp_nalez_pokladny\(v_z\.pokladna_trzby, 'trzba'\) or app\.jp_nalez_pokladny\(v_z\.pokladna_skladu, 'sklad'\)\s+or v_z\.nedohledana_operace is not null\)\s+and not app\.has_access\(v_z\.tenant_id, 'jine_platby\.oprava'/.test(teloFunkce(sqlP, 'public.jine_platby_zrusit')))
    ok('… zrušený požadavek s nejasným výsledkem: ruční „neodečteno“ jen s právem na opravy, stejná hláška jako akce',
      /p_druh = 'sklad' and p_vysledek = 'neodecteno' and v_z\.nedohledana_operace is not null/.test(telo) &&
        telo.includes('Zrušený požadavek do pokladny měl nejasný výsledek a nikdo ho nedohledal. Nejdřív zkontrolujte výdej v pokladně (dohledá i ten požadavek) — ručně „neodečteno“ smí doložit jen člověk s právem na opravy.') &&
        cist(new URL('../app/[rozsah]/finance/trzby/jine-platby/akce.ts', import.meta.url)).includes(
          "'Zrušený požadavek do pokladny měl nejasný výsledek a nikdo ho nedohledal. Nejdřív zkontrolujte výdej v pokladně (dohledá i ten požadavek) — ručně „neodečteno“ smí doložit jen člověk s právem na opravy.'"))
  }

  // Rozpoznání AI (P5, C9/R3): zapsaná nebo propojená tržba čtení NEBRÁNÍ; schválený nebo provedený výdej ano.
  const rozp = (o) => S.dostupneAkce(zaznam(o), VSE, m()).has('rozpoznat')
  ok('rozpoznat: u každého stavu tržby (i zapsané a propojené — položky pro sklad) ano',
    T.STAVY_TRZBY.every((stavTrzby) => rozp({ stavTrzby })) && rozp({ stavTrzby: 'zapsano' }) && rozp({ stavTrzby: 'propojeno' }))
  const SKLAD_BEZ_CTENI = ['schvaleno', 'nepodporovano', 'zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno']
  ok('rozpoznat: ne ve schváleném nebo provedeném výdeji (schvaleno, nepodporovano, zpracovava_se, nejasny_vysledek, odecteno_v_pos, jiz_odecteno, rucne_dolozeno, opraveno)',
    SKLAD_BEZ_CTENI.every((stavSkladu) => !rozp({ stavSkladu }) && !rozp({ stavSkladu, stavTrzby: 'zapsano' })))
  ok('rozpoznat: ve zbylých stavech skladu ano (bez_navrhu, nevyzaduje, ceka_na_schvaleni, zamitnuto, chyba, nutna_kontrola)',
    T.STAVY_SKLADU.filter((st) => !SKLAD_BEZ_CTENI.includes(st)).every((stavSkladu) => rozp({ stavSkladu })) &&
      T.STAVY_SKLADU.filter((st) => !SKLAD_BEZ_CTENI.includes(st)).length === 6)
  {
    const sqlR = textMigrace()
    const telo = teloFunkce(sqlR, 'public.jine_platby_zahajit_rozpoznani')
    const vMigraci = [...(/v_z\.stav_skladu in \(([^)]*)\)/.exec(telo)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1]).sort()
    const vZrcadle = T.STAVY_SKLADU.filter((stavSkladu) => !rozp({ stavSkladu })).sort()
    ok(`rozpoznat: stavy bez čtení = jine_platby_zahajit_rozpoznani v migraci (${vMigraci.join(', ') || '?'})`,
      vMigraci.length === 8 && JSON.stringify(vMigraci) === JSON.stringify(vZrcadle))
    ok('… a zapsaná tržba v zahajit_rozpoznani nic neodmítá (žádné stav_trzby)', telo.length > 200 && !/stav_trzby/.test(telo))
  }
  ok('… nahrát doklad jde i u zapsané tržby (pripojit_soubor hlídá jen zrušení)', S.dostupneAkce(zaznam({ stavTrzby: 'zapsano' }), VSE, m()).has('nahrat'))

  // Ruční východ z operace na cestě po vypršení platnosti (P3, C5): rucne_dolozit a zrusit_schvaleni.
  ok('platnostOperaceVyprsela: platnost + 2 min < teď → ano; přesně na hranici, dřív, z budoucnosti → ne',
    S.platnostOperaceVyprsela(pred(3), TED) && S.platnostOperaceVyprsela(pred(2.01), TED) && !S.platnostOperaceVyprsela(pred(2), TED) &&
      !S.platnostOperaceVyprsela(pred(1), TED) && !S.platnostOperaceVyprsela(pred(-5), TED))
  ok('platnostOperaceVyprsela: bez platnosti (undefined, null) nebo nečitelná → ne (databáze při platnost_do null taky odmítne)',
    !S.platnostOperaceVyprsela(undefined, TED) && !S.platnostOperaceVyprsela(null, TED) && !S.platnostOperaceVyprsela('včera', TED))
  const vychod = (stavSkladu, stavOperace, platnostOperace, o = {}) =>
    S.dostupneAkce(zaznam({ stavSkladu }), o.prava ?? VSE, m({ stavOperace, platnostOperace, maZiveNavrhSkladu: o.ziva ?? true }))
  ok('nejasný výsledek, platnost + 2 min pryč → rucne_dolozit i zrusit_schvaleni (a obnovit_vydej dál)',
    ((a) => a.has('rucne_dolozit') && a.has('zrusit_schvaleni') && a.has('obnovit_vydej'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pred(3))))
  ok('odesílání (zpracovava_se + odesila_se) po platnosti → rucne_dolozit i zrusit_schvaleni',
    ((a) => a.has('rucne_dolozit') && a.has('zrusit_schvaleni'))(vychod('zpracovava_se', 'odesila_se', pred(10))))
  ok('schváleno s operací odesila_se po platnosti → taky (databáze stav skladu u doložení nečte)',
    ((a) => a.has('rucne_dolozit') && a.has('zrusit_schvaleni'))(vychod('schvaleno', 'odesila_se', pred(3))))
  ok('PŘED vypršením (platnost za 3 min, přesně na hranici) → ani jedno, jen obnovit_vydej',
    [pred(-3), pred(1), pred(2)].every((pl) => ((a) => !a.has('rucne_dolozit') && !a.has('zrusit_schvaleni') && a.has('obnovit_vydej'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pl))))
  ok('bez platnostOperace (nezadaná, null, nečitelná) → ani jedno', [undefined, null, 'nevím'].every((pl) => ((a) => !a.has('rucne_dolozit') && !a.has('zrusit_schvaleni'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pl))))
  ok('po platnosti: rucne_dolozit chce živý (schválený) návrh, zrusit_schvaleni ne (databáze ho tu nechce)',
    ((a) => !a.has('rucne_dolozit') && a.has('zrusit_schvaleni'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pred(3), { ziva: false })))
  ok('po platnosti: jen s jine_platby.vydej_pos (s ním samotným ano, se všemi ostatními ne)',
    ((a) => a.has('rucne_dolozit') && a.has('zrusit_schvaleni'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pred(3), { prava: new Set(['jine_platby.vydej_pos']) })) &&
      ((a) => !a.has('rucne_dolozit') && !a.has('zrusit_schvaleni'))(vychod('nejasny_vysledek', 'nejasny_vysledek', pred(3), { prava: new Set([...VSE].filter((p) => p !== 'jine_platby.vydej_pos')) })))
  ok('po platnosti: propojit_vydej ani zrušení záznamu ne (ty databáze dál odmítá)',
    ((a) => !a.has('propojit_vydej') && !a.has('zrusit'))(S.dostupneAkce(zaznam({ stavSkladu: 'nejasny_vysledek', kontrolaSkladu: kSk({ vysledek: 'jiz_odecteno' }) }), VSE, m({ stavOperace: 'nejasny_vysledek', platnostOperace: pred(3), maZiveNavrhSkladu: true }))))
  ok('hotový výdej (uspech, rucne_dolozeno) ani s propadlou platností nic z toho nedostane',
    ['uspech', 'rucne_dolozeno'].every((op) => ((a) => !a.has('rucne_dolozit') && !a.has('zrusit_schvaleni'))(vychod('schvaleno', op, pred(3)))))
  ok('jiné stavy skladu s propadlou operací (odecteno_v_pos, bez_navrhu, nutna_kontrola) → ne',
    ['odecteno_v_pos', 'bez_navrhu', 'nutna_kontrola', 'ceka_na_schvaleni'].every((st) => ((a) => !a.has('rucne_dolozit') && !a.has('zrusit_schvaleni'))(vychod(st, 'nejasny_vysledek', pred(3)))))
  {
    const sqlV = textMigrace()
    const teloFce = (jmeno) => teloFunkce(sqlV, `public.${jmeno}`)
    const hranice = /v_op\.stav in \('odesila_se', 'nejasny_vysledek'\)\s+and \(v_op\.platnost_do is null or v_op\.platnost_do \+ interval '2 minutes' > now\(\)\)/
    ok(`rezerva zrcadla (REZERVA_PO_PLATNOSTI_MS = ${O.REZERVA_PO_PLATNOSTI_MS} ms) = 2 min v jine_platby_rucne_dolozit_vydej i jine_platby_zrusit_schvaleni`,
      O.REZERVA_PO_PLATNOSTI_MS === 120_000 && hranice.test(teloFce('jine_platby_rucne_dolozit_vydej')) && hranice.test(teloFce('jine_platby_zrusit_schvaleni')))
    ok('… a zrušit schválení v databázi přijme i zpracovava_se / nejasny_vysledek',
      /v_z\.stav_skladu not in \('schvaleno', 'nepodporovano', 'chyba', 'zpracovava_se', 'nejasny_vysledek'\)/.test(teloFce('jine_platby_zrusit_schvaleni')))
  }

  // Úhrada u zrušeného záznamu ne (N4: evidovat_uhradu zrušený záznam odmítne) — ani s napárovanou úhradou.
  ok('uhrada ne u zrušeného záznamu (ani když má úhradu napárovanou)',
    !S.dostupneAkce(zaznam({ stavKontroly: 'zruseno' }), VSE, m()).has('uhrada') &&
      !S.dostupneAkce(zaznam({ stavKontroly: 'zruseno', uhradaTransakceId: 't1', stavUhrady: 'uhrazeno' }), VSE, m()).has('uhrada') &&
      S.dostupneAkce(zaznam({ stavKontroly: 'ke_kontrole' }), VSE, m()).has('uhrada'))

  // Oddělení práv napříč všemi kombinacemi stavů.
  const TRZBA_AKCE = ['kontrola_trzby', 'prohlasit_trzbu', 'potvrdit_trzbu']
  const SKLAD_AKCE = ['odeslat_sklad', 'kontrola_skladu', 'prohlasit_sklad', 'rozhodnout_vydej', 'provest_vydej', 'obnovit_vydej', 'vydej_znovu', 'propojit_vydej', 'rucne_dolozit', 'korekce_vydeje', 'zrusit_schvaleni']
  const PRAVO_AKCE = {
    nahrat: ['jine_platby.zadat', 'jine_platby.upravit'], rozpoznat: ['jine_platby.zadat', 'jine_platby.upravit'], upravit: ['jine_platby.upravit'],
    oznacit_zkontrolovano: ['jine_platby.upravit'], kontrola_trzby: ['jine_platby.trzba'], prohlasit_trzbu: ['jine_platby.trzba'], potvrdit_trzbu: ['jine_platby.trzba'],
    odeslat_sklad: ['jine_platby.sklad_odeslat'], kontrola_skladu: ['jine_platby.vydej_pos'], prohlasit_sklad: ['jine_platby.vydej_pos'], rozhodnout_vydej: ['jine_platby.vydej_pos'],
    provest_vydej: ['jine_platby.vydej_pos'], obnovit_vydej: ['jine_platby.vydej_pos'], vydej_znovu: ['jine_platby.vydej_pos'], propojit_vydej: ['jine_platby.vydej_pos'],
    rucne_dolozit: ['jine_platby.vydej_pos'], faktura: ['jine_platby.faktura'], uhrada: ['jine_platby.faktura'], opravit_trzbu: ['jine_platby.oprava'],
    korekce_vydeje: ['jine_platby.oprava+jine_platby.vydej_pos'], zrusit: ['jine_platby.oprava'], zrusit_schvaleni: ['jine_platby.vydej_pos'],
  }
  // Síť (20. 10.): přibyla operace `odesila_se`, platnost operace (nezadaná / propadlá / budoucí — P3)
  // a konkrétní prodej u propojené tržby (posProdejId — R1). Platnost se mění jen u operace na cestě
  // a posProdejId jen u propojené tržby — jinde by kombinace jen opakovaly totéž.
  const NA_CESTE = ['odesila_se', 'nejasny_vysledek']
  const kombinace = []
  for (const stavKontroly of T.STAVY_KONTROLY)
    for (const stavTrzby of T.STAVY_TRZBY)
      for (const stavSkladu of T.STAVY_SKLADU)
        for (const maPokladnu of [true, false])
          for (const stavOperace of [null, 'pripraveno', 'odesila_se', 'nejasny_vysledek', 'chyba', 'nepodporovano', 'uspech'])
            for (const platnostOperace of NA_CESTE.includes(stavOperace) ? [undefined, pred(3), pred(-3)] : [undefined])
              for (const posProdejId of stavTrzby === 'propojeno' ? [null, 'ORDER-555'] : [null])
                for (const ziva of [true, false])
                  for (const vysledekSkladu of ['neodecteno', 'jiz_odecteno'])
                    for (const dohledaniUctu of [true, false])
                      kombinace.push([
                        zaznam({ stavKontroly, stavTrzby, stavSkladu, posProdejId, kontrolaTrzby: kT(), kontrolaSkladu: { ...kT(), vysledek: vysledekSkladu } }),
                        m({ maPokladnu, stavOperace, platnostOperace, maZiveNavrhSkladu: ziva, dohledaniUctu }),
                      ])
  let jenTrzbaCisty = true
  let jenVydejCisty = true
  let bezPravaNic = true
  let pravoOdemyka = true
  let pravoNutne = true
  let vychodJenPoPlatnosti = true
  let vychodPoPlatnostiVidet = 0
  let rozpoznatJenMimoVydej = true
  let kontrolaPropojeneJenSProdejem = true
  const videno = new Set()
  for (const [z, mm] of kombinace) {
    const jenTrzba = S.dostupneAkce(z, new Set(['jine_platby.trzba']), mm)
    if ([...jenTrzba].some((x) => SKLAD_AKCE.includes(x))) jenTrzbaCisty = false
    const jenVydej = S.dostupneAkce(z, new Set(['jine_platby.vydej_pos']), mm)
    if ([...jenVydej].some((x) => TRZBA_AKCE.includes(x))) jenVydejCisty = false
    if (S.dostupneAkce(z, new Set(['finance.read']), mm).size > 0) bezPravaNic = false
    const vse = S.dostupneAkce(z, VSE, mm)
    // P3: ruční východ při operaci na cestě jen po vypršení platnosti (+ 2 min). Jen s pokladnou —
    // bez ní operace nevzniká a doložení bez návrhu (`rucne_dolozit_vydej`, větev bez připojení) operace nečte.
    if (mm.maPokladnu && NA_CESTE.includes(mm.stavOperace) && (vse.has('rucne_dolozit') || vse.has('zrusit_schvaleni'))) {
      if (!S.platnostOperaceVyprsela(mm.platnostOperace, mm.tedMs)) vychodJenPoPlatnosti = false
      else vychodPoPlatnostiVidet++
    }
    // P5: rozpoznání nikdy u schváleného nebo provedeného výdeje.
    if (vse.has('rozpoznat') && SKLAD_BEZ_CTENI.includes(z.stavSkladu)) rozpoznatJenMimoVydej = false
    // R1: dodatečná kontrola propojené tržby jen s konkrétním prodejem.
    if (vse.has('kontrola_trzby') && z.stavTrzby === 'propojeno' && z.posProdejId === null) kontrolaPropojeneJenSProdejem = false
    for (const akce of vse) {
      videno.add(akce)
      const moznosti = PRAVO_AKCE[akce]
      // Stačí právo (nebo dvojice práv), které akci patří…
      if (!moznosti.some((pr) => S.dostupneAkce(z, new Set(pr.split('+')), mm).has(akce))) pravoOdemyka = false
      // …a bez něj akce zmizí.
      const bez = new Set([...VSE].filter((x) => !moznosti.some((pr) => pr.split('+').includes(x))))
      if (S.dostupneAkce(z, bez, mm).has(akce)) pravoNutne = false
    }
  }
  ok(`jen jine_platby.trzba nikdy neodemkne skladovou akci (${kombinace.length} kombinací stavů)`, jenTrzbaCisty)
  ok('jen jine_platby.vydej_pos nikdy neodemkne tržbu', jenVydejCisty)
  ok('jen finance.read (čtení) → žádná akce', bezPravaNic)
  ok('každou akci odemkne její vlastní právo', pravoOdemyka)
  ok('bez vlastního práva akce nikdy není', pravoNutne)
  ok(`kombinace stavů prošly všech 22 akcí (kontrola měřila všechno; viděno ${videno.size})`, videno.size === 22)
  ok(`síť: rucne_dolozit / zrusit_schvaleni při operaci na cestě nikdy před vypršením platnosti (po ní viděno ${vychodPoPlatnostiVidet}×)`,
    vychodJenPoPlatnosti && vychodPoPlatnostiVidet > 0)
  ok('síť: rozpoznat nikdy u schváleného nebo provedeného výdeje', rozpoznatJenMimoVydej)
  ok('síť: kontrola_trzby u propojené tržby nikdy bez konkrétního prodeje (posProdejId)', kontrolaPropojeneJenSProdejem)

  const kS = (o = {}) => ({ vysledek: 'neodecteno', zdroj: 'pos_api', verze: 3, kdy: pred(5), kdo: null, detail: {}, ...o })
  ok('schválit výdej: čerstvá kontrola „neodečteno" → ano', S.muzeSchvalitVydej(zaznam({ stavSkladu: 'ceka_na_schvaleni', kontrolaSkladu: kS() }), TED))
  ok('schválit výdej: pokladna už odečetla → ne (propojit)', !S.muzeSchvalitVydej(zaznam({ stavSkladu: 'ceka_na_schvaleni', kontrolaSkladu: kS({ vysledek: 'jiz_odecteno' }) }), TED))
  ok('schválit výdej: kontrola 16 min stará → ne (sklad 15 min)', !S.muzeSchvalitVydej(zaznam({ stavSkladu: 'ceka_na_schvaleni', kontrolaSkladu: kS({ kdy: pred(16) }) }), TED))
  ok('schválit výdej: nezkontrolovaný záznam → ne (databáze ho odmítne)', !S.muzeSchvalitVydej(zaznam({ stavKontroly: 'ke_kontrole', stavSkladu: 'ceka_na_schvaleni', kontrolaSkladu: kS() }), TED))
}

/* ================================================================== */
console.log('\n== Možné duplicity (opakované fotografie) ==')
{
  const id = (o = {}) => ({ id: 'a', branchId: 'b1', pripojeniId: 'pos1', datumProdeje: '2026-10-15', castkaHaleru: 27900, mena: 'CZK', externiUcet: null, posProdejId: null, stavKontroly: 'ke_kontrole', otisky: [], ...o })
  const ja = id({ otisky: ['ABC123'], datumProdeje: '2026-10-14' })
  const fotka = D.mozneDuplicity(ja, [id({ id: 'b', otisky: ['abc123'], datumProdeje: '2026-10-01', castkaHaleru: 1 })])
  ok('stejný otisk souboru → jistá duplicita', fotka.length === 1 && fotka[0].jista && fotka[0].zaznamId === 'b' && fotka[0].duvod.includes('Stejný soubor'))
  const prodej = D.mozneDuplicity(id({ posProdejId: 'P-9' }), [id({ id: 'b', posProdejId: 'P-9', datumProdeje: null })])
  ok('stejný prodej v téže pokladně → jistá', prodej.length === 1 && prodej[0].jista)
  ok('stejný prodej v JINÉ pokladně → nic', D.mozneDuplicity(id({ posProdejId: 'P-9' }), [id({ id: 'b', posProdejId: 'P-9', pripojeniId: 'pos2', datumProdeje: null })]).length === 0)
  // Číslo účtu: jiná částka schválně — shoda „den + částka" se nesmí plést do měření.
  const uc = (o = {}) => id({ externiUcet: '1234', castkaHaleru: 100, ...o })
  const ucet = D.mozneDuplicity(id({ externiUcet: ' 12 34 ' }), [uc({ id: 'b', datumProdeje: '2026-10-12' })])
  ok('stejné číslo účtu (bez mezer) v téže pokladně, 3 dny od sebe → možná, ne jistá', ucet.length === 1 && !ucet[0].jista && ucet[0].duvod.includes('číslo účtu'))
  ok('stejný účet v jiné pokladně → nic', D.mozneDuplicity(uc(), [uc({ id: 'b', pripojeniId: 'pos2', datumProdeje: '2026-10-14' })]).length === 0)
  ok('účet přesně 7 dní od sebe → možná (okno včetně)', D.mozneDuplicity(uc(), [uc({ id: 'b', datumProdeje: '2026-10-08' })]).length === 1 && D.mozneDuplicity(uc(), [uc({ id: 'b', datumProdeje: '2026-10-22' })]).length === 1)
  ok('účet 8 dní od sebe → nic (pokladna čísluje účty dokola)', D.mozneDuplicity(uc(), [uc({ id: 'b', datumProdeje: '2026-10-07' })]).length === 0 && D.mozneDuplicity(uc(), [uc({ id: 'b', datumProdeje: '2026-10-23' })]).length === 0)
  ok('okno přes přelom měsíce a roku počítá dny, ne text (2026-12-28 ~ 2027-01-03)', D.mozneDuplicity(uc({ datumProdeje: '2026-12-28' }), [uc({ id: 'b', datumProdeje: '2027-01-03' })]).length === 1)
  ok('účet bez data u jednoho z nich → nic (oba datumy musí být vyplněné)',
    D.mozneDuplicity(uc({ datumProdeje: null }), [uc({ id: 'b' })]).length === 0 && D.mozneDuplicity(uc(), [uc({ id: 'b', datumProdeje: null })]).length === 0)
  ok('s pokladnou i napříč pobočkami (jedna pokladna obsluhuje víc poboček) → možná', D.mozneDuplicity(uc(), [uc({ id: 'b', branchId: 'b2', datumProdeje: '2026-10-14' })]).length === 1)
  // Stejně jako databáze: dva záznamy bez pokladny — jen v téže pobočce.
  const bezPokladny = D.mozneDuplicity(uc({ externiUcet: 'Stůl 7', pripojeniId: null }), [uc({ id: 'b', externiUcet: 'stůl7', pripojeniId: null, datumProdeje: '2026-10-13' })])
  ok('stejný účet u dvou záznamů BEZ pokladny v téže pobočce → možná duplicita (jako v databázi)', bezPokladny.length === 1 && !bezPokladny[0].jista && bezPokladny[0].duvod.includes('bez pokladny'))
  ok('stejný účet BEZ pokladny v JINÉ pobočce → nic („Stůl 7" je jiný stůl)', D.mozneDuplicity(uc({ externiUcet: 'Stůl 7', pripojeniId: null }), [uc({ id: 'b', externiUcet: 'stůl7', pripojeniId: null, branchId: 'b2' })]).length === 0)
  // N12 (kontrola 19. 10.): záznam s pokladnou a záznam bez ní na TÉŽE pobočce — jako app.jp_mozne_duplicity.
  const sBez = D.mozneDuplicity(uc({ pripojeniId: null }), [uc({ id: 'b', castkaHaleru: 200 })])
  ok('účet bez pokladny vs. účet s pokladnou na TÉŽE pobočce → možná duplicita (jiná částka — měří se jen účet)',
    sBez.length === 1 && !sBez[0].jista && sBez[0].duvod.includes('s pokladnou a záznamu bez ní'))
  const sPokladnou = D.mozneDuplicity(uc(), [uc({ id: 'b', pripojeniId: null, castkaHaleru: 200, datumProdeje: '2026-10-09' })])
  ok('… i obráceně (záznam s pokladnou proti záznamu bez ní), 6 dní od sebe', sPokladnou.length === 1 && sPokladnou[0].duvod.includes('s pokladnou a záznamu bez ní'))
  ok('… ale s pokladnou × bez pokladny na JINÉ pobočce → nic', D.mozneDuplicity(uc({ pripojeniId: null }), [uc({ id: 'b', branchId: 'b2', castkaHaleru: 200 })]).length === 0)
  ok('… a 8 dní od sebe → nic (okno platí i tady)', D.mozneDuplicity(uc({ pripojeniId: null }), [uc({ id: 'b', castkaHaleru: 200, datumProdeje: '2026-10-07' })]).length === 0)
  ok('normalizace pro pokladnu: všechny bílé znaky pryč (i nezlomitelná a úzká mezera, tabulátor), malými', D.normalizovatUcet(' Ab\u00a01\u202f2\t3 ') === 'ab123' && D.normalizovatUcet(' \u00a0 ') === null && D.normalizovatUcet(null) === null)
  // Duplicity: stejná množina bílých znaků jako regexp \s v databázi (bez nezlomitelných mezer).
  ok('klíč účtu jako databáze: mezera, tabulátor, konec řádku a em-mezera pryč, malými',
    D.klicUctuJakoDb(' Ab 1\t2\n3\u2003') === 'ab123' && D.klicUctuJakoDb(' \t ') === null && D.klicUctuJakoDb(null) === null)
  ok('klíč účtu jako databáze: nezlomitelná (U+00A0), úzká (U+202F) a číslicová (U+2007) mezera ZŮSTANOU',
    D.klicUctuJakoDb('A\u00a01') === 'a\u00a01' && D.klicUctuJakoDb('A\u202f1') === 'a\u202f1' && D.klicUctuJakoDb('A\u20071') === 'a\u20071')
  ok('účet s nezlomitelnou mezerou se s účtem bez mezer NESHODUJE (databáze ji neodstraní)',
    D.mozneDuplicity(uc({ externiUcet: 'A\u00a012' }), [uc({ id: 'b', externiUcet: 'a12', castkaHaleru: 200 })]).length === 0)
  ok('účet s obyčejnou mezerou a tabulátorem se s účtem bez mezer shoduje',
    ((d) => d.length === 1 && d[0].duvod.includes('číslo účtu'))(D.mozneDuplicity(uc({ externiUcet: 'A 1\t2' }), [uc({ id: 'b', externiUcet: 'a12', castkaHaleru: 200 })])))
  const den = D.mozneDuplicity(id(), [id({ id: 'b' })])
  ok('stejná pobočka + den + částka + měna → možná', den.length === 1 && !den[0].jista && den[0].duvod.includes('den'))
  ok('bez měny → nic', D.mozneDuplicity(id({ mena: null }), [id({ id: 'b', mena: null })]).length === 0)
  ok('jiný den → nic', D.mozneDuplicity(id(), [id({ id: 'b', datumProdeje: '2026-10-14' })]).length === 0)
  ok('jiná pobočka → nic', D.mozneDuplicity(id(), [id({ id: 'b', branchId: 'b2' })]).length === 0)
  ok('samotná částka bez data nestačí', D.mozneDuplicity(id({ datumProdeje: null }), [id({ id: 'b', datumProdeje: null })]).length === 0)
  ok('zrušený záznam se nepočítá', D.mozneDuplicity(id({ otisky: ['x'] }), [id({ id: 'b', otisky: ['x'], stavKontroly: 'zruseno' })]).length === 0)
  ok('sám sebe nehlásí', D.mozneDuplicity(id({ otisky: ['x'] }), [id({ otisky: ['x'] })]).length === 0)
  const poradi = D.mozneDuplicity(id({ otisky: ['x'] }), [id({ id: 'mozna' }), id({ id: 'jista', otisky: ['x'], datumProdeje: null })])
  ok('jisté duplicity jsou první', poradi.length === 2 && poradi[0].zaznamId === 'jista' && poradi[0].jista && !poradi[1].jista)
}

console.log('\n== Podklady pro fakturu ==')
{
  const kontakt = { id: 'k1', nazev: 'Firma s.r.o.', ico: '12345678', dic: null }
  const radek = (o = {}) => navrh({ nazev: 'Raut', mnozstvi: '10', cenaJednotkovaHaleru: 25000, cenaCelkemHaleru: 250000, sazbaDph: '12', druh: 'pokrm', ...o })
  const z = zaznam({ castkaHaleru: 250000 })
  const plne = F.sestavitPodklady(z, [radek()], kontakt)
  ok('úplné ověřené údaje → nic nechybí', plne.chybi.length === 0)
  ok('podklady: odběratel, měna, datum plnění, celkem, účet', plne.podklady.odberatel === kontakt && plne.podklady.mena === 'CZK' && plne.podklady.datumPlneni === '2026-10-15' && plne.podklady.celkemHaleru === 250000 && plne.podklady.externiUcet === '1234')
  ok('řádek převzatý přesně', plne.podklady.polozky.length === 1 && plne.podklady.polozky[0].cenaCelkemHaleru === 250000 && plne.podklady.polozky[0].sazbaDph === '12' && plne.podklady.polozky[0].mnozstvi === '10')

  const bezKontaktu = F.sestavitPodklady(z, [radek()], null)
  ok('bez kontaktu → chybí odběratel', bezKontaktu.chybi.some((c) => c.includes('Odběratel')))
  ok('kontakt bez IČO → chybí IČO', F.sestavitPodklady(z, [radek()], { ...kontakt, ico: null }).chybi.some((c) => c.includes('IČO')))
  const neovereny = F.sestavitPodklady(z, [radek({ vyzadujeKontrolu: true, duvodKontroly: 'Nejistě přečtený řádek' })], kontakt)
  ok('řádek ke kontrole → ceny, množství a DPH prázdné + v chybí', neovereny.podklady.polozky[0].cenaCelkemHaleru === null && neovereny.podklady.polozky[0].cenaJednotkovaHaleru === null && neovereny.podklady.polozky[0].sazbaDph === null && neovereny.podklady.polozky[0].mnozstvi === null && neovereny.chybi.some((c) => c.includes('čeká na kontrolu')))
  const bezDph = F.sestavitPodklady(z, [radek({ sazbaDph: null })], kontakt)
  ok('řádek bez DPH → chybí DPH, nedomýšlí se', bezDph.podklady.polozky[0].sazbaDph === null && bezDph.chybi.some((c) => c.includes('sazba DPH')))
  const nezkontr = F.sestavitPodklady(zaznam({ stavKontroly: 'ke_kontrole', castkaHaleru: 250000 }), [radek()], kontakt)
  ok('nezkontrolovaný záznam → měna, datum a celkem prázdné + důvod', nezkontr.podklady.mena === null && nezkontr.podklady.celkemHaleru === null && nezkontr.podklady.datumPlneni === null && nezkontr.chybi.some((c) => c.includes('není zkontrolovaný')))
  ok('záznam bez měny → chybí měna', F.sestavitPodklady(zaznam({ mena: null, castkaHaleru: 250000 }), [radek()], kontakt).chybi.includes('Měna'))
  const dopocet = F.sestavitPodklady(z, [radek({ cenaCelkemHaleru: null })], kontakt)
  ok('cena celkem dopočtená 10 × 250 = 2500 (přesný součin ověřených údajů)', dopocet.podklady.polozky[0].cenaCelkemHaleru === 250000 && dopocet.chybi.length === 0)
  const bezCeny = F.sestavitPodklady(z, [radek({ cenaCelkemHaleru: null, cenaJednotkovaHaleru: null })], kontakt)
  ok('řádek bez ceny → chybí cena', bezCeny.chybi.some((c) => c.includes(': cena')))

  const tipRadek = navrh({ nazev: 'Spropitné', mnozstvi: null, cenaJednotkovaHaleru: null, cenaCelkemHaleru: 5000, sazbaDph: null, druh: 'spropitne', mapovani: 'neskladova' })
  const sTipem = F.sestavitPodklady(z, [radek(), { ...tipRadek, sazbaDph: '0' }], kontakt)
  ok('výslovný řádek spropitného se převezme tak, jak je, a nerozbije součet', sTipem.podklady.polozky.length === 2 && sTipem.podklady.polozky[1].cenaCelkemHaleru === 5000 && !sTipem.chybi.some((c) => c.includes('Součet')))
  const bezTipu = F.sestavitPodklady(z, [radek()], kontakt)
  ok('bez řádku se spropitné do faktury nedostane (řádků = položek)', bezTipu.podklady.polozky.length === 1 && bezTipu.podklady.polozky.every((p) => p.nazev !== 'Spropitné'))
  const nesedi = F.sestavitPodklady(zaznam({ castkaHaleru: 300000 }), [radek()], kontakt)
  ok('součet řádků ≠ částka záznamu → v chybí', nesedi.chybi.some((c) => c.includes('Součet položek')))
}

/* ================================================================== */
console.log('\n== Převod do tvaru databáze a zpět (lib/jine-platby-db.ts) ==')
{
  const p = navrh({ mnozstvi: '1.25', sazbaDph: '21', posProduktId: 'p1', posProduktNazev: 'Pivo', posMnozstvi: '2', mapovani: 'navrh', vyzadujeKontrolu: true, duvodKontroly: 'x' })
  const db = DB.doDbPolozky([p])[0]
  const sloupce = DB.SLOUPCE_POLOZKY.split(',').map((s) => s.trim())
  ok('každý klíč p_polozky je sloupec položky', Object.keys(db).every((k) => sloupce.includes(k)))
  ok('položka → databáze → položka beze ztráty', JSON.stringify(DB.zDbPolozka(db)) === JSON.stringify(p))
  ok('numeric z PostgREST jako číslo (1.25) → "1.25"', DB.zDbPolozka({ ...db, mnozstvi: 1.25 }).mnozstvi === '1.25')
  const h = DB.hlavickaZeZaznamu(zaznam())
  const sloupceZ = DB.SLOUPCE_ZAZNAMU.split(',').map((s) => s.trim())
  ok('každý klíč p_hlavicka je sloupec záznamu', Object.keys(DB.doDbHlavicka(h)).every((k) => sloupceZ.includes(k)))
  const radekZaznamu = Object.fromEntries(sloupceZ.map((s) => [s, null]))
  ok('záznam z databáze zná všechny sloupce SLOUPCE_ZAZNAMU', Object.keys(DB.zDbZaznam({ ...radekZaznamu, id: 'z', tenant_id: 't', branch_id: 'b', vytvoreno: 'x', zmeneno: 'x' })).length === sloupceZ.length)
}

/* ================================================================== */
console.log('\n== Výčty v appce = CHECK v migraci 20261016100000_jine_platby.sql ==')
{
  const cesta = process.env.JP_TEST_MIGRACE ?? new URL('../supabase/migrations/20261016100000_jine_platby.sql', import.meta.url)
  if (!existsSync(cesta)) {
    preskoceno++
    console.log('  PŘESKOČENO: migrace zatím neexistuje')
  } else {
    const sql = readFileSync(cesta, 'utf8').replace(/--[^\n]*/g, '')
    // Tělo každého `create table`: od závorky po tu, která ji zavírá.
    const tabulky = new Map()
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi)) {
      let hloubka = 1
      let i = m.index + m[0].length
      for (; i < sql.length && hloubka > 0; i++) {
        if (sql[i] === '(') hloubka++
        else if (sql[i] === ')') hloubka--
      }
      tabulky.set(m[1].toLowerCase(), (tabulky.get(m[1].toLowerCase()) ?? '') + sql.slice(m.index, i))
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+add\s+constraint\s+\w+\s+check\s*\(([\s\S]*?)\);/gi)) {
      tabulky.set(m[1].toLowerCase(), (tabulky.get(m[1].toLowerCase()) ?? '') + ` check (${m[2]})`)
    }
    const hodnotyCheck = (tabulka, sloupec) => {
      const telo = tabulky.get(tabulka) ?? ''
      const re = new RegExp(`check\\s*\\(\\s*${sloupec}\\s+in\\s*\\(([^)]*)\\)`, 'gi')
      return [...telo.matchAll(re)].map((x) => [...x[1].matchAll(/'([a-z_]+)'/g)].map((y) => y[1]))
    }
    const sedi = (tabulka, sloupec, vycet) => {
      const nalezene = hodnotyCheck(tabulka, sloupec)
      ok(`${tabulka}.${sloupec}: CHECK nalezený`, nalezene.length > 0)
      ok(`${tabulka}.${sloupec}: stejné hodnoty jako appka (${vycet.length})`, nalezene.some((h) => h.length === vycet.length && [...vycet].sort().join() === [...h].sort().join()))
    }
    sedi('jine_platby', 'stav_kontroly', T.STAVY_KONTROLY)
    sedi('jine_platby', 'stav_trzby', T.STAVY_TRZBY)
    sedi('jine_platby', 'stav_skladu', T.STAVY_SKLADU)
    sedi('jine_platby', 'stav_faktury', T.STAVY_FAKTURY)
    sedi('jine_platby', 'stav_uhrady', T.STAVY_UHRADY)
    sedi('jine_platby', 'typ_dokladu', T.TYPY_DOKLADU)
    sedi('jine_platby', 'castka_puvod', T.PUVODY_CASTKY)
    sedi('jine_platby_polozky', 'druh', T.DRUHY_POLOZEK)
    sedi('jine_platby_polozky', 'mapovani', T.STAVY_MAPOVANI)
    sedi('jine_platby_polozky', 'zdroj', T.ZDROJE_POLOZKY)
    sedi('pos_operace', 'stav', O.STAVY_OPERACE)
  }
}

console.log(
  chyb
    ? `\n${chyb} kontrol SELHALO (prošlo ${proslo} z ${proslo + chyb}${preskoceno ? `, přeskočené bloky: ${preskoceno}` : ''})`
    : `\nVšechny kontroly prošly: ${proslo} z ${proslo}${preskoceno ? ` (přeskočené bloky: ${preskoceno} — nepočítají se)` : ''}`,
)
process.exit(chyb ? 1 : 0)
