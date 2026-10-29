/**
 * Jiné platby — sdílené typy (smlouva mezi databází, knihovnami,
 * AI, pokladnou a obrazovkou). Návrh a důvody: docs/jine-platby-navrh.md.
 *
 * Čisté typy a konstanty, žádné importy za běhu — soubor se dá načíst
 * Nodem bez sestavení (scripts/*.test.mjs) i z klientské komponenty.
 *
 * Výčty tu MUSÍ odpovídat `check` omezením v migraci
 * `supabase/migrations/20261016100000_jine_platby.sql`. Rozejití hlídá
 * scripts/jine-platby.test.mjs (porovná texty).
 */

/* ------------------------------------------------------------------ */
/* Stavy — každá část (kontrola, tržba, sklad, faktura, úhrada) zvlášť. */
/* Dokončení jedné nikdy neoznačí jinou za hotovou.                      */
/* ------------------------------------------------------------------ */

export const STAVY_KONTROLY = ['rozpracovano', 'ke_kontrole', 'zkontrolovano', 'zruseno'] as const
export type StavKontroly = (typeof STAVY_KONTROLY)[number]

export const STAVY_TRZBY = ['nezapsano', 'zapsano', 'propojeno', 'stornovano'] as const
export type StavTrzby = (typeof STAVY_TRZBY)[number]

export const STAVY_SKLADU = [
  'bez_navrhu',
  'nevyzaduje',
  'ceka_na_schvaleni',
  'zamitnuto',
  'schvaleno',
  'zpracovava_se',
  'nejasny_vysledek',
  'odecteno_v_pos',
  'jiz_odecteno',
  'rucne_dolozeno',
  'nepodporovano',
  'chyba',
  'nutna_kontrola',
  'opraveno',
] as const
export type StavSkladu = (typeof STAVY_SKLADU)[number]

export const STAVY_FAKTURY = ['bez_faktury', 'podklady', 'propojena'] as const
export type StavFaktury = (typeof STAVY_FAKTURY)[number]

export const STAVY_UHRADY = ['neovereno', 'castecne', 'uhrazeno'] as const
export type StavUhrady = (typeof STAVY_UHRADY)[number]

export const TYPY_DOKLADU = ['otevreny_ucet', 'uzavreny_prodej', 'informativni_sjetina', 'rucni_spotreba', 'nezjisteno'] as const
export type TypDokladu = (typeof TYPY_DOKLADU)[number]

export const PUVODY_CASTKY = ['doklad', 'vypocet', 'rucne'] as const
export type PuvodCastky = (typeof PUVODY_CASTKY)[number]

/* ------------------------------------------------------------------ */
/* Položky                                                              */
/* ------------------------------------------------------------------ */

/**
 * Druh položky. Rozhoduje, jestli se týká skladu:
 *   pokrm            — vydá se jako pokrm, suroviny odečte pokladna podle SVÉ receptury
 *   rozlevany_napoj  — pivo z tanku, víno na deci… převod (2× 0,5 l = 1 l) dělá pokladna podle nastavení položky
 *   kusove_zbozi     — láhev, plechovka, balené zboží
 *   sluzba, spropitne, sleva, neskladova — sklad se netýká
 *   nezarazeno       — zatím neurčeno; návrh výdeje s takovou položkou nejde odeslat
 */
export const DRUHY_POLOZEK = [
  'pokrm',
  'rozlevany_napoj',
  'kusove_zbozi',
  'sluzba',
  'spropitne',
  'sleva',
  'neskladova',
  'nezarazeno',
] as const
export type DruhPolozky = (typeof DRUHY_POLOZEK)[number]

/** Druhy, které se skladu NIKDY netýkají (bez ohledu na pokladnu). */
export const DRUHY_BEZ_SKLADU: readonly DruhPolozky[] = ['sluzba', 'spropitne', 'sleva', 'neskladova']

export const STAVY_MAPOVANI = ['nenamapovano', 'navrh', 'overeno', 'neskladova'] as const
export type StavMapovani = (typeof STAVY_MAPOVANI)[number]

export const ZDROJE_POLOZKY = ['ai', 'rucne'] as const
export type ZdrojPolozky = (typeof ZDROJE_POLOZKY)[number]

