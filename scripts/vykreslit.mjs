/**
 * Vykreslení skutečné komponenty aplikace mimo prohlížeč.
 *
 * ---------------------------------------------------------------------
 * K ČEMU TO JE
 *
 * Kontrola, která si očekávaný výsledek poskládá sama, ověřuje vlastní
 * záměr. Přesně tak se stalo, že QR na kiosku osm dní nesl osmiznakový
 * kód místo adresy a kontrola u toho hlásila „prošlo“: volala kodér
 * napřímo a na komponentu, která ten kodér používá, nikdy nesáhla.
 *
 * Tenhle modul umí přeložit `.tsx` a vykreslit ho do HTML, takže se dá
 * ověřit, co se opravdu objeví na obrazovce.
 *
 * ---------------------------------------------------------------------
 * JAK
 *
 * Node neumí ani TypeScript s JSX, ani `@/…`. Soubor se proto přeloží
 * týmž překladačem, kterým se překládá aplikace, importy se přepíší na
 * úplné cesty a výsledek se načte z paměti.
 *
 * Sourozenecké komponenty (`./neco`) se přeloží TAKY, rekurzivně — aby
 * se vykreslila skutečná vnitřní komponenta, ne její náhrada. Kdo chce
 * něco podstrčit (serverovou akci, `next/navigation`), předá si to
 * v `nahrady`; ty mají přednost.
 *
 * Když by nějaký import zůstal nepřepsaný, modul RADĚJI SPADNE, než by
 * načetl něco jiného — tichá záměna je právě ten druh chyby, kvůli
 * kterému tohle vzniklo.
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const KOREN = new URL('..', import.meta.url)

/** Kde leží `@/neco` — zkusí `.ts`, `.tsx` i `/index`. */
function najdi(bezZnacky, zaklad = KOREN) {
  for (const konec of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    const kandidat = new URL(bezZnacky + konec, zaklad)
    if (fs.existsSync(kandidat) && fs.statSync(kandidat).isFile()) return kandidat
  }
  return null
}

function prelozit(soubor) {
  return ts.transpileModule(fs.readFileSync(soubor, 'utf8'), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
}

/**
 * Přeloží soubor a vrátí ho jako datovou adresu.
 *
 * `hotove` drží už přeložené soubory, aby se dvakrát importovaná
 * komponenta nepřekládala dvakrát a aby kruh v importech nezacyklil.
 */
function naAdresu(soubor, nahrady, hotove) {
  const klic = soubor.href
  if (hotove.has(klic)) return hotove.get(klic)

  // Zapsat napřed, ať se kruh zastaví o rozdělanou hodnotu.
  hotove.set(klic, null)

  let s = prelozit(soubor)

  const vlastni = [
    ['react/jsx-runtime', import.meta.resolve('react/jsx-runtime')],
    ['react', import.meta.resolve('react')],
  ]

  // `@/neco` z kořene projektu.
  for (const m of s.matchAll(/from ['"]@\/([^'"]+)['"]/g)) {
    const cil = najdi(m[1])
    if (!cil) throw new Error(`Nenašel jsem modul pro @/${m[1]}`)
    vlastni.push([
      '@/' + m[1],
      /\.tsx?$/.test(cil.pathname) && cil.pathname.endsWith('.tsx')
        ? naAdresu(cil, nahrady, hotove)
        : cil.href,
    ])
  }

  // Sourozenci `./neco` a `../neco`.
  const zaklad = new URL('.', soubor)
  for (const m of s.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)) {
    if (nahrady.some(([co]) => co === m[1])) continue
    const cil = najdi(m[1], zaklad)
    if (!cil) throw new Error(`Nenašel jsem sousední modul ${m[1]}`)
    vlastni.push([
      m[1],
      cil.pathname.endsWith('.tsx') ? naAdresu(cil, nahrady, hotove) : cil.href,
    ])
  }

  // Delší napřed, ať `react` nesebere `react/jsx-runtime`. Uvozovky se
  // přepisují obě — překladač zachovává ty ze zdroje.
  for (const [co, cim] of [...nahrady, ...vlastni].sort((a, b) => b[0].length - a[0].length)) {
    for (const u of ['"', "'"]) s = s.split(u + co + u).join(u + cim + u)
  }

  const zbyle = [...s.matchAll(/from ['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((x) => !/^(file|data|node):/.test(x))
  if (zbyle.length > 0) {
    throw new Error(
      `Nepřepsané importy v ${path.basename(soubor.pathname)}: ${zbyle.join(', ')} — načetlo by se něco jiného.`,
    )
  }

  const adresa = 'data:text/javascript;base64,' + Buffer.from(s, 'utf8').toString('base64')
  hotove.set(klic, adresa)
  return adresa
}

/**
 * Přeloží komponentu a vrátí její výchozí export.
 *
 * `nahrady` jsou dvojice [co, čím] pro importy, které se mají podstrčit
 * — typicky serverové akce a `next/*`, které mimo Next spadnou a do
 * vykreslení z nich stejně nic nejde.
 */
export async function nactiKomponentu(soubor, nahrady = []) {
  const cil = new URL(soubor, KOREN)
  const adresa = naAdresu(cil, nahrady, new Map())
  return (await import(adresa)).default
}
