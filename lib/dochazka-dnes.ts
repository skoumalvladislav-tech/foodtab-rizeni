/**
 * Živý přehled docházky: kdo je v práci, kdo ještě nepřišel, kdo odešel.
 *
 * Čistá logika — žádný React, žádná databáze —, ať se dá zkoušet Nodem
 * (scripts/dochazka-dnes.test.mjs). Obrazovka jen předá směny a události
 * a nakreslí, co vyjde.
 *
 * ---------------------------------------------------------------------
 * JEDNA DEFINICE „JE V PRÁCI“
 *
 * Zdroj pravdy je `app.otevreny_prichod` (20260905010000): poslední
 * příchod bez odchodu, nestornovaný a systémem neuzavřený, přičemž
 * odchod se páruje v TÉMŽE provozním dni a musí být pozdější.
 * `otevrenyPrichod` níž je jeho zrcadlo pro jednoho člověka — přesně
 * tatáž pravidla, stejný pořadí podmínek. Dřív obrazovka „v práci“
 * poznávala podle POSLEDNÍ UDÁLOSTI a po stornu příchodu nabízela
 * odchod ke směně, která neexistuje (viz lib/dochazka-stav.ts). Tady se
 * na to nikdy nesahá přes poslední událost.
 *
 * ---------------------------------------------------------------------
 * CO SE SCHVÁLNĚ NEVYMÝŠLÍ
 *
 *   * Žádné „zpoždění“. Firma zatím žádné pravidlo tolerance
 *     nestanovila, takže „přišel pozdě“ by byl práh, který jsme si
 *     vymysleli. Říká se jen fakt: směna už začala a příchod chybí
 *     (`po_zacatku`), případně už i skončila (`nepresel`).
 *   * Čas „na místě“ je hrubý: od příchodu do odchodu (u lidí v práci
 *     do teď) bez odečtu přestávek. Mzdy počítají přesněji
 *     (`app.worked_minutes`, včetně přestávek a paušálu) — tahle
 *     obrazovka je přehled dne, ne výplatní páska. Stejné číslo si
 *     člověk čte o sobě na obrazovce Docházka („Odpracováno …“).
 *   * Otevřený příchod starší než včerejší provozní den se do přehledu
 *     dne nepočítá jako práce — je to zapomenutý odchod a patří do
 *     panelu nedokončené docházky. Otevřený příchod ze včerejška se
 *     ukáže s poznámkou (noční směna, která přes hranici provozního dne
 *     ještě neskončila).
 */

import { okamzikVPasmu, ZONA_VYCHOZI } from './cas.ts'

/* --- vstupy ---------------------------------------------------------- */

export type UdalostDochazky = {
  employee_id: string
  /** 'in' | 'out' | 'break_start' | 'break_end' */
  kind: string
  /** Okamžik, ISO. */
  occurred_at: string
  /** Provozní den (RRRR-MM-DD), ne kalendářní. */
  business_date: string
  branch_id: string
  stornovano_kdy: string | null
  uzavreno_systemem: string | null
}

export type SmenaDne = {
  id: string
  branch_id: string
  employee_id: string
  shift_date: string
  starts_at: string
  ends_at: string
}

const ms = (iso: string) => Date.parse(iso)

/* --- jeden člověk ---------------------------------------------------- */

/**
 * Nejnovější příchod bez odchodu — zrcadlo `app.otevreny_prichod`
 * pro jednoho člověka. Události mají být jeho, ze všech poboček.
 */
export function otevrenyPrichod(udalosti: UdalostDochazky[]): UdalostDochazky | null {
  const platne = udalosti.filter((u) => u.stornovano_kdy == null)
  const odchody = platne.filter((u) => u.kind === 'out')

  const otevrene = platne
    .filter((u) => u.kind === 'in' && u.uzavreno_systemem == null)
    .filter(
      (a) =>
        !odchody.some((o) => o.business_date === a.business_date && ms(o.occurred_at) > ms(a.occurred_at)),
    )
    .sort((a, b) => ms(b.occurred_at) - ms(a.occurred_at))

  return otevrene[0] ?? null
}

export type StavPritomnosti = 'v_praci' | 'odesel' | 'nebyl'

