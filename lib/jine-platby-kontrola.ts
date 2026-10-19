/**
 * Jiné platby — kontrola rozpoznaného dokladu a ručně upraveného návrhu.
 *
 * Co tu hlídáme a proč (gastro doklady mají několik částek, které se
 * snadno spletou):
 *
 *   celkem         celková cena prodeje (zboží po slevách) → JEDINÁ částka,
 *                  která smí jít do tržby (`castka_haleru`)
 *   K úhradě       co má host zaplatit — může být po záloze, po částečné
 *                  platbě, nebo i se spropitným. NENÍ to cena prodeje.
 *   zaplaceno /    část už zaplacená a zbytek. Platí K úhradě = zaplaceno
 *   zbývá          + zbývá.
 *   přijato hotově hotovost, kterou host podal, a co dostal zpátky —
 *   / vráceno      NIKDY to není tržba. Platí vráceno = přijato − K úhradě.
 *   spropitné      do ceny prodeje nepatří (není to prodej zboží ani služby
 *                  podniku), proto se do součtu položek nepočítá.
 *
 * Nic se nedomýšlí: chybějící množství, cena, měna nebo DPH zůstanou
 * prázdné a řádek dostane příznak ke kontrole s důvodem. Vypočtený
 * součet položek se nabídne jen jako NÁVRH (`navrhCelkem`), do hlavičky
 * ho nezapíšeme.
 *
 * Důvody u řádků jsou tří druhů (důležité pro `zkontrolovatNavrh`):
 *   1. věcné — chybí množství nebo cena, nesedí množství × cena, kladná
 *      sleva… Spočítají se z údajů řádku kdykoli znovu.
 *   2. převod do jednotek pokladny (předpona PREDPONA_PREVODU) — počítá
 *      lib/jine-platby-mapovani.ts, tady se jen přenášejí.
 *   3. čtení dokladu — nejistě přečtený řádek, nula na dokladu, otočené
 *      znaménko slevy, nečitelná DPH, cena v jiné měně, než je doklad,
 *      poznámka AI k řádku („Poznámka z dokladu: přeškrtnuto…"). Z údajů
 *      je znovu spočítat nejde; zmizí, až je člověk u řádku výslovně
 *      potvrdí (`potvrditRadek`).
 *
 * Čisté funkce — testuje scripts/jine-platby.test.mjs přímo Nodem.
 */

import type {
  DruhPolozky,
  HlavickaNavrhu,
  PolozkaNavrhu,
  RozpoznanaPolozka,
  RozpoznanyDoklad,
  TypDokladu,
} from './jine-platby-typy.ts'
import { DRUHY_BEZ_SKLADU, DRUHY_POLOZEK, TYPY_DOKLADU } from './jine-platby-typy.ts'
import {
  MAX_HALERU,
  MAX_MNOZSTVI_TISICIN,
  formatCislaHaleru,
  formatHaleru,
  mnozstviNaTisiciny,
  prevestCastku,
  prevestMnozstvi,
  vynasobit,
  zkratit,
} from './jine-platby-castky.ts'

/**
 * Hotovost se v Česku platí v celých korunách (haléřové mince skončily
 * 2008) a pokladna celkovou částku při placení v hotovosti zaokrouhlí —
 * nejvýš o 49 haléřů nahoru nebo dolů, podle způsobu zaokrouhlení
 * i o 50. Rozdíl do 50 haléřů mezi celkem a součtem položek (nebo mezi
 * K úhradě, přijatou a vrácenou hotovostí) je proto zaokrouhlení, ne
 * nesoulad. Platí pro CZK a pro doklad bez uvedené měny (ten je
 * v praxi skoro vždycky v korunách a ke kontrole jde tak jako tak kvůli
 * chybějící měně). U ostatních měn musí částky sedět přesně.
 */
export const TOLERANCE_ZAOKROUHLENI_HALERU = 50

/** Pod touhle jistotou AI (0–1) jde řádek ke kontrole. */
export const MIN_JISTOTA_RADKU = 0.7
/** Pod touhle jistotou AI (0–1) jde ke kontrole celý doklad. */
export const MIN_JISTOTA_DOKLADU = 0.8

/** Předpona důvodů, které píše převod do jednotek pokladny (lib/jine-platby-mapovani.ts). */
export const PREDPONA_PREVODU = 'Převod do jednotek pokladny: '

/** Obecný důvod pro řádek, který někdo označil ke kontrole bez textu. */
export const DUVOD_OZNACENO = 'Označeno ke kontrole'

/** Začátek důvodu z poznámky AI k řádku (skupina důvodů ze čtení dokladu). */
export const PREDPONA_POZNAMKY = 'Poznámka z dokladu: '
/** Poznámka AI jde do důvodu zkrácená — `duvod_kontroly` má v databázi strop 1000 znaků. */
export const MAX_DELKA_POZNAMKY = 120

export type CastkyDokladu = {
  celkem: number | null
  kUhrade: number | null
  zaplaceno: number | null
  prijatoHotove: number | null
  vraceno: number | null
  zbyva: number | null
  /** Výše slevy jako KLADNÉ číslo (na dokladu bývá s mínusem i bez). */
  sleva: number | null
  spropitne: number | null
}

export type Nesoulad = { rozdilHaleru: number; popis: string }

