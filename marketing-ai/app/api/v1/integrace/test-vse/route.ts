import { NextResponse, type NextRequest } from "next/server";

import { jeCron } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { withService, withUser } from "@/lib/db";
import { otestovat } from "@/lib/domena/integrace";
import { upozornit, uzivateleSPravem } from "@/lib/domena/notifikace";
import { overitPodpisWebhooku } from "@/lib/providers/workflow";

/**
 * Kontrola všech připojení (connection-health.json / cron): otestuje
 * každé aktivní zákaznické připojení, označí problémy a upozorní správce.
 * Vestavěné a demo nástroje se netestují — nemají co selhat.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const podepsano = overitPodpisWebhooku(process.env.N8N_WEBHOOK_SECRET ?? "", req.headers.get("x-foodtab-timestamp"), req.headers.get("x-foodtab-signature"), raw);
  const cron = podepsano || jeCron(req);
  const s = cron ? null : await getSession();
  if (!cron && !s) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });

  const spojeni = await withService((tx) => tx.q<{ id: string; organization_id: string; provider_key: string; user_id: string; expires_at: string | null }>(
    `select c.id, c.organization_id, c.provider_key, c.expires_at, m.user_id from marketing.integration_connections c
       join lateral (select mm.user_id from marketing.memberships mm join marketing.roles r on r.id = mm.role_id
                      where mm.organization_id = c.organization_id and r.is_owner and mm.status = 'active' and mm.deleted_at is null limit 1) m on true
      where c.revoked_at is null and c.mode = 'customer_managed' and c.status in ('connected', 'needs_attention', 'error')
        and ($1::uuid is null or c.organization_id in (select organization_id from marketing.memberships where user_id = $1 and status = 'active'))`, [s?.userId ?? null]));
  const vysledky: { id: string; provider: string; ok: boolean; message: string }[] = [];
  for (const c of spojeni) {
    try {
      const r = await withUser(c.user_id, async (tx) => {
        const t = await otestovat(tx, c.id);
        const brzy = c.expires_at && new Date(c.expires_at).getTime() - Date.now() < 7 * 86400000;
        if (!t.ok || brzy) {
          await tx.q("update marketing.integration_connections set status = case when $2 then 'error' else 'needs_attention' end where id = $1", [c.id, !t.ok]);
          await upozornit(tx, {
            organizationId: c.organization_id, userIds: await uzivateleSPravem(tx, c.organization_id, "integrations.manage", null),
            kind: "connection_health", title: `Připojení ${c.provider_key} vyžaduje pozornost`, body: t.ok ? "Token brzy vyprší — připojte účet znovu." : t.message, link: "/nastaveni/integrace",
          });
        }
        return t;
      });
      vysledky.push({ id: c.id, provider: c.provider_key, ok: r.ok, message: r.message });
    } catch (e) {
      vysledky.push({ id: c.id, provider: c.provider_key, ok: false, message: e instanceof Error ? e.message : "chyba" });
    }
  }
  return NextResponse.json({ ok: vysledky.every((v) => v.ok), tested: vysledky.length, vysledky });
}
