import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { encryptCredentials } from "@/lib/providers/credentials";
import { createMetaPublisher, metaExchangeCode } from "@/lib/providers/social/meta";
import { appSecret, hmacHex, safeEqual } from "@/lib/utils/hash";

/**
 * Návrat z Meta: ověří state, vymění kód za dlouhodobý token, uloží ho
 * šifrovaně, načte stránky a IG účty a pošle uživatele na výběr účtů.
 * Token nikdy neopustí server.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/prihlaseni?kam=%2Fnastaveni%2Fintegrace", req.url));
  const q = req.nextUrl.searchParams;
  const store = await cookies();
  const cookieState = store.get("ftm_meta_state")?.value ?? "";
  store.delete("ftm_meta_state");
  const state = q.get("state") ?? "";
  const zpet = (msg: string, typ: "chyba" | "ok" | "pozor" = "chyba") => NextResponse.redirect(new URL(`/nastaveni/integrace?${typ}=${encodeURIComponent(msg)}#social_publishing`, req.url));
  if (!state || !cookieState || !safeEqual(state, cookieState)) return zpet("Ověření OAuth (state) selhalo — zkuste připojení znovu.");
  const [connectionId, nonce, sig] = state.split(".");
  if (!safeEqual(sig ?? "", hmacHex(appSecret(), `${connectionId}.${nonce}.${s.userId}`))) return zpet("Ověření OAuth selhalo (podpis).");
  if (q.get("error")) return zpet(`Meta odmítlo přihlášení: ${q.get("error_description") ?? q.get("error")}`);
  const code = q.get("code");
  if (!code) return zpet("Chybí kód od Meta.");

  try {
    const redirectUri = `${(process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "")}/api/v1/meta/oauth/callback`;
    const tok = await metaExchangeCode({ appId: process.env.META_APP_ID!, appSecret: process.env.META_APP_SECRET!, redirectUri, code });
    const publisher = createMetaPublisher({ organizationId: "", venueId: null, connectionId, mode: "customer_managed", credentials: { access_token: tok.accessToken }, externalAccount: {} });
    const test = await publisher.testConnection();
    if (!test.ok) return zpet(`Token získán, ale test selhal: ${test.message}`);
    const accounts = await publisher.listAccounts();
    // Page tokeny pro publikaci na Page — bezpečně uvnitř credentials
    const pagesRaw = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v21.0"}/me/accounts?fields=id,access_token&access_token=${encodeURIComponent(tok.accessToken)}`).then((r) => r.json()) as { data?: { id: string; access_token: string }[] };
    const pageTokens = Object.fromEntries((pagesRaw.data ?? []).map((p) => [p.id, p.access_token]));
    const { ciphertext, fingerprint } = encryptCredentials({ access_token: tok.accessToken, page_tokens: JSON.stringify(pageTokens) });
    await withUser(s.userId, async (tx) => {
      await tx.q("select marketing.store_secret($1, $2, $3)", [connectionId, ciphertext, fingerprint]);
      await tx.q(
        `update marketing.integration_connections set mode = 'customer_managed', status = 'connecting', display_name = $2, external_account = $3, granted_scopes = $4, expires_at = $5, connected_by = $6, last_test_at = now(), last_test_ok = true, last_error = null where id = $1`,
        [connectionId, `Meta: ${String(test.externalAccount?.user_name ?? "")}`, JSON.stringify({ ...test.externalAccount, accounts: accounts.map((a) => ({ platform: a.platform, kind: a.kind, externalId: a.externalId, name: a.name, username: a.username })) }),
          test.grantedScopes ?? [], tok.expiresIn ? new Date(Date.now() + tok.expiresIn * 1000).toISOString() : (test.expiresAt ?? null), s.userId]);
    });
  } catch (e) {
    return zpet(`Připojení selhalo: ${e instanceof Error ? e.message : "chyba"}`);
  }
  return NextResponse.redirect(new URL(`/nastaveni/integrace/meta/${connectionId}`, req.url));
}
