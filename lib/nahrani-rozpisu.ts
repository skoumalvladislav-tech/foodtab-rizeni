import { klicDb, normalizovat } from './tabulka.ts'
import { datumZTextu } from './nahrani-lidi.ts'

/**
 * Co se z nahrané tabulky rozpisu stane — spočítané dopředu, beze změny dat.
 *
 * Zadání docs/nahravani-dat-zadani.md, oddíl B + D3 („Nahrání rozpisu
 * z tabulky. Návrh existuje, slovník značek do dat.“). Stejná stavba
 * jako lib/nahrani-lidi.ts — náhled i zápis počítají plán touž funkcí,
 * takže se nemůže stát, že náhled slíbí něco jiného, než se pak uloží.
 *
 * ROZSAH TÉHLE VERZE: sloupce s časem (Začátek/Konec), ne značky jako
 * „R“/„O“/„X“. Slovník značek (oddíl B) potřebuje sloupec `code`
 * v `shift_templates` — to je migrace, kterou tahle relace smí napsat,
 * ale ne nasadit (docs/pracovni-rezim-codea.md). Až bude nasazená,
 * přibude volitelné mapování „Kód“ vedle Začátku/Konce, beze změny
 * téhle logiky. Restaurace, které vedou rozpis přímo v časech (většina
 * exportů z Excelu), touhle verzí projdou beze zbytku.
 *
 * Rozpoznávací klíč (oddíl A): člověk + datum + pobočka. `shifts` na
 * něj nemá `unique` (na rozdíl od `employees.full_name`) — párování se
 * proto děje v aplikaci nad obrazem existujících směn z databáze,
 * stejně jako u lidí. Import lidi NEZAKLÁDÁ: jméno, které se nenajde
 * mezi zaměstnanci, se přeskočí a je to vidět v náhledu — přiřazení
 * dělá `nahrani-lidi.ts`, tenhle soubor na to jen navazuje.
 */

export type Klic = 'jmeno' | 'pobocka' | 'datum' | 'zacatek' | 'konec'

export const POLE: {
  klic: Klic
  nazev: string
  napoveda: string
  povinne: boolean
  synonyma: string[]
}[] = [
  {
    klic: 'jmeno',
    nazev: 'Jméno',
    napoveda: 'Musí sedět na existujícího zaměstnance — import lidi nezakládá.',
    povinne: true,
    synonyma: [
      'jmeno', 'jmeno a prijmeni', 'prijmeni a jmeno', 'cele jmeno',
      'zamestnanec', 'pracovnik', 'osoba', 'name', 'employee',
    ],
  },
  {
    klic: 'pobocka',
    nazev: 'Pobočka',
    napoveda: 'Bez sloupce se použije pobočka, na které rozpis nahráváte.',
    povinne: false,
    synonyma: ['pobocka', 'provozovna', 'podnik', 'restaurace', 'pracoviste', 'branch'],
  },
  {
    klic: 'datum',
    nazev: 'Datum',
    napoveda: 'Datum směny: 1.9.2026 nebo 2026-09-01.',
    povinne: true,
    synonyma: ['datum', 'den', 'date', 'smena', 'day'],
  },
  {
    klic: 'zacatek',
    nazev: 'Začátek',
    napoveda: 'Kdy směna začíná: 10:00 nebo 10.00.',
    povinne: true,
    synonyma: ['zacatek', 'od', 'start', 'prichod', 'zacatek smeny'],
  },
  {
    klic: 'konec',
    nazev: 'Konec',
    napoveda: 'Kdy směna končí.',
    povinne: true,
    synonyma: ['konec', 'do', 'end', 'odchod', 'konec smeny'],
  },
]

/**
 * Čas z buňky na „HH:MM“.
 *
 * Bere se, co je jednoznačné: „10:00“, „10.00“, „1000“ (čtyři číslice
 * beze značky), „10“ (jen hodina). Excel čas občas uloží jako desetinné
 * číslo dne (0,4166… = 10:00) — to se pozná podle tvaru „0,xxx“/„0.xxx“
 * a přepočítá. Cokoli jiného se nedomýšlí.
 */
