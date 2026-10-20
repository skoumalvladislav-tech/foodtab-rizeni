# Stav k 19. 10. 2026 — Jiné platby: celá agenda je v PR, nic není nasazené

Finance → Tržby → Jiné platby podle vašeho zadání z 15. 10. Práce běžela
16.–19. 10. ve vlastní větvi `finance-jine-platby`, nezávisle na ostatních
PR.

> **Doplněno 19. 10. večer:** druhá nezávislá kontrola PR #146 (5 pohledů:
> databáze, peníze, pokladna, aplikace, AI; každý nález ověřil další agent)
> našla 33 platných nálezů. Opravené jsou všechny, tři jen zčásti — viz
> oddíl **Druhá kontrola (19. 10.)** níž. Čísla v hlášení jsou po opravách.
>
> **Doplněno 20. 10.:** nezávislé ověření oprav našlo 11 neúplných oprav a 6
> nových chyb, které opravy způsobily. Opravené jsou všechny — viz oddíl
> **Ověření oprav (20. 10.)**. Čísla níž jsou po těchto opravách.

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
- **Druhá kontrola 19. 10.** našla dalších 33 chyb, z toho dvě vysoké (souběh dvou fotek téže sjetiny = dvojí tržba; jedna bankovní platba na fakturu i na Jinou platbu). Opravené jsou všechny, tři zčásti (oddíl Druhá kontrola).
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
| Kontroly pokladen v krok98 nezávislé na ostatních scénářích (CI) | `aec9cde` | — |
| **Druhá kontrola:** databáze, scénář krok98 (oddíl 13) | `37e24d2` | **ano** |
| Druhá kontrola: textová kontrola grantů, dokumentace | `424ba2b`, `f874178` | — |
| Druhá kontrola: obrazovky, akce, knihovny, navigace Financí, testy | `5fd76d3` | — |
| **Ověření oprav 20. 10.:** databáze, scénář krok98 (oddíl 14), kontrola grantů | `9244030` | **ano** |
| Ověření oprav: obrazovky, akce, knihovny, testy; dokumentace | `1c9b755`, `e361e99` | — |

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
  - **209 kontrol**; celý řetěz scénářů ve stejném pořadí jako na CI **3 742 kontrol**, nic nespadlo;
  - **složeně s PR #147** (main + #146 + #147, konflikty v `run.sh`, `databaze.yml`, `aplikace.yml` a `otazky.md` vyřešené ponecháním obou stran): **3 889 kontrol**, krok98 209 a krok99 147, nic nespadlo; nový hlídač pořadí migrací z main (#148) prošel;
  - běželo na **PGlite**, ne na PostgreSQL;
  - PGlite **neověří RLS ani sloupcové granty**. Rozhodne workflow „Migrace a scénáře“ na GitHubu, které běží po pushi a jehož výsledek je v PR.
- **Node testy:** v seznamu CI je **89 sad, všech 89 prošlo**. Z toho Jiné platby:

  | sada | kontrol |
  |---|---|
  | `jine-platby` | 545 (síť 49 280 kombinací stavů) |
  | `jine-platby-detail` | 590 |
  | `jine-platby-obrazovka` | 254 |
  | `jine-platby-ai` | 199 |
  | `jine-platby-pos-operace` | 73 |
  | `pokladna-dotykacka-sklad` | 168 |
  | `nabidka` | 225 |
  | `finance-pobocky` | 189 |
  | `provoz-granty` | + 31 nových (Jiné platby bez zápisu pro přihlášené) a + 15 (funkce jen pro server bez authenticated) |

  - `vydelky` napoprvé spadl. Nabídka nově načítá seznam práv Jiných plateb a test výdělků ho neuměl podstrčit. Opraveno, test teď načítá skutečný soubor.
