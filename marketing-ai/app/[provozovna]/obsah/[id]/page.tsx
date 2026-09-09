import { notFound } from "next/navigation";

import { casVPasmu, datumVPasmu, formatDatumCas, posunDne, dnes } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { kontrolaPredSchvalenim } from "@/lib/domena/obsah";
import type { AiNavrh } from "@/lib/providers/ai/schema";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky, Stav, StavPublikace, StavRenderu } from "../../../ui";
import { Kontext } from "../../kontext";
import * as a from "./akce";

export const dynamic = "force-dynamic";

interface Item {
  id: string; title: string; status: string; purpose: string; pillar: string; channels: string[]; scheduled_at: string | null; menu_id: string | null; template_id: string | null;
  current_version_id: string | null; approved_version_id: string | null; created_by_name: string | null; created_at: string; campaign_name: string | null; template_name: string | null;
}
interface Verze { id: string; version: number; brief: string; inputs: Record<string, unknown>; ai_proposal: AiNavrh | null; selected_variant_key: string | null; texts: Record<string, { caption: string; hashtags: string[]; cta: string; hook?: string }>; storyboard: { poradi: number; druh: string; sekundy: number; mediaAssetId: string | null; textVObraze: string; titulek: string }[] | null; media_asset_ids: string[]; cover_asset_id: string | null; checksum: string; change_note: string; created_at: string; author: string | null; ai_model: string | null; ai_cost_estimate_cents: number | null }
interface Varianta { id: string; channel: string; format: string; spec: { formatKey: string; width: number; height: number; kind: string }; output_asset_id: string | null; is_enabled: boolean; render_status: string | null; render_error: string | null; render_mode: string | null; cost_estimate_cents: number | null }

