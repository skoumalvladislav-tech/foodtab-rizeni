import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { upravitZamestnance, smazatZamestnance } from "./akce";
import VystavitPozvankuFormular from "./vystaveni";

export const dynamic = "force-dynamic";

type Zamestnanec = {
  id: string;
  full_name: string;
  position_id: string | null;
  branch_id: string | null;
  user_id: string | null;
  employment_type: string;
  active: boolean;
  deleted_at: string | null;
};

/**
 * Nastavení → Lidé a pozvánky
 *
 * Seznam zaměstnanců s možností přidat, upravit a smazat (soft-delete).
 * Brigádník bez účtu je normální stav, ne chyba.
 */
export default async function NastaveniLide({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string; ulozeno?: string; upravuji?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba, ulozeno, upravuji } = await searchParams;

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "people.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Správa lidí je otevřená jen rolím s právem <code>people.manage</code>.
      </Sdeleni>
    );
  }

  const { ctx } = pristup;
  const supabase = await getServerSupabase();

  // Zaměstnanci
  const { data: zamestnanci } = await supabase
    .from("employees")
    .select("id, full_name, position_id, branch_id, user_id, employment_type, active, deleted_at")
    .eq("tenant_id", tenantId)
    .order("full_name");

  // Pozice
  const { data: pozice } = await supabase
    .from("positions")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name");

  const upravujeId = upravuji ? String(upravuji) : null;
  const upravuje =
    upravujeId && zamestnanci
      ? (zamestnanci.find((z) => z.id === upravujeId) as Zamestnanec)
      : null;

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Přidávejte zaměstnance, brigádníky a hosty. Bez účtu se tu objeví, až si někdo vystaví pozvánku."
      >
        Lidé
      </Nadpis>

      {/* Formulář */}
      <form action={upravitZamestnance} style={{ ...formular, marginBottom: "24px" }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        {upravuje && <input type="hidden" name="id" value={upravuje.id} />}

        <div style={{ display: "grid", gap: "16px", maxWidth: "620px" }}>
          <label style={formularLabel}>
            <span>Jméno *</span>
            <input
              name="jmeno"
              defaultValue={upravuje?.full_name ?? ""}
              required
              maxLength={200}
              style={inputPole}
            />
          </label>

          <label style={formularLabel}>
            <span>Pozice</span>
            <select name="pozice" defaultValue={upravuje?.position_id ?? ""} style={selectPole}>
              <option value="">— Neurčeno —</option>
              {(pozice ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label style={formularLabel}>
            <span>Pobočka</span>
            <select name="pobocka" defaultValue={upravuje?.branch_id ?? ""} style={selectPole}>
              <option value="">— Firemní —</option>
              {ctx.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label style={formularLabel}>
            <span>Typ pracovního poměru</span>
            <select name="typ" defaultValue={upravuje?.employment_type ?? "hpp"} style={selectPole}>
              <option value="hpp">Hlavní pracovní poměr</option>
              <option value="dpp">Dohoda o provedení práce</option>
              <option value="dpc">Dohoda o činnosti</option>
              <option value="ico">Samostatně činná osoba</option>
              <option value="jine">Jiné</option>
            </select>
          </label>

          {chyba && <p className="hlaska-chyba">{chyba}</p>}
          {ulozeno && <p style={{ ...chybaHlaska, color: "var(--good)" }}>Uloženo.</p>}

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="submit" style={tlacitko}>
              {upravuje ? "Uložit" : "Přidat"}
            </button>
            {upravuje && (
              <button
                type="button"
                onClick={() => {
                  window.location.href = `/${rozsah}/nastaveni/lide`;
                }}
                style={{ ...tlacitko, background: "var(--line-2)", color: "var(--ink)" }}
              >
                Storno
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Seznam */}
      <div style={{ overflowX: "auto", marginTop: "32px" }}>
        <table style={tabulka}>
          <thead>
            <tr style={headRow}>
              <th style={th}>Jméno</th>
              <th style={th}>Pozice</th>
              <th style={th}>Pobočka</th>
              <th style={th}>Typ</th>
              <th style={th}>Účet</th>
              <th style={th}>Akce</th>
            </tr>
          </thead>
          <tbody>
            {(zamestnanci ?? []).map((z) => (
              <tr key={z.id} style={{ ...tr, opacity: z.deleted_at ? 0.5 : 1 }}>
                <td style={td}>{z.full_name}</td>
                <td style={td}>
                  {z.position_id
                    ? (pozice ?? []).find((p) => p.id === z.position_id)?.name || "—"
                    : "—"}
                </td>
                <td style={td}>
                  {z.branch_id
                    ? ctx.branches.find((b) => b.id === z.branch_id)?.name || "—"
                    : "Firemní"}
                </td>
                <td style={td}>
                  {({
                    hpp: "HPP",
                    dpp: "DPP",
                    dpc: "DPČ",
                    ico: "OSVČ",
                    jine: "Jiné",
                  } as Record<string, string>)[z.employment_type] || z.employment_type}
                </td>
                <td style={td}>{z.user_id ? "Ano" : "Ne"}</td>
                <td style={td}>
                  <button
                    onClick={() => {
                      window.location.href = `/${rozsah}/nastaveni/lide?upravuji=${z.id}`;
                    }}
                    style={tabulkovyLink}
                  >
                    Upravit
                  </button>
                  {!z.deleted_at && (
                    <button
                      onClick={async () => {
                        if (confirm("Smazat zaměstnance? Data se neuloží zpátky.")) {
                          await smazatZamestnance(z.id, rozsah);
                          window.location.reload();
                        }
                      }}
                      style={{ ...tabulkovyLink, color: "var(--warn)" }}
                    >
                      Smazat
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vystavení pozvánky */}
      <VystavitPozvankuFormular
        rozsah={rozsah}
        zamestnanci={(zamestnanci ?? []).filter((z) => !z.deleted_at).map((z) => ({
          id: z.id,
          full_name: z.full_name,
        }))}
      />
    </>
  );
}

/* --- Styly --- */

const formular = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "16px 18px",
  boxShadow: "var(--shadow)",
} as const;

const formularLabel = {
  display: "grid" as const,
  gap: "6px",
  fontSize: "13px",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".06em",
} as const;

const inputPole = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "16px",
  borderRadius: "10px",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const selectPole = {
  ...inputPole,
  cursor: "pointer",
} as const;

const chybaHlaska = {
  margin: "14px 0 0",
  fontSize: "13px",
} as const;

const tlacitko = {
  padding: "11px 18px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "none",
  background: "var(--branch)",
  color: "var(--card)",
  cursor: "pointer",
  minHeight: "44px",
} as const;

const tabulka = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "14px",
} as const;

const headRow = {
  background: "var(--sunken)",
  borderBottom: "1px solid var(--line)",
} as const;

const th = {
  padding: "10px 12px",
  textAlign: "left" as const,
  fontSize: "11px",
  fontWeight: "600",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".06em",
} as const;

const tr = {
  borderBottom: "1px solid var(--line)",
} as const;

const td = {
  padding: "12px",
} as const;

const tabulkovyLink = {
  color: "var(--accent)",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "13px",
  marginRight: "12px",
} as const;