export type KontrolaDokladu = {
  polozky: PolozkaNavrhu[]
  hlavicka: HlavickaNavrhu
  castky: CastkyDokladu
  /**
   * Součet cen celkem všech položek KROMĚ spropitného (sleva jako
   * záporný řádek je v součtu). Cena celkem, která chybí, se dopočte
   * z množství × jednotkové ceny; když to nejde, je součet null.
   * Bez položek null.
   */
  soucetPolozekHaleru: number | null
  navrhCelkem: { haleru: number; puvod: 'vypocet' } | null
  nesoulad: Nesoulad | null
  duvody: string[]
  /**
   * Podmnožina `duvody`, která se týká CELÉHO dokladu a z uložených
   * položek a hlavičky znovu spočítat nejde (N27): nízká jistota dokladu,
   * každé upozornění AI (zachycený pokyn v textu, „víc dokladů v jednom"…),
   * K úhradě / zaplaceno / zbývá nesedí s celkem a posun data podle času
   * tisku (N31). Ukládá se k záznamu (`HlavickaNavrhu.upozorneniDokladu`)
   * a dokud nějaké je, označit záznam jako zkontrolovaný jde jen
   * s výslovným potvrzením. Řádkové důvody zůstávají na řádcích, nesoulad
   * součtu a chybějící údaje hlídá databáze sama — tady nejsou.
   * Nejvýš `MAX_UPOZORNENI_DOKLADU` položek po `MAX_DELKA_UPOZORNENI_DOKLADU`
   * znacích (strop databáze).
   */
  upozorneniDokladu: string[]
  vyzadujeKontrolu: boolean
}

/** Strop počtu upozornění k dokladu — musí sedět s `jine_platby_ulozit_navrh` (max 20 × 300 znaků). */
export const MAX_UPOZORNENI_DOKLADU = 20
/** Strop délky jednoho upozornění k dokladu (znaky) — musí sedět s migrací. */
export const MAX_DELKA_UPOZORNENI_DOKLADU = 300

/* ------------------------------------------------------------------ */
/* Důvody                                                               */
/* ------------------------------------------------------------------ */

/** Text v `duvodKontroly` → seznam důvodů (oddělené „; "). */
export function rozdelitDuvody(s: string): string[] {
  return s
    .split('; ')
    .map((x) => x.trim())
    .filter((x) => x !== '')
}

/** Seznam důvodů → text do `duvodKontroly` (bez opakování). */
export function spojitDuvody(duvody: readonly string[]): string {
  return [...new Set(duvody.map((x) => x.trim()).filter((x) => x !== ''))].join('; ')
}

/** Věcné důvody — začátky textů, které skládá `problemyRadku`. */
const VECNE = {
  chybiNazev: 'Chybí název položky',
  chybiMnozstvi: 'Chybí množství',
  neplatneMnozstvi: 'Množství není platné kladné číslo',
  chybiCena: 'Chybí cena',
  neplatnaCena: 'Cena není celé číslo haléřů',
  nesediSoucin: 'Množství × jednotková cena',
  slevaKladna: 'Sleva musí mít zápornou cenu',
  zapornaCena: 'Záporná cena je povolená jen u slevy',
  druhNeurceny: 'Druh položky není určený',
} as const

const jeVecny = (d: string) => Object.values(VECNE).some((p) => d.startsWith(p))
const jePrevod = (d: string) => d.startsWith(PREDPONA_PREVODU)

/**
 * Přepíše důvody řádku: odstraní ty, na které platí `odstranit`, přidá
 * `pridat` a podle výsledku nastaví příznak. Řádek s příznakem, ale bez
 * textu, o příznak nepřijde (dostane obecný důvod) — tichá ztráta
 * příznaku by byla horší než jedno slovo navíc.
 */
export function upravitDuvody(p: PolozkaNavrhu, odstranit: (d: string) => boolean, pridat: readonly string[]): PolozkaNavrhu {
  const puvodni = rozdelitDuvody(p.duvodKontroly)
  const zustava = puvodni.length === 0 && p.vyzadujeKontrolu ? [DUVOD_OZNACENO] : puvodni.filter((d) => !odstranit(d))
  const vse = spojitDuvody([...pridat, ...zustava])
  return { ...p, vyzadujeKontrolu: vse !== '', duvodKontroly: vse }
}

/* ------------------------------------------------------------------ */
/* Pomocníci                                                            */
/* ------------------------------------------------------------------ */


function tolerance(mena: string | null): number {
  return mena === null || mena === 'CZK' ? TOLERANCE_ZAOKROUHLENI_HALERU : 0
}

function castkaTextem(h: number, mena: string | null): string {
  return mena ? formatHaleru(h, mena) : formatCislaHaleru(h)
}

const platnaCena = (c: number | null) => c === null || (Number.isSafeInteger(c) && Math.abs(c) <= MAX_HALERU)

function platneMnozstviTisicin(m: string | null): number | null {
  if (m === null) return null
  const t = mnozstviNaTisiciny(m)
  return t !== null && t > 0 && t <= MAX_MNOZSTVI_TISICIN ? t : null
}

/** Množství × cena, nebo null, když výsledek přesáhne strop databáze (nesmysl z přečtení). */
function soucin(m: string, cena: number): number | null {
  try {
    const v = vynasobit(m, cena)
    return Math.abs(v) <= MAX_HALERU ? v : null
  } catch {
    return null
  }
}

