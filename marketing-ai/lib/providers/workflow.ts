import { hmacHex } from "../utils/hash.ts";
import type { ProviderContext, WorkflowProvider } from "./types.ts";

/**
 * Interní fronta — funguje vždy. „Trigger“ je jen záznam; skutečné
 * zpracování dělá lib/domena/fronta.ts (render/publish joby v databázi),
 * které spouští /api/v1/ulohy/zpracovat (cron nebo ruční tlačítko).
 */
export function createInternalQueue(ctx: ProviderContext): WorkflowProvider {
  return {
    key: "internal_queue",
    category: "workflow_automation",
    capabilities: ["workflow.trigger", "workflow.callback"],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      return { ok: true, message: "Interní fronta běží uvnitř aplikace." };
    },
    async trigger() {
      return { accepted: true };
    },
  };
}

/**
 * n8n — podepsané webhooky oběma směry.
 *
 * Odchozí: POST {N8N_BASE_URL}/webhook/foodtab-marketing/{type} s hlavičkami
 *   X-FoodTab-Signature: hex(HMAC-SHA256(secret, timestamp + "." + body))
 *   X-FoodTab-Timestamp, X-FoodTab-Idempotency-Key
 * Příchozí (callback z n8n): /api/v1/webhooky/n8n, stejný podpis.
 *
 * Workflow nedrží execution otevřenou kvůli schválení: schválení se
 * uloží v aplikaci a vyvolá NOVOU podepsanou událost.
 */
export function createN8n(ctx: ProviderContext): WorkflowProvider {
  const base = (ctx.credentials.base_url || process.env.N8N_BASE_URL || "").replace(/\/$/, "");
  const secret = ctx.credentials.webhook_secret || process.env.N8N_WEBHOOK_SECRET || "";
  return {
    key: "n8n",
    category: "workflow_automation",
    capabilities: base && secret ? ["workflow.trigger", "workflow.callback"] : [],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      if (!base || !secret) return { ok: false, message: "Chybí adresa n8n nebo tajemství webhooku." };
      try {
        const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) });
        return res.ok ? { ok: true, message: `n8n odpovídá (${base}).`, externalAccount: { base_url: base } } : { ok: false, message: `n8n vrátilo ${res.status}.` };
      } catch (e) {
        return { ok: false, message: `n8n nedostupné: ${e instanceof Error ? e.message : "chyba"}` };
      }
    },
    async trigger(event) {
      if (!base || !secret) return { accepted: false, error: "n8n není připojené." };
      const body = JSON.stringify({ type: event.type, idempotencyKey: event.idempotencyKey, payload: event.payload, organizationId: ctx.organizationId });
      const ts = String(Math.floor(Date.now() / 1000));
      const res = await fetch(`${base}/webhook/foodtab-marketing/${event.type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-FoodTab-Signature": hmacHex(secret, `${ts}.${body}`), "X-FoodTab-Timestamp": ts, "X-FoodTab-Idempotency-Key": event.idempotencyKey },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { accepted: false, error: `n8n vrátilo ${res.status}` };
      const j = (await res.json().catch(() => ({}))) as { executionId?: string };
      return { accepted: true, externalRunId: j.executionId };
    },
  };
}

/** Ověření příchozího podpisu (n8n → aplikace i FoodTab → aplikace). Okno 5 minut proti replay. */
export function overitPodpisWebhooku(secret: string, timestamp: string | null, signature: string | null, body: string, now = Date.now()): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = hmacHex(secret, `${timestamp}.${body}`);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
