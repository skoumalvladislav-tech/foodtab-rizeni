# FoodTab Marketing AI

Samostatná aplikace pro **tvorbu, schvalování a publikování gastro obsahu**
(příspěvky, Story, Reels, tiskové PDF) pro restaurace. Vzniká jako
samostatný projekt ve složce `marketing-ai/` repozitáře FoodTab Řízení
a později se do FoodTabu vloží jako modul `marketing`
(viz `docs/FOODTAB_INTEGRATION.md`).

Aplikace **nenahrazuje sociální sítě ani grafika**. Připraví návrh
(text + obrázek/video) z toho, co restaurace skutečně nabízí, člověk ho
schválí a teprve pak se něco zveřejní. Nikdy automaticky bez schválení.

## Co v repozitáři je a co ne — pravdivě

| Hotové v kódu | Stav |
|---|---|
| Databázové schéma `marketing` (organizace, provozovny, role, média, menu, obsah, schvalování, render, publikace, katalog poskytovatelů) — 4 migrace | hotové, s RLS na každé tabulce |
| Doménová logika: verze obsahu, schválení vázané na otisk, plánování, fronta publikací s opakováním, mediální knihovna, menu (ruční, text, fotografie/PDF přes AI) | hotové, ověřené testem `npm run test:db` proti PGlite |
| Adaptéry poskytovatelů (Claude, Shotstack, Meta Graph, n8n, interní SVG render, mock/manual varianty) | **implementované, ale Claude, Shotstack, Meta a n8n nebyly spuštěny proti skutečné službě** — chybí klíče. Otestované jsou jen mock a vestavěné cesty. |
| Obrazovky | přihlášení, rozcestník, přehled provozovny, zástupný průvodce. Ostatní obrazovky z navigace (tvorba, média, menu, kalendář, schvalování…) **zatím nejsou** |
| REST API `/api/v1/…` | **píše se souběžně**, v této složce zatím žádná route není. Smlouva je v `openapi/openapi.yaml` |
| Testy jednotkové (`npm test`) a e2e (`npm run test:e2e`) | skripty existují v `package.json`, ale složky `tests/unit` a `tests/e2e` **zatím nejsou** — příkazy tedy dnes skončí chybou |

## Rychlé spuštění (demo režim, bez jakéhokoli nastavení)

Potřebujete Node.js **22.13 nebo novější** (`engines` v `package.json`).

```bash
cd marketing-ai
npm install
npm run dev
```

Ve Windows PowerShellu pište `npm.cmd install` a `npm.cmd run dev`
(soubory `.ps1` neprojdou přes zákaz spouštění skriptů).

Otevřete `http://localhost:3000`. Bez jediné proměnné prostředí aplikace
běží v **demo režimu**:

- databáze je PGlite (PostgreSQL ve WebAssembly) v adresáři `.data/pglite`,
  migrace i ukázková data se nasypou při prvním startu,
- soubory se ukládají na disk do `.data/storage`,
- přihlašuje se výběrem demo účtu (žádný e-mail, žádný kód),
- všichni externí poskytovatelé běží jako mock nebo vestavěné —
  **nic se nikam nezveřejní**, publikace skončí ve stavu `published_mock`.

## Demo účty

Definované v `lib/demo-ucty.ts`, adresy jsou na `example.com` a nepatří
žádnému skutečnému člověku. Všechny patří do organizace **FoodTab (demo
organizace)** se dvěma provozovnami — *Černá Perla* a *Bernard Bar Tábor* —
kromě posledního, který je vlastníkem druhé organizace (test oddělení dat).

| E-mail | Jméno | Role | Vidí |
|---|---|---|---|
| `vlastnik@example.com` | Vlasta Vlastníková | Vlastník | obě provozovny, integrace, tým |
| `manazer@example.com` | Marek Manažer | Marketingový manažer | obě provozovny; tvoří, schvaluje, plánuje, publikuje |
| `schvalovatel@example.com` | Simona Schvalovatelka | Schvalovatel | obě provozovny; jen schvaluje nebo vrací |
| `editor-perla@example.com` | Eda Editor | Editor | jen Černá Perla |
| `editor-bernard@example.com` | Bára Bernardová | Editor | jen Bernard Bar Tábor |
| `pozorovatel@example.com` | Petr Pozorovatel | Pozorovatel | jen náhled a analytika |
| `bistro@example.com` | Bohdana Bistrová | Vlastník **druhé** organizace | jen Bistro Centrum, z první organizace nic |

## Příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | vývojový server Next.js |
| `npm run build` / `npm start` | produkční sestavení a spuštění |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | jednotkové testy (`tests/unit/*.test.ts` — složka zatím neexistuje) |
| `npm run test:db` | databázové a doménové scénáře proti čisté PGlite s RLS — **hlavní test projektu** |
| `npm run test:e2e` | Playwright (`tests/e2e` zatím neexistuje; konfigurace spouští aplikaci na portu 3100 v demo režimu) |
| `npm run db:reset` | smaže `.data/pglite` a postaví ji znovu z migrací a seedu; odmítne běžet, když je nastavená `DATABASE_URL` |
| `npm run check` | lint + typecheck + test + test:db |

Testy běží přímo Nodem bez sestavení (`--experimental-strip-types`),
proto mají soubory v `lib/` importy **s příponou `.ts`**.

## Struktura složek

```
marketing-ai/
├── app/                    Next.js 16 (App Router)
│   ├── prihlaseni/         přihlášení: demo účet / e-mail + kód (Supabase OTP)
│   ├── [provozovna]/       obrazovky provozovny (zatím jen prehled/)
│   ├── pruvodce/           průvodce prvním nastavením (zástupný)
│   └── bez-organizace/     stránka pro uživatele bez členství
├── lib/
│   ├── auth/               session (demo cookie / Supabase), bezpečný návrat (kam.ts)
│   ├── authz.ts            autorizační vrstva — ptá se marketing.has_access
│   ├── db/                 ovladač (PGlite / postgres.js), withUser / withService
│   ├── domena/             obsah, fronta, média, menu, UTM, notifikace, stavy
│   ├── providers/          rozhraní (types.ts), registr (registry.ts), adaptéry
│   │   ├── ai/             claude.ts, mock.ts, schema.ts (Zod)
│   │   ├── render/         shotstack.ts, svg.ts, mock-video.ts
│   │   ├── social/         meta.ts, mock.ts, manual.ts
│   │   ├── workflow.ts     n8n + interní fronta, ověření podpisu webhooků
│   │   ├── credentials.ts  AES-256-GCM šifrování přístupových údajů
│   │   └── ostatni.ts      notifikace v aplikaci, mock metriky, ruční menu
│   ├── render/             svg-sablony.ts — vykreslení datových šablon do SVG
│   ├── sablony/katalog.ts  knihovna gastro šablon (data, ne obrázky)
│   ├── seed/               demo data, brand kity, ukázkové obrázky
│   ├── storage/            lokální disk / Supabase Storage, podepsané adresy
│   ├── formaty.ts          rozměry, limity a bezpečné zóny formátů
│   └── cas.ts              čas s povinným pásmem
├── supabase/
│   ├── migrations/         4 migrace schématu marketing (nasazují se supabase db push)
│   └── local/00_shim.sql   náhrada auth.uid() a rolí pro PGlite
├── tests/db/               scénáře proti PGlite (run.ts, harness.ts)
├── scripts/db-reset.ts
├── n8n/                    importovatelná workflow (volitelné)
├── openapi/openapi.yaml    smlouva REST API v1
└── docs/                   dokumentace (níže)
```

## Dokumentace

| Soubor | Pro koho |
|---|---|
| `docs/MANUAL.md` | běžný uživatel — jak se přihlásit, vytvořit, schválit, naplánovat |
| `docs/SETUP.md` | vývojář — nastavení krok za krokem, proměnné prostředí |
| `docs/ARCHITECTURE.md` | architektura, tok dat, stavový automat obsahu |
| `docs/SECURITY.md` | bezpečnost, RLS, tajemství, GDPR, co nelogovat |
| `docs/SUPABASE_SETUP.md` | založení projektu Supabase, migrace, Storage, Auth |
| `docs/DEPLOYMENT.md` | nasazení na Vercel, cron, zálohy, kontrolní seznam |
| `docs/META_SETUP.md` | připojení Instagramu a Facebooku (Meta) |
| `docs/SHOTSTACK_SETUP.md` | render videí přes Shotstack |
| `docs/N8N_SETUP.md` | volitelná automatizace přes n8n |
| `docs/PROVIDER_CATALOG.md` | katalog poskytovatelů a jak přidat nový adaptér |
| `docs/SOCIAL_API_LIMITS.md` | limity sociálních sítí tak, jak jsou v kódu |
| `docs/FOODTAB_INTEGRATION.md` | propojení s FoodTab Řízení |
| `docs/PRODUCT_ROADMAP.md` | etapy 1–3, co je hotové a co zbývá |
| `docs/product-inspiration.md` | co přebíráme z Metricoolu, Bufferu, Lateru, Canvy |

Pravidla FoodTabu (závazná rozhodnutí, pravidla, která se neporušují)
jsou v kořenovém `CLAUDE.md` repozitáře; tenhle projekt je přebírá
(o přístupu rozhoduje jedno místo, dvě obranné linie, rozsah z prohlížeče
je návrh, tajemství jen jako otisk/šifra, kontakty nechodí do jazykového
modelu).
