import Link from "next/link";
import { redirect } from "next/navigation";

import { datetimeLocalVPasmu, hodinaVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal, sloupecNeexistuje } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { nastavitOdpovednost, uzavritChecklist, zapsatPolozku } from "../akce";
import { STAV_BARVA, STAV_POPIS, stavKarty, terazMs, type Beh } from "../checklisty";

export const dynamic = "force-dynamic";

/**
 * Vyplňování jednoho checklistu.
 *
 * Položka s `requires_value` chce hodnotu — čísla se hlídají proti
 * `min_value` a `max_value`. Meze se ale kontrolují v akci na serveru,
 * kde se čtou z databáze; tady se jen předvyplní do políčka, aby se
 * uživatel netrefoval naslepo.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE (pravidlo projektu, stejně jako
 * checklisty.tsx). Sloupce due_at/assigned_employee_id/completed_by
 * (20260923100000) se čtou tolerantně — chybí-li, karta „Odpovědný“
 * se schová, zbytek obrazovky se vykreslí beze změny.
 */

type Polozka = {
  id: string;
  position: number;
  label: string;
  requires_value: boolean;
  value_type: string | null;
  value_unit: string | null;
  min_value: number | null;
  max_value: number | null;
};

type Zaznam = {
  item_id: string;
  checked: boolean;
  value_number: number | null;
  value_text: string | null;
  employee_id: string | null;
  recorded_at: string | null;
};

type Run = Beh & { branch_id: string };

const SLOUPCE_PLNE = "id, template_id, branch_id, business_date, status, due_at, assigned_employee_id, completed_by";
const SLOUPCE_ZAKLAD = "id, template_id, branch_id, business_date, status";

