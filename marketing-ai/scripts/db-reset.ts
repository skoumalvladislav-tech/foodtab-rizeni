/**
 * Smaže lokální PGlite databázi a znovu ji postaví z migrací a seedu.
 *
 *   npm run db:reset
 *
 * Nikdy se nedotýká DATABASE_URL — když je nastavená, skript odmítne
 * běžet. Reset ostré databáze se nedělá skriptem.
 */
import { rmSync, existsSync } from "node:fs";
import path from "node:path";

import { applyMigrations } from "../lib/db/driver.ts";
import { createPgliteDriver } from "../lib/db/pglite.ts";
import { seedDemo } from "../lib/seed/demo.ts";

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL je nastavená — reset se dělá jen nad lokální PGlite.");
  process.exit(1);
}

const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

const driver = await createPgliteDriver(dir);
const applied = await applyMigrations(driver, { withShim: true });
console.log(`Migrace: ${applied.length} nasazeno`);
await seedDemo(driver);
console.log("Demo data nasypána.");
await driver.close();
