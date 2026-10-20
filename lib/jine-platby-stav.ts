/**
 * Jiné platby — popisky stavů, kroky průvodce a dostupné akce.
 *
 * Každá část záznamu (kontrola, tržba, sklad, faktura, úhrada) má
 * vlastní stav a vyhodnocuje se zvlášť. Dokončení jedné části nikdy
 * neoznačí jinou za hotovou: zapsaná tržba neznamená odečtený sklad,
 * vystavená faktura neznamená zaplaceno.
 *
 * `dostupneAkce` jen ZRCADLÍ pravidla databázových funkcí
 * (docs/jine-platby-navrh.md, oddíl 5), aby obrazovka věděla, co
 * nakreslit. Rozhoduje vždycky databáze — každá funkce si právo
 * i stav ověří sama a schované tlačítko nic nechrání. Když se tohle
 * zrcadlo s databází rozejde, obrazovka nanejvýš ukáže tlačítko,
 * které databáze odmítne, nebo neukáže tlačítko navíc.
 *
 * Čisté funkce — testuje scripts/jine-platby.test.mjs přímo Nodem.
 */

import type {
  DruhPolozky,
  StavFaktury,
  StavKontroly,
  StavSkladu,
  StavTrzby,
  StavUhrady,
  TypDokladu,
  ZaznamJinePlatby,
} from './jine-platby-typy.ts'
import { PLATNOST_KONTROLY_SKLADU_MIN, PLATNOST_KONTROLY_TRZBY_MIN } from './jine-platby-typy.ts'
import { REZERVA_PO_PLATNOSTI_MS } from './jine-platby-pos-operace.ts'

export type Ton = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/** `varovani` → obrazovka přidá ikonu (barva sama význam nenese). Platí u každého tónu warning/danger. */
export type PopisStavu = { text: string; ton: Ton; varovani: boolean }

const p = (text: string, ton: Ton): PopisStavu => ({ text, ton, varovani: ton === 'warning' || ton === 'danger' })

const KONTROLA: Record<StavKontroly, PopisStavu> = {
  rozpracovano: p('Rozpracováno', 'neutral'),
  ke_kontrole: p('Ke kontrole', 'warning'),
  zkontrolovano: p('Zkontrolováno', 'success'),
  zruseno: p('Zrušeno', 'neutral'),
}

const TRZBA: Record<StavTrzby, PopisStavu> = {
  nezapsano: p('Tržba nezapsána', 'neutral'),
  zapsano: p('Tržba zapsána v Ostatních tržbách', 'success'),
  propojeno: p('Prodej je v pokladně — propojeno, nezapočítáno podruhé', 'success'),
  stornovano: p('Tržba stornována', 'neutral'),
}

const SKLAD: Record<StavSkladu, PopisStavu> = {
  bez_navrhu: p('Skladový návrh zatím neodeslán', 'neutral'),
  nevyzaduje: p('Sklad se netýká', 'neutral'),
  ceka_na_schvaleni: p('Čeká na potvrzení výdeje do POS', 'accent'),
  zamitnuto: p('Výdej zamítnut', 'danger'),
  schvaleno: p('Schváleno — výdej čeká na provedení', 'accent'),
  zpracovava_se: p('Odesláno do pokladny — čeká se na ověření', 'accent'),
  nejasny_vysledek: p('Nejasný výsledek — dohledává se v pokladně, neopakuje se naslepo', 'warning'),
  odecteno_v_pos: p('Odečteno v POS', 'success'),
  jiz_odecteno: p('Pokladna už výdej provedla dřív — propojeno', 'success'),
  rucne_dolozeno: p('Ručně doloženo (neověřeno pokladnou)', 'warning'),
  // Schválený výdej předaný k ručnímu odpisu — výdej je ZAHÁJENÝ (zrušit
  // záznam ani změnit položky pro sklad nejde, jen „Zrušit schválení").
  nepodporovano: p('Schváleno — výdej provést ručně v pokladně', 'warning'),
  chyba: p('Pokladna výdej neprovedla — lze zkusit znovu', 'danger'),
  nutna_kontrola: p('Nutná kontrola — nelze zjistit, jestli už je odečteno', 'danger'),
  opraveno: p('Výdej opraven korekcí', 'neutral'),
}

const FAKTURA: Record<StavFaktury, PopisStavu> = {
  bez_faktury: p('Bez faktury', 'neutral'),
  podklady: p('Podklady pro fakturu připravené', 'accent'),
  propojena: p('Faktura propojena', 'success'),
}

const UHRADA: Record<StavUhrady, PopisStavu> = {
  neovereno: p('Úhrada neověřena', 'warning'),
  castecne: p('Uhrazeno částečně (podle banky)', 'warning'),
  uhrazeno: p('Uhrazeno (ověřeno v bance)', 'success'),
}

const TYPY: Record<TypDokladu, string> = {
  otevreny_ucet: 'Otevřený účet',
  uzavreny_prodej: 'Uzavřený prodej',
  informativni_sjetina: 'Informativní sjetina',
  rucni_spotreba: 'Ruční spotřeba',
  nezjisteno: 'Nezjištěno',
}

