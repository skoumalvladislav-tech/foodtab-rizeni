import { klicDb, normalizovat } from './tabulka.ts'
import { nazevUvazku, uvazekZTextu, type Uvazek } from './uvazky.ts'

/**
 * Co se z nahrané tabulky stane — spočítané dopředu, beze změny dat.
 *
 * Tenhle soubor nesmí sáhnout na databázi. Náhled i vlastní zápis
 * počítají plán touhle jednou funkcí, takže se nemůže stát, že náhled
 * slíbí něco jiného, než se pak uloží. Zadání to žádá výslovně:
 * „Krok 4 se nevynechává ani když je to jasné.“
 *
 * Pravidlo pro celou tabulku (oddíl A): najdi podle klíče, aktualizuj;
 * když není, založ. Nikdy „smaž všechno a nahraj znovu“ — u lidí by to
 * zabilo docházku.
 *
 * A pravidlo pro cokoli nepochopeného (oddíl B): čemu aplikace
 * nerozumí, to nenahraje a vypíše. Nikdy si význam nedomýšlet.
 */

/** Sloupec, který import umí použít. */
export type Klic = 'jmeno' | 'pobocka' | 'pozice' | 'typ'

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
    napoveda: 'Podle jména se člověk pozná. Bez něj řádek nahrát nejde.',
    povinne: true,
    synonyma: [
      'jmeno',
      'jmeno a prijmeni',
      'prijmeni a jmeno',
      'cele jmeno',
      'zamestnanec',
      'pracovnik',
      'osoba',
      'name',
      'full name',
      'employee',
    ],
  },
  {
    klic: 'pobocka',
    nazev: 'Pobočka',
    napoveda: 'Musí už existovat. Pobočky import nezakládá.',
    povinne: false,
    synonyma: ['pobocka', 'provozovna', 'podnik', 'restaurace', 'pracoviste', 'branch'],
  },
  {
    klic: 'pozice',
    nazev: 'Pozice',
    napoveda: 'Čím ten člověk je. Co ve firmě zatím není, se založí.',
    povinne: false,
    synonyma: ['pozice', 'funkce', 'position', 'job'],
  },
  {
    klic: 'typ',
    nazev: 'Typ pracovního poměru',
    napoveda: 'HPP, DPP, DPČ, IČO. Co aplikace nepozná, uloží jako Jiné.',
    povinne: false,
    synonyma: [
      'typ uvazku',
      'uvazek',
      'typ pracovniho pomeru',
      'pracovni pomer',
      'typ smlouvy',
      'smlouva',
      'pomer',
      'typ',
    ],
  },
]

/** Které pole je ve kterém sloupci. Nepřiřazené pole tu není. */
export type Mapovani = Partial<Record<Klic, number>>

export type Zdroje = {
  lide: {
    id: string
    full_name: string
    branch_id: string | null
    position_id: string | null
    employment_type: string
  }[]
  pobocky: { id: string; name: string; slug: string }[]
  pozice: { id: string; label: string; active: boolean }[]
}

export type Zmena = { pole: string; z: string; na: string }

export type Zaznam = {
  /** Číslo řádku v souboru, jak ho vidí člověk v Excelu (záhlaví = 1). */
  cislo: number
  jmeno: string
  co: 'zalozit' | 'aktualizovat' | 'beze_zmeny' | 'preskocit'
  duvod?: string
  /** Id existujícího člověka, když se aktualizuje. */
  id?: string
  zmeny: Zmena[]
  /** Co aplikace nepoznala a jak s tím naložila. Píše se do náhledu. */
  poznamky: string[]
  /** Hodnoty k zápisu. Chybějící pole se nemění. */
  zapis: {
    full_name?: string
    branch_id?: string | null
    position_id?: string | null
    employment_type?: string
    /** Název pozice, která ve firmě ještě není a musí se založit. */
    novaPozice?: string
  }
}

export type Plan = {
  zaznamy: Zaznam[]
  zalozit: number
  aktualizovat: number
  bezeZmeny: number
  preskocit: number
  /** Názvy pozic, které se při potvrzení založí. */
  novePozice: string[]
}

