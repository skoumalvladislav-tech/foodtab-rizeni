/**
 * Poruchové stavy, které se nedají vyzkoušet proti databázi, protože se
 * dějí v adaptéru: co Meta vrátí, když token vypršel, a jak dlouho se
 * čeká mezi pokusy.
 *
 * Síť se tu nepoužívá — `fetch` je nahrazený a vrací přesně to, co
 * vrací Graph API. Kontroly proto platí i tam, kde je internet zavřený.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { odstupPokusu } from "../../lib/domena/fronta.ts";
import { META, createMetaPublisher, metaOauthUrl } from "../../lib/providers/social/meta.ts";
import type { ProviderContext } from "../../lib/providers/types.ts";

const puvodniFetch = globalThis.fetch;
after(() => { globalThis.fetch = puvodniFetch; });

function odpovidejChybou(message: string, code: number, status = 400) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message, code, type: "OAuthException" } }), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function ctx(credentials: Record<string, string>): ProviderContext {
  return { organizationId: "o", venueId: "v", connectionId: "c", mode: "customer_managed", credentials, externalAccount: {} };
}

test("bez tokenu Meta nenabízí žádnou schopnost a řekne to česky", async () => {
  const p = createMetaPublisher(ctx({}));
  assert.deepEqual(p.capabilities, [], "bez tokenu se nesmí tvářit, že umí publikovat");
  const t = await p.testConnection();
  assert.equal(t.ok, false);
  assert.match(t.message, /nejsou připojené/i);
});

test("vypršelý token: test spojení selže a nevydá se za úspěch", async () => {
  odpovidejChybou("Error validating access token: Session has expired on Saturday.", 190);
  const p = createMetaPublisher(ctx({ access_token: "vyprsely" }));
  const t = await p.testConnection();
  assert.equal(t.ok, false);
  assert.match(t.message, /Meta:/);
  assert.match(t.message, /expired|token/i);
});

test("vypršelý token při publikaci = selhání s pokynem, ne opakování donekonečna", async () => {
  odpovidejChybou("Error validating access token", 190);
  const p = createMetaPublisher(ctx({ access_token: "vyprsely" }));
  const r = await p.publish({
    jobId: "j", idempotencyKey: "i", channel: "instagram", format: "feed",
    account: { externalId: "17841400000000000", kind: "ig_business", name: "Test" },
    caption: "Ahoj", media: [{ url: "https://priklad.cz/a.jpg", mime: "image/jpeg", kind: "image" }], scheduledFor: new Date(),
  });
  assert.equal(r.status, "failed");
  assert.match(r.error ?? "", /190/);
  assert.match(r.error ?? "", /Připojte účet znovu/);
});

test("překročený limit Meta se má zopakovat později, ne zahodit", async () => {
  odpovidejChybou("Application request limit reached", 4, 429);
  const p = createMetaPublisher(ctx({ access_token: "platny" }));
  const r = await p.publish({
    jobId: "j", idempotencyKey: "i", channel: "instagram", format: "feed",
    account: { externalId: "17841400000000000", kind: "ig_business", name: "Test" },
    caption: "Ahoj", media: [{ url: "https://priklad.cz/a.jpg", mime: "image/jpeg", kind: "image" }], scheduledFor: new Date(),
  });
  assert.equal(r.status, "retry");
  assert.equal(r.retryAfterSeconds, 900);
});

test("publikace bez připojeného účtu se nepokouší nic odeslat", async () => {
  globalThis.fetch = (async () => { throw new Error("sem se nemá dojít"); }) as typeof fetch;
  const p = createMetaPublisher(ctx({ access_token: "platny" }));
  const r = await p.publish({
    jobId: "j", idempotencyKey: "i", channel: "instagram", format: "feed", account: null,
    caption: "Ahoj", media: [], scheduledFor: new Date(),
  });
  assert.equal(r.status, "failed");
  assert.match(r.error ?? "", /účet/);
});

test("odstup mezi pokusy roste a zastaví se na 30 minutách", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(odstupPokusu), [60, 120, 240, 480, 960, 1800, 1800]);
  assert.equal(odstupPokusu(0), 60, "nultý pokus nesmí dát nulový odstup");
});

test("přihlašovací adresa Meta nese state proti podvrhu a všechna oprávnění", () => {
  const u = metaOauthUrl({ appId: "123", redirectUri: "https://priklad.cz/zpet", state: "nahodny-stav" });
  assert.match(u, /^https:\/\/www\.facebook\.com\/v\d+\.\d+\/dialog\/oauth\?/);
  assert.match(u, /state=nahodny-stav/);
  assert.equal(new URL(u).searchParams.get("scope"), META.scopes.join(","));
  assert.ok(META.scopes.includes("instagram_content_publish"), "bez tohoto oprávnění se na Instagram publikovat nedá");
});
