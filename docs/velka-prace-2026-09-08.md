# Velká práce na 8. 9. — aby aplikace vydržela první ostrý den

Zadal Šéfík 8. 9. před odchodem: *„potřebuju nasadit notifikace pro
zaměstnance když se něco změní — směny, zpráva atd. Dnes rozešlu
pozvánky, tak ať apka funguje bez problémů. Ještě dnes doladit vzkazy
a komunikaci, přidáme i hlasové zadávání vzkazů."*

Tenhle soubor nahrazuje pořadí ve všech starších zadáních. Ostatní
dokumenty platí jako podklad — jen se do nich chodí v pořadí, které je
tady.

---

## 0. Co jsem si domyslel

Šéfík odešel a čekat na odpověď by stálo celý den. Tohle jsou moje
rozhodnutí, ne jeho. **Když se mu některé nelíbí, změní se to.**

**„Notifikace" dělám ve třech vrstvách, ne jako push do mobilu.** Push
dnes nechodí a rozchodit ho do večera se nedá poctivě. Vrstva
v aplikaci ale **už z devadesáti procent existuje** — tabulka
`notifications`, zvoneček s počtem i obrazovka Upozornění. Chybí
u ní jen to, na co se Šéfík ptá: směny a zprávy do ní nic nezapisují.
Viz oddíl 5.

**Hlasové zadávání dělám tak, aby fungovalo dnes** — diktováním na
klávesnici telefonu, ne tlačítkem s mikrofonem v aplikaci. Důvod je
v oddílu 6 a není to lenost: to tlačítko by na iPhonu nefungovalo.

**Zařazení místo rolí jde první. Rozhodl to Šéfík**, když jsem mu
navrhoval opak.

Navrhoval jsem odložit to za dnešek: je to zásah do jádra oprávnění a
dělá se v den, kdy do firmy přijde deset nových lidí. Šéfík chce
opačné pořadí a má pro to dobrý důvod — **lidem, kteří dnes dostanou
pozvánku, se přiděluje právě to, co se má měnit.** Udělat to napřed
znamená rozdat práva jednou, ne dvakrát.

**Z toho ale plynou dvě tvrdé podmínky, oddíl 3.0.** Nejsou na výběr.

---

## 1. Než rozešleš pozvánky — tohle je pro Šéfíka, ne pro Codea

**Čtyři věci a jedna z nich je ta, co dnešek nejspíš pokazí.**

### 1.1 Zvedni strop na e-maily. Tohle je ta věc.

Dnes je nastavený na **30 e-mailů za hodinu za celý projekt.**

Spočítej si to: každý člověk dostane **pozvánku** a pak nejmíň jeden
**přihlašovací kód**. To jsou dva e-maily. Kdo si kód nechá poslat
podruhé — a to udělá skoro každý, kdo ho opíše špatně — tři. **Deset
lidí je přes třicet zpráv.**

A po překročení stropu se e-maily **tiše zahazují**. Člověk vidí „kód
odeslán" a nepřijde nic. Ty budeš hledat chybu v aplikaci a žádná tam
nebude.

Nastav **100 za hodinu**:
https://supabase.com/dashboard/project/spekntcsuroqhehmjssv/auth/rate-limits

Vlastní odesílání přes Resend už máš (pošta chodí z `noreply@foodtab.cz`),
takže tam žádné omezení služby nestojí — jen ta hodnota v poli.

### 1.2 Nasaď ty dvě migrace

`20260907010000_muj_den.sql` a `20260907020000_ai_use_pryc.sql`.
Bez nich obrazovka **Dnes** — ta první, kterou číšník po přihlášení
uvidí — hlásí, že jí něco chybí. To je špatná první vteřina.

Čeká to na ten účet Supabase. **Je to na pět minut, jen se musí trefit
do správného účtu** (viz včerejšek).

### 1.3 Rozesílej i s návodem, ne jen odkaz

Na listu s QR (`docs/qr/foodtab-apka-a4.pdf`) je pořadí kroků a
záleží na něm: **nejdřív přidat na plochu, teprve pak se přihlásit.**
Kdo to udělá obráceně, přihlásí se dvakrát a bude si myslet, že je to
rozbité — iPhone má pro aplikaci na ploše vlastní úložiště.

### 1.4 Projdi to sám jako číšník, ne jako majitel