export type PritomnostOsoby = {
  stav: StavPritomnosti
  /** První příchod provozního dne; u otevřeného z dřívějška ten otevřený. ISO. */
  prichod: string | null
  /** Poslední odchod dne. `null`, když je člověk zrovna v práci. ISO. */
  odchod: string | null
  /** Provozní den otevřeného příchodu, je-li jiný než `den` (noční směna / zapomenutý odchod). */
  otevrenyZeDne: string | null
  naPrestavce: boolean
  /** Hrubé minuty na místě v provozním dni `den`; viz hlavičku souboru. */
  minutNaMiste: number
  /** Pobočka otevřeného příchodu, jinak posledního záznamu dne. */
  pobockaId: string | null
}

/**
 * Přítomnost jednoho člověka v provozním dni `den`.
 *
 * `udalosti` jsou jeho, ideálně provozní dny `den` a den před ním
 * (noční směna). `ted` je okamžik v ms — parametr, ne `Date.now()`
 * uvnitř, aby výsledek šel zkoušet.
 */
export function pritomnostOsoby(udalosti: UdalostDochazky[], den: string, ted: number): PritomnostOsoby {
  const platne = udalosti.filter((u) => u.stornovano_kdy == null)
  const otevreny = otevrenyPrichod(udalosti)
  const dnes = platne
    .filter((u) => u.business_date === den)
    .sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))

  const prichodyDne = dnes.filter((u) => u.kind === 'in')
  const odchodyDne = dnes.filter((u) => u.kind === 'out')

  // Hrubé minuty: dvojice příchod → odchod v týž provozní den. Druhý
  // příchod, dokud je první otevřený, se přeskakuje (jako
  // `app.worked_minutes`); systémem uzavřený příchod nemá známý konec,
  // takže se nepočítá vůbec.
  let minut = 0
  let otevrenyOd: number | null = null
  for (const u of dnes) {
    if (u.kind === 'in' && u.uzavreno_systemem == null && otevrenyOd === null) {
      otevrenyOd = ms(u.occurred_at)
    } else if (u.kind === 'out' && otevrenyOd !== null) {
      minut += Math.max(0, ms(u.occurred_at) - otevrenyOd) / 60000
      otevrenyOd = null
    }
  }
  if (otevrenyOd !== null && otevreny && otevreny.business_date === den) {
    minut += Math.max(0, ted - otevrenyOd) / 60000
  }

  const otevrenyZeDne = otevreny && otevreny.business_date !== den ? otevreny.business_date : null

  let naPrestavce = false
  if (otevreny) {
    const odPrichodu = platne
      .filter(
        (u) =>
          (u.kind === 'break_start' || u.kind === 'break_end') &&
          ms(u.occurred_at) > ms(otevreny.occurred_at),
      )
      .sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))
    naPrestavce = odPrichodu.length > 0 && odPrichodu[odPrichodu.length - 1].kind === 'break_start'
  }

  const stav: StavPritomnosti = otevreny ? 'v_praci' : prichodyDne.length > 0 ? 'odesel' : 'nebyl'

  return {
    stav,
    prichod: otevreny && otevreny.business_date !== den ? otevreny.occurred_at : (prichodyDne[0]?.occurred_at ?? null),
    odchod: otevreny ? null : (odchodyDne[odchodyDne.length - 1]?.occurred_at ?? null),
    otevrenyZeDne,
    naPrestavce,
    minutNaMiste: otevrenyZeDne ? 0 : Math.floor(minut),
    pobockaId: otevreny?.branch_id ?? dnes[dnes.length - 1]?.branch_id ?? null,
  }
}

/* --- přehled dne ----------------------------------------------------- */

export type StavRadku =
  | 'v_praci'
  | 'odesel'
  /** Má směnu, ještě nepřišel, směna ještě nezačala. */
  | 'nadchazi'
  /** Má směnu, nepřišel a směna už začala. Není to „zpoždění“ — žádný práh nemáme. */
  | 'po_zacatku'
  /** Má směnu, nepřišel a směna už skončila. */
  | 'nepresel'

export type RadekPrehledu = {
  osobaId: string
  smeny: { od: string; do: string; branchId: string }[]
  /** „08:00“ — nejdřívější začátek a nejpozdější konec dne. */
  planOd: string | null
  planDo: string | null
  stav: StavRadku
  /** Píchl se, ale v rozpisu dnes nemá směnu. */
  bezSmeny: boolean
  pritomnost: PritomnostOsoby
}

export type PrehledDne = {
  radky: RadekPrehledu[]
  souhrn: {
    vPraci: number
    /** Ještě nepřišli a směna ještě nezačala. */
    cekame: number
    /** Nepřišli, směna už začala (nebo skončila). */
    poZacatku: number
    odesli: number
    minutNaMiste: number
  }
}

