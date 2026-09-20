/**
 * Čistá logika desktopového rozpisu směn — žádný React, žádná databáze.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEBYDLÍ V KOMPONENTĚ
 *
 * Desktop je manažerská pracovní plocha: hledání, filtry, seskupení
 * podle poboček a úseků, součty hodin, stav vydání a rozdíl proti
 * vydanému rozpisu. Všechno, co se dá spočítat bez prohlížeče, je
 * tady a zkouší se Nodem (scripts/rozpis-desktop.test.mjs). Úvaha
 * zavřená uvnitř komponenty se nedá spustit — a stavy „nevydáno“
 * a „změněno po vydání“ jsou přesně ta věc, na které se chyba pozná
 * až v provozu.
 *
 * ---------------------------------------------------------------------
 * STAV VYDÁNÍ SE NEVYMÝŠLÍ, ČTE SE Z DAT
 *
 * Každá směna si nese stav při posledním vydání (`published_*`,
 * migrace 20260901130000). `stavSmeny` a `zmenyRozpisu` jsou zrcadlem
 * `app.rozdil_rozpisu`, které počítá zprávy při vydání — s jedním
 * rozdílem: databáze bere jen lidi s účtem (nemá komu psát), tady se
 * bere celý rozpis, protože vedoucí potřebuje vidět i změnu, o které
 * nikdo nedostane zprávu. Kdo zprávu opravdu dostane, říká
 * `public.rozpis_nahled`, ne tenhle soubor.
 *
 * Kdyby se pravidla v databázi změnila, změní se i zde — proto to má
 * vlastní test a proto se rozdíl počítá z týchž sloupců, ne z vlastního
 * příznaku.
 *
 * ---------------------------------------------------------------------
 * CO SE SCHVÁLNĚ NEVYMÝŠLÍ
 *
 * Hodiny jsou součet PLÁNOVANÝCH délek směn bez explicitní pauzy uvnitř
 * (trhaná směna), tedy totéž co na telefonu. Neodečítá se automatická
 * přestávka pobočky — to je pravidlo docházky, ne plánu.
 */

import {
  BEZ_USEKU,
  denVTydnu,
  hhmm,
  minutSmeny,
  posunDatum,
  ZKRATKY_DNU,
  type SmenaZaklad,
} from './rozpis-mobil.ts'
import { vyzadujePotvrzeni } from './upozorneni-text.ts'

/* --- typy ------------------------------------------------------------ */

/** Směna i se stavem při posledním vydání. Sloupce mohou chybět (starší dotaz). */
export type SmenaD = SmenaZaklad & {
  published_employee_id?: string | null
  published_starts_at?: string | null
  published_ends_at?: string | null
  published_status?: string | null
}

export type StavSmeny = 'koncept' | 'zmenena' | 'vydana'

export type OsobaD = {
  id: string
  jmeno: string
  /** Domovský úsek (employees.usek_id). */
  usekId: string | null
  /** Pozice člověka (employees.position_id) — štítek pod jménem. */
  poziceId: string | null
  barva: string | null
}

/* --- čas ------------------------------------------------------------- */

