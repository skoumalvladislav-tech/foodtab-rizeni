import type { ProviderContext, RenderProvider, RenderRequest } from "../types.ts";
import { vykreslitSvg } from "../../render/svg-sablony.ts";

/**
 * Interní video (demo) — sandbox render.
 *
 * Nevytvoří žádné video. Vrátí storyboard jako JSON + titulní snímek
 * (SVG), aby šel proces render → schválení → publikace vyzkoušet bez
 * placené služby. Výstup je vždy označený jako mock a publisher ho
 * nesmí poslat jako video — u formátu reel končí na manual_export
 * se storyboardem ke zpracování.
 */
export function createMockVideo(ctx: ProviderContext): RenderProvider {
  return {
    key: "internal_mock_video",
    category: "video_rendering",
    capabilities: ["render.video"],
    mode: "mock",
    isMock: true,
    async testConnection() {
      return { ok: true, message: "Demo video nepotřebuje připojení (žádné skutečné video nevzniká)." };
    },
    estimateCostCents() {
      return 0;
    },
    async render(req: RenderRequest) {
      const cover = vykreslitSvg({ ...req, kind: "image", formatKey: "video_cover" });
      const storyboard = {
        mock: true,
        note: "Demo render: skutečné video nevzniklo. Storyboard a titulní snímek slouží k ručnímu zpracování nebo k odeslání skutečnému video poskytovateli.",
        durationSeconds: req.durationSeconds ?? 15,
        scenes: req.storyboard ?? [],
        coverSvg: cover,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(storyboard, null, 2));
      return {
        status: "done",
        output: { bytes, mime: "application/json", filename: `storyboard-${req.jobId.slice(0, 8)}.json`, durationSeconds: storyboard.durationSeconds },
        response: { mock: true, connectionId: ctx.connectionId },
        costEstimateCents: 0,
      };
    },
  };
}