const DRUHY: Record<DruhPolozky, string> = {
  pokrm: 'Pokrm',
  rozlevany_napoj: 'Rozlévaný nápoj',
  kusove_zbozi: 'Kusové zboží',
  sluzba: 'Služba',
  spropitne: 'Spropitné',
  sleva: 'Sleva',
  neskladova: 'Neskladová položka',
  nezarazeno: 'Nezařazeno',
}

const neznamy = (s: string): PopisStavu => p(`Neznámý stav (${s})`, 'danger')

export function popisStavuKontroly(s: StavKontroly): PopisStavu {
  return KONTROLA[s] ?? neznamy(s)
}
export function popisStavuTrzby(s: StavTrzby): PopisStavu {
  return TRZBA[s] ?? neznamy(s)
}
/** „Odečteno v POS" jen u ověřeného výdeje; ruční doložení není automatické ověření. */
export function popisStavuSkladu(s: StavSkladu): PopisStavu {
  return SKLAD[s] ?? neznamy(s)
}
export function popisStavuFaktury(s: StavFaktury): PopisStavu {
  return FAKTURA[s] ?? neznamy(s)
}
/**
 * Tržba je zapsaná v Ostatních tržbách, a dodatečná kontrola proti
 * pokladně (`jine_platby_zapsat_kontrolu` jde volat i po zápisu) prodej
 * v pokladně našla — buď jistě, nebo pravděpodobně. Tržba je pak nejspíš
 * započítaná DVAKRÁT (jednou z pokladny, jednou tady); obrazovka varuje
 * a vede na storno. Rozhoduje člověk — appka nic nestornuje sama.
 */
export function moznaDvakrat(z: ZaznamJinePlatby): boolean {
  const v = z.kontrolaTrzby?.vysledek
  return z.stavTrzby === 'zapsano' && (v === 'nalezeno' || v === 'pravdepodobne')
}

/**
 * Opak `moznaDvakrat`: tržba je PROPOJENÁ s KONKRÉTNÍM prodejem v pokladně
 * (`posProdejId`; do součtu se nepřičetla, protože „je v pokladně"), ale
 * dodatečná kontrola dotazem do pokladny (`zdroj: 'pos_api'`) prodej
 * nenašla. Prodej pak nejspíš není započítaný NIKDE — ani v pokladně, ani
 * v Ostatních tržbách. Obrazovka varuje a vede k opravě; rozhoduje člověk.
 *
 * Jen s `posProdejId` (R1, kontrola 20. 10.): propojení BEZ konkrétního
 * prodeje vzniká právě tam, kde kontrola účet v pokladně najít neumí
 * (shoda jen částky, otevřený účet, který se pak uzavřel pod jiným číslem
 * a dorostlou částkou, ruční „je v pokladně"). Dodatečná kontrola ho
 * ověřit neumí — „nenalezeno" by byl falešný poplach a rada „zapište jako
 * novou" by vedla ke dvojí tržbě. Takové propojení se dodatečně
 * nekontroluje (`dostupneAkce` 'kontrola_trzby' ho nenabídne).
 *
 * Verze se neporovnává: kontrola hledá TENTÝŽ prodej (`posProdejId`), který
 * se uložením návrhu nemění (částku, měnu ani datum zapsané/propojené
 * tržby `jine_platby_ulozit_navrh` stejně odmítne změnit).
 *
 * Ruční prohlášení se nepočítá: propojení bez nálezu v pokladně chce
 * důvod (`p_duvod_propojeni`), člověk tedy o „nenalezeno" věděl.
 *
 * Totéž filtruje přehled v databázi (filtr „Možná nezapočítáno",
 * app/[rozsah]/finance/trzby/jine-platby/page.tsx) — mění-li se tohle
 * pravidlo, mění se i ten filtr.
 */
export function moznaNikde(z: ZaznamJinePlatby): boolean {
  const k = z.kontrolaTrzby
  return z.stavTrzby === 'propojeno' && z.posProdejId !== null && k !== null && k.zdroj === 'pos_api' && k.vysledek === 'nenalezeno'
}

/** Výsledek pokladny, proti kterému ruční prohlášení opačného znění neprojde bez potvrzení (viz `prohlaseniProtiPokladne`). */
export type ProhlaseniProtiPokladne = { vysledek: string; chceOpravu: boolean }

