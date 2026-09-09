import type { Tx } from "../db/driver.ts";
import { withService } from "../db/session.ts";
import { formatSpec } from "../formaty.ts";
import { decryptCredentials } from "../providers/credentials.ts";
import { FACTORIES } from "../providers/registry.ts";
import type { ConnectionMode, RenderProvider, SocialPublisherProvider } from "../providers/types.ts";
import { podepsatSoubor } from "../storage/podpis.ts";
import { upozornit, uzivateleSPravem } from "./notifikace.ts";
import { ulozitRenderVystup } from "./obsah.ts";

/**
 * Interní fronta úloh — běží bez uživatele (service role).
 *
 * Kdo ji spouští: /api/v1/ulohy/zpracovat (cron na Vercelu, n8n, nebo
 * tlačítko v rozhraní). Každý běh:
 *  1. dokončí asynchronní rendery (polling u Shotstacku),
 *  2. zveřejní splatné publikace (scheduled_for <= now),
 *  3. zopakuje selhané s exponenciálním odstupem, po max_attempts → dead_letter.
 *
 * Idempotence: úloha má jeden řádek a jeden idempotency_key; opakování
 * nikdy nevytvoří druhý příspěvek. „Zveřejněno“ se zapíše až po
 * potvrzení poskytovatelem.
 */
export interface VysledekBehu {
  rendery: { done: number; failed: number; pending: number };
  publikace: { published: number; mock: number; manual: number; retried: number; dead: number };
}

export async function zpracovatFrontu(opts: { now?: Date; limit?: number } = {}): Promise<VysledekBehu> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 20;
  return withService(async (tx) => {
    const out: VysledekBehu = { rendery: { done: 0, failed: 0, pending: 0 }, publikace: { published: 0, mock: 0, manual: 0, retried: 0, dead: 0 } };
    await dokoncitRendery(tx, now, limit, out);
    await zverejnitSplatne(tx, now, limit, out);
    return out;
  });
}

async function providerZPripojeni<T>(tx: Tx, providerKey: string, connectionId: string | null, organizationId: string, venueId: string | null, mode: ConnectionMode): Promise<T | null> {
  const factory = FACTORIES[providerKey];
  if (!factory) return null;
  let credentials: Record<string, string> = {};
  let externalAccount: Record<string, unknown> = {};
  if (connectionId) {
    const c = await tx.one<{ external_account: Record<string, unknown>; ciphertext: string | null }>(
      `select c.external_account, s.ciphertext from marketing.integration_connections c left join marketing.integration_secrets s on s.connection_id = c.id
        where c.id = $1 and c.organization_id = $2 and c.revoked_at is null`, [connectionId, organizationId]);
    if (!c) return null;
    externalAccount = c.external_account ?? {};
    credentials = decryptCredentials(c.ciphertext);
  }
  return factory({ organizationId, venueId, connectionId, mode, credentials, externalAccount }, tx) as T;
}