/** „08:00“ i „08:00:00“ → „08:00:00“, ať se časy z různých míst dají porovnat. */
function normCas(cas: string | null | undefined): string | null {
  if (!cas) return null
  const [h = '00', m = '00', s = '00'] = cas.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`
}

const stejnyCas = (a: string | null | undefined, b: string | null | undefined) =>
  normCas(a) === normCas(b)

/* --- stav směny ------------------------------------------------------ */

/**
 * V jakém stavu je směna vůči vydanému rozpisu.
 *
 *   koncept  nebyla vydaná, nebo byla zrušená a je zpátky (pro lidi je
 *            to nová směna — naposled se dozvěděli, že nikam nemusí)
 *   zmenena  byla vydaná a od té doby se změnil člověk nebo čas
 *   vydana   vydaná beze změny
 *
 * Pořadí podmínek je pořadí v `app.rozdil_rozpisu`.
 */
export function stavSmeny(s: SmenaD): StavSmeny {
  if (!s.published_at) return 'koncept'
  if (s.published_status === 'cancelled') return 'koncept'

  // Starší dotaz bez sloupců `published_*`: nevíme, co se změnilo,
  // takže nic nevymýšlíme — vydaná je vydaná.
  if (s.published_starts_at === undefined && s.published_employee_id === undefined) return 'vydana'

  if ((s.published_employee_id ?? null) !== (s.employee_id ?? null)) return 'zmenena'
  if (!stejnyCas(s.published_starts_at, s.starts_at) || !stejnyCas(s.published_ends_at, s.ends_at)) {
    return 'zmenena'
  }
  return 'vydana'
}

/** Čeká směna na vydání? (koncept i změněná) */
export const cekaNaVydani = (s: SmenaD) => stavSmeny(s) !== 'vydana'

/* --- puntík: kde je směna vůči lidem ---------------------------------- */

/**
 * Co databáze ví o posledním upozornění na směnu (`stav_potvrzeni_smen`):
 * jaký druh to byl a kdy ho člověk přečetl a potvrdil. Nikdy ne obsah.
 */
export type PotvrzeniSmeny = {
  druh: string
  precteno_at: string | null
  potvrzeno_at: string | null
}

/**
 * Potvrzení pro celé okno rozpisu. `null` na místě téhle hodnoty = nenačteno
 * (člověk neplánuje, nebo databáze funkci ještě nemá) a puntík vydané směny
 * se pak nekreslí — „nepotvrzeno“ se nevymýšlí, když se to neví.
 */
export type PotvrzeniRozpisu = {
  /**
   * Pobočky, za které databáze potvrzení vrací (tam člověk smí plánovat).
   * Vedoucí Perly vidí i směny Baru, ale jejich potvrzení nedostane — a
   * chybějící řádek by se tam četl jako „nepotvrzeno“.
   */
  pobocky: string[]
  /** Poslední upozornění podle id směny. Chybí-li, upozornění neexistuje. */
  podleSmeny: Record<string, PotvrzeniSmeny>
}

/** Řádek z `stav_potvrzeni_smen` (databáze). */
export type RadekPotvrzeni = PotvrzeniSmeny & { smena_id: string }

/** Nejdelší okno, které `stav_potvrzeni_smen` vezme (93 dní včetně krajů); delší databáze odmítne. */
export const NEJVIC_DNI_POTVRZENI = 92

/** Vejde se okno `od`–`doKdy` (RRRR-MM-DD) do toho, co funkce v databázi vezme? */
export function oknoPotvrzeniSeVejde(od: string, doKdy: string): boolean {
  const dnu = Math.round((Date.parse(doKdy) - Date.parse(od)) / 86_400_000)
  return Number.isFinite(dnu) && dnu >= 0 && dnu <= NEJVIC_DNI_POTVRZENI
}

/** Řádky z databáze → potvrzení okna. `pobocky` = kde databáze potvrzení vrací; jinde se neví. */
export function potvrzeniZRadku(radky: RadekPotvrzeni[], pobocky: string[]): PotvrzeniRozpisu {
  const podleSmeny: Record<string, PotvrzeniSmeny> = {}
  for (const r of radky) {
    podleSmeny[r.smena_id] = { druh: r.druh, precteno_at: r.precteno_at ?? null, potvrzeno_at: r.potvrzeno_at ?? null }
  }
  return { pobocky, podleSmeny }
}

/**
 * Tři barvy puntíku u času směny (Šéfík 20. 9. 2026):
 *
 *   nevydano     červený — směna ještě není v rozpisu, který lidé dostali
 *                (koncept, i vydaná a pak změněná: lidé mají starou verzi)
 *   nepotvrzeno  žlutý   — vydaná, člověk ji ještě nevzal na vědomí
 *   potvrzeno    zelený  — vydaná a člověk ji vzal na vědomí
 */
export type PuntikSmeny = 'nevydano' | 'nepotvrzeno' | 'potvrzeno'

/** Slova k puntíkům: do legendy nahoře, do `title` karty i pro odečítač. Jediné místo. */
export const POPIS_PUNTIKU: Record<PuntikSmeny, string> = {
  nevydano: 'Nevydáno',
  nepotvrzeno: 'Vydáno, nepotvrzeno',
  potvrzeno: 'Vydáno a potvrzeno',
}

/**
 * Vzal člověk směnu na vědomí? Změnu (druh, který to vyžaduje) potvrdil
 * tlačítkem; u nové směny žádné tlačítko není, takže se bere její přečtení
 * — nic silnějšího tu k dispozici není.
 */
export function jePotvrzena(p: PotvrzeniSmeny): boolean {
  if (p.potvrzeno_at) return true
  return !vyzadujePotvrzeni(p.druh) && Boolean(p.precteno_at)
}

/**
 * Puntík směny, nebo `null`, když se nekreslí.
 *
 * Nekreslí se u vydané směny, o které se neví, jak to s potvrzením je
 * (potvrzení se nenačetlo, nebo je z pobočky, kde člověk neplánuje), a u
 * vydané neobsazené směny — není komu ji potvrdit.
 */
export function puntikSmeny(s: SmenaD, potvrzeni: PotvrzeniRozpisu | null | undefined): PuntikSmeny | null {
  if (stavSmeny(s) !== 'vydana') return 'nevydano'
  if (!s.employee_id) return null
  if (!potvrzeni || !potvrzeni.pobocky.includes(s.branch_id)) return null
  const p = potvrzeni.podleSmeny[s.id]
  return p && jePotvrzena(p) ? 'potvrzeno' : 'nepotvrzeno'
}

/** Co bylo při vydání — do popisku „Změněno“. `null`, když se nic nezměnilo nebo se neví. */
export function puvodniStav(
  s: SmenaD,
): { od: string; do: string; osobaId: string | null; casSeZmenil: boolean; osobaSeZmenila: boolean } | null {
  if (stavSmeny(s) !== 'zmenena') return null
  const od = normCas(s.published_starts_at)
  const doKdy = normCas(s.published_ends_at)
  if (!od || !doKdy) return null
  return {
    od: hhmm(od),
    do: hhmm(doKdy),
    osobaId: s.published_employee_id ?? null,
    casSeZmenil: !stejnyCas(s.published_starts_at, s.starts_at) || !stejnyCas(s.published_ends_at, s.ends_at),
    osobaSeZmenila: (s.published_employee_id ?? null) !== (s.employee_id ?? null),
  }
}

/* --- rozdíl proti vydanému rozpisu ----------------------------------- */

export type DruhZmeny = 'nova' | 'cas' | 'prevzata' | 'odebrana' | 'zrusena'

export type ZmenaRozpisu = {
  smenaId: string
  druh: DruhZmeny
  den: string
  /** Koho se změna týká. U `odebrana` původní držitel směny. `null` = neobsazená směna. */
  osobaId: string | null
  od: string
  do: string
  puvodniOd: string | null
  puvodniDo: string | null
  /** U `prevzata`: kdo tu směnu měl při vydání. */
  puvodniOsobaId: string | null
}

/**
 * Co by vydání rozpisu změnilo. Zrcadlo `app.rozdil_rozpisu`, viz hlavičku.
 *
 * Očekává i zrušené směny — zrušená vydaná směna je změna, o které
 * se lidé dozvědí právě vydáním. Zrušená, která nikdy vydaná nebyla,
 * a zrušená, o které už se hlásilo, se nepočítají.
 */
export function zmenyRozpisu(smeny: SmenaD[]): ZmenaRozpisu[] {
  const vysledek: ZmenaRozpisu[] = []

  for (const s of smeny) {
    const zaklad = {
      smenaId: s.id,
      den: s.shift_date,
      osobaId: s.employee_id,
      od: hhmm(s.starts_at),
      do: hhmm(s.ends_at),
      puvodniOd: s.published_starts_at ? hhmm(s.published_starts_at) : null,
      puvodniDo: s.published_ends_at ? hhmm(s.published_ends_at) : null,
      puvodniOsobaId: s.published_employee_id ?? null,
    }

    if (s.status === 'cancelled') {
      // Nevydaná zrušená nikoho nezajímá: nikdy o ní nevěděl.
      if (!s.published_at) continue
      // Zrušení se hlásí JEDNOU.
      if (s.published_status === 'cancelled') continue
      vysledek.push({ ...zaklad, druh: 'zrusena' })
      continue
    }

    const stav = stavSmeny(s)
    if (stav === 'vydana') continue

    if (stav === 'koncept') {
      vysledek.push({ ...zaklad, druh: 'nova' })
      continue
    }

    // zmenena: člověk má přednost před časem, jako v databázi.
    if ((s.published_employee_id ?? null) !== (s.employee_id ?? null)) {
      vysledek.push({ ...zaklad, druh: 'prevzata' })
      // Komu směnu vzali, se to jinak nedozví — jeho jméno už na směně není.
      if (s.published_employee_id) {
        vysledek.push({ ...zaklad, druh: 'odebrana', osobaId: s.published_employee_id })
      }
    } else {
      vysledek.push({ ...zaklad, druh: 'cas' })
    }
  }

  return vysledek
}

export type SouhrnZmen = {
  /** Kolik směn čeká na vydání (jedna směna = jedna, i když se týká dvou lidí). */
  smen: number
  /** Kolika lidí se změny týkají. Neobsazená směna se nepočítá. */
  lidi: number
}

export function souhrnZmen(zmeny: ZmenaRozpisu[]): SouhrnZmen {
  return {
    smen: new Set(zmeny.map((z) => z.smenaId)).size,
    lidi: new Set(zmeny.map((z) => z.osobaId).filter((i): i is string => i !== null)).size,
  }
}

export const NAZVY_ZMEN: Record<DruhZmeny, string> = {
  nova: 'Nová směna',
  cas: 'Změna času',
  prevzata: 'Nově přidělená',
  odebrana: 'Odebraná',
  zrusena: 'Zrušená',
}

/** „ST 23. 9.“ */
export function denKratce(den: string): string {
  const [, m, d] = den.split('-').map(Number)
  return `${ZKRATKY_DNU[denVTydnu(den)]} ${d}. ${m}.`
}

/** „08:00–16:00“, u změny času „08:00–16:00 → 10:00–18:00“. */
export function textZmeny(z: ZmenaRozpisu): string {
  const nove = `${z.od}–${z.do}`
  if (z.druh === 'cas' && z.puvodniOd && z.puvodniDo) return `${z.puvodniOd}–${z.puvodniDo} → ${nove}`
  return nove
}

export type ZmenyOsoby = { osobaId: string | null; zmeny: ZmenaRozpisu[] }

/** Změny po lidech; uvnitř po dni. Neobsazené směny na konec. */
export function zmenyPodleLidi(
  zmeny: ZmenaRozpisu[],
  jmeno: (osobaId: string) => string,
): ZmenyOsoby[] {
  const mapa = new Map<string | null, ZmenaRozpisu[]>()
  for (const z of zmeny) {
    const seznam = mapa.get(z.osobaId) ?? []
    seznam.push(z)
    mapa.set(z.osobaId, seznam)
  }
  const poradi: DruhZmeny[] = ['nova', 'prevzata', 'cas', 'odebrana', 'zrusena']
  return [...mapa.entries()]
    .map(([osobaId, zm]) => ({
      osobaId,
      zmeny: zm.sort(
        (a, b) => a.den.localeCompare(b.den) || poradi.indexOf(a.druh) - poradi.indexOf(b.druh),
      ),
    }))
    .sort((a, b) => {
      if (a.osobaId === null) return 1
      if (b.osobaId === null) return -1
      return jmeno(a.osobaId).localeCompare(jmeno(b.osobaId), 'cs')
    })
}

/* --- hledání a filtry ------------------------------------------------ */

export type StavFiltru = 'vse' | 'nevydane' | 'vydane' | 'neobsazene'

export type FiltrDesktop = {
  hledani: string
  /** Klíč úseku, nebo `BEZ_USEKU`. Prázdné = všechny. */
  useky: string[]
  /** id pozice. Prázdné = všechny. */
  pozice: string[]
  /** id zaměstnanců; víc jich naráz = víc lidí v mřížce. Prázdné = všichni. */
  osoby: string[]
  /** id poboček. Prázdné = všechny; jinak se ukážou jen směny těchto poboček. */
  pobocky: string[]
  stav: StavFiltru
}

export const FILTR_DESKTOP_PRAZDNY: FiltrDesktop = {
  hledani: '',
  useky: [],
  pozice: [],
  osoby: [],
  pobocky: [],
  stav: 'vse',
}

/** Kolik filtrů je zapnutých. Hledání se nepočítá — má vlastní pole. */
export function pocetFiltru(f: FiltrDesktop): number {
  return f.useky.length + f.pozice.length + f.osoby.length + f.pobocky.length + (f.stav !== 'vse' ? 1 : 0)
}

/**
 * Kolik z nich se dá najít a odškrtnout v nabídce **Filtry**. Pobočka se
 * vybírá v nabídce Zobrazit, takže do odznaku u Filtrů nepatří — odznak,
 * který ukazuje na nabídku, kde se ta volba nedá zrušit, je past.
 */
export function pocetFiltruVPanelu(f: FiltrDesktop): number {
  return pocetFiltru(f) - f.pobocky.length
}

export const jeFiltrPrazdny = (f: FiltrDesktop) => pocetFiltru(f) === 0 && f.hledani.trim() === ''

/** Malá písmena bez diakritiky: „Kateřina“ = „katerina“. */
export function normalizuj(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Každé slovo z hledání musí být někde ve jménu; pořadí ani diakritika nehrají roli. */
export function jmenoVyhovuje(jmeno: string, hledani: string): boolean {
  const slova = normalizuj(hledani).split(/\s+/).filter(Boolean)
  if (slova.length === 0) return true
  const cil = normalizuj(jmeno)
  return slova.every((s) => cil.includes(s))
}

const klicUseku = (o: OsobaD, useky: Map<string, string>) =>
  o.usekId && useky.has(o.usekId) ? o.usekId : BEZ_USEKU

/**
 * Vyhovuje ČLOVĚK filtrům, které se týkají člověka (hledání, úsek,
 * pozice, zaměstnanec)? Filtr stavu je o směnách, ten řeší `smenaVyhovujeStavu`.
 *
 * Pozice: stačí, aby ji měl člověk sám, nebo aby na ni měl v okně
 * směnu — kdo vypomáhá jako číšník, patří pod „Číšník“.
 */
export function osobaVyhovuje(
  o: OsobaD,
  poziceSmen: (string | null)[],
  f: FiltrDesktop,
  useky: Map<string, string>,
): boolean {
  if (!jmenoVyhovuje(o.jmeno, f.hledani)) return false
  if (f.osoby.length > 0 && !f.osoby.includes(o.id)) return false
  if (f.useky.length > 0 && !f.useky.includes(klicUseku(o, useky))) return false
  if (f.pozice.length > 0) {
    const mam = [o.poziceId, ...poziceSmen]
    if (!mam.some((p) => p !== null && f.pozice.includes(p))) return false
  }
  return true
}

export function smenaVyhovujeStavu(s: SmenaD, stav: StavFiltru): boolean {
  switch (stav) {
    case 'vse':
      return true
    case 'nevydane':
      return cekaNaVydani(s)
    case 'vydane':
      return !cekaNaVydani(s)
    case 'neobsazene':
      return s.employee_id === null
  }
}

/**
 * Vyhovuje SMĚNA filtrům? Pro pohledy Den a Měsíc, kde se filtruje po
 * směnách, ne po řádcích. Neobsazená směna nemá člověka, tedy ani úsek
 * — filtr úseku ji proto neschová (je to provozní poplach); schová ji
 * výslovně jen hledání jména, filtr zaměstnance a stav.
 */
export function smenaVyhovuje(
  s: SmenaD,
  osoby: Map<string, OsobaD>,
  f: FiltrDesktop,
  useky: Map<string, string>,
): boolean {
  if (!smenaVyhovujeStavu(s, f.stav)) return false
  // Pobočka patří směně (i neobsazené), ne člověku — kdo pracuje na dvou, má v každé jen ty její.
  if (f.pobocky.length > 0 && !f.pobocky.includes(s.branch_id)) return false

  if (s.employee_id === null) {
    if (f.osoby.length > 0) return false
    if (f.hledani.trim() !== '' && !jmenoVyhovuje('Neobsazeno', f.hledani)) return false
    if (f.pozice.length > 0 && !(s.position_id && f.pozice.includes(s.position_id))) return false
    return true
  }

  const o = osoby.get(s.employee_id) ?? {
    id: s.employee_id,
    jmeno: 'Neznámý',
    usekId: null,
    poziceId: null,
    barva: null,
  }
  return osobaVyhovuje(o, [s.position_id], f, useky)
}

/* --- „Uložit a přidat další den“ ------------------------------------------- */

/**
 * Den, na který se po uložené směně otevře další: nejbližší den po `datum`,
 * který člověk nemá obsazený (`obsazene` = dny, kde už směnu má). Při
 * zadávání měsíce tak formulář přeskočí dny, které už jsou vyplněné, a
 * nezaloží se dvakrát totéž. Hledá se nejvýš `limit` dnů dopředu; kdo má
 * obsazeno všechno, dostane den hned po uložené směně.
 */
export function dalsiVolnyDen(obsazene: Iterable<string>, datum: string, limit = 62): string {
  const maSmenu = new Set(obsazene)
  const hned = posunDatum(datum, 1)
  let den = hned
  for (let i = 0; i < limit; i++) {
    if (!maSmenu.has(den)) return den
    den = posunDatum(den, 1)
  }
  return hned
}

/* --- pobočky ---------------------------------------------------------------- */

/**
 * Zkratky poboček: PRVNÍ PÍSMENA slov názvu (Šéfík 20. 9. 2026).
 * „Černá Perla“ → „ČP“, „Bernard“ → „B“.
 *
 * Dvě pobočky nesmějí mít tutéž zkratku — na kartě směny by pak nebylo
 * poznat, o kterou jde. Když se iniciály potkají, přidá se každému slovu
 * další písmeno („ČP“ → „ČePe“ → „ČerPer“ → „ČernPerl“), dokud se nerozliší;
 * poslední možnost je celý název. Prodlužují se VŠECHNA slova, ne jen první —
 * „Restaurace U Lva“ a „Restaurace U Lípy“ se liší až v posledním.
 * Zkratka nikdy není delší než samotný název.
 */
export function zkratkyPobocek(nazvy: string[]): Map<string, string> {
  const jedinecne = [...new Set(nazvy)]

  /** Žebřík od nejkratšího: k písmen z každého slova, nakonec celý název. */
  const kandidati = jedinecne.map((nazev) => {
    const slova = nazev.split(/\s+/).filter(Boolean).map((w) => [...w])
    if (slova.length === 0) return [nazev]
    const nejdelsi = Math.max(...slova.map((w) => w.length))
    const seznam: string[] = []
    for (let k = 1; k <= nejdelsi; k++) {
      seznam.push(
        slova
          .map((w) => {
            const kus = w.slice(0, k)
            return [kus[0].toUpperCase(), ...kus.slice(1)].join('')
          })
          .join(''),
      )
    }
    seznam.push(nazev)
    return seznam
  })

  const uroven = jedinecne.map(() => 0)
  for (let kolo = 0; kolo < 50; kolo++) {
    const zkratky = kandidati.map((k, i) => k[Math.min(uroven[i], k.length - 1)])
    const pocet = new Map<string, number>()
    for (const z of zkratky) pocet.set(z, (pocet.get(z) ?? 0) + 1)
    let zmena = false
    zkratky.forEach((z, i) => {
      if ((pocet.get(z) ?? 0) > 1 && uroven[i] < kandidati[i].length - 1) {
        uroven[i] += 1
        zmena = true
      }
    })
    if (!zmena) break
  }

  return new Map(
    jedinecne.map((nazev, i) => {
      const z = kandidati[i][Math.min(uroven[i], kandidati[i].length - 1)]
      return [nazev, [...z].length >= [...nazev].length ? nazev : z]
    }),
  )
}

/* --- krátké zápisy do úzkých buněk ---------------------------------------- */

/** „08:00“ → „8“, „08:30“ → „8:30“, „15:30“ → „15:30“ — do úzké buňky (bez nuly navíc). */
export function kratkyCas(hm: string): string {
  const hodina = String(Number(hm.slice(0, 2)))
  return hm.endsWith(':00') ? hodina : `${hodina}${hm.slice(2)}`
}

/** Hodiny jako české číslo: 1890 min → „31,5 h“, 480 → „8 h“. */
export function hodinyStruc(minut: number): string {
  return `${String(Math.round((minut / 60) * 100) / 100).replace('.', ',')} h`
}

/* --- celý měsíc jednoho člověka -------------------------------------------- */

export type DenMesiceOsoby = {
  den: string
  /** Patří den do zobrazeného měsíce, nebo je jen z okolního týdne? */
  vMesici: boolean
  smeny: SmenaD[]
}

export type TydenMesiceOsoby = {
  dny: DenMesiceOsoby[]
  /** Naplánované minuty celého týdne od pondělí do neděle (i dny okolního měsíce). */
  minut: number
}

export type MesicOsoby = {
  tydny: TydenMesiceOsoby[]
  /** Minuty, počet směn a nevydané směny — jen dny zobrazeného měsíce. */
  minut: number
  smen: number
  nevydanych: number
}

/**
 * Kalendář měsíce jednoho člověka: týdny od pondělí (`tydny`, jak je dá
 * `mesicniMrizka`), v nich jeho směny po dnech. Součet týdne bere celý
 * týden, součet měsíce jen dny měsíce — týden na rozhraní dvou měsíců
 * tak ukazuje pravdu o hodinách za týden, a přitom se měsíc nezdvojí.
 */
export function sestavitMesicOsoby(v: {
  smeny: SmenaD[]
  osobaId: string
  tydny: string[][]
  /** `RRRR-MM` */
  mesic: string
}): MesicOsoby {
  const poDnech = new Map<string, SmenaD[]>()
  for (const s of v.smeny) {
    if (s.employee_id !== v.osobaId || s.status === 'cancelled') continue
    const seznam = poDnech.get(s.shift_date) ?? []
    seznam.push(s)
    poDnech.set(s.shift_date, seznam)
  }

  let minut = 0
  let smen = 0
  let nevydanych = 0
  const tydny = v.tydny.map((dny) => {
    let minutTydne = 0
    const radek = dny.map((den) => {
      const smeny = [...(poDnech.get(den) ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      const vMesici = den.startsWith(v.mesic)
      const m = smeny.reduce((k, s) => k + minutSmeny(s), 0)
      minutTydne += m
      if (vMesici) {
        minut += m
        smen += smeny.length
        nevydanych += smeny.filter(cekaNaVydani).length
      }
      return { den, vMesici, smeny }
    })
    return { dny: radek, minut: minutTydne }
  })
  return { tydny, minut, smen, nevydanych }
}

/* --- mřížka týdne ---------------------------------------------------- */

export type RadekMrizky = {
  klic: string
  /** `null` = neobsazené směny. */
  osoba: OsobaD | null
  jmeno: string
  smenyPodleDne: Map<string, SmenaD[]>
  minut: number
  /** Kolik směn řádku čeká na vydání. */
  nevydanych: number
}

export type SkupinaMrizky = {
  klic: string
  nazev: string
  druh: 'usek' | 'neobsazene' | 'bez-smeny'
  radky: RadekMrizky[]
  /** Kolik lidí (ne řádků neobsazených směn). */
  lidi: number
  minut: number
}

export type PobockaMrizky = {
  klic: string
  nazev: string
  /**
   * `false` = není to pobočka, ale VŠICHNI lidé dohromady. Nastane, když je
   * v okně víc poboček najednou: člověk, který ten týden dělal na obou, má
   * jeden řádek a jeden součet (jako v exportu), a pobočka se píše na kartu
   * směny. Rozdělit ho po pobočkách a přitom ho nezdvojit nejde.
   */
  jePobocka: boolean
  skupiny: SkupinaMrizky[]
  /** Kolik různých lidí na té pobočce v okně pracuje (neobsazené směny se nepočítají). */
  lidi: number
  /**
   * Plánované minuty LIDÍ na té pobočce — bez neobsazených směn, stejně jako
   * hlavičky úseků a „Celkem“ v patičce. Kdyby se sem přičetly i volné směny,
   * součet poboček by nesouhlasil s patičkou a nikdo by nevěděl, které z těch
   * dvou čísel lže. Volné směny mají vlastní řádek nahoře („1 směna k obsazení“).
   */
  minut: number
}

export type Mrizka = {
  pobocky: PobockaMrizky[]
  /** Lidé bez směny v okně (jen ti, které vedoucí smí plánovat). Kreslí se pod pobočkami. */
  bezSmeny: SkupinaMrizky | null
  /** Kolik řádků je vidět po filtrech. */
  pocetRadku: number
  /** Kolik různých lidí je vidět (člověk na dvou pobočkách se počítá jednou; neobsazené ne). */
  pocetLidi: number
  celkemMinut: number
  /** Po dnech: kolik lidí a hodin je ten den vidět v mřížce. */
  poDnech: Map<string, { lidi: number; minut: number }>
}

const podleJmena = (a: string, b: string) => a.localeCompare(b, 'cs')
const poZacatku = (a: SmenaD, b: SmenaD) =>
  a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at)

/**
 * Mřížka týdne: pobočka → úseky → lidé.
 *
 * JEDEN ŘÁDEK NA ČLOVĚKA (Šéfík 20. 9. 2026). Dřív se člověk, který měl
 * v okně směny na dvou pobočkách, objevil dvakrát — v každé pobočce s její
 * částí hodin. Export ho přitom vedl jako jeden sloupec s celkovým součtem,
 * takže obrazovka a stažený soubor říkaly o témž člověku jiné číslo.
 *
 * Teď platí: ```vidím-li jednu pobočku, je nahoře její pruh a pod ním úseky;
 * vidím-li jich víc najednou, pruhy pobočky nejsou a každý člověk má jeden
 * řádek se všemi svými směnami```. Pobočku pak nese karta směny. Obojí je
 * pravdivé zároveň a nikdo se nezdvojí. Výběrem pobočky v nabídce Zobrazit
 * se člověk vrátí k první podobě.
 *
 * ÚSEK se bere z ČLOVĚKA (`employees.usek_id`), ne ze směny (Šéfík
 * 16. 9. 2026) — ten je na pobočce nezávislý, takže seskupení platí vždy.
 *
 * `lideBezSmeny` jsou ti, které vedoucí smí plánovat, ale v okně nemají
 * ani jednu směnu; kreslí se dole zvlášť, ať jim jde směna zadat.
 */
export function sestavitMrizku(v: {
  smeny: SmenaD[]
  dny: string[]
  osoby: Map<string, OsobaD>
  /** id → název, v pořadí, které si firma nastavila. */
  useky: Map<string, string>
  pobocky: Map<string, string>
  lideBezSmeny: OsobaD[]
  filtr: FiltrDesktop
}): Mrizka {
  const { dny, osoby, useky, pobocky, filtr } = v
  const vOkne = v.smeny.filter(
    (s) =>
      s.status !== 'cancelled' &&
      dny.includes(s.shift_date) &&
      (filtr.pobocky.length === 0 || filtr.pobocky.includes(s.branch_id)),
  )

  const znamaOsoba = (id: string): OsobaD =>
    osoby.get(id) ?? { id, jmeno: 'Neznámý', usekId: null, poziceId: null, barva: null }

  const poPobockach = new Map<string, SmenaD[]>()
  for (const s of vOkne) {
    const seznam = poPobockach.get(s.branch_id) ?? []
    seznam.push(s)
    poPobockach.set(s.branch_id, seznam)
  }

  const soucet = (smeny: SmenaD[]) => smeny.reduce((n, s) => n + minutSmeny(s), 0)

  const sestavRadek = (osoba: OsobaD | null, smeny: SmenaD[]): RadekMrizky => {
    const podleDne = new Map<string, SmenaD[]>()
    for (const s of smeny) {
      const seznam = podleDne.get(s.shift_date) ?? []
      seznam.push(s)
      podleDne.set(s.shift_date, seznam)
    }
    for (const seznam of podleDne.values()) seznam.sort(poZacatku)
    return {
      klic: osoba?.id ?? 'neobsazeno',
      osoba,
      jmeno: osoba?.jmeno ?? 'Neobsazeno',
      smenyPodleDne: podleDne,
      minut: soucet(smeny),
      nevydanych: smeny.filter(cekaNaVydani).length,
    }
  }

  /**
   * Řádek projde, když vyhovuje člověk a — je-li zapnutý stav — aspoň
   * jedna jeho směna. Směny řádku se pak kreslí VŠECHNY: kdo hledá
   * nevydané změny, chce je vidět v kontextu celého týdne člověka.
   */
  const radekProjde = (radek: RadekMrizky, smeny: SmenaD[]): boolean => {
    if (filtr.stav !== 'vse' && !smeny.some((s) => smenaVyhovujeStavu(s, filtr.stav))) return false
    if (radek.osoba === null) {
      // Neobsazené: jméno „Neobsazeno“ se dá vyhledat; úsek ani zaměstnanec
      // je neschovají (nemají člověka), pozice ano.
      if (filtr.osoby.length > 0) return false
      if (!jmenoVyhovuje('Neobsazeno', filtr.hledani)) return false
      if (filtr.pozice.length > 0) {
        return smeny.some((s) => s.position_id && filtr.pozice.includes(s.position_id))
      }
      return true
    }
    return osobaVyhovuje(radek.osoba, smeny.map((s) => s.position_id), filtr, useky)
  }

  const poradiUseku = [...useky.keys()]

  /** Úseky a lidé z daných směn; `predpona` odlišuje klíče skupin mezi pobočkami. */
  const sestavSkupiny = (smenySkupiny: SmenaD[], predpona: string): SkupinaMrizky[] => {
    const podleOsoby = new Map<string | null, SmenaD[]>()
    for (const s of smenySkupiny) {
      const seznam = podleOsoby.get(s.employee_id) ?? []
      seznam.push(s)
      podleOsoby.set(s.employee_id, seznam)
    }

    const skupinyMapa = new Map<string, RadekMrizky[]>()
    let neobsazene: RadekMrizky | null = null

    for (const [osobaId, smenyOsoby] of podleOsoby) {
      const radek = sestavRadek(osobaId ? znamaOsoba(osobaId) : null, smenyOsoby)
      if (!radekProjde(radek, smenyOsoby)) continue
      if (osobaId === null) {
        neobsazene = radek
        continue
      }
      const klic = klicUseku(radek.osoba!, useky)
      const seznam = skupinyMapa.get(klic) ?? []
      seznam.push(radek)
      skupinyMapa.set(klic, seznam)
    }

    const skupiny: SkupinaMrizky[] = []

    // Neobsazené směny jako první: „sem někoho potřebujeme“ je poplach.
    if (neobsazene) {
      skupiny.push({
        klic: `${predpona}|neobsazene`,
        nazev: 'Neobsazené směny',
        druh: 'neobsazene',
        radky: [neobsazene],
        lidi: 0,
        minut: neobsazene.minut,
      })
    }

    for (const klic of [...poradiUseku, BEZ_USEKU]) {
      const radky = skupinyMapa.get(klic)
      if (!radky || radky.length === 0) continue
      radky.sort((a, b) => podleJmena(a.jmeno, b.jmeno))
      skupiny.push({
        klic: `${predpona}|${klic}`,
        nazev: klic === BEZ_USEKU ? 'Bez úseku' : (useky.get(klic) ?? 'Bez úseku'),
        druh: 'usek',
        radky,
        lidi: radky.length,
        minut: radky.reduce((n, r) => n + r.minut, 0),
      })
    }
    return skupiny
  }

  const souctySkupin = (skupiny: SkupinaMrizky[]) => ({
    lidi: skupiny.reduce((n, sk) => n + sk.lidi, 0),
    minut: skupiny.filter((sk) => sk.druh === 'usek').reduce((n, sk) => n + sk.minut, 0),
  })

  /*
    Jedna pobočka v okně → pruh pobočky a pod ním úseky. Víc poboček →
    žádné pruhy a každý člověk jen jednou, se všemi svými směnami
    (pobočku nese karta směny). Jinak by se člověk, co dělá na obou,
    objevil dvakrát a jeho hodiny by se rozpadly na dvě čísla.
  */
  const pobockyVysledek: PobockaMrizky[] =
    poPobockach.size > 1
      ? (() => {
          const skupiny = sestavSkupiny(vOkne, 'vse')
          if (skupiny.length === 0) return []
          return [{ klic: 'vse', nazev: '', jePobocka: false, skupiny, ...souctySkupin(skupiny) }]
        })()
      : [...poPobockach.keys()]
          .sort((a, b) => podleJmena(pobocky.get(a) ?? '', pobocky.get(b) ?? ''))
          .map((branchId) => {
            const skupiny = sestavSkupiny(poPobockach.get(branchId) ?? [], branchId)
            return {
              klic: branchId,
              nazev: pobocky.get(branchId) ?? 'Jiná pobočka',
              jePobocka: true,
              skupiny,
              ...souctySkupin(skupiny),
            }
          })
          .filter((p) => p.skupiny.length > 0)

  /*
    Lidé bez směny v okně. Stav „nevydané“ a „neobsazené“ jsou o směnách,
    které tihle lidé nemají, takže se při nich neukazují.
  */
  const bezSmeny: SkupinaMrizky | null = (() => {
    // Lidé bez směny nemají pobočku, na které by se dali ukázat — při výběru pobočky se neukazují.
    if (filtr.stav !== 'vse' || filtr.pobocky.length > 0) return null
    const radky = v.lideBezSmeny
      .map((o) => sestavRadek(o, []))
      .filter((r) => radekProjde(r, []))
      .sort((a, b) => podleJmena(a.jmeno, b.jmeno))
    if (radky.length === 0) return null
    return {
      klic: 'bez-smeny',
      nazev: 'Bez směny v tomto období',
      druh: 'bez-smeny',
      radky,
      lidi: radky.length,
      minut: 0,
    } satisfies SkupinaMrizky
  })()

  /* --- součty ------------------------------------------------------- */

  const vsechnyRadky = [
    ...pobockyVysledek.flatMap((p) => p.skupiny.flatMap((s) => s.radky)),
    ...(bezSmeny?.radky ?? []),
  ]

  /*
    Součty počítají LIDI. Neobsazená směna do nich nepatří — hodiny bez
    člověka by zkreslily „kolik lidí kolik hodin pracuje“; má vlastní
    součet v hlavičce své skupiny.
  */
  const radkyLidi = vsechnyRadky.filter((r) => r.osoba !== null)

  const poDnech = new Map<string, { lidi: number; minut: number }>()
  for (const den of dny) {
    const lidi = new Set<string>()
    let minut = 0
    for (const r of radkyLidi) {
      const smeny = r.smenyPodleDne.get(den) ?? []
      if (smeny.length === 0) continue
      lidi.add(r.osoba!.id)
      minut += soucet(smeny)
    }
    poDnech.set(den, { lidi: lidi.size, minut })
  }

  return {
    pobocky: pobockyVysledek,
    bezSmeny,
    pocetRadku: vsechnyRadky.length,
    pocetLidi: new Set(radkyLidi.map((r) => r.osoba!.id)).size,
    celkemMinut: radkyLidi.reduce((n, r) => n + r.minut, 0),
    poDnech,
  }
}
