# Stav k 3. 11. 2026 — Word v přílohách rezervací se otevře jako náhled

## Nejdřív to podstatné

- **Šéfík 2. 11.: „soubory teď nejdou otevřít“** — po kliknutí na
  dokument Word u rezervace se na počítači „nic nestalo“. Prohlížeč
  `.docx` ukázat neumí; odkaz soubor jen tiše poslal do Stažených.
- **Teď se Word otevře jako stránka ve Foodtabu** (Provoz → Rezervace
  a akce → detail → Dokumenty a přílohy → klik na Word): text, nadpisy,
  odrážky, tabulky i se sloučenými buňkami, zaškrtávací políčka. Nahoře je
  tlačítko **Stáhnout originál**, které soubor uloží, a pak se otevře ve
  Wordu. PDF a fotky se otevírají jako dřív, rovnou v prohlížeči.
- Dokument je **cizí soubor** (poslal ho host) a čte se na serveru.
  Proto má čtečka stropy na všechno, čím by se dal server zahltit, a ukáže
  z dokumentu jen text. Žádné HTML, odkazy ani skripty ze souboru.
- Kód prošel **pěti nezávislými kontrolami** (25 + 24 + 7 + 8 + 4 nálezy,
  opravené všechny kromě jednoho, níž). Po každé opravě jsem kód
  schválně rozbíjel, abych ověřil, že ho kontroly chytí.
- **Bez migrace.** Stačí „**sluč N**“, `db push` není potřeba.
  **Nic jsem nenasazoval ani neslučoval.**

## Co je hotové

| Co | Commit |
|---|---|
| Word jako náhled: čtečka `.docx` (`lib/docx-nahled.ts`), stránka `rezervace/dokument/[id]`, odkaz u přílohy | `7d1c692` |
| Kontroly, které schválné rozbití napoprvé neshodilo; odrážky (globální styl je schovával) | `30a6a11`, `a423382`, `c4ea6bf` |
| Opravy z 1. kontroly kódu, 25 nálezů | `14f27e4` |
| Pryč zdvojené pojistky, kontroly na místa bez nich; „Segoe UI Symbol“ | `8ce663b`, `efb74a4` |
| Opravy z 2. kontroly kódu, 24 nálezů | `7e92d8f`, `29acb8c`, `8ca9ce8` |
| Opravy z 3. kontroly kódu, 7 nálezů | `74eef1f`, `20b8889` |
| Opravy ze 4. kontroly kódu, 8 nálezů (4 v kódu, 4 v hlášení) | `bd19149`, `d912cfc` |
| Opravy z 5. kontroly kódu, 4 nálezy (2 v kódu, 2 v hlášení) | `006fd4c` |

## Co náhled umí a co ne

**Umí:**
- text, tučně, kurzíva, podtržení;
- nadpisy (podle jména stylu, i u českého Wordu), odrážky;
- tabulky, i v sobě, se **sloučenými buňkami** (vodorovně i svisle);
- textová pole;
- **zaškrtávací políčka** a rozbalovací seznamy formulářů (☒ / ☐);
- znaky z písem Wingdings a Symbol (☑, °, ±, …);
- výsledky polí (např. hromadná korespondence);
- sledování změn (ukáže se nové znění);
- iniciálu a tabulátor u ceny („Svíčková … 250 Kč“).

**Neukáže:**
- obrázky (místo nich značka „obrázek“ a věta, kolik jich v dokumentu je);
- vzorce (místo nich značka „vzorec“);
- záhlaví a zápatí, poznámky pod čarou, komentáře — po poznámce pod
  čarou a komentáři nezůstane v textu ani značka;
- barvy, písma, přesné rozvržení.

Věta nad náhledem vyjmenuje obrázky, záhlaví a zápatí, poznámky pod
čarou, komentáře a přesné rozvržení. Vzorce v ní nejsou (mají značku
přímo v textu), barvy a písma taky ne.

**Skrytý text** se neukáže, když je skrytý přímo u textu (ve Wordu
Písmo → Skryté). Text skrytý **stylem** náhled ukáže; Word ho skryje.
Je to vzácné a není to únik: originál si stáhne každý, kdo vidí
náhled.

Dokument, který čtečka nepozná (vložené HTML z „exportu do Wordu“,
soubor z jiného programu s nezvyklým zápisem), oznámí větou a nabídne
originál. Větu „V dokumentu není žádný text“ ukáže jen tehdy, když
v těle dokumentu text opravdu není (text jen v záhlaví nebo zápatí
náhled neukazuje).

