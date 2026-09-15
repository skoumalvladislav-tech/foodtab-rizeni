/**
 * Kampaně — série příspěvků k jedné akci.
 *
 * Zadání: master prompt, oddíl 15 („série příspěvků: pozvánka →
 * připomínka → poslední výzva → report po akci").
 *
 * ---------------------------------------------------------------------
 * PROČ JE PLÁN V KNIHOVNĚ A NE V SERVEROVÉ AKCI
 *
 * Serverovou akci nejde zavolat mimo aplikaci, takže by se na ni
 * nedalo sáhnout kontrolou. A plán série je počítání s daty — tedy
 * přesně to, co se dá zkazit tak, že to skoro vždycky vyjde.
 *
 * Kontroly jsou v `scripts/marketing-kampane.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * PLÁN NENÍ PŘÍSPĚVEK
 *
 * Tahle knihovna nic nezakládá. Spočítá, CO by mělo vzniknout a KDY —
 * a vrátí to jako seznam. Zapsat to do databáze je věc serverové akce,
 * která k tomu má práva a ověřuje rozsah.
 */

/** Jeden kus série. */
export type KrokSerie = {
  klic: string
  nazev: string
  /** Kolik dnů před akcí (záporné = po akci). */
  posunDnu: number
  /** Hodina na zdi, `HH:MM`. Pásmo dodá pobočka až v databázi. */
  cas: string
  pilir: string
  /** Věta do zadání pro AI návrh, ne hotový text. */
  pokyn: string
}

/**
 * Výchozí série ke gastro akci.
 *
 * ---------------------------------------------------------------------
 * ČÍSLA JSOU VOLENÁ, NE ZMĚŘENÁ — A PŘIZNÁVÁ SE TO
 *
 * Sedm dnů předem, den předem, ráno v den akce a den po ní. Není to
 * z žádných dat; je to pravidlo, které se dá změnit, až budou vlastní
 * čísla. Zadání to tak chce: „doporučený čas publikace až po získání
 * dostatku vlastních dat; do té doby transparentní výchozí pravidla".
 *
 * Proto jsou tady, pojmenovaná a vysvětlená, a ne rozsypaná
 * v podmínkách.
 *
 * ---------------------------------------------------------------------
 * ČASY JSOU HODINY NA ZDI, NE OKAMŽIKY
 *
 * `'17:00'` je řetězec schválně. Okamžik z toho udělá až databáze přes
 * `app.marketing_okamzik` s pásmem pobočky (CLAUDE.md, pravidlo 11).
 * `new Date('…T17:00')` by se přečetlo v pásmu serveru — a ten je na
 * Vercelu v UTC, takže by pozvánka odešla v 19:00.
 */
export const SERIE_AKCE: KrokSerie[] = [
  {
    klic: 'pozvanka',
    nazev: 'Pozvánka',
    posunDnu: 7,
    cas: '11:00',
    pilir: 'akce',
    pokyn: 'Pozvánka na akci — co to je, proč stojí za to přijít, kdy a kde. '
      + 'Ještě bez naléhání, je to týden předem.',
  },
  {
    klic: 'pripominka',
    nazev: 'Připomínka',
    posunDnu: 1,
    cas: '17:00',
    pilir: 'akce',
    pokyn: 'Připomínka den předem. Krátce: co se chystá, v kolik, '
      + 'a ať si lidé rezervují místo.',
  },
  {
    klic: 'posledni_vyzva',
    nazev: 'Poslední výzva',
    posunDnu: 0,
    cas: '10:00',
    pilir: 'akce',
    pokyn: 'Dnes je to tady. Krátká výzva ráno v den akce — pár vět, '
      + 'čas a poslední volná místa.',
  },
  {
    klic: 'podekovani',
    nazev: 'Poděkování po akci',
    // Záporný posun = PO akci. Viz `terminKroku`.
    posunDnu: -1,
    cas: '12:00',
    pilir: 'atmosfera',
    pokyn: 'Poděkování den po akci. Jak to dopadlo, poděkovat hostům '
      + 'a naznačit, že se to bude opakovat. Na fotky z akce.',
  },
]

export type NavrhKroku = {
  klic: string
  nazev: string
  pilir: string
  pokyn: string
  /** Datum ve tvaru `2026-09-20`. */
  datum: string
  /** Hodina na zdi, `HH:MM`. */
  cas: string
  /**
   * Termín už je za námi.
   *
   * Neznamená to, že se krok nezaloží — koncept bez data je pořád
   * k něčemu. Znamená to, že se mu NEDÁ termín: naplánovat příspěvek
   * na včerejšek by vyrobilo úlohu, kterou fronta vezme hned a pošle
   * pozvánku na akci, která už byla.
   */
  jePozde: boolean
}

/**
 * Datum kroku vůči dni akce.
 *
 * Počítá se v UTC přes `Date.UTC` a nad samotným DATEM, ne nad
 * okamžikem: posun o den se nesmí pokazit přechodem na letní čas.
 * Kdyby se odečítalo 86 400 000 milisekund od místního času, vyšel by
 * 29. 3. tentýž den znovu.
 */
