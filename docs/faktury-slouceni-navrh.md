# Faktury v hlavní databázi Foodtabu — návrh sloučení a plán přepnutí

**Zadání:** Šéfík 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
Navazuje na otázku 45 (8. 10.: „přestěhovat faktury z odděleného projektu
do appky?") a 46 (veřejný kbelík s PDF). Tím, že chce sloučení, je 45
rozhodnutá — „ano". Co zbývá na Šéfíkovi: `docs/hlaseni/otazky.md`, 59–65.
Hlášení: `docs/hlaseni/stav-2026-10-18-faktury-slouceni.md`.

Návrh prošel dvěma nezávislými kontrolami před psaním kódu (bezpečnost
databáze; bezpečnost přepnutí dat) — 27 nálezů, zapracované. Hotový kód
prošel další trojicí kontrol (viz hlášení).

## 1. Co je dnes „apka faktury"

| Část | Kde | Stav k 18. 10. |
|---|---|---|
| Původní samostatná appka | repo `skoumalvladislav-tech/faktury-app` (klon `C:\Users\vladi\faktury-app`), vlastní Vercel projekt, **bez přihlášení**, veřejný klíč v prohlížeči | obrazovky převzaté do Foodtabu 15. 9. (`/finance/faktury`); pořád ale může do staré databáze zapisovat (otázka 59, bod 1) |
| Data | Supabase projekt `ctqtwahlzhyjerqulqyn`: `invoices` (3 020 řádků 18. 10.), `rejection_examples` (1), kbelík `faktury-pdf` (veřejný) | RLS „allow all" pro veřejný klíč, bez `tenant_id`, do projektu se nikdo nepřihlásí |
| Spojení z Foodtabu | `lib/supabase/faktury.ts` (veřejný klíč, `FAKTURY_SUPABASE_URL/_ANON_KEY`), brána `FAKTURY_DB_TENANT_ID` | izolace firem jen v aplikaci |
| Příjem z e-mailu | `lib/faktury-prijem-*.ts`, úloha `faktury-z-emailu` | evidence a soukromý kbelík `faktury-prilohy` v hlavní DB; faktury zapisoval do staré |
| n8n | workflow `bbHArwVIUQBDNPuI` | vypnutý od 5. 9. 2026, **nezapínat** |
| Vazby v hlavní DB | `platby_faktury.faktura_id text`, `faktury_prijem.faktura_id text` (+ `prijemky.faktura_id` volný text, `vybaveni.faktura_id`, `source_invoice_id` nepoužívané) | bez cizího klíče |

## 2. Cílový stav (migrace `20261018100000_faktury_v_hlavni_databazi.sql`)

- `public.faktury` — přijaté faktury, česká jména sloupců, částka
  **`castka_haleru integer`**, `tenant_id`, `id` zachované ze staré databáze.
- `public.faktury_vzory_odmitnuti` — dřív `rejection_examples`, s firmou.
- `public.faktury_prevod` — stav převodu za firmu (`probiha` → `dokonceno`
  → případně `vraceno`), měření, nepovedené přílohy, zámek úlohy.
- `public.faktury_prevod_zdroj` — **doslovná kopie** řádků staré databáze:
  základ pro porovnání pole po poli, pro návrat zpět a záloha (otázka 45).
- **Skutečné cizí klíče** `platby_faktury.faktura`, `faktury_prijem.faktura`
  → `faktury(tenant_id, id)`: odkaz na fakturu cizí firmy odmítne databáze.
  Fakturu s párováním nejde smazat (dřív zůstal viset text).
- **RLS jen za celou firmu** (`faktury.read` čte, `faktury.manage` mění),
  počítané jednou za dotaz (`app.firmy_s_pristupem`), ne pro každý řádek.
  Nově za celou firmu i přílohy a evidence příjmu (otázka 60).
- **Brána podle stavu převodu — v databázi, pro všechny role**
  (`app.faktury_brana`): zapisovat do faktur jde jen u firmy ve stavu
  `dokonceno`; úloha převodu jen ve stavu `probiha`; párování plateb se
  během převodu nemění (`app.platby_faktury_brana`).
- **Párování v jedné transakci:** `sparovat_platbu_s_fakturou`,
  `zrusit_parovani_faktury`, `automaticky_sparovat_fakturu` si částku
  faktury čtou samy a stav přepnou ve stejné transakci (dřív best-effort
  zápis do druhé databáze). Faktura v cizí měně nebo bez částky: stav
  se nezmění (otázka 62).
- **Přílohy:** soukromý kbelík `faktury-prilohy`; kopie ze staré
  databáze pod otiskem obsahu (zapisuje jen úloha), ruční nahrání do
  `<firma>/rucne/` — podvrhnout soubor pod cizí otisk nejde.

Schválně se **nedělá**: pobočky faktur (otázka 60), Faktury pro další
firmy (otázka 61), cizí klíč u příjemek/vybavení (otázka 63), pevný výčet
stavů, limity délky převzatých textů, započítání faktur do cashflow
výhledu (předpisy plateb a faktury za totéž by se sečetly dvakrát).

## 3. Proč dvě migrace a ne jedna

1. **Rozšíření (tahle PR)** jen přidává. Staré textové `faktura_id`
   a staré funkce párování zůstávají, aby po návratu zpět fungovala
   předchozí verze appky. Po dokončení převodu je databáze zavře
   (`app.platby_faktury_brana`), po vrácení zase otevře.
2. **Úklid** (`docs/faktury-slouceni-uklid.sql`, samostatná PR po zkušební
   době) — `faktura` povinné, staré sloupce a funkce pryč, staré spojení
   pryč. Nesmí do `main` dřív než převod: `db push` by ho pustil hned.

## 4. Úloha převodu

Spouští **jen Šéfík**: GitHub → Actions → „Faktury — převod do hlavní
databáze" → Run workflow, krok + potvrzení (napsat název kroku). Adresa
`/api/prevod-faktur` (Bearer `CRON_SECRET`, mimo `/api/uloha` — plánovač
ji nezná). Do veřejného logu jdou jen čísla.

| Krok | Smí ve stavu | Co dělá |
|---|---|---|
| `nanecisto` | kdykoli | jen čte: anomálie, rozdíly, měření, visící párování; po dokončení i „změnilo se ve staré od převodu" |
| `zahajit` | bez řádku, `vraceno` | Faktury firmy se zavřou; odmítne, když jsou anomálie nebo 0 faktur; po vrácení odmítne, dokud `zpet` nepřenesl všechny změny z appky (jinak by je převod přepsal); uvolní uuid faktur v párování |
| `prevest` | `probiha` | kopie staré databáze + vložení / oprava / smazání faktur, opakovatelné; víc než 20 mazání jen s volbou |
| `prilohy` | `probiha`, `dokonceno` | PDF ze starého veřejného kbelíku do soukromého, po dávkách; odkazy příjmu z e-mailu se nestahují (vedou na appku), vezme se soubor evidence |
| `dokoncit` | `probiha` | stará databáze se od posledního převodu nesmí změnit; databáze porovná každou fakturu pole po poli, počty, přílohy; teprve pak `dokonceno` a doplní cizí klíče |
| `zrusit` | `probiha` | cesta ven bez dokončení: stav `vraceno` — Faktury v appce zůstanou zavřené, stará cesta párování se otevře (pro předchozí verzi appky) |
| `vratit` | `dokonceno` | Faktury v appce se zavřou, stará cesta párování se otevře |
| `zpet_nanecisto` / `zpet` | `vraceno` | tři strany (kopie z dokončení, appka, stará): přenese jen změny z appky; co se změnilo i ve staré, je konflikt a nepřepíše se |

Pravidla převodu řádku (`lib/faktury-prevod.ts`): `id` se zachová; částka
na celé haléře **přesně, nebo anomálie**; text, data a stav beze změny;
prázdné příznaky → `false` (vykáže se); převedené řádky spoušť duplicit
neoznačuje (podle převodní značky). Čtení staré databáze po stránkách
podle id, ale počet se ověřuje zvlášť (`count=exact`) — krátké čtení by
jinak vypadalo jako „faktura ve staré databázi není" a převod by mazal.

**Bez dvojího započítání:** klíč je původní `id`, kopie se srovnává
porovnáním; párování plateb se nekopíruje (už v hlavní databázi jsou),
jen se jim doplní uuid faktury. `docs/hlaseni/faktury-prevod-mereni.sql`
to měří před a po.

## 5. Brána v appce (`lib/faktury-pristup.ts`, `lib/faktury-brana.ts`)

Faktury jsou otevřené jen ve stavu `dokonceno`. Jinak věta: „připravují
se" (kód je venku dřív než `db push`), „stěhují se" (vlastník staré
databáze), „vrácené", „zatím nejsou zapnuté" (ostatní firmy). Příjem
z e-mailu a automatické párování zavřenou firmu přeskočí (schránku ani
nečtou). Dnes, Platby a upozornění ve Financích se zavřenými Fakturami
řeknou proč (stěhují se, vrácené, chyba) — ne „nic po splatnosti";
chyba dotazu se nepočítá jako nula. Každý dotaz nese firmu
(`fakturyFirmy`).

## 6. Plán přepnutí (kroky pro Šéfíka)

**Předem:** pozastavit `faktury-app` ve Vercelu, smazat `FAKTURY_SUPABASE_*`
z Preview a Development, n8n nechat vypnuté (otázka 59, bod 1).

**Pořadí PR:** Jiné platby (#146, migrace `20261016100000`) se slučují
PŘED Fakturami (#147, `20261018100000`); hlídač plánovače (#145) je
přerazítkovaný na `20261019120000` a jde až po nich. `db push` odmítne
migraci starší než poslední nasazenou (stalo se u #86/#88, hlášení 29. 9.)
— PR s pozdějším sloučením se proto před sloučením přerazítkuje.
Hlídá to workflow „Migrace jen přibývají" (`.github/workflows/migrace-poradi.yml`),
které přichází samostatnou PR **#148 — ta se slučuje úplně první**
(pořadí #148 → #146 → #147 → #145). Kdyby přišlo jen s #147, revert #147 by
ho smazal a právě smazanou migraci by nehlídalo (GitHub bere workflow ze
stromu kontrolovaného commitu).

0. Sloučit PR do `main` (Vercel nasadí). Faktury: „připravují se".
   Od teď pouští GitHub krok `nanecisto` sám každé 2 dny — stará databáze
   neusne, ani když se převod zdrží.
1. Krok `nanecisto` — jde ještě PŘED `db push` (čte jen starou databázi).
   Anomálie > 0 → zastavit a vrátit kód (oddíl 7, první řádek); nic se
   nenasadilo. Jinak si zapsat čísla (stara_faktur, stara_archivovanych,
   stara_duplicit, stara_s_odkazem_pdf, stara_men, stara_vzoru).
2. `npx supabase migration list --linked` → nenasazená smí být JEN
   `20261018100000`. Čeká-li i jiná, zastavit a zeptat se.
   Pak `supabase db push`. Faktury: „stěhují se".
3. `zahajit` → `prevest` (opakovat, dokud „pokracovat").
4. `prilohy` (opakovat, dokud „pokracovat"; nepovedené přílohy si přečíst).
   Přechodně nepovedené (stará databáze neodpověděla) se zkusí znovu
   za 10 minut a dokončení je do té doby nepustí; trvalé (404, typ,
   velikost) se vykážou a dokončení je pustí.
5. `nanecisto` → chybi = lisi = navic = 0.
6. `dokoncit` → Faktury se otevřou. Zkontrolovat počty na Přehledu,
   Seznamu a v Platbách proti kroku 1; pustit měřicí SQL (součty po
   měnách z hlavní databáze proti `zdroj_pri_zahajeni`).
7. Zkušební doba (navrhuju 7 dní, otázka 59, bod 5); `nanecisto` běží
   samo každé 2 dny — výsledek v Actions.
8. Úklid (`docs/faktury-slouceni-uklid.sql`) — druhé spojení vypnuté,
   workflow převodu (i s plánem) smazat.

Odstávka Faktur: od kroku 0 do kroku 6, odhadem 30–60 minut.

## 7. Návrat zpět

| Kdy | Jak |
|---|---|
| Před `db push` (anomálie v kroku 1) | Revert PR v `main` — migrace ještě nikde není, smazat soubor smí. Workflow „Migrace jen přibývají" tu zčervená (smazaná migrace) — to je **očekávané**, revert sloučit i tak. |
| Po `db push`, před `zahajit` | **Vrátit kód BEZ souboru migrace** (postup níž). Faktury se vrátí na starou databázi, ta je netknutá; nové tabulky zůstanou, nikomu nevadí. |
| Po `zahajit`, před `dokoncit` | 1) `zrusit` (bez něj by předchozí verze appky nemohla párovat — v `probiha` se párování nemění), 2) vrátit kód bez souboru migrace. Stará databáze je jediná platná: `zpet` po zrušení do ní nic nezapíše (kopie není stav z dokončení). Nový pokus: `zahajit`. |
| Po `dokoncit`, před úklidem | 1) `vratit`, 2) `zpet_nanecisto`, 3) `zpet` — i při samých nulách; po přenosu ověří nový plán a návrat označí jako hotový (konflikty rozhodne člověk), 4) vrátit kód bez souboru migrace. Párování mají vyplněné i staré textové `faktura_id`, předchozí verze appky je přečte a stará cesta párování je ve stavu `vraceno` otevřená. Další pokus o převod (`zahajit`) pak převezme i změny, které mezitím udělala stará appka. |
| Po úklidu | Jen ze zálohy — proto úklid až po zkušební době. |

**Vrácení kódu bez souboru migrace.** Obyčejný revert PR by smazal
`supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql`, i když
je migrace v historii databáze. Další `db push` (i u jiných PR) by pak
spadl na „Remote migration versions not found in local migrations
directory" a oprava přes `migration repair` by při novém sloučení #147
spustila migraci znovu (`already exists`). Proto:

```
git revert --no-commit -m 1 <sloučení #147>
git checkout HEAD -- supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql supabase/tests/krok99_scenar.sql supabase/tests/run.sh .github/workflows/databaze.yml .github/workflows/migrace-poradi.yml scripts/migrace-poradi.mjs scripts/otazky-cisla.test.mjs
git commit
```

(Hlídač a test otázek jsou v seznamu pro případ, že #148 nebyla sloučená
dřív — pak by je revert #147 smazal. Mezitím sloučené #145/#146 mohou
v `aplikace.yml` a `otazky.md` chtít ruční dořešení; řádek
`otazky-cisla` v `aplikace.yml` musí zůstat.) `migration repair` nedělat.
Když je #148 v main, obyčejný revert (i tlačítko Revert na GitHubu)
workflow „Migrace jen přibývají" zastaví — smazaný soubor migrace.

Vercel „Instant Rollback" jen v nouzi: po něm Vercel přestane sám
nasazovat `main` (otázka 59, bod 6).
