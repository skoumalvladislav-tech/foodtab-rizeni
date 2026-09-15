#!/usr/bin/env node
/**
 * Levý sloupec a spodní lišta modulu Faktury.
 *
 * Pusť:
 *   node --experimental-strip-types scripts/faktury-navigace.test.mjs
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { aktivniKlic, sestavNavigaci } from '../lib/faktury-navigace.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano), `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

const koren = fileURLToPath(new URL('..', import.meta.url))

const { hlavni, mobil } = sestavNavigaci('firma', { needsReview: 3, overdue: 5, pendingApproval: 2 })

console.log('\nsestavNavigaci — hlavní sloupec')
ma('sedm položek v pořadí', hlavni.map((p) => p.nazev), [
  'Přehled', 'Faktury', 'Dodavatelé', 'Ke schválení', 'Přehledy', 'Kalendář splatností', 'Upomínky',
])
ma('přehled vede na kořen modulu', hlavni[0].href, '/firma/faktury')
ma('seznam vede pod faktury/seznam', hlavni.find((p) => p.klic === 'seznam').href, '/firma/faktury/seznam')

console.log('\nOdznaky sedí na správné položce, jinde jsou nula')
ma('Faktury nese needsReview', hlavni.find((p) => p.klic === 'seznam').cislo, 3)
ma('Ke schválení nese pendingApproval', hlavni.find((p) => p.klic === 'schvaleni').cislo, 2)
ma('Upomínky nese overdue', hlavni.find((p) => p.klic === 'upominky').cislo, 5)
ma('Přehled bez odznaku', hlavni[0].cislo, 0)
ma('Dodavatelé bez odznaku', hlavni.find((p) => p.klic === 'dodavatele').cislo, 0)

console.log('\nMobilní lišta — MOB_NAV omezená na hotové obrazovky')
// Původní appka měla na mobilu přesně čtveřici Přehled/Faktury/Dodavatelé/
// Upomínky (MOB_NAV v Shell.tsx) — teď, co jsou všechny obrazovky hotové,
// sedí to přesně na original.
ma('mobil = přesně čtveřice z MOB_NAV', mobil.map((p) => p.klic), ['prehled', 'seznam', 'dodavatele', 'upominky'])
ok('schvaleni na mobilu není', !mobil.some((p) => p.klic === 'schvaleni'))
ok('prehledy na mobilu není', !mobil.some((p) => p.klic === 'prehledy'))
ok('kalendar na mobilu není', !mobil.some((p) => p.klic === 'kalendar'))

console.log('\nNula ve všech počítadlech')
{
  const { hlavni: bezOdznaku } = sestavNavigaci('firma', { needsReview: 0, overdue: 0, pendingApproval: 0 })
  ok('žádná položka nemá kladné číslo', bezOdznaku.every((p) => p.cislo === 0))
}

console.log('\nHotovo/brzy')
// Sloučení dokončeno — všech sedm obrazovek z původní appky je hotovo,
// štítek „brzy" se dnes nikde neukáže. Test zůstává (ne jen jako
// historie) — hlídá, že příští nová položka v POLOZKY dostane
// hotovo: false, dokud pro ni nebude existovat obrazovka.
ma('všechny položky hotové', hlavni.filter((p) => p.hotovo).map((p) => p.klic), hlavni.map((p) => p.klic))
ok('žádná nehotová položka neproklouzne na mobil', !mobil.some((p) => !p.hotovo))

console.log('\nKaždá HOTOVÁ položka vede na existující obrazovku')
for (const p of hlavni.filter((p) => p.hotovo)) {
  const segment = p.href.slice('/firma/faktury'.length).replace(/^\//, '')
  const soubor = join(koren, 'app', '[rozsah]', 'faktury', segment, 'page.tsx')
  ok(`${p.nazev} → ${segment || '(kořen)'}`, existsSync(soubor), soubor)
}

console.log('\naktivniKlic')
ma('kořen modulu', aktivniKlic('/firma/faktury', hlavni), 'prehled')
ma('seznam', aktivniKlic('/firma/faktury/seznam', hlavni), 'seznam')
ma('hlubší adresa pod seznamem patří seznamu', aktivniKlic('/firma/faktury/seznam/xyz', hlavni), 'seznam')
ma('neznámý segment mimo žádnou položku patří kořeni (prehled = celý modul)', aktivniKlic('/firma/faktury/detail/abc', hlavni), 'prehled')
ma('jiný rozsah nesedí', aktivniKlic('/pobocka/faktury/seznam', hlavni), null)
ma('podobná předpona nesedí', aktivniKlic('/firma/fakturyxxx', hlavni), null)

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
