import assert from "node:assert/strict";
import { test } from "node:test";

import { rozpoznatMenuZTextu, rozpoznatPolozku } from "../../lib/domena/menu-text.ts";
import { AiNavrhSchema, AiZadaniSchema } from "../../lib/providers/ai/schema.ts";
import { prepracovat, sestavitNavrh } from "../../lib/providers/ai/mock.ts";
import { SABLONY, inputJsonSchema } from "../../lib/sablony/katalog.ts";
import { FORMATY } from "../../lib/formaty.ts";
import { vykreslit } from "../../lib/render/svg-sablony.ts";

test("menu z textu: týdenní s dny, ceny v různých zápisech, alergeny", () => {
  const r = rozpoznatMenuZTextu(`Týdenní menu 14. 9. – 18. 9. 2026
Pondělí 14. 9.
Polévka
Kulajda 49 Kč (1,3,7)
Hlavní jídla
Vepřová pečeně, zelí, knedlík 159,-
Úterý 15. 9.
Gulášová polévka 45 Kč
Kuřecí steak s rýží – grilovaná zelenina 169 Kč (7)`);
  assert.equal(r.kind, "weekly");
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].day_date, "2026-09-14");
  assert.equal(r.days[0].items[0].category, "polevka");
  assert.equal(r.days[0].items[1].price_cents, 15900);
  assert.equal(r.days[1].items[1].description, "grilovaná zelenina");
  assert.deepEqual(r.days[1].items[1].allergens, ["7"]);
});

test("menu z textu: chybějící cena a otazník → vyžaduje kontrolu, nic se nedomýšlí", () => {
  const p = rozpoznatPolozku("Dezert dne ?", "dezert");
  assert.equal(p.price_cents, null);
  assert.equal(p.needs_review, true);
  const q = rozpoznatPolozku("Řízek s kaší", "hlavni");
  assert.equal(q.price_cents, null);
  assert.equal(q.review_reason, "Nerozpoznaná cena");
});

test("rok v názvu menu není cena", () => {
  const r = rozpoznatMenuZTextu("Denní menu 9. 9. 2026\nVývar 45 Kč");
  assert.equal(r.title, "Denní menu 9. 9. 2026");
  assert.equal(r.valid_from, "2026-09-09");
  assert.equal(r.items.length, 1);
});

const zadani = AiZadaniSchema.parse({
  brief: "Dnešní menu", ucel: "denni_menu", sablonaKey: "denni_menu", kanaly: ["instagram", "facebook"],
  brand: { nazev: "Černá Perla", cta: ["Přijďte ochutnat"], zakazaneVyrazy: ["nejlepší na světě"], hashtagy: ["#cernaperla"], podpis: "Černá Perla" },
  fakta: { menuNazev: "Denní menu", platnostOd: "2026-09-09", platnostDo: "2026-09-09", polozky: [{ kategorie: "hlavni", nazev: "Svíčková", cenaKc: 189 }, { kategorie: "dezert", nazev: "Palačinka", cenaKc: null }] },
  media: [{ id: "m1", druh: "image", jeHero: true }, { id: "m2", druh: "image" }],
});

test("mock návrh prochází schématem, nese fakta a nedomýšlí chybějící cenu", () => {
  const n = AiNavrhSchema.parse(sestavitNavrh(zadani));
  assert.equal(n.varianty.length, 3);
  assert.ok(n.varianty[0].instagram.popisek.includes("189 Kč"));
  assert.ok(!n.varianty[0].instagram.popisek.includes("Palačinka – "), "položka bez ceny nedostane cenu");
  assert.ok(n.kontrolaFaktu.chybi.some((c) => c.includes("cena")));
  assert.equal(n.varianty[0].titulniFotoAssetId, "m1");
  assert.ok(n.varianty[0].instagram.hashtagy.every((h) => /^#\S+$/.test(h)));
});

test("zakázané výrazy se do textu nedostanou", () => {
  const z = { ...zadani, brief: "Máme nejlepší na světě svíčkovou" };
  const n = sestavitNavrh(z);
  assert.ok(!JSON.stringify(n.varianty).includes("nejlepší na světě"));
});

test("přepracování mění jen dotčenou část", () => {
  const n = sestavitNavrh(zadani);
  const p = prepracovat(zadani, n, { typ: "zkratit", text: "", cast: "caption:instagram", variantaKlic: "vecna" });
  const a = p.varianty.find((v) => v.klic === "vecna")!;
  const b = n.varianty.find((v) => v.klic === "vecna")!;
  assert.ok(a.instagram.popisek.length <= b.instagram.popisek.length);
  assert.equal(a.facebook.popisek, b.facebook.popisek, "Facebook text zůstal");
  assert.deepEqual(p.varianty.find((v) => v.klic === "prijemna"), n.varianty.find((v) => v.klic === "prijemna"), "jiná varianta beze změny");
});

test("katalog šablon: klíče unikátní, formáty existují, JSON schema platné", () => {
  const keys = new Set(SABLONY.map((s) => s.key));
  assert.equal(keys.size, SABLONY.length);
  for (const s of SABLONY) {
    for (const f of s.formats) assert.ok(f in FORMATY, `${s.key}: neznámý formát ${f}`);
    const js = inputJsonSchema(s) as { required: string[]; properties: Record<string, unknown> };
    for (const r of js.required) assert.ok(r in js.properties, `${s.key}: required ${r} chybí`);
    assert.equal(s.textRules.noTruncation, true);
  }
  assert.ok(SABLONY.filter((s) => s.category === "menu").length >= 10);
  assert.ok(SABLONY.filter((s) => s.category === "akce").length >= 19);
  assert.ok(SABLONY.filter((s) => s.category === "prubezne").length >= 12);
});

test("render Story: text mimo bezpečné zóny (nahoře 14 %, dole 20 %)", () => {
  const out = vykreslit({
    jobId: "t", formatKey: "instagram_story", width: 1080, height: 1920, kind: "image",
    template: { key: "vyprodano", layout: { style: "alert" }, textRules: {} }, inputs: {}, brand: { signature: "X" },
    texts: { headline: "Vyprodáno", body: "Svíčková došla, díky!" }, media: [],
  });
  const ys = [...out.svg.matchAll(/<text[^>]* y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ys.length > 0);
  assert.ok(ys.every((y) => y > 1920 * 0.14 && y <= 1920 * 0.8 + 1), `text v bezpečné zóně: ${ys.join(",")}`);
});
