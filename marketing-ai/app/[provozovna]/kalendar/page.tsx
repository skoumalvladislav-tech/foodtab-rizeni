import { casVPasmu, datumVPasmu, dnes, nazevMesice, posunDne } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { Mrizka } from "./mrizka";

export const dynamic = "force-dynamic";

const PILIRE: Record<string, string> = { menu: "Menu", lide: "Lidé", atmosfera: "Atmosféra", akce: "Akce", zakulisi: "Zákulisí", prodej: "Prodej" };

export default async function Kalendar({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const today = dnes(k.tz);
  const [ty, tm] = today.split("-").map(Number);
  const rok = Number(sp.rok ?? ty);
  const mesic = Number(sp.mesic ?? tm);
  const pohled = sp.pohled === "tyden" ? "tyden" : "mesic";
  const od = pohled === "mesic" ? `${rok}-${String(mesic).padStart(2, "0")}-01` : (sp.od ?? today);
  const doD = pohled === "mesic" ? posunDne(`${mesic === 12 ? rok + 1 : rok}-${String(mesic === 12 ? 1 : mesic + 1).padStart(2, "0")}-01`, -1) : posunDne(od, 6);
  const f = { kanal: sp.kanal ?? "", kampan: sp.kampan ?? "", stav: sp.stav ?? "", vsechny: sp.vsechny === "1" };

  const data = await withUser(k.session.userId, async (tx) => {
    const polozky = await tx.q<{ id: string; title: string; status: string; scheduled_at: string | null; channels: string[]; pillar: string; venue_slug: string; venue_name: string; venue_color: string; campaign_name: string | null }>(
      `select i.id, i.title, i.status, i.scheduled_at, i.channels, i.pillar, ve.slug as venue_slug, ve.name as venue_name, ve.color as venue_color, c.name as campaign_name
         from marketing.content_items i join marketing.venues ve on ve.id = i.venue_id left join marketing.campaigns c on c.id = i.campaign_id
        where i.organization_id = $1 and ($2 or i.venue_id = $3) and i.status <> 'archived'
          and i.scheduled_at >= ($4::date)::timestamp at time zone $6 and i.scheduled_at < ($5::date + 1)::timestamp at time zone $6
          and ($7 = '' or $7 = any(i.channels)) and ($8 = '' or c.id::text = $8) and ($9 = '' or i.status = $9)
        order by i.scheduled_at`, [k.organization.id, f.vsechny, v.id, od, doD, k.tz, f.kanal, f.kampan, f.stav]);
    const koncepty = await tx.q<{ id: string; title: string; status: string }>("select id, title, status from marketing.content_items where venue_id = $1 and scheduled_at is null and status not in ('archived','published','cancelled') order by updated_at desc limit 20", [v.id]);
    const kampane = await tx.q<{ id: string; name: string }>("select id, name from marketing.campaigns where venue_id = $1 order by name", [v.id]);
    const evergreen = await tx.q<{ id: string; title: string }>("select id, title from marketing.content_items where venue_id = $1 and is_evergreen and status not in ('archived') order by updated_at desc limit 10", [v.id]);
    return { polozky, koncepty, kampane, evergreen };
  });

  // Varování: mezera > 7 dní nebo > 3 publikace v jeden den
  const dny = new Map<string, number>();
  for (const p of data.polozky) if (p.scheduled_at) { const d = datumVPasmu(new Date(p.scheduled_at), k.tz); dny.set(d, (dny.get(d) ?? 0) + 1); }
  const seraz = [...dny.keys()].sort();
  const varovani: string[] = [];
  for (let i = 1; i < seraz.length; i++) {
    const diff = (Date.parse(seraz[i]) - Date.parse(seraz[i - 1])) / 86400000;
    if (diff > 7) varovani.push(`Mezera ${diff} dní mezi ${seraz[i - 1]} a ${seraz[i]}.`);
  }
  for (const [d, n] of dny) if (n > 3) varovani.push(`${d}: ${n} příspěvků v jeden den — zvažte rozložení.`);

  const prev = mesic === 1 ? { rok: rok - 1, mesic: 12 } : { rok, mesic: mesic - 1 };
  const next = mesic === 12 ? { rok: rok + 1, mesic: 1 } : { rok, mesic: mesic + 1 };

  return (
    <>
      <div className="hlavicka">
        <div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Kalendář obsahu</h1><p>Koncepty, schválené, naplánované i zveřejněné. Přetažením přesunete termín (jen s právem plánovat).</p></div>
        <div className="btn-radek">
          <a className="btn btn-male" href={`/${v.slug}/kalendar?rok=${prev.rok}&mesic=${prev.mesic}`}>‹</a>
          <b>{nazevMesice(mesic)} {rok}</b>
          <a className="btn btn-male" href={`/${v.slug}/kalendar?rok=${next.rok}&mesic=${next.mesic}`}>›</a>
          <a className={`btn btn-male${pohled === "mesic" ? " btn-primary" : ""}`} href={`/${v.slug}/kalendar`}>Měsíc</a>
          <a className={`btn btn-male${pohled === "tyden" ? " btn-primary" : ""}`} href={`/${v.slug}/kalendar?pohled=tyden&od=${today}`}>Týden</a>
        </div>
      </div>
      <Hlasky sp={sp} />
      <form method="get" className="karta chip-radek" style={{ alignItems: "center" }}>
        <input type="hidden" name="rok" value={rok} /><input type="hidden" name="mesic" value={mesic} />{pohled === "tyden" && <><input type="hidden" name="pohled" value="tyden" /><input type="hidden" name="od" value={od} /></>}
        <select name="kanal" defaultValue={f.kanal}><option value="">Všechny kanály</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select>
        <select name="kampan" defaultValue={f.kampan}><option value="">Všechny kampaně</option>{data.kampane.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="stav" defaultValue={f.stav}><option value="">Všechny stavy</option><option value="draft">Koncept</option><option value="awaiting_approval">Čeká na schválení</option><option value="approved">Schváleno</option><option value="scheduled">Naplánováno</option><option value="published">Zveřejněno</option><option value="publish_failed">Selhalo</option></select>
        <label className="chip"><input type="checkbox" name="vsechny" value="1" defaultChecked={f.vsechny} /> všechny provozovny</label>
        <button className="btn btn-male">Filtrovat</button>
        <span className="faint">Pilíře: {Object.values(PILIRE).join(" · ")}</span>
      </form>
      {varovani.length > 0 && <div className="hlaska hlaska-pozor male">{varovani.join(" ")}</div>}

      <Mrizka
        od={od} doD={doD} pohled={pohled} dnes={today} slug={v.slug} muzePlanovat={muze(k, "content.schedule")}
        polozky={data.polozky.map((p) => ({ id: p.id, title: p.title, status: p.status, datum: datumVPasmu(new Date(p.scheduled_at!), k.tz), cas: casVPasmu(new Date(p.scheduled_at!), k.tz), channels: p.channels, pillar: PILIRE[p.pillar] ?? p.pillar, venueSlug: p.venue_slug, venueName: p.venue_name, venueColor: p.venue_color, campaign: p.campaign_name }))}
      />

      <div className="mrizka mrizka-2" style={{ marginTop: 14 }}>
        <section className="karta">
          <h3>Koncepty bez data</h3>
          {data.koncepty.length === 0 ? <p className="muted">Žádné.</p> : <ul className="seznam">{data.koncepty.map((c) => <li key={c.id}><div className="roste"><a href={`/${v.slug}/obsah/${c.id}`}>{c.title || "Bez názvu"}</a></div><span className="stitek">{c.status}</span></li>)}</ul>}
        </section>
        <section className="karta">
          <h3>Fronta evergreen obsahu</h3>
          {data.evergreen.length === 0 ? <p className="muted">Označte obsah bez data a ceny jako evergreen — půjde ho kdykoli znovu naplánovat. Chytré znovupoužití upozorní na zastaralou cenu nebo datum.</p> : <ul className="seznam">{data.evergreen.map((c) => <li key={c.id}><div className="roste"><a href={`/${v.slug}/obsah/${c.id}`}>{c.title}</a></div></li>)}</ul>}
        </section>
      </div>
    </>
  );
}
