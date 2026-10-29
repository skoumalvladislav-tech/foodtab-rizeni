/**
 * Rezervační systémy, které appka zná — JEDEN seznam pro obrazovku
 * Napojení i pro kontrolu, co se smí založit.
 *
 * Co o kterém víme, je z průzkumu 25. 10. 2026 (docs/rezervace-navrh.md,
 * oddíl 1). Adaptér má zatím jen Choice (`adapter: true`, dokumentace
 * Choice Open API, lib/rezervace-choice.ts) — u ostatních se bez přístupu
 * k dokumentaci a účtu tvar dat nevymýšlí. Jejich připojení vznikne jako
 * „čeká na připojení“ a „připojeno“ ukáže teprve adaptér, který přístup
 * ověří (databáze jinak `pripojeno` nedovolí, viz
 * `integrace_pripojeni_rezervace_overeno`).
 *
 * Restu (CZ) v seznamu není: služba skončila 31. 12. 2021.
 *
 * Čistý modul (žádné IO) — testuje ho scripts/rezervace.test.mjs.
 */

/** `neovereno` = v dokumentaci jsme ho nenašli, ale nevíme jistě, že není. */
export type PristupKApi = 'verejne' | 'partnerske' | 'neovereno' | 'zadne'

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
  /**
   * Má Foodtab hotový adaptér — umí se systému ptát sám? Takový systém má
   * na obrazovce Napojení vlastní kartu s připojením, ne obecné „Připravit
   * napojení“.
   */
  adapter: boolean
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
    adapter: false,
    popis: 'Rezervace stolů v Dotykačce má veřejné API i webhooky. Pokladna už je napojená, takže je to nejbližší první adaptér — čeká na ověření, že stávající přístup rezervace smí číst.',
  },
  {
    // Šéfík 25. 10. 2026: „mám Choice“. Choice Open API (dokumentace
    // open-api.choiceqr.com/docs): rezervace jde číst (GET /bookings/list,
    // 1 dotaz za 5 s), přístup přes OAuth aplikace „Foodtab“ a ChoiceQR
    // token od api@choiceqr.com. Webhooky má jen pro menu, objednávky
    // a místo — rezervace se proto tahají. Adaptér: lib/rezervace-choice.ts.
    klic: 'choice',
    nazev: 'Choice',
    api: 'partnerske',
    webhooky: false,
    exportSouboru: false,
    adapter: true,
    popis: 'Choice Open API: Foodtab se sám ptá na rezervace každých 15 minut (Choice je neumí poslat sám) a do Choice nic nezapisuje. Podnik se připojí v kartě Choice výš; Choice k tomu chce ChoiceQR token od api@choiceqr.com.',
  },
  {
    klic: 'thefork',
    nazev: 'TheFork',
    api: 'partnerske',
    webhooky: true,
    exportSouboru: false,
    adapter: false,
    popis: 'Dobře popsané API, přístup vydává TheFork a musí ho schválit restaurace. Webhook posílá jen číslo rezervace, zbytek se dotáhne.',
  },
  {
    klic: 'reservio',
    nazev: 'Reservio',
    api: 'verejne',
    webhooky: false,
    exportSouboru: false,
    adapter: false,
    popis: 'Veřejné API (tarif Pro), bez webhooků — appka by se ptala jednou za čas. Je stavěné spíš na termíny služeb než na stoly.',
  },
  {
    klic: 'sevenrooms',
    nazev: 'SevenRooms',
    api: 'partnerske',
    webhooky: null,
    exportSouboru: false,
    adapter: false,
    popis: 'API jen pro partnery, dokumentace za přihlášením.',
  },
  {
    klic: 'opentable',
    nazev: 'OpenTable',
    api: 'partnerske',
    webhooky: null,
    exportSouboru: false,
    adapter: false,
    popis: 'API po schválení a smlouvě s OpenTable.',
  },
  {
    klic: 'resdiary',
    nazev: 'ResDiary',
    api: 'partnerske',
    webhooky: true,
    exportSouboru: false,
    adapter: false,
    popis: 'API na žádost přes podporu ResDiary.',
  },
  {
    klic: 'tablein',
    nazev: 'Tablein',
    api: 'zadne',
    webhooky: false,
    exportSouboru: true,
    adapter: false,
    popis: 'Veřejné API nemá. Rezervace jde vyexportovat do CSV a načíst sem souborem.',
  },
  {
    klic: 'jiny',
    nazev: 'Jiný systém',
    api: 'zadne',
    webhooky: null,
    exportSouboru: true,
    adapter: false,
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

/** Systémy bez hotového adaptéru, ke kterým jde jen připravit napojení (čeká na připojení). */
export function systemyKPriprave(): PopisSystemu[] {
  return SYSTEMY.filter((s) => !s.adapter && (s.api === 'verejne' || s.api === 'partnerske'))
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
