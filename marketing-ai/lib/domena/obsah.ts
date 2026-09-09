import { randomUUID } from "node:crypto";

import { okamzik } from "../cas.ts";
import type { Tx } from "../db/driver.ts";
import { FORMATY, formatSpec } from "../formaty.ts";
import { AiZadaniSchema, AiZpetnaVazbaSchema, type AiNavrh, type AiZadani, type AiZpetnaVazba } from "../providers/ai/schema.ts";
import { resolveAi, resolveImageRenderer, resolvePublisher, resolveVideoRenderer } from "../providers/registry.ts";
import type { RenderRequest } from "../providers/types.ts";
import { mediaPath, getStorage } from "../storage/index.ts";
import { podepsatSoubor } from "../storage/podpis.ts";
import { canonicalJson, sha256Hex } from "../utils/hash.ts";
import { upozornit, uzivateleSPravem } from "./notifikace.ts";

/**
 * Obsah, verze, schvalování, render, plánování.
 *
 * Každá funkce dostane transakci, která už běží POD PŘIHLÁŠENÝM
 * uživatelem (withUser) — RLS platí. Tady se nekontroluje role podle
 * jména; kde je potřeba výslovné právo, ptáme se marketing.has_access
 * (assertAccess) a databáze to ještě hlídá politikou a spouští.
 */

export interface VerzeData {
  brief: string;
  inputs: Record<string, unknown>;
  ai_proposal: AiNavrh | null;
  selected_variant_key: string | null;
  texts: Record<string, { caption: string; hashtags: string[]; cta: string; hook?: string }>;
  storyboard: unknown;
  media_asset_ids: string[];
  cover_asset_id: string | null;
}

/** Otisk verze — z obsahu, ne z ID. Stejný obsah = stejný otisk. */
export function checksumVerze(v: VerzeData): string {
  return sha256Hex(canonicalJson({
    brief: v.brief, inputs: v.inputs, selected: v.selected_variant_key, texts: v.texts,
    storyboard: v.storyboard ?? null, media: v.media_asset_ids, cover: v.cover_asset_id,
  }));
}

export async function assertAccess(tx: Tx, org: string, perm: string, venue: string | null) {
  const r = await tx.one<{ ok: boolean }>("select marketing.has_access($1, $2, $3) as ok", [org, perm, venue]);
  if (!r?.ok) throw new Error("Na tuhle akci nemáte oprávnění.");
}

export interface NovyObsah {
  organizationId: string;
  venueId: string;
  userId: string;
  title: string;
  purpose: string;
  pillar?: string;
  templateId?: string | null;
  menuId?: string | null;
  campaignId?: string | null;
  brief: string;
  channels: ("instagram" | "facebook")[];
  formats: string[];
  mediaAssetIds: string[];
  inputs: Record<string, unknown>;
  isEvergreen?: boolean;
}

export async function vytvoritObsah(tx: Tx, n: NovyObsah): Promise<{ itemId: string; versionId: string }> {
  await assertAccess(tx, n.organizationId, "content.create", n.venueId);
  const item = await tx.one<{ id: string }>(
    `insert into marketing.content_items (organization_id, venue_id, campaign_id, template_id, menu_id, title, purpose, pillar, status, channels, is_evergreen, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11) returning id`,
    [n.organizationId, n.venueId, n.campaignId ?? null, n.templateId ?? null, n.menuId ?? null, n.title, n.purpose, n.pillar ?? "menu", n.channels, n.isEvergreen ?? false, n.userId],
  );
  const data: VerzeData = {
    brief: n.brief, inputs: { ...n.inputs, formats: n.formats }, ai_proposal: null, selected_variant_key: null, texts: {},
    storyboard: null, media_asset_ids: n.mediaAssetIds, cover_asset_id: n.mediaAssetIds[0] ?? null,
  };
  const versionId = await vlozitVerzi(tx, item!.id, 1, data, n.userId, "Založení");
  await tx.q("select marketing.audit($1, $2, 'content.created', 'content_item', $3, $4)", [n.organizationId, n.venueId, item!.id, JSON.stringify({ purpose: n.purpose })]);
  return { itemId: item!.id, versionId };
}

