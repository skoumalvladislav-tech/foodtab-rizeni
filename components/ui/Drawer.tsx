"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Vysouvací panel z boku (desktop) nebo zdola (mobil) — stejná
 * mechanika jako Dialog (fokus, Esc, portál), jiné umístění a vzhled.
 *
 * `nemodalni` je pracovní panel vedle obsahu: bez ztmavení, pod horní
 * lištou, a klikání v obsahu vedle nic nezavírá ani neblokuje (rozpis
 * díky tomu zůstane celý vidět a jde přepnout na jinou směnu). Ostatní
 * použití zůstávají modální, jak byla.
 */
export default function Drawer({
  otevreno,
  onZavrit,
  nadpis,
  children,
  umisteni = "end",
  sirka = "uzka",
  nemodalni = false,
}: {
  otevreno: boolean;
  onZavrit: () => void;
  nadpis: string;
  children: ReactNode;
  /** "end" = z pravé strany, "bottom" = zdola (typicky mobilní list akcí). */
  umisteni?: "end" | "bottom";
  /** "uzka" = 420 px (formulář), "siroka" = 520 px (přehled), "plna" = 860 px (průvodce s tabulkou). */
  sirka?: "uzka" | "siroka" | "plna";
  nemodalni?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const nadpisId = useId();

  useEffect(() => {
    if (!otevreno) return;
    const predchozi = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function naKlavesu(e: KeyboardEvent) {
      if (e.key === "Escape") onZavrit();
    }
    document.addEventListener("keydown", naKlavesu);
    return () => {
      document.removeEventListener("keydown", naKlavesu);
      predchozi?.focus();
    };
  }, [otevreno, onZavrit]);

  if (!otevreno || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ds-overlay"
      data-placement={umisteni === "bottom" ? "drawer-bottom" : "drawer-end"}
      data-sirka={sirka}
      data-nemodalni={nemodalni ? "" : undefined}
      onMouseDown={(e) => {
        if (!nemodalni && e.target === e.currentTarget) onZavrit();
      }}
    >
      <div
        ref={panelRef}
        className="ds-drawer"
        role="dialog"
        aria-modal={nemodalni ? "false" : "true"}
        aria-labelledby={nadpisId}
        tabIndex={-1}
      >
        <div className="ds-drawer-head">
          <h2 className="ds-drawer-title" id={nadpisId}>
            {nadpis}
          </h2>
          <button type="button" className="ds-dialog-close" onClick={onZavrit} aria-label="Zavřít">
            <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="ds-drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
