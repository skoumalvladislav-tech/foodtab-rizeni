"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pocet } from "@/lib/sklonovani";
import { DNU_V_ROZPISU } from "@/lib/rozpis-konstanty";

// Posun data (z lib/provozni-den.ts, duplikovaný pro klient)
function posunDatum(datum: string, dnu: number): string {
  const [r, m, d] = datum.split("-").map(Number);
  const posunuty = new Date(Date.UTC(r, m - 1, d + dnu));
  return posunuty.toISOString().slice(0, 10);
}

// Posun měsíce (měsíční aritmetika, ne ±30 dnů)
function posunMesic(datum: string, mesicu: number): string {
  const [r, m] = datum.split("-").map(Number);
  const posunuty = new Date(Date.UTC(r, m - 1 + mesicu, 1));
  return posunuty.toISOString().slice(0, 10);
}

import FormularSmeny, { type SmenaKUprave } from "./formular-smeny";
// `import type`, ne `import { type … }`: tenhle soubor z ./sablony nic
// nespouští a serverová akce by se sem tahat neměla vůbec.
import type { NabidnutaSablona } from "./sablony";

type Pohled = "mesic" | "tyden" | "den";

/**
 * Co obrazovka potřebuje, aby šlo směnu založit.
 *
 * `null` znamená „tenhle člověk plánovat nesmí“ — pak se tlačítka
 * nekreslí. Zámek to není: rozhoduje `shifts.manage` v databázi,
 * tady jde jen o to, aby se nenabízelo, co stejně neprojde.
 */
export type Planovani = {
  rozsah: string;
  pobocky: { id: string; nazev: string }[];
  vychoziPobocka: string | null;
  lide: { id: string; jmeno: string }[];
  pozice: { id: string; label: string }[];
  /*
    Šablony pro VÝCHOZÍ pobočku. Formulář si je po otevření dotáhne
    znovu podle toho, co je zrovna vybrané — tohle je jen proto, aby
    nabídka stála hned při prvním vykreslení a neprobliklo prázdno.
  */
  sablony: NabidnutaSablona[];
};

/** Které okno je otevřené. `smena` prázdná = nová. */
type Otevrene = { den: string; smena: SmenaKUprave | null };

/** Volby přepínače nahoře. Pořadí od nejširšího po nejužší. */
const POHLEDY: [Pohled, string][] = [
  ["mesic", "Měsíc"],
  ["tyden", "Týden"],
  ["den", "Den"],
];

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
  planovani,
}: Props & { planovani: Planovani | null }) {
  const router = useRouter();
  const [otevrene, setOtevrene] = useState<Otevrene | null>(null);
  const searchParams = useSearchParams();

  // Přečíst z URL nebo použít výchozí
  const pohledZUrl = searchParams.get("pohled") ?? "tyden";
  const denZUrl = searchParams.get("den") ?? dnesni;

  // Validace
  const pohled = (POHLEDY.some(([k]) => k === pohledZUrl) ? pohledZUrl : "tyden") as Pohled;
  const den = denZUrl;

  const updateUrl = (newPohled: Pohled, newDay: string) => {
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
    <div style={{ padding: "16px", paddingBottom: "32px" }}>
      {/* Navigace — posun období */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          padding: "12px",
          background: "var(--card)",
          borderRadius: "8px",
          border: "1px solid var(--line)",
        }}
      >
        <button
          onClick={() =>
            updateUrl(
              pohled,
              pohled === "mesic" ? posunMesic(den, -1) : posunDatum(den, pohled === "tyden" ? -7 : -1)
            )
          }
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
          aria-label="Předchozí období"
        >
          ‹
        </button>

        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--branch)" }}>
            {popisObdobi(den, pohled)}
          </div>
        </div>

        <button
          onClick={() => updateUrl(pohled, dnesni)}
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
        >
          Dnes
        </button>

        <button
          onClick={() =>
            updateUrl(
              pohled,
              pohled === "mesic" ? posunMesic(den, 1) : posunDatum(den, pohled === "tyden" ? 7 : 1)
            )
          }
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
          aria-label="Následující období"
        >
          ›
        </button>
      </div>

      {/* Přepínač pohledů */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {POHLEDY.map(([klic, nazev]) => (
          <button
            key={klic}
            onClick={() => updateUrl(klic, den)}
            className="ft-tl ft-tl-vedlejsi"
            aria-pressed={pohled === klic}
          >
            {nazev}
          </button>
        ))}
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
          planovani={planovani}
          onOtevrit={setOtevrene}
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
          planovani={planovani}
          onOtevrit={setOtevrene}
        />
      )}

      {/*
        V měsíčním pohledu se nezakládá schválně (zadání, bod 2): do dne
        se tam neklikne přesně a člověk by směnu zapsal o den vedle.
      */}

      {planovani && otevrene ? (
        <FormularSmeny
          /*
            key podle toho, co se otevřelo. defaultValue se uplatní jen
            při prvním připojení — kdyby se okno znovupoužilo pro jinou
            směnu, zůstaly by v něm časy té předchozí. Přesně tak se
            2. 9. předvyplňoval odchod jako příchod.
          */
          key={otevrene.smena?.id || `nova-${otevrene.den}`}
          rozsah={planovani.rozsah}
          den={otevrene.den}
          smena={otevrene.smena}
          pobocky={planovani.pobocky}
          vychoziPobocka={planovani.vychoziPobocka}
          lide={planovani.lide}
          pozice={planovani.pozice}
          sablony={planovani.sablony}
          onZavrit={() => setOtevrene(null)}
        />
      ) : null}
    </div>
  );
}

