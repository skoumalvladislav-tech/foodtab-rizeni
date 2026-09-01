"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import PrepinacRezimu from "@/app/prepinac-rezimu";
import Ikona from "./ikona";
import PrepinacRozsahu, { type RozsahProp } from "./prepinac-rozsahu";
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
  segment: string
  /** Absolutní adresa mimo rozsah; má přednost před segmentem. */
  adresa?: string;
  nazev: string;
  kratky: string;
  ikona: IkonaKlic;
  hotovo: boolean;
  modul: string;
  /** Bez pobočky nedává smysl — při přepnutí na firmu se jde jinam. */
  jenPobocka?: boolean;
};

export type RamProps = {
  rozsah: string;
  /** Klíč barvy pobočky z branches.color. Firemní úroveň má slate. */
  barva: string;
  /** "Pobočka" nebo "Rozsah" — nad názvem v hlavičce sloupce. */
  druh: string;
  nazevRozsahu: string;
  /** Volby přepínače: Celá firma (jen pro firemní členství) a pobočky. */
  rozsahy: RozsahProp[];
  aktivniRozsah: string;
  /** Segment firemní úrovně z authz (TENANT_SCOPE_SEGMENT). */
  segmentFirmy: string;
  nazevFirmy: string;
  iniciraly: string;
  /** Počet nepřečtených upozornění do zvonečku. */
  neprectenych: number;
  moduly: ModulProp[];
  polozky: PolozkaProp[];
  nastaveni: PolozkaProp[];
  cilNastaveni: string | null;
  children: ReactNode;
};

/** Kolik obrazovek se vejde do spodní lišty, než se zbytek schová pod Více. */
const DO_LISTY = 4;

export default function Ram({
  rozsah,
  barva,
  druh,
  nazevRozsahu,
  rozsahy,
  aktivniRozsah,
  segmentFirmy,
  nazevFirmy,
  iniciraly,
  neprectenych,
  moduly,
  polozky,
  nastaveni,
  cilNastaveni,
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

  /**
   * Kam vede přepnutí rozsahu.
   *
   * Držíme stejnou obrazovku. Podadresu zahazujeme — identifikátor běhu
   * checklistu patří jiné pobočce a jinde by nic nenašel. A obrazovku,
   * která se váže na pobočku, nahradíme na firemní úrovni první
   * obrazovkou téhož modulu, ať se nepřistane na hlášce o přístupu.
   */
  function cilRozsahu(novy: string): string {
    const zaklad = zde?.segment;
    if (!zaklad) return `/${novy}`;

    if (novy === segmentFirmy && zde.jenPobocka) {
      const nahrada = polozky.find(
        (p) => p.modul === zde.modul && p.hotovo && !p.jenPobocka,
      );
      return nahrada ? `/${novy}/${nahrada.segment}` : `/${novy}`;
    }

    return `/${novy}/${zaklad}`;
  }

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
          <PrepinacRozsahu
            rozsahy={rozsahy}
            aktivni={aktivniRozsah}
            cil={cilRozsahu}
          />

          {/* Zatím jen pole. Nic nehledá a na žádný model se neptá —
              až se bude připojovat, platí pravidlo 8 z CLAUDE.md:
              mzdy a docházka do jazykového modelu nejdou. */}
          <div className="ft-hledani" role="search">
            <Ikona klic="lupa" />
            <input
              type="search"
              placeholder="Hledat nebo se zeptat Gastro AI"
              aria-label="Hledat nebo se zeptat Gastro AI"
              disabled
            />
          </div>

          <PrepinacRezimu />

          {/*
            Zvoneček. Číslo je počet nepřečtených — bez něj by se muselo
            klikat naslepo. Kreslí se vždycky, i s nulou: kdyby mizel,
            nešlo by se k přečteným upozorněním vrátit.
          */}
          <Link
            href={`/${rozsah}/upozorneni`}
            className="ft-ikona ram"
            title={
              neprectenych > 0
                ? `Upozornění (${neprectenych} nepřečtených)`
                : "Upozornění"
            }
            aria-label={
              neprectenych > 0
                ? `Upozornění, ${neprectenych} nepřečtených`
                : "Upozornění"
            }
            style={{ position: "relative" }}
          >
            <Ikona klic="zprava" />
            {neprectenych > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "-2px",
                  insetInlineEnd: "-2px",
                  minWidth: "17px",
                  height: "17px",
                  padding: "0 4px",
                  borderRadius: "999px",
                  background: "var(--bad)",
                  color: "#fff",
                  fontSize: "11px",
                  lineHeight: "17px",
                  textAlign: "center",
                  fontWeight: 700,
                }}
              >
                {neprectenych > 9 ? "9+" : neprectenych}
              </span>
            ) : null}
          </Link>

          {cilNastaveni ? (
            <>
              <span className="ft-divider" />
              <Link
                href={cilNastaveni}
                className="ft-ikona ram"
                title="Nastavení"
                aria-label="Nastavení"
              >
                <Ikona klic="kolo" />
              </Link>
            </>
          ) : null}

          <span className="ft-avatar" title={nazevFirmy} aria-hidden="true">
            {iniciraly}
          </span>
        </div>
      </header>

      {/* Na mobilu se moduly stěhují pod lištu jako rolovatelná řádka. */}
      <nav className="ft-mob-mods" aria-label="Moduly">
        {moduly.map((m) => (
          <Modul key={m.klic} modul={m} vybrany={m.klic === vybranyModul} />
        ))}
      </nav>

      <div className="ft-body">
        {/*
          Sloupec je obyčejný <div>. Orientačním bodem v něm je <nav
          aria-label="Obrazovky"> níž — kdyby byl sloupec <aside>, přidal
          by k němu ještě „doplňkový obsah“, což navigace není, a odečítač
          by v seznamu nabízel dvě položky místo jedné.
        */}
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
        </div>

        {/*
          Jediný <main> v celé aplikaci. Obrazovky do něj vkládají obsah
          a samy už žádný další nezakládají — dva vnořené by odečítači
          zamotaly orientaci, protože hlavní oblast stránky je jedna.
        */}
        <main className="ft-main">{children}</main>
      </div>

      <nav className="ft-mob-bottom" aria-label="Obrazovky">
        {doListy.map((p) =>
          p.hotovo ? (
            <Link
              key={p.segment}
              href={p.adresa ?? `/${rozsah}/${p.segment}`}
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
