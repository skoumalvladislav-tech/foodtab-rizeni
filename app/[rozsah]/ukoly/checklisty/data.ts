import "server-only";

import { KBELIK_FOTEK, PLATNOST_ODKAZU_FOTEK_S } from "@/lib/checklisty/fotky";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje, tabulkaNeexistuje } from "@/lib/supabase/dotaz";
import type { getServerSupabase } from "@/lib/supabase/server";
import {
  jeVyresena,
  stavBehu,
  type Beh,
  type KlicPohledu,
  type PolozkaBehu,
  type Stav,
  type ZaznamPolozky,
} from "./spolecne";

/**
 * Checklisty — načítání dat (jen server).
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE (pravidlo projektu): po sloučení do
 * main běží nová obrazovka hned, `db push` přijde až po odkliknutí.
 * Každé čtení nových sloupců (20260923110000–190000) proto zkusí plný
 * výběr, a když databáze sloupec nezná, zopakuje se s dnešním schématem.
 * `plne = false` pak obrazovce řekne, že funkce závislé na migraci
 * (fotky, verze, potvrzení…) mají zůstat schované.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;
type Chyba = Parameters<typeof sloupecNeexistuje>[0];
type ChybaDotazu = ConstructorParameters<typeof DotazSelhal>[1];
type Radek = Record<string, unknown>;

const RUN_PLNE =
  "id, template_id, branch_id, business_date, status, started_at, finished_at, due_at, " +
  "assigned_employee_id, completed_by, started_by, shift_label, potvrdil_kym, potvrzeno_kdy, sablona_verze_id";
const RUN_ZAKLAD =
  "id, template_id, branch_id, business_date, status, started_at, finished_at, due_at, " +
  "assigned_employee_id, completed_by";

const TPL_PLNE = "id, name, schedule, usek_id, branch_id, active, dny_v_tydnu, vyzaduje_potvrzeni";
const TPL_ZAKLAD = "id, name, schedule, usek_id, branch_id, active";

const ITEM_PLNE =
  "id, template_id, position, label, section, instructions, requires_value, value_type, " +
  "value_unit, min_value, max_value, povinna, active";
const ITEM_ZAKLAD =
  "id, template_id, position, label, requires_value, value_type, value_unit, min_value, max_value";

const ENTRY_PLNE =
  "run_id, item_id, checked, nelze_splnit, nelze_splnit_duvod, value_number, value_text, note, " +
  "employee_id, recorded_at, verze";
const ENTRY_ZAKLAD = "run_id, item_id, checked, value_number, value_text, employee_id, recorded_at";

/** Plný výběr, a když databáze nový sloupec nezná, dnešní výběr. */
async function tolerantne(
  popis: string,
  dotaz: (sloupce: string) => PromiseLike<{ data: unknown; error: unknown }>,
  plne: string,
  zaklad: string,
): Promise<{ radky: Radek[]; plne: boolean }> {
  let { data, error } = await dotaz(plne);
  let jePlne = true;
  if (error && sloupecNeexistuje(error as Chyba)) {
    jePlne = false;
    ({ data, error } = await dotaz(zaklad));
  }
  if (error) throw new DotazSelhal(popis, error as ChybaDotazu);
  return { radky: (data ?? []) as Radek[], plne: jePlne };
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const cislo = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

function naBeh(r: Radek): Beh {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    branch_id: String(r.branch_id),
    business_date: String(r.business_date),
    status: (r.status as Beh["status"]) ?? "open",
    started_at: text(r.started_at),
    finished_at: text(r.finished_at),
    due_at: text(r.due_at),
    assigned_employee_id: text(r.assigned_employee_id),
    completed_by: text(r.completed_by),
    started_by: text(r.started_by),
    shift_label: text(r.shift_label) ?? "",
    potvrdil_kym: text(r.potvrdil_kym),
    potvrzeno_kdy: text(r.potvrzeno_kdy),
    sablona_verze_id: text(r.sablona_verze_id),
  };
}

function naPolozku(r: Radek): PolozkaBehu {
  const typ = text(r.value_type);
  return {
    id: String(r.id),
    position: Number(r.position ?? 0),
    label: String(r.label ?? ""),
    section: text(r.section),
    instructions: text(r.instructions) ?? "",
    requires_value: r.requires_value === true,
    value_type: typ === "number" || typ === "text" || typ === "photo" ? typ : null,
    value_unit: text(r.value_unit),
    min_value: cislo(r.min_value),
    max_value: cislo(r.max_value),
    povinna: r.povinna === undefined || r.povinna === null ? true : r.povinna === true,
  };
}

