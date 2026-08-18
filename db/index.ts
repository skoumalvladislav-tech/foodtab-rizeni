import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const binding = getRawDb();
  return drizzle(binding, { schema });
}

export function getRawDb() {
  const binding = (globalThis as typeof globalThis & { __FOODTAB_DB__?: D1Database }).__FOODTAB_DB__;
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return binding;
}
