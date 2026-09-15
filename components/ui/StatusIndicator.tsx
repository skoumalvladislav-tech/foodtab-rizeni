import type { ReactNode } from "react";

type Stav = "aktivni" | "neaktivni" | "cekajici" | "chyba";

const BARVY: Record<Stav, string> = {
  aktivni: "var(--dobre)",
  neaktivni: "var(--faint)",
  cekajici: "var(--pozor)",
  chyba: "var(--bad)",
};

/**
 * Tečka + popisek pro stavy napříč appkou (směna běží, upomínka čeká…).
 * Na rozdíl od `Badge` nemá podklad ani okraj — je to text s tečkou, ne
 * pilulka. Pro počty/kategorie použij Badge.
 */
export default function StatusIndicator({
  stav,
  children,
  pulz = false,
}: {
  stav: Stav;
  children: ReactNode;
  /** Jemné pulzování — jen pro „právě teď se něco děje" (směna běží). */
  pulz?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "13px", color: "var(--ink)" }}>
      <span className="ds-status-dot" data-pulse={pulz || undefined} style={{ background: BARVY[stav] }} />
      {children}
    </span>
  );
}
