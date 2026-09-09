import type { ProviderContext, SocialPublisherProvider } from "../types.ts";

/**
 * Ruční publikace — bez připojení. Úloha skončí ve stavu `manual_export`:
 * uživatel si stáhne soubory a text a zveřejní sám. Žádná falešná
 * automatizace, žádný falešný stav „zveřejněno“.
 */
export function createManualExport(ctx: ProviderContext): SocialPublisherProvider {
  return {
    key: "manual_export",
    category: "social_publishing",
    capabilities: ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story", "publish.facebook.post", "publish.facebook.reel"],
    mode: "manual_export",
    isMock: false,
    async testConnection() {
      return { ok: true, message: "Ruční publikace nepotřebuje připojení." };
    },
    async listAccounts() {
      return [];
    },
    async publish(req) {
      return { status: "manual_export", response: { note: "Stáhněte soubory a text a zveřejněte ručně.", org: ctx.organizationId, format: req.format } };
    },
  };
}
