/**
 * Export měsíčního rozpisu směn — model tabulky a její převod do Excelu.
 *
 * Model (`sestavitExportMesice`) je společný pro Excel i PDF, takže obě
 * podoby ukazují totéž. Je to čistá funkce nad daty, která rozpis stejně
 * načítá (`shifts`, `employees`, `useky`, `positions`); žádný druhý zdroj
 * pravdy, žádné dopočítávání jinde. PDF si z modelu skládá stránky
 * (`lib/rozpis-export-pdf.ts`), Excel list tabulek (`listyXlsx` níž).
 *
 * ---------------------------------------------------------------------
 * CO EXPORT OBSAHUJE — A CO SE VYZNAČUJE
 *
 * Všechny směny měsíce, které nejsou zrušené. Nevydané (ještě nebyly
 * rozeslané lidem) se poznají hvězdičkou a export to říká výslovně —
 * kdo si vytiskne rozpis na nástěnku, má vědět, že v něm jsou i směny,
 * které ještě nikdo nedostal. Nic se nepřidává ani neschovává.
 *
 * Hodiny jsou plánované délky směn bez pauzy uvnitř směny (trhaná
 * směna); automatická přestávka pobočky se neodečítá — je to plán,
 * ne docházka (stejně jako na obrazovce).
 *
 * Neobsazené směny mají vlastní řádek a do součtů hodin lidí se
 * nepočítají.
 */

import { cekaNaVydani, type OsobaD, type SmenaD } from './rozpis-desktop.ts'
import {
  denVTydnu,
  hhmm,
  hodinyKratce,
  jeVikend,
  minutSmeny,
  pondeliTydne,
  posunDatum,
  ZKRATKY_DNU,
} from './rozpis-mobil.ts'
import { STYL, type BunkaXlsx, type ListXlsx } from './xlsx-zapis.ts'

/* --- model ------------------------------------------------------------ */

export type RadekExportu = {
  klic: string
  /** `null` = neobsazené směny. */
  osobaId: string | null
  jmeno: string
  usek: string
  pozice: string
  pobocka: string
  /** Směny po dnech; každý řádek pole je jedna směna, už jako text. */
  podleDne: Map<string, string[]>
  /** Plánované minuty po dnech (do týdenních součtů v PDF). */
  minutPodleDne: Map<string, number>
  minut: number
  smen: number
}

/** Souhrn hodin člověka za měsíc — přes všechny pobočky, na kterých pracoval. */
export type SouhrnCloveka = {
  jmeno: string
  usek: string
  pozice: string
  /** „Černá Perla 24 h · Bernard 8 h“ — jen když se pracovalo na víc pobočkách, jinak prázdné. */
  pobocky: string
  smen: number
  minut: number
}

export type SkupinaExportu = {
  nazev: string
  radky: RadekExportu[]
  minut: number
}

export type ExportMesice = {
  /** „2026-09“ */
  mesic: string
  nadpis: string
  /** „Restaurace Černá Perla“ nebo „Celá firma“. */
  rozsah: string
  vytvoreno: string
  /** Všechny dny měsíce. */
  dny: string[]
  /** Týdny od pondělí do neděle, které měsíc pokrývají (i s dny mimo měsíc). */
  tydny: string[][]
  vicePobocek: boolean
  skupiny: SkupinaExportu[]
  /** Hodiny po lidech (jeden řádek na člověka, ne na pobočku). */
  souhrn: SouhrnCloveka[]
  neobsazene: RadekExportu | null
  /** Minuty lidí po dnech (bez neobsazených směn). */
  poDnech: Map<string, number>
  celkemMinut: number
  smen: number
  nevydanych: number
}

const MESICE_1P = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
] as const

/** „září 2026“ */
export function nazevMesice(mesic: string): string {
  const [r, m] = mesic.split('-').map(Number)
  return `${MESICE_1P[m - 1]} ${r}`
}

/** Dny měsíce `RRRR-MM`. */
export function dnyMesice(mesic: string): string[] {
  const [r, m] = mesic.split('-').map(Number)
  const pocet = new Date(Date.UTC(r, m, 0)).getUTCDate()
  return Array.from({ length: pocet }, (_, i) => `${mesic}-${String(i + 1).padStart(2, '0')}`)
}

