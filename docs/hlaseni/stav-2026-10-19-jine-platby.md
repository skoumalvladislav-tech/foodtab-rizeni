# Stav k 19. 10. 2026 — Jiné platby: celá agenda je v PR, nic není nasazené

Finance → Tržby → Jiné platby podle vašeho zadání z 15. 10. Práce běžela
16.–19. 10. ve vlastní větvi `finance-jine-platby`, nezávisle na ostatních
PR.

## Nejdřív to podstatné

- **Agenda je hotová v PR, ale v ostré appce zatím není.** Databázová změna `20261016100000_jine_platby` **není nasazená** (`db push` jsem nespustil). Nic jsem nesloučil a do žádné pokladny nic nezapsal. Po sloučení a `db push` se agenda objeví v menu.
- **Co umí:**
  - fotka nebo PDF dokladu;
  - AI přečte položky, ceny, celkovou částku a měnu, nic si nedomýšlí;
  - kontrola člověkem;
  - zápis do **Ostatních tržeb**, nebo jen propojení, když prodej už je v pokladně;
  - návrh výdeje ze skladu a jeho schválení oprávněnou osobou („Potvrdit výdej do POS“) pro konkrétní provozovny;
  - podklady faktury a propojení faktury vystavené jinde;
  - úhrada jen podle skutečné bankovní platby;
  - opravy bez přepisu historie a audit.
- **Tržba a sklad se potvrzují zvlášť.** Právo na tržbu neumožní odečíst sklad a naopak. Hlídá to databáze, ne jen schované tlačítko.
- **Do skladu Dotykačky appka zatím nezapisuje.** Funkce je napsaná a otestovaná na podvržených odpovědích, ale v kódu vypnutá (otázka 54). Dnes schvalovatel odepíše v Dotykačce sám (účet zaplacený *Odpisem*) a v appce to doloží. Stav pak je „Ručně doloženo“, nikdy „Odečteno v POS“.
- **Nezávislá kontrola** (agenti, každý nález ověřoval další agent) našla 49 možných chyb:
  - **37 obstálo**: 1 vysoká, 19 středních, 17 nízkých;
  - 12 se nepotvrdilo;
  - opravených je všech 37, jedna z nich jen zčásti (kontrola po pozdějším importu z pokladny je ruční, ne automatická, viz otázka 58).
- **Blokované nebo čeká na vás:** `db push`, vydané faktury (51), zápis do Dotykačky a jeho ověření na testovacím cloudu (54), přičtení spotřeby do Foodcostu (53), automatická kontrola po importu z pokladny (58).

## Co je hotové

