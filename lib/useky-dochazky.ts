/**
 * Docházka jednoho člověka po dnech — čistá logika obrazovky
 * /[rozsah]/dochazka/clovek/[id] (a oddílu „Moje úseky" v Můj účet).
 *
 * Zadání majitele 27. 9. 2026: „potřebuji mít možnost u jednotlivých
 * lidí zkouknout odpracované směny po dnech a případně je upravovat.
 * dále možnost stornovat směnu která započala píchnutím".
 *
 * ---------------------------------------------------------------------
 * CO SE TU NEPOČÍTÁ
 *
 * Úseky, jejich párování, paušál, součet dne i měsíce dává databáze
 * (`public.useky_cloveka`: opis stavového automatu `app.worked_minutes`,
 * `den_minut` = worked_minutes toho dne). Tenhle soubor jen převádí řádky
 * na tvar pro obrazovku, seskupí je po dnech a skládá věty. Součet dne se
 * NESČÍTÁ z úseků — den se počítá ze sekund a součet zaokrouhlených
 * úseků se od něj může lišit o minutu; pravdu má databáze.
 *
 * Časy se formátují výhradně přes lib/cas s pásmem POBOČKY ZÁZNAMU
 * (sloupce `*_zona`), nikdy v pásmu serveru (pravidlo 11).
 *
 * Bez Reactu a bez databáze, ať se dá zkoušet Nodem
 * (scripts/dochazka-cloveka.test.mjs). Importy s příponou `.ts` kvůli
 * tomu (viz CLAUDE.md, „Čtení tabulek").
 *
 * Docházka se nikdy neposílá do jazykového modelu (pravidlo 8).
 */

import { datetimeLocalVPasmu, hodinaVPasmu, datumACasVPasmu, ZONA_VYCHOZI } from './cas.ts'
import { hodinyAMinuty } from './mzdy.ts'

/* --- řádky z databáze ------------------------------------------------ */

export type DruhRadku =
  | 'usek'
  | 'otevreny'
  | 'navic_prichod'
  | 'odchod_bez_prichodu'
  | 'prestavka_mimo'
  | 'stornovano'

const DRUHY: readonly DruhRadku[] = [
  'usek',
  'otevreny',
  'navic_prichod',
  'odchod_bez_prichodu',
  'prestavka_mimo',
  'stornovano',
]

/** 'kod' = kód z tabletu, 'pin' = PIN na tabletu, 'rucne' = ruční zápis. */
export type Zdroj = 'kod' | 'pin' | 'rucne' | 'terminal'

/** Jeden konec úseku (příchod nebo odchod) — nebo jediný záznam. */
export type ZaznamUseku = {
  id: string
  /** Okamžik, ISO. */
  cas: string
  pobocka: string | null
  /** Pásmo pobočky záznamu. Bez něj výchozí, NIKDY pásmo serveru. */
  zona: string
  zdroj: Zdroj
  /** Důvod u ručního zápisu. */
  poznamka: string | null
  /** Kdo ruční záznam zapsal (jméno z téže firmy). */
  zadal: string | null
  /** Id starého (stornovaného) záznamu, který tenhle nahradil. */
  nahrazuje: string | null
  mimoRozpis: boolean
  /** Kdy systém příchod přestal držet otevřený (nový příchod jiný den). */
  uzavreno: string | null
}

export type RadekUseku = {
  druh: DruhRadku
  /** Provozní den, RRRR-MM-DD. */
  den: string
  poradi: number | null
  /** Druh záznamu u jednotlivých řádků ('in', 'out', 'break_start', 'break_end'). */
  udalostDruh: string | null
  prichod: ZaznamUseku | null
  odchod: ZaznamUseku | null
  prestavkySekund: number
  pausalMinut: number
  hrubychSekund: number | null
  cistychSekund: number
  stornovanoKdy: string | null
  stornovalJmeno: string | null
  duvodStorna: string | null
  /** Stornovaný záznam má náhradu (úprava úseku), ne jen storno. */
  nahrazeno: boolean
  /** worked_minutes toho dne; NULL = volající nevidí celý den. */
  denMinut: number | null
  /** Kreslit tlačítka Upravit/Stornovat. Rozhoduje databáze; tohle je kreslení. */
  smiSpravovat: boolean
  /**
   * Volající vidí VŠECHNY platné záznamy měsíce (u každého řádku stejné).
   * Den celý na pobočce, kam nevidí, v řádcích vůbec není — bez tohohle
   * by karta Odpracováno tvrdila „jako mzda" i tam, kde Výdělky ukazují víc.
   */
  mesicCely: boolean
}

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const cislo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function naZdroj(v: unknown): Zdroj {
  return v === 'pin' || v === 'rucne' || v === 'terminal' ? v : 'kod'
}

