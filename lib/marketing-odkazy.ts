/**
 * Měřitelné odkazy — krátký klíč, UTM a QR.
 *
 * Zadání: master prompt, oddíl 18 („Generuj UTM parametry a volitelný
 * QR kód pro objednávku, rezervaci nebo konkrétní akci") a oddíl 17.
 *
 * ---------------------------------------------------------------------
 * PROČ VLASTNÍ ODKAZ A NE JEN UTM
 *
 * UTM se dá přilepit na cíl rovnou. Jenže pak se proklik počítá až na
 * cizí straně — v Google Analytics restaurace, kterou nemá. Krátký
 * odkaz přes nás je jediné, co umíme změřit SAMI, bez připojení na
 * cokoli.
 *
 * A ještě něco: UTM v adrese je vidět. „?utm_source=instagram
 * &utm_medium=social&utm_campaign=zabijacka" na plakátu nikdo neopíše
 * a v příspěvku to vypadá jako spam.
 */

/**
 * Znaky, ze kterých se skládá klíč.
 *
 * VYNECHÁVAJÍ SE `0`, `o`, `1`, `l` a `i`. Klíč se opisuje z plakátu
 * a z QR kódu, který se nenačetl — a nula od „o" se v běžném písmu
 * nepozná. Je to totéž rozhodnutí jako u registračního kódu tabletu.
 */
const ZNAKY = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Délka klíče. Osm znaků z 31 možností je 31^8, tedy dost. */
export const DELKA_KLICE = 8

/**
 * Nový klíč.
 *
 * `crypto.getRandomValues`, ne `Math.random()`. Klíč sice není
 * tajemství — kdo ho uhodne, dostane se na veřejnou stránku —, ale
 * uhodnutelné klíče by dovolily zkoušet, co která restaurace chystá.
 */
export function novyKlic(nahodne: (n: number) => Uint8Array = bezpecneBajty): string {
  const bajty = nahodne(DELKA_KLICE)
  let klic = ''
  for (let i = 0; i < DELKA_KLICE; i++) {
    /*
      MODULO JE TU MÍRNĚ NEROVNOMĚRNÉ a je to vědomé: 256 není dělitelné
      31, takže prvních devět znaků abecedy vychází o kousek častěji.
      U klíče, který není tajemství, je to bez následků — a odmítání
      bajtů nad hranicí by přineslo smyčku, která se za nepříznivých
      okolností protáhne.
    */
    klic += ZNAKY[bajty[i] % ZNAKY.length]
  }
  return klic
}

