import { redirect } from "next/navigation";

import { BRANCH_COLORS } from "@/lib/authz";
import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { upravitPobocku } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Nastavení poboček.
 *
 * Název, barva a hodina, kterou pobočce začíná provozní den. Zapisuje se
 * do branches, o povolení rozhoduje politika branches_update.
 *
 * Barvy si vybírá zákazník z palety — do kódu žádná napevno nepatří.
 * Vedle každé tečky je název odstínu, protože barva sama nesmí nést
 * informaci.
 */

type Pobocka = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  day_starts_at: string | null;
};

const NAZVY_BAREV: Record<string, string> = {
  slate: "Břidlicová",
  indigo: "Indigová",
  violet: "Fialová",
  sky: "Blankytná",
  teal: "Modrozelená",
  emerald: "Smaragdová",
  amber: "Jantarová",
  rose: "Růžová",
};

export default async function NastaveniPobocek({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ pobocka?: string; chyba?: string; ulozeno?: string }>;
}) {
  const { rozsah } = await params;
  const { pobocka: dotcena, chyba, ulozeno } = await searchParams;

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    );
  }

  const pristup = await zkusPristup(tenantId, "settings.manage", rozsah);
  if (pristup.stav === "neprihlasen") redirect("/prihlaseni");
  if (pristup.stav === "odepren") {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nastavení firmy je otevřené jen rolím se správou nastavení.
      </Sdeleni>
    );
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("branches")
    .select("id, name, slug, color, day_starts_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const pobocky = (data ?? []) as Pobocka[];

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  if (pobocky.length === 0) {
    return (
      <Sdeleni nadpis="Firma nemá žádnou pobočku">
        Zakládání poboček zatím není hotové. Přibude sem.
      </Sdeleni>
    );
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Barva odlišuje pobočku v celém rozhraní. Provozní den určuje, do které uzávěrky spadne účet vystavený po půlnoci."
      >
        Pobočky
      </Nadpis>

      <div style={{ display: "grid", gap: "16px", maxWidth: "620px" }}>
        {pobocky.map((p) => {
          const jeDotcena = dotcena === p.id;
          const barva = p.color ?? "slate";

          return (
            <form
              key={p.id}
              action={upravitPobocku}
              data-branch={barva}
              style={{
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                padding: "16px 18px",
                boxShadow: "var(--shadow)",
              }}
            >
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="pobocka" value={p.id} />

              <div
                style={{
                  height: "3px",
                  borderRadius: "2px",
                  background: "var(--branch)",
                  marginBottom: "14px",
                }}
              />

              <label style={stitek} htmlFor={`nazev-${p.id}`}>
                Název
              </label>
              <input
                id={`nazev-${p.id}`}
                name="nazev"
                defaultValue={p.name}
                required
                maxLength={120}
                style={pole}
              />

              <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
                <legend style={{ ...stitek, padding: 0 }}>Barva</legend>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginTop: "8px",
                  }}
                >
                  {BRANCH_COLORS.map((klic) => (
                    <label
                      key={klic}
                      data-branch={klic}
                      title={NAZVY_BAREV[klic] ?? klic}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                        padding: "7px 11px",
                        borderRadius: "999px",
                        border: "1px solid var(--line-2)",
                        fontSize: "12.5px",
                        cursor: "pointer",
                        minHeight: "44px",
                      }}
                    >
                      <input
                        type="radio"
                        name="barva"
                        value={klic}
                        defaultChecked={klic === barva}
                        style={{ accentColor: "var(--branch)" }}
                      />
                      <span
                        aria-hidden="true"
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: "var(--branch)",
                          flex: "none",
                        }}
                      />
                      {/* Barva nikdy nestojí sama — vedle tečky je název. */}
                      <span>{NAZVY_BAREV[klic] ?? klic}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label
                style={{ ...stitek, marginTop: "16px", display: "block" }}
                htmlFor={`zacatek-${p.id}`}
              >
                Provozní den začíná
              </label>
              <input
                id={`zacatek-${p.id}`}
                name="zacatek"
                type="time"
                required
                defaultValue={(p.day_starts_at ?? "05:00").slice(0, 5)}
                className="mono"
                style={{ ...pole, maxWidth: "140px" }}
              />

              {jeDotcena && chyba ? (
                <p role="alert" className="hlaska-chyba">
                  {popisChyby(chyba)}
                </p>
              ) : null}

              {jeDotcena && ulozeno ? (
                <p style={{ ...hlaska, color: "var(--good)" }}>Uloženo.</p>
              ) : null}

              <button type="submit" style={tlacitko}>
                Uložit
              </button>
            </form>
          );
        })}
      </div>
    </>
  );
}

/* --- styly a hlášky ---------------------------------------------- */

const stitek = {
  display: "block",
  fontSize: "12px",
  color: "var(--muted)",
  marginBottom: "6px",
} as const;

const pole = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "16px",
  borderRadius: "10px",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const hlaska = {
  margin: "14px 0 0",
  fontSize: "13px",
} as const;

const tlacitko = {
  marginTop: "16px",
  padding: "11px 18px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "none",
  background: "var(--branch)",
  color: "var(--card)",
  cursor: "pointer",
  minHeight: "44px",
} as const;

function popisChyby(kod: string): string {
  switch (kod) {
    case "nazev":
      return "Název nesmí zůstat prázdný.";
    case "barva":
      return "Vyberte prosím barvu z palety.";
    case "hodina":
      return "Zadejte čas ve tvaru HH:MM.";
    case "pravo":
      return "Na úpravu pobočky nemáte oprávnění.";
    default:
      return "Pobočku se nepodařilo uložit. Zkuste to prosím znovu.";
  }
}
