# Přestávky paušálem, ne pícháním

Rozhodl Šéfík 8. 9. 2026:

> Přestávky píchat nebudeme. V nastavení dej možnost odečíst minuty
> defaultně všem, minuty budou na každém majiteli.

**Zařazuje se hned za A1** — je to tatáž oblast a tatáž chyba. Nahrazuje
otázku 5 v `docs/hlaseni/otazky.md` a **ruší nutnost třetího stavu
u tlačítka**, o kterém jsem psal dopoledne. Proč, je v oddílu 4.

---

## 1. Co se rozhodlo

| otázka | odpověď |
|---|---|
| kolik minut | **nastaví si každá firma sama** |
| od jak dlouhé směny | **až od delších** — práh je taky nastavitelný |
| co se zapsanými přestávkami | **skutečná přestávka má přednost** |

Navrhované výchozí hodnoty: **30 minut**, práh **6 hodin**. Zákoník
práce žádá přestávku nejpozději po 4,5 hodinách, takže šest hodin je
bezpečně nad tím — a brigádník na tři hodiny o půlhodinu nepřijde.

---

## 2. Kde to leží

**Přesně tak, jak už to v projektu funguje u časového pásma** — firemní
hodnota, kterou smí pobočka přebít:

```sql
alter table public.tenants
  add column prestavka_minut     integer not null default 30
    check (prestavka_minut between 0 and 240),
  add column prestavka_od_minut  integer not null default 360
    check (prestavka_od_minut between 0 and 1440),
  add column prestavka_platna_od date;

-- Prázdné = platí firemní hodnota. Vyplněné = tahle pobočka to má jinak.
alter table public.branches
  add column prestavka_minut     integer
    check (prestavka_minut between 0 and 240),
  add column prestavka_od_minut  integer
    check (prestavka_od_minut between 0 and 1440);
```

Nevymýšlej nový způsob, jak se hodnota hledá. Použij tentýž řetěz jako
`timezone`: **pobočka, jinak firma.** Dvě různé cesty k nastavení jsou
dvě místa, kde se to rozejde.

**Sloupcové granty:** obě tabulky je mají po sloupcích. Nový sloupec se
musí udělit **zvlášť** — jinak dostane obrazovka `42501 permission
denied` dřív, než se dostane na řádky, a nespadne jedno pole, ale celá
stránka. Je to v `CLAUDE.md` a stalo se to už jednou u `employees.color`.
**Přečti nový sloupec pod rolí `authenticated`**, než to prohlásíš za
hotové.

---

## 3. Pravidlo výpočtu

Mění se `app.worked_minutes` (`20260831011000_mzdy_vypocet.sql`) a
stejně tak její dvojče ve `20260902100000_storno_dochazky.sql`.
**Obě, jedním commitem.** Dnes jsou to dvě opsané kopie téhož výpočtu
a rozejít se smějí naposledy.

Pro **každou uzavřenou směnu** (dvojice příchod → odchod), ne pro celý
den — v jednom provozním dni můžou být dvě směny:

1. Spočítej hrubou délku směny: `odchod − příchod`.
2. Sečti **úplné** dvojice `break_start` + `break_end` uvnitř té směny.
3. **Když je aspoň jedna úplná přestávka, odečti ji** a paušál se
   neuplatní. Ani když je kratší než paušál — to je Šéfíkovo rozhodnutí
   a je správné: co je zapsané, to platí.
4. **Když žádná úplná přestávka není** a hrubá délka je **delší než
   práh**, odečti paušál.
5. Nikdy pod nulu — `greatest(0, …)` už tam je, nech ho tam.

Práh se porovnává s **hrubou** délkou, ne s délkou po odečtení. Jinak
by se směna kolem prahu chovala podivně: 6 h 10 min by po odečtení
spadla pod práh a odečet by se sám zrušil.

### Historii to nesmí přepsat

Tady je past, kterou by bylo vidět až na výplatní pásce. Srpnové
a zářijové směny **žádnou zapsanou přestávku nemají** — takže by na ně
paušál dopadl taky a **zpětně by se změnil už spočítaný odpracovaný
čas.**

Proto `prestavka_platna_od`. **Paušál se uplatní jen na provozní dny od
toho data dál**, dřívější zůstávají, jak jsou. Při prvním nastavení
předvyplň **dnešek** a napiš to k tomu poli na obrazovce.

Zapsané přestávky se tímhle nedotknou nikdy — ty platí odjakživa.

---

## 4. Tímhle mizí ta dopolední chyba, a je to poznat na číslech

