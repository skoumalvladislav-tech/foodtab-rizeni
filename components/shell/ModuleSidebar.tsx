import Link from "next/link";

import Ikona from "@/app/[rozsah]/ikona";
import type { PolozkaProp } from "./AppShell";

/**
 * Levý sloupec — hlavičce rozsahu a seznam obrazovek vybraného modulu
 * (hotové jako odkazy, nehotové zašedle se štítkem „brzy"). Vytažen
 * z ram.tsx (design systém, 15.9.2026), chování beze změny.
 */
export default function ModuleSidebar({
  rozsah,
  vNastaveni,
  druh,
  nazevRozsahu,
  nazevFirmy,
  hotove,
  chystane,
  aktivniSegment,
}: {
  rozsah: string;
  vNastaveni: boolean;
  druh: string;
  nazevRozsahu: string;
  nazevFirmy: string;
  hotove: PolozkaProp[];
  chystane: PolozkaProp[];
  aktivniSegment: string | undefined;
}) {
  return (
    <div className="ft-side">
      <div className="ft-side-head">
        <div className="ft-strip" />
        <span>{vNastaveni ? "Nastavení" : druh}</span>
        <b>{vNastaveni ? nazevFirmy : nazevRozsahu}</b>
      </div>

      <nav className="ft-nav" aria-label="Obrazovky">
        {hotove.map((p) => (
          <Link
            key={p.segment}
            href={p.adresa ?? `/${rozsah}/${p.segment}`}
            className={p.segment === aktivniSegment ? "on" : undefined}
            aria-current={p.segment === aktivniSegment ? "page" : undefined}
            title={p.nazev}
          >
            <Ikona klic={p.ikona} />
            <span className="stitek">{p.nazev}</span>
          </Link>
        ))}

        {chystane.length > 0 ? <hr /> : null}

        {chystane.map((p) => (
          <span key={p.segment} className="polozka soon" title={`${p.nazev} — připravujeme`}>
            <Ikona klic={p.ikona} />
            <span className="stitek">{p.nazev}</span>
            <small>brzy</small>
          </span>
        ))}
      </nav>
    </div>
  );
}
