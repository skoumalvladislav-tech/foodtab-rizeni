/**
 * Katalog nástrojů, ze kterých si zákazník vybírá.
 *
 * Zadání: master prompt, oddíl 3.1 („Zákazník si volí nástroje") a
 * oddíl 6 („První spuštění a připojení nástrojů"). Obrazovka je
 * `app/[rozsah]/marketing/nastroje`.
 *
 * ---------------------------------------------------------------------
 * PROČ JE KATALOG V KÓDU, KDYŽ SE PROVOZ DO KÓDU NEPÍŠE
 *
 * CLAUDE.md, pravidlo 1 mluví o tom, co má zákazník moct změnit:
 * pobočky, role, lidi, jídla. Tohle je něco jiného — je to výčet
 * nástrojů, ke kterým Foodtab UMÍ mluvit. Zákazník si z něj vybírá,
 * ale nepřidává do něj: nový řádek v databázi by mu nevyrobil adaptér.
 *
 * Stejné rozdělení má `lib/marketing-sablony.ts`: katalog je nabídka
 * (kód), volba zákazníka je řádek (`marketing_pripojeni`).
 *
 * ---------------------------------------------------------------------
 * POLOŽKA NESMÍ PŘEDSTÍRAT FUNKČNÍ INTEGRACI
 *
 * Zadání to říká doslova. Proto má každá položka `podporovany` a
 * `rezimy`:
 *
 *   * `podporovany: false` znamená, že adaptér NENÍ. Taková položka se
 *     v katalogu ukáže — ať je vidět, proč si ji nejde vybrat — ale
 *     `lzePripojit` ji odmítne a obrazovka na ni nedá tlačítko.
 *   * `rezimy` říká, co u toho nástroje opravdu chodí. Není to teorie:
 *     n8n se dnes volá podle adresy z prostředí serveru
 *     (`lib/marketing-n8n.ts`), takže vlastní n8n zákazníka připojit
 *     NEJDE, i když by to dávalo smysl. Dokud to tak je, `zakaznicky`
 *     v jeho výčtu není.
 *
 * Kdyby se tyhle dva údaje odvozovaly z něčeho jiného (třeba z toho,
 * jestli má položka pole na klíč), vznikla by položka, která vypadá
 * připojitelně a spadne až při prvním odeslání — tedy po schválení
 * a naplánování, kdy už s tím nikdo nic neudělá.
 *
 * ---------------------------------------------------------------------
 * BEZ PŘIPOJENÍ MODUL FUNGUJE DÁL
 *
 * Zadání, oddíl 3.1: „Neimplementuj podmínku typu ,bez Shotstacku/n8n
 * nelze aplikaci používat'." Proto je v katalogu `rucni_export`:
 * příspěvek se připraví, schválí a naplánuje, a člověk ho zveřejní
 * sám. Je to jediná položka, která je podporovaná vždycky a nepotřebuje
 * žádný klíč.
 */

/** Kategorie odpovídají `check` na `marketing_pripojeni.kategorie`. */
export type Kategorie =
  | 'ai_text'
  | 'render_obrazek'
  | 'render_video'
  | 'hlas'
  | 'publikovani'
  | 'automatizace'
  | 'metriky'
  | 'upozorneni'
  | 'uloziste'

/** Režimy odpovídají `check` na `marketing_pripojeni.rezim`. */
export type Rezim = 'zakaznicky' | 'foodtab' | 'rucni' | 'demo'

export type Slozitost = 'snadne' | 'stredni' | 'narocne'

/** Jeden údaj, který se u připojení zadává. Tajné se nikdy nevrací zpátky. */
export type Pole = {
  klic: string
  nazev: string
  napoveda: string
  tajne: boolean
}