export function casZTextu(text: string): string | null {
  const t = text.trim()
  if (!t) return null

  const zlomek = t.match(/^0?[.,](\d+)$/)
  if (zlomek) {
    const podil = Number(`0.${zlomek[1]}`)
    if (podil >= 0 && podil < 1) {
      const minutCelkem = Math.round(podil * 24 * 60)
      const h = Math.floor(minutCelkem / 60)
      const m = minutCelkem % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }

  const sDvojteckou = t.match(/^(\d{1,2})[:.](\d{2})$/)
  if (sDvojteckou) {
    const h = Number(sDvojteckou[1])
    const m = Number(sDvojteckou[2])
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    return null
  }

  const ctyriCislice = t.match(/^(\d{2})(\d{2})$/)
  if (ctyriCislice) {
    const h = Number(ctyriCislice[1])
    const m = Number(ctyriCislice[2])
    if (h <= 23 && m <= 59) return `${ctyriCislice[1]}:${ctyriCislice[2]}`
    return null
  }

  const jenHodina = t.match(/^(\d{1,2})\s*h?$/i)
  if (jenHodina) {
    const h = Number(jenHodina[1])
    if (h <= 23) return `${String(h).padStart(2, '0')}:00`
  }

  return null
}

/** Které pole je ve kterém sloupci. Nepřiřazené pole tu není. */
export type Mapovani = Partial<Record<Klic, number>>

export type Zdroje = {
  lide: { id: string; full_name: string }[]
  pobocky: { id: string; name: string; slug: string }[]
  /** Existující směny v dosahu — jen ty, na které tabulka může narazit. */
  smeny: {
    id: string
    employee_id: string | null
    branch_id: string
    shift_date: string
    starts_at: string
    ends_at: string
  }[]
}

export type Zmena = { pole: string; z: string; na: string }

export type Zaznam = {
  /** Číslo řádku v souboru, jak ho vidí člověk v Excelu (záhlaví = 1). */
  cislo: number
  jmeno: string
  co: 'zalozit' | 'aktualizovat' | 'beze_zmeny' | 'preskocit'
  duvod?: string
  /** Id existující směny, když se aktualizuje. */
  id?: string
  zmeny: Zmena[]
  poznamky: string[]
  zapis: {
    employee_id?: string
    branch_id?: string
    shift_date?: string
    starts_at?: string
    ends_at?: string
  }
}

export type Plan = {
  zaznamy: Zaznam[]
  zalozit: number
  aktualizovat: number
  bezeZmeny: number
  preskocit: number
}

/**
 * Nejvyšší počet řádků v jednom nahrání — stejná pojistka jako u lidí
 * (viz lib/nahrani-lidi.ts): náhled i zápis běží v jednom požadavku.
 */
export const NEJVIC_RADKU = 1000

/** Co si aplikace myslí, že je ve kterém sloupci. Jen návrh. */
export function odhadnoutMapovani(hlavicka: string[]): Mapovani {
  const nazvy = hlavicka.map(normalizovat)
  const obsazene = new Set<number>()
  const m: Mapovani = {}

  const zkus = (test: (nazev: string, synonymum: string) => boolean) => {
    for (const pole of POLE) {
      if (m[pole.klic] !== undefined) continue
      for (let i = 0; i < nazvy.length; i++) {
        if (obsazene.has(i) || !nazvy[i]) continue
        if (pole.synonyma.some((s) => test(nazvy[i], s))) {
          m[pole.klic] = i
          obsazene.add(i)
          break
        }
      }
    }
  }

  zkus((nazev, s) => nazev === s)
  zkus((nazev, s) => nazev.startsWith(s + ' ') || nazev.endsWith(' ' + s))
  zkus((nazev, s) => s.length >= 4 && nazev.includes(s))
  return m
}

/**
 * Sestaví plán. Nesahá na databázi — dostane hotový obraz dat.
 *
 * `vychoziPobocka` je pobočka, na které se rozpis nahrává (z rozsahu
 * obrazovky). Použije se, když tabulka sloupec Pobočka nemá vůbec —
 * s ním se pobočka bere z tabulky, i kdyby byl jen jeden řádek jiný.
 */
export function sestavPlan(
  radky: string[][],
  mapovani: Mapovani,
  zdroje: Zdroje,
  vychoziPobocka: string | null,
): Plan {
  const podleJmena = new Map<string, Zdroje['lide'][number]>()
  for (const c of zdroje.lide) podleJmena.set(klicDb(c.full_name), c)

  const pobockaPodle = new Map<string, Zdroje['pobocky'][number]>()
  for (const p of zdroje.pobocky) {
    pobockaPodle.set(klicDb(p.name), p)
    pobockaPodle.set(klicDb(p.slug), p)
  }

  // Existující směny podle klíče člověk|datum|pobočka (oddíl A).
  const smenaPodleKlice = new Map<string, Zdroje['smeny'][number]>()
  for (const s of zdroje.smeny) {
    if (!s.employee_id) continue
    smenaPodleKlice.set(`${s.employee_id}|${s.shift_date}|${s.branch_id}`, s)
  }

  // Stejný klíč použitý dvakrát v TOMHLE souboru — druhý výskyt by
  // přepsal první, aniž by o sobě věděly. Radši se přeskočí a je vidět
  // proč, než aby zmizel dělený úvazek na dvě směny.
  const vSouboru = new Map<string, number>()

  const zaznamy: Zaznam[] = []

  radky.forEach((radek, i) => {
    const cislo = i + 2
    const bunka = (klic: Klic): string => {
      const s = mapovani[klic]
      return s === undefined ? '' : (radek[s] ?? '').trim()
    }

    const jmeno = bunka('jmeno')
    const zaznam: Zaznam = { cislo, jmeno, co: 'preskocit', zmeny: [], poznamky: [], zapis: {} }

    if (!jmeno) {
      zaznam.duvod = 'prázdné jméno'
      zaznamy.push(zaznam)
      return
    }

    const clovek = podleJmena.get(klicDb(jmeno))
    if (!clovek) {
      zaznam.duvod = `zaměstnance „${jmeno}“ neznám — import lidi nezakládá`
      zaznamy.push(zaznam)
      return
    }

    let pobockaId: string | null = vychoziPobocka
    const pobockaText = bunka('pobocka')
    if (pobockaText) {
      const p = pobockaPodle.get(klicDb(pobockaText))
      if (!p) {
        zaznam.duvod = `pobočku „${pobockaText}“ neznám`
        zaznamy.push(zaznam)
        return
      }
      pobockaId = p.id
    }
    if (!pobockaId) {
      zaznam.duvod = 'chybí pobočka — sloupec v tabulce ani rozsah obrazovky ji neurčuje'
      zaznamy.push(zaznam)
      return
    }

    const datumText = bunka('datum')
    const datum = datumZTextu(datumText)
    if (!datum) {
      zaznam.duvod = datumText ? `datum „${datumText}“ neznám` : 'chybí datum'
      zaznamy.push(zaznam)
      return
    }

    const zacatekText = bunka('zacatek')
    const zacatek = casZTextu(zacatekText)
    if (!zacatek) {
      zaznam.duvod = zacatekText ? `začátek „${zacatekText}“ neznám` : 'chybí začátek'
      zaznamy.push(zaznam)
      return
    }

    const konecText = bunka('konec')
    const konec = casZTextu(konecText)
    if (!konec) {
      zaznam.duvod = konecText ? `konec „${konecText}“ neznám` : 'chybí konec'
      zaznamy.push(zaznam)
      return
    }

    const klic = `${clovek.id}|${datum}|${pobockaId}`
    const drive = vSouboru.get(klic)
    if (drive !== undefined) {
      zaznam.duvod = `stejný člověk, datum a pobočka je už na řádku ${drive} — dělenou směnu import zatím neumí`
      zaznamy.push(zaznam)
      return
    }
    vSouboru.set(klic, cislo)

    const stavajici = smenaPodleKlice.get(klic)

    if (stavajici) {
      zaznam.id = stavajici.id
      const zmeny: Zmena[] = []
      if (stavajici.starts_at.slice(0, 5) !== zacatek) {
        zmeny.push({ pole: 'Začátek', z: stavajici.starts_at.slice(0, 5), na: zacatek })
      }
      if (stavajici.ends_at.slice(0, 5) !== konec) {
        zmeny.push({ pole: 'Konec', z: stavajici.ends_at.slice(0, 5), na: konec })
      }
      zaznam.zmeny = zmeny
      zaznam.co = zmeny.length > 0 ? 'aktualizovat' : 'beze_zmeny'
      zaznam.zapis = { starts_at: `${zacatek}:00`, ends_at: `${konec}:00` }
    } else {
      zaznam.co = 'zalozit'
      zaznam.zapis = {
        employee_id: clovek.id,
        branch_id: pobockaId,
        shift_date: datum,
        starts_at: `${zacatek}:00`,
        ends_at: `${konec}:00`,
      }
    }

    zaznamy.push(zaznam)
  })

  return {
    zaznamy,
    zalozit: zaznamy.filter((z) => z.co === 'zalozit').length,
    aktualizovat: zaznamy.filter((z) => z.co === 'aktualizovat').length,
    bezeZmeny: zaznamy.filter((z) => z.co === 'beze_zmeny').length,
    preskocit: zaznamy.filter((z) => z.co === 'preskocit').length,
  }
}
