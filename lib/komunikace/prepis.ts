/**
 * Přepis hlasových zpráv — rozhraní poskytovatele.
 *
 * ---------------------------------------------------------------------
 * STAV: PŘEPIS DNES NENÍ K DISPOZICI, A ŘÍKÁ SE TO.
 *
 * Hlasové zprávy fungují (nahrání, uložení, přehrání). Přepis na text
 * ne, a to z důvodů, které se v kódu vyřešit nedají:
 *
 *   1. Claude API nemá zvukový vstup. Přepis potřebuje jiného
 *      dodavatele (Whisper, Deepgram, Google STT…) s vlastním klíčem,
 *      smlouvou o zpracování údajů a cenou za minutu.
 *   2. Hlas je obsah komunikace. CLAUDE.md, pravidlo 8, a
 *      docs/komunikace-zadani.md zakazují posílat komunikaci
 *      jazykovému modelu; posílat ji cizímu přepisovači je stejná
 *      otázka a rozhodnout ji musí vlastník (uchování, země zpracování).
 *
 * Rozhodnutí Šéfíka z 17. 9. 2026: sloupec pro přepis se přidá později,
 * bez přepisování existujících zpráv.
 *
 * ---------------------------------------------------------------------
 * PROČ TEDY EXISTUJE ROZHRANÍ
 *
 * Aby bylo vidět, KAM se poskytovatel připojí, a aby obrazovka nikdy
 * nepředstírala přepis, který není: každý výsledek má stav a „nedostupný“
 * je jeden z nich, se srozumitelnou větou pro člověka. Až poskytovatel
 * vznikne, přidá se do `POSKYTOVATELE` a UI se nezmění.
 *
 * Nic tu nevymýšlí text. Bez poskytovatele je výsledek vždy
 * `nedostupny` — nikdy prázdný „přepis“, který by vypadal jako ticho.
 */

export type ZvukKPrepisu = {
  /** Cesta v bucketu `hlasovky`. */
  cesta: string
  delkaS: number
  mime: string
}

export type VysledekPrepisu =
  | { stav: 'hotovo'; text: string; jazyk: string }
  | { stav: 'nedostupny'; duvod: string }
  | { stav: 'chyba'; duvod: string }

export interface PoskytovatelPrepisu {
  readonly id: string
  readonly popis: string
  /** Je poskytovatel nakonfigurovaný (klíč, smlouva)? */
  jeNakonfigurovan(): boolean
  prepsat(zvuk: ZvukKPrepisu): Promise<VysledekPrepisu>
}

export const DUVOD_NEDOSTUPNOSTI =
  'Přepis hlasových zpráv zatím není zapnutý: potřebuje externí službu a rozhodnutí o zpracování hlasu.'

/** Poskytovatel, který nic nepřepisuje a říká proč. */
export const nedostupnyPrepis: PoskytovatelPrepisu = {
  id: 'zadny',
  popis: 'Bez přepisu',
  jeNakonfigurovan: () => false,
  prepsat: async () => ({ stav: 'nedostupny', duvod: DUVOD_NEDOSTUPNOSTI }),
}

/**
 * Registr poskytovatelů. Prázdný záměrně — žádný zatím neexistuje.
 * Přidat sem druhého poskytovatele je celý zásah, který napojení přepisu
 * vyžaduje v kódu.
 */
export const POSKYTOVATELE: Record<string, PoskytovatelPrepisu> = {}

/**
 * Vybere poskytovatele podle nastavení. Neznámý nebo nenakonfigurovaný
 * poskytovatel NEZNAMENÁ chybu aplikace ani tichý prázdný přepis — vrátí
 * se `nedostupnyPrepis`.
 */
export function vybratPoskytovatelePrepisu(id?: string | null): PoskytovatelPrepisu {
  if (!id) return nedostupnyPrepis
  const p = POSKYTOVATELE[id]
  return p && p.jeNakonfigurovan() ? p : nedostupnyPrepis
}

export type PopisPrepisu = { text: string; jeVarovani: boolean }

/**
 * Věta k hlasové zprávě: co se s jejím přepisem děje. Nikdy nevrací
 * přepis, který nebyl pořízen — bez výsledku říká, že není dostupný.
 */
export function popisStavuPrepisu(vysledek: VysledekPrepisu | null | undefined): PopisPrepisu {
  if (!vysledek || vysledek.stav === 'nedostupny') {
    return { text: 'Přepis na text není dostupný.', jeVarovani: false }
  }
  if (vysledek.stav === 'chyba') {
    return { text: `Přepis se nepodařil: ${vysledek.duvod}`, jeVarovani: true }
  }
  return { text: vysledek.text, jeVarovani: false }
}
