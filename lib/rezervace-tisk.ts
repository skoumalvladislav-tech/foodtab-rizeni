/**
 * Tisk přehledu akcí a rezervací (Šéfík 25. 11. 2026: tlačítko v Rozpisu
 * a v Rezervacích, kterým si vytiskne přehled akcí).
 *
 * Co se tiskne: období, které je na obrazovce vidět (den, týden, měsíc
 * Rezervací nebo okno Rozpisu směn), za pobočky rozsahu — a z nich jen
 * ty, na které člověk na rezervace dosáhne (to rozhodla stránka přes
 * `zkusPristupRezervacim`, sem už přijdou hotové).
 *
 * U každé položky: datum a čas, název, počet hostů, stůl nebo prostor
 * (týmž `mistoKratce` jako kalendář a ranní souhrn), kontaktní osoba
 * a poznámka. Telefon jen tam, kde ho stránka načetla — tedy jen na
 * pobočkách s `rezervace.manage`, stejně jako detail rezervace.
 *
 * Čistý modul (žádné IO, importy s příponou `.ts`), testuje ho
 * scripts/rezervace-tisk.test.mjs. Kreslí app/[rozsah]/rezervace/tisk/obsah.tsx.
 */

import { hodinaVPasmu } from './cas.ts'
import { denDlouze, hosteText, nazevMesice, nazevTydne, pondeli, pridatDny, souhrnDne, type Pohled, type SouhrnDne } from './rezervace-kalendar.ts'
import { mistoKratce, type MistoRadku } from './rezervace-misto.ts'
import { obdobiPohledu } from './rezervace-pobocky.ts'
import { NAZVY_DRUHU, NAZVY_STAVU, adresaPod, jePlatneDatum, pocitaSeDoHostu, type DruhRezervace, type StavRezervace } from './rezervace-typy.ts'
import { DNU_V_ROZPISU } from './rozpis-konstanty.ts'
import { pocet } from './sklonovani.ts'

/* ---------------------------------------------------------------------
 * Období a volby z adresy
 * ------------------------------------------------------------------ */

/**
 * Nejdelší období, které jde vytisknout. Měsíc má nejvýš 31 dní; dva
 * měsíce s rezervou stačí na cokoli, co obrazovka ukazuje, a nepustí
 * „celý rok“ jedním odkazem (dotaz by narazil na strop řádků).
 */
export const NEJDELSI_OBDOBI = 62

const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function naDatum(iso: string): number {
  const [r, m, d] = iso.split('-').map(Number)
  return Date.UTC(r, m - 1, d)
}

/** Kolik dní má období od–do včetně obou konců. */
export function dnuObdobi(od: string, doDne: string): number {
  return Math.round((naDatum(doDne) - naDatum(od)) / 86_400_000) + 1
}

/** Všechny dny období, od prvního po poslední. */
export function dnyObdobi(od: string, doDne: string): string[] {
  const n = dnuObdobi(od, doDne)
  return Array.from({ length: Math.max(0, n) }, (_, i) => pridatDny(od, i))
}

/** Období, které ukazuje pohled Rezervací — týden pondělí–neděle, měsíc bez dnů sousedních měsíců. */
export function obdobiTiskuZPohledu(pohled: Pohled, datum: string): { od: string; do: string } {
  return obdobiPohledu(pohled, datum)
}

/**
 * Období, které ukazuje Rozpis směn na počítači (app/[rozsah]/smeny/rozpis.tsx):
 * Den = ten den; 7 dní a Týden = okno `DNU_V_ROZPISU` dnů od `zacatekOkna`
 * (u Týdne pondělí); Měsíc a Měsíc lidí = celý měsíc dne.
 */
export function obdobiTiskuZRozpisu(pohled: string, den: string, zacatekOkna: string): { od: string; do: string } {
  if (pohled === 'den') return { od: den, do: den }
  if (pohled === 'mesic' || pohled === 'osoby') return obdobiPohledu('mesic', den)
  return { od: zacatekOkna, do: pridatDny(zacatekOkna, DNU_V_ROZPISU - 1) }
}

export type VolbyTisku = {
  od: string
  do: string
  /** Jen akce, bez rezervací hostů. */
  jenAkce: boolean
  /** I zrušené a ty, kdo nedorazili. */
  sZrusenymi: boolean
  /**
   * Pobočky vybrané v „Zobrazit“ Rozpisu směn (id); prázdné = všechny
   * pobočky rozsahu. Výběr jen ZÚŽÍ, nikdy nerozšíří — co z něj člověk
   * smí vidět, rozhodne stránka (`zkusPristupRezervacim`).
   */
  pobocky: string[]
  /** Kam „Zpět“ — kontroluje `zpatkyZTisku`. */
  zpet: string | null
}

