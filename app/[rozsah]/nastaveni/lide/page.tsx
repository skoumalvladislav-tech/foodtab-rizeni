import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { prvniDenMesice, sazbaZaHodinu } from "@/lib/mzdy";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { upravitZamestnance, smazatZamestnance } from "./akce";
import SmazatZamestnance from "./smazani";
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

  /*
    Sazby. Zadání §4 na to upozorňuje zvlášť: people.manage NESTAČÍ.
    Kdo spravuje lidi, nemusí vidět na mzdy — v malém provozu to bývá
    dokonce jeden člověk a jeho účetní. Sloupec se proto neváže na
    právo, kterým se sem člověk dostal.

    Chyba se nevyhazuje ze stejného důvodu jako u dlaždice na Docházce:
    dokud není nasazená migrace se sazbami, sloupec se prostě nekreslí
    a správa lidí funguje dál.
  */
  const { data: vydelky, error: sazbyChyba } = await supabase.rpc(
    "employee_earnings",
    {
      p_tenant: tenantId,
      p_mesic: prvniDenMesice(new Date()),
      p_branch: null,
    },
  );

  const sazby = new Map<string, number | null>();
  for (const v of (vydelky ?? []) as {
    employee_id: string;
    hodinova_haleru: number | null;
  }[]) {
    sazby.set(v.employee_id, v.hodinova_haleru);
  }

  /*
    O přístupu rozhoduje databáze, ne tenhle řádek: employee_earnings bez
    payroll.read nevrátí ani řádek, takže se sloupec nemá čím naplnit
    a nekreslí se.

    Správně by tu měla být i kontrola v aplikaci (pravidlo 3, dvě obranné
    linie) — hasAccess(tenantId, 'payroll.read', …). Nejde to: seznam
    PERMISSIONS v lib/authz.ts payroll.read zatím nezná a na ten soubor
    jsem dnes v noci nesměl sáhnout. Až se do něj klíč doplní, patří sem
    ta kontrola taky. Bezpečnost tím netrpí, obrazovka nemá jak ukázat
    to, co jí databáze nedala — ale je to jedna linie, ne dvě.
  */
  const smiVidetSazby = !sazbyChyba && sazby.size > 0;

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
            <button type="submit" className="ft-tl ft-tl-hlavni">
              {upravuje ? "Uložit" : "Přidat"}
            </button>
            {upravuje && (
              <Link
                href={`/${rozsah}/nastaveni/lide`}
                className="ft-tl ft-tl-vedlejsi"
              >
                Storno
              </Link>
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
              {smiVidetSazby ? <th style={th}>Sazba</th> : null}
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

                {/*
                  Chybějící sazba se píše slovem, ne jako 0 Kč. Nula
                  vypadá jako výsledek, ne jako údaj, který nikdo nezadal
                  — a u brigádníka, kterého ještě nikdo nenacenil, je to
                  normální stav, ne chyba.
                */}
                {smiVidetSazby ? (
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {sazby.get(z.id) != null ? (
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {sazbaZaHodinu(sazby.get(z.id) as number)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>nezadaná</span>
                    )}
                  </td>
                ) : null}

                <td style={td}>
                  <Link
                    href={`/${rozsah}/nastaveni/lide?upravuji=${z.id}`}
                    className="ft-tl ft-tl-vedlejsi ft-tl-male"
                    style={{ marginRight: "8px" }}
                  >
                    Upravit
                  </Link>
                  {!z.deleted_at && (
                    <SmazatZamestnance
                      akce={smazatZamestnance}
                      id={z.id}
                      rozsah={rozsah}
                      jmeno={z.full_name}
                    />
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
