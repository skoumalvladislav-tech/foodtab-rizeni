# Bankovní modul pro gastro ERP — návrh a zadání Claude Code

Aktualizováno 4. 10. 2026. Navazuje na prodejnou aplikaci pro více zákazníků, gastro ERP, hotové Faktury a vyměnitelné integrace. Nejde o provedené připojení skutečných bankovních účtů ani o audit aktuální implementace.

## Doporučené řešení

Jednotný modul Banka a platby v gastro ERP se třemi zdroji: multibank agregátor, vybrané přímé bankovní API a ruční import výpisu. Všechny zdroje zapisují do stejného interního modelu. Úhrady faktur a cashflow pracují s tímto modelem, nikoli s konkrétní bankou.

Pro první produkční integraci posoudit Finbricks MULTIBANK a Enable Banking. Finbricks nabízí multibank rozhraní; Enable Banking dokumentuje přístup k účtům, zůstatkům a transakcím. Ověřit pokrytí konkrétních českých bank i firemních účtů, kvalitu VS/reference, historii, obnovu souhlasů, cenu a smluvní model pro SaaS. Nelze předem tvrdit, že podporují každý účet nebo že jsou pro tento produkt zdarma.

Přímé Fio API je vhodný volitelný adapter pro zákazníky Fio. Nesmí být jedinou cestou ani určovat schéma produktu. CSV a případně CAMT.053/ABO poskytnou fallback a historická data. Implementovat pouze konkrétní ověřené varianty formátů.

První verze pouze čte data. Nevytváří ani neodesílá bankovní platební příkazy. Produkční použití agregátoru pro účty zákazníků vyžaduje schválený obchodní a regulatorní model; sandbox nebo osobní bezplatný přístup nestačí. Z toho se nesmí automaticky dovozovat, že provozovatel ERP vlastní licenci potřebuje nebo nepotřebuje — ověřit smlouvu a role s poskytovatelem.

## ZAČÁTEK PROMPTU

Rozšiř existující Foodtab Řízení o modul Banka a platby. Jde o prodejný gastro SaaS pro více nezávislých zákazníků s různými bankami, více právními subjekty, účty a provozovnami. Navazuj na docs/Foodtab_Claude_Code_nocni_zadani.md, docs/Claude_Code_nastaveni_a_kvalita_Foodtab.md, CLAUDE.md a skutečný současný stav kódu. Pokud zadání obdržel projekt i přímo v konverzaci, použij aktuální doplnění. Zachovej hotové faktury, existující platby a jiné změny; nerozjížděj paralelní finanční systém.

Cíl: bezpečně přebírat bankovní účty, zůstatky a pohyby, dohledatelně párovat úhrady přijatých a vystavených faktur a použít je v cashflow. Implementuj funkční procesy a ověř je, nezůstaň u návrhu obrazovek.

### 1. Audit a architektura

Zmapuj existující faktury, jejich stavy, ruční úhrady, účty, transakce, cashflow, tenancy, RLS, integrace a workery. Zapiš mezery a rozšiř existující entity aditivně. Žádný hardcoded účet, banka, token nebo Foodtab podmínka v doménové logice.

Vytvoř úzký BankDataProvider kontrakt: seznam dostupných bank a jejich schopností, zahájení připojení, dokončení callbacku, získání účtů/zůstatků/transakcí, kontrola připojení a odvolání přístupu, pokud podporováno. Ne všechny providery používají OAuth; Fio může mít jiný tokenový postup. Capability mapa musí odlišovat souhlas/ruční token/import, firemní a soukromé účty, dostupné zůstatky, historii, VS/reference, pending/booked a možnosti synchronizace. Nepřidávej payment initiation do tohoto kontraktu.

Odděl normalizované finanční procesy od provider-specific DTO, ID, endpointů a chyb. CSV/import je plnohodnotný adapter. Zákazník může mít více připojení i více bank. Přidání nového adapteru nesmí vyžadovat změnu párování nebo cashflow.

### 2. Volba skutečného poskytovatele

Prověř aktuální oficiální dokumentaci a obchodní dostupnost Finbricks MULTIBANK a Enable Banking; porovnej rozsah pro české firemní účty, historii, metadata plateb, limity, stabilitu, souhlasy, smluvní model, sandbox a cenu. Nevymýšlej cenové nabídky ani úplné pokrytí. Výběr zapiš s doloženými fakty a neznámými údaji.