/**
 * Cena celkem řádku: z dokladu, jinak množství × jednotková cena.
 * `null`, když ani jedno nejde. Dopočet se NEZAPISUJE do řádku —
 * slouží jen součtu.
 */
export function cenaCelkemRadku(p: PolozkaNavrhu): number | null {
  if (p.cenaCelkemHaleru !== null) return platnaCena(p.cenaCelkemHaleru) ? p.cenaCelkemHaleru : null
  const t = platneMnozstviTisicin(p.mnozstvi)
  if (t === null || p.cenaJednotkovaHaleru === null || !platnaCena(p.cenaJednotkovaHaleru)) return null
  return soucin(p.mnozstvi as string, p.cenaJednotkovaHaleru)
}

/**
 * Součet položek pro porovnání s celkovou cenou prodeje: bez spropitného,
 * slevy jako záporné řádky. `null`, když je seznam prázdný nebo některé
 * položce cena chybí.
 */
export function soucetPolozek(polozky: readonly PolozkaNavrhu[]): number | null {
  const prodej = polozky.filter((p) => p.druh !== 'spropitne')
  if (prodej.length === 0) return null
  let s = 0
  for (const p of prodej) {
    const c = cenaCelkemRadku(p)
    if (c === null) return null
    s += c
  }
  return s
}

/**
 * Jednotková cena na dokladu bývá zaokrouhlená na haléře, takže u N kusů
 * se součin může od ceny celkem lišit až o N/2 haléře. Tolerance je proto
 * půl haléře na kus, nejméně 1 haléř.
 */
function toleranceRadku(tisicin: number): number {
  return Math.max(1, Math.ceil(tisicin / 2000))
}

/**
 * Věcné problémy jednoho řádku — dají se spočítat z jeho údajů kdykoli
 * znovu (proto je `zkontrolovatNavrh` po ruční úpravě přepočítá).
 */
export function problemyRadku(p: PolozkaNavrhu, mena: string | null): string[] {
  const r: string[] = []
  if (p.nazev.trim() === '') r.push(VECNE.chybiNazev)

  let tisicin: number | null = null
  if (p.mnozstvi === null) {
    // Řádek, který se skladu netýká (sleva, spropitné, služba „Obsluha 10 %"),
    // množství nepotřebuje — do tržby jde jeho cena celkem. Zůstane prázdné,
    // nedoplní se „1". U skladových druhů bez množství výdej nejde sestavit.
    if (!DRUHY_BEZ_SKLADU.includes(p.druh)) r.push(VECNE.chybiMnozstvi)
  } else {
    tisicin = platneMnozstviTisicin(p.mnozstvi)
    if (tisicin === null) r.push(`${VECNE.neplatneMnozstvi} (nejvýš 3 desetinná místa)`)
  }

  if (!platnaCena(p.cenaJednotkovaHaleru) || !platnaCena(p.cenaCelkemHaleru)) {
    r.push(`${VECNE.neplatnaCena} v povoleném rozsahu`)
  } else {
    const vynasobeno = tisicin !== null && p.cenaJednotkovaHaleru !== null ? soucin(p.mnozstvi as string, p.cenaJednotkovaHaleru) : null
    const mimoRozsah = tisicin !== null && p.cenaJednotkovaHaleru !== null && vynasobeno === null
    if (mimoRozsah) r.push(`${VECNE.nesediSoucin} je mimo rozsah — zkontrolujte množství a cenu`)
    else if (cenaCelkemRadku(p) === null) r.push(VECNE.chybiCena)
    const kladna = (p.cenaCelkemHaleru ?? 0) > 0 || (p.cenaJednotkovaHaleru ?? 0) > 0
    const zaporna = (p.cenaCelkemHaleru ?? 0) < 0 || (p.cenaJednotkovaHaleru ?? 0) < 0
    if (p.druh === 'sleva' && kladna) r.push(VECNE.slevaKladna)
    if (p.druh !== 'sleva' && zaporna) r.push(VECNE.zapornaCena)
    if (tisicin !== null && vynasobeno !== null && p.cenaCelkemHaleru !== null) {
      if (Math.abs(vynasobeno - p.cenaCelkemHaleru) > toleranceRadku(tisicin)) {
        r.push(`${VECNE.nesediSoucin} (${castkaTextem(vynasobeno, mena)}) nesedí s cenou celkem (${castkaTextem(p.cenaCelkemHaleru, mena)})`)
      }
    }
  }

  if (p.druh === 'nezarazeno') r.push(VECNE.druhNeurceny)
  return r
}

/** Platné datum RRRR-MM-DD (opravdový den v kalendáři, bez časového pásma). */
export function platneDatum(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [r, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mes < 1 || mes > 12 || d < 1) return false
  const dnu = [31, r % 4 === 0 && (r % 100 !== 0 || r % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
  return d <= dnu
}

/**
 * Měna z dokladu → ISO 4217. Jen když ji doklad UVÁDÍ: „Kč" → CZK,
 * „€" → EUR, třípísmenný kód velkými. Cokoli jiného (i „$" — dolar
 * americký, kanadský, australský?) → null s důvodem. Nikdy nedomýšlíme
 * CZK jen proto, že jsme v Česku.
 */
export function normalizovatMenu(vstup: string | null): { mena: string | null; duvod: string | null } {
  if (vstup === null || vstup.trim() === '') return { mena: null, duvod: 'Chybí měna — doklad ji neuvádí, doplňte ji (nedomýšlíme ji)' }
  const s = vstup
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\s]/g, '')
  if (['kc', 'czk', 'korun', 'korunceskych', 'ceskekoruny'].includes(s)) return { mena: 'CZK', duvod: null }
  if (['€', 'eur', 'euro', 'eura', 'eur€'].includes(s)) return { mena: 'EUR', duvod: null }
  if (/^[a-z]{3}$/.test(s)) return { mena: s.toUpperCase(), duvod: null }
  return { mena: null, duvod: `Chybí měna — „${zkratit(vstup)}" nejde jednoznačně určit` }
}

