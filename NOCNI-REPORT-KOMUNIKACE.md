# Noční report — Provozní centrum / Komunikace

**Větev:** `komunikace-provozni-centrum` · **Draft PR:** [#60](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/60) (nemergováno) · **Datum:** 21.–22. 9. 2026

Tohle je souhrn pro ráno. Zdroj pravdy je kód, databáze, testy a dokumenty
v repozitáři — ne chat. Architektura: `docs/COMMUNICATION_ARCHITECTURE.md`.
Směny (závislost): `docs/HANDOFF-SMENY.md`.

## Nejdůležitější věci na začátek

1. **Nic z toho není nasazené do provozu.** Kód leží ve větvi + draft PR, **nic jsem
   nemergoval** (merge = okamžité nasazení Vercelem) a **žádnou migraci jsem nepustil**
   (`db push` je vždy ruční). Databáze `foodtab-test` je nedotčená.
2. **Pět migrací čeká na vás**, v tomto pořadí (před nimi ještě tři migrace Směn
   z 20. 9., které taky čekají):
   `20260921100000_notifikacni_sluzba` → `20260921110000_provozni_centrum` →
   `20260921120000_realtime_upozorneni` → *(volitelná)* `20260921130000_prilohy` →
   *(volitelná)* `20260922100000_checklist_ukol`.
   Kód je psaný tak, aby bez nich nespadl (obrazovky řeknou „čeká na nasazení databáze“,
   tlačítko Příloha i „Nahlásit problém“ se bez svých migrací neukážou).
3. **Po dokončení jsem nechal větev zrevidovat** (5 nezávislých úhlů, každé zjištění
   ověřoval skeptik) — oddíl „Nezávislá revize“ níž. Našla i věc, kterou jsem předtím
   ohlásil jako hotovou a nebyla (jména v rozhovoru — pomocná funkce existovala, stránky ji
   nevolaly). Opraveno a otestováno.
4. **Rozhodnutí, která jsou na vás** (oddíl „Rozhodnutí pro Šéfíka“): AI návrh úkolu
   modelem, přepis hlasu (dodavatel), klíče pro push, doba uchování, kdo smí komu psát,
   má důležitá změna směny pípnout mimo směnu.

## HOTOVO (a jak je to ověřené)

| Co | Ověření |
|---|---|
| **Notification Service** (`app.notifikovat`): jedno vstupní místo, příjemce (jen aktivní člen) → priorita (low/normal/important/urgent) → pracovní doba → kanál → záznam; slučování s počtem; kategorie; naléhavé se nepotlačuje ani neruší | scénář `krok42` (**123 kontrol**) v PGlite i na PostgreSQL 16 (CI), mutační zkoušky |
| Producenti přepojeni (bez dvojích upozornění): nový vzkaz (nově i členové kanálů pobočky/úseku, kteří je nikdy neotevřeli), nové oznámení, změna směny (klíč = konkrétní směna → opravuje známou chybu z handoffu; „Změnil: …“) | `krok42`, regrese `krok12/13/22/24/25/35/36/37/39` zelené |
| Karta „ZMĚNA SMĚNY / Původně / Nově / Změnil“ (vzor ze zadání) | `scripts/upozorneni.test.mjs` (105 kontrol), snímek v upozorněních |
| Pracovní doba: mimo směnu čeká jen **externí** oznámení, záznam v aplikaci vzniká hned; po příchodu se čekající sloučí do „Čekají na vás N zpráv“ (už přečtené se nepřipomíná) | `krok42` (fronta `notifikace_doruceni`, `app.uvolnit_cekajici`) |
| **Zpráva → úkol**: akce u zprávy, formulář s návrhem, systémová událost v rozhovoru (ne do uzavřeného), odkaz zpět, upozornění přidělenému, audit bez textu | `krok43` (**72 kontrol**), mutace |
| Návrh úkolu je **pravidlový, bez modelu**: termín („zítra“, „do pátku“, „30. 9.“, „do 15:00“), naléhavost, název; nevymýšlí — nejasné označí „k ověření“ | `scripts/komunikace.test.mjs` (**200 kontrol**; po revizi opraveno přes 20 skutečných chyb rozpoznávání) |
| Detail úkolu (`/ukoly/ukol/[id]`), odkaz z upozornění, „Označit jako hotové“ | tsc + náhled + Vercel build |
| **Výběr příjemců** (hledání bez diakritiky a s pomlčkou, „moje pobočka“ nahoře, více lidí) + názvy osobních rozhovorů pro každého jiné + jména v rozhovoru i v kartě Dnes (běžný zaměstnanec neviděl jména, ukazovalo se „kdosi“) | `krok43`, `komunikace.test.mjs` |
| **Třísloupcový desktop** (seznam \| vlákno \| O konverzaci: účastníci, sdílené soubory, rychlé akce, související úkoly, události) a mobilní rozhraní | snímky `docs/nocni-report-snimky/` (světlý i tmavý režim) |
| Záložky **Přehled · Komunikace · Úkoly · Checklisty · Nástěnka**, menu „Provozní centrum“, odznak nepřečtených ve spodní liště, oprava dvojího počítání ve zvonečku | tsc + náhled |
| **Naléhavá zpráva**: potvrzení „upozorní i mimo směnu“ před odesláním, **vynuceno na serveru**, audit (bez textu) | kód + scénář `krok24` |
| **Realtime**: nová zpráva/oznámení/úkol osvěží obrazovku sama (odebírá se jediná tabulka `notifications`) | migrace prošla CI; **živé doručení neověřeno** (chybí nasazená publikace) |
| **Offline/opakování odeslání**: fronta neodeslaných zpráv v prohlížeči (po uživateli) + klientské id (bez zdvojení) | `krok43` (idempotence); chování prohlížeče **neověřeno end-to-end** |
| **Přílohy ke zprávám** (fotka, PDF; volitelná migrace D): soukromý kbelík, tabulka bez zápisového grantu, `pripojit_prilohu` jako jediná cesta (autor zprávy, do 10 min, cesta patří rozhovoru, soubor existuje, ≤ 5), nahrání z prohlížeče přímo do Storage, zmenšení fotek, náhledy ve vlákně a v panelu | `krok44` (**41 kontrol**), `komunikace.test.mjs`, snímek `desktop-prilohy.png` |
| Bezpečnostní opravy: sloupcový grant na `notifications` (klient smí měnit jen `read_at`/`acknowledged_at`, potvrzení se nedá zpětně přepsat); `kdo_nepotvrdil` má kontrolu práva **i rozsahu pobočky** | `krok42`, `krok43` |
| **Checklist → úkol** (volitelná migrace E): tlačítko „Nahlásit problém“ u položky i za celý běh, pobočka jde vždy z běhu (ne od volajícího), vazbu nejde podvrhnout na jinou pobočku ani firmu (přímý zápis i trigger), termín/adresát/právo `tasks.manage` ověří stejný `zadat_ukol` jako ruční úkol; smazání běhu nebo položky jen ruší vazbu, úkol zůstává | `krok45` (**25 kontrol**), mutace, snímek `desktop-checklist-problem.png` |

## ČÁSTEČNĚ

* **Push do telefonu.** Hotové a otestované: šifrování zprávy (RFC 8291) a podpis VAPID
  (RFC 8292) — ověřeno proti příkladu z RFC včetně mezivýsledků (`scripts/web-push.test.mjs`,
  65 kontrol), fronta doručení, plánovač (`.github/workflows/notifikace-push.yml`), service
  worker, zapnutí na zařízení v *Nastavení upozornění*, ochrana proti cizí adrese (jen https
  + známé push služby, strop 10 zařízení). **Nikdy neproběhlo skutečné doručení** (chybí klíče
  VAPID a zařízení) — první ostrý pokus je třeba sledovat. Viz EXTERNÍ ZÁVISLOST.
* **Nástěnka** — jen přesunutá do společných záložek; její obsah (potvrzení „Beru na vědomí“,
  „kdo nepotvrdil“) se nezměnil kromě opravy oprávnění.
* **Hlasové zprávy** — fungují (nahrání, přehrání), u každé stojí „Přepis na text není dostupný“.
  Do offline fronty se **neukládají** (zvuk je velký), přílohy taky ne.

## PŘIPRAVENO (rozhraní hotové, funkce vypnutá)

* **Přepis hlasu** — `lib/komunikace/prepis.ts`: rozhraní poskytovatele + „nedostupný“ jako
  výchozí; registr poskytovatelů je záměrně prázdný. Nic se nepředstírá.
* **Návrh úkolu modelem** — `modelovyPoskytovatel` je nedostupný a obrazovka to říká.
  Napojení je rozhodnutí, ne klíč (CLAUDE.md pravidlo 8: komunikace se modelu neposílá).
* **E-mail jako kanál upozornění** — v modelu není (`notifikace_doruceni.kanal` zná jen push).

## NEHOTOVO

* **Diskuse k úkolu** — samostatná neexistuje; úkol ze zprávy odkazuje zpět do rozhovoru.
* **Vyhledávání ve zprávách**, stránkování vlákna (zobrazuje se posledních 200 zpráv a řekne
  se to), zakládání skupinových kanálů s vlastním názvem mimo osobní rozhovory.
* **Upozornění na úkol po termínu / při přeřazení** — notifikuje se jen vznik úkolu.
* **Ostatní producenti notifikací** (rozpis vydán, pozvánky, docházka, zálohy, PIN, marketing,
  oprávnění) zůstávají na starém přímém insertu — přepojit je znamená sáhnout do cizích modulů.
* **Duplicitní osobní rozhovor** — druhý rozhovor se stejnou osobou se založí místo otevření
  existujícího.
* **E2E testy (Playwright)** — v repozitáři nejsou. Žádná uživatelská cesta nebyla prozkoušená
  v přihlášené aplikaci nad skutečnými daty.

## EXTERNÍ ZÁVISLOST (nemůžu vyřešit já)

1. **Klíče VAPID** pro push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (na Vercelu).
   Vygenerují se jednorázově; bez nich je push vypnutý a UI to říká.
2. **Dodavatel přepisu hlasu** (Whisper / Deepgram / Google STT) + smlouva o zpracování údajů —
   Claude API zvukový vstup nemá.
3. **Nasazení migrací** (`db push`) — vždy ruční.
4. Rozhodnutí o nasazení realtime publikace (migrace `…120000` je volitelná), příloh (`…130000`)
   a checklist → úkolu (`…100000` z 22. 9.).

## Nezávislá revize (co našla, co jsem opravil, co ne)

Po dokončení jsem větev nechal projít 5 revizními úhly (bezpečnost SQL, logika SQL,
kompatibilita nasazení, UI a klientský kód, doménová logika); každý z 64 kandidátů dostal
skeptického ověřovatele: 43 potvrzeno, 5 věrohodných, 14 vyvráceno, 2 se nepodařilo ověřit
(výpadek sítě). Poznámka k poctivosti: u části „vyvrácených“ nálezů návrhu úkolu jsem **přesto
napsal test, který nad starým kódem spadl** (22 kontrol), takže oprava zůstala.

**Opraveno** (s testem; u SQL i schválným rozbitím):

* Jména v rozhovoru, v seznamu a v kartě Dnes se opravdu čtou přes `lide_v_rozhovoru` /
  `jmena_osobnich_rozhovoru`; náhled poslední zprávy nepočítá systémové události.
* **Vlákno ukazovalo nejstarších 200 zpráv** — od 201. nové nebyly vidět. Teď nejnovějších 200.
* Pozastavené členství už nedostává upozornění ani push; adresa push zařízení jen https +
  známé služby (SSRF), strop zařízení, paralelní odesílání s časovým rozpočtem.
* **Naléhavý push, který ještě neodešel, se sloučením s další zprávou už neruší** (dřív ho
  nahradilo čekání na příchod — přesně v případě, kdy má čekání obcházet).
* Po příchodu se nepřipomíná už přečtené; `kdo_nepotvrdil` a `lide_v_rozhovoru` hlídají rozsah
  a modul; úkol z uzavřeného rozhovoru nevyrobí událost; úkol s termínem bez pobočky se odmítne
  (jinak by termín tiše zmizel); trigger vazby úkolu neblokuje mazání; potvrzení směny nejde
  zpětně přepsat.
* Fronta neodeslaných zpráv je po uživateli (sdílený telefon) a odesílá se, dokud je co;
  push o úkolu nenese název úkolu; plánovač neříká „čeká na migraci“ podle volného textu;
  vypnutí push ukáže chybu; adresát úkolu z rozbalovátka platí i bez přepnutí volby; „zítra“ se
  počítá od dne zprávy; dvojklik na odeslání nezaloží druhý rozhovor/úkol; hlasovka se po živé
  aktualizaci nepřeruší; odznaky čtou čtečky; neplatné id v adrese = hláška.
* CI teď hlídá dokončení scénářů 42–44.

**Neopraveno — vědomě (jsou to rozhodnutí nebo cizí modul):**

* **Odhlášení nezruší push zařízení** (sdílený telefon: kdo se přihlásí po vás a push si nezapne,
  uvidí na zamčené obrazovce vaše upozornění, dokud zařízení nevypnete v Nastavení upozornění).
  Oprava vyžaduje sáhnout do přihlašování (klientská strana zná adresu zařízení, server ne).
* **Realtime u DELETE** neuplatňuje RLS (Supabase): odběratel vidí jen id smazaného upozornění
  (obsah ne). Publikace neumí vysílat jen některé operace, popsáno v migraci `…120000`.
* **`zadat_ukol` (starší modul Úkoly) tiše zahodí termín u úkolu bez pobočky**
  (`app.zona_pobocky(NULL)` vrací NULL; komentář v té funkci tvrdí opak). Moje funkce to
  obchází chybou, samotnou chybu jsem nechal — patří tomu modulu.
* **Důležitá změna směny (start do N hodin) mimo směnu nepípne** — jen naléhavé. Text v
  Nastavení → Firma ale slibuje jinak („dostane se k člověku i mimo pracovní dobu“). Viz rozhodnutí.
* Push pro kanál jiné pobočky se pošle i člověku píchnutému jinde (zvoneček to bere jako
  nedoručené); člověk na víc pobočkách dostane upozornění z kanálu jen své domovské pobočky.
* Časy v detailu úkolu se zobrazují v `ZONA_VYCHOZI` (jako jinde v aplikaci), ne v pásmu pobočky.
* Živá aktualizace se nespustí, když má člověk vypnutou kategorii vzkazů (upozornění se
  nezakládá); nepřečtená upozornění vzniklá před migrací se neslučují (chybí klíč).
* Fronta neodeslaných zpráv se odesílá jen dokud je otevřená stránka rozhovoru.

## Nová práce 22. 9.: Checklist → úkol

Doporučení z konce předchozí noci („jako další etapu doporučuji checklist → úkol“).
Migrace E (`20260922100000_checklist_ukol.sql`), scénář `krok45`, UI pod
`ukoly/[beh]/problem`. Dvě rozhodnutí stojí za zápis, ať se příště neobjeví jako
záhadná mezera:

* **Přístupová brána je jen `tasks.manage` na pobočce běhu** (přes `zadat_ukol`),
  ne ještě samostatná kontrola `tasks.read` navrch. Zkusil jsem to s ní — mutační
  zkouška ukázala, že jde o podmínku, kterou nejde rozbít (`zadat_ukol` požaduje
  totéž, jen přísněji), takže by to byla falešná jistota. Kdo checklist VIDÍ
  (`tasks.read`), ale nezadává úkoly (`tasks.manage`), dostane přesně tu hlášku,
  kterou by čekal od ručního „Zadat úkol“ na stejné obrazovce.
* **Trigger na přímý zápis kontroluje jen shodu pobočky**, ne zvlášť firmy —
  `checklist_runs.branch_id` je globálně jedinečné (`gen_random_uuid`), takže
  shoda pobočky sama dokazuje shodu firmy. Druhá podmínka na `tenant_id` by byla
  nadbytečná (a nešla by rozbít mutací) — mutační zkouška to potvrdila, tak zůstala
  venku.
* Práva dnes dává **zařazení** (`employee_permissions`/`position_permissions`,
  migrace `20260909100000`), ne `roles`/`role_permissions` — ty zůstávají jen kvůli
  cizímu klíči na `memberships.role_id`. Scénář `krok45` proto přiděluje práva přes
  `employee_permissions`, ne přes roli. Kdyby se to zase spletlo (jako tuhle noc
  napoprvé), příznak je: `has_permission` vrátí `false`, i když scénář vypadá, že
  roli s právem přidělil.

## Provedené migrace, změněné RLS/granty

**Provedené migrace: žádná** (žádná se nepouštěla do databáze).
Napsané, čekají: `20260921100000`, `…110000`, `…120000`, `…130000` (volitelná),
`20260922100000` (volitelná).
Migrace A–C byly po revizi ještě upravovány — nejsou nasazené, takže se to smělo; po nasazení
už jen přírůstkově.

Změny oprávnění, které migrace dělají:

* `notifications`: `authenticated` přichází o `UPDATE` na celé tabulce; smí jen sloupce `read_at`,
  `acknowledged_at`; trigger navíc zaručí, že potvrzení dostane čas serveru a už se nemění. Kód
  (`upozorneni/akce.ts`, `smeny/potvrzeni.ts`) mění jen tyto dva.
* Nové tabulky `push_odbery`, `notifikace_doruceni`: RLS zapnuté, **bez politik a bez grantu**
  pro `anon`/`authenticated` (jen `service_role`) — klíče zařízení se nesmějí dostat do prohlížeče.
* `konverzace_prilohy` (D): čte jen účastník rozhovoru, **žádný zápisový grant**; kbelík `prilohy`
  soukromý; politiky úložiště select/insert přes účastnictví, delete jen sirotka, žádná update.
* `poslat_zpravu` dostává 7. parametr, starý šestiparametrový podpis se **zahazuje**.
* Trigger `tasks_vazba_zpravy` na `tasks`: úkol nejde připnout k cizímu rozhovoru.
* Trigger `tasks_vazba_checklistu` (E): úkol nejde připnout k checklistu jiné pobočky ani firmy;
  `tasks.checklist_run_id`/`checklist_item_id` (obojí nepovinné, `on delete set null`).
* `kdo_nepotvrdil`: vrací jména jen tomu, kdo má `communication.manage` **na rozsahu oznámení**.
* `zalozit_rozhovor` se **nemění** (zpřísnění jsem zkusil a vrátil — viz architektura, oddíl 1/6).

## Testy a build

| Co | Výsledek |
|---|---|
| Celá sada scénářů v PGlite | **1724 kontrol, nic nespadlo** (PGlite RLS ani granty úplně neověří) |
| Workflow „Databáze“ na PostgreSQL 16 (PR #60) | **prošlo** pro `f2f9c97` (poslední commit z 21. 9.; 22. 9. se počítá v PR) |
| `scripts/komunikace.test.mjs` / `upozorneni` / `web-push` / `smeny-formular` | 200 / 105 / 65 / 11 kontrol, 0 chyb |
| Mutační zkouška SQL (schválné rozbití migrace) | 34 (A/B původní) + 29 (přílohy) + 22 (opravy z revize) + 9 (checklist → úkol) rozbití; **všechna zachycena** kromě popsaných níž |
| `tsc --noEmit`, `eslint` (změněné části) | čisté (jen dřívější chyby v `lib/marketing-*ai.ts` — chybí `@anthropic-ai/sdk`, a v lokálním `app/nahled/`) |
| Vercel build (preview) | prošel pro dřívější commity; poslední se počítá v PR |
| Lokální `next build` | **nešel** — `node_modules` v pracovní kopii nemá `@anthropic-ai/sdk` (týká se Marketingu, ne téhle práce); rozhoduje Vercel |

„Přeživší“ rozbití jsou vysvětlená, ne skrytá: (a) opakované odeslání téhož klientského id —
hlídá ho ještě unikátní index (dvě obrany na jedno); (b) úkol ze zprávy bez kontroly
účastnictví — zastaví ho ještě trigger vazby; (c) `komu_muzu_psat` bez kontroly členství — vrací
prázdno i tak; (d) politika `prilohy_delete_sirotka` bez kontroly účastnictví — schová ji politika
select (DELETE s WHERE musí řádek nejdřív vidět), takže je to ekvivalentní změna; (e)
`uvolnit_cekajici` bez ochrany proti nule čekajících — dosažitelné jen souběhem dvou transakcí,
scénářem se vyzkoušet nedá. Kontrola, která nejde rozbít, je popsaná, ne skrytá.

## Snímky obrazovky

`docs/nocni-report-snimky/` — desktop (1536 px) a mobil (390 px), světlý i tmavý režim:
rozhovor, seznam, výběr příjemců, úkol ze zprávy, detail úkolu, přílohy, nahlášení problému
z checklistu. **Pozor:** jsou to snímky
komponent s ukázkovými daty (přihlášená aplikace se nedá bez přístupu ke vašim údajům
vykreslit). Vzhled je ověřený (včetně měření, že mobilní stránka nepřetéká), **napojení na
skutečná data ne** — to ověří až prohlídka po `db push` a přihlášení.

## Známé problémy a rizika

* Směny (nerefaktorováno, jak stálo v zadání): `ulozit_smenu` zakládá upozornění už při uložení
  konceptu, ne až při vydání — beze změny.
* Zvoneček po nasazení migrací přestane počítat `vzkaz.novy`/`oznameni.nova` z `notifications`
  (počítají se ze svých zdrojů) — dřívější dvojí počítání zmizí; číslo může být oproti dnešku nižší.
* `poslat_zpravu` s klientským id **před** nasazením migrace jede po staru (bez ochrany proti
  zdvojení) — řešeno tolerantním voláním.
* Naléhavá zpráva se při slučování stane „normální“ v seznamu upozornění (rozhodnutí z kroku 35);
  neodeslaný naléhavý push ale zůstává. Změna je jeden řádek.
* Přílohy: soubor nahraný a nepřipojený (zavřená karta) zůstane v úložišti jako sirotek.
* Viz také „Neopraveno — vědomě“ výš.

## Rozhodnutí pro Šéfíka

1. **Návrh úkolu modelem** — zapnout? Vyžaduje výjimku z pravidla 8 a uzavřený vstupní typ.
2. **Přepis hlasu** — který dodavatel, kde se zpracovává, jak dlouho se uchovává.
3. **Kdo smí komu psát** — dnes kdokoli s kýmkoli s účtem ve firmě (výběr příjemců ukazuje celý
   adresář, včetně toho, kdo je celofiremní vedení); zpřísnění je jeden bod v DB.
4. **Doba uchování zpráv** (dosud nerozhodnuto).
5. **Důležitá změna směny mimo směnu** — má pípnout (jak slibuje Nastavení → Firma), nebo jen
   naléhavé (jak drží Notification Service a zadání „žádný agresivní push“)?
6. **Odhlášení a push** — má odhlášení rušit push zařízení? (Zásah do přihlašování.)
7. **Přílohy** — nasadit `…130000`? Povolené typy jsou jpeg/png/webp/pdf do 10 MB, max. 5 na zprávu.
8. **Checklist → úkol** — nasadit `…100000` z 22. 9.? Nic nemění chování checklistu samotného,
   jen přidává tlačítko „Nahlásit problém“ tomu, kdo už dnes smí zadávat úkoly.

## Doporučený další krok

1. Projít draft PR #60 a snímky. 2. Pustit migrace v pořadí (nejdřív Směny). 3. Prohlédnout si
`/vzkazy`, nový rozhovor a checklist → úkol s přihlášeným účtem (tohle jsem nemohl — nejvíc
riskantní je právě napojení na skutečná data, protože testy stojí na scénářích a ukázkových
datech). 4. Vygenerovat klíče VAPID a zkusit push na jednom telefonu (iPhone: přidat na plochu).
5. Rozhodnout body výše.
Jako další etapu doporučuji **E2E test hlavních cest** (poslat zprávu → vidět ji → vytvořit z ní
úkol; odškrtnout položku checklistu → nahlásit problém → vidět úkol v detailu) a **checklist →
diskusi/problém jako součást samotného checklistu** (dnešní řešení jde jen směrem „vytvoř úkol“,
ne „označ položku jako problémovou“ přímo v běhu).
