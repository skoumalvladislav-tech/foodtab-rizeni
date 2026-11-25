#!/usr/bin/env node
/**
 * Pobočky a platební účty (Finance Fáze 0, krok 3) —
 * lib/finance-ucty-pobocek.ts, úprava účtu v lib/finance-platby-pobocka.ts
 * a to, že je stránky Financí doopravdy používají.
 *
 * Pusť `node scripts/finance-ucty-pobocek.test.mjs`.
 *
 * Nejcennější kontroly:
 *   1. „Pobočky bez účtu" má JEDNU definici — databázovou funkci
 *      pobocky_bez_aktivniho_uctu. Chyba jejího volání NENÍ prázdný
 *      seznam (ten by znamenal „všechny pobočky mají účet").
 *   2. Věta pro pobočku bez účtu říká, kde se účet přiřazuje, JEN tomu,
 *      kdo to smí (Správa financí za celou firmu).
 *   3. Úprava účtu posílá do databáze jen změny; současná pobočka (i
 *      vypnutá nebo smazaná) se „Uložit" nepřesune; prázdný výběr je chyba.
 *   4. Žádná stránka si „bez účtu" nepočítá sama (zdrojové kontroly dole).
 *
 * Databázovou stranu (funkce, politika úpravy, granty, spoušť) zkouší
 * supabase/tests/krok113_scenar.sql.
 */

import { readFileSync } from 'node:fs'

const {
  nactiPobockyBezUctu, maPobockaAktivniUcet, vetaPobockyBezUctu, hlaskaBezUctuPobocky, popisUctuPlatby,
  uctyMimoAktivnichPobocek, vetaUctuMimoPobocky, CHYBA_POBOCEK_BEZ_UCTU, FIREMNI_UCET, FIREMNI_VOLBA, KOTVA_UCTU,
  vetaUctuPobocky, nactiUctyMimoPobocek, vetaUctuMimoPobocekFirmy, CHYBA_UCTU_MIMO_POBOCKY, hlaskaZalozeniPripojeni,
  adresaUctu, mistoHlaskyUctu, PRAVO_SPRAVY_FINANCI, KDO_SPRAVUJE_UCTY,
} = await import('../lib/finance-ucty-pobocek.ts')
const { upravaUctu, hodnotaPobockyUctu } = await import('../lib/finance-platby-pobocka.ts')

let chyb = 0
/** Kontrola s pevným jménem; výjimka v ní je selhání TÉTO kontroly, ne konec běhu. */
const ok = (popis, podminka) => {
  let vysledek = false
  let duvod = ''
  try {
    vysledek = typeof podminka === 'function' ? Boolean(podminka()) : Boolean(podminka)
  } catch (e) {
    duvod = ` — výjimka: ${e?.message ?? e}`
  }
  if (!vysledek) chyb++
  console.log(`  ${vysledek ? 'OK   ' : 'CHYBA'} ${popis}${duvod}`)
}
const okAsync = async (popis, fn) => {
  let vysledek = false
  let duvod = ''
  try {
    vysledek = Boolean(await fn())
  } catch (e) {
    duvod = ` — výjimka: ${e?.message ?? e}`
  }
  if (!vysledek) chyb++
  console.log(`  ${vysledek ? 'OK   ' : 'CHYBA'} ${popis}${duvod}`)
}

const FIRMA = 't-firma'
const BERNARD = 'b-bernard'
const PERLA = 'b-perla'
const VYPNUTA = 'b-vypnuta'

console.log('\n== nactiPobockyBezUctu: jedna funkce, chyba není prázdný seznam ==')

/** Podvržené volání databáze: zapamatuje si, s čím se volalo, a vrátí `odpoved`. */
const podvrh = (odpoved) => {
  const volani = []
  const rpc = (fn, argumenty) => {
    volani.push({ fn, argumenty })
    if (odpoved instanceof Error) return Promise.reject(odpoved)
    return Promise.resolve(odpoved)
  }
  return { rpc, volani }
}