/**
 * Poslední výsledek DOTAZU DO POKLADNY daného druhu (`pokladnaTrzby` /
 * `pokladnaSkladu`, ne poslední kontrola — ruční prohlášení stejného znění
 * ho nevypere, ověření 20. 10.) je výsledek, který ruční prohlášení opačného
 * znění nepřepíše jen tak
 * (`jine_platby_prohlasit`, P1 z 20. 10.):
 *
 *   'trzba' — pokladna prodej našla (`nalezeno`) nebo pravděpodobně našla
 *             (`pravdepodobne`); prohlášení „v pokladně není" by z jednoho
 *             prodeje udělalo dvě tržby;
 *   'sklad' — pokladna už spotřebu odečetla (`jiz_odecteno`); prohlášení
 *             „neodečteno" by vedlo k druhému odpisu.
 *
 * BEZ OHLEDU NA VERZI: uložení návrhu zvedne verzi i bez změny a pojistka
 * vázaná na verzi padla prvním uložením (C1/R2). Výsledek pokladny nahradí
 * jen novější kontrola v pokladně (nebo prohlášení s potvrzením níž).
 *
 * Vrací `{ vysledek, chceOpravu }`, jinak `null` (prohlásit jde volně):
 *   `vysledek`   — text výčtu, ať ho obrazovka jmenuje u prohlášení;
 *   `chceOpravu` — `false` jen u `pravdepodobne` ze shody SAMOTNÉ ČÁSTKY
 *                  (`detail.shoda = 'castka'`): přepsat
 *                  smí kdokoli s právem k prohlášení, s výslovným potvrzením
 *                  (`p_prepsat_pokladnu = true`, prodej v pokladně je jiný);
 *                  `true` u `nalezeno`, `pravdepodobne` ze shody čísla účtu
 *                  (`cislo_vice`) a `jiz_odecteno` (konkrétní prodej nebo
 *                  odpis): navíc jen s právem `jine_platby.oprava`.
 * Platnost v čase se nehlídá — databáze ji taky nehlídá.
 */
export function prohlaseniProtiPokladne(z: ZaznamJinePlatby, druh: 'trzba' | 'sklad'): ProhlaseniProtiPokladne | null {
  const k = druh === 'trzba' ? z.pokladnaTrzby : z.pokladnaSkladu
  if (k === null || k.zdroj !== 'pos_api') return null
  const brani = druh === 'trzba' ? k.vysledek === 'nalezeno' || k.vysledek === 'pravdepodobne' : k.vysledek === 'jiz_odecteno'
  const jenCastka = k.vysledek === 'pravdepodobne' && (k.detail as Record<string, unknown> | null | undefined)?.shoda === 'castka'
  return brani ? { vysledek: k.vysledek, chceOpravu: !jenCastka } : null
}

/** Název agendy „Jiné platby" neznamená zaplaceno — úhradu ověřuje jen napárovaná bankovní transakce. */
export function popisStavuUhrady(s: StavUhrady): PopisStavu {
  return UHRADA[s] ?? neznamy(s)
}
export function popisTypuDokladu(t: TypDokladu): string {
  return TYPY[t] ?? t
}
export function popisDruhu(d: DruhPolozky): string {
  return DRUHY[d] ?? d
}

/* ------------------------------------------------------------------ */
/* Kontrola proti pokladně                                              */
/* ------------------------------------------------------------------ */

/** Hodiny serveru a prohlížeče se můžou mírně rozcházet; kontrola „z budoucnosti" do minuty ještě platí. */
const TOLERANCE_HODIN_MS = 60_000

/**
 * Platí kontrola proti pokladně? Jen pro TUTÉŽ verzi záznamu (po změně
 * návrhu je stará kontrola o něčem jiném) a jen čerstvá — pokladna mohla
 * mezitím prodej zapsat nebo výdej provést sama.
 *
 * Stejně jako `app.jp_kontrola_plati` v migraci: platí, dokud je mladší
 * než `platnostMin` (přesně na hranici už ne). Navíc — přísněji než
 * databáze — neplatí kontrola víc než minutu „z budoucnosti" (rozhozené
 * hodiny); obrazovka pak nanejvýš tlačítko neukáže.
 */
export function kontrolaPlati(k: { verze: number; kdy: string } | null, verze: number, platnostMin: number, tedMs: number): boolean {
  if (!k || k.verze !== verze) return false
  const kdy = Date.parse(k.kdy)
  if (!Number.isFinite(kdy)) return false
  const stari = tedMs - kdy
  return stari >= -TOLERANCE_HODIN_MS && stari < platnostMin * 60_000
}

/* ------------------------------------------------------------------ */
/* Průvodce                                                             */
/* ------------------------------------------------------------------ */

export type StavKroku = 'hotovo' | 'aktualni' | 'ceka' | 'blokovano' | 'nepotrebny'
export type KrokPruvodce = { cislo: number; nazev: string; stav: StavKroku; popis: string }

export const NAZVY_KROKU = [
  'Provozovna a pokladna',
  'Doklad nebo ruční zadání',
  'Rozpoznání položek a částky',
  'Kontrola a přiřazení ke katalogu',
  'Kontrola tržby a výdeje v pokladně',
  'Zápis tržby',
  'Skladový návrh ke schválení',
  'Potvrzení výdeje v pokladně',
  'Faktura',
] as const

const BEZ_POKLADNY = 'Provozovna nemá připojenou pokladnu — výdej jen ručně'

/** Stavy skladu, kdy výdej proběhl (ověřeně, propojením nebo ručně). */
const VYDEJ_HOTOV: readonly StavSkladu[] = ['odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno']
/** Stavy, ve kterých se kontrola skladu proti pokladně ještě potřebuje. */
const SKLAD_PRED_VYDEJEM: readonly StavSkladu[] = ['bez_navrhu', 'ceka_na_schvaleni', 'schvaleno', 'zamitnuto']
const TRZBA_VYRESENA: readonly StavTrzby[] = ['zapsano', 'propojeno', 'stornovano']

