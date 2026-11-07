# Stav k 4.–7. 11. 2026 — stoly a číslo rezervace z Choice (7. 11. sloučeno a nasazeno)

## Nejdřív to podstatné

- **7. 11.: sloučeno a nasazeno** na „sluč 176 a db push“: PR #176
  (`63bd158`), Vercel „Ready“ v 16:27:54, `db push` `20261107100000`
  v 16:33. Ověření v databázi sedí s předpovědí (oddíl „Nasazení
  7. 11.“ na konci).
- **Z Choice se ale od 3. 11. 19:41 nic nenačítá.** Obě napojení
  (Bernard Bar i Černá Perla) dostala v tomtéž běhu od Choice jednou
  **403** a náš kód je tím přepnul na „vyžaduje pozornost“ — od té doby
  se Choice vůbec neptá. Jestli Choice odmítá i dnes, nikdo neví.
  Nesouvisí to s touto PR (3. 11. se nic nenasazovalo), ale stoly ani
  číslo rezervace se proto zatím neukážou nikde. **Šéfík: u obou
  poboček v Rezervace → Napojení „Ověřit znovu“.** Kdyby neprošlo ani
  u jedné, je spíš něco u aplikace Foodtab v Choice a nové připojení
  může skončit stejně — pak napřed napsat Choice (api@choiceqr.com).
  Podrobně v oddílu „Nasazení 7. 11.“.
