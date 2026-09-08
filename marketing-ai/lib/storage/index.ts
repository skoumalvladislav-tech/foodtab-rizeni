/**
 * StorageProvider — kam se ukládají soubory.
 *
 * Cesty jsou bezpečné a založené na ID:
 *   organizations/{org}/venues/{venue}/media/{yyyy}/{mm}/{assetId}/{filename}
 *   organizations/{org}/shared/media/{assetId}/{filename}
 *
 * Soubory se nikdy nepodávají přímo — vždy přes podepsanou adresu
 * s omezenou platností (lib/storage/podpis.ts).
 */
import path from "node:path";

export interface StorageProvider {
  key: "local" | "supabase";
  put(storagePath: string, data: Uint8Array, mime: string): Promise<void>;
  get(storagePath: string): Promise<Uint8Array | null>;
  remove(storagePath: string): Promise<void>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "soubor";
}

export function assertSafePath(storagePath: string): void {
  if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) {
    throw new Error("Neplatná cesta k souboru");
  }
  for (const seg of storagePath.split("/")) {
    if (!SAFE_SEGMENT.test(seg)) throw new Error("Neplatná cesta k souboru");
  }
}

export function mediaPath(opts: { organizationId: string; venueId: string | null; assetId: string; filename: string; date?: Date }): string {
  const d = opts.date ?? new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const file = sanitizeFilename(opts.filename);
  const p = opts.venueId
    ? `organizations/${opts.organizationId}/venues/${opts.venueId}/media/${yyyy}/${mm}/${opts.assetId}/${file}`
    : `organizations/${opts.organizationId}/shared/media/${opts.assetId}/${file}`;
  assertSafePath(p);
  return p;
}

let provider: StorageProvider | null = null;

export async function getStorage(): Promise<StorageProvider> {
  if (provider) return provider;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createSupabaseStorage } = await import("./supabase.ts");
    provider = createSupabaseStorage();
  } else {
    const { createLocalStorage } = await import("./local.ts");
    provider = createLocalStorage(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data", "storage"));
  }
  return provider;
}