function naZaznam(r: Record<string, unknown>, konec: 'prichod' | 'odchod'): ZaznamUseku | null {
  const id = text(r[`${konec}_id`])
  const cas = text(r[konec])
  if (!id || !cas) return null
  return {
    id,
    cas,
    pobocka: text(r[`${konec}_pobocka`]),
    zona: text(r[`${konec}_zona`]) ?? ZONA_VYCHOZI,
    zdroj: naZdroj(r[`${konec}_zdroj`]),
    poznamka: text(r[`${konec}_poznamka`]),
    zadal: text(r[`${konec}_zadal`]),
    nahrazuje: text(r[`${konec}_nahrazuje`]),
    mimoRozpis: r[`${konec}_mimo_rozpis`] === true,
    uzavreno: text(r[`${konec}_uzavreno`]),
  }
}

/**
 * Řádek z `public.useky_cloveka` na tvar pro obrazovku. Řádek neznámého
 * druhu vrací null — nemá se nakreslit jako něco, čím není.
 */
export function naRadekUseku(r: Record<string, unknown>): RadekUseku | null {
  const druh = r.druh as DruhRadku
  if (!DRUHY.includes(druh)) return null
  const den = text(r.den)
  if (!den) return null
  return {
    druh,
    den: den.slice(0, 10),
    poradi: cislo(r.poradi),
    udalostDruh: text(r.udalost_druh),
    prichod: naZaznam(r, 'prichod'),
    odchod: naZaznam(r, 'odchod'),
    prestavkySekund: cislo(r.prestavky_sekund) ?? 0,
    pausalMinut: cislo(r.pausal_minut) ?? 0,
    hrubychSekund: cislo(r.hrubych_sekund),
    cistychSekund: cislo(r.cistych_sekund) ?? 0,
    stornovanoKdy: text(r.stornovano_kdy),
    stornovalJmeno: text(r.stornoval_jmeno),
    duvodStorna: text(r.duvod_storna),
    nahrazeno: r.nahrazeno === true,
    denMinut: cislo(r.den_minut),
    smiSpravovat: r.smi_spravovat === true,
    // Neznámo = opatrně „není celý": karta raději řekne, že to není mzda.
    mesicCely: r.mesic_cely === true,
  }
}

/** Okamžik řádku pro řazení: příchod, u osamělého záznamu jeho čas. */
function okamzikRadku(r: RadekUseku): number {
  const z = r.prichod ?? r.odchod
  const t = z ? Date.parse(z.cas) : Number.NaN
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
}

/**
 * Řádky dne PODLE ČASU (příchod, u osamělého záznamu jeho čas), při shodě
 * podle pořadí automatu. Automat vydá „druhý příchod" v 18:15 dřív než
 * úsek 7:30 → 18:15, do kterého časově patří — čtení dne by pak šlo
 * pozpátku. Stejně řadí `public.useky_cloveka`.
 */
export function podleCasu(radky: RadekUseku[]): RadekUseku[] {
  return [...radky].sort((a, b) => okamzikRadku(a) - okamzikRadku(b) || (a.poradi ?? 0) - (b.poradi ?? 0))
}

/* --- po dnech -------------------------------------------------------- */

export type PenizeDne = {
  /** Haléře ze `vydelek_cloveka_po_dnech`; NULL = bez sazby. */
  haleru: number | null
}

export type DenUseku = {
  den: string
  /** Úseky a otevřený úsek — to, z čeho se počítá (nebo má počítat) mzda. */
  useky: RadekUseku[]
  /** Druhý příchod, odchod bez příchodu, přestávka mimo úsek. */
  nezapocitane: RadekUseku[]
  stornovane: RadekUseku[]
  /** worked_minutes dne; NULL = volající nevidí celý den. */
  denMinut: number | null
  /** Peníze dne; undefined = bez práva na peníze, nebo den bez uzavřené práce. */
  penize?: PenizeDne
}

/**
 * Řádky seskupené po provozních dnech, dny od prvního k poslednímu
 * (jako Výdělky → Po dnech a Můj účet). Uvnitř dne pořadí z databáze.
 */
