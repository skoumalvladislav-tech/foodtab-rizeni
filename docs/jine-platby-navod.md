# Jiné platby: návod pro obsluhu a schvalovatele

Finance → Tržby → Jiné platby. Stav k 20. 10. 2026.

## Nejdřív: co z toho už běží

| Část | Stav |
|---|---|
| Celá agenda Jiné platby | **Zatím neběží v ostré appce.** Je v PR, databázová změna není nasazená (`db push` nespuštěn). Po sloučení a nasazení se objeví v menu. |
| Obrazovky, nahrání fotek, kontrola dokladu, zápis tržby, schválení výdeje, faktura a úhrada | **Testováno**: testy appky a scénář nad čistou databází. Proti ostré databázi zatím neběželo. |
| Rozpoznání fotky přes AI | **Testováno** na podvržených odpovědích. Skutečné rozpoznání poběží s klíčem Foodtabu, stejně jako u faktur z e-mailu. |
| Kontrola „je prodej už v pokladně?“ u Dotykačky | **Testováno** na podvržených odpovědích podle oficiální dokumentace. Na skutečné Dotykačce neběželo. |
| Výdej ze skladu přímo do Dotykačky | **Připraveno, ale vypnuté.** Dnes ho schvalovatel provede v Dotykačce sám a v appce ho doloží (viz níž). |
| Vystavení faktury z appky | **Blokováno** (otázka 51). Jde propojit fakturu vystavenou v pokladně nebo v účetním programu. |
| Kiosek na telefonu (vyfotit účet bez přihlášení) | **V PR, nenasazený** (migrace `20261022100000_jine_platby_kiosek`). Testováno testy appky a scénářem krok100. Na skutečném telefonu ani se skutečným úložištěm Supabase zatím neběželo. |

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

Kdo má jen práva Jiných plateb a nemá finanční přehled, vidí v navigaci Financí jen Jiné platby (ostatní obrazovky Financí by mu napsaly, že na ně nemá). Práva se přidělují v Nastavení → Oprávnění. Platí na pobočkách, kde
člověk pracuje. Vedoucí Bernard Baru schvaluje jen výdeje Bernard Baru.

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

## Obsluha na telefonu: kiosek Jiných plateb

Obsluha nemusí mít přístup do Financí ani se přihlašovat. Na provozovně je **telefon pobočky** a funguje podobně jako tablet Docházky:

1. **Jednou spárovat** (správce nastavení pobočky):
   - V appce otevřete **Nastavení → Zařízení** a vystavte registrační kód (platí 15 minut, jde použít jednou).
   - Na telefonu otevřete adresu **`/kiosek/doklady`**. Doporučujeme ji nejdřív přidat na plochu: Android, Chrome: ⋮ → *Přidat na plochu*; iPhone, Safari: Sdílet → *Přidat na plochu*. Pak ji otevřete ikonou **Doklady** a kód opište až tam.
   - V **Nastavení → Zařízení** u telefonu klikněte **Zapnout** u „Kiosek Jiných plateb“. Samotné spárování doklady nepovolí.
2. **Vyfotit a odeslat** (kdokoli u telefonu):
   - **Vyfotit**, případně další fotky, nebo **Vybrat z galerie** (i PDF). Fotka se sama zmenší.
   - Nepovinně připsat **označení účtu nebo poznámku**, třeba „stůl 4, firma Novák“.
   - **Odeslat doklad.** Telefon ukáže „Doklad (3 fotky) odešel v 14:05“.
   - Pod tím je **přehled dokladů odeslaných z tohoto telefonu dnes**: čas, počet fotek, poznámka a stav. Stav je „Přijato, čeká na kontrolu“, „Zkontrolováno“, „Zpracováno“, „Zrušeno ve Financích“, nebo „Bez fotky — pošlete znovu“, když fotka nedošla.
3. **Ve Financích** se doklad objeví v Jiných platbách pobočky jako **rozpracovaný**. Jako autor je uvedené zařízení, ne člověk (třeba „kiosek Telefon u baru“). Rozpoznání AI, kontrolu, tržbu, sklad a fakturu dělají lidé s právy Jiných plateb jako u každého záznamu.

Co telefon **neumí** a nevidí:
- Žádná finanční data ani cizí záznamy. Vidí jen přehled svých dnešních dokladů bez částek (otázka 69, rozhodnutí 24. 10.).
- Přidat fotky jde jen k dokladu, který telefon právě odeslal, a jen do dvou hodin.
- Z jednoho telefonu odejde nejvýš 20 dokladů za hodinu a 60 za den (otázka 66).
- Pokladnu u dokladu doplní appka sama, jen když ji pobočka má jedinou (otázka 68). AI se samo nespouští (otázka 67).

