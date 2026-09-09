# Vývojářské nastavení

Krok za krokem od prázdného počítače k běžící aplikaci. Dva režimy:
**demo** (bez nastavení, vše lokálně) a **produkce** (Supabase, skutečné
klíče). Většinu práce jde dělat v demu.

## 1. Předpoklady

- Node.js **22.13+** (`package.json` → `engines`). Novější 22.x i 24.x
  jsou v pořádku; testy používají `--experimental-strip-types`, který
  starší Node nemá.
- npm (součást Node).
- Windows: v PowerShellu psát `npm.cmd`, `npx.cmd`.
- Pro e2e testy Chromium (Playwright si ho stáhne přes
  `npx playwright install chromium`; v CI prostředí bývá předinstalovaný
  přes `PLAYWRIGHT_BROWSERS_PATH`).

## 2. Instalace a první start

```bash
cd marketing-ai
npm install
npm run dev
```

Adresa `http://localhost:3000`. Při prvním startu se v `.data/pglite`
založí databáze, spustí se `supabase/local/00_shim.sql` (náhrada
`auth.uid()` a rolí Supabase), pak čtyři migrace ze
`supabase/migrations/` a nakonec demo seed (`lib/seed/demo.ts`).
Trvá to několik sekund.

Projekt leží uvnitř repozitáře FoodTab Řízení, který má vlastní
`package-lock.json` a PostCSS. `next.config.ts` proto nastavuje
`turbopack.root` a `outputFileTracingRoot` na složku `marketing-ai` —
bez toho by Turbopack hledal Tailwind mateřského projektu.

## 3. Demo vs. produkce — jak se rozhoduje

Logika je v `lib/auth/session.ts` (`isDemoMode`) a `lib/db/driver.ts`:

| Otázka | Rozhoduje |
|---|---|
| Je demo režim? | `APP_MODE=production` → ne. Jinak ano, když `APP_MODE=demo` **nebo** chybí `NEXT_PUBLIC_SUPABASE_URL`. |
| Jaká databáze? | `DATABASE_URL` nastavená → postgres.js (Supabase). Jinak PGlite v `PGLITE_DIR` (výchozí `.data/pglite`). |
| Kam se ukládají soubory? | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → Supabase Storage. Jinak disk v `STORAGE_DIR` (výchozí `.data/storage`). |
| Nasype se demo seed? | Jen do **prázdné** PGlite a jen když není `SEED_DEMO=0`. Do postgresu se seed automaticky nikdy nespouští. |

V demu se `APP_SECRET` a `CREDENTIALS_ENCRYPTION_KEY` odvodí z pevné
hodnoty, aby šlo aplikaci vyzkoušet. V produkci (`APP_MODE=production`)
obě proměnné **musí** být nastavené, jinak aplikace při prvním použití
vyhodí chybu (`lib/utils/hash.ts`, `lib/providers/credentials.ts`).

## 4. Proměnné prostředí

Předloha je v `.env.example`; zkopírujte ji do `.env.local` (Next.js
ji načte, `.gitignore` ji nepustí do gitu). Níže je seznam proměnných,
které kód **skutečně čte** (`process.env.*`), s tím, kde se používají.

### Základ aplikace

| Proměnná | Význam | Výchozí |
|---|---|---|
| `APP_MODE` | `demo` nebo `production`. V produkci vypne demo přihlášení a vyžaduje tajemství. | demo, pokud chybí Supabase URL |
| `APP_URL` | Veřejná adresa aplikace bez lomítka na konci. Skládají se z ní podepsané adresy médií pro externí služby a callback pro Shotstack (`lib/domena/obsah.ts`, `lib/domena/fronta.ts`). **V produkci musí být veřejně dosažitelná** — Shotstack i Meta si z ní stahují soubory. | `http://localhost:3000` |
| `APP_SECRET` | Aspoň 16 znaků. Podepisuje demo cookie, podepsané adresy souborů a slouží jako `X-Cron-Secret` pro `/api/v1/ulohy/zpracovat`. | pevná demo hodnota; v produkci povinné |
| `CREDENTIALS_ENCRYPTION_KEY` | 64 hex znaků (32 bajtů). Klíč AES-256-GCM pro přístupové údaje poskytovatelů v `marketing.integration_secrets`. Vygenerujte: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. | odvozený z `APP_SECRET`; v produkci povinné |
| `PORT` | Port vývojového serveru (používá ho `playwright.config.ts`). | 3000 |

### Databáze a soubory

| Proměnná | Význam |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL (Supabase). Použijte **transaction pooler** (port 6543) — ovladač má `prepare: false` právě kvůli PgBounceru. Nenastavovat pro lokální práci. |
| `PGLITE_DIR` | Adresář PGlite. e2e testy používají `.data/pglite-e2e`. |
| `SEED_DEMO` | `0` = nesypat demo data do prázdné PGlite. |
| `STORAGE_DIR` | Adresář pro soubory na disku (výchozí `.data/storage`; db testy `.data/storage-test`). |
| `NEXT_PUBLIC_SUPABASE_URL` | URL projektu Supabase. Zapíná Supabase Auth (proxy, session) a Storage. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Veřejný (anon) klíč pro Auth v prohlížeči a proxy. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Jen server.** Používá ho `lib/storage/supabase.ts` pro nahrávání a čtení souborů. Nikdy do `NEXT_PUBLIC_*`. |
| `SUPABASE_STORAGE_BUCKET` | Název bucketu (výchozí `marketing-media`). |

### Poskytovatelé (režim `foodtab_managed`)

