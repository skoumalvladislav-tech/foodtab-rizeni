import { expect, test, type Page } from "@playwright/test";

/**
 * Ukázková cesta (zadání §24), mobilní viewport 390 px:
 *  1. přihlášení demo uživatele, deep link zachová cíl,
 *  2. výběr Černé Perly,
 *  3. nahrání fotografie,
 *  4. vložení demo denního menu,
 *  5. vytvoření Story a feed návrhu,
 *  6. úprava textu,
 *  7. odeslání ke schválení,
 *  8. schválení konkrétní verze jiným uživatelem,
 *  9. naplánování,
 * 10. mock publikace se stavem published_mock.
 * Druhá ukázka: Bernard Bar Tábor + víkendové menu.
 */
const DNES = new Date().toISOString().slice(0, 10);

/**
 * Odeslání formuláře server action: klik + čekání na změnu adresy.
 * Bez toho by test hned navigoval dál a odeslání přerušil.
 */
async function odeslat(page: Page, name: string | RegExp, exact = false) {
  const pred = page.url();
  await page.getByRole("button", { name, exact }).first().click();
  await page.waitForURL((u) => u.toString() !== pred, { timeout: 90_000 });
}

async function prihlasit(page: Page, jmeno: string) {
  await page.goto("/prihlaseni");
  await odeslat(page, new RegExp(jmeno));
}

async function odhlasit(page: Page) {
  await odeslat(page, "Odhlásit");
  await expect(page).toHaveURL(/prihlaseni/);
}

test("nepřihlášený deep link zachová cíl a po přihlášení se vrátí", async ({ page }) => {
  await page.goto("/cerna-perla/kalendar?pohled=tyden");
  await expect(page).toHaveURL(/\/prihlaseni\?kam=%2Fcerna-perla%2Fkalendar/);
  await odeslat(page, /Marek Manažer/);
  await expect(page).toHaveURL(/\/cerna-perla\/kalendar\?pohled=tyden/);
  await expect(page.getByRole("heading", { name: "Kalendář obsahu" })).toBeVisible();
});

