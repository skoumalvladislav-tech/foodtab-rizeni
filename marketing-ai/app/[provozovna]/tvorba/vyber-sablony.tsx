"use client";

import { useState } from "react";

interface Sablona { id: string; key: string; name: string; category: string; description: string; purpose: string; formats: string[]; inputs: unknown; organization_id: string | null }
interface Menu { id: string; title: string; kind: string; valid_from: string | null; valid_to: string | null; status: string }
interface Vstup { key: string; label: string; type: string; required?: boolean; options?: { value: string; label: string }[]; help?: string; default?: unknown }

const KATEGORIE: Record<string, string> = { menu: "Menu", akce: "Gastroakce a kampaně", prubezne: "Průběžný obsah" };

/** Výběr šablony + její vstupní pole (z JSON definice), bez znovunačtení stránky. */
export function VyberSablony({ sablony, vychozi, menu, vychoziMenu, dnes, sobota, nedele }: { sablony: Sablona[]; vychozi: string; menu: Menu[]; vychoziMenu: string; dnes: string; sobota: string; nedele: string }) {
  const [key, setKey] = useState(sablony.some((s) => s.key === vychozi) ? vychozi : (sablony[0]?.key ?? ""));
  const s = sablony.find((x) => x.key === key);
  const vstupy = ((s?.inputs as Vstup[] | null) ?? []).filter((i) => !["media", "items", "cta"].includes(i.key));
  const jeMenu = s?.category === "menu";

  return (
    <>
      <div className="pole">
        <label htmlFor="sablona">Účel / šablona</label>
        <select id="sablona" name="sablona" value={key} onChange={(e) => setKey(e.target.value)}>
          {Object.keys(KATEGORIE).map((cat) => (
            <optgroup key={cat} label={KATEGORIE[cat]}>
              {sablony.filter((x) => x.category === cat).map((x) => <option key={x.id} value={x.key}>{x.name}{x.organization_id ? " (vlastní)" : ""}</option>)}
            </optgroup>
          ))}
        </select>
        {s && <small>{s.description}</small>}
      </div>
      {jeMenu && (
        <div className="pole">
          <label htmlFor="menuId">Menu jako zdroj faktů (názvy, ceny, alergeny)</label>
          <select id="menuId" name="menuId" defaultValue={vychoziMenu}>
            <option value="">— bez menu (položky zadám ručně) —</option>
            {menu.map((m) => <option key={m.id} value={m.id}>{m.title || m.kind} {m.valid_from ? `(${m.valid_from}${m.valid_to && m.valid_to !== m.valid_from ? " – " + m.valid_to : ""})` : ""} {m.status !== "confirmed" ? "· nepotvrzené" : ""}</option>)}
          </select>
          <small>Návrhář ceny ani data nedomýšlí — bere je odtud. Nepotvrzené menu se použít nedá.</small>
        </div>
      )}
      <div className="radek radek-2">
        {vstupy.map((i) => (
          <div className="pole" key={i.key}>
            <label htmlFor={`in_${i.key}`}>{i.label}{i.required ? " *" : ""}</label>
            {i.type === "text" ? <textarea id={`in_${i.key}`} name={`in_${i.key}`} required={i.required} defaultValue={String(i.default ?? "")} />
              : i.type === "select" ? <select id={`in_${i.key}`} name={`in_${i.key}`} defaultValue={String(i.default ?? i.options?.[0]?.value ?? "")}>{i.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : i.type === "boolean" ? <label className="chip"><input type="checkbox" id={`in_${i.key}`} name={`in_${i.key}`} defaultChecked={Boolean(i.default ?? true)} /> ano</label>
              : i.type === "date" ? <input id={`in_${i.key}`} name={`in_${i.key}`} type="date" required={i.required} defaultValue={dnes} />
              : i.type === "date_range" ? <div className="radek radek-2"><input name={`in_${i.key}_from`} type="date" required={i.required} defaultValue={s?.key === "vikendove_menu" ? sobota : dnes} /><input name={`in_${i.key}_to`} type="date" defaultValue={s?.key === "vikendove_menu" ? nedele : dnes} /></div>
              : i.type === "time" ? <input id={`in_${i.key}`} name={`in_${i.key}`} type="time" required={i.required} defaultValue={String(i.default ?? "")} />
              : i.type === "price" || i.type === "number" ? <input id={`in_${i.key}`} name={`in_${i.key}`} type="number" min={0} step={1} inputMode="numeric" required={i.required} />
              : <input id={`in_${i.key}`} name={`in_${i.key}`} type="text" required={i.required} defaultValue={String(i.default ?? "")} />}
            {i.help && <small>{i.help}</small>}
          </div>
        ))}
      </div>
      {jeMenu && (
        <details>
          <summary>Položky zadat ručně (když není menu)</summary>
          <div className="pole" style={{ marginTop: 8 }}>
            <label htmlFor="items_text">Jedna položka na řádek: název – popis 189 Kč (1,3,7)</label>
            <textarea id="items_text" name="items_text" placeholder={"Hovězí vývar 45 Kč (1,3,9)\nSvíčková na smetaně – houskový knedlík 189 Kč (1,3,7)"} />
          </div>
        </details>
      )}
    </>
  );
}
