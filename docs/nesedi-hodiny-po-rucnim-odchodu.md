# Nález: po doplnění odchodu nesedí odpracované hodiny

Nalezeno 2. 9. 2026 v ostré aplikaci. **Týká se mzdy — má přednost.**

---

## Co se stalo

Šéfík se třikrát pokusil doplnit chybějící odchod k 31. 8. a pokaždé
záznam zůstal nedokončený. Zapsal jsem ho tedy sám přes formulář na
`/cerna-perla/dochazka?doplnit=…&den=2026-08-31`:

| Pole | Hodnota |
|---|---|
| Kdo | skoumalvladislav |
| Co | Odchod |
| Kde | Restaurace Černá Perla |
| Kdy | **2026-08-31 22:00** |
| Proč ručně | „Zapomenutý odchod, doplněno majitelem 2. 9." |

Aplikace odpověděla **„Zapsáno jako ruční záznam."** a hlášení
o nedokončené docházce zmizelo. Potud dobře.

---

## Co nesedí

| Kdy | Hrubá mzda za srpen | Odpracováno |
|---|---|---|
| Před zápisem | 2 015 Kč | **6 h 43 min** |
| Po zápisu | 2 700 Kč | **9 h 0 min** |

Příchod 31. 8. byl v **11:27**, odchod jsem zapsal na **22:00**. Ta
směna je **10 hodin 33 minut**.

Srpen měl tedy vyjít na **17 h 16 min** a 5 180 Kč. Vyšel na **9 h**
a 2 700 Kč. **Chybí 8 h 16 min.**

Přírůstek je přesně **2 h 17 min**, což od 11:27 odpovídá odchodu ve
**13:44** — čas, který jsem nikde nezadal.

Ověřeno na firemní i pobočkové úrovni, obojí ukazuje totéž, takže to
není filtr podle pobočky. Září se nezměnilo (5 h 0 min), takže se
zápis neztratil do jiného měsíce.

---

## Co s tím

**Nejdřív se podívej na syrové události 31. 8.** pro toho zaměstnance
— všechny, na obou pobočkách, včetně `business_date`, `branch_id`
a `source`. Bez nich se to hádat nedá a hádat se u mezd nemá.

Zajímá mě hlavně tohle:

1. **Nevzniklo něco při Šéfíkových třech pokusech?** Kdyby některý
   z nich zapsal událost, která se nedostala do seznamu
   nedokončených (třeba na druhou pobočku, kde `nedokoncena_dochazka`
   seskupuje po `branch_id`), pak by pár uzavřela ona a můj odchod ve
   22:00 by `app.odpracovane_minuty` **tiše přeskočila** — ta bere
   `out` jen tehdy, když je něco otevřené.

2. **Nedostal můj `out` jiný `business_date` než příchod?** Když se
   den odvozuje z `now()` místo z `occurred_at`, pár se rozpadne přes
   hranici dne a otevřená směna podle komentáře v `mzdy_vypocet`
   **propadá**.

3. **Neuplatňuje se někde strop nebo automatický odpočet přestávky?**
   Devět hodin je podezřele kulaté číslo.

**Nic nemaž a nic nepřepisuj, dokud nebude jasné, co tam je.** Když
se to bude opravovat, ať je z auditu poznat, co se stalo — na tomhle
záznamu se ta oprava bude ukazovat.

---

## Proč to považuju za nejzávažnější nález dneška

Ostatní věci byly nepohodlí: QR, které se musí opsat, odkaz, který se
musí obejít. Tohle je **číslo, ze kterého se platí lidem** — a bylo
špatně tiše. Nic nespadlo, nic se nečervenalo, aplikace napsala
„Zapsáno" a ukázala menší číslo.

Přesně proto v zadání stojí, že se doplněný odchod ukládá jako ruční
záznam s důvodem: aby šlo zpětně poznat, co je píchnuté a co dopsané.
Ta stopa teď bude potřeba.

**Přidej k opravě kontrolu**, která zapíše příchod, doplní odchod
a ověří, že odpracované minuty sedí **na minutu** — ne že „je jich
víc než nula".
