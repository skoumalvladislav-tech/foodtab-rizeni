import Link from "next/link";
import type { ReactNode } from "react";

import { datetimeLocalVPasmu, datumACasVPasmu, hodinaVPasmu } from "@/lib/cas";
import Ikona from "../../ikona";
import { nastavitOdpovednost, potvrditChecklist, ulozitPolozku, uzavritChecklist } from "./akce";
import type { Detail, Fotka } from "./data";
import { Avatar, Pruh, StavChip } from "./prvky";
import {
  denDlouhy,
  hodnotaText,
  podleSekci,
  stavBehu,
  STAV_TON,
  type PolozkaBehu,
  type ZaznamPolozky,
} from "./spolecne";

/**
 * Detail běhu checklistu (mockup: pravá plocha na počítači, obrazovka 2
 * na telefonu).
 *
 * Položka se odškrtne jedním klepnutím na čtverec (jen ta, která nechce
 * hodnotu); všechno ostatní — hodnota, fotka, poznámka, „nelze splnit“ —
 * je v detailu položky (klepnutí na řádek). Dotykový cíl 44 px.
 */
export default function DetailBehu({
  rozsah,
  detail,
  jmena,
  zona,
  ted,
  pobockaNazev,
  smiSpravovat,
  mujEmployeeId,
  zpet,
  zavrit,
  naPolozku,
  vybranaPolozka,
  chyba,
  chybaPolozka,
  bok,
}: {
  rozsah: string;
  detail: Detail;
  jmena: Map<string, string>;
  zona: string;
  ted: number;
  pobockaNazev: string | null;
  smiSpravovat: boolean;
  mujEmployeeId: string | null;
  /** Adresa téhle obrazovky (i s parametry seznamu) — kam se vrátit po akci. */
  zpet: string;
  /** Kam vede „Zavřít“/„Zpět“ (seznam se stejným pohledem). */
  zavrit: string;
  naPolozku: (id: string) => string;
  vybranaPolozka: string | null;
  chyba: string | null;
  chybaPolozka: string | null;
  /** Pravý vnitřní sloupec — bok (Aktivita), nebo detail vybrané položky. */
  bok: ReactNode;
}) {
  const { beh, sablona, polozky, zaznamy, fotky, plne } = detail;
  const otevreny = beh.status === "open";
  const celkem = polozky.length;
  const stav = stavBehu(beh, detail.hotovo, ted);
  const ton = STAV_TON[stav];
  const procenta = celkem > 0 ? Math.round((detail.hotovo / celkem) * 100) : 0;
  const nelze = polozky.filter((p) => zaznamy.get(p.id)?.nelze_splnit).length;
  const odpovedny = beh.assigned_employee_id ? (jmena.get(beh.assigned_employee_id) ?? null) : null;
  const poTerminu = otevreny && beh.due_at !== null && new Date(beh.due_at).getTime() < ted;
  // Bez migrace kontrolu povinných nikdo nedrží — tlačítko se ukáže až
  // po odškrtnutí všeho (dosavadní chování).
  const lzeUzavrit = plne ? detail.nevyresenychPovinnych === 0 : celkem > 0 && detail.hotovo === celkem;
  const chybnaPolozka = chybaPolozka ? polozky.find((p) => p.id === chybaPolozka) : null;

  return (
    <section className="ds-plocha ck-behu" aria-labelledby="ck-nazev-behu">
      <div className="ck-hlava">
        <Link href={zavrit} className="ck-zpet" aria-label="Zpět na seznam checklistů">
          <Ikona klic="sipkaVlevo" />
        </Link>
        <h2 id="ck-nazev-behu">{sablona.name}</h2>
        <StavChip stav={stav} />
        <Link href={zavrit} className="ck-zavrit" aria-label="Zavřít detail checklistu">
          <Ikona klic="zavrit" />
        </Link>
      </div>

      <ul className="ck-meta">
        {detail.usekNazev ? (
          <li>
            <Ikona klic="vidlicka" /> {detail.usekNazev}
          </li>
        ) : null}
        {pobockaNazev ? (
          <li>
            <Ikona klic="pobocka" /> {pobockaNazev}
          </li>
        ) : null}
        {beh.shift_label ? (
          <li>
            <Ikona klic="hodiny" /> {beh.shift_label}
          </li>
        ) : null}
        <li>
          <Ikona klic="kalendar" /> {denDlouhy(beh.business_date)}
        </li>
      </ul>

      <div className="ck-prehled">
        <div className="ck-postup-velky">
          <p>
            <strong className="ds-cislo">
              {detail.hotovo} / {celkem}
            </strong>{" "}
            hotovo
          </p>
          <Pruh hotovo={detail.hotovo} celkem={celkem} ton={ton} />
          <small>
            {procenta} %{nelze > 0 ? ` · ${nelze} nelze splnit` : ""}
          </small>
        </div>

        <div className="ck-odpovedny">
          <p>Odpovědný</p>
          <Avatar jmeno={odpovedny} velikost="velke" />
          <div>
            <strong>{odpovedny ?? "Nepřiřazeno"}</strong>
            {beh.due_at ? (
              <small data-ton={poTerminu ? "bad" : undefined}>
                do {hodinaVPasmu(beh.due_at, zona)}
                {poTerminu ? " · po termínu" : ""}
              </small>
            ) : null}
          </div>
          {smiSpravovat && otevreny ? (
            <details className="ck-upravit" style={{ gridColumn: "1 / -1" }}>
              <summary>Upravit odpovědnost</summary>
              <form action={nastavitOdpovednost}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="beh" value={beh.id} />
                <input type="hidden" name="zpet" value={zpet} />
                <select name="komu" defaultValue={beh.assigned_employee_id ?? ""} aria-label="Odpovědný">
                  <option value="">Nepřiřazeno</option>
                  {[...jmena].map(([id, jmeno]) => (
                    <option key={id} value={id}>
                      {jmeno}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  name="doKdy"
                  aria-label="Do kdy"
                  defaultValue={beh.due_at ? datetimeLocalVPasmu(beh.due_at, zona) : ""}
                />
                {plne ? (
                  <input
                    type="text"
                    name="smena"
                    maxLength={120}
                    placeholder="Směna, např. Večerní směna"
                    aria-label="Název směny"
                    defaultValue={beh.shift_label}
                  />
                ) : null}
                <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  Uložit
                </button>
              </form>
            </details>
          ) : null}
        </div>
      </div>

      {chyba && !chybnaPolozka ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: "14px 0 0" }}>
          {chyba}
        </p>
      ) : null}

      {sablona.vyzaduje_potvrzeni ? (
        <Potvrzeni
          rozsah={rozsah}
          detail={detail}
          jmena={jmena}
          zona={zona}
          smiSpravovat={smiSpravovat}
          mujEmployeeId={mujEmployeeId}
          zpet={zpet}
        />
      ) : null}

      <div className="ck-telo" data-polozka={vybranaPolozka ? "1" : undefined}>
        <div className="ck-telo-hlavni">
          {chyba && chybnaPolozka ? (
            <p className="hlaska-chyba" role="alert" style={{ margin: "0 0 10px" }}>
              {chybnaPolozka.label}: {chyba}
            </p>
          ) : null}

          {celkem === 0 ? (
            <p className="pc-prazdno">Checklist nemá žádné položky.</p>
          ) : (
            podleSekci(polozky).map((s) =>
              s.sekce ? (
                <details key={s.sekce} className="ck-sekce" open>
                  <summary>{s.sekce}</summary>
                  <SeznamPolozek
                    rozsah={rozsah}
                    polozky={s.polozky}
                    zaznamy={zaznamy}
                    fotky={fotky}
                    jmena={jmena}
                    zona={zona}
                    behId={beh.id}
                    otevreny={otevreny}
                    plne={plne}
                    zpet={zpet}
                    naPolozku={naPolozku}
                    vybranaPolozka={vybranaPolozka}
                  />
                </details>
              ) : (
                <SeznamPolozek
                  key="bez-sekce"
                  rozsah={rozsah}
                  polozky={s.polozky}
                  zaznamy={zaznamy}
                  fotky={fotky}
                  jmena={jmena}
                  zona={zona}
                  behId={beh.id}
                  otevreny={otevreny}
                  plne={plne}
                  zpet={zpet}
                  naPolozku={naPolozku}
                  vybranaPolozka={vybranaPolozka}
                />
              ),
            )
          )}

          {otevreny ? (
            <>
              <div className="ck-akce-dole">
                <form action={uzavritChecklist}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="beh" value={beh.id} />
                  <input type="hidden" name="zpet" value={zpet} />
                  <button type="submit" className="ft-tl ft-tl-hlavni" disabled={!lzeUzavrit}>
                    Dokončit checklist
                  </button>
                </form>
                {smiSpravovat ? (
                  <Link href={`/${rozsah}/ukoly/checklisty/${beh.id}/problem`} className="ft-tl ft-tl-vedlejsi">
                    <Ikona klic="vykricnik" /> Nahlásit problém
                  </Link>
                ) : null}
              </div>
              {!lzeUzavrit && celkem > 0 ? (
                <p className="ck-poznamka-dole">
                  {plne
                    ? `Zbývá vyřešit ${detail.nevyresenychPovinnych} ${detail.nevyresenychPovinnych === 1 ? "povinnou položku" : detail.nevyresenychPovinnych < 5 ? "povinné položky" : "povinných položek"} — splnit, nebo otevřít a označit „Nelze splnit“ s důvodem.`
                    : "Checklist jde dokončit, až budou odškrtnuté všechny položky."}
                </p>
              ) : null}
              {!smiSpravovat ? (
                <p className="ck-poznamka-dole">
                  Něco nejde? Otevřete položku a označte „Nelze splnit“ s důvodem — vedoucí se to dozví.
                </p>
              ) : null}
            </>
          ) : (
            <p className="ck-poznamka-dole">
              {beh.status === "completed_with_issues" ? "Uzavřeno s výhradami" : "Uzavřeno"}
              {beh.completed_by ? ` · ${jmena.get(beh.completed_by) ?? "kdosi"}` : ""}
              {beh.finished_at ? ` · ${datumACasVPasmu(beh.finished_at, zona)}` : ""}. Hotový checklist je
              záznam a už se nemění.
            </p>
          )}
        </div>

        {bok}
      </div>
    </section>
  );
}