function naZaznam(r: Radek): ZaznamPolozky {
  return {
    item_id: String(r.item_id),
    checked: r.checked === true,
    nelze_splnit: r.nelze_splnit === true,
    nelze_splnit_duvod: text(r.nelze_splnit_duvod) ?? "",
    value_number: cislo(r.value_number),
    value_text: text(r.value_text),
    note: text(r.note) ?? "",
    employee_id: text(r.employee_id),
    recorded_at: text(r.recorded_at),
    verze: Number(r.verze ?? 1),
  };
}

/* ======================================================================
   LIDÉ
   ====================================================================== */

export type Lide = {
  /** employee_id → jméno. */
  jmena: Map<string, string>;
  /** user_id (profiles) → jméno — pro `tasks.created_by`. */
  podleUctu: Map<string, string>;
};

/**
 * Jména kolegů.
 *
 * Běžný zaměstnanec tabulku employees nečte (RLS pustí jen vlastní řádek,
 * shifts.read nebo people.manage) — obrazovka by pak u kolegy ukázala
 * „kdosi". Proto se k tomu, co pustí tabulka, přidá public.komu_muzu_psat
 * (jméno + id aktivních kolegů s účtem), stejně jako to dělá Komunikace.
 */
export async function nactiLidi(supabase: Supabase, tenantId: string): Promise<Lide> {
  const jmena = new Map<string, string>();
  const podleUctu = new Map<string, string>();

  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, user_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw new DotazSelhal("lidé", error);
  for (const e of (data ?? []) as Radek[]) {
    jmena.set(String(e.id), String(e.full_name ?? ""));
    if (e.user_id) podleUctu.set(String(e.user_id), String(e.full_name ?? ""));
  }

  const kolegove = await supabase.rpc("komu_muzu_psat", { p_tenant: tenantId });
  if (kolegove.error && !funkceNeexistuje(kolegove.error)) {
    throw new DotazSelhal("kolegové", kolegove.error);
  }
  for (const k of (kolegove.data ?? []) as Radek[]) {
    const id = String(k.employee_id);
    if (!jmena.has(id)) jmena.set(id, String(k.jmeno ?? ""));
  }

  return { jmena, podleUctu };
}

/* ======================================================================
   SEZNAM
   ====================================================================== */

export type Sablona = {
  id: string;
  name: string;
  schedule: string;
  usek_id: string | null;
  branch_id: string | null;
  active: boolean;
  dny_v_tydnu: number[] | null;
  vyzaduje_potvrzeni: boolean;
};

/** Karta seznamu — běh, nebo šablona, která dnes ještě běh nemá. */
export type Karta = {
  klic: string;
  sablona: Sablona;
  usekNazev: string | null;
  beh: Beh | null;
  hotovo: number;
  celkem: number;
  stav: Stav;
};

export type Seznam = {
  den: string | null;
  useky: Map<string, string>;
  sablony: Sablona[];
  karty: Karta[];
  souhrn: { celkem: number; probiha: number; poTerminu: number; hotovo: number };
  celkemHistorie: number;
  /** Nové sloupce z migrací 20260923110000+ jsou v databázi. */
  plne: boolean;
};

export type FiltrSeznamu = {
  pohled: KlicPohledu;
  usek: string | null;
  stav: string | null;
  strana: number;
  /** Jen Historie: konkrétní den (YYYY-MM-DD). */
  den: string | null;
  /** Jen Historie: osoba (přiřazená nebo dokončivší). */
  osoba: string | null;
  /** Jen Historie: šablona. */
  sablona: string | null;
};

export const STRANKA_HISTORIE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Patří šablona podle rozvrhu k dnešnímu dni? (Kvůli pohledu Dnes.) */
function patriKeDni(s: Sablona, den: string): boolean {
  if (s.schedule !== "weekly" && s.schedule !== "selected_days") return true;
  // Bez migrace (dny_v_tydnu neznáme) platí dnešní chování: vše ke spuštění.
  if (s.dny_v_tydnu === null) return true;
  if (s.dny_v_tydnu.length === 0) return false;
  const [r, m, d] = den.split("-").map(Number);
  // Den v týdnu z KALENDÁŘNÍHO data (UTC poledne — nezávislé na pásmu serveru).
  const dow = new Date(Date.UTC(r, m - 1, d, 12)).getUTCDay();
  return s.dny_v_tydnu.includes(dow);
}

