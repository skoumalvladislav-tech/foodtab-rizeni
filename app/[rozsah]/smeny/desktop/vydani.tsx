"use client";

import { useFormStatus } from "react-dom";

import Ikona from "@/app/[rozsah]/ikona";
import Drawer from "@/components/ui/Drawer";
import {
  NAZVY_ZMEN,
  denKratce,
  souhrnZmen,
  textZmeny,
  zmenyPodleLidi,
  type ZmenaRozpisu,
} from "@/lib/rozpis-desktop";
import { inicialy } from "@/lib/rozpis-mobil";
import { pocet, prisudek, sklonovat } from "@/lib/sklonovani";

import { vydatRozpis } from "../vydani";
import type { VydaniProp } from "./typy";

/**
 * Vydání rozpisu na počítači.
 *
 *   PruhVydani      jednořádkový pruh nad mřížkou: „7 změn čeká na
 *                   vydání · 1 zaměstnanec bude upozorněn“
 *   KontrolaVydani  boční panel: co přesně se změnilo (staré → nové),
 *                   komu zazvoní a poslední potvrzení
 *
 * Číslo „kolika lidem zazvoní“ dodává databáze (`rozpis_nahled`, tatáž
 * funkce jako vlastní vydání), takže pruh neslíbí něco jiného, než co se
 * stane. Přehled změn po směnách se skládá z týchž sloupců, ze kterých
 * počítá rozdíl databáze (`lib/rozpis-desktop`) — a ukazuje víc než
 * zprávy: i změnu, o které nikdo zprávu nedostane.
 */

