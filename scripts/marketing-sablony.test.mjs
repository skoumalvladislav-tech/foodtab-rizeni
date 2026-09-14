#!/usr/bin/env node
/**
 * Knihovna gastro šablon — katalog a převod na řádky firmy.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-sablony.test.mjs
 *
 * ---------------------------------------------------------------------
 * CO SE TU HLÍDÁ
 *
 * 1. ŽE KATALOG POKRÝVÁ ZADÁNÍ. Oddíl 9 vyjmenovává konkrétní šablony
 *    jménem — denní menu, burger víkend, svatomartinské, nábor. Kdyby
 *    některá vypadla, nikdo by si toho nevšiml: obrazovka by prostě
 *    ukázala o řádek míň.
 *
 * 2. ŽE SE Z NĚJ DÁ UDĚLAT ŘÁDEK. Sloupce `marketing_sablony` jsou
 *    dané migrací. Překlep ve jméně sloupce projde překladem a spadne
 *    až při vkládání do ostré databáze.
 *
 * 3. ŽE OPAKOVANÉ NAČTENÍ NIC NEPŘEPÍŠE. Klíče musí být jedinečné —
 *    na `klic` je v databázi jedinečnost a duplicita by celé vložení
 *    zahodila.
 */

import { readFileSync } from 'node:fs'

import { SABLONY, sablona, doporuceneRadky, jakoRadek, inputJsonSchema } from '../lib/marketing-sablony.ts'

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const TENANT = '5e0c6d18-55cd-4d55-adb7-fe5d0605fd2a'

console.log('\n== Katalog pokrývá, co zadání jmenuje ==')

/*
  Jmenovitý výčet ze zadání, oddíl 9. Není to celý výčet — je to ten,
  u kterého by vypadnutí nebylo vidět. Kdyby se katalog osekal, spadne
  to tady, ne až v provozu.
*/
const ZE_ZADANI = [
  'denni_menu', 'tydenni_menu', 'vikendove_menu', 'poledni_menu_3', 'jidlo_dne',
  'sezonni_menu', 'novinka_v_listku', 'napojovy_special', 'dezert_tydne', 'vyprodano',
  'burger_vikend', 'steakovy_vecer', 'pivni_special', 'vinna_degustace', 'valentyn',
  'velikonoce', 'svatomartinske', 'advent_vanoce_silvestr', 'sportovni_prenos',
  'ziva_hudba', 'happy_hour', 'soutez', 'darkovy_voucher', 'catering_oslava',
  'nabor', 'zmena_oteviraci_doby',
  'detail_jidla', 'ze_zakulisi', 'predstaveni_kuchare', 'atmosfera',
  'reference_hosta', 'anketa', 'rezervace_stolu', 'evergreen',
]

for (const klic of ZE_ZADANI) {
  ok(`šablona „${klic}" v katalogu je`, sablona(klic) !== undefined)
}

ok('celkem aspoň 35 šablon', SABLONY.length >= 35)

console.log('\n== Klíče jsou jedinečné ==')

/*
  Na `klic` je v databázi jedinečnost v rámci firmy. Duplicita
  v katalogu by shodila celé vložení, ne jen ten jeden řádek — a člověk
  by z hlášky nepoznal proč.
*/
const klice = SABLONY.map((s) => s.key)
ok('žádný klíč se neopakuje', new Set(klice).size === klice.length)

console.log('\n== Každá šablona je použitelná ==')

const bezNazvu = SABLONY.filter((s) => !s.name || s.name.trim() === '')
ok('každá má název', bezNazvu.length === 0)

const bezFormatu = SABLONY.filter((s) => !Array.isArray(s.formats) || s.formats.length === 0)
ok('každá umí aspoň jeden výstupní formát',
  bezFormatu.length === 0 || `chybí u: ${bezFormatu.map((s) => s.key).join(', ')}` === '')

const bezVstupu = SABLONY.filter((s) => !Array.isArray(s.inputs) || s.inputs.length === 0)
ok('každá má aspoň jeden vstup', bezVstupu.length === 0)

/*
  Zadání, oddíl 9: „žádné useknuté názvy jídel" a „automatické zmenšení
  písma pouze do čitelného minima". Nula by znamenala, že se text
  zmenšuje donekonečna.
*/
const spatneMinimum = SABLONY.filter((s) => !(s.textRules?.minFontPx > 0))
ok('každá má čitelné minimum písma', spatneMinimum.length === 0)

console.log('\n== Souhlas u obsahu s lidmi ==')

/*
  Zadání, oddíl 23: „Evidence licence nebo souhlasu u hudby, cizích
  fotografií a obsahu hostů." U šablon, kde vystupuje člověk, musí být
  souhlas POVINNÝ vstup — ne poznámka pod čarou.
*/
for (const klic of ['reference_hosta', 'obsah_hosta', 'predstaveni_kuchare']) {
  const s = sablona(klic)
  const souhlas = s?.inputs.find((i) => i.key === 'consent')
  ok(`„${klic}" vyžaduje zaznamenaný souhlas`, souhlas?.required === true)
}

console.log('\n== Převod na řádek databáze ==')

const radky = doporuceneRadky(TENANT)
ok('převede se celý katalog', radky.length === SABLONY.length)

/*
  Jména sloupců proti migraci. Překlep tu projde překladem a spadne až
  při vkládání — s hláškou o neexistujícím sloupci, ze které se nepozná,
  který řádek za to může.
*/
const migrace = readFileSync('supabase/migrations/20260909180000_marketing_podklady.sql', 'utf8')
const definice = migrace.slice(migrace.indexOf('create table public.marketing_sablony'))
const telo = definice.slice(0, definice.indexOf(');'))

for (const sloupec of Object.keys(radky[0])) {
  ok(`sloupec ${sloupec} v migraci existuje`, new RegExp(`\\n  ${sloupec}\\s`).test(telo))
}

ok('tenant_id se vyplní', radky.every((r) => r.tenant_id === TENANT))
ok('pořadí je jedinečné', new Set(radky.map((r) => r.poradi)).size === radky.length)

/*
  `aktivni` se schválně NEPOSÍLÁ — bere se výchozí true. Kdyby se
  posílalo, opakované načtení by zapnulo šablonu, kterou si firma
  vypnula.
*/
ok('aktivni se neposílá, ať se nepřepíše vypnutá šablona',
  !Object.keys(radky[0]).includes('aktivni'))

console.log('\n== Schéma vstupů ==')

const schema = inputJsonSchema(sablona('denni_menu'))
ok('denní menu má schéma s vlastnostmi', Object.keys(schema.properties ?? {}).length > 0)
ok('a nepovoluje pole navíc', schema.additionalProperties === false)
ok('povinné položky jsou vyjmenované', Array.isArray(schema.required) && schema.required.length > 0)

const radek = jakoRadek(sablona('denni_menu'), TENANT, 0)
ok('schéma se veze s řádkem do databáze',
  typeof radek.pravidla_textu === 'object' && 'schema' in radek.pravidla_textu)

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
