/**
 * Čistá logika mobilního rozpisu směn — žádný React, žádná databáze.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEBYDLÍ V KOMPONENTĚ
 *
 * Mobilní Směny nejsou druhý rozpis, jen druhá PREZENTACE téhož rozpisu:
 * stejná data, stejná oprávnění, stejné RPC. Všechno, co se dá spočítat
 * bez prohlížeče — kdo je ten den ve směně, kolik hodin má kdo týden,
 * co se ukáže zaměstnanci jako nadcházející —, je proto tady a testuje
 * se Nodem (scripts/rozpis-mobil.test.mjs). Komponenty pak jen kreslí.
 *
 * ---------------------------------------------------------------------
 * DATUMY
 *
 * Datum směny je „den na zdi“ (`shift_date`, text RRRR-MM-DD), ne okamžik.
 * Počítá se jako UTC půlnoc daného dne, aby ho nemohl posunout letní čas
 * ani pásmo serveru — stejný důvod, proč tu není `new Date('…T…')`
 * (viz lib/cas.ts).
 *
 * ---------------------------------------------------------------------
 * CO SE SCHVÁLNĚ NEVYMÝŠLÍ
 *
 * Hodiny jsou součet PLÁNOVANÝCH délek směn bez explicitní pauzy uvnitř
 * (trhaná směna). Neodečítá se automatická přestávka pobočky — to je
 * pravidlo docházky, ne plánu. Kde údaj nejde spočítat, funkce vrátí 0
 * a obrazovka ho nekreslí.
 */

import { delkaSmenyMinut } from './cas.ts'
import { sklonovat } from './sklonovani.ts'

/* --- typy ------------------------------------------------------------ */

/** Co mobil potřebuje vědět o směně. Širší typ z rozpis.tsx se sem vejde. */
export type SmenaZaklad = {
  id: string
  branch_id: string
  employee_id: string | null
  position_id: string | null
  shift_date: string
  starts_at: string
  ends_at: string
  status: string
  note: string
  published_at: string | null
  pauza_od: string | null
  pauza_do: string | null
}

export type Osoba = {
  id: string
  jmeno: string
  /** Domovský úsek (employees.usek_id), ne pozice ze směny. */
  usekId: string | null
  barva: string | null
}

/** Volba filtru „Stav směny“. */
export type StavFiltru = 'vse' | 'obsazene' | 'neobsazene' | 'volno'

export type FiltrSmen = {
  /** Prázdné = všechny pobočky. */
  pobocky: string[]
  /** Prázdné = všechny úseky. `BEZ_USEKU` = lidé bez přiřazeného úseku. */
  useky: string[]
  stav: StavFiltru
}

export const BEZ_USEKU = '_bez'

export const FILTR_PRAZDNY: FiltrSmen = { pobocky: [], useky: [], stav: 'vse' }

/* --- kalendář -------------------------------------------------------- */

export const ZKRATKY_DNU = ['PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO', 'NE'] as const

export const NAZVY_DNU = [
  'Pondělí',
  'Úterý',
  'Středa',
  'Čtvrtek',
  'Pátek',
  'Sobota',
  'Neděle',
] as const

/** Druhý pád: „22. září“. */
const MESICE_2P = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
] as const

/** První pád, pro nadpis měsíce: „Září 2026“. */
const MESICE_1P = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
] as const

function rozloz(datum: string): [number, number, number] {
  const [r, m, d] = datum.split('-').map(Number)
  return [r, m, d]
}

export function posunDatum(datum: string, dnu: number): string {
  const [r, m, d] = rozloz(datum)
  return new Date(Date.UTC(r, m - 1, d + dnu)).toISOString().slice(0, 10)
}

/** 0 = pondělí … 6 = neděle. `getUTCDay()` počítá od neděle, proto ten posun. */
export function denVTydnu(datum: string): number {
  const [r, m, d] = rozloz(datum)
  return (new Date(Date.UTC(r, m - 1, d)).getUTCDay() + 6) % 7
}

export function pondeliTydne(datum: string): string {
  return posunDatum(datum, -denVTydnu(datum))
}

/** Sedm dní od pondělí do neděle, do kterých patří `datum`. */
export function dnyTydne(datum: string): string[] {
  const pondeli = pondeliTydne(datum)
  return Array.from({ length: 7 }, (_, i) => posunDatum(pondeli, i))
}

