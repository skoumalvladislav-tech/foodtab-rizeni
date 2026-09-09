import type { MenuSourceProvider, MetricsProvider, NotificationProvider, ProviderContext } from "./types.ts";
import type { Tx } from "../db/driver.ts";

/** Upozornění v aplikaci (zvonek). Zápis dělá volající v transakci. */
export function createInternalNotifications(ctx: ProviderContext, tx?: Tx): NotificationProvider {
  return {
    key: "internal_notifications",
    category: "notifications",
    capabilities: ["notify.push"],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      return { ok: true, message: "Upozornění v aplikaci jsou vždy zapnutá." };
    },
    async notify(n) {
      if (!tx) return;
      for (const uid of n.userIds) {
        await tx.q(
          "insert into marketing.notifications (organization_id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6)",
          [ctx.organizationId, uid, n.kind, n.title, n.body, n.link ?? null],
        );
      }
    },
  };
}

/** Ukázkové metriky — odhad, vždy označený. Deterministické podle ID, aby se nehýbaly při každém načtení. */
export function createMockMetrics(ctx: ProviderContext): MetricsProvider {
  return {
    key: "mock_metrics",
    category: "analytics",
    capabilities: ["metrics.basic"],
    mode: "mock",
    isMock: true,
    async testConnection() {
      return { ok: true, message: "Ukázkové metriky (odhad)." };
    },
    async fetchMetrics(externalPostId) {
      let h = 0;
      for (const ch of externalPostId + ctx.organizationId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const reach = 300 + (h % 1200);
      return { metrics: { reach, impressions: Math.round(reach * 1.4), likes: Math.round(reach * 0.06), comments: h % 7, saves: h % 11, shares: h % 5, link_clicks: h % 9 }, isEstimate: true };
    },
  };
}

export function createManualMenuSource(ctx: ProviderContext): MenuSourceProvider {
  return {
    key: "manual_menu",
    category: "menu_source",
    capabilities: ["menu.source"],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      return { ok: true, message: "Ruční zadání a import menu jsou vždy k dispozici." };
    },
  };
}
