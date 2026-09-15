import Link from "next/link";

import Ikona from "@/app/[rozsah]/ikona";
import type { PolozkaProp, SkupinaNavigace } from "./AppShell";

/**
 * Levý sloupec — hlavička rozsahu a VŠECHNY moduly najednou jako
 * seskupené sekce s nadpisem (design systém, 15.9.2026 večer,
 * Šéfíkovo rozhodnutí podle master promptu a schváleného mockupu:
 * sloupec se nepřepíná podle vybraného modulu, ukazuje celou appku
 * — horní lišta zůstává jako rychlý odkaz/zvýraznění aktuální sekce).
 */
export default function ModuleSidebar({
  rozsah,
  druh,
  nazevRozsahu,
  nazevFirmy,
  skupiny,
  aktivniSegment,
}: {
  rozsah: string;
  druh: string;
  nazevRozsahu: string;
  nazevFirmy: string;
  skupiny: SkupinaNavigace[];
  aktivniSegment: string | undefined;
}) {
  return (
    <div className="ft-side">
      <div className="ft-side-head">
        <div className="ft-strip" />
        <span>{druh}</span>
        <b>{nazevRozsahu || nazevFirmy}</b>
      </div>

      <nav className="ft-nav" aria-label="Obrazovky">
        {skupiny.map((s, i) => (
          <div key={s.klic} className="ft-nav-skupina">
            {/* První nadpis hned pod hlavičkou rozsahu nepotřebuje
                extra odstup nahoře — další sekce ano, ať se dají
                rozeznat. */}
            <div className="ft-nav-nadpis" style={i === 0 ? { marginTop: 0 } : undefined}>
              {s.nazev}
            </div>

            {s.hotove.map((p) => (
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

            {s.chystane.map((p) => (
              <ChystanaPolozka key={p.segment} p={p} />
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function ChystanaPolozka({ p }: { p: PolozkaProp }) {
  return (
    <span className="polozka soon" title={`${p.nazev} — připravujeme`}>
      <Ikona klic={p.ikona} />
      <span className="stitek">{p.nazev}</span>
      <small>brzy</small>
    </span>
  );
}
