# Night run status — Finance a účetnictví (gastro ERP)

Větev: `finance-ucetnictvi-erp` (worktree `C:\Users\vladi\foodtab-finance-erp`,
založeno z `main` @ `6609630`, tj. po nasazení katalogu surovin/receptur
2. 10. 2026). Vlastní samostatný `node_modules` (junction na
`foodtab-nasazeni`).

Předchozí noc (gastro ERP + marketing, `gastro-erp-marketing` větev) je
hotová a sloučená — vlastní historie v `main`, ne tady. Tenhle soubor
popisuje JEN tuhle novou práci (Finance/účetnictví).

Plán: `C:\Users\vladi\.claude\plans\proud-scribbling-glade.md`, oddíl
„Finance a účetnictví — gastro ERP modul" (odsouhlasený Šéfíkem
2.–3. 10. 2026). Zadání: `docs/Foodtab_Claude_Code_nocni_zadani.md`,
oddíly 4–11 (cílový stav), 12 (priority), 13 (akceptační scénáře).

## Závazný mantinel

**Sklad/inventury (fyzické pohyby, příjemky/výdejky, šarže) se NESTAVÍ.**
Rozhodnutí Šéfíka 2. 10. 2026 (`eb9bd63`, v `main`) — dělá to Dotykačka,
appka si to nemá duplikovat. Teoretická spotřeba (recept × prodané
množství) ano, fyzická inventura nikdy. Dodrženo v celé téhle práci.

## Hotovo — celé P0 podle plánu

| Co | Commit |
|---|---|
| Krok 0: izolace Faktur donesena z `gastro-erp-marketing` | `4c98277` |
| Plán zapsán, stav | `2c2f534` |
| Migrace 1–6: `integrace_pripojeni`/`integrace_tajemstvi`, `kontakty`(_osoby), `platebni_ucty`/`import_davky`/`transakce`, `platby_faktury`, `predpisy_plateb`, `app.cashflow_prehled`(_firma) + `krok73`/`krok74_scenar.sql` | `a39eb1c` |
| `public.*` průzor pro PostgREST (cashflow_prehled*, integrace_uloz/precti/smaz_tajemstvi) + `finance/layout.tsx`+`navigace.tsx` + nabídka | `ad63683` |
| `lib/finance-prehled.ts`, `finance-plan.ts`, `finance-parovani.ts`, `finance-csv-import.ts` + 3 nové `*.test.mjs` | `61a8aeb` |
| Obrazovky Přehled/Kontakty/Platby + `public.importovat_transakce` + `krok76_scenar.sql` | `069e5b6` |
| Obrazovka Integrace + CSV import (dvoukrokový náhled/potvrzení) | `2712805` |

Žádná migrace nečeká na SQL od Šéfíka (na rozdíl od kroku 0 — Faktury
samy pořád čekají na jeho ruční SQL, viz `docs/hlaseni/faktury-tenant-izolace-2026-10-02.md`,
beze změny od minulé noci).

## Nasazeno do `foodtab-test`

