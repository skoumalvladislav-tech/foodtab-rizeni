/**
 * Jeden běh synchronizace pokladny — pořadí dnů, kurzory a chyby.
 * Čistý modul (žádné IO): stažení a zápis jednoho dne dodá volající
 * (`lib/pokladna-sync.ts`), takže `scripts/pokladna-napojeni.test.mjs`
 * ověří chování bez sítě a databáze.
 *
 * Pořadí pro každou přiřazenou provozovnu:
 *   1. posledních pár dní (dnešek běží, storna chodí dodatečně) — to,
 *      co lidé uvidí jako první;
 *   2. mezera po výpadku (`souvisleDo` … poslední dny), od nejstaršího —
 *      jinak by delší výpadek nechal v datech tichou díru;
 *   3. historie dozadu od `dohnanoOd` k `historie_od`.
 * Provozovny jdou od té, na kterou se nejdéle nedostalo (`souvisleDo`
 * nejstarší, nová napřed) — při pevném pořadí by se na poslední v seznamu
 * při krátkém čase nikdy nedostalo.
 *
 * CHYBY: neplatný přístup (`pristup`) a chyby celé pokladny
 * (`celoplosna` — limit dotazů, krátký token) zastaví celý běh.
 * Ostatní (den, kterému appka nerozumí; výpadek jednoho dne) zastaví jen
 * TU provozovnu, ostatní běží dál. Den, který u téže provozovny selže
 * `POKUSU_NEZ_PRESKOCIT`× po sobě, appka přeskočí a ohlásí — jinak by na
 * něm kurzor visel navždy.
 */

import type { ChybaPos } from './pos-provider-contract.ts'

export const POKUSU_NEZ_PRESKOCIT = 3

export type PlanProvozovny = { posledni: string[]; mezera: string[]; dohnat: string[] }

/** Den, na kterém stahování provozovny uvázlo, a kolikrát po sobě selhal. */
export type Uvazl = { den: string; pokusu: number }

export type UkolBehu = {
  id: string
  nazev: string
  /** Dnešní provozní den pobočky — po dotažení mezery se stane novým `souvisleDo`. */
  dnes: string
  dohnanoOd: string | null
  souvisleDo: string | null
  uvazl: Uvazl | null
  plan: PlanProvozovny
}

export type PostupProvozovny = {
  id: string
  dohnanoOd: string | null
  souvisleDo: string | null
  uvazl: Uvazl | null
  chyba: ChybaPos | null
  /** Dny přeskočené po opakovaném selhání — appka je ohlásí u připojení. */
  preskocene: { den: string; duvod: string }[]
}

export type VysledekBehu = {
  postup: PostupProvozovny[]
  /** Chyba, která zastavila celý běh (`pristup` nebo celoplošná), jinak `null`. */
  globalni: ChybaPos | null
  dnu: number
  zbyvaDnu: number
}

export function jeCeloplosna(chyba: ChybaPos): boolean {
  return chyba.druh === 'pristup' || chyba.celoplosna === true
}

/**
 * `zpracovat` stáhne a zapíše jeden den jedné provozovny; `null` = hotovo.
 * `casDosel` se ptá před každým dnem (časový strop funkce na serveru).
 */