export default async function VyplnitChecklist({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string }>;
  searchParams: Promise<{ polozka?: string; chyba?: string }>;
}) {
  const { rozsah, beh } = await params;
  const { polozka: chybnaPolozka, chyba } = await searchParams;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "tasks.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na checklisty vaše oprávnění nedosáhne.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  // `sloupce: string` (ne literál) schválně — jinak by Supabase klient
  // odvodil ze dvou různých `.select()` volání dva neslučitelné typy
  // a fallback níž by nešel typově přiřadit zpátky do stejné proměnné.
  const nactiBeh = (sloupce: string): PromiseLike<{ data: unknown; error: unknown }> =>
    supabase.from("checklist_runs").select(sloupce).eq("id", beh).limit(1);

  let odpovednostDostupna = true;
  let { data: behy, error: chybaBehy } = await nactiBeh(SLOUPCE_PLNE);
  if (chybaBehy && sloupecNeexistuje(chybaBehy as Parameters<typeof sloupecNeexistuje>[0])) {
    odpovednostDostupna = false;
    ({ data: behy, error: chybaBehy } = await nactiBeh(SLOUPCE_ZAKLAD));
  }
  if (chybaBehy) throw new DotazSelhal("běhy checklistů", chybaBehy as ConstructorParameters<typeof DotazSelhal>[1]);

  const runRaw = (behy as Record<string, unknown>[] | null)?.[0];

  // RLS vrátí prázdno i tehdy, když běh existuje, ale nepatří nám.
  // Rozdíl mezi „není“ a „není váš“ schválně nerozlišujeme.
  if (!runRaw) {
    return (
      <Sdeleni nadpis="Checklist nenalezen">
        Buď neexistuje, nebo není váš. Vraťte se na seznam úkolů.
      </Sdeleni>
    );
  }

  const run: Run = {
    id: runRaw.id as string,
    template_id: runRaw.template_id as string,
    branch_id: runRaw.branch_id as string,
    business_date: runRaw.business_date as string,
    status: runRaw.status as "open" | "done",
    due_at: (runRaw.due_at as string | undefined) ?? null,
    assigned_employee_id: (runRaw.assigned_employee_id as string | undefined) ?? null,
    completed_by: (runRaw.completed_by as string | undefined) ?? null,
  };

  const { data: sablony, error: chybaSablony } = await supabase
    .from("checklist_templates")
    .select("id, name")
    .eq("id", run.template_id)
    .limit(1);
  if (chybaSablony) throw new DotazSelhal("šablony checklistů", chybaSablony);
  const nazev = (sablony?.[0]?.name as string | undefined) ?? "Checklist";

  const { data: polozkyData, error: chybaPolozkyData } = await supabase
    .from("checklist_items")
    .select(
      "id, position, label, requires_value, value_type, value_unit, min_value, max_value",
    )
    .eq("template_id", run.template_id)
    .order("position", { ascending: true });
  if (chybaPolozkyData) throw new DotazSelhal("položky checklistu", chybaPolozkyData);

  const polozky = (polozkyData ?? []) as Polozka[];

  // Kdo smí zadávat úkoly na téhle pobočce, smí z checklistu nahlásit
  // problém i upravit „Odpovědný/do kdy“ — stejné právo jako u „Zadat úkol“
  // na /ukoly (obojí je plánování práce, ne odškrtávání položek).
  const smiZadatUkol = await hasAccess(tenantId, "tasks.manage", run.branch_id);

  const { data: zaznamyData, error: chybaZaznamyData } = await supabase
    .from("checklist_entries")
    .select("item_id, checked, value_number, value_text, employee_id, recorded_at")
    .eq("run_id", run.id);
  if (chybaZaznamyData) throw new DotazSelhal("odškrtnuté položky", chybaZaznamyData);

  const zaznamy = new Map<string, Zaznam>();
  for (const z of (zaznamyData ?? []) as Zaznam[]) zaznamy.set(z.item_id, z);

  const { data: lideData, error: chybaLide } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (chybaLide) throw new DotazSelhal("lidé", chybaLide);
  const jmenaLidi = new Map((lideData ?? []).map((l) => [l.id as string, String(l.full_name)]));

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const hotovo = polozky.filter((p) => zaznamy.get(p.id)?.checked).length;
  const vseHotovo = polozky.length > 0 && hotovo === polozky.length;
  const uzavreno = run.status === "done";

  const stav = stavKarty({ beh: run, hotovo }, terazMs());
  const barva = STAV_BARVA[stav];
  const procenta = polozky.length > 0 ? Math.round((hotovo / polozky.length) * 100) : 0;
  const jmenoOdpovedneho = run.assigned_employee_id ? (jmenaLidi.get(run.assigned_employee_id) ?? null) : null;
  const jmenoDokoncil = run.completed_by ? (jmenaLidi.get(run.completed_by) ?? null) : null;

  return (
    <div style={{ padding: "16px", paddingBottom: "32px" }}>
      <Link
        href={`/${rozsah}/ukoly#checklisty`}
        style={{ fontSize: "14px", color: "var(--accent)" }}
      >
        ← Zpět na úkoly
      </Link>

      <Nadpis
        oci="Checklist"
        popis={`${hotovo} z ${polozky.length} hotovo`}
        vpravo={
          smiZadatUkol ? (
            <Link href={`/${rozsah}/ukoly/${run.id}/problem`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
              Nahlásit problém
            </Link>
          ) : undefined
        }
      >
        {nazev}
      </Nadpis>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
        <span style={{ ...stavStitek, background: barva.bg, color: barva.fg }}>{STAV_POPIS[stav]}</span>
      </div>

      {polozky.length > 0 ? (
        <div style={{ marginTop: "10px" }}>
          <div style={progressPozadi}>
            <div style={{ ...progressVypln, width: `${procenta}%`, background: barva.fg }} />
          </div>
        </div>
      ) : null}

      {odpovednostDostupna ? (
        <div style={odpovednostKarta}>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>Odpovědný</p>
          {!uzavreno && smiZadatUkol ? (
            <form
              action={nastavitOdpovednost}
              style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
            >
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="beh" value={run.id} />
              <select name="komu" defaultValue={run.assigned_employee_id ?? ""} style={mikroVyber} aria-label="Odpovědný">
                <option value="">Nepřiřazeno</option>
                {[...jmenaLidi].map(([id, jmeno]) => (
                  <option key={id} value={id}>{jmeno}</option>
                ))}
              </select>
              <input
                type="datetime-local"
                name="doKdy"
                defaultValue={run.due_at ? datetimeLocalVPasmu(run.due_at, ZONA_VYCHOZI) : ""}
                style={mikroVyber}
                aria-label="Do kdy"
              />
              <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">Uložit</button>
            </form>
          ) : (
            <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--ink)" }}>
              {jmenoOdpovedneho ?? "Nepřiřazeno"}
              {run.due_at ? ` · do ${hodinaVPasmu(run.due_at, ZONA_VYCHOZI)}` : ""}
            </p>
          )}
          {uzavreno && jmenoDokoncil ? (
            <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
              Dokončil: {jmenoDokoncil}
            </p>
          ) : null}
          {chyba === "odpovednost" ? (
            <p role="alert" style={{ margin: "8px 0 0", fontSize: "13px", color: "var(--bad)" }}>
              Odpovědnost se nepodařilo uložit.
            </p>
          ) : null}
        </div>
      ) : null}

      {polozky.length === 0 ? (
        <p style={{ margin: "16px 0 0", fontSize: "14px", color: "var(--muted)" }}>
          Checklist nemá žádné položky.
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: "10px" }}>
          {polozky.map((p) => {
            const z = zaznamy.get(p.id);
            const splneno = z?.checked === true;
            const jeFoto = p.requires_value && p.value_type === "photo";
            const jmenoZapsal = z?.employee_id ? (jmenaLidi.get(z.employee_id) ?? null) : null;

            return (
              <li
                key={p.id}
                style={{
                  background: splneno ? "var(--branch-soft)" : "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px",
                }}
              >
                <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                  {splneno ? "✓ " : ""}
                  {p.label}
                </p>

                {splneno ? (
                  <>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: "13px",
                        color: "var(--good)",
                      }}
                    >
                      {z?.value_number !== null && z?.value_number !== undefined
                        ? `${z.value_number}${p.value_unit ? ` ${p.value_unit}` : ""}`
                        : (z?.value_text ?? "odškrtnuto")}
                    </p>
                    {jmenoZapsal || z?.recorded_at ? (
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                        {[jmenoZapsal, z?.recorded_at ? hodinaVPasmu(z.recorded_at, ZONA_VYCHOZI) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </>
                ) : jeFoto ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: "13px",
                      color: "var(--warn)",
                    }}
                  >
                    Položka chce fotku. Nahrávání souborů zatím není hotové.
                  </p>
                ) : uzavreno ? null : (
                  <form
                    action={zapsatPolozku}
                    style={{
                      marginTop: "10px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="beh" value={run.id} />
                    <input type="hidden" name="polozka" value={p.id} />

                    {p.requires_value ? (
                      <input
                        name="hodnota"
                        required
                        inputMode={
                          p.value_type === "number" ? "decimal" : "text"
                        }
                        type={p.value_type === "number" ? "number" : "text"}
                        step={p.value_type === "number" ? "any" : undefined}
                        min={p.min_value ?? undefined}
                        max={p.max_value ?? undefined}
                        placeholder={
                          p.value_type === "number"
                            ? mezeText(p)
                            : "Zapište hodnotu"
                        }
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: "10px 12px",
                          fontSize: "16px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--line)",
                          background: "var(--paper)",
                          color: "var(--ink)",
                        }}
                      />
                    ) : null}

                    <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                      {p.requires_value ? "Zapsat" : "Odškrtnout"}
                    </button>
                  </form>
                )}

                {smiZadatUkol ? (
                  <p style={{ margin: "8px 0 0" }}>
                    <Link
                      href={`/${rozsah}/ukoly/${run.id}/problem?polozka=${p.id}`}
                      style={{ fontSize: "12.5px", color: "var(--muted)" }}
                    >
                      Nahlásit problém u téhle položky →
                    </Link>
                  </p>
                ) : null}

                {chybnaPolozka === p.id && chyba ? (
                  <p
                    role="alert"
                    style={{
                      margin: "8px 0 0",
                      fontSize: "13px",
                      color: "var(--bad)",
                    }}
                  >
                    {popisChyby(chyba, p)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {vseHotovo && !uzavreno ? (
        <form action={uzavritChecklist} style={{ marginTop: "20px" }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="beh" value={run.id} />
          <button
            type="submit"
            className="ft-tl ft-tl-hlavni"
            style={{ width: "100%" }}
          >
            Uzavřít checklist
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Hláška z ?chyba= u dotčené položky.
 *
 * Meze se skládají z položky samotné, ne z adresy — v adrese je jen
 * důvod, takže se do hlášky nedá podstrčit cizí text.
 */
function popisChyby(kod: string, p: Polozka): string {
  switch (kod) {
    case "meze":
      return `Hodnota je mimo povolený rozsah: ${mezeText(p)}.`;
    case "cislo":
      return "Zapište prosím číslo.";
    case "prazdna":
      return "Tahle položka chce hodnotu.";
    case "foto":
      return "Položka chce fotku. Nahrávání souborů zatím není hotové.";
    default:
      return "Hodnotu se nepodařilo zapsat.";
  }
}

function mezeText(p: Polozka): string {
  const jednotka = p.value_unit ? ` ${p.value_unit}` : "";
  if (p.min_value !== null && p.max_value !== null)
    return `${p.min_value} až ${p.max_value}${jednotka}`;
  if (p.max_value !== null) return `nejvýš ${p.max_value}${jednotka}`;
  if (p.min_value !== null) return `nejméně ${p.min_value}${jednotka}`;
  return `Hodnota${jednotka}`;
}

/* --- styly ----------------------------------------------------------- */

const stavStitek = {
  flex: "none",
  padding: "3px 9px",
  borderRadius: "999px",
  fontSize: "11.5px",
  fontWeight: 700,
  whiteSpace: "nowrap",
} as const;

const progressPozadi = {
  height: "6px",
  borderRadius: "999px",
  background: "var(--sunken)",
  overflow: "hidden",
} as const;

const progressVypln = {
  height: "100%",
  borderRadius: "999px",
} as const;

const odpovednostKarta = {
  marginTop: "14px",
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--line)",
  background: "var(--card)",
} as const;

const filtrVyber = {
  padding: "8px 10px",
  fontSize: "13.5px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "38px",
} as const;

const mikroVyber = {
  ...filtrVyber,
  minHeight: "40px",
  fontSize: "13px",
} as const;