await okAsync('volá pobocky_bez_aktivniho_uctu s firmou a bez pobočky (celá firma)', async () => {
  const { rpc, volani } = podvrh({ data: [], error: null })
  await nactiPobockyBezUctu(rpc, FIRMA)
  return volani.length === 1 && volani[0].fn === 'pobocky_bez_aktivniho_uctu'
    && volani[0].argumenty.p_tenant === FIRMA && volani[0].argumenty.p_branch === null
})
await okAsync('s pobočkou ji pošle jako p_branch', async () => {
  const { rpc, volani } = podvrh({ data: [], error: null })
  await nactiPobockyBezUctu(rpc, FIRMA, BERNARD)
  return volani[0]?.argumenty.p_branch === BERNARD
})
await okAsync('řádky funkce → pobočky (id a název, pořadí z databáze)', async () => {
  const { rpc } = podvrh({ data: [{ pobocka_id: BERNARD, nazev: 'Bernard Bar Tábor' }, { pobocka_id: PERLA, nazev: 'Restaurace Černá Perla' }], error: null })
  const v = await nactiPobockyBezUctu(rpc, FIRMA)
  return v.stav === 'ok' && v.pobocky.length === 2 && v.pobocky[0].branchId === BERNARD && v.pobocky[1].nazev === 'Restaurace Černá Perla'
})
await okAsync('chyba databáze (42501) → stav chyba s kódem, NE prázdný seznam', async () => {
  const { rpc } = podvrh({ data: null, error: { code: '42501', message: 'Nemáte oprávnění' } })
  const v = await nactiPobockyBezUctu(rpc, FIRMA)
  return v.stav === 'chyba' && v.text === CHYBA_POBOCEK_BEZ_UCTU && v.kod === '42501'
})
await okAsync('data, která nejsou seznam → chyba', async () => {
  const { rpc } = podvrh({ data: { pobocka_id: BERNARD }, error: null })
  return (await nactiPobockyBezUctu(rpc, FIRMA)).stav === 'chyba'
})
await okAsync('řádek bez id pobočky → chyba (ne „pobočka bez jména")', async () => {
  const { rpc } = podvrh({ data: [{ nazev: 'Bernard' }], error: null })
  return (await nactiPobockyBezUctu(rpc, FIRMA)).stav === 'chyba'
})
await okAsync('volání, které spadne výjimkou → chyba, ne výjimka ven', async () => {
  const { rpc } = podvrh(new Error('spojení spadlo'))
  return (await nactiPobockyBezUctu(rpc, FIRMA)).stav === 'chyba'
})

console.log('\n== maPobockaAktivniUcet ==')
ok('pobočka v seznamu → nemá (false)', maPobockaAktivniUcet({ stav: 'ok', pobocky: [{ branchId: BERNARD, nazev: 'B' }] }, BERNARD) === false)
ok('pobočka mimo seznam → má (true)', maPobockaAktivniUcet({ stav: 'ok', pobocky: [{ branchId: BERNARD, nazev: 'B' }] }, PERLA) === true)
ok('chyba → nevíme (null), ne „má" ani „nemá"', maPobockaAktivniUcet({ stav: 'chyba', text: 'x' }, BERNARD) === null)

console.log('\n== Věta pro Celou firmu: které pobočky nemají účet ==')
const jedna = vetaPobockyBezUctu([{ branchId: BERNARD, nazev: 'Bernard Bar Tábor' }])
const dve = vetaPobockyBezUctu([{ branchId: BERNARD, nazev: 'Bernard Bar Tábor' }, { branchId: PERLA, nazev: 'Restaurace Černá Perla' }])
const tri = vetaPobockyBezUctu([{ branchId: 'a', nazev: 'A' }, { branchId: 'b', nazev: 'B' }, { branchId: 'c', nazev: 'C' }])
ok('žádná pobočka bez účtu → nic se neříká (null)', vetaPobockyBezUctu([]) === null)
ok(`jedna pobočka: jménem, „nemá aktivní platební účet" a že není v součtech po pobočkách — naměřeno: ${jedna}`,
  /^Pobočka Bernard Bar Tábor nemá aktivní platební účet/.test(jedna ?? '') && /v součtech po pobočkách nejsou/.test(jedna ?? ''))
ok('… a řekne, kde jsou peníze firemního účtu (jen v číslech celé firmy)', /jen v číslech celé firmy/.test(jedna ?? ''))
ok(`dvě pobočky: „A a B … nemají" — naměřeno: ${dve}`,
  /^Pobočky Bernard Bar Tábor a Restaurace Černá Perla nemají aktivní platební účet/.test(dve ?? '') && /jejich příjmy a výdaje/.test(dve ?? ''))
ok(`tři pobočky: „A, B a C" — naměřeno: ${tri}`, /^Pobočky A, B a C nemají/.test(tri ?? ''))
ok('pobočka bez jména se neztratí', /Pobočka bez názvu/.test(vetaPobockyBezUctu([{ branchId: 'x', nazev: '  ' }]) ?? ''))

console.log('\n== Věta pro pobočku bez účtu: kde se účet přiřazuje, jen tomu, kdo smí ==')
const smi = hlaskaBezUctuPobocky(true)
const nesmi = hlaskaBezUctuPobocky(false)
ok(`kdo smí (finance.manage za celou firmu): cesta Celá firma → Platby → Platební účty — naměřeno: ${smi}`,
  /Celá firma → Platby → Platební účty/.test(smi))
ok(`kdo nesmí: žádná cesta, jen kdo to udělá — naměřeno: ${nesmi}`,
  !/→/.test(nesmi) && !/přiřadíte/.test(nesmi) && nesmi.includes(KDO_SPRAVUJE_UCTY))
ok('obě řeknou, že pobočka nemá AKTIVNÍ účet a čísla se nedají spočítat',
  [smi, nesmi].every((t) => /nemá aktivní platební účet/.test(t) && /nedají spočítat/.test(t)))

// Právo se jmenuje tak, jak ho majitel vidí v Nastavení → Role (katalog
// permissions) — dřív hlášky psaly „Správa financí", právo, které tam není.
{
  const katalog = readFileSync(new URL('../supabase/migrations/20260823120100_catalog.sql', import.meta.url), 'utf8')
  const nazev = katalog.match(/\('finance\.manage',\s*'finance',\s*'([^']+)'/)?.[1] ?? ''
  ok(`název práva v hláškách = název finance.manage v katalogu — katalog: ${nazev}`,
    nazev.length > 0 && PRAVO_SPRAVY_FINANCI === nazev && KDO_SPRAVUJE_UCTY === `ten, kdo má právo „${nazev}“ za celou firmu`)
}