export function seskupitPoDnech(
  radky: RadekUseku[],
  penize?: Map<string, PenizeDne> | null,
): DenUseku[] {
  const dny = new Map<string, DenUseku>()
  for (const r of radky) {
    let d = dny.get(r.den)
    if (!d) {
      d = { den: r.den, useky: [], nezapocitane: [], stornovane: [], denMinut: r.denMinut }
      dny.set(r.den, d)
    }
    if (r.druh === 'stornovano') d.stornovane.push(r)
    else if (r.druh === 'usek' || r.druh === 'otevreny') d.useky.push(r)
    else d.nezapocitane.push(r)
    // Den bez viditelného součtu (NULL) má přednost: stačí jeden řádek.
    if (r.denMinut === null) d.denMinut = null
  }
  const ven = [...dny.values()].sort((a, b) => a.den.localeCompare(b.den))
  if (penize) {
    // Den bez řádku peněz (jen otevřený úsek, jen storna) peníze nemá —
    // žádná „0 Kč", ta by vypadala jako výsledek.
    for (const d of ven) d.penize = penize.get(d.den)
  }
  return ven
}

export type SouhrnMesice = {
  /** Σ den_minut; počítá se jen z viditelných dnů. */
  minut: number
  /**
   * Volající nevidí celý měsíc (některý den celý nebo zčásti na pobočce,
   * kam nevidí) — součet minut NENÍ mzda.
   */
  castecne: boolean
  dni: number
  useku: number
  /** Otevřené úseky a nezapočítané záznamy. */
  nedokoncene: number
  /** Dny, kde něco nedokončeného je — pro odkazy na kotvy. */
  dnyNedokoncene: string[]
  /** Stornované a nahrazené záznamy. */
  opravy: number
  /**
   * Σ haléřů ze VŠECH dnů `vydelek_cloveka_po_dnech` (= app.earnings =
   * Výdělky), i ze dnů, jejichž úseky volající nevidí. null = bez práva.
   */
  haleru: number | null
  /** Některý den bez sazby — v součtu chybí. */
  bezSazby: boolean
  /** Dny s penězi, jejichž úseky volající nevidí (pobočka, kam nemá docházku). */
  dnuPenezJinde: number
}

/**
 * Součty do přehledových karet — jen sčítání hotových čísel z databáze.
 * `penize`: peníze po dnech (`vydelek_cloveka_po_dnech`), null = bez práva
 * (pak `haleru` zůstane null). Sčítají se VŠECHNY dny peněz, ne jen ty,
 * jejichž úseky jsou vidět — karta Vyděláno musí sedět s Výdělky, odkud
 * se sem chodí.
 */
export function souhrnMesice(dny: DenUseku[], penize: Map<string, PenizeDne> | null = null): SouhrnMesice {
  const s: SouhrnMesice = {
    minut: 0,
    castecne: false,
    dni: 0,
    useku: 0,
    nedokoncene: 0,
    dnyNedokoncene: [],
    opravy: 0,
    haleru: penize ? 0 : null,
    bezSazby: false,
    dnuPenezJinde: 0,
  }
  for (const d of dny) {
    if (d.denMinut === null) s.castecne = true
    else s.minut += d.denMinut
    if ([...d.useky, ...d.nezapocitane, ...d.stornovane].some((r) => !r.mesicCely)) s.castecne = true
    const uzavrene = d.useky.filter((u) => u.druh === 'usek').length
    if (uzavrene > 0) s.dni++
    s.useku += uzavrene
    const nedok = d.useky.filter((u) => u.druh === 'otevreny').length + d.nezapocitane.length
    s.nedokoncene += nedok
    if (nedok > 0) s.dnyNedokoncene.push(d.den)
    s.opravy += d.stornovane.length
  }
  if (penize) {
    const videt = new Set(dny.map((d) => d.den))
    for (const [den, p] of penize) {
      if (p.haleru === null) s.bezSazby = true
      else s.haleru = (s.haleru ?? 0) + p.haleru
      if (!videt.has(den)) s.dnuPenezJinde++
    }
    // Peníze ze dne, jehož úseky nejsou vidět, jsou taky „jinde".
    if (s.dnuPenezJinde > 0) s.castecne = true
  }
  return s
}

/* --- věty a časy ------------------------------------------------------ */

const DNY = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']

/** „Čt 25. 9." — provozní den (datum bez pásma, žádné Date v pásmu serveru). */
export function denNadpis(den: string): string {
  const [r, m, d] = den.split('-').map(Number)
  const t = new Date(Date.UTC(r, m - 1, d))
  if (Number.isNaN(t.getTime())) return den
  return `${DNY[t.getUTCDay()]} ${d}. ${m}.`
}

