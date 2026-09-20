/**
 * Export měsíčního rozpisu směn — model tabulky a její převod do Excelu.
 *
 * Model (`sestavitExportMesice`) je společný pro Excel i PDF, takže obě
 * podoby ukazují totéž. Je to čistá funkce nad daty, která rozpis stejně
 * načítá (`shifts`, `employees`, `useky`, `positions`); žádný druhý zdroj
 * pravdy, žádné dopočítávání jinde. PDF si z modelu skládá stránky
 * (`lib/rozpis-export-pdf.ts`), Excel listy tabulek `lib/rozpis-export-xlsx.ts`;
 * kdo je na kterém listu (stránce), určuje jednou `lib/rozpis-rozlozeni.ts`.
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

import { cekaNaVydani, kratkyCas, zkratkyPobocek, type OsobaD, type SmenaD } from './rozpis-desktop.ts'
import { denVTydnu, hhmm, minutSmeny, ZKRATKY_DNU } from './rozpis-mobil.ts'

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

  /*
    Zkratky se počítají ze VŠECH poboček firmy, ne jen z těch, které mají
    v měsíci směnu — jinak by se „Černá Perla“ zkrátila jednou na „ČP“
    a podruhé (když přibude „Červená Pergola“) na „Čern“, a papír z ledna
    by se nedal srovnat s papírem z února. Ze stejného důvodu je má takhle
    i obrazovka, takže obojí říká totéž.
  */
  const pobocky: PobockaExportu[] = vicePobocek
    ? (() => {
        const zkratky = zkratkyPobocek([...v.pobocky.values()])
        return [...new Set(idPobocek.map(nazevPobocky).filter(Boolean))]
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

/**
 * Text zalomený na slovech do řádků, které se vejdou do šířky. Vrátí `null`,
 * když se nevejde ani jedno slovo samo o sobě — takový text se musí otočit
 * nebo zkrátit, na řádky ho rozsekat nejde.
 */
export function radkyDoSirky(text: string, vejde: (t: string) => boolean, nejvicRadku = 3): string[] | null {
  // Mezera i spojovník jsou místa, kde se text smí zalomit: „Jirásková-Novotná“
  // je jedno slovo, ale do úzkého sloupce se rozdělit dá — a spojovník zůstane
  // na konci řádku, ať je poznat, že jméno pokračuje.
  const slova = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => w.split(/(?<=-)/).filter(Boolean))
  if (slova.length === 0) return []
  if (slova.some((w) => !vejde(w))) return null
  const radky: string[] = []
  let aktualni = ''
  for (const slovo of slova) {
    const spojene = aktualni ? `${aktualni}${aktualni.endsWith('-') ? '' : ' '}${slovo}` : slovo
    if (aktualni && !vejde(spojene)) {
      radky.push(aktualni)
      aktualni = slovo
    } else {
      aktualni = spojene
    }
  }
  if (aktualni) radky.push(aktualni)
  return radky.length <= nejvicRadku ? radky : null
}

/**
 * Vejdou se VŠECHNA jména (a pozice) naležato? Buď je naležato celé záhlaví,
 * nebo žádné — tabulka, kde je půlka jmen otočená a půlka ne, vypadá rozbitě.
 * Naležato je čitelnější a záhlaví je nižší, takže má přednost, kdykoli to jde
 * (Šéfík 20. 9. 2026).
 */
export function jmenaNalezato(
  sloupce: { jmeno: string; pozice: string }[],
  vejde: (t: string) => boolean,
  nejvicRadku = 3,
): boolean {
  return sloupce.every(
    (c) =>
      radkyDoSirky(c.jmeno, vejde, nejvicRadku) !== null &&
      (!c.pozice || radkyDoSirky(c.pozice, vejde, nejvicRadku) !== null),
  )
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

/* --- text buňky: společný pro Excel i PDF -------------------------------- */


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
