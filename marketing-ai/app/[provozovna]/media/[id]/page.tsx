import { notFound } from "next/navigation";

import { formatDatumCas } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky } from "../../../ui";
import * as a from "../akce";

export const dynamic = "force-dynamic";

export default async function MediumDetail({ params, searchParams }: { params: Promise<{ provozovna: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna, id } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const m = await tx.one<{ id: string; title: string; description: string; kind: string; mime_type: string; width: number | null; height: number | null; size_bytes: number; sha256: string | null; is_hero: boolean; author: string | null; license: string | null; consent_note: string | null; usable_until: string | null; created_at: string; archived_at: string | null; venue_id: string | null; collection_key: string | null; derived_from_asset_id: string | null; ai_generated: boolean; ai_edited: boolean; uploader: string | null; tags: string[] | null; ai_description: string | null }>(
      `select a.*, c.key as collection_key, p.display_name as uploader, array_remove(array_agg(t.tag), null) as tags
         from marketing.media_assets a left join marketing.media_collections c on c.id = a.collection_id left join marketing.profiles p on p.user_id = a.uploaded_by left join marketing.media_tags t on t.asset_id = a.id
        where a.id = $1 and a.organization_id = $2 group by a.id, c.key, p.display_name`, [id, k.organization.id]);
    if (!m) return null;
    const slozky = await tx.q<{ key: string; name: string }>("select key, name from marketing.media_collections where organization_id = $1 and venue_id is not distinct from $2 order by sort_order", [k.organization.id, m.venue_id]);
    const odvozene = await tx.q<{ id: string; title: string; kind: string }>("select id, title, kind from marketing.media_assets where derived_from_asset_id = $1 order by created_at desc", [id]);
    const pouziti = await tx.q<{ id: string; title: string; status: string }>("select distinct i.id, i.title, i.status from marketing.content_versions cv join marketing.content_items i on i.id = cv.content_item_id where $1 = any(cv.media_asset_ids) and i.venue_id = $2 limit 20", [id, v.id]);
    return { m, slozky, odvozene, pouziti, venues: k.venues };
  });
  if (!data) notFound();
  const { m, slozky, odvozene, pouziti } = data;
  const url = podepsatSoubor(m.id);
  const muzeSpravovat = muze(k, "media.manage");

  return (
    <>
      <div className="hlavicka"><div><a className="faint" href={`/${v.slug}/media`}>← Mediální knihovna</a><h1>{m.title}</h1></div>
        <a className="btn" href={`${url}&stahnout=1`}>Stáhnout originál</a></div>
      <Hlasky sp={sp} />
      <div className="mrizka mrizka-2">
        <div className="nahled-ram">
          {m.kind === "video" ? <video src={url} controls style={{ width: "100%" }} /> : m.kind === "audio" ? <audio src={url} controls style={{ width: "100%" }} /> : m.kind === "document" ? <iframe src={url} style={{ width: "100%", height: 500, border: 0 }} title={m.title} /> : <img src={url} alt={m.title} />}
          <div className="nahled-popis">{m.mime_type} · {(m.size_bytes / 1024 / 1024).toFixed(2)} MB{m.width ? ` · ${m.width}×${m.height}` : ""} · nahrál {m.uploader ?? "—"} {formatDatumCas(new Date(m.created_at), k.tz)}{m.sha256 ? ` · otisk ${m.sha256.slice(0, 10)}` : ""}
            {m.ai_generated && <span className="stitek stitek-info"> AI generováno</span>}{m.ai_edited && <span className="stitek stitek-info"> AI/automaticky upraveno</span>}
            {m.derived_from_asset_id && <div><a href={`/${v.slug}/media/${m.derived_from_asset_id}`}>Odvozeno z originálu</a></div>}
            {m.ai_description && <div className="faint">AI popis: {m.ai_description}</div>}</div>
        </div>
        <div className="karta">
          {muzeSpravovat ? (
            <form action={a.upravitAkce}>
              <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={m.id} />
              <div className="pole"><label htmlFor="title">Název</label><input id="title" name="title" defaultValue={m.title} /></div>
              <div className="pole"><label htmlFor="description">Popis obsahu</label><textarea id="description" name="description" defaultValue={m.description} /></div>
              <div className="pole"><label htmlFor="slozka">Složka</label><select id="slozka" name="slozka" defaultValue={m.collection_key ?? ""}><option value="">—</option>{slozky.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></div>
              <div className="pole"><label htmlFor="tags">Štítky</label><input id="tags" name="tags" defaultValue={(m.tags ?? []).join(", ")} /></div>
              <div className="radek radek-2">
                <div className="pole"><label htmlFor="author">Autor</label><input id="author" name="author" defaultValue={m.author ?? ""} /></div>
                <div className="pole"><label htmlFor="license">Licence / souhlas</label><input id="license" name="license" defaultValue={m.license ?? ""} /></div>
                <div className="pole"><label htmlFor="consent">Poznámka k souhlasu (hosté, personál)</label><input id="consent" name="consent" defaultValue={m.consent_note ?? ""} /></div>
                <div className="pole"><label htmlFor="usable_until">Použitelné do</label><input id="usable_until" name="usable_until" type="date" defaultValue={m.usable_until ?? ""} /></div>
              </div>
              <div className="btn-radek">
                <button className="btn btn-primary">Uložit</button>
                <button className="btn" name="hero" value={m.is_hero ? "0" : "1"}>{m.is_hero ? "Zrušit hero" : "Označit jako hero"}</button>
                <button className="btn btn-tiche" name="archiv" value={m.archived_at ? "0" : "1"}>{m.archived_at ? "Obnovit z archivu" : "Archivovat"}</button>
              </div>
            </form>
          ) : <p className="muted">{m.description}</p>}
          {muze(k, "media.share") && (
            <form action={a.presunoutAkce} style={{ marginTop: 16 }}>
              <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={m.id} />
              <h3>Přesunout nebo sdílet</h3>
              <div className="radek radek-3">
                <select name="cil" defaultValue=""><option value="">Sdílené pro všechny provozovny</option>{k.venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <label className="chip"><input type="checkbox" name="kopie" value="1" defaultChecked /> jako kopii (originál zůstane)</label>
                <button className="btn btn-male">Provést</button>
              </div>
            </form>
          )}
          {odvozene.length > 0 && <><h3 style={{ marginTop: 16 }}>Odvozené varianty</h3><ul className="seznam">{odvozene.map((o) => <li key={o.id}><a href={`/${v.slug}/media/${o.id}`}>{o.title}</a> <span className="faint">{o.kind}</span></li>)}</ul></>}
          {pouziti.length > 0 && <><h3 style={{ marginTop: 16 }}>Použito v obsahu</h3><ul className="seznam">{pouziti.map((o) => <li key={o.id}><a href={`/${v.slug}/obsah/${o.id}`}>{o.title || "Bez názvu"}</a> <span className="faint">{o.status}</span></li>)}</ul></>}
        </div>
      </div>
    </>
  );
}
