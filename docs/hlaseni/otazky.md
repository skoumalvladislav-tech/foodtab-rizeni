# Otevřené otázky pro Šéfíka

Zakládá se podle pravidla z `docs/nocni-prace-2026-09-07.md`: když
v noci narazím na rozhodnutí o provozu, **neptám se a nečekám** —
zapíšu otázku sem, vyberu nejopatrnější variantu, do kódu dám
`// ROZHODNOUT:` a jdu dál.

U každé otázky je proto napsané i to, **co zatím platí**, aby se dalo
poznat, jestli se něco musí měnit, nebo jen potvrdit.

---

## 1. Kam přistane vedoucí směny?

**Vzniklo:** 7. 9. 2026, obrazovka „Dnes".
**Kde je to v kódu:** `lib/authz.ts`, funkce `jeVedeni`.

Zaměstnanec po přihlášení nově přistane na „Dnes", vedení na
rozcestníku jako dosud. Rozhoduje o tom právo, ne název role
(pravidlo 2) — a otázka je, kudy tu čáru vést.

| kdo | má `people.manage`? | kam dnes přistane |
|---|---|---|
| Majitel | ano (obchází katalog) | rozcestník |
| Provozní | ano | rozcestník |
| **Vedoucí směny** | **ne** (má `shifts.manage`) | **Dnes** |
| Kuchyně, Servis, Bar | ne | Dnes |

**Co jsem vybral:** vedoucí směny přistane na **Dnes**. Vedoucí směny
taky chodí na směny a „kdy mám příště jít a jsem zapíchnutý" je pro něj
stejná otázka jako pro číšníka. Na rozcestník se dostane přes „Více".

**Když to nesedí:** do `jeVedeni` přibude `'shifts.manage'` — jedno
slovo.

---

## 2. Člověk bez `shifts.read` nevidí ani vlastní směny

**Vzniklo:** 7. 9. 2026, při psaní „Dnes".
**Kde:** politika `shifts_read` v `20260823130000_provoz.sql`.

Politika na `shifts` pouští jen `can_read_scoped(tenant, 'shifts.read',
branch)`. **Nemá výjimku na vlastní řádek**, na rozdíl od docházky,
kde `attendance_read` výslovně pouští `employee_id in (moje)`.

Šablony rolí `shifts.read` mají všechny (Kuchyně, Servis, Bar,
Vedoucí směny), takže dnes to nikomu nevadí. Ale firma si role upravuje
sama — komu ho odebere, přestane vidět i **svoji vlastní směnu**
a „Dnes" mu ukáže „Dnes nemáte směnu", i když ji má.

**Co jsem vybral:** nesahal jsem na to. Je to změna politiky na
tabulce, kterou čte půlka aplikace, a v noci se do toho pouštět nechci.

**Když to má být jinak:** přidat do `shifts_read` druhou větev
`or employee_id in (select id from employees where user_id = auth.uid())`
— přesně jako u docházky.

---

## 3. Zaskakující kolega z cizí pobočky se v „Na směně s vámi" neukáže

**Vzniklo:** 7. 9. 2026, obrazovka „Dnes".

Jména kolegů se čtou z `employees`, a `employees_select` pouští jen
lidi, na jejichž **domovskou** pobočku má člověk dosah. Kdo přišel
vypomoct z druhé provozovny, má `employees.branch_id` jinde — a v
seznamu tedy chybí, beze slova.

**Co jsem vybral:** nechal jsem to být. Chybějící jméno je méně zlé než
rozšiřovat, kdo smí číst cizí zaměstnanecké záznamy.

**Když to má být jinak:** je to rozhodnutí o tom, kdo smí vidět koho —
ne o kódu.

---

## 4. „Vzkazy", nebo „Zprávy"?

**Vzniklo:** 6. 9. 2026, `docs/nocni-prace-2026-09-07-doplneni.md`,
oddíl 3 — otázku položil Code sám.

Po sloučení se položka v nabídce bude jmenovat „Vzkazy" a jedna ze
záložek uvnitř taky. Až to uvidíš na obrazovce, řekni, jestli ti to
nevadí — případně se vrchní položka přejmenuje na „Zprávy". Je to jedno
slovo, kód se kvůli tomu měnit nemusí.

**Stav:** sloučení zatím není hotové (viz hlášení k 7. 9.).

---

## 5. Je člověk na přestávce „v práci"?

**Vzniklo:** 8. 9. 2026, při opravě docházky (`docs/velka-prace-2026-09-08.md`,
A1). Otázku položil Code sám a **jde o provoz, ne o kód.**

