/**
 * Checklisty — společné typy a pravidla (bez databáze, bez prohlížeče).
 *
 * Vlastní soubor, ne `'use server'` modul ani stránka: stav karty, barvy
 * a texty potřebuje server (seznam, detail) i klient (živá aktualizace,
 * nahrávání fotek) a musí se shodovat — jeden zdroj pravdy.
 */

export type StavBehu = "open" | "done" | "completed_with_issues";

export type Beh = {
  id: string;
  template_id: string;
  branch_id: string;
  business_date: string;
  status: StavBehu;
  started_at: string | null;
  finished_at: string | null;
  due_at: string | null;
  assigned_employee_id: string | null;
  completed_by: string | null;
  started_by: string | null;
  shift_label: string;
  potvrdil_kym: string | null;
  potvrzeno_kdy: string | null;
  sablona_verze_id: string | null;
};

/** Pohledy seznamu (zadání bod 4 a 38). */
export type KlicPohledu = "dnes" | "moje" | "vse" | "sablony" | "historie";

export const POHLEDY: [KlicPohledu, string][] = [
  ["dnes", "Dnes"],
  ["moje", "Moje"],
  ["vse", "Vše"],
  ["sablony", "Šablony"],
  ["historie", "Historie"],
];

export function jePohled(v: string | undefined): v is KlicPohledu {
  return POHLEDY.some(([k]) => k === v);
}

/** Stav tak, jak ho vidí člověk. Barva nikdy sama — vždy i slovo. */
export type Stav = "hotovo" | "vyhrady" | "probiha" | "poterminu" | "nezahajeno";

export function stavBehu(beh: Pick<Beh, "status" | "due_at"> | null, hotovo: number, ted: number): Stav {
  if (beh?.status === "done") return "hotovo";
  if (beh?.status === "completed_with_issues") return "vyhrady";
  if (beh?.due_at && new Date(beh.due_at).getTime() < ted) return "poterminu";
  if (beh && hotovo > 0) return "probiha";
  return "nezahajeno";
}

export const STAV_POPIS: Record<Stav, string> = {
  hotovo: "Hotovo",
  vyhrady: "S výhradami",
  probiha: "Probíhá",
  poterminu: "Po termínu",
  nezahajeno: "Nezahájeno",
};

/** Tón stavu → CSS třída `data-ton` (zelená hotovo, jantar pozornost, červená problém). */
export const STAV_TON: Record<Stav, "dobre" | "pozor" | "bad" | "neutral"> = {
  hotovo: "dobre",
  vyhrady: "bad",
  probiha: "pozor",
  poterminu: "bad",
  nezahajeno: "neutral",
};

export const NAZVY_ROZVRHU: Record<string, string> = {
  opening: "Otevírací",
  closing: "Zavírací",
  haccp: "HACCP",
  weekly: "Týdenní",
  daily: "Denně",
  selected_days: "Vybrané dny",
  every_shift: "Každá směna",
  manual: "Ručně",
};

/** Rozvrhy, které jde nabídnout v editoru (stejné pořadí, jaké čte člověk). */
export const ROZVRHY: string[] = [
  "daily",
  "opening",
  "closing",
  "haccp",
  "weekly",
  "selected_days",
  "every_shift",
  "manual",
];

export const DNY_TYDNE: [number, string][] = [
  [1, "Po"],
  [2, "Út"],
  [3, "St"],
  [4, "Čt"],
  [5, "Pá"],
  [6, "So"],
  [0, "Ne"],
];

/** Okamžik „teď". Zvlášť, aby se `Date.now()` nevolalo v těle komponenty (react-hooks/purity). */
export function terazMs(): number {
  return Date.now();
}

/**
 * `business_date` je DATE („2026-09-23"), ne okamžik. Rozebírá se textově —
 * Date() by ho přečetl v pásmu serveru a u některých hodin posunul o den.
 */
export function denText(businessDate: string): string {
  const [, mesic, den] = businessDate.split("-");
  return `${Number(den)}. ${Number(mesic)}.`;
}

const MESICE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

/** „23. září 2026" — pro hlavičku detailu. */
export function denDlouhy(businessDate: string): string {
  const [rok, mesic, den] = businessDate.split("-");
  return `${Number(den)}. ${MESICE[Number(mesic) - 1] ?? mesic} ${rok}`;
}

/** Iniciály ze jména: „Petr Novák" → „PN". Prázdné jméno → „?". */
export function inicialy(jmeno: string | null | undefined): string {
  const casti = String(jmeno ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (casti.length === 0) return "?";
  const prvni = casti[0][0] ?? "";
  const posledni = casti.length > 1 ? (casti[casti.length - 1][0] ?? "") : "";
  return (prvni + posledni).toUpperCase();
}

/** Položka tak, jak patří do běhu (z verze běhu, nebo živá u starých běhů). */
export type PolozkaBehu = {
  id: string;
  position: number;
  label: string;
  section: string | null;
  instructions: string;
  requires_value: boolean;
  value_type: "number" | "text" | "photo" | null;
  value_unit: string | null;
  min_value: number | null;
  max_value: number | null;
  povinna: boolean;
};

export type ZaznamPolozky = {
  item_id: string;
  checked: boolean;
  nelze_splnit: boolean;
  nelze_splnit_duvod: string;
  value_number: number | null;
  value_text: string | null;
  note: string;
  employee_id: string | null;
  recorded_at: string | null;
  verze: number;
};

/** Položka je vyřešená (pro uzavření): splněná, nebo označená „nelze splnit". */
export function jeVyresena(z: ZaznamPolozky | undefined): boolean {
  return Boolean(z && (z.checked || z.nelze_splnit));
}

/** „0 až 8 °C", „nejvýš 8 °C"… — text mezí pro nápovědu u čísla. */
export function mezeText(p: Pick<PolozkaBehu, "min_value" | "max_value" | "value_unit">): string {
  const j = p.value_unit ? ` ${p.value_unit}` : "";
  if (p.min_value !== null && p.max_value !== null) return `${p.min_value} až ${p.max_value}${j}`;
  if (p.max_value !== null) return `nejvýš ${p.max_value}${j}`;
  if (p.min_value !== null) return `nejméně ${p.min_value}${j}`;
  return p.value_unit ?? "";
}

/** Hodnota zápisu k zobrazení („3,5 °C", text, nebo nic). */
export function hodnotaText(p: Pick<PolozkaBehu, "value_unit">, z: ZaznamPolozky | undefined): string | null {
  if (!z) return null;
  if (z.value_number !== null && z.value_number !== undefined) {
    return `${String(z.value_number).replace(".", ",")}${p.value_unit ? ` ${p.value_unit}` : ""}`;
  }
  if (z.value_text) return z.value_text;
  return null;
}

/**
 * Položky seskupené podle sekce, v pořadí první položky sekce. Položky bez
 * sekce jsou jedna skupina s názvem null (vykreslí se bez nadpisu).
 */
export function podleSekci<T extends { section: string | null; position: number }>(
  polozky: T[],
): { sekce: string | null; polozky: T[] }[] {
  const skupiny = new Map<string, { sekce: string | null; polozky: T[] }>();
  for (const p of [...polozky].sort((a, b) => a.position - b.position)) {
    const klic = (p.section ?? "").trim();
    const s = skupiny.get(klic) ?? { sekce: klic === "" ? null : klic, polozky: [] };
    s.polozky.push(p);
    skupiny.set(klic, s);
  }
  return [...skupiny.values()];
}
