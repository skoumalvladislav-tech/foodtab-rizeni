# Rezervace a kalendář akcí — průzkum a návrh

**Zadání Šéfíka (25. 10. 2026):** „V modulu Provoz potřebuji novou záložku
Rezervace a kalendář akcí. Projdi podobné aplikace a vytvoř tuto sekci tak,
aby šla propojit na externí rezervační systém. U jednotlivých dnů a rezervací
má jít přidávat třeba dokumenty, poznámky či další informace.“

Kód: `app/[rozsah]/rezervace/**`, `lib/rezervace-*.ts`,
`lib/reservation-provider-contract.ts`, migrace
`supabase/migrations/20261027100000_rezervace_akce.sql`. Testy:
`supabase/tests/krok103_scenar.sql`, `scripts/rezervace.test.mjs`.
Otázky a rozhodnutí: `docs/hlaseni/otazky.md`, otázky 76–80.

---

## 1. Průzkum — jak to dělají jiní

Prošel jsem veřejné dokumentace a nápovědy (stav 25. 10. 2026). Co je ověřené
z dokumentace výrobce, je bez poznámky; co je jen z cizích zdrojů nebo se
ověřit nedalo, je označené.

### 1.1 Co mají rezervace a akce

| Systém | Rezervace nese | Akce / uzavřené společnosti | Poznámky ke dni |
|---|---|---|---|
| **TheFork** | stav (požadovaná, zapsaná, odmítnutá, zrušená, nedorazili), zvlášť „stav u stolu“ (dorazili, usazeni, účet, odešli), počet osob, čas s pásmem, stoly a prostor, poznámka hosta × interní poznámka, záruka kartou nebo záloha, kanál (TheFork, Google, web…) | samostatný modul nemá; skupiny jen jako nabídka menu | — |
| **SevenRooms** *(z cizích zdrojů)* | počet osob, prostor, kdo rezervoval, štítky a přání hosta | ano: prostory, menu, minimální útrata, zálohy, poptávky s vlastními stavy; smlouvy přes Tripleseat | neověřeno |
| **OpenTable** | schéma není veřejné | poptávky soukromých prostor; přes Tripleseat se do diáře propíše akce (datum, čas, stav, prostor, kontakt, poznámky) a zablokuje stoly | **poznámky ke směně** |
| **Tablein** | stavy: potvrzená, zpoždění, usazená, čeká, nedorazili, zrušená, walk-in, blokováno, čekací listina… | akce a zálohy: jednorázové i opakované, minimum hostů, poplatek za prostor, PDF menu | **poznámky ke dni** nahoře v seznamu, barva, autor, opakování po dnech týdne (bez příloh) |
| **ResDiary** | vznik, zrušení, změna času a počtu | „segmenty“ — nastavení diáře pro akci na období | — |
| **Reservio (CZ)** | stav, počet, poznámka, cena, kanál, klient (jméno, e-mail, telefon) | — (stavěné na termíny služeb, ne na stoly) | — |
| **Dotykačka — rezervace (CZ)** | začátek, konec, počet míst, stůl, zákazník, zaměstnanec, poznámka, stav (nová, potvrzená, zrušená) | — | kalendář dne a poznámky |
| **Toast Tables** | zálohy (zaplacená, nezaplacená, zrušená, vrácená) | Catering & Events: objednávkové listy (BEO), zálohy fakturou, poptávky, kalendář | — |
| **7shifts** (není rezervační) | — | „události“ v rozpisu směn | **Log Book**: deník dne s kategoriemi a komentáři |

**Restu (CZ) skončilo 31. 12. 2021** — mezi kandidáty nepatří.

### 1.2 Dá se na ně napojit?

