import type { Tx } from "../db/driver.ts";
import { resolveAi } from "../providers/registry.ts";
import type { MenuRozpoznani } from "../providers/types.ts";
import { rozpoznatMenuZTextu } from "./menu-text.ts";
import { assertAccess } from "./obsah.ts";

/**
 * Menu: ruční formulář, text, fotografie/PDF. Rozpoznaná data se ukládají
 * jako koncept (`draft`) s `raw_import`; potvrzení (`confirmed`) dělá
 * člověk, až data zkontroluje. Položky s `needs_review` blokují potvrzení.
 */
export interface MenuVstup {
  organizationId: string;
  venueId: string;
  userId: string;
  kind: string;
  title: string;
  validFrom: string | null;
  validTo: string | null;
  source: "manual" | "text" | "image" | "pdf" | "foodtab";
  sourceAssetId?: string | null;
  rawImport?: unknown;
  days: { label: string; day_date: string | null; items: PolozkaVstup[] }[];
  items: PolozkaVstup[];
}

export interface PolozkaVstup {
  category: string;
  name: string;
  description?: string;
  price_cents: number | null;
  allergens?: string[];
  note?: string;
  availability?: "available" | "limited" | "sold_out";
  needs_review?: boolean;
  review_reason?: string | null;
}

export async function ulozitMenu(tx: Tx, m: MenuVstup, existingId?: string): Promise<string> {
  await assertAccess(tx, m.organizationId, "menu.manage", m.venueId);
  let id = existingId;
  if (id) {
    const cur = await tx.one<{ status: string }>("select status from marketing.menus where id = $1 and venue_id = $2", [id, m.venueId]);
    if (!cur) throw new Error("Menu nenalezeno.");
    await tx.q("update marketing.menus set kind = $2, title = $3, valid_from = $4, valid_to = $5, status = 'draft' where id = $1", [id, m.kind, m.title, m.validFrom, m.validTo]);
    await tx.q("delete from marketing.menu_items where menu_id = $1", [id]);
    await tx.q("delete from marketing.menu_days where menu_id = $1", [id]);
  } else {
    const r = await tx.one<{ id: string }>(
      `insert into marketing.menus (organization_id, venue_id, kind, title, valid_from, valid_to, source, source_asset_id, raw_import, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10) returning id`,
      [m.organizationId, m.venueId, m.kind, m.title, m.validFrom, m.validTo, m.source, m.sourceAssetId ?? null, m.rawImport ? JSON.stringify(m.rawImport) : null, m.userId]);
    id = r!.id;
  }
  let sort = 0;
  for (const [di, d] of m.days.entries()) {
    const day = await tx.one<{ id: string }>("insert into marketing.menu_days (menu_id, day_date, label, sort_order) values ($1, $2, $3, $4) returning id", [id, d.day_date, d.label, di]);
    for (const it of d.items) await vlozitPolozku(tx, id!, day!.id, it, sort++);
  }
  for (const it of m.items) await vlozitPolozku(tx, id!, null, it, sort++);
  return id!;
}

