import { randomUUID } from "node:crypto";

import type { Tx } from "../db/driver.ts";
import { UPLOAD_LIMITY } from "../formaty.ts";
import { getStorage, mediaPath, sanitizeFilename } from "../storage/index.ts";
import { sha256Hex } from "../utils/hash.ts";
import { assertAccess } from "./obsah.ts";

/**
 * Mediální knihovna: nahrání, kontrola, duplicity, archivace.
 * Originál se nikdy nepřepisuje — odvozené varianty mají derived_from_asset_id.
 */
export interface Nahrani {
  organizationId: string;
  /** null = sdílené pro všechny provozovny (vyžaduje media.share) */
  venueId: string | null;
  userId: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  collectionKey?: string | null;
  title?: string;
  description?: string;
  author?: string;
  license?: string;
  consentNote?: string;
  usableUntil?: string | null;
  tags?: string[];
}

export function druhPodleMime(mime: string): "image" | "video" | "audio" | "document" | null {
  const L = UPLOAD_LIMITY.allowedMime;
  if ((L.image as readonly string[]).includes(mime)) return "image";
  if ((L.video as readonly string[]).includes(mime)) return "video";
  if ((L.audio as readonly string[]).includes(mime)) return "audio";
  if ((L.document as readonly string[]).includes(mime)) return "document";
  return null;
}

export function zkontrolovatSoubor(mime: string, size: number): string | null {
  const kind = druhPodleMime(mime);
  if (!kind) return `Nepodporovaný typ souboru (${mime}). Povolené: JPG, PNG, WebP, HEIC, SVG, MP4, MOV, WebM, MP3, WAV, PDF.`;
  const maxMb = { image: UPLOAD_LIMITY.imageMaxMb, video: UPLOAD_LIMITY.videoMaxMb, audio: UPLOAD_LIMITY.audioMaxMb, document: UPLOAD_LIMITY.documentMaxMb }[kind];
  if (size > maxMb * 1024 * 1024) return `Soubor je příliš velký (limit ${maxMb} MB).`;
  if (size === 0) return "Soubor je prázdný.";
  return null;
}

/** Rozměry z hlavičky — PNG, JPEG, WebP (VP8X), SVG. Bez knihoven. */
export function rozmery(mime: string, b: Uint8Array): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        const len = (b[i + 2] << 8) | b[i + 3];
        i += 2 + len;
      }
    }
    if (mime === "image/svg+xml") {
      const s = new TextDecoder().decode(b.slice(0, 2000));
      const w = /width="(\d+)/.exec(s);
      const h = /height="(\d+)/.exec(s);
      const vb = /viewBox="[\d.\s-]*?(\d+)\s+(\d+)"/.exec(s);
      if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
    }
  } catch {
    // rozměry jsou jen metadata
  }
  return null;
}

export function orientace(w: number | null, h: number | null): "landscape" | "portrait" | "square" | null {
  if (!w || !h) return null;
  if (Math.abs(w - h) < Math.min(w, h) * 0.05) return "square";
  return w > h ? "landscape" : "portrait";
}

