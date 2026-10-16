/**
 * Jiné platby — doklady (fotky a PDF): kontrola výběru, zmenšení fotky
 * a cesta v úložišti. Návrh: docs/jine-platby-navrh.md, oddíly 3.2 a 6.
 *
 * Čistá logika + jedna funkce jen pro prohlížeč (`zmensitDoklad`, sahá
 * na canvas až při zavolání). Žádný `server-only`, žádné importy přes
 * `@/` — soubor používá klientská komponenta (nahrat-doklad.tsx),
 * serverová akce (akce-soubory.ts) i test
 * (`node scripts/jine-platby-obrazovka.test.mjs`).
 *
 * Čísla (typy, 10 MB, 10 souborů) jsou v lib/jine-platby-typy.ts a drží
 * je databáze: kbelík `jine-platby` a `jine_platby_pripojit_soubor`.
 * Tady jsou jen kvůli tomu, aby se nesmysl odmítl dřív, než se začne
 * nahrávat — rozhoduje vždycky server a databáze.
 *
 * PROČ VLASTNÍ ZMENŠENÍ, NE lib/obrazky.ts
 *
 * `zmensitObrazek` zmenšuje na delší stranu 2000 px a JPEG 0,85. Na fotku
 * z kuchyně je to dost, na účtenku ne: sjetina z pokladny je dlouhý
 * proužek drobného písma a po zmenšení na 2000 px by z řádku „2× pivo
 * 0,5 l 98,00" zbyla šmouha, kterou nepřečte člověk ani AI. Doklad se
 * proto zmenšuje jen tehdy, když musí (větší než strop pro AI nebo
 * formát, který AI ani úložiště nevezmou — HEIC z iPhonu), a jen na
 * delší stranu 4000 px s kvalitou 0,9.
 */

import {
  KBELIK_JINYCH_PLATEB,
  MAX_BAJTU_PRO_AI,
  MAX_BAJTU_SOUBORU,
  MAX_SOUBORU_NA_ZAZNAM,
  TYPY_SOUBORU,
  type TypSouboru,
} from './jine-platby-typy.ts'
import { jeObrazek, ocistitNazev, typSouboru, velikostText } from './komunikace/prilohy.ts'
import { noveId } from './obrazky.ts'

export { KBELIK_JINYCH_PLATEB, noveId, ocistitNazev, typSouboru, velikostText }

/** Delší strana zmenšeného dokladu. Víc než u fotek ze zpráv (2000) — drobné písmo účtenky musí zůstat čitelné. */
export const NEJDELSI_STRANA_DOKLADU = 4000
/** Kvalita JPEG zmenšeného dokladu; druhý pokus, když by první vyšel nad strop pro AI. */
export const KVALITY_JPEG_DOKLADU = [0.9, 0.8] as const

/** Přípona v cestě podle typu — musí sedět s `app.jine_platby_cesta` a kontrolou v `jine_platby_pripojit_soubor`. */
export const PRIPONY_SOUBORU: Record<TypSouboru, 'jpg' | 'png' | 'webp' | 'pdf'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function jeTypSouboru(mime: string): mime is TypSouboru {
  return (TYPY_SOUBORU as readonly string[]).includes(mime)
}

export type SouborVyberu = { name: string; type: string; size: number }

/**
 * Co se s vybraným souborem udělá:
 *   * `nahrat`  — jde tak, jak je (povolený typ, do stropu pro AI);
 *   * `zmensit` — fotka větší než strop pro AI nebo v typu, který
 *                 úložiště nevezme (HEIC…): zkusí se zmenšit na JPEG
 *                 a po zmenšení se zkontroluje znovu (`zkontrolovatPoZmenseni`).
 */
export type PolozkaVyberu = { index: number; akce: 'nahrat' | 'zmensit' }
export type VysledekVyberu = { polozky: PolozkaVyberu[]; chyby: string[] }

/**
 * Které z vybraných souborů se vezmou a jak. `uzMa` = kolik souborů už
 * záznam má. Přebytek nad `MAX_SOUBORU_NA_ZAZNAM` se odřízne a řekne se
 * to; nepovolený typ, prázdný soubor a příliš velké PDF se odmítnou
 * jmenovitě.
 */
export function zkontrolovatVyber(soubory: readonly SouborVyberu[], uzMa: number): VysledekVyberu {
  const polozky: PolozkaVyberu[] = []
  const chyby: string[] = []
  let volno = Math.max(0, MAX_SOUBORU_NA_ZAZNAM - Math.max(0, Math.trunc(Number(uzMa) || 0)))

  soubory.forEach((s, index) => {
    const nazev = ocistitNazev(s.name)
    const typ = typSouboru(s)
    if (typ === '' || (!jeTypSouboru(typ) && !jeObrazek(typ))) {
      chyby.push(`„${nazev}“: k dokladu jde přidat jen fotka (JPEG, PNG, WebP, HEIC) nebo PDF.`)
      return
    }
    if (!(s.size > 0)) {
      chyby.push(`„${nazev}“: soubor je prázdný.`)
      return
    }
    // PDF se zmenšit nedá — nad strop úložiště rovnou ne.
    if (!jeObrazek(typ) && s.size > MAX_BAJTU_SOUBORU) {
      chyby.push(`„${nazev}“: je větší než ${velikostText(MAX_BAJTU_SOUBORU)}.`)
      return
    }
    if (volno <= 0) {
      chyby.push(`„${nazev}“: k jednomu záznamu jde připojit nejvýš ${MAX_SOUBORU_NA_ZAZNAM} souborů.`)
      return
    }
    volno -= 1
    const zmensit = jeObrazek(typ) && (!jeTypSouboru(typ) || s.size > MAX_BAJTU_PRO_AI)
    polozky.push({ index, akce: zmensit ? 'zmensit' : 'nahrat' })
  })

  return { polozky, chyby }
}

