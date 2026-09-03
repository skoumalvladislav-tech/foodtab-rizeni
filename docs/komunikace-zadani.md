# Zadání: modul Komunikace

Zadal Šéfík 3. 9. 2026.

> Potřebuji komunikovat mezi pobočkami, lidmi a posílat vzkazy vedení.
> Jedno pravidlo: vzkazy pracovníkům přijdou až po píchnutí na směnu.

---

## 0. Nestavíme na zelené louce

**Nástěnka už existuje** — `announcements` a `announcement_reads`
z `20260823130000_provoz.sql`, obrazovka `app/[rozsah]/zpravy`. Umí
zprávu firmě, zprávu pobočce, osobní zprávu jednomu člověku, připnutí
a evidenci přečtení.

**Nesahej na ni a nenahrazuj ji.** Je to jednosměrné sdělení „všichni
tohle vědí" a je na to dobrá. Chybí k ní **rozhovor** — dva a víc lidí,
odpovědi, vlákno. To je nové.

Dvě různé věci, dva různé tvary. Tak to má i Slack (kanál vs. zpráva)
a docházkové aplikace jako 7shifts (oznámení vs. chat). Slučovat je do
jednoho by znamenalo předělávat něco, co funguje.

*(Připomínka z dnešního dne: `shift_templates` už jednou existovala pod
jiným významem a `create table if not exists` to tiše přeskočil. Než
založíš tabulku, ověř, že to jméno je volné.)*

---

## 1. Pravidlo, kvůli kterému to celé vzniká

> **Vzkazy pracovníkům přijdou až po píchnutí na směnu.**

Je to dobré pravidlo a v Evropě má i právní rozměr — právo být offline.
Číšník, kterému v jedenáct večer pípne telefon kvůli rozpisu na příští
týden, je v práci, aniž by za to dostal zaplaceno.

### Jak to čtu — a kde jsem to změkčil

**Nedoručuje se nic mimo směnu.** Žádný zvoneček, žádný e-mail, žádný
zvuk. Zpráva čeká.

**Při příchodu se doručí všechno, co čekalo.** To je ta chvíle, kdy
člověk nastupuje a má právo vědět, co ho čeká.

**Ale když si člověk sám otevře aplikaci mimo směnu, zprávy si
přečíst může.** Uvidí *„Čekají na vás 3 zprávy, doručí se, až píchnete
příchod"* a může je otevřít.

**Tohle je moje čtení, ne tvoje slovo — přečti si ho a řekni, jestli
souhlasí.** Vedla mě k němu tahle úvaha: pravidlo má chránit člověka
před **vyrušením**, ne před informací. Kdybychom obsah schovali úplně,
tak si ten, kdo se chce na směnu připravit, stejně napíše kolegovi na
WhatsApp — a tím celý modul obejde. Zákaz, který se obchází, nechrání
nikoho.

### Výjimka, bez které to nefunguje

„Zítra máme zavřeno, nechoďte" **musí dorazit hned**. Kdyby čekalo na
píchnutí, dorazí to přesně ve chvíli, kdy už je pozdě.

- Zprávu jde označit jako **naléhavou** a ta pravidlo obejde.
- Smí to jen ten, kdo na to má právo (nové právo v `permissions`,
  ne podle názvu role — pravidlo 2).
- **Naléhavá zpráva je viditelně označená a jde do auditu**, se jménem
  odesílatele. Tohle je to jediné, co brání tomu, aby se naléhavé
  stalo výchozím. Když je naléhavé všechno, není naléhavé nic.

### Kdo nemá telefon

Brigádník bez účtu si zprávy přečte **na tabletu po píchnutí**. To
pravidlo mu sedí přesně — jinou chvíli, kdy je u aplikace, ani nemá.

**Ale tablet je sdílený a stojí na baru.** Osobní zpráva na něm nesmí
svítit tak, aby si ji přečetl kdokoli, kdo jde okolo. Takže:

- Kiosek ukáže jen **že zprávy jsou**, ne jejich obsah.
- Otevřou se **po zadání PINu**.
- Zavřou se samy **po krátké nečinnosti** a při odchodu.

---

## 2. Co přibývá

### Rozhovor

`konverzace`: `tenant_id`, `druh`, `nazev`, `zalozil`, `zalozeno_kdy`,
`uzavreno_kdy`.

Druhy:

| druh | k čemu |
|---|---|
| `osobni` | dva lidé mezi sebou |
| `pobocka` | všichni na jedné pobočce |
| `mezi_pobockami` | lidé z víc poboček — o to Šéfík výslovně žádal |
| `vedeni` | vzkaz nahoru, viz níž |

`konverzace_ucastnici`: `konverzace_id`, `employee_id`, `pridan_kdy`,
`odesel_kdy`, **`precteno_do timestamptz`**.

`precteno_do` je jeden řádek na účastníka, ne řádek na zprávu a
člověka. U dvanácti lidí by to bylo jedno; u dvou set poboček ne.

`zpravy`: `konverzace_id`, `tenant_id`, `autor`, `text`,
`nalehava boolean`, `vytvoreno_kdy`, `stornovano_kdy`, `stornoval`.

