# Jiné platby: co appka umí s pokladnou

Stav k 18. 10. 2026. Platí pro agendu Finance → Tržby → Jiné platby.
Technický návrh je v `docs/jine-platby-navrh.md`.

**Tahle agenda zatím nic neprovedla v žádné skutečné pokladně.** Nic
z níže uvedeného neběželo proti ostré ani testovací Dotykačce. Všechno
„testované“ je ověřené na podvržených odpovědích podle oficiální
dokumentace.

## Jak tabulku číst

| Značka | Co znamená |
|---|---|
| **Produkčně ověřeno** | Běží v ostré appce a viděli jsme výsledek na skutečných datech. |
| **Testováno** | Kód existuje a testy ho spouštějí na podvržených odpovědích pokladny nebo nad čistou databází. Na skutečné pokladně neběžel. |
| **Připraveno** | Kód existuje, ale je **schválně vypnutý**, než se ověří na testovacím cloudu a Šéfík dá pokyn. |
| **Blokováno** | Nejde udělat, chybí přístup, rozhodnutí nebo to pokladna neumí. |

## Dotykačka (první konektor)

Zdroj: oficiální dokumentace https://docs.api.dotypos.com/ (verze API
2026.38.1), ke každé použité adrese odkaz v kódu
(`lib/pokladna-dotykacka-sklad.ts`).

| Operace | Stav | Poznámka |
|---|---|---|
| Přihlášení, seznam provozoven, denní tržby a platby po způsobu | **Produkčně ověřeno** | Hotové od #132, beze změny. Data jsou jen denní součty, ne jednotlivé účty. |
| Katalog produktů (`GET /products`) | **Testováno** | Načte se do appky kvůli přiřazení položek (přesné ID produktu, jednotka, „odečítat ze skladu“). Receptury se z katalogu nepoznají vždy, kde to nejde, appka napíše „neví“. |
| Dohledání účtů (`GET /orders`, filtr provozovny a času) | **Testováno** | Kontrola „je tenhle prodej už v pokladně?“ podle čísla dokladu. Uzavřené účty se hledají podle **data uzavření** (den před až dva dny po dni prodeje), takže se najde i účet založený dřív. Samotná shoda částky dá jen „pravděpodobně“, nikdy „nalezeno“. Když pokladna hledání podle uzavření odmítne, výsledek je „nelze ověřit“. Filtr `completed` je ověřený jen podle dokumentace. |
| Otevřené účty (`namedFilter=openOrders`) | **Testováno** | Otevřené účty se hledají zvlášť podle data založení (až 60 dní zpátky). Otevřený účet appka pozná a fotka otevřeného účtu nikdy nedá „nenalezeno“. Až ho pokladna uzavře, zapíše ho sama do tržeb, appka ho proto nezapočítá znovu. Po zápisu tržby jde kontrolu zopakovat (varování „Možná zapsáno dvakrát“). |
| Dohledání vlastního požadavku podle externího ID (`externalId`) | **Testováno** | Slouží k obnově po výpadku: appka se nejdřív podívá, jestli pokladna požadavek provedla, a teprve pak by smělo vzniknout cokoli dalšího. |
| **Skladový výdej** přes „POS akci“ (účet zaplacený způsobem *Odpis*) | **Připraveno, vypnuto** | Funkce existuje a je otestovaná na podvržených odpovědích, ale **není připojená**: Dotykačka má v appce nastaveno „výdej jen ručně“. Postup zapnutí je níž. |
| Korekce provedeného výdeje přes API | **Blokováno** | Dokumentace neříká, jak stornovat vystavený doklad. Korekce je proto vždy ručně doložená oprávněnou osobou. Původní operace v historii zůstává. |
| Čtení skladových pohybů | **Blokováno** | Dotykačka je přes REST nedává (jen webhook). Appka proto výdej ověřuje dohledáním účtu, ne pohybu. |
| Vystavení faktury | **Blokováno** | Appka vydané faktury neumí (otázka 51). Jde jen propojit fakturu vystavenou jinde: v pokladně nebo v účetním programu. |
| Webhooky | **Neimplementováno** | Výsledek se dohledává přímým dotazem, žádná nová veřejná adresa nevzniká. |

## Jak dnes probíhá výdej u Dotykačky (ručně)

