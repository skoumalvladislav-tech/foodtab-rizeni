"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import PrepinacRezimu from "@/app/prepinac-rezimu";
import Ikona from "@/app/[rozsah]/ikona";
import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import PrepinacRozsahu, { type RozsahProp } from "@/app/[rozsah]/prepinac-rozsahu";
import { otevritUpozorneni, oznacitVsePrectene } from "@/app/[rozsah]/upozorneni/otevrit";
import { datumACasVPasmu, ZONA_VYCHOZI } from "@/lib/cas";
import { nadpisUpozorneni, obdobiRozpisu } from "@/lib/upozorneni-text";
import type { ModulProp, RozpadZvonecku, UpozorneniProp } from "./AppShell";
import MenuUctu, { type FirmaProp } from "./MenuUctu";

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
  rozpad,
  posledniUpozorneni,
  cilNastaveni,
  nazevFirmy,
  firmy,
  aktivniFirmaId,
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
  /** Z čeho se číslo na zvonečku skládá; panel to ukáže po řádcích. */
  rozpad?: RozpadZvonecku;
  posledniUpozorneni: UpozorneniProp[];
  cilNastaveni: string | null;
  nazevFirmy: string;
  firmy?: FirmaProp[];
  aktivniFirmaId?: string;
  iniciraly: string;
}) {
  /*
    Vysouvací panel místo rovnou celé stránky — zadání ("KOMUNIKACE /
    VZKAZY 2.0", bod 15) navrhuje náhled u zvonečku, ne jen odkaz.

    Od 27. 9. panel ukazuje, CO číslo na zvonečku počítá: sčítají se
    tři zdroje (upozornění, nepřečtené zprávy, nová oznámení) a do té
    doby byl v panelu jen první — kdo měl na zvonečku „5“ a v panelu
    nic nového, nevěděl, kde to je. Klepnutí na upozornění ho označí za
    přečtené a otevře věc, ke které patří (`otevritUpozorneni`).
  */
  const [otevreno, setOtevreno] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
    Klepnutí na upozornění odešle formulář a server přesměruje na věc
    (27. 9.). Lišta je v rámu a přechodem se nepřekreslí od nuly, takže
    by panel zůstal otevřený nad novou stránkou — zavře se proto při
    každé změně adresy (úprava stavu při vykreslení, ne v efektu).
  */
  const cesta = usePathname();
  const [cestaPanelu, setCestaPanelu] = useState(cesta);
  if (cestaPanelu !== cesta) {
    setCestaPanelu(cesta);
    if (otevreno) setOtevreno(false);
  }

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
            stránku. Ikona je zvonek (do 27. 9. bublina, stejná jako
            Vzkazy — nešlo je od sebe poznat).
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
              <Ikona klic="zvonek" />
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
                rozpad={rozpad}
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
          <MenuUctu
            iniciraly={iniciraly}
            nazevFirmy={nazevFirmy}
            firmy={firmy}
            aktivniFirmaId={aktivniFirmaId}
          />
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
 * Nahoře řádky „Nepřečtené zprávy“ a „Nová oznámení“ (jen když nejsou
 * nula) — číslo na zvonečku je sčítá, tak je musí být v panelu vidět.
 * „Zprávy“, ne „rozhovory“ (28. 9.): číslo je součet nepřečtených ZPRÁV
 * ze všech rozhovorů (`moje_rozhovory.neprectenych`). Kanál se šesti
 * novými zprávami byl „Nepřečtené rozhovory: 6“ a filtr pak našel jeden.
 * Pod nimi posledních pár upozornění. Každé je formulář: klepnutí ho
 * označí za přečtené a přesměruje na věc (`otevritUpozorneni`; cíl se
 * počítá z uloženého řádku, ne z panelu). Dole „Označit vše za
 * přečtené“, „Nastavení upozornění“ a celá stránka Upozornění.
 */
export function PanelUpozorneni({
  rozsah,
  upozorneni,
  rozpad,
  onZavrit,
}: {
  rozsah: string;
  upozorneni: UpozorneniProp[];
  rozpad?: RozpadZvonecku;
  onZavrit: () => void;
}) {
  const nejakeNeprectene = upozorneni.some((z) => !z.read_at) || (rozpad?.upozorneni ?? 0) > 0;
  return (
    <div role="dialog" aria-label="Upozornění" className="ds-plocha ft-zvonek-panel">
      <div className="ft-zvonek-hlava">
        <Ikona klic="zvonek" />
        <h2>Upozornění</h2>
        <Link href={`/${rozsah}/upozorneni/nastaveni`} onClick={onZavrit} className="ft-zvonek-nastaveni">
          Nastavení
        </Link>
      </div>

      {(rozpad?.rozhovory ?? 0) > 0 || (rozpad?.nastenka ?? 0) > 0 ? (
        <ul className="ft-zvonek-souhrn">
          {(rozpad?.rozhovory ?? 0) > 0 ? (
            <li>
              <Link href={`/${rozsah}/vzkazy?filtr=neprectene`} onClick={onZavrit}>
                <Ikona klic="zprava" />
                <span>Nepřečtené zprávy: {rozpad?.rozhovory}</span>
                <Ikona klic="sipkaVpravo" />
              </Link>
            </li>
          ) : null}
          {(rozpad?.nastenka ?? 0) > 0 ? (
            <li>
              <Link href={`/${rozsah}/vzkazy?zalozka=nastenka`} onClick={onZavrit}>
                <Ikona klic="praporek" />
                <span>Nová oznámení: {rozpad?.nastenka}</span>
                <Ikona klic="sipkaVpravo" />
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}

      {upozorneni.length === 0 ? (
        <p className="ft-zvonek-prazdno">Zatím tu nic není.</p>
      ) : (
        <ul className="ft-zvonek-seznam">
          {upozorneni.map((z) => (
            <li key={z.id}>
              <form action={otevritUpozorneni}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="id" value={z.id} />
                <button type="submit" data-nove={z.read_at ? undefined : "1"}>
                  <strong>{nadpisUpozorneni(z.druh, z.telo, obdobiRozpisu)}</strong>
                  <span>
                    {datumACasVPasmu(z.created_at, ZONA_VYCHOZI)}
                    {!z.read_at ? " · nové" : ""}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="ft-zvonek-pata">
        {nejakeNeprectene ? (
          <form action={oznacitVsePrectene}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
              <Ikona klic="fajfka" /> Označit vše za přečtené
            </button>
          </form>
        ) : null}
        <Link href={`/${rozsah}/upozorneni`} onClick={onZavrit} className="ft-zvonek-vse">
          Zobrazit všechna upozornění →
        </Link>
      </div>
    </div>
  );
}