Dlouhý dokument se ukáže zkrácený a nahoře stojí „Dokument je dlouhý,
náhled ukazuje jen začátek.“ Zkrátí ho kterýkoli strop: 300 000 znaků
textu, 10 000 bloků (odstavce, tabulky, řádky a buňky dohromady),
20 000 úseků s jiným formátem nebo 300 000 značek XML. Tabulky hlubší
než 8 pater se nezkracují a věta se k nim neukáže: jejich text je
v buňce o patro výš.

Řádek tabulky má v náhledu nanejvýš **63 buněk** (víc Word nedovolí)
a **255 sloupců mřížky**. Co je za tím, se ořízne, nahoře stojí
„Tabulka je moc široká — část vpravo v náhledu chybí.“ a text za
tabulkou zůstane.

## Čísla — a z čeho jsou

- `scripts/rezervace.test.mjs`: **353 kontrol**, všechny prošly (při #171
  jich bylo 163; oddíl 11 o náhledu Wordu je celý nový).
- `scripts/xlsx.test.mjs` (čtení sešitu; náhled Wordu z něj bere čtení
  XML): **38 kontrol**, všechny prošly, 2 nové (CDATA, komentář
  a instrukce s apostrofem).
- Celý seznam testů z CI (`.github/workflows/aplikace.yml`, 100 souborů,
  časové pásmo UTC jako na GitHubu): **prošlo 100 ze 100** (nad
  `006fd4c`). Žádný testovací soubor nezůstal mimo seznam.
- `tsc --noEmit` bez chyby, `eslint` bez nálezů na změněných souborech
  (nad `006fd4c`).
- **Schválná rozbití: 199, každé spadlo na té kontrole, na kterou
  mířilo** (191 nad `bd19149`, 2 k větě nad náhledem nad `d912cfc`,
  6 nových nad `006fd4c`; 3 starší k emoji jsem pustil znovu, protože
  se změnila funkce, na kterou míří). Každé rozbití vymění kus kódu,
  pustí test a ověří, že nespadl jen „nějaký“ test, ale ta jmenovaná
  kontrola. Po 3. kontrole jich přibylo 20, po 4. dalších 18 (buňky
  proti sloupcům mřížky, entita za stropem, emoji na stropu, komentáře
  a CDATA, věta nad náhledem), po 5. dalších 6 (půlka emoji na konci
  dekódování; CDATA, komentář a instrukce v sešitu — ty pouští test
  sešitu). Několik starých jsem přepsal na nový kód. Kde jde chybu
  udělat dvěma způsoby, rozbil jsem obojí. Například široká tabulka:
  jednou se nepočítají buňky, jednou se do buněk započte i odsazení.
- **1256 skutečných dokumentů Word** z tohoto počítače. Jen se četly na
  tomto stroji a nikam se nenahrávaly. Srovnával jsem čtečku před 4.
  kontrolou (`07c9737`) a po ní (`bd19149`; `d912cfc` čtečku nemění):
  - **1240 přečetly obě a u všech vyšlo totéž**: stejný text, stejný
    počet odstavců, tabulek, buněk, nadpisů a obrázků;
  - 15 obě stejně odmítly. 13 mají jen příponu `.docx`, ale Word to
    nejsou. 2 v sobě nemají text dokumentu. U všech náhled řekne, že
    soubor nezná, a nabídne originál;
  - 1 soubor mezitím z disku zmizel (při 2. kontrole jich bylo 1241);
  - žádná tabulka se neořízla, nejširší má 46 sloupců mřížky;
  - čas: všechny dokumenty dohromady 4,2 s staře a 4,4 s nově, oba
    v jednom běhu (po 3. kontrole vyšlo 6,8 a 7,1 s; mezi běhy se čas
    liší podle toho, co počítač zrovna dělá). Nejpomalejší dokument
    (3,5 MB) trval 43 ms;
  - po 5. kontrole znovu, `d912cfc` proti `006fd4c`: zase 1240 stejně,
    15 stejně odmítnutých, 1 chybí; 4,4 s obě, nejpomalejší dokument
    32 ms.
- **Paměť a čas při otevření** dokumentu plného entit (`&amp;`):
  - před opravou kolem 400 ms a +100 MB paměti serveru na každé
    otevření (měřeno 600–750 tisíc entit, 4 kB soubor),
  - teď 120–170 ms a +8 až 14 MB,
  - se stropem paměti 48 MB stará čtečka spadla na nedostatek paměti,
    nová doběhla.

  Měřil jsem ručně (`node --expose-gc`). V CI to nehlídá žádná kontrola,
  protože měření paměti v běžném testu by bylo nespolehlivé.
