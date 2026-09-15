# Předání modulu Marketing jiné větvi — vrátit původní aplikaci

Zadal Šéfík 14. 9. 2026 odpoledne, slovy:

> „myslím že spoustu věcí už bylo hotových v původní aplikaci na
> localhost:3000 … aplikaci marketing jsem viděl a menu vypadalo jinak."
> — „ano tyto všechny funkce tam chci mít, původní aplikace se mi líbila
> více" — „i rozdělení oken" — „respektive ovládací menu"

**To je rozhodnutí, ne přání k diskusi.** Modul má mít všechny funkce
původní samostatné aplikace `marketing-ai` **a její ovládací menu
a rozdělení oken.** Tenhle dokument říká, co přesně to znamená, protože
původní aplikace už v pracovní kopii není — leží v historii gitu.

Navazuje na `docs/marketing-kontrola-proti-zadani.md` (kontrola proti
promptu) a `docs/marketing-co-zbyva.md` (soupis). Obojí je ale
porovnání se **zadáním**; tohle je porovnání s tím, **co už jednou
stálo**. Ta dvě porovnání dávají různé výsledky a tenhle je pro Šéfíka
ten důležitější.

---

## 1. Kde původní aplikace je

Commit **`6cb7d72`** (a starší), složka `marketing-ai/`. Smazána
v `d8a0b73` (13. 9., 179 souborů, 28 tisíc řádků) při převodu na modul.

```bash
git show 6cb7d72 --stat -- marketing-ai | tail -3
git show "6cb7d72:marketing-ai/app/[provozovna]/navigace.tsx"
git checkout 6cb7d72 -- marketing-ai        # celá do pracovní kopie, když je to potřeba vedle sebe
```

Rozhodnutí o převodu na modul (`docs/marketing-je-modul.md`) **platí
dál** — databáze je Supabase Foodtabu, přístup rozhoduje `app.has_access`,
vydavatel je n8n. Vrací se **funkce a rozvržení**, ne stará databáze
ani vlastní správa lidí.

---

## 2. Co původní aplikace měla a modul nemá

Ověřeno čtením obou stromů 14. 9. odpoledne, ne z paměti.

### Chybí úplně

| Co | Kde to bylo | Zadání |
|---|---|---|
| **Renderer grafiky** — datová šablona → SVG (`lib/render/svg-sablony.ts`) → PNG/JPEG přes `sharp` (`lib/render/rastr.ts`) s písmy v repozitáři (Newsreader, Archivo, OFL) a kontrolou, že se opravdu použila; přetečení → další slide, nikdy useknutý název jídla | `lib/render/`, `lib/providers/render/{svg,mock-video,shotstack}.ts`, `assets/fonty` | §12, §9 |
| **Průvodce vytvořením** ve třech režimech: rychlý (fotka + věta), průvodce (podklady → šablona → návrh → editor → schválení → termín), kampaň (cíl + termín → série) | `app/[provozovna]/tvorba/` | §22, obrazovka 5 |
| **E2E cesta** z §24 v Playwrightu | `tests/e2e/cesta.spec.ts`, `playwright.config.ts` | §24, §25 |
| **OpenAPI** + kontrola, že sedí s cestami | `openapi/openapi.yaml`, `tests/unit/openapi.test.ts` | §20, §26 |
| **Ověřování podpisů webhooků** a přímé Meta OAuth (start/callback) | `app/api/v1/webhooky/[zdroj]`, `app/api/v1/meta/oauth/*` | §23, §6 |
| **Detail fotky** a podepsané adresy s omezenou platností | `media/[id]`, `lib/storage/podpis.ts` | §8, §23 |
| **Stahování metrik** ze sítě | `app/api/v1/analytika/synchronizovat`, `lib/domena/metriky.ts` | §18 |
| Jednotkové testy rendereru, bezpečnosti a poruch | `tests/unit/{rastr,rastr-bez-fontu,bezpecnost,poruchy}.test.ts` | §25 |
| Čtrnáct dokumentů a osm n8n workflow | `docs/`, `n8n/` | §26 — viz `marketing-kontrola-proti-zadani.md` §3, proč se osm workflow nevrací |

### Je, ale jinak — a Šéfík chce to původní