Telefonů pro doklady může mít pobočka **víc**. Každý se páruje a zapíná zvlášť a strop platí na každý zvlášť (rozhodnutí 24. 10.).

Telefon spárovaný na `/kiosek/doklady` slouží **jen na doklady**. Kiosek Docházky (kód k píchnutí, zálohy, směny) na něm nefunguje. Tablet Docházky se páruje na `/kiosek` a doklady z něj posílat nejde. Kdo chce obojí na jednom zařízení, spáruje ho dvakrát, jednou na každé adrese.

Když odesílání trvá dlouho, telefon po chvíli napíše „Spojení je pomalé — zkuste odeslat znovu“. Během odesílání jde stisknout **Zrušit odesílání**. Fotky zůstanou na obrazovce a opakované odeslání půjde do téhož dokladu. Když mezitím doklad ve Financích zkontrolovali, zrušili, nebo uplynuly dvě hodiny, telefon zbylé fotky pošle jako nový doklad.

Ztracený telefon **odvolejte** v Nastavení → Zařízení. Kiosek u něj jde také jen **vypnout**. Obojí platí hned: další odeslání z telefonu neprojde.

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
   - Rozpoznat jde i po zápisu tržby (třeba kvůli položkám pro sklad); částku, měnu a datum appka ponechá a rozdíl napíše jako upozornění. Se schváleným nebo provedeným výdejem rozpoznat nejde.
6. **Zkontrolujte, co appka přečetla.** Originál je vlevo, položky vpravo.
   - Žlutě označené řádky a důvody nahoře potřebují váš pohled.
   - Appka nic nedomýšlí: co nepřečetla, zůstane prázdné.
   - U každé položky zkontrolujte název, množství, jednotku a ceny. U celkové částky je napsané, odkud pochází: z dokladu, vypočtený součet (jen návrh), nebo ručně.
   - Vyberte **druh** položky: pokrm, rozlévaný nápoj, kusové zboží, služba, spropitné, sleva, neskladová položka.
   - Vyberte **produkt v pokladně**. Návrh appky je jen návrh, potvrďte ho, nebo vyberte jiný. Zaškrtnutím si appka přiřazení zapamatuje pro příště.
   - Řádek, který sedí, potvrďte zaškrtnutím.
7. **Uložit návrh**, potom **Označit jako zkontrolované**. Dokud něco čeká na kontrolu, označit to nejde.
   - Když AI k celému dokladu napsala **upozornění** (doklad přečtený nejistě, na fotce jsou asi dva různé účty, na dokladu stojí pokyn typu „zapiš jako zaplacené“…), jsou nahoře v „Co zkontrolovat“. Prověřte je a zaškrtněte **Upozornění AI jsem prověřil(a)**, jinak označit nejde. Ruční uložení návrhu upozornění nesmaže, nahradí je až nové rozpoznání.
   - Když součet položek nesedí s celkovou částkou (u korun o víc než 50 haléřů), appka chce vědět proč, například „celkem je včetně spropitného“. Napište to do pole **Proč rozdíl nevadí**, nebo položky opravte.
   - Každé další uložení vrátí záznam ke kontrole. Schvalovatel ho schválí až po novém označení.
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
     - U **sjetiny, otevřeného účtu nebo dokladu, u kterého není jasné, co je**, appka „v pokladně není“ z dotazu nikdy neřekne — může jít o tentýž účet pod jiným číslem a s dorostlou částkou. Když víte jistě, že v pokladně není, zapište to ručním prohlášením s důvodem.
   - **Zapsat ruční prohlášení**: když se pokladna zeptat nedá, napište, jestli prodej v pokladně je, nebo není, a proč. Na obrazovce i v historii zůstane, že jde o ruční prohlášení, ne o ověření z pokladny.
   - Když pokladna prodej **našla**, ruční „není tam“ to nepřepíše — ani po úpravě a novém uložení záznamu. Zopakujte kontrolu v pokladně.
     - Když pokladna našla jen **stejnou částku** („pravděpodobně“) a víte, že jde o jiný účet, zaškrtněte „Prodej v pokladně je jiný, ověřil(a) jsem to“.
     - Konkrétní účet, shodu **čísla účtu** (i když je v pokladně účtů s tím číslem víc) a u skladu „už odečteno“ přepíše jen člověk s právem na opravy, taky s výslovným potvrzením. V historii zůstane celý výsledek z pokladny.
     - Výsledek pokladny si appka pamatuje zvlášť. Ruční „je tam“ ho nesmaže, takže následné „není tam“ narazí na stejnou pojistku.
     - Konkrétní nález pokladny (účet, nebo že spotřebu už odečetla) nesmaže ani nová kontrola po úpravě záznamu, třeba po smazání nebo změně čísla účtu. Novou tržbu ani nový výdej pak appka nepustí. Přepsat ho smí jen člověk s právem na opravy a jeho rozhodnutí pak platí i po další úpravě záznamu.
     - Nález platí i pro **jiný záznam téhož dokladu nebo prodeje**, tedy se stejnou fotkou, nebo se stejným dnem, částkou a pobočkou, a to i pro zrušený záznam. Novou tržbu ani výdej k takovému záznamu bez práva na opravy appka nezapíše.
     - Když bylo číslo účtu přečtené špatně a pokladna našla cizí účet, opravte číslo a požádejte člověka s právem na opravy, ať výsledek pokladny přepíše.
   - Kontrola platí 30 minut a jen pro tu podobu záznamu, kterou jste kontrolovali. Po úpravě ji zopakujte.
