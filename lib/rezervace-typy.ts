/**
 * Rezervace a kalendář akcí — výčty, popisky a kontrola formuláře.
 *
 * Návrh: docs/rezervace-navrh.md. Čistý modul (žádné IO, žádné
 * `server-only`, importy s příponou `.ts`), ať ho jde pustit Nodem
 * (`node --experimental-strip-types scripts/rezervace.test.mjs`) a použít
 * v serverové akci i v klientské komponentě.
 *
 * Hodnoty výčtů drží databáze (CHECK v 20261027100000_rezervace_akce.sql);
 * tady jsou, aby se nesmysl odmítl česky dřív, než dojde do databáze.
 * Rozhoduje vždycky databáze.
 */

import type { StavRezervace } from './reservation-provider-contract.ts'

export type { StavRezervace }

export type DruhRezervace = 'rezervace' | 'akce'
export type StavZalohyHosta = 'zadna' | 'pozadovana' | 'zaplacena' | 'vracena'
export type ZdrojRezervace = 'rucne' | 'csv' | 'externi'

export const STAVY: readonly StavRezervace[] = ['ceka', 'potvrzeno', 'dokonceno', 'zrusena', 'nedostavil_se']

export const NAZVY_STAVU: Record<StavRezervace, string> = {
  ceka: 'Předběžná',
  potvrzeno: 'Potvrzená',
  dokonceno: 'Proběhla',
  zrusena: 'Zrušená',
  nedostavil_se: 'Nedorazili',
}

/**
 * Tón štítku stavu (stejné hodnoty jako `data-tone` u karet). Barva
 * nikdy sama — štítek nese vždycky i slovo (docs/vzhled-zadani.md, oddíl 7).
 */
export const TON_STAVU: Record<StavRezervace, 'dobre' | 'info' | 'pozor' | 'bad' | 'neutral'> = {
  ceka: 'pozor',
  potvrzeno: 'dobre',
  dokonceno: 'neutral',
  zrusena: 'bad',
  nedostavil_se: 'bad',
}

export const DRUHY: readonly DruhRezervace[] = ['rezervace', 'akce']

export const NAZVY_DRUHU: Record<DruhRezervace, string> = {
  rezervace: 'Rezervace',
  akce: 'Akce',
}

export const STAVY_ZALOHY: readonly StavZalohyHosta[] = ['zadna', 'pozadovana', 'zaplacena', 'vracena']

export const NAZVY_ZALOHY: Record<StavZalohyHosta, string> = {
  zadna: 'Bez zálohy',
  pozadovana: 'Záloha požadovaná',
  zaplacena: 'Záloha zaplacená',
  vracena: 'Záloha vrácená',
}

export const NAZVY_ZDROJE: Record<ZdrojRezervace, string> = {
  rucne: 'Zapsáno ve Foodtabu',
  csv: 'Ze souboru',
  externi: 'Z rezervačního systému',
}

/** Stav, který se do počtu hostů dne nepočítá — ti nepřijdou (nebo nepřišli). */
export function pocitaSeDoHostu(stav: StavRezervace): boolean {
  return stav !== 'zrusena' && stav !== 'nedostavil_se'
}

/**
 * Údaje, které u rezervace z rezervačního systému patří ZDROJI. Ve
 * Foodtabu se nemění — `rezervace_ulozit` je odmítne a formulář je
 * nenabízí (klíče jsou stejné jako `c_zdrojove` v migraci).
 */
export const UDAJE_ZDROJE = ['stav', 'datum', 'od', 'do', 'pocet_osob', 'jmeno_hosta', 'telefon', 'email'] as const

/** Údaje, které patří Foodtabu i u importované rezervace. */
export const UDAJE_FOODTABU = ['druh', 'nazev', 'typ_akce', 'prostor', 'menu', 'zaloha_hosta_haleru', 'zaloha_hosta_stav'] as const

export type KlicUdaje = (typeof UDAJE_ZDROJE)[number] | (typeof UDAJE_FOODTABU)[number]

export const MAX_NAZEV = 120
export const MAX_PROSTOR = 120
export const MAX_TYP_AKCE = 80
export const MAX_TEXT = 4000
export const MAX_NADPIS_POZNAMKY = 80

