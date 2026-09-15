#!/usr/bin/env node
/**
 * Sestavení vstupů a pokynu pro AI ve „Tvorbě" (krok 3 zadání).
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-tvorba.test.mjs
 *
 * Testuje proti SKUTEČNÝM šablonám z lib/marketing-sablony.ts, ne proti
 * vymyšlené definici — aby test chytil i to, když se katalog změní tak,
 * že s ním sestavování přestane sedět.
 */

import { sablona } from '../lib/marketing-sablony.ts'
import { popisPolozekMenu, sestavPokyn, sestavVstupy, vyzadujeMenu } from '../lib/marketing-tvorba.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano), `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

/** Pomůcka pro test: mapa `in_<key>` → hodnota, stejně jak by je poslal formulář. */
function poleZMapy(hodnoty) {
  return {
    hodnota: (k) => String(hodnoty[k] ?? '').trim(),
    zaskrtnuto: (k) => hodnoty[k] === true,
    hodnotaOd: (k) => String(hodnoty[`${k}_od`] ?? '').trim(),
    hodnotaDo: (k) => String(hodnoty[`${k}_do`] ?? '').trim(),
  }
}

const jidloDne = sablona('jidlo_dne')
const denniMenu = sablona('denni_menu')
const tydenniMenu = sablona('tydenni_menu')

ok('šablona jidlo_dne existuje v katalogu', jidloDne !== undefined)
ok('šablona denni_menu existuje v katalogu', denniMenu !== undefined)
ok('šablona tydenni_menu existuje v katalogu', tydenniMenu !== undefined)

console.log('\nsestavVstupy — jidlo_dne, vše vyplněno')
{
  const r = sestavVstupy(jidloDne, poleZMapy({
    title: 'Svíčková na smetaně', price: '189', date: '2026-09-14', allergens: '1,7', cta: 'rezervace',
  }))
  ma('bez chybějícího pole', r.chybiPovinne, null)
  ma('vstupy nesou vyplněné hodnoty', r.vstupy, { title: 'Svíčková na smetaně', price: '189', date: '2026-09-14', allergens: '1,7', cta: 'rezervace' })
  ok('media a items nejsou ve vstupech', !('media' in r.vstupy) && !('items' in r.vstupy))
  ma('popis polí má pět položek', r.popisPole.length, 5)
}

console.log('\nsestavVstupy — jidlo_dne, nepovinné pole prázdné se přeskočí')
{
  const r = sestavVstupy(jidloDne, poleZMapy({ title: 'Guláš', price: '', date: '2026-09-14' }))
  ma('bez chybějícího pole', r.chybiPovinne, null)
  ok('prázdná cena není ve vstupech', !('price' in r.vstupy))
  ok('nevyplněné alergeny nejsou ve vstupech', !('allergens' in r.vstupy))
  ma('title a date jsou ve vstupech', [r.vstupy.title, r.vstupy.date], ['Guláš', '2026-09-14'])
}

console.log('\nsestavVstupy — jidlo_dne, chybí povinné pole')
{
  const r = sestavVstupy(jidloDne, poleZMapy({ price: '189' }))
  ma('chybí přesně Název jídla (první povinné pole v pořadí)', r.chybiPovinne, 'Název jídla')
  ma('nic se nezpracovalo po chybějícím poli', r.vstupy, {})
  ma('popis polí je prázdný', r.popisPole, [])
}

console.log('\nsestavVstupy — date_range (tydenni_menu)')
{
  const bezRozsahu = sestavVstupy(tydenniMenu, poleZMapy({}))
  ma('chybí Platnost (povinný date_range)', bezRozsahu.chybiPovinne, 'Platnost')

  const sRozsahem = sestavVstupy(tydenniMenu, poleZMapy({ range_od: '2026-09-15', range_do: '2026-09-21' }))
  ma('rozsah se uloží jako objekt od/do', sRozsahem.vstupy.range, { od: '2026-09-15', do: '2026-09-21' })
  ma('popis rozsahu obsahuje obě data', sRozsahem.popisPole.some((p) => p.includes('2026-09-15') && p.includes('2026-09-21')), true)

  const jenOd = sestavVstupy(tydenniMenu, poleZMapy({ range_od: '2026-09-15' }))
  ma('jen od — do je null, ne prázdný řetězec', jenOd.vstupy.range, { od: '2026-09-15', do: null })
}

console.log('\nsestavVstupy — boolean (denni_menu: show_allergens)')
{
  const zapnuto = sestavVstupy(denniMenu, poleZMapy({ date: '2026-09-14', show_allergens: true }))
  ma('true je ve vstupech', zapnuto.vstupy.show_allergens, true)
  ok('popis říká "ano"', zapnuto.popisPole.some((p) => p.includes('ano')))

  const vypnuto = sestavVstupy(denniMenu, poleZMapy({ date: '2026-09-14' }))
  ok('nezaškrtnuté boolean pole se do vstupů nepíše (false ≠ vyplněno)', !('show_allergens' in vypnuto.vstupy))
}

console.log('\nvyzadujeMenu — kategorie „menu" sama o sobě nestačí')
ma('denni_menu má vstup typu items, menu potřebuje', vyzadujeMenu(denniMenu), true)
ma('tydenni_menu (items pod klíčem "days") menu potřebuje', vyzadujeMenu(tydenniMenu), true)
ma('jidlo_dne je taky kategorie menu, ale bez items menu nepotřebuje', vyzadujeMenu(jidloDne), false)

console.log('\npopisPolozekMenu')
ma('cena v haléřích se převede na Kč', popisPolozekMenu([{ nazev: 'Svíčková', cena_haleru: 18900 }]), 'Svíčková 189 Kč')
ma('null cena nemá "Kč"', popisPolozekMenu([{ nazev: 'Polévka dne', cena_haleru: null }]), 'Polévka dne')
ma('víc položek oddělených čárkou', popisPolozekMenu([
  { nazev: 'A', cena_haleru: 10000 }, { nazev: 'B', cena_haleru: null },
]), 'A 100 Kč, B')
ma('prázdný seznam', popisPolozekMenu([]), '')

console.log('\nsestavPokyn')
ma('jen popis šablony, žádná pole ani položky',
  sestavPokyn(jidloDne, [], ''), jidloDne.description)
ma('popis + vyplněná pole',
  sestavPokyn(jidloDne, ['Název jídla: Guláš', 'Cena: 149'], ''),
  `${jidloDne.description} Název jídla: Guláš Cena: 149`)
ma('popis + položky menu na konci',
  sestavPokyn(denniMenu, ['Datum: 2026-09-14'], 'Svíčková 189 Kč, Guláš 139 Kč'),
  `${denniMenu.description} Datum: 2026-09-14 Položky: Svíčková 189 Kč, Guláš 139 Kč`)

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
