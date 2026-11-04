# Stav k 3. 11. 2026 — dokumenty u rezervací v kalendáři akcí

## Nejdřív to podstatné

- **Šéfík 2. 11.:** „potřebuji, aby v kalendáři akcí bylo vidět, že je
  u jednotlivé rezervace dokument, a možnost ho otevřít“.
- **Týden a den:** pod každou rezervací s dokumentem jsou štítky
  s názvem souboru (i s příponou `.pdf` / `.docx`). Klik otevře dokument:
  - PDF a fotka se otevřou v nové záložce,
  - Word jako náhled ve Foodtabu a tlačítko „Zpět na kalendář“ (nebo
    „Zpět na den“) vrátí přesně tam, odkud se otevíral.

  V týdnu jsou v kartě nejvýš dva štítky. Další dokumenty schová odkaz
  „+ 1 další dokument“, který vede rovnou na dokumenty v detailu
  rezervace.
- **Měsíc:** u rezervace s dokumentem je sponka (u víc dokumentů
  i počet). Celá buňka je odkaz na den, takže se dokument otevře až
  v dni. Sponka je i u „+ N další“, když dokument má některá ze
  schovaných rezervací.
- Dokumenty se načítají **stejným dotazem a stejným přihlášením** jako
  rezervace, takže je vidí jen ten, kdo vidí rezervaci (hlídá to
  i databáze). Žádný klíč služby.
- **Bez migrace.** Stačí „**sluč 174**“, `db push` není potřeba. PR
  s náhledem Wordu, na kterém tenhle staví, je už sloučený (#173,
  4. 11., `0dd9db5`). **Tenhle PR jsem neslučoval a nic nenasazoval.**

## Co je hotové

| Co | Commit |
|---|---|
| Dokumenty v týdnu, dni a sponka v měsíci; načtení s rezervacemi | `ee8ee58` |
| Výjimka v kontrole neshodí celý test | `7ddd5ff` |
| Opravy z kontroly kódu, 19 nálezů (níž) | `8e310ec` |
| Kontrola kotvy `#dokumenty` v detailu | `29dc8e2` |
| Kontroly, které rozbití ve druhém kole neshodilo (níž) | `a2adf93`, `552f1df` |
| Název dokumentu čitelný i v úzkém sloupci týdne (našel to snímek) | `ae9d8c4` |
| Opravy ze 2. kontroly kódu, 6 nálezů (níž) | `97228fd` |
| Opravy ze 3. kontroly kódu: drobné písmo čitelné na všech podkladech kalendáře (níž) | `15408ce` |

