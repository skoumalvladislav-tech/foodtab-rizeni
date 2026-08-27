"use client";

import { useState } from "react";

type Smena = {
  id: string;
  branch_id: string;
  employee_id: string | null;
  position_id: string | null;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string;
};

type RozsahContext = {
  level: "tenant" | "branch";
  branchId: string | null;
  branchName: string | null;
};

type Props = {
  smeny: Smena[];
  dnesni: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
};

export default function RozpisView({
  smeny,
  dnesni,
  jmena,
  pozice,
  nazvyPobocek,
  rozsah,
}: Props) {
  const [view, setView] = useState<"mesic" | "tyden" | "den">("tyden");

  // Seskupení po dnech
  const dny = new Map<string, Smena[]>();
  for (const s of smeny) {
    const seznam = dny.get(s.shift_date);
    if (seznam) seznam.push(s);
    else dny.set(s.shift_date, [s]);
  }

  return (
    <main style={{ padding: "16px", paddingBottom: "32px" }}>
      {/* Přepínač pohledů */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button
          onClick={() => setView("mesic")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: view === "mesic" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: view === "mesic" ? "var(--branch-soft)" : "transparent",
            color: view === "mesic" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: view === "mesic" ? 600 : 500,
          }}
        >
          Měsíc
        </button>
        <button
          onClick={() => setView("tyden")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: view === "tyden" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: view === "tyden" ? "var(--branch-soft)" : "transparent",
            color: view === "tyden" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: view === "tyden" ? 600 : 500,
          }}
        >
          Týden
        </button>
        <button
          onClick={() => setView("den")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: view === "den" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: view === "den" ? "var(--branch-soft)" : "transparent",
            color: view === "den" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: view === "den" ? 600 : 500,
          }}
        >
          Den
        </button>
      </div>

      {/* Obsah podle pohledu */}
      {view === "tyden" && (
        <TydenView
          dny={dny}
          dnesni={dnesni}
          jmena={jmena}
          pozice={pozice}
          nazvyPobocek={nazvyPobocek}
          rozsah={rozsah}
        />
      )}

      {view === "mesic" && (
        <div style={{ color: "var(--muted)", padding: "20px", textAlign: "center" }}>
          Pohled Měsíc — zatím není implementován
        </div>
      )}

      {view === "den" && (
        <div style={{ color: "var(--muted)", padding: "20px", textAlign: "center" }}>
          Pohled Den — zatím není implementován
        </div>
      )}
    </main>
  );
}

function TydenView({
  dny,
  dnesni,
  jmena,
  pozice,
  nazvyPobocek,
  rozsah,
}: {
  dny: Map<string, Smena[]>;
  dnesni: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
}) {
  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {[...dny.entries()].map(([datum, denniSmeny]) => (
        <section key={datum}>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "14px",
              color: "var(--branch)",
              position: "sticky",
              top: 0,
            }}
          >
            {popisDne(datum, dnesni)}
          </h3>

          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "8px",
            }}
          >
            {denniSmeny.map((s) => {
              const obsazena = s.employee_id !== null;
              const jmeno = obsazena ? (jmena.get(s.employee_id as string) ?? "Neznámý člověk") : null;

              return (
                <li
                  key={s.id}
                  style={{
                    background: obsazena ? "var(--card)" : "transparent",
                    border: obsazena ? "1px solid var(--line)" : "1px dashed var(--warn)",
                    borderRadius: "12px",
                    padding: "12px 14px",
                    display: "flex",
                    gap: "12px",
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "15px",
                      color: "var(--ink)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {hodina(s.starts_at)}–{hodina(s.ends_at)}
                  </span>

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "15px",
                        color: obsazena ? "var(--ink)" : "var(--warn)",
                      }}
                    >
                      {obsazena ? jmeno : "Neobsazeno"}
                    </span>

                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "var(--muted)",
                        marginTop: "2px",
                      }}
                    >
                      {[
                        s.position_id ? pozice.get(s.position_id) : null,
                        rozsah.level === "tenant"
                          ? (nazvyPobocek.get(s.branch_id) ?? "Jiná pobočka")
                          : null,
                        s.status === "planned" ? "zatím v plánu" : null,
                        s.note
                          ? s.note
                              .replace(/^rozpis\s+/i, "")
                              .split("\n")[0]
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function hodina(cas: string): string {
  return cas.slice(0, 5);
}

const DNY = [
  "neděle",
  "pondělí",
  "úterý",
  "středa",
  "čtvrtek",
  "pátek",
  "sobota",
];

function popisDne(datum: string, dnesni: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  const cislo = `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;

  if (datum === dnesni) return `Dnes · ${cislo}`;

  // Zítřa — spočítáme si dní
  const dnes = new Date(`${dnesni}T00:00:00Z`);
  const zitra = new Date(dnes);
  zitra.setUTCDate(zitra.getUTCDate() + 1);
  const zítraStr = zitra.toISOString().split("T")[0];
  if (datum === zítraStr) return `Zítra · ${cislo}`;

  const den = DNY[d.getUTCDay()];
  return `${den.charAt(0).toUpperCase()}${den.slice(1)} · ${cislo}`;
}