export function jeVikend(datum: string): boolean {
  return denVTydnu(datum) >= 5
}

export function cisloDne(datum: string): number {
  return rozloz(datum)[2]
}

/** „Úterý 22. září“ */
export function popisDne(datum: string): string {
  const [, m, d] = rozloz(datum)
  return `${NAZVY_DNU[denVTydnu(datum)]} ${d}. ${MESICE_2P[m - 1]}`
}

/** „Út 22. září“ */
export function popisDneKratce(datum: string): string {
  const [, m, d] = rozloz(datum)
  return `${NAZVY_DNU[denVTydnu(datum)].slice(0, 2)} ${d}. ${MESICE_2P[m - 1]}`
}

/** „19.–25. září“, přes hranici měsíce „28. září – 4. října“. */
export function popisTydne(datum: string): string {
  const dny = dnyTydne(datum)
  const [, m1, d1] = rozloz(dny[0])
  const [, m2, d2] = rozloz(dny[6])
  if (m1 === m2) return `${d1}.–${d2}. ${MESICE_2P[m2 - 1]}`
  return `${d1}. ${MESICE_2P[m1 - 1]} – ${d2}. ${MESICE_2P[m2 - 1]}`
}

/** „Září 2026“ */
export function popisMesice(datum: string): string {
  const [r, m] = rozloz(datum)
  return `${MESICE_1P[m - 1]} ${r}`
}

/** Datum měsíce posunuté o `mesicu`, vždy první den: „2026-10-01“. */
export function posunMesic(datum: string, mesicu: number): string {
  const [r, m] = rozloz(datum)
  return new Date(Date.UTC(r, m - 1 + mesicu, 1)).toISOString().slice(0, 10)
}

/**
 * Měsíc jako týdny po sedmi dnech, od pondělí prvního týdne po neděli
 * posledního. Dny mimo měsíc jsou v mřížce taky — kdo má směnu v pondělí
 * 31. 8., chce ji vidět i v zářijovém kalendáři.
 */
export function mesicniMrizka(datum: string): string[][] {
  const prvni = `${datum.slice(0, 8)}01`
  const posledni = posunDatum(posunMesic(prvni, 1), -1)
  const tydny: string[][] = []
  let pondeli = pondeliTydne(prvni)
  while (pondeli <= posledni) {
    tydny.push(Array.from({ length: 7 }, (_, i) => posunDatum(pondeli, i)))
    pondeli = posunDatum(pondeli, 7)
  }
  return tydny
}

/** „Dnes“ / „Zítra“ / null. */
export function stitekDne(den: string, dnes: string): 'Dnes' | 'Zítra' | null {
  if (den === dnes) return 'Dnes'
  if (den === posunDatum(dnes, 1)) return 'Zítra'
  return null
}

/* --- časy a hodiny --------------------------------------------------- */

/** „08:00:00“ → „08:00“ */
export function hhmm(cas: string): string {
  return cas.slice(0, 5)
}

/** „08:00–16:00“ */
export function rozsahCasu(od: string, doKdy: string): string {
  return `${hhmm(od)}–${hhmm(doKdy)}`
}

/** „08:00“ → „8“, „08:30“ → „8:30“, „00:00“ → „0“ */
export function hodinaKratce(cas: string): string {
  const [h, m] = hhmm(cas).split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}

/** „8–16“, do týdenních dlaždic, kde je místo na pár znaků. */
export function rozsahKratce(od: string, doKdy: string): string {
  return `${hodinaKratce(od)}–${hodinaKratce(doKdy)}`
}

/**
 * Plánovaná délka směny v minutách bez pauzy uvnitř.
 *
 * Délku dává `delkaSmenyMinut` (lib/cas.ts), protějšek databázové
 * `app.delka_smeny_minut` — směna přes půlnoc (18:00–02:00) vyjde 480,
 * ne záporně. Pauza (trhaná směna) se odečte; kdyby byla delší než
 * směna, vyjde nula, ne mínus.
 */
export function minutSmeny(
  s: Pick<SmenaZaklad, 'starts_at' | 'ends_at' | 'pauza_od' | 'pauza_do'>,
): number {
  const hruba = delkaSmenyMinut(s.starts_at, s.ends_at)
  const pauza = s.pauza_od && s.pauza_do ? delkaSmenyMinut(s.pauza_od, s.pauza_do) : 0
  return Math.max(0, hruba - pauza)
}