- Dokumenty z tohoto počítače jsou provozní (menu, objednávky). Na snímky
  obrazovky jsem použil jen **smyšlený** dokument.

## Opravy z kontrol kódu

Každou kontrolu dělalo víc nezávislých posuzovatelů. Každý nález ještě
jeden ověřovatel zkusil vyvrátit, a pokud to šlo, napsal pokus, který chybu
předvede na skutečném souboru.

### 1. kontrola: 25 nálezů (`14f27e4`)

**Čtečka:**
- sloučené buňky: „40“ stálo pod sloupcem „Program“ místo „Osob“;
- vložené HTML, jiná předpona a UTF-16 vyšly jako „žádný text“;
- mizela zaškrtávací políčka a znaky z Wingdings;
- formát z textového pole ztučnil text za ním;
- pole v poli ukázalo kus příkazu;
- ukazoval se skrytý text;
- styly se četly natvrdo z jednoho místa;
- grafy a obrázky jako výplň tvaru neměly značku;
- iniciála rozdělila slovo;
- tabulátor u ceny slepil slova;
- **40 kB soubor s milionem prázdných buněk zaměstnal server na
  desítky vteřin**;
- stovky tabulek v sobě shodily stránku.

**Stránka:**
- věta o obrázcích byla česky špatně;
- prázdný nadpis;
- dlouhý název roztahoval stránku na telefonu;
- **Word na iPhonu z plochy**: nová záložka by otevřela Safari bez
  přihlášení. Word se teď otevírá ve stejném okně.

**Testy:** kontrola ZIP bomby prošla i bez skutečného stropu, zkušební
ZIP nebyl jako z Wordu, chyběly kontroly na sledování změn.

### 2. kontrola: 24 nálezů (`7e92d8f`, `29acb8c`, `8ca9ce8`)

- **Megabajty entit (`&amp;`) zaměstnaly server na vteřiny.** Teď se
  dekóduje jen text, který se ukáže, a jen do stropu.
- Tabulka s neuzavřenými buňkami obešla strop 8 pater.
- Tisíce sloučených sloupců v řádku zamrazily prohlížeč na minuty. Teď má
  řádek strop (od 4. kontroly zvlášť na buňky a na sloupce mřížky, níž).
- Strop 20 000 úseků textu, protože střídání tučného písma po znaku
  dělalo statisíce prvků.
- Úroveň osnovy „1.5“ shodila stránku.
- Styly Title a Subtitle jsou nadpisy.
- Iniciála se lepila k textovému poli.
- Rozbalovací seznam formuláře se neukázal.
- Šipky a smajlíky z Wingdings chyběly.
- „Zkusit znovu“ na chybové obrazovce si stránku znovu vyžádá ze serveru.

### 3. kontrola: 7 nálezů (`74eef1f`, `20b8889`)

1. **Široká tabulka useknula zbytek dokumentu.** Řádek přes 63 sloupců
   (stačí 33 buněk s hranicemi posunutými proti sobě) zastavil čtení: vše
   za tabulkou zmizelo a nahoře stálo „dokument je dlouhý“. Byla to chyba
   z mé opravy ve 2. kontrole. Teď se tabulka jen ořízne a čte se dál.
   (Že se taková tabulka vůbec ořízla, byla další chyba. Opravená je
   ve 4. kontrole, bod 1.)
2. Vnitřní tabulka bez konce nebo zbloudilá značka buňky udělaly
   z čitelného souboru „Dokument je poškozený“ a náhled zmizel celý.
3. Vzorec z převodníku (ne z Wordu) ukázal za značkou „vzorec“ i čísla.
   Zlomek ½ vypadal jako „12“.
4. **Dokument plný entit stál 100 MB paměti na každé otevření.** Teď se
   dekóduje po kusech (čísla výš).
5. Kontroly entit nešly shodit: nesmyslná entita byla jen tam, kam se
   nikdy nedostala.
6. Pole formuláře se samostatnou zavírací značkou neměla žádnou kontrolu.
7. Vazba na adresu mimo soubor, uvedená před skutečným obsahem, schovala
   celý dokument („V souboru není text“). Byla to chyba z mé opravy ve
   2. kontrole.

Jeden nález ověřovatel vyvrátil: „záplava prázdných značek stojí
vteřinu“. Naměřil 0,2–0,3 s, strop na značky drží.

### 4. kontrola: 8 nálezů (`bd19149`, `d912cfc`)

