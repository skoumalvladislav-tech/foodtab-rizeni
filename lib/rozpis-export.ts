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

import { cekaNaVydani, kratkyCas, type OsobaD, type SmenaD } from './rozpis-desktop.ts'
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
import { STYL, textTisku, type BunkaXlsx, type ListXlsx } from './xlsx-zapis.ts'

/* --- model ------------------------------------------------------------ */

/** Jedna směna rozložená na části — z nich se skládá text do Excelu i do PDF. */
export type DilSmeny = {
  /** „08:00–16:00“ */
  cas: string
  /** „15:00–17:00“ u trhané směny, jinak `null`. */
  pauza: string | null
  /** Ještě nebyla rozeslána lidem (značí se hvězdičkou). */
  nevydana: boolean
}

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
  /** Totéž po částech (čas, pauza, hvězdička) — pro úzké buňky na výšku. */
  dilyPodleDne: Map<string, DilSmeny[]>
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

export function dilSmeny(s: SmenaD): DilSmeny {
  return {
    cas: `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}`,
    pauza: s.pauza_od && s.pauza_do ? `${hhmm(s.pauza_od)}–${hhmm(s.pauza_do)}` : null,
    nevydana: cekaNaVydani(s),
  }
}

/** Text jedné směny do buňky: „08:00–16:00“, trhaná „… (pauza 15:00–17:00)“, nevydaná s hvězdičkou. */
export function textSmeny(s: SmenaD): string {
  const d = dilSmeny(s)
  return `${d.cas}${d.pauza ? ` (pauza ${d.pauza})` : ''}${d.nevydana ? '*' : ''}`
}

/** „15:00–17:00“ → „15–17“, „15:30–17:00“ → „15:30–17“ (do úzké buňky). */
export function pauzaKratce(pauza: string): string {
  return pauza.split('–').map(kratkyCas).join('–')
}

const MESIC_2P = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']

