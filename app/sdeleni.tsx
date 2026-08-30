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
  samostatne = false,
  children,
}: {
  nadpis: string;
  /**
   * Sdělení stojí samo, mimo rám aplikace — na rozcestí po přihlášení
   * a v layoutu dřív, než se rám vůbec vykreslí. Jen tehdy je hlavní
   * oblastí stránky, a tedy <main>. Uvnitř rámu hlavní oblast dodává
   * .ft-main v ram.tsx a druhý <main> by odečítači zamotal orientaci.
   */
  samostatne?: boolean;
  children: ReactNode;
}) {
  const Obal = samostatne ? "main" : "div";

  return (
    <Obal
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
          style={{ margin: "0 0 12px", fontSize: "20px", color: "var(--branch)" }}
        >
          {nadpis}
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
          {children}
        </p>
      </div>
    </Obal>
  );
}
