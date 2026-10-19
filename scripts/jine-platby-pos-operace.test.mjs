#!/usr/bin/env node
/**
 * Jiné platby — provedení a obnova operace v pokladně
 * (lib/jine-platby-pos-operace.ts), s podvrženou databází i pokladnou.
 *
 * Co se tu dokazuje (výdej provedený dvakrát = sklad odečtený dvakrát):
 *   – souběh: dva současné pokusy → do pokladny odejde JEDEN požadavek;
 *   – „přijato" od pokladny nestačí, úspěch je až dohledaný požadavek;
 *   – timeout / výjimka / nejasná odpověď → nejasný výsledek, nikdy nové odeslání;
 *   – obnova jen dohledává; „chyba" až po platnosti požadavku + rezervě;
 *   – pokladna bez API → nic se neodešle.
 *
 * Podvržená databáze (`novaDatabaze`) se chová jako pos_operace_zahajit /
 * pos_operace_dokoncit v migraci 20261016100000_jine_platby.sql: zabrat
 * jde jen 'pripraveno', ukončit jen z povolených stavů. Čas je pevný
 * (`TED`) — test nezávisí na hodinách.
 *
 * Pusť `node scripts/jine-platby-pos-operace.test.mjs`.
 */

const lib = await import('../lib/jine-platby-pos-operace.ts')
const { PLATNOST_POZADAVKU_MS, REZERVA_PO_PLATNOSTI_MS, STAVY_OPERACE } = lib

// Výjimka z knihovny se počítá jako výsledek (stav 'vyjimka'), ne jako pád
// testu — jinak by jedna rozbitá cesta schovala všechny kontroly za ní.
const zachytit = (f) => async (...a) => {
  try {
    return await f(...a)
  } catch (e) {
    return { stav: 'vyjimka', duvod: e instanceof Error ? e.message : String(e) }
  }
}
const provestOperaci = zachytit(lib.provestOperaci)
const obnovitOperaci = zachytit(lib.obnovitOperaci)

