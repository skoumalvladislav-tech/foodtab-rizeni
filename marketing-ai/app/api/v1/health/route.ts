import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/** Integrační health check — bez tajemství, jen stav databáze a režim. */
export async function GET() {
  const start = Date.now();
  try {
    const db = await getDb();
    const r = await db.one<{ n: number }>("select count(*)::int as n from marketing.provider_catalog");
    return NextResponse.json({
      ok: true, mode: isDemoMode() ? "demo" : "production", database: db.kind, providers_in_catalog: r?.n ?? 0,
      storage: process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local", ms: Date.now() - start, version: "0.1.0",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "chyba" }, { status: 503 });
  }
}
