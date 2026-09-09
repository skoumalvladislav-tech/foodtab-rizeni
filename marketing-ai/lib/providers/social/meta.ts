import type { ProviderContext, PublishRequest, PublishResult, SocialAccountInfo, SocialPublisherProvider } from "../types.ts";

/**
 * Meta Graph API — Facebook Page + profesionální Instagram účet.
 *
 * VŠECHNY endpointy, parametry a názvy oprávnění jsou v `META` níže,
 * na jednom místě. Vycházejí z Graph API pro Instagram Content Publishing
 * (POST /{ig-user-id}/media → POST /{ig-user-id}/media_publish) a Pages
 * API (POST /{page-id}/feed, /photos, /videos). Z vývojového prostředí
 * NEŠLO ověřit aktuální oficiální dokumentaci (developers.facebook.com
 * je blokovaný) — před ostrým nasazením projděte docs/META_SETUP.md,
 * oddíl „Co ověřit ručně“, a upravte jen tyhle konstanty.
 *
 * Tokeny: v `ctx.credentials.access_token` (dlouhodobý uživatelský token)
 * a `page_tokens` (JSON {pageId: token}). Nikdy v logu, nikdy v odpovědi.
 */
export const META = {
  graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
  oauthDialog: "https://www.facebook.com/{v}/dialog/oauth",
  graph: "https://graph.facebook.com/{v}",
  /** Oprávnění, o která žádáme. Podléhají App Review. */
  scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "business_management"],
  /** Kolik IG publikací za 24 h dovoluje API (orientační limit z dokumentace). */
  igPublishLimitPer24h: 50,
  containerStatus: { finished: "FINISHED", error: "ERROR", inProgress: "IN_PROGRESS", published: "PUBLISHED", expired: "EXPIRED" },
} as const;

const url = (path: string) => `${META.graph.replace("{v}", META.graphVersion)}${path}`;

export function metaOauthUrl(opts: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: opts.appId, redirect_uri: opts.redirectUri, state: opts.state, response_type: "code", scope: META.scopes.join(","),
  });
  return `${META.oauthDialog.replace("{v}", META.graphVersion)}?${q}`;
}

/** Výměna kódu za krátkodobý token a pak za dlouhodobý (fb_exchange_token). */
export async function metaExchangeCode(opts: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<{ accessToken: string; expiresIn: number | null }> {
  const q1 = new URLSearchParams({ client_id: opts.appId, client_secret: opts.appSecret, redirect_uri: opts.redirectUri, code: opts.code });
  const r1 = await fetch(url(`/oauth/access_token?${q1}`));
  const j1 = (await r1.json()) as { access_token?: string; error?: { message?: string } };
  if (!j1.access_token) throw new Error(`Meta: výměna kódu selhala: ${j1.error?.message ?? r1.status}`);
  const q2 = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: opts.appId, client_secret: opts.appSecret, fb_exchange_token: j1.access_token });
  const r2 = await fetch(url(`/oauth/access_token?${q2}`));
  const j2 = (await r2.json()) as { access_token?: string; expires_in?: number };
  return { accessToken: j2.access_token ?? j1.access_token, expiresIn: j2.expires_in ?? null };
}

