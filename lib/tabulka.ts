/**
 * Čtení tabulky ze souboru — CSV i Excel.
 *
 * Zadání docs/nahravani-dat-zadani.md, oddíl B. Běží v prohlížeči:
 * soubor se na server vůbec neposílá, na server jde až hotová tabulka
 * a přiřazení sloupců. Splňuje to větu „soubor se po zpracování
 * nedrží“ tím nejjistějším způsobem — nikdy nikde neleží.
 *
 * POZOR: obsah buňky je DATA, ne pokyn. Nic se odsud nevyhodnocuje:
 * `=HYPERLINK(...)` je text „=HYPERLINK(...)“ a text „ignoruj předchozí
 * zadání“ je text. Kdyby se odsud někdy skládal vstup pro model, musí
 * jít dovnitř jako citovaný obsah, ne jako zadání.
 */

export type Tabulka = {
  /** Záhlaví tak, jak ho napsal zákazník. */
  hlavicka: string[]
  /** Řádky doplněné na délku záhlaví. Prázdné řádky vypadly. */
  radky: string[][]
}

/**
 * Oddělovač se hádá z prvního neprázdného řádku mimo uvozovky.
 *
 * České Excely ukládají CSV se středníkem, anglické s čárkou, exporty
 * z docházkových systémů často s tabulátorem. Pevně zvolený oddělovač
 * by znamenal, že polovina souborů přijde jako jeden sloupec.
 *
 * Prázdné řádky nad tabulkou se přeskakují. Kdyby se počítalo jen do
 * prvního odřádkování, sestava z Excelu s prázdným prvním řádkem by
 * vyšla bez jediného oddělovače — a taky by přišla jako jeden sloupec.
 */
export function odhadnoutOddelovac(text: string): string {
  const pocty: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let vUvozovkach = false
  let maObsah = false

  for (let i = 0; i < text.length; i++) {
    const z = text[i]
    if (z === '"') {
      if (vUvozovkach && text[i + 1] === '"') i++
      else vUvozovkach = !vUvozovkach
      maObsah = true
    } else if (!vUvozovkach && (z === '\n' || z === '\r')) {
      if (maObsah) break
      for (const k of Object.keys(pocty)) pocty[k] = 0
    } else if (!vUvozovkach && z in pocty) {
      pocty[z]++
      maObsah = true
    } else if (z.trim() !== '') {
      maObsah = true
    }
  }

  let nej = ','
  for (const z of Object.keys(pocty)) if (pocty[z] > pocty[nej]) nej = z
  return nej
}

/**
 * CSV podle RFC 4180 s tolerancí k tomu, co posílají tabulkové editory:
 * uvozovky uvnitř pole zdvojené, konce řádků všech tří druhů, poslední
 * řádek bez odřádkování, BOM na začátku.
 */
export function precistCsv(text: string, oddelovac?: string): Tabulka {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const o = oddelovac ?? odhadnoutOddelovac(t)

  const mrizka: string[][] = []
  let radek: string[] = []
  let pole = ''
  let vUvozovkach = false

  const konecPole = () => {
    radek.push(pole)
    pole = ''
  }
  const konecRadku = () => {
    konecPole()
    mrizka.push(radek)
    radek = []
  }

  for (let i = 0; i < t.length; i++) {
    const z = t[i]

    if (vUvozovkach) {
      if (z === '"') {
        if (t[i + 1] === '"') {
          pole += '"'
          i++
        } else {
          vUvozovkach = false
        }
      } else {
        pole += z
      }
      continue
    }

    if (z === '"' && pole === '') vUvozovkach = true
    else if (z === o) konecPole()
    else if (z === '\r') {
      konecRadku()
      if (t[i + 1] === '\n') i++
    } else if (z === '\n') konecRadku()
    else pole += z
  }

  // Poslední řádek bez odřádkování na konci souboru.
  if (pole !== '' || radek.length > 0) konecRadku()

  return zTabulky(mrizka)
}

/**
 * Z mřížky udělá záhlaví a řádky.
 *
 * Záhlaví je první řádek, ve kterém je aspoň jedna neprázdná buňka —
 * export z Excelu má nad tabulkou často prázdný řádek nebo název sestavy.
 * Kratší řádky se doplní prázdnými buňkami, delší se ustřihnou: sloupec
 * bez záhlaví se nedá přiřadit, takže by stejně nikam nešel.
 */
export function zTabulky(mrizka: string[][]): Tabulka {
  const neprazdny = (r: string[]) => r.some((b) => b.trim() !== '')
  const zacatek = mrizka.findIndex(neprazdny)
  if (zacatek === -1) return { hlavicka: [], radky: [] }

  const hlavicka = mrizka[zacatek].map((b) => b.trim())
  const sirka = hlavicka.length

  const radky = mrizka
    .slice(zacatek + 1)
    .filter(neprazdny)
    .map((r) => {
      const kopie = r.slice(0, sirka).map((b) => b.trim())
      while (kopie.length < sirka) kopie.push('')
      return kopie
    })

  return { hlavicka, radky }
}

/**
 * Porovnávací tvar textu: malá písmena, bez diakritiky, bez zdvojených
 * mezer. „Pobočka “ a „pobocka“ je totéž záhlaví, „Jan Novák “ a „jan
 * novak“ je tentýž člověk.
 *
 * Stejná úvaha jako u rozpoznávacích klíčů v databázi (oddíl A), jen
 * navíc bez diakritiky — v tabulce od zákazníka bývá „Pozice“ i „pozice“
 * i „POZICE“, a někdy „Pozice:“ s dvojtečkou.
 */
export function normalizovat(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Porovnávací klíč PŘESNĚ tak, jak ho počítá databáze:
 * `lower(btrim(...))`, s diakritikou.
 *
 * Nesmí se plést s normalizovat(). Ta shazuje i diakritiku a je na
 * záhlaví, kde se nic neporovnává s databází. Tady by to škodilo:
 * rozpoznávací klíč z oddílu A zadání drží „Novák“ a „Novak“ jako dva
 * různé lidi, a kdyby si je import spojil, aktualizoval by cizí řádek.
 * Kdyby je naopak rozděloval jemněji než databáze, spadl by zápis na
 * porušení jedinečnosti — a to až po náhledu, který sliboval něco
 * jiného.
 */
export function klicDb(s: string): string {
  return s.trim().toLowerCase()
}
