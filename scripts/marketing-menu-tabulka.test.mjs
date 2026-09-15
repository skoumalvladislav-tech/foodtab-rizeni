#!/usr/bin/env node
/**
 * Tabulka menu (`marketing/menu`, krok 2 zadání).
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-menu-tabulka.test.mjs
 *
 * Seed data napodobují to, co zakládá `supabase/seed/test-marketing.sql`
 * (potvrzené menu, koncept s položkou ke kontrole) — bez databáze, jen
 * na tvaru řádků, co vrací dotaz v `menu/page.tsx`.
 */

import {
  popisDatumu,
  popisDruhu,
  popisPlatnosti,
  popisStavuMenu,
  popisZdroje,
  sestavRadky,
} from '../lib/marketing-menu-tabulka.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano), `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

console.log('\npopisDatumu — bez nul navíc')
ma('jednociferný den i měsíc', popisDatumu('2026-09-05'), '5. 9. 2026')
ma('dvouciferný den', popisDatumu('2026-09-14'), '14. 9. 2026')

console.log('\npopisPlatnosti')
ma('jen od', popisPlatnosti('2026-09-14', null), '14. 9. 2026')
ma('od i do, různé', popisPlatnosti('2026-09-14', '2026-09-20'), '14. 9. 2026 – 20. 9. 2026')
ma('od i do, stejné — nekreslí se rozsah', popisPlatnosti('2026-09-14', '2026-09-14'), '14. 9. 2026')
ma('nic', popisPlatnosti(null, null), '—')

console.log('\npopis* — fallback na neznámý klíč')
ma('druh mimo seznam', popisDruhu('kdovico'), 'kdovico')
ma('zdroj mimo seznam', popisZdroje('kdovico'), 'kdovico')
ma('stav mimo potvrzeno/archivovano je koncept', popisStavuMenu('cokoli'), 'Koncept')
ma('stav potvrzeno', popisStavuMenu('potvrzeno'), 'Potvrzeno')
ma('stav archivovano', popisStavuMenu('archivovano'), 'Archiv')

// Napodobuje `supabase/seed/test-marketing.sql`: jedno potvrzené menu bez
// položek ke kontrole, jeden koncept se dvěma položkami — jednou čistou
// a jednou čekající na cenu — a jedno menu úplně bez položek.
const menu = [
  { id: 'm-potvrzene', druh: 'denni', nazev: 'Denní menu', platiOd: '2026-09-14', platiDo: null, stav: 'potvrzeno', zdroj: 'text', vytvorenoKdy: '2026-09-14T06:00:00Z' },
  { id: 'm-koncept', druh: 'tydenni', nazev: '', platiOd: '2026-09-15', platiDo: '2026-09-21', stav: 'koncept', zdroj: 'fotka', vytvorenoKdy: '2026-09-14T07:00:00Z' },
  { id: 'm-prazdne', druh: 'vikendove', nazev: 'Víkendové menu', platiOd: null, platiDo: null, stav: 'koncept', zdroj: 'rucne', vytvorenoKdy: '2026-09-14T08:00:00Z' },
]

const polozky = [
  { menuId: 'm-potvrzene', vyzadujeKontrolu: false },
  { menuId: 'm-potvrzene', vyzadujeKontrolu: false },
  { menuId: 'm-koncept', vyzadujeKontrolu: false },
  { menuId: 'm-koncept', vyzadujeKontrolu: true },
  // Položka cizího menu, které v seznamu není — nesmí se přičíst nikam.
  { menuId: 'm-jine-tenantovo-menu-mimo-seznam', vyzadujeKontrolu: true },
]

const radky = sestavRadky(menu, polozky)

console.log('\nsestavRadky — tři menu')
ma('pořadí se zachovává', radky.map((r) => r.id), ['m-potvrzene', 'm-koncept', 'm-prazdne'])
ma('potvrzené menu: 2 položky, 0 ke kontrole', [radky[0].pocetPolozek, radky[0].keKontrole], [2, 0])
ma('koncept: 2 položky, 1 ke kontrole', [radky[1].pocetPolozek, radky[1].keKontrole], [2, 1])
ma('menu bez položek: 0 a 0, ne chyba', [radky[2].pocetPolozek, radky[2].keKontrole], [0, 0])
ma('prázdný název dostane náhradu', radky[1].nazev, 'Menu bez názvu')
ma('cizí položka se nikam nepřičetla', radky.reduce((s, r) => s + r.pocetPolozek, 0), 4)
ma('druh a zdroj se překládají', [radky[0].druh, radky[0].zdroj], ['Denní', 'Text'])
ma('stav se překládá', [radky[0].stav, radky[1].stav], ['Potvrzeno', 'Koncept'])
ma('platnost bez data do', radky[0].platnost, '14. 9. 2026')
ma('platnost s rozsahem', radky[1].platnost, '15. 9. 2026 – 21. 9. 2026')
ma('platnost bez obou dat', radky[2].platnost, '—')

console.log('\nPrázdný vstup')
ma('žádné menu, žádné položky', sestavRadky([], []), [])
ma('menu bez jediné položky v druhém poli', sestavRadky(menu.slice(0, 1), []), [
  { id: 'm-potvrzene', druh: 'Denní', nazev: 'Denní menu', platnost: '14. 9. 2026', pocetPolozek: 0, keKontrole: 0, stav: 'Potvrzeno', zdroj: 'Text' },
])

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