export async function nactiSeznam(
  supabase: Supabase,
  tenantId: string,
  branchId: string,
  mujEmployeeId: string | null,
  filtr: FiltrSeznamu,
  ted: number,
): Promise<Seznam> {
  const den = await provozniDen(branchId);

  const { data: usekyData, error: chybaUseky } = await supabase
    .from("useky")
    .select("id, nazev")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("poradi", { ascending: true });
  if (chybaUseky) throw new DotazSelhal("úseky", chybaUseky);
  const useky = new Map(((usekyData ?? []) as Radek[]).map((u) => [String(u.id), String(u.nazev)]));

  // Šablony pobočky a firemní. Pro Šablony a Historii i neaktivní (starý
  // běh vyřazené šablony musí jít otevřít), jinak jen aktivní.
  const sablonyVysledek = await tolerantne(
    "šablony checklistů",
    (sloupce) => {
      let q = supabase
        .from("checklist_templates")
        .select(sloupce)
        .eq("tenant_id", tenantId)
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order("name", { ascending: true });
      if (filtr.pohled !== "sablony" && filtr.pohled !== "historie") q = q.eq("active", true);
      return q;
    },
    TPL_PLNE,
    TPL_ZAKLAD,
  );
  const sablony: Sablona[] = sablonyVysledek.radky.map((s) => ({
    id: String(s.id),
    name: String(s.name),
    schedule: String(s.schedule),
    usek_id: text(s.usek_id),
    branch_id: text(s.branch_id),
    active: s.active !== false,
    dny_v_tydnu: Array.isArray(s.dny_v_tydnu) ? (s.dny_v_tydnu as number[]).map(Number) : null,
    vyzaduje_potvrzeni: s.vyzaduje_potvrzeni === true,
  }));
  const sablonyPodleId = new Map(sablony.map((s) => [s.id, s]));
  const idSablon = sablony.map((s) => s.id);

  const prazdny: Seznam = {
    den,
    useky,
    sablony,
    karty: [],
    souhrn: { celkem: 0, probiha: 0, poTerminu: 0, hotovo: 0 },
    celkemHistorie: 0,
    plne: sablonyVysledek.plne,
  };
  if (!den || idSablon.length === 0) return prazdny;

  /*
    DNEŠNÍ běhy se načtou VŽDYCKY — souhrn (Dnes/Probíhá/Po termínu/Hotovo)
    musí zůstat pravdivý, ať se člověk dívá na Historii s filtrem nebo na
    Moje. Pohled Dnes je zároveň použije jako svá data.
  */
  const dnesni = await tolerantne(
    "dnešní běhy checklistů",
    (sloupce) =>
      supabase
        .from("checklist_runs")
        .select(sloupce)
        .eq("branch_id", branchId)
        .in("template_id", idSablon)
        .eq("business_date", den),
    RUN_PLNE,
    RUN_ZAKLAD,
  );
  const behyDnes = dnesni.radky.map(naBeh);
  let plne = sablonyVysledek.plne && dnesni.plne;

  let behy: Beh[] = behyDnes;
  let celkemHistorie = 0;

  if (filtr.pohled === "vse") {
    // Všechno rozdělané bez ohledu na den (i zbytky z minulých dnů) + dnešek.
    const v = await tolerantne(
      "rozdělané běhy checklistů",
      (sloupce) =>
        supabase
          .from("checklist_runs")
          .select(sloupce)
          .eq("branch_id", branchId)
          .in("template_id", idSablon)
          .or(`status.eq.open,business_date.eq.${den}`)
          .order("business_date", { ascending: false })
          .limit(100),
      RUN_PLNE,
      RUN_ZAKLAD,
    );
    behy = v.radky.map(naBeh);
  } else if (filtr.pohled === "moje") {
    if (!mujEmployeeId) {
      // Bez vlastního zaměstnaneckého záznamu nemůže mít nic přiřazeno.
      behy = [];
    } else {
      const v = await tolerantne(
        "moje běhy checklistů",
        (sloupce) =>
          supabase
            .from("checklist_runs")
            .select(sloupce)
            .eq("branch_id", branchId)
            .in("template_id", idSablon)
            .eq("assigned_employee_id", mujEmployeeId)
            .or(`status.eq.open,business_date.eq.${den}`)
            .order("business_date", { ascending: false })
            .limit(100),
        RUN_PLNE,
        RUN_ZAKLAD,
      );
      behy = v.radky.map(naBeh);
    }
  } else if (filtr.pohled === "historie") {
    const odSkryt = (filtr.strana - 1) * STRANKA_HISTORIE;
    const denFiltr = filtr.den && DATUM.test(filtr.den) ? filtr.den : null;
    const sablonaFiltr = filtr.sablona && UUID.test(filtr.sablona) ? filtr.sablona : null;
    const osobaFiltr = filtr.osoba && UUID.test(filtr.osoba) ? filtr.osoba : null;

    const v = await tolerantne(
      "historie checklistů",
      (sloupce) => {
        let q = supabase
          .from("checklist_runs")
          .select(sloupce)
          .eq("branch_id", branchId)
          .in("template_id", idSablon)
          .neq("business_date", den);
        if (denFiltr) q = q.eq("business_date", denFiltr);
        if (sablonaFiltr) q = q.eq("template_id", sablonaFiltr);
        if (osobaFiltr) q = q.or(`assigned_employee_id.eq.${osobaFiltr},completed_by.eq.${osobaFiltr}`);
        return q.order("business_date", { ascending: false }).range(odSkryt, odSkryt + STRANKA_HISTORIE - 1);
      },
      RUN_PLNE,
      RUN_ZAKLAD,
    );
    behy = v.radky.map(naBeh);

    let pocet = supabase
      .from("checklist_runs")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .in("template_id", idSablon)
      .neq("business_date", den);
    if (denFiltr) pocet = pocet.eq("business_date", denFiltr);
    if (sablonaFiltr) pocet = pocet.eq("template_id", sablonaFiltr);
    if (osobaFiltr) pocet = pocet.or(`assigned_employee_id.eq.${osobaFiltr},completed_by.eq.${osobaFiltr}`);
    const { count, error } = await pocet;
    if (error) throw new DotazSelhal("počet v historii", error);
    celkemHistorie = count ?? 0;
  }

  /* --- Hotovo/celkem: záznamy a verze běhů --------------------------- */

  const vsechnyBehy = [...new Map([...behy, ...behyDnes].map((b) => [b.id, b])).values()];
  const idBehu = vsechnyBehy.map((b) => b.id);

  const hotovoVBehu = new Map<string, number>();
  if (idBehu.length > 0) {
    const { data, error } = await supabase
      .from("checklist_entries")
      .select("run_id, checked")
      .in("run_id", idBehu);
    if (error) throw new DotazSelhal("odškrtnuté položky", error);
    for (const z of (data ?? []) as Radek[]) {
      if (z.checked !== true) continue;
      const r = String(z.run_id);
      hotovoVBehu.set(r, (hotovoVBehu.get(r) ?? 0) + 1);
    }
  }

  // Počet položek: běh s verzí má počet z verze (nemění se s šablonou),
  // šablona bez běhu (a starý běh bez verze) živé aktivní položky.
  const polozekVeVerzi = new Map<string, number>();
  const idVerzi = [...new Set(vsechnyBehy.map((b) => b.sablona_verze_id).filter((v): v is string => Boolean(v)))];
  if (plne && idVerzi.length > 0) {
    const { data, error } = await supabase
      .from("checklist_sablona_verze")
      .select("id, polozky")
      .in("id", idVerzi);
    if (error) {
      if (!tabulkaNeexistuje(error)) throw new DotazSelhal("verze šablon", error);
    } else {
      for (const v of (data ?? []) as Radek[]) {
        polozekVeVerzi.set(String(v.id), Array.isArray(v.polozky) ? v.polozky.length : 0);
      }
    }
  }

  const polozekVSablone = new Map<string, number>();
  {
    const v = await tolerantne(
      "položky checklistu",
      (sloupce) => supabase.from("checklist_items").select(sloupce).in("template_id", idSablon),
      "id, template_id, active",
      "id, template_id",
    );
    for (const p of v.radky) {
      if (p.active === false) continue;
      const t = String(p.template_id);
      polozekVSablone.set(t, (polozekVSablone.get(t) ?? 0) + 1);
    }
    plne = plne && v.plne;
  }

  const karta = (s: Sablona, b: Beh | null): Karta => {
    const hotovo = b ? (hotovoVBehu.get(b.id) ?? 0) : 0;
    const celkem =
      b?.sablona_verze_id && polozekVeVerzi.has(b.sablona_verze_id)
        ? (polozekVeVerzi.get(b.sablona_verze_id) ?? 0)
        : (polozekVSablone.get(s.id) ?? 0);
    return {
      klic: b ? b.id : s.id,
      sablona: s,
      usekNazev: s.usek_id ? (useky.get(s.usek_id) ?? null) : null,
      beh: b,
      hotovo,
      celkem,
      stav: stavBehu(b, hotovo, ted),
    };
  };

  /* --- Karty podle pohledu ------------------------------------------ */

  const dnesPodleSablony = new Map(behyDnes.map((b) => [b.template_id, b]));
  const kartyDnes: Karta[] = sablony
    .filter((s) => s.active)
    .filter((s) => dnesPodleSablony.has(s.id) || patriKeDni(s, den))
    .map((s) => karta(s, dnesPodleSablony.get(s.id) ?? null));

  let karty: Karta[];
  if (filtr.pohled === "dnes") {
    karty = kartyDnes;
  } else if (filtr.pohled === "sablony") {
    karty = sablony.map((s) => karta(s, dnesPodleSablony.get(s.id) ?? null));
  } else {
    karty = behy
      .map((b) => {
        const s = sablonyPodleId.get(b.template_id);
        return s ? karta(s, b) : null;
      })
      .filter((k): k is Karta => k !== null);
  }

  if (filtr.usek) karty = karty.filter((k) => k.sablona.usek_id === filtr.usek);
  if (filtr.stav && filtr.stav !== "vse") karty = karty.filter((k) => k.stav === filtr.stav);

  const souhrn = {
    celkem: kartyDnes.length,
    probiha: kartyDnes.filter((k) => k.stav === "probiha").length,
    poTerminu: kartyDnes.filter((k) => k.stav === "poterminu").length,
    hotovo: kartyDnes.filter((k) => k.stav === "hotovo" || k.stav === "vyhrady").length,
  };

  return { den, useky, sablony, karty, souhrn, celkemHistorie, plne };
}

