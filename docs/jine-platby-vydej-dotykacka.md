# Jiné platby: výdej ze skladu v Dotykačce — návrh

Stav k 25. 10. 2026. Navazuje na `docs/jine-platby-navrh.md` (oddíly 3.5,
3.6 a 7) a `docs/jine-platby-pos-operace.md`. Otázky jsou
v `docs/hlaseni/otazky.md` (54 a 71–75).

**Zadání Šéfíka:** „AI najde v pokladně odpovídající položky a ty odečte ze
skladu, respektive množství uvedené na účtence či papíře. Je potřeba si projít
dokumentaci k Dotykačce, jak by toto mohlo jít udělat.“

## Krátce pro Šéfíka

1. **Jde to.** Dotykačka má dvě cesty, jak odečíst sklad zvenku:
   **POS akci** (appka pošle do pokladny účet zaplacený *Odpisem*, přesně jako
   dnes obsluha ručně) a **přímý výdej ze skladu** (`warehouses/…/sales`).
   Doporučuji **POS akci**: jde dohledat podle klíče appky, takže appka
   vždycky pozná, jestli se výdej provedl, a nikdy neodečte dvakrát. Přímý
   výdej se dohledat nedá (pohyby skladu Dotykačka přes API nedává).
2. **AI položky jen navrhne.** Nejdřív se položky přiřadí podle pravidel
   (dříve potvrzený název, čárový kód, stejný nebo podobný název). Co zbude,
   pošle appka AI spolu s krátkým seznamem možných produktů z katalogu
   pokladny. AI smí vybrat jen z toho seznamu. **Potvrzuje člověk.**
3. **Množství** převádí appka podle pravidel, ne AI: „2× Pivo 0,5 l“ → 2 kusy,
   „5 kg mouky“ → 5 kg u suroviny vedené v kilogramech. Co převést nejde,
   jde ke kontrole.
4. **Pokrm s recepturou** se odepíše jako pokrm a suroviny odečte pokladna
   podle své receptury. Nově si appka receptury z katalogu přečte a jménem
   upozorní, když je surovina pokrmu na dokladu ještě jednou zvlášť
   (smetana ke svíčkové) — jinak by se odečetla dvakrát.
5. **Do ostré Dotykačky se zatím nic nezapisuje.** Zápis je v kódu vypnutý
   seznamem provozoven, který je prázdný. Zapnout ho jde jen změnou kódu
   po ověření na testovacím cloudu a po výslovném pokynu (otázka 54).

## 1. Co umí Dotykačka (dokumentace API v2, verze 2026.39.0, čteno 25. 10. 2026)

Zdroj: https://docs.api.dotypos.com/ — u každého řádku je stránka.

### 1.1 Cesty, jak odečíst sklad