export async function probehnoutBeh(
  ukoly: UkolBehu[],
  zpracovat: (ukol: UkolBehu, den: string) => Promise<ChybaPos | null>,
  casDosel: () => boolean,
): Promise<VysledekBehu> {
  let globalni: ChybaPos | null = null
  let dnu = 0

  type Stav = PostupProvozovny & { posledniHotovo: boolean; posledniZpracovano: number; mezeraHotovo: number }
  const stav = new Map<string, Stav>()
  for (const u of ukoly) {
    stav.set(u.id, { id: u.id, dohnanoOd: u.dohnanoOd, souvisleDo: u.souvisleDo, uvazl: u.uvazl, chyba: null, preskocene: [], posledniHotovo: false, posledniZpracovano: 0, mezeraHotovo: 0 })
  }
  // Nejdéle neobsloužená napřed (nová = bez souvisleDo úplně první); stabilně.
  const poradi = [...ukoly].sort((a, b) => (a.souvisleDo ?? '').localeCompare(b.souvisleDo ?? ''))

  const muzeDal = () => !globalni && !casDosel()

  /** Jeden den: `ok` (hotovo nebo přeskočeno po opakovaném selhání), nebo `chyba` (provozovna pro teď končí). */
  const den = async (u: UkolBehu, s: Stav, d: string): Promise<'ok' | 'chyba'> => {
    const chyba = await zpracovat(u, d)
    if (!chyba) {
      if (s.uvazl?.den === d) s.uvazl = null
      dnu++
      return 'ok'
    }
    if (jeCeloplosna(chyba)) {
      globalni = chyba
      return 'chyba'
    }
    const pokusu = (s.uvazl?.den === d ? s.uvazl.pokusu : 0) + 1
    if (pokusu >= POKUSU_NEZ_PRESKOCIT) {
      s.uvazl = null
      s.preskocene.push({ den: d, duvod: chyba.duvod })
      return 'ok'
    }
    s.uvazl = { den: d, pokusu }
    s.chyba = chyba
    return 'chyba'
  }

  // 1) Poslední dny. Chyba dne neukončí ostatní poslední dny téže provozovny
  //    (jsou na sobě nezávislé), jen se pak neposune nic, co předpokládá souvislost.
  for (const u of poradi) {
    const s = stav.get(u.id)!
    let hotovo = 0
    for (const d of u.plan.posledni) {
      if (!muzeDal()) break
      s.posledniZpracovano++
      if ((await den(u, s, d)) === 'ok') hotovo++
    }
    if (hotovo > 0 && hotovo === u.plan.posledni.length) {
      s.posledniHotovo = true
      // Kurzor historie začne za posledními dny, až když je appka má všechny.
      if (s.dohnanoOd === null) s.dohnanoOd = u.plan.posledni[u.plan.posledni.length - 1]
    }
  }

  // 2) Mezera po výpadku — jen po doběhlých posledních dnech. Jinak by
  //    „souvisle do dneška" lhalo i při PRÁZDNÉ mezeře: den, který v posledních
  //    dnech pořád selhává, by po vypadnutí z okna posledních dní už nikdo
  //    nestáhl.
  for (const u of poradi) {
    const s = stav.get(u.id)!
    if (!s.posledniHotovo) continue
    let vse = true
    for (const d of u.plan.mezera) {
      if (!muzeDal() || (await den(u, s, d)) === 'chyba') {
        vse = false
        break
      }
      s.mezeraHotovo++
      s.souvisleDo = d
    }
    if (vse) s.souvisleDo = u.dnes
  }

  // 3) Historie dozadu — kurzor jen po souvislé řadě hotových dnů.
  for (const u of poradi) {
    const s = stav.get(u.id)!
    if (s.dohnanoOd === null) continue
    for (const d of u.plan.dohnat) {
      if (d >= s.dohnanoOd) continue
      if (!muzeDal() || (await den(u, s, d)) === 'chyba') break
      s.dohnanoOd = d
    }
  }

  let zbyvaDnu = 0
  for (const u of ukoly) {
    const s = stav.get(u.id)!
    zbyvaDnu += u.plan.posledni.length - s.posledniZpracovano
    if (s.souvisleDo !== u.dnes) zbyvaDnu += u.plan.mezera.length - s.mezeraHotovo
    zbyvaDnu += u.plan.dohnat.filter((d) => s.dohnanoOd === null || d < s.dohnanoOd).length
  }

  return {
    postup: ukoly.map((u) => {
      const { id, dohnanoOd, souvisleDo, uvazl, chyba, preskocene } = stav.get(u.id)!
      return { id, dohnanoOd, souvisleDo, uvazl, chyba, preskocene }
    }),
    globalni,
    dnu,
    zbyvaDnu,
  }
}