function bezpecneBajty(n: number): Uint8Array {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

/** Sedí klíč na to, co dovolí databáze (`^[a-z0-9]{6,16}$`)? */
export function klicJePlatny(klic: string): boolean {
  return /^[a-z0-9]{6,16}$/.test(klic)
}

/**
 * Cíl se před uložením zkontroluje.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TO HLÍDÁ, KDYŽ TO HLÍDÁ I DATABÁZE
 *
 * Omezení sloupce pustí cokoli, co začíná `http://` nebo `https://`.
 * To je správně jako poslední linie, ale pro člověka je to pozdě:
 * chybu uvidí až jako hlášku z databáze.
 *
 * A hlavně — `javascript:` sice omezení nepustí, ale `https://` s
 * nesmyslem za ním ano. Tady se to řekne česky a hned.
 */
export function zkontrolovatCil(cil: string): { stav: 'ok'; cil: string } | { stav: 'chyba'; duvod: string } {
  const text = cil.trim()

  if (text === '') {
    return { stav: 'chyba', duvod: 'Vyplňte, kam má odkaz vést.' }
  }

  let adresa: URL
  try {
    adresa = new URL(text)
  } catch {
    return {
      stav: 'chyba',
      duvod: 'To není platná adresa. Musí začínat https:// — třeba https://cernaperla.cz/rezervace.',
    }
  }

  /*
    JEN `http` A `https`.

    `javascript:`, `data:` a `file:` se do odkazu, který někdo otevře
    z telefonu, nedostanou. Omezení sloupce je zachytí taky, ale tohle
    je první linie a mluví česky.
  */
  if (adresa.protocol !== 'https:' && adresa.protocol !== 'http:') {
    return { stav: 'chyba', duvod: 'Odkaz musí začínat https:// nebo http://.' }
  }

  if (!adresa.hostname.includes('.')) {
    return { stav: 'chyba', duvod: 'V adrese chybí doména — třeba cernaperla.cz.' }
  }

  return { stav: 'ok', cil: adresa.toString() }
}

/**
 * Doporučené UTM podle toho, kam příspěvek jde.
 *
 * ---------------------------------------------------------------------
 * ZVYKLOSTI, NE PRAVIDLA
 *
 * `utm_source` je odkud návštěvník přišel (instagram, facebook),
 * `utm_medium` jakým způsobem (social), `utm_campaign` která akce.
 * Není to norma, je to zvyk — a nástroje, které to čtou, ho očekávají.
 *
 * Malá písmena a bez diakritiky schválně: nástroje rozlišují velikost
 * a „Zabijačka" by se od „zabijacka" počítalo zvlášť.
 */
export function doporuceneUtm(vstup: {
  kanal?: string
  kampan?: string
}): { utm_source: string; utm_medium: string; utm_campaign: string } {
  return {
    utm_source: bezDiakritiky(vstup.kanal ?? 'foodtab'),
    utm_medium: 'social',
    utm_campaign: bezDiakritiky(vstup.kampan ?? ''),
  }
}

/**
 * „Zabijačka u Perly!" → „zabijacka-u-perly"
 *
 * Diakritika se rozkládá přes `normalize('NFD')` a pak se zahodí
 * doplňkové znaky. Ručně psaná tabulka náhrad by chyběla u prvního
 * písmene, na které se zapomene.
 */
export function bezDiakritiky(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Celá adresa krátkého odkazu. */
export function adresaOdkazu(zaklad: string, klic: string): string {
  return `${zaklad.replace(/\/+$/, '')}/k/${klic}`
}

/**
 * Ukazatele, které se dají zobrazit.
 *
 * ---------------------------------------------------------------------
 * NULA NENÍ TOTÉŽ CO NEZMĚŘENO
 *
 * Zadání, oddíl 18: „Zobraz pouze metriky, které daná síť a oprávnění
 * skutečně poskytují." Prázdná hodnota se proto nekreslí jako nula,
 * ale jako pomlčka — a u čísla je vidět, odkud je.
 */
export const UKAZATELE = [
  { klic: 'zobrazeni', nazev: 'Zobrazení' },
  { klic: 'dosah', nazev: 'Dosah' },
  { klic: 'prehrani', nazev: 'Přehrání' },
  { klic: 'doba_sledovani_s', nazev: 'Doba sledování' },
  { klic: 'reakce', nazev: 'Reakce' },
  { klic: 'komentare', nazev: 'Komentáře' },
  { klic: 'sdileni', nazev: 'Sdílení' },
  { klic: 'ulozeni', nazev: 'Uložení' },
  { klic: 'kliknuti', nazev: 'Kliknutí' },
  { klic: 'noví_sledujici', nazev: 'Noví sledující' },
] as const

export function popisUkazatele(klic: string): string {
  return UKAZATELE.find((u) => u.klic === klic)?.nazev ?? klic
}

/** „—" u neměřeného, číslo u změřeného. Nikdy nula místo prázdna. */
export function hodnotaNaObrazovku(hodnota: number | null | undefined): string {
  if (hodnota === null || hodnota === undefined) return '—'
  return new Intl.NumberFormat('cs-CZ').format(hodnota)
}

/**
 * Věta o tom, odkud číslo je.
 *
 * `odhad` se říká NAHLAS. Zadání: „Pokud není možné prokázat přímou
 * atribuci, označ výsledek jako odhad a nepředstírej přesnost."
 */
export function popisZdroje(zdroj: string): string {
  if (zdroj === 'sit') return 'ze sítě'
  if (zdroj === 'vlastni') return 'změřeno u nás'
  if (zdroj === 'odhad') return 'ODHAD — nepřesné'
  return zdroj
}