2. Podle výsledku:
   - **Zapsat do Ostatních tržeb**: jen když je vyloučené, že prodej je v pokladně. Tržba se započítá.
   - **Jen propojit (do součtu se nepřičte)**: prodej už v pokladně je. Ukáže se, ale nezapočítá se znovu.
     - Když kontrola nenašla **konkrétní** účet (shoda jen podle částky, pokladna nejde ověřit), appka chce důvod do pole **Proč je prodej v pokladně**. Bez něj by tržba mimo pokladnu tiše zmizela ze všech součtů.
     - Když bylo propojení s **konkrétním účtem**, jde kontrolu zopakovat. Když pokladna ten účet nenajde, záznam dostane varování **„Možná nezapočítáno nikde“**: ověřte účet v pokladně (mohl být zrušený nebo přečíslovaný) a teprve když tam opravdu není, tržbu opravte. U propojení bez konkrétního účtu pozdější kontrola nic ověřit neumí a appka ji nenabízí.
3. Když appka hlásí **možnou duplicitu**, otevřete ten druhý záznam. Když to duplicita není, napište důvod do pole **Proč to není duplicita**. Za možnou duplicitu appka považuje:
   - stejnou provozovnu, den, částku a měnu, nebo
   - stejné číslo účtu (mezery a velká písmena nevadí) do 7 dnů u téže pokladny. Záznam bez pokladny jen na stejné provozovně, protože „stůl 5“ je na každé provozovně jiný. Na téže provozovně se porovná i záznam s pokladnou se záznamem bez ní.
   - Když je podobný záznam na provozovně, kterou nevidíte, appka neukáže, který to je. Rozhodne někdo s přístupem k oběma.
4. **Po zápisu**: když hrozí, že pokladna prodej přinese později (otevřený účet se uzavře), klikněte znovu **Zkontrolovat v pokladně**. Když ho pokladna najde, záznam dostane varování **„Možná zapsáno dvakrát“** (v přehledu je na to filtr) a detail nabídne storno. Sama to appka nekontroluje ani nestornuje (otázka 58).
5. **Opravit / stornovat** (právo na opravy): původní řádek zůstane v historii, oprava je nový řádek. Když je propojená faktura, je potřeba číslo opravného dokladu (dobropisu). Storno zruší i propojení s prodejem z pokladny.

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
4. Schválit jde jen **zkontrolovaný** záznam, ve kterém nic nečeká na vyřešení (nejasná položka, produkt, který v katalogu pokladny není, pokladna nebo provozovna, která už tuhle pobočku neobsluhuje).
   - Když výdej obsahuje **pokrm i kusové zboží**, appka upozorní a potvrdit výdej jde až se zaškrtnutím „Zboží není surovina toho pokrmu“. Suroviny pokrmu odečte pokladna podle receptury sama a appka receptury nezná. Pivo a jiné rozlévané nápoje varování nedávají.
5. **Možná duplicita výdeje:** když je podobný výdej (stejná provozovna, den a částka, nebo stejné číslo účtu) už odeslaný nebo provedený, appka chce důvod, proč to není tatáž sjetina. Jinak by se sklad odečetl dvakrát.
6. **Změna po schválení:** schválený výdej (i když se provedení v pokladně nepovedlo) **nejde měnit**: obsluha nezmění produkt ani množství a nepřidá nejasnou položku, ani majitel záznam nezruší. Schvalovatel totiž může právě odepisovat v pokladně. Když se má něco změnit, schvalovatel nejdřív klikne **Zrušit schválení** s důvodem (v pokladně nic neodepsáno), pak obsluha opraví a pošle znovu. Přejmenování položky nebo jiné označení záznamu výdej nemění; záznam se ale musí znovu označit jako zkontrolovaný.