/** Položka návrhu, jak ji ukládá `jine_platby_ulozit_navrh` (p_polozky) a čte obrazovka. */
export type PolozkaNavrhu = {
  nazevPuvodni: string
  nazev: string
  /** Desetinné číslo jako TEXT s tečkou ("2", "0.5", "1.250") — nikdy float. `null` = neuvedeno. */
  mnozstvi: string | null
  jednotka: string | null
  cenaJednotkovaHaleru: number | null
  cenaCelkemHaleru: number | null
  /** Sazba DPH v procentech jako text ("21", "12") — jen když je na dokladu. */
  sazbaDph: string | null
  jistota: number | null
  zdroj: ZdrojPolozky
  druh: DruhPolozky
  posProduktId: string | null
  posProduktNazev: string | null
  /** Množství v jednotkách prodeje pokladny (text s tečkou), po převodu z dat pokladny. */
  posMnozstvi: string | null
  mapovani: StavMapovani
  vyzadujeKontrolu: boolean
  duvodKontroly: string
}

/** Hlavička návrhu (p_hlavicka). Chybějící klíč = beze změny se neposílá; posílá se vždy celá. */
export type HlavickaNavrhu = {
  datumProdeje: string | null // RRRR-MM-DD, provozní den
  oznaceni: string
  mena: string | null // ISO 4217, null = neznámá
  castkaHaleru: number | null
  castkaPuvod: PuvodCastky | null
  typDokladu: TypDokladu
  externiUcet: string | null
  kontaktId: string | null
  /**
   * Upozornění AI k CELÉMU dokladu (nízká jistota, víc dokladů v jednom,
   * zachycený pokyn v textu dokladu, kalendářní datum vs. provozní den…).
   * Posílá je jen rozpoznání. `undefined` = ponechat uložená (ruční
   * uložení návrhu je nemaže). Dokud nějaké je, označit záznam jako
   * zkontrolovaný jde jen s `p_upozorneni_provereno = true`.
   */
  upozorneniDokladu?: string[]
  /**
   * Id rozpoznání (`jine_platby_rozpoznani`, stav 'ok'), ze kterého je návrh.
   * Posílá jen akce rozpoznání; `undefined` = ponechat uloženou vazbu
   * (ruční uložení). Panel „Částky na dokladu“ čte tenhle řádek.
   */
  rozpoznaniId?: string
}

/* ------------------------------------------------------------------ */
/* Kontrola proti pokladně                                              */
/* ------------------------------------------------------------------ */

export const VYSLEDKY_KONTROLY_TRZBY = ['nalezeno', 'nenalezeno', 'pravdepodobne', 'nelze_overit'] as const
export type VysledekKontrolyTrzby = (typeof VYSLEDKY_KONTROLY_TRZBY)[number]

export const VYSLEDKY_KONTROLY_SKLADU = ['neodecteno', 'jiz_odecteno', 'nelze_zjistit'] as const
export type VysledekKontrolySkladu = (typeof VYSLEDKY_KONTROLY_SKLADU)[number]

export type ZdrojKontroly = 'pos_api' | 'rucni_prohlaseni'

export type KontrolaPos<V extends string> = {
  vysledek: V
  zdroj: ZdrojKontroly
  verze: number
  kdy: string // ISO
  kdo: string | null
  detail: Record<string, unknown>
  /**
   * Jen u výsledku pokladny (`pokladnaTrzby` / `pokladnaSkladu`): výsledek už
   * přepsal člověk ručním prohlášením s potvrzením (u konkrétního nálezu
   * s právem na opravy). Pak nebrání — migrace 20261021100000.
   */
  prepsano?: { kdo: string | null; kdy: string; vysledek: string; duvod: string | null } | null
}

/** Jak dlouho kontrola platí (musí sedět s migrací). */
export const PLATNOST_KONTROLY_TRZBY_MIN = 30
export const PLATNOST_KONTROLY_SKLADU_MIN = 15

/* ------------------------------------------------------------------ */
/* Záznam                                                               */
/* ------------------------------------------------------------------ */

