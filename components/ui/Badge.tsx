import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "vino" | "success" | "warning" | "danger";

const TONY: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--sunken)", fg: "var(--muted)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--mosaz)" },
  vino: { bg: "var(--vino-soft)", fg: "var(--vino)" },
  success: { bg: "var(--dobre-bg)", fg: "var(--dobre)" },
  warning: { bg: "var(--pozor-bg)", fg: "var(--pozor)" },
  danger: { bg: "var(--bad-bg)", fg: "var(--bad)" },
};

/**
 * Malý barevný štítek — počet, stav, kategorie.
 *
 * Barva nese jen doprovodný význam, nikdy jediný (docs/vzhled-zadani.md,
 * „barva nikdy sama") — text vedle sebe je čitelný i bez ní. `dot` je
 * pro případy, kdy má štítek navíc tečku (stav + počet zároveň).
 */
export default function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  const barvy = TONY[tone];
  return (
    <span className="ds-badge" style={{ background: barvy.bg, color: barvy.fg }}>
      {dot ? <span className="ds-badge-dot" /> : null}
      {children}
    </span>
  );
}
