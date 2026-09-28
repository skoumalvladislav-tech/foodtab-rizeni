"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import Nadpis from "@/app/[rozsah]/nadpis";
import MetricCard from "@/components/ui/MetricCard";
import StatusIndicator from "@/components/ui/StatusIndicator";
import { hodinyKratce, inicialy } from "@/lib/rozpis-mobil";
import { pocet } from "@/lib/sklonovani";

import AutoObnova from "./auto-obnova";
import Detail from "./detail";
import type { PrehledProps, RadekPrehledu } from "./nacti";

/**
 * Živý přehled docházky pro vedoucího — výchozí obrazovka Docházky
 * tomu, kdo smí číst docházku ostatních.
 *
 *   4 karty     v práci · čekáme · po začátku směny · na místě dnes
 *   4 seznamy   právě v práci · ještě nepřišli · odešli · nesrovnalosti
 *   panel       klik na člověka: dnešní plán, příchod, odchod, záznamy, měsíc
 *
 * Všechno jsou skutečná data (`nacti.ts` → `lib/dochazka-dnes`). Co se
 * z nich spočítat nedá, se neukazuje: žádné „zpoždění“ (firma nemá
 * pravidlo tolerance), žádné mzdy (ty jen s právem `payroll.read`, v
 * panelu), a nula lidí je nula, ne vymyšlený obsah.
 *
 * Rozepsaná píchačka pro vlastní příchod zůstává na stránce níž — vedoucí
 * není primárně píchající, ale přehlížející.
 */

const STAV_SLOVY: Record<RadekPrehledu["stav"], string> = {
  v_praci: "V práci",
  odesel: "Odešel(a)",
  nadchazi: "Ještě nepřišel(a)",
  po_zacatku: "Ještě nepřišel(a)",
  nepresel: "Nepřišel(a)",
};

