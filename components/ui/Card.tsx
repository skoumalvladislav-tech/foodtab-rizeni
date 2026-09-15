import type { CSSProperties, ReactNode } from "react";

/**
 * Základní bílá karta — nahrazuje `const karta = {...}`, který dřív žil
 * duplikovaný zvlášť v marketing/page.tsx i finance/faktury/page.tsx
 * (stejné čtyři vlastnosti, stejné hodnoty, dva různé soubory).
 */
export default function Card({
  children,
  padding = "16px",
  style,
  as: Znacka = "div",
}: {
  children: ReactNode;
  padding?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Znacka
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-md)",
        padding,
        ...style,
      }}
    >
      {children}
    </Znacka>
  );
}