/** „07:58" v pásmu pobočky záznamu. */
export function casZaznamu(z: ZaznamUseku): string {
  return hodinaVPasmu(z.cas, z.zona)
}

/** „26. 9. 00:10" — když okamžik leží v jiném kalendářním dni než provozní den. */
export function casSDnem(z: ZaznamUseku, den: string): string {
  const kalendarni = datetimeLocalVPasmu(z.cas, z.zona).slice(0, 10)
  return kalendarni === den ? casZaznamu(z) : datumACasVPasmu(z.cas, z.zona)
}

const ZDROJE: Record<Zdroj, string> = {
  kod: 'kód',
  pin: 'PIN na tabletu',
  rucne: 'ručně',
  terminal: 'terminál',
}

/** Zdroj záznamu slovem: „kód", „PIN na tabletu", „ručně". */
export function zdrojSlovy(z: ZaznamUseku): string {
  return ZDROJE[z.zdroj]
}

/** „ručně · Petr Novák: zapomněl telefon" — kdo a proč u ručního zápisu. */
export function rucneSlovy(z: ZaznamUseku): string | null {
  if (z.zdroj !== 'rucne') return null
  const kdo = z.zadal ? ` · ${z.zadal}` : ''
  const proc = z.poznamka ? `: ${z.poznamka}` : ''
  return `ručně${kdo}${proc}`
}

/** Minuty jedním tvarem v celé aplikaci: „13 h 2 min". */
export function minutySlovy(minut: number): string {
  return hodinyAMinuty(Math.max(0, Math.floor(minut)))
}

/**
 * „13 h 12 min − paušál 10 min = 13 h 2 min" / „− přestávka 20 min".
 * Bez odpočtu jen „8 h 0 min". Minuty ze sekund dolů, jako den.
 */
export function vypocetUseku(r: RadekUseku): string | null {
  if (r.druh !== 'usek' || r.hrubychSekund === null) return null
  const hrube = minutySlovy(r.hrubychSekund / 60)
  const ciste = minutySlovy(r.cistychSekund / 60)
  if (r.prestavkySekund > 0) {
    const pauza = Math.floor(r.prestavkySekund / 60)
    // Přestávka pod hodinu jen minutami („20 min"), jako paušál.
    const pauzaSlovy = pauza < 60 ? `${pauza} min` : minutySlovy(pauza)
    return `${hrube} − přestávka ${pauzaSlovy} = ${ciste}`
  }
  if (r.pausalMinut > 0) return `${hrube} − paušál ${r.pausalMinut} min = ${ciste}`
  return ciste
}

/**
 * Úsek, jehož příchod a odchod jsou v TÉŽE chvíli (v ostré DB 27. 9.:
 * ruční příchod i odchod 09:00:00). Mzda ho bere jako úsek 0 min, přehled
 * dne („v práci") jako otevřený příchod — proto slovy, ať se opraví odchod.
 */
export function nulovyUsekSlovy(r: RadekUseku): string | null {
  if (r.druh !== 'usek' || !r.prichod || !r.odchod) return null
  if (Date.parse(r.prichod.cas) !== Date.parse(r.odchod.cas)) return null
  return 'Příchod a odchod ve stejnou chvíli — úsek má 0 min a přehled dne ho přitom ukazuje jako „v práci“. Zkontrolujte odchod.'
}

/** Proč se řádek do mzdy nepočítá — slovy, barva nikdy sama. */
export function procSeNepocita(r: RadekUseku): string | null {
  switch (r.druh) {
    case 'otevreny':
      return 'Chybí odchod — do mzdy se nepočítá.'
    case 'navic_prichod':
      return 'Druhý příchod, když ten první ještě nebyl uzavřený — do mzdy se nepočítá.'
    case 'odchod_bez_prichodu':
      return 'Odchod bez příchodu — do mzdy se nepočítá.'
    case 'prestavka_mimo':
      return 'Přestávka mimo úsek — nepočítá se.'
    default:
      return null
  }
}

const DRUH_ZAZNAMU: Record<string, string> = {
  in: 'příchod',
  out: 'odchod',
  break_start: 'začátek přestávky',
  break_end: 'konec přestávky',
}

export function druhZaznamuSlovy(kind: string | null): string {
  return (kind && DRUH_ZAZNAMU[kind]) ?? 'záznam'
}

