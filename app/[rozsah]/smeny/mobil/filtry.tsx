"use client";

import { useState } from "react";

import {
  BEZ_USEKU,
  FILTR_PRAZDNY,
  sestavitDen,
  sestavitTyden,
  type FiltrSmen,
  type StavFiltru,
} from "@/lib/rozpis-mobil";
import { SpodniList } from "./sheet";
import type { KontextM, SmenaM } from "./typy";

/**
 * Filtry v listu zdola.
 *
 * Volí se do KONCEPTU: teprve „Zobrazit výsledky“ ho použije, zavření
 * bokem ho zahodí. Číslo na tlačítku je skutečný počet řádků, které by
 * po použití zůstaly — počítá ho tatáž funkce, která seznam kreslí, ne
 * odhad.
 *
 * Nabízí se jen to, co ve firmě existuje: pobočky, když jsou aspoň dvě,
 * úseky, které má firma, a „Bez úseku“, jen když je v datech někdo bez
 * úseku. Stav „Volno“ dává smysl jen v denním přehledu.
 */

const STAVY: [StavFiltru, string][] = [
  ["vse", "Vše"],
  ["obsazene", "Obsazené"],
  ["neobsazene", "Neobsazené"],
  ["volno", "Volno"],
];

export default function FiltrySheet({
  pohled,
  den,
  smeny,
  ctx,
  filtr,
  onPouzit,
  onZavrit,
}: {
  pohled: "den" | "tyden";
  den: string;
  smeny: SmenaM[];
  ctx: KontextM;
  filtr: FiltrSmen;
  onPouzit: (f: FiltrSmen) => void;
  onZavrit: () => void;
}) {
  const [koncept, setKoncept] = useState<FiltrSmen>(filtr);

  const pocet =
    pohled === "den"
      ? sestavitDen({ smeny, den, osoby: ctx.osoby, useky: ctx.useky, filtr: koncept }).pocetRadku
      : sestavitTyden({ smeny, den, osoby: ctx.osoby, useky: ctx.useky, filtr: koncept }).pocetRadku;

  const nekdoBezUseku = [...ctx.osoby.values()].some((o) => !o.usekId || !ctx.useky.has(o.usekId));
  const pobocky = [...ctx.pobocky];
  const useky = [...ctx.useky, ...(nekdoBezUseku ? ([[BEZ_USEKU, "Bez úseku"]] as [string, string][]) : [])];
  const stavy = pohled === "den" ? STAVY : STAVY.filter(([k]) => k !== "volno");

  const prepnout = (pole: "pobocky" | "useky", hodnota: string) =>
    setKoncept((f) => ({
      ...f,
      [pole]: f[pole].includes(hodnota) ? f[pole].filter((x) => x !== hodnota) : [...f[pole], hodnota],
    }));

  return (
    <SpodniList
      nadpis="Filtry"
      onZavrit={onZavrit}
      akce={
        <button type="button" className="ds-sm-vymazat" onClick={() => setKoncept(FILTR_PRAZDNY)}>
          Vymazat
        </button>
      }
      pata={
        <button
          type="button"
          className="ds-sm-pridat ds-sm-pridat-v-listu"
          onClick={() => {
            onPouzit(koncept);
            onZavrit();
          }}
        >
          {`Zobrazit výsledky (${pocet})`}
        </button>
      }
    >
      {pobocky.length > 1 ? (
        <fieldset className="ds-sm-filtr-sekce">
          <legend>Pobočka</legend>
          {pobocky.map(([id, nazev]) => (
            <label key={id} className="ds-sm-volba">
              <input type="checkbox" checked={koncept.pobocky.includes(id)} onChange={() => prepnout("pobocky", id)} />
              <span>{nazev}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {useky.length > 0 ? (
        <fieldset className="ds-sm-filtr-sekce">
          <legend>Úsek</legend>
          {useky.map(([id, nazev]) => (
            <label key={id} className="ds-sm-volba">
              <input type="checkbox" checked={koncept.useky.includes(id)} onChange={() => prepnout("useky", id)} />
              <span>{nazev}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className="ds-sm-filtr-sekce">
        <legend>Stav směny</legend>
        {stavy.map(([k, nazev]) => (
          <label key={k} className="ds-sm-volba">
            <input
              type="radio"
              name="stav-smeny"
              checked={koncept.stav === k}
              onChange={() => setKoncept((f) => ({ ...f, stav: k }))}
            />
            <span>{nazev}</span>
          </label>
        ))}
      </fieldset>
    </SpodniList>
  );
}
