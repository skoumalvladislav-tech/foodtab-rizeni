# Nástěnka: dokumenty, střediska a jedno místo na zprávy

Zadal Šéfík 6. 9. 2026. **Až po přihlašování**
(`docs/prihlaseni-dokonceni-2026-09-06.md`) — to je pořád první.

> Nástěnka budou akce, kde budu dávat dokumenty k rozkliknutí, a zprávy
> pro celý tým. V tom případě bych udělal možnost poslat na středisko.

---

## 0. Co se tím vyjasnilo

**„Středisko" znamená totéž co „úsek".** Kuchyně, bar, servis uvnitř
jedné provozovny. Tabulka `useky` z noční práce (`20260906030000`) je
přesně to a **nic nového se nezakládá**.

**V rozhraní se tomu říká „Úsek".** Rozhodl Šéfík 6. 9. Tabulka se
jmenuje `useky`, v rozhraní stojí „Úsek" — a slovo „středisko" se
v aplikaci nepoužívá vůbec. Dvě slova pro jednu věc jsou horší než
ošklivé slovo.

**Co se na Nástěnku bude věšet** (Šéfík vybral):

- provozní pokyny a řády — hygiena, bezpečnost práce, nový lístek,
- akce a události — svatba, degustace, podklady k nim,
- fotky z provozu — rozbitá lednice, vzor talíře.

**Osobní dokumenty lidí tam NEPATŘÍ.** Šéfík je výslovně nezaškrtl.
Výplatní pásky, smlouvy a potvrzení patří k člověku, ne na nástěnku.
**Napiš to do komentáře u té tabulky**, ať to za rok někdo nepřidá jen
proto, že „to tam skoro pasuje" — s nimi by se totiž musela dělat
úplně jiná ochrana.

---

## 1. Adresát: jeden výběr pro celou aplikaci

Úkoly už se zadávají na **pobočku, úsek, pozici, nebo člověka**
(krok C, `20260906040000`). Nástěnka dnes umí jen firmu, pobočku
a jednoho člověka.

**Sjednoť to.** Tentýž výběr, tentýž tvar, ideálně tatáž komponenta:

```
KOMU:  ( ) celá firma   ( ) pobočka   ( ) středisko
       ( ) pozice       ( ) člověk
```

Není to jen pohodlí. Dva různé způsoby, jak se vybírá adresát,
znamenají dvě různá místa, kde se dá udělat chyba v oprávněních —
a jedno z nich se opraví a druhé ne.

---

## 2. Dokumenty a fotky

Tohle jsem v nočním zadání odložil se slovy „je to úložiště,
oprávnění k souborům a mazání". Platí to pořád — jen se to teď dělá,
protože je to hlavní důvod, proč Nástěnka existuje.

### Co se nesmí pokazit

**Soubor nesmí mít veřejnou adresu.** Ani „těžko uhodnutelnou".
Kdo si smí soubor otevřít, se odvozuje od toho, **kdo smí číst tu
zprávu** — a ověřuje se to při každém stažení, ne jednou při vyvěšení.

Prakticky: **neveřejný bucket** v Supabase Storage a **podepsaný odkaz
s krátkou platností** (jednotky minut), který se vystaví až ve chvíli,
kdy si o soubor řekne někdo, komu ta zpráva patří. Veřejný bucket
znamená, že stačí odkaz zkopírovat do WhatsAppu a hygienický řád
i s poznámkami koluje po Táboře.

**Povol jen to, co je potřeba:** `pdf`, `jpg`, `png`, `heic`
(iPhone fotí do heic — bez něj to lidem nepůjde a nikdo nepozná proč).
Ostatní odmítni s českou hláškou. **Strop na velikost** ať je taky —
navrhuju 10 MB na soubor a nejvýš 5 souborů na zprávu.

**Mazání je storno, ne výmaz** (pravidlo 9). Když se zpráva stornuje,
soubor **přestane být dosažitelný** — ale nemizí potichu z úložiště
dřív, než se rozhodne o době uchování.

**Doba uchování se pořád nevymýšlí.** Je to rozhodnutí pro Šéfíka.
Jen nech na to místo: ať se maže podle data, ne podle „vyber si co".

