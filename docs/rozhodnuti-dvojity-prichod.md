# Rozhodnutí: příchod, když je jeden ještě otevřený

Rozhodl Šéfík 5. 9. 2026, na otázku z `docs/nalezy-dochazka-2026-09-05.md`,
bod 1.

**Ani „vždycky odmítnout", ani „vždycky uzavřít".** Rozhoduje **stáří**
otevřeného příchodu.

---

## Pravidlo

Když člověk píchne příchod a **má otevřený starší příchod bez odchodu**:

| Otevřený příchod je z… | Co se stane |
|---|---|
| **dnešního provozního dne** | Nový příchod se **odmítne**. Hláška: „Už máte píchnutý příchod od 13:14. Nejdřív píchněte odchod." |
| **staršího provozního dne** | Starý se **uzavře jako nedokončený, uzavřel systém**. Nový příchod projde normálně. |

### Proč zrovna takhle

**Odmítat vždycky** vypadá čistě, ale má past: kdo včera zapomněl
odejít, by dnes ráno v šest nepíchl vůbec — a vedoucí, který to smí
spravit, v šest v provozovně není. Směna by začínala hádkou
s aplikací. To je horší chyba než ta, kterou bychom tím řešili.

**Uzavírat vždycky** zase smaže rozdíl mezi „zapomněl jsem včera
odejít" a „ťukl jsem omylem dvakrát za sebou". Druhý případ je
v provozu častější a ten se odmítnout **má** — jinak se z jedné směny
stanou dvě.

Stáří ty dva případy rozliší, protože se liší právě jím.

---

## Co „uzavřít" znamená — a co ne

**NEZNAMENÁ to domyslet čas odchodu.** To pravidlo v tomhle modulu
platí všude a neláme se ani tady. `out` zůstává prázdné.

Znamená to jen tolik, že se ten záznam **přestane považovat za
otevřený**, aby nebránil dalšímu příchodu. Takže:

- `out` **zůstává NULL**,
- přibude příznak, že ho uzavřel systém, **s časem, kdy se to stalo**
  (ne kdy člověk odešel — to nikdo neví),
- do **odpracovaných hodin ani do mzdy se nezapočítá**, přesně jako
  dnes,
- **zůstane v seznamu nedokončených** a vedoucí ho pořád může doplnit
  ručně. Doplnění ho z „uzavřel systém" překlopí na řádný ruční
  záznam, se jménem toho, kdo ho doplnil, a s důvodem.

Jinými slovy: uzavření systémem je **poznámka „tenhle už neblokuje"**,
ne náhrada za odchod.

## Přes půlnoc rozhoduje provozní den, ne kalendářní

`branches.day_starts_at` je na obou pobočkách 05:00, takže:

- příchod ve 22:00, druhý pokus ve 2:15 → **týž provozní den** →
  odmítnout. Tohle je noční směna, ne nový den.
- příchod ve 21:42 dne 31. 8., nový pokus 3. 9. ve 13:14 → **jiný
  provozní den** → uzavřít a pustit dál.

Použij `app.business_date`, nepočítej si to znovu.

## Napříč pobočkami

Pravidlo platí **bez ohledu na pobočku**. Člověk může být fyzicky jen
na jednom místě; otevřený příchod v Černé Perle brání i příchodu
v Bernardu — a při uzavření se uzavírá ten cizí stejně jako vlastní.

## Co uvidí člověk

Když se starý uzavře, ať to není potichu:

> Váš příchod z 31. 8. zůstal bez odchodu. Dali jsme o něm vědět
> vedoucímu — dnešní směnu vám to nezdrží.

Když se nový odmítne:

> Už máte píchnutý příchod od 13:14. Nejdřív píchněte odchod.

Obojí česky a bez čísel chyb. Na kiosku i v telefonu.

## Audit a hlídač

- Uzavření systémem je **záznam v auditu**: kdo, kdy, který záznam.
  Ne proto, že by to někdo zneužil, ale protože to je jediná změna
  docházky, kterou neudělal člověk.
- Uzavřený záznam **pořád patří mezi zapomenuté odchody** a hlídač ho
  ohlásí — jednou, drží to primární klíč v `zapomenute_odchody`.
  Ověř, že se uzavřením neztratí z jeho dosahu; to by byla nejtišší
  možná chyba: aplikace překážku odklidí a nikdo se nedozví, že tam
  byla.

---

## Testy

Ke každému platí pravidlo z `CLAUDE.md`: **rozbij schválně to, co má
hlídat, a přesvědč se, že spadne.** U bodů 1 a 2 to platí dvojnásob —
plete se to snadno a rozdíl je jedna hodina.

1. Otevřený příchod z **téhož provozního dne** → druhý příchod
   **neprojde**.
2. Otevřený příchod ze **staršího provozního dne** → druhý příchod
   **projde** a starý je označený jako uzavřený systémem.
3. Uzavřený má pořád **`out` prázdné** a **nezapočítal se** do hodin.
4. Příchod ve 22:00 a pokus ve 2:15 téže noci → **neprojde**
   (provozní den, ne kalendářní).
5. Otevřený příchod na **druhé pobočce** brání příchodu stejně.
6. **Ruční doplnění odchodu** u uzavřeného ho překlopí na řádný ruční
   záznam a hodiny se dopočítají správně.
7. Uzavřený se **ohlásí mezi zapomenutými odchody**, a to **právě
   jednou** i po opakovaném běhu úlohy.
8. Uzavření je **v auditu**.
9. **Cizí firma** se k ničemu z toho nedostane.

---

## Ještě dvě věci k dnešní práci

**Měřicí stránka musí běžet v režimu telefonu.** Změřil jsem
v Chromiu obojí:

```
telefon (meta viewport platí)    přetéká:   innerWidth 700, clientWidth 375, scrollWidth 700
počítač (meta viewport se ignoruje) přetéká: innerWidth 375, clientWidth 375, scrollWidth 700
```

Tvoje oprava na `documentElement.clientWidth` je správná — drží 375
v obou světech. Ale ta chybná podmínka `scrollWidth <= innerWidth`
**na počítači vypadá, že funguje**, a selže až na telefonu. Napiš to
do té stránky, ne do hlavy.

**Pushni to.** Zatím v `main` po `0dd88b8` není z téhle práce nic,
takže se na to nedá podívat ani to změřit. Až to tam bude, pustím tu
měřicí stránku v opravdovém prohlížeči s emulací iPhonu a ověřím
i to schválné rozbití.
