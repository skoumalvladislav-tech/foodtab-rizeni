/**
 * Brána Faktur — rozhodnutí, jestli firma Faktury má (čistá funkce).
 *
 * Od sloučení (docs/faktury-slouceni-navrh.md) žijí faktury v hlavní
 * databázi (`public.faktury`). Firma je má OTEVŘENÉ jen ve stavu převodu
 * `dokonceno` (`faktury_prevod`). Stejné pravidlo hlídá databáze sama
 * (spoušť app.faktury_brana, pro všechny role) — tohle je první linie
 * v appce, ať obrazovka řekne proč, místo aby spadla.
 *
 *   žádný řádek    → zavřeno. Vlastník staré databáze čeká na převod;
 *                    ostatní firmy Faktury zatím nemají (otázka 60).
 *   probiha        → zavřeno, „Faktury se stěhují".
 *   vraceno        → zavřeno, „vráceno do původní databáze".
 *   dokonceno      → otevřeno.
 *   tabulka chybí  → zavřeno pro všechny (kód je nasazený dřív než
 *                    `db push` — „Faktury se připravují").
 *   jiná chyba     → zavřeno (při nejistotě se odmítá, authz pravidlo 2).
 *
 * Bez `server-only`, ať jde testovat Nodem (scripts/faktury-tenant-izolace.test.mjs, oddíl 4).
 */

import { jeVlastnikFakturyDb } from './faktury-vlastnik.ts'

export type StavPrevodu = 'probiha' | 'dokonceno' | 'vraceno'

export type RozhodnutiBrany =
  | { stav: 'ok' }
  | { stav: 'zavreno'; duvod: 'ceka_na_prevod' | 'nezapnuto' | 'probiha' | 'vraceno' }
  | { stav: 'nepripraveno' }
  | { stav: 'chyba' }

/** Výsledek dotazu na `faktury_prevod` (jeden řádek firmy). */
export type DotazNaPrevod = {
  data: { stav: string } | null
  error: { code?: string; message?: string } | null
}

const TABULKA_CHYBI = new Set(['PGRST205', '42P01'])

export function rozhodnoutBranu(
  dotaz: DotazNaPrevod,
  tenantId: string,
  /** process.env.FAKTURY_DB_TENANT_ID — jen pro text hlášky, o přístupu nerozhoduje. */
  vlastnikStareDatabaze: string | null | undefined,
): RozhodnutiBrany {
  if (dotaz.error) {
    return TABULKA_CHYBI.has(dotaz.error.code ?? '') ? { stav: 'nepripraveno' } : { stav: 'chyba' }
  }
  const stav = dotaz.data?.stav
  if (stav === 'dokonceno') return { stav: 'ok' }
  if (stav === 'probiha') return { stav: 'zavreno', duvod: 'probiha' }
  if (stav === 'vraceno') return { stav: 'zavreno', duvod: 'vraceno' }
  if (stav === undefined || stav === null) {
    return {
      stav: 'zavreno',
      duvod: jeVlastnikFakturyDb(tenantId, vlastnikStareDatabaze) ? 'ceka_na_prevod' : 'nezapnuto',
    }
  }
  // Neznámý stav = nejistota → zavřeno.
  return { stav: 'chyba' }
}

/**
 * Věta místo „Nic nevyžaduje pozornost" na Finance → Přehled, když se
 * nic zjistit nedalo: Faktury zavřené (stěhují se, vrácené, připravují
 * se, chyba) nebo selhal dotaz. null = firma Faktury nepoužívá (nezapnuto)
 * — tam je „nic" pravda. Stejné věty jako na Dnes.
 */
export function prazdnoPozornosti(r: Exclude<RozhodnutiBrany, { stav: 'ok' }> | { stav: 'chyba_dotazu' }): string | null {
  if (r.stav === 'chyba_dotazu') return 'Faktury ke kontrole a návrhy párování se nepodařilo načíst — zkuste stránku obnovit.'
  if (r.stav === 'zavreno' && r.duvod === 'nezapnuto') return null
  const stehuji = r.stav === 'zavreno' && (r.duvod === 'probiha' || r.duvod === 'ceka_na_prevod')
  return `${hlaskaBrany(r).nadpis} — párování plateb a faktury ke kontrole ${stehuji ? 'se ukážou po dokončení' : 'teď nejde zjistit'}.`
}

/** Co říct na obrazovce, když jsou Faktury zavřené. */
export function hlaskaBrany(r: Exclude<RozhodnutiBrany, { stav: 'ok' }>): { nadpis: string; text: string } {
  if (r.stav === 'nepripraveno') {
    return {
      nadpis: 'Faktury se připravují',
      text: 'Nová verze appky už běží, ale databáze na ni ještě čeká (Šéfík spustí aktualizaci databáze). Faktury se do té doby nedají číst ani měnit.',
    }
  }
  if (r.stav === 'chyba') {
    return {
      nadpis: 'Faktury teď nejdou otevřít',
      text: 'Nepodařilo se ověřit, jestli jsou Faktury pro tuto firmu otevřené. Zkuste to za chvíli znovu.',
    }
  }
  switch (r.duvod) {
    case 'ceka_na_prevod':
      return {
        nadpis: 'Faktury se stěhují do hlavní databáze',
        text: 'Faktury se přesouvají ze samostatné databáze do appky. Do dokončení se nedají číst ani měnit a nové faktury z e-mailu počkají ve schránce — nic se neztratí.',
      }
    case 'probiha':
      return {
        nadpis: 'Faktury se stěhují do hlavní databáze',
        text: 'Právě probíhá převod faktur. Do jeho dokončení se nedají číst ani měnit a nové faktury z e-mailu počkají ve schránce — nic se neztratí.',
      }
    case 'vraceno':
      return {
        nadpis: 'Faktury jsou vrácené do původní databáze',
        text: 'Převod faktur se vrátil zpět. Faktury teď spravuje předchozí verze appky.',
      }
    case 'nezapnuto':
      return {
        nadpis: 'Faktury pro tuto firmu zatím nejsou zapnuté',
        text: 'Faktury jsou zatím jen pro firmu, která je měla v samostatné databázi. Pro další firmy je zapne Šéfík.',
      }
  }
}
