/**
 * Srovnatelná období pro trendy na Finance → Přehled.
 *
 * Do 14. 10. 2026 srovnával Přehled rozběhnutý měsíc (1.–14. 10.)
 * s CELÝM minulým měsícem (1.–30. 9.) — tržby proto v polovině měsíce
 * vždycky „padaly“ o desítky procent (Bernard Bar −47 %, firma −56,5 %),
 * i když se prodávalo stejně (kontrola v produkci 14. 10.).
 *
 *   * rozběhnutý měsíc (dnešek do něj patří) → 1.–dnes proti stejným
 *     dnům minulého měsíce, oříznutým na jeho konec (31. 3. proti 1.–28. 2.);
 *   * uzavřený (nebo budoucí) měsíc → celé měsíce jako dřív.
 *
 * `castecne` říká, že předchozí období není celý měsíc — co se počítá
 * jen po celých měsících (mzdy, `vydelky_prehled`), se pak nesrovnává.
 *
 * Čistá funkce, bez importů — zkouší ji scripts/finance-obdobi.test.mjs.
 */

export type Obdobi = { od: string; doData: string }

const MESIC = /^\d{4}-(0[1-9]|1[0-2])$/
const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function posledniDen(rok: number, mesic: number): number {
  return new Date(Date.UTC(rok, mesic, 0)).getUTCDate()
}

function dva(n: number): string {
  return String(n).padStart(2, '0')
}

/** První a poslední den měsíce `RRRR-MM`. */
export function hraniceMesice(mesic: string): Obdobi {
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

export function srovnatelnaObdobi(mesic: string, dnes: string): { obdobi: Obdobi; predchozi: Obdobi; castecne: boolean } {
  if (!DATUM.test(dnes)) throw new Error(`Neplatné datum „${dnes}".`)
  const cele = hraniceMesice(mesic)
  const minuly = predchoziMesic(mesic)
  const celyMinuly = hraniceMesice(minuly)
  if (dnes.slice(0, 7) !== mesic) return { obdobi: cele, predchozi: celyMinuly, castecne: false }

  const den = Number(dnes.slice(8, 10))
  const [r, m] = minuly.split('-').map(Number)
  const denMinuly = Math.min(den, posledniDen(r, m))
  return {
    obdobi: { od: cele.od, doData: dnes },
    predchozi: { od: celyMinuly.od, doData: `${minuly}-${dva(denMinuly)}` },
    // Poslední den měsíce = vlastně celý měsíc proti celému minulému.
    castecne: dnes !== cele.doData,
  }
}

/** „1.–14. 9." — popisek srovnávaného období u trendu (rozběhnutý měsíc). */
export function popisCastecnehoObdobi(o: Obdobi): string {
  const m = Number(o.od.slice(5, 7))
  return `${Number(o.od.slice(8, 10))}.–${Number(o.doData.slice(8, 10))}. ${m}.`
}
