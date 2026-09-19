"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import Drawer from "@/components/ui/Drawer";
import { koruny } from "@/lib/mzdy";
import { hodinyKratce, inicialy } from "@/lib/rozpis-mobil";

import { nactiMesicCloveka, type MesicCloveka } from "./detail-akce";
import type { RadekPrehledu } from "./nacti";

/**
 * Boční panel jednoho člověka v živém přehledu docházky.
 *
 * Plán dne, příchod, odchod, čas na místě a dnešní záznamy jsou už v
 * řádku přehledu, žádný další dotaz. Jen „Tento měsíc“ se dotahuje po
 * otevření (`nactiMesicCloveka`), protože se počítá pro celou pobočku a
 * vidí ho jen ten, kdo má `payroll.read` — ostatním se karta nekreslí.
 *
 * Nemodální (rozpis docházky zůstává vidět a jde přepnout na dalšího
 * člověka). Odkaz do Rozpisu otevře přímo směnu tohoto člověka.
 */

export default function Detail({
  radek,
  rozsah,
  den,
  onZavrit,
}: {
  radek: RadekPrehledu;
  rozsah: string;
  den: string;
  onZavrit: () => void;
}) {
  // `undefined` = ještě se načítá, `null` = není (bez práva / bez dat).
  const [mesic, setMesic] = useState<MesicCloveka | null | undefined>(undefined);

  useEffect(() => {
    let zruseno = false;
    nactiMesicCloveka(rozsah, radek.osobaId)
      .then((m) => {
        if (!zruseno) setMesic(m);
      })
      .catch(() => {
        if (!zruseno) setMesic(null);
      });
    return () => {
      zruseno = true;
    };
  }, [rozsah, radek.osobaId]);

  const podtitul = [radek.pozice, radek.usek].filter(Boolean).join(" · ");
  const odkazNaSmeny = `/${rozsah}/smeny?den=${den}${radek.smenaId ? `&smena=${radek.smenaId}` : ""}`;

  return (
    <Drawer otevreno onZavrit={onZavrit} nadpis="Docházka" nemodalni>
      <div className="ds-dh-detail">
        <div className="ds-smd-hlavicka-osoba">
          <span className="ds-smd-avatar ds-smd-avatar-velky" aria-hidden="true">
            {inicialy(radek.jmeno)}
          </span>
          <span className="ds-smd-osoba-text">
            <span className="ds-smd-hlavicka-jmeno">{radek.jmeno}</span>
            {podtitul ? <span className="ds-smd-role">{podtitul}</span> : null}
          </span>
        </div>

        <section className="ds-smd-karta" aria-labelledby="ds-dh-plan">
          <h3 id="ds-dh-plan">Dnešní směna</h3>
          {radek.plan ? (
            <p className="ds-dh-plan">{radek.plan}</p>
          ) : (
            <p className="ds-smd-karta-mlcky">Dnes nemá v rozpisu žádnou směnu{radek.bezSmeny ? ", ale píchl(a) se." : "."}</p>
          )}
        </section>

        <section className="ds-smd-karta" aria-labelledby="ds-dh-stav">
          <h3 id="ds-dh-stav">Skutečnost</h3>
          <dl className="ds-smd-udaje">
            <div>
              <dt>Příchod</dt>
              <dd>{radek.prichod ?? "—"}</dd>
            </div>
            <div>
              <dt>Odchod</dt>
              <dd>{radek.odchod ?? "—"}</dd>
            </div>
            <div>
              <dt>Na místě</dt>
              <dd>{radek.minut > 0 ? hodinyKratce(radek.minut) : "—"}</dd>
            </div>
          </dl>
          {radek.otevrenyZeDne ? (
            <p className="ds-smd-karta-mlcky">
              Otevřený příchod je z provozního dne {radek.otevrenyZeDne} — buď noční směna, která ještě neskončila,
              nebo zapomenutý odchod.
            </p>
          ) : null}
          {radek.pobockaPrichodu ? (
            <p className="ds-smd-karta-mlcky">Píchl(a) se na pobočce {radek.pobockaPrichodu}.</p>
          ) : null}
          <p className="ds-smd-karta-mlcky">Čas na místě je od příchodu do odchodu, bez odečtu přestávek.</p>
        </section>

        <section className="ds-smd-karta" aria-labelledby="ds-dh-zaznamy">
          <h3 id="ds-dh-zaznamy">Záznamy dnes</h3>
          {radek.udalosti.length === 0 ? (
            <p className="ds-smd-karta-mlcky">Dnes zatím žádný záznam.</p>
          ) : (
            <ol className="ds-dh-osa">
              {radek.udalosti.map((u, i) => (
                <li key={i}>
                  <span className="ds-dh-osa-cas">{u.cas}</span>
                  <span>{u.druh}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {mesic ? (
          <section className="ds-smd-karta" aria-labelledby="ds-dh-mesic">
            <h3 id="ds-dh-mesic">Tento měsíc</h3>
            <dl className="ds-smd-udaje ds-smd-udaje-svisle">
              <div>
                <dt>Odpracováno</dt>
                <dd>{hodinyKratce(mesic.odpracovanoMinut)}</dd>
              </div>
              {mesic.dnuBezDochazky > 0 ? (
                <div>
                  <dt>Dnů se směnou bez uzavřené docházky</dt>
                  <dd>{mesic.dnuBezDochazky}</dd>
                </div>
              ) : null}
              <div>
                <dt>Hrubá mzda (orientačně)</dt>
                <dd>{mesic.hrubaHaleru === null ? "chybí sazba" : koruny(mesic.hrubaHaleru)}</dd>
              </div>
            </dl>
            <p className="ds-smd-karta-mlcky">
              Bez odvodů, záloh a srážek. Počítá se ze zapsané docházky; nedokončené záznamy se nezapočítají.
            </p>
          </section>
        ) : null}

        <div className="ds-smd-form-druhotne">
          <Link href={odkazNaSmeny} className="ft-tl ft-tl-male ft-tl-vedlejsi">
            <Ikona klic="kalendar" velikost={15} />
            Zobrazit směny
          </Link>
        </div>
      </div>
    </Drawer>
  );
}