function Potvrzeni({
  rozsah,
  detail,
  jmena,
  zona,
  smiSpravovat,
  mujEmployeeId,
  zpet,
}: {
  rozsah: string;
  detail: Detail;
  jmena: Map<string, string>;
  zona: string;
  smiSpravovat: boolean;
  mujEmployeeId: string | null;
  zpet: string;
}) {
  const b = detail.beh;
  if (b.potvrdil_kym || b.potvrzeno_kdy) {
    return (
      <div className="ck-potvrzeni">
        <span className="ck-chip" data-ton="dobre">
          Potvrzeno
        </span>
        <p>
          {b.potvrdil_kym ? (jmena.get(b.potvrdil_kym) ?? "vedoucí") : "vedoucí"}
          {b.potvrzeno_kdy ? ` · ${datumACasVPasmu(b.potvrzeno_kdy, zona)}` : ""}
        </p>
      </div>
    );
  }
  if (b.status === "open") {
    return (
      <div className="ck-potvrzeni">
        <span className="ck-chip" data-ton="info">
          Dvojí kontrola
        </span>
        <p>Po dokončení checklist potvrdí vedoucí — jiný člověk, než kdo ho dokončil.</p>
      </div>
    );
  }
  const smiPotvrdit = smiSpravovat && (mujEmployeeId === null || mujEmployeeId !== b.completed_by);
  return (
    <div className="ck-potvrzeni">
      <span className="ck-chip" data-ton="pozor">
        Čeká na potvrzení
      </span>
      <p>
        {smiPotvrdit
          ? "Zkontrolujte položky a potvrďte."
          : smiSpravovat
            ? "Potvrdit musí jiný vedoucí než ten, kdo checklist dokončil."
            : "Potvrdí vedoucí."}
      </p>
      {smiPotvrdit ? (
        <form action={potvrditChecklist}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="beh" value={b.id} />
          <input type="hidden" name="zpet" value={zpet} />
          <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
            Potvrdit
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SeznamPolozek({
  rozsah,
  polozky,
  zaznamy,
  fotky,
  jmena,
  zona,
  behId,
  otevreny,
  plne,
  zpet,
  naPolozku,
  vybranaPolozka,
}: {
  rozsah: string;
  polozky: PolozkaBehu[];
  zaznamy: Map<string, ZaznamPolozky>;
  fotky: Map<string, Fotka[]>;
  jmena: Map<string, string>;
  zona: string;
  behId: string;
  otevreny: boolean;
  plne: boolean;
  zpet: string;
  naPolozku: (id: string) => string;
  vybranaPolozka: string | null;
}) {
  return (
    <ul className="ck-polozky">
      {polozky.map((p) => {
        const z = zaznamy.get(p.id);
        const stav = z?.checked ? "splneno" : z?.nelze_splnit ? "nelze" : "otevrene";
        const kdo = z && stav !== "otevrene" ? (z.employee_id ? (jmena.get(z.employee_id) ?? "kdosi") : null) : null;
        const hodnota = hodnotaText(p, z);
        const pocetFotek = fotky.get(p.id)?.length ?? 0;
        // Jedním klepnutím jde jen položka bez hodnoty. Vrátit bez migrace
        // nejde (dosavadní zápis umí jen „splnit“).
        const rychle = otevreny && !p.requires_value && (stav !== "splneno" || plne);
        const popis = stav === "splneno" ? "Vrátit jako nesplněné" : "Označit jako splněné";

        return (
          <li key={p.id} className="ck-polozka" data-stav={stav} aria-current={vybranaPolozka === p.id ? "true" : undefined}>
            {rychle ? (
              <form action={ulozitPolozku} className="ck-box-form">
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="beh" value={behId} />
                <input type="hidden" name="polozka" value={p.id} />
                <input type="hidden" name="rezim" value={stav === "splneno" ? "vratit" : "splnit"} />
                {z ? <input type="hidden" name="verze" value={z.verze} /> : null}
                <input type="hidden" name="zpet" value={zpet} />
                <button type="submit" className="ck-box" data-stav={stav} aria-label={`${popis}: ${p.label}`}>
                  <Ikona klic={stav === "nelze" ? "zavrit" : "fajfka"} />
                </button>
              </form>
            ) : (
              <span className="ck-box" data-stav={stav} aria-hidden="true">
                <Ikona klic={stav === "nelze" ? "zavrit" : "fajfka"} />
              </span>
            )}

            <Link href={naPolozku(p.id)} className="ck-polozka-text">
              <span className="ck-polozka-nazev">
                {p.label}
                <span className="sr-only">
                  {stav === "splneno" ? " — splněno" : stav === "nelze" ? " — nelze splnit" : " — nesplněno"}
                </span>
                {p.povinna && stav === "otevrene" ? <span className="ck-povinne">Povinné</span> : null}
              </span>
              {kdo || z?.recorded_at ? (
                stav !== "otevrene" ? (
                  <span className="ck-polozka-kdo">
                    {kdo ? <Avatar jmeno={kdo} velikost="male" /> : null}
                    {[kdo, z?.recorded_at ? hodinaVPasmu(z.recorded_at, zona) : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null
              ) : null}
              {stav === "nelze" && z?.nelze_splnit_duvod ? (
                <span className="ck-polozka-hodnota" data-ton="bad">
                  {z.nelze_splnit_duvod}
                </span>
              ) : hodnota ? (
                <span className="ck-polozka-hodnota">{hodnota}</span>
              ) : null}
            </Link>

            {z?.note || pocetFotek > 0 ? (
              <span className="ck-polozka-ikony" aria-hidden="true">
                {z?.note ? (
                  <span title="Poznámka">
                    <Ikona klic="zprava" />
                  </span>
                ) : null}
                {pocetFotek > 0 ? (
                  <span title="Fotky">
                    <Ikona klic="fotka" />
                    {pocetFotek}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="ck-polozka-sipka" aria-hidden="true">
              <Ikona klic="sipkaVpravo" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
