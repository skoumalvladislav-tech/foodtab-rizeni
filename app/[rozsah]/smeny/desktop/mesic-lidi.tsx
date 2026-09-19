"use client";

import Ikona from "@/app/[rozsah]/ikona";
import ZnackaOsoby from "@/app/znacka-osoby";
import { hodinyStruc, sestavitMesicOsoby, type SmenaD } from "@/lib/rozpis-desktop";
import { cisloDne, inicialy, jeVikend } from "@/lib/rozpis-mobil";
import { pocet } from "@/lib/sklonovani";

import type { Otevrene, Planovani, Smena } from "../rozpis";
import { KartaSmeny, novaSmenaProOsobu } from "./mrizka";

/**
 * Celý měsíc vybraných lidí (jednoho nebo dvou).
 *
 * Pro zadávání směn po dnech: kalendář měsíce (týdny od pondělí) na
 * každého člověka zvlášť, dva vedle sebe. Prázdný den má „+ Přidat“
 * (formulář se otevře s člověkem a dnem — stejně jako v týdenní mřížce),
 * směna se upravuje klepnutím na kartu. Vpravo od každého týdne jsou
 * hodiny za týden a v hlavičce součet měsíce, ať je vidět, jak přibývají.
 *
 * Kdo se sem dostane, rozhoduje filtr zaměstnanců v nástrojích; tahle
 * komponenta jen kreslí to, co dostala. Dny okolních měsíců (začátek
 * a konec krajních týdnů) se ukazují ztlumeně a nezakládá se do nich —
 * patří do jiného měsíce — ale jejich hodiny jsou v součtu týdne, protože
 * týden je týden.
 */

export type OsobaMesice = { id: string; jmeno: string };