Než to rozešleš: přihlas se na svém telefonu, píchni příchod, otevři
Vzkazy, podívej se na Dnes. **Pět minut.** Cokoli, co najdeš ty, je
levnější než totéž nalezené patnácti lidmi najednou.

---

## 2. Pořadí pro Codea

Pravidla noci platí i ve dne: **na nic se neptáš.** Otázku o provozu
zapiš do `docs/hlaseni/otazky.md`, vyber nejopatrnější variantu, do
kódu napiš `// ROZHODNOUT: …` a jdi dál.

| | co | proč právě sem |
|---|---|---|
| **A1** | Docházka: stornovaný příchod (oddíl 3, A1) | chyba v ostrém provozu, je to na chvíli |
| **E** | **Zařazení místo rolí** (oddíl 7) | Šéfík rozhodl: napřed, ať se práva rozdají jednou |
| **A2–A5** | Zbytek přípravy na první lidi | dnes přijdou lidi |
| **B** | Vzkazy a komunikace | Šéfík to chce dnes |
| **C** | Upozornění na změny | Šéfík to chce dnes |
| **D** | Hlasové zadávání | krátké, navazuje na B |

**Na hranici každého písmene se dá skončit.** Když dojde čas, skonči
tam — rozdělaný krok C je horší než hotový krok B.

**Jediná výjimka: krok E se nesmí nechat rozdělaný přes noc.** Buď je
databázová část hotová celá a odzkoušená, nebo se necommitne. Poloviční
přepnutí oprávnění je to nejhorší, co v tomhle repozitáři může ležet.

---

## 3. Krok A — než přijde první číšník

### A1. Docházka: stornovaný příchod pořád nabízí Odchod

**Jediná skutečná chyba v ostrém provozu.** Popis je
v `docs/nocni-prace-2026-09-08.md`, krok 1, a platí beze změny:
`app/[rozsah]/dochazka/page.tsx` kolem řádku 428 nefiltruje
`stornovano_kdy` ani `uzavreno_systemem`.

Dnes přijdou lidi píchat. **Tohle je první.**

### A2. Pryč s pruhem o osobních údajích

`docs/zarazeni-misto-roli.md`, oddíl 6.4. Odeber `<PruhInformace>`
z rámu; text zůstává v Mých údajích. Komponentu ani tabulky nemaž.

Dnes to má nečekaně velkou váhu: patnáct lidí se poprvé přihlásí a
první, co uvidí, bude cedule o osobních údajích s poznámkou, že text
čeká na právníka.

### A3. Odhlásit se na rozcestník

`docs/zarazeni-misto-roli.md`, oddíl 6.6. Vlevo dole, oddělené čarou,
**s krátkým dotazem** „Odhlásit se?" — na sdíleném telefonu za barem
je to potřeba a omylem ťuknuté odhlášení uprostřed směny je horší než
ťuknutí navíc.

### A4. Úklid pohledu zaměstnance

Z `docs/rychlost-a-pohled-zamestnance.md`, část 2. Nová práce to není,
je to skrývání:

1. Řádka vypnutých modulů (Tvorba menu, Finance, Marketing, Objednávky)
   jen tomu, kdo má `settings.manage`.
2. Položky „Připravujeme" (Receptury, Jídelní lístky, Motivace)
   zaměstnanec nevidí.
3. **Vzkazy do spodní lišty místo Záloh.**

### A5. Pozvánka musí umět selhat srozumitelně

Dnes se pozvánky rozejdou k lidem, kteří aplikaci nikdy neviděli.
Projdi `app/pozvanka/[token]` a ověř, že **každý z těchhle případů má
českou větu a cestu ven**, ne bílou stránku ani číslo chyby:

- pozvánka **vypršela**,
- pozvánka už byla **použita**,
- pozvánka byla **zrušena**,
- odkaz je **poškozený** (lidé je přeposílají a mrší se jim),
- člověk je **už přihlášený jiným účtem**.

**Vždycky ať je na obrazovce, co má člověk udělat** — typicky „napište
svému vedoucímu, ať pošle novou". Slepá ulička v tuhle chvíli znamená
telefonát Šéfíkovi uprostřed směny.

---

## 4. Krok B — Vzkazy a komunikace dotáhnout

Sloučení Nástěnky a Rozhovorů pod jednu položku je hotové (`a18085e`).
Zbývá to, co z komunikace dělá použitelný nástroj pro **nový tým,
který spolu v aplikaci ještě nikdy nemluvil.**

### B1. Adresát: jeden výběr pro celou aplikaci

