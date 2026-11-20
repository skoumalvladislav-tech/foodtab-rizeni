/**
 * Konektor „import výpisu" — člověk nahraje soubor CSV podle appčiny
 * šablony (lib/finance-csv-import.ts), appka nic nestahuje.
 *
 * Do registru patří proto, aby dlaždice a hlášky věděly, že tahle
 * cesta je vždycky k dispozici, i když žádná banka připojená není.
 * Zápis jde stejnou cestou jako stažení z banky (`zapsatVypis`,
 * `importovat_vypis`), jen se zdrojem `csv_banka`.
 *
 * Kódování: tabulkové procesory na Windows ukládají CSV často
 * v kódování windows-1250, ne UTF-8. Bajty se proto nejdřív zkusí
 * přísně jako UTF-8 a teprve když to nejde, jako windows-1250 — jinak
 * by z „Káva s.r.o." zbylo „K�va s.r.o." a otisk pohybu by se lišil
 * od téhož výpisu uloženého v UTF-8.
 *
 * Čistá logika (scripts/banka-csv.test.mjs).
 */

import type { KonektorBanky } from './konektor.ts'
import { naparsovatCsv, type VysledekImportu } from '../finance-csv-import.ts'

export const KONEKTOR_IMPORT_VYPISU: KonektorBanky = {
  poskytovatel: 'import_vypisu',
  nazev: 'import výpisu (CSV)',
  druh: 'vypis',
  nabizetPripojeni: () => true,
}

export type KodovaniVypisu = 'utf-8' | 'windows-1250'

export function dekodovatVypis(bajty: Uint8Array): { text: string; kodovani: KodovaniVypisu } {
  try {
    // `fatal` = neplatná sekvence UTF-8 vyhodí výjimku místo tichého „�".
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bajty), kodovani: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1250').decode(bajty), kodovani: 'windows-1250' }
  }
}

/**
 * Soubor výpisu (bajty) → řádky a chyby; BOM odstraní dekodér i parser.
 * Vrací i přečtený text — z něj se počítá otisk souboru (dávka), ať je
 * stejný soubor stejný bez ohledu na to, kudy přišel.
 */
export function naparsovatVypis(bajty: Uint8Array): VysledekImportu & { kodovani: KodovaniVypisu; text: string } {
  const { text, kodovani } = dekodovatVypis(bajty)
  return { ...naparsovatCsv(text), kodovani, text }
}
