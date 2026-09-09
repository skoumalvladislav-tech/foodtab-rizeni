import assert from "node:assert/strict";
import { test } from "node:test";

import { bezpecnyCil, jePovolenyNavrat, odkazDoFoodtabu } from "../../lib/auth/kam.ts";
import { decryptCredentials, encryptCredentials, maskovat } from "../../lib/providers/credentials.ts";
import { overitPodpisWebhooku } from "../../lib/providers/workflow.ts";
import { overitPodpis, podepsatSoubor } from "../../lib/storage/podpis.ts";
import { assertSafePath, mediaPath, sanitizeFilename } from "../../lib/storage/index.ts";
import { canonicalJson, hmacHex } from "../../lib/utils/hash.ts";

process.env.APP_MODE = "demo";
process.env.FOODTAB_APP_URL = "https://foodtab-rizeni.vercel.app";

test("návrat po přihlášení: jen relativní cesta, žádný open redirect", () => {
  assert.equal(bezpecnyCil("/cerna-perla/prehled"), "/cerna-perla/prehled");
  assert.equal(bezpecnyCil("https://cizi.web/"), "/");
  assert.equal(bezpecnyCil("//cizi.web"), "/");
  assert.equal(bezpecnyCil("/\\cizi.web"), "/");
  assert.equal(bezpecnyCil("/prihlaseni?kam=/x"), "/", "smyčka na přihlášení se odmítá");
  assert.equal(bezpecnyCil("/api/v1/x"), "/");
  assert.equal(bezpecnyCil(null), "/");
});

test("odkaz do FoodTabu jen na povolený origin", () => {
  assert.equal(odkazDoFoodtabu("/firma"), "https://foodtab-rizeni.vercel.app/firma");
  assert.equal(odkazDoFoodtabu("https://utocnik.cz/firma"), "https://foodtab-rizeni.vercel.app/firma");
  assert.equal(jePovolenyNavrat("https://foodtab-rizeni.vercel.app/x"), true);
  assert.equal(jePovolenyNavrat("https://foodtab-rizeni.vercel.app.utocnik.cz/x"), false);
});

test("šifrování credentials: dešifruje se, otisk neprozradí klíč, cizí ciphertext neprojde", () => {
  const { ciphertext, fingerprint } = encryptCredentials({ api_key: "sk-test-123456789" });
  assert.notEqual(ciphertext.includes("sk-test"), true);
  assert.equal(fingerprint.length, 16);
  assert.deepEqual(decryptCredentials(ciphertext), { api_key: "sk-test-123456789" });
  assert.throws(() => decryptCredentials(ciphertext.slice(0, -4) + "AAAA"));
  assert.equal(maskovat("sk-test-123456789"), "…6789");
});

test("podepsaná adresa souboru: platná, prošlá, upravená", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const url = podepsatSoubor(id, 60, new Date("2026-09-09T10:00:00Z"));
  const u = new URL("http://x" + url);
  assert.equal(overitPodpis(id, u.searchParams.get("exp"), u.searchParams.get("sig"), new Date("2026-09-09T10:00:30Z")), true);
  assert.equal(overitPodpis(id, u.searchParams.get("exp"), u.searchParams.get("sig"), new Date("2026-09-09T10:02:00Z")), false, "prošlá");
  assert.equal(overitPodpis(id, String(Number(u.searchParams.get("exp")) + 9999), u.searchParams.get("sig")), false, "prodloužená");
  assert.equal(overitPodpis("22222222-2222-4222-8222-222222222222", u.searchParams.get("exp"), u.searchParams.get("sig"), new Date("2026-09-09T10:00:30Z")), false, "jiné ID");
});

test("podpis webhooku: správný, špatný, replay po 5 minutách", () => {
  const body = JSON.stringify({ type: "queue.process" });
  const ts = "1700000000";
  const sig = hmacHex("tajne", `${ts}.${body}`);
  const now = 1700000000 * 1000 + 60_000;
  assert.equal(overitPodpisWebhooku("tajne", ts, sig, body, now), true);
  assert.equal(overitPodpisWebhooku("jine", ts, sig, body, now), false);
  assert.equal(overitPodpisWebhooku("tajne", ts, sig, body + " ", now), false);
  assert.equal(overitPodpisWebhooku("tajne", ts, sig, body, now + 6 * 60_000), false, "replay");
});

test("cesty v úložišti: bez ../ a jen bezpečné znaky", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("Svíčková na smetaně.JPG"), "Svickova-na-smetane.JPG");
  assert.throws(() => assertSafePath("organizations/../x"));
  const p = mediaPath({ organizationId: "o", venueId: "v", assetId: "a", filename: "x y.png", date: new Date("2026-09-09T00:00:00Z") });
  assert.equal(p, "organizations/o/venues/v/media/2026/09/a/x-y.png");
  assert.equal(mediaPath({ organizationId: "o", venueId: null, assetId: "a", filename: "l.svg" }), "organizations/o/shared/media/a/l.svg");
});

test("kanonický JSON: pořadí klíčů nemění otisk", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }), canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
});
