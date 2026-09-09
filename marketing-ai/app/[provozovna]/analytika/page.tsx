import { formatDatumCas } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { qrSvg } from "@/lib/domena/utm";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { synchronizovatAkce, utmAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Analytika({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const pubs = await tx.q<{ id: string; title: string; channel: string; format: string; published_at: string; is_mock: boolean; template: string | null; hook: string | null; duration: number | null; metrics: Record<string, number> | null; source: string | null; is_estimate: boolean | null; campaign: string | null }>(
      `select p.id, i.title, p.channel, p.format, p.published_at, p.is_mock, t.name as template, (v.texts -> p.channel ->> 'hook') as hook,
              (select sum((s->>'sekundy')::numeric) from jsonb_array_elements(coalesce(v.storyboard, '[]'::jsonb)) s) as duration,
              m.metrics, m.source, m.is_estimate, c.name as campaign
         from marketing.publications p join marketing.content_items i on i.id = p.content_item_id join marketing.content_versions v on v.id = p.content_version_id
         left join marketing.templates t on t.id = i.template_id left join marketing.campaigns c on c.id = i.campaign_id
         left join lateral (select metrics, source, is_estimate from marketing.metric_snapshots ms where ms.publication_id = p.id order by captured_at desc limit 1) m on true
        where p.venue_id = $1 order by p.published_at desc limit 100`, [v.id]);
    const utm = await tx.q<{ id: string; target_url: string; short_code: string; clicks: number; utm: Record<string, string>; created_at: string }>("select * from marketing.utm_links where venue_id = $1 order by created_at desc limit 20", [v.id]);
    const brand = await tx.one<{ reservation_url: string; ordering_url: string; website_url: string }>("select reservation_url, ordering_url, website_url from marketing.brand_kits where venue_id = $1", [v.id]);
    const usage = await tx.q<{ provider_key: string; n: number; cost: number | null }>("select provider_key, count(*)::int as n, sum(estimated_cost_cents)::int as cost from marketing.provider_usage_records where venue_id = $1 and occurred_at > now() - interval '30 days' group by provider_key order by n desc", [v.id]);
    return { pubs, utm, brand, usage };
  });
  const sMetric = data.pubs.filter((p) => p.metrics);
  const sum = (key: string) => sMetric.reduce((s, p) => s + (p.metrics?.[key] ?? 0), 0);
  const tyden = data.pubs.filter((p) => Date.now() - new Date(p.published_at).getTime() < 7 * 86400000);
  const byTemplate = new Map<string, { n: number; reach: number }>();
  for (const p of sMetric) { const t = p.template ?? "bez šablony"; const cur = byTemplate.get(t) ?? { n: 0, reach: 0 }; cur.n++; cur.reach += p.metrics?.reach ?? 0; byTemplate.set(t, cur); }
  const best = [...byTemplate.entries()].map(([t, x]) => ({ t, avg: x.reach / x.n, n: x.n })).sort((a, b) => b.avg - a.avg);
  const bestHook = [...sMetric].sort((a, b) => (b.metrics?.reach ?? 0) - (a.metrics?.reach ?? 0))[0];
  const vseOdhad = sMetric.length > 0 && sMetric.every((p) => p.is_estimate);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Analytika</h1><p>Jen metriky, které daná síť a oprávnění skutečně poskytují. Odhady jsou označené jako odhad.</p></div>
        {muze(k, "analytics.read") && <form action={synchronizovatAkce}><input type="hidden" name="slug" value={v.slug} /><button className="btn btn-male">Načíst metriky od poskytovatele</button></form>}</div>
      <Hlasky sp={sp} />
      {vseOdhad && <div className="hlaska hlaska-pozor">Všechna čísla níže jsou <b>odhady z ukázkového nástroje</b> — skutečné metriky přijdou po připojení Meta Insights v Integracích.</div>}
      <div className="mrizka mrizka-4">
        {[["Dosah", "reach"], ["Zobrazení", "impressions"], ["Reakce", "likes"], ["Komentáře", "comments"], ["Sdílení", "shares"], ["Uložení", "saves"], ["Kliknutí", "link_clicks"]].map(([l, key]) => (
          <div key={key} className="karta kpi"><span className="popis">{l}</span><span className="cislo-velke">{sum(key)}</span>{vseOdhad && <span className="faint">odhad</span>}</div>
        ))}
        <div className="karta kpi"><span className="popis">Publikací</span><span className="cislo-velke">{data.pubs.length}</span><span className="faint">{data.pubs.filter((p) => p.is_mock).length} demo</span></div>
      </div>

      <section className="karta">
        <h2>Týdenní report</h2>
        {tyden.length === 0 ? <p className="muted">Za posledních 7 dní nic zveřejněného.</p> : (
          <ul className="seznam">
            <li>Za týden zveřejněno <b>&nbsp;{tyden.length}&nbsp;</b> příspěvků ({tyden.filter((p) => p.channel === "instagram").length} Instagram, {tyden.filter((p) => p.channel === "facebook").length} Facebook).</li>
            {best[0] && <li>Nejúspěšnější šablona podle dosahu: <b>&nbsp;{best[0].t}&nbsp;</b> (průměr {Math.round(best[0].avg)}, {best[0].n} příspěvků){vseOdhad ? " — odhad" : ""}. Doporučení: zopakovat.</li>}
            {bestHook && <li>Nejlepší hook: „{bestHook.hook ?? bestHook.title}“ ({bestHook.metrics?.reach ?? 0}){bestHook.duration ? ` · délka videa ${Math.round(Number(bestHook.duration))} s` : ""}.</li>}
            {best.length > 1 && <li>Nejslabší šablona: {best[best.length - 1].t} (průměr {Math.round(best[best.length - 1].avg)}). Doporučení: změnit fotografii nebo hook.</li>}
            <li className="faint">Doporučený čas publikace se ukáže až po dostatku vlastních dat; do té doby platí výchozí pravidla: menu 9:30–11:00, akce 17:00–19:00.</li>
          </ul>
        )}
      </section>

      <section className="karta tabulka-obal">
        <h2>Podle příspěvku</h2>
        <table className="tabulka"><thead><tr><th>Příspěvek</th><th>Síť</th><th>Zveřejněno</th><th>Šablona · kampaň</th><th>Dosah</th><th>Reakce</th><th>Koment.</th><th>Uložení</th><th>Zdroj</th></tr></thead>
          <tbody>{data.pubs.map((p) => (
            <tr key={p.id}><td>{p.title || "Bez názvu"}{p.is_mock && <span className="stitek stitek-mock"> demo</span>}</td><td>{p.channel} · {p.format}</td><td>{formatDatumCas(new Date(p.published_at), k.tz)}</td><td className="faint">{p.template ?? "—"}{p.campaign ? ` · ${p.campaign}` : ""}</td>
              <td>{p.metrics?.reach ?? "—"}</td><td>{p.metrics?.likes ?? "—"}</td><td>{p.metrics?.comments ?? "—"}</td><td>{p.metrics?.saves ?? "—"}</td><td className="faint">{p.source ?? "—"}{p.is_estimate ? " (odhad)" : ""}</td></tr>
          ))}</tbody></table>
      </section>

      <div className="mrizka mrizka-2">
        <section className="karta">
          <h2>UTM odkazy a QR kódy</h2>
          <p className="muted">Měřitelný odkaz na rezervaci, objednávku nebo akci. Atribuce rezervací a tržeb přijde s propojením na FoodTab; do té doby jde o počet kliknutí.</p>
          {muze(k, "content.create") && (
            <form action={utmAkce}>
              <input type="hidden" name="slug" value={v.slug} />
              <div className="radek radek-2">
                <div className="pole"><label htmlFor="target">Cílová adresa</label><input id="target" name="target" type="url" required defaultValue={data.brand?.reservation_url || data.brand?.ordering_url || data.brand?.website_url || ""} placeholder="https://…" /></div>
                <div className="pole"><label htmlFor="campaign">Kampaň (utm_campaign)</label><input id="campaign" name="campaign" required placeholder="vikendove-menu" /></div>
                <div className="pole"><label htmlFor="source">Zdroj</label><select id="source" name="source" defaultValue="instagram"><option value="instagram">instagram</option><option value="facebook">facebook</option><option value="qr">qr (tisk)</option></select></div>
                <div className="pole"><label htmlFor="medium">Médium</label><select id="medium" name="medium" defaultValue="social"><option value="social">social</option><option value="story">story</option><option value="reel">reel</option><option value="print">print</option></select></div>
              </div>
              <button className="btn btn-male">Vytvořit odkaz</button>
            </form>
          )}
          <ul className="seznam">{data.utm.map((u) => (
            <li key={u.id}><div className="roste"><b className="mono">{base}/r/{u.short_code}</b><span className="faint" style={{ wordBreak: "break-all" }}>{u.target_url}</span><span className="faint">{u.clicks} kliknutí</span></div>
              <span dangerouslySetInnerHTML={{ __html: qrSvg(`${base}/r/${u.short_code}`, 72) }} /></li>
          ))}</ul>
        </section>
        <section className="karta">
          <h2>Využití nástrojů (30 dní)</h2>
          {data.usage.length === 0 ? <p className="muted">Zatím nic.</p> : <table className="tabulka"><thead><tr><th>Nástroj</th><th>Volání</th><th>Odhad nákladů</th></tr></thead><tbody>{data.usage.map((u) => <tr key={u.provider_key}><td>{u.provider_key}</td><td>{u.n}</td><td>{u.cost ? `${(u.cost / 100).toFixed(2)} Kč` : "0 / neznámo"}</td></tr>)}</tbody></table>}
          <p className="faint">Odhad, ne účtování — skutečné částky jsou u poskytovatele, kterému zákazník platí přímo.</p>
        </section>
      </div>
    </>
  );
}
