"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Modální dialog — appka měla tři nezávislé ruční verze
 * (smeny/formular-smeny.tsx, ceka-na-opravneni.tsx, pwa-registration.tsx),
 * každá s vlastní "zaclona". Tohle je jedna sdílená: focus dovnitř při
 * otevření a zpátky při zavření, Esc zavírá, klik na podklad zavírá,
 * portál mimo strom appky (žádné přetahování z-indexů s .ft-shell).
 */
export default function Dialog({
  otevreno,
  onZavrit,
  nadpis,
  children,
}: {
  otevreno: boolean;
  onZavrit: () => void;
  nadpis: string;
  children: ReactNode;
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onZavrit();
      }}
    >
      <div ref={panelRef} className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby={nadpisId} tabIndex={-1}>
        <div className="ds-dialog-head">
          <h2 className="ds-dialog-title" id={nadpisId}>
            {nadpis}
          </h2>
          <button type="button" className="ds-dialog-close" onClick={onZavrit} aria-label="Zavřít">
            <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="ds-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
