/**
 * Levý sloupec a spodní lišta modulu Finance (gastro ERP, 3. 10. 2026).
 *
 * Stejný vzor jako `lib/faktury-navigace.ts`/`lib/marketing-navigace.ts`:
 * jedna rodina položek v `app/[rozsah]/nabidka.ts`, detailní navigace
 * žije tady a ve vnořeném layoutu. Faktury mají svůj VLASTNÍ vnořený
 * layout (lib/faktury-navigace.ts) uvnitř `/finance/faktury` — tahle
 * navigace proto na Faktury jen odkazuje jako na poslední položku,
 * nevykresluje jejich osm obrazovek znovu.
 */

import { PRAVA_CTENI_JINYCH_PLATEB } from './jine-platby-typy.ts'

export type FinanceIkona =
  | 'prehled'
  | 'trzby'
  | 'jine_platby'
  | 'cashflow'
  | 'kontakty'
  | 'platby'
  | 'nakup'
  | 'zakazky'
  | 'rozpocty'
  | 'vybaveni'
  | 'integrace'
  | 'faktury'

type Definice = {
  klic: string
  segment: string
  nazev: string
  kratky: string
  ikona: FinanceIkona
  /** Jen pro celou firmu — na pobočce se nekreslí (stejný příznak jako v app/[rozsah]/nabidka.ts). */
  jenFirma?: boolean
  /** Položka se ukáže, když má člověk aspoň jedno z těch práv (stejně jako `pravo` v app/[rozsah]/nabidka.ts). */
  prava: readonly string[]
}

/**
 * Segment adresy celé firmy — tatáž hodnota jako `TENANT_SCOPE_SEGMENT`
 * v lib/authz.ts. Tady zvlášť, protože navigaci kreslí klientská
 * komponenta a authz je jen pro server; shodu hlídá
 * scripts/finance-pobocky.test.mjs.
 */
export const SEGMENT_FIRMY = 'firma'

/**
 * Struktura podle zadání (oddíl 11): „Přehled, Faktury, Cashflow a
 * platby, Nákup/objednávky, Sklad/inventury [vynecháno — mantinel],
 * Receptury/výroba/kalkulace [žije v modulu Provoz], Kontakty/zakázky,
 * Náklady práce [žije v Docházce — vydelky_prehled], Rozpočty a
 * controlling, Vybavení, Integrace." Kontakty a Zakázky jsou tu dvě
 * položky, ne jedna — jasnější menu, stejná CRM entita (kontakty) pod
 * oběma.
 *
 * Jiné platby (Finance → Tržby → Jiné platby, 16. 10. 2026) stojí hned
 * za Tržbami: agenda je pod nimi a vidí ji i obsluha BEZ finance.read
 * (kterékoli právo agendy — `PRAVA_CTENI_JINYCH_PLATEB`, stejné pravidlo
 * jako app/[rozsah]/nabidka.ts a `zkusPristupJinymPlatbam`).
 */
