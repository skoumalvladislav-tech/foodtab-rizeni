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
 *
 * CHYBY: neplatný přístup (`pristup`) a nedostupná pokladna (`docasna`)
 * zastaví celý běh — týkají se všech provozoven pod jedním tokenem.
 * Ostatní (`jina`: den, kterému appka nerozumí, provozovna zrušená
 * v pokladně) zastaví jen TU provozovnu; ostatní běží dál. Dřív jedna
 * vadná provozovna (nebo jeden vadný den v historii) zastavila všechny
 * a kurzor historie na tom dni visel navždy.
 */

import type { ChybaPos } from './pos-provider-contract.ts'

export type PlanProvozovny = { posledni: string[]; mezera: string[]; dohnat: string[] }

export type UkolBehu = {
  id: string
  nazev: string
  /** Dnešní provozní den pobočky — po dotažení mezery se stane novým `souvisleDo`. */
  dnes: string
  dohnanoOd: string | null
  souvisleDo: string | null
  plan: PlanProvozovny
}

export type PostupProvozovny = { id: string; dohnanoOd: string | null; souvisleDo: string | null; chyba: ChybaPos | null }

export type VysledekBehu = {
  postup: PostupProvozovny[]
  /** Chyba, která zastavila celý běh (`pristup`/`docasna`), jinak `null`. */
  globalni: ChybaPos | null
  dnu: number
  zbyvaDnu: number
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
  const stav = new Map<string, PostupProvozovny & { posledniHotovo: boolean; mezeraHotovo: number }>()
  for (const u of ukoly) stav.set(u.id, { id: u.id, dohnanoOd: u.dohnanoOd, souvisleDo: u.souvisleDo, chyba: null, posledniHotovo: false, mezeraHotovo: 0 })

  const smiDal = (s: { chyba: ChybaPos | null }) => !globalni && !s.chyba && !casDosel()

  /** Jeden den; při chybě rozhodne, jestli končí celý běh, nebo jen provozovna. */
  const den = async (u: UkolBehu, s: { chyba: ChybaPos | null }, d: string): Promise<boolean> => {
    const chyba = await zpracovat(u, d)
    if (!chyba) {
      dnu++
      return true
    }
    if (chyba.druh === 'pristup' || chyba.druh === 'docasna') globalni = chyba
    else s.chyba = chyba
    return false
  }

  // 1) Poslední dny všech provozoven.
  for (const u of ukoly) {
    const s = stav.get(u.id)!
    let hotovo = 0
    for (const d of u.plan.posledni) {
      if (!smiDal(s)) break
      if (!(await den(u, s, d))) break
      hotovo++
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
  for (const u of ukoly) {
    const s = stav.get(u.id)!
    if (!s.posledniHotovo) continue
    let vse = true
    for (const d of u.plan.mezera) {
      if (!smiDal(s) || !(await den(u, s, d))) {
        vse = false
        break
      }
      s.mezeraHotovo++
      s.souvisleDo = d
    }
    if (vse) s.souvisleDo = u.dnes
  }

  // 3) Historie dozadu.
  for (const u of ukoly) {
    const s = stav.get(u.id)!
    if (s.dohnanoOd === null) continue
    for (const d of u.plan.dohnat) {
      if (d >= s.dohnanoOd) continue
      if (!smiDal(s) || !(await den(u, s, d))) break
      s.dohnanoOd = d
    }
  }

  let zbyvaDnu = 0
  for (const u of ukoly) {
    const s = stav.get(u.id)!
    if (s.souvisleDo !== u.dnes) zbyvaDnu += u.plan.mezera.length - s.mezeraHotovo
    zbyvaDnu += u.plan.dohnat.filter((d) => s.dohnanoOd === null || d < s.dohnanoOd).length
  }

  return {
    postup: [...stav.values()].map(({ id, dohnanoOd, souvisleDo, chyba }) => ({ id, dohnanoOd, souvisleDo, chyba })),
    globalni,
    dnu,
    zbyvaDnu,
  }
}
