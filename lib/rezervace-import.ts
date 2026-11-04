/**
 * Rezervace ze zdroje → řádky pro databázi. Dvě cesty, jeden cílový tvar:
 *
 *   * soubor (CSV z jiného rezervačního systému) — `naparsovatCsvRezervaci`,
 *   * adaptér rezervačního systému (`RadekRezervace` z kontraktu) —
 *     `zRadkuZdroje`.
 *
 * Výsledek jde do `public.rezervace_importovat_csv` nebo
 * `public.rezervace_importovat_zdroj`, které párují podle čísla
 * rezervace ze zdroje (opakovaný import nic nezdvojí) a rozhodují, co
 * se přepíše (docs/rezervace-navrh.md, oddíl 3).
 *
 * ČAS: ze souboru přichází hodina na zdi („19:00“) BEZ pásma — posílá se
 * jako `datum` + `od` a pásmo pobočky dodá databáze. Z adaptéru přichází
 * okamžik a musí mít pásmo; bez něj se řádek odmítne, ne „domyslí“
 * (CLAUDE.md, pravidlo 11).
 *
 * Obsah buňky je DATA, ne pokyn — nic se odsud nevyhodnocuje.
 *
 * Čistý modul — testuje ho scripts/rezervace.test.mjs.
 */

import { naDatum } from './finance-csv-import.ts'
import type { RadekRezervace, StavRezervace } from './reservation-provider-contract.ts'
import { jePlatneDatum } from './rezervace-typy.ts'
import { normalizovat, precistCsv } from './tabulka.ts'

/** Řádek pro databázi — všechno jako text, prázdné = neuvedeno. */
export type RadekImportu = {
  externi_id: string
  stav: StavRezervace
  stav_zdroje: string
  jmeno_hosta: string
  pocet_osob: string
  telefon: string
  email: string
  poznamka: string
  prostor: string
  /** Stoly ze zdroje (migrace 20261107100000). Klíč chybí = zdroj je nezná, uložené zůstane. */
  misto_zdroje?: string
  /** Číslo rezervace ve zdroji. Klíč chybí = uložené zůstane. */
  cislo_zdroje?: string
} & (
  // `zmeneno_kdy` (s pásmem) nepovinně i tady: příjmové API ho u data
  // a hodiny na zdi může poslat, CSV ne.
  | { datum: string; od: string; do: string; zmeneno_kdy?: string }
  | { zacatek: string; konec: string; zmeneno_kdy: string }
)

export type ChybaRadku = { radek: number; zprava: string }

export const MAX_RADKU_IMPORTU = 2000

/** Okamžik s časovým pásmem — stejný vzor jako `app.rezervace_okamzik_zdroje`. */
const VZOR_PASMA = /(Z|z|[+-]\d{2}(:?\d{2})?)$/

/** Půlka dvojice UTF-16 bez druhé půlky (rozříznuté emoji). */
const RE_LICHA_POLOVINA = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Text nejvýš `max` jednotek UTF-16 (tedy i nejvýš `max` znaků pro
 * databázi) a NIKDY s rozříznutým emoji. Obyčejné `.slice` umí useknout
 * emoji v půlce; JSON s takovou půlkou odmítne PostgREST celý (PGRST102)
 * — u Choice by se nezapsala celá stránka rezervací a načítání by na ní
 * uvázlo (kontrola kódu 4. 11. 2026). Osamělá půlka, která přišla už
 * zvenku, se nahradí znakem �.
 */
export function zkratit(text: string, max: number): string {
  const s = text.replace(RE_LICHA_POLOVINA, '\uFFFD')
  if (s.length <= max) return s
  const kus = s.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(kus) ? kus.slice(0, -1) : kus
}

/**
 * Stav z cizího systému → stav ve Foodtabu. Klíče jsou v porovnávacím
 * tvaru (`normalizovat`: malá písmena, bez diakritiky). Hodnoty ze
 * skutečných systémů (TheFork, Tablein, SevenRooms, Dotykačka, Reservio)
 * podle průzkumu. Co tu není, se NEHÁDÁ: soubor s neznámým stavem se
 * odmítne s názvem té hodnoty.
 */