/** Víc poboček v jednom odkazu nedává smysl; strop jen proti nesmyslně dlouhé adrese. */
const NEJVIC_POBOCEK = 50

type Parametry = Record<string, string | string[] | undefined>

/** Parametr, který v adrese je právě jednou (dvakrát → Next dá pole a to se nebere). */
const jeden = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Volby tisku z adresy. Bez `od` i `do` = tento týden. `null` = adresa
 * nedává smysl (neplatné datum, konec před začátkem, delší než
 * `NEJDELSI_OBDOBI`, pobočka, která není id) — stránka to řekne, nic nehádá.
 */
export function volbyZAdresy(p: Parametry, dnes: string): VolbyTisku | null {
  const odText = jeden(p.od)
  const doText = jeden(p.do)
  let od: string
  let doDne: string
  if (p.od === undefined && p.do === undefined) {
    ;({ od, do: doDne } = obdobiPohledu('tyden', dnes))
  } else {
    if (!odText || !doText || !jePlatneDatum(odText) || !jePlatneDatum(doText)) return null
    od = odText
    doDne = doText
  }
  if (doDne < od || dnuObdobi(od, doDne) > NEJDELSI_OBDOBI) return null

  // `pobocky=id,id`. Cokoli, co není seznam id, je chyba odkazu — ne „všechny“:
  // z poškozeného výběru by se jinak potichu vytiskla celá firma.
  let pobocky: string[] = []
  if (p.pobocky !== undefined) {
    const text = jeden(p.pobocky)
    if (text === undefined) return null
    pobocky = [...new Set(text.split(','))]
    if (pobocky.length > NEJVIC_POBOCEK || !pobocky.every((id) => VZOR_ID.test(id))) return null
  }

  return {
    od,
    do: doDne,
    jenAkce: jeden(p.co) === 'akce',
    sZrusenymi: jeden(p.zrusene) === '1',
    pobocky,
    zpet: jeden(p.zpet) ?? null,
  }
}

/** Adresa tiskové stránky. Volby, které jsou výchozí, se do adresy nepíšou. */
export function adresaTisku(
  rozsah: string,
  v: {
    od: string
    do: string
    zpet?: string | null
    pobocky?: readonly string[]
    jenAkce?: boolean
    sZrusenymi?: boolean
    hned?: boolean
  },
): string {
  const q = new URLSearchParams({ od: v.od, do: v.do })
  if (v.jenAkce) q.set('co', 'akce')
  if (v.sZrusenymi) q.set('zrusene', '1')
  if (v.pobocky && v.pobocky.length > 0) q.set('pobocky', v.pobocky.join(','))
  if (v.zpet) q.set('zpet', v.zpet)
  // Tlačítko z kalendáře nebo Rozpisu: okno tisku se otevře samo (tisk/tlacitko.tsx).
  if (v.hned) q.set('hned', '1')
  return `/${rozsah}/rezervace/tisk?${q.toString()}`
}

/**
 * Odkaz „Zpět“ z tisku: jen do Rezervací nebo do Rozpisu směn téhož
 * rozsahu, a jen adresou, kterou prohlížeč nezmění (`adresaPod`, táž
 * kontrola jako `bezpecnaZpatky`). Na tisk sám se nevrací (smyčka).
 * Cokoli jiného = kalendář Rezervací na týdnu začátku období.
 */
export function zpatkyZTisku(rozsah: string, zpet: string | null | undefined, od: string): { href: string; text: string } {
  const rezervace = adresaPod(`/${rozsah}/rezervace`, zpet)
  if (rezervace && !adresaPod(`/${rozsah}/rezervace/tisk`, rezervace)) return { href: rezervace, text: 'Zpět do Rezervací' }
  const rozpis = adresaPod(`/${rozsah}/smeny`, zpet)
  if (rozpis) return { href: rozpis, text: 'Zpět na Rozpis směn' }
  return { href: `/${rozsah}/rezervace?pohled=tyden&datum=${od}`, text: 'Zpět do Rezervací' }
}

/**
 * Jak se období jmenuje v záhlaví tisku: den celým jménem, týden
 * a měsíc jako v kalendáři, jinak „23. 11. – 29. 11. 2026“.
 */
export function nazevObdobi(od: string, doDne: string): string {
  if (od === doDne) return denDlouze(od)
  if (pondeli(od) === od && pridatDny(od, 6) === doDne) return `Týden ${nazevTydne(od)}`
  if (od.endsWith('-01') && obdobiPohledu('mesic', od).do === doDne) return nazevMesice(od)
  const [r1, m1, d1] = od.split('-').map(Number)
  const [r2, m2, d2] = doDne.split('-').map(Number)
  return r1 === r2 ? `${d1}. ${m1}. – ${d2}. ${m2}. ${r2}` : `${d1}. ${m1}. ${r1} – ${d2}. ${m2}. ${r2}`
}

