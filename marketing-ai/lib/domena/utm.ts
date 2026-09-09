import qrcode from "qrcode-generator";

import type { Tx } from "../db/driver.ts";
import { randomToken } from "../utils/hash.ts";

/** UTM odkaz + QR kód (SVG) pro rezervaci, objednávku nebo akci. */
export function sestavitUtm(target: string, utm: { source: string; medium: string; campaign: string; content?: string }): string {
  const u = new URL(target);
  u.searchParams.set("utm_source", utm.source);
  u.searchParams.set("utm_medium", utm.medium);
  u.searchParams.set("utm_campaign", utm.campaign);
  if (utm.content) u.searchParams.set("utm_content", utm.content);
  return u.toString();
}

export async function vytvoritUtmOdkaz(tx: Tx, p: { organizationId: string; venueId: string; contentItemId: string | null; target: string; source: string; medium: string; campaign: string; content?: string }): Promise<{ id: string; url: string; shortCode: string }> {
  const url = sestavitUtm(p.target, p);
  const shortCode = randomToken(4);
  const r = await tx.one<{ id: string }>(
    "insert into marketing.utm_links (organization_id, venue_id, content_item_id, target_url, utm, short_code) values ($1, $2, $3, $4, $5, $6) returning id",
    [p.organizationId, p.venueId, p.contentItemId, url, JSON.stringify({ source: p.source, medium: p.medium, campaign: p.campaign, content: p.content ?? null }), shortCode]);
  return { id: r!.id, url, shortCode };
}

export function qrSvg(text: string, size = 240): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + 8);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(c + 4) * cell} ${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#1c1a17"/></svg>`;
}
