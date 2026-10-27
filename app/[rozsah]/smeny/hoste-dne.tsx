"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import { ZnackaPobocky } from "@/app/[rozsah]/rezervace/znacka-pobocky";
import { celkemDne, souhrnText, type HosteDnu } from "@/lib/rezervace-pobocky";
import { pocet } from "@/lib/sklonovani";

/**
 * Hosté z rezervací u dne v Rozpisu směn (Šéfík 27. 10. 2026: „když najedu
 * myší na konkrétní den, aby se ukazoval počet hostů na jednotlivých
 * pobočkách — podle toho budu vědět, kolik dát zaměstnanců“).
 *
 * Data a právo (kdo rezervace smí vidět) řeší server:
 * app/[rozsah]/rezervace/hoste.ts. `hoste === null` = nekreslí se nic.
 *
 * ---------------------------------------------------------------------
 * POČÍTAČ — OKÉNKO U ZÁHLAVÍ DNE (`DenSHosty`)
 *
 * Otevře se najetím myší na záhlaví dne, zaměřením klávesnicí (Tab na
 * „N hostů“) a klepnutím — na dotykové obrazovce myš není. Klik/klepnutí
 * ho připíchne, takže zůstane i po odjetí myší; druhé klepnutí nebo klik
 * jinam ho zavře, Esc taky (WCAG 1.4.13: dá se zavřít, dá se na něj najet,
 * nezmizí samo). Najetí se bere jen od myši: emulovaný „hover“ po
 * klepnutí by okénko otevřel a hned zase zavřel.
 *
 * TELEFON — ŘÁDEK POD HLAVIČKOU DNE (`HosteDneRadek`)
 *
 * Na telefonu by plovoucí okénko zakrylo rozpis. Denní přehled proto
 * ukazuje hosty vybraného dne přímo v toku stránky; „po klepnutí“ je
 * klepnutí na den v pruhu dnů.
 */

/** Obsah okénka i řádku: pobočky se zkratkou a barvou, celkem, odkaz na den v Rezervacích. */
export function SeznamHostu({ hoste, den, rozsah }: { hoste: HosteDnu; den: string; rozsah: string }) {
  if (hoste.chyba) {
    return (
      <p className="ds-hoste-chyba" role="status">
        Rezervace se nepodařilo načíst — počty hostů teď nejsou k dispozici.
      </p>
    );
  }
  const vic = hoste.pobocky.length > 1;
  return (
    <>
      <ul className="ds-hoste-seznam">
        {hoste.pobocky.map((p) => {
          const s = hoste.dny[den]?.[p.id];
          return (
            <li key={p.id} className="ds-hoste-radek" data-branch={p.barva} data-pobocka={p.id}>
              <ZnackaPobocky pobocka={p} vedleNazvu />
              <span className="ds-hoste-nazev">{p.nazev}</span>
              <span className="ds-hoste-cisla">{s && s.rezervaci + s.akci > 0 ? souhrnText(s) : "Bez rezervací"}</span>
            </li>
          );
        })}
      </ul>
      {vic ? <p className="ds-hoste-celkem">Celkem: {souhrnText(celkemDne(hoste, den))}</p> : null}
      <p className="ds-hoste-pata">
        Bez zrušených a nedorazivších. <Link href={`/${rozsah}/rezervace/den/${den}`}>Rezervace dne →</Link>
      </p>
    </>
  );
}

/**
 * Záhlaví dne s okénkem hostů. Bez `hoste` je to obyčejný `div` se stejnými
 * atributy — mřížka pro toho, kdo rezervace nevidí, vypadá jako dřív.
 */
export function DenSHosty({
  den,
  popisDne,
  hoste,
  rozsah,
  vpravo = false,
  children,
  ...atributy
}: {
  den: string;
  /** „út 27. 10.“ — do popisu pro odečítač. */
  popisDne: string;
  hoste: HosteDnu | null;
  rozsah: string;
  /** Okénko zarovnat k pravému okraji (poslední sloupce, ať nevyjede z mřížky). */
  vpravo?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const id = useId();
  const obal = useRef<HTMLDivElement>(null);
  const spoustec = useRef<HTMLButtonElement>(null);
  const [najeto, setNajeto] = useState(false);
  const [zamereno, setZamereno] = useState(false);
  const [pripnuto, setPripnuto] = useState(false);
  const [skryto, setSkryto] = useState(false);
  const otevreno = (najeto || zamereno || pripnuto) && !skryto;

  // Připíchnuté okénko zavře klepnutí kamkoli jinam.
  useEffect(() => {
    if (!pripnuto) return;
    const mimo = (e: PointerEvent) => {
      if (!obal.current?.contains(e.target as Node)) setPripnuto(false);
    };
    document.addEventListener("pointerdown", mimo);
    return () => document.removeEventListener("pointerdown", mimo);
  }, [pripnuto]);

  if (!hoste) return <div {...atributy}>{children}</div>;

  const celkem = celkemDne(hoste, den);
  return (
    <div
      {...atributy}
      ref={obal}
      data-hoste={den}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setNajeto(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        setNajeto(false);
        setSkryto(false);
      }}
      onFocus={(e) => {
        // Jen klávesnice. Zaměření klepnutím řeší onClick, jinak by se okénko otevřelo a hned zavřelo.
        if (e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setZamereno(true);
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setZamereno(false);
        setSkryto(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !otevreno) return;
        e.stopPropagation();
        setSkryto(true);
        setPripnuto(false);
        spoustec.current?.focus();
      }}
    >
      {children}
      <button
        ref={spoustec}
        type="button"
        className="ds-hoste-spoustec"
        aria-expanded={otevreno}
        aria-controls={otevreno ? id : undefined}
        aria-label={`Hosté z rezervací, ${popisDne}: ${hoste.chyba ? "nepodařilo se načíst" : souhrnText(celkem)}`}
        onClick={() => {
          if (otevreno && pripnuto) {
            setPripnuto(false);
            setSkryto(true);
          } else {
            setPripnuto(true);
            setSkryto(false);
          }
        }}
      >
        <Ikona klic="rezervace" velikost={12} />
        {hoste.chyba ? "hosté ?" : pocet(celkem.hostu, "host", "hosté", "hostů")}
      </button>
      {otevreno ? (
        <div id={id} className="ds-hoste-okno" data-vpravo={vpravo ? "" : undefined} role="group" aria-label={`Hosté z rezervací, ${popisDne}`}>
          <p className="ds-hoste-titul">
            <Ikona klic="rezervace" velikost={14} />
            Hosté z rezervací · {popisDne}
          </p>
          <SeznamHostu hoste={hoste} den={den} rozsah={rozsah} />
        </div>
      ) : null}
    </div>
  );
}

/** Telefon: hosté vybraného dne v toku stránky, nic nepřekrývá. */
export function HosteDneRadek({ den, hoste, rozsah }: { den: string; hoste: HosteDnu | null; rozsah: string }) {
  if (!hoste) return null;
  return (
    <section className="ds-hoste-mobil" aria-label="Hosté z rezervací" data-hoste={den}>
      <p className="ds-hoste-titul">
        <Ikona klic="rezervace" velikost={14} />
        Hosté z rezervací
      </p>
      <SeznamHostu hoste={hoste} den={den} rozsah={rozsah} />
    </section>
  );
}