/* ======================================================================
   MOJE CHECKLISTY (pro Dnes)
   ====================================================================== */

export type MujChecklist = {
  id: string;
  nazev: string;
  pobockaId: string;
  hotovo: number;
  celkem: number;
  dueAt: string | null;
  stav: Stav;
};

/**
 * Otevřené běhy přiřazené mně (zadání bod 33: „Dnes → Moje checklisty",
 * ať člověk nemusí chodit do modulu). Jen otevřené — hotové na Dnes
 * nepatří. Bez vlastního zaměstnaneckého záznamu nic.
 */
export async function nactiMojeChecklisty(
  supabase: Supabase,
  tenantId: string,
  mujEmployeeId: string,
  ted: number,
): Promise<MujChecklist[]> {
  const behy = await tolerantne(
    "moje checklisty",
    (sloupce) =>
      supabase
        .from("checklist_runs")
        .select(sloupce)
        .eq("tenant_id", tenantId)
        .eq("assigned_employee_id", mujEmployeeId)
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(6),
    RUN_PLNE,
    RUN_ZAKLAD,
  );
  const radky = behy.radky.map(naBeh);
  if (radky.length === 0) return [];

  const idSablon = [...new Set(radky.map((b) => b.template_id))];
  const [{ data: tpl, error: e1 }, { data: zaznamy, error: e2 }] = await Promise.all([
    supabase.from("checklist_templates").select("id, name").in("id", idSablon),
    supabase.from("checklist_entries").select("run_id, checked").in("run_id", radky.map((b) => b.id)),
  ]);
  if (e1) throw new DotazSelhal("šablony mých checklistů", e1);
  if (e2) throw new DotazSelhal("záznamy mých checklistů", e2);
  const nazvy = new Map(((tpl ?? []) as Radek[]).map((t) => [String(t.id), String(t.name)]));
  const hotovo = new Map<string, number>();
  for (const z of (zaznamy ?? []) as Radek[]) {
    if (z.checked === true) hotovo.set(String(z.run_id), (hotovo.get(String(z.run_id)) ?? 0) + 1);
  }

  const celkem = new Map<string, number>();
  const idVerzi = radky.map((b) => b.sablona_verze_id).filter((v): v is string => Boolean(v));
  if (behy.plne && idVerzi.length > 0) {
    const { data, error } = await supabase.from("checklist_sablona_verze").select("id, polozky").in("id", idVerzi);
    if (!error) {
      for (const v of (data ?? []) as Radek[]) celkem.set(String(v.id), Array.isArray(v.polozky) ? v.polozky.length : 0);
    }
  }
  const { data: polozky } = await supabase.from("checklist_items").select("template_id").in("template_id", idSablon);
  const zivych = new Map<string, number>();
  for (const p of (polozky ?? []) as Radek[]) zivych.set(String(p.template_id), (zivych.get(String(p.template_id)) ?? 0) + 1);

  return radky.map((b) => {
    const h = hotovo.get(b.id) ?? 0;
    return {
      id: b.id,
      nazev: nazvy.get(b.template_id) ?? "Checklist",
      pobockaId: b.branch_id,
      hotovo: h,
      celkem: b.sablona_verze_id && celkem.has(b.sablona_verze_id) ? (celkem.get(b.sablona_verze_id) ?? 0) : (zivych.get(b.template_id) ?? 0),
      dueAt: b.due_at,
      stav: stavBehu(b, h, ted),
    };
  });
}