### Fotky jsou jiný režim než dokumenty

Fotek přibývá rychle a nikdo je nemaže. **Zmenši je při nahrání**
(dlouhá strana ať nepřesáhne 2000 px) — v provozu nikdo nepotřebuje
originál z iPhonu, potřebuje vidět, co je rozbité.

### Kiosek

Na sdíleném tabletu se dokumenty otevírají **až po PINu**, stejně jako
zprávy (krok E). Firemní oznámení může být vidět i bez něj — osobní
nic.

---

## 3. „Beru na vědomí" — a proč to není buzerace

U Nástěnky se dnes eviduje, kdo zprávu **přečetl**. Jakmile tam ale
budou viset hygienické postupy a poučení o bezpečnosti práce, změní se
to z pomůcky v **doklad, který po Šéfíkovi může chtít inspektorát.**

Proto přidej k oznámení volitelný příznak **„vyžaduje potvrzení"**:

- Kdo ji otevře, uvidí tlačítko **Beru na vědomí** — vědomé kliknutí,
  ne tiché „zobrazeno".
- Vedoucí vidí **seznam jmen**, kdo ještě nepotvrdil. Ne procenta —
  vedoucí potřebuje vědět, komu to má říct osobně (tak to má
  i 7shifts: záložka Unread se jmény).
- Nepotvrzené **zůstávají nahoře**, od nejstaršího (Deputy).
- **U zpráv s vyžadovaným potvrzením nejsou reakce ani odpovědi.**
  Jinak lidé „odpotvrdí" palcem a nikdo neví, co platí.

Nedávej to na všechno. „Zítra dorazí pivo ve dvě" potvrzení nepotřebuje.

---

## 4. Jedno místo na zprávy, dvě záložky

Dnes má člověk **dvě položky v nabídce** — „Zprávy" (Nástěnka) ve
spodní liště a „Rozhovory" schované pod „Více". Číšník má tedy dvě
místa, kde hledat zprávu, a bude si vybírat špatně.

Zůstanou to dva různé tvary — oznámení se potvrzuje a neodpovídá se na
ně, rozhovor je opak — ale **vchod má být jeden**:

```
ZPRÁVY
[ Nástěnka ]   [ Rozhovory ]
```

Nepřečtené se sčítají do **jednoho čísla** u ikony. Člověku je jedno,
jestli mu leží oznámení nebo vzkaz; chce vědět, že něco leží.

---

## 5. Co teď nedělat

- **Osobní dokumenty.** Viz oddíl 0.
- **Push do mobilu.** Pořád nechodí, nepiš do rozhraní, že chodí.
- **Prohlížeč dokumentů v aplikaci.** Ať se otevře v telefonu tím,
  co na to člověk má. PDF čtečka není náš problém.
- **Napojení na jazykový model.** Pravidlo 8 platí i na přílohy.

---

## 6. Testy

1. Oznámení na **středisko** vidí lidé toho střediska; kdo tam
   nepatří, **nevidí**.
2. Soubor **nejde stáhnout bez přihlášení** — podepsaný odkaz vyprší
   a po vypršení vrátí chybu.
3. Kdo **nesmí číst zprávu, nestáhne ani soubor** — ani přímým
   voláním úložiště.
4. **Cizí firma** se nedostane k souboru ani ke zprávě.
5. Zakázaný typ souboru **neprojde** a hláška je česky.
6. Soubor **nad strop** neprojde.
7. **Storno zprávy** znepřístupní i soubor.
8. „Beru na vědomí" jde kliknout **jednou** a je vidět **jméno**, ne
   jen počet.
9. Nepotvrzené oznámení je **nahoře**, od nejstaršího.
10. Fotka z iPhonu (**heic**) projde a zobrazí se.
11. Nepřečtené z Nástěnky i Rozhovorů se sčítají do **jednoho čísla**.

A pravidlo z `CLAUDE.md`: **u každé nové kontroly rozbij schválně to,
co má hlídat, a přesvědč se, že spadne.** U bodů 2 až 4 to platí
dvakrát — díra v přístupu k souborům je horší než díra v přístupu
k textu, protože soubor se dá poslat dál jedním kliknutím.
