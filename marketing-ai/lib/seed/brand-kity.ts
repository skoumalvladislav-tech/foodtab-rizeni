/**
 * Výchozí brand kity demo provozoven.
 *
 * ADRESY, TELEFONY, WEBY A CENY SE NEVYMÝŠLEJÍ. Kde údaj neznáme, je
 * pole prázdné a v rozhraní je označené jako demo k doplnění
 * (`is_demo = true`). Barvy jsou návrh k úpravě, ne zjištěná identita
 * značky.
 */
export interface BrandKitSeed {
  name: string;
  short_description: string;
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  fonts: { heading: string; body: string };
  tone_of_voice: string;
  preferred_ctas: string[];
  allowed_phrases: string[];
  forbidden_phrases: string[];
  default_hashtags: string[];
  signature: string;
  logo_placement: { position: string; safe_zone_percent: number };
  music_style: string;
  voice_style: string;
  default_video_seconds: number;
}

export const BRAND_KITY: Record<"cernaPerla" | "bernardBar" | "bistro", BrandKitSeed> = {
  cernaPerla: {
    name: "Černá Perla",
    short_description: "Restaurace s denním menu a večerní nabídkou. (Demo popis — upravte podle skutečnosti.)",
    colors: { primary: "#1f1a2e", secondary: "#6b4c8a", accent: "#d8ab4e", background: "#f6f2e9", text: "#16211c" },
    fonts: { heading: "Newsreader", body: "Archivo" },
    tone_of_voice: "Přátelský, věcný, bez zbytečných superlativů. Tykáme si s hosty jen tam, kde to je přirozené; jinak vykání.",
    preferred_ctas: ["Rezervujte si stůl", "Přijďte ochutnat", "Podívejte se na dnešní menu"],
    allowed_phrases: ["denní menu", "poctivá kuchyně", "čerstvé suroviny"],
    forbidden_phrases: ["nejlepší na světě", "sleva 90 %", "jen dnes!!!"],
    default_hashtags: ["#cernaperla", "#dennimenu", "#restaurace"],
    signature: "Černá Perla",
    logo_placement: { position: "bottom-right", safe_zone_percent: 8 },
    music_style: "klidná akustická",
    voice_style: "ženský, přátelský, střední tempo",
    default_video_seconds: 15,
  },
  bernardBar: {
    name: "Bernard Bar Tábor",
    short_description: "Pivní bar v Táboře se sportovními přenosy a víkendovým menu. (Demo popis — upravte podle skutečnosti.)",
    colors: { primary: "#3a2214", secondary: "#8a4a1c", accent: "#e0a94a", background: "#f6f2e9", text: "#16211c" },
    fonts: { heading: "Archivo", body: "Archivo" },
    tone_of_voice: "Uvolněný, hospodský, s humorem. Krátké věty. Tykání sledujícím.",
    preferred_ctas: ["Rezervuj si místo", "Přijď na pivo", "Sleduj přenos u nás"],
    allowed_phrases: ["čepujeme", "víkendové menu", "přenos", "na čepu"],
    forbidden_phrases: ["nejlevnější", "zdarma pro všechny"],
    default_hashtags: ["#bernardbartabor", "#tabor", "#pivo"],
    signature: "Bernard Bar Tábor",
    logo_placement: { position: "top-left", safe_zone_percent: 8 },
    music_style: "energická, rock",
    voice_style: "mužský, energický",
    default_video_seconds: 12,
  },
  bistro: {
    name: "Bistro Centrum",
    short_description: "Ukázková provozovna druhé organizace pro test oddělení dat.",
    colors: { primary: "#1c3a3a", secondary: "#2d787b", accent: "#d8ab4e", background: "#f6f2e9", text: "#16211c" },
    fonts: { heading: "Archivo", body: "Archivo" },
    tone_of_voice: "Neutrální.",
    preferred_ctas: ["Přijďte"],
    allowed_phrases: [],
    forbidden_phrases: [],
    default_hashtags: ["#bistrocentrum"],
    signature: "Bistro Centrum",
    logo_placement: { position: "bottom-left", safe_zone_percent: 8 },
    music_style: "",
    voice_style: "",
    default_video_seconds: 15,
  },
};

/** Složky mediální knihovny, které každá provozovna dostane při založení. */
export const SLOZKY_MEDII: { key: string; name: string }[] = [
  { key: "jidla-foto", name: "Fotografie jídel" },
  { key: "jidla-video", name: "Videa jídel" },
  { key: "prostory", name: "Prostory a atmosféra" },
  { key: "personal", name: "Personál" },
  { key: "akce", name: "Akce" },
  { key: "denni-menu", name: "Denní menu" },
  { key: "vikendove-menu", name: "Víkendové menu" },
  { key: "loga", name: "Loga a grafické prvky" },
  { key: "hudba", name: "Hudba a zvuky s licencí" },
  { key: "hotove", name: "Hotové příspěvky" },
  { key: "archiv", name: "Archiv" },
];

export const SDILENE_SLOZKY: { key: string; name: string }[] = [
  { key: "sdilene", name: "Sdílené pro všechny provozovny" },
];