export function createMetaPublisher(ctx: ProviderContext): SocialPublisherProvider {
  const token = ctx.credentials.access_token;
  const pageTokens: Record<string, string> = ctx.credentials.page_tokens ? JSON.parse(ctx.credentials.page_tokens) : {};

  async function get<T>(path: string, params: Record<string, string>, tok = token): Promise<T> {
    const q = new URLSearchParams({ ...params, access_token: tok });
    const res = await fetch(url(`${path}?${q}`));
    const json = (await res.json()) as T & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new MetaError(json.error?.message ?? `HTTP ${res.status}`, json.error?.code, res.status);
    return json;
  }
  async function post<T>(path: string, params: Record<string, string>, tok: string): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: tok });
    const res = await fetch(url(path), { method: "POST", body });
    const json = (await res.json()) as T & { error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new MetaError(json.error?.message ?? `HTTP ${res.status}`, json.error?.code, res.status);
    return json;
  }

  return {
    key: "meta_graph",
    category: "social_publishing",
    capabilities: ctx.mode === "customer_managed" && token
      ? ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story", "publish.facebook.post", "publish.facebook.reel", "publish.schedule"]
      : [],
    mode: ctx.mode,
    isMock: false,
    async testConnection() {
      if (!token) return { ok: false, message: "Instagram a Facebook nejsou připojené." };
      try {
        const me = await get<{ id: string; name: string }>("/me", { fields: "id,name" });
        const dbg = process.env.META_APP_ID && process.env.META_APP_SECRET
          ? await get<{ data: { scopes?: string[]; expires_at?: number; is_valid?: boolean } }>("/debug_token", { input_token: token }, `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`)
          : null;
        if (dbg && dbg.data.is_valid === false) return { ok: false, message: "Token už neplatí — připojte účet znovu." };
        return {
          ok: true,
          message: `Připojeno jako ${me.name}.`,
          externalAccount: { user_id: me.id, user_name: me.name },
          grantedScopes: dbg?.data.scopes ?? [],
          expiresAt: dbg?.data.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : null,
        };
      } catch (e) {
        return { ok: false, message: `Meta: ${e instanceof Error ? e.message : "chyba"}` };
      }
    },
    async listAccounts(): Promise<SocialAccountInfo[]> {
      if (!token) return [];
      const pages = await get<{ data: { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string; name?: string } }[] }>(
        "/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username,name}" },
      );
      const out: SocialAccountInfo[] = [];
      for (const p of pages.data) {
        out.push({ platform: "facebook", kind: "page", externalId: p.id, name: p.name, capabilities: ["publish.facebook.post", "publish.facebook.reel"] });
        if (p.instagram_business_account) {
          out.push({
            platform: "instagram", kind: "ig_business", externalId: p.instagram_business_account.id,
            name: p.instagram_business_account.name ?? p.instagram_business_account.username ?? "Instagram", username: p.instagram_business_account.username,
            capabilities: ["publish.instagram.feed", "publish.instagram.carousel", "publish.instagram.reel", "publish.instagram.story"],
          });
        }
      }
      return out;
    },
    async publish(req: PublishRequest): Promise<PublishResult> {
      if (!token || !req.account) return { status: "failed", error: "Chybí připojený účet." };
      try {
        if (req.channel === "instagram") return await publishInstagram(req, token, get, post);
        const pageTok = pageTokens[req.account.externalId];
        if (!pageTok) return { status: "failed", error: "Chybí Page token — připojte stránku znovu." };
        return await publishFacebook(req, pageTok, post);
      } catch (e) {
        if (e instanceof MetaError) {
          // 4 = app rate limit, 17/32 = user/page rate limit, 613 = custom rate limit
          if ([4, 17, 32, 613].includes(e.code ?? -1) || e.status === 429) return { status: "retry", error: e.message, retryAfterSeconds: 900 };
          if (e.code === 190) return { status: "failed", error: "Token vypršel nebo byl odvolán (190). Připojte účet znovu." };
        }
        return { status: "failed", error: e instanceof Error ? e.message : "Neznámá chyba" };
      }
    },
    async checkStatus(externalPostId: string) {
      const r = await get<{ status_code?: string; permalink?: string }>(`/${externalPostId}`, { fields: "status_code,permalink" });
      if (r.status_code === META.containerStatus.error) return { status: "failed" };
      if (r.status_code && r.status_code !== META.containerStatus.finished && r.status_code !== META.containerStatus.published) return { status: "processing" };
      return { status: "published", permalink: r.permalink };
    },
    async fetchMetrics(externalPostId: string, channel) {
      if (!token) return null;
      try {
        if (channel === "instagram") {
          const r = await get<{ data: { name: string; values: { value: number }[] }[] }>(`/${externalPostId}/insights`, { metric: "reach,impressions,likes,comments,shares,saved" });
          return Object.fromEntries(r.data.map((m) => [m.name, m.values?.[0]?.value ?? 0]));
        }
        const r = await get<{ data: { name: string; values: { value: number }[] }[] }>(`/${externalPostId}/insights`, { metric: "post_impressions,post_impressions_unique,post_engaged_users" });
        return Object.fromEntries(r.data.map((m) => [m.name.replace("post_", ""), m.values?.[0]?.value ?? 0]));
      } catch {
        return null;
      }
    },
  };
}

