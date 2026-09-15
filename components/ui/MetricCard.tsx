import type { ReactNode } from "react";

import Card from "./Card";

/**
 * KPI karta (číslo + popisek) — nahrazuje ručně psané karty jako
 * v finance/faktury/page.tsx ("Otevřeno k úhradě", "Po splatnosti"…).
 */
export default function MetricCard({
  label,
  hodnota,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  hodnota: ReactNode;
  sublabel?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const barva =
    tone === "success" ? "var(--dobre)" : tone === "warning" ? "var(--pozor)" : tone === "danger" ? "var(--bad)" : "var(--ink)";

  return (
    <Card>
      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--muted)", marginBottom: "6px" }}>{label}</div>
      <div
        style={{
          fontSize: "26px",
          fontWeight: 600,
          fontFamily: "var(--font-newsreader)",
          color: barva,
          lineHeight: 1.1,
        }}
      >
        {hodnota}
      </div>
      {sublabel ? <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>{sublabel}</div> : null}
    </Card>
  );
}
