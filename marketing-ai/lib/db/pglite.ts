import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";

import type { Driver, Row, Tx } from "./driver.ts";

/**
 * PGlite — PostgreSQL ve WebAssembly, uložený v adresáři.
 *
 * Používá se pro demo a testy. Chová se jako skutečný Postgres včetně
 * rolí a Row Level Security (role `authenticated` je nosuperuser, viz
 * supabase/local/00_shim.sql), takže lokální běh ověřuje tytéž politiky
 * jako Supabase. Co NEOVĚŘÍ: Supabase Auth, Storage a síťovou vrstvu.
 */
export async function createPgliteDriver(dataDir: string | ":memory:"): Promise<Driver> {
  if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
  const pg = dataDir === ":memory:" ? new PGlite() : new PGlite(dataDir);
  await pg.waitReady;

  const wrap = (runner: { query: PGlite["query"] }): Tx => ({
    async q<T = Row>(text: string, params: unknown[] = []) {
      const r = await runner.query<T>(text, params);
      return r.rows;
    },
    async one<T = Row>(text: string, params: unknown[] = []) {
      const r = await runner.query<T>(text, params);
      return r.rows[0] ?? null;
    },
  });

  const base = wrap(pg);
  return {
    kind: "pglite",
    q: base.q,
    one: base.one,
    async exec(sql) {
      await pg.exec(sql);
    },
    async transaction(fn) {
      return pg.transaction(async (tx) => fn(wrap(tx as unknown as { query: PGlite["query"] })));
    },
    async close() {
      await pg.close();
    },
  };
}
