/**
 * Kde host sedí — „Stůl nebo prostor“ od obsluhy a stoly z rezervačního
 * systému (Choice) do jednoho krátkého řádku.
 *
 * Čistý modul (žádné importy, žádné IO). Používá ho kalendář rezervací
 * (app/[rozsah]/rezervace/prvky.tsx) i ranní souhrn (lib/upozorneni-text.ts,
 * `popisSouhrnuDne`) — ať souhrn neukazuje u akce staré přání hosta, když
 * kalendář ukazuje stoly z Choice (kontrola kódu 4. 11., 4. kolo).
 * Testuje ho scripts/rezervace-pobocky.test.mjs a scripts/upozorneni.test.mjs.
 */

const male = (s: string) => s.trim().toLocaleLowerCase('cs')

/** Co z rezervace potřebuje řádek „kde host sedí“ (kalendář i ranní souhrn). */
export type MistoRadku = {
  /** „Stůl nebo prostor“ — obsluha, nebo zdroj, když byl prázdný. */
  prostor?: string | null
  /** Stoly přidělené v rezervačním systému („Patro: S1–S12“); `''` = žádné nebo neznámé. */
  misto_zdroje?: string
  /** Část podniku, kterou si přál host („Patro“); `''` = žádné přání. */
  prani_zdroje?: string
  /**
   * Kdo napsal `prostor`: `true` = zdroj (přání hosta), `false` = obsluha,
   * `null`/chybí = neví se (řádek starší než sloupec, nebo databáze před
   * db push) — `prostorZeZdroje` pak rozhodne podle shody s přáním.
   */
  prostor_ze_zdroje?: boolean | null
}

/**
 * Napsal „Stůl nebo prostor“ zdroj (přání hosta doplněné při načtení),
 * ne obsluha? Podle příznaku z databáze (`prostor_ze_zdroje`, migrace
 * 20261107100000). U řádku z doby před ním (`null`) podle shody
 * s přáním hosta — tak to dělalo 2. kolo pro všechny řádky, jenže text
 * od obsluhy, který zněl stejně jako přání, se pak schoval, a přání,
 * které se v Choice změnilo, se zase ukázalo (kontrola kódu 4. 11.,
 * 3. kolo). Bez příznaku i bez přání (databáze před db push) `false`:
 * prostor se ukáže jako dřív.
 */
export function prostorZeZdroje(r: MistoRadku): boolean {
  const prostor = (r.prostor ?? '').trim()
  if (!prostor) return false
  if (typeof r.prostor_ze_zdroje === 'boolean') return r.prostor_ze_zdroje
  const prani = (r.prani_zdroje ?? '').trim()
  return prani !== '' && male(prostor) === male(prani)
}

/**
 * Text stolů bez jediné části podniku: jen stoly, které v seznamu míst
 * zdroje nejsou (lib/rezervace-choice.ts, `mistoZChoice`). Vedle něj se
 * přání hosta ukáže — řekne aspoň, kde host sedí.
 */
const RE_JEN_BEZ_NAZVU = /^\d+ (?:stůl|stoly|stolů) bez názvu$/

/**
 * Kde host sedí, do krátkého řádku: „Stůl nebo prostor“ od obsluhy
 * a stoly z rezervačního systému („Patro: S1–S12“).
 *   * Prostor, který doplnil zdroj (přání hosta, `prostorZeZdroje`), se
 *     vedle stolů nepíše: „Patro“ vedle „Terasa: L7“ by se četlo, jako
 *     by host měl obojí (kontrola kódu 4. 11., 2. kolo). Bez stolů se
 *     místo něj ukáže AKTUÁLNÍ přání (`prani_zdroje`), ne to, které se
 *     do prostoru doplnilo kdysi — a když ho host v Choice smazal,
 *     neukáže se nic (detail řekne „doplněno z Choice“; 4. kolo).
 *   * Prostor od obsluhy se ukáže vždy, kromě případu, kdy je to PŘESNĚ
 *     jméno části podniku ze stolů („Patro“) nebo celý text stolů. Kus
 *     jména nestačí: „S1“ od obsluhy vedle „Patro: S12“ je jiný stůl
 *     a musí být vidět (kontrola kódu 4. 11.). Jméno oblasti se hledá
 *     jako „ · Patro: “ v celém textu, ne rozdělením textu — jméno
 *     oblasti může mít „: “ i „ · “ v sobě.
 */
export function mistoKratce(r: MistoRadku): string[] {
  const stoly = (r.misto_zdroje ?? '').trim()
  const prostor = (r.prostor ?? '').trim()
  const zeZdroje = prostorZeZdroje(r)
  const odObsluhy = zeZdroje ? '' : prostor
  const prani = (r.prani_zdroje ?? '').trim()
  if (!stoly) return odObsluhy ? [odObsluhy] : prani ? [prani] : []
  if (odObsluhy) {
    if (male(odObsluhy) === male(stoly) || ` · ${male(stoly)}`.includes(` · ${male(odObsluhy)}: `)) return [stoly]
    return [odObsluhy, stoly]
  }
  return prani && RE_JEN_BEZ_NAZVU.test(stoly) ? [prani, stoly] : [stoly]
}
