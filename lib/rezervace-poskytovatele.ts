/**
 * Rezervační systémy, které appka zná — JEDEN seznam pro obrazovku
 * Napojení i pro kontrolu, co se smí založit.
 *
 * Co o kterém víme, je z průzkumu 25. 10. 2026 (docs/rezervace-navrh.md,
 * oddíl 1). Žádný tu nemá adaptér: bez přístupu k dokumentaci a účtu
 * konkrétního systému se tvar dat nevymýšlí. Připojení proto vznikne jako
 * „čeká na připojení“ a „připojeno“ ukáže teprve adaptér, který přístup
 * ověří (databáze jinak `pripojeno` nedovolí, viz
 * `integrace_pripojeni_rezervace_overeno`).
 *
 * Restu (CZ) v seznamu není: služba skončila 31. 12. 2021.
 *
 * Čistý modul (žádné IO) — testuje ho scripts/rezervace.test.mjs.
 */

export type PristupKApi = 'verejne' | 'partnerske' | 'zadne'

export type PopisSystemu = {
  /** Totéž jako `integrace_pripojeni.poskytovatel` i `rezervace.poskytovatel`. */
  klic: string
  nazev: string
  /** Má systém API, ke kterému se dá dostat? Partnerské = jen po schválení dodavatelem. */
  api: PristupKApi
  /** Posílá systém sám zprávu o změně? `null` = neověřeno. */
  webhooky: boolean | null
  /** Jde z něj vyexportovat soubor, který appka umí načíst? */
  exportSouboru: boolean
  /** Jedna věta pro majitele: co to znamená pro napojení. */
  popis: string
}

export const SYSTEMY: readonly PopisSystemu[] = [
  {
    klic: 'dotykacka',
    nazev: 'Dotykačka — rezervace',
    api: 'verejne',
    webhooky: true,
    exportSouboru: false,
    popis: 'Rezervace stolů v Dotykačce má veřejné API i webhooky. Pokladna už je napojená, takže je to nejbližší první adaptér — čeká na ověření, že stávající přístup rezervace smí číst.',
  },
  {
    klic: 'thefork',
    nazev: 'TheFork',
    api: 'partnerske',
    webhooky: true,
    exportSouboru: false,
    popis: 'Dobře popsané API, přístup vydává TheFork a musí ho schválit restaurace. Webhook posílá jen číslo rezervace, zbytek se dotáhne.',
  },
  {
    klic: 'reservio',
    nazev: 'Reservio',
    api: 'verejne',
    webhooky: false,
    exportSouboru: false,
    popis: 'Veřejné API (tarif Pro), bez webhooků — appka by se ptala jednou za čas. Je stavěné spíš na termíny služeb než na stoly.',
  },
  {
    klic: 'sevenrooms',
    nazev: 'SevenRooms',
    api: 'partnerske',
    webhooky: null,
    exportSouboru: false,
    popis: 'API jen pro partnery, dokumentace za přihlášením.',
  },
  {
    klic: 'opentable',
    nazev: 'OpenTable',
    api: 'partnerske',
    webhooky: null,
    exportSouboru: false,
    popis: 'API po schválení a smlouvě s OpenTable.',
  },
  {
    klic: 'resdiary',
    nazev: 'ResDiary',
    api: 'partnerske',
    webhooky: true,
    exportSouboru: false,
    popis: 'API na žádost přes podporu ResDiary.',
  },
  {
    klic: 'tablein',
    nazev: 'Tablein',
    api: 'zadne',
    webhooky: false,
    exportSouboru: true,
    popis: 'Veřejné API nemá. Rezervace jde vyexportovat do CSV a načíst sem souborem.',
  },
  {
    klic: 'jiny',
    nazev: 'Jiný systém',
    api: 'zadne',
    webhooky: null,
    exportSouboru: true,
    popis: 'Cokoli jiného: export do CSV a načtení souborem, nebo ruční zápis.',
  },
]

export function najitSystem(klic: string): PopisSystemu | null {
  return SYSTEMY.find((s) => s.klic === klic) ?? null
}

/**
 * Jak se stav připojení z registru (`integrace_pripojeni.stav`) jmenuje
 * na obrazovce. „Připojeno“ jen u `pripojeno` — to databáze dovolí jen
 * po ověřeném přístupu. Neznámá hodnota je „neznámý stav“, nikdy
 * „připojeno“.
 */
export function popisStavuPripojeni(stav: string): { text: string; ton: 'dobre' | 'info' | 'pozor' | 'bad' | 'neutral' } {
  switch (stav) {
    case 'pripojeno':
      return { text: 'Připojeno', ton: 'dobre' }
    case 'nepripojeno':
      return { text: 'Čeká na připojení', ton: 'info' }
    case 'pripojuje_se':
      return { text: 'Připojuje se', ton: 'info' }
    case 'vyzaduje_pozornost':
      return { text: 'Vyžaduje pozornost', ton: 'pozor' }
    case 'chyba':
      return { text: 'Chyba připojení', ton: 'bad' }
    case 'odpojeno':
      return { text: 'Odpojeno', ton: 'neutral' }
    default:
      return { text: 'Neznámý stav', ton: 'pozor' }
  }
}

/**
 * Jméno zdroje souboru pro `rezervace.poskytovatel`: klíč systému ze
 * seznamu, jinak `csv`. Když se pak systém napojí přes API pod stejným
 * klíčem, spárují se s ním i rezervace načtené dřív ze souboru — pokud
 * soubor nesl stejná čísla rezervací.
 */
export function poskytovatelSouboru(klic: string): string {
  const s = najitSystem(klic)
  return s && s.klic !== 'jiny' ? s.klic : 'csv'
}
