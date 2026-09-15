# Krok 5 (E2E Playwright) — proč to není „nainstaluj a přepiš cesty"

Zadání: `docs/hlaseni/zadani-pro-ai-marketing-faktury.md`, Krok 5, třetí
odrážka — E2E cesta z §24 v Playwrightu podle
`marketing-ai/tests/e2e/cesta.spec.ts`. Tenhle dokument zapisuje, co se
zjistilo při pokusu ten test převzít, a proč zůstal jen nález, ne kód.

## Co jsem přečetl

`git show 6cb7d72:marketing-ai/tests/e2e/cesta.spec.ts` a
`global-setup.ts` — kompletní scénář ze zadání §24 (fotka → menu →
návrh → úprava → schválení jinou osobou → naplánování → mock
publikace), plus druhý scénář pro Bernard Bar Tábor a kontrola, že
integrace ukazují pravdivý stav.

## Proč to není mechanický převod cest

Test NENÍ napsaný proti Foodtabu — je napsaný proti PŮVODNÍ samostatné
aplikaci, a liší se ve dvou věcech, které nejdou obejít přepsáním
adres:

1. **Databáze.** `global-setup.ts` maže `.data/pglite-e2e` —
   vestavěnou PGlite databázi, kterou si původní aplikace zakládala
   sama pro každý běh testu. Foodtab běží proti opravdovému Supabase
   (`spekntcsuroqhehmjssv`), ne proti embedded PGlite. Bez PGlite se
   nedá čistá databáze pro test „jen smazat a založit znovu" — musela
   by se buď použít testovací větev Supabase (Branching), nebo seed
   skript se svým vlastním úklidem po běhu.

2. **Přihlášení.** Test klika na jméno demo uživatele
   (`await odeslat(page, /Marek Manažer/)`) — původní aplikace měla
   přihlášení jedním kliknutím na účet bez hesla. **Foodtab přihlašuje
   kódem z e-mailu** (`app/prihlaseni/`). Automatizovaný test nemá jak
   ten kód přečíst bez zásahu do reálné e-mailové schránky — a to není
   něco, co e2e běh smí dělat.

Zbytek (cesty, `id` polí, jména tlačítek) by šel přepsat mechanicky —
ale bez vyřešení těch dvou věcí by se test vůbec nedostal za
přihlašovací obrazovku.

## Co by přihlášení bez e-mailu potřebovalo

Supabase nabízí `auth.admin.generateLink` / minutí session servisním
klíčem pro přesně tenhle účel (E2E testy bez ruční interakce
s poštou). Servisní klíč (`SUPABASE_SERVICE_ROLE_KEY`) v prostředí
už je — používá ho `lib/supabase/uloha.ts` pro plánované úlohy.

**Tohle se ale nemá domýšlet o půl druhé v noci.** Je to rozhodnutí
o tom, jak se testovací obcházení přihlášení smí a nesmí chovat (musí
jít jen v testovacím prostředí, nesmí být dosažitelné z produkce,
musí být jasně označené), a to je přesně ten typ rozhodnutí, který
`docs/pracovni-rezim-codea.md` (oddíl 2) vyhrazuje Šéfíkovi:
„provozní pravidlo, které není v dokumentech".

## Návrh pro navázání

1. Rozhodnout, jestli testovací databáze bude testovací větev Supabase,
   nebo seed + úklid nad ostrou testovací databází.
2. Napsat úzkou pomocnou funkci pro E2E přihlášení (servisním klíčem,
   jen pod `NODE_ENV=test` nebo obdobným příznakem), zdokumentovat ji
   a napsat na ni kontrolu, že mimo test prostředí nejde zavolat.
3. Teprve pak přepsat `cesta.spec.ts` na skutečné cesty Foodtabu
   (`/marketing/media`, `/marketing/menu/nove`, `/marketing/tvorba`,
   `/marketing/{id}`, `/marketing/schvalovani`, `/marketing/publikovane`).
4. `@playwright/test` přidat do `package.json` bez stahování Chromia
   (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) tam, kde se test píše;
   Chromium instalovat až v prostředí, které ho skutečně spustí.

Do repozitáře dnes nešel žádný test ani závislost — jen tenhle nález.