/**
 * Devět kroků průvodce. Každý krok se vyhodnotí ze SVÉHO stavu, takže
 * může být víc kroků „aktuálních" najednou (tržba a sklad jdou nezávisle)
 * a hotová tržba neoznačí sklad. Zrušený záznam: co hotové bylo, zůstane
 * hotové, zbytek je „nepotřebný".
 */
export function krokyPruvodce(
  z: ZaznamJinePlatby,
  m: { pocetSouboru: number; pocetPolozek: number; maPokladnu: boolean; maZiveNavrhSkladu: boolean },
): KrokPruvodce[] {
  const zkontrolovano = z.stavKontroly === 'zkontrolovano'
  const maObsah = m.pocetSouboru > 0 || m.pocetPolozek > 0
  const kroky: Omit<KrokPruvodce, 'cislo' | 'nazev'>[] = []

  // 1 Provozovna a pokladna — záznam vždycky pobočku má.
  kroky.push({
    stav: 'hotovo',
    popis: m.maPokladnu ? 'Provozovna má připojenou pokladnu' : BEZ_POKLADNY,
  })

  // 2 Doklad nebo ruční zadání
  kroky.push(
    maObsah
      ? { stav: 'hotovo', popis: m.pocetSouboru > 0 ? `Nahráno souborů: ${m.pocetSouboru}` : 'Zadáno ručně' }
      : { stav: 'aktualni', popis: 'Nahrajte fotku dokladu nebo zadejte položky ručně' },
  )

  // 3 Rozpoznání položek a částky
  if (m.pocetPolozek > 0) kroky.push({ stav: 'hotovo', popis: `Položek: ${m.pocetPolozek}` })
  else if (m.pocetSouboru > 0) kroky.push({ stav: 'aktualni', popis: 'Doklad čeká na rozpoznání nebo ruční přepis položek' })
  else kroky.push({ stav: 'ceka', popis: 'Nejdřív doklad nebo ruční zadání' })

  // 4 Kontrola a přiřazení ke katalogu
  if (zkontrolovano) kroky.push({ stav: 'hotovo', popis: 'Částka, měna, datum a položky zkontrolované' })
  else if (m.pocetPolozek > 0 || z.stavKontroly === 'ke_kontrole') {
    kroky.push({ stav: 'aktualni', popis: z.stavKontroly === 'ke_kontrole' ? 'Některé údaje čekají na kontrolu' : 'Zkontrolujte položky a přiřaďte je ke katalogu' })
  } else kroky.push({ stav: 'ceka', popis: 'Nejdřív položky' })

  // 5 Kontrola tržby a výdeje v pokladně
  const trzbaZkontrolovana = TRZBA_VYRESENA.includes(z.stavTrzby) || (z.kontrolaTrzby !== null && z.kontrolaTrzby.verze === z.verze)
  const skladZkontrolovan =
    !m.maPokladnu || !SKLAD_PRED_VYDEJEM.includes(z.stavSkladu) || (z.kontrolaSkladu !== null && z.kontrolaSkladu.verze === z.verze)
  if (trzbaZkontrolovana && skladZkontrolovan) kroky.push({ stav: 'hotovo', popis: 'Ověřeno proti pokladně nebo ručně doloženo' })
  else if (zkontrolovano) {
    const zbyva = [!trzbaZkontrolovana ? 'kontrola tržby' : null, !skladZkontrolovan ? 'kontrola výdeje (těsně před potvrzením)' : null].filter(Boolean)
    kroky.push({ stav: 'aktualni', popis: `Zbývá: ${zbyva.join(', ')}` })
  } else kroky.push({ stav: 'ceka', popis: 'Nejdřív kontrola záznamu' })

  // 6 Zápis tržby
  if (z.stavTrzby === 'zapsano') kroky.push({ stav: 'hotovo', popis: 'Zapsáno v Ostatních tržbách' })
  else if (z.stavTrzby === 'propojeno') kroky.push({ stav: 'hotovo', popis: 'Prodej je v pokladně — propojeno, nezapočítáno podruhé' })
  else if (z.stavTrzby === 'stornovano') kroky.push({ stav: 'hotovo', popis: 'Tržba byla stornována (oprava je v historii)' })
  else if (zkontrolovano && trzbaZkontrolovana) kroky.push({ stav: 'aktualni', popis: 'Potvrďte zápis tržby' })
  else kroky.push({ stav: 'ceka', popis: zkontrolovano ? 'Nejdřív kontrola tržby proti pokladně' : 'Nejdřív kontrola záznamu' })

  // 7 Skladový návrh ke schválení
  const s = z.stavSkladu
  const zivyNavrhChybi = (s === 'ceka_na_schvaleni' || s === 'schvaleno') && !m.maZiveNavrhSkladu
  if (s === 'nevyzaduje') kroky.push({ stav: 'nepotrebny', popis: 'Žádná položka neodečítá sklad' })
  else if (s === 'jiz_odecteno') kroky.push({ stav: 'nepotrebny', popis: 'Pokladna už výdej provedla — jen propojeno' })
  else if (s === 'rucne_dolozeno') kroky.push({ stav: 'nepotrebny', popis: 'Výdej doložen ručně' })
  else if (zivyNavrhChybi) kroky.push({ stav: 'aktualni', popis: 'Návrh byl změnou záznamu nahrazen — odešlete ho znovu' })
  else if (s === 'bez_navrhu' || s === 'zamitnuto') {
    if (!m.maPokladnu) kroky.push({ stav: 'blokovano', popis: BEZ_POKLADNY })
    else if (zkontrolovano) kroky.push({ stav: 'aktualni', popis: s === 'zamitnuto' ? 'Návrh byl zamítnut — upravte a odešlete znovu' : 'Odešlete skladový návrh ke schválení' })
    else kroky.push({ stav: 'ceka', popis: 'Nejdřív kontrola záznamu' })
  } else kroky.push({ stav: 'hotovo', popis: 'Návrh odeslán' })

  // 8 Potvrzení výdeje v pokladně
  if (s === 'nevyzaduje') kroky.push({ stav: 'nepotrebny', popis: 'Žádná položka neodečítá sklad' })
  else if (VYDEJ_HOTOV.includes(s)) kroky.push({ stav: 'hotovo', popis: SKLAD[s].text })
  else if (!m.maPokladnu) kroky.push({ stav: 'blokovano', popis: BEZ_POKLADNY })
  else if (s === 'bez_navrhu' || s === 'zamitnuto' || zivyNavrhChybi) kroky.push({ stav: 'ceka', popis: 'Nejdřív skladový návrh' })
  else kroky.push({ stav: 'aktualni', popis: SKLAD[s].text })

  // 9 Faktura — jen když ji odběratel chce; bez ní záznam nic nechybí.
  if (z.stavFaktury === 'propojena') kroky.push({ stav: 'hotovo', popis: z.fakturaCislo ? `Faktura ${z.fakturaCislo}` : 'Faktura propojena' })
  else if (z.stavFaktury === 'podklady') kroky.push({ stav: 'aktualni', popis: 'Podklady připravené, faktura zatím nepropojená' })
  else kroky.push({ stav: 'ceka', popis: 'Jen když odběratel chce fakturu' })

  const zruseno = z.stavKontroly === 'zruseno'
  return kroky.map((k, i) => ({
    cislo: i + 1,
    nazev: NAZVY_KROKU[i],
    ...(zruseno && k.stav !== 'hotovo' ? { stav: 'nepotrebny' as const, popis: 'Záznam je zrušený' } : k),
  }))
}

