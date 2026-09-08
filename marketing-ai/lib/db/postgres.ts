import postgres from "postgres";

import type { Driver, Row, Tx } from "./driver.ts";

/**
 * postgres.js — Supabase nebo libovolný PostgreSQL přes DATABASE_URL.
 *
 * Připojuje se uživatelem z connection stringu (typicky `postgres`),
 * ale KAŽDÁ transakce si hned přepne roli na `authenticated` nebo
 * `service_role` (lib/db/index.ts). Práva `postgres` se tak nikdy
 * nepoužijí na data — jen na to přepnutí.
 *
 * `prepare: false` kvůli transakčnímu pooleru Supabase (PgBouncer),
 * který připravené příkazy nepodporuje.
 */
export async function createPostgresDriver(url: string): Promise<Driver> {
  const sql = postgres(url, { prepare: false, max: 5, connect_timeout: 10 });

  const wrap = (s: typeof sql): Tx => ({
    async q<T = Row>(text: string, params: unknown[] = []) {
      const rows = await s.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async one<T = Row>(text: string, params: unknown[] = []) {
      const rows = await s.unsafe(text, params as never[]);
      return (rows[0] as unknown as T) ?? null;
    },
  });

  const base = wrap(sql);
  return {
    kind: "postgres",
    q: base.q,
    one: base.one,
    async exec(text) {
      await sql.unsafe(text);
    },
    async transaction(fn) {
      return sql.begin(async (tx) => fn(wrap(tx as unknown as typeof sql))) as Promise<never>;
    },
    async close() {
      await sql.end();
    },
  };
}
