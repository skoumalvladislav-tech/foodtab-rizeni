import { formatDatumCas, relativne } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { hromadneAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Schvalovani({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const rows = await withUser(k.session.userId, (tx) => tx.q<{ id: string; content_item_id: string; title: string; requested_at: string; summary: string; requester: string | null; version: number; texts: Record<string, { caption: string }>; cover_asset_id: string | null; media_asset_ids: string[]; channels: string[]; scheduled_at: string | null; requested_by: string | null }>(
    `select r.id, r.content_item_id, i.title, r.requested_at, r.summary, p.display_name as requester, r.requested_by, v.version, v.texts, v.cover_asset_id, v.media_asset_ids, i.channels, i.scheduled_at
       from marketing.approval_requests r join marketing.content_items i on i.id = r.content_item_id join marketing.content_versions v on v.id = r.content_version_id
       left join marketing.profiles p on p.user_id = r.requested_by
      where r.venue_id = $1 and r.status = 'pending' order by r.requested_at`, [v.id]));
  const smi = muze(k, "content.approve");
  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Fronta ke schválení</h1><p>Schválení platí pro přesnou verzi. Vlastní žádost schválit nejde, když je k dispozici jiný schvalovatel.</p></div></div>
      <Hlasky sp={sp} />
      {rows.length === 0 ? <div className="karta"><p className="muted">Nic nečeká na schválení.</p></div> : (
        <form action={hromadneAkce}>
          <input type="hidden" name="slug" value={v.slug} />
          {smi && (
            <div className="karta btn-radek">
              <b>Hromadně vybrané:</b>
              <button className="btn btn-primary" name="decision" value="approved">Schválit vybrané</button>
              <button className="btn" name="decision" value="changes_requested">Vrátit vybrané</button>
              <input name="comment" placeholder="Společný komentář" style={{ width: 260, display: "inline-block" }} />
              <span className="faint">Před potvrzením se zobrazí souhrn: {rows.length} žádostí ve frontě.</span>
            </div>
          )}
          {rows.map((r) => (
            <section key={r.id} className="karta">
              <div style={{ display: "flex", gap: 14 }}>
                {smi && <label style={{ alignSelf: "flex-start" }}><input type="checkbox" name="req" value={r.id} disabled={r.requested_by === k.session.userId} /> <span className="sr-only">vybrat</span></label>}
                <div style={{ width: 120, flex: "none" }} className="nahled-ram">{(r.cover_asset_id ?? r.media_asset_ids[0]) ? <img src={podepsatSoubor(r.cover_asset_id ?? r.media_asset_ids[0])} alt="" /> : <div className="faint" style={{ padding: 10 }}>bez média</div>}</div>
                <div className="roste" style={{ flex: 1, minWidth: 0 }}>
                  <h3><a href={`/${v.slug}/obsah/${r.content_item_id}`}>{r.title || "Bez názvu"}</a> <span className="faint">verze {r.version}</span></h3>
                  <p className="faint">Žádá {r.requester ?? "—"} · {relativne(new Date(r.requested_at), k.tz)} · {r.channels.join(" + ")}{r.scheduled_at ? ` · plán ${formatDatumCas(new Date(r.scheduled_at), k.tz)}` : ""}{r.summary ? ` · „${r.summary}“` : ""}</p>
                  <p className="male" style={{ whiteSpace: "pre-wrap" }}>{(r.texts.instagram?.caption ?? r.texts.facebook?.caption ?? "").slice(0, 300)}</p>
                  <a className="btn btn-male" href={`/${v.slug}/obsah/${r.content_item_id}`}>Otevřít a rozhodnout</a>
                  {r.requested_by === k.session.userId && <span className="faint"> · vlastní žádost</span>}
                </div>
              </div>
            </section>
          ))}
        </form>
      )}
    </>
  );
}
