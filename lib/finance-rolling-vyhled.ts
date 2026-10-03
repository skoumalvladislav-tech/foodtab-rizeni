/**
 * Rolling cashflow výhled na 13 týdnů, se třemi scénáři.
 *
 * Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5): „Cashflow:
 * skutečné pohyby a rolling výhled na 13 týdnů... Základní, konzervativní
 * a optimistický scénář s viditelnými předpoklady." Koeficienty jsou
 * proto EXPLICITNÍ konstanty (vidí je i uživatel na obrazovce), ne
 * skryté číslo v kódu.
 *
 * Zjednodušení, které stojí za zaznamenání: „aktuální" (nedokončený)
 * týden se počítá celý jako PLÁN, i když jeho uplynulá část už má
 * skutečné transakce. Přesnější rozpad (skutečnost do dneška + plán na
 * zbytek týdne) by dvojici zkomplikoval bez úměrného přínosu pro
 * týdenní (ne denní) granularitu, kterou zadání žádá.
 *
 * Čistá logika, bez IO — testovatelná přímo Nodem
 * (scripts/finance-rolling-vyhled.test.mjs).
 */

// Přípona `.ts` je schválně — soubory v `lib/` se pouštějí přímo Nodem
// v testech a bez ní by modul nenašel (stejný důvod jako marketing-klice.ts).
import { pocetVyskytu, type RadekPredpisu } from './finance-plan.ts'

export type Scenar = 'zakladni' | 'konzervativni' | 'optimisticky'

/** Viditelné předpoklady scénářů — zobrazují se na obrazovce vedle čísel. */
export const KOEFICIENTY_SCENARU: Record<Scenar, { prijmy: number; vydaje: number }> = {
  zakladni: { prijmy: 1, vydaje: 1 },
  konzervativni: { prijmy: 0.85, vydaje: 1.15 },
  optimisticky: { prijmy: 1.1, vydaje: 0.9 },
}

export const POCET_TYDNU = 13

export type SkutecnostTydne = { prijmyHaleru: number; vydajeHaleru: number }
export type SurovaTransakce = { datum: string; smer: string; castkaHaleru: number }

export type TydenniRadek = {
  tydenOd: string
  tydenDo: string
  /** `true` jen pro první týden (i===0) — ten, který obsahuje dnešek. */
  jeAktualni: boolean
  /**
   * Skutečnost zapsaná do dneška — jen informativní (srovnání "plán vs.
   * realita tenhle týden"), NIKDY nevstupuje do `zustatekNaKonciHaleru`.
   * Výhled jde od aktuálního týdne čistě DOPŘEDU, takže žádný vrácený
   * týden není uzavřená minulost, ze které by šlo počítat místo plánu.
   */
  skutecnostPrijmyHaleru: number | null
  skutecnostVydajeHaleru: number | null
  planPrijmyHaleru: number
  planVydajeHaleru: number
  zustatekNaKonciHaleru: number
}

export type RollingVyhled = {
  scenar: Scenar
  tydny: TydenniRadek[]
  nekdyPodNulou: boolean
}

function naDen(datum: string): number {
  const [y, m, d] = datum.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

function zeDne(den: number): string {
  return new Date(den * 86_400_000).toISOString().slice(0, 10)
}

/** Pondělí týdne, do kterého `datum` patří — ISO týden začíná pondělím. */
export function pondelekTydne(datum: string): string {
  const den = naDen(datum)
  const dow = new Date(den * 86_400_000).getUTCDay() // 0=neděle..6=sobota
  const posunZpet = dow === 0 ? 6 : dow - 1
  return zeDne(den - posunZpet)
}

function pridatDny(datum: string, pocet: number): string {
  return zeDne(naDen(datum) + pocet)
}

/** Skutečné transakce rozdělené po týdnech (pondělí jako klíč). Převody (prijem/vydaj jen) se nepočítají. */
export function agregovatPoTydnech(transakce: readonly SurovaTransakce[]): Map<string, SkutecnostTydne> {
  const mapa = new Map<string, SkutecnostTydne>()
  for (const t of transakce) {
    if (t.smer !== 'prijem' && t.smer !== 'vydaj') continue
    const tyden = pondelekTydne(t.datum)
    const aktualni = mapa.get(tyden) ?? { prijmyHaleru: 0, vydajeHaleru: 0 }
    if (t.smer === 'prijem') aktualni.prijmyHaleru += t.castkaHaleru
    else aktualni.vydajeHaleru += t.castkaHaleru
    mapa.set(tyden, aktualni)
  }
  return mapa
}

export function sestavRollingVyhled(
  predpisy: readonly RadekPredpisu[],
  skutecnostPoTydnech: ReadonlyMap<string, SkutecnostTydne>,
  pocatecniZustatekHaleru: number,
  dnes: string,
  scenar: Scenar,
  branchId: string | null,
): RollingVyhled {
  const koeficient = KOEFICIENTY_SCENARU[scenar]
  const prvniTyden = pondelekTydne(dnes)
  const predpisyPobocky = predpisy.filter((p) => p.branchId === branchId)

  let zustatek = pocatecniZustatekHaleru
  const tydny: TydenniRadek[] = []

  for (let i = 0; i < POCET_TYDNU; i++) {
    const tydenOd = pridatDny(prvniTyden, i * 7)
    const tydenDo = pridatDny(tydenOd, 6)

    let planPrijmy = 0
    let planVydaje = 0
    for (const p of predpisyPobocky) {
      const n = pocetVyskytu(p.perioda, p.dalsiSplatnost, tydenOd, tydenDo)
      if (n === 0) continue
      if (p.smer === 'prijem') planPrijmy += p.castkaHaleru * n
      else planVydaje += p.castkaHaleru * n
    }
    planPrijmy = Math.round(planPrijmy * koeficient.prijmy)
    planVydaje = Math.round(planVydaje * koeficient.vydaje)

    // Zůstatek se počítá VŽDY z plánu — viz komentář u TydenniRadek.
    zustatek = zustatek + planPrijmy - planVydaje

    const skutecnost = skutecnostPoTydnech.get(tydenOd) ?? null
    tydny.push({
      tydenOd,
      tydenDo,
      jeAktualni: i === 0,
      skutecnostPrijmyHaleru: skutecnost ? skutecnost.prijmyHaleru : null,
      skutecnostVydajeHaleru: skutecnost ? skutecnost.vydajeHaleru : null,
      planPrijmyHaleru: planPrijmy,
      planVydajeHaleru: planVydaje,
      zustatekNaKonciHaleru: zustatek,
    })
  }

  return { scenar, tydny, nekdyPodNulou: tydny.some((t) => t.zustatekNaKonciHaleru < 0) }
}