/** Je to platný `RRRR-MM`? Adrese se nevěří. */
export function jeMesic(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

/** Text jedné směny do buňky: „08:00–16:00“, trhaná „… (pauza 15:00–17:00)“, nevydaná s hvězdičkou. */
export function textSmeny(s: SmenaD): string {
  const cas = `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}`
  const pauza = s.pauza_od && s.pauza_do ? ` (pauza ${hhmm(s.pauza_od)}–${hhmm(s.pauza_do)})` : ''
  return `${cas}${pauza}${cekaNaVydani(s) ? '*' : ''}`
}

export function sestavitExportMesice(v: {
  mesic: string
  smeny: SmenaD[]
  osoby: Map<string, OsobaD>
  /** id → název, v pořadí, které si firma nastavila. */
  useky: Map<string, string>
  /** id pozice → název. */
  pozice: Map<string, string>
  /** id pobočky → název. */
  pobocky: Map<string, string>
  rozsah: string
  vytvoreno: string
}): ExportMesice {
  const dny = dnyMesice(v.mesic)
  const dnyMnozina = new Set(dny)
  const smeny = v.smeny.filter((s) => s.status !== 'cancelled' && dnyMnozina.has(s.shift_date))

  const vicePobocek = new Set(smeny.map((s) => s.branch_id)).size > 1

  // Řádek = člověk (a u víc poboček i pobočka, ať se nemíchají).
  const radkyMapa = new Map<string, { osoba: OsobaD | null; branch: string; smeny: SmenaD[] }>()
  for (const s of smeny) {
    const klic = `${s.employee_id ?? 'neobsazeno'}|${vicePobocek ? s.branch_id : ''}`
    const r = radkyMapa.get(klic) ?? {
      osoba: s.employee_id ? (v.osoby.get(s.employee_id) ?? { id: s.employee_id, jmeno: 'Neznámý', usekId: null, poziceId: null, barva: null }) : null,
      branch: s.branch_id,
      smeny: [],
    }
    r.smeny.push(s)
    radkyMapa.set(klic, r)
  }

  const naRadek = (klic: string, r: { osoba: OsobaD | null; branch: string; smeny: SmenaD[] }): RadekExportu => {
    const podleDne = new Map<string, string[]>()
    const minutPodleDne = new Map<string, number>()
    for (const s of [...r.smeny].sort(
      (a, b) => a.shift_date.localeCompare(b.shift_date) || a.starts_at.localeCompare(b.starts_at),
    )) {
      const seznam = podleDne.get(s.shift_date) ?? []
      seznam.push(textSmeny(s))
      podleDne.set(s.shift_date, seznam)
      minutPodleDne.set(s.shift_date, (minutPodleDne.get(s.shift_date) ?? 0) + minutSmeny(s))
    }
    const usekId = r.osoba?.usekId
    return {
      klic,
      osobaId: r.osoba?.id ?? null,
      jmeno: r.osoba?.jmeno ?? 'Neobsazeno',
      usek: usekId && v.useky.has(usekId) ? (v.useky.get(usekId) as string) : 'Bez úseku',
      pozice: r.osoba?.poziceId ? (v.pozice.get(r.osoba.poziceId) ?? '') : '',
      pobocka: v.pobocky.get(r.branch) ?? '',
      podleDne,
      minutPodleDne,
      minut: r.smeny.reduce((n, s) => n + minutSmeny(s), 0),
      smen: r.smeny.length,
    }
  }

  const lide: RadekExportu[] = []
  let neobsazene: RadekExportu | null = null
  for (const [klic, r] of radkyMapa) {
    const radek = naRadek(klic, r)
    if (r.osoba) lide.push(radek)
    else neobsazene = radek
  }

  const poradiUseku = [...v.useky.values(), 'Bez úseku']
  const skupiny: SkupinaExportu[] = poradiUseku
    .map((nazev) => {
      const radky = lide
        .filter((r) => r.usek === nazev)
        .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs') || a.pobocka.localeCompare(b.pobocka, 'cs'))
      return { nazev, radky, minut: radky.reduce((n, r) => n + r.minut, 0) }
    })
    .filter((s) => s.radky.length > 0)

  /*
    Souhrn po lidech. Člověk na dvou pobočkách má v tabulce dva řádky (ať
    se směny nemíchají), ale hodiny za měsíc chce vedoucí vidět jako jedno
    číslo — u mzdy i u kontroly, kolik toho člověk odpracuje.
  */
  const souhrn: SouhrnCloveka[] = skupiny.flatMap((g) => {
    const poLidech = new Map<string, RadekExportu[]>()
    for (const r of g.radky) {
      const seznam = poLidech.get(r.osobaId ?? r.jmeno) ?? []
      seznam.push(r)
      poLidech.set(r.osobaId ?? r.jmeno, seznam)
    }
    return [...poLidech.values()].map((radky) => ({
      jmeno: radky[0].jmeno,
      usek: radky[0].usek,
      pozice: radky[0].pozice,
      pobocky:
        radky.length > 1
          ? radky.map((r) => `${r.pobocka} ${hodinyKratce(r.minut)}`).join(' · ')
          : '',
      smen: radky.reduce((k, r) => k + r.smen, 0),
      minut: radky.reduce((k, r) => k + r.minut, 0),
    }))
  })

  const poDnech = new Map<string, number>(dny.map((d) => [d, 0]))
  for (const s of smeny) {
    if (!s.employee_id) continue
    poDnech.set(s.shift_date, (poDnech.get(s.shift_date) ?? 0) + minutSmeny(s))
  }

  // Týdny od pondělí prvního dne do neděle posledního.
  const tydny: string[][] = []
  for (let pondeli = pondeliTydne(dny[0]); pondeli <= dny[dny.length - 1]; pondeli = posunDatum(pondeli, 7)) {
    tydny.push(Array.from({ length: 7 }, (_, i) => posunDatum(pondeli, i)))
  }

  return {
    mesic: v.mesic,
    nadpis: `Rozpis směn — ${nazevMesice(v.mesic)}`,
    rozsah: v.rozsah,
    vytvoreno: v.vytvoreno,
    dny,
    tydny,
    vicePobocek,
    skupiny,
    souhrn,
    neobsazene,
    poDnech,
    celkemMinut: lide.reduce((n, r) => n + r.minut, 0),
    smen: smeny.length,
    nevydanych: smeny.filter(cekaNaVydani).length,
  }
}

/** Minuty jako číslo hodin na dvě desetinná místa: 510 → 8,5. */
export const hodinyCislem = (minut: number): number => Math.round((minut / 60) * 100) / 100

/* --- Excel ----------------------------------------------------------- */

const s = (v: string, styl?: number): BunkaXlsx => ({ t: 's', v, s: styl })
const n = (v: number, styl?: number): BunkaXlsx => ({ t: 'n', v, s: styl })

/** „Po 21“ — zkratka dne a číslo, do záhlaví sloupce. */
const zahlaviDne = (den: string) => `${ZKRATKY_DNU[denVTydnu(den)][0]}${ZKRATKY_DNU[denVTydnu(den)][1].toLowerCase()} ${Number(den.slice(8, 10))}`

/**
 * List „Rozpis“: řádek na člověka, sloupec na den; List „Souhrn“: hodiny
 * a počet směn po lidech. Hodiny jsou čísla (jdou sčítat a filtrovat).
 */
export function listyXlsx(m: ExportMesice): ListXlsx[] {
  const predDny = m.vicePobocek ? 4 : 3 // Zaměstnanec, Úsek, Pozice, (Pobočka)
  const hlavicka: (BunkaXlsx | null)[] = [
    s('Zaměstnanec', STYL.hlavicka),
    s('Úsek', STYL.hlavicka),
    s('Pozice', STYL.hlavicka),
    ...(m.vicePobocek ? [s('Pobočka', STYL.hlavicka)] : []),
    ...m.dny.map((d) => s(zahlaviDne(d), jeVikend(d) ? STYL.hlavickaVikend : STYL.hlavicka)),
    s('Hodin', STYL.hlavicka),
  ]

  const radekLidi = (r: RadekExportu): (BunkaXlsx | null)[] => [
    s(r.jmeno, STYL.jmeno),
    s(r.usek, STYL.jmeno),
    s(r.pozice, STYL.jmeno),
    ...(m.vicePobocek ? [s(r.pobocka, STYL.jmeno)] : []),
    ...m.dny.map((d) => s((r.podleDne.get(d) ?? []).join('\n'), jeVikend(d) ? STYL.bunkaVikend : STYL.bunka)),
    n(hodinyCislem(r.minut), STYL.cislo),
  ]

  const radky: (BunkaXlsx | null)[][] = [
    [s(m.nadpis, STYL.titul)],
    [s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)],
    [],
    hlavicka,
  ]
  const vyskyRadku: Record<number, number> = { 1: 22, 4: 30 }

  for (const skupina of m.skupiny) {
    for (const r of skupina.radky) {
      const kolik = Math.max(1, ...m.dny.map((d) => (r.podleDne.get(d) ?? []).length))
      radky.push(radekLidi(r))
      if (kolik > 1) vyskyRadku[radky.length] = 15 * kolik
    }
  }
  if (m.neobsazene) {
    const kolik = Math.max(1, ...m.dny.map((d) => (m.neobsazene?.podleDne.get(d) ?? []).length))
    radky.push([
      s('Neobsazeno', STYL.jmeno),
      s('', STYL.jmeno),
      s('volné směny', STYL.jmeno),
      ...(m.vicePobocek ? [s('', STYL.jmeno)] : []),
      ...m.dny.map((d) => s((m.neobsazene?.podleDne.get(d) ?? []).join('\n'), jeVikend(d) ? STYL.bunkaVikend : STYL.bunka)),
      s('—', STYL.bunka),
    ])
    if (kolik > 1) vyskyRadku[radky.length] = 15 * kolik
  }

  radky.push([
    s('Celkem hodin (lidé)', STYL.souctovyText),
    ...Array.from({ length: predDny - 1 }, () => s('', STYL.souctovyText)),
    ...m.dny.map((d) => n(hodinyCislem(m.poDnech.get(d) ?? 0), STYL.cisloTucne)),
    n(hodinyCislem(m.celkemMinut), STYL.cisloTucne),
  ])
  radky.push([])
  radky.push([
    s(
      m.nevydanych > 0
        ? `* nevydaná směna — ještě nebyla rozeslána lidem (celkem ${m.nevydanych}). Hodiny jsou plánované délky směn bez automatické přestávky.`
        : 'Hodiny jsou plánované délky směn bez automatické přestávky.',
      STYL.poznamka,
    ),
  ])

  const rozpis: ListXlsx = {
    nazev: 'Rozpis',
    sloupce: [24, 14, 16, ...(m.vicePobocek ? [20] : []), ...m.dny.map(() => 13), 9],
    radky,
    zmrazit: { radky: 4, sloupce: 1 },
    vyskyRadku,
  }

  const souhrn: ListXlsx = {
    nazev: 'Souhrn',
    sloupce: [26, 16, 18, ...(m.vicePobocek ? [44] : []), 10, 10],
    radky: [
      [s(`Souhrn hodin — ${nazevMesice(m.mesic)}`, STYL.titul)],
      [s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)],
      [],
      [
        s('Zaměstnanec', STYL.hlavicka),
        s('Úsek', STYL.hlavicka),
        s('Pozice', STYL.hlavicka),
        ...(m.vicePobocek ? [s('Z toho po pobočkách', STYL.hlavicka)] : []),
        s('Směn', STYL.hlavicka),
        s('Hodin', STYL.hlavicka),
      ],
      ...m.souhrn.map((r) => [
        s(r.jmeno, STYL.jmeno),
        s(r.usek, STYL.jmeno),
        s(r.pozice, STYL.jmeno),
        ...(m.vicePobocek ? [s(r.pobocky, STYL.jmeno)] : []),
        n(r.smen, STYL.cislo),
        n(hodinyCislem(r.minut), STYL.cislo),
      ]),
      [
        s('Celkem', STYL.souctovyText),
        ...Array.from({ length: predDny - 1 }, () => s('', STYL.souctovyText)),
        n(m.souhrn.reduce((k, r) => k + r.smen, 0), STYL.cisloTucne),
        n(hodinyCislem(m.celkemMinut), STYL.cisloTucne),
      ],
    ],
    zmrazit: { radky: 4, sloupce: 0 },
    vyskyRadku: { 1: 22 },
    naSirku: false,
  }

  return [rozpis, souhrn]
}

/** Bezpečný základ názvu souboru: bez diakritiky a mezer. */
export function nazevSouboru(rozsah: string, mesic: string, pripona: string): string {
  const zaklad = rozsah
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `rozpis-smen-${mesic}${zaklad ? `-${zaklad}` : ''}.${pripona}`
}
