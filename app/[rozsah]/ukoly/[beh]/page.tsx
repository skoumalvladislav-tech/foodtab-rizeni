import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import { uzavritChecklist, zapsatPolozku } from "../akce";

export const dynamic = "force-dynamic";

/**
 * Vyplňování jednoho checklistu.
 *
 * Položka s `requires_value` chce hodnotu — čísla se hlídají proti
 * `min_value` a `max_value`. Meze se ale kontrolují v akci na serveru,
 * kde se čtou z databáze; tady se jen předvyplní do políčka, aby se
 * uživatel netrefoval naslepo.
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
};

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
        Na checklisty vaše role nedosáhne.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  const { data: behy } = await supabase
    .from("checklist_runs")
    .select("id, template_id, branch_id, business_date, status")
    .eq("id", beh)
    .limit(1);

  const run = behy?.[0] as
    | {
        id: string;
        template_id: string;
        branch_id: string;
        business_date: string;
        status: string;
      }
    | undefined;

  // RLS vrátí prázdno i tehdy, když běh existuje, ale nepatří nám.
  // Rozdíl mezi „není“ a „není váš“ schválně nerozlišujeme.
  if (!run) {
    return (
      <Sdeleni nadpis="Checklist nenalezen">
        Buď neexistuje, nebo není váš. Vraťte se na seznam úkolů.
      </Sdeleni>
    );
  }

  const { data: sablony } = await supabase
    .from("checklist_templates")
    .select("id, name")
    .eq("id", run.template_id)
    .limit(1);
  const nazev = (sablony?.[0]?.name as string | undefined) ?? "Checklist";

  const { data: polozkyData } = await supabase
    .from("checklist_items")
    .select(
      "id, position, label, requires_value, value_type, value_unit, min_value, max_value",
    )
    .eq("template_id", run.template_id)
    .order("position", { ascending: true });

  const polozky = (polozkyData ?? []) as Polozka[];

  const { data: zaznamyData } = await supabase
    .from("checklist_entries")
    .select("item_id, checked, value_number, value_text")
    .eq("run_id", run.id);

  const zaznamy = new Map<string, Zaznam>();
  for (const z of (zaznamyData ?? []) as Zaznam[]) zaznamy.set(z.item_id, z);

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const hotovo = polozky.filter((p) => zaznamy.get(p.id)?.checked).length;
  const vseHotovo = polozky.length > 0 && hotovo === polozky.length;
  const uzavreno = run.status === "done";

  return (
    <main style={{ padding: "16px", paddingBottom: "32px" }}>
      <Link
        href={`/${rozsah}/ukoly`}
        style={{ fontSize: "14px", color: "var(--accent)" }}
      >
        ← Zpět na úkoly
      </Link>

      <h2
        style={{
          margin: "12px 0 4px",
          fontSize: "18px",
          color: "var(--branch)",
        }}
      >
        {nazev}
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--muted)" }}>
        {hotovo} z {polozky.length} hotovo
        {uzavreno ? " · uzavřeno" : ""}
      </p>

      {polozky.length === 0 ? (
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
          Checklist nemá žádné položky.
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "10px" }}>
          {polozky.map((p) => {
            const z = zaznamy.get(p.id);
            const splneno = z?.checked === true;
            const jeFoto = p.requires_value && p.value_type === "photo";

            return (
              <li
                key={p.id}
                style={{
                  background: splneno ? "var(--branch-soft)" : "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "14px",
                }}
              >
                <p style={{ margin: 0, fontSize: "15px", color: "var(--ink)" }}>
                  {splneno ? "✓ " : ""}
                  {p.label}
                </p>

                {splneno ? (
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
                          borderRadius: "10px",
                          border: "1px solid var(--line)",
                          background: "var(--paper)",
                          color: "var(--ink)",
                        }}
                      />
                    ) : null}

                    <button
                      type="submit"
                      style={{
                        padding: "10px 16px",
                        fontSize: "14px",
                        borderRadius: "10px",
                        border: "none",
                        background: "var(--branch)",
                        color: "var(--card)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.requires_value ? "Zapsat" : "Odškrtnout"}
                    </button>
                  </form>
                )}

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
            style={{
              width: "100%",
              padding: "14px",
              fontSize: "16px",
              borderRadius: "12px",
              border: "none",
              background: "var(--good)",
              color: "var(--card)",
              cursor: "pointer",
            }}
          >
            Uzavřít checklist
          </button>
        </form>
      ) : null}
    </main>
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
