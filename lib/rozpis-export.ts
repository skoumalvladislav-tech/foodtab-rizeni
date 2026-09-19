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
 * Neobsazené směny mají vlastní sloupec „Neobsazeno“ a do součtů hodin
 * lidí se nepočítají.
 *
 * ---------------------------------------------------------------------
 * JEDNA STRÁNKA A4: DNY V ŘÁDCÍCH, LIDÉ VE SLOUPCÍCH
 *
 * Měsíc má 28–31 dní, ale lidí bývá řádově deset. Řádek na den a sloupec
 * na člověka se proto na A4 na výšku vejde celý měsíc čitelně, kdežto
 * opačně (30 sloupců dní) by písmo skončilo pod čtyřmi body. Sloupec je
 * tak široký, jak dlouhý je čas směny („8–16“, „16–23:30“).
 *
 * Úseky ani pobočky tabulka nekreslí jako záhlaví či sloupce. Kdo pracuje
 * na víc pobočkách, má pobočku pod časem směny — celým názvem, když se
 * vejde, jinak zkratkou (vysvětlenou v poznámce pod tabulkou). Jedna
 * pobočka se nepíše vůbec: je v nadpisu, na každé směně by jen brala místo.
 * Úseky určují jen pořadí lidí (kuchyň pohromadě, pak plac…).
 */

import { cekaNaVydani, kratkyCas, type OsobaD, type SmenaD } from './rozpis-desktop.ts'
import { denVTydnu, hhmm, jeVikend, minutSmeny, ZKRATKY_DNU } from './rozpis-mobil.ts'
import { STYL, textTisku, type BunkaXlsx, type ListXlsx } from './xlsx-zapis.ts'

/* --- model ------------------------------------------------------------ */

/** Jedna směna rozložená na části — z nich se skládá text do Excelu i do PDF. */
export type DilSmeny = {
  /** „08:00–16:00“ */
  cas: string
  /** „8–16“, „16–23:30“ — do úzké buňky. */
  kratce: string
  /** „15:00–17:00“ u trhané směny, jinak `null`. */
  pauza: string | null
  /** Název pobočky směny; prázdný, když ho nikdo nezná. */
  pobocka: string
  /** Ještě nebyla rozeslána lidem (značí se hvězdičkou). */
  nevydana: boolean
}

/** Sloupec tabulky: člověk (nebo „Neobsazeno“) a jeho směny po dnech. */
export type SloupecExportu = {
  /** `null` = neobsazené směny. */
  osobaId: string | null
  jmeno: string
  pozice: string
  /** Směny po dnech, v pořadí od nejdřívější; přes všechny pobočky. */
  podleDne: Map<string, DilSmeny[]>
  /** Plánované minuty za měsíc. */
  minut: number
  smen: number
}

/** Pobočka, která se v měsíci vyskytuje, a její zkratka (jednoznačná mezi ostatními). */
export type PobockaExportu = { nazev: string; zkratka: string }

