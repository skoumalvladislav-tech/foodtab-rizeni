"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import {
  FILTR_DESKTOP_PRAZDNY,
  POPIS_PUNTIKU,
  jeFiltrPrazdny,
  jmenoVyhovuje,
  pocetFiltru,
  pocetFiltruVPanelu,
  type FiltrDesktop,
  type StavFiltru,
} from "@/lib/rozpis-desktop";
import { BEZ_USEKU } from "@/lib/rozpis-mobil";
import { MAX_LIDI_V_MESICI, type PohledRozpisu } from "@/lib/rozpis-konstanty";

/**
 * Jeden kompaktní panel nástrojů nad mřížkou:
 *
 *   ‹ 19.–25. září ›  [Dnes]  [Den|7 dní|Týden|Měsíc]  🔍 Hledat…  [Filtry]  čipy
 *
 * „7 dní“ (výchozí) je sedm následujících dní od zvoleného dne, „Týden“
 * kalendářní týden od pondělí. „Celý měsíc“ se nabídne, jen když jsou
 * vyfiltrovaní jeden nebo dva lidé — je to jejich měsíc po dnech, kde jde
 * zadávat směny.
 *
 * „Zobrazit“ je rychlá volba, co z rozpisu ukázat: jedna pobočka a pod ní
 * jeden úsek (Plac, Kuchyně, Vedení…). Píše do týchž filtrů jako nabídka
 * Filtry (`pobocky` a `useky`), takže čipy i počet filtrů sedí a jde to
 * kdykoli zrušit. Kdo chce víc úseků najednou, použije Filtry.
 *
 * Hledání filtruje viditelné řádky hned, jak se píše. Filtry jsou
 * jedna nabídka (úsek, pozice, zaměstnanec, stav směny), aktivní se
 * ukazují jako čipy vedle — každý jde zrušit zvlášť.
 *
 * Nic tu nerozhoduje o datech. Stav (`filtr`) drží rozpis a předává ho
 * dolů; tahle komponenta jen kreslí a hlásí změny.
 */

export type Pohled = PohledRozpisu;

const POHLEDY: [Pohled, string, string][] = [
  ["den", "Den", "Jeden den po hodinách"],
  ["sedm", "7 dní", "Sedm následujících dní od zvoleného dne (výchozí)"],
  ["tyden", "Týden", "Kalendářní týden od pondělí do neděle"],
  ["mesic", "Měsíc", "Kalendář měsíce s počty směn"],
];

const POHLED_MESIC_LIDI: [Pohled, string, string] = [
  "osoby",
  "Celý měsíc",
  "Celý měsíc vybraných lidí — směny se v něm zadávají po dnech",
];

const STAVY: [StavFiltru, string, string][] = [
  ["vse", "Vše", "Všechny směny"],
  ["nevydane", "Nevydané", "Nevydané a po vydání změněné směny"],
  ["vydane", "Vydané", "Vydané beze změny"],
  ["neobsazene", "Neobsazené", "Směny, na které nikdo není"],
];

export type MoznostiFiltru = {
  /** Pobočky, na které člověk vidí; víc než jedna = nabídne se výběr pobočky. */
  pobocky: { id: string; nazev: string }[];
  /** Úseky v pořadí, které si firma nastavila; `BEZ_USEKU` na konci. */
  useky: { klic: string; nazev: string }[];
  pozice: { id: string; label: string }[];
  lide: { id: string; jmeno: string }[];
};

