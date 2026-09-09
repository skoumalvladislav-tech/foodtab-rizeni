/**
 * Testovací databáze v paměti: migrace + shim + seed. Každý běh čistý.
 *
 * Kontroly se píší tak, aby UMĚLY SPADNOUT: u každé politiky se ověřuje,
 * že se někdo NEDOSTANE tam, kam nemá — ne jen šťastná cesta.
 */
import { applyMigrations, resetDriverForTests, type Driver, type Tx } from "../../lib/db/driver.ts";
import { createPgliteDriver } from "../../lib/db/pglite.ts";
import { seedDemo } from "../../lib/seed/demo.ts";

let counter = 0;
let failed = 0;
const failures: string[] = [];

export async function testovaciDb(): Promise<Driver> {
  process.env.STORAGE_DIR = ".data/storage-test";
  process.env.APP_MODE = "demo";
  resetDriverForTests();
  const d = await createPgliteDriver(":memory:");
  await applyMigrations(d, { withShim: true });
  await seedDemo(d);
  // getDriver() (withUser/withService) musí používat tutéž instanci.
  globalThis.__foodtabMarketingDriver = Promise.resolve(d);
  return d;
}

export async function jako<T>(d: Driver, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return d.transaction(async (tx) => {
    await tx.q("select set_config('role', 'authenticated', true)");
    await tx.q("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

export function check(name: string, ok: boolean, detail?: string) {
  counter++;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/** Očekává výjimku. Bez ní kontrola spadne. */
export async function ocekavatChybu(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(name, false, "žádná výjimka");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, match ? match.test(msg) : true, match && !match.test(msg) ? `jiná chyba: ${msg}` : undefined);
  }
}

export function souhrn(): number {
  console.log(`\n${counter} kontrol, ${failed} selhalo${failed ? ": " + failures.join("; ") : ""}`);
  return failed ? 1 : 0;
}