/** „38 h“, „38 h 30 min“, „45 min“ — do úzkých míst. */
export function hodinyKratce(minut: number): string {
  const h = Math.floor(minut / 60)
  const m = minut % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** „14 hodin“, „1 hodina“, „8 hodin 30 min“ — do detailu směny. */
export function delkaPopis(minut: number): string {
  const h = Math.floor(minut / 60)
  const m = minut % 60
  const hodiny = `${h} ${sklonovat(h, 'hodina', 'hodiny', 'hodin')}`
  if (h === 0) return `${m} min`
  return m === 0 ? hodiny : `${hodiny} ${m} min`
}

/** Pro odečítač: „směna 8 až 16 hodin“. Barva ani ikona to nenesou. */
export function smenaProOdecitac(s: Pick<SmenaZaklad, 'starts_at' | 'ends_at'>): string {
  return `směna ${hodinaKratce(s.starts_at)} až ${hodinaKratce(s.ends_at)} hodin`
}

/** Iniciály do avataru: první písmeno prvního a posledního slova. */
export function inicialy(jmeno: string): string {
  const slova = jmeno.trim().split(/\s+/).filter(Boolean)
  if (slova.length === 0) return '?'
  if (slova.length === 1) return slova[0].slice(0, 2).toUpperCase()
  return (slova[0][0] + slova[slova.length - 1][0]).toUpperCase()
}

/* --- řazení směn ----------------------------------------------------- */

function poZacatku<S extends SmenaZaklad>(a: S, b: S): number {
  return a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at)
}

function platne<S extends SmenaZaklad>(smeny: S[]): S[] {
  return smeny.filter((s) => s.status !== 'cancelled')
}

const podleJmena = (a: string, b: string) => a.localeCompare(b, 'cs')

/* --- denní přehled (vedoucí) ----------------------------------------- */

export type RadekDne<S extends SmenaZaklad> = {
  klic: string
  /** `null` = neobsazená směna („sem někoho potřebujeme“). */
  osoba: Osoba | null
  /** Prázdné = volno. */
  smeny: S[]
}

export type SkupinaDne<S extends SmenaZaklad> = {
  klic: string
  nazev: string
  radky: RadekDne<S>[]
  /** Kolik z nich ten den pracuje. Volno se nepočítá. */
  pracuje: number
}

export type PrehledDne<S extends SmenaZaklad> = {
  /** Skupiny podle úseku po filtrech. */
  skupiny: SkupinaDne<S>[]
  /** Neobsazené směny dne po filtrech — kreslí se jako vlastní skupina. */
  neobsazene: S[]
  /** Neobsazené směny dne bez filtru úseku a stavu (do upozornění). */
  neobsazenychCelkem: number
  /** Kolik lidí je ten den ve směně (bez filtru úseku a stavu). */
  lidiPracuje: number
  /** Čipy pod nadpisem: kolik lidí pracuje v kterém úseku. */
  poUsecich: { klic: string; nazev: string; pocet: number }[]
  /** Kolik řádků je vidět po filtrech — číslo na tlačítku „Zobrazit výsledky“. */
  pocetRadku: number
}

