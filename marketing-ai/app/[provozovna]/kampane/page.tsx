import { formatDatum, formatDatumCas } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { automatizaceAkce, kampanAkce, napadAkce, spustitAutomatizaciAkce } from "./akce";

export const dynamic = "force-dynamic";

const DRUHY_AUTOMATIZACI: Record<string, { label: string; popis: string }> = {
  daily_story_from_menu: { label: "Denní Story z aktuálního menu", popis: "Každý pracovní den ráno vytvoří návrh Story z potvrzeného denního menu a pošle ke schválení." },
  weekend_menu_promo: { label: "Čtvrteční/páteční propagace víkendového menu", popis: "Vytvoří návrh pozvánky na víkend z potvrzeného víkendového menu." },
  recurring_campaign: { label: "Opakovaná kampaň", popis: "Z aktivní kampaně vytváří návrhy podle nastaveného rytmu." },
  evergreen_queue: { label: "Fronta evergreen obsahu", popis: "Doplňuje mezery v kalendáři evergreen příspěvky s upozorněním na zastaralou cenu nebo datum." },
  weekly_report: { label: "Týdenní report", popis: "Každé pondělí připraví souhrn: co zopakovat, co změnit." },
};

export default async function Kampane({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const [kampane, automatizace, napady, menuKinds] = await Promise.all([
      tx.q<{ id: string; name: string; goal: string; kind: string; pillar: string; starts_on: string | null; ends_on: string | null; status: string; auto_publish: boolean; n: number; published: number }>(
        `select c.*, (select count(*)::int from marketing.content_items i where i.campaign_id = c.id) as n, (select count(*)::int from marketing.content_items i where i.campaign_id = c.id and i.status = 'published') as published
           from marketing.campaigns c where c.venue_id = $1 and c.status <> 'archived' order by c.created_at desc`, [v.id]),
      tx.q<{ id: string; kind: string; name: string; is_enabled: boolean; owner: string | null; schedule: string; last_run_at: string | null; last_result: string | null; next_run_at: string | null; paused_at: string | null; run_history: unknown[] }>(
        "select a.*, p.display_name as owner from marketing.automations a left join marketing.profiles p on p.user_id = a.owner_id where a.venue_id = $1 order by a.created_at", [v.id]),
      tx.q<{ id: string; text: string; pillar: string; status: string; created_at: string }>("select id, text, pillar, status, created_at from marketing.ideas where venue_id = $1 order by status, created_at desc limit 50", [v.id]),
      tx.q<{ kind: string }>("select distinct kind from marketing.menus where venue_id = $1 and status = 'confirmed'", [v.id]),
    ]);
    return { kampane, automatizace, napady, menuKinds: menuKinds.map((m) => m.kind) };
  });
  const smi = muze(k, "campaigns.manage");

  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Kampaně a automatizace</h1><p>Každá automatizace má vypínač, vlastníka, provozovnu, poslední a příští spuštění. Automatické publikování je vždy zvlášť a vědomě zapnuté nastavení konkrétní kampaně.</p></div></div>
      <Hlasky sp={sp} />

      <section className="karta">
        <h2>Kampaně</h2>
        {data.kampane.length === 0 ? <p className="muted">Zatím žádná kampaň. Kampaň vznikne i z <a href={`/${v.slug}/tvorba?rezim=kampan`}>kampaňového režimu tvorby</a>.</p> : (
          <div className="tabulka-obal"><table className="tabulka">
            <thead><tr><th>Kampaň</th><th>Cíl</th><th>Termín</th><th>Obsah</th><th>Auto-publikace</th><th>Stav</th></tr></thead>
            <tbody>{data.kampane.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="faint">{c.kind} · {c.pillar}</div></td><td className="male">{c.goal}</td>
                <td>{c.starts_on ? formatDatum(c.starts_on) : "—"}{c.ends_on ? ` – ${formatDatum(c.ends_on)}` : ""}</td>
                <td><a href={`/${v.slug}/kalendar?kampan=${c.id}`}>{c.n} položek</a> · {c.published} zveřejněno</td>
                <td>{smi ? <form action={kampanAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="auto_publish" value={c.auto_publish ? "0" : "1"} /><button className={`btn btn-male${c.auto_publish ? " btn-bad" : ""}`}>{c.auto_publish ? "Zapnuto — vypnout" : "Vypnuto (výchozí)"}</button></form> : c.auto_publish ? "zapnuto" : "vypnuto"}</td>
                <td>{smi ? <form action={kampanAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={c.id} /><select name="status" defaultValue={c.status} onChange={undefined}><option value="draft">koncept</option><option value="active">aktivní</option><option value="paused">pozastaveno</option><option value="finished">ukončeno</option><option value="archived">archiv</option></select> <button className="btn btn-male">Uložit</button></form> : c.status}</td>
              </tr>
            ))}</tbody></table></div>
        )}
        {smi && (
          <form action={kampanAkce} style={{ marginTop: 12 }}>
            <input type="hidden" name="slug" value={v.slug} />
            <div className="radek radek-3">
              <div className="pole"><label htmlFor="name">Nová kampaň</label><input id="name" name="name" placeholder="název" required /></div>
              <div className="pole"><label htmlFor="goal">Cíl</label><input id="goal" name="goal" placeholder="např. naplnit čtvrteční večery" /></div>
              <div className="pole"><label htmlFor="pillar">Pilíř</label><select id="pillar" name="pillar" defaultValue="akce"><option value="menu">Menu</option><option value="lide">Lidé</option><option value="atmosfera">Atmosféra</option><option value="akce">Akce</option><option value="zakulisi">Zákulisí</option><option value="prodej">Prodej</option></select></div>
              <div className="pole"><label htmlFor="starts_on">Od</label><input id="starts_on" name="starts_on" type="date" /></div>
              <div className="pole"><label htmlFor="ends_on">Do</label><input id="ends_on" name="ends_on" type="date" /></div>
              <div className="pole"><label>&nbsp;</label><button className="btn btn-primary">Založit kampaň</button></div>
            </div>
          </form>
        )}
      </section>

      <section className="karta">
        <h2>Automatizace</h2>
        <div className="mrizka mrizka-2">
          {data.automatizace.map((a) => (
            <div key={a.id} className="karta" style={{ margin: 0 }}>
              <h3>{a.name} {a.is_enabled ? <span className="stitek stitek-dobre">zapnuto</span> : <span className="stitek">vypnuto</span>}</h3>
              <p className="faint">{DRUHY_AUTOMATIZACI[a.kind]?.popis ?? a.kind}</p>
              <p className="male">Vlastník: {a.owner ?? "—"} · Rytmus: {a.schedule || "—"}<br />Poslední běh: {a.last_run_at ? formatDatumCas(new Date(a.last_run_at), k.tz) : "nikdy"}{a.last_result ? ` (${a.last_result})` : ""}<br />Příští běh: {a.next_run_at ? formatDatumCas(new Date(a.next_run_at), k.tz) : a.is_enabled ? "podle rytmu (spouští cron / n8n)" : "—"}</p>
              {Array.isArray(a.run_history) && a.run_history.length > 0 && <details><summary className="faint">Historie ({a.run_history.length})</summary><ul className="seznam male">{(a.run_history as { at: string; result: string }[]).slice(-5).reverse().map((h, i) => <li key={i}>{formatDatumCas(new Date(h.at), k.tz)} · {h.result}</li>)}</ul></details>}
              {smi && (
                <div className="btn-radek">
                  <form action={automatizaceAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="enabled" value={a.is_enabled ? "0" : "1"} /><button className="btn btn-male">{a.is_enabled ? "Pozastavit" : "Zapnout"}</button></form>
                  <form action={spustitAutomatizaciAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={a.id} /><button className="btn btn-male btn-tiche">Spustit teď</button></form>
                </div>
              )}
            </div>
          ))}
        </div>
        {smi && (
          <form action={automatizaceAkce} style={{ marginTop: 12 }}>
            <input type="hidden" name="slug" value={v.slug} />
            <div className="radek radek-3">
              <div className="pole"><label htmlFor="kind">Nová automatizace</label><select id="kind" name="kind">{Object.entries(DRUHY_AUTOMATIZACI).map(([kk, d]) => <option key={kk} value={kk}>{d.label}</option>)}</select></div>
              <div className="pole"><label htmlFor="schedule">Rytmus (popis)</label><input id="schedule" name="schedule" placeholder="Po–Pá 09:30" /></div>
              <div className="pole"><label>&nbsp;</label><button className="btn">Přidat (vypnutou)</button></div>
            </div>
            <p className="faint">Potvrzená menu k dispozici: {data.menuKinds.join(", ") || "žádná"}. Automatizace vytvářejí NÁVRHY ke schválení; nikdy nepublikují bez schválení, pokud kampaň nemá výslovně zapnutou auto-publikaci.</p>
          </form>
        )}
      </section>

      <section className="karta" id="napady">
        <h2>Schránka nápadů</h2>
        {muze(k, "content.create") && (
          <form action={napadAkce} className="btn-radek">
            <input type="hidden" name="slug" value={v.slug} />
            <input name="text" placeholder="Nápad na obsah…" required style={{ flex: 1, minWidth: 220 }} />
            <select name="pillar" defaultValue="akce"><option value="menu">Menu</option><option value="lide">Lidé</option><option value="atmosfera">Atmosféra</option><option value="akce">Akce</option><option value="zakulisi">Zákulisí</option><option value="prodej">Prodej</option></select>
            <button className="btn btn-male">Přidat</button>
          </form>
        )}
        <ul className="seznam">{data.napady.map((n) => (
          <li key={n.id}><div className="roste"><span className={n.status !== "new" ? "faint" : ""}>{n.text}</span> <span className="stitek">{n.pillar}</span> {n.status !== "new" && <span className="stitek">{n.status}</span>}</div>
            {n.status === "new" && muze(k, "content.create") && <><a className="btn btn-male" href={`/${v.slug}/tvorba?napad=${n.id}`}>Vytvořit</a><form action={napadAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={n.id} /><input type="hidden" name="status" value="dismissed" /><button className="btn btn-male btn-tiche">Zahodit</button></form></>}</li>
        ))}</ul>
      </section>
    </>
  );
}