export default async function ObsahDetail({ params, searchParams }: { params: Promise<{ provozovna: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna, id } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;

  const data = await withUser(k.session.userId, async (tx) => {
    const item = await tx.one<Item>(
      `select i.id, i.title, i.status, i.purpose, i.pillar, i.channels, i.scheduled_at, i.menu_id, i.template_id, i.current_version_id, i.approved_version_id, i.created_at,
              p.display_name as created_by_name, c.name as campaign_name, t.name as template_name
         from marketing.content_items i left join marketing.profiles p on p.user_id = i.created_by
         left join marketing.campaigns c on c.id = i.campaign_id left join marketing.templates t on t.id = i.template_id
        where i.id = $1 and i.venue_id = $2`, [id, v.id]);
    if (!item) return null;
    const [verze, varianty, komentare, zadosti, joby, media, ucty] = await Promise.all([
      tx.q<Verze>(`select cv.*, p.display_name as author from marketing.content_versions cv left join marketing.profiles p on p.user_id = cv.created_by where cv.content_item_id = $1 order by cv.version desc`, [id]),
      tx.q<Varianta>(`select cv.id, cv.channel, cv.format, cv.spec, cv.output_asset_id, cv.is_enabled, rj.status as render_status, rj.error as render_error, rj.mode as render_mode, rj.cost_estimate_cents
                        from marketing.content_variants cv left join marketing.render_jobs rj on rj.id = cv.render_job_id where cv.content_version_id = $1 order by cv.channel, cv.format`, [item.current_version_id]),
      tx.q<{ id: string; body: string; part: string | null; created_at: string; author: string | null; version: number | null; resolved_at: string | null }>(
        `select c.id, c.body, c.part, c.created_at, c.resolved_at, p.display_name as author, v.version from marketing.comments c left join marketing.profiles p on p.user_id = c.author_id
           left join marketing.content_versions v on v.id = c.content_version_id where c.content_item_id = $1 order by c.created_at desc`, [id]),
      tx.q<{ id: string; status: string; requested_at: string; resolved_at: string | null; requester: string | null; version: number; decision: string | null; decider: string | null; comment: string | null }>(
        `select r.id, r.status, r.requested_at, r.resolved_at, p.display_name as requester, v.version,
                d.decision, pd.display_name as decider, d.comment
           from marketing.approval_requests r left join marketing.profiles p on p.user_id = r.requested_by join marketing.content_versions v on v.id = r.content_version_id
           left join marketing.approval_decisions d on d.approval_request_id = r.id left join marketing.profiles pd on pd.user_id = d.decided_by
          where r.content_item_id = $1 order by r.requested_at desc`, [id]),
      tx.q<{ id: string; channel: string; format: string; status: string; scheduled_for: string; attempts: number; last_error: string | null; external_post_id: string | null; mode: string; permalink: string | null; is_mock: boolean | null }>(
        `select j.id, j.channel, j.format, j.status, j.scheduled_for, j.attempts, j.last_error, j.external_post_id, j.mode, pu.permalink, pu.is_mock
           from marketing.publish_jobs j left join marketing.publications pu on pu.publish_job_id = j.id where j.content_item_id = $1 order by j.created_at desc`, [id]),
      tx.q<{ id: string; title: string; kind: string; is_hero: boolean }>("select id, title, kind, is_hero from marketing.media_assets where (venue_id = $1 or venue_id is null) and organization_id = $2 and archived_at is null and kind in ('image','video') order by is_hero desc, created_at desc limit 40", [v.id, k.organization.id]),
      tx.q<{ platform: string; name: string; username: string | null }>("select platform, name, username from marketing.social_accounts where venue_id = $1 and is_active", [v.id]),
    ]);
    return { item, verze, varianty, komentare, zadosti, joby, media, ucty };
  });
  if (!data) notFound();
  const { item, verze, varianty, komentare, zadosti, joby, media, ucty } = data;
  const cur = verze.find((x) => x.id === item.current_version_id) ?? verze[0];
  const navrh = cur?.ai_proposal ?? null;
  const chybi = cur ? kontrolaPredSchvalenim(cur) : [];
  const mediaMap = new Map(media.map((m) => [m.id, m]));
  const cover = cur?.cover_asset_id ?? cur?.media_asset_ids[0] ?? null;
  const jeSchvaleno = item.approved_version_id && item.approved_version_id === item.current_version_id;
  const pending = zadosti.find((z) => z.status === "pending");
  const muzeUpravit = muze(k, "content.create") && !["published", "publishing", "archived"].includes(item.status);
  const nahledIg = varianty.find((x) => x.channel === "instagram" && x.format === "feed") ?? varianty.find((x) => x.channel === "instagram");
  const nahledFb = varianty.find((x) => x.channel === "facebook");
  const igText = cur?.texts.instagram;
  const fbText = cur?.texts.facebook;
  const placeny = varianty.some((x) => (x.cost_estimate_cents ?? 0) > 0);

  return (
    <>
      <div className="hlavicka">
        <div>
          <Kontext venue={v} extra={`${item.channels.join(" + ")}${item.scheduled_at ? " · " + formatDatumCas(new Date(item.scheduled_at), k.tz) : ""}`} />
          <h1 style={{ marginTop: 8 }}>{item.title || "Bez názvu"}</h1>
          <p className="stav-radek"><Stav s={item.status} /> <span className="faint">verze {cur?.version ?? 0} · {item.template_name ?? item.purpose}{item.campaign_name ? ` · kampaň ${item.campaign_name}` : ""} · založil {item.created_by_name ?? "—"}</span></p>
        </div>
        <div className="btn-radek">
          {muze(k, "content.create") && <form action={a.duplikovatAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} /><button className="btn btn-male">Duplikovat</button></form>}
          <a className="btn btn-male" href={`/${v.slug}/kalendar`}>Kalendář</a>
        </div>
      </div>
      <Hlasky sp={sp} />
      <div className="kroky">
        <span className="hotovo">1 Podklady</span><span className="hotovo">2 Zadání</span>
        <span className={navrh ? "hotovo" : "on"}>3 Návrhy</span>
        <span className={["draft", "preview_ready", "changes_requested"].includes(item.status) ? "on" : navrh ? "hotovo" : ""}>4 Editor</span>
        <span className={["awaiting_approval"].includes(item.status) ? "on" : jeSchvaleno || item.status === "scheduled" || item.status === "published" ? "hotovo" : ""}>5 Schválení</span>
        <span className={item.status === "approved" ? "on" : item.status === "scheduled" || item.status === "published" ? "hotovo" : ""}>6 Termín</span>
      </div>

      {item.status === "awaiting_approval" && pending && muze(k, "content.approve") && (
        <section className="karta" style={{ borderColor: "var(--pozor)" }}>
          <h3>Rozhodnout o schválení (verze {pending.version})</h3>
          <p className="muted">Schválení platí jen pro tuhle přesnou verzi. Jakákoli další úprava ho zruší. Žádá: {pending.requester ?? "—"}.</p>
          <form action={a.rozhodnoutAkce}>
            <input type="hidden" name="requestId" value={pending.id} /><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="itemId" value={item.id} />
            <div className="pole"><label htmlFor="komentar">Komentář (u vrácení povinný)</label><textarea id="komentar" name="comment" /></div>
            <div className="btn-radek">
              <button className="btn btn-primary" name="decision" value="approved">Schválit</button>
              <button className="btn" name="decision" value="changes_requested">Vrátit k úpravě</button>
              <button className="btn btn-bad" name="decision" value="rejected">Zamítnout</button>
            </div>
          </form>
        </section>
      )}

      {navrh && (
        <section className="karta">
          <h2>3. Návrhy</h2>
          <p className="muted">{navrh.shrnutiCile}</p>
          {navrh.upozorneni.map((u, i) => <div key={i} className="hlaska hlaska-pozor male">{u}</div>)}
          {(navrh.kontrolaFaktu.chybi.length > 0 || navrh.kontrolaFaktu.rozpory.length > 0) && (
            <div className="hlaska hlaska-bad male"><b>Kontrola faktů:</b> {[...navrh.kontrolaFaktu.chybi, ...navrh.kontrolaFaktu.rozpory].join(" ")}</div>
          )}
          <div className="mrizka mrizka-3">
            {navrh.varianty.map((va) => (
              <div key={va.klic} className="karta" style={{ borderColor: va.klic === cur?.selected_variant_key ? "var(--mosaz)" : undefined, margin: 0 }}>
                <h3>{va.nazev} {va.klic === navrh.doporucenaVarianta && <span className="stitek stitek-mosaz">doporučeno</span>}</h3>
                <p className="faint">{va.proc}</p>
                <p className="male"><b>{va.instagram.hook}</b></p>
                <p className="male" style={{ whiteSpace: "pre-wrap" }}>{va.instagram.popisek.slice(0, 220)}{va.instagram.popisek.length > 220 ? "…" : ""}</p>
                {muzeUpravit && va.klic !== cur?.selected_variant_key && (
                  <form action={a.vybratVariantuAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="klic" value={va.klic} /><button className="btn btn-male">Použít tuto variantu</button></form>
                )}
                {va.klic === cur?.selected_variant_key && <span className="stitek stitek-dobre">vybráno</span>}
              </div>
            ))}
          </div>
          {muzeUpravit && (
            <form action={a.prepracovatAkce} style={{ marginTop: 14 }}>
              <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} />
              <div className="radek radek-3">
                <div className="pole"><label htmlFor="typ">Přepracovat</label>
                  <select id="typ" name="typ" defaultValue="zkratit">
                    <option value="zkratit">Zkrátit</option><option value="mene_umele">Méně umělé</option><option value="pro_mlade">Více pro mladé</option>
                    <option value="zmenit_cenu">Změnit cenu (upozorní na zdroj)</option><option value="jina_fotka">Použít jinou fotku</option><option value="volne">Vlastní pokyn</option>
                  </select></div>
                <div className="pole"><label htmlFor="cast">Jen část</label>
                  <select id="cast" name="cast" defaultValue="vse"><option value="vse">Celá varianta</option><option value="caption:instagram">Text pro Instagram</option><option value="caption:facebook">Text pro Facebook</option><option value="storyboard">Storyboard</option><option value="media">Média</option></select></div>
                <div className="pole"><label htmlFor="text">Poznámka</label><input id="text" name="text" placeholder="např. zmínit, že máme terasu" /></div>
              </div>
              <button className="btn">Přepracovat jen dotčenou část</button>
            </form>
          )}
        </section>
      )}

      {cur && (
        <section className="karta">
          <h2>4. Editor a náhled</h2>
          {jeSchvaleno && <div className="hlaska hlaska-pozor">Obsah je schválený. Každá úprava vytvoří novou verzi a schválení zruší.</div>}
          <div className="nahled-2">
            <div>
              <div className="nahled-ram" style={{ aspectRatio: "4 / 5" }}>
                {nahledIg?.output_asset_id ? <img src={podepsatSoubor(nahledIg.output_asset_id)} alt="Náhled Instagram" /> : cover ? <img src={podepsatSoubor(cover)} alt="Titulní fotografie" style={{ objectFit: "cover", height: "100%" }} /> : <div className="muted" style={{ padding: 20 }}>Bez média</div>}
              </div>
              <div className="nahled-popis"><b>Instagram</b> · {ucty.find((u) => u.platform === "instagram")?.name ?? "účet nepřipojen"}<br /><span style={{ whiteSpace: "pre-wrap" }}>{igText?.caption}</span><br /><span className="faint">{igText?.hashtags.join(" ")}</span></div>
            </div>
            <div>
              <div className="nahled-ram" style={{ aspectRatio: "4 / 5" }}>
                {nahledFb?.output_asset_id ? <img src={podepsatSoubor(nahledFb.output_asset_id)} alt="Náhled Facebook" /> : cover ? <img src={podepsatSoubor(cover)} alt="Titulní fotografie" style={{ objectFit: "cover", height: "100%" }} /> : <div className="muted" style={{ padding: 20 }}>Bez média</div>}
              </div>
              <div className="nahled-popis"><b>Facebook</b> · {ucty.find((u) => u.platform === "facebook")?.name ?? "stránka nepřipojena"}<br /><span style={{ whiteSpace: "pre-wrap" }}>{fbText?.caption}</span></div>
            </div>
          </div>

          <h3 style={{ marginTop: 18 }}>Výstupy a render</h3>
          {placeny && <div className="hlaska hlaska-pozor male">Některé výstupy čerpají placený kredit u externího poskytovatele — odhad je u každého výstupu.</div>}
          <div className="tabulka-obal"><table className="tabulka">
            <thead><tr><th>Formát</th><th>Stav</th><th>Výstup</th><th></th></tr></thead>
            <tbody>{varianty.map((va) => (
              <tr key={va.id}>
                <td>{va.channel} · {va.format} <span className="faint">{va.spec.width}×{va.spec.height}</span>{!va.is_enabled && <span className="stitek"> vypnuto</span>}</td>
                <td>{va.render_status ? <StavRenderu s={va.render_status} /> : <span className="faint">nevykresleno</span>}{va.render_mode === "mock" && <span className="stitek stitek-mock"> demo</span>}{va.render_error && <div className="faint">{va.render_error}</div>}{va.cost_estimate_cents ? <div className="faint">odhad {Math.round(va.cost_estimate_cents / 100)} Kč</div> : null}</td>
                <td>{va.output_asset_id ? <a href={`${podepsatSoubor(va.output_asset_id)}&stahnout=1`}>Stáhnout</a> : "—"}</td>
                <td className="btn-radek">
                  {muzeUpravit && <form action={a.renderAkce}><input type="hidden" name="versionId" value={cur.id} /><input type="hidden" name="variantId" value={va.id} /><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="itemId" value={item.id} /><button className="btn btn-male">{va.output_asset_id ? "Vykreslit znovu" : "Vykreslit"}</button></form>}
                  {muzeUpravit && <form action={a.prepnoutVariantuAkce}><input type="hidden" name="variantId" value={va.id} /><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="enabled" value={va.is_enabled ? "0" : "1"} /><button className="btn btn-male btn-tiche">{va.is_enabled ? "Vypnout" : "Zapnout"}</button></form>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>

          {muzeUpravit && (
            <form action={a.ulozitUpravyAkce} style={{ marginTop: 18 }}>
              <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} />
              <div className="radek radek-2">
                <div className="pole"><label htmlFor="title">Název (interní)</label><input id="title" name="title" defaultValue={item.title} /></div>
                <div className="pole"><label htmlFor="in_price">Cena v obraze (Kč)</label><input id="in_price" name="in_price" type="number" min={0} defaultValue={typeof cur.inputs.price === "number" ? cur.inputs.price : ""} /></div>
                <div className="pole"><label htmlFor="in_date">Datum v obraze</label><input id="in_date" name="in_date" type="date" defaultValue={typeof cur.inputs.date === "string" ? cur.inputs.date : ""} /></div>
                <div className="pole"><label htmlFor="in_title">Titulek v obraze</label><input id="in_title" name="in_title" defaultValue={typeof cur.inputs.title === "string" ? cur.inputs.title : ""} /></div>
              </div>
              <div className="radek radek-2">
                <div className="pole"><label htmlFor="ig_caption">Text pro Instagram</label><textarea id="ig_caption" name="ig_caption" defaultValue={igText?.caption ?? ""} /><small>Hashtagy (mezerou): <input name="ig_hashtags" defaultValue={igText?.hashtags.join(" ") ?? ""} /></small></div>
                <div className="pole"><label htmlFor="fb_caption">Text pro Facebook</label><textarea id="fb_caption" name="fb_caption" defaultValue={fbText?.caption ?? ""} /><small>CTA: <input name="cta" defaultValue={igText?.cta ?? fbText?.cta ?? ""} /></small></div>
              </div>
              <div className="pole">
                <label>Média a pořadí (první = titulní; zaškrtnuté se použijí)</label>
                <div className="media-mrizka">
                  {[...cur.media_asset_ids.map((mid) => mediaMap.get(mid)).filter(Boolean), ...media.filter((m) => !cur.media_asset_ids.includes(m.id))].map((m) => m && (
                    <label key={m.id} className={`media-karta${cur.media_asset_ids.includes(m.id) ? " vybrano" : ""}`}>
                      <img src={podepsatSoubor(m.id)} alt={m.title} loading="lazy" />
                      <input type="checkbox" name="media" value={m.id} defaultChecked={cur.media_asset_ids.includes(m.id)} />
                      <span className="popisek">{cover === m.id ? "★ titulní · " : ""}{m.title}</span>
                    </label>
                  ))}
                </div>
                <small>Titulní obrázek: <select name="cover" defaultValue={cover ?? ""}><option value="">první vybraný</option>{cur.media_asset_ids.map((mid) => <option key={mid} value={mid}>{mediaMap.get(mid)?.title ?? mid.slice(0, 8)}</option>)}</select></small>
              </div>
              {cur.storyboard && cur.storyboard.length > 0 && (
                <details>
                  <summary>Storyboard videa ({cur.storyboard.reduce((s, x) => s + x.sekundy, 0)} s)</summary>
                  <div className="tabulka-obal"><table className="tabulka"><thead><tr><th>#</th><th>Scéna</th><th>Sekundy</th><th>Text v obraze</th><th>Titulek</th></tr></thead>
                    <tbody>{cur.storyboard.map((s) => (
                      <tr key={s.poradi}><td>{s.poradi}</td><td>{s.druh}</td><td><input name={`sc_${s.poradi}_sekundy`} type="number" step="any" min="0.5" max="30" defaultValue={s.sekundy} style={{ width: 80 }} /></td>
                        <td><input name={`sc_${s.poradi}_text`} defaultValue={s.textVObraze} /></td><td><input name={`sc_${s.poradi}_titulek`} defaultValue={s.titulek} /></td></tr>
                    ))}</tbody></table></div>
                  <label className="chip" style={{ marginTop: 8 }}><input type="checkbox" name="titulky" defaultChecked={cur.inputs.titulky !== false} /> titulky</label>{" "}
                  <label className="chip"><input type="checkbox" name="hudba" defaultChecked={cur.inputs.hudba !== false} /> hudba (jen s doloženou licencí)</label>{" "}
                  <label className="chip"><input type="checkbox" name="voiceover" defaultChecked={cur.inputs.voiceover === true} /> voice-over</label>
                </details>
              )}
              <div className="pole"><label htmlFor="note">Poznámka ke změně</label><input id="note" name="note" placeholder="co jste změnili" /></div>
              <button className="btn btn-primary">Uložit jako novou verzi</button>
            </form>
          )}
        </section>
      )}

      <section className="karta">
        <h2>5. Schválení</h2>
        {chybi.length > 0 && <div className="hlaska hlaska-pozor male">Před žádostí doplňte: {chybi.join(", ")}.</div>}
        <div className="btn-radek">
          {muze(k, "content.create") && cur && !pending && !jeSchvaleno && !["published", "publishing", "archived"].includes(item.status) && (
            <form action={a.pozadatAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} />
              <input name="summary" placeholder="Shrnutí pro schvalovatele (nepovinné)" style={{ width: 280, display: "inline-block", marginRight: 8 }} />
              <button className="btn btn-primary" disabled={chybi.length > 0}>Požádat o schválení</button></form>
          )}
          {pending && <span className="stitek stitek-pozor">čeká na schválení od {new Date(pending.requested_at).toLocaleDateString("cs-CZ")}</span>}
          {jeSchvaleno && <span className="stitek stitek-dobre">schváleno pro verzi {cur?.version}</span>}
        </div>
        {zadosti.length > 0 && (
          <ul className="seznam" style={{ marginTop: 10 }}>{zadosti.map((z) => (
            <li key={z.id}><div className="roste"><b>Verze {z.version}: {z.status}</b><span className="faint">žádal {z.requester ?? "—"} · {formatDatumCas(new Date(z.requested_at), k.tz)}{z.decision ? ` · ${z.decision} (${z.decider ?? "—"})` : ""}{z.comment ? ` · „${z.comment}“` : ""}</span></div></li>
          ))}</ul>
        )}
      </section>

      <section className="karta">
        <h2>6. Termín a zveřejnění</h2>
        {!jeSchvaleno && <p className="muted">Naplánovat nebo zveřejnit jde jen schválenou aktuální verzi.</p>}
        {jeSchvaleno && (muze(k, "content.schedule") || muze(k, "content.publish")) && item.status !== "published" && (
          <form action={a.naplanovatAkce}>
            <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} />
            <div className="hlaska male">
              <b>Souhrn před zveřejněním:</b> {v.name} · {item.channels.map((c) => `${c}: ${ucty.find((u) => u.platform === c)?.name ?? "nepřipojeno → ruční zveřejnění"}`).join(" · ")} · verze {cur?.version} · {varianty.filter((x) => x.is_enabled).length} výstupů.
            </div>
            <div className="radek radek-3">
              <div className="pole"><label htmlFor="datum">Datum (Europe/Prague)</label><input id="datum" name="datum" type="date" defaultValue={item.scheduled_at ? datumVPasmu(new Date(item.scheduled_at), k.tz) : posunDne(dnes(k.tz), 1)} /></div>
              <div className="pole"><label htmlFor="cas">Čas</label><input id="cas" name="cas" type="time" defaultValue={item.scheduled_at ? casVPasmu(new Date(item.scheduled_at), k.tz) : "11:00"} /></div>
              <div className="pole"><label>&nbsp;</label><div className="btn-radek">
                {muze(k, "content.schedule") && <button className="btn btn-primary" name="rezim" value="plan">Naplánovat</button>}
                {muze(k, "content.publish") && <button className="btn" name="rezim" value="ted">Zveřejnit nyní</button>}
              </div></div>
            </div>
          </form>
        )}
        {item.status === "scheduled" && muze(k, "content.schedule") && <form action={a.zrusitPlanAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} /><button className="btn btn-male">Zrušit naplánování</button></form>}
        {joby.length > 0 && (
          <div className="tabulka-obal" style={{ marginTop: 12 }}><table className="tabulka">
            <thead><tr><th>Síť</th><th>Formát</th><th>Termín</th><th>Stav</th><th>Pokusy</th><th></th></tr></thead>
            <tbody>{joby.map((j) => (
              <tr key={j.id}><td>{j.channel}</td><td>{j.format}</td><td>{formatDatumCas(new Date(j.scheduled_for), k.tz)}</td>
                <td><StavPublikace s={j.status} />{j.mode === "mock" && <span className="stitek stitek-mock"> demo</span>}{j.last_error && <div className="faint">{j.last_error}</div>}{j.permalink && <div><a href={j.permalink}>odkaz</a></div>}{j.external_post_id && <div className="faint mono">{j.external_post_id}</div>}</td>
                <td>{j.attempts}</td>
                <td>{["failed", "dead_letter", "manual_export"].includes(j.status) && muze(k, "content.publish") && <form action={a.zopakovatAkce}><input type="hidden" name="jobId" value={j.id} /><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="itemId" value={item.id} /><button className="btn btn-male">Zkusit znovu</button></form>}</td></tr>
            ))}</tbody></table></div>
        )}
        {(item.status === "scheduled" || joby.some((j) => ["scheduled", "queued", "failed"].includes(j.status))) && muze(k, "content.publish") && (
          <form action={a.zpracovatFrontuAkce} style={{ marginTop: 10 }}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="itemId" value={item.id} /><button className="btn btn-male btn-tiche">Zpracovat frontu teď (jinak běží cron)</button></form>
        )}
      </section>

      <div className="mrizka mrizka-2">
        <section className="karta">
          <h3>Komentáře</h3>
          <form action={a.komentarAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="slug" value={v.slug} />
            <div className="pole"><textarea name="body" placeholder="Komentář k aktuální verzi…" required /></div>
            <div className="btn-radek"><select name="part" defaultValue=""><option value="">obecně</option><option value="caption:instagram">text IG</option><option value="caption:facebook">text FB</option><option value="media">média</option><option value="price">cena</option><option value="storyboard">storyboard</option></select><button className="btn btn-male">Přidat</button></div></form>
          <ul className="seznam">{komentare.map((c) => (
            <li key={c.id}><div className="roste"><b>{c.author ?? "—"} <span className="faint">v{c.version ?? "?"} · {c.part ?? "obecně"} · {formatDatumCas(new Date(c.created_at), k.tz)}</span></b><span style={{ whiteSpace: "pre-wrap" }}>{c.body}</span></div></li>
          ))}</ul>
        </section>
        <section className="karta">
          <h3>Historie verzí</h3>
          <ul className="seznam">{verze.map((x) => (
            <li key={x.id}><div className="roste"><b>Verze {x.version} {x.id === item.current_version_id && <span className="stitek stitek-mosaz">aktuální</span>} {x.id === item.approved_version_id && <span className="stitek stitek-dobre">schválená</span>}</b>
              <span className="faint">{x.change_note} · {x.author ?? "—"} · {formatDatumCas(new Date(x.created_at), k.tz)}{x.ai_model ? ` · ${x.ai_model}` : ""}{x.ai_cost_estimate_cents ? ` · ~${(x.ai_cost_estimate_cents / 100).toFixed(2)} Kč` : ""} · otisk {x.checksum.slice(0, 8)}</span></div>
              {muzeUpravit && x.id !== item.current_version_id && <form action={a.obnovitVerziAkce}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="versionId" value={x.id} /><input type="hidden" name="slug" value={v.slug} /><button className="btn btn-male">Obnovit</button></form>}</li>
          ))}</ul>
        </section>
      </div>
    </>
  );
}