| Systém | Veřejné API | Přístup | Webhooky | Stahování změn | Export |
|---|---|---|---|---|---|
| TheFork | ano (OpenAPI) | přístup vydává TheFork, restaurace ho musí schválit | **ano**, ale posílají jen číslo rezervace | podle data změny (po dnech) | ? |
| SevenRooms | dokumentace za přihlášením | partnerský formulář | neověřeno | `updated_since` *(z cizích zdrojů)* | ? |
| OpenTable | ano, po schválení a smlouvě | partnerský | neveřejné | ? | ? |
| Resy | ne | jen partneři | ? | ? | jen import CSV |
| ResDiary | ano, na žádost | přes podporu | **ano** (seznam událostí, tvar neveřejný) | denní výpis změn | ? |
| Tablein | ne | — | ne | — | **CSV/XLSX** |
| Reservio | ano | token (tarif Pro) nebo partner | **ne** (doporučují ptát se cca jednou za hodinu) | řazení podle vzniku | .ics |
| **Dotykačka** | **ano** (API v2) | token cloudu — **pokladnu už máme napojenou** | **ano**, entita `RESERVATION` „při změně“ | `versionDate` | ? |
| 7shifts | ano | token správce | ano, ale ne rezervace | — | — |
| Toast | **rezervace API nemá** | — | — | — | import CSV |

