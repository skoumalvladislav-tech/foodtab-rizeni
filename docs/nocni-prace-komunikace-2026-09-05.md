# Noční práce: Komunikace a zadávání úkolů

Zadal Šéfík 5. 9. 2026 večer:

> Posílání zpráv mezi pobočkami, mezi zaměstnanci, zadávání úkolů na
> jednotlivá pracoviště a zaměstnancům.

Podklad: rešerše 7shifts, Deputy, Connecteam, Homebase, Crunchtime/
Zenput a Jolt, plus český a slovenský trh. Odkazy jsou u jednotlivých
míst, kde se z nich něco přebírá.

**Pravidlo pro celou noc: každý krok se dá nasadit sám. Když dojde
čas, skonči na hranici kroku a napiš, kde jsi.** Rozdělaná migrace je
horší než krok, který se nezačal.

---

## 0. Na čem stavíš — nic z toho nezakládej znovu

| Co už je | Kde |
|---|---|
| Nástěnka: `announcements`, `announcement_reads` | `20260823130000_provoz.sql`, obrazovka `app/[rozsah]/zpravy` |
| Rozhovory: `konverzace`, `konverzace_ucastnici`, `zpravy` + RLS | `bc08d5d`, `20260903100000_komunikace_zaklad.sql` |
| Úkoly: `task_templates`, `tasks` | `20260823130000_provoz.sql` ř. 129–164 |
| Checklisty: `checklist_templates`, `_items`, `_runs`, `_entries` | tamtéž ř. 169–225 |

**Klíčové zjištění, které ti ušetří noc:** `public.tasks` už má přesně
ten tvar adresáta, ke kterému došel zbytek světa —

```sql
branch_id   uuid,  -- NULL = celá firma
role_id     uuid,  -- pozice
employee_id uuid   -- konkrétní člověk
```

Tabulka je hotová. **Chybí obrazovka a pravidla, ne datový model.**

---

## 1. Co dělá svět a co si z toho bereme

### Oznámení a rozhovor jsou dvě různé věci

