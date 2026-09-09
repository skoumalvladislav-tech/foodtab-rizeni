import type { ProviderContext, RenderProvider, RenderRequest } from "../types.ts";
import { vykreslitSvg } from "../../render/svg-sablony.ts";

/**
 * Interní vykreslení obrázků — SVG z datové šablony + brand kitu.
 *
 * Skutečný, ne mock: výsledek je hotový obrázek (SVG), který jde stáhnout,
 * vytisknout (A4/A5) nebo poslat publisheru. Video neumí — to hlásí
 * v capabilities a registr pro video vybere jiného poskytovatele.
 */
export function createSvgRenderer(ctx: ProviderContext): RenderProvider {
  return {
    key: "internal_svg_renderer",
    category: "image_rendering",
    capabilities: ["render.image", "render.pdf"],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      return { ok: true, message: "Vestavěné vykreslení nepotřebuje připojení." };
    },
    estimateCostCents() {
      return 0;
    },
    async render(req: RenderRequest) {
      if (req.kind === "video") {
        return { status: "failed", error: "Interní renderer neumí video. Vyberte video poskytovatele v Integracích." };
      }
      const svg = vykreslitSvg(req);
      const bytes = new TextEncoder().encode(svg);
      return {
        status: "done",
        output: { bytes, mime: "image/svg+xml", filename: `${req.formatKey}-${req.jobId.slice(0, 8)}.svg`, width: req.width, height: req.height },
        costEstimateCents: 0,
      };
    },
  };
}
