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

import ZnackaOsoby from "@/app/znacka-osoby";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormularSmeny, { type SmenaKUprave } from "./formular-smeny";
// `import type`, ne `import { type … }`: tenhle soubor z ./sablony nic
// nespouští a serverová akce by se sem tahat neměla vůbec.
import type { NabidnutaSablona } from "./sablony";
// Stejný průvodce jako Nastavení → Nahrání dat → Rozpis směn — žádná
// druhá kopie logiky, jen druhé místo, odkud se dá spustit (Šéfíkovo
// zadání 16.9.2026: nahrání rozpisu patří přímo do Rozpisu směn).
import PruvodceNahranim from "../nastaveni/nahrani/rozpis/pruvodce";

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
  // Vydaná směna se nedá smazat — lidem už je v rozpisu vidět.
  published_at: string | null;
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
  /*
    Barva člověka — klíč z palety, nebo null.

    Chybějící záznam a null znamenají totéž: bez barvy. Vykreslí se
    prázdný čtvereček s obrysem, ne mezera; viz app/znacka-osoby.
  */
  barvy: Map<string, string | null>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
};

export default function RozpisView({
  smeny,
  dnesni,
  dayStartsAt,
  jmena,
  barvy,
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

  /*
    Seskupení po dnech — ale NEJDŘÍV VŠECHNY DNY OBDOBÍ, teprve pak do
    nich směny.

    Mapa se stavěla jen ze směn, takže den, ve kterém ještě nic nebylo,
    nedostal sloupec — a bez sloupce nebylo kam kliknout na „+". V týdnu,
    kde se teprve začíná plánovat, tedy nešlo přidat vůbec nic: prázdný
    den se nekreslil právě proto, že byl prázdný.

    Hlásil to Šéfík 9. 9. 2026: „v kalendáři chybí v dalším týdnu plusy
    na přidání směn."

    Seje se přesně těch `DNU_V_ROZPISU` dnů, které načetla `page.tsx`
    (`odKdy` … `odKdy + DNU_V_ROZPISU - 1`). Obojí čte tutéž konstantu,
    takže se sloupce nemůžou rozejít s daty — a kdyby přesto přišla
    směna mimo to okno, dostane svůj sloupec taky (větev `else` níž).

    Týká se to jen týdenního pohledu; měsíc a den dostávají `smeny`
    a mřížku si staví samy.
  */
  const dny = new Map<string, Smena[]>();
  for (let i = 0; i < DNU_V_ROZPISU; i++) dny.set(posunDatum(den, i), []);
  for (const s of smeny) {
    const seznam = dny.get(s.shift_date);
    if (seznam) seznam.push(s);
    else dny.set(s.shift_date, [s]);
  }

  return (
    <div style={{ padding: "16px", paddingBottom: "32px" }}>
      {/* Navigace — posun období + přepínač pohledů, jeden kompaktní
         řádek (UX redesign, druhé kolo, oddíl 6: "zkompaktni", "zmenši
         prázdný prostor nad gridem" — dřív dva bloky pod sebou). */}
      <Card
        padding="8px 10px"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "16px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            velikost="male"
            onClick={() =>
              updateUrl(
                pohled,
                pohled === "mesic" ? posunMesic(den, -1) : posunDatum(den, pohled === "tyden" ? -7 : -1)
              )
            }
            aria-label="Předchozí období"
          >
            ‹
          </Button>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)", minWidth: "150px", textAlign: "center" }}>
            {popisObdobi(den, pohled)}
          </div>
          <Button
            velikost="male"
            onClick={() =>
              updateUrl(
                pohled,
                pohled === "mesic" ? posunMesic(den, 1) : posunDatum(den, pohled === "tyden" ? 7 : 1)
              )
            }
            aria-label="Následující období"
          >
            ›
          </Button>
          <Button velikost="male" onClick={() => updateUrl(pohled, dnesni)}>
            Dnes
          </Button>
        </div>

        <div className="ft-seg">
          {POHLEDY.map(([klic, nazev]) => (
            <button key={klic} type="button" onClick={() => updateUrl(klic, den)} aria-pressed={pohled === klic}>
              {nazev}
            </button>
          ))}
        </div>
      </Card>

      {/*
        Nahrání rozpisu z tabulky — přímo tady, ne jen v Nastavení
        (Šéfíkovo zadání 16.9.2026). Stejné právo jako ruční zakládání
        směny (`planovani` je `null`, když ho člověk nemá), stejný
        průvodce jako Nastavení → Nahrání dat → Rozpis směn — jedna
        logika, dvě místa, odkud se dá spustit. Sbalené ať nezabírá
        místo, dokud ho někdo nepotřebuje.
      */}
      {planovani ? (
        <details style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: "16px" }}>
          <summary style={{ cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>
            + Nahrát rozpis z tabulky
          </summary>
          <div style={{ marginTop: "4px" }}>
            <PruvodceNahranim rozsah={planovani.rozsah} />
          </div>
        </details>
      ) : null}

      {/* Obsah podle pohledu */}
      {pohled === "tyden" && (
        <TydenView
          dny={dny}
          dnesni={dnesni}
          jmena={jmena}
          barvy={barvy}
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
          barvy={barvy}
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
  barvy,
  pozice,
  nazvyPobocek,
  rozsah,
  planovani,
  onOtevrit,
}: {
  dny: Map<string, Smena[]>;
  dnesni: string;
  jmena: Map<string, string>;
  barvy: Map<string, string | null>;
  pozice: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
  planovani: Planovani | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  // Seřadit dny
  const dnySerad = [...dny.keys()].sort();

  /*
    Sbírat všechny unikátní zaměstnance a jejich směny.

    ŘÁDKY SE ZAKLÁDAJÍ I PRO LIDI BEZ SMĚNY — jinak by v prázdném týdnu
    nebyl ani jeden. Sloupce dnů už se sejí výš, ale bez řádku není
    buňka, a bez buňky není „+": mřížka by byla prázdná a nešlo by do ní
    nic přidat. Druhá půlka téhož nálezu z 9. 9.

    Sejí se jen tehdy, když se vůbec smí plánovat — komu se rozpis jen
    ukazuje, tomu je seznam lidí bez směn k ničemu a jen by mu roztáhl
    mřížku.
  */
  const smenyPeOsobe = new Map<string | null, Map<string, Smena[]>>();
  if (planovani) {
    for (const c of planovani.lide) smenyPeOsobe.set(c.id, new Map());
  }

  /*
    Jméno do řádku. `jmena` plní `page.tsx` jen z lidí, KTEŘÍ MAJÍ
    SMĚNU — nově zasetý řádek by se tedy jmenoval „Neznámý". Druhým
    zdrojem je nabídka „Kdo" z plánování, kde jsou všichni.
  */
  const jmenoOsoby = (id: string): string =>
    jmena.get(id) ??
    planovani?.lide.find((c) => c.id === id)?.jmeno ??
    "Neznámý";
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
    const jmenoA = a ? jmenoOsoby(a) : "Neobsazeno";
    const jmenoB = b ? jmenoOsoby(b) : "Neobsazeno";
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
          <tr style={{ background: "var(--card)", borderBottom: "1px solid var(--line)", position: "sticky", top: "var(--vysoka-lista)", zIndex: 5 }}>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontWeight: 600,
                color: "var(--branch)",
                width: "120px",
                background: "var(--card)",
                position: "sticky",
                left: 0,
                zIndex: 7,
              }}
            >
              Osoba
            </th>
            {dnySerad.map((datum) => {
              const dnesJe = datum === dnesni;
              const vikend = jeVikend(datum);
              return (
                <th
                  key={datum}
                  style={{
                    padding: "8px 12px",
                    textAlign: "center",
                    fontWeight: dnesJe ? 700 : 500,
                    color: "var(--ink)",
                    borderLeft: "1px solid var(--line)",
                    minWidth: "100px",
                    background: dnesJe
                      ? "color-mix(in srgb, var(--mosaz-sv) 16%, var(--card))"
                      : vikend
                        ? "var(--sunken)"
                        : "var(--card)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "pre-line" }}>
                    {popisDneZkracene(datum, dnesni)}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {osoby.map((osoba) => {
            const jmeno = osoba ? jmenoOsoby(osoba) : "Neobsazeno";
            const smenyOsoby = smenyPeOsobe.get(osoba)!;

            return (
              <tr key={osoba ?? "null"} style={{ borderBottom: "1px solid var(--line)" }}>
                <td
                  style={{
                    padding: "9px 12px",
                    fontWeight: osoba ? 500 : 400,
                    color: osoba ? "var(--ink)" : "var(--warn)",
                    background: "var(--card)",
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                  }}
                >
                  {/*
                    Iniciálové kolečko + čtvereček s barvou, ne obarvené
                    jméno. Obarvené jméno by některé odstíny udělalo hůř
                    čitelnými a barva by přebila to, co je na řádku
                    podstatné.

                    Neobsazená směna značku nemá — není čí. Je to jediné
                    místo, kde značka chybí docela.
                  */}
                  {osoba ? (
                    <span
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          flex: "none", width: "26px", height: "26px", borderRadius: "50%",
                          background: "var(--sunken)", color: "var(--muted)",
                          display: "grid", placeItems: "center", fontSize: "10.5px", fontWeight: 700,
                        }}
                      >
                        {inicialy(jmeno)}
                      </span>
                      <ZnackaOsoby barva={barvy.get(osoba) ?? null} />
                      {jmeno}
                    </span>
                  ) : (
                    jmeno
                  )}
                </td>
                {dnySerad.map((datum) => {
                  const smenyDne = smenyOsoby.get(datum) ?? [];
                  const dnesJe = datum === dnesni;
                  const vikend = jeVikend(datum);
                  return (
                    <td
                      key={`${osoba}-${datum}`}
                      className="ft-rozpis-bunka"
                      style={{
                        padding: "9px 12px",
                        textAlign: "center",
                        borderLeft: "1px solid var(--line)",
                        background:
                          smenyDne.length > 0
                            ? "var(--card)"
                            : dnesJe
                              ? "color-mix(in srgb, var(--mosaz-sv) 8%, var(--paper))"
                              : vikend
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
                          formulář se otevře skoro vyplněný. Trvale
                          vidět nemá být (oddíl 6: "prázdná buňka má
                          být čistá") — zobrazí se až na najetí nebo
                          zaměření, viz .ft-rozpis-plus v globals.css.
                        */}
                        {planovani ? (
                          <button
                            type="button"
                            className="ft-rozpis-plus"
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

/** Neděle/sobota z data ve tvaru RRRR-MM-DD. */
function jeVikend(datum: string): boolean {
  const den = new Date(`${datum}T00:00:00Z`).getUTCDay();
  return den === 0 || den === 6;
}

/** Iniciály ze jména — první písmeno prvních dvou slov, jinak první dvě písmena. */
function inicialy(jmeno: string): string {
  const slova = jmeno.split(/\s+/).filter(Boolean);
  if (slova.length >= 2) return (slova[0][0] + slova[1][0]).toUpperCase();
  return (jmeno.slice(0, 2) || "?").toUpperCase();
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
  barvy,
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
  barvy: Map<string, string | null>;
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
              <div style={{ width: "80px", flexShrink: 0, padding: "8px", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: "6px" }}>
                {obsazena ? <ZnackaOsoby barva={barvy.get(s.employee_id as string) ?? null} velikost={8} /> : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{jmeno}</span>
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
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    // Vlevo místo na proužek s barvou člověka.
                    padding: "0 4px 0 8px",
                    fontSize: "11px",
                    color: obsazena ? "var(--branch)" : "var(--pozor)",
                    whiteSpace: "nowrap" as const,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  };

                  /*
                    PLOCHA JE POBOČKA, PROUŽEK JE ČLOVĚK.

                    Výplň a rámeček pruhu drží barvu pobočky
                    (`--branch-soft` / `--branch`). Barva člověka se do
                    nich plést nesmí — dnes mají obě pobočky Růžovou,
                    takže rozdíl odstínu by nikoho nezachránil. Proto
                    úzký proužek na náběžné hraně a vlastní proměnná
                    `--osoba`.

                    U neobsazené směny žádný není: není čí.
                  */
                  const barvaOsoby = obsazena
                    ? barvy.get(s.employee_id as string) ?? null
                    : null;
                  const prouzek = barvaOsoby ? (
                    <span
                      aria-hidden="true"
                      data-osoba={barvaOsoby}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: "4px",
                        borderRadius: "4px 0 0 4px",
                        background: "var(--osoba)",
                      }}
                    />
                  ) : null;

                  const obsah = `${hodina(s.starts_at)}–${hodina(s.ends_at)}`;
                  return planovani ? (
                    <button
                      type="button"
                      onClick={() => onOtevrit({ den, smena: s })}
                      style={{ ...styl, cursor: "pointer", font: "inherit", fontSize: "11px" }}
                      title="Upravit směnu"
                    >
                      {prouzek}
                      {obsah}
                    </button>
                  ) : (
                    <div style={styl}>
                      {prouzek}
                      {obsah}
                    </div>
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
                  borderRadius: "var(--radius-md)",
                  border: denNum ? "1px solid var(--line)" : "none",
                  boxShadow: denNum && datumStr === den ? "var(--shadow-sm)" : "none",
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
  padding: "5px 7px",
  background: "var(--card)",
  border: "1px solid var(--branch)",
  borderRadius: "var(--radius-sm)",
  color: "var(--branch)",
  fontWeight: 600 as const,
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
  Viditelnost řídí .ft-rozpis-plus v globals.css (najetí/zaměření,
  UX redesign druhé kolo oddíl 6: "prázdná buňka má být čistá") — tady
  zůstává jen vzhled samotného tlačítka.
*/
const pridatTlacitko = {
  fontSize: "13px",
  lineHeight: 1,
  padding: "3px 6px",
  background: "transparent",
  border: "1px dashed var(--line-2)",
  borderRadius: "var(--radius-sm)",
  color: "var(--muted)",
  cursor: "pointer",
} as const;
