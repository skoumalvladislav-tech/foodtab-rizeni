"use client";

import { useRouter, useSearchParams } from "next/navigation";

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
  dayStartsAt: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
};

export default function RozpisView({
  smeny,
  dnesni,
  dayStartsAt,
  jmena,
  pozice,
  nazvyPobocek,
  rozsah,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Přečíst z URL nebo použít výchozí
  const pohledZUrl = searchParams.get("pohled") ?? "tyden";
  const denZUrl = searchParams.get("den") ?? dnesni;

  // Validace
  const pohled = (["mesic", "tyden", "den"].includes(pohledZUrl) ? pohledZUrl : "tyden") as "mesic" | "tyden" | "den";
  const den = denZUrl;

  const updateUrl = (newPohled: "mesic" | "tyden" | "den", newDay: string) => {
    const params = new URLSearchParams();
    params.set("pohled", newPohled);
    params.set("den", newDay);
    router.push(`?${params.toString()}`);
  };

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
          onClick={() => updateUrl("mesic", den)}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: pohled === "mesic" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: pohled === "mesic" ? "var(--branch-soft)" : "transparent",
            color: pohled === "mesic" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: pohled === "mesic" ? 600 : 500,
          }}
        >
          Měsíc
        </button>
        <button
          onClick={() => updateUrl("tyden", den)}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: pohled === "tyden" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: pohled === "tyden" ? "var(--branch-soft)" : "transparent",
            color: pohled === "tyden" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: pohled === "tyden" ? 600 : 500,
          }}
        >
          Týden
        </button>
        <button
          onClick={() => updateUrl("den", den)}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: pohled === "den" ? "2px solid var(--branch)" : "1px solid var(--line)",
            background: pohled === "den" ? "var(--branch-soft)" : "transparent",
            color: pohled === "den" ? "var(--branch)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: pohled === "den" ? 600 : 500,
          }}
        >
          Den
        </button>
      </div>

      {/* Obsah podle pohledu */}
      {pohled === "tyden" && (
        <TydenView
          dny={dny}
          dnesni={dnesni}
          jmena={jmena}
          pozice={pozice}
          nazvyPobocek={nazvyPobocek}
          rozsah={rozsah}
        />
      )}

      {pohled === "mesic" && (
        <MesicView
          smeny={smeny}
          den={den}
          onSelectDay={(newDay) => updateUrl("den", newDay)}
        />
      )}

      {pohled === "den" && (
        <DenView
          smeny={smeny}
          den={den}
          dnesni={dnesni}
          dayStartsAt={dayStartsAt}
          jmena={jmena}
          pozice={pozice}
          nazvyPobocek={nazvyPobocek}
          rozsah={rozsah}
        />
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

function DenView({
  smeny,
  den,
  dnesni,
  dayStartsAt,
  jmena,
  pozice,
  nazvyPobocek,
  rozsah,
}: {
  smeny: Smena[];
  den: string;
  dnesni: string;
  dayStartsAt: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
}) {
  // Smeny na daný den
  const smenySeDnem = smeny.filter((s) => s.shift_date === den);

  // Parsuj dayStartsAt (např. "05:00")
  const [hodStart, minStart] = dayStartsAt.split(":").map(Number);
  const osStart = hodStart * 60 + minStart; // v minutách od půlnoci
  const osTotalMin = 24 * 60; // délka provozního dne (24 hodin)

  // Pomocná funkce: převede čas HH:MM na minuty od osStart
  const casNaMinuty = (cas: string): number => {
    const [h, m] = cas.split(":").map(Number);
    let casVMin = h * 60 + m;
    // Pokud je čas "do zítřka" (menší než osStart), přičti 24 hodin
    // (znamená to, že směna pokračuje do příštího provozního dne)
    if (casVMin < osStart && h < 12) {
      casVMin += 24 * 60;
    }
    return casVMin - osStart;
  };

  // Seřaď směny
  const serazeno = [...smenySeDnem].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // Identifikuj mezery — doby bez obsazení
  const mezery: Array<{ od: number; do: number }> = [];
  if (serazeno.length === 0) {
    mezery.push({ od: 0, do: osTotalMin });
  } else {
    let posledniKonec = 0;
    for (const s of serazeno) {
      const zacatek = casNaMinuty(s.starts_at);
      const konec = casNaMinuty(s.ends_at);
      if (zacatek > posledniKonec) {
        mezery.push({ od: posledniKonec, do: zacatek });
      }
      posledniKonec = Math.max(posledniKonec, konec);
    }
    if (posledniKonec < osTotalMin) {
      mezery.push({ od: posledniKonec, do: osTotalMin });
    }
  }

  // "Teď" indikátor — jen pro dnešní den
  const ted = den === dnesni ? getTedMinuta(osStart) : null;

  // Podíl (0–100%) — kolik procent dne uplynulo?
  const tedProc = ted !== null ? (ted / osTotalMin) * 100 : null;

  // Layout: 1200px = 24 hodin, 50px za hodinu
  const pixelPerMin = 1200 / osTotalMin;
  const rowHeight = 48;

  return (
    <div style={{ display: "grid", gap: "0px" }}>
      {/* Záhlaví — časová osa */}
      <div style={{ display: "flex", height: "32px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 5 }}>
        <div style={{ width: "80px", flexShrink: 0, padding: "4px", fontSize: "11px", fontWeight: 600 }}>Čas</div>
        <div style={{ flex: 1, position: "relative", minWidth: "1200px" }}>
          {Array.from({ length: 24 }).map((_, i) => {
            const h = (hodStart + i) % 24;
            const x = i * (1200 / 24);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${x}px`,
                  top: 0,
                  width: "50px",
                  height: "100%",
                  borderLeft: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  color: "var(--muted)",
                }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            );
          })}
        </div>
      </div>

      {/* Řady se směnami */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {serazeno.map((s, idx) => {
          const obsazena = s.employee_id !== null;
          const jmeno = obsazena ? jmena.get(s.employee_id as string) ?? "Neznámý" : "Neobsazeno";
          const zacatek = casNaMinuty(s.starts_at);
          const konec = casNaMinuty(s.ends_at);
          const left = zacatek * pixelPerMin;
          const width = (konec - zacatek) * pixelPerMin;

          return (
            <div key={s.id} style={{ display: "flex", height: `${rowHeight}px`, borderBottom: "1px solid var(--line)", position: "relative" }}>
              <div style={{ width: "80px", flexShrink: 0, padding: "8px", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center" }}>
                {jmeno}
              </div>
              <div style={{ flex: 1, position: "relative", minWidth: "1200px" }}>
                {/* Pruh směny */}
                <div
                  style={{
                    position: "absolute",
                    left: `${left}px`,
                    top: "8px",
                    width: `${width}px`,
                    height: `${rowHeight - 16}px`,
                    background: obsazena ? "var(--branch-soft)" : "var(--warn)",
                    border: `1px solid ${obsazena ? "var(--branch)" : "var(--warn-dark)"}`,
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 4px",
                    fontSize: "11px",
                    color: obsazena ? "var(--branch)" : "var(--warn)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {hodina(s.starts_at)}–{hodina(s.ends_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mezery — horizontální pásy pod řadami */}
      {mezery.length > 0 && (
        <div style={{ display: "flex" }}>
          <div style={{ width: "80px", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: "1200px", position: "relative", height: `${mezery.length * rowHeight}px` }}>
            {mezery.map((m, i) => (
              <div
                key={`gap-${i}`}
                style={{
                  position: "absolute",
                  top: `${i * rowHeight}px`,
                  left: `${m.od * pixelPerMin}px`,
                  width: `${(m.do - m.od) * pixelPerMin}px`,
                  height: `${rowHeight}px`,
                  background: "rgba(100, 100, 100, 0.08)",
                  borderTop: "1px dashed var(--line)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* "Teď" indikátor — svislá čára */}
      {tedProc !== null && (
        <div style={{ display: "flex", position: "absolute", top: 0, left: "80px", right: 0, height: "100%", pointerEvents: "none", zIndex: 3 }}>
          <div
            style={{
              position: "absolute",
              left: `${tedProc}%`,
              top: 0,
              bottom: 0,
              width: "2px",
              background: "var(--warn)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function getTedMinuta(osStart: number): number {
  const ted = new Date();
  const tedMin = ted.getHours() * 60 + ted.getMinutes();
  return tedMin - osStart;
}

function MesicView({
  smeny,
  den,
  onSelectDay,
}: {
  smeny: Smena[];
  den: string;
  onSelectDay: (day: string) => void;
}) {
  // Rozložit datum na rok a měsíc
  const [rok, mesic] = den.split("-");
  const mesicNum = parseInt(mesic);
  const rokNum = parseInt(rok);

  // Počet dnů v měsíci
  const pocetDnuVMesici = new Date(rokNum, mesicNum, 0).getDate();

  // První den měsíce (0 = neděle, 1 = pondělí, ...)
  const prvniDen = new Date(`${rok}-${mesic}-01T00:00:00Z`);
  const prvniDenTydne = prvniDen.getUTCDay();

  // Seskupit směny po dnech
  const smenePoDnech = new Map<number, Smena[]>();
  for (const s of smeny) {
    const [s_rok, s_mesic, s_den] = s.shift_date.split("-");
    if (s_rok === rok && s_mesic === mesic) {
      const denNum = parseInt(s_den);
      const seznam = smenePoDnech.get(denNum) ?? [];
      seznam.push(s);
      smenePoDnech.set(denNum, seznam);
    }
  }

  // Zjistit chybějící lidi v každém dni
  const chybejiciPoDnech = new Map<number, number>();
  for (let denNum = 1; denNum <= pocetDnuVMesici; denNum++) {
    const smenyDne = smenePoDnech.get(denNum) ?? [];
    const chybejici = smenyDne.filter((s) => s.employee_id === null).length;
    chybejiciPoDnech.set(denNum, chybejici);
  }

  // Mřížka: řádky jsou týdny, sloupce jsou dny
  const tydny = [];
  let radek = Array(7).fill(null);
  let indexVRadku = prvniDenTydne;

  for (let denNum = 1; denNum <= pocetDnuVMesici; denNum++) {
    radek[indexVRadku] = denNum;
    indexVRadku++;
    if (indexVRadku === 7) {
      tydny.push([...radek]);
      radek = Array(7).fill(null);
      indexVRadku = 0;
    }
  }
  if (radek.some((x) => x !== null)) {
    tydny.push(radek);
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {tydny.map((radek_items, tydenIdx) => (
        <div
          key={tydenIdx}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: "8px",
          }}
        >
          {radek_items.map((denNum, sloupecIdx) => {
            const datumStr = denNum
              ? `${rok}-${String(mesic).padStart(2, "0")}-${String(denNum).padStart(2, "0")}`
              : "";

            const pocetSmeny = smenePoDnech.get(denNum)?.length ?? 0;
            const pocetChybejicich = chybejiciPoDnech.get(denNum) ?? 0;

            return (
              <button
                key={sloupecIdx}
                onClick={() => denNum && onSelectDay(datumStr)}
                style={{
                  padding: "12px 8px",
                  borderRadius: "8px",
                  border: denNum ? "1px solid var(--line)" : "none",
                  background:
                    denNum && datumStr === den
                      ? "var(--branch-soft)"
                      : denNum && pocetSmeny === 0
                        ? "transparent"
                        : denNum
                          ? "var(--card)"
                          : "transparent",
                  cursor: denNum ? "pointer" : "default",
                  fontSize: "13px",
                  color: denNum ? "var(--ink)" : "transparent",
                  textAlign: "center",
                  minHeight: "60px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {denNum && (
                  <>
                    <strong>{denNum}</strong>
                    {pocetSmeny > 0 && (
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {pocetSmeny} směn{pocetSmeny === 1 ? "a" : ""}
                      </span>
                    )}
                    {pocetChybejicich > 0 && (
                      <span style={{ fontSize: "12px", color: "var(--warn)" }}>
                        {pocetChybejicich} chybí
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
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
