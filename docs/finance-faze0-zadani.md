# Zadání: Finance, Fáze 0 – srovnat data (banka, párování, dodavatelé, kategorie)

Navazuje na `docs/finance-erp-navrh.md` (celkový návrh) a **nahrazuje v několika bodech** `docs/faktury-modul-zadani.md` (viz bod 8).

## 1. Kdo to rozhodl a kdy

Šéfík, 18. 11. 2026:
- „banku bych neurčoval, apka bude pro prodej, necháme neutrální připojení, ale můžeme přidat napojení pro Komerční banku"
- „sazby práce bereme z lidí (zaměstnanců) vedených v apce jako lidé"
- „sklad a inventury nepotřebujeme, data si můžeme stáhnout z POS"
- „nákupy a platby schvaluje vždy majitel podniku nebo možnost dát do práv u zaměstnanců"

Cíl Fáze 0: aby čísla ve Financích a ve Fakturách byla pravdivá. Dashboard (Fáze 1) se staví až nad nimi, a proto **v této práci nevzniká**.

## 2. Co dnes nesedí

Pozorováno v živé aplikaci 18. 11. 2026 (Finance, pohled Celá firma). Čísla a místa v kódu si ověř auditem (krok 0).

- Banka není napojená. Faktury ukazují 7 707 040,81 Kč „otevřeno k úhradě" (1777 faktur) a 7 028 241,47 Kč „po splatnosti" (664 faktur, některé 250 a víc dní). Kalendář splatností ukazuje 689 faktur, z toho 665 po splatnosti. Cashflow na 13 týdnů je celé 0 Kč. Platby: „Zatím žádné zapsané pohyby". Stav u většiny: „Ke kontrole úhrady".
- Foodcost a Beverage cost jsou prázdné. Náklady podle kategorie: „Zatím žádné kategorizované náklady".
- Rozpočty a controlling: Bernard Bar „nemá přiřazený žádný platební účet", prime cost „chybí tržby".
- 542 faktur čeká na ruční kontrolu (AI nevytáhla údaje, nebo šlo o obrázek místo PDF). 217 možných duplicit. 2 dokumenty čekají na schválení.
- Dva registry dodavatelů: Kontakty (0 záznamů) a dodavatelé ve Fakturách (47 aktivních, 99 celkem). Stejný dodavatel vícekrát, např. „MAKRO Cash & Carry CR s.r.o.", „MAKRO Cash & Carry ČR s.r.o." a „MAKRO Cash & Carry CR s.r.o., Jeremiášova 1249/7, Praha 5, 15500".
- E-mailové schránky už **existují** (Černá perla email, faktury@cerna-perla.cz, faktury@foodtab.cz, přes IMAP). Dotykačka a Choice jsou připojené. V Integracích jsou banky (Fio, Enable Banking) jen jako nabídka.

## 3. Co udělat (každý krok samostatně odevzdatelný)

**Krok 0 – Audit ve správné větvi. Nic neměň.**
Lokální `foodtab-rizeni` je starší než živá aplikace (migrace končí 17. 9., ve Financích je jen složka Faktury). Novější práce je pravděpodobně v dalších pracovních kopiích (`foodtab-finance-erp`, `foodtab-gastro-erp`, `foodtab-foodcost`, `foodtab-banka-provider`, `foodtab-banka-upresneni`, `foodtab-banka-logy`, `foodtab-faktury-prijem`, `foodtab-faktury-slouceni`, `foodtab-integrace`).
- `git worktree list`, `git branch -a`, `git fetch`, porovnej s tím, co běží na Vercelu. Urči, kde je skutečně nejnovější stav Financí a Faktur, a v tom pracuj. **Nic nemerguj a nepřepisuj.**
- Zjisti, co už z kroků 1–9 existuje (bankovní tabulky, párování, kategorie, sloučení dodavatelů). Co existuje, dokonči a oprav, nepiš znovu.
- Dotaz do ostré databáze **jen čtení**: počty faktur podle stavu, kolik má vyplněné IČO, kolik dodavatelů má shodné IČO pod různými názvy, kolik faktur má položky.
- Výstup `docs/hlaseni/audit-finance-faze0.md` ve tvaru „soubor:řádek, co dnes nesedí" a seznam, co už je hotové.

