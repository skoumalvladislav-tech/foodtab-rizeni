import {
  canSee,
  isModuleActive,
  type Context,
  type ModuleKey,
  type Permission,
} from '@/lib/authz'

/**
 * Nabídka obrazovek.
 *
 * Jedno místo, ze kterého se skládá vodorovná řada modulů, levý sloupec,
 * spodní lišta na mobilu i rozcestník. Položka se nakreslí jen tehdy,
 * když má firma zapnutý příslušný modul a uživatel má právo ji vidět.
 *
 * Tahle tabulka zároveň říká, který modul je vybraný: adresy zůstávají
 * ve tvaru /<rozsah>/<obrazovka> a modul se z nich odvodí podle toho,
 * ke kterému obrazovka patří.
 *
 * POZOR: je to jen o kreslení. Schovaná položka není zámek — každá
 * obrazovka si přístup ověřuje sama. (Viz varování u canSee v authz.)
 */

/** Klíče ikon. Tvary jsou v app/[rozsah]/ikona.tsx. */
export type IkonaKlic =
  | 'kalendar'
  | 'hodiny'
  | 'fajfka'
  | 'zprava'
  | 'clovek'
  | 'kniha'
  | 'kolo'
  | 'lupa'
  | 'tecky'

export type Polozka = {
  /** Segment za rozsahem: /<rozsah>/<segment> */
  segment: string
  nazev: string
  /** Zkrácený název do spodní lišty na mobilu, kde je málo místa. */
  kratky: string
  modul: ModuleKey
  /**
   * Právo, bez kterého se položka nekreslí.
   *
   * `null` znamená „stačí být členem firmy“. Je to pro obrazovky, které
   * dělá každý sám za sebe — docházku si zapisuje i brigádník, který
   * nemá právo vidět docházku ostatních.
   */
  pravo: Permission | null
  /** Hotové obrazovky se odkazují, ostatní se kreslí zašedle se štítkem. */
  hotovo: boolean
  ikona: IkonaKlic
  /**
   * Obrazovka se váže na konkrétní pobočku a na firemní úrovni nedává
   * smysl. Při přepnutí rozsahu se místo ní jde na první obrazovku
   * téhož modulu — ne na chybovou stránku.
   */
  jenPobocka?: boolean
}

export const NABIDKA: Polozka[] = [
  { segment: 'moje-smeny', nazev: 'Moje směny', kratky: 'Moje', modul: 'provoz', pravo: 'shifts.read', hotovo: true, ikona: 'kalendar' },
  { segment: 'smeny', nazev: 'Rozpis směn', kratky: 'Směny', modul: 'provoz', pravo: 'shifts.read', hotovo: true, ikona: 'kalendar' },
  { segment: 'dochazka', nazev: 'Docházka', kratky: 'Docházka', modul: 'provoz', pravo: null, hotovo: true, ikona: 'hodiny', jenPobocka: true },
  { segment: 'ukoly', nazev: 'Úkoly a checklisty', kratky: 'Úkoly', modul: 'provoz', pravo: 'tasks.read', hotovo: true, ikona: 'fajfka' },
  { segment: 'zpravy', nazev: 'Nástěnka', kratky: 'Zprávy', modul: 'provoz', pravo: 'communication.read', hotovo: true, ikona: 'zprava' },
  { segment: 'receptury', nazev: 'Receptury', kratky: 'Recepty', modul: 'provoz', pravo: 'recipes.read', hotovo: false, ikona: 'kniha' },
  { segment: 'listky', nazev: 'Jídelní lístky', kratky: 'Lístky', modul: 'provoz', pravo: 'menus.read', hotovo: false, ikona: 'kniha' },
  { segment: 'motivace', nazev: 'Motivace', kratky: 'Motivace', modul: 'provoz', pravo: 'motivation.read', hotovo: false, ikona: 'clovek' },
  // Obrazovka zatím jen říká, že se modul připravuje — ale existuje,
  // a proto je hotovo: true. Ten příznak znamená „adresa vede na
  // vykreslenou stránku“, ne „funkce je hotová“. Kdyby byl false,
  // záložka modulu by nikam nevedla a nebylo by co odmítnout vypnutým
  // modulem, jak žádá pravidlo 5.
  { segment: 'menu', nazev: 'Tvorba menu', kratky: 'Menu', modul: 'menu', pravo: 'menu_ai.use', hotovo: true, ikona: 'kniha' },
  { segment: 'finance', nazev: 'Přehled financí', kratky: 'Finance', modul: 'finance', pravo: 'finance.read', hotovo: false, ikona: 'kniha' },
  { segment: 'marketing', nazev: 'Marketing', kratky: 'Marketing', modul: 'marketing', pravo: 'marketing.read', hotovo: false, ikona: 'kniha' },
  { segment: 'nakup', nazev: 'Nákup', kratky: 'Nákup', modul: 'objednavky', pravo: 'purchasing.read', hotovo: false, ikona: 'kniha' },
]