/* ---------------------------------------------------------------------
 * Sestavení přehledu
 * ------------------------------------------------------------------ */

export type PoznamkaKTisku = { nadpis: string; obsah: string; vytvoreno_kdy: string }

/** Poznámka ke dni pobočky („kapela od 20:00, sál zavřený“). */
export type PoznamkaDneKTisku = PoznamkaKTisku & { branch_id: string; den: string }

/** Řádek rezervace tak, jak ho načte stránka tisku (app/[rozsah]/rezervace/data.ts, `nacistTisk`). */
export type RezervaceKTisku = MistoRadku & {
  id: string
  branch_id: string
  den: string
  druh: DruhRezervace
  stav: StavRezervace
  nazev: string
  jmeno_hosta: string
  zacatek: string
  konec: string | null
  pocet_osob: number | null
  typ_akce: string
  menu: string
  poznamka_zdroje: string
  /** Pásmo pobočky — časy se tisknou v něm (CLAUDE.md, pravidlo 11). */
  zona: string
  /** Poznámky obsluhy k rezervaci (rezervace_poznamky), v libovolném pořadí. */
  poznamky: readonly PoznamkaKTisku[]
}

export type PolozkaTisku = {
  id: string
  /** „18:00–23:00“ v pásmu pobočky. */
  cas: string
  nazev: string
  /** Druh, typ akce a stav, pokud nejsou už v názvu („Akce · Svatba · Předběžná“). */
  popis: string
  /** Počet hostů číslem; „—“ = neuvedeno. */
  hoste: string
  /** Stůl nebo prostor; `''` = data ho nemají. */
  misto: string
  kontakt: string
  /** `''` = neznámý, nebo ho člověk vidět nesmí (stránka ho nenačetla). */
  telefon: string
  poznamky: string[]
  /** Zrušená nebo nedorazili — tiskne se slovem i přeškrtnutím, ne barvou. */
  zrusena: boolean
}

export type DenTisku = {
  den: string
  /** „Pátek 27. listopadu 2026“ */
  nadpis: string
  /** „1 akce · 3 rezervace · 64 hostů“ / „Žádná akce ani rezervace“ */
  souhrn: string
  poznamky: string[]
  polozky: PolozkaTisku[]
}

export type OddilTisku = {
  pobocka: { id: string; nazev: string }
  souhrn: string
  dny: DenTisku[]
}

export type Tisk = {
  /** „Přehled akcí a rezervací“ / „Přehled akcí“ */
  nadpis: string
  /** „Týden 23. 11. – 29. 11. 2026“ */
  obdobi: string
  /** Co v přehledu je: „Akce i rezervace · bez zrušených (2 vynechané)“. */
  rozsahTisku: string
  oddily: OddilTisku[]
  /** Kolik zrušených a nedorazivších se vynechalo (`sZrusenymi` = 0). */
  vynechano: number
}

/** Do kolika dní se v přehledu ukazují i dny bez záznamu („Žádná akce ani rezervace“) — den a týden ano, měsíc ne. */
export const PRAZDNE_DNY_DO = 7

const poznamkaText = (p: { nadpis: string; obsah: string }) => {
  const nadpis = p.nadpis.trim()
  const obsah = p.obsah.trim()
  return nadpis ? `${nadpis}: ${obsah}` : obsah
}

const podleVzniku = (a: PoznamkaKTisku, b: PoznamkaKTisku) => Date.parse(a.vytvoreno_kdy) - Date.parse(b.vytvoreno_kdy)

/**
 * „1 akce · 3 rezervace · 64 hostů“ — bez nul. Den bez záznamu říká, ČEHO
 * tam není („Žádná akce ani rezervace“, u „Jen akce“ „Žádná akce“) — ne
 * „nic“: poznámka ke dni („kapela od 20:00“) pod ním být může.
 */
