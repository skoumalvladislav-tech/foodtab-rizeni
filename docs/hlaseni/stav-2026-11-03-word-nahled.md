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
- Kód prošel **třemi nezávislými kontrolami** (25 + 24 + 7 nálezů, všechny
  opravené). Po každé opravě jsem kód schválně rozbíjel, abych ověřil, že
  ho kontroly chytí.
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

**Neukáže** (stojí to i na stránce):
- obrázky (místo nich značka „obrázek“ a věta, kolik jich v dokumentu je);
- vzorce (místo nich značka „vzorec“);
- záhlaví a zápatí, poznámky pod čarou, komentáře;
- barvy, písma, přesné rozvržení.

**Skrytý text** se neukáže ani tady. Word ho neukáže ani nevytiskne
a v dokumentu může být interní poznámka, která hostovi nepatřila.

Dokument, který čtečka nepozná (vložené HTML z „exportu do Wordu“,
soubor z jiného programu s nezvyklým zápisem), oznámí větou a nabídne
originál. Nikdy netvrdí „v dokumentu není žádný text“ o dokumentu plném
textu.

Dlouhý dokument se ukáže zkrácený a nahoře stojí „Dokument je dlouhý,
náhled ukazuje jen začátek.“ Stropy jsou 300 000 znaků, 10 000 odstavců
a buněk a 8 pater tabulek. Tabulka širší než 63 sloupců se ořízne
(nová věta „Tabulka je moc široká…“) a text za ní zůstane.

## Čísla — a z čeho jsou

- `scripts/rezervace.test.mjs`: **341 kontrol**, všechny prošly (při #171
  jich bylo 163; oddíl 11 o náhledu Wordu je celý nový).
- Celý seznam testů z CI (`.github/workflows/aplikace.yml`, 100 souborů,
  časové pásmo UTC jako na GitHubu): **prošlo 100 ze 100** (nad
  `20b8889`). Žádný testovací soubor nezůstal mimo seznam.
- `tsc --noEmit` bez chyby, `eslint` bez nálezů na změněných souborech.
- **Schválná rozbití: 175, každé spadlo na té kontrole, na kterou
  mířilo** (nad `20b8889`). Každé rozbití vymění kus kódu, pustí test
  a ověří, že nespadl jen „nějaký“ test, ale ta jmenovaná kontrola.
  Po 3. kontrole jich přibylo 20 (široké tabulky, entity, vzorce, vazba
  mimo soubor, pole formuláře). Dvě staré nahradila přesnější
  a několik dalších jsem přepsal na nový kód. Kde jde chybu udělat dvěma způsoby, rozbil
  jsem obojí. Například oříznutá tabulka se jednou „zapomene“ a jednou
  zase zastaví čtení jako dřív.
- **1256 skutečných dokumentů Word** z tohoto počítače. Jen se četly na
  tomto stroji a nikam se nenahrávaly. Srovnával jsem čtečku před 3.
  kontrolou a po ní:
  - **1240 přečetly obě a u všech vyšlo totéž**: stejný text, stejný
    počet odstavců, tabulek, buněk, nadpisů a obrázků;
  - 15 obě stejně odmítly. 13 mají jen příponu `.docx`, ale Word to
    nejsou. 2 v sobě nemají text dokumentu. U všech náhled řekne, že
    soubor nezná, a nabídne originál;
  - 1 soubor mezitím z disku zmizel (při 2. kontrole jich bylo 1241);
  - žádná tabulka se neořízla, nejširší má 46 sloupců;
  - čas: všechny dokumenty dohromady 6,8 s staře a 7,1 s nově.
    Nejpomalejší dokument (3,5 MB) trval 116 ms.
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
- Tisíce sloučených sloupců v řádku zamrazily prohlížeč na minuty. Teď je
  strop 63 sloupců, víc ani Word nedovolí.
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
  - u široké tabulky stojí nahoře „Tabulka je moc široká — náhled
    ukazuje jen prvních 63 sloupců.“ a text za tabulkou je vidět celý;
  - dlouhý název souboru se na telefonu zalomí a stránku neroztáhne;
  - chybová obrazovka má „Stáhnout originál“ i „Zkusit znovu“.
    „Zkusit znovu“ si stránku opravdu znovu vyžádá ze serveru, druhý
    pokus se načetl.

  Skutečné přihlášení a skutečný soubor z úložiště jsem neviděl, náhled
  běžel na zkušební stránce bez databáze.

## Kde jsem skončil a co zbývá

- Hotové, otestované, v PR. Zbývá jen sloučit.
- Dokumenty v kalendáři akcí (požadavek z 2. 11.) jsou v samostatném PR,
  který na tomhle staví. Hlášení je v
  `docs/hlaseni/stav-2026-11-03-kalendar-dokumenty.md`.
- Z #171 dál platí: na akce a rezervace nechodí upozornění nikomu, dokud
  v Rezervace → Upozornění u pobočky nikoho nevyberete.

## Nenasazoval jsem

Nic. PR čeká na „sluč N“. Bez migrace, `db push` není potřeba.