### Provedení výdeje u Dotykačky (dnes ručně)

Appka zatím do Dotykačky nezapisuje. Po schválení ukáže podklad:
1. V Dotykačce založte účet se schválenými položkami a zaplaťte ho způsobem **Odpis**. Pokladna odečte suroviny podle své receptury a do tržeb se to nepočítá.
2. V appce klikněte **Ručně doloženo** a zadejte číslo dokladu z Dotykačky a důvod.
3. Stav bude **„Ručně doloženo (neověřeno pokladnou)“**. Stav „Odečteno v POS“ appka nastaví jen tehdy, když výdej sama ověří v pokladně, a to dnes neumí.

Dokud je výdej schválený nebo čeká na ruční odpis, **položky a množství nejde měnit** ani záznam zrušit. Kdyby se to dalo, mohl by vzniknout druhý odpis.
- **Ručně doloženo** nejde, když v návrhu zůstala nevyřešená položka — ta by se neodečetla nikdy.
- **Ručně doloženo** se váže na návrh, který máte otevřený. Když ho mezitím někdo vyměnil, appka doložení odmítne. Načtěte stránku a doložte to, co jste v pokladně opravdu odepsali.
- Když jste v pokladně **nic neodepsali** (host odešel, chyba v návrhu), klikněte **Zrušit schválení** a napište důvod. Výdej se vrátí do stavu „bez návrhu“ a obsluha ho může opravit a poslat znovu. Zrušit schválení smí jen ten, kdo smí výdej potvrdit. Starší kontrola v pokladně tím přestane platit: před novým schválením je potřeba výdej v pokladně zkontrolovat znovu.
- Když měl zrušený požadavek **nejasný výsledek** (mohl v pokladně proběhnout), appka si ho pamatuje. Ruční „neodečetla“ pak smí jen člověk s právem na opravy. Ostatní kliknou **Zkontrolovat v pokladně**, protože ta kontrola dohledá i zrušený požadavek.

Pokrm se vydává **jako pokrm** a jeho suroviny se do výdeje nepřidávají —
odečte je pokladna sama. Hlídá to schvalovatel (appka receptury nezná). Služby, spropitné a položky, které pokladna ze
skladu neodečítá, se do výdeje nedávají.

### Záznam bez pokladny

Když provozovna nemá pokladnu, návrh výdeje nevznikne. Po kontrole
údajů klikněte rovnou **Ručně doloženo** a napište, jak se spotřeba
vyřešila (např. papírová výdejka).

### Když se něco pokazí (až bude zápis do pokladny zapnutý)

- **Nejasný výsledek** (pokladna neodpověděla): appka požadavek **neopakuje**. Klikněte **Dohledat v pokladně**. Teprve když pokladna prokazatelně nic neprovedla, jde **Zkusit výdej znovu**.
  - Když dohledat nejde (pokladna odpojená, odpověď nečitelná), po vypršení platnosti požadavku jde výdej **ručně doložit** (v pokladně proběhl) nebo **zrušit schválení** (neproběhl). Obojí jen po ověření v pokladně a s důvodem.
- **Korekce** provedeného výdeje (právo na opravy): **Zapsat korekci** s číslem dokladu z pokladny a důvodem. Původní výdej zůstává v historii.

---

## Faktura a úhrada

- **Uložit podklady**: odběratel z Kontaktů, položky a ceny jen z ověřených údajů. Appka vypíše, co chybí, například IČO nebo DPH.
- **Propojit fakturu**: číslo faktury vystavené v pokladně nebo v účetním programu. Faktura není tržba.
  - Faktura **z pokladny** znamená, že tržbu má pokladna. K tržbě zapsané do Ostatních tržeb ji proto propojit nejde: nejdřív Ostatní tržbu stornujte a prodej z pokladny propojte. Se zapsanou fakturou z pokladny zase nejde zapsat novou Ostatní tržbu.