/* ======================================================================
   DETAIL BĚHU
   ====================================================================== */

export type Fotka = {
  id: string;
  itemId: string;
  cesta: string;
  nazev: string;
  url: string | null;
  employeeId: string | null;
  kdy: string;
};

export type Detail = {
  beh: Beh;
  sablona: Sablona;
  usekNazev: string | null;
  polozky: PolozkaBehu[];
  zaznamy: Map<string, ZaznamPolozky>;
  fotky: Map<string, Fotka[]>;
  /** Nové sloupce a funkce z migrací jsou v databázi. */
  plne: boolean;
  fotkyDostupne: boolean;
  hotovo: number;
  nevyresenychPovinnych: number;
};

export async function nactiDetail(
  supabase: Supabase,
  tenantId: string,
  behId: string,
): Promise<Detail | null> {
  if (!UUID.test(behId)) return null;

  const behVysledek = await tolerantne(
    "běh checklistu",
    (sloupce) => supabase.from("checklist_runs").select(sloupce).eq("id", behId).eq("tenant_id", tenantId).limit(1),
    RUN_PLNE,
    RUN_ZAKLAD,
  );
  // RLS vrátí prázdno i tehdy, když běh existuje, ale nepatří nám —
  // „není" a „není váš" se schválně nerozlišuje.
  const behRadek = behVysledek.radky[0];
  if (!behRadek) return null;
  const beh = naBeh(behRadek);
  let plne = behVysledek.plne;

  const tplVysledek = await tolerantne(
    "šablona checklistu",
    (sloupce) => supabase.from("checklist_templates").select(sloupce).eq("id", beh.template_id).limit(1),
    TPL_PLNE,
    TPL_ZAKLAD,
  );
  const t = tplVysledek.radky[0] ?? {};
  const sablona: Sablona = {
    id: beh.template_id,
    name: String(t.name ?? "Checklist"),
    schedule: String(t.schedule ?? ""),
    usek_id: text(t.usek_id),
    branch_id: text(t.branch_id),
    active: t.active !== false,
    dny_v_tydnu: Array.isArray(t.dny_v_tydnu) ? (t.dny_v_tydnu as number[]).map(Number) : null,
    vyzaduje_potvrzeni: t.vyzaduje_potvrzeni === true,
  };
  plne = plne && tplVysledek.plne;

  let usekNazev: string | null = null;
  if (sablona.usek_id) {
    const { data, error } = await supabase.from("useky").select("nazev").eq("id", sablona.usek_id).limit(1);
    if (error) throw new DotazSelhal("úsek", error);
    usekNazev = text((data?.[0] as Radek | undefined)?.nazev) ?? null;
  }

  /* --- Záznamy ------------------------------------------------------ */

  const zaznamyVysledek = await tolerantne(
    "záznamy checklistu",
    (sloupce) => supabase.from("checklist_entries").select(sloupce).eq("run_id", beh.id),
    ENTRY_PLNE,
    ENTRY_ZAKLAD,
  );
  const zaznamy = new Map(zaznamyVysledek.radky.map((r) => [String(r.item_id), naZaznam(r)]));
  plne = plne && zaznamyVysledek.plne;

  /* --- Položky: z verze běhu, jinak živé ------------------------------ */

  let polozky: PolozkaBehu[] | null = null;
  if (beh.sablona_verze_id) {
    const { data, error } = await supabase
      .from("checklist_sablona_verze")
      .select("polozky")
      .eq("id", beh.sablona_verze_id)
      .limit(1);
    if (error && !tabulkaNeexistuje(error)) throw new DotazSelhal("verze šablony", error);
    const snimek = (data?.[0] as Radek | undefined)?.polozky;
    if (Array.isArray(snimek)) polozky = (snimek as Radek[]).map(naPolozku);
  }
  if (!polozky) {
    const v = await tolerantne(
      "položky checklistu",
      (sloupce) =>
        supabase.from("checklist_items").select(sloupce).eq("template_id", beh.template_id).order("position"),
      ITEM_PLNE,
      ITEM_ZAKLAD,
    );
    // Starý běh bez verze: aktivní položky + vyřazené, které v běhu už mají
    // záznam (ať z historie nezmizí, co se opravdu kontrolovalo).
    polozky = v.radky
      .filter((r) => r.active !== false || zaznamy.has(String(r.id)))
      .map(naPolozku);
    plne = plne && v.plne;
  }
  polozky.sort((a, b) => a.position - b.position);

  /* --- Fotky -------------------------------------------------------- */

  const fotky = new Map<string, Fotka[]>();
  let fotkyDostupne = plne;
  if (plne) {
    const { data, error } = await supabase
      .from("checklist_polozka_fotky")
      .select("id, item_id, cesta, nazev, employee_id, vytvoreno_kdy")
      .eq("run_id", beh.id)
      .order("vytvoreno_kdy", { ascending: true });
    if (error) {
      if (!tabulkaNeexistuje(error)) throw new DotazSelhal("fotky checklistu", error);
      fotkyDostupne = false;
    } else {
      const radky = (data ?? []) as Radek[];
      const odkazy = new Map<string, string>();
      if (radky.length > 0) {
        // Kbelík je soukromý — přímá adresa nefunguje, jen podepsaný odkaz.
        const { data: podepsane } = await supabase.storage
          .from(KBELIK_FOTEK)
          .createSignedUrls(radky.map((r) => String(r.cesta)), PLATNOST_ODKAZU_FOTEK_S);
        for (const p of podepsane ?? []) {
          if (p.path && p.signedUrl) odkazy.set(p.path, p.signedUrl);
        }
      }
      for (const r of radky) {
        const itemId = String(r.item_id);
        const seznam = fotky.get(itemId) ?? [];
        seznam.push({
          id: String(r.id),
          itemId,
          cesta: String(r.cesta),
          nazev: String(r.nazev ?? "fotka"),
          url: odkazy.get(String(r.cesta)) ?? null,
          employeeId: text(r.employee_id),
          kdy: String(r.vytvoreno_kdy),
        });
        fotky.set(itemId, seznam);
      }
    }
  }

  const hotovo = polozky.filter((p) => zaznamy.get(p.id)?.checked).length;
  const nevyresenychPovinnych = polozky.filter((p) => p.povinna && !jeVyresena(zaznamy.get(p.id))).length;

  return { beh, sablona, usekNazev, polozky, zaznamy, fotky, plne, fotkyDostupne, hotovo, nevyresenychPovinnych };
}