console.log('\n== Věta pro stránku pobočky (Platby bez faktury): chyba se řekne ==')
ok('nemá účet → „Pobočka nemá aktivní platební účet."',
  vetaUctuPobocky({ stav: 'ok', pobocky: [{ branchId: BERNARD, nazev: 'B' }] }, BERNARD)?.text === 'Pobočka nemá aktivní platební účet.'
    && vetaUctuPobocky({ stav: 'ok', pobocky: [{ branchId: BERNARD, nazev: 'B' }] }, BERNARD)?.chyba === false)
ok('má účet → nic (null)', vetaUctuPobocky({ stav: 'ok', pobocky: [{ branchId: BERNARD, nazev: 'B' }] }, PERLA) === null)
{
  const v = vetaUctuPobocky({ stav: 'chyba', text: CHYBA_POBOCEK_BEZ_UCTU }, BERNARD)
  ok('chyba zjištění → věta o chybě (chyba: true), NE mlčení jako u pobočky s účtem',
    v !== null && v.chyba === true && v.text === CHYBA_POBOCEK_BEZ_UCTU)
}

console.log('\n== Sloupec „Účet / pobočka" a účty mimo aktivní pobočky ==')
const POBOCKY = [
  { id: BERNARD, name: 'Bernard Bar', active: true },
  { id: VYPNUTA, name: 'Stará výdejna', active: false },
]
ok('platba firemního účtu je výslovně označená', popisUctuPlatby({ nazev: 'Hlavní', branch_id: null }, POBOCKY).kam === FIREMNI_UCET
  && FIREMNI_UCET === 'Firemní účet (bez pobočky)')
ok('účet aktivní pobočky → její jméno', popisUctuPlatby({ nazev: 'KB', branch_id: BERNARD }, POBOCKY).kam === 'Bernard Bar')
ok('účet vypnuté pobočky → „(vypnutá)"', popisUctuPlatby({ nazev: 'KB', branch_id: VYPNUTA }, POBOCKY).kam === 'Stará výdejna (vypnutá)')
ok('účet smazané nebo cizí pobočky → „Pobočka mimo seznam", nepředstírá firemní', popisUctuPlatby({ nazev: 'KB', branch_id: 'b-smazana' }, POBOCKY).kam === 'Pobočka mimo seznam')
ok('platba bez načteného účtu → pomlčka, ne firemní účet', popisUctuPlatby(null, POBOCKY).ucet === '—' && popisUctuPlatby(null, POBOCKY).kam === '')

const mimo = uctyMimoAktivnichPobocek([
  { id: 'u-firma', nazev: 'Firemní', branch_id: null },
  { id: 'u-bernard', nazev: 'Bernard', branch_id: BERNARD },
  { id: 'u-vypnuta', nazev: 'Výdejna', branch_id: VYPNUTA },
  { id: 'u-smazana', nazev: 'Smazaná', branch_id: 'b-smazana' },
], POBOCKY)
ok(`najde účty na vypnuté a smazané/cizí pobočce, ne firemní ani aktivní — naměřeno: ${mimo.map((u) => `${u.id}:${u.duvod}`).join(', ')}`,
  mimo.length === 2 && mimo[0].id === 'u-vypnuta' && mimo[0].duvod === 'vypnuta' && mimo[1].id === 'u-smazana' && mimo[1].duvod === 'mimo_seznam')
ok('věta u účtu mimo pobočky: platby nejsou v součtech, nic se nepřesune samo',
  mimo.every((u) => /nepočítají do součtů/.test(vetaUctuMimoPobocky(u)) && /sám se nepřesune/.test(vetaUctuMimoPobocky(u))))

console.log('\n== Účty mimo aktivní pobočky pro stránky celé firmy (Přehled, Cashflow, Rozpočty) ==')
/**
 * Podvržený klient Supabase: `from(tabulka)` vrátí řetěz, který si
 * pamatuje filtry a na `await` vrátí odpověď pro tu tabulku.
 */
