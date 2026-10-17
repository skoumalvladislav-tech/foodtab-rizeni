# Jiné platby: návod pro obsluhu a schvalovatele

Finance → Tržby → Jiné platby. Stav k 16. 10. 2026.

## Nejdřív: co z toho už běží

| Část | Stav |
|---|---|
| Celá agenda Jiné platby | **Zatím neběží v ostré appce.** Je v PR, databázová změna není nasazená (`db push` nespuštěn). Po sloučení a nasazení se objeví v menu. |
| Obrazovky, nahrání fotek, kontrola dokladu, zápis tržby, schválení výdeje, faktura a úhrada | **Testováno**: testy appky a scénář nad čistou databází. Proti ostré databázi zatím neběželo. |
| Rozpoznání fotky přes AI | **Testováno** na podvržených odpovědích. Skutečné rozpoznání poběží s klíčem Foodtabu, stejně jako u faktur z e-mailu. |
| Kontrola „je prodej už v pokladně?“ u Dotykačky | **Testováno** na podvržených odpovědích podle oficiální dokumentace. Na skutečné Dotykačce neběželo. |
| Výdej ze skladu přímo do Dotykačky | **Připraveno, ale vypnuté.** Dnes ho schvalovatel provede v Dotykačce sám a v appce ho doloží (viz níž). |
| Vystavení faktury z appky | **Blokováno** (otázka 51). Jde propojit fakturu vystavenou v pokladně nebo v účetním programu. |

Podrobnosti o pokladně jsou v `docs/jine-platby-pos-operace.md`.

## K čemu to je

Host chce místo účtenky fakturu. Obsluha vyfotí sjetinu z pokladny,
otevřený účet nebo ručně sepsané položky. Appka z fotky přečte položky
a částky. Pak se zvlášť vyřeší čtyři věci:

1. **Tržba**: zapíše se do Ostatních tržeb, nebo se jen propojí, když už je v pokladně.
2. **Sklad**: návrh výdeje, který potvrdí oprávněná osoba.
3. **Faktura**: podklady, nebo propojení faktury vystavené jinde.
4. **Úhrada**: až podle skutečné platby z banky.

Každá část má vlastní stav. **Hotová jedna neznamená hotovou jinou.**
A název „Jiné platby“ neznamená, že je zaplaceno.

## Kdo co smí

Práva se přidělují v Nastavení → Oprávnění. Platí na pobočkách, kde
člověk pracuje. Vedoucí jen Bernard Baru schvaluje jen Bernard Bar.

| Právo | Typicky má |
|---|---|
| Jiné platby: vytvořit záznam a nahrát doklad | obsluha |
| Jiné platby: upravit návrh (položky, ceny, mapování do pokladny) | obsluha, provozní |
| Jiné platby: odeslat skladový návrh ke schválení | obsluha, provozní |
| Jiné platby: potvrdit zápis do Ostatních tržeb | provozní, pokladní |
| Jiné platby: Potvrdit výdej do POS | vedoucí provozovny, skladník |
| Jiné platby: vystavit nebo propojit fakturu a evidovat úhradu | účetní, majitel |
| Jiné platby: oprava a storno | majitel, provozní ředitel |

- **Právo na tržbu neumožní odečíst sklad** a naopak. Hlídá to databáze, ne jen schované tlačítko.
- Majitel má všechno automaticky. Ostatním je potřeba práva přidělit, sama se nikomu nepřidala.

---

## Obsluha: založit záznam a připravit návrh

1. **Finance → Tržby → Jiné platby → Přidat záznam.**
2. Vyberte **provozovnu** (na pobočce je daná) a **pokladnu**, která ji obsluhuje. Bez pokladny jde záznam založit taky, ale výdej ze skladu přes pokladnu pak připravit nejde.
3. Napište **zákazníka nebo označení účtu** (např. „Svatba Novákovi, stůl 12“) a klikněte **Založit záznam**.
4. Na kartě záznamu nahrajte doklad:
   - **Vyfotit**: otevře fotoaparát telefonu;
   - **Vybrat fotku nebo PDF**: z galerie nebo souboru;
   - dlouhou sjetinu vyfoťte po částech, k jednomu záznamu jde až 10 fotek nebo stránek;
   - stejnou fotku podruhé appka nepřijme, ani k jinému záznamu.