| Co | Původně | V modulu |
|---|---|---|
| **Ovládací menu** | levý sloupec od 1024 px, dvě skupiny (Provozovna / Nastavení), ikony, počítadlo u „Ke schválení"; na mobilu spodní lišta s pěti zkratkami | položky v rozcestníku modulu, bez vlastní navigace |
| **Rozdělení oken** | navigace vlevo, obsah vpravo do 1180 px, karty, mřížky `.mrizka-2/3/4`, kalendář 7 sloupců | jedna obrazovka pod lištou Foodtabu |
| **Menu** | seznam v tabulce (druh, název, platnost, položek + „ke kontrole", stav, zdroj) a **samostatná stránka „Nové menu" se čtyřmi záložkami**: ruční formulář / vložit text / fotografie / PDF | jedna stránka; **schopnosti stejné** (ruční, text bez AI přes `lib/marketing-menu-text.ts`, fotka a PDF s AI), liší se rozvržení |
| Šablony | katalog jako data se vstupy (JSON Schema), rozvržením, formáty, storyboardem — a **renderer, který je kreslí** | tabulka `marketing_sablony` má totéž (`rozvrzeni`, `pravidla_textu`, `osnova`, `formaty`), ale nic je nekreslí |

### Původní ovládací menu — přesně

Z `app/[provozovna]/navigace.tsx` v `6cb7d72`. Pořadí a názvy jsou
závazné; cesty se přepíšou na `/{rozsah}/marketing/…`.

**Provozovna:** Přehled · Vytvořit obsah · Mediální knihovna · Menu ·
Šablony · Kalendář · Ke schválení *(počítadlo čekajících)* · Kampaně
a automatizace · Publikované · Analytika

**Nastavení:** Brand kit provozovny · Integrace a nástroje · Tým, role
a audit

**Spodní lišta na mobilu** (do 1023 px): Přehled, Vytvořit obsah,
Kalendář, Ke schválení, Mediální knihovna — a když na něco člověk nemá
právo, doplní se další položka v pořadí, nikdy dvakrát táž (původní kód
to řeší a má u toho napsané proč).

Položky se schovávají podle práv, ne podle role: `content.create` →
`marketing.manage`, `media.read` / `menu.read` / `analytics.read` →
`marketing.read`, `integrations.*` → `marketing.publish`. Rozhoduje
`app.has_access`, nic jiného (CLAUDE.md, pravidlo 2).

---

## 3. Co udělat, v tomhle pořadí

Každý krok samostatně odevzdatelný a commitnutý. Nezačínat další, dokud
předchozí nemá kontrolu, která umí spadnout.

1. **Ovládací menu a rozdělení oken.** Boční navigace modulu uvnitř
   lišty Foodtabu podle výčtu výš, spodní lišta na mobilu, obsah do
   1180 px. Barvy a písmo z `app/_tokeny.css` (`docs/vzhled-oprava-1.md`),
   ne z původního `globals.css` — původní paleta neprošla měřením
   `scripts/barvy.js`. Kontrola: seznam položek a jejich pořadí v Node
   testu, a že se položka bez práva neukáže.

   **Rozhodnutí, které tu nechávám Šéfíkovi:** lišta Foodtabu nahoře
   zůstává (moduly se přepínají v ní). Kdyby chtěl i tu pryč a marketing
   na celou obrazovku jako původně, ať to napíše — je to jeho volba, ne
   technická.

2. **Menu jako původně:** seznam v tabulce + stránka „Nové menu" se
   čtyřmi záložkami. Data se nemění, jen obrazovka.

3. **Průvodce vytvořením** (`tvorba`) ve třech režimech. Kroky existují
   každý jinde — spojit je, ne psát znovu.

4. **Renderer.** Vrátit `lib/render/svg-sablony.ts` a `rastr.ts` včetně
   písem a kontroly, že se použila. `sharp` je závislost navíc — na
   Vercelu ověřit, že se sestaví (původní kód řeší `FONTCONFIG_PATH`
   a má k tomu test `rastr-bez-fontu`). Výstup do `marketing_media`,
   úloha do `marketing_render_ulohy`, které už stojí.

5. **Detail fotky a podepsané adresy**, pak **E2E cesta** z §24
   v Playwrightu (Chromium je v prostředí předinstalované,
   `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, neinstalovat znovu).

6. **OpenAPI** pro to, co v modulu opravdu vede ven (`/api/uloha/*`,
   `/k/[klic]`), s kontrolou proti skutečným cestám.

7. Webhooky s podpisem a Meta OAuth **až po** rozhodnutí, jestli se
   opouští n8n jako vydavatel — dnes se neopouští (`marketing-je-modul.md` §7).

---

## 4. Co teď NEdělat

- **Nevracet starou databázi** (`marketing.*` schéma, `organizations`,
  `venues`). Data jsou v `public.marketing_*` a mají RLS, granty
  a scénáře. Vrací se obrazovky a knihovny, ne tabulky.
- **Nevracet vlastní správu lidí** (`nastaveni/tym`). Lidé a Zařazení
  jsou ve Foodtabu; položka „Tým, role a audit" v menu vede na ně
  a na `marketing/audit`.
- **Nevracet původní `globals.css` jedna k jedné.** Paleta se měří.
- **Nenasazovat.** `db push` spouští Šéfík. Migrace tady ale skoro
  nebudou potřeba — schéma je hotové.
- **Nesahat na relaci provoz** ani na `audit_log` granty — to má
  `docs/granty-provoz-zadani.md`.
- **Nezapínat n8n.** Dokud běží staré workflow, dva příspěvky denně.

---

## 5. Zkoušky

```bash
node scripts/scenare.test.mjs
supabase/tests/run.sh                                  # 1301 kontrol, padá jen krok31 (provoz)
node --experimental-strip-types scripts/marketing-*.test.mjs
node scripts/marketing-granty.test.mjs
node scripts/marketing-prihlaseni.test.mjs             # každá nová obrazovka musí projít
node scripts/marketing-n8n-workflow.test.mjs
npx tsc --noEmit && npx eslint "app/[rozsah]/marketing" lib scripts
```

**Ke každé nové obrazovce a knihovně kontrola, která umí spadnout —
a rozbij ji schválně, než ji prohlásíš za hotovou.** Dnes to za den
chytilo sedm kontrol, které nemohly spadnout, a dvě chyby v mých
vlastních scénářích. Přesný postup: skill `scenar`.

Nová obrazovka **musí** používat `redirect(await odkazNaPrihlaseni())`,
ne `redirect('/prihlaseni')` — hlídá `marketing-prihlaseni.test.mjs`.

---

## 6. Kde se dá skončit

Po kroku 1, 2, 3 zvlášť — každý je pro Šéfíka vidět sám o sobě. Krok 4
(renderer) se nedá odevzdat napůl: buď kreslí a ověří písma, nebo ne.
Krok 5 až 7 jsou samostatné.

Když se něco z původního kódu nedá převést, protože by porušilo pravidlo
z `CLAUDE.md` (typicky `service_role` v klientovi, vlastní kontrola
práv mimo `app.has_access`), **napiš to do hlášení a nech to** — to je
nález, ne překážka k obejití.
