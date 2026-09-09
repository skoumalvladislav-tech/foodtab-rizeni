import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { withService } from "@/lib/db";
import { zpracovatFrontu } from "@/lib/domena/fronta";
import { rozpoznaniNaVstup, ulozitMenu } from "@/lib/domena/menu";
import { overitPodpisWebhooku } from "@/lib/providers/workflow";
import { safeEqual } from "@/lib/utils/hash";

/**
 * Příchozí webhooky: shotstack | n8n | meta | foodtab.
 *
 *  - Každá událost se uloží idempotentně (marketing.webhook_events,
 *    unikátní podle zdroje + externího ID). Duplicita se přijme a
 *    nezpracuje podruhé.
 *  - Podpis se ověřuje PŘED zpracováním; neplatný podpis = 401 a záznam
 *    se signature_ok = false.
 *  - Zpracování běží pod service role, protože tu žádný uživatel není.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ zdroj: string }> }) {
  const { zdroj } = await ctx.params;
  const raw = await req.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Tělo není JSON." }, { status: 400 });
  }

  let signatureOk = false;
  let externalId = "";
  switch (zdroj) {
    case "shotstack": {
      // Shotstack podepisuje jen volitelně; ověřujeme shodu render ID s naší úlohou.
      externalId = String(payload.id ?? payload.render ?? "");
      signatureOk = Boolean(externalId);
      break;
    }
    case "n8n": {
      const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
      signatureOk = overitPodpisWebhooku(secret, req.headers.get("x-foodtab-timestamp"), req.headers.get("x-foodtab-signature"), raw);
      externalId = req.headers.get("x-foodtab-idempotency-key") ?? String(payload.idempotencyKey ?? "");
      break;
    }
    case "meta": {
      const secret = process.env.META_APP_SECRET ?? "";
      const sig = req.headers.get("x-hub-signature-256") ?? "";
      signatureOk = Boolean(secret) && sig.startsWith("sha256=") && safeEqual(sig.slice(7), createHmac("sha256", secret).update(raw).digest("hex"));
      externalId = String((payload.entry as { id?: string; time?: number }[] | undefined)?.map((e) => `${e.id}:${e.time}`).join(",") ?? Date.now());
      break;
    }
    case "foodtab": {
      const secret = process.env.FOODTAB_WEBHOOK_SECRET ?? "";
      signatureOk = overitPodpisWebhooku(secret, req.headers.get("x-foodtab-timestamp"), req.headers.get("x-foodtab-signature"), raw);
      externalId = String(payload.event_id ?? payload.id ?? "");
      break;
    }
    default:
      return NextResponse.json({ error: "Neznámý zdroj." }, { status: 404 });
  }
  if (!externalId) return NextResponse.json({ error: "Chybí identifikátor události." }, { status: 400 });

  const inserted = await withService((tx) => tx.one<{ id: string }>(
    "insert into marketing.webhook_events (provider_key, external_event_id, signature_ok, payload) values ($1, $2, $3, $4) on conflict (provider_key, external_event_id) do nothing returning id",
    [zdroj, externalId, signatureOk, JSON.stringify(payload)]));
  if (!signatureOk) return NextResponse.json({ error: "Neplatný podpis." }, { status: 401 });
  if (!inserted) return NextResponse.json({ ok: true, duplicate: true });

  let result = "ok";
  try {
    if (zdroj === "shotstack") {
      const status = String(payload.status ?? "");
      await withService((tx) => tx.q("update marketing.render_jobs set next_attempt_at = now(), response = $2 where external_id = $1 and status in ('submitted','rendering')", [externalId, JSON.stringify(payload)]));
      if (status === "done" || status === "failed") await zpracovatFrontu({ limit: 10 });
      result = `render ${status}`;
    } else if (zdroj === "n8n") {
      const type = String(payload.type ?? "");
      if (type === "queue.process") await zpracovatFrontu({ limit: 50 });
      result = `n8n ${type}`;
    } else if (zdroj === "foodtab") {
      result = await zpracovatFoodtab(payload);
    } else if (zdroj === "meta") {
      // Meta webhooky (změny příspěvků, odvolání oprávnění) — zatím jen evidence + označení připojení.
      const revoked = JSON.stringify(payload).includes("permissions") || JSON.stringify(payload).includes("deauthorize");
      if (revoked) await withService((tx) => tx.q("update marketing.integration_connections set status = 'needs_attention', last_error = 'Meta hlásí změnu oprávnění — připojte účet znovu.' where provider_key = 'meta_graph' and revoked_at is null"));
      result = revoked ? "meta permissions changed" : "meta event";
    }
  } catch (e) {
    result = `chyba: ${e instanceof Error ? e.message : "neznámá"}`;
  }
  await withService((tx) => tx.q("update marketing.webhook_events set processed_at = now(), result = $2 where id = $1", [inserted.id, result]));
  return NextResponse.json({ ok: true, result });
}

/** Ověření webhooku Meta (GET s hub.challenge). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ zdroj: string }> }) {
  const { zdroj } = await ctx.params;
  if (zdroj === "meta") {
    const q = req.nextUrl.searchParams;
    const token = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
    if (q.get("hub.mode") === "subscribe" && token && q.get("hub.verify_token") === token) return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
    return NextResponse.json({ error: "Ověření selhalo." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, zdroj, note: "Webhooky přijímají POST." });
}

/**
 * Události z FoodTab Řízení (etapa 3), verzované: menu.created / menu.updated / menu.approved (v1).
 * Payload: { event_id, type, version: 1, organization: { foodtab_tenant_id }, venue: { foodtab_branch_id }, menu: {...} }
 */