export function souhrnTisku(s: SouhrnDne, jenAkce = false): string {
  if (s.rezervaci + s.akci === 0) {
    if (s.zrusenych) return 'Jen zrušené nebo nedorazili'
    return jenAkce ? 'Žádná akce' : 'Žádná akce ani rezervace'
  }
  return [
    s.akci ? pocet(s.akci, 'akce', 'akce', 'akcí') : null,
    s.rezervaci ? pocet(s.rezervaci, 'rezervace', 'rezervace', 'rezervací') : null,
    hosteText(s),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Jedna položka přehledu. `telefon` dodá stránka (jen pobočky s `rezervace.manage`). */
export function polozkaTisku(r: RezervaceKTisku, telefon: string): PolozkaTisku {
  const akce = r.druh === 'akce'
  const nazev = r.nazev.trim() || (akce ? r.typ_akce.trim() || 'Akce bez názvu' : 'Rezervace')
  const typ = r.typ_akce.trim()
  const popis = [
    nazev === NAZVY_DRUHU[r.druh] ? null : NAZVY_DRUHU[r.druh],
    akce && typ && typ !== nazev ? typ : null,
    r.stav === 'potvrzeno' ? null : NAZVY_STAVU[r.stav],
  ]
    .filter(Boolean)
    .join(' · ')
  const od = hodinaVPasmu(r.zacatek, r.zona)
  const poznamky = [
    ...[...r.poznamky].sort(podleVzniku).map(poznamkaText),
    r.poznamka_zdroje.trim() ? `Poznámka hosta: ${r.poznamka_zdroje.trim()}` : null,
    r.menu.trim() ? `Menu: ${r.menu.trim()}` : null,
  ].filter((t): t is string => !!t)
  return {
    id: r.id,
    cas: r.konec ? `${od}–${hodinaVPasmu(r.konec, r.zona)}` : od,
    nazev,
    popis,
    hoste: r.pocet_osob === null ? '—' : String(r.pocet_osob),
    misto: mistoKratce(r).join(' · '),
    kontakt: r.jmeno_hosta.trim(),
    telefon: telefon.trim(),
    poznamky,
    zrusena: !pocitaSeDoHostu(r.stav),
  }
}

/**
 * Celý přehled: oddíl za každou pobočku (v pořadí `pobocky`), v něm dny
 * období, v dni položky podle začátku. Pobočky, rezervace a telefony
 * přicházejí už omezené stránkou — tady se nic nepovoluje ani neschovává
 * kvůli právu, jen podle voleb tisku (jen akce, bez zrušených).
 */
export function sestavitTisk({
  pobocky,
  rezervace,
  poznamkyDnu,
  telefony,
  volby,
}: {
  pobocky: readonly { id: string; nazev: string }[]
  rezervace: readonly RezervaceKTisku[]
  poznamkyDnu: readonly PoznamkaDneKTisku[]
  telefony: ReadonlyMap<string, string>
  volby: Pick<VolbyTisku, 'od' | 'do' | 'jenAkce' | 'sZrusenymi'>
}): Tisk {
  const vObdobi = rezervace.filter((r) => r.den >= volby.od && r.den <= volby.do && (!volby.jenAkce || r.druh === 'akce'))
  const tisknout = volby.sZrusenymi ? vObdobi : vObdobi.filter((r) => pocitaSeDoHostu(r.stav))
  const vynechano = vObdobi.length - tisknout.length
  const dny = dnyObdobi(volby.od, volby.do)
  const iPrazdne = dny.length <= PRAZDNE_DNY_DO

  const oddily = pobocky.map((p) => {
    const jeho = tisknout
      .filter((r) => r.branch_id === p.id)
      .sort((a, b) => a.den.localeCompare(b.den) || Date.parse(a.zacatek) - Date.parse(b.zacatek))
    const dnyOddilu: DenTisku[] = []
    for (const den of dny) {
      const radky = jeho.filter((r) => r.den === den)
      const poznamky = poznamkyDnu
        .filter((n) => n.branch_id === p.id && n.den === den)
        .sort(podleVzniku)
        .map(poznamkaText)
      if (!iPrazdne && radky.length === 0 && poznamky.length === 0) continue
      dnyOddilu.push({
        den,
        nadpis: denDlouze(den),
        souhrn: souhrnTisku(souhrnDne(radky), volby.jenAkce),
        poznamky,
        polozky: radky.map((r) => polozkaTisku(r, telefony.get(r.id) ?? '')),
      })
    }
    return { pobocka: { id: p.id, nazev: p.nazev }, souhrn: souhrnTisku(souhrnDne(jeho), volby.jenAkce), dny: dnyOddilu }
  })

  const co = volby.jenAkce ? 'Jen akce' : 'Akce i rezervace'
  const zrusene = volby.sZrusenymi
    ? 'i zrušené a nedorazivší'
    : vynechano > 0
      ? `bez zrušených a nedorazivších (${pocet(vynechano, 'vynechaná', 'vynechané', 'vynechaných')})`
      : 'bez zrušených a nedorazivších'
  return {
    nadpis: volby.jenAkce ? 'Přehled akcí' : 'Přehled akcí a rezervací',
    obdobi: nazevObdobi(volby.od, volby.do),
    rozsahTisku: `${co} · ${zrusene}`,
    oddily,
    vynechano,
  }
}
