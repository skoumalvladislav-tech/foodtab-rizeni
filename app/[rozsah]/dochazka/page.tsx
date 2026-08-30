import { redirect } from "next/navigation";

import { getContext, getUser, hasAccess } from "@/lib/authz";
import { bezpecnyRozsah, getCurrentTenantId } from "@/lib/firma";
import { provozniDen } from "@/lib/provozni-den";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { zapsatDochazku } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Docházka — příchod a odchod.
 *
 * Na rozdíl od ostatních obrazovek se nezavírá na jedno oprávnění.
 * Vlastní příchod si zapisuje každý zaměstnanec s účtem — říká to tak
 * i politika attendance_insert. `attendance.read` rozhoduje až o tom,
 * jestli člověk uvidí i ostatní.
 *
 * Provozní den se nepočítá v kódu, ptá se na něj databáze.
 */

type Udalost = {
  id: string;
  employee_id: string;
  kind: string;
  occurred_at: string;
  branch_id: string;
};

export default async function Dochazka({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const user = await getUser();
  if (!user) redirect("/prihlaseni");

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const ctx = await getContext(tenantId);
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    );
  }

  const scope = bezpecnyRozsah(ctx, rozsah);
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu role.
      </Sdeleni>
    );
  }

  // Rozhoduje jen o tom, jestli uvidí i ostatní. Vlastní docházku má
  // každý bez ohledu na tohle.
  const vidiOstatni = await hasAccess(
    tenantId,
    "attendance.read",
    scope.branchId,
  );

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();

  const { data: zaznamy } = await supabase
    .from("employees")
    .select("id, branch_id, full_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1);

  const ja = zaznamy?.[0] as
    | { id: string; branch_id: string | null; full_name: string }
    | undefined;

  if (!ja) {
    return (
      <Sdeleni nadpis="Nemáte zaměstnanecký záznam">
        Váš účet zatím není propojený se zaměstnancem, takže docházku
        zapisovat nelze. Doplní to správce firmy.
      </Sdeleni>
    );
  }

  const branchId = scope.branchId ?? ja.branch_id;
  if (!branchId) {
    return (
      <Sdeleni nadpis="Nemáte přiřazenou pobočku">
        Docházka se zapisuje na pobočku a vaše členství žádnou nemá.
        Doplní ji správce firmy, nebo přepněte na konkrétní pobočku.
      </Sdeleni>
    );
  }

  const den = await provozniDen(branchId);
  if (!den) {
    return (
      <Sdeleni nadpis="Nepodařilo se zjistit provozní den">
        Bez něj se docházka nedá spolehlivě zapsat. Zkuste to prosím
        za chvíli znovu.
      </Sdeleni>
    );
  }

  // Moje poslední událost — podle ní se rozhoduje, co nabídnout.
  const { data: posledniData } = await supabase
    .from("attendance_events")
    .select("id, employee_id, kind, occurred_at, branch_id")
    .eq("employee_id", ja.id)
    .order("occurred_at", { ascending: false })
    .limit(1);

  const posledni = (posledniData?.[0] ?? null) as Udalost | null;
  const jsemVPraci =
    posledni !== null &&
    (posledni.kind === "in" || posledni.kind === "break_end");
  const dalsiDruh = jsemVPraci ? "out" : "in";

  // Dnešní stav. Bez attendance.read vrátí politika jen vlastní řádky,
  // ale filtrujeme i tady, ať se zbytečně netahá, co se stejně nesmí.
  let dotaz = supabase
    .from("attendance_events")
    .select("id, employee_id, kind, occurred_at, branch_id")
    .eq("tenant_id", tenantId)
    .eq("business_date", den)
    .order("occurred_at", { ascending: true });

  if (scope.level === "branch" && scope.branchId) {
    dotaz = dotaz.eq("branch_id", scope.branchId);
  }
  if (!vidiOstatni) {
    dotaz = dotaz.eq("employee_id", ja.id);
  }

  const { data: dnesniData } = await dotaz;
  const dnesni = (dnesniData ?? []) as Udalost[];

  // Poslední událost každého člověka = jeho aktuální stav.
  const stavy = new Map<string, Udalost>();
  for (const u of dnesni) stavy.set(u.employee_id, u);

  const jmena = new Map<string, string>([[ja.id, ja.full_name]]);
  const cizi = [...stavy.keys()].filter((i) => i !== ja.id);
  if (cizi.length > 0) {
    const { data: lide } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", cizi);
    for (const c of lide ?? []) jmena.set(c.id as string, c.full_name as string);
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const ostatni = [...stavy.entries()].filter(([id]) => id !== ja.id);

  return (
    <>
      <Nadpis oci="Provoz" popis="Příchod a odchod za sebe. Kdo píchá za ostatní, potřebuje právo na docházku týmu.">
        Docházka
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {/* Vlastní píchačka */}
        <section
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: "16px",
            boxShadow: "var(--shadow)",
            padding: "20px",
          }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
            {scope.branchName}
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "18px",
              color: jsemVPraci ? "var(--good)" : "var(--muted)",
            }}
          >
            {jsemVPraci ? "Jste v práci" : "Nejste v práci"}
            {posledni ? ` · od ${hodina(posledni.occurred_at)}` : ""}
          </p>

          {/*
            Příchod i odchod jsou hlavní akce, ne varování. Píchnout
            odchod je nejběžnější úkon dne; --pozor zůstává skutečným
            problémům. Obě strany proto vypadají stejně — co je zrovna
            na řadě, říká text tlačítka a stav nad ním.
          */}
          <form action={zapsatDochazku} style={{ marginTop: "16px" }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="druh" value={dalsiDruh} />
            <button
              type="submit"
              className="ft-tl ft-tl-hlavni"
              style={{ width: "100%", minHeight: "56px", fontSize: "18px" }}
            >
              {jsemVPraci ? "Odchod" : "Příchod"}
            </button>
          </form>
        </section>

        {/* Dnešní stav ostatních */}
        <h2
          style={{
            margin: "24px 0 12px",
            fontSize: "16px",
            color: "var(--muted)",
            fontWeight: 500,
          }}
        >
          {vidiOstatni ? "Dnes na pobočce" : "Moje dnešní docházka"}
        </h2>

        {!vidiOstatni ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            {stavy.has(ja.id)
              ? `Poslední záznam: ${popisDruhu(stavy.get(ja.id)!.kind)} v ${hodina(stavy.get(ja.id)!.occurred_at)}.`
              : "Dnes zatím nemáte žádný záznam."}
          </p>
        ) : ostatni.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Kromě vás dnes zatím nikdo nic nezapsal.
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "8px",
            }}
          >
            {ostatni.map(([id, u]) => {
              const vPraci = u.kind === "in" || u.kind === "break_end";
              return (
                <li
                  key={id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "12px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontSize: "15px", color: "var(--ink)" }}>
                    {jmena.get(id) ?? "Neznámý člověk"}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      whiteSpace: "nowrap",
                      color: vPraci ? "var(--good)" : "var(--muted)",
                    }}
                  >
                    {popisDruhu(u.kind)} · {hodina(u.occurred_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/* --- pomocné funkce ---------------------------------------------- */

function hodina(casISO: string): string {
  const d = new Date(casISO);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function popisDruhu(kind: string): string {
  switch (kind) {
    case "in":
      return "Příchod";
    case "out":
      return "Odchod";
    case "break_start":
      return "Pauza";
    case "break_end":
      return "Konec pauzy";
    default:
      return kind;
  }
}
