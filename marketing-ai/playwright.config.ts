import { defineConfig } from "@playwright/test";

// Chromium je v prostředí předinstalovaný (PLAYWRIGHT_BROWSERS_PATH);
// executablePath se nastavuje jen tam, kde není standardní cesta.
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
    // Předinstalovaný Chromium; když verze balíčku nesedí s revizí na disku,
    // řekne se přímo cesta místo stahování (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: "APP_MODE=demo PGLITE_DIR=.data/pglite-e2e STORAGE_DIR=.data/storage-e2e PORT=3100 npm run dev -- -p 3100",
    url: "http://localhost:3100/prihlaseni",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