async function dokoncitRendery(tx: Tx, now: Date, limit: number, out: VysledekBehu) {
  const jobs = await tx.q<{ id: string; organization_id: string; venue_id: string; provider_key: string; connection_id: string | null; mode: ConnectionMode; external_id: string | null; variant_id: string | null; content_version_id: string; attempts: number; max_attempts: number; request: { formatKey: string } }>(
    `select id, organization_id, venue_id, provider_key, connection_id, mode, external_id, variant_id, content_version_id, attempts, max_attempts, request
       from marketing.render_jobs where status in ('submitted','rendering') and (next_attempt_at is null or next_attempt_at <= $1) order by created_at limit $2`, [now.toISOString(), limit]);
  for (const j of jobs) {
    const p = await providerZPripojeni<RenderProvider>(tx, j.provider_key, j.connection_id, j.organization_id, j.venue_id, j.mode);
    if (!p?.status || !j.external_id) {
      await tx.q("update marketing.render_jobs set status = 'failed', error = 'Poskytovatel nedostupný pro dokončení renderu', finished_at = now() where id = $1", [j.id]);
      out.rendery.failed++;
      continue;
    }
    try {
      const s = await p.status(j.external_id);
      if (s.status === "done" && s.url) {
        const res = await fetch(s.url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const mime = res.headers.get("content-type") ?? "video/mp4";
        const cover = await tx.one<{ cover_asset_id: string | null }>("select cover_asset_id from marketing.content_versions where id = $1", [j.content_version_id]);
        const assetId = await ulozitRenderVystup(tx, { organizationId: j.organization_id, venueId: j.venue_id, userId: null, output: { bytes, mime, filename: `${j.request.formatKey}-${j.id.slice(0, 8)}.${mime.includes("mp4") ? "mp4" : "bin"}` }, derivedFrom: cover?.cover_asset_id ?? null, jobId: j.id, formatKey: j.request.formatKey, mock: false });
        await tx.q("update marketing.render_jobs set status = 'done', response = $2, output_asset_id = $3, finished_at = now() where id = $1", [j.id, JSON.stringify(s.response ?? {}), assetId]);
        if (j.variant_id) await tx.q("update marketing.content_variants set output_asset_id = $1 where id = $2", [assetId, j.variant_id]);
        out.rendery.done++;
      } else if (s.status === "failed") {
        await tx.q("update marketing.render_jobs set status = 'failed', error = $2, response = $3, finished_at = now() where id = $1", [j.id, s.error ?? "Render selhal", JSON.stringify(s.response ?? {})]);
        out.rendery.failed++;
      } else {
        await tx.q("update marketing.render_jobs set status = 'rendering', next_attempt_at = $2 where id = $1", [j.id, new Date(now.getTime() + 30_000).toISOString()]);
        out.rendery.pending++;
      }
    } catch (e) {
      await tx.q("update marketing.render_jobs set next_attempt_at = $2, error = $3 where id = $1", [j.id, new Date(now.getTime() + 60_000).toISOString(), e instanceof Error ? e.message : "chyba"]);
      out.rendery.pending++;
    }
  }
}

export function odstupPokusu(attempt: number): number {
  // 1, 2, 4, 8, 16 minut — strop 30 minut
  return Math.min(30, 2 ** Math.max(0, attempt - 1)) * 60;
}

async function zverejnitSplatne(tx: Tx, now: Date, limit: number, out: VysledekBehu) {
  const jobs = await tx.q<{
    id: string; organization_id: string; venue_id: string; content_item_id: string; content_version_id: string; version_checksum: string; variant_id: string | null;
    social_account_id: string | null; channel: "instagram" | "facebook"; format: string; provider_key: string; connection_id: string | null; mode: ConnectionMode;
    idempotency_key: string; attempts: number; max_attempts: number; scheduled_for: string;
  }>(
    `select id, organization_id, venue_id, content_item_id, content_version_id, version_checksum, variant_id, social_account_id, channel, format, provider_key, connection_id, mode, idempotency_key, attempts, max_attempts, scheduled_for
       from marketing.publish_jobs
      where scheduled_for <= $1 and (status in ('scheduled','queued') or (status = 'failed' and next_attempt_at <= $1))
      order by scheduled_for limit $2`, [now.toISOString(), limit]);

  for (const j of jobs) {
    // Ochrana proti publikaci změněné verze: otisk musí sedět i teď.
    const v = await tx.one<{ checksum: string; texts: Record<string, { caption: string; hashtags: string[] }>; media_asset_ids: string[]; cover_asset_id: string | null }>(
      "select checksum, texts, media_asset_ids, cover_asset_id from marketing.content_versions where id = $1", [j.content_version_id]);
    const item = await tx.one<{ approved_version_id: string | null; title: string }>("select approved_version_id, title from marketing.content_items where id = $1", [j.content_item_id]);
    if (!v || v.checksum !== j.version_checksum || item?.approved_version_id !== j.content_version_id) {
      await tx.q("update marketing.publish_jobs set status = 'cancelled', last_error = 'Schválení už neplatí (obsah se změnil).' where id = $1", [j.id]);
      continue;
    }
    await tx.q("update marketing.publish_jobs set status = 'publishing', attempts = attempts + 1 where id = $1", [j.id]);
    await tx.q("update marketing.content_items set status = 'publishing' where id = $1 and status in ('scheduled','approved','publish_failed','connection_required')", [j.content_item_id]);

    const p = await providerZPripojeni<SocialPublisherProvider>(tx, j.provider_key, j.connection_id, j.organization_id, j.venue_id, j.mode);
    const account = j.social_account_id ? await tx.one<{ external_id: string; kind: string; name: string }>("select external_id, kind, name from marketing.social_accounts where id = $1", [j.social_account_id]) : null;
    const variant = j.variant_id ? await tx.one<{ output_asset_id: string | null; spec: { formatKey: string; kind: string } }>("select output_asset_id, spec from marketing.content_variants where id = $1", [j.variant_id]) : null;
    const mediaIds = variant?.output_asset_id ? [variant.output_asset_id] : (v.cover_asset_id ? [v.cover_asset_id, ...v.media_asset_ids.filter((m) => m !== v.cover_asset_id)] : v.media_asset_ids);
    const media = mediaIds.length ? await tx.q<{ id: string; mime_type: string; kind: string }>("select id, mime_type, kind from marketing.media_assets where id = any($1::uuid[])", [mediaIds]) : [];
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const t = v.texts[j.channel];
    const caption = t ? [t.caption, t.hashtags.join(" ")].filter(Boolean).join("\n\n") : "";

    let result;
    if (!p) {
      result = { status: "failed" as const, error: "Publikační nástroj není dostupný." };
    } else {
      const spec = formatSpec(variant?.spec.formatKey ?? "");
      const cap = spec?.publishCapability;
      const wantsVideo = spec?.kind === "video";
      const hasVideo = media.some((m) => m.mime_type.startsWith("video/"));
      if ((cap && !p.capabilities.includes(cap)) || (wantsVideo && !hasVideo && !p.isMock)) {
        // Formát nebo médium nástroj nepodporuje → ruční zveřejnění, ne falešná automatizace.
        result = { status: "manual_export" as const, response: { reason: wantsVideo && !hasVideo ? "Chybí skutečné video (demo render nevytváří video)." : "Formát nástroj nepodporuje." } };
      } else {
        try {
          result = await p.publish({
            jobId: j.id, idempotencyKey: j.idempotency_key, channel: j.channel, format: j.format,
            account: account ? { externalId: account.external_id, kind: account.kind, name: account.name } : null,
            caption,
            media: mediaIds.map((id) => media.find((m) => m.id === id)).filter(Boolean).map((m) => ({ url: `${base}${podepsatSoubor(m!.id, 24 * 3600)}`, mime: m!.mime_type, kind: m!.mime_type.startsWith("video/") ? "video" as const : "image" as const })),
            scheduledFor: new Date(j.scheduled_for),
          });
        } catch (e) {
          result = { status: "failed" as const, error: e instanceof Error ? e.message : "Publikace selhala" };
        }
      }
    }

    if (result.status === "published" || result.status === "published_mock" || result.status === "manual_export") {
      await tx.q("update marketing.publish_jobs set status = $2, external_post_id = $3, response = $4, published_at = case when $2 = 'manual_export' then null else now() end, last_error = null where id = $1",
        [j.id, result.status, result.externalPostId ?? null, JSON.stringify(result.response ?? {})]);
      if (result.status !== "manual_export") {
        await tx.q(
          `insert into marketing.publications (organization_id, venue_id, content_item_id, content_version_id, publish_job_id, social_account_id, channel, format, external_post_id, permalink, is_mock, raw_response)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (publish_job_id) do nothing`,
          [j.organization_id, j.venue_id, j.content_item_id, j.content_version_id, j.id, j.social_account_id, j.channel, j.format, result.externalPostId ?? null, result.permalink ?? null, result.status === "published_mock", JSON.stringify(result.response ?? {})]);
      }
      const zbyva = await tx.one<{ n: number }>("select count(*)::int as n from marketing.publish_jobs where content_item_id = $1 and status in ('scheduled','queued','publishing','failed')", [j.content_item_id]);
      if ((zbyva?.n ?? 0) === 0) await tx.q("update marketing.content_items set status = 'published' where id = $1", [j.content_item_id]);
      if (result.status === "published") out.publikace.published++;
      else if (result.status === "published_mock") out.publikace.mock++;
      else out.publikace.manual++;
      if (result.status === "manual_export") {
        await upozornit(tx, { organizationId: j.organization_id, userIds: await uzivateleSPravem(tx, j.organization_id, "content.publish", j.venue_id), kind: "manual_export", title: `K ručnímu zveřejnění: ${item?.title || "příspěvek"}`, body: String((result.response as { reason?: string } | undefined)?.reason ?? ""), link: `/${await slug(tx, j.venue_id)}/publikace` });
      }
      continue;
    }

    // Selhání → retry s odstupem, nebo dead-letter.
    const attempts = j.attempts + 1;
    const retry = result.status === "retry" || attempts < j.max_attempts;
    if (retry && attempts < j.max_attempts) {
      const sec = result.status === "retry" && result.retryAfterSeconds ? result.retryAfterSeconds : odstupPokusu(attempts);
      await tx.q("update marketing.publish_jobs set status = 'failed', last_error = $2, next_attempt_at = $3, response = $4 where id = $1",
        [j.id, result.error ?? "Publikace selhala", new Date(now.getTime() + sec * 1000).toISOString(), JSON.stringify(result.response ?? {})]);
      await tx.q("update marketing.content_items set status = 'publish_failed' where id = $1", [j.content_item_id]);
      out.publikace.retried++;
    } else {
      await tx.q("update marketing.publish_jobs set status = 'dead_letter', last_error = $2, response = $3 where id = $1", [j.id, result.error ?? "Publikace selhala", JSON.stringify(result.response ?? {})]);
      await tx.q("update marketing.content_items set status = $2 where id = $1", [j.content_item_id, /token|připoj|190/i.test(result.error ?? "") ? "connection_required" : "publish_failed"]);
      await upozornit(tx, { organizationId: j.organization_id, userIds: await uzivateleSPravem(tx, j.organization_id, "content.publish", j.venue_id), kind: "publish_failed", title: `Publikace selhala: ${item?.title || "příspěvek"}`, body: result.error ?? "", link: `/${await slug(tx, j.venue_id)}/obsah/${j.content_item_id}` });
      out.publikace.dead++;
    }
  }
}

async function slug(tx: Tx, venueId: string): Promise<string> {
  const v = await tx.one<{ slug: string }>("select slug from marketing.venues where id = $1", [venueId]);
  return v?.slug ?? "";
}

/** Ruční opakování selhané publikace (tlačítko „Zkusit znovu“) — jen nastaví next_attempt_at, zpracuje fronta. */
export async function zopakovatPublikaci(tx: Tx, jobId: string): Promise<void> {
  const j = await tx.one<{ organization_id: string; venue_id: string; status: string }>("select organization_id, venue_id, status from marketing.publish_jobs where id = $1", [jobId]);
  if (!j) throw new Error("Úloha nenalezena.");
  const ok = await tx.one<{ ok: boolean }>("select marketing.has_access($1, 'content.publish', $2) as ok", [j.organization_id, j.venue_id]);
  if (!ok?.ok) throw new Error("Na tuhle akci nemáte oprávnění.");
  if (!["failed", "dead_letter", "manual_export"].includes(j.status)) throw new Error("Opakovat lze jen selhanou úlohu.");
  await tx.q("update marketing.publish_jobs set status = 'queued', next_attempt_at = null, attempts = case when status = 'dead_letter' then 0 else attempts end, scheduled_for = least(scheduled_for, now()) where id = $1", [jobId]);
}
