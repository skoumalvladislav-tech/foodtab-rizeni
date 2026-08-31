import { redirect } from "next/navigation";

import { getCurrentTenantId, zkusPristup } from "@/lib/firma";
import { DotazSelhal } from "@/lib/supabase/dotaz";
import { getServerSupabase } from "@/lib/supabase/server";
import Sdeleni from "@/app/sdeleni";
import Nadpis from "../../nadpis";
import { prejmenovatPozici, prepnoutPozici, zalozitPozici } from "./akce";

export const dynamic = "force-dynamic";

/**
 * Nastavení → Pozice
 *
 * Pozice říká, čím ten člověk je: číšník, kuchař, barman. NENÍ to
 * oprávnění — to říká, co smí v aplikaci, a bydlí na vlastní obrazovce.
 * Brigádník má pozici a žádné oprávnění; proto se to nespojuje.
 *
 * Pozice se nemažou. U lidí, kteří ji mají, by zmizelo, čím byli, a
 * v rozpisu směn je pozice u každé směny. Vyřazená se jen přestane
 * nabízet u nových.
 */

type Pozice = {
  id: string;
  label: string;
  active: boolean;
};

export default async function NastaveniPozice({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<{ chyba?: string; stav?: string; nazev?: string }>;
}) {
  const { rozsah } = await params;
  const { chyba, stav, nazev } = await searchParams;

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
        Správa pozic je otevřená jen oprávněním s právem{" "}
        <code>people.manage</code>.
      </Sdeleni>
    );
  }

  const supabase = await getServerSupabase();

  const { data, error: chybaData } = await supabase
    .from("positions")
    .select("id, label, active")
    .eq("tenant_id", tenantId)
    .order("label");
  if (chybaData) throw new DotazSelhal("pozice", chybaData);

  const pozice = (data ?? []) as Pozice[];

  // Kolik lidí kterou pozici má. Podle toho se píše, co se vyřazením
  // stane — „u třech lidí zůstane“ je konkrétnější než obecná věta.
  const { data: lide, error: chybaLide } = await supabase
    .from("employees")
    .select("position_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (chybaLide) throw new DotazSelhal("zaměstnanci", chybaLide);

  const pocty = new Map<string, number>();
  for (const z of lide ?? []) {
    const i = z.position_id as string | null;
    if (i) pocty.set(i, (pocty.get(i) ?? 0) + 1);
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Čím lidé v provozu jsou. S tím, co smějí v aplikaci, to nesouvisí — to jsou Oprávnění."
      >
        Pozice
      </Nadpis>

      <div style={{ padding: "16px", paddingBottom: "32px" }}>
        <form action={zalozitPozici} style={formular}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <label style={formularLabel}>
            <span>Nová pozice</span>
            <input
              name="nazev"
              required
              maxLength={60}
              placeholder="Číšník"
              style={inputPole}
            />
          </label>

          {chyba ? <p className="hlaska-chyba">{popisChyby(chyba, nazev)}</p> : null}
          {stav ? (
            <p style={{ margin: "12px 0 0", fontSize: "13px", color: popisStavu(stav).barva }}>
              {popisStavu(stav).text(nazev)}
            </p>
          ) : null}

          <button
            type="submit"
            className="ft-tl ft-tl-hlavni"
            style={{ marginTop: "16px" }}
          >
            Přidat
          </button>
        </form>

        <h2 style={nadpisSekce}>
          {pozice.length === 0 ? "Zatím žádné pozice" : "Pozice ve firmě"}
        </h2>

        {pozice.length === 0 ? (
          <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>
            Žádná zatím není. Přidat ji jde tady nebo rovnou u člověka na
            obrazovce Lidé — volbou „+ Nová pozice…“.
          </p>
        ) : (
          <ul style={seznam}>
            {pozice.map((p) => {
              const pouziva = pocty.get(p.id) ?? 0;
              return (
                <li
                  key={p.id}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--line)",
                    borderRadius: "12px",
                    padding: "14px",
                    opacity: p.active ? 1 : 0.6,
                  }}
                >
                  <form
                    key={`prejmenovat-${p.id}`}
                    action={prejmenovatPozici}
                    style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
                  >
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="pozice" value={p.id} />
                    <input
                      name="nazev"
                      defaultValue={p.label}
                      required
                      maxLength={60}
                      style={{ ...inputPole, flex: "1 1 200px", minWidth: 0 }}
                      aria-label={`Název pozice ${p.label}`}
                    />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Přejmenovat
                    </button>
                  </form>

                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginTop: "10px",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--muted)" }}>
                      {pouziva === 0
                        ? "Nikdo ji zatím nemá"
                        : `Má ji ${pouziva} ${pouziva === 1 ? "člověk" : pouziva < 5 ? "lidé" : "lidí"}`}
                      {p.active ? "" : " · vyřazená z nabídky"}
                    </span>

                    <form action={prepnoutPozici} style={{ marginLeft: "auto" }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="pozice" value={p.id} />
                      <input
                        type="hidden"
                        name="zapnout"
                        value={p.active ? "ne" : "ano"}
                      />
                      <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                        {p.active ? "Vyřadit z nabídky" : "Vrátit do nabídky"}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p
          style={{
            margin: "20px 0 0",
            fontSize: "13px",
            color: "var(--muted)",
            maxWidth: "62ch",
          }}
        >
          Pozice se nemažou. Vyřazená se přestane nabízet u nových lidí, ale
          u těch, kdo ji mají, zůstane — jinak by z jejich záznamu i ze
          starých směn zmizelo, čím byli.
        </p>
      </div>
    </>
  );
}

/* --- hlášky ------------------------------------------------------ */

function popisChyby(kod: string, nazev?: string): string {
  switch (kod) {
    case "prazdny":
      return "Název pozice nesmí zůstat prázdný.";
    case "dlouhy":
      return "Název pozice je moc dlouhý, zkraťte ho.";
    case "kolize":
      return `Pozice ${nazev ?? ""} už existuje. Zvolte jiný název.`;
    case "pravo":
      return "Na správu pozic nemáte právo.";
    default:
      return "Uložení se nepovedlo. Zkuste to prosím znovu.";
  }
}

function popisStavu(stav: string): {
  barva: string;
  text: (nazev?: string) => string;
} {
  switch (stav) {
    case "zalozena":
      return { barva: "var(--good)", text: (n) => `Pozice ${n ?? ""} přidaná.` };
    case "uz_existuje":
      return {
        barva: "var(--muted)",
        text: (n) => `Pozice ${n ?? ""} už existuje, použil jsem ji.`,
      };
    case "prejmenovana":
      return { barva: "var(--good)", text: () => "Přejmenováno." };
    case "vyrazena":
      return {
        barva: "var(--muted)",
        text: () => "Vyřazeno z nabídky. U lidí, kteří ji mají, zůstává.",
      };
    case "vracena":
      return { barva: "var(--good)", text: () => "Vráceno do nabídky." };
    default:
      return { barva: "var(--muted)", text: () => "" };
  }
}

/* --- styly ------------------------------------------------------- */

const formular = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "12px",
  padding: "16px 18px",
  boxShadow: "var(--shadow)",
  maxWidth: "620px",
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

const nadpisSekce = {
  margin: "24px 0 12px",
  fontSize: "16px",
  color: "var(--muted)",
  fontWeight: 500,
} as const;

const seznam = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "12px",
} as const;
