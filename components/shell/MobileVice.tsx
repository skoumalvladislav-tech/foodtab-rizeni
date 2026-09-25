"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Drawer from "@/components/ui/Drawer";
import Ikona from "@/app/[rozsah]/ikona";
import PrepinacRezimu from "@/app/prepinac-rezimu";
import { odhlasit } from "@/app/prihlaseni/akce";
import type { PolozkaProp } from "./AppShell";

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
 * ---------------------------------------------------------------------
 * PŘÍSTUPNOST
 *
 * Mechaniku dělá sdílený `Drawer`: fokus do panelu při otevření
 * a zpátky na tlačítko „Více" při zavření, Escape a ťuknutí vedle
 * zavírají, `role="dialog"` s nadpisem. Tlačítko nese `aria-expanded`.
 *
 * Menu se zavře i samo, když se změní adresa (tlačítko Zpět
 * v prohlížeči) — pamatuje si, na které adrese se otevřelo.
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
  // Adresa, na které se menu otevřelo; `null` = zavřené. Po přechodu
  // jinam (i tlačítkem Zpět) přestane sedět a menu je zavřené bez
  // efektu, který by stav přepisoval zpětně.
  const [otevrenoNa, setOtevrenoNa] = useState<string | null>(null);
  const otevreno = otevrenoNa === cesta;

  // Stálá funkce: Drawer má `onZavrit` v závislostech efektu, který
  // přesouvá fokus. Nová funkce při každém vykreslení by fokus
  // přehazovala sem a tam.
  const zavrit = useCallback(() => setOtevrenoNa(null), []);

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
          setOtevrenoNa(cesta);
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

/**
 * Obsah menu. Samostatně, aby se dal vykreslit a zkontrolovat bez
 * portálu (scripts/nabidka.test.mjs).
 */
export function ObsahVice({
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

      <Odhlaseni />
    </div>
  );
}

/**
 * ODHLÁŠENÍ S DOTAZEM (podmínka Šéfíka, 8. 9.).
 *
 * Na Mých údajích zůstává — tam patří k výdeji dat a k souhlasům. Tady
 * je proto, že sem člověk jde, když hledá „něco ostatního"; Šéfík ho
 * 6. 9. pod Mými údaji nenašel, a to věděl, že tam je.
 *
 * Do horní lišty ne a ne bez dotazu: na sdíleném telefonu za barem,
 * s mokrýma rukama, je omylem ťuknuté odhlášení uprostřed směny horší
 * než ťuknutí navíc.
 *
 * Fokus se při přepnutí přesouvá sám: tlačítko, na které člověk
 * ťukl, zmizí, a fokus by jinak spadl mimo otevřené menu. Na dotaz
 * přistane na „Zpět" — bezpečná volba, kdyby se Enter zmáčkl dvakrát.
 */
export function Odhlaseni({
  ptaSeNaZacatku = false,
}: {
  /**
   * Začít rovnou dotazem. Aplikace to nepoužívá — je to pro kontrolu
   * ve scripts/nabidka.test.mjs, která bez prohlížeče neumí ťuknout
   * a jinak by druhý stav nikdy neviděla.
   */
  ptaSeNaZacatku?: boolean;
}) {
  const [ptaSe, setPtaSe] = useState(ptaSeNaZacatku);
  const presunoutFokus = useRef(false);
  const odhlasitRef = useRef<HTMLButtonElement>(null);
  const zpetRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!presunoutFokus.current) return;
    presunoutFokus.current = false;
    (ptaSe ? zpetRef : odhlasitRef).current?.focus();
  }, [ptaSe]);

  function prepnout(novy: boolean) {
    presunoutFokus.current = true;
    setPtaSe(novy);
  }

  return (
    <div className="ds-vice-odhlaseni">
      {ptaSe ? (
        <>
          <p className="ds-vice-dotaz">Odhlásit se?</p>
          <div className="ds-vice-akce">
            {/* Na rozcestníku bylo holé .ft-tl — bez obrysu i výplně
                vypadalo jako text vedle „Zpět". Po dotazu je to ta akce,
                kvůli které člověk přišel, proto hlavní vzhled. */}
            <form action={odhlasit}>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odhlásit
              </button>
            </form>
            <button
              ref={zpetRef}
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => prepnout(false)}
            >
              Zpět
            </button>
          </div>
        </>
      ) : (
        // Ikona A slovo. Samotná ikona se dá splést s čímkoli — zvlášť
        // u něčeho, co se nesmí ťuknout omylem.
        <button
          ref={odhlasitRef}
          type="button"
          className="ft-tl ft-tl-vedlejsi ds-vice-odhlasit"
          onClick={() => prepnout(true)}
        >
          <Ikona klic="odhlasit" />
          Odhlásit se
        </button>
      )}
      <p className="ds-vice-poznamka">
        Odhlásí vás z tohohle zařízení. Příště se přihlásíte kódem z e-mailu.
      </p>
    </div>
  );
}
