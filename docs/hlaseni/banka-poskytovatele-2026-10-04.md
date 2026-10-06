# Výběr poskytovatele pro bankovní modul — 4. 10. 2026

Zadání (`docs/bankovni-modul-zadani-2026-10-04.md`, oddíl 2) žádá
posoudit **Finbricks MULTIBANK** a **Enable Banking**, zapsat výběr
s doloženými fakty a neznámými údaji, nevymýšlet ceny ani pokrytí.
Tenhle zápis je ten doklad. Tři agregátory prošly výzkumem (živé
dotazy na jejich vlastní dokumentaci, ne jen marketing): **GoCardless
Bank Account Data**, **Finbricks MULTIBANK**, **Enable Banking**.

## Shrnutí — co appka staví

| Poskytovatel | Role | Stav v tomhle commitu |
|---|---|---|
| **Fio banka** (přímý adaptér) | Jediná banka s vlastním read-only tokenem bez licence navíc | **Plně funkční** (`lib/integrace-fio.ts`) |
| **Enable Banking** (multibank agregátor) | KB/ČSOB/ČS/Raiffeisenbank | **Kostra**, self-serve sandbox dostupný bez smlouvy |
| GoCardless Bank Account Data | — | Nezařazeno dál — nové registrace zastavené od 7/2025 |
| Finbricks MULTIBANK | — | Nezařazeno dál — jen přes obchodní jednání, žádný self-serve |

## GoCardless Bank Account Data — DŮVOD VYŘAZENÍ

Od července 2025 **zastavil samoobslužné registrace nových účtů**
(`bankaccountdata.gocardless.com/new-signups-disabled`, přímo
ověřeno). Nový zákazník se dnes dostane jen přes obchodní jednání.
Existující účty dál běží, ale appka žádný nemá a nemůže si ho
založit sama (zakládání účtů u třetí strany je mimo to, co appka
dělá bez výslovného svolení a bez reálných firemních údajů).

## Finbricks MULTIBANK — DŮVOD VYŘAZENÍ (pro tenhle krok)

**Ověřeno (živě, docs.finbricks.com + český obchodní rejstřík):**
Finbricks, s.r.o. (IČO 10669205) je dceřinou společností KB
SmartSolutions (fintech ramene Komerční banky), od 3/2025 vedená
v rejstříku ČNB jako platební instituce s oprávněním i pro službu
informování o platebním účtu (AIS). Produkt MULTIBANK pokrývá KB,
ČS, Fio, MONETA, Raiffeisenbank, UniCredit CZ, Creditas (ČSOB a
UniCredit CZ chybí appce stabilní `fbxReference` — appka by u nich
nedostala spolehlivé externí id transakce pro dedup).

