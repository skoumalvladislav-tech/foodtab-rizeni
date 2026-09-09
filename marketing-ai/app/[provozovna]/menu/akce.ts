"use server";

import { redirect } from "next/navigation";

import { posunDne } from "@/lib/cas";
import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { nahratMedium } from "@/lib/domena/media";
import { ODVOZENE_Z_MENU, potvrditMenu, rozpoznaniNaVstup, rozpoznatMenu, ulozitMenu, type PolozkaVstup } from "@/lib/domena/menu";
import { navrhnout, oznacitSelhaniNavrhu, vytvoritObsah } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../ui";

function polozkyZFormulare(form: FormData, pocet: number): { items: PolozkaVstup[]; byDay: Map<string, PolozkaVstup[]> } {
  const items: PolozkaVstup[] = [];
  const byDay = new Map<string, PolozkaVstup[]>();
  for (let i = 0; i < pocet; i++) {
    const name = String(form.get(`name_${i}`) ?? "").trim();
    if (!name) continue;
    const price = String(form.get(`price_${i}`) ?? "");
    const ok = form.has(`ok_${i}`) ? form.get(`ok_${i}`) === "on" : true;
    const it: PolozkaVstup = {
      category: String(form.get(`cat_${i}`) ?? "hlavni"), name, description: String(form.get(`desc_${i}`) ?? ""),
      price_cents: price === "" ? null : Math.round(Number(price) * 100),
      allergens: String(form.get(`all_${i}`) ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      availability: (String(form.get(`av_${i}`) ?? "available") as PolozkaVstup["availability"]),
      needs_review: !ok, review_reason: ok ? null : "Nezkontrolováno",
    };
    const day = String(form.get(`day_${i}`) ?? "");
    if (day) { if (!byDay.has(day)) byDay.set(day, []); byDay.get(day)!.push(it); } else items.push(it);
  }
  return { items, byDay };
}

export async function rucniAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  let id = "";
  try {
    const { items } = polozkyZFormulare(form, 8);
    if (items.length === 0) throw new Error("Zadejte aspoň jednu položku.");
    id = await withUser(k.session.userId, (tx) => ulozitMenu(tx, {
      organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, kind: String(form.get("kind") ?? "daily"), title: String(form.get("title") ?? ""),
      validFrom: String(form.get("valid_from") ?? "") || null, validTo: String(form.get("valid_to") ?? "") || String(form.get("valid_from") ?? "") || null, source: "manual", days: [], items,
    }));
  } catch (e) {
    redirect(`/${slug}/menu/nove?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/menu/${id}?ok=${encodeURIComponent("Koncept uložen. Zkontrolujte položky a potvrďte.")}`);
}

export async function importAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  const zpusob = String(form.get("zpusob") ?? "text");
  let id = "";
  try {
    id = await withUser(k.session.userId, async (tx) => {
      let rozp;
      let sourceAssetId: string | null = null;
      if (zpusob === "text") {
        const text = String(form.get("text") ?? "").trim();
        if (!text) throw new Error("Vložte text menu.");
        rozp = await rozpoznatMenu(tx, { organizationId: k.organization.id, venueId: v.id, text });
      } else {
        const f = form.get("soubor");
        if (!(f instanceof File) || f.size === 0) throw new Error("Vyberte soubor.");
        const bytes = new Uint8Array(await f.arrayBuffer());
        const up = await nahratMedium(tx, { organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, filename: f.name, mime: f.type, bytes, collectionKey: "denni-menu", title: `Podklad menu ${f.name}`, tags: ["menu-podklad"] });
        sourceAssetId = up.id;
        rozp = await rozpoznatMenu(tx, { organizationId: k.organization.id, venueId: v.id, bytes, mime: f.type });
        const hint = String(form.get("hint") ?? "").trim();
        if (hint && !rozp.title) rozp.title = hint;
      }
      const vstup = rozpoznaniNaVstup(rozp, { organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, source: zpusob === "text" ? "text" : zpusob === "pdf" ? "pdf" : "image", sourceAssetId });
      return ulozitMenu(tx, vstup);
    });
  } catch (e) {
    redirect(`/${slug}/menu/nove?zpusob=${zpusob}&chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/menu/${id}?ok=${encodeURIComponent("Rozpoznáno. Zkontrolujte položky označené ke kontrole a potvrďte.")}`);
}

export async function upravitAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  let msg = "Uloženo.";
  try {
    await withUser(k.session.userId, async (tx) => {
      const days = await tx.q<{ id: string; label: string; day_date: string | null }>("select id, label, day_date::text from marketing.menu_days where menu_id = $1 order by sort_order", [id]);
      const { items, byDay } = polozkyZFormulare(form, Number(form.get("pocet") ?? 0));
      await ulozitMenu(tx, {
        organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, kind: String(form.get("kind") ?? "daily"), title: String(form.get("title") ?? ""),
        validFrom: String(form.get("valid_from") ?? "") || null, validTo: String(form.get("valid_to") ?? "") || null, source: "manual",
        days: days.map((d) => ({ label: d.label, day_date: d.day_date, items: byDay.get(d.id) ?? [] })), items,
      }, id);
      if (form.get("rezim") === "potvrdit") {
        const r = await potvrditMenu(tx, id, k.session.userId);
        if (!r.ok) throw new Error(r.problemy.join(" "));
        msg = "Menu potvrzeno.";
      }
    });
  } catch (e) {
    redirect(`/${slug}/menu/${id}?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/menu/${id}?ok=${encodeURIComponent(msg)}`);
}

export async function potvrditAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const id = String(form.get("id"));
  const k = await nacistKontext(slug);
  try {
    const r = await withUser(k.session.userId, (tx) => potvrditMenu(tx, id, k.session.userId));
    if (!r.ok) throw new Error(r.problemy.join(" "));
  } catch (e) {
    redirect(`/${slug}/menu/${id}?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/menu/${id}?ok=${encodeURIComponent("Menu potvrzeno. Teď z něj jde jedním kliknutím vytvořit obsah.")}`);
}

/** Z menu jedním kliknutím: souhrn, carousel, Story po dnech, Reel, připomínka, víkendová pozvánka, PDF. */
export async function odvoditAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const menuId = String(form.get("id"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  const druh = ODVOZENE_Z_MENU.find((o) => o.key === String(form.get("druh")));
  if (!druh) redirect(`/${slug}/menu/${menuId}?chyba=Nezn%C3%A1m%C3%BD%20typ`);
  let itemIds: string[] = [];
  try {
    itemIds = await withUser(k.session.userId, async (tx) => {
      const m = await tx.one<{ title: string; kind: string; valid_from: string | null; valid_to: string | null; status: string }>("select title, kind, valid_from::text, valid_to::text, status from marketing.menus where id = $1 and venue_id = $2", [menuId, v.id]);
      if (!m || m.status !== "confirmed") throw new Error("Menu musí být potvrzené.");
      const days = await tx.q<{ id: string; label: string; day_date: string | null }>("select id, label, day_date::text from marketing.menu_days where menu_id = $1 order by sort_order", [menuId]);
      const purpose = m.kind === "weekend" ? "vikendove_menu" : m.kind === "weekly" ? "tydenni_menu" : druh.purpose;
      const tpl = await tx.one<{ id: string }>("select id from marketing.templates where key = $1 and (organization_id = $2 or organization_id is null) and archived_at is null order by organization_id nulls last limit 1", [purpose, k.organization.id]);
      const media = await tx.q<{ id: string }>("select id from marketing.media_assets where venue_id = $1 and archived_at is null and kind = 'image' order by is_hero desc, created_at desc limit 4", [v.id]);
      const inputs = { date: m.valid_from, range: { from: m.valid_from, to: m.valid_to ?? m.valid_from } };
      const zaklad = { organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, purpose, pillar: "menu", templateId: tpl?.id ?? null, menuId, channels: ["instagram", "facebook"] as ("instagram" | "facebook")[], formats: druh.formats, mediaAssetIds: media.map((x) => x.id) };
      if (druh.perDay && days.length > 1) {
        const ids: string[] = [];
        for (const d of days) {
          const r = await vytvoritObsah(tx, { ...zaklad, title: `Story ${d.label}: ${m.title}`, brief: `Story pro ${d.label}.`, inputs: { ...inputs, date: d.day_date ?? m.valid_from } });
          if (d.day_date) await tx.q("update marketing.content_items set scheduled_at = ($2::date + time '09:30') at time zone $3 where id = $1", [r.itemId, d.day_date, k.tz]);
          ids.push(r.itemId);
        }
        return ids;
      }
      const r = await vytvoritObsah(tx, { ...zaklad, title: `${druh.label}: ${m.title}`, brief: druh.key === "pripominka" ? "Ranní připomínka dnešní nabídky." : druh.key === "vikend" ? "Pozvánka na víkend." : "", inputs });
      if (druh.key === "pripominka" && m.valid_from) await tx.q("update marketing.content_items set scheduled_at = ($2::date + time '09:30') at time zone $3 where id = $1", [r.itemId, m.valid_from, k.tz]);
      if (druh.key === "vikend" && m.valid_from) await tx.q("update marketing.content_items set scheduled_at = ($2::date + time '10:00') at time zone $3 where id = $1", [r.itemId, posunDne(m.valid_from, -2), k.tz]);
      return [r.itemId];
    });
  } catch (e) {
    redirect(`/${slug}/menu/${menuId}?chyba=${chybaDoAdresy(e)}`);
  }
  // Návrhy běží až po založení konceptů, každý ve vlastní transakci —
  // aby selhání AI u třetího dne nesmazalo první dva. Co selže, zůstane
  // konceptem ve stavu „Generování selhalo“ a jde spustit znovu.
  let chyba = "";
  for (const id of itemIds) {
    try {
      await withUser(k.session.userId, (tx) => navrhnout(tx, { itemId: id, userId: k.session.userId }));
    } catch (e) {
      await oznacitSelhaniNavrhu(k.session.userId, id);
      chyba = chyba || chybaDoAdresy(e);
    }
  }
  if (chyba) redirect(`/${slug}/obsah/${itemIds[0]}?chyba=${chyba}`);
  redirect(`/${slug}/obsah/${itemIds[0]}?ok=${encodeURIComponent("Návrh z menu je hotový.")}`);
}
