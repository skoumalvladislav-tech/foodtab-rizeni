"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { spustitAutomatizaci } from "@/lib/domena/automatizace";
import { assertAccess } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../ui";

export async function kampanAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "campaigns.manage", v.id);
      const id = String(form.get("id") ?? "");
      if (id) {
        if (form.has("auto_publish")) {
          await tx.q("update marketing.campaigns set auto_publish = $2 where id = $1 and venue_id = $3", [id, form.get("auto_publish") === "1", v.id]);
          await tx.q("select marketing.audit($1, $2, 'campaign.auto_publish', 'campaign', $3, $4)", [k.organization.id, v.id, id, JSON.stringify({ auto_publish: form.get("auto_publish") === "1" })]);
        }
        if (form.has("status")) await tx.q("update marketing.campaigns set status = $2 where id = $1 and venue_id = $3", [id, String(form.get("status")), v.id]);
        return;
      }
      await tx.q("insert into marketing.campaigns (organization_id, venue_id, name, goal, kind, pillar, starts_on, ends_on, created_by) values ($1, $2, $3, $4, 'custom', $5, $6, $7, $8)",
        [k.organization.id, v.id, String(form.get("name") ?? "").trim(), String(form.get("goal") ?? ""), String(form.get("pillar") ?? "akce"), String(form.get("starts_on") ?? "") || null, String(form.get("ends_on") ?? "") || null, k.session.userId]);
    });
  } catch (e) {
    redirect(`/${slug}/kampane?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/kampane?ok=${encodeURIComponent("Uloženo.")}`);
}

export async function automatizaceAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "campaigns.manage", v.id);
      const id = String(form.get("id") ?? "");
      if (id) {
        const on = form.get("enabled") === "1";
        await tx.q("update marketing.automations set is_enabled = $2, paused_at = case when $2 then null else now() end where id = $1 and venue_id = $3", [id, on, v.id]);
        return;
      }
      const kind = String(form.get("kind") ?? "");
      const names: Record<string, string> = { daily_story_from_menu: "Denní Story z menu", weekend_menu_promo: "Propagace víkendového menu", recurring_campaign: "Opakovaná kampaň", evergreen_queue: "Fronta evergreen", weekly_report: "Týdenní report" };
      await tx.q("insert into marketing.automations (organization_id, venue_id, kind, name, is_enabled, owner_id, schedule) values ($1, $2, $3, $4, false, $5, $6)",
        [k.organization.id, v.id, kind, names[kind] ?? kind, k.session.userId, String(form.get("schedule") ?? "")]);
    });
  } catch (e) {
    redirect(`/${slug}/kampane?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/kampane?ok=${encodeURIComponent("Uloženo.")}`);
}

export async function spustitAutomatizaciAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  let msg = "";
  try {
    msg = await withUser(k.session.userId, (tx) => spustitAutomatizaci(tx, { automationId: String(form.get("id")), userId: k.session.userId, tz: k.tz }));
  } catch (e) {
    redirect(`/${slug}/kampane?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/kampane?ok=${encodeURIComponent(msg)}`);
}

export async function napadAkce(form: FormData) {
  const slug = String(form.get("slug"));
  const k = await nacistKontext(slug);
  const v = k.venue!;
  try {
    await withUser(k.session.userId, async (tx) => {
      const id = String(form.get("id") ?? "");
      if (id) { await tx.q("update marketing.ideas set status = $2 where id = $1 and venue_id = $3", [id, String(form.get("status")), v.id]); return; }
      await tx.q("insert into marketing.ideas (organization_id, venue_id, text, pillar, created_by) values ($1, $2, $3, $4, $5)", [k.organization.id, v.id, String(form.get("text") ?? "").trim(), String(form.get("pillar") ?? "akce"), k.session.userId]);
    });
  } catch (e) {
    redirect(`/${slug}/kampane?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/${slug}/kampane#napady`);
}
