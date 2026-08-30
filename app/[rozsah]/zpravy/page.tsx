import { redirect } from "next/navigation";

import { getUser, hasAccess } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../nadpis";
import { napsatZpravu, oznacitPrectene } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Nástěnka.
 *
 * Zpráva bez pobočky (`branch_id` prázdné) patří celé firmě a vidí ji
 * i ten, kdo je na pobočce — proto se ptáme na „moje pobočka nebo nic“.
 * Připnuté jdou nahoru.
 *
 * Přečtení se eviduje na kliknutí, ne při vykreslení: zápis do databáze
 * jen proto, že si někdo otevřel stránku, by byl vedlejší účinek, který
 * do vykreslování nepatří.
 */

const POCET = 50;

type Zprava = {
  id: string;
  branch_id: string | null;
  employee_id: string | null;
  body: string;
  pinned: boolean;
  author_id: string | null;
  created_at: string;
};

export default async function Zpravy({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "communication.read", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Na nástěnku vaše role nedosáhne. Pokud si myslíte, že by měla,
        řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    );
  }

  const { ctx, scope } = pristup;
  const muzePsat = await hasAccess(
    tenantId,
    "communication.manage",
    scope.branchId,
  );

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const user = await getUser();
  const supabase = await getServerSupabase();

  let dotaz = supabase
    .from("announcements")
    .select("id, branch_id, employee_id, body, pinned, author_id, created_at")
    .eq("tenant_id", tenantId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(POCET);

  if (scope.level === "branch" && scope.branchId) {
    // Firemní zprávy (branch_id prázdné) patří i pobočce.
    dotaz = dotaz.or(`branch_id.eq.${scope.branchId},branch_id.is.null`);
  }

  const { data: zpravyData } = await dotaz;
  const zpravy = (zpravyData ?? []) as Zprava[];

  // Co už mám přečtené. Politika pustí jen vlastní řádky, takže se
  // nemusí filtrovat podle user_id znovu — ale je to levné a čitelné.
  const prectene = new Set<string>();
  if (zpravy.length > 0 && user) {
    const { data: cteni } = await supabase
      .from("announcement_reads")
      .select("announcement_id")
      .eq("user_id", user.id)
      .in(
        "announcement_id",
        zpravy.map((z) => z.id),
      );
    for (const c of cteni ?? []) prectene.add(c.announcement_id as string);
  }

  // Jména autorů. Politika profiles_select_colleagues pouští profily lidí
  // ze stejné firmy, takže dotaz projde; kdo se nenajde, zůstane bez jména.
  const autori = new Map<string, string>();
  const idAutoru = [
    ...new Set(
      zpravy.map((z) => z.author_id).filter((i): i is string => Boolean(i)),
    ),
  ];
  if (idAutoru.length > 0) {
    const { data: profily } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", idAutoru);
    for (const p of profily ?? []) {
      const jmeno = String(p.full_name ?? "").trim();
      if (jmeno !== "") autori.set(p.user_id as string, jmeno);
    }
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]));

  return (
    <>
      <Nadpis oci="Provoz" popis="Co se má vědět. Nejnovější nahoře.">
        Nástěnka
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        {muzePsat ? (
          <form
            action={napsatZpravu}
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: "14px",
              padding: "14px",
              marginBottom: "20px",
            }}
          >
            <input type="hidden" name="rozsah" value={rozsah} />
            <label
              htmlFor="text"
              style={{
                display: "block",
                fontSize: "13px",
                color: "var(--muted)",
                marginBottom: "6px",
              }}
            >
              Nová zpráva pro{" "}
              {scope.level === "tenant" ? "celou firmu" : scope.branchName}
            </label>
            <textarea
              id="text"
              name="text"
              required
              rows={3}
              placeholder="Co mají vědět?"
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "16px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
                resize: "vertical",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "10px",
                gap: "12px",
              }}
            >
              <label
                style={{
                  fontSize: "14px",
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <input type="checkbox" name="pripnout" value="ano" />
                Připnout nahoru
              </label>
              <button
                type="submit"
                style={{
                  padding: "10px 18px",
                  fontSize: "15px",
                  borderRadius: "10px",
                  border: "none",
                  background: "var(--branch)",
                  color: "var(--card)",
                  cursor: "pointer",
                }}
              >
                Odeslat
              </button>
            </div>
          </form>
        ) : null}

        {zpravy.length === 0 ? (
          <Sdeleni nadpis="Nástěnka je prázdná">
            {muzePsat
              ? "Zatím tu nic není. Napište první zprávu."
              : "Zatím tu nic není."}
          </Sdeleni>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "12px",
            }}
          >
            {zpravy.map((z) => {
              const jePrectena = prectene.has(z.id);
              const firemni = z.branch_id === null;

              return (
                <li
                  key={z.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderLeft: z.pinned
                      ? "4px solid var(--warn)"
                      : "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "14px",
                    opacity: jePrectena ? 0.72 : 1,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {[
                      z.pinned ? "Připnuto" : null,
                      z.author_id ? autori.get(z.author_id) : null,
                      firemni
                        ? "celá firma"
                        : scope.level === "tenant"
                          ? (nazvyPobocek.get(z.branch_id as string) ??
                            "jiná pobočka")
                          : null,
                      z.employee_id ? "osobní" : null,
                      datumACas(z.created_at),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: "15px",
                      color: "var(--ink)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {z.body}
                  </p>

                  {jePrectena ? (
                    <p
                      style={{
                        margin: "10px 0 0",
                        fontSize: "12px",
                        color: "var(--good)",
                      }}
                    >
                      ✓ Přečteno
                    </p>
                  ) : (
                    <form action={oznacitPrectene} style={{ marginTop: "10px" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="zprava" value={z.id} />
                      <button
                        type="submit"
                        style={{
                          padding: "8px 14px",
                          fontSize: "13px",
                          borderRadius: "8px",
                          border: "1px solid var(--line)",
                          background: "transparent",
                          color: "var(--good)",
                          cursor: "pointer",
                        }}
                      >
                        Označit jako přečtené
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

function datumACas(iso: string): string {
  const d = new Date(iso);
  const den = `${d.getDate()}. ${d.getMonth() + 1}.`;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${den} ${h}:${m}`;
}
