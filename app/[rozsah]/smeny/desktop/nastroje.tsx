"use client";

import { useEffect, useId, useRef, useState } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import {
  FILTR_DESKTOP_PRAZDNY,
  jeFiltrPrazdny,
  pocetFiltru,
  type FiltrDesktop,
  type StavFiltru,
} from "@/lib/rozpis-desktop";
import { BEZ_USEKU } from "@/lib/rozpis-mobil";

/**
 * Jeden kompaktní panel nástrojů nad mřížkou:
 *
 *   ‹ 19.–25. září ›  [Dnes]  [Den|Týden|Měsíc]  🔍 Hledat…  [Filtry]  čipy
 *
 * Hledání filtruje viditelné řádky hned, jak se píše. Filtry jsou
 * jedna nabídka (úsek, pozice, zaměstnanec, stav směny), aktivní se
 * ukazují jako čipy vedle — každý jde zrušit zvlášť.
 *
 * Nic tu nerozhoduje o datech. Stav (`filtr`) drží rozpis a předává ho
 * dolů; tahle komponenta jen kreslí a hlásí změny.
 */

export type Pohled = "mesic" | "tyden" | "den";

const POHLEDY: [Pohled, string][] = [
  ["den", "Den"],
  ["tyden", "Týden"],
  ["mesic", "Měsíc"],
];

const STAVY: [StavFiltru, string, string][] = [
  ["vse", "Vše", "Všechny směny"],
  ["nevydane", "Nevydané", "Nevydané a po vydání změněné směny"],
  ["vydane", "Vydané", "Vydané beze změny"],
  ["neobsazene", "Neobsazené", "Směny, na které nikdo není"],
];

export type MoznostiFiltru = {
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
}) {
  const [otevrene, setOtevrene] = useState(false);
  const tlacitko = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pocet = pocetFiltru(filtr);

  // Zavírá se klikem mimo a Escapem; fokus se vrací na tlačítko.
  useEffect(() => {
    if (!otevrene) return;
    function naKlik(e: MouseEvent) {
      const cil = e.target as Node;
      if (panel.current?.contains(cil) || tlacitko.current?.contains(cil)) return;
      setOtevrene(false);
    }
    function naKlavesu(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOtevrene(false);
        tlacitko.current?.focus();
      }
    }
    document.addEventListener("mousedown", naKlik);
    document.addEventListener("keydown", naKlavesu);
    return () => {
      document.removeEventListener("mousedown", naKlik);
      document.removeEventListener("keydown", naKlavesu);
    };
  }, [otevrene]);

  const nazevUseku = (klic: string) =>
    klic === BEZ_USEKU ? "Bez úseku" : (moznosti.useky.find((u) => u.klic === klic)?.nazev ?? klic);

  const zapnout = <K extends "useky" | "pozice">(pole: K, hodnota: string) =>
    onFiltr({
      ...filtr,
      [pole]: filtr[pole].includes(hodnota)
        ? filtr[pole].filter((h) => h !== hodnota)
        : [...filtr[pole], hodnota],
    });

  const cipy: { klic: string; text: string; zrusit: () => void }[] = [
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
    ...(filtr.osoba
      ? [
          {
            klic: "osoba",
            text: `Zaměstnanec: ${moznosti.lide.find((l) => l.id === filtr.osoba)?.jmeno ?? "?"}`,
            zrusit: () => onFiltr({ ...filtr, osoba: "" }),
          },
        ]
      : []),
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
        {POHLEDY.map(([klic, nazev]) => (
          <button key={klic} type="button" aria-pressed={pohled === klic} onClick={() => onPohled(klic)}>
            {nazev}
          </button>
        ))}
      </div>

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
          {pocet > 0 ? <span className="ds-smd-odznak">{pocet}</span> : null}
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

            <fieldset className="ds-smd-f-siroka">
              <legend>Zaměstnanec</legend>
              <select
                value={filtr.osoba}
                onChange={(e) => onFiltr({ ...filtr, osoba: e.target.value })}
                aria-label="Zaměstnanec"
              >
                <option value="">Všichni</option>
                {moznosti.lide.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.jmeno}
                  </option>
                ))}
              </select>
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
                disabled={pocet === 0}
                onClick={() => onFiltr({ ...FILTR_DESKTOP_PRAZDNY, hledani: filtr.hledani })}
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
    </div>
  );
}
