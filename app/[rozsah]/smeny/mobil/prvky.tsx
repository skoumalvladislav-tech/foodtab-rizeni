import Ikona from "@/app/[rozsah]/ikona";
import { barvaNeboNic } from "@/lib/barvy-lidi";
import {
  ZKRATKY_DNU,
  cisloDne,
  dnyTydne,
  hodinaKratce,
  inicialy,
  jeVikend,
  popisDne,
  rozsahCasu,
  type Osoba,
  type SmenaZaklad,
} from "@/lib/rozpis-mobil";

/**
 * Stavební kameny mobilních Směn — jen kreslí, nic nenačítají.
 *
 * Předloha: docs/vzhled-smeny-mobil-mockup-2026-09-19.webp (pravidla k ní
 * jsou v docs/vzhled-zadani.md, oddíl 12).
 * Styly jsou třídy `ds-sm-*` v app/_komponenty.css.
 */

/* --- avatar ---------------------------------------------------------- */

/**
 * Iniciály v kolečku. Barva člověka je jen tenký obrys — jméno stojí
 * vedle a nese význam samo. Bez člověka (neobsazená směna) je to
 * čárkované kolečko s otazníkem.
 */
export function AvatarM({
  osoba,
  velikost = "m",
}: {
  osoba: Osoba | null;
  velikost?: "m" | "v";
}) {
  const klic = osoba ? barvaNeboNic(osoba.barva) : null;
  return (
    <span
      className="ds-sm-avatar"
      data-velikost={velikost}
      data-osoba={klic ?? undefined}
      data-prazdny={osoba ? undefined : "true"}
      aria-hidden="true"
    >
      {osoba ? inicialy(osoba.jmeno) : "?"}
    </span>
  );
}

/* --- čas směny ------------------------------------------------------- */

type ZaklCasu = Pick<SmenaZaklad, "starts_at" | "ends_at" | "published_at">;

/**
 * Čas směny jako měkká pilulka. Rozpracovaná (dosud nevydaná) směna má
 * čárkovaný obrys a přípisek pro odečítač — barva ani čára tu nejsou
 * jediný nositel významu.
 */
export function PilulkaSmeny({ smena }: { smena: ZaklCasu }) {
  const koncept = !smena.published_at;
  return (
    <span className="ds-sm-pilulka" data-koncept={koncept ? "true" : undefined}>
      {rozsahCasu(smena.starts_at, smena.ends_at)}
      {koncept ? <span className="ft-jen-pro-odecitac"> (rozpracováno)</span> : null}
    </span>
  );
}

export function PilulkaVolno() {
  return (
    <span className="ds-sm-pilulka" data-druh="volno">
      Volno
    </span>
  );
}

/** „8–16“ s možným zlomem za pomlčkou — do úzkých týdenních dlaždic. */
export function CasKratce({ od, doKdy }: { od: string; doKdy: string }) {
  return (
    <>
      {hodinaKratce(od)}–<wbr />
      {hodinaKratce(doKdy)}
    </>
  );
}

/* --- přepínače ------------------------------------------------------- */

/**
 * Skutečný segmented control. `.ft-seg` z globals.css se tu použít nedá:
 * na šířce do 960 px se schovává (je to přepínač pobočky v liště).
 */
export function Prepinac<T extends string>({
  volby,
  hodnota,
  popis,
  onZmena,
  varianta = "segment",
}: {
  volby: readonly (readonly [T, string])[];
  hodnota: T;
  popis: string;
  onZmena: (v: T) => void;
  varianta?: "segment" | "zalozky";
}) {
  return (
    <div className={varianta === "zalozky" ? "ds-sm-zalozky" : "ds-sm-seg"} role="group" aria-label={popis}>
      {volby.map(([klic, nazev]) => (
        <button key={klic} type="button" aria-pressed={hodnota === klic} onClick={() => onZmena(klic)}>
          {nazev}
        </button>
      ))}
    </div>
  );
}

/* --- pruh dnů -------------------------------------------------------- */

/**
 * Týden jako sedm dnů s šipkami. Klepnutí na den ho vybere; šipky
 * posouvají o celý týden. Tečka pod číslem = ten den je neobsazená
 * směna (skutečná data, ne odhad).
 */
export function PruhDnu({
  den,
  dnes,
  poplach,
  onVyber,
  onTyden,
}: {
  den: string;
  dnes: string;
  /** Dny, ve kterých je aspoň jedna neobsazená směna. */
  poplach: ReadonlySet<string>;
  onVyber: (d: string) => void;
  onTyden: (smer: -1 | 1) => void;
}) {
  return (
    <div className="ds-sm-pruh" role="group" aria-label="Dny týdne">
      <button type="button" className="ds-sm-sipka" onClick={() => onTyden(-1)} aria-label="Předchozí týden">
        <Ikona klic="sipkaVlevo" />
      </button>

      <div className="ds-sm-dny">
        {dnyTydne(den).map((d, i) => {
          const popisek =
            popisDne(d) + (d === dnes ? ", dnes" : "") + (poplach.has(d) ? ", je tu neobsazená směna" : "");
          return (
            <button
              key={d}
              type="button"
              className="ds-sm-den"
              data-vybrany={d === den ? "true" : undefined}
              data-dnes={d === dnes ? "true" : undefined}
              data-vikend={jeVikend(d) ? "true" : undefined}
              aria-pressed={d === den}
              aria-label={popisek}
              onClick={() => onVyber(d)}
            >
              <span className="ds-sm-den-zkratka">{ZKRATKY_DNU[i]}</span>
              <span className="ds-sm-den-cislo">{cisloDne(d)}</span>
              {poplach.has(d) ? <span className="ds-sm-den-tecka" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <button type="button" className="ds-sm-sipka" onClick={() => onTyden(1)} aria-label="Další týden">
        <Ikona klic="sipkaVpravo" />
      </button>
    </div>
  );
}

/* --- ostatní --------------------------------------------------------- */

export function PrazdnyStav({ text, druhy }: { text: string; druhy?: string }) {
  return (
    <div className="ds-sm-prazdno" role="status">
      <span className="ds-sm-prazdno-ikona" aria-hidden="true">
        <Ikona klic="kalendar" velikost={22} />
      </span>
      <p>{text}</p>
      {druhy ? <p className="ds-sm-prazdno-druhy">{druhy}</p> : null}
    </div>
  );
}

/** Tlačítko „Filtry“ s počtem aktivních. `kompaktni` = jen ikona (do řádku týdne). */
export function TlacitkoFiltru({
  pocet,
  onKlik,
  kompaktni = false,
}: {
  pocet: number;
  onKlik: () => void;
  kompaktni?: boolean;
}) {
  return (
    <button
      type="button"
      className="ds-sm-mala-akce"
      data-kompaktni={kompaktni ? "true" : undefined}
      data-aktivni={pocet > 0 ? "true" : undefined}
      onClick={onKlik}
      aria-label={pocet > 0 ? `Filtry, aktivních ${pocet}` : "Filtry"}
    >
      <Ikona klic="filtr" velikost={16} />
      {kompaktni ? null : "Filtry"}
      {pocet > 0 ? <span className="ds-sm-odznak">{pocet}</span> : null}
    </button>
  );
}

/** Aktivní filtr jako malý čip s křížkem. */
export function CipFiltru({ text, onZrusit }: { text: string; onZrusit: () => void }) {
  return (
    <button type="button" className="ds-sm-filtr-cip" onClick={onZrusit} aria-label={`Zrušit filtr ${text}`}>
      {text}
      <Ikona klic="zavrit" velikost={13} />
    </button>
  );
}
