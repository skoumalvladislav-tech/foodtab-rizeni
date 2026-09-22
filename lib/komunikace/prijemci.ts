/**
 * Výběr příjemců — hledání, řazení a popisky.
 *
 * Seznam kolegů přichází z databáze (public.komu_muzu_psat) a je jen
 * to, co výběr potřebuje: id, jméno, zařazení a příznak „na mé pobočce“.
 * Tady se jen hledá a třídí. O tom, kdo smí komu psát, rozhoduje databáze
 * — obrazovka nabídku zužuje, ne hlídá.
 */

export type Prijemce = {
  employee_id: string
  jmeno: string
  branch_id: string | null
  usek_id: string | null
  position_id: string | null
  na_me_pobocce: boolean
}

export type SkupinaPrijemcu = {
  klic: string
  nazev: string
  lide: Prijemce[]
}

/** Bez diakritiky, malými písmeny, jednoduchými mezerami — jen pro hledání. */
export function normalizuj(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hledání podle jména. Každé zadané slovo musí být na začátku některého
 * slova ve jménu („kar nov“ najde „Karel Novák“); diakritika a velikost
 * písmen nehrají roli. Prázdný dotaz vrátí všechny.
 */
export function hledatPrijemce(lide: Prijemce[], dotaz: string): Prijemce[] {
  // Pomlčka odděluje slova jako mezera: „svob“ najde „Nováková-Svobodová“.
  const slova = normalizuj(dotaz).split(/[\s-]+/).filter(Boolean)
  if (slova.length === 0) return lide
  return lide.filter((p) => {
    const jmenaSlova = normalizuj(p.jmeno).split(/[\s-]+/)
    return slova.every((s) => jmenaSlova.some((j) => j.startsWith(s)))
  })
}

/**
 * Skupiny pro seznam: nejdřív „Moje pobočka“ (kolegové, se kterými
 * člověk pracuje), pak ostatní podle pobočky. Prázdné skupiny nejsou.
 * Uvnitř skupiny podle jména česky.
 */
export function seskupitPrijemce(
  lide: Prijemce[],
  pobocky: ReadonlyMap<string, string>,
): SkupinaPrijemcu[] {
  const razeni = (a: Prijemce, b: Prijemce) => a.jmeno.localeCompare(b.jmeno, 'cs')

  const moje = lide.filter((p) => p.na_me_pobocce).sort(razeni)
  const ostatni = new Map<string, Prijemce[]>()
  for (const p of lide) {
    if (p.na_me_pobocce) continue
    const klic = p.branch_id ?? 'bez'
    ostatni.set(klic, [...(ostatni.get(klic) ?? []), p])
  }

  const skupiny: SkupinaPrijemcu[] = []
  if (moje.length > 0) skupiny.push({ klic: 'moje', nazev: 'Moje pobočka a vedení', lide: moje })

  const zbyle = [...ostatni.entries()].map(([klic, l]) => ({
    klic,
    nazev: klic === 'bez' ? 'Bez pobočky' : (pobocky.get(klic) ?? 'Jiná pobočka'),
    lide: l.sort(razeni),
  }))
  zbyle.sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
  return [...skupiny, ...zbyle]
}

/** „Anna“, „Anna a Bořek“, „Anna, Bořek a 2 další“. */
export function souhrnVyberu(vybrani: Pick<Prijemce, 'jmeno'>[]): string {
  const jmena = vybrani.map((p) => p.jmeno.split(' ')[0])
  if (jmena.length === 0) return 'Nikdo není vybraný'
  if (jmena.length === 1) return jmena[0]
  if (jmena.length === 2) return `${jmena[0]} a ${jmena[1]}`
  const dalsi = jmena.length - 2
  const slovo = dalsi === 1 ? 'další' : dalsi >= 2 && dalsi <= 4 ? 'další' : 'dalších'
  return `${jmena[0]}, ${jmena[1]} a ${dalsi} ${slovo}`
}
