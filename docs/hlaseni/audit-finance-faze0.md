# Audit Finance Fáze 0 (krok 0) — stav k 19. 11. 2026

Výstup kroku 0 ze zadání `docs/finance-faze0-zadani.md`: co je hotové, co nesedí (soubor:řádek) a z čeho jsou čísla.
Nic jsem neměnil, nic neslučoval a nic nenasazoval. Do ostré databáze jsem posílal jen čtecí dotazy (`SELECT`).

- **Tenhle dokument** je přehled pro rozhodování: nejdůležitější nálezy, čísla a plán ke každému kroku.
- **Úplný seznam nálezů** (asi 300 položek, každá se souborem a řádkem) je v příloze
  [`audit-finance-faze0-nalezy.md`](audit-finance-faze0-nalezy.md).
- **Čtecí dotazy**, ze kterých jsou čísla, jsou v [`audit-finance-faze0-sql.sql`](audit-finance-faze0-sql.sql).
- **Otázky** jsou v `docs/hlaseni/otazky.md` jako č. 94–109. Na nic jsem nečekal. U každé jsem zvolil
  nejopatrnější variantu a napsal, co se změní, když to má být jinak.

---

## Nejdřív to podstatné

1. **Pravda je `main`, a bankovní vrstva v něm už je.** Ostatní kopie a větve nic navíc nenesou (oddíl „Odkud čtu").
   Main má platební účty, pohyby, párování s fakturami, konektory CSV, Fio, Enable Banking a Komerční banky
   (přímé API, jen čtení) a automatické párování. Zadání chce v kroku 1 nové tabulky `bankovni_ucty` a `bankovni_pohyby`.
   Ty by ale vedle stávajících postavily druhou, souběžnou vrstvu. **Krok 1 proto dokončuje a opravuje to, co existuje**
   (zadání :31 „co existuje, dokonči a oprav, nepiš znovu"). Otázka 94.

2. **„Otevřeno k úhradě 7,7 mil. Kč" je z větší části nespolehlivé číslo.**
   - Běžné schválené faktury jsou jen **4,95 mil. Kč** (508 faktur).
   - Možné duplicity přidávají **2,03 mil. Kč** a upomínky **0,82 mil. Kč**.
   - Upomínka je připomínka už vystavené faktury, takže se tentýž dluh často počítá dvakrát.
   - Ani 4,95 mil. není ověřené. Banka zatím nemá jediný pohyb, takže „zaplaceno podle banky" se nikdy u ničeho
     nezjišťovalo. Ruční „Uhrazeno" nedal nikdo nikdy.

3. **Banka je prázdná, ne rozbitá.** V databázi je 0 pohybů a 0 párování. Je tam jeden účet bez pobočky
   a bez čísla účtu, napojení KB je „odpojeno". Odtud prázdné Platby, cashflow 0 Kč a „chybí tržby" v Rozpočtech.

4. **Fronta 542 „Nutná ruční kontrola" nemá ve Foodtabu žádný soubor.** Všech 542 je z převodu ze staré databáze
   a žádná nemá přílohu v úložišti Foodtabu. 537 má jen odkaz na OneDrive, 5 nemá nic.
   **Nové přečtení přes Claude API (krok 8) tak dnes nemá z čeho číst.** Otázka 101.

5. **AI dnes zapisuje faktury rovnou mezi schválené.**
   - Do „Ke kontrole úhrady" zapsala 54 faktur za 615 353,64 Kč bez lidského schválení.
   - 248 příloh sama vyřadila jako „není doklad / dodací list / jiný doklad" a nikdo to nepotvrdil.
   - Zadání v kroku 8 říká „AI nic neschvaluje". Dnešní chování vychází z rozhodnutí 8. 10.
     (o průběžném zpracování) a příjem z e-mailu patří jiné relaci, proto jsem na něj nesahal. Otázka 102.

6. **Díry v právech, dnes teoretické, ale skutečné.** Dnes je nikdo nezneužije, protože kromě dvou majitelů nikdo
   nemá k Financím ani Fakturám žádné právo (0 lidí v zařazeních s `finance.*` nebo `faktury.*`). Jakmile ale někdo
   takové právo dostane:
   - pobočkový člověk s `finance.read` si přes REST přečte pohyby a párování celé firmy
     (`20261003120000_platebni_ucty_transakce.sql:203`);
   - šifrované přístupy k bance jdou přečíst funkcí, na kterou má grant každý přihlášený
     (`20261003160000_finance_public_rpc.sql:32`);
   - stav faktury jde přes REST přepsat na „Uhrazeno" bez schválení, a faktura jde rovnou „Uhrazeno" i založit
     (`20261018100000_faktury_v_hlavni_databazi.sql:653`, `:658`);
   - ruční párování „zaplatí" i fakturu „Ke schválení", „Odmítnuto" nebo „Duplicitní"
     (`20261018100000_faktury_v_hlavni_databazi.sql:1039`);
   - ručně vložený řádek se zdrojem `csv_banka` se tváří jako platba z banky
     (`20261008120000_platby_automaticke_parovani.sql:136`);
   - u objednávek jde přes REST zapsat „schváleno" s cizím jménem schvalovatele
     (`20261003200000_nakup_objednavky.sql:98`).

   První dvě opravuje krok 1, ostatní kroky 2 a 4.

7. **Jedno tlačítko umí hromadně odmítnout cizí faktury.** „Není faktura – odmítnout a zapamatovat" vybraný řádek natvrdo
   smaže. Pak bez náhledu přepne na „Odmítnuto" a do archivu všechny faktury dodavatele, jejichž název začíná stejnými
   15 znaky, i uhrazené a spárované (`app/[rozsah]/finance/faktury/akce.ts:374–389`, `:423`, `:433–435`, `:466`).
   Nic jsem neměnil. Opravu zařazuji do kroku 7 (duplicity), kde se akce nad duplicitami přestavují.

8. **Vlastní IČO firmy je u 23 faktur od 7 různých dodavatelů.** AI občas přečte IČO odběratele.
   Slučování dodavatelů podle IČO (krok 6) proto **musí vlastní IČO firmy vynechat**, jinak spojí nesouvisející firmy.

9. **Pokladna tržby má, Rozpočty je nepoužívají.** Z Dotykačky se každou hodinu stahuje denní prodej i platby podle
   způsobu. Rozpočty ale berou tržby jen z bankovních pohybů zařazených jako „Tržby" a takové nikdo nezařazuje.
   Odtud „chybí tržby". Foodcost a Beverage cost jsou „–", protože stojí na recepturách ve Foodtabu a ty nejsou
   (zadání je teď stavět zakazuje).

10. **Dočítání příjmu z e-mailu je pomalé.**
    - Za posledních 24 h to bylo kolem 4 přečtení AI za hodinu. Běhy úlohy jsou krátké a bez chyb.
    - Při tomhle tempu bude 919 vrácených příloh trvat kolem 10 dní.
    - Příčina je rozpočet času v úloze: vejde se do něj zhruba jedno čtení AI za volání
      (`lib/faktury-prijem-jadro.ts:610`).
    - pg_cron a GitHub spouštějí úlohu ve stejnou minutu (:09 a :39), takže se srazí na zámku.
    - Patří to relaci příjmu. Zapsal jsem to, neměnil.

---

## Odkud čtu — větve a kopie

- **`origin/main` 88935dc** (sloučení PR #182, 18. 11.) je poslední sloučený stav a podle zadání úlohy i produkce
  na Vercelu. Main má 196 migrací, poslední je `20261108100000`. Práce běží ve větvi `finance-faze0` z tohoto commitu.
- Všech 25 lokálních větví `finance-*`, `banka-*` a `faktury-*` je sloučených, včetně `finance-foodcost-beverage`.
  Žádná nesloučená vzdálená větev s tímto jménem není.
- Kopie jmenované v zadání (`foodtab-finance-erp`, `foodcost`, `banka-*`, `faktury-*`, `integrace`) mají HEAD v main
  a žádné necommitnuté změny. Dvě výjimky mají obsah v main jinou cestou:
  - `foodtab-gastro-erp` šla do main přes PR #99–#102 a #104;
  - `foodtab-banka-upresneni` přes PR #117 (`git cherry` ukazuje, že tentýž patch je v main).
- **`foodtab-rizeni` je 577 commitů za main** (poslední migrace `20260917060000`). Zadání :29 a návrh :25 tvrdí, že
  novější práce je v jiných kopiích. To neplatí: stavět na kterékoli jiné kopii by znamenalo stavět na starém stavu.
- Mimo zadání jsem našel jedinou zajímavou větev: **`oprava-audit-log-fk-pravidlo`** (2. 10., bez PR).
  Opravuje pád při mazání pobočky, která má řádek v audit logu. Její migrace v main není. Podle kódu chyba v main
  trvá: `audit_log.branch_id` má `on delete set null` (`20260823120000_foundation.sql:313`) a pravidlo, které
  zakazuje měnit audit (`:325`), tu změnu odmítne. Samotné zápisy do auditu kvůli tomu neselžou, jen mazání
  pobočky. Otázka 106.
- Otevřené PR (#180, #153, #152, #133, #2) se Fáze 0 netýkají. PR #153 nese migraci se starším razítkem, než je
  poslední v main, a před sloučením ji bude potřeba přerazítkovat.
- Dokumenty se zadáním (`finance-faze0-zadani.md`, `finance-erp-navrh.md`, `faktury-modul-zadani.md`) nebyly v gitu.
  Commitnul jsem je do `finance-faze0` jako první commit (0d9f52d), ať je zřejmé, podle čeho se pracovalo.

---

## Čísla z ostré databáze — a z čeho jsou

Všechno jsou čtecí dotazy (jen `SELECT`) přes Supabase CLI napojené na `spekntcsuroqhehmjssv`
(foodtab-test = ostrý provoz). Pouštěl jsem je 18. 11. večer a 19. 11. odpoledne. Mezi oběma dny přibyly nové faktury
z příjmu, proto se některé počty o jednotky liší (1777 → 1778). Firma je v databázi jedna, faktur je celkem 3101.

### „Otevřeno k úhradě" 7,7 mil. Kč — z čeho se skládá

Přesně podle logiky stránky: nearchivované faktury se stavem mimo Uhrazeno / Ke schválení / Odmítnuto
(`lib/faktury-types.ts:62`). Stav k 18. 11. večer, s číslem v aplikaci sedí na haléř:

| Složka | Faktur | Kč |
|---|---:|---:|
| Ke kontrole úhrady (běžná schválená faktura) | 508 | 4 953 035,18 |
| Upomínka - zkontrolovat | 510 | 824 138,04 |
| Možné duplicity (všechny čtyři varianty „Duplicitní - zkontrolovat (…)") | 217 | 2 029 867,59 |
| Nutná ruční kontrola (…), všechny s částkou 0 Kč | 542 | 0,00 |
| **Celkem** | **1777** | **7 707 040,81** |

K 19. 11. odpoledne: 1778 faktur, 7 759 775,56 Kč.

- **Duplicity jsou v „otevřeno" celé.** Je to 2,03 mil. Kč, víc než čtvrtina čísla.
- **Upomínky s částkou nad 0 Kč: 60 kusů, 876 872,79 Kč.** Z toho 101 084,21 Kč má u téhož dodavatele otevřené
  „dvojče" se stejnou částkou, tedy nejspíš původní fakturu. Ostatní upomínky mají částku 0 nebo původní fakturu
  nemají (třeba proto, že je zaplacená mimo Foodtab).
- **„Cizí měna" je ve skutečnosti prázdná měna.** 82 otevřených faktur má `mena = ''` a částku 0 Kč (5 v Ke kontrole
  úhrady, 77 upomínek). Eurové faktury mezi otevřenými nejsou, takže sčítání napříč měnami se dnes neprojeví.
  Kód ho ale dovolí (`app/[rozsah]/finance/faktury/page.tsx:106`).
- Částečně uhrazené: 0. Dobropisy (záporná částka) mezi otevřenými: 10.

### „Po splatnosti" 7,06 mil. Kč (19. 11.: 665 faktur) — jak je to staré

| Po splatnosti | Faktur | Kč |
|---|---:|---:|
| více než 250 dní (nejstarší splatnost 25. 6. 2025) | 217 | 2 375 545,45 |
| 181–250 dní | 191 | 1 761 962,02 |
| 91–180 dní | 175 | 1 789 573,92 |
| 31–90 dní | 47 | 723 415,13 |
| 1–30 dní | 35 | 407 897,77 |

- Z „po splatnosti" připadá **1 868 966,26 Kč na možné duplicity** a **711 681,58 Kč na upomínky**.
- **1 090 otevřených faktur nemá splatnost vůbec** (1 023 z nich má i částku 0), takže je „po splatnosti" ani
  kalendář neukáže.
- Kalendář splatností ukazuje o jednu fakturu víc než Přehled, protože nefiltruje archiv
  (689 = 688 nearchivovaných + 1 archivovaná; `app/[rozsah]/finance/faktury/kalendar/page.tsx:39`).
  Odznak ve Fakturách a obrazovka Dnes navíc počítají „po splatnosti" i u odmítnutých nearchivovaných faktur a každé
  místo bere jiné „dnes" (UTC, hodiny serveru, provozní den; `app/[rozsah]/finance/faktury/layout.tsx:84–91`).

### Kopie téhož souboru (pro krok 7)

- 2 354 převedených faktur má kopii souboru v úložišti Foodtabu. Jméno souboru je otisk obsahu, takže stejný soubor
  se pozná jistě.
- **Stejný soubor, stejné číslo i stejná částka**: 353 skupin, 837 faktur. Jako duplicita je z nich označených jen 121.
- Většina „dalších kopií" je dávno odmítnutá a v archivu s 0 Kč (376). V otevřených součtech ale zůstávají:
  - 81 dalších kopií, které **jsou** označené jako duplicita, za 746 804,50 Kč;
  - **28 dalších kopií, které označené nejsou**, za 126 382,18 Kč (12 v Ke kontrole úhrady, 16 upomínek s 0 Kč).
    Dnešní spoušť je nechytí: jde o faktury bez čísla nebo o stejný soubor pod jiným názvem dodavatele.
- Z 217 označených duplicit je tedy jistá kopie souboru jen u 81 (a 2 v archivu). Zbylých 136 označila stará spoušť
  z n8n podle dodavatele a čísla. Jestli jde o tutéž fakturu poslanou dvakrát, nebo o falešnou shodu, se rozhodne až
  u každého případu zvlášť (krok 7).
- Pravidlo „dodavatel + číslo" (bez částky a data): 101 skupin, 320 faktur. Z nich 82 skupin má shodnou i částku
  a datum a u 8 skupin se částka liší, takže může jít o opravný doklad.
- Stejné IČO a číslo faktury pod různými názvy dodavatele: 13 skupin, 40 faktur, z nich 12 označených. Spoušť
  porovnává přesný text názvu, proto je nechytí.
- E.ON: 4 otevřené faktury bez čísla, žádná není označená jako duplicita. Podle zadání nejsou duplicitou samy o sobě.

### Fronta 542 „Nutná ruční kontrola" (krok 8)

- Všech 542 je z převodu ze staré databáze (n8n), přijaté mezi 5. 1. a 4. 9. 2026.
  535 je obrázek, 5 nečitelné PDF, 1 „AI nevytáhla údaje" a 1 „možná to není faktura".
- Všechny mají částku 0 a prázdného dodavatele. **Žádná nemá soubor v úložišti Foodtabu** (`priloha_cesta` i `odkaz_pdf`
  jsou prázdné). 537 má jen odkaz na OneDrive, 5 nemá žádný odkaz.
- Je to jiná fronta než „Přečíst znovu" v příjmu z e-mailu. Tam čeká 919 příloh vrácených po výpadku AI
  (709 PDF, 210 obrázků, asi 190 MB) a ty soubor mají.

### Příjem z e-mailu a AI (stav 19. 11.)

- AI zapsala **rovnou do „Ke kontrole úhrady" 54 faktur (615 353,64 Kč)**, do „Ke schválení" 20 a do „Upomínky" 16.
  ISDOC (strojově čitelná faktura) jich zapsal rovnou do „Ke kontrole úhrady" 7.
- AI sama vyřadila 248 příloh jako „není doklad / dodací list / jiný doklad", 225 s vysokou a 23 se střední jistotou.
  Nikdo to nepotvrzoval.
- Ze 1 272 přečtení AI má 920 (9.–27. 10.) prázdný údaj o modelu a 352 `claude-opus-5-5`.
- Lidé ve Fakturách 18. 11. schválili 53 dokladů „Ke schválení → Ke kontrole úhrady" a 7 přeřadili na upomínku.
  Ruční „Uhrazeno" nedal nikdo nikdy (audit je prázdný).
- Převod ze staré databáze je dokončený od 22. 10.

### Banka, účty, pobočky

- `platebni_ucty`: 1 účet (typ banka, aktivní, **bez pobočky, bez čísla účtu, počáteční zůstatek 0**).
- `transakce`, `platby_faktury`, `bankovni_zustatky`, `import_davky` a `predpisy_plateb` mají 0 řádků.
  Odtud prázdné Platby i cashflow 0 Kč.
- `integrace_pripojeni` pro banku: jedno připojení Komerční banky, stav **odpojeno**, bez pobočky.
  Enable Banking ani Fio připojené nejsou. Jinak jsou připojené 3 e-mailové schránky a Dotykačka u obou podniků.
- Pobočky Bernard Bar Tábor a Restaurace Černá Perla nemají žádný platební účet.

### Dodavatelé (krok 6)

- IČO je vyplněné u 797 faktur (792 v osmimístném tvaru, 5 v jiném), prázdné u 2 323. Prázdné jsou všechny z převodu.
- 103 různých názvů a 70 různých IČO. 13 IČO vystupuje pod více názvy (445 faktur). MAKRO má 17 názvů a 137 faktur.
- **Pod IČO 21249946, což je vlastní IČO FoodTab s.r.o. (odběratel), je 23 faktur od 7 různých dodavatelů.**
- `kontakty` (dnešní registr dodavatelů ve Financích) má 0 záznamů. Tabulky `dodavatele`, `nakladove_kategorie`,
  `faktury_polozky`, `bankovni_ucty` a `bankovni_pohyby` neexistují.

### Práva (krok 4)

- Firma má 2 majitele (rozsah celá firma) a 13 dalších lidí s rozsahem pobočky.
- Zařazení s právy `finance.read`, `finance.manage`, `purchasing.*`, `integrace.manage` a `approvals.decide` existují,
  ale **nikdo v nich není**. `faktury.*` není v žádném zařazení a výjimky u lidí pro tato práva nejsou žádné.
  **Finance a Faktury dnes v praxi vidí a mění jen majitelé.**
- Aktivní moduly: finance, marketing, provoz. **Modul Objednávky aktivní není**, proto Nákup hlásí „nemáte oprávnění"
  i majiteli.
- Granty pro přihlášené na `public.faktury` v ostré databázi sedí s migrací. Je to INSERT do všech sloupců (včetně
  `stav`, `duplicita`, `ke_kontrole`) a UPDATE jen sloupců `stav`, `poznamka_kontroly`, `archivovano`
  a `upominka_odeslana_kdy`.

---

## Kroky 1–9: co je hotové, co nesedí a co s tím dělám

U každého kroku tu jsou jen nejdůležitější nálezy. Všechny jsou v příloze pod stejným nadpisem.

### Krok 1 — neutrální bankovní vrstva

**Hotové:**
- Tabulky jsou: účty (firemní, nebo s pobočkou), pohyby jen k přidávání (UPDATE blokuje pravidlo, DELETE chybí
  v grantech) a importní dávky s unikátním otiskem souboru (`20261003120000_platebni_ucty_transakce.sql:27`, `:79`, `:191`).
- Import CSV je hotový, stejně jako konektory Fio, Enable Banking a KB přes přímé API, jen ke čtení (`lib/kb-adaa.ts`).
- Přístupy k bance jsou šifrované a synchronizace má záznam běhů.

**Nesedí:**
- `supabase/migrations/20261004100000_banka_napojeni.sql:97` — jména bank a agregátorů (`fio_api`,
  `bankovni_agregator`) jsou v kontrolách jádra. Zadání chce v jádru nic bankovně specifického.
- `supabase/migrations/20261003120000_platebni_ucty_transakce.sql:97` — pohyb nemá účet protistrany (IBAN).
  Konektory ho přitom znají a vkládají ho jen jako náhradu jména (`lib/kb-adaa.ts:414–427`, `lib/integrace-fio.ts:132–144`).
- Pohyb bez externího ID nemá otisk, takže dvakrát nahraný výpis z jiného zdroje se zdvojí.
  Detekci duplicit mezi zdroji nikdo nevolá (`20261004100000_banka_napojeni.sql:412`).
- `app/[rozsah]/finance/platby/import/akce.ts:84` — dávka se založí jako „zpracováno" dřív, než se vloží řádky.
  Když vložení spadne, zůstane prázdná dávka, a stejný soubor pak nejde nahrát znovu.
- `supabase/migrations/20261003120000_platebni_ucty_transakce.sql:203` — čtení pohybů nehlídá pobočku
  (`can_read_scoped(…, null)` se redukuje na samotné právo).
- `supabase/migrations/20261003160000_finance_public_rpc.sql:32` — funkci, která vrací rozšifrované přístupy,
  smí volat každý přihlášený. Kontrola práva je až uvnitř.
- `app/[rozsah]/finance/platby/import/akce-nahled.ts:57` — výpis se čte jen jako UTF-8. Česká banka může poslat
  windows-1250 a diakritika se rozbije.
- Cashflow začíná od nuly (`lib/finance-rolling-prehled.ts:136`). Počáteční zůstatek nejde v aplikaci zadat vůbec.
  Dnešní zůstatek sčítá všechny účty bez ohledu na typ a měnu (`20261003190000_aktualni_zustatky.sql:16`).
- Bankovní storno nemá vazbu na původní platbu (`lib/kb-adaa.ts:396`), takže spárovaná faktura zůstane „Uhrazeno".

**Co dělám:**
- Stavím na existujících tabulkách. Doplňuji účet protistrany a otisk pohybu (včetně pořadí stejných řádků ve výpisu).
- Jména bank z jádra mizí: konektory zapisují obecný zdroj `banka_api` a konkrétní banka je jen vlastnost připojení.
- Import vytvoří dávku i řádky v jedné transakci.
- Čtení pohybů a zůstatků omezuji podle pobočky účtu.
- Přístupy k bance se přihlášeným vůbec nevracejí. Rozšifruje je jen server, a to po ověření práva.
- Komerční banku napojuji přes CSV import. Formát výpisu KB bez vzorku neodhaduji (otázka 95). Přímé API KB zůstává,
  jen čeká na registraci (otázka 96).

### Krok 2 — párování faktur s platbami

**Hotové:**
- Párování s částkou a stavem je hotové, stejně jako automatika: po jednoznačné shodě VS + přesná částka + jméno
  nastaví „Uhrazeno".
- Funguje ruční potvrzení a zrušení párování, kontrola, že součet párování nepřesáhne platbu, a audit změn.

**Nesedí:**
- `lib/finance-parovani.ts:96–103` — váhy shody: VS a částka dají dohromady 0,8, tedy pod prahem 0,9. Návrh tak
  bez shody jména nevznikne. IBAN se nepoužívá vůbec.
- `app/[rozsah]/finance/platby/page.tsx:29–32`, `:317` — návrhy se počítají při každém načtení jen nad 30 posledními
  pohyby a nikam se neukládají. Nejde je tedy odmítnout. Fronta „Platby bez faktury" neexistuje.
- `app/[rozsah]/finance/faktury/akce.ts:176–190` — ruční „Uhrazeno" neukládá důvod. Autor je jen nepřímo v audit logu.
- `supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql:1039–1075` — ruční párování nekontroluje stav
  faktury. Po zrušení párování dá fakturu na „Neuhrazeno" (`:959`), takže předchozí stav (třeba „Ke schválení")
  se ztratí.
- Ruční párování nehlídá měnu platby (`:1008–1011`): centy z eurového účtu se porovnají s haléři.
- Faktura v cizí měně ani dobropis se nepárují vůbec (`:958`).
- `app/[rozsah]/finance/faktury/akce.ts:244–259` — „Vrátit mezi neuhrazené" není atomické.
  Když druhý krok selže, faktura zůstane „Uhrazeno" bez párování.
- `lib/integrace-enablebanking.ts:174` — pohyby přes Enable Banking mají VS vždy prázdný,
  takže se automaticky nespárují nikdy.

**Co dělám:**
- Jisté párování = VS + částka + IBAN dodavatele. Částka + dodavatel + datum je jen návrh.
- Návrhy se ukládají a jdou odmítnout. Vzniká fronta „Návrhy párování" a „Platby bez faktury".
- Funguje platba za víc faktur, částečná platba, cizí měna (porovnání v měně faktury, bez přepočtu kurzem; otázka 97)
  a dobropisy.
- Ruční „Uhrazeno" chce důvod a autora.
- Zrušení párování vrátí fakturu do stavu, který měla před ním.
- Párovat jde jen schválenou fakturu, nikdy duplicitu nebo „Ke schválení".

### Krok 3 — pobočky a účty

**Hotové:**
- Účet může patřit pobočce. Platby i cashflow pobočky bez účtu to řeknou větou.

**Nesedí:**
- `lib/finance-kpi-vypocet.ts:197` — v pohledu Celá firma nikde nestojí, které pobočky účet nemají.
  Pobočky bez účtu jsou dnes obě.
- `supabase/migrations/20261003120000_platebni_ucty_transakce.sql:31` — databáze nehlídá, že pobočka účtu patří
  téže firmě.
- `app/[rozsah]/finance/platby/page.tsx:728` — nový účet má ve formuláři výchozí volbu „Celá firma".
- Každá obrazovka chápe „pobočka má účet" jinak: Rozpočty a Přehled počítají i vypnuté účty, Platby a cashflow jen
  aktivní (`app/[rozsah]/finance/rozpocty/page.tsx:128–132` proti `platby/page.tsx:296`).
- `app/[rozsah]/finance/rozpocty/page.tsx:151–156` — chyby dotazů se v Rozpočtech tiše mění na nuly.
  Chyba přehledu se ztratí úplně (`:155`, `supabase.rpc` výjimku nevyhazuje).
- `lib/finance-evidence-pobocka.ts:121` — hláška posílá do „Celá firma → Platby". Sekce s výběrem pobočky tam ale je
  jen pro toho, kdo smí účty spravovat.

**Co dělám:**
- Celá firma vypíše pobočky bez aktivního účtu jménem.
- Spoušť v databázi zablokuje pobočku z jiné firmy (hotové v kroku 1).
- Nový účet bude chtít výslovnou volbu pobočky nebo „firemní účet", bez výchozí hodnoty.
- „Má účet" se bude počítat všude stejně: jen aktivní účty.
- Který účet patří které pobočce, je otázka 98. Do odpovědi jsem nic nepřiřazoval.

### Krok 4 — právo „Schvalovat nákupy a platby"

**Hotové:**
- Práva fungují po zařazeních a výjimkách u lidí, s rozsahem firma nebo pobočka.
- Audit log zapisuje změny faktur (bez čísla účtu dodavatele).

**Nesedí:**
- Nové právo zatím neexistuje. „Schválení" faktury chce jen `faktury.manage` (`app/[rozsah]/finance/faktury/akce.ts:281–292`).
  Potvrzení párování, a tím „Uhrazeno", chce `finance.manage` + `faktury.read` (`20261018100000…:1017–1025`).
- Tři cesty k „zaplaceno" obejdou jakékoli schválení:
  - přímý zápis stavu přes REST (`:658`);
  - založení faktury rovnou „Uhrazeno" (`:653`, žádný CHECK na stav);
  - CSV import výpisu, který spustí automatiku (`app/[rozsah]/finance/platby/import/akce.ts:97–101`).
- `supabase/migrations/20260909100000_zarazeni_jadro.sql:686–691` — spolumajiteli jde nastavit rozsah pobočky.
  „Majitel má právo vždy" pak bezpodmínečně neplatí.
- Faktury nemají pobočku (`20261018100000…:46`), takže omezení schvalování na pobočku nemá podle čeho fungovat.
- Audit schválení nezapisuje částku ani důvod.

**Co dělám:**
- Nové právo má volitelný limit částky a omezení na pobočky. Majitel ho má vždy a nejde mu odebrat.
- Kontroluje ho server a každé schválení se auditem zapíše i s částkou.
- Granty na přímý zápis stavu a založení „Uhrazeno" zavírám.
- **Celé, nebo nic:** buď projdou všechny kontroly a rozbití, nebo se krok necommituje vůbec.
- Při zavedení dostane právo jen majitel (otázka 99).

### Krok 5 — kategorie nákladů

**Hotové:**
- Rozpočty mají pevný výčet kategorií.
- Foodcost a beverage cost se počítají teoreticky z receptur a prodejů z pokladny.

**Nesedí:**
- `supabase/migrations/20261003210000_rozpocty_controlling.sql:33–35` — kategorie je pevný seznam ve sloupci pohybu.
  Žádný import ji nevyplní a dodatečně ji zapsat nejde (pohyb je jen k přidávání, `20261003120000…:191`).
- `app/[rozsah]/finance/page.tsx:289` — odtud „Zatím žádné kategorizované náklady".
- Faktury nemají kategorii ani položky (`20261018100000…:293–334`). AI čte jen hlavičku dokladu (`lib/faktury-prijem-ai.ts:293`).
- `lib/ucetni-export.ts:99` — sloupec Kategorie v účetním exportu je vždy prázdný.
- `app/[rozsah]/finance/faktury/prehledy/page.tsx:94–114` — přehledy sčítají částky bez ohledu na měnu
  a faktura bez DUZP z nich tiše vypadne. Ukazatel úplnosti není nikde.

**Co dělám:**
- Vzniká tabulka kategorií s příznakem COGS (jídlo / nápoj / ne) a základní sadou ze zadání.
- Kategorie se dá zapsat k faktuře a dodavatel dostane výchozí kategorii.
- AI kategorii jen navrhuje, potvrzuje člověk.
- „Náklady podle kategorie" ve Fakturách budou s ukazatelem úplnosti a jen v Kč.
- Finální osnovu dodá účetní (otázka 100).

### Krok 6 — jeden registr dodavatelů

**Hotové:**
- Tabulka `kontakty` existuje (prázdná). Faktury nesou název a IČO dodavatele jako text.

**Nesedí:**
- `supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql:299` — faktura odkazuje na dodavatele jen textem.
  Karta dodavatele, filtr i počet „aktivních dodavatelů" seskupují podle přesného textu
  (`app/[rozsah]/finance/faktury/dodavatele/page.tsx:86`, `lib/faktury-filtry.ts:44`).
- `supabase/migrations/20261003110000_kontakty.sql:48` — kontakty jsou unikátní podle názvu malými písmeny,
  diakritiku a „s.r.o." ale nesjednotí.
- `supabase/migrations/20261003110000_kontakty.sql:64` — každý registr řídí jiné právo. Nákup bere dodavatele
  z kontaktů pod `purchasing.read`, RLS je ale pustí jen s `finance.read` (`app/[rozsah]/finance/nakup/page.tsx:117`).
- `lib/faktury-prijem-kontrola.ts:364` — doklad s platným IČO, ale bez čitelného názvu se zapíše s prázdným dodavatelem
  a vypadne ze všech počtů.
- `app/[rozsah]/finance/faktury/dodavatele/page.tsx:160` — karta má popisek „Od 1. 1. 2026", ale data bere bez filtru
  data. Sčítá napříč měnami a včetně duplicit a dokladů „Ke schválení".
- IBAN přidaný do registru by se celý zapsal do audit logu, který čte i správce bez práva na Faktury
  (`20260831020000_audit_lidi_a_roli.sql:38`). Faktury proto mají vlastní audit se skrytým účtem.

**Co dělám:**
- Registr s klíčem IČO, aliasy názvů a odkazem z faktury na registr. Text faktury zůstává, nic se nepřepisuje.
- Sloučení jsou jen návrhy, potvrzuje je člověk a jdou vrátit.
- **Vlastní IČO firmy se nikdy nepáruje.**
- Dodavatelé bez IČO se sami nesloučí nikdy.
- Pro registr platí jedno právo (otázka 103).

### Krok 7 — duplicity

**Hotové:**
- Spoušť při vložení označí pozdější fakturu se stejným dodavatelem a číslem a prázdné číslo ignoruje.
- Příjem z e-mailu pozná stejný soubor podle otisku.

**Nesedí:**
- `supabase/migrations/20261018100000_faktury_v_hlavni_databazi.sql:521–528`, `:542–544` — pravidlo je jen přesný text
  dodavatele a čísla. Běží jen při vložení, neukládá, s čím se faktura shoduje, a otisk souboru ani IČO nepoužívá.
- `:530–532` — předpona „Duplicitní - zkontrolovat (…)" se přidá do stavu. Faktura „Ke schválení" tím zmizí z fronty
  ke schválení (`app/[rozsah]/finance/faktury/schvaleni/page.tsx:41`) a začne se počítat do otevřených částek.
- `app/[rozsah]/finance/faktury/page.tsx:102–107` — duplicity jsou ve všech součtech, v návrzích párování
  (`app/[rozsah]/finance/platby/page.tsx:224`) i v kalendáři.
- `app/[rozsah]/finance/faktury/seznam/page.tsx:295–323` — jediné akce nad duplicitou jsou natvrdo smazat, archivovat,
  nebo „Není faktura" (smaže a hromadně odmítne, viz bod 7 nahoře).
- Rozhodnutí „není duplicita" zapsat nejde. Přihlášený nemá právo měnit sloupec `duplicita` (`:658`).

**Co dělám:**
- Duplicita se rozhodne „je / není" vedle sebe s originálem. Nic se nemaže a potvrzená duplicita vypadne ze všech součtů.
- Pravidlo: stejný soubor, nebo (dodavatel podle IČO či názvu, číslo, částka, datum). Faktura bez čísla sama
  duplicitou není.
- Stavy se už nebudou obalovat předponou. Duplicita je samostatný příznak s odkazem na originál.
- „Není faktura" přestane mazat a odmítat podle prvních 15 znaků jména.
- Vzor rozhodnutí s důvodem a kontrolou na serveru už v repozitáři je, u Jiných plateb (`20261016100000_jine_platby.sql:196`).

### Krok 8 — fronta ke kontrole a nové čtení AI

**Hotové:**
- AI čte PDF jako dokument a fotky jako obrázek, bez OCR. Výstup se kontroluje schématem.
- Funguje model `claude-opus-5-5` s úsilím high, denní strop 300 a „Přečíst znovu" u příjmu.

**Nesedí:**
- `lib/faktury-types.ts:62–68` — fronta 542, upomínky i duplicity se počítají do přehledů. Zadání chce „ne rovnou
  do přehledů".
- `lib/faktury-prijem-kontrola.ts:349–357` — doklad s vysokou jistotou jde rovnou do „Ke kontrole úhrady".
  Upomínka jde do „Upomínka - zkontrolovat" bez ohledu na jistotu.
- `lib/faktury-prijem-kontrola.ts:318` — „není doklad / dodací list / jiný doklad" se do Faktur nezapíše vůbec,
  při jakékoli jistotě.
- `lib/faktury-prijem-ai.ts:67` — schéma výstupu má jen celkovou částku: žádný rozpis DPH ani položky.
- `lib/faktury-prijem-jadro.ts:894` — hromadné „Přečíst znovu" vezme všechny řádky schránky bez vzorku a bez odhadu ceny.
- `lib/faktury-prijem-jadro.ts:610` — rozpočet času v úloze stačí zhruba na jedno čtení AI za volání (příčina pomalého
  dočítání).
- `app/[rozsah]/finance/faktury/schvaleni/page.tsx:168` — obrazovka slibuje, že se AI „příště poučí". Tabulku vzorů
  odmítnutí ale nikdo nečte.

**Co dělám v noci:**
- Jen přípravu a odhad ceny, bez hromadného běhu. Ten se spustí až se souhlasem majitele.
- Výsledky půjdou do „Ke schválení", AI nic neschvaluje.
- **Blokuje to, že fronta 542 nemá soubory** (otázka 101). Zkouška na vzorku 20 by navíc potřebovala nasazení nebo
  klíč služby. Nedělám ani jedno, popíšu to v hlášení.

### Krok 9 — suchý běh „zaplaceno podle banky" a přehledová čísla

**Hotové:**
- Automatické párování umí jednoznačnou shodu rozpoznat.

**Nesedí:**
- `lib/faktury-types.ts:62` a `app/[rozsah]/finance/faktury/page.tsx:106` — součet bere plnou částku i u částečně
  uhrazených a sčítá měny.
- `lib/finance-automaticke-parovani.ts:54` — automatika sahá jen 180 dní zpět. Starší faktury tedy nikdy nezavře.
- `lib/finance-rolling-prehled.ts:94` — cashflow na 13 týdnů faktury nečte vůbec, jen předpisy plateb.
- `lib/finance-parovani.ts:150` — „Ke kontrole úhrady" znamená „schválená, čeká na platbu". Název vede k omylu.
- Suchý běh ani hromadný nástroj neexistuje.

**Co dělám:**
- Suchý běh, který vypíše faktury, jejichž úhradu banka potvrzuje, do souboru v `docs/hlaseni/`. Data nemění.
- **S dnešními 0 pohyby bude seznam prázdný.** Nástroj bude připravený na den, kdy přijdou výpisy KB.

---

## Pokladna (Dotykačka) — tržby a podklad pro foodcost

**Hotové:**
- Každou hodinu se stahuje denní prodej po produktech (název, množství, tržba) a platby podle způsobu platby.
  Z nich se skládá přehled Tržeb.
- Katalog produktů s recepturami z Dotykačky (`pos_katalog.suroviny`) se načítá, ale jen pro Jiné platby.

**Nesedí:**
- `supabase/migrations/20261011100000_pokladna_univerzalni_napojeni.sql:324–353` — foodcost stojí jen na recepturách
  ve Foodtabu, které se k prodeji přiřadí přesnou shodou názvu. Receptury z Dotykačky do výpočtu nevstupují.
- `lib/pos-provider-contract.ts:39–43`, `lib/pokladna-dotykacka.ts:215–231` — prodej se ukládá podle názvu, bez id
  produktu a bez kategorie. Dva produkty se stejným jménem se slijí a tržby se nedají rozdělit na jídlo a nápoje.
- `lib/pokladna-dotykacka.ts:33–36` — ukládá se tržba, nejspíš s DPH (naživo neověřeno). Hodnota bez DPH se zahazuje.
- `app/[rozsah]/finance/rozpocty/page.tsx:161–164` — Rozpočty tržby z pokladny nepoužívají (proto „chybí tržby").
- `lib/pokladna-dotykacka.ts:499–500` — skladové pohyby, stav skladu ani spotřebu aplikace nečte.
- `lib/pokladna-cas.ts:131–138` — každá synchronizace přepisuje jen poslední 3 provozní dny. Storno nebo oprava
  uzávěrky starší než 3 dny se do Foodtabu nepropíše nikdy, takže měsíční tržby se mohou trvale lišit od Dotykačky.
- `lib/pokladna-dotykacka.ts:237–240` — produkt se záporným denním součtem (vratka, sleva, záloha) se zahodí.
  Uložená tržba pak může být vyšší než čistá tržba. Jestli Dotykačka slevy takhle posílá, je neověřené.
- `lib/finance-kpi-vypocet.ts:198`, `:217–218` — „Náklady práce %" dělí mzdy tržbou z pokladny, která je podle
  kontraktu s DPH. Procento je tak podhodnocené zhruba o sazbu DPH.
- `lib/finance-kpi-vypocet.ts:113–124` — až vzniknou první receptury, foodcost % vydělí jen spočítané náklady celou
  tržbou druhu. Ukáže se podhodnocené číslo nebo „0,0 %" a ukazatel pokrytí, který se už počítá, žádná obrazovka neukazuje.

**Co z toho plyne:**
- Pro Fázi 2 jsou použitelné prodané položky po dnech a receptury v `pos_katalog`.
- Než se na tom začne stavět, je potřeba vyřešit id produktu, dělení na jídlo a nápoje a tržbu bez DPH (otázka 104).
- Ve Fázi 0 na pokladnu nesahám, s jedinou výjimkou: v Rozpočtech ukážu, odkud tržby jsou a co znamená „chybí tržby"
  (krok 3).

---

## Co jsem při auditu nezjistil

- **Produkci na Vercelu jsem s 88935dc neporovnával.** Že produkce = 88935dc, beru ze zadání úlohy.
- `git fetch` jsem nespouštěl. Stav originu je z 18. 11. 15:39. Že od té doby nic nepřibylo, potvrzuje jen
  `gh pr list --state merged`.
- Jestli jsou na Vercelu nastavené proměnné pro přímé API KB, nevím. Proměnné jsem nečetl.
- Jestli tržba z Dotykačky je s DPH, nevím. Potvrdit to umí jen denní uzávěrka (otázka 104).
- Obrazovky jsem v prohlížeči neviděl. Všechno je z kódu a z databáze.
- Druhý ověřovatel prošel všech jedenáct oblastí: 234 tvrzení potvrdil, 115 upřesnil a 2 vyvrátil.
  Obě vyvrácená tvrzení byla o větvích („zadání není v gitu" a „dokument auditu neexistuje"). Mezi auditem a ověřením
  přestala platit, protože jsem obojí commitnul.
- Ověřovatel větví upozornil, že **commitnutý mezistav kroku 1 se nedá nasadit samostatně**. Migrace už zakazuje číst
  přístupy k bance přes RPC, ale commitnutý kód to tak ve třech místech pořád dělá. Opravu dodělává právě běžící
  krok 1. Nasazovat se smí jen celý krok.

---

## Jak audit vznikl

- Jedenáct oblastí (větve, banka, párování, pobočky a účty, práva, kategorie, dodavatelé, duplicity, kontrola AI,
  model faktur, pokladna) prošlo jedenáct samostatných auditorů. Každý četl kód v `finance-faze0` = `main`
  a k číslům navrhl čtecí dotazy.
- Každou oblast pak **nezávisle ověřil druhý agent**. Měl za úkol každé tvrzení vyvrátit: otevřít citované řádky,
  zkusit protipříklad a opravit přesné místo. Upřesnění jsou v příloze u každé položky.
- Čtecí dotazy jsem pustil sám přes Supabase CLI. Výsledky jsem zkontroloval proti číslům v aplikaci:
  „Otevřeno k úhradě" sedí na haléř.
- Dva běhy přerušilo vypršelé přihlášení a jeden ukončená relace. Pokračovaly z uloženého stavu, nic se neopakovalo
  nad změněnými daty.