/* ======================================================================
   SOUVISEJÍCÍ ÚKOLY A AKTIVITA
   ====================================================================== */

export type SouvisejiciUkol = {
  id: string;
  nazev: string;
  stav: string;
  priorita: string;
  termin: string | null;
  polozkaId: string | null;
  komu: string | null;
  vytvoreno: string;
  autor: string | null;
};

export async function nactiSouvisejici(
  supabase: Supabase,
  tenantId: string,
  behId: string,
  lide: Lide,
): Promise<SouvisejiciUkol[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, priority, due_at, checklist_item_id, employee_id, usek_id, position_id, created_at, created_by")
    .eq("tenant_id", tenantId)
    .eq("checklist_run_id", behId)
    .order("created_at", { ascending: false });
  if (error) {
    // Vazba úkol → checklist je od 22. 9.; bez ní prostě nic nesouvisí.
    if (sloupecNeexistuje(error)) return [];
    throw new DotazSelhal("úkoly z checklistu", error);
  }
  const radky = (data ?? []) as Radek[];
  if (radky.length === 0) return [];

  const [{ data: usekyData }, { data: poziceData }] = await Promise.all([
    supabase.from("useky").select("id, nazev").eq("tenant_id", tenantId),
    supabase.from("positions").select("id, label").eq("tenant_id", tenantId),
  ]);
  const useky = new Map(((usekyData ?? []) as Radek[]).map((u) => [String(u.id), String(u.nazev)]));
  const pozice = new Map(((poziceData ?? []) as Radek[]).map((p) => [String(p.id), String(p.label)]));

  return radky.map((u) => ({
    id: String(u.id),
    nazev: String(u.title),
    stav: String(u.status),
    priorita: String(u.priority),
    termin: text(u.due_at),
    polozkaId: text(u.checklist_item_id),
    // Jeden cíl na úkol (tasks_jeden_cil) — stejné pořadí jako na /ukoly.
    komu: u.usek_id
      ? (useky.get(String(u.usek_id)) ?? "úsek")
      : u.position_id
        ? (pozice.get(String(u.position_id)) ?? "pozice")
        : u.employee_id
          ? (lide.jmena.get(String(u.employee_id)) ?? "konkrétní člověk")
          : null,
    vytvoreno: String(u.created_at),
    autor: u.created_by ? (lide.podleUctu.get(String(u.created_by)) ?? null) : null,
  }));
}

