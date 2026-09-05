# Zadání: domovská obrazovka „Dnes" pro zaměstnance

Vychází z `docs/analyza-mobil-zamestnanec.md`. Šéfík: *„nelíbí se mi
zobrazení v mobilu … jaké informace potřebuje zaměstnanec."*

**Není to nová funkce.** Všechno, co se tu zobrazuje, už v aplikaci
je. Je to přeskládání — a mění to první dojem každému, kdo není
majitel.

---

## 1. Co je dnes špatně

Aplikace se na telefonu otevře na **Rozcestníku**: „Kam dál" a šest
tlačítek. Nahoře k tomu řada modulů — Provoz, Tvorba menu, Finance,
Marketing.

Číšník, který si aplikaci otevře, má v hlavě jednu otázku: **kdy mám
příště jít a jsem teď zapíchnutý?** Dostane menu a hledá si odpověď
sám.

Rozcestník je dobrý pro majitele. Pro zaměstnance je to o krok navíc
při každém otevření — a v provozu, kde na to má vteřiny mezi
objednávkami.

## 2. Kam kdo přistane

- **Zaměstnanec** → **Dnes**
- **Majitel a vedení** → dashboard, jak je teď. Ten funguje.

Rozhoduje se podle **práv, ne podle názvu role** (pravidlo 2). Kdo
nemá práva vedení, přistane na Dnes.

**Rozcestník nerušíme** — zůstává dostupný, jen není domovský.

---

## 3. Nahoře jediná karta, která odpovídá

Podle stavu jedna ze dvou. Nic mezi.

**Když člověk není v práci:**

> **Nejste v práci**
> Dnes 9:00–22:00 · Bernard Bar Tábor
> Na směně s vámi: Irina, Láďa
>
> **[ Píchnout příchod ]**

**Když je:**

> **Jste v práci** od 9:03 · **4 h 12 min**
>
> **[ Píchnout odchod ]**

### Co na té kartě musí platit

- **Tlačítko je velké a dosáhne na něj palec.** Je to nejčastější
  úkon v aplikaci — dvakrát denně, každý den, ve spěchu.
- **Časy jsou hodina na zdi**, v pásmu pobočky. Použij `lib/cas.ts`,
  nedělej vlastní převod.
- **Když dnes směna není**, karta to řekne rovnou: *„Dnes nemáte
  směnu."* A pod tím nejbližší příští. Ne prázdno.
- **Když je otevřený příchod z včerejška** (noční), karta ukáže jeho,
  ne dnešek — bere se **otevřený** příchod (migrace
  `20260903010000`), ne nejstarší.
- **Píchnutí funguje stejně jako dnes** na Docházce. Žádná druhá
  cesta do databáze — volej, co existuje.

## 4. Pod kartou tři bloky, v tomhle pořadí

1. **Příští směny** — tři dopředu. Datum, čas, pobočka, kdo tam bude.
2. **Tenhle měsíc** — odpracováno, hrubá mzda, vyplacené zálohy,
   zbývá. Přesně to, co je dnes na Docházce; jen se to sem přenese.
3. **Co je nového** — nástěnka a zprávy. **Upozornění se podle
   pravidla doručí až po píchnutí**; tady se obsah jen ukáže, když si
   ho člověk sám otevře.

## 5. Horní řada modulů u zaměstnance zmizí

Tvorba menu, Finance, Marketing — do těch se stejně nedostane.
Zabírá to nejcennější místo na obrazovce a je to zrovna ta část, co
na iPhonu lezla pod ostrůvek.

**Spodní lišta zůstane** (Směny, Docházka, Zálohy, Úkoly, Více). Ta
je v pořádku a tak to dělají všichni.

---

## 6. Co se nesmí objevit

- **Cizí mzdy, cizí sazby, podíl nákladů, tržby.** Na telefonu to
  platí dvojnásob — obrazovku vidí každý, kdo stojí vedle.
- **„Na směně s vámi"** jsou **jména, nic víc.** Ne sazby, ne
  telefony, ne docházka těch lidí.
- **Neslibuj push do mobilu**, dokud nechodí.

## 7. Testy

1. Zaměstnanec přistane na **Dnes**, majitel na **dashboardu**.
2. Rozhoduje **právo**, ne název role.
3. Kdo **není v práci** a má dnes směnu, vidí čas, pobočku a Příchod.
4. Kdo **je v práci**, vidí od kdy, kolik už má a Odchod.
5. Kdo **dnes směnu nemá**, dostane větu a nejbližší příští — ne
   prázdnou kartu.
6. **Otevřený příchod z předchozího dne** se ukáže místo dneška.
7. Časy sedí **v pásmu pobočky**, ne v UTC.
8. **„Na směně s vámi" neukáže nic než jména.**
9. Zaměstnanec **nevidí řadu modulů**; majitel ano.
10. Píchnutí z Dnes vytvoří **týž záznam** jako z Docházky — a jde
    přes tutéž funkci, ne přes druhou cestu.

A pravidlo z `CLAUDE.md`: u každé nové kontroly **rozbij schválně to,
co má hlídat, a přesvědč se, že spadne.**
