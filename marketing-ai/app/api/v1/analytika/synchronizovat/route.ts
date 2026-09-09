import { NextResponse, type NextRequest } from "next/server";

import { jeCron } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { withService, withUser } from "@/lib/db";
import { synchronizovatMetriky } from "@/lib/domena/metriky";
import { overitPodpisWebhooku } from "@/lib/providers/workflow";

/**
 * Načtení metrik od poskytovatele analytiky — pro všechny provozovny
 * (cron / n8n metrics-sync.json), nebo jen pro provozovny přihlášeného.
 * Bez uživatele běží jménem vlastníka každé organizace, aby platila RLS.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const podepsano = overitPodpisWebhooku(process.env.N8N_WEBHOOK_SECRET ?? "", req.headers.get("x-foodtab-timestamp"), req.headers.get("x-foodtab-signature"), raw);
  const cron = podepsano || jeCron(req);
  const s = cron ? null : await getSession();
  if (!cron && !s) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

  const cile = cron
    ? await withService((tx) => tx.q<{ organization_id: string; venue_id: string; user_id: string }>(
        `select v.organization_id, v.id as venue_id, m.user_id from marketing.venues v
           join lateral (select mm.user_id from marketing.memberships mm join marketing.roles r on r.id = mm.role_id
                          where mm.organization_id = v.organization_id and r.is_owner and mm.status = 'active' and mm.deleted_at is null limit 1) m on true
          where v.is_active`))
    : await withUser(s!.userId, (tx) => tx.q<{ organization_id: string; venue_id: string; user_id: string }>(
        `select v.organization_id, v.id as venue_id, $1::uuid as user_id from marketing.venues v where v.id in (select marketing.visible_venue_ids(v.organization_id))`, [s!.userId]));
  const vysledky: { venue_id: string; snapshots?: number; error?: string }[] = [];
  for (const c of cile) {
    try {
      const n = await withUser(c.user_id, (tx) => synchronizovatMetriky(tx, c.organization_id, c.venue_id));
      vysledky.push({ venue_id: c.venue_id, snapshots: n });
    } catch (e) {
      vysledky.push({ venue_id: c.venue_id, error: e instanceof Error ? e.message : "chyba" });
    }
  }
  return NextResponse.json({ ok: true, vysledky });
}
