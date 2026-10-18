/**
 * Jiné platby — přiřazení položek dokladu ke katalogu pokladny
 * a převod množství do jednotek, ve kterých prodává pokladna.
 *
 * Tři pravidla, na kterých to stojí:
 *
 *   1. Ověřené přiřazení dělá jen člověk. Podobnost názvů dá nejvýš
 *      NÁVRH (`mapovani = 'navrh'`), nikdy `'overeno'`. Ověřené je jen to,
 *      co už někdo jednou potvrdil (`pos_mapovani`, alias).
 *   2. Množství se převádí JEN z dat pokladny. „2× pivo 0,5 l = 1 l" platí
 *      jedině tehdy, když pokladna u položky uvádí, že jeden kus je 0,5 l
 *      (`mira`). Bez toho žádný odhad — řádek jde ke kontrole.
 *   3. Pokrm s recepturou se vydává JAKO POKRM, nikdy jako jeho suroviny:
 *      suroviny odečte pokladna podle SVÉ receptury. Appka vydat pokrm
 *      i suroviny zároveň nesmí (sklad by se odečetl dvakrát).
 *
 * Pokladna počítá prodané KUSY své položky. Kolik je jeden kus litrů nebo
 * kilogramů, ví jen ona (`jednotka` + `mira`) a podle toho si odečte sklad.
 *
 * Čisté funkce — testuje scripts/jine-platby.test.mjs přímo Nodem.
 */

import type { PolozkaNavrhu } from './jine-platby-typy.ts'
import { DRUHY_BEZ_SKLADU } from './jine-platby-typy.ts'
import { MAX_MNOZSTVI_TISICIN, mnozstviNaTisiciny, mnozstviNaText, tisicinyNaMnozstvi } from './jine-platby-castky.ts'
import { PREDPONA_PREVODU, upravitDuvody } from './jine-platby-kontrola.ts'

export type ProduktKatalogu = {
  externiId: string
  nazev: string
  /** Výčet pokladny ('Piece', 'Liter', 'Milliliter', 'Kilogram'…). */
  jednotka: string | null
  /** Kolik `jednotka` je v jednom prodaném kusu (pivo 0,5 l: 'Liter' + 0.5). null = pokladna neuvádí. */
  mira: number | null
  odecitaSklad: boolean | null
  maRecepturu: boolean | null
  plu: string[]
  ean: string[]
  smazano: boolean
}

export type AliasMapovani = { alias: string; posProduktId: string }

export type KandidatMapovani = { produkt: ProduktKatalogu; skore: number; proc: string }

/** Od jakého skóre podobnosti se nejlepší kandidát nabídne jako návrh. */
export const MIN_SKORE_NAVRHU = 0.6
/** Kandidáti s nižším skóre se vůbec neukazují (byl by to šum). */
export const MIN_SKORE_KANDIDATA = 0.25
/** Dva kandidáti blíž než tohle = nerozhodnutelné, návrh se nedělá. */
const ROZDIL_PRO_ROZHODNUTI = 0.02

/* ------------------------------------------------------------------ */
/* Název                                                                */
/* ------------------------------------------------------------------ */

/**
 * Název pro porovnání: malá písmena, bez diakritiky, sjednocené mezery,
 * desetinná čárka → tečka bez koncových nul, číslo a jednotka odděleně
 * („Pivo 0,50L" → „pivo 0.5 l").
 */
export function normalizovatNazev(s: string): string {
  let t = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  t = t.replace(/(\d),(?=\d)/g, '$1.')
  t = t.replace(/(\d)\s*(ml|cl|dl|l|kg|dkg|dag|g|ks)(?![a-z])/g, '$1 $2')
  t = t.replace(/[^a-z0-9.]+/g, ' ')
  return t
    .split(' ')
    .flatMap((tok) => (/^\d+\.\d+$/.test(tok) ? [tok] : tok.split('.')))
    .map((tok) => (/^\d+\.\d+$/.test(tok) ? tok.replace(/0+$/, '').replace(/\.$/, '') : tok))
    .filter((tok) => tok !== '')
    .join(' ')
}

function bigramy(s: string): Map<string, number> {
  const t = s.replace(/ /g, '')
  const m = new Map<string, number>()
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2)
    m.set(b, (m.get(b) ?? 0) + 1)
  }
  return m
}

/** Sørensenův–Diceův koeficient nad dvojicemi znaků (0–1). */
function dice(a: string, b: string): number {
  if (a === b) return 1
  const A = bigramy(a)
  const B = bigramy(b)
  let spolecne = 0
  let celkem = 0
  for (const [k, n] of A) {
    spolecne += Math.min(n, B.get(k) ?? 0)
    celkem += n
  }
  for (const n of B.values()) celkem += n
  return celkem === 0 ? 0 : (2 * spolecne) / celkem
}