**Krok 1 – Neutrální bankovní vrstva.**
- Tabulky `bankovni_ucty` (patří pobočce a firmě) a `bankovni_pohyby` (datum, částka se znaménkem, měna, protistrana, IBAN protistrany, variabilní symbol, zpráva, externí ID, zdroj). Nikde se nesmí objevit jméno konkrétní banky v jádru, jen v konektoru.
- Rozhraní konektoru: jedna funkce „stáhni pohyby od data" vrací pohyby ve společném formátu. Konektory: (a) **import CSV/výpisu** (základ, funguje u jakékoli banky), (b) **Komerční banka**. U KB nejdřív zjisti, jestli existuje přímé API použitelné pro malou firmu, nebo půjde přes agregátor (Enable Banking je už v Integracích). Co se nepovede ověřit, zapiš do `docs/hlaseni/otazky.md` a udělej jen import CSV z KB. Skutečný formát exportu KB nehádej, vyžádej si vzorek (otázka do `otazky.md`).
- Import je **idempotentní**: stejný pohyb se nikdy nezapíše dvakrát (externí ID, jinak hash účet+datum+částka+VS+protistrana).
- Přístupové údaje k bance jen na serveru, šifrované, nikdy nejdou klientovi ani do logu. Pouze čtení.
- Úprava v Integracích: výběr banky/konektoru, přiřazení účtu pobočce (krok 8).

**Krok 2 – Párování faktur s pohyby.**
- Pravidla v pořadí: (1) VS + částka + IBAN dodavatele = jisté, spáruje se samo. (2) částka + dodavatel + datum v rozumném okně = návrh. (3) jinak nespárováno.
- Zvládnout: jedna platba za více faktur, jedna faktura po částech, cizí měna, dobropisy.
- Stav „zaplaceno" faktury se **odvozuje z párování**, nepíše se ručně nad ním. Ruční „zaplaceno" zůstává, ale s důvodem a autorem.
- Návrhy čekají na potvrzení. Každé párování lze vrátit zpět. Vše do auditní stopy.
- Dvě fronty v UI: „Návrhy párování" a „Platby bez faktury" (to hledá účetní).

**Krok 3 – Pobočky a účty.** Každá pobočka má přiřazený platební účet (dnes ho nemá Bernard Bar). Bez přiřazení se pohyby neukazují v pobočkových součtech a Finance to říkají nahlas.

**Krok 4 – Právo „Schvalovat nákupy a platby".**
- Nové právo v modulu práv, **volitelně s limitem částky a omezením na pobočku**. Majitel ho má vždy a nelze mu ho odebrat.
- Schválení faktury, potvrzení návrhu párování a ruční „zaplaceno" vyžadují toto právo. Bez práva tlačítko nejde použít a **kontrola proběhne na serveru**, ne jen v klientovi.
- Každé schválení do auditu (kdo, kdy, kolik, u čeho).
- Navazuje na existující právo „Vidět objednávky a sklad" (Nákup). Neměň ho, jen přidej nové.

**Krok 5 – Kategorie nákladů.**
- Číselník kategorií (potraviny, nápoje, obaly, energie, nájem, služby, mzdy, ostatní…) s příznakem COGS: jídlo / nápoj / ne. Základní sada, upravitelná (finální osnovu dodá účetní).
- Výchozí kategorie u dodavatele, faktura ji dědí, lze přepsat po položkách.
- AI **navrhne** kategorii dodavatele (z názvu a historie), nepřiřazuje sama. Majitel potvrdí hromadně po dodavatelích.
- Výstup: „Náklady podle kategorie" ve Fakturách (dnes prázdné) a pole pro budoucí foodcost/beverage cost.

**Krok 6 – Jeden registr dodavatelů.**
- Sloučit Kontakty a dodavatele z Faktur do jednoho registru, klíč IČO, aliasy názvů.
- **Nejdřív jen návrhy** (např. tři názvy MAKRO se stejným IČO), seznam v UI ke schválení. Bez shody IČO se nesloučí nic automaticky.
- Sloučení zachová všechny faktury a umí návrat zpět.

**Krok 7 – Duplicity (217).**
- Přehled možných duplicit s porovnáním vedle sebe (dodavatel, číslo, částka, datum, soubor). Rozhodnutí „je duplicita / není" per případ, **nic se nemaže**, duplicita se jen označí a vyřadí z počítání.
- Zpřesnit pravidlo: hash souboru + (dodavatel, číslo faktury, částka, datum). Faktury „bez čísla" (E.ON) se samy za duplicitu nepovažují.

**Krok 8 – Fronta 542 faktur „ke kontrole".**
- Znovu zpracovat dokument přes Claude API přímo jako PDF/obrázek (ne přes OCR), strukturovaný výstup, kontroly součtů a DPH běžným kódem. Klíč jen na serveru.
- Co projde kontrolou s vysokou jistotou, jde do „ke schválení", ne rovnou do přehledů. **AI nic neschvaluje.**
- Dávkově, s limitem rychlosti a zastavením při chybě. Odhad nákladů na AI zapsat do hlášení před spuštěním hromadné dávky (ta se spouští až po schválení majitelem, v noci se jen připraví a zkusí na vzorku 20 kusů).

