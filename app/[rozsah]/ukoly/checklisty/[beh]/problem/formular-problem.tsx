import Link from "next/link";
import type { ReactNode } from "react";

import TlacitkoOdeslat from "../../../../vzkazy/tlacitko-odeslat";

/**
 * Formulář „Nahlásit problém" — jen vykreslení (mockup, obrazovka 4).
 *
 * Z problému vznikne ÚKOL — samostatná věc s vazbou na běh a položku,
 * checklist se tím nemění (zadání bod 2 a 13). Předvyplní se, co appka
 * ví: název podle položky, adresát = odpovědný za běh („přiřadí se
 * odpovědné osobě"). Pobočku a checklist bere databáze z běhu.
 *
 * Priorita „Kritická" existuje JEN tady (Šéfík 23. 9.) — obecné zadání
 * úkolu ji nemá a databáze ji mimo checklist nepustí.
 */
export default function FormularProblem({
  akce,
  rozsah,
  beh,
  checklistNazev,
  polozka,
  odpovedny,
  chyba,
  lide,
  useky,
  pozice,
  zpet,
  kritickaDostupna,
  fotky,
}: {
  akce: (formData: FormData) => void | Promise<void>;
  rozsah: string;
  beh: string;
  checklistNazev: string;
  polozka: { id: string; label: string } | null;
  /** Odpovědný za běh — výchozí adresát úkolu. */
  odpovedny: { id: string; jmeno: string } | null;
  chyba?: string | null;
  lide: { employee_id: string; jmeno: string }[];
  useky: [string, string][];
  pozice: [string, string][];
  zpet: string;
  kritickaDostupna: boolean;
  /** Fotky k položce (nahrávání) — úkol na položku odkazuje, takže je u něj uvidí i řešitel. */
  fotky?: ReactNode;
}) {
  return (
    <section className="ds-plocha" style={{ maxWidth: "720px" }}>
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: "0 0 14px" }}>
          {chyba}
        </p>
      ) : null}

      <p
        style={{
          margin: "0 0 16px", padding: "10px 14px", borderLeft: "3px solid var(--line-2)",
          background: "var(--sunken)", borderRadius: "0 10px 10px 0", fontSize: "14px", lineHeight: 1.5,
        }}
      >
        <span style={{ display: "block", fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>Checklist</span>
        {checklistNazev}
        {polozka ? <> — položka „{polozka.label}“</> : null}
      </p>

      <form action={akce} className="pc-formular">
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="beh" value={beh} />
        {polozka ? <input type="hidden" name="polozka" value={polozka.id} /> : null}

        <div>
          <label htmlFor="pr-co">Co je špatně?</label>
          <textarea
            id="pr-co"
            name="poznamka"
            required
            maxLength={1000}
            placeholder="Např. Zámek na zahrádce je poškozený, nejde zamknout."
          />
        </div>

        {fotky ? (
          <div>
            <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--muted)" }}>
              Fotografie (k položce — úkol na ni odkazuje)
            </p>
            {fotky}
          </div>
        ) : null}

        <div>
          <label htmlFor="pr-nazev">Název úkolu</label>
          <input
            id="pr-nazev"
            type="text"
            name="nazev"
            maxLength={120}
            defaultValue={polozka ? `Vyřešit: ${polozka.label}` : ""}
            placeholder="Když zůstane prázdný, použije se začátek popisu."
          />
        </div>

        <fieldset>
          <legend>Priorita</legend>
          <div className="ck-priority">
            <label>
              <input type="radio" name="priorita" value="normal" defaultChecked /> Běžná
            </label>
            <label>
              <input type="radio" name="priorita" value="high" /> Důležitá
            </label>
            {kritickaDostupna ? (
              <label>
                <input type="radio" name="priorita" value="critical" /> Kritická
              </label>
            ) : null}
          </div>
          {kritickaDostupna ? (
            <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
              Kritická obchází tichý režim — adresát dostane upozornění hned, i mimo směnu.
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Komu</legend>
          <label className="pc-volba">
            <input type="radio" name="komu" value="clovek" defaultChecked={odpovedny !== null} /> Člověku
          </label>
          <select name="clovek" aria-label="Člověk" defaultValue={odpovedny?.id ?? ""}>
            <option value="">— vyberte —</option>
            {lide.map((c) => (
              <option key={c.employee_id} value={c.employee_id}>
                {c.jmeno}
              </option>
            ))}
          </select>
          <label className="pc-volba" style={{ marginTop: "8px" }}>
            <input type="radio" name="komu" value="usek" /> Úseku
          </label>
          <select name="usek" aria-label="Úsek" defaultValue="">
            <option value="">— vyberte —</option>
            {useky.map(([id, nazev]) => (
              <option key={id} value={id}>
                {nazev}
              </option>
            ))}
          </select>
          <label className="pc-volba" style={{ marginTop: "8px" }}>
            <input type="radio" name="komu" value="pozice" /> Zařazení
          </label>
          <select name="pozice" aria-label="Zařazení" defaultValue="">
            <option value="">— vyberte —</option>
            {pozice.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label className="pc-volba" style={{ marginTop: "8px" }}>
            <input type="radio" name="komu" value="pobocka" defaultChecked={odpovedny === null} /> Nikomu konkrétnímu
            (celá pobočka)
          </label>
        </fieldset>

        <div>
          <div className="pc-dvojice">
            <div>
              <label htmlFor="pr-den">Termín — den</label>
              <input id="pr-den" type="date" name="termin_datum" />
            </div>
            <div>
              <label htmlFor="pr-cas">Čas (nepovinný)</label>
              <input id="pr-cas" type="time" name="termin_cas" />
            </div>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
            Bez času platí úkol do konce zvoleného dne.
          </p>
        </div>

        <p className="pc-poznamka-navrhu" style={{ margin: 0 }}>
          Z problému vznikne úkol{odpovedny ? `, přiřazený ${odpovedny.jmeno}` : ""}. Checklist ho uvidí v záložce
          Související a úkol odkazuje zpět na {polozka ? "položku" : "checklist"}.
        </p>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Zakládám…">
            Vytvořit úkol
          </TlacitkoOdeslat>
          <Link href={zpet} className="ft-tl ft-tl-vedlejsi">
            Zrušit
          </Link>
        </div>
      </form>
    </section>
  );
}
