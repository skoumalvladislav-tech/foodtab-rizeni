import { getDriver, type Driver, type Tx } from "./driver.ts";

/**
 * Dvě obranné linie na jednom místě.
 *
 * Aplikace NIKDY nedotazuje databázi jako superuživatel při obsluze
 * uživatele. Každý požadavek běží v transakci pod rolí `authenticated`
 * s nastaveným `request.jwt.claim.sub`, takže platí přesně tytéž politiky
 * Row Level Security jako přes Supabase API. Aplikační kontrola
 * (lib/authz.ts) je druhá linie, ne náhrada.
 *
 * `withService` je jen pro webhooky a frontu, kde žádný uživatel není.
 * Obchází RLS — proto výhradně na serveru a pro úzce vymezené operace.
 *
 * Tenhle soubor nemá `server-only`, aby ho mohly použít testy pouštěné
 * Nodem. Aplikace ho importuje přes lib/db/index.ts, který `server-only` má.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Neplatné ID uživatele");
  const driver = await getDriver();
  return driver.transaction(async (tx) => {
    await tx.q("select set_config('role', 'authenticated', true)");
    await tx.q("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.q("select set_config('request.jwt.claim.role', 'authenticated', true)");
    return fn(tx);
  });
}

export async function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const driver = await getDriver();
  return driver.transaction(async (tx) => {
    await tx.q("select set_config('role', 'service_role', true)");
    await tx.q("select set_config('request.jwt.claim.sub', '', true)");
    await tx.q("select set_config('request.jwt.claim.role', 'service_role', true)");
    return fn(tx);
  });
}

export async function getDb(): Promise<Driver> {
  return getDriver();
}