Implementuj první reálný adapter podle dostupné dokumentace a již autorizovaného sandboxu/přístupu. Bez nich dokonči kontrakt, importy, UI a kontraktové testy; neoznač mock jako připojenou banku. Připrav Fio jako volitelný přímý adapter, pokud je dostupný API kontrakt a vejde se do práce. Všechny reálné adaptéry bez přístupů označ „čeká na konfiguraci“.

Vlastník musí zvlášť dokončit smlouvu/KYB, účtové souhlasy a případné placené služby. Pracuj dál na ostatních částech. Samotný read-only účel neřeší automaticky regulatorní roli produktu. Veřejné zpřístupnění zákazníkům podmiň ověřeným smluvním modelem poskytovatele; nic nepodepisuj ani neplať.

### 3. Účty, souhlasy a bezpečnost

Každé připojení patří tenantovi. Účet patří tenantovi a právnímu subjektu; přiřazení k provozovně je volitelné a nesmí globální firemní účet násobit v součtech poboček. Podporuj více měn. Přístup ověřuj ze session a členství, nikoli z libovolného tenant_id v requestu.

Připojení: výběr banky → vysvětlení rozsahu dat → bezpečné ověření na straně banky/poskytovatele → výběr zpřístupněných účtů → ověření oprávněného přiřazení k subjektu → první sync. V aplikaci neukládej bankovní přihlašovací heslo ani autorizační SMS. U callbacků ověř state, jeho expiraci a jednorázovost, a PKCE pokud jej konkrétní tok vyžaduje/podporuje. Oprávnění k účtu nepředpokládej z jeho názvu.

Tokeny a session secrets šifruj serverově, izoluj po připojení, nikdy je neposílej do browseru, logů nebo AI. Souhlasy, platnost a dostupné scopes čti z provideru, ne z pevného počtu dnů. Podporuj expiraci, revokaci, obnovu a odpojení. Odpojení zastaví nové sync úlohy a odvolá přístup, kde je to podporované; historická data podléhají nastavené retenci.

Oprávnění zvlášť pro připojení banky, čtení zůstatků, pohybů, potvrzení/odpojení párování a export. Bankovní protistrany mohou obsahovat osobní údaje; minimalizuj jejich použití a nevkládej je do marketingového CRM jako hosty. Zabezpeč privátní výpisy i správní účty, workery, webhooky a exporty. Využij existující Supabase skills, pokud jsou dostupné, zejména pro RLS a její testy.

### 4. Data a synchronizace

Návrhové entity podle skutečného schématu: bank_connections, bank_accounts, bank_consents, balance_snapshots, bank_transactions, transaction_sources, invoice_payment_allocations, reconciliation_suggestions, import_batches a sync_jobs. Nevytvářej nové názvy povinně, pokud již existuje ekvivalent.

Účet identifikuj bankovním identifikátorem/IBAN a měnou v rámci tenanta a subjektu; tentýž účet získaný od více zdrojů nesmí být dva finanční účty. Providerové account ID ukládej jako vazby. U transakce uchovej měnu, přesnou částku, směr, datum zaúčtování a valuty, stav, účet protistrany, reference/VS pokud dostupné, popis, původ a auditovaný raw payload s přiměřenou retencí. Finance nepočítej přes float.

Book balance a available balance ukládej samostatně s typem a časem platnosti. Zůstatek ze starého výpisu označ jako historický. Zůstatek neodvozuj jako „součet všech stažených pohybů“, pokud nemáš počáteční zůstatek a úplné období. Nedostupný zůstatek není nula. Různé měny nesčítej bez explicitního FX přepočtu, zdroje kurzu a data.

Synchronizaci spouštěj serverově, nezávisle na otevřeném browseru. Interval dle limitů banky a smlouvy, ne neověřený příslib okamžitých dat. Manuální obnovení má respektovat stejný rate limit. Řeš pagination, checkpointy, backfill, překryv období, retry/backoff, timeout, locking a izolaci kapacity zákazníků. Posun checkpointu až po bezpečném zápisu. Aktualizuj pending na booked bez druhé transakce tam, kde jde prokazatelně o tutéž platbu; nejednoznačnost dej do kontroly.