function TydenView({
  dny,
  dnesni,
  jmena,
  pozice,
  nazvyPobocek,
  rozsah,
  planovani,
  onOtevrit,
}: {
  dny: Map<string, Smena[]>;
  dnesni: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
  planovani: Planovani | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  // Seřadit dny
  const dnySerad = [...dny.keys()].sort();

  // Sbírat všechny unikátní zaměstnance a jejich směny
  const smenyPeOsobe = new Map<string | null, Map<string, Smena[]>>();
  for (const [datum, smeny] of dny.entries()) {
    for (const s of smeny) {
      const osoba = s.employee_id;
      if (!smenyPeOsobe.has(osoba)) {
        smenyPeOsobe.set(osoba, new Map());
      }
      const denMap = smenyPeOsobe.get(osoba)!;
      const seznam = denMap.get(datum) ?? [];
      seznam.push(s);
      denMap.set(datum, seznam);
    }
  }

  // Seřadit osoby
  const osoby = [...smenyPeOsobe.keys()].sort((a, b) => {
    const jmenoA = a ? jmena.get(a) ?? "Neznámý" : "Neobsazeno";
    const jmenoB = b ? jmena.get(b) ?? "Neznámý" : "Neobsazeno";
    return jmenoA.localeCompare(jmenoB);
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          minWidth: "600px",
          fontSize: "13px",
        }}
      >
        <thead>
          <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontWeight: 600,
                color: "var(--branch)",
                width: "120px",
              }}
            >
              Osoba
            </th>
            {dnySerad.map((datum) => (
              <th
                key={datum}
                style={{
                  padding: "8px 12px",
                  textAlign: "center",
                  fontWeight: 500,
                  color: "var(--ink)",
                  borderLeft: "1px solid var(--line)",
                  minWidth: "100px",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {popisDneZkracene(datum, dnesni)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {osoby.map((osoba) => {
            const jmeno = osoba ? jmena.get(osoba) ?? "Neznámý" : "Neobsazeno";
            const smenyOsoby = smenyPeOsobe.get(osoba)!;

            return (
              <tr key={osoba ?? "null"} style={{ borderBottom: "1px solid var(--line)" }}>
                <td
                  style={{
                    padding: "8px 12px",
                    fontWeight: osoba ? 500 : 400,
                    color: osoba ? "var(--ink)" : "var(--warn)",
                  }}
                >
                  {jmeno}
                </td>
                {dnySerad.map((datum) => {
                  const smenyDne = smenyOsoby.get(datum) ?? [];
                  return (
                    <td
                      key={`${osoba}-${datum}`}
                      style={{
                        padding: "8px 12px",
                        textAlign: "center",
                        borderLeft: "1px solid var(--line)",
                        background:
                          smenyDne.length > 0
                            ? "var(--card)"
                            : datum === dnesni
                              ? "var(--sunken)"
                              : "transparent",
                      }}
                    >
                      <div style={{ display: "grid", gap: "4px" }}>
                        {smenyDne.map((s) =>
                          planovani ? (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => onOtevrit({ den: datum, smena: s })}
                              style={chipTlacitko}
                              title="Upravit směnu"
                            >
                              {hodina(s.starts_at)}–{hodina(s.ends_at)}
                            </button>
                          ) : (
                            <div key={s.id} style={chip}>
                              {hodina(s.starts_at)}–{hodina(s.ends_at)}
                            </div>
                          ),
                        )}

                        {/*
                          Prázdné políčko je taky místo, kam se dá
                          kliknout — člověk i den už jsou dané, takže
                          formulář se otevře skoro vyplněný. Křížek je
                          bledý schválně: nemá přebít rozpis samotný.
                        */}
                        {planovani ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOtevrit({
                                den: datum,
                                smena: osoba
                                  ? ({
                                      id: "",
                                      branch_id: planovani.vychoziPobocka ?? "",
                                      employee_id: osoba,
                                      position_id: null,
                                      shift_date: datum,
                                      starts_at: "08:00",
                                      ends_at: "16:00",
                                      note: "",
                                    } as SmenaKUprave)
                                  : null,
                              })
                            }
                            style={pridatTlacitko}
                            aria-label={`Přidat směnu ${datum}`}
                          >
                            +
                          </button>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function popisObdobi(den: string, pohled: Pohled): string {
  const d = new Date(`${den}T00:00:00Z`);

  if (pohled === "mesic") {
    const mesice = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
    return `${mesice[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  if (pohled === "tyden") {
    // Okno běží od zvoleného dne dopředu, ne od pondělí. Dotaz na směny
    // to tak dělá taky — obojí čte DNU_V_ROZPISU, takže se to nemůže
    // rozejít. Dřív se tady snapovalo na kalendářní týden a hlavička
    // hlásila jiné dny, než byly ve sloupcích.
    const konec = new Date(d);
    konec.setUTCDate(d.getUTCDate() + DNU_V_ROZPISU - 1);

    const mesice = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
    const m1 = mesice[d.getUTCMonth()];
    const m2 = mesice[konec.getUTCMonth()];

    if (d.getUTCMonth() === konec.getUTCMonth()) {
      return `${d.getUTCDate()}.–${konec.getUTCDate()}. ${m1}`;
    }
    return `${d.getUTCDate()}. ${m1} – ${konec.getUTCDate()}. ${m2}`;
  }

  const dny = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const mesice = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${mesice[d.getUTCMonth()]}`;
}

function popisDneZkracene(datum: string, dnesni: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  const den = DNY[d.getUTCDay()];
  const skratka = den.slice(0, 2).toUpperCase();
  const cislo = d.getUTCDate();

  if (datum === dnesni) return `Dnes\n${cislo}.`;

  const dnes = new Date(`${dnesni}T00:00:00Z`);
  const zitra = new Date(dnes);
  zitra.setUTCDate(zitra.getUTCDate() + 1);
  const zítraStr = zitra.toISOString().split("T")[0];
  if (datum === zítraStr) return `Zítra\n${cislo}.`;

  return `${skratka}\n${cislo}.`;
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
  planovani,
  onOtevrit,
}: {
  smeny: Smena[];
  den: string;
  dnesni: string;
  dayStartsAt: string;
  jmena: Map<string, string>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
  planovani: Planovani | null;
  onOtevrit: (co: Otevrene) => void;
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

  // "Teď" indikátor — jen pro dnešní den a jen v prohlížeči.
  //
  // Čára se počítá z new Date(). Tahle komponenta je sice klientská, ale
  // Next ji stejně vykreslí i na serveru, aby měl co poslat v HTML —
  // a server má jiné hodiny a hlavně jiný okamžik než prohlížeč.
  // Vyšlo tedy pokaždé jiné procento, obě vykreslení se rozešla a React
  // hlásil neshodu při hydrataci.
  //
  // Na serveru i při prvním vykreslení v prohlížeči je proto null, tedy
  // žádná čára — obojí vypadá stejně a hydratace sedne. Doplní se hned
  // po připojení, kdy už se není s čím rozcházet.
  const vProhlizeci = useVProhlizeci();
  const ted = vProhlizeci && den === dnesni ? getTedMinuta(osStart) : null;

  // Podíl (0–100%) — kolik procent dne uplynulo?
  const tedProc = ted !== null ? (ted / osTotalMin) * 100 : null;

  // Layout: 1200px = 24 hodin, 50px za hodinu
  const pixelPerMin = 1200 / osTotalMin;
  const rowHeight = 48;

  return (
    <div style={{ display: "grid", gap: "0px" }}>
      {planovani ? (
        <div style={{ marginBottom: "12px" }}>
          <button
            type="button"
            onClick={() => onOtevrit({ den, smena: null })}
            className="ft-tl ft-tl-hlavni ft-tl-male"
          >
            + Přidat směnu
          </button>
        </div>
      ) : null}

      {/* Záhlaví — časová osa */}
      <div style={{ display: "flex", height: "32px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--card)", zIndex: 5 }}>
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
                {/* Pruh směny. Kdo smí plánovat, může na něj kliknout. */}
                {(() => {
                  const styl = {
                    position: "absolute" as const,
                    left: `${left}px`,
                    top: "8px",
                    width: `${width}px`,
                    height: `${rowHeight - 16}px`,
                    background: obsazena ? "var(--branch-soft)" : "var(--pozor-bg)",
                    border: `1px solid ${obsazena ? "var(--branch)" : "var(--pozor)"}`,
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 4px",
                    fontSize: "11px",
                    color: obsazena ? "var(--branch)" : "var(--pozor)",
                    whiteSpace: "nowrap" as const,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  };
                  const obsah = `${hodina(s.starts_at)}–${hodina(s.ends_at)}`;
                  return planovani ? (
                    <button
                      type="button"
                      onClick={() => onOtevrit({ den, smena: s })}
                      style={{ ...styl, cursor: "pointer", font: "inherit", fontSize: "11px" }}
                      title="Upravit směnu"
                    >
                      {obsah}
                    </button>
                  ) : (
                    <div style={styl}>{obsah}</div>
                  );
                })()}
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

/* Prázdné odhlášení. Musí to být stálá hodnota, jinak by se React
   přihlašoval znovu při každém vykreslení. */
const NEODEBIRAT = () => () => {};

/**
 * Běžíme už v prohlížeči?
 *
 * Vrací false na serveru i při prvním vykreslení v prohlížeči, teprve
 * potom true. Obě strany tak vykreslí totéž a hydratace sedne; co se
 * liší, se dopočítá až v druhém průchodu.
 *
 * Patří sem cokoli, co se ptá na aktuální čas — server má jiné hodiny
 * i jiný okamžik než prohlížeč a nikdy se netrefí. Přes useState
 * v efektu se to dělat nedá: nastavit stav rovnou v efektu spustí
 * druhé vykreslení navíc a hlídá to i lint.
 */
function useVProhlizeci(): boolean {
  return useSyncExternalStore(
    NEODEBIRAT,
    () => true,
    () => false,
  );
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
                        {pocet(pocetSmeny, "směna", "směny", "směn")}
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

/* --- styly zadávání ------------------------------------------------ */

const chip = {
  fontSize: "11px",
  padding: "4px 6px",
  background: "var(--sunken)",
  border: "1px solid var(--line-2)",
  borderRadius: "4px",
  color: "var(--ink)",
  fontVariantNumeric: "tabular-nums" as const,
} as const;

const chipTlacitko = {
  ...chip,
  cursor: "pointer",
  font: "inherit",
  fontSize: "11px",
  width: "100%",
} as const;

/*
  Bledý křížek. Je v každém prázdném políčku, takže nesmí přebít
  samotný rozpis — teprve po najetí ztmavne.
*/
const pridatTlacitko = {
  fontSize: "13px",
  lineHeight: 1,
  padding: "3px 6px",
  background: "transparent",
  border: "1px dashed var(--line-2)",
  borderRadius: "4px",
  color: "var(--muted)",
  cursor: "pointer",
  opacity: 0.55,
} as const;
