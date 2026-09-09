import { NextResponse, type NextRequest } from "next/server";

import { jeCron } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { withService } from "@/lib/db";
import { spustitAutomatizaci } from "@/lib/domena/automatizace";
import { zpracovatFrontu } from "@/lib/domena/fronta";
import { withUser } from "@/lib/db";

/**
 * Zpracování fronty: rendery, splatné publikace, retry.
 * Volá cron (X-Cron-Secret), n8n (scheduled-social-publish.json) nebo
 * přihlášený uživatel s content.publish (tlačítko v aplikaci).
 * ?automatizace=1 navíc spustí zapnuté automatizace (jen cron).
 *
 * Fronta běží pod servisní rolí, takže sama o oprávnění nezakopne —
 * musí se zeptat tady. Přihlášený uživatel proto (a) musí mít někde
 * právo publikovat a (b) spustí jen úlohy SVÝCH organizací. Bez toho
 * by pozorovatel jedním voláním rozeslal splatné příspěvky celé
 * databáze, cizí firmy včetně.
 */
export async function POST(req: NextRequest) {
  const cron = jeCron(req);
  const s = cron ? null : await getSession();
  if (!cron && !s) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });
  let orgs: string[] | undefined;
  if (!cron) {
    orgs = (await withUser(s!.userId, (tx) => tx.q<{ organization_id: string }>(
      `select m.organization_id from marketing.memberships m
        where m.user_id = (select auth.uid()) and m.status = 'active' and m.deleted_at is null
          and marketing.has_access(m.organization_id, 'content.publish', null)`))).map((o) => o.organization_id);
    if (orgs.length === 0) return NextResponse.json({ error: "Na spuštění fronty nemáte oprávnění." }, { status: 403 });
  }
  const vysledek = await zpracovatFrontu({ limit: 50, organizationIds: orgs });
  const automatizace: string[] = [];
  if (cron && req.nextUrl.searchParams.get("automatizace") === "1") {
    const rows = await withService((tx) => tx.q<{ id: string; owner_id: string | null; timezone: string | null }>(
      "select a.id, a.owner_id, coalesce(v.timezone, o.timezone) as timezone from marketing.automations a join marketing.venues v on v.id = a.venue_id join marketing.organizations o on o.id = a.organization_id where a.is_enabled and a.paused_at is null"));
    for (const a of rows) {
      if (!a.owner_id) continue;
      try {
        const r = await withUser(a.owner_id, (tx) => spustitAutomatizaci(tx, { automationId: a.id, userId: a.owner_id!, tz: a.timezone ?? "Europe/Prague" }));
        automatizace.push(`${a.id.slice(0, 8)}: ${r}`);
      } catch (e) {
        automatizace.push(`${a.id.slice(0, 8)}: chyba ${e instanceof Error ? e.message : ""}`);
      }
    }
  }
  return NextResponse.json({ ok: true, ...vysledek, automatizace });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
