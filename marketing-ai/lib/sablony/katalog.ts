/**
 * Knihovna gastro šablon — DATA, ne obrázky.
 *
 * Každá šablona říká:
 *   - jaké vstupy potřebuje (JSON Schema → v aplikaci se z něj staví Zod),
 *   - jak se skládá (layout: styl a bloky s vazbou na brand kit),
 *   - které výstupy umí (formats),
 *   - pravidla pro dlouhé texty (nikdy useknutý název jídla; písmo se
 *     zmenšuje jen do čitelného minima; delší menu se dělí na slidy),
 *   - volitelný storyboard videa.
 *
 * Seed je zapíše jako globální šablony (organization_id NULL). Organizace
 * si je může duplikovat, upravit povolené části a nastavit jako výchozí
 * pro provozovnu — kopie dostane vlastní řádek s parent_template_id.
 */
import type { FormatKey } from "../formaty.ts";

export type Kategorie = "menu" | "akce" | "prubezne";
export type Pilir = "menu" | "lide" | "atmosfera" | "akce" | "zakulisi" | "prodej";

export interface SablonaVstup {
  key: string;
  label: string;
  type: "string" | "text" | "number" | "date" | "date_range" | "time" | "price" | "items" | "media" | "select" | "boolean" | "url";
  required?: boolean;
  /** Pro select */
  options?: { value: string; label: string }[];
  /** Pro items: max položek na slide */
  perSlide?: number;
  help?: string;
  default?: unknown;
}

export interface SablonaBlok {
  kind: "title" | "subtitle" | "items" | "price" | "date" | "cta" | "photo" | "logo" | "contact" | "badge" | "body" | "hashtags";
  /** Vazba na vstup nebo brand kit, např. input:title, brand:logo, menu:items */
  source: string;
  /** Uzamčený brand prvek — uživatel nemění */
  locked?: boolean;
  align?: "left" | "center" | "right";
  /** Relativní důraz 1–3 */
  weight?: 1 | 2 | 3;
}

export interface SablonaStoryboardScena {
  kind: "intro" | "photo" | "item" | "items" | "text" | "cta" | "outro";
  seconds: number;
  source?: string;
  caption?: string;
}

export interface SablonaDef {
  key: string;
  name: string;
  category: Kategorie;
  pillar: Pilir;
  description: string;
  /** Účel v průvodci tvorbou (content_items.purpose) */
  purpose: string;
  inputs: SablonaVstup[];
  layout: {
    style: "menu-list" | "weekly-grid" | "hero-photo" | "event-poster" | "quote" | "alert" | "portrait" | "split";
    blocks: SablonaBlok[];
  };
  formats: FormatKey[];
  textRules: {
    titleMaxChars: number;
    minFontPx: number;
    itemsPerSlide: number;
    splitLongMenus: boolean;
    noTruncation: true;
  };
  storyboard?: { scenes: SablonaStoryboardScena[]; defaultSeconds: number };
  /** Kontrolní seznam chybějících podkladů před renderem */
  checklist: string[];
}

const IG_FB: FormatKey[] = ["instagram_feed", "instagram_story", "facebook_post"];
const IG_FB_VIDEO: FormatKey[] = ["instagram_feed", "instagram_story", "instagram_reel", "facebook_post", "facebook_reel", "video_cover"];
const MENU_ALL: FormatKey[] = ["instagram_feed", "instagram_carousel", "instagram_story", "instagram_reel", "facebook_post", "facebook_reel", "video_cover", "pdf_a4", "pdf_a5"];

const brandBlocks: SablonaBlok[] = [
  { kind: "logo", source: "brand:logo", locked: true },
  { kind: "contact", source: "brand:contact", locked: true },
];

const menuTextRules = { titleMaxChars: 60, minFontPx: 28, itemsPerSlide: 5, splitLongMenus: true, noTruncation: true as const };
const posterTextRules = { titleMaxChars: 48, minFontPx: 32, itemsPerSlide: 4, splitLongMenus: true, noTruncation: true as const };

