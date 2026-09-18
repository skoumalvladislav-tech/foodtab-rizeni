"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { IkonaKlic } from "@/app/[rozsah]/nabidka";
import type { RozsahProp } from "@/app/[rozsah]/prepinac-rozsahu";
import type { TeloUpozorneni } from "@/lib/upozorneni-text";
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

export type SkupinaNavigace = {
  klic: string;
  nazev: string;
  hotove: PolozkaProp[];
  chystane: PolozkaProp[];
};

/** Řádek do rozbalovacího panelu zvonečku — jen to, co panel potřebuje. */
export type UpozorneniProp = {
  id: string;
  druh: string;
  telo: TeloUpozorneni;
  created_at: string;
  read_at: string | null;
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
  /** Posledních pár upozornění pro rozbalovací panel zvonečku. */
  posledniUpozorneni: UpozorneniProp[];
  moduly: ModulProp[];
  polozky: PolozkaProp[];
  nastaveni: PolozkaProp[];
  cilNastaveni: string | null;
  /**
   * Názvy modulů, když je databáze nedodá (`NAZVY_MODULU` z nabidka.ts).
   * Musí přijít jako obyčejná data z serveru, ne importem — nabidka.ts
   * importuje lib/authz.ts, které používá next/headers, a hodnotový
   * import odsud by tenhle klientský soubor stáhl do prohlížeče.
   */
  nazvyModulu: Record<string, string>;
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
  posledniUpozorneni,
  moduly,
  polozky,
  nastaveni,
  cilNastaveni,
  nazvyModulu,
  children,
}: AppShellProps) {
  const cesta = usePathname() ?? "";
  const predpona = `/${rozsah}/`;
  const segment = cesta.startsWith(predpona) ? cesta.slice(predpona.length) : null;

  const vsechny = [...polozky, ...nastaveni];
  const zde = vsechny.find((p) => p.segment === segment || (segment?.startsWith(p.segment + "/") ?? false));

  // Jen pro spodní mobilní lištu a přepnutí rozsahu — ta zůstává
  // kontextová na aktuálním modulu, dlouhý sdružený seznam by se na
  // telefon nevešel. Boční sloupec na desktopu (níž) ukazuje všechno.
  const vNastaveni = segment?.startsWith("nastaveni") ?? false;
  const vybranyModul = vNastaveni ? null : (zde?.modul ?? "provoz");
  const sloupecMobil = vNastaveni ? nastaveni : polozky.filter((p) => p.modul === vybranyModul);

  // Spodní lišta: nejčastější obrazovky, zbytek pod Více. Pátý slot je
  // Více, jen když se do čtyř všechno nevejde.
  const doListy = sloupecMobil.length <= 5 ? sloupecMobil.slice(0, 5) : sloupecMobil.slice(0, DO_LISTY);
  const jeVice = sloupecMobil.length > 5;

  /*
    Boční sloupec na desktopu — UX redesign, druhé kolo (16.9.2026,
    oddíl 4): sloupec je navigace UVNITŘ aktivního modulu, ne trvalý
    seznam celé appky. Dřív (15.9.2026) ukazoval všechny moduly
    najednou seskupené pod sebou — to teď soutěžilo s horní lištou,
    kde modul volí uživatel. Sloupec proto ukazuje jen položky
    vybraného modulu (`vybranyModul`, spočítané výš ze stejné logiky
    jako mobilní spodní lišta) a k tomu vždycky Nastavení, ať se tam
    dá skočit bez ohledu na to, který modul je zrovna aktivní.
  */
  const skupiny: SkupinaNavigace[] = [];

  if (vybranyModul) {
    const polozkyModulu = polozky.filter((p) => p.modul === vybranyModul);
    if (polozkyModulu.length > 0) {
      skupiny.push({
        klic: vybranyModul,
        nazev: moduly.find((m) => m.klic === vybranyModul)?.nazev ?? nazvyModulu[vybranyModul] ?? vybranyModul,
        hotove: polozkyModulu.filter((p) => p.hotovo),
        chystane: polozkyModulu.filter((p) => !p.hotovo),
      });
    }
  }

  if (nastaveni.length > 0) {
    skupiny.push({
      klic: "nastaveni",
      nazev: "Nastavení",
      hotove: nastaveni.filter((p) => p.hotovo),
      chystane: nastaveni.filter((p) => !p.hotovo),
    });
  }

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
        posledniUpozorneni={posledniUpozorneni}
        cilNastaveni={cilNastaveni}
        nazevFirmy={nazevFirmy}
        iniciraly={iniciraly}
      />

      <div className="ft-body">
        <ModuleSidebar
          rozsah={rozsah}
          druh={druh}
          nazevRozsahu={nazevRozsahu}
          nazevFirmy={nazevFirmy}
          skupiny={skupiny}
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
