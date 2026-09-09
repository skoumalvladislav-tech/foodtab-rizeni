import type { Tx } from "../db/driver.ts";
import { encryptCredentials } from "../providers/credentials.ts";
import { instantiateConnection } from "../providers/registry.ts";
import type { ConnectionMode } from "../providers/types.ts";
import { assertAccess } from "./obsah.ts";

/**
 * Volba nástroje a připojení účtu — vždy za organizaci (nebo provozovnu),
 * credentials nikdy nepromíchané mezi organizacemi (RLS + funkce
 * store_secret/read_secret to hlídají i bez aplikace).
 */

/** Vestavěné/mock poskytovatele, na které se spadne po odpojení. */
export const ZALOZNI: Record<string, { key: string; mode: ConnectionMode }> = {
  ai_generation: { key: "internal_mock_ai", mode: "mock" },
  image_rendering: { key: "internal_svg_renderer", mode: "foodtab_managed" },
  video_rendering: { key: "internal_mock_video", mode: "mock" },
  workflow_automation: { key: "internal_queue", mode: "foodtab_managed" },
  social_publishing: { key: "manual_export", mode: "manual_export" },
  analytics: { key: "mock_metrics", mode: "mock" },
  notifications: { key: "internal_notifications", mode: "foodtab_managed" },
  external_storage: { key: "local_storage", mode: "mock" },
  menu_source: { key: "manual_menu", mode: "foodtab_managed" },
};

export async function zalozitVychoziPreference(tx: Tx, organizationId: string): Promise<void> {
  for (const [category, z] of Object.entries(ZALOZNI)) {
    const exists = await tx.one("select 1 from marketing.organization_provider_preferences where organization_id = $1 and category = $2 and venue_id is null and is_active", [organizationId, category]);
    if (exists) continue;
    const conn = await tx.one<{ id: string }>(
      "insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name, last_test_at, last_test_ok) values ($1, $2, $3, 'connected', $4, now(), true) returning id",
      [organizationId, z.key, z.mode, z.mode === "mock" ? "Demo režim" : "Vestavěné"]);
    await tx.q("insert into marketing.organization_provider_preferences (organization_id, venue_id, category, provider_key, connection_id) values ($1, null, $2, $3, $4)", [organizationId, category, z.key, conn!.id]);
  }
}

/** Vybere poskytovatele: u nástrojů bez přihlášení rovnou aktivuje; jinak založí připojení ve stavu „připojuje se“. */
export async function vybratPoskytovatele(tx: Tx, p: { organizationId: string; venueId: string | null; providerKey: string; userId: string }): Promise<{ connectionId: string; needs: "none" | "api_key" | "oauth" | "webhook_secret" }> {
  await assertAccess(tx, p.organizationId, "integrations.manage", null);
  const cat = await tx.one<{ category: string; auth_type: string; implementation_status: string; connection_modes: string[] }>("select category, auth_type, implementation_status, connection_modes from marketing.provider_catalog where key = $1", [p.providerKey]);
  if (!cat) throw new Error("Neznámý nástroj.");
  if (cat.implementation_status !== "implemented") throw new Error("Tenhle nástroj zatím připravujeme — nemá hotový adaptér, nejde ho připojit.");
  const existing = await tx.one<{ id: string; status: string }>("select id, status from marketing.integration_connections where organization_id = $1 and venue_id is not distinct from $2 and provider_key = $3 and revoked_at is null order by created_at desc limit 1", [p.organizationId, p.venueId, p.providerKey]);
  const mode: ConnectionMode = cat.auth_type === "none" ? (cat.connection_modes.includes("mock") ? "mock" : cat.connection_modes.includes("manual_export") ? "manual_export" : "foodtab_managed") : "customer_managed";
  let connectionId = existing?.id;
  if (!connectionId) {
    const c = await tx.one<{ id: string }>(
      "insert into marketing.integration_connections (organization_id, venue_id, provider_key, mode, status, display_name, connected_by, last_test_at, last_test_ok) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
      [p.organizationId, p.venueId, p.providerKey, mode, cat.auth_type === "none" ? "connected" : "connecting", mode === "mock" ? "Demo režim" : mode === "manual_export" ? "Ruční export" : mode === "foodtab_managed" ? "Vestavěné" : "", p.userId, cat.auth_type === "none" ? new Date().toISOString() : null, cat.auth_type === "none" ? true : null]);
    connectionId = c!.id;
  }
  if (cat.auth_type === "none" || existing?.status === "connected") {
    await aktivovat(tx, p.organizationId, p.venueId, cat.category, p.providerKey, connectionId, p.userId);
    return { connectionId, needs: "none" };
  }
  return { connectionId, needs: cat.auth_type as "api_key" | "oauth" | "webhook_secret" };
}

export async function aktivovat(tx: Tx, organizationId: string, venueId: string | null, category: string, providerKey: string, connectionId: string, userId: string) {
  await tx.q("update marketing.organization_provider_preferences set is_active = false where organization_id = $1 and venue_id is not distinct from $2 and category = $3 and is_active", [organizationId, venueId, category]);
  await tx.q("insert into marketing.organization_provider_preferences (organization_id, venue_id, category, provider_key, connection_id, set_by) values ($1, $2, $3, $4, $5, $6)", [organizationId, venueId, category, providerKey, connectionId, userId]);
}

