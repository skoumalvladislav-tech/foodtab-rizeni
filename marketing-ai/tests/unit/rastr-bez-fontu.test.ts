/**
 * Co se stane, když fontconfig o našich písmech neví — přesně situace
 * v nasazení, kam by se složka `assets/fonty` nedostala.
 *
 * Musí to spadnout. Text by se vysázel náhradníkem a příspěvky by
 * odešly v cizím písmu, aniž by kdokoli něco poznal.
 *
 * Vlastní soubor proto, že se výsledek ověření uvnitř modulu pamatuje
 * na celý běh procesu — `node --test` pouští každý soubor zvlášť.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Konfigurace bez jediné složky s písmy. Sází se tím, co si přinese
// pango samo — přesně to, co chceme zachytit.
const kam = mkdtempSync(join(tmpdir(), "fc-bez-pisem-"));
mkdirSync(join(kam, "cache"), { recursive: true });
writeFileSync(join(kam, "fonts.conf"), `<?xml version="1.0"?>
<fontconfig>
  <cachedir>${join(kam, "cache")}</cachedir>
  <selectfont><rejectfont><glob>*</glob></rejectfont></selectfont>
</fontconfig>
`);
process.env.FONTCONFIG_PATH = kam;

test("bez našich písem se převod odmítne a řekne proč", async () => {
  const { rastrovat } = await import("../../lib/render/rastr.ts");
  await assert.rejects(
    () => rastrovat('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#fff"/><text x="10" y="50" font-size="30">Řízek</text></svg>', { width: 200, height: 80 }),
    /písm/i,
  );
});