Z `docs/nastenka-dokumenty-a-strediska.md`, oddíl 1. Úkoly už se
zadávají na **pobočku, úsek, pozici nebo člověka**
(`20260906040000`). Nástěnka umí jen firmu, pobočku a člověka.

**Tentýž výběr, ideálně tatáž komponenta:**

```
KOMU:  ( ) celá firma   ( ) pobočka   ( ) úsek
       ( ) pozice       ( ) člověk
```

Není to pohodlí. Dva různé způsoby výběru adresáta znamenají **dvě
různá místa, kde se dá udělat chyba v oprávněních** — a jedno se
opraví a druhé ne.

### B2. Před odesláním ať je vidět, kdo to uvidí

**Tohle je dnes důležitější než obvykle.** Šéfík bude psát prvním
lidem a nesmí se stát, že vzkaz mířený jednomu člověku přistane celé
firmě. Nad tlačítkem Odeslat ať stojí větička typu:

> *Uvidí: Bernard Bar — úsek Bar (4 lidé)*

U výběru **celá firma** ať je to zvýrazněné. Ne dialog, jen ať je to
vidět.

### B3. „Beru na vědomí"

Z `docs/nastenka-dokumenty-a-strediska.md`, oddíl 3. Volitelný příznak
u oznámení:

- kdo ji otevře, uvidí tlačítko **Beru na vědomí** — vědomé kliknutí,
  ne tiché „zobrazeno",
- vedoucí vidí **seznam jmen**, kdo nepotvrdil. Ne procenta — vedoucí
  potřebuje vědět, komu to má říct osobně,
- nepotvrzené **zůstávají nahoře**, od nejstaršího,
- u zpráv s vyžadovaným potvrzením **nejsou reakce ani odpovědi**.

Nedávej to na všechno. „Zítra dorazí pivo ve dvě" potvrzení nepotřebuje.

### B4. Jedno číslo nepřečtených

Nepřečtené z Vzkazů i Nástěnky se sčítají do **jednoho čísla** u ikony.
Člověku je jedno, jestli mu leží oznámení nebo vzkaz; chce vědět, že
něco leží.

### B5. Co teď nedělat

**Přílohy a dokumenty** (`docs/nastenka-dokumenty-a-strediska.md`,
oddíl 2). Potřebují neveřejný bucket v Supabase Storage a ten se dnes
nedá nastavit — účet je zablokovaný. **Nezakládej to napůl.** Poloviční
úložiště s veřejnými odkazy je horší než žádné.

---

## 5. Krok C — Upozornění, když se něco změní

### C1. Nestav nic nového. Devadesát procent už existuje.

- Tabulka **`public.notifications`** (`20260901130000_vydani_rozpisu.sql`,
  řádek 54) — `tenant_id`, `user_id`, `branch_id`, `druh`, `telo`,
  `read_at`, RLS i politiky.
- **Zvoneček s počtem** v rámu aplikace (`ram.tsx`, řádek 193).
- **Obrazovka Upozornění** (`app/[rozsah]/upozorneni/page.tsx`).
- Zapisuje se do ní už z **devíti** míst: vydání rozpisu, zálohy,
  členství, přijetí pozvánky, zapomenutý odchod, storno docházky,
  přidělení PINu.

**Chybí jen to, na co se Šéfík ptá.** Směny a zprávy do ní nezapisují
nic. To je celá práce — dopsat zápis tam, kde chybí.

### C2. Události, které mají upozornění zakládat

| kdy | komu | naléhavost |
|---|---|---|
| **změna mé směny** (čas, pobočka, úsek) | dotčenému | vysoká |
| **zrušení mé směny** | dotčenému | vysoká |
| **přiřazení na novou směnu** | dotčenému | vysoká |
| **nový vzkaz** | adresátům | běžná |
| **nové oznámení na nástěnce** | adresátům | běžná |
| **oznámení vyžaduje potvrzení** | adresátům | vysoká |
| **nový úkol pro mě** | adresátovi | běžná |
| **úkol po termínu** | adresátovi i zadavateli | běžná |

**Vydání rozpisu už upozornění zakládá** — nedělej to podruhé, jinak
při vydání rozpisu přijde lidem dvacet upozornění najednou.

### C3. Tři pravidla, která se neporušují

