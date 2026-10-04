"use client";

import { useRef, useState } from "react";

import type { KatalogSurovina, RadekSuroviny } from "./spolecne";

/**
 * Formulář receptury — nová i úprava existující.
 *
 * Řádky surovin se přidávají, odebírají a posouvají šipkami nahoru/dolů
 * — stejný vzor jako šablony checklistů
 * (ukoly/sablona/nova/formular-sablony.tsx): v projektu není knihovna
 * na drag & drop a šipky fungují i na telefonu a z klávesnice. Jména
 * polí (`polozka-N-*`) se počítají z pozice při každém vykreslení
 * (skryté pole `pocetRadku`).
 *
 * Každý řádek je buď surovina z katalogu (vybere se v rozbalovátku,
 * jednotka se při výběru předvyplní z ingredients.base_unit, ale smí
 * se přepsat — nesedící jednotka je ZÁMĚR, přepočet nákladu ji nahlásí
 * jako neúplnou, ne jako bug), nebo volný text (surovina ještě není
 * v katalogu).
 *
 * Alergeny v týhle verzi CHYBÍ ZÁMĚRNĚ: recipes.allergens je
 * smallint[], ale v repozitáři nikde neexistuje mapování čísla na
 * název alergenu — marketing modul pracuje jen s volným textem/čísly
 * z OCR cizích jídelních lístků, ne s vlastním číselníkem. Vymýšlet si
 * tu vlastní číslování by se mohlo rozejít s budoucím modulem, který
 * ho jednou přinese.
 */

const prazdnyRadek = (): RadekSuroviny => ({
  id: null,
  ingredientId: null,
  name: "",
  amount: "",
  unit: "",
  note: "",
});

export type HodnotyReceptury = {
  nazev: string;
  kategorie: string;
  /** "jidlo" | "napoj" — appka na tomhle rozlišuje foodcost % od beverage cost % (Finance → Přehled). */
  druh?: string;
  porce: string;
  instrukce: string;
  aktivni: boolean;
  radky: RadekSuroviny[];
};

