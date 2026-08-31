import { normalizovat } from './tabulka.ts'

/**
 * Typy pracovního poměru.
 *
 * Jedno místo pro kód v databázi, název na obrazovce a zkratku do
 * seznamu. Dřív byly rozepsané ve formuláři na Lidech a znovu o dvě stě
 * řádků níž ve výpisu; třetí opis kvůli importu už by byl zaručený
 * rozjezd.
 *
 * `synonyma` jsou tvary, které aplikace pozná v nahrávané tabulce.
 * Není to slovník zákazníka: jsou to vlastní kódy a vlastní názvy
 * aplikace v porovnávacím tvaru. Co v seznamu není, se NEHÁDÁ —
 * „brigáda“ může být dohoda i živnost a domyslet si to znamená připsat
 * člověku jiný poměr, než ve skutečnosti má.
 */
export type Uvazek = {
  kod: 'hpp' | 'dpp' | 'dpc' | 'ico' | 'jine'
  nazev: string
  kratky: string
  synonyma: string[]
}

export const UVAZKY: Uvazek[] = [
  {
    kod: 'hpp',
    nazev: 'Hlavní pracovní poměr',
    kratky: 'HPP',
    synonyma: ['hpp', 'hlavni pracovni pomer', 'hlavni pomer', 'pracovni pomer'],
  },
  {
    kod: 'dpp',
    nazev: 'Dohoda o provedení práce',
    kratky: 'DPP',
    synonyma: ['dpp', 'dohoda o provedeni prace', 'dohoda o provedeni'],
  },
  {
    kod: 'dpc',
    nazev: 'Dohoda o činnosti',
    kratky: 'DPČ',
    synonyma: ['dpc', 'dohoda o cinnosti', 'dohoda o pracovni cinnosti'],
  },
  {
    kod: 'ico',
    nazev: 'Samostatně činná osoba',
    // Ve výpisu lidí stojí „OSVČ“ a mění se tu jen to, odkud se to
    // bere — ne to, co je vidět.
    kratky: 'OSVČ',
    synonyma: ['ico', 'osvc', 'samostatne cinna osoba', 'zivnostnik'],
  },
  { kod: 'jine', nazev: 'Jiné', kratky: 'Jiné', synonyma: ['jine', 'jiny', 'ostatni'] },
]

/** Kód → název. Neznámý kód (z budoucí verze) se ukáže tak, jak přišel. */
export function nazevUvazku(kod: string): string {
  return UVAZKY.find((u) => u.kod === kod)?.nazev ?? kod
}

/** Kód → zkratka do seznamu. */
export function kratkyUvazek(kod: string): string {
  return UVAZKY.find((u) => u.kod === kod)?.kratky ?? kod
}

/** Text z tabulky → kód, nebo null když se nepozná. */
export function uvazekZTextu(text: string): Uvazek['kod'] | null {
  const t = normalizovat(text)
  if (!t) return null
  return UVAZKY.find((u) => u.synonyma.includes(t))?.kod ?? null
}