Obrazovka Docházka se dřív ptala na poslední událost, takže mezi
`break_start` a `break_end` tvrdila, že v práci **nejsi** — a nabízela
Příchod. Nově se ptá přes `app.otevreny_prichod` (jediný zdroj pravdy),
který přestávky vůbec neřeší: dokud k příchodu nepřišel odchod, jsi
v práci. Na přestávce se tedy nově nabízí **Odchod**.

**Co jsem vybral:** to nové chování. Starý stav nabízel tlačítko, které
by `app.pichnout` stejně odmítl — otevřený příchod pořád existuje
a druhý příchod se nepustí. Nabízet lidem tlačítko, po kterém přijde
chybová hláška, je horší.

Přestávky se dnes navíc dají zadat **jen ručním panelem** vedoucího,
takže se to číšníka na telefonu netýká.

**Když to má být jinak:** řekni, jestli má člověk na přestávce vidět
Příchod, Odchod, nebo nic — pak k tomu přibude vlastní tlačítko
„Konec přestávky". V kódu je to označené `// ROZHODNOUT:`
v `app/[rozsah]/dochazka/page.tsx`.

---

## 6. Kolik má mít firma majitelů? (BLOKUJE krok E)

**Vzniklo:** 8. 9. 2026 při průzkumu před přechodem na zařazení.
Není to otázka na kód — **je to rozpor uvnitř zadání a repozitáře.**

`docs/zarazeni-misto-roli.md`, oddíl 5.2 chce unikátní index, který
dovolí **jednoho** majitele na firmu:

```sql
create unique index employees_jediny_majitel
  on public.employees (tenant_id) where je_majitel and deleted_at is null;
```

Proti tomu stojí tři věci:

- `docs/vlastniku-muze-byt-vic.md`, ř. 7–11 říká, že jich může být víc,
- `20260902010000_posledni_majitel.sql`, ř. 6–7 na tom staví: „Majitelů
  může být víc: firma má jednu roli Majitel, ale členství k ní může mít
  libovolně mnoho lidí,"
- **a tvoje firma má dva** (`docs/co-jeste-chybi-2026-09-05.md`,
  ř. 12–18).

Ten index by tedy na ostrých datech **spadl uprostřed migrace** a firma
by zůstala s novými funkcemi a starými daty.

**Co jsem vybral:** index vynechat a nechat víc majitelů. Odebrat
majitelství se dá kdykoli; migrace, která spadne v půlce přepínání
oprávnění, se opravuje o řád hůř.

**Když to má být jinak** — tedy jeden majitel na firmu —, musí se
nejdřív rozhodnout, **který ze dvou dnešních majitelů jím zůstane**,
a teprve pak se index smí přidat. To je rozhodnutí o firmě, ne o kódu.

Podrobně v `docs/zarazeni-misto-roli-nalezy.md`, oddíl 1.

---

## 7. Když se směna smaže, má zmizet hned, nebo až po vydání rozpisu?

**Vzniklo:** 9. 9. 2026, Šéfík hlásí z provozu: *„v kalendáři směn
nejdou mazat směny, jenom přidávat."*

**Není to rozbité — nikdy to nevzniklo.** Ověřeno: v
`app/[rozsah]/smeny/smena.ts` je jediná akce `ulozitSmenu`, formulář
(`formular-smeny.tsx`) má jen tlačítka Zrušit a Uložit, a tabulka
`public.shifts` nemá sloupec `deleted_at`. Přidávat a upravovat jde,
mazat ne.

Uvnitř té opravy je ale rozhodnutí o provozu:

**a) Smazat natvrdo.** Řádek zmizí. Je to na pár řádků kódu a nic
jiného se měnit nemusí.
**Ale:** směna, kterou už lidi vidí ve vydaném rozpisu, jim zmizí
**okamžitě**, ještě než rozpis znovu vydáš. Tím se obchází celý smysl
vydávání — dnes platí, že rozdělané změny lidi nevidí, dokud je
nevydáš.

**b) Označit jako zrušenou** (`deleted_at`, jako u lidí — pravidlo 9
z `CLAUDE.md`). Vydaná podoba zůstane, dokud rozpis nevydáš znovu,
a při vydání se ta směna ukáže jako **zrušená**, ne že prostě není.
Historie se neztratí.
**Ale:** je to větší práce — `shifts` se čte na 4 místech v aplikaci
a ve ~14 migracích, a **každé z nich musí zrušené směny odfiltrovat.**
Zapomenutá cesta znamená, že se smazaná směna někde objeví zpátky.

**Co bych vybral:** **b)**. Za a) mluví jen rychlost, a cena je, že
lidem zmizí z rozpisu směna, kterou mají naplánovanou — bez toho, aby
to kdokoli vydal. To je přesně ta třída chyby, kterou vydávání rozpisu
existuje řešit.

