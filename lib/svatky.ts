/**
 * Svátky do kalendářů — Rozpis směn a Rezervace a akce (Šéfík 28. 10. 2026:
 * „v kalendářích směn i akcí potřebuju mít nějak znázorněné svátky“).
 *
 * Bez sítě a bez tabulky v databázi: data jsou ze zákona, Velikonoce se
 * počítají. Čistý modul — testuje ho scripts/svatky.test.mjs.
 *
 * ---------------------------------------------------------------------
 * CO JE SVÁTEK
 *
 * Dny pracovního klidu podle zákona č. 245/2000 Sb.: státní svátky (§ 1)
 * i ostatní svátky (§ 2 — Nový rok, Velký pátek, Velikonoční pondělí,
 * 1. máj, Vánoce). Pro plánování mají stejnou váhu (volno, příplatek za
 * práci ve svátek), proto se ukazují všechny; `druh` jen říká, který je
 * který. 1. ledna je obojí zároveň a je to jeden den, tak je to jeden
 * záznam.
 *
 * OBCHODY ZAVŘENÉ
 *
 * Zákon č. 223/2016 Sb. o prodejní době (od 1. 10. 2016): obchody nad
 * 200 m² mají zavřeno 1. 1., Velikonoční pondělí, 8. 5., 28. 9., 28. 10.,
 * 25. 12. a 26. 12., a 24. 12. od 12:00. Restaurace se to netýká — je to
 * značka pro plánování (lidé jsou doma, dodavatelé nevozí).
 *
 * ---------------------------------------------------------------------
 * DEN JE KALENDÁŘNÍ, NE PROVOZNÍ
 *
 * Svátek je kalendářní datum („RRRR-MM-DD“) a přiřazuje se k buňce
 * kalendáře s TÍMTÉŽ datem. Nic se tu nepřepočítává přes hodiny, pásmo
 * ani `day_starts_at`: provozní den 28. 10. začíná 28. 10. v 5:00 a svátek
 * 28. 10. je jeho den. Kdyby se datum svátku bralo z okamžiku (`new Date()`
 * v UTC, posun o začátek provozního dne), vyšel by v noci o den vedle.
 * Datum se proto čte jako čísla, stejně jako v lib/rezervace-kalendar.ts.
 *
 * ---------------------------------------------------------------------
 * ZEMĚ
 *
 * Svátky patří zemi firmy (`tenants.country`, dnes všude CZ; pobočky
 * vlastní zemi nemají). Když země chybí, platí CZ. Země, kterou modul
 * nezná, nedostane NIC — radši žádný svátek než cizí.
 */

/** Země, pro které modul svátky zná. */
export const ZEME_SE_SVATKY = ['CZ'] as const
export type ZemeSvatku = (typeof ZEME_SE_SVATKY)[number]

/** Když firma zemi nemá vyplněnou (nebo ji nejde přečíst). */
export const ZEME_VYCHOZI: ZemeSvatku = 'CZ'

export type DruhSvatku = 'statni' | 'ostatni'

/** Zákon o prodejní době: celý den, nebo 24. 12. od poledne. */
export type ObchodyZavreno = 'cely-den' | 'od-poledne'

export type Svatek = {
  /** Kalendářní datum „RRRR-MM-DD“. */
  den: string
  /** Plný název podle zákona. */
  nazev: string
  /** Do úzké buňky kalendáře; plný název jde vždycky do popisku. */
  kratce: string
  druh: DruhSvatku
  /** `null` = obchody mají otevřeno. */
  obchody: ObchodyZavreno | null
}

/**
 * Země pro svátky z `tenants.country` (char(2)).
 *
 * Prázdná → CZ (výchozí). Známá → ta. Jiná → `null`: svátky té země
 * neznáme a cizí nekreslíme.
 */
export function zemeSvatku(kod: string | null | undefined): ZemeSvatku | null {
  const k = (kod ?? '').trim().toUpperCase()
  if (k === '') return ZEME_VYCHOZI
  return (ZEME_SE_SVATKY as readonly string[]).includes(k) ? (k as ZemeSvatku) : null
}