export type Poskytovatel = {
  klic: string
  nazev: string
  /**
   * Jeden nástroj může pokrývat víc kategorií (n8n publikuje i
   * automatizuje). Připojení je ale v databázi jedno na nástroj a
   * rozsah (index `marketing_pripojeni_zive`), takže se do sloupce
   * `kategorie` zapíše ta PRVNÍ a obrazovka ho ukáže u všech.
   */
  kategorie: Kategorie[]
  kCemu: string
  prinos: string
  omezeni: string
  slozitost: Slozitost
  uctovani: string
  doporuceny: boolean
  /** Má Foodtab odzkoušený adaptér? Bez něj se připojit nedá. */
  podporovany: boolean
  rezimy: Rezim[]
  pole: Pole[]
  /**
   * Co ten nástroj v Foodtabu OPRAVDU umí a co ne.
   *
   * Zadání, oddíl 3.1: „Funkce aplikace aktivuj podle skutečných
   * capabilities připojeného poskytovatele, ne podle jeho názvu."
   * Píše se sem tedy, co projde naší cestou — ne co má poskytovatel
   * v ceníku.
   */
  umi: string[]
  neumi: string[]
  /** Hradí spotřebu zákazník přímo poskytovateli? Zadání, oddíl 6. */
  platiZakaznik: boolean
  /** Odkaz na oficiální návod služby. Zadání, oddíl 6. */
  navod?: string
}

export const NAZVY_KATEGORII: Record<Kategorie, string> = {
  ai_text: 'Texty a storyboard',
  render_obrazek: 'Grafika',
  render_video: 'Video',
  hlas: 'Mluvené slovo',
  publikovani: 'Zveřejňování',
  automatizace: 'Automatizace',
  metriky: 'Měření',
  upozorneni: 'Upozornění',
  uloziste: 'Vnější úložiště',
}

/**
 * Co se stane, když v kategorii není nic připojeného.
 *
 * Píše se to na obrazovku schválně: zákazník má vědět, že mu modul
 * běží dál a jak, ne hádat, jestli je něco rozbité. Zadání, oddíl 3.1:
 * „Neimplementuj podmínku typu ,bez Shotstacku/n8n nelze aplikaci
 * používat'."
 */
export const BEZ_PRIPOJENI: Record<Kategorie, string> = {
  ai_text: 'Návrhy textu se nabízejí jako ukázka, viditelně označená. Text se dá napsat ručně.',
  render_obrazek: 'Použije se fotka z knihovny. Grafiku zatím Foodtab nevykresluje.',
  render_video: 'Video se nevyrábí. Příspěvek jde ven jako fotka nebo text.',
  hlas: 'Video je bez namluveného komentáře. Titulky se píšou ručně.',
  publikovani: 'Příspěvek se připraví a naplánuje, zveřejní ho člověk sám (ruční režim).',
  automatizace: 'Nic se nespouští samo. Všechno se dělá z obrazovky.',
  metriky: 'Čísla o dosahu se nestahují. Modul funguje bez nich.',
  upozorneni: 'Na schválení se chodí dívat do fronty. Nic nechodí samo.',
  uloziste: 'Fotky se nahrávají rovnou do Foodtabu. Vnější složku nepotřebujete.',
}

export const NAZVY_REZIMU: Record<Rezim, string> = {
  zakaznicky: 'Vlastní účet zákazníka',
  foodtab: 'Spravuje Foodtab',
  rucni: 'Ruční export',
  demo: 'Demo',
}

export const POPIS_REZIMU: Record<Rezim, string> = {
  zakaznicky: 'Použije se klíč, který sem zadáte. Spotřebu hradíte přímo poskytovateli.',
  foodtab: 'Použije se účet Foodtabu. Vy nezadáváte nic.',
  rucni: 'Nic se nikam neodesílá — příspěvek zveřejní člověk sám.',
  demo: 'Projde celá cesta a ven se nepošle nic. Označuje se jako zkouška nanečisto.',
}

/** Pořadí, ve kterém se karty kreslí — podle toho, jak se s modulem pracuje. */
export const PORADI_KATEGORII: Kategorie[] = [
  'ai_text',
  'render_obrazek',
  'render_video',
  'hlas',
  'publikovani',
  'automatizace',
  'metriky',
  'upozorneni',
  'uloziste',
]

