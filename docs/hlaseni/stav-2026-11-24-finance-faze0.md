# Stav k 24. 11. 2026 — Finance Fáze 0: krok 2 (párování plateb s fakturami) hotový

> **Doplněno 25. 11.:** přehled toho, co ze zadání ještě chybí, a jak se zbylé kroky dělají souběžně, je
> v `stav-2026-11-25-finance-faze0.md`. Krok 3 je od 25. 11. naprogramovaný a prochází kontrolou.

## Nejdřív to podstatné

- **Nic jsem nenasazoval ani nesloučil a `db push` neproběhl, ani nasucho.** Na ostrá data jsem nesahal.
  Větev `finance-faze0` je na GitHubu jen jako záloha, bez PR, takže na ni neběží testy na GitHubu.
- **Krok 2 je hotový v kódu a prošel třemi koly nezávislé kontroly.** Co umí:
  - platba se k faktuře spáruje sama, jen když sedí variabilní symbol, částka i účet dodavatele;
    jinak vznikne návrh nebo nic;
  - dvě nové fronty: **Návrhy párování** a **Platby bez faktury** (s exportem pro účetní);
  - ruční „Uhrazeno“ jen s částkou a důvodem. Jde ho zrušit a faktura se pak vrátí do stavu, ve kterém
    byla před úhradou;
  - „Vrátit mezi neuhrazené“ funguje u Uhrazeno i u Částečně uhrazeno;
  - započtení dobropisu proti faktuře téhož dodavatele;
  - když banka platbu zruší (storno), zruší se i její spárování a ruční úhrady a faktura se vrátí
    mezi neuhrazené. Žádná napojená banka ale storno zatím neposílá (otázka 132).
- **Kontroly našly hodně a všechno je opravené nebo popsané v otázkách.**
  - 1. kolo: 21 nálezů, z toho 1 vážný. Ruční úhrada uměla jednu platbu použít na libovolný počet
    faktur, i příchozí platbu k přijaté faktuře.
  - 2. kolo (kontrola oprav): 6 nálezů. Nejdůležitější: kdo smí jen párovat, si mohl „zaplatit“ fakturu
    platbou, kterou sám ručně zapsal.
  - 3. kolo: 3 nízké nálezy, mezi nimi možné uváznutí dvou současných operací (deadlock).
- **Jedno rozhodnutí doporučuji udělat před nasazením: otázka 148.** Kdo smí párovat, si dnes pořád může
  „zaplatit“ fakturu tím, že nahraje vymyšlený výpis z banky. Zadání kroku 2 nahranému výpisu věří.
  Databáze to nezastaví, jen po tom zůstane stopa (kdo výpis nahrál, kdo spároval, audit). Zavřít to jde,
  ale pak výpis k účtu bez napojené banky spáruje jen správce Faktur.
- **Obrazovky kroku 2 jsem neviděl vykreslené** (fronty, nová tlačítka u faktur). Zadání nedovolilo
  pustit aplikaci. Před nasazením je potřeba je proklikat.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| Krok 2, databáze: jistá shoda (VS + částka + účet dodavatele), návrhy, ruční úhrada s důvodem, Vrátit, započtení dobropisu, storno z banky, pojistka proti přímému „Uhrazeno“ | `6550932` | **ano**, migrace `20261120100000` |
| Scénář `krok112` (zkoušky 2, 3, 4 a 11) a kontroly, které jinak nešly rozbít | `f7944a5`, `2d50799`, `ed8b214` | — |
| Krok 2, aplikace: párování s účtem dodavatele, fronty Návrhy a Platby bez faktury, export pro účetní, ruční úhrada s důvodem | `a9ae265`, `bc671c2` | ano (s migrací) |
| Opravy po 1. kontrole (21 nálezů): databáze, hledání návrhů a tlačítko Najít návrhy, Platby bez faktury na pobočce, Faktury (zbytek k úhradě, zrušení ruční úhrady, dobropis), VS z textu u Enable Banking | `b58ba0e`, `04f534c`, `0e8e751`, `f4f7f98`, `9287646`, `4f6d964`, `cacdc08`, `479dad0`, `5aa57cb`, `b019eb2` | ano |
| Opravy po 2. kontrole (Vrátit u Částečně uhrazené, storno v téže dávce, návrh zpět do fronty, ruční platbu páruje jen správce Faktur) | `a8dd650` | ano |
| Opravy po 3. kontrole (Vrátit u smíšené úhrady, pořadí zámků, otázka 148 přepsaná) | `46c180a`, `13451a3`, `9a9735d` | ano |
| Otázky 127–150 | `aeb32c4` | — |

Kroky 1 a 2 tvoří dvojici. Nasazují se spolu, a stejně až s celou Fází 0 (otázka 117).

## Čísla — a z čeho jsou

**Databáze (PGlite, ne opravdový PostgreSQL):**
- Celý řetěz scénářů na konečném `9a9735d` (pustila ho opravující část): **4 950 prošlých kontrol**.
  Spadl jen `krok101`, a to na známé chybě testovacího nástroje (`\set` v uvozovkách). `krok64` dnes už
  nepadá, srážka dat z 23. 11. pominula.
- Scénář kroku 2 (`krok112`) má **194 kontrol**. Sám jsem po konci pustil `etapa0` + `krok111` + `krok112`:
  **384 z 384**.
- **PGlite neověří RLS ani sloupcové granty.** Běží jako superuživatel. Oddíl 7 scénáře `krok112` (granty
  a RLS) a zápisy pod přihlášeným v oddílech 6c a 6d ověří až workflow Databáze proti PostgreSQL 16, tedy
  až bude PR.
