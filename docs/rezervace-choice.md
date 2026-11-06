# Choice → Foodtab: rezervace načítané přímo

Rezervace z Choice (choiceqr.com) se samy objeví v **Provoz → Rezervace
a akce**. Foodtab se Choice ptá **každých 15 minut** (Choice je sám
poslat neumí) a do Choice **nic nezapisuje** — potvrzování a rušení
zůstává v Choice.

Ve Foodtabu k rezervacím dál přidáváte poznámky, dokumenty, zálohu od
hosta a stůl. To Choice nepřepíše. Čas, počet osob, stav, jméno
a kontakt patří Choice — změna v Choice se do Foodtabu propíše při
dalším načtení. Zrušená rezervace ve Foodtabu zůstane jako „zrušená“,
i s vašimi poznámkami.

## Co je potřeba jednou nastavit (tři kroky)

### 1. Klíče aplikace Foodtab do Vercelu

Aplikace „Foodtab“ (typ Plugin) je v Choice už založená. V Choice
otevřete <https://open-api.choiceqr.com/auth/client> → aplikace
**Foodtab** a zkopírujte **Client ID** a **Client secret**.

Ve Vercelu: projekt **foodtab-rizeni** → Settings → Environment
Variables → přidejte (prostředí Production):

| Název | Hodnota |
|---|---|
| `CHOICE_CLIENT_ID` | Client ID z Choice |
| `CHOICE_CLIENT_SECRET` | Client secret z Choice |

Pak **Redeploy** (proměnné se projeví až v novém nasazení).

U aplikace v Choice musí být jako **Authorization callback URL**
přesně `https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback`
(už tam je). Kdybyste appku otevírali na jiné adrese, musí ta adresa
sedět i tady.

Dokud klíče ve Vercelu nejsou, ukazuje karta Choice **„Čeká na
nastavení“** a připojit nenabízí.

### 2. ChoiceQR token od Choice

Při připojení se Choice zeptá na **ChoiceQR token**. Ten posílá Choice
— napište na **api@choiceqr.com** (nebo své kontaktní osobě v Choice),
že chcete připojit svůj podnik k aplikaci Foodtab přes Open API.

### 3. Připojit podnik ve Foodtabu

Nejdřív si v Choice nechte vygenerovat **odkaz na připojení**: na
<https://open-api.choiceqr.com/auth/client> → aplikace **Foodtab** →
**Connected company list** zadejte adresu podniku (např.
`https://cernaperlatabor.choiceqr.com`) a klikněte na **Connect**.
Objeví se odkaz, který začíná
`https://…choiceqr.com/admin/open-api/connect?clientId=…` a končí
`&digit=` a čtyřmi číslicemi. Ten zkopírujte **celý**.

Jen adresa podniku nestačí: číslo `digit` v odkazu přiděluje Choice
a bez něj se připojení nedokončí.

Pak ve Foodtabu **Provoz → Rezervace a akce → Napojení a import →
karta Choice**:

1. vyberte pobočku (když jich máte víc),
2. do pole **Odkaz na připojení z Choice** vložte zkopírovaný odkaz,
3. **Připojit podnik v Choice** → Choice se zeptá na ChoiceQR token
   a na povolení → po povolení vás vrátí do Foodtabu.

Foodtab pak přístup **hned vyzkouší** (jedním dotazem na rezervace)
a teprve když projde, ukáže **„Připojeno“**. První rezervace se začnou
načítat hned. Odkaz na připojení platí 10 minut a jen pro vás —
kdyby vypršel, klikněte znovu.

Připojit smí ten, kdo má právo „Správa napojení na externí systémy“.

## Na co se dívat

U pobočky na kartě Choice:

- **Připojeno** + „naposledy načteno … · N rezervací“ — vše běží,
- **Načíst teď** — načte hned, nečeká na čtvrthodinu (smí i ten, kdo
  na pobočce zapisuje rezervace),
- **Ověřit znovu** — znovu vyzkouší přístup (u pobočky nejvýš jednou
  za minutu),
- **Odpojit** — Foodtab se přestane ptát a smaže uložený token.
  Už načtené rezervace zůstanou. Přístup aplikace můžete zrušit i
  v Choice.

Červený text pod pobočkou říká, co se nepovedlo, třeba:

- *Choice omezil počet dotazů (429)* — nic se neděje, pokračuje se při
  dalším běhu;
