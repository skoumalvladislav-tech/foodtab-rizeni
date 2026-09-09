/**
 * Převod vykresleného SVG na obrázek, který sítě přijmou.
 *
 * Nejde jen o to, že soubor vznikne — prázdná plocha vznikne taky.
 * Kontroluje se, že se text opravdu vysázel, protože právě to v Lambdě
 * bez fontů tiše zmizí.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { rastrovat } from "../../lib/render/rastr.ts";

const POZADI = '<rect width="400" height="300" fill="#ffffff"/>';
const svg = (obsah: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">${POZADI}${obsah}</svg>`;
const TEXT = '<text x="20" y="120" font-family="Archivo, sans-serif" font-size="44" font-weight="700" fill="#1f1a2e">Příliš žluťoučký kůň</text>'
  + '<text x="20" y="200" font-family="Newsreader, serif" font-size="36" fill="#d8ab4e">Řízek 169 Kč</text>';

test("výstup je PNG v přesných rozměrech formátu", async () => {
  const r = await rastrovat(svg(TEXT), { width: 1080, height: 1350 });
  assert.equal(r.mime, "image/png");
  assert.equal(r.pripona, "png");
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1350);
  const hlavicka = [...r.bytes.slice(0, 8)];
  assert.deepEqual(hlavicka, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "chybí podpis PNG");
});

test("český text se opravdu vysází, nezmizí", async () => {
  const sTextem = await rastrovat(svg(TEXT), { width: 400, height: 300 });
  const bezTextu = await rastrovat(svg(""), { width: 400, height: 300 });
  assert.ok(sTextem.bytes.length > bezTextu.bytes.length * 1.5,
    `obrázek s textem má být výrazně větší než prázdný (${sTextem.bytes.length} vs ${bezTextu.bytes.length})`);
});

test("velký obrázek se uloží jako JPEG, ne jako obří PNG", async () => {
  // Fotografický šum se do PNG nezkomprimuje; strop se pro test sníží,
  // aby se nemusel skládat několikamegabajtový obrázek.
  const sum = Array.from({ length: 3000 }, (_, i) =>
    `<rect x="${(i * 37) % 400}" y="${(i * 53) % 300}" width="7" height="7" fill="#${((i * 2654435761) % 0xffffff).toString(16).padStart(6, "0")}"/>`).join("");
  const r = await rastrovat(svg(sum + TEXT), { width: 400, height: 300, stropPngBajtu: 1000 });
  assert.equal(r.mime, "image/jpeg");
  assert.equal(r.pripona, "jpg");
  assert.deepEqual([...r.bytes.slice(0, 3)], [0xff, 0xd8, 0xff], "chybí podpis JPEG");
});

test("malý obrázek pod stropem zůstane PNG (aby předchozí kontrola něco znamenala)", async () => {
  const r = await rastrovat(svg(TEXT), { width: 400, height: 300, stropPngBajtu: 5 * 1024 * 1024 });
  assert.equal(r.mime, "image/png");
});
