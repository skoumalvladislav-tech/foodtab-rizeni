import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "./auth/session.ts";
import { withUser } from "./db/index.ts";
import type { Tx } from "./db/driver.ts";
import { appSecret, safeEqual } from "./utils/hash.ts";

/**
 * Pomocníci pro API v1: přihlášení (cookie session) nebo servisní
 * hlavička pro cron. Chyby vracejí česky a bez tajemství.
 */
export class ApiChyba extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiUser<T>(fn: (tx: Tx, userId: string) => Promise<T>): Promise<NextResponse> {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });
  try {
    const data = await withUser(s.userId, (tx) => fn(tx, s.userId));
    return NextResponse.json(data);
  } catch (e) {
    return chyba(e);
  }
}

export function chyba(e: unknown): NextResponse {
  if (e instanceof ApiChyba) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : "Neznámá chyba";
  const status = /oprávnění|permission denied/i.test(msg) ? 403 : /nenalezen/i.test(msg) ? 404 : 400;
  return NextResponse.json({ error: msg }, { status });
}

/** Cron / interní volání: hlavička X-Cron-Secret = APP_SECRET (nebo CRON_SECRET). */
export function jeCron(req: NextRequest): boolean {
  const h = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = process.env.CRON_SECRET ?? appSecret();
  return Boolean(h) && safeEqual(h, expected);
}

export async function jsonBody<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiChyba(400, "Tělo požadavku není platný JSON.");
  }
}
