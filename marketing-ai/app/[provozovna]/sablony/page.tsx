import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { FORMATY } from "@/lib/formaty";

import { Hlasky } from "../../ui";
import { Kontext } from "../kontext";
import { duplikovatSablonuAkce, nastavitVychoziAkce, ulozitSablonuAkce } from "./akce";

export const dynamic = "force-dynamic";

const KATEGORIE: Record<string, string> = { menu: "A. Menu", akce: "B. Gastroakce a tematické kampaně", prubezne: "C. Průběžný obsah" };

export default async function Sablony({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const sablony = await tx.q<{ id: string; key: string; name: string; category: string; description: string; pillar: string; organization_id: string | null; parent_template_id: string | null; formats: string[]; inputs: { key: string; label: string; type: string; required?: boolean }[]; text_rules: Record<string, unknown>; checklist: string[]; version: number; purpose: string }>(
      `select t.id, t.key, t.name, t.category, t.description, t.pillar, t.organization_id, t.parent_template_id, tv.formats, tv.brand_tokens->'inputs' as inputs, tv.text_rules, tv.brand_tokens->'checklist' as checklist, tv.version, tv.brand_tokens->>'purpose' as purpose
         from marketing.templates t join marketing.template_versions tv on tv.template_id = t.id
        where t.archived_at is null and (t.organization_id is null or t.organization_id = $1) and (t.venue_id is null or t.venue_id = $2)
          and tv.version = (select max(version) from marketing.template_versions where template_id = t.id)
        order by t.category, t.organization_id nulls first, t.name`, [k.organization.id, v.id]);
    const vychozi = await tx.q<{ purpose: string; template_id: string }>("select purpose, template_id from marketing.venue_template_defaults where venue_id = $1", [v.id]);
    return { sablony, vychozi };
  });
  const detail = sp.sablona ? data.sablony.find((s) => s.id === sp.sablona) : null;
  const edit = muze(k, "templates.manage");

  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Knihovna šablon</h1><p>Šablona není obrázek: má vstupy, rozvržení, formáty a pravidla pro dlouhé texty. Brand kit se dosazuje automaticky.</p></div></div>
      <Hlasky sp={sp} />
      {detail && (
        <section className="karta" style={{ borderColor: "var(--mosaz)" }}>
          <div className="hlavicka"><div><h2>{detail.name} {detail.organization_id ? <span className="stitek stitek-mosaz">vlastní</span> : <span className="stitek">FoodTab</span>} <span className="faint">v{detail.version}</span></h2><p>{detail.description}</p></div>
            <div className="btn-radek">
              <a className="btn btn-primary" href={`/${v.slug}/tvorba?sablona=${detail.key}`}>Použít v tvorbě</a>
              <a className="btn btn-male" href={`/${v.slug}/sablony`}>Zavřít</a>
            </div></div>
          <div className="mrizka mrizka-2">
            <div>
              <h3>Vstupy</h3>
              <ul className="seznam">{(detail.inputs ?? []).map((i) => <li key={i.key}><div className="roste"><b>{i.label}{i.required ? " *" : ""}</b><span className="faint">{i.type}</span></div></li>)}</ul>
              <h3 style={{ marginTop: 14 }}>Kontrolní seznam před renderem</h3>
              <ul className="seznam">{(detail.checklist ?? []).map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div>
              <h3>Výstupy</h3>
              <div className="chip-radek">{detail.formats.map((f) => <span key={f} className="chip">{FORMATY[f as keyof typeof FORMATY]?.label ?? f}</span>)}</div>
              <h3 style={{ marginTop: 14 }}>Pravidla textu</h3>
              <p className="male">Max. délka titulku {String(detail.text_rules.titleMaxChars)} znaků · min. písmo {String(detail.text_rules.minFontPx)} px · {String(detail.text_rules.itemsPerSlide)} položek na slide · dlouhé menu se dělí na slidy · názvy se nikdy neusekávají.</p>
              {edit && (
                <>
                  {!detail.organization_id ? (
                    <form action={duplikovatSablonuAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={detail.id} /><button className="btn">Duplikovat jako vlastní šablonu</button></form>
                  ) : (
                    <form action={ulozitSablonuAkce} style={{ marginTop: 8 }}>
                      <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={detail.id} />
                      <div className="pole"><label htmlFor="name">Název</label><input id="name" name="name" defaultValue={detail.name} /></div>
                      <div className="pole"><label htmlFor="description">Popis</label><textarea id="description" name="description" defaultValue={detail.description} /></div>
                      <div className="pole"><label>Povolené výstupy</label><div className="chip-radek">{Object.values(FORMATY).map((f) => <label key={f.key} className="chip"><input type="checkbox" name="formats" value={f.key} defaultChecked={detail.formats.includes(f.key)} /> {f.label}</label>)}</div></div>
                      <div className="radek radek-3">
                        <div className="pole"><label htmlFor="itemsPerSlide">Položek na slide</label><input id="itemsPerSlide" name="itemsPerSlide" type="number" min={1} max={10} defaultValue={Number(detail.text_rules.itemsPerSlide ?? 5)} /></div>
                        <div className="pole"><label htmlFor="minFontPx">Min. písmo (px)</label><input id="minFontPx" name="minFontPx" type="number" min={20} max={60} defaultValue={Number(detail.text_rules.minFontPx ?? 28)} /></div>
                      </div>
                      <div className="btn-radek"><button className="btn btn-primary">Uložit jako novou verzi šablony</button><button className="btn btn-tiche" name="archiv" value="1">Archivovat</button></div>
                    </form>
                  )}
                  <form action={nastavitVychoziAkce} style={{ marginTop: 8 }}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={detail.id} /><input type="hidden" name="purpose" value={detail.purpose ?? detail.key} />
                    <button className="btn btn-male">{data.vychozi.some((x) => x.template_id === detail.id) ? "Je výchozí pro tento účel ✓" : "Nastavit jako výchozí pro provozovnu"}</button></form>
                </>
              )}
            </div>
          </div>
        </section>
      )}
      {Object.keys(KATEGORIE).map((cat) => (
        <section key={cat} className="karta">
          <h2>{KATEGORIE[cat]}</h2>
          <div className="mrizka mrizka-3">
            {data.sablony.filter((s) => s.category === cat).map((s) => (
              <a key={s.id} href={`/${v.slug}/sablony?sablona=${s.id}`} className="karta" style={{ margin: 0, textDecoration: "none", color: "inherit", borderColor: sp.sablona === s.id ? "var(--mosaz)" : undefined }}>
                <h3>{s.name} {s.organization_id && <span className="stitek stitek-mosaz">vlastní</span>} {data.vychozi.some((x) => x.template_id === s.id) && <span className="stitek stitek-dobre">výchozí</span>}</h3>
                <p className="faint">{s.description.slice(0, 120)}{s.description.length > 120 ? "…" : ""}</p>
                <div className="chip-radek">{s.formats.slice(0, 4).map((f) => <span key={f} className="stitek">{FORMATY[f as keyof typeof FORMATY]?.label ?? f}</span>)}{s.formats.length > 4 && <span className="stitek">+{s.formats.length - 4}</span>}</div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