1. Obsluha připraví návrh. Schvalovatel ho zkontroluje v appce: originál, položky, množství, přiřazení k produktům a výsledek kontroly „už odečteno?“.
2. Schvalovatel klikne **Potvrdit výdej do POS**. Appka zaznamená schválení konkrétní verze návrhu a ukáže **podklad pro ruční zpracování**.
3. Schvalovatel provede odpis v Dotykačce sám: účet s těmito položkami zaplatí způsobem *Odpis*. Pokladna odečte suroviny podle **své** receptury.
4. V appce klikne **Ručně doloženo**, zadá číslo dokladu z pokladny a důvod. Doložení se váže na otisk návrhu, který měl otevřený; když se návrh mezitím vyměnil, appka ho odmítne.
5. Stav je **„Ručně doloženo (neověřeno pokladnou)“**, nikdy „Odečteno v POS“.
6. Mezi kroky 2 a 4 (stav „předáno k ručnímu odpisu“) nejde měnit produkty ani množství a záznam nejde zrušit. Když schvalovatel v pokladně nic neodepsal, klikne **Zrušit schválení** s důvodem.

## Co musí proběhnout, než se zápis do Dotykačky zapne

Zapnutí je změna jednoho řádku v kódu (`skladovyVydej: 'rucne'` →
`'api'` v `lib/pokladna-dotykacka.ts` a připojení funkce
`odeslatVydejDotykacka` k relaci). Smí se udělat **jen** když:

1. Na **testovacím cloudu** Dotykačky (licence z 12. 10. 2026) se ověří:
   - že účet zaplacený *Odpisem* odečte suroviny podle receptury;
   - že se **neobjeví** v denních tržbách (`productSales`) ani v platbách, které appka stahuje. Jinak by se tržba nebo spotřeba započítaly dvakrát;
   - že dohledání podle `externalId` vrátí právě ten účet;
   - že licence provozovny má funkci `posAction`;
   - co udělá pokladna, když je zařízení vypnuté (požadavek musí po vypršení platnosti propadnout).
2. **Šéfík dá výslovný pokyn** „zapni zápis do Dotykačky“ pro konkrétní provozovnu.

Do té doby appka do skladu Dotykačky **nezapisuje nic**.

## Jiné pokladny

Agenda se ptá jen obecného kontraktu (`lib/pos-provider-contract.ts`).
Pokladna bez katalogu a bez dohledání účtů (dnes příjmové API pro
„ostatní pokladny“) funguje takto:
- přiřazení položek jde jen podle názvů, které pokladna prodala;
- kontrola „je prodej v pokladně?“ je jen **ruční doložení s důvodem**;
- výdej je jen ruční.

Nový konektor dodá svůj adaptér a obrazovka ani databáze se nemění.

## Ochrany, které platí pro každou pokladnu

| Ochrana | Kde |
|---|---|
| Jeden prodej v pokladně = nejvýš jeden záznam a jedna tržba | unikátní indexy `jine_platby_pos_prodej`, `ostatni_trzby_jedna_na_prodej` |
| Prodej známý v pokladně se nezapočítá podruhé | `check (not (zapocitat and pos_prodej_id is not null))` |
| Nejvýš jedna živá operace výdeje na návrh | `pos_operace_jedna_ziva` |
| Souběžné kliknutí nic neodešle dvakrát | `pos_operace_zahajit` (zámek bez čekání) |
| Timeout se neopakuje naslepo | `lib/jine-platby-pos-operace.ts`: stav „nejasný výsledek“ a jen dohledání |
| „Odečteno v POS“ jen s ID operace z pokladny | check `stav <> 'uspech' or externi_id is not null` |
| Schválení platí jen pro tu verzi návrhu, kterou schvalovatel viděl | otisk obsahu v `jine_platby_skladove_navrhy` (produkt + množství + pokladna); nová nejasná položka návrh zneplatní (`zmena`) |
| Schválit jde jen zkontrolovaný záznam bez nevyřešených položek | `jine_platby_rozhodnout_vydej` |
| Druhý výdej téže sjetiny (jinak vyfocené) chce důvod | `app.jp_mozne_duplicity` (stejná pobočka + den + částka, nebo číslo účtu ±7 dní) |
| Během ručního odpisu se výdej nezmění ani nezruší; uvolní ho jen oprávněná osoba | `jine_platby_ulozit_navrh`, `jine_platby_zrusit`, `jine_platby_zrusit_schvaleni` |
| Kontrola „už odečteno?“ se opakuje těsně před schválením a před odesláním | platnost 15 minut, vázaná na verzi záznamu |
| Klíče pokladny jen na serveru | `lib/pokladna-relace.ts` (`server-only`, service_role po ověření práva) |