const klient = (odpovedi) => {
  const filtry = []
  return {
    filtry,
    from(tabulka) {
      const retez = {
        select() { return retez },
        eq(sloupec, hodnota) { filtry.push(`${tabulka}.${sloupec}=${hodnota}`); return retez },
        is(sloupec, hodnota) { filtry.push(`${tabulka}.${sloupec} is ${hodnota}`); return retez },
        then(ano, ne) {
          const o = odpovedi[tabulka]
          return (o instanceof Error ? Promise.reject(o) : Promise.resolve(o)).then(ano, ne)
        },
      }
      return retez
    },
  }
}
const UCTY = [
  { id: 'u-firma', nazev: 'Firemní', branch_id: null },
  { id: 'u-bernard', nazev: 'Bernard', branch_id: BERNARD },
  { id: 'u-vypnuta', nazev: 'Výdejna', branch_id: VYPNUTA },
  { id: 'u-smazana', nazev: 'Smazaná', branch_id: 'b-smazana' },
]
await okAsync('načte účty a nesmazané pobočky firmy a najde účty na vypnuté a smazané pobočce', async () => {
  const k = klient({ platebni_ucty: { data: UCTY, error: null }, branches: { data: POBOCKY, error: null } })
  const v = await nactiUctyMimoPobocek(k, FIRMA)
  return v.stav === 'ok' && v.ucty.map((u) => u.id).join(',') === 'u-vypnuta,u-smazana'
    && k.filtry.includes(`platebni_ucty.tenant_id=${FIRMA}`) && k.filtry.includes(`branches.tenant_id=${FIRMA}`)
    && k.filtry.includes('branches.deleted_at is null')
})
// Chyba i s prázdným seznamem v `data` — rozhodnout musí `.error`, ne tvar dat.
await okAsync('chyba dotazu na účty → stav chyba, NE „žádný účet mimo pobočky"', async () => {
  const v = await nactiUctyMimoPobocek(klient({ platebni_ucty: { data: [], error: { code: '42501' } }, branches: { data: POBOCKY, error: null } }), FIRMA)
  return v.stav === 'chyba' && v.text === CHYBA_UCTU_MIMO_POBOCKY
})
await okAsync('chyba dotazu na pobočky → stav chyba (jinak by každý účet pobočky vypadal „mimo seznam")', async () => {
  const v = await nactiUctyMimoPobocek(klient({ platebni_ucty: { data: UCTY, error: null }, branches: { data: [], error: { code: 'XX000' } } }), FIRMA)
  return v.stav === 'chyba'
})
await okAsync('výjimka nebo data, která nejsou seznam → stav chyba, ne výjimka ven', async () => {
  const a = await nactiUctyMimoPobocek(klient({ platebni_ucty: new Error('spojení'), branches: { data: POBOCKY, error: null } }), FIRMA)
  const b = await nactiUctyMimoPobocek(klient({ platebni_ucty: { data: {}, error: null }, branches: { data: POBOCKY, error: null } }), FIRMA)
  return a.stav === 'chyba' && b.stav === 'chyba'
})
{
  const jeden = vetaUctuMimoPobocekFirmy([{ id: 'u', nazev: 'KB Výdejna', duvod: 'vypnuta', pobocka: 'Výdejna' }])
  const dva = vetaUctuMimoPobocekFirmy([{ id: 'u', nazev: 'A', duvod: 'vypnuta', pobocka: 'X' }, { id: 'v', nazev: 'B', duvod: 'mimo_seznam', pobocka: null }])
  ok('žádný účet mimo pobočky → nic (null)', vetaUctuMimoPobocekFirmy([]) === null)
  ok(`jeden účet: jménem, že jeho platby nejsou v součtech po pobočkách ani ve firemních účtech — naměřeno: ${jeden}`,
    /^Platební účet „KB Výdejna“ patří vypnuté nebo smazané pobočce/.test(jeden ?? '') && /nejsou v součtech po pobočkách ani ve firemních účtech/.test(jeden ?? ''))
  ok(`dva účty: „A“ a „B“, množné číslo — naměřeno: ${dva}`, /^Platební účty „A“ a „B“ patří/.test(dva ?? '') && /jejich platby/.test(dva ?? ''))
}

console.log('\n== Připojení banky k vypnutému účtu: věta, ne „nepodařilo" ==')
{
  const migraceKroku = readFileSync(new URL('../supabase/migrations/20261121100000_pobocky_ucty.sql', import.meta.url), 'utf8')
  const hlaskaSpouste = migraceKroku.match(/raise exception '(Platební účet je vypnutý[^']*)'/)?.[1] ?? ''
  ok('hláška spouště připojení k vypnutému účtu se v migraci našla', hlaskaSpouste.length > 0)
  const v = hlaskaZalozeniPripojeni({ code: '23514', message: hlaskaSpouste })
  ok(`23514 ze spouště → účet je vypnutý a kde ho zapnout — naměřeno: ${v}`,
    /vypnutý/.test(v) && /Celá firma → Platby → Platební účty/.test(v))
  ok('23505 → účet už má živé připojení', hlaskaZalozeniPripojeni({ code: '23505', message: 'duplicate' }) === 'Tenhle platební účet už má živé bankovní připojení.')
  ok('jiná chyba i žádná → obecná věta',
    hlaskaZalozeniPripojeni(null) === 'Připojení se nepodařilo založit.'
      && hlaskaZalozeniPripojeni({ code: '23514', message: 'Pobočka nepatří této firmě.' }) === 'Připojení se nepodařilo založit.')
}

