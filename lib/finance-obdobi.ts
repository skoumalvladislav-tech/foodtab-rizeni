/**
 * Srovnatelná období pro trendy na Finance → Přehled — čistá logika, bez
 * importů.
 *
 * Do 14. 10. 2026 srovnával Přehled rozběhnutý měsíc (1.–14. 10.)
 * s CELÝM minulým měsícem (1.–30. 9.) — tržby proto v polovině měsíce
 * vždycky „padaly“ o desítky procent (Bernard Bar −47 %, firma −56,5 %),
 * i když se prodávalo stejně (kontrola v produkci 14. 10.).
 *
 * Hodnoty na kartách jsou dál za CELÝ zobrazený měsíc. Jen TREND srovnává
 * srovnatelné dny (`srovnaniMesice`):
 *   * rozběhnutý měsíc → 1. až VČEREJŠEK (dnešek ještě běží a pokladna ho
 *     dosílá) proti týmž dnům minulého měsíce, oříznutým na jeho konec
 *     (31. 3. → 1.–30. 3. proti 1.–28. 2.);
 *   * první den rozběhnutého měsíce (žádný ukončený den) a budoucí měsíc
 *     → bez trendu na všech kartách;
 *   * uzavřený měsíc → celý proti celému minulému.
 * „Dnes" je PROVOZNÍ den (od 05:00, `provozniDen` v lib/pokladna-cas.ts),
 * jako tržby z pokladen — ve 2 ráno 1. 11. pořád běží 31. 10.
 *
 * Testy: scripts/finance-obdobi.test.mjs (i že je Přehled a výpočet
 * KPI opravdu používají) a scripts/pokladna-trzby.test.mjs.
 */

export type Rozsah = { od: string; doData: string }

export type SrovnaniMesice =
  /** Uzavřený (minulý) měsíc — celý proti celému předchozímu. */
  | { druh: 'cele' }
  /** První den rozběhnutého měsíce, nebo budoucí měsíc — trend se nekreslí. */
  | { druh: 'zadne' }
  /** Rozběhnutý měsíc — dny 1…`dnu` proti týmž dnům předchozího měsíce. */
  | { druh: 'stejne_dny'; dnu: number; aktualni: Rozsah; predchozi: Rozsah }

const MESIC = /^\d{4}-(0[1-9]|1[0-2])$/
const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function posledniDen(rok: number, mesic: number): number {
  return new Date(Date.UTC(rok, mesic, 0)).getUTCDate()
}

function dva(n: number): string {
  return String(n).padStart(2, '0')
}

/** První a poslední den měsíce `RRRR-MM`. */
export function hraniceMesice(mesic: string): Rozsah {
  if (!MESIC.test(mesic)) throw new Error(`Neplatný měsíc „${mesic}".`)
  const [r, m] = mesic.split('-').map(Number)
  return { od: `${mesic}-01`, doData: `${mesic}-${dva(posledniDen(r, m))}` }
}

/** Měsíc před `RRRR-MM` (leden → prosinec předchozího roku). */
export function predchoziMesic(mesic: string): string {
  if (!MESIC.test(mesic)) throw new Error(`Neplatný měsíc „${mesic}".`)
  const [r, m] = mesic.split('-').map(Number)
  return m === 1 ? `${r - 1}-12` : `${r}-${dva(m - 1)}`
}

/**
 * Co se u trendu srovnává. `mesic` = zobrazený měsíc 'RRRR-MM', `dnes` =
 * dnešní PROVOZNÍ den 'RRRR-MM-DD'.
 */
export function srovnaniMesice(mesic: string, dnes: string): SrovnaniMesice {
  if (!MESIC.test(mesic)) throw new Error(`Neplatný měsíc „${mesic}".`)
  if (!DATUM.test(dnes)) throw new Error(`Neplatné datum „${dnes}".`)
  const bezi = dnes.slice(0, 7)
  if (mesic < bezi) return { druh: 'cele' }
  if (mesic > bezi) return { druh: 'zadne' }

  // Ukončené dny rozběhnutého měsíce: 1. až včerejšek.
  const dnu = Number(dnes.slice(8, 10)) - 1
  if (dnu < 1) return { druh: 'zadne' }
  const minuly = predchoziMesic(mesic)
  const [r, m] = minuly.split('-').map(Number)
  return {
    druh: 'stejne_dny',
    dnu,
    aktualni: { od: `${mesic}-01`, doData: `${mesic}-${dva(dnu)}` },
    predchozi: { od: `${minuly}-01`, doData: `${minuly}-${dva(Math.min(dnu, posledniDen(r, m)))}` },
  }
}

/** „1.–12. 9." (jeden den „1. 9.") — popisek srovnávaného rozsahu u trendu. */
export function popisRozsahu(r: Rozsah): string {
  const den = (d: string) => Number(d.slice(8, 10))
  const mesic = Number(r.doData.slice(5, 7))
  return den(r.od) === den(r.doData) ? `${den(r.od)}. ${mesic}.` : `${den(r.od)}.–${den(r.doData)}. ${mesic}.`
}