Kontrolovala oba PR najednou (tenhle a dokumenty v kalendáři). Z 10
nálezů k tomuhle PR ověřovatelé 8 potvrdili a 2 vyvrátili.

**V kódu:**
1. **Rozpis směn přišel o sloupec „Celkem“.** Strop 63 počítal sloupce
   mřížky, ne buňky. Tabulka s 33 buňkami v řádku a hranicemi
   posunutými proti sobě má 65 sloupců mřížky, takže poslední buňka
   tiše zmizela. Věta nahoře přitom slibovala „prvních 63 sloupců“.
   Teď je strop zvlášť na buňky (63, jako Word) a zvlášť na sloupce
   mřížky (255; chrání proti pár buňkám přes tisíce sloupců). Věta zní
   „část vpravo v náhledu chybí“.
2. Entita s tisíci nul navíc (`&#x0000…41;`), jejíž konec je až za
   stropem, se ukázala jako 300 000 znaků „&#x0000…“. Teď se neukáže
   vůbec a náhled se zkrátí.
3. Strop na znaky mohl rozpůlit emoji. Na konci náhledu by bylo „�“.
4. **Komentář s apostrofem v souboru** (`<!-- guest's app -->`, píšou ho
   jiné programy než Word) spolkl zbytek dokumentu a náhled hlásil
   „V dokumentu není žádný text“. Stejně dopadl text v CDATA. Teď se
   komentář přeskočí a CDATA ukáže doslova. Při opravě jsem našel ještě
   jednu díru: 50 000 neuzavřených komentářů by čtečka prošla 50 000×
   (20 s práce serveru). Teď konec hledá jen jednou (8 ms).

**V hlášení:** skrytý text stylem se ukáže (výš opravené, v kódu ne,
viz „Na co jsem narazil“), stránka nevyjmenovávala poznámky pod čarou
a komentáře (teď je vyjmenuje), výčet stropů nesedel s kódem, odkaz na
hlášení ke kalendáři vedl na soubor, který ještě nebyl v repozitáři.

Vyvrácené: „PR na GitHubu ještě není“ (tehdy pravda, ale není to vada
hlášení) a „čísla o čase nejdou zopakovat“ (ověřovatel je přeměřil
a seděla).

### 5. kontrola: 4 nálezy (`006fd4c`)

Zase oba PR najednou. K tomuhle 4 nálezy, ověřovatelé potvrdili všechny.

**V kódu:**
1. **Emoji na konci náhledu se pořád mohlo rozpůlit**, jen jinou cestou
   než ve 4. kontrole. Dekódování entit má i strop na to, kolik znaků
   ze souboru přečte, a ten mohl skončit mezi půlkami emoji, i když
   textu bylo pod strop. Při opravě jsem našel ještě jednu cestu:
   hranice kusu (65 536 znaků) přesně ve chvíli, kdy text dosáhl
   stropu. Oprava je na jednom místě: konec textu se hlídá vždycky, ne
   jen při zkrácení.
2. **CDATA a komentáře v sešitu neměly test.** Oprava ze 4. kontroly
   (CDATA doslova, komentář s apostrofem nic nespolkne) je ve čtení XML,
   které sdílí náhled Wordu s nahráváním sešitů (lidé a rozpis z Excelu
   v Nastavení → Nahrání dat). Na sešit žádná kontrola nemířila. Teď dvě
   a čtyři rozbití.

**V hlášení:** věta o tom, co náhled neukáže, tvrdila, že stránka
vyjmenuje všechno — vzorce, barvy a písma ve větě nad náhledem nejsou.
A odkaz na hlášení ke kalendáři pořád vedl na soubor, který v téhle
větvi není (přibude s druhým PR, teď je to u odkazu napsané).

## Co čeká na Šéfíka

- **„sluč N“**, bez `db push`. Slučovat **jako první**, před PR
  s dokumenty v kalendáři (ten na tomhle staví).
- Po sloučení vyzkoušet na počítači: detail rezervace s Wordem → klik →
  má se otevřít náhled. Pak **Stáhnout originál** → soubor je ve
  Stažených.

## Otázky

- **iPhone z plochy** (Foodtab přidaný na plochu jako aplikace): PDF
  a fotky se dál otevírají v nové záložce. Tam se může otevřít Safari,
  které není přihlášené, a místo souboru ukáže „nenalezeno“. Takhle to
  bylo už od #171 a tahle práce to nezhoršila (Word se nově otevírá
  uvnitř). Ověřit to jde jen zkouškou na telefonu. Pokud se to potvrdí,
  oprava je otevírat i PDF a fotky ve stejném okně.

