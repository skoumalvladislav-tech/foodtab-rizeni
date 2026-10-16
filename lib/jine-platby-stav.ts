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
  nepodporovano: p('Pokladna to přes API neumí — zpracovat ručně', 'warning'),
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
  | 'zrusit'

/** Výdej může být doložen (kontrolou, propojením): pokladna ani appka ho zatím neprovedla a požadavek není na cestě. */
const SKLAD_K_DOLOZENI: readonly StavSkladu[] = ['bez_navrhu', 'ceka_na_schvaleni', 'zamitnuto', 'schvaleno', 'nepodporovano', 'chyba', 'nutna_kontrola']
/** `jine_platby_zrusit`: výdej neproběhl ani neprobíhá. */
const SKLAD_LZE_ZRUSIT: readonly StavSkladu[] = ['bez_navrhu', 'nevyzaduje', 'zamitnuto', 'ceka_na_schvaleni', 'schvaleno', 'nepodporovano', 'chyba']
/** Autor bez práva na opravy smí zrušit jen záznam, u kterého se sklad ještě nerozjel. */
const SKLAD_AUTOR_ZRUSI: readonly StavSkladu[] = ['bez_navrhu', 'nevyzaduje', 'zamitnuto']
const OPERACE_NA_CESTE = ['odesila_se', 'nejasny_vysledek']

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
 */
export function dostupneAkce(
  z: ZaznamJinePlatby,
  prava: ReadonlySet<string>,
  m: { maPokladnu: boolean; maZiveNavrhSkladu: boolean; stavOperace: string | null; tedMs: number; uzivatelId?: string | null },
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

  // Doklad a návrh (pripojit_soubor, zahajit_rozpoznani a ulozit_navrh hlídají jen zrušení;
  // zapsanou tržbu a rozjetý výdej chrání ulozit_navrh uvnitř — odmítne změnu částky,
  // měny, data nebo položek pro sklad, ostatní projde).
  if (zadat || upravit) {
    a.add('nahrat')
    a.add('rozpoznat')
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
    // Ručně doložit jde jen schválený návrh, jehož požadavek není na cestě ani hotový.
    if (m.maZiveNavrhSkladu && (s === 'schvaleno' || s === 'nepodporovano' || s === 'chyba') && !(op !== null && [...OPERACE_NA_CESTE, 'uspech', 'rucne_dolozeno'].includes(op))) {
      a.add('rucne_dolozit')
    }
    // Bez pokladny návrh výdeje vzniknout nemůže (není katalog ani provozovna).
    // Databáze proto dovolí doložit rovnou zkontrolovaný záznam
    // (`jine_platby_rucne_dolozit_vydej`, větev bez připojení).
    if (!m.maPokladnu && z.stavKontroly === 'zkontrolovano' && (s === 'bez_navrhu' || s === 'zamitnuto')) {
      a.add('rucne_dolozit')
    }
  }

  // Faktura a úhrada (úhradu jde i odpojit, proto i u „uhrazeno").
  if (faktura) {
    a.add('faktura')
    if (z.mena !== null || z.stavUhrady !== 'neovereno') a.add('uhrada')
  }

  // Opravy
  if (oprava && trzbaZapsana) a.add('opravit_trzbu')
  if (oprava && vydej && (s === 'odecteno_v_pos' || s === 'rucne_dolozeno')) a.add('korekce_vydeje')
  const autor = zadat && !!m.uzivatelId && z.vytvoril === m.uzivatelId && SKLAD_AUTOR_ZRUSI.includes(s)
  if (
    (oprava || autor) &&
    !trzbaZapsana &&
    z.stavFaktury !== 'propojena' &&
    SKLAD_LZE_ZRUSIT.includes(s) &&
    !(op !== null && OPERACE_NA_CESTE.includes(op))
  ) {
    a.add('zrusit')
  }

  return a
}

/**
 * Schválit výdej (na rozdíl od zamítnutí) jde jen s čerstvou kontrolou
 * skladu pro tutéž verzi, která říká „neodečteno". Když pokladna už
 * odečetla, patří se výdej propojit, ne provést znovu.
 */
export function muzeSchvalitVydej(z: ZaznamJinePlatby, tedMs: number): boolean {
  return (
    z.stavSkladu === 'ceka_na_schvaleni' &&
    z.kontrolaSkladu !== null &&
    z.kontrolaSkladu.vysledek === 'neodecteno' &&
    kontrolaPlati(z.kontrolaSkladu, z.verze, PLATNOST_KONTROLY_SKLADU_MIN, tedMs)
  )
}