const cenaVstup: SablonaVstup = { key: "price", label: "Cena", type: "price", help: "V Kč. Bez ceny se šablona nevykreslí bez varování." };
const datumVstup: SablonaVstup = { key: "date", label: "Datum", type: "date", required: true };
const ctaVstup: SablonaVstup = {
  key: "cta", label: "Výzva k akci", type: "select", default: "brand",
  options: [
    { value: "brand", label: "Podle brand kitu" }, { value: "rezervace", label: "Rezervujte si stůl" },
    { value: "objednavka", label: "Objednejte online" }, { value: "navsteva", label: "Přijďte ochutnat" },
    { value: "zadna", label: "Bez výzvy" },
  ],
};
const fotoVstup: SablonaVstup = { key: "media", label: "Fotografie nebo videa", type: "media", help: "Z mediální knihovny provozovny nebo nové nahrání." };
const menuPolozky = (perSlide = 5): SablonaVstup => ({ key: "items", label: "Položky menu", type: "items", required: true, perSlide, help: "Načtou se z uloženého menu; delší menu se rozdělí na více slidů." });

function menuStoryboard(scenes: SablonaStoryboardScena[] = []): SablonaDef["storyboard"] {
  return {
    defaultSeconds: 15,
    scenes: [
      { kind: "intro", seconds: 2, source: "brand:intro" },
      { kind: "photo", seconds: 3, source: "input:media[0]", caption: "input:title" },
      ...scenes,
      { kind: "items", seconds: 6, source: "input:items" },
      { kind: "cta", seconds: 3, source: "input:cta" },
      { kind: "outro", seconds: 1, source: "brand:outro" },
    ],
  };
}