## Na co jsem narazil a nešlo to

- **Dvě chyby z 3. kontroly jsem udělal sám** v opravách 2. kontroly:
  1. Strop na šířku tabulky jsem napojil na stejný příznak jako „dokument
     je dlouhý“, a ten zastavuje čtení.
  2. Při úklidu „nadbytečných pojistek“ jsem vyhodil přeskočení vazby
     mimo soubor, protože jsem ho považoval za zdvojené. Nebylo.

  Obojí mělo projít kontrolou, kterou žádné rozbití neshodilo. Teď na
  každé z nich míří vlastní rozbití.
- **Ve 3. kontrole jsem širokou tabulku „opravil“ jen napůl.** Čtení se
  už nezastavilo, ale rozpis s 33 buňkami pořád přišel o poslední
  sloupec. Kontrola, kterou jsem k tomu napsal, to dokonce vynucovala:
  v komentáři stálo „i když buněk je pod 63“, a přesto chtěla 32 buněk.
  Napsal jsem ji podle toho, co kód dělal, ne podle toho, co má vidět
  člověk. Teď kontrola chce celý rozpis i se součtem vpravo.
- **Emoji na stropu jsem ve 4. kontrole opravil jen na jednom místě.**
  Hlídal jsem půlku znaku tam, kde se text zkracuje, ne tam, kde
  dekódování skončí. Dekódování ale končí na dvou stropech a po kusech;
  stačil jiný strop a půlka byla zpátky. Teď se hlídá konec výsledku,
  ať dekódování zastavilo cokoli.
- **Skrytý text stylem jsem v kódu neopravil.** Čtečka stylů by musela
  číst i vlastnosti písma a dědit je mezi styly. Je to víc kódu nad
  cizím souborem kvůli vzácnému případu, a nic se tím neodhalí: kdo
  vidí náhled, stáhne si i originál. Opravil jsem tvrzení v hlášení.
- **Paměť nehlídá žádná automatická kontrola.** Rozdíl je velký
  (100 MB proti 10 MB), ale měření paměti v běžném testu by na CI
  kolísalo. Hlídají to dvě kontroly na chování: kolik se dekóduje
  a kde kus končí. Samotné měření jsem dělal ručně.
- **Nevím jistě, jestli na Šéfíkově počítači stažení dřív doběhlo**
  (soubor mohl ležet ve Stažených, jen se nic neotevřelo). Logy Vercelu
  vrátily „403 — nemáte přístup“ a historii prohlížeče jsem nečetl
  (osobní údaje). Pro opravu to nevadí, náhled se ukáže tak jako tak.
- **Snímky obrazovky jsem udělal až po 3. kontrole**, nad hotovým kódem,
  se dvěma smyšlenými dokumenty (večírek s tabulkou, políčky a cenami;
  rozpis obsluhy se 70 sloupci). Na počítači (1280 px), na telefonu
  (390 px) i v tmavém režimu:
  - text, tabulka se sloučenými buňkami, zaškrtávací políčka i ceny
    sedí. Stránka nikde nejede do strany, široká tabulka se posouvá
    jen sama v sobě;
  - u široké tabulky stojí nahoře „Tabulka je moc široká — část vpravo
    v náhledu chybí.“ a text za tabulkou je vidět celý (snímek znovu po
    4. kontrole);
  - dlouhý název souboru se na telefonu zalomí a stránku neroztáhne;
  - chybová obrazovka má „Stáhnout originál“ i „Zkusit znovu“.
    „Zkusit znovu“ si stránku opravdu znovu vyžádá ze serveru, druhý
    pokus se načetl.

  Skutečné přihlášení a skutečný soubor z úložiště jsem neviděl, náhled
  běžel na zkušební stránce bez databáze.

## Kde jsem skončil a co zbývá

- Hotové, otestované, v PR. Zbývá jen sloučit.
- Dokumenty v kalendáři akcí (požadavek z 2. 11.) jsou v samostatném PR,
  který na tomhle staví. Jeho hlášení
  (`docs/hlaseni/stav-2026-11-03-kalendar-dokumenty.md`) je ve větvi
  `rezervace-kalendar-dokumenty`; v `main` bude, až se ten PR sloučí.
- Z #171 dál platí: na akce a rezervace nechodí upozornění nikomu, dokud
  v Rezervace → Upozornění u pobočky nikoho nevyberete.

## Nenasazoval jsem

Nic. PR čeká na „sluč N“. Bez migrace, `db push` není potřeba.
