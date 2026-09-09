import "server-only";

import { cookies } from "next/headers";

import { DEMO_USERS, findDemoUser } from "../demo-ucty.ts";
import { appSecret, hmacHex, safeEqual } from "../utils/hash.ts";

/**
 * Přihlášení — dva režimy, jedno rozhraní.
 *
 *  - demo (APP_MODE=demo, výchozí bez Supabase): výběr demo účtu,
 *    podepsaná cookie. Nikdy v produkci.
 *  - supabase: e-mail + zaslaný kód (stejně jako FoodTab Řízení),
 *    cookie obnovuje proxy.ts.
 *
 * Session říká jen KDO. Co smí, rozhoduje databáze přes
 * marketing.has_access — viz lib/authz.ts.
 */
export interface Session {
  userId: string;
  email: string | null;
  name: string;
  mode: "demo" | "supabase";
}

export const DEMO_COOKIE = "ftm_demo";

export function isDemoMode(): boolean {
  if (process.env.APP_MODE === "production") return false;
  // Bez Supabase Auth není jiná možnost než demo.
  return process.env.APP_MODE === "demo" || !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function podepsatDemoCookie(userId: string, ttlSeconds = 60 * 60 * 24 * 7, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  return `${userId}.${exp}.${hmacHex(appSecret(), `${userId}.${exp}`)}`;
}

export function overitDemoCookie(value: string | undefined, now = new Date()): string | null {
  if (!value) return null;
  const [userId, exp, sig] = value.split(".");
  if (!userId || !exp || !sig) return null;
  if (Number(exp) < Math.floor(now.getTime() / 1000)) return null;
  if (!safeEqual(hmacHex(appSecret(), `${userId}.${exp}`), sig)) return null;
  return findDemoUser(userId) ? userId : null;
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  if (isDemoMode()) {
    const uid = overitDemoCookie(store.get(DEMO_COOKIE)?.value);
    if (!uid) return null;
    const u = DEMO_USERS.find((x) => x.id === uid)!;
    return { userId: u.id, email: u.email, name: u.name, mode: "demo" };
  }
  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Component cookie zapisovat nesmí; obnoví ji proxy.
        }
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    name: (data.user.user_metadata?.display_name as string | undefined) ?? data.user.email ?? "",
    mode: "supabase",
  };
}