/** Sazba DPH z dokladu („21 %", „12,0") → text pro numeric(5,2) („21", „12"). */
function normalizovatSazbu(vstup: string | null): { sazba: string | null; duvod: string | null } {
  if (vstup === null || vstup.trim() === '') return { sazba: null, duvod: null }
  const s = vstup.replace(/[%\s\u00a0]/g, '').replace(',', '.')
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return { sazba: null, duvod: `Sazba DPH z dokladu („${zkratit(vstup)}") nejde přečíst` }
  const cela = m[1].replace(/^0+(?=\d)/, '')
  const des = (m[2] ?? '').replace(/0+$/, '')
  if (Number(cela) > 100 || (Number(cela) === 100 && des !== '')) {
    return { sazba: null, duvod: `Sazba DPH z dokladu („${zkratit(vstup)}") nejde přečíst` }
  }
  return { sazba: des === '' ? cela : `${cela}.${des}`, duvod: null }
}

const procenta = (j: number) => `${Math.round(j * 100)} %`

/* ------------------------------------------------------------------ */
/* Položka z AI                                                         */
/* ------------------------------------------------------------------ */

/**
 * Měna ze značky v textu částky („12 EUR") se liší od měny dokladu → důvod.
 * Částka se NEPŘEVÁDÍ ani nezahazuje — rozhodne člověk. Doklad bez měny
 * nic nesrovnává (důvod „Chybí měna" už má).
 */
function jinaMena(menaVTextu: string | null, mena: string | null): boolean {
  return menaVTextu !== null && mena !== null && menaVTextu !== mena
}

function cenaZAi(text: string | null, nazev: string, druh: DruhPolozky, cteni: string[], mena: string | null): number | null {
  const v = prevestCastku(text)
  if (v.stav === 'prazdne') return null
  if (v.stav === 'nejasne') {
    cteni.push(`${nazev} z dokladu („${zkratit(text ?? '')}"): ${v.duvod}`)
    return null
  }
  if (jinaMena(v.menaVTextu, mena)) {
    cteni.push(`${nazev} z dokladu („${zkratit(text ?? '')}") je v ${v.menaVTextu}, doklad je v ${mena} — ověřte měnu`)
  }
  if (v.haleru === 0) {
    // Vzor lib/marketing-menu-ai.ts opravitPodezrele: nula je skoro vždycky
    // model, který nechtěl nechat políčko prázdné.
    cteni.push(`${nazev} přečtená jako 0 — ověřte, jestli tam opravdu je`)
    return null
  }
  if (druh === 'sleva' && v.haleru > 0) {
    cteni.push('Sleva přečtená jako kladná — znaménko otočeno, ověřte')
    return -v.haleru
  }
  return v.haleru
}

function polozkaZAi(r: RozpoznanaPolozka, mena: string | null): PolozkaNavrhu {
  const cteni: string[] = []
  const nazev = typeof r.nazev === 'string' ? r.nazev.trim() : ''
  const druh: DruhPolozky = (DRUHY_POLOZEK as readonly string[]).includes(r.druhNavrh) ? r.druhNavrh : 'nezarazeno'

  let mnozstvi: string | null = null
  const vm = prevestMnozstvi(r.mnozstvi)
  if (vm.stav === 'ok') mnozstvi = vm.mnozstvi
  else if (vm.stav === 'nejasne') cteni.push(`Množství z dokladu („${zkratit(String(r.mnozstvi))}"): ${vm.duvod}`)

  const cenaJednotkovaHaleru = cenaZAi(r.cenaJednotkova, 'Jednotková cena', druh, cteni, mena)
  const cenaCelkemHaleru = cenaZAi(r.cenaCelkem, 'Cena celkem', druh, cteni, mena)

  const dph = normalizovatSazbu(r.sazbaDph)
  if (dph.duvod) cteni.push(dph.duvod)

  // Poznámka AI k řádku (přeškrtnuto, dopsáno rukou…) — člověk ji má vidět
  // u řádku. Jeden důvod: „; " by ji spojitDuvody rozdělil na víc kusů.
  const poznamka = typeof r.poznamka === 'string' ? r.poznamka.replace(/\s+/g, ' ').replace(/;\s/g, ', ').trim() : ''
  if (poznamka !== '') cteni.push(`${PREDPONA_POZNAMKY}${zkratit(poznamka, MAX_DELKA_POZNAMKY)}`)

  const jistota = typeof r.jistota === 'number' && Number.isFinite(r.jistota) ? Math.min(1, Math.max(0, r.jistota)) : null
  if (jistota === null) cteni.push('Nejistě přečtený řádek (jistota neuvedena)')
  else if (jistota < MIN_JISTOTA_RADKU) cteni.push(`Nejistě přečtený řádek (jistota ${procenta(jistota)})`)

  const zaklad: PolozkaNavrhu = {
    nazevPuvodni: nazev,
    nazev,
    mnozstvi,
    jednotka: typeof r.jednotka === 'string' && r.jednotka.trim() !== '' ? r.jednotka.trim() : null,
    cenaJednotkovaHaleru,
    cenaCelkemHaleru,
    sazbaDph: dph.sazba,
    jistota,
    zdroj: 'ai',
    druh,
    posProduktId: null,
    posProduktNazev: null,
    posMnozstvi: null,
    mapovani: DRUHY_BEZ_SKLADU.includes(druh) ? 'neskladova' : 'nenamapovano',
    vyzadujeKontrolu: false,
    duvodKontroly: '',
  }
  const vse = spojitDuvody([...problemyRadku(zaklad, mena), ...cteni])
  return { ...zaklad, vyzadujeKontrolu: vse !== '', duvodKontroly: vse }
}