**Proč appka nestaví kostru proti němu TEĎ:** podle jejich vlastní
dokumentace (`docs.finbricks.com`, „Get Started") **neexistuje
samoobslužný přístup ani sandbox bez podepsané smlouvy** — čtyři
kroky: kontaktní formulář → obchodní hovor do druhého pracovního dne
→ podpis PŘED-smlouvy → až POTOM sandbox, a ten sandbox navíc běží
proti REÁLNÉMU produkčnímu bankovnímu API (plateb příkazy omezené na
1 Kč, ne mock prostředí). Appka by si bez Šéfíkova přímého obchodního
kroku nemohla ani vyzkoušet, jestli kód funguje.

**Kdy se vrátit k Finbricks:** až bude chtít Šéfík řešit banky, které
Enable Banking nepodporuje (Fio má appka přímo, takže hlavní zbylá
mezera je MONETA) — nebo pokrytí šíří přes Enable Banking samotný.
Vyžaduje obchodní hovor, ne engineering krok.

## Enable Banking — DŮVOD VOLBY

**Ověřeno (živě, enablebanking.com/docs/*):**
- **Licence**: Enable Banking Oy (Finsko, IČO 2988499-7), registrovaný
  AISP u finského FIN-FSA — PSD2 passporting umožňuje službu v ČR bez
  toho, aby appka potřebovala vlastní licenci u ČNB.
- **České banky** (`enablebanking.com/docs/markets/cz`, přímo
  ověřeno): **Česká spořitelna, ČSOB, Komerční banka, Raiffeisenbank**
  — ano. **MONETA Money Bank a Fio banka — výslovně NE** („not yet
  supported"). Fio appka řeší přímým adaptérem, takže tahle mezera
  nevadí; MONETA zůstává nepokrytá (zapsáno jako mezera níž).
- **Samoobslužný přístup**: `enablebanking.com/sign-in` → kontrolní
  panel → sandbox ZDARMA, bez smlouvy, bez obchodního hovoru. Navíc
  existuje „Restricted Production" — reálné bankovní připojení,
  zdarma, bez smlouvy, omezené na účty/IBANy, které si appka sama
  vyjmenuje (typicky vlastní testovací účet). **Tohle je jediný ze
  tří poskytovatelů, u kterého by šlo kód reálně vyzkoušet bez
  podpisu čehokoli** — zbývá jen založit si kontrolní panel (krok
  pro Šéfíka, appka účty třetích stran nezakládá sama).
- **Technický tvar**: appka se nepřihlašuje OAuth client-credentials,
  ale podepisuje si vlastní JWT (RS256, soukromý klíč appka sama
  vygeneruje a zaregistruje). Zůstatky chodí v ISO 20022 kódech
  (`CLBD`/`CLAV`/`ITBD`/`ITAV` — knihovní/disponibilní, uzávěrkový/
  mezitímní), transakce nesou `credit_debit_indicator`
  (`CRDT`/`DBDT`) a stav `BOOK` pro zaúčtované.
- **Souhlas**: appka si nesmí vymýšlet pevný počet dnů — Enable
  Banking vrací `maximum_consent_validity` PODLE KAŽDÉ BANKY
  („pro většinu bank 180 dní", ne 90 — oprava vlastní domněnky, ČR
  banky nejedou podle britské 730denní výjimky, ta je jen pro FCA).
- **Limit**: žádný číselný limit od Enable Banking samotného — limit
  dává KAŽDÁ BANKA (typicky 4 dotazy/den bez aktivního uživatele),
  appka ho tedy nesmí předpokládat napevno a musí číst `429
  ASPSP_RATE_LIMIT_EXCEEDED`.
- **Node/TS SDK**: žádný, appka volá REST přímo (JWT podpis přes
  `jose`/`jsonwebtoken`, běžná knihovna, žádná závislost na
  Enable Banking balíčku).

## Co appka dělá s touhle volbou

`lib/integrace-enablebanking.ts` — KOSTRA (žádný `ENABLEBANKING_*`
klíč v tomhle prostředí, appka proto nikdy nezkouší zavolat ven,
stav zůstává `nepripojeno`). Kontrakt (`lib/bank-provider-contract.ts`,
`BankDataProvider`) je stejný pro Fio, Enable Banking i CSV import —
přidání dalšího poskytovatele (třeba Finbricks, až bude obchodně
dostupný) nebude vyžadovat změnu párování ani cashflow.

## Neznámé, které appka nedoložila (zapsáno, ne vymyšleno)

- Finbricks: přesný tvar odpovědi `/account/transactions` (pending
  vs. booked, VS/KS/SS na příchozí platbě) — ReDoc schéma nešlo
  rozbalit bez přihlášení.
- Enable Banking: přesný kód pro „nevypořádanou" (pending) transakci
  nebyl v dokumentaci jednoznačně dohledaný (jen `BOOK` pro
  zaúčtované je jistý).
- Enable Banking: „Restricted Production" mechanika ověřena jen
  nepřímo (souhrn vyhledávání, ne přímo načtená stránka) — než se na
  ní bude stavět reálné připojení, ověřit přímo v kontrolním panelu.
- Ani jeden poskytovatel nepublikuje ceník — oba řeší poptávkou.

## Krok pro Šéfíka (ne pro appku)

1. Založit si kontrolní panel na `enablebanking.com/sign-in`
   (e-mail, zdarma, bez smlouvy) — appka tohle krok nesmí udělat
   za Šéfíka (založení účtu u třetí strany).
2. V kontrolním panelu vytvořit API aplikaci (sandbox), stáhnout
   soukromý klíč, zapsat `ENABLEBANKING_APPLICATION_ID` a
   `ENABLEBANKING_PRIVATE_KEY` do prostředí appky.
3. Volitelně ověřit „Restricted Production" mechaniku přímo
   v kontrolním panelu — appka tenhle krok nedoložila líp než
   nepřímo.

---

## Oprava + pokračování — 6. 10. 2026

Bod 3 výš („ověřit přímo v kontrolním panelu, ne nepřímo") se
potvrdil jako správná obava. Šéfík si kontrolní panel skutečně
založil a živě (screenshot) zjistil: **„Aktivace propojením účtů"
(samoobslužná, zdarma, bez smlouvy) v rozbalovacím seznamu zemí
NEMÁ Česko** — jen „Požádat o aktivaci" (`/cp/billing`, poptávkový
formulář se zemí, objemem, regulatorním stavem) Česko nabízí. Tím
padá přesně ta část „DŮVOD VOLBY" výš, která řekla „Restricted
Production — reálné bankovní připojení, zdarma, bez smlouvy" — to
platí pro JINÉ země, ne pro ČR. **Sandbox (fiktivní data) zůstává
zdarma a samoobslužný beze změny** — jen reálné bankovní připojení
pro ČR vyžaduje tu placenou poptávkovou cestu.

Šéfík zadal znovu posoudit **Salt Edge Partners AIS** (ne obecné
„Account Information API" pro už licencované subjekty) a
**Finbricks MULTIBANK** jako náhradu/doplnění. Dva nezávislé živé
průzkumy (6. 10. 2026) + moje vlastní ověření GoCardless přímo na
jejich domácí stránce přinesly stejný vzorec jako u Enable
Banking — **žádný ze tří kandidátů nemá potvrzený bezplatný
samoobslužný přístup k reálným českým bankovním datům.**

### GoCardless Bank Account Data — potvrzeno definitivně vyřazeno

Přímo na `bankaccountdata.gocardless.com/new-signups-disabled`
(vlastní domén GoCardless, ne blog ani status page): „New signups
for Bank Account Data are currently disabled." Nový projekt dnes
nejde založit vůbec.

### Salt Edge Partners AIS

- **Není samoobslužné.** Partner Program začíná pozvánkou od
  obchodu (`saltedge.com/products/account_information/partner_program`).
  Appka/firma nejdřív dostane stav „Pending" (jen fake/sandbox
  banky), pak na žádost „Test" (do 2 prac. dnů), pak „Live"
  vyžaduje podepsanou Service Provision Agreement. **Jejich VLASTNÍ
  dokumentace si odporuje**, jestli „Test" (obecně zdarma, 100
  připojení, 90 dnů) platí i pro Partnery s reálnými ČR bankami —
  nepotvrzeno veřejně, jen obchodem.
- **Licenci na ČR účty nemá Salt Edge sám** — pro EU/EEA účty
  (včetně ČR) je v jejich vlastních podmínkách (`dashboard/terms_of_service`)
  jmenovaný „Gateway Partner" **SPENDEE a.s.** (Praha, AISP
  licence ČNB z 12. 12. 2018, S-Sp-2018/00139/CNB/571) — Salt Edge
  je jen technická vrstva nad jeho licencí.
- **Pokrytí bank** (živě z `saltedge.com/backend/v1/providers?country_code=CZ`,
  6. 10. 2026): všech 10 požadovaných bank je PSD2/open-banking
  „live". 9 z 10 má firemní i osobní účty — **Banka CREDITAS jen
  osobní, firemní NE.** OSVČ appka nedohledala u žádné banky ani
  jedno, ani druhé.
- **Souhlas se neobnovuje tiše** — po vypršení appka musí uživatele
  poslat zpátky přes widget (nové přihlášení v bance).
- **Cena nikde veřejně** — řeší se smlouvou.
- Tok je přesměrování (jako Enable Banking `/auth`), appka nikdy
  nevidí heslo — ale KAŽDÝ podnik navíc dostane vlastní Salt Edge
  dashboard účet a musí odkliknout anglické podmínky Salt Edge
  i Spendee.

### Finbricks MULTIBANK

- **Finbricks, s.r.o.** (IČO 10669205, Praha), 100% dceřiná
  společnost KB SmartSolutions (fintech ramene Komerční
  banky/Société Générale) — ověřeno v obchodním rejstříku. Od
  3/2025 vedená u ČNB jako platební instituce s oprávněním i pro
  AIS.
- **Není samoobslužné.** `docs.finbricks.com`, „Get Started": kontaktní
  formulář → obchodní hovor → **podpis před-smlouvy** → TEPRVE PAK
  sandbox — a ten sandbox běží proti REÁLNÉMU produkčnímu
  bankovnímu API (platby omezené na 1 Kč, ne mock prostředí).
- **Nejasné, jestli appka může mít JEDNU smlouvu pro VÍC nezávislých
  restaurací.** Jediný veřejně dohledaný precedent (napojení na
  ABRA/FlexiBee) si sám odporuje mezi dvěma verzemi dokumentace:
  jednou měl každý koncový klient smlouvu přímo s KB, jednou s
  Finbricks. Appka tohle NEVÍ jistě — kritická otázka pro obchod.
- **Pokrytí bank**: status page (`status.finbricks.com`) ukazuje
  živé AISP komponenty pro všech 10 požadovaných bank (plus J&T
  a Partners banka, 12 celkem) — ale „enabledForMerchant" (co má
  appka SMLUVNĚ povolené) je samostatný, soukromý přepínač.
  Firemní/OSVČ podporu nedokládá žádná banka ani v jednom, ani
  v druhém směru.
- **ČSOB a UniCredit nemají stabilní `fbxReference`** (unikátní
  id transakce) — appka by si u nich musela dedup řešit jinak,
  bez záruky jedinečnosti.
- Tok je přesměrování, appka nikdy nevidí heslo. Žádné JS/TS SDK
  (jen stará PHP knihovna) — appka by si podpis žádostí (RSA-4096,
  JWS) psala sama.

### Shrnutí — co se tím mění

| Poskytovatel | Self-serve k reálným ČR bankám | Licence na ČR | Pokrytí 10 bank | Příští krok |
|---|---|---|---|---|
| Enable Banking | **NE** (jen sandbox; ČR chybí v „Aktivace propojením účtů") | finská FIN-FSA (passporting) | 4/10 (KB/ČSOB/ČS/Raiffeisenbank) | zaplatit/poptat `/cp/billing`, nebo nechat jako je |
| Salt Edge Partners | Nejasné (obchod) | cizí — Spendee (ČNB) | 10/10 (CREDITAS jen osobní) | poslat otázky obchodu (níž) |
| Finbricks MULTIBANK | NE (před-smlouva → sandbox) | vlastní ČNB licence | 10/10 (nejasné firemní/OSVČ) | poslat otázky obchodu (níž) |
| GoCardless | NE — nepřijímá nové účty | — | — | vyřazeno definitivně |
| **Fio banka (přímý)** | **ANO** — appka to má hotové | netřeba (vlastní token) | 1/10 | žádný, funguje |

**Appka na tomhle nic neimplementuje navíc** (kód `BankDataProvider`
kontrakt má místo pro další adaptér hotové, žádná změna párování/
cashflow by to nevyžadovala — `lib/bank-provider-contract.ts`), dokud
Šéfík nezíská konkrétní odpověď od obchodu Salt Edge nebo Finbricks.
Rozhodnutí, se kterým poskytovatelem jednat (nebo jen zaplatit
Enable Banking poptávku), je obchodní/smluvní, ne technické — appka
ho nedělá za Šéfíka.

### Otázky pro obchod — Salt Edge (sales@saltedge.com / kontaktní formulář)

1. Pozvete FoodTab (český s.r.o., B2B SaaS pro restaurace,
   read-only, žádné platby) do Partner Programu? Jaký je čas od
   pozvánky k podpisu?
2. Umožňuje Partner „Test" stav reálná připojení k 10 jmenovaným
   ČR bankám přes vaši/Spendee licenci BEZ podepsané smlouvy? Jaký
   je limit připojení a doba platnosti — vaše dokumentace si
   odporuje.
3. Potvrďte, že Gateway Partner pro ČR účty je SPENDEE a.s.
   (S-Sp-2018/00139/CNB/571) pro všech 10 bank. Co se stane se
   stávajícími souhlasy, pokud se tahle spolupráce skončí?
4. Potřebuje FoodTab nebo každý klient registraci u ČNB (zákon
   370/2017 Sb.)?
5. Firemní (s.r.o.) a OSVČ účty u všech 10 bank — konkrétně Banka
   CREDITAS (firemní účty appka vidí jako nepokryté veřejně)?
6. Cena: jednotka (připojení/lead/účet), minimální měsíční
   poplatek, zřizovací poplatek, minimální doba smlouvy?

### Otázky pro obchod — Finbricks (sales@finbricks.com)

1. Může FoodTab mít JEDNU smlouvu a onboardovat víc restaurací
   jako koncové uživatele (clientId), nebo musí každá restaurace
   mít vlastní smlouvu/merchantId (jako u ABRA)?
2. Jaká je právní role FoodTabu — agent registrovaný u ČNB,
   technický poskytovatel, nebo reseller? Kdo je AIS poskytovatel
   vůči bankám a na souhlasové obrazovce?
3. Existuje AIS-only smlouva (bez platební brány)? Minimální
   měsíční poplatek, jednotka ceny, zřizovací poplatek?
4. Co přesně zavazuje před-smlouva, co odemyká sandbox? Jak dlouho
   je zdarma? Musí appka testovat na reálných bankovních účtech?
5. Firemní (s.r.o.) a OSVČ účty u všech 10 bank — potvrzeno?
6. Jedno aktivní připojení na uživatele (chyba 768) — u kterých
   bank? Jak to řeší jeden majitel s víc restauracemi?