export function sestavitDen<S extends SmenaZaklad>(v: {
  smeny: S[]
  den: string
  osoby: Map<string, Osoba>
  /** id → název. Pořadí mapy je pořadí skupin. */
  useky: Map<string, string>
  filtr: FiltrSmen
}): PrehledDne<S> {
  const { den, osoby, useky, filtr } = v

  // Pobočka omezuje, KDE se pracuje, takže filtruje už soupis lidí.
  const vOkne = platne(v.smeny).filter(
    (s) => filtr.pobocky.length === 0 || filtr.pobocky.includes(s.branch_id),
  )
  const dnesni = vOkne.filter((s) => s.shift_date === den)

  /*
    Kdo je v rozpisu: každý, kdo má v načteném týdnu aspoň jednu směnu.
    Kdo má ten den volno, ale jinak v týdnu pracuje, se ukáže jako „Volno“.
    Lidi bez jediné směny v týdnu do soupisu nepatří — nevíme, jestli
    vůbec pracují.
  */
  const idLidi = new Set<string>()
  for (const s of vOkne) if (s.employee_id) idLidi.add(s.employee_id)

  const poradiUseku = [...useky.keys()]
  const klicUseku = (o: Osoba) => (o.usekId && useky.has(o.usekId) ? o.usekId : BEZ_USEKU)

  const radky: (RadekDne<S> & { usek: string })[] = [...idLidi].map((id) => {
    const osoba = osoby.get(id) ?? { id, jmeno: 'Neznámý', usekId: null, barva: null }
    return {
      klic: id,
      osoba,
      usek: klicUseku(osoba),
      smeny: dnesni.filter((s) => s.employee_id === id).sort(poZacatku),
    }
  })

  const skupinyVse: SkupinaDne<S>[] = [...poradiUseku, BEZ_USEKU]
    .map((klic) => {
      const cleni = radky
        .filter((r) => r.usek === klic)
        .sort((a, b) => {
          const aPracuje = a.smeny.length > 0
          const bPracuje = b.smeny.length > 0
          if (aPracuje !== bPracuje) return aPracuje ? -1 : 1
          if (aPracuje) {
            const podleCasu = poZacatku(a.smeny[0], b.smeny[0])
            if (podleCasu !== 0) return podleCasu
          }
          return podleJmena(a.osoba!.jmeno, b.osoba!.jmeno)
        })
      return {
        klic,
        nazev: klic === BEZ_USEKU ? 'Bez úseku' : (useky.get(klic) ?? 'Bez úseku'),
        radky: cleni.map(({ klic: k, osoba, smeny }) => ({ klic: k, osoba, smeny })),
        pracuje: cleni.filter((r) => r.smeny.length > 0).length,
      }
    })
    .filter((s) => s.radky.length > 0)

  const neobsazeneDne = dnesni.filter((s) => !s.employee_id).sort(poZacatku)

  /* --- filtry úseku a stavu se uplatní až na to, co se kreslí ------- */

  const usekOk = (klic: string) => filtr.useky.length === 0 || filtr.useky.includes(klic)

  const skupiny = skupinyVse
    .filter((s) => usekOk(s.klic) && filtr.stav !== 'neobsazene')
    .map((s) => {
      const radkyPoStavu = s.radky.filter((r) =>
        filtr.stav === 'obsazene' ? r.smeny.length > 0 : filtr.stav === 'volno' ? r.smeny.length === 0 : true,
      )
      return { ...s, radky: radkyPoStavu, pracuje: radkyPoStavu.filter((r) => r.smeny.length > 0).length }
    })
    .filter((s) => s.radky.length > 0)

  /*
    Neobsazená směna nemá člověka, tedy ani úsek — filtr úseku ji proto
    neschová. Je to provozní poplach („sem někoho potřebujeme“) a schovat
    ji kvůli tomu, že se dívám jen na kuchyň, by byla horší chyba než ji
    ukázat navíc. Schová ji jen výslovný stav „Obsazené“ nebo „Volno“.
  */
  const neobsazene = filtr.stav === 'obsazene' || filtr.stav === 'volno' ? [] : neobsazeneDne

  return {
    skupiny,
    neobsazene,
    neobsazenychCelkem: neobsazeneDne.length,
    lidiPracuje: radky.filter((r) => r.smeny.length > 0).length,
    poUsecich: skupinyVse
      .filter((s) => s.pracuje > 0)
      .map((s) => ({ klic: s.klic, nazev: s.nazev, pocet: s.pracuje })),
    pocetRadku: skupiny.reduce((n, s) => n + s.radky.length, 0) + neobsazene.length,
  }
}

/* --- týdenní přehled (vedoucí) --------------------------------------- */

export type RadekTydne<S extends SmenaZaklad> = {
  klic: string
  osoba: Osoba | null
  usekNazev: string | null
  dny: { den: string; smeny: S[] }[]
  minut: number
}