const STAVY_ZDROJE: Record<string, StavRezervace> = {
  // potvrzená — i ta, kde host už sedí; Foodtab neřídí stoly v reálném čase
  potvrzeno: 'potvrzeno', potvrzena: 'potvrzeno', potvrzene: 'potvrzeno', potvrzeni: 'potvrzeno',
  rezervovano: 'potvrzeno', confirmed: 'potvrzeno', accepted: 'potvrzeno', recorded: 'potvrzeno',
  booked: 'potvrzeno', seated: 'potvrzeno', 'partly seated': 'potvrzeno', usazeno: 'potvrzeno',
  arrived: 'potvrzeno', 'partially arrived': 'potvrzeno', dorazili: 'potvrzeno', late: 'potvrzeno',
  'being late': 'potvrzeno', bill: 'potvrzeno', 'walk in': 'potvrzeno',
  // předběžná
  ceka: 'ceka', cekajici: 'ceka', predbezna: 'ceka', predbezne: 'ceka', nepotvrzena: 'ceka',
  nepotvrzeno: 'ceka', poptavka: 'ceka', pending: 'ceka', requested: 'ceka', new: 'ceka',
  nova: 'ceka', tentative: 'ceka', inquiry: 'ceka', prebooked: 'ceka', 'waiting list': 'ceka',
  // zrušená
  zrusena: 'zrusena', zruseno: 'zrusena', zrusene: 'zrusena', storno: 'zrusena',
  stornovano: 'zrusena', cancelled: 'zrusena', canceled: 'zrusena', refused: 'zrusena',
  declined: 'zrusena', odmitnuto: 'zrusena', odmitnuta: 'zrusena',
  // nedorazili
  'nedostavil se': 'nedostavil_se', 'nedostavili se': 'nedostavil_se', nedorazili: 'nedostavil_se',
  neprisel: 'nedostavil_se', neprisli: 'nedostavil_se', 'no show': 'nedostavil_se', noshow: 'nedostavil_se',
  // proběhla
  dokonceno: 'dokonceno', dokoncena: 'dokonceno', probehla: 'dokonceno', probehlo: 'dokonceno',
  completed: 'dokonceno', complete: 'dokonceno', done: 'dokonceno', finished: 'dokonceno', left: 'dokonceno',
}

/** Prázdný stav = potvrzená (export bez sloupce stavu). Neznámý = `null`. */
export function mapovatStav(text: string): StavRezervace | null {
  const t = normalizovat(text)
  if (t === '') return 'potvrzeno'
  return STAVY_ZDROJE[t] ?? null
}

/** Sloupce souboru podle porovnávacího tvaru záhlaví. První shoda vyhrává. */
const SLOUPCE: Record<string, readonly string[]> = {
  externi_id: ['id', 'cislo', 'cislo rezervace', 'id rezervace', 'reservation id', 'booking id', 'booking reference', 'reference', 'kod rezervace'],
  datum: ['datum', 'date', 'den', 'day', 'datum rezervace', 'reservation date'],
  od: ['cas', 'od', 'zacatek', 'cas od', 'time', 'start', 'start time', 'from', 'hodina'],
  do: ['do', 'konec', 'cas do', 'end', 'end time', 'to'],
  jmeno_hosta: ['jmeno', 'jmeno hosta', 'host', 'name', 'guest', 'guest name', 'zakaznik', 'customer', 'klient', 'client'],
  pocet_osob: ['pocet', 'pocet osob', 'pocet hostu', 'osoby', 'osob', 'party size', 'covers', 'guests', 'pax', 'people', 'persons'],
  telefon: ['telefon', 'tel', 'phone', 'phone number', 'mobil', 'mobile'],
  email: ['email', 'e mail', 'mail'],
  poznamka: ['poznamka', 'poznamky', 'note', 'notes', 'comment', 'comments', 'pozadavek', 'special request', 'vzkaz'],
  stav: ['stav', 'status', 'state'],
  prostor: ['stul', 'stoly', 'prostor', 'table', 'tables', 'area', 'mistnost', 'salonek'],
}