/** Po zmenšení (nebo když se zmenšit nepodařilo): jde soubor nahrát? `null` = ano, jinak věta proč ne. */
export function zkontrolovatPoZmenseni(nazev: string, mime: string, velikost: number): string | null {
  const cisty = ocistitNazev(nazev)
  if (!jeTypSouboru(mime)) return `„${cisty}“: tenhle typ fotky se nepodařilo převést na JPEG — vyfoťte doklad znovu, nebo ho pošlete jako PDF.`
  if (!(velikost > 0)) return `„${cisty}“: soubor je prázdný.`
  if (velikost > MAX_BAJTU_SOUBORU) return `„${cisty}“: je i po zmenšení větší než ${velikostText(MAX_BAJTU_SOUBORU)}.`
  return null
}

/**
 * Rozměry zmenšeného dokladu: delší strana nejvýš `nejdelsi`, poměr stran
 * zůstává, nikdy se nezvětšuje, nikdy pod 1 px.
 */
export function rozmeryZmenseni(sirka: number, vyska: number, nejdelsi: number = NEJDELSI_STRANA_DOKLADU): { sirka: number; vyska: number } {
  const s = Math.max(1, Math.round(Number(sirka) || 0))
  const v = Math.max(1, Math.round(Number(vyska) || 0))
  const delsi = Math.max(s, v)
  if (delsi <= nejdelsi) return { sirka: s, vyska: v }
  const meritko = nejdelsi / delsi
  return { sirka: Math.max(1, Math.round(s * meritko)), vyska: Math.max(1, Math.round(v * meritko)) }
}

/**
 * Zmenšená JPEG kopie fotky dokladu, nebo `null`, když to prohlížeč neumí
 * (starší prohlížeč, HEIC v prohlížeči bez podpory). Jen pro prohlížeč.
 *
 * Kvalita 0,9; kdyby výsledek pořád přesáhl strop pro AI, zkusí se
 * jednou 0,8. Průhledné PNG dostane bílý podklad (v JPEG by bylo černé).
 */
export async function zmensitDoklad(soubor: Blob): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
    const bitmapa = await createImageBitmap(soubor, { imageOrientation: 'from-image' })
    const { sirka, vyska } = rozmeryZmenseni(bitmapa.width, bitmapa.height)
    const platno = document.createElement('canvas')
    platno.width = sirka
    platno.height = vyska
    const ctx = platno.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, sirka, vyska)
    ctx.drawImage(bitmapa, 0, 0, sirka, vyska)
    bitmapa.close?.()
    let vysledek: Blob | null = null
    for (const kvalita of KVALITY_JPEG_DOKLADU) {
      vysledek = await new Promise<Blob | null>((hotovo) => platno.toBlob(hotovo, 'image/jpeg', kvalita))
      if (vysledek && vysledek.size <= MAX_BAJTU_PRO_AI) break
    }
    return vysledek
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Cesta v kbelíku: `<firma>/<pobočka>/<záznam>/<uuid>.<přípona>` — tvar,
 * který čte `app.jine_platby_cesta` (malá písmena, jinak ji politika
 * úložiště nepustí). Z prohlížeče je to jen NÁVRH: server ji přeskládá
 * a ověří (`overitCestu`), databáze znovu.
 */
export function cestaSouboru(tenantId: string, branchId: string, zaznamId: string, id: string, mime: TypSouboru): string {
  return `${tenantId.toLowerCase()}/${branchId.toLowerCase()}/${zaznamId.toLowerCase()}/${id.toLowerCase()}.${PRIPONY_SOUBORU[mime]}`
}

/**
 * Serverová kontrola cesty před stažením a připojením: přesně
 * `<firma>/<pobočka>/<záznam>/<uuid>.<přípona>` TOHOTO záznamu, nic
 * navíc (žádné `..`, lomítko, velká písmena, cizí přípona). Vrací cestu
 * PŘESKLÁDANOU z ověřených částí a typ, který podle přípony očekáváme
 * v obsahu; jinak `null`.
 */
export function overitCestu(
  cesta: string,
  tenantId: string,
  branchId: string,
  zaznamId: string,
): { cesta: string; mime: TypSouboru } | null {
  if (typeof cesta !== 'string' || cesta.length > 300) return null
  const t = String(tenantId ?? '').toLowerCase()
  const b = String(branchId ?? '').toLowerCase()
  const z = String(zaznamId ?? '').toLowerCase()
  if (!UUID.test(t) || !UUID.test(b) || !UUID.test(z)) return null
  const predpona = `${t}/${b}/${z}/`
  if (!cesta.startsWith(predpona)) return null
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp|pdf)$/.exec(cesta.slice(predpona.length))
  if (!m) return null
  const mime = (Object.keys(PRIPONY_SOUBORU) as TypSouboru[]).find((k) => PRIPONY_SOUBORU[k] === m[2])
  if (!mime) return null
  return { cesta: `${predpona}${m[1]}.${m[2]}`, mime }
}

/**
 * Id záznamu z hlášky databáze o duplicitě (23505 z
 * `jine_platby_pripojit_soubor`: „Tento soubor už je připojený
 * k záznamu <uuid>."). Když tam není, `null` — obrazovka pak ukáže jen
 * větu bez odkazu.
 */
export function zaznamZDuplicity(zprava: string | null | undefined): string | null {
  const m = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(String(zprava ?? ''))
  return m ? m[1].toLowerCase() : null
}
