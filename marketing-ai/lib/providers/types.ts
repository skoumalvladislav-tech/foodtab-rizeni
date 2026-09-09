/**
 * Rozhraní poskytovatelů — smlouva mezi aplikací a externími službami.
 *
 * Aplikace se nikdy neptá „je to Shotstack?“. Ptá se registru na
 * poskytovatele pro danou kategorii a používá jen to, co poskytovatel
 * ohlásí v `capabilities`. Přidání nové služby = nový adaptér + řádek
 * v katalogu (migrace), ne `if` v obrazovce.
 *
 * Každý adaptér dostane `ProviderContext` s dešifrovanými přístupovými
 * údaji jen pro tuhle organizaci. Údaje se nikdy nelogují ani nevracejí
 * do prohlížeče.
 */
import type { AiNavrh, AiZadani, AiZpetnaVazba } from "./ai/schema.ts";

export type ConnectionMode = "customer_managed" | "foodtab_managed" | "manual_export" | "mock";

export interface ProviderContext {
  organizationId: string;
  venueId: string | null;
  connectionId: string | null;
  mode: ConnectionMode;
  /** Dešifrované údaje: {api_key} | {access_token, …} | {} */
  credentials: Record<string, string>;
  /** Bezpečná metadata připojení (stránka, účet) */
  externalAccount: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  /** Bezpečná metadata, která se uloží do external_account */
  externalAccount?: Record<string, unknown>;
  grantedScopes?: string[];
  expiresAt?: string | null;
}

export interface BaseProvider {
  key: string;
  category: string;
  /** Skutečně dostupné schopnosti v tomhle připojení */
  capabilities: string[];
  mode: ConnectionMode;
  isMock: boolean;
  testConnection(): Promise<TestResult>;
}

// ---------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------
export interface AIProvider extends BaseProvider {
  navrhnout(zadani: AiZadani): Promise<{ navrh: AiNavrh; model: string; promptVersion: string; costEstimateCents: number | null }>;
  prepracovat(zadani: AiZadani, puvodni: AiNavrh, zpetnaVazba: AiZpetnaVazba): Promise<{ navrh: AiNavrh; model: string; promptVersion: string; costEstimateCents: number | null }>;
  /** Rozpoznání menu z obrázku/PDF (capability menu.ocr) */
  rozpoznatMenu?(input: { bytes: Uint8Array; mime: string; hint?: string }): Promise<MenuRozpoznani>;
}

export interface MenuRozpoznani {
  kind: string;
  title: string;
  valid_from: string | null;
  valid_to: string | null;
  days: { label: string; day_date: string | null; items: MenuRozpoznanaPolozka[] }[];
  /** Položky bez dne */
  items: MenuRozpoznanaPolozka[];
  warnings: string[];
}

export interface MenuRozpoznanaPolozka {
  category: string;
  name: string;
  description: string;
  price_cents: number | null;
  allergens: string[];
  note: string;
  needs_review: boolean;
  review_reason: string | null;
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
export interface RenderRequest {
  jobId: string;
  formatKey: string;
  width: number;
  height: number;
  kind: "image" | "video" | "pdf";
  /** Šablona + vstupy + brand — vše, co je potřeba k vykreslení */
  template: { key: string; layout: unknown; textRules: unknown; storyboard?: unknown };
  inputs: Record<string, unknown>;
  brand: Record<string, unknown>;
  texts: { headline?: string; body?: string; cta?: string; overlay?: string[] };
  /** Podepsané adresy médií (pro externí renderer) nebo lokální bytes */
  media: { assetId: string; url: string; kind: string; mime: string }[];
  storyboard?: unknown;
  durationSeconds?: number;
  callbackUrl?: string;
}

export interface RenderResult {
  status: "done" | "submitted" | "failed";
  /** Hotový soubor — u synchronního renderu */
  output?: { bytes: Uint8Array; mime: string; filename: string; width?: number; height?: number; durationSeconds?: number };
  /** Externí ID pro polling / callback */
  externalId?: string;
  response?: unknown;
  error?: string;
  costEstimateCents?: number | null;
}

export interface RenderProvider extends BaseProvider {
  render(req: RenderRequest): Promise<RenderResult>;
  /** Polling stavu u asynchronních rendererů */
  status?(externalId: string): Promise<{ status: "queued" | "rendering" | "done" | "failed"; url?: string; error?: string; response?: unknown }>;
  estimateCostCents?(req: RenderRequest): number | null;
}

// ---------------------------------------------------------------------
// Publikování
// ---------------------------------------------------------------------
export interface PublishRequest {
  jobId: string;
  idempotencyKey: string;
  channel: "instagram" | "facebook";
  format: string;
  account: { externalId: string; kind: string; name: string } | null;
  caption: string;
  media: { url: string; mime: string; kind: "image" | "video" }[];
  scheduledFor?: Date;
}

export interface PublishResult {
  status: "published" | "published_mock" | "manual_export" | "failed" | "retry";
  externalPostId?: string;
  permalink?: string;
  response?: unknown;
  error?: string;
  /** Kdy zkusit znovu (retry) */
  retryAfterSeconds?: number;
}

export interface SocialAccountInfo {
  platform: "instagram" | "facebook";
  kind: string;
  externalId: string;
  name: string;
  username?: string;
  capabilities: string[];
}

export interface SocialPublisherProvider extends BaseProvider {
  listAccounts(): Promise<SocialAccountInfo[]>;
  publish(req: PublishRequest): Promise<PublishResult>;
  /** Stav publikace u poskytovatele (polling) */
  checkStatus?(externalPostId: string): Promise<{ status: "published" | "processing" | "failed"; permalink?: string }>;
  fetchMetrics?(externalPostId: string, channel: "instagram" | "facebook"): Promise<Record<string, number> | null>;
}

// ---------------------------------------------------------------------
// Workflow, notifikace, menu
// ---------------------------------------------------------------------
export interface WorkflowProvider extends BaseProvider {
  /** Odešle podepsanou událost; vrací ID běhu nebo null (interní fronta) */
  trigger(event: { type: string; idempotencyKey: string; payload: Record<string, unknown> }): Promise<{ accepted: boolean; externalRunId?: string; error?: string }>;
}

export interface NotificationProvider extends BaseProvider {
  notify(n: { userIds: string[]; kind: string; title: string; body: string; link?: string }): Promise<void>;
}

export interface MenuSourceProvider extends BaseProvider {
  /** Načte schválené menu z externího zdroje (etapa 3) */
  fetchMenus?(venueId: string): Promise<MenuRozpoznani[]>;
}

export interface MetricsProvider extends BaseProvider {
  fetchMetrics(externalPostId: string, channel: "instagram" | "facebook"): Promise<{ metrics: Record<string, number>; isEstimate: boolean } | null>;
}

export type AnyProvider =
  | AIProvider | RenderProvider | SocialPublisherProvider | WorkflowProvider | NotificationProvider | MenuSourceProvider | MetricsProvider;