/** „21.–27. září“, přes hranici měsíce „31. srpna – 6. září“. `dny` je sedm po sobě jdoucích dní. */
export function popisTydne(dny: string[]): string {
  const [, m1, d1] = dny[0].split('-').map(Number)
  const [, m2, d2] = dny[6].split('-').map(Number)
  return m1 === m2 ? `${d1}.–${d2}. ${MESIC_2P[m2 - 1]}` : `${d1}. ${MESIC_2P[m1 - 1]} – ${d2}. ${MESIC_2P[m2 - 1]}`
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
    const dilyPodleDne = new Map<string, DilSmeny[]>()
    const minutPodleDne = new Map<string, number>()
    for (const s of [...r.smeny].sort(
      (a, b) => a.shift_date.localeCompare(b.shift_date) || a.starts_at.localeCompare(b.starts_at),
    )) {
      const seznam = podleDne.get(s.shift_date) ?? []
      seznam.push(textSmeny(s))
      podleDne.set(s.shift_date, seznam)
      dilyPodleDne.set(s.shift_date, [...(dilyPodleDne.get(s.shift_date) ?? []), dilSmeny(s)])
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
      dilyPodleDne,
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

/*
  Rozměry týdenního listu pro tisk na A4 NA VÝŠKU. Šířka sloupců je ve
  znacích Excelu (jeden znak ≈ 7 px, plus 5 px na sloupec); z ní se počítá
  měřítko tak, aby se sedm dnů vešlo na šířku papíru bez ořezu.
*/
const SIRKA_JMENA = 20
const SIRKA_DNE = 12.5 // „pauza 14:30–16:30“ drobným písmem se ještě vejde na jeden řádek
const SIRKA_HODIN = 6.5
const VYSKA_RADKU_XLSX = 13.5 // jeden řádek písma 10 pt
const TISK_SIRKA_PT = (8.27 - 2 * 0.4) * 72 // A4 na výšku, okraje 0,4″
const TISK_VYSKA_PT = (11.69 - 2 * 0.5) * 72 // okraje 0,5″ nahoře a dole
const REZERVA_TISKU = 0.96 // tiskárny a Excel se v pár bodech liší

/** Měřítko v %, při kterém se sloupce vejdou na šířku A4 na výšku. */
export function meritkoNaSirku(sloupce: number[]): number {
  const pt = sloupce.reduce((soucet, w) => soucet + (w * 7 + 5) * 0.75, 0)
  return Math.max(40, Math.min(100, Math.floor((TISK_SIRKA_PT / pt) * 100 * REZERVA_TISKU)))
}

/** Jeden řádek buňky se směnami; `drobne` = vedlejší údaj (pauza) pod časem. */
export type RadekSmeny = { text: string; drobne: boolean }

/** Směny dne na řádky buňky: „10:00–22:00*“ a případně pod ním „pauza 15–17“. */
export function radkySmeny(dily: DilSmeny[]): RadekSmeny[] {
  return dily.flatMap((d) => [
    { text: `${d.cas}${d.nevydana ? '*' : ''}`, drobne: false },
    ...(d.pauza ? [{ text: `pauza ${pauzaKratce(d.pauza)}`, drobne: true }] : []),
  ])
}

/** Výška řádku buňky v bodech: hlavní řádek písma 10 pt, drobný 8 pt. */
const vyskaRadkuSmeny = (radky: RadekSmeny[]) => radky.reduce((v, r) => v + (r.drobne ? 11 : VYSKA_RADKU_XLSX), 0)

/**
 * Sešit: „Rozpis“ (po týdnech, A4 na výšku — k tisku), „Souhrn“ (hodiny po
 * lidech, A4 na výšku) a „Matice měsíce“ (jeden řádek na člověka, sloupec
 * na den — k třídění a filtrování; na papír se nehodí, 30 sloupců se na
 * výšku nevejde čitelně). Hodiny jsou čísla, dají se sčítat.
 */
export function listyXlsx(m: ExportMesice): ListXlsx[] {
  return [rozpisPoTydnech(m), souhrnXlsx(m), maticeMesice(m)]
}

const zapatiTisku = (m: ExportMesice) => `&L${textTisku(`Vytvořeno ${m.vytvoreno}`)}&RStrana &P z &N`

function poznamkaHodin(m: ExportMesice): string {
  return m.nevydanych > 0
    ? `* nevydaná směna — ještě nebyla rozeslána lidem (celkem ${m.nevydanych}). Hodiny jsou plánované délky směn bez automatické přestávky.`
    : 'Hodiny jsou plánované délky směn bez automatické přestávky.'
}

function rozpisPoTydnech(m: ExportMesice): ListXlsx {
  const mimoMesic = (d: string) => !d.startsWith(m.mesic)
  const sloupce = [SIRKA_JMENA, ...Array.from({ length: 7 }, () => SIRKA_DNE), SIRKA_HODIN]
  const meritko = meritkoNaSirku(sloupce)
  // Kolik bodů výšky sešitu se vejde na stránku při tomhle měřítku.
  const kapacita = ((TISK_VYSKA_PT / meritko) * 100) * REZERVA_TISKU

  const radky: (BunkaXlsx | null)[][] = []
  const vyskyRadku: Record<number, number> = {}
  const zalomeni: number[] = []
  let naStrane = 0
  const pridej = (radek: (BunkaXlsx | null)[], vyska: number) => {
    radky.push(radek)
    vyskyRadku[radky.length] = vyska
    naStrane += vyska
  }

  // Nadpis je jen na obrazovce; na papíře ho nese záhlaví (`tiskOdRadku`).
  pridej([s(m.nadpis, STYL.titul)], 22)
  pridej([s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)], 15)
  pridej([], 10)
  const PRVNI_TYDEN_RADEK = radky.length + 1
  naStrane = 0

  for (const [poradi, dny] of m.tydny.entries()) {
    const blok: { radek: (BunkaXlsx | null)[]; vyska: number }[] = []
    const dalsi = (radek: (BunkaXlsx | null)[], vyska: number) => blok.push({ radek, vyska })

    dalsi([s(`Týden ${poradi + 1} · ${popisTydne(dny)}`, STYL.podtitul)], 20)
    dalsi(
      [
        s('Zaměstnanec', STYL.hlavicka),
        ...dny.map((d) => s(zahlaviDne(d), mimoMesic(d) ? STYL.hlavickaMimo : jeVikend(d) ? STYL.hlavickaVikend : STYL.hlavicka)),
        s('Hodin', STYL.hlavicka),
      ],
      20,
    )

    const skupinaRadek = (nazev: string) => dalsi([s(nazev, STYL.skupina), ...Array.from({ length: 8 }, () => s('', STYL.skupina))], 16)

    const osobaRadek = (r: RadekExportu, neobsazeno: boolean) => {
      const podtitul = neobsazeno ? 'volné směny' : [r.pozice, m.vicePobocek ? r.pobocka : ''].filter(Boolean).join(' · ')
      const denniRadky = dny.map((d) => radkySmeny(r.dilyPodleDne.get(d) ?? []))
      const bunkaDne = (radky: RadekSmeny[], styl: number): BunkaXlsx => ({
        t: 's',
        v: radky.map((x) => x.text).join('\n'),
        s: styl,
        drobne: radky.map((x) => x.drobne),
      })
      const minut = dny.reduce((k, d) => k + (r.minutPodleDne.get(d) ?? 0), 0)
      // Řádků v buňce jména: jméno se může zalomit na dva řádky, pod něj pozice.
      const radkuJmena = Math.max(1, Math.ceil(r.jmeno.length / 22)) + (podtitul ? Math.max(1, Math.ceil(podtitul.length / 26)) : 0)
      const vyskaObsahu = Math.max(radkuJmena * VYSKA_RADKU_XLSX, ...denniRadky.map(vyskaRadkuSmeny))
      dalsi(
        [
          s(podtitul ? `${r.jmeno}\n${podtitul}` : r.jmeno, STYL.jmenoTydne),
          ...dny.map((d, i) =>
            mimoMesic(d)
              ? s('', STYL.bunkaMimo)
              : bunkaDne(denniRadky[i], jeVikend(d) ? STYL.bunkaVikend : STYL.bunka),
          ),
          minut > 0 ? n(hodinyCislem(minut), STYL.cislo) : s('—', STYL.bunka),
        ],
        Math.max(20, vyskaObsahu + 4),
      )
    }

    for (const skupina of m.skupiny) {
      skupinaRadek(skupina.nazev)
      for (const r of skupina.radky) osobaRadek(r, false)
    }
    const neobsazene = m.neobsazene
    if (neobsazene && dny.some((d) => (neobsazene.podleDne.get(d) ?? []).length > 0)) {
      skupinaRadek('Neobsazené směny')
      osobaRadek(neobsazene, true)
    }

    let soucetTydne = 0
    dalsi(
      [
        s('Celkem hodin', STYL.souctovyText),
        ...dny.map((d) => {
          if (mimoMesic(d)) return s('', STYL.bunkaMimo)
          const minut = m.poDnech.get(d) ?? 0
          soucetTydne += minut
          return n(hodinyCislem(minut), STYL.cisloTucne)
        }),
        n(hodinyCislem(soucetTydne), STYL.cisloTucne),
      ],
      18,
    )

    // Poznámka pod posledním týdnem je jeho součástí — ať nepřeteče na stránku sama.
    if (poradi === m.tydny.length - 1) dalsi([s(poznamkaHodin(m), STYL.poznamka)], 15)

    // Týden se drží pohromadě: nevejde-li se na zbytek stránky, začne nová.
    const vyska = blok.reduce((k, b) => k + b.vyska, 0)
    if (naStrane > 0 && naStrane + vyska > kapacita) {
      zalomeni.push(radky.length + 1)
      naStrane = 0
    }
    for (const b of blok) pridej(b.radek, b.vyska)
    pridej([], 10)
  }

  return {
    nazev: 'Rozpis',
    sloupce,
    radky,
    vyskyRadku,
    naSirku: false,
    meritko,
    zalomeniPred: zalomeni,
    tiskOdRadku: PRVNI_TYDEN_RADEK,
    tisk: { zahlavi: `&L${textTisku(m.nadpis)}&R${textTisku(m.rozsah)}`, zapati: zapatiTisku(m) },
  }
}

function souhrnXlsx(m: ExportMesice): ListXlsx {
  const predDny = m.vicePobocek ? 4 : 3 // Zaměstnanec, Úsek, Pozice, (Pobočka)
  return {
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
    tisk: { zapati: zapatiTisku(m) },
  }
}

/** Jeden řádek na člověka, sloupec na den — k třídění, filtrování a dalšímu počítání. */
function maticeMesice(m: ExportMesice): ListXlsx {
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
  radky.push([s(poznamkaHodin(m), STYL.poznamka)])

  return {
    nazev: 'Matice měsíce',
    sloupce: [24, 14, 16, ...(m.vicePobocek ? [20] : []), ...m.dny.map(() => 13), 9],
    radky,
    zmrazit: { radky: 4, sloupce: 1 },
    vyskyRadku,
    tisk: { zapati: zapatiTisku(m) },
  }
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