5. Klikněte **Rozpoznat z dokladu**. Fotky se pošlou schválené AI službě (Anthropic) a nic jiného s nimi. Když AI zapnutá není, zadejte položky ručně.
6. **Zkontrolujte, co appka přečetla.** Originál je vlevo, položky vpravo.
   - Žlutě označené řádky a důvody nahoře potřebují váš pohled.
   - Appka nic nedomýšlí: co nepřečetla, zůstane prázdné.
   - U každé položky zkontrolujte název, množství, jednotku a ceny. U celkové částky je napsané, odkud pochází: z dokladu, vypočtený součet (jen návrh), nebo ručně.
   - Vyberte **druh** položky: pokrm, rozlévaný nápoj, kusové zboží, služba, spropitné, sleva, neskladová položka.
   - Vyberte **produkt v pokladně**. Návrh appky je jen návrh, potvrďte ho, nebo vyberte jiný. Zaškrtnutím si appka přiřazení zapamatuje pro příště.
   - Řádek, který sedí, potvrďte zaškrtnutím.
7. **Uložit návrh**, potom **Označit jako zkontrolované**. Dokud něco čeká na kontrolu, označit to nejde.
8. **Odeslat ke schválení** (sklad). Tím se **sklad nemění**, jen to dostane schvalovatel.

**Pivo:** „2× pivo 0,5 l“ zapište jako 2 kusy produktu „Pivo 0,5 l“.
Kolik litrů to je, ví pokladna podle svého nastavení. Když doklad uvádí
litry a pokladna neříká, kolik je v jednom kusu, appka řádek označí ke
kontrole.

---

## Pokladní nebo provozní: zápis tržby

V části **Tržba (Ostatní tržby)**:

1. **Zkontrolujte, jestli stejný prodej už není v pokladně.**
   - **Zkontrolovat v pokladně**: appka se zeptá pokladny, pokud to umí (Dotykačka).
     - Přesná shoda čísla dokladu = „nalezeno“.
     - Shoda jen podle částky = „pravděpodobně“, nikdy „nalezeno“.
     - Otevřený účet = „nelze ověřit“. Až ho pokladna uzavře, zapíše ho do tržeb sama.
   - **Zapsat ruční prohlášení**: když se pokladna zeptat nedá, napište, jestli prodej v pokladně je, nebo není, a proč. Na obrazovce i v historii zůstane, že jde o ruční prohlášení, ne o ověření z pokladny.
   - Kontrola platí 30 minut a jen pro tu podobu záznamu, kterou jste kontrolovali. Po úpravě ji zopakujte.
2. Podle výsledku:
   - **Zapsat do Ostatních tržeb**: jen když je vyloučené, že prodej je v pokladně. Tržba se započítá.
   - **Jen propojit (do součtu se nepřičte)**: prodej už v pokladně je. Ukáže se, ale nezapočítá se znovu.
3. Když appka hlásí **možnou duplicitu** (stejná provozovna, den, částka a měna, nebo stejné číslo účtu), otevřete ten druhý záznam. Když to duplicita není, napište důvod.
4. **Opravit / stornovat** (právo na opravy): původní řádek zůstane v historii, oprava je nový řádek. Když je propojená faktura, je potřeba číslo opravného dokladu (dobropisu).

**Fotografie sjetiny nedokazuje, že host zaplatil.** Zápis tržby
nepřidá ani korunu na účet ani do cashflow.

---

## Schvalovatel: Potvrdit výdej do POS

Seznam čekajících je v přehledu na záložce **Čeká na schválení výdeje**.
Na kartě záznamu uvidíte:
- originál dokladu;
- položky a množství v jednotkách pokladny;
- přiřazení k produktům;
- pokladnu a provozovnu;
- plánovanou operaci;
- výsledek kontroly, jestli pokladna spotřebu už neodečetla.

1. **Zkontrolujte v pokladně, že výdej ještě neproběhl.** Buď **Zkontrolovat v pokladně**, nebo **Zapsat ruční prohlášení** s důvodem. Kontrola platí 15 minut. Musí proběhnout **těsně před schválením**, protože pokladna mohla mezitím odečíst sama.
2. Podle výsledku:
   - **už odečteno** → **Propojit (nic znovu neodečítat)**. Výdej se nevytváří;
   - **neodečteno** → **Potvrdit výdej do POS** (dvoukrokově);
   - **nelze zjistit** → ověřte v pokladně a doložte s důvodem.