/**
 * Tři štítky ze zadání (oddíl 6). „Připravujeme" NENÍ pozvánka ke
 * kliknutí — je to vysvětlení, proč tam tlačítko není.
 */
export type Znacka = 'doporuceno' | 'podporovano' | 'pripravujeme'

export const NAZVY_ZNACEK: Record<Znacka, string> = {
  doporuceno: 'Doporučeno Foodtabem',
  podporovano: 'Jiná podporovaná možnost',
  pripravujeme: 'Připravujeme',
}

export const POSKYTOVATELE: Poskytovatel[] = [
  {
    klic: 'anthropic',
    nazev: 'Claude (Anthropic)',
    kategorie: ['ai_text'],
    kCemu: 'Návrhy textu příspěvku, variant a storyboardu k videu.',
    prinos: 'Píše česky a drží tón hlasu i výrazy ze Značky.',
    omezeni: 'Mzdy, docházka, kontakty ani zálohy se do modelu neposílají.',
    slozitost: 'snadne',
    uctovani: 'Podle spotřeby. Orientační ceny jsou v ceníku poskytovatele, Foodtab je nepřepisuje.',
    doporuceny: true,
    podporovany: true,
    rezimy: ['foodtab', 'zakaznicky'],
    pole: [
      {
        klic: 'klic',
        nazev: 'API klíč',
        napoveda: 'Z console.anthropic.com, začíná sk-ant-. Po uložení se už neukáže.',
        tajne: true,
      },
    ],
    umi: ['text příspěvku', 'varianty textu', 'storyboard k videu', 'čtení menu z fotky a PDF'],
    neumi: ['obrázky', 'video', 'zveřejnění'],
    platiZakaznik: true,
    navod: 'https://docs.anthropic.com/en/api/getting-started',
  },
  {
    klic: 'openai',
    nazev: 'OpenAI',
    kategorie: ['ai_text'],
    kCemu: 'Totéž co Claude — návrhy textu.',
    prinos: 'Kdo už OpenAI platí, nemusel by platit druhého poskytovatele.',
    omezeni: 'Foodtab k němu nemá odzkoušený adaptér. Připojit ho nejde.',
    slozitost: 'snadne',
    uctovani: 'Podle spotřeby u poskytovatele.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — adaptér není napsaný'],
    platiZakaznik: true,
    navod: 'https://platform.openai.com/docs/quickstart',
  },
  {
    klic: 'shotstack',
    nazev: 'Shotstack',
    kategorie: ['render_video', 'render_obrazek'],
    kCemu: 'Složení krátkého videa nebo obrázku ze šablony, fotek a textu.',
    prinos: 'Video bez střihače a bez čekání na grafika.',
    omezeni: 'Adaptér není. Tabulka render úloh stojí, cesta ven z ní nevede.',
    slozitost: 'stredni',
    uctovani: 'Podle minut videa u poskytovatele.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — adaptér není napsaný'],
    platiZakaznik: true,
    navod: 'https://shotstack.io/docs/guide/',
  },
  {
    klic: 'elevenlabs',
    nazev: 'ElevenLabs',
    kategorie: ['hlas'],
    kCemu: 'Namluvení komentáře k videu.',
    prinos: 'Český hlas bez studia.',
    omezeni: 'Adaptér není, a bez videa by nebylo co namlouvat.',
    slozitost: 'stredni',
    uctovani: 'Podle znaků u poskytovatele.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — adaptér není napsaný'],
    platiZakaznik: true,
    navod: 'https://elevenlabs.io/docs',
  },
  {
    klic: 'n8n',
    nazev: 'n8n',
    kategorie: ['publikovani', 'automatizace'],
    kCemu: 'Odeslání hotového příspěvku na Instagram a Facebook.',
    prinos: 'Přístup k účtu leží na jednom místě — Foodtab s Instagramem nemluví sám.',
    omezeni:
      'Vlastní n8n zákazníka připojit nejde: adresa i sdílené tajemství se berou z prostředí serveru.',
    slozitost: 'stredni',
    uctovani: 'Součást provozu Foodtabu. Zákazník neplatí nic zvlášť.',
    doporuceny: true,
    podporovany: true,
    rezimy: ['foodtab', 'demo'],
    pole: [],
    umi: ['příspěvek na Instagram', 'idempotence proti dvojímu zveřejnění', 'zkouška nanečisto'],
    neumi: ['Facebook — číselník ho zná, cesta ven zatím vede jen na Instagram', 'Story', 'vlastní n8n zákazníka'],
    platiZakaznik: false,
    navod: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/',
  },
  {
    klic: 'meta_primo',
    nazev: 'Meta napřímo (Graph API)',
    kategorie: ['publikovani'],
    kCemu: 'Publikování na Instagram a Facebook bez prostředníka.',
    prinos: 'O jeden článek řetězu míň.',
    omezeni:
      'Znamenalo by to druhé místo s tokenem k účtu firmy. Rozhodnuto, že se publikuje přes n8n — docs/marketing-je-modul.md.',
    slozitost: 'narocne',
    uctovani: 'Bez poplatku, ale s limity Mety.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — OAuth průvodce ani adaptér nejsou napsané'],
    platiZakaznik: false,
    navod: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  },
  {
    klic: 'rucni_export',
    nazev: 'Ruční zveřejnění',
    kategorie: ['publikovani'],
    kCemu: 'Příspěvek se připraví a schválí ve Foodtabu, ven ho dá člověk.',
    prinos: 'Funguje bez jakéhokoli připojení a bez klíčů.',
    omezeni: 'Nic se neodešle samo. Kdo to zveřejní, si to musí odklepnout v aplikaci.',
    slozitost: 'snadne',
    uctovani: 'Zdarma.',
    doporuceny: false,
    podporovany: true,
    rezimy: ['rucni'],
    pole: [],
    umi: ['příprava', 'schválení', 'naplánování', 'stažení podkladů'],
    neumi: ['odeslání na síť'],
    platiZakaznik: false,
  },
  {
    klic: 'meta_insights',
    nazev: 'Meta Insights',
    kategorie: ['metriky'],
    kCemu: 'Dosah, interakce a uložení u zveřejněných příspěvků.',
    prinos: 'Čísla vedle příspěvku, ne v jiné aplikaci.',
    omezeni: 'Adaptér ani tabulka na čísla zatím nejsou.',
    slozitost: 'stredni',
    uctovani: 'Bez poplatku v rámci účtu Mety.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — adaptér není napsaný'],
    platiZakaznik: false,
    navod: 'https://developers.facebook.com/docs/instagram-platform/insights',
  },
  {
    klic: 'email_foodtab',
    nazev: 'E-mail z Foodtabu',
    kategorie: ['upozorneni'],
    kCemu: 'Zpráva, že něco čeká na schválení nebo že publikace selhala.',
    prinos: 'Nikdo nemusí chodit koukat do fronty.',
    omezeni:
      'Odesílání e-mailu Foodtab umí (pozvánky), ale marketingová upozornění na něj zatím napojená nejsou.',
    slozitost: 'snadne',
    uctovani: 'Součást provozu Foodtabu.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — události modulu se nikam neposílají'],
    platiZakaznik: false,
  },
  {
    klic: 'onedrive',
    nazev: 'OneDrive / Google Disk',
    kategorie: ['uloziste'],
    kCemu: 'Vstupní složka, do které se fotky nahrávají z mobilu.',
    prinos: 'Fotky z telefonu bez přihlašování do Foodtabu.',
    omezeni:
      'Adaptér není. A pozor: odkaz z takové složky je dočasný — na Černé Perle kvůli tomu vypršel dřív, než přišlo schválení. Fotka se proto musí při příjmu zkopírovat k nám, ne používat odkazem.',
    slozitost: 'stredni',
    uctovani: 'Podle účtu u poskytovatele.',
    doporuceny: false,
    podporovany: false,
    rezimy: [],
    pole: [],
    umi: [],
    neumi: ['zatím všechno — adaptér není napsaný'],
    platiZakaznik: true,
  },
]

