# Tři drobnosti z ostré aplikace — 1. 9. 2026 večer

Nasazené migrace jsem proklikal v ostré aplikaci. Zálohy i docházka
fungují: přepínač měsíce, vysvětlení nuly i věta o chybějícím tabletu
jsou na místě a čtou se dobře. Tohle zbývá.

---

## 1. Skloňování je spravené jen napůl

Docházka píše:

> **2 záznamy docházky není dokončených**

Podstatné jméno se srovnalo, zbytek věty ne. Správně:

> 2 záznamy docházky **nejsou dokončené**
> 1 záznam docházky **není dokončený**
> 5 záznamů docházky **není dokončených**

**Skloňování v češtině není jen koncovka počítaného slova** — mění se
i sloveso a přídavné jméno. Projdi všechna místa, kde se něco počítá,
a piš celou větu ve třech tvarech (1 / 2–4 / 5 a víc), ne jen slovo.

---

## 2. Nabídka lidí u záloh nesouhlasí s docházkou

Na Perle nabízí **ruční docházka** i Světlanu a Veroniku, označené
„zaskakuje". **Zálohy** je nenabízejí vůbec.

Je to tentýž případ a tentýž důvod: kdo tu dnes stojí směnu, tomu může
být potřeba vyplatit zálohu — a když patří na Bernard, dnes mu ji na
Perle nevyplatíš.

Použij **stejný zdroj lidí jako ruční zápis docházky**: lidé pobočky
plus každý, kdo tu má směnu v okně, se stejným označením „zaskakuje".
Ať to není dvakrát napsané dvěma způsoby — jedno místo, obě obrazovky.

---

## 3. Registrace tabletu: QR s adresou, kód se opisuje

Šéfík bude tablety registrovat sám a nechce na nich vyťukávat adresu.

Na obrazovku **Nastavení → Zařízení**, k vystavenému registračnímu
kódu, přidej **QR kód s adresou kiosku** (`https://…/kiosek`). Na
tabletu se načte foťákem, stránka se otevře a **osmiznakový kód se
opíše ručně** z obrazovky počítače.

**Kód do QR nedávej.** Registrační kód je jednorázový klíč k tomu, aby
se ze zařízení stal důvěryhodný tablet pobočky. QR se dá vyfotit přes
rameno a v obrázku se dá přečíst i z dálky; opsat osm znaků jednou za
život tabletu není práce, kvůli které to stojí za riziko.

QR ať je **dost velký, aby ho tablet přečetl z metru** (aspoň 200 px),
a ať je u něj napsaná i adresa textem — pro toho, kdo QR načíst nemá čím.

---

## 4. „Doplnit odchod" musí předvyplnit formulář

Šéfík se dnes pokusil dopsat odchod ke srpnovým příchodům a **zapsal ho
na dnešek**. Uzavřel si tím dnešní směnu (5 h, 1 500 Kč — počítá to
správně), ale 27. a 31. srpna zůstaly nedokončené dál.

Není to jeho chyba. Panel nedokončených záznamů říká „Doplňte odchod
ručním zápisem výš" — a ten formulář je **prázdný**. Kdo ho vyplňuje,
musí si sám zapamatovat člověka i datum a ručně je opsat o kus výš.
Nejbližší po ruce je „teď", takže se trefí do dneška.

**U každého nedokončeného záznamu ať je tlačítko „Doplnit odchod",
které formulář předvyplní:** toho člověka, druh „Odchod" a **datum toho
příchodu** (čas ať doplní člověk, ten aplikace vědět nemůže).

Ověřeno, že samotný zápis do minulosti funguje: ruční odchod k 31. 8.
v 19:00 nedokončený záznam uzavře. Chybí jen ta cesta na obrazovce.

---

## 5. Chybová hláška u pozvánky lže

Přijetí pozvánky skončilo na obrazovce takhle:

> **CHYBA: Token není platný (42501)**

Token přitom platný byl. `app.accept_invitation` vrací kód `42501` ve
**třech různých případech** a ke každému vlastní srozumitelnou větu:

- „Nejdřív se přihlaste."
- „Účet nemá profil."
- **„Pozvánka byla vystavena na jinou e-mailovou adresu."**

