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
  | 'mince'
  | 'praporek'
  | 'vozik'
  | 'blesk'
  | 'slunce'
  | 'lide'
  | 'sipkaVpravo'
  | 'fajfkaKruh'
  | 'fajfkaCtverec'
  | 'vykricnik'
  | 'fotka'
  | 'faktura'
  | 'seznam'
  | 'zpet'
  | 'sipkaVlevo'
  | 'plus'
  | 'pobocka'
  | 'vidlicka'
  | 'tuzka'
  | 'kopie'
  | 'kos'
  | 'postel'
  | 'filtr'
  | 'varovani'
  | 'zavrit'
  | 'schranka'

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
  /**
   * Další segmenty, na kterých se položka taky zvýrazní v levém sloupci
   * i na spodní liště — pro sloučenou položku, jejíž obrazovky zůstaly
   * na starých adresách (22. 9., sloučení Provozního centra a Úkolů do
   * „Vzkazy a úkoly“: nic se nestěhovalo, jen navigace nad tím).
   */
  dalsiSegmenty?: string[]
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
  // Docházka nese od 24. 9. i záložky Výdělky a Zálohy (dochazka/zalozky.tsx).
  // `jenPobocka` schválně NEMÁ: majitel pracuje hlavně na /firma (domovskou
  // pobočku obvykle nemá) a výdělky i zálohy tam dávají smysl jako souhrn
  // firmy. S tím příznakem by ho přepínač rozsahu z Docházky na firmu
  // odvedl jinam a k výdělkům by se na firemní úrovni nedostal.
  { segment: 'dochazka', nazev: 'Docházka', kratky: 'Docházka', modul: 'provoz', pravo: null, hotovo: true, ikona: 'hodiny' },
  // VZKAZY A ÚKOLY: jedna polozka, uvnitr ctyri zalozky.
  //
  // Do 22. 9. 2026 tu stály DVĚ položky — „Provozní centrum“ (vzkazy,
  // nástěnka) a „Úkoly a checklisty“ (ukoly) — se stejnou vadou, jakou
  // řešilo sloučení Nástěnky a Rozhovorů 7. 9.: dvě místa, kam se chodit
  // dívat, jestli něco nepřišlo. Slučuje se VCHOD, ne obsah (Šéfíkův
  // pokyn 22. 9.) — obrazovky samotné zůstávají na svých adresách
  // (/vzkazy, /ukoly), jen navigace nad nimi je teď jedna. Segment
  // `vzkazy-a-ukoly` vede na tenký přesměrovací list
  // (app/[rozsah]/vzkazy-a-ukoly/page.tsx) na /vzkazy; `dalsiSegmenty`
  // níž drží zvýraznění položky i na starých adresách.
  //
  // Záložka „Přehled“ (bývalá 5. záložka) mizí — vedla jen na /dnes,
  // které má vlastní položku o řádek výš, takže to byla druhá cesta
  // ke stejné obrazovce, ne vlastní obsah.
  //
  // pravo: null schvalne — konverzaci autorizuje UCASTNICTVI, ne
  // opravneni; a tasks.read, které dřív hlídalo VIDITELNOST téhle
  // položky, teď hlídají až záložky Úkoly/Checklisty uvnitř (`skryte`
  // v PcZalozky) — kdo to právo nemá, položku pořád vidí (jako dřív
  // viděl Provozní centrum), jen mu tam nesvítí ty dvě záložky.
  //
  // NA POŘADÍ ZÁLEŽÍ. Spodní lišta bere první čtyři položky viditelné
  // nabídky odshora, takže na pořadí tady záleží víc než na čemkoli
  // jiném v tomhle souboru. Číšníkovi vycházely Dnes / Směny / Docházka
  // / Úkoly a Vzkazy padaly pod „Více" — jenže zprávy potřebuje každý
  // den. Zadání docs/velka-prace-2026-09-08.md, A4 bod 3: Vzkazy do
  // lišty místo Záloh. (Zálohy od 24. 9. vlastní položku nemají vůbec,
  // jsou záložkou Docházky.)
  {
    segment: 'vzkazy-a-ukoly',
    nazev: 'Vzkazy a úkoly',
    kratky: 'Vzkazy',
    modul: 'provoz',
    pravo: null,
    hotovo: true,
    ikona: 'zprava',
    dalsiSegmenty: ['vzkazy', 'ukoly'],
  },
  // ZÁLOHY TU NEJSOU. Do 24. 9. 2026 tu stála vlastní položka „Zálohy“
  // (advances.manage); majitel je chtěl mít v Docházce, ze které se
  // počítají. Obrazovka se přestěhovala na /dochazka/zalohy a je to
  // záložka Docházky, viditelná podle práva (dochazka/zalozky-prava.ts).
  // Starou adresu /:rozsah/zalohy drží přesměrování v next.config.ts.
  { segment: 'receptury', nazev: 'Receptury', kratky: 'Recepty', modul: 'provoz', pravo: 'recipes.read', hotovo: false, ikona: 'kniha' },
  { segment: 'listky', nazev: 'Jídelní lístky', kratky: 'Lístky', modul: 'provoz', pravo: 'menus.read', hotovo: false, ikona: 'kniha' },
  { segment: 'motivace', nazev: 'Motivace', kratky: 'Motivace', modul: 'provoz', pravo: 'motivation.read', hotovo: false, ikona: 'clovek' },
  // Obrazovka zatím jen říká, že se modul připravuje — ale existuje,
  // a proto je hotovo: true. Ten příznak znamená „adresa vede na
  // vykreslenou stránku“, ne „funkce je hotová“. Kdyby byl false,
  // záložka modulu by nikam nevedla a nebylo by co odmítnout vypnutým
  // modulem, jak žádá pravidlo 5.
  { segment: 'menu', nazev: 'Tvorba menu', kratky: 'Menu', modul: 'menu', pravo: 'menu_ai.use', hotovo: true, ikona: 'kniha' },
  // FINANCE ZATÍM = FAKTURY.
  //
  // Faktury byly do 15. 9. 2026 vlastní modul (`/faktury`), Šéfík
  // rozhodl přesunout je jako sekci dovnitř Finance (`/finance/faktury`)
  // — stejný nested-nav vzor jako marketing výš, detailní navigace
  // (8 obrazovek) žije v app/[rozsah]/finance/faktury/ jako vlastní
  // vnořený layout (lib/faktury-navigace.ts). Kořen modulu vede rovnou
  // na Přehled faktur, protože Finance dnes nic jiného nenabízí — až
  // přibude další část (např. banking.read je připravené právo),
  // dostane vlastní položku tady a samostatnou kořenovou obrazovku.
  { segment: 'finance/faktury', nazev: 'Faktury', kratky: 'Faktury', modul: 'finance', pravo: 'faktury.read', hotovo: true, ikona: 'kniha' },
  // MARKETING MÁ VÍC OBRAZOVEK NEŽ JEDNU.
  //
  // Do 14. 9. 2026 tu stála jediná položka a v levém sloupci proto nebylo
  // vidět nic než „Marketing" — fotky, šablony i menu existovaly a nedalo
  // se na ně dostat jinak než odkazem z přehledu. Původní samostatná
  // aplikace měla vlevo deset položek; tohle je jejich převod.
  //
  // Pořadí je podle toho, jak se to dělá: nejdřív podklady (fotky,
  // šablony, menu), pak se z nich skládá příspěvek na přehledu.
  //
  { segment: 'marketing/zacatek', nazev: 'Začínáme', kratky: 'Začátek', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'fajfka' },
  { segment: 'marketing/media', nazev: 'Fotky', kratky: 'Fotky', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kniha' },
  { segment: 'marketing/sablony', nazev: 'Šablony', kratky: 'Šablony', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kniha' },
  { segment: 'marketing/menu', nazev: 'Menu', kratky: 'Menu', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kniha' },
  { segment: 'marketing/schvalovani', nazev: 'Ke schválení', kratky: 'Schválení', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'fajfka' },
  { segment: 'marketing/kalendar', nazev: 'Kalendář', kratky: 'Kalendář', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kalendar' },
  { segment: 'marketing/kampane', nazev: 'Kampaně', kratky: 'Kampaně', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kalendar' },
  { segment: 'marketing/analytika', nazev: 'Analytika', kratky: 'Čísla', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'lupa' },
  { segment: 'marketing/publikovane', nazev: 'Publikované', kratky: 'Odesláno', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'lupa' },
  { segment: 'marketing/znacka', nazev: 'Značka', kratky: 'Značka', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kolo' },
  // Integrace a nástroje. Vidět je má každý, kdo do marketingu dosáhne —
  // i ten, kdo nic nepřipojuje: je z nich poznat, proč se něco dělá
  // ručně. Připojovat smí jen marketing.publish a ptá se na to obrazovka
  // i serverová akce, ne tahle řádka.
  { segment: 'marketing/nastroje', nazev: 'Nástroje', kratky: 'Nástroje', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'kolo' },
  { segment: 'marketing', nazev: 'Příspěvky', kratky: 'Příspěvky', modul: 'marketing', pravo: 'marketing.read', hotovo: true, ikona: 'zprava' },
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
  // Směny — nastavení celého modulu (co se nabízí při přidání směny) a rozcestník
  // k ostatním nastavením kolem směn. settings.manage jako u Šablon a Úseků.
  { segment: 'nastaveni/smeny', nazev: 'Směny', kratky: 'Směny', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kalendar' },
  // Šablony směn — pojmenované směny s časy (D, N, R). Je to nastavení
  // provozu, ne správa lidí, proto settings.manage. Vidět je má i ten,
  // kdo plánuje směny, ale měnit je smí správa nastavení; kdo jen
  // plánuje, dostane šablony rovnou v nabídce ve formuláři směny.
  { segment: 'nastaveni/sablony', nazev: 'Šablony směn', kratky: 'Šablony', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kalendar' },
  // Úsek — do jakého týmu/oddělení člověk patří (Kuchyně, Bar, Vedení).
  // NENÍ totéž co Zařazení (co smí a jakou má pracovní roli) — dvě
  // různé osy, viz nastaveni/useky/page.tsx. Právo settings.manage
  // sedí na tutéž politiku, jakou má tabulka useky v databázi.
  { segment: 'nastaveni/useky', nazev: 'Úseky', kratky: 'Úseky', modul: 'provoz', pravo: 'settings.manage', hotovo: true, ikona: 'kolo' },
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
