import { randomUUID } from "node:crypto";

import type { ProviderContext, PublishRequest, SocialPublisherProvider } from "../types.ts";

/**
 * Mock publisher — nikdy nic nezveřejní. Výsledný stav je vždy
 * `published_mock`, viditelně odlišený od skutečné publikace.
 */
export function createMockPublisher(ctx: ProviderContext): SocialPublisherProvider {
  return {
    key: "mock_publisher",
    category: "social_publishing",
    capabilities: [
      "publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story",
      "publish.facebook.post", "publish.facebook.reel", "publish.schedule",
    ],
    mode: "mock",
    isMock: true,
    async testConnection() {
      return { ok: true, message: "Demo publikace: nic se nezveřejní, stav bude published_mock." };
    },
    async listAccounts() {
      return [
        { platform: "instagram", kind: "ig_business", externalId: "mock-ig", name: "Demo Instagram", username: "demo_ig", capabilities: ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story"] },
        { platform: "facebook", kind: "page", externalId: "mock-fb", name: "Demo Facebook Page", capabilities: ["publish.facebook.post", "publish.facebook.reel"] },
      ];
    },
    async publish(req: PublishRequest) {
      // Simulace: prázdný popisek u feedu je chyba i u mocku, aby šel vyzkoušet retry/dead-letter.
      if (req.media.length === 0 && req.format !== "page_post") {
        return { status: "failed", error: "Mock: chybí médium k publikaci." };
      }
      return {
        status: "published_mock",
        externalPostId: `mock_${randomUUID().slice(0, 12)}`,
        permalink: null as unknown as string | undefined,
        response: { mock: true, idempotencyKey: req.idempotencyKey, channel: req.channel, format: req.format, org: ctx.organizationId },
      };
    },
    async fetchMetrics() {
      return null;
    },
  };
}
