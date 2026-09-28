"use client";

import { useCallback, useState } from "react";
import { useFormStatus } from "react-dom";

import Ikona from "@/app/[rozsah]/ikona";
import Drawer from "@/components/ui/Drawer";
import { dalsiDen } from "@/lib/useky-dochazky";

import { stornovatUsek, upravitUsek } from "./akce";

/**
 * Úprava a storno úseku — tlačítko, které otevře panel s formulářem.
 *
 * PRAVIDLA ÚPRAVY DRŽÍ DATABÁZE (`upravit_usek_dochazky`): pořadí,
 * 24 h, provozní den, překryv, přestávky, párování, práva. Formulář jen
 * nabídne hodnoty a hned řekne, co je vidět už tady (odchod dřív než
 * příchod) — ale neodmítá: hlášku z databáze ukáže stránka u dne.
 *
 * Hodina na zdi se posílá TAK, JAK JE V POLÍČKU (datum + čas zvlášť),
 * pásmo dodá pobočka v databázi. Žádné `new Date()` (pravidlo 11).
 * Čas, který aplikace vědět nemůže (chybějící odchod), se NEPŘEDVYPLŇUJE
 * — přesně tak si Šéfík jednou omylem uzavřel dnešek místo 31. srpna.
 *
 * Storno je dvoukrokové: tlačítko přepne panel na potvrzení s povinným
 * důvodem. Nic se nemaže: úsek zůstane přeškrtnutý a přestane se
 * počítat do mzdy.
 */

export type RezimUpravy = "upravit" | "doplnit-odchod" | "doplnit-prichod" | "novy" | "storno";

export type Hodnota = { datum: string; cas: string; pobocka: string } | null;

type Spolecne = {
  rozsah: string;
  zamestnanec: string;
  /** RRRR-MM — kam se po uložení vrátit. */
  mesic: string;
  /** Odkud se na obrazovku přišlo (výčet). */
  odkud: string | null;
  /** Provozní den (kotva po uložení). Nový úsek ho nemá. */
  den: string | null;
  prichodId: string | null;
  odchodId: string | null;
  /** „Teď: 08:39 kód → 21:10 kód · 12 h 21 min" */
  popisTed: string | null;
  /** Kam se po stornu vrátit: obrazovka člověka, nebo boční panel přehledu. */
  zpet?: "clovek" | "prehled";
};

export default function UpravaUseku({
  rezim,
  nadpis,
  popisek,
  hlavni = false,
  ikona,
  prichod,
  odchod,
  pobocky,
  stornoPopisek,
  ...spolecne
}: Spolecne & {
  rezim: RezimUpravy;
  /** Nadpis panelu: „Upravit úsek · Čt 25. 9." */
  nadpis: string;
  /** Text tlačítka, které panel otevře. */
  popisek: string;
  /** Zlaté tlačítko — jen jedno na kartu (Doplnit odchod). */
  hlavni?: boolean;
  ikona?: "tuzka" | "plus";
  /** Předvyplnění. `cas` prázdný = čas se nedomýšlí. */
  prichod: Hodnota;
  odchod: Hodnota;
  /** Pobočky, na kterých volající docházku spravuje. */
  pobocky: { id: string; nazev: string }[];
  /** „Stornovat úsek" / „Stornovat příchod" / „Stornovat záznam"; bez něj se storno nenabízí. */
  stornoPopisek?: string;
}) {
  const [otevreno, setOtevreno] = useState(false);
  const [krok, setKrok] = useState<"formular" | "storno">(rezim === "storno" ? "storno" : "formular");

  // Stálá funkce: Drawer má efekt závislý na onZavrit. Nová funkce při
  // každém překreslení (přepnutí na storno) by efekt spustila znovu —
  // fokus by odskočil na tlačítko za ztmavením a zpátky na panel, a
  // autoFocus pole „Proč se stornuje" by propadl.
  const zavrit = useCallback(() => {
    setOtevreno(false);
    setKrok(rezim === "storno" ? "storno" : "formular");
  }, [rezim]);
  const naStorno = useCallback(() => setKrok("storno"), []);
  const naFormular = useCallback(() => setKrok("formular"), []);

  return (
    <>
      <button
        type="button"
        className={`ft-tl ${hlavni ? "ft-tl-hlavni" : "ft-tl-vedlejsi"} ds-uc-tlacitko`}
        onClick={() => setOtevreno(true)}
      >
        {ikona ? <Ikona klic={ikona} velikost={16} /> : null}
        {popisek}
      </button>

      <Drawer otevreno={otevreno} onZavrit={zavrit} nadpis={nadpis} sirka="uzka">
        {krok === "storno" ? (
          <StornoFormular
            {...spolecne}
            popisek={stornoPopisek ?? "Stornovat"}
            onZpet={rezim === "storno" ? zavrit : naFormular}
          />
        ) : (
          <FormularUpravy
            {...spolecne}
            rezim={rezim}
            prichod={prichod}
            odchod={odchod}
            pobocky={pobocky}
            onStorno={stornoPopisek ? naStorno : null}
            stornoPopisek={stornoPopisek ?? null}
          />
        )}
      </Drawer>
    </>
  );
}

