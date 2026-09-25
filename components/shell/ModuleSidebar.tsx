import Link from "next/link";

import Ikona from "@/app/[rozsah]/ikona";
import type { PolozkaProp, SkupinaNavigace } from "./AppShell";
import Odhlaseni from "./Odhlaseni";

/**
 * Levý sloupec — hlavička rozsahu a VŠECHNY moduly najednou jako
 * seskupené sekce s nadpisem (design systém, 15.9.2026 večer,
 * Šéfíkovo rozhodnutí podle master promptu a schváleného mockupu:
 * sloupec se nepřepíná podle vybraného modulu, ukazuje celou appku
 * — horní lišta zůstává jako rychlý odkaz/zvýraznění aktuální sekce).
 *
 * ---------------------------------------------------------------------
 * ODHLÁSIT SE VLEVO DOLE — PROČ TADY (25. 9. 2026)
 *
 * Šéfík 8. 9.: „ikonu odhlásit dát na základní obrazovku třeba vlevo
 * dolů, teď je schovaná" (docs/zarazeni-misto-roli.md, 6.6) — ikona
 * a slovo, oddělené čarou, a s dotazem. Do 25. 9. to byl rozcestník;
 * ten je zrušený a na počítači a tabletu (nad 640 px, kde spodní lišta
 * s „Více" není) je levý sloupec to, co je vlevo dole na každé
 * obrazovce uvnitř rozsahu — i na upozorněních, rozhovorech a na
 * /firma bez zapnutého modulu.
 *
 * Do horní lišty ne (7. 9.: „Omylem ťuknuté odhlášení uprostřed směny
 * je horší než o jedno ťuknutí delší cesta") — ani schované pod
 * iniciálami, to by bylo zase schované. Hlídá to
 * scripts/prihlaseni.test.mjs.
 *
 * Připnuté dole (globals.css, `.ft-side-pata`): když je seznam
 * obrazovek dlouhý, sloupec se roluje a odhlášení zůstává vidět, ne až
 * pod posledním Nastavením. Na tabletu je sloupec jen z ikon — tam je
 * jen ikona s popiskem pro odečítač a dotaz vyskočí jako karta vedle.
 *
 * Marketing a Faktury mají na počítači vlastní sloupec a kreslí totéž
 * na jeho konci (`app/[rozsah]/marketing/navigace.tsx`,
 * `app/[rozsah]/finance/faktury/navigace.tsx`). Na tabletu tam sloupec
 * není žádný (mají vlastní spodní lištu) a cesta vede přes záložku
 * Provoz. Moje údaje leží mimo rozsah a mají vlastní odhlášení dole
 * na stránce.
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

      <div className="ft-side-pata">
        <Odhlaseni varianta="sloupec" />
      </div>
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
