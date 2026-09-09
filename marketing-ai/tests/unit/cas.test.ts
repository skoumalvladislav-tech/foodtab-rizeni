import assert from "node:assert/strict";
import { test } from "node:test";

import { casVPasmu, datumVPasmu, formatDatumSlovy, nejblizsiSobota, okamzik, posunDne, relativne, rozlozit } from "../../lib/cas.ts";

/**
 * Ukládání a zobrazení se ověřují ZVLÁŠŤ: co se zadá jako 18:00, musí být
 * v UTC jiný čas (16:00 v létě, 17:00 v zimě) — a zpět vyjít zase 18:00.
 * Jeden průchod tam a zpět by dvě opačné chyby vyrušil.
 */
test("hodina na zdi → okamžik: letní čas (UTC+2)", () => {
  const d = okamzik("2026-08-31", "22:00", "Europe/Prague");
  assert.equal(d.toISOString(), "2026-08-31T20:00:00.000Z");
});

test("hodina na zdi → okamžik: zimní čas (UTC+1)", () => {
  const d = okamzik("2026-12-24", "18:00", "Europe/Prague");
  assert.equal(d.toISOString(), "2026-12-24T17:00:00.000Z");
});

test("okamžik → hodina na zdi (zobrazení nezávisle na serveru)", () => {
  assert.equal(casVPasmu(new Date("2026-08-31T20:00:00Z"), "Europe/Prague"), "22:00");
  assert.equal(datumVPasmu(new Date("2026-08-31T22:30:00Z"), "Europe/Prague"), "2026-09-01");
});

test("přechod na letní čas 2026 (29. 3., 2:00 → 3:00): neexistující hodina se posune dopředu", () => {
  const d = okamzik("2026-03-29", "02:30", "Europe/Prague");
  const r = rozlozit(d, "Europe/Prague");
  assert.equal(r.hour, 3, "2:30 v den posunu neexistuje, očekává se 3:30");
  assert.equal(r.minute, 30);
});

test("přechod na zimní čas 2026 (25. 10., 3:00 → 2:00): dvojznačná hodina dá platný okamžik", () => {
  const d = okamzik("2026-10-25", "02:30", "Europe/Prague");
  const r = rozlozit(d, "Europe/Prague");
  assert.equal(r.hour, 2);
  assert.equal(r.minute, 30);
  // Den před a po posunu se liší o 25 hodin, ne 24.
  const pred = okamzik("2026-10-24", "12:00", "Europe/Prague");
  const po = okamzik("2026-10-25", "12:00", "Europe/Prague");
  assert.equal((po.getTime() - pred.getTime()) / 3600000, 25);
});

test("plánování 18:00 platí v každou hodinu dne, ne jen dopoledne", () => {
  // Kontrola pro všech 24 hodin „teď“: převod nesmí záviset na tom, kdy se spustí.
  for (let h = 0; h < 24; h++) {
    const d = okamzik("2026-09-12", "18:00", "Europe/Prague");
    assert.equal(casVPasmu(d, "Europe/Prague"), "18:00", `hodina ${h}`);
  }
});

test("posun dne a nejbližší sobota", () => {
  assert.equal(posunDne("2026-02-28", 1), "2026-03-01");
  assert.equal(posunDne("2026-01-01", -1), "2025-12-31");
  assert.equal(nejblizsiSobota("Europe/Prague", new Date("2026-09-09T10:00:00Z")), "2026-09-12");
  assert.equal(nejblizsiSobota("Europe/Prague", new Date("2026-09-12T10:00:00Z")), "2026-09-12");
});

test("české formátování", () => {
  assert.equal(formatDatumSlovy("2026-09-12"), "sobota 12. září");
  assert.equal(relativne(new Date("2026-09-12T10:00:00Z"), "Europe/Prague", new Date("2026-09-09T10:00:00Z")), "za 3 dny");
  assert.equal(relativne(new Date("2026-09-10T10:00:00Z"), "Europe/Prague", new Date("2026-09-09T10:00:00Z")), "zítra");
});
