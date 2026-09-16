"use client";

import Link from "next/link";

import PrepinacRezimu from "@/app/prepinac-rezimu";
import Ikona from "@/app/[rozsah]/ikona";
import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import PrepinacRozsahu, { type RozsahProp } from "@/app/[rozsah]/prepinac-rozsahu";
import type { ModulProp } from "./AppShell";

/**
 * Ikona modulu v horní liště — mockup Šéfíka ji u záložek má, appka
 * zatím neměla. Klíč modulu je z `lib/authz.ts` (`MODULES`), stálý a
 * malý výčet (5), proto mapa napevno tady místo dalšího proputování
 * přes server. Neznámý/budoucí klíč dostane `tecky` jako neutrální
 * zástupnou ikonu, ať appka nespadne, až přibude šestý modul.
 */
const IKONA_MODULU: Record<string, IkonaKlic> = {
  provoz: "hodiny",
  menu: "kniha",
  finance: "mince",
  marketing: "praporek",
  objednavky: "vozik",
};

/**
 * Horní lišta — značka, moduly, hledání, přepínač rozsahu/režimu,
 * zvoneček, nastavení, avatar. Vytažena z app/[rozsah]/ram.tsx
 * (design systém, 15.9.2026) beze změny chování — jen jako vlastní
 * pojmenovaná komponenta, ať appka má opravdový AppShell/GlobalTopbar
 * místo jednoho velkého souboru.
 */
export default function GlobalTopbar({
  rozsah,
  moduly,
  vybranyModul,
  rozsahy,
  aktivniRozsah,
  cilRozsahu,
  neprectenych,
  cilNastaveni,
  nazevFirmy,
  iniciraly,
}: {
  rozsah: string;
  moduly: ModulProp[];
  vybranyModul: string | null;
  rozsahy: RozsahProp[];
  aktivniRozsah: string;
  cilRozsahu: (slug: string) => string;
  neprectenych: number;
  cilNastaveni: string | null;
  nazevFirmy: string;
  iniciraly: string;
}) {
  return (
    <>
      <header className="ft-topbar">
        <Link href={`/${rozsah}`} className="ft-brand">
          Food<em>tab</em>
        </Link>

        {/* Prazdna rada se nekresli vubec — jinak by po sobe nechala
            mezeru a na telefonu je kazdy pixel videt. */}
        {moduly.length > 0 ? (
          <nav className="ft-mods" aria-label="Moduly">
            {moduly.map((m) => (
              <Modul key={m.klic} modul={m} vybrany={m.klic === vybranyModul} />
            ))}
          </nav>
        ) : null}

        <div className="ft-spacer" />

        <div className="ft-tools">
          <PrepinacRozsahu rozsahy={rozsahy} aktivni={aktivniRozsah} cil={cilRozsahu} />

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
            {/* Jen vzhledová zkratka — pole je pořád disabled, viz komentář
                výš. Schovává se, když se pole samo zúží na ikonu (níž),
                ať nebojuje o místo s ničím. */}
            <kbd className="ft-hledani-zkratka" aria-hidden="true">⌘K</kbd>
          </div>

          {/*
            Na telefonu se přepínač režimu z lišty stěhuje na rozcestník
            („Více“). Nemizí — jen nesedí na nejdražším místě aplikace.
            Viz .ft-rezim v globals.css.
          */}
          <span className="ft-rezim">
            <PrepinacRezimu />
          </span>

          {/*
            Zvoneček. Číslo je počet nepřečtených — bez něj by se muselo
            klikat naslepo. Kreslí se vždycky, i s nulou: kdyby mizel,
            nešlo by se k přečteným upozorněním vrátit.
          */}
          <Link
            href={`/${rozsah}/upozorneni`}
            className="ft-ikona ram"
            title={neprectenych > 0 ? `Upozornění (${neprectenych} nepřečtených)` : "Upozornění"}
            aria-label={neprectenych > 0 ? `Upozornění, ${neprectenych} nepřečtených` : "Upozornění"}
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
              {/* Na telefonu taky pryč — Nastavení je pod „Více“. */}
              <Link href={cilNastaveni} className="ft-ikona ram ft-nastaveni" title="Nastavení" aria-label="Nastavení">
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
      {moduly.length > 0 ? (
        <nav className="ft-mob-mods" aria-label="Moduly">
          {moduly.map((m) => (
            <Modul key={m.klic} modul={m} vybrany={m.klic === vybranyModul} />
          ))}
        </nav>
      ) : null}
    </>
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
  const ikona = IKONA_MODULU[modul.klic] ?? "tecky";

  if (!modul.aktivni) {
    return (
      <span className="ft-mod off" title="Není součástí vašeho tarifu" aria-disabled="true">
        <Ikona klic={ikona} />
        {modul.nazev}
      </span>
    );
  }

  if (!modul.cil) {
    return (
      <span className="ft-mod" title={`${modul.nazev} — připravujeme`}>
        <Ikona klic={ikona} />
        {modul.nazev}
      </span>
    );
  }

  return (
    <Link href={modul.cil} className={vybrany ? "ft-mod on" : "ft-mod"} aria-current={vybrany ? "page" : undefined}>
      <Ikona klic={ikona} />
      {modul.nazev}
    </Link>
  );
}
