/**
 * Přílohy k rezervaci nebo ke dni — kontrola výběru a cesta v úložišti.
 *
 * Fotky, PDF a 10 MB jsou stejné jako u příloh ke zprávám (lib/komunikace/
 * prilohy.ts), proto se odtamtud berou pomocné funkce. Navíc jde dokument
 * Word .docx (zadání 2. 11. 2026, otázka 79) — jen tady, ne ve zprávách.
 * Starý .doc ani .docm s makry ne. Liší se i strop počtu (20 na rezervaci
 * nebo den) a kbelík. Drží je databáze: kbelík `rezervace`, CHECK na
 * `rezervace_prilohy.mime` a `app.rezervace_cesta` (20261106110000). Tady
 * jsou jen kvůli tomu, aby se nesmysl odmítl dřív, než se začne nahrávat.
 *
 * Čistý modul — testuje ho scripts/rezervace.test.mjs.
 */

import {
  MAX_BAJTU,
  TYPY_PRILOH,
  jeObrazek,
  ocistitNazev,
  typSouboru as typSouboruZpravy,
  velikostText,
  type SouborVyberu,
} from './komunikace/prilohy.ts'

export { MAX_BAJTU, jeObrazek, ocistitNazev, velikostText }

export const KBELIK_REZERVACI = 'rezervace'

/** Kolik příloh unese jedna rezervace nebo jeden den pobočky. */
export const MAX_PRILOH_REZERVACE = 20

/** Dokument Word (.docx). */
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Povolené typy a přípona v cestě v úložišti. */
const TYPY = { ...TYPY_PRILOH, [MIME_DOCX]: 'docx' } as const

export type TypPriloh = keyof typeof TYPY

export function jeTypPriloh(mime: string): mime is TypPriloh {
  return Object.prototype.hasOwnProperty.call(TYPY, mime)
}

/**
 * Pro `accept` u výběru souboru. Typ i přípona: iPhone se řídí typem,
 * Android někdy příponou. Je to jen nápověda — rozhoduje kontrola níž
 * a databáze.
 */
export const PRIJIMANE_SOUBORY = `image/*,application/pdf,.docx,${MIME_DOCX}`

/**
 * Typ souboru jako u zpráv, a navíc .docx: některé telefony a Windows bez
 * Office u něj dají prázdný typ nebo „application/octet-stream“. Pak
 * rozhodne přípona — ale jen .docx; .doc a .docm se neuhodnou nikdy.
 */
export function typSouboru(soubor: { name: string; type: string }): string {
  const typ = typSouboruZpravy(soubor)
  if ((typ === '' || typ === 'application/octet-stream') && /\.docx$/i.test(soubor.name.trim())) return MIME_DOCX
  return typ
}

/** .docx je zip: začíná „PK\x03\x04“. Starý .doc přejmenovaný na .docx ne. */
export function jeZip(zacatek: Uint8Array): boolean {
  return zacatek.length >= 4 && zacatek[0] === 0x50 && zacatek[1] === 0x4b && zacatek[2] === 0x03 && zacatek[3] === 0x04
}

/**
 * V prohlížeči se otevře jen PDF a fotka (jako přílohy faktur,
 * lib/faktury-priloha-odkaz.ts). Word se stáhne.
 */
const OTEVRIT_V_PROHLIZECI: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export function otevritVProhlizeci(mime: string): boolean {
  return OTEVRIT_V_PROHLIZECI.has(mime)
}

/**
 * Název souboru ke stažení. Odkaz z úložiště ho kóduje dvakrát, takže
 * diakritika by dorazila rozbitá — proto bez ní a bez zvláštních znaků,
 * s příponou podle typu.
 */
export function nazevKeStazeni(nazev: string, mime: string): string {
  const pripona = jeTypPriloh(mime) ? TYPY[mime] : ''
  const zaklad = nazev
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 100)
  const bezPripony = pripona && zaklad.toLowerCase().endsWith(`.${pripona}`) ? zaklad.slice(0, -(pripona.length + 1)) : zaklad
  const jmeno = bezPripony || 'priloha'
  return pripona ? `${jmeno}.${pripona}` : jmeno
}

/**
 * `<firma>/<pobočka>/<uuid>.<přípona>` — musí sedět s
 * `app.rezervace_cesta` (dvě složky, jméno souboru uuid a přípona).
 */
export function cestaPrilohy(tenantId: string, branchId: string, id: string, mime: TypPriloh): string {
  return `${tenantId}/${branchId}/${id}.${TYPY[mime]}`
}

const NEJDE = 'tenhle typ souboru nejde nahrát (jen fotky, PDF a Word .docx).'

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
      chyby.push(`„${nazev}“: ${NEJDE}`)
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

/**
 * Věta, když úložiště nahrání odmítne. Word .docx úložiště a databáze
 * přijmou až po nasazení migrace 20261106110000 — appka se z `main` nasadí
 * dřív než `db push`. Do té doby by kbelík Word odmítl anglickou hláškou
 * o typu souboru, a když by prošel, odmítla by cestu politika úložiště.
 * Jen tyhle dvě odpovědi u Wordu se přeloží; ostatní chyby (síť) zůstanou.
 *
 * Typ Wordu odmítá jen kbelík před `db push`, takže ta věta smí být jistá.
 * Politika úložiště ale odmítne i po něm (třeba komu mezitím vzali právo
 * přílohy přidávat) — její věta proto příčinu jen nabízí.
 */
export function chybaNahrani(nazev: string, mime: string, hlaska: string): string {
  if (mime === MIME_DOCX) {
    if (/mime type/i.test(hlaska)) {
      return `„${nazev}“: Word půjde přiložit až po aktualizaci databáze — zatím ho uložte jako PDF.`
    }
    if (/row-level security/i.test(hlaska)) {
      return `„${nazev}“ úložiště odmítlo. Jestli databáze ještě nebyla aktualizovaná, Word půjde přiložit až potom — zatím ho uložte jako PDF.`
    }
  }
  return `„${nazev}“ se nepodařilo nahrát: ${hlaska}`
}

/** Po zmenšení fotky: jde soubor nahrát, nebo proč ne? */
export function zkontrolujPoZmenseni(nazev: string, mime: string, velikost: number): string | null {
  if (!jeTypPriloh(mime)) return `„${ocistitNazev(nazev)}“: ${NEJDE}`
  if (velikost <= 0) return `„${ocistitNazev(nazev)}“: soubor je prázdný.`
  if (velikost > MAX_BAJTU) return `„${ocistitNazev(nazev)}“: je větší než ${velikostText(MAX_BAJTU)}.`
  return null
}
