"use server";

import { redirect } from "next/navigation";

import { posunDne } from "@/lib/cas";
import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { rozpoznatPolozku } from "@/lib/domena/menu-text";
import { navrhnout, vytvoritObsah } from "@/lib/domena/obsah";
import { sablona as sablonaDef } from "@/lib/sablony/katalog";

import { chybaDoAdresy } from "../../ui";

function seznam(form: FormData, name: string): string[] {
  return form.getAll(name).map(String).filter(Boolean);
}

/** Z formuláře průvodce → obsah + první AI návrh → přesměrování na detail. */
export async function vytvoritANavrhnout(form: FormData) {
  const slug = String(form.get("slug") ?? "");
  const k = await nacistKontext(slug);
  const v = k.venue!;
  const rezim = String(form.get("rezim") ?? "pruvodce");
  const sablonaKey = String(form.get("sablona") ?? "atmosfera");
  const def = sablonaDef(sablonaKey);
  const media = seznam(form, "media");
  const kanaly = seznam(form, "kanaly").filter((c) => c === "instagram" || c === "facebook") as ("instagram" | "facebook")[];
  let formaty = seznam(form, "formaty");
  if (def) formaty = formaty.filter((f) => (def.formats as string[]).includes(f));
  const brief = String(form.get("brief") ?? "").trim();
  const menuId = String(form.get("menuId") ?? "") || null;

  if (kanaly.length === 0) redirect(`/${v.slug}/tvorba?rezim=${rezim}&chyba=${encodeURIComponent("Vyberte aspoň jednu síť.")}`);
  if (formaty.length === 0) redirect(`/${v.slug}/tvorba?rezim=${rezim}&chyba=${encodeURIComponent("Vyberte aspoň jeden výstupní formát, který šablona umí.")}`);
  if (media.length === 0 && rezim === "rychly") redirect(`/${v.slug}/tvorba?rezim=${rezim}&chyba=${encodeURIComponent("Rychlý režim potřebuje aspoň jednu fotografii.")}`);

  // Vstupy šablony (in_<key>, in_<key>_from/_to)
  const inputs: Record<string, unknown> = {};
  for (const i of def?.inputs ?? []) {
    if (i.type === "date_range") {
      const from = String(form.get(`in_${i.key}_from`) ?? "");
      const to = String(form.get(`in_${i.key}_to`) ?? "") || from;
      if (from) inputs[i.key] = { from, to };
    } else if (i.type === "boolean") {
      inputs[i.key] = form.get(`in_${i.key}`) === "on";
    } else if (i.type === "price" || i.type === "number") {
      const n = Number(form.get(`in_${i.key}`));
      if (Number.isFinite(n) && form.get(`in_${i.key}`) !== "") inputs[i.key] = n;
    } else if (["string", "text", "date", "time", "select", "url"].includes(i.type)) {
      const val = String(form.get(`in_${i.key}`) ?? "").trim();
      if (val) inputs[i.key] = val;
    }
  }
  const itemsText = String(form.get("items_text") ?? "").trim();
  if (itemsText && !menuId) {
    inputs.items = itemsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => rozpoznatPolozku(l, "hlavni"));
  }

  const title = (inputs.title as string | undefined) ?? def?.name ?? "Nový obsah";
  let itemId = "";
  try {
    itemId = await withUser(k.session.userId, async (tx) => {
      const tpl = await tx.one<{ id: string }>(
        "select id from marketing.templates where key = $1 and (organization_id = $2 or organization_id is null) and archived_at is null order by organization_id nulls last limit 1",
        [sablonaKey, k.organization.id]);
      if (menuId) {
        const m = await tx.one<{ status: string }>("select status from marketing.menus where id = $1 and venue_id = $2", [menuId, v.id]);
        if (!m) throw new Error("Vybrané menu nepatří k této provozovně.");
        if (m.status !== "confirmed") throw new Error("Menu musí být nejdřív potvrzené (zkontrolované).");
      }
      let campaignId: string | null = String(form.get("kampan_id") ?? "") || null;
      if (rezim === "kampan" && !campaignId) {
        const c = await tx.one<{ id: string }>(
          "insert into marketing.campaigns (organization_id, venue_id, name, goal, kind, pillar, starts_on, ends_on, created_by) values ($1, $2, $3, $4, 'series', $5, $6, $7, $8) returning id",
          [k.organization.id, v.id, title, String(form.get("kampan_cil") ?? ""), def?.pillar ?? "akce", posunDne(String(form.get("kampan_termin")), -7), posunDne(String(form.get("kampan_termin")), 1), k.session.userId]);
        campaignId = c!.id;
      }
      const r = await vytvoritObsah(tx, {
        organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, title, purpose: def?.purpose ?? sablonaKey, pillar: def?.pillar ?? "menu",
        templateId: tpl?.id ?? null, menuId, campaignId, brief, channels: kanaly, formats: formaty, mediaAssetIds: media, inputs,
      });
      // Kampaňový režim: série jako další koncepty navázané na kampaň
      if (rezim === "kampan" && campaignId) {
        const termin = String(form.get("kampan_termin"));
        const serie = seznam(form, "serie");
        const faze: Record<string, [string, number]> = { pozvanka: ["Pozvánka", -7], pripominka: ["Připomínka", -2], posledni: ["Poslední výzva", 0], podekovani: ["Poděkování po akci", 1] };
        for (const s of serie) {
          const [label, offset] = faze[s] ?? [s, 0];
          const sub = await vytvoritObsah(tx, {
            organizationId: k.organization.id, venueId: v.id, userId: k.session.userId, title: `${label}: ${title}`, purpose: s === "podekovani" ? "reportaz_po_akci" : "pozvanka_pred_akci", pillar: "akce",
            templateId: tpl?.id ?? null, menuId, campaignId, brief: `${label}. ${brief}`, channels: kanaly, formats: formaty, mediaAssetIds: media, inputs: { ...inputs, faze: s },
          });
          await tx.q("update marketing.content_items set scheduled_at = ($2::date + time '10:00') at time zone $3 where id = $1", [sub.itemId, posunDne(termin, offset), k.tz]);
        }
      }
      await navrhnout(tx, { itemId: r.itemId, userId: k.session.userId });
      return r.itemId;
    });
  } catch (e) {
    redirect(`/${v.slug}/tvorba?rezim=${rezim}&chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${v.slug}/obsah/${itemId}?ok=${encodeURIComponent("Návrh je hotový. Vyberte variantu, upravte a pošlete ke schválení.")}`);
}