/* ---------- datum jako čísla ------------------------------------------ */

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/

function datum(rok: number, mesic: number, den: number): string {
  return `${String(rok).padStart(4, '0')}-${String(mesic).padStart(2, '0')}-${String(den).padStart(2, '0')}`
}

/** Posun o dny. UTC jen jako počítadlo dnů — z výsledku se nikdy nedělá okamžik. */
function posun(iso: string, dny: number): string {
  const [r, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(r, m - 1, d + dny))
  return datum(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/**
 * Velikonoční neděle v gregoriánském kalendáři („anonymní“ algoritmus,
 * Meeus/Jones/Butcher). Platí pro každý rok od 1583.
 */
export function velikonocniNedele(rok: number): string {
  const a = rok % 19
  const b = Math.floor(rok / 100)
  const c = rok % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mesic = Math.floor((h + l - 7 * m + 114) / 31)
  const den = ((h + l - 7 * m + 114) % 31) + 1
  return datum(rok, mesic, den)
}

/* ---------- Česko ----------------------------------------------------- */

/** Zákon 245/2000 Sb. platí od 9. 8. 2000; první celý rok je 2001. Dřív nekreslíme nic, ne něco jiného. */
const CZ_OD_ROKU = 2001
/** Velký pátek je svátek od roku 2016 (zákon č. 359/2015 Sb.). */
const CZ_VELKY_PATEK_OD = 2016
/** 17. listopadu má delší název od roku 2019 (zákon č. 207/2019 Sb.). */
const CZ_17_LISTOPAD_STUDENTSTVO_OD = 2019
/** Zákon o prodejní době platí od 1. 10. 2016. */
const CZ_OBCHODY_OD = '2016-10-01'

type Predpis = Omit<Svatek, 'den' | 'obchody'> & { obchody?: ObchodyZavreno }

function svatkyCesko(rok: number): Svatek[] {
  if (rok < CZ_OD_ROKU) return []
  const velikonoce = velikonocniNedele(rok)
  const pevne: [number, number, Predpis][] = [
    [1, 1, { nazev: 'Den obnovy samostatného českého státu, Nový rok', kratce: 'Nový rok', druh: 'statni', obchody: 'cely-den' }],
    [5, 1, { nazev: 'Svátek práce', kratce: 'Svátek práce', druh: 'ostatni' }],
    [5, 8, { nazev: 'Den vítězství', kratce: 'Den vítězství', druh: 'statni', obchody: 'cely-den' }],
    [7, 5, { nazev: 'Den slovanských věrozvěstů Cyrila a Metoděje', kratce: 'Cyril a Metoděj', druh: 'statni' }],
    [7, 6, { nazev: 'Den upálení mistra Jana Husa', kratce: 'Mistr Jan Hus', druh: 'statni' }],
    [9, 28, { nazev: 'Den české státnosti', kratce: 'Den české státnosti', druh: 'statni', obchody: 'cely-den' }],
    [10, 28, { nazev: 'Den vzniku samostatného československého státu', kratce: 'Vznik Československa', druh: 'statni', obchody: 'cely-den' }],
    [
      11,
      17,
      {
        nazev:
          rok >= CZ_17_LISTOPAD_STUDENTSTVO_OD
            ? 'Den boje za svobodu a demokracii a Mezinárodní den studentstva'
            : 'Den boje za svobodu a demokracii',
        kratce: 'Den boje za svobodu',
        druh: 'statni',
      },
    ],
    [12, 24, { nazev: 'Štědrý den', kratce: 'Štědrý den', druh: 'ostatni', obchody: 'od-poledne' }],
    [12, 25, { nazev: '1. svátek vánoční', kratce: '1. svátek vánoční', druh: 'ostatni', obchody: 'cely-den' }],
    [12, 26, { nazev: '2. svátek vánoční', kratce: '2. svátek vánoční', druh: 'ostatni', obchody: 'cely-den' }],
  ]
  const pohyblive: [string, Predpis][] = [
    ...(rok >= CZ_VELKY_PATEK_OD
      ? [[posun(velikonoce, -2), { nazev: 'Velký pátek', kratce: 'Velký pátek', druh: 'ostatni' }] as [string, Predpis]]
      : []),
    [posun(velikonoce, 1), { nazev: 'Velikonoční pondělí', kratce: 'Velikonoční pondělí', druh: 'ostatni', obchody: 'cely-den' }],
  ]
  return [...pevne.map(([m, d, p]) => [datum(rok, m, d), p] as [string, Predpis]), ...pohyblive]
    .map(([den, p]) => ({
      den,
      nazev: p.nazev,
      kratce: p.kratce,
      druh: p.druh,
      obchody: p.obchody && den >= CZ_OBCHODY_OD ? p.obchody : null,
    }))
    .sort((a, b) => (a.den < b.den ? -1 : 1))
}

/* ---------- veřejné dotazy -------------------------------------------- */

const VYPOCET: Record<ZemeSvatku, (rok: number) => Svatek[]> = { CZ: svatkyCesko }
const PAMET = new Map<string, readonly Svatek[]>()

/**
 * Svátky roku v zemi, seřazené podle data. Neznámá země → prázdno —
 * i taková, která sem dojde mimo typy (z databáze, chybějící vlastnost).
 */
export function svatkyRoku(rok: number, zeme: ZemeSvatku | null): readonly Svatek[] {
  const vypocet = zeme && Object.hasOwn(VYPOCET, zeme) ? VYPOCET[zeme] : null
  if (!vypocet || !Number.isInteger(rok) || rok < 1583 || rok > 9999) return []
  const klic = `${zeme}|${rok}`
  let s = PAMET.get(klic)
  if (!s) {
    s = Object.freeze(vypocet(rok).map((x) => Object.freeze(x)))
    PAMET.set(klic, s)
  }
  return s
}

/** Svátek kalendářního dne „RRRR-MM-DD“, nebo `null`. Nesmysl v datu → `null`. */
export function svatekDne(den: string, zeme: ZemeSvatku | null): Svatek | null {
  const m = DATUM.exec(den)
  if (!m) return null
  return svatkyRoku(Number(m[1]), zeme).find((s) => s.den === den) ?? null
}

/** Svátky od–do (obojí včetně), seřazené. Do legendy pod kalendářem. */
export function svatkyObdobi(od: string, doDne: string, zeme: ZemeSvatku | null): Svatek[] {
  const mOd = DATUM.exec(od)
  const mDo = DATUM.exec(doDne)
  if (!mOd || !mDo || od > doDne) return []
  const vysledek: Svatek[] = []
  for (let rok = Number(mOd[1]); rok <= Number(mDo[1]); rok++) {
    for (const s of svatkyRoku(rok, zeme)) if (s.den >= od && s.den <= doDne) vysledek.push(s)
  }
  return vysledek
}

/* ---------- texty ------------------------------------------------------ */

/** „obchody zavřené“, „obchody od 12:00 zavřené“, nebo prázdno. */
export function obchodyText(s: Pick<Svatek, 'obchody'>): string {
  if (s.obchody === 'cely-den') return 'obchody zavřené'
  if (s.obchody === 'od-poledne') return 'obchody od 12:00 zavřené'
  return ''
}

/** „Státní svátek“ / „Svátek“ (Velký pátek, Vánoce… jsou podle zákona „ostatní svátky“). */
export function druhText(s: Pick<Svatek, 'druh'>): string {
  return s.druh === 'statni' ? 'Státní svátek' : 'Svátek'
}

/**
 * Celý popis do popisku pro odečítač a do `title`:
 * „Státní svátek Den vzniku samostatného československého státu, obchody zavřené“.
 */
export function popisSvatku(s: Svatek): string {
  const obchody = obchodyText(s)
  return `${druhText(s)} ${s.nazev}${obchody ? `, ${obchody}` : ''}`
}

/** „28. 10. Den vzniku samostatného československého státu“ — do seznamu svátků období. */
export function svatekSDatem(s: Pick<Svatek, 'den' | 'nazev'>): string {
  const [, m, d] = s.den.split('-').map(Number)
  return `${d}. ${m}. ${s.nazev}`
}
