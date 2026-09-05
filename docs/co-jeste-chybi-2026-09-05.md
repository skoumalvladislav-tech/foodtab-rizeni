# Co ještě chybí před zkouškou naostro — 5. 9. 2026 večer

Prošel jsem nasazenou aplikaci a data ve firmě. Všechno níž je
z obrazovek, ne z kódu.

---

## A. Věci, které jsem našel a nikdo je zatím neřešil

### 1. Účet má 4 lidí ze 14

| účet | role |
|---|---|
| Láďa | Kuchyně |
| Lucie Skoumalová | Majitel |
| lucka skoumalová | Bar |
| skoumalvladislav | Majitel |

Zbylých deset je v aplikaci vedeno, ale **nemůže se přihlásit**. Pro
kiosek to stačí (píchnou PINem), pro telefon ne.

Až tedy budeš dnes zkoušet „prostředí pro zaměstnance", zkoušíš ho
jen na těch čtyřech — a z nich jsou dva majitelé.

### 2. Roli Servis nemá nikdo

Číšník je v tvém provozu ta nejčastější role, a **ani jeden účet ji
nemá**. Když si chceš prohlédnout, co vidí číšník, musíš ji nejdřív
někomu dát — jinak koukáš na kuchaře.

Samotné role nastavené jsou a dávají smysl: Servis 6 práv, Bar 7,
Kuchyně 9, Vedoucí směny 13, Provozní 21, Účetní 1. Prázdné nejsou,
což byla moje první obava.

### 3. Všechny tři provozní role mají „Používat Gastro AI"

Servis, Bar i Kuchyně to mají zaškrtnuté. **Gastro AI ale neexistuje** —
je to vypnuté pole v horní liště, které nic nedělá.

Buď to právo odškrtni, dokud modul nebude, nebo ať se pole nekreslí.
První dojem „tady je něco, co nefunguje" stojí víc než chybějící
funkce, o které člověk neví.

### 4. Tři podobná jména

- **Lucie Skoumalová** — Majitelka, firemní úroveň, účet, role Majitel
- **lucka skoumalová** — Barman, Černá Perla, účet, role Bar
- **Lucka** — Bernard Bar, bez účtu

Jestli to jsou tři různí lidé, v pořádku. Jestli ne, **sluč je dřív,
než pustíš lidi dovnitř**: směna přiřazená duplicitnímu člověku se
nikomu nezobrazí a docházka se rozpadne na dvě poloviny, které nejdou
sečíst.

### 5. V seznamu lidí není vidět, kdo má PIN

U každého je tlačítko „PIN", ale ne jestli nějaký má. Před zkouškou
naostro potřebuješ vědět, komu ho ještě nastavit — a dnes to zjistíš
jedině tak, že to u každého otevřeš.

Chce to sloupeček „PIN: ano / ne". Ne hodnotu — ta se ukazuje jen
jednou, to je správně — jen jestli existuje.

---

## B. Co je ověřené a v pořádku

- **Horní lišta na telefonu** — 375 i 430 px, dva prvky, nic
  nepřetéká, název pobočky celý. Měřeno na nasazené aplikaci.
- **„Moje údaje"** už nejde posunout do strany: `scrollWidth` se rovná
  `clientWidth`, žádný prvek nevyčnívá. Ta chyba z fotky je pryč.
- **Hlídač zapomenutých odchodů** běží (běh #36, zeleně) a od téhle
  chvíle jede každou hodinu sám.
- **Role a oprávnění** jsou vyplněné, ne prázdné.
- **Kiosek** hlásí na neregistrovaném zařízení správně „Zaregistrovat
  tablet" — Perla registrovaná je, Bernard ne, což Šéfík ví.
- **Barvy** se v rámci pobočky neopakují. Shody napříč pobočkami
  (Jantarová u Lucky i Marušky) jsou podle pravidla v pořádku.

---

## C. Co ověřit nejde jinak než naostro

Tohle **nikdo z nás z prohlížeče neuvidí** — chce to tablet a telefon:

1. Píchnutí **PINem na tabletu**.
2. Píchnutí **kódem z tabletu přes telefon**.
3. **Přepočet hodin** po ručním doplnění odchodu. (Na tomhle už jsme
   se jednou spálili — hodiny nesouhlasily.)
4. **Potvrzení zálohy PINem.**
5. Jak vypadá aplikace **na plocho přidaná na iPhonu**, ne v Safari.

---

## D. Pořadí na dnešní večer

1. Sazby a pozice u lidí *(Šéfík, dělá se)*.
2. Zkontrolovat ty tři Lucky.
3. Nastavit PINy lidem, kteří budou dnes píchat.
4. Dát někomu roli **Servis**, ať jde vyzkoušet pohled číšníka.
5. Vydat rozpis znovu — pořád čeká sedm změn.
6. Teprve pak pozvánky.

Tablet v Bernardu a šablony směn počkají — na Perle se zkoušet dá
i bez nich.

---

## E. Co dělám automaticky já

**Dnes už běží samo:**

- Hlídač zapomenutých odchodů — hodinově, GitHub Actions.
- Workflow **Databáze** při každém pushi. Po přejmenování
  marketingového scénáře je poprvé smysluplné.

**Co dělám ručně a co by běžet mělo:**

- Celá zkouška proti opravdovému PostgreSQL. Dnes 727 kontrol.
- Kontrola nasazených obrazovek.

**Co navrhuju zapnout, až budou splněné body 1–4
z `docs/jak-zrychlit-praci.md`:** naplánovanou ranní úlohu, která
pustí zkoušku, projde nasazené obrazovky a napíše, co je rozbité.
Dneska by psala „červená" každé ráno kvůli `krok5`, takže je zbytečná,
dokud se to nespraví.

**Co pořád nejde:** pushovat. Tahle úloha nemá repozitář ve zdrojích,
takže všechny moje dokumenty putují přes Šéfíkův disk. Je to největší
zdržení, které v postupu je.
