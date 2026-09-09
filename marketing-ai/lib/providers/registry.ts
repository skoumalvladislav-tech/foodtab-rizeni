import type { Tx } from "../db/driver.ts";
import { createClaudeAi } from "./ai/claude.ts";
import { createMockAi } from "./ai/mock.ts";
import { decryptCredentials } from "./credentials.ts";
import { createInternalNotifications, createManualMenuSource, createMockMetrics } from "./ostatni.ts";
import { createMockVideo } from "./render/mock-video.ts";
import { createShotstack } from "./render/shotstack.ts";
import { createSvgRenderer } from "./render/svg.ts";
import { createManualExport } from "./social/manual.ts";
import { createMetaPublisher } from "./social/meta.ts";
import { createMockPublisher } from "./social/mock.ts";
import type { AIProvider, AnyProvider, ConnectionMode, MetricsProvider, NotificationProvider, ProviderContext, RenderProvider, SocialPublisherProvider, WorkflowProvider } from "./types.ts";
import { createInternalQueue, createN8n } from "./workflow.ts";

/**
 * Registr adaptérů: klíč z katalogu → továrna.
 *
 * Řádek v katalogu s implementation_status = 'implemented' MUSÍ mít
 * továrnu tady, jinak test tests/db/katalog.test.ts spadne. Katalog tedy
 * nemůže předstírat integraci, která v kódu není.
 */
type Factory = (ctx: ProviderContext, tx?: Tx) => AnyProvider;

export const FACTORIES: Record<string, Factory> = {
  anthropic_claude: (ctx) => createClaudeAi(ctx),
  internal_mock_ai: (ctx) => createMockAi(ctx),
  internal_svg_renderer: (ctx) => createSvgRenderer(ctx),
  shotstack: (ctx) => createShotstack(ctx),
  internal_mock_video: (ctx) => createMockVideo(ctx),
  n8n: (ctx) => createN8n(ctx),
  internal_queue: (ctx) => createInternalQueue(ctx),
  meta_graph: (ctx) => createMetaPublisher(ctx),
  mock_publisher: (ctx) => createMockPublisher(ctx),
  manual_export: (ctx) => createManualExport(ctx),
  meta_insights: (ctx) => createMetaMetrics(ctx),
  mock_metrics: (ctx) => createMockMetrics(ctx),
  internal_notifications: (ctx, tx) => createInternalNotifications(ctx, tx),
  supabase_storage: (ctx) => storageStub("supabase_storage", ctx),
  local_storage: (ctx) => storageStub("local_storage", ctx),
  manual_menu: (ctx) => createManualMenuSource(ctx),
};

function createMetaMetrics(ctx: ProviderContext): MetricsProvider {
  const pub = createMetaPublisher(ctx);
  return {
    key: "meta_insights", category: "analytics", capabilities: pub.capabilities.length ? ["metrics.basic", "metrics.video"] : [],
    mode: ctx.mode, isMock: false,
    testConnection: () => pub.testConnection(),
    async fetchMetrics(id, channel) {
      const m = await pub.fetchMetrics?.(id, channel);
      return m ? { metrics: m, isEstimate: false } : null;
    },
  };
}

function storageStub(key: string, ctx: ProviderContext): AnyProvider {
  return {
    key, category: "external_storage", capabilities: ["storage.external"], mode: ctx.mode, isMock: key === "local_storage",
    async testConnection() { return { ok: true, message: "Úložiště spravuje aplikace." }; },
  } as AnyProvider;
}

export interface ResolvedProvider<T extends AnyProvider = AnyProvider> {
  provider: T;
  providerKey: string;
  connectionId: string | null;
  mode: ConnectionMode;
  status: string;
}

/**
 * Vybere aktivního poskytovatele pro kategorii: volba provozovny přebíjí
 * volbu organizace. Připojení musí patřit TÉŽE organizaci (RLS to hlídá
 * i bez nás — credentials cizí organizace se nedají přečíst).
 */