PR [#104](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/104)
sloučen do `main` (`94e6ed6`) po zeleném CI proti reálnému PostgreSQL
(oprava `krok74_scenar.sql` níž). `supabase db push` proběhl —
`migration list --linked` ukazuje všech 170 migrací `local`=`remote`,
včetně nových 8 (`20261003100000`–`20261003170000`).

Ověřeno po nasazení (`supabase db query`, čtecí dotazy):
- všech 9 nových tabulek existuje (`integrace_pripojeni`, `integrace_tajemstvi`,
  `kontakty`, `kontakty_osoby`, `platebni_ucty`, `import_davky`, `transakce`,
  `platby_faktury`, `predpisy_plateb`);
- všech 11 funkcí existuje na svém místě (5 v `app.*`, 6 v `public.*` včetně
  `importovat_transakce`, která `app.*` protějšek nemá);
- RLS zapnuté na všech pěti kontrolovaných tabulkách; `integrace_tajemstvi`
  má `authenticated` jen SELECT (žádný insert/update/delete), `transakce`
  jen insert/select (žádný update/delete) — přesně podle návrhu; `anon`
  nikde nic;
- `trg_firma_transakce` (druhá linie), `trg_audit_transakce` a
  `transakce_no_update` (immutabilita) existují na `transakce`;
- `public.cashflow_prehled('00000000-...')` proběhlo bez chyby, vrátilo
  prázdno pro neexistující firmu (žádný pád).

## Čísla — a z čeho jsou

- **PGlite** (`node scripts/scenare-pglite.mjs`): **3098 kontrol, nic
  nespadlo.** Nové scénáře: `krok73` (19), `krok74` (28), `krok75` (11),
  `krok76` (12) — registrovány v `supabase/tests/run.sh`. **PGlite
  neověří RLS ani sloupcové granty** — rozhoduje až `supabase/tests/run.sh`
  proti reálnému PostgreSQL (GitHub Actions), který jsem nepustil (žádný
  lokální PostgreSQL v tomhle prostředí, stejná situace jako minulé noci).
- `node scripts/provoz-granty.test.mjs`: **čisté**, nové tabulky mají
  revoke-před-grant přesně podle vzoru.
- **4 nové `scripts/*.test.mjs`** (čistá logika, bez databáze): `finance-plan`
  (20 kontrol), `finance-parovani` (14), `finance-csv-import` (30),
  `integrace-klice` (34) — **98 kontrol, všechny prošly.** `integrace-klice`
  je ve `VYNECHANE` v `.github/workflows/aplikace.yml` (stejný důvod jako
  `marketing-klice` — `import 'server-only'` bez podmínky `react-server`
  v generickém běhu CI spadne na záměrné výjimce toho balíčku).
- `npx tsc --noEmit`: **čisté** napříč celou větví.
- `npx eslint .`: **0 chyb**, 9 varování — všechna předcházející téhle
  práci (nesouvisí s Financemi).

## Na co jsem narazil a nešlo to hned

- **`ON DELETE SET NULL` na `import_davka_id` kolidovalo s immutabilitou
  ledgeru.** `transakce_no_update` (pravidlo na UPDATE) blokuje i interní
  UPDATE, který by FK akce SET NULL potřebovala při mazání `import_davky`
  — PGlite na to spadlo hláškou „referential integrity query ... gave
  unexpected result". Oprava: `on delete restrict`. Zdokumentováno
  v migraci `20261003120000_platebni_ucty_transakce.sql`.
- **Druhé kolo (CI proti reálnému PostgreSQL, po otevření PR #104):**
  `krok74_scenar.sql` spadl, protože PGlite a reálný PostgreSQL hlásí
  tohle RESTRICT porušení JINÝM kódem — PGlite 23001 („violates RESTRICT
  setting..."), reálný Postgres obyčejné 23503 („violates foreign key
  constraint...", stejně jako NO ACTION — RESTRICT se od NO ACTION liší
  jen v odložitelnosti, ne v chybovém kódu při porušení). Test teď
  přijímá oba kódy. `krok75_scenar.sql` padal jako DŮSLEDEK tohohle —
  `krok74` se zastavil (`ON_ERROR_STOP`) dřív, než doběhl do svého
  úklidu, a zbylá transakce na Černé Perle/dnešním datu zkreslila
  `krok75`ho součet cashflow. Žádná oprava v `krok75` nebyla potřeba,
  jen doběhnutí `krok74` do konce.
- **`INSERT ... ON CONFLICT` na `transakce` nejde použít VŮBEC** —
  skutečné omezení PostgreSQL („cannot be used with table that has
  INSERT or UPDATE rules"), ne PGlite. Platí pro JAKÉKOLI pravidlo na
  tabulce, i když se netýká INSERTu. `public.importovat_transakce`
  (idempotentní hromadný import) proto dedupuje anti-joinem před
  insertem, ne `ON CONFLICT`. Zdokumentováno v
  `20261003170000_import_transakce_rpc.sql`.
- **`supabase.rpc()` z appky vidí jen schéma `public`** (PostgREST,
  `supabase/config.toml`) — všechny `app.*` funkce z migrací 1 a 6
  potřebovaly tenký přeposílající obal v `public` (`20261003160000_finance_public_rpc.sql`),
  stejný vzor jako `public.has_access`. Bez něj by appka na ně vůbec
  nedosáhla, ověřilo by se to až při psaní obrazovek.
- **Vizuální ověření v prohlížeči se nedokončilo.** Spustil jsem lokální
  dev server (`--webpack`, port 3101, stejná poznámka o Turbopacku jako
  u jiných pracovních kopií) a ověřil, že všech pět nových cest
  (`/finance`, `/finance/kontakty`, `/finance/platby`, `/finance/platby/import`,
  `/finance/integrace`) se bez přihlášení SPRÁVNĚ přesměruje na
  `/prihlaseni?kam=...` — tedy že se každá stránka serverově vykreslí
  bez pádu. **Přihlásit se ale nešlo**: appka používá kód z e-mailu
  (Supabase OTP), a odeslání toho formuláře by poslalo skutečný e-mail
  na `majitel@foodtab.cz` jménem uživatele — to bez výslovného svolení
  nedělám (a i kdybych ho poslal, nemám k té schránce přístup, abych kód
  přečetl). **Žádná z nových obrazovek tedy nebyla viděná PO
  přihlášení** — ne tabulka Přehledu, ne formuláře, ne navigace v
  levém sloupci. Riziko: vizuální chyba (rozbité CSS, špatně napojené
  pole formuláře) by tímhle neprošla. Doporučení: až bude Šéfík u
  počítače, otevřít `/firma/finance` po běžném přihlášení a projet
  všech pět obrazovek.
- **`.env.local` do worktree zkopírován** z `foodtab-rizeni` (stejný
  `foodtab-test` projekt) + vygenerovaný `INTEGRACE_KLIC_SIFRY` navíc —
  jen pro lokální test, je v `.gitignore`, nikam se neposílá.

## Vědomé mezery v P0 (ne skryté, prostě nestihnuté)

- **Kontaktní osoby** (`kontakty_osoby`) nemají vlastní obrazovku —
  tabulka a RLS existují a jsou scénářem ověřené, ale `finance/kontakty`
  je nekreslí ani nenabízí přidat. Rozšíření o jednu sekci na detailu
  kontaktu.
- **`predpisy_plateb`** se dají jen přes RLS/scénář, appka pro ně nemá
  vlastní formulář (Přehled je jen ČTE pro rozpočet plánu). Doplnit
  jednoduchý CRUD, podobný `platby/page.tsx`.
- **Párování** v `platby/page.tsx` nabízí jen JEDEN nejlepší návrh na
  transakci, ne výběr z víc kandidátů, a nemá tlačítko „odmítnout"
  (zamítnutý návrh se příští načtení prostě znovu nabídne). Funkční pro
  P0, ale chybí UI pro případ, kdy je nejlepší návrh špatný.
- Vizuální ověření viz výš.

## P1 (podle plánu, nedotčeno)

Objednávky dodavatelům + příjem zboží (bez fyzického skladu), kostra
adaptéru na Dotykačku, prime-cost report, zobecněný účetní export. Nic
z toho nebylo v týhle noci rozpracováno.

## Rozhodnutí a otázky

Žádné nové otázky pro Šéfíka nad rámec toho, co stálo v plánu. Faktury
pořád čekají na jeho SQL krok (nezměněno od minulé noci) — Finance na
něm nezávisí, modul funguje i bez něj.
