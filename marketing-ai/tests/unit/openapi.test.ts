import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STAVY_OBSAHU } from "../../lib/domena/stavy.ts";

/**
 * Kontrola smlouvy openapi/openapi.yaml.
 *
 * Balík `yaml` v projektu není. Proto se soubor kontroluje dvěma
 * způsoby a jeden nenahrazuje druhý:
 *
 *  1. Hrubě, bez parseru — odsazení, seznam cest, cíle odkazů $ref.
 *     Běží vždycky. Nezjistí, jestli je YAML platný, jen jestli je
 *     v něm to, co tam být má.
 *  2. Parserem, když je nějaký po ruce (`js-yaml` má v node_modules
 *     eslint). Tahle část se přeskočí, když parser chybí — a když se
 *     přeskočí, je to v běhu vidět, ne schované.
 *
 * Kontroly míří na to, co se rozbije potichu: přejmenovaná cesta,
 * odkaz na schéma, které nikdo nedopsal, a stavový výčet, který se
 * rozejde s `lib/domena/stavy.ts`.
 */

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CESTA = join(KOREN, "openapi", "openapi.yaml");
const text = readFileSync(CESTA, "utf8");
const radky = text.split("\n");

/** Cesty, které smlouva musí popisovat. Ručně, aby se výpadek poznal. */
const CESTY = [
  "/api/v1/health",
  "/api/v1/ulohy/zpracovat",
  "/api/v1/media",
  "/api/v1/media/{id}/soubor",
  "/api/v1/menu",
  "/api/v1/menu/import",
  "/api/v1/menu/{id}/potvrdit",
  "/api/v1/obsah",
  "/api/v1/obsah/{id}",
  "/api/v1/obsah/{id}/navrh",
  "/api/v1/obsah/{id}/prepracovat",
  "/api/v1/obsah/{id}/verze",
  "/api/v1/obsah/{id}/schvaleni",
  "/api/v1/schvaleni/{id}/rozhodnout",
  "/api/v1/obsah/{id}/render",
  "/api/v1/obsah/{id}/naplanovat",
  "/api/v1/publikace",
  "/api/v1/publikace/{id}/zopakovat",
  "/api/v1/providery/katalog",
  "/api/v1/providery/volba",
  "/api/v1/integrace",
  "/api/v1/integrace/{id}/test",
  "/api/v1/integrace/{id}",
  "/api/v1/integrace/test-vse",
  "/api/v1/meta/oauth/start",
  "/api/v1/meta/oauth/callback",
  "/api/v1/webhooky/{zdroj}",
  "/api/v1/analytika",
  "/api/v1/analytika/synchronizovat",
];

const SCHEMATA = [
  "ContentItem",
  "ContentVersion",
  "ApprovalRequest",
  "ApprovalDecision",
  "PublishJob",
  "RenderJob",
  "MediaAsset",
  "Menu",
  "MenuItem",
  "ProviderCatalogEntry",
  "IntegrationConnection",
  "WebhookEvent",
  "FoodtabMenuEvent",
  "Chyba",
];

/** Řádky jedné pojmenované položky na daném odsazení, až po další položku téže úrovně. */
function usek(zacatek: string, odsazeni: number): string[] {
  const uvod = " ".repeat(odsazeni) + zacatek;
  const od = radky.findIndex((r) => r === uvod);
  if (od < 0) return [];
  const out: string[] = [];
  for (let i = od + 1; i < radky.length; i++) {
    const r = radky[i];
    if (r.trim() === "") continue;
    const uroven = r.length - r.trimStart().length;
    if (uroven <= odsazeni) break;
    out.push(r);
  }
  return out;
}

test("openapi.yaml existuje a hlásí se k OpenAPI 3.1", () => {
  assert.ok(text.length > 0, "soubor je prázdný");
  assert.match(radky[0], /^openapi: 3\.1\.\d+$/, `první řádek má být „openapi: 3.1.x“, je „${radky[0]}“`);
});

test("odsazení je všude sudé (hrubá kontrola čitelnosti YAML)", () => {
  const spatne: string[] = [];
  for (const [i, r] of radky.entries()) {
    if (!r.includes(":")) continue;
    if (r.trim() === "") continue;
    const odsazeni = r.length - r.trimStart().length;
    if (odsazeni % 2 !== 0) spatne.push(`${i + 1}: ${r}`);
  }
  assert.deepEqual(spatne, [], `liché odsazení na řádcích:\n${spatne.join("\n")}`);
});