**Krok 9 – Úklid starých faktur (připravit, nespouštět na ostrých datech).**
- Po kroku 2 vytvoř **suchý běh**: seznam faktur, které banka potvrzuje jako zaplacené, a seznam těch, které zůstanou nezaplacené, s částkami. Výstup jako soubor v `docs/hlaseni/`, ne zásah do dat.
- Hromadné označení spouští majitel sám po kontrole seznamu.

## 4. Co teď nedělat

- **Žádný dashboard ani Fázi 1+.** Žádné receptury, sklad, inventury (rozhodnutí majitele).
- **Nenasazovat**, `db push` ani nasucho. Nasazuje majitel.
- **Neměnit ostrá data** (žádné hromadné označování, sloučení ani mazání). Vše, co mění data, se připraví jako návrh nebo suchý běh.
- **Neplatit z aplikace.** Banka je jen pro čtení.
- Do jádra nepsat nic specifického pro jednu banku nebo jednoho POS.
- Neměnit nic v e-mailovém příjmu, kromě oprav chyb, které audit prokáže.
- Žádné klíče, tokeny ani přístupy v kódu, logu nebo odpovědích klientovi.
- Nemergovat cizí větve.

## 5. Zkoušky

U každé platí: **rozbij schválně to, co má hlídat, a přesvědč se, že zkouška spadne.** Zkoušky proti opravdovému PostgreSQL, ne proti mocku (skill `overeni-pred-nasazenim`).

1. Idempotence importu: dvojí import stejného výpisu nevytvoří druhý pohyb.
2. Párování VS + částka + IBAN se spáruje samo, nejisté zůstane návrhem.
3. Jedna platba za více faktur a jedna faktura po částech sedí na haléře.
4. Stav „zaplaceno" se odvozuje z párování, po vrácení párování se vrátí stav faktury.
5. Právo schvalovat: uživatel bez práva nemůže schválit ani přes přímé volání serveru. Majitel může vždy. Limit částky se vynucuje na serveru.
6. RLS: uživatel jiné pobočky nevidí cizí účty ani pohyby. Přihlašovací údaje k bance se klientovi nikdy nevrátí.
7. Sloučení dodavatelů: bez shody IČO se nic nesloučí, po sloučení zůstanou všechny faktury, návrat zpět funguje.
8. Faktury „bez čísla" se samy nestanou duplicitou.
9. AI výstup se špatným součtem skončí ve frontě ke kontrole, nikdy ne ve schválených.
10. Suchý běh úklidu nezmění jediný řádek v databázi.
11. Migrace proběhne nanečisto na kopii ostrých dat bez ztráty faktur.

## 6. Pořadí a kde se dá skončit

Pořadí: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

- Po kroku 0 se skončit dá (jen hlášení).
- Kroky 1 a 2 jsou jedna dvojice: bankovní tabulky bez párování nic neřeší, ale po kroku 1 se skončit dá, pokud je celý včetně zkoušek.
- **Krok 4 (práva) se skončit nedá v půlce.** Je to zásah do oprávnění: buď celý včetně zkoušky 5 a 6, nebo vůbec, a nic necommitovat napůl.
- Po kroku 5, 6, 7, 8 se skončit dá, každý je samostatně odevzdatelný.

## 7. Pravidla noční práce

- **Na nic se neptej.** Otázku do `docs/hlaseni/otazky.md`, do kódu `// ROZHODNOUT:`, vyber nejopatrnější variantu a jdi na jiný krok.
- Technická rozhodnutí jsou tvoje. Provozní pravidla neodhaduj. Do `otazky.md` zapiš zejména: vzorek exportu KB, finální osnova kategorií od účetního, koeficient odvodů zaměstnavatele (Fáze 1), kterému účtu patří která pobočka.
- Do hlášení i to, na co jsi narazil a nešlo to. Bývá to nejcennější část.
- Ráno hlášení v `docs/hlaseni/` a push.

## 8. Co z předchozího zadání (`faktury-modul-zadani.md`) neplatí

Kde se dvě zadání liší, **platí toto**:
- Příjem z e-mailových schránek **už existuje**. Krok 2 starého zadání (vybudovat příjem) neplatí. Jen případné opravy podle auditu.
- Pořadí: banka a párování jsou nejdůležitější a jdou první. Focení v aplikaci a rozšířené AI zpracování z původního zadání se odkládají za tuto Fázi 0, s výjimkou kroku 8 výše.
- Banka: ne Fio ani jiná konkrétní, ale neutrální vrstva s konektory (CSV a Komerční banka).
- Schvalování: ne „jen majitel", ale majitel plus zaměstnanci s právem (krok 4).
- Platí dál: zákazy (neplatit, nenasazovat), zkoušky ochrany před duplicitami a RLS, noční pravidla.
