# Faktury v hlavní databázi Foodtabu — návrh sloučení a plán přepnutí

**Zadání:** Šéfík 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
Navazuje na otázku 45 (8. 10.: „přestěhovat faktury z odděleného projektu
do appky?") a 46 (veřejný kbelík s PDF). Tím, že chce sloučení, je 45
rozhodnutá — „ano". Způsob přepnutí rozhoduje tenhle dokument; co zbývá
na Šéfíkovi, je v `docs/hlaseni/otazky.md` (otázky 58–62).

## 1. Co je dnes „apka faktury"

| Část | Kde | Stav k 18. 10. |
|---|---|---|
| Původní samostatná appka | repo `skoumalvladislav-tech/faktury-app` (klon `C:\Users\vladi\faktury-app`), vlastní Vercel projekt | obrazovky převzaté do Foodtabu 15. 9. (`/finance/faktury`), sama se už nevyvíjí |
| Data | Supabase projekt `ctqtwahlzhyjerqulqyn` (eu-north-1): `invoices` (3 020 řádků), `rejection_examples` (1), kbelík `faktury-pdf` (veřejný) | RLS „allow all" pro anon klíč, bez `tenant_id`, do projektu se nikdo nepřihlásí |
| Spojení z Foodtabu | `lib/supabase/faktury.ts` (anon klíč, `FAKTURY_SUPABASE_URL/_ANON_KEY`), brána `FAKTURY_DB_TENANT_ID` | jediná izolace firem je ta brána v aplikaci |
| Příjem z e-mailu | `lib/faktury-prijem-*.ts`, úloha `faktury-z-emailu` (GitHub Actions) | evidence `faktury_prijem` a soukromý kbelík `faktury-prilohy` už JSOU v hlavní DB, faktury ale zapisuje do `invoices` v oddělené |
| n8n | workflow `bbHArwVIUQBDNPuI` | vypnutý, naposledy zapsal 5. 9. 2026, **nezapínat** |
| Vazby v hlavní DB | `platby_faktury.faktura_id text`, `faktury_prijem.faktura_id text` (+ nepoužívané `prijemky.faktura_id` volný text, `vybaveni.faktura_id`, `ingredient_purchase_prices.source_invoice_id`) | bez FK — mezi dvěma databázemi nejde |

## 2. Cílový stav

Jedna aplikace, jedna databáze. Faktury jsou tabulky v hlavní DB Foodtabu
se stejnými pravidly jako zbytek Financí:

- `public.faktury` — přijaté faktury. Česká jména sloupců (modul Finance je
  česky, CLAUDE.md „uvnitř modulu se jazyky nemíchají"), částka
  **`castka_haleru integer`** (pravidlo peníze v haléřích), `tenant_id`.
- `public.faktury_vzory_odmitnuti` — dřívější `rejection_examples`, nově s `tenant_id`.
- `public.faktury_prevod` — stav přestěhování za firmu (brána, měření, návrat).
- **Skutečné cizí klíče** `platby_faktury.faktura` a `faktury_prijem.faktura`
  → `faktury(tenant_id, id)`. Složený klíč s `tenant_id` znamená, že
  párování ani evidence nemůže ukázat na fakturu CIZÍ firmy — hlídá to
  databáze sama, ne spoušť, kterou by šlo obejít.
- RLS: číst `faktury.read`, měnit `faktury.manage`, **obojí jen za celou
  firmu** (`app.has_access(tenant_id, …, null)`) — přesně jako dnešní
  aplikace (`pripravit(…, TENANT_SCOPE_SEGMENT)`) a Finance po pobočkách
  (otázka 48, bod 4 a 7).
- Granty revoke→grant: `revoke all … from anon, authenticated`, pak
  jmenovitě, co `authenticated` smí. `service_role` jen to, co potřebují úlohy.
- Párování plateb **v jedné transakci**: nové funkce
  `sparovat_platbu_s_fakturou` / `zrusit_parovani_faktury` /
  `automaticky_sparovat_fakturu` si částku faktury čtou samy z databáze
  (dřív ji musel dodat volající, protože žila jinde) a stav faktury
  („Uhrazeno" / „Částečně uhrazeno") přepnou ve stejné transakci —
  dřív to byl „best-effort" zápis do druhé databáze, který mohl nevyjít.
- PDF: soukromý kbelík `faktury-prilohy` (už existuje), odkaz přes appku
  s kontrolou práva. Staré veřejné odkazy se zkopírují.

Co se schválně **nedělá**:

- Faktury **nedostávají pobočku**. Na pobočce zůstávají schované jako dnes.
  Přiřazování pobočkám je otázka 59 (sloupec se přidá, až bude jasné pravidlo).
- `prijemky.faktura_id` je **volný text, který píše člověk** (číslo faktury
  z papíru), ne id — převod na FK by byl hádání. `vybaveni.faktura_id`
  a `source_invoice_id` nikdo nezapisuje. Zůstávají, jak jsou (otázka 61).
- Cashflow výhled faktury **nezapočítává** do čísel — předpisy plateb
  (nájem, energie) a faktury za totéž by se sečetly dvakrát. Neuhrazené
  faktury se ukazují vedle výhledu jako samostatný údaj (otázka 60).
- Stavy faktur zůstávají textové (jak je psal n8n i příjem). Pevný výčet
  by převod na starých datech shodil.

## 3. Proč dvě migrace a ne jedna

Data jde zkopírovat jen přes úlohu (anon klíč ke staré DB má jen appka).
Migrace běží dřív, než data existují. Proto:

1. **Rozšíření (tahle PR, `20261018100000_faktury_v_hlavni_databazi.sql`)**
   — jen přidává: nové tabulky, nové funkce, nové sloupce `faktura uuid`
   (zatím nepovinné). Staré sloupce `faktura_id text` a staré funkce
   (`potvrdit_alokaci_platby`, `automaticky_sparovat_platbu`) zůstávají
   **beze změny**. Starý kód (při návratu zpět) proto funguje dál.
   Spoušť drží `faktura_id` a `faktura` v souladu oběma směry, takže
   i starý kód po návratu plní cizí klíč, kde faktura existuje.
2. **Úklid (samostatná PR až po zkušební době, návrh v
   `docs/faktury-slouceni-uklid.sql`)** — `faktura` povinné, staré textové
   sloupce a staré funkce pryč, `lib/supabase/faktury.ts` a úloha převodu pryč.
   Nesmí do `main` dřív, než převod proběhne: `db push` by ji pustil
   spolu s první a cizí klíče by spadly na ještě neexistujících fakturách.

## 4. Převod dat (úloha `faktury-prevod`)

Spouští **jen Šéfík**: GitHub → Actions → „Faktury — převod do hlavní
databáze" → Run workflow, s volbou režimu. Úloha
`/api/uloha/faktury-prevod` (Bearer `CRON_SECRET`, jako ostatní úlohy).
Výstup v logu jsou jen souhrnná čísla — repozitář je veřejný.

| Režim | Co dělá | Zapisuje? |
|---|---|---|
| `nanecisto` (výchozí) | přečte starou DB, spočítá měření a rozdíly proti hlavní | nic |
| `zahajit` | zavře Faktury pro vlastníka (stav `probiha`), zapíše měření zdroje | `faktury_prevod` |
| `prevest` | srovná hlavní DB se starou: vloží chybějící, opraví odlišné, smaže převedené, které ve staré už nejsou. Opakovatelné, nic nezdvojí (klíč = původní `id`) | `faktury`, `faktury_vzory_odmitnuti` |
| `prilohy` | zkopíruje PDF ze starého veřejného kbelíku do soukromého, po dávkách; pokračuje, kde skončil | úložiště + `faktury.priloha_cesta` |
| `dokoncit` | databáze sama spočítá měření převedených dat a porovná je se zdrojem; doplní cizí klíče u párování a evidence; když cokoli nesedí, **odmítne** a nic nezmění | `faktury_prevod` → `dokonceno`, `faktura` v párování a evidenci |
| `vratit` | zavře Faktury (stav `vraceno`), aby se v hlavní DB už nic neměnilo | `faktury_prevod` |
| `zpet_nanecisto` / `zpet` | rozdíly hlavní → stará; `zpet` je zapíše do staré DB (vložit, opravit, smazat) | stará DB |

Pravidla převodu (`lib/faktury-prevod.ts`, čistá funkce, testovaná):

- `id` se zachovává → párování plateb a evidence příjmu zůstávají platné.
- Částka: `amount` × 100 musí vyjít na celý haléř a vejít se do `integer`,
  jinak je řádek **anomálie** a převod se nedokončí (nic se nezaokrouhlí potichu).
- Textová pole, data, stav: beze změny. Prázdné příznaky (`null` u
  `needs_review`/`is_duplicate`/`is_archived`) → `false`, počet se vykáže
  (aplikace je i dnes čte jako `=== true`).
- Spoušť „Duplicitní – zkontrolovat" se na převáděné řádky **nevolá** —
  jinak by převod sám přepsal stav u 216 duplicit.
- Zpětný převod je přesná inverze (test: stará → nová → stará = stejný řádek).

**Bez dvojího započítání:** klíčem je původní `id` (vložení `on conflict
do nothing`, rozdíly přes porovnání polí), takže opakovaný běh nic
nezdvojí. Párování plateb se převodem nekopíruje vůbec — ta už
v hlavní DB jsou. Měří se, že jejich počet a součet se převodem nezmění.

## 5. Brána během přestěhování

`lib/faktury-pristup.ts` nahrazuje `lib/supabase/faktury.ts` všude
kromě úlohy převodu (test `faktury-tenant-izolace` to hlídá).

- Firma z `FAKTURY_DB_TENANT_ID` (vlastník staré DB) vidí Faktury, jen když
  je převod `dokonceno`. Jinak hláška „Faktury se stěhují" — a příjem
  z e-mailu i automatické párování ji přeskočí (nic nezapíšou do napůl
  převedených dat; evidence a kurzor schránky zůstanou, doženou se potom).
- Ostatní firmy (nemají co stěhovat) mají Faktury hned — prázdné, vlastní.
- Stav `vraceno` zavře Faktury i vlastníkovi.

## 6. Plán přepnutí (kroky pro Šéfíka)

0. Sloučit PR do `main` (Vercel nasadí). **Faktury se pro Foodtab zavřou**
   („stěhují se") — od teď do staré DB nikdo nezapisuje.
1. `supabase db push` (migrace `20261018100000`).
2. Actions → převod, režim `nanecisto` → zkontrolovat čísla.
3. `zahajit`, `prevest`, znovu `nanecisto` (rozdíly musí být 0).
4. `prilohy` (opakovat, dokud hlásí `zbyva > 0`).
5. `dokoncit` → Faktury se otevřou. Zkontrolovat obrazovky (počty faktur
   na Přehledu, Seznamu a v Platbách sedí s krokem 2).
6. Zkušební doba (otázka 62 — navrhuju 14 dní a jeden měsíční export
   pro účetní). Stará DB zůstává netknutá.
7. Úklid: PR s `docs/faktury-slouceni-uklid.sql` + smazat
   `FAKTURY_SUPABASE_URL`, `FAKTURY_SUPABASE_ANON_KEY`, `FAKTURY_DB_TENANT_ID`
   ve Vercelu = druhé spojení je vypnuté. Starý projekt nechat zálohou
   (nebo smazat — otázka 62).

Odstávka Faktur: od kroku 0 do kroku 5, odhadem 30–60 minut (PDF jsou
nejdelší, ale krok 5 na ně nečeká — dokud se nezkopírují, vede odkaz na
starý veřejný soubor).

## 7. Návrat zpět

| Kdy | Jak |
|---|---|
| Před `dokoncit` | Vercel → Deployments → předchozí nasazení → „Instant Rollback". Stará DB je netknutá, nic se nevrací. Nové tabulky zůstanou prázdné/napůl, nikomu nevadí. |
| Po `dokoncit`, před úklidem | 1) `vratit` (zastaví změny v hlavní DB), 2) `zpet_nanecisto` (co se od přepnutí změnilo), 3) `zpet` (zapíše to do staré DB), 4) Vercel „Instant Rollback". Párování plateb mají díky spoušti vyplněné i staré textové `faktura_id`, starý kód je přečte. |
| Po úklidu | Návrat už jen ze zálohy — proto úklid až po zkušební době. |
