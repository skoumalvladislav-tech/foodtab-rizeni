"use client";

import { useRef, useState } from "react";

import { DNY_TYDNE, NAZVY_ROZVRHU, ROZVRHY } from "../../checklisty/spolecne";

/**
 * Formulář šablony checklistu — nová i úprava existující (zadání bod 25).
 *
 * Řádky položek se přidávají, odebírají a posouvají šipkami nahoru/dolů
 * (drag & drop knihovna v projektu není a šipky fungují i na telefonu
 * a z klávesnice). Pořadí na obrazovce = pořadí v šabloně: jména polí
 * (`polozka-N-*`) se počítají z pozice při každém vykreslení.
 *
 * Odebraná EXISTUJÍCÍ položka se v databázi jen vyřadí — na položku
 * mohou odkazovat hotové běhy a jejich historie se nesmí změnit
 * (upravit_sablonu_checklistu). Nová verze šablony vznikne sama.
 */

export type RadekFormulare = {
  id: string | null;
  nazev: string;
  sekce: string;
  instrukce: string;
  povinna: boolean;
  vyzaduje: boolean;
  typ: "number" | "text" | "photo";
  jednotka: string;
  min: string;
  max: string;
};

export type HodnotySablony = {
  nazev: string;
  usek: string | null;
  rozvrh: string;
  dny: number[];
  potvrzeni: boolean;
  aktivni: boolean;
  polozky: RadekFormulare[];
};

const prazdnyRadek = (): RadekFormulare => ({
  id: null,
  nazev: "",
  sekce: "",
  instrukce: "",
  povinna: true,
  vyzaduje: false,
  typ: "number",
  jednotka: "",
  min: "",
  max: "",
});

