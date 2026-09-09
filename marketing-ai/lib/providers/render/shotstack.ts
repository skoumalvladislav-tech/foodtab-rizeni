import type { ProviderContext, RenderProvider, RenderRequest } from "../types.ts";

/**
 * Shotstack — doporučený render videí (Reels z fotografií, střih, titulky).
 *
 * Endpointy a tvar časové osy vycházejí z veřejného Shotstack Edit API
 * (POST /render, GET /render/{id}, x-api-key). Z vývojového prostředí
 * NEŠLO ověřit aktuální dokumentaci (síť blokuje shotstack.io); před
 * ostrým nasazením zkontrolujte docs/SHOTSTACK_SETUP.md, oddíl
 * „Co ověřit“. Vše, co by se mohlo změnit, je v konstantách níž.
 *
 * Bezplatný sandbox `stage` vrací video s vodoznakem — pro zkoušení
 * bez platby; `v1` je produkce.
 */
const ENDPOINTS = {
  stage: "https://api.shotstack.io/edit/stage",
  v1: "https://api.shotstack.io/edit/v1",
} as const;

type Scena = { poradi: number; druh: string; sekundy: number; mediaAssetId: string | null; textVObraze: string; titulek: string };

export function createShotstack(ctx: ProviderContext): RenderProvider {
  const apiKey = ctx.credentials.api_key || (ctx.mode === "foodtab_managed" ? process.env.SHOTSTACK_API_KEY : undefined);
  const env = (ctx.credentials.env || process.env.SHOTSTACK_ENV || "stage") as keyof typeof ENDPOINTS;
  const base = ENDPOINTS[env] ?? ENDPOINTS.stage;
  const headers = { "x-api-key": apiKey ?? "", "Content-Type": "application/json", Accept: "application/json" };

  return {
    key: "shotstack",
    category: "video_rendering",
    capabilities: ["render.video", "render.image", "render.subtitles", "render.audio_mix"],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      if (!apiKey) return { ok: false, message: "Chybí API klíč Shotstack." };
      try {
        // Nepublikační test: dotaz na neexistující render vrátí 404/400 s platným klíčem, 401 s neplatným.
        const res = await fetch(`${base}/render/00000000-0000-0000-0000-000000000000`, { headers });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Shotstack klíč odmítl (401/403)." };
        return { ok: true, message: `Shotstack odpovídá (prostředí ${env}).`, externalAccount: { env } };
      } catch (e) {
        return { ok: false, message: `Shotstack nedostupný: ${e instanceof Error ? e.message : "chyba sítě"}` };
      }
    },
    estimateCostCents(req) {
      // Orientační: podle délky videa; skutečnou cenu určuje tarif zákazníka.
      const sec = req.durationSeconds ?? 15;
      return env === "stage" ? 0 : Math.round((sec / 60) * 100 * 23 * 0.2);
    },
    async render(req: RenderRequest) {
      if (!apiKey) return { status: "failed", error: "Shotstack není připojený (chybí klíč)." };
      const timeline = sestavitTimeline(req);
      const body = {
        timeline,
        output: {
          format: req.kind === "video" ? "mp4" : "png",
          size: { width: req.width, height: req.height },
          fps: 25,
        },
        ...(req.callbackUrl ? { callback: req.callbackUrl } : {}),
      };
      const res = await fetch(`${base}/render`, { method: "POST", headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; response?: { id?: string; message?: string }; message?: string };
      if (!res.ok || !json.response?.id) {
        return { status: "failed", error: `Shotstack odmítl render: ${json.response?.message ?? json.message ?? res.status}`, response: json };
      }
      return { status: "submitted", externalId: json.response.id, response: json, costEstimateCents: this.estimateCostCents?.(req) ?? null };
    },
    async status(externalId: string) {
      const res = await fetch(`${base}/render/${externalId}`, { headers });
      const json = (await res.json().catch(() => ({}))) as { response?: { status?: string; url?: string; error?: string } };
      const s = json.response?.status;
      if (s === "done") return { status: "done", url: json.response?.url, response: json };
      if (s === "failed") return { status: "failed", error: json.response?.error ?? "render failed", response: json };
      if (s === "queued" || s === "fetching") return { status: "queued", response: json };
      return { status: "rendering", response: json };
    },
  };
}

/** Storyboard → Shotstack timeline: každá scéna je klip s efektem, titulek jako HTML asset. */
export function sestavitTimeline(req: RenderRequest) {
  const brand = req.brand as { colors?: { primary?: string; accent?: string; background?: string }; fonts?: { heading?: string } };
  const sceny = ((req.storyboard as Scena[] | undefined) ?? []).sort((a, b) => a.poradi - b.poradi);
  const media = new Map(req.media.map((m) => [m.assetId, m]));
  const bg = brand.colors?.primary ?? "#241d1a";
  const accent = brand.colors?.accent ?? "#d8ab4e";
  let start = 0;
  const videoClips: unknown[] = [];
  const textClips: unknown[] = [];
  for (const s of sceny) {
    const m = s.mediaAssetId ? media.get(s.mediaAssetId) : undefined;
    const length = Math.max(0.5, s.sekundy);
    if (m) {
      videoClips.push({
        asset: m.kind === "video" ? { type: "video", src: m.url, volume: 0 } : { type: "image", src: m.url },
        start, length, fit: "cover", effect: m.kind === "video" ? undefined : "zoomIn", transition: { in: "fade", out: "fade" },
      });
    } else {
      videoClips.push({ asset: { type: "html", html: `<div style="width:100%;height:100%;background:${bg}"></div>`, width: req.width, height: req.height }, start, length });
    }
    const text = [s.textVObraze, s.titulek].filter(Boolean).join("\n");
    if (text) {
      textClips.push({
        asset: {
          type: "html",
          html: `<p style="font-family:'${brand.fonts?.heading ?? "Archivo"}',Arial,sans-serif;font-size:64px;font-weight:700;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6);text-align:center;padding:0 60px">${escapeHtml(text)}</p>`,
          width: req.width, height: Math.round(req.height * 0.3),
        },
        start, length, position: "center", offset: { y: -0.05 }, transition: { in: "slideUp", out: "fade" },
      });
    }
    start += length;
  }
  // Barevný pruh značky jako podpis
  textClips.push({
    asset: { type: "html", html: `<div style="width:100%;height:100%;background:${accent}"></div>`, width: req.width, height: 12 },
    start: 0, length: Math.max(1, start), position: "bottom",
  });
  return { background: bg, tracks: [{ clips: textClips }, { clips: videoClips }] };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
}
