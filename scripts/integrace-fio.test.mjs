#!/usr/bin/env node
/**
 * Fio banka adaptér — čisté parsování, bez sítě. lib/integrace-fio.ts.
 *
 * Pusť `node --experimental-strip-types scripts/integrace-fio.test.mjs`.
 *
 * Vzorek odpovědi odpovídá tvaru z FIO API BANKOVNICTVÍ (v1.9,
 * 16.10.2025), kap. 5.3.1.6 — číslované `columnN` objekty, `Datum`
 * jako epoch v milisekundách (ne ISO text, na rozdíl od XML/CSV).
 */

const { naparsovatOdpovedFio } = await import('../lib/integrace-fio.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function sloupec(value, name, id) {
  return { value, name, id }
}

function vzorovaTransakce(zmeny = {}) {
  return {
    column22: sloupec(1148734530, 'ID pohybu', 22),
    // 1789423200000 = 2026-09-15T00:00:00+02:00 (PRAŽSKÁ půlnoc, CEST) —
    // záměrně ne UTC půlnoc. Dřívější fixtura (1727740800000, UTC
    // půlnoc) dávala stejný kalendářní den v UTC i v Praze, takže
    // schovala chybu: `toISOString().slice(0,10)` u skutečné pražské
    // půlnoci (jak Fio doopravdy posílá, viz API_Bankovnictvi.pdf
    // kap. 5.3.1.6) vrací den PŘEDTÍM.
    column0: sloupec(1789423200000, 'Datum', 0), // 2026-09-15T00:00:00+02:00
    column1: sloupec(1234.5, 'Objem', 1),
    column14: sloupec('CZK', 'Měna', 14),
    column2: sloupec('123456789', 'Protiúčet', 2),
    column10: sloupec('ABC s.r.o.', 'Název protiúčtu', 10),
    column5: sloupec('20260001', 'VS', 5),
    column16: sloupec('Platba za zboží', 'Zpráva pro příjemce', 16),
    ...zmeny,
  }
}

function odpoved(transaction, info = {}) {
  return {
    accountStatement: {
      info: {
        accountId: '2345678901',
        bankId: '2010',
        currency: 'CZK',
        iban: 'CZ1920100000002345678901',
        bic: 'FIOBCZPPXXX',
        openingBalance: 10000.0,
        closingBalance: 11234.5,
        dateStart: '2026-09-01+0200',
        dateEnd: '2026-09-30+0200',
        ...info,
      },
      transactionList: transaction === undefined ? undefined : { transaction },
    },
  }
}

console.log('\n== Šťastná cesta: jedna transakce (příjem) ==')

const v1 = naparsovatOdpovedFio(odpoved(vzorovaTransakce()))
ok('stav ok', v1.stav === 'ok')
ok('číslo účtu se přečetlo', v1.stav === 'ok' && v1.info.cisloUctu === '2345678901')
ok('kód banky se přečetl', v1.stav === 'ok' && v1.info.kodBanky === '2010')
ok('zůstatek v haléřích (closingBalance 11234.50 → 1123450)', v1.stav === 'ok' && v1.info.zustatekHaleru === 1123450)
ok('jeden řádek', v1.stav === 'ok' && v1.radky.length === 1)
ok('datum z PRAŽSKÉ půlnoci (1789423200000 → 2026-09-15, ne 2026-09-14)', v1.stav === 'ok' && v1.radky[0].datum === '2026-09-15')
ok('kladný Objem 1234,50 → příjem, 123450 haléřů', v1.stav === 'ok' && v1.radky[0].smer === 'prijem' && v1.radky[0].castkaHaleru === 123450)
ok('protistrana z Názvu protiúčtu', v1.stav === 'ok' && v1.radky[0].protistrana === 'ABC s.r.o.')
ok('VS se přečetl', v1.stav === 'ok' && v1.radky[0].vs === '20260001')
ok('poznámka ze Zprávy pro příjemce', v1.stav === 'ok' && v1.radky[0].poznamka === 'Platba za zboží')
ok('externí id je ID pohybu jako text', v1.stav === 'ok' && v1.radky[0].externiId === '1148734530')

console.log('\n== Záporný Objem → výdaj, kladné haléře (znaménko jen určuje směr) ==')

const v2 = naparsovatOdpovedFio(odpoved(vzorovaTransakce({ column1: sloupec(-500, 'Objem', 1) })))
ok('výdaj', v2.stav === 'ok' && v2.radky[0].smer === 'vydaj')
ok('haléře jsou kladné (50000), ne záporné', v2.stav === 'ok' && v2.radky[0].castkaHaleru === 50000)

console.log('\n== Bez nových pohybů Fio vrátí jen info, žádnou chybu ==')

const v3 = naparsovatOdpovedFio(odpoved(undefined))
ok('stav ok i bez pohybů', v3.stav === 'ok')
ok('prázdný seznam, ne pád', v3.stav === 'ok' && v3.radky.length === 0)
ok('info se přečetlo i tak', v3.stav === 'ok' && v3.info.cisloUctu === '2345678901')

console.log('\n== Jedna transakce chodí jako OBJEKT, ne pole (XML→JSON kvirk) ==')

const v4 = naparsovatOdpovedFio(odpoved(vzorovaTransakce()))
ok('jeden objekt se zabalí do seznamu', v4.stav === 'ok' && Array.isArray(v4.radky) && v4.radky.length === 1)

console.log('\n== Víc transakcí chodí jako pole ==')

const v5 = naparsovatOdpovedFio(odpoved([vzorovaTransakce(), vzorovaTransakce({ column22: sloupec(999, 'ID pohybu', 22) })]))
ok('dva řádky', v5.stav === 'ok' && v5.radky.length === 2)

console.log('\n== Chybějící protiúčet i název → protistrana je prázdný string, ne null/undefined ==')

const v6 = naparsovatOdpovedFio(odpoved(vzorovaTransakce({ column10: null, column2: null })))
ok('protistrana je prázdný string', v6.stav === 'ok' && v6.radky[0].protistrana === '')

console.log('\n== Poškozený řádek (chybí ID pohybu) se přeskočí, ne spadne celý import ==')

const v7 = naparsovatOdpovedFio(odpoved([vzorovaTransakce(), vzorovaTransakce({ column22: null })]))
ok('jen platný řádek prošel, poškozený se tiše přeskočil', v7.stav === 'ok' && v7.radky.length === 1)

console.log('\n== Neznámý/poškozený tvar odpovědi je chyba, ne pád ==')

ok('chybí accountStatement úplně', naparsovatOdpovedFio({}).stav === 'chyba')
ok('chybí info', naparsovatOdpovedFio({ accountStatement: {} }).stav === 'chyba')
ok('info bez accountId', naparsovatOdpovedFio(odpoved(vzorovaTransakce(), { accountId: undefined })).stav === 'chyba')
ok('null vstup', naparsovatOdpovedFio(null).stav === 'chyba')

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `SELHALO: ${chyb} kontrol`}`)
if (chyb > 0) process.exit(1)