console.log('\n== Hláška po úpravě účtu: u účtu, kam stránka sjede ==')
{
  const chybaAdresa = adresaUctu('firma', { chyba: 'IBAN nesedí' }, 'u-1')
  ok(`chyba: adresa s textem, id účtu a kotvou sekce účtů — naměřeno: ${chybaAdresa}`,
    chybaAdresa === `/firma/finance/platby?chyba=${encodeURIComponent('IBAN nesedí')}&ucet=u-1#${KOTVA_UCTU}`)
  ok('uloženo: ucet_upraven=1 a id účtu', adresaUctu('firma', { upraveno: true }, 'u-1') === `/firma/finance/platby?ucet_upraven=1&ucet=u-1#${KOTVA_UCTU}`)
  ok('účet neznámý: prázdné ucet (hláška na začátek sekce)', adresaUctu('firma', { chyba: 'x' }, null).endsWith(`&ucet=#${KOTVA_UCTU}`))
  ok('bez ucet v adrese → nahoře (zápis platby, import…)', mistoHlaskyUctu(undefined, ['u-1']).kde === 'nahore')
  const u = mistoHlaskyUctu('u-1', ['u-0', 'u-1'])
  ok('ucet jednoho z vypsaných účtů → u něj', u.kde === 'ucet' && u.id === 'u-1')
  ok('ucet prázdné nebo neznámé → začátek sekce účtů, ne nahoře',
    mistoHlaskyUctu('', ['u-1']).kde === 'sekce' && mistoHlaskyUctu('u-cizi', ['u-1']).kde === 'sekce')
  ok('ucet dvakrát v adrese (pole) → nahoře, nic se nehádá', mistoHlaskyUctu(['u-1', 'u-1'], ['u-1']).kde === 'nahore')
}

console.log('\n== upravaUctu: jen změny, současná pobočka se nepřesune ==')
// Číslo účtu tak, jak ho ukládá appka (overitCisloUctu → IBAN).
const UCET = { nazev: 'KB Bernard', branch_id: BERNARD, cislo_uctu: 'CZ6508000000192000145399', aktivni: true }
const beze = (ucet, pobocka) => ({ nazev: ucet.nazev, cislo: ucet.cislo_uctu, aktivni: ucet.aktivni, pobocka })
ok('beze změny → nic se nezapisuje', upravaUctu(UCET, beze(UCET, BERNARD), [BERNARD]).stav === 'beze_zmeny')
{
  const v = upravaUctu(UCET, { ...beze(UCET, BERNARD), nazev: '  KB Bernard nový ' }, [BERNARD])
  ok('změna názvu → jen nazev (ořezaný), bez pobočky', v.stav === 'ok' && JSON.stringify(v.zmeny) === JSON.stringify({ nazev: 'KB Bernard nový' }))
}
{
  const v = upravaUctu(UCET, beze(UCET, FIREMNI_VOLBA), [])
  ok('pobočka → Firemní účet: branch_id null', v.stav === 'ok' && 'branch_id' in v.zmeny && v.zmeny.branch_id === null)
}
{
  const v = upravaUctu(UCET, beze(UCET, PERLA), [PERLA])
  ok('na jinou AKTIVNÍ pobočku firmy → branch_id té pobočky', v.stav === 'ok' && v.zmeny.branch_id === PERLA)
}
ok('na pobočku mimo aktivní pobočky firmy (vypnutá, cizí) → chyba, ne zápis',
  upravaUctu(UCET, beze(UCET, VYPNUTA), [PERLA]).stav === 'chyba' && upravaUctu(UCET, beze(UCET, 'b-cizi'), []).stav === 'chyba')
ok('prázdný výběr pobočky → chyba (ne „firemní")', upravaUctu(UCET, beze(UCET, ''), [BERNARD]).stav === 'chyba'
  && upravaUctu(UCET, beze(UCET, null), [BERNARD]).stav === 'chyba')
{
  const veVypnute = { ...UCET, branch_id: VYPNUTA }
  ok('účet ve vypnuté pobočce + „Uložit" beze změny → nic (pobočka zůstane, i když není mezi povolenými)',
    upravaUctu(veVypnute, beze(veVypnute, VYPNUTA), []).stav === 'beze_zmeny')
  const v = upravaUctu(veVypnute, { ...beze(veVypnute, VYPNUTA), nazev: 'Jiný název' }, [])
  ok('účet ve smazané/vypnuté pobočce: změna názvu NEPOSÍLÁ pobočku (spoušť by ji kontrolovala)',
    v.stav === 'ok' && !('branch_id' in v.zmeny) && v.zmeny.nazev === 'Jiný název')
}
{
  const firemni = { ...UCET, branch_id: null }
  ok('firemní účet + „Uložit" s Firemním účtem → nic', upravaUctu(firemni, beze(firemni, hodnotaPobockyUctu(null)), []).stav === 'beze_zmeny'
    && hodnotaPobockyUctu(null) === FIREMNI_VOLBA)
}
ok('prázdný název → chyba', upravaUctu(UCET, { ...beze(UCET, BERNARD), nazev: '   ' }, [BERNARD]).stav === 'chyba')
ok('neplatný IBAN → chyba, ne uložení', upravaUctu(UCET, { ...beze(UCET, BERNARD), cislo: 'CZ00 0000 0000 0000 0000 0001' }, [BERNARD]).stav === 'chyba')
{
  const v = upravaUctu(UCET, { ...beze(UCET, BERNARD), cislo: '19-2000145399/0800' }, [BERNARD])
  ok('totéž číslo jiným zápisem (české číslo místo IBAN) → beze změny', v.stav === 'beze_zmeny')
  const w = upravaUctu(UCET, { ...beze(UCET, BERNARD), cislo: ' CZ65 0800 0000 1920 0014 5399 ' }, [BERNARD])
  ok('totéž IBAN s mezerami → beze změny', w.stav === 'beze_zmeny')
  const stary = { ...UCET, cislo_uctu: '19-2000145399/0800' }
  ok('starší zápis čísla, pole nedotčené → číslo se tiše nepřepíše', upravaUctu(stary, beze(stary, BERNARD), [BERNARD]).stav === 'beze_zmeny')
  const spatny = { ...UCET, cislo_uctu: 'neplatné číslo' }
  const n = upravaUctu(spatny, { ...beze(spatny, BERNARD), nazev: 'Nový název' }, [BERNARD])
  ok('neplatné uložené číslo neblokuje změnu názvu (pole nedotčené)', n.stav === 'ok' && JSON.stringify(n.zmeny) === JSON.stringify({ nazev: 'Nový název' }))
  const jine = upravaUctu(UCET, { ...beze(UCET, BERNARD), cislo: 'CZ5508000000001234567899' }, [BERNARD])
  ok('jiné platné číslo → cislo_uctu v ověřeném tvaru', jine.stav === 'ok' && jine.zmeny.cislo_uctu === 'CZ5508000000001234567899')
}
{
  const v = upravaUctu(UCET, { ...beze(UCET, BERNARD), cislo: '' }, [BERNARD])
  ok('smazané číslo účtu → cislo_uctu ""', v.stav === 'ok' && v.zmeny.cislo_uctu === '')
  const w = upravaUctu(UCET, { ...beze(UCET, BERNARD), aktivni: false }, [BERNARD])
  ok('vypnutí → jen aktivni false', w.stav === 'ok' && JSON.stringify(w.zmeny) === JSON.stringify({ aktivni: false }))
}