- **Souběh dvou spojení nezkouší nic.** Pořadí zámků (aby se dvě současné operace nezablokovaly) hlídají
  jen kontroly, které čtou těla funkcí.

**Aplikace:**
- Node testy: 50 souborů ze seznamů TESTY a TESTY_SERVER, žádný nespadl. Nové jsou
  `scripts/finance-bez-faktury.test.mjs` (34) a `scripts/banka-vs-z-textu.test.mjs`.
  `finance-parovani` má teď 228 kontrol.
- `npx tsc --noEmit`: 0 chyb.

**Schválná rozbití:**
- Celkem kolem 140 rozbití (databáze S1–S53, aplikace T1–T42, V1–V4, opravy W1–W17 a X1–X10). Každé
  nakonec shodilo kontrolu, na kterou mířilo.
- **Napoprvé nespadlo 6:**
  - S26, S30: kontrola chyběla. Doplněná.
  - S29: kontrola chyběla a pak měla špatné jméno. Opravená.
  - S8, T4: podmínka je nadbytečná, hlídá ji i jiné místo. Rozbité podruhé jinak (T4b) a přidaná
    přímá kontrola.
  - T29: regulárka v kontrole přetekla do sousedního dotazu a prošla nad rozbitým kódem. Kontrola je
    přepsaná.
- **Moje vlastní rozbití po konci, dvěma způsoby:**
  - storno z banky ruční úhradu nezruší;
  - storno ji zruší, ale nepřepočítá stav faktury.

  Obě shodila kontrolu „storno z banky zruší i ruční úhradu s tou platbou, faktura zpět Ke kontrole
  úhrady“ (naměřeno: Uhrazeno).

## Co čeká na Šéfíka

1. **Otázka 148** (vymyšlený výpis), nejlépe před nasazením.
2. **Otázka 137:** těsně před `db push` pustit jeden čtecí dotaz (žádné dvojí otevřené návrhy). Není to
   volba, jen připomínka.
3. Ostatní otázky 127–150. Většinou jde o meze, které jsem zvolil opatrně. Zajímavé jsou:
   - 128 a 143: přeplatek;
   - 132: storno v napojených bankách;
   - 133: pojistka, kterou zadání chce a zkouška 11 ne;
   - 150: Vrátit u faktury s přeplatkem.
4. Před nasazením proklikat nové obrazovky. Já je neviděl.
5. Pořád platí body z 23. 11.: otázky 110–126 a PR #183 (audit).

## Otázky

Jsou v `docs/hlaseni/otazky.md`, čísla 127–150. Další volné číslo je 151.

## Na co jsem narazil a nešlo to

- **Moje vlastní tvrzení neplatilo.** Po 2. kole oprava napsala, že pořadí zámků je v pořádku a uváznutí
  nevznikne. Třetí kontrola ukázala, že ruční úhrada a storno z banky berou zámky obráceně a mohou se
  navzájem zablokovat. Při opravě se našlo totéž ve „Vrátit“ a u započtení dobropisu. Teď platí jedno
  pořadí pro všechny cesty. Poučení: rozbor bez zkoušky není důkaz. Souběh ale PGlite ani CI předvést
  neumí, takže zůstává jen kontrola nad textem funkcí.
- **Implementace sama nedokončila ověření** (18 rozbití v databázi, celý řetěz, typy). Doplnila je až
  opravující část, kterou jsem k tomu výslovně navedl. Proto teď oprava povinně začíná tím, co
  implementace nechala nedodělané.
- **Oprava jednoho nálezu rozbila cizí scénář.** Změnila začátek hlášky „Nemáte oprávnění párovat“
  a `krok99` ji přestal poznávat. Ukázal to až celý řetěz. `krok99` nejde pustit samostatně, potřebuje
  data z dřívějších scénářů.
- **Kontrola čitelnosti scénářů počítá závorky i v textu kontrol.** Nová kontrola měla v popisu `(` a CI
  by kvůli tomu spadlo. Opraveno v `9a9735d`.
- **Zúžení z nálezu 3. kola samo nestačilo.** Revize doporučila u ručního párování pouštět jen platby,
  které potvrdila banka. Stejný vymyšlený výpis by ale fakturu zaplatil automaticky jistou shodou, kterou
  zadání pouští. Proto jsem pravidlo nezúžil a rozhodnutí nechal na majiteli (otázka 148).
- **Po „Vrátit“, které skončí ve stavu Částečně uhrazeno, appka nic nenapíše.** Jen přesměruje na seznam
  a stav je vidět v řádku. Seznam umí ukázat jen chybu, ne zprávu o výsledku.
- **Appka ukazuje tlačítka i tam, kde je databáze odmítne** (otázka 149). Hláška je srozumitelná, ale
  lepší by bylo tlačítka neukazovat.
- **Paměť počítače:** volného bylo kolem 1 GB, proto všechno běží jedno po druhém. Samotné kontroly
  a opravy kroku 2 běžely 24. 11. přes 3,5 hodiny. Relace se jednou přerušila (23. 11. večer). Pokračování
  navázalo na uložené výsledky a nic se nedělalo dvakrát.

## Kde jsem skončil a co zbývá

- **Krok 2 je uzavřený** commitem `9a9735d` a otázkami v `aeb32c4`. Větev je pushnutá.
- **Další je krok 3:** pobočky a účty. Každá pobočka má mít platební účet a bez něj to Finance řeknou
  nahlas. Po něm následuje krok 4 (právo „Schvalovat nákupy a platby“), který se buď udělá celý, nebo
  vůbec.
- Na konci: hlášení, push, PR větve `finance-faze0` (bez sloučení).

## Nenasazoval jsem

Žádný `db push`, žádné sloučení, žádná změna ostrých dat.