export function najdiPoskytovatele(klic: string): Poskytovatel | null {
  return POSKYTOVATELE.find((p) => p.klic === klic) ?? null
}

/** Nástroje, které se v téhle kategorii nabízejí — i ty nepodporované. */
export function poskytovateleKategorie(kategorie: Kategorie): Poskytovatel[] {
  return POSKYTOVATELE.filter((p) => p.kategorie.includes(kategorie))
}

/** Co Foodtab doporučuje. Doporučit se dá jen to, co je opravdu připojitelné. */
export function doporuceny(kategorie: Kategorie): Poskytovatel | null {
  return poskytovateleKategorie(kategorie).find((p) => p.doporuceny && p.podporovany) ?? null
}

/**
 * Smí se tenhle nástroj v tomhle režimu připojit?
 *
 * Ptá se na to obrazovka (aby nenabídla tlačítko) i serverová akce
 * (aby to odmítla, i když někdo tlačítko obejde) — pravidlo 4 v duchu:
 * co přijde z prohlížeče, je návrh, ne povolení.
 */
export function lzePripojit(klic: string, rezim: string): boolean {
  const p = najdiPoskytovatele(klic)
  if (!p || !p.podporovany) return false
  return (p.rezimy as string[]).includes(rezim)
}

/** Údaje, které se u téhle volby zadávají. Mimo zákaznický režim žádné. */
export function potrebnaPole(klic: string, rezim: string): Pole[] {
  const p = najdiPoskytovatele(klic)
  if (!p || rezim !== 'zakaznicky') return []
  return p.pole
}

