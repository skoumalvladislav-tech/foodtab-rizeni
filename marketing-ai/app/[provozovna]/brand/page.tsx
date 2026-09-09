import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { podepsatSoubor } from "@/lib/storage/podpis";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { ulozitBrandAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Brand({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const bk = await tx.one<Record<string, unknown> & { colors: Record<string, string>; fonts: Record<string, string>; logo_placement: Record<string, unknown>; preferred_ctas: string[]; allowed_phrases: string[]; forbidden_phrases: string[]; default_hashtags: string[]; is_demo: boolean; logo_light_asset_id: string | null; logo_dark_asset_id: string | null; reels_intro_asset_id: string | null; reels_outro_asset_id: string | null }>("select * from marketing.brand_kits where venue_id = $1", [v.id]);
    const loga = await tx.q<{ id: string; title: string; kind: string }>("select a.id, a.title, a.kind from marketing.media_assets a left join marketing.media_collections c on c.id = a.collection_id where a.organization_id = $1 and (a.venue_id = $2 or a.venue_id is null) and a.archived_at is null and (c.key = 'loga' or a.kind = 'video') order by a.created_at desc limit 40", [k.organization.id, v.id]);
    return { bk, loga };
  });
  const bk = data.bk;
  const edit = muze(k, "brand.manage");
  const s = (key: string) => String(bk?.[key] ?? "");
  const arr = (key: string) => ((bk?.[key] as string[] | undefined) ?? []).join(", ");
  const c = bk?.colors ?? {};
  const sel = (name: string, cur: string | null, kind: "image" | "video") => (
    <select name={name} defaultValue={cur ?? ""} disabled={!edit}><option value="">— žádné —</option>{data.loga.filter((l) => l.kind === kind).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
  );

  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Brand kit provozovny</h1><p>Použije se automaticky při každém generování. Prázdná pole se do modelu neposílají; adresy a kontakty se vypisují jen do tisku a patičky.</p></div></div>
      <Hlasky sp={sp} />
      {bk?.is_demo && <div className="hlaska hlaska-pozor"><b>Demo hodnoty.</b> Barvy, tón a hashtagy jsou návrh k úpravě. Adresa, telefon a odkazy jsou záměrně prázdné — nevymýšlíme je, doplňte skutečné.</div>}
      <form action={ulozitBrandAkce}>
        <input type="hidden" name="slug" value={v.slug} />
        <div className="mrizka mrizka-2">
          <section className="karta">
            <h3>Identita</h3>
            <div className="pole"><label htmlFor="name">Název</label><input id="name" name="name" defaultValue={s("name")} readOnly={!edit} required /></div>
            <div className="pole"><label htmlFor="short_description">Krátký popis</label><textarea id="short_description" name="short_description" defaultValue={s("short_description")} readOnly={!edit} /></div>
            <div className="radek radek-2">
              <div className="pole"><label>Logo světlé</label>{sel("logo_light_asset_id", bk?.logo_light_asset_id ?? null, "image")}{bk?.logo_light_asset_id && <img src={podepsatSoubor(bk.logo_light_asset_id)} alt="logo" style={{ maxHeight: 48, marginTop: 6 }} />}</div>
              <div className="pole"><label>Logo tmavé</label>{sel("logo_dark_asset_id", bk?.logo_dark_asset_id ?? null, "image")}</div>
            </div>
            <p className="faint">Loga nahrajte do složky „Loga a grafické prvky“ v mediální knihovně.</p>
            <div className="radek radek-3">
              {[["primary", "Hlavní"], ["secondary", "Vedlejší"], ["accent", "Přízvuk"], ["background", "Pozadí"], ["text", "Text"]].map(([key, l]) => (
                <div key={key} className="pole"><label htmlFor={`c_${key}`}>{l}</label><div style={{ display: "flex", gap: 6 }}><input id={`c_${key}`} name={`c_${key}`} type="color" defaultValue={c[key] ?? "#916624"} disabled={!edit} style={{ width: 52, padding: 2 }} /><input name={`ch_${key}`} defaultValue={c[key] ?? ""} readOnly={!edit} pattern="#[0-9a-fA-F]{6}" placeholder="#rrggbb" /></div></div>
              ))}
            </div>
            <div className="radek radek-2">
              <div className="pole"><label htmlFor="f_heading">Písmo nadpisů</label><input id="f_heading" name="f_heading" defaultValue={bk?.fonts?.heading ?? ""} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="f_body">Písmo textu</label><input id="f_body" name="f_body" defaultValue={bk?.fonts?.body ?? ""} readOnly={!edit} /></div>
            </div>
          </section>
          <section className="karta">
            <h3>Kontakt a odkazy</h3>
            <div className="pole"><label htmlFor="address">Adresa</label><input id="address" name="address" defaultValue={s("address")} readOnly={!edit} placeholder="doplňte skutečnou adresu" /></div>
            <div className="radek radek-2">
              <div className="pole"><label htmlFor="phone">Telefon</label><input id="phone" name="phone" defaultValue={s("phone")} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="website_url">Web</label><input id="website_url" name="website_url" type="url" defaultValue={s("website_url")} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="reservation_url">Rezervace</label><input id="reservation_url" name="reservation_url" type="url" defaultValue={s("reservation_url")} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="ordering_url">Objednávka online</label><input id="ordering_url" name="ordering_url" type="url" defaultValue={s("ordering_url")} readOnly={!edit} /></div>
            </div>
            <h3>Tón komunikace</h3>
            <div className="pole"><label htmlFor="tone_of_voice">Tón hlasu</label><textarea id="tone_of_voice" name="tone_of_voice" defaultValue={s("tone_of_voice")} readOnly={!edit} /></div>
            <div className="pole"><label htmlFor="preferred_ctas">Preferované výzvy (čárkou)</label><input id="preferred_ctas" name="preferred_ctas" defaultValue={arr("preferred_ctas")} readOnly={!edit} /></div>
            <div className="pole"><label htmlFor="allowed_phrases">Povolené výrazy</label><input id="allowed_phrases" name="allowed_phrases" defaultValue={arr("allowed_phrases")} readOnly={!edit} /></div>
            <div className="pole"><label htmlFor="forbidden_phrases">Zakázané výrazy</label><input id="forbidden_phrases" name="forbidden_phrases" defaultValue={arr("forbidden_phrases")} readOnly={!edit} /></div>
            <div className="pole"><label htmlFor="default_hashtags">Výchozí hashtagy</label><input id="default_hashtags" name="default_hashtags" defaultValue={arr("default_hashtags")} readOnly={!edit} /></div>
            <div className="pole"><label htmlFor="signature">Podpis provozovny</label><input id="signature" name="signature" defaultValue={s("signature")} readOnly={!edit} /></div>
          </section>
          <section className="karta">
            <h3>Umístění loga a bezpečné zóny</h3>
            <div className="radek radek-2">
              <div className="pole"><label htmlFor="logo_position">Pozice loga</label><select id="logo_position" name="logo_position" defaultValue={String(bk?.logo_placement?.position ?? "bottom-right")} disabled={!edit}><option value="top-left">vlevo nahoře</option><option value="top-right">vpravo nahoře</option><option value="bottom-left">vlevo dole</option><option value="bottom-right">vpravo dole</option></select></div>
              <div className="pole"><label htmlFor="safe_zone">Bezpečná zóna (%)</label><input id="safe_zone" name="safe_zone" type="number" min={0} max={20} defaultValue={Number(bk?.logo_placement?.safe_zone_percent ?? 8)} readOnly={!edit} /></div>
            </div>
          </section>
          <section className="karta">
            <h3>Video: intro/outro, hudba, hlas</h3>
            <div className="radek radek-2">
              <div className="pole"><label>Intro pro Reels</label>{sel("reels_intro_asset_id", bk?.reels_intro_asset_id ?? null, "video")}</div>
              <div className="pole"><label>Outro pro Reels</label>{sel("reels_outro_asset_id", bk?.reels_outro_asset_id ?? null, "video")}</div>
              <div className="pole"><label htmlFor="music_style">Hudební styl</label><input id="music_style" name="music_style" defaultValue={s("music_style")} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="voice_style">Hlasový styl</label><input id="voice_style" name="voice_style" defaultValue={s("voice_style")} readOnly={!edit} /></div>
              <div className="pole"><label htmlFor="default_video_seconds">Výchozí délka videa (s)</label><input id="default_video_seconds" name="default_video_seconds" type="number" min={3} max={90} defaultValue={Number(bk?.default_video_seconds ?? 15)} readOnly={!edit} /></div>
            </div>
            <p className="faint">Hudba se použije jen z knihovny „Hudba a zvuky s licencí“ s vyplněnou licencí.</p>
          </section>
        </div>
        {edit && <div className="btn-radek" style={{ marginTop: 14 }}><button className="btn btn-primary">Uložit brand kit</button></div>}
      </form>
    </>
  );
}