- `tsc` a `eslint` nad změněnými soubory jsou čisté.
- **Schválná rozbití:**
  - **Databáze, 121 rozbití.** Každé shodilo kontrolu (120 přesně tu, na kterou mířilo).
    - B48 (pokladna bez kontroly pobočky) spadlo na **dřívější a přísnější** kontrole „cizí firma nevidí katalog“. Stejné rozbití totiž otevře katalog i cizí firmě.
    - Pravidla, která jdou porušit dvěma způsoby, jsem rozbil oběma. Například rozdíl součtu: bez důvodu i s neomezenou tolerancí. Zrušení záznamu: zůstane ve frontě i drží doklad.
  - **Aplikace:** po první kontrole 77 + 77 rozbití a 3 moje, po druhé 49 (detail) + 71 (knihovny a navigace), po ověření 70 (detail) + 38 (knihovny). Všechna spadla. Před první kontrolou 90 rozbití aplikace a 21 databáze.
  - **Granty dvěma způsoby:** funkce jen pro server bez revoke od authenticated i s grantem authenticated — obě rozbití shodí kontrolu.
  - **Text migrace:** rozbití revoke u Ostatních tržeb (přihlášený by dostal zápis z výchozích práv Supabase) shodí 3 kontroly v `provoz-granty`; krok98 by tohle v čisté databázi nepoznal nikdy.
  - Rozbití odhalila tři slabé kontroly, které prošly i nad rozbitým kódem: dvakrát duplicity, kde shodu zakryla shoda „den + částka“, a jednu kontrolu, která spadla výjimkou místo výsledku. Všechny tři jsou opravené.
- **Nezávislá kontrola:**
  - první (17. 10.): 49 nálezů, každý ověřil samostatný agent; 37 obstálo, 12 se vyvrátilo;
  - druhá (19. 10.): 34 nálezů, 33 platných (2 vysoké jako možné), 1 vyvrácený;
  - ověření oprav (20. 10.): 22 z 33 opraveno, 11 zčásti, 6 nových chyb z oprav (2 střední, 4 nízké) — vše opravené 20. 10.;
  - 2 nálezy opravené v databázi neměly kontrolu ve scénáři (přepočet úhrady, verze při změně odběratele), proto jsem je doplnil.

## Druhá kontrola (19. 10.)

Co se opravilo (podrobnosti v `docs/jine-platby-navrh.md`, návodu a `docs/jine-platby-pos-operace.md`):

- **Peníze:**
  - dvě fotky téže sjetiny potvrzené ve stejnou chvíli už nezapíšou tržbu dvakrát — potvrzování tržeb jedné firmy jde za sebou;
  - jedna bankovní platba nezaplatí fakturu i Jinou platbu (počítá se i párování s fakturami, stejný zámek), stornovaná platba úhradu neprokazuje, ke zrušenému záznamu úhrada nejde;
  - „Jen propojit“ bez konkrétního prodeje v pokladně chce důvod (jinak by tržba mimo pokladnu zmizela ze všech součtů); po propojení jde kontrolu zopakovat („Možná nezapočítáno nikde“);
  - sjetina nebo doklad neurčeného typu s otevřeným účtem v pokladně dá „nelze ověřit“, ne „není v pokladně“; částka se s pokladnou porovná s tolerancí zaokrouhlení; účet zaplacený Odpisem se nebere jako prodej;
  - ruční „není tam“ nepřepíše, co pokladna našla (jen s právem na opravy);
  - duplicita podle čísla účtu se hledá i mezi záznamem s pokladnou a bez ní na téže provozovně; kontrola součtu položek bere i množství × jednotkovou cenu.
- **Sklad:**
  - schválený výdej (i když provedení selhalo) je zamčený: položky nejde změnit ani záznam zrušit, uvolní ho jen Zrušit schválení;
  - výdej jen s produkty z katalogu pokladny (bez katalogu se nic neschválí);
  - kontrola ani výdej nepracují s provozovnou, kterou v Integracích přeřadili jiné pobočce;
  - pokrm a další zboží v jednom výdeji: varování pro schvalovatele (receptury appka nezná).
- **Doklady a AI:**
  - soubor (a jeho otisk) zapíše jen server — dřív šlo poslat vymyšlený otisk a tutéž fotku připojit podruhé;
  - upozornění AI k celému dokladu (nízká jistota, víc dokladů, pokyn v textu) se ukládají a „zkontrolováno“ chce výslovné „prověřil jsem“;
  - verze a zapsaná tržba se kontrolují dřív, než se zaplatí čtení; denní strop pod zámkem; PDF nejvýš 20 stran (30 dohromady);
  - čas tisku účtenky: účet po půlnoci jde na předchozí provozní den s upozorněním;
  - časový rozpočet čtení se měří od začátku akce, useknutá nebo odmítnutá odpověď dá srozumitelnou hlášku.