Commity stojí na PR s náhledem Wordu (`2d05ea8`), sloučeném 4. 11.
(#173, `0dd9db5`).

## Čísla — a z čeho jsou

- `scripts/rezervace.test.mjs`: **382 kontrol**, všechny prošly. 353
  z nich je z PR s náhledem Wordu, 29 přidává tenhle PR (oddíl 12
  o dokumentech v kalendáři). Jsou to čisté funkce a to, co se vykreslit
  nedá: dotaz do databáze, vzhled (pravidla v CSS, kontrast), adresa
  zpátky.
- `scripts/rezervace-pobocky.test.mjs`: **85 kontrol**, všechny prošly.
  Oddíl 6 (23 kontrol) **vykreslí skutečný kalendář** (týden, měsíc, den,
  za firmu i za pobočku) ze smyšlených rezervací s dokumenty a kontroluje
  výsledné HTML: kam vede každý štítek, jak se otevře, „Zpět“ z náhledu,
  sponky, popis buňky pro čtečku obrazovky a že řádky dne leží
  v hlavním sloupci.
- Celý seznam testů z CI (`.github/workflows/aplikace.yml`, 100
  souborů, časové pásmo UTC jako na GitHubu): **prošlo 100 ze 100**
  (nad `15408ce`, tedy už nad nejnovějším náhledem Wordu).
- `tsc --noEmit` bez chyby, `eslint` bez nálezů na změněných souborech
  (nad `15408ce`).
- **Schválná rozbití: 86, každé spadlo na té kontrole, na kterou
  mířilo** (nad `15408ce`). 62 míří na čisté funkce, zdroj a CSS
  (`rezervace.test.mjs`), 24 na vykreslený kalendář
  (`rezervace-pobocky.test.mjs`). Kde jde chybu udělat dvěma způsoby,
  rozbil jsem obojí. Například pořadí dokumentů: jednou řazení podle
  textu místo času, jednou bez rozhodnutí při stejném čase. Kontrast:
  jednou se písmo vrátí na šedé, jednou z pravidla vypadne jeden
  podklad (víkend se svátkem, pod myší) nebo řádek, jednou zesílí
  víkend nebo šrafa svátku (pak musí spadnout kontrola výchozích
  barev) a jednou dostane tmavý režim tmavé písmo, zvlášť přepínačem
  a zvlášť podle systému. Ve druhém kole 5 ze 48 nespadlo tam, kam mělo. První
  kolo (29, jen nad zdrojem) prošlo celé, a přesto něco přehlédlo
  (níž v „Na co jsem narazil“).
- Na tomhle PR jsem pustil i ta rozbití z PR s náhledem Wordu, která
  míří na soubory měněné oběma PR: je jich 12. Devět sedí beze změny
  a všech devět spadlo, kam mělo (nad `15408ce`). Tři nesedí, protože
  tenhle PR odkaz na přílohu přesunul do sdíleného odkazu. Dvě z nich
  jsem pro něj napsal znovu (tři rozbití, jsou v těch 86), na třetí tu
  už mířilo vlastní. (Dřív tu stálo „pět“: vybíral jsem je ručně a čtyři
  jsem přehlédl. Teď je vybírá skript podle seznamu souborů, které tenhle
  PR mění.)

## Opravy z kontroly kódu — 19 nálezů

Kontrolu dělalo víc nezávislých posuzovatelů a každý nález ještě jeden
ověřovatel zkusil vyvrátit. 15 potvrzených, 4 pravděpodobné. Opravené
jsou všechny kromě jednoho, který je v otázkách (iPhone).

**Bezpečnost (vážné):**
1. **Odkaz „Zpět“ z náhledu Wordu šlo podvrhnout.** Kontrola adresy
   hlídala jen začátek textu, ale `..` (i zapsané jako `%2e%2e` nebo
   s tabulátorem) prohlížeč vyřeší o složku výš. Odkaz poslaný komukoli
   tak mohl vést z Foodtabu kamkoli, přes veřejné přesměrování i ven.
   Teď se kontroluje adresa, **kam prohlížeč opravdu půjde**. Platí to
   pro všechna „Zpět“ v Rezervacích, ne jen pro náhled. Kontrola zkouší
   16 podvržených adres.

**Kalendář:**
2. Karta týdne byla klikací jen nahoře, i když se zvýraznila celá. Teď je
   klikací celá a štítky dokumentů leží nad ní.
3. Zrušená rezervace zbledla i se svými dokumenty. Teď bledne jen její
   text, odkazy na dokumenty jsou čitelné.
4. Šedé „+ N další dokument“ v kartě týdne (na kartě akce) a počet
   u sponky v měsíci (na dnešní buňce) měly kontrast pod 4,5 : 1. Teď
   jsou v barvě textu. Šedý zůstal souhrn a „+ N další“ v buňce měsíce;
   na dnešní buňce je opravila až 2. kontrola (níž).
5. Dlouhý název souboru se usekl i s příponou. PDF a Word mají stejnou
   ikonu, takže nešly rozeznat. Teď je přípona vždycky vidět. (V úzkém
   sloupci tím ale z názvu zbyla písmena. Opravil jsem to až po snímku,
   níž v „Na co jsem narazil“.)
6. Nebylo poznat, jak se dokument otevře. Pro čtečku obrazovky teď odkaz
   řekne „otevře se v nové záložce“ nebo „náhled dokumentu“.
7. „+ 1 další“ neříkalo co a vedlo na začátek detailu. Teď říká
   „+ 1 další dokument“ a vede rovnou na dokumenty.
8. V měsíci neměla rezervace schovaná v „+ N další“ sponku, ale popis
   buňky pro čtečku ji počítal (tenhle nález přišel dvakrát).
9. Safari na iPhonu neohlásí seznam bez odrážek jako seznam, takže čtečka
   nevěděla, ke které rezervaci dokumenty patří. Teď je to výslovně
   seznam s názvem rezervace.

**Testy (9 nálezů):**
- Testovací rezervace neměly dokumenty, takže vykreslení kalendáře v CI
  by **spadlo** (tohle jsem měl chytit sám, než jsem kód dal ke kontrole).
- Kontrola rámečků poboček v týdnu se dívala jen na první kartu.
- Kontrola adresy zpátky nezkoušela `..`.
- Popisek „Zpět na den / na kalendář“ nikdo nekontroloval.
- Popis buňky se kontroloval jen podle dvou kousků textu.
- Kolik štítků se ukáže v kartě, nikdo nekontroloval.
- Dotaz s dokumenty funguje, jen dokud mezi tabulkami vede jediná vazba.
  Kontrola teď projde všechny migrace a hlídá, že je jen jedna.
- Pravidlo „nová záložka jen u PDF a fotky“ se hlídalo jen v jednom
  souboru. Teď ve všech 24 souborech Rezervací.
- Dvě kontroly nešly shodit vůbec.

Většina kontrol z oddílu 12 dřív hledala **text ve zdrojovém kódu**.
Teď se kalendář opravdu vykreslí a kontroluje se výsledná stránka (oddíl
6 v `rezervace-pobocky.test.mjs`). Kontrola nad zdrojem projde i nad
kódem, který se vykreslí špatně.

## 2. kontrola — 6 nálezů (`97228fd`)

Kontrolovala oba PR najednou (tenhle a náhled Wordu). K tomuhle PR
přišlo 7 nálezů, ověřovatelé potvrdili 6 a 1 vyvrátili.

1. **Den na okně kolem 1100–1200 px** dostal široké rozvržení řádků,
   i když hlavní sloupec byl úzký. Způsobilo to moje přejmenování
   kontejnerů (výš v „Na co jsem narazil“). Opravené: hlavní sloupec
   má vlastní jméno (`rez-hlavni`) a seznam dne i údaje detailu se
   řídí jím.
2. **Kontroly vzhledu šly obejít.** Přijaly u kteréhokoli pravidla
   kterékoli jméno kontejneru a práh úzkého štítku neměl horní mez.
   Prošlo by tak CSS, ve kterém se týden na telefonu nesloží do jednoho
   sloupce. Teď kontrola pozná každé pravidlo podle toho, co je v něm,
   a chce u něj jeho kontejner a jeho šířku. Další kontrola hlídá, že
   kontejnery jsou tři a žádné pozdější pravidlo je nezruší. Nová
   kontrola nad vykresleným dnem hlídá, že řádky leží v hlavním sloupci.
3. **Šedé „+ N další“ a souhrn v buňce měsíce** měly na dnešní buňce
   kontrast 4,1 : 1 (v tmavém režimu 3,6 : 1), drobné písmo potřebuje
   4,5 : 1. Je to starší stav, ale právě k tomu řádku jsem přidal sponku.
   Při opravě jsem našel totéž v **dnešním sloupci týdne** (souhrn,
   značky poznámek a „+ Přidat“: 4,2 : 1, v tmavém režimu 4,0 : 1). To
   kontrola nehlásila. Teď je na dnešku obojí v barvě textu. Kontrola
   počítá kontrast z barev aplikace v obou režimech, zvlášť pro týden
   a pro měsíc. (Jenže jen pro dnešek — zbytek našla až 3. kontrola,
   níž.)
4. Hlášení tvrdilo, že se kromě úzkého sloupce týdne nic nezměnilo
   (den ano, bod 1).
5. Hlášení tvrdilo, že na širokém monitoru se nic nemění. Na 1920 px
   ale nové rozvržení štítku platí.
6. Hlášení říkalo „napoprvé“ o druhém kole rozbití a „dvě slabé
   kontroly“ místo čtyř.

Vyvrácené: „kontroly s očekáváním jen v naměřené části názvu“. Takové
už nebyly, opravil jsem je dřív (`a2adf93`).

## 3. kontrola — 2 nálezy (`15408ce`)

Zase oba PR najednou. K tomuhle PR 4 nálezy, ověřovatelé potvrdili 2
a 2 vyvrátili.

1. **Vínový název akce na dnešní buňce měsíce** měl v tmavém režimu
   kontrast 3,6 : 1, se šrafou svátku 2,8 : 1. Praporek u něj se
   svátkem taky 2,8 : 1 (ikoně stačí 3 : 1).
2. **Šedý řádek pod názvem karty akce v týdnu** (čas, osoby, sál) měl
   na vínovém podkladu karty 4,3 : 1.

Obojí je starší stav, ale leží přímo vedle toho, co tenhle PR mění
(sponka v řádku měsíce, štítky v kartě). Při opravě jsem změřil
**všechno drobné písmo na všech podkladech kalendáře**, ne jen to
nahlášené, a našel ještě dvě místa:
- **víkend se svátkem** (šrafa svátku leží na mosazi víkendu): šedé
  písmo 4,2 : 1, v tmavém režimu 4,0 : 1, vínový název akce v tmavém
  4,1 : 1 — v týdnu i v měsíci;
- **buňka měsíce pod myší**: šedé písmo 4,1 : 1, se svátkem 3,9 : 1.

Teď je drobné písmo na dnešku, na víkendu se svátkem a pod myší
v barvě textu, stejně jako dnešek po 2. kontrole. Název akce
a praporek na dnešku a na víkendu se svátkem taky; akci dál pozná
praporek a tučné písmo. Řádek pod názvem karty akce je v barvě textu.
Jinde se nic nemění: obyčejný den, víkend bez svátku a den se svátkem
mimo víkend drží 4,5 : 1 i se šedou.

Kontrola teď počítá kontrast pro každý podklad (obyčejný den, víkend,
dnešek, každý i se šrafou svátku, buňka pod myší, karta rezervace
a karta akce) ve všech třech sadách barev aplikace: světlé, tmavé
zapnuté přepínačem a tmavé podle systému. Hlídá i výchozí barvy tam,
kde se písmo nepřebarvuje. Když někdo zesílí víkend nebo šrafu svátku,
spadne.

Vyvrácené: dvě čísla v hlášení, která v té době už byla opravená.

## Co čeká na Šéfíka

- **„sluč 174“** (bez `db push`). PR s náhledem Wordu (#173) je už
  sloučený.
- Po sloučení: Rezervace → týden s akcí, ke které je dokument → klik na
  štítek. Word se otevře jako náhled, „Zpět na kalendář“ vrátí na ten
  týden. PDF se otevře v nové záložce.

## Otázky

- **iPhone z plochy:** PDF a fotka z kalendáře se otevírají v nové
  záložce, stejně jako dosud v detailu rezervace. Tam se může otevřít
  nepřihlášené Safari. Totéž je v hlášení k Wordu, rozhodnutí platí pro
  obojí.

## Na co jsem narazil a nešlo to

- **Dotaz s dokumenty jsem nezkoušel proti skutečné databázi.** Testy
  v CI ho nepustí: databázi v nich zkouší PGlite a PostgreSQL, ale bez
  rozhraní, přes které s ní mluví aplikace (PostgREST). Proto
  kontrola projde všechny migrace a hlídá, že mezi rezervacemi
  a přílohami vede jediná vazba. Jen tehdy dotaz „rezervace i s jejich
  přílohami“ funguje. Jestli platí, se ukáže hned po sloučení při
  otevření kalendáře. Kdyby ne, kalendář místo rezervací ukáže chybu,
  ne jen bez dokumentů.
- **První kolo schválných rozbití nenašlo nic, a nemělo to tak být.**
  Prošlo celé (29 rozbití, jen nad `rezervace.test.mjs`, před kontrolou
  kódu). Kontrola kódu pak přesto našla pád vykreslení v CI a dvě
  kontroly, které nešly shodit. Ve druhém kole (48 rozbití, poprvé i nad
  vykresleným kalendářem) 5 nespadlo tam, kam mířilo. Týkalo se to čtyř
  kontrol dvou druhů:
  1. „týden: každá rezervace má kartu“ a „den: každá rezervace dne má
     řádek“ hlídají, že dokumenty jsou za odkazem na rezervaci, ne
     v něm. Prošly, i když jsem dokumenty do odkazu vložil. Hledání
     v HTML si s tím poradilo, takže kontroly nehlídaly to, co měly
     v názvu. Spadly jen sousední kontroly. U dne to první oprava
     nespravila, chytilo to až další kolo rozbití.
  2. Dvě kontroly „Zpět na kalendář / na den“ měly v názvu naměřenou
     hodnotu. Po rozbití se přejmenovaly na „undefined“, takže spadly,
     ale nešlo poznat které. Teď je očekávání v názvu pevně.

  Obojí je opravené (`a2adf93`, `552f1df`). V posledním kole spadlo
  všech 86 rozbití na své kontrole.
- **Kontrast jsem ve 2. kontrole změřil jen na dnešku**, i když víkend
  a šrafa svátku jsou stejný druh podkladu (mosaz pod písmem) a název
  akce v buňce je taky drobné písmo. Opravil jsem přesně nahlášené
  místo místo toho, abych změřil všechno písmo na všech podkladech.
  To jsem udělal až ve 3. kontrole.
- **Dny sousedního měsíce v mřížce jsem nechal bledé.** Na začátku
  a konci měsíce jsou dny předchozího a dalšího měsíce. Jejich číslo
  a řádky rezervací jsou schválně bledé, ve světlém režimu 3,0 : 1,
  šedý souhrn na nich 4,4 : 1. Je to starší záměr (odlišují se tím od
  dnů měsíce) a tenhle PR na ně nesahá. Kdyby měly být čitelné jako
  ostatní, je to jedna barva v CSS.
- **Testy jsem pustil celé až po kontrole kódu, ne před ní.** Proto
  kontrola našla pád vykreslení v CI. Mám si to pouštět dřív.
- **Snímek obrazovky našel chybu, kterou žádný test neviděl.** Na
  notebooku (1280 px, celá firma) zbyla v kartě týdne z názvu dokumentu
  jedna dvě písmena („S… .docx“, „Me… .pdf“). Způsobila to moje oprava
  z kontroly kódu: přípona zůstává vždycky vidět, a vedle ikony
  a přípony tak na název zbylo 7–16 px. Na 1536 px nanejvýš 53 px.
  Teď jsou v úzkém sloupci ikona s příponou nahoře a název pod nimi
  přes celý štítek, na dva řádky. Na 1280 px má název 54 px („Smlouva
  o akci –…“, „Menu svatba“), na 1536 px 91 px a na 1920 px 148 px.
  Nové rozvržení platí i na běžném Full HD monitoru (1920 px). Beze
  změny zůstává jen týden na okně širším než asi 2070 px (pobočka)
  nebo 2190 px (celá firma) a telefon (`ae9d8c4`).

  První verze opravy pokazila štítky jinak. Pravidla pro mobil se
  začala ptát na šířku seznamu dokumentů místo šířky kalendáře, takže
  štítky dostaly mobilní rozvržení i na počítači. Poznal jsem to
  z měření ve stránce a opravil tím, že jsem každému pravidlu pro
  šířku dal jméno kontejneru.

  **A tou opravou jsem pokazil den** (našla to 2. kontrola). Seznam
  rezervací dne se dřív řídil šířkou hlavního sloupce vedle bočního
  panelu, po přejmenování šířkou celého kalendáře. Na okně zhruba
  1100–1200 px (třeba notebook 1440 px se zvětšením 125 %) tak řádky
  dne zůstaly ve třech sloupcích a na jméno zbylo asi 150 px. Kontrola,
  kterou jsem k tomu napsal, ten stav ještě zamkla: chtěla u každého
  pravidla jméno „kalendář“, ať patřilo kamkoli. Teď má hlavní sloupec
  vlastní jméno, seznam dne a údaje detailu se ptají jeho a kontrola
  pozná každé pravidlo podle toho, co je v něm (níž).
- Snímky po opravě (jen smyšlené rezervace): týden za firmu na 1280
  a 1536 px, týden pobočky, týden na telefonu a v tmavém režimu, měsíc
  a den na počítači i telefonu. Nikde odkaz v odkazu, stránka nikde
  nejede do strany. V měsíci sponky s počtem, v dni všechny tři
  dokumenty akce.

  Po 2. kontrole znovu, nad `97228fd`:
  - den za celou firmu na okně 1150 px: hlavní sloupec má 513 px
    a řádky jsou složené (čas vlevo, jméno, stav a dokumenty pod
    sebou), dokumenty zarovnané se jménem;
  - měsíc s pěti rezervacemi v dnešní buňce a týden pobočky, oboje ve
    světlém i tmavém režimu. Souhrn, „+ 2 další (RČP)“ se sponkou
    i značky poznámek jsou na dnešku v barvě textu, ve všech ostatních
    dnech zůstávají šedé. „+ Přidat“ ve snímku není (zkušební stránka
    je bez práva zápisu), hlídá ho kontrola nad CSS;
  - nikde stránka nejede do strany.

  Po 3. kontrole znovu, nad `15408ce`, ve světlém i tmavém režimu:
  - měsíc prosinec: na sobotě 26. 12. (víkend se svátkem) je souhrn,
    název akce, praporek i sponka v barvě textu. Obyčejný den 15. 12.
    má souhrn šedý, pod myší v barvě textu;
  - měsíc listopad: na dnešku je název akce i praporek v barvě textu,
    akce 12. 11. zůstává vínová;
  - týden 21.–27. 12.: sloupec soboty se svátkem má souhrn v barvě
    textu, neděle bez svátku šedý. Řádek pod názvem karty akce je
    v barvě textu, u karty rezervace zůstává šedý;
  - měsíc na telefonu (390 px): název dne je na sobotě se svátkem
    v barvě textu, na 15. 12. a na svátcích ve všední den šedý.
    Napoprvé jsem ho měřil na počítači, kde je název dne skrytý,
    takže to měření nic neříkalo;
  - nikde stránka nejede do strany.

  Tmavý režim na snímcích je podle systému. Tmavý režim zapnutý
  přepínačem má stejné barvy (stejné hodnoty v CSS), hlídá ho kontrola.
- CSS rozvržení umí ověřit jen prohlížeč. Testy proto hlídají, že
  pravidla v CSS jsou, že každé míří na svůj kontejner a že prvky
  leží ve vykreslené stránce tam, kde je pravidlo čeká. Že to vypadá
  dobře, ukázaly snímky.

## Kde jsem skončil a co zbývá

- Hotové, otestované, v PR.
- Z #171 dál platí: na akce a rezervace nechodí upozornění nikomu, dokud
  v Rezervace → Upozornění u pobočky nikoho nevyberete.

## Nenasazoval jsem

Nic. PR čeká na „sluč 174“. Bez migrace.
