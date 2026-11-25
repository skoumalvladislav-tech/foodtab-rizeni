# Foodtab Finance – návrh celkového řešení (gastro ERP)

Aktualizováno 18. 11. 2026 po rozhodnutích majitele (viz bod 7).

Stav k 18. 11. 2026. Vychází z prohlídky živé aplikace (foodtab-rizeni.vercel.app, Finance a účetnictví, pohled „Celá firma") a z průzkumu současných nástrojů pro restaurace.

## 1. Kde Finance dnes stojí (z živé aplikace)

**Co už funguje a stojí za to nechat:**
- Přehled s kartami Tržby, Cashflow, Foodcost, Beverage cost, Náklady práce a filtrem Celá firma / Bernard Bar Tábor / Restaurace Černá Perla.
- Tržby po dnech, měsících i letech, po pobočkách a způsobech platby, s porovnáním s minulým obdobím (listopad 2026: 679 915 Kč z pokladen).
- Náklady práce už se počítají (21,1 %) z docházky.
- Integrace: 3 e-mailové schránky přes IMAP (Černá perla email, faktury@cerna-perla.cz, faktury@foodtab.cz), Dotykačka, Choice (obě pobočky). Dotykačka rezervace čeká na připojení, banky (Fio, Enable Banking) jsou jen nabídka.
- Faktury: přehled, seznam, dodavatelé, schvalování, upomínky, kalendář splatností, přehledy nákladů podle DUZP, export CSV pro účetního a e-mail účetnímu, detekce duplicit.
- Zásada „appka počítá, nikdy neodhaduje" je správná a zůstává.

**Co dnes nesedí (to je důvod, proč dashboard zatím nelze brát vážně):**
1. **Banka není napojená**, a proto čísla u faktur lžou. Přehled ukazuje 7 707 040,81 Kč „otevřeno k úhradě" a 7 028 241,47 Kč „po splatnosti" (664 faktur, některé 250 a víc dní). Většina z nich je téměř jistě zaplacená, jen to appka neví. Cashflow na 13 týdnů je celý 0 Kč, Platby jsou prázdné („Zatím žádné zapsané pohyby").
2. **Foodcost a Beverage cost jsou prázdné („–")**. Chybí kategorizace nákladů („Zatím žádné kategorizované náklady") a receptury. V Rozpočtech u Bernard Baru stojí „chybí tržby", protože pobočka nemá přiřazený platební účet. Prime cost je jen odhad.
3. **542 faktur čeká na ruční kontrolu** (AI nevytáhla údaje nebo šlo o obrázek místo PDF) a **217 možných duplicit**.
4. **Dva registry dodavatelů.** Kontakty jsou prázdné (0), ve Fakturách je 47 aktivních a 99 celkem dodavatelů. Stejný dodavatel je veden víckrát (MAKRO Cash & Carry vystupuje pod třemi různými názvy).
5. Nákup hlásí „nemáte oprávnění" (patří pod právo „Vidět objednávky a sklad"). Zakázky a Vybavení jsou prázdné.
6. Náklady práce (21,1 %) a tržby se zatím nespojují do jednoho prime costu na úrovni pobočky.

Poznámka: lokální kopie repozitáře `foodtab-rizeni` je starší než živá aplikace (migrace končí 17. 9. a složka Finance v ní obsahuje jen Faktury). Novější práce je zřejmě ve složkách `foodtab-finance-erp`, `foodtab-gastro-erp`, `foodtab-foodcost`, `foodtab-banka-provider` a dalších. Ty jsem nečetl. Code musí začít auditem ve správné větvi (viz níže).

## 2. Co dělají moderní systémy (a z čeho si bereme)

- **Prime cost živě, ne na konci měsíce.** Restaurant365 spojuje food cost, mzdy a tržby v jedné platformě, aby operátor viděl prime cost v reálném čase. Prime cost = COGS + práce, jako procento z čistých tržeb (po stornech a slevách).
- **Teoretický vs. skutečný foodcost.** Teoretický vychází z toho, co se prodalo a kolik stojí receptura. Skutečný z inventury a faktur. Rozdíl odhaluje plýtvání, porce a krádeže.
- **Automatizace faktur včetně položek.** MarginEdge a podobní čtou faktury do úrovně položek, a tím krmí recepturové náklady a výsledovku. Dnes se to dělá s AI přímo ve vstupu.
- **Porovnání poboček a odlehlé hodnoty.** Cenná je informace, která pobočka vybočuje a proč, ne průměr skupiny.
- **Benchmarky pro orientaci** (US/EU zdroje, pro Česko brát jako přibližné): foodcost cca 25–35 %, náklady práce cca 25–33 % (plná obsluha výš), prime cost do ~60 %. Vlastní historie je důležitější než benchmark.
- **Česko:** povinná B2B e-fakturace zatím neplatí. Slovensko ji zavádí od 1. 1. 2027 přes Peppol. Doporučení pro Foodtab: umět číst ISDOC a strukturované XML, Peppol připravit až později.

## 3. Cílová architektura

Jedna pravda o penězích, čtyři vrstvy:

**A. Vstupy (vše automaticky):** pokladna (Dotykačka, Choice), e-mailové schránky a focení (faktury), banka (výpisy / API), docházka a směny (už v appce), data o prodeji a spotřebě z POS (receptury, skladové karty – ověřit, co Dotykačka vydá).

**B. Jádro (datová vrstva):**
- Jeden registr **dodavatelů a odběratelů** (sloučit Kontakty a dodavatele z Faktur, klíč IČO, aliasy názvů, IBAN, splatnost, výchozí kategorie nákladu).
- **Faktury + položky faktur** (řádky s množstvím, jednotkou, cenou) jako zdroj skutečných nákupních cen.
- **Bankovní účty a pohyby**, každý účet patří pobočce / firmě. **Banka je neutrální:** jádro pracuje jen s jedním vlastním formátem pohybu (datum, částka, protistrana, IBAN, VS, popis) a každá banka je jen vyměnitelný konektor (import CSV/výpisu jako základ, přímé napojení jako nadstavba). Aplikace tak nezávisí na jedné bance a lze ji nabízet dál. První konkrétní konektor je **Komerční banka**. **Párování** pohybu s fakturou (jisté automaticky, nejisté jako návrh).
- **Kategorie nákladů** (potraviny, nápoje, obaly, energie, nájem, služby, mzdy…) s příznakem „COGS: jídlo / nápoj / ne".
- **Středisko = pobočka** na všem (tržby, faktury, pohyby, mzdy).
- **Bez vlastního skladu a inventur.** Spotřebu a receptury bereme z POS (Dotykačka), nové skladové moduly nestavíme.
- **Auditní stopa** u všeho, co AI navrhla a člověk potvrdil.

**C. Výpočty (appka počítá, nikdy neodhaduje):** tržby, COGS jídlo/nápoj, náklady práce, prime cost, provozní výsledek (zjednodušená výsledovka), cashflow, plnění rozpočtu. U každého čísla ukazatel **úplnosti dat** („podklady za 82 % nákupů"), aby nikdo nečetl neúplné číslo jako hotové.

**D. Obrazovky:**

1. **Řídicí panel (dashboard)**: pruh KPI (tržby, prime cost %, foodcost %, beverage cost %, práce %, peníze na účtech, k úhradě do 7 / 30 dní), trend vs. minulý měsíc / rok, tabulka poboček (kdo vybočuje), „co vyžaduje pozornost" (neschválené faktury, nespárované platby, zdražení u dodavatele, překročený cíl nákladů). Každé číslo má proklik až na fakturu nebo směnu.
2. **Faktury a platby (AP)**: příjem (e-mail, foto, ruční) → AI čtení → kontrola → schválení → plán platby → úhrada → párování s bankou. Frontu „Ke kontrole" zredukovat, ne zvětšovat.
3. **Kalendář plateb**: týdenní/měsíční pohled na splatnosti po dnech, součet „k zaplacení tento týden", zvýraznění nedostatku peněz proti zůstatku, možnost seskupit platby po dodavateli a **exportovat dávku pro banku** (ABO / SEPA). Platbu odešle člověk v bance, Foodtab nikdy neplatí sám.
4. **Cashflow**: skutečný zůstatek z banky + otevřené závazky + očekávané tržby, scénáře (základní / konzervativní / optimistický, to už existuje).
5. **Tržby**: po pobočce, kanálu (sál, rozvoz, bufet, catering), hodině, kategorii. Tržba na odpracovanou hodinu.
6. **Náklady práce**: hodinová sazba se bere ze záznamu zaměstnance v modulu Lidé × odpracované hodiny z docházky (plán ze směn). Přesčasy, % z tržeb po dnech, doporučení obsazení podle očekávaných tržeb. Sazba v Lidech je zřejmě hrubá, proto má nastavení **koeficient příplatku za odvody zaměstnavatele** (zvlášť pro HPP a dohody), aby prime cost nebyl podhodnocený. Hodnotu koeficientu určí účetní.
7. **Foodcost a Beverage cost**: nejdřív z nákupů (faktury podle kategorie ÷ tržby jídla / nápojů). Později teoretický foodcost z dat POS (prodané položky × receptury) proti nákupům z faktur za stejné období. Bez inventur nejde zachytit změna zásob, takže skutečný foodcost je přibližně roven nákupům za období. Appka to u čísla otevřeně napíše. Sledování změn cen u dodavatelů (kolik % zdražilo zboží, které kupujeme nejčastěji).
8. **Výsledovka a rozpočty**: měsíční P&L po pobočkách a za firmu, plán vs. skutečnost, export pro účetního (CSV už je, přidat ISDOC).
9. **AI analytik** (tlačítko „Zeptat se AI analytika" už v appce je): odpovídá nad již spočtenými čísly („proč vzrostl foodcost v Bernard Baru?"), nikdy si čísla nevymýšlí, vždy uvede zdroj.

## 4. Pořadí práce (podle hodnoty a závislostí)

**Fáze 0 – srovnat data (bez toho je každý dashboard nepravdivý).** Tohle je nejdůležitější a dnes největší problém.
- Zavést neutrální bankovní vrstvu (společný formát pohybů, konektory) a první konektor pro Komerční banku, nejprve alespoň import výpisu. Přiřadit účty pobočkám. Zapnout automatické párování faktur s platbami. Ověřit, zda KB nabízí přímé napojení, nebo půjde přes agregátor (Enable Banking už je v Integracích). Očekávaný efekt: 7 mil. „po splatnosti" se rozpadne na skutečně neuhrazené.
- Hromadně vyřešit staré faktury (archiv, označit jako zaplacené podle banky nebo účetního), projít 217 duplicit.
- Sloučit dodavatele (alias názvů podle IČO), zrušit dvojí registr.
- Zavést kategorie nákladů a výchozí kategorii u dodavatele (MAKRO, Bidfood, BOBY-H → potraviny; pivovary → nápoje).
- Zredukovat 542 faktur „ke kontrole": přečíst AI znovu s dokumentem přímo (PDF i obrázek), ne přes OCR.

**Fáze 1 – dashboard a P&L light.** Prime cost z reálných dat (COGS z faktur podle kategorií + práce ze směn), tabulka poboček, kalendář plateb s dávkou do banky, cashflow z reálného zůstatku.

**Fáze 2 – foodcost přesněji z dat POS.** Stažení prodaných položek a receptur z Dotykačky, teoretický foodcost proti nákupům z faktur, sledování zdražování. Žádný vlastní sklad ani inventury.

**Fáze 3 – řízení a předvídání.** Rozpočty, upozornění na odchylky, AI analytik, doporučené obsazení podle očekávaných tržeb, srovnání poboček.

**Fáze 4 – ekosystém.** Další bankovní konektory, čtení ISDOC / strukturovaných e-faktur, příprava na Peppol, napojení na účetní software účetního, role „účetní" s vlastním pohledem.

## 5. Zásady (platí pro všechno)

- Dashboard nikdy neukazuje číslo bez informace o úplnosti podkladů.
- AI navrhuje, člověk schvaluje (u peněz vždy). Foodtab sám **neplatí**, jen připraví dávku.
- Každé číslo má proklik na zdroj.
- Pobočka je povinný rozměr u každé tržby, faktury, platby a směny.
- **Nákupy a platby schvaluje vždy majitel podniku, případně zaměstnanec, kterému to majitel výslovně přidělí v právech** (nové právo „Schvalovat nákupy a platby“, volitelně s limitem částky a omezením na pobočku). Bez práva nelze schválit. Každé schválení se zapisuje do auditu (kdo, kdy, kolik).
- Ostatní oprávnění po rolích (majitel, vedoucí pobočky, účetní, kuchyň). Citlivé věci (mzdy, banka) jen pro majitele.
- Aplikace je **neutrální vůči POS a bance** (adaptéry), protože ji chcete nabízet i dalším podnikům.
- Žádné klíče a přístupy v kódu ani v klientu. Banka read-only.

## 6. Co z dřívějšího zadání (`faktury-modul-zadani.md`) neplatí

- Příjem z e-mailových schránek **už existuje** (3 schránky přes IMAP). Krok 2 se mění z „vybudovat" na „doplnit a zpevnit" (OAuth tam, kde to poskytovatel umožní, kontrola chyb jedné schránky, idempotence). Nezačínat znovu.
- Krok 0 (audit) zůstává a je důležitější: audit musí proběhnout v nejnovější větvi, ne v kopii `foodtab-rizeni`, která je starší než živá aplikace.
- Párování s bankou (krok 5) se stává nejdůležitějším krokem celého modulu (Fáze 0 výše), ne posledním.
- Zbytek (zákazy, zkoušky, noční pravidla) platí.

## 7. Rozhodnutí majitele (18. 11. 2026)

1. **Banka:** aplikace zůstává neutrální (určená i pro prodej dalším podnikům), banky jsou vyměnitelné konektory. Navíc se přidá konektor pro Komerční banku.
2. **Sazby práce:** berou se z lidí vedených v aplikaci (modul Lidé), kde je hodinová sazba.
3. **Sklad a inventury:** nepotřebujeme. Data se stahují z POS.
4. **Schvalování nákupů a plateb:** vždy majitel podniku, nebo zaměstnanec s příslušným právem, které přidělí majitel.

**Zbývá dořešit (do té doby nejopatrnější varianta):**
- Kategorie nákladů podle účetní osnovy od účetního (do té doby základní sada výše).
- Koeficient odvodů zaměstnavatele pro náklady práce (od účetního).
- Které účty u Komerční banky patří kterým pobočkám.
- Co přesně vydá Dotykačka (receptury, prodané položky, spotřeba), ověřit v kódu při auditu.

## 8. Zdroje

- Restaurant365: prime cost a spojení food cost, práce a tržeb v reálném čase, https://www.restaurant365.com/blog/how-to-find-prime-cost-prime-cost-equation-explained/
- Restaurant365: teoretický vs. skutečný foodcost, https://www.restaurant365.com/blog/accounting-software-with-inventory-management-features-comparison/
- Craftable: back-office software pro finance, AP automatizace a prime cost po pobočkách (2026), https://craftable.com/blog/best-restaurant-management-software-for-finance-teams-2026
- MarginEdge: invoice automation a srovnání poboček, https://www.marginedge.com/blog/6-best-tech-solutions-for-multi-location-restaurants
- Benchmarky (food / labor / prime cost): https://www.completecontroller.com/cost-percentage-in-restaurants/ a https://www.completecontroller.com/key-benchmarks-in-the-restaurant-industry/
- E-fakturace: Slovensko od 1. 1. 2027 přes Peppol, v Česku zatím povinná není (Pohoda, Fakturoid), https://portal.pohoda.cz/dane-ucetnictvi-mzdy/ucetnictvi/slovensko-zavadi-peppol-mely-by-zbystrit-i-ceske-firmy/ a https://www.fakturoid.cz/almanach/zacatky-podnikani/povinna-digitalizace-faktur
