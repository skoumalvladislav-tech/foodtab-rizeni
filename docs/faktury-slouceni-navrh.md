# Faktury v hlavní databázi Foodtabu — návrh sloučení a plán přepnutí

**Zadání:** Šéfík 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
Navazuje na otázku 45 (8. 10.: „přestěhovat faktury z odděleného projektu
do appky?") a 46 (veřejný kbelík s PDF). Tím, že chce sloučení, je 45
rozhodnutá — „ano". Co zbývá na Šéfíkovi: `docs/hlaseni/otazky.md`, 58–63.
Hlášení: `docs/hlaseni/stav-2026-10-18-faktury-slouceni.md`.

Návrh prošel dvěma nezávislými kontrolami před psaním kódu (bezpečnost
databáze; bezpečnost přepnutí dat) — 27 nálezů, zapracované. Hotový kód
prošel další trojicí kontrol (viz hlášení).

## 1. Co je dnes „apka faktury"

| Část | Kde | Stav k 18. 10. |
|---|---|---|
| Původní samostatná appka | repo `skoumalvladislav-tech/faktury-app` (klon `C:\Users\vladi\faktury-app`), vlastní Vercel projekt, **bez přihlášení**, veřejný klíč v prohlížeči | obrazovky převzaté do Foodtabu 15. 9. (`/finance/faktury`); pořád ale může do staré databáze zapisovat (otázka 58, bod 1) |
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
  Nově za celou firmu i přílohy a evidence příjmu (otázka 59).
- **Brána podle stavu převodu — v databázi, pro všechny role**
  (`app.faktury_brana`): zapisovat do faktur jde jen u firmy ve stavu
  `dokonceno`; úloha převodu jen ve stavu `probiha`; párování plateb se
  během převodu nemění (`app.platby_faktury_brana`).
- **Párování v jedné transakci:** `sparovat_platbu_s_fakturou`,
  `zrusit_parovani_faktury`, `automaticky_sparovat_fakturu` si částku
  faktury čtou samy a stav přepnou ve stejné transakci (dřív best-effort
  zápis do druhé databáze). Faktura v cizí měně nebo bez částky: stav
  se nezmění (otázka 61).
- **Přílohy:** soukromý kbelík `faktury-prilohy`; kopie ze staré
  databáze pod otiskem obsahu (zapisuje jen úloha), ruční nahrání do
  `<firma>/rucne/` — podvrhnout soubor pod cizí otisk nejde.

Schválně se **nedělá**: pobočky faktur (otázka 59), Faktury pro další
firmy (otázka 60), cizí klíč u příjemek/vybavení (otázka 62), pevný výčet
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
z Preview a Development, n8n nechat vypnuté (otázka 58, bod 1).

0. Sloučit PR do `main` (Vercel nasadí). Faktury: „připravují se".
1. `supabase db push` (migrace `20261018100000`). Faktury: „stěhují se".
2. Krok `nanecisto` → anomálie 0? Zapsat si čísla (stara_faktur…).
3. `zahajit` → `prevest` (opakovat, dokud „pokracovat").
4. `prilohy` (opakovat, dokud „pokracovat"; nepovedené přílohy si přečíst).
5. `nanecisto` → chybi = lisi = navic = 0.
6. `dokoncit` → Faktury se otevřou. Zkontrolovat počty na Přehledu,
   Seznamu a v Platbách proti kroku 2; pustit měřicí SQL.
7. Zkušební doba (navrhuju 7 dní, otázka 58, bod 5); každé 2–3 dny `nanecisto`.
8. Úklid (`docs/faktury-slouceni-uklid.sql`) — druhé spojení vypnuté.

Odstávka Faktur: od kroku 0 do kroku 6, odhadem 30–60 minut.

## 7. Návrat zpět

| Kdy | Jak |
|---|---|
| Před `zahajit` (jen `db push`) | Revert PR v `main` (Faktury se vrátí na starou databázi, ta je netknutá). Nové tabulky zůstanou, nikomu nevadí. |
| Po `zahajit`, před `dokoncit` | 1) `zrusit` (bez něj by předchozí verze appky nemohla párovat — v `probiha` se párování nemění), 2) revert PR v `main`. Stará databáze je netknutá; v appce mezi tím nic nevzniklo (Faktury byly zavřené). |
| Po `dokoncit`, před úklidem | 1) `vratit`, 2) `zpet_nanecisto`, 3) `zpet` (opakovat, dokud nehlásí 0 k přenesení; konflikty rozhodne člověk), 4) revert PR v `main`. Párování mají vyplněné i staré textové `faktura_id`, předchozí verze appky je přečte a stará cesta párování je ve stavu `vraceno` otevřená. |
| Po úklidu | Jen ze zálohy — proto úklid až po zkušební době. |

Vercel „Instant Rollback" jen v nouzi: po něm Vercel přestane sám
nasazovat `main` (otázka 58, bod 6).
