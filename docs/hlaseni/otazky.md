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
