import { defineConfig } from "@playwright/test";

// Chromium je v prostředí předinstalovaný (PLAYWRIGHT_BROWSERS_PATH);
// executablePath se nastavuje jen tam, kde není standardní cesta.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "APP_MODE=demo PGLITE_DIR=.data/pglite-e2e PORT=3100 npm run dev -- -p 3100",
    url: "http://localhost:3100/prihlaseni",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