test("žádný řádek nemá tabulátor (YAML je zakazuje)", () => {
  const spatne = radky.map((r, i) => (r.includes("\t") ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(spatne, [], `tabulátory na řádcích ${spatne.join(", ")}`);
});

test("smlouva popisuje všechny domluvené cesty", () => {
  const chybi = CESTY.filter((c) => !radky.includes(`  ${c}:`));
  assert.deepEqual(chybi, [], `ve smlouvě chybí cesty: ${chybi.join(", ")}`);
});

test("každá cesta má aspoň jednu operaci", () => {
  const bezOperace = CESTY.filter((c) => {
    const telo = usek(`${c}:`, 2);
    return !telo.some((r) => /^    (get|post|put|patch|delete):$/.test(r));
  });
  assert.deepEqual(bezOperace, [], `cesty bez operace: ${bezOperace.join(", ")}`);
});

test("smlouva má všechna domluvená schémata", () => {
  const chybi = SCHEMATA.filter((s) => !radky.includes(`    ${s}:`));
  assert.deepEqual(chybi, [], `chybí schémata: ${chybi.join(", ")}`);
});

test("smlouva má tři způsoby ověření", () => {
  for (const s of ["cookieSession", "cronSecret", "webhookHmac"]) {
    assert.ok(radky.includes(`    ${s}:`), `chybí securityScheme ${s}`);
  }
  assert.ok(text.includes("X-Cron-Secret"), "cronSecret nemá hlavičku X-Cron-Secret");
  assert.ok(text.includes("X-FoodTab-Signature"), "webhookHmac nemá hlavičku X-FoodTab-Signature");
  assert.ok(text.includes("ftm_demo"), "cookieSession nezmiňuje cookie ftm_demo");
});

test("každý odkaz $ref míří na komponentu, která ve smlouvě je", () => {
  const rozbite = new Set<string>();
  for (const m of text.matchAll(/#\/components\/(schemas|responses|parameters)\/([A-Za-z0-9_]+)/g)) {
    if (!radky.includes(`    ${m[2]}:`)) rozbite.add(m[0]);
  }
  assert.deepEqual([...rozbite], [], `odkazy do prázdna: ${[...rozbite].join(", ")}`);
});

test("stav obsahu ve smlouvě se shoduje s lib/domena/stavy.ts", () => {
  const telo = usek("ContentItem:", 4);
  const odStatusu = telo.slice(telo.findIndex((r) => r === "        status:"));
  const zStavu: string[] = [];
  for (const r of odStatusu.slice(1)) {
    if (/^ {8}\S/.test(r)) break;
    const m = r.match(/^ {12}- (.+)$/);
    if (m) zStavu.push(m[1]);
  }
  assert.deepEqual(zStavu.sort(), Object.keys(STAVY_OBSAHU).sort(), "výčet stavů obsahu se rozešel se stavovým modelem");
});

test("cesty volané z n8n jsou implementované a popis to říká; jen-smlouva cesty to říkají také", () => {
  // Tyhle tři volají workflow v n8n a v aplikaci existují (app/api/v1/…).
  const implementovane = ["/api/v1/obsah/{id}/navrh", "/api/v1/analytika/synchronizovat", "/api/v1/integrace/test-vse"];
  for (const c of implementovane) {
    const telo = usek(`${c}:`, 2).join("\n");
    assert.ok(telo.includes("Implementováno v aplikaci"), `${c} má být označená jako implementovaná`);
    assert.ok(!telo.includes("Smlouva; v aplikaci zatím"), `${c} už není jen smlouva`);
  }
  // Cesty, které obsluhuje jen obrazovka (server action), to musí přiznat.
  const jenSmlouva = ["/api/v1/menu/import", "/api/v1/obsah/{id}/verze", "/api/v1/obsah/{id}/schvaleni"];
  for (const c of jenSmlouva) {
    const telo = usek(`${c}:`, 2).join("\n");
    assert.ok(telo.includes("Smlouva; v aplikaci zatím dostupné jen přes obrazovku (server action)"), `${c} nemá poznámku, že jde zatím jen o smlouvu`);
  }
});

// ---------------------------------------------------------------------
// Kontrola parserem — jen když je nějaký po ruce.
// ---------------------------------------------------------------------

const require_ = createRequire(import.meta.url);
let yaml: { load: (s: string) => unknown } | null = null;
try {
  yaml = require_("js-yaml") as { load: (s: string) => unknown };
} catch {
  yaml = null;
}

test("YAML je platný a strom má očekávaný tvar", { skip: yaml ? false : "js-yaml není v node_modules — běží jen hrubé kontroly výš" }, () => {
  const d = yaml!.load(text) as {
    openapi: string;
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };
  assert.equal(d.openapi, "3.1.0");
  assert.deepEqual(Object.keys(d.paths).sort(), [...CESTY].sort());
  for (const s of SCHEMATA) assert.ok(s in d.components.schemas, `schéma ${s} chybí ve stromu`);
  assert.deepEqual(Object.keys(d.components.securitySchemes).sort(), ["cookieSession", "cronSecret", "webhookHmac"]);
});
