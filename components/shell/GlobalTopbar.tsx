"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import PrepinacRezimu from "@/app/prepinac-rezimu";
import Ikona from "@/app/[rozsah]/ikona";
import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import PrepinacRozsahu, { type RozsahProp } from "@/app/[rozsah]/prepinac-rozsahu";
import { datumACasVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { nadpisUpozorneni, obdobiRozpisu } from "@/lib/upozorneni-text";
import type { ModulProp, UpozorneniProp } from "./AppShell";
import MenuUctu from "./MenuUctu";

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
 * zvoneček, nastavení, iniciály s nabídkou účtu (MenuUctu, od 25. 9.
 * 2026; do té doby jen ozdoba). Vytažena z app/[rozsah]/ram.tsx
 * (design systém, 15.9.2026) beze změny chování — jen jako vlastní
 * pojmenovaná komponenta, ať appka má opravdový AppShell/GlobalTopbar
 * místo jednoho velkého souboru.
 */
export default function GlobalTopbar({
  rozsah,
  domu,
  moduly,
  vybranyModul,
  rozsahy,
  aktivniRozsah,
  cilRozsahu,
  neprectenych,
  posledniUpozorneni,
  cilNastaveni,
  nazevFirmy,
  iniciraly,
}: {
  rozsah: string;
  /** Kam vede logo — výchozí obrazovka rozsahu (Dnes), ne holá adresa. */
  domu: string;
  moduly: ModulProp[];
  vybranyModul: string | null;
  rozsahy: RozsahProp[];
  aktivniRozsah: string;
  cilRozsahu: (slug: string) => string;
  neprectenych: number;
  posledniUpozorneni: UpozorneniProp[];
  cilNastaveni: string | null;
  nazevFirmy: string;
  iniciraly: string;
}) {
  /*
    Vysouvací panel místo rovnou celé stránky — zadání ("KOMUNIKACE /
    VZKAZY 2.0", bod 15) navrhuje náhled u zvonečku, ne jen odkaz.
    Panel jen NÁHLÍŽÍ; otevírá se z něj tatáž `/upozorneni`, kde se
    dá i cokoli udělat (potvrdit, označit přečtené) — dvojitou
    logiku pro totéž tady nemá cenu stavět.
  */
  const [otevreno, setOtevreno] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!otevreno) return;

    function naKlikMimo(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOtevreno(false);
      }
    }
    function naEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOtevreno(false);
    }

    document.addEventListener("mousedown", naKlikMimo);
    document.addEventListener("keydown", naEscape);
    return () => {
      document.removeEventListener("mousedown", naKlikMimo);
      document.removeEventListener("keydown", naEscape);
    };
  }, [otevreno]);

  return (
    <>
      <header className="ft-topbar">
        {/* Do 25. 9. 2026 vedlo logo na rozcestník; ten je zrušený a logo
            vede domů, na Dnes — rovnou, bez přesměrování z holé adresy. */}
        <Link href={domu} className="ft-brand">
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
            Na telefonu se přepínač režimu z lišty stěhuje do menu „Více“
            ve spodní liště (MobileVice). Nemizí — jen nesedí na
            nejdražším místě aplikace. Viz .ft-rezim v globals.css.
          */}
          <span className="ft-rezim">
            <PrepinacRezimu />
          </span>

          {/*
            Zvoneček. Číslo je počet nepřečtených — bez něj by se muselo
            klikat naslepo. Kreslí se vždycky, i s nulou: kdyby mizel,
            nešlo by se k přečteným upozorněním vrátit.

            Tlačítko místo odkazu — otevírá panel NA MÍSTĚ, ne celou
            stránku. Panel jen náhlíží; klik na položku i "Zobrazit
            všechna" stejně vedou na `/upozorneni`, kde se dá s nimi
            i něco udělat (potvrdit, označit přečtené) — druhou logiku
            pro totéž tady nemá cenu stavět.
          */}
          <div ref={panelRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setOtevreno((v) => !v)}
              className="ft-ikona ram"
              title={neprectenych > 0 ? `Upozornění (${neprectenych} nepřečtených)` : "Upozornění"}
              aria-label={neprectenych > 0 ? `Upozornění, ${neprectenych} nepřečtených` : "Upozornění"}
              aria-expanded={otevreno}
              aria-haspopup="true"
              style={{ position: "relative", border: "none", background: "none", padding: 0, font: "inherit", cursor: "pointer" }}
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
            </button>

            {otevreno ? (
              <PanelUpozorneni
                rozsah={rozsah}
                upozorneni={posledniUpozorneni}
                onZavrit={() => setOtevreno(false)}
              />
            ) : null}
          </div>

          {cilNastaveni ? (
            <>
              <span className="ft-divider" />
              {/* Na telefonu taky pryč — Nastavení je v menu „Více“. */}
              <Link href={cilNastaveni} className="ft-ikona ram ft-nastaveni" title="Nastavení" aria-label="Nastavení">
                <Ikona klic="kolo" />
              </Link>
            </>
          ) : null}

          {/* Iniciály jsou tlačítko nabídky účtu: Moje údaje a Vzhled.
              Na telefonu schované, tam je totéž ve „Více“. Cesta ven
              z aplikace sem nepatří — je vlevo dole (ModuleSidebar). */}
          <MenuUctu iniciraly={iniciraly} nazevFirmy={nazevFirmy} />
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

/**
 * Rozbalovací panel u zvonečku.
 *
 * Jen náhled — potvrdit, označit přečtené a odkazy na konkrétní objekt
 * umí plná stránka `/upozorneni`, tady by to bylo zdvojení. Klik na
 * položku i patičku vedou tam.
 */
function PanelUpozorneni({
  rozsah,
  upozorneni,
  onZavrit,
}: {
  rozsah: string;
  upozorneni: UpozorneniProp[];
  onZavrit: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Upozornění"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        insetInlineEnd: 0,
        width: "min(340px, calc(100vw - 24px))",
        maxHeight: "min(480px, calc(100vh - 80px))",
        overflowY: "auto",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        zIndex: 50,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
          fontSize: "14px",
          fontWeight: 700,
        }}
      >
        Upozornění
      </div>

      {upozorneni.length === 0 ? (
        <p style={{ margin: 0, padding: "16px 14px", fontSize: "13px", color: "var(--muted)" }}>
          Zatím tu nic není.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {upozorneni.map((z) => (
            <li key={z.id} style={{ borderBottom: "1px solid var(--line)" }}>
              <Link
                href={`/${rozsah}/upozorneni`}
                onClick={onZavrit}
                style={{
                  display: "block",
                  padding: "10px 14px",
                  color: "inherit",
                  textDecoration: "none",
                  borderInlineStart: z.read_at ? "3px solid transparent" : "3px solid var(--mosaz)",
                }}
              >
                <strong style={{ display: "block", fontSize: "13.5px" }}>
                  {nadpisUpozorneni(z.druh, z.telo, obdobiRozpisu)}
                </strong>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {datumACasVPasmu(z.created_at, ZONA_VYCHOZI)}
                  {!z.read_at ? " · nové" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/${rozsah}/upozorneni`}
        onClick={onZavrit}
        style={{
          display: "block",
          padding: "10px 14px",
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--mosaz)",
          textDecoration: "none",
        }}
      >
        Zobrazit všechna upozornění →
      </Link>
    </div>
  );
}
