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
 * týmž překladačem, kterým se překládá aplikace, bare importy se
 * přepíší na úplné cesty a výsledek se načte z paměti.
 *
 * Když by nějaký import zůstal nepřepsaný, modul RADĚJI SPADNE, než by
 * načetl něco jiného — tichá záměna je právě ten druh chyby, kvůli
 * kterému tohle vzniklo.
 */

import fs from 'node:fs'
import ts from 'typescript'

const KOREN = new URL('..', import.meta.url)

/** Kde leží `@/neco` — zkusí `.ts`, `.tsx` i `/index`. */
function najdi(bezZnacky) {
  for (const konec of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    const kandidat = new URL(bezZnacky + konec, KOREN)
    if (fs.existsSync(kandidat)) return kandidat.href
  }
  throw new Error(`Nenašel jsem modul pro @/${bezZnacky}`)
}

/**
 * Přeloží komponentu a vrátí její výchozí export.
 *
 * `nahrady` jsou dvojice [co, čím] pro importy, které se mají podstrčit
 * — typicky serverové akce, které mimo Next spadnou a do vykreslení
 * z nich stejně nic nejde.
 */
export async function nactiKomponentu(soubor, nahrady = []) {
  const zdroj = fs.readFileSync(new URL(soubor, KOREN), 'utf8')

  let s = ts.transpileModule(zdroj, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  // Co si najdeme sami: react a všechno z `@/`.
  const vlastni = [
    ['react/jsx-runtime', import.meta.resolve('react/jsx-runtime')],
    ['react', import.meta.resolve('react')],
  ]
  for (const m of s.matchAll(/from ['"]@\/([^'"]+)['"]/g)) {
    vlastni.push(['@/' + m[1], najdi(m[1])])
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
    throw new Error(`Nepřepsané importy: ${zbyle.join(', ')} — načetlo by se něco jiného.`)
  }

  const adresa = 'data:text/javascript;base64,' + Buffer.from(s, 'utf8').toString('base64')
  return (await import(adresa)).default
}
