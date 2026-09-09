import type { RenderRequest } from "../providers/types.ts";

/**
 * Vykreslení datové šablony do SVG.
 *
 * Bez knihoven, bez fontů ke stažení: písmo je systémové s fallbackem,
 * české znaky se přenášejí jako text (ne cesty), takže je čte i tisk.
 *
 * Pravidla pro text (§9 zadání):
 *  - název jídla se nikdy neusekne; zalamuje se na řádky,
 *  - písmo se zmenšuje jen do čitelného minima (textRules.minFontPx),
 *  - když se položky nevejdou, je to chyba „rozdělit na slidy“, ne
 *    nečitelný výstup — volající dostane `overflow` a udělá další slide.
 */
interface Brand {
  colors?: { primary?: string; secondary?: string; accent?: string; background?: string; text?: string };
  fonts?: { heading?: string; body?: string };
  signature?: string;
  logo_placement?: { position?: string; safe_zone_percent?: number };
  address?: string;
  phone?: string;
  website_url?: string;
}

interface Item { name: string; description?: string; price_cents?: number | null; allergens?: string[]; category?: string }

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Zalomení textu podle odhadované šířky znaku (0.55 em) — bez měření fontu. */
export function zalomit(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export function kc(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return `${Math.round(cents / 100)} Kč`;
}

export interface SvgVysledek { svg: string; overflow: boolean; itemsRendered: number }

export function vykreslitSvg(req: RenderRequest): string {
  return vykreslit(req).svg;
}

export function vykreslit(req: RenderRequest): SvgVysledek {
  const W = req.width;
  const H = req.height;
  const brand = (req.brand ?? {}) as Brand;
  const c = {
    bg: brand.colors?.background ?? "#f6f2e9",
    primary: brand.colors?.primary ?? "#241d1a",
    secondary: brand.colors?.secondary ?? "#6b4c8a",
    accent: brand.colors?.accent ?? "#d8ab4e",
    text: brand.colors?.text ?? "#1c1a17",
  };
  const fontH = `'${brand.fonts?.heading ?? "Newsreader"}', Georgia, serif`;
  const fontB = `'${brand.fonts?.body ?? "Archivo"}', Arial, sans-serif`;
  const layout = (req.template.layout ?? {}) as { style?: string };
  const rules = (req.template.textRules ?? {}) as { minFontPx?: number; itemsPerSlide?: number; titleMaxChars?: number };
  const safe = safeZone(req.formatKey);
  const pad = Math.round(W * 0.06);
  const top = Math.round(H * (safe.top / 100)) + pad;
  const bottom = H - Math.round(H * (safe.bottom / 100)) - pad;
  const left = pad;
  const right = W - pad;
  const usableW = right - left;

  const headline = req.texts.headline ?? "";
  const body = req.texts.body ?? "";
  const cta = req.texts.cta ?? "";
  const overlay = req.texts.overlay ?? [];
  const items = ((req.inputs.items as Item[] | undefined) ?? []).filter((i) => i && i.name);
  const photo = req.media.find((m) => m.kind === "image");
  const isPrint = req.kind === "pdf";
  const scale = W / 1080;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${esc(c.bg)}"/>`);

  let y = top;
  const style = layout.style ?? "menu-list";

  // Fotografie nahoře u hero/poster stylů
  if (photo && (style === "hero-photo" || style === "event-poster" || style === "portrait")) {
    const ph = Math.round(H * (style === "portrait" ? 0.55 : 0.46));
    parts.push(`<clipPath id="ph"><rect x="0" y="0" width="${W}" height="${ph}"/></clipPath>`);
    parts.push(`<image href="${esc(photo.url)}" x="0" y="0" width="${W}" height="${ph}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>`);
    parts.push(`<rect x="0" y="${ph - Math.round(120 * scale)}" width="${W}" height="${Math.round(120 * scale)}" fill="url(#fade)"/>`);
    parts.push(`<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(c.bg)}" stop-opacity="0"/><stop offset="1" stop-color="${esc(c.bg)}"/></linearGradient></defs>`);
    y = Math.max(y, ph + Math.round(10 * scale));
  } else if (photo && style === "menu-list") {
    // Menu: fotka v pruhu nahoře, menší
    const ph = Math.round(H * 0.28);
    parts.push(`<clipPath id="ph"><rect x="0" y="0" width="${W}" height="${ph}"/></clipPath>`);
    parts.push(`<image href="${esc(photo.url)}" x="0" y="0" width="${W}" height="${ph}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>`);
    y = Math.max(y, ph + Math.round(24 * scale));
  } else {
    // Bez fotky: barevný pruh značky
    parts.push(`<rect x="0" y="0" width="${W}" height="${Math.round(18 * scale)}" fill="${esc(c.primary)}"/>`);
    parts.push(`<rect x="0" y="${Math.round(18 * scale)}" width="${W}" height="${Math.round(6 * scale)}" fill="${esc(c.accent)}"/>`);
  }

  // Badge (datum / štítek)
  const badge = (req.inputs.badge as string | undefined) ?? overlay[1] ?? "";
  if (badge) {
    const fs = Math.round(30 * scale);
    const bw = Math.round(badge.length * fs * 0.62 + 40 * scale);
    parts.push(`<rect x="${left}" y="${y}" rx="${Math.round(14 * scale)}" width="${bw}" height="${Math.round(fs * 1.7)}" fill="${esc(c.accent)}"/>`);
    parts.push(`<text x="${left + 20 * scale}" y="${y + fs * 1.2}" font-family="${fontB}" font-size="${fs}" font-weight="700" fill="${esc(c.primary)}">${esc(badge)}</text>`);
    y += Math.round(fs * 1.7 + 22 * scale);
  }

  // Titulek — zalomený, zmenšený jen do minima
  if (headline) {
    let fs = Math.round(78 * scale);
    const min = Math.round((rules.minFontPx ?? 28) * scale * 1.4);
    let lines = zalomit(headline, Math.floor(usableW / (fs * 0.52)));
    while (lines.length > 3 && fs > min) {
      fs -= Math.round(6 * scale);
      lines = zalomit(headline, Math.floor(usableW / (fs * 0.52)));
    }
    for (const l of lines) {
      y += fs;
      parts.push(`<text x="${left}" y="${y}" font-family="${fontH}" font-size="${fs}" font-weight="500" fill="${esc(c.primary)}">${esc(l)}</text>`);
    }
    y += Math.round(18 * scale);
    parts.push(`<rect x="${left}" y="${y}" width="${Math.round(120 * scale)}" height="${Math.round(6 * scale)}" fill="${esc(c.accent)}"/>`);
    y += Math.round(34 * scale);
  }

  // Položky menu
  let overflow = false;
  let rendered = 0;
  if (items.length) {
    const perSlide = rules.itemsPerSlide ?? 5;
    const bodyFs = Math.round(34 * scale);
    const minFs = Math.round((rules.minFontPx ?? 28) * scale);
    const ctaSpace = cta ? Math.round(120 * scale) : 0;
    const footSpace = Math.round(90 * scale);
    let fs = bodyFs;
    const layoutItems = (f: number) => {
      const rows: { lines: string[]; price: string; desc: string[]; allergens: string }[] = [];
      let h = 0;
      for (const it of items.slice(0, perSlide)) {
        const price = kc(it.price_cents);
        const nameLines = zalomit(it.name, Math.floor((usableW - (price ? price.length * f * 0.6 + 30 * scale : 0)) / (f * 0.55)));
        const desc = it.description ? zalomit(it.description, Math.floor(usableW / (f * 0.44))) : [];
        const allergens = it.allergens && it.allergens.length ? `A: ${it.allergens.join(", ")}` : "";
        rows.push({ lines: nameLines, price, desc, allergens });
        h += nameLines.length * f * 1.25 + desc.length * f * 0.8 * 1.25 + (allergens ? f * 0.7 : 0) + f * 0.7;
      }
      return { rows, h };
    };
    let l = layoutItems(fs);
    while (y + l.h > bottom - ctaSpace - footSpace && fs > minFs) {
      fs -= Math.round(2 * scale);
      l = layoutItems(fs);
    }
    overflow = items.length > perSlide || y + l.h > bottom - ctaSpace - footSpace;
    for (const r of l.rows) {
      const startY = y;
      for (const ln of r.lines) {
        y += fs * 1.25;
        parts.push(`<text x="${left}" y="${y}" font-family="${fontB}" font-size="${fs}" font-weight="600" fill="${esc(c.text)}">${esc(ln)}</text>`);
      }
      if (r.price) {
        parts.push(`<text x="${right}" y="${startY + fs * 1.25}" text-anchor="end" font-family="${fontB}" font-size="${fs}" font-weight="700" fill="${esc(c.secondary)}">${esc(r.price)}</text>`);
      }
      for (const d of r.desc) {
        y += fs * 0.8 * 1.25;
        parts.push(`<text x="${left}" y="${y}" font-family="${fontB}" font-size="${Math.round(fs * 0.8)}" fill="${esc(c.text)}" fill-opacity="0.75">${esc(d)}</text>`);
      }
      if (r.allergens) {
        y += fs * 0.7;
        parts.push(`<text x="${left}" y="${y}" font-family="${fontB}" font-size="${Math.round(fs * 0.6)}" fill="${esc(c.text)}" fill-opacity="0.55">${esc(r.allergens)}</text>`);
      }
      y += fs * 0.7;
      parts.push(`<line x1="${left}" y1="${y - fs * 0.35}" x2="${right}" y2="${y - fs * 0.35}" stroke="${esc(c.primary)}" stroke-opacity="0.12"/>`);
      rendered++;
    }
  }

  // Tělo textu
  if (body && !items.length) {
    const fs = Math.round(36 * scale);
    for (const ln of zalomit(body, Math.floor(usableW / (fs * 0.5))).slice(0, 8)) {
      y += fs * 1.35;
      parts.push(`<text x="${left}" y="${y}" font-family="${fontB}" font-size="${fs}" fill="${esc(c.text)}">${esc(ln)}</text>`);
    }
    y += Math.round(20 * scale);
  }

  // CTA
  if (cta) {
    const fs = Math.round(34 * scale);
    const bw = Math.min(usableW, Math.round(cta.length * fs * 0.6 + 60 * scale));
    const by = Math.min(Math.max(y + Math.round(20 * scale), bottom - Math.round(200 * scale)), bottom - Math.round(fs * 2.6));
    parts.push(`<rect x="${left}" y="${by}" rx="${Math.round(18 * scale)}" width="${bw}" height="${Math.round(fs * 1.9)}" fill="${esc(c.primary)}"/>`);
    parts.push(`<text x="${left + bw / 2}" y="${by + fs * 1.3}" text-anchor="middle" font-family="${fontB}" font-size="${fs}" font-weight="700" fill="${esc(c.bg)}">${esc(cta)}</text>`);
  }

  // Patička: podpis + kontakt (jen u tisku kontakt celý)
  const footFs = Math.round(26 * scale);
  const sig = brand.signature ?? "";
  if (sig) {
    parts.push(`<text x="${left}" y="${bottom}" font-family="${fontH}" font-size="${Math.round(footFs * 1.2)}" fill="${esc(c.primary)}">${esc(sig)}</text>`);
  }
  if (isPrint) {
    const kontakt = [brand.address, brand.phone, brand.website_url].filter(Boolean).join(" · ");
    if (kontakt) parts.push(`<text x="${right}" y="${bottom}" text-anchor="end" font-family="${fontB}" font-size="${footFs}" fill="${esc(c.text)}" fill-opacity="0.7">${esc(kontakt)}</text>`);
  } else if (brand.website_url) {
    parts.push(`<text x="${right}" y="${bottom}" text-anchor="end" font-family="${fontB}" font-size="${footFs}" fill="${esc(c.text)}" fill-opacity="0.7">${esc(brand.website_url.replace(/^https?:\/\//, ""))}</text>`);
  }
  // Logo — místo pro logo podle brand kitu (kolečko s iniciálou, když logo chybí)
  const pos = brand.logo_placement?.position ?? "bottom-right";
  const logo = req.media.find((m) => m.kind === "logo");
  const lr = Math.round(46 * scale);
  const lx = pos.includes("left") ? left + lr : right - lr;
  const ly = pos.includes("top") ? top + lr : bottom - Math.round(90 * scale) - lr;
  if (logo) {
    parts.push(`<image href="${esc(logo.url)}" x="${lx - lr}" y="${ly - lr}" width="${lr * 2}" height="${lr * 2}" preserveAspectRatio="xMidYMid meet"/>`);
  } else if (sig) {
    parts.push(`<circle cx="${lx}" cy="${ly}" r="${lr}" fill="${esc(c.accent)}"/>`);
    parts.push(`<text x="${lx}" y="${ly + lr * 0.4}" text-anchor="middle" font-family="${fontH}" font-size="${lr * 1.1}" fill="${esc(c.primary)}">${esc(sig.slice(0, 1).toUpperCase())}</text>`);
  }
  parts.push(`</svg>`);
  return { svg: parts.join("\n"), overflow, itemsRendered: rendered };
}

function safeZone(formatKey: string): { top: number; bottom: number } {
  if (formatKey === "instagram_story" || formatKey === "instagram_reel" || formatKey === "facebook_reel" || formatKey === "video_cover") {
    return { top: 14, bottom: 20 };
  }
  if (formatKey.startsWith("pdf")) return { top: 5, bottom: 5 };
  return { top: 4, bottom: 4 };
}
