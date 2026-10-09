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

**Stav 27. 9. 2026: překonáno.** 23. 9. přišel pokyn „modul přejmenuj
na vzkazy a úkoly": položka v nabídce je „Vzkazy a úkoly", na spodní
liště telefonu „Vzkazy", záložka uvnitř „Komunikace" (zadání
Checklisty 2.0: „nahoře zachovej Komunikace | Úkoly | Checklisty |
Nástěnka"). Viz `docs/komunikace-stav-a-plan-2026-09-27.md`, oddíl 9.

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

---

## 11. Checklist „každou směnu" — podle čeho poznat, čí je směna?

**Vzniklo:** 23. 9. 2026, Checklisty 2.0 (větev `checklisty-2-0-mockup`).

Zadání chce checklist, který se založí a přidělí **na každou směnu**
(např. „Předávka baru" při každém střídání). V editoru šablony tahle volba
je, ale běhy se pro ni **samy nezakládají ani nepřidělují** — chová se
jako „ručně".

**Proč:** směna dnes nemá vazbu na úsek (kuchyň, bar…). Obě cesty, jak
ji získat, mají háček:

- nový sloupec `shifts.usek_id` — schéma navíc, které se musí zpětně
  dovyplnit u všech starých směn,
- úsek člověka (`employees.usek_id`) — zaskakující kolega nebo brigádník
  bez úseku by dostal cizí checklist, nebo žádný, a nikdo by to nepoznal.

> **ROZHODNUTÍ ŠÉFÍKA (23. 9.): „Zatím bez automatiky."** Schéma je
> připravené, zakládání a přidělování čeká na tuhle odpověď.

**Až se rozhodne**, je to jedna větev v `vytvorit_naplanovane_checklisty()`
(dnes ji výslovně přeskakuje, `krok53_scenar` to hlídá kontrolou
„ruční a každá směna: žádný běh").

---

## 12. Smí vedoucí potvrdit checklist, který sám dokončil?

**Vzniklo:** 23. 9. 2026, tamtéž.

U šablony s „vyžaduje potvrzení vedoucím" dnes **nejde potvrdit vlastní
běh** — kdo checklist uzavřel, ten ho nepotvrdí, i když má `tasks.manage`.

**Proč jsem vybral přísnější variantu:** zadání (bod 31) popisuje dvojí
kontrolu jako dvě různé osoby. Kdyby šlo potvrdit sám sobě, „kontrola"
by v malé směně byla jen druhé kliknutí téhož člověka.

**Co to znamená v provozu:** když na směně není druhý člověk
s `tasks.manage`, potvrzení počká na dalšího vedoucího. Checklist je
uzavřený (záznam platí), jen visí jako „čeká na potvrzení".

**Když to má být jinak**, je to jedna podmínka v `potvrdit_checklist`
(`supabase/migrations/20260923160000_checklisty_rpc.sql`) a jedna kontrola
v `krok51_scenar` („Petra svůj běh sama nepotvrdí").

---

## 13. Plánované úlohy běží na GitHubu nespolehlivě — přesunout do databáze?

**Vzniklo:** 23. 9. 2026 večer, ověření po nasazení Checklistů 2.0.

GitHub Actions hodinový plán nedodržuje: `zapomenuty-odchod.yml`
(cron každou hodinu) má od 20. 9. 16 běhů místo zhruba 72, s mezerami
3–6 hodin. Stejně na tom budou nové úlohy `checklisty-naplanovat`
a `checklisty-terminy`:

- dnešní checklisty podle rozvrhu se můžou založit **o hodiny později**,
- upozornění „blíží se termín" hlídá okno hodinu dopředu — při
  několikahodinové mezeře **většinou propadne**; „po termínu" přijde
  s víc než hodinovým zpožděním,
- totéž už dnes platí pro „zapomenutý odchod".

**Co navrhuji:** rozšíření `pg_cron` přímo v Supabase — databáze si
funkce (`vytvorit_naplanovane_checklisty`, `ohlasit_checklisty_terminy`,
zapomenutý odchod) spouští sama, bez GitHubu, bez HTTP a bez tajemství.
Je to ale **změna nastavení ostré databáze** (zapnutí rozšíření a plán
úloh), proto ji nedělám bez rozhodnutí.

**Co jsem vybral do té doby:** nic neměním; úlohy běží přes GitHub jako
`zapomenuty-odchod`. Varování je v hlavičce `checklisty-naplanovat.yml`.

**Když se rozhodne pro pg_cron**, je to jedna migrace (`create extension
pg_cron` + `cron.schedule` pro tři funkce) a smazání tří workflowů.

---

## 14. Zakládání účtů v Supabase: zapnuté, nebo jen přes pozvánku serverem?

> **UZAVŘENO 24. 9. odpoledne — opravou, ne rozhodnutím.** Ukázalo se, že
> příčina nebyla v nastavení Supabase, ale v aplikaci (stránka pozvánky
> posílala nového člověka na přihlašovací stránku, která účty nezakládá).
> Oprava (PR #73) jde druhou cestou níž: účet zakládá server jen pro
> adresu z platné pozvánky. „Allow new users to sign up" má zůstat
> **vypnuté** — zámek „jen na pozvánku" drží ono, ne aplikace. Text níž je ranní a jeho předpoklad („od 5. 9. je podle logů
> vypnuté") neplatí — viz hlášení [24. 9.](stav-2026-09-24.md#skutečná-příčina-a-oprava).

**Vzniklo:** 24. 9. 2026 ráno — Juli Yaniv se nemohla přihlásit (hlášení
[24. 9.](stav-2026-09-24.md)).

Nový člověk dostane účet ve chvíli, kdy poprvé přijímá pozvánku
(`app/pozvanka/[token]/akce.ts`, `signInWithOtp` bez `shouldCreateUser:
false`). To funguje jen se zapnutým **„Allow new users to sign up"**
v Supabase. Od 5. 9. je podle logů vypnuté — nikdo nový se nedostal dovnitř.

**Dvě cesty:**

- **Zapnout** (rychlé, doporučeno teď): pár kliknutí, postup v hlášení
  24. 9. Do Foodtabu se dál dostane jen ten, kdo přijme pozvánku.
  Zbytkové riziko: technicky zdatný člověk si přes rozhraní Supabase může
  založit **prázdný** účet bez přístupu k čemukoli (a přihlašovací služba
  mu pošle e-mail — spotřebovává limit pošty).
- **Nechat vypnuté a zakládat účty serverem** (úprava aplikace, zhruba
  půl dne i s testy): při přijetí platné pozvánky založí účet server
  (klíč `service_role`, jen pro adresu z pozvánky) a pošle přihlašovací
  kód. Pak neexistuje žádná cesta, jak si účet založit bez pozvánky.

**Co jsem vybral do té doby:** nic neměním — nastavení je na Šéfíkovi.
Pro Juli stačí dnes zapnout (nebo náhradní cesta „Add user").

**Když se rozhodne pro druhou cestu**, napiš — upravím přijetí pozvánky,
přidám scénář a pak jde zakládání účtů zase vypnout.

---

## 15. Záloha člověku bez pobočky — jak ji potvrdí PINem na tabletu?

**Vzniklo:** 24. 9. 2026 večer, při opravě „u zaměstnanců, kteří na to
mají práva, mi nejdou vyplácet zálohy" (hlášení [24. 9.](stav-2026-09-24.md#zálohy--nešly-vyplácet)).

Po opravě jde zálohu vyplatit i lidem **bez domovské pobočky** (Andrea
Mikulová, Edita) a zaskakujícím — zaúčtuje se na pobočku, kde se
hotovost předává, a kiosek té pobočky ji ukáže k potvrzení. **Potvrdit
PINem ji ale tablet dovolí jen tomu, koho pozná**: domovským lidem
pobočky a lidem se směnou tam včera/dnes/zítra (`app.pin_lide_pobocky`).
Kdo nemá pobočku ani směnu v těchhle třech dnech, zálohu dostane, ale
na tabletu ji nepotvrdí — zůstane „nepotvrzená".

**Co jsem vybral do té doby:** nic neměním na kiosku. Záloha se vyplatí
a zapíše; nepotvrzená je vidět v Zálohách.

**Varianty, když to má být jinak:**
- tablet pozná i každého, kdo má na téhle pobočce **dnes nepotvrzenou
  zálohu** (úzké, jen pro potvrzení),
- nebo pozná i **všechny lidi bez pobočky** (ne majitele) — pozor, mění
  to i hlídání shody PINů na pobočce.

> **Doplněno 25. 9. 2026:** kdo má **účet**, potvrdí takovou zálohu nově
> **ve svém telefonu** (Docházka → karta „Máte nepotvrzenou zálohu") a za
> kohokoli ji potvrdí **majitel** (Docházka → Zálohy). Otevřené zůstává jen
> pro brigádníky bez účtu, kteří na tabletu nejsou poznaní — za ně dnes
> může potvrdit majitel.

---

## 16. Výplata záloh přímo z kiosku (tabletu) s PINem vydávajícího?

**Vzniklo:** 25. 9. 2026 ráno, zadání majitele: „a nebo na kiosku udělat
kartu zálohy a vše řešit přes kiosek".

**Co je hotové (25. 9.):** záloha se vyplácí v aplikaci (Docházka →
Zálohy, právo „Vyplácet zálohy"); příjemci s účtem přijde upozornění
a potvrdí ji **ve svém telefonu**, nebo dál **PINem na tabletu**; majitel
ji umí potvrdit **za kohokoli**; kdo zálohu vydal, dostane zprávu, že je
potvrzená — ať se potvrdilo kteroukoli cestou (i PINem na tabletu).

**Co jsem NEudělal:** kartu „Vyplatit zálohu" na tabletu, kde by
vydávající zadal svůj PIN, vybral člověka a částku.

**Proč ne bez rozhodnutí — rizika:**
- **PIN je 4–6 číslic.** Dnes PIN na tabletu dokládá jen „tohle jsem já,
  přišel jsem / beru si svou zálohu". Kdyby otevíral i **vydávání peněz**,
  stal by se z něj klíč k pokladně — a ten, kdo ho odkouká u baru (tablet
  stojí na pultě, PIN se ťuká před lidmi), může vydávat zálohy komukoli.
- **„Kdo vydal" by byl jen PIN.** V aplikaci je vydávající přihlášený účet
  (heslo / kód z e-mailu, jeho telefon). Na tabletu by to byla jen čtyři
  čísla — záznam „vyplatila Petra" by znamenal „někdo znal Petřin PIN".
- **Zneužití u baru.** Vydávající i příjemce stojí u téhož tabletu; kdo
  zná PIN kolegy s právem vydávat, vyplatí si zálohu sám sobě a sám si ji
  svým PINem potvrdí. Dnes tomu brání, že výplata chce přihlášený účet
  s právem a potvrzení PIN příjemce — dvě různé věci, dva různí lidé.
- Zámek po pěti špatných PINech dnes chrání potvrzení a píchání;
  u vydávání peněz by bylo potřeba přísnější (a hlídat i hádání PINů lidí
  s právem vydávat).

**Varianta, kdyby se to chtělo:** tablet jen **nabídne** zálohu k vydání
(člověk, částka) a vydávající ji **odklikne ve svém telefonu** (přihlášený
účet s právem) — tablet by byl jen „obrazovka u pultu", peníze by dál
pouštěl účet, ne PIN. Nebo PIN vydávajícího delší (6 číslic) + strop
částky z tabletu + zpráva majiteli o každé výplatě z tabletu.

**Co platí do rozhodnutí:** výplata jen v aplikaci, potvrzení v telefonu,
PINem na tabletu nebo majitelem. Nic na kiosku se nemění (kiosek dál
ukazuje dnešní nepotvrzené zálohy k potvrzení PINem).

---

## 17. Má výzva „potvrďte zálohu" zazvonit i mimo směnu?

**Vzniklo:** 25. 9. 2026, potvrzení záloh v telefonu.

Upozornění na vyplacenou zálohu (příjemci) a na potvrzení (vydávajícímu)
jde přes frontu doručení s **běžnou** prioritou. **V aplikaci (zvoneček)
je vidět hned vždycky.** Na telefon (push) je to složitější:

- **Hned** přijde jen tomu, kdo je právě v práci (otevřený příchod),
  a majiteli.
- Kdo v práci není, tomu push **čeká na příští příchod na směnu**.
  Čekání **starší než 48 hodin propadá** (stejné pravidlo jako u všech
  upozornění): záloha vydaná v pátek po odchodu, další směna v pondělí —
  výzva „potvrďte zálohu" na telefon **nepřijde vůbec**, zůstane jen ve
  zvonečku. Propadne i tehdy, když si ji člověk mezitím přečte
  v aplikaci.
- **Potvrzení PINem na tabletu** push hned neplánuje (tablet není
  přihlášený účet a aplikace se po něm nevolá). Vydávající dostane push
  až s **plánovačem**, který dnes běží zhruba jednou za 3–6 hodin
  (měřeno 23. 9.). Po potvrzení v telefonu nebo majitelem jde push hned.

**Co jsem vybral do té doby:** běžná priorita. „Naléhavé" by na obrazovce
svítilo jako NALÉHAVÉ a obcházelo by klid mimo směnu — záloha tak
naléhavá není. Když ji člověk potvrdí jinak (PINem, majitel), nebo když
ji někdo stornuje, čekající push se zruší, takže mu po příchodu nepípne
výzva k něčemu, co už neplatí.

**Když to má být jinak:**
- *zazvonit i mimo směnu:* jedna změna v databázi — pro druhy `zaloha.*`
  pouštět push hned bez ohledu na směnu (stejnou cestou, jakou to dnes
  dělá majitel), bez označení NALÉHAVÉ. Tím odpadne i propadání po 48 h.
- *po PINu na tabletu hned zpráva vydávajícímu:* tablet by potvrzení
  posílal přes serverovou akci aplikace, která po úspěchu naplánuje push
  (jako dnes telefon a majitel). Je to změna na kiosku, proto ne bez
  rozhodnutí — souvisí s otázkou 16.

---

## 18. Pozvánka pro člověka, který už účet má — přesun, odebrání z firmy

**Vzniklo:** 25. 9. 2026, hlášení majitele ve 14:38 (Kateřina Jirášková
nemá práva, okno „čeká na oprávnění" píše „Nový člověk" a odkaz otevře
holé Lidi). Čísla 16 a 17 si bere větev záloh (PR #83).
**Kde je to v kódu:** `supabase/migrations/20260925150000_pozvanka_druhy_ucet.sql`
(hlavička), `lib/ceka-na-opravneni.ts`, `app/[rozsah]/ceka-na-opravneni.tsx`.

**Co se stalo:** Kateřina má dva účty. Pozvánku na první adresu přijala
a její řádek v Lidech se s tím účtem propojil. Pak dostala čtyři
pozvánky na druhou adresu pro TENTÝŽ řádek. Přijetí řádek potichu
nepřepojilo (už účet měl), ale členství vzniklo — druhý účet byl ve
firmě bez jediného práva.

**Co jsem vybral (nejopatrnější varianta):**

1. Pozvánka pro člověka, který už má JINÝ účet, se nepřijme: „V téhle
   firmě už máte jiný účet (k***@email.cz). Přihlaste se jím, nebo
   požádejte majitele o novou pozvánku." Členství nevznikne.
2. Pozvánka na JINOU adresu pro člověka s účtem je **přesun**. Vystaví
   ji jen majitel, nikdy pro majitele. Po přijetí má řádek v Lidech nový
   účet, starý účet má ve firmě pozastavené členství (nesmaže se).
   Směny a docházka zůstávají, visí na člověku, ne na účtu. Kdyby se
   řádek mezitím přepojil jinam, pozvánka neplatí.
3. Vedoucí se správou lidí přesun nevystaví. Pozvánku na TUTÉŽ adresu,
   jakou účet má, vystavit smí (přesun to není).
4. Okno „čeká na oprávnění" a nová karta v Lidech ukazují jméno z Lidí
   (jinak e-mail), kontakt a důvod. Tlačítko vede na oprávnění toho
   člověka, u zařazení bez práv na to zařazení. U účtu bez řádku v Lidech
   nebo se smazaným řádkem se nabízí „Odebrat z firmy" (pozastaví
   členství, s potvrzením).
5. Smazání člověka v Lidech pozastaví jeho členství, obnovení ho vrátí.
6. Účet u existujícího člověka v Lidech se přímým zápisem nepřepojí ani
   neodpojí, ani majitelem — jen přijetím pozvánky. Do dneška to šlo
   každému se správou lidí (i odpojit majitele od jeho řádku).

Po nezávislé kontrole 28. 9. přibylo:

7. Účet, který ve firmě UŽ PATŘÍ k člověku v Lidech (živému i
   smazanému), žádnou další pozvánku pro někoho jiného nepřijme — ani
   pozvánku BEZ člověka. Ta dřív přepsala rozsah, pobočky i stav jeho
   členství bez stropu: vedoucí tak mohl kolegovi rozšířit rozsah nad
   svůj, vrátit pozastavené členství, nebo jedinému majiteli zúžit
   rozsah na jednu pobočku a zamknout ho. (Stará díra, od 1. 9.)
8. **Obnovení** smazaného člověka má strop: obnovit smí jen ten, kdo by
   mu jeho práva směl přidělit (jako přeřazení). **Majitele** v Lidech
   smaže jen majitel. **Tvrdé smazání** záznamu přes API je zavřené
   (aplikace ho nepoužívá). Bez toho by vedoucí smazáním a obnovením
   vrátil přístup člověku, kterému ho majitel pozastavil, a smazáním
   vyřadil druhého majitele z firmy.
9. **Zrušit pozvánku** jde v Lidech (karta „Čekající pozvánky",
   s potvrzením). Přesun zruší jen majitel. Dřív zrušení šlo jen přímo
   přes API a po zavření zápisu do pozvánek by nešlo vůbec.
10. Okno „čeká na oprávnění" u účtu bez řádku v Lidech nabízí „Pozvat
    z Lidí" (formulář pozvánky rovnou rozbalený). Člen firmy bez práv
    (druhý Kateřinin účet) vidí čekající pozvánku i na obrazovce „Účet
    je hotový" a přijme ji tam — nemusí hledat e-mail.

**Rozhodnout:**

- **a)** Má jít účet „bez řádku v Lidech" propojit s někým přímo z okna?
  Zatím NE: byla by to druhá cesta vedle pozvánky, bez kontroly adresy.
  Okno místo toho odkáže na formulář pozvánky v Lidech („Pozvat
  z Lidí" → vybrat člověka → adresa účtu). Když ten člověk už účet má,
  je to přesun a vystaví ho jen majitel.
- **b)** Smí přesun vystavit i někdo jiný než majitel (třeba Provozní)?
  Zatím jen majitel.
- **c)** Kdo spravuje lidi, smí dál členství jiných upravit i smazat
  přímo (i druhého majitele, pokud není poslední). „Odebrat z firmy" je
  pohodlí s kontrolami, ne jediná cesta. Zavřít to jako u pozvánek?
- **d)** E-mail „někdo přijal pozvánku" (`komu_ohlasit_prijeti`) pořád
  počítá „čeká" podle staré role, od 9. 9. tedy nespolehlivě. Opravit?
- **e)** Obnovení smazaného člověka vrací i členství, které se pozastavilo
  jinak (majitelem, „Odebrat z firmy"). Od 28. 9. má ale strop — obnovit
  smí jen ten, kdo by mu jeho práva směl přidělit, tedy i členství
  vrátit přímo. Obnovit v aplikaci dnes nejde vůbec; jde to přímým
  zápisem přes API (ten strop hlídá) nebo ručně v databázi. Chcete
  v Lidech tlačítko „Obnovit"?
- **f)** Smazaný člověk přestane být členem firmy — a kolegové pak nevidí
  jeho profil. Autor starého oznámení na nástěnce, kterého mezitím
  smazali, zůstane bez jména (Lidé, rozpis a docházka berou jména ze
  záznamu zaměstnance, tam se to neděje). Stojí to za úpravu?
- **g)** Sdělení mimo rám („Účet zatím nepatří k žádné firmě", „Firmu se
  nepodařilo načíst", „Sem nemáte přístup", „Není kam vás pustit",
  čekající pozvánka, „Účet je hotový") mají od teď odhlášení s dotazem
  (`app/cesta-ven.tsx`, kontrola #85). Je to vlastní malá kopie, protože
  sdílené `components/shell/Odhlaseni.tsx` je zatím jen ve větvi #85.
  Až bude na main, nahradit? (Navrhuji ano — jedno odhlášení, jedna
  věta.) Moje údaje jsou u sdělení jen tam, kde člověk firmu má; bez
  firmy ukážou Moje údaje zase jen „Účet zatím nepatří k žádné firmě".
- **h)** Pozvánka BEZ člověka z Lidí (přes API, ne z obrazovky) dál
  vyrobí člena bez záznamu — je to záměr z 1. 9. (krok7, krok12). Okno
  ho pak ukáže jako „Účet není propojený s nikým v Lidech". Zakázat?
  V ostré databázi 25. 9. žádná taková čekající pozvánka nebyla. Účet,
  který v Lidech JE, ji od 28. 9. nepřijme (bod 7).
- **i)** Účet, jehož člověk je v Lidech SMAZANÝ, nepřijme pozvánku pro
  nový záznam („smazat a založit znovu" — v ostré databázi lucka
  a Láďa). Hláška pošle majitele za správcem Foodtabu: obnova smazaného
  v aplikaci není a přepojit účet by znamenalo sáhnout na smazaný
  záznam (a s ním na historii toho účtu). Má jít smazanému záznamu
  účet odpojit a přepojit na nový — s auditem?
- **j)** **Přihlašovací adresu** účtu aplikace měnit neumí. Moje údaje
  mění kontakt v Lidech, ne účet. Majiteli ji dnes změní jen správce
  Foodtabu (hláška u pozvánky to tak i říká). Ostatním se adresa
  „mění" přesunem (bod 2). Chcete změnu adresy účtu v Mých údajích
  (s ověřením nové adresy kódem)?

**Kateřina v ostré databázi zůstává, jak je** (dva účty, oba aktivní).
Ručně se nic neopravuje. Po nasazení to majitel udělá v aplikaci:
buď pošle z Lidí novou pozvánku na gmail (přesun — přístup přejde na
gmail, účet `k***@email.cz` se od firmy odpojí; Kateřina ji přijme
z odkazu v e-mailu, nebo se přihlásí gmailem a přijme ji na obrazovce
„Účet je hotový"), nebo v okně „čeká na oprávnění" u gmailového účtu
zvolí „Odebrat z firmy" (Kateřina pak zůstane u `k***@email.cz`).
Adresu přesunu zkontrolujte dvakrát; překlep jde v Lidech zrušit
(„Čekající pozvánky").

---

Otázka 18 vznikla 25. 9. 2026 u pozvánky pro člověka s jiným účtem
(PR #87). Otázky 19–24 vznikly 27. 9. 2026 u rešerše Komunikace (viz
`docs/komunikace-stav-a-plan-2026-09-27.md`), otázky 25–33 téhož a
následujícího dne u docházky člověka po dnech (úprava a storno úseků;
migrace `20260927110000_dochazka_smeny_cloveka.sql`, obrazovka
`/[rozsah]/dochazka/clovek/[id]`), otázky 34–38 zase u Komunikace —
čísla 25–29 už mezitím zabrala docházka, proto pokračují od 34.

## 19. Upozornění na změnu směny: hned při uložení, nebo až při vydání rozpisu?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace
(`docs/komunikace-stav-a-plan-2026-09-27.md`, rozpor R1).

Dne 1. 9. bylo zadáno, že upozornění na směny odchází **až při vydání
rozpisu, ne při každé úpravě** (`docs/upozorneni-smeny-zadani.md`),
8. 9. zopakováno. Aplikace dnes posílá upozornění „změna směny" **už při
uložení** směny v rozpisu, který ještě není vydaný, a při vydání přijde
ještě souhrn „rozpis vydán". Člověk se tak může dozvědět o směně, kterou
vedoucí teprve zkouší, a pak dostat druhou zprávu.

**Co platí do rozhodnutí:** beze změny. Směny se bez důvodu nepřestavují
(zadání 20. 9.). Obrácení by navíc mohlo spolknout upozornění na změnu
už vydaného rozpisu — a to je horší než jedno upozornění navíc.

**Když to má být jinak:**
- *jen při vydání:* dokud rozpis není vydaný, změna nikomu nic nepošle;
  po vydání jde každá další změna hned (to, co bylo zadáno 1. 9.). Je to
  změna ve Směnách a v jedné databázové funkci, s vlastním scénářem.
- *nechat, jak je:* jen se opraví dokumentace, aby zadání z 1. 9.
  neslibovalo něco jiného.

---

## 20. Má „důležitá změna směny" pípnout na telefon i mimo směnu?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R2).

Nastavení → Firma → „Důležité změny směn" slibuje, že změna směny
začínající do několika hodin „se dostane k člověku i mimo pracovní
dobu". Ve skutečnosti se jen označí jako důležitá a **na telefon čeká
na příchod na směnu** jako každá běžná věc. Mimo směnu dnes vyruší jen
naléhavá zpráva, kritický úkol z checklistu a cokoli majiteli.

Zadání se tu rozcházejí: 17. 9. a Směny 2.0 (19. 9.) chtějí, aby
důležitá změna směny mohla přijít i mimo pracovní dobu; zadání 20. 9.
říká „neposílej agresivní push mimo pracovní dobu", výjimka jen naléhavé.

**Co platí do rozhodnutí:** nepípne. Text v Nastavení se opraví, aby
říkal pravdu (důležitá = zvýrazněná, do telefonu počká na směnu).

**Když to má být jinak:** jedna změna v databázi — upozornění na směnu
s prioritou „důležitá" pouštět do telefonu hned, stejnou cestou jako
naléhavé, ale bez označení NALÉHAVÉ. Firma si pak nastavením hodin sama
určí, co je „důležité".

---

## 21. Noční klid podle hodin? A má čekající upozornění propadat po 48 h?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R3, pravidlo 48 h).

Upozornění do telefonu dnes řídí jen **skutečná směna** (otevřený
příchod v docházce): v práci chodí hned, mimo ni čeká na příchod.
Zadání 1. 9. a 16.–17. 9. chtěla navíc **noční klid podle hodin**
(např. 22:00–7:00) jako nastavení firmy — to nikdy nevzniklo. Směna
nepokrývá noční směnu ani brigádníka, který nepíchá.

Druhá věc: čekající upozornění **propadá po 48 hodinách** (zůstane jen
ve zvonečku). To je moje pravidlo z 21. 9., schválené nikdy nebylo.
Kdo má volno přes víkend, v pondělí na telefon nedostane nic z pátku.

**Co platí do rozhodnutí:** jen vazba na směnu; 48 h platí.

**Když to má být jinak:**
- *noční klid:* nastavení firmy „od–do"; v tu dobu nepípne nic kromě
  naléhavého. Doplní vazbu na směnu, nenahradí ji.
- *48 h:* jiná lhůta (např. 7 dní), nebo nepropadat vůbec a při příchodu
  poslat jeden souhrn.

---

## 22. Kdo smí komu psát?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R8).

Zadání 16. 9. chtělo samostatná práva na druhy zpráv (osobní, pobočce,
celé firmě, mezi pobočkami, vedení, naléhavá); 17. 9. „zaměstnanec ↔
zaměstnanec, pokud to firemní pravidla dovolují" a „pobočka → pobočka
jen oprávnění". Dnes smí **každý s účtem napsat komukoli ve firmě**.
Zpřísnění se 21. 9. zkoušelo a vrátilo, protože bez vašeho rozhodnutí
by se někomu tiše vzala možnost, kterou dnes má.

**Co platí do rozhodnutí:** každý komukoli ve firmě. Naléhavou zprávu
smí jen ten, kdo má právo.

**Když to má být jinak:** řekněte, kdo smí psát komu (např. „zaměstnanec
jen lidem své pobočky a vedení; mezi pobočkami jen vedoucí"). Udělá se
to jako práva v Zařazení, ne podle role.

---

## 23. Naléhavé zprávy: strop a povinné „proč"?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R20).

Zadání 16. a 17. 9. chtěla, aby naléhavé zprávy měly **strop** (aby se
jimi nedalo zaplavit lidi mimo směnu) a aby záznam nesl i **proč**.
Nic z toho není a nikdo to nezrušil. Dnes: naléhavou smí jen ten, kdo
má právo, musí ji potvrdit a jde do záznamu (kdo, komu, kdy, bez textu).

**Co platí do rozhodnutí:** bez stropu, bez „proč".

**Když to má být jinak:** řekněte číslo (např. „nejvýš 3 naléhavé za
hodinu na odesílatele, pak jen běžné") a jestli má být „proč" povinné
pole. Obojí je malá změna s vlastním scénářem.

---

## 24. Odhlášení na sdíleném telefonu — vypnout upozornění do toho telefonu?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (nález z 22. 9.).

Kdo si zapne upozornění do telefonu, má je zapnutá pro **ten prohlížeč
v tom telefonu**. Odhlášení je dnes nevypne. Na služebním telefonu, který
koluje mezi lidmi, by tak další člověk viděl na zamčené obrazovce
upozornění předchozího (jen nadpis typu „Nová zpráva", nikdy text).

**Co platí do rozhodnutí:** odhlášení upozornění nevypne.

**Když to má být jinak:** při odhlášení se upozornění do toho telefonu
zruší; po dalším přihlášení je člověk zapne znovu jedním klepnutím.

---

## 25. Smí vedoucí upravit nebo stornovat SVOU vlastní docházku?

**Vzniklo:** 27. 9. 2026, úprava úseků.

Vedoucí s právem spravovat docházku by si jinak mohl sám prodloužit
směnu, a zápis by byl jeho vlastním jménem.

**Co jsem vybral do té doby:** ne. Úprava i storno vlastního úseku
projdou jen **majiteli**; vedoucímu je databáze odmítne větou „Vlastní
docházku si upravit nemůžete — udělá to majitel nebo jiný vedoucí."
a obrazovka mu u vlastních úseků tlačítka nekreslí.

**Pozor na rozpor:** starý ruční zápis na Docházce
(`zapsat_rucni_dochazku`) vedoucímu zapsat vlastní příchod či odchod
dnes **dovoluje**. Sjednotit (zakázat i tam), nebo tady povolit?

**Druhá cesta, už zavřená (28. 9.):** stará funkce
`stornovat_dochazku` (storno jednoho záznamu z 2. 9.) měla pro
přihlášené EXECUTE a pravidlo „vlastní jen majitel" v ní nebylo —
vedoucí si stornem vlastního odchodu na oběd a příchodu po obědě udělal
z 8–12 a 13–17 jeden úsek 8–17 (+30 min). Aplikace ji nevolá, takže jí
migrace `20260927110000` EXECUTE odebírá (tělo se nemění). Kdyby se
měla vracet, musí do ní dostat pravidla storna úseku.

## 26. Má zaměstnanec dostat upozornění, když mu vedoucí úsek upraví nebo stornuje?

**Co jsem vybral do té doby:** žádné nové upozornění. Zaměstnanec to
uvidí v **Můj účet → Moje úseky** u dne („upraveno", kdo a proč,
přeškrtnutý původní záznam). Audit má souhrnný řádek
`attendance.usek_upraven` / `attendance.usek_stornovan`.

**Když to má být jinak:** upozornění do zvonečku (a případně push) při
každé úpravě — jedna věc navíc ve funkcích úpravy, druh upozornění je
potřeba založit.

## 27. Mají jít upravovat i minulé, už vyplacené měsíce?

**Co jsem vybral do té doby:** jde to, s pruhem „Uzavřený měsíc — úprava
změní už spočítanou mzdu" nahoře a s auditem. Uzávěrka mezd v aplikaci
není, takže nic zamknout nejde.

**Když to má být jinak:** zamknout po výplatě (potřebuje „uzávěrku"
měsíce jako nový údaj), nebo úpravu minulého měsíce povolit jen
majiteli.

## 28. Doplnit „kdo zapsal" u deseti ručních záznamů stornovaných 2. 9.?

Spoušť dosud při každé změně záznamu přepsala „kdo ho zapsal" na toho,
kdo změnu udělal. U deseti ručních záznamů stornovaných 2. 9. (migrace
bez přihlášeného) je proto zadavatel prázdný, i když ho audit
„attendance.manual" zná. Spoušť je od `20260927110000` opravená, ale
jen do budoucna.

**Co jsem vybral do té doby:** data se nemění. Doplnit se to dá jednou
migrací z auditu, ale je to zásah do ostrých dat — bez rozhodnutí ne.

## 29. Nejdelší úsek 24 h? A má úprava umět přesunout úsek do jiného provozního dne?

**Co jsem vybral do té doby:**
- úsek delší než 24 hodin databáze odmítne,
- příchod, který by po úpravě patřil do jiného **provozního** dne (třeba
  pekař v 4:30 při začátku dne v 5:00), odmítne s radou úsek stornovat
  a zapsat nový v tom dni.

Důvod: přesun mezi dny mění párování i měsíc mzdy (pravidlo 12) a dva
kroky (storno + nový) jsou v auditu čitelnější.

## 30. Kdo smí vidět úseky člověka? Stačí právo na mzdy?

**Co jsem vybral do té doby:** úseky vidí jen ten, kdo **čte docházku**
(`attendance.read`) — po záznamu, jako všude jinde v docházce (vedoucí
pobočky jen svou pobočku). Peníze po dnech navíc chtějí `payroll.read`.
Účetní jen s právem na mzdy úseky nevidí (Výdělky ano).

## 31. Zavřít úplně přímý zápis do docházky (INSERT mimo funkce)?

Úprava a mazání záznamů přímo v tabulce jsou od `20260927110000`
zavřené (šly obejít: přepsat čas, smazat, „odstornovat" — u píchnutí
bez auditu).

**INSERT je zúžený na sedm sloupců** (`tenant_id, branch_id,
employee_id, kind, occurred_at, source, note`) — přesně ty, na kterých
stojí dva starší scénáře (krok2, krok6). Dřív šel na VŠECH sloupcích:
vedoucí uměl vložit záznam „stornovaný majitelem" s vlastním důvodem,
„opravu" (`nahrazuje`), „PIN na tabletu" nebo záznam s jiným provozním
dnem (`business_date` spoušť nepřepíše) — a obrazovka by to ukázala
jako fakt, bez auditu. Zmizel i MAINTAIN z výchozích práv Supabase.
Scénář krok5 vkládal pod přihlášeným i `business_date` a `entered_by`;
je upravený tak, aby dál měřil politiku a omezení, a přibyla v něm
kontrola, že sloupec `entered_by` přihlášený do požadavku nenapíše.

**Co zůstává otevřené:** vedoucí přes rozhraní databáze pořád umí
vložit obyčejný záznam, který vypadá jako píchnutí (`source = 'app'`),
a audit ho nezapíše. **Doporučuji zavřít INSERT úplně v dalším kroku**
(krok2 a krok6 přepsat na superuživatele) — aplikace sama do tabulky
přímo nezapisuje nikde.

## 32. Má si člověk, který se píchl omylem, příchod sám odvolat?

Třeba do 5 minut na tabletu nebo v telefonu.

**Co jsem vybral do té doby:** ne. Stornovat úsek smí jen vedoucí
s právem spravovat docházku na té pobočce, nebo majitel (v bočním panelu
přehledu „Stornovat příchod…", na obrazovce člověka u úseku).

## 33. Sjednotit, kdy je člověk „v práci", s tím, jak páruje mzda?

**Vzniklo:** 28. 9. 2026, nezávislá kontrola.

Dvě pravidla se rozcházejí:
- `app.otevreny_prichod` (přehled „v práci", Dnes, kiosek, píchání)
  chce odchod **ostře později** než příchod a o pořadí shod nerozhoduje,
- automat mzdy (`app.worked_minutes`, `app.useky_dochazky`) spáruje
  i odchod ve **stejné chvíli** (úsek 0 min).

V ostré DB to 27. 9. nastalo: ruční příchod i odchod v 09:00:00.
Přehled ukazuje člověka „v práci od 27. 9.", mzda má úsek 0 min
a storno samotného příchodu databáze odmítne („Mezitím to někdo
změnil"), protože v automatu ten příchod otevřený není. Obdobně při
dvou otevřených příchodech přehled bere ten novější, automat ten starší.

**Co jsem vybral do té doby:** pravidla se nemění (týká se to kiosku
a píchání, to je samostatný krok). Boční panel přehledu u takového
příchodu storno nenabízí a pošle na obrazovku člověka; ta úsek 0 min
popíše slovy („Příchod a odchod ve stejnou chvíli — zkontrolujte
odchod"). U dvou otevřených příchodů panel stornuje ten pozdější
a řekne, podle kterého člověk v práci zůstane.

**Návrh:** `app.otevreny_prichod` přepsat na řádek „otevreny"
z `app.useky_dochazky` (odchod >= příchod, pořadí shod podle
`created_at`) a totéž v `lib/dochazka-dnes.ts`. Chce to kontrolu shody
nad kopií ostrých dat jako u mzdy.

---

## 34. Jak dlouho se zprávy uchovávají?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (zadání 3. 9.: „nevymýšlet,
jen nechat místo").

Zprávy, hlasovky a přílohy se dnes **nemažou nikdy** (smazání zprávy je
jen zrušení se stopou). Je to osobní údaj; doba uchování je rozhodnutí
firmy, ne programu.

**Co platí do rozhodnutí:** nic se nemaže.

**Když to má být jinak:** řekněte lhůtu (např. „zprávy 12 měsíců,
hlasovky 3 měsíce"). Mazání pak poběží samo podle data.

---

## 35. Zprávy na tabletu (kiosku) po PINu: dostavět, nebo zatím vypnout?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R19).

Zadání 3.–6. 9.: tablet na baru ukáže jen, **kolika lidem** něco leží
(bez jmen), a obsah až po PINu, s odpočtem do zavření. V databázi to
6. 9. vzniklo, **obrazovka tabletu to ale nikdy nedostala** — nic v
aplikaci to nevolá. Funkce jsou přístupné bez přihlášení (tak tablet
funguje), chrání je klíč tabletu a PIN.

**Co platí do rozhodnutí:** zůstává, jak je.

**Když to má být jinak:**
- *dostavět:* obrazovka tabletu dostane „Zprávy čekají na N lidí" a po
  PINu přečtení s odpočtem.
- *vypnout:* databázová část se zavře (odebere se přístup), dokud ji
  nebudete chtít; návod, jak ji vrátit, zůstane v migraci.

---

## 36. Která upozornění smí člověk vypnout a chcete je i e-mailem?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R7).

Dnes jde v Nastavení upozornění vypnout jen **vzkazy** a **Nástěnku**.
Změny směn nejdou vypnout (správně). Úkoly, checklisty, zálohy
a zapomenutý odchod (49 ze 118 upozornění v ostré verzi) vypnout nejdou.
Zadání 8. 9. chtělo i přepínač úkolů a **e-mail** (u směn zapnutý,
jinde vypnutý), zadání 16.–17. 9. kategorie Přímé zprávy / Směny / Úkoly
/ Oznámení / Marketing. E-mail jako kanál upozornění dnes neexistuje.

**Co platí do rozhodnutí:** vypnout jdou vzkazy a Nástěnka, e-mail ne.

**Když to má být jinak:** řekněte, co smí člověk vypnout (a co ne, např.
zálohy k potvrzení) a jestli chcete e-mail. U e-mailu se drží pravidla
z 8. 9.: jen naléhavé, souhrn nejvýš jednou za hodinu, v noci ticho,
v patičce jak vypnout.

---

## 37. Jazykový model pro návrh úkolu a přepis hlasovek?

**Vzniklo:** 27. 9. 2026, rešerše Komunikace (rozpor R5; otevřené
od 17. a 22. 9.).

Zadání 16.–20. 9. chtěla automatický přepis hlasovek a „AI návrh úkolu"
ze zprávy. Pravidlo 8 a zadání 3. 9. říkají, že z komunikace nejde do
jazykového modelu nic. 17. 9. jste zvolil „zatím bez AI přepisu". Návrh
úkolu dnes dělají jednoduchá pravidla (termín, priorita podle slov
v textu), bez modelu. Přepis hlasu do cizí služby znamená nového
dodavatele a smlouvu o zpracování osobních údajů.

**Co platí do rozhodnutí:** bez modelu; přepis vypnutý (z aplikace
zmizí věty, které to každému připomínají).

**Když to má být jinak:** řekněte, jestli ano, a pro co (jen přepis,
jen návrh úkolu, obojí) a kterého dodavatele. Mzdy, docházka a zálohy
do modelu nepůjdou nikdy.

---

## 38. Oznámení pobočky: má ho potvrdit i ten, kdo tam jen vypomáhá?

**Vzniklo:** 28. 9. 2026, oprava Komunikace po nezávislých kontrolách
(`docs/komunikace-stav-a-plan-2026-09-27.md`, oddíl 0.1).

Oznámení pro pobočku (např. „Zítra inventura na Perle") dnes **uvidí
každý, kdo na pobočku dosáhne** — i brigádník, který na Perle jen
vypomáhá a doma je na Baru. Upozornění, seznam „Nepotvrdili: …"
a od 28. 9. i štítek „Čeká na vaše potvrzení" a číslo ve zvonečku ale
berou jen lidi, kteří mají pobočku jako **domovskou**. Vypomáhající
oznámení na Nástěnce najde, jen na něj nečeká a nikdo ho neurguje.

Do 28. 9. se to rozcházelo: číslo a štítek počítaly každého, kdo
oznámení viděl, upozornění a „Nepotvrdili" jen domovské. Teď všechna
čtyři místa počítají stejně.

**Co platí do rozhodnutí:** jen domovská pobočka (stejně jako
upozornění z kanálu pobočky, plán P5). Nikomu to nepřidává povinnost,
kterou dnes nemá.

**Když to má být jinak:** „potvrzuje každý, kdo na pobočce dělá"
(podle přístupu k pobočce, nebo podle směny v posledních dnech).
Změní se najednou upozornění, „Nepotvrdili" i štítek, spolu s P5.

---

## 39. Potvrzovací tabulka směn: má vedoucí umět potvrdit/odmítnout SMĚNU ZA zaměstnance?

**Vzniklo:** 29. 9. 2026, potvrzovací tabulka směn (PR #90).

Zadání: „možnost potvrzení všech směn a nebo možnost nepotvrdit třeba
jednu nebo více směn." Na rozdíl od záloh (kde zadání výslovně chtělo
i variantu „majitel potvrdí za zaměstnance", `potvrdit_zalohu_za_zamestnance`)
tady o „za zaměstnance" nepadlo ani slovo. Implementace je proto
**čistě self-service** — každý potvrzuje a odmítá jen svoje vlastní
směny, hromadně (Potvrdit vše) nebo po jedné. Vedoucí s `shifts.manage`
vidí přehled „Kdo potvrdil", ale jen ke čtení, nemůže tam nic za
nikoho udělat.

**Co platí do rozhodnutí:** jen self-service. Vedoucí, který chce, aby
někdo potvrdil směnu, musí za ním dojít nebo napsat.

**Když to má být jinak:** nová RPC `potvrdit_smenu_za_zamestnance` /
`odmitnout_smenu_za_zamestnance`, analogie zálohové dvojice, plus
tlačítka v přehledu „Kdo potvrdil". Stojí za zvážení stejná otázka jako
u záloh: má to smět jen majitel (`app.is_owner`, „kdo vydává, si
nesmí sám potvrzovat"), nebo `shifts.manage` obecně?

---

## 40. Přehled „Kdo potvrdil" — pevné okno ±14 dní, nebo výběr data?

**Vzniklo:** 29. 9. 2026, potvrzovací tabulka směn (PR #90).

`smeny_potvrzeni_pobocky(p_tenant, p_branch, p_od, p_do)` bere rozsah
data jako parametr, ale UI ho zatím neposílá — obrazovka ukazuje pevné
okno ±14 dní od dneška bez možnosti změnit. Zadání ani vzor
(`zalohy_pobocky`, který taky nemá date picker) číslo pro okno
nedávaly, tak jsem zvolil rozumnou výchozí hodnotu.

**Co platí do rozhodnutí:** ±14 dní, bez volby.

**Když to má být jinak:** RPC parametry `p_od`/`p_do` už existují —
stačí do `app/[rozsah]/smeny/potvrzeni/page.tsx` přidat výběr rozsahu
(žádná migrace).

---

## 41. Upozornění na odmítnutou směnu nenese jméno, kdo ji odmítl

**Vzniklo:** 29. 9. 2026, potvrzovací tabulka směn (PR #90).

Notifikace `smena.odmitnuta`, kterou dostane vedoucí pobočky, nese jen
den, čas a důvod odmítnutí — ne jméno zaměstnance, který směnu odmítl.
Text i odkaz to nepředstírají a vedou rovnou na přehled, kde jméno je.
Nesahal jsem kvůli tomu do migrace (JSON tělo `app.notifikovat`
u `odmitnout_smenu`).

**Co platí do rozhodnutí:** bez jména v samotném upozornění, doklikat
se na tabulku.

**Když to má být jinak:** doplnit jméno zaměstnance do `p_telo` volání
`app.notifikovat` v `public.odmitnout_smenu` (migrace) a promítnout do
textu upozornění (`lib/upozorneni-text.ts`).

---

## 42. E-mail/OCR faktur — vlastní příjem appky, nebo zůstat na n8n?

**Vzniklo:** 7. 10. 2026, modul Integrace (`Foodtab_Integrace_Claude_Code.md`).

OCR čtení e-mailových faktur dnes běží mimo appku, v n8n, a píše do
oddělené databáze Faktur (`lib/supabase/faktury.ts`). Nové zadání chce
e-mailovou kategorii v appce samotné, a napojení appka dnes umí (IMAP
konektor, `lib/integrace-mail-imap.ts`, hotový a ověřuje reálné
přihlášení). Appka ale nerozhodla sama, jestli má postavit VLASTNÍ
příjem e-mailu (IMAP → Storage → OCR, vzor `lib/komunikace/prilohy.ts`),
nebo zůstat na dnešní n8n pipeline a jen rozšířit, co z Faktur-DB
čte/zobrazuje — druhá varianta je mnohem menší zásah, ale neumí
rozlišit typy dokladu (faktura/zálohová/dobropis/dodací list), jak
zadání chce.

**Co platí do rozhodnutí:** IMAP konektor appka postavila (ověření +
uložení schránky), ale NEČTE žádné zprávy — stojí a čeká na tohle
rozhodnutí, aby appka nerozjela konkurenční pipeline bokem.

**Když to má být jinak:** stačí řekne „appka ať čte sama" nebo „zůstává
na n8n" — obě cesty jsou v `docs/integrace-modul-plan.md`, oddíl P2,
rozepsané i s odhadem dopadu.

> **ROZHODNUTÍ ŠÉFÍKA (7.–8. 10. 2026):** appka čte schránky SAMA a
> **postupně nahradí n8n úplně**; faktury zapisuje do **stávající databáze
> Faktur** (jako n8n); faktury se zpracovávají **průběžně**, s
> **automatickou kontrolou a prací**. Tahle otázka je tím uzavřená.
> Postaveno v noci 7.→8. 10. — viz `docs/hlaseni/stav-2026-10-08.md`.

---

## 43. Dotykačka partnerská/testovací licence

**Vzniklo:** 7. 10. 2026, modul Integrace.

Appka má kontraktovou kostru (`PosProvider`) i cílovou tabulku
(`pokladna_prodeje_denni`), ale žádný živý HTTP klient — oficiální API
(`docs.api.dotypos.com`) vyžaduje partnerskou/testovací licenci, o
kterou appka nesmí sama žádat (obchodní poptávka).

**Co platí do rozhodnutí:** appka zůstává jen na CSV importu prodejů,
`zdroj='dotykacka_api'` je povolená hodnota v databázi, ale nic ji
neplní.

**Když to má být jinak:** kdo s Dotykačkou jedná a získá přístup, ať
appce dá API klíč/dokumentaci k autentizaci — appka postaví konkrétní
klienta, ne dřív.

---

## 44. Salt Edge partnerská pozvánka

**Vzniklo:** 7. 10. 2026 večer, rozhodnutí o bankovní integraci.

Rozhodnuto (psaný pokyn): první bankovní integrace jde přes Salt Edge
Partners AIS. Appka postavila celou architekturu (`lib/integrace-saltedge.ts`
a související), ale Salt Edge **není samoobslužný** — vyžaduje žádost
o partnerský přístup dřív, než vůbec existuje sandbox. Appka si ho
sama nesmí vyžádat ani podepsat smlouvu.

**Co platí do rozhodnutí:** appka zůstává u kategorie Banka → Salt
Edge ve stavu „připraveno bez přístupu", Fio zůstává jediný živě
funkční bankovní zdroj.

**Když to má být jinak:** kdo s Salt Edge jedná, ať appce po získání
přístupu dá přesně pět věcí — `docs/hlaseni/stav-2026-10-07.md`, oddíl
„Co appka nemohla a nemá dodat", má úplný seznam (App-id/Secret,
webhook URL k zaregistrování, aktuální veřejný klíč pro podpis,
potvrzení pokrytí firemních účtů u konkrétních bank).

---

## 45. Přestěhovat faktury z odděleného projektu do appky?

**Vzniklo:** 8. 10. 2026 v noci — do Supabase projektu Faktur
(`ctqtwahlzhyjerqulqyn`) se dnes nikdo nepřihlásí.

Databázi, do které nikdo nemá přístup, nejde spravovat: nedá se do ní
přidat sloupec `tenant_id`, nastavit skutečná RLS, opravit veřejný
kbelík s PDF (otázka 46), zálohovat ji ani přidat pojistku proti
duplicitám. Přestěhovat ji ale JDE i bez přihlášení — appka do ní čte
i zapisuje přes veřejný (anon) klíč, takže si 3 021 faktur i jejich PDF
umí zkopírovat do vlastní databáze (tabulka s `tenant_id`, RLS,
soukromé úložiště) a pak číst a zapisovat jen tam. ID faktur se dají
ponechat, takže párování plateb (`platby_faktury.faktura_id`) zůstane
platné.

**Co platí do rozhodnutí:** appka zůstává na odděleném projektu
(rozhodnutí 7. 10.: „do stávající databáze Faktur"), přístup jen přes
bránu `pristupKFakturam` a `FAKTURY_DB_TENANT_ID`.

**Když to má být jinak:** jedna noc práce — migrace s tabulkou faktur,
idempotentní kopie (opakovatelná, nic nezdvojí), přepnutí čtení a
zápisu, a teprve po kontrole počtů odpojení starého projektu. Doporučuju.

---

## 46. Veřejný kbelík `faktury-pdf` v projektu Faktur

**Vzniklo:** 8. 10. 2026 v noci, průzkum databáze Faktur.

n8n ukládal PDF faktur do kbelíku `faktury-pdf`, který je **veřejný**:
kdo zná (nebo uhodne) adresu souboru, otevře fakturu bez přihlášení
(845 z 1 000 zkontrolovaných faktur má takový odkaz). Bez přihlášení do
projektu Faktur to appka neopraví.

**Co platí do rozhodnutí:** nové přílohy z vlastního příjmu jdou do
SOUKROMÉHO kbelíku `faktury-prilohy` v naší databázi a odkaz vede přes
appku s kontrolou oprávnění (`/api/faktury/priloha/…`). Staré odkazy
zůstávají veřejné.

**Když to má být jinak:** buď se někdo do projektu Faktur přihlásí a
kbelík přepne na soukromý (pak ale přestanou fungovat staré odkazy
v `pdf_url`), nebo se to vyřeší přestěhováním (otázka 45).
