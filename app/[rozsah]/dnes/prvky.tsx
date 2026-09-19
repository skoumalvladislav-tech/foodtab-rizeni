import Link from "next/link";
import type { ReactNode } from "react";

import Ikona from "../ikona";
import type { IkonaKlic } from "../nabidka";

/**
 * Kreslicí kousky obrazovky Dnes — podle mockupu Šéfíka z 19.9.2026
 * (docs/vzhled-dnes-mockup-2026-09-19.webp).
 *
 * ČISTĚ KRESLICÍ. Žádný dotaz, žádné právo, žádný stav: co se smí
 * ukázat, rozhodla stránka (page.tsx) a poslala to sem jako data. Díky
 * tomu se dají vykreslit i mimo aplikaci s ukázkovými daty a je vidět,
 * jak vypadají, aniž by se člověk musel přihlásit.
 *
 * Vzhled je v app/_komponenty.css (třídy `ds-*`) — tady zůstává jen
 * skladba. Barvy se nikdy nezapisují natvrdo, jen přes tokeny.
 */

/* ---------- HERO ---------------------------------------------------- */

export function Hero({
  datum,
  pozdrav,
  oslovene,
  popis,
  fotoUrl,
}: {
  /** „Neděle 14. září 2026“ */
  datum: string;
  /** „Dobré odpoledne“ */
  pozdrav: string;
  /** Křestní jméno v 5. pádu; prázdné = jen pozdrav. */
  oslovene: string | null;
  popis: string;
  /** Podepsaný odkaz na fotku pobočky, nebo `null` (jen barva pobočky). */
  fotoUrl: string | null;
}) {
  return (
    <section className="ds-hero">
      {fotoUrl ? (
        // Podepsaný odkaz z privátního kbelíku — next/image by ho zbytečně
        // přepisoval přes vlastní optimalizátor a rozbil by platnost odkazu.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ds-hero-foto" src={fotoUrl} alt="" aria-hidden="true" />
      ) : null}
      <div className="ds-hero-text">
        <p className="ds-hero-datum">{datum}</p>
        <h1 className="ds-hero-nadpis">
          <span>{oslovene ? `${pozdrav},` : pozdrav}</span>
          {oslovene ? <strong>{oslovene}</strong> : null}
        </h1>
        <p className="ds-hero-popis">{popis}</p>
      </div>
    </section>
  );
}

/* ---------- HLAVIČKA PANELU ---------------------------------------- */

export function PanelHlava({
  ikona,
  nadpis,
  odkaz,
}: {
  ikona: IkonaKlic;
  nadpis: string;
  odkaz?: { popisek: string; href: string };
}) {
  return (
    <div className="ds-plocha-hlava">
      <Ikona klic={ikona} />
      <h2>{nadpis}</h2>
      {odkaz ? (
        <Link href={odkaz.href} className="ds-plocha-odkaz">
          {odkaz.popisek} →
        </Link>
      ) : null}
    </div>
  );
}

/* ---------- PŘEHLEDOVÁ KARTA -------------------------------------- */

export type KpiTon = "dobre" | "info" | "pozor" | "bad" | "neutral";

export function KpiKarta({
  ikona,
  ton,
  odznak,
  titulek,
  hodnota,
  popisy,
  popisTon,
  paticka,
  children,
}: {
  ikona: IkonaKlic;
  ton: KpiTon;
  /** Počet do červeného kolečka na ikoně (nepřečtené). 0/undefined = žádné. */
  odznak?: number;
  titulek: string;
  hodnota: string;
  popisy?: (string | null | undefined)[];
  popisTon?: "bad";
  /** Tlačítko dole. */
  paticka: ReactNode;
  /** Vlastní obsah mezi hodnotou a patičkou (hlášky z píchnutí). */
  children?: ReactNode;
}) {
  const radky = (popisy ?? []).filter((p): p is string => !!p);
  return (
    <article className="ds-kpi">
      <div className="ds-kpi-hlava">
        <span className="ds-kpi-ikona" data-tone={ton === "neutral" ? undefined : ton} aria-hidden="true">
          <Ikona klic={ikona} />
          {odznak && odznak > 0 ? <span className="ds-kpi-odznak">{odznak > 9 ? "9+" : odznak}</span> : null}
        </span>
        <h2 className="ds-kpi-titulek">{titulek}</h2>
      </div>
      <p className="ds-kpi-hodnota ds-cislo">{hodnota}</p>
      {radky.map((r, i) => (
        <p key={i} className="ds-kpi-popis" data-tone={popisTon}>
          {r}
        </p>
      ))}
      {children}
      <div className="ds-kpi-paticka">{paticka}</div>
    </article>
  );
}