console.log('\n== Zdroj: databáze a stránky to doopravdy používají ==')
const zdroj = (cesta) => readFileSync(new URL(`../${cesta}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const migrace = zdroj('supabase/migrations/20261121100000_pobocky_ucty.sql')
const funkce = migrace.match(/create function public\.pobocky_bez_aktivniho_uctu[\s\S]*?\nend \$\$;/)?.[0] ?? ''
ok('migrace: funkce se našla a je SECURITY INVOKER', funkce.length > 0 && /security invoker/.test(funkce) && !/security definer/.test(funkce))
ok('migrace: bez finance.read 42501, ne prázdný seznam', /raise exception[^;]*42501/.test(funkce))
ok('migrace: počítá jen AKTIVNÍ účet téže firmy a pobočky bez smazaných',
  /u\.aktivni/.test(funkce) && /u\.tenant_id = p_tenant/.test(funkce) && /u\.branch_id = b\.id/.test(funkce) && /b\.deleted_at is null/.test(funkce))
ok('migrace: úprava účtu jen se Správou financí ZA CELOU FIRMU',
  /create policy platebni_ucty_update on public\.platebni_ucty for update to authenticated\s+using \(app\.has_access\(tenant_id, 'finance\.manage', null\)\)\s+with check \(app\.has_access\(tenant_id, 'finance\.manage', null\)\)/.test(migrace)
  && /drop policy platebni_ucty_write/.test(migrace))
ok('migrace: měnit jde jen nazev, branch_id, cislo_uctu, aktivni',
  /revoke update on public\.platebni_ucty from authenticated;\s*grant update \(nazev, branch_id, cislo_uctu, aktivni\) on public\.platebni_ucty to authenticated;/.test(migrace))
ok('migrace: nic nepřepisuje ani nemaže (žádné update/delete/insert dat)',
  !/^\s*(update|delete from|insert into)\s+public\./im.test(migrace.replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '')))

const lib = (cesta) => zdroj(cesta)
ok('KPI: pobočka má účet podle pobocky_bez_aktivniho_uctu, ne vlastním počítáním účtů',
  /async function pobockaMaUcet[\s\S]*?nactiPobockyBezUctu\(/.test(lib('lib/finance-kpi.ts')) && !/from\('platebni_ucty'\)/.test(lib('lib/finance-kpi.ts')))
ok('KPI: když se funkce nepodaří zeptat, KPI spadne — ne „pobočka účet má"',
  /const ma = maPobockaAktivniUcet\(vysledek, pobocka\)\n(\s*\/\/[^\n]*\n)*\s*if \(ma === null\) throw /.test(lib('lib/finance-kpi.ts')))
ok('smiSpravovatUctyFirmy = finance.manage ZA CELOU FIRMU (hasAccess s null)',
  /export async function smiSpravovatUctyFirmy[\s\S]*?return hasAccess\(tenantId, 'finance\.manage', null\)/.test(lib('lib/finance-pristup.ts')))
ok('stará věta BEZ_UCTU_POBOCKY (cesta pro každého) zmizela', !/BEZ_UCTU_POBOCKY\s*=/.test(lib('lib/finance-evidence-pobocka.ts')))

const STRANKY = {
  'Přehled': 'app/[rozsah]/finance/page.tsx',
  'Platby': 'app/[rozsah]/finance/platby/page.tsx',
  'Platby bez faktury': 'app/[rozsah]/finance/platby/bez-faktury/page.tsx',
  'Cashflow': 'app/[rozsah]/finance/cashflow/page.tsx',
  'Rozpočty': 'app/[rozsah]/finance/rozpocty/page.tsx',
}
for (const [jmeno, cesta] of Object.entries(STRANKY)) {
  const s = zdroj(cesta)
  ok(`${jmeno}: „bez účtu" z nactiPobockyBezUctu a za celou firmu blok PobockyBezUctu se smiPrirazovat`,
    /nactiPobockyBezUctu\(\(fn, argumenty\) => supabase\.rpc\(fn, argumenty\), tenantId/.test(s)
      && /<PobockyBezUctu vysledek=\{[^}]+\} smiPrirazovat=\{smiSpravovatUcty\}/.test(s)
      && /smiSpravovatUctyFirmy\(tenantId, pristup\.ctx\)/.test(s))
  ok(`${jmeno}: nepočítá účty pobočky sám (žádné count platebni_ucty)`, !/from\('platebni_ucty'\)\s*\.select\('id', \{ count/.test(s))
}

const komponenta = zdroj('app/[rozsah]/finance/pobocky-bez-uctu.tsx')
ok('PobockyBezUctu: odkaz na Platby celé firmy jen se smiPrirazovat, chyba se řekne',
  /\{smiPrirazovat \? \(/.test(komponenta) && /\/\$\{TENANT_SCOPE_SEGMENT\}\/finance\/platby#\$\{KOTVA_UCTU\}/.test(komponenta)
    && /vysledek\.stav === 'chyba'/.test(komponenta) && KOTVA_UCTU === 'platebni-ucty')

const platby = zdroj('app/[rozsah]/finance/platby/page.tsx')
ok('Platby: sekce účtů celé firmy má kotvu, na kterou odkaz míří', /<section id=\{pobocka \? undefined : KOTVA_UCTU\}/.test(platby))
ok('Platby: nový účet — pobočka povinná, bez výchozí „Celá firma", firemní jen výslovnou volbou',
  /<select name="branch_id" required style=\{pole\} defaultValue="">\s*<option value="" disabled>/.test(platby)
    && /<option value=\{FIREMNI_VOLBA\}>\{FIREMNI_UCET\}<\/option>/.test(platby) && !/CELA_FIRMA/.test(platby))
ok('Platby: úprava účtu jen za celou firmu a jen se Správou financí za celou firmu',
  /\{!pobocka && smiSpravovatUcty \? \(\s*<form\s+action=\{upravitPlatebniUcet\}/.test(platby))
ok('Platby: sloupec „Účet / pobočka" jen za celou firmu',
  /\{!pobocka \? <th style=\{\{ padding: '6px 8px' \}\}>Účet \/ pobočka<\/th> : null\}/.test(platby) && /popisUctuPlatby\(/.test(platby))
ok('Platby: pobočka bez účtu — věta s místem přiřazení přes hlaskaBezUctuPobocky(smiSpravovatUcty)',
  /\{hlaskaBezUctuPobocky\(smiSpravovatUcty\)\}/.test(platby) && !/Existující účet přiřadíte pobočce v pohledu Celá firma/.test(platby))

const rozpocty = zdroj('app/[rozsah]/finance/rozpocty/page.tsx')
ok('Rozpočty: chyba rozpocet_prehled i vydelky_prehled se čte z .error, ne tiše na nulu',
  /if \(prehledRes\.error\) chybaPrehledu = true/.test(rozpocty) && /if \(!mzdyRes\.error\)/.test(rozpocty)
    && /\{chybaPrehledu \? \(/.test(rozpocty))
ok('Rozpočty: prime cost bez načtených mezd ani s chybou se nepočítá',
  /const primeCostProcento = !chybaPrehledu && mzdyHaleru !== null && trzby > 0/.test(rozpocty))
ok('Rozpočty: „chybí tržby" vysvětluje zdroj tržeb a nese ROZHODNOUT (otázka 151)',
  /ROZHODNOUT: \(otázka 151\)/.test(rozpocty) && /Tržby se v Rozpočtech berou jen z plateb zařazených do kategorie Tržby/.test(rozpocty))
ok('Rozpočty: chyba dotazu na pobočky se nemění na prázdný výběr (DotazSelhal), pobočky seřazené podle jména',
  /\.from\('branches'\)\s*\.select\('id, name'\)[^;]*\.order\('name'\)/.test(rozpocty)
    && /if \(branchesRes\.error\) throw new DotazSelhal\(/.test(rozpocty)
    && rozpocty.indexOf('if (branchesRes.error) throw') < rozpocty.indexOf('const branches = (branchesRes.data'))

console.log('\n== Zdroj: opravy po revizi kroku 3 ==')
// Účty mimo aktivní pobočky na stránkách celé firmy (Platby to říkají u účtu).
for (const [jmeno, cesta] of Object.entries({ 'Přehled': STRANKY['Přehled'], 'Cashflow': STRANKY['Cashflow'], 'Rozpočty': STRANKY['Rozpočty'] })) {
  const s = zdroj(cesta)
  ok(`${jmeno}: za celou firmu načte účty mimo aktivní pobočky a předá je bloku PobockyBezUctu`,
    /\? Promise\.resolve\(null\) : nactiUctyMimoPobocek\(supabase, tenantId\)/.test(s)
      && /<PobockyBezUctu vysledek=\{[^}]+\} smiPrirazovat=\{smiSpravovatUcty\} mimoPobocky=\{mimoPobocky\} \/>/.test(s))
}
ok('PobockyBezUctu: věta o účtech mimo pobočky i chyba jejich načtení se vykreslí',
  /vetaUctuMimoPobocekFirmy\(mimoPobocky\.ucty\)/.test(komponenta) && /mimoPobocky\?\.stav === 'chyba'\) chyby\.push\(mimoPobocky\.text\)/.test(komponenta)
    && /if \(chyby\.length === 0 && vety\.length === 0\) return null/.test(komponenta))
ok('PobockyBezUctu: kdo nesmí, dostane jméno práva z katalogu (KDO_SPRAVUJE_UCTY)',
  /Pobočku účtu přiřadí nebo opraví \{KDO_SPRAVUJE_UCTY\}/.test(komponenta) && !/Správa financí“/.test(komponenta))

ok('Platby: hláška z adresy se kreslí tam, kam patří — nahoře, na začátku sekce účtů a u účtu',
  /\{hlaskaZde\('nahore'\)\}/.test(platby) && /\{hlaskaZde\('sekce'\)\}/.test(platby) && /\{hlaskaZde\(u\.id\)\}/.test(platby)
    && /mistoHlaskyUctu\(ucetHlasky, vsechnyUcty\.map\(\(u\) => u\.id\)\)/.test(platby)
    && !/\{chyba \? <p/.test(platby) && !/\{ucetUpraven \? \(/.test(platby))
ok('Platby: hláška u účtu je za údaji účtu, před formulářem úpravy',
  platby.indexOf('{hlaskaZde(u.id)}') > platby.indexOf('vetaUctuMimoPobocky(mimo)')
    && platby.indexOf('{hlaskaZde(u.id)}') < platby.indexOf('action={upravitPlatebniUcet}'))

const bezFaktury = zdroj(STRANKY['Platby bez faktury'])
ok('Platby bez faktury: na pobočce věta přes vetaUctuPobocky — chyba zjištění se řekne, nemlčí',
  /const vetaUctu = pobocka \? vetaUctuPobocky\(bezUctu, pobocka\) : null/.test(bezFaktury)
    && /\{vetaUctu\?\.chyba \? <p role="status"/.test(bezFaktury) && !/maPobockaAktivniUcet\(bezUctu, pobocka\) === false/.test(bezFaktury))

const banka = zdroj('app/[rozsah]/finance/integrace/banka/akce.ts')
ok(`banka: všechna 4 založení připojení hlásí přes hlaskaZalozeniPripojeni (vypnutý účet, 23505) — naměřeno: ${(banka.match(/hlaskaZalozeniPripojeni\((chybaPripojeni|error)\)/g) ?? []).length}`,
  (banka.match(/hlaskaZalozeniPripojeni\((chybaPripojeni|error)\)/g) ?? []).length === 4
    && !/code === '23505' \? 'Tenhle platební účet už má živé bankovní připojení\.' : 'Připojení se nepodařilo založit\.'/.test(banka))

const importAkce = zdroj('app/[rozsah]/finance/platby/import/akce.ts')
ok('import výpisu: na vypnutý účet nic nezapíše — kontrola aktivni před zapsatVypis',
  /\.from\('platebni_ucty'\)\s*\.select\('aktivni'\)/.test(importAkce) && /if \(!ucet\.aktivni\) \{\s*redirect\(/.test(importAkce)
    && importAkce.indexOf('if (!ucet.aktivni)') < importAkce.indexOf('await zapsatVypis('))

// Žádný text pro člověka nejmenuje právo „Správa financí" (na obrazovce Role není).
for (const cesta of [
  'lib/finance-ucty-pobocek.ts', 'lib/finance-platby-pobocka.ts', 'app/[rozsah]/finance/platby/akce.ts',
  STRANKY['Platby'], STRANKY['Přehled'], STRANKY['Cashflow'], STRANKY['Rozpočty'], STRANKY['Platby bez faktury'],
  'app/[rozsah]/finance/pobocky-bez-uctu.tsx', 'app/[rozsah]/finance/platby/import/page.tsx',
  'app/[rozsah]/finance/platby/import/akce-nahled.ts', 'app/[rozsah]/finance/integrace/prodeje/page.tsx',
]) {
  ok(`${cesta}: žádné „Správa financí“ v textu`, !/„Správa financí“/.test(zdroj(cesta)))
}

ok('migrace: založení účtu jen se sloupci formuláře (revoke insert, grant insert na 5 sloupců)',
  /revoke insert on public\.platebni_ucty from authenticated;\s*grant insert \(tenant_id, branch_id, nazev, typ, cislo_uctu\) on public\.platebni_ucty to authenticated;/.test(migrace))
ok('migrace: spoušť připojení k vypnutému účtu na založení i změnu účtu, stavu a času odpojení',
  /create trigger trg_pripojeni_vypnuteho_uctu\s+before insert or update of platebni_ucet_id, stav, odpojeno_kdy on public\.integrace_pripojeni/.test(migrace))

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
