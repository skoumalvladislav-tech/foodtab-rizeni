import type { ReactNode } from "react";

/**
 * Chybový stav UVNITŘ obsahu — načtení dat selhalo, appka ale nespadla.
 * Vizuálně stejný vzor jako EmptyState, jen v barvě --bad a s
 * `role="alert"`. Pro „nemáte oprávnění"/„účet bez firmy" (blokující,
 * celostránkové) používej dál `Sdeleni` (app/sdeleni.tsx).
 */
export default function ErrorState({
  nadpis = "Nepodařilo se to načíst",
  children,
  akce,
}: {
  nadpis?: string;
  children?: ReactNode;
  akce?: ReactNode;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "10px",
        padding: "48px 24px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--bad)" }}>{nadpis}</h2>
      {children ? (
        <p style={{ margin: 0, maxWidth: "42ch", fontSize: "13.5px", color: "var(--muted)" }}>{children}</p>
      ) : null}
      {akce ? <div style={{ marginTop: "6px" }}>{akce}</div> : null}
    </div>
  );
}
