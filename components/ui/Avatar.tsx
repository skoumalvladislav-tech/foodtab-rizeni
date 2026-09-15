type Velikost = "sm" | "md" | "lg";

const ROZMER: Record<Velikost, number> = { sm: 26, md: 34, lg: 44 };
const PISMO: Record<Velikost, number> = { sm: 11, md: 13, lg: 16 };

/**
 * Iniciály v kolečku — appka nemá fotky uživatelů, jen jméno/firmu.
 * Barva jde přes props, protože se používá jak na tmavé liště
 * (`--rail-2`/`--rail-ink`), tak na světlé kartě (`--branch-soft`).
 */
export default function Avatar({
  iniciraly,
  velikost = "md",
  pozadi = "var(--rail-2)",
  barvaTextu = "var(--rail-ink)",
  title,
}: {
  iniciraly: string;
  velikost?: Velikost;
  pozadi?: string;
  barvaTextu?: string;
  title?: string;
}) {
  const px = ROZMER[velikost];
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : "true"}
      style={{
        width: px,
        height: px,
        minWidth: px,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "999px",
        background: pozadi,
        color: barvaTextu,
        fontSize: PISMO[velikost],
        fontWeight: 700,
        letterSpacing: "-.02em",
        userSelect: "none",
      }}
    >
      {iniciraly}
    </span>
  );
}