/** „19:00“, „19.00“, „7:05“, „19:00:00“ → „19:00“. Jinak `null`. */
export function naHodinu(text: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/**
 * Buňka data, která může nést i čas („30.10.2026 19:00“,
 * „2026-10-30T19:00“). Vrací datum a případně hodinu.
 */
export function rozdelitDatumACas(text: string): { datum: string | null; hodina: string | null } {
  const t = text.trim()
  const [d, c] = t.includes('T') ? t.split('T') : t.split(/\s+(?=\d{1,2}[:.]\d{2})/)
  const datum = naDatum(d.replace(/\s+/g, ''))
  return { datum: datum && jePlatneDatum(datum) ? datum : null, hodina: c ? naHodinu(c.replace(/(Z|[+-]\d{2}:?\d{2})$/, '')) : null }
}

export type VysledekCsv = {
  radky: RadekImportu[]
  chyby: ChybaRadku[]
  /** Soubor nemá číslo rezervace: páruje se podle data, času a jména. */
  bezCisla: boolean
  /** Které sloupce se poznaly (název ze souboru → náš údaj) — pro náhled na obrazovce. */
  poznaneSloupce: { soubor: string; udaj: string }[]
}

/**
 * Přečte CSV export rezervací. Nic nezapisuje. Stačí sloupce datum, čas
 * a jméno (nebo číslo rezervace); ostatní jsou nepovinné.
 *
 * Bez sloupce s číslem rezervace se číslo odvodí z data, času a jména —
 * tentýž soubor načtený dvakrát nic nezdvojí, ale rezervace, které se
 * v systému mezitím změnil čas, se objeví jako nová. Obrazovka to řekne.
 */
export function naparsovatCsvRezervaci(obsah: string): VysledekCsv {
  const tabulka = precistCsv(obsah)
  const prazdny: VysledekCsv = { radky: [], chyby: [], bezCisla: false, poznaneSloupce: [] }
  if (tabulka.hlavicka.length === 0) {
    return { ...prazdny, chyby: [{ radek: 0, zprava: 'Soubor je prázdný.' }] }
  }

  const hlavicka = tabulka.hlavicka.map(normalizovat)
  const index: Record<string, number> = {}
  const poznaneSloupce: VysledekCsv['poznaneSloupce'] = []
  for (const [udaj, aliasy] of Object.entries(SLOUPCE)) {
    const i = hlavicka.findIndex((h, j) => aliasy.includes(h) && !Object.values(index).includes(j))
    if (i !== -1) {
      index[udaj] = i
      poznaneSloupce.push({ soubor: tabulka.hlavicka[i], udaj })
    }
  }

  const chyby: ChybaRadku[] = []
  if (index.datum === undefined) chyby.push({ radek: 1, zprava: 'Chybí sloupec s datem („Datum“).' })
  if (index.externi_id === undefined && index.jmeno_hosta === undefined) {
    chyby.push({ radek: 1, zprava: 'Chybí sloupec s číslem rezervace nebo se jménem hosta.' })
  }
  if (chyby.length > 0) return { ...prazdny, chyby, poznaneSloupce }

  if (tabulka.radky.length > MAX_RADKU_IMPORTU) {
    return { ...prazdny, chyby: [{ radek: 0, zprava: `Soubor má ${tabulka.radky.length} řádků; najednou jde načíst nejvýš ${MAX_RADKU_IMPORTU}.` }], poznaneSloupce }
  }

  const bezCisla = index.externi_id === undefined
  const bunka = (r: string[], udaj: string) => (index[udaj] === undefined ? '' : (r[index[udaj]] ?? '').trim())
  const radky: RadekImportu[] = []
  const videna = new Map<string, number>()

  tabulka.radky.forEach((r, i) => {
    // Řádek 1 je záhlaví, data začínají na 2. (Prázdné řádky precistCsv
    // vynechal, takže u souboru s mezerami se číslo může o kus lišit.)
    const cislo = i + 2
    const chyba = (zprava: string) => chyby.push({ radek: cislo, zprava })

    const { datum, hodina: hodinaZData } = rozdelitDatumACas(bunka(r, 'datum'))
    if (!datum) return chyba(`Nerozpoznané datum „${bunka(r, 'datum')}“.`)

    const odText = bunka(r, 'od')
    const od = odText ? naHodinu(odText) : hodinaZData
    if (!od) return chyba(odText ? `Nerozpoznaný čas „${odText}“.` : 'Chybí čas rezervace.')

    const doText = bunka(r, 'do')
    const doCas = doText ? naHodinu(doText) : ''
    if (doCas === null) return chyba(`Nerozpoznaný čas konce „${doText}“.`)
    if (doCas !== '' && doCas === od) return chyba('Konec je ve stejný čas jako začátek.')

    const stavText = bunka(r, 'stav')
    const stav = mapovatStav(stavText)
    if (!stav) return chyba(`Neznámý stav „${stavText}“ — opravte ho v souboru, nebo sloupec stavu vynechte.`)

    const pocet = bunka(r, 'pocet_osob')
    if (pocet !== '' && !/^\d{1,5}$/.test(pocet)) return chyba(`Počet osob „${pocet}“ není celé číslo.`)
    if (pocet !== '' && Number(pocet) < 1) return chyba('Počet osob musí být aspoň 1.')

    const jmeno = zkratit(bunka(r, 'jmeno_hosta'), 120)
    let externi = bunka(r, 'externi_id')
    if (bezCisla) {
      if (jmeno === '') return chyba('Bez čísla rezervace a bez jména nejde řádek spárovat.')
      externi = `odvozene:${datum}T${od}|${normalizovat(jmeno)}`
    }
    if (externi === '') return chyba('Chybí číslo rezervace.')
    if (externi.length > 200) return chyba('Číslo rezervace je delší než 200 znaků.')
    const predtim = videna.get(externi)
    if (predtim !== undefined) return chyba(`Tatáž rezervace je v souboru dvakrát (poprvé na řádku ${predtim}).`)
    videna.set(externi, cislo)

    radky.push({
      externi_id: externi,
      stav,
      stav_zdroje: zkratit(stavText, 60),
      datum,
      od,
      do: doCas,
      jmeno_hosta: jmeno,
      pocet_osob: pocet,
      telefon: zkratit(bunka(r, 'telefon'), 40),
      email: zkratit(bunka(r, 'email'), 254),
      poznamka: zkratit(bunka(r, 'poznamka'), 4000),
      prostor: zkratit(bunka(r, 'prostor'), 120),
    })
  })

  return { radky, chyby, bezCisla, poznaneSloupce }
}

/**
 * Řádek z adaptéru rezervačního systému → řádek pro databázi. Okamžik
 * bez pásma se odmítne (databáze by ho odmítla taky — tohle je jen
 * dřívější a srozumitelnější hláška pro autora adaptéru).
 */
export function zRadkuZdroje(r: RadekRezervace): { stav: 'ok'; radek: RadekImportu } | { stav: 'chyba'; duvod: string } {
  if (!r.externiId.trim()) return { stav: 'chyba', duvod: 'Rezervace bez čísla ze zdroje.' }
  for (const [nazev, hodnota] of [['začátek', r.cas], ['konec', r.konec], ['změněno', r.zmenenoKdy]] as const) {
    if (hodnota !== null && !VZOR_PASMA.test(hodnota.trim())) {
      return { stav: 'chyba', duvod: `Rezervace ${r.externiId}: ${nazev} „${hodnota}“ nemá časové pásmo.` }
    }
  }
  if (r.pocetHostu !== null && (!Number.isInteger(r.pocetHostu) || r.pocetHostu < 1)) {
    return { stav: 'chyba', duvod: `Rezervace ${r.externiId}: počet hostů ${r.pocetHostu} není kladné celé číslo.` }
  }
  return {
    stav: 'ok',
    radek: {
      externi_id: r.externiId.trim(),
      stav: r.stav,
      stav_zdroje: zkratit(r.stavZdroje, 60),
      zacatek: r.cas.trim(),
      konec: r.konec?.trim() ?? '',
      zmeneno_kdy: r.zmenenoKdy?.trim() ?? '',
      jmeno_hosta: zkratit(r.jmenoHosta ?? '', 120),
      pocet_osob: r.pocetHostu === null ? '' : String(r.pocetHostu),
      telefon: zkratit(r.telefonHosta ?? '', 40),
      email: zkratit(r.emailHosta ?? '', 254),
      poznamka: zkratit(r.poznamka, 4000),
      prostor: zkratit(r.prostor ?? '', 120),
      // Jen když je adaptér zná — chybějící klíč databáze čte jako „nech uložené“.
      ...(r.misto !== undefined ? { misto_zdroje: zkratit(r.misto.trim(), 300) } : {}),
      ...(r.cisloZdroje !== undefined ? { cislo_zdroje: zkratit(r.cisloZdroje.trim(), 40) } : {}),
    },
  }
}
