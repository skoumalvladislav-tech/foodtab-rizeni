import { rastrovat } from "../../render/rastr.ts";
import { vykreslitSvg } from "../../render/svg-sablony.ts";
import type { ProviderContext, RenderProvider, RenderRequest } from "../types.ts";

/**
 * Interní vykreslení obrázků — SVG z datové šablony + brand kitu.
 *
 * Skutečný, ne mock: výsledek je hotový obrázek, který jde zveřejnit,
 * stáhnout nebo vytisknout. Video neumí — to hlásí v capabilities
 * a registr pro video vybere jiného poskytovatele.
 *
 * Obrázky pro sítě se převádějí na PNG (velké na JPEG), protože
 * Instagram ani Facebook SVG nepřijmou. Pro tisk (A4/A5) zůstává SVG:
 * je ostré v jakékoli velikosti a tiskárna si s ním poradí.
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
      const znacka = req.jobId.slice(0, 8);
      if (req.kind === "pdf") {
        return {
          status: "done",
          output: { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml", filename: `${req.formatKey}-${znacka}.svg`, width: req.width, height: req.height },
          costEstimateCents: 0,
        };
      }
      try {
        const r = await rastrovat(svg, { width: req.width, height: req.height });
        return {
          status: "done",
          output: { bytes: r.bytes, mime: r.mime, filename: `${req.formatKey}-${znacka}.${r.pripona}`, width: r.width, height: r.height },
          costEstimateCents: 0,
        };
      } catch (e) {
        // Radši nahlas selhat než vydat obrázek bez textu za hotový.
        return { status: "failed", error: `Převod obrázku selhal: ${e instanceof Error ? e.message : "chyba"}` };
      }
    },
  };
}
