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

const { jistotaShody, navrhnoutParovani, PRAH_NAVRHU } = await import('../lib/finance-parovani.ts')

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

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
