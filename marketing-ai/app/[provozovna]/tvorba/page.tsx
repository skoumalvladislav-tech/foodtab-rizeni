import { dnes, nejblizsiSobota, posunDne } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { FORMATY } from "@/lib/formaty";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { vytvoritANavrhnout } from "./akce";
import { VyberSablony } from "./vyber-sablony";

export const dynamic = "force-dynamic";

/**
 * Průvodce vytvořením: podklady → šablona/zadání → (návrh, editor,
 * schválení, termín pokračují na detailu obsahu).
 *
 * Rychlý režim = fotka + jedna věta. Kampaňový režim = cíl + termín →
 * série (pozvánka, připomínka, poslední výzva, poděkování).
 */
export default async function Tvorba({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  if (!muze(k, "content.create")) return <div className="hlaska hlaska-bad">Na vytváření obsahu nemáte oprávnění.</div>;
  const rezim = sp.rezim === "rychly" ? "rychly" : sp.rezim === "kampan" ? "kampan" : "pruvodce";

  const data = await withUser(k.session.userId, async (tx) => {
    const [media, sablony, menu, napad, kampane] = await Promise.all([
      tx.q<{ id: string; title: string; kind: string; is_hero: boolean; mime_type: string }>(
        "select id, title, kind, is_hero, mime_type from marketing.media_assets where (venue_id = $1 or venue_id is null) and organization_id = $2 and archived_at is null and kind in ('image','video') order by is_hero desc, created_at desc limit 60",
        [v.id, k.organization.id]),
      tx.q<{ id: string; key: string; name: string; category: string; description: string; purpose: string; formats: string[]; inputs: unknown; organization_id: string | null }>(
        `select t.id, t.key, t.name, t.category, t.description, tv.brand_tokens->>'purpose' as purpose, tv.formats, tv.brand_tokens->'inputs' as inputs, t.organization_id
           from marketing.templates t join marketing.template_versions tv on tv.template_id = t.id
          where t.archived_at is null and (t.organization_id is null or t.organization_id = $1)
            and tv.version = (select max(version) from marketing.template_versions where template_id = t.id)
          order by t.category, t.name`, [k.organization.id]),
      tx.q<{ id: string; title: string; kind: string; valid_from: string | null; valid_to: string | null; status: string }>(
        "select id, title, kind, valid_from::text, valid_to::text, status from marketing.menus where venue_id = $1 and status <> 'archived' order by valid_from desc nulls last limit 20", [v.id]),
      sp.napad ? tx.one<{ text: string; pillar: string; media_asset_ids: string[] }>("select text, pillar, media_asset_ids from marketing.ideas where id = $1", [sp.napad]) : Promise.resolve(null),
      tx.q<{ id: string; name: string }>("select id, name from marketing.campaigns where venue_id = $1 and status in ('active','draft') order by created_at desc", [v.id]),
    ]);
    return { media, sablony, menu, napad, kampane };
  });

  const vychoziSablona = sp.sablona ?? (rezim === "rychly" ? "atmosfera" : "denni_menu");
  const vychoziMenu = sp.menu ?? data.menu.find((m) => m.status === "confirmed")?.id ?? "";

  return (
    <>
      <div className="hlavicka">
        <div>
          <Kontext venue={v} />
          <h1 style={{ marginTop: 8 }}>{rezim === "rychly" ? "Rychlá tvorba" : rezim === "kampan" ? "Kampaňový režim" : "Vytvořit obsah"}</h1>
          <p>{rezim === "rychly" ? "Fotka + jedna věta → hotový návrh." : rezim === "kampan" ? "Cíl + termín + více médií → série obsahu: pozvánka, připomínka, poslední výzva, poděkování." : "Podklady → šablona a zadání → návrhy → úprava → schválení → termín."}</p>
        </div>
        <div className="btn-radek">
          <a className={`btn btn-male${rezim === "pruvodce" ? " btn-primary" : ""}`} href={`/${v.slug}/tvorba`}>Průvodce</a>
          <a className={`btn btn-male${rezim === "rychly" ? " btn-primary" : ""}`} href={`/${v.slug}/tvorba?rezim=rychly`}>Rychlý režim</a>
          <a className={`btn btn-male${rezim === "kampan" ? " btn-primary" : ""}`} href={`/${v.slug}/tvorba?rezim=kampan`}>Kampaň</a>
        </div>
      </div>
      <Hlasky sp={sp} />
      <div className="kroky">
        <span className="on">1 Podklady</span><span className="on">2 Šablona a zadání</span><span>3 Návrhy</span><span>4 Editor</span><span>5 Schválení</span><span>6 Termín</span>
      </div>

      <form action={vytvoritANavrhnout}>
        <input type="hidden" name="venueId" value={v.id} />
        <input type="hidden" name="slug" value={v.slug} />
        <input type="hidden" name="rezim" value={rezim} />

        <section className="karta">
          <h2>1. Podklady</h2>
          <p className="muted">Vyberte fotografie nebo videa z knihovny provozovny. Chybí vám? <a href={`/${v.slug}/media?zpet=tvorba`}>Nahrát nové</a>.</p>
          {data.media.length === 0 ? (
            <div className="hlaska hlaska-pozor">Knihovna je prázdná. Nahrajte první fotografii v <a href={`/${v.slug}/media`}>mediální knihovně</a>.</div>
          ) : (
            <div className="media-mrizka">
              {data.media.map((m, i) => (
                <label key={m.id} className="media-karta">
                  <img src={podepsatSoubor(m.id)} alt={m.title} loading="lazy" />
                  <input type="checkbox" name="media" value={m.id} defaultChecked={sp.napad ? (data.napad?.media_asset_ids ?? []).includes(m.id) : i === 0 || (rezim !== "rychly" && m.is_hero)} />
                  {m.is_hero && <span className="stitek stitek-mosaz hero">hero</span>}
                  <span className="popisek">{m.title}{m.kind === "video" ? " · video" : ""}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="karta">
          <h2>2. {rezim === "rychly" ? "Jedna věta" : "Šablona a zadání"}</h2>
          {rezim !== "rychly" && (
            <VyberSablony sablony={data.sablony} vychozi={vychoziSablona} menu={data.menu} vychoziMenu={vychoziMenu} dnes={dnes(k.tz)} sobota={nejblizsiSobota(k.tz)} nedele={posunDne(nejblizsiSobota(k.tz), 1)} />
          )}
          {rezim === "rychly" && <input type="hidden" name="sablona" value="atmosfera" />}
          <div className="pole">
            <label htmlFor="brief">{rezim === "rychly" ? "Co chcete říct? (jedna věta stačí)" : "Napište běžným jazykem, co chcete vytvořit"}</label>
            <textarea id="brief" name="brief" required={rezim === "rychly"} defaultValue={data.napad?.text ?? ""} placeholder={rezim === "rychly" ? "např. Dnes máme svíčkovou jako od babičky, přijďte na oběd." : "např. Propagovat víkendové menu, důraz na žebra, uvolněný tón, připomenout rezervaci."} />
            <small>Text je podklad, ne pokyn pro model — ceny a data si návrhář bere jen ze schváleného menu a z polí šablony.</small>
          </div>
          {rezim === "kampan" && (
            <div className="radek radek-2">
              <div className="pole"><label htmlFor="kampan_cil">Cíl kampaně</label><input id="kampan_cil" name="kampan_cil" placeholder="např. naplnit sobotní večer" required /></div>
              <div className="pole"><label htmlFor="kampan_termin">Termín akce</label><input id="kampan_termin" name="kampan_termin" type="date" required defaultValue={nejblizsiSobota(k.tz)} /></div>
              <div className="pole"><label htmlFor="kampan_id">Přiřadit k existující kampani</label>
                <select id="kampan_id" name="kampan_id" defaultValue=""><option value="">Nová kampaň</option>{data.kampane.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="pole"><label>Série</label>
                <div className="chip-radek">
                  {[["pozvanka", "Pozvánka (−7 dní)"], ["pripominka", "Připomínka (−2 dny)"], ["posledni", "Poslední výzva (v den)"], ["podekovani", "Poděkování (+1 den)"]].map(([kk, l]) => (
                    <label key={kk} className="chip"><input type="checkbox" name="serie" value={kk} defaultChecked /> {l}</label>
                  ))}
                </div></div>
            </div>
          )}
        </section>

        <section className="karta">
          <h3>Sítě a formáty</h3>
          <div className="radek radek-2">
            <div className="pole">
              <label>Sociální sítě</label>
              <div className="chip-radek">
                <label className="chip"><input type="checkbox" name="kanaly" value="instagram" defaultChecked /> Instagram</label>
                <label className="chip"><input type="checkbox" name="kanaly" value="facebook" defaultChecked /> Facebook</label>
              </div>
            </div>
            <div className="pole">
              <label>Výstupy</label>
              <div className="chip-radek">
                {Object.values(FORMATY).filter((f) => f.channel !== "internal").map((f) => (
                  <label key={f.key} className="chip"><input type="checkbox" name="formaty" value={f.key} defaultChecked={rezim === "rychly" ? f.key === "instagram_feed" || f.key === "facebook_post" : ["instagram_feed", "instagram_story", "facebook_post"].includes(f.key)} /> {f.label}</label>
                ))}
              </div>
              <small>Reel a Story vyžadují 9:16; tiskové PDF jen u menu šablon. Před placeným renderem se zobrazí odhad.</small>
            </div>
          </div>
        </section>

        <div className="btn-radek" style={{ marginTop: 16 }}>
          <button className="btn btn-primary btn-velke" type="submit">Vytvořit návrh</button>
          <span className="faint">Návrh připraví vybraný AI nástroj (v demu interní návrhář). Nic se nezveřejní.</span>
        </div>
      </form>
    </>
  );
}