3. Nesouhlasíte? **Zamítnout** s povinným důvodem. Obsluha návrh opraví a pošle znovu.
4. **Změna po schválení:** když někdo změní položky, množství, přiřazení nebo pokladnu, schválení **propadne** a návrh se musí schválit znovu.

### Provedení výdeje u Dotykačky (dnes ručně)

Appka zatím do Dotykačky nezapisuje. Po schválení ukáže podklad:
1. V Dotykačce založte účet se schválenými položkami a zaplaťte ho způsobem **Odpis**. Pokladna odečte suroviny podle své receptury a do tržeb se to nepočítá.
2. V appce klikněte **Ručně doloženo** a zadejte číslo dokladu z Dotykačky a důvod.
3. Stav bude **„Ručně doloženo (neověřeno pokladnou)“**. Stav „Odečteno v POS“ appka nastaví jen tehdy, když výdej sama ověří v pokladně, a to dnes neumí.

Pokrm se vydává **jako pokrm**, nikdy jeho suroviny zvlášť. Suroviny
odečte pokladna sama. Služby, spropitné a položky, které pokladna ze
skladu neodečítá, se do výdeje nedávají.

### Záznam bez pokladny

Když provozovna nemá pokladnu, návrh výdeje nevznikne. Po kontrole
údajů klikněte rovnou **Ručně doloženo** a napište, jak se spotřeba
vyřešila (např. papírová výdejka).

### Když se něco pokazí (až bude zápis do pokladny zapnutý)

- **Nejasný výsledek** (pokladna neodpověděla): appka požadavek **neopakuje**. Klikněte **Dohledat v pokladně**. Teprve když pokladna prokazatelně nic neprovedla, jde **Zkusit výdej znovu**.
- **Korekce** provedeného výdeje (právo na opravy): **Zapsat korekci** s číslem dokladu z pokladny a důvodem. Původní výdej zůstává v historii.

---

## Faktura a úhrada

- **Uložit podklady**: odběratel z Kontaktů, položky a ceny jen z ověřených údajů. Appka vypíše, co chybí, například IČO nebo DPH.
- **Propojit fakturu**: číslo faktury vystavené v pokladně nebo v účetním programu. Faktura není tržba.
- **Napárovat platbu**: úhrada se eviduje jen podle **skutečné příchozí platby z banky** ve stejné měně. Napárovat jde jen platbu, kterou smíte vidět (finanční přehled). Do té doby platí **„Úhrada neověřena“**.

**Vystavení faktury ani výdej skladu neznamenají zaplacení.**

---

## Časté situace

| Situace | Co dělat |
|---|---|
| Host chce fakturu k otevřenému účtu | Doporučeno: účet v pokladně **uzavřít** způsobem platby faktura nebo převod. V Jiných platbách tržbu jen **propojit** a připojit číslo faktury, výdej nedělat, protože ho udělá pokladna. Jen když se účet v pokladně stornuje, zapíše se nová tržba a schválí se výdej (otázka 55). |
| Stejná sjetina vyfocená dvakrát | Stejnou fotku appka nepřijme. Jinak vyfocenou pozná jako možnou duplicitu podle čísla účtu nebo podle dne a částky. Tentýž prodej z pokladny nejde propojit dvakrát. |
| Ručně psané položky bez cen | Zapište, co víte. Cenu ani množství appka nedomýšlí a řádek zůstane ke kontrole, dokud ho nedoplníte a nepotvrdíte. |
| Na dokladu chybí celková částka | Appka nabídne součet položek jako **návrh** s poznámkou „vypočtený součet“. Potvrdíte ho, nebo opravíte. |
| „K úhradě“ je jiné než celkem | Tržba je celková cena prodeje. „K úhradě“, přijatá hotovost a vrácené peníze tržba nejsou, appka je ukáže jen pro kontrolu. |
| AI nečte nebo není zapnutá | Zadejte položky ručně, appka nic nevymýšlí. Za den jde nejvýš 200 rozpoznání na firmu. |
| Záznam omylem | **Zrušit záznam** jde, dokud nic neproběhlo. Autor smí zrušit svůj rozpracovaný záznam, jinak je potřeba právo na opravy. |