**Když to má být jinak** — třeba že u nevydané směny stačí smazat
natvrdo a jen u vydané se to označuje — řekni, je to jedna podmínka
navíc.

---

## 8. Úkoly zadané „roli" po přepnutí na zařazení nikam nedojdou

**Vzniklo:** 9. 9. 2026 při přepnutí oprávnění z rolí na zařazení.

`public.tasks` má vedle `employee_id`, `position_id` a `usek_id` ještě
`role_id` — adresáta „všem, kdo mají tuhle roli". Doručení se počítá
v `public.dokoncit_ukol` porovnáním s `memberships.role_id`.

**Dnes se to nikde neprojeví**, a to ze dvou důvodů: úkol s rolí
neumí zadat žádná obrazovka (v aplikaci není jediné místo, které by
`tasks.role_id` vyplňovalo) a lidem, kteří ve firmě už jsou, role
u členství zůstala.

**Ale novým lidem ji aplikace přestala vyplňovat.** Kdyby někdo takový
úkol zadal ručně v databázi, komu dojde, by záviselo na tom, kdy ten
člověk do firmy přišel. To je horší než kdyby nedošel nikomu.

**Co jsem vybral:** nesahat na to. `tasks.role_id` a
`task_templates.role_id` zůstávají, `dokoncit_ukol` se nemění.
Přidat vedle nich `position_id` je nová funkce, ne přepnutí — a udělat
ji potichu při zásahu do jádra oprávnění je přesně ten druh práce,
u které se pak nedá poznat, co byl záměr.

**Rozhodni, co s tím:**

**a) Zahodit.** „Úkol pro roli" nikdy nikdo nezadal, obrazovka na to
není. `tasks.role_id` se přestane používat (nemazat — pravidlo
o nasazených migracích) a v `dokoncit_ukol` ta větev zmizí.

**b) Převést na zařazení.** `tasks.position_id` už existuje a používá
se; stačilo by, aby `dokoncit_ukol` počítal doručení i podle něj.
Je to pár řádků a „úkol pro všechny číšníky" dává v provozu smysl.

**Co bych vybral:** **b)**, ale až samostatně — je to funkce navíc, ne
oprava.

---

## 9. „Bylo vám přiděleno oprávnění" se pořád posílá při vzniku členství

**Vzniklo:** 9. 9. 2026, tamtéž.

Spoušť `app.upozorni_na_clenstvi` visí na tabulce `memberships`. Dokud
oprávnění nesla role u členství, byl to ten správný okamžik: zpráva
odešla přesně tehdy, když člověk oprávnění dostal.

Po přepnutí nese oprávnění **zařazení u zaměstnance**. Přidělení tedy
může nastat jindy než vznik členství — typicky později, když Šéfík
člověku zařazení doplní.

**Co jsem vybral (nejopatrnější):** spoušť zůstává na členství a nově
se ptá, jestli ten člověk vůbec nějaké právo má; když nemá, zprávu
neposílá. Kdo dostane zařazení až po přijetí pozvánky, se to tímhle
kanálem nedozví — **ale okno „čeká na oprávnění" u vedoucího funguje
dál** a nikomu se nic neposílá zbytečně.

**Alternativa:** spoušť i na `employees` (změna `position_id`
nebo `je_majitel`) a na `employee_permissions`. Je to nové chování,
ne přepnutí, a hlavně by to znamenalo posílat zprávu i při opravě
překlepu v zařazení.

V kódu je to označené `-- ROZHODNOUT:` v
`supabase/migrations/20260909100000_zarazeni_jadro.sql`.

---

## 10. Strop u zařazení se ptá na firemní úroveň — i vedoucího pobočky

**Vzniklo:** 9. 9. 2026, tamtéž.

Zařazení platí za celou firmu (`positions` nemá `branch_id`), takže
spoušť `trg_strop_zarazeni` se ptá `app.smi_pridelit(..., 'tenant')`:
kdo přiděluje zařazení, musí mít všechna jeho práva **na firemní
úrovni**.

**Důsledek:** vedoucí pobočky se `people.manage` jen na své pobočce
nepřeřadí pod zařazení nikoho, ani na vlastní pobočce.

**Je to opatrnější strana, ne díra.** Člověk se zařazením a rozsahem
jedné pobočky má práva jen tam, takže by teoreticky stačilo ptát se na
tu pobočku. Jenže rozsah se dá později rozšířit — a v tu chvíli by ta
práva platila všude, aniž by o tom kdokoli s firemním rozsahem
rozhodl.

**Dnes to nikoho neblokuje:** správu lidí po pobočkách firma zatím
nikomu nedala (`krok7_scenar` na to má vlastní kontrolu a je u ní
napsané, že je to zavřenější, než pravidlo žádá).

**Až se to stane**, řekni — je to jeden parametr.
