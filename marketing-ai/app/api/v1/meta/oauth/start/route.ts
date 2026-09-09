import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { metaOauthUrl } from "@/lib/providers/social/meta";
import { hmacHex, appSecret, randomToken } from "@/lib/utils/hash";

/**
 * Zahájení OAuth u Meta. `state` = náhodný nonce + podpis vázaný na
 * připojení; drží se v httpOnly cookie a ověřuje v callbacku (CSRF
 * a záměna účtu). Bez META_APP_ID se vysvětlí, co chybí.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/prihlaseni?kam=%2Fnastaveni%2Fintegrace", req.url));
  const connectionId = req.nextUrl.searchParams.get("connection") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.redirect(new URL("/nastaveni/integrace?chyba=Chyb%C3%AD+p%C5%99ipojen%C3%AD", req.url));
  const ok = await withUser(s.userId, async (tx) => {
    const c = await tx.one<{ organization_id: string }>("select organization_id from marketing.integration_connections where id = $1 and provider_key = 'meta_graph'", [connectionId]);
    if (!c) return false;
    const r = await tx.one<{ ok: boolean }>("select marketing.has_access($1, 'integrations.manage', null) as ok", [c.organization_id]);
    return r?.ok === true;
  });
  if (!ok) return NextResponse.redirect(new URL("/nastaveni/integrace?chyba=Nem%C3%A1te+opr%C3%A1vn%C4%9Bn%C3%AD", req.url));
  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) {
    return NextResponse.redirect(new URL(`/nastaveni/integrace?pozor=${encodeURIComponent("Meta aplikace není nastavená: doplňte META_APP_ID a META_APP_SECRET (viz docs/META_SETUP.md). Do té doby zůstává ruční publikace.")}#social_publishing`, req.url));
  }
  const nonce = randomToken(16);
  const state = `${connectionId}.${nonce}.${hmacHex(appSecret(), `${connectionId}.${nonce}.${s.userId}`)}`;
  const store = await cookies();
  store.set("ftm_meta_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/v1/meta/oauth", maxAge: 600 });
  const redirectUri = `${(process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "")}/api/v1/meta/oauth/callback`;
  return NextResponse.redirect(metaOauthUrl({ appId, redirectUri, state }));
}