/**
 * Kontrola vyplněných údajů.
 *
 * Vrací hlášku, ne `false` — obrazovka má říct, co chybí. Prázdný
 * řetězec se bere jako nevyplněno: uložit „klíč" o nule znaků by
 * znamenalo připojení, které při prvním volání spadne.
 */
export function zkontrolujUdaje(
  klic: string,
  rezim: string,
  udaje: Record<string, string>,
): { ok: true } | { ok: false; chyba: string } {
  if (!lzePripojit(klic, rezim)) {
    return { ok: false, chyba: 'Tenhle nástroj se v tomhle režimu připojit nedá.' }
  }

  for (const pole of potrebnaPole(klic, rezim)) {
    if (!(udaje[pole.klic] ?? '').trim()) {
      return { ok: false, chyba: `Vyplňte ${pole.nazev.toLowerCase()}.` }
    }
  }

  return { ok: true }
}

/**
 * Štítek z oddílu 6 zadání.
 *
 * Počítá se z `podporovany`, ne z vlastního pole — jinak by šlo napsat
 * „Doporučeno Foodtabem" k něčemu, co nemá adaptér, a přesně tomu má
 * pravidlo „položka nesmí předstírat funkční integraci" bránit.
 */
export function znackaPoskytovatele(p: Poskytovatel): Znacka {
  if (!p.podporovany) return 'pripravujeme'
  return p.doporuceny ? 'doporuceno' : 'podporovano'
}

/**
 * Kategorie, ve kterých jde dnes něco doopravdy připojit.
 *
 * Obrazovka podle toho odděluje karty, kde se dá jednat, od těch, kde
 * se dá jen číst, proč to nejde.
 */
export function kategorieSPodporou(): Kategorie[] {
  return PORADI_KATEGORII.filter((k) => poskytovateleKategorie(k).some((p) => p.podporovany))
}

/** Hlavní kategorie nástroje — ta se zapisuje do `marketing_pripojeni.kategorie`. */
export function hlavniKategorie(klic: string): Kategorie | null {
  return najdiPoskytovatele(klic)?.kategorie[0] ?? null
}