export default function Nastroje({
  pohled,
  obdobi,
  onPosun,
  onDnes,
  onPohled,
  filtr,
  onFiltr,
  moznosti,
  mesicLidiMozny,
  legendaPuntiku,
  potvrzeniZnamo,
}: {
  pohled: Pohled;
  /** „19.–25. září“ — hotový popisek období. */
  obdobi: string;
  onPosun: (smer: -1 | 1) => void;
  onDnes: () => void;
  onPohled: (p: Pohled) => void;
  filtr: FiltrDesktop;
  onFiltr: (f: FiltrDesktop) => void;
  moznosti: MoznostiFiltru;
  /** Jsou vyfiltrovaní jeden nebo dva lidé, takže jde ukázat jejich celý měsíc? */
  mesicLidiMozny: boolean;
  /** Vysvětlit barvy puntíku u času směny? Jen tomu, kdo plánuje — potvrzení je věc vedoucího. */
  legendaPuntiku: boolean;
  /** Načetlo se, kdo směny potvrdil? Když ne, žlutý a zelený puntík nejsou a legenda to řekne. */
  potvrzeniZnamo: boolean;
}) {
  const [otevrene, setOtevrene] = useState(false);
  const [zobrazitOtevrene, setZobrazitOtevrene] = useState(false);
  const [hledaniLidi, setHledaniLidi] = useState("");
  const tlacitko = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const zobrazitTlacitko = useRef<HTMLButtonElement>(null);
  const zobrazitPanel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const zobrazitId = useId();
  const pocet = pocetFiltru(filtr);
  // Odznak u tlačítka Filtry ukazuje jen to, co je uvnitř té nabídky.
  const pocetVPanelu = pocetFiltruVPanelu(filtr);

  // Obě nabídky se zavírají klikem mimo a Escapem; fokus se vrací na tlačítko.
  useZavirani(otevrene, setOtevrene, tlacitko, panel);
  useZavirani(zobrazitOtevrene, setZobrazitOtevrene, zobrazitTlacitko, zobrazitPanel);

  const nazevUseku = (klic: string) =>
    klic === BEZ_USEKU ? "Bez úseku" : (moznosti.useky.find((u) => u.klic === klic)?.nazev ?? klic);

  // Co je vybráno v „Zobrazit“: pobočka a úsek, které tlačítko ukáže jako popisek.
  const popisekZobrazeni = [
    filtr.pobocky.length === 1
      ? (moznosti.pobocky.find((p) => p.id === filtr.pobocky[0])?.nazev ?? null)
      : filtr.pobocky.length > 1
        ? `${filtr.pobocky.length} pobočky`
        : null,
    filtr.useky.length === 1 ? nazevUseku(filtr.useky[0]) : filtr.useky.length > 1 ? `${filtr.useky.length} úseky` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const zobrazitDostupne = moznosti.pobocky.length > 1 || moznosti.useky.length > 0;

  const zapnout = <K extends "useky" | "pozice" | "osoby" | "pobocky">(pole: K, hodnota: string) =>
    onFiltr({
      ...filtr,
      [pole]: filtr[pole].includes(hodnota)
        ? filtr[pole].filter((h) => h !== hodnota)
        : [...filtr[pole], hodnota],
    });

  const cipy: { klic: string; text: string; zrusit: () => void }[] = [
    ...filtr.pobocky.map((p) => ({
      klic: `pobocka-${p}`,
      text: `Pobočka: ${moznosti.pobocky.find((x) => x.id === p)?.nazev ?? p}`,
      zrusit: () => zapnout("pobocky", p),
    })),
    ...filtr.useky.map((k) => ({
      klic: `usek-${k}`,
      text: `Úsek: ${nazevUseku(k)}`,
      zrusit: () => zapnout("useky", k),
    })),
    ...filtr.pozice.map((p) => ({
      klic: `pozice-${p}`,
      text: `Pozice: ${moznosti.pozice.find((x) => x.id === p)?.label ?? p}`,
      zrusit: () => zapnout("pozice", p),
    })),
    ...filtr.osoby.map((o) => ({
      klic: `osoba-${o}`,
      text: `Zaměstnanec: ${moznosti.lide.find((l) => l.id === o)?.jmeno ?? "?"}`,
      zrusit: () => zapnout("osoby", o),
    })),
    ...(filtr.stav !== "vse"
      ? [
          {
            klic: "stav",
            text: `Stav: ${STAVY.find(([k]) => k === filtr.stav)?.[1] ?? filtr.stav}`,
            zrusit: () => onFiltr({ ...filtr, stav: "vse" }),
          },
        ]
      : []),
  ];

  return (
    <div className="ds-smd-lista" role="toolbar" aria-label="Nástroje rozpisu">
      <div className="ds-smd-nav">
        <button type="button" onClick={() => onPosun(-1)} aria-label="Předchozí období">
          <Ikona klic="sipkaVlevo" velikost={16} />
        </button>
        <span className="ds-smd-obdobi" aria-live="polite">
          {obdobi}
        </span>
        <button type="button" onClick={() => onPosun(1)} aria-label="Následující období">
          <Ikona klic="sipkaVpravo" velikost={16} />
        </button>
      </div>

      <button type="button" className="ds-smd-tl" onClick={onDnes}>
        Dnes
      </button>

      <div className="ds-smd-seg" role="group" aria-label="Pohled">
        {(mesicLidiMozny || pohled === "osoby" ? [...POHLEDY, POHLED_MESIC_LIDI] : POHLEDY).map(
          ([klic, nazev, popis]) => (
            <button
              key={klic}
              type="button"
              aria-pressed={pohled === klic}
              title={popis}
              onClick={() => onPohled(klic)}
            >
              {nazev}
            </button>
          ),
        )}
      </div>

      {zobrazitDostupne ? (
        <div className="ds-smd-filtry-obal">
          <button
            ref={zobrazitTlacitko}
            type="button"
            className="ds-smd-tl"
            aria-expanded={zobrazitOtevrene}
            aria-controls={zobrazitOtevrene ? zobrazitId : undefined}
            onClick={() => setZobrazitOtevrene((o) => !o)}
          >
            <Ikona klic="pobocka" velikost={15} />
            Zobrazit
            {popisekZobrazeni ? <span className="ds-smd-zobrazit-hodnota">{popisekZobrazeni}</span> : null}
          </button>

          {zobrazitOtevrene ? (
            <div
              ref={zobrazitPanel}
              id={zobrazitId}
              className="ds-smd-filtry ds-smd-zobrazit"
              role="group"
              aria-label="Co zobrazit"
            >
              {moznosti.pobocky.length > 1 ? (
                <fieldset className="ds-smd-f-sloupec">
                  <legend>Pobočka</legend>
                  <label className="ds-smd-volba">
                    <input
                      type="radio"
                      name="zobrazit-pobocka"
                      checked={filtr.pobocky.length === 0}
                      onChange={() => onFiltr({ ...filtr, pobocky: [] })}
                    />
                    Všechny pobočky
                  </label>
                  {moznosti.pobocky.map((p) => (
                    <label key={p.id} className="ds-smd-volba">
                      <input
                        type="radio"
                        name="zobrazit-pobocka"
                        checked={filtr.pobocky.length === 1 && filtr.pobocky[0] === p.id}
                        onChange={() => onFiltr({ ...filtr, pobocky: [p.id] })}
                      />
                      {p.nazev}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {moznosti.useky.length > 0 ? (
                <fieldset className="ds-smd-f-sloupec">
                  <legend>Úsek</legend>
                  <label className="ds-smd-volba">
                    <input
                      type="radio"
                      name="zobrazit-usek"
                      checked={filtr.useky.length === 0}
                      onChange={() => onFiltr({ ...filtr, useky: [] })}
                    />
                    Všechny úseky
                  </label>
                  {moznosti.useky.map((u) => (
                    <label key={u.klic} className="ds-smd-volba">
                      <input
                        type="radio"
                        name="zobrazit-usek"
                        checked={filtr.useky.length === 1 && filtr.useky[0] === u.klic}
                        onChange={() => onFiltr({ ...filtr, useky: [u.klic] })}
                      />
                      {u.nazev}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {filtr.pobocky.length > 1 || filtr.useky.length > 1 ? (
                <p className="ds-smd-f-napoveda ds-smd-zobrazit-poznamka">
                  Máte vybráno víc najednou (nabídka Filtry). Volba tady to nahradí jednou pobočkou a jedním úsekem.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <label className="ds-smd-hledani">
        <Ikona klic="lupa" velikost={16} />
        <input
          type="search"
          value={filtr.hledani}
          onChange={(e) => onFiltr({ ...filtr, hledani: e.target.value })}
          placeholder="Hledat zaměstnance…"
          aria-label="Hledat zaměstnance"
          autoComplete="off"
          spellCheck={false}
        />
        {filtr.hledani ? (
          <button
            type="button"
            className="ds-smd-hledani-zrusit"
            aria-label="Smazat hledání"
            onClick={() => onFiltr({ ...filtr, hledani: "" })}
          >
            <Ikona klic="zavrit" velikost={14} />
          </button>
        ) : null}
      </label>

      <div className="ds-smd-filtry-obal">
        <button
          ref={tlacitko}
          type="button"
          className="ds-smd-tl"
          aria-expanded={otevrene}
          aria-controls={otevrene ? panelId : undefined}
          onClick={() => setOtevrene((o) => !o)}
        >
          <Ikona klic="filtr" velikost={15} />
          Filtry
          {pocetVPanelu > 0 ? <span className="ds-smd-odznak">{pocetVPanelu}</span> : null}
        </button>

        {otevrene ? (
          <div ref={panel} id={panelId} className="ds-smd-filtry" role="group" aria-label="Filtry rozpisu">
            {moznosti.useky.length > 0 ? (
              <fieldset className="ds-smd-f-sloupec">
                <legend>Úsek</legend>
                {moznosti.useky.map((u) => (
                  <label key={u.klic} className="ds-smd-volba">
                    <input
                      type="checkbox"
                      checked={filtr.useky.includes(u.klic)}
                      onChange={() => zapnout("useky", u.klic)}
                    />
                    {u.nazev}
                  </label>
                ))}
              </fieldset>
            ) : null}

            {moznosti.pozice.length > 0 ? (
              <fieldset className="ds-smd-f-sloupec">
                <legend>Pozice</legend>
                {moznosti.pozice.map((p) => (
                  <label key={p.id} className="ds-smd-volba">
                    <input
                      type="checkbox"
                      checked={filtr.pozice.includes(p.id)}
                      onChange={() => zapnout("pozice", p.id)}
                    />
                    {p.label}
                  </label>
                ))}
              </fieldset>
            ) : null}

            <fieldset className="ds-smd-f-siroka ds-smd-f-lide">
              <legend>Zaměstnanci</legend>
              <input
                type="search"
                className="ds-smd-f-hledej"
                value={hledaniLidi}
                onChange={(e) => setHledaniLidi(e.target.value)}
                placeholder="Najít zaměstnance v seznamu…"
                aria-label="Najít zaměstnance v seznamu"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="ds-smd-f-seznam">
                {moznosti.lide
                  .filter((l) => filtr.osoby.includes(l.id) || jmenoVyhovuje(l.jmeno, hledaniLidi))
                  .map((l) => (
                    <label key={l.id} className="ds-smd-volba">
                      <input
                        type="checkbox"
                        checked={filtr.osoby.includes(l.id)}
                        onChange={() => zapnout("osoby", l.id)}
                      />
                      <span className="ds-smd-volba-text">{l.jmeno}</span>
                    </label>
                  ))}
                {moznosti.lide.every((l) => !filtr.osoby.includes(l.id) && !jmenoVyhovuje(l.jmeno, hledaniLidi)) ? (
                  <p className="ds-smd-f-nic">Nikdo takový v seznamu není.</p>
                ) : null}
              </div>
              <p className="ds-smd-f-napoveda">
                Vyberte jednoho nebo dva lidi ({MAX_LIDI_V_MESICI} nejvýš) a nabídne se jejich celý měsíc, kde jde
                zadat směny po dnech.
              </p>
            </fieldset>

            <fieldset className="ds-smd-f-siroka ds-smd-f-stav">
              <legend>Stav směny</legend>
              {STAVY.map(([klic, nazev, popis]) => (
                <label key={klic} className="ds-smd-volba" title={popis}>
                  <input
                    type="radio"
                    name="stav-smeny"
                    checked={filtr.stav === klic}
                    onChange={() => onFiltr({ ...filtr, stav: klic })}
                  />
                  {nazev}
                </label>
              ))}
            </fieldset>

            <div className="ds-smd-filtry-pata">
              <button
                type="button"
                className="ds-smd-odkaz"
                disabled={pocetVPanelu === 0}
                /* Ruší jen to, co je v téhle nabídce — volbu v Zobrazit nechává být. */
                onClick={() => onFiltr({ ...FILTR_DESKTOP_PRAZDNY, hledani: filtr.hledani, pobocky: filtr.pobocky })}
              >
                Zrušit filtry
              </button>
              <button
                type="button"
                className="ft-tl ft-tl-male ft-tl-vedlejsi"
                onClick={() => {
                  setOtevrene(false);
                  tlacitko.current?.focus();
                }}
              >
                Hotovo
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {cipy.length > 0 ? (
        <ul className="ds-smd-cipy" aria-label="Aktivní filtry">
          {cipy.map((c) => (
            <li key={c.klic}>
              <button type="button" onClick={c.zrusit} aria-label={`Zrušit filtr — ${c.text}`}>
                {c.text}
                <Ikona klic="zavrit" velikost={12} />
              </button>
            </li>
          ))}
          {mesicLidiMozny && pohled !== "osoby" ? (
            <li>
              <button type="button" className="ds-smd-odkaz" onClick={() => onPohled("osoby")}>
                Ukázat celý měsíc
              </button>
            </li>
          ) : null}
          {!jeFiltrPrazdny(filtr) && pocet > 1 ? (
            <li>
              <button
                type="button"
                className="ds-smd-odkaz"
                onClick={() => onFiltr({ ...FILTR_DESKTOP_PRAZDNY, hledani: filtr.hledani })}
              >
                Zrušit vše
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {/*
        Vysvětlení puntíku u času směny (Šéfík 20. 9. 2026). Sedí v liště nad
        mřížkou, ne dole v patičce, ať je vidět dřív, než se člověk zeptá.
        Slova jsou z `POPIS_PUNTIKU` — táž, která nese `title` karty. Je až za
        čipy filtrů, aby je `margin-left: auto` neodstrčilo na další řádek.
      */}
      {legendaPuntiku ? (
        <ul
          className="ds-smd-legenda ds-smd-legenda-puntiku"
          aria-label="Význam puntíku u času směny"
          title="Potvrzeno = zaměstnanec směnu potvrdil v telefonu. Změní-li se čas, den, pauza nebo člověk, potvrzení přestane platit."
        >
          {(["nevydano", "nepotvrzeno", "potvrzeno"] as const).map((k) => (
            <li key={k}>
              <span className="ds-smd-znacka" data-puntik={k} aria-hidden="true" />
              {POPIS_PUNTIKU[k]}
            </li>
          ))}
          {!potvrzeniZnamo ? (
            <li
              className="ds-smd-legenda-pozn"
              title="Potvrzení směn se nenačetla — databáze je buď ještě nemá (čeká na nasazení), nebo se čtení nepovedlo. Vydané směny proto puntík nemají; červený puntík u nevydaných platí dál."
            >
              Potvrzení zatím nejsou k dispozici
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Nabídka se zavírá klikem mimo a Escapem; po Escapu se fokus vrací na
 * tlačítko, které ji otevřelo.
 */
function useZavirani(
  otevrene: boolean,
  nastavit: (o: boolean) => void,
  tlacitko: RefObject<HTMLButtonElement | null>,
  panel: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!otevrene) return;
    function naKlik(e: MouseEvent) {
      const cil = e.target as Node;
      if (panel.current?.contains(cil) || tlacitko.current?.contains(cil)) return;
      nastavit(false);
    }
    function naKlavesu(e: KeyboardEvent) {
      if (e.key === "Escape") {
        nastavit(false);
        tlacitko.current?.focus();
      }
    }
    document.addEventListener("mousedown", naKlik);
    document.addEventListener("keydown", naKlavesu);
    return () => {
      document.removeEventListener("mousedown", naKlik);
      document.removeEventListener("keydown", naKlavesu);
    };
  }, [otevrene, nastavit, tlacitko, panel]);
}