- *Choice odmítl přístup (401/403)* — token přestal platit, připojte
  podnik znovu (Odpojit → Připojit podnik v Choice);
- *Nezapsaly se 2 rezervace z Choice (čas bez časového pásma)* — Choice
  poslal čas, ze kterého nejde poznat, kdy rezervace je. Foodtab si ho
  nedomýšlí (posunula by se o hodinu či dvě). Pošlete prosím tu hlášku
  vývojáři;
- *Stoly z Choice se nenačetly (…) — u N rezervací zůstávají naposledy
  načtené* — seznam stolů z Choice se tentokrát nepřečetl. Rezervace se
  načítají dál, jen stoly se neobnovily; příští běh to zkusí znovu;
- *U N rezervací poslal Choice stůl, který v seznamu míst v Choice
  není* — ve Foodtabu je u nich „1 stůl bez názvu“ (na konci stolů,
  bez části podniku; když jiné stoly nejsou, ukáže se vedle přání
  hosta). Zkontrolujte v Choice nastavení míst (stůl mohl být smazaný
  nebo přejmenovaný). Stůl, který Choice zná, ale nemá jméno, je u své
  části podniku („Patro: S1, 1 stůl bez názvu“) a hlášku nedělá.
- *Stoly z Choice se nenačetly celé (podnik má v Choice víc než 20
  částí…)* — Foodtab čte nejvýš 20 částí podniku (Patro, Terasa…).
  U rezervací se stoly z dalších částí neobnoví a zůstávají naposledy načtené.
  Pošlete prosím tu hlášku vývojáři, hranice se dá posunout.

## Co se z Choice načítá

