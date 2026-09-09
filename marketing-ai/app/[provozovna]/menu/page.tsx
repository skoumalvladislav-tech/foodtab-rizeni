import { formatDatum } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";

export const dynamic = "force-dynamic";

const DRUHY: Record<string, string> = { daily: "Denní", weekly: "Týdenní", weekend: "Víkendové", lunch3: "Polední tříchodové", special: "Speciál", seasonal: "Sezonní", drinks: "Nápojové", dessert: "Dezerty" };

export default async function MenuSeznam({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const menus = await withUser(k.session.userId, (tx) => tx.q<{ id: string; kind: string; title: string; valid_from: string | null; valid_to: string | null; status: string; source: string; n: number; review: number }>(
    `select m.id, m.kind, m.title, m.valid_from::text, m.valid_to::text, m.status, m.source,
            (select count(*)::int from marketing.menu_items i where i.menu_id = m.id) as n,
            (select count(*)::int from marketing.menu_items i where i.menu_id = m.id and (i.needs_review or i.price_cents is null)) as review
       from marketing.menus m where m.venue_id = $1 and m.status <> 'archived' order by m.valid_from desc nulls last, m.created_at desc`, [v.id]));
  return (
    <>
      <div className="hlavicka">
        <div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Menu</h1><p>Zdroj faktů pro návrhy: názvy, ceny, alergeny. AI si nic z toho nedomýšlí.</p></div>
        {muze(k, "menu.manage") && <a className="btn btn-primary" href={`/${v.slug}/menu/nove`}>＋ Nové menu / import</a>}
      </div>
      <Hlasky sp={sp} />
      {menus.length === 0 ? <div className="karta"><p className="muted">Zatím žádné menu. Zadejte ho ručně, vložte text, nebo nahrajte fotografii či PDF.</p></div> : (
        <div className="karta tabulka-obal"><table className="tabulka">
          <thead><tr><th>Druh</th><th>Název</th><th>Platnost</th><th>Položek</th><th>Stav</th><th>Zdroj</th></tr></thead>
          <tbody>{menus.map((m) => (
            <tr key={m.id}>
              <td>{DRUHY[m.kind] ?? m.kind}</td>
              <td><a href={`/${v.slug}/menu/${m.id}`}>{m.title || "(bez názvu)"}</a></td>
              <td>{m.valid_from ? formatDatum(m.valid_from) : "—"}{m.valid_to && m.valid_to !== m.valid_from ? ` – ${formatDatum(m.valid_to)}` : ""}</td>
              <td>{m.n}{m.review > 0 && <span className="stitek stitek-pozor"> {m.review} ke kontrole</span>}</td>
              <td>{m.status === "confirmed" ? <span className="stitek stitek-dobre">potvrzeno</span> : <span className="stitek stitek-pozor">koncept</span>}</td>
              <td className="faint">{m.source}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
