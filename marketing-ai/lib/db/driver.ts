/**
 * Ovladač databáze — společné rozhraní pro PGlite a postgres.js.
 *
 * Tenhle soubor NEMÁ `server-only`, protože ho používají i skripty
 * (seed, testy) spouštěné přímo Nodem. Do prohlížeče se nikdy nedostane:
 * všechno, co ho importuje z aplikace, jde přes lib/db/index.ts.
 */
import path from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";

export type Row = Record<string, unknown>;

export interface Tx {
  /** Dotaz s pozičními parametry ($1, $2, …). Vrací řádky. */
  q<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** První řádek nebo null. */
  one<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
}

export interface Driver extends Tx {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Spustí SQL soubor po částech (víc příkazů). */
  exec(sql: string): Promise<void>;
  kind: "pglite" | "postgres";
  close(): Promise<void>;
}

const ROOT = process.cwd();

export function migrationsDir(): string {
  return path.join(ROOT, "supabase", "migrations");
}

export function listMigrations(): { name: string; sql: string }[] {
  const dir = migrationsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

export function localShimSql(): string {
  const p = path.join(ROOT, "supabase", "local", "00_shim.sql");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/**
 * Nasadí migrace, které ještě neběžely. Historie se drží v tabulce
 * `marketing_schema_migrations` — u Supabase tuhle práci dělá CLI
 * (`supabase db push`), tenhle kód je pro PGlite a testy.
 */
export async function applyMigrations(driver: Driver, opts: { withShim: boolean }): Promise<string[]> {
  if (opts.withShim) {
    const shim = localShimSql();
    if (shim) await driver.exec(shim);
  }
  await driver.exec(
    `create table if not exists public.marketing_schema_migrations (
       name text primary key, applied_at timestamptz not null default now())`,
  );
  const done = new Set(
    (await driver.q<{ name: string }>("select name from public.marketing_schema_migrations")).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.name)) continue;
    await driver.exec(m.sql);
    await driver.q("insert into public.marketing_schema_migrations (name) values ($1)", [m.name]);
    applied.push(m.name);
  }
  return applied;
}

let driverPromise: Promise<Driver> | null = null;

declare global {
  // Vývojový server Next znovu načítá moduly; databáze musí přežít v globálu,
  // jinak by se PGlite otevřel víckrát nad týmž adresářem.
  var __foodtabMarketingDriver: Promise<Driver> | undefined;
}

export async function getDriver(): Promise<Driver> {
  if (globalThis.__foodtabMarketingDriver) return globalThis.__foodtabMarketingDriver;
  if (!driverPromise) {
    driverPromise = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) {
        const { createPostgresDriver } = await import("./postgres.ts");
        return createPostgresDriver(url);
      }
      const { createPgliteDriver } = await import("./pglite.ts");
      const dir = process.env.PGLITE_DIR ?? path.join(ROOT, ".data", "pglite");
      const driver = await createPgliteDriver(dir);
      await applyMigrations(driver, { withShim: true });
      // Demo data se nasypou jen do prázdné databáze.
      const orgs = await driver.q<{ n: string }>("select count(*)::text as n from marketing.organizations");
      if (orgs[0]?.n === "0" && process.env.SEED_DEMO !== "0") {
        const { seedDemo } = await import("../seed/demo.ts");
        await seedDemo(driver);
      }
      return driver;
    })();
    globalThis.__foodtabMarketingDriver = driverPromise;
  }
  return driverPromise;
}

export function resetDriverForTests(): void {
  driverPromise = null;
  globalThis.__foodtabMarketingDriver = undefined;
}