/** Vedlejší tlačítko karty — celá šířka, stejný vzhled ve všech kartách. */
export function KpiOdkaz({ href, popisek }: { href: string; popisek: string }) {
  return (
    <Link href={href} className="ft-tl ft-tl-vedlejsi ds-kpi-tlacitko">
      {popisek}
    </Link>
  );
}

/* ---------- ROZPIS SMĚN ------------------------------------------- */

export type DenRozpisu = {
  datum: string;
  /** „Po 14. 9.“ */
  zkratka: string;
  pocet: number;
  vikend: boolean;
  vybrany: boolean;
  href: string;
};

export type RadekSmeny = {
  id: string;
  jmeno: string;
  inicialy: string;
  /** Klíč barvy člověka (`--osoba`), nebo `null` = bez barvy. */
  barva: string | null;
  pozice: string | null;
  /** Jen na firemní úrovni, kde se pobočky míchají. */
  pobocka: string | null;
  od: string;
  do: string;
};

export function PanelRozpisu({
  nadpis,
  rozsah,
  dny,
  radky,
  zbyva,
  prazdno,
}: {
  nadpis: string;
  rozsah: string;
  dny: DenRozpisu[];
  radky: RadekSmeny[];
  /** Kolik směn se do seznamu nevešlo. */
  zbyva: number;
  prazdno: string;
}) {
  return (
    <section className="ds-plocha" aria-label={nadpis}>
      <PanelHlava ikona="kalendar" nadpis={nadpis} odkaz={{ popisek: "Zobrazit celý kalendář", href: `/${rozsah}/smeny` }} />

      <nav className="ds-dny" aria-label="Den rozpisu">
        {dny.map((d) => (
          <Link
            key={d.datum}
            href={d.href}
            className="ds-den"
            data-vikend={d.vikend ? "true" : undefined}
            aria-current={d.vybrany ? "true" : undefined}
            scroll={false}
          >
            {d.zkratka}
            <small>{d.pocet === 0 ? "nikdo" : lidi(d.pocet)}</small>
          </Link>
        ))}
      </nav>

      {radky.length === 0 ? (
        <p style={{ margin: "14px 0 4px", fontSize: "14px", color: "var(--muted)" }}>{prazdno}</p>
      ) : (
        <ul className="ds-smeny">
          {radky.map((r) => (
            <li key={r.id} className="ds-smena" data-osoba={r.barva ?? undefined}>
              <div className="ds-smena-osoba">
                <span className="ds-avatar" aria-hidden="true">
                  {r.inicialy}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ds-smena-jmeno" title={r.jmeno}>
                    {r.jmeno}
                  </div>
                  {r.pozice || r.pobocka ? (
                    <div className="ds-smena-pozice">{[r.pozice, r.pobocka].filter(Boolean).join(" · ")}</div>
                  ) : null}
                </div>
              </div>
              <div className="ds-smena-cas">
                {r.od} – {r.do}
              </div>
              <Link
                href={`/${rozsah}/smeny`}
                className="ds-smena-vice"
                aria-label={`Otevřít ${r.jmeno} v rozpisu`}
                title="Otevřít v rozpisu"
              >
                <Ikona klic="tecky" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {zbyva > 0 ? (
        <p style={{ margin: "10px 0 0", fontSize: "13px", color: "var(--muted)" }}>
          + {zbyva} dalších —{" "}
          <Link href={`/${rozsah}/smeny`} style={{ color: "var(--ink)" }}>
            celý rozpis
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** „5 lidí“, „1 člověk“ — bez sklonování celého slovníku, jen tohle jedno slovo. */
function lidi(n: number): string {
  if (n === 1) return "1 člověk";
  return `${n} lidí`;
}

/* ---------- POSLEDNÍ VZKAZY --------------------------------------- */

export type VzkazNahled = {
  id: string;
  konverzaceId: string;
  druh: string;
  /** Název rozhovoru: „Vedení“, „Bernard Bar Tábor“, … */
  nazev: string;
  inicialy: string;
  autor: string;
  text: string;
  kdy: string;
  naleha: boolean;
};

export function PanelVzkazu({ rozsah, vzkazy }: { rozsah: string; vzkazy: VzkazNahled[] }) {
  return (
    <section className="ds-plocha" aria-label="Poslední vzkazy">
      <PanelHlava ikona="zprava" nadpis="Poslední vzkazy" odkaz={{ popisek: "Zobrazit všechny", href: `/${rozsah}/vzkazy` }} />
      {vzkazy.length === 0 ? (
        <p style={{ margin: 0, fontSize: "14px", color: "var(--muted)" }}>Zatím žádné vzkazy.</p>
      ) : (
        <ul className="ds-vzkazy">
          {vzkazy.map((v) => (
            <li key={v.id}>
              <Link href={`/${rozsah}/vzkazy/${v.konverzaceId}`} className="ds-vzkaz">
                <span className="ds-vzkaz-avatar" data-druh={v.druh} aria-hidden="true">
                  {v.inicialy}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="ds-vzkaz-hlava">
                    <span className="ds-vzkaz-jmeno">{v.nazev}</span>
                    {v.naleha ? (
                      <span className="ds-vzkaz-naleha" title="Naléhavé" role="img" aria-label="Naléhavé">
                        <Ikona klic="vykricnik" />
                      </span>
                    ) : null}
                    <span className="ds-vzkaz-kdy">{v.kdy}</span>
                  </span>
                  <span className="ds-vzkaz-text">
                    {v.autor ? <strong style={{ fontWeight: 600, color: "var(--ink)" }}>{v.autor}: </strong> : null}
                    {v.text}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- BOČNÍ PANEL ------------------------------------------- */

export type RychlaAkceProp = { popisek: string; href: string; ikona: IkonaKlic };

export function RychleAkce({ akce }: { akce: RychlaAkceProp[] }) {
  if (akce.length === 0) return null;
  return (
    <section className="ds-plocha" aria-label="Rychlé akce">
      <PanelHlava ikona="blesk" nadpis="Rychlé akce" />
      <ul className="ds-rychla">
        {akce.map((a) => (
          <li key={a.href + a.popisek}>
            <Link href={a.href}>
              <span className="ds-rychla-ikona">
                <Ikona klic={a.ikona} velikost={18} />
              </span>
              {a.popisek}
              <span className="ds-rychla-sipka">
                <Ikona klic="sipkaVpravo" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TymDnes({
  pritomno,
  planovano,
  jmena,
  href,
}: {
  pritomno: number;
  planovano: number;
  jmena: { inicialy: string; jmeno: string }[];
  href: string;
}) {
  const ukazat = jmena.slice(0, 4);
  const dalsi = jmena.length - ukazat.length;
  return (
    <section className="ds-plocha" aria-label="Dnes v restauraci">
      <PanelHlava ikona="lide" nadpis="Dnes v restauraci" />
      <p className="ds-tym-cislo ds-cislo">
        {pritomno} / {planovano}
      </p>
      <p className="ds-tym-popis">zaměstnanců přítomno</p>
      {ukazat.length > 0 ? (
        <div className="ds-tym-avatary">
          {ukazat.map((j, i) => (
            <span key={i} className="ds-avatar-mini" title={j.jmeno}>
              {j.inicialy}
            </span>
          ))}
          {dalsi > 0 ? (
            <span className="ds-avatar-mini" data-vice="true">
              +{dalsi}
            </span>
          ) : null}
        </div>
      ) : null}
      <Link href={href} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>
        Zobrazit docházku →
      </Link>
    </section>
  );
}

export function PocasiKarta({ misto, teplota, stav }: { misto: string | null; teplota: number; stav: string }) {
  return (
    <section className="ds-plocha" aria-label="Počasí">
      <PanelHlava ikona="slunce" nadpis={misto ? `Počasí – ${misto}` : "Počasí"} />
      <p className="ds-pocasi-radek">
        <span className="ds-pocasi-teplota ds-cislo">{teplota} °C</span>
        <span className="ds-pocasi-stav">{stav}</span>
      </p>
    </section>
  );
}

/**
 * Citát — značková ozdoba, ne tvrzení o datech. Podepsaný „Foodtab“, ne
 * jako by šlo o vyjádření konkrétní provozovny nebo zákazníka: to by bylo
 * totéž předstírání, kterému se vyhýbá fotka pobočky.
 */
export function Citat() {
  return (
    <section className="ds-plocha" aria-label="Citát">
      <span className="ds-citat-znak" aria-hidden="true">
        “
      </span>
      <p className="ds-citat-text">Dobrá restaurace stojí na skvělém týmu.</p>
      <div className="ds-citat-linka" />
      <p className="ds-podpis" aria-label="Foodtab">
        Foodtab
      </p>
    </section>
  );
}
