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
 * proto zmenšuje jen tehdy, když musí (fotka větší než strop pro AI
 * `MAX_BAJTU_OBRAZKU_PRO_AI`, 5 MB, nebo formát, který AI ani úložiště
 * nevezmou — HEIC z iPhonu), a postupně: delší strana 4000 px s kvalitou
 * 0,9, pak 0,8, a teprve když to pořád nestačí, 3000 px (`POKUSY_ZMENSENI`).
 * Fotka, která se pod strop nevejde ani tak, se odmítne s vysvětlením
 * (`zkontrolovatPoZmenseni`) — nahraná by AI stejně nepřečetla.
 */

import {
  KBELIK_JINYCH_PLATEB,
  MAX_BAJTU_OBRAZKU_PRO_AI,
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
/** Delší strana posledního pokusu, když se fotka ani s nižší kvalitou nevejde pod strop pro AI. */
export const NEJDELSI_STRANA_DOKLADU_NOUZOVE = 3000
/** Kvalita JPEG zmenšeného dokladu; nižší se zkusí, když by vyšší vyšla nad strop pro AI. */
export const KVALITY_JPEG_DOKLADU = [0.9, 0.8] as const

export type PokusZmenseni = { strana: number; kvalita: number }

/**
 * Pořadí pokusů o zmenšení: napřed plné rozlišení dokladu s klesající
 * kvalitou, pak menší rozlišení. Písmo účtenky snese nižší kvalitu JPEG
 * líp než menší rozlišení, proto rozlišení jde dolů až nakonec.
 */
export const POKUSY_ZMENSENI: readonly PokusZmenseni[] = [NEJDELSI_STRANA_DOKLADU, NEJDELSI_STRANA_DOKLADU_NOUZOVE].flatMap((strana) =>
  KVALITY_JPEG_DOKLADU.map((kvalita) => ({ strana, kvalita })),
)

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
 *   * `nahrat`  — jde tak, jak je (povolený typ, fotka do stropu pro AI);
 *   * `zmensit` — fotka větší než strop pro AI (`MAX_BAJTU_OBRAZKU_PRO_AI`)
 *                 nebo v typu, který úložiště nevezme (HEIC…): zkusí se
 *                 zmenšit na JPEG a po zmenšení se zkontroluje znovu
 *                 (`zkontrolovatPoZmenseni`).
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
    const zmensit = jeObrazek(typ) && (!jeTypSouboru(typ) || s.size > MAX_BAJTU_OBRAZKU_PRO_AI)
    polozky.push({ index, akce: zmensit ? 'zmensit' : 'nahrat' })
  })

  return { polozky, chyby }
}

/**
 * Po zmenšení (nebo když se zmenšit nepodařilo): jde soubor nahrát?
 * `null` = ano, jinak věta proč ne.
 *
 * Fotka musí být pod stropem pro AI (`MAX_BAJTU_OBRAZKU_PRO_AI`) — větší
 * by se do úložiště sice vešla, ale rozpoznání by ji odmítlo
 * (`zkontrolovatPodklad`). PDF jen pod stropem úložiště: zmenšit se nedá
 * a originál se uchová i tak.
 */
export function zkontrolovatPoZmenseni(nazev: string, mime: string, velikost: number): string | null {
  const cisty = ocistitNazev(nazev)
  if (!jeTypSouboru(mime)) return `„${cisty}“: tenhle typ fotky se nepodařilo převést na JPEG — vyfoťte doklad znovu, nebo ho pošlete jako PDF.`
  if (!(velikost > 0)) return `„${cisty}“: soubor je prázdný.`
  if (mime !== 'application/pdf' && velikost > MAX_BAJTU_OBRAZKU_PRO_AI) {
    return (
      `„${cisty}“: fotku se nepodařilo zmenšit pod ${velikostText(MAX_BAJTU_OBRAZKU_PRO_AI)} (má ${velikostText(velikost)}), ` +
      'a tak velkou AI nepřečte. Vyfoťte doklad znovu s menším rozlišením, nebo ho pošlete jako PDF.'
    )
  }
  if (velikost > MAX_BAJTU_SOUBORU) return `„${cisty}“: je větší než ${velikostText(MAX_BAJTU_SOUBORU)}.`
  return null
}

/**
 * Zkouší pokusy o zmenšení (`POKUSY_ZMENSENI`) po pořadí a vrátí PRVNÍ
 * výsledek, který se vejde pod `strop`. Když se nevejde žádný, vrátí
 * nejmenší výsledek s `vejdeSe: false` — odmítne ho `zkontrolovatPoZmenseni`
 * s vysvětlením. `zakodovat` vrací `null`, když to prohlížeč neumí;
 * takový pokus se přeskočí.
 *
 * Čistá funkce nad podstrčeným kodérem — prohlížečové plátno je
 * v `zmensitDoklad`, tohle se dá spustit v Node.
 */
export async function zmensitPostupne(
  zakodovat: (pokus: PokusZmenseni) => Promise<Blob | null>,
  strop: number = MAX_BAJTU_OBRAZKU_PRO_AI,
  pokusy: readonly PokusZmenseni[] = POKUSY_ZMENSENI,
): Promise<{ blob: Blob | null; pokus: PokusZmenseni | null; vejdeSe: boolean }> {
  let nejmensi: { blob: Blob; pokus: PokusZmenseni } | null = null
  for (const pokus of pokusy) {
    const blob = await zakodovat(pokus)
    if (!blob || !(blob.size > 0)) continue
    if (blob.size <= strop) return { blob, pokus, vejdeSe: true }
    if (!nejmensi || blob.size < nejmensi.blob.size) nejmensi = { blob, pokus }
  }
  return { blob: nejmensi?.blob ?? null, pokus: nejmensi?.pokus ?? null, vejdeSe: false }
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
 * Pokusy jdou podle `POKUSY_ZMENSENI` (`zmensitPostupne`): 4000 px při
 * kvalitě 0,9 a 0,8, pak 3000 px. Vrátí první, který se vejde pod strop
 * pro AI; když žádný, ten nejmenší — a `zkontrolovatPoZmenseni` ho
 * odmítne s vysvětlením. Průhledné PNG dostane bílý podklad (v JPEG by
 * bylo černé).
 */
export async function zmensitDoklad(soubor: Blob): Promise<Blob | null> {
  let bitmapa: ImageBitmap | null = null
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
    const zdroj = await createImageBitmap(soubor, { imageOrientation: 'from-image' })
    bitmapa = zdroj
    const platna = new Map<number, HTMLCanvasElement | null>()
    const platnoPro = (strana: number): HTMLCanvasElement | null => {
      if (platna.has(strana)) return platna.get(strana) ?? null
      const { sirka, vyska } = rozmeryZmenseni(zdroj.width, zdroj.height, strana)
      const platno = document.createElement('canvas')
      platno.width = sirka
      platno.height = vyska
      const ctx = platno.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sirka, vyska)
        ctx.drawImage(zdroj, 0, 0, sirka, vyska)
      }
      platna.set(strana, ctx ? platno : null)
      return ctx ? platno : null
    }
    const { blob } = await zmensitPostupne(async ({ strana, kvalita }) => {
      const platno = platnoPro(strana)
      if (!platno) return null
      return new Promise<Blob | null>((hotovo) => platno.toBlob(hotovo, 'image/jpeg', kvalita))
    })
    return blob
  } catch {
    return null
  } finally {
    bitmapa?.close?.()
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
