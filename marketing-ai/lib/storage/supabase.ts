import { assertSafePath, type StorageProvider } from "./index.ts";

/**
 * Supabase Storage přes REST — SERVISNÍ klíč, proto výhradně na serveru.
 * Prohlížeč soubory dostává jen přes podepsané adresy aplikace.
 */
export function createSupabaseStorage(): StorageProvider {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "marketing-media";
  const headers = { Authorization: `Bearer ${key}`, apikey: key };

  return {
    key: "supabase",
    async put(storagePath, data, mime) {
      assertSafePath(storagePath);
      const res = await fetch(`${base}/storage/v1/object/${bucket}/${storagePath}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": mime, "x-upsert": "true" },
        body: data,
      });
      if (!res.ok) throw new Error(`Supabase Storage: nahrání selhalo (${res.status})`);
    },
    async get(storagePath) {
      assertSafePath(storagePath);
      const res = await fetch(`${base}/storage/v1/object/${bucket}/${storagePath}`, { headers });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(storagePath) {
      assertSafePath(storagePath);
      await fetch(`${base}/storage/v1/object/${bucket}/${storagePath}`, { method: "DELETE", headers });
    },
  };
}