**1. Upozornění je odkaz na věc, ne opis věci.** Do `telo` patří
*„Změnila se ti směna ve čtvrtek"*, ne obsah vzkazu a **nikdy** mzda,
sazba, záloha nebo telefonní číslo. Upozornění se čtou přes rameno na
baru.

**2. Rozhoduje `app.has_access`, ne kdo je v seznamu adresátů.** Kdo
na věc nevidí, upozornění nedostane — a ověřuje se to při čtení, ne
při zakládání. Pravidlo 2 platí i tady.

**3. Vlastní změna neupozorňuje.** Kdo si směnu přehodil sám,
upozornění o tom nechce.

### C4. Slučování — jinak to lidi vypnou

Když vedoucí v pondělí ráno přehází osm směn, nesmí číšníkovi přijít
osm upozornění. **Slučuj podle `(user_id, druh, den)`**: existující
nepřečtené upozornění téhož druhu na tentýž den se **přepíše**, ne
přidá — *„Změnily se ti 3 směny tento týden"*.

Tohle je ten rozdíl mezi nástrojem, který lidi používají, a nástrojem,
který si po týdnu ztlumí.

### C5. E-mail — druhá vrstva, dnes odpoledne

Pošta přes Resend chodí. Ale **ne každá změna e-mailem.**

- **Jen naléhavé** z tabulky výš: zrušení směny, změna směny, oznámení
  s potvrzením.
- **Souhrn, ne jednotlivosti.** Nejvýš jeden e-mail za hodinu na
  člověka; co se za tu hodinu nasbírá, jde v jednom.
- **Tichá hodina 22:00–6:00.** Výjimka jediná: zrušení směny, která
  začíná do dvanácti hodin — to člověk potřebuje vědět hned.
- **V patičce ať je, jak si to vypnout.**

### C6. Push do telefonu — třetí vrstva, dnes NE

Nedělej ji dnes. Ale **nezavírej jí dveře** a napiš do hlášení, co
bude potřeba:

- service worker a Web Push s **VAPID klíči** — privátní klíč je
  tajemství, **nikdy `NEXT_PUBLIC_`**, a generuje ho Šéfík, ne ty,
- tabulka odběrů (jeden člověk, víc zařízení),
- na iPhonu to jde **jen z aplikace přidané na plochu** a jen na
  novějším systému.

**A hlavně: dokud push prokazatelně nedoručí, nesmí být v rozhraní ani
zmínka, že něco přijde do telefonu.** Tohle pravidlo platí ze všech
předchozích zadání a dnes zvlášť — člověk, který spoléhá na
neexistující upozornění, přijde pozdě na směnu.

### C7. Co si člověk může vypnout

Nedělej z toho nastavení o dvaceti přepínačích. **Tři:**

- směny (výchozí zapnuto, e-mail zapnuto),
- vzkazy a nástěnka (v aplikaci zapnuto, e-mail vypnuto),
- úkoly (v aplikaci zapnuto, e-mail vypnuto).

**Zrušení směny se vypnout nedá.** Je to provozní informace, ne
marketing.

---

## 6. Krok D — hlasové zadávání vzkazů

### D1. Proč to nebude tlačítko s mikrofonem

Rozpoznávání řeči v prohlížeči (`SpeechRecognition`) **na iPhonu
nefunguje.** Tlačítko s mikrofonem by na Androidu fungovalo, na iPhonu
ne — a půlka lidí by měla dojem, že je aplikace rozbitá.

**Diktování ale na iPhonu funguje výborně** — mikrofon na systémové
klávesnici, přímo v poli. Umí česky, funguje ve všech aplikacích a
lidé ho znají.

### D2. Co udělat dnes (a je to skoro zadarmo)

**Pole na vzkaz musí diktování unést.** Je to tatáž chyba jako
u vkládání kódu — když se pole při psaní překresluje, diktování se
uprostřed věty utne.

Projdi pole na vzkaz (`app/[rozsah]/vzkazy/[konverzace]/page.tsx`,
řádek 306) i pole na oznámení a ověř:

- je to **`<textarea>`**, ne jednořádkový `input`, a **roste** s textem,
- **žádný `key`, který se mění**, žádné opakované `focus()`,
- **nic v okolí netiká po vteřinách** a nepřekresluje ho,
- rozepsaný text **přežije otočení telefonu** — v provozu se telefon
  otáčí pořád.

A do nápovědy pod pole jednu větu: *„Můžete i diktovat — mikrofon na
klávesnici telefonu."* Většina lidí neví, že to jde.