/* ------------------------------------------------------------------ */
/* Částky dokladu                                                       */
/* ------------------------------------------------------------------ */

const NAZVY_CASTEK: Record<keyof CastkyDokladu, string> = {
  celkem: 'Celkem',
  kUhrade: 'K úhradě',
  zaplaceno: 'Zaplaceno',
  prijatoHotove: 'Přijato hotově',
  vraceno: 'Vráceno',
  zbyva: 'Zbývá',
  sleva: 'Sleva',
  spropitne: 'Spropitné',
}

function castkyZDokladu(d: RozpoznanyDoklad, duvody: string[], mena: string | null): CastkyDokladu {
  const jedna = (klic: keyof CastkyDokladu): number | null => {
    const text = d[klic]
    const v = prevestCastku(text)
    if (v.stav === 'prazdne') return null
    if (v.stav === 'nejasne') {
      duvody.push(`„${NAZVY_CASTEK[klic]}" nejde jednoznačně přečíst: ${v.duvod}`)
      return null
    }
    if (jinaMena(v.menaVTextu, mena)) {
      duvody.push(`„${NAZVY_CASTEK[klic]}" (${zkratit(text ?? '')}) je v ${v.menaVTextu}, ale měna dokladu je ${mena} — ověřte`)
    }
    if (klic === 'sleva') return Math.abs(v.haleru)
    if (v.haleru < 0) {
      duvody.push(`„${NAZVY_CASTEK[klic]}" je záporná (${zkratit(text ?? '')}) — ověřte (vratka?)`)
      return null
    }
    if (klic === 'celkem' && v.haleru === 0) {
      duvody.push('Celková cena přečtená jako 0 — ověřte, jestli tam opravdu je')
      return null
    }
    return v.haleru
  }
  return {
    celkem: jedna('celkem'),
    kUhrade: jedna('kUhrade'),
    zaplaceno: jedna('zaplaceno'),
    prijatoHotove: jedna('prijatoHotove'),
    vraceno: jedna('vraceno'),
    zbyva: jedna('zbyva'),
    sleva: jedna('sleva'),
    spropitne: jedna('spropitne'),
  }
}

/** Součet spropitného na řádcích (kladně), null bez takových řádků nebo když některému chybí cena. */
function spropitneNaRadcich(polozky: readonly PolozkaNavrhu[]): number | null {
  const radky = polozky.filter((p) => p.druh === 'spropitne')
  if (radky.length === 0) return null
  let s = 0
  for (const p of radky) {
    const c = cenaCelkemRadku(p)
    if (c === null) return null
    s += c
  }
  return s
}

function popsatNesoulad(celkem: number, ocekavano: number, slevaPopis: string, spropitne: (number | null)[], mena: string | null): Nesoulad {
  const rozdil = celkem - ocekavano
  let popis =
    `Celkem na dokladu (${castkaTextem(celkem, mena)}) nesedí se součtem položek${slevaPopis} ` +
    `(${castkaTextem(ocekavano, mena)}) — rozdíl ${castkaTextem(rozdil, mena)}`
  if (spropitne.some((s) => s !== null && s === rozdil)) {
    popis += '; rozdíl odpovídá spropitnému — spropitné do celkové ceny prodeje nepatří'
  }
  return { rozdilHaleru: rozdil, popis }
}

/* ------------------------------------------------------------------ */
/* Kontrola rozpoznaného dokladu                                        */
/* ------------------------------------------------------------------ */