const hhmm = (cas: string) => cas.slice(0, 5)

/** Pořadí v seznamu: kdo je v práci, kdo chybí, kdo přijde, kdo odešel. */
const PORADI_STAVU: Record<StavRadku, number> = {
  v_praci: 0,
  po_zacatku: 1,
  nepresel: 2,
  nadchazi: 3,
  odesel: 4,
}

export function sestavitPrehledDne(v: {
  den: string
  /** „Teď“ v ms. */
  ted: number
  /** Dnešní směny s člověkem, bez zrušených. */
  smeny: SmenaDne[]
  /** Události všech lidí za provozní den `den` a den před ním. */
  udalosti: UdalostDochazky[]
  /** Pásmo pobočky podle id. */
  zona: (pobockaId: string) => string
  jmeno: (osobaId: string) => string
}): PrehledDne {
  const { den, ted } = v

  const lide = new Set<string>([
    ...v.smeny.map((s) => s.employee_id),
    ...v.udalosti.map((u) => u.employee_id),
  ])

  const radky: RadekPrehledu[] = [...lide].flatMap((osobaId): RadekPrehledu[] => {
    const smenyOsoby = v.smeny
      .filter((s) => s.employee_id === osobaId)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    const pritomnost = pritomnostOsoby(
      v.udalosti.filter((u) => u.employee_id === osobaId),
      den,
      ted,
    )

    // Začátek a konec jako okamžiky v pásmu pobočky. Konec dřív než začátek = druhý den.
    const okamziky = smenyOsoby.map((s) => {
      const zona = v.zona(s.branch_id) || ZONA_VYCHOZI
      const zacatek = okamzikVPasmu(s.shift_date, s.starts_at, zona)
      let konec = okamzikVPasmu(s.shift_date, s.ends_at, zona)
      if (konec <= zacatek) konec += 24 * 3600 * 1000
      return { zacatek, konec }
    })
    const zacatek = okamziky.length ? Math.min(...okamziky.map((o) => o.zacatek)) : null
    const konec = okamziky.length ? Math.max(...okamziky.map((o) => o.konec)) : null

    let stav: StavRadku
    if (pritomnost.stav === 'v_praci') stav = 'v_praci'
    else if (pritomnost.stav === 'odesel') stav = 'odesel'
    else if (zacatek !== null && ted < zacatek) stav = 'nadchazi'
    else if (konec !== null && ted < konec) stav = 'po_zacatku'
    else stav = 'nepresel'

    // Nemá dnes směnu ani docházku (třeba včera pracoval a odešel) —
    // v přehledu dne není o čem mluvit.
    if (smenyOsoby.length === 0 && pritomnost.stav === 'nebyl') return []

    return [{
      osobaId,
      smeny: smenyOsoby.map((s) => ({ od: hhmm(s.starts_at), do: hhmm(s.ends_at), branchId: s.branch_id })),
      planOd: smenyOsoby.length ? hhmm(smenyOsoby[0].starts_at) : null,
      planDo: smenyOsoby.length ? hhmm(smenyOsoby[smenyOsoby.length - 1].ends_at) : null,
      stav,
      // Otevřený příchod z dřívějška („od včerejška“) se ukazuje se
      // svou poznámkou, ne jako „mimo rozpis“.
      bezSmeny:
        smenyOsoby.length === 0 && pritomnost.stav !== 'nebyl' && pritomnost.otevrenyZeDne === null,
      pritomnost,
    }]
  })

  radky.sort(
    (a, b) =>
      PORADI_STAVU[a.stav] - PORADI_STAVU[b.stav] ||
      (a.planOd ?? '99:99').localeCompare(b.planOd ?? '99:99') ||
      v.jmeno(a.osobaId).localeCompare(v.jmeno(b.osobaId), 'cs'),
  )

  return {
    radky,
    souhrn: {
      vPraci: radky.filter((r) => r.stav === 'v_praci').length,
      cekame: radky.filter((r) => r.stav === 'nadchazi').length,
      poZacatku: radky.filter((r) => r.stav === 'po_zacatku' || r.stav === 'nepresel').length,
      odesli: radky.filter((r) => r.stav === 'odesel').length,
      minutNaMiste: radky.reduce((n, r) => n + r.pritomnost.minutNaMiste, 0),
    },
  }
}
