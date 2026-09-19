import type { StavSmeny } from "@/lib/rozpis-desktop";
import { inicialy } from "@/lib/rozpis-mobil";

/**
 * Hlavička panelu „Upravit směnu“: kdo, na jaké pozici a v jakém stavu
 * vůči vydanému rozpisu. Nic tu není k úpravě — je to přehled; člověk
 * se mění v poli Zaměstnanec níž.
 *
 * Stav se čte z dat směny (viz `lib/rozpis-desktop`), nevymýšlí se. O tom,
 * kdy komu přijde upozornění, se tu záměrně nic neslibuje.
 */

export type KontextSmeny = {
  jmeno: string | null;
  /** Pozice člověka (štítek), nebo `null`. */
  role: string | null;
  usek: string | null;
  stav: StavSmeny;
  /** „Původně 08:00–16:00“ u po vydání změněné směny; jinak `null`. */
  puvodne: string | null;
};

const POPISY: Record<StavSmeny, { nazev: string; vysvetleni: string }> = {
  vydana: {
    nazev: "Vydaná",
    vysvetleni: "Tuhle směnu lidé znají z vydaného rozpisu.",
  },
  koncept: {
    nazev: "Nevydaná",
    vysvetleni: "Směna čeká na vydání rozpisu.",
  },
  zmenena: {
    nazev: "Změněná po vydání",
    vysvetleni: "Od vydání se změnila. Čeká na další vydání rozpisu.",
  },
};

export default function HlavickaSmeny({ kontext }: { kontext: KontextSmeny }) {
  const popis = POPISY[kontext.stav];
  const podtitul = [kontext.role, kontext.usek].filter(Boolean).join(" · ");

  return (
    <div className="ds-smd-hlavicka-smeny">
      <div className="ds-smd-hlavicka-osoba">
        <span className="ds-smd-avatar ds-smd-avatar-velky" aria-hidden="true">
          {kontext.jmeno ? inicialy(kontext.jmeno) : "?"}
        </span>
        <span className="ds-smd-osoba-text">
          <span className="ds-smd-hlavicka-jmeno">{kontext.jmeno ?? "Neobsazená směna"}</span>
          {podtitul ? <span className="ds-smd-role">{podtitul}</span> : null}
        </span>
      </div>

      <p className="ds-smd-stav-smeny" data-stav={kontext.stav}>
        <span className="ds-smd-stav-znacka" aria-hidden="true" />
        <span>
          <strong>{popis.nazev}</strong>
          <span className="ds-smd-stav-vysvetleni">
            {popis.vysvetleni}
            {kontext.puvodne ? ` ${kontext.puvodne}.` : ""}
          </span>
        </span>
      </p>
    </div>
  );
}