Deduplikuj nejprve podle stabilních providerových ID v rámci zdroje. Mezi API, výpisem a druhým agregátorem používej zdrojové vazby a kontrolované párování. Shodná částka, den a VS samy nesmí smazat dvě skutečně různé platby. Při změně provideru proveď mapování účtu a kontrolu překryvu, ne automatické přepsání historie. Zachovej vazby na ruční úhrady: nalezený bankovní pohyb má doložit dřívější platbu, ne vytvořit druhou úhradu.

Import: CSV s mapováním sloupců, desetinných oddělovačů, encodingu, směru a data; CAMT.053/ABO pouze dle konkrétně ověřených variant. Náhled před potvrzením, chyby řádků, souhrn, zdrojová stopa, idempotence. PDF může být archivní příloha, není spolehlivým automatickým zdrojem plateb bez ověření vytěžení.

### 5. Párování faktur

Platba je finanční pohyb, přiřazení k faktuře je samostatná auditovatelná vazba s alokovanou částkou. Podporuj jednu platbu na více faktur a více plateb na fakturu. Ulož autora/pravidlo a verzi rozhodnutí. Stav úhrady odvozuj z platných alokací, ne z editovatelného boolean „zaplaceno“.

Přijatou fakturu typicky hledej proti odchozí platbě, vystavenou proti příchozí. Vždy ověř tenant, právní subjekt, směr, měnu, disponibilní částku transakce a nezaplacený zůstatek dokladu. Bankovní účet dodavatele se může měnit; novou odlišnou protistranu neakceptuj bez kontroly jako jistou shodu.

Kandidáti podle reference/VS/čísla dokladu, protistrany, částky a časové návaznosti. VS nemusí banka poskytovat a mohou ho sdílet různí dodavatelé. Ulož originál reference a dokumentuj normalizaci. Datum je podpůrný signál, ne důkaz. Výchozí automatické potvrzení pouze pro zaúčtovanou, jednoznačnou, nekonfliktní shodu silných identifikátorů, měny, směru a částky. Uživatel může pravidla vypnout nebo omezit. Pokud jsou kandidáti dva nebo je shoda slabá, pouze návrh s vysvětlením.

Řeš částečné úhrady, splátky, zálohy a jejich zúčtování, hromadné úhrady, přeplatky, dobropisy, vratky, poplatky a cizí měny. Malý rozdíl nesmí automaticky odepsat dluh; tolerance/odpis jsou explicitní schválená pravidla. Pro cizí měnu zaznamenej skutečný kurz a účetní výstup dle rozsahu ERP. Refund/storno zachová historii a změní krytí pohledávky pravidlem s dohledatelným účinkem. Pending platba nikdy sama neuzavře fakturu.

Ruční potvrzení, rozdělení, zamítnutí a zrušení párování musí být vratné s auditem. Zajisti transakční konzistenci a souběh: jedna část bankovní platby nesmí být alokována dvakrát. Součty a znaménka musí zohlednit typu dokladu, včetně opravných dokladů. Upomínky reagují na potvrzenou skutečnost; při zastaralém/chybějícím importu zobraz upozornění a neodesílej je automaticky.

### 6. Gastro, cashflow a UI

Obrazovky: Účty a zůstatky, Pohyby, Párování, Importy, Připojení. U každého účtu banka, subjekt, měna, správný typ zůstatku, jeho datum, poslední úspěšný sync a stav souhlasu. Vysvětli neaktuální nebo částečná data. Detaily platby ukazují zdroj, alokace a zbývající částku; faktura ukazuje navázané skutečné úhrady.

Cashflow bere bankovní zaúčtované pohyby právě jednou. Alokace na fakturu nepřidává další cashflow pohyb. Bankovní zůstatek není výnos ani zisk. Vnitřní převody mezi účty stejného právního subjektu označ a v konsolidaci firmy je eliminuj; z pohledu jednotlivých účtů zůstávají. Převody mezi různými právními subjekty nejsou automaticky vnitřní převody firmy.

