import type { CSSProperties } from "react";

/**
 * Šimrající placeholder při načítání. Appka do teď žádný neměla —
 * obrazovky buď počkaly na server (žádné blikání), nebo krátce
 * ukázaly nuly (počítadla v finance/faktury). Respektuje
 * prefers-reduced-motion (app/_komponenty.css).
 */
export default function Skeleton({
  width = "100%",
  height = "14px",
  radius,
  style,
}: {
  width?: string | number;
  height?: string | number;
  radius?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="ds-skeleton"
      aria-hidden="true"
      style={{ display: "block", width, height, borderRadius: radius, ...style }}
    />
  );
}