test("Černá Perla: fotka → menu → návrh → úprava → schválení → plán → published_mock", async ({ page }) => {
  await prihlasit(page, "Marek Manažer");
  // 2. výběr provozovny — přepínačem v liště (server-side přesměrování na tutéž obrazovku)
  await page.locator(".venue-switch select").selectOption("cerna-perla");
  await expect(page).toHaveURL(/\/cerna-perla\/prehled/);
  await expect(page.locator(".kontext").getByText("Černá Perla")).toBeVisible();

  // 3. nahrání fotografie
  await page.goto("/cerna-perla/media");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#6b4c8a"/><text x="100" y="600" font-size="60" fill="#fff">E2E svíčková ${Date.now()}</text></svg>`;
  await page.locator("#soubory").setInputFiles({ name: "e2e-svickova.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await page.locator("#tags").fill("e2e, svíčková");
  await odeslat(page, "Nahrát");
  await expect(page.getByText(/e2e-svickova.svg: nahráno/)).toBeVisible();

  // 4. vložení demo denního menu z textu a potvrzení
  await page.goto("/cerna-perla/menu/nove?zpusob=text");
  await page.locator("#text").fill(`E2E denní menu ${DNES.split("-").reverse().join(". ")}\nPolévka\nHovězí vývar 45 Kč (1,3,9)\nHlavní jídla\nSvíčková na smetaně – houskový knedlík 189 Kč (1,3,7)\nKuřecí řízek s kaší 169,- (1,3,7)`);
  await odeslat(page, "Rozpoznat a zkontrolovat");
  await expect(page.getByRole("heading", { name: /E2E denní menu/ })).toBeVisible();
  await odeslat(page, "Uložit a potvrdit menu");
  await expect(page.getByText("Menu potvrzeno.")).toBeVisible();

  // 5. Story + feed návrh z průvodce
  await page.goto("/cerna-perla/tvorba");
  await page.locator("#sablona").selectOption("denni_menu");
  const menuOption = await page.locator("#menuId option").filter({ hasText: "E2E denní menu" }).first().getAttribute("value");
  await page.locator("#menuId").selectOption(menuOption ?? "");
  await page.locator("#brief").fill("Dnešní menu, přátelsky, zmínit svíčkovou.");
  await odeslat(page, "Vytvořit návrh");
  await expect(page).toHaveURL(/\/cerna-perla\/obsah\//);
  await expect(page.getByText("Návrh je hotový")).toBeVisible();
  await expect(page.getByRole("heading", { name: "3. Návrhy" })).toBeVisible();
  await expect(page.getByText("demo návrhář", { exact: false }).first()).toBeVisible();

  // 6. úprava textu (změna ceny) → nová verze
  const ig = page.locator("#ig_caption");
  await ig.fill((await ig.inputValue()).replace("189 Kč", "199 Kč") + "\n(upraveno v E2E)");
  await page.locator("#note").fill("E2E úprava ceny");
  await odeslat(page, "Uložit jako novou verzi");
  await expect(page.getByText("Uloženo jako nová verze.")).toBeVisible();
  await expect(page.getByText(/verze 3/).first()).toBeVisible();

  // vykreslení feedu vestavěným rendererem
  await odeslat(page, "Vykreslit", true);
  await expect(page.getByText("Vykresleno.")).toBeVisible();

  // 7. žádost o schválení
  await odeslat(page, "Požádat o schválení");
  await expect(page.getByText("Žádost o schválení odeslána.")).toBeVisible();
  const url = page.url();
  await odhlasit(page);

  // 8. schválení jinou osobou — přesné verze
  await prihlasit(page, "Simona Schvalovatelka");
  await page.goto("/cerna-perla/schvalovani");
  await expect(page.getByRole("heading", { name: "Fronta ke schválení" })).toBeVisible();
  await page.goto(url);
  await page.locator("#komentar").fill("Vypadá dobře.");
  await odeslat(page, "Schválit", true);
  await expect(page.getByText("Schváleno.", { exact: true })).toBeVisible();
  await expect(page.getByText(/schváleno pro verzi 3/)).toBeVisible();
  await odhlasit(page);

  // 9.+10. naplánování a mock publikace
  await prihlasit(page, "Marek Manažer");
  await page.goto(url);
  await page.locator("#datum").fill(DNES);
  await page.locator("#cas").fill("00:01");
  await odeslat(page, "Naplánovat");
  await expect(page.getByText(/Naplánováno na/)).toBeVisible();
  await odeslat(page, /Zpracovat frontu teď/);
  await expect(page.getByText(/Fronta zpracována/)).toBeVisible();
  await expect(page.getByText("published_mock (demo)").first()).toBeVisible();
  await expect(page.getByText("Zveřejněno", { exact: true }).first()).toBeVisible();

  // Kalendář ukazuje zveřejněný obsah; publikace jsou označené jako demo
  await page.goto("/cerna-perla/publikace");
  await expect(page.getByText("published_mock (demo)").first()).toBeVisible();
});

test("Bernard Bar Tábor: víkendové menu → návrh; editor Perly Bernard nevidí", async ({ page }) => {
  await prihlasit(page, "Marek Manažer");
  await page.goto("/bernard-bar-tabor/menu");
  await expect(page.getByText(/Demo víkendové menu/)).toBeVisible();
  await page.getByRole("link", { name: /Demo víkendové menu/ }).click();
  await odeslat(page, "Vytvořit návrh");
  await expect(page).toHaveURL(/\/bernard-bar-tabor\/obsah\//);
  await expect(page.getByText("Návrh z menu je hotový.")).toBeVisible();
  await expect(page.getByText(/žebra/i).first()).toBeVisible();
  await odhlasit(page);

  await prihlasit(page, "Eda Editor");
  await page.goto("/bernard-bar-tabor/prehled");
  await expect(page).not.toHaveURL(/bernard-bar-tabor/);
});

test("integrace ukazují pravdivý stav (demo/mock) a odkazy na nastavení", async ({ page }) => {
  await prihlasit(page, "Vlasta Vlastníková");
  await page.goto("/nastaveni/integrace");
  await expect(page.getByRole("heading", { name: "Integrace a nástroje" })).toBeVisible();
  await expect(page.locator("h3").getByText("Doporučeno FoodTabem").first()).toBeVisible();
  await expect(page.locator("#social_publishing").getByText("demo").first()).toBeVisible();
  await expect(page.getByText("Připravujeme").first()).toBeAttached();
});
