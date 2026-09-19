"use client";

import { Fragment, useState, useSyncExternalStore } from "react";
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
  // Trhaná směna — pauza uvnitř (migrace 20260916200000). Obě, nebo žádná.
  pauza_od: string | null;
  pauza_do: string | null;
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
  /** Domovský úsek každého člověka (employees.usek_id) — pro seskupení týdenní mřížky. */
  domovskeUseky: Map<string, string | null>;
  /** Název úseku podle id (useky.nazev). */
  nazvyUseku: Map<string, string>;
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
  domovskeUseky,
  nazvyUseku,
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
            <PruvodceNahranim rozsah={planovani.rozsah} pobocky={planovani.pobocky} />
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
          domovskeUseky={domovskeUseky}
          nazvyUseku={nazvyUseku}
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

/** Jeden člověk (nebo "Neobsazeno") a jeho směny v týdnu — po dnech. */
type RadekOsoby = { osoba: string | null; jmeno: string; smenyPodleDne: Map<string, Smena[]> };

function TydenView({
  dny,
  dnesni,
  jmena,
  barvy,
  domovskeUseky,
  nazvyUseku,
  nazvyPobocek,
  rozsah,
  planovani,
  onOtevrit,
}: {
  dny: Map<string, Smena[]>;
  dnesni: string;
  jmena: Map<string, string>;
  barvy: Map<string, string | null>;
  domovskeUseky: Map<string, string | null>;
  nazvyUseku: Map<string, string>;
  nazvyPobocek: Map<string, string>;
  rozsah: RozsahContext;
  planovani: Planovani | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  // Seřadit dny
  const dnySerad = [...dny.keys()].sort();

  /*
    Jméno do řádku. `jmena` plní `page.tsx` jen z lidí, KTEŘÍ MAJÍ
    SMĚNU — nově zasetý řádek by se tedy jmenoval „Neznámý". Druhým
    zdrojem je nabídka „Kdo" z plánování, kde jsou všichni.
  */
  const jmenoOsoby = (id: string): string =>
    jmena.get(id) ??
    planovani?.lide.find((c) => c.id === id)?.jmeno ??
    "Neznámý";

  /*
    UX redesign, druhé kolo (Šéfíkovo zadání 16.9.2026): rozpis má
    ukazovat pobočky a úsek pod sebou, ne všechny lidi v jednom
    seznamu — na "Celá firma" se dřív míchali lidé z obou poboček
    dohromady.

    Pobočka skupiny se bere ze SMĚNY (`shift.branch_id`) — člověk sám
    žádnou pevnou pobočku nemá, může mít ten týden směny na obou.
    Řádek člověka se proto může objevit ve víc skupinách zvlášť.

    ÚSEK je JINÁ VĚC než pozice a bere se z ČLOVĚKA
    (employees.usek_id — "do jakého týmu patří", Kuchyně/Bar/Vedení),
    ne ze směny. Šéfík 16.9.2026: "nefungují úseky u jednotlivých
    poboček" — dřív se tu omylem používala pozice ze směny
    (position_id), což je úplně jiná osa (čím člověk je / co smí).
    Kdo úsek nemá přiřazený (Nastavení → Lidé), padne do "Bez úseku".
  */
  const smenyPodlePobocce = new Map<string, Smena[]>();
  for (const smeny of dny.values()) {
    for (const s of smeny) {
      const seznam = smenyPodlePobocce.get(s.branch_id) ?? [];
      seznam.push(s);
      smenyPodlePobocce.set(s.branch_id, seznam);
    }
  }

  function sestavRadky(smenySeznam: Smena[]): RadekOsoby[] {
    const podleOsoby = new Map<string | null, Map<string, Smena[]>>();
    for (const s of smenySeznam) {
      const osoba = s.employee_id;
      if (!podleOsoby.has(osoba)) podleOsoby.set(osoba, new Map());
      const denMap = podleOsoby.get(osoba)!;
      const seznam = denMap.get(s.shift_date) ?? [];
      seznam.push(s);
      denMap.set(s.shift_date, seznam);
    }
    return [...podleOsoby.entries()]
      .map(([osoba, smenyPodleDne]) => ({
        osoba,
        jmeno: osoba ? jmenoOsoby(osoba) : "Neobsazeno",
        smenyPodleDne,
      }))
      .sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs"));
  }

  function usekRadku(radek: RadekOsoby): string {
    if (!radek.osoba) return "Bez úseku";
    const usekId = domovskeUseky.get(radek.osoba);
    return usekId ? (nazvyUseku.get(usekId) ?? "Bez úseku") : "Bez úseku";
  }

  function seskupPodleUseku(radky: RadekOsoby[]): { usek: string; radky: RadekOsoby[] }[] {
    const mapa = new Map<string, RadekOsoby[]>();
    for (const r of radky) {
      const usek = usekRadku(r);
      const seznam = mapa.get(usek) ?? [];
      seznam.push(r);
      mapa.set(usek, seznam);
    }
    return [...mapa.entries()]
      .map(([usek, radky]) => ({ usek, radky }))
      .sort((a, b) => {
        if (a.usek === "Bez úseku") return 1;
        if (b.usek === "Bez úseku") return -1;
        return a.usek.localeCompare(b.usek, "cs");
      });
  }

  const branchIds = [...smenyPodlePobocce.keys()].sort((a, b) =>
    (nazvyPobocek.get(a) ?? "").localeCompare(nazvyPobocek.get(b) ?? "", "cs"),
  );

  // Lidé, co plánovat smí, ale ten týden na žádné pobočce nemají ani
  // jednu směnu — bez skupiny (nevíme, kam by patřili), na konci.
  const lideSeSmenou = new Set<string>();
  for (const smeny of smenyPodlePobocce.values()) {
    for (const s of smeny) if (s.employee_id) lideSeSmenou.add(s.employee_id);
  }
  const radkyBezSmeny: RadekOsoby[] = planovani
    ? planovani.lide
        .filter((c) => !lideSeSmenou.has(c.id))
        .map((c) => ({ osoba: c.id, jmeno: c.jmeno, smenyPodleDne: new Map<string, Smena[]>() }))
        .sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs"))
    : [];

  const zobrazitHlavickuPobocky = branchIds.length > 1;

  /*
    PŘESTAVĚNO Z <table> NA CSS GRID (17.9.2026 v noci).

    Tři pokusy zachránit sticky hlavičku uvnitř <table> (overflowY na
    obalu, sticky na <th> místo <tr>, vyšší z-index) v ostrém provozu
    neuspěly — hlavička plavala jen na začátku a přestala fungovat, jak
    se scrollovalo hlouběji do řádků. `position: sticky` uvnitř
    opravdové HTML tabulky je napříč prohlížeči (Chrome nevyjímaje, ve
    velkých tabulkách) známě nespolehlivé — tabulkové rozvržení
    komplikuje výpočet "containing blocku", na kterém sticky stojí.

    Řešení: stejná mřížka, ale z <div> s CSS grid, ne z <table>.
    Vizuálně nerozeznatelné, ale sticky na blokových prvcích funguje
    předvídatelně. `role="table"/"row"/"columnheader"/"cell"` drží
    stejnou strukturu pro čtečky obrazovky, jakou dřív dávala
    sémantika <table> zadarmo.

    Grid nepotřebuje řádkový obal — každá "buňka" je přímé dítě
    jednoho grid kontejneru a rozteče se do řádků sama podle
    gridTemplateColumns. HlavickaSkupiny apod. proto vrací fragmenty
    plných <div>, ne <tr>.
  */
  const sablonaSloupcu = `minmax(120px, 140px) repeat(${dnySerad.length}, minmax(100px, 1fr))`;

  return (
    <div
      style={{
        border: "1px solid var(--line-2)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        /*
          PĚT POKUSŮ, TADY JE DŮVOD, PROČ PŘEDCHOZÍ NEFUNGOVALY.

          overflow-x: auto a overflow-y: visible NEJDE MÍT současně na
          jednom prvku — CSS specifikace obě osy vždycky srovná na
          "auto", ať se do overflow-y napíše cokoli (ověřeno živě
          přes DevTools: computed overflowY byl "auto" i po výslovném
          zápisu "visible"). Tenhle div se tedy VŽDYCKY stane scroll
          kontejnerem pro position:sticky uvnitř — na tom nejde nic
          změnit.

          Jenže bez vlastní omezené výšky tenhle div nikdy doopravdy
          nepřeteče (roste přesně podle obsahu, height ≈ scrollHeight)
          — takže i když JE technicky scroll kontejner, nic se v něm
          reálně nescrolluje a sticky nemá vůči čemu "být přilepené".

          Řešení: udělat z něj SKUTEČNÝ scrollovací panel s vlastní
          výškou — stejný vzor, jaký appka už má a funguje u levého
          bočního sloupce (.ft-side v globals.css: position:sticky,
          top:var(--vysoka-lista), height:calc(100dvh - ...),
          overflow-y:auto). Kalendář teď scroluje sám v sobě, ne celá
          stránka kolem něj.
        */
        maxHeight: "calc(100dvh - var(--vysoka-lista) - 32px)",
        overflowX: "auto",
        overflowY: "auto",
      }}
    >
      <div
        role="table"
        style={{
          display: "grid",
          gridTemplateColumns: sablonaSloupcu,
          minWidth: "600px",
          fontSize: "13px",
        }}
      >
        {/*
          Hlavička. Roh (Osoba) má sticky na obou osách zároveň (top
          i left), dny jen top — přesně jako dřív, jen na <div>.
        */}
        <div
          role="columnheader"
          style={{
            padding: "8px 12px",
            textAlign: "left",
            fontWeight: 600,
            color: "var(--branch)",
            background: "var(--card)",
            borderBottom: "2px solid var(--line-2)",
            position: "sticky",
            // top: 0, NE var(--vysoka-lista) — obalový div teď scroluje
            // sám v sobě (viz vysvětlení u obalu výš), takže "nahoře"
            // znamená horní hranu JEHO VLASTNÍHO scroll rámce, ne
            // stránky pod pevnou horní lištou.
            top: 0,
            left: 0,
            zIndex: 7,
          }}
        >
          Osoba
        </div>
        {dnySerad.map((datum) => {
          const dnesJe = datum === dnesni;
          const vikend = jeVikend(datum);
          return (
            <div
              key={datum}
              role="columnheader"
              style={{
                padding: "8px 12px",
                textAlign: "center",
                fontWeight: dnesJe ? 700 : 500,
                color: "var(--ink)",
                borderLeft: "1px solid var(--line-2)",
                borderBottom: "2px solid var(--line-2)",
                position: "sticky",
                top: 0,
                zIndex: 5,
                /*
                  Dnešek i víkend jsou mosaz — jediná zlatá barva,
                  kterou appka má (--mosaz/--mosaz-sv, viz
                  _tokeny.css), tatáž jako u přepínače Týden/Měsíc
                  a Celá firma. Šéfík 19.9.2026: víkendy "podobnou
                  barvou jako Celá firma nebo Týden, může být
                  světlejší" — 14 % bylo sotva znát. Odlišují se
                  SÍLOU odstínu: dnešek nejsilnější (40 %), víkend
                  světlejší (28 %).
                */
                background: dnesJe
                  ? "color-mix(in srgb, var(--mosaz-sv) 40%, var(--card))"
                  : vikend
                    ? "color-mix(in srgb, var(--mosaz-sv) 28%, var(--card))"
                    : "var(--card)",
              }}
            >
              <div style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "pre-line" }}>
                {popisDneZkracene(datum, dnesni)}
              </div>
            </div>
          );
        })}

        {branchIds.map((branchId) => {
          const nazevPobocky = nazvyPobocek.get(branchId) ?? "Jiná pobočka";
          const skupinyUseku = seskupPodleUseku(sestavRadky(smenyPodlePobocce.get(branchId) ?? []));
          const zobrazitHlavickuUseku = skupinyUseku.length > 1;

          return (
            <Fragment key={branchId}>
              {zobrazitHlavickuPobocky ? (
                <HlavickaSkupiny text={nazevPobocky} uroven="pobocka" />
              ) : null}
              {skupinyUseku.map(({ usek, radky }) => (
                <Fragment key={usek}>
                  {zobrazitHlavickuUseku ? (
                    <HlavickaSkupiny text={usek} uroven="usek" />
                  ) : null}
                  {radky.map((radek) => (
                    <RadekTydne
                      key={`${branchId}-${radek.osoba ?? "null"}`}
                      radek={radek}
                      dnySerad={dnySerad}
                      dnesni={dnesni}
                      barvy={barvy}
                      planovani={planovani}
                      vychoziPobocka={branchId}
                      onOtevrit={onOtevrit}
                    />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          );
        })}

        {radkyBezSmeny.length > 0 ? (
          <>
            {zobrazitHlavickuPobocky ? (
              <HlavickaSkupiny text="Bez směny tento týden" uroven="pobocka" />
            ) : null}
            {radkyBezSmeny.map((radek) => (
              <RadekTydne
                key={`bez-smeny-${radek.osoba}`}
                radek={radek}
                dnySerad={dnySerad}
                dnesni={dnesni}
                barvy={barvy}
                planovani={planovani}
                vychoziPobocka={planovani?.vychoziPobocka ?? null}
                onOtevrit={onOtevrit}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Subtilní řádek s názvem skupiny (pobočka/úsek), přes celou šířku
 * mřížky (gridColumn: "1 / -1" — grid ho sám zalomí na nový řádek,
 * i bez explicitního čísla řádku, protože se nevejde vedle
 * předchozích buněk).
 */
function HlavickaSkupiny({ text, uroven }: { text: string; uroven: "pobocka" | "usek" }) {
  return (
    <div
      role="row"
      style={{
        gridColumn: "1 / -1",
        position: "sticky",
        left: 0,
        padding: uroven === "pobocka" ? "10px 12px 6px" : "6px 12px 4px",
        paddingLeft: uroven === "usek" ? "24px" : "12px",
        fontSize: uroven === "pobocka" ? "12.5px" : "11px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".06em",
        color: uroven === "pobocka" ? "var(--ink)" : "var(--muted)",
        background: "var(--paper)",
        borderBottom: uroven === "pobocka" ? "1px solid var(--line)" : "none",
      }}
    >
      {text}
    </div>
  );
}

/** Jeden řádek člověka v týdenním rozpisu — beze změny chování, jen vytažené z TydenView, ať se dá použít pro víc skupin. */
function RadekTydne({
  radek,
  dnySerad,
  dnesni,
  barvy,
  planovani,
  vychoziPobocka,
  onOtevrit,
}: {
  radek: RadekOsoby;
  dnySerad: string[];
  dnesni: string;
  barvy: Map<string, string | null>;
  planovani: Planovani | null;
  /** Pobočka skupiny, do které řádek patří — nová směna z "+" se založí na ní, ne na obecné výchozí pobočce. */
  vychoziPobocka: string | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  const { osoba, jmeno, smenyPodleDne } = radek;
  const radkovyOkraj = { borderBottom: "1px solid var(--line-2)" } as const;

  return (
    <Fragment>
      <div
        role="cell"
        style={{
          ...radkovyOkraj,
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
          Iniciálové kolečko + čtvereček s barvou, ne obarvené jméno.
          Obarvené jméno by některé odstíny udělalo hůř čitelnými a
          barva by přebila to, co je na řádku podstatné.

          Neobsazená směna značku nemá — není čí. Je to jediné místo,
          kde značka chybí docela.
        */}
        {osoba ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
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
      </div>
      {dnySerad.map((datum) => {
        const smenyDne = smenyPodleDne.get(datum) ?? [];
        const dnesJe = datum === dnesni;
        const vikend = jeVikend(datum);
        return (
          <div
            key={`${osoba}-${datum}`}
            role="cell"
            className="ft-rozpis-bunka"
            style={{
              ...radkovyOkraj,
              padding: "9px 12px",
              textAlign: "center",
              borderLeft: "1px solid var(--line-2)",
              /*
                Odstín platí i pro obsazené dny — dřív měl den se směnou
                vždycky bílé pozadí, takže víkend v řádku s lidmi
                vypadal jako všední den. Chip směny má vlastní pozadí
                i rámeček, na zlatém podkladu se neztratí.
              */
              background: dnesJe
                ? "color-mix(in srgb, var(--mosaz-sv) 22%, var(--card))"
                : vikend
                  ? "color-mix(in srgb, var(--mosaz-sv) 14%, var(--card))"
                  : smenyDne.length > 0
                    ? "var(--card)"
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
                    title={s.pauza_od ? "Trhaná směna — upravit" : "Upravit směnu"}
                  >
                    {popisSmeny(s)}
                  </button>
                ) : (
                  <div key={s.id} style={chip}>
                    {popisSmeny(s)}
                  </div>
                ),
              )}

              {/*
                Prázdné políčko je taky místo, kam se dá kliknout —
                člověk i den už jsou dané, takže formulář se otevře
                skoro vyplněný. Trvale vidět nemá být (oddíl 6:
                "prázdná buňka má být čistá") — zobrazí se až na
                najetí nebo zaměření, viz .ft-rozpis-plus v globals.css.

                Jen na PRÁZDNÉ políčko (Šéfík 16.9.2026: "odebrat druhé
                plus" — den, kde už směna je, ho nepotřebuje. Přidat
                další směnu ten samý den jde teď přímo z otevřené
                směny, viz FormularSmeny.
              */}
              {planovani && smenyDne.length === 0 ? (
                <button
                  type="button"
                  className="ft-rozpis-plus"
                  onClick={() =>
                    onOtevrit({
                      den: datum,
                      smena: osoba
                        ? ({
                            id: "",
                            branch_id: vychoziPobocka ?? planovani.vychoziPobocka ?? "",
                            employee_id: osoba,
                            position_id: null,
                            shift_date: datum,
                            starts_at: "08:00",
                            ends_at: "16:00",
                            note: "",
                            pauza_od: null,
                            pauza_do: null,
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
          </div>
        );
      })}
    </Fragment>
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

                  const obsah = popisSmeny(s);
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
    <div
      style={{
        display: "grid",
        gap: "16px",
        padding: "16px",
        background: "var(--card)",
        border: "1px solid var(--line-2)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
      }}
    >
      {/*
        Záhlaví dní v týdnu — dřív žádné nebylo, takže se muselo
        počítat, který sloupec je který den (Šéfík 17.9.2026: "abych
        věděl který den to je"). Pořadí Ne–So schválně sedí s tím, jak
        mřížku pod ním sestavuje prvniDenTydne (getUTCDay(), 0=neděle)
        — neměnit datovou logiku kvůli tomuhle popisku.
      */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
        {DNY_V_TYDNU_ZKRACENE.map((nazev, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".04em",
              color: i === 0 || i === 6 ? "var(--mosaz)" : "var(--muted)",
            }}
          >
            {nazev}
          </div>
        ))}
      </div>
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
            // Sloupce jdou Ne–So (viz záhlaví výš): 0 = neděle, 6 = sobota.
            const vikend = sloupecIdx === 0 || sloupecIdx === 6;

            return (
              <button
                key={sloupecIdx}
                onClick={() => denNum && onSelectDay(datumStr)}
                style={{
                  padding: "12px 8px",
                  borderRadius: "var(--radius-md)",
                  border: denNum ? "1px solid var(--line-2)" : "none",
                  boxShadow: denNum && datumStr === den ? "var(--shadow-sm)" : "none",
                  /*
                    Okolní rám je teď taky --card (bílá) — den se
                    směnami proto potřebuje jiné pozadí než "beze
                    změny", jinak by v bílém rámu zmizel v bílé
                    (stejná past jako u chipů v týdenním pohledu).
                  */
                  background:
                    denNum && datumStr === den
                      ? "var(--branch-soft)"
                      : denNum && vikend
                        ? `color-mix(in srgb, var(--mosaz-sv) ${pocetSmeny === 0 ? 14 : 24}%, ${pocetSmeny === 0 ? "var(--card)" : "var(--sunken)"})`
                        : denNum && pocetSmeny === 0
                          ? "transparent"
                          : denNum
                            ? "var(--sunken)"
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

/**
 * Popisek směny do chipu — trhaná (pauza uvnitř) se ukáže jako dva
 * úseky, ne jedno souvislé od–do, ať je zlom vidět i v hustém rozpisu.
 */
function popisSmeny(s: { starts_at: string; ends_at: string; pauza_od: string | null; pauza_do: string | null }): string {
  if (s.pauza_od && s.pauza_do) {
    return `${hodina(s.starts_at)}–${hodina(s.pauza_od)} · ${hodina(s.pauza_do)}–${hodina(s.ends_at)}`;
  }
  return `${hodina(s.starts_at)}–${hodina(s.ends_at)}`;
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

/** Zkrácené názvy dní, stejné pořadí jako DNY (neděle první — MesicView). */
const DNY_V_TYDNU_ZKRACENE = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

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

/*
  Barevná výplň (--branch-soft), ne jen obrys na bílé — buňka dne má
  stejné bílé pozadí jako karta kolem ní (--card), takže samotný
  1px obrys splýval se vším ostatním a směna se od prázdného dne
  špatně rozeznávala (Šéfík 17.9.2026: "dny a směny se slévají").
*/
const chip = {
  fontSize: "11px",
  padding: "5px 7px",
  background: "var(--branch-soft)",
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