const NAZVY_DNU = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export default function MesicLidi({
  lide,
  mesic,
  tydny,
  smeny,
  dnesni,
  planovani,
  jmena,
  poziceOsob,
  barvy,
  nazvyPobocek,
  pobockaProNovou,
  vybranaId,
  onOtevrit,
}: {
  lide: OsobaMesice[];
  /** `RRRR-MM` */
  mesic: string;
  /** Týdny měsíce od pondělí (`mesicniMrizka`). */
  tydny: string[][];
  /** Všechny načtené směny okna; kalendář si vybere směny svého člověka. */
  smeny: Smena[];
  dnesni: string;
  planovani: Planovani | null;
  jmena: Map<string, string>;
  poziceOsob: (osobaId: string) => string | null;
  barvy: Map<string, string | null>;
  nazvyPobocek: Map<string, string>;
  /** Na které pobočce zakládat novou směnu (vybraná v Zobrazit, jinak výchozí). */
  pobockaProNovou: string | null;
  vybranaId: string | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  // Kdo pracuje na víc pobočkách, vidí na kartě, kde je která směna.
  const vicePobocek = new Set(smeny.map((s) => s.branch_id)).size > 1;

  return (
    <div className="ds-smd-ml" data-lidi={lide.length}>
      {lide.map((o) => (
        <KartaMesice
          key={o.id}
          osoba={o}
          mesic={mesic}
          tydny={tydny}
          smeny={smeny}
          dnesni={dnesni}
          planovani={planovani}
          jmena={jmena}
          role={poziceOsob(o.id)}
          barva={barvy.get(o.id) ?? null}
          nazvyPobocek={vicePobocek ? nazvyPobocek : null}
          pobockaProNovou={pobockaProNovou}
          vybranaId={vybranaId}
          onOtevrit={onOtevrit}
        />
      ))}
    </div>
  );
}

function KartaMesice({
  osoba,
  mesic,
  tydny,
  smeny,
  dnesni,
  planovani,
  jmena,
  role,
  barva,
  nazvyPobocek,
  pobockaProNovou,
  vybranaId,
  onOtevrit,
}: {
  osoba: OsobaMesice;
  mesic: string;
  tydny: string[][];
  smeny: Smena[];
  dnesni: string;
  planovani: Planovani | null;
  jmena: Map<string, string>;
  role: string | null;
  barva: string | null;
  /** `null` = jedna pobočka, název se nepíše. */
  nazvyPobocek: Map<string, string> | null;
  pobockaProNovou: string | null;
  vybranaId: string | null;
  onOtevrit: (co: Otevrene) => void;
}) {
  const kalendar = sestavitMesicOsoby({
    smeny: smeny as SmenaD[],
    osobaId: osoba.id,
    tydny,
    mesic,
  });

  return (
    <section className="ds-smd-ml-karta" aria-label={`Měsíc: ${osoba.jmeno}`}>
      <header className="ds-smd-ml-hlava">
        <span className="ds-smd-avatar" aria-hidden="true">
          {inicialy(osoba.jmeno)}
        </span>
        <div className="ds-smd-ml-kdo">
          <h2 title={osoba.jmeno}>
            <ZnackaOsoby barva={barva} velikost={9} />
            <span className="ds-smd-jmeno-text">{osoba.jmeno}</span>
          </h2>
          {role ? <p>{role}</p> : null}
        </div>
        <p
          className="ds-smd-ml-souhrn"
          title="Plánované hodiny dnů tohoto měsíce, bez automatické přestávky pobočky"
        >
          <strong>{hodinyStruc(kalendar.minut)}</strong> · {pocet(kalendar.smen, "směna", "směny", "směn")}
          {planovani && kalendar.nevydanych > 0 ? (
            <>
              {" · "}
              <span className="ds-smd-ml-nevydane">
                {pocet(kalendar.nevydanych, "nevydaná", "nevydané", "nevydaných")}
              </span>
            </>
          ) : null}
        </p>
      </header>

      <div role="table" aria-label={`Kalendář měsíce: ${osoba.jmeno}`} className="ds-smd-ml-tabulka">
        <div role="row" className="ds-smd-ml-radek">
          {NAZVY_DNU.map((nazev, i) => (
            <div key={nazev} role="columnheader" className="ds-smd-ml-dnv" data-vikend={i >= 5 ? "" : undefined}>
              {nazev}
            </div>
          ))}
          <div role="columnheader" className="ds-smd-ml-dnv" title="Naplánované hodiny za týden od pondělí do neděle">
            Týden
          </div>
        </div>

        {kalendar.tydny.map((tyden) => (
          <div key={tyden.dny[0].den} role="row" className="ds-smd-ml-radek">
            {tyden.dny.map((d) => {
              const obsazeno = d.smeny.length > 0;
              const cislo = cisloDne(d.den);
              return (
                <div
                  key={d.den}
                  role="cell"
                  className="ds-smd-ml-bunka"
                  data-dnes={d.den === dnesni ? "" : undefined}
                  data-vikend={jeVikend(d.den) ? "" : undefined}
                  data-mimo={d.vMesici ? undefined : ""}
                >
                  <span
                    className="ds-smd-ml-cislo"
                    aria-label={`${cislo}. ${Number(d.den.slice(5, 7))}.`}
                  >
                    {d.vMesici ? cislo : `${cislo}. ${Number(d.den.slice(5, 7))}.`}
                  </span>

                  {d.smeny.map((s) => (
                    <div key={s.id} className="ds-smd-ml-smena">
                      <KartaSmeny
                        s={s as Smena}
                        jmena={jmena}
                        vybrana={vybranaId === s.id}
                        klikaci={planovani !== null}
                        kompaktni
                        onOtevrit={() => onOtevrit({ den: d.den, smena: s as Smena })}
                      />
                      {nazvyPobocek ? (
                        <span className="ds-smd-ml-pobocka" title={nazvyPobocek.get(s.branch_id) ?? undefined}>
                          {nazvyPobocek.get(s.branch_id) ?? ""}
                        </span>
                      ) : null}
                    </div>
                  ))}

                  {/*
                    Jen prázdný den v měsíci — stejné pravidlo jako v týdenní
                    mřížce: další směnu téhož dne řeší otevřená směna
                    („Duplikovat“), ne druhé plus.
                  */}
                  {planovani && d.vMesici && !obsazeno ? (
                    <button
                      type="button"
                      className="ds-smd-ml-pridat"
                      aria-label={`Přidat směnu: ${osoba.jmeno}, ${cislo}. ${Number(d.den.slice(5, 7))}.`}
                      onClick={() =>
                        onOtevrit({
                          den: d.den,
                          smena: novaSmenaProOsobu(osoba.id, d.den, pobockaProNovou ?? planovani.vychoziPobocka ?? ""),
                          nonce: Date.now(),
                        })
                      }
                    >
                      <Ikona klic="plus" velikost={12} />
                      Přidat
                    </button>
                  ) : null}
                </div>
              );
            })}
            <div role="cell" className="ds-smd-ml-tyden">
              {tyden.minut > 0 ? hodinyStruc(tyden.minut) : "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
