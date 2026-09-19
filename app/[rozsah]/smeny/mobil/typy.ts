import type { Osoba, SmenaZaklad } from '@/lib/rozpis-mobil'

/**
 * Směna tak, jak ji vidí mobilní obrazovky.
 *
 * `created_by` a `created_at` jsou pro řádek „Vytvořil“ v detailu; nejsou
 * v `SmenaZaklad`, protože je nepotřebuje žádný výpočet.
 */
export type SmenaM = SmenaZaklad & {
  created_by: string | null
  created_at: string | null
}

/** To, co serverová stránka přidává pro telefon k obyčejnému rozpisu. */
export type MobilVstup = {
  /** Vlastní směny přihlášeného: nadcházející dny a měsíc kalendáře. */
  mojeSmeny: SmenaM[]
  /** Které dny server načetl do `smeny` (včetně). */
  okno: { od: string; do: string }
  /** Má přihlášený vlastní záznam zaměstnance? */
  maSve: boolean
  /** created_by → jméno tvůrce směny. */
  tvurci: Map<string, string>
  /** Adresní segment rozsahu (`cerna-perla`, `firma`) — potřebují ho serverové akce. */
  rozsah: string
}

/**
 * Všechno, co obrazovky potřebují znát KOLEM směn.
 *
 * Serverová stránka to skládá z dotazů; komponenty ho jen čtou. Neposílají
 * se sem žádné mzdy ani kontakty — jméno, úsek a barva, nic víc.
 */
export type KontextM = {
  /** Dnešní provozní den pobočky (ne kalendářní datum serveru). */
  dnesni: string
  osoby: Map<string, Osoba>
  /** id → název, v pořadí, které si firma nastavila. */
  useky: Map<string, string>
  pobocky: Map<string, string>
  pozice: Map<string, string>
  /** created_by → jméno tvůrce směny. */
  tvurci: Map<string, string>
  /** Jsou v načtených datech směny z víc poboček? Pak se pobočka připisuje. */
  vicePobocek: boolean
}
