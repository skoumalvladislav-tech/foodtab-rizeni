# Nálezy z živých obrazovek — docházka, 5. 9. 2026

Prošel jsem nasazenou aplikaci obrazovku po obrazovce, ne kód. Tohle je
seznam toho, co se opravdu děje. Řazeno podle vážnosti.

*(Pozn.: dva dnešní soubory zadání mají v názvu `2026-09-04`. Datum je
o den zpátky, obsah platí.)*

---

## 1. Jeden člověk má dva otevřené příchody

**Co je vidět.** Na `/cerna-perla/dochazka` visí v seznamu
nedokončených:

- Vy — příchod čt **3. 9. v 13:14**, odchod chybí
- Vy — příchod po **31. 8. v 21:42**, odchod chybí

Stavový řádek přitom hlásí jen **„Jste v práci · od 13:14"**. Ten
srpnový v něm není a nikde jinde než v seznamu nedokončených se
neobjeví.

**Proč to vadí.** Tohle není chyba zobrazení. Aplikace pustila jednoho
člověka podruhé dovnitř, aniž by odešel. Z takového stavu se nedá
spočítat nic: hodiny ani mzda. A až se rozjede hlídač zapomenutých
odchodů, ohlásí oba — což je správně, ale je to důsledek, ne příčina.

**Co chci rozhodnout, ne domyslet.** Jsou dvě možnosti a **nevybírej
si sám**:

1. Druhý příchod se **odmítne** — „už máte otevřený příchod z 31. 8.,
   nejdřív ho dokončete".
2. Druhý příchod **první uzavře** jako nedokončený s příznakem, že ho
   uzavřel systém.

Já bych volil první: aplikace si nemá domýšlet, kdy někdo odešel — to
je pravidlo, které v tomhle modulu platí všude jinde a nemá se lámat
zrovna tady. Ale je to rozhodnutí o provozu, takže **zeptej se Šéfíka**
a teprve pak piš kód.

**Ať se to pozná:** kontrola, která zkusí píchnout příchod dvakrát za
sebou a ověří, že druhý neprojde. A rozbij ji — dočasně to pravidlo
vypni a přesvědč se, že spadne.

---

## 2. Otevřený příchod svítí i na druhé pobočce

Na `/bernard-bar/dochazka` stojí **„Jste v práci · od 13:14"**, i když
se píchlo v Černé Perle.

Podle `docs/prechod-mezi-pobockami-zadani.md` to nejspíš tak má být —
člověk je v práci bez ohledu na to, kde zrovna stojí. **Ověř to proti
zadání a napiš, co jsi zjistil.** Když to záměr je, patří k tomu na
obrazovku věta, kde se píchlo: „Jste v práci · od 13:14, Černá Perla."
Bez ní to na cizí pobočce vypadá jako chyba.

---

## 3. Záporné „Zbývá k výplatě"

Na docházce svítí:

```
Hrubá mzda za září — orientačně   0 Kč
0 h 0 min · 300 Kč/h
Vyplacené zálohy                  1 000 Kč
Zbývá k výplatě                  -1 000 Kč
```

Číslo je spočítané správně a vysvětlivka pod ním je dobrá. Ale **mínus
jako hlavní údaj** čte člověk jako „dlužím firmě tisícovku". Zvlášť
brigádník, který si zálohu vzal a ještě neodpracoval nic.

Navrhuju: když vyjde záporné číslo, neukazovat mínus, ale větu —
*„Zálohy zatím převyšují odpracované hodiny o 1 000 Kč."* Číslo
zůstává v přehledu pro vedení, kde patří.

---

## 4. Bernard Bar nemá tablet — a aplikace to říká dobře

*„Na téhle pobočce zatím není zaregistrovaný žádný tablet, takže není
odkud kód opsat a píchnout se nedá."*

Tohle je hláška, jaká má být: řekne co, proč a co s tím. **Nesahej na
ni.** Zapisuju to sem jen proto, aby bylo jasné, že to není chyba — je
to úkol pro Šéfíka.

---

## 5. Všechny směny mají 07:30–22:00

V rozpisu má **každý** 07:30–22:00, bez ohledu na profesi. Šablony se
nepoužívají, protože lidé nemají pozice — má ji jediný z dvanácti.

Není to chyba kódu. Až Šéfík doplní pozice a šablony, ověř, že se
u kuchaře a číšníka **opravdu** doplní jiné časy — a napiš mi, na čem
jsi to viděl.

---

## 6. Dva lidé mají ve firemním rozpisu stejnou barvu

Lucka i Maruška jsou **Jantarová**. Pravidlo hlídá jedinečnost v rámci
pobočky, takže formálně je to v pořádku. Ve firemním rozpisu, kde jsou
všichni pod sebou, to ale mate.

Malá oprava: ve **firemním** pohledu ať se u jména kreslí i zkratka
pobočky, nebo ať barva ustoupí a rozliší se pobočky. Neměň pravidlo
jedinečnosti — devět odstínů na dvanáct lidí nevyjde a přebarvovat
lidi kvůli jednomu pohledu je horší než ta záměna.

---

## Co jsem nezkoušel

**Nepíchal jsem.** Zapsalo by to skutečný záznam do ostrých dat a to
bez Šéfíkova svolení nedělám. Takže neověřeno zůstává:

- píchnutí PINem na tabletu,
- píchnutí kódem z tabletu přes telefon,
- přepočet hodin po ručním doplnění odchodu,
- potvrzení zálohy PINem.

Tyhle čtyři věci se musí projít **na tabletu naostro**, ne z kódu.