/* ------------------------------------------------------------------ */
/* Dostupné akce                                                        */
/* ------------------------------------------------------------------ */

export type AkceJinePlatby =
  | 'nahrat'
  | 'rozpoznat'
  | 'upravit'
  | 'oznacit_zkontrolovano'
  | 'kontrola_trzby'
  | 'prohlasit_trzbu'
  | 'potvrdit_trzbu'
  | 'odeslat_sklad'
  | 'kontrola_skladu'
  | 'prohlasit_sklad'
  | 'rozhodnout_vydej'
  | 'provest_vydej'
  | 'obnovit_vydej'
  | 'vydej_znovu'
  | 'propojit_vydej'
  | 'rucne_dolozit'
  | 'faktura'
  | 'uhrada'
  | 'opravit_trzbu'
  | 'korekce_vydeje'
  | 'zrusit_schvaleni'
  | 'zrusit'

/** Výdej může být doložen (kontrolou, propojením): pokladna ani appka ho zatím neprovedla a požadavek není na cestě. */
const SKLAD_K_DOLOZENI: readonly StavSkladu[] = ['bez_navrhu', 'ceka_na_schvaleni', 'zamitnuto', 'schvaleno', 'nepodporovano', 'chyba', 'nutna_kontrola']
/**
 * `jine_platby_zrusit`: výdej neproběhl ani neprobíhá. NE `nepodporovano`
 * ani `schvaleno` (N14): schválený výdej je zahájený — schvalovatel ho
 * možná právě ručně odepisuje v pokladně (provedení přes API selhalo,
 * obrazovka vede k ručnímu odpisu). Uvolnit ho jde jen „Zrušit schválení"
 * (`jine_platby_zrusit_schvaleni`), nebo ho doložit.
 */
const SKLAD_LZE_ZRUSIT: readonly StavSkladu[] = ['bez_navrhu', 'nevyzaduje', 'zamitnuto', 'ceka_na_schvaleni', 'chyba']
/**
 * `jine_platby_zrusit_schvaleni` a `jine_platby_rucne_dolozit_vydej`: stavy
 * skladu se schváleným výdejem, který nikam neodešel (nebo prokazatelně
 * selhal). Ručně doložit jde navíc jen živý (schválený) návrh.
 */