`app/pozvanka/[token]/akce.ts` je všechny přepíše na „Token není
platný". Šéfík byl přihlášený pod svým gmailem a pozvánka šla na
seznam — kontrola udělala přesně to, co má, a **obrazovka za ni
zalhala**. Hledal by chybu v tokenu, který je v pořádku.

**Pravidlo:** hlášku z databáze **propouštěj**, nepřepisuj ji.
Chybové kódy jsou na větvení, ne na text — text už je napsaný, česky,
na jednom místě a blíž příčině.

U téhle konkrétní věty ať je navíc vidět, co s tím:

> Tahle pozvánka byla vystavena na jinou adresu, než pod kterou jste
> přihlášený. Odhlaste se a přihlaste se adresou, na kterou pozvánka
> přišla.

Projdi i ostatní `if (error.code === …)` ve `vystaveni.tsx`, `rucni.ts`
a `akce.ts` u docházky — jsou psané stejným způsobem a dělají totéž.

---

## 6. Přepnutí účtu na jedno kliknutí

Navazuje na bod 5. Šéfík má dva účty (gmail a seznam) a nechce kvůli
každé pozvánce ručně odhlašovat a přihlašovat.

**Vazbu pozvánky na adresu nerozvolňuj.** Je to jediné, čím se ověří,
že odkaz použil ten, komu byl poslaný — přeposlaný e-mail by jinak
pustil do firmy kohokoli. Řeší se cesta, ne pravidlo.

Když se přihlášená adresa neshoduje s adresou pozvánky, ať je na
obrazovce vedle vysvětlení **tlačítko**:

> **Přihlásit se jako lada@…**

Klik odhlásí a rovnou pošle přihlašovací odkaz na **adresu z pozvánky**
— člověk nic neopisuje a nevybírá. Po přihlášení se vrátí na tutéž
pozvánku a dokončí ji.

Adresu v tlačítku **zkrať** (`l…a@seznam.cz`), ať se z cizí obrazovky
nedá přečíst celá. Kdo pozvánku otevřel, ji stejně zná z e-mailu.

Do budoucna (ne teď): víc adres u jednoho účtu. Až se ukáže, že to
někdo potřebuje — dnes to řeší tohle tlačítko.

---

## 7. „Účet zatím nepatří k žádné firmě" — říct, co bude dál

Šéfík se přihlásil druhým účtem a přistál na téhle obrazovce:

> **Účet zatím nepatří k žádné firmě**
> Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
> členství. Požádejte o pozvánku někoho, kdo firmu ve Foodtabu
> už spravuje.

Text je pravdivý, ale končí ve slepé uličce: člověk neví, jestli má
čekat, nebo něco udělat, a jestli se vůbec někdy něco stane.

**Pozor, tohle jsou dva různé stavy** a nepleť si je:

| stav | co o něm platí |
|---|---|
| **Účet bez členství** | Do žádné firmy nepatří. Aplikace mu nemá co ukázat — firmu nezná, pobočky nezná, jméno firmy taky ne. |
| **Člen bez oprávnění** | Do firmy patří. Rám aplikace s názvem firmy dává smysl, položky jsou nedostupné a je u nich vysvětlení. |

Šéfíkův nápad „pustit ho rovnou do aplikace, ale ať na nic neklikne"
patří **jen k druhému stavu** — u prvního není co vykreslit a prázdný
rám by vypadal jako rozbitá aplikace.

### Co s prvním stavem

Přepsat text tak, aby řekl, **co se stane**:

> Až vás někdo do firmy pozve, **přijde vám e-mail s odkazem**.
> Stačí počkat — nebo se ozvat tomu, kdo firmu spravuje.

### A tenhle slib musí být pravdivý

**Dnes se ten e-mail neposílá.** Přidělení členství ani oprávnění
neodešle nic. Než tu větu napíšeš, musí ji mít co splnit:

- **přijetí do firmy** (vznik členství) → upozornění v aplikaci **a**
  e-mail s odkazem
- **přidělení oprávnění** člověku, který ho neměl → totéž

Resend je od dneška nastavený a ověřený — pozvánka doopravdy dorazila,
takže je na čem stavět.

**Nepiš do rozhraní slib, který kód nesplní.** Radši nechat „ozvěte se
vedoucímu" než napsat „přijde vám e-mail" a nechat člověka čekat na
zprávu, která nikdy nepřijde. Když se ten e-mail nestihne, uprav text,
ne opačně.