export async function nahratMedium(tx: Tx, n: Nahrani): Promise<{ id: string; duplicate?: string }> {
  const chyba = zkontrolovatSoubor(n.mime, n.bytes.length);
  if (chyba) throw new Error(chyba);
  await assertAccess(tx, n.organizationId, n.venueId ? "media.manage" : "media.share", n.venueId);
  const kind = druhPodleMime(n.mime)!;
  const hash = sha256Hex(n.bytes);
  const dup = await tx.one<{ id: string; title: string }>(
    "select id, title from marketing.media_assets where organization_id = $1 and venue_id is not distinct from $2 and sha256 = $3 and derived_from_asset_id is null and archived_at is null",
    [n.organizationId, n.venueId, hash]);
  if (dup) return { id: dup.id, duplicate: dup.title || dup.id };

  const id = randomUUID();
  const filename = sanitizeFilename(n.filename);
  const path = mediaPath({ organizationId: n.organizationId, venueId: n.venueId, assetId: id, filename });
  const storage = await getStorage();
  await storage.put(path, n.bytes, n.mime);
  const dims = kind === "image" ? rozmery(n.mime, n.bytes) : null;
  if (dims && dims.width < UPLOAD_LIMITY.minImageWidth) {
    // Nahraje se, ale s varováním v popisu — nízké rozlišení publisher odmítne.
    n.description = `${n.description ?? ""} [Pozor: šířka ${dims.width} px je pod doporučeným minimem ${UPLOAD_LIMITY.minImageWidth} px.]`.trim();
  }
  const col = n.collectionKey
    ? await tx.one<{ id: string }>("select id from marketing.media_collections where organization_id = $1 and venue_id is not distinct from $2 and key = $3", [n.organizationId, n.venueId, n.collectionKey])
    : null;
  await tx.q(
    `insert into marketing.media_assets (id, organization_id, venue_id, collection_id, kind, original_filename, storage_path, storage_provider, mime_type, size_bytes, width, height, orientation, sha256, title, description, author, license, consent_note, usable_until, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [id, n.organizationId, n.venueId, col?.id ?? null, kind, filename, path, storage.key, n.mime, n.bytes.length, dims?.width ?? null, dims?.height ?? null, orientace(dims?.width ?? null, dims?.height ?? null), hash,
      n.title ?? filename.replace(/\.[^.]+$/, ""), n.description ?? "", n.author ?? null, n.license ?? null, n.consentNote ?? null, n.usableUntil ?? null, n.userId]);
  for (const t of new Set((n.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))) {
    await tx.q("insert into marketing.media_tags (asset_id, tag, source) values ($1, $2, 'user') on conflict do nothing", [id, t]);
  }
  await tx.q("select marketing.audit($1, $2, 'media.uploaded', 'media_asset', $3, $4)", [n.organizationId, n.venueId, id, JSON.stringify({ kind, size: n.bytes.length })]);
  return { id };
}

export async function archivovatMedium(tx: Tx, id: string): Promise<void> {
  const a = await tx.one<{ organization_id: string; venue_id: string | null }>("select organization_id, venue_id from marketing.media_assets where id = $1", [id]);
  if (!a) throw new Error("Médium nenalezeno.");
  await assertAccess(tx, a.organization_id, "media.manage", a.venue_id);
  await tx.q("update marketing.media_assets set archived_at = now(), is_hero = false where id = $1", [id]);
}

export async function obnovitMedium(tx: Tx, id: string): Promise<void> {
  const a = await tx.one<{ organization_id: string; venue_id: string | null }>("select organization_id, venue_id from marketing.media_assets where id = $1", [id]);
  if (!a) throw new Error("Médium nenalezeno.");
  await assertAccess(tx, a.organization_id, "media.manage", a.venue_id);
  await tx.q("update marketing.media_assets set archived_at = null where id = $1", [id]);
}

export async function oznacitHero(tx: Tx, id: string, hero: boolean): Promise<void> {
  const a = await tx.one<{ organization_id: string; venue_id: string | null }>("select organization_id, venue_id from marketing.media_assets where id = $1", [id]);
  if (!a) throw new Error("Médium nenalezeno.");
  await assertAccess(tx, a.organization_id, "media.manage", a.venue_id);
  await tx.q("update marketing.media_assets set is_hero = $2 where id = $1", [id, hero]);
}

/** Přesun do jiné provozovny nebo do sdílených (spoušť v DB chce media.share). */
export async function presunoutMedium(tx: Tx, id: string, venueId: string | null, kopie: boolean): Promise<string> {
  const a = await tx.one<Record<string, unknown> & { id: string; organization_id: string; venue_id: string | null }>("select * from marketing.media_assets where id = $1", [id]);
  if (!a) throw new Error("Médium nenalezeno.");
  await assertAccess(tx, a.organization_id, "media.share", null);
  if (!kopie) {
    await tx.q("update marketing.media_assets set venue_id = $2, collection_id = null where id = $1", [id, venueId]);
    return id;
  }
  const newId = randomUUID();
  await tx.q(
    `insert into marketing.media_assets (id, organization_id, venue_id, kind, original_filename, storage_path, storage_provider, mime_type, size_bytes, width, height, orientation, sha256, title, description, author, license, consent_note, usable_until, derived_from_asset_id, derivation, uploaded_by)
     select $2, organization_id, $3, kind, original_filename, storage_path, storage_provider, mime_type, size_bytes, width, height, orientation, null, title, description, author, license, consent_note, usable_until, id, '{"copy":true}'::jsonb, uploaded_by
       from marketing.media_assets where id = $1`, [id, newId, venueId]);
  return newId;
}

export async function upravitMedium(tx: Tx, id: string, u: { title?: string; description?: string; collectionKey?: string | null; tags?: string[]; author?: string; license?: string; consentNote?: string; usableUntil?: string | null }): Promise<void> {
  const a = await tx.one<{ organization_id: string; venue_id: string | null }>("select organization_id, venue_id from marketing.media_assets where id = $1", [id]);
  if (!a) throw new Error("Médium nenalezeno.");
  await assertAccess(tx, a.organization_id, "media.manage", a.venue_id);
  const col = u.collectionKey
    ? await tx.one<{ id: string }>("select id from marketing.media_collections where organization_id = $1 and venue_id is not distinct from $2 and key = $3", [a.organization_id, a.venue_id, u.collectionKey])
    : null;
  await tx.q(
    `update marketing.media_assets set title = coalesce($2, title), description = coalesce($3, description), collection_id = case when $4::uuid is null then collection_id else $4 end,
       author = coalesce($5, author), license = coalesce($6, license), consent_note = coalesce($7, consent_note), usable_until = coalesce($8::date, usable_until) where id = $1`,
    [id, u.title ?? null, u.description ?? null, col?.id ?? null, u.author ?? null, u.license ?? null, u.consentNote ?? null, u.usableUntil ?? null]);
  if (u.tags) {
    await tx.q("delete from marketing.media_tags where asset_id = $1 and source = 'user'", [id]);
    for (const t of new Set(u.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) {
      await tx.q("insert into marketing.media_tags (asset_id, tag, source) values ($1, $2, 'user') on conflict do nothing", [id, t]);
    }
  }
}
