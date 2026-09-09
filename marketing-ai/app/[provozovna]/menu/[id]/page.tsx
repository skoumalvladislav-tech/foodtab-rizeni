import { notFound } from "next/navigation";

import { formatDatum } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { ODVOZENE_Z_MENU } from "@/lib/domena/menu";

import { Hlasky, kc } from "../../../ui";
import { Kontext } from "../../kontext";
import { odvoditAkce, potvrditAkce, upravitAkce } from "../akce";

export const dynamic = "force-dynamic";

export default async function MenuDetail({ params, searchParams }: { params: Promise<{ provozovna: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna, id } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const data = await withUser(k.session.userId, async (tx) => {
    const m = await tx.one<{ id: string; kind: string; title: string; valid_from: string | null; valid_to: string | null; status: string; source: string; raw_import: unknown; source_asset_id: string | null; confirmed_at: string | null; confirmer: string | null }>(
      "select m.id, m.kind, m.title, m.valid_from::text, m.valid_to::text, m.status, m.source, m.raw_import, m.source_asset_id, m.confirmed_at, p.display_name as confirmer from marketing.menus m left join marketing.profiles p on p.user_id = m.confirmed_by where m.id = $1 and m.venue_id = $2", [id, v.id]);
    if (!m) return null;
    const days = await tx.q<{ id: string; label: string; day_date: string | null }>("select id, label, day_date::text from marketing.menu_days where menu_id = $1 order by sort_order", [id]);
    const items = await tx.q<{ id: string; menu_day_id: string | null; category: string; name: string; description: string; price_cents: number | null; allergens: string[]; note: string; availability: string; needs_review: boolean; review_reason: string | null }>(
      "select * from marketing.menu_items where menu_id = $1 order by sort_order", [id]);
    return { m, days, items };
  });
  if (!data) notFound();
  const { m, days, items } = data;
  const edit = muze(k, "menu.manage");
  const problem = items.filter((i) => i.needs_review || i.price_cents === null).length;
  const warnings = ((m.raw_import as { warnings?: string[] } | null)?.warnings) ?? [];

  const radek = (it: (typeof items)[number], i: number) => (
    <tr key={it.id} style={it.needs_review || it.price_cents === null ? { background: "var(--pozor-bg)" } : undefined}>
      <td><input type="hidden" name={`id_${i}`} value={it.id} /><input type="hidden" name={`day_${i}`} value={it.menu_day_id ?? ""} />{edit ? <select name={`cat_${i}`} defaultValue={it.category}><option value="polevka">Polévka</option><option value="predkrm">Předkrm</option><option value="hlavni">Hlavní</option><option value="dezert">Dezert</option><option value="napoj">Nápoj</option><option value="ostatni">Ostatní</option></select> : it.category}</td>
      <td>{edit ? <input name={`name_${i}`} defaultValue={it.name} /> : it.name}{it.needs_review && <div className="stitek stitek-pozor">vyžaduje kontrolu{it.review_reason ? `: ${it.review_reason}` : ""}</div>}</td>
      <td>{edit ? <input name={`desc_${i}`} defaultValue={it.description} /> : it.description}</td>
      <td>{edit ? <input name={`price_${i}`} type="number" min={0} inputMode="numeric" defaultValue={it.price_cents === null ? "" : it.price_cents / 100} style={{ width: 90 }} /> : kc(it.price_cents)}{it.price_cents === null && <div className="faint">chybí cena</div>}</td>
      <td>{edit ? <input name={`all_${i}`} defaultValue={it.allergens.join(",")} style={{ width: 90 }} /> : it.allergens.join(", ")}</td>
      <td>{edit ? <select name={`av_${i}`} defaultValue={it.availability}><option value="available">k dispozici</option><option value="limited">omezeně</option><option value="sold_out">vyprodáno</option></select> : it.availability}</td>
      {edit && <td><label className="chip"><input type="checkbox" name={`ok_${i}`} defaultChecked={!it.needs_review} /> zkontrolováno</label></td>}
    </tr>
  );

  return (
    <>
      <div className="hlavicka">
        <div><Kontext venue={v} /><a className="faint" href={`/${v.slug}/menu`}>← Menu</a><h1>{m.title || "Menu"}</h1>
          <p className="stav-radek">{m.status === "confirmed" ? <span className="stitek stitek-dobre">potvrzeno {m.confirmer ? `(${m.confirmer})` : ""}</span> : <span className="stitek stitek-pozor">koncept — zkontrolujte a potvrďte</span>} <span className="faint">{m.valid_from ? formatDatum(m.valid_from) : "bez data"}{m.valid_to && m.valid_to !== m.valid_from ? ` – ${formatDatum(m.valid_to)}` : ""} · zdroj: {m.source}</span></p></div>
      </div>
      <Hlasky sp={sp} />
      {warnings.length > 0 && <div className="hlaska hlaska-pozor">{warnings.join(" ")}</div>}
      {problem > 0 && <div className="hlaska hlaska-pozor">{problem} položek vyžaduje kontrolu nebo nemá cenu. Bez toho menu nejde potvrdit ani použít pro návrhy.</div>}

      <form action={upravitAkce} className="karta">
        <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="pocet" value={items.length} />
        <div className="radek radek-3">
          <div className="pole"><label htmlFor="kind">Druh</label><select id="kind" name="kind" defaultValue={m.kind} disabled={!edit}><option value="daily">Denní</option><option value="weekly">Týdenní</option><option value="weekend">Víkendové</option><option value="lunch3">Polední tříchodové</option><option value="special">Speciál</option><option value="seasonal">Sezonní</option><option value="drinks">Nápojové</option><option value="dessert">Dezerty</option></select></div>
          <div className="pole"><label htmlFor="title">Název</label><input id="title" name="title" defaultValue={m.title} readOnly={!edit} /></div>
          <div className="pole"><label htmlFor="valid_from">Platí od</label><input id="valid_from" name="valid_from" type="date" defaultValue={m.valid_from ?? ""} readOnly={!edit} /></div>
          <div className="pole"><label htmlFor="valid_to">Platí do</label><input id="valid_to" name="valid_to" type="date" defaultValue={m.valid_to ?? ""} readOnly={!edit} /></div>
        </div>
        {days.map((d) => (
          <div key={d.id}>
            <h3>{d.label} {d.day_date ? <span className="faint">{formatDatum(d.day_date)}</span> : <span className="stitek stitek-pozor">bez data</span>}</h3>
            <div className="tabulka-obal"><table className="tabulka"><thead><tr><th>Kategorie</th><th>Název</th><th>Popis</th><th>Cena</th><th>Alergeny</th><th>Dostupnost</th>{edit && <th></th>}</tr></thead>
              <tbody>{items.map((it, i) => it.menu_day_id === d.id ? radek(it, i) : null)}</tbody></table></div>
          </div>
        ))}
        {items.some((i) => !i.menu_day_id) && (
          <div className="tabulka-obal"><table className="tabulka"><thead><tr><th>Kategorie</th><th>Název</th><th>Popis</th><th>Cena</th><th>Alergeny</th><th>Dostupnost</th>{edit && <th></th>}</tr></thead>
            <tbody>{items.map((it, i) => !it.menu_day_id ? radek(it, i) : null)}</tbody></table></div>
        )}
        {edit && (
          <div className="btn-radek" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" name="rezim" value="ulozit">Uložit opravy</button>
            <button className="btn" name="rezim" value="potvrdit">Uložit a potvrdit menu</button>
          </div>
        )}
      </form>
      {edit && m.status !== "confirmed" && problem === 0 && (
        <form action={potvrditAkce}><input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={m.id} /><button className="btn btn-primary" style={{ marginTop: 12 }}>Potvrdit menu</button></form>
      )}

      {m.status === "confirmed" && muze(k, "content.create") && (
        <section className="karta">
          <h2>Vytvořit z tohoto menu jedním kliknutím</h2>
          <div className="mrizka mrizka-3">
            {ODVOZENE_Z_MENU.map((o) => (
              <form key={o.key} action={odvoditAkce} className="karta" style={{ margin: 0 }}>
                <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="druh" value={o.key} />
                <h3>{o.label}</h3><p className="faint">{o.popis}</p>
                <button className="btn btn-male">Vytvořit návrh</button>
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
