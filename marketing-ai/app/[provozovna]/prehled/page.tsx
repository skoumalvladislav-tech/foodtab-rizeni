import { formatDatumCas, relativne } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Stav } from "../../ui";
import { Kontext } from "../kontext";

export default async function Prehled({ params }: { params: Promise<{ provozovna: string }> }) {
  const { provozovna } = await params;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;

  const data = await withUser(k.session.userId, async (tx) => {
    const [cekajici, dnes, nadchazejici, chyby, posledni, spojeni, napady] = await Promise.all([
      tx.q<{ id: string; title: string; requested_at: string; content_item_id: string }>(
        `select r.id, i.title, r.requested_at, r.content_item_id from marketing.approval_requests r
           join marketing.content_items i on i.id = r.content_item_id
          where r.venue_id = $1 and r.status = 'pending' order by r.requested_at limit 5`, [v.id]),
      tx.q<{ id: string; title: string; scheduled_at: string; status: string }>(
        `select id, title, scheduled_at, status from marketing.content_items
          where venue_id = $1 and scheduled_at >= date_trunc('day', now() at time zone $2) at time zone $2
            and scheduled_at < (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2
            and status in ('scheduled','publishing','published','approved') order by scheduled_at`, [v.id, k.tz]),
      tx.q<{ id: string; title: string; scheduled_at: string; status: string }>(
        `select id, title, scheduled_at, status from marketing.content_items
          where venue_id = $1 and scheduled_at > now() and status in ('scheduled','approved','awaiting_approval','draft','preview_ready')
          order by scheduled_at limit 6`, [v.id]),
      tx.q<{ id: string; title: string; status: string; updated_at: string }>(
        `select id, title, status, updated_at from marketing.content_items
          where venue_id = $1 and status in ('generation_failed','render_failed','publish_failed','connection_required')
          order by updated_at desc limit 5`, [v.id]),
      tx.q<{ id: string; title: string; published_at: string; is_mock: boolean; channel: string; metrics: Record<string, number> | null }>(
        `select p.id, i.title, p.published_at, p.is_mock, p.channel,
                (select m.metrics from marketing.metric_snapshots m where m.publication_id = p.id order by m.captured_at desc limit 1) as metrics
           from marketing.publications p join marketing.content_items i on i.id = p.content_item_id
          where p.venue_id = $1 order by p.published_at desc limit 5`, [v.id]),
      tx.q<{ provider_key: string; name: string; status: string; mode: string; last_error: string | null }>(
        `select c.provider_key, pc.name, c.status, c.mode, c.last_error
           from marketing.integration_connections c join marketing.provider_catalog pc on pc.key = c.provider_key
          where c.organization_id = $1 and (c.venue_id is null or c.venue_id = $2) and c.revoked_at is null
          order by pc.category`, [k.organization.id, v.id]),
      tx.q<{ id: string; text: string }>("select id, text from marketing.ideas where venue_id = $1 and status = 'new' order by created_at desc limit 3", [v.id]),
    ]);
    return { cekajici, dnes, nadchazejici, chyby, posledni, spojeni, napady };
  });

  const problemy = data.spojeni.filter((s) => s.status === "error" || s.status === "needs_attention");
  const mock = data.spojeni.filter((s) => s.mode === "mock");

  return (
    <>
      <div className="hlavicka">
        <div>
          <Kontext venue={v} />
          <h1 style={{ marginTop: 8 }}>Přehled</h1>
          <p>Co je dnes v plánu, co čeká na schválení a jak se daří posledním příspěvkům.</p>
        </div>
      </div>

      {muze(k, "content.create") && (
        <div className="velke-tlacitko-obal btn-radek">
          <a className="btn btn-primary btn-velke" href={`/${v.slug}/tvorba`}>＋ Vytvořit nový příspěvek nebo Reel</a>
          <a className="btn btn-tiche" href={`/${v.slug}/tvorba?rezim=rychly`}>Rychlý režim: fotka + jedna věta</a>
          <a className="btn btn-tiche" href={`/${v.slug}/tvorba?rezim=kampan`}>Kampaňový režim: série obsahu</a>
        </div>
      )}

      {mock.length > 0 && (
        <div className="hlaska hlaska-pozor">
          <b>Demo režim.</b> {mock.length} nástrojů běží jako mock — nic se nikam nezveřejní, výsledek bude označený <code>published_mock</code>. Skutečné nástroje připojíte v{" "}
          <a href="/nastaveni/integrace">Integracích</a>.
        </div>
      )}
      {problemy.length > 0 && (
        <div className="hlaska hlaska-bad">
          <b>Připojení vyžaduje pozornost:</b> {problemy.map((p) => p.name).join(", ")}. <a href="/nastaveni/integrace">Otevřít integrace</a>
        </div>
      )}

      <div className="mrizka mrizka-2">
        <section className="karta">
          <h3>Dnes naplánováno</h3>
          {data.dnes.length === 0 ? <p className="muted">Dnes nic naplánovaného.</p> : (
            <ul className="seznam">{data.dnes.map((i) => (
              <li key={i.id}><div className="roste"><b><a href={`/${v.slug}/obsah/${i.id}`}>{i.title || "Bez názvu"}</a></b><span className="faint">{formatDatumCas(new Date(i.scheduled_at), k.tz)}</span></div><Stav s={i.status} /></li>
            ))}</ul>
          )}
        </section>
        <section className="karta">
          <h3>Čeká na schválení {data.cekajici.length > 0 && <span className="stitek stitek-pozor">{data.cekajici.length}</span>}</h3>
          {data.cekajici.length === 0 ? <p className="muted">Nic nečeká.</p> : (
            <ul className="seznam">{data.cekajici.map((r) => (
              <li key={r.id}><div className="roste"><b><a href={`/${v.slug}/obsah/${r.content_item_id}`}>{r.title || "Bez názvu"}</a></b><span className="faint">požádáno {relativne(new Date(r.requested_at), k.tz)}</span></div>
                <a className="btn btn-male" href={`/${v.slug}/schvalovani`}>Otevřít</a></li>
            ))}</ul>
          )}
        </section>
        <section className="karta">
          <h3>Blížící se akce a příspěvky</h3>
          {data.nadchazejici.length === 0 ? <p className="muted">Zatím nic v plánu. <a href={`/${v.slug}/kalendar`}>Otevřít kalendář</a></p> : (
            <ul className="seznam">{data.nadchazejici.map((i) => (
              <li key={i.id}><div className="roste"><b><a href={`/${v.slug}/obsah/${i.id}`}>{i.title || "Bez názvu"}</a></b><span className="faint">{formatDatumCas(new Date(i.scheduled_at), k.tz)} · {relativne(new Date(i.scheduled_at), k.tz)}</span></div><Stav s={i.status} /></li>
            ))}</ul>
          )}
        </section>
        <section className="karta">
          <h3>Poslední příspěvky</h3>
          {data.posledni.length === 0 ? <p className="muted">Zatím nic publikovaného.</p> : (
            <ul className="seznam">{data.posledni.map((p) => (
              <li key={p.id}><div className="roste"><b>{p.title || "Bez názvu"}</b><span className="faint">{p.channel} · {formatDatumCas(new Date(p.published_at), k.tz)}</span></div>
                {p.is_mock ? <span className="stitek stitek-mock">published_mock</span> : <span className="stitek stitek-dobre">zveřejněno</span>}
                {p.metrics && <span className="faint">dosah {p.metrics.reach ?? "–"}</span>}</li>
            ))}</ul>
          )}
        </section>
        {data.chyby.length > 0 && (
          <section className="karta">
            <h3>Chyby</h3>
            <ul className="seznam">{data.chyby.map((i) => (
              <li key={i.id}><div className="roste"><b><a href={`/${v.slug}/obsah/${i.id}`}>{i.title || "Bez názvu"}</a></b></div><Stav s={i.status} /></li>
            ))}</ul>
          </section>
        )}
        {data.napady.length > 0 && (
          <section className="karta">
            <h3>Schránka nápadů</h3>
            <ul className="seznam">{data.napady.map((n) => (
              <li key={n.id}><div className="roste">{n.text}</div><a className="btn btn-male" href={`/${v.slug}/tvorba?napad=${n.id}`}>Vytvořit</a></li>
            ))}</ul>
            <a className="faint" href={`/${v.slug}/kampane#napady`}>Všechny nápady</a>
          </section>
        )}
      </div>
    </>
  );
}