/** „1 500“, „1500,50“, „1 500 Kč“ → haléře. Prázdné → null. Nesmysl → NaN. */
export function korunyNaHalere(text: string): number | null {
  const t = text.replace(/kč/i, '').replace(/[\s ]/g, '').replace(',', '.')
  if (t === '') return null
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return Number.NaN
  const [cela, des = ''] = t.split('.')
  return Number(cela) * 100 + Number(des.padEnd(2, '0'))
}

/** Haléře → „1 500 Kč“ / „1 500,50 Kč“. */
export function halereNaKoruny(halere: number): string {
  const koruny = Math.trunc(halere / 100)
  const zbytek = Math.abs(halere % 100)
  const cela = new Intl.NumberFormat('cs-CZ').format(koruny)
  return zbytek === 0 ? `${cela} Kč` : `${cela},${String(zbytek).padStart(2, '0')} Kč`
}

export const VZOR_DATA = /^\d{4}-\d{2}-\d{2}$/
export const VZOR_HODINY = /^([01]?\d|2[0-3]):[0-5]\d$/

/** Existuje to datum doopravdy (31. 2. ne)? */
export function jePlatneDatum(text: string): boolean {
  if (!VZOR_DATA.test(text)) return false
  const [r, m, d] = text.split('-').map(Number)
  const dt = new Date(Date.UTC(r, m - 1, d))
  return dt.getUTCFullYear() === r && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export type VysledekFormulare =
  | { stav: 'ok'; udaje: Partial<Record<KlicUdaje, string>> }
  | { stav: 'chyba'; chyby: string[] }

/**
 * Přečte a zkontroluje formulář rezervace. `jenFoodtab` = rezervace
 * z rezervačního systému: přečtou se jen údaje Foodtabu, ostatní se do
 * databáze vůbec nepošlou (jinak by je odmítla).
 *
 * Vrací údaje pro `rezervace_ulozit` (všechno jako text — databáze
 * převádí sama, i čas podle pásma pobočky). Nic nevolá.
 */
export function precistFormular(
  ziskej: (klic: string) => string | null | undefined,
  { jenFoodtab }: { jenFoodtab: boolean },
): VysledekFormulare {
  const text = (k: string) => String(ziskej(k) ?? '').trim()
  const chyby: string[] = []
  const udaje: Partial<Record<KlicUdaje, string>> = {}

  const druh = text('druh') || 'rezervace'
  if (!(DRUHY as readonly string[]).includes(druh)) chyby.push('Neznámý druh záznamu.')
  udaje.druh = druh

  const nazev = text('nazev')
  if (nazev.length > MAX_NAZEV) chyby.push(`Název je delší než ${MAX_NAZEV} znaků.`)
  udaje.nazev = nazev

  const typAkce = text('typ_akce')
  if (typAkce.length > MAX_TYP_AKCE) chyby.push(`Typ akce je delší než ${MAX_TYP_AKCE} znaků.`)
  udaje.typ_akce = typAkce

  const prostor = text('prostor')
  if (prostor.length > MAX_PROSTOR) chyby.push(`Stůl nebo prostor je delší než ${MAX_PROSTOR} znaků.`)
  udaje.prostor = prostor

  const menu = text('menu')
  if (menu.length > MAX_TEXT) chyby.push(`Menu je delší než ${MAX_TEXT} znaků.`)
  udaje.menu = menu

  const zaloha = korunyNaHalere(text('zaloha'))
  if (zaloha !== null && Number.isNaN(zaloha)) chyby.push('Záloha musí být částka v korunách (např. 1500 nebo 1 500,50).')
  udaje.zaloha_hosta_haleru = zaloha === null || Number.isNaN(zaloha) ? '' : String(zaloha)

  const stavZalohy = text('zaloha_hosta_stav') || (zaloha ? 'pozadovana' : 'zadna')
  if (!(STAVY_ZALOHY as readonly string[]).includes(stavZalohy)) chyby.push('Neznámý stav zálohy.')
  udaje.zaloha_hosta_stav = stavZalohy

  if (!jenFoodtab) {
    const stav = text('stav') || 'potvrzeno'
    if (!(STAVY as readonly string[]).includes(stav)) chyby.push('Neznámý stav rezervace.')
    udaje.stav = stav

    const jmeno = text('jmeno_hosta')
    if (jmeno.length > MAX_NAZEV) chyby.push(`Jméno je delší než ${MAX_NAZEV} znaků.`)
    if (druh === 'rezervace' && jmeno === '') chyby.push('Vyplňte, na koho je rezervace.')
    if (druh === 'akce' && jmeno === '' && nazev === '') chyby.push('Vyplňte název akce nebo jméno objednatele.')
    udaje.jmeno_hosta = jmeno

    const datum = text('datum')
    if (!jePlatneDatum(datum)) chyby.push('Vyplňte platné datum.')
    udaje.datum = datum

    const od = text('od')
    if (!VZOR_HODINY.test(od)) chyby.push('Vyplňte čas začátku (HH:MM).')
    udaje.od = od

    const doCas = text('do')
    if (doCas !== '' && !VZOR_HODINY.test(doCas)) chyby.push('Čas konce má tvar HH:MM.')
    if (doCas !== '' && doCas === od) chyby.push('Konec nemůže být ve stejný čas jako začátek.')
    udaje.do = doCas

    const pocet = text('pocet_osob')
    if (pocet !== '' && !/^\d{1,5}$/.test(pocet)) chyby.push('Počet osob musí být celé číslo.')
    else if (pocet !== '' && Number(pocet) < 1) chyby.push('Počet osob musí být aspoň 1.')
    if (druh === 'rezervace' && pocet === '') chyby.push('Vyplňte počet osob.')
    udaje.pocet_osob = pocet

    const telefon = text('telefon')
    if (telefon.length > 40) chyby.push('Telefon je moc dlouhý.')
    if (telefon !== '' && !/^[+\d][\d\s()/-]{2,39}$/.test(telefon)) chyby.push('Telefon obsahuje nepovolené znaky.')
    udaje.telefon = telefon

    const email = text('email')
    if (email.length > 254) chyby.push('E-mail je moc dlouhý.')
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) chyby.push('E-mail nemá správný tvar.')
    udaje.email = email
  }

  return chyby.length > 0 ? { stav: 'chyba', chyby } : { stav: 'ok', udaje }
}

