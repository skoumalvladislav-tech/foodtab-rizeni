#!/usr/bin/env node
/**
 * Kde se fotka používá (krok 5 zadání: „Detail fotky").
 *
 * Pusť:
 *   node --experimental-strip-types scripts/marketing-media-pouziti.test.mjs
 */

import { sestavPouziti } from '../lib/marketing-media-pouziti.ts'

let chyb = 0
const ok = (popis, podminka, detail) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}${podminka || detail === undefined ? '' : ` → ${detail}`}`)
}
const ma = (popis, skutecnost, cekano) =>
  ok(popis, JSON.stringify(skutecnost) === JSON.stringify(cekano), `${JSON.stringify(skutecnost)} ≠ ${JSON.stringify(cekano)}`)

const prispevky = [
  { id: 'p1', nazev: 'Páteční svíčková', stav: 'koncept', aktualniVerzeId: 'v1' },
  { id: 'p2', nazev: 'Víkendové menu', stav: 'ceka_na_schvaleni', aktualniVerzeId: 'v2' },
  // Bez aktuální verze — nemá se objevit nikde.
  { id: 'p3', nazev: 'Rozjeté, bez verze', stav: 'koncept', aktualniVerzeId: null },
  // Verze existuje, ale v poli `verze` níž chybí (např. smazaná) — nesmí to spadnout.
  { id: 'p4', nazev: 'Osiřelý odkaz na verzi', stav: 'koncept', aktualniVerzeId: 'neexistuje' },
]

const verze = [
  { id: 'v1', mediaIds: ['foto-a', 'foto-b'] },
  { id: 'v2', mediaIds: ['foto-b'] },
]

const vysledek = sestavPouziti(prispevky, verze)

console.log('\nsestavPouziti — základní scénář')
ma('foto-a je jen v p1', vysledek.get('foto-a'), [{ prispevekId: 'p1', nazev: 'Páteční svíčková', stav: 'koncept' }])
ma('foto-b je v p1 i p2, v pořadí příspěvků', vysledek.get('foto-b'), [
  { prispevekId: 'p1', nazev: 'Páteční svíčková', stav: 'koncept' },
  { prispevekId: 'p2', nazev: 'Víkendové menu', stav: 'ceka_na_schvaleni' },
])
ok('nepoužitá fotka není v mapě vůbec', vysledek.get('foto-nepouzita') === undefined)
ok('příspěvek bez aktuální verze nespadne a nic nepřidá', chyb === 0)
ok('osiřelý odkaz na neexistující verzi nespadne', chyb === 0)

console.log('\nPrázdný vstup')
ma('žádné příspěvky, žádná verze', [...sestavPouziti([], [])], [])

console.log('\nStejná fotka dvakrát v jedné verzi se nezdvojí navíc, jen podle toho, co verze nese')
{
  const v = sestavPouziti(
    [{ id: 'p5', nazev: 'X', stav: 'koncept', aktualniVerzeId: 'v5' }],
    [{ id: 'v5', mediaIds: ['foto-c', 'foto-c'] }],
  )
  ma('foto-c se objeví tolikrát, kolikrát je v poli (zdroj dat, ne chyba funkce)', v.get('foto-c')?.length, 2)
}

console.log(chyb ? `\n${chyb} chyb` : '\nVšechno sedí')
process.exit(chyb ? 1 : 0)
