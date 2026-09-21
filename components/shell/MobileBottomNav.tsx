import Link from "next/link";

import Ikona from "@/app/[rozsah]/ikona";
import type { PolozkaProp } from "./AppShell";

/**
 * Spodní lišta na mobilu — nejčastější obrazovky, zbytek pod „Více".
 * Vytažena z ram.tsx (design systém, 15.9.2026), chování beze změny.
 */
export default function MobileBottomNav({
  rozsah,
  doListy,
  aktivniSegment,
  jeVice,
  segment,
  odznaky,
}: {
  rozsah: string;
  doListy: PolozkaProp[];
  aktivniSegment: string | undefined;
  jeVice: boolean;
  segment: string | null;
  /** Počty nepřečtených podle segmentu položky; nula se nekreslí. */
  odznaky?: Record<string, number>;
}) {
  return (
    <nav className="ft-mob-bottom" aria-label="Obrazovky">
      {doListy.map((p) =>
        p.hotovo ? (
          <Link
            key={p.segment}
            href={p.adresa ?? `/${rozsah}/${p.segment}`}
            className={p.segment === aktivniSegment ? "on" : undefined}
            aria-current={p.segment === aktivniSegment ? "page" : undefined}
          >
            <Ikona klic={p.ikona} />
            <span>{p.kratky}</span>
            {(odznaky?.[p.segment] ?? 0) > 0 ? (
              <b className="pc-odznak-lista">
                <span aria-hidden="true">{(odznaky?.[p.segment] ?? 0) > 99 ? "99+" : odznaky?.[p.segment]}</span>
                <span className="sr-only">{odznaky?.[p.segment]} nepřečtených</span>
              </b>
            ) : null}
          </Link>
        ) : (
          <span key={p.segment} style={{ flex: 1 }} />
        ),
      )}

      {jeVice ? (
        <Link href={`/${rozsah}`} className={segment === null ? "on" : undefined}>
          <Ikona klic="tecky" />
          <span>Více</span>
        </Link>
      ) : null}
    </nav>
  );
}