/** „H:MM", „HH:MM" nebo „HH:MM:SS" (i s desetinami sekund) → „HH:MM"; jinak null. */
export function normalizovatCas(t: unknown): string | null {
  if (typeof t !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** Den před RRRR-MM-DD (bez pásma — datum prodeje pásmo nemá). */
function predchoziDen(datum: string): string {
  const [r, m, d] = datum.split('-').map(Number)
  return new Date(Date.UTC(r, m - 1, d) - 86_400_000).toISOString().slice(0, 10)
}

/** „2026-10-17" → „17. 10. 2026". */
function datumCesky(datum: string): string {
  const [r, m, d] = datum.split('-').map(Number)
  return `${d}. ${m}. ${r}`
}

/** Upozornění k dokladu do stropu databáze: delší se zkrátí, nad počet se poslední nahradí souhrnem. */
function doStropuUpozorneni(seznam: readonly string[]): string[] {
  const zkratit1 = (t: string) => (t.length > MAX_DELKA_UPOZORNENI_DOKLADU ? `${t.slice(0, MAX_DELKA_UPOZORNENI_DOKLADU - 1)}…` : t)
  const vse = [...new Set(seznam.map((t) => t.trim()).filter((t) => t !== ''))].map(zkratit1)
  if (vse.length <= MAX_UPOZORNENI_DOKLADU) return vse
  const zbyva = vse.length - (MAX_UPOZORNENI_DOKLADU - 1)
  return [...vse.slice(0, MAX_UPOZORNENI_DOKLADU - 1), `A další upozornění (${zbyva}) — celý seznam je u rozpoznání dokladu.`]
}

/**
 * Výstup AI (po kontrole schématu) → návrh položek a hlavičky s důvody
 * ke kontrole. Nic se tu nezapisuje; výsledek je návrh, který člověk
 * potvrdí (`jine_platby_ulozit_navrh` → `jine_platby_oznacit_zkontrolovano`).
 *
 * `moznosti.dnes` = dnešní provozní den RRRR-MM-DD (datum z dokladu
 * nesmí být v budoucnosti).
 *
 * `moznosti.denZacina` = začátek provozního dne pobočky („HH:MM",
 * i „HH:MM:SS" z databáze). Datum na dokladu je KALENDÁŘNÍ den tisku —
 * účet vytištěný ve 2:15 patří do včerejšího provozního dne (pravidlo 10
 * v CLAUDE.md). Když AI přečetla čas tisku (`cas`) a ten je dřív než
 * začátek provozního dne, datum se posune o den zpět a do upozornění
 * k dokladu přibude věta, ať to člověk zkontroluje (N31). Bez času nebo
 * bez `denZacina` se datum jen převezme — nic se nedomýšlí.
 */
export function zkontrolovatDoklad(d: RozpoznanyDoklad, moznosti: { dnes: string; denZacina?: string }): KontrolaDokladu {
  if (!platneDatum(moznosti.dnes)) throw new RangeError('moznosti.dnes musí být platné datum RRRR-MM-DD')
  const denZacina = moznosti.denZacina === undefined ? null : normalizovatCas(moznosti.denZacina)
  if (moznosti.denZacina !== undefined && denZacina === null) throw new RangeError('moznosti.denZacina musí být čas HH:MM')
  const duvody: string[] = []
  // Upozornění k CELÉMU dokladu (N27) — jdou do `duvody` i sem.
  const kDokladu: string[] = []
  const kCelku = (t: string) => {
    duvody.push(t)
    kDokladu.push(t)
  }

  // Měna
  const { mena, duvod: duvodMeny } = normalizovatMenu(d.mena)
  if (duvodMeny) duvody.push(duvodMeny)

  // Položky
  const polozky = (Array.isArray(d.polozky) ? d.polozky : []).map((r) => polozkaZAi(r, mena))
  if (polozky.length === 0) duvody.push('Na dokladu nejsou rozpoznané žádné položky')

  // Částky
  const castky = castkyZDokladu(d, duvody, mena)
  const tol = tolerance(mena)
  const soucet = soucetPolozek(polozky)

  // Sleva: když je jen v souhrnu (ne jako řádek), odečte se od součtu.
  let ocekavano = soucet
  let slevaPopis = ''
  const slevoveRadky = polozky.filter((p) => p.druh === 'sleva')
  if (soucet !== null && castky.sleva !== null && castky.sleva > 0) {
    if (slevoveRadky.length === 0) {
      ocekavano = soucet - castky.sleva
      slevaPopis = ` po slevě ${castkaTextem(castky.sleva, mena)}`
    } else {
      const naRadcich = -slevoveRadky.reduce((s, p) => s + (cenaCelkemRadku(p) ?? 0), 0)
      if (naRadcich !== castky.sleva) {
        duvody.push(`Sleva v souhrnu (${castkaTextem(castky.sleva, mena)}) nesedí se slevovými řádky (${castkaTextem(naRadcich, mena)})`)
      }
    }
  }

  // Celková cena prodeje
  let navrhCelkem: KontrolaDokladu['navrhCelkem'] = null
  let nesoulad: Nesoulad | null = null
  if (castky.celkem === null) {
    if (ocekavano !== null && ocekavano >= 0 && ocekavano <= MAX_HALERU) {
      navrhCelkem = { haleru: ocekavano, puvod: 'vypocet' }
      duvody.push(`Celková cena prodeje na dokladu chybí — nabízíme součet položek ${castkaTextem(ocekavano, mena)}, potvrďte ho`)
    } else {
      duvody.push('Celková cena prodeje na dokladu chybí a ze součtu položek ji spočítat nejde — doplňte ji')
    }
    if (castky.kUhrade !== null) {
      kCelku(`Doklad uvádí jen „K úhradě" (${castkaTextem(castky.kUhrade, mena)}) — to nemusí být cena prodeje (záloha, spropitné)`)
    }
  } else if (ocekavano !== null && Math.abs(castky.celkem - ocekavano) > tol) {
    nesoulad = popsatNesoulad(castky.celkem, ocekavano, slevaPopis, [castky.spropitne, spropitneNaRadcich(polozky)], mena)
    duvody.push(nesoulad.popis)
  }

  // K úhradě ≠ celková cena prodeje
  if (castky.celkem !== null && castky.kUhrade !== null) {
    const rozdil = castky.kUhrade - castky.celkem
    const zaokrouhleni = Math.abs(rozdil) <= tol
    const spropitnym = castky.spropitne !== null && rozdil === castky.spropitne
    if (!zaokrouhleni && !spropitnym) {
      kCelku(
        `K úhradě (${castkaTextem(castky.kUhrade, mena)}) se liší od celkové ceny prodeje (${castkaTextem(castky.celkem, mena)}) — ` +
          'může jít o zálohu, částečnou platbu nebo spropitné; do tržby jde celková cena, ne „K úhradě"',
      )
    }
  }

  // Zaplaceno + zbývá = K úhradě
  const zaklad = castky.kUhrade ?? castky.celkem
  const nazevZakladu = castky.kUhrade !== null ? '„K úhradě"' : 'celkem'
  if (castky.zaplaceno !== null && castky.zbyva !== null) {
    if (zaklad === null) {
      kCelku('Doklad uvádí zaplaceno a zbývá, ale ne „K úhradě" ani celkem')
    } else if (Math.abs(castky.zaplaceno + castky.zbyva - zaklad) > tol) {
      kCelku(
        `Zaplaceno (${castkaTextem(castky.zaplaceno, mena)}) + zbývá (${castkaTextem(castky.zbyva, mena)}) ` +
          `nedává ${nazevZakladu} (${castkaTextem(zaklad, mena)})`,
      )
    }
  } else if (castky.zaplaceno !== null && zaklad !== null && castky.zaplaceno < zaklad - tol) {
    kCelku(`Zaplaceno (${castkaTextem(castky.zaplaceno, mena)}) je méně než ${nazevZakladu} (${castkaTextem(zaklad, mena)}) — částečná platba?`)
  }
  if (castky.zbyva !== null && castky.zbyva > 0) {
    kCelku(
      `Zbývá doplatit ${castkaTextem(castky.zbyva, mena)} — prodej není celý zaplacený (otevřený účet nebo částečná platba); úhradu ověří až banka`,
    )
  }

  // Vráceno = přijato hotově − K úhradě (přijatá hotovost ani vrácení nejsou tržba)
  if (castky.prijatoHotove !== null && castky.vraceno !== null) {
    if (zaklad === null) {
      duvody.push('Doklad uvádí přijatou hotovost a vrácení, ale ne částku k úhradě')
    } else {
      const ocekavaneVraceni = castky.prijatoHotove - zaklad
      if (Math.abs(castky.vraceno - ocekavaneVraceni) > tol) {
        duvody.push(
          `Vráceno (${castkaTextem(castky.vraceno, mena)}) nesedí: přijato ${castkaTextem(castky.prijatoHotove, mena)} − ` +
            `${nazevZakladu} ${castkaTextem(zaklad, mena)} = ${castkaTextem(ocekavaneVraceni, mena)}`,
        )
      }
    }
  }

  // Datum. Kalendářní den tisku → provozní den: účet vytištěný před
  // začátkem provozního dne patří do předchozího (N31). Posun PŘED kontrolou
  // budoucnosti — účet z 0:30 po půlnoci je kalendářně „zítra", provozně dnes.
  let datumProdeje: string | null = null
  const cas = normalizovatCas(d.cas)
  if (d.datum === null || d.datum === undefined || String(d.datum).trim() === '') {
    duvody.push('Chybí datum — doklad ho neuvádí, doplňte provozní den')
  } else if (!platneDatum(String(d.datum).trim())) {
    duvody.push(`Datum z dokladu („${zkratit(String(d.datum))}") není platné`)
  } else {
    let datum = String(d.datum).trim()
    if (cas !== null && denZacina !== null && cas < denZacina) {
      datum = predchoziDen(datum)
      kCelku(`Účet vytištěný v ${cas} patří do provozního dne ${datumCesky(datum)} — datum posunuto, zkontrolujte`)
    }
    if (datum > moznosti.dnes) duvody.push(`Datum z dokladu (${datum}) je v budoucnosti — ověřte`)
    else datumProdeje = datum
  }

  // Upozornění modelu (k celému dokladu — zachycený pokyn, víc dokladů v jednom…)
  for (const u of Array.isArray(d.upozorneni) ? d.upozorneni : []) {
    if (typeof u === 'string' && u.trim() !== '') kCelku(`Upozornění: ${u.trim()}`)
  }

  // Jistota celého dokladu
  const jistota = typeof d.jistota === 'number' && Number.isFinite(d.jistota) ? d.jistota : null
  if (jistota === null) kCelku('Doklad přečtený nejistě (jistota neuvedena)')
  else if (jistota < MIN_JISTOTA_DOKLADU) kCelku(`Doklad přečtený nejistě (jistota ${procenta(jistota)})`)

  const typDokladu: TypDokladu = (TYPY_DOKLADU as readonly string[]).includes(d.typDokladu) ? d.typDokladu : 'nezjisteno'
  const externi = typeof d.externiId === 'string' ? d.externiId.trim() : ''

  const hlavicka: HlavickaNavrhu = {
    datumProdeje,
    oznaceni: '',
    mena,
    castkaHaleru: castky.celkem,
    castkaPuvod: castky.celkem !== null ? 'doklad' : null,
    typDokladu,
    externiUcet: externi === '' ? null : externi,
    kontaktId: null,
  }

  const duvodyBezOpakovani = [...new Set(duvody)]
  const upozorneniDokladu = doStropuUpozorneni(kDokladu)
  return {
    polozky,
    // Hlavička nese upozornění vždy (i prázdné pole): nové čtení nahradí upozornění starého.
    hlavicka: { ...hlavicka, upozorneniDokladu },
    castky,
    soucetPolozekHaleru: soucet,
    navrhCelkem,
    nesoulad,
    duvody: duvodyBezOpakovani,
    upozorneniDokladu,
    vyzadujeKontrolu:
      duvodyBezOpakovani.length > 0 || polozky.some((p) => p.vyzadujeKontrolu) || jistota === null || jistota < MIN_JISTOTA_DOKLADU,
  }
}

/* ------------------------------------------------------------------ */
/* Kontrola po ruční úpravě                                             */
/* ------------------------------------------------------------------ */

/** Důvody převodu platí jen u řádku s produktem a bez spočteného množství pro pokladnu. */
function prevodStalePlati(p: PolozkaNavrhu): boolean {
  return p.posProduktId !== null && p.posMnozstvi === null && !DRUHY_BEZ_SKLADU.includes(p.druh)
}

/**
 * Sleva ručně zadaná kladně → záporná. Sleva cenu snižuje vždycky (znaménko
 * není co domýšlet) a databáze kladnou slevu nepustí (check na
 * jine_platby_polozky) — bez otočení by celé uložení návrhu spadlo.
 */
function slevaZaporne(p: PolozkaNavrhu): PolozkaNavrhu {
  if (p.druh !== 'sleva') return p
  const otocit = (c: number | null) => (c !== null && c > 0 ? -c : c)
  return { ...p, cenaJednotkovaHaleru: otocit(p.cenaJednotkovaHaleru), cenaCelkemHaleru: otocit(p.cenaCelkemHaleru) }
}

function prepocitatRadek(puvodni: PolozkaNavrhu, mena: string | null, potvrdit: boolean): PolozkaNavrhu {
  const p = slevaZaporne(puvodni)
  const platiPrevod = prevodStalePlati(p)
  // Potvrzení člověkem: ze starých důvodů zůstane jen převod do jednotek pokladny.
  const vychozi = potvrdit
    ? { ...p, vyzadujeKontrolu: false, duvodKontroly: spojitDuvody(rozdelitDuvody(p.duvodKontroly).filter(jePrevod)) }
    : p
  return upravitDuvody(vychozi, (d) => jeVecny(d) || (jePrevod(d) && !platiPrevod), problemyRadku(p, mena))
}

/**
 * Člověk řádek ověřil: zmizí důvody ze čtení dokladu (nejistota,
 * nula, otočené znaménko…). Věcné problémy (chybí cena, nesedí
 * součin) a nevyřešený převod do jednotek pokladny zůstanou — ty
 * potvrzením nezmizí, ty se musí opravit.
 */
export function potvrditRadek(p: PolozkaNavrhu, mena: string | null): PolozkaNavrhu {
  return prepocitatRadek(p, mena, true)
}

/**
 * Po ruční úpravě: znovu ověří každý řádek (věcné problémy se přepočítají,
 * řádek bez problému zůstane bez příznaku) a hlavičku proti součtu položek.
 * Kladně zadanou slevu otočí na zápornou (viz `slevaZaporne`).
 *
 * Důvody ze čtení dokladu (viz hlavička souboru, druh 3) se zachovají —
 * uložení návrhu neznamená, že člověk každý řádek ověřil. Odstraní je
 * `potvrditRadek` (tlačítko u řádku). Nevyřešený převod do jednotek
 * pokladny zůstane, dokud má řádek produkt a nemá množství pro pokladnu.
 */
export function zkontrolovatNavrh(
  polozky: readonly PolozkaNavrhu[],
  hlavicka: HlavickaNavrhu,
): { duvody: string[]; soucetPolozekHaleru: number | null; nesoulad: Nesoulad | null; polozky: PolozkaNavrhu[] } {
  const mena = hlavicka.mena
  const vystup = polozky.map((p) => prepocitatRadek(p, mena, false))
  const duvody: string[] = []

  if (mena === null || mena.trim() === '') duvody.push('Chybí měna')
  else if (!/^[A-Z]{3}$/.test(mena)) duvody.push('Měna musí být třípísmenný kód (CZK, EUR…)')

  const c = hlavicka.castkaHaleru
  if (c === null) duvody.push('Chybí celková cena prodeje')
  else if (!Number.isSafeInteger(c) || c < 0 || c > MAX_HALERU) duvody.push('Celková cena musí být celé nezáporné číslo haléřů v povoleném rozsahu')

  if (hlavicka.datumProdeje === null || hlavicka.datumProdeje.trim() === '') duvody.push('Chybí datum prodeje (provozní den)')
  else if (!platneDatum(hlavicka.datumProdeje)) duvody.push('Datum prodeje není platné datum')

  if (vystup.length === 0) duvody.push('Záznam nemá žádné položky')

  const soucet = soucetPolozek(vystup)
  let nesoulad: Nesoulad | null = null
  if (c !== null && Number.isSafeInteger(c) && soucet !== null && Math.abs(c - soucet) > tolerance(mena)) {
    nesoulad = popsatNesoulad(c, soucet, '', [spropitneNaRadcich(vystup)], mena)
    duvody.push(nesoulad.popis)
  }

  return { duvody, soucetPolozekHaleru: soucet, nesoulad, polozky: vystup }
}