async function vlozitPolozku(tx: Tx, menuId: string, dayId: string | null, it: PolozkaVstup, sort: number) {
  if (!it.name?.trim()) return;
  await tx.q(
    `insert into marketing.menu_items (menu_id, menu_day_id, category, name, description, price_cents, allergens, note, availability, needs_review, review_reason, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [menuId, dayId, it.category || "hlavni", it.name.trim(), it.description ?? "", it.price_cents ?? null, it.allergens ?? [], it.note ?? "", it.availability ?? "available", it.needs_review ?? false, it.review_reason ?? null, sort]);
}

export async function potvrditMenu(tx: Tx, menuId: string, userId: string): Promise<{ ok: boolean; problemy: string[] }> {
  const m = await tx.one<{ organization_id: string; venue_id: string; valid_from: string | null; kind: string }>("select organization_id, venue_id, valid_from::text, kind from marketing.menus where id = $1", [menuId]);
  if (!m) throw new Error("Menu nenalezeno.");
  await assertAccess(tx, m.organization_id, "menu.manage", m.venue_id);
  const problemy: string[] = [];
  const items = await tx.q<{ name: string; price_cents: number | null; needs_review: boolean; review_reason: string | null }>("select name, price_cents, needs_review, review_reason from marketing.menu_items where menu_id = $1", [menuId]);
  if (items.length === 0) problemy.push("Menu nemá žádnou položku.");
  for (const i of items) {
    if (i.needs_review) problemy.push(`„${i.name}“ vyžaduje kontrolu${i.review_reason ? ` (${i.review_reason})` : ""}.`);
    if (i.price_cents === null) problemy.push(`„${i.name}“ nemá cenu.`);
  }
  if (!m.valid_from) problemy.push("Chybí datum platnosti.");
  if (problemy.length) return { ok: false, problemy };
  await tx.q("update marketing.menus set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1", [menuId, userId]);
  await tx.q("select marketing.audit($1, $2, 'menu.confirmed', 'menu', $3)", [m.organization_id, m.venue_id, menuId]);
  return { ok: true, problemy: [] };
}

/** Import: text → deterministicky; obrázek/PDF → AI se schopností menu.ocr, jinak srozumitelná chyba. */
export async function rozpoznatMenu(tx: Tx, p: { organizationId: string; venueId: string; text?: string; bytes?: Uint8Array; mime?: string }): Promise<MenuRozpoznani> {
  if (p.text) return rozpoznatMenuZTextu(p.text);
  if (!p.bytes || !p.mime) throw new Error("Chybí podklad.");
  const ai = await resolveAi(tx, p.organizationId, p.venueId);
  if (!ai?.provider.rozpoznatMenu || !ai.provider.capabilities.includes("menu.ocr")) {
    return { kind: "daily", title: "", valid_from: null, valid_to: null, days: [], items: [], warnings: ["Vybraný AI nástroj neumí rozpoznat menu z fotografie/PDF. Připojte Claude v Integracích, nebo vložte menu jako text."] };
  }
  const out = await ai.provider.rozpoznatMenu({ bytes: p.bytes, mime: p.mime });
  if (ai.provider.isMock && p.mime !== "text/plain") out.warnings.push("Rozpoznání provedl demo návrhář — z obrázku nic nepřečte.");
  return out;
}

export function rozpoznaniNaVstup(r: MenuRozpoznani, base: Omit<MenuVstup, "kind" | "title" | "validFrom" | "validTo" | "days" | "items">): MenuVstup {
  return {
    ...base,
    kind: r.kind || "daily", title: r.title || "", validFrom: r.valid_from, validTo: r.valid_to,
    days: r.days.map((d) => ({ label: d.label, day_date: d.day_date, items: d.items })),
    items: r.items,
    rawImport: r,
  };
}

/** Z jednoho menu jedním kliknutím: souhrn, carousel, Story po dnech, Reel, ranní připomínka, víkendová pozvánka, PDF. */
export const ODVOZENE_Z_MENU: { key: string; label: string; formats: string[]; purpose: string; perDay?: boolean; popis: string }[] = [
  { key: "souhrn", label: "Souhrnný příspěvek", formats: ["instagram_feed", "facebook_post"], purpose: "denni_menu", popis: "Jeden obrázek s celým menu na Instagram a Facebook." },
  { key: "carousel", label: "Carousel po dnech", formats: ["instagram_carousel"], purpose: "tydenni_menu", popis: "Každý den jako jeden slide." },
  { key: "story", label: "Story pro každý den", formats: ["instagram_story"], purpose: "denni_menu", perDay: true, popis: "Samostatná Story pro každý den menu." },
  { key: "reel", label: "Reel s postupným zobrazením jídel", formats: ["instagram_reel", "facebook_reel", "video_cover"], purpose: "denni_menu", popis: "Krátké video: jídlo po jídle." },
  { key: "pripominka", label: "Ranní připomínka", formats: ["instagram_story"], purpose: "denni_menu", popis: "Story ráno v den platnosti." },
  { key: "vikend", label: "Víkendová pozvánka", formats: ["instagram_feed", "facebook_post"], purpose: "vikendove_menu", popis: "Čtvrteční/páteční pozvánka na víkend." },
  { key: "pdf", label: "Tiskové PDF", formats: ["pdf_a4"], purpose: "denni_menu", popis: "A4 k vytištění nebo na web." },
];