export const SABLONY: SablonaDef[] = [
  // ------------------------------------------------------------------
  // A. MENU
  // ------------------------------------------------------------------
  {
    key: "denni_menu", name: "Denní menu", category: "menu", pillar: "menu", purpose: "denni_menu",
    description: "Datum, polévka, hlavní jídla s cenou, alergeny, čas nabídky a výzva. Dlouhé menu se rozdělí na slidy.",
    inputs: [
      datumVstup,
      { key: "time_from", label: "Nabídka od", type: "time", default: "11:00" },
      { key: "time_to", label: "Nabídka do", type: "time", default: "14:00" },
      menuPolozky(5),
      { key: "show_allergens", label: "Zobrazit alergeny", type: "boolean", default: true },
      ctaVstup, fotoVstup,
    ],
    layout: {
      style: "menu-list",
      blocks: [
        { kind: "badge", source: "input:date", weight: 1 },
        { kind: "title", source: "static:Denní menu", weight: 3 },
        { kind: "items", source: "input:items", weight: 2 },
        { kind: "photo", source: "input:media[0]" },
        { kind: "cta", source: "input:cta" },
        ...brandBlocks,
      ],
    },
    formats: MENU_ALL, textRules: menuTextRules, storyboard: menuStoryboard(),
    checklist: ["Datum nabídky", "Alespoň jedna položka s cenou", "Alergeny (pokud se zobrazují)"],
  },
  {
    key: "tydenni_menu", name: "Týdenní menu", category: "menu", pillar: "menu", purpose: "tydenni_menu",
    description: "Pondělí až pátek nebo vlastní rozsah. Celý týden na jednom obrázku, carousel po dnech, Story na každý den a krátké video.",
    inputs: [
      { key: "range", label: "Platnost", type: "date_range", required: true },
      { key: "days", label: "Dny a jídla", type: "items", required: true, perSlide: 1, help: "Jeden den = jeden slide carouselu nebo jedna Story." },
      ctaVstup, fotoVstup,
    ],
    layout: { style: "weekly-grid", blocks: [
      { kind: "title", source: "static:Týdenní menu", weight: 3 }, { kind: "date", source: "input:range" },
      { kind: "items", source: "input:days", weight: 2 }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: { ...menuTextRules, itemsPerSlide: 6 }, storyboard: menuStoryboard(),
    checklist: ["Rozsah platnosti", "Každý den aspoň jedno jídlo s cenou"],
  },
  {
    key: "vikendove_menu", name: "Víkendové menu", category: "menu", pillar: "menu", purpose: "vikendove_menu",
    description: "Sobota a neděle nebo vlastní rozsah: polévka, hlavní jídla, dezert, cena a rezervace.",
    inputs: [
      { key: "range", label: "Platnost", type: "date_range", required: true },
      menuPolozky(5), { key: "reservation", label: "Doporučit rezervaci", type: "boolean", default: true },
      ctaVstup, fotoVstup,
    ],
    layout: { style: "menu-list", blocks: [
      { kind: "title", source: "static:Víkendové menu", weight: 3 }, { kind: "date", source: "input:range" },
      { kind: "items", source: "input:items", weight: 2 }, { kind: "photo", source: "input:media[0]" },
      { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: menuTextRules, storyboard: menuStoryboard(),
    checklist: ["Rozsah platnosti", "Polévka nebo hlavní jídlo s cenou", "Rezervační odkaz v brand kitu (pokud se doporučuje rezervace)"],
  },
  {
    key: "poledni_menu_3", name: "Polední tříchodové menu", category: "menu", pillar: "menu", purpose: "poledni_menu",
    description: "Polévka, hlavní chod, dezert — nebo jiná konfigurovatelná skladba za jednu cenu.",
    inputs: [
      datumVstup,
      { key: "courses", label: "Skladba chodů", type: "select", default: "polevka_hlavni_dezert", options: [
        { value: "polevka_hlavni_dezert", label: "Polévka + hlavní + dezert" }, { value: "predkrm_hlavni_dezert", label: "Předkrm + hlavní + dezert" },
        { value: "polevka_hlavni", label: "Polévka + hlavní" },
      ] },
      menuPolozky(3), { ...cenaVstup, label: "Cena za menu", required: true }, ctaVstup, fotoVstup,
    ],
    layout: { style: "menu-list", blocks: [
      { kind: "title", source: "static:Polední menu", weight: 3 }, { kind: "date", source: "input:date" },
      { kind: "items", source: "input:items", weight: 2 }, { kind: "price", source: "input:price", weight: 3 },
      { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: { ...menuTextRules, itemsPerSlide: 3 }, storyboard: menuStoryboard(),
    checklist: ["Datum", "Cena za menu", "Všechny chody"],
  },
  {
    key: "jidlo_dne", name: "Jídlo dne / Chef's special", category: "menu", pillar: "menu", purpose: "jidlo_dne",
    description: "Jedno jídlo, jedna fotka, jedna cena.",
    inputs: [
      { key: "title", label: "Název jídla", type: "string", required: true }, { key: "description", label: "Popis", type: "text" },
      cenaVstup, datumVstup, { key: "allergens", label: "Alergeny", type: "string" }, ctaVstup, { ...fotoVstup, required: true },
    ],
    layout: { style: "hero-photo", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 3 }, { kind: "badge", source: "static:Jídlo dne" },
      { kind: "title", source: "input:title", weight: 3 }, { kind: "body", source: "input:description" },
      { kind: "price", source: "input:price", weight: 2 }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: IG_FB_VIDEO, textRules: posterTextRules,
    storyboard: { defaultSeconds: 10, scenes: [
      { kind: "photo", seconds: 4, source: "input:media[0]", caption: "input:title" }, { kind: "text", seconds: 3, source: "input:description" },
      { kind: "cta", seconds: 2, source: "input:cta" }, { kind: "outro", seconds: 1, source: "brand:outro" },
    ] },
    checklist: ["Fotografie jídla", "Název", "Cena"],
  },
  {
    key: "sezonni_menu", name: "Sezonní menu", category: "menu", pillar: "menu", purpose: "sezonni_menu",
    description: "Sezonní nabídka s platností a položkami.",
    inputs: [ { key: "title", label: "Název sezony", type: "string", required: true, help: "např. Chřestové menu" },
      { key: "range", label: "Platnost", type: "date_range", required: true }, menuPolozky(5), ctaVstup, fotoVstup ],
    layout: { style: "menu-list", blocks: [
      { kind: "title", source: "input:title", weight: 3 }, { kind: "date", source: "input:range" },
      { kind: "items", source: "input:items", weight: 2 }, { kind: "photo", source: "input:media[0]" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: menuTextRules, storyboard: menuStoryboard(),
    checklist: ["Název sezony", "Platnost", "Položky s cenou"],
  },
  {
    key: "novinka_v_listku", name: "Novinka v jídelním lístku", category: "menu", pillar: "menu", purpose: "novinka",
    description: "Nové jídlo nebo nápoj v stálém lístku.",
    inputs: [ { key: "title", label: "Název", type: "string", required: true }, { key: "description", label: "Proč to stojí za to", type: "text" },
      cenaVstup, ctaVstup, { ...fotoVstup, required: true } ],
    layout: { style: "hero-photo", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 3 }, { kind: "badge", source: "static:Novinka" },
      { kind: "title", source: "input:title", weight: 3 }, { kind: "body", source: "input:description" }, { kind: "price", source: "input:price" },
      { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: IG_FB_VIDEO, textRules: posterTextRules,
    checklist: ["Fotografie", "Název", "Cena"],
  },
  {
    key: "napojovy_special", name: "Nápojový, pivní nebo vinný speciál", category: "menu", pillar: "prodej", purpose: "napojovy_special",
    description: "Nové pivo na čepu, vinná nabídka nebo koktejl.",
    inputs: [ { key: "kind", label: "Druh", type: "select", default: "pivo", options: [ { value: "pivo", label: "Pivo" }, { value: "vino", label: "Víno" }, { value: "koktejl", label: "Koktejl" }, { value: "nealko", label: "Nealko" } ] },
      { key: "title", label: "Název", type: "string", required: true }, { key: "description", label: "Popis", type: "text" }, cenaVstup,
      { key: "range", label: "Platnost", type: "date_range" }, ctaVstup, fotoVstup ],
    layout: { style: "hero-photo", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 3 }, { kind: "badge", source: "input:kind" }, { kind: "title", source: "input:title", weight: 3 },
      { kind: "body", source: "input:description" }, { kind: "price", source: "input:price" }, { kind: "date", source: "input:range" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: IG_FB_VIDEO, textRules: posterTextRules,
    checklist: ["Název", "Cena"],
  },
  {
    key: "dezert_tydne", name: "Dezert týdne", category: "menu", pillar: "menu", purpose: "dezert_tydne",
    description: "Jeden dezert, jedna fotka.",
    inputs: [ { key: "title", label: "Název dezertu", type: "string", required: true }, { key: "description", label: "Popis", type: "text" }, cenaVstup,
      { key: "range", label: "Platnost", type: "date_range" }, ctaVstup, { ...fotoVstup, required: true } ],
    layout: { style: "hero-photo", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 3 }, { kind: "badge", source: "static:Dezert týdne" }, { kind: "title", source: "input:title", weight: 3 },
      { kind: "body", source: "input:description" }, { kind: "price", source: "input:price" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: IG_FB_VIDEO, textRules: posterTextRules,
    checklist: ["Fotografie", "Název"],
  },
  {
    key: "vyprodano", name: "Vyprodáno / poslední porce / změna menu", category: "menu", pillar: "menu", purpose: "provozni_hlaska",
    description: "Rychlá provozní šablona: krátká zpráva, žádná fotka nutná.",
    inputs: [ { key: "kind", label: "Co se stalo", type: "select", required: true, options: [
        { value: "vyprodano", label: "Vyprodáno" }, { value: "posledni_porce", label: "Poslední porce" }, { value: "zmena", label: "Změna menu" } ] },
      { key: "title", label: "Čeho se to týká", type: "string", required: true }, { key: "body", label: "Doplnění", type: "text" } ],
    layout: { style: "alert", blocks: [ { kind: "badge", source: "input:kind", weight: 3 }, { kind: "title", source: "input:title", weight: 3 }, { kind: "body", source: "input:body" }, ...brandBlocks ] },
    formats: ["instagram_story", "facebook_post"], textRules: { ...posterTextRules, itemsPerSlide: 1 },
    checklist: ["Čeho se hláška týká"],
  },

  // ------------------------------------------------------------------
  // B. GASTROAKCE A TEMATICKÉ KAMPANĚ
  // ------------------------------------------------------------------
  ...([
    ["burger_vikend", "Burger víkend / burger speciál", "Burger víkend", "prodej"],
    ["steakovy_vecer", "Steakový večer", "Steakový večer", "akce"],
    ["rizky_zebirka_kridla", "Řízkové, žebírkové, křídlové nebo grilovací menu", "Grilovací menu", "prodej"],
    ["pivni_special", "Pivní speciál, nové pivo na čepu nebo tap takeover", "Nové pivo na čepu", "prodej"],
    ["vinna_degustace", "Vinná degustace", "Vinná degustace", "akce"],
    ["farmarska_nabidka", "Sezonní a farmářská nabídka", "Farmářská nabídka", "menu"],
    ["valentyn", "Valentýnské menu", "Valentýnské menu", "akce"],
    ["velikonoce", "Velikonoce", "Velikonoční nabídka", "akce"],
    ["den_matek_otcu", "Den matek a Den otců", "Den matek", "akce"],
    ["svatomartinske", "Svatomartinské menu", "Svatomartinská husa", "akce"],
    ["advent_vanoce_silvestr", "Adventní, vánoční a silvestrovská nabídka", "Vánoční nabídka", "akce"],
    ["ziva_hudba", "Živá hudba, DJ nebo kulturní program", "Živá hudba", "akce"],
    ["narozeniny_podniku", "Narozeniny nebo výročí restaurace", "Slavíme narozeniny", "akce"],
    ["happy_hour", "Happy hour", "Happy hour", "prodej"],
    ["soutez", "Soutěž", "Soutěž", "prodej"],
    ["darkovy_voucher", "Dárkový voucher", "Dárkový voucher", "prodej"],
    ["catering_oslava", "Catering a soukromá oslava", "Catering a oslavy", "prodej"],
    ["nabor", "Nábor zaměstnanců", "Hledáme posilu", "lide"],
  ] as [string, string, string, Pilir][]).map(([key, name, defaultTitle, pillar]): SablonaDef => ({
    key, name, category: "akce", pillar, purpose: key,
    description: `${name}: název akce, termín, nabídka s cenou, fotky a výzva. Rozpracuje se do mini-kampaně (pozvánka → připomínka → poslední výzva → poděkování).`,
    inputs: [
      { key: "title", label: "Název akce", type: "string", required: true, default: defaultTitle },
      { key: "range", label: "Termín", type: "date_range", required: true },
      { key: "time_from", label: "Od", type: "time" },
      { key: "items", label: "Nabídka", type: "items", perSlide: 4, help: "Volitelné položky s cenou." },
      { key: "body", label: "Doplňující text", type: "text" },
      { key: "reservation", label: "Doporučit rezervaci", type: "boolean", default: true },
      ctaVstup, fotoVstup,
    ],
    layout: { style: "event-poster", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 2 }, { kind: "badge", source: "input:range" },
      { kind: "title", source: "input:title", weight: 3 }, { kind: "body", source: "input:body" },
      { kind: "items", source: "input:items" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: posterTextRules,
    storyboard: { defaultSeconds: 15, scenes: [
      { kind: "intro", seconds: 2, source: "brand:intro" }, { kind: "photo", seconds: 4, source: "input:media[0]", caption: "input:title" },
      { kind: "text", seconds: 3, source: "input:range" }, { kind: "items", seconds: 4, source: "input:items" },
      { kind: "cta", seconds: 2, source: "input:cta" }, { kind: "outro", seconds: 1, source: "brand:outro" },
    ] },
    checklist: ["Název akce", "Termín", "Alespoň jedna fotografie"],
  })),
  {
    key: "sportovni_prenos", name: "Sportovní přenos", category: "akce", pillar: "akce", purpose: "sportovni_prenos",
    description: "Fotbal, hokej a další přenosy: kdo hraje, kdy, co k tomu nabízíte.",
    inputs: [
      { key: "sport", label: "Sport", type: "select", default: "hokej", options: [ { value: "hokej", label: "Hokej" }, { value: "fotbal", label: "Fotbal" }, { value: "jiny", label: "Jiný" } ] },
      { key: "title", label: "Zápas", type: "string", required: true, help: "např. Česko – Kanada" },
      datumVstup, { key: "time_from", label: "Začátek", type: "time", required: true },
      { key: "items", label: "Nabídka k přenosu", type: "items", perSlide: 4 },
      { key: "reservation", label: "Doporučit rezervaci", type: "boolean", default: true }, ctaVstup, fotoVstup,
    ],
    layout: { style: "event-poster", blocks: [
      { kind: "photo", source: "input:media[0]", weight: 2 }, { kind: "badge", source: "input:sport" }, { kind: "title", source: "input:title", weight: 3 },
      { kind: "date", source: "input:date" }, { kind: "items", source: "input:items" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: MENU_ALL, textRules: posterTextRules,
    storyboard: { defaultSeconds: 12, scenes: [
      { kind: "intro", seconds: 2, source: "brand:intro" }, { kind: "text", seconds: 3, source: "input:title" },
      { kind: "photo", seconds: 3, source: "input:media[0]" }, { kind: "items", seconds: 3, source: "input:items" }, { kind: "cta", seconds: 1, source: "input:cta" },
    ] },
    checklist: ["Zápas", "Datum a čas začátku"],
  },
  {
    key: "zmena_oteviraci_doby", name: "Změna otevírací doby, dovolená nebo uzavření", category: "akce", pillar: "akce", purpose: "oteviraci_doba",
    description: "Provozní oznámení bez fotky.",
    inputs: [ { key: "kind", label: "Typ", type: "select", required: true, options: [ { value: "zmena", label: "Změna otevírací doby" }, { value: "dovolena", label: "Dovolená" }, { value: "uzavreni", label: "Mimořádné uzavření" } ] },
      { key: "range", label: "Období", type: "date_range", required: true }, { key: "body", label: "Podrobnosti", type: "text", required: true } ],
    layout: { style: "alert", blocks: [ { kind: "badge", source: "input:kind" }, { kind: "title", source: "input:range", weight: 3 }, { kind: "body", source: "input:body", weight: 2 }, ...brandBlocks ] },
    formats: IG_FB, textRules: { ...posterTextRules, itemsPerSlide: 1 },
    checklist: ["Období", "Podrobnosti"],
  },

  // ------------------------------------------------------------------
  // C. PRŮBĚŽNÝ OBSAH
  // ------------------------------------------------------------------
  ...([
    ["detail_jidla", "Detail jídla a surovin", "menu", "hero-photo", "Jedno jídlo zblízka a odkud jsou suroviny."],
    ["ze_zakulisi", "Příprava v kuchyni / ze zákulisí", "zakulisi", "hero-photo", "Fotka nebo video z kuchyně."],
    ["predstaveni_kuchare", "Představení kuchaře nebo člena týmu", "lide", "portrait", "Kdo je za pultem a v kuchyni. Souhlas člověka je nutný."],
    ["atmosfera", "Atmosféra restaurace", "atmosfera", "hero-photo", "Interiér, terasa, večer."],
    ["reference_hosta", "Reference a recenze hosta", "prodej", "quote", "Citace hosta se zaznamenaným souhlasem."],
    ["anketa", "Otázka, anketa nebo výzva k interakci", "atmosfera", "split", "Jednoduchá otázka pro sledující."],
    ["pozvanka_pred_akci", "Pozvánka, připomínka a poslední výzva před akcí", "akce", "event-poster", "Tři varianty podle fáze před akcí."],
    ["reportaz_po_akci", "Reportáž nebo poděkování po akci", "akce", "hero-photo", "Fotky z akce a poděkování."],
    ["objednavka_online", "Objednávka jídla online a rozvoz", "prodej", "split", "Odkaz na objednávku z brand kitu."],
    ["rezervace_stolu", "Rezervace stolu", "prodej", "split", "Odkaz na rezervaci z brand kitu."],
    ["obsah_hosta", "Obsah vytvořený hostem", "atmosfera", "hero-photo", "Fotka od hosta se zaznamenaným souhlasem."],
    ["evergreen", "Evergreen příspěvek", "atmosfera", "hero-photo", "Vhodný k pozdějšímu opakování; bez data a ceny."],
  ] as [string, string, Pilir, SablonaDef["layout"]["style"], string][]).map(([key, name, pillar, style, description]): SablonaDef => ({
    key, name, category: "prubezne", pillar, purpose: key, description,
    inputs: [
      { key: "title", label: "Titulek", type: "string", required: true },
      { key: "body", label: "Text", type: "text" },
      ...(key === "reference_hosta" || key === "obsah_hosta" || key === "predstaveni_kuchare"
        ? [{ key: "consent", label: "Souhlas zaznamenán", type: "boolean" as const, required: true, help: "Bez souhlasu se obsah nevykreslí." }]
        : []),
      ctaVstup, { ...fotoVstup, required: style !== "quote" && style !== "split" },
    ],
    layout: { style, blocks: [
      { kind: "photo", source: "input:media[0]", weight: 3 }, { kind: "title", source: "input:title", weight: 3 },
      { kind: "body", source: "input:body" }, { kind: "cta", source: "input:cta" }, ...brandBlocks,
    ] },
    formats: IG_FB_VIDEO, textRules: posterTextRules,
    checklist: ["Titulek", ...(style === "hero-photo" || style === "portrait" ? ["Fotografie"] : []),
      ...(key === "reference_hosta" || key === "obsah_hosta" || key === "predstaveni_kuchare" ? ["Souhlas dotčené osoby"] : [])],
  })),
];

export function sablona(key: string): SablonaDef | undefined {
  return SABLONY.find((s) => s.key === key);
}

/** JSON Schema vstupů — ukládá se do template_versions.input_schema. */
export function inputJsonSchema(def: SablonaDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const i of def.inputs) {
    const base: Record<string, unknown> = { title: i.label };
    switch (i.type) {
      case "string": case "text": case "time": case "url": base.type = "string"; break;
      case "number": case "price": base.type = "number"; base.minimum = 0; break;
      case "date": base.type = "string"; base.format = "date"; break;
      case "date_range": base.type = "object"; base.properties = { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } }; break;
      case "items": base.type = "array"; base.items = { type: "object" }; break;
      case "media": base.type = "array"; base.items = { type: "string", format: "uuid" }; break;
      case "select": base.type = "string"; base.enum = i.options?.map((o) => o.value); break;
      case "boolean": base.type = "boolean"; break;
    }
    if (i.help) base.description = i.help;
    if (i.default !== undefined) base.default = i.default;
    properties[i.key] = base;
    if (i.required) required.push(i.key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