/** Kontrola poznámky dřív, než jde do databáze. */
export function zkontrolovatPoznamku(nadpis: string, obsah: string): string | null {
  if (obsah.trim() === '') return 'Poznámka je prázdná.'
  if (obsah.length > MAX_TEXT) return `Poznámka je delší než ${MAX_TEXT} znaků.`
  if (nadpis.length > MAX_NADPIS_POZNAMKY) return `Nadpis je delší než ${MAX_NADPIS_POZNAMKY} znaků.`
  return null
}

/* ---------------------------------------------------------------------
 * Pomůcky serverových akcí (tady, ať jdou vyzkoušet Nodem)
 * ------------------------------------------------------------------ */

/**
 * Adresa, kam se akce vrací. Jen uvnitř Rezervací téhož rozsahu — jinak
 * by šlo poslat formulář s `zpet=https://…` a nechat se přesměrovat ven.
 */
export function bezpecnaZpatky(rozsah: string, zpet: string | null | undefined): string {
  const zaklad = `/${rozsah}/rezervace`
  const z = String(zpet ?? '')
  if (z === zaklad || (z.startsWith(`${zaklad}/`) || z.startsWith(`${zaklad}?`))) {
    if (!z.includes('//') && !z.includes('\\')) return z
  }
  return zaklad
}

/** Česká hláška z chyby databáze. Naše funkce mluví česky; cokoli jiného je obecná věta. */
export function hlaskaZDatabaze(chyba: { code?: string; message?: string } | null): string {
  if (!chyba) return 'Uložení se nepovedlo.'
  const zprava = chyba.message ?? ''
  if (chyba.code === '42501' && !zprava.includes('permission denied')) return zprava
  if ((chyba.code === '23514' || chyba.code === 'P0002') && !zprava.includes('violates')) return zprava
  if (chyba.code === '23514') return 'Některý údaj je mimo povolený rozsah (moc dlouhý text, nesmyslné číslo).'
  if (chyba.code === '42501') return 'Na tohle nemáte oprávnění.'
  return 'Uložení se nepovedlo. Zkuste to znovu.'
}
