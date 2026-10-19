# Stav k 19. 10. 2026 — sloučení appky Faktury s Foodtabem

> Zadání 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
> Větev `faktury-slouceni`, PR **#147**. Nic z toho není nasazené:
> nic jsem neslučoval, nespouštěl `db push`, nepřeváděl data a neměnil
> nic ve Vercelu. To všechno je na váš výslovný pokyn.

## Nejdřív to podstatné

- **Co je „appka Faktury":** samostatná databáze (Supabase projekt
  `ctqtwahlzhyjerqulqyn`) s tabulkou faktur a PDF ve **veřejném**
  úložišti. Foodtab do ní dnes sahá druhým spojením: Faktury v appce,
  párování plateb, export pro účetní, Dnes, příjem faktur z e-mailu.
  Původní samostatná appka `faktury-app` na Vercelu do ní umí zapisovat
  taky. n8n je vypnuté a zůstává vypnuté.
- **Po sloučení je jedna appka a jedna databáze.** Faktury mají tabulku
  `faktury` v hlavní databázi Foodtabu, s firmou na každém řádku,
  pravidly přístupu v databázi a skutečnou vazbou na párování plateb.
  PDF se zkopírují do **soukromého** úložiště.
- **Data přestěhuje úloha převodu, kterou spouštíte jen vy** (GitHub →
  Actions → „Faktury — převod do hlavní databáze"). Každý zapisující
  krok chce napsat jeho název. Převod nic nezaokrouhlí ani nezahodí
  potichu. Faktury se otevřou, až databáze porovná **každou fakturu
  pole po poli** se zálohou staré databáze a všechny přílohy budou
  zkopírované.
- **Návrat zpět je připravený** pro každou fázi (oddíl „Připravené").
  Stará databáze zůstává netknutá jako záloha až do úklidu po zkušební
  době.
- **Rozhodnutí pro vás jsou v `otazky.md`, otázky 59–65.** Všude jsem
  zvolil nejopatrnější variantu a appka podle ní funguje, dokud
  nerozhodnete jinak.

## Co je hotové (v kódu, nenasazené)

| co | kde |
|---|---|
| Nové tabulky: faktury, stav převodu, záloha staré databáze, vzory „není faktura" — každá s firmou, pravidly přístupu a hlídáním, kdo smí zapisovat | migrace `20261018100000` |
| Párování plateb a evidence příjmu z e-mailu mají skutečnou vazbu na fakturu (dřív jen text). Fakturu s párováním nejde smazat — jen archivovat | ↑ |
| Spárování a zrušení párování přepne stav faktury **ve stejném kroku** (dřív „pokus" do druhé databáze, který mohl nevyjít) | ↑ |
| Brána: Faktury jsou otevřené jen po dokončení převodu, jinak appka řekne proč (připravují se / stěhují se / vrácené / nezapnuté) | `lib/faktury-brana.ts`, `lib/faktury-pristup.ts` |
| Celá appka čte a zapisuje novou tabulku: Faktury (všech 9 obrazovek), Platby, Dnes, upozornění ve Financích, export pro účetní, příjem z e-mailu, automatické párování z banky | `app/…/faktury`, `platby`, `dnes`, `lib/…` |
| Ručně nahraná fotka faktury jde do soukromého úložiště (dřív veřejné) | `faktury/akce.ts` |
| Export pro účetní píše „číslo faktury (dodavatel)" místo id | `lib/ucetni-export.ts` |
| Úloha převodu (9 kroků: nanečisto, zahájit, převést, přílohy, dokončit, zrušit, vrátit, zpět nanečisto, zpět) | `lib/faktury-prevod*.ts`, `app/api/prevod-faktur`, workflow |
| Druhé spojení na starou databázi má už jen úloha převodu; po úklidu zmizí i ono | `lib/supabase/faktury.ts` |

## Co je otestované — a z čeho jsou čísla

- **Databáze (scénář `krok99`):** 125 kontrol, všechny prošly v PGlite.
  PGlite **neověří** pravidla přístupu ani granty — o tom rozhoduje CI
  „Migrace a scénáře" proti skutečnému PostgreSQL 16: **zelená**, krok99
  tam prošel taky se **125 kontrolami**, celá sada databáze má 3661
  kontrol (commit `ee23b9f`).
  - Pokrývá: zavřené Faktury pro všechny před převodem, porovnání pole
    po poli, dokončení jen když vše sedí (a každé odmítnutí ověřené
    podle důvodu), čtení jen za celou firmu, párování ve stejném kroku,
    cizí firma nikde, úložiště jen do vlastní složky, zrušení převodu,
    vrácení a nové zahájení, zrušení celé firmy.
- **Node testy:** v seznamu CI je **85 sad**, všechny prošly lokálně
  i v CI „Testy aplikace".
  Nové nebo přepsané pro Faktury:
  - `faktury-prevod` 111 kontrol (převod řádku tam a zpátky, částka na
    haléř přesně, čas na mikrosekundy, tři strany návratu zpět);
  - `faktury-tenant-izolace` 66 (každý dotaz do faktur nese firmu, na
    starou databázi sahá jen převod, granty nových tabulek z textu
    migrace — v testovací databázi je ověřit nejde);
  - `faktury-sloupce` 20 (všech 31 dotazů do faktur míří na sloupce,
    které existují);
  - upravené `faktury-filtry` 22, `faktury-prijem-jadro` 83,
    `ucetni-export` 18, `finance-platby-pobocka` 46.
- `tsc` čisté. Sestavení prošlo (`next build --webpack` — Turbopack
  v pracovní kopii vedle hlavní padá na odkazu `node_modules`, s kódem
  to nesouvisí; Vercel náhled je zelený).
- **Schválná rozbití:** 18 v posledním kole, každé spadlo na kontrole,
  na kterou mířilo. Jedno odhalilo kontrolu, která by prošla i bez
  brány, kterou hlídá: dokončení odmítlo kvůli přílohám, ne kvůli
  rozdílu ve faktuře. Kontrola se opravila tak, aby ověřovala i důvod.
- **Kontrola agenty:** 2 kontroly návrhu a 3 nezávislé kontroly hotového
  kódu (databáze 11 nálezů, úloha převodu 13, appka 10). Všechny
  vysoké a střední nálezy jsou opravené, nízké taky, až na vědomé
  výjimky v oddílu „Známé mezery".

## Co je připravené pro vás

**Plán přepnutí** (podrobně `docs/faktury-slouceni-navrh.md`, oddíl 6):

0. Předem: pozastavit `faktury-app` ve Vercelu a smazat
   `FAKTURY_SUPABASE_*` z Preview a Development (otázka 59, bod 1).
1. Sloučit PR → Faktury ukážou „připravují se".
2. `supabase db push` → „stěhují se".
3. Krok **nanecisto**: kolik je faktur, anomálií (musí být 0), visících
   párování. Zapsat si čísla.
4. **zahajit** → **prevest** → **prilohy** (opakuje se sám, dokud je co
   dělat).
5. **nanecisto** → chybí = liší se = navíc = 0.
6. **dokoncit** → Faktury se otevřou. Pustit měřicí dotaz
   `docs/hlaseni/faktury-prevod-mereni.sql` (před i po; dosadit firmu).
7. Zkušební doba 7 dní, každé 2–3 dny **nanecisto**.
8. Úklid (`docs/faktury-slouceni-uklid.sql`) — až po zkušební době.

Odstávka Faktur: od kroku 1 do kroku 6, odhadem 30–60 minut. Příjem
z e-mailu mezitím počká, e-maily zůstanou ve schránce.

**Návrat zpět:**

| kdy | jak |
|---|---|
| jen `db push`, převod nezačal | vrátit PR v `main` |
| převod začal, nedokončený | krok **zrusit**, pak vrátit PR |
| po dokončení, před úklidem | **vratit** → **zpet_nanecisto** → **zpet** (konflikty rozhodnete vy) → vrátit PR |
| po úklidu | jen ze zálohy — proto úklid až po zkušební době |

## Co je blokované / čeká na vás

1. **Sloučení PR, `db push`, převod dat, změny ve Vercelu** — jen na váš
   výslovný pokyn.
2. **Otázky 59–65** (`otazky.md`): kdy přepnout, zkušební doba, Faktury
   a pobočky, Faktury pro další firmy, cizí měna, odkazy u příjemek,
   stará databáze po úklidu, velikost fotky.
3. **Do staré databáze nevidím** (oprávnění k Supabase MCP chybí), proto
   neznám skutečné počty ani anomálie. Ukáže je až krok **nanecisto**.

## Co se pro uživatele mění

- Faktury jsou během převodu (30–60 min) zavřené a appka to říká na
  Fakturách, v Platbách i na Dnes — ne „nic po splatnosti".
- Faktura v cizí měně nebo bez částky: po spárování se stav **nezmění**
  a appka řekne „nastavte ručně" (dřív by skončila jako Uhrazeno).
  Návrhy párování takové faktury nenabízejí.
- Rušit párování smí jen ten, kdo vidí Faktury (mění stav faktury).
- Fakturu s párováním nejde smazat ani „odmítnout jako nefakturu",
  appka řekne „archivujte ji".
- Přílohy a evidenci příjmu čte jen člověk s právem za **celou firmu**
  (dřív přímým dotazem i člen jedné pobočky — hlášení 8. 10.).
- Faktury jsou otevřené jen pro Foodtab s.r.o. (otázka 61).

## Známé mezery (vědomě)

- **Úloha převodu, část se sítí** (čtení staré databáze po stránkách,
  zámek, kopírování příloh) nemá automatický test — testovaná je její
  čistá logika a databázová strana. Proto krok **nanecisto** před
  každým zapisujícím krokem.
- **Fotka u ručně zadané faktury max. 1 MB** (otázka 65). Když se po
  nahrání fotky nepovede uložit fakturu, soubor zůstane v soukromém
  úložišti firmy bez faktury (neškodí, nic ho neukazuje).
- **Typy výsledků dotazů do faktur** si appka přetypovává sama; chybný
  sloupec by prošel překladem. Hlídá to test sloupců nad všemi 31 dotazy.
- Značka „nová cesta párování" v databázi je rozlišení cesty v kódu,
  ne zámek — přihlášený ji nastavit neumí a přímý zápis do párování
  nemá.

## Střety s jinými PR

- **#146 Jiné platby** a **#145 hlídač plánovače:** střet je jen
  v seznamech (CI testy, `run.sh`, `databaze.yml`, `otazky.md`) — při
  slučování ponechat obě strany. Ověřené nanečisto: migrace a scénáře
  všech tří větví poskládané dohromady, celý řetěz v jedné databázi jako
  v CI — 3808 kontrol v PGlite, nic nespadlo (krok97 10, krok98 140,
  krok99 125). Scénáře se nesrážejí (krok97 / 98 /
  99), otázky taky ne (#146 má 50–57, Faktury 59–65).
- Obsahově se #146 Faktur netýká: Jiné platby pracují s **vydanými**
  fakturami (`faktura_cislo`), ne s přijatými, a nesahají na párování
  plateb ani na Faktury.
