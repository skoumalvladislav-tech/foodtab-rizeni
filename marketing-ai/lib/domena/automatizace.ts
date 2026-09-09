import { dnes, nejblizsiSobota, posunDne } from "../cas.ts";
import type { Tx } from "../db/driver.ts";
import { navrhnout, vytvoritObsah, assertAccess } from "./obsah.ts";

/**
 * Automatizace vytvářejí NÁVRHY (koncepty ke schválení). Nepublikují.
 * Spouští je cron (/api/v1/ulohy/zpracovat?automatizace=1), n8n
 * (recurring-campaigns.json) nebo tlačítko „Spustit teď“.
 *
 * Každý běh se zapíše do run_history, aby šlo dohledat, co vzniklo.
 */
export async function spustitAutomatizaci(tx: Tx, p: { automationId: string; userId: string; tz: string }): Promise<string> {
  const a = await tx.one<{ id: string; organization_id: string; venue_id: string; kind: string; config: Record<string, unknown>; name: string }>(
    "select id, organization_id, venue_id, kind, config, name from marketing.automations where id = $1", [p.automationId]);
  if (!a) throw new Error("Automatizace nenalezena.");
  await assertAccess(tx, a.organization_id, "campaigns.manage", a.venue_id);
  let result = "";
  try {
    result = await beh(tx, a, p.userId, p.tz);
  } catch (e) {
    result = `chyba: ${e instanceof Error ? e.message : "neznámá"}`;
  }
  await tx.q(
    "update marketing.automations set last_run_at = now(), last_result = $2, run_history = (coalesce(run_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'result', $2::text))) where id = $1",
    [a.id, result]);
  return result;
}

async function beh(tx: Tx, a: { id: string; organization_id: string; venue_id: string; kind: string; config: Record<string, unknown>; name: string }, userId: string, tz: string): Promise<string> {
  const today = dnes(tz);
  if (a.kind === "daily_story_from_menu" || a.kind === "weekend_menu_promo") {
    const kind = a.kind === "daily_story_from_menu" ? "daily" : "weekend";
    const menu = await tx.one<{ id: string; title: string; valid_from: string | null }>(
      "select id, title, valid_from::text from marketing.menus where venue_id = $1 and kind = $2 and status = 'confirmed' and valid_to >= $3 order by valid_from limit 1", [a.venue_id, kind, today]);
    if (!menu) return `přeskočeno: není potvrzené ${kind === "daily" ? "denní" : "víkendové"} menu s platností od ${today}`;
    const dup = await tx.one<{ id: string }>("select id from marketing.content_items where venue_id = $1 and menu_id = $2 and purpose = $3 and created_at > now() - interval '20 hours'", [a.venue_id, menu.id, kind === "daily" ? "denni_menu" : "vikendove_menu"]);
    if (dup) return "přeskočeno: návrh z tohoto menu už dnes vznikl (ochrana před duplicitou)";
    const tplKey = String(a.config.template ?? (kind === "daily" ? "denni_menu" : "vikendove_menu"));
    const tpl = await tx.one<{ id: string }>("select id from marketing.templates where key = $1 and (organization_id = $2 or organization_id is null) and archived_at is null order by organization_id nulls last limit 1", [tplKey, a.organization_id]);
    const media = await tx.q<{ id: string }>("select id from marketing.media_assets where venue_id = $1 and archived_at is null and kind = 'image' order by is_hero desc, created_at desc limit 3", [a.venue_id]);
    const formats = (a.config.formats as string[] | undefined) ?? (kind === "daily" ? ["instagram_story"] : ["instagram_feed", "facebook_post"]);
    const r = await vytvoritObsah(tx, {
      organizationId: a.organization_id, venueId: a.venue_id, userId, title: `${a.name}: ${menu.title}`, purpose: kind === "daily" ? "denni_menu" : "vikendove_menu", pillar: "menu",
      templateId: tpl?.id ?? null, menuId: menu.id, brief: `Automaticky z automatizace „${a.name}“.`, channels: ["instagram", "facebook"], formats, mediaAssetIds: media.map((m) => m.id),
      inputs: { date: menu.valid_from, range: { from: menu.valid_from, to: menu.valid_from } },
    });
    const cas = String(a.config.time ?? "09:30");
    const den = kind === "daily" ? (menu.valid_from ?? today) : posunDne(nejblizsiSobota(tz), -2);
    await tx.q("update marketing.content_items set scheduled_at = ($2::date + $3::time) at time zone $4 where id = $1", [r.itemId, den, cas, tz]);
    await navrhnout(tx, { itemId: r.itemId, userId });
    return `vytvořen návrh ke schválení (${r.itemId.slice(0, 8)})`;
  }
  if (a.kind === "evergreen_queue") {
    const gap = await tx.one<{ n: number }>("select count(*)::int as n from marketing.content_items where venue_id = $1 and scheduled_at between now() and now() + interval '7 days' and status in ('scheduled','approved','awaiting_approval')", [a.venue_id]);
    if ((gap?.n ?? 0) >= 2) return "přeskočeno: příští týden má dost obsahu";
    const ev = await tx.one<{ id: string; title: string }>("select id, title from marketing.content_items where venue_id = $1 and is_evergreen and status = 'published' order by updated_at limit 1", [a.venue_id]);
    if (!ev) return "přeskočeno: žádný evergreen obsah k opakování";
    return `doporučeno znovu použít „${ev.title}“ — otevřete ho a duplikujte; zkontrolujte cenu a datum`;
  }
  if (a.kind === "weekly_report") {
    return "týdenní report se zobrazuje v Analytice (souhrn posledních 7 dní)";
  }
  return "tento druh automatizace se spouští z kampaně";
}
