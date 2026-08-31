#!/usr/bin/env node
/**
 * Kontrola stropu na obrazovce — lib/prideleni.ts.
 *
 * Pusť `node --experimental-strip-types scripts/prideleni.test.mjs`.
 *
 * Tohle je ta NEJSLABŠÍ ze tří obranných linií podle
 * docs/pravidlo-neprideluj-vic.md — rozhodnutí padá v databázi. Test tu
 * je proto, aby se poznalo, když obrazovka slíbí něco jiného, než co
 * databáze udělá: mlčící kontrola, která nikdy nezakřičí, je horší než
 * žádná, protože vypadá jako ochrana.
 */

import { smimPridelit } from '../lib/prideleni.ts'

let chyb = 0
const ma = (popis, sk, ce) => {
  const ok = JSON.stringify(sk) === JSON.stringify(ce)
  if (!ok) chyb++
  console.log(`  ${ok ? 'OK   ' : 'CHYBA'} ${popis}${ok ? '' : ` → ${JSON.stringify(sk)} ≠ ${JSON.stringify(ce)}`}`)
}

const ctx = (isOwner, prava) => ({
  role: { id: 'r', key: 'k', label: 'L', isOwner },
  permissions: prava,
})

const MAJITEL = ctx(true, ['shifts.read', 'people.manage', 'payroll.read'])
const PROVOZNI = ctx(false, ['shifts.read', 'people.manage'])

console.log('== Majitelská role ==')
ma('vlastník ji přidělí', smimPridelit(MAJITEL, { isOwner: true, prava: [] }), true)
ma('nikdo jiný ne', smimPridelit(PROVOZNI, { isOwner: true, prava: [] }), false)
// Majitel obchází katalog, takže prázdný seznam práv neznamená „nic“.
ma('a nepomůže ani to, že je seznam práv prázdný',
  smimPridelit(ctx(false, ['shifts.read', 'people.manage', 'payroll.read', 'settings.manage']),
    { isOwner: true, prava: [] }), false)

console.log('\n== Podmnožina ==')
ma('roli, kterou má celou, přidělí',
  smimPridelit(PROVOZNI, { isOwner: false, prava: ['shifts.read'] }), true)
ma('roli s cizím právem ne',
  smimPridelit(PROVOZNI, { isOwner: false, prava: ['shifts.read', 'payroll.read'] }), false)
ma('stačí jedno cizí právo',
  smimPridelit(PROVOZNI, { isOwner: false, prava: ['payroll.read'] }), false)
ma('prázdná sada jde vždycky',
  smimPridelit(PROVOZNI, { isOwner: false, prava: [] }), true)
ma('sám sebe přidělit smí',
  smimPridelit(PROVOZNI, { isOwner: false, prava: ['shifts.read', 'people.manage'] }), true)

console.log(chyb === 0 ? '\nVŠECHNO PROŠLO' : `\nSELHALO: ${chyb}`)
process.exit(chyb === 0 ? 0 : 1)
