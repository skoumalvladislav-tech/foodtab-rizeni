# Komunikace — stav a plán (27. 9. 2026)

Pro majitele. Zadání 27. 9.: „pokračuj v úpravách modu komunikace, udělej
rešerši, najdi zadání a uprav, aby to vše dávalo smysl."

**Z čeho to vychází:** všechna zadání ke Komunikaci od 1. 9. do 25. 9.
(dokumenty v `docs/`, zadání vložená do chatu 14.–23. 9. a vaše volby
v dotazech), kód na `main` (`adf1231`, PR #83) a ostrá databáze k 27. 9.
(jen čtení, nic se nezapisovalo).

**Jak číst sloupec „Co s tím":** **T1–T10** udělám teď v jednom PR
(oddíl 5), **O19–O28** je otázka pro vás (oddíl 6 a
`docs/hlaseni/otazky.md`), **P1–P22** je na později (oddíl 7).

---

## 0. Stav práce — 27. 9. večer, opraveno 28. 9. (větev `komunikace-doladeni`)

**Hotové je všech deset položek T1–T10**, 28. 9. opravené podle
nezávislých kontrol (oddíl 0.1). Nic se nepřesouvalo do „Později"
kromě dvou věcí, které potřebují změnu databáze navíc (P23, P24).
Nic není commitnuté ani nasazené — commit a PR udělá hlavní relace,
migraci nasazujete vy (`db push`).

| | Co je hotové | Čím je to ověřené |
|---|---|---|
| **T1** Čtení rozhovoru | Rozhovor se označí za přečtený po zobrazení (klientská součástka `oznacit-po-zobrazeni.tsx`, ne při vykreslení na serveru) a po odeslání zprávy a hlasovky. (Nový rozhovor s první zprávou zápis nepotřebuje: vlastní zprávy se do nepřečtených nepočítají.) Dělítko „Nové zprávy" drží pozici z prvního vykreslení (vlákno je klientská komponenta, záložka v `useState`). Když nezbude nepřečtený rozhovor, vlastní „nový vzkaz" ve zvonečku dostane `read_at`. Tlačítko v panelu zmizelo. **Pojistka kanálů** v migraci `20260927100000_cteni_rozhovoru.sql` (`app.ucastnici_vypsani` v šesti funkcích). **Čas čtení a prvního otevření** (`precteno_do`, `pridan_kdy`) nepřečte přímým dotazem nikdo cizí (oddíl 10 migrace, 28. 9.). Detail rozhovoru čte seznam účastníků jen u osobního, mezi pobočkami a vedení, ne u kanálu. | Scénář `krok62` (45 kontrol), každá podmínka rozbitá zvlášť; oddíl 8 i s výchozími právy Supabase jako v ostré databázi; textová kontrola grantu v `komunikace.test.mjs`; `komunikace-akce.test.mjs` |
| **T2** Zvoneček | Vlastní ikona zvonku. Panel ukazuje „Nepřečtené zprávy: N" (28. 9.: číslo je součet zpráv, ne rozhovorů) a „Nová oznámení: N", položka je formulář: označí přečtené a otevře věc (cíl z uloženého řádku, `lib/upozorneni-odkaz.ts`, akce `upozorneni/otevrit.ts`). Sloučené „3 nové zprávy" vedou na nepřečtené, ne do rozhovoru poslední zprávy. Nepotvrzená změna směny se klepnutím za přečtenou neoznačí. „Označit vše za přečtené" a odkaz na Nastavení upozornění. | `upozorneni.test.mjs` (cíl pro každý druh, podvržené hodnoty), `komunikace-akce.test.mjs` (akce i panel), `nabidka.test.mjs` (ikona v liště) |
| **T3** Vzkaz vedení a nový rozhovor | „Napsat vedení" má povinné pole Zpráva, vzkaz se bez ní nezaloží a zpráva odejde hned s klientským id. Klientské id chrání jen zprávu uvnitř jednoho rozhovoru; proti dvojímu odeslání celého formuláře (druhý rozhovor) chrání jen tlačítko v prohlížeči (P23). Délka zprávy se ověří dřív, než rozhovor vznikne. Při chybě do rozhovoru s hláškou, text v adrese není. „Nový rozhovor" má nepovinnou první zprávu. Formulář vedení je sbalený pod tlačítkem (`formular-vedeni.tsx`). | `komunikace-akce.test.mjs` (akce s podstrčenou databází, vykreslený formulář) |
| **T4** Jedna hlavička a čísla | Všechny stránky pod „Vzkazy a úkoly" mají nadpisek „Vzkazy a úkoly" a nadpis = záložka nebo věc. Čísla a skryté záložky počítá jedna funkce `nactiZalozky` a posílá ji všech 7 stránek. Úkoly se čtou jako „otevřené". Nástěnka se počítá týmž dotazem jako seznam (i ve zvonečku). Záložka Nástěnka jen s `communication.read`. `COMMUNICATION_ARCHITECTURE.md` opravený. | `komunikace.test.mjs`, `komunikace-akce.test.mjs` |
| **T5** Názvy a pravdivé texty | „+ Nový rozhovor", „Nové oznámení", „O rozhovoru", „Zrušit zprávu" s potvrzením, věta o telefonu podle čtenáře (majitel kdykoli), Nastavení → Firma už neslibuje „i mimo pracovní dobu", pravdivý prázdný seznam (28. 9.: jen o tlačítkách kanálů, která nahoře opravdu jsou, a bez „Všechno přečtené"), věta pod psaním jen těm, kdo upozornění do telefonu mají, a bez klíčů VAPID nic o telefonu, „Z tohoto rozhovoru" místo „konverzace", pryč věta o jazykovém modelu, „Přepis na text není dostupný" a mrtvé rámečky „čeká na nasazení". Na Dnes „Nový vzkaz pro vedení" / „Nová zpráva z vedení" podle toho, kdo vzkaz založil; „Přidat úkol" jen s `tasks.manage`. | `komunikace.test.mjs`, `komunikace-akce.test.mjs` |
| **T6** Nástěnka | České hlášky místo ticha (chybí adresát, databáze odmítne, člověk bez účtu), „Odeslat" proti dvojkliku, výběr adresáta je klientská komponenta (žádný vložený skript). **Po chybě zůstane formulář, jak byl** (28. 9.; do té doby ho React vrátil a osobní oznámení mohlo odejít celé firmě), server odmítne rozpor „Celá firma + vybraný člověk". „Konkrétní člověk" jen s účtem a s právem Nástěnku číst. „Čeká na vaše potvrzení" a číslo u záložky a ve zvonečku jen u oznámení **pro mě** (ne vlastní, ne cizí úsek; stejná pravidla jako upozornění). Pořadí podle zadání (`lib/komunikace/nastenka.ts`), karty `.ds-plocha` a ikony. Akce v `vzkazy/akce-nastenka.ts`, obnovují `/vzkazy`. | `komunikace.test.mjs` (pořadí, „pro mě"), `komunikace-akce.test.mjs`, snímky a zkouška v prohlížeči (oddíl 0.1) |
| **T7** Rozhovor na telefonu | Nad vláknem na telefonu není nadpis ani záložky, nahoře „← Komunikace" a název. Hlasovka a příloha jsou dvě ikony v řádku psaní (`psani.tsx`), rozbalí se po klepnutí. Panely jsou sbalené pod „Podrobnosti rozhovoru" (bez JavaScriptu). Emoji pryč. | snímky 375 / 1280 / 1536, světle i tmavě; `komunikace-akce.test.mjs` |
| **T8** Nastavení upozornění | Položka „Upozornění" v Nastavení (každý, ikona zvonku, za Mými údaji), odkaz i ze zvonečku. Obrazovka v kartách, ikona zámku místo 🔒, pravdivá věta u zamčených řádků. | `nabidka.test.mjs`, `komunikace-akce.test.mjs` |
| **T9** Oznámení jen se čtením Nástěnky | Trigger `app.upozornit_na_oznameni_trg` posílá upozornění jen lidem s `communication.read` (`app.ma_pravo_clovek`). Totéž od 28. 9. „Nepotvrdili: …" (`public.kdo_nepotvrdil`) a výběr „Konkrétní člověk" (nová `public.ctenari_nastenky`). Poznámka k tabulce `announcements`. | `krok62` oddíly 7 a 9 (rozbití spadlo); `krok36`, `krok42` a `krok43` dostaly lidem právo, aby dál měřily adresování a rozsah, ne právo |
| **T10** Úkoly a drobnosti | Pravdivý prázdný stav a věta ve formuláři, „Zadat úkol" a „Hotovo" proti dvojkliku, hledání rozhovorů s popiskem, filtry s `aria-current`. | `komunikace-akce.test.mjs` |

### 0.1 Oprava 28. 9. po nezávislých kontrolách

Nezávislé kontroly 28. 9. našly jednu kritickou vadu, šest důležitých
a osm drobných (některé se překrývají). Opravené jsou všechny; ze dvou
drobných zůstala část, která potřebuje další změnu databáze nebo
souboru jiné úlohy (P23, P24 v oddílu 7). Každá nová kontrola je
ověřená rozbitím (níž).

**Kritické — osobní oznámení mohlo odejít celé firmě (T6).** React 19
po každé akci formuláře sám vrátí pole do výchozího stavu, i po chybě.
„Komu" pak ukázalo „Celá firma", druhý výběr (člověk) zůstal na
obrazovce a zaškrtávátka zmizela. Vedoucí vybral Petru, odeslal —
a „Petro, přijď si pro smlouvu" dostala celá firma. Teď formulář
odesílá tak, že ho React nevrací (`onSubmit` s `preventDefault`),
všechna pole jsou řízená a server odmítne rozpor „Celá firma + vybraný
člověk". **Ověřeno v prohlížeči** (náhled s daty v props, headless
Chrome): po chybě zůstal „Konkrétní člověk…", druhý výběr, obě
zaškrtávátka i text, tlačítko se během odesílání zamklo („Odesílá
se…") a další odeslání by šlo s `komu_typ=clovek`.

**Důležité:**
- **Čas čtení a prvního otevření (T1).** V ostré databázi má
  `authenticated` na `konverzace_ucastnici` tabulkové `select` (výchozí
  práva Supabase), takže sloupcový grant z 3. 9. neplatil. Oddíl 10
  migrace ho odebere a vrátí sloupcový grant bez `precteno_do` **i bez
  `pridan_kdy`** (u kanálu vzniká řádek prvním čtením, `pridan_kdy` je
  tedy čas prvního otevření kanálu a četl by ho celý úsek). Nic
  `pridan_kdy` přímo nečte. Detail rozhovoru navíc čte seznam účastníků
  jen u osobního, mezi pobočkami a vedení — u kanálu by jinak šla jména
  lidí, kteří si kanál jen otevřeli, do prohlížeče. Hlídá to krok62
  oddíl 8 a textová kontrola grantu v `komunikace.test.mjs`
  (komentář v migraci ji dřív sliboval, ale neexistovala).
- **Nástěnka „pro mě" (T6).** Štítek „Čeká na vaše potvrzení", místo
  nahoře a číslo u záložky a ve zvonečku se počítaly ze všeho, co pustí
  RLS: majitel měl nahoře vlastní oznámení, vedoucí baru oznámení pro
  kuchyni. Teď jen oznámení pro mě podle stejných pravidel jako
  upozornění a „Nepotvrdili" (`jeProMe` v `lib/komunikace/nastenka.ts`).
  Ostatní se ukážou bez štítku a bez tlačítka. Jestli má oznámení
  pobočky potvrzovat i ten, kdo tam jen vypomáhá, je otázka 38
  (přečíslováno z 29 — to už po sloučení PR #86 zabrala docházka).
- **Čtenáři Nástěnky (T9).** „Nepotvrdili: …" (`kdo_nepotvrdil`,
  oddíl 11) a „Konkrétní člověk" (nová `ctenari_nastenky`, oddíl 12)
  berou jen lidi s `communication.read`. Akce odmítne člověka bez práva
  českou hláškou. Bez migrace se formulář chová jako dosud.
- **Zvoneček (T2).** „Nepřečtené zprávy: N" místo „rozhovory" — číslo
  je součet zpráv.

**Drobné:** délka zprávy se ověří dřív, než vznikne vzkaz vedení nebo
rozhovor; znění „dvojí odeslání nezdvojí" opravené (P23); sloučené
„3 nové zprávy" vedou na nepřečtené; nepotvrzená změna směny se
klepnutím nepřečte (kotva ke kartě je P24); prázdný seznam rozhovorů
mluví jen o tlačítkách, která nahoře jsou, a nepíše „Všechno přečtené";
věta pod psaním slibuje telefon jen těm, kdo ho mají zapnutý, a bez
klíčů VAPID o telefonu mlčí; „Z tohoto rozhovoru" místo „konverzace".

**Rozbití (každé zvlášť, soubor se pak vrátil):**
- Scénář krok62 (PGlite): oddíl 10 pryč → spadl oddíl 8 „pridan_kdy";
  grant s `pridan_kdy` / s `precteno_do` → spadl; totéž s vyndanou
  kontrolou katalogu práv → spadl přímý dotaz Zdeňka pod rolí
  `authenticated`; grant bez `odesel_kdy` → spadla kladná kontrola
  detailu; `kdo_nepotvrdil` bez práva čtení → spadl oddíl 9;
  `ctenari_nastenky` bez práva čtení / bez kontroly
  `communication.manage` → spadl. **S výchozími právy Supabase jako
  v ostré databázi** (tři řádky `alter default privileges` v harnessu):
  bez oddílu 10 spadla kontrola tabulkového práva, s ním celý krok62
  prošel.
- Testy aplikace: 23 rozbití (formulář bez `preventDefault`, neřízené
  zaškrtávátko, akce bez kontroly rozporu / bez práva čtení / ignorující
  chybu ověření, číslo Nástěnky bez „pro mě", `jeProMe` bez autora a bez
  přednosti úseku, karta bez „pro mě", zvoneček „rozhovory", sloučený
  vzkaz do rozhovoru, nepotvrzená směna se označí, obě kontroly délky,
  prázdný seznam, „Všechno přečtené", detail čte účastníky kanálu, věta
  bez VAPID, „konverzace", migrace bez revoke a s `pridan_kdy`, Nástěnka
  nabízí nečtenáře) — každé shodilo svou kontrolu.

**Testy 28. 9. (konečný stav):** `tsc` bez chyb, `eslint` na změněné
soubory bez chyb; `komunikace.test.mjs` 247 OK, `komunikace-akce.test.mjs`
148 OK, `upozorneni.test.mjs` 127 OK, `nabidka.test.mjs` 92 OK; celá sada
PGlite jednou na konci: 2363 kontrol, žádný scénář nespadl (krok62 45,
krok43 72, krok22 39). Proti opravdovému PostgreSQL (`run.sh`, workflow
Databáze) to na tomhle stroji pustit nejde — rozhoduje CI.

**Snímky 28. 9.** (náhled s daty v props, headless Chrome, 1280 a 375,
světle i tmavě): Nástěnka (vlastní a cizí oznámení bez štítku
a tlačítka, „Nepotvrdili" zůstává), zvoneček („Nepřečtené zprávy: 6"),
detail rozhovoru (věta pod psaním bez klíčů VAPID), prázdný seznam
na pobočce a na úrovni firmy, formulář Nástěnky po chybě.

**Stejná vada sloupcových grantů** je v ostré databázi i u dalších
tabulek (mj. `employee_pins`: sůl a otisk PINu čte každý
s `attendance.manage`) — samostatná úloha, souběžná větev
`granty-authenticated-sloupce` ji řeší; `konverzace_ucastnici` vědomě
nechává této migraci.

**Pořadí nasazení hlídá databáze.** Aplikace zapisuje čtení novou
funkcí `public.precist_rozhovor`, která vzniká touž migrací jako
pojistka. Když se PR sloučí dřív, než pustíte `db push`, aplikace čtení
prostě nezapisuje (jako dnes) a nikoho do kanálu natrvalo nezapíše.

**Soubor jiné úlohy:** `app/[rozsah]/layout.tsx` — jen předání tří čísel
do zvonečku a počet Nástěnky týmž dotazem jako seznam (nahrazené dva
dotazy jedním). `components/shell/ZivaAktualizace.tsx` ani
`app/[rozsah]/upozorneni/page.tsx` se neměnily. Oprava 28. 9. soubory
jiných úloh nezměnila vůbec (počet Nástěnky „pro mě" je uvnitř
`neprectenaNastenka`, `layout.tsx` ji volá beze změny).

**Co neproběhlo:** T6 chtělo nejdřív snímkem ověřit, že se vložený skript
výběru adresáta po přechodu záložkou nespustí. Snímek přihlášené aplikace
tu udělat nejde (do ostré databáze se nezapisuje, přihlášení není),
takže se to opírá o známé chování Reactu (skript vložený přes
`dangerouslySetInnerHTML` se při klientské navigaci nespouští). Nová
komponenta je ověřená snímkem po klientském výběru „Úsek…".

---

## 1. Krátce

- **Základ stojí.** Rozhovory, kanály pobočky a úseku, vzkaz vedení,
  Nástěnka, hlasovky, přílohy a upozornění do telefonu. Do telefonu se
  opravdu doručuje: 7× odesláno, naposledy 26. 9. Zprávy vyruší až po
  příchodu na směnu, majitele kdykoli.
- **Jedna vada kazí skoro všechno, co je vidět: rozhovor se nikdy
  neoznačí za přečtený.** Otevření ani odpověď nic nezapíše. Jediné
  tlačítko je schované v bočním panelu a za tři týdny ho nikdo nepoužil
  (0 ze 42). Čísla ve zvonečku, na spodní liště, na Dnes i u záložky
  proto jen rostou a vlákno se otevírá u nejstarší zprávy místo u konce.
- **Než se čtení opraví, musí se zavřít jedna past.** Přečtení kanálu
  pobočky nebo úseku by člověka do kanálu zapsalo natrvalo. Kdo by pak
  přešel do jiného úseku, četl by starý kanál dál a chodila by mu z něj
  upozornění. Dnes se to nestalo ani jednou (0 takových záznamů), ale
  jakmile se čtení začne zapisovat, stalo by se to každému.
- **Druhý problém je zmatek v názvech a cestách.** Jedna věc se jmenuje
  Vzkazy, Komunikace, Zprávy, Rozhovory i Konverzace. Nástěnka má
  formulář „Nová zpráva". Zvoneček má stejnou ikonu (bublinu) jako Vzkazy
  a jeho číslo nesedí s tím, co v něm po otevření je.
- **Teď udělám 10 věcí v jednom PR** (oddíl 5). **Deset rozhodnutí
  patří vám.** Zapsal jsem je jako otázky 19–28 do
  `docs/hlaseni/otazky.md` (18 přibývá v souběžné větvi). Do vašeho
  rozhodnutí platí u každé otázky nejopatrnější varianta a je u ní
  napsaná.

---

## 2. Co se v ostrém provozu opravdu používá (27. 9.)

| Část | Stav v datech | Co z toho plyne |
|---|---|---|
| Rozhovory | 24 rozhovorů, všechny založil majitel: 14 vzkazů vedení, 7 osobních, 2 kanály pobočky, 1 kanál úseku | Zatím testovací provoz |
| Zprávy | 19 zpráv (18 od majitele, 1 od zaměstnance). 8 naléhavých, 4 hlasovky, 0 příloh. Poslední 27. 9. v kanálu úseku | Vzkazy se používají, zbytek skoro ne |
| Vzkazy vedení | 11 ze 14 nemá jedinou zprávu. Jeden vznikl dvakrát ve stejné vteřině (dvojklik 23. 9.) | Formulář zakládá prázdný rozhovor (T3) |
| Přečtení rozhovoru | 0 ze 42 záznamů | Počty nepřečtených nikdy neklesnou (T1) |
| Nástěnka | 4 oznámení, žádné připnuté ani s potvrzením | Skoro nepoužitá |
| Úkoly | 1 úkol, hotový. Ze zprávy 0, z checklistu 0 | Obrazovka Úkoly je pro všechny prázdná |
| Checklisty | 14 běhů, z toho 13 „otevřených" od 27. 8. | Staré běhy visí navždy (P14) |
| Upozornění | 118 upozornění, přečtených 11. Majitelé mají ve zvonečku 40 a 36 nepřečtených, naposledy četli 3. a 6. 9. | Zvoneček se fakticky nečte (T2) |
| Telefon | Upozornění do telefonu mají zapnutá 3 lidé, 7× doručeno | Push funguje. Hlášení z 23. a 24. 9., že „nikdy nedoručil", je zastaralé |

**Závěr:** Komunikaci zatím používá hlavně majitel. Teď je dobrá chvíle
srovnat základ (čtení, názvy, zvoneček), dřív než ji začnou používat
zaměstnanci a zvyknou si na čísla, která nic neznamenají.

---

## 3. Zadání → stav

**Stav:** **Hotovo** · **Napůl** · **Chybí** · **Rozpor** (aplikace dělá
něco jiného, než stojí v zadání) · **Čeká na vás** · **Odloženo** /
**Překonáno** (pozdější pokyn to nahradil).

### 3.1 Kdy zprávy vyruší (doručení a směna)

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Vzkazy pracovníkům vyruší až po píchnutí příchodu. Mimo směnu se nic neozve, zpráva počká | 3. 9. `komunikace-zadani.md`; upřesněno 17. 9. (vaše poznámka k Vzkazům 2.0) | **Hotovo.** Ve zvonečku je zpráva hned, na telefon počká do příchodu | Nic. Věta z 3. 9. „žádný zvoneček" je nahrazená pozdějším výkladem (R4) |
| Mimo směnu si zprávu přečíst smím. Nahoře krátce „Čekají na vás N zpráv" | 3. 9.; 17. 9. | **Hotovo** | Nic |
| „Na směně" = otevřený příchod v docházce, ne „je přihlášený" | 3. 9. | **Hotovo** | Neměnit |
| Zapomenutý odchod nedrží člověka ve službě | 6. 9. (vaše rozhodnutí) | **Hotovo** | Nic |
| Kdo dělá na víc pobočkách, dostane zprávy té, kde píchl | 3. 9. | **Napůl.** Upozornění z kanálu pobočky jde podle domovské pobočky. 4 lidé s účtem domovskou pobočku nemají (i majitel), takže z kanálu nedostanou nic | P5 |
| Po příchodu jedno souhrnné „Čekají na vás N zpráv", přečtené se nepřipomíná | 20. 9. | **Hotovo** | Nic |
| Majiteli chodí všechna upozornění kdykoli | 22. 9. (vaše rozhodnutí) | **Hotovo.** Věta pod rozhovorem ale všem píše „chodí jen během směny" | T5 |
| Čekající upozornění na telefon po 48 h propadne (zůstane ve zvonečku) | 21. 9. (moje pravidlo, nikdy jste ho neschválil) | **Hotovo** | O21 |

### 3.2 Naléhavé zprávy a priorita

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Naléhavá zpráva obchází čekání na směnu. Smí jen ten, kdo na to má právo. Je vidět, že je naléhavá, a jde do záznamu (bez textu) | 3. 9.; 16. 9. | **Hotovo** | Nic |
| Před odesláním naléhavé zprávy potvrzení „upozorní i mimo směnu" | 20. 9. | **Hotovo** | Nic |
| Priorita řídí doručení. „Důležitá" může pípnout i mimo směnu podle pravidla firmy | 16.–17. 9.; Směny 2.0 (19. 9.) | **Rozpor.** Důležitá čeká na směnu jako běžná. Nastavení → Firma přitom slibuje, že „se dostane k člověku i mimo pracovní dobu" | T5 (text říká pravdu), O20 |
| Strop na počet naléhavých zpráv, v záznamu i „proč" | 16.–17. 9. | **Chybí**, nikdo to nezrušil | O23, pak P19 |
| Priorita v nabídce „•••", ne jako trvalé tlačítko | 16.–17. 9. | **Napůl.** Výběr priority je v psaní, naléhavá jen s právem | Nechávám, funguje |
| Kritická priorita jen u úkolu z problému v checklistu | 23. 9. (vaše volba) | **Hotovo** | Nic |
| Při slučování upozornění platí poslední priorita, naléhavé se neztratí | 21. 9. (moje) | **Hotovo** | Neměnit |

### 3.3 Rozhovory

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Nástěnka (tohle vědí všichni) a rozhovor (odpovídá se) jsou dvě různé věci | 3. 9.; 16. 9. | **Hotovo** | Nic |
| Druhy: osobní, pobočka, mezi pobočkami, vedení, úsek | 3. 9.; 17. 9. | **Hotovo.** „Celá firma" jen přes Nástěnku | Nic |
| Kanál pobočky a úseku vznikne sám podle toho, kam člověk patří | 5. 9. | **Hotovo.** Ale přečtení kanálu by člověka zapsalo natrvalo (oddíl 1) | T1 |
| Kanál úseku; navíc úsek ↔ úsek („Kuchyně → Obsluha") | 17. 9. | **Napůl.** Úsek ↔ úsek chybí | P7 |
| Kanál pozice („všichni číšníci") | 5. 9. | **Odloženo** 6. 9. (až si ho někdo vyžádá) | Nic (R9) |
| Kdo smí komu psát, samostatná práva na druhy zpráv | 16.–17. 9. | **Čeká na vás.** Dnes každý komukoli ve firmě | O22 |
| Kdo není účastník, nepřečte nic, ani majitel | 3. 9. | **Hotovo** | T1 hlídá, aby to platilo i po přečtení kanálu |
| Smazání zprávy je zrušení se stopou, ne výmaz | 3. 9. | **Hotovo.** Tlačítko se ale jmenuje „Stáhnout" a čte se jako stažení souboru | T5 |
| Uzavřít rozhovor (zavřený jde číst, ne psát) | 9. 9., jen v neuložené verzi dokumentu | **Chybí.** Aplikace umí zavřený rozhovor jen ukázat | P18, jen pokud ho chcete |
| Výběr příjemců, víc lidí; skupina s vlastním názvem | 16.–17. 9. | **Napůl.** Skupiny s názvem chybí | P7 |
| Druhý rozhovor se stejným člověkem otevře ten první | nález 22. 9. | **Chybí** | P6 |
| Hledání ve zprávách, starší zprávy | 16.–17. 9. | **Napůl.** Hledá se jen v názvech rozhovorů, vlákno ukáže posledních 200 zpráv | P8 |
| Rozvržení: počítač tři sloupce, telefon seznam → celoobrazovkový rozhovor | 16.–20. 9. | **Hotovo.** Telefon je ale přeplněný | T3, T7 |
| Zpráva → úkol, vznikne až po potvrzení | 16.–20. 9. | **Hotovo** (bez AI). Nikdo zatím nepoužil. Ukazuje vývojářskou větu o jazykovém modelu | T5 |
| Diskuse u úkolu | 20. 9. | **Chybí** | P3 |
| Nové zprávy naživo, odeslání po výpadku | 16.–20. 9. | **Napůl** | Živé obnovení zvonečku opravuje jiná relace |

### 3.4 Vzkaz vedení

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Adresát „vedoucí pobočky" nebo „majitel". Nikdo jiný nečte | 3. 9.; 16.–17. 9. | **Hotovo** | Nic |
| Vzkaz není anonymní. Před psaním je napsané jménem, kdo ho uvidí | 3. 9.; 6. 9. | **Hotovo** („Uvidí: …") | Nic |
| Kdo je na víc pobočkách, vybere pobočku | 6. 9. (s vaším vědomím) | **Hotovo** | Nic |
| *(nález)* Vzkaz vedení vznikne prázdný, vedení se nic nedoručí, dokud autor nenapíše ještě zprávu | ostrá data: 11 ze 14 prázdných | **Nedává smysl** | T3 |

### 3.5 Nástěnka

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Na Nástěnku patří pokyny, řády, akce, fotky z provozu. Osobní dokumenty lidí ne, a zapsat to k tabulce | 6. 9. (vaše volba) | **Napůl.** Poznámka u tabulky chybí | T9 |
| V rozhraní „Úsek", slovo „středisko" se nepoužívá | 6. 9. (vaše rozhodnutí) | **Hotovo** | Nic |
| Adresát oznámení: celá firma / pobočka / úsek / pozice / člověk | 6. 9.; 8. 9. | **Hotovo** | T6 (výběr adresáta spolehlivě) |
| Dokumenty a fotky na Nástěnce (soukromé úložiště, pdf/jpg/png/heic, 10 MB, 5 souborů) | 6. 9. („hlavní důvod, proč Nástěnka existuje") | **Chybí** | P1 |
| „Beru na vědomí": vedoucí vidí jména nepotvrzených, **nepotvrzené zůstávají nahoře od nejstaršího** | 5., 6. a 8. 9. | **Napůl.** Pořadí je obráceně (připnuté, pak od nejnovějšího) | T6 |
| Přehled „12 / 15 potvrzeno" se stavem a časem u každého | 17. 9. | **Napůl.** Jen jména nepotvrzených | P2 |
| Platnost od/do, priorita, příloha | 16.–17. 9. | **Chybí** | P1 |
| Před odesláním oznámení vidět, kdo ho uvidí | 8. 9. | **Napůl.** U vzkazu vedení ano, u Nástěnky ne | P2 |
| Psát na Nástěnku smí jen ten, kdo na to má právo | 31. 8. | **Hotovo** | Nic |
| *(nález)* Oznámení nejde upravit, zrušit ani odepnout | — | **Chybí** | P2 |
| *(nález)* Chyba při odeslání oznámení se nikde neukáže, formulář „nic neudělá" | — | **Nedává smysl** | T6 |

### 3.6 Vchod, názvy a nabídka

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Jeden vchod na zprávy, jedno číslo nepřečtených | 6. 9. (vaše rozhodnutí) | **Hotovo.** Číslo ale nikdy neklesne | T1 |
| Otázka 4: „Vzkazy", nebo „Zprávy"? | 6. 9. | **Překonáno** 23. 9. pokynem „Vzkazy a úkoly" | V `otazky.md` označeno |
| Sloučit Provozní centrum a Úkoly a checklisty do „Vzkazy a úkoly", nahoře „Komunikace · Úkoly · Checklisty · Nástěnka" | 23. 9. (váš pokyn a zadání Checklisty 2.0: „nahoře zachovej") | **Hotovo.** Hlavička a čísla se ale mezi záložkami liší | T4 |
| Vzkazy na spodní liště telefonu | 8. 9.; 19. 9. | **Hotovo** | Nic |
| Checklisty pod „Vzkazy a úkoly", žádná nová položka | 23. 9. (vaše volba) | **Hotovo** | Nic |
| Nastavení upozornění najít v Nastavení („v nastavení není okénko upozornění") | 22. 9. (vaše výtka) | **Chybí.** Dostanete se tam jen ze stránky Upozornění | T8 |

### 3.7 Upozornění a zvoneček

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Zvoneček s počtem, seznam, označení za přečtené. Záznam vznikne vždy | 1. 9.; 16. 9. | **Hotovo.** Ikona je ale bublina jako Vzkazy a číslo nesedí s panelem | T2 |
| Každý vidí jen svá upozornění, i majitel | 1. 9. | **Hotovo** | Nic |
| Upozornění je odkaz na věc, ne opis. Na telefon nikdy text zprávy, jméno ani částka | 8. 9.; PR #83 | **Hotovo** | Nic |
| Kdo změnu udělal, upozornění nedostane | 1. 9. | **Hotovo** | Nic |
| Slučovat, nezaplavovat | 8. 9.; 21. 9. | **Hotovo** | Nic |
| Upozornění na směny, vzkazy, oznámení, úkoly, checklisty, zálohy | 8.–23. 9. | **Napůl.** Chybí úkol po termínu a přeřazení úkolu | P3, P10 |
| Všechna upozornění jedním místem v aplikaci | 16. 9.; 20. 9. | **Napůl.** Vydání rozpisu, pozvánky, docházka, PIN, marketing jdou po staru | P10 |
| Panel ze zvonečku, každé upozornění vede přímo na věc | 16.–17. 9. | **Napůl.** Položky panelu vedou jen na obecnou stránku Upozornění | T2, P13 |
| Karta „Změna směny: původně → nově" s potvrzením | 16.–20. 9. | **Hotovo** | Nic |
| Potvrzení změny směny zaměstnancem | 16. 9.; 20. 9. (vaše volba) | **Hotovo** | Nic |
| Naléhavost změny směny podle času do směny jako nastavení firmy | 16.–19. 9. | **Napůl.** Nastavení je, ale „důležitá" mimo směnu nepípne | O20 |
| Upozornění na směny **až při vydání rozpisu**, ne při každé úpravě | 1. 9. (vaše zadání); 8. 9. | **Rozpor.** Upozornění odchází už při uložení nevydané směny a při vydání přijde ještě souhrn | O19 |
| Přijetí pozvánky | 2. 9. | **Hotovo** | Nic |
| Zapomenutý odchod | 2. 9. | **Hotovo.** Plánovač běží nespolehlivě | Otázka 13 |
| Zálohy k potvrzení | 25. 9. | **Hotovo** | Otázka 17 |
| Dnes: nepřečtené vzkazy, poslední vzkazy, úkoly. V přehledu majitele i „naléhavý vzkaz nebyl přečten" | 14. 9.; 16. 9.; 23. 9. | **Napůl.** Dnes u majitele píše „Nová zpráva z vedení" u vzkazů, které jsou PRO vedení. „Přidat úkol" vede 8 z 10 lidí na stránku bez formuláře | T5, P11 |

### 3.8 Kanály (telefon, e-mail)

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Pořadí kanálů: aplikace → e-mail → telefon, SMS ne | 1. 9.; 16.–17. 9. | **Napůl.** Telefon ano, e-mail jako upozornění ne | O27 |
| E-mail jen naléhavé, souhrn max. 1× za hodinu, v noci ticho | 8. 9. | **Odloženo** | O27 |
| Nepsat, že chodí upozornění do telefonu, dokud prokazatelně nedoručí | 3.–9. 9. | **Překonáno.** Push doručuje (7×, naposledy 26. 9.) | T5 (věta pravdivě) |
| Upozornění do telefonu hned po odeslání zprávy | 23. 9. (vaše rozhodnutí) | **Hotovo.** Ostatní upozornění jdou plánovačem | Nic |
| Noční klid podle hodin (např. 22–7) | 1. 9.; 16.–17. 9. | **Čeká na vás.** Aplikace řídí klid jen směnou | O21 |
| Odhlášení na sdíleném telefonu a upozornění | nález 22. 9. | **Čeká na vás** | O24 |

### 3.9 Nastavení upozornění

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Člověk si vybere, co chce dostávat: směny (nejdou vypnout), vzkazy a nástěnka, úkoly, e-mail | 8. 9.; 16.–17. 9. | **Napůl.** Vypnout jdou jen vzkazy a nástěnka. Úkoly, checklisty, zálohy, zapomenutý odchod ne | O27, T8 (aby se nastavení dalo najít) |

### 3.10 Hlas a přílohy

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Pole na zprávu unese diktování z klávesnice | 8. 9. | **Hotovo** | Nic |
| Hlasová zpráva (nahrát, přehrát, smazat před odesláním) | 16.–20. 9. | **Hotovo.** V tlačítku je emoji | T7 |
| Automatický přepis hlasovky na text | 16.–20. 9. | **Pozastaveno** vaší volbou 17. 9. („zatím bez AI přepisu"). U každé hlasovky se píše „Přepis na text není dostupný" | T5 (věta pryč), O28 |
| Přílohy (fotky, PDF) ke zprávám | 20. 9. (nahradilo zákaz z 3.–9. 9.) | **Hotovo**, bez fotek z iPhonu (heic). Nikdo zatím nepoužil | P22 |

### 3.11 Úkoly a checklisty (jen to, co se týká Komunikace)

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Úkol: komu, kdy, co | 5. 9. | **Hotovo** | Nic |
| Jmenovitý úkol je štítek, ne zámek | 6. 9. (s vaším vědomím) | **Hotovo.** Formulář ale pořád píše opak („smí splnit jen on sám nebo vedoucí, chystá se změna") | T10 |
| Úkol po termínu nezmizí | 5. 9. | **Hotovo** | Nic |
| Checklist → problém → úkol | 20. 9.; 23. 9. | **Hotovo** | Nic |
| Checklist v Komunikaci: sdílet do rozhovoru, událost po dokončení, odkaz | 23. 9. (Checklisty 2.0, bod 34; vaše volba „celé zadání") | **Chybí.** Hlášení z 23. 9. to v nesplněném neuvádí | P9 |
| Úkoly zadané „roli" po přechodu na zařazení | 9. 9. | **Čeká na vás** | Otázka 8 |

### 3.12 Tablet (kiosek)

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Tablet ukáže jen, že zprávy jsou (počet lidí, bez jmen). Obsah až po PINu, s odpočtem do zavření | 3.–6. 9. | **Chybí.** Existuje jen v databázi, obrazovka tabletu zprávy nemá | O26 |
| Poznámka ke směně se ukáže při píchnutí | 5. 9. | **Chybí** | P12 |

### 3.13 Bezpečnost a AI

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Nic z komunikace do jazykového modelu (ani shrnutí, ani přílohy) | 3. 9.; pravidlo 8 | **Hotovo** (dodrženo). Návrh úkolu je pravidlový, bez modelu | O28 |
| Pravidla firmy a modulů platí i při přímém volání databáze | 3. 9. | **Hotovo** | Nic |
| Jak dlouho se zprávy uchovávají | 3. 9. | **Čeká na vás** | O25 |

### 3.14 Vzhled a testy

| Zadání | Zdroj | Stav | Co s tím |
|---|---|---|---|
| Mockup Dnes z 19. 9. je závazný styl všech oken (patkové nadpisy, karty, sdílené ikony, žádné emoji) | 19. 9. (vaše pravidlo) | **Napůl.** Nástěnka, Úkoly, Upozornění a Nastavení upozornění mají vlastní rámečky, emoji a „✓" | T6, T7, T8; P20 |
| Komunikace podle vašeho obrázku z 22. 9. (4 sloupce, hlavička, avatary) | 22. 9. | **Hotovo** | Nic |
| Nevypadat jako WhatsApp, naléhavé jen decentně | 16.–17. 9. | **Hotovo** | Nic |
| Každou kontrolu schválně rozbít, záporné kontroly (cizí firma, cizí rozhovor) | 3. 9. | **Hotovo** | Pokračuje (T1, T9) |
| Zkoušky v přihlášené aplikaci v prohlížeči | 16.–20. 9. | **Chybí** | P16 |

---

## 4. Co v aplikaci nedává smysl

1. **Čtení se nikdy neoznačí.** Popsáno v oddílu 1. Tahle jedna vada
   kazí všechna počítadla. → **T1**
2. **Jedna zpráva má dva nezávislé „nepřečteno".** Rozhovor a upozornění
   „nový vzkaz" ve zvonečku se čtou zvlášť. Přečtení jednoho neoznačí
   druhé. → **T1**
3. **Zvoneček.** Má stejnou ikonu jako Vzkazy. Jeho číslo sčítá tři věci
   (upozornění, nepřečtené rozhovory, nástěnku), panel ukáže jen první.
   Položky vedou na obecnou stránku, ne na věc. U majitelů trvale „9+".
   → **T2**
4. **Prázdné vzkazy vedení.** „Založit vzkaz" založí jen název, text se
   píše až potom. Kdo po založení odejde, vedení nic nepošle. Dvojklik
   založí vzkaz dvakrát. → **T3**
5. **Pět jmen pro jednu věc.** Vzkazy, Komunikace, Zprávy, Rozhovory,
   Konverzace. Nástěnka je v kódu „zprávy", v aplikaci „Nová zpráva",
   v upozornění „oznámení". → **T5** (slovník v oddílu 9)
6. **Záložky jedné položky vypadají pokaždé jinak.** Jiný nadpis, jiný
   popis. Čísla u záložek se při přepínání objevují a mizí. U Úkolů je
   číslo „otevřené úkoly", ale čtečka pro nevidomé ho čte jako
   „nepřečtené". → **T4**
7. **Odkazy, které nikam nevedou.**
   - Záložku Nástěnka vidí i 2 lidé, kteří ji číst nesmí. Po kliknutí
     dostanou odmítnutí.
   - Upozornění „nové oznámení" chodí i jim.
   - Na Dnes „Přidat úkol" vede 8 z 10 lidí na stránku bez formuláře.
   - Upozornění do telefonu vždycky otevře úvodní stránku.

   → **T4, T5, T9**, P4
8. **„Stáhnout" u zprávy znamená zrušit zprávu.** Čte se ale jako
   stažení souboru, a to hned vedle hlasovek a příloh. Navíc bez
   potvrzení. → **T5**
9. **Vývojářské věty v aplikaci.**
   - „Návrh jazykovým modelem zapnutý není…"
   - „Přepis na text není dostupný." u každé hlasovky.
   - Rámečky „čeká na nasazení databáze", přitom je všech 138 změn
     databáze nasazených.

   → **T5**
10. **Sliby, které neplatí.**
    - Pod rozhovorem stojí „chodí jen během směny", ale majiteli
      a u naléhavých zpráv chodí kdykoli.
    - Nastavení → Firma slibuje, že důležitá změna směny „se dostane
      k člověku i mimo pracovní dobu". Nedostane.
    - Prázdný seznam rozhovorů tvrdí, že osobní rozhovor zakládá jen
      vedoucí. Dnes ho založí kdokoli.

    → **T5**
11. **Telefon.**
    - Na seznamu rozhovorů je před prvním rozhovorem 4× záložka,
      hledání, 5 filtrů, 3 tlačítka a celý formulář „Napsat vedení".
    - V rozhovoru nahoře zůstává velký nadpis a záložky.
    - Pod psaním jsou tři samostatné bloky (text, hlasovka, příloha).

    → **T3, T7**
12. **Nástěnka tiše selhává.** Když chybí adresát nebo databáze odmítne,
    nic se nestane a žádná hláška. Výběr adresáta se po přechodu
    záložkou pravděpodobně rozpadne (všechny čtyři výběry naráz; ověřím
    snímkem). → **T6**
13. **Nastavení upozornění je schované.** Najdete ho jen ze stránky
    Upozornění, ne z Nastavení. → **T8**

---

## 5. TEĎ — jeden PR, seřazeno podle užitku pro provoz

Pořadí je i pořadí práce. T1 obsahuje jedinou změnu databáze v tomhle PR
(společně s T9, jeden soubor). Ta přístup jen **zužuje**, žádná data se
nemažou ani nepřepisují.

### T1. Rozhovor se označí za přečtený, když ho otevřete (s pojistkou pro kanály)

**Co uvidíte:**
- Otevřete rozhovor a číslo u něj, ve zvonečku, na spodní liště, na
  Dnes i u záložky klesne.
- Vlákno se otevře u první nové zprávy, ne u nejstarší.
- Kdo odpoví, má rozhovor přečtený.
- Tlačítko „Označit za přečtené" v bočním panelu zmizí, už není potřeba.
- Upozornění „nový vzkaz" ve zvonečku se samo označí za přečtené,
  jakmile nemáte žádný nepřečtený rozhovor.

**Pojistka:** v kanálu pobočky nebo úseku se zapíše jen „kam jsem
dočetl", ne členství. Kdo z úseku odejde, kanál přestane vidět a
nechodí mu z něj upozornění. Přesně tak, jak to platí dnes. Pojistka
musí jít do stejného PR a nasadit se dřív než oprava čtení nebo spolu
s ní.

### T2. Zvoneček ukazuje, co počítá

- Vlastní ikona zvonku ze sdílené sady místo bubliny.
- V panelu nahoře řádky „Nepřečtené zprávy: N" (28. 9.: původně
  „rozhovory", ale číslo sčítá zprávy) a „Nová oznámení: N"
  (když nejsou nula) s odkazem, pod nimi upozornění. Číslo na zvonečku
  tak sedí s tím, co v panelu najdete.
- Klepnutí na upozornění ho označí za přečtené a otevře věc, ke které
  patří: směnu, zálohu, checklist, úkol nebo rozhovor. Dnes vede vždy
  na obecnou stránku.
- V panelu „Označit vše za přečtené" a odkaz „Nastavení upozornění".

### T3. Vzkaz vedení a nový rozhovor rovnou s první zprávou

- „Napsat vedení" má vedle „Čeho se to týká" i pole **Zpráva**. Vzkaz
  vznikne rovnou s textem a vedení dostane upozornění hned.
- „Nový rozhovor" nabídne pole pro první zprávu (nepovinné).
- Obě tlačítka jsou chráněná proti dvojkliku.
- Formulář „Napsat vedení" je na seznamu sbalený pod tlačítkem. Na
  telefonu nezabírá půl obrazovky.
- Existující prázdné vzkazy se nemažou.

### T4. Jedna hlavička a stejná čísla na všech záložkách

- Každá stránka pod „Vzkazy a úkoly" má nahoře malé „Vzkazy a úkoly"
  a velký nadpis záložky nebo věci (Komunikace, Úkoly, název rozhovoru,
  název úkolu). Checklisty si nechávají rozvržení z 23. 9.
- Čísla u záložek jsou stejná, ať stojíte na kterékoli záložce.
- Číslo u Úkolů se čte jako „otevřených", ne „nepřečtených".
- Číslo u Nástěnky počítá totéž, co seznam ukazuje (vaše pobočka
  a celá firma).
- Záložku Nástěnka uvidí jen ten, kdo ji smí číst, stejně jako Úkoly
  a Checklisty.
- Dokument architektury se opraví na dnešní čtyři záložky (dnes popisuje
  zrušené Provozní centrum s pěti).

### T5. Názvy a pravdivé texty

Podle slovníku v oddílu 9.

- **Nové názvy:**
  - „+ Nová zpráva" → „+ Nový rozhovor".
  - Na Nástěnce „Nová zpráva" → „Nové oznámení".
  - „O konverzaci" → „O rozhovoru".
- **Zrušení zprávy:** „Stáhnout" → „Zrušit zprávu" s potvrzením.
- **Věta o telefonu podle toho, kdo ji čte:**
  - majiteli: „chodí kdykoli";
  - ostatním: „během směny hned, naléhavé i mimo směnu, ostatní
    počkají na příchod".
- **Nastavení → Firma, „Důležité změny směn":** text řekne pravdu. Změna
  se označí jako důležitá, ale do telefonu mimo směnu zatím nepřijde,
  dokud nerozhodnete (O20). Chování se nemění.
- **Prázdný seznam rozhovorů:** pravdivý návod.
- **Pryč:** věta o jazykovém modelu, „Přepis na text není dostupný"
  u každé hlasovky a mrtvé rámečky „čeká na nasazení".
- **Dnes:**
  - „Nová zpráva z vedení" platí jen pro autora vzkazu, kterému vedení
    odpovědělo. Vedení (adresát) uvidí „Nový vzkaz pro vedení";
  - „Přidat úkol" jen tomu, kdo úkol opravdu zadat smí.

### T6. Nástěnka bez tichých chyb

- Když oznámení nejde odeslat, objeví se česká hláška. Týká se to
  chybějícího adresáta i chyby databáze.
- Tlačítko „Odeslat" je chráněné proti dvojkliku.
- Výběr adresáta funguje i po přechodu záložkou (bez vloženého skriptu).
- „Konkrétní člověk" nabízí jen lidi s účtem. Ostatní by oznámení nikdy
  neuviděli.
- **Pořadí podle zadání 5., 6. a 8. 9.:** nahoře nepotvrzená oznámení
  s „Beru na vědomí" od nejstaršího, pak připnutá, pak ostatní od
  nejnovějšího.
- Vzhled podle pravidla 19. 9.: karty jako na Dnes, ikona místo „✓".

### T7. Rozhovor na telefonu

- Na telefonu nad vláknem zmizí velký nadpis a záložky (jako
  v Checklistech). Nahoře zůstane „← Komunikace" a název rozhovoru.
- Hlasovka a příloha jsou dvě ikony vedle psaní, rozbalí se po klepnutí.
  Ne dva velké bloky pod sebou. Emoji 🎤 nahradí ikona ze sdílené sady.
- Panely „O rozhovoru" a „Úkoly a události" jsou na telefonu sbalené
  pod „Podrobnosti".
- Ověří se snímkem na 375 a 1536 px, světle i tmavě.

### T8. Nastavení upozornění najdete tam, kde ho hledáte

- Položka „Upozornění" v Nastavení (pro každého, stejně jako „Moje
  údaje") a odkaz z panelu zvonečku (T2). Odpovídá vaší výtce z 22. 9.
- Obrazovka ve vzhledu Dnes, bez emoji 🔒. U zamčeného řádku věta
  „Změny vašich směn chodí vždy, nejdou vypnout".
- Další kategorie (úkoly, zálohy…) až podle odpovědi na O27.

### T9. Upozornění na oznámení jen těm, kdo Nástěnku smí číst

- Upozornění „nové oznámení" a push dostane jen ten, kdo Nástěnku smí
  číst. Dnes ho dostanou i 2 lidé, kteří pak narazí na odmítnutí.
- K tabulce oznámení se zapíše, co na Nástěnku patří a co ne
  (osobní dokumenty ne; vaše volba 6. 9.).

### T10. Úkoly a drobnosti

- Úkoly:
  - Prázdný stav pravdivě („na této pobočce nejsou otevřené úkoly",
    ne „nemáte").
  - Zastaralá věta ve formuláři úkolu se nahradí tím, co dnes platí.
  - „Zadat úkol" a „Hotovo" jsou chráněné proti dvojkliku.
- Hledání rozhovorů dostane popisek pro čtečku. Filtry dostanou správné
  označení vybrané položky.

**Co se v PR NEmění:** Směny, docházka, zálohy, rozhodnutí z oddílu 8
a soubory souběžných úloh. Kde se jich T2 nutně dotkne, je to popsané
v oddílu 10.

---

## 6. PRO VÁS — rozhodnutí (otázky 19–29 v `docs/hlaseni/otazky.md`)

Do vašeho rozhodnutí platí sloupec „Co platí". U každé otázky
v `otazky.md` je i to, co se změní, když to má být jinak.

| # | Otázka | Co platí do rozhodnutí |
|---|---|---|
| **19** | Upozornění na změnu směny: hned při uložení, nebo až při vydání rozpisu? (1. 9. jste chtěl až při vydání) | Beze změny. Směny se bez důvodu nepřestavují |
| **20** | Má „důležitá změna směny" pípnout na telefon i mimo směnu? | Nepípne. Text v Nastavení se opraví, aby to neslibovalo (T5) |
| **21** | Noční klid podle hodin (např. 22–7) vedle vazby na směnu? A má čekající upozornění propadat po 48 h? | Jen vazba na směnu, 48 h platí |
| **22** | Kdo smí komu psát? (zaměstnanec ↔ zaměstnanec, pobočka ↔ pobočka) | Každý s účtem komukoli ve firmě |
| **23** | Naléhavé zprávy: strop za hodinu a povinné „proč"? | Bez stropu. Naléhavou smí jen ten, kdo má právo, a potvrzuje ji |
| **24** | Odhlášení na sdíleném telefonu má vypnout upozornění do toho telefonu? | Nevypne |
| **25** | Jak dlouho se zprávy uchovávají? | Neomezeně, nic se nemaže |
| **26** | Zprávy na tabletu (kiosku) po PINu: dostavět, nebo zatím vypnout nepoužitou část v databázi? | Zůstává, jak je. Nic ji nevolá, chrání ji PIN a klíč tabletu |
| **27** | Která upozornění smí člověk vypnout a chcete je i e-mailem? | Vypnout jdou vzkazy a nástěnka, e-mail ne |
| **28** | Jazykový model pro návrh úkolu ze zprávy a přepis hlasovek: ano, nebo ne, a kdo dodavatel? | Ne, návrh je pravidlový a přepis vypnutý |
| **29** | Oznámení pobočky: má ho potvrdit i ten, kdo tam jen vypomáhá (dosah), nebo jen ten, kdo ji má jako domovskou? (28. 9.) | Jen domovská pobočka, stejně pro upozornění, „Nepotvrdili", štítek i číslo |

Z dřívějška se Komunikace týkají otevřené otázky **8** (úkoly zadané
„roli"), **11**, **12** (checklisty), **13** (plánovač) a **17** (záloha
mimo směnu).

---

## 7. POZDĚJI (větší věci)

1. **P1 Dokumenty a fotky na Nástěnce.** Soukromé úložiště, odkaz na
   pár minut, pdf/jpg/png/heic, 10 MB, 5 souborů, zmenšené fotky, na
   tabletu až po PINu. K tomu platnost oznámení od/do. Podle 6. 9. je to
   „hlavní důvod, proč Nástěnka existuje".
2. **P2 Správa oznámení.** Upravit, zrušit, odepnout. Přehled
   „12 / 15 potvrzeno" se jmény a časy. Před odesláním „Uvidí: …".
3. **P3 Úkoly naplno.**
   - hotové úkoly a historie, filtr „moje";
   - jeden formulář místo tří (seznam, ze zprávy, z checklistu);
   - upozornění na úkol po termínu a na přeřazení;
   - diskuse u úkolu.
4. **P4 Upozornění do telefonu vede přímo na věc.** Dnes vede na úvodní
   stránku. K tomu „nový vzkaz" nese rozhovor a den pro slučování se
   počítá v čase pobočky. Potřebuje změnu databáze.
5. **P5 Upozornění z kanálu pobočky** jde podle toho, kdo kanál vidí,
   ne podle domovské pobočky. S tím souvisí zadání „zprávy té pobočky,
   kde píchl".
6. **P6 Druhý osobní rozhovor se stejným člověkem** otevře ten první.
7. **P7 Skupiny a úseky.** Skupiny s vlastním názvem, rozhovor úsek ↔
   úsek.
8. **P8 Hledání ve zprávách.** Hledat v textu zpráv a dostat se
   k zprávám starším než posledních 200.
9. **P9 Checklist v Komunikaci.** Sdílet checklist do rozhovoru,
   událost po dokončení, odkaz (Checklisty 2.0, bod 34).
10. **P10 Zbývající upozornění jedním místem.** Vydání rozpisu,
    pozvánky, docházka, PIN, marketing, oprávnění.
11. **P11 Přehled majitele na Dnes:** „naléhavý vzkaz nebyl přečten".
12. **P12 Poznámka ke směně** při píchnutí na tabletu.
13. **P13 Stránka Upozornění.** Označit jednu položku, stránkování,
    filtr „vyžaduje akci", vzhled. Až dokončí svou úpravu souběžná
    úloha, která na stránce teď pracuje.
14. **P14 Staré otevřené checklisty** (13 od 27. 8.). Patří do
    Checklistů, navrhnu zvlášť.
15. **P15 Rychlost otevření rozhovoru.** Dnes asi 12 dotazů, seznam
    rozhovorů se počítá dvakrát.
16. **P16 Zkoušky v přihlášené aplikaci v prohlížeči.** Scénáře ze
    zadání 16.–20. 9.
17. **P17 Úklid kódu.**
    - Zbytky názvu „Provozní centrum" (složka, třídy).
    - Adresa `/ukoly/…` pošle překlep do checklistů.
    - Akce Nástěnky ve složce staré adresy.
18. **P18 Uzavření rozhovoru.** Jen pokud ho chcete. Bylo jen
    v neuložené verzi dokumentu z 9. 9.
19. **P19 Strop a „proč" u naléhavé zprávy.** Po odpovědi na O23.
20. **P20 Vzhled podle Dnes všude.** Úkoly, stránka Upozornění.
21. **P21 E-mail a další kategorie v nastavení** (po O27). **Zprávy na
    tabletu** (po O26).
22. **P22 Fotky z iPhonu (heic)** u příloh ke zprávám.
23. **P23 Založení rozhovoru podle klientského id** (28. 9.). Klientské
    id dnes chrání jen zprávu uvnitř jednoho rozhovoru. Dvojí odeslání
    formuláře „Napsat vedení" nebo „Nový rozhovor" před načtením
    JavaScriptu (pomalý telefon) založí dva rozhovory. Chce to
    `zalozit_rozhovor` s klientským id a unikátním indexem (migrace).
24. **P24 Klepnutí na nepotvrzenou změnu směny rovnou ke kartě**
    (28. 9.). Dnes vede na stránku Upozornění nahoru; kotva `#u-<id>`
    potřebuje úpravu `upozorneni/page.tsx`, kterou teď mění souběžná
    úloha. Patří k P13. Upozornění se už klepnutím nepřečte, takže
    ve zvonečku zůstane, dokud ho člověk nepotvrdí.

---

## 8. Rozpory mezi zadáními a co platí

| | Rozpor | Co platí |
|---|---|---|
| R1 | Upozornění na směny „až při vydání" (1. a 8. 9.) × aplikace posílá už při uložení | Beze změny, O19 |
| R2 | „Důležitá změna směny" pípne i mimo směnu (17. a 19. 9., text v Nastavení) × „mimo pracovní dobu žádný agresivní push, výjimka jen naléhavé" (20. 9.) | 20. 9.: nepípne. Text v Nastavení se opraví (T5), O20 |
| R3 | Noční klid podle hodin (1., 8., 16.–17. 9.) × klid podle skutečné směny (3. a 20. 9.) | Podle směny, O21 |
| R4 | „Mimo směnu žádný zvoneček" (3. 9.) × „vidět smí, nevyrušovat" (16.–17. 9.) | Pozdější: zvoneček hned, telefon počká |
| R5 | Nic do jazykového modelu (3. 9., pravidlo 8) × AI přepis, AI návrh úkolu, AI shrnutí (16.–20. 9.) | Přepis ne (vaše volba 17. 9.), návrh úkolu bez modelu, O28 |
| R6 | „Nepiš, že push chodí" (3.–9. 9.) × push nasazený (20.–23. 9.). Hlášení z 23.–24. 9. tvrdí, že nikdy nedoručil | Push doručuje. Věty se opraví (T5) |
| R7 | Tři přepínače včetně úkolů a e-mailu (8. 9.), pět kategorií (16.–17. 9.) × dnes jen vzkazy a nástěnka | O27, T8 |
| R8 | Samostatná práva na druhy zpráv (16.–17. 9.) × každý komukoli | O22 |
| R9 | Kanál pozice (5. a 9. 9.) × odloženo 6. 9. | Odloženo |
| R10 | Doplnění z 9. 9. existuje jen v neuložené kopii (`foodtab-rizeni`) a nikdy nebylo v hlavní větvi | Použito jen jako podklad (uzavření rozhovoru → P18) |
| R11 | „Ne procenta, jména" (6. 9.) × „12 / 15 potvrzeno" (17. 9.) | Obojí jde dohromady, P2 |
| R12 | Nepotvrzená oznámení nahoře od nejstaršího (5., 6., 8. 9.) × aplikace od nejnovějšího | Zadání platí, T6 |
| R13 | „Moderní bezpatkové písmo" (16.–17. 9.) × mockup Dnes (19. 9.) | 19. 9. platí |
| R14 | „Obrázek jen jako inspirace" × „drž se vizuálu" (obojí 20. 9.). Dvakrát jste reklamoval odchylky | Přísnější výklad |
| R15 | Otázka 4 „Vzkazy, nebo Zprávy" × pokyn „Vzkazy a úkoly" (23. 9.) | 23. 9. Otázka 4 je označená jako překonaná |
| R16 | Dokumenty a fotky na Nástěnce (6. 9.) × přílohy jsou jen u zpráv v rozhovorech | Zadání platí, P1 |
| R17 | Checklist v Komunikaci (Checklisty 2.0, bod 34) × „vazba neexistuje" v kódu | Zadání platí, P9 |
| R18 | „Žádné tlačítko s mikrofonem" (8. 9., šlo o rozpoznávání řeči) × hlasovka (16. 9.) | Hlasovka platí, věcně nejde o rozpor |
| R19 | Zprávy na tabletu (3.–6. 9.) × tablet je nemá | O26 |
| R20 | Strop a „proč" u naléhavé (16.–17. 9.) × nic, nikdo nezrušil | O23 |

---

## 9. Co neměním (rozhodnutí, která se tiše neobracejí)

- „Na směně" = otevřený příchod v docházce.
- „Důležitá" zpráva se doručuje jako běžná. Mimo směnu vyruší jen
  naléhavá a majitele cokoli.
- Při slučování upozornění platí poslední priorita a naléhavé se
  neztratí.
- Zakládání rozhovorů se nezpřísňuje, dokud nerozhodnete O22.
- Návrh úkolu ze zprávy je pravidlový, bez modelu.
- Čekající upozornění na telefon propadá po 48 h (O21).
- Směny se v tomhle PR nemění (R1).

**Slovník, podle kterého se sjednotí texty (T5):**

| Slovo | Znamená | Kde |
|---|---|---|
| Vzkazy a úkoly | celá položka v nabídce | nabídka, nadpis nad záložkami |
| Vzkazy | krátký název téže položky | spodní lišta telefonu, Dnes |
| Komunikace | záložka s rozhovory (váš pokyn 23. 9.: „nahoře zachovej") | záložky |
| Rozhovor | jedno vlákno: osobní, kanál pobočky, kanál úseku, vzkaz vedení | seznam, „Nový rozhovor", „O rozhovoru" |
| Zpráva | to, co člověk do rozhovoru napíše | psaní, „Zrušit zprávu" |
| Vzkaz vedení | rozhovor s vedoucím pobočky nebo majitelem | „Napsat vedení" |
| Oznámení | příspěvek na Nástěnce | Nástěnka, „Nové oznámení" |
| Upozornění | řádek ve zvonečku | zvoneček, stránka Upozornění |

---

## 10. Technická příloha (pro toho, kdo to bude dělat)

### Změna databáze (T1 + T9) — jeden soubor

`supabase/migrations/20260927100000_cteni_rozhovoru.sql`, jen `create or
replace` a `comment`. Nic se nemaže. Znění funkcí se bere z ostré
databáze (`pg_get_functiondef`, jen SELECT), ne z poslední migrace.

- **Pojistka odvozených kanálů.** U druhů `pobocka` a `usek` řádek
  v `konverzace_ucastnici` nedává přístup ani upozornění, jen nese
  `precteno_do`. Týká se:
  - `app.je_ucastnik` (první podmínka jen pro `osobni`,
    `mezi_pobockami`, `vedeni`),
  - `public.moje_rozhovory`,
  - `app.upozornit_na_vzkaz_trg`,
  - `public.lide_v_rozhovoru`,
  - `public.kiosk_zpravy_pocet` a `public.kiosk_zpravy_pinem` (kanály
    nikdy neukazovaly, chování se nemění).

  Komentář `oznacit_precteno` („přístup tím nevzniká") pak bude pravda.
  Ostrá DB 27. 9.: u kanálů 0 řádků, takže nikdo nic neztratí.
- **`app.upozornit_na_oznameni_trg`** pošle upozornění jen příjemci
  s `communication.read`. Právo se počítá stejnou cestou, jakou
  `app.adresati_vzkazu` počítá adresáty vzkazu vedení.
- **`comment on table public.announcements`**: co na Nástěnku patří,
  osobní dokumenty ne.
- Definer si filtruje firmu sám, `search_path ''`, `revoke … from
  public, anon` zůstává.
- *(Doplněno při práci 27. 9.)* Pravidlo „u kterého druhu dává řádek
  přístup" je na jednom místě: `app.ucastnici_vypsani(druh)` (osobni,
  mezi_pobockami, vedeni; neznámý druh = ne). A nová
  `public.precist_rozhovor` (obálka nad `oznacit_precteno`, security
  invoker): aplikace zapisuje čtení jen přes ni, takže bez migrace
  čtení nezapisuje vůbec.
- *(Doplněno 28. 9. po nezávislých kontrolách.)*
  - **Oddíl 10:** `revoke select` na `konverzace_ucastnici` od
    `authenticated` a zpět sloupcový grant jen na `konverzace_id`,
    `employee_id`, `odesel_kdy` — bez `precteno_do` (čas čtení) i bez
    `pridan_kdy` (u kanálu čas prvního otevření). V ostré databázi mělo
    `authenticated` tabulkové `select` z výchozích práv Supabase. Po
    `db push` ověřit SELECTem `has_table_privilege('authenticated',
    'public.konverzace_ucastnici', 'SELECT') = false`.
  - **Oddíl 11:** `public.kdo_nepotvrdil` jen s `communication.read`
    (tělo z `pg_get_functiondef`, jinak beze změny).
  - **Oddíl 12:** nová `public.ctenari_nastenky(p_tenant, p_lide)`,
    definer s vlastním filtrem firmy, jen pro `communication.manage`,
    vrátí podmnožinu předaných lidí s právem číst Nástěnku. Bez ní
    (migrace ještě není) se formulář chová jako dosud.

### Scénář `supabase/tests/krok62_scenar.sql`

Zapsat do `run.sh` a `.github/workflows/databaze.yml`.

**Záporné kontroly:** člověk z úseku A si přečte kanál úseku A
(`oznacit_precteno`) a přeřadí se do B. Pak:
- `je_ucastnik` = false;
- `moje_rozhovory` kanál nevrací;
- nová zpráva v kanálu mu nezaloží `vzkaz.novy`;
- `lide_v_rozhovoru` a `kiosk_zpravy_pinem` ho nevracejí.

Totéž platí pro kanál pobočky po ztrátě dosahu.

**Kladné kontroly:**
- V úseku A čte dál a má 0 nepřečtených.
- V osobním rozhovoru dál platí přístup přes řádek účastníka.

**Oznámení:** bez `communication.read` upozornění nevznikne, s ním ano.

*(Doplněno 28. 9.)* **Oddíl 8:** `pridan_kdy` a `precteno_do` cizího
člověka v kanálu nepřečte přímým dotazem nikdo (`insufficient_privilege`),
tabulkové právo není, detail rozhovoru dál přečte `employee_id`.
**Oddíl 9:** „Nepotvrdili" jen se čtenáři Nástěnky, `ctenari_nastenky`
vrátí jen je, bez `communication.manage` nic a `anon` ji volat nesmí.

**Rozbití** (každé zvlášť, viz paměť „rozbít to dvěma způsoby"):
- vrátit první podmínku `je_ucastnik` → spadne kontrola přístupu;
- vrátit trigger → spadne kontrola upozornění;
- vrátit `moje_rozhovory` → spadne kontrola seznamu;
- odebrat kontrolu práva u oznámení → spadne kontrola oznámení.

Celou sadu PGlite pustit jen jednou na konci.

### Aplikace

- **T1.**
  - `app/[rozsah]/vzkazy/[konverzace]/page.tsx` si nejdřív přečte
    `moje_precteno_do` kvůli dělítku.
  - Nová klientská součástka po zobrazení zavolá akci, která posune
    záložku. Ne při vykreslení na serveru: odkaz v seznamu si stránku
    umí načíst dopředu a označil by nepřečtené i bez otevření.
  - Dělítko drží pozici z prvního vykreslení (vzor `pevny-zdroj.tsx`),
    jinak po živé obnově zmizí.
  - Odeslání (`odeslatZpravuKlient`, `poslatZpravu`, `odeslatHlasovku`)
    posune záložku taky.
  - Když `moje_rozhovory` dá 0 nepřečtených, akce nastaví `read_at`
    u vlastních `vzkaz.novy`.
  - Z `panel-konverzace.tsx` pryč tlačítko.
- **T2.**
  - Klíč `zvonek` v `app/[rozsah]/ikona.tsx` a `IkonaKlic`
    (`nabidka.ts`).
  - Úpravy v `components/shell/GlobalTopbar.tsx`.
  - Nová `lib/upozorneni-odkaz.ts`: adresa podle druhu z existujících
    `odkazNaSmenu`, `odkazNaZalohu`, `odkazNaChecklist` a úkolu.
    `vzkaz.novy` → rozhovor podle `zdroj_id` (id zprávy), jinak seznam.
  - Položka panelu je formulář se serverovou akcí (nový soubor
    `app/[rozsah]/upozorneni/otevrit.ts`). Akce označí přečtené
    a přesměruje na adresu spočítanou z uloženého řádku, ne z formuláře
    (pravidlo 4).
- **T3.**
  - `zalozitVzkazVedeni` a `zalozitOsobniRozhovor` po založení zavolají
    `poslat_zpravu` s `p_klient_id`.
  - Když zpráva neodejde, přesměruje se do rozhovoru s hláškou. Text
    zprávy se do adresy nedává.
  - Tlačítka přes `vzkazy/tlacitko-odeslat.tsx`.
- **T4.**
  - `provozni-centrum/zalozky.tsx` + nová funkce počtů volaná ze všech
    stránek záložek.
  - Nástěnka skrytá bez `communication.read`.
  - `docs/COMMUNICATION_ARCHITECTURE.md` (oddíl o záložkách).
- **T6.**
  - Akce Nástěnky z `app/[rozsah]/zpravy/akce.ts` do
    `app/[rozsah]/vzkazy/akce-nastenka.ts`. Přesměrování `/zpravy`
    zůstává.
  - `revalidatePath` na `/vzkazy`.
  - Pořadí jako čistá funkce v `lib/komunikace/` s testem.
- **T8.** Položka `upozorneni/nastaveni` v `NASTAVENI` (`pravo: null`,
  ikona `zvonek`).

### Testy

- `scripts/komunikace.test.mjs`:
  - pořadí Nástěnky;
  - počty a popisy záložek;
  - adresa upozornění pro každý druh, včetně `vzkaz.novy` s id i bez.
- `scripts/nabidka.test.mjs`: nová položka Nastavení a ikona.
- Nový soubor testu, pokud vznikne, se zapíše do `TESTY`
  v `.github/workflows/aplikace.yml`.
- Každá nová kontrola se schválně rozbije a musí spadnout.
- `npx tsc --noEmit -p tsconfig.json` a `npx eslint` na dotčené soubory.
- Snímky 375 a 1536 px, světle i tmavě: `/vzkazy`, detail rozhovoru,
  Nástěnka, panel zvonečku, Nastavení upozornění.

### Soubory souběžných úloh

- **`app/[rozsah]/layout.tsx`**: jiná úloha. T2 potřebuje jen předat do
  horní lišty tři čísla zvlášť místo součtu a načíst `zdroj_id`
  u posledních upozornění. Je to **nutný** malý zásah, v PR bude
  popsaný.
- **`app/[rozsah]/upozorneni/page.tsx`**: jiná úloha (odkaz `?clovek`).
  Tady jen případně nahradit odkaz „Otevřít vzkazy" voláním
  `lib/upozorneni-odkaz.ts`. Jinak čeká na P13.
- **`components/shell/ZivaAktualizace.tsx`**: nesahat, opravuje jiná
  relace.
- **`app/[rozsah]/nabidka.ts`**: může se potkat s úpravami Můj účet
  (jiná pracovní kopie). Jde jen o přidanou řádku.
