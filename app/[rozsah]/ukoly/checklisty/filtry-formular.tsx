"use client";

import Form from "next/form";
import type { ReactNode } from "react";

/**
 * Filtry seznamu jako GET formulář, který se po změně výběru odešle sám
 * (mockup nemá tlačítko). Jen u `<select>` — datum by se odeslalo už
 * při psaní roku. Bez JavaScriptu zůstane tlačítko v `<noscript>`.
 */
export default function FiltryFormular({
  action,
  tlacitko,
  children,
}: {
  action: string;
  /** Tlačítko vidět vždy (Historie: datum se odesílá ručně). */
  tlacitko: boolean;
  children: ReactNode;
}) {
  const odeslat = <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">Použít</button>;
  return (
    <Form
      action={action}
      className="ck-filtry"
      aria-label="Filtry"
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
      }}
    >
      {children}
      {tlacitko ? odeslat : <noscript>{odeslat}</noscript>}
    </Form>
  );
}
