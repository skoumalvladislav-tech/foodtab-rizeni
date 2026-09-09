import { formatDatumCas } from "@/lib/cas";
import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Shell } from "../shell";
import { precteneAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Upozorneni() {
  const k = await nacistKontext(null);
  const rows = await withUser(k.session.userId, (tx) => tx.q<{ id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }>(
    "select id, kind, title, body, link, read_at, created_at from marketing.notifications where user_id = $1 order by created_at desc limit 100", [k.session.userId]));
  return (
    <Shell k={k}>
      <div className="hlavicka"><div><h1>Upozornění</h1><p>Žádosti o schválení, vrácení, schválení, selhání publikace.</p></div>
        <form action={precteneAkce}><button className="btn btn-male">Označit vše jako přečtené</button></form></div>
      {rows.length === 0 ? <div className="karta"><p className="muted">Žádná upozornění.</p></div> : (
        <ul className="seznam karta">{rows.map((n) => (
          <li key={n.id} style={{ fontWeight: n.read_at ? 400 : 600 }}><div className="roste"><b>{n.link ? <a href={n.link}>{n.title}</a> : n.title}</b><span className="faint" style={{ fontWeight: 400 }}>{n.body} · {formatDatumCas(new Date(n.created_at), k.tz)}</span></div>{!n.read_at && <span className="stitek stitek-pozor">nové</span>}</li>
        ))}</ul>
      )}
    </Shell>
  );
}
