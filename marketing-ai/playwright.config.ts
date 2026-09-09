import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

/**
 * Chromium bývá v prostředí předinstalovaný (PLAYWRIGHT_BROWSERS_PATH).
 * Playwright ale hledá PŘESNOU revizi podle verze balíčku, takže po
 * aktualizaci obrazu kontejneru přestane sedět a testy spadnou na
 * „Executable doesn't exist“ — což vypadá jako chyba v aplikaci, i když
 * jde jen o jiné číslo v cestě.
 *
 * Proto: když se najde stabilní odkaz na prohlížeč (`/opt/pw-browsers/
 * chromium`), použije se přímo. Stahovat se nic nemusí a nesmí
 * (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD). Vlastní cestu lze vnutit
 * proměnnou PLAYWRIGHT_CHROMIUM_PATH.
 */
const prohlizec = [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((c) => c && existsSync(c));
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  retries: 0,
  // Jeden běh za druhým: vývojový server překládá každou obrazovku při prvním
  // otevření (i desítky sekund) a testy sdílejí jednu demo databázi.
  workers: 1,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    viewport: { width: 390, height: 844 },
    navigationTimeout: 120_000,
    actionTimeout: 60_000,
    ...(prohlizec ? { launchOptions: { executablePath: prohlizec } } : {}),
  },
  webServer: {
    command: "APP_MODE=demo PGLITE_DIR=.data/pglite-e2e STORAGE_DIR=.data/storage-e2e PORT=3100 npm run dev -- -p 3100",
    url: "http://localhost:3100/prihlaseni",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
