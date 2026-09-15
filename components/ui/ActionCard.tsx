import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Klikací dlaždice — "Kam dál" na rozcestníku, "Zkontrolovat →" na
 * přehledech. `.ds-action-card` (app/_komponenty.css) dodává hover/focus,
 * layout je inline jako zbytek appky.
 */
export default function ActionCard({
  href,
  title,
  children,
  ikona,
}: {
  href: string;
  title: string;
  children?: ReactNode;
  ikona?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ds-action-card"
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-md)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {ikona ? (
          <span aria-hidden="true" style={{ color: "var(--mosaz)", display: "flex" }}>
            {ikona}
          </span>
        ) : null}
        <span style={{ fontWeight: 600, fontSize: "14.5px" }}>{title}</span>
      </div>
      {children ? <span style={{ fontSize: "13px", color: "var(--muted)" }}>{children}</span> : null}
    </Link>
  );
}