export type ZaznamJinePlatby = {
  id: string
  tenantId: string
  branchId: string
  pripojeniId: string | null
  posProvozovna: string | null
  datumProdeje: string | null
  oznaceni: string
  kontaktId: string | null
  mena: string | null
  castkaHaleru: number | null
  castkaPuvod: PuvodCastky | null
  typDokladu: TypDokladu
  externiUcet: string | null
  posProdejId: string | null
  stavKontroly: StavKontroly
  stavTrzby: StavTrzby
  stavSkladu: StavSkladu
  stavFaktury: StavFaktury
  fakturaCislo: string | null
  fakturaZdroj: 'pos' | 'externi' | null
  fakturaCastkaHaleru: number | null
  stavUhrady: StavUhrady
  uhradaTransakceId: string | null
  uhradaCastkaHaleru: number | null
  kontrolaTrzby: KontrolaPos<VysledekKontrolyTrzby> | null
  kontrolaSkladu: KontrolaPos<VysledekKontrolySkladu> | null
  /**
   * Poslední výsledek DOTAZU DO POKLADNY (zdroj vždy 'pos_api') — zvlášť od
   * poslední kontroly, ruční prohlášení ho nepřepíše. Na něm stojí pojistka
   * `prohlaseniProtiPokladne` (jinak by šel výsledek „vyprat“ ručním „je“
   * a potom „není“, ověření 20. 10.).
   */
  pokladnaTrzby: KontrolaPos<VysledekKontrolyTrzby> | null
  pokladnaSkladu: KontrolaPos<VysledekKontrolySkladu> | null
  /**
   * Zrušený požadavek výdeje do pokladny s NEJASNÝM výsledkem
   * (`jine_platby_zrusit_schvaleni`, ověření 21. 10.). Dokud je vyplněný,
   * ruční „neodečteno“ smí jen člověk s právem na opravy; vymaže ho
   * kontrola skladu v pokladně s jasným výsledkem.
   */
  nedohledanaOperace: { operace: string | null; klic: string | null; stav: string | null; kdy: string | null } | null
  /** Upozornění AI k celému dokladu (viz HlavickaNavrhu.upozorneniDokladu). */
  upozorneniDokladu: string[]
  /** Rozpoznání, ze kterého je uložený návrh (viz HlavickaNavrhu.rozpoznaniId). */
  rozpoznaniId: string | null
  /**
   * 'kiosek' = doklad vyfocený na telefonu pobočky (migrace 20261022100000);
   * autorem je zařízení (`zarizeniNazev`), `vytvoril` je prázdné.
   */
  zdroj: 'aplikace' | 'kiosek'
  zarizeniNazev: string | null
  verze: number
  vytvoril: string | null
  vytvoreno: string
  zmeneno: string
}

/* ------------------------------------------------------------------ */
/* Oprávnění agendy (musí sedět s PERMISSIONS v lib/authz.ts)           */
/* ------------------------------------------------------------------ */

export const PRAVA_JINYCH_PLATEB = [
  'jine_platby.zadat',
  'jine_platby.upravit',
  'jine_platby.sklad_odeslat',
  'jine_platby.trzba',
  'jine_platby.vydej_pos',
  'jine_platby.faktura',
  'jine_platby.oprava',
] as const
export type PravoJinychPlateb = (typeof PRAVA_JINYCH_PLATEB)[number]

/** Kdo záznamy pobočky VIDÍ: kterékoli právo agendy, nebo finanční přehled. */
export const PRAVA_CTENI_JINYCH_PLATEB = [...PRAVA_JINYCH_PLATEB, 'finance.read'] as const

/* ------------------------------------------------------------------ */
/* Soubory                                                              */
/* ------------------------------------------------------------------ */

export const KBELIK_JINYCH_PLATEB = 'jine-platby'

/**
 * Zdroje plateb, které prokazují úhradu (výpis banky, napojení banky) —
 * stejné jako `jine_platby_evidovat_uhradu` (migrace 20261021100000)
 * a automatické párování faktur. Ručně zapsaná platba ani platba
 * z pokladny úhradu „ověřenou v bance“ neprokáže (ověření 21. 10.).
 */
export const ZDROJE_UHRADY = ['fio_api', 'bankovni_agregator', 'csv_banka'] as const
export const TYPY_SOUBORU = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type TypSouboru = (typeof TYPY_SOUBORU)[number]
export const MAX_BAJTU_SOUBORU = 10 * 1024 * 1024
export const MAX_SOUBORU_NA_ZAZNAM = 10
/**
 * Strop jednoho PDF pro AI (base64 přidá třetinu; API má strop požadavku 32 MB).
 * Fotka má přísnější `MAX_BAJTU_OBRAZKU_PRO_AI`.
 */