const POLOZKY: readonly Definice[] = [
  { klic: 'prehled', segment: '', nazev: 'Přehled', kratky: 'Přehled', ikona: 'prehled', prava: ['finance.read'] },
  // Šéfík 12. 10.: tržby z pokladen po provozovnách, platbách, dnech, měsících a rocích.
  { klic: 'trzby', segment: 'trzby', nazev: 'Tržby', kratky: 'Tržby', ikona: 'trzby', prava: ['finance.read'] },
  { klic: 'jine_platby', segment: 'trzby/jine-platby', nazev: 'Jiné platby', kratky: 'Jiné platby', ikona: 'jine_platby', prava: PRAVA_CTENI_JINYCH_PLATEB },
  { klic: 'cashflow', segment: 'cashflow', nazev: 'Cashflow', kratky: 'Cashflow', ikona: 'cashflow', prava: ['finance.read'] },
  { klic: 'platby', segment: 'platby', nazev: 'Platby', kratky: 'Platby', ikona: 'platby', prava: ['finance.read'] },
  // Nákup patří modulu Objednávky (purchasing.read), ne Financím.
  { klic: 'nakup', segment: 'nakup', nazev: 'Nákup', kratky: 'Nákup', ikona: 'nakup', prava: ['purchasing.read'] },
  { klic: 'kontakty', segment: 'kontakty', nazev: 'Kontakty', kratky: 'Kontakty', ikona: 'kontakty', jenFirma: true, prava: ['finance.read'] },
  { klic: 'zakazky', segment: 'zakazky', nazev: 'Zakázky', kratky: 'Zakázky', ikona: 'zakazky', prava: ['finance.read'] },
  { klic: 'rozpocty', segment: 'rozpocty', nazev: 'Rozpočty a controlling', kratky: 'Rozpočty', ikona: 'rozpocty', prava: ['finance.read'] },
  { klic: 'vybaveni', segment: 'vybaveni', nazev: 'Vybavení', kratky: 'Vybavení', ikona: 'vybaveni', prava: ['finance.read'] },
  { klic: 'integrace', segment: 'integrace', nazev: 'Integrace', kratky: 'Integrace', ikona: 'integrace', jenFirma: true, prava: ['finance.read'] },
  { klic: 'faktury', segment: 'faktury', nazev: 'Faktury', kratky: 'Faktury', ikona: 'faktury', jenFirma: true, prava: ['faktury.read'] },
]

export type PolozkaNavigace = {
  klic: string
  href: string
  nazev: string
  kratky: string
  ikona: FinanceIkona
}

/**
 * Položky pro rozsah z adresy. Na pobočce (Šéfík 13. 10.: „mám otevřený
 * Bernard Bar…“) chybí obrazovky jen pro celou firmu — Kontakty
 * (bez pobočky), Integrace (napojení firmy) a Faktury (oddělená
 * databáze bez pobočky).
 *
 * `prava` (N24, kontrola 19. 10. 2026) = práva přihlášeného, která
 * stránka zná (stránky agendy Jiných plateb: práva agendy a finance.read
 * v rozsahu, Nákup a Faktury podle `canSee` — `pravaNavigaceFinanci`
 * v lib/jine-platby-pristup.ts). Položka bez některého ze svých práv se
 * nekreslí: obsluha jen s `jine_platby.zadat` vidí jen Jiné platby, ne
 * obrazovky, kam by ji pustit nešlo. Bez `prava` (ostatní obrazovky
 * Financí — tam se dostane jen ten, kdo má finance.read) se kreslí
 * všechno jako dřív, i Jiné platby (finance.read je jedno z jejich práv).
 * Navigace nic nechrání — každá stránka si přístup ověří sama.
 */
export function sestavNavigaci(
  rozsah: string,
  prava?: Iterable<string> | null,
): { hlavni: PolozkaNavigace[]; mobil: PolozkaNavigace[] } {
  const zaklad = `/${rozsah}/finance`
  const naFirme = rozsah === SEGMENT_FIRMY
  const mnozina = prava === undefined || prava === null ? null : new Set(prava)
  const hlavni = POLOZKY.filter((d) => (naFirme || !d.jenFirma) && (mnozina === null || d.prava.some((p) => mnozina.has(p)))).map((d) => ({
    klic: d.klic,
    href: d.segment ? `${zaklad}/${d.segment}` : zaklad,
    nazev: d.nazev,
    kratky: d.kratky,
    ikona: d.ikona,
  }))

  return { hlavni, mobil: hlavni }
}

/**
 * Nejdelší shoda vyhrává — přehled je předponou všech ostatních adres
 * a Tržby předponou Jiných plateb (na stránkách agendy svítí Jiné
 * platby, ne Tržby).
 */
export function aktivniKlic(cesta: string, polozky: readonly PolozkaNavigace[]): string | null {
  let nejlepsi: PolozkaNavigace | null = null
  for (const p of polozky) {
    if (cesta !== p.href && !cesta.startsWith(p.href + '/')) continue
    if (!nejlepsi || p.href.length > nejlepsi.href.length) nejlepsi = p
  }
  return nejlepsi?.klic ?? null
}