- **Navigace Financí:** rám Financí už nerozhoduje podle adresy (při přechodu přes menu nefungoval); bránu si drží každá stránka. Obsluha bez finančního přehledu vidí v navigaci jen Jiné platby.
- **Druhá linie v databázi:** vazby operací v pokladně a náhrada tržby hlídané i spouští; krok98 nově zkouší i kontakt a platbu cizí firmy, katalog s cizí pokladnou a nahrávání bez práva.

Co je opravené jen zčásti:
- **Zápis do Dotykačky (vypnutý):** tvar operace pro zápis je sjednocený, ale u pokladny připojené k jedné pobočce appka provozovnu u záznamu neukládá — před zapnutím ji musí databáze doplnit (zapsané v `docs/jine-platby-pos-operace.md`).
- **Nejasný výsledek bez východu:** dohledání podle klíče jde teď i u pokladny bez zápisu přes API; když se pokladna nedá otevřít vůbec, záznam zůstane „nejasný“ a vyřeší ho jen ruční zásah. Dnes nenastane, zápis je vypnutý.
- **Pokrm a jeho suroviny:** jen varování, ne zákaz — appka receptury nečte.

## Ověření oprav (20. 10.)

Nezávislé ověření (5 ověřovatelů se schválnými rozbitími a jeden hledač regresí) našlo, že část oprav z 19. 10. drží jen napůl. Co se dotáhlo:

- **Ruční „není tam“ proti výsledku pokladny:** pojistka platila jen pro tutéž verzi záznamu a padla prvním uložením (i beze změny). Teď drží, dokud nepřijde novější kontrola z pokladny. U pouhé shody částky („pravděpodobně“) jde přepsat s výslovným potvrzením „prodej v pokladně je jiný“ — dřív to obsluhu zablokovalo. Konkrétní účet přepíše jen člověk s právem na opravy. Celý přepsaný výsledek (i číslo účtu) je v historii.
- **Jedna platba na fakturu i na Jinou platbu:** opačný směr (nejdřív Jiná platba, pak faktura) teď hlídá spoušť nad párováním faktur. Tvrzení v hlášení z 19. 10. platilo jen pro jedno pořadí, teď platí pro obě.
- **Sjetina a neurčený doklad:** „v pokladně není“ z dotazu do pokladny už nedostanou nikdy (dřív jen když v pokladně zrovna běžel otevřený účet). Hlídá to aplikace i databáze; zbývá ruční prohlášení s důvodem.
- **„Možná nezapočítáno“** (nová chyba z 19. 10.): u propojení bez konkrétního účtu to byl falešný poplach a rada „zapište jako novou“ vedla ke dvojí tržbě. Teď jen u propojení s konkrétním účtem a s radou nejdřív ověřit v pokladně.
- **Pokrm a jeho suroviny:** pokrm s kusovým zbožím chce při schválení výslovné potvrzení „zboží není surovina toho pokrmu“ (pivo už varování nedává). Zákaz to pořád není — appka receptury nečte.
- **Nejasný výsledek z pokladny:** po vypršení platnosti požadavku jde výdej ručně doložit nebo schválení zrušit (po ověření v pokladně). Ruční doložení neblokuje změna katalogu po schválení (nová chyba z 19. 10.).
- **Panel „Částky na dokladu“:** návrh si pamatuje čtení AI, ze kterého je (dřív se odhadovalo z verzí a mohlo ukázat čtení, které se nikdy neuložilo).
- **Rozpoznání AI:** po zápisu tržby zase jde (položky pro sklad; částka, měna a datum zůstanou), se schváleným nebo provedeným výdejem ne. Strop odpovědi podle času, vypršení času je trvalá chyba s radou místo „zkuste znovu“. Bez času tisku na účtence přibude upozornění na provozní den. Test „už běží“ a test pořadí zámku před počítáním stropu.
- **Druhá linie:** další spouště (alias, tržba se záznamem a pokladnou, soubory, historie, rozpoznání, návrhy, operace) i hláška funkce u odběratele cizí firmy mají kontroly; kontrola nahrávání padá na politice, ne na čemkoli.
- **Granty:** textová kontrola, že funkce jen pro server odebírají právo i roli authenticated (výchozí práva Supabase) a nikde ho znovu nedostanou.