export function terminKroku(denAkce: string, posunDnu: number): string {
  const [r, m, d] = denAkce.split('-').map(Number)
  const cil = new Date(Date.UTC(r, m - 1, d - posunDnu))
  return `${cil.getUTCFullYear()}-${String(cil.getUTCMonth() + 1).padStart(2, '0')}-${String(cil.getUTCDate()).padStart(2, '0')}`
}

/**
 * Co by ke kampani mělo vzniknout.
 *
 * `dnes` je povinný parametr, ne `new Date()` uvnitř. Kdyby si funkce
 * brala dnešek sama, šel by z pásma serveru (v UTC) a po 22:00 by
 * tvrdila, že je zítra. A hlavně: nedala by se ověřit kontrolou, která
 * platí i v 23:50.
 */
export function navrhnoutSerii(vstup: {
  denAkce: string
  dnes: string
  kroky?: KrokSerie[]
}): NavrhKroku[] {
  const kroky = vstup.kroky ?? SERIE_AKCE

  return kroky.map((k) => {
    const datum = terminKroku(vstup.denAkce, k.posunDnu)
    return {
      klic: k.klic,
      nazev: k.nazev,
      pilir: k.pilir,
      pokyn: k.pokyn,
      datum,
      cas: k.cas,
      // Ostře menší: krok na dnešek je ještě v pořádku, ten na včerejšek ne.
      jePozde: datum < vstup.dnes,
    }
  })
}

/**
 * Kdy se automatizace pustí příště.
 *
 * ---------------------------------------------------------------------
 * VRACÍ DATUM, NE OKAMŽIK
 *
 * Hodina na zdi zůstává hodinou na zdi. Okamžik z dvojice
 * (datum, čas) udělá databáze s pásmem pobočky — pravidlo 11.
 *
 * ---------------------------------------------------------------------
 * PRÁZDNÉ DNY ZNAMENAJÍ „KAŽDÝ DEN", NE „NIKDY"
 *
 * Zapnutá automatizace, která nic nedělá, vypadá jako porucha.
 * Prázdný výběr dnů je výchozí stav a znamená, že se nefiltruje.
 */
export function pristiBeh(vstup: {
  /** Dnešní datum v pásmu pobočky. */
  dnes: string
  /** Aktuální hodina na zdi v pásmu pobočky, `HH:MM`. */
  ted: string
  cas: string
  /** 1 = pondělí … 7 = neděle. Prázdné = každý den. */
  dnyVTydnu: number[]
}): string | null {
  const dny = vstup.dnyVTydnu.length > 0 ? vstup.dnyVTydnu : [1, 2, 3, 4, 5, 6, 7]

  /*
    Hledá se do čtrnácti dnů dopředu, ne do nekonečna. Týden by stačil
    na platný výběr dnů; čtrnáct je zásoba pro případ, že by někdo
    do pole dostal den mimo rozsah a na týdnu by se to netrefilo.
    Když se nenajde nic, vrací se `null` — a obrazovka to musí umět
    říct, ne tvářit se, že to poběží.
  */
  for (let o = 0; o <= 14; o++) {
    const den = terminKroku(vstup.dnes, -o)
    const dvt = isoDenVTydnu(den)
    if (!dny.includes(dvt)) continue
    // Dnešek se bere jen tehdy, když hodina ještě nebyla.
    if (o === 0 && vstup.ted >= vstup.cas) continue
    return den
  }

  return null
}

/** 1 = pondělí … 7 = neděle, stejně jako `isodow` v Postgresu. */
export function isoDenVTydnu(datum: string): number {
  const d = new Date(`${datum}T00:00:00Z`)
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay()
}

export const DRUHY_AUTOMATIZACE = [
  {
    klic: 'denni_menu',
    nazev: 'Denní menu',
    popis: 'Každé ráno připraví koncept z potvrzeného denního menu. Když menu na ten den není, '
      + 'nic se nezaloží a v historii se to označí jako přeskočené.',
  },
  {
    klic: 'vikendove_menu',
    nazev: 'Propagace víkendu',
    popis: 'Ve zvolený den připraví koncept na víkendovou nabídku, s předstihem podle nastavení.',
  },
  {
    klic: 'evergreen',
    nazev: 'Zásoba na prázdné dny',
    popis: 'Připraví koncept ze zásoby, když je v kalendáři delší ticho. Nic nezveřejní — '
      + 'jen doplní, z čeho vybírat.',
  },
] as const

export const DNY_ZKRATKY_ISO = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']

/** „po, st, pá" — nebo „každý den", když se nefiltruje. */
export function popisDnu(dny: number[]): string {
  if (dny.length === 0) return 'každý den'
  return [...dny].sort((a, b) => a - b).map((d) => DNY_ZKRATKY_ISO[d - 1] ?? String(d)).join(', ')
}