/* --- formulář úpravy ---------------------------------------------------- */

function FormularUpravy({
  rezim,
  prichod,
  odchod,
  pobocky,
  onStorno,
  stornoPopisek,
  ...s
}: Spolecne & {
  rezim: RezimUpravy;
  prichod: Hodnota;
  odchod: Hodnota;
  pobocky: { id: string; nazev: string }[];
  onStorno: (() => void) | null;
  stornoPopisek: string | null;
}) {
  const vychoziPobocka = pobocky[0]?.id ?? "";
  const [pDatum, setPDatum] = useState(prichod?.datum ?? "");
  const [pCas, setPCas] = useState(prichod?.cas ?? "");
  const [oDatum, setODatum] = useState(odchod?.datum ?? prichod?.datum ?? "");
  const [oCas, setOCas] = useState(odchod?.cas ?? "");
  const [bezOdchodu, setBezOdchodu] = useState(false);

  // Jen upozornění z toho, co je v políčkách (řetězce RRRR-MM-DDTHH:MM
  // se dají porovnat přímo, pásmo je u obou stejné pobočky). Rozhoduje
  // databáze.
  const obraceny = !bezOdchodu && pDatum && pCas && oDatum && oCas && `${oDatum}T${oCas}` <= `${pDatum}T${pCas}`;
  const nabidnoutBezOdchodu = rezim === "doplnit-odchod";

  return (
    <form action={upravitUsek} className="ds-uc-form">
      <Skryta {...s} />
      {s.popisTed ? <p className="ds-uc-form-ted">{s.popisTed}</p> : null}

      <fieldset>
        <legend>Příchod</legend>
        <div className="ds-uc-dvojice">
          <label>
            Datum
            <input
              type="date"
              name="prichod_datum"
              value={pDatum}
              onChange={(e) => setPDatum(e.target.value)}
              required
            />
          </label>
          <label>
            Čas
            <input type="time" name="prichod_cas" value={pCas} onChange={(e) => setPCas(e.target.value)} required />
          </label>
        </div>
        <VyberPobocky name="prichod_pobocka" pobocky={pobocky} vychozi={prichod?.pobocka || vychoziPobocka} />
      </fieldset>

      <fieldset>
        <legend>Odchod</legend>
        {nabidnoutBezOdchodu ? (
          <label className="ds-uc-volba">
            <input
              type="checkbox"
              name="bez_odchodu"
              value="1"
              checked={bezOdchodu}
              onChange={(e) => setBezOdchodu(e.target.checked)}
            />
            Bez odchodu (ještě v práci) — upraví se jen příchod
          </label>
        ) : null}
        {bezOdchodu ? null : (
          <>
            <div className="ds-uc-dvojice">
              <label>
                Datum
                <input
                  type="date"
                  name="odchod_datum"
                  value={oDatum}
                  onChange={(e) => setODatum(e.target.value)}
                  required
                />
              </label>
              <label>
                Čas
                <input type="time" name="odchod_cas" value={oCas} onChange={(e) => setOCas(e.target.value)} required />
              </label>
            </div>
            {pDatum ? (
              <button
                type="button"
                className="ft-tl ft-tl-vedlejsi ft-tl-male ds-uc-pulnoc"
                onClick={() => setODatum(dalsiDen(pDatum))}
              >
                Odchod až po půlnoci (datum o den dál)
              </button>
            ) : null}
            <VyberPobocky
              name="odchod_pobocka"
              pobocky={pobocky}
              vychozi={odchod?.pobocka || prichod?.pobocka || vychoziPobocka}
            />
          </>
        )}
      </fieldset>

      {obraceny ? (
        <p className="ds-uc-varovani" role="status">
          <Ikona klic="varovani" velikost={15} />
          Odchod je dřív než příchod. Nejde-li o noc, zkontrolujte datum odchodu.
        </p>
      ) : null}

      <label className="ds-uc-duvod">
        Důvod opravy (uvidí ho i zaměstnanec)
        <textarea name="duvod" required minLength={3} maxLength={300} placeholder="např. zapomněl se odpíchnout" />
      </label>

      <div className="ds-uc-form-tlacitka">
        <Odeslat className="ft-tl ft-tl-hlavni" pracuje="Ukládám…">
          {rezim === "novy" ? "Zapsat úsek" : "Uložit opravu"}
        </Odeslat>
      </div>

      {onStorno ? (
        <div className="ds-uc-form-storno">
          <button type="button" className="ft-tl ft-tl-nebezpecne" onClick={onStorno}>
            {stornoPopisek}…
          </button>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Tlačítko odeslání se stavem „ukládám": po dobu odesílání vypnuté.
 * Dvojklik by jinak poslal úpravu podruhé a databáze by tu druhou
 * odmítla („Mezitím to někdo změnil", „překrýval by se") — u změny,
 * která se ve skutečnosti provedla. Vzor smeny/desktop/vydani.tsx.
 */
function Odeslat({ className, pracuje, children }: { className: string; pracuje: string; children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined}>
      {pending ? pracuje : children}
    </button>
  );
}

/* --- potvrzení storna ------------------------------------------------------ */

export function StornoFormular({
  popisek,
  onZpet,
  ...s
}: Spolecne & { popisek: string; onZpet: () => void }) {
  return (
    <form action={stornovatUsek} className="ds-uc-form" data-krok="storno">
      <Skryta {...s} />
      <p className="ds-uc-storno-veta">
        <strong>Nic se nesmaže.</strong> Záznam zůstane přeškrtnutý i s důvodem a jeho hodiny se
        přestanou počítat do mzdy. Kdo se píchl omylem, se pak může píchnout znovu.
      </p>
      {s.popisTed ? <p className="ds-uc-form-ted">{s.popisTed}</p> : null}
      <label className="ds-uc-duvod">
        Proč se stornuje (povinné)
        <textarea name="duvod" required minLength={3} maxLength={300} placeholder="např. píchnutí omylem" autoFocus />
      </label>
      <div className="ds-uc-form-tlacitka">
        <Odeslat className="ft-tl ft-tl-nebezpecne" pracuje="Stornuji…">
          {popisek}
        </Odeslat>
        <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={onZpet}>
          Zpět
        </button>
      </div>
    </form>
  );
}

/**
 * Storno přímo v bočním panelu živého přehledu — bez dalšího panelu nad
 * panelem: tlačítko rozbalí potvrzení na místě.
 */
export function StornoNaMiste({
  popisek,
  ...s
}: Spolecne & { popisek: string }) {
  const [otevreno, setOtevreno] = useState(false);
  if (!otevreno) {
    return (
      <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => setOtevreno(true)}>
        {popisek}…
      </button>
    );
  }
  return <StornoFormular {...s} popisek={popisek} onZpet={() => setOtevreno(false)} />;
}

/* --- kousky ------------------------------------------------------------------ */

function Skryta(s: Spolecne) {
  return (
    <>
      <input type="hidden" name="rozsah" value={s.rozsah} />
      <input type="hidden" name="zamestnanec" value={s.zamestnanec} />
      <input type="hidden" name="mesic" value={s.mesic} />
      {s.odkud ? <input type="hidden" name="z" value={s.odkud} /> : null}
      {s.den ? <input type="hidden" name="den" value={s.den} /> : null}
      {s.prichodId ? <input type="hidden" name="prichod_id" value={s.prichodId} /> : null}
      {s.odchodId ? <input type="hidden" name="odchod_id" value={s.odchodId} /> : null}
      {s.zpet === "prehled" ? <input type="hidden" name="zpet" value="prehled" /> : null}
    </>
  );
}

/** Výběr pobočky jen při víc pobočkách; jinak ta jediná skrytě. */
function VyberPobocky({
  name,
  pobocky,
  vychozi,
}: {
  name: string;
  pobocky: { id: string; nazev: string }[];
  vychozi: string;
}) {
  if (pobocky.length <= 1) {
    return vychozi ? <input type="hidden" name={name} value={vychozi} /> : null;
  }
  return (
    <label>
      Pobočka
      <select name={name} defaultValue={vychozi}>
        {pobocky.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nazev}
          </option>
        ))}
      </select>
    </label>
  );
}
