import type { Tx } from "../db/driver.ts";
import { resolveMetrics } from "../providers/registry.ts";

/** Načte metriky publikací od aktivního poskytovatele analytiky. Mock = odhad, označený. */
export async function synchronizovatMetriky(tx: Tx, organizationId: string, venueId: string): Promise<number> {
  const ok = await tx.one<{ ok: boolean }>("select marketing.has_access($1, 'analytics.read', $2) as ok", [organizationId, venueId]);
  if (!ok?.ok) throw new Error("Nemáte oprávnění číst analytiku.");
  const m = await resolveMetrics(tx, organizationId, venueId);
  if (!m) throw new Error("Není vybraný nástroj pro analytiku.");
  const pubs = await tx.q<{ id: string; external_post_id: string | null; channel: "instagram" | "facebook"; is_mock: boolean }>(
    "select id, external_post_id, channel, is_mock from marketing.publications where venue_id = $1 and external_post_id is not null order by published_at desc limit 100", [venueId]);
  let n = 0;
  for (const p of pubs) {
    // Skutečný poskytovatel nemá co načíst k mock publikaci a naopak.
    if (p.is_mock !== m.provider.isMock) continue;
    const r = await m.provider.fetchMetrics(p.external_post_id!, p.channel);
    if (!r) continue;
    await tx.q("insert into marketing.metric_snapshots (organization_id, venue_id, publication_id, source, is_estimate, metrics) values ($1, $2, $3, $4, $5, $6)",
      [organizationId, venueId, p.id, m.provider.isMock ? "mock" : "provider", r.isEstimate, JSON.stringify(r.metrics)]);
    n++;
  }
  return n;
}
