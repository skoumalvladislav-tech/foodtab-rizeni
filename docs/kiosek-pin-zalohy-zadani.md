# Zadání: kiosek s měnícím se kódem, PIN a zálohy

Zadal Šéfík 1. 9. 2026. Navazuje na `docs/dochazka-qr-zadani.md`
(uspořádání A) a na `docs/mzdy-zadani.md`.

Rozhodnutí, která padla u zadání:

| Otázka | Rozhodnuto |
|---|---|
| Potvrzení zálohy zaměstnancem | **Ano, PINem na tabletu** |
| Kdo smí zálohu vyplatit | **Nové zvláštní oprávnění**, ne docházkové |
| Ranní e-mail majiteli | **Souhrn a odkaz**, jména a hodiny až v aplikaci |
| Výdělek se zálohou | **Spočítat i „zbývá k výplatě"** (viz oddíl 7) |
| Způsob výpočtu | **Volba zákazníka**, měnitelná za provozu (oddíl 7) |

---

## 1. Co se staví

Tři věci, které spolu drží:

1. **Kiosek** — tablet nebo starý telefon na provozovně, kde běží
   aplikace v režimu, který neumí nic než docházku a zálohy.
2. **PIN** — pro toho, kdo nemá telefon nebo ho zrovna nemá u sebe.
   A zároveň podpis pod převzatou zálohou.
3. **Zálohy** — obsluha vyplatí hotovost, zaměstnanec potvrdí, majitel
   se to druhý den ráno dozví.

Nová aplikace se nepíše. Foodtab už je PWA (`app/manifest.ts`), takže
se na tabletu přidá na plochu a spustí se v režimu kiosku.

---

## 2. Kiosek má vlastní totožnost, ne přihlášeného člověka

**Tohle je nejdůležitější rozhodnutí celého zadání.**

Kdyby byl tablet přihlášený jako vedoucí, leží na baru účet, který vidí
tržby, mzdy a osobní údaje. Stačí, aby ho někdo vzal do ruky a přepnul
obrazovku. Tablet se navíc ztrácí, půjčuje a zůstává zapnutý přes noc.

Kiosek je proto **zařízení pobočky**, ne člověk:

- Nová tabulka **zařízení** — patří pobočce, má název („tablet u baru"),
  a **otisk servisního klíče**, nikdy klíč sám (pravidlo 7).
- Zaregistruje se tak, že někdo s právem na nastavení pobočky vygeneruje
  v aplikaci registrační kód, ten se na tabletu jednou zadá a tablet si
  uloží klíč. Kód platí krátce a jde použít jednou.
- Zařízení jde **kdykoli odvolat** — ztracený tablet přestane platit
  z jednoho místa, bez měnění čehokoli dalšího.
- Klíč zařízení **nikdy neopustí server** směrem k prohlížeči jinak než
  při té jediné registraci, a v databázi je jen otisk.

**Co kiosek smí, je krátký seznam:**

- ukázat měnící se kód k píchnutí
- přijmout PIN a podle něj píchnout
- ukázat, kdo má dnes na téhle pobočce směnu
- nechat potvrdit zálohu PINem

Nic jiného. **Ani přímým voláním rozhraní** — kiosek nemá číst mzdy,
kontakty ani rozpis jiné pobočky. Platí pravidlo 5 obráceně: co není
v seznamu, se odmítne, ne jen neukáže v nabídce.

Na tabletu se k tomu ještě zamkne aplikace systémem (na Androidu
připnutí aplikace, na iPadu Guided Access). To je věc nastavení
zařízení, ne kódu — ale patří do návodu pro provozovnu.

---

## 3. Měnící se kód

Beze změny proti `docs/dochazka-qr-zadani.md`, uspořádání A:

- Kiosek ukazuje QR, který se mění **každých 30–60 vteřin**.
- Kód je odvozený z tajemství pobočky a z času. **Vyfocený kód je za
  minutu neplatný** — to je celý smysl.
- Tajemství pobočky nikdy neopustí server; do prohlížeče jde hotový kód.
- Zaměstnanec ho načte **svým** telefonem a tím píchne.

Doba platnosti je nastavení pobočky, ne konstanta (pravidlo 1).

---

## 4. PIN

### K čemu je a k čemu není

PIN je **klíč od kiosku**, ne přihlášení do aplikace. Kdo zná PIN,
může na tabletu píchnout a potvrdit zálohu. Nedostane se tím do
aplikace, k rozpisu, ke mzdám ani k ničemu jinému.

To je podstatné, protože čtyři číslice jsou slabé tajemství: je jich
deset tisíc a kolega vidí přes rameno, co ťukáte.

### Pravidla, bez kterých je PIN nebezpečný

1. **PIN platí jen na registrovaném zařízení pobočky.** Nikdy z domova,
   nikdy z internetu, nikdy z cizího telefonu. Samotný PIN nesmí stačit
   k ničemu — teprve PIN **na tom správném tabletu** něco znamená.
2. **Ukládá se jako otisk se solí** (pravidlo 7). Nedá se přečíst ani
   z databáze, ani ze zálohy. Nikdo — ani majitel — nezjistí cizí PIN;
   jde ho jen zneplatnit.
3. **Zamykání po nezdarech.** Pět chyb u jednoho člověka = zámek na
   pár minut a záznam v auditu. Bez toho se čtyři číslice uhádnou.
4. **Volí si ho zaměstnanec sám**, v aplikaci nebo při prvním použití
   kiosku. Nikdo mu ho nepřiděluje a nikdo mu ho nesděluje.
5. **Zapomenutý PIN se neposílá, jen ruší.** Kdo má právo na docházku,
   PIN zneplatní; nový si člověk zadá sám. Reset jde do auditu — jinak
   by se dal PIN „ztratit" a nastavit za někoho jiného.
6. **Triviální PINy se odmítnou** — 1234, 0000, šest stejných číslic.
   Délka 4 až 6 číslic.

### Otevřená otázka

**Má kiosek ukazovat seznam jmen?** Je to pohodlné (ťuknu na sebe
a zadám PIN), ale tablet často stojí tak, že na něj vidí i host.
Doporučuji ukazovat **jen lidi, kteří dnes mají na téhle pobočce
směnu** — a když někdo zaskakuje, zadá PIN bez jména.

---

## 5. Co se tím zároveň zavírá

Dnes si zaměstnanec může **sám zapsat příchod s libovolným časem**.
Ověřeno na zkoušce: přímým voláním rozhraní jde založit příchod
k 1. červenci ve 3:00, a není nijak označený, protože formálně jde
o řádné píchnutí. Dokud byla docházka evidence, byla to drobnost.
**Teď z ní počítáme mzdu a zálohy.**

S kioskem to končí. Píchnutí smí vzniknout **jen třemi cestami**:

| cesta | čím se ověří |
|---|---|
| měnící se kód | platný kód pobočky, ne starší než doba platnosti |
| PIN na kiosku | registrované zařízení pobočky + PIN |
| ruční zadání | `attendance.manage`, důvod a audit (už hotové) |

Přímý zápis do docházky za sebe sama se **zakáže**. Je to změna
politiky, kterou je potřeba udělat ve stejném kroku — jinak zůstane
otevřená cesta, kterou kiosek obchází.

Dál platí ze staršího zadání: provozní den (pravidlo 10), dvojí načtení
nezaloží dva příchody, kód jedné pobočky nepíchne na druhé, bez sítě
se nepíchne.

**Pořád nerozhodnuto:** má píchnout i ten, kdo dnes v rozpisu není?
V gastru se to stává. Doporučuji povolit a **označit**.

---

## 6. Zálohy

### Co to je a co to není

Záloha ve Foodtabu je **záznam o hotovosti, která přešla z ruky do
ruky**. Není to platba, aplikace nikomu nic neposílá a bankovní
napojení zůstává výhradně pro čtení. Účetní dál dělá mzdy ve svém
programu — Foodtab jí jen řekne, co se během měsíce vyplatilo.

### Kdo smí

Nové oprávnění **„Vyplácet zálohy"** (`advances.manage`), označené jako
citlivé — takovou roli nejde pozvat přes SMS.

Zvlášť proto, že **vydávat peníze a vidět mzdy jsou dvě různé věci**.
Vedoucí směny u okénka potřebuje vydat dva tisíce, ne vidět, kolik kdo
bere. Kdo má `payroll.read`, oprávnění na zálohy tím nedostane, a
naopak.

### Jak to chodí

1. Obsluha na kiosku nebo v aplikaci vybere člověka a zadá částku.
2. **Zaměstnanec hned potvrdí PINem.** Tím se ze záznamu stává doklad,
   ne tvrzení jednoho člověka.
3. Zaměstnanci přijde upozornění („Vyplacena záloha 2 000 Kč").
   Zvoneček i seznam už existují z `docs/upozorneni-smeny-zadani.md`.

**Nepotvrzená záloha se nezahazuje.** Zůstane v seznamu jako
nepotvrzená, počítá se do součtů a majitel ji v ranním přehledu vidí
zvlášť. Pobočka, kde je polovina záloh nepotvrzená, je informace sama
o sobě.

### Pravidla pro peníze

- **Částka v haléřích jako `integer`**, nikdy desetinné číslo.
- **Kladná částka.** Horní mez je nastavení firmy (řádek v databázi,
  pravidlo 1), ne konstanta.
- **Záloha se nemaže.** Špatně zadaná se stornuje s důvodem; obojí
  zůstává a obojí je v auditu. Smazaný pohyb peněz je díra v evidenci.
- **Do jazykového modelu nejde** — pravidlo 8 se rozšiřuje: mzdy,
  docházka, kontakty **a zálohy**.
- `tenant_id`, RLS a politika. Každý vidí své zálohy; kdo má
  `advances.manage` nebo `payroll.read`, vidí zálohy své pobočky.

---

## 7. Kolik si vydělám

Zaměstnanec uvidí čtyři řádky:

```
Odpracováno             112 h 30 min
Hrubá mzda, orientačně   19 125 Kč
Vyplacené zálohy          4 000 Kč
Zbývá k výplatě          15 125 Kč   (před daněmi a odvody)
```

Šéfík rozhodl, že se **„zbývá k výplatě" spočítat má**. Poslední řádek
se proto ukáže — ale s viditelným vysvětlením, ne jako holé číslo.

Musí u něj stát, že jde o **hrubou mzdu po odečtení záloh, před daněmi
a odvody**. Zálohy se ve skutečnosti vyplácejí z čisté mzdy, takže na
výplatní pásce bude číslo nižší. Kdyby to na obrazovce nebylo napsáno,
první výplata po zavedení záloh skončí hádkou u baru — a bude to hádka
oprávněná.

Kdo to vidí: **ten člověk sám**, majitel a přidělená osoba
(`payroll.read`), přesně jako v `docs/mzdy-zadani.md`.

### Volba je zákazníka a dá se změnit za provozu

Každá firma to má jinak: někde se záloha bere jako splátka výplaty,
jinde jako záležitost účetní, do které aplikace nemá mluvit. Způsob
zobrazení je proto **nastavení firmy** (řádek v databázi, pravidlo 1),
ne rozhodnutí zadrátované v kódu:

| volba | co zaměstnanec vidí |
|---|---|
| **odečítat** | všechny čtyři řádky včetně „zbývá k výplatě" |
| **jen ukázat** | odpracováno, hrubá mzda, vyplacené zálohy — bez odečtu |
| **neukazovat** | odpracováno a hrubá mzda; zálohy jen vedení |

Výchozí je **odečítat**, protože tak to Šéfík chce. Zbylé dvě jsou tam
pro zákazníka, kterému to nesedí.

**Přepnutí kdykoli, bez následků na datech.** Tohle je podstatné pro
stavbu: záloha se do databáze ukládá vždycky stejně — kdo, komu, kolik,
kdy, kdo potvrdil. Volba mění **jen zobrazení**, nikdy uložené záznamy.
Přepnutí tedy nic nepřepočítává, nemigruje a nejde pokazit; projeví se
hned, i zpětně na minulé měsíce.

Změna nastavení jde **do auditu**. Když se lidem ze dne na den změní
číslo na obrazovce, musí být dohledatelné, kdo to přepnul a kdy.

---

## 8. Ranní e-mail majiteli

Chodí ráno a shrnuje **minulý provozní den**, ne kalendářní (pravidlo
10). Kdo skončil ve 2:15, patří do včerejška.

**V e-mailu je souhrn, ne jmenný rozpis:**

> **Restaurace Černá Perla — pondělí 1. 9.**
> Odpracováno 6 lidí, 47 h 15 min. Tři ruční zápisy.
> Zálohy: 3 výplaty, 6 500 Kč. Jedna nepotvrzená.
>
> Podrobnosti v aplikaci →

Jména, příchody a částky po lidech jsou **až v aplikaci po přihlášení**.
E-mail leží v cizí schránce, na telefonu i v záloze poštovní služby —
osobní údaje zaměstnanců by tím z aplikace odešly nadobro.

Další pravidla:

- **Píše ho kód, ne jazykový model** (pravidlo 8). Až přijdou agenti,
  tenhle e-mail k nim nepatří.
- **Komu chodí a v kolik**, je nastavení firmy — řádky v databázi, ne
  konstanta. Každá pobočka může mít jiného adresáta.
- **Odeslání se zaznamenává.** Když pošta selže, musí to být vidět;
  přehled, o kterém si majitel myslí, že chodí, a on nechodí, je horší
  než žádný.
- Pouští to úloha na serveru (Coolify u Hetzneru). **Servisní klíč
  zůstává na serveru** (pravidlo 6).
- Resend je nastavený, odesílatel `noreply@foodtab.cz`.

---

## 9. Testy

Kontroly míří na to, co **nemá** jít.

**Kiosek a zařízení**

1. Klíč zařízení se přes rozhraní **nedá přečíst** — jako otisky pozvánek.
2. Odvolané zařízení **nepíchne**.
3. Kiosek **nepřečte** mzdy, kontakty ani rozpis jiné pobočky.
4. Registrační kód jde použít **jednou** a po vypršení už ne.

**PIN**

5. PIN se z databáze **nedá přečíst** v čitelné podobě.
6. Správný PIN **z neregistrovaného zařízení nepíchne**.
7. Po pěti chybách je člověk **dočasně zamčený** a je to v auditu.
8. Cizí PIN nepíchne za jiného člověka.
9. Reset PINu bez `attendance.manage` **neprojde**.

**Píchnutí**

10. Přímý zápis docházky za sebe sama **neprojde** (nová politika).
11. Kód jedné pobočky **nepíchne** na druhé.
12. Kód starší než doba platnosti **neprojde**.
13. Dvojí načtení **nezaloží dva příchody**.
14. Píchnutí ve 2:15 patří do **včerejšího** provozního dne.

**Zálohy**

15. Bez `advances.manage` se záloha **nezaloží** ani přímým voláním.
16. Kdo má `payroll.read`, zálohu tím vyplácet **nesmí**.
17. Záporná a nulová částka **neprojde**.
18. Záloha se **nedá smazat**; storno zůstává v datech i v auditu.
19. Cizí zálohu si zaměstnanec **nepřečte**.
20. Potvrzení cizí zálohy vlastním PINem **neprojde**.

**Přehled a e-mail**

21. Součet záloh za měsíc sedí s tím, co vidí zaměstnanec.
21a. **Přepnutí způsobu zobrazení nezmění ani jeden uložený záznam** —
    jen to, co je na obrazovce. A je to v auditu.
22. Ranní přehled bere **provozní**, ne kalendářní den.
23. E-mail neobsahuje jména ani částky po lidech.

---

## 10. Pořadí

1. **Zařízení pobočky** — registrace, otisk klíče, odvolání. Bez toho
   nemá kiosek totožnost a všechno ostatní by viselo na přihlášeném
   člověku.
2. **PIN** — otisk, volba, zamykání, reset.
3. **Kiosek** — obrazovka s měnícím se kódem a polem na PIN, píchnutí
   oběma cestami.
4. **Zákaz přímého zápisu docházky za sebe.** Ve stejném kroku jako 3,
   ne později — jinak zůstane otevřená cesta, kterou kiosek obchází.
5. **Zálohy** — oprávnění, tabulka, potvrzení PINem, upozornění.
6. **Zbývá k výplatě** na obrazovce výdělku.
7. **Ranní e-mail** — úloha, nastavení adresátů, záznam o odeslání.

Body 1 až 4 dávají hotovou docházku, na kterou se dá spolehnout.
Teprve pak má smysl na ní stavět peníze.

---

## 11. Otevřené otázky

1. **Seznam jmen na kiosku** — všichni, jen dnešní směna, nebo bez
   jmen? (Doporučuji dnešní směnu.)
2. **Píchnutí bez směny** — povolit a označit, nebo odmítnout?
   (Doporučuji povolit a označit.) Visí to už od minulého zadání.
3. **Horní mez zálohy** — má aplikace odmítnout zálohu vyšší, než kolik
   má člověk zatím odpracováno, nebo jen varovat? (Doporučuji varovat;
   odmítnout by znamenalo, že aplikace rozhoduje o penězích za majitele.)
4. **Kdy přesně ráno** e-mail chodí a komu na každé pobočce.
