import { formatDatumCas } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky, StavPublikace } from "../../ui";
import { Kontext } from "../kontext";
import { zopakovatAkce, zpracovatAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Publikace({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const rows = await withUser(k.session.userId, (tx) => tx.q<{ id: string; content_item_id: string; title: string; channel: string; format: string; status: string; scheduled_for: string; published_at: string | null; attempts: number; max_attempts: number; last_error: string | null; external_post_id: string | null; mode: string; permalink: string | null; is_mock: boolean | null; account: string | null; output_asset_id: string | null; caption: string | null; provider_key: string }>(
    `select j.id, j.content_item_id, i.title, j.channel, j.format, j.status, j.scheduled_for, j.published_at, j.attempts, j.max_attempts, j.last_error, j.external_post_id, j.mode, j.provider_key,
            pu.permalink, pu.is_mock, sa.name as account, cv.output_asset_id, (ver.texts -> j.channel ->> 'caption') as caption
       from marketing.publish_jobs j join marketing.content_items i on i.id = j.content_item_id
       left join marketing.publications pu on pu.publish_job_id = j.id left join marketing.social_accounts sa on sa.id = j.social_account_id
       left join marketing.content_variants cv on cv.id = j.variant_id left join marketing.content_versions ver on ver.id = j.content_version_id
      where j.venue_id = $1 and ($2 = '' or j.status = $2) order by j.scheduled_for desc limit 200`, [v.id, sp.stav ?? ""]));
  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Publikované příspěvky a stavy</h1><p>Skutečný stav od poskytovatele. Demo publikace mají vždy stav <code>published_mock</code>. Ruční publikace: stáhněte soubor a text.</p></div>
        {muze(k, "content.publish") && <form action={zpracovatAkce}><input type="hidden" name="slug" value={v.slug} /><button className="btn btn-male">Zpracovat frontu teď</button></form>}</div>
      <Hlasky sp={sp} />
      <div className="chip-radek karta">
        {[["", "Vše"], ["scheduled", "Naplánované"], ["published", "Zveřejněné"], ["published_mock", "Demo"], ["manual_export", "K ručnímu zveřejnění"], ["failed", "Selhané"], ["dead_letter", "Vyčerpané pokusy"]].map(([s, l]) => <a key={s} className={`chip${(sp.stav ?? "") === s ? " on" : ""}`} href={`/${v.slug}/publikace${s ? `?stav=${s}` : ""}`}>{l}</a>)}
      </div>
      {rows.length === 0 ? <div className="karta"><p className="muted">Nic tu není.</p></div> : (
        <div className="karta tabulka-obal"><table className="tabulka">
          <thead><tr><th>Obsah</th><th>Síť · účet</th><th>Termín</th><th>Stav</th><th>Pokusy</th><th>Výsledek</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><a href={`/${v.slug}/obsah/${r.content_item_id}`}>{r.title || "Bez názvu"}</a><div className="faint">{r.format}</div></td>
              <td>{r.channel}<div className="faint">{r.account ?? "bez účtu"} · {r.provider_key}</div></td>
              <td>{formatDatumCas(new Date(r.scheduled_for), k.tz)}</td>
              <td><StavPublikace s={r.status} />{r.mode === "mock" && <span className="stitek stitek-mock"> demo</span>}{r.last_error && <div className="faint">{r.last_error}</div>}</td>
              <td>{r.attempts}/{r.max_attempts}</td>
              <td>{r.permalink ? <a href={r.permalink}>Otevřít příspěvek</a> : r.external_post_id ? <span className="mono faint">{r.external_post_id}</span> : "—"}
                {r.status === "manual_export" && <div className="btn-radek" style={{ marginTop: 4 }}>{r.output_asset_id && <a className="btn btn-male" href={`${podepsatSoubor(r.output_asset_id)}&stahnout=1`}>Stáhnout soubor</a>}<details><summary className="faint">Text</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{r.caption}</pre></details></div>}</td>
              <td>{["failed", "dead_letter", "manual_export"].includes(r.status) && muze(k, "content.publish") && <form action={zopakovatAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="jobId" value={r.id} /><button className="btn btn-male">Zkusit znovu</button></form>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