Ověřil jsem dnes proti opravdovému PostgreSQL, že **rozdělaná přestávka
se proplácí jako práce**: směna 10:00–14:00 s `break_start` ve 12:00
a bez `break_end` dala **240 minut** místo 210.

S novým pravidlem je z rozdělané přestávky **neúplná dvojice**, takže
se podle bodu 3 nepočítá — a protože žádná úplná přestávka u té směny
není, uplatní se paušál. **Ze 240 je 210.**

Ta díra se tedy nezalepuje, ona zaniká. **Třetí stav u tlačítka
(„Konec přestávky") proto nedělej** — zadání z dopoledne v téhle části
neplatí.

**Ale napiš na to kontrolu.** Přesně tenhle případ — příchod, začátek
přestávky, odchod — a ověř, že vyjde míň než hrubá směna. Rozbij ji
schválně; dneska by prošla nad rozbitým kódem.

---

## 5. Rozhraní

### 5.1 Kde se to nastavuje

**Nastavení → Firma**, u ostatních provozních údajů. Ne u lidí a ne
u mezd — je to pravidlo provozu.

```
PŘESTÁVKY
Přestávky se nepíchají. Odečítají se paušálem.

  Odečíst  [ 30 ] minut ze směny delší než [ 6 ] hodin

  Platí od [ 8. 9. 2026 ]
  Starší směny se nemění.
```

Pod tím jedna věta příkladem, ať je to jednoznačné:

> *Směna 8:00–16:00 se spočítá jako 7 hodin 30 minut. Směna
> 8:00–12:00 se nezkracuje.*

U **pobočky** totéž, ale s předvolbou **„jako firma"** — vyplní se, jen
když to má ta pobočka jinak.

Měnit to smí `settings.manage`. **A patří to do auditu** — je to změna,
která hýbe odpracovaným časem všech lidí, tedy penězi.

### 5.2 Kde to musí být vidět

**Kdekoli se ukazuje odpracovaný čas, musí být vidět i odečet.** Ne
schované číslo, které nesedí s tím, co si člověk spočítá na prstech:

```
8:00–16:00 · 7 h 30 min   (−30 min přestávka)
```

Bez toho přijde první dotaz „proč mám míň hodin" a Šéfík na něj nebude
umět odpovědět z obrazovky.

### 5.3 Ruční zadávání přestávek nech být

`panel-rucni.tsx` (řádky 155–156) nabízí „Začátek přestávky" a „Konec
přestávky". **Nemaž to.** Přestávky se sice píchat nebudou, ale vedoucí
musí mít možnost skutečnou přestávku zapsat, když se odchýlí od paušálu
— a podle bodu 3 pak má přednost.

Z **kiosku ani z obrazovky docházky** se přestávka píchat nedá už dnes,
takže tam není co odebírat.

---

## 6. Zkoušky

U každé **rozbij schválně to, co má hlídat, a přesvědč se, že spadne.**

1. Směna **nad prahem** bez přestávky → odečte se paušál.
2. Směna **pod prahem** bez přestávky → **neodečte se nic**.
3. Směna se **zapsanou úplnou přestávkou** → počítá se ta, paušál ne.
4. Zapsaná přestávka **kratší** než paušál → počítá se ta kratší.
5. **Rozdělaná přestávka** (`break_start` bez konce) → jako by žádná
   nebyla, uplatní se paušál. *(To je ta dnešní chyba — 210, ne 240.)*
6. **Dvě směny v jednom provozním dni** → paušál se odečte od každé
   zvlášť, ne jednou za den.
7. Směna **před `prestavka_platna_od`** → nemění se.
8. **Pobočka s vlastní hodnotou** ji použije; pobočka bez ní vezme
   firemní.
9. Paušál **delší než celá směna** → nula, ne záporný čas.
10. Nový sloupec jde přečíst **pod rolí `authenticated`** (sloupcové
    granty).
11. Změna nastavení se zapíše do **auditu**.
12. **Cizí firma** nastavení nevidí ani nezmění.

A jedna přes obě funkce: **`app.worked_minutes` a výpočet ve
`storno_dochazky` musí nad týmiž daty vrátit totéž.** Dnes jsou to dvě
kopie a tahle kontrola je jediné, co je udrží spolu.

---

## 7. Než se to nasadí

Mění se výpočet odpracovaného času, tedy podklad pro mzdy. Do produkce
až po běhu proti **opravdovému PostgreSQL** — v PGlite běžíš jako
superuživatel a sloupcové granty se tam neprojeví vůbec.

Do hlášení napiš **kolik kontrol prošlo a z čeho.** Nasazuje Šéfík,
`db push` nespouštěj.