/**
 * Nejvyšší počet řádků v jednom nahrání.
 *
 * Není to omezení podle zadání, je to pojistka: náhled i zápis běží
 * v jednom požadavku a při deseti tisících řádcích by vypršel časový
 * limit uprostřed zápisu. Radši se to odmítne předem a řekne proč, než
 * aby zůstala půlka lidí uvnitř a půlka venku.
 */
export const NEJVIC_RADKU = 1000

/**
 * Co si aplikace myslí, že je ve kterém sloupci.
 *
 * Jen návrh — člověk ho v dalším kroku opravuje. Přesná shoda má
 * přednost před částečnou, aby „Jméno“ vyhrálo nad „Jméno pobočky“.
 * Jeden sloupec se přiřadí nejvýš jednou.
 */
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
  zkus(sklonovane)
  return m
}

/**
 * Poslední pokus: čeština skloňuje.
 *
 * V záhlaví bývá „Jméno pobočky“, ne „Pobočka“. Porovnává se proto
 * začátek slova — shoda na pěti písmenech stačí, kratší ne. „Poboč“
 * sedí na „pobočka“ i „pobočky“, „poz“ by sedělo i na „pozvánka“.
 *
 * Běží až po přesných shodách, takže „Jméno“ vedle „Jména pobočky“
 * pořád vyhraje jako jméno.
 */
function sklonovane(nazev: string, synonymum: string): boolean {
  const slova = nazev.split(' ')
  return synonymum
    .split(' ')
    .every((cast) =>
      slova.some((slovo) => {
        const n = Math.min(slovo.length, cast.length)
        return n >= 5 && slovo.slice(0, n - 1) === cast.slice(0, n - 1)
      }),
    )
}

