"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import { datumACasVPasmu } from "@/lib/cas";
import { hodinyKratce } from "@/lib/rozpis-mobil";

import { nactiDochazkuKeSmene, type DochazkaKeSmene } from "../dochazka-smeny";
import { nactiStavSmeny, type UpozorneniVedouciho } from "../potvrzeni";

/**
 * Co k směně ví zbytek aplikace — pod formulářem v panelu „Upravit směnu“.
 *
 *   Docházka k této směně   plán vs. skutečnost: příchod, odchod, čas na místě
 *   Upozornění              kdy člověk upozornění na změnu dostal, přečetl, potvrdil
 *
 * Obojí je jen ČTENÍ a obojí je nepovinné: bez práva (`attendance.read`,
 * `shifts.manage`) nebo bez nasazené migrace se příslušná karta prostě
 * nekreslí. Data se načítají po otevření panelu — nezdržují rozpis a
 * nejdou v HTML každému, kdo stránku otevře.
 *
 * Docházka se do rozpisu NIKAM nezapisuje. Rozpis je plán, docházka je
 * skutečnost; tady se jen poskládají vedle sebe.
 */

type Faze<T> = { faze: "nacita" } | { faze: "hotovo"; data: T };

export default function PanelKeSmene({
  rozsah,
  smena,
  jmeno,
  dnesni,
  vidiDochazku,
}: {
  rozsah: string;
  smena: { id: string; branch_id: string; employee_id: string | null; shift_date: string };
  jmeno: string | null;
  dnesni: string;
  vidiDochazku: boolean;
}) {
  // Docházka dává smysl u směny, která už začala nebo je dnes; do budoucnosti není co ukázat.
  const chceDochazku = vidiDochazku && smena.employee_id !== null && smena.shift_date <= dnesni;

  const [dochazka, setDochazka] = useState<Faze<DochazkaKeSmene | null>>({ faze: "nacita" });
  const [upozorneni, setUpozorneni] = useState<Faze<UpozorneniVedouciho | null>>({ faze: "nacita" });

  useEffect(() => {
    let zruseno = false;
    if (chceDochazku && smena.employee_id) {
      nactiDochazkuKeSmene(smena.branch_id, smena.employee_id, smena.shift_date)
        .then((data) => {
          if (!zruseno) setDochazka({ faze: "hotovo", data });
        })
        .catch(() => {
          if (!zruseno) setDochazka({ faze: "hotovo", data: null });
        });
    }
    nactiStavSmeny(smena.id)
      .then((s) => {
        if (!zruseno) setUpozorneni({ faze: "hotovo", data: s.vedouci });
      })
      .catch(() => {
        if (!zruseno) setUpozorneni({ faze: "hotovo", data: null });
      });
    return () => {
      zruseno = true;
    };
  }, [chceDochazku, smena.id, smena.branch_id, smena.employee_id, smena.shift_date]);

  const dochazkaData = dochazka.faze === "hotovo" ? dochazka.data : null;
  const upozorneniData = upozorneni.faze === "hotovo" ? upozorneni.data : null;

  return (
    <>
      {chceDochazku && (dochazka.faze === "nacita" || dochazkaData) ? (
        <section className="ds-smd-karta" aria-labelledby="ds-smd-dochazka-nadpis">
          <h3 id="ds-smd-dochazka-nadpis">Docházka k této směně</h3>
          {dochazka.faze === "nacita" || dochazkaData === null ? (
            <p className="ds-smd-karta-mlcky" aria-busy="true">
              Načítám…
            </p>
          ) : (
            <>
              <div className="ds-smd-karta-radek">
                <span className="ds-smd-karta-jmeno">{jmeno ?? "Zaměstnanec"}</span>
                <span className="ds-smd-pritomnost" data-stav={dochazkaData.stav}>
                  {dochazkaData.stav === "v_praci"
                    ? dochazkaData.naPrestavce
                      ? "Na přestávce"
                      : "V práci"
                    : dochazkaData.stav === "odesel"
                      ? "Odešel(a)"
                      : "Ještě nepřišel(a)"}
                </span>
              </div>
              <dl className="ds-smd-udaje">
                <div>
                  <dt>Příchod</dt>
                  <dd>{dochazkaData.prichod ?? "—"}</dd>
                </div>
                <div>
                  <dt>Odchod</dt>
                  <dd>{dochazkaData.odchod ?? "—"}</dd>
                </div>
                <div>
                  <dt>Na místě</dt>
                  <dd>{dochazkaData.minut > 0 ? hodinyKratce(dochazkaData.minut) : "—"}</dd>
                </div>
              </dl>
              {dochazkaData.otevrenyZeDne ? (
                <p className="ds-smd-karta-mlcky">
                  Příchod je z dřívějšího provozního dne ({dochazkaData.otevrenyZeDne}) a odchod chybí.
                </p>
              ) : null}
              {smena.shift_date === dnesni && smena.employee_id ? (
                <Link
                  href={`/${rozsah}/dochazka?osoba=${smena.employee_id}`}
                  className="ft-tl ft-tl-male ft-tl-vedlejsi ds-smd-karta-odkaz"
                >
                  Zobrazit docházku
                  <Ikona klic="sipkaVpravo" velikost={14} />
                </Link>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {upozorneniData ? (
        <section className="ds-smd-karta" aria-labelledby="ds-smd-upozorneni-nadpis">
          <h3 id="ds-smd-upozorneni-nadpis">Upozornění na změnu</h3>
          <dl className="ds-smd-udaje ds-smd-udaje-svisle">
            <div>
              <dt>Doručeno</dt>
              <dd>{datumACasVPasmu(upozorneniData.prijato_at)}</dd>
            </div>
            <div>
              <dt>Přečteno</dt>
              <dd>{upozorneniData.precteno_at ? datumACasVPasmu(upozorneniData.precteno_at) : "zatím ne"}</dd>
            </div>
            <div>
              <dt>Potvrzeno</dt>
              <dd>{upozorneniData.potvrzeno_at ? datumACasVPasmu(upozorneniData.potvrzeno_at) : "zatím ne"}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </>
  );
}
