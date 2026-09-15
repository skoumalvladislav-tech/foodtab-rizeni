import type { ReactNode } from "react";

/**
 * Prázdný stav UVNITŘ obsahu (seznam bez položek, filtr bez výsledků),
 * s volitelnou akcí ("Zadat první fakturu ručně").
 *
 * Na rozdíl od `Sdeleni` (app/sdeleni.tsx) — celostránkové/blokující
 * sdělení bez akce, používané appkou už všude pro auth/no-access stavy
 * — tahle komponenta je pro místo UVNITŘ hotové obrazovky. Sdeleni
 * zůstává, jak je; obě spolu existují, každá pro jinou situaci.
 */
export default function EmptyState({
  ikona,
  nadpis,
  children,
  akce,
}: {
  ikona?: ReactNode;
  nadpis: string;
  children?: ReactNode;
  akce?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "10px",
        padding: "48px 24px",
      }}
    >
      {ikona ? (
        <span style={{ color: "var(--faint)", display: "flex" }} aria-hidden="true">
          {ikona}
        </span>
      ) : null}
      <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--ink)" }}>{nadpis}</h2>
      {children ? (
        <p style={{ margin: 0, maxWidth: "42ch", fontSize: "13.5px", color: "var(--muted)" }}>{children}</p>
      ) : null}
      {akce ? <div style={{ marginTop: "6px" }}>{akce}</div> : null}
    </div>
  );
}