type Get = <T>(path: string, params: Record<string, string>, tok?: string) => Promise<T>;
type Post = <T>(path: string, params: Record<string, string>, tok: string) => Promise<T>;

async function publishInstagram(req: PublishRequest, token: string, get: Get, post: Post): Promise<PublishResult> {
  const ig = req.account!.externalId;
  const caption = req.caption;
  const media = req.media;
  let creationId: string;
  if (req.format === "carousel") {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const c = await post<{ id: string }>(`/${ig}/media`, m.kind === "video" ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" } : { image_url: m.url, is_carousel_item: "true" }, token);
      children.push(c.id);
    }
    creationId = (await post<{ id: string }>(`/${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, token)).id;
  } else if (req.format === "reel") {
    const m = media.find((x) => x.kind === "video");
    if (!m) return { status: "failed", error: "Reel vyžaduje video." };
    creationId = (await post<{ id: string }>(`/${ig}/media`, { media_type: "REELS", video_url: m.url, caption, share_to_feed: "true" }, token)).id;
  } else if (req.format === "story") {
    const m = media[0];
    if (!m) return { status: "failed", error: "Story vyžaduje obrázek nebo video." };
    creationId = (await post<{ id: string }>(`/${ig}/media`, m.kind === "video" ? { media_type: "STORIES", video_url: m.url } : { media_type: "STORIES", image_url: m.url }, token)).id;
  } else {
    const m = media[0];
    if (!m) return { status: "failed", error: "Příspěvek vyžaduje obrázek." };
    creationId = (await post<{ id: string }>(`/${ig}/media`, { image_url: m.url, caption }, token)).id;
  }
  // Kontejner musí být FINISHED (u videa to chvíli trvá).
  for (let i = 0; i < 20; i++) {
    const s = await get<{ status_code?: string }>(`/${creationId}`, { fields: "status_code" });
    if (s.status_code === META.containerStatus.finished) break;
    if (s.status_code === META.containerStatus.error || s.status_code === META.containerStatus.expired) {
      return { status: "failed", error: `Instagram kontejner ve stavu ${s.status_code}.` };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const pub = await post<{ id: string }>(`/${ig}/media_publish`, { creation_id: creationId }, token);
  const link = await get<{ permalink?: string }>(`/${pub.id}`, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return { status: "published", externalPostId: pub.id, permalink: link.permalink, response: { creationId, id: pub.id } };
}

async function publishFacebook(req: PublishRequest, pageToken: string, post: Post): Promise<PublishResult> {
  const page = req.account!.externalId;
  const sched: Record<string, string> = req.scheduledFor && req.scheduledFor.getTime() > Date.now() + 10 * 60 * 1000
    ? { published: "false", scheduled_publish_time: String(Math.floor(req.scheduledFor.getTime() / 1000)) }
    : {};
  const m = req.media[0];
  let id: string;
  if (req.format === "reel" || (m && m.kind === "video")) {
    if (!m) return { status: "failed", error: "Reel vyžaduje video." };
    id = (await post<{ id: string }>(`/${page}/videos`, { file_url: m.url, description: req.caption, ...sched }, pageToken)).id;
  } else if (m) {
    id = (await post<{ id: string; post_id?: string }>(`/${page}/photos`, { url: m.url, message: req.caption, ...sched }, pageToken)).id;
  } else {
    id = (await post<{ id: string }>(`/${page}/feed`, { message: req.caption, ...sched }, pageToken)).id;
  }
  return { status: "published", externalPostId: id, response: { id, scheduled: sched.published === "false" } };
}

export class MetaError extends Error {
  code?: number;
  status?: number;
  constructor(message: string, code?: number, status?: number) {
    super(message);
    this.name = "MetaError";
    this.code = code;
    this.status = status;
  }
}