let chyb = 0
let proslo = 0
const ok = (popis, podminka) => {
  if (podminka) proslo++
  else chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const TED = Date.parse('2026-10-16T12:00:00Z')
const dalsiTah = () => new Promise((r) => setImmediate(r))

const operace = (o = {}) => ({
  id: 'op1',
  klic: 'ftjp0001',
  stav: 'pripraveno',
  pokusu: 0,
  platnostDo: null,
  externiProvozovna: '77',
  polozky: [{ produktId: 'p-pivo05', mnozstvi: '2' }],
  poznamka: 'Foodtab Jiné platby Stůl 4',
  ...o,
})

/** Databáze jako pos_operace_zahajit/dokoncit: stav operace se mění jen přes ni. */
function novaDatabaze(op, { zahajit = null, dokoncitHodi = false } = {}) {
  const stav = { op: { ...op }, volani: [] }
  stav.repo = {
    async zahajit(opId, platnostDoIso) {
      stav.volani.push(['zahajit', opId, platnostDoIso])
      await dalsiTah()
      if (zahajit === 'hodi') throw new Error('spojení s databází spadlo')
      if (zahajit) return zahajit
      // Atomické „pripraveno → odesila_se" (v SQL řádkový zámek + kontrola stavu).
      if (stav.op.stav !== 'pripraveno') return { stav: 'obsazeno' }
      stav.op = { ...stav.op, stav: 'odesila_se', pokusu: stav.op.pokusu + 1, platnostDo: platnostDoIso }
      return { stav: 'ok', op: { ...stav.op } }
    },
    async dokoncit(opId, zaver) {
      stav.volani.push(['dokoncit', opId, zaver])
      if (dokoncitHodi) throw new Error('zápis výsledku selhal')
      const z = stav.op.stav
      const povoleno = z === 'odesila_se' || (z === 'nejasny_vysledek' && ['uspech', 'chyba', 'nejasny_vysledek'].includes(zaver.stav)) || (z === 'pripraveno' && zaver.stav === 'nepodporovano')
      if (!povoleno) throw new Error(`Operaci ve stavu ${z} nejde ukončit jako ${zaver.stav}`)
      stav.op = { ...stav.op, stav: zaver.stav }
    },
  }
  stav.pocet = (druh) => stav.volani.filter((v) => v[0] === druh).length
  stav.posledniZaver = () => [...stav.volani].reverse().find((v) => v[0] === 'dokoncit')?.[2]
  return stav
}

/**
 * Pokladna: `odeslat` a `dohledat` jsou fronty odpovědí (funkce nebo hodnoty).
 * `provede` = pokladna si požadavek zapamatuje a dohledání ho pak najde.
 */
function novaPokladna({ schopnost = 'api', odeslat = [], dohledat = [], bezOdeslat = false, bezDohledat = false } = {}) {
  const p = { odeslane: [], dohledane: [], provedeno: new Set() }
  const fronta = (pole, vychozi) => async (arg) => {
    const dalsi = pole.length ? pole.shift() : vychozi
    return typeof dalsi === 'function' ? dalsi(arg) : dalsi
  }
  const odeslatF = fronta(odeslat, { stav: 'odeslano' })
  const dohledatF = fronta(dohledat, (klic) => (p.provedeno.has(klic) ? { stav: 'nalezeno', externiId: `POS-${klic}`, doklad: 'D-1', detail: { klic, stav: 'uzavreny', zaplaceno: true, odpis: true } } : { stav: 'nenalezeno' }))
  p.pos = { schopnost }
  if (!bezOdeslat) {
    p.pos.odeslat = async (op) => {
      p.odeslane.push(op)
      await dalsiTah()
      return odeslatF(op)
    }
  }
  if (!bezDohledat) {
    p.pos.dohledat = async (klic) => {
      p.dohledane.push(klic)
      await dalsiTah()
      return dohledatF(klic)
    }
  }
  return p
}

/* ================================================================== */
console.log('\n== Úspěch jen po ověření dohledáním ==')
{
  const db = novaDatabaze(operace())
  const pokl = novaPokladna({ odeslat: [(op) => { pokl.provedeno.add(op.klic); return { stav: 'odeslano' } }] })
  const r = await provestOperaci(operace(), db.repo, pokl.pos, TED)
  ok('odeslano + dohledáno → úspěch s ID z pokladny', r.stav === 'uspech' && r.externiId === 'POS-ftjp0001' && r.doklad === 'D-1')
  ok('… výsledek nese detail dohledání', r.stav === 'uspech' && r.vysledek.klic === 'ftjp0001')
  ok('nejdřív zabrat, pak odeslat, pak dohledat, pak uložit', db.volani[0][0] === 'zahajit' && pokl.odeslane.length === 1 && pokl.dohledane.length === 1 && db.volani.at(-1)[0] === 'dokoncit')
  ok('platnost požadavku = teď + 5 min (ISO)', db.volani[0][2] === new Date(TED + PLATNOST_POZADAVKU_MS).toISOString())
  ok('pokladna dostala zabranou operaci s klíčem a platností', pokl.odeslane[0].klic === 'ftjp0001' && pokl.odeslane[0].platnostDo === db.volani[0][2] && pokl.odeslane[0].stav === 'odesila_se')
  ok('dohledává se podle idempotenčního klíče', pokl.dohledane[0] === 'ftjp0001')
  ok('databáze má úspěch', db.op.stav === 'uspech' && db.posledniZaver().stav === 'uspech')

  const db2 = novaDatabaze(operace())
  const pokl2 = novaPokladna() // přijme, ale zatím nezná
  const r2 = await provestOperaci(operace(), db2.repo, pokl2.pos, TED)
  ok('odeslano, ale nenalezeno → nejasný výsledek (pokladna může ještě zpracovávat)', r2.stav === 'nejasny_vysledek' && db2.op.stav === 'nejasny_vysledek')
  ok('… a odeslalo se jen jednou', pokl2.odeslane.length === 1)

  const db3 = novaDatabaze(operace())
  const pokl3 = novaPokladna({ dohledat: [{ stav: 'chyba', duvod: 'limit dotazů' }] })
  const r3 = await provestOperaci(operace(), db3.repo, pokl3.pos, TED)
  ok('odeslano, dohledání chybou → nejasný výsledek, ne úspěch', r3.stav === 'nejasny_vysledek' && r3.duvod.includes('limit dotazů'))

  const db4 = novaDatabaze(operace())
  const pokl4 = novaPokladna({ dohledat: [() => { throw new Error('timeout') }] })
  const r4 = await provestOperaci(operace(), db4.repo, pokl4.pos, TED)
  ok('odeslano, dohledání výjimkou → nejasný výsledek', r4.stav === 'nejasny_vysledek' && pokl4.odeslane.length === 1)

  const db5 = novaDatabaze(operace())
  const pokl5 = novaPokladna({ dohledat: [{ stav: 'nalezeno', externiId: '  ', doklad: null, detail: {} }] })
  const r5 = await provestOperaci(operace(), db5.repo, pokl5.pos, TED)
  ok('„nalezeno" bez ID nic nedokazuje → nejasný výsledek', r5.stav === 'nejasny_vysledek')
}

console.log('\n== Odmítnutí, timeout a nejasná odpověď ==')
{
  const db = novaDatabaze(operace())
  const pokl = novaPokladna({ odeslat: [{ stav: 'odmitnuto', duvod: 'neznámý produkt' }] })
  const r = await provestOperaci(operace(), db.repo, pokl.pos, TED)
  ok('pokladna jasně odmítla → chyba s důvodem', r.stav === 'chyba' && r.duvod.includes('neznámý produkt') && db.op.stav === 'chyba')
  ok('… po odmítnutí se nedohledává ani neposílá znovu', pokl.odeslane.length === 1 && pokl.dohledane.length === 0)

  const db2 = novaDatabaze(operace())
  const pokl2 = novaPokladna({ odeslat: [() => { throw new Error('ETIMEDOUT') }] })
  const r2 = await provestOperaci(operace(), db2.repo, pokl2.pos, TED)
  ok('timeout při odeslání → nejasný výsledek (pokladna mohla přijmout)', r2.stav === 'nejasny_vysledek' && r2.duvod.includes('ETIMEDOUT') && db2.op.stav === 'nejasny_vysledek')
  ok('… NIKDY nové odeslání', pokl2.odeslane.length === 1)

  const db3 = novaDatabaze(operace())
  const pokl3 = novaPokladna({ odeslat: [{ stav: 'nejasne', duvod: 'HTTP 502' }] })
  const r3 = await provestOperaci(operace(), db3.repo, pokl3.pos, TED)
  ok('nejasná odpověď → nejasný výsledek, jedno odeslání', r3.stav === 'nejasny_vysledek' && pokl3.odeslane.length === 1)

  const db4 = novaDatabaze(operace())
  const pokl4 = novaPokladna({ odeslat: [undefined] })
  const r4 = await provestOperaci(operace(), db4.repo, pokl4.pos, TED)
  ok('odpověď, které appka nerozumí (nic) → nejasný výsledek, ne pád', r4.stav === 'nejasny_vysledek' && db4.op.stav === 'nejasny_vysledek')
  const db5 = novaDatabaze(operace())
  const pokl5 = novaPokladna({ odeslat: [{ stav: 'mozna' }] })
  ok('neznámý stav odpovědi → nejasný výsledek', (await provestOperaci(operace(), db5.repo, pokl5.pos, TED)).stav === 'nejasny_vysledek')
}

console.log('\n== Souběh: dva pokusy najednou ==')
{
  const db = novaDatabaze(operace())
  const pokl = novaPokladna({ odeslat: [(op) => { pokl.provedeno.add(op.klic); return { stav: 'odeslano' } }] })
  const [a, b] = await Promise.all([provestOperaci(operace(), db.repo, pokl.pos, TED), provestOperaci(operace(), db.repo, pokl.pos, TED)])
  const stavy = [a.stav, b.stav].sort().join()
  ok('jeden uspěje, druhý dostane „obsazeno"', stavy === 'obsazeno,uspech')
  ok('do pokladny odešel JEDEN požadavek', pokl.odeslane.length === 1)
  ok('výsledek uložil jen ten, kdo zabral', db.pocet('dokoncit') === 1)

  const db2 = novaDatabaze(operace(), { zahajit: { stav: 'obsazeno' } })
  const pokl2 = novaPokladna()
  const r2 = await provestOperaci(operace(), db2.repo, pokl2.pos, TED)
  ok('„obsazeno" z databáze → nic neodeslat, nic neukládat', r2.stav === 'obsazeno' && pokl2.odeslane.length === 0 && db2.pocet('dokoncit') === 0)

  const db3 = novaDatabaze(operace(), { zahajit: { stav: 'nelze', duvod: 'Kontrola výdeje v pokladně je stará' } })
  const pokl3 = novaPokladna()
  const r3 = await provestOperaci(operace(), db3.repo, pokl3.pos, TED)
  ok('„nelze" z databáze (stará kontrola skladu) → nic neodeslat, důvod předán', r3.stav === 'nelze' && r3.duvod.includes('stará') && pokl3.odeslane.length === 0)

  const db4 = novaDatabaze(operace(), { zahajit: 'hodi' })
  const pokl4 = novaPokladna()
  const r4 = await provestOperaci(operace(), db4.repo, pokl4.pos, TED)
  ok('výjimka při zabrání → „nelze", nic neodesláno', r4.stav === 'nelze' && pokl4.odeslane.length === 0 && db4.pocet('dokoncit') === 0)
}

console.log('\n== Jen připravená operace, jen pokladna s API ==')
{
  for (const stav of STAVY_OPERACE.filter((s) => s !== 'pripraveno')) {
    const db = novaDatabaze(operace({ stav }))
    const pokl = novaPokladna()
    const r = await provestOperaci(operace({ stav }), db.repo, pokl.pos, TED)
    ok(`stav ${stav} → „nelze", bez zabrání a odeslání`, r.stav === 'nelze' && db.volani.length === 0 && pokl.odeslane.length === 0)
  }

  const db = novaDatabaze(operace())
  const pokl = novaPokladna({ schopnost: 'rucne' })
  const r = await provestOperaci(operace(), db.repo, pokl.pos, TED)
  ok('pokladna „ručně" → nepodporovano uložené, nic neodesláno ani nezabráno', r.stav === 'nepodporovano' && pokl.odeslane.length === 0 && db.pocet('zahajit') === 0 && db.op.stav === 'nepodporovano')
  const db2 = novaDatabaze(operace())
  const pokl2 = novaPokladna({ schopnost: 'nepodporovano' })
  ok('pokladna „nepodporovano" → nepodporovano', (await provestOperaci(operace(), db2.repo, pokl2.pos, TED)).stav === 'nepodporovano' && pokl2.odeslane.length === 0)
  const db3 = novaDatabaze(operace())
  const pokl3 = novaPokladna({ bezDohledat: true })
  ok('API bez dohledání → nepodporovano (neověřitelný úspěch se neposílá)', (await provestOperaci(operace(), db3.repo, pokl3.pos, TED)).stav === 'nepodporovano' && pokl3.odeslane.length === 0)
  const db4 = novaDatabaze(operace())
  const pokl4 = novaPokladna({ bezOdeslat: true })
  ok('API bez odeslání → nepodporovano', (await provestOperaci(operace(), db4.repo, pokl4.pos, TED)).stav === 'nepodporovano')

  const db5 = novaDatabaze(operace(), { dokoncitHodi: true })
  const pokl5 = novaPokladna({ odeslat: [(op) => { pokl5.provedeno.add(op.klic); return { stav: 'odeslano' } }] })
  let hodilo = false
  try {
    await lib.provestOperaci(operace(), db5.repo, pokl5.pos, TED)
  } catch {
    hodilo = true
  }
  ok('selže uložení výsledku → výjimka ven (operace zůstane „odesílá se" a dohledá se), ne tichý úspěch', hodilo && db5.op.stav === 'odesila_se')
}

console.log('\n== Obnova: timeout → dohledání → výsledek, bez nového odeslání ==')
{
  // Celý příběh: odeslání spadne na timeout, pokladna to ale zpracuje později.
  const db = novaDatabaze(operace())
  const pokl = novaPokladna({ odeslat: [() => { throw new Error('ETIMEDOUT') }] })
  const prvni = await provestOperaci(operace(), db.repo, pokl.pos, TED)
  ok('(1) timeout → nejasný výsledek', prvni.stav === 'nejasny_vysledek' && db.op.stav === 'nejasny_vysledek')
  const platnostDo = db.op.platnostDo
  const platnostMs = Date.parse(platnostDo)

  const brzy = await obnovitOperaci({ ...db.op }, db.repo, pokl.pos, TED + 60_000)
  ok('(2) obnova za minutu: nenalezeno, platnost běží → beze změny („ještě může provést")', brzy.stav === 'beze_zmeny' && brzy.duvod.includes('ještě') && db.op.stav === 'nejasny_vysledek')
  ok('(2) … beze změny se nic neukládá', db.pocet('dokoncit') === 1)

  pokl.provedeno.add('ftjp0001') // pokladna požadavek mezitím provedla
  const pozdeji = await obnovitOperaci({ ...db.op }, db.repo, pokl.pos, TED + 3 * 60_000)
  ok('(3) obnova po zpracování: nalezeno → úspěch s ID', pozdeji.stav === 'uspech' && pozdeji.externiId === 'POS-ftjp0001' && db.op.stav === 'uspech')
  ok('(4) za celý příběh odešel do pokladny JEDEN požadavek', pokl.odeslane.length === 1)
  ok('(4) obnova volala jen dohledání', pokl.dohledane.length === 2)
  ok('(5) platnost uložená při zabrání = teď + 5 min', platnostMs === TED + PLATNOST_POZADAVKU_MS)
}

console.log('\n== Obnova: po platnosti → chyba, kterou jde zkusit znovu ==')
{
  const platnostDo = new Date(TED).toISOString()
  const nejasna = operace({ stav: 'nejasny_vysledek', platnostDo, pokusu: 1 })
  const hranice = TED + REZERVA_PO_PLATNOSTI_MS

  const db = novaDatabaze(nejasna)
  const pokl = novaPokladna({ odeslat: [() => { throw new Error('obnova nesmí odesílat') }] })
  const presne = await obnovitOperaci(nejasna, db.repo, pokl.pos, hranice)
  ok('přesně na konci rezervy → pořád beze změny (ostře větší)', presne.stav === 'beze_zmeny' && db.pocet('dokoncit') === 0)
  const po = await obnovitOperaci(nejasna, db.repo, pokl.pos, hranice + 1)
  ok('po platnosti + rezervě a nenalezeno → chyba (pokladna už neprovede)', po.stav === 'chyba' && db.op.stav === 'chyba' && db.posledniZaver().stav === 'chyba')
  ok('obnova nikdy neodeslala', pokl.odeslane.length === 0)

  const db2 = novaDatabaze(nejasna)
  const pokl2 = novaPokladna({ dohledat: [{ stav: 'chyba', duvod: 'pokladna neodpovídá' }] })
  const chybaDohl = await obnovitOperaci(nejasna, db2.repo, pokl2.pos, hranice + 60 * 60_000)
  ok('chyba dohledání i dlouho po platnosti → beze změny (bez dohledání se chyba neprohlásí)', chybaDohl.stav === 'beze_zmeny' && db2.pocet('dokoncit') === 0)
  const db3 = novaDatabaze(nejasna)
  const pokl3 = novaPokladna({ dohledat: [() => { throw new Error('ECONNRESET') }] })
  ok('výjimka při dohledání → beze změny', (await obnovitOperaci(nejasna, db3.repo, pokl3.pos, hranice + 1)).stav === 'beze_zmeny' && db3.pocet('dokoncit') === 0)

  const bezPlatnosti = operace({ stav: 'nejasny_vysledek', platnostDo: null })
  const db4 = novaDatabaze(bezPlatnosti)
  const pokl4 = novaPokladna()
  ok('neznámá platnost + nenalezeno → beze změny (nejde rozhodnout)', (await obnovitOperaci(bezPlatnosti, db4.repo, pokl4.pos, hranice + 60 * 60_000)).stav === 'beze_zmeny' && db4.pocet('dokoncit') === 0)

  const zaseknuta = operace({ stav: 'odesila_se', platnostDo, pokusu: 1 })
  const db5 = novaDatabaze(zaseknuta)
  const pokl5 = novaPokladna()
  pokl5.provedeno.add('ftjp0001')
  ok('zaseknuté „odesílá se" → obnova dohledá úspěch', (await obnovitOperaci(zaseknuta, db5.repo, pokl5.pos, TED)).stav === 'uspech' && db5.op.stav === 'uspech')
  const db6 = novaDatabaze(zaseknuta)
  const pokl6 = novaPokladna()
  ok('zaseknuté „odesílá se" po platnosti → chyba', (await obnovitOperaci(zaseknuta, db6.repo, pokl6.pos, hranice + 1)).stav === 'chyba' && db6.op.stav === 'chyba')

  for (const stav of ['pripraveno', 'uspech', 'chyba', 'nepodporovano', 'rucne_dolozeno', 'zruseno']) {
    const op = operace({ stav, platnostDo })
    const dbx = novaDatabaze(op)
    const poklx = novaPokladna()
    const r = await obnovitOperaci(op, dbx.repo, poklx.pos, hranice + 1)
    ok(`obnova ve stavu ${stav} → beze změny, bez dohledání`, r.stav === 'beze_zmeny' && poklx.dohledane.length === 0 && dbx.volani.length === 0)
  }

  // N18: dohledání je ČTENÍ — pustí se i u pokladny, která zápis přes API (už) neumí.
  const db7 = novaDatabaze(nejasna)
  const pokl7 = novaPokladna({ schopnost: 'rucne' })
  pokl7.provedeno.add('ftjp0001')
  const rucne = await obnovitOperaci(nejasna, db7.repo, pokl7.pos, hranice + 1)
  ok('pokladna se schopností „rucne", ale s dohledáním: obnova dohledá a uloží úspěch (nejasná operace má východ)',
    rucne.stav === 'uspech' && pokl7.dohledane.length === 1 && db7.op.stav === 'uspech')
  const db7b = novaDatabaze(nejasna)
  const pokl7b = novaPokladna({ schopnost: 'nepodporovano' })
  const poPlatnosti = await obnovitOperaci(nejasna, db7b.repo, pokl7b.pos, hranice + 1)
  ok('… „nepodporovano" s dohledáním, po platnosti nenalezeno → chyba (jde zkusit znovu / zrušit schválení)',
    poPlatnosti.stav === 'chyba' && pokl7b.dohledane.length === 1 && db7b.op.stav === 'chyba')
  ok('… a nikdy nic neodeslala', pokl7.odeslane.length === 0 && pokl7b.odeslane.length === 0)
  const db8 = novaDatabaze(nejasna)
  const pokl8 = novaPokladna({ schopnost: 'rucne', bezDohledat: true })
  const bezDohl = await obnovitOperaci(nejasna, db8.repo, pokl8.pos, hranice + 1)
  ok('pokladna bez dohledání: obnova beze změny, nic nevolá ani neukládá', bezDohl.stav === 'beze_zmeny' && /neumí požadavek dohledat/.test(bezDohl.duvod) && db8.volani.length === 0)
}

console.log('\n== Úspěch jen u uzavřeného, zaplaceného odpisu (N17) ==')
{
  const ucet = (detail) => ({ stav: 'nalezeno', externiId: 'POS-555', doklad: '2026-000555', detail })
  const NEDOKONCENE = [
    ['otevřený účet (status new/parked)', { stav: 'otevreny', zaplaceno: false, odpis: false }],
    ['uzavřený, ale nezaplacený', { stav: 'uzavreny', zaplaceno: false, odpis: true }],
    ['uzavřený a zaplacený, ale ne odpisem (hotově/kartou)', { stav: 'uzavreny', zaplaceno: true, odpis: false }],
    ['neznámý stav účtu', { stav: 'neznamy', zaplaceno: true, odpis: true }],
    ['detail bez údaje o zaplacení', { stav: 'uzavreny', odpis: true }],
    ['prázdný detail', {}],
  ]
  for (const [popis, detail] of NEDOKONCENE) {
    const db = novaDatabaze(operace())
    const pokl = novaPokladna({ dohledat: [ucet(detail)] })
    const r = await provestOperaci(operace(), db.repo, pokl.pos, TED)
    ok(`provedení: dohledán ${popis} → nejasný výsledek s větou o neuzavřeném účtu, ne úspěch`,
      r.stav === 'nejasny_vysledek' && r.duvod === lib.HLASKA_UCET_NEDOKONCENY && db.op.stav === 'nejasny_vysledek')
  }
  const dbOk = novaDatabaze(operace())
  const poklOk = novaPokladna({ dohledat: [ucet({ stav: 'uzavreny', zaplaceno: true, odpis: true })] })
  const rOk = await provestOperaci(operace(), dbOk.repo, poklOk.pos, TED)
  ok('provedení: uzavřený, zaplacený odpis → úspěch (s detailem)', rOk.stav === 'uspech' && rOk.externiId === 'POS-555' && rOk.vysledek.odpis === true && dbOk.op.stav === 'uspech')

  const platnostDo = new Date(TED).toISOString()
  const nejasna = operace({ stav: 'nejasny_vysledek', platnostDo, pokusu: 1 })
  for (const [popis, detail] of NEDOKONCENE.slice(0, 3)) {
    const db = novaDatabaze(nejasna)
    const pokl = novaPokladna({ dohledat: [ucet(detail)] })
    const r = await obnovitOperaci(nejasna, db.repo, pokl.pos, TED + REZERVA_PO_PLATNOSTI_MS + 60 * 60_000)
    ok(`obnova (i dlouho po platnosti): ${popis} → beze změny s větou, nic neuloženo (ani „chyba" — účet je)`,
      r.stav === 'beze_zmeny' && r.duvod === lib.HLASKA_UCET_NEDOKONCENY && db.pocet('dokoncit') === 0 && db.op.stav === 'nejasny_vysledek')
  }
  ok('věta říká, co ověřit', /není uzavřený a zaplacený Odpisem/.test(lib.HLASKA_UCET_NEDOKONCENY) && /ověřte ho v pokladně/.test(lib.HLASKA_UCET_NEDOKONCENY))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO (prošlo ${proslo} z ${proslo + chyb})` : `\nVšechny kontroly prošly: ${proslo} z ${proslo}`)
process.exit(chyb ? 1 : 0)