| Cesta | Adresa | Jak se pozná výsledek | Pokrm s recepturou | Hodnocení |
|---|---|---|---|---|
| **POS akce „vytvořit, vystavit a zaplatit účet“** zaplacený způsobem *Write-off* (Odpis, 900000012) | `POST /v2/clouds/:cloudId/branches/:branchId/pos-actions`, akce `order/create-issue-pay` ([pos-actions/actions](https://docs.api.dotypos.com/pos-actions/actions/), [payment-methods](https://docs.api.dotypos.com/api-reference/enums/payment-methods/)) | Účet nese `external-id` = klíč appky. Dohledá se přes `GET /orders?filter=externalId\|eq\|<klíč>` ([entity/order](https://docs.api.dotypos.com/entity/order/)): uzavřený, zaplacený, příznak `WRITEOFF` (bit 11), položky účtu. Odpis je navíc v denním reportu v `writeoffs[]` ([base-sales-report](https://docs.api.dotypos.com/others/reports/base-sales-report/)). | Pokladna odečte jako při prodeji, tj. podle své receptury a svého nastavení `stockDeductionMode` | **Doporučeno.** Totéž, co dnes dělá obsluha ručně. |
| **Přímý výdej ze skladu** („Sale product on warehouse“, ve v1 „Product sale“) | `POST /v2/clouds/:cloudId/warehouses/:warehouseId/sales`, položky `_productId`, `quantity`, `note` ([entity/warehouse](https://docs.api.dotypos.com/entity/warehouse/), [api-v1-services/stock-service](https://docs.api.dotypos.com/api-v1-services/stock-service/)) | **Nijak spolehlivě.** Požadavek nemá externí klíč a pohyby skladu přes REST číst nejdou, jen webhookem `STOCKLOG` ([others/webhook](https://docs.api.dotypos.com/others/webhook/)). Zbývá stav skladu `stockQuantityStatus` před a po, a ten mezitím mění běžný prodej. | Dokumentace neříká | Nedoporučeno jako výchozí. Po výpadku spojení by appka nevěděla, jestli odečetla. Opakování = možný dvojí odečet. |
| Naskladnění se zápornou korekcí | `POST /warehouses/:warehouseId/stockups`, množství „negative for corrections“, povinné `invoiceNumber` | Stejně jako přímý výdej (nejde dohledat) | — | Nedoporučeno. Je to korekce příjmu, mění nákupní ceny (`updatePurchasePrice`). |
| Inventura | `POST /warehouses/:warehouseId/stock-takings` (asynchronní, `statusWebhookUrl`) | Stav úlohy | — | Nevhodné. Nastavuje stav, ne výdej. |

Účty (`orders`) přes REST **vytvořit nejdou**, jen číst
(`GET /orders`, `GET /orders/:id`). Proto je jediný dohledatelný zápis POS akce.

### 1.2 Co POS akce potřebuje a jak se chová ([pos-actions](https://docs.api.dotypos.com/pos-actions/), [actions](https://docs.api.dotypos.com/pos-actions/actions/))

- **Zapnutá a připojená pokladna** provozovny („The targeted device must be
  online and turned on“). Otevřená pokladna, jinak kód **3001
  REGISTER_CLOSED** (nic se neprovede).
- **Licence:** `GET /v2/clouds/:cloudId/manifest` ([cloud-manifest](https://docs.api.dotypos.com/entity/cloud-manifest/)) vrací u provozovny
  `features`, které obsahují `posAction` jen s licencí premium a vyšší,
  a `stockDeductionMode` (`disabled` / `orderPark` / `documentIssue`, výchozí
  `documentIssue`). Při `disabled` by účet vznikl, ale **sklad by se
  neodečetl**. Appka proto manifest přečte před odesláním a pustí jen
  `documentIssue` (odečet při vystavení dokladu). `orderPark` (odečet při
  zaparkování) zatím ne: `order/create-issue-pay` účet nezaparkuje, takže
  by vznikl „hotový odpis“ bez odečtu. Ověří se na testovacím cloudu
  (oddíl 6, krok 9).
- **Výsledek:** bez vlastního webhooku přijde v těle odpovědi (výchozí
  webhook). Když pokladna nezpracuje požadavek do 21 s, vrátí se **404**,
  ale pokladna ho může provést později, dokud platí `validity`. Úvodní
  stránka přitom píše, že odpověď je „200 OK s prázdným tělem“. Appka obojí
  bere jako „odesláno, výsledek se ověří dohledáním“.
- **Souběh:** s výchozím webhookem jen jeden požadavek najednou na
  kombinaci uživatel + aplikace + cloud + provozovna, jinak **429**.
- **`validity`** (ms): po ní pokladna požadavek odmítne kódem **1007**.
  Appka dává 5 minut a nejasný výsledek uzavře jako „neprovedeno“ až po
  platnosti + 2 minutách rezervy (`lib/jine-platby-pos-operace.ts`).
- **`idempotency-key` NENÍ ochrana před dvojím provedením.** Podle
  dokumentace jen označuje volání webhooku. Ochranou je `external-id` účtu
  a pravidlo „nejasný výsledek se jen dohledává, nikdy neposílá znovu“.
- **Uživatel:** bez `user-id` jedná pokladna pod „integration user created
  for your API client“. Jeho práva v pokladně rozhodují, jestli smí odpis
  (chybějící právo nebo zásoba = kód **2999 ORDER_OTHER**, „permission …
  stock“). Ověřit na testovacím cloudu (otázka 74).
- **Kód 2003** (neplatný způsob platby): „the freshly created order is not
  removed“ — účet vznikl a visí otevřený. Appka to bere jako nejasné
  a dohledá (dnes už v kódu).
- **Zálohované obaly (2.19+):** pokladna k produktu sama přidá obal jako
  další položku účtu. Appka to při ověření bere jako navíc odečtené, ne
  jako chybu (oddíl 4).

### 1.3 Oprávnění tokenu ([authorization](https://docs.api.dotypos.com/authorization/), [common-error-responses](https://docs.api.dotypos.com/api-reference/general/common-error-responses/))

- Připojení přes Connector v2 má jediný rozsah `scope=*`. Token platí pro
  cloud, který člověk při připojení vybral (Perla 313437764, Bernard
  346595937).
- Jemnější omezení dělá Dotykačka u klientské aplikace: 403 s `reason`
  **`DOMAIN_FORBIDDEN`** = „access to the endpoint path is not allowed“,
  **`LICENSE_UPGRADE_REQUIRED`**. Jestli má Client ID Foodtabu povolené
  `pos-actions`, `manifest` a `product-ingredients`, z dokumentace zjistit
  nejde. Ověří se na testovacím cloudu, případně se zeptáme podpory
  Dotykačky (otázka 73).
- U `include=ingredients` platí „the client must have the proper
  permissions to read the included entity … otherwise 403“ ([entity/product](https://docs.api.dotypos.com/entity/product/)). Appka proto
  katalog při 403 načte bez receptur (oddíl 3.4).
- Zaměstnanci mají `accessLevel` a `stockAccessLevel` ([entity/employee](https://docs.api.dotypos.com/entity/employee/)) — práva ke skladu má
  v pokladně i uživatel integrace.

### 1.4 Produkt, receptura, surovina ([product](https://docs.api.dotypos.com/entity/product/), [product-ingredient](https://docs.api.dotypos.com/entity/product-ingredient/), [stock-packaging](https://docs.api.dotypos.com/entity/stock-packaging/))

- **`stockDeduct`** — „Product is deducted from Warehouse“. Nic víc
  dokumentace neříká; jak se kombinuje s recepturou, se ověří na testovacím
  cloudu.
- **Receptura** = záznamy `product-ingredients`: `_parentProductId` (pokrm),
  `_productId` (surovina), `quantity`, `unit`. Čtou se zvlášť
  (`GET /product-ingredients`), nebo s produkty přes `include=ingredients`.
  Při odpisu pokrmu odečte pokladna suroviny podle receptury, stejně jako při
  prodeji. Je to chování pokladny, API ho výslovně nepopisuje (ověřit).
- **Surovina** je v Dotykačce taky produkt (je v `/products`, často skrytý
  `display=false`, s jednotkou kg / l). Jde ji proto odepsat **přímo**,
  jako položku odpisového účtu s množstvím v její jednotce (kód 4001 by
  znamenal, že ji pokladna nezná; ověřit u skrytého produktu).
- **Jednotky:** `unit` (výčet [units](https://docs.api.dotypos.com/api-reference/enums/units/)), `packaging` = „Number of items in a
  package“ (počet kusů v balení, **ne** objem kusu). Pole
  `unitMeasurement` a `packagingMeasurement` („Measurement packaging for
  product“) by mohla nést objem kusu (pivo 0,5 l), ale dokumentace to
  neříká. Appka je zatím nečte. Když testovací cloud potvrdí, že
  `packagingMeasurement` = 0,5 a `unitMeasurement` = litr u piva 0,5 l,
  přidá se to jako `mira` a převod „1 l piva = 2 kusy“ začne fungovat sám.
- **Skladová balení** (`stock-packagings`, jednotka „ve stejné skupině jako
  produkt“) jsou pro naskladnění; výdeje se netýkají.

### 1.5 Sklady a provozovny ([warehouse-branches](https://docs.api.dotypos.com/entity/warehouse-branches/))

Provozovna může vidět víc skladů a sklad víc provozoven (M:N). Při POS akci
odečítá pokladna ze skladu, který má nastavený sama. Appka sklad nevybírá.
U přímého výdeje by ho vybírat musela, což je další důvod pro POS akci.

### 1.6 Testovací cloud ([getting-started](https://docs.api.dotypos.com/getting-started/))

Dotykačka 12. 10. 2026 poslala licenční klíč pro testovací cloud. Založení
účtu Dotypos s tím klíčem vytvoří nový cloud. Účet zakládá Šéfík (appka ani
já účty nezakládáme). Pak se cloud připojí ve Foodtabu jako další pokladna
a celý postup z oddílu 6 se projde na něm.

## 2. Doporučený postup výdeje

```
doklad (fotka / papír)
  → rozpoznání AI (už existuje, lib/jine-platby-ai.ts)
  → přiřazení položek ke katalogu pokladny (oddíl 3) ………… ČLOVĚK potvrdí přiřazení
  → převod množství na jednotky pokladny (pravidla, ne AI)
  → náhled výdeje: co se odepíše, co odečte receptura, varování
  → „Potvrdit výdej do POS“ ……………………………………………… ČLOVĚK schválí konkrétní verzi
  → kontrola „už odečteno?“ v pokladně (platí 15 min)
  → zabrání v databázi → manifest (licence, režim odečtu) → POS akce → dohledání podle klíče
  → „Odečteno v POS“ (s číslem účtu) / nejasné (jen dohledat) / neprovedeno (smí se zkusit znovu)
```

Všechno kromě dvou kroků za šipkou s „člověk“ už v appce je. Tahle práce
přidává přiřazení přes AI, receptury, zjištění provozovny u pokladny
připojené k pobočce, kontrolu manifestu, porovnání položek po zápisu
a vypínač v kódu.

## 3. Přiřazení položek ke katalogu (AI + pravidla)

### 3.1 Pořadí

1. **Pravidla** (`navrhnoutMapovani`, `lib/jine-platby-mapovani.ts`, beze
   změny): dříve potvrzený alias → `overeno`; EAN v názvu nebo stejný název
   → `navrh`; podobnost názvu ≥ 0,6 a jednoznačná → `navrh`.
2. **AI** jen pro skladové položky (pokrm, rozlévaný nápoj, kusové zboží),
   které zůstaly `nenamapovano` (`lib/jine-platby-ai-parovani-jadro.ts`).
3. **Člověk** návrh potvrdí v editoru (`overeno`). Bez toho databáze výdej
   nesestaví (`app.jp_sestavit_vydej`: „Položka nemá ověřené přiřazení“).
   Alias pro příště se uloží až po potvrzení.

### 3.2 Co jde do AI (uzavřený vstupní typ `PodkladParovani`)

- z dokladu: pořadí položky, název, množství, jednotka, druh;
- z katalogu: **pro každou položku zvlášť** nejvýš 12 kandidátů vybraných
  pravidly (podobnost názvu, společná slova, čísla v názvu). U kandidáta je
  krátký kód (`K1`…), název, jednotka, „odečítá sklad“ a „má recepturu“;
- **nejde tam:** ceny z katalogu, id produktů pokladny, jména lidí, firma,
  pobočka, obrázek dokladu ani jiné údaje mimo doklad a katalog (skill
  foodtab-ai).

Kód kandidáta se na id produktu přeloží až na serveru. Odpověď s kódem,
který u té položky nebyl, se zahodí. AI tak nemůže „vymyslet“ produkt ani
ho podstrčit textem z dokladu (prompt injection). Text z dokladu i z
katalogu jde do zprávy označený jako data, ne pokyn.

### 3.3 Co AI vrací (strukturovaný výstup, bez unií a nepovinných polí — PR #154)

`{ prirazeni: [{ polozka: číslo, kod: "K3" nebo "", jistota: text, duvod: text }] }`
— 0 parametrů s unií, 0 nepovinných (strop 16 / 24 na požadavek; hlídá
`scripts/jine-platby-ai-parovani.test.mjs` nad hotovým JSON schématem).
Prázdný kód = AI nic vhodného nenašla, položka zůstane nepřiřazená.
`jistota` je v schématu prostý text, protože pomocník SDK výčet do schématu
pro API nepřenese. Appka ho převede na vysoká / střední / nízká, neznámé
slovo bere jako nízkou.

Výsledek je vždy jen **`navrh`**. Řádek navíc dostane důvod ke kontrole
„Přiřazení navrhla AI: „Svíčková na smetaně“ (jistota vysoká) — …. Ověřte
ho“. Výdej ho nepustí, dokud člověk řádek neověří („Řádek jsem ověřil(a)“)
a přiřazení nepotvrdí („Přiřazení je správné“). AI nikdy nenastaví
`overeno`, nemění množství, název, cenu ani druh. Položky, které už mají
návrh nebo ověřené přiřazení (třeba je vybral člověk), akce nemění.

### 3.4 Receptury v katalogu

`katalog()` čte produkty s `include=ingredients`. Když na to klientská
aplikace nemá právo (403), načte katalog znovu bez receptur
(`ma_recepturu` = null jako dnes) a řekne to. S recepturami:

- `ma_recepturu` je ano/ne místo „neví“ (odvozuje ho databáze z `suroviny`,
  jeden zdroj pravdy). „Bez receptury“ vznikne jen z prázdného pole
  `ingredients`. Chybějící klíč nebo nečitelná surovina = „neví se“,
  protože pokrm se `stockDeduct: false` a bez receptury by jinak z výdeje
  vypadl;
- `pos_katalog.suroviny` = `[{produkt, mnozstvi, jednotka}]` (nový sloupec);
- náhled výdeje (`jine_platby_sestavit_vydej`) nově pozná, když položka
  výdeje (zboží i rozlévaný nápoj) je **surovinou jiné položky téhož výdeje**
  (smetana ke svíčkové, rum ke koktejlu), a varování to řekne jménem.
  Schválení pak dál chce výslovné potvrzení `p_bez_surovin`. Obecné
  varování „pokrm i kusové zboží“ zůstává **vždy** jako dřív. Receptura
  v katalogu je jen opis z posledního načtení (v pokladně ji mohli změnit)
  a vnořené receptury appka nerozbaluje, takže konkrétní varování přidává
  a nic nenahrazuje (nezávislá kontrola 25. 10.). Otisk výdeje se nemění,
  receptury do něj nepatří.

### 3.5 Převod množství (beze změny, `prevestNaJednotkyPos`)

Převádí se jen z dat pokladny: kusy → kusy; litry/kg → litry/kg u položky
vedené ve stejné jednotce; s mírou kusu (`mira`) i litry → kusy. Bez míry
a v jiné jednotce = **nejasné, ke kontrole** (člověk zapíše množství
v jednotkách pokladny). AI množství nepočítá. Míru z názvu produktu
(„Smetana 1 l“) appka zatím neodhaduje. Kdyby se to mělo zavést, jen jako
návrh se značkou „ke kontrole“ (otázka 72).

## 4. Ověření, že se odečetlo

1. **Účet podle klíče** (`ucetPodleKlice`): uzavřený, zaplacený, `WRITEOFF`.
   Už dnes v kódu.
2. **Nově: položky účtu proti výdeji** (`porovnatPolozkyVydeje`,
   `lib/jine-platby-pos-operace.ts`): každý odepisovaný produkt musí být na
   účtu v plném množství (součet nezrušených řádků). Chybí nebo je ho méně
   → **nejasné** (dohledá se, ověří člověk). Produkt navíc (zálohovaný obal)
   → úspěch, ale navíc odečtené produkty se uloží do výsledku operace.
3. **Denní report `writeoffs[]`** — souhrnná kontrola za den (zatím jen
   návrh, appka ho nestahuje; otázka 53 o Foodcostu).
4. **Stav skladu** (`warehouses/:id/products/:productId` →
   `stockQuantityStatus`) — jen pro člověka, nic nedokazuje (běžný prodej
   ho mezitím mění).

## 5. Vypínač a co je v PR

**Zápis je pořád odebraný v kódu.** `ZAPIS_VYDEJE_DOTYKACKA`
v `lib/pokladna-dotykacka-zapis.ts` je seznam `{cloud, provozovna, pokyn}`
a je **prázdný**. Adaptér k relaci připojí metodu zápisu jen pro cloud
s povolenou provozovnou a hlásí `skladovyVydej: 'api'` jen pro ni. Zápis
sám odmítne provozovnu mimo seznam bez jediného volání. Žádná proměnná
prostředí ani nastavení v databázi ho zapnout neumí („pojistka nesmí
záviset na nenastavení“). Test `scripts/pokladna-dotykacka-sklad.test.mjs`
hlídá, že seznam je prázdný. Kdo ho naplní, musí vědomě změnit i test.

Co tahle PR přidává (všechno pod vypínačem, do pokladny nic neodejde):

| Část | Kde | Ověřeno |
|---|---|---|
| Přiřazení položek přes AI (tlačítko „Najít produkty v pokladně (AI)“ v panelu Sklad, když návrh výdeje blokuje nepřiřazená položka), denní strop 10 na záznam a 100 na firmu | `lib/jine-platby-ai-parovani*.ts`, `akce-parovani.ts`, `sekce-sklad.tsx`, tabulka `jine_platby_ai_parovani` | `scripts/jine-platby-ai-parovani.test.mjs` (51), scénář krok103 (oddíl 5) |
| Receptury z katalogu, konkrétní varování „surovina pokrmu ve stejném výdeji“ | `cteniDotykacky().katalog`, `pos_katalog.suroviny`, `app.jp_sestavit_vydej` | `scripts/pokladna-dotykacka-sklad.test.mjs`, krok103 (oddíly 2–3) |
| Provozovna u pokladny připojené k pobočce: doplní ji databáze při zabrání z aktuálního přiřazení, nula nebo víc provozoven = neodešle se; přeřazená provozovna = neodešle se | `pos_operace_zahajit`, `app.jp_provozovna_vydeje` | krok103 (oddíl 4) |
| Kontrola manifestu před odesláním (licence `posAction`, `stockDeductionMode` ≠ `disabled`) | `odeslatVydejDotykacka` | `scripts/pokladna-dotykacka-sklad.test.mjs` |
| Porovnání položek účtu s výdejem po zápisu | `porovnatPolozkyVydeje` | `scripts/jine-platby-pos-operace.test.mjs` |
| Vypínač v kódu (zápis jen pro provozovnu ze seznamu, i schopnost „api“ jen pro ni) | `lib/pokladna-dotykacka-zapis.ts`, `schopnostVydeje` | `scripts/pokladna-dotykacka-sklad.test.mjs`, `scripts/jine-platby-detail.test.mjs` |

Migrace `20261025230000_jine_platby_vydej_dotykacka.sql` (bez `db push`).
Živě nic z toho neběželo — testy jedou na podvržených odpovědích podle
dokumentace a nad PGlite.

## 6. Než se zápis zapne (testovací cloud, pak pokyn)

Na **testovacím cloudu** (ne na Perle ani Bernardovi), po jedné provozovně:

1. Manifest: provozovna má `posAction`, `stockDeductionMode` = `documentIssue`.
   Odpovědi uložit jako nahrávky do `scripts/nahravky/dotykacka/` (bez
   tokenů) a testy na ně přepnout.
2. Výdej jednoho kusového zboží, jednoho pokrmu s recepturou a jedné
   suroviny napřímo (skrytý produkt). Ověřit: účet má `externalId` = klíč,
   je zaplacený, `WRITEOFF`, `ucetPodleKlice` ho najde a položky sedí.
3. Sklad: zboží ubylo, u pokrmu ubyly **suroviny podle receptury** (ne
   pokrm sám), surovina napřímo ubyla v kg/l.
4. Tržby: odpis **není** v `productSales` (jinak by ho synchronizace zapsala
   jako tržbu do `pokladna_prodeje_denni`) a v platbách je jen jako 900000012
   (druh `odpis`). Je v `writeoffs[]`.
5. `validity`: za 10 min projde, minulá vrátí 1007. Vypnutá pokladna: po
   platnosti nic neprovede a appka uzavře výdej jako „neprovedeno“.
6. Tvar odpovědi HTTP 200 bez webhooku (prázdné tělo, nebo účet / obálka
   s `code`); co přijde po 21 s; `print-type: none` projde; bez `user-id`
   není 1008 a uživatel integrace smí odpis (jinak 2999).
7. Stejný klíč podruhé: vznikne druhý účet? Appka ho nikdy neposílá znovu
   naslepo, ale je dobré to vědět.
8. Jestli `packagingMeasurement` / `unitMeasurement` nesou objem kusu (oddíl 1.4).
9. Jestli se v režimu `orderPark` (odečet při zaparkování) odpis přes
   `order/create-issue-pay` vůbec odečte. Do té doby appka do takové
   provozovny nic neposílá (přijímá jen `documentIssue`).
10. Jestli Dotykačka umí vnořené receptury (polotovar s vlastní recepturou).
    Appka je nerozbaluje. Proto obecné varování „pokrm i kusové zboží“ zůstává
    vždy a konkrétní varování jménem jen přibývá.

Pak **Šéfík výslovně napíše**, pro kterou provozovnu zápis zapnout, a do
`ZAPIS_VYDEJE_DOTYKACKA` se přidá jeden řádek s tím pokynem (otázka 54).
**Ve stejné změně** musí obrazovka brát schopnost zápisu podle provozovny
záznamu, ne podle adaptéru. Jinak by u neuvedené provozovny panel sliboval
„appka ho hned odešle“ a výdej by skončil jako ruční (nezávislá kontrola
25. 10., poznámka v `lib/pokladna-dotykacka-zapis.ts`).

## 7. Co se schválně nedělá

- Přímý výdej `warehouses/…/sales` ani záporné naskladnění — nedají se
  dohledat (oddíl 1.1).
- Webhooky (`STOCKLOG`) — chtěly by veřejnou adresu a nic dalšího nepřinesou,
  dokud dohledání podle klíče stačí.
- AI nerozhoduje o množství, nepotvrzuje přiřazení a nic nezapisuje.
- Žádná skladová karta v appce. Sklad vede pokladna.
- Korekce provedeného výdeje přes API dál není (dokumentace storno
  vystaveného dokladu nepopisuje). Korekce zůstává ruční.