/** Jediný záznam řádku (nezapočítaný nebo stornovaný). */
export function jedinyZaznam(r: RadekUseku): ZaznamUseku | null {
  return r.prichod ?? r.odchod
}

/**
 * „opraveno z 21:40 (kód)" — když záznam nahradil jiný a ten starý je
 * mezi stornovanými téhož měsíce. Když starý volající nevidí, jen
 * „opraveno".
 */
export function opravenoZ(z: ZaznamUseku, stornovane: RadekUseku[]): string | null {
  if (!z.nahrazuje) return null
  const stary = stornovane.map(jedinyZaznam).find((s) => s?.id === z.nahrazuje)
  if (!stary) return 'opraveno'
  return `opraveno z ${casZaznamu(stary)} (${zdrojSlovy(stary)})`
}

/** Předvyplnění formuláře: datum a čas na zdi v pásmu pobočky záznamu. */
export function naZdi(z: ZaznamUseku | null): { datum: string; cas: string } | null {
  if (!z) return null
  const hodnota = datetimeLocalVPasmu(z.cas, z.zona)
  if (!hodnota) return null
  return { datum: hodnota.slice(0, 10), cas: hodnota.slice(11, 16) }
}

/* --- adresa ----------------------------------------------------------- */

export const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Odkud se na obrazovku přišlo — výčet, ne adresa (vzor `zpet` v dochazka/akce.ts). */
export type Odkud = 'vydelky' | 'prehled' | 'lide'

export function naOdkud(v: unknown): Odkud | null {
  return v === 'vydelky' || v === 'prehled' || v === 'lide' ? v : null
}

/** Odkaz zpět podle toho, odkud se přišlo. */
export function odkazZpet(
  rozsah: string,
  odkud: Odkud | null,
  osoba: string,
  mesic: string,
): { href: string; popisek: string } {
  if (odkud === 'vydelky') return { href: `/${rozsah}/dochazka/vydelky?mesic=${mesic}`, popisek: 'Výdělky' }
  if (odkud === 'lide') return { href: `/${rozsah}/nastaveni/lide`, popisek: 'Lidé' }
  if (odkud === 'prehled') return { href: `/${rozsah}/dochazka?osoba=${osoba}`, popisek: 'Přehled docházky' }
  return { href: `/${rozsah}/dochazka`, popisek: 'Docházka' }
}

/** Adresa obrazovky člověka (měsíc RRRR-MM, odkud). */
export function adresaCloveka(
  rozsah: string,
  osoba: string,
  v: { mesic?: string | null; odkud?: Odkud | null } = {},
): string {
  const q = new URLSearchParams()
  if (v.mesic) q.set('mesic', v.mesic)
  if (v.odkud) q.set('z', v.odkud)
  const s = q.toString()
  return `/${rozsah}/dochazka/clovek/${osoba}${s ? `?${s}` : ''}`
}

/**
 * Měsíc z adresy ve tvaru RRRR-MM, nebo null. Adrese se nevěří: nesmysl
 * se tiše nahradí měsícem provozního dne.
 */
export function platnyMesic(hodnota: unknown): string | null {
  if (typeof hodnota !== 'string' || !/^\d{4}-\d{2}$/.test(hodnota)) return null
  const rok = Number(hodnota.slice(0, 4))
  const m = Number(hodnota.slice(5, 7))
  if (rok < 2000 || rok > 2100 || m < 1 || m > 12) return null
  return hodnota
}

/** Provozní den RRRR-MM-DD z adresy, nebo null. */
export function platnyDen(hodnota: unknown): string | null {
  if (typeof hodnota !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(hodnota)) return null
  return hodnota
}

/** O kolik měsíců vedle. Čistě řetězcově — žádné Date v pásmu serveru. */
export function posunMesic(prvniDen: string, o: number): string {
  const index = Number(prvniDen.slice(0, 4)) * 12 + Number(prvniDen.slice(5, 7)) - 1 + o
  const rok = Math.floor(index / 12)
  const mesic = (index % 12) + 1
  return `${rok}-${String(mesic).padStart(2, '0')}-01`
}

/** Datum o den dál („odchod až po půlnoci"). Řetězcově, bez pásma. */
export function dalsiDen(datum: string): string {
  const [r, m, d] = datum.split('-').map(Number)
  const t = new Date(Date.UTC(r, m - 1, d + 1))
  return t.toISOString().slice(0, 10)
}