const SKLAD_SCHVALENY_K_RUCNIMU: readonly StavSkladu[] = ['schvaleno', 'nepodporovano', 'chyba']
/** Stavy skladu, kdy je požadavek do pokladny na cestě (`zpracovava_se`) nebo nejasný. */
const SKLAD_OPERACE_NA_CESTE: readonly StavSkladu[] = ['zpracovava_se', 'nejasny_vysledek']
/** Hotová operace: ruční doložení ani zrušení schválení už nejde (korekce). */
const OPERACE_HOTOVA = ['uspech', 'rucne_dolozeno']
/** Autor bez práva na opravy smí zrušit jen záznam, u kterého se sklad ještě nerozjel. */
const SKLAD_AUTOR_ZRUSI: readonly StavSkladu[] = ['bez_navrhu', 'nevyzaduje', 'zamitnuto']
const OPERACE_NA_CESTE = ['odesila_se', 'nejasny_vysledek']
/**
 * `jine_platby_zahajit_rozpoznani` (P5): schválený nebo provedený výdej —
 * nové čtení by měnilo skladové položky a `jine_platby_ulozit_navrh` by ho
 * odmítl až po zaplaceném čtení (C9/R3). Zapsaná tržba čtení NEBRÁNÍ.
 */
const SKLAD_BRANI_ROZPOZNANI: readonly StavSkladu[] = [
  'schvaleno',
  'nepodporovano',
  'zpracovava_se',
  'nejasny_vysledek',
  'odecteno_v_pos',
  'jiz_odecteno',
  'rucne_dolozeno',
  'opraveno',
]

/**
 * Vypršela platnost požadavku do pokladny i s rezervou? `platnostDoIso` +
 * `REZERVA_PO_PLATNOSTI_MS` (2 min) < `tedMs` — po ní pokladna požadavek
 * neprovede (stejná hranice jako `obnovitOperaci`). Databáze
 * (`jine_platby_rucne_dolozit_vydej`, `jine_platby_zrusit_schvaleni`)
 * pustí ruční východ při `platnost_do + 2 min <= now()`; zrcadlo je
 * přesně na hranici o chlup přísnější. Chybějící nebo nečitelná platnost
 * = nevypršela (databáze při `platnost_do is null` taky odmítne).
 */
export function platnostOperaceVyprsela(platnostDoIso: string | null | undefined, tedMs: number): boolean {
  if (typeof platnostDoIso !== 'string') return false
  const platnost = Date.parse(platnostDoIso)
  return Number.isFinite(platnost) && platnost + REZERVA_PO_PLATNOSTI_MS < tedMs
}

/**
 * Akce, které obrazovka nabídne. Zrcadlí pravidla databázových funkcí
 * v migraci 20261016100000_jine_platby.sql (právo na pobočce záznamu
 * + stav). Rozhoduje databáze — tohle jen říká, co nakreslit. Kde je
 * zrcadlo přísnější než databáze (prohlášení jen u zkontrolovaného
 * záznamu, propojení výdeje ne u „sklad se netýká"), je to napsané
 * u akce; opačně (nabídnout, co databáze odmítne) být nesmí.
 *
 * Oddělení práv: `jine_platby.trzba` NIKDY neodemkne skladovou akci
 * a `jine_platby.vydej_pos` nikdy tržbu. Každá akce níž se ptá jen
 * na své právo.
 *
 * `prava` = práva agendy platná na pobočce záznamu (lib/jine-platby-pristup.ts).
 * `stavOperace` = stav poslední operace výdeje v pokladně (pos_operace) nebo null.
 * `uzivatelId` (nepovinné) = přihlášený — autor smí svůj rozpracovaný
 * záznam zrušit i bez práva na opravy (`jine_platby_zrusit`).
 * `dohledaniUctu` (nepovinné) = pokladna umí dohledat účty
 * (`schopnosti.dohledaniUctu`). Bez něj dodatečná kontrola tržby po
 * zápisu nemá smysl (ruční prohlášení po zápisu nic neověří) a nenabízí se.
 * `platnostOperace` (nepovinné) = `platnost_do` poslední operace výdeje
 * (ISO řetězec) nebo null. Operace na cestě (`odesila_se`,
 * `nejasny_vysledek`), jejíž platnost i s rezervou 2 min vypršela
 * (`platnostOperaceVyprsela`), už se do pokladny nedostane — oprávněná
 * osoba pak smí výdej ručně doložit nebo schválení zrušit (C5, P3), jinak
 * by záznam neměl východ, když pokladna nejde otevřít nebo dohledání
 * trvale selhává. Bez `platnostOperace` se tenhle východ nenabízí.
 *
 * Změny 20. 10. (C5, C9/R1/R3):
 *   'rozpoznat'        — i u zapsané nebo propojené tržby; NE u schváleného
 *                        nebo provedeného výdeje (`SKLAD_BRANI_ROZPOZNANI`);
 *   'kontrola_trzby'   — u propojené tržby jen s konkrétním prodejem
 *                        (`posProdejId`), viz `moznaNikde`;
 *   'rucne_dolozit',
 *   'zrusit_schvaleni' — i při operaci na cestě po vypršení její platnosti.
 */