export function sestavitTyden<S extends SmenaZaklad>(v: {
  smeny: S[]
  /** Kterýkoli den týdne; týden se bere od pondělí do neděle. */
  den: string
  osoby: Map<string, Osoba>
  useky: Map<string, string>
  filtr: FiltrSmen
}): { radky: RadekTydne<S>[]; pocetRadku: number } {
  const { osoby, useky, filtr } = v
  const dny = dnyTydne(v.den)
  const pondeli = dny[0]
  const nedele = dny[6]

  const vTydnu = platne(v.smeny).filter(
    (s) =>
      s.shift_date >= pondeli &&
      s.shift_date <= nedele &&
      (filtr.pobocky.length === 0 || filtr.pobocky.includes(s.branch_id)),
  )

  const sestavDny = (smeny: S[]) =>
    dny.map((den) => ({ den, smeny: smeny.filter((s) => s.shift_date === den).sort(poZacatku) }))
  const soucet = (smeny: S[]) => smeny.reduce((n, s) => n + minutSmeny(s), 0)

  const poradiUseku = [...useky.keys()]
  const poradi = (o: Osoba) => {
    const i = o.usekId ? poradiUseku.indexOf(o.usekId) : -1
    return i === -1 ? poradiUseku.length : i
  }

  const idLidi = new Set<string>()
  for (const s of vTydnu) if (s.employee_id) idLidi.add(s.employee_id)

  const usekOk = (o: Osoba) =>
    filtr.useky.length === 0 ||
    filtr.useky.includes(o.usekId && useky.has(o.usekId) ? o.usekId : BEZ_USEKU)

  const lide: RadekTydne<S>[] =
    filtr.stav === 'neobsazene'
      ? []
      : [...idLidi]
          .map((id) => osoby.get(id) ?? { id, jmeno: 'Neznámý', usekId: null, barva: null })
          .filter(usekOk)
          .sort((a, b) => poradi(a) - poradi(b) || podleJmena(a.jmeno, b.jmeno))
          .map((osoba) => {
            const moje = vTydnu.filter((s) => s.employee_id === osoba.id)
            return {
              klic: osoba.id,
              osoba,
              usekNazev: osoba.usekId ? (useky.get(osoba.usekId) ?? null) : null,
              dny: sestavDny(moje),
              minut: soucet(moje),
            }
          })

  const volne = filtr.stav === 'obsazene' ? [] : vTydnu.filter((s) => !s.employee_id)
  const radky = volne.length
    ? [...lide, { klic: 'neobsazeno', osoba: null, usekNazev: null, dny: sestavDny(volne), minut: 0 }]
    : lide

  return { radky, pocetRadku: radky.length }
}

/* --- zaměstnanec: moje směny ----------------------------------------- */

export type DenNadchazejici<S extends SmenaZaklad> = {
  den: string
  stitek: 'Dnes' | 'Zítra' | null
  smeny: S[]
}

/**
 * Nadcházející dny zaměstnance.
 *
 * Dnes a zítra se ukazují vždycky (i s „Volno“) — zaměstnanec se ptá
 * hlavně na ně a prázdné místo by vypadalo jako chyba. Dál už jen dny,
 * kdy opravdu pracuje; kdo chce vidět i volné dny, má Kalendář.
 */
export function sestavitNadchazejici<S extends SmenaZaklad>(
  moje: S[],
  dnes: string,
  dni = 14,
): DenNadchazejici<S>[] {
  const platneMoje = platne(moje)
  const vysledek: DenNadchazejici<S>[] = []
  for (let i = 0; i < dni; i++) {
    const den = posunDatum(dnes, i)
    const smeny = platneMoje.filter((s) => s.shift_date === den).sort(poZacatku)
    const stitek = stitekDne(den, dnes)
    if (stitek !== null || smeny.length > 0) vysledek.push({ den, stitek, smeny })
  }
  return vysledek
}

/** Směny podle dne, do měsíčního kalendáře. */
export function smenyPodleDne<S extends SmenaZaklad>(smeny: S[]): Map<string, S[]> {
  const mapa = new Map<string, S[]>()
  const serazene = platne(smeny).sort(
    (a, b) => a.shift_date.localeCompare(b.shift_date) || poZacatku(a, b),
  )
  for (const s of serazene) {
    const seznam = mapa.get(s.shift_date) ?? []
    seznam.push(s)
    mapa.set(s.shift_date, seznam)
  }
  return mapa
}

/* --- upozornění a alarmy --------------------------------------------- */

/** „1 neobsazená směna“, „3 neobsazené směny“, „5 neobsazených směn“. */
export function neobsazenePopis(n: number): string {
  return `${n} ${
    n === 1 ? 'neobsazená směna' : n >= 2 && n <= 4 ? 'neobsazené směny' : 'neobsazených směn'
  }`
}

/** „8 lidí naplánováno“, „1 člověk naplánován“, „3 lidé naplánováni“. */
export function lidiPopis(n: number): string {
  if (n === 1) return '1 člověk naplánován'
  if (n >= 2 && n <= 4) return `${n} lidé naplánováni`
  return `${n} lidí naplánováno`
}