Klíče zákazníků (`customer_managed`) se ukládají šifrované do databáze
přes obrazovku Integrace — proměnné níže jsou jen pro režim, kdy klíč
drží FoodTab, a pro OAuth aplikaci Meta.

| Proměnná | Adaptér | Poznámka |
|---|---|---|
| `ANTHROPIC_API_KEY` | `lib/providers/ai/claude.ts` | klíč Anthropic |
| `ANTHROPIC_MODEL` | tamtéž | výchozí `claude-opus-5` |
| `SHOTSTACK_API_KEY` | `lib/providers/render/shotstack.ts` | |
| `SHOTSTACK_ENV` | tamtéž | `stage` (sandbox, výchozí) nebo `v1` (produkce) |
| `META_APP_ID`, `META_APP_SECRET` | `lib/providers/social/meta.ts` | Meta aplikace pro OAuth a `debug_token` |
| `META_GRAPH_VERSION` | tamtéž | výchozí `v21.0` — **ověřit před nasazením**, viz `META_SETUP.md` |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET` | `lib/providers/workflow.ts` | adresa n8n a společné tajemství podpisu |

### Propojení s FoodTabem

| Proměnná | Význam |
|---|---|
| `FOODTAB_APP_URL` | Základ adresy FoodTab Řízení; jediný povolený cíl odkazů „zpět do FoodTabu“ (`lib/auth/kam.ts`). |
| `FOODTAB_ALLOWED_RETURN_ORIGINS` | Další povolené originy oddělené čárkou (např. testovací doména). |
| `FOODTAB_WEBHOOK_SECRET` | Tajemství pro podpis událostí `menu.*` z FoodTabu. **Kód ho zatím nečte** — počítá s ním API v1 (`/api/v1/webhooky/foodtab`), které se píše souběžně. |

### Testy

| Proměnná | Význam |
|---|---|
| `E2E_BASE_URL` | Základ pro Playwright (výchozí `http://localhost:3100`). |

## 5. Přihlášení ve vývoji

- **Demo:** na `/prihlaseni` vyberete účet ze seznamu (`lib/demo-ucty.ts`).
  Server podepíše cookie `ftm_demo` (HMAC s `APP_SECRET`, platnost 7 dní).
- **Supabase:** e-mail → jednorázový kód → `verifyOtp`. Účet se
  přihlášením **nezakládá** (`shouldCreateUser: false`) — přístup je jen
  na pozvánku. Cookie obnovuje `proxy.ts`.

Session říká jen **kdo**. Co smí, rozhoduje databáze
(`marketing.has_access`) a `lib/authz.ts` se jí jen ptá. Provozovna
z adresy (`/[provozovna]/…`) je návrh — `nacistKontext` ji ověří proti
členství a při neshodě přesměruje na `/`.

## 6. Práce s databází

- **Schéma se mění jen migrací** — nový soubor
  `supabase/migrations/RRRRMMDDHHMMSS_nazev.sql`, nikdy úprava nasazené.
  V nových migracích `create table` bez `if not exists` (srážka jmen má
  spadnout nahlas).
- Lokálně migrace pouští `applyMigrations` v `lib/db/driver.ts`
  (historie v `public.marketing_schema_migrations`). U Supabase to dělá
  CLI (`supabase db push`), viz `SUPABASE_SETUP.md`.
- Po změně migrace: `npm run db:reset` (jen PGlite) a `npm run test:db`.
- Každá nová tabulka: `organization_id`, zapnuté RLS, politika, a ke
  scénáři v `tests/db/run.ts` kontrola, že se někdo **nedostane** tam,
  kam nemá.
- PGlite běží pod rolí `authenticated`, která je `nosuperuser`
  (`00_shim.sql`), takže RLS platí i lokálně. Co PGlite **neověří**:
  Supabase Auth, Storage a síť.

## 7. Ověření, že vše funguje

```bash
npm run check     # lint + typecheck + npm test + test:db
npm run test:e2e  # Playwright, potřebuje volný port 3100
```

`test:db` vypíše **osm scénářů** a na konci `N kontrol, 0 selhalo`.
Číslo kontrol je z jednoho běhu `tests/db/run.ts` — když jeden scénář
spadne uprostřed, zbytek neproběhne, proto se dívejte na to, zda skript
došel až ke shrnutí. Osmý scénář jsou schválně vyvolané poruchy:
neplatný klíč, výměna a odpojení připojení, selhání AI i renderu,
vypršelý token Meta až do `dead_letter` a duplicitní webhook.

Kontrola, která nemůže spadnout, je horší než žádná. Když přidáváte
novou, **rozbijte schválně to, co má hlídat, a přesvědčte se, že
zčervená** — teprve pak víte, že tam něco hlídá.

## 8. Časté potíže

- **Změna v CSS se neprojeví** — Turbopack drží starý stylopis. Dotkněte
  se `app/globals.css` nebo smažte `.next/dev` (podrobně v kořenovém
  `CLAUDE.md`).
- **PGlite se otevřela dvakrát** — vývojový server znovu načítá moduly;
  ovladač proto žije v `globalThis.__foodtabMarketingDriver`. Když se
  přesto objeví zámek adresáře, zastavte server a spusťte ho znovu.
- **`permission denied` na sloupci** — u `marketing.profiles` jsou granty
  po sloupcích (e-mail a telefon spolučlenů se nečtou). Nový sloupec na
  takové tabulce se musí udělit zvlášť a ověřit pod rolí `authenticated`.
- **Reset produkční databáze skriptem** nejde — `db:reset` s nastavenou
  `DATABASE_URL` odmítne běžet. Je to schválně.
