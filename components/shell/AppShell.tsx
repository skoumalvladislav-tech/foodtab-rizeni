"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import type { RozsahProp } from "@/app/[rozsah]/prepinac-rozsahu";
import GlobalTopbar from "./GlobalTopbar";
import ModuleSidebar from "./ModuleSidebar";
import MobileBottomNav from "./MobileBottomNav";

/* ---------------------------------------------------------------------
 * Rám rozhraní: horní lišta, levý sloupec, na mobilu spodní lišta.
 *
 * Design systém, 15.9.2026 — dřív jeden soubor app/[rozsah]/ram.tsx,
 * teď AppShell (tenhle soubor, drží stav a odvozenou logiku) +
 * GlobalTopbar + ModuleSidebar + MobileBottomNav (čistě kreslicí).
 * CHOVÁNÍ BEZE ZMĚNY — jde jen o rozdělení jednoho souboru na
 * pojmenované kusy, žádná logika se nepřepisovala.
 *
 * Je to klientská komponenta kvůli usePathname() — potřebuje vědět, na
 * které obrazovce stojíme, aby zvýraznila správnou položku a odvodila
 * z ní vybraný modul. Žádné rozhodování o právech tady není: co se smí
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

export type AppShellProps = {
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

export default function AppShell({
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
}: AppShellProps) {
  const cesta = usePathname() ?? "";
  const predpona = `/${rozsah}/`;
  const segment = cesta.startsWith(predpona) ? cesta.slice(predpona.length) : null;

  const vsechny = [...polozky, ...nastaveni];
  const zde = vsechny.find((p) => p.segment === segment || (segment?.startsWith(p.segment + "/") ?? false));

  // Jsme v nastavení? Pak levý sloupec ukazuje jeho obrazovky, ne modul.
  const vNastaveni = segment?.startsWith("nastaveni") ?? false;
  const vybranyModul = vNastaveni ? null : (zde?.modul ?? "provoz");

  const sloupec = vNastaveni ? nastaveni : polozky.filter((p) => p.modul === vybranyModul);

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
      const nahrada = polozky.find((p) => p.modul === zde.modul && p.hotovo && !p.jenPobocka);
      return nahrada ? `/${novy}/${nahrada.segment}` : `/${novy}`;
    }

    return `/${novy}/${zaklad}`;
  }

  return (
    <div className="ft-shell" data-branch={barva}>
      <GlobalTopbar
        rozsah={rozsah}
        moduly={moduly}
        vybranyModul={vybranyModul}
        rozsahy={rozsahy}
        aktivniRozsah={aktivniRozsah}
        cilRozsahu={cilRozsahu}
        neprectenych={neprectenych}
        cilNastaveni={cilNastaveni}
        nazevFirmy={nazevFirmy}
        iniciraly={iniciraly}
      />

      <div className="ft-body">
        <ModuleSidebar
          rozsah={rozsah}
          vNastaveni={vNastaveni}
          druh={druh}
          nazevRozsahu={nazevRozsahu}
          nazevFirmy={nazevFirmy}
          hotove={hotove}
          chystane={chystane}
          aktivniSegment={zde?.segment}
        />

        {/*
          Jediný <main> v celé aplikaci. Obrazovky do něj vkládají obsah
          a samy už žádný další nezakládají — dva vnořené by odečítači
          zamotaly orientaci, protože hlavní oblast stránky je jedna.
        */}
        <main className="ft-main">{children}</main>
      </div>

      <MobileBottomNav rozsah={rozsah} doListy={doListy} aktivniSegment={zde?.segment} jeVice={jeVice} segment={segment} />
    </div>
  );
}
