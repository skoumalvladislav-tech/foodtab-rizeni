"use client";

import { useState, useTransition } from "react";

import { presunoutAkce } from "./akce";

interface Polozka { id: string; title: string; status: string; datum: string; cas: string; channels: string[]; pillar: string; venueSlug: string; venueName: string; venueColor: string; campaign: string | null }

function dny(od: string, doD: string): string[] {
  const out: string[] = [];
  const d = new Date(od + "T00:00:00Z");
  const end = new Date(doD + "T00:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

const DNY = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

/** Měsíční/týdenní mřížka s drag-and-drop přesunem termínu (server action ověří oprávnění). */
export function Mrizka({ od, doD, pohled, dnes, slug, muzePlanovat, polozky }: { od: string; doD: string; pohled: string; dnes: string; slug: string; muzePlanovat: boolean; polozky: Polozka[] }) {
  const [pending, start] = useTransition();
  const [chyba, setChyba] = useState<string | null>(null);
  const seznam = dny(od, doD);
  // Zarovnání na pondělí u měsíce
  const first = new Date(od + "T00:00:00Z");
  const offset = pohled === "mesic" ? (first.getUTCDay() + 6) % 7 : 0;
  const pad = Array.from({ length: offset }, (_, i) => { const d = new Date(first); d.setUTCDate(d.getUTCDate() - (offset - i)); return d.toISOString().slice(0, 10); });
  const trailing = pohled === "mesic" ? (7 - ((offset + seznam.length) % 7)) % 7 : 0;
  const last = new Date(doD + "T00:00:00Z");
  const tail = Array.from({ length: trailing }, (_, i) => { const d = new Date(last); d.setUTCDate(d.getUTCDate() + i + 1); return d.toISOString().slice(0, 10); });
  const vse = [...pad.map((d) => ({ d, jiny: true })), ...seznam.map((d) => ({ d, jiny: false })), ...tail.map((d) => ({ d, jiny: true }))];

  const drop = (datum: string, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/id");
    const cas = e.dataTransfer.getData("text/cas") || "10:00";
    if (!id || !muzePlanovat) return;
    start(async () => {
      const r = await presunoutAkce({ slug, itemId: id, datum, cas });
      setChyba(r.ok ? null : r.error ?? "Přesun se nepovedl.");
    });
  };

  return (
    <div className="karta">
      {chyba && <div className="hlaska hlaska-bad">{chyba}</div>}
      {pending && <div className="faint">Přesouvám…</div>}
      <div className="kal-hlava">{DNY.map((d) => <div key={d}>{d}</div>)}</div>
      <div className="kal">
        {vse.map(({ d, jiny }) => {
          const items = polozky.filter((p) => p.datum === d);
          return (
            <div key={d} className={`den${jiny ? " jiny" : ""}${d === dnes ? " dnes" : ""}`} onDragOver={(e) => muzePlanovat && e.preventDefault()} onDrop={(e) => drop(d, e)}>
              <div className="cis" data-den={DNY[(new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7]}><span>{Number(d.slice(8, 10))}.</span>{muzePlanovat && !jiny && <a href={`/${slug}/tvorba`} className="faint" title="Vytvořit">＋</a>}</div>
              {items.map((p) => (
                <a key={p.id} href={`/${p.venueSlug}/obsah/${p.id}`} className={`pol st-${p.status.replace("publish_failed", "failed")}`} draggable={muzePlanovat} data-venue={p.venueColor}
                  onDragStart={(e) => { e.dataTransfer.setData("text/id", p.id); e.dataTransfer.setData("text/cas", p.cas); }}
                  title={`${p.cas} · ${p.title} · ${p.channels.join("+")} · ${p.pillar}${p.campaign ? " · " + p.campaign : ""} · ${p.venueName}`}>
                  <b>{p.cas}</b> {p.title || "Bez názvu"} <span className="faint">{p.channels.map((c) => c[0].toUpperCase()).join("")}</span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