Pokladní prodeje kartou spoj s bankovním settlementem jako financování již evidované tržby; nesmí vzniknout druhý výnos. Použij settlement/acquirer report k rozpisu dávky, poplatků a refundů; samotná čistá bankovní částka nerozpozná spolehlivě jednotlivé účtenky. Obdobně rozvozové platformy a poukázkové společnosti. Odliš hotovostní vklad, provozní výdaj, mzdu a splátku; kategorizace je vysvětlitelný návrh, ne účetní pravda od AI.

Pro 13týdenní forecast využij aktuální zůstatky jako výchozí stav a zbývající závazky/pohledávky jako plán; již uhrazenou část nezahrnuj podruhé. Ukazuj úplnost dat, měnu a čas výchozího stavu. Zůstatky se nesmějí násobit při přepínání poboček. Zachovej stávající vizuální styl a mobilní kontrolu plateb.

### 7. Akceptační testy a výstupy

Otestuj na syntetických datech alespoň:

1. Dva klienti, stejné VS a externí ID: žádný únik ani propojení dat, včetně API/RLS, souborů, callbacku a workeru.
2. Faktura 10 000 Kč; odchozí úhrada 4 000 Kč → zbývá 6 000 Kč, dalších 6 000 Kč → uhrazeno. Opakovaný sync výsledek nezmění.
3. Dvě různé faktury s VS 123 a stejnou částkou → ruční kontrola, nikoli náhodné označení jedné jako zaplacené.
4. Pending platba → faktura neuhrazená; booked aktualizace téže platby → jediný pohyb a správná alokace.
5. API a CSV obsahují stejné pohyby; zůstatek ani úhrady se nezdvojí. Dvě legitimní shodné platby nesmějí být chybně sloučeny.
6. Dva současně běžící párovací joby nepřiřadí jednu částku dvakrát. Již zadaná ruční úhrada je doložená, ne přičtená znovu.
7. Jedna platba na dvě faktury, záloha a její zúčtování, přeplatek, dobropis a refund; možnost auditovaně zrušit alokaci.
8. CZK a EUR účty se nesčítají bez přepočtu. Booked a available balance se nezaměňují. Historický import nevytvoří falešný aktuální zůstatek.
9. Převod mezi vlastními účty není firemní výnos. Karetní prodeje 10 000 Kč a settlement 9 800 Kč nevytvoří další tržbu; 200 Kč poplatek lze doložit reportem.
10. Odvolaný/expirující souhlas, 429, chybějící stránka, restart workeru a nedostupný zůstatek mají správný stav a obnovu.

Dodržuj autonomní pracovní postup z původního zadání. Ověř relevantní build/typecheck/testy, datové toky a UI. Používej dostupné Supabase, Postgres a webapp-testing skills podle jejich účelu. Nezměň produkci ani nepřipojuj účty bez souhlasu vlastníka; sandboxové výstupy tak označ. Chybějící obchodní přístupy nezastaví implementaci ostatních částí.

Odevzdej kód, aditivní migrace, bezpečný env.example, testy, dokumentaci providerů a párování, návod připojení pro klienta a tabulku Hotovo / Částečně / Blokováno. Uveď skutečnou integraci versus mock/import, datum dokumentace, požadavky na produkční onboarding a konkrétní kroky vlastníka. Aktualizuj průběžný stav a morning report. Začni auditem skutečné implementace a pokračuj v práci.

## KONEC PROMPTU

## Podklady ověřené 4. 10. 2026

- Finbricks MULTIBANK: https://www.finbricks.com/
- Enable Banking API: https://enablebanking.com/docs/api/reference/
- Obchodní a produkční podmínky: https://enablebanking.com/docs/faq/ a https://enablebanking.com/terms/
- Fio API: https://www.fio.cz/bankovni-sluzby/api-bankovnictvi
- ČNB — oprávnění pro platební služby: https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/povolovaci-a-schvalovaci-rizeni/povolovaci-schvalovaci-rizeni-a-zapis-do-registru-platebni-instituce-a-poskytovatel-platebnich-sluzeb-maleho-rozsahu/

Přesné ceny, dostupnost konkrétních bankovních produktů a smluvní role nebyly potvrzeny obchodní nabídkou; před produkčním spuštěním se musí ověřit.
