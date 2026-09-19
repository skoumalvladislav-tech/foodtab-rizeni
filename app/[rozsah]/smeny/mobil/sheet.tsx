"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import Ikona from "@/app/[rozsah]/ikona";

/**
 * Dva druhy okna pro telefon:
 *
 *   ListMobil   celá obrazovka se šipkou zpět (detail směny, přidat směnu)
 *   SpodniList  list zdola s úchytem (filtry)
 *
 * Nejsou to desktopové modály: na telefonu se dvě okna nad sebou a malý
 * křížek do rohu nehodí. Oba jdou přes portál do `document.body`, aby
 * je nezavřel `overflow` rodiče, a sdílejí chování: fokus dovnitř, Esc
 * zavírá, stránka pod nimi se neposouvá a fokus se po zavření vrací.
 */

function useOkno(ref: RefObject<HTMLElement | null>, onZavrit: () => void) {
  // `onZavrit` bývá nová funkce při každém vykreslení rodiče. Držet ji
  // v refu, aby efekt neběžel znovu a nevracel fokus na začátek.
  const zavrit = useRef(onZavrit);
  useEffect(() => {
    zavrit.current = onZavrit;
  });

  useEffect(() => {
    const predchozi = document.activeElement as HTMLElement | null;
    const puvodniPreteceni = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();

    function naKlavesu(e: KeyboardEvent) {
      if (e.key === "Escape") zavrit.current();
    }
    document.addEventListener("keydown", naKlavesu);

    return () => {
      document.removeEventListener("keydown", naKlavesu);
      document.body.style.overflow = puvodniPreteceni;
      predchozi?.focus?.();
    };
  }, [ref]);
}

type Spolecne = {
  nadpis: string;
  onZavrit: () => void;
  children: ReactNode;
  /** Pevná patička s hlavní akcí (Uložit, Zobrazit výsledky). */
  pata?: ReactNode;
  /** Akce vpravo v hlavičce (u spodního listu „Vymazat“). */
  akce?: ReactNode;
};

export function ListMobil({ nadpis, onZavrit, children, pata, akce }: Spolecne) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOkno(ref, onZavrit);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ds-sm-list" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header className="ds-sm-list-hlava">
        <button type="button" className="ds-sm-zpet" onClick={onZavrit} aria-label="Zpět">
          <Ikona klic="zpet" />
        </button>
        <h2 id={id} className="ds-sm-list-nadpis">
          {nadpis}
        </h2>
        <span className="ds-sm-list-akce">{akce}</span>
      </header>
      <div className="ds-sm-list-telo">{children}</div>
      {pata ? <footer className="ds-sm-list-pata">{pata}</footer> : null}
    </div>,
    document.body,
  );
}

export function SpodniList({ nadpis, onZavrit, children, pata, akce }: Spolecne) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOkno(ref, onZavrit);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ds-sm-podklad"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onZavrit();
      }}
    >
      <div className="ds-sm-spodni" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <span className="ds-sm-spodni-drzadlo" aria-hidden="true" />
        <header className="ds-sm-spodni-hlava">
          <h2 id={id} className="ds-sm-list-nadpis" data-vlevo="true">
            {nadpis}
          </h2>
          {akce}
        </header>
        <div className="ds-sm-spodni-telo">{children}</div>
        {pata ? <footer className="ds-sm-spodni-pata">{pata}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