const cisla = (s: string) => new Set(s.split(' ').filter((t) => /^\d+(\.\d+)?$/.test(t)))

function ohodnotit(nazevDokladu: string, produkt: ProduktKatalogu): { skore: number; proc: string } {
  const a = normalizovatNazev(nazevDokladu)
  const b = normalizovatNazev(produkt.nazev)
  const tokenyA = new Set(a.split(' '))
  if (produkt.ean.some((e) => /^\d{8,14}$/.test(e) && tokenyA.has(e))) return { skore: 1, proc: 'Shoda čárového kódu (EAN) z dokladu' }
  if (a !== '' && a === b) return { skore: 1, proc: 'Stejný název' }
  let skore = dice(a, b)
  let proc = `Podobný název (${Math.round(skore * 100)} %)`
  // „Pivo 0,5 l" a „Pivo 0,3 l" jsou si písmeny skoro stejné — jiné číslo
  // v názvu (objem, velikost) ale skoro jistě znamená jiný produkt.
  const ca = cisla(a)
  const cb = cisla(b)
  if (ca.size > 0 && cb.size > 0 && ![...ca].some((x) => cb.has(x))) {
    skore *= 0.5
    proc += ', ale jiné číslo v názvu (objem nebo velikost?)'
  }
  return { skore: Math.round(skore * 1000) / 1000, proc }
}

/* ------------------------------------------------------------------ */
/* Jednotky                                                             */
/* ------------------------------------------------------------------ */

type Skupina = 'objem' | 'hmotnost'
type Mira = { druh: 'mira'; skupina: Skupina; zaklad: number; zkratka: string }
type Jednotka = { druh: 'kus' } | Mira | { druh: 'neznama'; text: string }

const MIRY: Record<string, Mira> = {
  l: { druh: 'mira', skupina: 'objem', zaklad: 1000, zkratka: 'l' },
  dl: { druh: 'mira', skupina: 'objem', zaklad: 100, zkratka: 'dl' },
  cl: { druh: 'mira', skupina: 'objem', zaklad: 10, zkratka: 'cl' },
  ml: { druh: 'mira', skupina: 'objem', zaklad: 1, zkratka: 'ml' },
  kg: { druh: 'mira', skupina: 'hmotnost', zaklad: 1000, zkratka: 'kg' },
  dkg: { druh: 'mira', skupina: 'hmotnost', zaklad: 10, zkratka: 'dkg' },
  g: { druh: 'mira', skupina: 'hmotnost', zaklad: 1, zkratka: 'g' },
}

/** Jak se jednotka píše na dokladu nebo ve výčtu pokladny → jednotka. */
const SYNONYMA: Record<string, string> = {
  l: 'l', litr: 'l', litru: 'l', litry: 'l', liter: 'l', lt: 'l',
  dl: 'dl', deciliter: 'dl', decilitr: 'dl',
  cl: 'cl', centiliter: 'cl', centilitr: 'cl',
  ml: 'ml', milliliter: 'ml', mililitr: 'ml',
  kg: 'kg', kilogram: 'kg', kilo: 'kg',
  dkg: 'dkg', dag: 'dkg', dekagram: 'dkg', decagram: 'dkg',
  g: 'g', gram: 'g', gramu: 'g',
}
const KUSY = ['', 'ks', 'kus', 'kusy', 'kusu', 'x', '×', 'pc', 'pcs', 'piece', 'porce', 'porci']

