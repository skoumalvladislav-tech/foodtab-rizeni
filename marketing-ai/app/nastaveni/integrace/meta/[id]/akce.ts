"use server";

import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { aktivovat, otestovat } from "@/lib/domena/integrace";
import { assertAccess } from "@/lib/domena/obsah";

import { chybaDoAdresy } from "../../../../ui";

export async function vybratUctyAkce(form: FormData) {
  const k = await nacistKontext(null);
  const connectionId = String(form.get("connectionId"));
  try {
    await withUser(k.session.userId, async (tx) => {
      await assertAccess(tx, k.organization.id, "integrations.manage", null);
      const c = await tx.one<{ external_account: { accounts?: { platform: string; kind: string; externalId: string; name: string; username?: string }[] } }>("select external_account from marketing.integration_connections where id = $1 and organization_id = $2", [connectionId, k.organization.id]);
      if (!c) throw new Error("Připojení nenalezeno.");
      const accounts = c.external_account.accounts ?? [];
      await tx.q("update marketing.social_accounts set is_active = false where connection_id = $1", [connectionId]);
      let n = 0;
      for (const v of k.venues) {
        for (const [platform, key] of [["facebook", `fb_${v.id}`], ["instagram", `ig_${v.id}`]] as const) {
          const ext = String(form.get(key) ?? "");
          const a = accounts.find((x) => x.platform === platform && x.externalId === ext);
          if (!a) continue;
          await tx.q(
            `insert into marketing.social_accounts (organization_id, venue_id, connection_id, platform, kind, external_id, name, username, capabilities, is_active)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
             on conflict (connection_id, platform, external_id) do update set venue_id = excluded.venue_id, name = excluded.name, username = excluded.username, is_active = true`,
            [k.organization.id, v.id, connectionId, platform, a.kind, a.externalId, a.name, a.username ?? null,
              platform === "facebook" ? ["publish.facebook.post", "publish.facebook.reel"] : ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story"]]);
          n++;
        }
      }
      if (n === 0) throw new Error("Vyberte aspoň jeden účet.");
      const t = await otestovat(tx, connectionId);
      if (!t.ok) throw new Error(`Test spojení selhal: ${t.message}`);
      await aktivovat(tx, k.organization.id, null, "social_publishing", "meta_graph", connectionId, k.session.userId);
      // Analytika ze stejného připojení
      const ins = await tx.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'meta_insights' and revoked_at is null limit 1", [k.organization.id]);
      const insId = ins?.id ?? (await tx.one<{ id: string }>("insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name, secret_ref, connected_by) values ($1, 'meta_insights', 'customer_managed', 'connected', 'Meta Insights (sdílené připojení)', null, $2) returning id", [k.organization.id, k.session.userId]))!.id;
      await aktivovat(tx, k.organization.id, null, "analytics", "meta_insights", insId, k.session.userId);
    });
  } catch (e) {
    redirect(`/nastaveni/integrace/meta/${connectionId}?chyba=${chybaDoAdresy(e)}`);
  }
  redirect(`/nastaveni/integrace?ok=${encodeURIComponent("Instagram a Facebook připojeny. Nepublikační test proběhl.")}#social_publishing`);
}