- **Šéfík:** „u načítání informací (rezervací) z choice nenačítá všechny
  informace, chybí například umístění a obsazení stolů“ (se snímkem
  rezervace #105 v Choice: Patro, stoly S1–S12).
- **Hotovo v PR #176, 7. 11. sloučené a nasazené.** Foodtab z Choice nově načítá:
  - **přidělené stoly** — v kalendáři (týden: vlastní řádek karty pod počtem osob, den:
    u počtu osob) a v detailu jako „Stoly v Choice: Patro: S1–S12“,
  - **číslo rezervace** — v detailu „Převzato z rezervačního systému
    (Choice, č. 105)“, ať se rezervace dá v Choice dohledat,
  - **důvod zrušení**, a jestli rezervace přišla **přes Google**
    a v jakém **jazyce** (když ne česky, např. „angličtina“) — v poznámce
    ze zdroje,
  - **přání hosta** (část podniku, kterou si host v Choice vybral) —
    zvlášť, ať se nemíchá se stoly, které mu restaurace přidělila.
- **Má migraci** (`20261107100000_rezervace_misto_zdroje.sql`: čtyři
  nové sloupce, spoušť, úprava zápisu rezervací a ranního souhrnu).
  **Nasazená 7. 11. v tomhle pořadí:** `db push` až po tom, co bylo
  nasazení na Vercelu „Ready“ (a pět minut po něm, ať doběhne
  načítání, které ještě mohl začít starý kód). Kdyby databáze byla
  nová dřív než kód, starý kód by u rezervací, kterým doplní „Stůl /
  prostor“, zapsal, že ho napsala obsluha — a kalendář by pak přání
  hosta ukazoval vedle stolů napořád (4. kolo, nález 18). Opačně to
  nevadí: do `db push` ukazuje kalendář rezervace bez stolů, ne chybu.
  Jen rezervace, které mezitím odejdou z okna načítání (36 h zpátky),
  už stoly nedostanou — proto `db push` hned, jak je Vercel hotový.
- **Jedna věc je NEOVĚŘENÁ proti živému Choice:** že id stolů
  u rezervace jsou tatáž id jako v seznamu míst Choice (dokumentace to
  neříká výslovně). Kdyby nebyla, ukáže se u rezervací „N stolů bez
  názvu“ a u napojení hláška *„U N rezervací poslal Choice stůl, který
  v seznamu míst v Choice není“*. Pozná se to hned po prvním načtení.
- **„Obsazení stolů v čase“ zatím ne.** Choice posílá délku návštěvy
  bez jednotky (minuty? milisekundy?), takže Foodtab nezná konec
  rezervace. Nehádá ho. Každé načtení si ale uloží až 5 ukázek, podle
  kterých se jednotka po prvním načtení pozná jistě (otázka 88; čeká,
  až Choice zase načítá).
- **Přesazení v Choice upozornění nepošle**, ani u akce (otázka 87).
- Nezávislá kontrola kódu našla **23 nálezů**. **18 je opravených**,
  4 čekají na Šéfíkovo rozhodnutí (otázky 87 a 88) a u jednoho změna
  potřeba nebyla. Tabulka je níž.
- **Druhé kolo kontroly** (nad opravami) našlo **16 nových nálezů**
  a u 3 starých jen částečnou opravu. **Všechno je opravené** (`caf587f`),
  nejdůležitější: pomalý Choice by dál bral druhé pobočce načítání
  dopředu, a moje první oprava „přání hosta vedle stolů“ nefungovala,
  když se seznam stolů zrovna nenačetl.
- **Třetí kolo kontroly** našlo **18 nálezů** (15 potvrzených,
  3 „možné“). **Všechno je opravené** (`bebb657`, `ad1b383`,
  `6decd9c`; zastaralá čísla v hlášení až ve 4. kole).
  Nejdůležitější: pozdě začaté načítání stolů dál zdržovalo druhou
  pobočku, chyba zápisu přebila hlášku „limit“ (úloha by se pak na
  Choice ptala dál), a „Stůl / prostor“ Foodtab odhadoval podle shody
  s přáním hosta — to selhalo, když si host přání změnil nebo když
  obsluha napsala totéž co host. Teď si Foodtab **poznamená, kdo
  „Stůl / prostor“ napsal** (nový sloupec a spoušť v databázi).
- **Čtvrté kolo kontroly** našlo **19 nálezů** (18 potvrzených,
  1 „možný“), po sloučení stejných z různých pohledů **13 různých
  věcí**. **Všechno je opravené** (`5107c3a`), jedno je pořadí nasazení
  (výš). Nejdůležitější: první pobočka v úloze by se stoly k rezervacím
  dál než 48 h nedostala nikdy; ranní souhrn ukazoval u akce staré
  přání hosta místo stolů; import u akce doplnil prázdný „Stůl /
  prostor“ a poslal upozornění „změnil se prostor“; a rezervace načtené
  před `db push` by nové rozlišení „kdo prostor napsal“ nedostaly nikdy.
- **Páté kolo kontroly** našlo **12 nálezů** (9 potvrzených, 3 „možné“),
  **9 různých věcí**, všechny drobnější. **Všechno je opravené**
  (`d8af065`, `1c72c51`; jedna věc už v `c639777`). Nejdůležitější:
  akce, u které host v Choice smazal přání, přišla v kalendáři
  i v ranním souhrnu o místo, i když ho ve formuláři má; stůl
  z příjmového API se u akce bez prostoru neuložil (oprava ze 4. kola
  platila na všechny zdroje, ne jen na Choice); a seznam stolů načtený
  hned na začátku úlohy obcházel pravidlo, které má chránit druhou
  pobočku.
- **Šesté kolo kontroly** našlo **10 nálezů** (8 potvrzených,
  1 „možný“, 1 vyvrácený). **Všech 9 platných je opravených**
  (`ddcfecf`). Nejdůležitější: oprava z 5. kola zavedla zámek — když se
  seznam stolů jednou nevešel do času, nezkusila ho už žádná další
  stránka, a prostřední pobočka v úloze by tak mohla zůstat bez nových
  stolů celý běh. Teď odmítnutí nic nezamyká. Dál: akce, u které jsou
  všechny stoly „bez názvu“ a host smazal přání, ukazovala jen „2 stoly
  bez názvu“ a místo z formuláře spolkla.
- **Sedmé kolo kontroly** (jen nad opravami 6. kola) našlo **7 různých nálezů**
  (4 potvrzené, 1 vyvrácený, 2 bez nezávislého ověření, které jsem ověřil
  sám a platí).
  **Všechny platné jsou opravené** (`1393b12`). Nejdůležitější: když se
  seznam stolů načetl až u pozdější stránky (to umožnila oprava 6. kola),
  u podniku s víc než 20 částmi by u napojení vyskočila planá hláška
  „Stoly z Choice se nenačetly celé … Pošlete prosím tu hlášku
  vývojáři“, i když stoly rezervace mezitím dostala.
- **Celý řetěz databázových scénářů našel jednu věc navíc**: starší
  scénář ranního souhrnu (`krok106`) porovnával souhrn akce přesně
  a nový údaj „kdo napsal prostor“ ho shodil. Upravené očekávání
  (`4de1a64`), na samotné opravě se nic neměnilo.
- **Schválná rozbití:** ze 184 starších jich nad stavem po 5. kole
  spadlo na své kontrole 180; zbylá čtyři vysvětlená níž, jedno z nich
  ukázalo chybějící kontrolu (doplněná, `aca1ddf`). Rozbití na opravy
  6. a 7. kola: 17 ze 17 a 11 ze 11. **Celé přejetí všech 200 nad
  konečnou verzí (`aca1ddf`): 200 ze 200 spadlo na své kontrole.**

## Co je hotové

| Co | Commit | Migrace |
|---|---|---|
| Stoly, číslo rezervace, důvod zrušení: převod v adaptéru, nové sloupce, zápis, kalendář a detail, testy, scénář `krok109` | `3a09279` | `20261107100000`, **nasazeno 7. 11.** |
| Návod, text u napojení, načtení v testu s vlastní ochranou | `c068777` | — |
| Týden: dlouhé stoly se zalomí na dva řádky, neuseknou se | `42359be` | — |
| Sloučení `main` (#175) do větve | `28f4de0` | — |
| Opravy z kontroly kódu (seznam míst mimo frontu, rozsahy, celá mapa, zkracování bez půlznaků, prostor vedle stolů, Google a jazyk, ukázka délky) | `6ec0878` | — (v migraci jen komentář) |
| Testy k opravám (souběh se stoly, rozsahy, necelá mapa, půlznaky, jen číslo) | `8194e13` | — |
| Kontrola „A1, B2, C3“, náhradní znak zapsaný escapem | `284a0c2` | — |
| Návod k Choice, otázky 87 a 88 | `d0f60a7`, `a4321a3` | — |
| Kontroly, které dvě rozbití neshodila (konec dílu úlohy, výjimka ve starých bězích) | `777cc99` | — |
| Opravy z 2. kola kontroly (seznam stolů souběžně s dotazy, přání hosta zvlášť, jména s „…“, čárka ve jménu stolu, jazyk česky, příjmové API, testy) | `caf587f` | v téže migraci (sloupec `prani_zdroje`) |
| Kontroly, které rozbití z 2. kola neshodila (chyba zápisu zastaví další dotaz, přání vždy s klíčem, délka zkrácených polí) | `2f882e0` | — |
| Opravy z 3. kola kontroly (stoly jen když se vejdou do dílu, „limit“ a „pristup“ přežijí chybu zápisu, výjimka počká na zápis, kdo napsal „Stůl / prostor“, akce bez upozornění, stoly bez názvu u části podniku, jazyk BCP 47) a testy k nim | `bebb657` | v téže migraci (sloupec `prostor_ze_zdroje`, spoušť) |
| Kontrola „obsluha bez stolů ukáže svůj text, ne přání hosta“ | `ad1b383` | — |
| Test hranice seznamu míst ze dvou časových limitů, ne z konstanty (rozbití „nejdelší mapa = jeden dotaz“ nic neshodilo); návod po 3. kole | `6decd9c` | — |
| Opravy ze 4. kola kontroly (seznam stolů v dílu, který dočítá úlohu; seznam stolů hned u napojení se stoly; chyba zápisu během čekání na frontu; ranní souhrn se stoly; akce bez doplňování prostoru; příznak u starých řádků; smazané přání) a testy k nim | `5107c3a` | v téže migraci (zápis rezervací, ranní souhrn) |
| Kontroly, které rozbití ze 4. kola neshodila (route posílá „poslední připojení“, výjimka během zápisu s druhou stránkou ve frontě, výjimka v ranním souhrnu shodí jen svou kontrolu) | `c639777` | — |
| Opravy z 5. kola kontroly (seznam stolů hned na začátku úlohy podle dílu, místo akce bez přání, stůl z příjmového API u akce, hranice příznaku v `krok109`, komentáře a návod) a testy k nim | `d8af065` | v téže migraci (zápis rezervací) |
| Přejmenovaná kontrola dílu, který dočítá úlohu (nejmenovala se podle toho, co hlídá) | `1c72c51` | — |
| Scénář ranního souhrnu `krok106`: očekávaný souhrn akce s novým údajem „kdo napsal prostor“ | `4de1a64` | — |
| Opravy z 6. kola kontroly (odmítnutí seznamu stolů nic nezamyká, test odhadu konce dílu a nerovnosti, na které stojí, akce se stoly „bez názvu“, vykreslený kalendář, `krok109` akce bez klíče stolů, komentáře) | `ddcfecf` | — |
| Opravy ze 7. kola kontroly (počty „bez stolů“ a „stůl mimo seznam“ podle posledního zápisu, hláška o necelém seznamu jen pro rezervace, kterým stůl v seznamu chyběl, „cas“ jen u stránky, test vlastnosti uvnitř kontroly, hlavička a návod) | `1393b12` | — |
| Kontrola, kterou našlo rozbití: po chybě zápisu běh už nečeká na frontu dotazů | `aca1ddf` | — |
| Hlášení | (tento commit) | — |

## Jak se stoly převádějí

- Choice u rezervace posílá jen **id stolů** (`locationPoints`). Jména
  dává seznam míst v Choice: nejdřív části podniku (Patro, Terasa…),
  pak stoly v každé. Seznam se načte **nejvýš jednou za běh** a jen
  když nějaká rezervace stoly má. Napojení, u kterého běh stoly jednou
  viděl, si to zapamatuje a další běhy načtou seznam **hned na
  začátku**, souběžně s prvním dotazem — jinak by se v úloze se dvěma
  pobočkami první pobočce nevešel nikdy (4. kolo). I na začátku ale
  platí, že seznam stolů nesmí zdržet další pobočku (5. kolo); když se
  nevejde, zkusí to každá další stránka se stoly — nic se nezamyká
  (6. kolo).
- Stoly se řadí podle čísla (S2 před S10). **Rozsahem** (S1–S12) se
  píšou jen tři a víc stolů se stejným jménem, jejichž čísla jdou bez
  mezery po jedné.
  „A1, B2, C3“ a „S1, S2, S4“ zůstanou vypsané. Rozsah tak nikdy
  nezahrne stůl, který host nemá.
- Víc částí podniku se oddělí tečkou: „Patro: S1, S2 · Terasa: L7“.
  Dlouhý seznam se zkrátí na 300 znaků, vždy za celým stolem a s „ …“ —
  i když je ve jménu stolu čárka. Jméno stolu delší než 40 znaků (části
  podniku 60) se zkrátí a dostane „…“: ze „Stolek 123“ nesmí zbýt
  „Stolek 12“, to je jiný stůl.
- Stoly patří Choice a každé načtení je přepíše. **„Stůl / prostor“**
  patří dál obsluze. Když je prázdný, Choice ho při načtení doplní
  přáním hosta (i u rezervace se stoly) a Foodtab si **poznamená, že ho
  napsal Choice**. Jakmile ho změní kdokoli jiný, poznámku databáze
  sama zruší (spoušť). **U akce ho Choice nedoplní nikdy** — akce má
  prostor od obsluhy a doplnění by poslalo upozornění „změnil se
  prostor“ (4. kolo); přání hosta se u ní ukáže z vlastního sloupce.
  Platí to jen pro Choice: příjmové API posílá skutečný stůl a ten se
  do prázdného „Stůl / prostor“ doplní i u akce, jako dřív (5. kolo).
  Podle poznámky kalendář i ranní souhrn rozhodují:
  - napsal Choice a rezervace má stoly → ukáže jen stoly („Patro“
    vedle přidělené „Terasa: L7“ by se četlo jako dvě místa),
  - napsala obsluha → ukáže se vždycky, i když zní stejně jako přání
    hosta, a vedle stolů z Choice, když je jiný (třeba „u okna“),
  - rezervace bez stolů → aktuální přání hosta, ne to, které se doplnilo
    kdysi; když ho host v Choice smazal, nic (detail řekne „doplněno
    z Choice“). **U akce** se pak ukáže to, co má ve „Stůl / prostor“:
    import ho u akce nemění a kuchyně by o místo akce přišla (5. kolo).
- Proč hned i u rezervace se stoly: kdyby se „Stůl / prostor“ doplnil
  až ve chvíli, kdy Choice stoly odebere, poslala by akce upozornění
  „změnil se prostor“, které nikdo nechtěl (3. kolo kontroly).
- **Přání hosta** se ukládá zvlášť a obnoví se při každém načtení.
  V detailu je u „Stůl / prostor“ od Choice „(přání hosta v Choice)“,
  nebo „(doplněno z Choice)“, když si host přání mezitím změnil — to
  aktuální má vlastní řádek. Rezervace načtené před nasazením poznámku
  nemají. Dostanou ji při nejbližším načtení: když je „Stůl / prostor“
  stejný jako přání, které Choice posílá, zapíše se „napsal Choice“
  (4. kolo). Obsluhu, která u takové staré rezervace napsala přesně
  přání hosta, od Choice rozeznat nejde — bere se jako Choice. Do té
  doby rozhoduje shoda s přáním jako dřív.
- Stůl, který Choice zná, ale nemá jméno, se počítá u své části
  podniku („Patro: S1, 1 stůl bez názvu“). Stůl, který v seznamu míst
  vůbec není, nemá ani část podniku. Když má rezervace jen takové
  („2 stoly bez názvu“), ukáže se vedle nich přání hosta, ať karta
  neztratí místo — u akce bez přání „Stůl / prostor“ z formuláře
  (6. kolo).
- Když se seznam míst nepovede načíst, rezervace se načítají dál a stoly
  u nich zůstanou z minula. U napojení je o tom hláška.

## Kontrola kódu — 23 nálezů a co s nimi

Pět pohledů (adaptér, databáze, obrazovka, testy, produkt), každý nález
pak nezávisle ověřený. Výsledek: 18 potvrzených, 5 „možných“.

| # | Nález | Co s ním |
|---|---|---|
| 1 | Seznam míst si bral místo ve frontě dotazů → druhé pobočce by se přestalo načítat 180 dní dopředu | **Opraveno** (`6ec0878`): seznam míst jde mimo frontu (limit 1 dotaz / 5 s má Choice jen u rezervací), hlídá se jen čas |
| 2 | Totéž z pohledu produktu (Perla + Bernard Bar) | **Opraveno** spolu s 1 |
| 3 | Testy souběhu neměly u rezervací stoly, takže chybu 1 nemohly chytit | **Opraveno** (`8194e13`): rezervace v souběhu mají stoly, test hlídá i to, že se stoly načetly všude |
| 4 | Rozsah přes různá jména stolů (S9, T1, T2 → „S9–T2“) | **Opraveno**: rozsah jen u stejného jména a čísla o jedna |
| 5 | Rozsah ze sousedů v abecedě („Bar 3–Okno“ přes stoly, které host nemá) | **Opraveno** spolu se 4: sousedé v seřazeném seznamu nestačí, musí mít stejné jméno a čísla po jedné |
| 6 | Necelý seznam míst (víc než 20 částí podniku) se hlásil jako v pořádku a stoly přepsal na „bez názvu“ | **Opraveno**: necelý seznam dá „nevím“ (stoly zůstanou), u napojení hláška |
| 7 | Zkrácení na 300 znaků mohlo useknout jméno stolu („S1“ z „S12“) nebo rozpůlit emoji | **Opraveno**: zkracuje se za celým stolem, emoji se nerozpůlí |
| 8 | Rozpůlený znak (osamělá půlka emoji) by databáze odmítla a s ním celou stránku rezervací | **Opraveno**: zkracování v celém importu nahradí osamělou půlku náhradním znakem |
| 9 | Žádná kontrola nehlídala změnu jen čísla rezervace | **Opraveno**: kontrola v `krok109` |
| 10 | Obsluha napíše „S1“, stoly z Choice „Patro: S1–S12“ → obsluhy se schovalo | **Opraveno**: schová se jen přesná shoda nebo jméno části podniku |
| 11 | Totéž z pohledu testů (testy jen zamýšlený případ) | **Opraveno**: 6 nových kontrol |
| 12 | Přání hosta (Terasa) vedle jiných přidělených stolů | **Opraveno**: přání hosta jen u rezervace bez stolů |
| 13 | Bublina s celým seznamem stolů na kartě týdne se nikdy neukáže (zakrývá ji odkaz karty) | **Opraveno** v CSS a ověřeno v prohlížeči (headless Chrome, 1440 px světlý a 1280 px tmavý): pod myší je u všech 9 karet řádek stolů, ne překryv, a klik na něj otevře rezervaci |
| 14 | Časový limit seznamu míst testovaný jen porovnáním konstant | **Opraveno**: test měří limit, který opravdu dostane každý dotaz |
| 15 | Kontrola `.every` nad prázdným výběrem projde, i když se rezervace nezapsala | **Opraveno**: nejdřív počet, pak obsah |
| 16 | Naměřené hodnoty před pevným očekáváním v názvu kontroly | **Opraveno**: očekávání pevně na začátku |
| 17 | Jeden `try` kolem 16 kontrol — výjimka schovala zbytek | **Opraveno**: každá riziková kontrola zvlášť |
| 18 | Choice posílá Google a jazyk, Foodtab je zahazoval | **Opraveno**: do poznámky ze zdroje. Částku zálohy, délku a další údaje bez jasné jednotky nechávám |
| 19 | Změna stolů v Choice nikoho neupozorní, ani u akce | **Čeká na Šéfíka** — otázka 87. Schválně tak (přeskupení stolů by spamovalo) |
| 20 | Totéž: `krok109` by upozornění ani nepoznal | **Čeká** s 19 |
| 21 | Totéž pro ranní souhrn akcí | **Čeká** s 19 |
| 22 | Obsazení stolů v čase chybí (bez konce rezervace) | **Čeká** — otázka 88. Připravené: ukázky délky se ukládají |
| 23 | Stav `EXPIRED` by se zapsal jako předběžná | **Beze změny**: Choice má v seznamu stavů jen sedm stavů a `EXPIRED` mezi nimi není. Neznámý stav se zapíše jako předběžná a původní slovo zůstane, nikdy ne „proběhla“ |

## Druhé kolo kontroly — 16 nových nálezů

Stejných pět pohledů znovu, tentokrát nad opravami. Každý nový nález
zase nezávisle ověřený: **12 potvrzených, 4 „možné“**. U tří starých
nálezů (čárka ve jménu stolu, „Stůl / prostor“ vedle stolů, jedna
kontrola mimo vlastní obal) byla oprava jen částečná. Všechno je
opravené v `caf587f`, nic nečeká.

| Nález | Co s ním |
|---|---|
| **Pomalý seznam stolů dál bral dotazy:** další dotaz na rezervace na něj čekal. Od ~3,7 s na dotaz by druhé pobočce v úloze nezbyl dotaz na 180 dní dopředu | Seznam stolů se načítá **souběžně** s dalšími dotazy. Čeká na něj jen zápis stránky; zápisy jdou popořadě a chyba zápisu zastaví další dotazy i posun kurzoru jako dřív. Nový test: úloha se 2 a 3 připojeními a seznamem stolů za 4 s, 5 s a „visí“ — každé připojení udělá stejně dotazů jako s rychlým seznamem |
| **Přání hosta vedle stolů — moje oprava z 1. kola nestačila** (5 nálezů z různých pohledů): když se seznam stolů nenačetl, nebo rezervace stoly dostala až později, „Patro“ zůstalo ve „Stůl / prostor“ vedle „Terasa: L7“ | Přání se do „Stůl / prostor“ doplní, jen když rezervace stoly **nemá** (podle Choice, ne podle toho, jestli se načetly jména). Přání má **vlastní sloupec** a kalendář podle něj starší přání vedle stolů schová; detail ho označí |
| Jméno stolu useknuté na 40 znaků uprostřed čísla („Stolek 123“ → „Stolek 12“ = jiný stůl) | Delší jméno končí „…“ (stůl 40, část podniku 60) a do rozsahu se nespojí |
| Jazyk jako kód velkými („UK“ u ukrajinštiny se čte jako Británie, „en-GB“ se zahodil) | Jméno jazyka česky („ukrajinština“, „angličtina“); neznámý kód zůstane „kód XX“ |
| Zkrácení u čárky v hotovém textu (čárka může být i ve jménu stolu) | Text se skládá po celých stolech |
| Jméno části podniku s „: “ nebo „ · “ se ve „Stůl / prostor“ zdvojilo | Porovnání bez rozdělování textu |
| Příjmové API (rezervace z webu) dál zkracovalo obyčejně a mohlo rozpůlit emoji — databáze by odmítla celou dávku | Stejné zkracování jako import |
| Testy (6 nálezů): seznam stolů až na 2. stránce, přesné zkrácení, část kontroly, která nemohla spadnout, kontroly bez obalu, „celý seznam“ jen podle výchozí hodnoty, „bez dotazu“ neověřené | Všech 6 opravených; část, která nemohla spadnout, je pryč |

## Třetí kolo kontroly — 18 nálezů

Znovu pět pohledů nad opravami z 2. kola, každý nález nezávisle
ověřený: **15 potvrzených, 3 „možné“**. Opravené v `bebb657`,
`ad1b383` a `6decd9c` (test hranice seznamu míst, návod), nic nečeká —
jen nález 11 (čísla v hlášení) se opravil až ve 4. kole, viz tabulka.

| # | Nález | Co s ním |
|---|---|---|
| 1, 13 | Seznam stolů, který začal pozdě v dílu úlohy, dál zdržel další připojení: zápis stránky na něj čeká, a tím i další dotaz. Test to nechytil, protože v něm měla stoly každá stránka | Seznam stolů začne jen tehdy, když se **celý** (dva časové limity, 12 s) vejde do dílu připojení. Poslední připojení smí vždy. Nový test: pozdní seznam stolů a stránky bez stolů |
| 2, 14 | Chyba zápisu přebila „limit“ a „pristup“: po odmítnutí kvůli limitu by se úloha ptala Choice dál, po neplatném přihlášení by se napojení neoznačilo k opravě | „limit“ a „pristup“ zůstanou, chyba zápisu jde do hlášky vedle nich. Testy pro každou kombinaci |
| 3, 15 | Výjimka z fronty dotazů, zatímco se načítal seznam stolů: zápisy stránek běžely dál, i když byl běh ohlášený jako spadlý a zámek uvolněný | Výjimka počká na rozběhnutý zápis a další stránky se už nezapíšou. Testy včetně „výjimka se nesmí ztratit“ |
| 4, 9, 10 | Rezervace se stoly, jejichž jména se nepovedlo zjistit, neukázala v kalendáři žádné místo (na `main` ukazovala aspoň přání hosta) | Přání hosta se doplňuje do „Stůl / prostor“ hned, i u rezervace se stoly. Kalendář ho ukáže, když se stoly nenačetly nebo když jsou jen stoly mimo seznam míst („2 stoly bez názvu“); stoly bez jména ve známé části podniku ukážou aspoň tu část („Patro: 2 stoly bez názvu“) |
| 5 | Odebrání stolů v Choice u rezervace, ze které obsluha udělala akci, by poslalo upozornění „změnil se prostor“ | Díky doplnění hned (bod 4) se prostor při odebrání stolů už nemění. Scénář `krok109`: přesazení, odebrání stolů i změna přání → 0 upozornění. A kontrola naproti: když prostor změní obsluha, upozornění přijde |
| 6, 7, 8 | „Stůl / prostor“ se schovával podle shody textu s přáním hosta: když si host přání změnil, staré se vrátilo vedle stolů; když obsluha napsala totéž co host, schovalo se a označilo jako přání | **Nový sloupec `prostor_ze_zdroje`**: kdo text napsal. Import ho nastaví, spoušť v databázi ho shodí, kdykoli „Stůl / prostor“ změní kdokoli jiný. Kalendář i detail rozhodují podle něj |
| 11 | Čísla v hlášení zastaralá, „Kde jsem skončil“ nevyplněné | **Napoprvé neopraveno**, i když tu stálo „opraveno“: `krok109` měl uvedených 61 kontrol, ve skutečnosti jich bylo 45, a „Kde jsem skončil“ zůstalo prázdné. Našlo to 4. kolo (nálezy 13 a 16), opravené až teď |
| 12 | Jazyk „en-GB“, „zh-Hant-TW“ nebo třípísmenný kód se tiše zahodil, i když návod slibuje „kód XX“ | Jazyk se čte podle normy BCP 47; „ces“ a „cze“ se berou jako čeština |
| 16 | Podmínka v detailu „(přání hosta v …)“ nebyla testovaná | Test detailu pro všechny kombinace (viz „Na co jsem narazil“) |
| 17 | „Chyba zápisu zastaví běh“ se testovala jen bez seznamu stolů; vynulování příznaku „seznam se načítá“ netestované | Test se seznamem stolů, který doběhl, i se zápisem po něm |
| 18 | Okraje zkracování stolů (místo pro „ …“, „N stolů bez názvu“ na konci) netestované | Testy na přesné hranici |

## Čtvrté kolo kontroly — 19 nálezů

Pět pohledů nad opravami z 3. kola, každý nález nezávisle ověřený:
**18 potvrzených, 1 „možný“** (18). Několik pohledů našlo totéž, různých
věcí je 13. Všechno je opravené v `5107c3a`; bod 18 je pořadí nasazení.

| # | Nález | Co s ním |
|---|---|---|
| 1 | Připojení, které v úloze dočítá zbytek času, bral kód jako poslední a pustil mu seznam stolů kdykoli. Úloha za ním ale další připojení pustí, když tohle skončí brzy — pozdní seznam stolů by ho připravil o celý běh | Úloha teď kódu řekne, které připojení je opravdu poslední. Ostatní smí seznam stolů začít, jen když se i se zápisem po něm (3 s) vejde před hranici, za kterou by další připojení už nezačalo — nebo když už je za ní. Testy na hranici ±1 ms |
| 2 | Se dvěma pobočkami jde první v úloze vždy první a seznam stolů se jí do jejího dílu u stránek „nové“ a „okno“ nevešel nikdy: stoly rezervací dál než 48 h by nedostala, a nic by to nehlásilo | Napojení, u kterého běh stoly jednou viděl, si to zapamatuje (`ma_stoly`). Další běhy pak seznam stolů načtou **hned na začátku**, souběžně s prvním dotazem — do dílu se vejde |
| 3 | Chyba zápisu, která přišla, zatímco dotaz čekal na frontu, ho už nezastavila | Po čekání se chyba zápisu kontroluje znovu |
| 4, 11, 19 | Ranní souhrn ukazoval u akce holý „Stůl / prostor“, tedy staré přání hosta, i když kalendář ukazuje stoly z Choice | Souhrn nese stoly, přání i příznak a místo skládá **stejná funkce jako kalendář** (nový soubor `lib/rezervace-misto.ts`). Souhrn ze staré databáze ukáže prostor jako dřív |
| 5, 10 | Import u akce doplnil prázdný „Stůl / prostor“ přáním hosta (když host přání přidal později, nebo obsluha prostor smazala) a poslal upozornění „změnil se prostor“ | U akce import prostor nedoplňuje vůbec. U rezervací dál ano (kontrola naproti v `krok109`) |
| 6 | Kontrola „0 upozornění“ v `krok109` nemohla spadnout: první den po připojení import upozornění neposílá vůbec, a připojení v testu bylo nové | Připojení v testu je „staré“ (3 dny) a kontrola naproti dokládá, že import upozornění opravdu posílá (změna počtu osob → „změněná akce: osob“) |
| 7, 9, 17 | Rezervace načtené před `db push` by měly příznak „kdo napsal prostor“ prázdný napořád — po změně přání v Choice by se u nich vrátila chyba ze 3. kola | Příznak se doplní při nejbližším načtení, když je prostor stejný jako přání ze zdroje — i když se jinak nic nezměnilo |
| 8 | Žádná kontrola neprošla doplněním prostoru u ZMĚNĚNÉHO řádku, kde přání a prostor ze zdroje nejsou stejné | Nová kontrola (prostor „Salonek“, přání „Patro“ → „napsala obsluha“, ne „Choice“) |
| 12 | Host v Choice přání smazal — kalendář dál ukazoval to staré, doplněné kdysi | Neukáže se nic, se stoly jen stoly |
| 13, 16 | Hlášení: čísla zastaralá a „Kde jsem skončil“ prázdné, i když 3. kolo tvrdilo opak | Opraveno tady; čísla v oddílu „Čísla“ jsou dnes z posledního běhu (po 7. kole, viz tam) |
| 14 | Žádná kontrola nehlídala, že staré řádky dostanou příznak prázdný (výchozí hodnota se smí nastavit až po přidání sloupce) | Kontrola v katalogu databáze |
| 15 | Test „výjimka počká na zápis“ nikdy neměl zápis rozběhnutý ve chvíli výjimky | Nový test, kde výjimka přijde během zápisu stránky |
| 18 | Kdyby `db push` proběhl dřív, než na Vercelu poběží nový kód, starý kód by u doplněného prostoru zapsal „napsala obsluha“ napořád | **Pořadí nasazení:** `db push` až po „Ready“ na Vercelu. Napsané v hlavičce migrace, tady nahoře i v PR |

## Páté kolo kontroly — 12 nálezů

Čtyři pohledy (databáze, čas a souběh, zobrazení, testy) nad opravami
ze 4. kola, každý nález nezávisle ověřený: **9 potvrzených, 3 „možné“**.
Čtyři nálezy byly totéž (zastaralý návod), různých věcí je 9. Opravené
v `d8af065` a `1c72c51`, route už v `c639777`.

| Nález | Co s ním |
|---|---|
| Akce, u které host v Choice smazal přání a nemá stoly, neukazovala v kalendáři ani v ranním souhrnu žádné místo — i když ho ve formuláři má. Na `main` ho souhrn ukazoval (možný) | U akce se v tom případě ukáže „Stůl / prostor“ z formuláře. U rezervace dál nic (tam je to staré přání). Kalendář, den i souhrn jdou přes stejnou funkci |
| Výjimka „u akce se prázdný prostor nedoplní“ platila pro všechny zdroje. Příjmové API posílá v prostoru skutečný stůl — u akce bez prostoru by se nikam neuložil | Výjimka platí jen pro zdroj, který posílá přání hosta (Choice). Příjmové API i starý kód doplní jako na `main`, a upozornění „změnil se prostor“ jde jako dřív. Nová kontrola v `krok109` (akce, stůl „Stůl 9“) |
| Seznam stolů načtený hned na začátku úlohy (oprava 4. kola) se ptal dřív, než byl znám konec dílu připojení — a to stačilo na „smí“. Pravidlo, které chrání druhou pobočku, tak obešel (možný, úzký spouštěč) | Před prvním dotazem se konec dílu odhadne, jako by první dotaz odcházel hned (skutečný konec je stejný nebo pozdější), a platí stejná pravidla. Když se nevejde, zkusí to první stránka se stoly. Test na hranici ±1 ms |
| `krok109` nehlídal hranice doplnění „napsal Choice“ u starých řádků: příznak „obsluha“ se nesmí přepsat; starý řádek s prázdným prostorem a prázdným přáním nesmí spadnout (databáze by odmítla celou dávku) | Dva nové řádky ve scénáři (`f6`, `f7`) a dvě nová rozbití, která na nich spadnou |
| Jednotková kontrola „poslední připojení smí i těsně před koncem“ nemohla spadnout: v tom čase smí i jiné připojení | Kontrola teď zkouší čas PŘED hranicí, kde jiné připojení nesmí |
| Test „úloha, poslední připojení“ připojení jako poslední vůbec neoznačoval — procházel jinou větví | Přejmenovaný podle toho, co opravdu hlídá; větev „poslední“ hlídají testy na hranici |
| Komentář u kontroly `f5` sliboval, že pozná rozbití, které by příznak nechalo — nepozná, příznak srazí spoušť sama | Komentář opravený, napsané, která kontrola to opravdu hlídá (`a2r`) |
| Žádný test nespouštěl, že úloha označí jen poslední připojení (možný) | Už v `c639777` — našla to schválná rozbití 4. kola |
| Návod a komentáře popisovaly pravidla ze 3. kola (4 nálezy) | Návod `docs/rezervace-choice.md`, hlavička migrace a komentáře v `lib/rezervace-choice.ts` přepsané podle kódu |

## Šesté kolo kontroly — 10 nálezů

Tři pohledy (čas a souběh, databáze, zobrazení) nad opravami z 5. kola,
každý nález nezávisle ověřený — většinou schválným rozbitím nebo
skutečným během v oddělené kopii: **8 potvrzených, 1 „možný“,
1 vyvrácený**. Všech 9 platných je opravených v `ddcfecf`.

| Nález | Co s ním |
|---|---|
| **Zámek po odmítnutí** (regrese proti 4. kolu): když se seznam stolů na začátku nevešel a první stránka se stoly přišla ještě před hranicí, kdy smí, seznam se zamkl na celý běh. Prostřední pobočka v úloze by tak nové stoly nedostala, i když by je pozdější stránka smět načíst. Ověřené skutečným během | Odmítnutí nic nezamyká — ani na začátku, ani u stránky. Zkusí to každá další stránka se stoly; když se seznam načte později, stav je „ok“. Nové testy: odmítnutí u 1. a 2. stránky a načtení u 3.; úloha, kde 1. stránka před hranicí nesmí a 2. za ní smí |
| Testy by nespadly, kdyby odhad konce dílu před prvním dotazem zapomněl, že díl dočítá úlohu | Jednotková kontrola přesně na tom případě (díl končí méně než nejmenší díl před koncem úlohy) |
| Odhad konce dílu je bezpečný jen díky nerovnosti, kterou nikde nic nehlídalo: díl ≥ nejmenší díl (16,5 s) ≥ seznam stolů (12 s) + zápis po něm (3 s). S dnešními čísly platí, ale změna jedné konstanty by ji tiše rozbila | Nerovnost je popsaná u pravidla a hlídá ji test nad skutečnými konstantami kódu: mřížka časů i krajní body ±1 ms a přímo nerovnost samotná |
| Komentář v testu tvrdil „když se hned nevejde, nevejde se ani u stránky“ — neplatí | Opravený; platí opak (proto ten zámek byl chyba) |
| Akce se stoly jen „bez názvu“, u které host smazal přání: kalendář ukázal jen „2 stoly bez názvu“, prostor z formuláře se ztratil | Vedle stolů bez názvu se u akce ukáže „Stůl / prostor“ z formuláře, stejně jako bez stolů. Kontrola pro akci i pro rezervaci |
| Náhradní prostor akce se testoval jen přímým voláním funkce, ne ve vykresleném kalendáři; a nic nehlídalo, že kalendář předává druh rezervace | Akce i rezervace bez přání ve vykresleném týdnu i dni. Rozbití „kalendář nepředá druh“ teď spadne |
| Komentáře v `lib/rezervace-misto.ts` (možný): popis druhu „akce“ nesedel po opravě 5. kola | Přepsané podle kódu |
| `krok109` nehlídal, že výjimku u akce rozhoduje klíč přání hosta, ne klíč stolů — obě akce z Choice v testu posílaly oba klíče | Nový řádek `a2c`: akce z Choice s přáním, ale **bez** klíče stolů. Rozbití „rozhoduje klíč stolů“ na něm spadne |
| Komentář z 5. kola tvrdil, že jedno rozbití hlídá až `a2r` — ve skutečnosti ho dřív shodí `p1` | Hlavička scénáře a komentář u `f5` opravené |
| *Vyvrácený:* akce, jejíž „Stůl / prostor“ doplnil Choice ještě jako rezervaci: má-li host jiné přání, ukáže se aktuální přání; když ho smaže, ukáže se zase to staré z formuláře | Záměr z 5. kola, popsaný a testovaný: aktuální přání má přednost, prostor z formuláře je jen náhrada. Co napsala obsluha, se ukáže vždycky. Nic se neměnilo |

## Sedmé kolo kontroly — 7 nálezů

Tři pohledy (čas a souběh, zobrazení a databáze, testy) jen nad
opravami 6. kola. Pohled „zobrazení a databáze“ nenašel nic. Osm
hlášení, z toho jeden nález našly dva pohledy — různých je 7. Ověřené
skutečným během nebo rozbitím v oddělené kopii: **4 potvrzené,
1 vyvrácený**. Dva drobné (komentáře u testů) zůstaly kvůli stropu na
počet ověřovatelů bez nezávislého ověření — ověřil jsem je sám
(výpočtem a novou kontrolou se schváleným rozbitím) a platí. Opravené
v `1393b12`.

| Nález | Co s ním |
|---|---|
| **Planá hláška po načtení seznamu u pozdější stránky** (2 pohledy): počet „bez stolů“ si pamatoval i rezervaci, která stoly dostala na pozdější stránce téhož běhu (blízko, nové a okno se překrývají). U podniku s víc než 20 částmi pak napojení hlásilo „Stoly z Choice se nenačetly celé … Pošlete prosím tu hlášku vývojáři“. A rezervace, kterým jen došel čas, svádělo na víc než 20 částí. Můj test z 6. kola ten chybný počet čekal jako správný | Počítá se **poslední zápis** — rezervace, která stoly dostane později, z počtu zmizí; totéž u „stůl mimo seznam míst“. Hláška o necelém seznamu počítá jen rezervace, kterým stůl v necelém seznamu chyběl (nové pole `chybiVSeznamu`); došlý čas dál chyba není. Opravený test a dva nové: 21 částí podniku s odmítnutou 1. stránkou (rezervace ve všech průchodech / jen na odmítnuté stránce / se stolem v nenačtené části → „u 1 rezervace“), a neznámý stůl jen v dřívějším zápisu |
| Návod: „připojení, které není poslední, stoly pozdě v dílu nenačte“ — po 6. kole neplatí | Věta přepsaná podle kódu: bez stolů zůstane jen stránka, u které se seznam nevejde, a pozdější stránka téhož běhu to může opravit |
| Hlavička `lib/rezervace-choice.ts` a návod: „seznam se načte u první stránky se stoly“ — neplatí, a ve výčtu pravidel chybělo „nebo už je za hranicí“ | Opravené: u první stránky se stoly, u které se smí; odmítnutí nic nezamyká |
| Test vlastnosti z 6. kola běžel mimo obal kontroly: výjimka (třeba přejmenovaná funkce) by ukončila celý testovací soubor a schovala 13 kontrol za ním — ověřené rozbitím | Celé hledání je uvnitř kontroly; výjimka shodí jen ji. Název je pevný, konstanty jdou až do naměřeného |
| Komentář a název kontroly „„cas“ se z pokusu na začátku nehlásí“ — od 6. kola se „cas“ nastavilo i u pokusu na začátku, kontrola to nepoznala (stav pak přepsalo „ok“) | „cas“ nastaví jen stránka se stoly; pokus na začátku stav nemění. Nová kontrola: pokus na začátku odmítnutý, rezervace bez stolů → „nezkouseno“ |
| Komentář u testu vlastnosti tvrdil, že mřížka po 500 ms nejhorší chvíli mine — s dnešními konstantami ji trefí (neověřený nález, ověřil jsem ho výpočtem) | Komentář opravený: krajní body jsou tam pro případ, že se nejmenší díl nebo konec úlohy změní na číslo mimo mřížku. Oprava i ve „Na co jsem narazil“ níž |
| *Vyvrácený:* konstanty v názvu kontroly by ji při rozbití přejmenovaly a skript s rozbitími by ji nenašel | Skript hledá jen pevný začátek názvu, rozbití skončila „zásahem“. Název je teď stejně pevný (viz výš) |

## Čísla — a z čeho jsou

Všechno níž je z běhu nad `1393b12` (6. 11.), každý soubor zvlášť,
počítané řádky „OK“ ve výstupu. Konečná `aca1ddf` mění jen testovací
soubor Choice, ten jsem pustil znovu:

- `scripts/rezervace-choice.test.mjs`: **497 kontrol**, všechny OK
  (na `main` 296).
- `scripts/rezervace-pobocky.test.mjs`: **142**,
  `scripts/rezervace.test.mjs`: **384**, `scripts/upozorneni.test.mjs`:
  **206**, všechny OK.
- Scénář `krok109` v PGlite: **60 kontrol**, všechny OK.
- **Celý řetěz databázových scénářů** v PGlite: **4536 kontrol** prošlo,
  spadl jen `krok101` — ten padá v PGlite i na `main` (známá věc
  s uvozovkami v `\set`, s touto prací nesouvisí). **PGlite neověří RLS
  ani sloupcové granty** (běží jako superuživatel) — rozhoduje workflow
  Databáze na GitHubu.
- Celý seznam testů z CI (`aplikace.yml`, každý zvlášť, seznam čtený
  přímo ze souboru): **101 ze 101** prošlo.
- `tsc --noEmit` (celý projekt) a `eslint` nad změněnými soubory: bez
  chyb.
- Souběh (oddíl 6a, virtuální čas, týž běh): vedle dvou běžících
  načítání jiných firem načetlo „Načíst teď“ celé v **85 ze 176**
  okamžiků — stejně jako na `main` bez stolů (85 ze 176). Načítání
  stolů tedy nic neubralo. Zbytek dočte úloha. (Dřív tu stálo 89 —
  číslo ze staršího běhu, které jsem po dalších kolech nepřepočítal.
  Všechny běhy z posledních kol dávají 85.)

**Starší běh, ne nad konečnou verzí:** prohlížeč (headless Chrome nad
zkušební stránkou se smyšlenými daty) po 1. kole — 40 kontrol řádku
stolů v týdnu (pod myší, title, klik) prošlo dvakrát za sebou. Napoprvé
jeden klik „neotevřel“ rezervaci, protože vývojový server stránku
detailu teprve poprvé sestavoval déle než 10 s. Po prodloužení čekání
na 60 s prošlo všechno, i ten klik. Co z pozdějších kol jsem
v prohlížeči neviděl, je vypsané v oddílu „Na co jsem narazil“
(Obrazovky).

## Schválná rozbití

Skript v pracovní složce rozbije jedno místo, pustí test, vrátí soubor
a ověří proti gitu, že je vrácený. Každé rozbití musí shodit
**jmenovanou** kontrolu, ne jen „něco spadlo“. Po každém kole kontroly
přibyla rozbití na jeho opravy — dnes jich je **200**.

- **Celé přejetí nad `4de1a64`** (stav po 5. kole, 6. 11., 4 h 17 min):
  **184 rozbití** z 1.–5. kola a z původního kódu, **180 spadlo na své
  kontrole**. Zbylá čtyři spadla taky, jen jinde, než skript čekal:
  - Tři měla ve skriptu zastaralé jméno kontroly. Kontrolu dílu, který
    dočítá úlohu, jsem v 5. kole přejmenoval. U dvou databázových
    rozbití teď dřív spadne novější kontrola ve scénáři `krok109`
    (scénář končí první chybou). Opravil jsem očekávání, rozbití to
    nebylo.
  - Jedno („chyba zápisu nezastaví další dotaz“) spadlo jen díky druhé
    pojistce. Pojistka je dvakrát: před čekáním na frontu dotazů a po
    něm. Bez té první se dotaz sice neposlal, ale úloha by zbytečně
    čekala na frontu a brala tak 5,5 s jiné pobočce. To žádná kontrola
    nehlídala. Nová kontrola počítá i čekání na frontu (`aca1ddf`).
  - Všechna čtyři s opraveným očekáváním znovu nad konečnou verzí:
    **4 ze 4 spadla na své kontrole**.
- **6. kolo: 17 rozbití** nad jeho opravami (10 nových a 7 starších na
  místa, kterých se oprava dotkla) — **17 ze 17** na své kontrole.
- **7. kolo: 11 rozbití** (6 nových, 5 starších) — **11 ze 11**. Navíc
  ruční rozbití testu vlastnosti (skrytá funkce odhadu): spadla
  jmenovaná kontrola a doběhlo všech 495 dalších.
- **Celé přejetí všech 200 nad konečnou verzí** (`aca1ddf`, 6. 11.
  22:25 – 7. 11. 12:22; počítač v noci spal, proto tak dlouho):
  **200 ze 200 spadlo na své kontrole**, žádné nespadlo jinde, žádné
  neprošlo. Po každém rozbití skript ověřil proti gitu, že je soubor
  vrácený; pracovní kopie na konci čistá.

**1. kolo podrobně — 53 rozbití:**

- **32 míří na opravy z kontroly kódu** (31 v kódu, 1 v databázi),
  **21 na původní kód větve** (14 v kódu, 7 v databázi).
- **Napoprvé 50 z 53 spadlo na své kontrole.** Zbylé tři:
  - *Seznam míst hlídaný jen podle posledního dotazu běhu, ne podle
    konce dílu úlohy* — **nespadlo nic**. Byla to skutečná díra
    v testech: konec dílu (čas jednoho připojení v úloze) nehlídala
    žádná kontrola. Doplnil jsem ji (`777cc99`, díl 100 ms → seznam míst
    už nesmí, 300 ms → ještě smí). Teď rozbití spadne na ní.
  - *Seznam míst i bez rezervací se stoly* — test spadl **výjimkou**
    hned v oddílu 2, protože staré testovací běhy nedávaly funkci
    `smiMimoFrontu`, kterou kód vyžaduje. Chyba se tedy projevila, ale
    výjimka schovala všechny kontroly za ní. Staré běhy ji teď dostávají
    (`777cc99`) a rozbití spadne na své kontrole.
  - *Číslo rezervace přepsané i bez klíče* (databáze) — spadla kontrola
    „klíč chybí a změnil se počet osob“, která hlídá i číslo. Ve skriptu
    jsem čekal jinou (pozdější) kontrolu, scénář ale končí první chybou.
    Opravil jsem očekávání, rozbití to nebylo.
- **Po opravě spadla všechna tři na své kontrole.**
- Dva způsoby u stejného místa, kde jeden nestačí: rozsah (bez jména /
  bez čísla o jedna / bez stejných písmen), seznam míst (přes frontu /
  bez hlídání času / tvrdý konec / bez dílu), zkracování (bez náhrady
  půlek / rozpůlení emoji / obyčejný `slice` na třech místech) a
  „Stůl / prostor“ (kus textu / jen celé / jen oblast). Každé z nich
  shodí jinou kontrolu.

## Co čeká na Šéfíka

1. ~~„sluč 176 a db push“~~ — hotovo 7. 11.
2. **Choice znovu rozběhnout** (3. 11. v 19:41 jednou odmítl přístup,
   403, a Foodtab se ho od té doby neptá): u Bernard Baru i Černé Perly
   v Rezervace → Napojení **„Ověřit znovu“**. Projde-li, napojení je
   zase „připojeno“ a jde „Načíst teď“ (proč Choice 3. 11. odmítl, se
   tím ale nedozvíme). Neprojde-li u jednoho podniku, připojit ho znovu
   (odkaz z administrace Choice + ChoiceQR token právě toho podniku, jako
   26.–27. 10.). Neprojde-li u obou, je spíš chyba u aplikace Foodtab
   v Choice — napřed napsat na api@choiceqr.com (koncept připravím)
   a připojovat až po jejich odpovědi.
3. Až Choice zase načítá, podívat se na rezervaci se stoly s termínem
   od dneška (např. #105, je-li ještě před námi): ukáže „Patro: S1–S12“? Kdyby u ní bylo „stoly bez názvu“, je
   špatně předpoklad o id stolů (viz výš) a stačí mi poslat hlášku
   u napojení.
4. Otázky **87** (upozornění při přesazení u akce) a **88** (délka
   návštěvy).

## Otázky

V `docs/hlaseni/otazky.md`:

- **87** — přesazení v Choice u akce: dnes bez upozornění.
- **88** — délka návštěvy: až Choice zase načítá (po „Ověřit znovu“),
  přečtu uložené ukázky a porovnám s Choice. Zatím se žádná neuložila.

## Na co jsem narazil a nešlo to

- **Id stolů jsem neověřil proti živému Choice.** K údajům z Choice se
  nedostanu jinak než přes token, který leží zašifrovaný na serveru,
  a ten nečtu. Ověří to první načtení novým kódem — po nasazení 7. 11.
  zatím neproběhlo, čeká na „Ověřit znovu“ u Choice. Pozná se to podle
  hlášky.
- **Délku návštěvy nepřevádím.** Dokumentace neříká jednotku a špatný
  konec rezervace by nikdo nepoznal. Proto ukázky a otázka 88.
- **Moje první verze brala seznamu míst místo ve frontě.** Testy to
  nechytily, protože rezervace v testech souběhu neměly stoly, takže se
  seznam míst nikdy nenačetl. Kontrola kódu to našla. Oprava: seznam
  míst mimo frontu a testy souběhu se stoly. Poučení: test musí
  projít tou cestou, kterou hlídá.
- **Jedna výjimka schovala 16 kontrol** (jeden `try` kolem celého
  bloku). Rozbití by pak hlásilo „nic nespadlo“, i když spadlo všechno.
  Opraveno, každá riziková kontrola má vlastní obal.
- **Podmínka „stoly jsou v seřazeném seznamu hned vedle sebe“
  u rozsahu se skoro nedá rozbít.** Číslo o jedna a stejné jméno už
  sousedství skoro zaručí. Bez ní by rozsah přeskočil jen stůl se
  stejným jménem uvedený v Choice dvakrát. Podmínku jsem nechal jako pojistku, ale kontrola,
  která by ji hlídala, by byla zelená vždycky. Proto ji nevydávám za
  ověřenou.
- **Kompromis u seznamu stolů (3.–7. kolo):** připojení, které v úloze
  není poslední, začne seznam stolů jen tehdy, když se vejde do jeho
  času (dva časové limity, 12 s; u dílu, který dočítá úlohu, i 3 s na
  zápis před hranicí dalšího připojení), nebo když už je za tou
  hranicí. Stránka, u které se nevejde, se zapíše bez nových stolů — její
  rezervace mají stoly z minula, dokud je nedostanou na pozdější
  stránce téhož běhu nebo v příštím běhu (odmítnutí nic nezamyká,
  6. kolo). Zdržet druhou pobočku je horší než o chvíli později stoly. Že by
  se to první pobočce nevešlo **nikdy**, jsem ve 3. kole přehlédl —
  proto teď napojení se stoly načítá seznam hned na začátku.
- **Starý kód a nová databáze se nesnesou** (4. kolo, nález 18).
  Zajistit to kódem by znamenalo, aby databáze poznala, který kód ji
  volá — to jsem nedělal. Pojistka je pořadí nasazení, a to hlídá
  člověk: proto je napsané nahoře, v hlavičce migrace i v PR.
- **Moje „Stůl / prostor“ z 2. kola bylo špatně v principu.** Hádal
  jsem, kdo text napsal, podle shody s přáním hosta. Jenže přání se
  v Choice mění a obsluha může napsat totéž co host. Kontrola kódu
  našla tři různé případy, kdy se to splete. Správně je to zapsat:
  nový sloupec, který nastaví import a databáze ho sama shodí, když
  prostor změní kdokoli jiný.
- **Kontrola, která nemohla spadnout:** první verze kontroly „databáze
  nepustí poznámku *napsal Choice* s prázdným prostorem“ zkoušela
  řádek, u kterého spoušť poznámku při změně prostoru sama shodila.
  Databáze tedy zápis pustila vždycky, i bez pravidla. Schválné
  rozbití (pravidlo pryč) to odhalilo. Kontrolu jsem přesunul na řádek,
  kde spoušť nezasáhne.
- **Podmínka `prani !== ''` v detailu se nedá rozbít:** zbytek
  podmínky už vyžaduje neprázdný prostor rovný přání. Kontrola nad ní
  by byla zelená vždycky, proto jsem rozbil jiné místo téže podmínky
  (nález 16) a podmínku nechal jen jako pojistku.
- **Rozbití ze starších kol zastarala:** po opravách 3. kola 18 vzorů
  ve skriptu rozbití přestalo sedět na kód (skript je hlásí jako
  „nepoužité“, nespadne nic). Přepsal jsem je na nový kód a dvě, které
  mířily na zrušené chování, vyřadil.
- **Rozbití 4. kola našla tři díry v mých vlastních testech**
  (`c639777`): (1) to, že úloha označí jen poslední připojení, nehlídal
  žádný test — route se v testech volala, ale žádný scénář se k té
  větvi nedostal; (2) kontrola „po výjimce se další stránka nezapíše“
  neměla ve frontě žádnou další stránku, takže prošla i bez pojistky;
  (3) jedna výjimka v ranním souhrnu shodila celý testovací soubor.
- **Pojistka „po výjimce nic nezapisovat“ je dvakrát** (na začátku
  každého zápisu a po čekání na seznam stolů). Zápis, který začne až po
  výjimce, zastaví už ta první, takže rozbití jen jedné z nich shodí
  jinou kontrolu než rozbití obou. Rozbíjel jsem proto obojí zvlášť.
- **Scénář databáze končí první spadlou kontrolou.** Rozbití stejného
  místa (třeba „doplnit prázdný prostor“) shodí vždy tu kontrolu, která
  je ve scénáři dřív — na pozdější se nikdy nedostane. Pro pozdější
  kontroly jsem proto rozbíjel jen tu cestu, kterou hlídají. Jedna
  kontrola 4. kola (`a2r`) hlídá stejnou cestu jako starší kontrola
  ze 3. kola a rozbití, které by ji mělo shodit, spadne na té starší.
  Nechal jsem obě: hlídají totéž ze dvou stran.
- **5. kolo našlo, že dvě moje kontroly ze 4. kola nehlídaly, co
  tvrdily** (jednotková „poslední připojení“ a komentář u `f5`). Obě
  prošly i nad rozbitým kódem, protože v tom místě platí i jiné
  pravidlo. Poučení stejné jako dřív: kontrola musí stát tam, kde ji
  nic jiného nezachrání.
- **Moje oprava z 5. kola zavedla regresi** (6. kolo): seznam stolů na
  začátku úlohy jsem podřídil pravidlu dílu, ale nechal jsem zámek,
  který po prvním odmítnutí u stránky zakázal všechny další pokusy.
  Ten zámek dával smysl, dokud pravidlo s časem jen ubíralo. Od 4. kola
  ale díl, který dočítá úlohu, za hranicí smí zase — a zámek tu druhou
  šanci bral. Moje testy měly stoly buď na každé stránce, nebo odmítnutí
  jen jednou, takže to nechytily.
- **Celý řetěz scénářů našel, co samotný `krok109` nemohl:** migrace
  přidala do ranního souhrnu akce nový údaj a starší scénář `krok106`
  porovnával souhrn přesně, celý. Já jsem pouštěl jen `krok109`. Teď při
  změně výstupu databázové funkce hledám její jméno ve všech scénářích
  a pouštím celý řetěz.
- **Tvrdil jsem, že mřížka po 500 ms by v testu nerovnosti díru
  přehlédla — to neplatilo** (7. kolo). S dnešními konstantami leží
  kritický bod na násobku 500 ms a mřížka ho trefí sama; krajní body
  ±1 ms mají smysl jen pro případ, že se změní nejmenší díl nebo konec
  úlohy. Test navíc běžel mimo obal kontroly, takže výjimka by schovala
  13 kontrol za ním. Obojí opravené, rozbití spadla na té kontrole
  (delší limit seznamu, delší zápis a skrytá funkce odhadu — po té
  poslední doběhlo všech 495 dalších kontrol).
- **Oprava 6. kola otevřela cestu, se kterou počítadlo nepočítalo:**
  tatáž rezervace se v jednom běhu zapíše nejdřív bez stolů a pak se
  stoly. Můj test z 6. kola ten stav viděl a chybný počet („1 bez
  stolů“) zapsal jako správný. Poučení: když kontrolu píšu podle toho,
  co kód vrátil, musím se zeptat, jestli je to správně — ne jen, jestli
  je to stabilní.
- **Kontrola hlídala výsledek, ne cestu.** „Po chybě zápisu se už
  nepošle další dotaz“ platilo i s rozbitou první pojistkou, protože
  druhá (po čekání na frontu) dotaz zastavila. Jenže to čekání samo
  bere místo jiné pobočce. Ve 2. kole byla pojistka jen jedna
  a rozbití tehdy spadlo správně. Druhou (po čekání) přidala oprava
  4. kola a od té doby rozbití té první tiše zachraňovala. Poznal jsem
  to až z celého přejetí rozbití. Nová kontrola počítá i čekání na
  frontu. Poučení: po opravě, která přidá druhou pojistku, pustit
  znovu i starší rozbití téhož místa.
- **Nástroje:** `sed -i` mi převedl testovací soubor na jiné konce
  řádků (vráceno, diff ukazuje jen obsah). Nástroj na úpravy přepsal
  zápis náhradního znaku U+FFFD escapem na skutečný znak (opraveno
  skriptem, který escape skládá ze znaků). Zpětné uvozovky
  v příkazu Bash spustily příkazy uvnitř textu otázek (soubor jsem
  vrátil z gitu a text vložil ze souboru, nic jiného se nestalo).
- **Obrazovky:** týden (1440 px světlý, 1280 px tmavý, telefon), den
  (1280 px, telefon) a detail (1280 px, telefon) jsem viděl vykreslené na
  zkušební stránce se smyšlenými daty (jména, telefon i e-mail jsou
  vymyšlené). Po 3. kole znovu týden (1440 px), den (1280 px
  a telefon) a čtyři detaily: přání hosta doplněné z Choice, přání
  změněné v Choice („(doplněno z Choice)“ + vlastní řádek), „u okna“
  od obsluhy vedle přání a „Patro“ od obsluhy stejné jako přání (ukáže
  se jako text obsluhy). Kartu napojení Choice s novou hláškou „Stoly z Choice se
  nenačetly celé“ jsem vykreslenou **neviděl**. Text je ověřený jen
  testem. Živá data z Choice jsem neviděl vůbec. 4. kolo mění na
  obrazovce jen jedno: rezervace, u které host přání v Choice smazal,
  má řádek místa prázdný — ověřené testem, vykreslené jsem to
  **neviděl**. Ranní souhrn (text upozornění) je ověřený testem
  a scénářem `krok109`, jako upozornění jsem ho neviděl. 5. kolo mění
  na obrazovce jen akci bez stolů, u které host smazal přání (ukáže se
  „Stůl / prostor“ z formuláře) — ověřené testem, vykreslené jsem to
  **neviděl**. 6. kolo k tomu přidalo test nad vykresleným HTML týdne
  a dne (bez prohlížeče) pro akci a rezervaci bez přání a bez stolů;
  akci se stoly jen „bez názvu“ hlídá test funkce, která místo skládá.
  V prohlížeči jsem nic z 6. kola **neviděl**.

### Při nasazení 7. 11.

- **Rezervaci #105 jsem ověřit nemohl.** Choice 3. 11. odmítl
  přístup a od té doby se nenačítá (oddíl „Nasazení 7. 11.“), takže nový
  kód zatím nic nenačetl. Že stoly z Choice v provozu sedí, je pořád neověřené —
  ověřené je jen to, že databáze je připravená a kód nasazený.
- **Stav Vercelu jsem neviděl přímo**: nástroj Vercelu vrátil 403 (chybí
  přístup k týmu). „Ready“ jsem vzal ze stavu nasazení, který Vercel
  hlásí GitHubu (`success`, odkaz na nasazení), jako u #173.
- **Dokumentaci Choice k 403/429 se nepodařilo přečíst** (stránka bez
  obsahu bez prohlížeče, soubor se specifikací 403/404).
- **Že napojení čtyři dny stojí, jsem zjistil náhodou** — ověřovacím
  dotazem po `db push`. Upozornění nepřijde nikomu; kromě stránky
  napojení je štítek „Vyžaduje pozornost“ vidět jen v přehledu Financí
  (Stav integrací), kam se při práci s rezervacemi nikdo nedívá (návrh
  v „Kde jsem skončil“, bod 4).

## Kde jsem skončil a co zbývá

Práci na kódu jsem uzavřel před sloučením: sedm kol kontroly,
všechny platné nálezy opravené kromě čtyř z 1. kola, které čekají na
otázky 87 a 88; testy a rozbití výš. Hlášení a text PR na konci ještě
prošla kontrola proti kódu a commitům (tři nezávislé pohledy):
29 připomínek, po sloučení stejných 15 různých — zastaralé věty po
6. a 7. kole, špatný počet různých nálezů 4. kola (12 místo 13), věta
o stolech „bez názvu“, která neseděla na kód, a chybějící commit
v tabulce. Jedno zastaralé číslo jsem při tom našel sám (souběh 89,
dnes 85). Všechno opravené v textu; kód se neměnil. PR **#176**
je 7. 11. sloučená a nasazená (oddíl níž).

Celé přejetí všech 200 rozbití nad konečnou verzí doběhlo 7. 11.
ve 12:22: 200 ze 200 na své kontrole (oddíl „Schválná rozbití“).
Pracovní kopie jsou uklizené.

Zbývá:

1. **Šéfík: Choice znovu rozběhnout** — „Ověřit znovu“, případně
   znovu připojit nebo napsat Choice (oddíl „Co čeká na Šéfíka“, bod 2).
   Bez toho se nic z této PR v provozu neukáže.
2. **Až Choice načítá:** rezervace se stoly (např. #105) v kalendáři — ověří, že id
   stolů v rezervaci sedí na seznam míst Choice (jediný neověřený
   předpoklad). Pak přečtu uložené ukázky délky návštěvy (otázka 88).
3. **Otázky 87 a 88** čekají na odpověď. Dokud nepřijde, platí
   opatrnější varianta: přesazení bez upozornění, konec rezervace se
   nehádá.
4. **Návrh na samostatnou práci:** když napojení Choice spadne na
   „vyžaduje pozornost“, nikomu nic nepřijde — hláška je jen na stránce
   napojení (štítek i v přehledu Financí). Tentokrát to tak čtyři dny
   nikdo neviděl. A jediná 403 vypne načítání napořád, i kdyby Choice
   odmítl jen chvíli — stálo by za to po čase zkusit test sám. Upozornění
   majiteli (a správci napojení) by to chytilo hned.

## Nasazení 7. 11.

Na Šéfíkovo „sluč 176 a db push“, postup podle `nasazeni`:

1. **Před sloučením:** CI 5/5 zelená, PR „MERGEABLE / CLEAN“, `main`
   od otevření PR nepohnutý (`1a61131`). CLI napojené na
   `spekntcsuroqhehmjssv` / `foodtab-test`. `migration list` (pracovní
   složka nasazení byla ještě na starém `main`) i čtecí dotaz: databáze
   končí `20261106110000`, nic navíc v ní není. Že jediná čekající je
   `20261107100000`, ukázal až `db push`.
2. **Sloučeno** v 16:26 (`63bd158`, merge commit).
3. **Vercel produkce:** stav nasazení na GitHubu `success`
   v 16:27:54 (`/prihlaseni` vrací 200). Pak pět minut čekání na běhy
   starého kódu (jeden běh úlohy i tlačítka smí trvat nejvýš 60 s,
   plánovač mu dává 90 s — pět minut je s velkou rezervou).
4. **Výchozí stav (čtecí dotaz před `db push`):** 142 rezervací, žádný
   z nových sloupců, poslední migrace `20261106110000`.
5. **`db push`** v 16:33:25–16:33:35:

   ```
   Do you want to push these migrations to the remote database?
    • 20261107100000_rezervace_misto_zdroje.sql
   Applying migration 20261107100000_rezervace_misto_zdroje.sql...
   Finished supabase db push.
   ```

6. **Ověření čtecím dotazem** (všechno sedí s předpovědí):

   | Co | Výsledek |
   |---|---|
   | Migrace | `20261106110000, 20261107100000` |
   | Sloupce | `misto_zdroje`, `cislo_zdroje`, `prani_zdroje`: text, not null, výchozí `''`; `prostor_ze_zdroje`: boolean, smí být null, výchozí `false` |
   | Omezení | délky ≤ 300 / 40 / 120 a `prostor_ze_zdroje is not true or prostor <> ''` |
   | Spoušť | `trg_rezervace_prostor_od_obsluhy` BEFORE UPDATE, zapnutá, podmínka jako v migraci |
   | Funkce | `rezervace_zapsat_radky` a `rezervace_souhrn_dne`: definer, `search_path=""`, nové klíče v těle; žádná z nich ani funkce spouště nejde volat jako `anon`, `authenticated` ani `public` |
   | Práva na sloupce | nové sloupce stejně jako `prostor`: `authenticated` jen čte, `anon` nic |
   | Data | 142 rezervací, příznak u všech `null`, stoly / číslo / přání zatím u žádné (správně — žádné načtení ještě neproběhlo) |

7. **První načtení novým kódem neproběhlo — a zatím neproběhne.**
   Dotaz na napojení ukázal, že obě napojení Choice jsou od **3. 11.
   19:41** „vyžaduje pozornost“ s hláškou *„Choice odmítl přístup
   (403). Připojte podnik znovu“*. Historie běhů:
   - 3. 11. se u obou poboček načítalo každých 15 minut („hotovo“) až
     do 19:26, s výjimkou dvou běhů:
   - v 18:26 (Bernard) a 18:41 (Perla) Choice omezil počet dotazů
     (**429**); tři další běhy (18:56, 19:11, 19:26) zase prošly;
   - v běhu **19:41 vrátil Choice 403 u obou podniků naráz**. Kód
     odmítnutý přístup bere jako neplatný token: napojení přepne na
     „vyžaduje pozornost“ a úloha ho od té doby přeskakuje. Žádný další
     běh od té doby.
   - 3. 11. se do produkce nic nenasazovalo (sloučení 2. 11. 23:03,
     další až 4. 11. 14:42), takže to nezpůsobila změna v našem kódu.

   Proč Choice 403 vrátil, nevím. Dva různé tokeny ve stejné minutě
   spíš ukazují na něco společného (aplikace Foodtab v Choice), než že
   by oba tokeny přestaly platit samy (platí 5 let a každý vznikl
   jindy). Blokace po 429 sedí časově slabě — mezi poslední 429 a 403
   prošly tři běhy. Dokumentace Choice se automaticky přečíst nedala
   (stránka se vykresluje až v prohlížeči), význam 403 a 429 tedy
   neověřený.

   Choice odmítl **jednou** (jeden dotaz u každé pobočky); čtyřdenní
   výpadek je hlavně tím, že se ho náš kód po jediné 403 už nezeptal.
   „Ověřit znovu“ ukáže, jestli odmítá i dnes. Projde-li, stačilo to.
   Neprojde-li u obou, nové připojení jde přes tutéž aplikaci a může
   skončit stejně (a „Odpojit“ smaže uložený token) — napřed napsat
   Choice.