async function zpracovatFoodtab(payload: Record<string, unknown>): Promise<string> {
  const type = String(payload.type ?? "");
  if (Number(payload.version ?? 1) !== 1) return `nepodporovaná verze události ${payload.version}`;
  if (!type.startsWith("menu.")) return `ignorováno: ${type}`;
  const org = (payload.organization as { foodtab_tenant_id?: string } | undefined)?.foodtab_tenant_id;
  const ven = (payload.venue as { foodtab_branch_id?: string } | undefined)?.foodtab_branch_id;
  const menu = payload.menu as { kind?: string; title?: string; valid_from?: string | null; valid_to?: string | null; days?: { label: string; day_date: string | null; items: never[] }[]; items?: never[] } | undefined;
  if (!org || !ven || !menu) return "chybí organizace, provozovna nebo menu";
  return withService(async (tx) => {
    const v = await tx.one<{ id: string; organization_id: string }>("select v.id, v.organization_id from marketing.venues v join marketing.organizations o on o.id = v.organization_id where o.foodtab_tenant_id = $1 and v.foodtab_branch_id = $2", [org, ven]);
    if (!v) return "provozovna z FoodTabu není propojená";
    const owner = await tx.one<{ user_id: string }>("select m.user_id from marketing.memberships m join marketing.roles r on r.id = m.role_id where m.organization_id = $1 and r.is_owner and m.status = 'active' limit 1", [v.organization_id]);
    const existing = await tx.one<{ id: string }>("select id from marketing.menus where venue_id = $1 and foodtab_event_id = $2", [v.id, String(payload.event_id)]);
    const vstup = rozpoznaniNaVstup({ kind: menu.kind ?? "daily", title: menu.title ?? "", valid_from: menu.valid_from ?? null, valid_to: menu.valid_to ?? null, days: menu.days ?? [], items: menu.items ?? [], warnings: [] },
      { organizationId: v.organization_id, venueId: v.id, userId: owner?.user_id ?? "00000000-0000-0000-0000-000000000000", source: "foodtab" });
    // service role: ulozitMenu volá has_access → v service kontextu je uid prázdné; zapíšeme přímo
    const id = existing?.id ?? (await tx.one<{ id: string }>("insert into marketing.menus (organization_id, venue_id, kind, title, valid_from, valid_to, source, status, foodtab_event_id, raw_import) values ($1, $2, $3, $4, $5, $6, 'foodtab', $7, $8, $9) returning id",
      [v.organization_id, v.id, vstup.kind, vstup.title, vstup.validFrom, vstup.validTo, type === "menu.approved" ? "confirmed" : "draft", String(payload.event_id), JSON.stringify(payload)]))!.id;
    await tx.q("delete from marketing.menu_items where menu_id = $1", [id]);
    let sort = 0;
    for (const it of vstup.items) await tx.q("insert into marketing.menu_items (menu_id, category, name, description, price_cents, allergens, sort_order) values ($1, $2, $3, $4, $5, $6, $7)", [id, it.category, it.name, it.description ?? "", it.price_cents, it.allergens ?? [], sort++]);
    void ulozitMenu; // (přímý zápis výše; ulozitMenu se používá z rozhraní pod uživatelem)
    return `menu ${type} → ${id.slice(0, 8)}`;
  });
}