export function PruhVydani({
  zmeny,
  vydani,
  obdobi,
  kontrolaAktivni,
  onZkontrolovat,
  onVydat,
}: {
  zmeny: ZmenaRozpisu[];
  vydani: VydaniProp | null;
  obdobi: string;
  kontrolaAktivni: boolean;
  onZkontrolovat: () => void;
  onVydat: () => void;
}) {
  // Kdo rozpis neplánuje, žádný pruh nevidí.
  if (!vydani) return null;

  const { smen } = souhrnZmen(zmeny);
  const smiVydat = vydani.pobockaId !== null && vydani.mozeVydat;

  if (smen === 0) {
    // Nic nečeká — jen tichý řádek, ne karta. Nemá zabírat místo mřížce.
    if (!vydani.vydanoKdy) return null;
    return (
      <p className="ds-smd-vydano" role="status">
        <Ikona klic="fajfka" velikost={14} />
        Rozpis je vydaný — nic nečeká na vydání.
      </p>
    );
  }

  const upozorneno = vydani.zprav;

  return (
    <div className="ds-smd-pruh" role="status" data-stav="ceka">
      <span className="ds-smd-pruh-ikona" aria-hidden="true">
        <Ikona klic="varovani" velikost={18} />
      </span>
      <p className="ds-smd-pruh-text">
        <strong>
          {pocet(smen, "změna", "změny", "změn")} {prisudek(smen, "čeká", "čekají", "čeká")} na vydání
        </strong>
        {smiVydat ? (
          <span className="ds-smd-pruh-vedlejsi">
            {" · "}
            {upozorneno === 0
              ? "nikdo nebude upozorněn"
              : `${upozorneno} ${sklonovat(upozorneno, "zaměstnanec", "zaměstnanci", "zaměstnanců")} ${prisudek(upozorneno, "bude upozorněn", "budou upozorněni", "bude upozorněno")}`}
          </span>
        ) : (
          <span className="ds-smd-pruh-vedlejsi">
            {" · "}
            vydává se po pobočkách — přepněte nahoře na konkrétní pobočku
          </span>
        )}
        <span className="ds-smd-pruh-obdobi"> ({obdobi})</span>
      </p>
      <div className="ds-smd-pruh-akce">
        <button
          type="button"
          className="ds-smd-tl"
          aria-pressed={kontrolaAktivni}
          onClick={onZkontrolovat}
          title="Ukáže v mřížce jen řádky s nevydanými změnami"
        >
          Zkontrolovat změny
        </button>
        {smiVydat ? (
          <button type="button" className="ds-smd-tl ds-smd-tl-hlavni" onClick={onVydat}>
            Vydat rozpis
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* --- boční panel: kontrola před vydáním -------------------------------- */

export function KontrolaVydani({
  rozsah,
  zmeny,
  vydani,
  obdobi,
  pobockaNazev,
  jmeno,
  onZavrit,
}: {
  rozsah: string;
  zmeny: ZmenaRozpisu[];
  vydani: VydaniProp;
  obdobi: string;
  pobockaNazev: string | null;
  jmeno: (osobaId: string) => string;
  onZavrit: () => void;
}) {
  const { smen, lidi } = souhrnZmen(zmeny);
  const poLidech = zmenyPodleLidi(zmeny, jmeno);
  const upozornit = new Set(vydani.upozornit);

  return (
    <Drawer otevreno onZavrit={onZavrit} nadpis="Vydat rozpis" sirka="siroka">
      <div className="ds-smd-kontrola">
        <p className="ds-smd-kontrola-uvod">
          {pobockaNazev ? <strong>{pobockaNazev}</strong> : null}
          {pobockaNazev ? " · " : ""}
          {obdobi}
        </p>

        <dl className="ds-smd-kpi">
          <div>
            <dt>Změn</dt>
            <dd>{smen}</dd>
          </div>
          <div>
            <dt>Dotčených lidí</dt>
            <dd>{lidi}</dd>
          </div>
          <div>
            <dt>Zpráv rozešle</dt>
            <dd>{vydani.zprav}</dd>
          </div>
        </dl>

        <div className="ds-smd-kontrola-seznam">
          {poLidech.map((p) => {
            const zprava = p.osobaId !== null && upozornit.has(p.osobaId);
            return (
              <section key={p.osobaId ?? "volne"} className="ds-smd-kontrola-osoba">
                <header>
                  <span className="ds-smd-avatar" aria-hidden="true">
                    {p.osobaId ? inicialy(jmeno(p.osobaId)) : "?"}
                  </span>
                  <h3>{p.osobaId ? jmeno(p.osobaId) : "Neobsazené směny"}</h3>
                  {p.osobaId ? (
                    <span
                      className="ds-smd-kontrola-zprava"
                      data-ano={zprava ? "" : undefined}
                      title={
                        zprava
                          ? "Při vydání dostane zprávu s těmito změnami."
                          : "Zpráva nepůjde: člověk nemá účet v aplikaci, nebo jde o vaše vlastní směny."
                      }
                    >
                      {zprava ? (
                        <>
                          <Ikona klic="fajfka" velikost={13} /> dostane zprávu
                        </>
                      ) : (
                        "bez zprávy"
                      )}
                    </span>
                  ) : null}
                </header>
                <ul>
                  {p.zmeny.map((z) => (
                    <li key={`${z.smenaId}-${z.druh}`}>
                      <span className="ds-smd-kontrola-den">{denKratce(z.den)}</span>
                      <span className="ds-smd-kontrola-druh" data-druh={z.druh}>
                        {NAZVY_ZMEN[z.druh]}
                      </span>
                      <span className="ds-smd-kontrola-cas">
                        {textZmeny(z)}
                        {z.druh === "prevzata" && z.puvodniOsobaId ? (
                          <span className="ds-smd-kontrola-poznamka">dříve {jmeno(z.puvodniOsobaId)}</span>
                        ) : z.druh === "prevzata" ? (
                          <span className="ds-smd-kontrola-poznamka">dříve neobsazeno</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <p className="ds-smd-kontrola-pravidlo">
          Zprávu dostane jen ten, koho se změna týká — jedna zpráva na člověka a jen s jeho směnami. O cizích
          směnách se z ní nedozví. Vám samotným nepřijde nic, o svých změnách víte. Rozeslané zprávy se
          nedají vzít zpět.
        </p>

        <form action={vydatRozpis} className="ds-smd-kontrola-pata">
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="pobocka" value={vydani.pobockaId ?? ""} />
          <input type="hidden" name="od" value={vydani.od} />
          <input type="hidden" name="do" value={vydani.doKdy} />
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={onZavrit}>
            Zpět
          </button>
          <TlacitkoVydat zprav={vydani.zprav} />
        </form>
      </div>
    </Drawer>
  );
}

function TlacitkoVydat({ zprav }: { zprav: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ft-tl ft-tl-hlavni" disabled={pending}>
      {pending
        ? "Vydávám…"
        : zprav > 0
          ? `Vydat rozpis a rozeslat ${zprav}`
          : "Vydat rozpis"}
    </button>
  );
}