export const MAX_BAJTU_PRO_AI = 8 * 1024 * 1024
/**
 * Konzervativní strop jedné FOTKY pro AI. API bere obrázek nejvýš 10 MB
 * PO převodu do base64 (platform.claude.com/docs/en/build-with-claude/vision,
 * „Request limits", čteno 18. 10. 2026) — 8 MB fotka by v base64 měla
 * ~10,7 MB a API by ji odmítlo. 5 MB je ~6,7 MB v base64, s rezervou.
 * Prohlížeč fotku nad stropem zmenší (lib/jine-platby-soubory.ts),
 * server ji před voláním modelu zkontroluje znovu (`zkontrolovatPodklad`).
 */
export const MAX_BAJTU_OBRAZKU_PRO_AI = 5 * 1024 * 1024
/**
 * Strop všech souborů jednoho rozpoznání dohromady. API bere nejvýš 32 MB
 * na požadavek a base64 přidá třetinu: 20 MB → ~26,7 MB + zadání. Šest
 * plných souborů (`MAX_SOUBORU_PRO_AI`) by se do požadavku nevešlo.
 */
export const MAX_BAJTU_CELKEM_PRO_AI = 20 * 1024 * 1024
/** Kolik souborů jde do jednoho rozpoznání (víc stránek / fotek jedné sjetiny). */
export const MAX_SOUBORU_PRO_AI = 6
/**
 * Strop stran JEDNOHO PDF pro AI (N25). API bere až 600 stran na požadavek,
 * ale doklad Jiných plateb je účtenka, sjetina nebo otevřený účet — PDF
 * o desítkách stran je skoro jistě něco jiného (měsíční přehled) a jedno
 * čtení by stálo statisíce tokenů a nevešlo se do času. Kontroluje se
 * PŘED započtením pokusu do denního stropu (`zkontrolovatPodklad`).
 */
export const MAX_STRAN_PDF_PRO_AI = 20
/** Strop stran všech souborů jednoho rozpoznání dohromady (fotka = 1 strana, PDF = počet jeho stran). */
export const MAX_STRAN_PRO_AI = 30
/** Denní strop rozpoznání na firmu (musí sedět s migrací). */
export const AI_LIMIT_ZA_DEN = 200

/* ------------------------------------------------------------------ */
/* Rozpoznání (výstup AI po kontrole schématu, PŘED kontrolou součtů)   */
/* ------------------------------------------------------------------ */

/**
 * Částky z AI chodí jako TEXT přesně, jak stojí na dokladu ("1 234,50",
 * "45,-"), ne jako číslo — převod na haléře dělá `lib/jine-platby-castky.ts`
 * bez plovoucí čárky. `null` = na dokladu není nebo nejde přečíst.
 */
export type RozpoznanaPolozka = {
  nazev: string
  mnozstvi: string | null
  jednotka: string | null
  cenaJednotkova: string | null
  cenaCelkem: string | null
  sazbaDph: string | null
  /** Návrh druhu podle názvu — jen návrh, člověk potvrdí. */
  druhNavrh: DruhPolozky
  /** 0–1, jak si je model jistý přečtením řádku. */
  jistota: number
  poznamka: string | null
}

export type RozpoznanyDoklad = {
  polozky: RozpoznanaPolozka[]
  /** Celková cena prodeje (součet za zboží po slevách), ne „K úhradě“. */
  celkem: string | null
  /** „K úhradě“ / „Celkem k úhradě“ — může se lišit (záloha, částečná úhrada, spropitné). */
  kUhrade: string | null
  /** Už zaplaceno (částečná platba, záloha). */
  zaplaceno: string | null
  /** Přijatá hotovost (ne tržba). */
  prijatoHotove: string | null
  /** Vráceno zákazníkovi. */
  vraceno: string | null
  /** Zbývá doplatit, když to doklad uvádí. */
  zbyva: string | null
  sleva: string | null
  spropitne: string | null
  mena: string | null
  datum: string | null // RRRR-MM-DD nebo null
  /**
   * Čas tisku/vystavení účtenky „HH:MM" (24 h), jen když je na dokladu
   * čitelný; jinak null — nic se nedomýšlí. Podle něj kontrola posune
   * kalendářní datum na provozní den (účet z 1:30 patří do včerejška).
   * Starší uložená rozpoznání ho nemají (čte se jako null).
   */
  cas: string | null
  externiId: string | null
  typDokladu: TypDokladu
  /** Doslovný přepis textu dokladu (zkrácený). */
  textDokladu: string
  /** 0–1 za celý doklad. */
  jistota: number
  /** Co model sám považuje za sporné; každá položka = důvod ke kontrole. */
  upozorneni: string[]
}
