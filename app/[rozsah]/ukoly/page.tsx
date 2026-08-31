import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { dokoncitUkol, spustitChecklist } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Úkoly a checklisty.
 *
 * Úkol bez pobočky (`branch_id` prázdné) patří celé firmě a vidí ho každý
 * s oprávněním — proto se na pobočkové adrese ptáme na „moje pobočka nebo
 * nic“, ne jen na pobočku.
 *
 * Odškrtnout úkol smí podle politiky tasks_write jen ten, kdo má
 * tasks.manage. Ostatním se seznam ukáže, ale bez tlačítka.
 */

type Ukol = {
  id: string;
  branch_id: string | null;
  title: string;
  note: string;
  due_at: string | null;
  priority: string;
  status: string;
};

type Sablona = {
  id: string;
  branch_id: string | null;
  name: string;
  department: string;
  schedule: string;
};

export default async function Ukoly({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ ukol?: string; chyba?: string }>;
}) {
  const { rozsah } = await params;
  const { ukol: chybnyUkol, chyba } = await searchParams;

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
        Na úkoly vaše oprávnění nedosáhne. Pokud si myslíte, že by měla,
        řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  let dotazUkoly = supabase
    .from("tasks")
    .select("id, branch_id, title, note, due_at, priority, status")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (scope.level === "branch" && scope.branchId) {
    // Firemní úkoly (branch_id prázdné) patří i pobočce.
    dotazUkoly = dotazUkoly.or(
      `branch_id.eq.${scope.branchId},branch_id.is.null`,
    );
  }

  const { data: ukolyData, error: chybaUkolyData } = await dotazUkoly;
  if (chybaUkolyData) throw new DotazSelhal("úkoly", chybaUkolyData);
  const ukoly = (ukolyData ?? []) as Ukol[];

  // Checklisty se vedou na pobočku — checklist_runs.branch_id je NOT NULL.
  const branchId = scope.branchId;
  let sablony: Sablona[] = [];
  const behy = new Map<string, { id: string; status: string; hotovo: number }>();
  const poctyPolozek = new Map<string, number>();
  let den: string | null = null;

  if (branchId) {
    den = await provozniDen(branchId);

    const { data: sablonyData, error: chybaSablonyData } = await supabase
      .from("checklist_templates")
      .select("id, branch_id, name, department, schedule")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order("name", { ascending: true });
    if (chybaSablonyData) throw new DotazSelhal("šablony checklistů", chybaSablonyData);

    sablony = (sablonyData ?? []) as Sablona[];

    if (sablony.length > 0) {
      const idSablon = sablony.map((s) => s.id);

      const { data: polozky, error: chybaPolozky } = await supabase
        .from("checklist_items")
        .select("id, template_id")
        .in("template_id", idSablon);
      if (chybaPolozky) throw new DotazSelhal("položky checklistu", chybaPolozky);

      for (const p of polozky ?? []) {
        const t = p.template_id as string;
        poctyPolozek.set(t, (poctyPolozek.get(t) ?? 0) + 1);
      }

      if (den) {
        const { data: behyData, error: chybaBehyData } = await supabase
          .from("checklist_runs")
          .select("id, template_id, status")
          .eq("branch_id", branchId)
          .eq("business_date", den)
          .in("template_id", idSablon);
        if (chybaBehyData) throw new DotazSelhal("běhy checklistů", chybaBehyData);

        const idBehu = (behyData ?? []).map((b) => b.id as string);
        const hotoveVBehu = new Map<string, number>();

        if (idBehu.length > 0) {
          const { data: zaznamy, error: chybaZaznamy } = await supabase
            .from("checklist_entries")
            .select("run_id, checked")
            .in("run_id", idBehu);
          if (chybaZaznamy) throw new DotazSelhal("odškrtnuté položky", chybaZaznamy);

          for (const z of zaznamy ?? []) {
            if (z.checked !== true) continue;
            const r = z.run_id as string;
            hotoveVBehu.set(r, (hotoveVBehu.get(r) ?? 0) + 1);
          }
        }

        for (const b of behyData ?? []) {
          behy.set(b.template_id as string, {
            id: b.id as string,
            status: b.status as string,
            hotovo: hotoveVBehu.get(b.id as string) ?? 0,
          });
        }
      }
    }
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    <>
      <Nadpis oci="Provoz" popis="Jednorázové úkoly a checklisty, které se opakují každou směnu.">
        Úkoly a checklisty
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <h2 style={nadpisSekce}>Otevřené úkoly</h2>

        {ukoly.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Žádný otevřený úkol. Hotovo.
          </p>
        ) : (
          <ul style={seznam}>
            {ukoly.map((u) => (
              <li
                key={u.id}
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderLeft: `4px solid ${
                    u.priority === "high" ? "var(--warn)" : "var(--line)"
                  }`,
                  borderRadius: "12px",
                  padding: "14px",
                }}
              >
                <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                  {u.title}
                </p>

                {u.note ? (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: "var(--muted)",
                    }}
                  >
                    {u.note}
                  </p>
                ) : null}

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  {[
                    u.branch_id === null
                      ? "celá firma"
                      : scope.level === "tenant"
                        ? (nazvyPobocek.get(u.branch_id) ?? "jiná pobočka")
                        : null,
                    u.due_at ? `termín ${denAcas(u.due_at)}` : null,
                    u.priority === "high" ? "přednostně" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {/*
                  Tlačítko se ukáže každému, kdo úkol vidí. O tom, jestli
                  ho smí zavřít, rozhoduje public.complete_task() — vedoucí,
                  adresát i jeho role. Ptát se dopředu přes canSee by
                  znamenalo mít pravidlo na dvou místech.
                */}
                <form action={dokoncitUkol} style={{ marginTop: "10px" }}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="ukol" value={u.id} />
                  <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                    Hotovo
                  </button>
                </form>

                {chybnyUkol === u.id && chyba ? (
                  <p
                    role="alert"
                    style={{
                      margin: "8px 0 0",
                      fontSize: "13px",
                      color: "var(--bad)",
                    }}
                  >
                    {popisChyby(chyba)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <h2 style={{ ...nadpisSekce, marginTop: "28px" }}>Checklisty</h2>

        {!branchId ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Checklisty se vedou po pobočkách. Přepněte se na konkrétní
            pobočku.
          </p>
        ) : !den ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Nepodařilo se zjistit provozní den, takže checklisty nelze
            zobrazit.
          </p>
        ) : sablony.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Pro tuhle pobočku není nastavený žádný checklist.
          </p>
        ) : (
          <ul style={seznam}>
            {sablony.map((s) => {
              const beh = behy.get(s.id);
              const celkem = poctyPolozek.get(s.id) ?? 0;

              return (
                <li
                  key={s.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "14px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                    {s.name}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {[
                      s.department,
                      beh
                        ? `${beh.hotovo} z ${celkem} hotovo`
                        : `${celkem} položek`,
                      beh?.status === "done" ? "uzavřeno" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  {beh ? (
                    <Link
                      href={`/${rozsah}/ukoly/${beh.id}`}
                      className="ft-tl ft-tl-hlavni ft-tl-male"
                      style={{ marginTop: "10px" }}
                    >
                      {beh.status === "done" ? "Zobrazit" : "Pokračovat"}
                    </Link>
                  ) : (
                    <form action={spustitChecklist} style={{ marginTop: "10px" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="sablona" value={s.id} />
                      <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                        Spustit
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/* --- styly a pomocné funkce -------------------------------------- */

const nadpisSekce = {
  margin: "0 0 12px",
  fontSize: "16px",
  color: "var(--muted)",
  fontWeight: 500,
} as const;

const seznam = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "10px",
} as const;

/** Hlášky z ?chyba= po neúspěšném zavření úkolu. */
function popisChyby(kod: string): string {
  switch (kod) {
    case "cizi":
      return "Tenhle úkol není váš.";
    case "chybi":
      return "Úkol už neexistuje.";
    default:
      return "Úkol se nepodařilo zavřít. Zkuste to prosím znovu.";
  }
}

function denAcas(iso: string): string {
  const d = new Date(iso);
  const den = `${d.getDate()}. ${d.getMonth() + 1}.`;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${den} ${h}:${m}`;
}
