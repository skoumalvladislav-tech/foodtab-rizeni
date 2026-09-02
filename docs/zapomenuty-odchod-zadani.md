# Zadání: upozornění na zapomenutý odchod

Zadal Šéfík 2. 9. 2026.

> Bude se stávat, že lidé zapomenou. Potřeboval bych notifikaci pro
> zaměstnance i pro majitele, druhý den ráno okolo 9:00, řekněme po
> 20 hodinách neodpíchnutí.

| Otázka | Rozhodnuto |
|---|---|
| Kdy se to pozná | Příchod bez odchodu starší než **20 hodin** |
| Kdy se to ozve | **Druhý den v 9:00**, ne ve chvíli, kdy hranice padne |
| Komu | **Zaměstnanci** a každému s právem **spravovat docházku** té pobočky |
| Jak často | **Jednou za záznam.** Ne každé ráno znovu |

---

## 0. Nejdřív oprava, která to blokuje dnes

Odkaz **„Doplnit odchod"** u nedokončeného záznamu **nefunguje**.
Klik nic neudělá — adresa se nezmění a formulář se nepředvyplní.
Ověřeno 2. 9. v ostré aplikaci.

Přitom cíl toho odkazu je v pořádku: když se stejná adresa otevře
přímo, formulář se předvyplní správně — druh `out`, správný člověk,
den, a věta *„Doplňujete odchod pro … Zbývá čas — ten aplikace vědět
nemůže."*

```
/cerna-perla/dochazka?doplnit=<zamestnanec>&den=2026-08-27#rucni
```

Chyba je tedy v tom klikání, ne v obrazovce za ním. Nejspíš proto, že
adresa má stejnou cestu a liší se jen dotazem — směrovač to bere jako
„nikam se nejde". **Tohle oprav jako první**, je to pár řádků a bez
toho je celý zbytek k ničemu: člověk upozornění dostane a zase nebude
mít kam kliknout.

---

## 1. Kdy se upozornění zakládá

Jednou denně, **v 9:00 místního času**, se projdou příchody, ke
kterým chybí odchod a které jsou starší než hranice. Ke každému
takovému záznamu vznikne upozornění — **jednou, ne opakovaně**.

### Hranice a hodina nejsou konstanty

Dvacet hodin a devátá jsou **Šéfíkovo dnešní rozhodnutí, ne zákon
přírody**. Patří proto do nastavení firmy (`tenant_settings`), ne do
kódu — pravidlo 1. Jiná restaurace bude chtít jiná čísla a nemá kvůli
tomu vznikat nová verze aplikace.

Výchozí hodnoty: **20 hodin** a **9:00**.

### Co z těch dvaceti hodin plyne

Ať je to řečené nahlas, ne objevené za měsíc: u **noční směny** se
zapomenutý odchod chytí až **druhé ráno**. Kdo píchne příchod ve
22:00, překročí hranici až v 18:00 druhý den — a nejbližší devátá je
až ráno potom.

U denních směn to sedí přesně: příchod v 11:27, hranice padne v 7:27
druhý den, ozve se v 9:00 téhož rána. To je to, oč šlo.

Kdyby se ukázalo, že noční směny takhle unikají moc dlouho, **mění se
číslo v nastavení, ne kód**.

---

## 2. Komu a co se řekne

**Zaměstnanci** — pokud má účet:

> **Chybí vám odchod z pondělí 31. 8.** Příchod v 11:27.
> Dokud odchod nedoplníte, směna se nezapočítá do odpracovaných hodin.

Tlačítko vede **rovnou na předvyplněný formulář** té směny, ne na
Docházku obecně.

**Tomu, kdo spravuje docházku** té pobočky — podle práva
`attendance.manage`, ne podle názvu role (pravidlo 2):

> **Láďa nemá odchod z pondělí 31. 8.** Příchod v 11:27.

**Brigádník bez účtu** upozornění dostat nemůže. Tím spíš musí přijít
vedoucímu — jinak se o tom nedozví nikdo. Ať je to v testu ověřené.

### Co v upozornění být nesmí

- **Žádná mzda, sazba ani částka.** Chybějící odchod je provozní věc,
  ne mzdová.
- **Nic z toho nejde do jazykového modelu** (pravidlo 8).
- Upozornění je osobní údaj: `tenant_id`, RLS, politika. Každý vidí
  jen svoje — i majitel.

---

## 3. Jednou, ne každé ráno

Kdyby to chodilo denně, za týden si toho nikdo nevšimne — a to je
horší než neposílat nic. Ozve se **jednou za záznam** a dál na to
stačí seznam nedokončených na Docházce, který už existuje.

Technicky: u příchodu si poznamenej, že se o něm už hlásilo, a **dej
na to jedinečný index**. Úloha může běžet dvakrát (opakování po
chybě, ruční spuštění) a nesmí z toho vzniknout druhé upozornění.

**Doplněný odchod tu poznámku nemaže.** Kdyby ji mazal a člověk by si
odchod zase smazal, přišlo by upozornění znovu a vypadalo by to jako
chyba.

---

## 4. Kdo tu úlohu spouští

Rozhodnutí, které si nevymýšlej sám — ale doporučení je tohle:

**Jedna funkce v databázi, která udělá všechnu práci**, a k ní
**serverová adresa chráněná tajemstvím z prostředí**, kterou volá
plánovač hostingu. Když se pak přestěhujeme z Vercelu na Hetzner,
mění se jen to, kdo tu adresu volá — ne co dělá.

Čtyři věci, které se u naplánovaných úloh pokazí vždycky:

**Nechráněná adresa.** Kdokoli by ji mohl vyvolat. Tajemství
v `env`, porovnání v konstantním čase, a **do prohlížeče se nedostane
nikdy** — jako `service_role` (pravidlo 6).

**Zimní a letní čas.** Když se plánovač nastaví napevno v UTC, v zimě
se to ozve v 10:00 a v létě v 9:00. Naplánuj to na **9:00
Europe/Prague**, a jestli plánovač umí jen UTC, ošetři to a napiš to
do kódu komentářem.

**Zmeškané spuštění.** Když plánovač v 9:00 neběžel, spuštění v 11:00
musí doběhnout normálně — hledá se podle stáří příchodu, ne podle
toho, kolik je hodin.

**Dvojí spuštění.** Viz jedinečný index výš. Ať je to ověřené testem,
který úlohu pustí dvakrát po sobě.

---

## 5. Testy

1. Příchod **starší než hranice** bez odchodu → upozornění vznikne.
2. Příchod **mladší** → nevznikne.
3. **Dvojí spuštění** úlohy nevyrobí druhé upozornění.
4. Upozornění dostane **zaměstnanec i ten, kdo spravuje docházku**;
   kdo `attendance.manage` nemá, nedostane nic.
5. **Brigádník bez účtu**: zaměstnanec nedostane nic, vedoucí ano.
6. **Cizí firma** se o ničem nedozví.
7. Po **doplnění odchodu** se už nic dalšího neposílá.
8. Upozornění **nejde přečíst cizímu člověku** ani přímým voláním.
9. **V textu není žádná částka** — ověř to na řetězci, ne okem.
10. **Zmeškané spuštění** doběhne správně i o dvě hodiny později.