Zdroje (výběr): TheFork [OpenAPI](https://api.thefork.io/manager/openapi.json),
[webhooky](https://docs.thefork.io/B2B-API/event-webhook-flow); Tablein
[stavy](https://help.tablein.com/reservation-statuses),
[poznámky ke dni](https://help.tablein.com/using-notes),
[export](https://help.tablein.com/how-to-export-reservations); Reservio
[API v2](https://reservioapiv2.docs.apiary.io/); Dotykačka
[rezervace v API](http://docs.api.dotypos.com/entity/reservation/),
[webhooky](http://docs.api.dotypos.com/others/webhook/); ResDiary
[API](https://help-resdiary.theaccessgroup.com/en/articles/16108724-explore-and-request-your-resdiary-api);
OpenTable [dokumentace](https://docs.opentable.com/view/metadata/2sAXxTcWRy);
Toast [bez rezervačního API](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistReservation.html);
7shifts [Log Book](https://kb.7shifts.com/hc/en-us/articles/4417520176531);
Restu [konec služby](https://www.lupa.cz/aktuality/sluzba-na-rezervace-v-restauracich-restu-kvuli-covidu-konci/).

### 1.3 Co z průzkumu plyne

1. **Akce, smlouvy a poznámky ke dni žádné veřejné API nenabízí.** Patří proto
   Foodtabu. Rezervace ze systému je jen podklad, ke kterému si provoz
   přidává vlastní věci.
2. **Společný jmenovatel rezervace** je malý: číslo ve zdroji, začátek
   s pásmem, (konec), počet osob, stav, jméno, kontakt, poznámka hosta,
   (stůl). To je `RadekRezervace` v kontraktu.
3. **Stavy se v každém systému jmenují jinak.** Foodtab má pět svých
   (předběžná, potvrzená, proběhla, zrušená, nedorazili) a původní stav
   zdroje si ukládá vedle — neznámá hodnota se neztratí a nehádá se.
4. **Webhook je zvonek, ne zásilka.** TheFork posílá jen číslo, Dotykačka jen
   „změnilo se“; nikdo webhooky nepodepisuje a doručení nezaručuje. Proto po
   zvonku dotáhnout celý záznam a vedle toho pravidelně stahovat změny
   v překrývajících se oknech. Rezervace, která v okně chybí, **není smazaná**.
5. **Nejbližší první napojení je Dotykačka** — má rezervace v API i webhooky
   a pokladnu Foodtab už napojenou má. Čeká na ověření, že stávající přístup
   rezervace smí číst (otázka 78).

---

## 2. Co Foodtab staví (datový model)

| Tabulka | K čemu | Kdo čte |
|---|---|---|
| `rezervace` | rezervace i akce (`druh`), čas, provozní den, počet osob, stav (+ stav zdroje), prostor, typ akce, menu, záloha od hosta, odkud přišla | `rezervace.read` nebo `rezervace.manage` na pobočce |
| `rezervace_kontakty` | telefon a e-mail hosta (1 : 1) | **jen `rezervace.manage`** |
| `rezervace_poznamky` | poznámka nebo „další informace“ (nadpis + text: „Alergie: lepek“) — k rezervaci **nebo** ke dni pobočky | jako rezervace |
| `rezervace_prilohy` | dokumenty (fotky, PDF) — k rezervaci **nebo** ke dni pobočky; soubory v soukromém kbelíku `rezervace` | jako rezervace |
| `integrace_pripojeni` (stávající) | nová oblast `rezervace`: který systém je u pobočky napojený a v jakém stavu | registr `finance.read`, obrazovka Rezervací přes `rezervace_napojeni` |

Proč takhle:

- **Akce není jiná tabulka.** Uzavřená společnost má čas, počet a stav jako
  rezervace; navíc název, typ (volný text — typy akcí jsou data firmy, ne
  seznam v kódu), menu a zálohu. Jedna tabulka = jeden kalendář.
- **Den je provozní.** Rezervace v 1:30 patří k večeru předtím (stejně jako
  docházka). Počítá ho databáze z pásma a začátku dne pobočky.
- **Čas na zdi → okamžik dělá databáze** podle pásma pobočky (pravidlo 11).
  Z rezervačního systému se přijímá jen okamžik s pásmem.
- **Kontakt zvlášť.** Číšník potřebuje „Novák, 4 osoby, 19:00“, ne Novákův
  telefon. Kontakt z rezervace není marketingový souhlas a do jazykového
  modelu se neposílá (pravidlo 8). Neaudituje se (audit čte víc lidí).
- **Poznámky jako záznamy, ne jedno pole.** Každá má autora a čas, jde
  upravit i smazat a zůstává v auditu. Nadpis dělá z poznámky „další
  informaci“ (Dort: 20:00, Kontakt na DJ…), bez vymýšlení pevných kolonek.
- **Zápis jen přes funkce** (`rezervace_ulozit`, `rezervace_zmenit_stav`,
  `rezervace_pridat_poznamku`…, `rezervace_pripojit_prilohu`,
  `rezervace_importovat_csv`, `rezervace_importovat_zdroj`). Tabulky mají
  pro přihlášené jen `select`.
- **Dvojí ťuknutí nezdvojí rezervaci** — formulář nese číslo odeslání
  (`klic_odeslani`), poučení z dnešních záloh.

---

## 3. Čí je pravda (import a synchronizace)

| Údaj | U ruční rezervace | U rezervace ze souboru / ze systému |
|---|---|---|
| čas, konec, počet osob, stav, jméno, telefon, e-mail, poznámka hosta | Foodtab | **zdroj** — Foodtab je při každém novějším načtení přepíše a na obrazovce je nenabízí ke změně |
| druh (rezervace/akce), název, typ akce, menu, záloha od hosta | Foodtab | **Foodtab** — import se jich nedotkne |
| stůl / prostor | Foodtab | Foodtab; import ho **jen doplní, když je prázdný** |
| poznámky, další informace, dokumenty | Foodtab | **Foodtab** — import na ně nesahá |

- **Párování podle čísla ze zdroje:** (firma, pobočka, systém, číslo) je
  jedinečné. Tentýž soubor nebo tatáž dávka dvakrát = nic nového.
- **Starší nepřebije novější:** řádek, jehož čas změny ve zdroji je starší
  než uložený, se přeskočí (pozdě doručený webhook).
- **Zrušení ve zdroji = stav „zrušená“,** řádek i s poznámkami zůstává.
- **Co ve zdroji chybí, se nemaže.** Smazané je, až když to řekne zdroj
  (v první verzi se nemaže vůbec).
- **Soubor bez čísla rezervace:** číslo se odvodí z data, času a jména.
  Stejný soubor nic nezdvojí, ale rezervace, které se ve zdroji změnil čas,
  přibude jako nová — obrazovka to po načtení řekne.
- **Celý soubor, nebo nic:** jediný chybný řádek (neznámý stav, nesmyslné
  datum) zastaví načtení a ukáže, co opravit.
- **Zápis do zdroje se nedělá** (kontrakt: v první verzi jen čtení).

---

## 4. Napojení na rezervační systém (kostra adaptéru)

Stejný vzor jako pokladny (`lib/pokladna-*.ts`):

| Kousek | Soubor | Stav |
|---|---|---|
| Kontrakt — co musí adaptér umět a jaký řádek vrací | `lib/reservation-provider-contract.ts` | hotový (`RadekRezervace` s pásmem, stavem zdroje, časem změny) |
| Seznam systémů pro obrazovku (co víme o API) | `lib/rezervace-poskytovatele.ts` | hotový |
| Registr adaptérů | `lib/rezervace-adaptery.ts` | **prázdný schválně** |
| Převod řádku adaptéru → řádek pro databázi | `lib/rezervace-import.ts` (`zRadkuZdroje`) | hotový, odmítne čas bez pásma |
| Zápis do databáze | `public.rezervace_importovat_zdroj` (jen server) | hotový, jen nad **ověřeným** připojením |
| Stav napojení | `integrace_pripojeni`, oblast `rezervace` | „čeká na připojení“; **„připojeno“ databáze nedovolí bez úspěšného testu** |

**Jak přibude první systém** (návrh pro Dotykačku): adaptér podle kontraktu
(`overitPripojeni` ověří token, `nacistRezervace` vrátí rezervace okna),
řádek do `ADAPTERY_REZERVACI`, synchronizace na serveru po vzoru pokladen
(každých ~15 minut okno včera–za 60 dní) a příjem webhooku jako zvonku
(ověřit tajný token v adrese, hned odpovědět, dotáhnout záznam). Obrazovky,
import ani databáze se nemění.

**Do té doby:** ruční zápis a načtení CSV exportu (Tablein, Reservio
s exportem, cokoli jiného).

### 4.1 Univerzální příjmové API (25. 10. 2026 večer)

> **ROZHODNUTÍ ŠÉFÍKA (25. 10.):** „mám Choice, ale připravil bych
> univerzální možnost.“ Odpověď na otázku 78: Perla používá **Choice**.

Choice veřejné API pro rezervace nemá, adaptér se tedy psát nedá. Místo
toho má Foodtab vlastní adresu, na kterou rezervace pošle **kdokoli** —
rezervační systém webhookem, nebo prostředník n8n/Make/Zapier. Stejný
vzor jako „Jiná pokladna“ u pokladen.

| Kousek | Kde |
|---|---|
| Adresa `POST /api/rezervace/prijem`, klíč `ftrez_<id připojení>_<náhoda>` v hlavičce | `app/api/rezervace/prijem/route.ts` |
| Klíč jen zašifrovaný (`integrace_tajemstvi`), ukázaný jednou, porovnání v konstantním čase; vydává a vyměňuje `integrace.manage` | Rezervace → Napojení a import, `vydatKlicPrijmuRezervaci` |
| Kontrola zprávy (pole i jedna rezervace, čas s pásmem nebo datum + hodina na pobočce, neznámý stav = předběžná se zachovaným slovem) | `lib/rezervace-prijem-api.ts` |
| Zápis: `public.rezervace_prijmout` (jen `service_role`) → stejná pravidla jako import; **„připojeno“ až po úspěšně zapsané dávce, v téže transakci** | `20261028100000_rezervace_prijem.sql` |
| Popis pro integrátora | `docs/rezervace-api.md` |

Jméno systému ve zprávě (`"system": "choice"`) se ukládá jako
`rezervace.poskytovatel`, takže se tytéž rezervace spárují i s CSV exportem
Choice načteným pod stejným jménem.

### 4.2 Dokumenty už při založení

Formulář nové rezervace nebo akce má „Přidat dokument“ (fotky, PDF).
Soubory jdou z prohlížeče rovnou do úložiště pod zvolenou pobočku, akce
pak rezervaci založí a připojí je (`rezervace_pripojit_prilohu` u každého
ověří úložiště, typ a velikost). Když se některý nepřipojí, rezervace
zůstane a obrazovka to řekne.

---

## 5. Obrazovky

Provoz → **Rezervace a akce** (`/<rozsah>/rezervace`), ikona kalendáře
s fajfkou. V nabídce až za Vzkazy a úkoly — spodní lišta na telefonu zůstává
Dnes / Směny / Docházka / Vzkazy.

| Obrazovka | Co tam je |
|---|---|
| **Kalendář — Týden** (výchozí) | sedm karet po dnech: počet rezervací, akcí a hostů, značka poznámek a dokumentů, rezervace s časem; dnešek a víkend mosazným tónem; na telefonu pod sebou |
| **Kalendář — Měsíc** | mřížka po celých týdnech s počty a názvy akcí; na telefonu seznam dnů, na kterých něco je |
| **Den** (`/rezervace/den/RRRR-MM-DD`) | přehledové karty (rezervace, hosté, akce), seznam rezervací dne; vpravo **poznámky ke dni** a **dokumenty ke dni**; na firemním rozsahu po pobočkách |
| **Detail rezervace / akce** | údaje, stav a rychlé změny stavu, u importované odkud přišla a co se kde mění, úprava; vpravo poznámky a další informace, dokumenty |
| **Nová rezervace / Nová akce** | formulář; u akce název, typ, menu a záloha |
| **Napojení a import** | stav napojení u poboček, příprava napojení (jen `integrace.manage`), načtení CSV, přehled systémů a co o nich víme |

Vzhled podle závazného mockupu Dnes (docs/vzhled-zadani.md, oddíl 11):
patkové nadpisy a čísla, karty `.ds-plocha` a `KpiKarta`, ikony jen ze
sdílené sady (přibyla `rezervace`), tokeny pro světlý i tmavý režim.
Styly v `app/_rezervace.css`.

Finance → Integrace: karta „Rezervace a objednávky — připravujeme“ se
změnila na odkaz „Rezervace“ do Napojení a importu.

---

## 6. Práva

| Právo | Popisek v Nastavení | Co dává |
|---|---|---|
| `rezervace.read` | Vidět rezervace a kalendář akcí | kalendář, rezervace, poznámky, dokumenty, stav napojení |
| `rezervace.manage` (citlivé) | Zapisovat rezervace a akce, poznámky a přílohy; vidět kontakty hostů | zápis, import ze souboru, telefon a e-mail hosta |
| `integrace.manage` (stávající) | Správa napojení na externí systémy | připravit a odpojit napojení |

Modul `provoz`. **Stávajícím zaměstnancům se práva nedosazují** (do
zařazení u zákazníků se nesahá) — majitel vidí vše sám, ostatním je musí
přidat Šéfík v Nastavení → Zařazení (otázka 76). Nové firmy: provozní obě,
vedoucí směny čtení.

---

## 7. Co se schválně nedělá

- **Živé napojení** žádného systému (bez dokumentace a přístupu se tvar
  nevymýšlí) a **příjem webhooku** (veřejná adresa = nová bezpečnostní
  plocha, má smysl až s prvním adaptérem).
- **Plánek stolů a obsazenost v reálném čase** — to dělá rezervační systém
  nebo pokladna; Foodtab drží „stůl / prostor“ jako text.
- **Zápis zpět do rezervačního systému.**
- **Platby záloh** — záloha od hosta je jen evidence (částka a stav). Nemá
  nic společného s `advances` (zálohy zaměstnancům).
- **Word a Excel jako přílohy** — jen fotky a PDF jako jinde v appce
  (otázka 79).
- **Rezervace na obrazovce Dnes** — samostatný další krok (počet dnešních
  rezervací a hostů na kartě).

---

## 8. Ověření

- `supabase/tests/krok103_scenar.sql` — 131 kontrol v PGlite: čas podle pásma
  (zima, léto, přes půlnoc, provozní den po půlnoci), kdo nesmí zapisovat,
  čtení po právech (čtenář nevidí kontakt), zápis mimo funkce, druhá linie
  ve spouštích, poznámky, přílohy (úložiště po pobočkách, typ z úložiště,
  připojený soubor nejde smazat), import ze souboru (nic se nezdvojí, údaje
  Foodtabu nepřepíše, celé nebo nic), import ze zdroje (jen ověřené
  připojení, čas bez pásma ne, starší nepřebije novější), granty, audit.
- `scripts/rezervace.test.mjs` — 95 kontrol: čtení CSV, převod stavů,
  formulář, kalendář, „připojeno“ nikde natvrdo, přílohy, přístup napřed
  na všech stránkách a akcích.
- Schválná rozbití — u každé kontroly ověřeno, že spadne (seznam v PR).
- Rozhoduje běh proti PostgreSQL 16 ve workflow Databáze.

---

## 9. Další kroky (návrh)

1. ~~Který rezervační systém~~ — Choice (Perla), napojení přes příjmové API
   (oddíl 4.1). Zbývá vědět, co používá Bernard.
2. Přidat práva rezervací lidem v Nastavení → Zařazení.
3. Vydat klíč pro Perlu a nastavit v Choice (webhook) nebo v n8n/Make
   posílání rezervací — podle `docs/rezervace-api.md`.
4. Karta rezervací na obrazovce Dnes.