- **Napárovat platbu**: úhrada se eviduje jen podle **skutečné příchozí platby z banky** ve stejné měně. Napárovat jde jen platbu, kterou smíte vidět (finanční přehled): u účtu pobočky přehled té pobočky, u firemního účtu přehled za celou firmu. Do té doby platí **„Úhrada neověřena“**.
  - Napárovat nejde ke **zrušenému** záznamu, **stornovanou** platbu ani část platby, která už je spárovaná s fakturou v modulu Faktury.
  - Appka nabídne jen platby **z banky** (výpis nebo napojení banky). Ručně zapsaná platba ani platba z pokladny úhradu neprokáže.
  - Když banka napárovanou platbu později stornuje, úhrada se sama vrátí na „Úhrada neověřena“ a v historii zůstane proč.

**Vystavení faktury ani výdej skladu neznamenají zaplacení.**

---

## Časté situace

| Situace | Co dělat |
|---|---|
| Host chce fakturu k otevřenému účtu | Doporučeno: účet v pokladně **uzavřít** způsobem platby faktura nebo převod. V Jiných platbách tržbu jen **propojit** a připojit číslo faktury, výdej nedělat, protože ho udělá pokladna. Jen když se účet v pokladně stornuje, zapíše se nová tržba a schválí se výdej (otázka 55). |
| Stejná sjetina vyfocená dvakrát | Stejnou fotku appka nepřijme. Jinak vyfocenou pozná jako možnou duplicitu podle čísla účtu nebo podle dne a částky. Tentýž prodej z pokladny nejde propojit dvakrát. |
| Pokladna nemá načtený katalog | Výdej přes pokladnu nejde připravit ani ověřit přiřazení. Načtěte katalog (tlačítko u přiřazení položek) a přiřaďte položky znovu. |
| Provozovny pokladny se v Integracích přeřadily | Záznam, jehož provozovna teď patří jiné pobočce, nejde zkontrolovat v pokladně ani z něj schválit výdej (prohledával by cizí pobočku). Založte záznam znovu se správnou pokladnou. |
| Ručně psané položky bez cen | Zapište, co víte. Cenu ani množství appka nedomýšlí a řádek zůstane ke kontrole, dokud ho nedoplníte a nepotvrdíte. |
| Na dokladu chybí celková částka | Appka nabídne součet položek jako **návrh** s poznámkou „vypočtený součet“. Potvrdíte ho, nebo opravíte. |
| „K úhradě“ je jiné než celkem | Tržba je celková cena prodeje. „K úhradě“, přijatá hotovost a vrácené peníze tržba nejsou, appka je ukáže jen pro kontrolu. |
| AI nečte nebo není zapnutá | Zadejte položky ručně, appka nic nevymýšlí. Za den jde nejvýš 200 rozpoznání na firmu. |
| „Doklad je na jedno čtení moc dlouhý“ | AI to nestihla nebo odpověď nedokončila. Znovu to zkoušet nemá smysl (každý pokus se platí a počítá do stropu). Vyfoťte doklad po částech do samostatných záznamů, nebo zadejte položky ručně. |
| Na účtence není čas tisku | Appka datum vezme jako den tisku a u pobočky, která nezačíná den o půlnoci, napíše upozornění „ověřte provozní den“. Prodej po půlnoci patří do předchozího provozního dne. |
| Velká fotka | Fotku nad 5 MB (a fotku z iPhonu ve formátu HEIC) appka při nahrání sama zmenší. K rozpoznání jde fotka do 5 MB, PDF do 8 MB a nejvýš 20 stran, dohromady nejvýš 20 MB a 30 stran, po pořadí stránek. Co se nevejde, appka vyjmenuje dřív, než se pokus započítá. |
| Účet vytištěný po půlnoci | Když je na účtence čitelný čas a je dřív než začátek provozního dne pobočky, appka datum posune na předchozí provozní den a napíše to jako upozornění. Bez času datum nechá, zkontrolujte ho. |
| Položka bez čitelného názvu | Appka ji pojmenuje „Položka č. N (název nečitelný)“ a nechá ke kontrole. Doplňte název podle dokladu. |
| Záznam omylem | **Zrušit záznam** jde, dokud nic neproběhlo. Autor smí zrušit svůj rozpracovaný záznam, jinak je potřeba právo na opravy. Nejdřív je potřeba odpojit fakturu a úhradu a stornovat zapsanou tržbu. Se schváleným výdejem a během ručního odpisu zrušit nejde (nejdřív Zrušit schválení, viz výš). Fotky zůstanou v historii zrušeného záznamu a stejný doklad jde nahrát ke správnému záznamu. Když pokladna u záznamu našla konkrétní prodej nebo odpis, nebo k němu patří nedohledaný požadavek, smí ho zrušit jen člověk s právem na opravy. |
