import type { ReactNode } from "react";

/**
 * Stránka s jedním sdělením.
 *
 * Používá se všude, kde není co vykreslit, ale není to pád: účet bez
 * firmy, nedostupný rozsah, prázdný seznam. Vždycky česky a vždycky
 * s vysvětlením, co s tím.
 */
export default function Sdeleni({
  nadpis,
  children,
}: {
  nadpis: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: "60dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          padding: "32px",
        }}
      >
        <h1
          style={{ margin: "0 0 12px", fontSize: "20px", color: "var(--green)" }}
        >
          {nadpis}
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
          {children}
        </p>
      </div>
    </main>
  );
}
