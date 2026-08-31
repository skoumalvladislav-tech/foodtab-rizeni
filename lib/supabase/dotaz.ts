import 'server-only'

/**
 * Prázdný výsledek NENÍ důkaz, že tam nic není.
 *
 * Zápis `const { data } = await supabase.from(...)...` chybu zahodí
 * a `data ?? []` z ní udělá prázdný seznam. Obrazovka pak nakreslí
 * „zatím tu nic není“ — a vypadá to úplně stejně jako správně
 * vykreslená prázdná firma.
 *
 * Stalo se to doopravdy: rozbalovátko pozic četlo `select("id, name")`,
 * jenže sloupec se jmenuje `label`. PostgREST vrátil chybu, aplikace ji
 * zahodila a v rozbalovátku prostě nebylo nic. Ani v konzoli, ani
 * v logu, ani v buildu se to neprojevilo — sloupec v `select` totiž
 * nikdo nekontroluje, je to řetězec.
 *
 * Proto se odsud při chybě VYHAZUJE. Pád s hláškou je horší zážitek
 * a lepší zpráva než tichý prázdný seznam: pád si někdo všimne hned,
 * chybějícího člověka v seznamu za týden.
 *
 * Co se tím NEODCHYTÍ a ani nemá: prázdno kvůli RLS. To je platná
 * odpověď databáze („tohle vidět nesmíš“) a přichází bez chyby.
 */

/** Tvar chyby, jak ji vrací PostgREST. */
type ChybaDotazu = {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

type Odpoved<T> = { data: T | null; error: ChybaDotazu | null }

export class DotazSelhal extends Error {
  readonly kod?: string

  constructor(popis: string, chyba: ChybaDotazu) {
    const casti = [chyba.message]
    if (chyba.details) casti.push(String(chyba.details))
    if (chyba.hint) casti.push(`Nápověda: ${chyba.hint}`)
    super(
      `Dotaz „${popis}“ selhal${chyba.code ? ` (${chyba.code})` : ''}: ` +
        casti.join(' — '),
    )
    this.name = 'DotazSelhal'
    this.kod = chyba.code
  }
}

/**
 * Seznam řádků. Při chybě dotazu vyhodí, jinak vrátí pole (i prázdné).
 *
 * `popis` je pár slov, která se objeví v hlášce — „pozice firmy“,
 * „zaměstnanci pobočky“. Bez nich se u desítek dotazů nepozná, který
 * z nich spadl.
 */
export async function seznam<T>(
  popis: string,
  dotaz: PromiseLike<Odpoved<T[]>>,
): Promise<T[]> {
  const { data, error } = await dotaz
  if (error) throw new DotazSelhal(popis, error)
  return data ?? []
}

/**
 * Jeden řádek, nebo null když žádný není.
 *
 * PGRST116 („Cannot coerce the result to a single JSON object“) je
 * u `.single()` odpověď „nic jsem nenašel“, ne porucha — vrací se null.
 * Všechno ostatní je chyba dotazu a vyhazuje se.
 */
export async function jeden<T>(
  popis: string,
  dotaz: PromiseLike<Odpoved<T>>,
): Promise<T | null> {
  const { data, error } = await dotaz
  if (error) {
    if (error.code === 'PGRST116') return null
    throw new DotazSelhal(popis, error)
  }
  return data
}

/**
 * Volání funkce v databázi (průzoru).
 *
 * Tady je zahozená chyba ještě zrádnější než u tabulek: `has_access`,
 * `business_date` nebo `employee_earnings` vracejí jednu hodnotu a
 * `null` z nich vypadá jako platná odpověď „ne“ nebo „nic“.
 */
export async function pruzor<T>(
  popis: string,
  dotaz: PromiseLike<Odpoved<T>>,
): Promise<T | null> {
  const { data, error } = await dotaz
  if (error) throw new DotazSelhal(popis, error)
  return data
}

/**
 * Chybí ta funkce v databázi, nebo se pokazil dotaz?
 *
 * Průzory na mzdy se nasazují zvlášť a obrazovky s nimi počítají: dokud
 * migrace neproběhla, sloupec se sazbou se prostě nekreslí. To je
 * v pořádku — ale jen pro tenhle jeden důvod. Cokoli jiného (chybějící
 * právo, překlep v názvu parametru, chyba uvnitř funkce) je porucha
 * a tiše skrytá sazba by vypadala úplně stejně jako nenasazená migrace.
 *
 * PGRST202 = PostgREST tu funkci nezná. 42883 = Postgres ji nezná.
 */
export function funkceNeexistuje(chyba: ChybaDotazu | null): boolean {
  return chyba?.code === 'PGRST202' || chyba?.code === '42883'
}
