import { formatDatum } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { UPLOAD_LIMITY } from "@/lib/formaty";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import * as a from "./akce";

export const dynamic = "force-dynamic";

export default async function Media({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const f = { slozka: sp.slozka ?? "", typ: sp.typ ?? "", orientace: sp.orientace ?? "", tag: sp.tag ?? "", q: sp.q ?? "", archiv: sp.archiv === "1", sdilene: sp.sdilene === "1" };

  const data = await withUser(k.session.userId, async (tx) => {
    const slozky = await tx.q<{ id: string; key: string; name: string; venue_id: string | null; n: number }>(
      `select c.id, c.key, c.name, c.venue_id, (select count(*)::int from marketing.media_assets a where a.collection_id = c.id and a.archived_at is null) as n
         from marketing.media_collections c where c.organization_id = $1 and (c.venue_id = $2 or c.venue_id is null) order by c.venue_id nulls last, c.sort_order`, [k.organization.id, v.id]);
    const media = await tx.q<{ id: string; title: string; kind: string; mime_type: string; width: number | null; height: number | null; orientation: string | null; is_hero: boolean; created_at: string; collection_key: string | null; venue_id: string | null; archived_at: string | null; tags: string[] | null; author: string | null; license: string | null; usable_until: string | null; duration_seconds: number | null; description: string }>(
      `select a.id, a.title, a.kind, a.mime_type, a.width, a.height, a.orientation, a.is_hero, a.created_at, c.key as collection_key, a.venue_id, a.archived_at, a.author, a.license, a.usable_until::text, a.duration_seconds, a.description,
              array_remove(array_agg(t.tag), null) as tags
         from marketing.media_assets a left join marketing.media_collections c on c.id = a.collection_id left join marketing.media_tags t on t.asset_id = a.id
        where a.organization_id = $1 and (a.venue_id = $2 or ($3 and a.venue_id is null))
          and ($4 = '' or c.key = $4) and ($5 = '' or a.kind = $5) and ($6 = '' or a.orientation = $6)
          and ($7 = '' or a.title ilike '%' || $7 || '%' or a.description ilike '%' || $7 || '%')
          and (($8 and a.archived_at is not null) or (not $8 and a.archived_at is null))
        group by a.id, c.key
        having ($9 = '' or $9 = any(array_remove(array_agg(t.tag), null)))
        order by a.is_hero desc, a.created_at desc limit 200`,
      [k.organization.id, v.id, f.sdilene || f.slozka === "sdilene", f.slozka, f.typ, f.orientace, f.q, f.archiv, f.tag]);
    return { slozky, media };
  });

  return (
    <>
      <div className="hlavicka">
        <div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Mediální knihovna</h1><p>Fotografie, videa, loga a zvuky provozovny. Originál se nikdy nepřepisuje; ořezy a rendery jsou odvozené varianty.</p></div>
        {sp.zpet === "tvorba" && <a className="btn" href={`/${v.slug}/tvorba`}>← Zpět do tvorby</a>}
      </div>
      <Hlasky sp={sp} />

      {muze(k, "media.manage") && (
        <section className="karta">
          <h3>Nahrát soubory</h3>
          <form action={a.nahratAkce} encType="multipart/form-data">
            <input type="hidden" name="slug" value={v.slug} />
            <div className="radek radek-3">
              <div className="pole"><label htmlFor="soubory">Soubory (více najednou; z mobilu i fotoaparátu)</label><input id="soubory" name="soubory" type="file" multiple accept="image/*,video/*,audio/*,application/pdf" capture={undefined} required /></div>
              <div className="pole"><label htmlFor="slozka">Složka</label><select id="slozka" name="slozka" defaultValue="jidla-foto">{data.slozky.filter((s) => s.venue_id).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}{muze(k, "media.share") && <option value="sdilene">Sdílené pro všechny provozovny</option>}</select></div>
              <div className="pole"><label htmlFor="tags">Štítky (čárkou)</label><input id="tags" name="tags" placeholder="svíčková, oběd, terasa" /></div>
              <div className="pole"><label htmlFor="author">Autor</label><input id="author" name="author" placeholder="kdo fotil" /></div>
              <div className="pole"><label htmlFor="license">Licence / souhlas</label><input id="license" name="license" placeholder="vlastní foto / souhlas hosta ze dne…" /></div>
              <div className="pole"><label htmlFor="usable_until">Použitelné do</label><input id="usable_until" name="usable_until" type="date" /></div>
            </div>
            <div className="btn-radek"><button className="btn btn-primary">Nahrát</button><span className="faint">Limity: obrázek {UPLOAD_LIMITY.imageMaxMb} MB, video {UPLOAD_LIMITY.videoMaxMb} MB (přes formulář do 60 MB), min. šířka {UPLOAD_LIMITY.minImageWidth} px. Duplicity se poznají podle otisku souboru.</span></div>
          </form>
        </section>
      )}

      <form className="karta" method="get">
        <div className="chip-radek" style={{ marginBottom: 10 }}>
          <a className={`chip${!f.slozka ? " on" : ""}`} href={`/${v.slug}/media`}>Vše</a>
          {data.slozky.map((s) => <a key={s.id} className={`chip${f.slozka === s.key ? " on" : ""}`} href={`/${v.slug}/media?slozka=${s.key}`}>{s.name} <span className="faint">{s.n}</span></a>)}
          <a className={`chip${f.archiv ? " on" : ""}`} href={`/${v.slug}/media?archiv=1`}>Archiv</a>
        </div>
        <div className="radek radek-3">
          <select name="typ" defaultValue={f.typ}><option value="">Všechny typy</option><option value="image">Fotografie</option><option value="video">Videa</option><option value="audio">Zvuk</option><option value="document">Dokumenty</option><option value="render">Rendery</option></select>
          <select name="orientace" defaultValue={f.orientace}><option value="">Orientace</option><option value="portrait">Na výšku</option><option value="landscape">Na šířku</option><option value="square">Čtverec</option></select>
          <input name="q" placeholder="Hledat v názvu a popisu" defaultValue={f.q} />
          <input name="tag" placeholder="Štítek (jídlo, akce, kampaň…)" defaultValue={f.tag} />
          <label className="chip"><input type="checkbox" name="sdilene" value="1" defaultChecked={f.sdilene} /> včetně sdílených</label>
          <button className="btn btn-male">Filtrovat</button>
        </div>
      </form>

      {data.media.length === 0 ? <p className="muted">Nic tu není.</p> : (
        <div className="media-mrizka">
          {data.media.map((m) => (
            <div key={m.id} className="media-karta" style={{ aspectRatio: "auto" }}>
              <a href={`/${v.slug}/media/${m.id}`} style={{ display: "block", aspectRatio: "4 / 5", background: "var(--sunken)" }}>
                {m.kind === "video" ? <video src={podepsatSoubor(m.id)} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.kind === "audio" || m.kind === "document" ? <div style={{ padding: 20, textAlign: "center" }}>{m.kind === "audio" ? "🎵" : "📄"}<br /><small>{m.title}</small></div> : <img src={podepsatSoubor(m.id)} alt={m.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </a>
              {m.is_hero && <span className="stitek stitek-mosaz hero">hero</span>}
              {m.venue_id === null && <span className="stitek stitek-info hero" style={{ top: m.is_hero ? 32 : 6 }}>sdílené</span>}
              <div className="popisek" style={{ position: "static", background: "var(--card)", color: "var(--ink)" }}>
                <b>{m.title}</b><br />
                <span className="faint">{m.width && m.height ? `${m.width}×${m.height}` : m.kind}{m.duration_seconds ? ` · ${Math.round(m.duration_seconds)} s` : ""} · {formatDatum(new Date(m.created_at), k.tz)}</span>
                {m.tags && m.tags.length > 0 && <div className="faint">{m.tags.map((t) => "#" + t).join(" ")}</div>}
                {m.usable_until && new Date(m.usable_until) < new Date() && <div className="stitek stitek-bad">prošlá licence</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
