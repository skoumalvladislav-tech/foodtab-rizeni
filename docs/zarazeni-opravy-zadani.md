# Zařazení — opravy zadání po průzkumu

Sepsáno 8. 9. 2026 po přečtení `docs/zarazeni-misto-roli-nalezy.md`.

**Tenhle soubor má přednost před `docs/zarazeni-misto-roli.md`
všude, kde se liší.** Nálezy platí celé; zadání platí kromě toho, co je
tady zrušené.

Šéfík dal na krok E **deset hodin** a rozeslání pozvánek posunul za ně.

---

## 1. Čtyři věci, které jsem v zadání napsal špatně

Nejsou to nuance. Každá z nich by se projevila až v provozu.

### 1.1 ZRUŠENO: jeden majitel na firmu

Zadání, oddíl 5.2, chtělo unikátní index nad `employees`. **Nedělej ho.**

Majitelů může být víc — je to tak popsané v
`docs/vlastniku-muze-byt-vic.md`, staví na tom
`20260902010000_posledni_majitel.sql` a **ostrá firma je má dva.** Index
by spadl uprostřed migrace a nechal databázi napůl přepnutou.

Zůstává jen pravidlo, že **poslední majitel se nedá zbavit
majitelství** — přesune se z rolí na `je_majitel`.

### 1.2 ZRUŠENO: „mění se dvě funkce"

Platí to pro politiky RLS a je to dobrá zpráva. **Neplatí to pro
zbytek.** Devět dalších míst si na starý model sahá bez `has_access` a
po přepnutí by tiše přestalo platit — seznam je v nálezech, oddíl 3.

Zvlášť `app.smi_pridelit`: s prázdným `role_id` **propustí všechno**
a pět politik přestane chránit, aniž cokoli spadne. Přepiš ho ve stejném
commitu jako jádro, ne později.

### 1.3 ZRUŠENO: „po bodu 2 se dá skončit"

Nedá. Kdyby se udělala jen databáze, `if (!ctx.role)` pošle **každého
včetně majitele** natrvalo na „nikdo vám nepřidělil oprávnění".

**Hranice, na které se dá skončit, v kroku E neexistuje.** Buď je hotový
celý řetěz — databáze, devět kopií, `my_context`, `visible_branch_ids`,
`cekaji_na_opravneni`, `create_tenant`, granty, audit, obrazovka lidí —
nebo v repozitáři neleží nic. Tvoje dnešní rozhodnutí necommitnout
polovinu bylo správné a platí dál.

### 1.4 OPRAVENO: kontrola „před a po" nepatří do migrace

Chtěl jsem ji v migraci. Tam ji napsat nejde — `app.has_access` se ptá
`auth.uid()` a v migraci běží servisní role.

**Patří do scénáře**, kde harness `auth.uid()` přepisuje
(`00_harness.sql`), a vzor se spouští migraci přes `\ir` je hotový
v `krok29_scenar.sql`. Tvůj nález, tvoje řešení — použij ho.

---

## 2. Převod dat: nepiš ho, dokud nepřijdou čísla

Pravidlo „průnik práv lidí, kteří mají totéž zařazení" (zadání 5.4)
**nejspíš neplatí pro skutečná data.** Šéfík pouští tři měřicí dotazy do
ostré databáze; do té doby se převod psát nemá.

Co už je vidět na zkušebních datech: **lidé s rolí zařazení nemají a
lidé se zařazením nemají účet.** Kdyby to tak bylo i v ostré firmě, byl
by průnik prázdný, všechno by viselo na výjimkách a živé pravidlo
„změna zařazení platí hned všem" by bylo mrtvé v den nasazení.

**Pravděpodobný tvar převodu** — potvrdí nebo vyvrátí ho čísla:

1. Pro **každou roli, která má aspoň jednoho aktivního člena**, vznikne
   zařazení téhož jména a s týmiž právy. Ne průnik — **kopie**.
2. Člověk **bez zařazení** dostane to, které odpovídá jeho roli.
3. Člověk, který **už zařazení má** (typicky brigádník bez účtu),
   si ho nechá — na plánování směn se nesahá.
4. Kde se to sráží (má zařazení **i** účet s rolí), **nerozhoduj sám**:
   vypiš ty lidi do hlášení jmenovitě a nech to na Šéfíkovi.
5. Majitel: `je_majitel = true`, práva se mu nepřevádějí — prochází
   zkratkou, jako dnes.

Závazné pravidlo z 5.4 **platí beze změny**: po převodu má každý přesně
ta práva, co dnes. Nikdo víc, nikdo míň.

---

## 3. Pořadí

Platí to tvoje z nálezů, oddíl 8, a je lepší než moje:

1. **Čísla z ostré databáze** *(dělá Šéfík, čekej na ně)*
2. **Kontrola „před a po" do scénáře** — dřív než převod
3. **Migrace:** tabulky a granty → audit → převod → jádro → devět
   opsaných kopií
4. **Aplikace:** `my_context`, přesměrování, obrazovka lidí, obě hlášky
   o pozvánce (`:663` **i** `:963` přes `akce.ts:499`)
5. **Zákaz SMS u citlivého práva** — přepsat, ne odložit
6. **Zkoušky** — těch ~200 dotčených, a hlavně ty tři, které by
   zůstaly zelené a přestaly měřit

**Odloženo:** `positions.usek_id` místo `department`, sloučení obrazovek,
ruční zaškrtávátka výjimek ve formuláři zaměstnance. *(Tabulka
`employee_permissions` ale vzniknout musí — bez ní nemá převod kam
uložit rozdíly.)*

---

## 4. Nasazení

**Nenasazuj.** Účet Supabase je pořád rozházený a nasazuje Šéfík.

Až bude migrace hotová, pošli mi číslo kontrol a z čeho je — proženu to
proti opravdovému PostgreSQL. **V PGlite běžíš jako superuživatel,
takže RLS ani sloupcové granty neuvidíš** — a zrovna granty jsou
u tohohle kroku ta tichá past (`je_majitel`, a k tomu
`employees.zalohy_pozastaveny`, který grant nikdy nedostal).

---

## 5. Když dojde čas

Deset hodin je odhad, ne jistota. Když se blíží konec a řetěz není celý:

**Necommituj to.** Odevzdej hlášení ve stejné podobě jako dnes — co je
napsané, kde to leží, co zbývá. Dnešní rozhodnutí bylo správné právě
proto, že poloviční přepnutí oprávnění se nepozná jako chyba v kódu,
ale jako číšník, který nevidí svoji směnu.