function jednotka(s: string | null): Jednotka {
  const t = (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (KUSY.includes(t)) return { druh: 'kus' }
  const z = SYNONYMA[t]
  if (z) return MIRY[z]
  return { druh: 'neznama', text: (s ?? '').trim() }
}

const nazevSkupiny = (s: Skupina) => (s === 'objem' ? 'litrech' : 'kilogramech')

/** Kladné konečné číslo → přesný desetinný zlomek z jeho nejkratšího zápisu (0.33 → 33 / 10²). */
function miraNaZlomek(m: number | null): { cislice: bigint; mocnina: number; text: string } | null {
  if (m === null || typeof m !== 'number' || !Number.isFinite(m) || m <= 0) return null
  const text = String(m)
  if (/e/i.test(text)) return null
  const [cela, des = ''] = text.split('.')
  return { cislice: BigInt(cela + des), mocnina: des.length, text }
}

/** Celé číslo × 10^-mocnina → normalizovaný text („1500", 3 → "1.5"). */
function desetinne(cislo: bigint, mocnina: number): string {
  const s = cislo.toString().padStart(mocnina + 1, '0')
  if (mocnina === 0) return s
  const cela = s.slice(0, s.length - mocnina)
  const des = s.slice(s.length - mocnina).replace(/0+$/, '')
  return des === '' ? cela : `${cela}.${des}`
}

/**
 * Množství z dokladu → množství v prodejních kusech pokladny.
 *
 *   – jednotka dokladu prázdná / „ks" / „x":
 *       · položka pokladny v kusech („Piece") nebo bez jednotky → stejné
 *         množství (pokladna dostane „2 kusy" a sklad odečte podle své
 *         položky);
 *       · položka v litrech/kilogramech s mírou → stejné množství kusů
 *         (pokladna ví, kolik je jeden kus);
 *       · položka v litrech/kilogramech BEZ míry → `nejasne`: pokladna
 *         pak počítá prodej v litrech, „2 ks" by odešlo jako 2 litry;
 *       · položka v jednotce, které appka nerozumí → `nejasne`;
 *   – doklad v l/dl/cl/ml/kg/dkg/g a položka pokladny ve stejné skupině
 *     s mírou → množství ÷ míra (výsledek musí vyjít přesně na tisíciny);
 *   – jednotka dokladu stejná jako jednotka položky a míra neuvedená →
 *     stejné množství (položka se prodává v té jednotce);
 *   – cokoli jiného → `nejasne`. Žádné odhady.
 */
export function prevestNaJednotkyPos(
  mnozstvi: string | null,
  jednotkaDokladu: string | null,
  produkt: ProduktKatalogu,
): { stav: 'ok'; posMnozstvi: string; popis: string } | { stav: 'nejasne'; duvod: string } {
  if (mnozstvi === null) return { stav: 'nejasne', duvod: 'Chybí množství' }
  const tisicin = mnozstviNaTisiciny(mnozstvi)
  if (tisicin === null || tisicin <= 0 || tisicin > MAX_MNOZSTVI_TISICIN) return { stav: 'nejasne', duvod: 'Množství není platné kladné číslo' }
  const q = tisicinyNaMnozstvi(tisicin)

  const jd = jednotka(jednotkaDokladu)
  const jp = produkt.jednotka === null || produkt.jednotka.trim() === '' ? null : jednotka(produkt.jednotka)
  const mira = miraNaZlomek(produkt.mira)

  if (jd.druh === 'kus') {
    if (jp?.druh === 'mira') {
      // Bez míry pokladna prodává položku v litrech/kilogramech — kolik je
      // jeden kus, neví ani ona, ani appka. 1:1 by z „2 ks" udělalo 2 litry.
      if (!mira) {
        return {
          stav: 'nejasne',
          duvod: `Pokladna u položky vede ${jp.skupina === 'objem' ? 'litry' : 'kilogramy'}, ale neuvádí, kolik je v jednom kusu — zapište množství v jednotkách pokladny`,
        }
      }
      const vMire = desetinne(BigInt(tisicin) * mira.cislice, 3 + mira.mocnina)
      return {
        stav: 'ok',
        posMnozstvi: q,
        popis: `${mnozstviNaText(q)} × ${mnozstviNaText(mira.text)} ${jp.zkratka} = ${mnozstviNaText(vMire)} ${jp.zkratka} podle nastavení položky v pokladně`,
      }
    }
    // 1:1 jen u položky v kusech nebo bez jednotky; cizí jednotka pokladny se nehádá.
    if (jp?.druh === 'neznama') {
      return { stav: 'nejasne', duvod: `Pokladna u položky vede jednotku „${jp.text}", kterou appka neumí převést — zapište množství v jednotkách pokladny` }
    }
    return { stav: 'ok', posMnozstvi: q, popis: `${mnozstviNaText(q)} ks z dokladu = ${mnozstviNaText(q)} prodaných kusů v pokladně` }
  }

  if (jd.druh === 'neznama') {
    if (produkt.jednotka !== null && jd.text.toLowerCase() === produkt.jednotka.trim().toLowerCase()) {
      return { stav: 'ok', posMnozstvi: q, popis: `${mnozstviNaText(q)} ${jd.text} — stejná jednotka jako u položky v pokladně` }
    }
    return { stav: 'nejasne', duvod: `Jednotku „${jd.text}" z dokladu neumíme převést na jednotky pokladny` }
  }

  // Doklad v litrech, gramech…
  if (jp === null) return { stav: 'nejasne', duvod: `Pokladna u položky neuvádí jednotku — zapište množství v kusech, jak ho prodává pokladna` }
  if (jp.druh !== 'mira') return { stav: 'nejasne', duvod: `Pokladna neuvádí, kolik jednoho kusu je v ${nazevSkupiny(jd.skupina)}` }
  if (jp.skupina !== jd.skupina) {
    return { stav: 'nejasne', duvod: `Jednotka na dokladu (${jd.zkratka}) nejde převést na jednotku položky v pokladně (${jp.zkratka})` }
  }
  if (!mira) {
    if (jp.zaklad === jd.zaklad) {
      return { stav: 'ok', posMnozstvi: q, popis: `${mnozstviNaText(q)} ${jd.zkratka} — položka se v pokladně prodává v ${jp.zkratka}` }
    }
    return { stav: 'nejasne', duvod: `Pokladna neuvádí, kolik jednoho kusu je v ${nazevSkupiny(jd.skupina)}` }
  }

  // kusy (v tisícinách) = tisíciny × základ dokladu × 10^mocnina ÷ (číslice míry × základ položky)
  const citatel = BigInt(tisicin) * BigInt(jd.zaklad) * BigInt(10) ** BigInt(mira.mocnina)
  const jmenovatel = mira.cislice * BigInt(jp.zaklad)
  if (citatel % jmenovatel !== BigInt(0)) {
    return {
      stav: 'nejasne',
      duvod: `${mnozstviNaText(q)} ${jd.zkratka} ÷ ${mnozstviNaText(mira.text)} ${jp.zkratka} nevychází na celé tisíciny kusu — zapište množství v kusech`,
    }
  }
  const posTisicin = citatel / jmenovatel
  if (posTisicin <= BigInt(0) || posTisicin > BigInt(MAX_MNOZSTVI_TISICIN)) return { stav: 'nejasne', duvod: 'Převedené množství je mimo rozsah' }
  const pos = tisicinyNaMnozstvi(Number(posTisicin))
  return {
    stav: 'ok',
    posMnozstvi: pos,
    popis: `${mnozstviNaText(pos)} × ${mnozstviNaText(mira.text)} ${jp.zkratka} = ${mnozstviNaText(q)} ${jd.zkratka} podle nastavení položky v pokladně`,
  }
}

/* ------------------------------------------------------------------ */
/* Sklad                                                                */
/* ------------------------------------------------------------------ */

/**
 * Týká se položka skladu? `null` = nejasné (pokladna to o produktu neříká,
 * nebo produkt není přiřazený) — návrh výdeje se pak nesestaví naslepo.
 *
 * Pokrm s recepturou (`maRecepturu`) se týká skladu, ale vydává se
 * JAKO POKRM — suroviny odečte pokladna podle své receptury. Appka
 * suroviny pokrmu nikdy nevydává zvlášť.
 */
export function tykaSeSkladu(polozka: PolozkaNavrhu, produkt: ProduktKatalogu | null): boolean | null {
  if (DRUHY_BEZ_SKLADU.includes(polozka.druh)) return false
  if (!produkt) return null
  if (produkt.odecitaSklad === true || produkt.maRecepturu === true) return true
  if (produkt.odecitaSklad === false && produkt.maRecepturu === false) return false
  return null
}

/* ------------------------------------------------------------------ */
/* Návrh přiřazení                                                      */
/* ------------------------------------------------------------------ */

const jePrevod = (d: string) => d.startsWith(PREDPONA_PREVODU)

/** Doplní produkt a množství pro pokladnu; nepovedený převod = příznak s důvodem. */
function sProduktem(p: PolozkaNavrhu, produkt: ProduktKatalogu, mapovani: 'overeno' | 'navrh'): PolozkaNavrhu {
  const prevod = prevestNaJednotkyPos(p.mnozstvi, p.jednotka, produkt)
  const zaklad: PolozkaNavrhu = {
    ...p,
    mapovani,
    posProduktId: produkt.externiId,
    posProduktNazev: produkt.nazev,
    posMnozstvi: prevod.stav === 'ok' ? prevod.posMnozstvi : null,
  }
  return upravitDuvody(zaklad, jePrevod, prevod.stav === 'ok' ? [] : [`${PREDPONA_PREVODU}${prevod.duvod}`])
}

function bezProduktu(p: PolozkaNavrhu, mapovani: 'nenamapovano' | 'neskladova'): PolozkaNavrhu {
  return upravitDuvody({ ...p, mapovani, posProduktId: null, posProduktNazev: null, posMnozstvi: null }, jePrevod, [])
}

/**
 * Navrhne přiřazení položky ke katalogu pokladny:
 *   (a) ověřený alias (normalizovaný název z dokladu) → 'overeno';
 *   (b) jinak podobnost názvu: nejvýš 3 kandidáti (bez smazaných),
 *       nejlepší se skóre ≥ 0,6 → 'navrh' (nikdy 'overeno'). Když jsou dva
 *       nejlepší stejně podobní („Kofola" proti „Kofola 0,3 l" a „Kofola
 *       0,5 l"), návrh se nedělá — vybere člověk;
 *   (c) jinak 'nenamapovano'.
 * Druhy bez skladu → 'neskladova' bez produktu. Už ověřenou položku
 * nepřepisuje (vrátí ji beze změny).
 */
export function navrhnoutMapovani(
  polozka: PolozkaNavrhu,
  katalog: readonly ProduktKatalogu[],
  aliasy: readonly AliasMapovani[],
): { polozka: PolozkaNavrhu; kandidati: KandidatMapovani[] } {
  if (polozka.mapovani === 'overeno') return { polozka, kandidati: [] }
  if (DRUHY_BEZ_SKLADU.includes(polozka.druh)) return { polozka: bezProduktu(polozka, 'neskladova'), kandidati: [] }

  const nazevDokladu = polozka.nazevPuvodni.trim() !== '' ? polozka.nazevPuvodni : polozka.nazev
  const klic = normalizovatNazev(nazevDokladu)
  const zive = katalog.filter((k) => !k.smazano)

  if (klic !== '') {
    for (const a of aliasy) {
      if (normalizovatNazev(a.alias) !== klic) continue
      const produkt = zive.find((k) => k.externiId === a.posProduktId)
      // Alias na produkt, který v pokladně už není (smazaný, jiný katalog), neplatí.
      if (!produkt) continue
      return {
        polozka: sProduktem(polozka, produkt, 'overeno'),
        kandidati: [{ produkt, skore: 1, proc: 'Dříve ověřené přiřazení tohoto názvu' }],
      }
    }
  }

  const kandidati = zive
    .map((produkt) => ({ produkt, ...ohodnotit(nazevDokladu, produkt) }))
    .filter((k) => k.skore >= MIN_SKORE_KANDIDATA)
    .sort((x, y) => y.skore - x.skore || x.produkt.nazev.localeCompare(y.produkt.nazev, 'cs') || x.produkt.externiId.localeCompare(y.produkt.externiId))
    .slice(0, 3)

  const [prvni, druhy] = kandidati
  const rozhodnuto = prvni && prvni.skore >= MIN_SKORE_NAVRHU && (!druhy || prvni.skore - druhy.skore > ROZDIL_PRO_ROZHODNUTI)
  if (rozhodnuto) return { polozka: sProduktem(polozka, prvni.produkt, 'navrh'), kandidati }
  return { polozka: bezProduktu(polozka, 'nenamapovano'), kandidati }
}

/**
 * Člověk potvrdil navržené přiřazení → 'overeno'. Databáze pustí do
 * výdeje jen ověřené přiřazení (`app.jp_sestavit_vydej`), takže bez
 * tohohle kroku se skladový návrh neodešle. Řádek bez produktu nebo
 * neskladový se nemění. Uložit alias pro příště je zvláštní krok
 * (`jine_platby_ulozit_mapovani`).
 */
export function overitMapovani(polozka: PolozkaNavrhu): PolozkaNavrhu {
  if (polozka.posProduktId === null || polozka.mapovani === 'neskladova' || DRUHY_BEZ_SKLADU.includes(polozka.druh)) return polozka
  return { ...polozka, mapovani: 'overeno' }
}

/**
 * Přepočítá množství pro pokladnu u řádku, který už produkt má (třeba
 * po ruční změně množství u ověřeného řádku). Přiřazení nemění.
 */
export function prepocitatPosMnozstvi(polozka: PolozkaNavrhu, katalog: readonly ProduktKatalogu[]): PolozkaNavrhu {
  if (polozka.posProduktId === null || DRUHY_BEZ_SKLADU.includes(polozka.druh)) return polozka
  const produkt = katalog.find((k) => k.externiId === polozka.posProduktId && !k.smazano)
  if (!produkt) {
    return upravitDuvody({ ...polozka, posMnozstvi: null }, jePrevod, [`${PREDPONA_PREVODU}Produkt v katalogu pokladny už není`])
  }
  return sProduktem(polozka, produkt, polozka.mapovani === 'overeno' ? 'overeno' : 'navrh')
}
