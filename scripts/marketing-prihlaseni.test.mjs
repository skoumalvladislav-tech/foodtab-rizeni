#!/usr/bin/env node
/**
 * Deep link do marketingu přežije přihlášení.
 *
 * Pusť `node scripts/marketing-prihlaseni.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO SE HLÍDÁ
 *
 * Zadání, oddíl 25: „nepřihlášený deep link zachová bezpečnou cílovou
 * cestu a po přihlášení uživatele vrátí na zamýšlenou obrazovku."
 *
 * `redirect('/prihlaseni')` původní adresu ZAHODÍ. Kdo si otevřel
 * odkaz na konkrétní příspěvek a nebyl přihlášený, skončil po
 * přihlášení na rozcestníku. Správně je `redirect(await
 * odkazNaPrihlaseni())` — ta cestu zabalí do `?kam=`.
 *
 * ---------------------------------------------------------------------
 * PROČ NESTAČÍ, ŽE TO UMÍ LAYOUT
 *
 * `app/[rozsah]/layout.tsx` to dělá správně, takže by se mohlo zdát,
 * že obrazovky pod ním mají vystaráno. Nemají, ze dvou důvodů:
 *
 * 1. **Layout a stránka se v App Routeru renderují paralelně**, ne za
 *    sebou. Když obě zavolají `redirect`, není určené, který vyhraje —
 *    a ten ze stránky cíl zahazuje. Chyba by se tak projevovala
 *    občas, což je horší než pokaždé.
 * 2. **U serverových akcí (`akce.ts`) layout neběží vůbec.** Když
 *    člověku vyprší relace nad rozdělaným formulářem, vrátí ho to na
 *    rozcestník a rozdělaná práce je pryč.
 *
 * ---------------------------------------------------------------------
 * PLATÍ JEN PRO MARKETING
 *
 * Třináct souborů mimo modul (`nastaveni`, `vzkazy`, `zalohy`,
 * `upozorneni`, `pozvanka`) má tutéž mezeru. Do cizího modulu se
 * nesahá (CLAUDE.md, „Dvě relace v jednom repozitáři") — je to
 * nahlášené, ne opravené. Až se to opraví, stačí tady rozšířit
 * `SLOZKY`.
 */

import fs from 'node:fs'
import path from 'node:path'

const KOREN = path.join(import.meta.dirname, '..')
const SLOZKY = ['app/[rozsah]/marketing']

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

function soubory(koren) {
  const ven = []
  const projdi = (d) => {
    for (const p of fs.readdirSync(d, { withFileTypes: true })) {
      const cela = path.join(d, p.name)
      if (p.isDirectory()) projdi(cela)
      else if (p.name.endsWith('.ts') || p.name.endsWith('.tsx')) ven.push(cela)
    }
  }
  projdi(koren)
  return ven.sort()
}

const vsechny = SLOZKY.flatMap((s) => soubory(path.join(KOREN, s)))

console.log(`\n== Soubory marketingu (${vsechny.length}) ==\n`)
ok('nějaké se našly', vsechny.length >= 20)

console.log('\n== Žádný nezahazuje cíl přihlášení ==\n')

/*
  Komentáře se schválně NEODSTRAŇUJÍ: v hlavičkách se ta špatná podoba
  cituje jako protipříklad a kontrola by se trefila do vysvětlení.
  Řeší se to jinak — hledá se jen `redirect(` na začátku výrazu, tedy
  skutečné volání, ne text uvnitř věty.
*/
const spatne = /(?<![\w.])redirect\(\s*['"]\/prihlaseni/

/** Soubory, kde se vůbec o přihlášení rozhoduje. */
const rozhodujici = vsechny.filter((f) => {
  const t = fs.readFileSync(f, 'utf8')
  return t.includes("'neprihlasen'") || t.includes('/prihlaseni')
})

ok('a nějaké o přihlášení opravdu rozhodují', rozhodujici.length >= 15)

for (const f of rozhodujici) {
  const t = fs.readFileSync(f, 'utf8')
  const kratce = path.relative(KOREN, f)

  /*
    Komentáře pryč AŽ TADY a jen řádkové — kvůli hlavičkám, které tu
    špatnou podobu popisují slovy. Kód se tím nemění.
  */
  const kod = t
    .split('\n')
    .map((r) => {
      const i = r.indexOf('//')
      return i === -1 ? r : r.slice(0, i)
    })
    .join('\n')
    .split(/\/\*[\s\S]*?\*\//)
    .join(' ')

  ok(`${kratce} neposílá na holé /prihlaseni`, !spatne.test(kod))
}

console.log('\n== A kdo o přihlášení rozhoduje, umí cíl zabalit ==\n')

for (const f of rozhodujici) {
  const t = fs.readFileSync(f, 'utf8')
  const kratce = path.relative(KOREN, f)
  const resiPrihlaseni = t.includes("'neprihlasen'")
  if (!resiPrihlaseni) continue
  ok(`${kratce} volá odkazNaPrihlaseni`, t.includes('odkazNaPrihlaseni'))
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