/** Souhrn hodin člověka za měsíc — přes všechny pobočky, na kterých pracoval. */
export type SouhrnCloveka = {
  jmeno: string
  pozice: string
  smen: number
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
  /** Lidé v pořadí úseků a abecedně, na konci „Neobsazeno“ (je-li co). */
  sloupce: SloupecExportu[]
  /** Jsou v měsíci směny z víc poboček? Jen pak se pobočka píše pod čas. */
  vicePobocek: boolean
  /** Pobočky měsíce se zkratkami; prázdné, když je jedna. */
  pobocky: PobockaExportu[]
  /** Hodiny po lidech, v pořadí sloupců (bez „Neobsazeno“). */
  souhrn: SouhrnCloveka[]
  /** Minuty lidí za měsíc (bez neobsazených směn). */
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

export function dilSmeny(s: SmenaD, pobocka = ''): DilSmeny {
  return {
    cas: `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}`,
    kratce: `${kratkyCas(hhmm(s.starts_at))}–${kratkyCas(hhmm(s.ends_at))}`,
    pauza: s.pauza_od && s.pauza_do ? `${hhmm(s.pauza_od)}–${hhmm(s.pauza_do)}` : null,
    pobocka,
    nevydana: cekaNaVydani(s),
  }
}

/** „15:00–17:00“ → „15–17“, „15:30–17:00“ → „15:30–17“ (do úzké buňky). */
export function pauzaKratce(pauza: string): string {
  return pauza.split('–').map(kratkyCas).join('–')
}

/**
 * Zkratky poboček, každá jiná. Víceslovný název dá iniciály („Černá Perla“
 * → „ČP“), jednoslovný první tři písmena („Bernard“ → „Ber“). Kdyby se dvě
 * shodovaly, dotčeným se zkratka natáhne, dokud se nerozliší. Zkratka není
 * nikdy delší než celý název.
 */
export function zkratkyPobocek(nazvy: string[]): Map<string, string> {
  const jedinecne = [...new Set(nazvy)]
  const kandidati = jedinecne.map((nazev) => {
    const slova = nazev.split(/\s+/).filter(Boolean)
    const pismena = [...slova.join('')]
    const seznam: string[] = []
    if (slova.length > 1) seznam.push(slova.map((w) => [...w][0].toUpperCase()).join(''))
    for (let d = 3; d < pismena.length; d++) seznam.push(pismena.slice(0, d).join(''))
    seznam.push(nazev)
    return seznam
  })
  const uroven = jedinecne.map(() => 0)
  for (let kolo = 0; kolo < 50; kolo++) {
    const zkratky = kandidati.map((k, i) => k[Math.min(uroven[i], k.length - 1)])
    const pocet = new Map<string, number>()
    for (const z of zkratky) pocet.set(z, (pocet.get(z) ?? 0) + 1)
    let zmena = false
    zkratky.forEach((z, i) => {
      if ((pocet.get(z) ?? 0) > 1 && uroven[i] < kandidati[i].length - 1) {
        uroven[i] += 1
        zmena = true
      }
    })
    if (!zmena) break
  }
  return new Map(
    jedinecne.map((nazev, i) => {
      const z = kandidati[i][Math.min(uroven[i], kandidati[i].length - 1)]
      return [nazev, [...z].length >= [...nazev].length ? nazev : z]
    }),
  )
}

export function sestavitExportMesice(v: {
  mesic: string
  smeny: SmenaD[]
  osoby: Map<string, OsobaD>
  /** id → název, v pořadí, které si firma nastavila (určuje jen pořadí lidí). */
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

  const idPobocek = [...new Set(smeny.map((s) => s.branch_id))]
  const vicePobocek = idPobocek.length > 1
  const nazevPobocky = (id: string) => v.pobocky.get(id) ?? ''

  const pobocky: PobockaExportu[] = vicePobocek
    ? (() => {
        const nazvy = idPobocek.map(nazevPobocky).filter(Boolean)
        const zkratky = zkratkyPobocek(nazvy)
        return [...new Set(nazvy)]
          .sort((a, b) => a.localeCompare(b, 'cs'))
          .map((nazev) => ({ nazev, zkratka: zkratky.get(nazev) ?? nazev }))
      })()
    : []

  // Sloupec = člověk, přes všechny pobočky; pobočka je na jednotlivé směně.
  const poLidech = new Map<string, { osoba: OsobaD; smeny: SmenaD[] }>()
  const neobsazeneSmeny: SmenaD[] = []
  for (const s of smeny) {
    if (!s.employee_id) {
      neobsazeneSmeny.push(s)
      continue
    }
    const zaznam = poLidech.get(s.employee_id) ?? {
      osoba: v.osoby.get(s.employee_id) ?? { id: s.employee_id, jmeno: 'Neznámý', usekId: null, poziceId: null, barva: null },
      smeny: [],
    }
    zaznam.smeny.push(s)
    poLidech.set(s.employee_id, zaznam)
  }

  const naSloupec = (osobaId: string | null, jmeno: string, pozice: string, jeho: SmenaD[]): SloupecExportu => {
    const podleDne = new Map<string, DilSmeny[]>()
    for (const s of [...jeho].sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.starts_at.localeCompare(b.starts_at))) {
      podleDne.set(s.shift_date, [...(podleDne.get(s.shift_date) ?? []), dilSmeny(s, nazevPobocky(s.branch_id))])
    }
    return {
      osobaId,
      jmeno,
      pozice,
      podleDne,
      minut: jeho.reduce((k, s) => k + minutSmeny(s), 0),
      smen: jeho.length,
    }
  }

  // Pořadí: úseky tak, jak je nastavila firma (kuchyň pohromadě, pak plac…), uvnitř abecedně.
  const poradiUseku = new Map([...v.useky.keys()].map((id, i) => [id, i]))
  const poradi = (o: OsobaD) => (o.usekId && poradiUseku.has(o.usekId) ? (poradiUseku.get(o.usekId) as number) : poradiUseku.size)
  const lide = [...poLidech.values()]
    .sort((a, b) => poradi(a.osoba) - poradi(b.osoba) || a.osoba.jmeno.localeCompare(b.osoba.jmeno, 'cs'))
    .map((z) => naSloupec(z.osoba.id, z.osoba.jmeno, z.osoba.poziceId ? (v.pozice.get(z.osoba.poziceId) ?? '') : '', z.smeny))

  const sloupce = neobsazeneSmeny.length > 0 ? [...lide, naSloupec(null, 'Neobsazeno', 'volné směny', neobsazeneSmeny)] : lide

  return {
    mesic: v.mesic,
    nadpis: `Rozpis směn — ${nazevMesice(v.mesic)}`,
    rozsah: v.rozsah,
    vytvoreno: v.vytvoreno,
    dny,
    sloupce,
    vicePobocek,
    pobocky,
    souhrn: lide.map((c) => ({ jmeno: c.jmeno, pozice: c.pozice, smen: c.smen, minut: c.minut })),
    celkemMinut: lide.reduce((n, c) => n + c.minut, 0),
    smen: smeny.length,
    nevydanych: smeny.filter(cekaNaVydani).length,
  }
}

/** Minuty jako číslo hodin na dvě desetinná místa: 510 → 8,5. */
export const hodinyCislem = (minut: number): number => Math.round((minut / 60) * 100) / 100

/**
 * Věty poznámky pod tabulkou spojené do řádků (věta se nikdy nerozdělí
 * uprostřed). Společné pro Excel a PDF — délku si každý měří po svém, proto
 * bere funkci `vejde`.
 */
export function zalomitVety(vety: string[], vejde: (text: string) => boolean): string[] {
  const radky: string[] = []
  let aktualni = ''
  for (const veta of vety) {
    const spojene = aktualni ? `${aktualni} · ${veta}` : veta
    if (aktualni && !vejde(spojene)) {
      radky.push(aktualni)
      aktualni = veta
    } else {
      aktualni = spojene
    }
  }
  if (aktualni) radky.push(aktualni)
  return radky
}

/**
 * Poznámky pod tabulkou: hvězdička, výklad hodin, zkratky poboček (jen ty,
 * které se opravdu použily) a „Neobsazeno“.
 */
export function vetyPoznamky(m: ExportMesice, pouziteZkratky: PobockaExportu[], maNeobsazeno: boolean): string[] {
  return [
    ...(m.nevydanych > 0 ? [`* nevydaná směna — ještě nebyla rozeslána lidem (celkem ${m.nevydanych})`] : []),
    'Hodiny = plánované délky směn bez automatické přestávky',
    ...(pouziteZkratky.length > 0 ? [pouziteZkratky.map((p) => `${p.zkratka} = ${p.nazev}`).join(', ')] : []),
    ...(maNeobsazeno ? ['Neobsazeno = volné směny, do součtů se nepočítají'] : []),
    `Celkem lidé: ${String(hodinyCislem(m.celkemMinut)).replace('.', ',')} h`,
  ]
}

/** Rozdělí lidi na co nejméně stejně velkých částí po nejvýš `nejvic`. */
export function rozdelitLidi<T>(pole: T[], nejvic: number): T[][] {
  if (pole.length === 0) return [[]]
  const casti = Math.ceil(pole.length / Math.max(1, nejvic))
  const zaklad = Math.floor(pole.length / casti)
  const navic = pole.length % casti
  const vysledek: T[][] = []
  let od = 0
  for (let i = 0; i < casti; i++) {
    const kolik = zaklad + (i < navic ? 1 : 0)
    vysledek.push(pole.slice(od, od + kolik))
    od += kolik
  }
  return vysledek
}

/* --- Excel ----------------------------------------------------------- */

const s = (v: string, styl?: number): BunkaXlsx => ({ t: 's', v, s: styl })
const n = (v: number, styl?: number): BunkaXlsx => ({ t: 'n', v, s: styl })

/** „Po 21.“ — zkratka dne a číslo, do levého sloupce. */
export const popisDne = (den: string) =>
  `${ZKRATKY_DNU[denVTydnu(den)][0]}${ZKRATKY_DNU[denVTydnu(den)][1].toLowerCase()} ${Number(den.slice(8, 10))}.`

/** Jeden řádek buňky se směnami; `drobne` = vedlejší údaj (pobočka, pauza) pod časem. */
export type RadekSmeny = { text: string; drobne: boolean }

/**
 * Směny dne na řádky buňky: „10–22*“, pod ním pobočka (když je `pobockaText`
 * zadaná a směna nějakou má) a případně „pauza 15–17“.
 */
export function radkySmeny(dily: DilSmeny[], pobockaText?: (pobocka: string) => string): RadekSmeny[] {
  return dily.flatMap((d) => [
    { text: `${d.kratce}${d.nevydana ? '*' : ''}`, drobne: false },
    ...(pobockaText && d.pobocka ? [{ text: pobockaText(d.pobocka), drobne: true }] : []),
    ...(d.pauza ? [{ text: `pauza ${pauzaKratce(d.pauza)}`, drobne: true }] : []),
  ])
}

/*
  Rozměry listu pro tisk na jednu stránku A4 na výšku. Šířky jsou ve
  znacích Excelu (jeden znak ≈ 7 px, plus 5 px na sloupec); z nich se
  počítá, kolik lidí se vejde na list, aniž by tisk klesl pod čitelné
  měřítko — víc lidí jde na další list.
*/
const VYSKA_RADKU_XLSX = 12 // řádek písma 9 pt
const VYSKA_DROBNE_XLSX = 10 // řádek písma 7 pt
const SIRKA_DNE_XLSX = 6.5
const TISK_SIRKA_PT = (8.27 - 2 * 0.4) * 72 // A4 na výšku, okraje 0,4″
const NEJMENSI_MERITKO = 0.62

/** Šířka sloupce člověka ve znacích: podle nejdelšího času (nebo pauzy) směny. */
export function sirkaSloupceXlsx(sloupce: SloupecExportu[]): number {
  let cas = 0
  let pauza = 0
  for (const c of sloupce) {
    for (const dily of c.podleDne.values()) {
      for (const d of dily) {
        cas = Math.max(cas, d.kratce.length + (d.nevydana ? 1 : 0))
        if (d.pauza) pauza = Math.max(pauza, `pauza ${pauzaKratce(d.pauza)}`.length)
      }
    }
  }
  return Math.min(11, Math.max(6, Math.round(Math.max(cas * 0.85, pauza * 0.62) + 1.5)))
}

const zapatiTisku = (m: ExportMesice) => `&L${textTisku(`Vytvořeno ${m.vytvoreno}`)}&RStrana &P z &N`

/**
 * Sešit: „Rozpis“ (dny v řádcích, lidé ve sloupcích, jedna stránka A4 na
 * výšku; při hodně lidech „Rozpis 1“, „Rozpis 2“…) a „Souhrn“ (hodiny po
 * lidech). Hodiny jsou čísla, dají se sčítat.
 */
export function listyXlsx(m: ExportMesice): ListXlsx[] {
  return [...rozpisXlsx(m), souhrnXlsx(m)]
}

function rozpisXlsx(m: ExportMesice): ListXlsx[] {
  const sirka = sirkaSloupceXlsx(m.sloupce)
  // Kolik lidí se vejde na šířku při nejmenším přijatelném měřítku.
  const pxNaLidi = TISK_SIRKA_PT / NEJMENSI_MERITKO / 0.75 - (SIRKA_DNE_XLSX * 7 + 5)
  const nejvic = Math.max(1, Math.floor(pxNaLidi / (sirka * 7 + 5)))
  const casti = rozdelitLidi(m.sloupce, nejvic)

  // Pobočka pod časem: celý název, když se vejde do sloupce (drobné písmo ≈ 0,65 znaku), jinak zkratka.
  const zkratkaPobocky = new Map(m.pobocky.map((p) => [p.nazev, p.zkratka]))
  const textPobocky = (nazev: string) => (nazev.length * 0.65 <= sirka - 1 ? nazev : (zkratkaPobocky.get(nazev) ?? nazev))

  return casti.map((cast, i) => {
    const radky: (BunkaXlsx | null)[][] = []
    const vyskyRadku: Record<number, number> = {}
    const pridej = (radek: (BunkaXlsx | null)[], vyska: number) => {
      radky.push(radek)
      vyskyRadku[radky.length] = vyska
    }

    pridej([s(casti.length > 1 ? `${m.nadpis} — část ${i + 1} z ${casti.length}` : m.nadpis, STYL.titul)], 22)
    pridej([s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)], 15)

    // Záhlaví: jméno (a pozice pod ním) otočené o 90°; výška podle nejdelšího textu.
    const nejdelsi = Math.max(4, ...cast.map((c) => Math.max([...c.jmeno].length, [...c.pozice].length)))
    pridej(
      [
        s('Den', STYL.hlavicka),
        ...cast.map((c) => s(c.pozice ? `${c.jmeno}\n${c.pozice}` : c.jmeno, STYL.hlavickaOtocena)),
      ],
      Math.min(130, Math.max(50, nejdelsi * 5 + 8)),
    )

    for (const den of m.dny) {
      const vikend = jeVikend(den)
      const bunky = cast.map((c) => radkySmeny(c.podleDne.get(den) ?? [], m.vicePobocek ? textPobocky : undefined))
      const vyska = Math.max(
        VYSKA_RADKU_XLSX + 3,
        ...bunky.map((r) => r.reduce((k, x) => k + (x.drobne ? VYSKA_DROBNE_XLSX : VYSKA_RADKU_XLSX), 3)),
      )
      pridej(
        [
          s(popisDne(den), vikend ? STYL.denRadekVikend : STYL.denRadek),
          ...bunky.map(
            (r): BunkaXlsx => ({
              t: 's',
              v: r.map((x) => x.text).join('\n'),
              s: vikend ? STYL.bunkaVikend : STYL.bunka,
              drobne: r.map((x) => x.drobne),
            }),
          ),
        ],
        vyska,
      )
    }

    pridej(
      [
        s('Hodin', STYL.souctovyText),
        ...cast.map((c) => (c.minut > 0 ? n(hodinyCislem(c.minut), STYL.cisloTucne) : s('—', STYL.cisloTucne))),
      ],
      18,
    )

    // Poznámky: jen zkratky poboček, které tenhle list opravdu použil.
    const pouziteNazvy = new Set<string>()
    if (m.vicePobocek) {
      for (const c of cast) for (const dily of c.podleDne.values()) for (const d of dily) if (d.pobocka) pouziteNazvy.add(d.pobocka)
    }
    const pouziteZkratky = m.pobocky.filter((p) => pouziteNazvy.has(p.nazev) && textPobocky(p.nazev) !== p.nazev)
    const maxZnaku = Math.floor((SIRKA_DNE_XLSX + cast.length * sirka) / 0.85)
    radky.push([])
    for (const radek of zalomitVety(
      vetyPoznamky(m, pouziteZkratky, cast.some((c) => c.osobaId === null)),
      (t) => t.length <= maxZnaku,
    )) {
      pridej([s(radek, STYL.poznamka)], 13)
    }

    return {
      nazev: casti.length > 1 ? `Rozpis ${i + 1}` : 'Rozpis',
      sloupce: [SIRKA_DNE_XLSX, ...cast.map(() => sirka)],
      radky,
      vyskyRadku,
      zmrazit: { radky: 3, sloupce: 1 },
      naSirku: false,
      naJednuStranku: true,
      tisk: { zapati: zapatiTisku(m) },
    }
  })
}

function souhrnXlsx(m: ExportMesice): ListXlsx {
  return {
    nazev: 'Souhrn',
    sloupce: [28, 22, 9, 10],
    radky: [
      [s(`Souhrn hodin — ${nazevMesice(m.mesic)}`, STYL.titul)],
      [s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)],
      [],
      [s('Zaměstnanec', STYL.hlavicka), s('Pozice', STYL.hlavicka), s('Směn', STYL.hlavicka), s('Hodin', STYL.hlavicka)],
      ...m.souhrn.map((r) => [
        s(r.jmeno, STYL.jmeno),
        s(r.pozice, STYL.jmeno),
        n(r.smen, STYL.cislo),
        n(hodinyCislem(r.minut), STYL.cislo),
      ]),
      [
        s('Celkem', STYL.souctovyText),
        s('', STYL.souctovyText),
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