async function vlozitVerzi(tx: Tx, itemId: string, version: number, d: VerzeData, userId: string, note: string, ai?: { model: string; promptVersion: string; cost: number | null }): Promise<string> {
  const r = await tx.one<{ id: string }>(
    `insert into marketing.content_versions (content_item_id, version, brief, inputs, ai_proposal, selected_variant_key, texts, storyboard, media_asset_ids, cover_asset_id, checksum, change_note, ai_model, ai_prompt_version, ai_cost_estimate_cents, ai_generated_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
    [itemId, version, d.brief, JSON.stringify(d.inputs), d.ai_proposal ? JSON.stringify(d.ai_proposal) : null, d.selected_variant_key,
      JSON.stringify(d.texts), d.storyboard ? JSON.stringify(d.storyboard) : null, d.media_asset_ids, d.cover_asset_id, checksumVerze(d), note,
      ai?.model ?? null, ai?.promptVersion ?? null, ai?.cost ?? null, ai ? new Date().toISOString() : null, userId],
  );
  // Varianty (výstupní formáty) patří k verzi.
  const formats = (d.inputs.formats as string[] | undefined) ?? [];
  for (const f of formats) {
    const spec = formatSpec(f);
    if (!spec) continue;
    await tx.q(
      `insert into marketing.content_variants (content_version_id, channel, format, spec) values ($1, $2, $3, $4) on conflict do nothing`,
      [r!.id, spec.channel, spec.format, JSON.stringify({ formatKey: f, width: spec.width, height: spec.height, aspect: spec.aspect, kind: spec.kind, maxSeconds: spec.maxSeconds ?? null })],
    );
  }
  return r!.id;
}

export interface Verze extends VerzeData {
  id: string;
  content_item_id: string;
  version: number;
  checksum: string;
  created_at: string;
  created_by: string | null;
  change_note: string;
  ai_model: string | null;
}

export async function nacistAktualniVerzi(tx: Tx, itemId: string): Promise<Verze | null> {
  return tx.one<Verze>(
    `select v.* from marketing.content_items i join marketing.content_versions v on v.id = i.current_version_id where i.id = $1`,
    [itemId],
  );
}

/** Uživatelská úprava → nová verze (schválení tím zaniká — spoušť v DB). */
export async function novaVerze(tx: Tx, p: { itemId: string; userId: string; changes: Partial<VerzeData>; note: string }): Promise<string> {
  const cur = await nacistAktualniVerzi(tx, p.itemId);
  if (!cur) throw new Error("Obsah nemá žádnou verzi.");
  const item = await tx.one<{ organization_id: string; venue_id: string; status: string }>("select organization_id, venue_id, status from marketing.content_items where id = $1", [p.itemId]);
  await assertAccess(tx, item!.organization_id, "content.create", item!.venue_id);
  const data: VerzeData = {
    brief: p.changes.brief ?? cur.brief,
    inputs: p.changes.inputs ?? cur.inputs,
    ai_proposal: p.changes.ai_proposal === undefined ? cur.ai_proposal : p.changes.ai_proposal,
    selected_variant_key: p.changes.selected_variant_key === undefined ? cur.selected_variant_key : p.changes.selected_variant_key,
    texts: p.changes.texts ?? cur.texts,
    storyboard: p.changes.storyboard === undefined ? cur.storyboard : p.changes.storyboard,
    media_asset_ids: p.changes.media_asset_ids ?? cur.media_asset_ids,
    cover_asset_id: p.changes.cover_asset_id === undefined ? cur.cover_asset_id : p.changes.cover_asset_id,
  };
  if (checksumVerze(data) === cur.checksum) return cur.id; // beze změny — nová verze nemá smysl
  const id = await vlozitVerzi(tx, p.itemId, cur.version + 1, data, p.userId, p.note);
  // Stav po úpravě: pokud byl obsah schválený/naplánovaný, spoušť ho vrátila na draft.
  await tx.q("update marketing.content_items set status = case when status in ('idea') then 'draft' else status end where id = $1", [p.itemId]);
  return id;
}

/** Duplikace návrhu: nový obsah s kopií aktuální verze. */
export async function duplikovat(tx: Tx, itemId: string, userId: string): Promise<string> {
  const item = await tx.one<{ organization_id: string; venue_id: string; campaign_id: string | null; template_id: string | null; menu_id: string | null; title: string; purpose: string; pillar: string; channels: string[] }>(
    "select organization_id, venue_id, campaign_id, template_id, menu_id, title, purpose, pillar, channels from marketing.content_items where id = $1", [itemId]);
  const cur = await nacistAktualniVerzi(tx, itemId);
  if (!item || !cur) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, "content.create", item.venue_id);
  const novy = await tx.one<{ id: string }>(
    `insert into marketing.content_items (organization_id, venue_id, campaign_id, template_id, menu_id, title, purpose, pillar, status, channels, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10) returning id`,
    [item.organization_id, item.venue_id, item.campaign_id, item.template_id, item.menu_id, `${item.title} (kopie)`, item.purpose, item.pillar, item.channels, userId]);
  await vlozitVerzi(tx, novy!.id, 1, cur, userId, `Kopie z verze ${cur.version}`);
  return novy!.id;
}

/** Obnovení starší verze = nová verze se starým obsahem (historie zůstává). */
export async function obnovitVerzi(tx: Tx, itemId: string, versionId: string, userId: string): Promise<string> {
  const old = await tx.one<Verze>("select * from marketing.content_versions where id = $1 and content_item_id = $2", [versionId, itemId]);
  if (!old) throw new Error("Verze nenalezena.");
  return novaVerze(tx, { itemId, userId, changes: old, note: `Obnovena verze ${old.version}` });
}

// ---------------------------------------------------------------------
// AI ZADÁNÍ — jen to, co model potřebuje. Kontakty, telefony, adresy,
// mzdy: nic z toho sem nepatří.
// ---------------------------------------------------------------------

export async function sestavitZadani(tx: Tx, itemId: string): Promise<AiZadani> {
  const item = await tx.one<{ organization_id: string; venue_id: string; purpose: string; menu_id: string | null; template_id: string | null; channels: string[]; scheduled_at: string | null }>(
    "select organization_id, venue_id, purpose, menu_id, template_id, channels, scheduled_at from marketing.content_items where id = $1", [itemId]);
  const v = await nacistAktualniVerzi(tx, itemId);
  if (!item || !v) throw new Error("Obsah nenalezen.");
  const bk = await tx.one<{ name: string; short_description: string; tone_of_voice: string; preferred_ctas: string[]; allowed_phrases: string[]; forbidden_phrases: string[]; default_hashtags: string[]; signature: string; default_video_seconds: number }>(
    "select name, short_description, tone_of_voice, preferred_ctas, allowed_phrases, forbidden_phrases, default_hashtags, signature, default_video_seconds from marketing.brand_kits where venue_id = $1", [item.venue_id]);
  const venue = await tx.one<{ name: string }>("select name from marketing.venues where id = $1", [item.venue_id]);
  const tpl = item.template_id ? await tx.one<{ key: string }>("select key from marketing.templates where id = $1", [item.template_id]) : null;

  const fakta: AiZadani["fakta"] = { menuNazev: null, platnostOd: null, platnostDo: null, polozky: [], vstupy: strip(v.inputs) };
  if (item.menu_id) {
    const m = await tx.one<{ title: string; valid_from: string | null; valid_to: string | null }>("select title, valid_from::text, valid_to::text from marketing.menus where id = $1", [item.menu_id]);
    const items = await tx.q<{ category: string; name: string; description: string; price_cents: number | null; allergens: string[] }>(
      "select category, name, description, price_cents, allergens from marketing.menu_items where menu_id = $1 order by sort_order", [item.menu_id]);
    fakta.menuNazev = m?.title ?? null;
    fakta.platnostOd = m?.valid_from ?? null;
    fakta.platnostDo = m?.valid_to ?? null;
    fakta.polozky = items.map((i) => ({ kategorie: i.category, nazev: i.name, popis: i.description, cenaKc: i.price_cents === null ? null : i.price_cents / 100, alergeny: i.allergens }));
  }
  const inputs = v.inputs as { items?: { name: string; price_cents?: number | null; category?: string; description?: string; allergens?: string[] }[]; range?: { from?: string; to?: string }; date?: string };
  if (!item.menu_id && Array.isArray(inputs.items)) {
    fakta.polozky = inputs.items.filter((i) => i && i.name).map((i) => ({ kategorie: i.category ?? "hlavni", nazev: i.name, popis: i.description ?? "", cenaKc: i.price_cents == null ? null : i.price_cents / 100, alergeny: i.allergens ?? [] }));
  }
  if (!fakta.platnostOd) fakta.platnostOd = inputs.range?.from ?? inputs.date ?? null;
  if (!fakta.platnostDo) fakta.platnostDo = inputs.range?.to ?? inputs.date ?? null;

  const media = v.media_asset_ids.length
    ? await tx.q<{ id: string; kind: string; title: string; description: string; is_hero: boolean; tags: string[] | null }>(
        `select a.id, a.kind, a.title, a.description, a.is_hero, array_remove(array_agg(t.tag), null) as tags
           from marketing.media_assets a left join marketing.media_tags t on t.asset_id = a.id
          where a.id = any($1::uuid[]) group by a.id`, [v.media_asset_ids])
    : [];

  return AiZadaniSchema.parse({
    brief: v.brief,
    ucel: item.purpose,
    sablonaKey: tpl?.key ?? null,
    kanaly: item.channels,
    formaty: (v.inputs.formats as string[] | undefined) ?? [],
    termin: item.scheduled_at,
    brand: {
      nazev: bk?.name ?? venue?.name ?? "", popis: bk?.short_description ?? "", tonHlasu: bk?.tone_of_voice ?? "", cta: bk?.preferred_ctas ?? [],
      povoleneVyrazy: bk?.allowed_phrases ?? [], zakazaneVyrazy: bk?.forbidden_phrases ?? [], hashtagy: bk?.default_hashtags ?? [],
      podpis: bk?.signature ?? "", delkaVidea: bk?.default_video_seconds ?? 15,
    },
    fakta,
    media: media.map((m) => ({ id: m.id, druh: m.kind, titulek: m.title, popis: m.description, tagy: m.tags ?? [], jeHero: m.is_hero })),
  });
}

/** Ze vstupů odstraní vše, co nemá do modelu chodit. */
function strip(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (["media", "formats", "phone", "address", "email"].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Návrh AI → nová verze s návrhem (texty z doporučené varianty). */
export async function navrhnout(tx: Tx, p: { itemId: string; userId: string }): Promise<{ versionId: string; navrh: AiNavrh; isMock: boolean }> {
  const item = await tx.one<{ organization_id: string; venue_id: string }>("select organization_id, venue_id from marketing.content_items where id = $1", [p.itemId]);
  if (!item) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, "content.create", item.venue_id);
  const ai = await resolveAi(tx, item.organization_id, item.venue_id);
  if (!ai) throw new Error("Není vybraný žádný AI poskytovatel. Nastavte ho v Integracích.");
  await tx.q("update marketing.content_items set status = 'generating' where id = $1", [p.itemId]);
  const zadani = await sestavitZadani(tx, p.itemId);
  let out: Awaited<ReturnType<typeof ai.provider.navrhnout>>;
  try {
    out = await ai.provider.navrhnout(zadani);
  } catch (e) {
    await tx.q("update marketing.content_items set status = 'generation_failed' where id = $1", [p.itemId]);
    throw new Error(`Návrh se nepodařilo vytvořit: ${e instanceof Error ? e.message : "chyba"}`);
  }
  const versionId = await ulozitNavrh(tx, p.itemId, p.userId, out.navrh, { model: out.model, promptVersion: out.promptVersion, cost: out.costEstimateCents }, ai.providerKey, ai.connectionId, item);
  return { versionId, navrh: out.navrh, isMock: ai.provider.isMock };
}

export async function prepracovat(tx: Tx, p: { itemId: string; userId: string; zpetnaVazba: AiZpetnaVazba }): Promise<{ versionId: string; navrh: AiNavrh }> {
  const item = await tx.one<{ organization_id: string; venue_id: string }>("select organization_id, venue_id from marketing.content_items where id = $1", [p.itemId]);
  const cur = await nacistAktualniVerzi(tx, p.itemId);
  if (!item || !cur?.ai_proposal) throw new Error("Není co přepracovat — nejdřív vytvořte návrh.");
  await assertAccess(tx, item.organization_id, "content.create", item.venue_id);
  const ai = await resolveAi(tx, item.organization_id, item.venue_id);
  if (!ai) throw new Error("Není vybraný žádný AI poskytovatel.");
  const zv = AiZpetnaVazbaSchema.parse(p.zpetnaVazba);
  const zadani = await sestavitZadani(tx, p.itemId);
  const out = await ai.provider.prepracovat(zadani, cur.ai_proposal, zv);
  const versionId = await ulozitNavrh(tx, p.itemId, p.userId, out.navrh, { model: out.model, promptVersion: out.promptVersion, cost: out.costEstimateCents }, ai.providerKey, ai.connectionId, item, `Přepracováno: ${zv.typ} (${zv.cast})`, zv.variantaKlic ?? cur.selected_variant_key);
  return { versionId, navrh: out.navrh };
}

async function ulozitNavrh(tx: Tx, itemId: string, userId: string, navrh: AiNavrh, ai: { model: string; promptVersion: string; cost: number | null }, providerKey: string, connectionId: string | null, item: { organization_id: string; venue_id: string }, note = "Návrh AI", variantaKlic?: string | null): Promise<string> {
  const cur = await nacistAktualniVerzi(tx, itemId);
  const klic = variantaKlic && navrh.varianty.some((v) => v.klic === variantaKlic) ? variantaKlic : navrh.doporucenaVarianta;
  const varianta = navrh.varianty.find((v) => v.klic === klic) ?? navrh.varianty[0];
  const data: VerzeData = {
    brief: cur?.brief ?? "",
    inputs: cur?.inputs ?? {},
    ai_proposal: navrh,
    selected_variant_key: varianta.klic,
    texts: textyZVarianty(varianta),
    storyboard: varianta.storyboard,
    media_asset_ids: varianta.vybranaMediaIds.length ? varianta.vybranaMediaIds : (cur?.media_asset_ids ?? []),
    cover_asset_id: varianta.titulniFotoAssetId ?? cur?.cover_asset_id ?? null,
  };
  const id = await vlozitVerzi(tx, itemId, (cur?.version ?? 0) + 1, data, userId, note, ai);
  await tx.q("update marketing.content_items set status = 'preview_ready' where id = $1", [itemId]);
  await tx.q(
    `insert into marketing.provider_usage_records (organization_id, venue_id, provider_key, connection_id, capability, estimated_cost_cents, ref_type, ref_id)
     values ($1, $2, $3, $4, 'text.variants', $5, 'content_version', $6)`,
    [item.organization_id, item.venue_id, providerKey, connectionId, ai.cost, id]);
  return id;
}

export function textyZVarianty(v: AiNavrh["varianty"][number]): VerzeData["texts"] {
  return {
    instagram: { caption: v.instagram.popisek, hashtags: v.instagram.hashtagy, cta: v.instagram.cta, hook: v.instagram.hook },
    facebook: { caption: v.facebook.popisek, hashtags: v.facebook.hashtagy, cta: v.facebook.cta, hook: v.facebook.hook },
  };
}

/** Přepnutí na jinou variantu = nová verze s jejími texty. */
export async function vybratVariantu(tx: Tx, itemId: string, userId: string, klic: string): Promise<string> {
  const cur = await nacistAktualniVerzi(tx, itemId);
  const v = cur?.ai_proposal?.varianty.find((x) => x.klic === klic);
  if (!cur || !v) throw new Error("Varianta nenalezena.");
  return novaVerze(tx, {
    itemId, userId, note: `Vybrána varianta „${v.nazev}“`,
    changes: { selected_variant_key: klic, texts: textyZVarianty(v), storyboard: v.storyboard, media_asset_ids: v.vybranaMediaIds.length ? v.vybranaMediaIds : cur.media_asset_ids, cover_asset_id: v.titulniFotoAssetId ?? cur.cover_asset_id },
  });
}

// ---------------------------------------------------------------------
// SCHVALOVÁNÍ
// ---------------------------------------------------------------------

export async function pozadatOSchvaleni(tx: Tx, p: { itemId: string; userId: string; summary?: string }): Promise<string> {
  const item = await tx.one<{ organization_id: string; venue_id: string; title: string; current_version_id: string | null }>("select organization_id, venue_id, title, current_version_id from marketing.content_items where id = $1", [p.itemId]);
  const cur = await nacistAktualniVerzi(tx, p.itemId);
  if (!item || !cur) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, "content.create", item.venue_id);
  const kontrola = kontrolaPredSchvalenim(cur);
  if (kontrola.length) throw new Error(`Před žádostí o schválení doplňte: ${kontrola.join(", ")}`);
  await tx.q("update marketing.approval_requests set status = 'superseded', resolved_at = now() where content_item_id = $1 and status = 'pending'", [p.itemId]);
  const r = await tx.one<{ id: string }>(
    `insert into marketing.approval_requests (organization_id, venue_id, content_item_id, content_version_id, version_checksum, summary, requested_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [item.organization_id, item.venue_id, p.itemId, cur.id, cur.checksum, p.summary ?? "", p.userId]);
  await tx.q("update marketing.content_items set status = 'awaiting_approval' where id = $1", [p.itemId]);
  const venue = await tx.one<{ slug: string }>("select slug from marketing.venues where id = $1", [item.venue_id]);
  await upozornit(tx, {
    organizationId: item.organization_id, exceptUserId: p.userId,
    userIds: await uzivateleSPravem(tx, item.organization_id, "content.approve", item.venue_id),
    kind: "approval_requested", title: `Ke schválení: ${item.title || "návrh"}`, body: p.summary ?? "", link: `/${venue?.slug}/schvalovani`,
  });
  return r!.id;
}

export function kontrolaPredSchvalenim(v: VerzeData): string[] {
  const chybi: string[] = [];
  const ig = v.texts.instagram;
  const fb = v.texts.facebook;
  if (!ig?.caption && !fb?.caption) chybi.push("text příspěvku");
  if (v.media_asset_ids.length === 0) chybi.push("alespoň jedno médium");
  return chybi;
}

export async function rozhodnout(tx: Tx, p: { requestId: string; userId: string; decision: "approved" | "rejected" | "changes_requested"; comment: string }): Promise<void> {
  const r = await tx.one<{ organization_id: string; venue_id: string; content_item_id: string; content_version_id: string; version_checksum: string; requested_by: string | null; status: string }>(
    "select organization_id, venue_id, content_item_id, content_version_id, version_checksum, requested_by, status from marketing.approval_requests where id = $1", [p.requestId]);
  if (!r) throw new Error("Žádost nenalezena.");
  await assertAccess(tx, r.organization_id, "content.approve", r.venue_id);
  if (r.requested_by === p.userId && p.decision === "approved") {
    // Čtyři oči: kdo žádá, neschvaluje sám sobě — leda by byl jediný schvalovatel.
    const jini = (await uzivateleSPravem(tx, r.organization_id, "content.approve", r.venue_id)).filter((u) => u !== p.userId);
    if (jini.length > 0) throw new Error("Vlastní žádost nemůžete schválit — má to udělat jiný schvalovatel.");
  }
  // Otisk se posílá znovu: databáze ověří, že obsah je pořád tentýž.
  const cur = await tx.one<{ checksum: string }>("select checksum from marketing.content_versions where id = $1", [r.content_version_id]);
  await tx.q(
    `insert into marketing.approval_decisions (organization_id, approval_request_id, decided_by, decision, comment, version_checksum) values ($1, $2, $3, $4, $5, $6)`,
    [r.organization_id, p.requestId, p.userId, p.decision, p.comment, cur!.checksum]);
  if (p.comment) {
    await tx.q("insert into marketing.comments (organization_id, content_item_id, content_version_id, author_id, part, body) values ($1, $2, $3, $4, 'schvaleni', $5)",
      [r.organization_id, r.content_item_id, r.content_version_id, p.userId, p.comment]);
  }
  const item = await tx.one<{ title: string }>("select title from marketing.content_items where id = $1", [r.content_item_id]);
  const venue = await tx.one<{ slug: string }>("select slug from marketing.venues where id = $1", [r.venue_id]);
  const popis = { approved: "Schváleno", rejected: "Zamítnuto", changes_requested: "Vráceno k úpravě" }[p.decision];
  await upozornit(tx, {
    organizationId: r.organization_id, userIds: r.requested_by ? [r.requested_by] : [], exceptUserId: p.userId,
    kind: `approval_${p.decision}`, title: `${popis}: ${item?.title || "návrh"}`, body: p.comment, link: `/${venue?.slug}/obsah/${r.content_item_id}`,
  });
}

// ---------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------

export async function spustitRender(tx: Tx, p: { versionId: string; variantId: string; userId: string; force?: boolean }): Promise<{ jobId: string; status: string; error?: string }> {
  const v = await tx.one<Verze & { organization_id: string; venue_id: string; template_id: string | null; purpose: string }>(
    `select cv.*, i.organization_id, i.venue_id, i.template_id, i.purpose from marketing.content_versions cv join marketing.content_items i on i.id = cv.content_item_id where cv.id = $1`, [p.versionId]);
  const variant = await tx.one<{ id: string; channel: string; format: string; spec: { formatKey: string; width: number; height: number; kind: "image" | "video" | "pdf"; maxSeconds: number | null }; output_asset_id: string | null }>(
    "select id, channel, format, spec, output_asset_id from marketing.content_variants where id = $1 and content_version_id = $2", [p.variantId, p.versionId]);
  if (!v || !variant) throw new Error("Varianta nenalezena.");
  await assertAccess(tx, v.organization_id, "content.create", v.venue_id);
  if (variant.output_asset_id && !p.force) return { jobId: "", status: "done" };

  const kind = variant.spec.kind;
  const resolved = kind === "video" ? await resolveVideoRenderer(tx, v.organization_id, v.venue_id) : await resolveImageRenderer(tx, v.organization_id, v.venue_id);
  if (!resolved) throw new Error(kind === "video" ? "Není vybraný video poskytovatel." : "Není vybraný poskytovatel pro obrázky.");
  const attempt = (await tx.one<{ n: number }>("select count(*)::int as n from marketing.render_jobs where variant_id = $1", [p.variantId]))?.n ?? 0;
  const idem = `render:${p.versionId}:${p.variantId}:${attempt + 1}`;
  const req = await sestavitRenderRequest(tx, v, variant, idem);
  const cost = resolved.provider.estimateCostCents?.(req) ?? null;
  const job = await tx.one<{ id: string }>(
    `insert into marketing.render_jobs (organization_id, venue_id, content_version_id, variant_id, provider_key, connection_id, mode, status, idempotency_key, request, cost_estimate_cents, created_by, attempts)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10, $11, 1) returning id`,
    [v.organization_id, v.venue_id, p.versionId, p.variantId, resolved.providerKey, resolved.connectionId, resolved.mode, idem, JSON.stringify({ formatKey: req.formatKey, width: req.width, height: req.height, kind }), cost, p.userId]);
  req.jobId = job!.id;
  await tx.q("update marketing.content_variants set render_job_id = $1 where id = $2", [job!.id, p.variantId]);

  let result;
  try {
    result = await resolved.provider.render(req);
  } catch (e) {
    result = { status: "failed" as const, error: e instanceof Error ? e.message : "Render selhal" };
  }
  await tx.q(
    `insert into marketing.provider_usage_records (organization_id, venue_id, provider_key, connection_id, capability, estimated_cost_cents, ref_type, ref_id) values ($1, $2, $3, $4, $5, $6, 'render_job', $7)`,
    [v.organization_id, v.venue_id, resolved.providerKey, resolved.connectionId, kind === "video" ? "render.video" : "render.image", cost, job!.id]);

  if (result.status === "done" && result.output) {
    const assetId = await ulozitRenderVystup(tx, { organizationId: v.organization_id, venueId: v.venue_id, userId: p.userId, output: result.output, derivedFrom: v.cover_asset_id, jobId: job!.id, formatKey: variant.spec.formatKey, mock: resolved.provider.isMock });
    await tx.q("update marketing.render_jobs set status = 'done', response = $2, output_asset_id = $3, finished_at = now() where id = $1", [job!.id, JSON.stringify(result.response ?? { mock: resolved.provider.isMock }), assetId]);
    await tx.q("update marketing.content_variants set output_asset_id = $1 where id = $2", [assetId, p.variantId]);
    return { jobId: job!.id, status: "done" };
  }
  if (result.status === "submitted") {
    await tx.q("update marketing.render_jobs set status = 'submitted', external_id = $2, response = $3, next_attempt_at = now() + interval '20 seconds' where id = $1", [job!.id, result.externalId ?? null, JSON.stringify(result.response ?? {})]);
    return { jobId: job!.id, status: "submitted" };
  }
  await tx.q("update marketing.render_jobs set status = 'failed', error = $2, finished_at = now() where id = $1", [job!.id, result.error ?? "Render selhal"]);
  await tx.q("update marketing.content_items set status = 'render_failed' where id = $1 and status in ('draft','preview_ready','generating')", [v.content_item_id]);
  return { jobId: job!.id, status: "failed", error: result.error };
}

async function sestavitRenderRequest(tx: Tx, v: Verze & { organization_id: string; venue_id: string; template_id: string | null; purpose: string }, variant: { spec: { formatKey: string; width: number; height: number; kind: "image" | "video" | "pdf"; maxSeconds: number | null }; channel: string }, jobId: string): Promise<RenderRequest> {
  const bk = await tx.one<Record<string, unknown>>("select name, colors, fonts, signature, logo_placement, address, phone, website_url, default_video_seconds from marketing.brand_kits where venue_id = $1", [v.venue_id]);
  const tpl = v.template_id
    ? await tx.one<{ key: string; layout: unknown; text_rules: unknown; storyboard: unknown }>(
        "select t.key, tv.layout, tv.text_rules, tv.storyboard from marketing.templates t join marketing.template_versions tv on tv.template_id = t.id where t.id = $1 order by tv.version desc limit 1", [v.template_id])
    : null;
  const media = v.media_asset_ids.length
    ? await tx.q<{ id: string; kind: string; mime_type: string }>("select id, kind, mime_type from marketing.media_assets where id = any($1::uuid[]) and archived_at is null", [v.media_asset_ids])
    : [];
  const ordered = v.media_asset_ids.map((id) => media.find((m) => m.id === id)).filter(Boolean) as typeof media;
  if (v.cover_asset_id) {
    const idx = ordered.findIndex((m) => m.id === v.cover_asset_id);
    if (idx > 0) ordered.unshift(...ordered.splice(idx, 1));
  }
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const texts = v.texts[variant.channel === "facebook" ? "facebook" : "instagram"] ?? v.texts.instagram ?? v.texts.facebook;
  const inputs = v.inputs as Record<string, unknown> & { title?: string; date?: string; range?: { from?: string; to?: string } };
  const headline = inputs.title ?? texts?.hook ?? "";
  const badge = inputs.date ? formatDatumKratce(inputs.date) : inputs.range?.from ? `${formatDatumKratce(inputs.range.from)}${inputs.range.to && inputs.range.to !== inputs.range.from ? " – " + formatDatumKratce(inputs.range.to) : ""}` : "";
  return {
    jobId,
    formatKey: variant.spec.formatKey, width: variant.spec.width, height: variant.spec.height, kind: variant.spec.kind,
    template: { key: tpl?.key ?? v.purpose, layout: tpl?.layout ?? { style: "hero-photo" }, textRules: tpl?.text_rules ?? {}, storyboard: tpl?.storyboard },
    inputs: { ...inputs, badge },
    brand: bk ?? {},
    texts: { headline, body: variant.spec.kind === "pdf" ? "" : (texts?.hook && texts.hook !== headline ? texts.hook : ""), cta: texts?.cta ?? "", overlay: [headline, badge] },
    media: ordered.map((m) => ({ assetId: m.id, url: `${base}${podepsatSoubor(m.id, 6 * 3600)}`, kind: m.kind, mime: m.mime_type })),
    storyboard: v.storyboard,
    durationSeconds: Math.min(variant.spec.maxSeconds ?? 90, (bk?.default_video_seconds as number | undefined) ?? 15),
    callbackUrl: `${base}/api/v1/webhooky/shotstack`,
  };
}

function formatDatumKratce(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d}. ${m}. ${y}` : iso;
}

export async function ulozitRenderVystup(tx: Tx, p: { organizationId: string; venueId: string; userId: string | null; output: { bytes: Uint8Array; mime: string; filename: string; width?: number; height?: number; durationSeconds?: number }; derivedFrom: string | null; jobId: string; formatKey: string; mock: boolean }): Promise<string> {
  const storage = await getStorage();
  const id = randomUUID();
  const path = mediaPath({ organizationId: p.organizationId, venueId: p.venueId, assetId: id, filename: p.output.filename });
  await storage.put(path, p.output.bytes, p.output.mime);
  const col = await tx.one<{ id: string }>("select id from marketing.media_collections where organization_id = $1 and venue_id = $2 and key = 'hotove'", [p.organizationId, p.venueId]);
  const kind = p.output.mime.startsWith("image/") ? "render" : p.output.mime.startsWith("video/") ? "video" : "document";
  await tx.q(
    `insert into marketing.media_assets (id, organization_id, venue_id, collection_id, kind, original_filename, storage_path, storage_provider, mime_type, size_bytes, width, height, duration_seconds, sha256, title, description, derived_from_asset_id, derivation, ai_generated, ai_edited, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, false, true, $19)`,
    [id, p.organizationId, p.venueId, col?.id ?? null, kind, p.output.filename, path, storage.key, p.output.mime, p.output.bytes.length, p.output.width ?? null, p.output.height ?? null, p.output.durationSeconds ?? null,
      sha256Hex(p.output.bytes) + ":" + id.slice(0, 8), `Render ${FORMATY[p.formatKey as keyof typeof FORMATY]?.label ?? p.formatKey}${p.mock ? " (demo)" : ""}`,
      p.mock ? "Výstup demo rendereru — skutečné video nevzniklo." : "Automaticky vykreslený výstup.", p.derivedFrom, JSON.stringify({ renderJobId: p.jobId, formatKey: p.formatKey, mock: p.mock }), p.userId]);
  return id;
}

// ---------------------------------------------------------------------
// PLÁNOVÁNÍ A PUBLIKACE
// ---------------------------------------------------------------------

export interface PlanParams {
  itemId: string;
  userId: string;
  /** 'YYYY-MM-DD' + 'HH:MM' v pásmu provozovny; null = teď */
  datum: string | null;
  cas: string | null;
  tz: string;
  /** Které varianty publikovat (ID content_variants); prázdné = všechny zapnuté s výstupem */
  variantIds?: string[];
}

export async function naplanovat(tx: Tx, p: PlanParams): Promise<{ jobIds: string[]; scheduledAt: Date; warnings: string[] }> {
  const item = await tx.one<{ organization_id: string; venue_id: string; status: string; approved_version_id: string | null; current_version_id: string | null; title: string }>(
    "select organization_id, venue_id, status, approved_version_id, current_version_id, title from marketing.content_items where id = $1", [p.itemId]);
  if (!item) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, p.datum ? "content.schedule" : "content.publish", item.venue_id);
  if (!item.approved_version_id || item.approved_version_id !== item.current_version_id) throw new Error("Naplánovat lze jen schválenou aktuální verzi.");
  const req = await tx.one<{ id: string; version_checksum: string }>("select id, version_checksum from marketing.approval_requests where content_item_id = $1 and content_version_id = $2 and status = 'approved' order by resolved_at desc limit 1", [p.itemId, item.approved_version_id]);
  if (!req) throw new Error("Chybí platné schválení.");
  const scheduledAt = p.datum && p.cas ? okamzik(p.datum, p.cas, p.tz) : new Date();
  const warnings: string[] = [];

  const pub = await resolvePublisher(tx, item.organization_id, item.venue_id);
  if (!pub) throw new Error("Není vybraný publikační nástroj. Nastavte ho v Integracích.");
  const accounts = await tx.q<{ id: string; platform: string; external_id: string; kind: string; name: string; capabilities: string[] }>(
    "select id, platform, external_id, kind, name, capabilities from marketing.social_accounts where venue_id = $1 and is_active and connection_id = $2", [item.venue_id, pub.connectionId]);
  const variants = await tx.q<{ id: string; channel: string; format: string; output_asset_id: string | null; spec: { formatKey: string; kind: string } }>(
    "select id, channel, format, output_asset_id, spec from marketing.content_variants where content_version_id = $1 and is_enabled and channel in ('instagram','facebook') order by channel, format", [item.approved_version_id]);
  const chosen = p.variantIds?.length ? variants.filter((v) => p.variantIds!.includes(v.id)) : variants;
  const jobIds: string[] = [];
  for (const v of chosen) {
    const spec = formatSpec(v.spec.formatKey);
    const cap = spec?.publishCapability;
    const account = accounts.find((a) => a.platform === v.channel) ?? null;
    if (cap && !pub.provider.capabilities.includes(cap)) {
      warnings.push(`${spec?.label ?? v.format}: vybraný nástroj tenhle formát neumí — bude k ručnímu zveřejnění.`);
    }
    if (!v.output_asset_id && v.spec.kind !== "pdf") {
      warnings.push(`${spec?.label ?? v.format}: chybí vykreslený výstup, publikace použije zdrojové médium.`);
    }
    const idem = `publish:${item.approved_version_id}:${v.channel}:${v.format}:${account?.id ?? "none"}`;
    const existing = await tx.one<{ id: string }>("select id from marketing.publish_jobs where idempotency_key = $1 and status in ('scheduled','queued','publishing','published','published_mock')", [idem]);
    if (existing) { jobIds.push(existing.id); continue; }
    const j = await tx.one<{ id: string }>(
      `insert into marketing.publish_jobs (organization_id, venue_id, content_item_id, content_version_id, version_checksum, approval_request_id, variant_id, social_account_id, channel, format, provider_key, connection_id, mode, status, scheduled_for, idempotency_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'scheduled', $14, $15, $16) returning id`,
      [item.organization_id, item.venue_id, p.itemId, item.approved_version_id, req.version_checksum, req.id, v.id, account?.id ?? null, v.channel, v.format, pub.providerKey, pub.connectionId, pub.mode, scheduledAt.toISOString(), idem, p.userId]);
    jobIds.push(j!.id);
  }
  if (jobIds.length === 0) throw new Error("Není co publikovat — zapněte aspoň jeden formát pro Instagram nebo Facebook.");
  await tx.q("update marketing.content_items set scheduled_at = $2, status = 'scheduled' where id = $1", [p.itemId, scheduledAt.toISOString()]);
  return { jobIds, scheduledAt, warnings };
}

/** Přesun termínu (drag-and-drop v kalendáři) — jen u naplánovaného nebo konceptu. */
export async function presunoutTermin(tx: Tx, p: { itemId: string; userId: string; datum: string; cas: string; tz: string }): Promise<void> {
  const item = await tx.one<{ organization_id: string; venue_id: string; status: string }>("select organization_id, venue_id, status from marketing.content_items where id = $1", [p.itemId]);
  if (!item) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, "content.schedule", item.venue_id);
  if (["publishing", "published", "archived"].includes(item.status)) throw new Error("Zveřejněný obsah už nejde přesunout.");
  const at = okamzik(p.datum, p.cas, p.tz);
  await tx.q("update marketing.content_items set scheduled_at = $2 where id = $1", [p.itemId, at.toISOString()]);
  await tx.q("update marketing.publish_jobs set scheduled_for = $2 where content_item_id = $1 and status in ('scheduled','queued')", [p.itemId, at.toISOString()]);
  await tx.q("select marketing.audit($1, $2, 'content.rescheduled', 'content_item', $3, $4)", [item.organization_id, item.venue_id, p.itemId, JSON.stringify({ scheduled_at: at.toISOString() })]);
}

export async function zrusitPlan(tx: Tx, itemId: string): Promise<void> {
  const item = await tx.one<{ organization_id: string; venue_id: string }>("select organization_id, venue_id from marketing.content_items where id = $1", [itemId]);
  if (!item) throw new Error("Obsah nenalezen.");
  await assertAccess(tx, item.organization_id, "content.schedule", item.venue_id);
  await tx.q("update marketing.publish_jobs set status = 'cancelled' where content_item_id = $1 and status in ('scheduled','queued','failed')", [itemId]);
  await tx.q("update marketing.content_items set status = 'approved', scheduled_at = null where id = $1 and status = 'scheduled'", [itemId]);
}