| co | commit | čeká na `db push` |
|---|---|---|
| Technický návrh a sdílené typy (smlouva pro implementaci) | `1e0238a` | — |
| Databáze: 7 práv, 10 tabulek, soukromé úložiště dokladů, funkce jako jediná cesta k zápisu; scénář | `2ebb1de` | **ano** |
| Obrazovky (přehled, nový záznam, detail), akce, AI rozpoznání, pokladní vrstva, testy | `c07a908` | — |
| Návod pro obsluhu a schvalovatele | `9fb40be` | — |
| Sloučení `main` (#144) a přečíslování scénáře na krok98 (krok97 má #145) | `485b7b2`, `cb3a078` | — |
| Opravy databáze z nezávislé kontroly | `4328f28` | **ano** |
| Scénář krok98: nové kontroly; dokumentace podle oprav | `3f9569e`, `72ca4bf`, `72569d7` | — |
| Opravy obrazovek a knihoven z nezávislé kontroly | `38d1ab8` | — |
| Panel schválení řekne, proč schválit nejde | `25e6e35` | — |

Hlavní opravy z kontroly (podrobně v `docs/jine-platby-navrh.md` a v návodu):

- **Kontrola v pokladně** hledá uzavřené účty podle data **uzavření** a otevřené účty zvlášť, až 60 dní zpátky. Předtím účet otevřený dřív než v den prodeje vyšel jako „nenalezeno“ a tržba by se započítala dvakrát. To byl jediný vysoký nález.
- **Ruční odpis** (dnešní Dotykačka):
  - dokud schvalovatel odepisuje v pokladně, nejde měnit produkty, množství ani záznam zrušit;
  - když nic neodepsal, je tu nové tlačítko **Zrušit schválení** s důvodem;
  - „Ručně doloženo“ je svázané s návrhem, který měl schvalovatel otevřený.
- **Druhý výdej téže sjetiny** (jinak vyfocené) chce důvod. Předtím šel výdej schválit dvakrát bez otázky.
- **Schválit jde jen** zkontrolovaný záznam bez nevyřešených položek. Nejasná položka přidaná po odeslání návrh zneplatní.
- **Faktura z pokladny** nejde propojit k tržbě zapsané do Ostatních tržeb. Byly by to dvě tržby.
- **Nesoulad součtu položek s celkovou částkou** (u korun přes 50 haléřů) chce důvod.
- **Bankovní platby a Kontakty** jsou na detailu jen pro finanční přehled celé firmy. Vedoucí s přehledem jen své pobočky je předtím viděl za celou firmu.
- **Hlášky** neprozradí, který záznam je na provozovně, kterou člověk nevidí.
- **Katalog pokladny a přiřazení** jsou jen pro pobočky, které ta pokladna obsluhuje.
- **Drobnější opravy:**
  - zrušený záznam uvolní doklad i frontu schvalovatele;
  - stav úhrady se po změně částky přepočítá;
  - souběžné párování jedné platby se zamyká;
  - oprava tržby hlídá verzi;
  - položky mají audit;
  - Ostatní tržby a katalog se čtou po stránkách (dřív tichý ořez na 1000 řádků);
  - fotky nad 5 MB se při nahrání zmenší;
  - u položky „kus“ k produktu v litrech bez míry appka nic nehádá.

Snímky obrazovky detailu: `docs/hlaseni/snimky-jine-platby/` (počítač 1440 px,
telefon 375 px, telefon v tmavém režimu u panelu schválení).

## Čísla — a z čeho jsou

- **Scénář krok98:**
  - **140 kontrol**, s etapa0 dohromady **179**; se scénáři krok93–95 před ním (jako na CI) **317**;
  - běželo na **PGlite**, ne na PostgreSQL;
  - PGlite **neověří RLS ani sloupcové granty**. Rozhodne workflow „Migrace a scénáře“ na GitHubu, které běží po pushi a jehož výsledek je v PR.
- **Node testy:** v seznamu CI je **89 sad, všech 89 prošlo**. Z toho Jiné platby:

  | sada | kontrol |
  |---|---|
  | `jine-platby` | 448 |
  | `jine-platby-detail` | 419 |
  | `jine-platby-obrazovka` | 235 |
  | `jine-platby-ai` | 112 |
  | `jine-platby-pos-operace` | 59 |
  | `pokladna-dotykacka-sklad` | 150 |
  | `nabidka` | 225 |
  | `finance-pobocky` | 144 |

  - `vydelky` napoprvé spadl. Nabídka nově načítá seznam práv Jiných plateb a test výdělků ho neuměl podstrčit. Opraveno, test teď načítá skutečný soubor.
- `tsc` a `eslint` nad změněnými soubory jsou čisté.
- **Schválná rozbití:**
  - **Databáze, 61 rozbití.** Každé shodilo kontrolu.
    - B48 (pokladna bez kontroly pobočky) spadlo na **dřívější a přísnější** kontrole „cizí firma nevidí katalog“. Stejné rozbití totiž otevře katalog i cizí firmě.
    - Pravidla, která jdou porušit dvěma způsoby, jsem rozbil oběma. Například rozdíl součtu: bez důvodu i s neomezenou tolerancí. Zrušení záznamu: zůstane ve frontě i drží doklad.
  - **Aplikace po kontrole:** 77 + 77 rozbití (dva implementátoři) a 3 moje. Všechna spadla. Před kontrolou 90 rozbití aplikace a 21 databáze.
  - Rozbití odhalila tři slabé kontroly, které prošly i nad rozbitým kódem: dvakrát duplicity, kde shodu zakryla shoda „den + částka“, a jednu kontrolu, která spadla výjimkou místo výsledku. Všechny tři jsou opravené.
- **Nezávislá kontrola:**
  - 49 nálezů, každý ověřil samostatný agent;
  - 37 obstálo, 12 se vyvrátilo;
  - 2 nálezy opravené v databázi neměly kontrolu ve scénáři (přepočet úhrady, verze při změně odběratele), proto jsem je doplnil.

## Co čeká na Šéfíka

1. **Projít PR a rozhodnout o sloučení.** Po sloučení je potřeba `db push` (jedna migrace `20261016100000_jine_platby`), jinak stránka v produkci nenajde tabulky. Obojí jen na váš výslovný pokyn.
2. **Přidělit práva.** Majitel má všechno sám, ostatním se nic nepřidalo. Nastavení → Oprávnění: Jiné platby (7 práv). Tabulka „kdo co typicky má“ je v návodu.
3. **Dotykačka:** než se zapne zápis výdeje, ověřit na testovacím cloudu (licence z 12. 10.) body ze seznamu v `docs/jine-platby-pos-operace.md`. Pak výslovný pokyn „zapni zápis do Dotykačky“ pro konkrétní provozovnu.

## Otázky

V `docs/hlaseni/otazky.md`:
- **50** Ostatní tržby se zatím nepřičítají do Tržeb z pokladen ani na Přehled.
- **51** Vydané faktury appka nevystavuje (blokováno).
- **52** Potvrdit výdej do POS = běžné právo na pobočce.
- **53** Spotřeba se do Foodcostu nepřičítá.
- **54** Zapnout zápis do Dotykačky?
- **55** Otevřený účet s fakturou: doporučeno uzavřít v pokladně.
- **56** Souhlas s posíláním fotek AI.
- **57** Obsluha bez finančních práv (doplněno: co neuvidí).
- **58 (nová)** Kontrola po pozdějším importu z pokladny je ruční, ne automatická.

## Na co jsem narazil a nešlo to

- **Hlavní pracovní kopie byla na cizí větvi s rozpracovanými změnami jiné relace.** Pracoval jsem proto ve vlastní kopii (`foodtab-jine-platby`) a do cizích změn jsem nesahal.
- **Srážka s #145:** obě větve přidávaly `krok97_scenar.sql`. Můj scénář je přečíslovaný na **krok98** (soubor, `run.sh`, `databaze.yml`, id lidí ve scénáři). Když #145 přistane v `main` dřív, bude v `run.sh` a `databaze.yml` jednoduchý konflikt na sousedních řádcích.
- **První běh CI „Migrace a scénáře“ v PR spadl na mojí kontrole, ne na právech.**
  - Kontrola „obsluha vidí pokladnu své pobočky“ chtěla u Perly přesně jednu pokladnu.
  - Na CI ale běží všechny scénáře v jedné databázi a krok93–95 tam nechávají další pokladny Perly. PGlite u mě pouštěl jen etapa0 + krok98, proto to neviděl.
  - Kontrola teď počítá jen pokladny scénáře. Navíc přibyla kontrola, že seznam pokladen pro obsluhu vrací jen netajné sloupce (id, název, poskytovatel, stav, provozovna). Obě jsou schválně rozbité (B60, B61).
  - Práva jsem neměnil. Starou verzi jsem spadnout nechal i u sebe (krok93–95 + krok98), aby bylo jisté, že příčina je tahle.
- **Kontrolní a opravný workflow se dvakrát přerušil s koncem procesu aplikace.** Obnovil jsem ho z uloženého stavu, žádná práce se neztratila.
- **Kompromis, který je vidět:** když je na dokladu spropitné započtené v celkové částce, nesedí součet položek (spropitné do tržby nepatří). Appka pak chce opravit celkovou částku, nebo napsat důvod. Takhle mi napoprvé spadl vlastní scénář. Nechal jsem to tak: tržba je cena prodeje a spropitné do ní nepatří.
- **Kontrola po pozdějším importu z pokladny je jen ruční** (otázka 58). Automatická by potřebovala plánovač, který v databázi zatím neběží. A volat pokladnu za uživatele by byla nová úloha s klíči pokladny.
- **Drobný rozdíl mezi appkou a databází:** při porovnání čísla účtu appka zahodí i nezlomitelnou mezeru, databáze možná ne (záleží na jejím nastavení). Výsledek: appka ukáže „možná duplicita“, ale databáze důvod nevyžádá. Nebezpečný opačný případ nenastane.
- **Co jsem neověřil naživo:**
  - **Dotykačka:** hledání podle data uzavření (`completed`) je ověřené jen podle oficiální dokumentace a na podvržených odpovědích. Na skutečné Dotykačce neběželo nic z této agendy.
  - **Zmenšení fotky v prohlížeči:** testovaná je jen logika pokusů, samotné zmenšení ne.
  - **Zaměření pole po chybě „možná duplicita“** jsem v prohlížeči nezkoušel.
  - **Skutečné AI rozpoznání:** testy běží na podvržených odpovědích.
- **Obrazovky, které jsem neviděl vykreslené v běžící appce:** všechny.
  - Snímky jsou ze **statického vykreslení detailu se smyšlenými daty**: skutečné CSS appky, ale bez JavaScriptu, bez databáze a bez klikání.
  - Při 375 i 1440 px nic nepřetéká do šířky a žádné tlačítko není menší než 44 px.
  - Přehled seznamu a formulář nového záznamu jsem dnes nefotil.
- **Lokální `next build` jsem nespouštěl.** V téhle kopii padá na chybějícím balíčku z Marketingu (známé). Rozhoduje build Vercelu v PR.

## Kde jsem skončil a co zbývá

- **Hotovo:** implementace, opravy všech 37 obstálých nálezů, scénář, testy, rozbití, návod, otázky a toto hlášení. Všechno je pushnuté v PR.
- **Zbývá po vašem rozhodnutí:** sloučení, `db push`, přidělení práv, ověření Dotykačky na testovacím cloudu, otázky 50–58.
- **Na hraně zadání a vědomě nehotové:**
  - vystavení faktury (51);
  - přičtení spotřeby do Foodcostu (53);
  - zápis do skladu Dotykačky (54);
  - automatická kontrola po importu z pokladny (58).

## Nenasazoval jsem

- `db push`: **ne.** Migrace `20261016100000_jine_platby` není v ostré databázi.
- Sloučení PR: **ne.**
- Zápis do pokladny (Dotykačka, sklad ani účty): **ne**, ani do testovacího cloudu.
- Proměnné ve Vercelu, n8n, Salt Edge: **beze změny.**
