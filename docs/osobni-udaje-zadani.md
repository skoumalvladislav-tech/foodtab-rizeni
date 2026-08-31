# Zadání: osobní údaje zaměstnanců a informování o zpracování

Zadal Šéfík 1. 9. 2026.

> **Nejsem právník.** Tenhle dokument popisuje, jak to postavit v aplikaci.
> Text informace pro zaměstnance a zpracovatelskou smlouvu musí napsat
> nebo aspoň zkontrolovat právník — zvlášť až se Foodtab bude prodávat.

---

## 1. Souhlas není to, co potřebujeme

Šéfík chtěl „souhlas se zpracováním osobních údajů" potvrzovaný při
prvním přihlášení. **Tak se to dělat nemá** a je to horší než nic.

Souhlas musí být **svobodný**. Mezi zaměstnavatelem a zaměstnancem
svobodný není — ten člověk je závislý a odmítnout prakticky nemůže.

A souhlas jde **kdykoli odvolat**. Kdyby na něm stála docházka a mzda,
odvoláním by buď muselo přestat počítání mzdy, nebo by se ukázalo, že
ten souhlas nikdy nic neznamenal.

**Správné právní tituly pro to, co Foodtab dělá:**

| údaj | proč ho smíme mít |
|---|---|
| jméno, adresa, datum nástupu | plnění pracovní smlouvy |
| mzdová sazba, odpracované hodiny | smlouva + zákonná povinnost |
| docházka | smlouva + zákonná povinnost |
| e-mail, telefon | plnění smlouvy — přihlášení a pozvánka do aplikace |

Na tohle se souhlas **nežádá** a nesmí se vynucovat.

---

## 2. Co se při prvním přihlášení opravdu má stát

**Informovat, ne žádat o souhlas.**

Při prvním přihlášení se zobrazí **Informace o zpracování osobních
údajů** — kdo je správce, jaké údaje, proč, jak dlouho, komu se předávají
(účetní, pokladna), a jaká má ten člověk práva.

Uživatel klikne **„Beru na vědomí"**. Ne „Souhlasím".

Uloží se: kdo, kdy, **kterou verzi** textu. Verze je podstatná — až se
text změní, musí se zobrazit znovu.

**Tohle přihlášení neblokuje natrvalo.** Kdo neklikne, informaci uvidí
znovu příště. Nikomu se tím nebere přístup k docházce, protože ta
na jeho vůli nestojí.

---

## 3. Souhlas ano — ale jen na to, co je opravdu dobrovolné

Zvlášť, každý svým zaškrtávátkem, každý odvolatelný jedním kliknutím
v Nastavení:

- fotka nebo iniciály v aplikaci
- narozeniny na nástěnce
- soukromý telefon k něčemu jinému než ke směnám

**Odvolání musí něco udělat.** Když někdo odvolá souhlas s fotkou, fotka
zmizí. Souhlas, po jehož odvolání se nic nestane, je horší než žádný.

Neudělený souhlas nesmí nikoho o nic připravit — kdo nechce fotku, dělá
dál stejnou práci.

---

## 4. Jen to, co opravdu potřebujeme

Šéfík chce adresu, telefon a e-mail. U telefonu a e-mailu je to zřejmé —
přihlášení a pozvánka.

**U adresy je otázka, jestli ji aplikace potřebovat má.** Do pracovní
smlouvy patří, ale tu Foodtab nevystavuje. Když mzdy zpracovává účetní
ve svém programu, je adresa v aplikaci údaj navíc, který se musí chránit,
zálohovat a mazat — a k ničemu neslouží.

**Rozhodnutí pro Šéfíka:** má aplikace tisknout nebo předávat něco, kde
je adresa potřeba? Když ne, nesbírat ji. Když ano, sbírat a napsat proč.

Povinné jsou tedy: **jméno**. Ostatní podle toho, k čemu slouží.

---

## 5. Jak dlouho to držet

Tady je rozpor s pravidlem 9 (`deleted_at` místo výmazu). Označený
zaměstnanec zůstává navždy, aby držela návaznost docházky — jenže
osobní údaje se nemají držet déle, než je potřeba.

**Řešení: rozlišit, co se drží a co se maže.**

- **Drží se, dokud běží lhůty** (mzdové listy a evidenční listy mají
  zákonné lhůty v desítkách let): jméno, odpracované hodiny, sazba.
- **Maže se dřív**: telefon, e-mail, adresa, fotka — jakmile člověk
  odejde a lhůty na ně nedopadají.

Prakticky: po označení za odešlého se kontaktní údaje po nastavené době
vyprázdní, ostatní zůstane. Lhůty ať jsou **řádek v nastavení firmy**,
ne konstanta v kódu (pravidlo 1) — každý zákazník má jiného právníka.

---

## 6. Práva zaměstnance

Aplikace musí umět odpovědět, aniž by to znamenalo ruční hrabání
v databázi:

- **Co o mně máte** — obrazovka „Moje údaje" s tím, co je v aplikaci.
- **Vydat to** — export vlastních údajů souborem.
- **Opravit** — kontaktní údaje si mění sám.
- **Smazat** — jen to, co se smazat smí (viz oddíl 5). Zbytek se
  vysvětlí, ne odmítne mlčky.

---

## 7. Kdo je za to zodpovědný

- **Restaurace je správce.** Ona rozhoduje, co a proč se zpracovává.
- **Foodtab bude zpracovatel**, jakmile ho někdo koupí.

Znamená to **zpracovatelskou smlouvu s každým zákazníkem** — bez ní
nesmí zákazník aplikaci legálně použít. Připravit dřív, než přijde
první platící zákazník, ne až po něm.

U vlastních dvou provozoven je Šéfík obojí, takže to zatím netlačí.

---

## 8. Bezpečnost

Adresa, telefon a e-mail jsou osobní údaje jako mzda:

- `tenant_id`, RLS a politika jako u všeho ostatního.
- **Do jazykového modelu nejdou** — pravidlo 8 se rozšiřuje: ne jen mzdy
  a docházka, ale i kontaktní údaje.
- Změny do auditu, spoušť na `employees` už existuje.
- Kdo vidí kontakt na kolegu, ať je otázka oprávnění, ne samozřejmost.
  Číšník nepotřebuje adresu kuchaře.

---

## 9. Co udělat

1. Sloupce `phone`, `email`, `address` na `employees` (RLS, audit).
2. Tabulka verzí informačního textu + záznam „vzal na vědomí"
   (kdo, kdy, verze).
3. Zobrazení při prvním přihlášení a po změně verze.
4. Volitelné souhlasy zvlášť, odvolatelné, s viditelným účinkem.
5. Obrazovka „Moje údaje" — vidět, opravit, vyexportovat.
6. Lhůty uchování jako nastavení firmy + úloha, která kontakty po
   odchodu vyprázdní.
7. Text informace **od právníka**. Do té doby zástupný text
   viditelně označený jako nehotový.

Bod 7 nesmí zapadnout. Aplikace, která zobrazí vymyšlený právní text
jako závazný, je horší než ta, která nezobrazí nic.
