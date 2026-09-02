# Odpověď na rozbor docházky — 2. 9. 2026 večer

Dobrá práce. Šel jsi pro data místo pro domněnku, ověřil výpočet na
minutu, zrekonstruoval stav **před** zápisem a ohlásil, že řádků je
**pět, ne tři** — tedy víc, než jsem tvrdil. Přesně tak to má vypadat.

---

## Nejdřív moje chyba

Tvrdil jsem, že příchod z 11:27 zůstal otevřený a že tedy chybí
8 h 16 min. **Nezůstal.** Zavřel ho odchod o devatenáct vteřin
později a otevřený byl poslední příchod ve 21:42:59.

Vzal jsem číslo z obrazovky a počítal z něj, místo abych se podíval
do dat — přesně to, co druhým vytýkám. Ta výtka platí dál, jen teď
i na mě.

Nález ale nezmizel, jen se přesunul: obrazovka mi ukázala nepravdivý
začátek a já se podle něj rozhodoval o mzdě. To je pořád chyba, jen
je jinde, než jsem myslel.

---

## Odpovědi na tvé dvě otázky

**1. Byla 31. srpna skutečná směna? NE.** Šéfík potvrzuje, že zkoušel
aplikaci. Sedí to i s rozpisem — ten den na Černé Perle stojí Láďa,
Vali a Andrea, Šéfík tam není. Ověřeno v denním pohledu 2. 9.

Těch 2 h 40 min je tedy nesmysl, ale **žádnou mzdu to nepoškozuje**.
Data se kvůli tomu přepisovat nebudou.

**2. Mrtvé řádky stornovat**, s poznámkou do auditu. Šéfík rozhodl.
Důvod: za půl roku je někdo — nebo úředník při kontrole — přečte jako
skutečné odchody. A tvá vlastní poznámka o tom, že by se spároval
s příchodem, kdyby nějaký před ně přibyl, je druhý důvod: nechat
v evidenci ležet nabitou zbraň se nemá.

Storno ať je storno, ne `delete` — pravidlo 9 platí i tady.

---

## Kde se s tebou rozcházím: nejhorší je čas, ne panel

Označil jsi za nejhorší **A** (panel ukazuje špatný začátek). Souhlasím,
že mě to zmátlo. Ale **C** je horší, a to podstatně — protože nejde
jen o zobrazení.

**C jsou dvě chyby, ne jedna.**

**Zobrazení je o dvě hodiny pozadu.** Událost z 13:27 pražského času
se na obrazovce ukazuje jako 11:27. Viděl jsem to na vlastní oči
a tvá data to potvrzují.

**Ruční zápis ukládá o dvě hodiny napřed.** Napsal jsem 22:00
a uložilo se 22:00 UTC, tedy půlnoc pražského času.

A teď to nepříjemné: **ty dvě chyby se na obrazovce vyruší.** Ruční
záznam zadaný jako 22:00 se jako 22:00 i zobrazí. Člověk tedy nikdy
nic nepozná — ale doopravdy je o dvě hodiny jinde, a doopravdy se
podle toho počítají minuty a hranice provozního dne.

### Co to znamená pro mzdy

**Každá směna, kde se příchod píchl na tabletu a odchod dopsal
ručně, je v létě o dvě hodiny delší, než byla.** V zimě o hodinu.

Není to teorie, je to v datech:

| Den | Příchod (píchnutý) | Odchod (ručně) | Spočteno | Ve skutečnosti |
|---|---|---|---|---|
| 27. 8. | 13:39 Praha | zadáno 18:22 → uloženo 20:22 Praha | 6 h 43 min | **4 h 43 min** |

Srpen je tedy nadhodnocený o dvě hodiny — 600 Kč u jednoho člověka
a jednoho dne. Ve dvou provozovnách a přes celý měsíc už to není
drobnost, a chyba jde **ve prospěch zaměstnance**, takže si nikdo
nestěžuje.

Proto pořadí: **C, pak A, pak B.**

### K opravě C ještě dvě věci

**Zimní a letní čas.** Posun není konstantní. Hromadná oprava
existujících ručních záznamů „minus dvě hodiny" by rozbila všechno,
co vzniklo v zimě. Převádět se musí **podle pásma a podle data té
události**, ne paušálně.

**Kterých záznamů se to týká.** Píchnuté (`source = 'app'`) jsou
uložené správně — `now()` je `now()`. Špatně jsou jen **ruční**.
Vypiš je všechny, než začneš, a ukaž mi seznam.

**Nesahej na to, dokud se nedohodneme na postupu.** Je to zásah do
mzdových dat, tedy riziko podle CLAUDE.md — nejdřív plán, pak práce.

---

## Pořadí prací

1. **C — pásmo.** Nejdřív kód, ať nevznikají další křivé záznamy.
   Oprava starých dat až potom a po dohodě.
2. **A — panel** ať ukazuje **otevřený** příchod, ne nejstarší.
3. **B — ruční odchod, když není co zavírat**, ať se odmítne větou,
   která říká proč. „Zapsáno" u zápisu, který nic neudělal, je horší
   než chyba.
4. **Storno těch pěti řádků.**
5. Teprve pak zpátky na QR a na zbytek pořadí.

### Kontroly

K té tvé kontrole na minutu přidej dvě:

- **Ruční záznam zadaný jako 22:00 v pražském čase se uloží jako
  20:00 UTC** — a zobrazí se zase jako 22:00. Ověř obojí, ne jen
  jedno; dnes to na obrazovce sedí i špatně.
- **Směna přes hranici provozního dne** (`day_starts_at` 05:00)
  s ručním odchodem padne do správného dne. Tam se to pásmo projeví
  nejdřív.
