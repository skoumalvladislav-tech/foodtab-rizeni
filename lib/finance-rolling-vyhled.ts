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

export function pridatDny(datum: string, pocet: number): string {
  return zeDne(naDen(datum) + pocet)
}

// ---------------------------------------------------------------------
// Rozsah — celá firma, nebo jedna pobočka (Šéfík 13. 10. 2026: „mám
// otevřený Bernard Bar, budou vidět finance, které se týkají jen
// Bernard Baru"). Pobočka = JEN účty s její `branch_id`; firemní účet
// bez pobočky se na ní neukazuje ani nerozpočítává (lib/finance-rozsah.ts).
// ---------------------------------------------------------------------

/** Patří platební účet (jeho `branch_id`) do rozsahu? `pobocka` null = celá firma, všechny účty i firemní. */
export function ucetVRozsahu(branchIdUctu: string | null, pobocka: string | null): boolean {
  return pobocka === null || branchIdUctu === pobocka
}

/**
 * Dnešní zůstatek rozsahu z `aktualni_zustatky_uctu` (řádek po pobočce,
 * `null` = firemní účty; jen aktivní účty). Celá firma = součet všech
 * řádků (i bez účtů 0, jako dřív). Pobočka = jen její řádek — a `null`,
 * když ho nemá: pobočka bez aktivního účtu zůstatek NEMÁ, „0 Kč" by
 * tvrdilo, že na účtu nic není.
 */
export function zustatekRozsahu(
  zustatky: readonly { branchId: string | null; zustatekHaleru: number }[],
  pobocka: string | null,
): number | null {
  const radky = zustatky.filter((z) => ucetVRozsahu(z.branchId, pobocka))
  if (pobocka !== null && radky.length === 0) return null
  return radky.reduce((s, z) => s + z.zustatekHaleru, 0)
}

export type BodHistorie = { tydenOd: string; tydenDo: string; zustatekHaleru: number }

/**
 * Historických `pocetTydnu` týdnů PŘED týdnem, do kterého patří `dnes`.
 *
 * Jediný skutečný bod je DNEŠNÍ zůstatek — zbytek se dopočítá chůzí
 * NAZPÁTEK podle skutečných transakcí téhož rozsahu (ne podle plánu, na
 * rozdíl od `sestavRollingVyhled`, který jde dopředu). Poslední bod je
 * zůstatek na KONCI minulého týdne, tj. přesně tam, kde navazuje
 * počáteční zůstatek dopředného výhledu. Transakce mimo historii (tento
 * týden, starší) se ignorují.
 */
export function historieZustatku(
  aktualniZustatekHaleru: number,
  transakce: readonly SurovaTransakce[],
  dnes: string,
  pocetTydnu: number,
): BodHistorie[] {
  const zacatekAktualnihoTydne = pondelekTydne(dnes)
  const zacatekHistorie = pridatDny(zacatekAktualnihoTydne, -pocetTydnu * 7)
  const poTydnech = agregovatPoTydnech(transakce.filter((t) => t.datum >= zacatekHistorie && t.datum < zacatekAktualnihoTydne))

  // Kolik se za celou historii pohnulo, abychom se od dnešního (reálného)
  // zůstatku dostali k zůstatku PŘED prvním historickým týdnem.
  let celkovyPohybHistorie = 0
  for (const v of poTydnech.values()) celkovyPohybHistorie += v.prijmyHaleru - v.vydajeHaleru

  let zustatek = aktualniZustatekHaleru - celkovyPohybHistorie
  const body: BodHistorie[] = []
  for (let i = 0; i < pocetTydnu; i++) {
    const tydenOd = pridatDny(zacatekHistorie, i * 7)
    const tydenDo = pridatDny(tydenOd, 6)
    const tyden = poTydnech.get(tydenOd) ?? { prijmyHaleru: 0, vydajeHaleru: 0 }
    zustatek += tyden.prijmyHaleru - tyden.vydajeHaleru
    body.push({ tydenOd, tydenDo, zustatekHaleru: zustatek })
  }
  return body
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