export type Udalost = {
  klic: string;
  kdy: string;
  kdo: string | null;
  text: string;
  ton: "dobre" | "bad" | "pozor" | "neutral";
  /** Úkol, na který událost odkazuje (nahlášený problém). */
  ukol?: { id: string; nazev: string };
};

/**
 * Časová osa běhu — složená z toho, co v datech JE: spuštění, zápisy
 * položek, fotky, nahlášené problémy (úkoly), uzavření, potvrzení.
 *
 * ČESTNĚ: záznam položky drží jen POSLEDNÍ stav (upsert), takže osa
 * ukazuje, kdo položku naposledy splnil/vrátil, ne celou historii
 * přepisů. Ta je v auditu (app.audit_checklist_potomek), kam běžný
 * zaměstnanec nevidí.
 *
 * Slovesa bez rodu („Splněno: …", ne „dokončila …") — z jména se rod
 * nepozná a hádat ho nebudeme.
 */
export function sestavAktivitu(detail: Detail, ukoly: SouvisejiciUkol[], lide: Lide): Udalost[] {
  const jmeno = (id: string | null) => (id ? (lide.jmena.get(id) ?? null) : null);
  const nazvy = new Map(detail.polozky.map((p) => [p.id, p.label]));
  const udalosti: Udalost[] = [];
  const b = detail.beh;

  if (b.started_at) {
    udalosti.push({ klic: "start", kdy: b.started_at, kdo: jmeno(b.started_by), text: "Checklist zahájen", ton: "neutral" });
  }
  for (const [itemId, z] of detail.zaznamy) {
    if (!z.recorded_at) continue;
    const nazev = nazvy.get(itemId) ?? "položka";
    if (z.checked) {
      udalosti.push({ klic: `z-${itemId}`, kdy: z.recorded_at, kdo: jmeno(z.employee_id), text: `Splněno: ${nazev}`, ton: "dobre" });
    } else if (z.nelze_splnit) {
      udalosti.push({
        klic: `z-${itemId}`,
        kdy: z.recorded_at,
        kdo: jmeno(z.employee_id),
        text: `Nelze splnit: ${nazev}${z.nelze_splnit_duvod ? ` — ${z.nelze_splnit_duvod}` : ""}`,
        ton: "bad",
      });
    } else {
      udalosti.push({ klic: `z-${itemId}`, kdy: z.recorded_at, kdo: jmeno(z.employee_id), text: `Vráceno: ${nazev}`, ton: "pozor" });
    }
  }
  for (const [itemId, seznam] of detail.fotky) {
    for (const f of seznam) {
      udalosti.push({ klic: `f-${f.id}`, kdy: f.kdy, kdo: jmeno(f.employeeId), text: `Fotka: ${nazvy.get(itemId) ?? "položka"}`, ton: "neutral" });
    }
  }
  for (const u of ukoly) {
    udalosti.push({
      klic: `u-${u.id}`,
      kdy: u.vytvoreno,
      kdo: u.autor,
      text: u.polozkaId ? `Nahlášen problém: ${nazvy.get(u.polozkaId) ?? "položka"}` : "Nahlášen problém",
      ton: "bad",
      ukol: { id: u.id, nazev: u.nazev },
    });
  }
  if (b.finished_at && b.status !== "open") {
    udalosti.push({
      klic: "konec",
      kdy: b.finished_at,
      kdo: jmeno(b.completed_by),
      text: b.status === "completed_with_issues" ? "Checklist uzavřen s výhradami" : "Checklist uzavřen",
      ton: b.status === "completed_with_issues" ? "bad" : "dobre",
    });
  }
  if (b.potvrzeno_kdy) {
    udalosti.push({ klic: "potvrzeni", kdy: b.potvrzeno_kdy, kdo: jmeno(b.potvrdil_kym), text: "Potvrzeno vedoucím", ton: "dobre" });
  }

  // Nejnovější nahoře (jako ve vzoru mockupu).
  return udalosti.sort((a, c) => (a.kdy < c.kdy ? 1 : a.kdy > c.kdy ? -1 : 0));
}
