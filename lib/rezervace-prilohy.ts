/**
 * Přílohy k rezervaci nebo ke dni — kontrola výběru a cesta v úložišti.
 *
 * Typy a 10 MB jsou stejné jako u příloh ke zprávám (lib/komunikace/
 * prilohy.ts), proto se odtamtud berou pomocné funkce. Liší se jen strop
 * počtu (20 na rezervaci nebo den) a kbelík. Drží je databáze: kbelík
 * `rezervace` a `rezervace_pripojit_prilohu`. Tady jsou jen kvůli tomu,
 * aby se nesmysl odmítl dřív, než se začne nahrávat.
 *
 * Čistý modul — testuje ho scripts/rezervace.test.mjs.
 */

import {
  MAX_BAJTU,
  jeObrazek,
  jeTypPriloh,
  ocistitNazev,
  typSouboru,
  velikostText,
  type SouborVyberu,
  type TypPriloh,
} from './komunikace/prilohy.ts'

export { MAX_BAJTU, jeObrazek, jeTypPriloh, ocistitNazev, typSouboru, velikostText, type TypPriloh }

export const KBELIK_REZERVACI = 'rezervace'

/** Kolik příloh unese jedna rezervace nebo jeden den pobočky. */
export const MAX_PRILOH_REZERVACE = 20

const PRIPONY: Record<TypPriloh, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * `<firma>/<pobočka>/<uuid>.<přípona>` — musí sedět s
 * `app.rezervace_cesta` (dvě složky, jméno souboru uuid a přípona).
 */
export function cestaPrilohy(tenantId: string, branchId: string, id: string, mime: TypPriloh): string {
  return `${tenantId}/${branchId}/${id}.${PRIPONY[mime]}`
}

export type VysledekVyberu = { platne: number[]; chyby: string[] }

/** Které z vybraných souborů jdou nahrát a proč ostatní ne. */
export function zkontrolovatVyber(soubory: SouborVyberu[], uzMa: number): VysledekVyberu {
  const platne: number[] = []
  const chyby: string[] = []
  let volno = Math.max(0, MAX_PRILOH_REZERVACE - uzMa)

  soubory.forEach((s, i) => {
    const nazev = ocistitNazev(s.name)
    const typ = typSouboru(s)
    if (typ === '' || (!jeTypPriloh(typ) && !jeObrazek(typ))) {
      chyby.push(`„${nazev}“: tenhle typ souboru nejde nahrát (jen fotky a PDF).`)
      return
    }
    if (s.size <= 0) {
      chyby.push(`„${nazev}“: soubor je prázdný.`)
      return
    }
    // Fotka se před nahráním zmenší; strop se u ní hlídá až potom.
    if (!jeObrazek(typ) && s.size > MAX_BAJTU) {
      chyby.push(`„${nazev}“: je větší než ${velikostText(MAX_BAJTU)}.`)
      return
    }
    if (volno <= 0) {
      chyby.push(`„${nazev}“: sem jde přidat nejvýš ${MAX_PRILOH_REZERVACE} příloh.`)
      return
    }
    volno -= 1
    platne.push(i)
  })

  return { platne, chyby }
}
