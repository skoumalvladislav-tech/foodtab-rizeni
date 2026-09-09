/**
 * Stavový model obsahu — jedno místo pro názvy, tóny a povolené přechody.
 *
 * Databáze (spouště v migraci obsah.sql) hlídá to podstatné: schválení
 * jen přes žádost, plánování a publikaci jen se schválenou verzí. Tenhle
 * soubor doplňuje, co rozhraní smí nabídnout — a s databází se shoduje.
 */
export type StavObsahu =
  | "idea" | "draft" | "generating" | "preview_ready" | "changes_requested" | "awaiting_approval"
  | "approved" | "scheduled" | "publishing" | "published"
  | "generation_failed" | "render_failed" | "publish_failed" | "connection_required" | "cancelled" | "archived";

export const STAVY_OBSAHU: Record<string, { label: string; tone: "" | "dobre" | "pozor" | "bad" | "info" | "mosaz" }> = {
  idea: { label: "Nápad", tone: "" },
  draft: { label: "Koncept", tone: "" },
  generating: { label: "Generuje se", tone: "info" },
  preview_ready: { label: "Náhled připraven", tone: "info" },
  changes_requested: { label: "Vráceno k úpravě", tone: "pozor" },
  awaiting_approval: { label: "Čeká na schválení", tone: "pozor" },
  approved: { label: "Schváleno", tone: "dobre" },
  scheduled: { label: "Naplánováno", tone: "dobre" },
  publishing: { label: "Zveřejňuje se", tone: "info" },
  published: { label: "Zveřejněno", tone: "dobre" },
  generation_failed: { label: "Generování selhalo", tone: "bad" },
  render_failed: { label: "Render selhal", tone: "bad" },
  publish_failed: { label: "Publikace selhala", tone: "bad" },
  connection_required: { label: "Chybí připojení", tone: "bad" },
  cancelled: { label: "Zrušeno", tone: "" },
  archived: { label: "Archivováno", tone: "" },
};

export const PRECHODY: Record<StavObsahu, StavObsahu[]> = {
  idea: ["draft", "archived"],
  draft: ["generating", "preview_ready", "awaiting_approval", "archived", "cancelled"],
  generating: ["preview_ready", "generation_failed", "draft"],
  preview_ready: ["draft", "awaiting_approval", "archived", "cancelled"],
  changes_requested: ["draft", "awaiting_approval", "archived"],
  awaiting_approval: ["approved", "changes_requested", "draft", "cancelled"],
  approved: ["scheduled", "publishing", "draft", "archived"],
  scheduled: ["publishing", "approved", "cancelled", "draft"],
  publishing: ["published", "publish_failed", "connection_required"],
  published: ["archived"],
  generation_failed: ["draft", "generating", "archived"],
  render_failed: ["draft", "preview_ready", "archived"],
  publish_failed: ["approved", "scheduled", "publishing", "draft", "archived"],
  connection_required: ["scheduled", "publishing", "draft", "archived"],
  cancelled: ["draft", "archived"],
  archived: [],
};

export function jePovolenyPrechod(z: StavObsahu, na: StavObsahu): boolean {
  return z === na || (PRECHODY[z] ?? []).includes(na);
}

export const STAVY_PUBLIKACE: Record<string, { label: string; tone: "" | "dobre" | "pozor" | "bad" | "info" | "mock" }> = {
  scheduled: { label: "Naplánováno", tone: "info" },
  queued: { label: "Ve frontě", tone: "info" },
  publishing: { label: "Zveřejňuje se", tone: "info" },
  published: { label: "Zveřejněno", tone: "dobre" },
  published_mock: { label: "published_mock (demo)", tone: "mock" },
  manual_export: { label: "K ručnímu zveřejnění", tone: "pozor" },
  failed: { label: "Selhalo", tone: "bad" },
  dead_letter: { label: "Vyčerpány pokusy", tone: "bad" },
  cancelled: { label: "Zrušeno", tone: "" },
};

export const STAVY_RENDERU: Record<string, { label: string; tone: "" | "dobre" | "pozor" | "bad" | "info" }> = {
  queued: { label: "Ve frontě", tone: "info" },
  submitted: { label: "Odesláno", tone: "info" },
  rendering: { label: "Renderuje se", tone: "info" },
  done: { label: "Hotovo", tone: "dobre" },
  failed: { label: "Selhalo", tone: "bad" },
  cancelled: { label: "Zrušeno", tone: "" },
};