/** Sestaví plán. Nesahá na databázi — dostane hotový obraz dat. */
export function sestavPlan(
  radky: string[][],
  mapovani: Mapovani,
  zdroje: Zdroje,
): Plan {
  const sloupecJmena = mapovani.jmeno

  const podleJmena = new Map<string, Zdroje['lide'][number]>()
  for (const c of zdroje.lide) podleJmena.set(klicDb(c.full_name), c)

  const pobockaPodle = new Map<string, Zdroje['pobocky'][number]>()
  for (const p of zdroje.pobocky) {
    pobockaPodle.set(klicDb(p.name), p)
    pobockaPodle.set(klicDb(p.slug), p)
  }

  const pozicePodle = new Map<string, Zdroje['pozice'][number]>()
  for (const p of zdroje.pozice) pozicePodle.set(klicDb(p.label), p)

  // Jména už použitá v tomhle souboru — druhý výskyt se nenahraje.
  const vSouboru = new Map<string, number>()
  // Nové pozice se zakládají jednou, i když je má deset lidí.
  const novePozice = new Map<string, string>()

  const zaznamy: Zaznam[] = []

  radky.forEach((radek, i) => {
    const cislo = i + 2 // +1 za záhlaví, +1 protože Excel počítá od jedné
    const bunka = (klic: Klic): string => {
      const s = mapovani[klic]
      return s === undefined ? '' : (radek[s] ?? '').trim()
    }

    const jmeno = sloupecJmena === undefined ? '' : bunka('jmeno')
    const zaznam: Zaznam = { cislo, jmeno, co: 'preskocit', zmeny: [], poznamky: [], zapis: {} }

    if (!jmeno) {
      zaznam.duvod = 'prázdné jméno'
      zaznamy.push(zaznam)
      return
    }

    const klic = klicDb(jmeno)
    const drive = vSouboru.get(klic)
    if (drive !== undefined) {
      zaznam.duvod = `stejné jméno je už na řádku ${drive}`
      zaznamy.push(zaznam)
      return
    }
    vSouboru.set(klic, cislo)

    const stavajici = podleJmena.get(klic)

    /* --- pobočka --- */
    let pobockaId: string | null | undefined
    const pobockaText = bunka('pobocka')
    if (pobockaText) {
      const p = pobockaPodle.get(klicDb(pobockaText))
      if (!p) {
        zaznam.duvod = `pobočku „${pobockaText}“ neznám`
        zaznamy.push(zaznam)
        return
      }
      pobockaId = p.id
      if (stavajici && stavajici.branch_id !== p.id) {
        zaznam.zmeny.push({
          pole: 'Pobočka',
          z: nazevPobocky(zdroje, stavajici.branch_id),
          na: p.name,
        })
      }
    }

    /* --- pozice --- */
    let poziceId: string | null | undefined
    let novaPozice: string | undefined
    const poziceText = bunka('pozice')
    if (poziceText) {
      const p = pozicePodle.get(klicDb(poziceText))
      if (p) {
        poziceId = p.id
        if (!p.active) {
          zaznam.poznamky.push(`pozice ${p.label} je vyřazená z nabídky, přiřadí se i tak`)
        }
        if (stavajici && stavajici.position_id !== p.id) {
          zaznam.zmeny.push({
            pole: 'Pozice',
            z: nazevPozice(zdroje, stavajici.position_id),
            na: p.label,
          })
        }
      } else {
        novaPozice = poziceText
        if (!novePozice.has(klicDb(poziceText))) {
          novePozice.set(klicDb(poziceText), poziceText)
        }
        zaznam.poznamky.push(`pozice ${poziceText} ve firmě zatím není, založí se`)
        if (stavajici) {
          zaznam.zmeny.push({
            pole: 'Pozice',
            z: nazevPozice(zdroje, stavajici.position_id),
            na: poziceText,
          })
        }
      }
    }

    /* --- typ pracovního poměru --- */
    let typ: Uvazek['kod'] | undefined
    const typText = bunka('typ')
    if (typText) {
      const poznany = uvazekZTextu(typText)
      if (poznany) {
        typ = poznany
      } else {
        // Zadání: čemu aplikace nerozumí, to si nedomýšlí. „Jiné“ je
        // vlastní kolonka aplikace pro „nic z toho“, ne odhad — a v
        // náhledu je vidět, čeho se to týká.
        typ = 'jine'
        zaznam.poznamky.push(`typ „${typText}“ neznám, uloží se jako Jiné`)
      }
      if (stavajici && stavajici.employment_type !== typ) {
        zaznam.zmeny.push({
          pole: 'Typ poměru',
          z: nazevUvazku(stavajici.employment_type),
          na: nazevUvazku(typ),
        })
      }
    }

    if (stavajici) {
      zaznam.id = stavajici.id
      zaznam.co = zaznam.zmeny.length > 0 ? 'aktualizovat' : 'beze_zmeny'
      // Prázdná buňka nemaže. Tabulka bez sloupce Pozice nesmí sebrat
      // pozici všem, kdo ji mají.
      if (pobockaId !== undefined) zaznam.zapis.branch_id = pobockaId
      if (poziceId !== undefined) zaznam.zapis.position_id = poziceId
      if (novaPozice !== undefined) zaznam.zapis.novaPozice = novaPozice
      if (typ !== undefined) zaznam.zapis.employment_type = typ
    } else {
      zaznam.co = 'zalozit'
      zaznam.zapis.full_name = jmeno
      zaznam.zapis.branch_id = pobockaId ?? null
      zaznam.zapis.position_id = poziceId ?? null
      if (novaPozice !== undefined) zaznam.zapis.novaPozice = novaPozice
      // Bez sloupce s poměrem se nezakládá „hlavní pracovní poměr“ —
      // to by byl odhad. Zakládá se Jiné a je to vidět v náhledu.
      zaznam.zapis.employment_type = typ ?? 'jine'
      if (typ === undefined) {
        zaznam.poznamky.push('typ poměru v tabulce není, uloží se jako Jiné')
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
    novePozice: [...novePozice.values()],
  }
}

function nazevPobocky(zdroje: Zdroje, id: string | null): string {
  if (!id) return 'nevyplněno'
  return zdroje.pobocky.find((p) => p.id === id)?.name ?? 'nevyplněno'
}

function nazevPozice(zdroje: Zdroje, id: string | null): string {
  if (!id) return 'nevyplněno'
  return zdroje.pozice.find((p) => p.id === id)?.label ?? 'nevyplněno'
}
