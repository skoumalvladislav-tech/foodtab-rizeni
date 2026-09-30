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
  pata,
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
  /**
   * Co pod větou — u samostatného sdělení cesta ven
   * (`<Odhlaseni varianta="samostatne" />`, components/shell/Odhlaseni.tsx):
   * mimo rám není menu, a tedy ani odhlášení (kontrola #85, 25. 9. 2026).
   * Zvlášť, ne v `children`: věta je `<p>` a tlačítka do něj nepatří.
   */
  pata?: ReactNode;
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
        {pata}
      </div>
    </Obal>
  );
}