U každé rezervace: čas, počet osob, stav, jméno a kontakt hosta,
poznámky (hosta, restaurace, důvod zrušení), záloha (jen stav),
**přidělené stoly** a **číslo rezervace v Choice** (#105).

- **Stoly** se ukážou v kalendáři (týden: druhý řádek karty, den:
  u počtu osob) a v detailu rezervace jako „Stoly v Choice: Patro:
  S1–S12“. Stoly se řadí podle čísla (S2 před S10). Rozsahem
  (S1–S12) se píšou jen tři a víc stolů se stejným jménem, jejichž
  čísla jdou bez mezery po jedné (S1, S2, S3). „A1, B2, C3“ nebo „S1, S2, S4“ zůstanou vypsané, ať
  rozsah nikdy nezahrne stůl, který host nemá. Víc částí podniku se
  oddělí tečkou („Patro: S1, S2 · Terasa: L7“). Hodně dlouhý seznam se
  zkrátí za celým stolem (nejvýš 300 znaků) a končí „ …“, nikdy
  uprostřed jména — ani když je ve jménu stolu čárka („Stůl 17, u okna“).
  Jméno stolu delší než 40 znaků (část podniku 60) se zkrátí a dostane
  „…“: z „Stolek 123“ nesmí zbýt „Stolek 12“, to by byl jiný stůl.
  Stoly patří Choice: když hosta v Choice přesadíte, Foodtab to při
  dalším načtení přepíše.
- **Přesazení v Choice upozornění nepošle**, ani u akce — ani když
  Choice stoly odebere nebo host změní přání. Upozornění na změnu
  hlídá „Stůl / prostor“, a ten po prvním načtení mění jen obsluha.
  Jinak by každé přeskupení stolů v Choice rozeslalo upozornění
  vybraným lidem. Jestli to u akcí chcete, je to otázka 87.
- **„Stůl / prostor“** ve Foodtabu patří dál obsluze. Když je prázdný,
  Choice ho při načtení doplní přáním hosta (část podniku, kterou si
  host vybral) — i u rezervace se stoly. Foodtab si poznamená, že ho
  napsal Choice, a v kalendáři ho vedle stolů z Choice neukáže (host
  „Patro“ přesazený na „Terasa: L7“ by se jinak četl, jako by měl
  obojí). Co do něj napíše obsluha, načtení z Choice nepřepíše a ukáže
  se vždycky — i když zní stejně jako přání hosta. Stejný text uložený
  znovu poznámku „napsal Choice“ nechá, jiný ji zruší. **U akce Choice
  „Stůl / prostor“ nedoplní nikdy** (doplnění by poslalo upozornění
  „změnil se prostor“); přání hosta se u akce ukáže samo. Když ho host
  v Choice smaže, ukáže se u akce to, co je v jejím „Stůl / prostor“.
- **Přání hosta** se ukládá zvlášť a při každém načtení se obnoví.
  V detailu je u „Stůl / prostor“ od Choice „(přání hosta v Choice)“,
  když je to pořád aktuální přání, nebo „(doplněno z Choice)“, když si
  host přání mezitím změnil — to aktuální má pak vlastní řádek. Bez
  stolů ukazuje kalendář (i ranní souhrn) aktuální přání, ne to, které
  se doplnilo kdysi; když ho host smazal, nic (u akce „Stůl / prostor“,
  viz výš). Rezervace načtené před
  touhle změnou poznámku „napsal Choice“ dostanou při nejbližším
  načtení, když „Stůl / prostor“ zní stejně jako přání, které Choice
  posílá (obsluhu, která napsala přesně přání hosta, od Choice
  rozeznat nejde). Do té doby Foodtab pozná přání podle shody s textem
  jako dřív.
- **Číslo rezervace** je v detailu („Převzato z rezervačního systému
  (Choice, č. 105)“), ať se dá rezervace v Choice dohledat. Když se
  v Choice změní jen číslo, rezervace se počítá jako změněná a číslo se
  přepíše.
- **Poznámka ze zdroje** navíc řekne, když rezervace přišla přes
  Google („Rezervace přišla přes Google.“), a jazyk rezervace, když
  není čeština („Jazyk rezervace: angličtina.“ — i z „en-GB“,
  „zh-Hant-TW“ nebo třípísmenného „ukr“; kód, který Foodtab nezná,
  zůstane kódem: „kód XXX“).
- **Délka návštěvy** (v Choice třeba „2h“) se zatím nenačítá: Choice
  v dokumentaci neříká, v jakých jednotkách ji posílá, a odhadnutý konec
  by mohl být špatně. Konec rezervace tedy ve Foodtabu zůstává prázdný.
  Každé načtení si ale uloží až 5 ukázek (délka a číslo rezervace).
  Podle čísla se v Choice dohledá, kolik to bylo hodin, a jednotka se
  pozná jistě (otázka 88).

## Proč to chvíli trvá

Choice dovolí jen **jeden dotaz za 5 sekund**. Jeden dotaz přinese
nejvýš 100 rezervací. Při každém běhu se Foodtab nejdřív zeptá na
dnešek a zítřek (storna se tak objeví do čtvrt hodiny) a na nově
vytvořené rezervace, pak pokračuje v procházení dalších 180 dní tam,
kde minule skončil. Velký podnik se tak celý načte během několika
běhů; nové a dnešní rezervace vždy hned.

Jeden běh (čtvrthodinu) stihne zhruba sedm dotazů. S jednou nebo
dvěma pobočkami na Choice se tak každá načte při každém běhu. Při víc
pobočkách se střídají (dvě za běh): žádná se nepřeskočí natrvalo
a každá, když přijde na řadu, dostane čas i na procházení 180 dní.
Se čtyřmi pobočkami se tedy každá načte zhruba každou půlhodinu.

---

## Pro vývojáře

- Adaptér: `lib/rezervace-choice.ts` (čistá logika, testy
  `scripts/rezervace-choice.test.mjs`), server
  `lib/rezervace-choice-sync.ts`, callback
  `app/api/rezervace/choice/callback/route.ts`, úloha
  `app/api/uloha/rezervace-choice/route.ts` +
  `.github/workflows/rezervace-choice.yml`.
- Migrace `20261031100000_rezervace_choice.sql`: úloha v plánovači
  a fronta dotazů `rezervace_choice_zabrat_dotaz(p_tenant, …)` (jen
  service_role, rozestup 5,5 s pro celou instalaci, každá firma nejvýš
  jeden zabraný dotaz, který ještě neodešel — souběžné kliky jedné
  firmy nezaberou frontu ostatním). Tlačítka (Ověřit znovu, Načíst teď,
  callback) čekají ve frontě nejvýš dva rozestupy
  (`NEJDELE_CEKA_TLACITKO_MS`, 11 s): vedle jednoho běžícího načítání
  jiné firmy se vejdou vždy (s jedním rozestupem skoro nikdy) a ani
  mnoho firem nezdrží úlohu ostatních o víc než ~16,5 s; celý svůj díl
  čeká jen naplánovaná úloha (`uloha: true`). „Ověřit znovu“ nejvýš
  jednou za minutu na připojení — odstup a dotaz ve frontě rozhoduje
  `rezervace_choice_zabrat_overeni` naráz, takže klik, který se do
  fronty nevejde, minutu nespálí. Scénář `krok105` (oddíly 2b a 2d
  zkoušejí zámek řádku firmy a zámek odstupu dvěma spojeními přes
  dblink — jen proti PostgreSQL).
- Migrace `20261102100000_rezervace_choice_fronta_tlacitka.sql`
  (nezávislé ověření po sloučení #162): úloha jde do fronty vlastním
  vstupem `rezervace_choice_zabrat_dotaz_ulohy` bez pravidla firmy
  (úloha je v instalaci jediná) — tlačítko její firmy ji neusekne a ona
  tlačítko nezablokuje. Tlačítka, když se nevejdou, dostanou záporně
  „zkusit znovu za n ms“ (až odejde dotaz, který má firma zabraný, a až
  se fronta posune) a server jednou počká, nejvýš jeden rozestup
  (`NEJDELE_PRED_OPAKOVANIM_MS`). Tak projde callback pobočky 2 během
  prvního načtení pobočky 1 téže firmy i třetí tlačítko vedle dvou běhů
  jiných firem a dva běhy téže firmy se střídají. „Načíst teď“ má na
  běh 55 s (`KONEC_NACIST_TED_MS`), aby i vedle běžícího načítání
  stihlo všechny tři dotazy. `db push` až po nasazení kódu (starý kód
  bere záporné číslo jako chybu fronty); nový kód se starou databází
  jede jako dřív. Souběh ve virtuálním čase: `scripts/rezervace-choice.test.mjs`,
  oddíl 6a.
- Úloha dělí čas: rezerva 20 s se odečte jednou za úlohu, zbytek po
  dílech nejméně na tři dotazy; pořadí `poradiSynchronizace` (firmy se
  střídají, podle `synchronizace_behy`, tentýž podnik u firmy jednou).
  Běh, který se na Choice ani jednou nezeptal (fronta plná), zapíše
  prázdný `pocet_novych_radku` a pořadí ho nepočítá — „Načíst teď“, které
  nic nenačetlo, připojení neodsune.
- Zápis stávající cestou `rezervace_importovat_zdroj` (poskytovatel
  `choice`, číslo = `_id`). Token zašifrovaný v `integrace_tajemstvi`,
  kurzor v `integrace_pripojeni.externi_ucet.kurzor`.
- Stoly (migrace `20261107100000_rezervace_misto_zdroje.sql`, 4. 11.):
  `locationPoints` rezervace (id stolů) se převedou na text podle
  seznamu míst (`GET /location/cs/areas/list`, pak
  `/location/cs/points/list/:areaId` pro každou oblast se stoly, nejvýš
  20). Seznam se načte nejvýš jednou za běh — u první stránky, kde
  nějaká rezervace stoly má, nebo hned na začátku (`mapaHned`, níž) —
  a jde MIMO frontu dotazů: limit 1 / 5 s platí jen pro
  `/bookings/list` (ostatní metody 60 za sekundu, api.md). Místo ve
  frontě by vzalo jeden ze tří dotazů, které úloha dává připojení
  (blízko, nové, okno), a druhé pobočce by se přestalo načítat okno
  (kontrola kódu 4. 11.). Hlídá se jen čas: seznam smí odejít
  nejpozději s posledním dotazem běhu, a v úloze jen tehdy, když
  nezdrží další připojení (`smiMimoFrontu(trvaniMs)` →
  `smiSeznamMist` v `rezervace-choice-sync.ts`; trvání
  `NEJDELE_MAPA_MS` = dva časové limity, 12 s). Na jeho konec čeká
  zápis stránky, a tím i konec běhu — začal-li by pozdě v dílu, další
  připojení by čekalo (3. kolo kontroly). Pravidlo (4. kolo): díl,
  který končí před koncem úlohy — seznam se musí celý vejít do dílu;
  díl, který dočítá zbytek úlohy
  (`konecDiluUlohy` ho natáhl do posledního dotazu) — opravdu poslední
  připojení (`posledniPripojeni` z route) smí vždy, jinak jen když se
  seznam i se zápisem po něm (`ZAPIS_PO_SEZNAMU_MS`, 3 s) vejde před
  `posledniDotazMs - NEJMENE_NA_PRIPOJENI_MS`, nebo když už je za tou
  hranicí (další připojení by nezačalo tak jako tak). Route totiž
  další připojení začne, když tohle doběhne brzy, a pozdní seznam by ho
  připravil o celý běh. Cena: připojení, které není poslední, stoly
  pozdě v dílu nenačte; zůstanou z minula a příští běh to zkusí znovu.
  Aby se to nestalo pořád stejné pobočce (v úloze jde první vždy
  první a do jejího dílu by se u stránek „nové“ a „okno“ seznam nevešel
  nikdy), načte napojení, u kterého běh stoly jednou viděl
  (`externi_ucet.ma_stoly`, zapíše ho běh s `mista.videnyStoly`, nikdy
  ho nesmaže), seznam HNED na začátku běhu souběžně s prvním dotazem
  (`mapaHned`). I tehdy platí pravidlo výš: před prvním dotazem
  připojení konec dílu ještě není (`dil.konecMs`), tak se odhadne, jako
  by první dotaz odcházel hned (5. kolo — dřív tu platilo „smí“ a seznam
  načtený hned pravidlo obešel). Nevejde-li se, nic se nezamyká a zkusí
  to první stránka se stoly jako dřív. Časový limit 6 s na dotaz
  (`CASOVY_LIMIT_MIST_MS`), oblasti, pak stoly souběžně — dva limity se
  vejdou do rezervy úlohy (20 s). Seznam se načítá SOUBĚŽNĚ s dalšími
  dotazy na rezervace: na něj čeká jen zápis stránky (řada `zapisy`
  v `probehnoutChoice`), ne další dotaz. Kontrola kódu 4. 11. (2. kolo):
  dokud na něj čekal další dotaz, pomalý Choice (od ~3,7 s na dotaz)
  vzal dotazům místo ve frontě a druhé pobočce úlohy se nenačetlo okno.
  Zápisy jdou popořadě; chyba zápisu zastaví další zápisy i posun
  kurzoru a konec běhu ji ohlásí přednostně (`konec`) — kromě „limit“
  a „pristup“ z dotazu, který opravdu odešel: ty zůstanou (napojení se
  podle nich označí k opravě) a chyba zápisu jde do `chybaZapisu`
  a hlášky. Výjimka mimo zápis (fronta) běh ukončí až po rozběhnutém
  zápisu a další stránky se už nezapíšou (3. kolo). Chyba zápisu se
  kontroluje i po čekání na frontu — mohla přijít mezitím (4. kolo).
  Výsledek jde do
  `rezervace.misto_zdroje` (patří zdroji, přepisuje se), `num` do
  `rezervace.cislo_zdroje`, `cancelReason` do poznámky ze zdroje.
  Nepovedený seznam = klíč `misto_zdroje` v řádku chybí a databáze
  nechá uložené (`app.rezervace_zapsat_radky`); prázdné
  `locationPoints` = `''` (stoly smazat). Má-li podnik víc než 20
  oblastí (`MAX_OBLASTI`), mapa není celá (`uplna: false`) a stůl, který
  v ní není, dá „nevím“ (klíč chybí), ne „bez názvu“. Do mapy patří
  i oblasti s `itemCount` 0 a stoly bez jména; stůl bez jména se
  počítá u své oblasti („Patro: 2 stoly bez názvu“), jen stůl mimo
  (celou) mapu jde na konec bez oblasti. Zkracování
  (`zkratit` v `lib/rezervace-import.ts`) nerozpůlí znak mimo BMP
  (emoji) a osamělou půlku nahradí U+FFFD, takže text projde
  PostgreSQL. Text stolů se skládá po kouscích (`slozitStoly`), ne
  řezem hotového textu u čárky — čárka může být i ve jménu stolu.
  Jména míst nad `MAX_JMENO_STOLU` (40) / `MAX_JMENO_OBLASTI` (60)
  končí „…“ (`jmenoMista`), takže se zkrácené jméno nespojí do rozsahu.
  `preferArea` jde vždy do `rezervace.prani_zdroje` (120 znaků)
  a zároveň jako `prostor` (i u rezervace se stoly, 3. kolo): databáze
  ho doplní jen do prázdného prostoru a poznamená
  `prostor_ze_zdroje = true` (prostor = přání). Spoušť
  `trg_rezervace_prostor_od_obsluhy` příznak shodí, kdykoli prostor
  změní kdokoli jiný než import (`rezervace_ulozit` se neměnila);
  `true` bez prostoru nepustí kontrola. Řádky před migrací mají
  `null` (výchozí `false` se nastaví až po přidání sloupce). Import
  `null` vyřeší (`v_vyresit_priznak`): je-li prostor stejný jako
  přání, které zdroj posílá, zapíše `true` — i když se jinak nic
  nezměnilo (4. kolo). `prostorZeZdroje` / `mistoKratce`
  v `lib/rezervace-misto.ts` (kalendář i ranní souhrn) rozhodují podle
  příznaku, u `null` podle shody s přáním; přání, které host smazal, se
  neukáže. Proč hned a ne až bez stolů: doplnění ve chvíli, kdy Choice
  stoly odebere, by u akce poslalo upozornění „změna prostoru“ (spoušť
  z 20261106100000 hlídá `prostor`). Ze stejného důvodu import od
  zdroje, který posílá přání (klíč `prani_zdroje`, Choice), prostor AKCE
  nedoplní nikdy (`v_doplnit_prostor`, 4. kolo): host může přání přidat
  později, nebo obsluha prostor smaže. Zdroj bez přání (příjmové API
  posílá v `prostor` skutečný stůl, starý kód Choice) ho u akce doplní
  jako dřív — jinak by se stůl nikam neuložil (5. kolo). U akce bez stolů
  a bez přání ukáže `mistoKratce` prostor i od zdroje: import ho u akce
  nemění a kuchyně by o místo přišla (5. kolo). Ranní souhrn
  (`app.rezervace_souhrn_dne`, předefinovaný v téže migraci) nese
  u akce `stoly`, `prani` a `prostor_ze_zdroje`; `popisSouhrnuDne`
  skládá místo přes `mistoKratce`. Jazyk (`langCode`) přes `Intl.DisplayNames` česky
  (`jazykRezervace`): první kousek značky BCP 47 (2–3 písmena,
  další kousky do 8 znaků), cs/cz/ces/cze se nepíše.
  Klíče se čtou jen u `p_zdroj = 'externi'` — import ze souboru je
  posílá z prohlížeče a nesmí si vydávat stoly za Choice. Příjmové API
  zkracuje přes `zkratit`, ne `.slice` (emoji na hranici by PostgREST
  odmítl celou dávkou, PGRST102).
- Ukázka délky: běh uloží do `externi_ucet.ukazka_delky` nejvýš
  `UKAZEK_DELKY` (5) dvojic `visitDuration` + číslo rezervace. Běh bez
  nich uloženou ukázku nechá. Po nasazení se dá přečíst a porovnat
  s Choice (otázka 88).
- Nasazení: kód čte nové sloupce s náhradou (`SLOUPCE_ZDROJE` v
  `app/[rozsah]/rezervace/data.ts`): do `db push` kalendář ukazuje
  rezervace bez stolů, ne chybu. Do `db push` ale stará funkce zápisu
  nové klíče nečte — rezervace, které mezitím odejdou z okna načítání
  (36 h zpátky), stoly už nedostanou. `db push` proto brzy po sloučení
  — ale **až po „Ready“ na Vercelu**, nikdy dřív: starý kód nad novou
  databází (bez klíče `prani_zdroje`) by u doplněného prostoru zapsal
  `prostor_ze_zdroje = false` napořád (4. kolo, nález 18).
  Testy: `rezervace-choice` oddíl 11, `rezervace-pobocky` oddíl 7,
  `upozorneni` (místo akce v ranním souhrnu), scénář `krok109`
  (příznak, spoušť, kontrola a upozornění u akce v oddílech 6–8).
- NEOVĚŘENO proti živému Choice: že id v `locationPoints` rezervace
  jsou tatáž id jako `_id` míst z `/location` (dokumentace to neříká
  výslovně). Kdyby nebyla, u rezervací bude „N stolů bez názvu“
  a u napojení hláška „poslal Choice stůl, který v seznamu míst není“ —
  podle ní se to pozná hned po prvním načtení.
- Co dokumentace Choice neříká a Foodtab nedomýšlí: tvar `dateTime`
  (bere se jen okamžik s pásmem), jednotka `visitDuration` (konec se
  nevyplňuje), jednotka `deposit.amount` (jen stav zálohy), význam
  `digit` v odkazu (přiděluje ho Choice, proto se připojuje jen celým
  odkazem z Choice a `digit` se předá, jak přišel), jestli limit
  1 dotaz / 5 s platí na token, nebo na aplikaci (fronta je proto
  společná).