export default function FormularSablony({
  akce,
  rozsah,
  useky,
  chyba,
  sablonaId,
  vychozi,
  plne,
}: {
  akce: (formData: FormData) => void | Promise<void>;
  rozsah: string;
  useky: { id: string; nazev: string }[];
  chyba?: string | null;
  /** null = nová šablona. */
  sablonaId?: string | null;
  vychozi?: HodnotySablony;
  /** Migrace nasazená — sekce, instrukce, povinnost, nové rozvrhy. */
  plne: boolean;
}) {
  const citac = useRef(0);
  const novyKlic = () => `r${++citac.current}`;
  const [radky, setRadky] = useState<(RadekFormulare & { klic: string })[]>(() => {
    const zaklad = vychozi?.polozky.length ? vychozi.polozky : [prazdnyRadek(), prazdnyRadek(), prazdnyRadek()];
    return zaklad.map((r, i) => ({ ...r, klic: `v${i}` }));
  });

  const posun = (i: number, smer: -1 | 1) =>
    setRadky((r) => {
      const j = i + smer;
      if (j < 0 || j >= r.length) return r;
      const kopie = [...r];
      [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
      return kopie;
    });
  const odebrat = (i: number) => setRadky((r) => r.filter((_, k) => k !== i));
  const pridat = () => setRadky((r) => [...r, { ...prazdnyRadek(), klic: novyKlic() }]);

  const rozvrhy = plne ? ROZVRHY : ["opening", "closing", "haccp", "weekly"];

  return (
    <div>
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ marginBottom: "16px" }}>
          {chyba}
        </p>
      ) : null}

      <form action={akce} className="ck-editor">
        <input type="hidden" name="rozsah" value={rozsah} />
        {sablonaId ? <input type="hidden" name="sablona" value={sablonaId} /> : null}
        <input type="hidden" name="pocetRadku" value={radky.length} />

        <section className="ds-plocha" style={{ display: "grid", gap: "12px" }}>
          <label>
            <span className="ck-popisek">Název</span>
            <input type="text" name="nazev" required maxLength={200} defaultValue={vychozi?.nazev ?? ""} placeholder="např. Zavírací checklist kuchyně" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            <label>
              <span className="ck-popisek">Úsek</span>
              <select name="usek" defaultValue={vychozi?.usek ?? ""}>
                <option value="">— bez úseku —</option>
                {useky.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nazev}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ck-popisek">Kdy se dělá</span>
              <select name="rozvrh" defaultValue={vychozi?.rozvrh ?? (plne ? "daily" : "opening")}>
                {rozvrhy.map((r) => (
                  <option key={r} value={r}>
                    {NAZVY_ROZVRHU[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {plne ? (
            <>
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="ck-popisek">Dny v týdnu (jen u „Týdenní“ a „Vybrané dny“)</legend>
                <div className="ck-dny">
                  {DNY_TYDNE.map(([cislo, zkratka]) => (
                    <label key={cislo}>
                      <input type="checkbox" name="dny" value={cislo} defaultChecked={vychozi?.dny.includes(cislo) ?? false} />
                      {zkratka}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="ck-poznamka-dole" style={{ margin: 0 }}>
                Denní, otevírací, zavírací a HACCP checklisty se každý provozní den založí samy. „Každá směna“ a
                „Ručně“ se spouštějí tlačítkem — automatické přiřazení podle směny zatím není (chybí vazba směny na
                úsek).
              </p>
              <label className="ck-volba">
                <input type="checkbox" name="potvrzeni" defaultChecked={vychozi?.potvrzeni ?? false} />
                Vyžaduje potvrzení vedoucím (dvojí kontrola — pokladna, bezpečnost, kritické HACCP)
              </label>
            </>
          ) : null}
          {sablonaId ? (
            <label className="ck-volba">
              <input type="checkbox" name="aktivni" defaultChecked={vychozi?.aktivni ?? true} />
              Aktivní (vyřazená šablona se nenabízí a nezakládá, historie zůstává)
            </label>
          ) : null}
        </section>

        <section style={{ display: "grid", gap: "10px" }} aria-label="Položky">
          <h2 style={{ margin: 0, fontSize: "19px" }}>Položky</h2>
          {radky.map((r, i) => (
            <div key={r.klic} className="ck-editor-radek">
              {r.id ? <input type="hidden" name={`polozka-${i}-id`} value={r.id} /> : null}
              <div className="ck-editor-hlava">
                <span aria-hidden="true" style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", minWidth: "22px" }}>
                  {i + 1}.
                </span>
                <input
                  type="text"
                  name={`polozka-${i}-nazev`}
                  defaultValue={r.nazev}
                  maxLength={200}
                  placeholder="Např. Zkontrolovat lednice"
                  aria-label={`Položka ${i + 1} — název`}
                />
                <span className="ck-editor-poradi">
                  <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => posun(i, -1)} disabled={i === 0} aria-label={`Posunout položku ${i + 1} nahoru`}>
                    ↑
                  </button>
                  <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => posun(i, 1)} disabled={i === radky.length - 1} aria-label={`Posunout položku ${i + 1} dolů`}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ft-tl ft-tl-vedlejsi ft-tl-male"
                    onClick={() => odebrat(i)}
                    aria-label={r.id ? `Vyřadit položku ${i + 1}` : `Odebrat položku ${i + 1}`}
                    title={r.id ? "Vyřadí se — v historii hotových checklistů zůstane" : "Odebrat"}
                  >
                    ✕
                  </button>
                </span>
              </div>

              {plne ? (
                <div className="ck-editor-volby">
                  <input type="text" name={`polozka-${i}-sekce`} defaultValue={r.sekce} maxLength={80} placeholder="Sekce (např. Kuchyň)" aria-label={`Položka ${i + 1} — sekce`} />
                  <label className="ck-volba">
                    <input type="hidden" name={`polozka-${i}-povinna-pole`} value="1" />
                    <input type="checkbox" name={`polozka-${i}-povinna`} defaultChecked={r.povinna} />
                    Povinná
                  </label>
                </div>
              ) : null}

              <div className="ck-editor-volby">
                <label className="ck-volba">
                  <input type="checkbox" name={`polozka-${i}-vyzaduje`} defaultChecked={r.vyzaduje} />
                  Chce hodnotu
                </label>
                <select name={`polozka-${i}-typ`} defaultValue={r.typ} aria-label={`Položka ${i + 1} — typ hodnoty`}>
                  <option value="number">Číslo / teplota</option>
                  <option value="text">Text</option>
                  <option value="photo">Fotka (povinná)</option>
                </select>
                <input type="text" name={`polozka-${i}-jednotka`} defaultValue={r.jednotka} maxLength={20} placeholder="jednotka, např. °C" aria-label={`Položka ${i + 1} — jednotka`} />
                <input type="text" name={`polozka-${i}-min`} defaultValue={r.min} inputMode="decimal" placeholder="min" aria-label={`Položka ${i + 1} — minimum`} />
                <input type="text" name={`polozka-${i}-max`} defaultValue={r.max} inputMode="decimal" placeholder="max" aria-label={`Položka ${i + 1} — maximum`} />
              </div>

              {plne ? (
                <textarea
                  name={`polozka-${i}-instrukce`}
                  defaultValue={r.instrukce}
                  maxLength={1000}
                  rows={2}
                  placeholder="Krátká instrukce (nepovinné), např. Změř teplotu prostřední lednice."
                  aria-label={`Položka ${i + 1} — instrukce`}
                />
              ) : null}
            </div>
          ))}
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={pridat}>
            + Přidat položku
          </button>
          <p className="ck-poznamka-dole" style={{ margin: 0 }}>
            Meze platí pro číslo (teplota apod.) — hodnota mimo ně se v checklistu neuloží a je potřeba nahlásit
            problém. Legislativní limity sem nikdo nevpisuje za vás: nastavte si je podle svého HACCP plánu.
          </p>
        </section>

        <button type="submit" className="ft-tl ft-tl-hlavni" style={{ width: "100%" }}>
          {sablonaId ? "Uložit šablonu" : "Vytvořit checklist"}
        </button>
      </form>
    </div>
  );
}