/** Uloží zákaznický klíč (šifrovaně), otestuje spojení a při úspěchu aktivuje. Klíč se nikdy nevrací. */
export async function ulozitKlic(tx: Tx, p: { connectionId: string; credentials: Record<string, string>; userId: string }): Promise<{ ok: boolean; message: string }> {
  const c = await tx.one<{ organization_id: string; venue_id: string | null; provider_key: string; category: string }>("select c.organization_id, c.venue_id, c.provider_key, pc.category from marketing.integration_connections c join marketing.provider_catalog pc on pc.key = c.provider_key where c.id = $1", [p.connectionId]);
  if (!c) throw new Error("Připojení nenalezeno.");
  await assertAccess(tx, c.organization_id, "integrations.manage", null);
  const clean = Object.fromEntries(Object.entries(p.credentials).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  if (!clean.api_key && !clean.access_token && !clean.webhook_secret) throw new Error("Zadejte klíč.");
  const { ciphertext, fingerprint } = encryptCredentials(clean);
  await tx.q("select marketing.store_secret($1, $2, $3)", [p.connectionId, ciphertext, fingerprint]);
  await tx.q("update marketing.integration_connections set mode = 'customer_managed', status = 'connecting', connected_by = $2, display_name = $3 where id = $1", [p.connectionId, p.userId, `Vlastní účet (…${(clean.api_key ?? clean.access_token ?? clean.webhook_secret ?? "").slice(-4)})`]);
  const t = await otestovat(tx, p.connectionId);
  if (t.ok) await aktivovat(tx, c.organization_id, c.venue_id, c.category, c.provider_key, p.connectionId, p.userId);
  return t;
}

export async function otestovat(tx: Tx, connectionId: string): Promise<{ ok: boolean; message: string }> {
  const c = await tx.one<{ organization_id: string }>("select organization_id from marketing.integration_connections where id = $1", [connectionId]);
  if (!c) throw new Error("Připojení nenalezeno.");
  await assertAccess(tx, c.organization_id, "integrations.manage", null);
  const p = await instantiateConnection(tx, connectionId);
  if (!p) throw new Error("Adaptér není k dispozici.");
  let r: { ok: boolean; message: string; externalAccount?: Record<string, unknown>; grantedScopes?: string[]; expiresAt?: string | null };
  try {
    r = await p.testConnection();
  } catch (e) {
    r = { ok: false, message: e instanceof Error ? e.message : "Test selhal." };
  }
  await tx.q(
    `update marketing.integration_connections set last_test_at = now(), last_test_ok = $2, last_error = $3, status = case when $2 then 'connected' else 'error' end,
       external_account = coalesce($4::jsonb, external_account), granted_scopes = coalesce($5, granted_scopes), expires_at = coalesce($6::timestamptz, expires_at) where id = $1`,
    [connectionId, r.ok, r.ok ? null : r.message, r.externalAccount ? JSON.stringify(r.externalAccount) : null, r.grantedScopes ?? null, r.expiresAt ?? null]);
  return { ok: r.ok, message: r.message };
}

/** Bezpečné odpojení: smaže tajemství, označí revoked, přepne na záložní nástroj. Obsah a historie zůstávají. */
export async function odpojit(tx: Tx, connectionId: string, userId: string): Promise<void> {
  const c = await tx.one<{ organization_id: string; venue_id: string | null; provider_key: string; category: string; secret_ref: string | null }>("select c.organization_id, c.venue_id, c.provider_key, pc.category, c.secret_ref from marketing.integration_connections c join marketing.provider_catalog pc on pc.key = c.provider_key where c.id = $1", [connectionId]);
  if (!c) throw new Error("Připojení nenalezeno.");
  await assertAccess(tx, c.organization_id, "integrations.manage", null);
  if (c.secret_ref) await tx.q("select marketing.delete_secret($1)", [connectionId]);
  await tx.q("update marketing.integration_connections set status = 'revoked', revoked_at = now(), external_account = '{}'::jsonb, granted_scopes = '{}' where id = $1", [connectionId]);
  await tx.q("update marketing.social_accounts set is_active = false where connection_id = $1", [connectionId]);
  await tx.q("update marketing.organization_provider_preferences set is_active = false where connection_id = $1", [connectionId]);
  const z = ZALOZNI[c.category];
  if (z) {
    const zal = await tx.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and venue_id is not distinct from $2 and provider_key = $3 and revoked_at is null limit 1", [c.organization_id, c.venue_id, z.key]);
    let zalId = zal?.id;
    if (!zalId) {
      const n = await tx.one<{ id: string }>("insert into marketing.integration_connections (organization_id, venue_id, provider_key, mode, status, display_name, last_test_at, last_test_ok) values ($1, $2, $3, $4, 'connected', $5, now(), true) returning id", [c.organization_id, c.venue_id, z.key, z.mode, z.mode === "mock" ? "Demo režim" : "Vestavěné"]);
      zalId = n!.id;
    }
    await aktivovat(tx, c.organization_id, c.venue_id, c.category, z.key, zalId, userId);
  }
}
