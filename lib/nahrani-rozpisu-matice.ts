/**
 * Nahrání rozpisu z tabulky — maticový formát (dny v řádcích, jména
 * lidí ve sloupcích, značka směny v buňce).
 *
 * Zadání Šéfíka 16.9.2026 (chat, ne soubor v docs/): reálný export
 * rozpisu vypadá takhle, ne jako řádek na směnu s časy — přesně tenhle
 * tvar `lib/nahrani-rozpisu.ts` neuměl a napřímo to nešlo obejít.
 *
 * Tenhle soubor dělá jen ROZPOZNÁNÍ TVARU A ROZLOŽENÍ BUNĚK — čisté
 * funkce, žádné volání databáze. Kdo značce (řekněme „X-B“) odpovídá
 * za jaký čas a jakou pobočku, se ptá Šablon směn (`sablony_pro_smenu`,
 * app/[rozsah]/smeny/sablony.ts) — tenhle soubor jen značku ROZDĚLÍ na
 * základ a příponu, přiřazení dělá volající (pruvodce.tsx), protože to
 * potřebuje async dotazy do databáze.
 *
 * Značky a zkratky jsou data (docs/nahravani-dat-zadani.md, oddíl B):
 * čemu appka nerozumí, to nenahraje a napíše proč. Stejné pravidlo tu
 * platí i pro PŘÍPONU (pobočku) — nerozpoznaná přípona se nedomýšlí.
 */

export type Maticovy = {
  /** Index sloupce → jméno z hlavičky, jen sloupce, co vypadají na jméno člověka. */
  sloupceJmen: { index: number; jmeno: string }[]
}

/**
 * Vypadá tabulka na matici (dny v řádcích, jména ve sloupcích)?
 *
 * Poznávací znamení: první sloupec je ve většině řádků holé číslo
 * 1–31 (den v měsíci) — ploché tabulky mívají v prvním sloupci celé
 * datum nebo jméno, ne samotné číslo dne. Vzorek prvních deseti řádků
 * stačí; nemá smysl číst celý soubor jen na rozpoznání tvaru.
 */
export function jeMaticovyFormat(hlavicka: string[], radky: string[][]): boolean {
  if (hlavicka.length < 3 || radky.length === 0) return false

  const vzorek = radky.slice(0, 10)
  let dnyPocet = 0
  for (const r of vzorek) {
    if (jeDenMesice((r[0] ?? '').trim())) dnyPocet++
  }
  return dnyPocet >= Math.ceil(vzorek.length * 0.7)
}

function jeDenMesice(text: string): boolean {
  if (!/^\d{1,2}$/.test(text)) return false
  const n = Number(text)
  return n >= 1 && n <= 31
}

/**
 * Které sloupce (mimo první) vypadají na jméno člověka — mají v hlavičce
 * neprázdný text. Sloupec bez záhlaví se přeskočí, nemá se čeho chytit.
 */
export function sloupceJmen(hlavicka: string[]): { index: number; jmeno: string }[] {
  const vysledek: { index: number; jmeno: string }[] = []
  for (let i = 1; i < hlavicka.length; i++) {
    const jmeno = (hlavicka[i] ?? '').trim()
    if (jmeno) vysledek.push({ index: i, jmeno })
  }
  return vysledek
}

/**
 * Značka rozdělená na základ a příponu podle POSLEDNÍ pomlčky —
 * „X-B“ → základ „X“, přípona „B“. „X“ (bez pomlčky) → přípona null.
 * Zkratka samotná se nemění na velká/malá písmena; porovnávání proti
 * Šablonám dělá až volající (stejně jako `sablony_pro_smenu` v databázi:
 * `lower(btrim(key))`).
 */
export function rozlozZnacku(text: string): { zaklad: string; pripona: string | null } {
  const t = text.trim()
  const i = t.lastIndexOf('-')
  // Pomlčka na první pozici (t[0] === '-') by dala prázdný základ —
  // to není přípona, je to jen znak v jinak neznámé značce.
  if (i <= 0) return { zaklad: t, pripona: null }
  const zaklad = t.slice(0, i).trim()
  const pripona = t.slice(i + 1).trim()
  if (!zaklad || !pripona) return { zaklad: t, pripona: null }
  return { zaklad, pripona }
}

export type BunkaMatice = {
  radek: number
  den: number
  jmeno: string
  kodRaw: string
  zaklad: string
  pripona: string | null
}

/** Všechny neprázdné buňky matice, s rozloženou značkou. Prázdné buňky = žádná směna, přeskakují se beze zmínky. */
export function rozeberMatici(
  radky: string[][],
  sloupce: { index: number; jmeno: string }[],
): BunkaMatice[] {
  const vysledek: BunkaMatice[] = []
  radky.forEach((r, i) => {
    const denText = (r[0] ?? '').trim()
    if (!jeDenMesice(denText)) return
    const den = Number(denText)
    for (const { index, jmeno } of sloupce) {
      const kodRaw = (r[index] ?? '').trim()
      if (!kodRaw) continue
      const { zaklad, pripona } = rozlozZnacku(kodRaw)
      vysledek.push({ radek: i + 2, den, jmeno, kodRaw, zaklad, pripona })
    }
  })
  return vysledek
}

/** Distinct základy a přípony ze všech rozpoznaných buněk — pro krok "Značky" v průvodci. */
export function distinctZnacky(bunky: BunkaMatice[]): { zaklady: string[]; pripony: string[] } {
  const zaklady = new Set<string>()
  const pripony = new Set<string>()
  for (const b of bunky) {
    zaklady.add(b.zaklad)
    if (b.pripona) pripony.add(b.pripona)
  }
  return { zaklady: [...zaklady].sort(), pripony: [...pripony].sort() }
}

/** „YYYY-MM-DD" z roku, měsíce (1–12) a dne — s kontrolou, že den v tom měsíci existuje. */
export function sestavDatum(rok: number, mesic: number, den: number): string | null {
  if (!Number.isInteger(rok) || rok < 2000 || rok > 2100) return null
  if (!Number.isInteger(mesic) || mesic < 1 || mesic > 12) return null
  const posledniDen = new Date(Date.UTC(rok, mesic, 0)).getUTCDate()
  if (!Number.isInteger(den) || den < 1 || den > posledniDen) return null
  return `${rok}-${String(mesic).padStart(2, '0')}-${String(den).padStart(2, '0')}`
}

export const NAZVY_MESICU = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
]
