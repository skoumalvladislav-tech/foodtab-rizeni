"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import PrepinacRezimu from "@/app/prepinac-rezimu";
import Ikona from "./ikona";
import type { IkonaKlic } from "./nabidka";

/* ---------------------------------------------------------------------
 * Rám rozhraní: horní lišta, levý sloupec, na mobilu spodní lišta.
 *
 * Je klientský kvůli usePathname() — potřebuje vědět, na které
 * obrazovce stojíme, aby zvýraznil správnou položku a odvodil z ní
 * vybraný modul. Žádné rozhodování o právech tady není: co se smí
 * kreslit, spočítal server a poslal to jako vlastnosti. Schovaná
 * položka stejně není zámek.
 * ------------------------------------------------------------------ */

export type ModulProp = {
  klic: string;
  nazev: string;
  /** Firma modul má. Vypnutý se kreslí, ale zašedle a přeškrtnutě. */
  aktivni: boolean;
  /** Kam vede kliknutí. Prázdné = modul nemá hotovou žádnou obrazovku. */
  cil: string | null;
};

export type PolozkaProp = {
  segment: string;
  nazev: string;
  kratky: string;
  ikona: IkonaKlic;
  hotovo: boolean;
  modul: string;
};

export type RamProps = {
  rozsah: string;
  /** Klíč barvy pobočky z branches.color. Firemní úroveň má slate. */
  barva: string;
  /** "Pobočka" nebo "Rozsah" — nad názvem v hlavičce sloupce. */
  druh: string;
  nazevRozsahu: string;
  kratkyRozsah: string;
  nazevFirmy: string;
  iniciraly: string;
  moduly: ModulProp[];
  polozky: PolozkaProp[];
  nastaveni: PolozkaProp[];
  muzeNastaveni: boolean;
  children: ReactNode;
};

/** Kolik obrazovek se vejde do spodní lišty, než se zbytek schová pod Více. */
const DO_LISTY = 4;

export default function Ram({
  rozsah,
  barva,
  druh,
  nazevRozsahu,
  kratkyRozsah,
  nazevFirmy,
  iniciraly,
  moduly,
  polozky,
  nastaveni,
  muzeNastaveni,
  children,
}: RamProps) {
  const cesta = usePathname() ?? "";
  const predpona = `/${rozsah}/`;
  const segment = cesta.startsWith(predpona)
    ? cesta.slice(predpona.length)
    : null;

  const vsechny = [...polozky, ...nastaveni];
  const zde = vsechny.find(
    (p) => p.segment === segment || (segment?.startsWith(p.segment + "/") ?? false),
  );

  // Jsme v nastavení? Pak levý sloupec ukazuje jeho obrazovky, ne modul.
  const vNastaveni = segment?.startsWith("nastaveni") ?? false;
  const vybranyModul = vNastaveni ? null : (zde?.modul ?? "provoz");

  const sloupec = vNastaveni
    ? nastaveni
    : polozky.filter((p) => p.modul === vybranyModul);

  const hotove = sloupec.filter((p) => p.hotovo);
  const chystane = sloupec.filter((p) => !p.hotovo);

  // Spodní lišta: nejčastější obrazovky, zbytek pod Více. Pátý slot je
  // Více, jen když se do čtyř všechno nevejde.
  const doListy = sloupec.length <= 5 ? sloupec.slice(0, 5) : sloupec.slice(0, DO_LISTY);
  const jeVice = sloupec.length > 5;

  return (
    <div className="ft-shell" data-branch={barva}>
      <header className="ft-topbar">
        <Link href={`/${rozsah}`} className="ft-brand">
          Food<em>tab</em>
        </Link>

        <nav className="ft-mods" aria-label="Moduly">
          {moduly.map((m) => (
            <Modul key={m.klic} modul={m} vybrany={m.klic === vybranyModul} />
          ))}
        </nav>

        <div className="ft-spacer" />

        <div className="ft-tools">
          <Link
            href={`/${rozsah}`}
            className="ft-chip"
            title={`${druh}: ${nazevRozsahu}`}
          >
            <span className="ft-swatch" />
            <span>{kratkyRozsah}</span>
          </Link>

          <PrepinacRezimu />

          <span className="ft-avatar" title={nazevFirmy} aria-hidden="true">
            {iniciraly}
          </span>

          {muzeNastaveni ? (
            <>
              <span className="ft-divider" />
              <Link
                href={`/${rozsah}/nastaveni/pobocky`}
                className="ft-ikona ram"
                title="Nastavení"
                aria-label="Nastavení"
              >
                <Ikona klic="kolo" />
              </Link>
            </>
          ) : null}
        </div>
      </header>

      {/* Na mobilu se moduly stěhují pod lištu jako rolovatelná řádka. */}
      <nav className="ft-mob-mods" aria-label="Moduly">
        {moduly.map((m) => (
          <Modul key={m.klic} modul={m} vybrany={m.klic === vybranyModul} />
        ))}
      </nav>

      <div className="ft-body">
        <aside className="ft-side">
          <div className="ft-side-head">
            <div className="ft-strip" />
            <span>{vNastaveni ? "Nastavení" : druh}</span>
            <b>{vNastaveni ? nazevFirmy : nazevRozsahu}</b>
          </div>

          <nav className="ft-nav" aria-label="Obrazovky">
            {hotove.map((p) => (
              <Link
                key={p.segment}
                href={`/${rozsah}/${p.segment}`}
                className={p.segment === zde?.segment ? "on" : undefined}
                aria-current={p.segment === zde?.segment ? "page" : undefined}
                title={p.nazev}
              >
                <Ikona klic={p.ikona} />
                <span className="stitek">{p.nazev}</span>
              </Link>
            ))}

            {chystane.length > 0 ? <hr /> : null}

            {chystane.map((p) => (
              <span
                key={p.segment}
                className="polozka soon"
                title={`${p.nazev} — připravujeme`}
              >
                <Ikona klic={p.ikona} />
                <span className="stitek">{p.nazev}</span>
                <small>brzy</small>
              </span>
            ))}
          </nav>
        </aside>

        <main className="ft-main">{children}</main>
      </div>

      <nav className="ft-mob-bottom" aria-label="Obrazovky">
        {doListy.map((p) =>
          p.hotovo ? (
            <Link
              key={p.segment}
              href={`/${rozsah}/${p.segment}`}
              className={p.segment === zde?.segment ? "on" : undefined}
              aria-current={p.segment === zde?.segment ? "page" : undefined}
            >
              <Ikona klic={p.ikona} />
              <span>{p.kratky}</span>
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
    </div>
  );
}

/**
 * Záložka modulu.
 *
 * Vypnutý modul se neschovává — zákazník má vidět, co si může přikoupit.
 * Kreslí se zašedle, přeškrtnutě a neklikací. Dovnitř by ho stejně
 * nepustila databáze, ne jen nabídka.
 */
function Modul({ modul, vybrany }: { modul: ModulProp; vybrany: boolean }) {
  if (!modul.aktivni) {
    return (
      <span
        className="ft-mod off"
        title="Není součástí vašeho tarifu"
        aria-disabled="true"
      >
        {modul.nazev}
      </span>
    );
  }

  if (!modul.cil) {
    return (
      <span className="ft-mod" title={`${modul.nazev} — připravujeme`}>
        {modul.nazev}
      </span>
    );
  }

  return (
    <Link
      href={modul.cil}
      className={vybrany ? "ft-mod on" : "ft-mod"}
      aria-current={vybrany ? "page" : undefined}
    >
      {modul.nazev}
    </Link>
  );
}