export function dostupneAkce(
  z: ZaznamJinePlatby,
  prava: ReadonlySet<string>,
  m: {
    maPokladnu: boolean
    maZiveNavrhSkladu: boolean
    stavOperace: string | null
    tedMs: number
    uzivatelId?: string | null
    dohledaniUctu?: boolean
    platnostOperace?: string | null
  },
): Set<AkceJinePlatby> {
  const a = new Set<AkceJinePlatby>()
  if (z.stavKontroly === 'zruseno') return a

  const ma = (pravo: string) => prava.has(pravo)
  const zadat = ma('jine_platby.zadat')
  const upravit = ma('jine_platby.upravit')
  const trzba = ma('jine_platby.trzba')
  const sklad = ma('jine_platby.sklad_odeslat')
  const vydej = ma('jine_platby.vydej_pos')
  const faktura = ma('jine_platby.faktura')
  const oprava = ma('jine_platby.oprava')

  const s = z.stavSkladu
  const op = m.stavOperace
  const zkontrolovano = z.stavKontroly === 'zkontrolovano'
  const trzbaKZapisu = z.stavTrzby === 'nezapsano' || z.stavTrzby === 'stornovano'
  const trzbaZapsana = z.stavTrzby === 'zapsano' || z.stavTrzby === 'propojeno'
  const kontrolaSkladu = kontrolaPlati(z.kontrolaSkladu, z.verze, PLATNOST_KONTROLY_SKLADU_MIN, m.tedMs) ? (z.kontrolaSkladu?.vysledek ?? null) : null
  // Operace na cestě, která se do pokladny už nedostane (platnost + 2 min pryč) — P3.
  const naCeste = op !== null && OPERACE_NA_CESTE.includes(op)
  const naCestePropadla = naCeste && platnostOperaceVyprsela(m.platnostOperace, m.tedMs)

  // Doklad a návrh (pripojit_soubor a ulozit_navrh hlídají zrušení; zapsanou tržbu
  // a rozjetý výdej chrání ulozit_navrh uvnitř — odmítne změnu částky, měny, data
  // nebo položek pro sklad, ostatní projde).
  // Rozpoznání NE u schváleného nebo provedeného výdeje (`jine_platby_zahajit_rozpoznani`
  // ho odmítne, P5): nové čtení by měnilo skladové položky a uložení by spadlo až po
  // zaplaceném čtení. Zapsaná nebo propojená tržba čtení nebrání — položky pro sklad
  // se uloží, částku, měnu a datum akce ponechá (C9/R3).
  if (zadat || upravit) {
    a.add('nahrat')
    if (!SKLAD_BRANI_ROZPOZNANI.includes(s)) a.add('rozpoznat')
  }
  if (upravit) a.add('upravit')
  if (upravit && !zkontrolovano && z.castkaHaleru !== null && z.mena !== null && z.datumProdeje !== null) a.add('oznacit_zkontrolovano')

  // Tržba — jen právo jine_platby.trzba (prohlášení: přísněji než databáze, jen u záznamu, kde má smysl).
  if (trzba && zkontrolovano && trzbaKZapisu) {
    if (m.maPokladnu) a.add('kontrola_trzby')
    a.add('prohlasit_trzbu')
    const udaje = z.castkaHaleru !== null && z.castkaHaleru > 0 && z.mena !== null && z.datumProdeje !== null
    if (udaje && kontrolaPlati(z.kontrolaTrzby, z.verze, PLATNOST_KONTROLY_TRZBY_MIN, m.tedMs)) a.add('potvrdit_trzbu')
  }
  // Dodatečná kontrola po zápisu nebo propojení (`jine_platby_zapsat_kontrolu` jde
  // volat i po nich). Jen s dohledáním účtů:
  //   zapsano   — nenašla pokladna mezitím tentýž prodej? (`moznaDvakrat`)
  //   propojeno — je propojený prodej v pokladně opravdu? (`moznaNikde`, když ne).
  //               Jen propojení s KONKRÉTNÍM prodejem (`posProdejId`, R1): propojení
  //               bez něj vzniká tam, kde kontrola účet najít neumí, a „nenalezeno"
  //               by byl falešný poplach.
  const propojenoSProdejem = z.stavTrzby === 'propojeno' && z.posProdejId !== null
  if (trzba && (z.stavTrzby === 'zapsano' || propojenoSProdejem) && m.maPokladnu && m.dohledaniUctu === true) a.add('kontrola_trzby')

  // Sklad — odeslání návrhu jen jine_platby.sklad_odeslat (bez pokladny ho databáze nesestaví).
  if (sklad && zkontrolovano && m.maPokladnu && (s === 'bez_navrhu' || s === 'zamitnuto' || s === 'nevyzaduje')) a.add('odeslat_sklad')

  // Vše ostatní kolem výdeje jen jine_platby.vydej_pos.
  if (vydej) {
    if (m.maPokladnu && zkontrolovano && SKLAD_K_DOLOZENI.includes(s)) {
      a.add('kontrola_skladu')
      a.add('prohlasit_sklad')
    }
    // Schválit i zamítnout; schválení navíc chce čerstvou kontrolu „neodečteno" (muzeSchvalitVydej).
    if (s === 'ceka_na_schvaleni' && m.maZiveNavrhSkladu) a.add('rozhodnout_vydej')
    // pos_operace_zahajit: operace připravená a čerstvá kontrola „neodečteno".
    if (m.maPokladnu && s === 'schvaleno' && m.maZiveNavrhSkladu && op === 'pripraveno' && kontrolaSkladu === 'neodecteno') a.add('provest_vydej')
    // Nejasný nebo zaseknutý požadavek se jen dohledává, nikdy neposílá znovu.
    if ((s === 'nejasny_vysledek' || s === 'zpracovava_se') && op !== null && OPERACE_NA_CESTE.includes(op)) a.add('obnovit_vydej')
    // Znovu jen po PROKÁZANÉ chybě a s čerstvou kontrolou „neodečteno".
    if (s === 'chyba' && m.maZiveNavrhSkladu && (op === null || op === 'chyba') && kontrolaSkladu === 'neodecteno') a.add('vydej_znovu')
    // Propojit jen s čerstvým doložením „pokladna už odečetla" a bez požadavku na cestě.
    if (SKLAD_K_DOLOZENI.includes(s) && kontrolaSkladu === 'jiz_odecteno') a.add('propojit_vydej')
    // Ručně doložit jde jen schválený (živý) návrh, jehož požadavek není hotový
    // a není na cestě — leda na cestě s propadlou platností (P3, C5): pak se do
    // pokladny už nedostane a schvalovatel doloží, co v pokladně ověřil.
    const vydejKRucnimu = SKLAD_SCHVALENY_K_RUCNIMU.includes(s) || (naCestePropadla && SKLAD_OPERACE_NA_CESTE.includes(s))
    const operaceDovoli = !(op !== null && OPERACE_HOTOVA.includes(op)) && (!naCeste || naCestePropadla)
    if (m.maZiveNavrhSkladu && vydejKRucnimu && operaceDovoli) {
      a.add('rucne_dolozit')
    }
    // Bez pokladny návrh výdeje vzniknout nemůže (není katalog ani provozovna).
    // Databáze proto dovolí doložit rovnou zkontrolovaný záznam
    // (`jine_platby_rucne_dolozit_vydej`, větev bez připojení).
    if (!m.maPokladnu && z.stavKontroly === 'zkontrolovano' && (s === 'bez_navrhu' || s === 'zamitnuto')) {
      a.add('rucne_dolozit')
    }
    // Zrušit schválení (v pokladně nic neodepsáno): sklad zpět na bez_navrhu.
    // Jediná cesta, jak uvolnit „nepodporovano" (schváleno k ručnímu odpisu).
    // Operace na cestě jen po vypršení platnosti (P3) — stejná pravidla jako ruční doložení,
    // jen bez živého návrhu (databáze ho tu nechce).
    if (vydejKRucnimu && operaceDovoli) a.add('zrusit_schvaleni')
  }

  // Faktura a úhrada (úhradu jde i odpojit, proto i u „uhrazeno"). U zrušeného
  // záznamu nic (N4: `jine_platby_evidovat_uhradu` zrušený záznam odmítne —
  // vrácení výš na začátku funkce).
  if (faktura) {
    a.add('faktura')
    if (z.mena !== null || z.stavUhrady !== 'neovereno') a.add('uhrada')
  }

  // Opravy
  if (oprava && trzbaZapsana) a.add('opravit_trzbu')
  if (oprava && vydej && (s === 'odecteno_v_pos' || s === 'rucne_dolozeno')) a.add('korekce_vydeje')
  const autor = zadat && !!m.uzivatelId && z.vytvoril === m.uzivatelId && SKLAD_AUTOR_ZRUSI.includes(s)
  // Napárovaná úhrada: `jine_platby_zrusit` chce nejdřív odpojit úhradu.
  if (
    (oprava || autor) &&
    !trzbaZapsana &&
    z.stavFaktury !== 'propojena' &&
    z.uhradaTransakceId === null &&
    SKLAD_LZE_ZRUSIT.includes(s) &&
    !(op !== null && OPERACE_NA_CESTE.includes(op))
  ) {
    a.add('zrusit')
  }

  return a
}

/**
 * Schválit výdej (na rozdíl od zamítnutí) jde jen u zkontrolovaného
 * záznamu (`jine_platby_rozhodnout_vydej` nezkontrolovaný odmítne)
 * s čerstvou kontrolou skladu pro tutéž verzi, která říká „neodečteno".
 * Když pokladna už odečetla, patří se výdej propojit, ne provést znovu.
 * Blokace návrhu a možnou duplicitu výdeje hlídá databáze (duplicita
 * chce důvod).
 */
export function muzeSchvalitVydej(z: ZaznamJinePlatby, tedMs: number): boolean {
  return (
    z.stavSkladu === 'ceka_na_schvaleni' &&
    z.stavKontroly === 'zkontrolovano' &&
    z.kontrolaSkladu !== null &&
    z.kontrolaSkladu.vysledek === 'neodecteno' &&
    kontrolaPlati(z.kontrolaSkladu, z.verze, PLATNOST_KONTROLY_SKLADU_MIN, tedMs)
  )
}