export async function resolveProvider<T extends AnyProvider = AnyProvider>(
  tx: Tx, organizationId: string, venueId: string | null, category: string,
): Promise<ResolvedProvider<T> | null> {
  const pref = await tx.one<{ provider_key: string; connection_id: string | null }>(
    `select provider_key, connection_id from marketing.organization_provider_preferences
      where organization_id = $1 and category = $2 and is_active
        and (venue_id = $3 or venue_id is null)
      order by venue_id nulls last limit 1`,
    [organizationId, category, venueId],
  );
  if (!pref) return null;
  const factory = FACTORIES[pref.provider_key];
  if (!factory) return null;

  let mode: ConnectionMode = "mock";
  let status = "not_connected";
  let credentials: Record<string, string> = {};
  let externalAccount: Record<string, unknown> = {};
  if (pref.connection_id) {
    const c = await tx.one<{ mode: ConnectionMode; status: string; external_account: Record<string, unknown>; secret_ref: string | null; organization_id: string }>(
      "select mode, status, external_account, secret_ref, organization_id from marketing.integration_connections where id = $1 and revoked_at is null",
      [pref.connection_id],
    );
    if (!c || c.organization_id !== organizationId) return null;
    mode = c.mode;
    status = c.status;
    externalAccount = c.external_account ?? {};
    if (c.secret_ref) {
      const s = await tx.one<{ ct: string | null }>("select marketing.read_secret($1) as ct", [pref.connection_id]);
      credentials = decryptCredentials(s?.ct);
    }
  }
  const ctx: ProviderContext = { organizationId, venueId, connectionId: pref.connection_id, mode, credentials, externalAccount };
  return { provider: factory(ctx, tx) as T, providerKey: pref.provider_key, connectionId: pref.connection_id, mode, status };
}

export const resolveAi = (tx: Tx, org: string, venue: string | null) => resolveProvider<AIProvider>(tx, org, venue, "ai_generation");
export const resolveImageRenderer = (tx: Tx, org: string, venue: string | null) => resolveProvider<RenderProvider>(tx, org, venue, "image_rendering");
export const resolveVideoRenderer = (tx: Tx, org: string, venue: string | null) => resolveProvider<RenderProvider>(tx, org, venue, "video_rendering");
export const resolvePublisher = (tx: Tx, org: string, venue: string | null) => resolveProvider<SocialPublisherProvider>(tx, org, venue, "social_publishing");
export const resolveWorkflow = (tx: Tx, org: string, venue: string | null) => resolveProvider<WorkflowProvider>(tx, org, venue, "workflow_automation");
export const resolveNotifications = (tx: Tx, org: string, venue: string | null) => resolveProvider<NotificationProvider>(tx, org, venue, "notifications");
export const resolveMetrics = (tx: Tx, org: string, venue: string | null) => resolveProvider<MetricsProvider>(tx, org, venue, "analytics");

/** Vytvoří instanci podle klíče a existujícího připojení (pro test spojení v Integracích). */
export async function instantiateConnection(tx: Tx, connectionId: string): Promise<AnyProvider | null> {
  const c = await tx.one<{ provider_key: string; organization_id: string; venue_id: string | null; mode: ConnectionMode; external_account: Record<string, unknown>; secret_ref: string | null }>(
    "select provider_key, organization_id, venue_id, mode, external_account, secret_ref from marketing.integration_connections where id = $1",
    [connectionId],
  );
  if (!c) return null;
  const factory = FACTORIES[c.provider_key];
  if (!factory) return null;
  let credentials: Record<string, string> = {};
  if (c.secret_ref) {
    const s = await tx.one<{ ct: string | null }>("select marketing.read_secret($1) as ct", [connectionId]);
    credentials = decryptCredentials(s?.ct);
  }
  return factory({ organizationId: c.organization_id, venueId: c.venue_id, connectionId, mode: c.mode, credentials, externalAccount: c.external_account ?? {} }, tx);
}