export default function FormularReceptury({
  akce,
  rozsah,
  katalog,
  chyba,
  receptId,
  vychozi,
}: {
  akce: (formData: FormData) => void | Promise<void>;
  rozsah: string;
  katalog: KatalogSurovina[];
  chyba?: string | null;
  /** null/chybí = nová receptura. */
  receptId?: string | null;
  vychozi?: HodnotyReceptury;
}) {
  const citac = useRef(0);
  const novyKlic = () => `r${++citac.current}`;
  const [radky, setRadky] = useState<(RadekSuroviny & { klic: string })[]>(() => {
    const zaklad = vychozi?.radky.length ? vychozi.radky : [prazdnyRadek(), prazdnyRadek(), prazdnyRadek()];
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
  const upravit = (i: number, zmena: Partial<RadekSuroviny>) =>
    setRadky((r) => r.map((radek, k) => (k === i ? { ...radek, ...zmena } : radek)));

  const vybratSurovinu = (i: number, ingredientId: string) => {
    const surovina = katalog.find((s) => s.id === ingredientId);
    upravit(i, {
      ingredientId: ingredientId || null,
      name: surovina ? surovina.name : "",
      unit: surovina ? surovina.base_unit : "",
    });
  };

  return (
    <div>
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ marginBottom: "16px" }}>
          {chyba}
        </p>
      ) : null}

      <form action={akce} className="ck-editor">
        <input type="hidden" name="rozsah" value={rozsah} />
        {receptId ? <input type="hidden" name="recept" value={receptId} /> : null}
        <input type="hidden" name="pocetRadku" value={radky.length} />

        <section className="ds-plocha" style={{ display: "grid", gap: "12px" }}>
          <label>
            <span className="ck-popisek">Název</span>
            <input type="text" name="nazev" required maxLength={200} defaultValue={vychozi?.nazev ?? ""} placeholder="např. Svíčková na smetaně" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
            <label>
              <span className="ck-popisek">Kategorie</span>
              <input type="text" name="kategorie" maxLength={100} defaultValue={vychozi?.kategorie ?? ""} placeholder="např. Hlavní jídlo" />
            </label>
            <label>
              <span className="ck-popisek">Počet porcí</span>
              <input type="number" name="porce" min={1} max={999} step={1} defaultValue={vychozi?.porce ?? "1"} />
            </label>
            <label>
              <span className="ck-popisek">Druh</span>
              <select name="druh" defaultValue={vychozi?.druh ?? "jidlo"}>
                <option value="jidlo">Jídlo</option>
                <option value="napoj">Nápoj</option>
              </select>
            </label>
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
            Druh rozhoduje, jestli se náklad téhle receptury počítá do foodcostu, nebo do beverage costu (Finance → Přehled).
          </p>

          <label>
            <span className="ck-popisek">Instrukce</span>
            <textarea name="instrukce" rows={5} maxLength={5000} defaultValue={vychozi?.instrukce ?? ""} placeholder="Postup přípravy (nepovinné)." />
          </label>

          {receptId ? (
            <label className="ck-volba">
              <input type="checkbox" name="aktivni" defaultChecked={vychozi?.aktivni ?? true} />
              Aktivní (vyřazená receptura se v seznamu nenabízí)
            </label>
          ) : null}
        </section>

        <section style={{ display: "grid", gap: "10px" }} aria-label="Suroviny">
          <h2 style={{ margin: 0, fontSize: "19px" }}>Suroviny</h2>
          {radky.map((r, i) => {
            const vybrana = katalog.find((s) => s.id === r.ingredientId);
            const jednotkaNesedi = Boolean(vybrana && r.unit && vybrana.base_unit !== r.unit);
            return (
              <div key={r.klic} className="ck-editor-radek">
                {r.id ? <input type="hidden" name={`polozka-${i}-id`} value={r.id} /> : null}
                <div className="ck-editor-hlava">
                  <span aria-hidden="true" style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", minWidth: "22px" }}>
                    {i + 1}.
                  </span>
                  <select
                    name={`polozka-${i}-surovina`}
                    value={r.ingredientId ?? ""}
                    onChange={(e) => vybratSurovinu(i, e.target.value)}
                    aria-label={`Položka ${i + 1} — surovina z katalogu`}
                  >
                    <option value="">— volný text —</option>
                    {katalog.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.base_unit})
                      </option>
                    ))}
                  </select>
                  <span className="ck-editor-poradi">
                    <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => posun(i, -1)} disabled={i === 0} aria-label={`Posunout položku ${i + 1} nahoru`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ft-tl ft-tl-vedlejsi ft-tl-male"
                      onClick={() => posun(i, 1)}
                      disabled={i === radky.length - 1}
                      aria-label={`Posunout položku ${i + 1} dolů`}
                    >
                      ↓
                    </button>
                    <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => odebrat(i)} aria-label={`Odebrat položku ${i + 1}`}>
                      ✕
                    </button>
                  </span>
                </div>

                <div className="ck-editor-volby">
                  <input
                    type="text"
                    name={`polozka-${i}-nazev`}
                    value={r.name}
                    onChange={(e) => upravit(i, { name: e.target.value })}
                    maxLength={200}
                    placeholder="Název (např. Hovězí zadní)"
                    aria-label={`Položka ${i + 1} — název`}
                  />
                  <input
                    type="text"
                    name={`polozka-${i}-mnozstvi`}
                    value={r.amount}
                    onChange={(e) => upravit(i, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="množství"
                    aria-label={`Položka ${i + 1} — množství`}
                  />
                  <input
                    type="text"
                    name={`polozka-${i}-jednotka`}
                    value={r.unit}
                    onChange={(e) => upravit(i, { unit: e.target.value })}
                    maxLength={20}
                    placeholder="jednotka"
                    aria-label={`Položka ${i + 1} — jednotka`}
                  />
                </div>
                <input
                  type="text"
                  name={`polozka-${i}-poznamka`}
                  defaultValue={r.note}
                  maxLength={500}
                  placeholder="Poznámka (nepovinné)"
                  aria-label={`Položka ${i + 1} — poznámka`}
                />
                {jednotkaNesedi ? (
                  <p className="ck-poznamka-dole" style={{ margin: 0, color: "var(--pozor)" }}>
                    Jednotka „{r.unit}“ neodpovídá základní jednotce téhle suroviny v katalogu ({vybrana?.base_unit}) — do nákladu se
                    nezapočítá, jen se nahlásí jako neúplná.
                  </p>
                ) : null}
              </div>
            );
          })}
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={pridat}>
            + Přidat surovinu
          </button>
          <p className="ck-poznamka-dole" style={{ margin: 0 }}>
            Prázdné řádky (bez názvu) se při uložení přeskočí.
          </p>
        </section>

        <button type="submit" className="ft-tl ft-tl-hlavni" style={{ width: "100%" }}>
          {receptId ? "Uložit recepturu" : "Vytvořit recepturu"}
        </button>
      </form>
    </div>
  );
}