**Mazání je storno, ne výmaz** — jako u docházky (pravidlo 9). Zpráva,
která zmizí beze stopy, je v pracovním nástroji horší než zpráva, u
které je vidět, že ji někdo stáhl.

### Vzkaz vedení — a jedna past

Vzkaz nahoru musí umět dojít **mimo vedoucího pobočky**. Stížnost na
vedoucího, která přistane vedoucímu, je horší než žádná cesta: člověk
si myslí, že si postěžoval, a jediné, čeho dosáhl, je že si na sebe
řekl.

Odesílatel proto **vybírá adresáta**: „vedoucí pobočky" nebo
„majitel". U druhé volby konverzaci **nevidí nikdo kromě majitelů** —
ani provozní, ani nikdo s `people.manage`.

**Anonymní to nebude.** Ve dvanáctičlenném provozu je anonymita stejně
průhledná a zve to k útokům, na které se nedá odpovědět. Místo toho
platí to výš: úzký okruh adresátů a jistota, že se to k dotčenému
nedostane. **Ať je to na obrazovce napsané**, aby to člověk věděl
dřív, než začne psát.

---

## 3. Co se nesmí pokazit

**Do jazykového modelu z komunikace nejde nic** — pravidlo 8. Je to po
mzdách nejcitlivější tabulka v aplikaci: jsou v ní jména, stížnosti,
zdraví, řeči o penězích. Ani shrnutí, ani „jen ty veřejné".

**Kdo není účastník, nepřečte nic.** RLS na `zpravy` i na
`konverzace`. Ne „nezobrazí se mu to" — nesmí se k tomu dostat ani
přímým voláním. A napiš na to zápornou kontrolu; ta je tu důležitější
než ta kladná.

**Rozsah z prohlížeče je návrh.** Účastníky ověřuj proti členství
(pravidlo 4). U `mezi_pobockami` to platí dvojnásob — je to jediné
místo, kde se hranice poboček schválně překračuje.

**Vypnutý modul odmítne i přímé volání** (pravidlo 5).

**Doručení se počítá z docházky, ne z „je přihlášený".** Otevřená
směna je `in` bez `out` — a od dneška se to bere z **otevřeného**
příchodu (migrace `20260903010000`), ne z nejstaršího. Použij, co už
existuje; nepočítej si to znovu.

**Kdo má víc než jednu pobočku**, dostane při píchnutí zprávy z té
pobočky, kde píchl. Ne ze všech.

---

## 4. Co teď nedělat

Ať je jasné, kde končí noc:

- **Přílohy a fotky.** V restauraci se hodí (rozbitá lednice), ale je
  to úložiště, oprávnění k souborům a mazání — samostatná práce.
- **Push do mobilu.** Pořád nechodí. **Nepiš do rozhraní, že chodí.**
- **Doba uchování.** Zprávy jsou osobní údaj a jednou budou mít lhůtu.
  Nevymýšlej ji — je to rozhodnutí pro Šéfíka, ne pro kód. Jen **nech
  na to místo**: ať se maže podle data, ne podle „vyber si co".
- **Napojení na n8n a agenty.** Viz pravidlo 8.

---

## 5. Pořadí

Každý krok se dá nasadit sám. Když dojde noc, skončí se na hranici.

1. **Tabulky, RLS a kontroly** — bez obrazovek. Sem patří i ta záporná
   kontrola „cizí konverzaci nepřečtu ani přímým voláním".
2. **Zadržené doručení** — funkce, která řekne, co se komu doručí, a
   napojení na píchnutí. Tohle je jádro; obrazovka bez něj je jen chat.
3. **Obrazovka rozhovorů** vedle stávající Nástěnky, ne místo ní.
4. **Vzkaz vedení** s volbou adresáta.
5. **Kiosek** — že zprávy jsou, otevření po PINu, samo se zavře.

---

## 6. Testy

1. Zpráva poslaná **mimo směnu se nedoručí**; po píchnutí příchodu ano.
2. **Naléhavá** se doručí hned — a je označená a v auditu.
3. Naléhavou **nepošle**, kdo na to nemá právo.
4. **Cizí konverzaci nepřečte nikdo**, ani přímým voláním, ani majitel.
5. Vzkaz **adresovaný majiteli nevidí provozní**, ani s `people.manage`.
6. `mezi_pobockami`: účastník z druhé pobočky **čte**, kdo v ní není,
   **nečte**.
7. **Storno zprávy** ji skryje, ale stopa zůstane.
8. Kdo má **víc poboček**, dostane zprávy z té, kde píchl.
9. **Kiosek neukáže obsah** před zadáním PINu.
10. **Cizí firma** se nedostane k ničemu.
11. Vypnutý modul **odmítne přímé volání**.

A pravidlo z `CLAUDE.md`: **u každé nové kontroly rozbij schválně to,
co má hlídat, a přesvědč se, že spadne.** U komunikace to platí dvakrát
— tichá díra v RLS tady znamená, že si lidé čtou navzájem stížnosti.
