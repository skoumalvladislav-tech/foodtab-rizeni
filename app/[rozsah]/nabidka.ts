import {
  canSee,
  isModuleActive,
  jeVedeni,
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
  /**
   * Absolutní adresa mimo rozsah.
   *
   * Osobní obrazovky patří člověku, ne provozovně — a člověk, kterému
   * ještě nikdo nepřidělil oprávnění, žádný platný rozsah nemá, takže
   * by se na adresu s rozsahem ani nedostal.
   * Viz docs/odpovedi-pozvanky-2026-09-01.md, oddíl 2.
   */
  adresa?: string
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
  // Moje směny se sloučily do Docházky — byly to dvě obrazovky o téže
  // věci. Rozpis směn zůstává: to je rozpis všech, ne můj. Adresu
  // /moje-smeny drží přesměrování v next.config.ts, ne položka tady.
  // Dnes je domovská obrazovka zaměstnance a je první schválně:
  // spodní lišta bere položky odshora, takže to, co je tu první, má
  // člověk na telefonu po ruce. Pravo null — obrazovku má každý sám
  // za sebe, stejně jako Docházku.
  { segment: 'dnes', nazev: 'Dnes', kratky: 'Dnes', modul: 'provoz', pravo: null, hotovo: true, ikona: 'hodiny' },
  { segment: 'smeny', nazev: 'Rozpis směn', kratky: 'Směny', modul: 'provoz', pravo: 'shifts.read', hotovo: true, ikona: 'kalendar' },
  { segment: 'dochazka', nazev: 'Docházka', kratky: 'Docházka', modul: 'provoz', pravo: null, hotovo: true, ikona: 'hodiny', jenPobocka: true },
  // VZKAZY: jedna polozka, uvnitr dve zalozky.
  //
  // Do 7. 9. 2026 tu stala Nastenka a Rozhovory zvlast. Byly to dve
  // ruzne veci — a porad jsou —, ale dve polozky v nabidce znamenaly
  // dve mista, kam se chodit divat, jestli neco nepdrislo. Slucuje se
  // VCHOD, ne obsah (rozhodnuti Sefika 6. 9.).
  //
  // pravo: null schvalne — konverzaci autorizuje UCASTNICTVI, ne
  // opravneni. communication.read je pravo na Nastenku a cisnik ho
  // v roli nema; kdyby na nem visela cela polozka, neprecetl by si
  // vlastni vlakno. Na samotnou zalozku Nastenka se to pravo ptá
  // uvnitr (vzkazy/nastenka.tsx).
  //
  // JE TU PŘED ZÁLOHAMI SCHVÁLNĚ. Spodní lišta bere první čtyři
  // položky viditelné nabídky odshora, takže na pořadí tady záleží
  // víc než na čemkoli jiném v tomhle souboru. Číšníkovi vycházely
  // Dnes / Směny / Docházka / Úkoly a Vzkazy padaly pod „Více" —
  // jenže zprávy potřebuje každý den, kdežto zálohy jednou za měsíc
  // (a ty stejně vidí jen advances.manage). Zadání
  // docs/velka-prace-2026-09-08.md, A4 bod 3: Vzkazy do lišty místo
  // Záloh.
  { segment: 'vzkazy', nazev: 'Vzkazy', kratky: 'Vzkazy', modul: 'provoz', pravo: null, hotovo: true, ikona: 'zprava' },
  // Zálohy jsou peníze, ne nastavení — proto v hlavní nabídce hned za
  // Docházkou, ze které se počítají. Obrazovku otevírá i payroll.read,
  // ale položka visí na advances.manage: kdo dělá mzdy, přijde si pro
  // ni z Docházky, a nabídka má ukazovat to, co člověk dělá, ne všechno,
  // kam se dostane.
  { segment: 'zalohy', nazev: 'Zálohy', kratky: 'Zálohy', modul: 'provoz', pravo: 'advances.manage', hotovo: true, ikona: 'kniha' },
  { segment: 'ukoly', nazev: 'Úkoly a checklisty', kratky: 'Úkoly', modul: 'provoz', pravo: 'tasks.read', hotovo: true, ikona: 'fajfka' },
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
  // Obrazovka zatím jen říká, že se modul připravuje (stejný důvod jako
  // u Tvorby menu výše) — proto hotovo: true, i když navrhování a
  // publikování příspěvků ještě neumí nic.
  { segment: 'marketing', nazev: 'Marketing', kratky: 'Marketing', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kniha' },
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
  { segment: 'nastaveni/firma', nazev: 'Firma', kratky: 'Firma', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kolo' },
  { segment: 'nastaveni/pobocky', nazev: 'Pobočky', kratky: 'Pobočky', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kolo' },
  { segment: 'nastaveni/lide', nazev: 'Lidé', kratky: 'Lidé', modul: 'provoz', pravo: 'people.manage', hotovo: true, ikona: 'clovek' },
  // Šablony směn — pojmenované směny s časy (D, N, R). Je to nastavení
  // provozu, ne správa lidí, proto settings.manage. Vidět je má i ten,
  // kdo plánuje směny, ale měnit je smí správa nastavení; kdo jen
  // plánuje, dostane šablony rovnou v nabídce ve formuláři směny.
  { segment: 'nastaveni/sablony', nazev: 'Šablony směn', kratky: 'Šablony', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kalendar' },
  // JEDNA POLOŽKA, ne dvě. Do 9. 9. 2026 tu stálo zvlášť „Zařazení“
  // (seznam) a „Oprávnění“ (co smí) — dva seznamy pro jednu věc,
  // a přesně to Šéfík vytýkal. Slilo se to do jedné obrazovky
  // (docs/zarazeni-misto-roli.md, oddíl 6.1); segment zůstává `role`
  // podle tabulky v databázi.
  //
  // Právo je to VOLNĚJŠÍ z těch dvou: dovnitř patří i vedoucí, který
  // spravuje seznam zařazení. Zaškrtávátka práv si obrazovka zamyká
  // sama na settings.manage — kdyby tu stálo to přísnější, vedoucí by
  // o správu seznamu tiše přišel.
  { segment: 'nastaveni/role', nazev: 'Zařazení', kratky: 'Zařazení', modul: 'provoz', pravo: 'people.manage', hotovo: true, ikona: 'clovek' },
  // Nahrávání dat patří k tomu, co se nahrává. Dnes umí jen lidi, a proto
  // people.manage — až přibude rozpis nebo receptury, bude se právo řídit
  // vybranou položkou na rozcestníku, ne touhle řádkou.
  { segment: 'nastaveni/nahrani', nazev: 'Nahrání dat', kratky: 'Nahrání', modul: 'provoz', pravo: 'people.manage', hotovo: true, ikona: 'kniha' },
  // Moje údaje nejsou správa firmy, ale osobní obrazovka: co o mně
  // aplikace vede, oprava kontaktu, souhlasy a výpis. Proto pravo: null
  // — patřit do firmy stačí.
  { segment: 'moje-udaje', adresa: '/moje-udaje', nazev: 'Moje údaje', kratky: 'Moje údaje', modul: 'provoz', pravo: null, hotovo: true, ikona: 'clovek' },
  // Zařízení pobočky — tablety, na kterých běží kiosek. Patří
  // k nastavení pobočky, proto settings.manage.
  { segment: 'nastaveni/zarizeni', nazev: 'Zařízení', kratky: 'Zařízení', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kolo' },
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

/**
 * „PŘIPRAVUJEME" ZAMĚSTNANCI NE.
 *
 * Položky s `hotovo: false` vedou na obrazovku, která říká, že se to
 * teprve chystá. Vedení to vidět má — je to slib, co firma dostane.
 * Číšníkovi na denním nástroji slib nepatří: hledá, kde si píchne
 * příchod, a mezi tím mu stojí tři položky, které nic nedělají.
 *
 * Zadání docs/rychlost-a-pohled-zamestnance.md, část 2, bod 2.
 *
 * Není to zámek, jen kreslení — obrazovky samy pouštějí dovnitř dál
 * podle `app.has_access`.
 */
function smiVidet(ctx: Context, p: Polozka): boolean {
  if (!p.hotovo && !jeVedeni(ctx)) return false
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
