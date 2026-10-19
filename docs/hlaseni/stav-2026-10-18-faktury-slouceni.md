# Stav k 19. 10. 2026 — sloučení appky Faktury s Foodtabem

> Zadání 18. 10. 2026: „potřebuji sloučit apku faktury s apkou foodtab".
> Větev `faktury-slouceni`, PR **#147**. Nic z toho není nasazené:
> nic jsem neslučoval, nespouštěl `db push`, nepřeváděl data a neměnil
> nic ve Vercelu. To všechno je na váš výslovný pokyn.
>
> **Doplněno 19. 10. odpoledne:** nezávislá kontrola PR #147 (4 pohledy,
> každý nález ověřený dalším agentem) našla 19 platných nálezů — opravené
> jsou všechny, viz oddíl „Kontrola PR #147 (19. 10.)". Otázky Faktur jsou
> nově **59–65** (58 patří Jiným platbám).

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
  době. Do staré databáze se při návratu píše JEN po dokončeném převodu.
- **Pořadí sloučení:** Jiné platby (#146) → Faktury (#147) → hlídač
  plánovače (#145). Jinak `db push` starší migraci odmítne.
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
| Celá appka čte a zapisuje novou tabulku: Faktury (všech 9 obrazovek), Platby, Dnes, Finance → Přehled, export pro účetní, příjem z e-mailu, automatické párování z banky | `app/…/faktury`, `platby`, `dnes`, `lib/…` |
| Ručně nahraná fotka faktury jde do soukromého úložiště (dřív veřejné) | `faktury/akce.ts` |
| Export pro účetní píše „číslo faktury (dodavatel)" místo id | `lib/ucetni-export.ts` |
| Úloha převodu (9 kroků: nanečisto, zahájit, převést, přílohy, dokončit, zrušit, vrátit, zpět nanečisto, zpět); nanečisto běží samo každé 2 dny | `lib/faktury-prevod*.ts`, `app/api/prevod-faktur`, workflow |
| Kontrola „Migrace jen přibývají" na každém PR a po sloučení do main | `.github/workflows/migrace-poradi.yml` |
| Druhé spojení na starou databázi má už jen úloha převodu; po úklidu zmizí i ono | `lib/supabase/faktury.ts` |

## Kontrola PR #147 (19. 10.)

Nezávislá kontrola ve 4 pohledech (databáze, převod, appka, střet s #146
a #145). 19 platných nálezů (17 potvrzených, 2 možné), 1 vyvrácený.
Opravené jsou **všechny**:

**Vysoké**

1. **Převod zrušený uprostřed by při návratu mazal ve staré databázi.**
   Po zrušení převodu (třeba když vypršel čas) byla v záloze celá stará
   databáze, v hlavní jen část — návrat by chybějící faktury bral za
   „smazané v appce" a smazal je ve staré databázi, jediné platné. Teď:
   záloha je základ návratu jen po DOKONČENÉM převodu; po zrušení krok
   „zpet" do staré databáze nic nezapíše a nový pokus vezme starou
   databázi tak, jak je. Mazání ve staré databázi má i strop 20.
2. **Stará databáze mohla usnout dřív, než převod začne.** Po sloučení
   na ni nic nesahá a Free projekt po 7 dnech usne — převod ani návrat
   by pak nešly. Teď: krok „nanecisto" čte starou databázi PRVNÍ, jde
   i před `db push` (anomálie se tak ukážou dřív, než se cokoli nasadí),
   a GitHub ho pouští sám každé 2 dny od sloučení (jen čte).

**Střední**

3. Kontroly s **cizí firmou** chyběly u rušení párování, u hledání
   duplicit a u čtení stavu převodu — doplněné; každá spadne, když se
   filtr firmy vyndá.
4. **Po vrácení a novém převodu** se dřív nedaly převzít změny, které
   mezitím udělala stará appka (a „zpet" by je přepsal). Teď krok „zpet"
   po přenosu ověří nový plán a návrat označí jako hotový; potom nový
   převod změny staré appky převezme.
5. **Přechodná chyba přílohy** (stará databáze neodpověděla, vypršel čas)
   se zapisovala jako trvalá a dokončení by Faktury otevřelo bez kopie
   PDF. Teď se taková příloha zkusí znovu a dokončení ji nepustí.
6. **Pořadí migrací:** #146 a #145 měly starší razítko než #147.
   Doporučené pořadí #146 → #147 → #145 (#145 je už přerazítkovaná) a nová
   kontrola v CI to bude hlídat.
7. **Návrat zpět obyčejným revertem PR** by po `db push` smazal soubor
   nasazené migrace a zablokoval `db push` ostatních PR. Návod teď vrací
   kód BEZ souboru migrace; kontrola v CI smazání migrace zastaví.
8. **Dvě otázky č. 58** (Jiné platby i Faktury). Otázky Faktur jsou nově
   59–65; nový test hlídá, aby se číslo nikdy neopakovalo.

**Nízké** — audit už nekopíruje text dokladu, e-mail ani účet dodavatele
(audit čte i správce bez práva na Faktury); stav převodu cizí firmy se
nedá zjistit z hlášky; přihlášený mění u faktury jen stav, poznámku,
archiv a upomínku (ne částku ani měnu přes REST) a ze stavu převodu čte
jen stav; s přijatou fakturou jde spárovat jen odchozí platbu (příchozí
peníze patří Jiným platbám — jinak by šla tatáž platba rozdělit dvakrát);
Finance → Přehled se zavřenými Fakturami řekne proč, ne „Nic nevyžaduje
pozornost"; eurové faktury nejsou v návrzích párování ani v součtu
v Kč; CSV exporty nespustí v Excelu vzorec z čísla faktury; XML přílohy
se stahují, neotevírají; přílohy se stihnou do limitu funkce a chyby se
neztratí; měřicí návod slibuje jen čísla, která úloha opravdu vypíše;
schválit jde jen dokument z fronty a ručně zadaná faktura jen se stavem
a měnou z nabídky.

## Co je otestované — a z čeho jsou čísla

- **Databáze (scénář `krok99`):** 142 kontrol, všechny prošly
  v PGlite. PGlite **neověří** pravidla přístupu ani granty — o tom
  rozhoduje CI „Migrace a scénáře" proti skutečnému PostgreSQL 16:
  doplním po doběhnutí.
  - Pokrývá: zavřené Faktury pro všechny před převodem, porovnání pole
    po poli, dokončení jen když vše sedí (a každé odmítnutí ověřené
    podle důvodu), čtení jen za celou firmu, párování ve stejném kroku,
    cizí firma (čtení, rušení párování, duplicity, stav převodu), směr
    platby, audit bez obsahu dokladu, granty po sloupcích, úložiště jen do
    vlastní složky, zrušení převodu, vrácení a nové zahájení, zrušení
    celé firmy.
- **Node testy:** v seznamu CI je **86 sad**, všechny prošly lokálně
  (CI „Testy aplikace": doplním po doběhnutí). Nové nebo přepsané pro Faktury:
  - `faktury-prevod` 143 kontrol (převod řádku tam a zpátky,
    částka na haléř přesně, čas na mikrosekundy, návrat zpět jen po
    dokončení, přechodné chyby příloh, časový rozpočet, nanečisto před
    db push, plán ve workflow);
  - `faktury-tenant-izolace` 70 (každý dotaz do faktur nese
    firmu, na starou databázi sahá jen převod, granty z textu migrace,
    brána a věta na Přehledu);
  - `faktury-sloupce` 28 (všech 31 dotazů do faktur míří na
    existující sloupce; XML příloha se stáhne);
  - `otazky-cisla` (nová — žádné číslo otázky dvakrát);
  - upravené `finance-parovani` (eurové faktury), `ucetni-export`
    (vzorce v CSV), `faktury-filtry`, `faktury-prijem-jadro`,
    `finance-platby-pobocka`.
- Kontrola „Migrace jen přibývají" (`scripts/migrace-poradi.mjs`) prošla
  nad `main`.
- `tsc` čisté. Sestavení prošlo 19. 10. dopoledne (`next build --webpack`
  — Turbopack v pracovní kopii vedle hlavní padá na odkazu
  `node_modules`, s kódem to nesouvisí); Vercel náhled ověřuje každý push.
- **Schválná rozbití:** 37 v kole po kontrole 19. 10. (a 18
  v kole předtím); každé spadlo na kontrole, na kterou mířilo. Souhrnné
  kontroly rozbité dvěma způsoby (směr platby, audit, granty faktur, CSV,
  přílohy, workflow).

## Co je připravené pro vás

**Plán přepnutí** (podrobně `docs/faktury-slouceni-navrh.md`, oddíl 6):

0. Předem: pozastavit `faktury-app` ve Vercelu a smazat
   `FAKTURY_SUPABASE_*` z Preview a Development (otázka 59, bod 1).
   Sloučit nejdřív Jiné platby (#146).
1. Sloučit PR #147 → Faktury ukážou „připravují se". Od teď běží
   nanečisto samo každé 2 dny.
2. Krok **nanecisto** (ještě před `db push`): anomálie musí být 0 —
   jinak vrátit kód a nic nenasazovat. Zapsat si čísla.
3. `migration list` → nenasazená smí být jen `20261018100000`; pak
   `supabase db push` → „stěhují se".
4. **zahajit** → **prevest** → **prilohy** (opakuje se sám, dokud je co
   dělat).
5. **nanecisto** → chybí = liší se = navíc = 0.
6. **dokoncit** → Faktury se otevřou. Pustit měřicí dotaz
   `docs/hlaseni/faktury-prevod-mereni.sql` (před i po; dosadit firmu).
7. Zkušební doba 7 dní (nanečisto běží samo).
8. Úklid (`docs/faktury-slouceni-uklid.sql`) — až po zkušební době.

Odstávka Faktur: od kroku 1 do kroku 6, odhadem 30–60 minut. Příjem
z e-mailu mezitím počká, e-maily zůstanou ve schránce.

**Návrat zpět:**

| kdy | jak |
|---|---|
| před `db push` (anomálie) | vrátit PR v `main` |
| po `db push`, převod nezačal | vrátit kód **bez souboru migrace** (postup v návrhu, oddíl 7) |
| převod začal, nedokončený | krok **zrusit**, pak vrátit kód bez souboru migrace; do staré databáze se nic nevrací |
| po dokončení, před úklidem | **vratit** → **zpet_nanecisto** → **zpet** (i při nulách; konflikty rozhodnete vy) → vrátit kód bez souboru migrace |
| po úklidu | jen ze zálohy — proto úklid až po zkušební době |

## Co je blokované / čeká na vás

1. **Sloučení PR, `db push`, převod dat, změny ve Vercelu** — jen na váš
   výslovný pokyn.
2. **Otázky 59–65** (`otazky.md`): kdy přepnout a v jakém pořadí,
   zkušební doba, Faktury a pobočky, Faktury pro další firmy, cizí měna,
   odkazy u příjemek, stará databáze po úklidu, velikost fotky.
3. **Do staré databáze nevidím** (oprávnění k Supabase MCP chybí), proto
   neznám skutečné počty ani anomálie. Ukáže je až krok **nanecisto**
   (jde hned po sloučení, ještě před `db push`).

## Co se pro uživatele mění

- Faktury jsou během převodu (30–60 min) zavřené a appka to říká na
  Fakturách, v Platbách, na Dnes i na Finance → Přehled — ne „nic po
  splatnosti" ani „nic nevyžaduje pozornost".
- Faktura v cizí měně nebo bez částky: po spárování se stav **nezmění**
  a appka řekne „nastavte ručně" (dřív by skončila jako Uhrazeno).
  Návrhy párování takové faktury nenabízejí; ruční párování píše její
  částku v její měně.
- S přijatou fakturou jde spárovat jen odchozí platbu.
- Rušit párování smí jen ten, kdo vidí Faktury (mění stav faktury).
- Fakturu s párováním nejde smazat ani „odmítnout jako nefakturu",
  appka řekne „archivujte ji".
- Přílohy a evidenci příjmu čte jen člověk s právem za **celou firmu**
  (dřív přímým dotazem i člen jedné pobočky — hlášení 8. 10.). XML
  přílohy (ISDOC) se stáhnou, neotevřou v prohlížeči.
- Faktury jsou otevřené jen pro Foodtab s.r.o. (otázka 61).

## Známé mezery (vědomě)

- **Úloha převodu, část se sítí** (čtení staré databáze po stránkách,
  zámek, kopírování příloh) nemá automatický test se skutečnou sítí —
  testovaná je její čistá logika, rozhodování (z textu zdroje) a databázová
  strana. Proto krok **nanecisto** před každým zapisujícím krokem.
- **Fotka u ručně zadané faktury max. 1 MB** (otázka 65). Když se po
  nahrání fotky nepovede uložit fakturu, soubor zůstane v soukromém
  úložišti firmy bez faktury (neškodí, nic ho neukazuje).
- **Typy výsledků dotazů do faktur** si appka přetypovává sama; chybný
  sloupec by prošel překladem. Hlídá to test sloupců nad všemi 31 dotazy.
- Značka „nová cesta párování" v databázi je rozlišení cesty v kódu,
  ne zámek — přihlášený ji nastavit neumí a přímý zápis do párování
  nemá.
- Společný zbytek platby přes Jiné platby a párování faktur se nepočítá:
  není potřeba, protože Jiné platby berou jen příchozí a faktury jen
  odchozí platby. Kontrola obojího naráz patří do scénáře až po sloučení
  #146 i #147.

## Střety s jinými PR

- **#146 Jiné platby** a **#145 hlídač plánovače:** střet v seznamech
  (CI testy, `run.sh`, `databaze.yml`, `otazky.md`) — při slučování
  ponechat obě strany. Otázky se už nesrážejí: #146 má 50–58, Faktury
  59–65 (hlídá `scripts/otazky-cisla.test.mjs`).
- **Pořadí:** #146 (migrace `20261016100000`) → #147 (`20261018100000`)
  → #145 (přerazítkovaná na `20261019120000`). Hlídá workflow „Migrace
  jen přibývají".
- Ověřené nanečisto 19. 10. dopoledne: migrace a scénáře všech tří větví
  poskládané dohromady, celý řetěz v jedné databázi jako v CI — 3808
  kontrol v PGlite, nic nespadlo (krok97 10, krok98 140, krok99 125).
  Znovu 19. 10. odpoledne po opravách z kontroly: doplním.
- Obsahově se #146 přijatých faktur netýká: Jiné platby pracují
  s **vydanými** fakturami (`faktura_cislo`) a s příchozími platbami;
  párování faktur nově bere jen odchozí platby, takže tatáž platba nejde
  rozdělit dvakrát.
