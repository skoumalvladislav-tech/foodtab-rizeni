"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";

import Drawer from "@/components/ui/Drawer";
import Ikona from "@/app/[rozsah]/ikona";
import PrepinacRezimu from "@/app/prepinac-rezimu";
import { jeOtevrena, poKliknuti, poZmeneAdresy, ZAVRENA, type StavNabidky } from "@/lib/stav-nabidky";
import type { PolozkaProp } from "./AppShell";
import Odhlaseni from "./Odhlaseni";

/**
 * Skupina obrazovek v menu „Více" — jeden modul, nebo Nastavení.
 * Skládá ji AppShell ze stejných seznamů, ze kterých kreslí levý sloupec.
 */
export type SkupinaVice = {
  klic: string;
  nazev: string;
  polozky: PolozkaProp[];
};

/**
 * „Více" ve spodní liště na telefonu — výsuvné menu zdola.
 *
 * ---------------------------------------------------------------------
 * NÁHRADA ROZCESTNÍKU (Šéfík 24. 9. 2026: „odstraň kartu rozcestník —
 * je zbytečná")
 *
 * Dřív „Více" vedlo na samostatnou obrazovku `/<rozsah>` s dlaždicemi.
 * Na telefonu to ale nebyla jen jedna z cest — byla to JEDINÁ cesta ke
 * všemu, co se nevejde do lišty: pruh modulů se pod 640 px schovává,
 * ozubené kolo Nastavení a přepínač vzhledu taky (globals.css, „Pět
 * prvků se na telefon nevejde"). Obsah proto nemizí, jen se stěhuje
 * sem: obrazovky všech modulů, Nastavení, Vzhled a Odhlásit se.
 *
 * Nastavení navíc přibylo — rozcestník ukazoval jen moduly, takže
 * Nastavení (a s ním Moje údaje) se z telefonu dalo otevřít jen
 * napsanou adresou.
 *
 * „Více" je v liště VŽDYCKY, ne až když se obrazovky nevejdou: Vzhled,
 * Odhlásit se a Moje údaje potřebuje i číšník se třemi položkami.
 *
 * Jen na telefonu — nad 640 px se spodní lišta schovává. Na počítači
 * a tabletu je Odhlásit se vlevo dole na konci levého sloupce
 * (ModuleSidebar), Moje údaje a Vzhled pod iniciálami v horní liště
 * (MenuUctu).
 *
 * ---------------------------------------------------------------------
 * PŘÍSTUPNOST
 *
 * Mechaniku dělá sdílený `Drawer`: fokus do panelu při otevření
 * a zpátky na tlačítko „Více" při zavření, Escape a ťuknutí vedle
 * zavírají, `role="dialog"` s nadpisem. Tlačítko nese `aria-expanded`.
 *
 * Menu se zavře i samo, když se změní adresa (tlačítko Zpět
 * v prohlížeči), a po návratu na tutéž adresu samo nevyskočí
 * (lib/stav-nabidky.ts, stejné jako nabídka účtu).
 */
export default function MobileVice({
  rozsah,
  skupiny,
  aktivniSegment,
}: {
  rozsah: string;
  skupiny: SkupinaVice[];
  aktivniSegment: string | undefined;
}) {
  const cesta = usePathname() ?? "";
  const [stav, setStav] = useState<StavNabidky>(ZAVRENA);
  const platny = poZmeneAdresy(stav, cesta);
  if (platny !== stav) setStav(platny);
  const otevreno = jeOtevrena(platny, cesta);

  // Stálá funkce: Drawer má `onZavrit` v závislostech efektu, který
  // přesouvá fokus. Nová funkce při každém vykreslení by fokus
  // přehazovala sem a tam.
  const zavrit = useCallback(() => setStav(ZAVRENA), []);

  return (
    <>
      <button
        type="button"
        className={otevreno ? "on" : undefined}
        aria-haspopup="dialog"
        aria-expanded={otevreno}
        onClick={(e) => {
          // Drawer vrací fokus tam, kde byl při otevření. Safari na
          // iPhonu ťuknutím tlačítko nezaměří, a fokus by se po zavření
          // vrátil na začátek stránky místo sem.
          e.currentTarget.focus();
          setStav((s) => poKliknuti(s, cesta));
        }}
      >
        <Ikona klic="tecky" />
        <span>Více</span>
      </button>

      <Drawer otevreno={otevreno} onZavrit={zavrit} nadpis="Více" umisteni="bottom">
        <ObsahVice
          rozsah={rozsah}
          skupiny={skupiny}
          aktivniSegment={aktivniSegment}
          onVybrano={zavrit}
        />
      </Drawer>
    </>
  );
}

/** Obsah menu — to, co Drawer ukáže po ťuknutí na „Více". */
function ObsahVice({
  rozsah,
  skupiny,
  aktivniSegment,
  onVybrano,
}: {
  rozsah: string;
  skupiny: SkupinaVice[];
  aktivniSegment: string | undefined;
  /** Ťuknutí na odkaz menu zavře — i na odkaz na obrazovku, kde člověk už je. */
  onVybrano?: () => void;
}) {
  return (
    <div className="ds-vice">
      <nav className="ds-vice-nabidka" aria-label="Všechny obrazovky">
        {skupiny.map((s) => (
          <section key={s.klic} className="ds-vice-skupina">
            <h3>{s.nazev}</h3>
            <ul className="ds-vice-mrizka">
              {s.polozky.map((p) => (
                <li key={p.segment}>
                  {p.hotovo ? (
                    <Link
                      href={p.adresa ?? `/${rozsah}/${p.segment}`}
                      aria-current={p.segment === aktivniSegment ? "page" : undefined}
                      onClick={onVybrano}
                    >
                      <Ikona klic={p.ikona} />
                      <span>{p.nazev}</span>
                    </Link>
                  ) : (
                    // Chystané jen vedení (nabidka.ts, smiVidet) — slib, co
                    // firma dostane. Neklikací, ať nevede na prázdnou stránku.
                    <span className="ds-vice-chystane">
                      <Ikona klic={p.ikona} />
                      <span>
                        {p.nazev}
                        <small>Připravujeme</small>
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      {/*
        Přepínač vzhledu. Na telefonu z horní lišty zmizel — pět prvků
        se tam nevešlo a ozubené kolo přetékalo z obrazovky. Ubrat ho
        bez náhrady by znamenalo funkci zrušit, ne přestěhovat.
      */}
      <div className="ds-vice-radek">
        <span>Vzhled</span>
        <PrepinacRezimu />
      </div>

      <Odhlaseni varianta="menu" />
    </div>
  );
}
