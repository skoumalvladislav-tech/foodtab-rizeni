# Zadání: docházka přes QR kód na provozovně

Zadal Šéfík 1. 9. 2026.

---

## 1. Problém, který řeší každá existující aplikace

**Vytištěný QR kód na zdi je k ničemu ve chvíli, kdy si ho někdo
vyfotí.** Od té chvíle se dá píchnout z domova, z auta, odkudkoli.
V oboru se tomu říká *buddy punching* a je to hlavní důvod, proč
docházkové aplikace existují — takže to nesmí být první, co Foodtab
umožní.

Existující nástroje (Jibble, Buddy Punch, Calamari, Moniti) to řeší
dvěma způsoby a **oba mají společné, že kód na zdi nestačí**:

| způsob | jak funguje |
|---|---|
| **Kiosek** | Na provozovně stojí tablet nebo starý telefon. Zaměstnanec se na něm označí sám (jméno + PIN), nebo mu tablet ukáže kód |
| **Měnící se kód** | Obrazovka ukazuje QR, který se **každou minutu mění**. Fotka je za minutu bezcenná |

---

## 2. Tři uspořádání, seřazená podle toho, co drží

### A. Kiosek s měnícím se kódem — doporučuji

Na provozovně je tablet nebo starý telefon s otevřenou stránkou, která
ukazuje QR kód **měnící se každých 30–60 vteřin**. Zaměstnanec ho
načte svým telefonem a tím píchne.

- Vyfocený kód je za minutu neplatný.
- Nepotřebuje polohu, takže ani žádné sledování zaměstnanců.
- Tablet nemusí být nový; stačí, aby zobrazil stránku.

Kód je odvozený z tajemství pobočky a z času — stejný princip jako
ověřovací kódy v bankovnictví. **Tajemství pobočky nikdy neopustí
server**, do prohlížeče jde jen hotový kód (pravidlo 6).

### B. Obráceně — zaměstnanec ukáže, provozovna načte

Každý má v aplikaci **svůj** kód, tablet na provozovně ho načte. Hodí
se tam, kde lidi nemají telefon nebo data.

Cena: důvěryhodným zařízením je tablet, takže se musí hlídat, kdo
u něj stojí.

### C. Vytištěný pevný kód — jen s omezeními

Nejlevnější a nejslabší. Když ho Šéfík chce, ať platí:

- funguje **jen v okolí naplánované směny** (například hodinu před
  a po), mimo to nepíchne nikdo
- u záznamu je **poznamenáno, že vznikl pevným kódem** — ať je při
  sporu vidět, čemu se dá věřit
- dá se kdykoli **přegenerovat**, když se dostane ven

---

## 3. Volba je na pobočce, ne v kódu

Šéfík chce QR jako **možnost**. Nastavení pobočky tedy určuje:

- zda se přes QR píchá vůbec
- které uspořádání (A, B, C)
- jak dlouho kód platí
- okno kolem směny u pevného kódu

Řádky v databázi, ne konstanty (pravidlo 1). Perla to může mít jinak
než Bernard.

---

## 4. Ruční zadání — pro toho, kdo zapomene telefon

Musí existovat, ale **nesmí vypadat stejně jako píchnutí**.

- Ruční záznam je **označený jako ruční**, s tím, **kdo ho zadal**
  a **proč** (krátká poznámka).
- Zadat ho smí jen kdo má `attendance.manage`.
- Jde do auditu.
- V přehledu je vidět — vedoucí má poznat pobočku, kde se „ručně"
  zadává polovina docházky.

**Zaměstnanec si ho sám nezadá.** Buď požádá vedoucího, nebo si podá
návrh, který vedoucí schválí. Jinak by ruční zadání obešlo celý smysl
píchání.

---

## 5. Polohu neřešit bez rozhodnutí

Některé aplikace ověřují, že je člověk opravdu na místě, přes GPS.
**Do toho se bez rozmyslu nepouštějte.**

Poloha zaměstnance je osobní údaj a její sledování je přísně omezené —
jednorázové ověření v okamžiku píchnutí je obhajitelnější než průběžné
sledování, ale i tak to chce právní posouzení a informování podle
`docs/osobni-udaje-zadani.md`.

**Uspořádání A polohu nepotřebuje.** To je jeho hlavní přednost.

---

## 6. Co se nesmí pokazit

- **Provozní den.** Píchnutí ve 2:15 patří do včerejška
  (`app.business_date`), pravidlo 10. Platí i pro QR.
- **Dvojí píchnutí.** Dvakrát načtený kód během minuty nesmí založit
  dva příchody. Druhé načtení buď nic, nebo srozumitelná hláška.
- **Cizí pobočka.** Kód Perly nepíchne na Bernardu.
- **Kdo tam nemá směnu.** Rozhodnutí pro Šéfíka: má píchnout i ten,
  kdo dnes v rozpisu není? V gastru se to stává (někdo zaskočí).
  Doporučuji povolit, ale **označit** — vedoucí to má vidět.
- **Docházka do modelu nejde** (pravidlo 8).
- Bez sítě se nepíchne. Fronta v telefonu je další úkol, ne tenhle.

---

## 7. Pořadí

1. **Ruční zadání** s označením, důvodem a auditem. Nejmenší kus,
   potřebný tak jako tak, a hned použitelný.
2. **Uspořádání A** — stránka kiosku s měnícím se kódem, načtení
   telefonem, nastavení pobočky.
3. **C jako doplněk** pro pobočku, která tablet nemá.
4. **B** až podle toho, jestli se ukáže, že ho někdo potřebuje.

Bod 1 jako první schválně: dokud ruční zadání nefunguje, nemá QR kam
ustoupit, když selže.

---

## 8. Testy

1. Kód z jedné pobočky **nepíchne** na druhé.
2. Kód starší než doba platnosti **neprojde**.
3. Dvakrát načtený kód **nezaloží dva příchody**.
4. Píchnutí ve 2:15 se počítá do **včerejšího** provozního dne.
5. Ruční záznam bez `attendance.manage` **neprojde** ani přímým voláním.
6. Ruční záznam je v datech **rozeznatelný** od píchnutého.
7. Tajemství pobočky se přes API **nedá přečíst** — stejná kontrola
   jako u otisků pozvánek.
