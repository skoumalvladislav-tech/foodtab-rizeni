/**
 * Srovnání rozběhnutého měsíce na Finance → Přehled — čistá logika.
 *
 * Trend „Tržby" a „Cashflow" srovnával rozběhnutý měsíc s CELÝM minulým:
 * 12. 10. tedy 12 dní proti 30 a šipka svítila červeně dolů skoro vždycky.
 * U rozběhnutého měsíce se proto srovnávají STEJNÉ DNY: 1. až včerejšek
 * (dnešek ještě běží a pokladna ho dosílá) proti týmž dnům minulého
 * měsíce. Uzavřený měsíc se srovnává celý s celým.
 *
 * Testy: `scripts/pokladna-trzby.test.mjs`.
 */

export type Rozsah = { od: string; doData: string }

export type SrovnaniMesice =
  /** Uzavřený (minulý) měsíc — celý proti celému předchozímu. */
  | { druh: 'cele' }
  /** Rozběhnutý měsíc v první den — žádný ukončený den, trend se nekreslí. */
  | { druh: 'zadne' }
  /** Rozběhnutý měsíc — dny 1…`dnu` proti týmž dnům předchozího měsíce. */
  | { druh: 'stejne_dny'; dnu: number; aktualni: Rozsah; predchozi: Rozsah }

const MESIC = /^(\d{4})-(\d{2})$/
const DEN = /^\d{4}-\d{2}-\d{2}$/

function posledniDen(rok: number, mesic: number): number {
  return new Date(Date.UTC(rok, mesic, 0)).getUTCDate()
}
function dvojmistne(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * `mesic` = zobrazený měsíc 'RRRR-MM', `dnes` = dnešní provozní den
 * 'RRRR-MM-DD'. Budoucí měsíc se bere jako „zadne" (nic k srovnání).
 */
export function srovnaniMesice(mesic: string, dnes: string): SrovnaniMesice {
  const m = MESIC.exec(mesic)
  if (!m || !DEN.test(dnes)) throw new Error(`Neplatný měsíc nebo den („${mesic}", „${dnes}").`)
  const aktualniMesic = dnes.slice(0, 7)
  if (mesic < aktualniMesic) return { druh: 'cele' }
  if (mesic > aktualniMesic) return { druh: 'zadne' }

  const dnu = Number(dnes.slice(8, 10)) - 1
  if (dnu < 1) return { druh: 'zadne' }

  const rok = Number(m[1])
  const cislo = Number(m[2])
  const rokPred = cislo === 1 ? rok - 1 : rok
  const mesicPred = cislo === 1 ? 12 : cislo - 1
  const dnuPred = Math.min(dnu, posledniDen(rokPred, mesicPred))
  return {
    druh: 'stejne_dny',
    dnu,
    aktualni: { od: `${mesic}-01`, doData: `${mesic}-${dvojmistne(dnu)}` },
    predchozi: { od: `${rokPred}-${dvojmistne(mesicPred)}-01`, doData: `${rokPred}-${dvojmistne(mesicPred)}-${dvojmistne(dnuPred)}` },
  }
}

/** „1.–12. 9." — popisek srovnávaného rozsahu u trendu. */
export function popisRozsahu(r: Rozsah): string {
  const den = (d: string) => Number(d.slice(8, 10))
  const mesic = Number(r.doData.slice(5, 7))
  return den(r.od) === den(r.doData) ? `${den(r.od)}. ${mesic}.` : `${den(r.od)}.–${den(r.doData)}. ${mesic}.`
}