export default function PrehledDochazky({
  data,
  denPopis,
  den,
  rozsah,
  kiosek,
  vybranaZUrl,
  zalozky,
  podZalozkami = null,
  sprava = null,
}: {
  data: PrehledProps;
  /** „pondělí 21. 9.“ */
  denPopis: string;
  /** Provozní den RRRR-MM-DD (odkaz do rozpisu). */
  den: string;
  rozsah: string;
  kiosek: { aktivni: boolean; odkaz: string | null };
  /** `?osoba=` z adresy — panel se otevře rovnou (odkaz z rozpisu). */
  vybranaZUrl: string | null;
  /**
   * Lišta záložek Docházka · Výdělky · Zálohy. Hotová ze serveru
   * (práva spočítala stránka), tady se jen postaví pod nadpis.
   */
  zalozky?: ReactNode;
  /**
   * Co má být nad kartami přehledu — vlastní zálohy k potvrzení
   * (25. 9. 2026). Hotové ze serveru; bez toho by je vedoucí našel až
   * pod celým přehledem.
   */
  podZalozkami?: ReactNode;
  /**
   * Kdo smí v panelu stornovat příchod píchnutý omylem (27. 9. 2026) a
   * výsledek storna. Jen kreslení — rozhoduje stornovat_usek_dochazky.
   */
  sprava?: {
    /** Pobočky, na kterých volající docházku spravuje. */
    spravovane: string[];
    jeMajitel: boolean;
    /** Vlastní zaměstnanecký záznam — vlastní příchod stornuje jen majitel. */
    vlastniId: string | null;
    hlaskaStorna: { druh: "ok" } | { druh: "chyba"; text: string } | null;
  } | null;
}) {
  const [vybrana, setVybrana] = useState<string | null>(vybranaZUrl);
  // Stálá funkce: Drawer má efekt závislý na onZavrit (fokus).
  const zavritDetail = useCallback(() => setVybrana(null), []);
  const { souhrn, radky } = data;

  const vPraci = radky.filter((r) => r.stav === "v_praci");
  const nepriSli = radky.filter((r) => r.stav === "nadchazi" || r.stav === "po_zacatku");
  const odesli = radky.filter((r) => r.stav === "odesel");
  const nesrovnalosti = radky.filter((r) => r.stav === "nepresel");
  const vybranyRadek = radky.find((r) => r.osobaId === vybrana) ?? null;
  /*
    Výsledek storna z bočního panelu patří do panelu toho člověka
    (?osoba= ho po návratu znovu otevře) — nahoře nad kartami by ho panel
    zakryl: na telefonu celý, na počítači ztmavení. Nahoře jen tehdy, když
    panel toho člověka otevřený není (třeba po stornu z přehledu zmizel).
  */
  const hlaskaVPanelu = Boolean(sprava?.hlaskaStorna && vybranyRadek && vybranyRadek.osobaId === vybranaZUrl);

  return (
    <div className="ds-dh">
      <AutoObnova />

      <Nadpis
        popis={
          <>
            Dnes · {denPopis}
            <span className="ds-dh-aktualizace"> · aktualizováno v {data.aktualizovano}, obnovuje se každou minutu</span>
          </>
        }
        vpravo={
          <div className="ds-dh-kiosek">
            <StatusIndicator stav={kiosek.aktivni ? "aktivni" : "cekajici"}>
              {kiosek.aktivni ? "Kiosk aktivní" : "Kiosk není zaregistrovaný"}
            </StatusIndicator>
            {kiosek.odkaz ? (
              <Link href={kiosek.odkaz} className="ft-tl ft-tl-male ft-tl-vedlejsi">
                {kiosek.aktivni ? "Zařízení" : "Zaregistrovat tablet"}
              </Link>
            ) : null}
          </div>
        }
      >
        Docházka
      </Nadpis>

      {zalozky}

      {sprava?.hlaskaStorna && !hlaskaVPanelu ? (
        sprava.hlaskaStorna.druh === "ok" ? (
          <p className="ds-uc-hlaska" data-ton="dobre" role="status">
            Příchod stornovaný. Nesmazal se — zůstal přeškrtnutý v docházce člověka a smí se píchnout znovu.
          </p>
        ) : (
          <p className="hlaska-chyba ds-uc-hlaska" role="alert">
            {sprava.hlaskaStorna.text}
          </p>
        )
      ) : null}

      {podZalozkami}

      <div className="ds-dh-karty">
        <MetricCard
          label="V práci"
          hodnota={souhrn.vPraci}
          sublabel={souhrn.vPraci === 0 ? "právě nikdo" : "mají otevřený příchod"}
          tone={souhrn.vPraci > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Čekáme"
          hodnota={souhrn.cekame}
          sublabel="mají dnes směnu, ta ještě nezačala"
        />
        <MetricCard
          label="Po začátku směny"
          hodnota={souhrn.poZacatku}
          sublabel="příchod zatím chybí"
          tone={souhrn.poZacatku > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Na místě dnes"
          hodnota={souhrn.minutNaMiste > 0 ? hodinyKratce(souhrn.minutNaMiste) : "0 h"}
          sublabel="od příchodu do odchodu, bez odečtu přestávek"
        />
      </div>

      {radky.length === 0 ? (
        <div className="ds-dh-prazdno" role="status">
          <p>Dnes na téhle pobočce nikdo nemá směnu ani docházku.</p>
        </div>
      ) : (
        <div className="ds-dh-seznamy">
          <Sekce nazev="Právě v práci" pocetLidi={vPraci.length} prazdno="Právě nikdo.">
            {vPraci.length > 0 ? (
              <Tabulka
                sloupce={["Zaměstnanec", "Úsek", "Plán", "Příchod", "Na místě", "Stav"]}
                radky={vPraci}
                vybrana={vybrana}
                onVybrat={setVybrana}
                bunky={(r) => [
                  r.usek ?? "—",
                  r.plan ?? "mimo rozpis",
                  r.prichod ?? "—",
                  r.minut > 0 ? hodinyKratce(r.minut) : "—",
                  <Stav key="s" r={r} />,
                ]}
              />
            ) : null}
          </Sekce>

          <Sekce nazev="Ještě nepřišli" pocetLidi={nepriSli.length} prazdno="Všichni, kdo mají dnes směnu, už přišli.">
            {nepriSli.length > 0 ? (
              <Tabulka
                sloupce={["Zaměstnanec", "Úsek", "Plán", "Stav"]}
                radky={nepriSli}
                vybrana={vybrana}
                onVybrat={setVybrana}
                bunky={(r) => [r.usek ?? "—", r.plan ?? "—", <Stav key="s" r={r} />]}
              />
            ) : null}
          </Sekce>

          <Sekce nazev="Odešli" pocetLidi={odesli.length} prazdno="Zatím nikdo neodešel.">
            {odesli.length > 0 ? (
              <Tabulka
                sloupce={["Zaměstnanec", "Úsek", "Plán", "Příchod", "Odchod", "Na místě"]}
                radky={odesli}
                vybrana={vybrana}
                onVybrat={setVybrana}
                bunky={(r) => [
                  r.usek ?? "—",
                  r.plan ?? "mimo rozpis",
                  r.prichod ?? "—",
                  r.odchod ?? "—",
                  r.minut > 0 ? hodinyKratce(r.minut) : "—",
                ]}
              />
            ) : null}
          </Sekce>

          {nesrovnalosti.length > 0 ? (
            <Sekce nazev="Nesrovnalosti" pocetLidi={nesrovnalosti.length} prazdno="" varovani>
              <Tabulka
                sloupce={["Zaměstnanec", "Úsek", "Plán", "Co se stalo"]}
                radky={nesrovnalosti}
                vybrana={vybrana}
                onVybrat={setVybrana}
                bunky={(r) => [r.usek ?? "—", r.plan ?? "—", <Stav key="s" r={r} />]}
              />
            </Sekce>
          ) : null}
        </div>
      )}

      {vybranyRadek ? (
        <Detail
          key={vybranyRadek.osobaId}
          radek={vybranyRadek}
          rozsah={rozsah}
          den={den}
          smiStornovat={Boolean(
            sprava &&
              vybranyRadek.otevrenyPrichodId &&
              vybranyRadek.otevrenyPrichodPobocka &&
              sprava.spravovane.includes(vybranyRadek.otevrenyPrichodPobocka) &&
              (vybranyRadek.osobaId !== sprava.vlastniId || sprava.jeMajitel),
          )}
          hlaskaStorna={hlaskaVPanelu ? (sprava?.hlaskaStorna ?? null) : null}
          onZavrit={zavritDetail}
        />
      ) : null}
    </div>
  );
}

/* --- kousky ------------------------------------------------------------ */

function Sekce({
  nazev,
  pocetLidi,
  prazdno,
  varovani = false,
  children,
}: {
  nazev: string;
  pocetLidi: number;
  prazdno: string;
  varovani?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ds-dh-sekce" data-varovani={varovani ? "" : undefined}>
      <h2>
        {nazev}
        <span className="ds-dh-pocet">{pocet(pocetLidi, "člověk", "lidé", "lidí")}</span>
      </h2>
      {pocetLidi === 0 ? <p className="ds-dh-nikdo">{prazdno}</p> : children}
    </section>
  );
}

function Tabulka({
  sloupce,
  radky,
  bunky,
  vybrana,
  onVybrat,
}: {
  sloupce: string[];
  radky: RadekPrehledu[];
  bunky: (r: RadekPrehledu) => ReactNode[];
  vybrana: string | null;
  onVybrat: (id: string) => void;
}) {
  return (
    <table className="ds-dh-tabulka">
      <thead>
        <tr>
          {sloupce.map((s) => (
            <th key={s} scope="col">
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {radky.map((r) => (
          <tr key={r.osobaId} data-vybrana={vybrana === r.osobaId ? "" : undefined}>
            <th scope="row">
              <button type="button" className="ds-dh-osoba" onClick={() => onVybrat(r.osobaId)} aria-label={`Otevřít detail: ${r.jmeno}`}>
                <span className="ds-smd-avatar" aria-hidden="true">
                  {inicialy(r.jmeno)}
                </span>
                <span className="ds-dh-osoba-text">
                  <span className="ds-dh-jmeno" title={r.jmeno}>
                    {r.jmeno}
                  </span>
                  {r.pozice ? <span className="ds-dh-role">{r.pozice}</span> : null}
                </span>
              </button>
            </th>
            {bunky(r).map((b, i) => (
              <td key={i}>{b}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Stav řádku — jen to, co se ví. Barva nikdy nestojí sama: vždy slovo. */
function Stav({ r }: { r: RadekPrehledu }) {
  if (r.stav === "v_praci") {
    return (
      <span className="ds-dh-stav" data-stav="v_praci">
        <span className="ds-dh-tecka" aria-hidden="true" />
        {r.naPrestavce ? "Přestávka" : STAV_SLOVY.v_praci}
        {r.bezSmeny ? <span className="ds-dh-znacka">mimo rozpis</span> : null}
        {r.otevrenyZeDne ? <span className="ds-dh-znacka">od dřívějška</span> : null}
        {r.pobockaPrichodu ? <span className="ds-dh-znacka">{r.pobockaPrichodu}</span> : null}
      </span>
    );
  }
  if (r.stav === "nadchazi") {
    return (
      <span className="ds-dh-stav" data-stav="nadchazi">
        {r.zacatekPlanu ? `Začíná v ${r.zacatekPlanu}` : STAV_SLOVY.nadchazi}
      </span>
    );
  }
  if (r.stav === "po_zacatku") {
    return (
      <span className="ds-dh-stav" data-stav="po_zacatku">
        <Ikona klic="varovani" velikost={13} />
        Směna začala v {r.zacatekPlanu}, příchod chybí
      </span>
    );
  }
  if (r.stav === "nepresel") {
    return (
      <span className="ds-dh-stav" data-stav="nepresel">
        <Ikona klic="varovani" velikost={13} />
        Směna skončila v {r.konecPlanu}, příchod nebyl zapsán
      </span>
    );
  }
  return (
    <span className="ds-dh-stav" data-stav="odesel">
      {STAV_SLOVY.odesel}
      {r.bezSmeny ? <span className="ds-dh-znacka">mimo rozpis</span> : null}
    </span>
  );
}