Všichni to mají oddělené a my taky (`docs/komunikace-zadani.md`,
oddíl 0). [7shifts](https://kb.7shifts.com/hc/en-us/articles/4417513597203):
*„Only Admins and Managers can send an announcement. Employees have
read access only."*

**Nesluč to.** Nástěnka je „tohle vědí všichni", rozhovor je „bavíme
se o tom".

### Kanály se neodvozují ručně

7shifts: *„Employees must be removed from the location, department, or
role in order to be removed from those chat channels."* Členství
v kanálu **není samostatná věc** — je to průmět přiřazení člověka.
Connecteam má na to
[Smart Groups](https://help.connecteam.com/en/articles/6114686):
pravidlo nad poli profilu, změna pozice člověka okamžitě přeřadí.

U nás to sedí na pravidlo 1: **kanál pobočky ani kanál pozice se
nezakládá, odvodí se.** Ručně se zakládá jen vlastní skupina a osobní
rozhovor.

### Nepotvrzené patří nahoru

[Deputy](https://help.deputy.com/hc/en-au/articles/4689257989903):
*„Posts that have not been confirmed will always be shown at the top
of the News Feed, sorted by oldest to newest."*

Tohle převezmi doslova. Číšník má na aplikaci třicet vteřin před
směnou; hledat nemá kdy.

### U zprávy, která se potvrzuje, nejsou reakce

Deputy emoji reakce u příspěvků s vyžadovaným potvrzením **zakazuje**.
Je to promyšlené: jinak lidé „odpotvrdí" palcem a nikdo neví, co
platí. Palec není potvrzení.

### Kdo nečetl — jménem, ne číslem

7shifts má u oznámení záložku **Unread se jmény**. Vedoucí potřebuje
vědět, komu má říct osobně, ne kolik procent.

### Poznámka ke směně se ukáže při píchnutí

[Homebase](https://www.joinhomebase.com/industry/restaurant-team-communication):
*„leave shift notes in specific shifts that your team will see when
they clock in."*

**Tohle je nejlevnější způsob, jak dostat informaci k člověku bez
telefonu** — a u nás navíc přesně sedí na Šéfíkovo pravidlo
o doručení po píchnutí. Přidej to k rozpisu jako poznámku ke směně,
ne jako další modul.

### Sdílený tablet: PIN a viditelný odpočet

[Jolt](https://help.smartsense.co/en/articles/10504761): zařízení se
spáruje kódem pobočky, člověk se prokáže PINem a **v rohu běží
viditelný odpočet do automatického odhlášení**. Ten odpočet převezmi —
je to jediné, co člověku na baru řekne, že za chvíli přestane být sám
sebou.

### A jedna věc, kterou NEPŘEBÍRÁME

7shifts u plnění úkolu **přepisuje historii**:
[*„only the latest entry will be recorded, replacing any previous
completion records or images"*](https://kb.7shifts.com/hc/en-us/articles/32169706835987).
U teplot lednic a HACCP je to v Česku problém — záznam, který jde
přepsat, není záznam.

**U nás se plnění zapisuje přírůstkově.** A pozor: `checklist_entries`
má dnes `unique (run_id, item_id)`, takže druhý zápis ten první
přepíše. **Je to tatáž past a je už v naší databázi.** Neřeš to dnes
v noci, ale zapiš si to jako nález.

Stejně tak nepřebírej, že úkol po termínu **zmizí** (7shifts ho po
dvou hodinách skryje). Úkol, který se ztratí z očí, nikdo nedodělá.
U nás zůstane vidět, označený „po termínu", a splnit ho jde dál — jen
se to zaznamená jako pozdní.

---

## 2. Pravidlo o doručení a co k němu přinesla rešerše

Šéfíkovo pravidlo zní: **vzkazy pracovníkům přijdou až po píchnutí na
směnu.**

Rešerše zjistila dvě věci, které stojí za to vědět:

**1. Nikdo to tak nedělá.** Ze všech prozkoumaných produktů nemá tichý
režim ani doručení vázané na směnu **žádný**. Deputy umí cílit na
*„members currently on shift"*, ale to je omezení odesílatele, ne
ochrana příjemce. 7shifts naopak výslovně umí poslat oznámení
**nenaplánovaným** zaměstnancům. Je to díra na trhu, ne něco, co
opisujeme.

**2. České právo to nevyžaduje, ale stojí za tím.** Výslovné „právo
být offline" v ČR
[neexistuje](https://www.epravo.cz/top/clanky/pravo-zamestnancu-byt-off-line-114753.html);
ochrana plyne z § 78 ZP, který dělí čas na pracovní dobu a odpočinek.
Podstatný je test z judikatury SDEU: **musí-li zaměstnanec reagovat
ve velmi krátké lhůtě, jde už o pracovní dobu**, ne o pohotovost.

Prakticky pro nás: aplikace, která zvoní mimo směnu a čeká rychlou
reakci, **vyrábí zaměstnavateli mzdový závazek**. Naše pravidlo ho
neřeší kvůli hezkému chování — řeší ho kvůli tomuhle. Napiš to do
komentáře u té funkce, ať to za rok nikdo „nezjednoduší".

---

## 3. Pořadí na noc

### Krok A — doručení podle píchnutí (jádro, bez obrazovek)

Funkce, která pro člověka řekne, co se mu doručí a co čeká.

- Otevřená směna se bere z **otevřeného** příchodu (migrace
  `20260903010000`), ne z nejstaršího. **Nepočítej si to znovu.**
- Kdo má víc poboček, dostane při píchnutí zprávy **té pobočky, kde
  píchl**.
- **Naléhavá zpráva pravidlo obchází**, je viditelně označená a jde
  do auditu se jménem odesílatele. Právo na ni je řádek
  v `permissions`, ne název role.
- Mimo směnu si člověk zprávy **přečíst může**, když si sám otevře
  aplikaci — pravidlo chrání před vyrušením, ne před informací
  (`docs/komunikace-zadani.md`, oddíl 1).

**Sem patří ta záporná kontrola:** cizí konverzaci nepřečtu ani přímým
voláním. Ta je důležitější než kladná.

### Krok B — obrazovka rozhovorů

Vedle Nástěnky, ne místo ní.

- Seznam rozhovorů: **nepřečtené nahoře, od nejstaršího** (Deputy).
- Druhy: `osobni`, `pobocka`, `mezi_pobockami`, `vedeni`.
- Kanál pobočky a pozice se **odvozuje**, nezakládá.
- U `mezi_pobockami` ověřuj účastníky proti členství (pravidlo 4) —
  je to jediné místo, kde se hranice poboček schválně překračuje.
- Vypnutý modul odmítne i přímé volání (pravidlo 5).

### Krok C — zadání úkolu na pracoviště a člověku

Tabulka je hotová, chybí obrazovka. Jeden formulář, jeden adresát:

```
KOMU:  ( ) celá pobočka   ( ) úsek   ( ) pozice   ( ) člověk
KDY:   termín (datum a čas)
CO:    název, poznámka, priorita
```

**Jeden cíl na úkol**, jako to má
[7shifts](https://kb.7shifts.com/hc/en-us/articles/32162610797203)
(*„a specific Location, Department, Role, or Employee"*). Víc adresátů
= víc úkolů. Nevymýšlej pole na seznam příjemců.

**Jmenovité přiřazení je štítek, ne zámek.** 7shifts to má stejně:
*„Other employees who can view this list can also see or complete
tasks that are tagged to someone else."* V provozu zaskakuje kdekdo;
úkol, který smí splnit jen jeden člověk, zůstane nesplněný, až bude
marodit.

**Kdo splnil, se ale zapisuje vždycky** — `done_by` a `done_at` už
v tabulce jsou.

### Krok D — „úseky" místo napevno psaných oddělení

`checklist_templates.department` má dnes v kódu

```sql
check (department in ('kuchyne','bar','servis','provoz','vedeni'))
```

To je **porušení pravidla 1**: pracoviště jsou věc zákazníka, ne kódu.
Bistro s jedním pultem nemá „kuchyni" a „servis", hotelová restaurace
má tři bary.

Založ `useky` (`tenant_id`, `branch_id` nullable, `nazev`, `poradi`,
`active`), přenes stávající pětici jako seed do testovacího prostředí
a `department` nahraď odkazem. **Starou migraci neupravuj** — přidej
novou a data převeď.

Tenhle krok odemyká „úkol na pracoviště" ve kroku C, takže se dá
udělat i před ním.

### Krok E — kiosek

- Že zprávy jsou, ale **ne jejich obsah** — tablet stojí na baru.
- Obsah po zadání PINu.
- **Viditelný odpočet do odhlášení** (Jolt) a zavření při nečinnosti
  i při odchodu.

---

## 4. Co dnes v noci NEDĚLAT

- **Přílohy a fotky.** Je to úložiště, oprávnění k souborům a mazání.
- **Push do mobilu.** Pořád nechodí — a nepiš do rozhraní, že chodí.
- **Doba uchování zpráv.** Rozhodnutí pro Šéfíka. Jen nech na to
  místo: ať se maže podle data.
- **Napojení na jazykový model.** Pravidlo 8. Z komunikace nejde ven
  nic, ani shrnutí.
- **Opravu `checklist_entries`.** Jen ji zapiš do hlášení.

---

## 5. Testy

Ke každému platí: **rozbij schválně to, co má hlídat, a přesvědč se,
že spadne.** U komunikace to platí dvakrát — tichá díra v RLS tady
znamená, že si lidé čtou navzájem stížnosti.

1. Zpráva poslaná **mimo směnu se nedoručí**; po píchnutí ano.
2. **Naléhavá** se doručí hned, je označená a je v auditu.
3. Naléhavou **nepošle**, kdo na to nemá právo.
4. **Cizí konverzaci nepřečte nikdo** — ani přímým voláním, ani
   majitel.
5. Vzkaz **adresovaný majiteli nevidí provozní**, ani s `people.manage`.
6. `mezi_pobockami`: účastník z druhé pobočky **čte**, kdo v ní není,
   **nečte**.
7. Kdo má **víc poboček**, dostane zprávy z té, kde píchl.
8. **Kiosek neukáže obsah** před zadáním PINu.
9. Úkol na **úsek** vidí lidé toho úseku; úkol na **člověka** vidí
   i ostatní, ale `done_by` sedí na toho, kdo ho splnil.
10. Úkol **po termínu nezmizí** a jde splnit; zapíše se jako pozdní.
11. **Cizí firma** se nedostane k ničemu.
12. **Vypnutý modul** odmítne přímé volání.

---

## 6. Hlášení ráno

Do `docs/hlaseni/stav-2026-09-06.md`: co je hotové, na které hranici
jsi skončil, čísla kontrol **a z čeho jsou** (PGlite ≠ PostgreSQL),
a co čeká na `db push`.

A ať tam je i to, na co jsi narazil a nešlo to udělat — to bývá
cennější než seznam hotového.
