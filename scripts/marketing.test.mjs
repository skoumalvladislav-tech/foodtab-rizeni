#!/usr/bin/env node
/**
 * Marketing — texty obrazovky a jejich soulad s databází.
 *
 * Pusť `node --experimental-strip-types scripts/marketing.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO TO OVĚŘUJE A CO NE
 *
 * Že se seznam stavů v `lib/marketing-text.ts` KRYJE s omezením sloupce
 * v migraci. Tohle je přesně ten druh nesouladu, který nikdo nenajde:
 * někdo přidá do databáze nový stav, obrazovka pro něj nemá překlad
 * a ve sloupci se objeví `publikace_selhala` místo věty. Nespadne nic,
 * jen to vypadá jako chyba v datech.
 *
 * Že se příspěvek vůbec do některého stavu dostane, hlídají scénáře
 * marketing3 a marketing5. Tady jde o obrazovku.
 *
 * Obrazovka je serverová komponenta a mimo aplikaci se vykreslit nedá.
 * Poslední kontrola v souboru je proto o tom, že ty funkce OPRAVDU
 * VOLÁ — jinak by se ověřovalo něco, co na obrazovku nevede.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STAVY_CHYBOVE,
  STAVY_PRISPEVKU,
  STROP_VYRAZU,
  VIDEO_MAX,
  VIDEO_MIN,
  delkaVidea,
  neboNull,
  popisStavu,
  seznamVyrazu,
} from '../lib/marketing-text.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano),
     `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

const cti = (relativni) => fs.readFileSync(path.join(ROOT, relativni), 'utf8')

const OBSAH = cti('supabase/migrations/20260909200000_marketing_obsah.sql')
const PODKLADY = cti('supabase/migrations/20260909180000_marketing_podklady.sql')

console.log('\n== Stavy příspěvku se kryjí s databází ==')

/*
  Vyříznutí ze zdrojáku. Kdyby regulární výraz nesedl, vyšel by prázdný
  seznam a všechny kontroly níž by byly zelené nad ničím — proto se
  nejdřív ověřuje, že se vyříznutí povedlo.
*/
const blok = OBSAH.match(/stav\s+text not null default 'koncept' check \(stav in \(([\s\S]*?)\)\)/)
ok('omezení sloupce stav se v migraci našlo', Boolean(blok))

const zDatabaze = blok
  ? [...blok[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  : []
ok('a vypadlo z něj rozumně stavů (víc než osm)', zDatabaze.length > 8, String(zDatabaze.length))

const zKodu = Object.keys(STAVY_PRISPEVKU)

const chybi = zDatabaze.filter((s) => !zKodu.includes(s))
ok('každý stav z databáze má český překlad', chybi.length === 0, chybi.join(', '))

const prebyva = zKodu.filter((s) => !zDatabaze.includes(s))
ok('a žádný překlad nepřebývá (stav se nepřejmenoval)', prebyva.length === 0, prebyva.join(', '))

const chyboveMimo = STAVY_CHYBOVE.filter((s) => !zDatabaze.includes(s))
ok('chybové stavy jsou skutečné stavy z databáze', chyboveMimo.length === 0, chyboveMimo.join(', '))

console.log('\n== Neznámý stav nezmizí ==')

ma('známý stav se přeloží', popisStavu('ceka_na_schvaleni'), 'čeká na schválení')
ma('neznámý se ukáže syrový, ne prázdný', popisStavu('neco_noveho'), 'neco_noveho')
ok('a rozhodně ne prázdný řetězec', popisStavu('neco_noveho') !== '')

console.log('\n== Výrazy značky ==')

ma('rozdělí, ořeže a zahodí prázdné',
   seznamVyrazu(' hovězí , domácí ,, poctivé '), ['hovězí', 'domácí', 'poctivé'])
ma('prázdný vstup dá prázdný seznam, ne [""]', seznamVyrazu(''), [])
ma('null taky', seznamVyrazu(null), [])
ok('dlouhý seznam se ořízne na strop',
   seznamVyrazu(Array.from({ length: STROP_VYRAZU + 15 }, (_, i) => `v${i}`).join(',')).length === STROP_VYRAZU)

console.log('\n== Nezadáno není prázdno ==')

ma('prázdné pole je null', neboNull('   '), null)
ma('null zůstává null', neboNull(null), null)
ma('vyplněné se ořeže', neboNull('  #7a1f2b '), '#7a1f2b')

console.log('\n== Délka videa se kryje s omezením v databázi ==')

const mezeVDb = PODKLADY.match(/video_sekundy\s+integer not null default \d+ check \(video_sekundy between (\d+) and (\d+)\)/)
ok('omezení délky videa se v migraci našlo', Boolean(mezeVDb))
ma('spodní mez v kódu sedí s databází', VIDEO_MIN, mezeVDb ? Number(mezeVDb[1]) : null)
ma('horní mez v kódu sedí s databází', VIDEO_MAX, mezeVDb ? Number(mezeVDb[2]) : null)

ma('krátké se zvedne na minimum', delkaVidea(1), VIDEO_MIN)
ma('dlouhé se srazí na maximum', delkaVidea(500), VIDEO_MAX)
ma('nesmysl dá výchozí hodnotu', delkaVidea('abc'), 20)
ma('rozumné projde beze změny', delkaVidea(30), 30)

console.log('\n== Obrazovka to opravdu volá ==')

const STRANKA = cti('app/[rozsah]/marketing/page.tsx')
const AKCE = cti('app/[rozsah]/marketing/znacka/akce.ts')

ok('rozcestí modulu volá popisStavu', STRANKA.includes('popisStavu('))
ok('a bere chybové stavy ze sdíleného seznamu', STRANKA.includes('STAVY_CHYBOVE'))
ok('uložení značky volá seznamVyrazu', AKCE.includes('seznamVyrazu('))
ok('uložení značky volá delkaVidea', AKCE.includes('delkaVidea('))
ok('uložení značky volá neboNull', AKCE.includes('neboNull('))

/*
  Rozsah se nesmí brát z formuláře — je to pravidlo 4 a přesně tady se
  porušuje nejsnáz, protože skryté pole je po ruce.
*/
ok('rozsah se bere z adresy přes zkusPristup, ne ze skrytého pole',
   AKCE.includes('zkusPristup(tenantId') && AKCE.includes('pristup.scope.branchId'))
ok('a branch_id se do řádku dává ze scope, ne z formData',
   !/branch_id:\s*String\(formData/.test(AKCE))

console.log(`\n${chyb === 0 ? 'VŠECHNY KONTROLY PROŠLY' : `CHYB: ${chyb}`}`)
process.exit(chyb === 0 ? 0 : 1)