**Zkoušku napiš na to, co se láme:** vlož do pole dlouhý text najednou
a ověř, že tam zůstane celý.

### D3. Co je za tím a čeká na Šéfíka

**Hlasová zpráva jako nahrávka** potřebuje úložiště — čeká na Supabase,
stejně jako přílohy.

**Přepis řeči na text** by znamenal poslat hlas zaměstnanců do cizí
služby. To je **rozhodnutí pro Šéfíka, ne pro tebe.** Zapiš to do
`docs/hlaseni/otazky.md` a nedělej to.

---

## 7. Krok E — zařazení místo rolí *(hned po A1)*

Zadání je hotové: **`docs/zarazeni-misto-roli.md`.** Přečti si ho celé,
je to sto padesát řádků a nemá smysl začínat bez toho.

Šéfík ho chce **napřed**, ne po dnešku — důvod je v oddílu 0. Platí
k tomu tři věci navíc.

### 7.1 Převod dat je ta nejdůležitější část, ne ta nudná

V zadání je to oddíl 5.4 a **jeho pravidlo je závazné:**

> Po převodu musí mít každý člověk **přesně ta práva, která má dnes.**
> Nikdo nesmí získat právo navíc a nikdo nesmí o žádné přijít.

Kontrolu na to napiš **dřív než převod samotný** — porovná sadu práv
každého člověka před a po a musí se rovnat. Bez ní se převodu nedá
věřit a v den, kdy přijde deset lidí, se chyba v oprávněních projeví
jako chaos, ne jako chybová hláška.

### 7.2 Nedokončené se necommituje

Buď je databázová část hotová celá a scénář prochází, nebo v repozitáři
neleží nic. **Poloviční přepnutí oprávnění je horší než žádné** — a
tady zvlášť, protože nasazovat se dnes stejně nebude.

### 7.3 Nasadit to dnes nejde a je to tak dobře

Účet Supabase je rozházený, takže migrace zůstane ležet v repozitáři.
**Neber to jako překážku, ber to jako pojistku:** máme celý den na to
projet scénář proti opravdovému PostgreSQL, než se cokoli dotkne ostré
databáze.

Do hlášení napiš **kolik kontrol prošlo a z čeho**, ať se to dá ověřit
nezávisle.

---

## 8. Zkoušky

U každé nové kontroly **rozbij schválně to, co má hlídat, a přesvědč
se, že spadne** (`CLAUDE.md`).

**Docházka**

1. Po stornu příchodu obrazovka nabízí **Příchod**, ne Odchod.

**Komunikace**

2. Oznámení na **úsek** vidí lidé toho úseku; kdo tam nepatří, nevidí.
3. **Cizí firma** se ke zprávě nedostane.
4. Nepřečtené z obou záložek se sčítají do **jednoho čísla**.
5. „Beru na vědomí" jde kliknout **jednou** a je vidět **jméno**.

**Upozornění**

6. Změna směny založí upozornění **dotčenému** člověku.
7. **Vlastní** změna upozornění nezaloží.
8. Kdo na věc **nemá právo**, upozornění **nevidí** — ani přímým
   dotazem na tabulku.
9. Osm změn za sebou udělá **jedno** upozornění, ne osm.
10. V `telo` upozornění **není** mzda, sazba, záloha ani telefon —
    napiš to jako kontrolu, ne jako předsevzetí.
11. **Cizí firma** upozornění nevidí.
12. Vydání rozpisu nezaloží upozornění **dvakrát**.

**Pozvánky**

13. Vypršená, použitá i zrušená pozvánka mají **českou hlášku** a cestu
    ven.

---

## 9. Hlášení

Do `docs/hlaseni/stav-2026-09-08.md`: co je hotové s commity a soubory,
na které hranici jsi skončil, čísla kontrol **a z čeho jsou**, co čeká
na Šéfíka, otevřené otázky — a hlavně **na co jsi narazil a nešlo to.**

Zvlášť vypiš:

- **co ze seznamu v oddílu 1 Šéfík ještě neudělal** (hlavně ten strop
  na e-maily),
- **co bude potřeba pro push do telefonu**, ať se to dá připravit,
- jestli jsi v kroku B narazil na něco, co potřebuje úložiště.

**A pushni.** Co není v repozitáři, to pro nás neexistuje.

**Nenasazuj.** `db push` nespouštěj ani nasucho — účet Supabase je
rozházený a nasazuje Šéfík.