Co zůstává jen zčásti:
- **Zápis do Dotykačky (vypnutý):** provozovna u pokladny vázané na pobočku pořád chybí (před zapnutím).
- **Pokrm a suroviny:** jen potvrzení, ne zákaz.
- **Okno souběhu u čtení AI:** když kolega uloží úpravu během čtení, uložení čtení spadne až po zaplaceném volání (zbytkové riziko, kontrola ho přijala).
- **Akce párování v modulu Faktury** (`platby/akce.ts`) směr platby nekontroluje; databáze dvojí úhradu zastaví, ale obrazovka to neřekne předem. Řeší PR #147.

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
- **Pořadí sloučení:** doporučené #146 → #147 → #145 (podle razítek migrací; hlídač z #148 chce, aby nová migrace byla novější než všechny v main). Složený test #146 + #147 prošel.
- **Kontrolní a opravný workflow se dvakrát přerušil s koncem procesu aplikace.** Obnovil jsem ho z uloženého stavu, žádná práce se neztratila.
- **19. 10. oba implementátoři oprav po druhé kontrole spadli na výpadku sítě** (po hodině práce). Jejich změny zůstaly v pracovní kopii.
  - Jeden skončil uprostřed schválných rozbití a jedno rozbití nechal v souboru (`logika.ts`, odpisový účet bráný jako prodej). Našel jsem ho porovnáním se zálohou před rozbitím a soubor vrátil. Zbylých 42 rozbití jsem dopustil sám.
  - Druhého jsem nechal dokončit novým agentem: ten dodělal testy AI (předchozí verze padala) a všech 71 rozbití.
  - Jedno rozbití (rozpoznání neuloží upozornění AI) test chytil, ale pak spadl výjimkou bez souhrnu. Test jsem upravil, teď selže čistě.
- **Kompromis, který je vidět:** když je na dokladu spropitné započtené v celkové částce, nesedí součet položek (spropitné do tržby nepatří). Appka pak chce opravit celkovou částku, nebo napsat důvod. Takhle mi napoprvé spadl vlastní scénář. Nechal jsem to tak: tržba je cena prodeje a spropitné do ní nepatří.
- **Kontrola po pozdějším importu z pokladny je jen ruční** (otázka 58). Automatická by potřebovala plánovač, který v databázi zatím neběží. A volat pokladnu za uživatele by byla nová úloha s klíči pokladny.
- **Porovnání čísla účtu:** appka teď odstraňuje stejné bílé znaky jako databáze (bez nezlomitelné mezery). Jak se `\s` chová u unicodových mezer v ostré databázi, záleží na jejím nastavení; neověřoval jsem.
- **Co jsem neověřil naživo:**
  - **Dotykačka:** hledání podle data uzavření (`completed`) je ověřené jen podle oficiální dokumentace a na podvržených odpovědích. Na skutečné Dotykačce neběželo nic z této agendy.
  - **Zmenšení fotky v prohlížeči:** testovaná je jen logika pokusů, samotné zmenšení ne.
  - **Zaměření pole po chybě „možná duplicita“** jsem v prohlížeči nezkoušel.
  - **Skutečné AI rozpoznání:** testy běží na podvržených odpovědích.
- **Obrazovky, které jsem neviděl vykreslené v běžící appce:** všechny.
  - Snímky jsou ze **statického vykreslení detailu se smyšlenými daty**: skutečné CSS appky, ale bez JavaScriptu, bez databáze a bez klikání.
  - Při 375 i 1440 px nic nepřetéká do šířky a žádné tlačítko není menší než 44 px.
  - Přehled seznamu a formulář nového záznamu jsem dnes nefotil.
  - Snímky z 19. 10. večer jsou po druhé kontrole (varování pokrm + zboží a nevyřešené položky v panelu skladu). Smyšlená data nemají upozornění AI k dokladu, takže tenhle panel na snímku není (ověřuje ho test vykreslení).
  - Navigaci Financí a novou bránu na stránkách jsem v prohlížeči neviděl, ověřují je testy vykreslení do HTML.
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