/**
 * Nastavení není modul.
 *
 * Moduly se kupují, nastavení je oprávnění uvnitř Provozu. Proto stojí
 * stranou za oddělovačem a má vlastní seznam obrazovek — mezi záložkami
 * by vypadalo jako něco k doplacení.
 */
export const NASTAVENI: Polozka[] = [
  { segment: 'nastaveni/firma', nazev: 'Firma', kratky: 'Firma', modul: 'provoz', pravo: 'settings.manage', hotovo: false, ikona: 'kolo' },
  { segment: 'nastaveni/pobocky', nazev: 'Pobočky', kratky: 'Pobočky', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kolo' },
  { segment: 'nastaveni/lide', nazev: 'Lidé', kratky: 'Lidé', modul: 'provoz', pravo: 'people.manage', hotovo: true, ikona: 'clovek' },
  { segment: 'nastaveni/role', nazev: 'Role', kratky: 'Role', modul: 'provoz', pravo: 'settings.manage', hotovo: false, ikona: 'clovek' },
  { segment: 'nastaveni/moduly', nazev: 'Moduly', kratky: 'Moduly', modul: 'provoz', pravo: 'settings.manage', hotovo: false, ikona: 'kolo' },
]

/** Názvy modulů, když je databáze nedodá. */
export const NAZVY_MODULU: Record<ModuleKey, string> = {
  provoz: 'Provoz',
  menu: 'Tvorba menu',
  finance: 'Finance',
  marketing: 'Marketing',
  objednavky: 'Objednávky',
}

function smiVidet(ctx: Context, p: Polozka): boolean {
  return p.pravo === null || canSee(ctx, p.pravo)
}

/** Obrazovky jednoho modulu, na které uživatel dosáhne. */
export function polozkyModulu(ctx: Context, modul: ModuleKey): Polozka[] {
  if (!isModuleActive(ctx, modul)) return []
  return NABIDKA.filter((p) => p.modul === modul && smiVidet(ctx, p))
}

/** Obrazovky nastavení. Jen se settings.manage. */
export function polozkyNastaveni(ctx: Context): Polozka[] {
  return NASTAVENI.filter((p) => smiVidet(ctx, p))
}

/** Všechno, na co uživatel dosáhne, napříč zapnutými moduly. */
export function viditelnaNabidka(ctx: Context): Polozka[] {
  return NABIDKA.filter((p) => isModuleActive(ctx, p.modul) && smiVidet(ctx, p))
}

/**
 * Ke kterému modulu patří obrazovka v adrese.
 *
 * Adresy zůstávají ploché, takže se vybraný modul nedá přečíst z cesty —
 * odvozuje se odsud. Co nesedí na žádnou obrazovku (rozcestník, neznámý
 * segment), spadne na provoz.
 */
export function modulPodleSegmentu(segment: string | null): ModuleKey {
  if (!segment) return 'provoz'
  const p = [...NABIDKA, ...NASTAVENI].find(
    (x) => x.segment === segment || segment.startsWith(x.segment + '/'),
  )
  return p?.modul ?? 'provoz'
}
